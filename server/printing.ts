import { createConnection, isIPv4 } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError, isOrderPaid, once, requireRole, setStatus } from '../packages/domain/engine.js';
import { billTicket, cancelTicket, kitchenPrinters, linesFor, encodeEscPos, kitchenTicket, orderTargets, paymentTicket, readyToPrint, renderText, settlePrinted, singleKitchen, testTicket, type PrinterConfig, type PrinterConnection, type Ticket } from '../packages/domain/printing.js';
import { causeText, NO_PRINTER, type PrintCause } from '../packages/domain/print-problems.js';
import type { Actor, Order, State } from '../packages/domain/types.js';
import type { Store } from './store.js';
import { runProgram } from './programs.js';

export type PrintTransport = (connection: PrinterConnection, data: Uint8Array) => Promise<void>;

export function privateIPv4(host: string) {
  return isIPv4(host) && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}
/** A failed print with its plain cause (Mutfak fişi modu shows it: "Kâğıt bitti", "Yazıcı kapalı ya da kablosu çıkmış"…). */
export class PrinterFault extends DomainError {
  constructor(public fault: PrintCause, message: string) { super('PRINTER_UNREACHABLE', message, 502); }
}
/** The plain cause of any print error; anything not recognised is "Yazıcı yanıt vermedi". */
export const faultOf = (e: unknown): PrintCause => e instanceof PrinterFault ? e.fault : e instanceof DomainError && e.code === 'PRINTER_UNSUPPORTED' ? 'windows' : 'unknown';
/** Socket error codes in staff words: nothing answers at the address (off / cable out) or the network path itself fails. */
export function networkCause(code?: string): PrintCause {
  if (code === 'EHOSTUNREACH' || code === 'EHOSTDOWN' || code === 'ETIMEDOUT') return 'offline';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENETUNREACH' || code === 'ENETDOWN' || code === 'EADDRNOTAVAIL' || code === 'EPIPE') return 'network';
  return 'unknown';
}
/**
 * DLE EOT 4 (ESC/POS real-time status, paper roll sensor). A printer out of paper still accepts the bytes over the network and
 * prints nothing, so it is asked first: a status byte (0xx1xx10) with bits 5–6 set means the roll is empty. Printers that do
 * not answer within STATUS_WAIT_MS simply get the ticket.
 */
export const PAPER_QUERY = Uint8Array.from([0x10, 0x04, 0x04]);
const STATUS_WAIT_MS = 300;
function sendNetwork(host: string, port: number, data: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port });
    let done = false, wrote = false, wait: NodeJS.Timeout | undefined;
    const fail = (cause: PrintCause, message: string) => { if (done) return; done = true; clearTimeout(wait); socket.destroy(); reject(new PrinterFault(cause, message)); };
    const write = () => { if (done || wrote) return; wrote = true; clearTimeout(wait); socket.end(Buffer.from(data)); };
    socket.setTimeout(6000, () => fail('offline', `Yazıcıya ulaşılamadı (${host}). Yazıcının açık ve aynı ağda olduğunu kontrol edin.`));
    socket.once('error', (e: NodeJS.ErrnoException) => fail(networkCause(e.code), `Yazıcıya ulaşılamadı (${host}). IP adresini ve kabloyu kontrol edin.`));
    socket.once('connect', () => { socket.write(Buffer.from(PAPER_QUERY)); wait = setTimeout(write, STATUS_WAIT_MS); });
    socket.on('data', (chunk: Buffer) => {
      if (done || wrote) return;
      if ((chunk[0] & 0x93) === 0x12 && (chunk[0] & 0x60) === 0x60) fail('paper', `Yazıcıda kâğıt bitti (${host}). Yeni rulo takıp tekrar deneyin.`);
      else write();
    });
    socket.once('close', hadError => {
      clearTimeout(wait);
      if (done || hadError) return;
      if (wrote) { done = true; resolve(); } else fail('unknown', `Yazıcı bağlantıyı kapattı (${host}). Yazıcıyı kapatıp açın.`);
    });
  });
}
// Raw bytes through the Windows spooler (winspool.drv), so USB printers need no extra software.
const windowsScript = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class MolaRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OPEN");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Mola fis"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("DOC");
      try { StartPagePrinter(h); int w; if (!WritePrinter(h, data, data.Length, out w) || w != data.Length) throw new Exception("WRITE"); EndPagePrinter(h); }
      finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[MolaRawPrint]::Send($env:MOLA_PRINTER, [IO.File]::ReadAllBytes($env:MOLA_PRINT_FILE))`;
// Office printers (laser / inkjet, e.g. host-based HP LaserJets) silently drop raw receipt commands: Windows reports
// "printed" and an empty page or nothing comes out. They get the receipt as plain monospaced text drawn by their driver.
const documentScript = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$lines = [IO.File]::ReadAllText($env:MOLA_PRINT_FILE, [Text.Encoding]::UTF8) -split "\`n"
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $env:MOLA_PRINTER
if (-not $doc.PrinterSettings.IsValid) { throw 'printer' }
$doc.DocumentName = 'Mola fis'
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$font = New-Object System.Drawing.Font('Consolas', 10)
$script:i = 0
$doc.add_PrintPage({ param($s, $e)
  $y = $e.MarginBounds.Top; $h = $font.GetHeight($e.Graphics)
  while ($script:i -lt $lines.Count) {
    if ($y + $h -gt $e.MarginBounds.Bottom) { $e.HasMorePages = $true; return }
    $e.Graphics.DrawString($lines[$script:i], $font, [Drawing.Brushes]::Black, $e.MarginBounds.Left, $y); $y += $h; $script:i++
  }
  $e.HasMorePages = $false })
$doc.Print()`;
/** From the worker thread of server/programs.ts: starting PowerShell for a ticket never holds the tablets (weak PCs: 0.5 s and more). */
async function powershell(script: string, env: Record<string, string> = {}) {
  const r = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env, timeoutMs: 20000, output: true });
  if (r.code !== 0) throw new Error(`powershell ${r.code}`);
  return r.out;
}
async function sendWindows(printerName: string, data: Uint8Array, document = false) {
  if (process.platform !== 'win32') throw new DomainError('PRINTER_UNSUPPORTED', 'USB yazıcı yalnız Windows bilgisayarda kullanılabilir.', 409);
  const folder = mkdtempSync(join(tmpdir(), 'mola-print-')), file = join(folder, 'ticket.bin');
  try {
    writeFileSync(file, data);
    await powershell(document ? documentScript : windowsScript, { MOLA_PRINTER: printerName, MOLA_PRINT_FILE: file });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new PrinterFault('windows', `“${printerName}” yazıcısına gönderilemedi. Yazıcının Windows’ta kurulu ve açık olduğunu kontrol edin.`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
export const defaultTransport: PrintTransport = (connection, data) => connection.type === 'network' ? sendNetwork(connection.host, connection.port, data) : sendWindows(connection.printerName, data, connection.document);
/** Receipt printers get ESC/POS; an office printer gets the same receipt as plain text (large titles at normal size). */
export function ticketData(ticket: Ticket, printer: PrinterConfig): Uint8Array {
  if (printer.connection.type !== 'windows' || !printer.connection.document) return encodeEscPos(ticket, printer);
  return new TextEncoder().encode(renderText(ticket.map(op => 'text' in op ? { ...op, large: false } : op), printer).join('\n'));
}
export async function windowsPrinters() {
  if (process.platform !== 'win32') return [];
  try { return (await powershell('Get-CimInstance Win32_Printer | ForEach-Object { $_.Name }')).split(/\r?\n/).map(v => v.trim()).filter(Boolean).slice(0, 50); }
  catch { return []; }
}

// 'part': an İPTAL slip for items staff took off an order that goes on (Order.cancellations, by partId).
type Job = { tenant: string; orderId: string; printerId: string; kind: 'order' | 'cancel' | 'part'; partId?: string };
const retryDelays = [0, 5000, 20000];
/** A retry still waiting an hour after it was due will not run any more (its order is no longer printable). */
const STALE_ATTEMPT_MS = 3600_000;
/**
 * Prints kitchen tickets (tek mutfak: one printer) once an order may be prepared, and a cancel slip if a printed order is cancelled.
 * Runs inside the business's local server: it can reach printers on the café network.
 */
export class PrintService {
  private tenants = new Set<string>();
  private busy = new Set<string>();
  private attempts = new Map<string, { count: number; next: number; tenant: string; orderId: string }>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  constructor(private store: Store, private now: () => Date = () => new Date(), public send: PrintTransport = defaultTransport) {
    for (const row of store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) this.refresh(row.tenant);
  }
  /**
   * A business is watched while it has a kitchen printer, and always in Fiş modu (an order nobody can print is a warning).
   * Nothing waits in memory: what to print is read from the saved orders on every tick (change window, printedTo), so tickets
   * due while the server was off print right after it starts again.
   */
  refresh(tenant: string) {
    let s = this.store.read(tenant);
    // Tek mutfak: an old bar/kitchen split is folded into one kitchen printer once, with a notice for the owner.
    if (needsSingleKitchen(s)) { this.store.mutate(tenant, state => { singleKitchen(state, this.now()); }); s = this.store.read(tenant); }
    if (s.printers?.some(p => p.enabled && p.orders) || s.kitchenMode === 'ticket') this.tenants.add(tenant); else this.tenants.delete(tenant);
  }
  start(intervalMs = 2000) { this.timer ??= setInterval(() => void this.tick(), intervalMs); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  pendingJobs(tenant: string): Job[] {
    const s = this.store.read(tenant), now = this.now(), since = now.getTime() - 86400000;
    const jobs: Job[] = [];
    for (const o of s.orders) {
      if (Date.parse(o.createdAt) < since) continue;
      for (const part of o.cancellations ?? []) for (const printerId of part.printTo ?? []) if (s.printers?.some(p => p.id === printerId && p.enabled)) jobs.push({ tenant, orderId: o.id, printerId, kind: 'part', partId: part.id });
      if (o.status === 'cancelled') {
        if (!o.cancelPrinted && o.printedTo?.length) for (const printerId of o.printedTo) if (s.printers?.some(p => p.id === printerId && p.enabled)) jobs.push({ tenant, orderId: o.id, printerId, kind: 'cancel' });
        continue;
      }
      if (!readyToPrint(s, o, now)) continue;
      for (const { printer } of orderTargets(s, o)) {
        // A printer added today does not flood the kitchen with orders that were already in progress.
        if (Date.parse(o.createdAt) < Date.parse(printer.createdAt) || o.printedTo?.includes(printer.id) || o.printFailedTo?.includes(printer.id)) continue;
        jobs.push({ tenant, orderId: o.id, printerId: printer.id, kind: 'order' });
      }
    }
    return jobs;
  }
  async tick() {
    if (this.ticking) return; this.ticking = true;
    try { this.prune(); for (const tenant of this.tenants) { this.unprintable(tenant); for (const job of this.pendingJobs(tenant)) await this.run(job); } }
    catch { /* A broken printer must never stop the server; failures are recorded per order. */ }
    finally { this.ticking = false; }
  }
  /** Retry entries whose order left the floor (settled, printer turned off) would never be retried or cleared; drop them. */
  private prune() {
    if (!this.attempts.size) return;
    const stale = this.now().getTime() - STALE_ATTEMPT_MS, floors = new Map<string, Set<string> | null>();
    const onFloor = (tenant: string, orderId: string) => {
      if (!floors.has(tenant)) { try { floors.set(tenant, new Set(this.store.read(tenant).orders.map(o => o.id))); } catch { floors.set(tenant, null); } }
      return !!floors.get(tenant)?.has(orderId);
    };
    for (const [key, a] of this.attempts) if (!this.busy.has(key) && (a.next < stale || !onFloor(a.tenant, a.orderId))) this.attempts.delete(key);
  }
  /** Fiş modu: an order due for the kitchen that no printer takes (none left, or none for its products) is a warning too. */
  private unprintable(tenant: string) {
    const s = this.store.read(tenant), now = this.now(), since = now.getTime() - 86400000;
    if (s.kitchenMode !== 'ticket') return;
    const due = (o: Order) => o.status === 'new' && !o.printProblems?.length && Date.parse(o.createdAt) >= since && readyToPrint(s, o, now) && !orderTargets(s, o).length;
    if (!s.orders.some(due)) return;
    this.store.mutate(tenant, state => { for (const o of state.orders) if (due(o)) o.printProblems = [{ printerId: NO_PRINTER, cause: 'no_printer', at: now.toISOString() }]; });
  }
  /** Entries in the attempts map, for tests. */
  get retryCount() { return this.attempts.size; }
  private async run(job: Job) {
    const key = `${job.tenant}:${job.orderId}:${job.printerId}:${job.kind}`, attempt = this.attempts.get(key);
    if (this.busy.has(key) || (attempt && attempt.next > this.now().getTime())) return;
    const s = this.store.read(job.tenant), order = s.orders.find(o => o.id === job.orderId), printer = s.printers?.find(p => p.id === job.printerId);
    if (!order || !printer) return;
    const part = job.kind === 'part' ? order.cancellations?.find(c => c.id === job.partId) : undefined;
    if (job.kind === 'part' && !part) return;
    const lines = part ? linesFor(s, printer, part.lines) : orderTargets(s, order).find(t => t.printer.id === printer.id)?.lines ?? [];
    if (!lines.length) { if (job.kind !== 'order') this.store.mutate(job.tenant, state => this.finish(state, job)); return; }
    this.busy.add(key);
    try {
      await this.send(printer.connection, ticketData(job.kind === 'order' ? kitchenTicket(s, order, printer, lines) : cancelTicket(s, order, printer, lines, part), printer));
      this.attempts.delete(key);
      this.store.mutate(job.tenant, state => {
        const o = state.orders.find(v => v.id === job.orderId); if (!o) return;
        if (job.kind !== 'order') { this.finish(state, job); return; }
        printed(state, o, job.printerId);
      });
    } catch (e) {
      const count = (attempt?.count ?? 0) + 1;
      // Fiş modu: the warning shows from the first failure (the kitchen is waiting); a retry that works clears it again.
      if (job.kind === 'order') this.store.mutate(job.tenant, state => { const o = state.orders.find(v => v.id === job.orderId); if (o && state.kitchenMode === 'ticket') noteProblem(o, job.printerId, faultOf(e), this.now()); });
      if (count < retryDelays.length) this.attempts.set(key, { count, next: this.now().getTime() + retryDelays[count], tenant: job.tenant, orderId: job.orderId });
      else {
        this.attempts.delete(key);
        this.store.mutate(job.tenant, state => {
          const o = state.orders.find(v => v.id === job.orderId); if (!o) return;
          if (job.kind !== 'order') this.finish(state, job); else o.printFailedTo = [...new Set([...(o.printFailedTo ?? []), job.printerId])];
        });
      }
    } finally { this.busy.delete(key); }
  }
  /** A cancel slip is done (printed, or given up after the retries): never printed twice. */
  private finish(state: State, job: Job) {
    const o = state.orders.find(v => v.id === job.orderId); if (!o) return;
    if (job.kind === 'cancel') { o.cancelPrinted = true; return; }
    const part = o.cancellations?.find(c => c.id === job.partId); if (!part) return;
    part.printTo = part.printTo?.filter(id => id !== job.printerId);
    if (!part.printTo?.length) delete part.printTo;
  }
  async printNow(printer: PrinterConfig, ticket: Ticket) { await this.send(printer.connection, ticketData(ticket, printer)); }
  /**
   * Fiş modu warning → "Tekrar bas": prints the order on the kitchen printer now. `to` is the same printer, or the current
   * kitchen printer when the problem names another one (none was set, or the "Mutfak fişleri" role moved meanwhile); the
   * screens offer no "Başka yazıcıya bas" since there is one kitchen. On paper the problem is gone and the order may become
   * "Hazırlanıyor"; on failure the warning stays with the new cause and the caller gets it.
   */
  async printKitchen(tenant: string, orderId: string, printerId: string, to = printerId) {
    const key = `${tenant}:${orderId}:${printerId}:order`;
    if (this.busy.has(key)) throw new DomainError('PRINT_BUSY', 'Fiş şu anda basılıyor. Birkaç saniye sonra bakın.', 409);
    const s = this.store.read(tenant), o = s.orders.find(v => v.id === orderId);
    if (!o || ['cancelled', 'served'].includes(o.status)) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı ya da artık mutfakta değil.', 404);
    const target = kitchenPrinters(s).find(p => p.id === to);
    if (!target) throw new DomainError('NOT_FOUND', 'Mutfak yazıcısı kapalı ya da kaldırılmış. Yazıcıyı kontrol edin ya da siparişi mutfağa söyleyip “Elle iletildi” deyin.', 404);
    // The lines that printer should have had (every line: tek mutfak), or the whole order when no printer takes them.
    const source = s.printers?.find(p => p.id === printerId), lines = source ? linesFor(s, source, o.lines) : o.lines;
    this.busy.add(key);
    try {
      await this.send(target.connection, ticketData(kitchenTicket(s, o, target, lines.length ? lines : o.lines), target));
      this.attempts.delete(key);
      this.store.mutate(tenant, state => {
        const order = state.orders.find(v => v.id === orderId); if (!order) return;
        if (to === printerId) { printed(state, order, printerId); return; }
        // Printed elsewhere: the failed printer is done with (no retry, no İPTAL slip to it); the other printer has it.
        order.printedTo = [...new Set([...(order.printedTo ?? []), to])];
        if (printerId !== NO_PRINTER) order.printFailedTo = [...new Set([...(order.printFailedTo ?? []), printerId])];
        clearProblem(order, printerId); settlePrinted(state, order);
      });
    } catch (e) {
      const cause = faultOf(e);
      this.store.mutate(tenant, state => { const order = state.orders.find(v => v.id === orderId); if (order) noteProblem(order, printerId, cause, this.now()); });
      throw new DomainError('PRINTER_UNREACHABLE', `Basılamadı: ${causeText(cause)}. ${cause === 'paper' ? 'Yeni rulo takıp tekrar deneyin.' : 'Yazıcıyı kontrol edip tekrar deneyin ya da siparişi mutfağa söyleyip “Elle iletildi” deyin.'}`, 409);
    } finally { this.busy.delete(key); }
  }
}
/** A kitchen ticket reached `printerId`: no retry, no warning; in Fiş modu the order may now be "Hazırlanıyor". */
function printed(s: State, o: Order, printerId: string) {
  o.printedTo = [...new Set([...(o.printedTo ?? []), printerId])];
  o.printFailedTo = o.printFailedTo?.filter(id => id !== printerId);
  if (!o.printFailedTo?.length) delete o.printFailedTo;
  clearProblem(o, printerId); settlePrinted(s, o);
}
function clearProblem(o: Order, printerId: string) {
  if (!o.printProblems) return;
  o.printProblems = o.printProblems.filter(p => p.printerId !== printerId);
  if (!o.printProblems.length) delete o.printProblems;
}
/** Keeps the first failure's time (the warning sound rings once per problem), with the latest cause. */
function noteProblem(o: Order, printerId: string, cause: PrintCause, now: Date) {
  const current = o.printProblems?.find(p => p.printerId === printerId);
  if (current) { current.cause = cause; return; }
  o.printProblems = [...(o.printProblems ?? []), { printerId, cause, at: now.toISOString() }];
}
/** What "Teslim edildi" may close: in the kitchen's hands (or ready), no cancel request open, paid first where that is the rule. */
function deliverable(s: State, o: Order) {
  return (o.status === 'preparing' || o.status === 'ready') && !o.cancelRequested && (!o.paymentBeforePreparation || isOrderPaid(s, o));
}
/** Fiş modu with no printer left that prints orders: said right where the owner removed or switched it off. */
const noKitchenWarning = (s: State) => s.kitchenMode === 'ticket' && !kitchenPrinters(s).length ? { warning: 'Mutfak fiş modunda ama mutfak fişlerini basan yazıcı kalmadı. Yeni siparişler mutfağa basılamaz: bir yazıcı ekleyin ya da Ayarlar → Sipariş ve mutfak → Mutfak’tan Ekran’a dönün.' } : {};
/** Old data still routing to several kitchen/bar printers or by category (folded once by singleKitchen). */
export const needsSingleKitchen = (s: State) => (s.printers ?? []).filter(p => p.orders).length > 1 || (s.printers ?? []).some(p => p.categories?.length);
/** The staff snapshot's `printing`: what the screens offer, and in Fiş modu the kitchen printer for "Tekrar bas". */
export function printingView(s: State) {
  const enabled = (s.printers ?? []).filter(p => p.enabled);
  return { orders: enabled.some(p => p.orders), bill: enabled.some(p => p.bill), ...(s.kitchenMode === 'ticket' ? { ticketMode: true as const, kitchenPrinters: kitchenPrinters(s).map(p => ({ id: p.id, name: p.name })) } : {}) };
}

const connection = z.discriminatedUnion('type', [
  // Raw-print ports only: the printer feature must not become a way to open connections to other services on the network.
  z.object({ type: z.literal('network'), host: z.string().trim().refine(privateIPv4, 'Yerel ağ IP adresi girin (ör. 192.168.1.50).'), port: z.number().int().min(9100, 'Yazıcı portu 9100–9109 arasında olmalı.').max(9109, 'Yazıcı portu 9100–9109 arasında olmalı.') }),
  z.object({ type: z.literal('windows'), printerName: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f]+$/), document: z.boolean().optional() }),
]);
const printerInput = z.object({ name: z.string().trim().min(1).max(30), enabled: z.boolean(), connection, width: z.union([z.literal(58), z.literal(80)]), charset: z.enum(['ascii', 'pc857']), orders: z.boolean(), categories: z.array(z.string().trim().min(1).max(60)).max(40).default([]), bill: z.boolean() });
const printerFieldMessages: Record<string, string> = { name: 'Yazıcı adını yazın (en fazla 30 karakter).', 'connection.printerName': 'Windows yazıcısını seçin.', categories: 'Kategori seçimini kontrol edin.' };
export function printingRoutes(app: Express, store: Store, staffActor: (req: Request) => Actor, now: () => Date, service: PrintService) {
  // Printers are set up by the owner, and by Mola destek while the owner allows it (server/support-session.ts).
  const owner = (req: Request) => { const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner', 'support']); return a; };
  // Manual prints (test, reprint, bill, receipt) are capped per user so a stuck button cannot flood a printer.
  const manual = new Map<string, { count: number; until: number }>();
  function throttle(a: Actor) {
    const key = `${a.tenantId}:${a.id}`, t = now().getTime(); let m = manual.get(key);
    if (!m || m.until <= t) { if (manual.size > 5000) manual.clear(); m = { count: 0, until: t + 60000 }; manual.set(key, m); }
    if (++m.count > 30) throw new DomainError('RATE_LIMIT', 'Çok sık yazdırma isteği. Bir dakika sonra tekrar deneyin.', 429);
  }
  app.get('/api/staff/printers', (req, res) => {
    const a = owner(req);
    if (needsSingleKitchen(store.read(a.tenantId))) service.refresh(a.tenantId);
    const s = store.read(a.tenantId);
    res.json({ printers: s.printers ?? [], ...(s.printerNotice ? { notice: s.printerNotice } : {}) });
  });
  // The one-time "tek mutfak" notice: "Tamam" closes it for good.
  app.post('/api/staff/printers/notice-seen', (req, res) => {
    const a = owner(req);
    store.mutate(a.tenantId, s => { delete s.printerNotice; });
    res.json({ ok: true });
  });
  app.get('/api/staff/printers/windows', async (req, res) => { owner(req); res.json({ supported: process.platform === 'win32', printers: await windowsPrinters() }); });
  app.post('/api/staff/printers', async (req, res) => {
    const a = owner(req), parsed = z.object({ id: z.string().uuid().optional(), printer: printerInput }).safeParse(req.body);
    // The screen checks the same fields; if one still slips through, say which one instead of "Alanları kontrol edin".
    if (!parsed.success) { const issue = parsed.error.issues[0], field = issue.path.slice(1).join('.'); throw new DomainError('INVALID_PRINTER', printerFieldMessages[field] ?? (field === 'connection.host' || field === 'connection.port' ? issue.message : 'Yazıcı bilgilerini kontrol edin.')); }
    const b = parsed.data;
    // Güvenlik denetimi: a "\\sunucu\yazıcı" name makes Windows connect to that computer (and offer this account's NTLM hash):
    // only a network printer already installed on this computer is taken (Mola destek and a remote session may edit printers).
    if (b.printer.connection.type === 'windows' && /^[\\/]{2}/.test(b.printer.connection.printerName) && !(await windowsPrinters()).includes(b.printer.connection.printerName))
      throw new DomainError('INVALID_PRINTER', 'Bu ağ yazıcısı bu bilgisayarda kurulu değil. Önce Windows’ta kurun, sonra listeden seçin.');
    owner(req);
    const { printer: saved, moved } = store.mutate(a.tenantId, s => {
      if (!b.printer.orders && !b.printer.bill) throw new DomainError('PRINTER_PURPOSE', 'Yazıcının ne yazdıracağını seçin: mutfak fişleri, hesap ve kasa fişleri ya da ikisi.');
      s.printers ??= [];
      const existing = b.id ? s.printers.find(p => p.id === b.id) : undefined;
      if (b.id && !existing) throw new DomainError('NOT_FOUND', 'Yazıcı bulunamadı.', 404);
      if (!existing && s.printers.length >= 6) throw new DomainError('PRINTER_LIMIT', 'En fazla 6 yazıcı eklenebilir.', 409);
      // Tek mutfak: category routing is no longer offered; whatever an older screen sends, every order goes to the kitchen.
      const printer: PrinterConfig = { ...b.printer, categories: [], id: existing?.id ?? randomUUID(), createdAt: existing?.createdAt ?? now().toISOString() };
      s.printers = existing ? s.printers.map(p => p.id === printer.id ? printer : p) : [...s.printers, printer];
      // Only one printer holds "Mutfak fişleri": choosing it here takes it from the one that had it (its bill role stays).
      const before = printer.orders ? s.printers.filter(p => p.id !== printer.id && p.orders) : [];
      if (before.length) s.printers = s.printers.map(p => before.includes(p) ? { ...p, orders: false, categories: [] } : p);
      s.audit.push({ action: existing ? 'printer.updated' : 'printer.added', actor: a.id, target: printer.id, at: now().toISOString() });
      if (before.length) s.audit.push({ action: 'printer.kitchen_moved', actor: a.id, target: `${before.map(p => p.id).join(',')}->${printer.id}`, at: now().toISOString() });
      return { printer, moved: before.map(p => ({ name: p.name, idle: !p.bill })) };
    });
    service.refresh(a.tenantId); res.json({ printer: saved, ...(moved.length ? { moved } : {}), ...noKitchenWarning(store.read(a.tenantId)) });
  });
  app.post('/api/staff/printers/delete', (req, res) => {
    const a = owner(req), { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    store.mutate(a.tenantId, s => { s.printers = (s.printers ?? []).filter(p => p.id !== id); s.audit.push({ action: 'printer.removed', actor: a.id, target: id, at: now().toISOString() }); });
    service.refresh(a.tenantId); res.json({ ok: true, ...noKitchenWarning(store.read(a.tenantId)) });
  });
  // Ayarlar → Sipariş ve kasa → "Mutfak nasıl çalışıyor?". Fiş needs a printer that prints orders first.
  app.post('/api/staff/kitchen-mode', (req, res) => {
    const a = owner(req), { mode } = z.object({ mode: z.enum(['screen', 'ticket']) }).parse(req.body);
    store.mutate(a.tenantId, s => {
      if (mode === 'ticket' && !kitchenPrinters(s).length) throw new DomainError('NO_KITCHEN_PRINTER', 'Fiş modu için önce Ayarlar → Cihazlar → Yazıcılar’dan mutfak fişlerini basan bir yazıcı ekleyin (ya da kapalı olanı açın).', 409);
      if ((s.kitchenMode ?? 'screen') === mode) return;
      if (mode === 'ticket') s.kitchenMode = 'ticket'; else delete s.kitchenMode;
      // Back to Ekran: the kitchen board takes over; open print warnings are no longer the floor's job.
      if (mode === 'screen') for (const o of s.orders) delete o.printProblems;
      s.businessRevision = (s.businessRevision ?? 0) + 1;
      s.audit.push({ action: 'settings.kitchen_mode', actor: a.id, target: mode, at: now().toISOString() });
    });
    service.refresh(a.tenantId); res.json({ mode });
  });
  // The print warning's buttons (Fiş modu): everyone at the counter and the waiters, so whoever sees it can handle it.
  const floor = (req: Request) => { const a = staffActor(req); requireRole(store.read(a.tenantId), a, ['owner', 'manager', 'cashier', 'waiter']); return a; };
  const problemInput = z.object({ orderId: z.string().min(1).max(100), printerId: z.string().min(1).max(100), to: z.string().min(1).max(100).optional() });
  app.post('/api/staff/print/kitchen', async (req, res) => {
    const a = floor(req), b = problemInput.parse(req.body); throttle(a);
    await service.printKitchen(a.tenantId, b.orderId, b.printerId, b.to);
    store.mutate(a.tenantId, s => { s.audit.push({ action: b.to && b.to !== b.printerId ? 'print.other_printer' : 'print.retried', actor: a.id, target: `${b.orderId}:${b.printerId}${b.to ? `->${b.to}` : ''}`, at: now().toISOString() }); });
    res.json({ ok: true });
  });
  // "Elle iletildi": staff took the order to the kitchen by hand; the warning closes and the audit says who.
  app.post('/api/staff/print/handled', (req, res) => {
    const a = floor(req), b = problemInput.parse(req.body);
    store.mutate(a.tenantId, s => {
      const o = s.orders.find(v => v.id === b.orderId);
      if (!o) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
      if (!o.printProblems?.some(p => p.printerId === b.printerId)) return;
      clearProblem(o, b.printerId);
      if (b.printerId !== NO_PRINTER) o.printFailedTo = [...new Set([...(o.printFailedTo ?? []), b.printerId])];
      s.audit.push({ action: 'print.handled_manually', actor: a.id, target: `${o.id}:${b.printerId}`, at: now().toISOString() });
      settlePrinted(s, o);
    });
    res.json({ ok: true });
  });
  // "Hepsini teslim edildi" on a table (Fiş modu): every printed order of the bill reached the table.
  app.post('/api/staff/deliver-all', (req, res) => {
    const a = staffActor(req), b = z.object({ requestId: z.string().min(8).max(100), accountId: z.string().min(1).max(100) }).parse(req.body);
    res.json(store.mutate(a.tenantId, s => once(s, a, 'deliver-all', b.requestId, b, () => {
      requireRole(s, a, ['owner', 'manager', 'waiter']);
      const ready = s.orders.filter(o => o.accountId === b.accountId && deliverable(s, o));
      for (const o of ready) setStatus(s, a, o.id, o.version, 'served', now());
      return { delivered: ready.length };
    })));
  });
  app.post('/api/staff/printers/test', async (req, res) => {
    const a = owner(req), { id } = z.object({ id: z.string().uuid() }).parse(req.body); throttle(a);
    const s = store.read(a.tenantId), printer = s.printers?.find(p => p.id === id);
    if (!printer) throw new DomainError('NOT_FOUND', 'Yazıcı bulunamadı.', 404);
    await service.printNow(printer, testTicket(printer, s.name, now()));
    res.json({ ok: true });
  });
  app.post('/api/staff/print/order', async (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier', 'kitchen']); throttle(a);
    const { orderId } = z.object({ orderId: z.string().min(1).max(100) }).parse(req.body);
    const order = s.orders.find(o => o.id === orderId && o.status !== 'cancelled' && o.status !== 'awaiting_approval');
    if (!order) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    const targets = orderTargets(s, order);
    if (!targets.length) throw new DomainError('NO_PRINTER', 'Mutfak fişleri için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar’dan bir yazıcıyı “Mutfak fişleri” için seçin.', 409);
    const failed: string[] = [];
    for (const { printer, lines } of targets) {
      try { await service.printNow(printer, kitchenTicket(s, order, printer, lines, true)); } catch { failed.push(printer.name); continue; }
      store.mutate(a.tenantId, state => { const o = state.orders.find(v => v.id === order.id); if (o) printed(state, o, printer.id); });
    }
    if (failed.length) throw new DomainError('PRINTER_UNREACHABLE', `Yazdırılamadı: ${failed.join(', ')}. Yazıcının açık ve bağlı olduğunu kontrol edin.`, 502);
    res.json({ ok: true });
  });
  app.post('/api/staff/print/bill', async (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier']); throttle(a);
    const { accountId } = z.object({ accountId: z.string().min(1).max(100) }).parse(req.body);
    if (!s.accounts.some(v => v.id === accountId && v.status === 'open')) throw new DomainError('ACCOUNT_CLOSED', 'Hesap kapanmış.', 409);
    const printer = s.printers?.find(p => p.enabled && p.bill);
    if (!printer) throw new DomainError('NO_PRINTER', 'Hesap fişi için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar bölümünden ekleyin.', 409);
    await service.printNow(printer, billTicket(s, accountId, now()));
    res.json({ ok: true });
  });
  app.post('/api/staff/print/payment', async (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier']); throttle(a);
    const { paymentId } = z.object({ paymentId: z.string().min(1).max(100) }).parse(req.body);
    if (!s.payments.some(p => p.id === paymentId)) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    const printer = s.printers?.find(p => p.enabled && p.bill);
    if (!printer) throw new DomainError('NO_PRINTER', 'Fiş için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar bölümünden ekleyin.', 409);
    await service.printNow(printer, paymentTicket(s, paymentId, now()));
    res.json({ ok: true });
  });
}

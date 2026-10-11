import { createConnection, isIPv4 } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError, isOrderPaid, once, requireRole, setStatus } from '../packages/domain/engine.js';
import { billTicket, cancelTicket, changeTicket, kitchenPrinters, linesFor, encodeEscPos, kitchenTicket, orderTargets, paymentTicket, readyToPrint, renderText, settlePrinted, singleKitchen, testTicket, type PrinterConfig, type PrinterConnection, type Ticket } from '../packages/domain/printing.js';
import { causeAdvice, causeText, NO_PRINTER, problemText, type PrintCause } from '../packages/domain/print-problems.js';
import type { Actor, Order, State } from '../packages/domain/types.js';
import type { Store } from './store.js';
import { runProgram } from './programs.js';

/** `low`: the printer said its roll is nearly out (the ticket still printed). */
export type SendResult = { low?: boolean };
/** `job.name`: the spooler document name of a kitchen ticket ("Mola fis 12 order"), so a retry finds the copy still queued. */
export type PrintTransport = (connection: PrinterConnection, data: Uint8Array, job?: { name?: string }) => Promise<SendResult | void>;

export function privateIPv4(host: string) {
  return isIPv4(host) && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}
/** A failed print with its plain cause ("Yazıcıda kâğıt yok", "Yazıcı kapalı ya da kablosu çıkmış"…). */
export class PrinterFault extends DomainError {
  constructor(public fault: PrintCause, message: string) { super('PRINTER_FAULT', message, 409); }
}
/** The plain cause of any print error; anything not recognised is "Yazıcı yanıt vermedi". */
export const faultOf = (e: unknown): PrintCause => e instanceof PrinterFault ? e.fault : e instanceof DomainError && e.code === 'PRINTER_UNSUPPORTED' ? 'windows' : 'unknown';
/** Socket error codes in staff words: nothing answers at the address (off / cable out) or the network path itself fails. */
export function networkCause(code?: string): PrintCause {
  if (code === 'EHOSTUNREACH' || code === 'EHOSTDOWN' || code === 'ETIMEDOUT') return 'offline';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENETUNREACH' || code === 'ENETDOWN' || code === 'EADDRNOTAVAIL' || code === 'EPIPE') return 'network';
  return 'unknown';
}
const faultMessage = (cause: PrintCause, where: string) => `${causeText(cause)} (${where}). ${causeAdvice(cause)}`;
/**
 * ESC/POS real-time status (DLE EOT n): 1 printer status, 2 why it is offline, 4 the paper roll sensor. A printer out of
 * paper (or with its cover open) still accepts the bytes over the network and prints nothing, so it is asked first, one
 * question at a time. A printer that does not answer the first question within STATUS_WAIT_MS has no real-time status and
 * simply gets the ticket (as before). One that answers is asked again AFTER_PRINT_MS after the ticket: a roll that ran out
 * halfway is a failed ticket too.
 */
export const statusQuery = (n: 1 | 2 | 4) => Uint8Array.from([0x10, 0x04, n]);
export const PAPER_QUERY = statusQuery(4);
export const STATUS_WAIT_MS = 300, AFTER_PRINT_MS = 1000;
/** A real-time status byte has the fixed bits 0xx1xx10. */
export const statusByte = (b: number) => (b & 0x93) === 0x12;
export type PrinterStatus = { printer?: number; offline?: number; paper?: number };
/** What the status bytes say: a fault that stops the ticket, or `low` (roll nearly out; it still prints). */
export function statusFault(st: PrinterStatus): { fault?: PrintCause; low?: boolean } {
  if (st.paper !== undefined && (st.paper & 0x60) === 0x60) return { fault: 'paper' };
  if (st.offline !== undefined) {
    if (st.offline & 0x20) return { fault: 'paper' };
    if (st.offline & 0x04) return { fault: 'cover' };
    if (st.offline & 0x40) return { fault: 'error' };
  }
  if (st.printer !== undefined && st.printer & 0x08) return { fault: 'error' };
  return st.paper !== undefined && (st.paper & 0x0c) === 0x0c ? { low: true } : {};
}
function sendNetwork(host: string, port: number, data: Uint8Array) {
  return new Promise<SendResult>((resolve, reject) => {
    const socket = createConnection({ host, port });
    let settled = false, ending: SendResult | undefined, wait: NodeJS.Timeout | undefined, pending: ((b: number | undefined) => void) | undefined;
    const fail = (cause: PrintCause, message: string) => { if (settled) return; settled = true; clearTimeout(wait); pending = undefined; socket.destroy(); reject(new PrinterFault(cause, message)); };
    socket.setTimeout(6000, () => fail('offline', `Yazıcıya ulaşılamadı (${host}). Yazıcının açık ve aynı ağda olduğunu kontrol edin.`));
    socket.once('error', (e: NodeJS.ErrnoException) => fail(networkCause(e.code), `Yazıcıya ulaşılamadı (${host}). IP adresini ve kabloyu kontrol edin.`));
    socket.once('close', () => {
      if (ending && !settled) { settled = true; clearTimeout(wait); resolve(ending); return; }
      fail('unknown', `Yazıcı bağlantıyı kapattı (${host}). Yazıcıyı kapatıp açın.`);
    });
    socket.on('data', (chunk: Buffer) => {
      const b = [...chunk].find(statusByte);
      if (b === undefined || !pending) return;
      const answer = pending; pending = undefined; clearTimeout(wait); answer(b);
    });
    // One question; undefined when no answer comes in time.
    const ask = (n: 1 | 2 | 4) => new Promise<number | undefined>(done => {
      if (settled) return;
      pending = done; socket.write(Buffer.from(statusQuery(n)));
      wait = setTimeout(() => { if (pending === done) { pending = undefined; done(undefined); } }, STATUS_WAIT_MS);
    });
    // null: the first question got no answer (a printer without real-time status).
    const status = async (questions: (1 | 2 | 4)[]) => {
      const st: PrinterStatus = {};
      for (const n of questions) {
        const b = await ask(n);
        if (b === undefined) { if (n === questions[0]) return null; continue; }
        st[n === 1 ? 'printer' : n === 2 ? 'offline' : 'paper'] = b;
      }
      return st;
    };
    socket.once('connect', () => void (async () => {
      const before = await status([1, 2, 4]), first = before ? statusFault(before) : {};
      if (first.fault) return fail(first.fault, faultMessage(first.fault, host));
      if (settled) return;
      socket.write(Buffer.from(data));
      let low = !!first.low;
      if (before) {
        await new Promise(r => { wait = setTimeout(r, AFTER_PRINT_MS); });
        if (settled) return;
        const after = await status([2, 4]), second = after ? statusFault(after) : {};
        if (second.fault) return fail(second.fault, faultMessage(second.fault, host));
        low ||= !!second.low;
      }
      if (settled) return;
      ending = low ? { low } : {}; socket.end();
    })());
  });
}
/*
 * Raw bytes through the Windows spooler (winspool.drv), so USB printers need no extra software. The spooler's own word on
 * the printer is read too, read only (GetPrinter / GetJob / EnumJobs; nothing is changed or deleted): before sending (no
 * ticket goes to a printer that says "kâğıt yok", "kapak açık", "çevrimdışı") and for up to 3 s after, while the job is in
 * the queue. The script prints raw numbers (MOLA:BEFORE|WAITING|AFTER:status:attributes[:job]); spoolerFault reads them.
 * A kitchen ticket's job carries its own document name: when the paper ran out at the last try its copy may still wait in
 * the queue, and "Tekrar bas" then does not print it a second time (WAITING). How much a USB printer tells Windows depends on
 * its driver: many receipt-printer drivers report "kâğıt yok", the plainest "Generic / Text Only" one may say nothing.
 */
const spoolSource = `using System; using System.Runtime.InteropServices; using System.Threading;
public static class MolaRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct JOB_INFO_1 { public int JobId; public IntPtr pPrinterName; public IntPtr pMachineName; public IntPtr pUserName; public IntPtr pDocument; public IntPtr pDatatype; public IntPtr pStatus; public int Status; public int Priority; public int Position; public int TotalPages; public int PagesPrinted; public short y; public short mo; public short dw; public short d; public short h; public short mi; public short s; public short ms; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetPrinter(IntPtr h, int level, IntPtr buf, int size, out int needed);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetJob(IntPtr h, int id, int level, IntPtr buf, int size, out int needed);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumJobs(IntPtr h, int first, int count, int level, IntPtr buf, int size, out int needed, out int returned);
  const int BAD = 0x2|0x8|0x10|0x40|0x80|0x1000|0x100000|0x400000, BAD_JOB = 0x2|0x20|0x40|0x200|0x400, PRINTED = 0x80;
  static string State(IntPtr h) {
    int needed; GetPrinter(h, 2, IntPtr.Zero, 0, out needed); if (needed <= 0) return "0:0";
    IntPtr buf = Marshal.AllocHGlobal(needed);
    try { if (!GetPrinter(h, 2, buf, needed, out needed)) return "0:0"; int off = 13 * IntPtr.Size; return Marshal.ReadInt32(buf, off + 20) + ":" + Marshal.ReadInt32(buf, off); }
    finally { Marshal.FreeHGlobal(buf); }
  }
  static bool Bad(string state, int job) { string[] p = state.Split(':'); return (int.Parse(p[0]) & BAD) != 0 || (int.Parse(p[1]) & 0x400) != 0 || (job & BAD_JOB) != 0; }
  static int JobStatus(IntPtr h, int id) {
    int needed; GetJob(h, id, 1, IntPtr.Zero, 0, out needed); if (needed <= 0) return -1;
    IntPtr buf = Marshal.AllocHGlobal(needed);
    try { if (!GetJob(h, id, 1, buf, needed, out needed)) return -1; return ((JOB_INFO_1)Marshal.PtrToStructure(buf, typeof(JOB_INFO_1))).Status; }
    finally { Marshal.FreeHGlobal(buf); }
  }
  static int Waiting(IntPtr h, string doc) {
    int needed, count; EnumJobs(h, 0, 255, 1, IntPtr.Zero, 0, out needed, out count); if (needed <= 0) return 0;
    IntPtr buf = Marshal.AllocHGlobal(needed);
    try {
      if (!EnumJobs(h, 0, 255, 1, buf, needed, out needed, out count)) return 0;
      int size = Marshal.SizeOf(typeof(JOB_INFO_1));
      for (int i = 0; i < count; i++) { JOB_INFO_1 j = (JOB_INFO_1)Marshal.PtrToStructure(new IntPtr(buf.ToInt64() + (long)i * size), typeof(JOB_INFO_1)); if (Marshal.PtrToStringUni(j.pDocument) == doc) return j.JobId; }
      return 0;
    } finally { Marshal.FreeHGlobal(buf); }
  }
  public static string Peek(string printer) { IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OPEN"); try { return State(h); } finally { ClosePrinter(h); } }
  public static bool IsBad(string state) { return Bad(state, 0); }
  public static void Send(string printer, byte[] data, string doc) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OPEN");
    try {
      string state = State(h); Console.WriteLine("MOLA:BEFORE:" + state);
      if (Bad(state, 0)) return;
      if (doc != "Mola fis") { int waiting = Waiting(h, doc); if (waiting != 0) { Console.WriteLine("MOLA:WAITING:" + State(h) + ":" + Math.Max(0, JobStatus(h, waiting))); return; } }
      DOCINFO di = new DOCINFO(); di.pDocName = doc; di.pDataType = "RAW";
      int job = StartDocPrinter(h, 1, di); if (job == 0) throw new Exception("DOC");
      try { StartPagePrinter(h); int w; if (!WritePrinter(h, data, data.Length, out w) || w != data.Length) throw new Exception("WRITE"); EndPagePrinter(h); }
      finally { EndDocPrinter(h); }
      int st = 0;
      for (int i = 0; i < 12; i++) { Thread.Sleep(250); st = JobStatus(h, job); state = State(h); if (st < 0 || (st & PRINTED) != 0 || Bad(state, st)) break; }
      Console.WriteLine("MOLA:AFTER:" + state + ":" + Math.Max(0, st));
    } finally { ClosePrinter(h); }
  }
}`;
const windowsScript = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
${spoolSource}
"@
[MolaRawPrint]::Send($env:MOLA_PRINTER, [IO.File]::ReadAllBytes($env:MOLA_PRINT_FILE), $env:MOLA_PRINT_DOC)`;
/** PRINTER_INFO_2.Status / Attributes and JOB_INFO_1.Status bits (winspool.h). */
const SPOOL = { ERROR: 0x2, PAPER_JAM: 0x8, PAPER_OUT: 0x10, PAPER_PROBLEM: 0x40, OFFLINE: 0x80, NOT_AVAILABLE: 0x1000, USER_INTERVENTION: 0x100000, DOOR_OPEN: 0x400000, WORK_OFFLINE: 0x400 } as const;
const JOB = { ERROR: 0x2, OFFLINE: 0x20, PAPEROUT: 0x40, BLOCKED: 0x200, USER_INTERVENTION: 0x400 } as const;
/** The spooler's flags in staff words ("Yazıcıda kâğıt yok"…), or undefined when Windows sees nothing wrong. */
export function spoolerFault(status: number, attributes = 0, job = 0): PrintCause | undefined {
  if (status & (SPOOL.PAPER_OUT | SPOOL.PAPER_PROBLEM) || job & JOB.PAPEROUT) return 'paper';
  if (status & SPOOL.DOOR_OPEN) return 'cover';
  if (status & (SPOOL.OFFLINE | SPOOL.NOT_AVAILABLE) || attributes & SPOOL.WORK_OFFLINE || job & JOB.OFFLINE) return 'offline';
  if (status & (SPOOL.ERROR | SPOOL.PAPER_JAM | SPOOL.USER_INTERVENTION) || job & (JOB.ERROR | JOB.BLOCKED | JOB.USER_INTERVENTION)) return 'error';
  return undefined;
}
/** The script's last MOLA: line: a fault, and `waiting` when this ticket's earlier copy is still in the queue (not sent again). */
export function spoolerResult(out: string): { fault?: PrintCause; waiting?: boolean } {
  const last = out.split(/\r?\n/).map(v => v.trim()).filter(v => v.startsWith('MOLA:')).pop();
  if (!last) return {};
  const [, phase, status, attributes, job] = last.split(':'), fault = spoolerFault(Number(status) || 0, Number(attributes) || 0, Number(job) || 0);
  return { ...(fault ? { fault } : {}), ...(phase === 'WAITING' ? { waiting: true } : {}) };
}
// Office printers (laser / inkjet, e.g. host-based HP LaserJets) silently drop raw receipt commands: Windows reports
// "printed" and an empty page or nothing comes out. They get the receipt as plain monospaced text drawn by their driver.
// The spooler's word is read first here too.
const documentScript = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
${spoolSource}
"@
$state = [MolaRawPrint]::Peek($env:MOLA_PRINTER)
[Console]::Out.WriteLine("MOLA:BEFORE:$state")
if ([MolaRawPrint]::IsBad($state)) { exit 0 }
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
/** Runs a spooler script; tests put a fake spooler here (its MOLA: lines), nothing else changes it. */
export const spooler = { run: (script: string, env: Record<string, string>) => powershell(script, env) };
async function sendWindows(printerName: string, data: Uint8Array, document = false, doc = 'Mola fis'): Promise<SendResult> {
  if (process.platform !== 'win32') throw new DomainError('PRINTER_UNSUPPORTED', 'USB yazıcı yalnız Windows bilgisayarda kullanılabilir.', 409);
  const folder = mkdtempSync(join(tmpdir(), 'mola-print-')), file = join(folder, 'ticket.bin');
  let answer: ReturnType<typeof spoolerResult>;
  try {
    writeFileSync(file, data);
    answer = spoolerResult(await spooler.run(document ? documentScript : windowsScript, { MOLA_PRINTER: printerName, MOLA_PRINT_FILE: file, MOLA_PRINT_DOC: doc }));
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new PrinterFault('windows', `“${printerName}” yazıcısına gönderilemedi. Yazıcının Windows’ta kurulu ve açık olduğunu kontrol edin.`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
  if (answer.fault) throw new PrinterFault(answer.fault, faultMessage(answer.fault, printerName));
  return {};
}
export const defaultTransport: PrintTransport = (connection, data, job) => connection.type === 'network' ? sendNetwork(connection.host, connection.port, data) : sendWindows(connection.printerName, data, connection.document, job?.name);
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
// 'change': a DEĞİŞİKLİK slip for a line a waiter changed after the order printed (Order.changes, by partId).
type Job = { tenant: string; orderId: string; printerId: string; kind: 'order' | 'cancel' | 'part' | 'change'; partId?: string };
const retryDelays = [0, 5000, 20000];
/** A retry still waiting an hour after it was due will not run any more (its order is no longer printable). */
const STALE_ATTEMPT_MS = 3600_000;
/** The spooler document name of a kitchen ticket: a retry of the same ticket finds its copy still in a Windows queue. */
const jobName = (o: Pick<Order, 'number'>, kind: string, part = '') => `Mola fis ${o.number} ${kind}${part ? ` ${part.slice(0, 8)}` : ''}`;
/** Where a kitchen ticket was going, for the owner's Bildirim ("Masa 5 siparişi (#12) mutfağa basılamadı."). */
function orderPlace(s: State, o: Order) {
  const table = s.tables.find(t => t.id === s.accounts.find(a => a.id === o.accountId)?.tableId);
  return table?.takeaway ? `Masasız #${table.takeaway.number}` : table?.name ?? 'Masa';
}
/** `notify` (server/app.ts): one Bildirim for the owner (key unique; an existing key is not added again). */
export type PrintNotify = (tenant: string, key: string, title: string, text: string) => void;
/**
 * Prints kitchen tickets (tek mutfak: one printer) once an order may be prepared, a cancel slip if a printed order is
 * cancelled and a DEĞİŞİKLİK slip when a waiter changes a line of a printed order. Runs inside the business's local server:
 * it can reach printers on the café network.
 * A kitchen ticket that fails keeps `printProblems` on its order in both kitchen modes (11 Ekim): Fiş modu shows the red
 * warning on the floor, Ekran modu on the kitchen card; the owner gets one Bildirim per printer and problem ("Yazıcıda kâğıt
 * yok · Mutfak") until a print to that printer works again.
 */
export class PrintService {
  private tenants = new Set<string>();
  private busy = new Set<string>();
  private attempts = new Map<string, { count: number; next: number; tenant: string; orderId: string }>();
  /** `${tenant}:${printerId}` → the cause the owner was last told about; cleared by the next print that works. */
  private told = new Map<string, PrintCause>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  notify?: PrintNotify;
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
    const live = (printerId: string) => !!s.printers?.some(p => p.id === printerId && p.enabled);
    for (const o of s.orders) {
      if (Date.parse(o.createdAt) < since) continue;
      for (const part of o.cancellations ?? []) for (const printerId of part.printTo ?? []) if (live(printerId)) jobs.push({ tenant, orderId: o.id, printerId, kind: 'part', partId: part.id });
      if (o.status === 'cancelled') {
        if (!o.cancelPrinted && o.printedTo?.length) for (const printerId of o.printedTo) if (live(printerId)) jobs.push({ tenant, orderId: o.id, printerId, kind: 'cancel' });
        continue;
      }
      for (const change of o.changes ?? []) for (const printerId of change.printTo ?? []) if (live(printerId)) jobs.push({ tenant, orderId: o.id, printerId, kind: 'change', partId: change.id });
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
  /** The owner's Bildirim for a printer that needs a hand: once per printer and cause, again only after a print there worked. */
  private tell(tenant: string, printer: Pick<PrinterConfig, 'id' | 'name'>, cause: PrintCause, what: string) {
    const key = `${tenant}:${printer.id}`;
    if (this.told.get(key) === cause) return;
    this.told.set(key, cause);
    try { this.notify?.(tenant, `printer:${printer.id}:${cause}:${this.now().toISOString()}`, problemText(cause, printer.name), `${what} ${causeAdvice(cause)}`); } catch { /* printing goes on */ }
  }
  /** A print reached `printer`: its problem is over; a roll nearly out is said once a day. */
  private worked(tenant: string, printer: Pick<PrinterConfig, 'id' | 'name'>, result: SendResult | void) {
    this.told.delete(`${tenant}:${printer.id}`);
    if (!result?.low) return;
    try { this.notify?.(tenant, `printer-low:${printer.id}:${this.now().toISOString().slice(0, 10)}`, `Yazıcıda kâğıt azaldı · ${printer.name}`, 'Rulo bitmek üzere. Yeni ruloyu yazıcının yanına koyun; kâğıt bitince Mola “Yazıcıda kâğıt yok” diye uyarır.'); } catch { /* printing goes on */ }
  }
  private async run(job: Job) {
    const key = `${job.tenant}:${job.orderId}:${job.printerId}:${job.kind}:${job.partId ?? ''}`, attempt = this.attempts.get(key);
    if (this.busy.has(key) || (attempt && attempt.next > this.now().getTime())) return;
    const s = this.store.read(job.tenant), order = s.orders.find(o => o.id === job.orderId), printer = s.printers?.find(p => p.id === job.printerId);
    if (!order || !printer) return;
    const part = job.kind === 'part' ? order.cancellations?.find(c => c.id === job.partId) : undefined;
    const change = job.kind === 'change' ? order.changes?.find(c => c.id === job.partId) : undefined;
    if ((job.kind === 'part' && !part) || (job.kind === 'change' && !change)) return;
    const lines = part ? linesFor(s, printer, part.lines) : change ? order.lines : orderTargets(s, order).find(t => t.printer.id === printer.id)?.lines ?? [];
    if (!lines.length) { if (job.kind !== 'order') this.store.mutate(job.tenant, state => this.finish(state, job)); return; }
    const ticket = job.kind === 'order' ? kitchenTicket(s, order, printer, lines) : change ? changeTicket(s, order, printer, change) : cancelTicket(s, order, printer, lines, part);
    this.busy.add(key);
    try {
      const result = await this.send(printer.connection, ticketData(ticket, printer), { name: jobName(order, job.kind, job.partId) });
      this.attempts.delete(key); this.worked(job.tenant, printer, result);
      this.store.mutate(job.tenant, state => {
        const o = state.orders.find(v => v.id === job.orderId); if (!o) return;
        if (job.kind !== 'order') { this.finish(state, job); return; }
        printed(state, o, job.printerId);
      });
    } catch (e) {
      const count = (attempt?.count ?? 0) + 1, cause = faultOf(e);
      // The warning shows from the first failure (the kitchen is waiting); a retry that works clears it again.
      if (job.kind === 'order') this.store.mutate(job.tenant, state => { const o = state.orders.find(v => v.id === job.orderId); if (o) noteProblem(o, printer, cause, this.now()); });
      this.tell(job.tenant, printer, cause, `${orderPlace(s, order)} siparişinin (#${order.number}) ${job.kind === 'order' ? 'mutfak fişi' : job.kind === 'change' ? 'DEĞİŞİKLİK fişi' : 'İPTAL fişi'} basılamadı.`);
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
  /** A cancel or change slip is done (printed, or given up after the retries): never printed twice. */
  private finish(state: State, job: Job) {
    const o = state.orders.find(v => v.id === job.orderId); if (!o) return;
    if (job.kind === 'cancel') { o.cancelPrinted = true; return; }
    const part = job.kind === 'change' ? o.changes?.find(c => c.id === job.partId) : o.cancellations?.find(c => c.id === job.partId); if (!part) return;
    part.printTo = part.printTo?.filter(id => id !== job.printerId);
    if (!part.printTo?.length) delete part.printTo;
  }
  /**
   * A print asked for now (test slip, bill, receipt, kitchen reprint, cash closing). A printer problem comes back in staff
   * words with the printer's name ("Yazıcıda kâğıt yok · Kasa. Yeni rulo takın, sonra “Tekrar bas”a basın."); with
   * `about` the owner also gets the Bildirim.
   */
  async printNow(printer: PrinterConfig, ticket: Ticket, about?: { tenant: string; what: string; job?: string }) {
    try {
      const result = await this.send(printer.connection, ticketData(ticket, printer), about?.job ? { name: about.job } : undefined);
      if (about) this.worked(about.tenant, printer, result);
    } catch (e) {
      const cause = faultOf(e);
      if (about) this.tell(about.tenant, printer, cause, about.what);
      throw new PrinterFault(cause, `${problemText(cause, printer.name)}. ${causeAdvice(cause)}`);
    }
  }
  /**
   * Fiş modu warning → "Tekrar bas": prints the order on the kitchen printer now. `to` is the same printer, or the current
   * kitchen printer when the problem names another one (none was set, or the "Mutfak fişleri" role moved meanwhile); the
   * screens offer no "Başka yazıcıya bas" since there is one kitchen. On paper the problem is gone and the order may become
   * "Hazırlanıyor"; on failure the warning stays with the new cause and the caller gets it.
   */
  async printKitchen(tenant: string, orderId: string, printerId: string, to = printerId) {
    const key = `${tenant}:${orderId}:${printerId}:order:`;
    if (this.busy.has(key)) throw new DomainError('PRINT_BUSY', 'Fiş şu anda basılıyor. Birkaç saniye sonra bakın.', 409);
    const s = this.store.read(tenant), o = s.orders.find(v => v.id === orderId);
    if (!o || ['cancelled', 'served'].includes(o.status)) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı ya da artık mutfakta değil.', 404);
    const target = kitchenPrinters(s).find(p => p.id === to);
    if (!target) throw new DomainError('NOT_FOUND', 'Mutfak yazıcısı kapalı ya da kaldırılmış. Yazıcıyı kontrol edin ya da siparişi mutfağa söyleyip “Elle iletildi” deyin.', 404);
    // The lines that printer should have had (every line: tek mutfak), or the whole order when no printer takes them.
    const source = s.printers?.find(p => p.id === printerId), lines = source ? linesFor(s, source, o.lines) : o.lines;
    this.busy.add(key);
    try {
      const result = await this.send(target.connection, ticketData(kitchenTicket(s, o, target, lines.length ? lines : o.lines), target), { name: jobName(o, 'order') });
      this.attempts.delete(key); this.worked(tenant, target, result);
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
      this.store.mutate(tenant, state => { const order = state.orders.find(v => v.id === orderId); if (order) noteProblem(order, { id: printerId, name: target.name }, cause, this.now()); });
      throw new DomainError('PRINTER_FAULT', `Basılamadı: ${problemText(cause, target.name)}. ${cause === 'paper' || cause === 'cover' ? causeAdvice(cause) : 'Yazıcıyı kontrol edip tekrar deneyin ya da siparişi mutfağa söyleyip “Elle iletildi” deyin.'}`, 409);
    } finally { this.busy.delete(key); }
  }
  /**
   * The kitchen card's "Tekrar bas" (Ekran modu) and "Fişi yeniden yazdır": the whole order again, marked "Tekrar
   * yazdırıldı". A warning on the order clears once it printed; a failure keeps it with the new cause.
   */
  async reprint(tenant: string, orderId: string) {
    const s = this.store.read(tenant), order = s.orders.find(o => o.id === orderId && o.status !== 'cancelled' && o.status !== 'awaiting_approval');
    if (!order) throw new DomainError('NOT_FOUND', 'Sipariş bulunamadı.', 404);
    const targets = orderTargets(s, order);
    if (!targets.length) throw new DomainError('NO_PRINTER', 'Mutfak fişleri için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar’dan bir yazıcıyı “Mutfak fişleri” için seçin.', 409);
    for (const { printer, lines } of targets) {
      try { await this.printNow(printer, kitchenTicket(s, order, printer, lines, true), { tenant, what: `${orderPlace(s, order)} siparişinin (#${order.number}) mutfak fişi basılamadı.`, job: jobName(order, 'order') }); }
      catch (e) {
        this.store.mutate(tenant, state => { const o = state.orders.find(v => v.id === order.id); if (o) noteProblem(o, printer, faultOf(e), this.now()); });
        throw e;
      }
      this.store.mutate(tenant, state => { const o = state.orders.find(v => v.id === order.id); if (o) printed(state, o, printer.id); });
    }
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
/** Keeps the first failure's time (the warning sound rings once per problem), with the latest cause and the printer's name. */
function noteProblem(o: Order, printer: Pick<PrinterConfig, 'id' | 'name'>, cause: PrintCause, now: Date) {
  const current = o.printProblems?.find(p => p.printerId === printer.id);
  if (current) { current.cause = cause; current.printer = printer.name; return; }
  o.printProblems = [...(o.printProblems ?? []), { printerId: printer.id, cause, at: now.toISOString(), printer: printer.name }];
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
    // The kitchen card's "Tekrar bas" (Ekran modu) too: a warning on the order clears once it printed.
    await service.reprint(a.tenantId, orderId);
    res.json({ ok: true });
  });
  app.post('/api/staff/print/bill', async (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier']); throttle(a);
    const { accountId } = z.object({ accountId: z.string().min(1).max(100) }).parse(req.body);
    if (!s.accounts.some(v => v.id === accountId && v.status === 'open')) throw new DomainError('ACCOUNT_CLOSED', 'Hesap kapanmış.', 409);
    const printer = s.printers?.find(p => p.enabled && p.bill);
    if (!printer) throw new DomainError('NO_PRINTER', 'Hesap fişi için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar bölümünden ekleyin.', 409);
    const table = s.tables.find(t => t.id === s.accounts.find(v => v.id === accountId)?.tableId)?.name ?? 'Masa';
    await service.printNow(printer, billTicket(s, accountId, now()), { tenant: a.tenantId, what: `${table} hesap fişi basılamadı.` });
    res.json({ ok: true });
  });
  app.post('/api/staff/print/payment', async (req, res) => {
    const a = staffActor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner', 'manager', 'cashier']); throttle(a);
    const { paymentId } = z.object({ paymentId: z.string().min(1).max(100) }).parse(req.body);
    if (!s.payments.some(p => p.id === paymentId)) throw new DomainError('NOT_FOUND', 'Tahsilat bulunamadı.', 404);
    const printer = s.printers?.find(p => p.enabled && p.bill);
    if (!printer) throw new DomainError('NO_PRINTER', 'Fiş için yazıcı seçilmemiş. Ayarlar → Cihazlar → Yazıcılar bölümünden ekleyin.', 409);
    await service.printNow(printer, paymentTicket(s, paymentId, now()), { tenant: a.tenantId, what: 'Ödeme fişi basılamadı.' });
    res.json({ ok: true });
  });
}

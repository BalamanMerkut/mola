import { balances, changeDeadline, isOrderPaid } from './engine.js';
import { formatWeight } from './lines.js';
import { takeawayHeading } from './takeaway.js';
import { deliveryText, externalHeading } from './platforms.js';
import type { LineChange, Order, OrderLine, State } from './types.js';
import { changeSideText } from './lines.js';
import { productVat, receiptVat, vatSettings } from './vat.js';
import { dealOff, lineDealLabel, unitsCost } from './deals.js';

/** document: an ordinary office printer (laser / inkjet) that cannot read receipt-printer commands; it gets plain text through its own driver. */
export type PrinterConnection = { type: 'network'; host: string; port: number } | { type: 'windows'; printerName: string; document?: boolean };
export type PrinterConfig = {
  id: string; name: string; enabled: boolean; connection: PrinterConnection;
  width: 58 | 80; charset: 'ascii' | 'pc857';
  /**
   * "Mutfak fişleri" (tek mutfak, owner's decision 5 Oct): at most one printer holds this role and it prints every order.
   * `categories` is kept only so old data and old screens stay readable; routing ignores it and saving stores [].
   */
  orders: boolean; categories: string[];
  /** Customer bill summaries printed by the cashier. */
  bill: boolean;
  createdAt: string;
};

/** large: double width and height (titles). tall: double height only, keeps the full line width (items). */
type Op = { text: string; align?: 'left' | 'center'; bold?: boolean; large?: boolean; tall?: boolean } | { rule: true } | { pair: [string, string]; bold?: boolean } | { feed: number };
export type Ticket = Op[];

const timeFormat = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
export function printMoney(kurus: number) {
  const sign = kurus < 0 ? '-' : '', [whole, fraction] = (Math.abs(kurus) / 100).toFixed(2).split('.');
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction} TL`;
}

/** An order goes to paper when the kitchen may actually start it, so edits inside the change window do not waste paper. */
export function readyToPrint(s: State, o: Order, now: Date) {
  if (!['new', 'preparing', 'ready'].includes(o.status) || o.cancelRequested) return false;
  if (o.status === 'new' && now.getTime() < changeDeadline(o, s.changeSeconds)) return false;
  if (o.paymentBeforePreparation && o.status === 'new' && !isOrderPaid(s, o)) return false;
  return true;
}
/**
 * Tek mutfak (5 Oct): Elazığ cafés have one kitchen and no separate bar, so one printer holds "Mutfak fişleri" and gets
 * the whole order. Old data with several such printers (or category routing) is folded by `singleKitchen` below; until then
 * the first enabled one is the kitchen. Targets stay a list so the print service keeps its generic per-printer path.
 */
export const kitchenPrinter = (s: Pick<State, 'printers'>) => (s.printers ?? []).find(p => p.enabled && p.orders);
/** Which printer gets which lines: the kitchen printer, every line. */
export function orderTargets(s: State, o: Order) {
  const printer = kitchenPrinter(s);
  return printer && o.lines.length ? [{ printer, lines: o.lines }] : [];
}
/** The kitchen printer as a list (Fiş modu needs one; the snapshot sends it for "Tekrar bas"). */
export const kitchenPrinters = (s: Pick<State, 'printers'>) => { const p = kitchenPrinter(s); return p ? [p] : []; };
/** Shown once to the owner after old bar/kitchen routing was folded into one kitchen printer (Ayarlar → Yazıcılar). */
export type KitchenNotice = { kitchen: string; others: string[]; categories: boolean; at: string };
/**
 * Old installs: several "orders" printers (bar + kitchen) or category routing. Keeps one kitchen printer (an enabled one
 * that took every category, else one named "Mutfak", else the first enabled one, else the first) with every category; the others stop printing
 * orders (a bill role stays). Leaves `printerNotice` for the owner. Returns whether anything changed; repeatable.
 */
export function singleKitchen(s: State, now: Date) {
  const holders = (s.printers ?? []).filter(p => p.orders);
  const routed = (s.printers ?? []).some(p => p.categories?.length);
  if (holders.length <= 1 && !routed) return false;
  const live = holders.filter(p => p.enabled);
  const kitchen = live.find(p => !p.categories?.length) ?? live.find(p => /mutfak|kitchen/i.test(p.name)) ?? live[0] ?? holders[0];
  const others = holders.filter(p => p !== kitchen);
  s.printers = s.printers!.map(p => p === kitchen ? { ...p, categories: [] } : others.includes(p) ? { ...p, orders: false, categories: [] } : p.categories?.length ? { ...p, categories: [] } : p);
  if (kitchen) s.printerNotice = { kitchen: kitchen.name, others: others.map(p => p.name), categories: holders.some(p => p.categories?.length), at: now.toISOString() };
  return true;
}
/**
 * Mutfak fişi modu: once the kitchen printer has this order (or staff handled a failed print by hand, which leaves it in
 * printFailedTo without a problem), the kitchen is on it: "Hazırlanıyor" for the guest.
 * A table order whose bill already closed (paid while the ticket waited) is served at once, like the rest of that bill; a
 * masasız one waits at the counter for "Teslim et".
 */
export function settlePrinted(s: State, o: Order) {
  if (s.kitchenMode !== 'ticket' || o.status !== 'new' || o.printProblems?.length) return false;
  const handled = new Set([...(o.printedTo ?? []), ...(o.printFailedTo ?? [])]);
  // A printer added after the order never prints it (PrintService), so it is not waited for either.
  if (!orderTargets(s, o).every(t => handled.has(t.printer.id) || Date.parse(o.createdAt) < Date.parse(t.printer.createdAt))) return false;
  const account = s.accounts.find(a => a.id === o.accountId), counter = !!s.tables.find(t => t.id === account?.tableId)?.takeaway;
  o.status = account?.status === 'open' || counter ? 'preparing' : 'served'; o.version++;
  return true;
}
function tableName(s: State, o: Order) { return s.tables.find(t => t.id === s.accounts.find(a => a.id === o.accountId)?.tableId)?.name ?? s.archives.find(a => a.accountId === o.accountId)?.tableName ?? 'Masa'; }
/** Big table name; a masasız ticket reads "MASASIZ #12" and the name to call out, so it never goes to a table by mistake. */
function heading(s: State, o: Order): Op[] {
  // A delivery platform order: "YEMEKSEPETI #1234", the name to call out and how it leaves (kurye or gel-al).
  if (o.external) return [{ text: externalHeading(o.external), align: 'center', bold: true, large: true }, ...(o.external.customerName ? [{ text: o.external.customerName, align: 'center', bold: true } as Op] : []), { text: deliveryText(o.external), align: 'center' }, ...(o.external.note ? [{ text: `Not: ${o.external.note}`, align: 'center', bold: true } as Op] : [])];
  const ticket = s.tables.find(t => t.id === s.accounts.find(a => a.id === o.accountId)?.tableId)?.takeaway;
  if (!ticket) return [{ text: tableName(s, o), align: 'center', bold: true, large: true }];
  return [{ text: takeawayHeading(ticket.number), align: 'center', bold: true, large: true }, ...(ticket.label ? [{ text: ticket.label, align: 'center', bold: true } as Op] : []), { text: 'Tezgâhta teslim', align: 'center' }];
}
/** "2 x Latte", or "500 g Fıstıklı Baklava" for a weighed line. */
const itemName = (l: Pick<OrderLine, 'grams' | 'name'>, quantity: number) => l.grams ? `${formatWeight(l.grams)} ${l.name}` : `${quantity} x ${l.name}`;
/** `allPacked`: the heading already says PAKETLENECEK for every item, so the lines do not repeat it. */
function itemLines(lines: OrderLine[], allPacked = false): Ticket {
  // The guest's note is bold under the options, so it is not missed on a busy ticket; a packed item says so on its own line.
  return lines.flatMap(l => [{ text: itemName(l, l.quantity), bold: true, tall: true } as Op, ...(l.optionNames.length ? [{ text: `    ${l.optionNames.join(', ')}` } as Op] : []), ...(l.packed && !allPacked ? [{ text: '    [PAKET]', bold: true } as Op] : []), ...(l.note ? [{ text: `    Not: ${l.note}`, bold: true } as Op] : [])]);
}
export function kitchenTicket(s: State, o: Order, printer: PrinterConfig, lines: OrderLine[], reprint = false): Ticket {
  return [
    { text: printer.name.toLocaleUpperCase('tr-TR'), align: 'center', bold: true },
    ...heading(s, o),
    { text: `Sipariş #${o.number} · ${o.guestLabel}`, align: 'center' },
    { text: timeFormat.format(new Date(o.createdAt)) + (reprint ? ' · Tekrar yazdırıldı' : ''), align: 'center' },
    ...(o.tableMovedFrom ? [{ text: `Masa taşındı: ${o.tableMovedFrom}`, align: 'center' } as Op] : []),
    ...(o.updatedAt ? [{ text: 'Müşteri siparişi değiştirdi', align: 'center' } as Op] : []),
    // A table guest taking the order away: bold above the items, so it is packed rather than plated.
    ...(o.packed ? [{ text: '*** PAKETLENECEK ***', align: 'center', bold: true } as Op] : []),
    { rule: true }, ...itemLines(lines, !!o.packed), { rule: true },
  ];
}
/** `part`: only these items were cancelled (the rest of the order goes on); otherwise the whole order stops. */
export function cancelTicket(s: State, o: Order, printer: PrinterConfig, lines: OrderLine[], part?: { reason: string }): Ticket {
  const reason = part?.reason ?? o.cancelReason;
  return [
    { text: '*** İPTAL ***', align: 'center', bold: true, large: true },
    ...heading(s, o),
    { text: part ? `Sipariş #${o.number} · yalnız bu ürünler` : `Sipariş #${o.number} hazırlanmayacak`, align: 'center' },
    { text: printer.name.toLocaleUpperCase('tr-TR'), align: 'center' },
    ...(reason ? [{ text: `Neden: ${reason}`, align: 'center', bold: true } as Op] : []),
    { rule: true }, ...itemLines(lines), { rule: true },
  ];
}
/** A waiter changed one line after the order printed: "*** DEĞİŞİKLİK ***", what it was, what it is now, and the whole order as it stands. */
export function changeTicket(s: State, o: Order, printer: PrinterConfig, change: LineChange): Ticket {
  return [
    { text: '*** DEĞİŞİKLİK ***', align: 'center', bold: true, large: true },
    ...heading(s, o),
    { text: `Sipariş #${o.number} · ${timeFormat.format(new Date(change.at))}`, align: 'center' },
    { text: printer.name.toLocaleUpperCase('tr-TR'), align: 'center' },
    { rule: true },
    { text: `ESKİ: ${changeSideText(change.from)}` },
    ...(change.from.note ? [{ text: `    Not: ${change.from.note}` } as Op] : []),
    { text: `YENİ: ${changeSideText(change.to)}`, bold: true, tall: true },
    ...(change.to.note ? [{ text: `    Not: ${change.to.note}`, bold: true } as Op] : []),
    { rule: true },
    { text: 'Siparişin son hali:', align: 'left' },
    ...itemLines(o.lines), { rule: true },
  ];
}
/** The lines of `lines` this printer makes (same rule as orderTargets: tek mutfak, every line). */
export function linesFor(_s: State, _printer: PrinterConfig, lines: OrderLine[]) {
  return lines;
}
/** The bill's KDV line (packages/domain/vat.ts): "KDV dahildir · %10: 12,73 TL"; two rates on a second line so 58 mm fits. */
function billVat(s: State, lines: OrderLine[]): Op[] {
  const settings = vatSettings(s), parts = receiptVat(lines.map(l => ({ amount: l.total, rate: l.vatRate ?? productVat(s.products.find(p => p.id === l.productId), settings) })));
  if (!parts.length) return [];
  const text = parts.map(p => `%${p.rate}: ${printMoney(p.vat)}`).join(' · ');
  return parts.length === 1 ? [{ text: `KDV dahildir · ${text}`, align: 'center' }] : [{ text: 'KDV dahildir', align: 'center' }, { text, align: 'center' }];
}
/** Under a line its account campaigns, already taken off the line's amount: "  2 al 1 öde: -35 TL", "  Hediye: Americano: -110 TL". */
const dealLines = (l: OrderLine): Op[] => (l.deals ?? []).map(d => ({ text: `  ${lineDealLabel(d, l.name)}: ${printMoney(-d.units * d.off)}` }));
/** Informational bill for the guest. Not a fiscal receipt: the cash register still issues that. */
export function billTicket(s: State, accountId: string, now: Date): Ticket {
  const account = s.accounts.find(a => a.id === accountId)!;
  const table = s.tables.find(t => t.id === account.tableId)?.name ?? 'Masa';
  const orders = s.orders.filter(o => o.accountId === accountId && !['cancelled', 'awaiting_approval'].includes(o.status));
  const { total, paid, balance, depositCredit = 0 } = balances(s, accountId);
  const discount = orders.flatMap(o => o.lines).reduce((n, l) => n + ((l.originalUnitPrice ?? l.unitPrice) - l.unitPrice) * l.quantity + dealOff(l), 0);
  return [
    { text: s.name, align: 'center', bold: true, large: true },
    // Only information on the slip (11 Ekim, sahibin kararı): a two-word title tells it from a fiscal receipt, no legal sentences.
    { text: 'BİLGİ FİŞİ', align: 'center', bold: true },
    { text: `${table} · ${dateFormat.format(now)}`, align: 'center' },
    // The seated reservation's name, so staff and guest see whose bill it is.
    ...(account.guest?.name ? [{ text: account.guest.name, align: 'center' } as Op] : []),
    { rule: true },
    ...orders.flatMap(o => o.lines).flatMap(l => [{ pair: [itemName(l, l.quantity), printMoney(l.total)] } as Op, ...(l.optionNames.length ? [{ text: `  ${l.optionNames.join(', ')}` } as Op] : []), ...dealLines(l)]),
    { rule: true },
    ...(discount > 0 ? [{ pair: ['Kampanya indirimi', printMoney(-discount)] } as Op] : []),
    { pair: ['TOPLAM', printMoney(total)], bold: true },
    ...(depositCredit > 0 ? [{ pair: ['Kapora', printMoney(-depositCredit)] } as Op] : []),
    ...(paid > 0 || depositCredit > 0 ? [...(paid > 0 ? [{ pair: ['Ödenen', printMoney(paid)] } as Op] : []), { pair: ['KALAN', printMoney(balance)], bold: true } as Op] : []),
    { rule: true },
    ...billVat(s, orders.flatMap(o => o.lines)),
  ];
}
/** Receipt for one recorded payment (cash or card). Informational, like the bill. */
export function paymentTicket(s: State, paymentId: string, now: Date): Ticket {
  const index = s.payments.findIndex(p => p.id === paymentId), payment = s.payments[index];
  const account = s.accounts.find(a => a.id === payment.accountId)!;
  const table = s.tables.find(t => t.id === account.tableId)?.name ?? s.archives.find(a => a.accountId === account.id)?.tableName ?? 'Masa';
  const orders = s.orders.filter(o => o.accountId === account.id && !['cancelled', 'awaiting_approval'].includes(o.status));
  const earlier = s.payments.slice(0, index).filter(p => p.accountId === account.id);
  // A seated reservation's kapora also pays the bill (as a payment once the bill closed, as a credit before).
  const deposit = account.deposit ? account.deposit.paymentId ? s.payments.find(p => p.id === account.deposit!.paymentId && p.id !== payment.id && !earlier.includes(p))?.amount ?? 0 : balances(s, account.id).depositCredit ?? 0 : 0;
  const remaining = balances(s, account.id).total - earlier.reduce((n, p) => n + p.amount, 0) - payment.amount - deposit;
  const itemLine = (line: OrderLine, quantity: number, total: number, deals: Op[] = []) => [{ pair: [itemName(line, quantity), printMoney(total)] } as Op, ...(line.optionNames.length ? [{ text: `  ${line.optionNames.join(', ')}` } as Op] : []), ...deals];
  // Pieces of a line with free ones (deals.ts) were charged full-price ones first: what earlier payments took counts.
  const before = (sel: { orderId: string; lineId: string }) => earlier.flatMap(p => p.selections ?? []).filter(x => x.orderId === sel.orderId && x.lineId === sel.lineId).reduce((n, x) => n + x.quantity, 0);
  // Item lines only when they are known: chosen items, or the single payment that settled the whole bill.
  const items: Op[] = payment.selections
    ? payment.selections.flatMap(sel => { const line = orders.find(o => o.id === sel.orderId)?.lines.find(l => l.id === sel.lineId); return line ? itemLine(line, sel.quantity, unitsCost(line, before(sel), sel.quantity)) : []; })
    : !earlier.length && remaining === 0 ? orders.flatMap(o => o.lines).flatMap(l => itemLine(l, l.quantity, l.total, dealLines(l)))
    : [{ text: 'Hesap tutarından kısmi ödeme' }];
  return [
    { text: s.name, align: 'center', bold: true, large: true },
    { text: 'BİLGİ FİŞİ', align: 'center', bold: true },
    { text: `${table} · ${dateFormat.format(new Date(payment.createdAt))}`, align: 'center' },
    { rule: true }, ...items, { rule: true },
    { pair: ['ÖDENEN', printMoney(payment.amount)], bold: true },
    { pair: ['Ödeme şekli', payment.method === 'cash' ? 'Nakit' : payment.method === 'platform' ? 'Platform ödemesi' : 'Kart'] },
    ...(payment.method === 'cash' ? [{ pair: ['Alınan nakit', printMoney(payment.tendered)] } as Op, { pair: ['Para üstü', printMoney(payment.change)] } as Op] : []),
    { pair: ['Kalan hesap', printMoney(Math.max(0, remaining))] },
    ...(now.getTime() - Date.parse(payment.createdAt) > 10 * 60000 ? [{ text: `Tekrar yazdırıldı · ${dateFormat.format(now)}`, align: 'center' } as Op] : []),
  ];
}
export function testTicket(printer: PrinterConfig, business: string, now: Date): Ticket {
  return [
    { text: 'DENEME FİŞİ', align: 'center', bold: true, large: true },
    { text: business, align: 'center' },
    { text: `${printer.name} · ${printer.width} mm`, align: 'center' },
    { text: dateFormat.format(now), align: 'center' },
    { rule: true },
    { text: 'Türkçe karakter kontrolü:' },
    { text: 'ÇçĞğİıÖöŞşÜü', bold: true },
    { text: printer.charset === 'pc857' ? 'Harfler bozuksa ayarlardan "Türkçe karakter kullanma" seçeneğini deneyin.' : 'Türkçe harfler sade yazılır (ç yerine c gibi).' },
    { rule: true },
    { text: 'Bu fişi görüyorsanız yazıcı hazır.', align: 'center' },
  ];
}

const plain: Record<string, string> = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U', '·': '-', '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' };
// Code page 857 (Turkish), selected on the printer with ESC t 13 (Epson numbering, followed by most clones).
const cp857: Record<string, number> = { Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ç: 0x87, ı: 0x8d, ö: 0x94, İ: 0x98, Ö: 0x99, Ü: 0x9a, Ş: 0x9e, ş: 0x9f, Ğ: 0xa6, ğ: 0xa7 };
function encodeText(text: string, charset: PrinterConfig['charset']) {
  const bytes: number[] = [];
  for (const char of text) {
    if (charset === 'pc857' && cp857[char] !== undefined) { bytes.push(cp857[char]); continue; }
    const simple = plain[char] ?? char.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const c of simple) bytes.push(c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 ? c.charCodeAt(0) : 0x3f);
  }
  return bytes;
}
function wrap(text: string, width: number): string[] {
  const indent = text.match(/^ */)![0];
  if (indent && indent.length < width / 2) return wrap(text.slice(indent.length), width - indent.length).map(l => indent + l);
  const out: string[] = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let rest = word; rest.length;) {
      const room = line ? width - line.length - 1 : width;
      if (rest.length <= room) { line = line ? `${line} ${rest}` : rest; rest = ''; }
      else if (line) { out.push(line); line = ''; }
      else { out.push(rest.slice(0, width)); rest = rest.slice(width); }
    }
  }
  return [...out, line].filter((l, i, all) => l || all.length === 1);
}
export function columns(printer: Pick<PrinterConfig, 'width'>) { return printer.width === 58 ? 32 : 48; }
/** Plain text, exactly as laid out on paper. Used for previews and tests. */
export function renderText(ticket: Ticket, printer: Pick<PrinterConfig, 'width'>) {
  const cols = columns(printer); const out: string[] = [];
  for (const op of ticket) {
    if ('rule' in op) out.push('-'.repeat(cols));
    else if ('feed' in op) for (let i = 0; i < op.feed; i++) out.push('');
    else if ('pair' in op) {
      const [left, right] = op.pair, room = cols - right.length - 1;
      const wrapped = wrap(left, Math.max(8, room)), last = wrapped.pop()!;
      out.push(...wrapped);
      if (last.length <= room) out.push(last + ' '.repeat(cols - last.length - right.length) + right);
      else out.push(last, ' '.repeat(Math.max(0, cols - right.length)) + right);
    } else {
      const width = op.large ? Math.floor(cols / 2) : cols;
      for (const l of wrap(op.text, width)) out.push(op.align === 'center' ? ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l : l);
    }
  }
  return out;
}
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
export function encodeEscPos(ticket: Ticket, printer: Pick<PrinterConfig, 'width' | 'charset'>) {
  const cols = columns(printer); const bytes: number[] = [ESC, 0x40];
  if (printer.charset === 'pc857') bytes.push(ESC, 0x74, 13);
  for (const op of ticket) {
    if ('rule' in op) { bytes.push(...encodeText('-'.repeat(cols), 'ascii'), LF); continue; }
    if ('feed' in op) { bytes.push(ESC, 0x64, op.feed); continue; }
    const bold = 'bold' in op && !!op.bold, large = 'large' in op && !!op.large, tall = 'tall' in op && !!op.tall;
    bytes.push(ESC, 0x61, 'align' in op && op.align === 'center' ? 1 : 0, ESC, 0x45, bold ? 1 : 0, GS, 0x21, large ? 0x11 : tall ? 0x01 : 0);
    const text = 'pair' in op ? renderText([op], printer) : wrap(op.text, large ? Math.floor(cols / 2) : cols);
    for (const line of text) bytes.push(...encodeText(line, printer.charset), LF);
    bytes.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
  }
  // Feed past the tear bar, then partial cut. Printers without a cutter ignore the cut command.
  bytes.push(ESC, 0x64, 4, GS, 0x56, 1);
  return Uint8Array.from(bytes);
}

import type { Expense } from './types.js';
import { countedExpense, expenseAt, fromDrawer } from './expense-rules.js';
import { depositTotals, type DepositFlow } from './reservations.js';
import { businessDay, dayStart, DAY_START_HOUR } from './business-day.js';

/*
 * Gün sonu kasa kapanışı: plain rules shared by the screens, the reports and the server (no server-only imports, so the
 * browser bundle can use them). Money is in kuruş. The server (server/cash-closing.ts) keeps the records sealed.
 *
 * A cash window starts at the previous closing (a day's final closing or a mid-day "vardiya devri") or, the very first
 * time, at the first confirmed opening. Its expected drawer amount is
 *   opening + cash sales − cash refunds − cash expenses + owner put in − owner took out + cash tips.
 * "Para bozdurma" (exchange) changes no amount: money in equals money out, so it cannot hide a shortage.
 */

/**
 * The cash day turns at 05:00 Turkish time, like the staff sessions (server/sessions.ts). It is the business day of every
 * report too: one constant, DAY_START_HOUR in packages/domain/business-day.ts.
 */
export const CASH_DAY_START_HOUR = DAY_START_HOUR;
/** Kasa günü of a moment: the Turkish date of (time − 05:00), so a closing at 01:30 belongs to the evening before. */
export const cashDayOf = (at: number | string) => businessDay(at);
/** 05:00 Turkish time on that cash day. */
export const cashDayStart = (day: string) => dayStart(day);

export type TipRule = 'equal' | 'hours' | 'orders';
export const tipRuleNames: Record<TipRule, string> = { equal: 'Eşit', hours: 'Çalışılan saate göre', orders: 'Siparişi alan garsona' };
/** Planned shift of one employee: "09:00"–"17:00" on the given weekdays (1 = Monday … 7 = Sunday). */
export type ShiftPlan = { start: string; end: string; days: number[] };
/** Ayarlar → Kasa ve vardiya (owner). Every field is optional; missing = off / default. */
export type CashShiftSettings = {
  /** Kasiyerin nakit gider uyarı sınırı: a cashier's cash expense above it notifies the owner at once. null/missing = off. */
  expenseAlert?: number | null;
  /** "Gün içinde toplam": a cashier's cash expenses of one cash day above it notify the owner once, again each time the total doubles. null/missing = off. */
  expenseDayAlert?: number | null;
  /** "Kasiyerin yapabileceği en yüksek iade" (one refund, kuruş; 0 = the cashier refunds nothing alone) and the cashier's daily refund total (packages/domain/refund-rules.ts defaults). */
  cashierRefundMax?: number;
  cashierRefundDay?: number;
  /** Kapanış saati ("23:00"): after it, the last closed bill reminds the counter to close the day. */
  closingTime?: string | null;
  /** A closing difference above this needs a note (kuruş). Missing = DEFAULT_DIFFERENCE_NOTE. */
  differenceNote?: number;
  shiftTracking?: boolean;
  /** Vardiya takibi turned on "Bir sonraki girişte" (9 Ekim K-B): sign-ins made before this moment are not asked for the code. */
  shiftTrackingFrom?: string;
  /** Which roles must start a shift while vardiya takibi is on (packages/domain/shifts.ts shiftRequired). Missing = all of them. */
  shiftRoles?: ('waiter' | 'cashier' | 'kitchen' | 'manager')[];
  tipRule?: TipRule;
  plans?: Record<string, ShiftPlan>;
  /** "Yazar kasa yardımcısı" (packages/domain/fiscal.ts): missing = on. "Ödemeden sonra 'Girildi' onayı iste": missing = off. */
  fiscalHelper?: boolean;
  fiscalConfirm?: boolean;
  /** "Kart bahşişini kasadan nakit öde" (8 Ekim, K2): a card tip asks at payment whether the waiter got it in cash from the drawer; "Evet" records a "Kart bahşişi nakit ödendi" movement. Missing = off. */
  tipCashOut?: boolean;
};
export const DEFAULT_DIFFERENCE_NOTE = 5000;
export const differenceLimit = (s?: CashShiftSettings) => s?.differenceNote ?? DEFAULT_DIFFERENCE_NOTE;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Banknotes and coins a counter can enter one by one (kuruş): 200 TL … 5 kuruş. */
export const DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25, 10, 5] as const;
export const denominationName = (v: number) => v >= 100 ? `${v / 100} TL` : `${v} kr`;
/** Total of a count given as { "20000": 3, "5000": 2 }; unknown values or bad counts make it NaN. */
export function countTotal(counts: Record<string, number>) {
  let total = 0;
  for (const [value, n] of Object.entries(counts)) {
    if (!(DENOMINATIONS as readonly number[]).includes(Number(value)) || !Number.isSafeInteger(n) || n < 0 || n > 100_000) return NaN;
    total += Number(value) * n;
  }
  return total;
}

export type CashMovementKind = 'exchange' | 'owner_in' | 'owner_took' | 'bank' | 'other_out' | 'tip_out';
export const movementNames: Record<CashMovementKind, string> = { exchange: 'Para bozdurma', owner_in: 'Kasaya para kondu', owner_took: 'Sahip aldı', bank: 'Bankaya yatırıldı', other_out: 'Diğer çıkış', tip_out: 'Kart bahşişi nakit ödendi' };
/** Real money in or out: only the owner's account may record these; the cashier has exchange and expenses only. */
export const OWNER_MOVEMENTS: CashMovementKind[] = ['owner_took', 'bank', 'other_out', 'owner_in'];
export const movementSign = (k: CashMovementKind) => k === 'owner_in' ? 1 : k === 'exchange' ? 0 : -1;

type Who = { by: string; byName: string; role: 'owner' | 'manager' | 'cashier' };
/** "Kasa açılışı": the float counted in the morning. `carried`: what the last closing left in the drawer (null the first time). */
export type CashOpening = Who & { id: string; kind: 'opening'; at: string; day: string; carried: number | null; amount: number; difference: number; note?: string };
export type CashMovement = Who & { id: string; kind: 'movement'; type: CashMovementKind; at: string; day: string; amount: number; note?: string };
/** A cash expense paid from the drawer during the window, as the closing saw it. */
export type CashExpenseLine = { id: string; at: string; amount: number; description: string; byName: string };
export type CashFigures = {
  opening: number; cashSales: number; cashRefunds: number; cashExpenses: number; ownerIn: number; ownerOut: number; exchanges: number; cashTips: number; expected: number;
  /** Card tips handed to the waiter in cash from the drawer ("Kart bahşişi nakit ödendi", K2). Missing = none. */
  tipsPaidOut?: number;
  cardSales: number; cardTips: number; cardRefunds: number; card: number; platform: number; payments: number;
  /** Rezervasyon kaporası (packages/domain/reservations.ts): cash taken / given back in the window, and the card net. Missing on
   * closings made before reservations; a kapora that later paid a bill is never counted again as a sale. */
  deposits?: number; depositRefunds?: number; cardDeposits?: number;
  /** The part of `cashRefunds` a cashier gave back (its own line in the closing); missing when none. */
  cashierRefunds?: number;
  /** Cash expenses of the window paid "Kasa dışından" (not in the formula; shown so the owner sees where they went). */
  outsideExpenses?: number;
};
/** A refund given back during the window (cash or card), as the closing saw it: who, how much, what for. */
export type CashRefundLine = { id: string; at: string; amount: number; method: 'cash' | 'card'; byName: string; cashier: boolean; text: string };
/**
 * One count: a day's final closing ("Gün sonu") or a mid-day handover between cashiers ("Vardiya devri"). Saved as soon as the
 * blind count is entered (`counted`, the figures are fixed then); `closed` once the note and the amount left are given.
 * Never changed after that: the owner adds CashCorrection entries.
 */
export type CashClosing = Who & {
  id: string; kind: 'closing'; mode: 'final' | 'handover'; status: 'counted' | 'closed'; day: string;
  from: string; to: string; closedAt?: string;
  counted: number; denominations?: Record<string, number>; pos: number | null;
  figures: CashFigures; difference: number; cardDifference: number | null;
  /** The window had no confirmed opening: the carried amount was used. */
  unconfirmedOpening?: boolean;
  note?: string; left?: number; taken?: number; closedBy?: string;
  movements: CashMovement[]; expenses: CashExpenseLine[]; shiftsEnded?: number;
  /** Refunds of the window (missing on older closings and when there were none). */
  refunds?: CashRefundLine[];
  /** A second gün sonu of the same cash day (sales went on after the first one): "Ek kapanış". */
  extra?: boolean;
  /** "Yazar kasa karşılaştırması" (packages/domain/fiscal.ts): what should be on the yazar kasa for this window; missing on
   * older closings and while the helper is off. The "not entered" list is read again when the closing is finished. */
  fiscal?: import('./fiscal.js').CashFiscal;
  /** The Z raporu typed when finishing (optional) and its difference from `fiscal`. */
  fiscalZ?: import('./fiscal.js').FiscalZ;
};
/**
 * Who sees the result of a count (owner's decision, 8 Ekim): only the işletme sahibi. The cashier and the Müdür count blind
 * and stay blind afterwards: the server never sends them the expected cash, the difference or the card difference of a
 * count (POST /cash/count, /cash/finish, GET /cash/closing/:id, the slip). The Müdür still reads Kasa kapanışları in Satış ve
 * Raporlar, behind the report code like every report (5 Ekim role table).
 */
export const seesCashResult = (role: string) => role === 'owner';
/** A closing as the counter (cashier, Müdür) gets it back: what they typed and what they must enter on the yazar kasa. */
export type BlindClosing = Pick<CashClosing, 'id' | 'kind' | 'mode' | 'status' | 'day' | 'from' | 'to' | 'closedAt' | 'counted' | 'denominations' | 'pos' | 'note' | 'left' | 'taken' | 'closedBy' | 'extra' | 'fiscal' | 'fiscalZ' | 'shiftsEnded' | 'by' | 'byName' | 'role'> & { blind: true };
export type ClosingView = CashClosing | BlindClosing;
export const isBlind = (c: ClosingView): c is BlindClosing => 'blind' in c && c.blind === true;
export function blindClosing(c: CashClosing): BlindClosing {
  const { id, kind, mode, status, day, from, to, closedAt, counted, denominations, pos, note, left, taken, closedBy, extra, fiscal, fiscalZ, shiftsEnded, by, byName, role } = c;
  return Object.fromEntries(Object.entries({ id, kind, mode, status, day, from, to, closedAt, counted, denominations, pos, note, left, taken, closedBy, extra, fiscal, fiscalZ, shiftsEnded, by, byName, role, blind: true }).filter(([, v]) => v !== undefined)) as BlindClosing;
}
export const closingFor = (c: CashClosing, role: string): ClosingView => seesCashResult(role) ? c : blindClosing(c);
/**
 * Why the expected cash is below zero, in plain words (owner only): more cash went out "from the drawer" than came in.
 * Either the opening was written too low, or part of those expenses was really paid from outside the drawer.
 */
export function negativeExpectedText(f: Pick<CashFigures, 'expected' | 'cashExpenses'>, money: (k: number) => string) {
  if (f.expected >= 0) return '';
  return `Beklenen nakit eksi çıktı: kayıtlara göre kasadan, kasaya girenden ${money(-f.expected)} fazla nakit çıktı. Kasadan ödendi yazılan giderlerin (${money(f.cashExpenses)}) bir kısmı kasa dışından (cepten / bankadan) ödendiyse Kasa ve giderler → Giderler'de "Kasa dışı nakit" olarak düzeltin; açılış tutarı eksik yazıldıysa farkın nedeni odur.`;
}
export type CashCorrection = Who & { id: string; kind: 'correction'; closingId: string; at: string; day: string; amount: number; note: string };
/** A tip taken with a payment ("Bahşiş"); not a sale. `takers`: staff who took the account's orders, with their order amounts. */
export type TipRecord = { id: string; kind: 'tip'; paymentId: string; at: string; day: string; amount: number; method: 'cash' | 'card'; takers: [string, number][]; byName?: string };
export type CashRecord = CashOpening | CashMovement | CashClosing | CashCorrection | TipRecord | import('./fiscal.js').FiscalMark;

/** Opening + cash sales − cash refunds − cash expenses + owner in − owner out + cash tips + cash kapora − kapora given back in cash. */
export function expectedCash(f: Pick<CashFigures, 'opening' | 'cashSales' | 'cashRefunds' | 'cashExpenses' | 'ownerIn' | 'ownerOut' | 'cashTips' | 'deposits' | 'depositRefunds' | 'tipsPaidOut'>) {
  return f.opening + f.cashSales - f.cashRefunds - f.cashExpenses + f.ownerIn - f.ownerOut + f.cashTips + (f.deposits ?? 0) - (f.depositRefunds ?? 0) - (f.tipsPaidOut ?? 0);
}
export type WindowRecords = {
  /** `deposit`: the kapora part of a bill (Payment.deposit); its money is counted when the kapora was taken, never here. */
  payments: Iterable<{ method: string; amount: number; createdAt: string; deposit?: unknown }>;
  /** Kapora taken ('in') and given back ('out'), by when the money moved (reservations.ts depositFlows). */
  deposits?: Iterable<DepositFlow>;
  /** `role`/`byName`: who gave it back (a cashier's refund is its own line); `text`: the items or the reason, for the list. */
  refunds: Iterable<{ id?: string; kind: string; method: string; amount: number; createdAt: string; role?: string; byName?: string; text?: string }>;
  expenses: Iterable<Expense>;
  movements: Iterable<CashMovement>;
  tips: Iterable<TipRecord>;
};
/**
 * Which expenses came out of the drawer: cash (or older records without a method), still counted, dated inside the window,
 * and not an "Otomatik gider" (those are the owner's planned bills, written at 00:00 whether or not the drawer paid them).
 */
export const drawerExpense = (e: Expense, from: number, to: number) => countedExpense(e) && fromDrawer(e) && inside(expenseAt(e), from, to);
/** A cash expense of the window paid "Kasa dışından": shown beside the formula, never in it. */
const outsideExpense = (e: Expense, from: number, to: number) => countedExpense(e) && (e.method ?? 'cash') === 'cash' && e.source === 'outside' && !e.auto && inside(expenseAt(e), from, to);
const inside = (at: string, from: number, to: number) => { const t = Date.parse(at); return t >= from && t < to; };
/** The figures of one window [from, to). */
export function windowFigures(opening: number, r: WindowRecords, from: number, to: number): { figures: CashFigures; expenses: CashExpenseLine[]; movements: CashMovement[]; refunds: CashRefundLine[] } {
  let cashSales = 0, cardSales = 0, platform = 0, payments = 0, cashRefunds = 0, cardRefunds = 0, cashTips = 0, cardTips = 0, ownerIn = 0, ownerOut = 0, exchanges = 0, cashierRefunds = 0, tipsPaidOut = 0;
  for (const p of r.payments) if (inside(p.createdAt, from, to)) {
    if (p.deposit) continue;
    payments++;
    if (p.method === 'cash') cashSales += p.amount; else if (p.method === 'card') cardSales += p.amount; else platform += p.amount;
  }
  const refunds: CashRefundLine[] = [];
  for (const a of r.refunds) if (a.kind === 'refund' && inside(a.createdAt, from, to)) {
    const cashier = a.role === 'cashier';
    if (a.method === 'cash') { cashRefunds += a.amount; if (cashier) cashierRefunds += a.amount; } else cardRefunds += a.amount;
    refunds.push({ id: a.id ?? `${a.createdAt}:${refunds.length}`, at: a.createdAt, amount: a.amount, method: a.method === 'cash' ? 'cash' : 'card', byName: a.byName ?? 'Kayıtlı kullanıcı', cashier, text: a.text ?? '' });
  }
  refunds.sort((a, b) => a.at.localeCompare(b.at));
  const allExpenses = [...r.expenses];
  const expenses = allExpenses.filter(e => drawerExpense(e, from, to)).sort((a, b) => expenseAt(a).localeCompare(expenseAt(b)))
    .map(e => ({ id: e.id, at: expenseAt(e), amount: e.amount, description: e.description, byName: e.actorName }));
  const movements = [...r.movements].filter(m => inside(m.at, from, to)).sort((a, b) => a.at.localeCompare(b.at));
  for (const m of movements) { const sign = movementSign(m.type); if (m.type === 'tip_out') tipsPaidOut += m.amount; else if (sign > 0) ownerIn += m.amount; else if (sign < 0) ownerOut += m.amount; else exchanges += m.amount; }
  for (const t of r.tips) if (inside(t.at, from, to)) { if (t.method === 'cash') cashTips += t.amount; else cardTips += t.amount; }
  const cashExpenses = expenses.reduce((n, e) => n + e.amount, 0);
  const outsideCash = allExpenses.filter(e => outsideExpense(e, from, to)).reduce((n, e) => n + e.amount, 0);
  const d = depositTotals(r.deposits ? [...r.deposits].filter(f => inside(f.at, from, to)) : []), cardDeposits = d.cardIn - d.cardOut;
  const kapora = d.cashIn || d.cashOut || cardDeposits ? { deposits: d.cashIn, depositRefunds: d.cashOut, cardDeposits } : {};
  const base = { opening, cashSales, cashRefunds, cashExpenses, ownerIn, ownerOut, cashTips, ...kapora, ...(tipsPaidOut ? { tipsPaidOut } : {}) };
  return { figures: { ...base, exchanges, expected: expectedCash(base), cardSales, cardTips, cardRefunds, card: cardSales + cardTips - cardRefunds + cardDeposits, platform, payments, ...(cashierRefunds ? { cashierRefunds } : {}), ...(outsideCash ? { outsideExpenses: outsideCash } : {}) }, expenses, movements, refunds };
}
/** A difference this large needs a written note before the closing is saved. */
export const needsNote = (difference: number, settings?: CashShiftSettings) => Math.abs(difference) > differenceLimit(settings);
/** The difference after the owner's corrections. */
export const correctedDifference = (c: Pick<CashClosing, 'difference'>, corrections: Pick<CashCorrection, 'amount'>[]) => c.difference + corrections.reduce((n, x) => n + x.amount, 0);

/** GET /api/staff/cash/status (owner, cashier): never an expected amount, so a count stays blind. */
export type CashStatus = {
  today: string;
  /** Anything sold since the running window's day opened (no amount): the closing-time reminder waits for a first sale. */
  sold?: boolean;
  /** Today's gün sonu is done but the floor kept selling after it: the strip asks for one more closing. */
  afterClose?: boolean;
  /** The running window began with a "Vardiya devri": when, by whom, and the amount handed over. */
  handover?: { at: string; byName: string; amount: number } | null;
  settings: { closingTime: string | null; differenceNote: number; shiftTracking: boolean; expenseAlert?: number | null };
  /** Start of the running window (previous closing or the first opening); null before anything was recorded. */
  start: string | null;
  opening: { amount: number; confirmed: boolean; at?: string; byName?: string; note?: string };
  carried: number | null;
  /** Today's opening still waits for its confirmation (shown from 05:00 after the last final closing). */
  showOpening: boolean;
  /** The window was opened on an earlier cash day and never closed: "Dünün kasası kapanmadı". */
  unclosedPrevious: { day: string } | null;
  closedToday: { at: string; byName: string } | null;
  /** A blind count already saved and waiting for its note / amount left; it must be finished first. */
  draft: { id: string; byName: string; countedAt: string; mode: 'final' | 'handover'; mine: boolean } | null;
  movements: CashMovement[];
};

/** One person's closings over a period: how often and how much the drawer was short or over (spotting patterns). */
export type CloserSummary = { by: string; byName: string; count: number; total: number; short: number; over: number; shortCount: number; overCount: number; largestShort: number };
export function closerSummaries(closings: (Pick<CashClosing, 'by' | 'byName' | 'difference' | 'status'> & { corrected?: number })[]) {
  const rows = new Map<string, CloserSummary>();
  for (const c of closings) {
    let r = rows.get(c.by); if (!r) rows.set(c.by, r = { by: c.by, byName: c.byName, count: 0, total: 0, short: 0, over: 0, shortCount: 0, overCount: 0, largestShort: 0 });
    const d = c.corrected ?? c.difference; r.byName = c.byName; r.count++; r.total += d;
    if (d < 0) { r.short += -d; r.shortCount++; r.largestShort = Math.max(r.largestShort, -d); } else if (d > 0) { r.over += d; r.overCount++; }
  }
  return [...rows.values()].sort((a, b) => b.short - a.short || a.byName.localeCompare(b.byName, 'tr'));
}

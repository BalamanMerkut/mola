// "5 yıllık hız ve hata testi", step 3 (server stopped): the server's own books against the generator's (beklenen.json)
// day by day and year by year, KDV, gün sonu kapanışları, stok; then the verified backup, a restore into a new folder with
// the same totals, the e-mail period reports and the phone report, timed. Throwaway folders only.
//   npx tsx scripts/bes-yil-dogrula.ts --profil=orta|yogun [--kok=<klasör>] [--atla=yedek]
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { dataLock } from '../server/data-lock.js';
import { StockBook } from '../server/stock.js';
import { CashBook } from '../server/cash-closing.js';
import { ShiftBook } from '../server/shifts.js';
import { createVerifiedBackup } from '../server/verified-backup.js';
import { restoreBackup } from '../server/backup.js';
import { htmlToPdf } from '../server/pdf-print.js';
import { buildPeriodReport, periodOf, rangePeriod, reportHtml, type PeriodKind } from '../server/email-reports-content.js';
import { reportAttachment } from '../server/email-reports.js';
import { addDays, businessDay, dayStart, DAY_MS } from '../packages/domain/business-day.js';
import { mergeTotals, type Totals } from '../packages/domain/history.js';
import { financialFrom, overviewFrom, openBalance, previousRange, reportRange } from '../packages/domain/reports.js';
import { stockLevels, productStock } from '../packages/domain/stock.js';
import type { CashClosing } from '../packages/domain/cash.js';
import type { Profile } from './bes-yil-veri.js';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const profile = option('profil', 'orta') as Profile, skip = new Set((option('atla', '') ?? '').split(',').filter(Boolean));
const root = resolve(option('kok', join(tmpdir(), 'mola-bes-yil'))!), home = join(root, profile), directory = join(home, 'veri'), TENANT = 'mola-demo';
if (!existsSync(join(home, 'BES_YIL_TESTI.txt'))) { console.error('Önce üretin.'); process.exit(1); }
type DayBook = Record<string, number>;
const expected = JSON.parse(readFileSync(join(home, 'beklenen.json'), 'utf8')) as { firstDay: string; lastDay: string; today: string; days: Record<string, DayBook>; onHand: Record<string, number>; stockAt?: string; liveDay?: string };
const out: Record<string, unknown> = { profile, at: new Date().toISOString() };
const save = () => writeFileSync(join(home, 'dogrulama.json'), JSON.stringify(out, null, 1));
const ms = (t: number) => Math.round(performance.now() - t);
const log = (text: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const folderMb = (dir: string): number => existsSync(dir) ? Math.round(readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? folderMb(join(dir, e.name)) * 1048576 : statSync(join(dir, e.name)).size), 0) / 1048576 * 10) / 10 : 0;
/** Money is kept in whole kuruş: every amount must be a safe integer (no NaN, no fractions). */
function badMoney(t: Totals) { const keys = ['cash', 'card', 'platform', 'commission', 'refundTotal', 'expenseTotal', 'orderAmount', 'cancelledAmount'] as const; return keys.filter(k => !Number.isSafeInteger((t as unknown as Record<string, number>)[k])); }

const release = dataLock(directory, 'bes-yil-dogrula');
let t = performance.now();
const store = new Store(directory, []);
out.storeOpenMs = ms(t);
try {
  t = performance.now(); const s = store.read(TENANT); out.firstReadMs = ms(t);
  out.snapshotKb = Math.round(JSON.stringify(s).length / 1024);
  const last = expected.lastDay, first = expected.firstDay;

  // 1. Day by day: stored summaries (built now where missing, as the first "Tümü" report would) against the generator's books.
  log('Günlük özetler ve beklenen defter…');
  t = performance.now();
  const days = store.history.reportDays(TENANT, s, dayStart(first), dayStart(addDays(last, 1)));
  out.allDaysBuildMs = ms(t);
  t = performance.now(); store.history.reportDays(TENANT, s, dayStart(first), dayStart(addDays(last, 1))); out.allDaysWarmMs = ms(t);
  const mismatch: { day: string; field: string; server: number; script: number }[] = []; let badDays = 0;
  for (const [day, total] of days) {
    if (day > last) continue;
    const e = expected.days[day] ?? {}, check = (field: string, server: number, script: number) => { if (server !== script) mismatch.push({ day, field, server, script }); };
    // Sales: every payment of the day (a kapora that paid a bill counts as a payment of that day, like on screen).
    check('tahsilat (nakit+kart)', total.cash + total.card, (e.cash ?? 0) + (e.card ?? 0) + (e.deposits ?? 0));
    check('iade', total.refundTotal, (e.refundCash ?? 0) + (e.refundCard ?? 0));
    check('gider', total.expenseTotal, e.expenses ?? 0);
    if (badMoney(total).length) badDays++;
  }
  out.dayCheck = { days: [...days.keys()].filter(d => d <= last).length, mismatches: mismatch.length, sample: mismatch.slice(0, 10), daysWithBadMoney: badDays };
  // 2. Years and the whole range: the same totals as one report (financial) and as the sum of the days.
  const years: Record<string, unknown>[] = [];
  const sumExpected = (from: string, to: string) => Object.entries(expected.days).filter(([d]) => d >= from && d <= to).reduce((n, [, b]) => ({ sales: n.sales + (b.cash ?? 0) + (b.card ?? 0) + (b.deposits ?? 0), refunds: n.refunds + (b.refundCash ?? 0) + (b.refundCard ?? 0), expenses: n.expenses + (b.expenses ?? 0), bills: n.bills + (b.bills ?? 0), orders: n.orders + (b.orders ?? 0) }), { sales: 0, refunds: 0, expenses: 0, bills: 0, orders: 0 });
  for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
    const from = `${y}-01-01` < first ? first : `${y}-01-01`, to = `${y}-12-31` > last ? last : `${y}-12-31`, { start, end } = reportRange(from, to);
    t = performance.now();
    const d = store.history.reportDays(TENANT, s, start, end), fin = financialFrom(d, from, to, start, end, store.history.adjustments(TENANT, start, end), store.history.expenses(TENANT, start, end));
    const took = ms(t), e = sumExpected(from, to), total = mergeTotals([...d.values()]);
    years.push({ year: y, ms: took, sales: fin.collected, expectedSales: e.sales, salesOk: fin.collected === e.sales, refunds: fin.refundTotal, refundsOk: fin.refundTotal === e.refunds, expenses: fin.expenseTotal, expensesOk: fin.expenseTotal === e.expenses, daysSumOk: total.cash + total.card === fin.cash + fin.card, bills: total.closedAccounts, orders: fin.orderCount });
  }
  t = performance.now();
  const all = store.history.reportDays(TENANT, s, -Infinity, Infinity), allTotal = mergeTotals([...all.values()]);
  const yearSum = years.reduce((n, y) => n + (y.sales as number), 0), e = sumExpected(first, last);
  out.years = years; out.allRange = { ms: ms(t), sales: allTotal.cash + allTotal.card, yearsSum: yearSum, expectedThroughLastDay: e.sales, note: 'The whole range also holds today (the live floor and the measurement\'s own sales), so it is at least the sum of the years.' };
  log(`Yıllar: ${JSON.stringify(years.map(y => ({ y: y.year, ok: y.salesOk && y.refundsOk && y.expensesOk, ms: y.ms })))}`); save();

  // 3. KDV: per rate the parts add up to the total, and base + KDV = gross on every row (whole kuruş).
  const cash = new CashBook(store), shifts = new ShiftBook(store), src = { store, cash, shifts };
  const vat: Record<string, unknown>[] = [];
  for (const [kind, label] of [['month', 'ay'], ['year', 'yıl']] as [PeriodKind, string][]) {
    t = performance.now(); const r = buildPeriodReport(src, TENANT, periodOf(kind, last), new Date(dayStart(addDays(last, 1)) - 1)); const took = ms(t);
    const rows = r.vat?.rows ?? [], sum = (k: 'gross' | 'base' | 'vat') => rows.reduce((n, x) => n + x[k], 0);
    vat.push({ period: label, ms: took, rows: rows.length, grossOk: sum('gross') === r.vat?.total.gross, baseOk: sum('base') === r.vat?.total.base, vatOk: sum('vat') === r.vat?.total.vat, rowsOk: rows.every(x => x.base + x.vat === x.gross && Number.isSafeInteger(x.vat)), grossEqualsSalesMinusRefunds: r.vat?.total.gross === r.sales.total - r.refunds.total });
  }
  out.vat = vat;
  // 4. Gün sonu kapanışları: every window adds up; together they hold every non-kapora payment of their time.
  t = performance.now();
  const closings = cash.days<CashClosing>(TENANT, ['closing'], '0000-01-01', '9999-12-31').filter(c => c.status === 'closed' && c.day <= last);
  const windowSales = closings.reduce((n, c) => n + c.figures.cashSales + c.figures.cardSales, 0);
  const firstFrom = Date.parse(closings[0]?.from ?? ''), lastTo = Date.parse(closings.at(-1)?.to ?? '');
  const span = store.history.reportDays(TENANT, s, firstFrom, lastTo), spanTotal = mergeTotals([...span.values()]);
  const depositPayments = Object.entries(expected.days).filter(([d]) => d <= last).reduce((n, [, b]) => n + (b.deposits ?? 0), 0);
  const gaps = closings.slice(1).filter((c, i) => c.from !== closings[i].to).length;
  const arithmetic = closings.filter(c => c.figures.expected !== c.figures.opening + c.figures.cashSales - c.figures.cashRefunds - c.figures.cashExpenses + c.figures.ownerIn - c.figures.ownerOut + c.figures.cashTips + (c.figures.deposits ?? 0) - (c.figures.depositRefunds ?? 0) || c.difference !== c.counted - c.figures.expected).length;
  const expectedDiff = Object.values(expected.days).reduce((n, b) => n + (b.closingDiff ?? 0), 0), diff = closings.reduce((n, c) => n + c.difference, 0);
  out.closings = { ms: ms(t), count: closings.length, windowsTouching: gaps === 0, gaps, arithmeticErrors: arithmetic, windowSales, historySalesInSpan: spanTotal.cash + spanTotal.card, depositsInSpan: depositPayments, windowsHoldEverySale: spanTotal.cash + spanTotal.card - windowSales === depositPayments, differenceSum: diff, expectedDifferenceSum: expectedDiff, differenceOk: diff === expectedDiff,
    note: 'Pencere satışları kapora ödemelerini içermez (kasaya kapora alındığı gün girer); geçmiş toplamı içerir. Aradaki fark = o aralıktaki kaporayla ödenen tutar.' };
  log(`Kapanışlar: ${JSON.stringify(out.closings)}`); save();

  // 5. Stok: the server's stock of every item (from five years of sales) against the script's own book.
  const book = new StockBook(store), at = Date.parse(expected.stockAt ?? new Date(dayStart(expected.today)).toISOString());
  t = performance.now(); const levels = stockLevels(book.data(TENANT), book.feed(TENANT, s), at); const cold = ms(t);
  t = performance.now(); stockLevels(book.data(TENANT), book.feed(TENANT, s), at); const warm = ms(t);
  t = performance.now(); const products = productStock(s.products, book.data(TENANT), levels, at); const make = ms(t);
  const diffs = [...levels.values()].map(l => ({ id: l.itemId, server: l.stock, script: expected.onHand[l.itemId] ?? 0 })).filter(x => Math.abs(x.server - x.script) > 1e-6 * Math.max(1, Math.abs(x.script)));
  out.stock = { coldMs: cold, warmMs: warm, makeableMs: make, items: levels.size, tracked: [...products.values()].filter(p => p.status !== 'none').length, negative: [...levels.values()].filter(l => l.stock < -1e-9).length, nan: [...levels.values()].filter(l => !Number.isFinite(l.stock)).length, mismatches: diffs.length, sample: diffs.slice(0, 5), live: !!expected.liveDay,
    note: expected.liveDay ? 'canli çalıştıysa stok kitabı onun sonundan; ölçüm (bes-yil-olcum) de stok kullandı: o durumda farklar beklenir. Kesin karşılaştırma için uret sonrası, canli öncesi çalıştırın.' : undefined };
  log(`Stok: ${JSON.stringify(out.stock)}`); save();

  // 6. E-mail period reports (the owner's Gmail) and the phone report: built and timed, no mail is sent.
  const mail: Record<string, unknown>[] = [];
  for (const kind of ['day', 'week', 'month', 'year'] as PeriodKind[]) {
    t = performance.now(); const r = buildPeriodReport(src, TENANT, periodOf(kind, last), new Date()); const build = ms(t);
    const html = reportHtml(r);
    let pdfMs: number | undefined, pdfKb: number | undefined;
    if (kind === 'year' || kind === 'day') { t = performance.now(); const a = await reportAttachment(r, html => htmlToPdf(html)); pdfMs = ms(t); pdfKb = Math.round(a.content.length / 1024); }
    mail.push({ kind, buildMs: build, htmlKb: Math.round(html.length / 1024), pdfMs, pdfKb });
  }
  t = performance.now(); const allTime = buildPeriodReport(src, TENANT, rangePeriod('all', 'all'), new Date()); mail.push({ kind: 'tümü', buildMs: ms(t), sales: allTime.sales.total });
  out.emailReports = mail;
  // The phone report (server/remote-reports.ts build): today and the last 30 days.
  t = performance.now();
  const today = businessDay(Date.now()), day = reportRange(today, today), before = previousRange(today, today, Date.now()), month = reportRange(addDays(today, -29), today);
  const phone = { today: overviewFrom({ from: today, to: today, start: day.start, end: day.end, today, days: store.history.reportDays(TENANT, s, day.start, day.end), previous: before && { from: before.from, to: before.to, partial: before.partial, days: store.history.reportDays(TENANT, s, before.start, before.end) }, openBalance: openBalance(s), products: s.products }),
    month: overviewFrom({ from: addDays(today, -29), to: today, start: month.start, end: month.end, today, days: store.history.reportDays(TENANT, s, month.start, month.end), previous: null, openBalance: 0 }) };
  out.phoneReport = { ms: ms(t), kb: Math.round(JSON.stringify(phone).length / 1024) };
  log(`E-posta ve telefon raporu: ${JSON.stringify({ mail, phone: out.phoneReport })}`); save();
  out.rows = store.history.counts();
} finally { store.close(); release(); }

// 7. Backup → restore into a new folder → the same totals.
if (!skip.has('yedek')) {
  const backups = join(home, 'dogrulama-yedek'), keys = join(home, 'dogrulama-anahtar'), checks = join(home, 'dogrulama-prova'), restored = join(home, 'dogrulama-geri');
  for (const d of [backups, keys, checks, restored]) rmSync(d, { recursive: true, force: true });
  log('Doğrulanmış yedek…');
  const cpu = process.cpuUsage(); t = performance.now();
  const made = await createVerifiedBackup(directory, backups, keys, checks);
  const backupMs = ms(t), used = process.cpuUsage(cpu);
  const keyPath = join(keys, `${made.backupDirectory.split(/[\\/]/).pop()}.key`);
  log('Yeni klasöre geri yükleme…');
  t = performance.now(); const back = await restoreBackup(made.backupDirectory, keyPath, restored); const restoreMs = ms(t);
  // The restored folder opens like the café's own and gives the same all-time totals.
  const original = new Store(directory, []), copy = new Store(back.directory, []);
  let same: boolean, totals: unknown;
  try {
    const a = mergeTotals([...original.history.reportDays(TENANT, original.read(TENANT), -Infinity, Infinity).values()]), b = mergeTotals([...copy.history.reportDays(TENANT, copy.read(TENANT), -Infinity, Infinity).values()]);
    const pick = (x: Totals) => ({ cash: x.cash, card: x.card, refunds: x.refundTotal, expenses: x.expenseTotal, orders: x.orders, accounts: x.closedAccounts });
    same = JSON.stringify(pick(a)) === JSON.stringify(pick(b)) && JSON.stringify(original.history.counts()) === JSON.stringify(copy.history.counts()); totals = pick(a);
  } finally { original.close(); copy.close(); }
  const backupMb = folderMb(made.backupDirectory), sqliteMb = Math.round(statSync(join(directory, 'merchant.sqlite')).size / 1048576 * 10) / 10;
  out.backup = { backupMs, cpuSeconds: Math.round((used.user + used.system) / 1e5) / 10, backupMb, sqliteMb, restoreMs, restoredSameTotals: same, totals,
    // Sunucu yedeği sends the whole encrypted folder as base64 inside JSON chunks: about 4/3 of its size, every gün sonu.
    cloudUploadMb: Math.round(backupMb * 4 / 3), cloudUploadMinutes: Object.fromEntries([5, 10, 20].map(mbps => [`${mbps} Mbps`, Math.round(backupMb * 4 / 3 * 8 / mbps / 60 * 10) / 10])) };
  log(`Yedek: ${JSON.stringify(out.backup)}`);
  for (const d of [backups, keys, checks, restored]) rmSync(d, { recursive: true, force: true });
}
save(); log(`Bitti: ${join(home, 'dogrulama.json')}`);
void DAY_MS;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { CashBook, blindTicket, closingTicket } from '../server/cash-closing.js';
import { accountantWorkbook, reportWindow, viewDocument } from '../server/report-export.js';
import { blindReport, buildPeriodReport, periodOf, plainSummary, reportText } from '../server/email-reports-content.js';
import type { RemoteReports } from '../server/remote-reports.js';
import { commissionAllowed, commissionOf, commissionRateProblem, parseCommissionRate } from '../packages/domain/commission.js';
import { blindClosing, closingFor, expectedCash, negativeExpectedText, type CashClosing } from '../packages/domain/cash.js';
import { expenseMethodText, fromDrawer, payFields } from '../packages/domain/expense-rules.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * The owner's first real day (8 Ekim 2026), reproduced number by number: sales ₺1.120 (cash ₺410, card ₺710) in 4 orders, a card
 * refund of 1 × Caffè Latte ₺140, expenses ₺967 = "Stok alışı: Kahve 10 kg" ₺467 (owner, stock purchase) + "süt aldık" ₺500
 * (cashier), a para bozdurma of ₺200, opening ₺0, counted ₺2.895. What it showed then: Kart komisyonu ₺213 (%30 of ₺710),
 * Elde kalan −₺200, the cashier reading "kasa ₺3.452 fazla", a till expected at −₺557 with no word about it.
 */
const TENANT = 'mola-demo', DAY = '2026-10-08';
const money = (k: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: k % 100 === 0 ? 0 : 2 }).format(k / 100);
type Answer = { status: number; data: any };

async function cafe(t: { after: (fn: () => Promise<void>) => void }) {
  const store = new Store(temp('owner-day')); licensed(store);
  let clock = new Date(`${DAY}T06:00:00Z`);
  const app = createApp(store, () => clock), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(username: string, password = DEMO_PASSWORD) {
    let cookie = '';
    const call = async (path: string, body?: unknown): Promise<Answer> => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json().catch(() => ({})) as any };
    };
    return Object.assign(call, { login: () => call('/login', { username, password }) });
  }
  const owner = client('isletme'), cashier = client('kasiyer'), waiter = client('garson');
  for (const c of [owner, cashier, waiter]) assert.equal((await c.login()).status, 200);
  assert.equal((await owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: 'MudurDeneme!2026' })).status, 200);
  const manager = client('mudur', 'MudurDeneme!2026'); assert.equal((await manager.login()).status, 200);
  // Prices of the day: Caffè Latte ₺140, Americano ₺150, Demleme Çay ₺55 (no options to pick).
  store.mutate(TENANT, s => { for (const p of s.products) { if (p.id === 'latte') { p.price = 14000; p.groups = []; } if (p.id === 'americano') { p.price = 15000; p.groups = []; } if (p.id === 'tea') { p.price = 5500; p.groups = []; } } });
  return { app, store, owner, cashier, waiter, manager, set: (iso: string) => { clock = new Date(iso); }, now: () => clock };
}
const ok = (r: Answer) => { assert.ok(r.status === 200, JSON.stringify(r.data)); return r.data; };

test('POS komisyonu: the rate is read as a percentage, %2,5 on ₺710 is ₺17,75, and an implausible %30 is refused', () => {
  assert.equal(parseCommissionRate('2,5'), 250); assert.equal(parseCommissionRate('%2,5'), 250); assert.equal(parseCommissionRate('2.5'), 250);
  assert.equal(parseCommissionRate('1,79'), 179); assert.equal(parseCommissionRate('3'), 300); assert.equal(parseCommissionRate(''), null);
  assert.ok(Number.isNaN(parseCommissionRate('1.250,5')));
  // The defect: "30" (an extra zero, or 3,0 typed without its comma) was taken as %30 without a word.
  assert.equal(parseCommissionRate('30'), 3000); assert.match(commissionRateProblem('30'), /%30 çok yüksek/);
  assert.equal(commissionRateProblem('2,5'), ''); assert.equal(commissionRateProblem('10'), '');
  // Per payment: ₺430 + ₺280 at %2,5 = ₺10,75 + ₺7 = ₺17,75; at the old %30 it was ₺213.
  assert.equal((commissionOf(43000, 250) ?? 0) + (commissionOf(28000, 250) ?? 0), 1775);
  assert.equal(Math.round(71000 * 3000 / 10_000), 21300, 'the owner\'s ₺213');
  assert.equal(commissionOf(71000, 3000), null, 'a legacy rate above %10 records "unknown", never a wrong amount');
  assert.equal(commissionAllowed(3000, null), false); assert.equal(commissionAllowed(3000, 3000), true, 'an unchanged legacy rate does not block the other settings'); assert.equal(commissionAllowed(250, 3000), true);
});

test('gider kaynağı: "Kasadan" lowers the expected cash, "Kasa dışından" never does; older cash records stay "Kasadan"', () => {
  assert.deepEqual(payFields('outside'), { method: 'cash', source: 'outside' });
  const base = { id: 'x', amount: 50000, description: 'süt aldık', actorId: 'kasiyer', actorName: 'Kasiyer', createdAt: `${DAY}T12:00:00Z` };
  assert.equal(fromDrawer({ ...base, method: 'cash' }), true); assert.equal(fromDrawer({ ...base, method: undefined }), true, 'no method: an old record, from the drawer');
  assert.equal(fromDrawer({ ...base, method: 'cash', source: 'outside' }), false); assert.equal(fromDrawer({ ...base, method: 'card' }), false);
  assert.equal(expenseMethodText({ method: 'cash', source: 'outside' }), 'Nakit · kasa dışı'); assert.equal(expenseMethodText({ method: 'cash' }), 'Nakit · kasadan');
  assert.match(negativeExpectedText({ expected: -55700, cashExpenses: 96700 }, money), /kasaya girenden ₺557 fazla nakit çıktı/);
  assert.equal(negativeExpectedText({ expected: 0, cashExpenses: 0 }, money), '');
});

test('the owner\'s day, number by number: commission, blind count for cashier and Müdür, the source of cash expenses, every report', async t => {
  const c = await cafe(t);
  // Ayarlar → Kasa ve ödeme: the slip that made %30 is refused now; the real rate %2,5 is kept.
  assert.equal((await c.owner('/staff/settings', { changeSeconds: 0, commissionBps: 3000 })).data.code, 'INVALID_COMMISSION');
  ok(await c.owner('/staff/settings', { changeSeconds: 0, commissionBps: parseCommissionRate('2,5') }));
  const kahve = ok(await c.owner('/staff/stock/items', { name: 'Kahve', unit: 'g', initial: 0 })).item.id as string;

  // 09:00 the cashier opens the kasa with ₺0.
  ok(await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 }));
  const tables = ok(await c.owner('/staff/state')).tables;
  const sell = async (at: string, table: number, lines: [string, number][], method: 'cash' | 'card') => {
    c.set(at);
    const total = lines.reduce((n, [id, q]) => n + q * ({ latte: 14000, americano: 15000, tea: 5500 } as Record<string, number>)[id], 0);
    const placed = ok(await c.waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[table].id, lines: lines.map(([productId, quantity]) => ({ productId, quantity, selections: [] })), expectedTotal: total }));
    const account = ok(await c.cashier('/staff/state')).tables.find((x: any) => x.account?.id === placed.accountId).account;
    return ok(await c.cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method, amount: total, tendered: total }));
  };
  await sell(`${DAY}T07:00:00Z`, 0, [['latte', 2], ['americano', 1]], 'card'); // ₺430
  await sell(`${DAY}T08:00:00Z`, 1, [['latte', 2]], 'card'); // ₺280
  await sell(`${DAY}T09:00:00Z`, 2, [['americano', 2]], 'cash'); // ₺300
  await sell(`${DAY}T10:00:00Z`, 3, [['tea', 2]], 'cash'); // ₺110

  // 13:00 the owner buys 10 kg coffee for ₺467 "Kasadan nakit": the drawer holds only ₺410, so Mola asks where it came from.
  c.set(`${DAY}T10:30:00Z`);
  const purchase = { requestId: randomUUID(), itemId: kahve, quantity: 10000, total: 46700, expense: true, method: 'cash', source: 'drawer' };
  const asked = await c.owner('/staff/stock/purchase', purchase);
  assert.equal(asked.status, 409); assert.equal(asked.data.code, 'CASH_BELOW_ZERO');
  assert.match(asked.data.message, /Kasada şu an ₺410 görünüyor; bu çıkışla −₺57 olur/); assert.match(asked.data.message, /Kasa dışı nakit/);
  // The expected cash the form reads to show that note before saving (GET /api/staff/cash/expected, owner only).
  { const r = await c.owner('/staff/cash/expected'); assert.equal(r.status, 200); assert.equal(r.data.expected, 41000); }
  // That day the owner kept "Kasadan nakit": the form's own "Alışı kaydet" sends it with `confirm`.
  ok(await c.owner('/staff/stock/purchase', { ...purchase, confirm: true }));
  // 15:00 the cashier writes "süt aldık" ₺500 from the drawer: never asked (blind), the owner hears it at once.
  c.set(`${DAY}T12:00:00Z`);
  const milk = ok(await c.cashier('/staff/expenses', { requestId: randomUUID(), amount: 50000, description: 'süt aldık', source: 'drawer' }));
  assert.equal(milk.method, 'cash'); assert.equal(milk.source, undefined);
  let inbox = ok(await c.owner('/staff/notifications')).items.filter((n: any) => n.kind === 'cash');
  const low = inbox.find((n: any) => n.title.startsWith('Kasadaki beklenen nakit eksiye düştü'));
  assert.ok(low, JSON.stringify(inbox)); assert.equal(low.title, 'Kasadaki beklenen nakit eksiye düştü: −₺557'); assert.match(low.text, /Kasiyer kasadan ₺500 gider yazdı \(“süt aldık”\)/);
  // A card refund of 1 × Caffè Latte ₺140 and a para bozdurma of ₺200.
  c.set(`${DAY}T13:00:00Z`);
  const ledger = ok(await c.owner(`/staff/payment-adjustments?from=${DAY}&to=${DAY}`)).rows, latte = ledger.find((r: any) => r.method === 'card' && r.amount === 28000);
  ok(await c.owner('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: latte.id, revision: 0, kind: 'refund', amount: 14000, method: 'card', commission: 0, reason: '1 × Caffè Latte' }));
  ok(await c.cashier('/staff/cash/movements', { requestId: randomUUID(), type: 'exchange', amount: 20000, note: '200 TL bozduruldu' }));

  // 22:00 gün sonu by the cashier: ₺2.895 counted. The answers never carry the expected cash or the difference.
  c.set(`${DAY}T19:00:00Z`);
  const counted = ok(await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 289500 }));
  const secret = (x: unknown) => { const s = JSON.stringify(x); for (const k of ['expected', 'difference', 'figures', 'cardDifference', '55700', '345200']) assert.equal(s.includes(k), false, `${k} in ${s}`); };
  secret(counted); assert.equal(counted.blind, true); assert.equal(counted.counted, 289500);
  secret(ok(await c.cashier(`/staff/cash/closing/${counted.id}`)));
  // No note asked of the cashier: they cannot know the difference is large.
  const done = ok(await c.cashier('/staff/cash/finish', { id: counted.id, left: 0 }));
  secret(done); assert.equal(done.closing.status, 'closed');
  // The Müdür reads the same blind copy outside the reports; the waiter has no cash screen at all.
  secret(ok(await c.manager(`/staff/cash/closing/${counted.id}`)));
  assert.equal((await c.waiter(`/staff/cash/closing/${counted.id}`)).status, 403);
  assert.equal((await c.waiter('/staff/cash/status')).status, 403);
  const status = JSON.stringify(ok(await c.cashier('/staff/cash/status'))); assert.doesNotMatch(status, /55700|345200|"expected"/);
  // The owner gets the whole closing: expected 0 + 410 − 967 = −₺557, counted ₺2.895, difference +₺3.452.
  const full = ok(await c.owner(`/staff/cash/closing/${counted.id}`)).closing as CashClosing;
  assert.deepEqual({ opening: full.figures.opening, cashSales: full.figures.cashSales, cashExpenses: full.figures.cashExpenses, expected: full.figures.expected, exchanges: full.figures.exchanges, card: full.figures.card, cardSales: full.figures.cardSales, cardRefunds: full.figures.cardRefunds },
    { opening: 0, cashSales: 41000, cashExpenses: 96700, expected: -55700, exchanges: 20000, card: 57000, cardSales: 71000, cardRefunds: 14000 });
  assert.equal(full.difference, 345200); assert.equal(expectedCash(full.figures), -55700);
  assert.deepEqual(full.expenses.map(e => [e.description, e.amount]), [['Stok alışı: Kahve 10 kg', 46700], ['süt aldık', 50000]]);
  // The slips: the cashier's has no BEKLENEN / FARK; the owner's explains the minus.
  const slip = (lines: ReturnType<typeof closingTicket>) => JSON.stringify(lines);
  assert.doesNotMatch(slip(blindTicket(full, 'Mola')), /BEKLENEN|FARK|557|3\.452/); assert.match(slip(blindTicket(full, 'Mola')), /Sayım işletme sahibine iletildi/);
  assert.match(slip(closingTicket(full, [], 'Mola')), /BEKLENEN NAKİT/); assert.match(slip(closingTicket(full, [], 'Mola')), /Eksi: kasadan yazılan giderler kasaya girenden fazla/);
  assert.deepEqual(closingFor(full, 'cashier'), blindClosing(full)); assert.equal(closingFor(full, 'owner'), full);
  inbox = ok(await c.owner('/staff/notifications')).items.filter((n: any) => n.kind === 'cash');
  assert.ok(inbox.some((n: any) => n.title === 'Kasa kapatıldı: fark +₺3.452'), 'only the owner hears the difference');

  // ---- Satış ve Raporlar, sade özet (owner) ----
  c.set(`${DAY}T19:30:00Z`);
  const ov = ok(await c.owner(`/staff/reports/overview?from=${DAY}&to=${DAY}`));
  assert.deepEqual({ sales: ov.sales, cash: ov.cash, card: ov.card, expenses: ov.expenses, refunds: ov.refunds, posCommission: ov.posCommission, kept: ov.kept, orders: ov.orders },
    { sales: 112000, cash: 41000, card: 71000, expenses: 96700, refunds: 14000, posCommission: 1775, kept: 112000 - 96700 - 14000 - 1775, orders: 4 });
  assert.equal(ov.kept, -475, 'Elde kalan −₺4,75 (it was −₺200 with the %30 commission)');
  assert.deepEqual(ov.expenseParts.groups.map((g: any) => [g.key, g.amount, g.count]), [['stock', 46700, 1], ['other', 50000, 1]]);
  assert.deepEqual(ov.expenseParts.lines.map((l: any) => [l.description, l.amount, l.method]), [['Stok alışı: Kahve 10 kg', 46700, 'Nakit · kasadan'], ['süt aldık', 50000, 'Nakit · kasadan']]);
  const simple = ok(await c.owner(`/staff/reports/simple?from=${DAY}&to=${DAY}`));
  assert.equal(simple.kasa.text, 'Gün sonu kapanışı yapıldı: kasa ₺3.452 fazla çıktı.');
  assert.deepEqual(simple.counts.map((x: any) => [x.counted, x.expected, x.difference, x.opening, x.cashSales, x.cashExpenses]), [[289500, -55700, 345200, 0, 41000, 96700]]);
  // The Müdür (behind the report code) keeps the closing sentence of Kasa kapanışları, never the count line of the owner.
  const mSimple = ok(await c.manager(`/staff/reports/simple?from=${DAY}&to=${DAY}`));
  assert.equal(mSimple.counts, undefined);
  // K1 (8 Ekim, sahibin kararı): the Müdür sees no expected cash and no difference anywhere — sentence, Kasa kapanışları,
  // the printable page and the Excel file.
  assert.equal(mSimple.kasa.text, 'Gün sonu kapanışı yapıldı.'); assert.doesNotMatch(mSimple.sentence, /fazla çıktı|eksik çıktı|3\.452/);
  const mClosings = ok(await c.manager(`/staff/reports/cash-closings?from=${DAY}&to=${DAY}`));
  secret(mClosings.closings); assert.equal(mClosings.blind, true); assert.deepEqual(mClosings.closings.map((x: any) => x.counted), [289500]);
  assert.deepEqual([mClosings.people, mClosings.openings, mClosings.totals], [[], [], { count: 1 }]);  // ---- Detaylı (financial) ----
  const fin = ok(await c.owner(`/staff/reports/financial?from=${DAY}&to=${DAY}`));
  assert.deepEqual({ collected: fin.collected, commission: fin.commission, refundTotal: fin.refundTotal, expenseTotal: fin.expenseTotal, afterCommission: fin.afterCommission, cashAfterExpenses: fin.cashAfterExpenses },
    { collected: 112000, commission: 1775, refundTotal: 14000, expenseTotal: 96700, afterCommission: 112000 - 1775 - 14000, cashAfterExpenses: 41000 - 96700 });
  // ---- Kasa kapanışları (owner and Müdür, behind the report code) ----
  const closings = ok(await c.owner(`/staff/reports/cash-closings?from=${DAY}&to=${DAY}`));
  assert.deepEqual(closings.closings.map((x: any) => [x.figures.expected, x.counted, x.corrected, x.figures.card]), [[-55700, 289500, 345200, 57000]]);
  assert.deepEqual([closings.totals.difference, closings.totals.over, closings.totals.cashSales], [345200, 345200, 41000]);
  // ---- Excel (Muhasebeci için indir) ----
  const src = { store: c.store, cash: new CashBook(c.store) };
  const sheets = accountantWorkbook(reportWindow(src, TENANT, DAY, DAY, c.now()), src, TENANT);
  const sheet = (name: string) => sheets.find(s => s.name === name)!.rows;
  const cell = (v: unknown) => typeof v === 'object' && v && 'money' in v ? (v as { money: number }).money : typeof v === 'object' && v && 'text' in v ? (v as { text: string }).text : v;
  const pay = Object.fromEntries(sheet('Ödemeler özeti').slice(1).map(r => [cell(r[0]), cell(r[1])]));
  assert.deepEqual([pay['Nakit'], pay['Kart'], pay['Toplam tahsilat'], pay['İadeler'], pay['POS komisyonu (bankanın kart satışlarından aldığı pay)'], pay['Giderler'], pay['Elde kalan'], pay['Sipariş sayısı']], [41000, 71000, 112000, -14000, -1775, -96700, -475, 4]);
  assert.deepEqual(sheet('Giderler').slice(1, -1).map(r => [cell(r[1]), cell(r[2]), cell(r[3])]), [['süt aldık', 'Nakit · kasadan', 50000], ['Stok alışı: Kahve 10 kg', 'Nakit · kasadan', 46700]], 'newest first');
  assert.deepEqual(sheet('Kasa kapanışları').slice(1).map(r => [cell(r[3]), cell(r[4]), cell(r[5])]), [[-55700, 289500, 345200]]);
  // The Müdür's file: Tarih, Saat, Kapatan, Sayılan, Not — no Beklenen, no Fark.
  const blindWindow = reportWindow(src, TENANT, DAY, DAY, c.now()); blindWindow.blind = true; blindWindow.report = blindReport(blindWindow.report);
  for (const view of ['cash', 'summary'] as const) assert.doesNotMatch(viewDocument(src, TENANT, view, blindWindow, c.now()), /Beklenen|beklenen|3\.452|−₺557|fazla çıktı/);
  assert.match(viewDocument(src, TENANT, 'cash', reportWindow(src, TENANT, DAY, DAY, c.now()), c.now()), /Beklenen/);
  const mSheet = accountantWorkbook(blindWindow, src, TENANT).find(s => s.name === 'Kasa kapanışları')!.rows;
  assert.deepEqual(mSheet[0], ['Tarih', 'Saat', 'Kapatan', 'Sayılan', 'Not']); assert.equal(cell(mSheet[1][3]), 289500);
  assert.deepEqual(sheet('Günlük satışlar').slice(1, 2).map(r => [cell(r[1]), cell(r[2]), cell(r[3]), cell(r[4]), cell(r[6])]), [[4, 112000, 41000, 71000, 14000]]);
  // ---- E-posta raporu (gün sonu raporu) ----
  const report = buildPeriodReport(src, TENANT, periodOf('day', DAY), c.now());
  assert.deepEqual([report.sales.total, report.commission, report.kept, report.expenses.total, report.refunds.total], [112000, 1775, -475, 96700, 14000]);
  assert.match(plainSummary(report), /8 Ekim Perşembe günü 4 sipariş, ₺1\.120 satış yapıldı/);
  assert.match(plainSummary(report), /Kasa ₺3\.452 fazla çıktı\./); assert.match(plainSummary(report), /elde kalan −₺4,75\./);
  const text = reportText(report);
  assert.match(text, /POS komisyonu: ₺17,75/); assert.match(text, /Gider: ₺967 \(2 kayıt\)/); assert.match(text, /Kasa fazla ₺3\.452 \(sayılan ₺2\.895 · beklenen −₺557\)/);
  // ---- Telefon raporu (Raporlarım, the owner's phone) ----
  const phone = (c.app.locals.remote as RemoteReports).build(TENANT, 'live');
  assert.deepEqual([phone.today.sales, phone.today.expenses, phone.today.refunds, phone.today.kept], [112000, 96700, 14000, -475]);
  assert.deepEqual(phone.lastClosing && [phone.lastClosing.counted, phone.lastClosing.expected, phone.lastClosing.difference], [289500, -55700, 345200]);
});

test('the new flow: the owner pays the coffee "Kasa dışından", the cashier picks the source; the till never goes below zero', async t => {
  const c = await cafe(t);
  ok(await c.owner('/staff/settings', { changeSeconds: 0, commissionBps: 250 }));
  const kahve = ok(await c.owner('/staff/stock/items', { name: 'Kahve', unit: 'g', initial: 0 })).item.id as string;
  ok(await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 0 }));
  const tables = ok(await c.owner('/staff/state')).tables;
  c.set(`${DAY}T09:00:00Z`);
  const placed = ok(await c.waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[0].id, lines: [{ productId: 'americano', quantity: 2, selections: [] }, { productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 41000 }));
  const account = ok(await c.cashier('/staff/state')).tables.find((x: any) => x.account?.id === placed.accountId).account;
  ok(await c.cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'cash', amount: 41000, tendered: 41000 }));
  c.set(`${DAY}T10:00:00Z`);
  // "Kasa dışı nakit": a gider (Elde kalan drops), never out of the drawer: nothing is asked.
  const bought = ok(await c.owner('/staff/stock/purchase', { requestId: randomUUID(), itemId: kahve, quantity: 10000, total: 46700, expense: true, ...payFields('outside') }));
  assert.ok(bought.entry.expenseId);
  // The owner's own Giderler form: "Kasadan nakit" above what the drawer holds is asked; "Kasa dışından" is not.
  assert.equal((await c.owner('/staff/expenses', { requestId: randomUUID(), amount: 60000, description: 'Tamirci', method: 'cash', source: 'drawer' })).data.code, 'CASH_BELOW_ZERO');
  ok(await c.owner('/staff/expenses', { requestId: randomUUID(), amount: 60000, description: 'Tamirci', ...payFields('outside') }));
  // The cashier's süt from the drawer (₺300 of the ₺410 there) and a ₺500 one paid outside it.
  ok(await c.cashier('/staff/expenses', { requestId: randomUUID(), amount: 30000, description: 'süt', source: 'drawer' }));
  const outside = ok(await c.cashier('/staff/expenses', { requestId: randomUUID(), amount: 50000, description: 'süt (cebimden)', source: 'outside' }));
  assert.equal(outside.source, 'outside'); assert.equal(outside.method, 'cash');
  // The owner corrects the coffee later: "Kasadan" ↔ "Kasa dışından" (method and source on the record).
  // K2 (8 Ekim): "Kart bahşişini kasadan nakit öde" is off until the owner turns it on; then a card tip handed to the
  // waiter in cash is a "Kart bahşişi nakit ödendi" movement the cashier may record (the payment window asks).
  assert.equal(ok(await c.cashier('/staff/cash/settings')).tipCashOut, false);
  ok(await c.owner('/staff/cash/settings', { tipCashOut: true }));
  assert.equal(ok(await c.cashier('/staff/cash/settings')).tipCashOut, true);
  ok(await c.cashier('/staff/cash/movements', { requestId: randomUUID(), type: 'tip_out', amount: 2000, note: 'Masa 01 · kartla bahşiş' }));
  c.set(`${DAY}T19:00:00Z`);
  const counted = ok(await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 9000 }));
  const full = ok(await c.owner(`/staff/cash/closing/${counted.id}`)).closing as CashClosing;
  assert.equal(full.figures.expected, 41000 - 30000 - 2000, 'the drawer\'s ₺300 and the ₺20 card tip paid in cash left it'); assert.equal(full.difference, 0);
  assert.equal(full.figures.tipsPaidOut, 2000); assert.equal(full.figures.ownerOut, 0);
  assert.equal(full.figures.outsideExpenses, 46700 + 60000 + 50000);
  const ov = ok(await c.owner(`/staff/reports/overview?from=${DAY}&to=${DAY}`));
  assert.equal(ov.expenses, 46700 + 60000 + 30000 + 50000, 'every one of them is a gider'); assert.equal(ov.expenseParts.outside, 46700 + 60000 + 50000);
  const fin = ok(await c.owner(`/staff/reports/financial?from=${DAY}&to=${DAY}`));
  assert.equal(fin.cashAfterExpenses, 41000 - 30000);
  // Editing an expense's source afterwards.
  const milk = fin.expenses.find((e: any) => e.description === 'süt');
  const edited = ok(await c.owner('/staff/expenses/edit', { requestId: randomUUID(), id: milk.id, version: 0, amount: 30000, description: 'süt', day: DAY, ...payFields('outside') }));
  assert.equal(edited.source, 'outside'); assert.equal(edited.changes[0].before.source, undefined);
  const back = ok(await c.owner('/staff/expenses/edit', { requestId: randomUUID(), id: milk.id, version: 1, amount: 30000, description: 'süt', day: DAY, ...payFields('drawer') }));
  assert.equal(back.source, undefined); assert.equal(back.changes[1].before.source, 'outside');
});

test('a legacy %30 rate: the settings still save other changes, new card payments record no commission until it is fixed', async t => {
  const c = await cafe(t);
  c.store.mutate(TENANT, s => { s.commissionBps = 3000; });
  ok(await c.owner('/staff/settings', { changeSeconds: 60, commissionBps: 3000 }));
  assert.equal((await c.owner('/staff/settings', { changeSeconds: 60, commissionBps: 2500 })).data.code, 'INVALID_COMMISSION');
  const tables = ok(await c.owner('/staff/state')).tables;
  const placed = ok(await c.waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[0].id, lines: [{ productId: 'latte', quantity: 1, selections: [] }], expectedTotal: 14000 }));
  const account = ok(await c.cashier('/staff/state')).tables.find((x: any) => x.account?.id === placed.accountId).account;
  ok(await c.cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method: 'card', amount: 14000, tendered: 14000 }));
  const ov = ok(await c.owner(`/staff/reports/overview?from=${DAY}&to=${DAY}`));
  assert.equal(ov.posCommission, 0); assert.deepEqual(ov.unknownCommission, { count: 1, amount: 14000 }, 'shown as "geçici", never ₺42');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshotKey, Store } from '../server/store.js';
import { CashBook } from '../server/cash-closing.js';
import { ShiftBook } from '../server/shifts.js';
import { StockBook } from '../server/stock.js';
import { ReservationBook } from '../server/reservations.js';
import { AFTER_UPDATE_MS, SAFETY_COPY_MS, safetyCopies, safetyCopyView, type CrashPoint } from '../server/year-packer.js';
import { BackupScheduler } from '../server/backup-scheduler.js';
import { UpdateAgent } from '../server/update-agent.js';
import { assertDataVersion } from '../server/data-version.js';
import { businessDay, dayStart, DAY_MS } from '../packages/domain/business-day.js';
import { summarize } from '../packages/domain/history.js';
import { submitOrder, quote } from '../packages/domain/engine.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import { deleteExpense, editExpense, recordExpense } from '../packages/domain/expenses.js';
import { adjustPayment, refundableItems } from '../packages/domain/payment-adjustments.js';
import { runRecurring, saveRecurring } from '../packages/domain/recurring-expenses.js';
import { reportRange } from '../packages/domain/reports.js';
import type { CashClosing } from '../packages/domain/cash.js';
import { temp } from './merkez-fixture.js';
import { busyCafe, cafe, figures, HOUR, leftInLive, packerFor, PERSONAL, personalIn, RANGES, reopen, tenant, who } from './year-fixture.js';

/*
 * Yıl paketleri (server/year-packages.ts, server/year-packer.ts; docs/HIZ_TESTI_5_YIL.md "Faz 4 sonrası"): a closed year is
 * sealed on 1 February, every figure reads the same to the kuruş afterwards, a crash at any step goes on from there, nothing
 * is written into a closed year any more (each write path), and a refund of its bill counts today.
 */

test('year packages: sealed from 1 February (never before), every figure stays the same to the kuruş, the year leaves the live file', async () => {
  const c = busyCafe('yil-paket'), { store } = c;
  // 31 January 2026: only 2024 is due (its 1 February was last year); 2025 waits.
  c.at(dayStart('2026-01-31') + 20 * HOUR);
  const packer = packerFor(c);
  assert.equal(packer.dueYear(), '2024');
  await packer.run();
  assert.deepEqual(store.packages.list().map(p => p.year), ['2024']);
  // Before the very first package: a copy of the data as an older app reads it (version 3), beside the folder.
  const parent = dirname(store.directory), copies = readdirSync(parent).filter(n => n.startsWith(`${basename(store.directory)}-tasima-oncesi-v3-`));
  assert.equal(copies.length, 1);
  const copy = new DatabaseSync(join(parent, copies[0], 'merchant.sqlite'), { readOnly: true });
  try { assert.equal(Number(copy.prepare('PRAGMA user_version').get()!.user_version), 3); assertDataVersion(copy, { minReadable: 0, maxReadable: 3, writeVersion: 3 }); } finally { copy.close(); }
  assert.equal(packer.dueYear(), null, '2025 is not due on 31 January');
  assert.equal(store.packages.closedEnd(), '2024-12-31');
  // 1 February 05:00 (the business day starts): 2025 is due.
  c.at(dayStart('2026-02-01') + 1);
  assert.equal(packer.dueYear(), '2025');
  const before = figures(c, RANGES), version = Number(store.db.prepare('PRAGMA user_version').get()!.user_version);
  assert.equal(version, 4, 'data version 4 once a package exists');
  await packer.run();
  assert.deepEqual(store.packages.list().map(p => [p.year, p.from, p.to]), [['2024', '0000-01-01', '2024-12-31'], ['2025', '2025-01-01', '2025-12-31']]);
  assert.deepEqual(figures(c, RANGES), before, 'every figure equal after packaging');
  assert.deepEqual(Object.values(leftInLive(store, '2025-12-31')).filter(n => n > 0), [], JSON.stringify(leftInLive(store, '2025-12-31')));
  assert.ok(existsSync(join(store.directory, 'yil-2025.sqlite')) && existsSync(join(store.directory, 'yil-2024.sqlite')));
  // The bill across New Year stays live (closed on 1 January); its order counted on 31 December, its payment on 1 January.
  const cross = store.db.prepare("SELECT COUNT(*) AS n FROM history_archives WHERE day='2026-01-01'").get() as { n: number };
  assert.ok(cross.n >= 1);
  // The same after a restart (shards opened again, the reclaim VACUUM ran).
  store.close();
  const again = new Store(store.directory, [tenant]);
  try {
    assert.equal(again.db.prepare("SELECT value FROM history_meta WHERE key='package:reclaim'").get(), undefined, 'VACUUM at the next start');
    const c2 = reopen(c, again);
    assert.deepEqual(figures(c2, RANGES), before, 'equal after a restart');
    // An older app (data format up to 3) refuses the data instead of misreading it.
    assert.throws(() => assertDataVersion(again.db, { minReadable: 0, maxReadable: 3, writeVersion: 3 }), /Veri biçimi bu uygulamayla uyumlu değil/);
  } finally { again.close(); }
});

test('year packages: a crash at every step goes on from there; the figures are the same', async () => {
  const base = busyCafe('yil-paket-kesinti'), dir = base.store.directory;
  base.at(dayStart('2026-02-01') + 6 * HOUR);
  const before = figures(base, RANGES), at = base.now();
  base.store.close();
  const points: CrashPoint[] = ['closing', 'prepared', 'opened', 'copied', 'stripping', 'stripped', 'renamed', 'sealed', 'deleting', 'deleted'];
  for (const point of points) {
    const copy = temp(`yil-paket-kesinti-${point}`);
    // fs.cpSync stops the process on this computer's non-ASCII path (Node 24, Windows): the flat data folder file by file.
    for (const name of readdirSync(dir)) if (statSync(join(dir, name)).isFile()) copyFileSync(join(dir, name), join(copy, name));
    let store = new Store(copy, [tenant]); store.clock = () => new Date(at);
    const books = { store, cash: new CashBook(store), shifts: new ShiftBook(store), stock: new StockBook(store), now: () => at };
    const packer = packerFor(books);
    packer.batch = 7; packer.pauseMs = 0;
    await assert.rejects(packer.run({ crashAt: point }), /kesildi/, point);
    store.close();
    // The next start: the job goes on from its mark.
    store = new Store(copy, [tenant]); store.clock = () => new Date(at);
    try {
      if (point === 'closing' || point === 'prepared') assert.ok(store.packages.closedEnd(), `${point}: the year is already closed to writes`);
      const status = await packerFor({ store, cash: new CashBook(store), shifts: new ShiftBook(store), stock: new StockBook(store), now: () => at }).run();
      assert.equal(status.state, 'idle', `${point}: ${status.error ?? ''}`);
      assert.deepEqual(store.packages.list().map(p => p.year), ['2024', '2025'], point);
      const c = reopen(base, store, () => at);
      assert.deepEqual(figures(c, RANGES), before, `${point}: figures`);
      assert.deepEqual(Object.values(leftInLive(store, '2025-12-31')).filter(n => n > 0), [], `${point}: live rows left`);
      assert.ok(!readdirSync(copy).some(n => n.endsWith('.tmp')), `${point}: no temporary file left`);
      assert.deepEqual(personalIn(store), [], `${point}: no personal data in the packages`);
    } finally { store.close(); }
  }
});

test('year packages: customers\' personal data stays behind; every figure, the QR guest counts and an old bill\'s refund stay', async () => {
  const c = busyCafe('yil-paket-gizlilik'), { store } = c;
  c.at(dayStart('2026-02-01') + 6 * HOUR);
  // The open year keeps them (the café works with them until the year closes).
  const december = JSON.stringify(store.history.archives(tenant, dayStart('2025-12-30'), dayStart('2025-12-31')));
  assert.ok(december.includes(PERSONAL.line) && december.includes(PERSONAL.name) && december.includes(PERSONAL.browser));
  const before = figures(c, RANGES), sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  await packerFor(c).run();
  assert.deepEqual(store.packages.list().map(p => p.year), ['2024', '2025']);
  const after = figures(c, RANGES);
  assert.deepEqual(after, before, 'every figure equal');
  assert.equal(sha(after), sha(before), 'the whole figure set has the same SHA-256');
  assert.deepEqual(personalIn(store), [], 'no personal data in any package row');
  assert.deepEqual(Object.values(leftInLive(store, '2025-12-31')).filter(n => n > 0), [], 'the live rows they came from are gone');
  const stripped = store.packages.get('2025')!.stripped!;
  assert.ok(stripped.history_archives >= 5 && stripped.reservation_records === 2 && stripped.history_audit === 1, JSON.stringify(stripped));
  // What the screens read of the closed year: "Müşteri", no phone, no note; the party size, table and kapora stay.
  const s = store.read(tenant);
  assert.deepEqual(c.reservations.reservations(tenant, s, '2025-12-29', '2025-12-30').map(r => [r.name, r.phone ?? null, r.note ?? null, r.people, r.tableName, r.status]),
    [['Müşteri', null, null, 4, 'Masa 06', 'no_show'], ['Müşteri', null, null, 2, 'Masa 08', 'seated']]);
  const bills = store.history.archives(tenant, dayStart('2025-12-30'), dayStart('2025-12-31')), seated = bills.find(a => a.account?.guest)!;
  assert.deepEqual(seated.account!.guest, { name: 'Müşteri', people: 2, reservationId: seated.account!.guest!.reservationId });
  assert.ok(bills.flatMap(a => a.orders).every(o => o.lines.every(l => l.note === undefined)), 'no line notes');
  const qr = bills.flatMap(a => a.orders).filter(o => o.source === 'qr');
  assert.ok(qr.length >= 2 && qr.every(o => o.guestId.startsWith('anon:')), 'QR guests by their tag only');
  assert.ok(store.history.audit(tenant, 100_000).some(a => a.actor.startsWith('anon:')) && !JSON.stringify(store.history.audit(tenant, 100_000)).includes(PERSONAL.browser));
  // A day summary built again from the package (as after a format change) counts the same QR guests and bills.
  for (const day of ['2025-12-28', '2025-12-30', '2024-12-25']) {
    const start = dayStart(day), rows = store.history.archives(tenant, start, start + DAY_MS);
    const rebuilt = summarize({ orders: rows.flatMap(a => a.orders), payments: rows.flatMap(a => a.payments), refunds: [], expenses: [], closed: rows }, start, start + DAY_MS).get(day)!, kept = store.history.storedDay(tenant, day);
    assert.deepEqual([[...rebuilt.browsers].sort(), [...rebuilt.qrAccounts].sort()], [[...kept.browsers].sort(), [...kept.qrAccounts].sort()], day);
  }
  // The seated guest's bill (a stripped row) is refunded today, item by item; the closed year does not change.
  const payment = seated.payments[0], found = store.history.paymentForAdjustment(tenant, s, payment.id), account = store.history.refundAccount(tenant, s, payment.id)!;
  const item = refundableItems(payment.id, account).find(i => i.left > 0)!;
  const refund = c.apply(st => adjustPayment(st, who.owner, { requestId: randomUUID(), paymentId: payment.id, revision: found.history.length, kind: 'refund', amount: item.unit, method: 'card', commission: 0, reason: 'Eski hesap iadesi', items: [{ orderId: item.orderId, lineId: item.lineId, quantity: 1 }] }, c.ctx(), { payment: found.payment, history: found.history, account }));
  assert.equal(refund.closedPeriod, true);
  assert.deepEqual(figures(c, [['2025-01-01', '2025-12-31']])['2025-01-01:2025-12-31'].overview, before['2025-01-01:2025-12-31'].overview);
  // The monthly check opens every row: each stripped row as it was written, none with personal data left.
  await store.packages.openCheck('2025', t => snapshotKey(store.db, store.key, t), new Date(c.now()));
  assert.equal(store.packages.check('2025')?.ok, true);
  store.close();
});

test('the readable copy before the first package goes 90 days later, only after a newer verified backup; the backup screen says when', async () => {
  const c = busyCafe('yil-paket-kopya'), { store } = c;
  c.at(dayStart('2026-02-01') + 6 * HOUR);
  let backupAt: string | undefined;
  const packer = packerFor(c, { verifiedBackupAt: () => backupAt });
  await packer.run();
  const sealed = Math.min(...store.packages.list().map(p => Date.parse(p.sealedAt)));
  assert.equal(safetyCopies(store.directory).length, 1);
  const view = safetyCopyView(store)!, root = temp('yil-paket-kopya-yedek');
  assert.equal(view.removeAt, new Date(sealed + SAFETY_COPY_MS).toISOString());
  const scheduler = new BackupScheduler(store.directory, { backups: join(root, 'b'), keys: join(root, 'k'), checks: join(root, 'c'), safetyCopy: () => safetyCopyView(store) });
  assert.deepEqual(scheduler.status().safetyCopy, view, 'the backup screen shows when it goes');
  // 89 days on: kept, whatever the backups.
  backupAt = new Date(sealed + 60 * DAY_MS).toISOString(); c.at(sealed + 89 * DAY_MS);
  assert.deepEqual(await packer.removeSafetyCopy(), []);
  // 90 days on, but no verified backup newer than the packaging: kept.
  c.at(sealed + SAFETY_COPY_MS + HOUR);
  backupAt = undefined; assert.deepEqual(await packer.removeSafetyCopy(), []);
  backupAt = new Date(sealed - HOUR).toISOString(); assert.deepEqual(await packer.removeSafetyCopy(), []);
  assert.equal(safetyCopies(store.directory).length, 1);
  // A newer verified backup: the hourly check removes it, and the line goes.
  backupAt = new Date(sealed + DAY_MS).toISOString();
  await packer.tick();
  assert.equal(safetyCopies(store.directory).length, 0);
  assert.equal(safetyCopyView(store), undefined); assert.equal(scheduler.status().safetyCopy, undefined);
  // The next year's package makes no new copy (only the very first one does).
  c.at(dayStart('2027-02-01') + 6 * HOUR);
  assert.equal((await packer.run()).state, 'idle');
  assert.deepEqual(store.packages.list().map(p => p.year), ['2024', '2025', '2026']);
  assert.equal(safetyCopies(store.directory).length, 0);
  store.close();
});

test('year packages: nothing is written into a closed year (each write path); a refund of its bill counts today', async () => {
  const c = busyCafe('yil-paket-yazma'), { store } = c;
  c.at(dayStart('2026-02-02') + 6 * HOUR);
  const packer = packerFor(c);
  const stockBefore = figures(c, [['2025-01-01', '2025-12-31']]);
  await packer.run();
  const closedYear = figures(c, [['2025-01-01', '2025-12-31']]);
  assert.deepEqual(closedYear['2025-01-01:2025-12-31'], stockBefore['2025-01-01:2025-12-31']);
  const closedRefusal = (fn: () => unknown, label: string) => assert.throws(fn, (e: { code?: string; message?: string }) => e.code === 'CLOSED_YEAR' && /^Bu yıl kapandı: 202[45] yılının kayıtları paketlendi ve artık değiştirilemez\./.test(e.message ?? ''), label);
  const owner = who.owner, oldExpense = store.history.expenses(tenant, dayStart('2025-12-29'), dayStart('2025-12-30'))[0];
  // Expenses: back-dated into 2025, an edit and a deletion of a 2025 expense, an edit moving a 2026 one into 2025.
  closedRefusal(() => c.apply(s => recordExpense(s, owner, { requestId: randomUUID(), amount: 100, description: 'Geriye tarihli', day: '2025-12-31', method: 'cash' }, c.ctx())), 'back-dated expense');
  closedRefusal(() => c.apply(s => editExpense(s, owner, { requestId: randomUUID(), id: oldExpense.id, version: 0, amount: 1, description: 'x', method: 'cash' }, c.ctx(), store.history.expense(tenant, oldExpense.id))), 'edit');
  closedRefusal(() => c.apply(s => deleteExpense(s, owner, { requestId: randomUUID(), id: oldExpense.id, version: 0 }, c.ctx(), store.history.expense(tenant, oldExpense.id))), 'delete');
  const fresh = c.apply(s => recordExpense(s, owner, { requestId: randomUUID(), amount: 100, description: 'Bugün', method: 'cash' }, c.ctx()));
  closedRefusal(() => c.apply(s => editExpense(s, owner, { requestId: randomUUID(), id: fresh.id, version: 0, amount: 100, description: 'Bugün', day: '2025-12-15', method: 'cash' }, c.ctx(), store.history.expense(tenant, fresh.id))), 'moved into 2025');
  // A payment-method correction of a 2025 payment.
  const old = c.payments.find(p => businessDay(p.at) === '2025-12-28')!;
  closedRefusal(() => c.apply(s => adjustPayment(s, owner, { requestId: randomUUID(), paymentId: old.id, revision: 0, kind: 'method', amount: 0, method: old.method === 'cash' ? 'card' : 'cash', commission: 0, reason: 'x' }, c.ctx(), store.history.paymentForAdjustment(tenant, s, old.id))), 'method correction');
  // A correction of a 2025 cash closing.
  const closing = c.cash.days<CashClosing>(tenant, ['closing'], '2025-12-29', '2025-12-29')[0];
  closedRefusal(() => c.apply(s => c.cash.correct(s, owner, { requestId: randomUUID(), closingId: closing.id, amount: 100, note: 'Sonradan' }, c.ctx())), 'cash correction');
  // A shift of 2025 corrected, and a 2026 shift moved into 2025.
  const shift = c.shifts.range(tenant, '2025-12-29', '2025-12-29')[0], late = c.shifts.range(tenant, '2026-01-20', '2026-01-20')[0];
  closedRefusal(() => c.shifts.correct(tenant, shift, 'İşletme sahibi', { startAt: shift.startAt, endAt: shift.endAt, note: 'x' }, new Date(c.now()).toISOString()), 'shift correction');
  closedRefusal(() => c.shifts.correct(tenant, late, 'İşletme sahibi', { startAt: new Date(dayStart('2025-12-30') + 6 * HOUR).toISOString(), note: 'x' }, new Date(c.now()).toISOString()), 'shift moved into 2025');
  // A stock entry of 2025 taken back; a new one today is fine.
  const entry = c.stock.data(tenant).entries.find(e => e.id === 'buy-1')!;
  closedRefusal(() => c.stock.put(tenant, 'entry', { ...entry, deletedAt: new Date(c.now()).toISOString() }, entry.at), 'stock entry deleted');
  const now = new Date(c.now()).toISOString();
  c.stock.put(tenant, 'entry', { id: 'buy-2', kind: 'purchase', at: now, by: 'isletme', itemId: 'cay', quantity: 1000, total: 12000, unitCost: 12 }, now);
  // The opening count on 1 January carries the stock exactly; the purchase today adds to it.
  const opening = c.stock.data(tenant).entries.find(e => e.id === 'y2026-c-cay')!;
  assert.equal(opening.at, new Date(dayStart('2026-01-01')).toISOString());
  assert.equal(opening.start, true);

  // A refund of a 2025 bill with items: allowed, counted today; 2025 does not change.
  const s = store.read(tenant), account = store.history.refundAccount(tenant, s, old.id)!, item = refundableItems(old.id, account).find(i => i.left > 0)!;
  const found = store.history.paymentForAdjustment(tenant, s, old.id);
  const refund = c.apply(st => adjustPayment(st, owner, { requestId: randomUUID(), paymentId: old.id, revision: found.history.length, kind: 'refund', amount: Math.min(item.unit, found.payment!.amount), method: 'cash', commission: 0, reason: 'Eski hesap iadesi', items: [{ orderId: item.orderId, lineId: item.lineId, quantity: 1 }] }, c.ctx(), { payment: found.payment, history: found.history, account }));
  assert.equal(refund.closedPeriod, true);
  // Every figure of 2025 stays; only the old payment's own row in İade ve düzeltme shows that it was refunded (and when).
  const after = figures(c, [['2025-01-01', '2025-12-31']])['2025-01-01:2025-12-31'], was = closedYear['2025-01-01:2025-12-31'];
  assert.deepEqual({ ...after, ledger: { ...after.ledger, rows: undefined } }, { ...was, ledger: { ...was.ledger, rows: undefined } }, '2025 is the same after the refund');
  assert.equal(after.ledger.rows.find((r: { id: string }) => r.id === old.id)?.refunded, refund.amount, 'the old payment shows its refund');
  const today = businessDay(c.now()), { start, end } = reportRange(today, today), t = store.history.reportSpan(tenant, store.read(tenant), start, end).total;
  assert.equal(t.refundTotal, refund.amount, 'the refund counts today');
  assert.equal([...t.returned.values()].reduce((n, r) => n + r.quantity, 0), 1, 'its item leaves today\'s product sales');

  // An automatic expense due in 2025 that was missed (the computer off) counts today, never in 2025.
  c.apply(st => saveRecurring(st, owner, { requestId: randomUUID(), name: 'Kira', amount: 500_00, method: 'transfer', repeat: { every: 'month', day: 28 }, start: '2025-12-01', active: true }, c.ctx()));
  const made = c.apply(st => { st.recurringExpenses![0].doneThrough = '2025-12-20'; return runRecurring(st, new Date(c.now()), id => !!store.history.expense(tenant, id)); });
  assert.ok(made.length >= 1);
  assert.ok(made.every(m => !m.expense.spentAt || businessDay(m.expense.spentAt) > '2025-12-31'), 'missed December rent counts today');
  store.close();
});

test('year packages: what keeps a year open postpones it; the data stays version 3 until the first package', async () => {
  const c = cafe(temp('yil-paket-bekle'), ['2025-12-30', '2025-12-31']), { store } = c;
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 3, 'no package: still version 3 (an older app opens it)');
  // A table opened on 31 December and still open on 1 February.
  c.at(dayStart('2025-12-31') + 20 * HOUR);
  c.apply(s => submitOrder(s, who.waiter, { requestId: randomUUID(), tableId: 'table-7', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: quote(saleProducts(s, new Date(c.now())), [{ productId: 'tea', quantity: 1, selections: [] }], c.ctx()).reduce((n, l) => n + l.total, 0) }, c.ctx()));
  c.at(dayStart('2026-02-01') + 6 * HOUR);
  const notes: string[] = [];
  const packer = packerFor(c, { notify: (_t, _k, title, text) => notes.push(`${title}: ${text}`) });
  const status = await packer.run();
  assert.equal(status.state, 'waiting');
  assert.match(status.reasons!.join(' '), /2025 yılından açık kalan hesap var \(Masa 07\)/);
  assert.equal(store.packages.list().length, 0); assert.equal(store.packages.closedEnd(), null);
  assert.match(notes.join('\n'), /2025 yılı henüz paketlenemedi/);
  // The week after an update: no packaging yet (a bad update can still be rolled back by hand to version 3 data).
  const waiting = packerFor(c, { recentUpdate: () => true });
  assert.equal((await waiting.tick()).state, 'waiting');
  assert.match(waiting.status.reasons!.join(' '), /güncellemenin ilk haftası/);
  // The update agent knows when the running version was installed (the applier's outcome): a week of waiting from then.
  const updates = temp('yil-paket-guncelleme'); let clock = Date.parse('2026-02-01T10:00:00Z');
  writeFileSync(join(updates, 'sonuc.json'), JSON.stringify({ v: 1, version: '9.9.9', from: '9.9.8', result: 'installed', at: new Date(clock).toISOString() }));
  const agent = new UpdateAgent({ dir: updates, link: { signedGet: async () => new Response(null, { status: 404 }) }, publicKey: () => undefined, current: '9.9.9', platform: 'windows', now: () => new Date(clock) });
  agent.start(); agent.stop();
  assert.equal(agent.installedWithin(AFTER_UPDATE_MS), true, 'just installed');
  clock += AFTER_UPDATE_MS + 60_000;
  assert.equal(agent.installedWithin(AFTER_UPDATE_MS), false, 'a week later');
  // A café never quiet waits (it is packaged anyway after a week of waiting).
  const busy = packerFor(c, { idle: () => false });
  assert.match((await busy.tick()).reasons!.join(' '), /Kafe açık/);
  store.close();
});

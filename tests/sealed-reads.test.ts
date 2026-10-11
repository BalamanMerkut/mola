import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { seal } from '../server/sealing.js';
import { Store, snapshotKey } from '../server/store.js';
import { recordPayment, submitOrder } from '../packages/domain/engine.js';
import { StockBook } from '../server/stock.js';
import { businessDay } from '../packages/domain/business-day.js';
import { temp } from './merkez-fixture.js';

// Found by the five-year test (docs/HIZ_TESTI_5_YIL.md): reading thousands of sealed rows spent most of its time opening the
// same business key again for every row, and the first report after a start read every settled bill for the longest one.

test('a business key is opened once and served again only while its row is unchanged', () => {
  const store = new Store(temp('sealed-reads'), ['mola-demo']);
  try {
    const first = snapshotKey(store.db, store.key, 'mola-demo'), again = snapshotKey(store.db, store.key, 'mola-demo');
    assert.ok(first && first.length === 32);
    assert.equal(again, first, 'the same opened key, not opened again');
    // The row changes (another key sealed into it): the new key, never the remembered one.
    const other = randomBytes(32);
    store.db.prepare('UPDATE tenant_keys SET payload=? WHERE tenant=?').run(seal({ key: other.toString('hex') }, store.key, 'tenant-key:mola-demo'), 'mola-demo');
    assert.deepEqual(snapshotKey(store.db, store.key, 'mola-demo'), other);
    // Another master key cannot open the row: it fails as before instead of answering from memory.
    assert.throws(() => snapshotKey(store.db, randomBytes(32), 'mola-demo'));
    store.db.prepare('DELETE FROM tenant_keys WHERE tenant=?').run('mola-demo');
    assert.equal(snapshotKey(store.db, store.key, 'mola-demo'), undefined, 'a removed row is gone at once');
  } finally { store.close(); }
});

test('the longest bill is read from its index, and stays exact as bills settle', () => {
  const store = new Store(temp('sealed-reads'), ['mola-demo']);
  try {
    const plan = (store.db.prepare("EXPLAIN QUERY PLAN SELECT COALESCE(MAX(closed_at-first_at),0) AS span FROM history_archives WHERE tenant=?").all('mola-demo') as { detail: string }[]).map(r => r.detail).join(' ');
    assert.match(plan, /history_archives_span/);
    const s = store.read('mola-demo'), table = s.tables[0], waiter = { tenantId: 'mola-demo', id: 'garson', role: 'waiter' as const }, cashier = { tenantId: 'mola-demo', id: 'kasiyer', role: 'cashier' as const };
    // A table open for three hours, paid and settled: the reports read three hours back from every closing time.
    const opened = Date.parse('2026-10-04T15:00:00Z'), ctx = (t: number) => ({ now: new Date(t), id: randomUUID });
    const o = submitOrder(s, waiter, { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx(opened));
    const a = s.accounts.find(x => x.id === o.accountId)!;
    recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500 }, ctx(opened + 3 * 3600_000));
    store.clock = () => new Date(opened + 40 * 3600_000);
    store.mutate('mola-demo', x => Object.assign(x, s));
    const span = (store.db.prepare('SELECT COALESCE(MAX(closed_at-first_at),0) AS span FROM history_archives WHERE tenant=?').get('mola-demo') as { span: number }).span;
    assert.equal(span, 3 * 3600_000);
    assert.equal(store.history.archives('mola-demo', opened, opened + 1).length, 1, 'a bill that started inside the range is found by its later closing');
  } finally { store.close(); }
});

test('a business that uses stock reads every stored day at start-up, in slices, before the first low-stock check', async () => {
  const store = new Store(temp('sealed-reads'), ['mola-demo']);
  try {
    // One settled bill 500 days ago, one item in Stok: an item never counted needs every day back to then.
    const s = store.read('mola-demo'), long = Date.parse('2026-10-04T12:00:00Z') - 500 * 86400_000, ctx = (t: number) => ({ now: new Date(t), id: randomUUID });
    const o = submitOrder(s, { tenantId: 'mola-demo', id: 'garson', role: 'waiter' }, { requestId: randomUUID(), tableId: s.tables[0].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, ctx(long));
    const a = s.accounts.find(x => x.id === o.accountId)!;
    recordPayment(s, { tenantId: 'mola-demo', id: 'kasiyer', role: 'cashier' }, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3500, tendered: 3500 }, ctx(long + 60_000));
    store.clock = () => new Date(long + 2 * 86400_000); store.mutate('mola-demo', x => Object.assign(x, s));
    const book = new StockBook(store);
    book.put('mola-demo', 'item', { id: 'sut', name: 'Süt', unit: 'ml', createdAt: new Date(long - 86400_000).toISOString() }, new Date(long - 86400_000).toISOString());
    const asked = new Set<string>(), storedDay = store.history.storedDay.bind(store.history);
    store.history.storedDay = (tenant, day) => { asked.add(day); return storedDay(tenant, day); };
    assert.equal(book.warmed, false);
    await book.warm({ now: Date.parse('2026-10-04T12:00:00Z') });
    assert.equal(book.warmed, true);
    assert.ok(asked.has(businessDay(long)), 'the day 500 days back was read');
    assert.equal(asked.size, 501);
  } finally { store.close(); }
});
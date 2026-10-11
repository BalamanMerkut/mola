import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { expenseGroupOf, fromDrawer, payFields } from '../packages/domain/expense-rules.js';
import type { Expense } from '../packages/domain/types.js';
import { client, licensed, temp } from './merkez-fixture.js';

/*
 * 9 Ekim K-K: Stok → Alış kaydet asks "Para nereden çıktı? Kasadan / Kasa dışından / Ödenmedi (veresiye)" instead of the
 * "Gider olarak da kaydet" box. Kasadan is a drawer expense (the expected cash drops, the owner is asked below zero, the Müdür
 * never), Kasa dışından an expense paid otherwise, Ödenmedi no expense (the entry keeps `unpaid`). The answer must fit the
 * expense sent with it; screens without `paid` work as before.
 */
test('K-K stok alışı "Para nereden çıktı?": Kasadan, Kasa dışından, Ödenmedi; the expected cash, the reports and the checks', async t => {
  const store = new Store(temp('stock-paid')); licensed(store);
  const tenant = 'mola-demo', clock = new Date('2026-10-09T07:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = async (username: string, password = DEMO_PASSWORD) => { const c = client(base); assert.equal((await c('/login', { username, password })).status, 200); return c; };
  store.mutate(tenant, s => { s.setupCompleted = true; });
  const owner = await login('isletme'), cashier = await login('kasiyer');
  assert.equal((await owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: 'MudurDeneme!2026' })).status, 200);
  const manager = await login('mudur', 'MudurDeneme!2026');
  const sut = (await owner('/staff/stock/items', { name: 'Süt', unit: 'ml' })).data.item.id as string;
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 10000 })).status, 200); // ₺100 in the drawer
  const expected = async () => (await owner('/staff/cash/expected')).data.expected as number;
  const buy = (who: typeof owner, body: object) => who('/staff/stock/purchase', { requestId: randomUUID(), itemId: sut, quantity: 1000, ...body });
  const stockExpenses = async () => ((await owner('/staff/reports/financial?from=2026-10-09&to=2026-10-09')).data.expenses as Expense[]).filter(e => expenseGroupOf(e) === 'stock' && !e.deletedAt);

  // Kasadan: a drawer expense; ₺100 → ₺70.
  const drawer = await buy(owner, { total: 3000, paid: 'drawer', expense: true, ...payFields('drawer') });
  assert.equal(drawer.status, 200, JSON.stringify(drawer.data)); assert.ok(drawer.data.entry.expenseId); assert.equal(drawer.data.entry.unpaid, undefined);
  assert.equal(await expected(), 7000);
  // Kasa dışından: card, transfer, the owner's pocket — an expense, the drawer stays.
  for (const how of ['card', 'transfer', 'outside', 'other'] as const) assert.equal((await buy(owner, { total: 1000, paid: 'outside', expense: true, ...payFields(how) })).status, 200, how);
  assert.equal(await expected(), 7000);
  // Ödenmedi (veresiye): the stock only, no expense now.
  const unpaid = await buy(owner, { total: 5000, paid: 'unpaid', expense: false });
  assert.equal(unpaid.status, 200); assert.equal(unpaid.data.entry.unpaid, true); assert.equal(unpaid.data.entry.expenseId, undefined);
  assert.equal(await expected(), 7000);
  const written = await stockExpenses();
  assert.equal(written.length, 5, 'Kasadan + four Kasa dışından; nothing for Ödenmedi');
  assert.equal(written.filter(e => fromDrawer(e)).length, 1, 'only Kasadan lowers the drawer');
  assert.ok(written.every(e => e.description.startsWith('Stok alışı: Süt')), '"Stok alışları dahil" in the reports');

  // The answer must fit the expense sent with it.
  for (const wrong of [
    { total: 1000, paid: 'unpaid', expense: true, ...payFields('drawer') },
    { total: 1000, paid: 'drawer', expense: true, ...payFields('card') },
    { total: 1000, paid: 'drawer', expense: true, ...payFields('outside') },
    { total: 1000, paid: 'drawer' },
    { total: 1000, paid: 'outside', expense: true, ...payFields('drawer') },
    { total: 1000, paid: 'outside' },
  ]) { const r = await buy(owner, wrong); assert.equal(r.status, 400, JSON.stringify(wrong)); assert.equal(r.data.code, 'INVALID_PAID'); }
  assert.equal((await buy(owner, { paid: 'cash', total: 1000 })).status, 400, 'an unknown answer');
  assert.equal((await buy(owner, { total: 0, paid: 'drawer', expense: true, ...payFields('drawer') })).data.code, 'INVALID_TOTAL', 'Kasadan needs an amount');
  assert.equal((await stockExpenses()).length, 5,'nothing written by the refused ones');

  // Kasadan below zero: the owner is asked (the note under the question), the form's own save sends `confirm`.
  const big = { total: 9000, paid: 'drawer', expense: true, ...payFields('drawer') };
  const asked = await buy(owner, big);
  assert.equal(asked.status, 409); assert.equal(asked.data.code, 'CASH_BELOW_ZERO'); assert.match(asked.data.message, /Kasada şu an ₺70 görünüyor; bu çıkışla −₺20 olur/);
  assert.equal((await buy(owner, { ...big, confirm: true })).status, 200);
  assert.equal(await expected(), -2000);
  // The Müdür buys stock too: never asked about the drawer (K1), the expense is from the drawer all the same.
  assert.equal((await buy(manager, { total: 1000, paid: 'drawer', expense: true, ...payFields('drawer') })).status, 200);
  assert.equal(await expected(), -3000);
  assert.equal((await buy(manager, { total: 1000, paid: 'unpaid' })).status, 200);
  // The kitchen buys nothing; a screen of before (no `paid`) still records as it did.
  assert.equal((await buy(await login('mutfak'), { total: 1000, paid: 'unpaid' })).status, 403);
  const old = await buy(owner, { total: 2000 });
  assert.equal(old.status, 200); assert.equal(old.data.entry.unpaid, undefined); assert.equal(old.data.entry.expenseId, undefined);
  assert.equal((await buy(owner, { total: 2000, expense: true, method: 'card' })).status, 200);
  // Son hareketler shows "Ödenmedi (veresiye)"; İşlem geçmişi says it too.
  const history = (await owner('/staff/stock/history?range=all&q=veresiye')).data;
  assert.equal(history.total, 2); assert.match(history.events[0].note, /Ödenmedi \(veresiye\)/);
});

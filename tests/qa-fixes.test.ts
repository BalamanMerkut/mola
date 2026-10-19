import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { moneyError, moneyInput, parseMoney } from '../src/api.js';
import { saatEki } from '../packages/domain/saat-eki.js';
import { summarize } from '../packages/domain/history.js';
import { eventReport, type CafeEvent } from '../packages/domain/reservations.js';
import { validationMessage } from '../server/request-diagnostics.js';
import type { Order, Payment } from '../packages/domain/types.js';
import { licensed, temp } from './merkez-fixture.js';

test('money typed the Turkish way: thousands dots, comma kuruş, one dot with two digits; garbage is refused with a reason', () => {
  for (const [text, kurus] of [['1250', 125000], ['1.250', 125000], ['25.000', 2500000], ['1.000.000', 100000000], ['1.250,50', 125050], ['1250,5', 125050], ['1250.50', 125050], ['12.5', 1250], ['0', 0], ['₺1.250', 125000], ['1250 TL', 125000], [' 35,90 ', 3590]] as const)
    assert.equal(parseMoney(text), kurus, text);
  for (const text of ['1,250.50', '12,505', '1.25.0', '1250.500', '12a', '', '-5', '1.2345', '10000000']) assert.ok(Number.isNaN(parseMoney(text)), text);
  assert.equal(moneyError('1.250'), ''); assert.equal(moneyError(''), 'Tutarı yazın.'); assert.equal(moneyError('', { required: false }), '');
  assert.match(moneyError('1,250.50'), /Binlik için nokta, kuruş için virgül/);
  assert.match(moneyError('12,505'), /iki hane/);
  assert.match(moneyError('12a'), /Yalnız rakam/);
  assert.match(moneyError('0'), /Sıfırdan büyük/); assert.equal(moneyError('0', { min: 0 }), '');
  assert.match(moneyError('600', { max: 50000 }), /En fazla ₺500/);
  for (const k of [125000, 125050, 3590, 0, 100000000]) assert.equal(parseMoney(moneyInput(k)), k, `${k} → ${moneyInput(k)} → back`);
  assert.equal(moneyInput(125050), '1.250,50'); assert.equal(moneyInput(17900), '179');
});

test('Turkish endings after a clock time follow the last word read aloud', () => {
  const cases: [string, 'den' | 'de' | 'e', string][] = [['01:24', 'den', "01:24'ten"], ['01:24', 'de', "01:24'te"], ['09:02', 'den', "09:02'den"], ['14:30', 'de', "14:30'da"], ['12:40', 'den', "12:40'tan"],
    ['05:00', 'e', "05:00'e"], ['05:00', 'de', "05:00'te"], ['06:00', 'e', "06:00'ya"], ['10:00', 'de', "10:00'da"], ['23:00', 'e', "23:00'e"], ['18:05', 'den', "18:05'ten"], ['21:09', 'de', "21:09'da"], ['20:00', 'den', "20:00'den"], ['13:50', 'e', "13:50'ye"], ['07:03', 'de', "07:03'te"]];
  for (const [time, ek, want] of cases) assert.equal(saatEki(time, ek), want, `${time} + ${ek}`);
  // 19 Ekim: a date before the time ("Açık · 19 Ekim 11:30'dan beri", a campaign "… 14:00'e kadar"); the endings the old fixed
  // "'de"/"'den" got wrong (14:30'de, 13:00'de, 15:40'de).
  const more: [string, 'den' | 'de' | 'e', string][] = [['19 Ekim 11:30', 'den', "19 Ekim 11:30'dan"], ['19 Eki 2026 14:00', 'e', "19 Eki 2026 14:00'e"], ['3 Kasım 15:40', 'de', "3 Kasım 15:40'ta"],
    ['14:30', 'de', "14:30'da"], ['11:50', 'den', "11:50'den"], ['13:00', 'de', "13:00'te"], ['13:00', 'den', "13:00'ten"], ['15:40', 'de', "15:40'ta"], ['19 Ekim', 'den', "19 Ekim'den"]];
  for (const [time, ek, want] of more) assert.equal(saatEki(time, ek), want, `${time} + ${ek}`);
});

test('Rezervasyon: a normal table merged into an event bill neither counts as an event table nor inflates the reserved part of the payment', () => {
  const at = '2026-10-04T18:00:00.000Z';
  const order = (id: string, accountId: string, total: number, eventId?: string): Order => ({ id, accountId, total, status: 'served', createdAt: at, lines: [], source: 'staff', guestId: 'garson', ...(eventId ? { reservation: { eventId } } : {}) }) as unknown as Order;
  const pay = (accountId: string, amount: number): Payment => ({ id: randomUUID(), accountId, amount, tendered: amount, change: 0, method: 'cash', createdAt: at, commission: 0 });
  // D1's bill: 350 of event orders plus a 35 tea merged in from Masa 05, paid 385 at once.
  const orders = [order('o1', 'd1', 35000, 'e1'), order('o2', 'd1', 3500)];
  const day = summarize({ orders, payments: [pay('d1', 38500)], refunds: [], expenses: [], closed: [] }, Date.parse('2026-10-04T02:00:00Z'), Date.parse('2026-10-05T02:00:00Z')).get('2026-10-04')!;
  assert.equal(day.reservation, 35000, 'only the event orders\' share of the payment');
  const event = { id: 'e1', name: 'Derbi', day: '2026-10-04', start: '21:00', startAt: at, hideNormal: false, tables: [{ id: 't-d1', name: 'D1' }, { id: 't-d2', name: 'D2' }], createdAt: at, by: 'x', byName: 'X' } as CafeEvent;
  // D2's bill was moved to the normal Masa 29 later: its event orders still count, the normal table is not an event table.
  const report = eventReport(event, [], [...orders, order('o3', 'd2', 10000, 'e1')], [{ id: 'd1', tableId: 't-d1', guest: { name: 'A', people: 4 } }, { id: 'd2', tableId: 'masa-29', guest: { name: 'B', people: 2 } }]);
  assert.equal(report.tablesUsed, 1, 'not "2/2" with Masa 29 counted'); assert.ok(report.tablesUsed <= report.tables);
  assert.equal(report.revenue, 45000); assert.equal(report.people, 6);
});

test('a rejected form names the field: the rule written for it, else its name', () => {
  const username = z.object({ username: z.string().regex(/^[a-z]+$/, 'Kullanıcı adında boşluk olamaz.') });
  assert.equal(validationMessage(username.safeParse({ username: 'a b' }).error!), 'Kullanıcı adında boşluk olamaz.');
  assert.equal(validationMessage(z.object({ password: z.string().min(10) }).safeParse({ password: 'kısa' }).error!), 'Alanları kontrol edin: şifre.');
  assert.equal(validationMessage(z.object({ x: z.number() }).safeParse({ x: 'a' }).error!), 'Alanları kontrol edin.');
});

async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const directory = temp('qa-fixes'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(username: string) {
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json() as any };
    };
    return Object.assign(call, { login: () => call('/login', { username, password: DEMO_PASSWORD }) });
  }
  const owner = client('isletme'), cashier = client('kasiyer'), waiter = client('garson');
  for (const c of [owner, cashier, waiter]) assert.equal((await c.login()).status, 200);
  const tables = (await owner('/staff/state')).data.tables;
  const sell = async (table = 0, method: 'cash' | 'card' = 'cash') => {
    const placed = await waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[table].id, lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 });
    assert.equal(placed.status, 200, JSON.stringify(placed.data));
    const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === placed.data.accountId).account;
    assert.equal((await cashier('/staff/payments', { requestId: randomUUID(), accountId: account.id, version: account.version, method, amount: 14000, tendered: 14000 })).status, 200);
  };
  return { store, owner, cashier, waiter, sell, set: (iso: string) => { clock = new Date(iso); } };
}

test('the Kasa strip knows: nothing sold yet, sales after gün sonu (one more closing), and a running handover', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  assert.equal((await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).status, 200);
  let status = (await c.cashier('/staff/cash/status')).data;
  assert.equal(status.sold, false, 'opened, nothing sold: no "Bütün hesaplar kapandı" after the closing time');
  await c.sell();
  status = (await c.cashier('/staff/cash/status')).data;
  assert.equal(status.sold, true); assert.equal(status.handover, null);
  // A handover: the strip says "Devir 12:00 · ₺640", not the morning's opening.
  c.set('2026-10-04T09:00:00Z');
  const handover = (await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'handover', counted: 64000 })).data;
  await c.cashier('/staff/cash/finish', { id: handover.id });
  status = (await c.cashier('/staff/cash/status')).data;
  assert.deepEqual([status.handover.amount, status.handover.byName, status.handover.at], [64000, 'Kasiyer', '2026-10-04T09:00:00.000Z']);
  assert.equal(JSON.stringify(status).includes('expected'), false, 'still blind');
  // Gün sonu; then the night goes on with another sale: "Gün sonundan sonra satış var".
  c.set('2026-10-04T20:00:00Z');
  const final = (await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 64000 })).data;
  await c.cashier('/staff/cash/finish', { id: final.id });
  status = (await c.cashier('/staff/cash/status')).data;
  assert.ok(status.closedToday); assert.equal(status.afterClose, false);
  c.set('2026-10-04T21:00:00Z');
  await c.sell(1);
  status = (await c.cashier('/staff/cash/status')).data;
  assert.equal(status.afterClose, true);
  // The extra closing counts only what came after.
  c.set('2026-10-04T21:30:00Z');
  const extra = (await c.cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 64000 + 14000 })).data;
  const full = (await c.owner(`/staff/cash/closing/${extra.id}`)).data.closing;
  assert.deepEqual([full.figures.opening, full.figures.cashSales, full.difference], [64000, 14000, 0]);
});

test('the owner\'s cash out that would leave the drawer below zero waits for "Yine de kaydet"; the cashier never learns the amount', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  assert.equal((await c.cashier('/staff/cash/open', { requestId: randomUUID(), amount: 10000 })).status, 200);
  const requestId = randomUUID(), took = { requestId, type: 'owner_took', amount: 10900 };
  const refused = await c.owner('/staff/cash/movements', took);
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'CASH_BELOW_ZERO'); assert.match(refused.data.message, /beklenen ₺100/);
  assert.equal((await c.owner('/staff/cash/movements', { ...took, confirm: true })).status, 200, 'confirmed: saved as typed');
  { const again = await c.owner('/staff/cash/movements', { ...took, confirm: true }); assert.equal(again.status, 200, JSON.stringify(again.data)); }
  assert.equal((await c.owner('/staff/cash/movements', { requestId: randomUUID(), type: 'owner_in', amount: 50000 })).status, 200, 'money in is never asked');
  // An owner's cash expense of today, likewise; a card one or one dated earlier is not the drawer's.
  const expense = { requestId: randomUUID(), amount: 60000, description: 'Tedarikçi', method: 'cash' };
  assert.equal((await c.owner('/staff/expenses', expense)).data.code, 'CASH_BELOW_ZERO');
  assert.equal((await c.owner('/staff/expenses', { ...expense, requestId: randomUUID(), method: 'card' })).status, 200);
  assert.equal((await c.owner('/staff/expenses', { ...expense, requestId: randomUUID(), day: '2026-10-01' })).status, 200);
  assert.equal((await c.owner('/staff/expenses', { ...expense, confirm: true })).status, 200, '"Yine de kaydet" resends the same request');
  // The cashier: no such question (it would tell the expected amount before the blind count).
  assert.equal((await c.cashier('/staff/expenses', { requestId: randomUUID(), amount: 900000, description: 'Büyük gider' })).status, 200);
});

test('a stock purchase written as an expense needs its payment method; the owner account form names what is wrong', async t => {
  const c = await cafe(t, '2026-10-04T06:00:00Z');
  const item = (await c.owner('/staff/stock/items', { name: 'Süt', unit: 'ml', min: null, unitCost: null, initial: 0 })).data;
  const itemId = item.item?.id ?? item.id;
  const purchase = { requestId: randomUUID(), itemId, quantity: 1000, total: 4500, expense: true };
  const refused = await c.owner('/staff/stock/purchase', purchase);
  assert.equal(refused.status, 400); assert.equal(refused.data.code, 'INVALID_METHOD');
  assert.equal((await c.owner('/staff/stock/purchase', { ...purchase, requestId: randomUUID(), method: 'transfer' })).status, 200);
  // The VALIDATION_ERROR of a wrong username says the rule (server/kafe-routes.ts; the route itself answers only while pending).
  const schema = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,31}$/, 'Kullanıcı adı küçük harfle başlamalı; yalnız küçük harf, rakam, nokta, alt çizgi ve tire olabilir (3–32 karakter, boşluk yok).') });
  assert.match(validationMessage(schema.safeParse({ username: 'ayşe kafe' }).error!), /boşluk yok/);
});

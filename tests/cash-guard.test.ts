import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * Kasa güvenliği (14 Ekim; packages/domain/cash.ts CashGuard): six switches, all off until the owner turns them on. The story
 * of the owner's question: a cashier takes 400 TL and counts 400 more at the gün sonu. With the switches on the gap cannot
 * hide: the money taken out waits for the owner's "Teslim aldım", the morning count is blind, a devir is counted by the one
 * who takes over, a card day needs the POS total, only the owner takes a gün sonu back, a method change is told.
 */
async function cafe(t: { after: (fn: () => Promise<void>) => void }, start: string) {
  const store = new Store(temp('cash-guard')); licensed(store);
  let clock = new Date(start);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() {
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json() as any };
    };
    return Object.assign(call, { login: (username: string, password = DEMO_PASSWORD) => call('/login', { username, password }) });
  }
  return { client, set: (iso: string) => { clock = new Date(iso); } };
}
const ALL_ON = { blindOpening: true, receipt: true, handoverCount: true, strictCount: true, posRequired: true, methodAlert: true };

test('Kasa güvenliği: off by default; with every switch on the 400 TL taken shows at the owner\'s "Teslim aldım", the blind morning and the devir count', async t => {
  const c = await cafe(t, '2026-10-14T06:00:00Z');
  const owner = c.client(), cashier = c.client(), waiter = c.client(), manager = c.client();
  assert.equal((await owner.login('isletme')).status, 200);
  assert.equal((await cashier.login('kasiyer')).status, 200);
  assert.equal((await waiter.login('garson')).status, 200);
  assert.equal((await owner('/staff/users', { username: 'mudur.kasa', name: 'Müdür Selin', role: 'manager', password: 'MudurKasa!2026' })).status, 200);
  assert.equal((await manager.login('mudur.kasa', 'MudurKasa!2026')).status, 200);

  // Off by default: nothing changes for a business that does not want it.
  assert.deepEqual((await owner('/staff/cash/settings')).data.guard, undefined);
  assert.equal((await cashier('/staff/cash/settings', { guard: { blindOpening: true } })).status, 403, 'the owner\'s switches');
  assert.equal((await owner('/staff/cash/settings', { guard: { unknown: true } })).status, 400);
  assert.equal((await owner('/staff/cash/settings', { guard: ALL_ON })).status, 200);
  assert.deepEqual((await owner('/staff/cash/settings')).data.guard, ALL_ON);
  // One switch at a time leaves the others.
  assert.deepEqual((await owner('/staff/cash/settings', { guard: { methodAlert: false } })).data.guard, { ...ALL_ON, methodAlert: false });
  assert.equal((await owner('/staff/cash/settings', { guard: { methodAlert: true } })).status, 200);
  // Sayımı sıkılaştır hides the yazar kasa split: the helper is on here (the business's own choice, Kart ve yazar kasa).
  assert.equal((await owner('/staff/cash/settings', { fiscalHelper: true })).status, 200);

  // The first opening (nothing carried) and a day: one cash bill and one card bill.
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).status, 200);
  const tables = (await owner('/staff/state')).data.tables;
  const sell = async (tableId: string, method: 'cash' | 'card') => {
    const r = await waiter('/staff/orders', { requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const account = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === r.data.accountId).account;
    const paid = await cashier('/staff/payments', { requestId: randomUUID(), accountId: r.data.accountId, version: account.version, method, amount: 14000, tendered: 14000 });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
  };
  await sell(tables[0].id, 'cash'); await sell(tables[1].id, 'card'); await sell(tables[2].id, 'card');

  // Ödeme türü değişince bildir: the Müdür writes one card payment as cash; the owner hears it, with who took it.
  c.set('2026-10-14T12:00:00Z');
  const ledger = (await owner('/staff/payment-adjustments?from=2026-10-14&to=2026-10-14')).data.rows;
  const card = ledger.find((r: any) => r.method === 'card');
  const changed = await manager('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: card.paymentId ?? card.id, revision: 0, kind: 'method', amount: 0, method: 'cash', commission: 0, reason: 'Yanlış tuşa basılmış' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  let inbox = (await owner('/staff/notifications')).data.items;
  const method = inbox.find((n: any) => n.title.startsWith('Ödeme türü değişti'));
  assert.ok(method, 'the owner hears about the method change'); assert.match(method.text, /Müdür Selin/); assert.match(method.text, /alan: Kasiyer/);

  // POS toplamı zorunlu: a window with card money is not counted without it.
  c.set('2026-10-14T19:30:00Z');
  assert.equal((await cashier('/staff/cash/status')).data.settings.posRequired, true);
  assert.equal((await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 78000 })).data.code, 'POS_REQUIRED');
  // The cashier took 400 TL: 780 should be there, 380 is; they count 780 anyway.
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 78000, pos: 14000 });
  assert.equal(counted.status, 200, JSON.stringify(counted.data));
  // Sayımı sıkılaştır: the counter's yazar kasa part has no cash / card split and no payment list.
  assert.equal(counted.data.fiscal?.hiddenSplit, true); assert.equal(counted.data.fiscal.cash, 0); assert.deepEqual(counted.data.fiscal.open, []);
  assert.ok((await owner(`/staff/cash/closing/${counted.data.id}`)).data.closing.fiscal.cash > 0, 'the owner keeps the whole picture');
  // 380 is left in the drawer for tomorrow, "400" leaves in the envelope: no difference on paper.
  const done = await cashier('/staff/cash/finish', { id: counted.data.id, left: 38000 });
  assert.equal(done.status, 200); assert.equal(done.data.closing.taken, 40000);
  const closingNote = (await owner('/staff/notifications')).data.items.find((n: any) => n.title.startsWith('Kasa kapatıldı'));
  assert.match(closingNote.text, /Kasadan çıkarılan ₺400, kasada bırakılan ₺380 \(teslim almanızı bekliyor\)/);
  // Only the owner takes the gün sonu back.
  assert.match((await cashier('/staff/cash/status')).data.closedToday.revoke, /yalnız işletme sahibi/);
  assert.equal((await cashier('/staff/cash/revoke', { requestId: randomUUID(), id: counted.data.id, reason: 'Yeniden sayacağım' })).data.code, 'CANNOT_REVOKE');

  // The owner opens the envelope: 0 TL. The 400 cannot hide any more.
  const status = (await owner('/staff/cash/status')).data;
  assert.deepEqual(status.receipts.map((r: any) => [r.closingId, r.taken, r.byName]), [[counted.data.id, 40000, 'Kasiyer']]);
  assert.equal((await cashier('/staff/cash/receipts')).status, 403);
  assert.equal((await owner('/staff/cash/receipts', { requestId: randomUUID(), closingId: counted.data.id, received: 0 })).data.code, 'NOTE_REQUIRED');
  const received = await owner('/staff/cash/receipts', { requestId: randomUUID(), closingId: counted.data.id, received: 0, note: 'Zarf boş geldi' });
  assert.equal(received.status, 200); assert.equal(received.data.difference, -40000);
  assert.equal((await owner('/staff/cash/receipts', { requestId: randomUUID(), closingId: counted.data.id, received: 40000 })).data.code, 'ALREADY_RECEIVED');
  assert.deepEqual((await owner('/staff/cash/receipts')).data.receipts, []);
  const report = (await owner('/staff/reports/cash-closings?from=2026-10-14&to=2026-10-14')).data;
  assert.equal(report.closings[0].receipt.difference, -40000);
  assert.equal((await owner(`/staff/cash/closing/${counted.data.id}`)).data.receipt.received, 0);

  // Açılışta kör sayım: the next morning nobody sees the 380 carried; any difference reaches the owner. (Sessions end at 05:00.)
  c.set('2026-10-15T06:00:00Z');
  for (const [who, name, pw] of [[owner, 'isletme'], [cashier, 'kasiyer'], [manager, 'mudur.kasa', 'MudurKasa!2026']] as const) assert.equal((await who.login(name, pw)).status, 200);
  let morning = (await cashier('/staff/cash/status')).data;
  assert.equal(morning.showOpening, true); assert.equal(morning.blindOpening, true); assert.equal(morning.carried, null); assert.equal(morning.opening.amount, 0);
  assert.equal(JSON.stringify(morning).includes('38000'), false, 'the carried amount is nowhere in the answer');
  assert.equal((await owner('/staff/cash/status')).data.carried, 38000, 'the owner still sees it');
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 37000 })).status, 200, 'no note asked for a difference never seen');
  inbox = (await owner('/staff/notifications')).data.items;
  assert.match(inbox.find((n: any) => n.title.startsWith('Açılışta kasa farkı')).text, /kör sayım/);

  // Vardiya devrini alan da sayar: the cashier hands over 370; the Müdür counts blind and finds 360.
  c.set('2026-10-15T14:00:00Z');
  const handover = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'handover', counted: 37000 });
  assert.equal(handover.status, 200, JSON.stringify(handover.data));
  assert.equal((await cashier('/staff/cash/finish', { id: handover.data.id })).status, 200);
  const incoming = (await manager('/staff/cash/status')).data;
  assert.equal(incoming.showOpening, true); assert.equal(incoming.blindOpening, true); assert.equal(incoming.handoverWaiting.byName, 'Kasiyer');
  assert.equal(incoming.handover, null, 'the amount handed over is not shown'); assert.equal(incoming.carried, null);
  assert.equal((await manager('/staff/cash/open', { requestId: randomUUID(), amount: 36000 })).status, 200);
  const devir = (await owner('/staff/notifications')).data.items.find((n: any) => n.title.startsWith('Vardiya devrinde fark'));
  assert.ok(devir); assert.match(devir.title, /−₺10/); assert.match(devir.text, /Kasiyer ₺370 devretti, Müdür Selin kör sayımda ₺360 saydı/);
  morning = (await manager('/staff/cash/status')).data;
  assert.equal(morning.showOpening, false); assert.equal(morning.handoverWaiting, null);
});

test('Kasa güvenliği off: everything as before (the carried amount is shown, the counter may take back their own gün sonu, no POS needed)', async t => {
  const c = await cafe(t, '2026-10-14T06:00:00Z');
  const owner = c.client(), cashier = c.client();
  assert.equal((await owner.login('isletme')).status, 200); assert.equal((await cashier.login('kasiyer')).status, 200);
  assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 50000 })).status, 200);
  c.set('2026-10-14T19:30:00Z');
  const counted = await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 50000 });
  assert.equal(counted.status, 200); assert.equal(counted.data.fiscal?.hiddenSplit, undefined);
  assert.equal((await cashier('/staff/cash/finish', { id: counted.data.id, left: 30000 })).status, 200);
  assert.equal((await cashier('/staff/cash/status')).data.closedToday.revoke, null);
  assert.deepEqual((await owner('/staff/cash/status')).data.receipts, [], 'no receipt is asked');
  c.set('2026-10-15T06:00:00Z');
  assert.equal((await cashier.login('kasiyer')).status, 200);
  const morning = (await cashier('/staff/cash/status')).data;
  assert.equal(morning.carried, 30000); assert.equal(morning.blindOpening, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { totp } from '../server/totp.js';
import { MANAGER_CAN, MANAGER_CANNOT, employeeRoles, isManagement, roleNames } from '../packages/domain/roles.js';
import { canReserve, canRunEvents, seesGuestContact } from '../packages/domain/reservations.js';
import { licensed, temp } from './merkez-fixture.js';

/*
 * The Müdür role and the owner's other role decisions of 5 October: every role × action (allowed answers anything but
 * 403, forbidden answers exactly 403), the Müdür's forbidden list one by one, the report code a Müdür must type, QR
 * "Otomatik onay" (never the kitchen), "Temizlendi" for the cashier, reservation phones never reaching a waiter, and no
 * reservation guest or event name on the kitchen's screen.
 */
const DAY = '2026-10-05', PASSWORD = 'MudurDeneme!2026';
type Answer = { status: number; data: any };
type Client = ((path: string, body?: unknown) => Promise<Answer>) & { login: () => Promise<Answer>; fresh: () => Client };
async function cafe(t: { after: (fn: () => Promise<void>) => void }, start = '2026-10-05T12:00:00Z') {
  const store = new Store(temp('manager-role')); licensed(store);
  let clock = new Date(start);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client(username: string, password = DEMO_PASSWORD): Client {
    let cookie = '';
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json().catch(() => ({})) as any };
    };
    return Object.assign(call, { login: () => call('/login', { username, password }), fresh: (): Client => client(username, password) });
  }
  const owner = client('isletme'), cashier = client('kasiyer'), waiter = client('garson'), kitchen = client('mutfak');
  for (const c of [owner, cashier, waiter, kitchen]) assert.equal((await c.login()).status, 200);
  const made = await owner('/staff/users', { username: 'mudur', name: 'Müdür Mehmet', role: 'manager', password: PASSWORD });
  assert.equal(made.status, 200, JSON.stringify(made.data)); assert.equal(made.data.role, 'manager');
  const manager = client('mudur', PASSWORD);
  assert.equal((await manager.login()).status, 200);
  return { store, owner, manager, cashier, waiter, kitchen, set: (iso: string) => { clock = new Date(iso); } };
}
type Call = Awaited<ReturnType<typeof cafe>>['owner'];
const rid = () => randomUUID().replace(/-/g, '');

test('roles.ts: the Müdür table, names and the plain rules screens share', () => {
  assert.equal(roleNames.manager, 'Müdür');
  assert.deepEqual([...employeeRoles], ['manager', 'cashier', 'waiter', 'kitchen'], 'never "İşletme sahibi" from Çalışanlar');
  assert.ok(MANAGER_CAN.length >= 8 && MANAGER_CANNOT.length >= 6);
  assert.ok(MANAGER_CANNOT.some(t => t.startsWith('Ayarlar')) && MANAGER_CANNOT.some(t => t.includes('Sahip aldı')));
  assert.equal(isManagement('owner'), true); assert.equal(isManagement('manager'), true); assert.equal(isManagement('cashier'), false);
  // Reservations: the Müdür always writes them and runs events; only waiters are kept from phones and notes.
  assert.equal(canReserve('manager', { roles: [] }), true); assert.equal(canReserve('waiter', { roles: [] }), false); assert.equal(canReserve('kitchen'), false);
  assert.equal(canRunEvents('manager'), true); assert.equal(canRunEvents('waiter'), false);
  assert.deepEqual((['owner', 'manager', 'cashier', 'waiter', 'kitchen'] as const).map(seesGuestContact), [true, true, true, false, false]);
});

test('role × action matrix: owner, Müdür, cashier, waiter and kitchen get exactly their rights (403 otherwise)', async t => {
  const c = await cafe(t);
  assert.equal((await c.owner('/staff/settings', { waiterApproval: true, changeSeconds: 60, commissionBps: null })).status, 200);
  const roles = { owner: c.owner, manager: c.manager, cashier: c.cashier, waiter: c.waiter, kitchen: c.kitchen } as const;
  type R = keyof typeof roles;
  const rows: [string, (x: Call) => Promise<{ status: number; data: any }>, R[]][] = [
    ['ödeme al', x => x('/staff/payments', { requestId: rid(), accountId: 'yok', version: 0, method: 'cash', amount: 100, tendered: 100 }), ['owner', 'manager', 'cashier']],
    ['QR otomatik onay', x => x('/staff/approval-mode', { requestId: rid(), version: 999, enabled: true }), ['owner', 'manager', 'waiter']],
    ['QR siparişi onayla', x => x('/staff/orders/review', { requestId: rid(), orderId: 'yok', version: 1, approve: true }), ['owner', 'manager', 'waiter', 'kitchen']],
    ['Temizlendi', x => x('/staff/tables/clean', { requestId: rid(), tableId: 'yok', epoch: 0 }), ['owner', 'manager', 'cashier', 'waiter']],
    ['sipariş iptali (neden ile)', x => x('/staff/orders/cancel', { requestId: rid(), orderId: 'yok', version: 0, reason: 'Yanlış sipariş' }), ['owner', 'manager', 'waiter', 'kitchen']],
    ['hesap birleştir', x => x('/staff/accounts/merge', { requestId: rid(), sourceId: 'a', sourceVersion: 0, targetId: 'b', targetVersion: 0 }), ['owner', 'manager', 'cashier', 'waiter']],
    ['raporlar', x => x(`/staff/reports/overview?from=${DAY}&to=${DAY}`), ['owner', 'manager']],
    ['iade ve düzeltme listesi', x => x('/staff/payment-adjustments'), ['owner', 'manager']],
    ['kasa kapanışları raporu', x => x(`/staff/reports/cash-closings?from=${DAY}&to=${DAY}`), ['owner', 'manager']],
    ['personel raporu', x => x(`/staff/reports/staff-shifts?from=${DAY}&to=${DAY}`), ['owner', 'manager']],
    ['Kârlılık', x => x(`/staff/reports/profit?from=${DAY}&to=${DAY}`), ['owner', 'manager']],
    ['Stok', x => x('/staff/stock'), ['owner', 'manager', 'kitchen']],
    ['Stok alışı', x => x('/staff/stock/purchase', {}), ['owner', 'manager']],
    ['Kampanyalar', x => x('/staff/campaigns'), ['owner', 'manager']],
    ['ürün kaydet', x => x('/staff/products', { product: { code: '999', name: 'Deneme', nameEn: '', category: '', description: '', price: 0, soldOut: false, art: 'coffee', published: false } }), ['owner', 'manager']],
    ['Ajanda', x => x(`/staff/agenda?from=${DAY}&to=${DAY}`), ['owner', 'manager']],
    ['rezervasyonlar', x => x(`/staff/reservations?from=${DAY}&to=${DAY}`), ['owner', 'manager', 'cashier', 'waiter']],
    ['kasa durumu', x => x('/staff/cash/status'), ['owner', 'manager', 'cashier']],
    ['vardiya kodu', x => x('/staff/shifts/code'), ['owner', 'manager', 'cashier']],
    ['gider kaydı', x => x('/staff/expenses', { requestId: rid(), amount: 100, description: 'Deneme' }), ['owner', 'manager', 'cashier']],
    ['Ayarlar', x => x('/staff/settings', { changeSeconds: 60, commissionBps: null }), ['owner']],
    ['Çalışanlar', x => x('/staff/users'), ['owner']],
    ['ses ayarı', x => x('/staff/sounds', { event: 'ready', on: true }), ['owner']],
  ];
  for (const [name, run, allowed] of rows) for (const role of Object.keys(roles) as R[]) {
    const r = await run(roles[role]);
    if (allowed.includes(role)) assert.notEqual(r.status, 403, `${name}: ${role} izinli olmalı (${JSON.stringify(r.data)})`);
    else assert.equal(r.status, 403, `${name}: ${role} reddedilmeli (${r.status} ${JSON.stringify(r.data)})`);
  }
});

test('Müdür: works the whole day (orders, payment, cash day, refunds, menu, stock, campaigns, reports) and every owner-only action is 403', async t => {
  const c = await cafe(t), m = c.manager;
  const me = (await m('/staff/state')).data;
  assert.equal(me.role, 'manager'); assert.ok(me.paymentContext, 'takes payments'); assert.ok(Array.isArray(me.productDrafts), 'manages the menu');
  assert.equal(me.licenseNotice, undefined); assert.equal(me.commissionBps, null, 'settings stay the owner\'s');
  // An order, its payment and a refund of it.
  const table = me.tables[0];
  assert.equal((await m('/staff/orders', { requestId: rid(), tableId: table.id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 })).status, 200);
  const account = (await m('/staff/state')).data.tables.find((x: any) => x.id === table.id).account;
  assert.equal((await m('/staff/cash/open', { requestId: rid(), amount: 0 })).status, 200, 'kasa açılışı');
  const paid = await m('/staff/payments', { requestId: rid(), accountId: account.id, version: account.version, method: 'cash', amount: 7000, tendered: 10000 });
  assert.equal(paid.status, 200, JSON.stringify(paid.data)); assert.equal(paid.data.closed, true);
  const ledger = (await m(`/staff/payment-adjustments?from=${DAY}&to=${DAY}`)).data;
  const payment = ledger.rows[0];
  assert.equal(payment.amount, 7000);
  const refund = await m('/staff/payment-adjustments', { requestId: rid(), paymentId: payment.id, revision: 0, kind: 'refund', amount: 7000, method: 'cash', commission: 0, reason: 'Müşteri memnun kalmadı' });
  assert.equal(refund.status, 200, `Müdür iade yapabilir (tutar sınırı yok): ${JSON.stringify(refund.data)}`);
  // Kasa: para bozdurma and an expense yes; the owner's cash-outs and corrections no.
  assert.equal((await m('/staff/cash/movements', { requestId: rid(), type: 'exchange', amount: 5000 })).status, 200);
  for (const type of ['owner_took', 'bank', 'other_out', 'owner_in']) assert.equal((await m('/staff/cash/movements', { requestId: rid(), type, amount: 100, note: 'deneme' })).status, 403, type);
  const expense = await m('/staff/expenses', { requestId: rid(), amount: 2500, description: 'Simit' });
  assert.equal(expense.status, 200); assert.equal(expense.data.actorName, 'Müdür Mehmet');
  // The cash day closes with the Müdür too (blind count, then finish).
  const count = await m('/staff/cash/count', { requestId: rid(), mode: 'final', counted: 0 });
  assert.equal(count.status, 200, JSON.stringify(count.data));
  assert.equal((await m('/staff/cash/finish', { id: count.data.id, note: 'Simit parası' })).status, 200);
  // Menu, campaigns, stock and reservations.
  const saved = await m('/staff/products', { product: { code: '901', name: 'Müdür çayı', nameEn: '', category: '', description: '', price: 0, soldOut: false, art: 'tea', published: false } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await m('/staff/campaigns')).status, 200);
  assert.equal((await m('/staff/stock')).status, 200);
  assert.equal((await m('/staff/reservations', { requestId: rid(), tableId: table.id, day: DAY, time: '21:00', name: 'Ayşe', people: 2, phone: '0532 111 22 33' })).status, 200, 'writes reservations whatever Ayarlar says');
  for (const path of ['overview', 'financial', 'products', 'employees', 'profit', 'cash-closings', 'staff-shifts', 'reservations']) assert.equal((await m(`/staff/reports/${path}?from=${DAY}&to=${DAY}`)).status, 200, path);
  assert.equal((await m(`/staff/agenda?from=${DAY}&to=${DAY}`)).status, 200);

  // Everything that stays with the owner: 403, and nothing changes.
  const before = JSON.stringify((await c.owner('/staff/users')).data);
  const forbidden: [string, unknown?][] = [
    ['/staff/settings', { changeSeconds: 60, commissionBps: null }],
    ['/staff/users'], ['/staff/users', { username: 'baska', name: 'Başka', role: 'waiter', password: 'BaskaDeneme!2026' }],
    ['/staff/users/update', { id: 'garson', version: 1, role: 'cashier', active: true }], ['/staff/users/password', { id: 'garson', version: 1, password: 'YeniSifre!2026' }],
    ['/staff/sessions'], ['/staff/sessions/end', { id: 'x' }],
    ['/staff/cash/corrections', { requestId: rid(), closingId: count.data.id, amount: 100, note: 'Düzeltme' }], ['/staff/cash/settings', { shiftTracking: true }],
    ['/staff/expenses/edit', { requestId: rid(), id: expense.data.id, version: 0, amount: 1, description: 'x' }], ['/staff/expenses/delete', { requestId: rid(), id: expense.data.id, version: 0 }],
    ['/staff/recurring-expenses'], ['/staff/recurring-expenses', {}],
    ['/staff/report-security/setup', { password: PASSWORD }], ['/staff/report-security/enable', { code: '123456' }], ['/staff/report-security/recover', { password: PASSWORD, recoveryCode: '0'.repeat(32) }],
    ['/staff/backup-status'], ['/staff/update'], ['/staff/first-steps'], ['/staff/support'], ['/staff/support', { requestId: rid(), subject: 'Deneme', text: 'Deneme metni' }], ['/staff/license/freeze', { requestId: rid(), reason: 'Tatil zamanı', startDate: DAY, days: 3 }],
    ['/staff/integrations'], ['/staff/integrations/credentials', { platform: 'demo', values: {} }], ['/staff/integrations/demo'],
    ['/staff/tables/add', { requestId: rid() }], ['/staff/tables/remove', { requestId: rid(), tableId: table.id, epoch: 0 }], ['/staff/tables/area', { requestId: rid(), tableId: table.id, version: 0, area: 'Teras' }], ['/staff/tables/renew-qr', { requestId: rid(), tableId: table.id }],
    ['/staff/business-profile', { name: 'Başka ad' }], ['/staff/social-links', { requestId: rid(), version: 0, links: { instagram: '@baska' } }],
    ['/staff/shifts/plan', { userId: 'garson', plan: null }], ['/staff/shifts/plans'], ['/staff/shifts/correct', { id: 'x', startAt: '2026-10-05T06:00:00.000Z', note: 'Düzeltme' }], ['/staff/shifts/roles'], ['/staff/shifts/roles', { roles: [] }],
    ['/staff/sounds', { event: 'ready', on: false }], ['/staff/assignments'], ['/staff/assignments', { enabled: true }], ['/staff/printers'], ['/staff/reservations/settings', { roles: [] }],
    ['/staff/profit/settings', { enabled: true, groups: { drinks: 40, food: 40, dessert: 40, ready: 40 } }], ['/staff/photo-storage'], ['/staff/photo-trash'], ['/staff/blocks'],
  ];
  for (const [path, body] of forbidden) { const r = await m(path, body); assert.equal(r.status, 403, `${body === undefined ? 'GET' : 'POST'} ${path}: ${r.status} ${JSON.stringify(r.data)}`); }
  assert.equal(JSON.stringify((await c.owner('/staff/users')).data), before, 'staff unchanged');
  // 10 Ekim: the Müdür has the bell, with only "Kampanya bitti" (never the drawer, licence or backups: K1 kör kasa).
  const bell = await m('/staff/notifications');
  assert.equal(bell.status, 200); assert.ok(bell.data.items.every((n: { kind: string }) => n.kind === 'campaign'), JSON.stringify(bell.data.items));
});

test('Müdür and the report code: reports need the owner\'s code; setting it up or resetting it never', async t => {
  let time = Date.parse('2026-10-05T12:00:00Z');
  const c = await cafe(t);
  c.set(new Date(time).toISOString());
  const setup = await c.owner('/staff/report-security/setup', { password: DEMO_PASSWORD }); assert.equal(setup.status, 200);
  assert.equal((await c.owner('/staff/report-security/enable', { code: totp(setup.data.secret, time) })).status, 200);
  assert.deepEqual((await c.manager('/staff/report-security')).data, { enabled: true, verified: false, until: null, owner: false });
  const locked = await c.manager(`/staff/reports/overview?from=${DAY}&to=${DAY}`);
  assert.equal(locked.status, 403); assert.equal(locked.data.code, 'MFA_REQUIRED');
  assert.equal((await c.manager('/staff/payment-adjustments')).data.code, 'MFA_REQUIRED');
  assert.equal((await c.manager('/staff/report-security/verify', { code: '000000' })).status, 403);
  time += 30_000; c.set(new Date(time).toISOString());
  assert.equal((await c.manager('/staff/report-security/verify', { code: totp(setup.data.secret, time) })).status, 200, 'the owner\'s current code opens the reports');
  assert.equal((await c.manager(`/staff/reports/overview?from=${DAY}&to=${DAY}`)).status, 200);
  // İade ve düzeltme opens with the same code: the list, its totals, one payment, its refund window and a refund.
  const table = (await c.manager('/staff/state')).data.tables[0];
  assert.equal((await c.manager('/staff/orders', { requestId: rid(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200);
  const account = (await c.manager('/staff/state')).data.tables.find((x: any) => x.id === table.id).account;
  assert.equal((await c.manager('/staff/cash/open', { requestId: rid(), amount: 0 })).status, 200);
  assert.equal((await c.manager('/staff/payments', { requestId: rid(), accountId: account.id, version: account.version, method: 'cash', amount: 3500, tendered: 3500 })).status, 200);
  const ledger = await c.manager(`/staff/payment-adjustments?from=${DAY}&to=${DAY}`);
  assert.equal(ledger.status, 200, JSON.stringify(ledger.data)); const pid = ledger.data.rows[0].id;
  assert.equal((await c.manager(`/staff/payment-adjustments/totals?from=${DAY}&to=${DAY}`)).status, 200);
  assert.equal((await c.manager(`/staff/payment-adjustments/${pid}`)).status, 200);
  assert.equal((await c.manager(`/staff/payment-adjustments/${pid}/refund`)).status, 200);
  const refund = await c.manager('/staff/payment-adjustments', { requestId: rid(), paymentId: pid, revision: 0, kind: 'refund', amount: 1000, method: 'cash', commission: 0, reason: 'Eksik servis' });
  assert.equal(refund.status, 200, JSON.stringify(refund.data));
  // Without the code (another Müdür session) the same paths stay closed.
  const other = c.manager.fresh(); assert.equal((await other.login()).status, 200);
  for (const path of [`/staff/payment-adjustments?from=${DAY}&to=${DAY}`, `/staff/payment-adjustments/${pid}`, `/staff/payment-adjustments/${pid}/refund`]) assert.equal((await other(path)).data.code, 'MFA_REQUIRED', path);
  assert.equal((await c.cashier('/staff/report-security/verify', { code: totp(setup.data.secret, time + 30_000) })).status, 403, 'never the cashier');
});

test('QR "Otomatik onay": owner, Müdür and waiter switch it; the kitchen never (it still approves each order)', async t => {
  const c = await cafe(t);
  assert.equal((await c.owner('/staff/settings', { waiterApproval: true, changeSeconds: 0, commissionBps: null })).status, 200);
  const version = async () => (await c.owner('/staff/state')).data.approvalVersion;
  const kitchen = await c.kitchen('/staff/approval-mode', { requestId: rid(), version: await version(), enabled: true });
  assert.equal(kitchen.status, 403);
  for (const [who, on] of [[c.waiter, true], [c.manager, false], [c.owner, true]] as const) {
    const r = await who('/staff/approval-mode', { requestId: rid(), version: await version(), enabled: on });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal((await c.owner('/staff/state')).data.autoApproveQr, on);
  }
  // The kitchen still approves or rejects each QR order (role check passes; the made-up order is simply not found).
  assert.equal((await c.kitchen('/staff/orders/review', { requestId: rid(), orderId: 'yok', version: 1, approve: true })).data.code, 'ORDER_CHANGED');
});

test('Temizlendi: the cashier marks a cleaned table when no waiter is around', async t => {
  const c = await cafe(t);
  assert.equal((await c.owner('/staff/settings', { cleaningEnabled: true, changeSeconds: 0, commissionBps: null })).status, 200);
  const table = (await c.cashier('/staff/state')).data.tables[0];
  await c.cashier('/staff/orders', { requestId: rid(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  const account = (await c.cashier('/staff/state')).data.tables.find((x: any) => x.id === table.id).account;
  assert.equal((await c.cashier('/staff/payments', { requestId: rid(), accountId: account.id, version: account.version, method: 'card', amount: 3500, tendered: 3500 })).status, 200);
  const dirty = (await c.cashier('/staff/state')).data.tables.find((x: any) => x.id === table.id);
  assert.equal(dirty.needsCleaning, true);
  assert.equal((await c.kitchen('/staff/tables/clean', { requestId: rid(), tableId: table.id, epoch: dirty.epoch })).status, 403);
  assert.equal((await c.cashier('/staff/tables/clean', { requestId: rid(), tableId: table.id, epoch: dirty.epoch })).status, 200);
  assert.equal((await c.cashier('/staff/state')).data.tables.find((x: any) => x.id === table.id).needsCleaning, false);
});

test('reservation phones and notes never reach a waiter (list, events, snapshot); the cashier and Müdür read them; a waiter\'s edit keeps them', async t => {
  const c = await cafe(t);
  const table = (await c.owner('/staff/state')).data.tables[1], phone = '0532 444 55 66', note = 'Doğum günü, pastayı 21:00\'de getirin';
  const made = await c.owner('/staff/reservations', { requestId: rid(), tableId: table.id, day: DAY, time: '20:00', name: 'Zeynep Kaya', people: 4, phone, note });
  assert.equal(made.status, 200);
  const list = (who: Call) => who(`/staff/reservations?from=${DAY}&to=${DAY}`);
  const waiterList = await list(c.waiter);
  assert.equal(waiterList.status, 200); assert.equal(waiterList.data.contact, false);
  const seen = waiterList.data.reservations.find((r: any) => r.id === made.data.id);
  assert.equal(seen.name, 'Zeynep Kaya'); assert.equal(seen.phone, undefined); assert.equal(seen.note, undefined);
  assert.equal(JSON.stringify(waiterList.data).includes('444 55 66'), false); assert.equal(JSON.stringify(waiterList.data).includes('Doğum günü'), false);
  assert.equal(JSON.stringify((await c.waiter('/staff/events')).data).includes('444 55 66'), false);
  assert.equal(JSON.stringify((await c.waiter('/staff/state')).data).includes('444 55 66'), false, 'the floor snapshot has no phone');
  for (const who of [c.cashier, c.manager, c.owner]) { const r = (await list(who)).data.reservations.find((x: any) => x.id === made.data.id); assert.equal(r.phone, phone); assert.equal(r.note, note); }
  // A waiter changes the time (the form has no phone or note): both stay.
  assert.equal((await c.waiter('/staff/reservations', { requestId: rid(), id: made.data.id, tableId: table.id, day: DAY, time: '20:30', name: 'Zeynep Kaya', people: 5 })).status, 200);
  const after = (await list(c.cashier)).data.reservations.find((x: any) => x.id === made.data.id);
  assert.deepEqual([after.time, after.people, after.phone, after.note], ['20:30', 5, phone, note]);
  // A waiter may type a phone for a new one, but never reads it back.
  const own = await c.waiter('/staff/reservations', { requestId: rid(), tableId: (await c.owner('/staff/state')).data.tables[2].id, day: DAY, time: '22:00', name: 'Can', people: 2, phone: '0555 123 45 67' });
  assert.equal(own.status, 200);
  assert.equal((await list(c.waiter)).data.reservations.find((x: any) => x.id === own.data.id).phone, undefined);
  assert.equal((await list(c.owner)).data.reservations.find((x: any) => x.id === own.data.id).phone, '0555 123 45 67');
});

test('the kitchen only cooks: no reservation guest name, kapora or event name in its snapshot', async t => {
  const c = await cafe(t);
  const state = (await c.owner('/staff/state')).data, table = state.tables[0];
  const r = await c.owner('/staff/reservations', { requestId: rid(), tableId: table.id, day: DAY, time: '15:30', name: 'Selin Aksoy', people: 2, deposit: { amount: 20000, method: 'cash' } });
  assert.equal((await c.owner('/staff/reservations/seat', { requestId: rid(), id: r.data.id })).status, 200);
  assert.equal((await c.owner('/staff/orders', { requestId: rid(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200);
  const event = await c.owner('/staff/events', { requestId: rid(), name: 'Derbi Gecesi', day: DAY, start: '15:00', count: 2, hideNormal: false });
  assert.equal(event.status, 200, JSON.stringify(event.data));
  await c.owner('/staff/events/start', { requestId: rid(), id: event.data.id });
  const d1 = (await c.owner('/staff/state')).data.eventTables[0];
  assert.equal((await c.owner('/staff/reservations/walk-in', { requestId: rid(), tableId: d1.id, name: 'Mehmet Bey' })).status, 200);
  assert.equal((await c.owner('/staff/orders', { requestId: rid(), tableId: d1.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).status, 200);
  const cook = await c.kitchen('/staff/state'), text = JSON.stringify(cook.data);
  assert.equal(cook.data.orders.length >= 2, true);
  for (const name of ['Selin Aksoy', 'Mehmet Bey', 'Derbi Gecesi']) assert.equal(text.includes(name), false, `${name} mutfağa gitmemeli`);
  assert.equal(cook.data.tables.find((x: any) => x.id === table.id).account.guest, undefined);
  assert.equal(cook.data.tables.find((x: any) => x.id === table.id).account.deposit, undefined);
  // The floor still sees the guest's name.
  assert.equal((await c.waiter('/staff/state')).data.tables.find((x: any) => x.id === table.id).account.guest.name, 'Selin Aksoy');
});

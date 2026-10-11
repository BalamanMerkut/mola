import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutPersonalData } from '../server/package-privacy.js';
import { anonymousGuest } from '../packages/domain/history.js';

/*
 * What a closed year's package leaves behind (server/package-privacy.ts), row by row: the figures' fields stay as they were,
 * a row stripped once has nothing more to strip, a row without personal data is left alone (it goes over byte for byte).
 */
const browser = 'c0ffee'.repeat(8);
const line = (id: string, note?: string) => ({ id, productId: 'tea', name: 'Çay', code: '', optionNames: [], selections: [], quantity: 2, unitPrice: 1500, total: 3000, vatRate: 10, ...(note ? { note } : {}) });

test('package privacy: a bill loses the guest\'s name, the platform customer\'s name and note, every line note and the QR browser id; money stays', () => {
  const bill = {
    id: 'a1', accountId: 'acc1', tableName: 'Yemeksepeti #1234', closedAt: '2025-12-30T12:00:00.000Z', total: 6000, cash: 0, card: 0,
    account: { id: 'acc1', tableId: 't1', status: 'closed', version: 3, openedAt: '2025-12-30T11:00:00.000Z', guest: { name: 'Zeynep Kaya', people: 3, reservationId: 'r1' }, deposit: { reservationId: 'r1', amount: 20000, method: 'cash', takenAt: '2025-12-29T10:00:00.000Z' } },
    orders: [
      { id: 'o1', accountId: 'acc1', guestId: 'platform:yemeksepeti', guestLabel: 'Yemeksepeti', source: 'staff', status: 'served', total: 3000, createdAt: '2025-12-30T11:00:00.000Z', lines: [line('l1', 'Acısız olsun')],
        external: { platform: 'yemeksepeti', externalId: 'ys-1', code: '1234', customerName: 'Zeynep', note: 'Kapıda zil çalışmıyor, 3. kat', deliveryType: 'kurye', paidOnline: true, total: 3000, receivedAt: '2025-12-30T10:59:00.000Z' },
        cancellations: [{ id: 'c1', at: '2025-12-30T11:05:00.000Z', by: 'garson', reason: 'Misafir vazgeçti', lines: [line('l9', 'Buzsuz')] }] },
      { id: 'o2', accountId: 'acc1', guestId: browser, guestLabel: 'Misafir 1', source: 'qr', status: 'served', total: 3000, createdAt: '2025-12-30T11:10:00.000Z', lines: [line('l2')] },
      { id: 'o3', accountId: 'acc1', guestId: 'garson', guestLabel: 'Personel', source: 'staff', status: 'served', total: 0, createdAt: '2025-12-30T11:20:00.000Z', lines: [] },
    ],
    payments: [{ id: 'p1', accountId: 'acc1', amount: 6000, tendered: 6000, change: 0, method: 'platform', createdAt: '2025-12-30T11:30:00.000Z', commission: null }],
  };
  const out = withoutPersonalData('history_archives', {}, bill) as typeof bill;
  assert.equal(out.account.guest.name, 'Müşteri'); assert.equal(out.account.guest.people, 3); assert.deepEqual(out.account.deposit, bill.account.deposit);
  assert.deepEqual(out.orders[0].external, { platform: 'yemeksepeti', externalId: 'ys-1', code: '1234', deliveryType: 'kurye', paidOnline: true, total: 3000, receivedAt: '2025-12-30T10:59:00.000Z' });
  assert.deepEqual(out.orders[0].lines, [line('l1')]); assert.deepEqual(out.orders[0].cancellations[0].lines, [line('l9')]); assert.equal(out.orders[0].cancellations[0].reason, 'Misafir vazgeçti');
  assert.equal(out.orders[1].guestId, anonymousGuest(browser)); assert.match(out.orders[1].guestId, /^anon:[\w-]{16}$/);
  assert.equal(out.orders[2], bill.orders[2], 'staff orders keep their employee');
  assert.deepEqual(out.payments, bill.payments); assert.equal(out.total, 6000);
  for (const text of ['Zeynep', 'Kapıda', 'Acısız', 'Buzsuz', browser]) assert.ok(!JSON.stringify(out).includes(text), text);
  assert.equal(withoutPersonalData('history_archives', {}, out), undefined, 'nothing left to strip');
  assert.equal(withoutPersonalData('history_archives', {}, { ...bill, account: undefined, orders: [bill.orders[2]] }), undefined, 'a bill without personal data stays as it is');
});

test('package privacy: a reservation keeps people, table, time and kapora; an event and staff log lines stay as they are', () => {
  const r = { id: 'r1', tableId: 't1', tableName: 'Masa 4', day: '2025-12-30', time: '20:00', at: '2025-12-30T17:00:00.000Z', name: 'Ayşe Yılmaz', people: 4, phone: '0532 111 22 33', note: 'Doğum günü, pasta getirecek', status: 'seated', deposit: { amount: 50000, method: 'cash', takenAt: '2025-12-29T10:00:00.000Z', takenBy: 'kasiyer', takenByName: 'Kasiyer' }, createdAt: '', updatedAt: '', by: 'isletme', byName: 'İşletme sahibi' };
  const { phone: _p, note: _n, ...kept } = r;
  assert.deepEqual(withoutPersonalData('reservation_records', { kind: 'reservation' }, r), { ...kept, name: 'Müşteri' });
  assert.equal(withoutPersonalData('reservation_records', { kind: 'reservation' }, { ...kept, name: 'Müşteri' }), undefined);
  assert.equal(withoutPersonalData('reservation_records', { kind: 'event' }, { id: 'e1', name: 'Derbi gecesi', tables: [] }), undefined);
  assert.deepEqual(withoutPersonalData('history_audit', {}, { action: 'order.edited', actor: browser, target: 'o2', at: '2025-12-30T11:12:00.000Z' }), { action: 'order.edited', actor: anonymousGuest(browser), target: 'o2', at: '2025-12-30T11:12:00.000Z' });
  assert.equal(withoutPersonalData('history_audit', {}, { action: 'payment.recorded', actor: 'kasiyer', target: 'p1', at: '2025-12-30T11:30:00.000Z' }), undefined);
  assert.equal(withoutPersonalData('history_ledger', {}, { id: 'x', description: 'Süt' }), undefined, 'other tables hold no customer data');
});

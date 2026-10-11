import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { seed } from '../server/seed.js';
import { Store } from '../server/store.js';
import { PAPER_QUERY, PrintService, defaultTransport, privateIPv4, ticketData } from '../server/printing.js';
import { billTicket, cancelTicket, testTicket, encodeEscPos, kitchenTicket, orderTargets, paymentTicket, readyToPrint, renderText, type PrinterConfig } from '../packages/domain/printing.js';
import { cancelOrder, recordPayment, submitOrder } from '../packages/domain/engine.js';
import type { Actor, State } from '../packages/domain/types.js';

const at = (seconds: number) => new Date(Date.parse('2026-10-02T09:00:00Z') + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const guest: Actor = { tenantId: 'mola-demo', id: 'guest1', role: 'guest', tableId: 'table-1', epoch: 0 };
const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const printer = (over: Partial<PrinterConfig> = {}): PrinterConfig => ({ id: randomUUID(), name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: false, createdAt: at(-60).toISOString(), ...over });
const order = (s: State, lines = [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }, { productId: 'cheesecake', quantity: 1, selections: [] }]) => {
  const expectedTotal = lines.reduce((n, l) => n + (l.productId === 'latte' ? 19500 : 19000) * l.quantity, 0);
  return submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', lines, expectedTotal }, ctx());
};

test('kitchen ticket fits 58 mm paper and keeps options readable', () => {
  const s = seed(), p = printer(); order(s);
  const text = renderText(kitchenTicket(s, s.orders[0], p, s.orders[0].lines), p);
  assert.ok(text.every(line => line.length <= 32), text.join('\n'));
  const joined = text.join('\n');
  assert.match(joined, /Masa 01/); assert.match(joined, /2 x Caff/); assert.match(joined, /Büyük boy, Yulaf sütü/); assert.match(joined, /1 x San Sebastian/);
  assert.doesNotMatch(joined, /TL/, 'kitchen tickets do not show prices');
});
test('Turkish letters use code page 857 or fall back to plain letters', () => {
  const ticket = [{ text: 'Şeker çay ığ' }];
  const turkish = encodeEscPos(ticket, { width: 58, charset: 'pc857' }), plain = encodeEscPos(ticket, { width: 58, charset: 'ascii' });
  assert.deepEqual([...turkish.subarray(2, 5)], [0x1b, 0x74, 13]);
  assert.ok(turkish.includes(0x9e) && turkish.includes(0x87) && turkish.includes(0x8d) && turkish.includes(0xa7));
  assert.ok(Buffer.from(plain).includes(Buffer.from('Seker cay ig')));
  assert.ok([...plain].every(b => b < 0x80), 'ascii mode never sends extended bytes');
  assert.deepEqual([...plain.subarray(-3)], [0x1d, 0x56, 1], 'ticket ends with a paper cut');
});
test('bill summary is informational, shows discounts, payments and remaining balance', () => {
  const s = seed(); order(s);
  recordPayment(s, { tenantId: 'mola-demo', id: 'cashier', role: 'cashier' }, { requestId: randomUUID(), accountId: s.accounts[0].id, version: s.accounts[0].version, method: 'cash', amount: 10000, tendered: 10000 }, ctx(90));
  const text = renderText(billTicket(s, s.accounts[0].id, at(100)), { width: 80 }).join('\n');
  assert.match(text, /HESAP ÖZETİ/); assert.match(text, /TOPLAM\s+580,00 TL/); assert.match(text, /Ödenen\s+100,00 TL/); assert.match(text, /KALAN\s+480,00 TL/);
  assert.match(text, /Mali değeri yoktur/);
  assert.ok(text.split('\n').every(l => l.length <= 48));
});
test('payment receipt shows what was paid, how, the change and what is left', () => {
  const s = seed(); order(s); const cashier: Actor = { tenantId: 'mola-demo', id: 'cashier', role: 'cashier' };
  const pay = (amount: number, method: 'cash' | 'card', tendered = amount, selections?: { orderId: string; lineId: string; quantity: number }[]) =>
    recordPayment(s, cashier, { requestId: randomUUID(), accountId: s.accounts[0].id, version: s.accounts[0].version, method, amount, tendered, ...(selections ? { selections } : {}) }, ctx(90)).paymentId;
  const cake = s.orders[0].lines[1];
  const first = renderText(paymentTicket(s, pay(19000, 'cash', 20000, [{ orderId: s.orders[0].id, lineId: cake.id, quantity: 1 }]), at(95)), { width: 80 }).join('\n');
  assert.match(first, /ÖDEME FİŞİ/); assert.match(first, /1 x San Sebastian\s+190,00 TL/); assert.doesNotMatch(first, /Latte/);
  assert.match(first, /ÖDENEN\s+190,00 TL/); assert.match(first, /Ödeme şekli\s+Nakit/); assert.match(first, /Para üstü\s+10,00 TL/); assert.match(first, /Kalan hesap\s+390,00 TL/);
  assert.match(first, /Mali değeri yoktur/);
  const second = renderText(paymentTicket(s, pay(39000, 'card', 39000, [{ orderId: s.orders[0].id, lineId: s.orders[0].lines[0].id, quantity: 2 }]), at(96)), { width: 58 }).join('\n');
  assert.match(second, /Kart/); assert.doesNotMatch(second, /Para üstü/); assert.match(second, /Kalan hesap\s+0,00 TL/);
  const t = seed(); order(t);
  const amountOnly = recordPayment(t, cashier, { requestId: randomUUID(), accountId: t.accounts[0].id, version: t.accounts[0].version, method: 'cash', amount: 10000, tendered: 10000 }, ctx(90)).paymentId;
  assert.match(renderText(paymentTicket(t, amountOnly, at(95)), { width: 58 }).join('\n'), /kısmi ödeme/);
  const u = seed(); order(u);
  const full = recordPayment(u, cashier, { requestId: randomUUID(), accountId: u.accounts[0].id, version: u.accounts[0].version, method: 'card', amount: 58000, tendered: 58000 }, ctx(90)).paymentId;
  const fullText = renderText(paymentTicket(u, full, at(95)), { width: 58 }).join('\n');
  assert.match(fullText, /2 x Caff/); assert.match(fullText, /San Sebastian/, 'single full payment lists every item');
});
test('kitchen and cancel tickets show the item note and grams, wrapped for 58 and 80 mm', () => {
  const s = seed();
  s.products.push({ id: 'baklava', code: '60', name: 'Fıstıklı Baklava', nameEn: '', category: 'Tatlılar', description: '', price: 120000, soldOut: false, art: 'cake', unit: 'kg', groups: [] });
  const note = 'Soğansız olsun, sos ayrı kapta gelsin; çocuk için az baharatlı hazırlayın lütfen';
  submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', expectedTotal: 63500, lines: [{ productId: 'baklava', quantity: 1, selections: [], grams: 500 }, { productId: 'tea', quantity: 1, selections: [], note }] }, ctx());
  const o = s.orders[0];
  for (const width of [58, 80] as const) {
    const p = printer({ width }), text = renderText(kitchenTicket(s, o, p, o.lines), p), joined = text.join('\n');
    assert.ok(text.every(line => line.length <= (width === 58 ? 32 : 48)), joined);
    assert.match(joined, /^500 g Fıstıklı Baklava$/m); assert.doesNotMatch(joined, /1 x Fıstıklı/);
    assert.match(joined, /^1 x Demleme Çay$/m); assert.match(joined, /^ {4}Not: Soğansız olsun,/m);
    // Every wrapped note line keeps the indent, and no word of the note is lost.
    const from = text.findIndex(l => l.includes('Not:')), noteLines = text.slice(from, text.indexOf('-'.repeat(width === 58 ? 32 : 48), from));
    assert.ok(noteLines.every(l => l.startsWith('    ')), joined); assert.equal(noteLines.map(l => l.trim()).join(' '), `Not: ${note}`);
    assert.match(renderText(cancelTicket(s, o, p, o.lines), p).join('\n'), /Not: Soğansız/);
  }
  recordPayment(s, { tenantId: 'mola-demo', id: 'cashier', role: 'cashier' }, { requestId: randomUUID(), accountId: s.accounts[0].id, version: s.accounts[0].version, method: 'cash', amount: 60000, tendered: 60000, selections: [{ orderId: o.id, lineId: o.lines[0].id, quantity: 1 }] }, ctx(90));
  const bill = renderText(billTicket(s, s.accounts[0].id, at(100)), { width: 80 }).join('\n');
  assert.match(bill, /500 g Fıstıklı Baklava\s+600,00 TL/); assert.doesNotMatch(bill, /Not:/, 'the bill shows no notes');
  assert.match(renderText(paymentTicket(s, s.payments[0].id, at(95)), { width: 80 }).join('\n'), /500 g Fıstıklı Baklava\s+600,00 TL/);
});
test('ticket waits for the change window, approval and payment-first rules', () => {
  const s = seed(); order(s); const o = s.orders[0];
  assert.equal(readyToPrint(s, o, at(30)), false, 'customer may still edit');
  assert.equal(readyToPrint(s, o, at(61)), true);
  o.status = 'awaiting_approval'; assert.equal(readyToPrint(s, o, at(61)), false);
  o.status = 'new'; o.paymentBeforePreparation = true; assert.equal(readyToPrint(s, o, at(61)), false, 'kitchen may not start unpaid orders');
  o.paidAt = at(70).toISOString(); assert.equal(readyToPrint(s, o, at(71)), true);
  o.cancelRequested = true; assert.equal(readyToPrint(s, o, at(71)), false);
});
test('tek mutfak: the kitchen printer gets every line, whatever categories old data still carries', () => {
  const s = seed(); const kitchen = printer({ name: 'Mutfak', categories: ['Tatlılar'] }), bar = printer({ name: 'Bar', categories: ['Kahveler', 'Çaylar'] });
  s.printers = [printer({ name: 'Kasa', orders: false, bill: true }), kitchen, bar]; order(s);
  const targets = orderTargets(s, s.orders[0]);
  assert.deepEqual(targets.map(t => [t.printer.name, t.lines.map(l => l.productId)]), [['Mutfak', ['latte', 'cheesecake']]]);
});
test('print service prints once when ready, retries failures and sends a cancel slip', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/printing-')), ['mola-demo']);
  try {
    let clock = 0; const sent: string[] = []; let failing = false;
    const service = new PrintService(store, () => at(clock), async (_c, data) => { if (failing) throw new Error('offline'); sent.push(Buffer.from(data).toString('latin1')); });
    const p = printer();
    store.mutate('mola-demo', s => { s.printers = [p]; order(s); });
    service.refresh('mola-demo');
    await service.tick(); assert.equal(sent.length, 0, 'nothing during the change window');
    clock = 61; await service.tick(); assert.equal(sent.length, 1); assert.match(sent[0], /Masa 01/);
    await service.tick(); assert.equal(sent.length, 1, 'a printed order is never printed twice');
    assert.deepEqual(store.read('mola-demo').orders[0].printedTo, [p.id]);
    store.mutate('mola-demo', s => cancelOrder(s, owner, { requestId: randomUUID(), orderId: s.orders[0].id, version: s.orders[0].version }, ctx(62)));
    await service.tick(); assert.equal(sent.length, 2); assert.match(sent[1], /IPTAL/);
    await service.tick(); assert.equal(sent.length, 2, 'cancel slip only once');

    failing = true; store.mutate('mola-demo', s => { order(s); s.orders[1].editableUntil = at(61).toISOString(); });
    clock = 70; await service.tick(); clock = 76; await service.tick(); clock = 97; await service.tick();
    assert.deepEqual(store.read('mola-demo').orders[1].printFailedTo, [p.id], 'three failures are shown to the kitchen');
    failing = false; clock = 200; await service.tick(); assert.equal(sent.length, 2, 'failed orders wait for a manual reprint instead of printing late');
  } finally { store.close(); }
});
test('retry entries are dropped when their order leaves the floor or the retry is an hour overdue', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/printing-prune-')), ['mola-demo']);
  try {
    let clock = 70; const service = new PrintService(store, () => at(clock), async () => { throw new Error('offline'); });
    const p = printer();
    store.mutate('mola-demo', s => { s.printers = [p]; order(s); s.orders[0].editableUntil = at(61).toISOString(); });
    service.refresh('mola-demo');
    await service.tick(); assert.equal(service.retryCount, 1, 'first failure waits for a retry');
    // Settled before the retry: the order is gone from the floor, so its entry would never be cleared otherwise.
    store.mutate('mola-demo', s => { s.orders = []; });
    clock = 72; await service.tick(); assert.equal(service.retryCount, 0);

    store.mutate('mola-demo', s => { order(s); s.orders[0].editableUntil = at(61).toISOString(); });
    clock = 80; await service.tick(); assert.equal(service.retryCount, 1);
    // Printer switched off: the job is no longer pending, but the order is still on the floor.
    store.mutate('mola-demo', s => { s.printers = [{ ...p, enabled: false }]; }); service.refresh('mola-demo');
    clock = 85 + 3599; await service.tick(); assert.equal(service.retryCount, 1, 'kept until the retry is an hour overdue');
    clock = 85 + 3601; await service.tick(); assert.equal(service.retryCount, 0);
  } finally { store.close(); }
});
test('printers added later do not print orders that were already in progress', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/printing-late-')), ['mola-demo']);
  try {
    const sent: unknown[] = []; const service = new PrintService(store, () => at(120), async () => { sent.push(1); });
    store.mutate('mola-demo', s => { order(s); s.printers = [printer({ createdAt: at(100).toISOString() })]; });
    service.refresh('mola-demo'); await service.tick(); assert.equal(sent.length, 0);
  } finally { store.close(); }
});
test('network transport writes raw ESC/POS bytes to port 9100 style sockets', async () => {
  const received: Buffer[] = [];
  const server = createServer(socket => socket.on('data', d => received.push(d)));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try {
    const data = encodeEscPos([{ text: 'Deneme' }], { width: 58, charset: 'ascii' });
    await defaultTransport({ type: 'network', host: '127.0.0.1', port: (server.address() as AddressInfo).port }, data);
    await new Promise(r => setTimeout(r, 50));
    // The paper-status query (DLE EOT 4) goes first; a printer that does not answer gets the ticket after a short wait.
    assert.deepEqual(Buffer.concat(received), Buffer.concat([Buffer.from(PAPER_QUERY), Buffer.from(data)]));
    await assert.rejects(defaultTransport({ type: 'network', host: '127.0.0.1', port: 1 }, data), /Yazıcıya ulaşılamadı/);
  } finally { server.close(); }
  assert.equal(privateIPv4('192.168.1.50'), true); assert.equal(privateIPv4('8.8.8.8'), false); assert.equal(privateIPv4('localhost'), false);
});

test('office printers get readable plain text, receipt printers keep ESC/POS', () => {
  const base: PrinterConfig = { id: randomUUID(), name: 'Kasa', enabled: true, connection: { type: 'windows', printerName: 'HP LaserJet M1120 MFP' }, width: 80, charset: 'pc857', orders: false, categories: [], bill: true, createdAt: '2026-10-03T10:00:00.000Z' };
  const ticket = testTicket(base, 'Mola Örnek Kafe', new Date('2026-10-03T10:00:00Z'));
  const raw = ticketData(ticket, base);
  assert.deepEqual([...raw.slice(0, 2)], [0x1b, 0x40]);
  const text = new TextDecoder().decode(ticketData(ticket, { ...base, connection: { type: 'windows', printerName: 'HP LaserJet M1120 MFP', document: true } }));
  // No printer commands; Turkish letters stay as UTF-8; the large title is not squeezed into half the width.
  assert.ok(!text.includes('\u001b') && !text.includes('\u001d'));
  assert.match(text, /DENEME FİŞİ/); assert.match(text, /Mola Örnek Kafe/);
  // Network printers are always receipt printers.
  assert.deepEqual([...ticketData(ticket, { ...base, connection: { type: 'network', host: '192.168.1.50', port: 9100 } }).slice(0, 2)], [0x1b, 0x40]);
});
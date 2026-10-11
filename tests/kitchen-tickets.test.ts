import { licensed } from './merkez-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { PrintService, PrinterFault, PAPER_QUERY, defaultTransport, networkCause, printingView, spooler, spoolerFault, spoolerResult, statusFault, statusQuery } from '../server/printing.js';
import { fakePrinter } from './fake-printer.js';
import { Store } from '../server/store.js';
import { cancelOrder, editOrder, recordPayment, setStatus, submitOrder, submitTakeaway } from '../packages/domain/engine.js';
import type { PrinterConfig } from '../packages/domain/printing.js';
import type { Actor, State } from '../packages/domain/types.js';

/* Mutfak fişi modu (Ayarlar → Sipariş ve kasa → "Mutfak nasıl çalışıyor?" → Fiş): server/printing.ts, packages/domain/printing.ts. */
const T = 'mola-demo';
const at = (seconds: number) => new Date(Date.parse('2026-10-02T09:00:00Z') + seconds * 1000);
const ctx = (seconds = 0) => ({ now: at(seconds), id: randomUUID });
const guest: Actor = { tenantId: T, id: 'guest1', role: 'guest', tableId: 'table-1', epoch: 0 };
const waiter: Actor = { tenantId: T, id: 'waiter', role: 'waiter' };
const cashier: Actor = { tenantId: T, id: 'cashier', role: 'cashier' };
const printer = (over: Partial<PrinterConfig> = {}): PrinterConfig => ({ id: randomUUID(), name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 58, charset: 'ascii', orders: true, categories: [], bill: false, createdAt: at(-60).toISOString(), ...over });
const latte = [{ productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }];
const guestOrder = (s: State, lines = latte, seconds = 0) => submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', lines, expectedTotal: 19500 * lines[0].quantity }, ctx(seconds));
const staffOrder = (s: State, seconds = 0) => submitOrder(s, waiter, { requestId: randomUUID(), tableId: 'table-2', lines: latte, expectedTotal: 19500 }, ctx(seconds));

function setup(name: string, over: Partial<PrinterConfig>[] = [{}]) {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve(`.local/tests/kitchen-tickets-${name}-`)), [T]);
  const printers = over.map((o, i) => printer({ connection: { type: 'network', host: `192.168.1.${50 + i}`, port: 9100 }, ...o }));
  store.mutate(T, s => { s.printers = printers; s.kitchenMode = 'ticket'; s.changeSeconds = 30; });
  const clock = { t: 0 }, sent: { printer: string; text: string }[] = [], failing = new Map<string, Error>();
  const service = new PrintService(store, () => at(clock.t), async (connection, data) => {
    const p = printers.find(v => v.connection === connection || JSON.stringify(v.connection) === JSON.stringify(connection))!;
    const error = failing.get(p.id); if (error) throw error;
    sent.push({ printer: p.name, text: Buffer.from(data).toString('latin1') });
  });
  return { store, service, printers, clock, sent, failing, read: () => store.read(T) };
}

test('Fiş modu: a QR order prints after the change window with its final content and then reads "Hazırlanıyor"', async () => {
  const { store, service, clock, sent, read } = setup('window');
  try {
    let id = '';
    store.mutate(T, s => { id = guestOrder(s).orderId; });
    clock.t = 10; await service.tick(); assert.equal(sent.length, 0, 'nothing while the guest may still change it');
    // The guest changes it inside the window: the ticket shows the final order, no İPTAL slip for the first version.
    store.mutate(T, s => { const o = s.orders.find(v => v.id === id)!; editOrder(s, guest, { requestId: randomUUID(), orderId: id, version: o.version, expectedTotal: 39000, lines: [{ ...latte[0], quantity: 2, existingId: o.lines[0].id }] }, ctx(15)); });
    clock.t = 29; await service.tick(); assert.equal(sent.length, 0);
    assert.equal(read().orders[0].status, 'new');
    clock.t = 31; await service.tick();
    assert.equal(sent.length, 1); assert.match(sent[0].text, /2 x Caff/); assert.doesNotMatch(sent[0].text, /IPTAL/);
    const o = read().orders[0];
    assert.equal(o.status, 'preparing', 'printed = Hazırlanıyor for the guest'); assert.deepEqual(o.printedTo?.length, 1);
    await service.tick(); assert.equal(sent.length, 1, 'never twice');
  } finally { store.close(); }
});

test('Fiş modu: an order cancelled inside the window is never printed and needs no İPTAL slip; staff orders print at once', async () => {
  const { store, service, clock, sent, read } = setup('cancel');
  try {
    store.mutate(T, s => { const { orderId } = guestOrder(s); cancelOrder(s, guest, { requestId: randomUUID(), orderId, version: s.orders[0].version }, ctx(5)); });
    clock.t = 40; await service.tick();
    assert.equal(sent.length, 0); assert.equal(read().orders[0].status, 'cancelled');
    store.mutate(T, s => { staffOrder(s, 40); });
    await service.tick();
    assert.equal(sent.length, 1, 'staff orders have no window'); assert.equal(read().orders[1].status, 'preparing');
    // Cancelled after printing: the İPTAL slip still goes (existing rule).
    store.mutate(T, s => cancelOrder(s, { tenantId: T, id: 'owner', role: 'owner' }, { requestId: randomUUID(), orderId: s.orders[1].id, version: s.orders[1].version }, ctx(41)));
    await service.tick(); assert.equal(sent.length, 2); assert.match(sent[1].text, /IPTAL/);
  } finally { store.close(); }
});

test('Fiş modu: a failed print keeps "Yeni" with a plain cause; Tekrar bas (also after the kitchen role moved) and Elle iletildi close it', async () => {
  const { store, service, printers, clock, sent, failing, read } = setup('failure', [{ name: 'Mutfak' }, { name: 'Kasa', orders: false, bill: true }]);
  const [kitchen, counter] = printers;
  try {
    failing.set(kitchen.id, new PrinterFault('paper', 'Yazıcıda kâğıt bitti'));
    store.mutate(T, s => { staffOrder(s); });
    await service.tick();
    let o = read().orders[0];
    assert.equal(o.status, 'new', 'stays new until printed');
    assert.deepEqual(o.printProblems?.map(p => [p.printerId, p.cause]), [[kitchen.id, 'paper']], 'warned from the first failure');
    const firstAt = o.printProblems![0].at;
    // Later automatic retries keep the warning's time (one sound) and update the cause.
    failing.set(kitchen.id, new PrinterFault('offline', 'kapalı'));
    clock.t = 6; await service.tick(); clock.t = 30; await service.tick();
    o = read().orders[0];
    assert.equal(o.printProblems![0].at, firstAt); assert.equal(o.printProblems![0].cause, 'offline'); assert.deepEqual(o.printFailedTo, [kitchen.id]);
    // Tekrar bas while the printer is still broken: the warning stays, the caller reads the cause.
    await assert.rejects(service.printKitchen(T, o.id, kitchen.id), /Basılamadı: Yazıcı kapalı ya da kablosu çıkmış/);
    assert.equal(read().orders[0].status, 'new');
    // Tek mutfak: there is no other kitchen printer to send it to.
    await assert.rejects(service.printKitchen(T, o.id, kitchen.id, counter.id), /Mutfak yazıcısı kapalı ya da kaldırılmış/);
    // The owner moves "Mutfak fişleri" to the counter printer: "Tekrar bas" prints there (the screen sends `to`).
    store.mutate(T, s => { s.printers = s.printers!.map(p => p.id === kitchen.id ? { ...p, orders: false } : { ...p, orders: true }); });
    await service.printKitchen(T, o.id, kitchen.id, counter.id);
    o = read().orders[0];
    assert.equal(sent.at(-1)!.printer, 'Kasa'); assert.match(sent.at(-1)!.text, /Caff/);
    assert.equal(o.printProblems, undefined); assert.equal(o.status, 'preparing', 'printed in the kitchen = Hazırlanıyor');
    store.mutate(T, s => { s.printers = s.printers!.map(p => p.id === kitchen.id ? { ...p, orders: true } : { ...p, orders: false }); });

    // Tekrar bas that works.
    store.mutate(T, s => { staffOrder(s, 40); }); clock.t = 40;
    await service.tick(); await service.tick();
    assert.equal(read().orders[1].status, 'new');
    failing.delete(kitchen.id);
    await service.printKitchen(T, read().orders[1].id, kitchen.id);
    assert.equal(read().orders[1].status, 'preparing'); assert.equal(read().orders[1].printProblems, undefined);
    assert.deepEqual(read().orders[1].printFailedTo, undefined);
  } finally { store.close(); }
});

test('Fiş modu: no kitchen printer is a warning too; Tekrar bas prints on the one chosen later; the snapshot view', async () => {
  const { store, service, printers, sent, read } = setup('manual', [{ name: 'Mutfak', enabled: false }]);
  try {
    store.mutate(T, s => { staffOrder(s); });
    await service.tick();
    let o = read().orders[0];
    assert.equal(sent.length, 0);
    assert.deepEqual(o.printProblems?.map(p => [p.printerId, p.cause]), [['none', 'no_printer']], 'no printer holds "Mutfak fişleri"');
    assert.deepEqual(printingView(read()), { orders: false, bill: false, ticketMode: true, kitchenPrinters: [] });
    store.mutate(T, s => { s.printers![0].enabled = true; });
    assert.deepEqual(printingView(read()), { orders: true, bill: false, ticketMode: true, kitchenPrinters: [{ id: printers[0].id, name: 'Mutfak' }] });
    await service.printKitchen(T, o.id, 'none', printers[0].id);
    o = read().orders[0];
    assert.equal(sent.length, 1); assert.equal(o.printProblems, undefined); assert.equal(o.status, 'preparing');
    store.mutate(T, s => { s.kitchenMode = undefined; });
    assert.deepEqual(printingView(read()), { orders: true, bill: false }, 'Ekran: the snapshot stays as before');
  } finally { store.close(); }
});

test('Fiş modu: "Teslim edildi" from the table, and paying the bill delivers what is left', () => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/kitchen-tickets-deliver-')), [T]);
  try {
    store.mutate(T, s => {
      s.kitchenMode = 'ticket'; s.cleaningEnabled = false;
      staffOrder(s); staffOrder(s); staffOrder(s);
      for (const o of s.orders) o.status = 'preparing';
      // Ekran's rule would refuse preparing → served; Fiş allows it.
      setStatus(s, waiter, s.orders[0].id, s.orders[0].version, 'served', at(60));
      assert.equal(s.orders[0].status, 'served');
      s.orders[2].status = 'new'; // still waiting for its ticket
      const a = s.accounts.find(v => v.id === s.orders[0].accountId)!;
      const r = recordPayment(s, cashier, { requestId: randomUUID(), accountId: a.id, version: a.version, method: 'cash', amount: 3 * 19500, tendered: 3 * 19500 }, ctx(90));
      assert.equal(r.closed, true);
      assert.deepEqual(s.orders.map(o => o.status), ['served', 'served', 'new'], 'printed orders are delivered with the bill');
      const table = s.tables.find(t => t.id === a.tableId)!;
      assert.equal(table.accountId, null, 'the table resets as usual');
      // Ekran keeps its rule.
      s.kitchenMode = undefined; staffOrder(s); s.orders[3].status = 'preparing';
      assert.throws(() => setStatus(s, waiter, s.orders[3].id, s.orders[3].version, 'served', at(100)), /izin verilmiyor/);
      // A masasız customer who paid first waits at the counter: not delivered by the payment.
      s.kitchenMode = 'ticket';
      const t = submitTakeaway(s, cashier, { requestId: randomUUID(), lines: latte, expectedTotal: 19500 }, ctx(110));
      const ticket = s.orders.find(o => o.id === t.orderId)!; ticket.status = 'preparing';
      const ta = s.accounts.find(v => v.id === t.accountId)!;
      recordPayment(s, cashier, { requestId: randomUUID(), accountId: ta.id, version: ta.version, method: 'card', amount: 19500, tendered: 19500 }, ctx(111));
      assert.equal(ticket.status, 'preparing');
    });
  } finally { store.close(); }
});

test('Fiş modu: tickets due while the server was off print after it starts again', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const dir = mkdtempSync(resolve('.local/tests/kitchen-tickets-restart-'));
  let store = new Store(dir, [T]);
  store.mutate(T, s => { s.printers = [printer()]; s.kitchenMode = 'ticket'; s.changeSeconds = 30; guestOrder(s); });
  store.close();
  store = new Store(dir, [T]);
  try {
    const sent: unknown[] = [];
    const service = new PrintService(store, () => at(300), async () => { sent.push(1); });
    await service.tick();
    assert.equal(sent.length, 1); assert.equal(store.read(T).orders[0].status, 'preparing');
  } finally { store.close(); }
});

test('network printer: status questions before and after the ticket, paper out, cover open and plain causes', async () => {
  const printer = await fakePrinter(), data = Uint8Array.from([0x1b, 0x40, 65]);
  const to = { type: 'network' as const, host: '127.0.0.1', port: printer.port };
  try {
    // All fine: printer status, offline cause and paper sensor are asked, then the ticket, then once more after it.
    await defaultTransport(to, data);
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(printer.bytes(), Buffer.concat([statusQuery(1), statusQuery(2), statusQuery(4), data, statusQuery(2), statusQuery(4)].map(b => Buffer.from(b))));
    // The roll is empty: the ticket is not sent at all.
    printer.clear(); printer.state.status = { printer: 0x1a, offline: 0x32, paper: 0x72 };
    await assert.rejects(defaultTransport(to, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'paper' && /Yazıcıda kâğıt yok/.test(e.message));
    assert.ok(!printer.bytes().includes(0x1b), 'no ticket bytes to a printer without paper');
    // Cover open.
    printer.state.status = { printer: 0x1a, offline: 0x16, paper: 0x12 };
    await assert.rejects(defaultTransport(to, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'cover');
    // The paper ran out while it printed: asked again after the ticket, it is a failed ticket.
    printer.state.status = { printer: 0x12, offline: 0x12, paper: 0x12 }; printer.state.after = { printer: 0x1a, offline: 0x32, paper: 0x72 };
    await assert.rejects(defaultTransport(to, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'paper');
    // Nearly empty: it prints and says so.
    printer.state.after = undefined; printer.state.status = { printer: 0x12, offline: 0x12, paper: 0x1e };
    assert.deepEqual(await defaultTransport(to, data), { low: true });
    // A printer without real-time status (no answer): the ticket goes after the first unanswered question.
    printer.clear(); printer.state.status = null;
    await defaultTransport(to, data);
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(printer.bytes(), Buffer.concat([Buffer.from(statusQuery(1)), Buffer.from(data)]));
    await assert.rejects(defaultTransport({ type: 'network', host: '127.0.0.1', port: 1 }, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'network');
  } finally { await printer.close(); }
  assert.equal(PAPER_QUERY.join(','), '16,4,4');
  assert.equal(networkCause('EHOSTUNREACH'), 'offline'); assert.equal(networkCause('ETIMEDOUT'), 'offline');
  assert.equal(networkCause('ENETUNREACH'), 'network'); assert.equal(networkCause('EWHATEVER'), 'unknown');
  assert.deepEqual(statusFault({ printer: 0x12, offline: 0x12, paper: 0x12 }), {});
  assert.equal(statusFault({ printer: 0x1a }).fault, 'error');
});

test('Windows USB printer: the spooler says paper out, cover open or offline (fake spooler, read only)', { skip: process.platform !== 'win32' && 'Windows yalnız' }, async () => {
  const real = spooler.run, seen: Record<string, string>[] = [];
  let answer = '';
  spooler.run = async (_script, env) => { seen.push(env); return answer; };
  const usb = { type: 'windows' as const, printerName: 'XP-80C' }, data = Uint8Array.from([0x1b, 0x40]);
  try {
    answer = 'MOLA:BEFORE:16:0';
    await assert.rejects(defaultTransport(usb, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'paper' && /XP-80C/.test(e.message));
    answer = 'MOLA:BEFORE:4194304:0';
    await assert.rejects(defaultTransport(usb, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'cover');
    answer = 'MOLA:BEFORE:0:1024';
    await assert.rejects(defaultTransport(usb, data), (e: unknown) => e instanceof PrinterFault && e.fault === 'offline');
    // Sent, then the job stuck in the queue with "kâğıt yok".
    answer = 'MOLA:BEFORE:0:0\r\nMOLA:AFTER:0:0:64';
    await assert.rejects(defaultTransport(usb, data, { name: 'Mola fis 12 order' }), (e: unknown) => e instanceof PrinterFault && e.fault === 'paper');
    assert.equal(seen.at(-1)!.MOLA_PRINT_DOC, 'Mola fis 12 order', 'a kitchen ticket carries its own document name');
    answer = 'MOLA:BEFORE:0:0\r\nMOLA:AFTER:0:0:128';
    assert.deepEqual(await defaultTransport(usb, data), {});
    // "Tekrar bas" while the earlier copy still waits in the queue (paper back in): not printed twice.
    answer = 'MOLA:BEFORE:0:0\r\nMOLA:WAITING:0:0:0';
    assert.deepEqual(await defaultTransport(usb, data, { name: 'Mola fis 12 order' }), {});
    assert.equal(seen[0].MOLA_PRINT_DOC, 'Mola fis', 'a manual print has the plain name');
  } finally { spooler.run = real; }
  assert.equal(spoolerFault(0x10), 'paper'); assert.equal(spoolerFault(0x40), 'paper'); assert.equal(spoolerFault(0x400000), 'cover');
  assert.equal(spoolerFault(0x80), 'offline'); assert.equal(spoolerFault(0, 0x400), 'offline'); assert.equal(spoolerFault(0x8), 'error'); assert.equal(spoolerFault(0, 0, 0x2), 'error');
  assert.equal(spoolerFault(0), undefined); assert.deepEqual(spoolerResult('çöp'), {});
});

test('Ekran modu too: a failed kitchen ticket keeps its cause and printer on the order, the owner gets one Bildirim', async () => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/kitchen-tickets-screen-')), [T]);
  try {
    let fail: PrinterFault | null = new PrinterFault('paper', 'kâğıt yok'), low = false;
    const notes: { key: string; title: string; text: string }[] = [];
    const service = new PrintService(store, () => at(300), async () => { if (fail) throw fail; return low ? { low } : {}; });
    service.notify = (_t, key, title, text) => { notes.push({ key, title, text }); };
    store.mutate(T, s => { s.printers = [printer({ id: 'kitchen-printer' })]; staffOrder(s); staffOrder(s); });
    service.refresh(T); await service.tick();
    let s = store.read(T);
    assert.equal(s.kitchenMode, undefined);
    assert.deepEqual(s.orders.map(o => o.printProblems?.[0]?.cause), ['paper', 'paper']);
    assert.equal(s.orders[0].printProblems![0].printer, 'Mutfak');
    assert.equal(notes.length, 1, 'one Bildirim per printer and problem, not per order');
    assert.equal(notes[0].title, 'Yazıcıda kâğıt yok · Mutfak'); assert.match(notes[0].text, /Yeni rulo takın/);
    // Paper back in: the kitchen card's "Tekrar bas" prints and the warning goes; the next problem is told again.
    fail = null; low = true;
    await service.reprint(T, s.orders[0].id);
    s = store.read(T);
    assert.equal(s.orders[0].printProblems, undefined); assert.deepEqual(s.orders[0].printedTo, ['kitchen-printer']);
    assert.equal(notes.at(-1)!.title, 'Yazıcıda kâğıt azaldı · Mutfak');
    fail = new PrinterFault('cover', 'kapak');
    await assert.rejects(service.reprint(T, s.orders[1].id), (e: unknown) => e instanceof PrinterFault && /Yazıcının kapağı açık · Mutfak/.test(e.message));
    assert.equal(store.read(T).orders[1].printProblems![0].cause, 'cover');
  } finally { store.close(); }
});

test('HTTP: Fiş needs a kitchen printer; warning buttons and "Hepsini teslim edildi" for the floor', async t => {
  mkdirSync('.local/tests', { recursive: true });
  const store = new Store(mkdtempSync(resolve('.local/tests/kitchen-tickets-api-')));
  let time = Date.now();
  const failing = { on: true };
  const service = new PrintService(store, () => new Date(time), async () => { if (failing.on) throw new PrinterFault('offline', 'kapalı'); });
  licensed(store); const server = createHttpServer(createApp(store, () => new Date(time), () => true, undefined, undefined, undefined, service));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = () => { const jar = new Map<string, string>(); return async (path: string, body?: unknown) => {
    const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); jar.set(k, v); }
    return { status: response.status, data: await response.json() as any };
  }; };
  const owner = client(), waiterC = client();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await waiterC('/login', { username: 'garson', password: DEMO_PASSWORD })).status, 200);
  const blocked = await owner('/staff/kitchen-mode', { mode: 'ticket' });
  assert.equal(blocked.status, 409); assert.match(blocked.data.message, /yazıcı ekleyin/);
  assert.equal((await waiterC('/staff/kitchen-mode', { mode: 'ticket' })).status, 403);
  const added = await owner('/staff/printers', { printer: { name: 'Mutfak', enabled: true, connection: { type: 'network', host: '192.168.255.254', port: 9100 }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false } });
  assert.equal(added.status, 200);
  assert.equal((await owner('/staff/kitchen-mode', { mode: 'ticket' })).status, 200);
  let state = (await waiterC('/staff/state')).data;
  assert.equal(state.printing.ticketMode, true); assert.equal(state.printing.kitchenPrinters[0].name, 'Mutfak');
  const tea = state.products.find((p: { groups: unknown[]; soldOut: boolean }) => !p.groups.length && !p.soldOut);
  const table = state.tables[0];
  for (const n of [1, 2]) assert.equal((await waiterC('/staff/orders', { requestId: `kitchen-ticket-${n}-0001`, tableId: table.id, lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price })).status, 200);
  await service.tick();
  state = (await waiterC('/staff/state')).data;
  const [first, second] = state.orders.filter((o: { accountId: string }) => o.accountId === state.tables[0].account.id);
  assert.equal(first.status, 'new'); assert.equal(first.printProblems[0].cause, 'offline');
  // Tekrar bas fails with the plain cause, then works.
  const again = await waiterC('/staff/print/kitchen', { orderId: first.id, printerId: first.printProblems[0].printerId });
  assert.equal(again.status, 409); assert.match(again.data.message, /Yazıcı kapalı ya da kablosu çıkmış/); assert.doesNotMatch(again.data.message, /Takip kodu/);
  failing.on = false;
  assert.equal((await waiterC('/staff/print/kitchen', { orderId: first.id, printerId: first.printProblems[0].printerId })).status, 200);
  // Elle iletildi for the other one, with an audit line.
  assert.equal((await waiterC('/staff/print/handled', { orderId: second.id, printerId: second.printProblems[0].printerId })).status, 200);
  state = (await waiterC('/staff/state')).data;
  assert.deepEqual(state.orders.filter((o: { accountId: string }) => o.accountId === state.tables[0].account.id).map((o: { status: string }) => o.status), ['preparing', 'preparing']);
  assert.ok(store.auditLog('mola-demo').some(a => a.action === 'print.handled_manually'), 'who closed the warning is on record');
  const all = await waiterC('/staff/deliver-all', { requestId: 'deliver-all-00001', accountId: state.tables[0].account.id });
  assert.equal(all.status, 200); assert.equal(all.data.delivered, 2);
  state = (await waiterC('/staff/state')).data;
  assert.ok(state.orders.filter((o: { accountId: string }) => o.accountId === state.tables[0].account.id).every((o: { status: string }) => o.status === 'served'));
  // Removing the last kitchen printer in Fiş modu warns.
  const removed = await owner('/staff/printers/delete', { id: added.data.printer.id });
  assert.match(removed.data.warning, /yazıcı kalmadı/);
  time += 1000;
});

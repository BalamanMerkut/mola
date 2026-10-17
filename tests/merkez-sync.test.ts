import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from '../server/app.js';
import { HEADER, requestSignature, signedHeaders } from '../server/install-auth.js';
import { MERKEZ_API, syncRequest } from '../server/sync-protocol.js';
import { merkezPair } from './merkez-fixture.js';

const rid = () => randomUUID().replace(/-/g, '');
const DAY = 86400000;
/** JSON text with random/clock values blanked: UUIDs, ISO times, epoch-millisecond numbers and request timings (elapsedMs). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const withoutClockAndIds = (value: unknown) => JSON.stringify(value, (key, v) =>
  key === 'elapsedMs' || (typeof v === 'string' && (UUID.test(v) || ISO.test(v))) || (typeof v === 'number' && v > 1e11) ? '·' : v);

test('heartbeat: only the install’s own signature passes; replays, wrong clocks, edited bodies and floods are refused', async t => {
  let time = Date.now();
  const pair = await merkezPair('heartbeat-auth', { demo: true, now: () => new Date(time) }); t.after(() => pair.close());
  const { installId } = await pair.importDemo();
  const secret = pair.link.read()!.secret, path = `${MERKEZ_API}/sync`, url = pair.merkezBase + path;
  const body = JSON.stringify(pair.link.payload(pair.link.read()!));
  const send = (headers: Record<string, string>, text = body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text });
  assert.equal((await send({})).status, 401);
  const good = signedHeaders(installId, secret, 'POST', path, body, time);
  const first = await send(good);
  assert.equal(first.status, 200);
  assert.ok(first.headers.get(HEADER.signature), 'Merkez signs its answer');
  const replay = await send(good);
  assert.equal(replay.status, 401); assert.equal((await replay.json()).code, 'REPLAY');
  assert.equal((await send(signedHeaders(installId, 'b'.repeat(43), 'POST', path, body, time))).status, 401, 'another secret');
  assert.equal((await send(signedHeaders(randomUUID(), secret, 'POST', path, body, time))).status, 401, 'unknown install');
  const edited = signedHeaders(installId, secret, 'POST', path, body, time);
  assert.equal((await send(edited, body.replace('"backup"', '"backup" '))).status, 401, 'the body was changed after signing');
  const skewed = await send(signedHeaders(installId, secret, 'POST', path, body, time - 6 * 60_000));
  assert.equal(skewed.status, 401); assert.equal((await skewed.json()).code, 'CLOCK_SKEW');
  assert.ok(skewed.headers.get('x-mola-server-time'), 'the answer tells the café Merkez’s time');
  // A café whose clock is off still gets through: it learns Merkez's time from the answer and signs again.
  time += 20 * 60_000;
  const sync = await pair.link.sync(); assert.equal(sync.ok, true, sync.error);
  // A signature for another path does not open /sync.
  const nonce = 'c'.repeat(32), at = String(time);
  assert.equal((await send({ [HEADER.install]: installId, [HEADER.time]: at, [HEADER.nonce]: nonce, [HEADER.signature]: requestSignature(secret, 'POST', `${MERKEZ_API}/other`, at, nonce, body) })).status, 401);
  // Unknown fields are refused: a café can never start sending more than the allowlist.
  const extra = JSON.stringify({ ...JSON.parse(body), revenue: 125000 });
  assert.equal((await send(signedHeaders(installId, secret, 'POST', path, extra, time), extra)).status, 400);
  // At most 30 heartbeats a minute per install.
  let limited = 0;
  for (let i = 0; i < 32; i++) if ((await send(signedHeaders(installId, secret, 'POST', path, body, time))).status === 429) limited++;
  assert.ok(limited >= 1);
});

test('no sales data ever leaves the café: the heartbeat and ticket delivery carry only the allowlisted shape', async t => {
  const pair = await merkezPair('privacy', { demo: true }); t.after(() => pair.close());
  await pair.importDemo();
  // Real business activity: an order, a payment, a customer name on a takeaway ticket, an expense, a staff account.
  const owner = pair.kafe(), guest = pair.kafe();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const s = (await owner('/staff/state')).data;
  await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const session = await guest('/guest/session', { token: s.tables[0].token });
  await guest('/guest/orders', { requestId: rid(), tableId: session.data.tableId, lines: [{ productId: 'latte', quantity: 3, selections: [{ groupId: 'size', optionId: 'large' }], note: 'GIZLI_NOT' }], expectedTotal: 49500 });
  const table = (await owner('/staff/state')).data.tables.find((x: { id: string }) => x.id === session.data.tableId);
  assert.equal((await owner('/staff/payments', { requestId: rid(), accountId: table.account.id, version: table.account.version, method: 'card', amount: 49500, tendered: 49500 })).status, 200);
  await owner('/staff/takeaway/orders', { requestId: rid(), label: 'Müşteri Zeynep', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  await owner('/staff/expenses', { requestId: rid(), amount: 77700, category: 'Kira', note: 'GIZLI_GIDER' }).catch(() => undefined);
  await owner('/staff/support', { requestId: rid(), subject: 'Yazıcı çalışmıyor', text: 'Mutfak yazıcısı fiş basmıyor.' });
  const payload = pair.link.payload(pair.link.read()!);
  assert.doesNotThrow(() => syncRequest.parse(payload), 'exactly the shape Merkez accepts');
  assert.deepEqual(Object.keys(payload).sort(), ['appVersion', 'backup', 'businesses', 'failures', 'freezes', 'sentAt', 'tickets', 'v']);
  for (const b of payload.businesses) {
    assert.deepEqual(Object.keys(b).filter(k => !['setupCompletedAt', 'lastActivityAt', 'firstOwnerLoginAt'].includes(k)).sort(), ['counts', 'name', 'sector', 'setupCompleted', 'tenantId']);
    assert.deepEqual(Object.keys(b.counts).sort(), ['products', 'staff', 'tables']);
  }
  assert.deepEqual(Object.keys(payload.tickets[0]).sort(), ['createdAt', 'id', 'messages', 'subject', 'tenantId']);
  assert.deepEqual(Object.keys(payload.tickets[0].messages[0]).sort(), ['at', 'id', 'text']);
  const text = JSON.stringify(payload);
  // The table token and the account id are looked for in the whole text; prices and words only outside random ids, clock
  // times and request timings — a "495" inside a UUID or in ".495Z" milliseconds is not a price (this used to flake ~1 in 50).
  for (const secret of [s.tables[0].token, table.account.id]) assert.equal(text.includes(secret), false, secret);
  for (const secret of ['49500', '495', '3500', 'Caffè Latte', 'Latte', 'GIZLI_NOT', 'GIZLI_GIDER', 'Zeynep', 'isletme', 'kasiyer', 'garson', 'mutfak', 'card', 'MolaDemo'])
    assert.equal(withoutClockAndIds(payload).includes(secret), false, secret);
  // Delivered as it is: Merkez stores the report and the ticket, nothing else.
  assert.equal((await pair.link.sync()).ok, true);
  await pair.adminLogin();
  const merkezState = (await pair.admin('/state')).data, state = JSON.stringify(merkezState);
  assert.equal(state.includes(s.tables[0].token), false, 'table token');
  // "isletme" is the demo owner's user name; the package description names İşletmemi yönet's address (isletme.molayazilim.com.tr).
  for (const secret of ['49500', 'Latte', 'GIZLI', 'Zeynep', 'isletme']) assert.equal(withoutClockAndIds(merkezState).replaceAll('isletme.molayazilim.com.tr', '').includes(secret), false, secret);
  assert.match(state, /Yazıcı çalışmıyor/);
});

test('tickets: written on the café computer, queued while Merkez is unreachable, answered in Mola Yönetim, answer back at the café', async t => {
  let down = false;
  const pair = await merkezPair('tickets', { demo: true, fetch: (input, init) => down ? Promise.reject(new TypeError('fetch failed')) : fetch(input, init) }); t.after(() => pair.close());
  await pair.importDemo();
  const owner = pair.kafe(), other = pair.kafe();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); await other('/login', { username: 'diger', password: DEMO_PASSWORD });
  down = true;
  const create = { requestId: rid(), subject: 'Yazıcı sorunu', text: 'Sipariş çıktısını kontrol eder misiniz?' };
  const ticket = await owner('/staff/support', create); assert.equal(ticket.status, 200);
  assert.deepEqual((await owner('/staff/support', create)).data, ticket.data, 'a repeated request does not open a second ticket');
  const sync = await pair.link.sync();
  assert.equal(sync.ok, false); assert.match(sync.error!, /ulaşılamadı/);
  let mine = (await owner('/staff/support')).data;
  assert.equal(mine.tickets.length, 1); assert.equal(mine.tickets[0].messages[0].queued, true, 'waiting on this computer');
  assert.equal(mine.connection.ok, false); assert.match(mine.connection.error, /ulaşılamadı/);
  assert.equal((await other('/staff/support')).data.tickets.length, 0, 'another business never sees it');
  assert.equal((await other('/staff/support/reply', { requestId: rid(), ticketId: ticket.data.id, text: 'Sahte yanıt' })).status, 404);
  assert.equal((await owner('/staff/support/reply', { requestId: rid(), ticketId: ticket.data.id, text: 'x', close: true })).status, 403, 'only support closes');
  down = false;
  assert.equal((await pair.link.sync()).ok, true);
  mine = (await owner('/staff/support')).data;
  assert.equal(mine.tickets[0].messages[0].queued, undefined, 'delivered'); assert.equal(mine.connection.ok, true);
  await pair.adminLogin();
  let merkez = (await pair.admin('/state')).data;
  assert.equal(merkez.tickets.length, 1); assert.equal(merkez.tickets[0].subject, 'Yazıcı sorunu'); assert.equal(merkez.tickets[0].tenantId, 'mola-demo');
  assert.equal(merkez.businesses.find((b: { tenantId: string }) => b.tenantId === 'mola-demo').openTickets, 1);
  assert.equal(merkez.notifications.length, 2); assert.ok(merkez.notifications.every((n: { status: string }) => n.status === 'awaiting_configuration'));
  // A second delivery of the same messages adds nothing.
  await pair.link.sync(); assert.equal((await pair.admin('/state')).data.tickets[0].messages.length, 1);
  const reply = { requestId: rid(), ticketId: ticket.data.id, text: 'IP adresini kontrol edin.' };
  assert.equal((await pair.admin('/tickets/reply', reply)).status, 200);
  assert.equal((await pair.admin('/tickets/reply', reply)).status, 200, 'a repeated reply is answered once');
  await pair.link.sync();
  mine = (await owner('/staff/support')).data;
  assert.deepEqual(mine.tickets[0].messages.map((m: { source: string }) => m.source), ['business', 'support']);
  assert.equal(mine.tickets[0].messages[1].text, 'IP adresini kontrol edin.');
  assert.equal((await owner('/staff/support/reply', { requestId: rid(), ticketId: ticket.data.id, text: 'Teşekkürler, düzeldi.' })).status, 200);
  await pair.link.sync();
  assert.equal((await pair.admin('/tickets/reply', { requestId: rid(), ticketId: ticket.data.id, text: 'Sorun çözüldü.', close: true })).status, 200);
  await pair.link.sync();
  mine = (await owner('/staff/support')).data;
  assert.equal(mine.tickets[0].status, 'closed'); assert.equal(mine.tickets[0].messages.length, 4);
  assert.equal((await owner('/staff/support/reply', { requestId: rid(), ticketId: ticket.data.id, text: 'Bir şey daha' })).data.code, 'TICKET_CLOSED');
  merkez = (await pair.admin('/state')).data;
  assert.equal(merkez.notifications.length, 3);
  // Twenty open tickets at most per business.
  for (let i = 0; i < 20; i++) await owner('/staff/support', { requestId: rid(), subject: `Talep ${i}`, text: 'Yardım lazım.' });
  assert.equal((await owner('/staff/support', { requestId: rid(), subject: 'Fazla', text: 'Yardım lazım.' })).data.code, 'TICKET_LIMIT');
});

test('licence rules reach the café with the heartbeat: suspension, menu-only plan, freeze approval; offline the last licence holds until it ends', async t => {
  let time = Date.parse('2026-09-21T09:00:00Z'), down = false;
  const pair = await merkezPair('licence-flow', { demo: true, now: () => new Date(time), fetch: (input, init) => down ? Promise.reject(new TypeError('fetch failed')) : fetch(input, init) }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(), guest = pair.kafe(), fresh = () => pair.kafe();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const s = (await owner('/staff/state')).data;
  await owner('/staff/setup', { requestId: rid(), version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: 0, commissionBps: null });
  const token = s.tables[0].token;
  const session = await guest('/guest/session', { token }); assert.equal(session.status, 200);
  const order = () => guest('/guest/orders', { requestId: rid(), tableId: session.data.tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 });
  assert.equal((await order()).status, 200);
  const business = async () => (await pair.admin('/state')).data.businesses.find((b: { tenantId: string }) => b.tenantId === 'mola-demo');
  // Suspension: the café keeps working on its last licence until the heartbeat brings the new one.
  let b = await business();
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true })).status, 200);
  assert.equal((await guest('/guest/state')).status, 200);
  await pair.link.sync();
  const hidden = await guest('/guest/state'); assert.equal(hidden.status, 403); assert.equal(hidden.data.code, 'MENU_UNAVAILABLE'); assert.equal(hidden.data.products, undefined);
  assert.equal((await fresh()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE');
  // The café's own people hear that Mola stopped the service (not "Personelle görüşün").
  assert.equal((await owner('/staff/orders', { requestId: rid(), tableId: s.tables[1].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).data.code, 'SERVICE_SUSPENDED');
  // Staff still settle the open bill and reach support; the owner sees why.
  const open = (await owner('/staff/state')).data.tables.find((x: { id: string }) => x.id === session.data.tableId).account;
  assert.equal((await owner('/staff/payments', { requestId: rid(), accountId: open.id, version: open.version, method: 'cash', amount: 3500, tendered: 3500 })).status, 200);
  assert.equal((await owner('/staff/support')).status, 200);
  assert.match((await owner('/staff/state')).data.licenseNotice, /hizmeti Mola tarafından durduruldu\. Mola ekibiyle görüşün/);
  b = await business();
  await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: true, months: 0, suspended: false });
  await pair.link.sync();
  assert.equal((await fresh()('/guest/session', { token })).status, 200);
  // Menu-only plan: the menu stays, ordering and waiter calls close.
  await pair.admin('/service-plan', { requestId: rid(), tenantId: 'mola-demo', service: 'menu' });
  await pair.link.sync();
  const menuGuest = fresh(); const menuSession = await menuGuest('/guest/session', { token });
  assert.equal((await menuGuest('/guest/state')).data.menuOnly, true);
  assert.equal((await menuGuest('/guest/orders', { requestId: rid(), tableId: menuSession.data.tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).data.code, 'MENU_ONLY');
  assert.equal((await menuGuest('/guest/call', { requestId: rid(), kind: 'waiter' })).data.code, 'MENU_ONLY');
  await pair.admin('/service-plan', { requestId: rid(), tenantId: 'mola-demo', service: 'full' });
  await pair.link.sync();
  // Freeze: requested by the owner on the café computer, decided in Mola Yönetim, enforced from the new licence.
  const freeze = await owner('/staff/license/freeze', { requestId: rid(), reason: 'Dükkân taşınması', startDate: '2026-09-21', days: 10 });
  assert.equal(freeze.status, 200);
  assert.equal((await owner('/staff/license/freeze', { requestId: rid(), reason: 'İkinci talep', startDate: '2026-09-22', days: 5 })).data.code, 'FREEZE_EXISTS', 'checked here too, while the first one is on its way');
  let support = (await owner('/staff/support')).data;
  assert.equal(support.license.freezes.at(-1).status, 'pending'); assert.deepEqual(support.queuedFreezes, [freeze.data.id]);
  await pair.link.sync();
  support = (await owner('/staff/support')).data;
  assert.deepEqual(support.queuedFreezes, []); assert.equal(support.license.freezes.at(-1).id, freeze.data.id);
  b = await business(); assert.equal(b.freezes.at(-1).status, 'pending');
  assert.equal((await pair.admin('/freezes/review', { requestId: rid(), tenantId: 'mola-demo', freezeId: freeze.data.id, approve: true, note: '' })).status, 200);
  await pair.link.sync();
  assert.equal((await fresh()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE', 'frozen');
  assert.match((await owner('/staff/state')).data.licenseNotice, /donduruldu/);
  assert.equal((await pair.admin('/freezes/end', { requestId: rid(), tenantId: 'mola-demo', freezeId: freeze.data.id })).status, 200);
  await pair.link.sync();
  assert.equal((await fresh()('/guest/session', { token })).status, 200);
  // Offline: the last licence holds while Merkez is unreachable, but at most 14 days after the last contact (a warning from
  // day 7), and never past its own end. Turning the clock back does not help.
  down = true;
  const contact = time;
  time = contact + 7 * DAY;
  assert.equal((await pair.link.sync()).ok, false);
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); 
  let link = (await owner('/staff/support')).data.merkez;
  assert.equal(link.offlineDays, 7); assert.match(link.notice, /7 gündür bağlanılamadı\. 7 gün içinde/);
  time = contact + 14 * DAY - 60_000;
  assert.equal((await fresh()('/guest/session', { token })).status, 200, 'still within 14 days');
  time = contact + 14 * DAY; await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); 
  assert.equal((await fresh()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE');
  assert.equal((await owner('/staff/orders', { requestId: rid(), tableId: s.tables[1].id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 })).data.code, 'LICENSE_EXPIRED');
  link = (await owner('/staff/support')).data.merkez;
  assert.equal(link.blocked, 'offline'); assert.match(link.notice, /14 gündür bağlanılamadı: müşteri menüsü ve yeni siparişler kapalı/);
  assert.equal((await owner('/staff/support')).data.license.blocked, 'offline');
  time = contact + DAY;
  assert.equal((await fresh()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE', 'the clock turned back does not reopen it');
  // Back online: the signed pulse is the new last contact.
  down = false; time = contact + 15 * DAY;
  assert.equal((await pair.link.sync()).ok, true); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); 
  assert.equal((await fresh()('/guest/session', { token })).status, 200);
  assert.equal((await owner('/staff/support')).data.merkez.notice, null);
  // The licence's own end is the other limit: connected a minute before it, closed at it.
  await pair.adminLogin(); b = await business();
  time = Date.parse(b.endsAt) - 60_000;
  assert.equal((await pair.link.sync()).ok, true);
  down = true;
  assert.equal((await fresh()('/guest/session', { token })).status, 200, 'offline grace until the end of the licence');
  time = Date.parse(b.endsAt);
  assert.equal((await fresh()('/guest/session', { token })).data.code, 'MENU_UNAVAILABLE');
  // Back online with a renewal made meanwhile: the new licence arrives and the café opens again.
  down = false; await pair.adminLogin();
  await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 12, suspended: false });
  await pair.link.sync();
  assert.equal((await fresh()('/guest/session', { token })).status, 200);
});
test('the café has no vendor panel: /platform, its API and the Mola Yönetim page are 404', async t => {
  const pair = await merkezPair('no-platform', { demo: true }); t.after(() => pair.close());
  for (const path of ['/platform', '/platform/', '/merkez.html', '/api/platform/state', '/api/platform/login', '/api/merkez/admin/state'])
    assert.equal((await fetch(pair.kafeBase + path)).status, 404, path);
  assert.equal((await fetch(pair.kafeBase + '/api/platform/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'x' }) })).status, 404);
  const health = await (await fetch(pair.kafeBase + '/api/health')).json();
  assert.equal(health.role, 'kafe'); assert.equal(health.activation, 'activate');
  // And Mola Merkez never serves café data routes.
  assert.equal((await fetch(pair.merkezBase + '/api/staff/state')).status, 404);
  assert.equal((await fetch(pair.merkezBase + '/api/merkez/v1/health').then(r => r.json())).role, 'merkez');
  assert.ok(DAY);
});
test('automatic heartbeats keep under Merkez’s 30 a minute: a burst of nudges is one delivery now and one owed, nothing lost', async t => {
  let syncs = 0;
  const pair = await merkezPair('heartbeat-gap', { demo: true, fetch: (input, init) => { if (String(input).endsWith('/sync')) syncs++; return fetch(input, init); } }); t.after(() => pair.close());
  await pair.importDemo();
  const owner = pair.kafe(); await owner('/login', { username: 'isletme', password: DEMO_PASSWORD });
  pair.link.start(); pair.link.nudge();
  // Written while that delivery is on its way: its own nudge is held back, not dropped until the next ten-minute heartbeat.
  const ticket = await owner('/staff/support', { requestId: rid(), subject: 'Yazıcı', text: 'Çıktı gelmiyor.' }); assert.equal(ticket.status, 200);
  for (let i = 0; i < 10; i++) pair.link.nudge();
  assert.equal(syncs, 1);
  const until = Date.now() + 8000;
  while (Date.now() < until && (await owner('/staff/support')).data.tickets[0].messages[0].queued) await new Promise(r => setTimeout(r, 200));
  assert.equal((await owner('/staff/support')).data.tickets[0].messages[0].queued, undefined, 'delivered by the owed heartbeat');
  assert.equal(syncs, 2);
  pair.link.stop();
});

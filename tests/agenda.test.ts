import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { AgendaBook } from '../server/agenda.js';
import { Notifications } from '../server/notifications.js';
import { istanbulDay, istanbulInstant, isDay, monthGrid, reminderDue, shiftMonth } from '../packages/domain/agenda.js';
import { licensed, temp } from './merkez-fixture.js';

test('Ajanda dates: Monday-first 6-week grid, Turkish wall clock and reminder offsets', () => {
  const grid = monthGrid('2026-10');
  assert.equal(grid.length, 42); assert.equal(grid[0], '2026-09-28'); assert.equal(grid[41], '2026-11-08');
  assert.equal(monthGrid('2026-02')[0], '2026-01-26', 'February 2026 starts on a Sunday: the grid starts the Monday before');
  assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(isDay('2026-02-29'), false); assert.equal(isDay('2028-02-29'), true); assert.equal(isDay('2026-13-01'), false);
  // Turkey is UTC+3 all year: 09:00 in İstanbul is 06:00 UTC, also in winter.
  assert.equal(istanbulInstant('2026-10-04', '09:00'), Date.parse('2026-10-04T06:00:00Z'));
  assert.equal(istanbulInstant('2027-01-15', '00:30'), Date.parse('2027-01-14T21:30:00Z'));
  assert.equal(istanbulDay(Date.parse('2026-10-04T21:30:00Z')), '2026-10-05', 'after 00:00 in Turkey it is already the next day');
  assert.equal(reminderDue({ day: '2026-10-10', reminder: { offset: 'same', time: '08:15' } }), Date.parse('2026-10-10T05:15:00Z'));
  assert.equal(reminderDue({ day: '2026-10-10', reminder: { offset: 'day', time: '20:00' } }), Date.parse('2026-10-09T17:00:00Z'));
  assert.equal(reminderDue({ day: '2026-10-10', reminder: { offset: 'week', time: '09:00' } }), Date.parse('2026-10-03T06:00:00Z'));
  assert.equal(reminderDue({ day: '2026-10-10' }), undefined);
});

test('Ajanda notes: owner-only CRUD, sealed rows, sales notes, reminders become one notification, read per owner', async t => {
  const directory = temp('agenda'), store = new Store(directory); licensed(store);
  let clock = new Date('2026-10-04T05:00:00Z');
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() { let cookie = ''; return async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    return { status: r.status, data: await r.json() as any };
  }; }
  const owner = client(), other = client(), cashier = client();
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await other('/login', { username: 'diger', password: DEMO_PASSWORD })).status, 200);
  assert.equal((await owner('/staff/users', { username: 'kasa1', name: 'Kasa', role: 'cashier', password: 'KasaDeneme!2026' })).status, 200);
  assert.equal((await cashier('/login', { username: 'kasa1', password: 'KasaDeneme!2026' })).status, 200);

  // Create, list, edit, delete.
  const wedding = await owner('/staff/agenda', { day: '2026-10-10', time: '19:00', title: 'Cumartesi düğün yemeği', text: 'Salon kapalı, 80 kişi' });
  assert.equal(wedding.status, 200); assert.equal(wedding.data.note.kind, 'agenda'); assert.equal(wedding.data.note.time, '19:00');
  const sales = await owner('/staff/agenda', { day: '2026-10-03', kind: 'sales', title: '', text: 'Kampanya bugün satışları bayağı artırdı' });
  assert.equal(sales.status, 200);
  let list = (await owner('/staff/agenda?from=2026-09-28&to=2026-11-08')).data.notes;
  assert.deepEqual(list.map((n: any) => [n.day, n.kind]), [['2026-10-03', 'sales'], ['2026-10-10', 'agenda']]);
  const edited = await owner('/staff/agenda', { id: wedding.data.note.id, day: '2026-10-10', time: null, title: 'Düğün yemeği', text: 'Salon kapalı, 90 kişi' });
  assert.equal(edited.status, 200); assert.equal(edited.data.note.time, undefined); assert.equal(edited.data.note.createdAt, wedding.data.note.createdAt);
  assert.equal((await owner('/staff/agenda', { day: '2026-10-10', title: ' ', text: '' })).status, 400, 'an empty note is refused');
  assert.equal((await owner('/staff/agenda', { day: '2026-02-30', title: 'x', text: '' })).status, 400);
  assert.equal((await owner('/staff/agenda?from=2026-01-01&to=2027-06-01')).status, 400, 'at most 400 days per read');
  // Reports are owner-only, and so are their notes; another business sees none of them.
  assert.equal((await cashier('/staff/agenda?from=2026-10-01&to=2026-10-31')).status, 403);
  assert.equal((await cashier('/staff/agenda', { day: '2026-10-10', title: 'x', text: '' })).status, 403);
  assert.equal((await other('/staff/agenda?from=2026-10-01&to=2026-10-31')).data.notes.length, 0);
  assert.equal((await other('/staff/agenda/delete', { id: wedding.data.note.id })).status, 404);
  // Sealed with the business key: the words are not in the database file in the clear.
  const raw = store.db.prepare('SELECT payload FROM agenda_notes').all() as { payload: Uint8Array }[];
  assert.equal(raw.length, 2); assert.ok(raw.every(r => !Buffer.from(r.payload).toString('utf8').includes('Salon')));
  assert.equal((await owner('/staff/agenda/delete', { id: sales.data.note.id })).status, 200);
  assert.equal((await owner('/staff/agenda/delete', { id: sales.data.note.id })).status, 404);
  list = (await owner('/staff/agenda?from=2026-10-01&to=2026-10-31')).data.notes;
  assert.deepEqual(list.map((n: any) => n.title), ['Düğün yemeği']);

  // A reminder one day before at 09:00 (06:00 UTC) is due on 4 October 06:00 UTC.
  const reminded = await owner('/staff/agenda', { day: '2026-10-05', title: 'Tedarikçi gelecek', text: '', reminder: { offset: 'day', time: '09:00' } });
  assert.equal(reminded.status, 200);
  assert.equal((await owner('/staff/notifications/count')).data.unread, 0, 'not due yet');
  clock = new Date('2026-10-04T06:00:30Z');
  // Due with no screen open: the server's own sweep (every minute in app.ts) makes it.
  const sweeper = new Notifications(store, new AgendaBook(store, () => clock), () => clock);
  sweeper.sweepAll(); sweeper.sweepAll();
  let inbox = (await owner('/staff/notifications')).data;
  assert.equal(inbox.unread, 1); assert.equal(inbox.items.length, 1, 'created once, however often it is swept');
  assert.equal(inbox.items[0].kind, 'reminder'); assert.match(inbox.items[0].title, /Tedarikçi gelecek/); assert.equal(inbox.items[0].day, '2026-10-05');
  assert.equal((await other('/staff/notifications/count')).data.unread, 0, 'another business gets none');
  assert.equal((await cashier('/staff/notifications/count')).status, 403);
  // Moving the reminder makes a new one (a new due time); reading clears the count for this owner only.
  clock = new Date('2026-10-04T07:00:00Z');
  await owner('/staff/agenda', { id: reminded.data.note.id, day: '2026-10-05', title: 'Tedarikçi gelecek', text: '', reminder: { offset: 'same', time: '09:00' } });
  const count = (await owner('/staff/notifications/count')).data;
  assert.equal(count.unread, 1);
  // 10 Ekim: the newest unread ones with their line, for the toast of a screen that is open (src/NotificationToasts.tsx).
  assert.equal(count.recent.length, 1); assert.equal(count.recent[0].kind, 'reminder'); assert.match(count.recent[0].title, /Tedarikçi gelecek/);
  assert.equal(count.recent[0].day, '2026-10-05'); assert.equal(typeof count.recent[0].text, 'string'); assert.equal(count.recent[0].id, count.latest.id);
  clock = new Date('2026-10-05T06:01:00Z');
  // A new business day (05:00) ends staff sessions: sign in again.
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  inbox = (await owner('/staff/notifications')).data; assert.equal(inbox.unread, 2);
  assert.equal((await owner('/staff/notifications/read', { ids: [inbox.items[0].id] })).data.unread, 1);
  assert.equal((await owner('/staff/notifications/read', {})).data.unread, 0);
  const tenant = 'mola-demo';
  assert.equal(sweeper.unread(tenant, 'another-owner-id'), 2, 'read state is per owner');
  // A reminder far in the past (server off for weeks) is not delivered late.
  await owner('/staff/agenda', { day: '2026-09-01', title: 'Eski', text: '', reminder: { offset: 'same', time: '09:00' } });
  assert.equal((await owner('/staff/notifications/count')).data.unread, 0);
});

test('café notices: licence ending, record closed and failed backups arrive once each', () => {
  const store = new Store(temp('notices'));
  try {
    let now = new Date('2026-10-04T08:00:00Z'), license: any = { endsAt: '2026-10-09T08:00:00Z', active: true, frozen: false, daysRemaining: 5 };
    const status: any = { lastAttemptAt: '2026-10-04T00:30:00Z', lastError: 'Yedek diskinde yer yok.' };
    const book = new Notifications(store, new AgendaBook(store, () => now), () => now, { license: () => license, backups: { status: () => status } });
    book.sweep('mola-demo'); book.sweep('mola-demo');
    let items = book.list('mola-demo', 'owner');
    assert.deepEqual(items.map(n => n.kind).sort(), ['backup', 'license']);
    assert.match(items.find(n => n.kind === 'license')!.title, /5 gün kaldı/);
    license = { ...license, daysRemaining: 1 }; status.lastError = undefined; book.sweep('mola-demo');
    license = { ...license, active: false, daysRemaining: 0 }; book.sweep('mola-demo');
    license = { ...license, blocked: 'removed' }; book.sweep('mola-demo'); book.sweep('mola-demo');
    items = book.list('mola-demo', 'owner');
    assert.deepEqual(items.map(n => n.title).sort(), ['İşletme kaydı kapatıldı', 'Lisans süreniz doldu', 'Lisansınız yarın bitiyor', 'Lisansınızın bitmesine 5 gün kaldı', 'Otomatik yedek alınamadı'].sort());
    // Kept 90 days.
    now = new Date('2027-02-01T08:00:00Z'); license = undefined; book.sweep('mola-demo');
    assert.equal(book.list('mola-demo', 'owner').length, 0);
  } finally { store.close(); }
});

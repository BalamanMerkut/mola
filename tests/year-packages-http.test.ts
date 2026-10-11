import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { businessDay, dayStart } from '../packages/domain/business-day.js';
import { reportRange } from '../packages/domain/reports.js';
import { licensed } from './merkez-fixture.js';
import { busyCafe, HOUR, packerFor, tenant } from './year-fixture.js';

/*
 * Yıl paketleri as the owner meets them (HTTP): reports, the year table, payment search, an old bill's refund window and the
 * accountant's Excel read the closed years from their packages; a back-dated expense is refused with "Bu yıl kapandı"; a
 * refund of a closed year's bill counts today; the owner's notice "2025 yılı kapandı ve paketlendi."
 */
test('year packages over HTTP: refusals in plain Turkish, an old bill refunded today, reports and exports read the packages', async t => {
  const c = busyCafe('yil-http'), { store } = c;
  c.at(dayStart('2026-02-02') + 6 * HOUR);
  licensed(store);
  const app = createApp(store, () => new Date(c.now()));
  // The packer as the server wires it, with its notices going to Bildirimler.
  const notices: string[] = [];
  await packerFor(c, { notify: (_t, _k, title) => notices.push(title) }).run();
  assert.ok(notices.includes('2025 yılı kapandı ve paketlendi.') && notices.includes('2024 yılı kapandı ve paketlendi.'), notices.join(' | '));
  const server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = '';
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
    const type = r.headers.get('content-type') ?? '';
    return { status: r.status, data: type.includes('json') ? await r.json() as any : await r.arrayBuffer() };
  };
  assert.equal((await call('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);

  // Reports: the year table and each closed year read from their packages, equal to the history's own figures.
  const years = (await call('/staff/reports/years')).data;
  assert.deepEqual(years.years, ['2026', '2025', '2024']);
  const s = store.read(tenant);
  for (const year of ['2024', '2025']) {
    const { start, end } = reportRange(`${year}-01-01`, `${year}-12-31`), span = store.history.reportSpan(tenant, s, start, end).total;
    const row = years.table.years.find((y: { year: string }) => y.year === year), one = (await call(`/staff/reports/overview?from=${year}-01-01&to=${year}-12-31`)).data;
    assert.equal(row.sales, span.cash + span.card + span.platform, year); assert.equal(one.sales, row.sales, year);
  }
  const before2025 = (await call('/staff/reports/overview?from=2025-01-01&to=2025-12-31')).data;

  // A back-dated expense into 2025: "Bu yıl kapandı".
  const refused = await call('/staff/expenses', { requestId: randomUUID(), amount: 12_00, description: 'Aralık faturası (geç)', day: '2025-12-30', method: 'transfer' });
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'CLOSED_YEAR');
  assert.match(refused.data.message, /^Bu yıl kapandı: 2025 yılının kayıtları paketlendi ve artık değiştirilemez\. Kaydı bugünün tarihiyle girin\.$/);
  assert.equal((await call('/staff/expenses', { requestId: randomUUID(), amount: 12_00, description: 'Aralık faturası (geç)', method: 'transfer' })).status, 200, 'today is fine');

  // The old bill: found by search, its refund window opens, a method change is refused, a refund counts today.
  const page = (await call('/staff/payment-adjustments?from=2025-12-29&to=2025-12-29&limit=50')).data;
  assert.ok(page.rows.length >= 3, 'the closed day\'s payments are listed');
  const old = page.rows.find((r: { refunded: number; method: string }) => !r.refunded && r.method !== 'platform');
  const window = (await call(`/staff/payment-adjustments/${old.id}/refund`)).data;
  assert.equal(window.payment.id, old.id); assert.ok(window.items.length >= 1);
  const method = await call('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: old.id, revision: window.payment.revision, kind: 'method', amount: 0, method: old.method === 'cash' ? 'card' : 'cash', commission: 0, reason: 'Yanlış yöntem' });
  assert.equal(method.status, 409); assert.match(method.data.message, /^Bu yıl kapandı: 2025 .* Ödeme yöntemi düzeltilemez/);
  const refund = await call('/staff/payment-adjustments', { requestId: randomUUID(), paymentId: old.id, revision: window.payment.revision, kind: 'refund', amount: 1500, method: 'cash', commission: 0, reason: 'Eski hesaba iade' });
  assert.equal(refund.status, 200, JSON.stringify(refund.data)); assert.equal(refund.data.closedPeriod, true);
  const today = businessDay(c.now()), now = (await call(`/staff/reports/overview?from=${today}&to=${today}`)).data;
  assert.equal(now.refunds, 1500, 'the refund is in today\'s report');
  assert.deepEqual((await call('/staff/reports/overview?from=2025-01-01&to=2025-12-31')).data, before2025, '2025 does not change');
  // A correction of a closed year's cash closing is refused too.
  const closings = (await call('/staff/reports/cash-closings?from=2025-12-29&to=2025-12-29')).data;
  assert.equal(closings.closings.length, 1);
  const fix = await call('/staff/cash/corrections', { requestId: randomUUID(), closingId: closings.closings[0].id, amount: 500, note: 'Sonradan bulunan' });
  assert.equal(fix.status, 409); assert.match(fix.data.message, /Kapanmış yılın kasa kapanışı düzeltilemez/);

  // Exports: the accountant's Excel for a closed year and "Tümü", the printable page.
  for (const [from, to] of [['2025-01-01', '2025-12-31'], ['all', 'all']]) {
    const file = await call(`/staff/reports/accountant.xlsx?from=${from}&to=${to}`);
    assert.equal(file.status, 200); assert.ok((file.data as ArrayBuffer).byteLength > 2000);
  }
  assert.equal((await call('/staff/reports/document?from=2024-01-01&to=2024-12-31')).status, 200);
  // Old-bill search over all time reaches into the packages.
  const search = (await call(`/staff/payment-adjustments?from=all&to=all&q=${encodeURIComponent(old.tableName)}&limit=200`)).data;
  assert.ok(search.rows.some((r: { id: string }) => r.id === old.id) || search.next, 'found (or the search goes on from its cursor)');
});

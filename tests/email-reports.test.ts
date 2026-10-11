import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { join } from 'node:path';
import { endedPeriods, periodEnd, periodOf, plainSummary, previousPeriod, reportHtml, reportText, type PeriodReport } from '../server/email-reports-content.js';
import { EmailReports, reportAttachment } from '../server/email-reports.js';
import { findPrintBrowser, htmlToPdf } from '../server/pdf-print.js';
import { reportDocument } from '../server/report-document.js';
import { composeMessage } from '../server/smtp.js';
import { decodeParts, fakeSmtp } from './fake-smtp.js';
import { licensed, temp } from './merkez-fixture.js';

const PASSWORD = 'uygulama-sifresi-16';

test('dönem raporları: periods follow the business day (05:00), weeks run Monday–Sunday, months and years are calendar ones', () => {
  assert.deepEqual(periodOf('day', '2026-10-05'), { kind: 'day', key: 'gun:2026-10-05', from: '2026-10-05', to: '2026-10-05', title: 'Gün sonu raporu · 5 Ekim 2026 Pazartesi' });
  assert.deepEqual([periodOf('week', '2026-10-07').from, periodOf('week', '2026-10-07').to, periodOf('week', '2026-10-11').from], ['2026-10-05', '2026-10-11', '2026-10-05'], 'Sunday belongs to the week of the Monday before');
  assert.equal(periodOf('week', '2026-10-05').title, 'Haftalık rapor · 5 Ekim – 11 Ekim 2026');
  assert.equal(periodOf('week', '2026-12-30').title, 'Haftalık rapor · 28 Aralık 2026 – 3 Ocak 2027', 'a week across the new year names both years');
  assert.deepEqual([periodOf('month', '2028-02-10').from, periodOf('month', '2028-02-10').to, periodOf('month', '2026-09-30').title], ['2028-02-01', '2028-02-29', 'Aylık rapor · Eylül 2026']);
  assert.deepEqual([periodOf('year', '2026-06-01').key, periodOf('year', '2026-06-01').to], ['yil:2026', '2026-12-31']);
  // The day of 5 October ends at 05:00 on the 6th (Türkiye, 02:00 UTC); the week of 5–11 October on Monday the 12th at 05:00.
  assert.equal(new Date(periodEnd(periodOf('day', '2026-10-05'))).toISOString(), '2026-10-06T02:00:00.000Z');
  assert.equal(new Date(periodEnd(periodOf('week', '2026-10-05'))).toISOString(), '2026-10-12T02:00:00.000Z');
  assert.equal(previousPeriod(periodOf('month', '2026-03-15')).key, 'ay:2026-02');
  // 04:59 on the 6th: the 5th is still running; 05:00: it ended.
  assert.equal(endedPeriods('day', Date.parse('2026-10-06T01:59:59Z'), 86400_000)[0].from, '2026-10-04');
  assert.equal(endedPeriods('day', Date.parse('2026-10-06T02:00:00Z'), 86400_000)[0].from, '2026-10-05');
  assert.equal(endedPeriods('week', Date.parse('2026-10-12T01:59:00Z'), 14 * 86400_000)[0].from, '2026-09-28');
  assert.equal(endedPeriods('week', Date.parse('2026-10-12T02:00:00Z'), 14 * 86400_000)[0].from, '2026-10-05');
});

test('the shared SMTP client: HTML with a text fallback, every recipient, header lines never broken by a name', () => {
  const message = composeMessage('kafe@example.com', { to: ['a@example.com', 'b@example.com'], subject: 'Gün sonu', text: 'düz metin', html: '<p>html</p>', fromName: 'Kafe\r\nBcc: x@example.com' });
  assert.match(message, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <kafe@example\.com>\r\n/);
  assert.match(message, /\r\nTo: <a@example\.com>, <b@example\.com>\r\n/);
  assert.doesNotMatch(message, /\r\nBcc:/, 'a line break in the name never makes a header');
  assert.match(message, /Content-Type: multipart\/alternative; boundary="mola-/);
  const parts = decodeParts(message.replace(/\r\n/g, '\n'));
  assert.deepEqual(parts.map(p => [p.type, p.text]), [['text/plain', 'düz metin'], ['text/html', '<p>html</p>']]);
  // Mola Merkez's own mails stay exactly as before: plain text, "Mola Yönetim" written as it is.
  const merkez = composeMessage('satici@example.com', { to: 'satici@example.com', subject: 'x', text: 'y', fromName: 'Mola Yönetim', encodeName: false });
  assert.match(merkez, /^From: Mola Yönetim <satici@example\.com>\r\nTo: <satici@example\.com>\r\n/);
  assert.match(merkez, /\r\nContent-Type: text\/plain; charset=utf-8\r\n/); assert.doesNotMatch(merkez, /multipart/);
});

async function cafe(t: { after: (fn: () => Promise<void> | void) => void }, start: string) {
  const directory = temp('email-reports'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const app = createApp(store, () => clock), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  /** A staff client; sign-ins end at 05:00 like a real tablet's, so it signs in again when the test's clock passed that. */
  function client() {
    let cookie = '', login: unknown;
    const call = async (path: string, body?: unknown): Promise<{ status: number; data: any }> => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      if (path === '/login') login = body;
      const data = await r.json() as any;
      if (r.status === 401 && login && path !== '/login') { await call('/login', login); return call(path, body); }
      return { status: r.status, data };
    };
    return call;
  }
  return { store, client, reports: app.locals.emailReports as EmailReports, now: () => clock, set: (iso: string) => { clock = new Date(iso); } };
}

test('e-posta raporları: sealed account, test mail, day report after 05:00 with catch-up and no duplicates, early after the closing, week with staff hours, Bildirimler copy, retries', async t => {
  const smtp = await fakeSmtp(PASSWORD); t.after(() => smtp.close());
  const c = await cafe(t, '2026-10-05T09:00:00Z'); // Monday 12:00
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); await cashier('/login', { username: 'kasiyer', password: DEMO_PASSWORD }); await waiter('/login', { username: 'garson', password: DEMO_PASSWORD });
  // Only the owner.
  assert.equal((await cashier('/staff/email-reports')).status, 403);
  const account = { provider: 'other', host: '127.0.0.1', port: smtp.port, security: 'none', user: 'kafe@example.com', password: PASSWORD };
  assert.equal((await owner('/staff/email-reports', { account: { ...account, host: 'smtp.example.com' } })).data.code, 'EMAIL_SECURITY', 'no plain SMTP to another computer');
  assert.equal((await owner('/staff/email-reports', { account, to: ['yanlış'] })).data.code, 'EMAIL_ADDRESS');
  assert.equal((await owner('/staff/email-reports/test', {})).data.code, 'EMAIL_ACCOUNT', 'a test mail needs a saved account');
  const saved = await owner('/staff/email-reports', { account, to: ['sahip@example.com', 'muhasebe@example.com'], reports: { day: true, week: true, month: false, year: false } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.account.hasPassword, true); assert.equal(JSON.stringify(saved.data).includes(PASSWORD), false, 'the password never comes back');
  // Sealed on disk: the business key, never plain.
  const row = c.store.db.prepare('SELECT payload FROM email_reports').get() as { payload: Uint8Array };
  assert.equal(Buffer.from(row.payload).includes(Buffer.from(PASSWORD)), false); assert.equal(Buffer.from(row.payload).includes(Buffer.from('kafe@example.com')), false);
  assert.equal((await owner('/staff/email-reports', { account: { ...account, password: undefined } })).data.account.hasPassword, true, 'a blank password keeps the saved one');

  // "Deneme e-postası gönder": both recipients, HTML and text, the business day so far.
  const tested = await owner('/staff/email-reports/test', {});
  assert.equal(tested.status, 200, JSON.stringify(tested.data)); assert.equal(smtp.received.length, 1);
  assert.deepEqual(smtp.received[0].to, ['<sahip@example.com>', '<muhasebe@example.com>']); assert.equal(smtp.received[0].auth.split('\0')[1], 'kafe@example.com');
  const testParts = decodeParts(smtp.received[0].data);
  assert.deepEqual(testParts.map(p => [p.type, p.name]), [['text/plain', undefined], ['text/html', undefined], ['text/html', 'Mola-Gun-sonu-raporu-2026-10-05.html']], 'text, HTML, and the printable page attached (HTML here: no browser in unit tests)');
  assert.match(testParts[0].text, /deneme e-postasıdır/); assert.match(testParts[1].text, /<h1[^>]*>Gün sonu raporu · 5 Ekim 2026 Pazartesi<\/h1>/);
  assert.match(testParts[0].text, /Bugün şu ana kadar satış yok\./, 'a plain sentence first'); assert.match(testParts[0].text, /ekteki rapor dosyasını açın/);
  assert.match(testParts[2].text, /@page\{size:A4/); assert.match(testParts[2].text, /Deneme: bugünün şu ana kadarki rakamları/); assert.doesNotMatch(testParts[2].text, /<script/i);

  // Sales on the evening of 5 October, one after midnight (01:30, still the 5th), a tip and an expense.
  const tables = (await owner('/staff/state')).data.tables;
  const sell = async (at: string, table: number, method: 'cash' | 'card', tip?: number) => {
    c.set(at);
    const placed = await waiter('/staff/orders', { requestId: randomUUID(), tableId: tables[table].id, lines: [{ productId: 'tea', quantity: 4, selections: [] }], expectedTotal: 14000 });
    assert.equal(placed.status, 200, JSON.stringify(placed.data));
    const acc = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === placed.data.accountId).account;
    const paid = await cashier('/staff/payments', { requestId: randomUUID(), accountId: acc.id, version: acc.version, method, amount: 14000, tendered: 14000 + (tip ?? 0), ...(tip ? { tip, tipMethod: method } : {}) });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
  };
  await sell('2026-10-05T17:30:00Z', 0, 'cash', 500); // 20:30
  await sell('2026-10-05T22:30:00Z', 1, 'card'); // 01:30 on the 6th: still the business day of the 5th
  assert.equal((await cashier('/staff/expenses', { requestId: randomUUID(), amount: 2500, description: 'Gece buz' })).status, 200);

  // 04:59: the day has not ended (and no gün sonu was made): nothing yet.
  c.set('2026-10-06T01:59:00Z'); assert.equal(await c.reports.tick(), 0); assert.equal(c.reports.view('mola-demo').recent.length, 0);
  // The computer was off at 05:00 and comes on at 09:00: the report of the 5th goes now (catch-up), once.
  c.set('2026-10-06T06:00:00Z'); assert.equal(await c.reports.tick(), 1); assert.equal(smtp.received.length, 2);
  const day = decodeParts(smtp.received[1].data), text = day[0].text;
  assert.match(text, /Gün sonu raporu · 5 Ekim 2026 Pazartesi/);
  // The owner reads this first: one plain paragraph before the figures.
  assert.match(text, /\n\n5 Ekim Pazartesi günü 2 sipariş, ₺280 satış yapıldı\. Gün sonu kapanışı yapılmadı\. En çok kazandıran: Demleme Çay \(₺280\)\. Giderler, iadeler ve komisyon düşülünce elde kalan ₺255\.\n/);
  assert.equal(day.find(p => p.name)?.name, 'Mola-Gun-sonu-raporu-2026-10-05.html');
  assert.match(day.find(p => p.name)!.text, /5 Ekim Pazartesi günü 2 sipariş, ₺280 satış yapıldı/);
  assert.match(text, /Toplam tahsilat: ₺280\b/); assert.match(text, /Nakit: ₺140\b/); assert.match(text, /Kart: ₺140\b/); assert.match(text, /Sipariş: 2\b/);
  assert.match(text, /Bahşiş \(satışa dahil değil\): ₺5 \(nakit ₺5 · kart ₺0\)/); assert.match(text, /Gider: ₺25 \(1 kayıt\)/); assert.match(text, /1\. Demleme Çay: ₺280 · 8 adet/);
  assert.match(text, /önceki güne göre: önceki dönemde satış yoktu/); assert.match(text, /Bu dönemde gün sonu kapanışı yapılmadı/);
  assert.match(day[1].text, /<table/); assert.doesNotMatch(text, /Masa 0/, 'no table names, no guests');
  assert.match(decodeURIComponent(escape(Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(smtp.received[1].data)![1], 'base64').toString('binary'))), /^Gün sonu raporu · 5 Ekim 2026 Pazartesi · /);
  // The same summary in Destek → Bildirimler.
  const notes = await owner('/staff/notifications'); assert.equal(notes.status, 200, JSON.stringify(notes.data));
  const inbox = notes.data.items.filter((n: any) => n.kind === 'report');
  assert.equal(inbox.length, 1); assert.equal(inbox[0].title, 'Gün sonu raporu · 5 Ekim 2026 Pazartesi'); assert.match(inbox[0].text, /^Satış ₺280 \(nakit ₺140 · kart ₺140\) · 2 sipariş · bahşiş ₺5 · gider ₺25/);
  // No duplicates: again, and after a restart (a new loop over the same data).
  assert.equal(await c.reports.tick(), 0);
  assert.equal(await new EmailReports(c.store, c.now, {}, async () => { throw new Error('should not send'); }).tick(), 0);
  assert.equal(smtp.received.length, 2);
  const status = (await owner('/staff/email-reports')).data.status;
  assert.equal(status.lastSentTitle, 'Gün sonu raporu · 5 Ekim 2026 Pazartesi'); assert.equal(status.lastError, null);

  // The 6th: the gün sonu kapanışı at 22:00 sends the day's report right away ("kapanıştan sonra"), not again at 05:00.
  c.set('2026-10-06T15:00:00Z'); assert.equal((await cashier('/staff/cash/open', { requestId: randomUUID(), amount: 10000 })).status, 200);
  await sell('2026-10-06T16:00:00Z', 2, 'cash');
  c.set('2026-10-06T19:00:00Z');
  const count = (await cashier('/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 10000 + 14000 - 100 })).data;
  assert.equal(count.day, '2026-10-06', JSON.stringify(count));
  assert.equal((await cashier('/staff/cash/finish', { id: count.id })).status, 200);
  c.set('2026-10-06T19:01:00Z'); assert.equal(await c.reports.tick(), 1);
  const early = decodeParts(smtp.received[2].data)[0].text;
  assert.match(early, /Gün sonu raporu · 6 Ekim 2026 Salı/); assert.match(early, /gün sonu kapanışından sonra/); assert.match(early, /Kasa eksik ₺1 \(sayılan/);
  assert.match(early, /önceki güne göre %50 düşüş \(₺280\)/);
  assert.match(early, /6 Ekim Salı günü 1 sipariş, ₺140 satış yapıldı; önceki güne göre %50 az\. Kasa ₺1 eksik çıktı\./);
  c.set('2026-10-07T03:00:00Z'); assert.equal(await c.reports.tick(), 0, 'the 6th went already');

  // A failing account: the error shows, the report waits 1 minute and goes again; after 6 tries it is "Gönderilemedi".
  c.set('2026-10-07T21:00:00Z');
  await owner('/staff/email-reports', { account: { ...account, password: 'yanlis-sifre' } });
  c.set('2026-10-08T03:00:00Z'); assert.equal(await c.reports.tick(), 0);
  let view = (await owner('/staff/email-reports')).data;
  assert.equal(view.status.lastError, 'E-posta kullanıcı adı veya uygulama şifresi kabul edilmedi.'); assert.equal(view.status.waiting, 1);
  assert.equal(view.recent[0].attempts, 1); assert.equal(view.recent[0].nextAt, '2026-10-08T03:01:00.000Z');
  assert.equal(JSON.stringify(view).includes('yanlis-sifre'), false);
  await owner('/staff/email-reports', { account });
  c.set('2026-10-08T03:01:00Z'); assert.equal(await c.reports.tick(), 1);
  view = (await owner('/staff/email-reports')).data; assert.equal(view.status.waiting, 0); assert.equal(view.status.lastSentTitle, 'Gün sonu raporu · 7 Ekim 2026 Çarşamba');

  // Monday 12 October 05:00 after a weekend with the computer off: the days 8–11 and the week of 5–11 October, each once.
  c.set('2026-10-12T05:00:00Z');
  const before = smtp.received.length;
  assert.equal(await c.reports.tick(), 5);
  const subjects = smtp.received.slice(before).map(m => decodeURIComponent(escape(Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(m.data)![1], 'base64').toString('binary'))));
  assert.equal(subjects.filter(s => s.startsWith('Haftalık rapor · 5 Ekim – 11 Ekim 2026')).length, 1);
  const week = decodeParts(smtp.received.slice(before).find(m => /Haftal/.test(decodeParts(m.data)[0].text.slice(0, 200)))!.data)[0].text;
  assert.match(week, /Toplam tahsilat: ₺420\b/); assert.match(week, /PERSONEL SAATLERİ/); assert.match(week, /KASA KAPANIŞI/);
  assert.equal(await c.reports.tick(), 0);
  // A switch turned on later never makes the periods that ended before it.
  await owner('/staff/email-reports', { reports: { day: true, week: true, month: true, year: true } });
  c.set('2026-10-12T06:00:00Z'); assert.equal(await c.reports.tick(), 0, 'September (ended before "Aylık" was on) is not sent');
});

test('printable report: an A4 page attached as PDF when the browser makes one, else as HTML; the SMTP message carries it; no browser, no PDF', async () => {
  const r: PeriodReport = { v: 1, kind: 'week', key: 'hafta:2026-09-28', title: 'Haftalık rapor · 28 Eylül – 4 Ekim 2026', from: '2026-09-28', to: '2026-10-04', business: 'Kafe Şükran', preparedAt: '2026-10-05T02:00:00.000Z',
    sales: { total: 854000, cash: 300000, card: 554000, platform: 0, orders: 142, accounts: 90, average: 9489 }, previous: { label: 'önceki haftaya', total: 762500 },
    tips: { total: 0, cash: 0, card: 0 }, refunds: { count: 0, total: 0 }, cancelled: { count: 0, amount: 0 }, expenses: { count: 0, total: 0 }, commission: 0, kept: 854000,
    top: [{ name: 'Latte', qty: 38, amount: 266000 }], closings: { count: 7, short: 1, over: 0, difference: -2000, list: [] }, staff: [] };
  assert.equal(plainSummary(r), 'Bu hafta (28 Eylül 2026 – 4 Ekim 2026) 142 sipariş, ₺8.540 satış yapıldı; önceki haftaya göre %12 fazla. 7 kasa kapanışının 1 tanesinde kasa eksik çıktı. En çok kazandıran: Latte (₺2.660). Giderler, iadeler ve komisyon düşülünce elde kalan ₺8.540.');
  const page = reportDocument(r);
  assert.match(page, /^<!doctype html>/); assert.match(page, /@page\{size:A4/); assert.match(page, /Kafe Şükran/); assert.match(page, /PERSONEL|Personel saatleri/); assert.doesNotMatch(page, /<script|https?:\/\//i, 'no scripts, nothing from outside');
  // PDF when the maker gives one; HTML when it gives nothing or fails.
  const pdf = await reportAttachment(r, async html => { assert.match(html, /Haftalık rapor/); return Buffer.from('%PDF-1.7 test'); });
  assert.deepEqual([pdf.kind, pdf.filename, pdf.contentType], ['pdf', 'Mola-Haftalik-rapor-2026-09-28.pdf', 'application/pdf']);
  for (const maker of [async () => undefined, async () => { throw new Error('tarayıcı çöktü'); }]) {
    const html = await reportAttachment(r, maker);
    assert.deepEqual([html.kind, html.filename, html.contentType], ['html', 'Mola-Haftalik-rapor-2026-09-28.html', 'text/html']); assert.equal(html.content.toString('utf8'), page);
  }
  // The message: multipart/mixed (text + HTML body, then the file), the file name plain ASCII.
  const message = composeMessage('kafe@example.com', { to: 'a@example.com', subject: 'x', text: 'metin', html: '<p>h</p>', attachments: [{ filename: 'Gün sonu "5 Ekim".pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.7 test') }] });
  assert.match(message, /Content-Type: multipart\/mixed; boundary="mola-/); assert.match(message, /Content-Disposition: attachment; filename="Gun-sonu-5-Ekim-.pdf"/);
  const parts = decodeParts(message.replace(/\r\n/g, '\n'));
  assert.deepEqual(parts.map(p => [p.type, p.name ?? '', p.text]), [['text/plain', '', 'metin'], ['text/html', '', '<p>h</p>'], ['application/pdf', 'Gun-sonu-5-Ekim-.pdf', '%PDF-1.7 test']]);
  // No browser (or MOLA_PDF_BROWSER=0): no PDF, and nothing is started.
  assert.equal(findPrintBrowser({ MOLA_PDF_BROWSER: '0' }, () => true), undefined);
  assert.equal(findPrintBrowser({}, () => false, 'win32'), undefined);
  assert.equal(findPrintBrowser({ 'ProgramFiles(x86)': 'C:\\PF86' }, p => p === 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe', 'win32'), 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(await htmlToPdf(page, { browser: join(temp('pdf-yok'), 'yok.exe'), timeoutMs: 5000 }), undefined);
});

test('printable report: the installed Edge/Chrome really prints the A4 page to a PDF', { skip: !findPrintBrowser() && 'no Edge or Chrome on this computer' }, async () => {
  const r = { v: 1, kind: 'day', key: 'gun:2026-10-05', title: 'Gün sonu raporu · 5 Ekim 2026 Pazartesi', from: '2026-10-05', to: '2026-10-05', business: 'Kafe', preparedAt: '2026-10-06T02:00:00.000Z',
    sales: { total: 28000, cash: 14000, card: 14000, platform: 0, orders: 2, accounts: 2, average: 14000 }, previous: null, tips: { total: 0, cash: 0, card: 0 }, refunds: { count: 0, total: 0 }, cancelled: { count: 0, amount: 0 },
    expenses: { count: 0, total: 0 }, commission: 0, kept: 28000, top: [], closings: { count: 0, short: 0, over: 0, difference: 0, list: [] } } satisfies PeriodReport;
  const file = await reportAttachment(r, html => htmlToPdf(html));
  assert.equal(file.kind, 'pdf'); assert.equal(file.content.subarray(0, 5).toString('latin1'), '%PDF-'); assert.ok(file.content.length > 1000);
});

test('report text: money in Turkish, no personal data fields at all, the HTML escapes names', () => {
  const r: PeriodReport = { v: 1, kind: 'month', key: 'ay:2026-09', title: 'Aylık rapor · Eylül 2026', from: '2026-09-01', to: '2026-09-30', business: 'Kafe <Mola> & Co', preparedAt: '2026-10-01T03:00:00.000Z',
    sales: { total: 12345650, cash: 5000000, card: 7000000, platform: 345650, orders: 812, accounts: 400, average: 30864 }, previous: { label: 'önceki aya', total: 10000000 },
    tips: { total: 0, cash: 0, card: 0 }, refunds: { count: 2, total: 5000 }, cancelled: { count: 3, amount: 4500 }, expenses: { count: 4, total: 1200000 }, commission: 12000, kept: 11128650,
    top: [{ name: 'Latte <b>', qty: 210, amount: 2940000 }, { name: 'Baklava', qty: 12, amount: 600000, kg: 12.5 }], closings: { count: 26, short: 3, over: 2, difference: -1500, list: [] }, staff: [{ name: 'Elif', minutes: 9630, estimated: true }] };
  const text = reportText(r), html = reportHtml(r);
  assert.match(text, /Toplam tahsilat: ₺123\.456,50/); assert.match(text, /Platform \(çevrimiçi ödenen\): ₺3\.456,50/);
  assert.match(text, /önceki aya göre %23 artış \(₺100\.000\)/); assert.match(text, /Toplam fark: Kasa eksik ₺15/); assert.match(text, /EN ÇOK KAZANDIRANLAR\n  1\. Latte <b>: ₺29\.400 · 210 adet\n  2\. Baklava: ₺6\.000 · 12,5 kg/); assert.match(text, /Elif: 160 sa 30 dk \(tahmini\)/);
  assert.match(html, /Kafe &lt;Mola&gt; &amp; Co/); assert.match(html, /Latte &lt;b&gt;/); assert.doesNotMatch(html, /<b>/);
  assert.deepEqual(Object.keys(r).filter(k => /guest|phone|customer|reservation|note/i.test(k)), [], 'the report shape has no place for guests');
});

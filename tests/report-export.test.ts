import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { DEFAULT_VAT, looksAlcoholic, productVat, receiptVat, shareOut, suggestVat, vatBreakdown, vatOf, vatSettings } from '../packages/domain/vat.js';
import { columnName, crc32, excelDay, xlsx } from '../server/report-export-xlsx.js';
import { simpleSentence } from '../server/report-export.js';
import { buildPeriodReport, periodOf, rangePeriod, reportSummary, sections, type PeriodReport } from '../server/email-reports-content.js';
import { licensed, temp } from './merkez-fixture.js';
import { seed } from '../server/seed.js';
import { submitOrder } from '../packages/domain/engine.js';
import { billTicket, renderText } from '../packages/domain/printing.js';
import type { Actor } from '../packages/domain/types.js';

// ---------- KDV ----------
test('KDV: ready with %10 and %20 (default %10); a broken list or a removed rate falls back to the default', () => {
  assert.deepEqual(vatSettings({}), { rates: [10, 20], default: 10 });
  assert.deepEqual(vatSettings({ vat: { rates: [20, 1, 20, 10, 150, 2.5 as number], default: 1 } }), { rates: [1, 10, 20], default: 1 });
  assert.deepEqual(vatSettings({ vat: { rates: [1, 20], default: 8 } }), { rates: [1, 20], default: 1 }, 'a default not on the list: the first rate');
  assert.deepEqual(vatSettings({ vat: { rates: [], default: 20 } }), DEFAULT_VAT);
  const v = vatSettings({});
  assert.equal(productVat(undefined, v), 10); assert.equal(productVat({}, v), 10, 'older products count at the default');
  assert.equal(productVat({ vatRate: 20 }, v), 20); assert.equal(productVat({ vatRate: 8 }, v), 10, 'a rate the owner removed counts at the default');
});

test('KDV: alcohol suggests the higher rate (the owner decides); other words do not', () => {
  const v = vatSettings({});
  for (const [name, category] of [['Efes Bira', 'İçecekler'], ['Kırmızı şarap', 'Şaraplar'], ['Yeni Rakı 35 cl', 'İçkiler'], ['Mojito', 'Kokteyller'], ['Jack Daniels', 'Viskiler'], ['Ev yapımı', 'Alkollü içecekler'], ['Gin tonik', 'Bar']])
    assert.equal(suggestVat(name, category, v), 20, `${name} / ${category}`);
  for (const [name, category] of [['Latte', 'Kahveler'], ['Cinnamon roll', 'Tatlılar'], ['Romlu kek', 'Tatlılar'], ['Limonata', 'Soğuk İçecekler'], ['Biraderler tostu', 'Yemekler'], ['Ginseng çayı', 'Çaylar']])
    assert.equal(looksAlcoholic(name, category), false, name);
  assert.equal(looksAlcoholic('Biralar', ''), true);
  assert.equal(suggestVat('Bira', '', { rates: [10], default: 10 }), null, 'no higher rate on the list: nothing to suggest');
});

test('KDV: matrah and KDV of a price that includes it, to the kuruş; parts always add up', () => {
  assert.deepEqual(vatOf(11000, 10), { gross: 11000, base: 10000, vat: 1000 });
  assert.deepEqual(vatOf(12000, 20), { gross: 12000, base: 10000, vat: 2000 });
  assert.deepEqual(vatOf(9950, 10), { gross: 9950, base: 9045, vat: 905 }, '9045,45 rounds to 9045');
  assert.deepEqual(vatOf(0, 20), { gross: 0, base: 0, vat: 0 });
  assert.deepEqual(shareOut(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(shareOut(7000, [5000, 3000]), [4375, 2625]);
  assert.deepEqual(shareOut(5, [0, 0]), [5, 0], 'no weights: all on the first');
  // Sales of the period: Latte (%10) ₺50 after a campaign discount, Bira (%20) ₺30; ₺10 refunded.
  const rates: Record<string, number> = { latte: 10, bira: 20 };
  const b = vatBreakdown({ products: [['latte', { amount: 5000 }], ['bira', { amount: 3000 }]], rateOf: id => rates[id], sales: 8000, refunds: 1000, settings: vatSettings({}) });
  assert.deepEqual(b.rows, [{ rate: 10, gross: 4375, base: 3977, vat: 398 }, { rate: 20, gross: 2625, base: 2188, vat: 437 }]);
  assert.equal(b.total.gross, 7000, 'satış − iadeler'); assert.equal(b.total.base + b.total.vat, b.total.gross);
  // Odd amounts: three rates, still exact.
  const odd = vatBreakdown({ products: [['a', { amount: 333 }], ['b', { amount: 333 }], ['c', { amount: 334 }]], rateOf: id => ({ a: 1, b: 10, c: 20 })[id]!, sales: 1001, refunds: 0, settings: vatSettings({ vat: { rates: [1, 10, 20], default: 10 } }) });
  assert.equal(odd.rows.reduce((n, r) => n + r.gross, 0), 1001);
  // Money but no product sold (only a kapora, say): all at the default rate. More refunds than sales: zero, never negative.
  assert.deepEqual(vatBreakdown({ products: [], rateOf: () => 20, sales: 1100, refunds: 0, settings: vatSettings({}) }).rows, [{ rate: 10, gross: 1100, base: 1000, vat: 100 }]);
  assert.equal(vatBreakdown({ products: [['a', { amount: 500 }]], rateOf: () => 10, sales: 500, refunds: 900, settings: vatSettings({}) }).total.gross, 0);
  // The bill receipt's line.
  assert.deepEqual(receiptVat([{ amount: 11000, rate: 10 }, { amount: 6000, rate: 20 }, { amount: 5500, rate: 10 }, { amount: 0, rate: 1 }]), [{ rate: 10, vat: 1500 }, { rate: 20, vat: 1000 }]);
});

test('hesap fişi: the bill ends with "KDV dahildir" per rate, short enough for 58 mm paper; no line when nothing was ordered', () => {
  const s = seed(), at = new Date('2026-10-02T09:00:00Z'), guest: Actor = { tenantId: 'mola-demo', id: 'guest1', role: 'guest', tableId: 'table-1', epoch: 0 };
  s.products.find(p => p.id === 'cheesecake')!.vatRate = 20;
  submitOrder(s, guest, { requestId: randomUUID(), tableId: 'table-1', lines: [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 2 * 19500 + 19000 }, { now: at, id: randomUUID });
  const lines = renderText(billTicket(s, s.accounts[0].id, at), { width: 58 });
  const i = lines.findIndex(l => l.trim() === 'KDV dahildir');
  assert.ok(i > 0, lines.join('\n')); assert.equal(lines[i + 1].trim(), '%10: 35,45 TL · %20: 31,67 TL');
  assert.ok(lines.every(l => l.length <= 32));
  // Each line keeps the rate it was sold with: a later change of the product's rate leaves this bill as it was.
  s.products.find(p => p.id === 'cheesecake')!.vatRate = 10;
  assert.equal(renderText(billTicket(s, s.accounts[0].id, at), { width: 58 }).find((_, n, all) => all[n - 1]?.trim() === 'KDV dahildir')?.trim(), '%10: 35,45 TL · %20: 31,67 TL');
  // One rate: a single line.
  submitOrder(s, { ...guest, tableId: 'table-2' }, { requestId: randomUUID(), tableId: 'table-2', lines: [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }, { productId: 'cheesecake', quantity: 1, selections: [] }], expectedTotal: 2 * 19500 + 19000 }, { now: at, id: randomUUID });
  assert.ok(renderText(billTicket(s, s.accounts[1].id, at), { width: 58 }).some(l => l.trim() === 'KDV dahildir · %10: 52,73 TL'));
});

// ---------- XLSX ----------
/** A tiny zip reader for the tests: entries by name, inflated. */
function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end > 0, 'end of central directory');
  const count = buf.readUInt16LE(end + 10); let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10), crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 20), real = buf.readUInt32LE(at + 24), nameLength = buf.readUInt16LE(at + 28), extra = buf.readUInt16LE(at + 30), comment = buf.readUInt16LE(at + 32), offset = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(buf.readUInt32LE(offset), 0x04034b50, `${name}: local header`);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = method === 8 ? inflateRawSync(buf.subarray(start, start + size)) : buf.subarray(start, start + size);
    assert.equal(data.length, real); assert.equal(crc32(data), crc, `${name}: CRC`);
    files.set(name, data.toString('utf8'));
    at += 46 + nameLength + extra + comment;
  }
  return files;
}
/** Sheet names and each sheet's cells as { A1: value } (numbers as numbers, inline strings as text). */
export function readXlsx(buf: Buffer) {
  const files = unzip(buf), names = [...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const sheets = names.map((name, i) => {
    const xml = files.get(`xl/worksheets/sheet${i + 1}.xml`)!, cells: Record<string, string | number> = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/g)) {
      const text = /<t[^>]*>(.*?)<\/t>/.exec(m[3])?.[1], value = /<v>(.*?)<\/v>/.exec(m[3])?.[1];
      cells[m[1]] = text !== undefined ? text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&') : Number(value);
    }
    return { name, cells, xml };
  });
  return { files, sheets };
}

test('XLSX: a real zip with the workbook parts; money as numbers with a ₺ format, dates as Excel dates, text escaped', () => {
  assert.equal(columnName(0), 'A'); assert.equal(columnName(25), 'Z'); assert.equal(columnName(26), 'AA'); assert.equal(columnName(701), 'ZZ');
  assert.equal(excelDay('2026-10-05'), 46300); assert.equal(excelDay('1900-03-01'), 61);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const file = xlsx([{ name: 'Günlük satışlar', widths: [12, 10], rows: [['Tarih', 'Tutar'], [{ date: '2026-10-05' }, { money: 854050 }], ['<Latte & "Su">', 3], [{ rate: 20 }, { money: -100, bold: true }]], note: 'İş günü 05:00–05:00' }, { name: 'Giderler/İade?', rows: [['A']] }, { name: 'Günlük satışlar', rows: [['x']] }], { title: 'Kafe · Ekim', now: new Date('2026-10-05T09:00:00Z') });
  assert.equal(file.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004');
  const { files, sheets } = readXlsx(file);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'docProps/core.xml']) assert.ok(files.has(part), part);
  assert.deepEqual(sheets.map(s => s.name), ['Günlük satışlar', 'Giderler İade', 'Günlük satışlar (2)'], 'forbidden characters out, names never repeat');
  const s = sheets[0].cells;
  assert.deepEqual([s.A1, s.B1, s.A2, s.B2, s.A3, s.B3, s.A4, s.B4, s.A6], ['Tarih', 'Tutar', 46300, 8540.5, '<Latte & "Su">', 3, 20, -1, 'İş günü 05:00–05:00']);
  assert.match(sheets[0].xml, /<c r="B2" s="2">/); assert.match(sheets[0].xml, /<c r="A2" s="3">/); assert.match(sheets[0].xml, /<pane ySplit="1"/);
  assert.match(files.get('xl/styles.xml')!, /formatCode="#,##0\.00\\ &quot;₺&quot;"/); assert.match(files.get('docProps/core.xml')!, /Kafe · Ekim/);
});

// ---------- The sentence ----------
const report = (o: Partial<PeriodReport>): PeriodReport => ({ v: 1, kind: 'range', key: 'x', title: '', from: '2026-10-05', to: '2026-10-05', business: 'Mola Coffee House', preparedAt: '2026-10-05T12:00:00Z',
  sales: { total: 854000, cash: 300000, card: 554000, platform: 0, orders: 142, accounts: 90, average: 9489 }, previous: { label: 'dünün aynı saatine', total: 762500, partial: true },
  tips: { total: 0, cash: 0, card: 0 }, refunds: { count: 0, total: 0 }, cancelled: { count: 0, amount: 0 }, expenses: { count: 0, total: 0 }, commission: 0, kept: 854000,
  top: [{ name: 'Latte', qty: 38, amount: 266000 }], closings: { count: 0, short: 0, over: 0, difference: 0, list: [] }, ...o });
test('sade özet: one plain sentence (sales, the comparison, the best seller, the kasa)', () => {
  assert.equal(simpleSentence(report({}), '2026-10-05', 'Kasada ₺2.310 nakit olmalı.'), 'Bugün 142 sipariş, ₺8.540 satış — dünün aynı saatine göre %12 fazla. En çok kazandıran: Latte (₺2.660). Kasada ₺2.310 nakit olmalı.');
  assert.equal(simpleSentence(report({ sales: { total: 0, cash: 0, card: 0, platform: 0, orders: 0, accounts: 0, average: 0 }, top: [] }), '2026-10-05'), 'Bugün henüz satış yok.');
  assert.equal(simpleSentence(report({ from: '2026-10-04', to: '2026-10-04', previous: { label: 'önceki güne', total: 900000 } }), '2026-10-05'), 'Dün 142 sipariş, ₺8.540 satış — önceki güne göre %5 az. En çok kazandıran: Latte (₺2.660).');
  assert.equal(simpleSentence(report({ from: '2026-09-29', to: '2026-10-05', previous: { label: 'önceki 7 günün aynı saatine', total: 100 } }), '2026-10-05'), 'Son 7 günde 142 sipariş, ₺8.540 satış. En çok kazandıran: Latte (₺2.660).', 'a near-empty previous period is not compared');
  assert.equal(simpleSentence(report({ from: '2026-09-01', to: '2026-09-30', previous: null, top: [{ name: 'Baklava', qty: 12, amount: 125050, kg: 12.5 }] }), '2026-10-05'), '1 Eylül 2026 – 30 Eylül 2026 arasında 142 sipariş, ₺8.540 satış. En çok kazandıran: Baklava (₺1.250,50).');
  assert.deepEqual([rangePeriod('2026-10-01', '2026-10-31').title, rangePeriod('2026-10-05', '2026-10-05').title, rangePeriod('2026-10-01', '2026-10-07').title, rangePeriod('2025-12-29', '2026-01-04').title, rangePeriod('all', 'all').title],
    ['Ekim 2026', '5 Ekim 2026 Pazartesi', '1 – 7 Ekim 2026', '29 Aralık 2025 – 4 Ocak 2026', 'Tüm zamanlar']);
});

// ---------- Through the café server ----------
async function cafe(t: { after: (fn: () => Promise<void> | void) => void }, start: string) {
  const directory = temp('report-export'), store = new Store(directory); licensed(store);
  let clock = new Date(start);
  const app = createApp(store, () => clock), server = createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() {
    let cookie = '';
    return async (path: string, body?: unknown): Promise<{ status: number; data: any; raw: Response; bytes: Buffer }> => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      const bytes = Buffer.from(await r.arrayBuffer()), type = r.headers.get('content-type') ?? '';
      return { status: r.status, raw: r, bytes, data: type.includes('json') ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8') };
    };
  }
  return { store, client, set: (iso: string) => { clock = new Date(iso); } };
}

test('Satış ve Raporlar: KDV oranları and the product rate, the sade özet, a printable page for every report, the accountant\'s Excel; owner and Müdür only', async t => {
  const c = await cafe(t, '2026-10-05T09:00:00Z');
  const owner = c.client(), cashier = c.client(), waiter = c.client();
  await owner('/login', { username: 'isletme', password: DEMO_PASSWORD }); await cashier('/login', { username: 'kasiyer', password: DEMO_PASSWORD }); await waiter('/login', { username: 'garson', password: DEMO_PASSWORD });

  // KDV oranları: ready with %10 / %20; the owner adds %1; a default off the list is refused; the cashier cannot change them.
  const ready = await owner('/staff/vat');
  assert.deepEqual([ready.data.rates, ready.data.default], [[10, 20], 10]); assert.equal(ready.data.counts['10'], ready.data.products, 'every existing product counts at the default');
  assert.equal((await owner('/staff/vat', { rates: [10, 20], default: 8 })).data.code, 'INVALID_VAT');
  assert.equal((await cashier('/staff/vat', { rates: [10], default: 10 })).status, 403);
  assert.deepEqual((await owner('/staff/vat', { rates: [20, 10, 1, 10], default: 10 })).data.rates, [1, 10, 20]);

  // One category at %20 ("Bu bölümdeki ürünlere uygula"), tea stays at %10.
  const state = (await owner('/staff/state')).data, tea = state.products.find((p: any) => p.id === 'tea');
  const other = state.products.find((p: any) => p.category !== tea.category && !p.groups.length && p.unit !== 'kg' && p.published !== false);
  const applied = await owner('/staff/vat/apply', { requestId: randomUUID(), category: other.category, rate: 20 });
  assert.equal(applied.status, 200, JSON.stringify(applied.data)); assert.ok(applied.data.changed >= 1);
  assert.equal((await owner('/staff/vat/apply', { requestId: randomUUID(), category: other.category, rate: 18 })).data.code, 'INVALID_VAT', 'only a rate on the list');
  assert.equal((await owner('/staff/state')).data.products.find((p: any) => p.id === other.id).vatRate, 20);
  // The product editor saves a rate too.
  const saved = await owner('/staff/products', { id: tea.id, product: { ...Object.fromEntries(Object.entries(tea).filter(([k]) => !['id', 'firstPublishedAt', 'discounts'].includes(k))), vatRate: 10 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));

  // Two bills: tea ×4 (cash), the other product ×2 (card).
  const sell = async (productId: string, quantity: number, price: number, method: 'cash' | 'card', table: number) => {
    const placed = await waiter('/staff/orders', { requestId: randomUUID(), tableId: state.tables[table].id, lines: [{ productId, quantity, selections: [] }], expectedTotal: price * quantity });
    assert.equal(placed.status, 200, JSON.stringify(placed.data));
    const acc = (await cashier('/staff/state')).data.tables.find((x: any) => x.account?.id === placed.data.accountId).account;
    const paid = await cashier('/staff/payments', { requestId: randomUUID(), accountId: acc.id, version: acc.version, method, amount: price * quantity, tendered: price * quantity });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
  };
  await sell('tea', 4, tea.price, 'cash', 0); await sell(other.id, 2, other.price, 'card', 1);
  const total = tea.price * 4 + other.price * 2;
  const day = 'from=2026-10-05&to=2026-10-05';

  // Only the owner and the Müdür.
  for (const path of [`/staff/reports/simple?${day}`, `/staff/reports/document?${day}`, `/staff/reports/accountant.xlsx?${day}`]) assert.equal((await cashier(path)).status, 403, path);

  // Sade özet: the sentence and the KDV dökümü (adds up to the sales, split by rate).
  const simple = await owner(`/staff/reports/simple?${day}`);
  assert.equal(simple.status, 200, JSON.stringify(simple.data));
  assert.match(simple.data.sentence, /^Bugün 2 sipariş, ₺[\d.,]+ satış\. En çok kazandıran: .+\(₺[\d.,]+\)\. Kasa/);
  assert.deepEqual(simple.data.vat.rows.map((r: any) => [r.rate, r.gross]), [[10, tea.price * 4], [20, other.price * 2]]);
  assert.equal(simple.data.vat.total.gross, total); assert.equal(simple.data.vat.total.base + simple.data.vat.total.vat, total);
  assert.match(simple.data.vatNote, /Bilgi amaçlıdır/);

  // "Yazdır / PDF": every report prints as one clean A4 page: "Kafe · 5 Ekim 2026 Pazartesi · Satış özeti", the sentence, its tables.
  const names: Record<string, string> = { summary: 'Satış özeti', products: 'Ürün satışları', profit: 'Kârlılık', campaigns: 'Kampanyalar', cash: 'Kasa kapanışları', expenses: 'Giderler', corrections: 'İadeler', employees: 'Çalışanlar', staff: 'Personel ve bahşiş', reservations: 'Rezervasyon' };
  for (const [view, name] of Object.entries(names)) {
    const page = await owner(`/staff/reports/document?view=${view}&${day}`);
    assert.equal(page.status, 200, `${view}: ${page.data}`); assert.match(page.raw.headers.get('content-type')!, /text\/html/);
    assert.match(page.data, new RegExp(`<h1>[^<]*· 5 Ekim 2026 Pazartesi · ${name}</h1>`), view);
    assert.match(page.data, /@page\{size:A4/); assert.match(page.data, /counter\(page\)/, 'page numbers'); assert.doesNotMatch(page.data, /<script|https?:\/\//i, `${view}: no scripts, nothing from outside`);
    assert.match(page.data, /class="lead">Bugün şu ana kadar 2 sipariş/, `${view}: the plain sentence first`);
  }
  const summary = (await owner(`/staff/reports/document?view=summary&${day}`)).data;
  assert.match(summary, /<h2>KDV dökümü<\/h2>/); assert.match(summary, /<td>%20<\/td>/); assert.match(summary, /Bilgi amaçlıdır; resmi beyan yazar kasa/);
  assert.match((await owner(`/staff/reports/document?view=products&${day}`)).data, /Demleme Çay[\s\S]*%10/);
  // No browser for PDFs (MOLA_PDF_BROWSER=0): 409 with the plain hint, never a broken file.
  const before = process.env.MOLA_PDF_BROWSER; process.env.MOLA_PDF_BROWSER = '0';
  try { const pdf = await owner(`/staff/reports/document.pdf?${day}`); assert.equal(pdf.status, 409); assert.equal(pdf.data.code, 'PDF_UNAVAILABLE'); assert.match(pdf.data.message, /PDF olarak kaydet/); }
  finally { if (before === undefined) delete process.env.MOLA_PDF_BROWSER; else process.env.MOLA_PDF_BROWSER = before; }

  // "Muhasebeci için indir": the month as one .xlsx with seven sheets.
  const file = await owner('/staff/reports/accountant.xlsx?from=2026-10-01&to=2026-10-05');
  assert.equal(file.status, 200); assert.match(file.raw.headers.get('content-type')!, /spreadsheetml\.sheet/);
  assert.match(file.raw.headers.get('content-disposition')!, /filename="Mola-Muhasebe-2026-10-01_2026-10-05\.xlsx"/);
  const book = readXlsx(file.bytes);
  assert.deepEqual(book.sheets.map(s => s.name), ['Günlük satışlar', 'Ödemeler özeti', 'Giderler', 'İadeler', 'Kasa kapanışları', 'KDV dökümü', 'Ürün satışları']);
  const daily = book.sheets[0].cells;
  assert.deepEqual([daily.A1, daily.B1, daily.C1, daily.D1, daily.E1, daily.F1, daily.G1, daily.H1], ['Tarih', 'Sipariş', 'Satış', 'Nakit', 'Kart', 'Platform', 'İade', 'İndirim']);
  assert.equal(daily.A2, excelDay('2026-10-01')); assert.equal(daily.A6, excelDay('2026-10-05')); assert.deepEqual([daily.B6, daily.C6, daily.D6, daily.E6], [2, total / 100, tea.price * 4 / 100, other.price * 2 / 100]);
  assert.equal(daily.A7, 'Toplam'); assert.equal(daily.C7, total / 100);
  const vat = book.sheets[5].cells;
  assert.deepEqual([vat.A1, vat.B1, vat.C1, vat.D1, vat.A2, vat.B2, vat.A3, vat.B3, vat.A4], ['Oran', 'Satış (KDV dahil)', 'Matrah', 'KDV', 10, tea.price * 4 / 100, 20, other.price * 2 / 100, 'Toplam']);
  assert.ok(Object.values(book.sheets[1].cells).includes('POS komisyonu (bankanın kart satışlarından aldığı pay)'));
  assert.ok(Object.values(book.sheets[6].cells).includes('Demleme Çay'));
  assert.equal((await owner('/staff/reports/accountant.xlsx?from=2025-01-01&to=2026-12-31')).status, 400, 'at most 366 days, like every report');
});

test('K-O, K-P: the bills open now only in a period holding today; this year so far is compared with the same dates of last year', async t => {
  const c = await cafe(t, '2025-06-02T09:00:00Z');
  const owner = c.client(), waiter = c.client(), cashier = c.client();
  const login = async () => { for (const [who, name] of [[owner, 'isletme'], [waiter, 'garson'], [cashier, 'kasiyer']] as const) assert.equal((await who('/login', { username: name, password: DEMO_PASSWORD })).status, 200); };
  await login();
  const state = (await owner('/staff/state')).data, tea = state.products.find((p: any) => p.id === 'tea');
  const order = async (table: number) => assert.equal((await waiter('/staff/orders', { requestId: randomUUID(), tableId: state.tables[table].id, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: tea.price * 2 })).status, 200);
  const pay = async (table: number) => { const acc = (await cashier('/staff/state')).data.tables[table].account; assert.equal((await cashier('/staff/payments', { requestId: randomUUID(), accountId: acc.id, version: acc.version, method: 'cash', amount: acc.balance, tendered: acc.balance })).status, 200); };
  // A sale in June 2025, one today (5 October 2026) and an open, unpaid bill right now.
  await order(1); await pay(1);
  c.set('2026-10-05T09:00:00Z'); await login();
  await order(2); await pay(2); await order(0);
  const overview = async (q: string) => { const r = await owner(`/staff/reports/overview?${q}`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  assert.equal((await overview('from=2026-10-05&to=2026-10-05')).openAccounts, tea.price * 2, 'today');
  assert.equal((await overview('from=2026-01-01&to=2026-10-05')).openAccounts, tea.price * 2, 'this year so far holds today');
  assert.equal((await overview('from=2023-01-01&to=2023-12-31')).openAccounts, null, 'a past year: no "Açık hesaplar" line');
  assert.equal((await overview('from=2026-10-04&to=2026-10-04')).openAccounts, null, 'yesterday');
  // The day report (e-mail, printout): today's report lists them, the report of a past day never does.
  const src = { store: c.store };
  const today = buildPeriodReport(src, 'mola-demo', periodOf('day', '2026-10-05'), new Date('2026-10-05T09:00:00Z'));
  assert.equal(today.openBills, tea.price * 2); assert.ok(sections(today)[0].rows.some(([k]) => k === 'Açık hesaplar (henüz ödenmedi)'));
  const past = buildPeriodReport(src, 'mola-demo', periodOf('day', '2026-10-04'), new Date('2026-10-05T09:00:00Z'));
  assert.equal(past.openBills, undefined); assert.ok(!sections(past)[0].rows.some(([k]) => k.startsWith('Açık hesaplar')));
  // 10 Ekim: the report of the day that just ended (made after 05:00) says what was open at its close, "Yok" when nothing.
  assert.equal(past.openAtClose, 0); assert.ok(sections(past)[0].rows.some(([k, v]) => k === 'Gün kapanırken açık kalan hesaplar' && v === 'Yok'));
  const closed = buildPeriodReport(src, 'mola-demo', periodOf('day', '2026-10-05'), new Date('2026-10-06T03:30:00Z'));
  assert.equal(closed.openBills, undefined); assert.equal(closed.openAtClose, tea.price * 2);
  assert.ok(sections(closed)[0].rows.some(([k]) => k === 'Gün kapanırken açık kalan hesaplar'));
  assert.match(reportSummary(closed), /gün kapanırken açık kalan hesaplar/);
  // An older day (a catch-up after days off) leaves the line out: the floor's records no longer tell.
  assert.equal(buildPeriodReport(src, 'mola-demo', periodOf('day', '2026-10-03'), new Date('2026-10-05T09:00:00Z')).openAtClose, undefined);
  // "Yıl" (2026 so far): compared with 1 January – 5 October 2025 up to the same clock time, in plain words.
  const year = await overview('from=2026-01-01&to=2026-10-05');
  assert.deepEqual([year.previous.from, year.previous.to, year.previous.partial, year.previous.year, year.previous.sales], ['2025-01-01', '2025-10-05', true, true, tea.price * 2]);
  const page = (await owner('/staff/reports/document?view=summary&from=2026-01-01&to=2026-10-05')).data;
  assert.match(page, /geçen yılın aynı dönemine göre/); assert.doesNotMatch(page, /önceki \d+ günün/);
  // A whole past year: the whole year before.
  const whole = await overview('from=2025-01-01&to=2025-12-31');
  assert.deepEqual([whole.previous.from, whole.previous.to, whole.previous.partial, whole.previous.year], ['2024-01-01', '2024-12-31', undefined, true]);
  assert.match((await owner('/staff/reports/document?view=summary&from=2025-01-01&to=2025-12-31')).data, /önceki yıla göre/);
});
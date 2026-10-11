// Stok → İşlem geçmişi hız ölçümü (K-T, 9 Ekim kullanıcı testi: 5 yıllık kafede her süzgeç 2,5–3 sn).
// Geçici bir klasörde (.local/tests/stok-gecmisi-hiz-*) yapay bir kafe kurar: 5 yılda ~30 000 stok kaydı (40 malzeme, 5 kişi,
// alış/sayım/fire/iade/fiyat, geri alınanlar, reçete sürümleri, malzeme kayıtları), sonra GET /api/staff/stock/history'yi
// Bugün / 7 gün / 30 gün / Tümü / bir malzeme / bir kişi / arama için ölçer. Gerçek kurulumlara ve verilere dokunmaz;
// klasör sonunda silinir. Çalıştırma: npx.cmd tsx scripts/stok-gecmisi-hiz.ts [kayıt sayısı, varsayılan 30000]
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { client, licensed, temp } from '../tests/merkez-fixture.js';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { StockBook } from '../server/stock.js';
import type { Recipe, StockEntry, StockItem, StockLog } from '../packages/domain/stock.js';
import { historyIndex } from '../packages/domain/stock-history.js';

const TOTAL = Number(process.argv[2] ?? 30_000);
const NOW = Date.parse('2026-10-09T09:00:00Z'), DAY = 86_400_000, START = NOW - 5 * 365 * DAY;
const iso = (ms: number) => new Date(ms).toISOString();

/** A small deterministic random (the same café every run). */
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];

export async function main() {
  const dir = temp('stok-gecmisi-hiz'), store = new Store(dir); licensed(store);
  const tenant = 'mola-demo';
  store.mutate(tenant, s => { s.setupCompleted = true; });
  const s = store.read(tenant);
  const staff = (s.staffUsers ?? []).filter(u => u.role === 'kitchen' || u.role === 'manager' || u.role === 'cashier').slice(0, 4);
  const people = [{ id: 'owner', name: 'İşletme sahibi', role: 'owner' }, ...staff.map(u => ({ id: u.id, name: u.name, role: u.role }))];
  const products = s.products.slice(0, 30);

  // 40 items over 5 years (a few removed), recipes changing a few times a year, logs for later items.
  const units: StockItem['unit'][] = ['g', 'ml', 'piece'];
  const items: StockItem[] = Array.from({ length: 40 }, (_, i) => ({ id: `it-${i}`, name: `Malzeme ${i + 1}`, unit: units[i % 3], min: 100, createdAt: iso(START + i * DAY), ...(i % 13 === 12 ? { removedAt: iso(NOW - (i * 20) * DAY) } : {}) }));
  const recipes: Recipe[] = [];
  for (const p of products) for (let v = 0; v < 8; v++) recipes.push({ id: randomUUID(), productId: p.id, validFrom: iso(START + DAY + v * 220 * DAY + Math.floor(rnd() * DAY)), items: [{ itemId: pick(items).id, amount: 10 + Math.floor(rnd() * 40) }], by: 'owner', byName: 'İşletme sahibi', role: 'owner' });
  const logs: StockLog[] = items.slice(20).map(i => ({ id: randomUUID(), at: i.createdAt, by: 'owner', byName: 'İşletme sahibi', role: 'owner', action: 'item_add', itemId: i.id, name: i.name, after: 'Gram' }));
  for (let k = 0; k < 120; k++) { const i = pick(items); logs.push({ id: randomUUID(), at: iso(START + Math.floor(rnd() * (NOW - START))), by: 'owner', byName: 'İşletme sahibi', role: 'owner', action: 'min', itemId: i.id, name: i.name, before: '100 g', after: '200 g' }); }

  // ~TOTAL entries spread over five years; every ~50th taken back the same day; old ones (first 3 years) without role.
  const entries: StockEntry[] = [];
  const kinds: StockEntry['kind'][] = ['purchase', 'purchase', 'purchase', 'count', 'count', 'count', 'waste', 'waste', 'waste', 'price', 'return'];
  for (let n = 0; n < TOTAL; n++) {
    const at = START + Math.floor((n + rnd()) * (NOW - START - 60_000) / TOTAL), who = pick(people), item = pick(items), kind = pick(kinds);
    const old = at < START + 3 * 365 * DAY, base: StockEntry = { id: randomUUID(), kind, at: iso(at), by: who.id, ...(old ? {} : { byName: who.name, role: who.role }) };
    let e: StockEntry;
    if (kind === 'purchase') { const quantity = 1000 * (1 + Math.floor(rnd() * 10)), total = quantity * (2 + Math.floor(rnd() * 30)); e = { ...base, itemId: item.id, quantity, total, unitCost: total / quantity, ...(rnd() < 0.5 ? { supplier: pick(['Mandıra Ali', 'Kavurucu', 'Toptancı', 'Pazar']) } : {}), ...(rnd() < 0.3 ? { expenseId: randomUUID() } : {}) }; }
    else if (kind === 'count') e = { ...base, itemId: item.id, quantity: Math.floor(rnd() * 5000), expected: Math.floor(rnd() * 5000), ...(n < 40 ? { start: true } : {}) };
    else if (kind === 'waste') e = { ...base, itemId: item.id, quantity: 10 + Math.floor(rnd() * 500), reason: pick(['Bozuldu', 'Döküldü / kırıldı', 'Son kullanma tarihi geçti']) };
    else if (kind === 'price') e = { ...base, itemId: item.id, unitCost: 1 + Math.floor(rnd() * 50) };
    else { const p = pick(products); e = { ...base, productId: p.id, productQuantity: 1, items: [[item.id, 20]] }; }
    if (n % 50 === 7) Object.assign(e, { deletedAt: iso(at + 30_000), deletedBy: who.name, deletedById: who.id, deletedRole: who.role, deletedChange: `${item.name} 1 kg → 0 g` });
    entries.push(e);
  }
  const book = new StockBook(store), t0 = performance.now();
  store.db.exec('BEGIN');
  for (const i of items) book.put(tenant, 'item', i, i.createdAt);
  for (const r of recipes) book.put(tenant, 'recipe', r, r.validFrom);
  for (const l of logs) book.put(tenant, 'log', l, l.at);
  for (const e of entries) book.put(tenant, 'entry', e, e.at);
  store.db.exec('COMMIT');
  console.log(`Yapay kafe: ${entries.length} stok kaydı, ${recipes.length} reçete sürümü, ${logs.length} malzeme kaydı, ${items.length} malzeme, ${people.length} kişi (${Math.round(performance.now() - t0)} ms yazıldı)`);
  // The parts of a first open: the sealed rows read from disk, then the history sorted once.
  const t1 = performance.now(), data = new StockBook(store).data(tenant), t2 = performance.now();
  historyIndex(data); console.log(`Parçalar: kayıtları diskten açmak ${Math.round(t2 - t1)} ms, geçmişi bir kez sıralamak ${Math.round(performance.now() - t2)} ms`);

  const clock = new Date(NOW);
  const server = createServer(createApp(store, () => clock));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const owner = client(base);
  if ((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status !== 200) throw new Error('giriş olmadı');
  const time = async (query: string) => { const t = performance.now(), r = await owner(`/staff/stock/history?${query}`); if (r.status !== 200) throw new Error(`${query}: ${r.status} ${JSON.stringify(r.data)}`); return { ms: performance.now() - t, total: r.data.total as number }; };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const kitchen = staff.find(u => u.role === 'kitchen');
  const cases: [string, string][] = [
    ['Bugün', 'range=today'], ['7 gün', 'range=7'], ['30 gün', 'range=30'], ['Tümü', 'range=all'], ['Tümü · sayfa 40', 'range=all&page=40'],
    ['Tümü · bir malzeme', `range=all&itemId=${items[3].id}`], ['30 gün · bir malzeme', `range=30&itemId=${items[3].id}`],
    ['Tümü · bir kişi', `range=all&by=${encodeURIComponent(kitchen?.id ?? 'owner')}`], ['Tümü · arama "kavurucu"', 'range=all&q=kavurucu'], ['7 gün · arama "fire"', 'range=7&q=fire'],
  ];
  // The first request opens five years of sealed rows (the stock screen does the same when Stok opens).
  const first = await time('range=7');
  console.log(`İlk açılış (7 gün, kayıtlar diskten ilk kez okunuyor): ${Math.round(first.ms)} ms`);
  const rows: string[] = [];
  for (const [name, query] of cases) {
    const runs: number[] = []; let total = 0;
    for (let k = 0; k < 5; k++) { const r = await time(query); runs.push(r.ms); total = r.total; }
    rows.push(`| ${name} | ${Math.round(runs[0])} | ${Math.round(median(runs))} | ${total} |`);
  }
  // After a write (a count) the stock records are read again once.
  await owner('/staff/stock/count', { requestId: randomUUID(), counts: [{ itemId: items[0].id, quantity: 1000 }] });
  const afterWrite = await time('range=7');
  console.log('\n| Süzgeç | ilk ms | ms (5 ölçümün ortancası) | kayıt |\n|---|---|---|---|\n' + rows.join('\n'));
  console.log(`\nBir sayım yazıldıktan sonra ilk 7 gün: ${Math.round(afterWrite.ms)} ms`);
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close();
  rmSync(dir, { recursive: true, force: true });
}
await main();

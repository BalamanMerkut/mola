import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { StockBook } from '../server/stock.js';
import { formatAmount, perBigUnit, bigUnit, type Recipe, type StockData, type StockEntry, type StockItem, type StockLog, type StockUnit } from '../packages/domain/stock.js';
import { filterStockHistory, historyIndex, KITCHEN_HISTORY, STOCK_EVENT_NAMES, stockHistory, StockHistoryIndex, type StockEvent, type StockEventKind } from '../packages/domain/stock-history.js';
import { temp } from './merkez-fixture.js';

/*
 * K-T (9 Ekim): Stok → İşlem geçmişi page by page. The reference below is the whole-list version as it was before
 * (packages/domain/stock-history.ts of 8 Ekim, word for word): every filter and page of the index must give the same lines.
 */
type Context = { products: readonly { id: string; name: string }[]; staff: readonly { id: string; name: string; role: string }[] };
function referenceHistory(data: StockData, ctx: Context): StockEvent[] {
  const tl = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: Math.round(kurus) % 100 === 0 ? 0 : 2 }).format(Math.round(kurus) / 100);
  const perUnit = (unitCost: number, unit: StockUnit) => `${tl(perBigUnit(unitCost, unit))} / ${bigUnit(unit).label}`;
  const items = new Map(data.items.map(i => [i.id, i])), products = new Map(ctx.products.map(p => [p.id, p.name])), staff = new Map(ctx.staff.map(u => [u.id, u]));
  const roleOf = (id: string | undefined) => !id ? '' : id === 'mola' ? 'system' : staff.get(id)?.role ?? 'owner';
  const nameOf = (id: string | undefined) => !id ? '—' : staff.get(id)?.name ?? 'İşletme sahibi';
  const itemName = (id: string) => { const i = items.get(id); return !i ? 'Silinmiş malzeme' : i.kind === 'product' ? products.get(i.productId ?? '') ?? i.name : i.name; };
  const amount = (id: string | undefined, n: number | undefined) => { const i = id ? items.get(id) : undefined; return n === undefined ? '' : i ? formatAmount(n, i.unit) : n.toLocaleString('tr-TR'); };
  const out: StockEvent[] = [];
  const lastPrice = new Map<string, number>();
  const entries = [...data.entries].sort((a, b) => a.at.localeCompare(b.at) || (a.id < b.id ? -1 : 1));
  for (const e of entries) {
    const who = { by: e.by, byName: e.byName ?? nameOf(e.by), role: e.role ?? roleOf(e.by) };
    const id = e.itemId ?? '', unit = items.get(id)?.unit;
    let ev: StockEvent;
    if (e.kind === 'purchase') ev = { id: e.id, at: e.at, kind: 'purchase', ...who, subject: itemName(id), itemIds: [id], amount: `+${amount(id, e.quantity)}`, note: [e.total ? tl(e.total) : 'Ücretsiz', e.supplier, e.expenseId ? 'Gider olarak kaydedildi' : ''].filter(Boolean).join(' · '), money: true };
    else if (e.kind === 'count' && e.start) ev = { id: e.id, at: e.at, kind: 'start', ...who, subject: itemName(id), itemIds: [id], amount: amount(id, e.quantity), note: e.by === 'mola' ? 'Yıl açılışı' : 'Malzeme eklenirken yazılan miktar' };
    else if (e.kind === 'count') { const diff = (e.quantity ?? 0) - (e.expected ?? 0); ev = { id: e.id, at: e.at, kind: 'count', ...who, subject: itemName(id), itemIds: [id], amount: amount(id, e.quantity), before: amount(id, e.expected ?? 0), after: amount(id, e.quantity), note: Math.abs(diff) < 0.5 ? 'Fark yok' : `Fark ${diff > 0 ? '+' : ''}${amount(id, diff)}` }; }
    else if (e.kind === 'waste') ev = { id: e.id, at: e.at, kind: 'waste', ...who, subject: itemName(id), itemIds: [id], amount: `−${amount(id, e.quantity)}`, note: e.reason };
    else if (e.kind === 'return') ev = { id: e.id, at: e.at, kind: 'return', ...who, subject: products.get(e.productId ?? '') ?? 'Silinmiş ürün', itemIds: (e.items ?? []).map(([x]) => x), amount: `+${(e.productQuantity ?? 0).toLocaleString('tr-TR')} adet`, note: (e.items ?? []).map(([x, n]) => `${itemName(x)} +${amount(x, n)}`).join(', ') };
    else {
      const before = lastPrice.get(id);
      ev = { id: e.id, at: e.at, kind: e.start ? 'start' : 'price', ...who, subject: itemName(id), itemIds: [id], ...(unit && e.unitCost !== undefined ? { after: perUnit(e.unitCost, unit), ...(before !== undefined ? { before: perUnit(before, unit) } : {}) } : {}), note: e.start ? 'Malzeme eklenirken yazılan fiyat' : 'Fiyat elle yazıldı', money: true };
    }
    if (!e.deletedAt && (e.kind === 'purchase' || e.kind === 'price') && typeof e.unitCost === 'number') lastPrice.set(id, e.unitCost);
    out.push(ev);
    if (e.deletedAt) out.push({ id: `${e.id}:undo`, at: e.deletedAt, kind: 'undo', by: e.deletedById ?? '', byName: e.deletedBy ?? '—', role: e.deletedRole ?? (e.deletedById ? roleOf(e.deletedById) : ''), subject: ev.subject, itemIds: ev.itemIds,
      amount: `${STOCK_EVENT_NAMES[ev.kind]} ${ev.amount ?? ev.after ?? ''}`.trim(), note: e.deletedChange ? `Stok: ${e.deletedChange}` : 'Kayıt geri alındı', money: ev.money });
  }
  const byProduct = new Map<string, Recipe[]>();
  for (const r of [...data.recipes].sort((a, b) => a.validFrom.localeCompare(b.validFrom))) { const list = byProduct.get(r.productId); if (list) list.push(r); else byProduct.set(r.productId, [r]); }
  const summary = (r: Recipe) => r.ready ? 'Hazır ürün (adet)' : !r.items.length ? 'Takip yok' : `${r.items.map(i => `${itemName(i.itemId)} ${amount(i.itemId, i.amount)}`).join(', ')}${r.options?.length ? ` · ${r.options.length} seçenek kuralı` : ''}`;
  const used = (r: Recipe) => [...r.items.map(i => i.itemId), ...(r.options ?? []).flatMap(o => [...(o.add ?? []).map(x => x.itemId), ...(o.replace ?? []).flatMap(x => [x.from, x.to])])];
  for (const [productId, versions] of byProduct) versions.forEach((r, i) => {
    const prev = versions[i - 1];
    out.push({ id: `recipe:${r.id}`, at: r.validFrom, kind: 'recipe', by: r.by ?? '', byName: r.byName ?? nameOf(r.by), role: r.role ?? roleOf(r.by), subject: products.get(productId) ?? 'Silinmiş ürün',
      itemIds: [...new Set([...used(r), ...(prev ? used(prev) : [])])], before: prev ? summary(prev) : 'Reçete yok', after: summary(r) });
  });
  const logs = data.logs ?? [];
  for (const l of logs) out.push({ id: `log:${l.id}`, at: l.at, kind: l.action, by: l.by, byName: l.byName, role: l.role, subject: l.name, itemIds: [l.itemId], ...(l.before !== undefined ? { before: l.before } : {}), ...(l.after !== undefined ? { after: l.after } : {}) });
  for (const i of data.items) {
    if (i.kind === 'product') continue;
    if (!logs.some(l => l.itemId === i.id && l.action === 'item_add')) out.push({ id: `add:${i.id}`, at: i.createdAt, kind: 'item_add', by: '', byName: '—', role: '', subject: i.name, itemIds: [i.id] });
    if (i.removedAt && !logs.some(l => l.itemId === i.id && l.action === 'item_remove')) out.push({ id: `remove:${i.id}`, at: i.removedAt, kind: 'item_remove', by: '', byName: '—', role: '', subject: i.name, itemIds: [i.id] });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
/** The endpoint's people list as it was built from the whole list. */
const referencePeople = (events: StockEvent[]) => [...new Map(events.filter(e => e.by || e.byName !== '—').map(e => [e.by || e.byName, { id: e.by || e.byName, name: e.byName, role: e.role }])).values()];

const DAY = 86_400_000, NOW = Date.parse('2026-10-09T09:00:00Z'), START = NOW - 3 * 365 * DAY;
const iso = (ms: number) => new Date(ms).toISOString();
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pickOne = <T,>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
const ctx: Context = { products: [{ id: 'latte', name: 'Latte' }, { id: 'su', name: 'Su' }, { id: 'cay', name: 'Çay' }], staff: [{ id: 'cook', name: 'Ayşe', role: 'kitchen' }, { id: 'mgr', name: 'Mert', role: 'manager' }, { id: 'kasa', name: 'Kerem', role: 'cashier' }] };

/** Every kind of record, old ones without names and roles, ties on the same millisecond, items without logs. */
function fixture(n: number): StockData {
  const units: StockUnit[] = ['g', 'ml', 'piece'];
  const items: StockItem[] = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, name: `Malzeme ${i}`, unit: units[i % 3], createdAt: iso(START + i * DAY), ...(i === 5 ? { removedAt: iso(START + 400 * DAY) } : {}) }));
  items.push({ id: 'water', name: 'Su (eski ad)', unit: 'piece', kind: 'product', productId: 'su', createdAt: iso(START) });
  const recipes: Recipe[] = [
    { id: 'r1', productId: 'latte', validFrom: iso(START + 2 * DAY), items: [{ itemId: 'i0', amount: 18 }, { itemId: 'i1', amount: 200 }] },
    { id: 'r2', productId: 'latte', validFrom: iso(START + 300 * DAY), items: [{ itemId: 'i0', amount: 20 }, { itemId: 'i1', amount: 200 }], options: [{ groupId: 'milk', optionId: 'oat', replace: [{ from: 'i1', to: 'i4' }] }], by: 'mgr', byName: 'Mert', role: 'manager' },
    { id: 'r3', productId: 'su', validFrom: iso(START + 3 * DAY), items: [{ itemId: 'water', amount: 1 }], ready: true, by: 'owner' },
    { id: 'r4', productId: 'gone', validFrom: iso(START + 500 * DAY), items: [] },
  ];
  const logs: StockLog[] = [
    { id: 'l1', at: iso(START + 7 * DAY), by: 'owner', byName: 'İşletme sahibi', role: 'owner', action: 'item_add', itemId: 'i7', name: 'Malzeme 7', after: 'Gram' },
    { id: 'l2', at: iso(START + 9 * DAY), by: 'mgr', byName: 'Mert', role: 'manager', action: 'min', itemId: 'i2', name: 'Malzeme 2', before: 'Yok', after: '200 adet' },
    { id: 'l3', at: iso(START + 401 * DAY), by: 'owner', byName: 'İşletme sahibi', role: 'owner', action: 'item_edit', itemId: 'i3', name: 'Malzeme 3', before: 'Eski', after: 'Malzeme 3' },
  ];
  const people = ['owner', 'cook', 'mgr', 'gone-person', '', 'mola'];
  const kinds: StockEntry['kind'][] = ['purchase', 'purchase', 'count', 'count', 'waste', 'price', 'return'];
  const entries: StockEntry[] = [];
  for (let k = 0; k < n; k++) {
    // Every 9th record shares the previous one's millisecond (ties are ordered by id).
    const at = k % 9 === 8 && entries.length ? Date.parse(entries.at(-1)!.at) : START + Math.floor((k + rnd()) * (NOW - START - DAY) / n);
    const by = pickOne(people), item = pickOne(items).id, kind = pickOne(kinds), named = rnd() < 0.5;
    const base: StockEntry = { id: `e${Math.floor(rnd() * 1e9).toString(36)}${k}`, kind, at: iso(at), by, ...(named ? { byName: by === 'cook' ? 'Ayşe' : 'Biri', role: by === 'cook' ? 'kitchen' : 'owner' } : {}) };
    let e: StockEntry;
    if (kind === 'purchase') e = { ...base, itemId: item, quantity: 250 * (1 + Math.floor(rnd() * 40)), total: rnd() < 0.1 ? 0 : 100 * Math.floor(rnd() * 5000) + (rnd() < 0.3 ? 50 : 0), ...(rnd() < 0.5 ? { unitCost: rnd() * 40 } : {}), ...(rnd() < 0.4 ? { supplier: pickOne(['Kavurucu', 'Mandıra Ali']) } : {}), ...(rnd() < 0.3 ? { expenseId: 'x' } : {}) };
    else if (kind === 'count') e = { ...base, itemId: item, quantity: Math.floor(rnd() * 20000) / 4, ...(rnd() < 0.8 ? { expected: Math.floor(rnd() * 20000) / 3 } : {}), ...(rnd() < 0.1 ? { start: true } : {}) };
    else if (kind === 'waste') e = { ...base, itemId: rnd() < 0.05 ? 'missing-item' : item, quantity: 1 + Math.floor(rnd() * 900), reason: pickOne(['Bozuldu', 'Döküldü / kırıldı']) };
    else if (kind === 'price') e = { ...base, itemId: item, ...(rnd() < 0.9 ? { unitCost: rnd() * 60 } : {}), ...(rnd() < 0.2 ? { start: true } : {}) };
    else e = { ...base, productId: pickOne(['latte', 'su', 'removed-product']), productQuantity: 1 + Math.floor(rnd() * 3) + (rnd() < 0.2 ? 0.5 : 0), items: [[item, 20], ['i0', 1500]] };
    if (rnd() < 0.05) Object.assign(e, { deletedAt: iso(at + 60_000), deletedBy: rnd() < 0.5 ? 'Mert' : undefined, ...(rnd() < 0.5 ? { deletedById: 'mgr' } : {}), ...(rnd() < 0.3 ? { deletedRole: 'manager' } : {}), ...(rnd() < 0.5 ? { deletedChange: 'Malzeme 1 1 kg → 0 g' } : {}) });
    entries.push(e);
  }
  // Records come out of the database in their own order: the history sorts them itself.
  return { items, recipes, logs, entries: entries.sort(() => rnd() - 0.5) };
}

test('K-T İşlem geçmişi: the page-by-page index gives exactly the lines, filters, people and items of the whole-list version', () => {
  const data = fixture(3000), reference = referenceHistory(data, ctx), index = new StockHistoryIndex(data);
  assert.deepEqual(stockHistory(data, ctx), reference, 'every line, in the same order and with the same words');
  assert.ok(reference.some(e => e.kind === 'price' && e.before) && reference.some(e => e.kind === 'undo') && reference.some(e => e.kind === 'start') && reference.some(e => e.kind === 'item_add' && e.byName === '—'), 'the fixture has every kind of line');
  const kitchen = (r: { by: string; kind: StockEventKind }) => r.by === 'cook' && KITCHEN_HISTORY.has(r.kind);
  const fromDay = (days: number) => iso(NOW - days * DAY);
  const filters = [{}, { from: fromDay(1) }, { from: fromDay(7) }, { from: fromDay(30) }, { from: fromDay(400) }, { itemId: 'i3' }, { itemId: 'i0', from: fromDay(200) }, { itemId: 'water' }, { by: 'cook' }, { by: '—' }, { by: 'Mert' }, { by: 'mgr', itemId: 'i1' },
    { q: 'kavurucu' }, { q: 'FİRE' }, { q: 'ayşe', from: fromDay(300) }, { q: '₺' }, { q: 'geri alma' }, { q: 'yok-böyle-bir-şey' }];
  for (const f of filters) for (const scope of [undefined, kitchen]) {
    const visible = scope ? reference.filter(e => e.by === 'cook' && KITCHEN_HISTORY.has(e.kind)) : reference, expected = filterStockHistory(visible, f);
    const label = JSON.stringify({ ...f, kitchen: !!scope });
    assert.equal(index.page(ctx, { ...f, scope }).total, expected.length, label);
    for (const page of [1, 2, 7]) assert.deepEqual(index.page(ctx, { ...f, scope, offset: (page - 1) * 25, limit: 25 }).events, expected.slice((page - 1) * 25, page * 25), `${label} page ${page}`);
    const { people, seen } = index.choices(ctx, scope);
    assert.deepEqual(people, referencePeople(visible), `${label} people`); assert.deepEqual(seen, new Set(visible.flatMap(e => e.itemIds)), `${label} items`);
  }
  // Today's names: a renamed product or person reads with its new name on the next request (the words are not kept stale).
  const renamed: Context = { ...ctx, staff: ctx.staff.map(u => u.id === 'cook' ? { ...u, name: 'Ayşe Y.' } : u) };
  assert.deepEqual(index.page(renamed, { limit: 100 }).events, referenceHistory(data, renamed).slice(0, 100));
  assert.equal(historyIndex(data), historyIndex(data), 'one index per snapshot');
});

test('K-T İşlem geçmişi pages: 25 a page, the pages put together are the whole list, past the end is empty', () => {
  const data = fixture(260), index = historyIndex(data), all = stockHistory(data, ctx);
  const pages: StockEvent[] = [];
  for (let p = 0; ; p++) { const r = index.page(ctx, { offset: p * 25, limit: 25 }); assert.equal(r.total, all.length); if (!r.events.length) break; assert.ok(r.events.length <= 25); pages.push(...r.events); }
  assert.deepEqual(pages, all);
  assert.deepEqual(index.page(ctx, { offset: all.length, limit: 25 }).events, []);
  assert.ok(pages.every((e, i) => i === 0 || pages[i - 1].at >= e.at), 'newest first');
  // A period is a prefix of the newest-first list.
  const from = all[40].at, period = index.page(ctx, { from });
  assert.equal(period.total, all.filter(e => e.at >= from).length); assert.deepEqual(period.events, all.slice(0, period.total));
});

test('K-T Stok: a write updates the kept snapshot in place, the same as reading every record again', t => {
  const store = new Store(temp('stock-memo')), tenant = 'mola-demo';
  t.after(() => store.close());
  const book = new StockBook(store), stamp = (ms: number) => iso(NOW + ms);
  const item: StockItem = { id: 'kahve', name: 'Kahve', unit: 'g', createdAt: stamp(0) };
  book.put(tenant, 'item', item, item.createdAt);
  for (let k = 0; k < 30; k++) { const e: StockEntry = { id: `e${(k * 7) % 30}`, kind: 'purchase', at: stamp(((k * 13) % 30) * 60_000), by: 'owner', itemId: 'kahve', quantity: 100 + k, total: 1000 }; book.put(tenant, 'entry', e, e.at); }
  const before = book.data(tenant);
  // New records in the middle and at the end, a record taken back, an item changed, a recipe and a log.
  const middle: StockEntry = { id: 'a-middle', kind: 'waste', at: stamp(5 * 60_000), by: 'cook', itemId: 'kahve', quantity: 5 };
  book.put(tenant, 'entry', middle, middle.at);
  const same: StockEntry = { id: 'e0', kind: 'count', at: stamp(5 * 60_000), by: 'cook', itemId: 'kahve', quantity: 50, expected: 60 };
  book.put(tenant, 'entry', same, same.at);
  const taken = before.entries[3]; book.put(tenant, 'entry', { ...taken, deletedAt: stamp(3_600_000), deletedBy: 'İşletme sahibi' }, taken.at);
  book.put(tenant, 'item', { ...item, alert: { low: true, n: 1 } }, item.createdAt);
  book.put(tenant, 'item', { id: 'sut', name: 'Süt', unit: 'ml', createdAt: stamp(-60_000) }, stamp(-60_000));
  const recipe: Recipe = { id: 'r', productId: 'latte', validFrom: stamp(60_000), items: [{ itemId: 'kahve', amount: 18 }] }; book.put(tenant, 'recipe', recipe, recipe.validFrom);
  const log: StockLog = { id: 'l', at: stamp(120_000), by: 'owner', byName: 'İşletme sahibi', role: 'owner', action: 'min', itemId: 'kahve', name: 'Kahve', after: '200 g' }; book.put(tenant, 'log', log, log.at);
  const kept = book.data(tenant);
  assert.notEqual(kept, before, 'a new snapshot: whoever holds the old one keeps it unchanged');
  assert.equal(before.entries.length, 30); assert.equal(before.entries.find(e => e.id === taken.id)?.deletedAt, undefined);
  assert.deepEqual(kept, new StockBook(store).data(tenant), 'the same as a fresh read');
  // In a transaction the snapshot is dropped (a rollback must not leave the record behind).
  store.db.exec('BEGIN');
  book.put(tenant, 'entry', { id: 'rolled', kind: 'waste', at: stamp(0), by: 'owner', itemId: 'kahve', quantity: 1 }, stamp(0));
  store.db.exec('ROLLBACK');
  assert.equal(book.data(tenant).entries.some(e => e.id === 'rolled'), false);
});

test('K-T amounts: one kept formatter per digit count words amounts as toLocaleString did', () => {
  const old = (amount: number, unit: StockUnit) => {
    const number = (n: number, digits: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: digits });
    const sign = amount < 0 ? '−' : '', a = Math.abs(amount);
    if (unit === 'piece') return `${sign}${number(a, a < 10 ? 1 : 0)} adet`;
    const big = unit === 'g' ? 'kg' : 'L', small = unit === 'g' ? 'g' : 'ml';
    if (a >= 1000) return `${sign}${number(a / 1000, a >= 100_000 ? 0 : a >= 10_000 ? 1 : 2)} ${big}`;
    return `${sign}${number(a, a < 10 ? 1 : 0)} ${small}`;
  };
  for (const n of [0, 0.25, 1.55, 9.96, 10, 850, 999.5, 1000, 1234.567, 9999, 10_050, 99_999, 100_000, 1_234_567.8, -0.4, -120, -2400.5])
    for (const unit of ['g', 'ml', 'piece'] as const) assert.equal(formatAmount(n, unit), old(n, unit), `${n} ${unit}`);
});

import { formatAmount, perBigUnit, bigUnit, type Recipe, type StockData, type StockEntry, type StockItem, type StockLog, type StockUnit } from './stock.js';

/*
 * Stok → İşlem geçmişi (8 Ekim, the owner's real test: "who did what to the stock, and when?"). Nothing new is counted
 * here: the history is read from what Stok already keeps (server/stock.ts `stock_records`):
 *   entries   alış, sayım (expected → counted), başlangıç, fire, iade, fiyat; a record taken back ("Geri alma") at its
 *             deletedAt with who did it and, from 8 Ekim on, what it changed;
 *   recipes   every version: the previous recipe → the new one, from its validFrom;
 *   logs      (8 Ekim on) malzeme eklendi / düzenlendi / silindi and "Uyarı sınırı" changes, with before → after.
 * Older records lack the role and some names: the role comes from today's staff list, an unknown writer reads "—", and an
 * item added before logs existed still shows "Malzeme eklendi" (from its createdAt) without a name.
 *
 * Page by page (9 Ekim, K-T: five years are ~30 000 records and every filter rebuilt and worded all of them, 2,5–3 s):
 * `historyIndex(data)` sorts the records once per stock snapshot (newest first) with what a filter needs and no words —
 * the time, the kind, who, the items, and the running values ("önceki fiyat", the previous recipe). A query then cuts the
 * period by binary search, filters the item and the person on those fields, and words only the page it returns; only a
 * search needs the words of the rows in its period (worded once, then kept with the snapshot).
 * Browser-safe (type imports and stock.ts only).
 */
export type StockEventKind = 'purchase' | 'count' | 'start' | 'waste' | 'return' | 'price' | 'undo' | 'recipe' | 'item_add' | 'item_edit' | 'item_remove' | 'min';
export const STOCK_EVENT_NAMES: Record<StockEventKind, string> = {
  purchase: 'Alış', count: 'Sayım', start: 'Başlangıç', waste: 'Fire', return: 'İade · stoğa döndü', price: 'Fiyat düzeltme', undo: 'Geri alma',
  recipe: 'Reçete değişikliği', item_add: 'Malzeme eklendi', item_edit: 'Malzeme düzenlendi', item_remove: 'Malzeme silindi', min: 'Uyarı sınırı değişti',
};
/** One line of the history. `subject`: the ingredient (or the product of a recipe or a return); `money`: shows a price or total. */
export type StockEvent = {
  id: string; at: string; kind: StockEventKind; by: string; byName: string; role: string; subject: string; itemIds: string[];
  amount?: string; before?: string; after?: string; note?: string; money?: boolean;
};
type Staff = { id: string; name: string; role: string };
export type StockHistoryContext = { products: readonly { id: string; name: string }[]; staff: readonly Staff[] };

const tlFormats = [0, 2].map(d => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: d }));
const tl = (kurus: number) => tlFormats[Math.round(kurus) % 100 === 0 ? 0 : 1].format(Math.round(kurus) / 100);
const plain = new Intl.NumberFormat('tr-TR');
const perUnit = (unitCost: number, unit: StockUnit) => `${tl(perBigUnit(unitCost, unit))} / ${bigUnit(unit).label}`;

/** Where a line comes from, with the running values it needs (worded only when shown or searched). */
type Source =
  | { src: 'entry'; e: StockEntry; prevCost?: number }
  | { src: 'undo'; e: StockEntry; prevCost?: number }
  | { src: 'recipe'; r: Recipe; prev?: Recipe }
  | { src: 'log'; l: StockLog }
  | { src: 'add' | 'remove'; i: StockItem };
/** A line without words: what the period, the item and the person filters read. `key`: the person filter's value (by || byName). */
export type HistoryRow = { id: string; at: string; kind: StockEventKind; by: string; key: string; itemIds: string[]; source: Source };

const entryKind = (e: StockEntry): StockEventKind => e.kind === 'purchase' ? 'purchase' : e.kind === 'count' ? (e.start ? 'start' : 'count') : e.kind === 'waste' ? 'waste' : e.kind === 'return' ? 'return' : e.start ? 'start' : 'price';
const recipeItems = (r: Recipe) => [...r.items.map(i => i.itemId), ...(r.options ?? []).flatMap(o => [...(o.add ?? []).map(x => x.itemId), ...(o.replace ?? []).flatMap(x => [x.from, x.to])])];
const entryItems = (e: StockEntry) => e.kind === 'return' ? (e.items ?? []).map(([x]) => x) : [e.itemId ?? ''];
const newestFirst = (a: { at: string; id: string }, b: { at: string; id: string }) => a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/** Every stock record as rows without words, newest first (the same lines and order as before 9 Ekim). */
function buildRows(data: StockData): HistoryRow[] {
  const rows: HistoryRow[] = [];
  // Prices in force before each price entry: "₺900 / kg → ₺950 / kg".
  const lastPrice = new Map<string, number>();
  const entries = [...data.entries].sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1);
  for (const e of entries) {
    const id = e.itemId ?? '', prevCost = lastPrice.get(id), kind = entryKind(e), itemIds = entryItems(e);
    rows.push({ id: e.id, at: e.at, kind, by: e.by, key: e.by || (e.byName ?? '—'), itemIds, source: { src: 'entry', e, prevCost } });
    if (!e.deletedAt && (e.kind === 'purchase' || e.kind === 'price') && typeof e.unitCost === 'number') lastPrice.set(id, e.unitCost);
    if (e.deletedAt) { const by = e.deletedById ?? ''; rows.push({ id: `${e.id}:undo`, at: e.deletedAt, kind: 'undo', by, key: by || (e.deletedBy ?? '—'), itemIds, source: { src: 'undo', e, prevCost } }); }
  }
  // Recipe versions per product, oldest first: each is "before → after".
  const byProduct = new Map<string, Recipe[]>();
  for (const r of [...data.recipes].sort((a, b) => a.validFrom.localeCompare(b.validFrom))) { const list = byProduct.get(r.productId); if (list) list.push(r); else byProduct.set(r.productId, [r]); }
  for (const versions of byProduct.values()) versions.forEach((r, i) => {
    const prev = versions[i - 1], by = r.by ?? '';
    rows.push({ id: `recipe:${r.id}`, at: r.validFrom, kind: 'recipe', by, key: by || (r.byName ?? '—'), itemIds: [...new Set([...recipeItems(r), ...(prev ? recipeItems(prev) : [])])], source: { src: 'recipe', r, prev } });
  });
  const logs = data.logs ?? [], added = new Set<string>(), removed = new Set<string>();
  for (const l of logs) {
    rows.push({ id: `log:${l.id}`, at: l.at, kind: l.action, by: l.by, key: l.by || l.byName, itemIds: [l.itemId], source: { src: 'log', l } });
    if (l.action === 'item_add') added.add(l.itemId); else if (l.action === 'item_remove') removed.add(l.itemId);
  }
  // Items from before the logs: their creation and removal still show, without a name.
  for (const i of data.items) {
    if (i.kind === 'product') continue;
    if (!added.has(i.id)) rows.push({ id: `add:${i.id}`, at: i.createdAt, kind: 'item_add', by: '', key: '—', itemIds: [i.id], source: { src: 'add', i } });
    if (i.removedAt && !removed.has(i.id)) rows.push({ id: `remove:${i.id}`, at: i.removedAt, kind: 'item_remove', by: '', key: '—', itemIds: [i.id], source: { src: 'remove', i } });
  }
  return rows.sort(newestFirst);
}

/** The words of rows for one context (today's product names and staff list). */
function wording(data: StockData, ctx: StockHistoryContext) {
  const items = new Map(data.items.map(i => [i.id, i])), products = new Map(ctx.products.map(p => [p.id, p.name])), staff = new Map(ctx.staff.map(u => [u.id, u]));
  const roleOf = (id: string | undefined) => !id ? '' : id === 'mola' ? 'system' : staff.get(id)?.role ?? 'owner';
  const nameOf = (id: string | undefined) => !id ? '—' : staff.get(id)?.name ?? 'İşletme sahibi';
  const itemName = (id: string) => { const i = items.get(id); return !i ? 'Silinmiş malzeme' : i.kind === 'product' ? products.get(i.productId ?? '') ?? i.name : i.name; };
  const amount = (id: string | undefined, n: number | undefined) => { const i = id ? items.get(id) : undefined; return n === undefined ? '' : i ? formatAmount(n, i.unit) : plain.format(n); };
  const summary = (r: Recipe) => r.ready ? 'Hazır ürün (adet)' : !r.items.length ? 'Takip yok' : `${r.items.map(i => `${itemName(i.itemId)} ${amount(i.itemId, i.amount)}`).join(', ')}${r.options?.length ? ` · ${r.options.length} seçenek kuralı` : ''}`;
  const entryWho = (e: StockEntry) => ({ by: e.by, byName: e.byName ?? nameOf(e.by), role: e.role ?? roleOf(e.by) });
  /** Who, without the rest of the words (the person list reads only this). */
  const who = (row: HistoryRow): Pick<StockEvent, 'by' | 'byName' | 'role'> => {
    const s = row.source;
    if (s.src === 'entry') return entryWho(s.e);
    if (s.src === 'undo') return { by: s.e.deletedById ?? '', byName: s.e.deletedBy ?? '—', role: s.e.deletedRole ?? (s.e.deletedById ? roleOf(s.e.deletedById) : '') };
    if (s.src === 'recipe') return { by: s.r.by ?? '', byName: s.r.byName ?? nameOf(s.r.by), role: s.r.role ?? roleOf(s.r.by) };
    if (s.src === 'log') return { by: s.l.by, byName: s.l.byName, role: s.l.role };
    return { by: '', byName: '—', role: '' };
  };
  const entryEvent = (e: StockEntry, prevCost: number | undefined): StockEvent => {
    const w = entryWho(e), id = e.itemId ?? '', unit = items.get(id)?.unit;
    if (e.kind === 'purchase') return { id: e.id, at: e.at, kind: 'purchase', ...w, subject: itemName(id), itemIds: [id], amount: `+${amount(id, e.quantity)}`, note: [e.total ? tl(e.total) : 'Ücretsiz', e.supplier, e.expenseId ? 'Gider olarak kaydedildi' : e.unpaid ? 'Ödenmedi (veresiye)' : ''].filter(Boolean).join(' · '), money: true };
    if (e.kind === 'count' && e.start) return { id: e.id, at: e.at, kind: 'start', ...w, subject: itemName(id), itemIds: [id], amount: amount(id, e.quantity), note: e.by === 'mola' ? 'Yıl açılışı' : 'Malzeme eklenirken yazılan miktar' };
    if (e.kind === 'count') { const diff = (e.quantity ?? 0) - (e.expected ?? 0); return { id: e.id, at: e.at, kind: 'count', ...w, subject: itemName(id), itemIds: [id], amount: amount(id, e.quantity), before: amount(id, e.expected ?? 0), after: amount(id, e.quantity), note: Math.abs(diff) < 0.5 ? 'Fark yok' : `Fark ${diff > 0 ? '+' : ''}${amount(id, diff)}` }; }
    if (e.kind === 'waste') return { id: e.id, at: e.at, kind: 'waste', ...w, subject: itemName(id), itemIds: [id], amount: `−${amount(id, e.quantity)}`, note: e.reason };
    if (e.kind === 'return') return { id: e.id, at: e.at, kind: 'return', ...w, subject: products.get(e.productId ?? '') ?? 'Silinmiş ürün', itemIds: (e.items ?? []).map(([x]) => x), amount: `+${plain.format(e.productQuantity ?? 0)} adet`, note: (e.items ?? []).map(([x, n]) => `${itemName(x)} +${amount(x, n)}`).join(', ') };
    return { id: e.id, at: e.at, kind: e.start ? 'start' : 'price', ...w, subject: itemName(id), itemIds: [id], ...(unit && e.unitCost !== undefined ? { after: perUnit(e.unitCost, unit), ...(prevCost !== undefined ? { before: perUnit(prevCost, unit) } : {}) } : {}), note: e.start ? 'Malzeme eklenirken yazılan fiyat' : 'Fiyat elle yazıldı', money: true };
  };
  const event = (row: HistoryRow): StockEvent => {
    const s = row.source;
    if (s.src === 'entry') return entryEvent(s.e, s.prevCost);
    if (s.src === 'undo') {
      const ev = entryEvent(s.e, s.prevCost);
      return { id: row.id, at: row.at, kind: 'undo', ...who(row), subject: ev.subject, itemIds: ev.itemIds, amount: `${STOCK_EVENT_NAMES[ev.kind]} ${ev.amount ?? ev.after ?? ''}`.trim(), note: s.e.deletedChange ? `Stok: ${s.e.deletedChange}` : 'Kayıt geri alındı', money: ev.money };
    }
    if (s.src === 'recipe') return { id: row.id, at: row.at, kind: 'recipe', ...who(row), subject: products.get(s.r.productId) ?? 'Silinmiş ürün', itemIds: row.itemIds, before: s.prev ? summary(s.prev) : 'Reçete yok', after: summary(s.r) };
    if (s.src === 'log') return { id: row.id, at: row.at, kind: s.l.action, ...who(row), subject: s.l.name, itemIds: [s.l.itemId], ...(s.l.before !== undefined ? { before: s.l.before } : {}), ...(s.l.after !== undefined ? { after: s.l.after } : {}) };
    return { id: row.id, at: row.at, kind: row.kind, by: '', byName: '—', role: '', subject: s.i.name, itemIds: [s.i.id] };
  };
  return { who, event };
}

const lower = (v: string) => v.toLocaleLowerCase('tr').trim();
const searchText = (e: StockEvent) => lower([STOCK_EVENT_NAMES[e.kind], e.subject, e.byName, e.amount, e.before, e.after, e.note].filter(Boolean).join(' '));
/** What a person may see (the kitchen: its own counts and fire); undefined = everything. */
export type HistoryScope = (row: Pick<HistoryRow, 'by' | 'kind'>) => boolean;
export type HistoryQuery = { from?: string; itemId?: string; by?: string; q?: string; offset?: number; limit?: number; scope?: HistoryScope };
/** The words of one context, filled as lines are shown or searched. */
type Words = { key: string; events: (StockEvent | undefined)[]; texts: (string | undefined)[]; who: ReturnType<typeof wording> };

/**
 * One stock snapshot's history, sorted once. `page()` returns the lines of one page of a filter, how many lines match,
 * the people (for "Kişi") and the items (for "Malzeme") of everything the reader may see.
 */
export class StockHistoryIndex {
  readonly rows: HistoryRow[];
  private words?: Words;
  constructor(private data: StockData) { this.rows = buildRows(data); }
  /** The words for this context, kept while the product names and the staff list stay the same. */
  private wordsFor(ctx: StockHistoryContext) {
    const key = JSON.stringify([ctx.products.map(p => [p.id, p.name]), ctx.staff.map(u => [u.id, u.name, u.role])]);
    if (this.words?.key !== key) this.words = { key, events: [], texts: [], who: wording(this.data, ctx) };
    return this.words;
  }
  private eventAt(i: number, w: Words) { return w.events[i] ??= w.who.event(this.rows[i]); }
  private textAt(i: number, w: Words) { return w.texts[i] ??= searchText(this.eventAt(i, w)); }
  /** How many rows (from the newest) are at or after `from` (rows are newest first). */
  private cut(from?: string) {
    if (!from) return this.rows.length;
    let lo = 0, hi = this.rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.rows[mid].at >= from) lo = mid + 1; else hi = mid; }
    return lo;
  }
  page(ctx: StockHistoryContext, f: HistoryQuery) {
    const q = lower(f.q ?? ''), offset = f.offset ?? 0, limit = f.limit ?? Infinity, end = this.cut(f.from), events: StockEvent[] = [], w = this.wordsFor(ctx);
    let total = 0;
    for (let i = 0; i < end; i++) {
      const r = this.rows[i];
      if ((f.scope && !f.scope(r)) || (f.itemId && !r.itemIds.includes(f.itemId)) || (f.by && r.key !== f.by) || (q && !this.textAt(i, w).includes(q))) continue;
      if (total >= offset && events.length < limit) events.push(this.eventAt(i, w));
      total++;
    }
    return { events, total };
  }
  /** "Kişi" and "Malzeme" lists: everyone and every item of the lines the reader may see (any period). */
  choices(ctx: StockHistoryContext, scope?: HistoryScope) {
    const last = new Map<string, number>(), seen = new Set<string>(), w = this.wordsFor(ctx);
    this.rows.forEach((r, i) => {
      if (scope && !scope(r)) return;
      for (const id of r.itemIds) seen.add(id);
      // The person's newest line decides the order, the oldest one the name and role (as a Map built from the whole list).
      if (r.by || r.key !== '—') last.set(r.key, i);
    });
    const people = [...last].map(([id, i]) => { const who = w.who.who(this.rows[i]); return { id, name: who.byName, role: who.role }; });
    return { people, seen };
  }
  /** Every line with its words (tests, small lists). */
  all(ctx: StockHistoryContext) { const w = this.wordsFor(ctx); return this.rows.map((_, i) => this.eventAt(i, w)); }
}
const indexes = new WeakMap<StockData, StockHistoryIndex>();
/** The index of a stock snapshot; server/stock.ts keeps one snapshot until the next write, so filters and pages reuse it. */
export function historyIndex(data: StockData) { let x = indexes.get(data); if (!x) indexes.set(data, x = new StockHistoryIndex(data)); return x; }

/** Every stock event of a business, newest first. */
export function stockHistory(data: StockData, ctx: StockHistoryContext): StockEvent[] { return new StockHistoryIndex(data).all(ctx); }

/** Filters of the history window: from a time on (ISO; '' = all), one item, one person, and a search over the words shown. */
export function filterStockHistory(events: readonly StockEvent[], f: { from?: string; itemId?: string; by?: string; q?: string }) {
  const q = lower(f.q ?? '');
  return events.filter(e => (!f.from || e.at >= f.from) && (!f.itemId || e.itemIds.includes(f.itemId)) && (!f.by || (e.by || e.byName) === f.by)
    && (!q || searchText(e).includes(q)));
}
/** The kitchen sees only its own counts and fire (and its own taking back of them). */
export const KITCHEN_HISTORY = new Set<StockEventKind>(['count', 'waste', 'undo']);

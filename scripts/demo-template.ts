// Sales prototype: a brand-new data folder with one rich, realistic demo business (Mola Örnek Kafe, Elazığ).
// Everything is written through the real HTTP API with a controllable clock, so reports, archives and the
// live floor are exactly what the app itself would have produced. Usage:
//   npx tsx scripts/demo-template.ts <yeni-veri-klasörü> [--gun=30] [--sektor=kafe|restoran|tatlici]
// Needs a running Mola Merkez (`npm run merkez`, MOLA_MERKEZ_URL, default http://127.0.0.1:4000): the folder is registered
// there like `npm run merkez:import` does, so its licences verify and support answers come from Mola Yönetim.
// --sektor=restoran: restaurant menu, item notes and masasız (counter) tickets; --sektor=tatlici: kg sales, gift boxes, many masasız tickets.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Store } from '../server/store.js';
import { seed } from '../server/seed.js';
import { initialUsers } from '../server/accounts.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { dataLock } from '../server/data-lock.js';
import { quote } from '../packages/domain/engine.js';
import { businessDay } from '../packages/domain/business-day.js';
import { saleProducts, type Campaign } from '../packages/domain/campaigns.js';
import type { CartLine, OptionGroup, Product, Selection } from '../packages/domain/types.js';
import type { Sector } from '../packages/domain/sector.js';
import { MerkezLink, machineId } from '../server/kafe-link.js';
import { publicKeyFrom } from '../server/license.js';
import { CAFE_CATEGORIES, CAFE_SUBTYPES, DEMO_PROFILES, demoMenu, type Spec } from '../server/demo-template-data.js';

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const days = Number(args.find(a => a.startsWith('--gun='))?.slice(6) ?? 30);
const sectorArg = args.find(a => a.startsWith('--sektor='))?.slice(9) ?? 'kafe';
const sector = ({ kafe: 'cafe', restoran: 'restaurant', tatlici: 'dessert' } as Record<string, Sector>)[sectorArg];
if (!target || !Number.isInteger(days) || days < 3 || days > 90 || !sector) {
  console.error('Kullanım: npx tsx scripts/demo-template.ts <yeni-veri-klasörü> [--gun=30] [--sektor=kafe|restoran|tatlici]  (gün: 3–90)'); process.exit(1);
}
const directory = resolve(target);
if (existsSync(directory) && (!statSync(directory).isDirectory() || readdirSync(directory).length)) {
  console.error(`Hedef klasör boş değil: ${directory}\nÖrnek işletme yalnız yeni veya boş bir klasöre kurulur; mevcut verilere dokunulmaz.`); process.exit(1);
}

// ---- Time: Turkish business calendar (UTC+3, no DST) and a fake clock that only moves forward ----
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR, TR = 3 * HOUR;
const ymd = (t: number) => new Date(t + TR).toISOString().slice(0, 10);
const dayStart = (t: number) => Date.parse(`${ymd(t)}T00:00:00+03:00`);
const weekday = (t: number) => new Date(t + TR).getUTCDay();
const hourOf = (t: number) => new Date(t + TR).getUTCHours();
const startedAt = Date.now(), today = dayStart(startedAt);
// History visits start at least 4 hours before the script began, so the live floor built at the end starts from a clean room.
const historyEnd = startedAt - 4 * HOUR;
const firstDay = today - days * DAY;
const ago = (n: number, hour: number) => today - Math.max(n ? 1 : 0, Math.round(n * days / 30)) * DAY + hour * HOUR;
let clock = firstDay - DAY + 7.5 * HOUR;
const now = () => new Date(clock);
const tick = (seconds: number) => { clock += seconds * 1000; };

// Seeded randomness: the same command gives a business with the same character every time.
let seedValue = 20261003;
function random() { seedValue = (seedValue + 0x6d2b79f5) | 0; let t = seedValue; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const between = (a: number, b: number) => a + random() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => random() < p;
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
function weighted<T>(items: [T, number][]): T | undefined {
  let r = random() * items.reduce((n, [, w]) => n + w, 0);
  for (const [item, w] of items) if ((r -= w) < 0) return item;
  return items.at(-1)?.[0];
}
const shuffle = <T>(items: T[]) => items.map(v => [random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// ---- Cooperative scheduler: one coroutine runs at a time, waiting hands control back, so the clock never goes back ----
const queue: { t: number; n: number; run: () => void }[] = []; let sequence = 0, failure: unknown, signal: (() => void) | undefined;
function push(t: number, run: () => void) { queue.push({ t: Math.max(t, clock), n: sequence++, run }); }
function handOver() { const s = signal; signal = undefined; s?.(); }
const wait = (t: number) => new Promise<void>(r => { push(t, r); handOver(); });
function spawn(t: number, fn: () => Promise<void>) { push(t, () => { fn().then(handOver, e => { failure ??= e; handOver(); }); }); }
async function runQueue() {
  while (queue.length) {
    let i = 0; for (let j = 1; j < queue.length; j++) if (queue[j].t < queue[i].t || (queue[j].t === queue[i].t && queue[j].n < queue[i].n)) i = j;
    const [item] = queue.splice(i, 1); clock = Math.max(clock, item.t);
    await new Promise<void>(r => { signal = r; item.run(); });
    if (failure) throw failure;
  }
}

// ---- Menu ----
// The menu, its option groups and how often each product sells live in server/demo-template-data.ts (the "Tanıtım" reset uses them too).
const menu = demoMenu(sector);
// Tea for the big tables and group orders.
const teaCode = sector === 'cafe' ? '21' : sector === 'restaurant' ? '604' : '601';
const specByCode = new Map(menu.map(s => [s.code, s]));
const productInput = (s: Spec) => ({ ...(s.unit ? { unit: s.unit } : {}), code: s.code, name: s.name, nameEn: s.nameEn, category: s.category, subtype: s.subtype, description: s.description, ingredients: s.ingredients, price: s.price, soldOut: !!s.soldOut, art: s.art, photo: null, groups: s.groups ?? [] });
const fieldsOf = (p: Product) => ({ ...(p.unit ? { unit: p.unit } : {}), code: p.code, name: p.name, nameEn: p.nameEn, category: p.category, subtype: p.subtype, description: p.description, ingredients: p.ingredients, price: p.price, soldOut: p.soldOut, art: p.art, photo: p.photo ?? null, groups: p.groups });

// ---- Server, store and HTTP clients ----
const release = dataLock(directory, 'demo-template');
// Own business ids per demo folder ("mola-demo-<8 hex>", "other-demo-<8 hex>"): three sector demos registered at one Mola
// Merkez stay three installs with their own ids and secrets (the shared 'mola-demo' / 'other-demo' made names and licences
// mix). The demo login names (isletme, kasiyer, garson, mutfak, diger) stay as they were.
const suffix = randomBytes(4).toString('hex'), mainTenant = `mola-demo-${suffix}`, otherTenant = `other-demo-${suffix}`;
{
  const seeding = new Store(directory, []);
  for (const [tenant, users] of [[mainTenant, initialUsers('mola-demo')], [otherTenant, initialUsers('other-demo')]] as const) {
    const state = seed(tenant); state.staffUsers = users; state.businessRevision = 0; state.setupCompleted = false;
    seeding.db.prepare('INSERT INTO snapshots VALUES (?,?)').run(tenant, seeding.encode(state));
  }
  seeding.close();
}
// Opened again: the store builds its directory, login and QR lookups for these businesses, as for its own demo seed.
const store = new Store(directory, []);
// No endpoint edits display names, so the built-in demo accounts get real names in their own encrypted snapshot.
const realNames: Record<string, string> = { isletme: 'Serkan Yıldız', kasiyer: 'Zeynep Arslan', garson: 'Mehmet Kaya', mutfak: 'Hatice Çelik' };
store.mutate(mainTenant, s => { for (const u of s.staffUsers!) u.name = realNames[u.username] ?? u.name; });
// This generator's own clock jumps hours at a time: the owner's 10-minute auto lock (server/owner-lock.ts) would lock the
// owner's session between two steps. Off while generating, back to the default (10 minutes) at the end. Nothing else here
// needs NODE_TEST_CONTEXT any more: the background jobs that read the real clock are held off below, in this process only.
for (const t of [mainTenant, otherTenant]) store.mutate(t, s => { s.ownerLockMinutes = 0; });
process.env.MOLA_YIL_PAKETI ??= '0'; process.env.MOLA_ROLLUP_WARM_MS ??= String(24 * 3600_000);
// ---- Mola Merkez: register the demo businesses (licences), the vendor answers tickets in Mola Yönetim ----
const merkezUrl = (process.env.MOLA_MERKEZ_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, ''), merkezData = resolve(process.env.MERKEZ_DATA_DIR ?? '.local/merkez');
const merkezKey = process.env.MOLA_MERKEZ_PUBLIC_KEY ?? readFileSync(join(merkezData, 'merkez-public-key.txt'), 'utf8');
const merkezJar = new Map<string, string>();
async function merkez(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${merkezUrl}/api/merkez/admin${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...merkezJar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); merkezJar.set(k, v); }
  const data = await response.json() as any;
  if (response.status === 401 && path !== '/login') { await merkezLogin(); return merkez(path, body); }
  if (!response.ok) throw new Error(`Mola Merkez ${path} → ${response.status} ${data.code ?? ''}: ${data.message ?? ''}`);
  return data;
}
const merkezPassword = process.env.MERKEZ_ADMIN_PASSWORD ?? readFileSync(join(merkezData, 'merkez-first-login.txt'), 'utf8').match(/Şifre: (\S+)/)![1];
async function merkezLogin() { await merkez('/login', { username: 'admin', password: merkezPassword }); }
const link = new MerkezLink(store, { now, url: merkezUrl, publicKey: publicKeyFrom(merkezKey) });
{
  const businesses = [mainTenant, otherTenant].map(tenant => ({ tenantId: tenant, name: store.directoryEntry(tenant).name, license: { endsAt: new Date(Date.now() + 365 * DAY).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } }));
  await merkezLogin();
  link.adopt(await merkez('/import', { requestId: randomUUID().replace(/-/g, ''), machineId: machineId(), businesses }));
}
const installId = link.read()!.installId;
const demoApp = createApp(store, now, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, link);
// QR siparişleri (server/qr-ordering.ts): the generated guests order between staff steps hours apart on the fake clock; the
// "a staff screen is connected" rule would refuse them, so it is off for the generator (stop and gün sonu pause still apply).
(demoApp.locals.qrOrdering as { staffRule: boolean }).staffRule = false;
const server = createServer(demoApp);
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let closed = false;
async function shutdown() {
  if (closed) return; closed = true;
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
  store.close(); release();
}

class Client {
  private jar = new Map<string, string>();
  session = ''; context = ''; loginAt = -Infinity; busy = false; blocked = false;
  constructor(public label: string, public username = '', public password = DEMO_PASSWORD) {}
  async request(path: string, body?: unknown): Promise<any> {
    const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(this.session ? { 'X-Guest-Session': this.session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); this.jar.set(k, v); }
    const data = await response.json() as any;
    if (!response.ok) throw new Error(`${this.label} ${path} → ${response.status} ${data.code ?? ''}: ${data.message ?? ''} (saat ${now().toISOString()})`);
    if (typeof data.session === 'string') this.session = data.session;
    return data;
  }
}
// Staff sessions last 8 hours of (fake) time and end when the business day turns (05:00, server/sessions.ts businessDayEnd);
// sign in again before either. (A run started between 05:00 and about 07:00 has its live hour just after the turn.)
async function call(user: Client, path: string, body?: unknown) {
  if (user.username && (clock - user.loginAt > 7 * HOUR || businessDay(clock) !== businessDay(user.loginAt))) { await user.request('/login', { username: user.username, password: user.password }); user.loginAt = clock; }
  return user.request(path, body);
}
const id = () => randomUUID();
const owner = new Client('İşletme sahibi', 'isletme'), cashier = new Client('Kasiyer', 'kasiyer'), kitchen = new Client('Mutfak', 'mutfak');
const waiters = { garson: new Client('Garson', 'garson'), garson2: new Client('Garson 2', 'garson2'), burak: new Client('Eski garson', 'burak') };
let burakActive = true;
const waiter = () => weighted<Client>([[waiters.garson, 1.2], [waiters.garson2, 1], ...(burakActive ? [[waiters.burak, 0.8] as [Client, number]] : [])])!;
const orderTaker = () => weighted<Client>([[waiter(), 80], [cashier, 12], [owner, 8]])!;
const regulars = Array.from({ length: 45 }, (_, i) => new Client(`Müdavim ${i + 1}`));

// ---- Local mirror of the floor and menu (versions and epochs follow the server's rules) ----
type Table = { id: string; name: string; token: string; area: string; epoch: number; dirty: boolean; busy: boolean };
type Flag = 'reject' | 'block' | 'autoCancel' | 'edit' | 'ownerCancel' | 'cancelApproved' | 'cancelDeclined';
type Ticket = { id: string; v: number; at: number; qr: boolean; guest?: Client; lines: CartLine[]; flag?: Flag; cancelled?: boolean };
type Visit = { table: Table; account: string; tickets: Ticket[]; guests: Client[] };
type Plan = { start: number; people: number; qr: boolean; rounds: number; area?: string; flag?: Flag; move?: boolean; bill?: boolean; call?: boolean };
let tables: Table[] = [], products: Product[] = [], campaigns: Campaign[] = [];
const payments: { id: string; amount: number; method: 'cash' | 'card'; at: number; adjusted?: boolean }[] = [];
const stats = { takeaways: 0, qrOrders: 0, packed: 0, visits: 0, closedByDay: new Map<string, number>(), walkaways: 0, empty: 0, moves: 0, merges: 0, cancels: 0, rejects: 0, declines: 0, edits: 0, calls: 0, expenses: 0, adjustments: 0 };
const product = (code: string) => { const p = products.find(p => p.code === code); if (!p) throw new Error(`Ürün bulunamadı: ${code}`); return p; };
async function refreshMenu() { const s = await call(owner, '/staff/state'); products = s.products; return s; }
async function refreshCampaigns() { const r = await call(owner, '/staff/campaigns'); campaigns = r.campaigns; return r.revision as number; }
// The same pricing the customer menu shows: product, options, then the campaigns active at this minute.
const priced = (lines: CartLine[]) => quote(saleProducts({ products, campaigns }, now()), lines, { now: now(), id }).reduce((n, l) => n + l.total, 0);

function selections(p: Product): Selection[] {
  return p.groups.flatMap(g => {
    if (!g.required && !chance(0.25)) return [];
    const option = g.id === 'size' ? weighted(g.options.map((o, i) => [o, [2, 6, 2][i] ?? 1] as [typeof o, number])) : weighted(g.options.map((o, i) => [o, i ? 1 : 3] as [typeof o, number]));
    return option ? [{ groupId: g.id, optionId: option.id }] : [];
  });
}
const cart = (people: number, extraRound = false) => sector === 'cafe' ? cafeCart(people, extraRound) : sectorCart(people, extraRound);
const notes = sector === 'restaurant' ? ['Soğansız', 'Acısız olsun', 'Sos ayrı gelsin', 'Turşusuz', 'Ekmek gelmesin', 'İyi pişmiş olsun', 'Çocuk için, küçük kesilsin'] : ['Ayrı tabakta', 'Az şerbetli', 'Çatal iki tane'];
/** Restaurant and dessert shop baskets: every guest a main (or a dessert), notes on some lines, weighed sweets in grams. */
function sectorCart(people: number, extraRound = false, takeaway = false): CartLine[] {
  const onSale = new Set(saleProducts({ products, campaigns }, now()).filter(p => p.discounts?.length).map(p => p.id));
  const available = products.filter(p => p.published !== false && !p.soldOut && specByCode.has(p.code));
  const choose = (kind: Spec['kind']) => weighted(available.filter(p => specByCode.get(p.code)!.kind === kind).map(p => [p, specByCode.get(p.code)!.w * (onSale.has(p.id) ? 2.2 : 1)] as [Product, number]));
  const lines: CartLine[] = [];
  const add = (p?: Product, note?: string) => {
    if (!p) return;
    // A gift box is the usual reason to buy sweets by the kilo to take away.
    const picked = p.unit === 'kg' ? p.groups.flatMap(g => g.id === 'box' ? (chance(takeaway ? 0.55 : 0.1) ? [{ groupId: g.id, optionId: g.options[0].id }] : []) : selections(p).filter(s => s.groupId === g.id)) : selections(p);
    if (p.unit === 'kg') { lines.push({ productId: p.id, quantity: 1, selections: picked, grams: takeaway ? pick([250, 500, 500, 750, 1000, 1000, 1500, 2000]) : pick([250, 250, 500]), ...(note ? { note } : {}) }); return; }
    const same = !note && lines.find(l => l.productId === p.id && !l.note && !l.grams && JSON.stringify(l.selections) === JSON.stringify(picked));
    if (same) same.quantity = Math.min(20, same.quantity + 1); else lines.push({ productId: p.id, quantity: 1, selections: picked, ...(note ? { note } : {}) });
  };
  const noted = (p = 0.15) => chance(p) ? pick(notes) : undefined;
  for (let i = 0; i < people; i++) {
    if (sector === 'restaurant') {
      if (extraRound) { if (chance(0.5)) add(chance(0.5) ? choose('dessert') : product(teaCode)); continue; }
      if (!takeaway && chance(0.35)) add(choose('starter'));
      add(choose('food'), noted(takeaway ? 0.25 : 0.15));
      if (chance(takeaway ? 0.6 : 0.8)) add(choose('drink'));
      if (chance(0.15)) add(choose('dessert'));
    } else {
      if (extraRound) { if (chance(0.5)) add(choose('drink')); continue; }
      if (takeaway) { add(choose('box'), chance(0.1) ? 'Ayrı ayrı paketlensin' : undefined); continue; }
      add(chance(0.8) ? choose('dessert') : choose('box'), noted(0.08));
      if (chance(0.7)) add(choose('drink'));
    }
  }
  if (!lines.length) add(choose('drink'));
  return lines;
}
function cafeCart(people: number, extraRound = false): CartLine[] {
  const hour = hourOf(clock);
  const onSale = new Set(saleProducts({ products, campaigns }, now()).filter(p => p.discounts?.length).map(p => p.id));
  const available = products.filter(p => p.published !== false && !p.soldOut && specByCode.has(p.code));
  // Campaigns visibly lift sales of their products, which is what the campaign report compares.
  const choose = (kind: Spec['kind']) => weighted(available.filter(p => { const s = specByCode.get(p.code)!; return s.kind === kind && (!s.hours || (hour >= s.hours[0] && hour < s.hours[1])); }).map(p => [p, specByCode.get(p.code)!.w * (onSale.has(p.id) ? 2.2 : 1)] as [Product, number]));
  const picked: Product[] = [];
  const add = (p?: Product) => { if (p) picked.push(p); };
  const teaTable = !extraRound && people >= 3 && chance(0.3);
  for (let i = 0; i < people; i++) {
    if (extraRound) { if (chance(0.5)) add(chance(0.5) ? choose('dessert') : choose('drink')); continue; }
    add(teaTable ? product(teaCode) : choose('drink'));
    const r = random();
    if (hour < 12 ? r < 0.55 : r < 0.35) add(hour < 12 ? (chance(0.75) ? choose('food') : choose('dessert')) : (chance(0.3) ? choose('food') : choose('dessert')));
  }
  if (!picked.length) add(choose('drink'));
  const lines = new Map<string, CartLine>();
  for (const p of picked) {
    const line = { productId: p.id, quantity: 1, selections: selections(p) }, key = JSON.stringify([p.id, line.selections]);
    const existing = lines.get(key); if (existing) existing.quantity = Math.min(20, existing.quantity + 1); else lines.set(key, line);
  }
  return [...lines.values()];
}

// ---- Floor operations ----
async function seat(area?: string, tries = 3): Promise<Table | undefined> {
  for (let i = 0; ; i++) {
    const free = tables.filter(t => !t.busy && !t.dirty), preferred = free.filter(t => !area || t.area === area), pool = preferred.length ? preferred : free;
    if (pool.length) { const t = pick(pool); t.busy = true; return t; }
    if (i >= tries) return undefined;
    await wait(clock + 10 * MIN);
  }
}
const preferredArea = () => weighted<string>([['İç salon', 6], ['Bahçe', 2], ['Teras', 2]]);
async function scan(guest: Client, table: Table) { const r = await guest.request('/guest/session', { token: table.token }); guest.context = r.guestContext; }
function takeGuests(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const regular = chance(0.35) ? regulars.find(r => !r.busy) : undefined;
    const guest = regular ?? new Client(`Misafir ${i + 1}`); guest.busy = true; return guest;
  });
}
function afterClose(table: Table) { table.epoch++; table.dirty = true; }
async function clean(table: Table, by = waiter()) {
  await call(by, '/staff/tables/clean', { requestId: id(), tableId: table.id, epoch: table.epoch });
  table.dirty = false; table.busy = false;
}
async function staffEntry(v: Visit, by: Client, lines: CartLine[], flag?: Flag): Promise<Ticket> {
  const r = await call(by, '/staff/orders', { requestId: id(), tableId: v.table.id, lines, expectedTotal: priced(lines) });
  v.account = r.accountId; const t: Ticket = { id: r.orderId, v: 1, at: clock, qr: false, lines, flag }; v.tickets.push(t);
  if (flag !== 'ownerCancel') return t;
  // Entered on the wrong table by mistake: the owner cancels it and the waiter enters the right order.
  await wait(clock + int(40, 90) * 1000);
  // Staff cancellations always carry a reason (the owner as supervisor); /staff/cancel only approves a guest's own request.
  await call(owner, '/staff/orders/cancel', { requestId: id(), orderId: t.id, version: t.v, reason: 'Yanlış sipariş' }); t.v++; t.cancelled = true; stats.cancels++;
  await wait(clock + int(40, 90) * 1000);
  return staffEntry(v, by, cart(Math.max(1, lines.length)));
}
async function qrEntry(v: Visit, guest: Client, lines: CartLine[], flag?: Flag): Promise<Ticket> {
  // Every 13th plain QR order is "Paketlensin": the guest takes it away. Counted, not drawn, so the random story stays the same.
  const packed = !flag && ++stats.qrOrders % 13 === 0; if (packed) stats.packed++;
  const r = await guest.request('/guest/orders', { requestId: id(), tableId: v.table.id, lines, expectedTotal: priced(lines), guestContext: guest.context, ...(packed ? { packed: true } : {}) });
  v.account = r.accountId; const t: Ticket = { id: r.orderId, v: 1, at: clock, qr: true, guest, lines, flag }; v.tickets.push(t);
  if (flag === 'edit') {
    // The guest adds one more of the first item inside the change window.
    await wait(clock + int(15, 35) * 1000);
    // A weighed line gets 250 g more instead (weighed lines always stay quantity 1).
    const next = lines.map((l, i) => i ? l : l.grams ? { ...l, grams: Math.min(20_000, l.grams + 250) } : { ...l, quantity: Math.min(20, l.quantity + 1) });
    const e = await guest.request('/guest/orders/edit', { requestId: id(), orderId: t.id, version: t.v, expectedTotal: priced(next), lines: next, guestContext: guest.context });
    t.v = e.version; t.lines = next; stats.edits++;
  }
  if (flag === 'autoCancel') {
    // Cancelled before the waiter approved it: automatic, then the guest orders something else.
    await wait(clock + int(15, 40) * 1000);
    await guest.request('/guest/cancel', { requestId: id(), orderId: t.id, version: t.v, guestContext: guest.context }); t.v++; t.cancelled = true; stats.cancels++;
    await wait(clock + int(40, 90) * 1000);
    return qrEntry(v, guest, cart(1));
  }
  return t;
}
type Stage = 'review' | 'preparing' | 'ready' | 'served';
async function serve(batch: Ticket[], at: Partial<Record<Stage, number>> = {}, until: Stage = 'served') {
  let live = batch.filter(t => !t.cancelled);
  const qr = live.filter(t => t.qr);
  if (qr.length) {
    await wait(at.review ?? clock + int(40, 150) * 1000);
    const by = waiter();
    for (const t of qr) {
      const refuse = t.flag === 'reject' || t.flag === 'block';
      await call(by, '/staff/orders/review', { requestId: id(), orderId: t.id, version: t.v, approve: !refuse, ...(refuse ? { reason: t.flag === 'block' ? 'Masada kimse yok; sipariş bu masaya ait değil.' : pick(['Masada müşteri bulunamadı.', 'Sipariş yanlış masadan verilmiş.', 'Aynı sipariş garsona da verildi.']) } : {}) });
      t.v++;
      if (refuse) { t.cancelled = true; stats.rejects++; }
      // A blocked phone never comes back as a returning guest.
      if (t.flag === 'block') { await call(owner, '/staff/block', { orderId: t.id, blocked: true }); t.guest!.blocked = true; }
    }
    live = live.filter(t => !t.cancelled);
  }
  if (until === 'review' || !live.length) return;
  // Preparation only starts after the guest's change window (changeSeconds) has closed.
  await wait(at.preparing ?? Math.max(clock, ...live.map(t => t.at + 65_000)) + int(1, 4) * MIN);
  for (const t of live) { await call(kitchen, '/staff/status', { requestId: id(), orderId: t.id, version: t.v, status: 'preparing' }).then(r => { t.v = r.version; }); }
  for (const t of live.filter(t => t.flag === 'cancelApproved')) {
    await wait(clock + int(1, 3) * MIN);
    await t.guest!.request('/guest/cancel', { requestId: id(), orderId: t.id, version: t.v, guestContext: t.guest!.context }); t.v++;
    await wait(clock + int(40, 100) * 1000);
    await call(kitchen, '/staff/cancel', { requestId: id(), orderId: t.id, version: t.v }); t.v++; t.cancelled = true; stats.cancels++;
  }
  live = live.filter(t => !t.cancelled);
  // A guest can ask to cancel only while the order is being prepared (CANCEL_CLOSED once it is ready): asked and declined then.
  for (const t of live.filter(t => t.flag === 'cancelDeclined')) {
    await wait(clock + int(20, 50) * 1000);
    await t.guest!.request('/guest/cancel', { requestId: id(), orderId: t.id, version: t.v, guestContext: t.guest!.context }); t.v++;
    await wait(clock + int(30, 60) * 1000);
    await call(kitchen, '/staff/cancel-decline', { requestId: id(), orderId: t.id, version: t.v, reason: pick(['Siparişiniz hazırlanıyor, birazdan masanızda.', 'Ürün hazırlanmaya başlandığı için iptal edilemedi; garsonumuz yardımcı olacak.']) }); t.v++; stats.declines++;
  }
  if (until === 'preparing' || !live.length) return;
  const food = live.some(t => t.lines.some(l => specByCode.get(products.find(p => p.id === l.productId)?.code ?? '')?.kind !== 'drink'));
  await wait(at.ready ?? clock + int(food ? 7 : 3, food ? 14 : 8) * MIN);
  for (const t of live) { await call(kitchen, '/staff/status', { requestId: id(), orderId: t.id, version: t.v, status: 'ready' }).then(r => { t.v = r.version; }); }
  if (until === 'ready') return;
  await wait(at.served ?? clock + int(1, 3) * MIN);
  const by = waiter();
  for (const t of live) { await call(by, '/staff/status', { requestId: id(), orderId: t.id, version: t.v, status: 'served' }).then(r => { t.v = r.version; }); }
}
function tender(amount: number) {
  const step = weighted<number>([[0, 3], [5000, 3], [10000, 3], [20000, 2], [50000, 1]])!;
  return step ? Math.ceil(amount / step) * step : amount;
}
async function pay(v: Visit, by: Client, state: { version: number }, method: 'cash' | 'card', amount: number, selections?: { orderId: string; lineId: string; quantity: number }[]) {
  const r = await call(by, '/staff/payments', { requestId: id(), accountId: v.account, version: state.version, method, amount, tendered: method === 'cash' ? tender(amount) : amount, ...(selections ? { selections } : {}) });
  state.version++; payments.push({ id: r.paymentId, amount, method, at: clock }); return r as { remaining: number; closed: boolean };
}
async function settle(v: Visit, bill = false, kind?: 'full' | 'amount' | 'items') {
  const by = chance(0.85) ? cashier : owner;
  if (bill && v.guests.length) {
    const r = await pick(v.guests).request('/guest/call', { requestId: id(), kind: 'bill' }); stats.calls++;
    await wait(clock + int(1, 3) * MIN);
    await call(by, '/staff/calls/resolve', { callId: r.callId });
  }
  const info = await call(by, `/staff/accounts/${v.account}/items`), state = { version: info.version as number };
  const items = (info.items as { orderId: string; lineId: string; unitPrice: number; remaining: number }[]).filter(i => i.remaining > 0);
  const due = items.reduce((n, i) => n + i.unitPrice * i.remaining, 0);
  if (!due) { await call(by, '/staff/close-empty', { requestId: id(), accountId: v.account }); stats.empty++; afterClose(v.table); return; }
  kind ??= weighted<'full' | 'amount' | 'items'>([['full', 72], ['amount', 14], ['items', 14]]);
  let result;
  if (kind === 'items' && items.length >= 2) {
    // Separate bills: one friend pays their own items by card, the rest is paid together.
    const mine = items.slice(0, Math.ceil(items.length / 2)), amount = mine.reduce((n, i) => n + i.unitPrice * i.remaining, 0);
    await pay(v, by, state, 'card', amount, mine.map(i => ({ orderId: i.orderId, lineId: i.lineId, quantity: i.remaining })));
    await wait(clock + int(1, 3) * MIN);
    result = await pay(v, by, state, chance(0.5) ? 'cash' : 'card', due - amount);
  } else if (kind === 'amount' && due >= 20000) {
    const first = Math.round(due * between(0.35, 0.65) / 1000) * 1000;
    await pay(v, by, state, 'card', first);
    await wait(clock + int(1, 2) * MIN);
    result = await pay(v, by, state, chance(0.6) ? 'cash' : 'card', due - first);
  } else result = await pay(v, by, state, chance(0.6) ? 'card' : 'cash', due);
  if (!result.closed) throw new Error(`${v.table.name} hesabı kapanmadı.`);
  afterClose(v.table);
  const day = ymd(clock); stats.closedByDay.set(day, (stats.closedByDay.get(day) ?? 0) + 1);
}
async function move(v: Visit) {
  const area = v.table.area === 'İç salon' ? pick(['Bahçe', 'Teras']) : 'İç salon';
  const target = await seat(area, 0); if (!target) return;
  const info = await call(cashier, `/staff/accounts/${v.account}/items`);
  await call(waiter(), '/staff/tables/move', { requestId: id(), accountId: v.account, version: info.version, targetId: target.id, targetEpoch: target.epoch });
  const source = v.table; afterClose(source); target.epoch++; v.table = target; stats.moves++;
  for (const t of v.tickets) t.v++;
  // Old QR sessions belong to the old table; phones scan the new table's code.
  for (const g of v.guests) await scan(g, target);
  spawn(clock + int(2, 5) * MIN, () => clean(source));
}
async function visit(p: Plan) {
  const table = await seat(p.area); if (!table) { stats.walkaways++; return; }
  stats.visits++;
  const v: Visit = { table, account: '', tickets: [], guests: [] };
  if (p.qr) {
    v.guests = takeGuests(p.people >= 3 && chance(0.5) ? 2 : 1);
    for (const g of v.guests) { await scan(g, table); await wait(clock + int(20, 90) * 1000); }
    if (p.call) {
      const r = await v.guests[0].request('/guest/call', { requestId: id(), kind: 'waiter' }); stats.calls++;
      await wait(clock + int(1, 3) * MIN); await call(waiter(), '/staff/calls/resolve', { callId: r.callId });
    }
  }
  for (let round = 0; round < p.rounds; round++) {
    if (round) await wait(clock + int(15, 40) * MIN);
    if (round === 1 && p.move) await move(v);
    const batch: Ticket[] = [];
    if (p.qr && (round === 0 || chance(0.5))) {
      // Each phone orders its own share; friends at one table appear as Misafir 1 and Misafir 2.
      const shares = v.guests.length === 2 ? [Math.ceil(p.people / 2), Math.floor(p.people / 2)] : [p.people];
      for (const [i, g] of v.guests.entries()) {
        if (round && i) break;
        if (i) await wait(clock + int(10, 60) * 1000);
        batch.push(await qrEntry(v, round ? pick(v.guests) : g, cart(round ? p.people : shares[i], round > 0), round || i ? undefined : p.flag));
      }
    } else batch.push(await staffEntry(v, orderTaker(), cart(p.people, round > 0), round ? undefined : p.flag));
    await serve(batch);
  }
  await wait(clock + int(10, 35) * MIN);
  await settle(v, p.bill);
  for (const g of v.guests) g.busy = g.blocked;
  await wait(clock + int(2, 6) * MIN);
  await clean(v.table);
}
// A large group on two tables asks for one bill: the cashier merges the second account into the first.
async function groupVisit() {
  const a = await seat('İç salon'), b = a && await seat('İç salon', 0);
  if (!a || !b) { if (a) a.busy = false; stats.walkaways++; return; }
  stats.visits += 2;
  const va: Visit = { table: a, account: '', tickets: [], guests: [] }, vb: Visit = { table: b, account: '', tickets: [], guests: [] };
  const by = waiter();
  const first = await staffEntry(va, by, cart(int(3, 4))); await wait(clock + int(30, 90) * 1000);
  const second = await staffEntry(vb, by, cart(int(3, 4)));
  await serve([first, second]);
  await wait(clock + int(20, 35) * MIN);
  await serve([await staffEntry(va, by, cart(int(3, 6), true).concat({ productId: product(teaCode).id, quantity: 4, selections: [] }))]);
  await wait(clock + int(15, 30) * MIN);
  const ia = await call(cashier, `/staff/accounts/${va.account}/items`), ib = await call(cashier, `/staff/accounts/${vb.account}/items`);
  await call(cashier, '/staff/accounts/merge', { requestId: id(), sourceId: vb.account, sourceVersion: ib.version, targetId: va.account, targetVersion: ia.version });
  afterClose(b); a.epoch++; stats.merges++;
  spawn(clock + int(2, 5) * MIN, () => clean(b));
  await wait(clock + int(1, 3) * MIN);
  await settle(va, false, 'amount');
  await wait(clock + int(2, 6) * MIN);
  await clean(a);
}

// A masasız ticket at the counter (Sipariş al → Masasız sipariş): numbered by the server, through the kitchen, paid at the till.
// Most are paid when the bag is ready (payment hands it over); some pay first and get the bag handed over later.
const callNames = ['Ahmet', 'Ayşe', 'Mehmet', 'Elif', 'Can', 'Zeynep', 'Murat', 'Selin', 'Emre', 'Deniz', 'Burak', 'Hande'];
type TakeawayStage = 'new' | 'preparing' | 'ready' | 'served';
async function takeawayVisit(lines = sectorCart(weighted<number>([[1, 5], [2, 4], [3, 2], [4, 1]])!, false, true), o: { label?: string; paidFirst?: boolean; until?: TakeawayStage; at?: Partial<Record<'review' | 'preparing' | 'ready' | 'served', number>>; by?: Client } = {}) {
  const by = o.by ?? weighted<Client>([[cashier, 6], [owner, 1], ...(sector === 'restaurant' ? [[waiter(), 2] as [Client, number]] : [])])!;
  const label = 'label' in o ? o.label : chance(0.5) ? pick(callNames) : undefined;
  const r = await call(by, '/staff/takeaway/orders', { requestId: id(), ...(label ? { label } : {}), lines, expectedTotal: priced(lines) });
  stats.takeaways++;
  const t: Ticket = { id: r.orderId, v: 1, at: clock, qr: false, lines };
  const v: Visit = { table: { id: r.tableId, name: r.tableName, token: '', area: '', epoch: 0, dirty: false, busy: true }, account: r.accountId, tickets: [t], guests: [] };
  const payAll = async () => {
    const info = await call(cashier, `/staff/accounts/${v.account}/items`), due = (info.items as { unitPrice: number; remaining: number }[]).reduce((n, i) => n + i.unitPrice * i.remaining, 0);
    await pay(v, cashier, { version: info.version }, chance(0.6) ? 'card' : 'cash', due);
  };
  const paidFirst = o.paidFirst ?? chance(0.3), until = o.until ?? 'served';
  if (paidFirst) { await wait(clock + int(1, 2) * MIN); await payAll(); }
  if (until === 'new') return;
  await serve([t], o.at, until === 'served' ? 'ready' : until);
  if (until !== 'served') return;
  await wait(o.at?.served ?? clock + int(1, 6) * MIN);
  if (paidFirst) await call(cashier, '/staff/status', { requestId: id(), orderId: t.id, version: t.v, status: 'served' });
  else await payAll();
}

// ---- 1. Business setup (the day before the history starts) ----
console.log(`Örnek işletme kuruluyor: ${directory}`);
const businessName = DEMO_PROFILES[sector].name;
// Restaurant and dessert shop: the setup loads their starter menu. Masasız sales need no setting in any sector.
await call(owner, '/staff/setup', { requestId: id(), version: 0, name: businessName, ...(sector === 'cafe' ? {} : { sector }), tableCount: 12, paymentMode: 'after_service', cleaningEnabled: true, waiterApproval: true, changeSeconds: 60, commissionBps: 175 });
tick(40);
{
  let state = await call(owner, '/staff/state'), revision = state.businessRevision as number;
  for (const [i, t] of (state.tables as Table[]).entries()) { await call(owner, '/staff/tables/area', { requestId: id(), tableId: t.id, version: revision++, area: i < 8 ? 'İç salon' : 'Bahçe' }); tick(5); }
  for (let i = 0; i < 4; i++) { await call(owner, '/staff/tables/add', { requestId: id(), area: 'Teras' }); tick(5); }
  state = await call(owner, '/staff/state');
  tables = (state.tables as (Table & { needsCleaning?: boolean })[]).map(t => ({ id: t.id, name: t.name, token: t.token, area: t.area, epoch: t.epoch, dirty: !!t.needsCleaning, busy: false }));
}
tick(60);
await call(owner, '/staff/users', { username: 'garson2', name: 'Elif Demir', role: 'waiter', password: DEMO_PASSWORD });
await call(owner, '/staff/users', { username: 'burak', name: 'Burak Aydın', role: 'waiter', password: DEMO_PASSWORD });
tick(120);
if (sector !== 'cafe') {
  // The starter menu is already there; only the product added during the month comes later.
  for (const s of menu.filter(s => !s.seed && !s.publishAgo && !s.draft)) { await call(owner, '/staff/products', { requestId: id(), product: productInput(s) }); tick(int(20, 50)); }
  await refreshMenu();
} else {
  // Categories first (new ones must exist before products use them), then the products, then the order.
  let revision = await refreshCampaigns();
  for (const name of CAFE_CATEGORIES.filter(c => !['Kahveler', 'Çaylar', 'Soğuk İçecekler', 'Tatlılar'].includes(c))) revision = (await call(owner, '/staff/categories', { requestId: id(), revision, action: 'add', name })).revision;
  for (const s of menu.filter(s => !s.publishAgo && !s.draft)) {
    await call(owner, '/staff/products', { requestId: id(), ...(s.seed ? { id: s.seed } : {}), product: productInput(s) }); tick(int(20, 50));
  }
  revision = await refreshCampaigns();
  revision = (await call(owner, '/staff/categories', { requestId: id(), revision, action: 'reorder', names: CAFE_CATEGORIES })).revision;
  for (const [name, names] of Object.entries(CAFE_SUBTYPES)) {
    revision = (await call(owner, '/staff/categories', { requestId: id(), revision, action: 'subtype-order', name, names })).revision;
  }
  await refreshMenu();
}
tick(300);
{
  // Business profile: the owner's own data, set in Ayarlar (name, logo, colours, menu hero and the review link), from
  // server/demo-template-data.ts (the "Tanıtım" reset puts the same back).
  const profile = DEMO_PROFILES[sector];
  const logo = `data:image/png;base64,${(await sharp(Buffer.from(profile.logoSvg)).png().toBuffer()).toString('base64')}`;
  const revisionOf = (tenant: string) => store.read(tenant).businessRevision ?? 0;
  const other = new Client('Harput Kahve Evi', 'diger');
  await call(owner, '/staff/business-profile', { requestId: id(), version: revisionOf(mainTenant), name: businessName, logo, theme: profile.theme, googleReviewUrl: profile.googleReviewUrl, menuHero: profile.menuHero });
  await call(other, '/staff/business-profile', { requestId: id(), version: revisionOf(otherTenant), name: 'Harput Kahve Evi', logo: null, theme: 'forest' });
}

// ---- 2. Thirty days of history ----
const plans: Plan[] = [];
const hourWeights = [3, 4, 3, 3, 5, 6, 5, 6, 7, 7, 8, 9, 8, 6, 3];
for (let d = 0; d <= days; d++) {
  const day = firstDay + d * DAY, wd = weekday(day);
  const count = Math.round((wd === 6 ? 36 : wd === 0 ? 32 : wd === 5 ? 28 : 22) * between(0.85, 1.15));
  for (let i = 0; i < count; i++) {
    const hour = 8 + weighted(hourWeights.map((w, h) => [h, w] as [number, number]))!;
    const start = day + hour * HOUR + int(0, hour === 22 ? 30 : 59) * MIN + int(0, 59) * 1000;
    if (start > historyEnd) continue;
    const people = weighted<number>([[1, 15], [2, 40], [3, 20], [4, 15], [5, 6], [6, 4]])!, qr = chance(0.3);
    plans.push({ start, people, qr, rounds: 1 + Number(chance(0.4)) + Number(chance(0.1)), area: preferredArea(), bill: qr && chance(0.35), call: qr && chance(0.12) });
  }
}
// Rare events, spread over the month: each kind is put on a few random visits that can carry it.
const assign = (pool: Plan[], flag: Flag, count: number) => {
  for (const p of shuffle(pool.filter(p => !p.flag && !p.move)).slice(0, count)) {
    p.flag = flag;
    // A refused order ends the visit: the empty account is closed and nobody asks for a bill.
    if (flag === 'reject' || flag === 'block') { p.rounds = 1; p.bill = false; }
  }
};
const qrPlans = plans.filter(p => p.qr);
assign(qrPlans, 'reject', 3); assign(qrPlans, 'block', 1); assign(qrPlans, 'autoCancel', 4); assign(qrPlans, 'edit', 5); assign(qrPlans, 'cancelApproved', 3); assign(qrPlans, 'cancelDeclined', 3);
assign(plans.filter(p => !p.qr), 'ownerCancel', 5);
for (const p of shuffle(plans.filter(p => !p.flag)).slice(0, 8)) { p.move = true; p.rounds = Math.max(2, p.rounds); }
for (const p of plans) spawn(p.start, () => visit(p));
for (const n of [26, 19, 11, 4]) { const t = ago(n, 19 + random() * 1.5); if (t > firstDay && t < historyEnd) spawn(t, groupVisit); }
for (let d = 0; d <= days; d++) { const end = firstDay + (d + 1) * DAY - 1000; if (end < historyEnd) spawn(end, async () => { console.log(`  ${ymd(end)} · ${stats.closedByDay.get(ymd(end)) ?? 0} hesap kapandı`); }); }
const at = (n: number, hour: number, fn: () => Promise<void>) => { const t = ago(n, hour); if (t > firstDay + 8 * HOUR && t < historyEnd) spawn(t, fn); };
// Masasız tickets at the counter: a restaurant's lunch and dinner rush, a dessert shop's steady stream of boxes.
if (sector !== 'cafe') for (let d = 0; d <= days; d++) {
  const day = firstDay + d * DAY, wd = weekday(day), weekend = wd === 6 || wd === 0;
  const count = Math.round((sector === 'restaurant' ? (weekend ? 12 : 8) : (weekend ? 22 : 14)) * between(0.8, 1.2));
  const hours: [number, number][] = sector === 'restaurant' ? [[11, 2], [12, 6], [13, 5], [14, 2], [17, 2], [18, 4], [19, 5], [20, 4], [21, 2]] : [[10, 1], [11, 2], [12, 3], [13, 3], [14, 3], [15, 4], [16, 5], [17, 6], [18, 6], [19, 5], [20, 3], [21, 1]];
  for (let i = 0; i < count; i++) { const start = day + weighted(hours)! * HOUR + int(0, 59) * MIN + int(0, 59) * 1000; if (start < historyEnd) spawn(start, () => takeawayVisit()); }
}

// Till expenses entered by the cashier.
type Expense = [number, number, number, string];
const sectorExpenses = (): Expense[] => [
  [30, 10.2, 3200000, 'Dükkân kirası'], [28, 11.5, 685000, 'Elektrik faturası'], [27, 12.1, 128000, 'Su faturası'], [26, 10.8, 412000, 'Doğalgaz faturası'], [25, 14.3, 64900, 'İnternet faturası'],
  ...(sector === 'restaurant' ? [
    ...[29, 26, 23, 20, 17, 14, 11, 8, 5, 2].map(n => [n, 9.4, int(900000, 1200000), 'Et ve tavuk (kasap)'] as Expense),
    ...[29, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1].map(n => [n, 8.2, int(250000, 320000), 'Sebze ve meyve (hal)'] as Expense),
    ...[28, 21, 14, 7].map(n => [n, 10.6, int(180000, 220000), 'Bakliyat, pirinç ve yağ'] as Expense),
    [24, 15.1, 145000, 'Paket kabı, poşet ve peçete'], [10, 15.4, 145000, 'Paket kabı, poşet ve peçete'], [19, 17.3, 190000, 'Tüp gaz (2 adet)'], [6, 18.1, 160000, 'Ocak servisi: mangal ızgarası tamiri'],
  ] as Expense[] : [
    ...[29, 22, 15, 8, 1].map(n => [n, 9.2, 1250000, 'Antep fıstığı (10 kg)'] as Expense),
    ...[28, 21, 14, 7].map(n => [n, 9.6, int(360000, 420000), 'Tereyağı ve yufka'] as Expense),
    ...[27, 20, 13, 6].map(n => [n, 10.1, int(150000, 175000), 'Şeker, un ve nişasta'] as Expense),
    ...[29, 26, 23, 20, 17, 14, 11, 8, 5, 2].map(n => [n, 8.8, int(90000, 110000), 'Süt ve kaymak'] as Expense),
    [24, 14.2, 240000, 'Hediye kutusu ve kurdele (200 adet)'], [9, 14.6, 240000, 'Hediye kutusu ve kurdele (200 adet)'], [18, 16.4, 88000, 'Temizlik malzemesi'], [5, 17.1, 135000, 'Teraziler için kalibrasyon servisi'],
  ] as Expense[]),
];
const expenses: [number, number, number, string][] = sector !== 'cafe' ? sectorExpenses() : [
  [30, 10.2, 2500000, 'Dükkân kirası'], [28, 11.5, 485000, 'Elektrik faturası'], [27, 12.1, 98000, 'Su faturası'], [26, 10.8, 312000, 'Doğalgaz faturası'], [25, 14.3, 64900, 'İnternet faturası'],
  ...[29, 26, 23, 20, 17, 14, 11, 8, 5, 2].map(n => [n, 9.1, int(150000, 175000), 'Süt (40 litre)'] as [number, number, number, string]),
  ...[29, 22, 15, 8, 1].map(n => [n, 10.4, 450000, 'Kahve çekirdeği (5 kg)'] as [number, number, number, string]),
  [27, 15.2, 160000, 'Türk kahvesi (2 kg)'], [13, 15.6, 160000, 'Türk kahvesi (2 kg)'], [26, 16.1, 125000, 'Rize çayı (5 kg)'], [12, 16.4, 125000, 'Rize çayı (5 kg)'],
  ...[28, 21, 14, 7].map(n => [n, 11.3, int(360000, 410000), 'Tatlı tedariki (pastane)'] as [number, number, number, string]),
  ...[27, 20, 13, 6].map(n => [n, 8.6, int(60000, 72000), 'Kahvaltı ekmeği ve simit'] as [number, number, number, string]),
  [20, 13.4, 87500, 'Temizlik malzemesi'], [18, 12.2, 142000, 'Peçete, karton bardak ve pipet'], [11, 17.3, 95000, 'Tüp gaz'], [6, 18.1, 120000, 'Tesisatçı: bar musluğu tamiri'], [3, 11.7, 48000, 'Buz (10 torba)'],
];
for (const [n, hour, amount, description] of expenses) at(n, hour, async () => { await call(cashier, '/staff/expenses', { requestId: id(), amount, description }); stats.expenses++; });

// Campaigns: one finished, two running (one with a quantity condition and a stock limit), one weekend-only repeat, one scheduled.
const campaignAt = (n: number, hour: number, build: () => object) => at(n, hour, async () => {
  const revision = await refreshCampaigns();
  await call(owner, '/staff/campaigns', { requestId: id(), revision, campaign: build() }); await refreshCampaigns();
});
const iso = (t: number) => new Date(t).toISOString();
const saturday = (t: number) => dayStart(t) + (6 - weekday(t)) * DAY;
const ids = (...codes: string[]) => codes.map(c => product(c).id);
if (sector === 'restaurant') {
  campaignAt(24, 11.5, () => ({ name: 'Çorba Haftası', kind: 'percent', percent: 15, productIds: ids('101', '102', '103'), startsAt: iso(clock), endsAt: iso(ago(17, 23.5)), enabled: true, combine: false }));
  campaignAt(12, 9.5, () => ({ name: 'Ayran: 2 ve üzeri', kind: 'percent', percent: 20, minQuantity: 2, maxQuantity: 800, productIds: ids('601'), startsAt: iso(clock), endsAt: null, enabled: true, combine: false }));
  campaignAt(10, 18.4, () => ({ name: 'Hafta İçi Öğle Burgeri', kind: 'fixed', amount: 3000, productIds: ids('301', '302', '303'), startsAt: iso(saturday(clock) + 2 * DAY), endsAt: iso(saturday(clock) + 44 * DAY), schedule: { days: [1, 2, 3, 4, 5], from: '12:00', to: '15:00' }, enabled: true, combine: false }));
  campaignAt(1, 18.4, () => ({ name: 'Yaz Salataları', kind: 'percent', percent: 10, productIds: ids('401', '402'), startsAt: iso(today + 5 * DAY + 8 * HOUR), endsAt: iso(today + 35 * DAY + 14 * HOUR), enabled: true, combine: false }));
} else if (sector === 'dessert') {
  campaignAt(24, 11.5, () => ({ name: 'Baklava Haftası', kind: 'percent', percent: 10, productIds: ids('101', '102', '103'), startsAt: iso(clock), endsAt: iso(ago(17, 23.5)), enabled: true, combine: false }));
  campaignAt(12, 9.5, () => ({ name: 'Çay Keyfi: 4 çay ve üzeri', kind: 'percent', percent: 25, minQuantity: 4, maxQuantity: 1500, productIds: ids('601'), startsAt: iso(clock), endsAt: null, enabled: true, combine: false }));
  campaignAt(8, 10.25, () => ({ name: 'Kurabiye Günleri', kind: 'percent', percent: 15, productIds: ids('401', '402', '403'), startsAt: iso(clock), endsAt: iso(today + 10 * DAY + 23 * HOUR), enabled: true, combine: false }));
  campaignAt(1, 18.4, () => ({ name: 'Yeni Sezon Lokum', kind: 'percent', percent: 10, productIds: ids('501', '502'), startsAt: iso(today + 5 * DAY + 8 * HOUR), endsAt: iso(today + 35 * DAY + 14 * HOUR), enabled: true, combine: false }));
} else {
campaignAt(24, 11.5, () => ({ name: 'Tatlı Haftası', kind: 'percent', percent: 20, productIds: ['42', '44', '45', '47'].map(c => product(c).id), startsAt: iso(clock), endsAt: iso(ago(17, 23.5)), enabled: true, combine: false }));
campaignAt(12, 9.5, () => ({ name: 'Çay Keyfi: 4 çay ve üzeri', kind: 'percent', percent: 25, minQuantity: 4, maxQuantity: 1500, productIds: [product('21').id], startsAt: iso(clock), endsAt: null, enabled: true, combine: false }));
campaignAt(8, 10.25, () => ({ name: 'Soğuk Kahve Günleri', kind: 'percent', percent: 15, productIds: ['32', '33'].map(c => product(c).id), startsAt: iso(clock), endsAt: iso(today + 10 * DAY + 23 * HOUR), enabled: true, combine: false }));
// Weekly repeat: Saturday and Sunday breakfast hours for 6 weeks from the first Saturday after it was set up,
// so the report compares those mornings with the same mornings of the weeks before (most of which the demo history covers).
campaignAt(10, 18.4, () => ({ name: 'Hafta Sonu Kahvaltı Fırsatı', kind: 'fixed', amount: 4000, productIds: ['50', '51'].map(c => product(c).id), startsAt: iso(saturday(clock + DAY)), endsAt: iso(saturday(clock + DAY) + 42 * DAY), schedule: { days: [6, 7], from: '08:00', to: '12:00' }, enabled: true, combine: false }));
campaignAt(1, 18.4, () => ({ name: 'Yeni Sezon Limonata', kind: 'percent', percent: 10, productIds: ['31', '38'].map(c => product(c).id), startsAt: iso(today + 5 * DAY + 8 * HOUR), endsAt: iso(today + 35 * DAY + 14 * HOUR), enabled: true, combine: false }));
}

// Menu changes over the month: two new products, a test product kept as a draft, a price change waiting as an edit draft.
for (const s of menu.filter(s => s.publishAgo)) at(s.publishAgo!, 9.3, async () => { await call(owner, '/staff/products', { requestId: id(), product: productInput(s) }); await refreshMenu(); });
if (sector === 'cafe') at(6, 22.6, async () => { await call(owner, '/staff/products', { requestId: id(), product: { ...productInput(specByCode.get('41')!), published: false } }); await refreshMenu(); });
const repriced: [string, number] = sector === 'cafe' ? ['42', 20500] : sector === 'restaurant' ? ['201', 45000] : ['101', 128000];
at(2, 22.8, async () => { const p = product(repriced[0]); await call(owner, '/staff/products', { requestId: id(), id: p.id, product: { ...fieldsOf(p), price: repriced[1], published: false } }); });

// A waiter who left mid-month: his sales stay in the employee report as a closed account.
at(12, 8.2, async () => {
  const users = await call(owner, '/staff/users') as { id: string; username: string; version: number }[], u = users.find(u => u.username === 'burak')!;
  burakActive = false; await call(owner, '/staff/users/update', { id: u.id, version: u.version, role: 'waiter', active: false });
});

// Owner corrections on past payments (refunds and a wrong payment method).
const adjust = (n: number, hour: number, kind: 'refund' | 'method', from: 'cash' | 'card', reason: string) => at(n, hour, async () => {
  const p = payments.filter(p => p.method === from && !p.adjusted && p.amount >= 15000 && clock - p.at < 8 * HOUR).at(-1); if (!p) return;
  const method = kind === 'refund' ? from : from === 'card' ? 'cash' : 'card';
  await call(owner, '/staff/payment-adjustments', { requestId: id(), paymentId: p.id, revision: 0, kind, amount: kind === 'refund' ? Math.min(p.amount, 14000) : 0, method, commission: kind === 'method' && method === 'card' ? Math.round(p.amount * 175 / 10_000) : 0, reason });
  p.adjusted = true; stats.adjustments++;
});
adjust(15, 16.5, 'refund', 'cash', { cafe: 'Latte soğuk servis edildi; ücreti nakit iade edildi.', restaurant: 'Köfte geç geldi, müşteri ücretini istemedi; nakit iade edildi.', dessert: 'Baklava kutusu eksik tartılmıştı; fark nakit iade edildi.' }[sector]);
adjust(9, 15.5, 'refund', 'card', { cafe: 'Künefe yanlış masaya gitti, müşteri beklemek istemedi. Karta iade yapıldı.', restaurant: 'Masasız siparişte yanlış burger verildi, müşteri beklemek istemedi. Karta iade yapıldı.', dessert: 'Yaş pasta yanlış çeşitle hazırlandı. Karta iade yapıldı.' }[sector]);
adjust(5, 17.2, 'method', 'cash', 'Müşteri kartla ödedi; kasada yanlışlıkla nakit seçilmişti.');
adjust(3, 13.4, 'method', 'card', 'Ödeme nakit alındı; kart yanlış seçilmişti.');

// Support: one answered and closed, one still waiting for an answer.
at(20, 14.2, async () => {
  const t = await call(owner, '/staff/support', { requestId: id(), subject: 'Fiş yazıcısı deneme fişi basmıyor', text: 'Merhaba, bar için aldığımız fiş yazıcısını ağa bağladık ama deneme fişi çıkmıyor. Nasıl kontrol edebiliriz?' });
  await link.sync();
  await wait(clock + 2.5 * HOUR);
  await merkez('/tickets/reply', { requestId: id().replace(/-/g, ''), ticketId: t.id, text: 'Merhaba, yazıcının ayar fişindeki IP adresini Ayarlar → Fiş yazıcıları ekranındaki adresle karşılaştırın; port genelde 9100’dür. Modemde yazıcıya sabit IP vermenizi öneririz.' });
  await wait(clock + 18 * HOUR);
  await call(owner, '/staff/support/reply', { requestId: id(), ticketId: t.id, text: 'Teşekkürler, IP değişmiş. Sabit IP verdik, fiş çıkıyor.' });
  await link.sync();
  await wait(clock + 40 * MIN);
  await merkez('/tickets/reply', { requestId: id().replace(/-/g, ''), ticketId: t.id, text: 'Sevindik! Talebi kapatıyoruz, iyi çalışmalar.', close: true });
});
at(1, 17.3, async () => { await call(owner, '/staff/support', { requestId: id(), subject: 'Kampanya raporunu dışa aktarma', text: 'Kampanya raporunu muhasebecimize göndermek istiyoruz. Excel veya PDF olarak indirme imkânı var mı?' }); });

// A second business, prepared by the vendor in Mola Yönetim and waiting for its activation code (a separate café computer).
at(9, 11.1, async () => { await merkez('/businesses', { requestId: id().replace(/-/g, ''), name: 'Kampüs Kahve', kind: 'trial', sector: 'cafe', contactName: 'Kampüs İşletmesi' }); });

console.log(`${plans.length} ziyaret planlandı (${days + 1} gün). Geçmiş oluşturuluyor…`);
try { await runQueue(); } catch (e) { await shutdown(); throw e; }

// ---- 3. The live floor at the real current time ----
const L = Date.now();
console.log(`Canlı salon hazırlanıyor (${new Date(L).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })})…`);
const table = (name: string) => { const t = tables.find(t => t.name === name)!; if (t.busy || t.dirty) throw new Error(`${name} boş değil.`); t.busy = true; return t; };
const live = (minutes: number, fn: () => Promise<void>) => spawn(L - minutes * MIN, fn);
const visitAt = (name: string): Visit => ({ table: table(name), account: '', tickets: [], guests: [] });
const lines = (...items: [string, number, Selection[]?][]) => items.map(([code, quantity, selections]) => ({ productId: product(code).id, quantity, selections: selections ?? [] }));
const sel = (...pairs: [string, string][]) => pairs.map(([groupId, optionId]) => ({ groupId, optionId }));
const T = (m: number) => L - m * MIN;
// One line with an item note or a weight (weighed lines are always quantity 1).
const line = (code: string, quantity: number, selections: Selection[] = [], extra: { note?: string; grams?: number } = {}): CartLine => ({ productId: product(code).id, quantity, selections, ...extra });
if (sector === 'restaurant') {
  live(65, async () => { const p = product('204'); await call(owner, '/staff/products', { requestId: id(), id: p.id, product: { ...fieldsOf(p), soldOut: true } }); await refreshMenu(); });
  // Masa 11: paid a few minutes ago and still waiting to be cleaned.
  live(70, async () => { const v = visitAt('Masa 11'); await serve([await staffEntry(v, waiters.garson, [line('101', 2, sel(['portion', 'full'])), line('202', 1, sel(['garnish', 'rice'])), line('604', 2)])], { preparing: T(66), ready: T(52), served: T(50) }); await wait(T(5)); await settle(v, false, 'full'); });
  // Masa 02: served with a kitchen note; one friend has already paid their kebab.
  live(48, async () => {
    const v = visitAt('Masa 02');
    await serve([await staffEntry(v, waiters.garson2, [line('201', 1, sel(['heat', 'hot'], ['garnish', 'bulgur']), { note: 'Soğansız' }), line('203', 1, sel(['garnish', 'fries'])), line('601', 2)])], { preparing: T(46), ready: T(30), served: T(28) });
    await wait(T(6)); const items = await call(cashier, `/staff/accounts/${v.account}/items`), mine = (items.items as { orderId: string; lineId: string; unitPrice: number; remaining: number }[]).slice(0, 1);
    await pay(v, cashier, { version: items.version }, 'card', mine[0].unitPrice, mine.map(i => ({ orderId: i.orderId, lineId: i.lineId, quantity: i.remaining })));
  });
  // Masa 03: QR order served, the guest has just asked for the bill.
  live(42, async () => { const v = visitAt('Masa 03'), guest = new Client('Misafir'); v.guests = [guest]; await scan(guest, v.table); await wait(T(41)); await serve([await qrEntry(v, guest, [line('301', 1, sel(['doneness', 'medium']), { note: 'Turşusuz' }), line('602', 1)])], { review: T(40), preparing: T(38), ready: T(25), served: T(23) }); await wait(T(2)); await guest.request('/guest/call', { requestId: id(), kind: 'bill' }); });
  // Masa 07: ready at the pass; Masa 09: on the grill; Masa 12: QR order waiting for approval; Masa 10: brand new.
  live(17, async () => { const v = visitAt('Masa 07'); await serve([await staffEntry(v, waiters.garson, [line('203', 2, sel(['garnish', 'rice'])), line('601', 2)])], { preparing: T(15), ready: T(4) }, 'ready'); });
  live(9, async () => { const v = visitAt('Masa 09'); await serve([await staffEntry(v, waiters.garson2, [line('302', 1, sel(['doneness', 'well'], ['extra', 'patty'])), line('402', 1, [], { note: 'Sos ayrı gelsin' }), line('603', 2)])], { preparing: T(7) }, 'preparing'); });
  live(4, async () => { const v = visitAt('Masa 12'), guest = new Client('Misafir'); await scan(guest, v.table); await wait(T(2)); await qrEntry(v, guest, [line('102', 1, sel(['portion', 'half'])), line('401', 1)]); });
  live(2, async () => { const v = visitAt('Masa 10'); await staffEntry(v, waiters.garson, [line('205', 1, sel(['side', 'rice']), { note: 'Ekmek gelmesin' }), line('601', 1)]); });
  // The counter: paid and ready to hand over, two in the kitchen, one just entered.
  live(30, () => takeawayVisit([line('201', 2, sel(['heat', 'mild'], ['garnish', 'rice'])), line('601', 2)], { label: 'Ahmet', paidFirst: true, until: 'ready', at: { preparing: T(28), ready: T(6) }, by: cashier }));
  live(22, () => takeawayVisit([line('301', 2, sel(['doneness', 'medium']), { note: 'Turşusuz' }), line('602', 2)], { label: 'Selin', paidFirst: false, until: 'preparing', at: { preparing: T(20) }, by: cashier }));
  live(14, () => takeawayVisit([line('101', 1, sel(['portion', 'full'])), line('303', 1)], { label: undefined, paidFirst: false, until: 'ready', at: { preparing: T(12), ready: T(3) }, by: owner }));
  live(3, () => takeawayVisit([line('202', 1, sel(['garnish', 'bulgur'])), line('604', 1)], { label: 'Murat', paidFirst: false, until: 'new', by: cashier }));
} else if (sector === 'dessert') {
  live(65, async () => { const p = product('403'); await call(owner, '/staff/products', { requestId: id(), id: p.id, product: { ...fieldsOf(p), soldOut: true } }); await refreshMenu(); });
  live(70, async () => { const v = visitAt('Masa 11'); await serve([await staffEntry(v, waiters.garson, [line('104', 2, sel(['service', 'plain'])), line('601', 2)])], { preparing: T(66), ready: T(60), served: T(58) }); await wait(T(5)); await settle(v, false, 'full'); });
  live(40, async () => {
    const v = visitAt('Masa 02');
    await serve([await staffEntry(v, waiters.garson2, [line('201', 1), line('602', 1, sel(['sugar', 'medium'])), line('103', 1, [], { grams: 250 })])], { preparing: T(38), ready: T(32), served: T(30) });
    await wait(T(6)); const items = await call(cashier, `/staff/accounts/${v.account}/items`), mine = (items.items as { orderId: string; lineId: string; unitPrice: number; remaining: number }[]).slice(0, 1);
    await pay(v, cashier, { version: items.version }, 'card', mine[0].unitPrice, mine.map(i => ({ orderId: i.orderId, lineId: i.lineId, quantity: i.remaining })));
  });
  live(36, async () => { const v = visitAt('Masa 03'), guest = new Client('Misafir'); v.guests = [guest]; await scan(guest, v.table); await wait(T(35)); await serve([await qrEntry(v, guest, [line('302', 1), line('603', 1)])], { review: T(34), preparing: T(32), ready: T(27), served: T(25) }); await wait(T(2)); await guest.request('/guest/call', { requestId: id(), kind: 'bill' }); });
  live(15, async () => { const v = visitAt('Masa 07'); await serve([await staffEntry(v, waiters.garson, [line('203', 2), line('601', 2)])], { preparing: T(13), ready: T(4) }, 'ready'); });
  live(8, async () => { const v = visitAt('Masa 09'); await serve([await staffEntry(v, waiters.garson2, [line('101', 1, [], { grams: 250, note: 'Ayrı tabakta' }), line('601', 1)])], { preparing: T(6) }, 'preparing'); });
  live(4, async () => { const v = visitAt('Masa 12'), guest = new Client('Misafir'); await scan(guest, v.table); await wait(T(2)); await qrEntry(v, guest, [line('301', 1), line('604', 1)]); });
  live(2, async () => { const v = visitAt('Masa 10'); await staffEntry(v, waiters.garson, [line('104', 1, sel(['service', 'icecream'])), line('602', 2, sel(['sugar', 'none']))]); });
  // The counter: a gift box ready to pay, a mixed box and a birthday cake paid in advance, one just weighed.
  live(26, () => takeawayVisit([line('101', 1, sel(['box', 'gift']), { grams: 1000 })], { label: 'Elif', paidFirst: false, until: 'ready', at: { preparing: T(24), ready: T(8) }, by: cashier }));
  live(18, () => takeawayVisit([line('502', 1, sel(['box', 'gift']), { grams: 500 }), line('401', 1, [], { grams: 750 })], { label: 'Can', paidFirst: true, until: 'preparing', at: { preparing: T(15) }, by: cashier }));
  live(12, () => takeawayVisit([line('303', 1, sel(['flavour', 'fruit']), { note: 'Pasta üstü: İyi ki doğdun!' })], { label: 'Hande', paidFirst: true, until: 'preparing', at: { preparing: T(9) }, by: owner }));
  live(2, () => takeawayVisit([line('102', 1, sel(['box', 'gift']), { grams: 2000 })], { label: undefined, paidFirst: false, until: 'new', by: cashier }));
} else {
live(65, async () => { const p = product('52'); await call(owner, '/staff/products', { requestId: id(), id: p.id, product: { ...fieldsOf(p), soldOut: true } }); await refreshMenu(); });
// Masa 11: paid a few minutes ago and still waiting to be cleaned.
live(70, async () => {
  const v = visitAt('Masa 11');
  await serve([await staffEntry(v, waiters.garson, lines(['21', 2], ['45', 1]))], { preparing: T(66), ready: T(58), served: T(56) });
  await wait(T(5)); await settle(v, false, 'full');
});
// Masa 02 → Masa 06: moved to the window, second round served, one friend has already paid their part.
live(52, async () => {
  const v = visitAt('Masa 02'), by = waiters.garson2;
  await serve([await staffEntry(v, by, lines(['17', 1, sel(['size', 'regular'], ['milk', 'oat'])], ['19', 1, sel(['sugar', 'medium'])], ['55', 1]))], { preparing: T(49), ready: T(40), served: T(38) });
  await wait(T(30));
  const target = table('Masa 06'), info = await call(cashier, `/staff/accounts/${v.account}/items`);
  await call(by, '/staff/tables/move', { requestId: id(), accountId: v.account, version: info.version, targetId: target.id, targetEpoch: target.epoch });
  const source = v.table; afterClose(source); target.epoch++; v.table = target; for (const t of v.tickets) t.v++;
  await wait(T(27)); await clean(source, by);
  await wait(T(20));
  await serve([await staffEntry(v, by, lines(['42', 1, sel(['service', 'icecream'])], ['21', 2]))], { preparing: T(18), ready: T(12), served: T(10) });
  await wait(T(6));
  const items = (await call(cashier, `/staff/accounts/${v.account}/items`));
  const mine = (items.items as { orderId: string; lineId: string; unitPrice: number; remaining: number }[]).slice(0, 1);
  await pay(v, cashier, { version: items.version }, 'card', mine[0].unitPrice * mine[0].remaining, mine.map(i => ({ orderId: i.orderId, lineId: i.lineId, quantity: i.remaining })));
});
// Masa 03: QR order served, the guest has just asked for the bill.
live(42, async () => {
  const v = visitAt('Masa 03'), guest = new Client('Misafir'); v.guests = [guest];
  await scan(guest, v.table); await wait(T(41));
  await serve([await qrEntry(v, guest, lines(['24', 1, sel(['size', 'large'])], ['33', 1, sel(['size', 'regular'])], ['44', 2]))], { review: T(40), preparing: T(38), ready: T(31), served: T(29) });
  await wait(T(2)); await guest.request('/guest/call', { requestId: id(), kind: 'bill' });
});
// Masa 07: ready at the pass, waiting for the waiter.
live(17, async () => { const v = visitAt('Masa 07'); await serve([await staffEntry(v, waiters.garson, lines(['50', 2], ['21', 4]))], { preparing: T(15), ready: T(4) }, 'ready'); });
// Masa 13: QR order in preparation, the guest asked to cancel it.
live(16, async () => {
  const v = visitAt('Masa 13'), guest = new Client('Misafir'); v.guests = [guest];
  await scan(guest, v.table); await wait(T(15));
  const t = await qrEntry(v, guest, lines(['47', 1, sel(['service', 'plain'])], ['28', 2, sel(['sugar', 'little'])]));
  await serve([t], { review: T(14), preparing: T(12) }, 'preparing');
  await wait(T(2)); await guest.request('/guest/cancel', { requestId: id(), orderId: t.id, version: t.v, guestContext: guest.context });
});
// Masa 09: in preparation.
live(9, async () => { const v = visitAt('Masa 09'); await serve([await staffEntry(v, waiters.garson2, lines(['23', 2, sel(['size', 'regular'])], ['56', 1], ['57', 1]))], { preparing: T(7) }, 'preparing'); });
// Masa 12: QR order waiting for the waiter's approval.
live(4, async () => { const v = visitAt('Masa 12'), guest = new Client('Misafir'); await scan(guest, v.table); await wait(T(2)); await qrEntry(v, guest, lines(['32', 2, sel(['size', 'regular'])], ['46', 1])); });
// Masa 15: guests just sat down and called the waiter.
live(3, async () => { const t = table('Masa 15'), guest = new Client('Misafir'); await scan(guest, t); await wait(T(1)); await guest.request('/guest/call', { requestId: id(), kind: 'waiter' }); });
// Masa 10: a brand new order from the waiter.
live(2, async () => { const v = visitAt('Masa 10'); await staffEntry(v, waiters.garson, lines(['19', 2, sel(['sugar', 'none'])], ['21', 1])); });
}
try { await runQueue(); } catch (e) { await shutdown(); throw e; }

// ---- 4. Sanity check through the same reports the owner sees ----
clock = Math.max(clock, Date.now());
const to = ymd(clock), from = ymd(clock - 29 * DAY);
const money = (k: number) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(k / 100)} TL`;
const financial = await call(owner, `/staff/reports/financial?from=${from}&to=${to}`);
const employees = await call(owner, `/staff/reports/employees?from=${from}&to=${to}`);
const campaignReport = await call(owner, '/staff/reports/campaigns');
const history = await call(owner, `/staff/payment-adjustments?from=${from}&to=${to}&filter=corrected`);
const state = await call(owner, '/staff/state');
await link.sync();
const platform = await merkez('/state');
// The owner's auto lock back to its default for the café that opens this folder (it was off only while generating).
for (const t of [mainTenant, otherTenant]) store.mutate(t, s => { delete s.ownerLockMinutes; });
await shutdown();

const orders = state.orders as { status: string; cancelRequested: boolean }[];
const open = (state.tables as { account: unknown; needsCleaning?: boolean }[]).filter(t => t.account).length;
const dirty = (state.tables as { needsCleaning?: boolean }[]).filter(t => t.needsCleaning).length;
const count = (status: string) => orders.filter(o => o.status === status).length;
const reported = campaignReport.campaigns as { ongoing: boolean; startsAt: string }[];
const ongoing = reported.filter(c => c.ongoing).length, scheduled = reported.filter(c => Date.parse(c.startsAt) > clock).length;
const license = platform.businesses.find((l: { tenantId: string }) => l.tenantId === mainTenant);
const warnings = [
  financial.orderCount < 100 && 'Finans raporunda beklenenden az sipariş var.',
  employees.rows.filter((r: { orders: number }) => r.orders > 0).length < 4 && 'Çalışan raporunda az satır var.',
  campaignReport.campaigns.length < 3 && 'Kampanya raporu eksik.',
  open < 6 && 'Canlı salonda beklenenden az açık masa var.',
  !license?.active && 'Lisans aktif görünmüyor.',
  sector !== 'cafe' && (state.takeaways?.length ?? 0) < 3 && 'Canlı masasız sipariş şeridinde beklenenden az sipariş var.',
].filter(Boolean);
// Restaurant and dessert shop: counter sales and weighed sweets get their own lines (the café output stays as it was).
const tickets = (state.takeaways ?? []) as { name: string }[], weighed = (state.orders as { lines: { grams?: number }[] }[]).flatMap(o => o.lines).filter(l => l.grams).length;
const sectorLines = sector === 'cafe' ? '' : `\nMasasız satış: son ${days + 1} günde ${stats.takeaways} sipariş · canlı şeritte ${tickets.length} (${tickets.map(t => t.name).join(', ')})${sector === 'dessert' ? ` · canlı kiloyla satır ${weighed}` : ''}`;
const published = (state.products as Product[]).filter(p => p.published !== false);
console.log(`
Örnek işletme hazır: ${directory}
İşletme: ${state.name} (${mainTenant}; diğer: ${otherTenant}) · kurulum #${installId.slice(0, 8)} · lisans ${license?.active ? `aktif, ${license.daysRemaining} gün` : 'PASİF'}
Menü: ${published.length} yayında ürün (${published.filter(p => p.soldOut).length} tükendi, ${state.newProductIds.length} yeni), ${(state.products as Product[]).length - published.length} taslak ürün, ${state.productDrafts.length} düzenleme taslağı, ${state.categories.length} kategori
Masalar: ${state.tables.length} (İç salon, Bahçe, Teras) · açık hesap ${open} · temizlik bekleyen ${dirty}
Son 30 gün (${from} – ${to}): ${financial.orderCount} sipariş, ${financial.cancelledCount} iptal, ${stats.visits} ziyaret
  Tahsilat ${money(financial.collected)} (nakit ${money(financial.cash)}, kart ${money(financial.card)}, POS komisyonu ${money(financial.commission)})
  Gider ${money(financial.expenseTotal)} (${financial.expenses.length} kayıt) · iade ${money(financial.refundTotal)} · düzeltilen tahsilat ${history.total}
  Kampanyalı satış ${money(financial.campaignOrderAmount)}, verilen indirim ${money(financial.campaignDiscount)}
  QR siparişi ${employees.selfService.qrOrders} (paketlensin ${stats.packed}), personel siparişi ${employees.selfService.staffOrders} · masa taşıma ${stats.moves}, hesap birleştirme ${stats.merges}, ret ${stats.rejects}, iptal talebi reddi ${stats.declines}
Kampanyalar: ${reported.length} (${reported.length - ongoing - scheduled} bitti, ${ongoing} sürüyor, ${scheduled} planlı)
Canlı: onay bekleyen ${count('awaiting_approval')}, yeni ${count('new')}, hazırlanıyor ${count('preparing')}, hazır ${count('ready')}, iptal talebi ${orders.filter(o => o.cancelRequested).length}, garson çağrısı/hesap isteği ${state.serviceCalls.length}${sectorLines}
Mola Yönetim (${merkezUrl}): ${platform.businesses.length} işletme, ${platform.tickets.length} destek talebi

Girişler (şifre hepsinde: ${DEMO_PASSWORD}):
  isletme (işletme sahibi), kasiyer, garson, garson2, mutfak · eski çalışan: burak (pasif)
  Diğer işletme: diger (Harput Kahve Evi) · Mola Yönetim'de etkinleştirme bekleyen: Kampüs Kahve
  Mola Yönetim: ${merkezUrl} (kullanıcı admin)
Açmak için (PowerShell): $env:DATA_DIR="${directory}"; $env:MOLA_MERKEZ_URL="${merkezUrl}"; npm.cmd run dev`);
if (warnings.length) { console.warn(`\nUyarı:\n- ${warnings.join('\n- ')}`); process.exitCode = 1; }

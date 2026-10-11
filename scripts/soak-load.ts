// Soak/load measurement against an ALREADY RUNNING test server (never a café's live server):
// 10 staff tablets polling /api/staff/state, a kitchen screen, 20 guest menus polling /api/guest/state, a waiter/kitchen/
// cashier loop placing and settling real orders and the owner opening every report range. The server's folder must be
// activated (npm run merkez:import); the vendor's panel is on Mola Merkez now and is not measured here.
// Prints p50/p95 per endpoint and the server's memory over time. Usage:
//   npx tsx scripts/soak-load.ts --base=http://127.0.0.1:3310 --data=.local/tests/soak --pid=1234 [--dakika=10]
import { readFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEMO_PASSWORD } from '../server/accounts.js';

const arg = (name: string, fallback?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = arg('base')!, data = resolve(arg('data')!), pid = Number(arg('pid')), minutes = Number(arg('dakika', '10'));
if (!base || /:(3000|3001)\b/.test(base)) { console.error('Yalnız ayrı bir test sunucusu (3000/3001 değil).'); process.exit(1); }
const until = Date.now() + minutes * 60_000;
const times = new Map<string, number[]>(); let failures = 0; const errors = new Map<string, number>();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = (ms: number) => ms * (0.7 + Math.random() * 0.6);

class Client {
  jar = new Map<string, string>(); session = '';
  async call(label: string, path: string, body?: unknown): Promise<any> {
    const started = performance.now();
    const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(this.session ? { 'X-Guest-Session': this.session } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); this.jar.set(k, v); }
    const text = await response.text(); const elapsed = performance.now() - started;
    (times.get(label) ?? times.set(label, []).get(label)!).push(elapsed);
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) { failures++; const k = `${label} ${response.status} ${json.code ?? ''}`; errors.set(k, (errors.get(k) ?? 0) + 1); throw Object.assign(new Error(k), { status: response.status }); }
    if (typeof json.session === 'string') this.session = json.session;
    return json;
  }
}
async function staff(username: string) { const c = new Client(); await c.call('login', '/login', { username, password: DEMO_PASSWORD }); return c; }
const loop = async (fn: () => Promise<void>, every: number) => { while (Date.now() < until) { try { await fn(); } catch { /* counted */ } await sleep(jitter(every)); } };

const tabletUsers = ['garson', 'garson', 'garson', 'garson2', 'garson2', 'garson2', 'kasiyer', 'kasiyer', 'isletme', 'garson'];
const tablets = await Promise.all(tabletUsers.map(staff));
const kitchen = await staff('mutfak'), waiter = await staff('garson'), cashier = await staff('kasiyer'), owner = await staff('isletme');
const first = await owner.call('staff/state', '/staff/state');
const guests = await Promise.all(Array.from({ length: 20 }, async (_, i) => { const g = new Client(); const t = first.tables[i % first.tables.length]; const r = await g.call('guest/session', '/guest/session', { token: t.token }); return { g, tableId: r.tableId as string, context: r.guestContext as string }; }));

// Floor loop: open free tables, cook, serve, pay and clean, like a busy evening (~1 visit every 20-30 s).
const products = (first.products as any[]).filter(p => p.published !== false && !p.soldOut && !p.discounts?.length && p.groups.every((g: any) => !g.required));
async function floor() {
  const s = await waiter.call('staff/state', '/staff/state');
  const free = (s.tables as any[]).filter(t => !t.account && !t.needsCleaning);
  if (free.length > 4) {
    const t = free[Math.floor(Math.random() * free.length)], lines = [products[Math.floor(Math.random() * products.length)], products[Math.floor(Math.random() * products.length)]].map(p => ({ productId: p.id, quantity: 1, selections: [] }));
    const expectedTotal = lines.reduce((n, l) => n + products.find(p => p.id === l.productId).price, 0);
    await waiter.call('POST staff/orders', '/staff/orders', { requestId: randomUUID(), tableId: t.id, lines, expectedTotal });
  }
  for (const t of (s.tables as any[]).filter(t => t.needsCleaning)) await waiter.call('POST tables/clean', '/staff/tables/clean', { requestId: randomUUID(), tableId: t.id, epoch: t.epoch }).catch(() => {});
  for (const o of (s.orders as any[]).filter(o => o.status === 'awaiting_approval')) await waiter.call('POST orders/review', '/staff/orders/review', { requestId: randomUUID(), orderId: o.id, version: o.version, approve: true }).catch(() => {});
}
async function cook() {
  const s = await kitchen.call('staff/state (kitchen)', '/staff/state');
  const next: Record<string, string> = { new: 'preparing', preparing: 'ready', ready: 'served' };
  const o = (s.orders as any[]).find(o => next[o.status] && !o.cancelRequested && Date.now() - Date.parse(o.createdAt) > 65_000);
  if (o) await kitchen.call('POST staff/status', '/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: next[o.status] });
}
async function pay() {
  const s = await cashier.call('staff/state', '/staff/state');
  const t = (s.tables as any[]).find(t => t.account && t.account.balance > 0 && (s.orders as any[]).filter(o => o.accountId === t.account.id).every(o => ['served', 'cancelled'].includes(o.status)));
  if (!t) return;
  const items = await cashier.call('GET accounts/items', `/staff/accounts/${t.account.id}/items`);
  await cashier.call('POST staff/payments', '/staff/payments', { requestId: randomUUID(), accountId: t.account.id, version: items.version, method: Math.random() < 0.6 ? 'card' : 'cash', amount: t.account.balance, tendered: t.account.balance });
}
const ymd = (t: number) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const ranges: [string, string, string][] = [['bugün', ymd(Date.now()), ymd(Date.now())], ['7g', ymd(Date.now() - 6 * 86400_000), ymd(Date.now())], ['30g', ymd(Date.now() - 29 * 86400_000), ymd(Date.now())], ['365g', ymd(Date.now() - 365 * 86400_000), ymd(Date.now())], ['tümü', 'all', 'all']];
let reportRound = 0;
async function reports() {
  const [label, from, to] = ranges[reportRound++ % ranges.length];
  for (const kind of ['overview', 'products', 'financial', 'employees']) await owner.call(`reports/${kind} ${label}`, `/staff/reports/${kind}?from=${from}&to=${to}`);
  await owner.call('reports/campaigns', '/staff/reports/campaigns');
  // The payment statement covers at most 31 days; longer report periods ask it for the last 30.
  const ledgerFrom = from === 'all' || Date.parse(to) - Date.parse(from) > 30 * 86400_000 ? ymd(Date.now() - 29 * 86400_000) : from;
  await owner.call(`payment-adjustments ${label}`, `/staff/payment-adjustments?from=${ledgerFrom}&to=${ymd(Date.now())}&filter=all`);
}
const memory: { minute: number; rssMb: number }[] = [];
const started = Date.now();
function rss() {
  if (!pid) return;
  try { const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' }); memory.push({ minute: Math.round((Date.now() - started) / 6000) / 10, rssMb: Math.round(Number(out.trim()) / 1048576) }); } catch { /* gone */ }
}
const fileMb = (name: string) => existsSync(join(data, name)) ? Math.round(statSync(join(data, name)).size / 104857.6) / 10 : 0;
const files: { minute: number; dbMb: number; walMb: number }[] = [];
rss();
await Promise.all([
  ...tablets.map(t => loop(async () => { await t.call('staff/state', '/staff/state'); }, 3000)),
  loop(async () => { await kitchen.call('staff/state (kitchen)', '/staff/state'); }, 3000),
  ...guests.map(({ g }) => loop(async () => { await g.call('guest/state', '/guest/state'); }, 4000)),
  // A few guests also order from their phones (waiter approval is on in the demo business).
  ...guests.slice(0, 3).map(({ g, tableId, context }) => loop(async () => { const p = products[Math.floor(Math.random() * products.length)]; await g.call('POST guest/orders', '/guest/orders', { requestId: randomUUID(), tableId, lines: [{ productId: p.id, quantity: 1, selections: [] }], expectedTotal: p.price, guestContext: context }); }, 90_000)),
  loop(floor, 20_000), loop(cook, 4000), loop(pay, 15_000),
  loop(reports, 20_000),
  loop(async () => { rss(); files.push({ minute: Math.round((Date.now() - started) / 6000) / 10, dbMb: fileMb('merchant.sqlite'), walMb: fileMb('merchant.sqlite-wal') }); }, 30_000),
]);
const pct = (list: number[], p: number) => list[Math.min(list.length - 1, Math.floor(list.length * p))];
const table = [...times].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => { list.sort((a, b) => a - b); return { endpoint: label, n: list.length, p50: Math.round(pct(list, 0.5) * 10) / 10, p95: Math.round(pct(list, 0.95) * 10) / 10, max: Math.round(list.at(-1)!) }; });
console.table(table);
console.log(JSON.stringify({ failures, errors: Object.fromEntries(errors), memory, files }, null, 1));

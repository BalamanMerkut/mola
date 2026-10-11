// "5 yıllık hız ve hata testi", step 2: the real server on the five-year folder made by scripts/bes-yil-testi.ts, measured
// with realistic HTTP traffic (staff tablets, kitchen screen, guests' phones, the owner's reports), killed hard twice in the
// middle of a busy minute, then checked offline: the server's books against the generator's own (beklenen.json), backup and
// restore, e-mail and phone reports. Throwaway folders only; ports 3400 (café) and 3490 (an absent Merkez).
//
//   npx tsx scripts/bes-yil-testi.ts canli --profil=yogun      (first: today's floor up to now)
//   npx tsx scripts/bes-yil-olcum.ts --profil=yogun [--kok=<klasör>] [--dakika=6] [--hiz=4] [--zayif] [--atla=yedek,kapat]
//
// --zayif: the server runs on 2 CPU cores at below-normal priority (a weak café PC, roughly). Results: <kök>/<profil>/olcum*.json.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_PASSWORD } from '../server/accounts.js';
import { quote } from '../packages/domain/engine.js';
import { addDays, businessDay, dayStart } from '../packages/domain/business-day.js';
import type { CartLine, Product } from '../packages/domain/types.js';
import type { Profile } from './bes-yil-veri.js';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
// --harici: the server is already running on the port (a profiling run); it is never started or killed here.
const external = args.includes('--harici');
const profile = option('profil', 'orta') as Profile, weak = args.includes('--zayif'), cold = args.includes('--soguk'), minutes = Number(option('dakika', '6')), speed = Number(option('hiz', '4'));
const skip = new Set((option('atla', '') ?? '').split(',').filter(Boolean));
const root = resolve(option('kok', join(tmpdir(), 'mola-bes-yil'))!), home = join(root, profile), directory = join(home, 'veri');
// --port=3500: the test port of other work on this computer (Merkez address PORT+90, absent either way).
const PORT = Number(option('port', '3400')), base = `http://127.0.0.1:${PORT}`, MERKEZ_PORT = PORT + 90;
if (!existsSync(join(home, 'BES_YIL_TESTI.txt'))) { console.error(`Önce üretin: npx tsx scripts/bes-yil-testi.ts uret --profil=${profile}`); process.exit(1); }
if (PORT !== 3400 && PORT !== 3500) { console.error('Yalnız 3400 ya da 3500 portu (başka kurulumlara dokunmamak için).'); process.exit(1); }
type DayBook = Record<string, number>;
const expected = JSON.parse(readFileSync(join(home, 'beklenen.json'), 'utf8')) as { firstDay: string; lastDay: string; today: string; days: Record<string, DayBook>; onHand: Record<string, number>; staff: { username: string; role: string; active: boolean }[]; oldPayments: { id: string; day: string }[]; stockAt?: string };
const results: Record<string, unknown> = { profile, weak, minutes, speed, startedAt: new Date().toISOString(), machine: machine() };
const out = join(home, `olcum${weak ? '-zayif' : ''}${cold ? '-soguk' : ''}${external ? '-harici' : ''}.json`);
const save = () => writeFileSync(out, JSON.stringify(results, null, 1));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pct = (list: number[], p: number) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10; };
/** A tablet's waits (/api/health) over one phase: p50/p95/p99 and the longest, ms. */
const waitsOf = (list: number[]) => ({ n: list.length, p50: pct(list, 0.5), p95: pct(list, 0.95), p99: pct(list, 0.99), max: Math.round(Math.max(0, ...list)), over500: list.filter(x => x > 500).length });
/** Every phase's tablet waits, for the summary (docs/HIZ_TESTI_5_YIL.md "Zayıf bilgisayar son kontrol"). */
const phaseWaits: Record<string, ReturnType<typeof waitsOf>> = {};
const log = (text: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
function machine() {
  try {
    const cpu = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor).Name; (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors; [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)'], { encoding: 'utf8' }).trim().split(/\r?\n/);
    return { cpu: cpu[0]?.trim(), threads: Number(cpu[1]), ramGb: Number(cpu[2]), node: process.version };
  } catch { return { node: process.version }; }
}

// ---- The server process ----
let server: ChildProcess | undefined, serverPid = 0, logFile = join(home, `sunucu${weak ? '-zayif' : ''}.log`);
const serverLog = createWriteStream(logFile, { flags: 'a' });
function listener() {
  try { return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; }
}
function startServer() {
  if (external) return Date.now();
  if (listener()) throw new Error(`Port ${PORT} kullanımda.`);
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: directory, SERVE_BUILD: '1', MOLA_CLEAN_INSTALL: '1', MOLA_MERKEZ_URL: `http://127.0.0.1:${MERKEZ_PORT}`, MOLA_MERKEZ_PUBLIC_KEY: join(home, 'merkez-acik-anahtar.txt'),
    BACKUP_DIR: join(home, 'yedekler'), BACKUP_KEY_DIR: join(home, 'yedek-anahtarlari'), BACKUP_CHECK_DIR: join(home, 'yedek-provasi'), MOLA_SUNUCU_YEDEGI: '0', MOLA_BACKUP_DISCOVERY: '0', NODE_OPTIONS: '' };
  const node = [process.execPath, '--import', 'tsx', 'server/index.ts'];
  // A weak café PC, roughly: two cores and below-normal priority from the first instruction (Windows "start").
  server = weak ? spawn('cmd.exe', ['/c', 'start', '""', '/b', '/wait', '/affinity', '3', '/belownormal', ...node], { env, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(node[0], node.slice(1), { env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverLog.write(`\n==== start ${new Date().toISOString()} ====\n`);
  server.stdout!.on('data', d => serverLog.write(d)); server.stderr!.on('data', d => serverLog.write(d));
  return Date.now();
}
async function waitHealthy(started: number) {
  for (;;) { try { if ((await fetch(`${base}/api/health`)).ok) return Date.now() - started; } catch { /* starting */ } if (Date.now() - started > 600_000) throw new Error('Sunucu açılmadı.'); await sleep(50); }
}
function kill() {
  if (external) return;
  const pid = listener() || server?.pid;
  if (pid) try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  if (server?.pid) try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  server = undefined; serverPid = 0;
}
async function stopped() { for (let i = 0; i < 100 && listener(); i++) await sleep(100); await sleep(500); }
function proc() {
  if (!serverPid) serverPid = listener();
  try {
    const [ws, priv, cpu] = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p=Get-Process -Id ${serverPid}; $p.WorkingSet64; $p.PrivateMemorySize64; $p.TotalProcessorTime.TotalSeconds`], { encoding: 'utf8' }).trim().split(/\r?\n/).map(Number);
    return { rssMb: Math.round(ws / 1048576), privateMb: Math.round(priv / 1048576), cpuSeconds: Math.round(cpu * 10) / 10 };
  } catch { return { rssMb: 0, privateMb: 0, cpuSeconds: 0 }; }
}

// ---- HTTP clients with timings ----
const timings = new Map<string, { ms: number[]; bytes: number[]; errors: Map<string, number> }>();
let phase = 'start';
/** The request a client started last (which one a long wait fell into). */
let lastCall = '';
/** Waits over 300 ms outside the workloads: when, how long, during which request. */
const longWaits: string[] = [];
const bucket = (label: string) => { const k = `${phase} · ${label}`; let b = timings.get(k); if (!b) timings.set(k, b = { ms: [], bytes: [], errors: new Map() }); return b; };
class Client {
  jar = new Map<string, string>(); session = ''; tag = '';
  constructor(public name: string) {}
  async call(label: string, path: string, body?: unknown, o: { tag?: boolean; raw?: boolean; record?: boolean } = {}) {
    const started = performance.now(); lastCall = `${label} ${new Date().toISOString().slice(11, 23)}`;
    const response = await fetch(`${base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(this.session ? { 'X-Guest-Session': this.session } : {}), ...(o.tag && this.tag ? { 'X-Mola-Tag': this.tag } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie()) { const [k, v] = value.split(';')[0].split('='); this.jar.set(k, v); }
    const buffer = Buffer.from(await response.arrayBuffer()), ms = performance.now() - started, b = bucket(label);
    if (o.record !== false) { b.ms.push(ms); b.bytes.push(buffer.length); }
    if (o.tag) this.tag = response.headers.get('X-Mola-Tag') ?? this.tag;
    let data: any = null;
    if (!o.raw && buffer.length && (response.headers.get('content-type') ?? '').includes('json')) data = JSON.parse(buffer.toString('utf8'));
    if (!response.ok) { const k = `${response.status} ${data?.code ?? ''}`; b.errors.set(k, (b.errors.get(k) ?? 0) + 1); }
    if (data && typeof data.session === 'string') this.session = data.session;
    return { status: response.status, data, ms, bytes: buffer.length, buffer };
  }
}
async function login(username: string) { const c = new Client(username); const r = await c.call('POST login', '/login', { username, password: DEMO_PASSWORD }); if (r.status !== 200) throw new Error(`Giriş olmadı: ${username} ${r.status} ${JSON.stringify(r.data)}`); return c; }
const active = (role: string) => expected.staff.filter(u => u.active && u.role === role).map(u => u.username);

// ---- Workload: a busy hour, `speed` times faster ----
type Ack = { kind: 'order' | 'payment'; requestId: string; body: unknown; path: string; id: string; by: Client; tableId?: string; amount?: number };
const acks: Ack[] = [];
let stop = false;
const kitchenSeen = new Map<string, number>(), created = new Map<string, number>(), kitchenLag: number[] = [];
function cart(products: Product[], n: number, pick: () => number): CartLine[] {
  const usable = products.filter(p => p.published !== false && !p.soldOut && p.unit !== 'kg');
  return Array.from({ length: n }, () => { const p = usable[Math.floor(pick() * usable.length)]; return { productId: p.id, quantity: 1, selections: p.groups.filter(g => g.required).map(g => ({ groupId: g.id, optionId: g.options[0].id })) }; });
}
const ctx = () => ({ now: new Date(), id: randomUUID });
async function ensureShift(c: Client, owner: Client) {
  const me = await c.call('GET shifts/me', '/staff/shifts/me', undefined, { record: false });
  if (!me.data?.required || me.data?.open) return;
  const code = await owner.call('GET shifts/code', '/staff/shifts/code', undefined, { record: false });
  const r = await c.call('POST shifts/start', '/staff/shifts/start', { code: code.data?.code });
  if (r.status !== 200) log(`Vardiya başlatılamadı (${c.name}): ${r.status} ${JSON.stringify(r.data)}`);
}
async function loop(fn: () => Promise<void>, every: number) {
  while (!stop) {
    try { await fn(); } catch (e) { bucket('istemci hatası').errors.set(String(e).slice(0, 80), (bucket('istemci hatası').errors.get(String(e).slice(0, 80)) ?? 0) + 1); }
    // Short steps, so a phase ends on time.
    for (let left = every * (0.7 + Math.random() * 0.6); left > 0 && !stop; left -= 250) await sleep(Math.min(250, left));
  }
}
/** The last workload's /api/health samples with their start times (a backup's window inside it). */
let lastHealth: { at: number; ms: number }[] = [];
async function workload(label: string, ms: number, rate: number, people: { owner: Client; waiters: Client[]; cashiers: Client[]; kitchen: Client; tablets: Client[]; guests: { c: Client; tableId: string; context: string }[] }, extra: (() => Promise<void>)[] = []) {
  phase = label; stop = false; lastHealth = [];
  const perMinute = (profile === 'yogun' ? 60 : 18) / 60 * speed * rate, rnd = Math.random;
  const { owner, waiters, cashiers, kitchen, tablets, guests } = people;
  const health: number[] = [];
  const memory: ReturnType<typeof proc>[] = [];
  const t0 = Date.now();
  const tasks = [
    // Tablets showing Masalar: every 3 s, unchanged answers come back as 204.
    ...tablets.map(t => loop(async () => { await t.call('GET staff/state (tablet)', '/staff/state', undefined, { tag: true }); }, 3000)),
    ...guests.map(g => loop(async () => { await g.c.call('GET guest/state', '/guest/state'); }, 4000)),
    // A few guests order from their phones.
    ...guests.slice(0, 4).map(g => loop(async () => {
      const s = (await g.c.call('GET guest/state', '/guest/state')).data; if (!s?.products) return;
      const lines = cart(s.products, 1 + Math.floor(rnd() * 2), rnd), expectedTotal = quote(s.products, lines, ctx()).reduce((n, l) => n + l.total, 0);
      const r = await g.c.call('POST guest/orders', '/guest/orders', { requestId: randomUUID(), tableId: g.tableId, lines, expectedTotal, guestContext: g.context });
      if (r.status === 200) created.set(r.data.orderId, Date.now());
    }, 60_000 / Math.max(0.2, perMinute / 4))),
    // Waiters: a new table now and then, a second round on open ones, serve what is ready, clean.
    ...waiters.map(w => loop(async () => {
      const s = (await w.call('GET staff/state (garson)', '/staff/state')).data; if (!s?.tables) return;
      for (const o of (s.orders as any[]).filter(o => o.status === 'ready').slice(0, 2)) await w.call('POST status served', '/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: 'served' });
      for (const t of (s.tables as any[]).filter(t => t.needsCleaning).slice(0, 2)) await w.call('POST tables/clean', '/staff/tables/clean', { requestId: randomUUID(), tableId: t.id, epoch: t.epoch });
      const free = (s.tables as any[]).filter(t => !t.account && !t.needsCleaning), busy = (s.tables as any[]).filter(t => t.account);
      const table = free.length > 3 && rnd() < 0.7 ? free[Math.floor(rnd() * free.length)] : busy[Math.floor(rnd() * busy.length)];
      if (!table) return;
      const lines = cart(s.products, 2 + Math.floor(rnd() * 3), rnd), expectedTotal = quote(s.products, lines, ctx()).reduce((n, l) => n + l.total, 0), requestId = randomUUID();
      const body = { requestId, tableId: table.id, lines, expectedTotal };
      const r = await w.call('POST staff/orders', '/staff/orders', body);
      if (r.status === 200) { created.set(r.data.orderId, Date.now()); acks.push({ kind: 'order', requestId, body, path: '/staff/orders', id: r.data.orderId, by: w, tableId: table.id }); }
    }, 60_000 * waiters.length / perMinute)),
    // The kitchen screen: every 2.5 s; one step per order and round.
    loop(async () => {
      const s = (await kitchen.call('GET staff/state (mutfak)', '/staff/state')).data; if (!s?.orders) return;
      const now = Date.now();
      for (const o of s.orders as any[]) if (!kitchenSeen.has(o.id)) { kitchenSeen.set(o.id, now); const c = created.get(o.id); if (c) kitchenLag.push(now - c); }
      const next = (s.orders as any[]).find(o => (o.status === 'new' && (!o.editableUntil || Date.parse(o.editableUntil) < now) && now - kitchenSeen.get(o.id)! > 20_000) || (o.status === 'preparing' && now - kitchenSeen.get(o.id)! > 60_000));
      if (next) await kitchen.call(`POST status ${next.status === 'new' ? 'preparing' : 'ready'}`, '/staff/status', { requestId: randomUUID(), orderId: next.id, version: next.version, status: next.status === 'new' ? 'preparing' : 'ready' });
    }, 2500),
    // Cashiers: a table whose orders are all served pays (cash or card).
    ...cashiers.map(c => loop(async () => {
      const s = (await c.call('GET staff/state (kasa)', '/staff/state')).data; if (!s?.tables) return;
      const served = (t: any) => (s.orders as any[]).filter(o => o.accountId === t.account.id).every(o => ['served', 'cancelled'].includes(o.status));
      const t = (s.tables as any[]).filter(t => t.account && t.account.balance > 0 && served(t))[Math.floor(rnd() * 3)];
      if (!t) return;
      const items = await c.call('GET accounts/items', `/staff/accounts/${t.account.id}/items`);
      if (items.status !== 200) return;
      const method = rnd() < 0.6 ? 'card' : 'cash', amount = t.account.balance, requestId = randomUUID();
      const body = { requestId, accountId: t.account.id, version: items.data.version, method, amount, tendered: method === 'cash' ? Math.ceil(amount / 5000) * 5000 : amount };
      const r = await c.call('POST staff/payments', '/staff/payments', body);
      if (r.status === 200) acks.push({ kind: 'payment', requestId, body, path: '/staff/payments', id: r.data.paymentId, by: c, amount });
    }, 60_000 * cashiers.length / perMinute)),
    // The owner looks at today's numbers now and then.
    loop(async () => { const today = businessDay(Date.now()); await owner.call('GET reports/overview (bugün)', `/staff/reports/overview?from=${today}&to=${today}`); }, 30_000),
    // How long a trivial request waits: the server's freezes (backup checks, summaries, history passes) show here.
    loop(async () => { const at = Date.now(), t = performance.now(); await fetch(`${base}/api/health`); const ms = performance.now() - t; health.push(ms); lastHealth.push({ at, ms }); if (ms > 300) longWaits.push(`${new Date(at).toISOString().slice(11, 23)} ${Math.round(ms)} ms (${label})`); }, 500),
    loop(async () => { memory.push(proc()); }, 15_000),
    ...extra.map(fn => fn()),
  ];
  await sleep(ms); stop = true; await Promise.allSettled(tasks);
  return { seconds: Math.round((Date.now() - t0) / 1000), health: { p50: pct(health, 0.5), p95: pct(health, 0.95), p99: pct(health, 0.99), max: Math.round(Math.max(0, ...health)), over250ms: health.filter(x => x > 250).length, over1s: health.filter(x => x > 1000).length, samples: health.length }, memory, kitchenSeenMs: { p50: pct(kitchenLag, 0.5), p95: pct(kitchenLag, 0.95) } };
}
/** The kill test's rush: every waiter opens a table and orders, a cashier takes the whole bill at once, as fast as answered. */
async function rush(ms: number, people: { waiters: Client[]; cashiers: Client[] }) {
  const end = Date.now() + ms;
  const worker = async (w: Client, c: Client) => {
    while (Date.now() < end) {
      try {
        const s = (await c.call('GET staff/state (kasa)', '/staff/state')).data;
        const free = ((s?.tables ?? []) as any[]).filter(t => !t.account && !t.needsCleaning);
        // Tables the rush paid wait for cleaning: the waiter clears them like on a real evening.
        if (!free.length) { for (const t of ((s?.tables ?? []) as any[]).filter(t => t.needsCleaning && !t.account).slice(0, 3)) await w.call('POST tables/clean', '/staff/tables/clean', { requestId: randomUUID(), tableId: t.id, epoch: t.epoch }); await sleep(300); continue; }
        const table = free[Math.floor(Math.random() * free.length)], lines = cart(s.products, 2, Math.random), expectedTotal = quote(s.products, lines, ctx()).reduce((n, l) => n + l.total, 0);
        const order = { requestId: randomUUID(), tableId: table.id, lines, expectedTotal }, r = await w.call('POST staff/orders', '/staff/orders', order);
        if (r.status !== 200) continue;
        acks.push({ kind: 'order', requestId: order.requestId, body: order, path: '/staff/orders', id: r.data.orderId, by: w, tableId: table.id });
        const items = await c.call('GET accounts/items', `/staff/accounts/${r.data.accountId}/items`);
        if (items.status !== 200) continue;
        const payment = { requestId: randomUUID(), accountId: r.data.accountId, version: items.data.version, method: 'card', amount: expectedTotal, tendered: expectedTotal }, p = await c.call('POST staff/payments', '/staff/payments', payment);
        if (p.status === 200) acks.push({ kind: 'payment', requestId: payment.requestId, body: payment, path: '/staff/payments', id: p.data.paymentId, by: c, amount: expectedTotal });
      } catch { await sleep(100); }
    }
  };
  await Promise.all(people.waiters.map((w, i) => worker(w, people.cashiers[i % people.cashiers.length])));
}
function table(prefix: string) {
  return [...timings].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ endpoint: k.slice(prefix.length + 3), n: v.ms.length, p50: pct(v.ms, 0.5), p95: pct(v.ms, 0.95), p99: pct(v.ms, 0.99), max: Math.round(Math.max(0, ...v.ms)), kb: Math.round(pct(v.bytes, 0.5) / 102.4) / 10, errors: Object.fromEntries(v.errors) })).sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

async function people(owner: Client) {
  const waiters = await Promise.all(active('waiter').slice(0, profile === 'yogun' ? 4 : 2).map(login));
  const cashiers = await Promise.all(active('cashier').map(login));
  const kitchen = await login(active('kitchen')[0]);
  // Ten staff devices in all, polling Masalar: the extra tablets sign in as the same waiters (several tablets per person is common).
  const tablets = await Promise.all(Array.from({ length: 10 - waiters.length - cashiers.length - 1 }, (_, i) => login(active('waiter')[i % active('waiter').length])));
  for (const c of [...waiters, ...cashiers, kitchen, ...tablets]) await ensureShift(c, owner);
  const s = (await owner.call('GET staff/state (sahip)', '/staff/state')).data;
  const guests = await Promise.all((s.tables as any[]).slice(0, 20).map(async t => { const g = new Client('misafir'); const r = await g.call('POST guest/session', '/guest/session', { token: t.token }); return { c: g, tableId: r.data.tableId as string, context: r.data.guestContext as string }; }));
  return { owner, waiters, cashiers, kitchen, tablets, guests };
}

// ---- The run ----
async function main() {
  const steps: Record<string, unknown> = {};
  results.steps = steps;
  // 1. Cold start: health, first sign-in, first Masalar.
  // --soguk: as after an update that changes the day summaries' format (SUMMARY_VERSION): none of them is stored yet.
  if (cold) { const db = new DatabaseSync(join(directory, 'merchant.sqlite')); try { db.exec('DELETE FROM history_days; DELETE FROM history_payment_days; PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); } }
  phase = 'açılış'; log(`Sunucu açılıyor (${profile}${weak ? ', zayıf PC' : ''})…`);
  const t0 = startServer(), healthy = await waitHealthy(t0);
  const owner = await login('isletme'); const first = await owner.call('GET staff/state (ilk)', '/staff/state');
  const guestOwner = (first.data.tables as any[])[0];
  const g = new Client('misafir'); const gs = await g.call('POST guest/session (ilk)', '/guest/session', { token: guestOwner.token }); const gm = await g.call('GET guest/state (ilk menü)', '/guest/state');
  steps.coldStart = { healthMs: healthy, firstStaffStateMs: Math.round(Date.now() - t0), staffStateKb: Math.round(first.bytes / 102.4) / 10, staffStateMs: Math.round(first.ms), guestMenuKb: Math.round(gm.bytes / 102.4) / 10, guestMenuMs: Math.round(gm.ms + gs.ms), openTables: (first.data.tables as any[]).filter(t => t.account).length, liveOrders: (first.data.orders as any[]).length, ...proc() };
  log(`Açıldı: ${JSON.stringify(steps.coldStart)}`); save();

  // 2. Start-of-day workload while the server's own background work runs (summaries, the catch-up backup after 2 minutes).
  const crowd = await people(owner);
  let backupSeen: { at: number; lastSuccessAt: string | null }[] = [];
  const backupWatch = async () => { while (!stop) { const r = await owner.call('GET backup-status', '/staff/backup-status', undefined, { record: false }); backupSeen.push({ at: Date.now(), lastSuccessAt: r.data?.lastSuccessAt ?? null }); await sleep(5000); } };
  log(`Yük A (açılış + arka plan işleri) ${minutes} dk…`);
  const a = await workload('A', minutes * 60_000, 1, crowd, [backupWatch]);
  const backupDone = backupSeen.find(b => b.lastSuccessAt);
  steps.workloadA = { ...a, endpoints: table('A'), backupFinishedAfterStartSec: backupDone ? Math.round((Date.parse(backupDone.lastSuccessAt!) - t0) / 1000) : null };
  phaseWaits['A · açılış ve servis'] = waitsOf(lastHealth.map(h => h.ms));
  // The catch-up backup (the nightly one, two minutes after a start with an old backup) runs inside A: its own window.
  if (backupDone) { const end = Date.parse(backupDone.lastSuccessAt!), from = t0 + 115_000; phaseWaits['A · gece yedeği sürerken (servis devam)'] = waitsOf(lastHealth.filter(h => h.at >= from && h.at <= end).map(h => h.ms)); }
  log(`Yük A bitti: ${JSON.stringify(a.health)}`); save();

  const today = businessDay(Date.now());
  if (!skip.has('rapor')) {
    // 3. Reports: every range, first (cold) and second (warm) time.
    phase = 'rapor'; log('Raporlar…');
    // A tablet's view of the server meanwhile: how long the longest freeze lasts while reports are computed.
    const freeze: number[] = []; let reporting = true, sub = 'raporlar (Tümü, yıl, Kârlılık, rezervasyon Tümü)';
    const freezeBy: Record<string, number[]> = {};
    const watcher = (async () => { while (reporting) { const at = new Date().toISOString().slice(11, 23), during = lastCall, t = performance.now(); try { await fetch(`${base}/api/health`); } catch { /* */ } const w = performance.now() - t; (sub.startsWith('raporlar') ? freeze : []).push(w); (freezeBy[sub] ??= []).push(w); if (w > 300) longWaits.push(`${at} ${Math.round(w)} ms (${sub}; ${during})`); await sleep(250); } })();
    const ranges: [string, string, string][] = [['bugün', today, today], ['7 gün', addDays(today, -6), today], ['30 gün', addDays(today, -29), today], ['1 yıl', addDays(today, -364), today], ['tümü', 'all', 'all'], ['4 yıl önce bir ay', addDays(today, -4 * 365 - 29), addDays(today, -4 * 365)]];
    const reportRows: Record<string, unknown>[] = [];
    for (const [name, from, to] of ranges) for (const round of ['ilk', 'ikinci']) {
      const row: Record<string, unknown> = { range: name, round };
      for (const kind of ['overview', 'products', 'financial', 'employees', 'profit', 'staff-shifts', 'reservations', 'cash-closings', 'simple']) {
        const r = await owner.call(`GET reports/${kind}`, `/staff/reports/${kind}?from=${from}&to=${to}`);
        row[kind] = r.status === 200 ? Math.round(r.ms) : `${r.status} ${r.data?.code ?? ''}`;
      }
      reportRows.push(row); log(`  ${name} (${round}): ${JSON.stringify(row)}`);
    }
    const camp = await owner.call('GET reports/campaigns', '/staff/reports/campaigns');
    steps.reports = { rows: reportRows, campaignsMs: Math.round(camp.ms), tabletWaitDuringReports: { p50: pct(freeze, 0.5), p95: pct(freeze, 0.95), p99: pct(freeze, 0.99), max: Math.round(Math.max(0, ...freeze)), over1s: freeze.filter(x => x > 1000).length } };
    // Exports: a month and a year (Excel, printable page, PDF).
    sub = 'dışa aktarma (Excel ay/yıl/Tümü, sayfa, PDF)';
    const exportsOut: Record<string, unknown>[] = [];
    for (const [name, from, to] of [['ay', addDays(today, -29), today], ['yıl', addDays(today, -364), today], ['tümü', 'all', 'all']] as const) {
      const xl = await owner.call('GET accountant.xlsx', `/staff/reports/accountant.xlsx?from=${from}&to=${to}`, undefined, { raw: true });
      const doc = await owner.call('GET document', `/staff/reports/document?from=${from}&to=${to}&view=summary`, undefined, { raw: true });
      const prod = await owner.call('GET document products', `/staff/reports/document?from=${from}&to=${to}&view=products`, undefined, { raw: true });
      const pdf = await owner.call('GET document.pdf', `/staff/reports/document.pdf?from=${from}&to=${to}&view=summary`, undefined, { raw: true });
      exportsOut.push({ range: name, xlsxMs: Math.round(xl.ms), xlsxKb: Math.round(xl.bytes / 1024), xlsxStatus: xl.status, htmlMs: Math.round(doc.ms), productsHtmlMs: Math.round(prod.ms), pdfMs: Math.round(pdf.ms), pdfKb: Math.round(pdf.bytes / 1024), pdfStatus: pdf.status });
      if (name === 'yıl' && xl.status === 200) writeFileSync(join(home, 'yillik-muhasebe.xlsx'), xl.buffer);
    }
    steps.exports = exportsOut; log(`Dışa aktarma: ${JSON.stringify(exportsOut)}`);
    sub = 'stok ve geçmiş ekranları (4 yıl önceki hesap ve iadesi)';
    // Stock: "≈ N adet yapılabilir" and the low-stock check, against the generator's own stock book.
    const stock = await owner.call('GET stock', '/staff/stock'), stock2 = await owner.call('GET stock', '/staff/stock');
    const items = (stock.data?.items ?? []) as { id: string; name: string; stock: number }[];
    const diffs = items.map(i => ({ name: i.name, server: i.stock, script: expected.onHand[i.id] ?? 0, diff: i.stock - (expected.onHand[i.id] ?? 0) })).filter(x => Math.abs(x.diff) > 1e-6 * Math.max(1, Math.abs(x.script)));
    steps.stock = { firstMs: Math.round(stock.ms), secondMs: Math.round(stock2.ms), items: items.length, makeable: Object.values(stock.data?.products ?? {}).filter((p: any) => p.status !== 'none').length, negative: items.filter(i => i.stock < 0).map(i => i.name), mismatches: diffs.length, mismatchSample: diffs.slice(0, 5), note: 'The script\'s book is from canli\'s end; the workload since then used stock too, so small differences on busy items are expected here: the exact check is in the offline step.' };
    // History screens: a payment from four years ago, a day's list from then, a search over 30 days, a year's totals.
    const oldDay = addDays(today, -4 * 365), hist: Record<string, unknown> = {};
    const day = await owner.call('GET ledger (4 yıl önce)', `/staff/payment-adjustments?from=${oldDay}&to=${oldDay}&filter=all`);
    const old = day.data?.rows?.[0] ? { id: day.data.rows[0].id as string, day: oldDay } : undefined;
    if (old) {
      const detail = await owner.call('GET payment detail (4 yıl önce)', `/staff/payment-adjustments/${encodeURIComponent(old.id)}`);
      const refundView = await owner.call('GET refund window (4 yıl önce)', `/staff/payment-adjustments/${encodeURIComponent(old.id)}/refund`);
      const refund = refundView.status === 200 ? await owner.call('POST refund (4 yıl önce)', '/staff/payment-adjustments', { requestId: randomUUID(), paymentId: old.id, revision: refundView.data.payment.revision, amount: Math.min(1000, refundView.data.payment.refundable), method: refundView.data.payment.method === 'card' ? 'card' : 'cash', kind: 'refund', commission: 0, reason: 'Hız testi: eski hesaba iade.' }) : undefined;
      hist.oldDay = { day: old.day, ms: Math.round(day.ms), rows: day.data?.rows?.length, status: day.status };
      hist.oldPayment = { ms: Math.round(detail.ms), status: detail.status, refundWindowMs: Math.round(refundView.ms), refundStatus: refund?.status, refundMs: refund && Math.round(refund.ms), refundAnswer: refund && refund.status !== 200 ? refund.data : undefined };
    }
    const search = await owner.call('GET ledger search 30 gün', `/staff/payment-adjustments?from=${addDays(today, -29)}&to=${today}&filter=all&q=${encodeURIComponent('Masa 07')}`);
    const totals = await owner.call('GET ledger totals 1 yıl', `/staff/payment-adjustments/totals?from=${addDays(today, -364)}&to=${today}&filter=all`);
    const totalsAll = await owner.call('GET ledger totals 5 yıl', `/staff/payment-adjustments/totals?from=${expected.firstDay}&to=${today}&filter=all`);
    hist.search30 = { ms: Math.round(search.ms), rows: search.data?.rows?.length, next: !!search.data?.next }; hist.totalsYearMs = Math.round(totals.ms); hist.totalsAllMs = Math.round(totalsAll.ms); hist.totalsAllStatus = totalsAll.status;
    const agenda = await owner.call('GET agenda (ay)', `/staff/agenda?from=${addDays(today, -30)}&to=${addDays(today, 30)}`);
    const res = await owner.call('GET reservations (60 gün)', `/staff/reservations?from=${addDays(today, -30)}&to=${addDays(today, 30)}`);
    const notes = await owner.call('GET notifications', '/staff/notifications');
    hist.agendaMs = Math.round(agenda.ms); hist.reservationsMs = Math.round(res.ms); hist.notificationsMs = Math.round(notes.ms);
    steps.history = hist; log(`Geçmiş ekranları: ${JSON.stringify(hist)}`);
    reporting = false; await watcher;
    for (const [name, list] of Object.entries(freezeBy)) phaseWaits[name] = waitsOf(list);
    save();
  }

  // 4. Steady busy hour: everything warm now.
  log(`Yük B (sıcak, yoğun saat) ${minutes} dk…`);
  const b = await workload('B', minutes * 60_000, 1, crowd);
  steps.workloadB = { ...b, endpoints: table('B') }; log(`Yük B bitti: ${JSON.stringify(b.health)}`);
  phaseWaits['B · yoğun servis (sıcak)'] = waitsOf(lastHealth.map(h => h.ms)); save();

  // 5. Gün sonu on this busy day: the blind count and the result; tablets keep asking meanwhile.
  phase = 'gün sonu';
  const tabletWaits = (into: number[]) => { let on = true; const done = (async () => { while (on) { const t = performance.now(); try { await fetch(`${base}/api/health`); } catch { /* */ } into.push(performance.now() - t); await sleep(250); } })(); return async () => { on = false; await done; }; };
  const closeWaits: number[] = [], endClose = tabletWaits(closeWaits);
  const cashier = crowd.cashiers[0];
  const status = await cashier.call('GET cash/status', '/staff/cash/status');
  const count = await cashier.call('POST cash/count', '/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 250000, pos: null });
  const finish = count.status === 200 ? await cashier.call('POST cash/finish', '/staff/cash/finish', { id: count.data.id, note: 'Hız testi sayımı', left: 100000 }) : undefined;
  const closings = await owner.call('GET reports/cash-closings', `/staff/reports/cash-closings?from=${today}&to=${today}`);
  await endClose(); phaseWaits['gün sonu (sayım, kapanış)'] = waitsOf(closeWaits);
  steps.dayClose = { statusMs: Math.round(status.ms), countMs: Math.round(count.ms), countStatus: count.status, countError: count.status !== 200 ? count.data : undefined, finishMs: finish && Math.round(finish.ms), finishStatus: finish?.status, closingsMs: Math.round(closings.ms) };
  log(`Gün sonu: ${JSON.stringify(steps.dayClose)}`); save();
  // The gün sonu backup (a minute later; the same verified backup as the nightly one): tablets and a waiter meanwhile.
  if (finish?.status === 200 && !skip.has('yedek')) {
    phase = 'gün sonu yedeği';
    const before = (await owner.call('GET backup-status', '/staff/backup-status', undefined, { record: false })).data?.lastSuccessAt ?? null;
    const backupWaits: number[] = [], endBackup = tabletWaits(backupWaits), started = Date.now();
    stop = false;
    const polling = crowd.tablets.slice(0, 4).map(t => loop(async () => { await t.call('GET staff/state (tablet)', '/staff/state', undefined, { tag: true }); }, 3000));
    let after: string | null = before;
    while (after === before && Date.now() - started < 15 * 60_000) { await sleep(2000); after = (await owner.call('GET backup-status', '/staff/backup-status', undefined, { record: false })).data?.lastSuccessAt ?? null; }
    stop = true; await Promise.allSettled(polling); await endBackup();
    phaseWaits['gün sonu yedeği (doğrulanmış, gece yedeğiyle aynı iş)'] = waitsOf(backupWaits);
    steps.dayCloseBackup = { finishedAfterSec: after !== before ? Math.round((Date.parse(after!) - started) / 1000) : null, tabletStates: table('gün sonu yedeği') };
    log(`Gün sonu yedeği: ${JSON.stringify(steps.dayCloseBackup)}`); save();
  }

  // 6. Hard kill in the middle of a burst, twice: nothing acknowledged may be lost or doubled.
  if (!skip.has('kapat') && !external) {
    const kills: unknown[] = [];
    // The gün sonu above ended everyone's shift (vardiya takibi): they start again, as after a real closing.
    for (const c of [...crowd.waiters, ...crowd.cashiers]) await ensureShift(c, crowd.owner);
    for (let k = 0; k < 2; k++) {
      phase = `kill-${k + 1}`; acks.length = 0;
      const burst = rush(30_000, crowd);
      await sleep(10_000 + k * 3000);
      const before = acks.length, at = Date.now();
      kill(); log(`Sunucu zorla kapatıldı (${before} onaylı işlem).`);
      await burst.catch(() => {});
      await stopped();
      const t1 = startServer(), up = await waitHealthy(t1);
      const again = await login('isletme'); const s = (await again.call('GET staff/state', '/staff/state')).data;
      // Every acknowledged order is still there (live or in history) and a repeat of the same request changes nothing.
      const live = new Set((s.orders as any[]).map(o => o.id));
      const repeats = { same: 0, different: 0, failed: 0 };
      for (const ack of acks) {
        // Sign-ins survive a restart (server/sessions.ts); the same device simply sends the same request again.
        let r = await ack.by.call(`POST ${ack.kind} (tekrar)`, ack.path, ack.body);
        if (r.status === 401) { const fresh = await login(ack.by.name); ack.by.jar = fresh.jar; r = await ack.by.call(`POST ${ack.kind} (tekrar)`, ack.path, ack.body); }
        if (r.status !== 200) repeats.failed++; else if ((ack.kind === 'order' ? r.data.orderId : r.data.paymentId) === ack.id) repeats.same++; else repeats.different++;
      }
      const ordersAcked = acks.filter(x => x.kind === 'order'), missing = ordersAcked.filter(x => !live.has(x.id)).length;
      kills.push({ killedAt: new Date(at).toISOString(), acknowledged: acks.length, ordersAcked: ordersAcked.length, paymentsAcked: acks.length - ordersAcked.length, ordersNotOnFloor: missing, repeats, restartHealthyMs: up, ...proc() });
      for (const c of [...crowd.waiters, ...crowd.cashiers, crowd.kitchen, ...crowd.tablets]) { const me = await c.call('GET me', '/staff/me', undefined, { record: false }); if (me.status === 401) { const fresh = await login(c.name); c.jar = fresh.jar; } await ensureShift(c, again); }
      crowd.owner.jar = again.jar;
      log(`Yeniden açıldı: ${JSON.stringify(kills.at(-1))}`);
    }
    steps.kills = kills; save();
  }
  // 7. The server's own error lines.
  phase = 'son'; kill(); await stopped();
  const text = readFileSync(logFile, 'utf8'), lines = text.split(/\r?\n/);
  const bad = lines.filter(l => /error|hata|exception|failed|başarısız|uncaught/i.test(l) && !/ExperimentalWarning/.test(l));
  steps.serverLog = { lines: lines.length, errorLines: bad.length, sample: [...new Set(bad.map(l => l.slice(0, 220)))].slice(0, 15) };
  // The summary: a tablet's waits per phase, and the order and payment latencies of the busy hour.
  const pick = (prefix: string, label: string) => { const v = timings.get(`${prefix} · ${label}`); return v ? waitsOf(v.ms) : null; };
  results.summary = { longWaits, tabletWaits: phaseWaits, orders: { A: pick('A', 'POST staff/orders'), B: pick('B', 'POST staff/orders') }, payments: { A: pick('A', 'POST staff/payments'), B: pick('B', 'POST staff/payments') }, tabletState: { A: pick('A', 'GET staff/state (tablet)'), B: pick('B', 'GET staff/state (tablet)') } };
  log(`Özet: ${JSON.stringify(results.summary)}`);
  results.finishedAt = new Date().toISOString(); save();
  log(`Bitti: ${out}`);
}
/** --tarayici: only the browser screens (scripts/bes-yil-tarayici.spec.ts) on a freshly started server, after its start-up work. */
async function browser() {
  const t0 = startServer(); await waitHealthy(t0);
  log('Sunucu açık; arka plan işleri için 90 sn bekleniyor…'); await sleep(90_000);
  const file = join(home, `tarayici${weak ? '-zayif' : ''}.json`);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', 'scripts/bes-yil-tarayici.config.ts'], { stdio: 'inherit', env: { ...process.env, E2E_PORT: String(PORT), BES_YIL_TARAYICI_OUT: file, ...(weak ? { BES_YIL_CPU_YAVAS: '4' } : {}) } });
  kill(); await stopped();
  log(`Tarayıcı ölçümü ${r.status === 0 ? 'bitti' : 'BAŞARISIZ'}: ${file}`);
}
process.on('SIGINT', () => { kill(); process.exit(130); });
(args.includes('--tarayici') ? browser() : main()).catch(e => { console.error(e); kill(); save(); process.exit(1); });
void statSync; void mkdirSync; void rmSync; void readdirSync; void dayStart;

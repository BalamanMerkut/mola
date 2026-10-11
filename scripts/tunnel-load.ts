// İnternetten menü: how much the guest tunnel through Mola Merkez adds, and how Merkez holds ~50 cafés × 30 guests.
//   npx.cmd tsx scripts/tunnel-load.ts [--sure=30] [--kafe=50] [--misafir=30]
// Everything in a fresh folder under .local/tunnel-yuk/ and on ports 3470 (café) and 3475 (Mola Merkez, its own process with
// the built screens: run `npm.cmd run build` first). Never touches a real install. Measures:
//   1. one guest, one request after another: /api/guest/state straight from the café vs through Mola Merkez (p50/p95/p99)
//   2. load: the real café plus (kafe-1) stand-in cafés (each a tunnel that answers like a café in a few ms), every one with
//      (misafir) guests polling every 2 s like the guest menu does; guests come from many 127.0.0.x addresses (Merkez counts
//      per address); latency through Merkez, Merkez's memory before and after
//   3. the same load while one stand-in café never answers: the other cafés' latency must not move.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { Agent, createServer, request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
process.env.MOLA_AUTO_BACKUP = '0';
const { createApp } = await import('../server/app.js');
const { MerkezLink } = await import('../server/kafe-link.js');
const { publicKeyFrom } = await import('../server/license.js');
const { Store } = await import('../server/store.js');
const { signedHeaders } = await import('../server/install-auth.js');
const { pack, unpack, TUNNEL_PATH } = await import('../server/tunnel-protocol.js');
const { WsSocket } = await import('../server/ws-frames.js');
type GuestTunnel = import('../server/guest-tunnel.js').GuestTunnel;

const arg = (name: string, fallback: number) => Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1]) || fallback;
const SECONDS = arg('sure', 30), CAFES = arg('kafe', 50), GUESTS = arg('misafir', 30);
const KAFE_PORT = 3470, MERKEZ_PORT = 3475, MERKEZ = `http://127.0.0.1:${MERKEZ_PORT}`, PASSWORD = 'Yuk-Testi-Kirmizi!26';
mkdirSync('.local/tunnel-yuk', { recursive: true });
const root = mkdtempSync(resolve('.local/tunnel-yuk/run-'));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pct = (list: number[], p: number) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const ms = (n: number) => `${n.toFixed(1)} ms`;
const rss = (pid: number) => { try { const line = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }); return Number(line.split('","')[4]?.replace(/[^\d]/g, '')) / 1024; } catch { return NaN; } };

// ---------- Mola Merkez in its own process ----------
const merkez = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(MERKEZ_PORT), MERKEZ_DATA_DIR: join(root, 'merkez'), MERKEZ_INITIAL_PASSWORD: PASSWORD, SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0' } });
const stopAll: (() => void)[] = [() => { try { execFileSync('taskkill', ['/pid', String(merkez.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { merkez.kill(); } }];
process.on('exit', () => stopAll.forEach(f => f()));
for (let i = 0; ; i++) { try { if ((await fetch(`${MERKEZ}/api/merkez/v1/health`)).ok) break; } catch { /* starting */ } if (i > 200) throw new Error('Merkez açılmadı'); await sleep(100); }
const login = await fetch(`${MERKEZ}/api/merkez/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASSWORD }) });
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
const admin = async (path: string, body: unknown) => { const r = await fetch(`${MERKEZ}/api/merkez/admin${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${await r.text()}`); return r.json() as Promise<any>; };
const license = { endsAt: new Date(Date.now() + 365 * 86400000).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 };

// ---------- The real café (this process) ----------
const store = new Store(join(root, 'kafe'));
const link = new MerkezLink(store, { url: MERKEZ, publicKey: publicKeyFrom(readFileSync(join(root, 'merkez', 'merkez-public-key.txt'), 'utf8')), machineKey: 'yuk:kasa' });
const tenants = (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
link.adopt(await admin('/import', { requestId: randomUUID().replace(/-/g, ''), businesses: tenants.map(t => ({ tenantId: t, name: store.directoryEntry(t).name, sector: store.directoryEntry(t).sector, license })) }));
const app = createApp(store, undefined, undefined, { lan: false, port: KAFE_PORT, mode: 'installed' }, {}, () => {}, undefined, undefined, undefined, undefined, link);
const kafe = createServer(app); await new Promise<void>(r => kafe.listen(KAFE_PORT, '127.0.0.1', r));
stopAll.unshift(() => { link.stop(); kafe.closeAllConnections(); kafe.close(); });
const tunnel = app.locals.guestTunnel as GuestTunnel; tunnel.serveFrom(resolve('dist'));
await link.sync(); await link.sync();
for (let i = 0; !tunnel.connected(); i++) { if (i > 100) throw new Error('Tünel açılmadı'); await sleep(50); }
const code = link.read()!.tunnel!.codes['mola-demo'], token = store.read('mola-demo').tables[0].token;

// A guest: one keep-alive connection from its own 127.0.0.x address, its own cookie and session.
function guest(base: string, local: string) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 }); let jar = '', session = '';
  return async (path: string, body?: unknown) => {
    const url = new URL(base + path), data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const t0 = performance.now();
    const r = await new Promise<{ status: number; text: string }>((done, fail) => {
      const req = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: data ? 'POST' : 'GET', agent, localAddress: local, headers: { ...(jar ? { cookie: jar } : {}), ...(session ? { 'X-Guest-Session': session } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length), Origin: url.origin } : {}) } }, res => {
        const parts: Buffer[] = []; res.on('data', c => parts.push(c)); res.on('end', () => { for (const c of (res.headers['set-cookie'] ?? [])) jar = c.split(';')[0]; done({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString() }); });
      });
      req.on('error', fail); req.end(data);
    });
    const took = performance.now() - t0;
    if (body !== undefined) try { const j = JSON.parse(r.text); if (j.session) session = j.session; } catch { /* not JSON */ }
    return { ...r, took };
  };
}

// ---------- 1. One guest: straight vs through Mola Merkez ----------
const direct = guest(`http://127.0.0.1:${KAFE_PORT}/api`, '127.0.0.1'), through = guest(`${MERKEZ}/q/${code}`, '127.0.0.1');
if ((await direct('/guest/session', { token })).status !== 200 || (await through('/api/guest/session', { token })).status !== 200) throw new Error('Misafir oturumu açılmadı');
const N = 400, d: number[] = [], m: number[] = [];
for (let i = 0; i < 50; i++) { await direct('/guest/state'); await through('/api/guest/state'); }
for (let i = 0; i < N; i++) { d.push((await direct('/guest/state')).took); m.push((await through('/api/guest/state')).took); }
const page: number[] = []; for (let i = 0; i < 100; i++) page.push((await through(`/${token}`)).took);
const size = (await through('/api/guest/state')).text.length;
console.log(`\n1) Tek misafir, art arda ${N} istek (/api/guest/state, ${(size / 1024).toFixed(1)} KB):`);
console.log(`   doğrudan kafe      p50 ${ms(pct(d, .5))}  p95 ${ms(pct(d, .95))}  p99 ${ms(pct(d, .99))}`);
console.log(`   Mola Merkez üzerinden p50 ${ms(pct(m, .5))}  p95 ${ms(pct(m, .95))}  p99 ${ms(pct(m, .99))}`);
console.log(`   eklenen: p50 +${ms(pct(m, .5) - pct(d, .5))}, p95 +${ms(pct(m, .95) - pct(d, .95))}`);
console.log(`   misafir sayfası (Merkez'in kendi kopyası) p50 ${ms(pct(page, .5))} p95 ${ms(pct(page, .95))}`);

// ---------- 2. Stand-in cafés ----------
type Fake = { install: string; secret: string; code: string; ws?: InstanceType<typeof WsSocket>; delay: number; answered: number };
const fakes: Fake[] = [];
const answer = Buffer.from(JSON.stringify({ name: 'Yük Kafe', products: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Ürün ${i}`, price: 1000 + i, description: 'x'.repeat(80) })) }));
for (let i = 1; i < CAFES; i++) {
  const r = await admin('/import', { requestId: randomUUID().replace(/-/g, ''), businesses: [{ tenantId: `yuk-${i}-${randomBytes(3).toString('hex')}`, name: `Yük Kafe ${i}`, sector: 'cafe', license }] });
  const body = JSON.stringify({ v: 1, appVersion: '0.1.0', sentAt: new Date().toISOString(), businesses: [], backup: { enabled: false, lastSuccessAt: null, failing: false }, failures: [], tickets: [], freezes: [], tunnel: { v: 1 } });
  const s = await fetch(`${MERKEZ}/api/merkez/v1/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signedHeaders(r.installId, r.secret, 'POST', '/api/merkez/v1/sync', body, Date.now()) }, body });
  const sync = await s.json() as { tunnel?: { codes: { code: string }[] } };
  fakes.push({ install: r.installId, secret: r.secret, code: sync.tunnel!.codes[0].code, delay: 0, answered: 0 });
}
async function connect(f: Fake) {
  const key = randomBytes(16).toString('base64');
  f.ws = await new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port: MERKEZ_PORT, path: TUNNEL_PATH, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key, ...signedHeaders(f.install, f.secret, 'GET', TUNNEL_PATH, '', Date.now()) } });
    req.on('upgrade', (_res, socket, head) => done(new WsSocket(socket, 'client', 1 << 20, head))); req.on('response', r => fail(new Error(`tünel ${r.statusCode}`))); req.on('error', fail); req.end();
  });
  f.ws!.send(pack({ t: 'hello', v: 1, app: 'yuk', assets: {} }));
  f.ws!.on('message', (raw: Buffer) => {
    const { head } = unpack(raw); if (head.t !== 'req') return;
    // A café's own work is under a millisecond (measured above); Windows timers are 15 ms coarse, so it answers on the next turn.
    if (f.delay < 1e6) setImmediate(() => { f.answered++; f.ws!.send(pack({ t: 'res', id: head.id, s: 200, h: { 'content-type': 'application/json; charset=utf-8' } }, answer)); });
  });
}
for (const f of fakes) await connect(f);
await sleep(500);

// ---------- 3. Load: every café's guests poll every 2 s ----------
async function load(label: string, seconds: number, slow?: Fake) {
  const real: number[] = [], others: number[] = [], failures = { real: 0, others: 0, slow: 0 }; let n = 0;
  // The first 5 s (1500 connections and sessions opening at once) are not counted.
  const stop = Date.now() + seconds * 1000, warm = Date.now() + 5000, runs: Promise<void>[] = [];
  const everyone = [{ code, real: true }, ...fakes.map(f => ({ code: f.code, real: false, fake: f }))];
  for (const [ci, c] of everyone.entries()) for (let g = 0; g < GUESTS; g++) {
    const addr = `127.0.${1 + ((ci * GUESTS + g) >> 8) % 250}.${2 + (ci * GUESTS + g) % 250}`;
    const call = guest(`${MERKEZ}/q/${c.code}`, addr);
    runs.push((async () => {
      if (c.real) await call('/api/guest/session', { token });
      await sleep(Math.random() * 2000);
      while (Date.now() < stop) {
        const t0 = Date.now();
        try {
          const r = await call('/api/guest/state'); n++;
          const isSlow = 'fake' in c && c.fake === slow;
          if (r.status !== 200) { if (c.real) failures.real++; else if (isSlow) failures.slow++; else failures.others++; }
          else if (Date.now() < warm) { /* warming up */ } else if (c.real) real.push(r.took); else if (!isSlow) others.push(r.took);
        } catch { if (c.real) failures.real++; else failures.others++; }
        await sleep(Math.max(0, 2000 - (Date.now() - t0)));
      }
    })());
  }
  const before = rss(merkez.pid!);
  let peak = before; const watch = setInterval(() => { peak = Math.max(peak, rss(merkez.pid!)); }, 2000);
  await Promise.all(runs); clearInterval(watch);
  console.log(`\n${label}: ${everyone.length} kafe × ${GUESTS} misafir, ${seconds} sn, ${n} istek (${(n / seconds).toFixed(0)}/sn)`);
  console.log(`   gerçek kafe (Merkez üzerinden)  p50 ${ms(pct(real, .5))}  p95 ${ms(pct(real, .95))}  p99 ${ms(pct(real, .99))}  hata ${failures.real}`);
  console.log(`   diğer kafeler                   p50 ${ms(pct(others, .5))}  p95 ${ms(pct(others, .95))}  p99 ${ms(pct(others, .99))}  hata ${failures.others}${slow ? `  (yanıt vermeyen kafe: ${failures.slow} istek zaman aşımı/meşgul)` : ''}`);
  console.log(`   Mola Merkez belleği: başta ${before.toFixed(0)} MB, en çok ${peak.toFixed(0)} MB`);
  return { real, others };
}
await load('2) Yük', SECONDS);
fakes[0].delay = 1e9;
await load('3) Aynı yük, bir kafe hiç yanıt vermiyor', Math.max(25, SECONDS), fakes[0]);
console.log(`\nKlasör: ${root} (silinebilir)`);
for (const f of fakes) f.ws?.destroy();
stopAll.forEach(f => f()); stopAll.length = 0;
store.close();
try { rmSync(root, { recursive: true, force: true }); } catch { /* left for a look */ }
process.exit(0);

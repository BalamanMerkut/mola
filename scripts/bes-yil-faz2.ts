// "5 yıllık hız testi", Faz 2 (aylık ve yıllık özetler, docs/HIZ_TESTI_5_YIL.md): only the owner's long reports, before and
// after, on the five-year folder made by scripts/bes-yil-testi.ts. The real server on port 3500 (Merkez address 3590, absent;
// never the ports of other work), automatic backups off so only the reports are measured. A tablet's view meanwhile: a
// /api/health request every 50 ms, whose longest wait is how long the server held everyone.
//
//   npx tsx scripts/bes-yil-faz2.ts --profil=orta [--kok=<klasör>] [--kaynak=<program klasörü>] [--etiket=sonra] [--soguk] [--isinma]
//
// --kaynak: the program to run (a copy of an older version for the "önce" numbers); default this folder.
// --soguk: monthly and yearly roll-ups deleted first (the first start after this version, or after a format change).
// --gunler-soguk: the day summaries deleted too (as after a SUMMARY_VERSION change, or a folder made by an older generator).
// --isinma: also a second start with the roll-ups deleted, measuring the background build (its time and the longest wait).
// --dogrula: no server; every long report figure from the roll-ups against the same figure read day by day (faz2-dogrulama.json).
// Results: <kök>/<profil>/faz2-<etiket>.json.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_PASSWORD } from '../server/accounts.js';
import { businessDay } from '../packages/domain/business-day.js';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const profile = option('profil', 'orta')!, label = option('etiket', 'sonra')!, cold = args.includes('--soguk'), warmRun = args.includes('--isinma'), coldDays = args.includes('--gunler-soguk');
const root = resolve(option('kok', join(tmpdir(), 'mola-bes-yil'))!), home = join(root, profile), directory = join(home, 'veri'), source = resolve(option('kaynak', '.')!);
const PORT = 3500, base = `http://127.0.0.1:${PORT}`;
if (!existsSync(join(home, 'BES_YIL_TESTI.txt'))) { console.error(`Önce üretin: npx tsx scripts/bes-yil-testi.ts uret --profil=${profile}`); process.exit(1); }
const out = join(home, `faz2-${label}${cold ? '-soguk' : ''}${coldDays ? '-gunler-soguk' : ''}.json`), results: Record<string, unknown> = { profile, label, cold, coldDays, source, startedAt: new Date().toISOString() };
const save = () => writeFileSync(out, JSON.stringify(results, null, 1));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (text: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const pct = (list: number[], p: number) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]); };

let server: ChildProcess | undefined;
const serverLog = createWriteStream(join(home, `sunucu-faz2-${label}.log`), { flags: 'a' });
function listener() { try { return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; } }
function start() {
  if (listener()) throw new Error(`Port ${PORT} kullanımda.`);
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: directory, SERVE_BUILD: '1', MOLA_CLEAN_INSTALL: '1', MOLA_MERKEZ_URL: 'http://127.0.0.1:3590', MOLA_MERKEZ_PUBLIC_KEY: join(home, 'merkez-acik-anahtar.txt'), MOLA_AUTO_BACKUP: '0', MOLA_SUNUCU_YEDEGI: '0', MOLA_BACKUP_DISCOVERY: '0', NODE_OPTIONS: '' };
  // --node=<flag>: one more Node flag for the server (a profiling run: --trace-gc, --cpu-prof).
  server = spawn(process.execPath, [...(option('node') ? [option('node')!] : []), '--import', 'tsx', 'server/index.ts'], { cwd: source, env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverLog.write(`\n==== start ${new Date().toISOString()} ====\n`);
  server.stdout!.on('data', d => serverLog.write(d)); server.stderr!.on('data', d => serverLog.write(d));
  return Date.now();
}
async function healthy(t0: number) { for (;;) { try { if ((await fetch(`${base}/api/health`)).ok) return Date.now() - t0; } catch { /* starting */ } if (Date.now() - t0 > 600_000) throw new Error('Sunucu açılmadı.'); await sleep(50); } }
async function stop() {
  const pid = listener() || server?.pid;
  if (pid) try { execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
  server = undefined; for (let i = 0; i < 100 && listener(); i++) await sleep(100); await sleep(500);
}
function memory() {
  const pid = listener();
  try { const [ws, priv] = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$p=Get-Process -Id ${pid}; $p.WorkingSet64; $p.PrivateMemorySize64`], { encoding: 'utf8' }).trim().split(/\r?\n/).map(Number); return { rssMb: Math.round(ws / 1048576), privateMb: Math.round(priv / 1048576) }; } catch { return null; }
}
/** Deletes the roll-ups (as after a format change; `days`: the day summaries too, as after SUMMARY_VERSION); an older program has no roll-up tables. */
function dropRollups(days = false) {
  const db = new DatabaseSync(join(directory, 'merchant.sqlite'));
  try { for (const t of ['history_months', 'history_years', ...(days ? ['history_days', 'history_payment_days'] : [])]) if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)) db.exec(`DELETE FROM ${t}`); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
}
function rollupCount() {
  const db = new DatabaseSync(join(directory, 'merchant.sqlite'), { readOnly: true });
  try { return ['history_months', 'history_years'].map(t => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t) ? Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n) : 0); } finally { db.close(); }
}

/** The owner's session (cookie) and timed calls. */
let cookie = '';
async function call(path: string) {
  const t = performance.now(), r = await fetch(`${base}/api${path}`, { headers: { Cookie: cookie, 'Content-Type': 'application/json' } });
  const body = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ms: Math.round(performance.now() - t), kb: Math.round(body.length / 102.4) / 10 };
}
async function login() {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'isletme', password: DEMO_PASSWORD }) });
  if (r.status !== 200) throw new Error(`Giriş olmadı: ${r.status}`);
  cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
/** A tablet's view: /api/health every 50 ms while `work` runs; the longest wait is how long the server held every request. */
async function watched<T>(work: () => Promise<T>) {
  const waits: number[] = [], long: string[] = []; let on = true;
  const meter = (async () => { while (on) { const t = performance.now(); try { await fetch(`${base}/api/health`); } catch { /* */ } const w = performance.now() - t; waits.push(w); if (w > 300) long.push(`${new Date().toISOString().slice(11, 23)} ${Math.round(w)} ms`); await sleep(50); } })();
  const result = await work(); on = false; await meter;
  return { result, tablet: { p50: pct(waits, 0.5), p99: pct(waits, 0.99), max: Math.round(Math.max(0, ...waits)), over300: waits.filter(w => w > 300).length, long } };
}

async function main() {
  if (cold || coldDays) dropRollups(coldDays);
  const today = businessDay(Date.now()), year = String(Number(today.slice(0, 4)) - 1);
  log(`Sunucu açılıyor (${profile}, ${label}${cold ? ', özetler silinmiş' : ''}, ${source})…`);
  const t0 = start(); results.healthMs = await healthy(t0); await login();
  // 1. The first "Tümü" right after the start (with --soguk: before any roll-up exists).
  const first = await watched(async () => ({ overview: await call('/staff/reports/overview?from=all&to=all'), simple: await call('/staff/reports/simple?from=all&to=all') }));
  results.firstAfterStart = first; log(`İlk Tümü: ${JSON.stringify(first)}`); save();
  // 2. Every long report, twice.
  const rounds: Record<string, unknown>[] = [];
  const reports: [string, string][] = [
    ['Tümü özet', '/staff/reports/overview?from=all&to=all'], ['Tümü sade özet', '/staff/reports/simple?from=all&to=all'], ['Tümü yıllar', '/staff/reports/years'],
    ['Tümü ürünler', '/staff/reports/products?from=all&to=all'], ['Tümü giderler', '/staff/reports/financial?from=all&to=all'], ['Tümü çalışanlar', '/staff/reports/employees?from=all&to=all'],
    ['Tümü personel ve bahşiş', '/staff/reports/staff-shifts?from=all&to=all'], ['Tümü kasa kapanışları', '/staff/reports/cash-closings?from=all&to=all'], ['Tümü rezervasyon', '/staff/reports/reservations?from=all&to=all'], ['Tümü kârlılık', '/staff/reports/profit?from=all&to=all'],
    [`${year} özet`, `/staff/reports/overview?from=${year}-01-01&to=${year}-12-31`], [`${year} sade özet`, `/staff/reports/simple?from=${year}-01-01&to=${year}-12-31`], [`${year} personel ve bahşiş`, `/staff/reports/staff-shifts?from=${year}-01-01&to=${year}-12-31`], [`${year} kasa kapanışları`, `/staff/reports/cash-closings?from=${year}-01-01&to=${year}-12-31`],
    ['Excel Tümü', '/staff/reports/accountant.xlsx?from=all&to=all'], [`Excel ${year}`, `/staff/reports/accountant.xlsx?from=${year}-01-01&to=${year}-12-31`], ['Yazdır Tümü', '/staff/reports/document?from=all&to=all&view=summary'],
    ['Bugün özet', `/staff/reports/overview?from=${today}&to=${today}`],
  ];
  for (const round of ['ilk', 'ikinci']) {
    const row: Record<string, unknown> = { round };
    const timed = await watched(async () => { for (const [name, path] of reports) { const r = await call(path); row[name] = r.status === 200 ? { ms: r.ms, kb: r.kb } : `${r.status}`; } });
    row.tablet = timed.tablet; rounds.push(row); log(`${round}: ${JSON.stringify(row)}`); save();
  }
  results.rounds = rounds;
  // 3. Memory after the heavy reports.
  results.memoryAfterReports = memory(); log(`Bellek: ${JSON.stringify(results.memoryAfterReports)}`);
  results.rollups = rollupCount(); save();
  await stop();
  // 4. The background build: a start with no roll-ups, nobody asking; how long until every closed month and year is ready.
  if (warmRun) {
    dropRollups();
    const t1 = start(); await healthy(t1); await login();
    const before = rollupCount();
    const warm = await watched(async () => {
      let last = -1, stable = 0, done = 0;
      for (const until = Date.now() + 15 * 60_000; Date.now() < until;) {
        await sleep(2000);
        const [m, y] = rollupCount(), n = m + y;
        if (n > 0 && n === last) { if (++stable >= 5) { done = Date.now() - t1 - 10_000; break; } } else stable = 0;
        last = n;
      }
      return { builtAfterStartMs: done, rows: rollupCount() };
    });
    results.backgroundBuild = { before, ...warm }; log(`Arka plan: ${JSON.stringify(results.backgroundBuild)}`);
    const after = await call('/staff/reports/overview?from=all&to=all'); results.afterBackgroundBuild = after;
    await stop();
  }
  results.finishedAt = new Date().toISOString(); save(); log(`Sonuç: ${out}`);
}
/**
 * --dogrula (server closed): every long report figure from the roll-ups equals the same figure read day by day, on the five
 * years: "Tümü", every year, and random ranges; the store's clock set back is the day-by-day reading (no month is closed).
 */
async function verify() {
  if (cold) dropRollups();
  const { Store } = await import('../server/store.js'), { CashBook } = await import('../server/cash-closing.js'), { ShiftBook } = await import('../server/shifts.js');
  const { overviewFrom, financialFrom, productsFrom, employeeFrom, periodVatOf, reportRange, previousRange } = await import('../packages/domain/reports.js');
  const { addDays, dayStart } = await import('../packages/domain/business-day.js');
  const store = new Store(directory, []), tenant = 'mola-demo', cash = new CashBook(store), shifts = new ShiftBook(store), now = Date.now();
  const s = store.read(tenant), first = store.history.dataBounds(tenant)!.first, real = store.clock;
  const figures = (from: string, to: string) => {
    const { start, end } = reportRange(from, to), span = store.history.reportSpan(tenant, s, start, end), before = previousRange(from, to, now), t = span.total;
    const employees = employeeFrom(t, s.staffUsers, from, to), staff = shifts.staffSpan(tenant, s, from, to, now, cash);
    return JSON.stringify({ overview: overviewFrom({ from, to, start, end, today: businessDay(now), days: span, previous: before && { from: before.from, to: before.to, partial: before.partial, days: store.history.reportSpan(tenant, s, before.start, before.end) }, openBalance: 0, products: s.products }),
      financial: financialFrom(span, from, to, start, end, Number.isFinite(start) ? store.history.adjustments(tenant, start, end) : [], Number.isFinite(start) ? store.history.expenses(tenant, start, end) : []),
      products: productsFrom(span, s.products), employees: employees.rows, qr: [employees.selfService.qrOrders, employees.selfService.staffOrders], vat: periodVatOf(s, t),
      campaigns: [...t.campaigns].map(([k, m]) => [k, [...m]]), variants: [...t.variants].map(([k, m]) => [k, [...m]]), returned: [...t.returned], cash: cash.cashSpan(tenant, from, to),
      staff: [[...staff.users], staff.tips, staff.unassigned('equal'), staff.unassigned('hours'), staff.unassigned('orders')] });
  };
  const today = businessDay(now), ranges: [string, string][] = [['all', 'all']];
  for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) ranges.push([`${y}-01-01`, y === Number(today.slice(0, 4)) ? today : `${y}-12-31`]);
  let seed = 5; const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 12; i++) { const a = addDays(first, Math.floor(random() * 1700)), b = addDays(a, Math.floor(random() * 365)); ranges.push([a, b > today ? today : b]); }
  const out: Record<string, unknown>[] = [];
  for (const [from, to] of ranges) {
    store.clock = real; let t = performance.now(); const rolled = figures(from, to), rolledMs = performance.now() - t;
    store.clock = () => new Date(dayStart(first) - 86400_000); t = performance.now(); const daily = figures(from, to), dailyMs = performance.now() - t;
    store.clock = real;
    out.push({ from, to, same: rolled === daily, rolledMs: Math.round(rolledMs), dailyMs: Math.round(dailyMs) });
    log(`${from}–${to}: ${rolled === daily ? 'aynı' : 'FARKLI'} (özetten ${Math.round(rolledMs)} ms, günlük ${Math.round(dailyMs)} ms)`);
    if (rolled !== daily) writeFileSync(join(home, `faz2-fark-${from}-${to}.json`), JSON.stringify({ rolled: JSON.parse(rolled), daily: JSON.parse(daily) }, null, 1));
  }
  store.close();
  writeFileSync(join(home, 'faz2-dogrulama.json'), JSON.stringify(out, null, 1));
  if (out.some(r => !r.same)) process.exitCode = 1;
}
(args.includes('--dogrula') ? verify() : main()).catch(async error => { console.error(error); await stop(); process.exit(1); });

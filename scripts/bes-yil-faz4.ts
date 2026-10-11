// "5 yıllık hız testi", Faz 4 (yıl paketleri, docs/HIZ_TESTI_5_YIL.md "Faz 4 sonrası"), on the five-year folder made by
// scripts/bes-yil-testi.ts, the server closed (the HTTP report timings: scripts/bes-yil-faz2.ts --etiket=faz4):
//
//   npx tsx scripts/bes-yil-faz4.ts --profil=orta [--kok=<klasör>] once      every figure, live file, backup, restore, upload size
//   npx tsx scripts/bes-yil-faz4.ts --profil=orta [--kok=<klasör>] paketle   every past year sealed (year by year), timed
//   npx tsx scripts/bes-yil-faz4.ts --profil=orta [--kok=<klasör>] sonra     the same figures (to the kuruş), disk, backups, restore, upload
//   npx tsx scripts/bes-yil-faz4.ts --profil=orta [--kok=<klasör>] iade      an old bill (4 years back) found and refunded today, timed
//
// Results: <kök>/<profil>/faz4-<adım>.json (figures: faz4-rakamlar-<adım>.json; a difference: faz4-fark.json).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshotKey, Store } from '../server/store.js';
import { openText } from '../server/sealing.js';
import { PACKAGE_TABLES, rowColumns, rowKey } from '../server/year-packages.js';
import { withoutPersonalData } from '../server/package-privacy.js';
import { CashBook } from '../server/cash-closing.js';
import { ShiftBook } from '../server/shifts.js';
import { StockBook } from '../server/stock.js';
import { ReservationBook } from '../server/reservations.js';
import { YearPacker } from '../server/year-packer.js';
import { createLiveBackup, restoreBackup } from '../server/backup.js';
import { drain } from '../server/history.js';
import { addDays, businessDay } from '../packages/domain/business-day.js';
import { employeeFrom, financialFrom, overviewFrom, periodVatOf, productsFrom, reportRange } from '../packages/domain/reports.js';
import { profitReport } from '../packages/domain/profit.js';
import { stockLevels } from '../packages/domain/stock.js';
import { adjustPayment, refundableItems } from '../packages/domain/payment-adjustments.js';

const args = process.argv.slice(2), step = args.find(a => !a.startsWith('--')) ?? 'once';
const option = (name: string, fallback?: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const profile = option('profil', 'orta')!, root = resolve(option('kok', join(tmpdir(), 'mola-bes-yil'))!), home = join(root, profile), directory = join(home, 'veri');
if (!existsSync(join(home, 'BES_YIL_TESTI.txt'))) { console.error(`Önce üretin: npx tsx scripts/bes-yil-testi.ts uret --profil=${profile}`); process.exit(1); }
const tenant = 'mola-demo', log = (text: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const mb = (n: number) => Math.round(n / 1048576 * 10) / 10;
const folderBytes = (dir: string): number => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? folderBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0) : 0;
const results: Record<string, unknown> = { profile, step, startedAt: new Date().toISOString() };
const save = () => writeFileSync(join(home, `faz4-${step}.json`), JSON.stringify(results, null, 1));
const time = async <T>(work: () => T | Promise<T>) => { const t = performance.now(); const value = await work(); return { value, ms: Math.round(performance.now() - t) }; };

/** Every figure the screens, the accountant's Excel, Kasa, Personel, Stok and Kârlılık read: "Tümü", each year, 12 ranges. */
function figures(store: Store) {
  const cash = new CashBook(store), shifts = new ShiftBook(store), stock = new StockBook(store), reservations = new ReservationBook(store);
  const s = store.read(tenant), now = Date.now(), today = businessDay(now), first = store.history.dataBounds(tenant)!.first;
  const ranges: [string, string][] = [['all', 'all']];
  for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) ranges.push([`${y}-01-01`, y === Number(today.slice(0, 4)) ? today : `${y}-12-31`]);
  let seed = 9; const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 12; i++) { const a = addDays(first, Math.floor(random() * 1700)), b = addDays(a, Math.floor(random() * 365)); ranges.push([a, b > today ? today : b]); }
  // Boundaries: New Year's Eve and Day of each closed year.
  for (let y = Number(first.slice(0, 4)); y < Number(today.slice(0, 4)); y++) ranges.push([`${y}-12-31`, `${y + 1}-01-01`]);
  const out: Record<string, unknown> = {};
  for (const [from, to] of ranges) {
    const { start, end } = reportRange(from, to), span = store.history.reportSpan(tenant, s, start, end), t = span.total, staff = shifts.staffSpan(tenant, s, from, to, now, cash);
    const fromDay = from === 'all' ? '0000-01-01' : from, toDay = to === 'all' ? '9999-12-31' : to;
    out[`${from}:${to}`] = {
      overview: overviewFrom({ from, to, start, end, today, days: span, previous: null, openBalance: 0, products: s.products }),
      financial: financialFrom(span, from, to, start, end, Number.isFinite(start) ? store.history.adjustments(tenant, start, end) : [], Number.isFinite(start) ? store.history.expenses(tenant, start, end) : []),
      products: productsFrom(span, s.products), employees: employeeFrom(t, s.staffUsers, from, to).rows, vat: periodVatOf(s, t),
      cash: cash.cashSpan(tenant, from, to), staff: [[...staff.users], staff.tips], closings: cash.newestClosings(tenant, fromDay, toDay, 62).total,
      ledger: drain(store.history.ledgerTotals(tenant, s, { from, to })), reservations: reservations.reservations(tenant, s, fromDay, toDay).length, events: reservations.events(tenant, s, fromDay, toDay).length,
      expensesListed: store.history.newestLedger(tenant, 'expense', 200).length,
    };
  }
  const days = drain(store.history.reportDaysSteps(tenant, s, -Infinity, Infinity));
  out.profit = profitReport({ from: 'all', to: 'all', days, products: s.products, data: stock.data(tenant), now, margins: s.marginAlerts ?? {}, basis: 'sale' });
  out.stock = [...stockLevels(stock.data(tenant), stock.feed(tenant, s), now)].map(([id, l]) => [id, Math.round(l.stock * 1000) / 1000]).sort();
  out.yearList = store.history.yearList(tenant); out.bounds = store.history.dataBounds(tenant); out.audit = store.history.audit(tenant, 1_000_000).length;
  return JSON.parse(JSON.stringify(out));
}
const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/**
 * Customers' personal data in the packages (server/package-privacy.ts): every row of the tables that can hold some, opened;
 * `left`: rows that still hold some (must be 0), `phones`: a phone number anywhere in them (must be 0).
 */
function privacyScan(store: Store) {
  const out = { rows: 0, left: 0, phones: 0, stripped: {} as Record<string, number>, withoutPrivacy: [] as string[], sample: [] as string[] };
  for (const p of store.packages.list()) {
    if (!p.stripped) out.withoutPrivacy.push(p.year);
    for (const [table, n] of Object.entries(p.stripped ?? {})) out.stripped[table] = (out.stripped[table] ?? 0) + n;
    const db = new DatabaseSync(store.packages.path(p.year), { readOnly: true });
    try {
      for (const spec of PACKAGE_TABLES) {
        if (!spec.private || !spec.scope || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(spec.table)) continue;
        for (const row of db.prepare(`SELECT ${rowColumns(spec)} FROM ${spec.table}`).iterate() as Iterable<Record<string, string> & { payload: Uint8Array }>) {
          out.rows++;
          const json = openText(Buffer.from(row.payload), snapshotKey(store.db, store.key, row.tenant)!, spec.scope(row)).json.toString('utf8');
          if (withoutPersonalData(spec.table, row, JSON.parse(json)) !== undefined) { out.left++; if (out.sample.length < 5) out.sample.push(`${p.year} ${spec.table} ${rowKey(spec, row)}`); }
          if (/0\d{3} \d{3} \d\d \d\d/.test(json)) out.phones++;
        }
      }
    } finally { db.close(); }
  }
  return out;
}
/** What a copy sends to Mola Merkez (server/cloud-backup.ts backupFiles): the folder's files and, once, its year packages. */
function uploadOf(dir: string) {
  const own = readdirSync(dir).filter(n => n !== 'verification.json' && !n.endsWith('.key') && !n.startsWith('.')).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const packages = ((JSON.parse(readFileSync(join(dir, 'complete.json'), 'utf8')) as { packages?: { size: number }[] }).packages ?? []).reduce((n, p) => n + p.size, 0);
  return { once: own + packages, nightly: own };
}

/** A verified-backup run like the scheduler's (create, restore into a proof folder, check), timed, and its upload size. */
async function backups(label: string) {
  const where = join(home, `faz4-yedek-${label}`), keys = join(home, `faz4-anahtar-${label}`);
  const made = await time(() => createLiveBackup(directory, where, keys));
  const dir = made.value.directory, upload = uploadOf(dir).once;
  const proof = await time(() => restoreBackup(dir, made.value.keyPath!, join(home, `faz4-prova-${label}`), { packages: 'check' }));
  rmSync(proof.value.directory, { recursive: true, force: true });
  return { where, keys, dir, keyPath: made.value.keyPath!, backupMs: made.ms, proofMs: proof.ms, folderMb: mb(folderBytes(dir)), yearsMb: mb(folderBytes(join(where, 'yillar'))), uploadMb: mb(upload), packages: made.value.packages };
}
async function restoreTimed(b: { dir: string; keyPath: string }, label: string) {
  const r = await time(() => restoreBackup(b.dir, b.keyPath, join(home, `faz4-geri-${label}`)));
  const size = mb(folderBytes(r.value.directory));
  return { restoreMs: r.ms, restoredMb: size, directory: r.value.directory };
}
const sizes = () => ({ liveMb: mb(statSync(join(directory, 'merchant.sqlite')).size), walMb: existsSync(join(directory, 'merchant.sqlite-wal')) ? mb(statSync(join(directory, 'merchant.sqlite-wal')).size) : 0, packages: readdirSync(directory).filter(n => /^yil-\d{4}\.sqlite$/.test(n)).map(n => [n, mb(statSync(join(directory, n)).size)]) });

async function main() {
  if (step === 'once' || step === 'sonra') {
    let store = new Store(directory, []);
    const f = await time(() => figures(store));
    writeFileSync(join(home, `faz4-rakamlar-${step}.json`), JSON.stringify(f.value));
    results.figuresMs = f.ms; results.figuresHash = hashOf(f.value);
    if (step === 'sonra') {
      const before = JSON.parse(readFileSync(join(home, 'faz4-rakamlar-once.json'), 'utf8'));
      const same = hashOf(before) === hashOf(f.value);
      results.sameAsBefore = same;
      if (!same) {
        const diff: Record<string, unknown> = {};
        for (const k of Object.keys(before)) if (hashOf(before[k]) !== hashOf(f.value[k])) diff[k] = { before: before[k], after: f.value[k] };
        writeFileSync(join(home, 'faz4-fark.json'), JSON.stringify(diff, null, 1)); log(`FARK: ${Object.keys(diff).join(', ')}`);
      } else log('Bütün rakamlar paketlemeden önceki ile aynı.');
      const privacy = await time(() => privacyScan(store));
      results.privacy = { ...privacy.value, ms: privacy.ms };
      log(`Paketlerde kişisel bilgi: ${JSON.stringify(results.privacy)}`);
    }
    store.close();
    results.sizes = sizes(); log(`Boyut: ${JSON.stringify(results.sizes)}`); save();
    const first = await backups(`${step}-1`); log(`Yedek 1: ${JSON.stringify(first)}`);
    const second = await backups(`${step}-2`); log(`Yedek 2 (gece): ${JSON.stringify(second)}`);
    // The second backup into the same folder as the first: the steady state (packages already in yillar/).
    const nightly = await (async () => { const where = first.where; const made = await time(() => createLiveBackup(directory, where, first.keys)); const proof = await time(() => restoreBackup(made.value.directory, made.value.keyPath!, join(home, `faz4-prova-${step}-n`), { packages: 'check' })); rmSync(proof.value.directory, { recursive: true, force: true }); const up = uploadOf(made.value.directory); return { backupMs: made.ms, proofMs: proof.ms, folderMb: mb(folderBytes(made.value.directory)), uploadOnceMb: mb(up.once), uploadNightlyMb: mb(up.nightly), yearsMb: mb(folderBytes(join(where, 'yillar'))) }; })();
    log(`Gece yedeği (aynı klasör): ${JSON.stringify(nightly)}`);
    const restore = await restoreTimed(first, step); log(`Geri yükleme: ${JSON.stringify(restore)}`);
    // The restored folder reads the same figures.
    const back = new Store(restore.directory, []);
    try { results.restoredSame = hashOf(figures(back)) === results.figuresHash; } finally { back.close(); }
    log(`Geri yüklenen klasör aynı rakamları veriyor: ${results.restoredSame}`);
    Object.assign(results, { first: { ...first, where: undefined, keys: undefined, dir: undefined, keyPath: undefined }, second: { ...second, where: undefined, keys: undefined, dir: undefined, keyPath: undefined }, nightly, restore: { ...restore, directory: undefined } });
    for (const d of [first.where, first.keys, second.where, second.keys, restore.directory, join(home, `faz4-geri-${step}`)]) rmSync(d, { recursive: true, force: true });
    for (const n of readdirSync(home)) if (n.startsWith('faz4-prova-') || n.startsWith('faz4-yedek-') || n.startsWith('faz4-anahtar-') || n.startsWith('faz4-geri-')) rmSync(join(home, n), { recursive: true, force: true });
  } else if (step === 'paketle') {
    const store = new Store(directory, []), cash = new CashBook(store), shifts = new ShiftBook(store), stock = new StockBook(store);
    const notes: string[] = [];
    const packer = new YearPacker(store, { prepare: (t, s, from, to) => [cash.prepare(t, from, to), shifts.prepare(t, s, from, to, Date.now(), cash)], opening: (t, s, t0, year) => stock.openYearSteps(t, s, t0, year), notify: (_t, _k, title) => notes.push(title) });
    const years: Record<string, unknown>[] = [];
    // --son=<yıl>: the last year sealed here (the next one is left to the live server: `canli`).
    const last = option('son');
    // Year by year, as the server does after a restore of old data (one run seals every due year; timed per year here).
    for (let year = packer.dueYear(); year && (!last || year <= last); year = packer.dueYear()) {
      const t = performance.now(), st = await packer.run({ one: true });
      years.push({ year, ms: Math.round(performance.now() - t), state: st.state, error: st.error, done: st.done });
      log(`${year}: ${Math.round(performance.now() - t)} ms ${st.state}${st.error ? ` ${st.error}` : ''}`);
      if (st.state !== 'idle') break;
    }
    results.years = years; results.notices = notes; results.packages = store.packages.list().map(p => ({ year: p.year, mb: mb(p.size), counts: p.counts }));
    store.close();
    // The next start gives the emptied pages back (VACUUM).
    const reopen = await time(() => { const s = new Store(directory, []); s.close(); });
    results.reopenMs = reopen.ms; results.sizes = sizes(); log(`Yeniden açılış (VACUUM): ${reopen.ms} ms; ${JSON.stringify(results.sizes)}`);
  } else if (step === 'canli') {
    // The real server (port 3500, Merkez address 3590 absent, no automatic backup) seals the due years by itself, 3 s after its
    // start; a tablet asks /api/health every 50 ms meanwhile: its longest wait is how long packaging held the café.
    const { spawn, execFileSync } = await import('node:child_process'), { DatabaseSync } = await import('node:sqlite');
    const PORT = 3500, base = `http://127.0.0.1:${PORT}`, weak = args.includes('--zayif');
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: directory, SERVE_BUILD: '1', MOLA_CLEAN_INSTALL: '1', MOLA_MERKEZ_URL: 'http://127.0.0.1:3590', MOLA_MERKEZ_PUBLIC_KEY: join(home, 'merkez-acik-anahtar.txt'), MOLA_AUTO_BACKUP: '0', MOLA_SUNUCU_YEDEGI: '0', MOLA_BACKUP_DISCOVERY: '0', MOLA_YIL_PAKETI_MS: '3000', MOLA_YIL_PAKETI_IZ: '1', NODE_OPTIONS: '' };
    // --zayif: a weak café PC, roughly (as scripts/bes-yil-olcum.ts): two logical cores, below-normal priority.
    const node = [process.execPath, '--import', 'tsx', 'server/index.ts'];
    const server = weak ? spawn('cmd.exe', ['/c', 'start', '""', '/b', '/wait', '/affinity', '3', '/belownormal', ...node], { env, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(node[0], node.slice(1), { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const serverLog = (await import('node:fs')).createWriteStream(join(home, `sunucu-faz4-canli${weak ? '-zayif' : ''}.log`), { flags: 'a' });
    server.stdout!.on('data', d => serverLog.write(d)); server.stderr!.on('data', d => serverLog.write(d));
    const t0 = Date.now();
    for (;;) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
    const waits: number[] = [], long: string[] = []; let on = true;
    const meter = (async () => { while (on) { const t = performance.now(); try { await fetch(`${base}/api/health`); } catch { /* */ } const w = performance.now() - t; waits.push(w); if (w > 200) long.push(`${new Date().toISOString().slice(11, 23)} ${Math.round(w)} ms`); await new Promise(r => setTimeout(r, 50)); } })();
    // Three tablets on Masalar meanwhile (signed in as the owner; every 3 s, unchanged answers come back as 204).
    const { DEMO_PASSWORD } = await import('../server/accounts.js');
    const tabletMs: number[] = [];
    const tablets = (await Promise.all([0, 1, 2].map(async () => { const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'isletme', password: DEMO_PASSWORD }) }); return r.ok ? r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') : ''; }))).filter(Boolean);
    const polls = tablets.map(cookie => (async () => { let tag = ''; while (on) { const t = performance.now(); try { const r = await fetch(`${base}/api/staff/state`, { headers: { Cookie: cookie, ...(tag ? { 'X-Mola-Tag': tag } : {}) } }); tag = r.headers.get('X-Mola-Tag') ?? tag; await r.arrayBuffer(); } catch { /* */ } tabletMs.push(performance.now() - t); await new Promise(r => setTimeout(r, 3000)); } })());
    const state = () => { const db = new DatabaseSync(join(directory, 'merchant.sqlite'), { readOnly: true }); try { return { job: !!db.prepare("SELECT 1 FROM history_meta WHERE key='package:job'").get(), packages: (db.prepare("SELECT key FROM history_meta WHERE key GLOB 'package:[0-9][0-9][0-9][0-9]'").all() as { key: string }[]).map(r => r.key.slice(8)) }; } finally { db.close(); } };
    let started = 0, done = 0, last = state();
    for (const until = Date.now() + 30 * 60_000; Date.now() < until; await new Promise(r => setTimeout(r, 500))) {
      last = state();
      if (!started && last.job) started = Date.now();
      if (started && !last.job) { done = Date.now(); break; }
    }
    on = false; await meter; await Promise.all(polls);
    // The server's own listener (with --zayif the process under cmd's "start"), then cmd.
    try { const pid = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`], { encoding: 'utf8' }).trim()); if (pid) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    const stats = (list: number[]) => { const sorted = [...list].sort((a, b) => a - b), at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0); return { requests: list.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Math.round(Math.max(0, ...list)), over200: list.filter(w => w > 200).length, over500: list.filter(w => w > 500).length }; };
    const steps = readFileSync(join(home, `sunucu-faz4-canli${weak ? '-zayif' : ''}.log`), 'utf8').split(/\r?\n/).filter(l => l.includes('[yıl paketi')).slice(-20);
    results.live = { weak, startMs: t0, packagingMs: done && started ? done - started : null, packages: last.packages, tablet: { ...stats(waits), long: long.slice(0, 20) }, masalar: stats(tabletMs), steps };
    log(JSON.stringify(results.live));
  } else if (step === 'iade') {
    // An old bill (about four years back): found through the payment index in its package, its refund window, a refund today.
    const store = new Store(directory, []), s = store.read(tenant), day = addDays(businessDay(Date.now()), -4 * 365);
    const page = await time(() => store.history.paymentLedger(tenant, s, { from: day, to: day, limit: 50 }));
    const row = page.value.rows.find(r => !r.refunded && r.method === 'cash')!;
    const lookup = await time(() => store.history.refundAccount(tenant, s, row.id));
    const items = refundableItems(row.id, lookup.value!);
    const refund = await time(() => store.mutate(tenant, st => { const found = store.history.paymentForAdjustment(tenant, st, row.id); return adjustPayment(st, { tenantId: tenant, id: 'isletme', role: 'owner' }, { requestId: `faz4-${Date.now()}`, paymentId: row.id, revision: found.history.length, kind: 'refund', amount: Math.min(1000, found.payment!.amount), method: 'cash', commission: 0, reason: 'Faz 4 ölçümü' }, { now: new Date(), id: () => `faz4-${Date.now()}` }, { payment: found.payment, history: found.history, account: lookup.value! }); }));
    const today = businessDay(Date.now()), { start, end } = reportRange(today, today);
    results.oldBill = { day, packaged: !!store.packages.holding(day), searchMs: page.ms, lookupMs: lookup.ms, items: items.length, refundMs: refund.ms, closedPeriod: refund.value.closedPeriod ?? false, todayRefunds: store.history.reportSpan(tenant, store.read(tenant), start, end).total.refundTotal };
    log(JSON.stringify(results.oldBill));
    store.close();
  }
  results.finishedAt = new Date().toISOString(); save(); log(`Sonuç: ${join(home, `faz4-${step}.json`)}`);
}
main().catch(error => { console.error(error); process.exit(1); });

// Paket testi (npm run test:paket): the print, PDF and download paths tried on the PACKAGED programs, not on the development
// server. 8 Ekim: the owner's installed Mola Yönetim said "PDF oluşturulamadı" and the café's "A4 yazdır" printed a blank page,
// while every test (development code) passed. This builds the real Windows packages (Mola + Mola Yönetim) into a scratch
// folder, starts them the way Mola.exe does (Mola-Sunucu.cmd / Merkez-Sunucu.cmd: bundled server, its own node.exe, the
// watchdog, SERVE_BUILD) on their own ports and data, and checks:
//   Mola Yönetim / Merkez: İşlem kayıtları PDF (real %PDF from this computer's Edge/Chrome), Excel, JSONL, Yazdır page;
//     Satışlarım PDF / Excel / Yazdır page; a support attachment through the image library (sharp) in the package.
//   Café: Satış ve Raporlar printable page, PDF and the accountant's Excel for several reports; the e-mail report's PDF
//     attachment (fake SMTP on this computer); a cash closing; kitchen test print and the closing's receipt to a fake
//     network printer; a support ticket attachment both ways.
//   Browser (Edge, tests/paket/paket.spec.ts): cash closing "A4 yazdır" prints non-empty content; QR print sheets (6, 12,
//     A6) and the A6 PDF; Yazdır / PDF and Muhasebeci için indir; social QR card PNG / PDF / print; Mola Yönetim's
//     journal PDF + Yazdır and Satışlarım Excel / PDF / Yazdır.
// Never touches an installed Mola or its data (%LOCALAPPDATA%\Mola*): everything lives in .local/e2e/paket-testi.
//
//   npm run test:paket                       build (screens + packages) and test, ~5–10 minutes
//   npm run test:paket -- --hazir            reuse the packages built by the last run (only the café data is new)
//   npm run test:paket -- --arayuz-hazir     reuse dist/ (no `npm run build`)
// Ports: café 3501, Merkez 3591 (PAKET_KAFE_PORT / PAKET_MERKEZ_PORT).
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { trialCode } from './merkez-code.js';

const args = process.argv.slice(2);
const KAFE_PORT = Number(process.env.PAKET_KAFE_PORT ?? 3501), MERKEZ_PORT = Number(process.env.PAKET_MERKEZ_PORT ?? 3591);
const KAFE = `http://127.0.0.1:${KAFE_PORT}`, MERKEZ = `http://127.0.0.1:${MERKEZ_PORT}`;
const work = resolve('.local/e2e/paket-testi'), out = join(work, 'kurulum'), merkezData = join(work, 'merkez-veri'), kafeData = join(work, 'kafe-veri');
const MERKEZ_PASSWORD = 'Paket-Mavi-Kayik!93', OWNER = { username: 'paketsahip', password: 'Paket-Sahip-Kayik!71' }, BUSINESS = 'Paket Testi Kafe';
const reuse = args.includes('--hazir') && existsSync(join(out, 'Windows', 'program', 'app', 'server.mjs')) && existsSync(join(merkezData, 'merkez-public-key.txt'));
const kafeProgram = join(out, 'Windows', 'program'), merkezProgram = join(out, 'Mola-Yonetim', 'program');
const passed: string[] = [];
const ok = (what: string) => { passed.push(what); console.log(`  ✓ ${what}`); };
const step = (text: string) => console.log(`\n== ${text}`);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function portFree(port: number) {
  return new Promise<boolean>(done => { const probe = createServer(); probe.once('error', () => done(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => done(true))); });
}
async function until(what: string, check: () => Promise<boolean>, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) { try { if (await check()) return; } catch { /* not yet */ } if (Date.now() > end) throw new Error(`${what}: zaman aşımı`); await wait(250); }
}
/** The packaged start file, hidden, the way Mola.exe starts it (cmd /d /c "<file>"). */
function startCmd(file: string) {
  // The packaged program's own environment: nothing of this test runner (tsx's NODE_OPTIONS, a developer's MOLA_* settings).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_OPTIONS|TSX_|MOLA_|MERKEZ_|DATA_DIR$|PORT$|SERVE_BUILD$|E2E_)/i.test(k)));
  const child = spawn('cmd.exe', ['/d', '/c', `""${file}""`], { windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true, env });
  child.unref(); return child;
}
function stopProgram(folder: string, stopFile: string) {
  if (existsSync(join(folder, stopFile))) spawnSync('cmd.exe', ['/d', '/c', `""${join(folder, stopFile)}""`], { stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, timeout: 30_000 });
}
const lines = (...l: string[]) => l.join('\r\n') + '\r\n';

// ---------- 1. Folders, the scratch Mola Merkez's key, the packages ----------
for (const port of [KAFE_PORT, MERKEZ_PORT]) if (!await portFree(port)) { console.error(`Port ${port} kullanımda. Önceki paket testi açık kaldıysa: ${join(kafeProgram, 'Mola-Durdur.cmd')} / ${join(merkezProgram, 'Merkez-Durdur.cmd')}`); process.exit(1); }
mkdirSync(work, { recursive: true });
rmSync(kafeData, { recursive: true, force: true });
for (const old of ['kafe-yedekleri']) rmSync(join(work, old), { recursive: true, force: true });
if (!reuse) {
  rmSync(merkezData, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true });
  step('Geçici Mola Merkez verisi (paketin güveneceği açık anahtar)');
  // The development Merkez makes the data folder and its signing key once; the packaged Merkez opens the same folder later.
  const dev = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: 'ignore', windowsHide: true,
    env: { ...process.env, MERKEZ_PORT: String(MERKEZ_PORT), MERKEZ_DATA_DIR: merkezData, MERKEZ_INITIAL_PASSWORD: MERKEZ_PASSWORD, SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MERKEZ_KEY_PROTECTION: '0' } });
  try { await until('geçici Merkez', async () => existsSync(join(merkezData, 'merkez-public-key.txt')) && (await fetch(`${MERKEZ}/api/merkez/v1/health`)).ok); }
  finally { spawnSync('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore' }); }
  await until('geçici Merkez kapanışı', () => portFree(MERKEZ_PORT), 20_000);
  step('Kurulum paketleri (Windows + Mola Yönetim) → ' + out);
  execFileSync(process.execPath, ['scripts/build-installer.mjs', '--platforms=windows,yonetim', `--cikti=${out}`, '--apksiz', '--guncellemesiz', ...(args.includes('--arayuz-hazir') ? ['--skip-ui-build'] : [])], {
    stdio: 'inherit', env: { ...process.env, MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(merkezData, 'merkez-public-key.txt') } });
} else step('Önceki paketler kullanılıyor (--hazir)');
assert.ok(existsSync(join(kafeProgram, 'Mola-Sunucu.cmd')) && existsSync(join(merkezProgram, 'Merkez-Sunucu.cmd')), 'paket klasörleri eksik');

// ---------- 2. Start both packaged programs ----------
// ayarlar.cmd is the owner's settings file the start files read: here only scratch ports, folders and this test's Merkez.
// Folders relative to the start file (%~dp0 = <work>\kurulum\<package>\program\): cmd reads a .cmd in the console's code page,
// so a written-out "Masaüstü" would arrive garbled.
writeFileSync(join(merkezProgram, 'ayarlar.cmd'), lines('@echo off', `set MERKEZ_PORT=${MERKEZ_PORT}`, 'set MERKEZ_DATA_DIR=%~dp0..\\..\\..\\merkez-veri', 'set MERKEZ_KEY_PROTECTION=0', 'set MOLA_AUTO_BACKUP=0'));
writeFileSync(join(kafeProgram, 'ayarlar.cmd'), lines('@echo off', `set PORT=${KAFE_PORT}`, 'set DATA_DIR=%~dp0..\\..\\..\\kafe-veri', 'set MOLA_LAN=0', `set MOLA_MERKEZ_URL=${MERKEZ}`, 'set MOLA_AUTO_BACKUP=0', 'set MOLA_BACKUP_DISCOVERY=0'));
const smtp = fakeSmtp('paket-smtp-sifresi'), smtpPort = await smtp.listen();
const printer = await fakePrinter();
let failed = false;
try {
  step('Paketlenmiş Mola Merkez ve kafe sunucusu açılıyor');
  startCmd(join(merkezProgram, 'Merkez-Sunucu.cmd'));
  await until('paketlenmiş Merkez', async () => (await fetch(`${MERKEZ}/api/merkez/v1/health`)).ok, 90_000);
  ok(`Mola Merkez paketi açıldı (${MERKEZ})`);
  startCmd(join(kafeProgram, 'Mola-Sunucu.cmd'));
  await until('paketlenmiş kafe', async () => (await fetch(`${KAFE}/api/health`)).ok, 90_000);
  const health = await (await fetch(`${KAFE}/api/health`)).json() as { mode: string; demoAvailable: boolean; activation: string };
  assert.equal(health.mode, 'installed'); assert.equal(health.demoAvailable, false);
  ok(`Kafe paketi açıldı (${KAFE}, kurulu kip)`);

  // ---------- 3. Mola Yönetim / Merkez over its API ----------
  step('Mola Yönetim: İşlem kayıtları ve Satışlarım dosyaları');
  const m = await session(MERKEZ, '/api/merkez/admin/login', { username: 'admin', password: MERKEZ_PASSWORD });
  await pdfFile(m, `${MERKEZ}/api/merkez/admin/journal/report.pdf`, 'İşlem kayıtları PDF');
  await xlsxFile(m, `${MERKEZ}/api/merkez/admin/journal/report.xlsx`, 'İşlem kayıtları Excel');
  { const r = await m.get(`${MERKEZ}/api/merkez/admin/journal/export.jsonl`); assert.equal(r.status, 200); const t = await r.text(); assert.ok(t.trim().split('\n').length > 1 && JSON.parse(t.split('\n')[0])); ok('İşlem kayıtları JSONL'); }
  await htmlPage(m, `${MERKEZ}/api/merkez/admin/journal/report.html`, 'İşlem kayıtları raporu', 'İşlem kayıtları Yazdır sayfası');
  const year = new Date().getFullYear();
  await pdfFile(m, `${MERKEZ}/api/merkez/admin/sales/report.pdf?year=${year}`, 'Satışlarım PDF');
  await xlsxFile(m, `${MERKEZ}/api/merkez/admin/sales/report.xlsx?year=${year}`, 'Satışlarım Excel');
  await htmlPage(m, `${MERKEZ}/api/merkez/admin/sales/report.html?year=${year}`, String(year), 'Satışlarım Yazdır sayfası');

  // ---------- 4. The café: activation, owner, a cash closing ----------
  step('Kafe: etkinleştirme, sahip hesabı, kasa kapanışı');
  if (health.activation === 'activate') {
    const code = await trialCode(MERKEZ, MERKEZ_PASSWORD, BUSINESS);
    const a = await fetch(`${KAFE}/api/activation/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(a.status, 200, await a.clone().text());
    const o = await fetch(`${KAFE}/api/activation/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER) });
    assert.equal(o.status, 200, await o.clone().text());
  }
  const k = await session(KAFE, '/api/login', OWNER);
  const state = await (await k.get(`${KAFE}/api/staff/state`)).json() as { setupCompleted: boolean; businessRevision?: number; name: string; tables: { name: string }[]; changeSeconds: number; commissionBps: number };
  if (!state.setupCompleted) { const r = await k.post(`${KAFE}/api/staff/setup`, { requestId: 'paket-testi-kurulum', version: state.businessRevision ?? 0, name: state.name, tableCount: Math.max(3, state.tables.length), changeSeconds: state.changeSeconds, commissionBps: state.commissionBps }); assert.ok(r.ok, await r.text()); }
  // The licence agreement window ("Okudum, kabul ediyorum") the owner answers once.
  { const g = await (await k.get(`${KAFE}/api/staff/license/agreement`)).json() as { version: number }; assert.ok((await k.post(`${KAFE}/api/staff/license/agreement`, { version: g.version })).ok); }
  ok(`Etkinleştirildi: ${BUSINESS}, sahip ${OWNER.username}, sözleşme kabul edildi`);
  let closingId = '';
  {
    const open = await k.post(`${KAFE}/api/staff/cash/open`, { requestId: randomUUID(), amount: 50000 });
    assert.ok(open.ok || (await open.clone().json() as { code?: string }).code === 'CASH_ALREADY_OPEN', await open.clone().text());
    const count = await k.post(`${KAFE}/api/staff/cash/count`, { requestId: randomUUID(), mode: 'final', counted: 50000 });
    assert.ok(count.ok, await count.clone().text());
    const c = await count.json() as { id?: string; closing?: { id: string } };
    closingId = c.closing?.id ?? c.id ?? '';
    const done = await k.post(`${KAFE}/api/staff/cash/finish`, { id: closingId, left: 50000 });
    assert.ok(done.ok, await done.clone().text());
    ok('Gün sonu kasa kapanışı yapıldı');
  }

  // ---------- 5. Café files ----------
  step('Kafe: Satış ve Raporlar dosyaları, e-posta raporu, yazıcı, destek eki');
  const today = new Date(Date.now() + 3 * 3600_000 - 5 * 3600_000).toISOString().slice(0, 10), weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  for (const view of ['summary', 'cash', 'products', 'expenses', 'staff'] as const) {
    const q = `view=${view}&from=${weekAgo}&to=${today}`;
    await htmlPage(k, `${KAFE}/api/staff/reports/document?${q}`, BUSINESS, `Rapor sayfası (${view})`);
  }
  await pdfFile(k, `${KAFE}/api/staff/reports/document.pdf?view=summary&from=${weekAgo}&to=${today}`, 'Satış özeti PDF');
  await pdfFile(k, `${KAFE}/api/staff/reports/document.pdf?view=cash&from=${weekAgo}&to=${today}`, 'Kasa kapanışları PDF');
  await xlsxFile(k, `${KAFE}/api/staff/reports/accountant.xlsx?from=${weekAgo}&to=${today}`, 'Muhasebeci Excel');
  {
    const saved = await k.post(`${KAFE}/api/staff/email-reports`, { account: { provider: 'other', host: '127.0.0.1', port: smtpPort, security: 'none', user: 'kafe@example.com', password: 'paket-smtp-sifresi' }, to: ['sahip@example.com'] });
    assert.ok(saved.ok, await saved.text());
    const sent = await k.post(`${KAFE}/api/staff/email-reports/test`, {});
    assert.ok(sent.ok, await sent.text());
    await until('e-posta', async () => smtp.mails.length > 0, 90_000);
    const mail = smtp.mails[0].data;
    const part = mail.split(/\n--[^\n]+\n?/).find(b => /filename="[^"]+\.pdf"/i.test(b));
    assert.ok(part, `e-postanın eki PDF değil: ${/filename="([^"]+)"/i.exec(mail)?.[1] ?? 'ek yok'}`);
    const body = Buffer.from(part.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64');
    assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-'); ok(`E-posta raporu PDF eki (${Math.round(body.length / 1024)} KB)`);
  }
  if (printer) {
    const added = await k.post(`${KAFE}/api/staff/printers`, { printer: { name: 'Paket yazıcı', enabled: true, connection: { type: 'network', host: printer.host, port: printer.port }, width: 80, charset: 'pc857', orders: true, categories: [], bill: true } });
    assert.ok(added.ok, await added.clone().text());
    const id = (await added.json() as { printer: { id: string } }).printer.id;
    printer.received.length = 0;
    assert.ok((await k.post(`${KAFE}/api/staff/printers/test`, { id })).ok);
    await until('deneme fişi', async () => Buffer.concat(printer.received).length > 20, 15_000); ok('Mutfak/kasa deneme fişi sahte yazıcıya gitti');
    printer.received.length = 0;
    const r = await k.post(`${KAFE}/api/staff/cash/print`, { id: closingId }); assert.ok(r.ok, await r.text());
    await until('kapanış fişi', async () => Buffer.concat(printer.received).toString('latin1').includes(BUSINESS), 15_000); ok('Kasa kapanış fişi sahte yazıcıya gitti');
    // Off again: the browser part prints nothing on paper.
    await k.post(`${KAFE}/api/staff/printers/delete`, { id });
  } else console.log('  ! Bu bilgisayarda özel ağ adresi yok: sahte ağ yazıcısı denenemedi.');
  {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2f7a55' } }).png().toBuffer();
    const up = await k.post(`${KAFE}/api/staff/support/attachments`, { name: 'paket-ek.png', data: png.toString('base64') });
    assert.ok(up.ok, await up.clone().text());
    const att = (await up.json() as { attachment: { id: string } }).attachment;
    const t = await k.post(`${KAFE}/api/staff/support`, { requestId: randomUUID().replace(/-/g, ''), subject: 'Paket testi eki', text: 'Ek indirme denemesi.', attachments: [att.id] });
    assert.ok(t.ok, await t.text());
    const back = await k.get(`${KAFE}/api/staff/support/attachments/${att.id}`); assert.equal(back.status, 200); assert.match(back.headers.get('content-type') ?? '', /^image\//);
    assert.ok((await back.arrayBuffer()).byteLength > 50);
    const admin = await m.get(`${MERKEZ}/api/merkez/admin/attachments/${att.id}`); assert.equal(admin.status, 200);
    ok('Destek eki: kafeden yüklendi, kafede ve Mola Yönetim’de indirildi');
  }

  // ---------- 6. Browser (Edge, like the Mola window) ----------
  step('Tarayıcı (Edge): yazdırma sayfaları ve indirmeler');
  const stateFile = join(work, 'durum.json');
  writeFileSync(stateFile, JSON.stringify({ kafe: KAFE, merkez: MERKEZ, owner: OWNER, merkezPassword: MERKEZ_PASSWORD, business: BUSINESS }));
  const pw = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/paket/playwright.config.ts'], { stdio: 'inherit', env: { ...process.env, PAKET_DURUM: stateFile, PLAYWRIGHT_OUTPUT_DIR: join(work, 'tarayici') } });
  assert.equal(pw.status, 0, 'tarayıcı bölümü başarısız (yukarıdaki Playwright çıktısı)');
  ok('Tarayıcı bölümü (tests/paket/paket.spec.ts)');

  // Nothing went wrong quietly: no "[PDF … PDF oluşturulamadı" line in either server log.
  for (const log of [join(merkezProgram, 'logs', 'merkez.log'), join(kafeProgram, 'logs', 'sunucu.log')]) {
    const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
    assert.ok(!/PDF oluşturulamadı/.test(text), `${log}: ${/.*PDF oluşturulamadı.*/.exec(text)?.[0]}`);
  }
  ok('Sunucu kayıtlarında PDF hatası yok');
} catch (error) {
  failed = true;
  console.error(`\nPAKET TESTİ BAŞARISIZ: ${(error as Error).stack ?? error}`);
  for (const log of [join(merkezProgram, 'logs', 'merkez.log'), join(kafeProgram, 'logs', 'sunucu.log')]) if (existsSync(log)) console.error(`\n--- ${log} (son satırlar)\n${readFileSync(log, 'utf8').split('\n').slice(-25).join('\n')}`);
} finally {
  stopProgram(kafeProgram, 'Mola-Durdur.cmd'); stopProgram(merkezProgram, 'Merkez-Durdur.cmd');
  smtp.server.close(); printer?.server.close();
}
console.log(failed ? '\nPaket testi başarısız.' : `\nPaket testi başarılı: ${passed.length} denetim. Paketler: ${out}`);
process.exit(failed ? 1 : 0);

// ---------- helpers ----------
async function session(base: string, path: string, body: unknown) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(r.status, 200, `${base}${path}: ${await r.clone().text()}`);
  const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  return {
    get: (url: string) => fetch(url, { headers, signal: AbortSignal.timeout(180_000) }),
    post: (url: string, data: unknown) => fetch(url, { method: 'POST', headers, body: JSON.stringify(data), signal: AbortSignal.timeout(180_000) }),
  };
}
type Session = Awaited<ReturnType<typeof session>>;
async function pdfFile(s: Session, url: string, what: string) {
  const t = Date.now(), r = await s.get(url), data = Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, 200, `${what}: ${r.status} ${data.toString('utf8').slice(0, 300)}`);
  assert.equal(data.subarray(0, 5).toString('latin1'), '%PDF-', `${what}: PDF değil`); assert.ok(data.length > 2000, `${what}: çok küçük`);
  ok(`${what} (${Math.round(data.length / 1024)} KB, ${((Date.now() - t) / 1000).toFixed(1)} sn)`);
}
async function xlsxFile(s: Session, url: string, what: string) {
  const r = await s.get(url), data = Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, 200, `${what}: ${r.status} ${data.toString('utf8').slice(0, 300)}`);
  assert.equal(data.subarray(0, 2).toString('latin1'), 'PK', `${what}: xlsx değil`); assert.ok(data.includes(Buffer.from('xl/worksheets/sheet1.xml')), `${what}: sayfa yok`);
  ok(`${what} (${Math.round(data.length / 1024)} KB)`);
}
async function htmlPage(s: Session, url: string, text: string, what: string) {
  const r = await s.get(url), body = await r.text();
  assert.equal(r.status, 200, `${what}: ${r.status} ${body.slice(0, 300)}`);
  assert.match(r.headers.get('content-type') ?? '', /text\/html/); assert.ok(body.includes(text), `${what}: "${text}" yok`); assert.ok(/<table|<section|<h1/.test(body), `${what}: boş sayfa`);
  ok(what);
}
/** A tiny SMTP server on this computer (the café allows plain SMTP only to 127.0.0.1): keeps the raw messages. */
function fakeSmtp(password: string) {
  const mails: { data: string }[] = [];
  const server: Server = createServer(socket => {
    let buffer = '', data: string | null = null;
    socket.setEncoding('utf8'); socket.on('error', () => {}); socket.write('220 paket-smtp\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\r\n')) >= 0;) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (data !== null) { if (line === '.') { mails.push({ data }); data = null; socket.write('250 alindi\r\n'); } else data += line + '\n'; continue; }
        if (/^EHLO/i.test(line)) socket.write('250-paket-smtp\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) socket.write(Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0')[2] === password ? '235 OK\r\n' : '535 hayir\r\n');
        else if (/^DATA/i.test(line)) { data = ''; socket.write('354 devam\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 hoscakal\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  return { mails, server, listen: () => new Promise<number>(done => server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port))) };
}
/** A network receipt printer that only listens (this computer's private address, port 9100–9109: what the printer form accepts). */
async function fakePrinter() {
  const host = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;
  if (!host) return undefined;
  const received: Buffer[] = [];
  for (const port of [9107, 9108, 9109, 9106]) {
    const server = createServer(socket => { socket.on('data', d => received.push(d)); socket.on('error', () => {}); });
    if (await new Promise<boolean>(done => { server.once('error', () => done(false)); server.listen(port, host, () => done(true)); })) return { host, port, server, received };
  }
  return undefined;
}

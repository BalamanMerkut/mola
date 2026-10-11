import { execFile, spawn } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { Express, Request } from 'express';
import { DomainError } from '../packages/domain/engine.js';
import type { BackupScheduler } from './backup-scheduler.js';
import { loopbackRequest } from './http-security.js';
import type { NetworkProfile } from './network-profile.js';

/** Private (café network) IPv4 addresses that tablets and phones can open. */
export function lanOrigins(port: number) {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries ?? []).filter(e => e.family === 'IPv4' && !e.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(e.address)).map(e => ({ name, origin: `http://${e.address}:${port}` })));
}

/** token: key from the desktop launcher (empty when there is none). loopback: development only, this computer's own browser. */
export type Desktop = { token: string; shutdown: () => void; loopback?: (req: Request) => boolean };
/**
 * The desktop app (Mola.exe, Mola.app, Linux launcher) reads this key from disk and hands it to its own window.
 * Only that window gets the side rail (backup, tablets, shut down); tablets, phones and a tunnel never see the key.
 * The key stays the same for the life of the installation: a restart (the watchdog after a crash, an update) reuses it,
 * so an open Mola window keeps its rail. It never leaves this computer: the launchers first make the server prove it holds
 * the key (desktopProof) and only then pass it to their own window. A missing or malformed file, or on macOS/Linux one that
 * other users could read, gets a new key.
 */
export function desktopKey(file: string) {
  try {
    const existing = readFileSync(file, 'utf8');
    if (/^[A-Za-z0-9_-]{43}$/.test(existing) && (process.platform === 'win32' || (statSync(file).mode & 0o077) === 0)) return existing;
  } catch { /* none yet */ }
  const token = randomBytes(32).toString('base64url');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}

function openFolder(path: string) {
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [path]] : process.platform === 'darwin' ? ['open', [path]] : ['xdg-open', [path]];
  // Detached and ignored: the file manager outlives the request; a missing opener must not crash the server.
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}

/**
 * GET /api/desktop/kanit?n=<nonce>: HMAC-SHA256(key, "mola-masaustu-kanit:" + nonce). The launchers (Mola.exe, Mola.app,
 * Linux) send a fresh random nonce and compare: a program that merely answers 200 on the port cannot, so the key is never
 * handed to it. Answered before everything else (also while the data is locked or a restore runs), only to this computer's
 * own address. Returns false for every other request.
 */
export function desktopProof(desktop: Desktop | undefined, req: IncomingMessage, res: ServerResponse) {
  if (!req.url?.startsWith('/api/desktop/kanit')) return false;
  const url = new URL(req.url, 'http://127.0.0.1'), nonce = url.searchParams.get('n') ?? '';
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
  const ok = url.pathname === '/api/desktop/kanit' && req.method === 'GET' && !!desktop?.token && local && /^[A-Za-z0-9_-]{16,128}$/.test(nonce);
  res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(ok ? { kanit: createHmac('sha256', desktop!.token).update(`mola-masaustu-kanit:${nonce}`).digest('hex') } : { code: 'NOT_FOUND', message: 'İşlem bulunamadı.' }));
  return true;
}

/** Mola.exe --guvenlik-duvari (scripts/desktop): set by Mola-Sunucu.cmd in the packaged Windows app only. */
function firewallHelper() {
  const file = process.env.MOLA_FIREWALL_HELPER;
  return process.platform === 'win32' && file && /\.exe$/i.test(file) && existsSync(file) ? resolve(file) : undefined;
}
function runHelper(file: string, args: string[], timeout: number, hide: boolean) {
  return new Promise<{ code: number; out: string }>(done => {
    execFile(file, args, { timeout, windowsHide: hide, encoding: 'utf8' }, (error, stdout) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1) : 0;
      done({ code, out: String(stdout ?? '') });
    });
  });
}
/** "--durum": tamam = only Mola's rule (inbound, allow, private networks), eksik = no rule, duzelt = other rules (e.g. Windows' own "Public"). */
async function firewallState(file: string) {
  const { out } = await runHelper(file, ['--guvenlik-duvari', '--durum'], 20000, true);
  try { return ({ tamam: 'ok', eksik: 'missing', duzelt: 'fix' } as Record<string, string>)[JSON.parse(out.trim().split('\n').pop() ?? '').durum] ?? 'unknown'; }
  catch { return 'unknown'; }
}

export const PANE_HEADER = 'X-Mola-Pane', PANE_KEY_HEADER = 'X-Mola-Pane-Key';
/** İki ekran: the panes' key, derived from the desktop key (the panes never hold or send the desktop key itself). */
export const paneKey = (token: string) => createHmac('sha256', token).update('mola-iki-ekran:v1').digest('base64url');
/**
 * İki ekran (src/SplitView.tsx, server/sessions.ts): a request that names a pane (`X-Mola-Pane: 1|2`) must come from the
 * café computer's own window: this computer directly (no proxy, loopback name) with the panes' key, which only the rail of
 * that window gets (GET /api/desktop/pane), or development's own browser (--masaustu). Anything else (a tablet, a phone, a
 * tunnel, a wrong key, a third pane) is refused with 403 instead of quietly using another pane's session.
 * Returns undefined for an ordinary request (no header).
 */
export function paneGuard(desktop: Desktop | undefined) {
  const expected = desktop?.token ? Buffer.from(paneKey(desktop.token)) : undefined;
  return function paneOf(req: Request): 1 | 2 | undefined {
    const raw = req.get(PANE_HEADER);
    if (raw === undefined) return undefined;
    const pane = raw === '1' ? 1 : raw === '2' ? 2 : undefined, supplied = Buffer.from(String(req.get(PANE_KEY_HEADER) ?? ''));
    const keyed = !!expected && loopbackRequest(req) && supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (!pane || !(keyed || desktop?.loopback?.(req))) throw new DomainError('PANE_REFUSED', 'İki ekran yalnız kasa bilgisayarındaki Mola penceresinde açılır.', 403);
    return pane;
  };
}

/** Throws 404 unless the request carries the desktop key (or is development's own browser). Never for a pane's request. */
export function desktopGuard(desktop: Desktop | undefined) {
  const expected = desktop?.token ? Buffer.from(desktop.token) : undefined;
  return function allow(req: Request) {
    const supplied = Buffer.from(String(req.get('X-Mola-Desktop') ?? ''));
    // İki ekran: the desktop tools belong to the outer window's rail only, never to what runs inside a pane.
    if (req.get(PANE_HEADER) !== undefined) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404);
    if (desktop?.loopback?.(req)) return;
    // Not configured or a wrong key: answer as if the route did not exist, so ordinary browsers learn nothing.
    if (!expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404);
  };
}
/** Key protection summary for the rail: the dot on "Güvenlik" and the second-copy warning. */
export type DesktopSecurity = { protection: string; recoveryConfirmed: boolean; recoveryAvailable: boolean; warning: string | null; secondFolder: string | null; secondError: string | null; clean: boolean; owner?: boolean; /** Hizmet paketi: "İki ekran" is in the package (the rail fades "İkiye böl" otherwise). */ split?: boolean };
/** Open tables (accounts) and orders not yet served, over every business here: the installer warns before an update. */
export type DesktopActivity = { openAccounts: number; pendingOrders: number };
export function desktopRoutes(app: Express, desktop: Desktop | undefined, network: { lan: boolean; port: number }, backups?: BackupScheduler, security?: () => DesktopSecurity, activity?: () => DesktopActivity, profile?: NetworkProfile) {
  const allow = desktopGuard(desktop);
  let asking = false;
  // Tabletler: is the connection phones use on Windows' "Genel" profile (Mola's firewall rule covers private networks only)?
  // Read only; Mola never changes it (server/network-profile.ts).
  app.get('/api/desktop/network-profile', async (req, res) => {
    allow(req);
    res.json(profile ? await profile.view() : { checked: false, public: [] });
  });
  app.get('/api/desktop/activity', (req, res) => {
    allow(req);
    res.json(activity?.() ?? { openAccounts: 0, pendingOrders: 0 });
  });
  // Tabletler > "İzni düzelt": the firewall rule for the tablets. GET only reads; POST runs the helper, which asks Windows
  // once for administrator approval (UAC) and returns 3 when the owner says no.
  app.get('/api/desktop/firewall', async (req, res) => {
    allow(req);
    const file = firewallHelper();
    res.json(file ? { supported: true, state: await firewallState(file) } : { supported: false });
  });
  app.post('/api/desktop/firewall', async (req, res) => {
    allow(req);
    const file = firewallHelper();
    if (!file) throw new DomainError('FIREWALL_UNSUPPORTED', 'Güvenlik duvarı izni bu bilgisayarda Mola\'dan verilemez.', 409);
    if (asking) throw new DomainError('FIREWALL_BUSY', 'Windows onayı zaten bekleniyor.', 409);
    asking = true;
    try {
      const { code } = await runHelper(file, ['--guvenlik-duvari'], 115000, false);
      res.json({ ok: code === 0, declined: code === 3, state: await firewallState(file) });
    } finally { asking = false; }
  });
  const backupView = () => {
    if (!backups) return { enabled: false };
    const s = backups.status();
    // Sunucu yedeği (server/cloud-backup.ts): the encrypted copy on Mola Merkez, once this install is linked to one that keeps them.
    const cloud = backups.cloud?.status();
    // "Gece yedeği gerekmedi: 23:41 gün sonu yedeği güncel." until the next backup; `set`: the kept backups (Günlük / Haftalık / Aylık).
    const note = s.skipped && (!s.lastSuccessAt || s.skipped.at > s.lastSuccessAt) ? s.skipped.text : null;
    return { enabled: true, running: s.running, lastSuccessAt: s.lastSuccessAt ?? null, lastError: s.lastError ?? null, nextRunAt: s.nextRunAt ?? null, note, set: s.set ?? [], packages: s.packages ?? [], ...(s.safetyCopy ? { safetyCopy: s.safetyCopy } : {}), ...(cloud?.enabled ? { cloud: { running: cloud.running, lastSuccessAt: cloud.lastSuccessAt ?? null, lastAttemptAt: cloud.lastAttemptAt ?? null, lastError: cloud.lastError ?? null, copies: cloud.copies ?? null, bytes: cloud.bytes ?? null, progress: cloud.progress ?? null } } : {}) };
  };
  // İki ekran: the rail hands this key to its two panes (src/SplitView.tsx); '' in development (--masaustu, no key).
  app.get('/api/desktop/pane', (req, res) => {
    allow(req);
    res.json({ key: desktop?.token ? paneKey(desktop.token) : '' });
  });
  app.get('/api/desktop/status', (req, res) => {
    allow(req);
    res.json({ ok: true, lan: network.lan, addresses: network.lan ? lanOrigins(network.port) : [], backup: backupView(), ...(security ? { security: security() } : {}) });
  });
  app.post('/api/desktop/backup', async (req, res) => {
    allow(req);
    if (!backups) throw new DomainError('BACKUP_OFF', 'Otomatik yedekleme bu kurulumda kapalı.', 409);
    await backups.runNow();
    res.json(backupView());
  });
  app.post('/api/desktop/open-backups', (req, res) => {
    allow(req);
    if (!backups) throw new DomainError('BACKUP_OFF', 'Otomatik yedekleme bu kurulumda kapalı.', 409);
    mkdirSync(backups.folder, { recursive: true });
    openFolder(backups.folder);
    res.json({ ok: true });
  });
  app.post('/api/desktop/shutdown', (req, res) => {
    allow(req);
    res.json({ ok: true });
    // Answer first, then close: running requests finish before the data is released.
    res.on('finish', () => setTimeout(() => desktop!.shutdown(), 200));
  });
}

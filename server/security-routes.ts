import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../packages/domain/engine.js';
import type { AttemptLimiter, KeyVault, RecoveryView } from './key-vault.js';
import type { BackupScheduler } from './backup-scheduler.js';
import { backupPlaces, findBackups } from './second-backup.js';
import { loopbackRequest } from './http-security.js';
import { APP_VERSION } from './license.js';

/** What the running server knows about key protection; runtime.ts fills it, tests may leave it out (protection "off"). */
export type Security = {
  vault?: KeyVault;
  attempts: AttemptLimiter;
  /** Clean install only: restore a protected backup with its recovery code, then switch to it (runtime.ts). */
  restore?: (backup: string, code: string) => Promise<void>;
};
const OFF: RecoveryView = { protection: 'off', protectedAtRest: false, available: false, confirmed: false, shown: false, createdAt: null, warning: null };
export const recoveryView = (security?: Security) => security?.vault?.view() ?? OFF;

/**
 * This computer, talking to the server directly: no proxy or tunnel in between, not another device on the network, and
 * addressed by a loopback name (a rebound DNS name pointing at 127.0.0.1 is someone else's page).
 */
export function fromThisComputer(req: Request) { return loopbackRequest(req); }

type Context = { security?: Security; backups?: BackupScheduler; checkPassword: (password: string) => Promise<boolean>; attempt: () => void; audit: (action: string) => void };
/**
 * Recovery code and second backup place, for the café computer's own window (/api/desktop). The old Ana panel copy of
 * these routes is gone with the panel (the vendor's Mola Yönetim runs on Mola Merkez and never reaches this computer).
 * The code is shown only while it is new and not yet confirmed; making a new one needs an owner's password.
 */
export function securityRoutes(app: Express, prefix: '/api/desktop', guard: (req: Request) => void, ctx: Context) {
  const vault = () => { const v = ctx.security?.vault; if (!v || v.protection === 'off') throw new DomainError('NO_PROTECTION', 'Bu kurulumda anahtar koruması kapalı.', 409); return v; };
  // The café network is plain HTTP: the code itself is only ever sent to a screen on this computer.
  const here = (req: Request) => { if (!fromThisComputer(req)) throw new DomainError('LOCAL_ONLY', 'Kurtarma kodu yalnız kasa bilgisayarında gösterilir; ağ üzerinden gönderilmez.', 403); };
  app.get(`${prefix}/recovery`, (req, res) => { guard(req); res.json(recoveryView(ctx.security)); });
  app.post(`${prefix}/recovery/show`, (req, res) => { guard(req); here(req); res.json({ code: vault().reveal() }); });
  // The window asks for two groups of the code just shown (or the whole code after a restart); {} stays for scripts and tests.
  app.post(`${prefix}/recovery/confirm`, async (req, res) => {
    guard(req);
    const b = z.object({ groups: z.array(z.object({ group: z.number().int().min(1).max(6), value: z.string().max(8) })).min(2).max(6).optional(), code: z.string().min(1).max(64).optional() }).parse(req.body ?? {});
    const v = vault();
    if (b.groups) v.checkGroups(b.groups);
    else if (b.code) { here(req); ctx.attempt(); await v.verify(b.code); }
    v.confirm(); ctx.audit('recovery.confirmed'); res.json(recoveryView(ctx.security));
  });
  app.post(`${prefix}/recovery/new`, async (req, res) => {
    guard(req); here(req); ctx.attempt();
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const v = vault();
    if (!await ctx.checkPassword(password)) throw new DomainError('INVALID_PASSWORD', 'İşletme sahibi şifresi yanlış.', 403);
    if (ctx.backups?.status().running) throw new DomainError('BACKUP_RUNNING', 'Şu anda yedek alınıyor. Bir dakika sonra yeniden deneyin.', 409);
    await v.regenerate();
    // Backups this computer can reach take the new code too; the result does not change the answer.
    await ctx.backups?.rewrap(v.backupProtection()!).catch(() => 0);
    ctx.audit('recovery.renewed');
    res.json({ code: v.reveal() });
  });
  app.get(`${prefix}/second-backup`, async (req, res) => {
    guard(req);
    const second = ctx.backups?.second;
    const reason = !ctx.backups ? 'Otomatik yedek bu kurulumda kapalı.' : !second ? 'İkinci yedek yalnız anahtar koruması açık kurulumda alınır (kurtarma kodu olmadan yedek başka yerde açılamaz).' : null;
    res.json({ available: !!second, reason, ...(second?.status() ?? { folder: null }), ...(req.query.places === '1' && second ? { places: await backupPlaces() } : {}) });
  });
  app.post(`${prefix}/second-backup`, async (req, res) => {
    guard(req);
    const b = z.object({ folder: z.string().min(1).max(400).nullable(), kind: z.enum(['usb', 'onedrive', 'gdrive', 'folder']).optional(), label: z.string().max(80).optional() }).parse(req.body);
    const second = ctx.backups?.second;
    if (!second) throw new DomainError('SECOND_OFF', 'İkinci yedek bu kurulumda kullanılamıyor.', 409);
    const status = await second.choose(b.folder, b.kind, b.label);
    ctx.audit(b.folder ? 'backup.second_place_set' : 'backup.second_place_off');
    res.json({ available: true, reason: null, ...status });
  });
}

/** Desktop window on a clean install: find protected backups and restore one with the recovery code. */
export function restoreRoutes(app: Express, guard: (req: Request) => void, ctx: { security?: Security; backups?: BackupScheduler; clean: () => boolean }) {
  const ready = () => {
    if (!ctx.security?.restore || !ctx.security.vault || ctx.security.vault.protection === 'off') throw new DomainError('RESTORE_OFF', 'Yedekten geri yükleme yalnız anahtar koruması açık kurulumda yapılır (masaüstü uygulaması). Geliştirmede: npm run backup -- restore-with-code.', 409);
    if (!ctx.clean()) throw new DomainError('NOT_CLEAN', 'Bu bilgisayarda zaten işletme verisi var. Geri yükleme yalnız yeni kurulumda yapılır.', 409);
  };
  app.get('/api/desktop/restore/backups', async (req, res) => {
    guard(req); ready();
    const typed = typeof req.query.folder === 'string' && req.query.folder.trim() ? req.query.folder.trim().slice(0, 400) : undefined;
    const places = await backupPlaces(), second = ctx.backups?.second?.status().folder;
    const folders = [
      ...(second ? [{ path: second, label: 'İkinci yedek yeri', source: 'second' as const }] : []),
      ...(typed ? [{ path: typed, label: 'Seçilen klasör', source: 'other' as const }] : []),
      ...places.map(p => ({ path: p.path, label: p.label, source: 'second' as const })),
      ...(ctx.backups ? [{ path: ctx.backups.folder, label: 'Bu bilgisayar', source: 'local' as const }] : []),
    ];
    // This clean install's own (empty) backups are never offered.
    res.json({ backups: await findBackups(folders, ctx.security?.vault?.installId), places });
  });
  app.post('/api/desktop/restore', async (req, res) => {
    guard(req); ready();
    const b = z.object({ backup: z.string().min(1).max(500), code: z.string().min(1).max(64) }).parse(req.body);
    await ctx.security!.attempts.run(() => ctx.security!.restore!(b.backup, b.code));
    res.json({ ok: true });
  });
}

/** While the data is locked: only the health check, the desktop window's status, unlock and shut down. Everything else: 423. */
export function lockedRoutes(app: Express, guard: (req: Request) => void, ctx: { vault: KeyVault; attempts: AttemptLimiter; network: { lan: boolean; mode?: 'development' | 'installed' }; open: () => Promise<void>; shutdown?: () => void; desktopHealth: (req: Request) => boolean }) {
  const LOCKED = 'Veriler kilitli. Kasa bilgisayarında kilit açılmalı.';
  app.get('/api/health', (req, res) => { res.json({ ok: true, mode: ctx.network.mode ?? 'development', version: APP_VERSION, role: 'kafe', locked: true, demoAvailable: false, ...(ctx.desktopHealth(req) ? { desktop: true } : {}) }); });
  // The launcher (Mola.exe) checks this to know its own server is up; it must answer while locked too.
  app.get('/api/desktop/status', (req, res) => { guard(req); res.json({ ok: true, locked: true, lockReason: ctx.vault.lockReason ?? null, lan: ctx.network.lan, addresses: [], backup: { enabled: false } }); });
  app.post('/api/desktop/unlock', async (req, res) => {
    guard(req);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.body);
    if (ctx.vault.state === 'locked') await ctx.attempts.run(() => ctx.vault.unlock(code));
    await ctx.open();
    res.json({ ok: true, warning: ctx.vault.warning ?? null });
  });
  app.post('/api/desktop/unlock/retry', async (req, res) => {
    guard(req);
    const ok = ctx.vault.state === 'open' || await ctx.vault.retry();
    if (ok) await ctx.open();
    res.json({ ok, lockReason: ctx.vault.lockReason ?? null });
  });
  app.post('/api/desktop/shutdown', (req, res) => {
    guard(req); if (!ctx.shutdown) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404);
    res.json({ ok: true }); res.on('finish', () => setTimeout(() => ctx.shutdown!(), 200));
  });
  app.use('/api', (_req, _res, next) => next(new DomainError('LOCKED', LOCKED, 423)));
}

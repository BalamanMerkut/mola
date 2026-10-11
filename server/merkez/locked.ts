import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { hostAllowed, loopbackRequest, type HttpSecurity } from '../http-security.js';
import { AttemptLimiter } from '../key-vault.js';
import { APP_VERSION } from '../license.js';
import { MERKEZ_API } from '../sync-protocol.js';
import type { MerkezKeyGuard } from './key-guard.js';
import { contextFor, type JournalInput } from './journal.js';

/*
 * Mola Merkez while its data key is locked (server/merkez/key-guard.ts): nothing of the data is open. It answers only
 *   GET  /api/merkez/v1/health        "role":"merkez", locked: true (the Mola Yönetim launcher still opens its window)
 *   GET  /api/merkez/admin/lock       why it is locked, and whether this browser may unlock it (this computer only)
 *   POST /api/merkez/admin/unlock     { code }: the 24-character Merkez recovery code (Ayarlar → Yedek)
 *   POST /api/merkez/admin/unlock/retry  the computer user's lock again (it may not have answered in time)
 * and the Mola Yönetim page itself (the runtime adds it), which shows the unlock screen. Cafés get 503 and try again later.
 * Unlocking only directly on this computer (loopback socket, loopback Host, no proxy header): on a VDS through an SSH tunnel
 * (ssh -L 4000:127.0.0.1:4000), never through the public HTTPS address. 5 wrong codes per 10 minutes, one try at a time.
 */
/** `record`: İşlem kayıtları lines (unlock tries), written once the data is open (runtime.ts). */
export function lockedMerkezApp(guard: MerkezKeyGuard, options: { httpSecurity?: HttpSecurity; onUnlocked: () => Promise<void>; record?: (line: JournalInput) => void }) {
  const note = (req: Request, action: string, detail?: string) => { try { const c = contextFor(req); options.record?.({ action, at: new Date().toISOString(), source: c.source, ...(c.address ? { address: c.address } : {}), actor: { kind: 'admin', id: 'admin', name: 'Bu bilgisayardaki kişi (kilit ekranı)' }, ...(detail ? { detail } : {}) }); } catch { /* best effort */ } };
  const app = express(); app.disable('x-powered-by'); app.set('env', 'production');
  const origin = options.httpSecurity?.publicOrigin, attempts = new AttemptLimiter(5, 10 * 60_000);
  app.set('trust proxy', options.httpSecurity?.trustLocalProxy ? 'loopback' : false);
  app.use((req, res, next) => {
    if (hostAllowed(req.headers.host, origin)) return next();
    res.status(403);
    if (req.path.startsWith('/api/')) res.json({ code: 'HOST_REJECTED', message: 'Bu adres bu sunucuya ait değil.' }); else res.type('text/plain').send('Bu adres bu sunucuya ait değil.');
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.get(`${MERKEZ_API}/health`, (_req, res) => { res.json({ ok: true, role: 'merkez', version: APP_VERSION, mode: process.env.MOLA_MODE === 'installed' ? 'installed' : 'development', locked: true }); });
  app.use(MERKEZ_API, (_req, _res, next) => next(new DomainError('MERKEZ_LOCKED', 'Mola Merkez şu anda bakımda. Birkaç dakika sonra yeniden denenecek.', 503)));
  const local = (req: Request) => { if (!loopbackRequest(req)) throw new DomainError('LOCAL_ONLY', 'Kilit yalnız Mola Merkez’in çalıştığı bilgisayardan açılır.', 403); };
  app.get('/api/merkez/admin/lock', (req, res) => { res.json({ locked: guard.state === 'locked', reason: guard.lockReason ?? null, local: loopbackRequest(req), kind: guard.lock.kind }); });
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(new DomainError('JSON_REQUIRED', 'JSON içerik gerekli.', 415));
    // A page elsewhere may not post here (its Origin would differ from this address).
    const supplied = req.get('Origin');
    if (supplied && supplied !== `${req.protocol}://${req.get('host')}` && supplied !== origin) return next(new DomainError('ORIGIN_REJECTED', 'İstek kaynağı geçersiz.', 403));
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  let opening: Promise<void> | undefined;
  const opened = () => (opening ??= options.onUnlocked().catch(error => { opening = undefined; throw error; }));
  app.post('/api/merkez/admin/unlock', async (req, res) => {
    local(req);
    const { code } = z.object({ code: z.string().trim().min(1).max(64) }).strict().parse(req.body);
    if (guard.state === 'locked') {
      try { await attempts.run(() => guard.unlock(code)); note(req, 'merkez.unlocked'); }
      catch (e) {
        if (e instanceof DomainError && e.code === 'INVALID_CODE') throw new DomainError('INVALID_CODE', 'Merkez kurtarma kodu 24 harf ve rakamdan oluşur (ör. ABCD-EFGH-…). Yazdırdığınız ya da kopyaladığınız kodu kontrol edin.', 400);
        if (e instanceof DomainError && e.code !== 'RATE_LIMIT') note(req, 'merkez.unlock_failed', e.code);
        throw e;
      }
    }
    await opened();
    res.json({ ok: true, warning: guard.warning ?? null });
  });
  app.post('/api/merkez/admin/unlock/retry', async (req, res) => {
    local(req);
    const ok = await guard.retry();
    if (ok) { note(req, 'merkez.unlock_retried'); await opened(); }
    res.json({ ok, reason: guard.lockReason ?? null });
  });
  app.use('/api', (_req, _res, next) => next(new DomainError('MERKEZ_LOCKED', 'Mola Merkez verileri kilitli. Merkez’in bilgisayarında Mola Yönetim’i açıp kurtarma koduyla kilidi açın.', 423)));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof DomainError) return void res.status(error.status).json({ code: error.code, message: error.message });
    if (error instanceof ZodError || (error as { type?: string })?.type === 'entity.parse.failed') return void res.status(400).json({ code: 'INVALID_INPUT', message: 'İstek geçersiz.' });
    console.error('Mola Merkez kilit ekranı:', error instanceof Error ? error.message : 'bilinmeyen hata');
    res.status(500).json({ code: 'SERVER_ERROR', message: 'Merkez açılamadı. Kayıtlara bakın (logs\\merkez.log).' });
  });
  return app;
}

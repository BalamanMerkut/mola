import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type Express } from 'express';
import type { ViteDevServer } from 'vite';
import { dataLock } from '../data-lock.js';
import type { HttpSecurity } from '../http-security.js';
import type { KdfParams } from '../key-vault.js';
import { addAlert } from './alerts.js';
import { createMerkezApp, sweepAlerts } from './app.js';
import type { Attachments } from './attachments.js';
import { besideData, MerkezBackups, MerkezRecovery } from './backup.js';
import { MerkezKeyGuard, type MerkezLock } from './key-guard.js';
import { lockedMerkezApp } from './locked.js';
import { MailQueue } from './mail.js';
import { MerkezStore } from './store.js';
import type { JournalInput } from './journal.js';
import type { WorkFolder } from './workfolder.js';
import { devAllowList, pageHeaders } from '../web-serving.js';
import { tunnelUpgrades, type GuestTunnelHub } from './guest-tunnel.js';
import { noticePage } from './notice-page.js';

/*
 * Mola Merkez as one process: its own data folder and data lock, its own key (sealed records), the API and the
 * Mola Yönetim screens (merkez.html; Vite in development, dist/ when serveBuild). Cafés never serve these screens.
 * Also its own nightly backup (beside the data folder: merkez-yedek/, MERKEZ_BACKUP_DIR; MOLA_AUTO_BACKUP=0 keeps only
 * "Şimdi yedekle"), the recovery code of its key, the e-mail queue and the clock-driven alerts (server/merkez/alerts.ts).
 * The data key (server/merkez/key-guard.ts): plain development.key, or with `protect` (MERKEZ_KEY_PROTECTION=1, the
 * installed Mola Yönetim) locked to the computer user once the recovery code is confirmed. A key the lock does not open
 * (another user, a reset Windows password, a new computer) starts Merkez locked: only the unlock screen
 * (server/merkez/locked.ts) until the recovery code opens it; then the full Merkez starts in the same process.
 * kdf/backupDirectory/osLock: tests.
 */
export type MerkezRuntimeOptions = { directory: string; port: number; host: '127.0.0.1' | '0.0.0.0'; serveBuild: boolean; buildDirectory?: string; protect?: boolean; initialPassword?: string; httpSecurity?: HttpSecurity; kdf?: KdfParams; backupDirectory?: string; releasesDirectory?: string; osLock?: MerkezLock };
export async function startMerkez(options: MerkezRuntimeOptions) {
  const directory = resolve(options.directory), release = dataLock(directory, 'merkez');
  let store: MerkezStore | undefined, vite: ViteDevServer | undefined, backups: MerkezBackups | undefined, mail: MailQueue | undefined, recovery: MerkezRecovery | undefined, sweep: NodeJS.Timeout | undefined;
  let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => { res.statusCode = 503; res.end(); };
  const server = createServer((req, res) => handler(req, res));
  let relayHub: { close(): void } | undefined, workFolder: WorkFolder | undefined, guestTunnel: GuestTunnelHub | undefined;
  // İnternetten menü: the cafés' guest tunnels arrive as WebSocket upgrades (server/merkez/guest-tunnel.ts); none while locked.
  tunnelUpgrades(server, () => guestTunnel);
  /** İşlem kayıtları lines from before the data opened (written once it does). */
  const pendingEvents: JournalInput[] = [];
  const close = async () => {
    backups?.stop(); mail?.stop(); clearInterval(sweep); workFolder?.stop(); try { relayHub?.close(); } catch { /* closed */ } try { guestTunnel?.close(); } catch { /* closed */ }
    try { await vite?.close(); if (server.listening) await new Promise<void>(done => { server.close(() => done()); server.closeIdleConnections(); setTimeout(() => server.closeAllConnections(), 2000).unref(); }); }
    finally { try { store?.close(); } finally { release(); } }
  };
  const build = resolve(options.buildDirectory ?? 'dist');
  /** The Mola Yönetim page and its files (also on the unlock screen); never shown inside another page. */
  const pages = (app: Express) => {
    pageHeaders(app, { frames: 'none', development: !options.serveBuild });
    // Köprü (server/merkez/relay.ts) names another page: the owner's phone page ("Raporlarım") or, in a Mola destek session,
    // the café's own screens (index.html of this same build).
    const page = (res: express.Response) => ['index.html', 'raporlarim.html'].includes(res.locals.molaPage) ? res.locals.molaPage as string : 'merkez.html';
    // Mola Yönetim is the page at "/" only (its screens change inside the page). Any other address nobody answered is a plain
    // 404 page (0.1.21): an owner's mistyped or old address never lands on Mola Yönetim's sign-in.
    const known = (req: express.Request, res: express.Response) => !!res.locals.molaPage || (req.path === '/' && ['GET', 'HEAD'].includes(req.method));
    const missing = (res: express.Response) => res.status(404).type('html').set('Cache-Control', 'no-store').send(noticePage({ status: 'missing', tr: 'Bu sayfa bulunamadı.', en: 'This page could not be found.' }));
    if (options.serveBuild) {
      app.use(express.static(build, { index: false }));
      app.use((req, res) => { if (known(req, res)) res.sendFile(page(res), { root: build }); else missing(res); });
    } else {
      // The same allow-list as the café's development server: browser code and page routes only.
      devAllowList(app, '');
      app.use(vite!.middlewares);
      app.use(async (req, res, next) => {
        if (!known(req, res)) { missing(res); return; }
        try { res.status(200).set('Content-Type', 'text/html').end(await vite!.transformIndexHtml(req.originalUrl, readFileSync(join(process.cwd(), page(res)), 'utf8'))); }
        catch (error) { next(error); }
      });
    }
    return app;
  };
  /** The whole Merkez on an open key. */
  const openFull = async (guard: MerkezKeyGuard) => {
    try { await openWith(guard); }
    catch (error) {
      // After an unlock the process goes on with the unlock screen: nothing half-open stays behind.
      backups?.stop(); mail?.stop(); clearInterval(sweep);
      try { store?.close(); } catch { /* already closed */ }
      store = undefined; backups = undefined; mail = undefined; recovery = undefined;
      throw error;
    }
  };
  const openWith = async (guard: MerkezKeyGuard) => {
    const key = guard.key!;
    store = new MerkezStore(directory, key, { initialPassword: options.initialPassword });
    const opened = store;
    // A protected key file carries the recovery block too: it seeds a lost merkez-kurtarma.json and follows every new code.
    recovery = await MerkezRecovery.open(directory, key, options.kdf, { seed: guard.seed(), onChange: file => guard.syncRecovery(file) });
    await guard.syncRecovery(recovery.file).catch(() => { guard.warning ??= 'Kurtarma kodu anahtar dosyasına yazılamadı. Bir sonraki açılışta yeniden denenecek.'; });
    const code = recovery;
    if (guard.migrated) opened.mutate(d => { d.audit.push({ action: 'merkez.key_protected', target: 'admin', at: new Date().toISOString(), by: 'system', detail: `Veri anahtarı ${guard.lock.kind === 'dpapi' ? 'Windows kullanıcısına (DPAPI)' : guard.lock.kind === 'keychain' ? 'Mac anahtarlığına' : guard.lock.kind === 'parola' ? 'sunucu parolasına' : 'dosyaya (600)'} ve Merkez kurtarma koduna kilitlendi` }); });
    // Installed Mola Yönetim (veri\): ...\Mola Yonetim\merkez-yedek; development (.local/merkez): .local/merkez-yedek.
    const beside = (name: string) => besideData(directory, name);
    // İşlem kayıtları: what happened before the data opened (locked start, unlock tries) and the key's state now.
    for (const e of pendingEvents.splice(0)) try { opened.journal.append(e); } catch { /* best effort */ }
    if (guard.warning) try { opened.journal.append({ action: 'merkez.key_warning', detail: guard.warning }); } catch { /* best effort */ }
    backups = new MerkezBackups(directory, { folder: options.backupDirectory ?? process.env.MERKEZ_BACKUP_DIR ?? beside('merkez-yedek'), checks: beside('merkez-yedek-prova'), auto: process.env.MOLA_AUTO_BACKUP !== '0', settings: join(directory, 'merkez-yedek-ayar.json'), protection: () => code.protection(),
      onFailure: message => opened.mutate(d => { addAlert(d, new Date().toISOString(), 'backup.failing', `Mola Merkez yedeği alınamadı: ${message}`); }),
      onAutomatic: s => { try { opened.journal.append(s.lastError ? { action: 'merkez.backup_auto_failed', detail: s.lastError } : { action: 'merkez.backup_auto', detail: `${s.kept ?? 0} yedek saklanıyor${s.second.folder ? `; ikinci yer ${s.second.lastError ? `kopyalanamadı (${s.second.lastError})` : 'kopyalandı'}` : ''}` }); } catch { /* closing */ } } });
    await backups.start();
    mail = new MailQueue(store); mail.start();
    // Destek ekleri older than 14 days are deleted with the same 10-minute tick (server/merkez/attachments.ts).
    let files: Attachments | undefined;
    // İşlem kayıtları: sealed hourly (sealIfDue), the retention clean-up once a day.
    let pruned = 0;
    const tick = () => { try { sweepAlerts(opened, new Date()); } catch { /* next time */ } try { files?.sweep(new Date()); } catch { /* next time */ }
      try { opened.journal.sealIfDue(); if (Date.now() - pruned > 86400_000) { pruned = Date.now(); opened.journal.prune(); } } catch { /* next time */ } };
    tick(); sweep = setInterval(tick, 10 * 60_000); sweep.unref();
    // Otomatik güncelleme: uploaded release bundles (installed: ...\Mola Yonetim\merkez-guncellemeler; development: .local/merkez-guncellemeler).
    // Destek ekleri: installed ...\Mola Yonetim\merkez-ekler; development .local/merkez-ekler. Not part of the backup.
    const app = createMerkezApp(store, { httpSecurity: options.httpSecurity, backups, recovery, releasesDirectory: options.releasesDirectory ?? beside('merkez-guncellemeler'), attachmentsDirectory: beside('merkez-ekler'),
      keyProtection: () => guard.view(code.view().confirmed), ...(options.serveBuild ? { buildDirectory: build } : {}) });
    files = app.locals.attachments as Attachments; tick();
    // Çalışma klasörü (C:\MolaCalisma for the installed Mola Yönetim, or the vendor's choice): kept up to date while Merkez runs.
    workFolder = app.locals.workFolder as WorkFolder; workFolder.start();
    // Köprü: its postbox database (<data>-kutu/kutu.sqlite) closes with Merkez.
    relayHub = app.locals.relayHub as { close(): void } | undefined;
    guestTunnel = app.locals.guestTunnel as GuestTunnelHub | undefined;
    handler = pages(app);
  };
  try {
    if (!options.serveBuild) {
      const { createServer: createVite } = await import('vite');
      vite = await createVite({ server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/.local/**', '**/test-results/**'] } }, appType: 'custom' });
    }
    const guard = await MerkezKeyGuard.open(directory, { protect: !!options.protect, osLock: options.osLock });
    if (guard.warning) console.warn(`Mola Merkez: ${guard.warning}`);
    if (guard.state === 'open') await openFull(guard);
    else {
      console.warn(`Mola Merkez verileri kilitli (${guard.lockReason ?? 'anahtar açılamadı'}). Mola Yönetim'i bu bilgisayarda açıp Merkez kurtarma koduyla kilidi açın.`);
      pendingEvents.push({ action: 'merkez.started_locked', at: new Date().toISOString(), source: 'sistem', ...(guard.lockReason ? { detail: guard.lockReason } : {}) });
      handler = pages(lockedMerkezApp(guard, { httpSecurity: options.httpSecurity, onUnlocked: () => openFull(guard), record: e => { if (pendingEvents.length < 200) pendingEvents.push(e); } }));
    }
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(options.port, options.host, () => { server.off('error', reject); done(); }); });
    return {
      server, guard, close,
      get store() { return store; }, get backups() { return backups; }, get recovery() { return recovery; },
    };
  } catch (error) {
    await close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`${options.port} portu başka bir uygulama tarafından kullanılıyor.`);
    throw error;
  }
}

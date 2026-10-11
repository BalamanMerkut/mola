import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse, resolve } from 'node:path';
import express, { type Request } from 'express';
import type { ViteDevServer } from 'vite';
import { Store } from './store.js';
import { createApp } from './app.js';
import { dataLock } from './data-lock.js';
import { configureHttpSecurity, directLoopback, type HttpSecurity } from './http-security.js';
import { assertBuildReady } from './build-readiness.js';
import { verifyPackage } from './package-integrity.js';
import { PrintService } from './printing.js';
import { BackupScheduler } from './backup-scheduler.js';
import { safetyCopyView } from './year-packer.js';
import { ChangeMarker } from './change-marker.js';
import { desktopGuard, desktopKey, desktopProof, type Desktop } from './desktop.js';
import { adoptKey, AttemptLimiter, KeyVault, type KdfParams } from './key-vault.js';
import { platformOsLock, type OsLock } from './os-lock.js';
import { SecondBackup, secondPlaceRoot } from './second-backup.js';
import { CloudBackup } from './cloud-backup.js';
import { plainError } from './backup-errors.js';
import { fromThisComputer, lockedRoutes, type Security } from './security-routes.js';
import { requestDiagnostics } from './request-diagnostics.js';
import { restoreBackup } from './backup.js';
import { DomainError } from '../packages/domain/engine.js';
import { MerkezLink, readSavedContact } from './kafe-link.js';
import { emptyContact, merkezPublicKey } from './license.js';
import { devAllowList, pageHeaders } from './web-serving.js';
import { UpdateAgent } from './update-agent.js';
import { IntegrityCheck, releaseBuild } from './integrity.js';

/**
 * keyProtection.protect: the master key is locked by the OS and a recovery code (packaged desktop runs). Off: the raw
 * development.key as before. osLock/kdf: tests replace Windows DPAPI and the measured scrypt cost.
 */
export type RuntimeOptions = { directory: string; port: number; host: '127.0.0.1' | '0.0.0.0'; serveBuild: boolean; cleanInstall: boolean; httpSecurity?: HttpSecurity; tls?: { key: Buffer; cert: Buffer }; buildDirectory?: string; desktopKeyFile?: string; desktopLoopback?: boolean; onDesktopShutdown?: () => void; onUpdateRestart?: () => void; keyProtection?: { protect: boolean; osLock?: OsLock; kdf?: KdfParams };
  /** Browser tests only: stands in another computer for Mola Merkez's "iki farklı bilgisayar" (default: the OS's machine id). */
  machineKey?: string };
type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const READY = '.geri-yukleme-hazir';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Folder renames on Windows can meet a file briefly held by antivirus or OneDrive: a few patient retries. */
async function rename(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return; }
    catch (error) { if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; await sleep(250 * (attempt + 1)); }
  }
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export async function startLocalServer(options: RuntimeOptions) {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Port 1–65535 arasında tam sayı olmalı.');
  verifyPackage(process.cwd());
  const buildDirectory = resolve(options.buildDirectory ?? 'dist');
  // Installed (launchers set MOLA_MODE=installed; any built-screens run counts too) hides developer wording and demo hints.
  const mode: 'development' | 'installed' = process.env.MOLA_MODE === 'installed' || options.serveBuild ? 'installed' : 'development';
  if (options.serveBuild) assertBuildReady(buildDirectory);
  if (options.tls && (!options.serveBuild || !options.httpSecurity?.publicOrigin || options.httpSecurity.trustLocalProxy)) throw new Error('Doğrudan HTTPS için derlenmiş arayüz ve sabit HTTPS adresi gerekli; proxy güveni kapalı olmalı.');
  const server = options.tls ? createHttpsServer({ ...options.tls, minVersion: 'TLSv1.2' }) : createServer();
  const directory = resolve(options.directory), staging = join(dirname(directory), `${basename(directory)}-geri-yukleme`);
  finishInterruptedRestore(directory, staging);
  let release = dataLock(directory, 'server');
  const protection = { protect: options.keyProtection?.protect ?? false, osLock: options.keyProtection?.osLock ?? platformOsLock(), kdf: options.keyProtection?.kdf };
  const attempts = new AttemptLimiter();
  let store: Store | undefined, vite: ViteDevServer | undefined, printer: PrintService | undefined, backups: BackupScheduler | undefined, packing: NodeJS.Timeout | undefined, link: MerkezLink | undefined, updates: UpdateAgent | undefined, integrity: IntegrityCheck | undefined;
  let vault: KeyVault | undefined, handler: Handler = (_req, res) => { res.statusCode = 503; res.end(); }, opening: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  function stopServices() {
    printer?.stop(); backups?.stop(); link?.stop(); updates?.stop(); integrity?.stop(); clearTimeout(packing);
    try { store?.close(); } finally { store = printer = backups = link = updates = integrity = undefined; opening = undefined; }
  }
  function close() {
    return closing ??= (async () => {
      // Stop upgrades/watchers before draining HTTP requests; do not cut an active payment short.
      try {
        // Uzaktan raporlar: the paired phones get the day's last encrypted summary (at most a few seconds; server/remote-reports.ts).
        await link?.flush().catch(() => {});
        printer?.stop(); backups?.stop(); link?.stop(); updates?.stop(); integrity?.stop(); clearTimeout(packing);
        await vite?.close();
      } finally {
        try {
          if (server.listening) await new Promise<void>((done, reject) => {
            server.close(error => error ? reject(error) : done());
            // Open windows keep connections alive with polling; without this the process never exits and the data
            // lock stays. Idle ones close now, running requests get a few seconds to finish.
            server.closeIdleConnections();
            setTimeout(() => server.closeAllConnections(), 3000).unref();
          });
        } finally {
          try { stopServices(); } finally { release(); }
        }
      }
    })();
  }
  try {
    vault = await KeyVault.open(directory, protection);
    if (vault.warning) console.warn(vault.warning);
    // Desktop app only: a key kept next to the data (reused on every start) for the launcher to pass to its own window.
    // Development (--masaustu): the rail also shows in this computer's own browser, so it can be tried without the desktop app.
    const loopback = options.desktopLoopback && !options.serveBuild ? (req: Request) => directLoopback(req, options.httpSecurity ?? {}) : undefined;
    const desktop: Desktop | undefined = options.desktopKeyFile || loopback ? { token: options.desktopKeyFile ? desktopKey(options.desktopKeyFile) : '', loopback, shutdown: () => options.onDesktopShutdown?.() } : undefined;
    if (!options.serveBuild) {
      const { createServer: createVite } = await import('vite');
      vite = await createVite({ server: { middlewareMode: true, hmr: { server }, watch: { ignored: ['**/.local/**', '**/test-results/**'] } }, appType: 'spa' });
    }
    // The screens are served the same way whether the data is open or locked (the locked screen is part of them).
    const frontend = (app: express.Express) => {
      // CSP, no framing by other sites (its own menu preview may frame it), no referrer, no sniffing.
      pageHeaders(app, { frames: 'self', development: !options.serveBuild });
      if (options.serveBuild) {
        app.use(express.static(buildDirectory));
        app.use((_req, res) => res.sendFile('index.html', { root: buildDirectory }));
        return;
      }
      // Development serving is an allow-list: browser code and page routes only. Server code, scripts, docs,
      // configs and data must never be readable by a phone on the same Wi-Fi in `dev:lan` mode (server/web-serving.ts).
      devAllowList(app, 'index.html');
      app.use(vite!.middlewares);
    };
    // Restore failures reach the owner in plain Turkish (a long path, a pulled flash drive, a damaged copy), never as a system message.
    const security: Security = { vault, attempts, restore: (backup, code) => restoreHere(backup, code).catch(error => { throw error instanceof DomainError ? error : new DomainError('RESTORE_FAILED', plainError(error, 'Yedek geri yüklenemedi. Başka bir yedek seçip yeniden deneyin.'), 409); }) };
    /** Store, printing, backups and the full API, once the key is open. Runs once; a restore runs it again for the new data. */
    function openServices() {
      return opening ??= (async () => {
        const current = vault!;
        store = new Store(directory, options.cleanInstall ? [] : undefined, { key: current.key! });
        printer = new PrintService(store); printer.start();
        // Nightly verified backup while running. Set MOLA_AUTO_BACKUP=0 to turn it off (tests, throwaway copies).
        if (process.env.MOLA_AUTO_BACKUP !== '0') {
          // Defaults sit next to the data folder (.local/development → .local/backups), so a test copy never mixes with real backups.
          const beside = (name: string) => join(dirname(directory), name);
          const folders = { backups: process.env.BACKUP_DIR ?? beside('backups'), keys: process.env.BACKUP_KEY_DIR ?? beside('backup-keys'), checks: process.env.BACKUP_CHECK_DIR ?? beside('restore-checks') };
          // A second copy only makes sense when a backup opens with the recovery code alone (protected installs).
          const second = current.installId ? new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), current.installId, { data: directory, backups: folders.backups, checks: folders.checks }) : undefined;
          // Sunucu yedeği (server/cloud-backup.ts): the same encrypted copy to Mola Merkez over the signed link, once activated
          // (the link is made just below; asked lazily). MOLA_SUNUCU_YEDEGI=0 turns it off.
          const cloud = current.installId && process.env.MOLA_SUNUCU_YEDEGI !== '0' ? new CloudBackup(join(folders.backups, 'sunucu-yedegi.json'), { ready: () => !!link?.relayReady() && link.installHas('cloud-backup'), accepts: () => link?.read()?.accepts, post: (path, body, timeout) => link ? link.relayPost(path, body, timeout) : Promise.reject(new DomainError('NOT_ACTIVATED', 'Mola Merkez bağlantısı yok.', 409)), postBytes: (path, data, timeout) => link ? link.relayPostBytes(path, data, timeout) : Promise.reject(new DomainError('NOT_ACTIVATED', 'Mola Merkez bağlantısı yok.', 409)) }, { dataVersion: () => Number(store!.db.prepare('PRAGMA user_version').get()?.user_version) }) : undefined;
          // A clean install has nothing to keep yet; its empty backup would only crowd the list on "Yedekten geri yükle".
          const db = store.db;
          // Değişiklik işareti (server/change-marker.ts): the nightly run is skipped when nothing really changed since the last backup.
          const opened = store;
          backups = new BackupScheduler(directory, { ...folders, protection: () => current.backupProtection(), second, cloud, changes: new ChangeMarker(db), idle: () => !db.prepare('SELECT tenant FROM snapshots LIMIT 1').get(),
            // "Yıl paketi 2025" in the backup screen's list (server/year-packages.ts): kept for good, stored once.
            packages: () => opened.packages.list().map(p => ({ year: p.year, bytes: p.size, sealedAt: p.sealedAt, ok: opened.packages.check(p.year)?.ok !== false })),
            // The readable copy before the first package: a line until it goes (90 days later, server/year-packer.ts).
            safetyCopy: () => safetyCopyView(opened) });
          await backups.start();
        }
        // Outbound only: the caf? calls Mola Merkez (MOLA_MERKEZ_URL); Merkez never connects to the caf?.
        link = new MerkezLink(store, options.machineKey ? { machineKey: options.machineKey } : {});
        // Otomatik güncelleme (server/update-agent.ts): packaged runs (and MOLA_GUNCELLEME=1). Downloads into guncelleme/ beside the
        // data folder; installing needs the watchdog (MOLA_NOBETCI=1), which applies the update when this server exits with 75.
        const updateDir = process.env.MOLA_GUNCELLEME_DIR ? resolve(process.env.MOLA_GUNCELLEME_DIR) : join(dirname(directory), 'guncelleme');
        // Program dosyaları denetimi (server/integrity.ts): only in a release build (npm run installer bakes MOLA_RELEASE_BUILD);
        // npm run dev, tests and the source pilot package never check. It only finds out and tells Merkez; it never blocks.
        if (releaseBuild(process.env.MOLA_RELEASE_BUILD)) { integrity =new IntegrityCheck({ appDir: process.cwd(), stateDir: join(updateDir, 'butunluk'), updateDir, publicKey: () => merkezPublicKey() }); link.integrity = integrity; }
        if (options.serveBuild || process.env.MOLA_GUNCELLEME === '1') {
          const scheduler = backups, check = integrity;
          const data = store;
          updates = new UpdateAgent({ dir: updateDir, link: link, publicKey: () => merkezPublicKey(), dataVersion: () => Number(data.db.prepare('PRAGMA user_version').get()?.user_version),
            canApply: process.env.MOLA_NOBETCI === '1' && !!options.onUpdateRestart, restart: options.onUpdateRestart,
            backup: scheduler ? async () => { const s = await scheduler.runNow(); return { ok: !s.lastError, error: s.lastError }; } : undefined,
            keepSigned: check ? (signed, appDir) => check.remember(signed, appDir) : undefined });
          link.updates = updates;
        }
        const app = createApp(store, undefined, undefined, { lan: options.host === '0.0.0.0', port: options.port, mode }, options.httpSecurity, undefined, printer, backups, desktop, security, link, updates);
        link.start(); updates?.start(); integrity?.start();
        // İnternetten menü (server/guest-tunnel.ts): the built guest page and its files go to guests through Mola Merkez; the
        // development server (Vite, no build) keeps the menu on this network only.
        if (options.serveBuild) (app.locals.guestTunnel as { serveFrom(dir: string): void }).serveFrom(buildDirectory);
        frontend(app);
        // Data version 3: history rows written before it are compressed in the background, a few milliseconds at a time,
        // shortly after start (store.close() ends the pass; the next start goes on from where it stopped).
        const opened = store;
        packing = setTimeout(() => void opened.history.compact().catch(error => console.error(`Geçmiş kayıtları sıkıştırılamadı: ${error instanceof Error ? error.message : error}`)), 10_000);
        packing.unref();
        handler = app;
      })().catch(error => { stopServices(); throw error; });
    }
    /** Locked (the OS lock did not open the key): a small app that only unlocks, for this computer's own window. */
    function lockedApp() {
      const app = express(); app.disable('x-powered-by'); app.set('env', 'production');
      const diagnostics = requestDiagnostics(event => console.error(JSON.stringify(event)));
      app.use('/api', diagnostics.begin);
      app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff'); next(); });
      configureHttpSecurity(app, options.httpSecurity ?? {});
      app.use('/api', (req, _res, next) => { if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(new DomainError('JSON_REQUIRED', 'JSON içerik gerekli.', 415)); next(); });
      app.use(express.json({ limit: '4kb' }));
      const guard = desktopGuard(desktop);
      // The Mola team's contact (signed by Merkez, kept beside the data, not in it): reachable even while the data is locked.
      app.get('/api/contact', (_q, r) => { const c = readSavedContact(directory, merkezPublicKey()); r.json({ contact: c && !emptyContact(c) ? { phone: c.phone, whatsapp: c.whatsapp, email: c.email, hours: c.hours, web: c.web } : null }); });
      lockedRoutes(app, req => { guard(req); if (!fromThisComputer(req)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404); }, { vault: vault!, attempts, network: { lan: options.host === '0.0.0.0', mode }, open: openServices, shutdown: desktop ? () => desktop.shutdown() : undefined, desktopHealth: req => !!desktop?.loopback?.(req) });
      app.use(diagnostics.error);
      frontend(app);
      return app;
    }
    /**
     * Clean install, desktop window: restore a protected backup with the owner's recovery code. It is restored and verified in
     * its own folder, its key is locked for this computer, then it takes the data folder's place; the empty install is kept aside.
     */
    async function restoreHere(backup: string, code: string) {
      let restored: Awaited<ReturnType<typeof restoreBackup>>;
      try { restored = await restoreBackup(resolve(backup), { code }, staging); }
      catch (error) {
        // A half-restored folder is of no use here and may hold an old backup's raw key: it goes.
        for (const e of existsSync(staging) ? readdirSync(staging, { withFileTypes: true }) : []) if (e.isDirectory() && existsSync(join(staging, e.name, 'RESTORE_FAILED.txt'))) rmSync(join(staging, e.name), { recursive: true, force: true });
        throw error;
      }
      if (!restored.master || !restored.recovery || !restored.installId) throw new DomainError('OLD_BACKUP', 'Bu yedek kurtarma koduyla açılmıyor.', 409);
      try { await adoptKey(restored.directory, restored.master, restored.recovery, restored.installId, protection.osLock); }
      catch (error) { rmSync(restored.directory, { recursive: true, force: true }); throw error; }
      writeFileSync(join(restored.directory, READY), 'Doğrulandı; veri klasörünün yerine geçecek.\n');
      handler = busyApp();
      const aside = `${directory}-bos-kurulum-${stamp()}`;
      let swapped = false;
      stopServices(); release();
      try {
        await rename(directory, aside);
        try { await rename(restored.directory, directory); swapped = true; }
        catch (error) { await rename(aside, directory); throw error; }
        rmSync(join(directory, READY), { force: true });
        release = dataLock(directory, 'server');
        await reopen();
        if (vault!.state !== 'open') throw new Error('Geri yüklenen veri açılamadı.');
        await keepSecondPlace(backup);
      } catch (error) {
        // Back to the empty install; a restored copy that did not open is kept next to it for a second look.
        try {
          if (swapped) { stopServices(); release(); await rename(directory, `${directory}-geri-yukleme-hatali-${stamp()}`); await rename(aside, directory); }
          release = dataLock(directory, 'server'); await reopen();
        } catch (inner) { console.error(`Geri yükleme sonrası eski kurulum açılamadı: ${inner instanceof Error ? inner.message : inner}`); }
        throw error;
      }
    }
    /**
     * The second place survives a restore: a place chosen on this computer stays as it is; otherwise the flash drive or folder
     * the backup came from (its Mola-Yedek layout) becomes the second place, so the next backups go on there. Best effort.
     */
    async function keepSecondPlace(backup: string) {
      const second = backups?.second, root = secondPlaceRoot(backup);
      if (!second || second.status().folder || !root) return;
      const drive = parse(root).root === root, cloud = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].some(p => p && resolve(p).toLowerCase() === root.toLowerCase());
      await second.choose(root, cloud ? 'onedrive' : drive ? 'usb' : 'folder', cloud ? 'OneDrive' : drive ? `Flash bellek (${root.replace(/[\\/]+$/, '')})` : undefined).catch(() => undefined);
    }
    function busyApp() {
      const app = express(); app.disable('x-powered-by'); app.set('env', 'production');
      app.use('/api', (_req, res) => { res.status(503).json({ code: 'RESTORING', message: 'Veriler geri yükleniyor. Birkaç saniye bekleyin.' }); });
      frontend(app);
      return app;
    }
    async function reopen() {
      vault = await KeyVault.open(directory, protection);
      security.vault = vault;
      if (vault.state === 'open') await openServices(); else handler = lockedApp();
    }
    if (vault.state === 'open') await openServices(); else { console.warn(`Veriler kilitli. ${vault.lockReason ?? 'İşletim sistemi kilidi anahtarı açmadı.'} Kurtarma kodu gerekli.`); handler = lockedApp(); }
    // The launchers' ownership proof is answered in every state (open, locked, restoring): server/desktop.ts.
    server.on('request', (req, res) => { if (!desktopProof(desktop, req, res)) handler(req, res); });
    await new Promise<void>((done, reject) => {
      const fail = (error: Error) => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', fail); done(); };
      server.once('error', fail); server.once('listening', ready); server.listen(options.port, options.host);
    });
    return { server, close, vault: () => vault! };
  } catch (error) {
    await close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`${options.port} portu başka bir uygulama tarafından kullanılıyor. Diğer sunucuyu kapatın veya PORT değerini değiştirin.`);
    throw error;
  }
}
/**
 * A restore that stopped between "empty install set aside" and "restored folder moved in" leaves no data folder. The verified,
 * re-locked folder carries a marker; it is moved into place before anything else starts. Otherwise nothing is touched.
 */
function finishInterruptedRestore(directory: string, staging: string) {
  if (existsSync(directory) || !existsSync(staging)) return;
  const ready = readdirSync(staging, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(staging, e.name, READY))).map(e => e.name).sort().reverse();
  if (!ready.length) return;
  renameSync(join(staging, ready[0]), directory);
  rmSync(join(directory, READY), { force: true });
}

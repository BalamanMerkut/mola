/*
 * Kılavuz ekranları için geçici sunucular: bir Mola Merkez (3490) ve bir kafe (3400), ikisi de .local/e2e/kilavuz-*\/ altında
 * yeni klasörlerle. Kafe verisi scripts/demo-template.ts ile kurulur (12 günlük gerçekçi örnek işletme "Mola Örnek Kafe",
 * Merkez'e kayıtlı; kurulum scripts/site-videos.ts ile aynı). Gerçek kurulumlara (%LOCALAPPDATA%\Mola*, C:\MolaCalisma,
 * .local/merkez, .local/ornek-*, .local/development) dokunmaz. Portlar: E2E_PORT (3400) ve E2E_MERKEZ_PORT (3490).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

export const KAFE_PORT = process.env.E2E_PORT ?? '3400';
export const MERKEZ_PORT = process.env.E2E_MERKEZ_PORT ?? '3490';
export const KAFE = `http://127.0.0.1:${KAFE_PORT}`;
export const MERKEZ = `http://127.0.0.1:${MERKEZ_PORT}`;
export const PASSWORD = 'MolaDemo!2026';
export const ADMIN_PASSWORD = 'Kilavuz-Mavi-Kayik!26';

const quiet = { ...process.env, MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0' };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function portFree(port: string) {
  return new Promise<boolean>(done => { const probe = createServer(); probe.once('error', () => done(false)); probe.listen(Number(port), '127.0.0.1', () => probe.close(() => done(true))); });
}
async function waitFor(url: string, what: string, child: ChildProcess) {
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* açılıyor */ }
    if (child.exitCode !== null) throw new Error(`${what} kapandı (çıkış ${child.exitCode}).`);
    if (i > 400) throw new Error(`${what} açılmadı.`);
    await sleep(250);
  }
}

export type Sunucular = { root: string; kafeDir: string; merkezDir: string; stop: () => void };

export async function startServers(): Promise<Sunucular> {
  for (const port of [KAFE_PORT, MERKEZ_PORT]) if (!await portFree(port)) throw new Error(`Port ${port} kullanımda. Açık kalmış bir sunucuyu kapatın.`);
  const root = resolve('.local/e2e', `kilavuz-${new Date().toISOString().replace(/[:.]/g, '-')}`), merkezDir = join(root, 'merkez'), kafeDir = join(root, 'kafe');
  mkdirSync(root, { recursive: true });
  const children: ChildProcess[] = [];
  const stop = () => {
    for (const child of children) if (child.exitCode === null && child.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill();
    }
  };
  process.on('exit', stop);
  try {
    const merkez = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, MERKEZ_PORT, MERKEZ_DATA_DIR: merkezDir, SERVE_BUILD: '1', MERKEZ_INITIAL_PASSWORD: ADMIN_PASSWORD } });
    children.push(merkez);
    await waitFor(`${MERKEZ}/api/merkez/v1/health`, 'Mola Merkez', merkez);
    console.log('Örnek işletme kuruluyor (birkaç dakika sürer)…');
    // 12 gün: örnek üreticinin sahte saati Merkez'in imzalı nabzını almaz, kafe 14 gün nabızsız kalınca yeni siparişi kapatır.
    // Üretici sahte saati saatlerce atlarken sahibin kilidini kendisi kapalı tutar ve sonunda varsayılana döndürür (8 Ekim).
    const demo = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/demo-template.ts', kafeDir, '--gun=12', '--sektor=kafe'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024,
      env: { ...quiet, MOLA_MERKEZ_URL: MERKEZ, MERKEZ_DATA_DIR: merkezDir, MERKEZ_ADMIN_PASSWORD: ADMIN_PASSWORD },
    });
    writeFileSync(join(root, 'ornek-isletme.log'), demo.stdout ?? '');
    if (!/Örnek işletme hazır:/.test(demo.stdout ?? '')) throw new Error(`Örnek işletme kurulamadı (ayrıntı: ${join(root, 'ornek-isletme.log')}).`);
    const kafe = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      stdio: ['ignore', 'ignore', 'inherit'],
      // Otomatik yedek açık (ekranlarda "Son yedek" görünsün), yedekler yalnız bu geçici klasöre.
      env: { ...quiet, MOLA_AUTO_BACKUP: '1', BACKUP_DIR: join(root, 'yedek'), BACKUP_KEY_DIR: join(root, 'yedek-anahtar'), BACKUP_CHECK_DIR: join(root, 'yedek-prova'), PORT: KAFE_PORT, SERVE_BUILD: '1', DATA_DIR: kafeDir, MOLA_CLEAN_INSTALL: '1', MOLA_DESKTOP_KEY: join(root, 'masaustu.anahtar'), MOLA_MERKEZ_URL: MERKEZ,
        MOLA_MERKEZ_PUBLIC_KEY: join(merkezDir, 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000', MOLA_TEST_TUNNEL: '1', MOLA_TUNNEL_RETRY_MS: '500',
        // QR siparişleri: misafir ekranları personel ekranı açık olmadan da çekilsin; "kapalı" çekimi kuralı açar (POST /api/test/qr-staff).
        MOLA_QR_STAFF_CHECK: '0', MOLA_MIRROR_DELAY_MS: '500' },
    });
    children.push(kafe);
    await waitFor(`${KAFE}/api/health`, 'Kafe sunucusu', kafe);
    return { root, kafeDir, merkezDir, stop };
  } catch (error) { stop(); throw error; }
}

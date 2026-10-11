import { resolve } from 'node:path';
import { canonicalOrigin } from './http-security.js';
import { startLocalServer } from './runtime.js';

if (process.env.NODE_ENV === 'production') throw new Error('Bu sürüm yalnızca yerel geliştirme içindir. Üretim güvenlik paketleri tamamlanmadan başlatılamaz.');
const host = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const publicOrigin = canonicalOrigin(process.env.PUBLIC_ORIGIN);
const trustLocalProxy = process.env.TRUST_LOCAL_PROXY === '1';
if (trustLocalProxy && !publicOrigin) throw new Error('TRUST_LOCAL_PROXY için PUBLIC_ORIGIN gerekli.');
if (publicOrigin && !trustLocalProxy) throw new Error('Bu HTTP başlatıcısında HTTPS test için aynı makinede TLS proxy ve TRUST_LOCAL_PROXY=1 gerekli.');
if (publicOrigin && (host !== '127.0.0.1' || process.env.SERVE_BUILD !== '1')) throw new Error('HTTPS test yapılandırması loopback ve SERVE_BUILD=1 gerektirir.');
const port = Number(process.env.PORT ?? 3000);
let stop = () => {}, update = () => {};
/** Exit code that tells the watchdog (app/nobetci.mjs) to apply a downloaded update now (otomatik güncelleme). */
const APPLY_UPDATE = 75;
try {
  // MOLA_DESKTOP_KEY: set by the desktop app launchers; gives their own window the side rail.
  const desktopKeyFile = process.env.MOLA_DESKTOP_KEY ? resolve(process.env.MOLA_DESKTOP_KEY) : undefined;
  // Key protection (Windows DPAPI / macOS Keychain + recovery code): on in the packaged desktop app, off in `npm run dev` and tests.
  const protect = (process.env.SERVE_BUILD === '1' && !!desktopKeyFile) || process.env.MOLA_KEY_PROTECTION === '1';
  // A locked install is unlocked only from the desktop window (or development's own browser with --masaustu).
  if (protect && !desktopKeyFile && (process.env.SERVE_BUILD === '1' || !process.argv.includes('--masaustu'))) console.warn('Anahtar koruması açık ama masaüstü penceresi yok (MOLA_DESKTOP_KEY): veriler kilitlenirse kilit açılamaz.');
  const runtime = await startLocalServer({ directory: resolve(process.env.DATA_DIR ?? '.local/development'), port, host, serveBuild: process.env.SERVE_BUILD === '1', cleanInstall: process.env.MOLA_CLEAN_INSTALL === '1', httpSecurity: { publicOrigin, trustLocalProxy }, desktopKeyFile, desktopLoopback: process.argv.includes('--masaustu'), onDesktopShutdown: () => stop(), onUpdateRestart: () => update(), keyProtection: { protect } });
  console.log(`Mola yerel test: http://localhost:${port}`);
  console.log(host === '0.0.0.0' ? 'LAN test modu. Yalnızca güvendiğiniz yerel ağda kullanın.' : 'Yalnızca bu bilgisayardan erişilebilir.');
  let stopping = false;
  stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('Sunucu kapanıyor; devam eden istekler tamamlanıyor.');
    void runtime.close().then(() => process.exit(0), () => { console.error('Sunucu kapanışı tamamlanamadı. Veri klasörünü kontrol edin.'); process.exit(1); });
  };
  // "Şimdi kur" / idle install: close cleanly (data released), then the watchdog swaps the program and starts the new one.
  update = () => {
    if (stopping) return;
    stopping = true;
    console.log('Güncelleme kurulacak: sunucu kapanıyor, nöbetçi yeni sürümü yerleştirip başlatacak.');
    void runtime.close().then(() => process.exit(APPLY_UPDATE), () => { console.error('Sunucu kapanışı tamamlanamadı; güncelleme bir sonraki açılışa kaldı.'); process.exit(1); });
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sunucu başlatılamadı.');
  process.exitCode = 1;
}

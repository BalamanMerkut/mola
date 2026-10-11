// Browser tests only: a built (SERVE_BUILD) server with key protection on, where Windows DPAPI is replaced by a test lock
// named by MOLA_TEST_OS_USER (another name = another Windows user or computer) and scrypt is cheap. Never used by the app.
import { resolve } from 'node:path';
import { startLocalServer } from '../server/runtime.js';
import { FAST_KDF, fakeOsLock } from '../tests/fake-os-lock.js';

const port = Number(process.env.PORT);
const runtime = await startLocalServer({
  directory: resolve(process.env.DATA_DIR!), port, host: '127.0.0.1', serveBuild: true, cleanInstall: process.env.MOLA_CLEAN_INSTALL === '1',
  desktopKeyFile: resolve(process.env.MOLA_DESKTOP_KEY!), onDesktopShutdown: () => void runtime.close().then(() => process.exit(0)),
  keyProtection: { protect: true, osLock: fakeOsLock(process.env.MOLA_TEST_OS_USER ?? 'kafe-pc'), kdf: FAST_KDF },
  // Another test user is another computer for Mola Merkez too (sunucu yedeği: the old computer is locked after a taşıma).
  machineKey: `test:${process.env.MOLA_TEST_OS_USER ?? 'kafe-pc'}`,
});
console.log(`Korumalı test sunucusu: http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void runtime.close().then(() => process.exit(0)));

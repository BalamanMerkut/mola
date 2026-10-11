// Browser tests only: a built Mola Merkez (SERVE_BUILD) with key protection on (MERKEZ_KEY_PROTECTION=1, like the installed
// Mola Yönetim), where Windows DPAPI is replaced by a test lock named by MOLA_TEST_OS_USER (another name = another Windows
// user or computer) and scrypt is cheap. Never used by the app or packaged.
//   MERKEZ_DATA_DIR, MERKEZ_PORT, MOLA_TEST_OS_USER, MERKEZ_INITIAL_PASSWORD (optional)
import { resolve } from 'node:path';
import { startMerkez } from '../server/merkez/runtime.js';
import { FAST_KDF, fakeOsLock } from '../tests/fake-os-lock.js';

const port = Number(process.env.MERKEZ_PORT);
const runtime = await startMerkez({
  directory: resolve(process.env.MERKEZ_DATA_DIR!), port, host: '127.0.0.1', serveBuild: true, protect: true,
  initialPassword: process.env.MERKEZ_INITIAL_PASSWORD || undefined, kdf: FAST_KDF, osLock: fakeOsLock(process.env.MOLA_TEST_OS_USER ?? 'satici'),
});
console.log(`Korumalı test Merkezi: http://127.0.0.1:${port} (${runtime.guard.state === 'locked' ? 'kilitli' : 'açık'})`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void runtime.close().then(() => process.exit(0)));

import { resolve } from 'node:path';
import { canonicalOrigin } from '../http-security.js';
import { startMerkez } from './runtime.js';

// Mola Merkez: licences, support and the vendor's Mola Yönetim. Never business data. `npm run merkez` / `npm run merkez:dev`.
const host = process.argv.includes('--lan') || process.env.MERKEZ_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const publicOrigin = canonicalOrigin(process.env.PUBLIC_ORIGIN), trustLocalProxy = process.env.TRUST_LOCAL_PROXY === '1';
if (trustLocalProxy && !publicOrigin) throw new Error('TRUST_LOCAL_PROXY için PUBLIC_ORIGIN gerekli.');
const port = Number(process.env.MERKEZ_PORT ?? 4000);
try {
  const runtime = await startMerkez({
    directory: process.env.MERKEZ_DATA_DIR ?? '.local/merkez', port, host, serveBuild: process.env.SERVE_BUILD === '1' || process.argv.includes('--build'),
    protect: process.env.MERKEZ_KEY_PROTECTION === '1', initialPassword: process.env.MERKEZ_INITIAL_PASSWORD || undefined,
    httpSecurity: { publicOrigin, trustLocalProxy },
  });
  console.log(`Mola Merkez: http://localhost:${port} (veri: ${resolve(process.env.MERKEZ_DATA_DIR ?? '.local/merkez')})`);
  console.log(`Kafe sunucuları için açık anahtar: ${resolve(process.env.MERKEZ_DATA_DIR ?? '.local/merkez', 'merkez-public-key.txt')}`);
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void runtime.close().then(() => process.exit(0), () => process.exit(1)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Mola Merkez başlatılamadı.');
  process.exitCode = 1;
}

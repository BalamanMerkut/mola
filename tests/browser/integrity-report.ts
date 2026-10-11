// Browser tests only (tests/browser/platform-integrity.spec.ts): one real, signed heartbeat from a café data folder (its café
// server must be stopped) that carries a program files report, as a packaged café would send it (server/integrity.ts).
//   node --import tsx tests/browser/integrity-report.ts <data folder> <merkez url> <merkez public key file> changed|ok
import { readFileSync } from 'node:fs';
import { dataLock } from '../../server/data-lock.js';
import { MerkezLink } from '../../server/kafe-link.js';
import { KeyVault } from '../../server/key-vault.js';
import { publicKeyFrom } from '../../server/license.js';
import { Store } from '../../server/store.js';
import { APP_VERSION } from '../../server/license.js';

const [directory, url, keyFile, state] = process.argv.slice(2);
const release = dataLock(directory, 'integrity-report');
const vault = await KeyVault.open(directory, { protect: false });
const store = new Store(directory, [], { key: vault.key! });
try {
  const link = new MerkezLink(store, { url, publicKey: publicKeyFrom(readFileSync(keyFile, 'utf8')) });
  const at = new Date().toISOString();
  link.integrity = { manifest: () => undefined, report: () => state === 'ok' ? { state: 'ok', version: APP_VERSION, platform: 'windows', at }
    : { state: 'changed', version: APP_VERSION, platform: 'windows', at, changed: ['app/server.mjs', 'app/dist/assets/index-3f9a.js'], missing: ['Mola-Durdur.cmd'] } };
  // The first heartbeat learns what this Merkez takes ('integrity'); the second carries the report.
  for (let i = 0; i < 2; i++) { const r = await link.sync(); if (!r.ok) throw new Error(r.error); }
} finally { store.close(); release(); }

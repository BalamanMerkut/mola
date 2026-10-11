import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { startLocalServer } from '../server/runtime.js';
import { localHttpsConfig } from '../server/local-https-config.js';

if (process.env.NODE_ENV === 'production') throw new Error('Bu başlatıcı yalnız yerel HTTPS testi içindir.');
const folder = resolve(process.env.HTTPS_CERT_DIR ?? '.local/https');
const addresses = Object.values(networkInterfaces()).flatMap(items => items ?? []).map(item => item.address);
try {
const config = localHttpsConfig(folder, addresses);
if (!existsSync(resolve('dist/index.html'))) throw new Error('Derlenmiş arayüz bulunamadı. Önce npm.cmd run build çalıştırın.');
if (config.expiresSoon) console.warn(`Test sertifikasının süresi yakında dolacak: ${config.expiresAt}`);
const port = 3443, origin = `https://${config.address}:${port}`;
const runtime = await startLocalServer({ directory: resolve('.local/https-test-data'), port, host: '0.0.0.0', serveBuild: true, cleanInstall: false,
  tls: config.tls, httpSecurity: { publicOrigin: origin } });
console.log(`Ayrı demo verisiyle yerel HTTPS: ${origin}\nTelefon/tablete yalnız Mola-Local-Test-CA.cer aktarılır; özel anahtar paylaşılmaz.`);
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; void runtime.close().then(() => process.exit(0), () => process.exit(1)); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) { console.error(error instanceof Error ? error.message : 'Yerel HTTPS başlatılamadı.'); process.exitCode = 1; }

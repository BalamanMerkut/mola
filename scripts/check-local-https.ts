import { request } from 'node:https';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { startLocalServer } from '../server/runtime.js';

const certDir = resolve(process.env.HTTPS_CERT_DIR ?? '.local/https');
mkdirSync('.local/tests', { recursive: true });
const directory = mkdtempSync(resolve('.local/tests/https-'));
const port = 3444, origin = `https://localhost:${port}`;
const runtime = await startLocalServer({ directory, port, host: '127.0.0.1', serveBuild: true, cleanInstall: false,
  tls: { key: readFileSync(join(certDir, 'server-key.pem')), cert: readFileSync(join(certDir, 'server-cert.pem')) }, httpSecurity: { publicOrigin: origin } });
function call(path: string, body?: unknown, headers: Record<string, string> = {}, trusted = true) {
  return new Promise<{ status: number; body: any; cookies: string[] }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', ca: trusted ? readFileSync(join(certDir, 'ca.pem')) : undefined,
      headers: { 'Content-Type': 'application/json', ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text), cookies: res.headers['set-cookie'] ?? [] }));
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('TLS kontrolü zaman aşımı.')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
try {
  assert.equal((await call('/api/health')).status, 200);
  await assert.rejects(call('/api/health', undefined, {}, false));
  const credentials = { username: 'isletme', password: 'MolaDemo!2026' };
  assert.equal((await call('/api/login', credentials)).status, 403);
  assert.equal((await call('/api/login', credentials, { Origin: 'https://foreign.example', 'X-Forwarded-Proto': 'https' })).status, 403);
  const login = await call('/api/login', credentials, { Origin: origin });
  assert.equal(login.status, 200);
  assert.match(login.cookies[0], /; Secure/i); assert.match(login.cookies[0], /; HttpOnly/i); assert.match(login.cookies[0], /SameSite=Strict/i);
  const network = await call('/api/staff/network', undefined, { Cookie: login.cookies[0].split(';')[0] });
  assert.equal(network.status, 200); assert.equal(network.body.addresses[0].origin, origin);
  console.log('HTTPS doğrulandı: güvenilir sertifika, güvenilmeyen sertifika reddi, Origin kontrolü, Secure çerez ve HTTPS QR adresi.');
} finally { await runtime.close(); }

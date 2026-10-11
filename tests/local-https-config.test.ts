import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { localHttpsConfig } from '../server/local-https-config.js';

// The certificate script needs PowerShell 7 (.NET 7 PEM APIs); Windows PowerShell 5.1 is told so explicitly.
const pwsh = process.platform === 'win32' && spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;
test('local HTTPS validates real certificate dates, IP, chain and key without changing files', { skip: process.platform !== 'win32' ? 'Windows only' : !pwsh ? 'PowerShell 7 (pwsh) kurulu değil' : false }, () => {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(resolve('.local/tests/tls-config-')), folder = join(root, 'cert');
  assert.throws(() => localHttpsConfig(folder, ['127.0.0.1']), /ayar dosyası/);
  const generated = spawnSync('pwsh', ['-NoProfile', '-File', resolve('scripts/local-https-cert.ps1'), '-Address', '127.0.0.1', '-OutputDirectory', folder], { encoding: 'utf8', windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  const cert = new X509Certificate(readFileSync(join(folder, 'server-cert.pem')));
  const valid = Date.parse(cert.validFrom) + 3600000;
  assert.equal(localHttpsConfig(folder, ['127.0.0.1'], valid).expiresSoon, false);
  assert.equal(localHttpsConfig(folder, ['127.0.0.1'], Date.parse(cert.validTo) - 86400000).expiresSoon, true);
  assert.throws(() => localHttpsConfig(folder, ['127.0.0.1'], Date.parse(cert.validTo)), /süresi dolmuş/);
  assert.throws(() => localHttpsConfig(folder, ['127.0.0.1'], Date.parse(cert.validFrom) - 1), /henüz geçerli/);
  assert.throws(() => localHttpsConfig(folder, [], valid), /IP bu bilgisayarda yok/);
  const config = join(folder, 'config.json'), original = readFileSync(config);
  for (const address of ['8.8.8.8', '192.168.999.1', 'localhost', null]) {
    writeFileSync(config, JSON.stringify({ address })); assert.throws(() => localHttpsConfig(folder, [String(address)], valid), /yerel bir IPv4/);
  }
  writeFileSync(config, JSON.stringify({ address: '192.168.1.99' }));
  assert.throws(() => localHttpsConfig(folder, ['192.168.1.99'], valid), /uyuşmuyor/);
  writeFileSync(config, original);
  const before = readFileSync(join(folder, 'server-cert.pem'));
  writeFileSync(join(folder, 'server-key.pem'), 'invalid');
  assert.throws(() => localHttpsConfig(folder, ['127.0.0.1'], valid), /uyuşmuyor/);
  assert.deepEqual(readFileSync(join(folder, 'server-cert.pem')), before);
  assert.equal(existsSync(join(folder, 'ca-key.pem')), false);
});

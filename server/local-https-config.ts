import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { X509Certificate, createPrivateKey } from 'node:crypto';

export function localHttpsConfig(folder: string, addresses: string[], now = Date.now()) {
  let config: { address?: unknown };
  try { config = JSON.parse(readFileSync(join(folder, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('HTTPS ayar dosyası eksik veya okunamıyor. Önce yerel sertifika oluşturma adımını tamamlayın.'); }
  const address = config?.address;
  if (typeof address !== 'string' || isIP(address) !== 4 || !/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)/.test(address)) throw new Error('HTTPS test adresi yerel bir IPv4 adresi olmalı.');
  if (!addresses.includes(address)) throw new Error('Sertifikadaki IP bu bilgisayarda yok. IP değişmiş olabilir; sertifikayı yeni klasörde yeniden oluşturun.');
  let key: Buffer, cert: Buffer, ca: X509Certificate, leaf: X509Certificate;
  try {
    key = readFileSync(join(folder, 'server-key.pem')); cert = readFileSync(join(folder, 'server-cert.pem'));
    leaf = new X509Certificate(cert); ca = new X509Certificate(readFileSync(join(folder, 'ca.pem')));
    if (!leaf.checkPrivateKey(createPrivateKey(key)) || !ca.ca || !leaf.verify(ca.publicKey) || leaf.checkIP(address) !== address) throw new Error();
  } catch { throw new Error('HTTPS sertifikası, özel anahtar veya test adresi uyuşmuyor. Sertifikayı yeni klasörde yeniden oluşturun.'); }
  for (const certificate of [leaf, ca]) {
    if (now < Date.parse(certificate.validFrom)) throw new Error('HTTPS sertifikası henüz geçerli değil. Bilgisayarın tarih ve saatini kontrol edin.');
    if (now >= Date.parse(certificate.validTo)) throw new Error('HTTPS sertifikasının süresi dolmuş. Yeni test sertifikası oluşturun.');
  }
  const expiresAt = new Date(Math.min(Date.parse(leaf.validTo), Date.parse(ca.validTo))).toISOString();
  return { address, tls: { key, cert }, expiresAt, expiresSoon: Date.parse(expiresAt) - now <= 7 * 86400000 };
}

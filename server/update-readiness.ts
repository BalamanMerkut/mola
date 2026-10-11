import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathsOverlap } from './backup-paths.js';
import { verifyPackage } from './package-integrity.js';
import { assertBuildReady } from './build-readiness.js';
import { assertRestoreReady } from './restore-safety.js';
import { readKeyFile } from './key-vault.js';

function packageInfo(root: string, requireDataFormat = false) {
  if (verifyPackage(root) !== 'verified') throw new Error('Güncelleme kontrolü manifestli pilot paketleri gerektirir.');
  assertBuildReady(join(root, 'dist'));
  const content = readFileSync(join(root, 'manifest.json'));
  const manifest = JSON.parse(content.toString());
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'mola-cafe' || typeof pkg.version !== 'string' || manifest.version !== pkg.version) throw new Error('Paket adı veya sürüm bilgisi uyuşmuyor.');
  let dataFormat: { minReadable: number; maxReadable: number; writeVersion: number } | null = null;
  const formatPath = 'packages/domain/data-format.json';
  if (manifest.files.some((entry: { file: string }) => entry.file === formatPath)) {
    const value = JSON.parse(readFileSync(join(root, formatPath), 'utf8'));
    if (value.format !== 1 || ![value.minReadable, value.maxReadable, value.writeVersion].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647) || value.minReadable > value.maxReadable || value.writeVersion < value.minReadable || value.writeVersion > value.maxReadable) throw new Error('Paketin veri biçimi bildirimi geçersiz.');
    dataFormat = { minReadable: value.minReadable, maxReadable: value.maxReadable, writeVersion: value.writeVersion };
  } else if (requireDataFormat) throw new Error('Yeni paketin doğrulanmış veri biçimi bildirimi eksik. Güncel pilot paketi oluşturun.');
  return { version: pkg.version, dataFormat, fingerprint: createHash('sha256').update(content).digest('hex') };
}
/** Read-only preflight. Does not execute candidate code or establish migration compatibility. */
export function updateReadiness(currentPath: string, candidatePath: string, dataPath: string) {
  const current = realpathSync(currentPath), candidate = realpathSync(candidatePath), data = realpathSync(dataPath);
  if (![current, candidate, data].every(p => statSync(p).isDirectory())) throw new Error('Paket ve veri yolları mevcut klasörler olmalı.');
  if (pathsOverlap(current, candidate)) throw new Error('Eski ve yeni paket ayrı klasörlerde olmalı; birbirinin altına açmayın.');
  const currentInData = relative(data, current);
  if (pathsOverlap(candidate, data) || (!isAbsolute(currentInData) && currentInData !== '..' && !currentInData.startsWith(`..${sep}`))) throw new Error('Yeni paket veri klasöründen ayrı olmalı; veri klasörünün içine paket açmayın.');
  assertRestoreReady(data);
  if (existsSync(join(data, '.mola-operation.lock'))) throw new Error('Veri klasörü kullanımda. Güncelleme kontrolünden önce sunucuyu durdurun; kilidi otomatik silmeyin.');
  if (!existsSync(join(data, 'merchant.sqlite')) || !statSync(join(data, 'merchant.sqlite')).isFile()) throw new Error('Mevcut işletme veritabanı bulunamadı. Yanlışlıkla boş kurulum açmamak için veri yolunu kontrol edin.');
  // Protected installs: anahtar.json (OS lock + recovery code) instead of the raw development.key.
  if (existsSync(join(data, 'development.key')) ? readFileSync(join(data, 'development.key')).length !== 32 : !readKeyFile(data)) throw new Error('Mevcut veri anahtarı geçersiz.');
  const previous = packageInfo(current), next = packageInfo(candidate, true);
  if (previous.fingerprint === next.fingerprint) throw new Error('Seçilen paket mevcut paketle aynı; uygulanacak yeni paket yok.');
  let databaseVersion: number;
  const database = new DatabaseSync(join(data, 'merchant.sqlite'), { readOnly: true });
  try { databaseVersion = Number(database.prepare('PRAGMA user_version').get()?.user_version); }
  finally { database.close(); }
  if (!Number.isInteger(databaseVersion) || databaseVersion < next.dataFormat!.minReadable || databaseVersion > next.dataFormat!.maxReadable) throw new Error(`Yeni paket veri biçimini desteklemiyor (veri: ${databaseVersion}, destek: ${next.dataFormat!.minReadable}–${next.dataFormat!.maxReadable}). Uyumlu paket veya ayrı geri yüklenmiş yedek kullanın.`);
  return {
    databaseVersion,
    eligibleForRehearsal: true, previous, next,
    warnings: [
      ...(previous.version === next.version ? ['Paketler aynı sürüm numarasını taşıyor; dosya kimlikleri farklı.'] : []),
      'Manifest dosya tutarlılığıdır; yayıncı imzası değildir.',
      'Bu kontrol yedek doğrulamaz ve veri sürümü uyumluluğunu kanıtlamaz. Önce doğrulanmış yedekten ayrı klasörde prova yapın.',
      'Geri dönüşte eski uygulamayı yeni sürümün değiştirdiği veri üzerinde açmayın. Eski uygulama ve güncelleme öncesi yedeğin ayrı geri yüklemesini kullanın; yedekten sonraki işlemler bu kopyada bulunmaz.',
    ],
  };
}

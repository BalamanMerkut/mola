import dataFormat from '../packages/domain/data-format.json' with { type: 'json' };
import type { DatabaseSync } from 'node:sqlite';

// Increment only with an explicit data migration and a tested rollback plan.
// 0 is the legacy, unversioned local database; 1 the first versioned one; 2 keeps closed accounts and other history in
// their own sealed tables; 3 compresses those history rows before sealing (server/packing.ts).
export const DATA_VERSION = dataFormat.writeVersion;
export type DataFormat = { minReadable: number; maxReadable: number; writeVersion: number };
/** `format`: what this app reads; tests pass an older app's format to check that it refuses newer data. */
export function assertDataVersion(db: DatabaseSync, format: DataFormat = dataFormat) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (!Number.isInteger(version) || version < format.minReadable || version > format.maxReadable) {
    throw new Error(`Veri biçimi bu uygulamayla uyumlu değil (veri: ${version}, desteklenen: ${format.writeVersion}). Uyumlu uygulama paketini kullanın veya güncelleme öncesi yedeği ayrı klasöre geri yükleyin.`);
  }
  return version;
}
/** `version`: below DATA_VERSION only while an upgrade waits (its safety copy could not be taken yet). */
export function markDataVersion(db: DatabaseSync, version = DATA_VERSION) {
  assertDataVersion(db);
  db.exec(`PRAGMA user_version=${version}`);
}

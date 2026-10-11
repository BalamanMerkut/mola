import { open, seal } from '../sealing.js';
import { snapshotKey, type Store } from '../store.js';
import type { PlatformId } from '../../packages/domain/external-orders.js';
import type { Credentials } from './types.js';

/**
 * Platform credentials (API key/secret, restaurant id), sealed with the business's own key in their own table: never in the
 * business snapshot (so no screen, report, backup check or Merkez sync that reads the snapshot can carry them), never
 * returned to a screen after saving (only "kayıtlı"), never logged. The table travels inside the encrypted database backup.
 */
export class CredentialVault {
  constructor(private store: Store) {
    store.db.exec('CREATE TABLE IF NOT EXISTS integration_secrets (tenant TEXT NOT NULL, platform TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (tenant, platform))');
  }
  private key(tenant: string) {
    const key = snapshotKey(this.store.db, this.store.key, tenant);
    if (!key) throw new Error('İşletme anahtarı eksik.');
    return key;
  }
  private scope = (tenant: string, platform: PlatformId) => `integration-secret:${tenant}:${platform}`;
  save(tenant: string, platform: PlatformId, values: Credentials) {
    this.store.db.prepare('INSERT INTO integration_secrets (tenant,platform,payload) VALUES (?,?,?) ON CONFLICT(tenant,platform) DO UPDATE SET payload=excluded.payload')
      .run(tenant, platform, seal({ values, savedAt: new Date().toISOString() }, this.key(tenant), this.scope(tenant, platform)));
  }
  /** Server-side use only (adapter calls). */
  read(tenant: string, platform: PlatformId): Credentials | null {
    const row = this.store.db.prepare('SELECT payload FROM integration_secrets WHERE tenant=? AND platform=?').get(tenant, platform) as { payload: Uint8Array } | undefined;
    return row ? open<{ values: Credentials }>(Buffer.from(row.payload), this.key(tenant), this.scope(tenant, platform)).values : null;
  }
  /** What a screen may know: which fields are saved, never their values. */
  saved(tenant: string, platform: PlatformId) { const v = this.read(tenant, platform); return v ? Object.keys(v).filter(k => !!v[k]) : []; }
  remove(tenant: string, platform: PlatformId) { this.store.db.prepare('DELETE FROM integration_secrets WHERE tenant=? AND platform=?').run(tenant, platform); }
}

/** Error text from an adapter with every credential value blanked out, short enough for a card. */
export function redact(message: string, credentials: Credentials | null) {
  let text = message;
  for (const value of Object.values(credentials ?? {})) if (value && value.length >= 4) text = text.split(value).join('***');
  return text.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Bilinmeyen hata';
}

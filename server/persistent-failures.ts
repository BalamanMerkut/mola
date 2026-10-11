import type { DatabaseSync } from 'node:sqlite';
import type { FailureEvent } from './request-diagnostics.js';
import type { FailureRecord } from './failure-index.js';

export const FAILURE_RETENTION_DAYS = 7;
const retentionMs = FAILURE_RETENTION_DAYS * 86400000;
// Strict field allowlist: never persist exception messages, request bodies or credentials.
export class PersistentFailures {
  constructor(private db: DatabaseSync, private now = () => Date.now()) {
    db.exec(`CREATE TABLE IF NOT EXISTS technical_failures (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS technical_failures_tenant_time ON technical_failures(tenant, at);`);
    this.prune();
  }
  private prune() { this.db.prepare('DELETE FROM technical_failures WHERE at <= ?').run(this.now() - retentionMs); }
  add(event: FailureEvent) {
    // One time for the record and its row: the heartbeat's delivery cursor compares the two.
    const { requestId, method, route, status, code, elapsedMs, tenantId, role, fingerprint, frames } = event, time = this.now();
    const record: FailureRecord = { event: 'request_failed', requestId, method, route, status, code, elapsedMs,
      ...(tenantId ? { tenantId, role } : {}), ...(fingerprint ? { fingerprint } : {}), ...(frames?.length ? { frames: frames.slice(0, 8) } : {}), at: new Date(time).toISOString() };
    this.prune();
    const tenant = tenantId ?? '';
    this.db.prepare('INSERT OR REPLACE INTO technical_failures VALUES (?,?,?,?)').run(requestId, tenant, time, JSON.stringify(record));
    this.db.prepare('DELETE FROM technical_failures WHERE tenant=? AND id NOT IN (SELECT id FROM technical_failures WHERE tenant=? ORDER BY at DESC, rowid DESC LIMIT 500)').run(tenant, tenant);
    this.db.exec('DELETE FROM technical_failures WHERE id NOT IN (SELECT id FROM technical_failures ORDER BY at DESC, rowid DESC LIMIT 10000)');
  }
  find(id: string): FailureRecord | null {
    this.prune(); const row = this.db.prepare('SELECT payload FROM technical_failures WHERE id=?').get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  /** Records after this time (ms), oldest first: what the heartbeat has not delivered to Mola Merkez yet. */
  since(at: number, limit = 100): FailureRecord[] {
    this.prune(); return (this.db.prepare('SELECT payload FROM technical_failures WHERE at > ? ORDER BY at ASC, rowid ASC LIMIT ?').all(at, limit) as { payload: string }[]).map(row => JSON.parse(row.payload));
  }
  list(tenant: string): FailureRecord[] {
    this.prune(); return (this.db.prepare('SELECT payload FROM technical_failures WHERE tenant=? ORDER BY at DESC, rowid DESC LIMIT 500').all(tenant) as { payload: string }[]).map(row => JSON.parse(row.payload));
  }
}

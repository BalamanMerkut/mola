import type { FailureEvent } from './request-diagnostics.js';
export type FailureRecord = FailureEvent & { at: string };
export class FailureIndex {
  private records = new Map<string, FailureRecord>();
  constructor(private now = () => Date.now(), private limit = 500) {}
  add(event: FailureEvent) {
    this.prune();
    const { requestId, method, route, status, code, elapsedMs } = event;
    this.records.set(requestId, { event: 'request_failed', requestId, method, route, status, code, elapsedMs, at: new Date(this.now()).toISOString() });
    while (this.records.size > this.limit) this.records.delete(this.records.keys().next().value!);
  }
  find(id: string) { this.prune(); const record = this.records.get(id); return record ? { ...record } : null; }
  private prune() { for (const [id, record] of this.records) if (this.now() - Date.parse(record.at) >= 86400000) this.records.delete(id); }
}

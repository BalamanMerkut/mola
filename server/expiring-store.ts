import { DomainError } from '../packages/domain/engine.js';

/** Bounded process-local state. Cleanup is driven by traffic, without background timers. */
export class ExpiringStore<T> {
  private entries = new Map<string, T>();
  private sweptAt = -Infinity;
  /** evictOldest: when full, drop the oldest entry instead of refusing everyone (rate counters, guest sessions). */
  constructor(private expiresAt: (value: T) => number, private now: () => number, private capacity: number, private evictOldest = false) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Geçersiz oturum kapasitesi.');
  }
  private sweep(interval = 30000) {
    const time = this.now();
    if (time - this.sweptAt < interval && time >= this.sweptAt) return;
    for (const [key, value] of this.entries) if (this.expiresAt(value) <= time) this.entries.delete(key);
    this.sweptAt = time;
  }
  get(key: string) {
    this.sweep();
    const value = this.entries.get(key);
    if (value !== undefined && this.expiresAt(value) <= this.now()) { this.entries.delete(key); return undefined; }
    return value;
  }
  set(key: string, value: T) {
    const expiry = this.expiresAt(value);
    if (!Number.isFinite(expiry)) throw new Error('Geçersiz oturum süresi.');
    this.sweep();
    if (expiry <= this.now()) { this.entries.delete(key); return; }
    if (!this.entries.has(key) && this.entries.size >= this.capacity) {
      // Throttle full scans under load; never evict an active session to admit another.
      this.sweep(1000);
      if (this.entries.size >= this.capacity && this.evictOldest) this.entries.delete(this.entries.keys().next().value!);
      if (this.entries.size >= this.capacity) throw new DomainError('SESSION_CAPACITY', 'Sistem şu anda yoğun. Kısa süre sonra yeniden deneyin.', 503);
    }
    this.entries.set(key, value);
  }
  delete(key: string) { return this.entries.delete(key); }
  /** Removes every entry the test picks (one person's sessions); how many went. */
  deleteWhere(test: (value: T) => boolean) { let n = 0; for (const [key, value] of this.entries) if (test(value)) { this.entries.delete(key); n++; } return n; }
  clear() { this.entries.clear(); }
  get size() { this.sweep(); return this.entries.size; }
}

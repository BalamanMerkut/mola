import { randomUUID } from 'node:crypto';
import { DomainError } from '../../packages/domain/engine.js';
import { acceptExternalOrder, checkAcceptable, checkRejectable, dueCalls, noteFailure, PLATFORM_IDS, queueExternalUpdates, readRejectReason, receiveExternalOrder, rejectExternalOrder, reportCall, type PlatformId } from '../../packages/domain/external-orders.js';
import type { Actor } from '../../packages/domain/types.js';
import type { Store } from '../store.js';
import { createAdapters, TestPlatform } from './adapters.js';
import { CredentialVault, redact } from './secrets.js';
import { AdapterError, type AdapterContext, type PlatformAdapter } from './types.js';

/** "Bağlı", "Hata: …", "Kapalı" on each platform card. */
export type Health = { state: 'connected' | 'error' | 'off' | 'starting'; message?: string; lastPollAt?: string; lastSuccessAt?: string; failures: number };
export type ManagerOptions = {
  /** How often an enabled platform is asked for new orders (15–30 s). */
  pollMs?: number;
  /** How often owed platform calls and deadlines are checked; 0: no timers at all (tests call tick()). */
  tickMs?: number;
  /** Waits between the quick tries of one Kabul/Reddet call. */
  retryMs?: number[];
  adapters?: Record<PlatformId, PlatformAdapter>;
  testPlatform?: TestPlatform;
};
const MAX_POLL_BACKOFF_MS = 5 * 60_000, CALL_TIMEOUT_MS = 15_000;

/**
 * Runs the platform adapters on the café server: polls every enabled platform (backoff on errors), reads new orders into
 * "Onay bekliyor" (dedupe by platform + externalId), sends Kabul/Reddet with quick retries, and keeps sending owed calls
 * (Hazır, teslim, iptal) until they go through. Credentials come from the sealed vault for each call only.
 */
export class IntegrationManager {
  readonly vault: CredentialVault;
  readonly test: TestPlatform;
  readonly adapters: Record<PlatformId, PlatformAdapter>;
  private health = new Map<string, Health>();
  private cursors = new Map<string, string>();
  private nextPoll = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = new Map<string, Promise<void>>();
  private busy = new Set<string>();
  private stopped = false;
  private pollMs: number; private tickMs: number; private retryMs: number[];
  /** A platform's new order arrived: a real change for the nightly backup (server/change-marker.ts). Status calls are not. */
  onChange?: () => void;
  constructor(private store: Store, private now: () => Date, options: ManagerOptions = {}) {
    this.vault = new CredentialVault(store);
    this.test = options.testPlatform ?? new TestPlatform();
    this.adapters = options.adapters ?? createAdapters(this.test);
    this.pollMs = options.pollMs ?? Number(process.env.MOLA_INTEGRATION_POLL_MS || 20_000);
    this.tickMs = options.tickMs ?? 3_000;
    this.retryMs = options.retryMs ?? [400, 1200];
  }
  private key = (tenant: string, platform: PlatformId) => `${tenant}:${platform}`;
  healthOf(tenant: string, platform: PlatformId): Health {
    const enabled = !!this.store.read(tenant).integrationSettings?.[platform]?.enabled;
    if (!enabled || !this.adapters[platform].available) return { state: 'off', failures: 0 };
    return this.health.get(this.key(tenant, platform)) ?? { state: 'starting', failures: 0 };
  }
  /** Timers for every business with an enabled platform or calls still owed (server start). */
  start() { for (const { tenant } of this.store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]) this.refresh(tenant); }
  stop() { this.stopped = true; for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }
  /** After a settings change or a new owed call: keep the business's loop running only while there is work. */
  refresh(tenant: string) {
    if (this.stopped || !this.tickMs) return;
    const s = this.store.read(tenant);
    const work = PLATFORM_IDS.some(p => s.integrationSettings?.[p]?.enabled && this.adapters[p].available) || !!s.externalOrders?.some(e => e.stage === 'pending' || e.outbox.length > 0 || (e.stage === 'accepted' && !e.reported.includes('delivered')));
    if (!work) { const t = this.timers.get(tenant); if (t) clearTimeout(t); this.timers.delete(tenant); return; }
    if (!this.timers.has(tenant)) this.schedule(tenant, 0);
  }
  private schedule(tenant: string, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(tenant);
      void this.tick(tenant).finally(() => {
        if (this.stopped) return;
        // A closed database (server shutting down, tests) ends the loop quietly.
        try { this.schedule(tenant, this.tickMs); this.refresh(tenant); } catch { const t = this.timers.get(tenant); if (t) clearTimeout(t); this.timers.delete(tenant); }
      });
    }, delay);
    timer.unref?.(); this.timers.set(tenant, timer);
  }
  private context(tenant: string, platform: PlatformId): AdapterContext {
    return { tenantId: tenant, credentials: this.vault.read(tenant, platform) ?? {}, cursor: this.cursors.get(this.key(tenant, platform)), now: this.now(), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) };
  }
  private message(error: unknown, platform: PlatformId, tenant: string) {
    const text = error instanceof AdapterError || error instanceof DomainError ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'Platform zamanında yanıt vermedi' : 'Platforma bağlanılamadı';
    return redact(text, this.vault.read(tenant, platform));
  }
  /** One round for a business, never two at once: owed calls, deadlines, then any platform whose poll is due. */
  tick(tenant: string, options: { forcePoll?: PlatformId } = {}): Promise<void> {
    const previous = this.running.get(tenant) ?? Promise.resolve();
    const next = previous.then(() => this.round(tenant, options)).catch(() => {});
    this.running.set(tenant, next);
    return next;
  }
  private async round(tenant: string, options: { forcePoll?: PlatformId }) {
    const s = this.store.read(tenant), at = this.now().getTime();
    for (const platform of PLATFORM_IDS) {
      if (!s.integrationSettings?.[platform]?.enabled || !this.adapters[platform].available) continue;
      if (options.forcePoll === platform || at >= (this.nextPoll.get(this.key(tenant, platform)) ?? 0)) await this.poll(tenant, platform);
    }
    await this.flush(tenant);
  }
  /** Reads new orders from one platform; errors wait longer each time (20 s, 40 s, … 5 min). */
  async poll(tenant: string, platform: PlatformId) {
    const key = this.key(tenant, platform), adapter = this.adapters[platform], previous = this.health.get(key);
    const at = this.now().toISOString();
    try {
      const result = await adapter.fetchOrders(this.context(tenant, platform));
      if (result.cursor !== undefined) this.cursors.set(key, result.cursor);
      const created: string[] = [], problems: string[] = [];
      let arrived = false;
      if (result.orders.length) this.store.mutate(tenant, s => {
        for (const order of result.orders) {
          try { const r = receiveExternalOrder(s, platform, order, { now: this.now(), id: randomUUID }); if (r.created) arrived = true; if (r.created && r.autoAccept && r.id) created.push(r.id); }
          catch (e) { problems.push(e instanceof DomainError ? e.message : 'Sipariş okunamadı'); }
        }
      });
      if (arrived) this.onChange?.();
      this.health.set(key, problems.length ? { state: 'error', message: problems[0], lastPollAt: at, lastSuccessAt: at, failures: 0 } : { state: 'connected', lastPollAt: at, lastSuccessAt: at, failures: 0 });
      this.nextPoll.set(key, this.now().getTime() + this.pollMs);
      // Otomatik kabul: the same path as a person's Kabul, as the business itself.
      for (const id of created) {
        const entry = this.store.read(tenant).externalOrders?.find(e => e.id === id);
        if (entry) await this.accept(tenant, { tenantId: tenant, id: `platform-auto:${platform}`, role: 'owner' }, { id, version: entry.version }).catch(() => {});
      }
    } catch (error) {
      const failures = (previous?.failures ?? 0) + 1;
      this.health.set(key, { state: 'error', message: this.message(error, platform, tenant), lastPollAt: at, lastSuccessAt: previous?.lastSuccessAt, failures });
      this.nextPoll.set(key, this.now().getTime() + Math.min(MAX_POLL_BACKOFF_MS, this.pollMs * 2 ** Math.min(failures, 8)));
    }
  }
  /** Turns local steps into owed calls and sends the ones that are due. */
  async flush(tenant: string) {
    const now = this.now();
    let due: ReturnType<typeof dueCalls> = [];
    const s = this.store.read(tenant);
    if (s.externalOrders?.length) {
      // Only write when something really changed, so an idle café does not rewrite its data every few seconds.
      if (queueExternalUpdates(s, now)) this.store.mutate(tenant, live => { queueExternalUpdates(live, now); });
      due = dueCalls(this.store.read(tenant), now);
    }
    for (const call of due) {
      const adapter = this.adapters[call.platform];
      let result: { ok: true } | { ok: false; error: string };
      try {
        const ctx = this.context(tenant, call.platform), reason = { reason: call.reason ?? 'İşletme iptal etti' };
        if (call.action === 'ready') await adapter.ready(ctx, call.externalId);
        else if (call.action === 'delivered') await adapter.delivered(ctx, call.externalId);
        else await adapter.cancel(ctx, call.externalId, reason);
        result = { ok: true };
      } catch (error) { result = { ok: false, error: this.message(error, call.platform, tenant) }; }
      this.store.mutate(tenant, live => reportCall(live, call.id, call.action, result, this.now()));
    }
  }
  /** A platform call with quick tries: transient errors are tried again, "will not help" errors stop at once. */
  private async withRetry(fn: () => Promise<void>) {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); }
      catch (error) {
        if ((error instanceof AdapterError && !error.retry) || attempt >= this.retryMs.length) throw error;
        await new Promise(r => setTimeout(r, this.retryMs[attempt]));
      }
    }
  }
  private lock(id: string) {
    if (this.busy.has(id)) throw new DomainError('IN_PROGRESS', 'Bu sipariş için platforma gönderim sürüyor. Birkaç saniye sonra tekrar bakın.', 409);
    this.busy.add(id);
  }
  /** Kabul: the platform first; only an order it confirmed goes to the kitchen. A failure stays visible on the card. */
  async accept(tenant: string, actor: Actor, input: { id: string; version: number }) {
    const { entry, already } = checkAcceptable(this.store.read(tenant), actor, input);
    if (already) return { orderId: entry.orderId!, already: true };
    this.lock(entry.id);
    try {
      try { await this.withRetry(() => this.adapters[entry.platform].accept(this.context(tenant, entry.platform), entry.externalId)); }
      catch (error) { return this.failed(tenant, entry.id, entry.platform, error); }
      const result = this.store.mutate(tenant, s => acceptExternalOrder(s, actor, input, { now: this.now(), id: randomUUID }));
      this.refresh(tenant);
      return result;
    } finally { this.busy.delete(entry.id); }
  }
  /** Reddet with one of the reasons; the platform first, then the card closes. */
  async reject(tenant: string, actor: Actor, input: { id: string; version: number; reason: string }) {
    const reason = readRejectReason(input.reason);
    const { entry, already } = checkRejectable(this.store.read(tenant), actor, input);
    if (already) return { already: true };
    this.lock(entry.id);
    try {
      try { await this.withRetry(() => this.adapters[entry.platform].reject(this.context(tenant, entry.platform), entry.externalId, { reason })); }
      catch (error) { return this.failed(tenant, entry.id, entry.platform, error); }
      return this.store.mutate(tenant, s => rejectExternalOrder(s, actor, { ...input, reason }, { now: this.now(), id: randomUUID }));
    } finally { this.busy.delete(entry.id); }
  }
  private failed(tenant: string, id: string, platform: PlatformId, error: unknown): never {
    const text = this.message(error, platform, tenant);
    this.store.mutate(tenant, s => noteFailure(s, id, text, this.now()));
    // 424: the platform failed, not this server; such answers are not stored as server errors (nothing to send to Merkez).
    throw new DomainError('PLATFORM_FAILED', `Platforma iletilemedi: ${text}. Sipariş bekliyor; tekrar deneyin.`, 424);
  }
}

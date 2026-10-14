import type { Express } from 'express';
import { z } from 'zod';
import { DomainError } from '../packages/domain/engine.js';
import { directLoopback, type HttpSecurity } from './http-security.js';
import type { MerkezLink } from './kafe-link.js';
import { RELAY, type RelayKind, type RelayReply, type RelayRequest, type TenantState } from './relay-protocol.js';

/*
 * The café's end of the köprü (server/relay-protocol.ts). Runs only while a feature needs it: some business here has
 * "Uzaktan destek izni" on or a paired phone (`tenants()`), or a new device could sign in to Raporlarım (`holds`: the package
 * and the owner's phone code, server/remote-reports.ts), and Mola is activated. One long-poll at a time; every request it
 * brings is handled on its own (handlers by kind) and answered with its own signed reply. After a failure it waits 1, 2, 5,
 * 10, 30, 60 s before asking again; the wait resets after a good poll. `announce()` tells Merkez at once what changed (the
 * owner switched support off, a phone was removed), also when the loop is about to stop because nothing needs it any more.
 */
export type RelayHandler = (request: RelayRequest) => Promise<RelayReply>;
const BACKOFF = [1000, 2000, 5000, 10_000, 30_000, 60_000];
export class RelayClient {
  private handlers: Partial<Record<RelayKind, RelayHandler>> = {};
  private running?: Promise<void>; private stopped = false; private failures = 0; private wake?: () => void; private paused = false;
  /** Requests in hand (so a stop waits for nothing and tests can wait for quiet). */
  private busy = 0;
  lastPollAt = 0; lastError: string | null = null;
  /** What each business allows right now (support on, phone ids); set by server/support-session.ts and server/remote-reports.ts. */
  sources: (() => TenantState[])[] = [];
  /** Something else needs the relay (Raporlarım giriş possible: server/remote-reports.ts loginOpen). */
  holds: (() => boolean)[] = [];
  constructor(private link: MerkezLink) {}
  on(kind: RelayKind, handler: RelayHandler) { this.handlers[kind] = handler; }
  tenants(): TenantState[] {
    const merged = new Map<string, TenantState>();
    for (const source of this.sources) for (const t of source()) {
      const m = merged.get(t.tenantId) ?? { tenantId: t.tenantId, support: false, phones: [] };
      merged.set(t.tenantId, { tenantId: t.tenantId, support: m.support || t.support, phones: [...new Set([...m.phones, ...t.phones])].slice(0, RELAY.MAX_PHONES) });
    }
    return [...merged.values()];
  }
  needed() { try { return !this.stopped && !this.paused && this.link.relayReady() && (this.tenants().some(t => t.support || t.phones.length > 0) || this.holds.some(h => h())); } catch { return false; } }
  /** Connected: a poll answered within the hold time (shown to the owner as "Mola Merkez'e bağlı"). */
  connected() { return !!this.running && Date.now() - this.lastPollAt < RELAY.HOLD_MS + 20_000; }
  /** Starts the loop when something needs it (call after any change). */
  refresh() { if (!this.running && this.needed()) this.running = this.loop().finally(() => { this.running = undefined; }); this.wake?.(); }
  /** Tells Merkez now what each business allows (best effort; the next poll says it again). */
  async announce() {
    if (!this.link.relayReady()) return;
    try { await this.link.relayPost('/relay/state', { v: 1, tenants: this.tenants() }, 10_000); } catch { /* the next poll carries it */ }
  }
  /** A signed call for the modules (pairing announcement, postbox). */
  post<T>(path: string, body: unknown, timeout = 15_000) { return this.link.relayPost<T>(path, body, timeout); }
  stop() { this.stopped = true; this.wake?.(); }
  /** Browser tests only (relayTestRoute): as if this computer were off for Mola Merkez, and back. */
  pause(off: boolean) { this.paused = off; this.wake?.(); if (!off) this.refresh(); }
  private sleep(ms: number) { return new Promise<void>(done => { const t = setTimeout(() => { this.wake = undefined; done(); }, ms); t.unref?.(); this.wake = () => { clearTimeout(t); this.wake = undefined; done(); }; }); }
  private async loop() {
    while (this.needed()) {
      try {
        const answer = await this.link.relayPost<{ requests?: RelayRequest[] }>('/relay/poll', { v: 1, tenants: this.tenants() }, RELAY.HOLD_MS + 15_000);
        this.lastPollAt = Date.now(); this.lastError = null; this.failures = 0;
        for (const request of Array.isArray(answer.requests) ? answer.requests : []) void this.handle(request);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'Mola Merkez’e ulaşılamadı.';
        const wait = BACKOFF[Math.min(this.failures++, BACKOFF.length - 1)];
        if (this.needed()) await this.sleep(wait);
      }
    }
    // Nothing needs the relay any more (support off, last phone removed): Merkez hears it at once.
    if (!this.stopped) await this.announce();
  }
  private async handle(request: RelayRequest) {
    this.busy++;
    let reply: RelayReply;
    try {
      const handler = this.handlers[request.kind];
      if (!handler) throw new DomainError('NOT_FOUND', 'Bu kafe bu isteği tanımıyor.', 404);
      reply = await handler(request);
    } catch (error) {
      const e = error instanceof DomainError ? error : new DomainError('RELAY_FAILED', 'İşlem kafe bilgisayarında tamamlanamadı.', 500);
      reply = { status: e.status, json: { code: e.code, message: e.message } };
    }
    try { await this.link.relayPost('/relay/reply', { id: request.id, ...reply }, 30_000); }
    catch { /* Merkez times the request out ("kafe yanıt vermedi") */ }
    finally { this.busy--; }
  }
  /** Tests: until every handed request was answered. */
  async idle() { while (this.busy > 0) await new Promise(r => setTimeout(r, 10)); }
}
/** Browser tests (scripts/test-server.mjs, MOLA_TEST_TUNNEL=1; never in a release build): POST /api/test/relay { on } from this computer. */
export function relayTestRoute(app: Express, relay: RelayClient, security: HttpSecurity) {
  if (process.env.MOLA_TEST_TUNNEL !== '1' || process.env.MOLA_RELEASE_BUILD === '1') return;
  app.post('/api/test/relay', (req, res) => {
    if (!directLoopback(req, security)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404);
    const { on } = z.object({ on: z.boolean() }).strict().parse(req.body);
    relay.pause(!on);
    res.json({ on });
  });
}

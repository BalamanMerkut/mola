import type { Express, Request } from 'express';
import { z } from 'zod';
import { addDays, businessDay } from '../packages/domain/business-day.js';
import type { CashClosing } from '../packages/domain/cash.js';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { cafePrivateKey, liveSigned, newCafeKeys, openPairRequest, pairConfirm, pairingFragment, randomB64u, sealReport, type LiveRequest, type PairRequest, type ReportBox } from '../packages/domain/remote-crypto.js';
import type { PhoneReport, PhoneReportReason } from '../packages/domain/remote-report.js';
import { openBalance, overviewFrom, previousRange, reportRange } from '../packages/domain/reports.js';
import type { Actor } from '../packages/domain/types.js';
import type { CashBook } from './cash-closing.js';
import type { MerkezLink } from './kafe-link.js';
import type { Notifications } from './notifications.js';
import type { RelayClient } from './relay.js';
import { RELAY, type RelayReply, type RelayRequest } from './relay-protocol.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';
import { verifyTotp } from './totp.js';
import { featureRefusal } from './feature-guard.js';

/*
 * Uzaktan raporlar ("Raporlarım" on the owner's phone), end to end encrypted (packages/domain/remote-crypto.ts).
 *   Pairing  Only the owner's own account (403 for everyone else, Müdür and Mola destek too). "Telefonu eşleştir" (Destek →
 *            Uzaktan erişim) asks the device's name ("Ahmet'in telefonu", "Ev laptopu": the Raporlarım page opens in any browser)
 *            and the owner's password again, checked in that same request (wrong attempts count on the login limiter); only
 *            then a one-time pairing id + secret, good for 10
 *            minutes, and this business's public key go into a QR (in the URL fragment, never sent to a server). The phone makes
 *            its own key pair, sends its public key through Mola Merkez sealed with the secret; when the owner turned the report
 *            code on (Ayarlar → Güvenlik), the phone's request also carries the 6-digit code, encrypted to this computer. At most
 *            3 phones per business; "Kaldır" revokes one at once (here, and Merkez forgets its token and postbox).
 *   Live     The phone asks through Merkez (relay kind `phone`): HMAC-signed, fresh (±5 min) and one-time (nonce); the answer
 *            is the report sealed for that phone, bound to the question.
 *   Postbox  Every RELAY postbox period while this computer runs (MOLA_POSTBOX_MS), after a gün sonu and when Mola closes,
 *            the summary is sealed for each phone and left at Merkez (one box per phone, deleted on fetch or after 7 days), so
 *            the phone shows "Kafe bilgisayarı kapalı · Son durum 23:40" while this computer is off.
 * Only an active owner's phones are answered: a phone paired by an owner whose account was closed gets nothing.
 */
type Phone = { id: string; name: string; pub: string; ownerId: string; ownerName: string; pairedAt: string; lastSeenAt?: string };
type Record_ = { v: 1; key?: { privateKey: string; publicKey: string }; phones: Phone[]; log: { at: string; text: string }[] };
type Pairing = { tenant: string; secret: string; ownerId: string; name: string; expiresAt: number; tries: number };
const POSTBOX_MS = () => Number(process.env.MOLA_POSTBOX_MS) || 15 * 60_000;
const FRESH_MS = 5 * 60_000;
/** How often a device's "son rapor" time is written (a phone asks every minute while open). */
const SEEN_MS = 60_000;
/** A device's name as the owner typed it: no control or direction characters, at most 40 letters. */
export const deviceName = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
/** Checks the signed-in user's own password in this request (server/app.ts; wrong attempts count on the login limiter). */
export type ConfirmPassword = (req: Request, actor: Actor, password: string | undefined) => Promise<void>;

export class RemoteReports {
  private pairings = new Map<string, Pairing>();
  private nonces = new Map<string, number>();
  private timer?: NodeJS.Timeout; private lastPush = 0; private pushing?: Promise<number>;
  private keys = new Map<string, Promise<CryptoKey>>();
  notifications?: () => Pick<Notifications, 'add'> | undefined;
  constructor(private store: Store, private link: MerkezLink, private relay: RelayClient, private now: () => Date, private cash?: CashBook) {
    store.db.exec('CREATE TABLE IF NOT EXISTS remote_reports (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    relay.sources.push(() => this.tenants());
    relay.holds.push(() => this.pairingOpen());
    relay.on('pair', r => this.pair(r as Extract<RelayRequest, { kind: 'pair' }>));
    relay.on('phone', r => this.live(r as Extract<RelayRequest, { kind: 'phone' }>));
    this.timer = setInterval(() => { if (this.relay.connected()) void this.push('periodic').catch(() => {}); }, POSTBOX_MS()); this.timer.unref();
  }
  close() { clearInterval(this.timer); }
  // ---------- The record (sealed with the business key) ----------
  private key(tenant: string) { const k = snapshotKey(this.store.db, this.store.key, tenant); if (!k) throw new Error('İşletme anahtarı eksik.'); return k; }
  read(tenant: string): Record_ {
    const row = this.store.db.prepare('SELECT payload FROM remote_reports WHERE tenant=?').get(tenant) as { payload: Uint8Array } | undefined;
    return row ? open<Record_>(Buffer.from(row.payload), this.key(tenant), `remote-reports:${tenant}`) : { v: 1, phones: [], log: [] };
  }
  private write<T>(tenant: string, fn: (r: Record_) => T): T {
    const r = this.read(tenant), result = fn(r); r.log = r.log.slice(-100);
    this.store.db.prepare('INSERT INTO remote_reports (tenant,payload) VALUES (?,?) ON CONFLICT(tenant) DO UPDATE SET payload=excluded.payload').run(tenant, seal(r, this.key(tenant), `remote-reports:${tenant}`));
    return result;
  }
  // Hizmet paketi: a business without "Uzaktan raporlar" gets no postbox and no live answer; its phones stay listed (data kept).
  tenants() { return (this.store.db.prepare('SELECT tenant FROM remote_reports').all() as { tenant: string }[]).flatMap(({ tenant }) => { try { if (!this.link.has(tenant, 'remote-reports')) return []; const p = this.read(tenant).phones; return p.length ? [{ tenantId: tenant, support: false, phones: p.map(x => x.id) }] : []; } catch { return []; } }); }
  private pairingOpen() { const t = this.now().getTime(); for (const [id, p] of this.pairings) if (p.expiresAt <= t) this.pairings.delete(id); return this.pairings.size > 0; }
  /** This business's static key pair, made the first time it is needed. */
  private async cafeKey(tenant: string) {
    let r = this.read(tenant);
    if (!r.key) { const made = await newCafeKeys(); r = this.write(tenant, x => { x.key ??= made; return x; }); }
    return r.key!;
  }
  private privateKey(tenant: string, pkcs8: string) {
    const k = `${tenant}:${pkcs8.slice(-16)}`;
    if (!this.keys.has(k)) this.keys.set(k, cafePrivateKey(pkcs8));
    return this.keys.get(k)!;
  }
  // ---------- Pairing ----------
  /** Ready for a new device? (before the password is asked: a full list or an unactivated Mola says so first) */
  canPair(tenant: string) {
    if (!this.link.relayReady()) throw new DomainError('NOT_ACTIVATED', 'Mola bu bilgisayarda henüz etkinleştirilmedi.', 409);
    if (this.read(tenant).phones.length >= RELAY.MAX_PHONES) throw new DomainError('PHONE_LIMIT', `En fazla ${RELAY.MAX_PHONES} cihaz eşleştirilebilir. Önce birini kaldırın.`, 409);
  }
  /** The QR. Call only after the owner's password was checked in this request (remoteReportRoutes). */
  async startPairing(tenant: string, ownerId: string, deviceLabel: string) {
    this.canPair(tenant);
    const name = deviceName(deviceLabel);
    if (!name) throw new DomainError('NAME_REQUIRED', 'Cihaza bir ad verin: örneğin “Ahmet’in telefonu” ya da “Ev laptopu”.', 400);
    const owner = this.store.read(tenant).staffUsers?.find(u => u.id === ownerId && u.role === 'owner' && u.active);
    if (!owner) throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403);
    const key = await this.cafeKey(tenant), pairId = randomB64u(16), secret = randomB64u(32), expiresAt = this.now().getTime() + RELAY.PAIRING_MS;
    // One open QR per business: a new one replaces the one before it.
    for (const [id, p] of this.pairings) if (p.tenant === tenant) this.pairings.delete(id);
    // Merkez must know where to send the phone's request (the id only; the secret never leaves this computer).
    await this.relay.post('/relay/pairing', { tenantId: tenant, pairId, expiresAt: new Date(expiresAt).toISOString() });
    this.pairings.set(pairId, { tenant, secret, ownerId, name, expiresAt, tries: 0 });
    this.relay.refresh();
    const link = new URL('/raporlarim', `${this.link.url}/`);
    link.hash = pairingFragment({ pairId, secret, cafePublic: key.publicKey, code: !!owner.mfa });
    return { url: link.toString(), expiresAt: new Date(expiresAt).toISOString(), code: !!owner.mfa, name };
  }
  cancelPairing(tenant: string) { for (const [id, p] of this.pairings) if (p.tenant === tenant) this.pairings.delete(id); }
  private async pair(r: Extract<RelayRequest, { kind: 'pair' }>): Promise<RelayReply> {
    if (!this.link.has(r.tenantId, 'remote-reports')) throw featureRefusal('remote-reports');
    const p = this.pairings.get(r.request.pairId), t = this.now().getTime();
    if (!p || p.tenant !== r.tenantId || p.expiresAt <= t) throw new DomainError('PAIRING_EXPIRED', 'Eşleştirme kodunun süresi doldu. Kafe bilgisayarında “Telefonu eşleştir”e yeniden basın.', 410);
    if (p.tries >= 5) { this.pairings.delete(r.request.pairId); throw new DomainError('PAIRING_EXPIRED', 'Çok fazla hatalı deneme. Kafe bilgisayarında “Telefonu eşleştir”e yeniden basın.', 410); }
    const key = await this.cafeKey(p.tenant), inner = await openPairRequest(await this.privateKey(p.tenant, key.privateKey), p.secret, r.request as PairRequest);
    if (!inner) { p.tries++; throw new DomainError('PAIRING_INVALID', 'Eşleştirme doğrulanamadı. QR kodunu yeniden okutun.', 403); }
    const s = this.store.read(p.tenant), owner = s.staffUsers?.find(u => u.id === p.ownerId && u.role === 'owner' && u.active);
    if (!owner) { this.pairings.delete(r.request.pairId); throw new DomainError('FORBIDDEN', 'Bu işlem için yetkiniz yok.', 403); }
    // The report code (Raporlar için telefon kodu), when the owner turned it on: once, here, while pairing.
    if (owner.mfa) {
      const code = (inner.code ?? '').replace(/\D/g, '');
      const ok = code.length === 6 && this.store.mutate(p.tenant, x => { const u = x.staffUsers!.find(v => v.id === owner.id)!; const step = u.mfa ? verifyTotp(u.mfa.secret, code, t, u.mfa.lastStep) : null; if (step === null) return false; u.mfa!.lastStep = step; return true; });
      if (!ok) { p.tries++; throw new DomainError('CODE_WRONG', 'Raporlar için telefon kodu yanlış ya da süresi geçti. Doğrulama uygulamasındaki yeni kodu yazın.', 403); }
    }
    // The name the owner typed on this computer; an older Raporlarım page may still send its own (used only without one).
    const name = p.name || deviceName(typeof inner.name === 'string' ? inner.name : '') || 'Cihaz';
    const id = randomB64u(16), at = this.now().toISOString();
    this.write(p.tenant, x => {
      if (x.phones.length >= RELAY.MAX_PHONES) throw new DomainError('PHONE_LIMIT', `En fazla ${RELAY.MAX_PHONES} cihaz eşleştirilebilir.`, 409);
      x.phones.push({ id, name, pub: r.request.phonePub, ownerId: owner.id, ownerName: owner.name, pairedAt: at });
      x.log.push({ at, text: `Cihaz eşleştirildi: ${name} (${owner.name}).` });
    });
    this.pairings.delete(r.request.pairId);
    this.store.mutate(p.tenant, x => { x.audit.push({ action: 'remote.phone_paired', actor: owner.id, target: id, at }); });
    try { this.notifications?.()?.add(p.tenant, `phone:paired:${id}`, { kind: 'merkez', title: 'Cihaz eşleştirildi', text: `${name} artık raporlarınızı görebilir. Kaldırmak için Destek → Uzaktan erişim.` }); } catch { /* the log has it */ }
    this.relay.refresh(); void this.relay.announce();
    // The first postbox box at once, so the phone has something even if this computer goes off right after.
    setTimeout(() => void this.push('paired', true).catch(() => {}), 50).unref?.();
    return { status: 200, json: { ok: true, phoneId: id, business: s.name, confirm: await pairConfirm(p.secret, r.request.pairId, r.request.phonePub, id) } };
  }
  removePhone(tenant: string, phoneId: string, byName: string) {
    const removed = this.write(tenant, x => { const p = x.phones.find(v => v.id === phoneId); if (!p) return undefined; x.phones = x.phones.filter(v => v.id !== phoneId); x.log.push({ at: this.now().toISOString(), text: `Cihaz kaldırıldı: ${p.name} (${byName}).` }); return p; });
    if (!removed) throw new DomainError('NOT_FOUND', 'Cihaz bulunamadı.', 404);
    // Merkez forgets its token and box now; this computer already answers it no more.
    void this.relay.announce(); this.relay.refresh();
    return removed;
  }
  // ---------- Live ----------
  private seen(phone: string, nonce: string, t: number) {
    for (const [k, until] of this.nonces) if (until <= t) this.nonces.delete(k);
    const k = `${phone}:${nonce}`; if (this.nonces.has(k)) return true;
    this.nonces.set(k, t + 2 * FRESH_MS); return false;
  }
  private phoneOf(tenant: string, phoneId: string) {
    const p = this.read(tenant).phones.find(x => x.id === phoneId);
    const owner = p && this.store.read(tenant).staffUsers?.find(u => u.id === p.ownerId && u.role === 'owner' && u.active);
    if (!p || !owner) throw new DomainError('PHONE_REVOKED', 'Bu cihazın eşleşmesi kaldırıldı. Kafe bilgisayarında yeniden eşleştirin.', 403);
    return p;
  }
  private async live(r: Extract<RelayRequest, { kind: 'phone' }>): Promise<RelayReply> {
    if (!this.link.has(r.tenantId, 'remote-reports')) throw featureRefusal('remote-reports');
    const p = this.phoneOf(r.tenantId, r.phoneId), t = this.now().getTime(), q = r.request as LiveRequest, key = await this.cafeKey(r.tenantId);
    if (q.phone !== p.id || !await liveSigned(await this.privateKey(r.tenantId, key.privateKey), p.pub, q)) throw new DomainError('REQUEST_INVALID', 'İstek doğrulanamadı.', 403);
    if (Math.abs(q.at - t) > FRESH_MS) throw new DomainError('REQUEST_STALE', 'Telefonun saati kafe bilgisayarından çok farklı. Telefonda saati otomatik yapın.', 403);
    if (this.seen(p.id, q.nonce, t)) throw new DomainError('REPLAY', 'Bu istek daha önce kullanıldı.', 403);
    const report = this.build(r.tenantId, 'live');
    const box = await sealReport(await this.privateKey(r.tenantId, key.privateKey), p.pub, { kind: 'live', phone: p.id, at: report.at, ref: q.nonce }, report);
    if (!p.lastSeenAt || t - Date.parse(p.lastSeenAt) >= SEEN_MS) try { this.write(r.tenantId, x => { const ph = x.phones.find(v => v.id === p.id); if (ph) ph.lastSeenAt = new Date(t).toISOString(); }); } catch { /* next time */ }
    return { status: 200, json: { box } };
  }
  // ---------- The report ----------
  build(tenant: string, reason: PhoneReportReason): PhoneReport {
    const s = this.store.read(tenant), now = this.now(), t = now.getTime(), today = businessDay(t);
    const day = reportRange(today, today), before = previousRange(today, today, t);
    const o = overviewFrom({ from: today, to: today, start: day.start, end: day.end, today, days: this.store.history.reportDays(tenant, s, day.start, day.end), previous: before && { from: before.from, to: before.to, partial: before.partial, days: this.store.history.reportDays(tenant, s, before.start, before.end) }, openBalance: openBalance(s), products: s.products });
    const first = addDays(today, -29), month = reportRange(first, today);
    const m = overviewFrom({ from: first, to: today, start: month.start, end: month.end, today, days: this.store.history.reportDays(tenant, s, month.start, month.end), previous: null, openBalance: 0 });
    const closing = this.cash?.latest<CashClosing>(tenant, ['closing']);
    return {
      v: 1, business: s.name, at: now.toISOString(), day: today, reason,
      today: { sales: o.sales, cash: o.cash, card: o.card, platform: o.platform, orders: o.orders, closedAccounts: o.closedAccounts, averageAccount: o.averageAccount, expenses: o.expenses, refunds: o.refunds, kept: o.kept, cancelled: o.cancelled,
        channels: o.channels.filter(c => c.orders || c.amount).map(c => ({ name: c.name, orders: c.orders, amount: c.amount })), previous: o.previous ? { sales: o.previous.sales, ...(o.previous.partial ? { partial: true } : {}) } : null },
      topProducts: o.topProducts.map(p => ({ name: p.name, qty: p.qty, amount: p.amount, ...(p.unit ? { unit: p.unit } : {}), ...(p.grams ? { grams: p.grams } : {}) })),
      hourly: o.hourly.filter(h => h.sales > 0).map(h => ({ hour: h.hour, sales: h.sales })),
      open: { accounts: s.accounts.filter(a => a.status === 'open').length, amount: o.openAccounts ?? 0 },
      lastClosing: closing && closing.status === 'closed' ? { at: closing.closedAt ?? closing.to, day: closing.day, byName: closing.byName, ...(closing.extra ? { extra: true } : {}), counted: closing.counted, expected: closing.figures.expected, difference: closing.difference } : null,
      days: m.daily.map(d => ({ day: d.day, sales: d.sales })),
    };
  }
  // ---------- Postbox ----------
  /** Seals the summary for every paired phone and leaves it at Merkez. At most every 30 s unless `force` (closing, shutdown). */
  push(reason: PhoneReportReason, force = false): Promise<number> {
    if (this.pushing) return this.pushing;
    if (!force && Date.now() - this.lastPush < 30_000) return Promise.resolve(0);
    this.pushing = (async () => {
      const items: { tenantId: string; phoneId: string; box: ReportBox }[] = [];
      for (const { tenantId } of this.tenants()) {
        const r = this.read(tenantId); if (!r.key) continue;
        const priv = await this.privateKey(tenantId, r.key.privateKey), report = this.build(tenantId, reason);
        const owners = new Set((this.store.read(tenantId).staffUsers ?? []).filter(u => u.role === 'owner' && u.active).map(u => u.id));
        for (const p of r.phones) if (owners.has(p.ownerId)) items.push({ tenantId, phoneId: p.id, box: await sealReport(priv, p.pub, { kind: 'snapshot', phone: p.id, at: report.at }, report) });
      }
      if (!items.length || !this.link.relayReady()) return 0;
      await this.relay.post('/relay/postbox', { items }, 15_000);
      this.lastPush = Date.now();
      return items.length;
    })().finally(() => { this.pushing = undefined; });
    return this.pushing;
  }
  view(tenant: string) {
    const r = this.read(tenant), t = this.now().getTime(), pairing = [...this.pairings.values()].find(p => p.tenant === tenant && p.expiresAt > t);
    return { phones: r.phones.map(p => ({ id: p.id, name: p.name, ownerName: p.ownerName, pairedAt: p.pairedAt, lastSeenAt: p.lastSeenAt ?? null })), max: RELAY.MAX_PHONES, pairing: pairing ? { expiresAt: new Date(pairing.expiresAt).toISOString() } : null,
      relay: { connected: this.relay.connected(), error: this.relay.lastError }, log: [...r.log].reverse().slice(0, 30) };
  }
}

/**
 * Owner only (the owner's own account; Müdür, other staff and Mola destek get 403): GET /api/staff/remote-reports,
 * POST /api/staff/remote-reports/pair { name, password } (QR; the password is checked again right here), /pair/cancel,
 * /phones/remove { id }. "Gün sonu" (a final closing) sends the postbox at once.
 */
export function remoteReportRoutes(app: Express, store: Store, reports: RemoteReports, actorFor: (req: Request) => Actor, confirmPassword: ConfirmPassword) {
  const owner = (req: Request) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner']); return { a, s }; };
  app.use('/api/staff/cash/finish', (_req, res, next) => { res.on('finish', () => { if (res.statusCode < 400) void reports.push('closing', true).catch(() => {}); }); next(); });
  app.get('/api/staff/remote-reports', (req, res) => { const { a } = owner(req); res.setHeader('Cache-Control', 'no-store'); res.json(reports.view(a.tenantId)); });
  app.post('/api/staff/remote-reports/pair', async (req, res) => {
    const { a } = owner(req), b = z.object({ name: z.string().max(200).optional(), password: z.string().max(200).optional() }).strict().parse(req.body ?? {});
    reports.canPair(a.tenantId);
    if (!deviceName(b.name ?? '')) throw new DomainError('NAME_REQUIRED', 'Cihaza bir ad verin: örneğin “Ahmet’in telefonu” ya da “Ev laptopu”.', 400);
    await confirmPassword(req, a, b.password);
    const { a: still } = owner(req);
    res.json({ ...await reports.startPairing(still.tenantId, still.id, b.name!), ...reports.view(still.tenantId) });
  });
  app.post('/api/staff/remote-reports/pair/cancel', (req, res) => { const { a } = owner(req); reports.cancelPairing(a.tenantId); res.json(reports.view(a.tenantId)); });
  app.post('/api/staff/remote-reports/phones/remove', (req, res) => {
    const { a, s } = owner(req), { id } = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict().parse(req.body);
    const p = reports.removePhone(a.tenantId, id, s.staffUsers?.find(u => u.id === a.id)?.name ?? 'İşletme sahibi'); // one tap + "Evet, kaldır", no password
    store.mutate(a.tenantId, x => { x.audit.push({ action: 'remote.phone_removed', actor: a.id, target: p.id, at: new Date().toISOString() }); });
    res.json(reports.view(a.tenantId));
  });
}

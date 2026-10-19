import type { Express, Request } from 'express';
import { z } from 'zod';
import { addDays, businessDay } from '../packages/domain/business-day.js';
import type { CashClosing } from '../packages/domain/cash.js';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { cafePrivateKey, liveSigned, newCafeKeys, randomB64u, readLogin, sealLoginAnswer, sealReport, type DeviceKind, type LiveRequest, type LoginAnswer, type LoginRequest, type ReportBox } from '../packages/domain/remote-crypto.js';
import type { PhoneReport, PhoneReportReason } from '../packages/domain/remote-report.js';
import { openBalance, overviewFrom, previousRange, reportRange } from '../packages/domain/reports.js';
import type { Actor } from '../packages/domain/types.js';
import { passwordMatches, type StaffUser } from './accounts.js';
import type { CashBook } from './cash-closing.js';
import type { MerkezLink } from './kafe-link.js';
import type { Notifications } from './notifications.js';
import type { RelayClient } from './relay.js';
import { RELAY, type RelayReply, type RelayRequest } from './relay-protocol.js';
import { open, seal } from './sealing.js';
import { snapshotKey, type Store } from './store.js';
import { featureRefusal } from './feature-guard.js';

/*
 * Uzaktan raporlar ("Raporlarım"), end to end encrypted (packages/domain/remote-crypto.ts).
 *   Giriş    0.1.23 (the owner's decision: one website sign-in on <Merkez>/yonet, no QR, no shortcut, any device first): an
 *            unpaired device types the business's verified owner e-mail and the owner's password ("Devam"), then the 6-digit
 *            phone code (Raporlar için telefon kodu). Mola Merkez only finds the business by the e-mail and hands out this
 *            business's public key (sent with the heartbeat, `loginReport`); each step is sealed to that key and the köprü
 *            brings it here (relay kind `login`). Step 1: this computer checks the password and answers NEED_CODE with a
 *            one-time ticket (5 minutes, bound to the device's key); step 2 brings the ticket and the code. Wrong passwords
 *            and wrong codes count per business (5 free, then 1, 2, 4 … at most 15 minutes; 50 in a day close it until
 *            tomorrow), and the code's own counters (server/report-security.ts) count too. Then the device is added and the
 *            owner hears it ("Yeni cihaz bağlandı"). At most 3 devices: a right code on a full list gets the list and a
 *            one-time ticket ("Hangisinin yerine?"). The device names itself ("iPhone · 15 Ekim") and sends its own random id
 *            (kept in its localStorage and IndexedDB): the same id of the same owner signing in again replaces that entry;
 *            a browser that forgot everything is a new entry and the limit screen handles it. The kind is only the icon.
 *            The answer carries a one-time 2-minute `grant`: "İşletmeyi yönet" opens with it right after the sign-in without
 *            asking the password and code again (server/remote-admin.ts). This computer must be on to let a new device in;
 *            paired devices read the postbox while it is off. "Kaldır" in Ayarlar → Uzaktan erişim (the password again) and
 *            "Çıkış" on the device drop one at once (here, and Merkez forgets its token and postbox).
 *   Live     The device asks through Merkez (relay kind `phone`): HMAC-signed, fresh (±5 min) and one-time (nonce); the answer
 *            is the report sealed for that device, bound to the question.
 *   Postbox  Every RELAY postbox period while this computer runs (MOLA_POSTBOX_MS, 5 minutes), after a gün sonu and when Mola
 *            closes, the very same report is sealed for each device and left at Merkez (one box per device, deleted on fetch
 *            or after 7 days), so the device shows it as "Kasa bilgisayarı kapalı ya da internete bağlı değil · Son durum 23:40" while this computer is off.
 * Only an active owner's devices are answered: a device paired by an owner whose account was closed gets nothing.
 */
type Phone = { id: string; name: string; pub: string; ownerId: string; ownerName: string; pairedAt: string; lastSeenAt?: string; kind?: DeviceKind; device?: string };
type Record_ = { v: 1; key?: { privateKey: string; publicKey: string }; phones: Phone[]; log: { at: string; text: string }[] };
/** `code`: the password was right, the phone code comes next; `replace`: the code was right too and the list is full. */
type Ticket = { tenant: string; ownerId: string; phonePub: string; until: number; stage: 'code' | 'replace'; tries: number };
/** "İşletmeyi yönet" right after a sign-in (server/remote-admin.ts takes it once). */
type Grant = { tenant: string; phoneId: string; ownerId: string; until: number };
const GRANT_MS = 2 * 60_000;
const POSTBOX_MS = () => Number(process.env.MOLA_POSTBOX_MS) || 5 * 60_000;
const FRESH_MS = 5 * 60_000;
/** How often a device's "son rapor" time is written (a phone asks every minute while open). */
const SEEN_MS = 60_000;
/** The same words for an unknown e-mail (Mola Merkez) and a wrong password: nobody learns which part was wrong. */
export const LOGIN_WRONG = 'E-posta ya da şifre hatalı.';
/** Step 2: the password was right a moment ago, so the code may be named. */
export const CODE_WRONG = 'Telefon kodu yanlış. Doğrulama uygulamasındaki güncel kodu yazın.';
const KIND_NAME: Record<DeviceKind, string> = { phone: 'Telefon', tablet: 'Tablet', computer: 'Bilgisayar' };
/** A device's name as the owner typed it: no control or direction characters, at most 40 letters. */
export const deviceName = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
/** Checks the signed-in user's own password in this request (server/app.ts; wrong attempts count on the login limiter). */
export type ConfirmPassword = (req: Request, actor: Actor, password: string | undefined) => Promise<void>;
/** Checks the owner's own 6-digit phone code (server/report-security.ts: the same counters as the reports' code). */
export type OwnerCode = (actor: Actor, code: string) => void;

export class RemoteReports {
  private tickets = new Map<string, Ticket>();
  private grants = new Map<string, Grant>();
  private fails = new Map<string, { count: number; until: number; waitUntil: number }>();
  private nonces = new Map<string, number>();
  private timer?: NodeJS.Timeout; private lastPush = 0; private pushing?: Promise<number>; private making?: Promise<void>;
  private keys = new Map<string, Promise<CryptoKey>>();
  notifications?: () => Pick<Notifications, 'add'> | undefined;
  /** "İşletmeyi yönet" in the report: undefined without it in the package, else whether the owner turned it on (server/app.ts). */
  adminState?: (tenant: string) => 'on' | 'off' | undefined;
  /** The phone code's check (server/report-security.ts is registered later: server/app.ts sets this). */
  ownerCode?: OwnerCode;
  constructor(private store: Store, private link: MerkezLink, private relay: RelayClient, private now: () => Date, private cash?: CashBook) {
    store.db.exec('CREATE TABLE IF NOT EXISTS remote_reports (tenant TEXT PRIMARY KEY, payload BLOB NOT NULL)');
    relay.sources.push(() => this.tenants());
    // A new device can sign in only while this computer polls: kept open while some business here could let one in.
    relay.holds.push(() => this.loginOpen());
    // A heartbeat may have just brought Merkez's 'remote.login' (the first one after activation or an update of Merkez).
    link.afterSync.push(() => relay.refresh());
    relay.on('login', r => this.login(r as Extract<RelayRequest, { kind: 'login' }>));
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
  /** The businesses of this computer with Uzaktan raporlar in the package (a removed one has none). */
  private licensed() { return Object.keys(this.link.read()?.licenses ?? {}).filter(t => !this.link.removed(t) && this.link.has(t, 'remote-reports')); }
  private owners(tenant: string) { return (this.store.read(tenant).staffUsers ?? []).filter(u => u.role === 'owner' && u.active); }
  /** Some business here could let a new device in now: the package, a Merkez that knows the sign-in, an owner with the phone code. */
  loginOpen() {
    try { return !!this.link.read()?.accepts?.includes('remote.login') && this.licensed().some(t => this.owners(t).some(u => !!u.mfa)); } catch { return false; }
  }
  /** The heartbeat's `remote` (server/kafe-link.ts): each business's public key and whether its owner has the phone code. */
  loginReport() {
    const out: { tenantId: string; pub: string; code: boolean }[] = []; let missing = false;
    for (const tenant of this.licensed()) {
      try { const k = this.read(tenant).key; if (!k) { missing = true; continue; } out.push({ tenantId: tenant, pub: k.publicKey, code: this.owners(tenant).some(u => !!u.mfa) }); } catch { /* a business without its key */ }
    }
    // The key pair is made once, in the background; the heartbeat right after takes it to Merkez.
    if (missing && !this.making) this.making = Promise.all(this.licensed().map(t => this.cafeKey(t).catch(() => undefined))).then(() => this.link.nudge()).finally(() => { this.making = undefined; });
    return out;
  }
  /** The phone code was set up or reset: Merkez hears it now and the köprü starts or stops. */
  codeChanged() { this.relay.refresh(); this.link.nudge(); }
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
  // ---------- Giriş ----------
  /** Wrong answers per business (a stranger can make a new key every time, so not per device). */
  private loginWait(tenant: string, t: number) {
    const f = this.fails.get(tenant);
    if (!f || f.until <= t) return '';
    if (f.count >= 50) return 'Bugün çok fazla hatalı giriş denendi. Yarın yeniden deneyin ya da kasada şifrenizi değiştirin.';
    return f.waitUntil > t ? `Çok fazla hatalı deneme. ${Math.ceil((f.waitUntil - t) / 60_000)} dakika sonra yeniden deneyin.` : '';
  }
  private loginFailed(tenant: string, t: number) {
    const before = this.fails.get(tenant), f = before && before.until > t ? before : { count: 0, until: t + 86400_000, waitUntil: 0 };
    f.count++; if (f.count >= 5) f.waitUntil = t + Math.min(15 * 60_000, 60_000 * 2 ** (f.count - 5));
    this.fails.set(tenant, f);
    // The owner hears it once a day: someone may be guessing.
    if (f.count === 5) try { this.notifications?.()?.add(tenant, `remote:login-fails:${businessDay(t)}`, { kind: 'merkez', title: 'İşletmemi yönet: hatalı girişler', text: 'İşletmemi yönet’e 5 kez yanlış şifre ya da kodla girilmeye çalışıldı. Siz değilseniz şifrenizi değiştirin.' }); } catch { /* the counter has it */ }
  }
  private async login(r: Extract<RelayRequest, { kind: 'login' }>): Promise<RelayReply> {
    const tenant = r.tenantId, q = r.request as LoginRequest, t = this.now().getTime();
    if (!this.link.has(tenant, 'remote-reports')) throw featureRefusal('remote-reports');
    if (Math.abs(q.at - t) > FRESH_MS) throw new DomainError('REQUEST_STALE', 'Cihazın saati kasa bilgisayarından çok farklı. Cihazda saati otomatik yapın.', 403);
    const key = await this.cafeKey(tenant), opened = await readLogin(await this.privateKey(tenant, key.privateKey), q);
    if (!opened) throw new DomainError('REQUEST_INVALID', 'Giriş doğrulanamadı. Sayfayı yenileyip yeniden deneyin.', 403);
    if (this.seen(q.phonePub, q.nonce, t)) throw new DomainError('REPLAY', 'Bu istek daha önce kullanıldı.', 403);
    for (const [k, v] of this.tickets) if (v.until <= t) this.tickets.delete(k);
    for (const [k, v] of this.grants) if (v.until <= t) this.grants.delete(k);
    const answer = async (a: LoginAnswer, plain: Record<string, unknown> = {}): Promise<RelayReply> => ({ status: 200, json: { ok: a.ok, ...plain, box: await sealLoginAnswer(opened.key, q.nonce, a) } });
    const fail = (code: string, message: string, more: Pick<Extract<LoginAnswer, { ok: false }>, 'devices' | 'ticket'> = {}) => answer({ ok: false, code, message, ...more });
    const inner = opened.inner, owners = this.owners(tenant);
    const ticketFor = (u: StaffUser, stage: Ticket['stage']) => { const ticket = randomB64u(16); this.tickets.set(ticket, { tenant, ownerId: u.id, phonePub: q.phonePub, until: t + RELAY.LOGIN_TICKET_MS, stage, tries: 0 }); return ticket; };
    const wrong = (u: StaffUser | undefined) => {
      this.loginFailed(tenant, t);
      try { this.store.mutate(tenant, x => { x.audit.push({ action: 'remote.login_failed', actor: u?.id ?? 'unknown', target: tenant, at: new Date(t).toISOString() }); }); } catch { /* the counter has it */ }
    };
    const expired = () => fail('LOGIN_EXPIRED', 'Süre doldu. E-posta ve şifrenizi yeniden yazın.');
    // Said before the password is checked: no answer here tells whether a password was right without the code.
    if (!owners.some(u => u.mfa)) return fail('CODE_MISSING', 'Önce kasada Ayarlar → Uzaktan erişim’de telefon kodunu kurun.');
    let owner: StaffUser | undefined;
    const held = inner.ticket ? this.tickets.get(inner.ticket) : undefined;
    const valid = (stage: Ticket['stage']) => !!held && held.stage === stage && held.tenant === tenant && held.phonePub === q.phonePub && held.until > t;
    if (inner.ticket && inner.replace !== undefined) {
      // "Hangisinin yerine?": the password and the code were right a moment ago; the ticket stands for them, once.
      this.tickets.delete(inner.ticket);
      owner = valid('replace') ? owners.find(u => u.id === held!.ownerId) : undefined;
      if (!owner) return expired();
    } else {
      const wait = this.loginWait(tenant, t);
      if (wait) return fail('RATE_LIMIT', wait);
      if (inner.ticket) {
        // Step 2: the code for the password given a moment ago (a wrong code keeps the ticket for a few more tries).
        owner = valid('code') ? owners.find(u => u.id === held!.ownerId && !!u.mfa) : undefined;
        if (!owner) { this.tickets.delete(inner.ticket); return expired(); }
      } else {
        for (const u of owners) if (u.mfa && await passwordMatches(inner.password ?? '', u)) { owner = u; break; }
        if (!owner) { wrong(undefined); return fail('LOGIN_FAILED', LOGIN_WRONG); }
        // Step 1 (0.1.23): the code comes on the next screen. A page from before sends both at once: checked together.
        if (inner.code === undefined) return fail('NEED_CODE', 'Telefon kodunu yazın.', { ticket: ticketFor(owner, 'code') });
      }
      // The code is spent only after the right password (a wrong password does not burn the owner's current code).
      let coded = false;
      if (this.ownerCode) try { this.ownerCode({ tenantId: tenant, id: owner.id, role: 'owner' }, (inner.code ?? '').replace(/\D/g, '')); coded = true; }
      catch (e) { if (e instanceof DomainError && e.code === 'RATE_LIMIT') return fail('RATE_LIMIT', e.message); }
      if (!coded) {
        wrong(owner);
        if (!inner.ticket) return fail('LOGIN_FAILED', LOGIN_WRONG);
        if (++held!.tries >= 5) { this.tickets.delete(inner.ticket); return fail('CODE_WRONG', `${CODE_WRONG} Sonra e-posta ve şifrenizi yeniden yazın.`); }
        return fail('CODE_WRONG', CODE_WRONG, { ticket: inner.ticket });
      }
      if (inner.ticket) this.tickets.delete(inner.ticket);
      this.fails.delete(tenant);
    }
    const who = owner, kind = inner.kind, name = deviceName(inner.name) || KIND_NAME[kind], device = /^[A-Za-z0-9_-]{16,64}$/.test(inner.device ?? '') ? inner.device : undefined;
    // The same device signing in again (its own random id; Safari forgot the keys): that entry goes, no second line.
    const before = this.read(tenant).phones, going = before.filter(p => (!!device && p.ownerId === who.id && p.device === device) || (!!inner.replace && p.id === inner.replace));
    const staying = before.filter(p => !going.includes(p));
    if (staying.length >= RELAY.MAX_PHONES)
      return fail('DEVICE_LIMIT', `En fazla ${RELAY.MAX_PHONES} cihaz. Hangisinin yerine?`, { ticket: ticketFor(who, 'replace'), devices: staying.map(p => ({ id: p.id, name: p.name, kind: p.kind ?? null, lastSeenAt: p.lastSeenAt ?? null })) });
    const id = randomB64u(16), at = new Date(t).toISOString(), gone = new Set(going.map(p => p.id));
    this.write(tenant, x => {
      for (const p of x.phones) if (gone.has(p.id)) x.log.push({ at, text: `Cihazın yerine yenisi geldi: ${p.name}.` });
      x.phones = x.phones.filter(p => !gone.has(p.id));
      x.phones.push({ id, name, pub: q.phonePub, ownerId: who.id, ownerName: who.name, pairedAt: at, kind, ...(device ? { device } : {}) });
      x.log.push({ at, text: `Cihaz bağlandı: ${name} (${who.name}).` });
    });
    this.store.mutate(tenant, x => { x.audit.push({ action: 'remote.phone_paired', actor: who.id, target: id, at }); });
    try { this.notifications?.()?.add(tenant, `phone:paired:${id}`, { kind: 'merkez', title: 'Yeni cihaz bağlandı', text: `Yeni cihaz bağlandı: ${name}. Siz değilseniz Ayarlar → Uzaktan erişim’den kaldırın.` }); } catch { /* the log has it */ }
    this.relay.refresh(); void this.relay.announce();
    // The first postbox box at once, so the device has the full report even if this computer goes off a minute later.
    // Merkez adds the device when this answer reaches it; a box that got there first is not kept, so it goes once more.
    const first = (again: boolean) => void this.push('paired', true).then(kept => { if (again && kept < this.tenantPhones(tenant)) setTimeout(() => first(false), 3000).unref?.(); }, () => { if (again) setTimeout(() => first(false), 3000).unref?.(); });
    setTimeout(() => first(true), 300).unref?.();
    const grant = randomB64u(16); this.grants.set(grant, { tenant, phoneId: id, ownerId: who.id, until: t + GRANT_MS });
    return answer({ ok: true, phoneId: id, business: this.store.read(tenant).name, name, grant }, { phoneId: id, removed: [...gone] });
  }
  /** Every paired device of every business here (what one postbox round should leave at Merkez). */
  private tenantPhones(tenant: string) { try { return this.tenants().reduce((n, x) => n + x.phones.length, 0) || this.read(tenant).phones.length; } catch { return 0; } }
  /** "İşletmeyi yönet" right after the sign-in: the grant this device was just given, once and in time (server/remote-admin.ts). */
  takeGrant(tenant: string, phoneId: string, grant: string) {
    const g = this.grants.get(grant); this.grants.delete(grant);
    return g && g.tenant === tenant && g.phoneId === phoneId && g.until > this.now().getTime() ? g : undefined;
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
    if (!p || !owner) throw new DomainError('PHONE_REVOKED', 'Bu cihazın bağlantısı kaldırıldı. Yeniden giriş yapabilirsiniz.', 403);
    return p;
  }
  private async live(r: Extract<RelayRequest, { kind: 'phone' }>): Promise<RelayReply> {
    if (!this.link.has(r.tenantId, 'remote-reports')) throw featureRefusal('remote-reports');
    const p = this.phoneOf(r.tenantId, r.phoneId), t = this.now().getTime(), q = r.request as LiveRequest, key = await this.cafeKey(r.tenantId);
    if (q.phone !== p.id || !await liveSigned(await this.privateKey(r.tenantId, key.privateKey), p.pub, q)) throw new DomainError('REQUEST_INVALID', 'İstek doğrulanamadı.', 403);
    if (Math.abs(q.at - t) > FRESH_MS) throw new DomainError('REQUEST_STALE', 'Telefonun saati kafe bilgisayarından çok farklı. Telefonda saati otomatik yapın.', 403);
    if (this.seen(p.id, q.nonce, t)) throw new DomainError('REPLAY', 'Bu istek daha önce kullanıldı.', 403);
    // "Çıkış" on the device (a shared laptop cleaned): it is dropped here like "Kaldır".
    if (q.op === 'forget') {
      this.removePhone(r.tenantId, p.id, 'cihazdan çıkış yapıldı');
      this.store.mutate(r.tenantId, x => { x.audit.push({ action: 'remote.phone_removed', actor: p.ownerId, target: p.id, at: new Date(t).toISOString() }); });
      return { status: 200, json: { ok: true } };
    }
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
      v: 1, business: s.name, at: now.toISOString(), day: today, reason, ...(s.theme ? { theme: s.theme } : {}),
      today: { sales: o.sales, cash: o.cash, card: o.card, platform: o.platform, orders: o.orders, closedAccounts: o.closedAccounts, averageAccount: o.averageAccount, expenses: o.expenses, refunds: o.refunds, kept: o.kept, cancelled: o.cancelled,
        channels: o.channels.filter(c => c.orders || c.amount).map(c => ({ name: c.name, orders: c.orders, amount: c.amount })), previous: o.previous ? { sales: o.previous.sales, ...(o.previous.partial ? { partial: true } : {}) } : null },
      topProducts: o.topProducts.map(p => ({ name: p.name, qty: p.qty, amount: p.amount, ...(p.unit ? { unit: p.unit } : {}), ...(p.grams ? { grams: p.grams } : {}) })),
      hourly: o.hourly.filter(h => h.sales > 0).map(h => ({ hour: h.hour, sales: h.sales })),
      open: { accounts: s.accounts.filter(a => a.status === 'open').length, amount: o.openAccounts ?? 0 },
      lastClosing: closing && closing.status === 'closed' ? { at: closing.closedAt ?? closing.to, day: closing.day, byName: closing.byName, ...(closing.extra ? { extra: true } : {}), counted: closing.counted, expected: closing.figures.expected, difference: closing.difference } : null,
      days: m.daily.map(d => ({ day: d.day, sales: d.sales })),
      // adminSteps: this café checks the password and the code of "İşletmeyi yönet" in two steps (0.1.24; the page asks both
      // screens either way, an older café gets them together).
      ...((admin => admin ? { admin, adminSteps: 2 as const } : {})(this.adminState?.(tenant))),
    };
  }
  // ---------- Postbox ----------
  /** Seals the summary for every paired phone and leaves it at Merkez (returns how many Merkez kept). At most every 30 s unless `force` (closing, shutdown, a new device). */
  push(reason: PhoneReportReason, force = false): Promise<number> {
    // One at a time; a forced one (closing, a new device) waits for the running one and sends its own after it (that one
    // may have been sealed before the new device was listed).
    if (this.pushing) return force ? this.pushing.catch(() => 0).then(() => this.push(reason, true)) : this.pushing;
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
      const sent = await this.relay.post<{ kept?: number }>('/relay/postbox', { items }, 15_000);
      this.lastPush = Date.now();
      return typeof sent?.kept === 'number' ? sent.kept : items.length;
    })().finally(() => { this.pushing = undefined; });
    return this.pushing;
  }
  /**
   * Where devices sign in: "İşletmemi yönet" (/yonet, 0.1.23: the reports and the full screens on one page) on Mola Merkez's
   * public address, or its own address when Merkez named one (https://isletme.molayazilim.com.tr: the page is its root; null
   * before activation).
   */
  address() {
    const r = this.link.read(); if (!r) return null;
    if (r.ownerHost?.base) return r.ownerHost.base;
    try { return new URL('/yonet', `${(r.lanLink?.base ?? this.link.url).replace(/\/+$/, '')}/`).toString(); } catch { return null; }
  }
  view(tenant: string) {
    const r = this.read(tenant);
    return { phones: r.phones.map(p => ({ id: p.id, name: p.name, ownerName: p.ownerName, pairedAt: p.pairedAt, lastSeenAt: p.lastSeenAt ?? null, kind: p.kind ?? null })), max: RELAY.MAX_PHONES, address: this.address(),
      relay: { connected: this.relay.connected(), error: this.relay.lastError }, log: [...r.log].reverse().slice(0, 30) };
  }
}

/**
 * Owner only (the owner's own account; Müdür, other staff and Mola destek get 403): GET /api/staff/remote-reports (the
 * devices, the Raporlarım address `address`, whether the owner has a phone code `code`), POST /api/staff/remote-reports/
 * phones/remove { id, password }. Devices sign in on the İşletmemi yönet page (/yonet; no pairing here since 0.1.22). A remote session
 * ("İşletmeyi yönet") cannot remove (server/remote-admin.ts REMOTE_FORBIDDEN). "Gün sonu" (a final closing) sends the postbox
 * at once; setting the phone code up or resetting it tells Mola Merkez at once (the sign-in depends on it).
 */
export function remoteReportRoutes(app: Express, store: Store, reports: RemoteReports, actorFor: (req: Request) => Actor, confirmPassword: ConfirmPassword) {
  const owner = (req: Request) => { const a = actorFor(req), s = store.read(a.tenantId); requireRole(s, a, ['owner']); return { a, s }; };
  const hasCode = (a: Actor) => !!store.read(a.tenantId).staffUsers?.find(u => u.id === a.id)?.mfa;
  const view = (a: Actor) => ({ ...reports.view(a.tenantId), code: hasCode(a) });
  app.use('/api/staff/cash/finish', (_req, res, next) => { res.on('finish', () => { if (res.statusCode < 400) void reports.push('closing', true).catch(() => {}); }); next(); });
  app.use(/^\/api\/staff\/report-security\/(enable|recover)$/, (_req, res, next) => { res.on('finish', () => { if (res.statusCode < 400) reports.codeChanged(); }); next(); });
  app.get('/api/staff/remote-reports', (req, res) => { const { a } = owner(req); res.setHeader('Cache-Control', 'no-store'); res.json(view(a)); });
  app.post('/api/staff/remote-reports/phones/remove', async (req, res) => {
    const { a } = owner(req), b = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{22}$/), password: z.string().max(200).optional() }).strict().parse(req.body);
    // The password again, but deliberately not the phone code: the lost phone may be the one with the authenticator app, and
    // the owner must still be able to cut it off.
    await confirmPassword(req, a, b.password);
    const { a: still, s } = owner(req);
    const p = reports.removePhone(still.tenantId, b.id, s.staffUsers?.find(u => u.id === still.id)?.name ?? 'İşletme sahibi');
    store.mutate(still.tenantId, x => { x.audit.push({ action: 'remote.phone_removed', actor: still.id, target: p.id, at: new Date().toISOString() }); });
    res.json(view(still));
  });
}

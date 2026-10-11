import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { merkezAddress, signNote, type SignedAddress, type SignedDemo } from '../signed-notes.js';
import type { SyncRequest } from '../sync-protocol.js';
import { addAlert } from './alerts.js';
import type { Install, MerkezBusiness, MerkezData, MerkezStore } from './store.js';

/*
 * Mola Merkez's side of two Dalga 3 pieces (registered by server/merkez/app.ts):
 *   Tanıtım işletmesi  Mola Yönetim → işletme → Hizmet: "Tanıtım işletmesi" (a demo for sales visits) and "Tanıtımı sıfırla".
 *                      Both travel signed (mola-tanitim-1) in the heartbeat answer; the café does the reset itself (backup
 *                      first, server/demo-reset.ts) and reports the result with its next heartbeat. Manual only: an order is
 *                      signed while pending and at most DEMO_ORDER_DAYS; nothing here ever orders a reset by itself.
 *   Merkez adresi      After a move (VDS + HTTPS) this Merkez announces the new address, signed (mola-adres-1), to every café;
 *                      a café switches only after the new address answers its nonce with the same key and knows its install
 *                      (POST /api/merkez/v1/address/proof). Set in Ayarlar API or MERKEZ_YENI_ADRES (docs/VDS_KURULUM.md).
 */
const DEMO_ORDER_DAYS = 3, DAY = 86400000;
const sectorNames = { cafe: 'Kafe', restaurant: 'Restoran', dessert: 'Tatlıcı / Pastane' } as const;
export type DemoDeps = {
  store: MerkezStore; now: () => Date;
  admin: (req: Request) => unknown;
  once: <T>(d: MerkezData, scope: string, b: object, fn: () => T) => T;
  find: (d: MerkezData, tenantId: string) => MerkezBusiness;
  /** The heartbeat's own install check and signed answer (server/merkez/app.ts). */
  authenticate: (req: Request) => { install: Install; nonce: string; closed: boolean };
  sendSigned: (res: Response, secret: string, nonce: string, body: unknown) => void;
  limit: (key: string, max: number, ms: number) => void;
};
/** What Mola Yönetim shows about the demo state of one business. */
export const demoView = (b: MerkezBusiness) => ({ ...(b.demo !== undefined ? { demo: b.demo } : {}), ...(b.demoSince ? { demoSince: b.demoSince } : {}), ...(b.demoReset ? { demoReset: b.demoReset } : {}) });

/** The signed parts of a heartbeat answer: demo word per business of this install (ever marked), the moved address. */
export function signedNotes(store: MerkezStore, d: MerkezData, installId: string, mine: MerkezBusiness[], now: Date): { demo?: SignedDemo[]; address?: SignedAddress } {
  const at = now.toISOString(), t = now.getTime();
  const demo = mine.filter(b => b.demo !== undefined).map(b => {
    const r = b.demoReset, live = b.demo && r?.status === 'pending' && t - Date.parse(r.requestedAt) <= DEMO_ORDER_DAYS * DAY;
    return signNote('mola-tanitim-1', { v: 1, installId, tenantId: b.tenantId, demo: !!b.demo, issuedAt: at, ...(live ? { reset: { id: r!.id, sector: r!.sector, requestedAt: r!.requestedAt, demoPassword: r!.demoPassword } } : {}) }, store.signingKey);
  });
  const address = d.address ? signNote('mola-adres-1', { v: 1, url: d.address.url, issuedAt: d.address.issuedAt }, store.signingKey) : undefined;
  return { ...(demo.length ? { demo } : {}), ...(address ? { address } : {}) };
}
/** The café's reports of resets it did (inside the registry transaction of the heartbeat): history, alert, order closed. */
export function recordDemoReports(d: MerkezData, reports: SyncRequest['demo'], mine: MerkezBusiness[], now: Date) {
  const time = now.toISOString(), t = now.getTime();
  for (const b of mine) if (b.demoReset?.status === 'pending' && t - Date.parse(b.demoReset.requestedAt) > DEMO_ORDER_DAYS * DAY) { b.demoReset.status = 'expired'; b.demoReset.doneAt = time; d.audit.push({ action: 'demo.reset_expired', target: b.tenantId, at: time, by: 'cafe' }); }
  for (const r of reports ?? []) {
    const b = mine.find(x => x.tenantId === r.tenantId); if (!b) continue;
    const key = `demo-reset:${r.resetId}`;
    if ((d.alerts ?? []).some(a => a.key === key)) continue;
    const order = b.demoReset?.id === r.resetId ? b.demoReset : undefined;
    if (order) { order.status = r.ok ? 'done' : 'failed'; order.doneAt = r.at; if (r.error) order.error = r.error; else delete order.error; }
    const who = r.by === 'owner' ? 'işletme sahibi' : 'Mola Yönetim';
    d.audit.push({ action: r.ok ? (r.by === 'owner' ? 'demo.reset_by_owner' : 'demo.reset_done') : 'demo.reset_failed', target: b.tenantId, at: time, by: 'cafe', detail: `${sectorNames[r.sector]} şablonu · ${who}${r.ok ? '' : ` · ${r.error ?? 'olmadı'}`}` });
    addAlert(d, time, 'demo.reset', r.ok ? `${b.name}: tanıtım sıfırlandı (${sectorNames[r.sector]} şablonu, ${who}). Masaların QR kodları değişmedi.` : `${b.name}: tanıtım sıfırlanamadı: ${r.error ?? 'bilinmeyen sorun'}.`, { tenantId: b.tenantId, key, priority: 'low' });
  }
}

export function demoRoutes(app: Express, x: DemoDeps) {
  const request = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().min(1).max(100);
  // "Tanıtım işletmesi" on/off. Off: the café drops the label at the next heartbeat; a pending reset is withdrawn.
  app.post('/api/merkez/admin/demo', (req, res) => {
    x.admin(req); const b = z.object({ requestId: request, tenantId: id, demo: z.boolean() }).parse(req.body);
    res.json(x.store.mutate(d => x.once(d, 'demo', b, () => {
      const biz = x.find(d, b.tenantId), at = x.now().toISOString();
      if (!!biz.demo === b.demo) return { ok: true };
      biz.demo = b.demo; if (b.demo) biz.demoSince = at; else { delete biz.demoSince; if (biz.demoReset?.status === 'pending') { biz.demoReset.status = 'expired'; biz.demoReset.doneAt = at; } }
      d.audit.push({ action: b.demo ? 'demo.on' : 'demo.off', target: biz.tenantId, at, by: 'admin' });
      return { ok: true };
    })));
  });
  // "Tanıtımı sıfırla": one manual order (typed SIFIRLA), signed into the next heartbeat answers until the café reports it.
  app.post('/api/merkez/admin/demo/reset', (req, res) => {
    x.admin(req); const b = z.object({ requestId: request, tenantId: id, sector: z.enum(['cafe', 'restaurant', 'dessert']), demoPassword: z.boolean(), confirm: z.string().max(20) }).parse(req.body);
    if (b.confirm.trim().toLocaleUpperCase('tr-TR') !== 'SIFIRLA') throw new DomainError('CONFIRM', 'Onaylamak için kutuya SIFIRLA yazın.');
    res.json(x.store.mutate(d => x.once(d, 'demo-reset', b, () => {
      const biz = x.find(d, b.tenantId), at = x.now().toISOString();
      if (!biz.demo) throw new DomainError('NOT_DEMO', 'Önce işletmeyi “Tanıtım işletmesi” yapın.', 409);
      if (!biz.installId) throw new DomainError('NOT_ACTIVATED', 'İşletme Mola’yı henüz etkinleştirmedi.', 409);
      if (biz.suspended) throw new DomainError('SUSPENDED', 'Askıdaki işletme sıfırlanamaz.', 409);
      if (biz.demoReset?.status === 'pending') throw new DomainError('DEMO_PENDING', 'Bir sıfırlama zaten işletmenin bilgisayarını bekliyor.', 409);
      biz.demoReset = { id: randomUUID(), sector: b.sector, demoPassword: b.demoPassword, requestedAt: at, status: 'pending' };
      d.audit.push({ action: 'demo.reset_requested', target: biz.tenantId, at, by: 'admin', detail: `${sectorNames[b.sector]} şablonu${b.demoPassword ? ' · tanıtım şifresi' : ''}` });
      return { ok: true, resetId: biz.demoReset.id };
    })));
  });
  // "Merkez adresi" (after moving to a VDS): announced to every café, signed. Empty: no announcement.
  app.get('/api/merkez/admin/address', (req, res) => { x.admin(req); res.json({ address: x.store.read().address ?? null }); });
  app.post('/api/merkez/admin/address', (req, res) => {
    x.admin(req); const b = z.object({ requestId: request, url: merkezAddress.nullable() }).parse(req.body);
    res.json(x.store.mutate(d => x.once(d, 'address', b, () => setAddress(d, b.url, x.now()))));
  });
  // The new address's proof for one café: same install signature as /sync, answer signed with this Merkez's key.
  app.post('/api/merkez/v1/address/proof', (req, res) => {
    x.limit(`address-proof:${req.ip}`, 60, 60_000);
    const { install, nonce, closed } = x.authenticate(req);
    if (closed) throw new DomainError('RECORD_CLOSED', 'Bu kurulumun Mola kaydı kapatıldı.', 409);
    const b = z.object({ nonce: z.string().regex(/^[a-f0-9]{32}$/), url: merkezAddress }).strict().parse(req.body);
    x.sendSigned(res, install.secret, nonce, { proof: signNote('mola-adres-kanit-1', { v: 1, installId: install.id, nonce: b.nonce, url: b.url, serverTime: x.now().toISOString() }, x.store.signingKey) });
  });
}
/** Sets (or clears) the announced address; history and the time it was announced (the café keeps the newest). */
export function setAddress(d: MerkezData, url: string | null, now: Date) {
  const at = now.toISOString();
  if ((d.address?.url ?? null) === url) return { ok: true, address: d.address ?? null };
  if (url) d.address = { url, issuedAt: at }; else delete d.address;
  d.audit.push({ action: url ? 'merkez.address_announced' : 'merkez.address_cleared', target: 'merkez', at, by: 'admin', ...(url ? { detail: url } : {}) });
  return { ok: true, address: d.address ?? null };
}
/** An address typed in a setting (MERKEZ_YENI_ADRES), checked like the announcement itself; undefined when it is not one. */
export const merkezAddressFrom = (v: string) => { const r = merkezAddress.safeParse(v); return r.success ? r.data : undefined; };

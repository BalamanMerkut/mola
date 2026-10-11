import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { DomainError } from '../../packages/domain/engine.js';
import { journalContext, type JournalActor } from './journal.js';
import type { AccessToken, MerkezData, MerkezStore } from './store.js';

/*
 * "Geliştirici erişimi" (Mola Yönetim → Ayarlar): a token for the vendor's own scripts, created with the admin password,
 * shown once, revocable. Only its SHA-256 is kept (sealed registry). Sent as `Authorization: Bearer mola_…`.
 *   releases  only the Güncellemeler API (npm run yayinla: list, upload, notes, pilot/herkese/durdur); nothing else
 *   calisma   only the Çalışma klasörü snapshot (read), for the sync on the vendor's PC once Merkez runs on a VDS
 * The panel's other APIs never take a token; Mola Yönetim's own rule (this computer, or HTTPS) applies to tokens too.
 * Every create, revoke and refused use is in İşlem kayıtları; each use shows as the actor of what it did.
 */
export type TokenScope = AccessToken['scope'];
export const SCOPE_NAMES: Record<TokenScope, string> = { releases: 'Yalnız güncellemeler (yayınlama)', calisma: 'Yalnız çalışma klasörü (okuma)' };
const hashOf = (token: string) => createHash('sha256').update(`mola-erisim:v1:${token}`).digest('hex');
const prefix: Record<TokenScope, string> = { releases: 'mola_yayin_', calisma: 'mola_klasor_' };
export const tokenView = (t: AccessToken) => ({ id: t.id, name: t.name, scope: t.scope, scopeText: SCOPE_NAMES[t.scope], hint: t.hint, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt ?? null, revokedAt: t.revokedAt ?? null });
export const tokenActor = (t: Pick<AccessToken, 'id' | 'name'>): JournalActor => ({ kind: 'token', id: t.id, name: `Geliştirici erişimi · ${t.name}` });

/** A new token: the text once for the screen, the record (hash only) for the registry. */
export function newToken(d: MerkezData, name: string, scope: TokenScope, at: string) {
  const text = `${prefix[scope]}${randomBytes(32).toString('base64url')}`;
  const record: AccessToken = { id: randomUUID(), name, scope, hash: hashOf(text), hint: `${text.slice(0, prefix[scope].length + 4)}…${text.slice(-4)}`, createdAt: at };
  (d.accessTokens ??= []).push(record);
  return { text, record };
}
const sameHash = (a: string, b: string) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && timingSafeEqual(x, y); };
/** The bearer token of this request, if any (format only). */
export const bearer = (req: Request) => { const m = /^Bearer (mola_[a-z]+_[A-Za-z0-9_-]{43})$/.exec(req.get('authorization') ?? ''); return req.get('authorization') ? (m?.[1] ?? '') : undefined; };
/**
 * Checks a bearer token for `scope`; sets the request's actor. A wrong, revoked or other-scope token: 401 and one line in
 * İşlem kayıtları per address and minute (a script hammering a dead token does not fill the record).
 */
export function tokenGuard(store: MerkezStore, now: () => Date) {
  const told = new Map<string, number>();
  return (req: Request, scope: TokenScope) => {
    const text = bearer(req) ?? '', hash = text ? hashOf(text) : '';
    const d = store.read(), t = hash ? d.accessTokens?.find(x => sameHash(x.hash, hash)) : undefined;
    if (!t || t.revokedAt || t.scope !== scope) {
      const k = `${req.ip}:${t?.id ?? 'yok'}`, at = now().getTime();
      if ((told.get(k) ?? 0) < at - 60_000) {
        told.set(k, at); if (told.size > 500) told.clear();
        try { store.journal.append({ action: 'token.refused', detail: !t ? 'Bilinmeyen anahtar' : t.revokedAt ? `İptal edilmiş anahtar: ${t.name}` : `Yetkisi yok (${SCOPE_NAMES[t.scope]}): ${t.name}`, actor: t ? tokenActor(t) : { kind: 'token', name: 'Bilinmeyen anahtar' } }); } catch { /* record is secondary */ }
      }
      throw new DomainError('TOKEN_INVALID', t?.revokedAt ? 'Bu geliştirici erişim anahtarı iptal edilmiş. Mola Yönetim → Ayarlar → Geliştirici erişimi’nden yenisini oluşturun.' : 'Geliştirici erişim anahtarı geçersiz ya da bu işlem için yetkisi yok.', 401);
    }
    const ctx = journalContext.getStore(); if (ctx) ctx.actor = tokenActor(t);
    // "Son kullanım" at most once a minute (not a registry write on every call).
    if (!t.lastUsedAt || now().getTime() - Date.parse(t.lastUsedAt) > 60_000) try { store.mutate(x => { const r = x.accessTokens?.find(y => y.id === t.id); if (r) r.lastUsedAt = now().toISOString(); }); } catch { /* next time */ }
    return t;
  };
}

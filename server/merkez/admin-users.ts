import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { adminRecord, OWNER, type AdminUsers } from '../admin-auth.js';
import type { JournalActor } from './journal.js';
import type { AdminUser, MerkezStore } from './store.js';

/*
 * Ayarlar → Kullanıcılar (13 Ekim, sahibin isteği: "benden alt bir yetki, her şeyi yapabilsinler; kullanıcıları yalnız ben
 * görüp ekleyip sileyim"). The owner ("admin") adds a yetkili with a name, a sign-in name and a first password (changed at
 * their first sign-in), gives a new first password, or removes one (their sessions end at once). Every step asks the owner's
 * own password again. A yetkili can do everything else in Mola Yönetim with their own password and two-step login, except
 * this page and the e-mail settings (the address the owner's "Şifremi unuttum" code goes to: a yetkili changing it could take
 * the owner's account). İşlem kayıtları names the yetkili ("Ayşe Yılmaz (yetkili)").
 *   GET  /api/merkez/admin/me              → { owner, username, name }        (anyone signed in)
 *   GET  /api/merkez/admin/users           → { users: [{ id, username, name, createdAt, mfa, mustChange }] }
 *   POST /api/merkez/admin/users           { name, username, password, ownerPassword }
 *   POST /api/merkez/admin/users/password  { id, password, ownerPassword }    → a new first password
 *   POST /api/merkez/admin/users/delete    { id, ownerPassword }
 */
export const MAX_ADMIN_USERS = 10;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const NOT_OWNER = 'Bunu yalnız Mola Yönetim sahibi (admin hesabı) yapabilir: kullanıcılar, e-posta ayarları, Merkez kurtarma kodu ve geliştirici erişim anahtarları.';

/** The store side of the yetkililer, for server/admin-auth.ts. */
export function adminUsersOf(store: MerkezStore, at: () => string): AdminUsers {
  const one = (id: string) => store.read().adminUsers?.find(u => u.id === id);
  return {
    find: name => store.read().adminUsers?.find(u => u.username === name)?.id,
    read: id => one(id)?.record,
    username: id => one(id)?.username,
    change: (id, fn) => store.mutate(d => {
      const u = d.adminUsers?.find(x => x.id === id);
      if (!u) throw new DomainError('UNAUTHORIZED', 'Mola Yönetim hesabıyla giriş yapın.', 401);
      const holder = { admin: u.record };
      const result = fn(holder, (action, detail) => d.audit.push({ action, target: 'admin', at: at(), by: 'admin', detail: `${u.name} (yetkili)${detail ? ` · ${detail}` : ''}` }));
      u.record = holder.admin;
      return result;
    }),
  };
}
/** Who İşlem kayıtları names for a session: the owner as before, a yetkili by name. */
export const actorOf = (store: MerkezStore, who: string, owner: JournalActor): JournalActor => {
  if (who === OWNER) return owner;
  const u = store.read().adminUsers?.find(x => x.id === who);
  return { kind: 'admin', id: who, name: `${u?.name ?? 'Silinmiş kullanıcı'} (yetkili)` };
};

type Deps = {
  store: MerkezStore; at: () => string;
  admin: (req: Request) => string; whoOf: (req: Request) => string; endSessions: (who: string) => void;
  checkPassword: (req: Request, password: string) => Promise<boolean>; strong: (password: string) => void;
};
export function adminUserRoutes(app: Express, o: Deps) {
  const owner = (req: Request) => { o.admin(req); if (o.whoOf(req) !== OWNER) throw new DomainError('OWNER_ONLY', NOT_OWNER, 403); };
  /** The owner's own password again, for every change here (a session left open is not enough). */
  const confirm = async (req: Request, password: string) => { if (!await o.checkPassword(req, password)) throw new DomainError('INVALID_PASSWORD', 'Kendi (admin) şifreniz yanlış.', 403); };
  const view = (u: AdminUser) => ({ id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, mfa: !!u.record.mfa, mustChange: !!u.record.mustChange });
  const find = (id: string) => { const u = o.store.read().adminUsers?.find(x => x.id === id); if (!u) throw new DomainError('NOT_FOUND', 'Kullanıcı bulunamadı. Listeyi yenileyin.', 404); return u; };
  const ownerPassword = z.string().min(1, 'Kendi (admin) şifrenizi yazın.').max(128), id = z.string().uuid();

  app.get('/api/merkez/admin/me', (req, res) => {
    o.admin(req); const who = o.whoOf(req);
    if (who === OWNER) { res.json({ owner: true, username: OWNER, name: 'Yönetici' }); return; }
    const u = find(who); res.json({ owner: false, username: u.username, name: u.name });
  });
  app.get('/api/merkez/admin/users', (req, res) => {
    owner(req);
    res.json({ users: (o.store.read().adminUsers ?? []).map(view), max: MAX_ADMIN_USERS });
  });
  app.post('/api/merkez/admin/users', async (req, res) => {
    owner(req);
    const b = z.object({
      name: z.string().trim().min(2, 'Adı ve soyadı yazın.').max(60).regex(/^[^<>\u0000-\u001f]*$/, 'Adda kullanılamayan karakter var.'),
      username: z.string().trim().toLowerCase().regex(USERNAME, 'Kullanıcı adı 3–32 karakter: küçük harf, rakam, nokta, tire (ör. ayse.yilmaz).'),
      password: z.string().max(128), ownerPassword,
    }).strict().parse(req.body);
    if (b.username === OWNER) throw new DomainError('USERNAME_TAKEN', '“admin” sizin hesabınızın adı; başka bir kullanıcı adı seçin.', 409);
    o.strong(b.password);
    await confirm(req, b.ownerPassword);
    const record = await adminRecord(b.password);
    const user = o.store.mutate(d => {
      const list = d.adminUsers ??= [];
      if (list.some(u => u.username === b.username)) throw new DomainError('USERNAME_TAKEN', 'Bu kullanıcı adı kullanılıyor.', 409);
      if (list.length >= MAX_ADMIN_USERS) throw new DomainError('TOO_MANY_USERS', `En çok ${MAX_ADMIN_USERS} yetkili eklenebilir.`, 409);
      const u: AdminUser = { id: randomUUID(), username: b.username, name: b.name, createdAt: o.at(), record: { ...record, mustChange: true } };
      list.push(u);
      d.audit.push({ action: 'admin.user_added', target: 'admin', at: o.at(), by: 'admin', detail: `${u.name} · kullanıcı adı ${u.username} · ilk girişte şifresini değiştirecek` });
      return u;
    });
    res.json({ user: view(user) });
  });
  app.post('/api/merkez/admin/users/password', async (req, res) => {
    owner(req);
    const b = z.object({ id, password: z.string().max(128), ownerPassword }).strict().parse(req.body);
    find(b.id); o.strong(b.password);
    await confirm(req, b.ownerPassword);
    const record = await adminRecord(b.password);
    const user = o.store.mutate(d => {
      const u = d.adminUsers?.find(x => x.id === b.id);
      if (!u) throw new DomainError('NOT_FOUND', 'Kullanıcı bulunamadı. Listeyi yenileyin.', 404);
      // Two-step login stays: a new password alone does not open the account for someone who has the old phone.
      u.record = { ...record, mustChange: true, ...(u.record.mfa ? { mfa: u.record.mfa } : {}) };
      d.audit.push({ action: 'admin.user_password_set', target: 'admin', at: o.at(), by: 'admin', detail: `${u.name} · ilk girişte değiştirecek; açık oturumları kapatıldı` });
      return u;
    });
    o.endSessions(user.id);
    res.json({ user: view(user) });
  });
  app.post('/api/merkez/admin/users/delete', async (req, res) => {
    owner(req);
    const b = z.object({ id, ownerPassword }).strict().parse(req.body);
    find(b.id);
    await confirm(req, b.ownerPassword);
    o.store.mutate(d => {
      const u = d.adminUsers?.find(x => x.id === b.id);
      if (!u) throw new DomainError('NOT_FOUND', 'Kullanıcı bulunamadı. Listeyi yenileyin.', 404);
      d.adminUsers = d.adminUsers!.filter(x => x.id !== b.id);
      d.audit.push({ action: 'admin.user_removed', target: 'admin', at: o.at(), by: 'admin', detail: `${u.name} · kullanıcı adı ${u.username} · açık oturumları kapatıldı` });
    });
    o.endSessions(b.id);
    res.json({ ok: true });
  });
  return { owner };
}

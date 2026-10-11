import { adminOpen, deviceSession, openReply, readOpenAnswer, sealCall, type AdminAnswer, type TunnelRequest } from '../packages/domain/remote-admin-crypto';
import { fromB64u, randomB64u } from '../packages/domain/remote-crypto';
import type { Paired } from './phoneVault';

/*
 * Sahibin uzaktan yönetimi, the browser's side (server/remote-admin.ts, packages/domain/remote-admin-crypto.ts). On Mola
 * Merkez's /yonet page (src/RemoteAdmin.tsx) the café's own screens run as usual, but every /api and /media request goes
 * through this tunnel: sealed with the session key (AES-256-GCM, a sequence number per tab, bound to its answer), posted to
 * Mola Merkez, which hands it to the café as ciphertext. The answer comes back sealed and becomes an ordinary Response, so the
 * screens (src/api.ts `transport()`, and the few direct fetch() calls such as downloads) need no change. Large answers (Excel,
 * PDF) come in parts. Product photos (<img src="/media/…">) are fetched through the tunnel and shown from blob: addresses.
 * The session key is a non-extractable CryptoKey kept in this origin's IndexedDB until the session ends (a reload keeps it).
 */
const API = '/api/merkez/v1/phone/admin';
export const REMOTE_ENDED_EVENT = 'mola:remote-ended';
export class RemoteError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }
export type RemoteSession = { v: 1; sid: string; phoneId: string; key: CryptoKey; business: string; device: string; expiresAt: string; startedAt: string };
type Active = { session: RemoteSession; paired: Paired; tab: string; seq: number };
let active: Active | null = null;
/** The browser's own fetch while the tunnel stands in for it (read at call time otherwise: tests stub it). */
let saved: typeof fetch | undefined;
const realFetch: typeof fetch = (input, init) => (saved ?? globalThis.fetch)(input, init);

/** True while this page runs the café's screens through the tunnel. */
export const remoteMode = () => !!active;
/** src/api.ts: the fetch to use (the tunnel only in remote mode). */
export const transport = (): typeof fetch => active ? remoteFetch : realFetch;

// ---------- The session in IndexedDB ----------
const DB = 'mola-yonet', STORE = 'oturum', KEY = 'aktif';
function db(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error ?? new Error('Oturum kasası açılamadı.'));
  });
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try { return await new Promise<T>((done, fail) => { const tx = d.transaction(STORE, mode), r = fn(tx.objectStore(STORE)); tx.oncomplete = () => done(r.result); tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error); }); }
  finally { d.close(); }
}
const readSaved = () => run<RemoteSession | undefined>('readonly', s => s.get(KEY) as IDBRequest<RemoteSession | undefined>);
const forgetSaved = () => run('readwrite', s => s.delete(KEY)).catch(() => undefined);

// ---------- Sign-in ----------
async function post(body: unknown, signal?: AbortSignal | null) {
  const r = await realFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', ...(signal ? { signal } : {}) });
  let data: Record<string, any> = {}; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data };
}
/** Password + the 6-digit code, sealed for the café by this paired device; then the session key. */
export async function openRemote(paired: Paired, password: string, code: string) {
  const { request, k1, ephPrivate } = await adminOpen(paired.privateKey, paired.cafePublic, paired.phoneId, { password, code: code.replace(/\D/g, '') });
  const r = await post({ phoneId: paired.phoneId, token: paired.token, request }, AbortSignal.timeout(30_000));
  if (r.status !== 200 || typeof r.data.iv !== 'string') throw new RemoteError(r.data.message ?? 'Kafe bilgisayarına ulaşılamadı. Biraz sonra yeniden deneyin.', r.status, r.data.code ?? 'REMOTE_FAILED');
  // Only the café could seal this answer (k1 needs its private key): Mola Merkez cannot fake a session.
  let answer; try { answer = await readOpenAnswer(k1, request.nonce, { iv: r.data.iv, ct: r.data.ct }); } catch { throw new RemoteError('Kafe bilgisayarının cevabı doğrulanamadı.', 502, 'ANSWER_INVALID'); }
  if (!answer.ok) throw new RemoteError(answer.message, 403, answer.code);
  const session: RemoteSession = { v: 1, sid: answer.sid, phoneId: paired.phoneId, key: await deviceSession(k1, ephPrivate, request.eph, answer.eph, answer.sid), business: answer.business, device: answer.device, expiresAt: answer.expiresAt, startedAt: new Date().toISOString() };
  try { await run('readwrite', s => s.put(session, KEY)); } catch { /* this tab still works */ }
  activate(session, paired);
  return session;
}
/** A reload: the session this device still has (until it ends or 05:00). */
export async function resumeRemote(paired: Paired) {
  let s: RemoteSession | undefined; try { s = await readSaved(); } catch { return null; }
  if (!s || s.phoneId !== paired.phoneId || !(Date.parse(s.expiresAt) > Date.now())) { await forgetSaved(); return null; }
  activate(s, paired);
  return s;
}
function activate(session: RemoteSession, paired: Paired) {
  active = { session, paired, tab: randomB64u(8), seq: 0 };
  // Downloads and the few other direct fetch() calls of the screens go through the tunnel too.
  if (window.fetch !== remoteFetch) { saved = window.fetch.bind(window); window.fetch = remoteFetch; }
  watchMedia();
}
/** The session ended (here or at the café): back to the sign-in, with the reason. */
function ended(message: string) {
  if (!active) return;
  active = null;
  if (saved) { window.fetch = saved; saved = undefined; }
  void forgetSaved();
  window.dispatchEvent(new CustomEvent(REMOTE_ENDED_EVENT, { detail: message }));
}

// ---------- The tunnel ----------
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SENT_HEADERS = ['accept', 'content-type', 'x-mola-tag', 'x-mola-activity'];
async function remoteFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!active || url.origin !== location.origin || !/^\/(api|media)\//.test(url.pathname) || url.pathname.startsWith('/api/merkez/')) return realFetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'POST') return json(405, { code: 'METHOD', message: 'Bu işlem uzaktan yapılamaz.' });
  const given = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)), h: Record<string, string> = {};
  for (const name of SENT_HEADERS) { const v = given.get(name); if (v) h[name] = v; }
  if (init?.body != null && typeof init.body !== 'string') return json(400, { code: 'BODY', message: 'Bu dosya uzaktan gönderilemez.' });
  return tunnel({ m: method as 'GET' | 'POST', p: url.pathname + url.search, h, ...(typeof init?.body === 'string' ? { b: init.body } : {}) }, init?.signal);
}
async function tunnel(request: TunnelRequest, signal?: AbortSignal | null): Promise<Response> {
  const a = active!, head = { sid: a.session.sid, tab: a.tab, seq: ++a.seq, at: Date.now() };
  const r = await post({ phoneId: a.paired.phoneId, token: a.paired.token, request: await sealCall(a.session.key, head, request) }, signal);
  if (r.status !== 200 || typeof r.data.iv !== 'string') {
    if (['REMOTE_ENDED', 'PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(r.data.code)) ended(r.data.message ?? 'Uzak oturum kapandı.');
    return json(r.status === 200 ? 502 : r.status, { code: r.data.code ?? 'REMOTE_FAILED', message: r.data.message ?? 'Kafe bilgisayarına ulaşılamadı.' });
  }
  const answer = r.data as AdminAnswer;
  let ct = answer.ct;
  if (answer.parts && answer.parts > 1 && answer.ref) for (let index = 1; index < answer.parts; index++) {
    const p = await post({ phoneId: a.paired.phoneId, token: a.paired.token, request: { v: 1, op: 'part', sid: head.sid, ref: answer.ref, index } }, signal);
    if (p.status !== 200 || typeof p.data.part !== 'string') return json(p.status === 200 ? 502 : p.status, { code: p.data.code ?? 'REMOTE_FAILED', message: p.data.message ?? 'Dosya indirilemedi. Yeniden deneyin.' });
    ct += p.data.part;
  }
  let reply; try { reply = await openReply(a.session.key, head, { iv: answer.iv, ct }); } catch { return json(502, { code: 'ANSWER_INVALID', message: 'Kafe bilgisayarının cevabı doğrulanamadı.' }); }
  if (request.p === '/api/logout' && reply.s < 400) ended('Çıkış yaptınız.');
  const headers = new Headers();
  for (const [k, v] of Object.entries(reply.h ?? {})) try { headers.set(k, v); } catch { /* not a header value */ }
  const empty = [101, 204, 205, 304].includes(reply.s);
  return new Response(empty || !reply.b ? null : fromB64u(reply.b), { status: reply.s, headers });
}
/** Ends this remote session at the café (Çıkış). */
export async function closeRemote() { if (!active) return; try { await tunnel({ m: 'POST', p: '/api/logout', h: { 'content-type': 'application/json' }, b: '{}' }); } catch { /* ended locally below */ } ended('Çıkış yaptınız.'); }

// ---------- Product photos ----------
const blobs = new Map<string, Promise<string>>();
let observer: MutationObserver | undefined;
function showMedia(img: HTMLImageElement) {
  const src = img.getAttribute('src');
  if (!active || !src || !src.startsWith('/media/')) return;
  if (!blobs.has(src)) blobs.set(src, remoteFetch(src).then(async r => { if (!r.ok) throw new Error('foto'); return URL.createObjectURL(await r.blob()); }).catch(e => { blobs.delete(src); throw e; }));
  void blobs.get(src)!.then(url => { if (img.getAttribute('src') === src) img.setAttribute('src', url); }).catch(() => {});
}
function watchMedia() {
  if (observer) return;
  const scan = (root: ParentNode) => { for (const img of root.querySelectorAll<HTMLImageElement>('img[src^="/media/"]')) showMedia(img); };
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes' && m.target instanceof HTMLImageElement) showMedia(m.target);
      else for (const n of m.addedNodes) if (n instanceof HTMLImageElement) showMedia(n); else if (n instanceof Element) scan(n);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  scan(document);
}

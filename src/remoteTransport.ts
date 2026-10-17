import { adminOpen, deviceSession, openReply, readOpenAnswer, sealCall, type AdminAnswer, type TunnelRequest } from '../packages/domain/remote-admin-crypto';
import { fromB64u, randomB64u } from '../packages/domain/remote-crypto';
import { ownerHome } from './ownerHome';
import type { Paired } from './phoneVault';

/*
 * Sahibin uzaktan yönetimi, the browser's side (server/remote-admin.ts, packages/domain/remote-admin-crypto.ts). On Mola
 * Merkez's /yonet page ("İşletmemi yönet": src/ReportsPhone.tsx, src/RemoteAdmin.tsx) the café's own screens run as usual, but
 * every /api and /media request goes through this tunnel: sealed with the session key (AES-256-GCM, a sequence number per
 * tab, bound to its answer), posted to Mola Merkez, which hands it to the café as ciphertext. The answer comes back sealed and becomes an ordinary Response, so the
 * screens (src/api.ts `transport()`, and the few direct fetch() calls such as downloads) need no change. Large answers (Excel,
 * PDF) come in parts. Product photos (<img src="/media/…">, and the files of their srcset) are fetched through the tunnel and shown from blob: addresses.
 * The session key is a non-extractable CryptoKey kept in this origin's IndexedDB until the session ends (a reload keeps it).
 */
const API = '/api/merkez/v1/phone/admin';
export const REMOTE_ENDED_EVENT = 'mola:remote-ended';
/**
 * The connection to the café computer dropped while the session itself stays (0.1.23: İşletmemi yönet shows the last report
 * meanwhile and "Kasa açıldı · Kafeyi yönet" once it answers again). Once per outage. 0.1.24 (the owner marked a product
 * "Tükendi" with the café just closed and it said "Kaydediliyor…" for ever): no request here waits longer than
 * REMOTE_WAIT_MS, and the drop fails every pending one at once (`cut`). A drop is: Mola Merkez says the café is off
 * (CAFE_OFFLINE), no answer at all (no internet, Merkez unreachable, the wait ran out), the browser going offline, or a
 * café that did not answer in time (CAFE_TIMEOUT, the screen's own wait) when the health check then says it is off (or a
 * second time in a row). The screens (src/RemoteAdmin.tsx) also ask that health every 10 s.
 */
export const REMOTE_OFFLINE_EVENT = 'mola:remote-offline';
/** Merkez itself gives up on the café after 20 s (RELAY.REQUEST_TIMEOUT_MS); its answer normally comes first. */
export const REMOTE_WAIT_MS = 22_000;
export const DROPPED_TEXT = 'Bağlantı koptu. Kasa bilgisayarı kapalı ya da internete bağlı değil. Değişiklik kaydedilemedi.';
let silent = 0, away = false, cut = new AbortController();
function reach(on: boolean, code?: string) {
  if (on) { silent = 0; away = false; return; }
  if (code === 'CAFE_OFFLINE') dropRemote();
  else if (code === 'CAFE_TIMEOUT') { if (++silent >= 2) dropRemote(); else suspect(); }
}
/** The connection is gone: every pending request fails now, the page shows "Bağlantı koptu" and then the last report. */
export function dropRemote() {
  if (!active || away) return;
  away = true; silent = 0;
  const was = cut; cut = new AbortController(); was.abort(new DOMException('Bağlantı koptu.', 'AbortError'));
  window.dispatchEvent(new Event(REMOTE_OFFLINE_EVENT));
}
/** No answer in time: is the café still there? (Off or unreachable: a drop.) */
function suspect() { void remoteHealth().then(h => { if (h === 'off' || h === 'net') dropRemote(); }); }
/** Mola Merkez's word on the café computer: 'on', 'off', 'net' (no answer at all) or 'unknown' (any other answer). */
export async function remoteHealth(): Promise<'on' | 'off' | 'net' | 'unknown'> {
  const a = active; if (!a) return 'unknown';
  try {
    const r = await realFetch('/api/merkez/v1/phone/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneId: a.paired.phoneId, token: a.paired.token }), credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (r.status !== 200) return 'unknown';
    return (await r.json() as { online?: boolean }).online === false ? 'off' : 'on';
  } catch { return 'net'; }
}
/** AbortSignal.any where the browser lacks it (Safari before 17.4). */
function anySignal(list: (AbortSignal | null | undefined)[]) {
  const given = list.filter((s): s is AbortSignal => !!s);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(given);
  const c = new AbortController();
  for (const s of given) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
  return c.signal;
}
/** `ticket`: with NEED_CODE (the password was right: the code next) and with a wrong code (the ticket stays good). */
export class RemoteError extends Error { constructor(message: string, public status: number, public code: string, public ticket?: string) { super(message); } }
export type RemoteSession = { v: 1; sid: string; phoneId: string; key: CryptoKey; business: string; device: string; expiresAt: string; startedAt: string };
type Active = { session: RemoteSession; paired: Paired; tab: string; seq: number };
let active: Active | null = null;
/** The browser's own fetch while the tunnel stands in for it (read at call time otherwise: tests stub it). */
let saved: typeof fetch | undefined;
const realFetch: typeof fetch = (input, init) => (saved ?? globalThis.fetch)(input, init);

/** True while this page runs the café's screens through the tunnel. */
export const remoteMode = () => !!active;
/**
 * Where "back to the start" goes: on Mola Merkez's /yonet never "/" (that is Mola Yönetim there); on İşletmemi yönet's own name
 * (isletme.…, src/ownerHome.ts) its root "/".
 */
export const homePath = () => ownerHome() ?? (active || location.pathname === '/yonet' ? '/yonet' : '/');
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
/** Never longer than REMOTE_WAIT_MS, and never past a drop. */
async function post(body: unknown, signal?: AbortSignal | null) {
  const r = await realFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: anySignal([signal, AbortSignal.timeout(REMOTE_WAIT_MS), cut.signal]) });
  let data: Record<string, any> = {}; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data };
}
/**
 * The owner's proof, sealed for the café by this paired device; then the session key. 0.1.24, two steps like the sign-in:
 * the password alone → RemoteError NEED_CODE with a ticket; then the ticket and the code. Both at once for an older café.
 * `grant` (0.1.23): right after the sign-in on this device, its one-time proof instead (the owner is not asked twice).
 */
export async function openRemote(paired: Paired, proof: { password?: string; code?: string; grant?: string; ticket?: string }) {
  const { request, k1, ephPrivate } = await adminOpen(paired.privateKey, paired.cafePublic, paired.phoneId, { password: proof.password ?? '', code: (proof.code ?? '').replace(/\D/g, ''), ...(proof.grant ? { grant: proof.grant } : {}), ...(proof.ticket ? { ticket: proof.ticket } : {}) });
  let r; try { r = await post({ phoneId: paired.phoneId, token: paired.token, request }); }
  catch { throw new RemoteError('Kafe bilgisayarına ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.', 0, 'NETWORK'); }
  if (r.status !== 200 || typeof r.data.iv !== 'string') throw new RemoteError(r.data.message ?? 'Kafe bilgisayarına ulaşılamadı. Biraz sonra yeniden deneyin.', r.status, r.data.code ?? 'REMOTE_FAILED');
  // Only the café could seal this answer (k1 needs its private key): Mola Merkez cannot fake a session.
  let answer; try { answer = await readOpenAnswer(k1, request.nonce, { iv: r.data.iv, ct: r.data.ct }); } catch { throw new RemoteError('Kafe bilgisayarının cevabı doğrulanamadı.', 502, 'ANSWER_INVALID'); }
  if (!answer.ok) throw new RemoteError(answer.message, 403, answer.code, answer.ticket);
  const session: RemoteSession = { v: 1, sid: answer.sid, phoneId: paired.phoneId, key: await deviceSession(k1, ephPrivate, request.eph, answer.eph, answer.sid), business: answer.business, device: answer.device, expiresAt: answer.expiresAt, startedAt: new Date().toISOString() };
  try { await run('readwrite', s => s.put(session, KEY)); } catch { /* this tab still works */ }
  away = false; silent = 0;
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
  let r;
  try { r = await post({ phoneId: a.paired.phoneId, token: a.paired.token, request: await sealCall(a.session.key, head, request) }, signal); }
  catch (e) {
    // The screen gave up itself: left the page (its own abort) or its own wait ran out (is the café still there?).
    if (signal?.aborted) {
      if ((signal.reason as Error | undefined)?.name !== 'TimeoutError') throw e;
      suspect(); return json(504, { code: 'CAFE_TIMEOUT', message: 'Kasa bilgisayarı yanıt vermedi. Değişiklik kaydedilemedi.' });
    }
    // No answer within REMOTE_WAIT_MS, no internet, or the drop cut it: it fails now, never spins.
    dropRemote();
    return json(503, { code: 'REMOTE_DROPPED', message: DROPPED_TEXT });
  }
  if (r.status !== 200 || typeof r.data.iv !== 'string') {
    if (['REMOTE_ENDED', 'PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(r.data.code)) ended(r.data.message ?? 'Uzak oturum kapandı.');
    else reach(false, r.data.code);
    return json(r.status === 200 ? 502 : r.status, { code: r.data.code ?? 'REMOTE_FAILED', message: r.data.message ?? 'Kafe bilgisayarına ulaşılamadı.' });
  }
  reach(true);
  const answer = r.data as AdminAnswer;
  let ct = answer.ct;
  if (answer.parts && answer.parts > 1 && answer.ref) for (let index = 1; index < answer.parts; index++) {
    const p = await post({ phoneId: a.paired.phoneId, token: a.paired.token, request: { v: 1, op: 'part', sid: head.sid, ref: answer.ref, index } }, signal).catch(() => ({ status: 503, data: { code: 'REMOTE_DROPPED', message: DROPPED_TEXT } as Record<string, any> }));
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
export async function closeRemote() { if (!active) return; try { await tunnel({ m: 'POST', p: '/api/logout', h: { 'content-type': 'application/json' }, b: '{}' }, AbortSignal.timeout(6000)); } catch { /* ended locally below */ } ended('Çıkış yaptınız.'); }
/** The device is locked or forgotten (0.1.24 Çıkış): the session ends at the café when it answers soon, here anyway. */
export async function dropSession() { if (active) await closeRemote(); else await forgetSaved(); }

// ---------- Product photos ----------
const blobs = new Map<string, Promise<string>>();
let observer: MutationObserver | undefined;
const MEDIA = /^\/media\//;
/**
 * The /media file an image shows: its src, or, with a srcset (src/components.tsx ProductArt: the 320 px thumbnail and the
 * 800 px photo), the smallest one wide enough for its place on this screen (the largest when it has no place yet).
 */
function mediaPath(img: HTMLImageElement, src: string | null, set: string | null) {
  const options = (set ?? '').split(',').map(c => c.trim().split(/\s+/)).map(([url, w]) => ({ url, width: Number(/^(\d+)w$/.exec(w ?? '')?.[1] ?? 0) })).filter(c => c.url && MEDIA.test(c.url) && c.width > 0).sort((a, b) => a.width - b.width);
  if (!options.length) return src && MEDIA.test(src) ? src : undefined;
  const needed = img.getBoundingClientRect().width * (window.devicePixelRatio || 1);
  return (needed > 0 ? options.find(c => c.width >= needed) : undefined)?.url ?? options[options.length - 1].url;
}
function showMedia(img: HTMLImageElement) {
  if (!active) return;
  const src = img.getAttribute('src'), set = img.getAttribute('srcset');
  if (!(src && MEDIA.test(src)) && !set?.includes('/media/')) return;
  const path = mediaPath(img, src, set);
  // 16 Ekim (the owner's case: every product picture broken on İşletmemi yönet, first seen in "Menüden kampanya ürünü seç"):
  // a srcset outranks src, so the browser asked this origin for /media/… itself, which is not here (only the café has the
  // photos). Through the tunnel an image shows one file, as a blob: the srcset and its sizes go.
  if (set !== null) { img.removeAttribute('srcset'); img.removeAttribute('sizes'); }
  if (!path) return;
  img.dataset.molaMedia = path;
  if (!blobs.has(path)) blobs.set(path, remoteFetch(path).then(async r => { if (!r.ok) throw new Error('foto'); return URL.createObjectURL(await r.blob()); }).catch(e => { blobs.delete(path); throw e; }));
  void blobs.get(path)!.then(url => { if (img.dataset.molaMedia === path) img.setAttribute('src', url); }).catch(() => {});
}
function watchMedia() {
  if (observer) return;
  const scan = (root: ParentNode) => { for (const img of root.querySelectorAll<HTMLImageElement>('img[src^="/media/"], img[srcset*="/media/"]')) showMedia(img); };
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes' && m.target instanceof HTMLImageElement) showMedia(m.target);
      else for (const n of m.addedNodes) if (n instanceof HTMLImageElement) showMedia(n); else if (n instanceof Element) scan(n);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  scan(document);
}

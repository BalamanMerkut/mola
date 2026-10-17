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
 * PDF) come in parts. Product photos (<img src="/media/…">, and the files of their srcset) are fetched through the tunnel (once each, near the screen, a few at a time) and shown from blob: addresses.
 * The session key is a non-extractable CryptoKey kept in this origin's IndexedDB until the session ends (a reload keeps it).
 */
const API = '/api/merkez/v1/phone/admin';
export const REMOTE_ENDED_EVENT = 'mola:remote-ended';
/**
 * The connection to the café computer dropped while the session itself stays (0.1.23: İşletmemi yönet shows the last report
 * meanwhile and "Kasa açıldı · İşletmeyi yönet" once it answers again). Once per outage. 0.1.24 (the owner marked a product
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
  forgetMedia();
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
/*
 * 17 Ekim (the owner's case: "Menüden kampanya ürünü seç" stuttered on İşletmemi yönet). Measured with 45 photo products
 * (tests/browser/remote-photos.spec.ts): Menü yönetimi alone sent 82 photo requests through the tunnel at once, every
 * thumbnail twice (removing the srcset was itself a change this watcher saw, and with no srcset left it chose the 800 px
 * file, so the 320 px one was fetched and thrown away), all queued at Mola Merkez ahead of the screens' own calls, and the
 * browser asked Mola Merkez itself for 21 /media files meanwhile (the img kept its /media src until the blob came). Now:
 *  - an image shows a blank (the soft photo background) at once, never its /media address: the browser asks nothing here;
 *  - its file is chosen when it comes near the screen (IntersectionObserver: its size is known then, nothing is measured
 *    while the page changes), the smallest wide enough for its place (at most 2× density: a sharper thumbnail is not worth
 *    two and a half times the bytes through the tunnel);
 *  - at most PARALLEL photos travel at a time, so a screen's own call waits behind a few photos, never behind forty; a photo
 *    no image wants any more by its turn (another category, the window closed) is not fetched;
 *  - each file once per session (`cache`: re-renders and other screens reuse it), the last KEEP kept, older ones released.
 */
const MEDIA = /^\/media\//, PARALLEL = 4, KEEP = 200, NEAR = '300px 0px';
/** A transparent pixel: what an image shows until its photo is here (the photo area's own background shows through). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
type Wanted = { options: { url: string; width: number }[] };
const wanted = new WeakMap<HTMLImageElement, Wanted>(), showing = new WeakMap<HTMLImageElement, string>();
/** /media path → its blob: address (the promise while it travels), oldest use first; `ready`: the ones here. */
const cache = new Map<string, Promise<string>>(), ready = new Map<string, string>();
const waiting: { path: string; run: () => Promise<void>; skip: () => void }[] = [];
/** `session`: counts the sessions, so a photo still travelling when one ends is not kept for the next. */
let observer: MutationObserver | undefined, near: IntersectionObserver | undefined, running = 0, session = 0;
/**
 * The /media files an image may show, smallest first: its srcset (src/components.tsx ProductArt: the 320 px thumbnail and the
 * 800 px photo), or its src alone (width 0: the only one).
 */
function mediaOptions(src: string | null, set: string | null) {
  const options = (set ?? '').split(',').map(c => c.trim().split(/\s+/)).map(([url, w]) => ({ url, width: Number(/^(\d+)w$/.exec(w ?? '')?.[1] ?? 0) })).filter(c => c.url && MEDIA.test(c.url) && c.width > 0).sort((a, b) => a.width - b.width);
  return options.length ? options : src && MEDIA.test(src) ? [{ url: src, width: 0 }] : [];
}
/** The smallest file wide enough for `css` pixels on this screen (the largest when it has no place). */
function mediaFor(w: Wanted, css: number) {
  const needed = css * Math.min(window.devicePixelRatio || 1, 2);
  return (needed > 0 ? w.options.find(c => c.width >= needed) : undefined) ?? w.options[w.options.length - 1];
}
/** Called for every <img> added or changed: cheap (no layout read, no fetch), so React's re-renders cost nothing here. */
function showMedia(img: HTMLImageElement) {
  if (!active) return;
  const src = img.getAttribute('src'), set = img.getAttribute('srcset');
  // Our own blank or blob: (or not a photo at all).
  if (!(src && MEDIA.test(src)) && !set?.includes('/media/')) return;
  const w: Wanted = { options: mediaOptions(src, set) };
  if (!w.options.length) return;
  wanted.set(img, w); showing.delete(img); delete img.dataset.molaMedia;
  // 16 Ekim: a srcset outranks src, and this origin has no /media (only the café has the photos). One file, as a blob:.
  if (set !== null) { img.removeAttribute('srcset'); img.removeAttribute('sizes'); }
  // Already here in some size (the same photo on another screen, or before a re-render): at once; the right size when placed.
  const have = [...w.options].reverse().find(c => ready.has(c.url));
  if (have) { touch(have.url); showing.set(img, have.url); img.setAttribute('src', ready.get(have.url)!); }
  else img.setAttribute('src', BLANK);
  near!.observe(img);
}
/** Images near the screen: their file now, at the size they are shown. */
function placed(entries: IntersectionObserverEntry[]) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const img = e.target as HTMLImageElement, w = wanted.get(img);
    near!.unobserve(img);
    if (!active || !w || !img.isConnected) continue;
    const pick = mediaFor(w, e.boundingClientRect.width), had = showing.get(img);
    // What it shows is wide enough already (a larger copy from another screen).
    if (had && (w.options.find(c => c.url === had)?.width ?? 0) >= pick.width) continue;
    img.dataset.molaMedia = pick.url;
    void media(pick.url).then(url => { if (wanted.get(img) === w && img.dataset.molaMedia === pick.url) { showing.set(img, pick.url); img.setAttribute('src', url); } }).catch(() => {});
  }
}
function touch(path: string) { const p = cache.get(path); if (p) { cache.delete(path); cache.set(path, p); } }
/** One /media file through the tunnel, once: its blob: address. */
function media(path: string): Promise<string> {
  const had = cache.get(path);
  if (had) { touch(path); return had; }
  const mine = session;
  const p = new Promise<string>((done, fail) => {
    waiting.push({
      path,
      run: () => (active ? remoteFetch(path) : Promise.reject(new Error('foto'))).then(async r => { if (!r.ok) throw new Error('foto'); const blob = await r.blob(); if (mine !== session) throw new Error('foto'); const url = URL.createObjectURL(blob); ready.set(path, url); return url; }).then(done, fail),
      skip: () => fail(new Error('foto')),
    });
  });
  // Failed or skipped: asked again the next time an image wants it.
  p.catch(() => { if (cache.get(path) === p) cache.delete(path); });
  cache.set(path, p);
  trim(); pump();
  return p;
}
/** The next photos while fewer than PARALLEL travel; one no image waits for any more is skipped. */
function pump() {
  while (running < PARALLEL && waiting.length) {
    const next = waiting.shift()!;
    if (!document.querySelector(`img[data-mola-media="${CSS.escape(next.path)}"]`)) { next.skip(); continue; }
    running++;
    void next.run().finally(() => { running--; pump(); });
  }
}
/** Only the last KEEP files: an older one that no image on the page shows is released. */
function trim() {
  for (const [path] of cache) {
    if (cache.size <= KEEP) return;
    const url = ready.get(path);
    if (!url || document.querySelector(`img[src="${CSS.escape(url)}"]`)) continue;
    cache.delete(path); ready.delete(path); URL.revokeObjectURL(url);
  }
}
/** The session ended: its photos go (the next session fetches its own). */
function forgetMedia() {
  for (const w of waiting.splice(0)) w.skip();
  for (const url of ready.values()) URL.revokeObjectURL(url);
  cache.clear(); ready.clear(); session++;
}
function watchMedia() {
  if (observer) return;
  // rootMargin for the page, scrollMargin for a scrolling window inside it (the picker's dialog; where the browser has it).
  near = new IntersectionObserver(placed, { rootMargin: NEAR, scrollMargin: NEAR } as IntersectionObserverInit);
  const scan = (root: ParentNode) => { for (const img of root.querySelectorAll<HTMLImageElement>('img[src^="/media/"], img[srcset*="/media/"]')) showMedia(img); };
  // Only what changed: the images added (and those inside what was added) and an image's own src/srcset, in the microtask of
  // the change, before the browser would ask this origin for /media itself.
  observer = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { if (m.target instanceof HTMLImageElement) showMedia(m.target); }
      else for (const n of m.addedNodes) if (n instanceof HTMLImageElement) showMedia(n); else if (n instanceof Element && n.firstElementChild) scan(n);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset'] });
  scan(document);
}

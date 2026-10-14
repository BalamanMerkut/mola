/*
 * Uzaktan raporlar: end-to-end encryption between the café computer and the owner's paired phone. WebCrypto only
 * (globalThis.crypto.subtle), so the café server (Node 24) and the phone page (src/ReportsPhone.tsx) run the very same code.
 * Mola Merkez only passes these objects along: it never holds a private key, the pairing secret or a plaintext report.
 *
 * Keys: every paired phone has an X25519 pair made on the phone (private key non-extractable, kept in IndexedDB); every
 * business has a static X25519 pair on the café computer (sealed in merchant.sqlite). Since 0.1.22 a device signs in on the
 * Raporlarım page (e-mail, the owner's password and phone code): the café's public key comes from Mola Merkez for that
 * e-mail (the café sends it with its heartbeat), the device's public key goes to the café inside the sealed sign-in, which
 * only the café opens and checks (`loginRequest` below). Before 0.1.22 a QR made at the café carried both.
 *
 * Report box ("kutu"): a fresh ephemeral X25519 pair per message; key = HKDF-SHA256(DH(eph, phone) ‖ DH(café, phone)) so only
 * the café (static key) can make a box the phone accepts and only the phone can open it; AES-256-GCM with the box's own
 * header as associated data (kind, phone, time, request nonce). A live answer carries the phone's request nonce (`ref`), so an
 * old answer cannot be replayed for a new question; snapshots carry their time and the phone never goes back to an older one.
 * Phone → café live questions: HMAC-SHA256 under a key from DH(phone, café), with time and a one-time nonce (replays refused).
 */
const te = new TextEncoder(), td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
/** A copy on a plain ArrayBuffer (what WebCrypto's types want everywhere). */
export const bytes = (data: ArrayBuffer | ArrayLike<number>) => { const out = new Uint8Array(data instanceof ArrayBuffer ? data.byteLength : data.length); out.set(data instanceof ArrayBuffer ? new Uint8Array(data) : data); return out; };
export const utf8 = (text: string) => bytes(te.encode(text));
export function toB64u(data: ArrayBuffer | Uint8Array) {
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  let text = ''; for (let i = 0; i < view.length; i++) text += String.fromCharCode(view[i]);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(text: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Geçersiz kodlama.');
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4));
  const out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
export const randomB64u = (n: number) => toB64u(globalThis.crypto.getRandomValues(new Uint8Array(n)));
/** A raw X25519 public key: 32 bytes, base64url (43 characters). */
export const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const X25519 = { name: 'X25519' } as const;
export const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

/** The phone's pair: the private key cannot be exported (it stays in this browser's IndexedDB). */
export async function newPhoneKeys(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const pair = await subtle().generateKey(X25519, false, ['deriveBits']) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: toB64u(await subtle().exportKey('raw', pair.publicKey)) };
}
/** A business's static pair on the café computer: the private key as PKCS#8 (kept sealed in the café's database). */
export async function newCafeKeys(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await subtle().generateKey(X25519, true, ['deriveBits']) as CryptoKeyPair;
  return { privateKey: toB64u(await subtle().exportKey('pkcs8', pair.privateKey)), publicKey: toB64u(await subtle().exportKey('raw', pair.publicKey)) };
}
export const cafePrivateKey = (pkcs8: string) => subtle().importKey('pkcs8', bytes(fromB64u(pkcs8)), X25519, false, ['deriveBits']);
async function publicKey(raw: string) {
  if (!PUBLIC_KEY.test(raw)) throw new Error('Geçersiz anahtar.');
  return subtle().importKey('raw', bytes(fromB64u(raw)), X25519, false, []);
}
export async function dh(privateKey: CryptoKey, peer: string) { return new Uint8Array(await subtle().deriveBits({ name: 'X25519', public: await publicKey(peer) }, privateKey, 256)); }
export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string) {
  const base = await subtle().importKey('raw', bytes(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bytes(salt), info: utf8(info) }, base, 256));
}
const aes = (raw: Uint8Array, use: 'encrypt' | 'decrypt') => subtle().importKey('raw', bytes(raw), 'AES-GCM', false, [use]);
const hmacKey = (raw: Uint8Array, use: 'sign' | 'verify') => subtle().importKey('raw', bytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);
export async function hmac(raw: Uint8Array, text: string) { return toB64u(await subtle().sign('HMAC', await hmacKey(raw, 'sign'), utf8(text))); }
/** Constant-time check (WebCrypto's verify). */
export async function hmacMatches(raw: Uint8Array, text: string, mac: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(mac)) return false;
  return subtle().verify('HMAC', await hmacKey(raw, 'verify'), bytes(fromB64u(mac)), utf8(text));
}
const SALT = utf8('mola-rapor-v1');

// ---------- Report boxes ----------
export type BoxKind = 'live' | 'snapshot';
export type ReportBox = { v: 1; kind: BoxKind; phone: string; at: string; ref?: string; eph: string; iv: string; ct: string };
const boxInfo = (b: Pick<ReportBox, 'kind' | 'phone' | 'at' | 'ref' | 'eph'>) => `kutu|${b.kind}|${b.phone}|${b.at}|${b.ref ?? ''}|${b.eph}`;
/** The café encrypts one payload for one phone (fresh ephemeral key per box). */
export async function sealReport(cafePrivate: CryptoKey, phonePublic: string, head: { kind: BoxKind; phone: string; at: string; ref?: string }, payload: unknown): Promise<ReportBox> {
  const eph = await subtle().generateKey(X25519, false, ['deriveBits']) as CryptoKeyPair, ephPublic = toB64u(await subtle().exportKey('raw', eph.publicKey));
  const meta = { kind: head.kind, phone: head.phone, at: head.at, ...(head.ref ? { ref: head.ref } : {}), eph: ephPublic }, info = boxInfo(meta);
  const key = await hkdf(concat(await dh(eph.privateKey, phonePublic), await dh(cafePrivate, phonePublic)), SALT, info);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(info) }, await aes(key, 'encrypt'), utf8(JSON.stringify(payload)));
  return { v: 1, ...meta, iv: toB64u(iv), ct: toB64u(ct) };
}
/** The phone opens a box made by its café for it. Throws on anything else (another phone, another café, an edited box). */
export async function openReport<T>(phonePrivate: CryptoKey, cafePublic: string, box: ReportBox, expect: { phone: string; ref?: string; kind?: BoxKind }): Promise<T> {
  if (box?.v !== 1 || box.phone !== expect.phone || (expect.kind && box.kind !== expect.kind) || (expect.ref !== undefined && box.ref !== expect.ref) || !PUBLIC_KEY.test(box.eph)) throw new Error('Rapor bu telefon için değil.');
  const info = boxInfo(box), key = await hkdf(concat(await dh(phonePrivate, box.eph), await dh(phonePrivate, cafePublic)), SALT, info);
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes(fromB64u(box.iv)), additionalData: utf8(info) }, await aes(key, 'decrypt'), bytes(fromB64u(box.ct)));
  return JSON.parse(td.decode(plain)) as T;
}

// ---------- Live questions (phone → café) ----------
/** `op: 'forget'` ("Çıkış", 0.1.22): the device asks the café to drop it; signed the same way, never taken for a question. */
export type LiveRequest = { phone: string; at: number; nonce: string; mac: string; op?: 'forget' };
const requestKey = async (priv: CryptoKey, peer: string, phone: string) => hkdf(await dh(priv, peer), SALT, `istek|${phone}`);
const liveText = (r: Pick<LiveRequest, 'phone' | 'at' | 'nonce' | 'op'>) => `${r.op === 'forget' ? 'cikis' : 'istek'}|${r.phone}|${r.at}|${r.nonce}`;
export async function signLive(phonePrivate: CryptoKey, cafePublic: string, phone: string, at = Date.now(), op?: 'forget'): Promise<LiveRequest> {
  const r = { phone, at, nonce: randomB64u(16), ...(op ? { op } : {}) };
  return { ...r, mac: await hmac(await requestKey(phonePrivate, cafePublic, phone), liveText(r)) };
}
export async function liveSigned(cafePrivate: CryptoKey, phonePublic: string, r: LiveRequest) {
  if (!r || typeof r.phone !== 'string' || !Number.isSafeInteger(r.at) || !/^[A-Za-z0-9_-]{22}$/.test(r.nonce ?? '') || (r.op !== undefined && r.op !== 'forget')) return false;
  return hmacMatches(await requestKey(cafePrivate, phonePublic, r.phone), liveText(r), r.mac);
}

// ---------- Giriş (0.1.22): a new device signs in on the Raporlarım page ----------
/** What the device is, as its own browser tells (the phone must come first). */
export type DeviceKind = 'phone' | 'tablet' | 'computer';
export const DEVICE_KINDS: readonly DeviceKind[] = ['phone', 'tablet', 'computer'];
/** From the user agent: iPad (also when it asks for the desktop site with a Mac user agent and a touch screen) and an Android without "Mobile" are tablets. */
export function deviceKindOf(ua: string, touchPoints = 0): DeviceKind {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'tablet';
  if (/iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua))) return 'phone';
  return /Android/.test(ua) ? 'tablet' : 'computer';
}
/** The name the sign-in suggests for this device ("Bu cihazın adı"); the owner may change it. */
export function deviceNameOf(ua: string, touchPoints = 0) {
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android telefon' : 'Tablet';
  return /Macintosh/.test(ua) ? 'Mac' : 'Laptop';
}
/*
 * The device makes its own key pair P (non-extractable) and a fresh ephemeral pair E. k = HKDF(DH(E, C) ‖ DH(P, C)) where C
 * is the business's static key, handed out by Mola Merkez for the typed e-mail (trust on first use: a Merkez that lied about
 * C could read what follows; docs/GELISTIRICI_REHBERI.md). Only the holder of C opens the request, and it learns that the
 * sender holds P. Inside, AES-256-GCM under k: the owner's password and phone code (or, after "En fazla 3 cihaz", the café's
 * one-time ticket and the device to replace), the device's name and kind. The café answers under the same k: only it could
 * make k, so Mola Merkez cannot fake "giriş tamam".
 */
export type LoginInner = { password?: string; code?: string; ticket?: string; replace?: string; name: string; kind: DeviceKind };
export type LoginRequest = { v: 1; phonePub: string; at: number; nonce: string; eph: string; iv: string; ct: string };
/** A paired device as the sign-in lists it when the limit is reached ("Hangisinin yerine?"). */
export type LoginDevice = { id: string; name: string; kind: DeviceKind | null; lastSeenAt: string | null };
export type LoginAnswer = { ok: true; phoneId: string; business: string; name: string } | { ok: false; code: string; message: string; devices?: LoginDevice[]; ticket?: string };
const LOGIN_SALT = utf8('mola-giris-v1');
const loginInfo = (r: Pick<LoginRequest, 'phonePub' | 'at' | 'nonce' | 'eph'>) => `giris|${r.phonePub}|${r.at}|${r.nonce}|${r.eph}`;
/** The device: its sealed request and the key that opens the café's answer. */
export async function loginRequest(phonePrivate: CryptoKey, phonePublic: string, cafePublic: string, inner: LoginInner, at = Date.now()) {
  const pair = await subtle().generateKey(X25519, false, ['deriveBits']) as CryptoKeyPair, eph = toB64u(await subtle().exportKey('raw', pair.publicKey));
  const head = { v: 1 as const, phonePub: phonePublic, at, nonce: randomB64u(16), eph }, info = loginInfo(head);
  const key = await hkdf(concat(await dh(pair.privateKey, cafePublic), await dh(phonePrivate, cafePublic)), LOGIN_SALT, info), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = toB64u(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(info) }, await aes(key, 'encrypt'), utf8(JSON.stringify(inner))));
  return { request: { ...head, iv: toB64u(iv), ct } as LoginRequest, key };
}
/** The café: the device's words and the answer key, or null when it was not sealed for this business (or was edited). */
export async function readLogin(cafePrivate: CryptoKey, r: LoginRequest): Promise<{ inner: LoginInner; key: Uint8Array } | null> {
  try {
    if (!PUBLIC_KEY.test(r.phonePub) || !PUBLIC_KEY.test(r.eph)) return null;
    const info = loginInfo(r), key = await hkdf(concat(await dh(cafePrivate, r.eph), await dh(cafePrivate, r.phonePub)), LOGIN_SALT, info);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes(fromB64u(r.iv)), additionalData: utf8(info) }, await aes(key, 'decrypt'), bytes(fromB64u(r.ct)));
    const x = JSON.parse(td.decode(plain)) as LoginInner, text = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= 200);
    return typeof x?.name === 'string' && x.name.length <= 200 && DEVICE_KINDS.includes(x.kind) && text(x.password) && text(x.code) && text(x.ticket) && text(x.replace) ? { inner: x, key } : null;
  } catch { return null; }
}
const answerInfo = (nonce: string) => `giris-cevap|${nonce}`;
export async function sealLoginAnswer(key: Uint8Array, nonce: string, answer: LoginAnswer) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return { iv: toB64u(iv), ct: toB64u(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(answerInfo(nonce)) }, await aes(key, 'encrypt'), utf8(JSON.stringify(answer)))) };
}
export async function openLoginAnswer(key: Uint8Array, nonce: string, box: { iv: string; ct: string }) {
  return JSON.parse(td.decode(await subtle().decrypt({ name: 'AES-GCM', iv: bytes(fromB64u(box.iv)), additionalData: utf8(answerInfo(nonce)) }, await aes(key, 'decrypt'), bytes(fromB64u(box.ct))))) as LoginAnswer;
}

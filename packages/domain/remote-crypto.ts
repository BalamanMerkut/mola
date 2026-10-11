/*
 * Uzaktan raporlar: end-to-end encryption between the café computer and the owner's paired phone. WebCrypto only
 * (globalThis.crypto.subtle), so the café server (Node 24) and the phone page (src/ReportsPhone.tsx) run the very same code.
 * Mola Merkez only passes these objects along: it never holds a private key, the pairing secret or a plaintext report.
 *
 * Keys: every paired phone has an X25519 pair made on the phone (private key non-extractable, kept in IndexedDB); every
 * business has a static X25519 pair on the café computer (sealed in merchant.sqlite). The café's public key reaches the phone
 * in the pairing QR (never through Merkez), the phone's public key reaches the café inside the pairing request, authenticated
 * by the one-time pairing secret that is also only in the QR (the URL fragment never goes to a server).
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
export type LiveRequest = { phone: string; at: number; nonce: string; mac: string };
const requestKey = async (priv: CryptoKey, peer: string, phone: string) => hkdf(await dh(priv, peer), SALT, `istek|${phone}`);
const liveText = (r: Pick<LiveRequest, 'phone' | 'at' | 'nonce'>) => `istek|${r.phone}|${r.at}|${r.nonce}`;
export async function signLive(phonePrivate: CryptoKey, cafePublic: string, phone: string, at = Date.now()): Promise<LiveRequest> {
  const r = { phone, at, nonce: randomB64u(16) };
  return { ...r, mac: await hmac(await requestKey(phonePrivate, cafePublic, phone), liveText(r)) };
}
export async function liveSigned(cafePrivate: CryptoKey, phonePublic: string, r: LiveRequest) {
  if (!r || typeof r.phone !== 'string' || !Number.isSafeInteger(r.at) || !/^[A-Za-z0-9_-]{22}$/.test(r.nonce ?? '')) return false;
  return hmacMatches(await requestKey(cafePrivate, phonePublic, r.phone), liveText(r), r.mac);
}

// ---------- Pairing ----------
/** What the QR carries after "#e=": pairing id, one-time secret, the business's public key, and "1" when a report code is asked. */
export type PairingLink = { pairId: string; secret: string; cafePublic: string; code: boolean };
export const pairingFragment = (p: PairingLink) => `e=${p.pairId}.${p.secret}.${p.cafePublic}.${p.code ? 1 : 0}`;
export function readPairingFragment(hash: string): PairingLink | null {
  const m = /^#?e=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})\.([01])$/.exec(hash.trim());
  return m ? { pairId: m[1], secret: m[2], cafePublic: m[3], code: m[4] === '1' } : null;
}
export type PairRequest = { pairId: string; phonePub: string; iv: string; ct: string; mac: string };
/** The phone's own words for the café: its name and, when the café asks, the 6-digit report code. Encrypted to the café. */
export type PairInner = { name: string; code?: string };
const pairInfo = (pairId: string, phonePub: string) => `eslestir|${pairId}|${phonePub}`;
export async function pairRequest(phonePrivate: CryptoKey, phonePublic: string, link: PairingLink, inner: PairInner): Promise<PairRequest> {
  const secret = fromB64u(link.secret), info = pairInfo(link.pairId, phonePublic);
  const key = await hkdf(await dh(phonePrivate, link.cafePublic), secret, info), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = toB64u(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(info) }, await aes(key, 'encrypt'), utf8(JSON.stringify(inner))));
  return { pairId: link.pairId, phonePub: phonePublic, iv: toB64u(iv), ct, mac: await hmac(secret, `${info}|${toB64u(iv)}|${ct}`) };
}
/** The café checks the pairing secret's MAC and opens the phone's words; null when anything does not fit. */
export async function openPairRequest(cafePrivate: CryptoKey, secret: string, r: PairRequest): Promise<PairInner | null> {
  try {
    if (!PUBLIC_KEY.test(r.phonePub)) return null;
    const raw = fromB64u(secret), info = pairInfo(r.pairId, r.phonePub);
    if (!await hmacMatches(raw, `${info}|${r.iv}|${r.ct}`, r.mac)) return null;
    const key = await hkdf(await dh(cafePrivate, r.phonePub), raw, info);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: bytes(fromB64u(r.iv)), additionalData: utf8(info) }, await aes(key, 'decrypt'), bytes(fromB64u(r.ct)));
    const inner = JSON.parse(td.decode(plain)) as PairInner;
    return typeof inner?.name === 'string' && (inner.code === undefined || typeof inner.code === 'string') ? inner : null;
  } catch { return null; }
}
/** "Eşleşti", from the café: only the pairing secret's holder can say it, so Mola Merkez cannot fake a pairing. */
export const pairConfirm = (secret: string, pairId: string, phonePub: string, phoneId: string) => hmac(fromB64u(secret), `tamam|${pairId}|${phonePub}|${phoneId}`);
export const pairConfirmed = (secret: string, pairId: string, phonePub: string, phoneId: string, mac: string) => hmacMatches(fromB64u(secret), `tamam|${pairId}|${phonePub}|${phoneId}`, mac);

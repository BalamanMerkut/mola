import { bytes, concat, dh, fromB64u, hkdf, PUBLIC_KEY, randomB64u, toB64u, utf8 } from './remote-crypto.js';

/*
 * Sahibin uzaktan yönetimi ("Kafeyi yönet"): the owner's paired device (Raporlarım, src/phoneVault.ts) runs the café's own
 * screens through Mola Merkez, end to end encrypted. WebCrypto only, so the café server and the browser share this file.
 * Mola Merkez passes these objects along and can open none of them: it never holds the café's or the device's private key.
 *
 *   Giriş (open)  The device makes a fresh ephemeral X25519 pair E_d. k1 = HKDF(DH(E_d, C) ‖ DH(P, C)) where C is the business's
 *                 static key (from the pairing QR) and P the device's own non-extractable key: only this device and the café can
 *                 make k1, so the café knows the request comes from the paired device. The owner's password and 6-digit code go
 *                 inside, AES-256-GCM under k1; time and a one-time nonce stop replays (the café keeps the nonces).
 *   Cevap         The café answers under k1 (only it could make k1, so the device knows it talks to its café): an error, or
 *                 the session id and the café's own fresh ephemeral key E_c.
 *   Oturum        K = HKDF(DH(E_c, E_d) ‖ k1): forward secret (the ephemeral keys are forgotten), known to the two ends only.
 *   İstek/yanıt   Every /api call and its answer: AES-256-GCM under K with a fresh IV, bound by associated data to the session,
 *                 the browser tab, its sequence number and time (request) and to that same request (answer). The café refuses
 *                 a sequence number it has seen (replay) or one far behind; the device accepts only the answer to its question.
 */
const td = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const SALT = utf8('mola-yonet-v1');
const X25519 = { name: 'X25519' } as const;
const gcm = (raw: Uint8Array, uses: KeyUsage[]) => subtle().importKey('raw', bytes(raw), 'AES-GCM', false, uses);
async function seal(key: CryptoKey, aad: string, plain: Uint8Array) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return { iv: toB64u(iv), ct: toB64u(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, bytes(plain))) };
}
async function unseal(key: CryptoKey, aad: string, box: { iv: string; ct: string }) {
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes(fromB64u(box.iv)), additionalData: utf8(aad) }, key, bytes(fromB64u(box.ct))));
}

// ---------- Giriş ----------
export type AdminOpenRequest = { v: 1; op: 'open'; phone: string; at: number; nonce: string; eph: string; iv: string; ct: string };
export type AdminCredentials = { password: string; code: string };
/** What the café answers to an open request (inside the box). */
export type AdminOpenAnswer = { ok: false; code: string; message: string } | { ok: true; sid: string; eph: string; business: string; expiresAt: string; device: string };
const openInfo = (r: Pick<AdminOpenRequest, 'phone' | 'at' | 'nonce' | 'eph'>) => `yonet-giris|${r.phone}|${r.at}|${r.nonce}|${r.eph}`;
const answerInfo = (nonce: string) => `yonet-cevap|${nonce}`;
/** The device: its sealed open request, and what it keeps to read the answer (k1 and its ephemeral private key). */
export async function adminOpen(phonePrivate: CryptoKey, cafePublic: string, phone: string, credentials: AdminCredentials, at = Date.now()) {
  const pair = await subtle().generateKey(X25519, false, ['deriveBits']) as CryptoKeyPair, eph = toB64u(await subtle().exportKey('raw', pair.publicKey));
  const head = { v: 1 as const, op: 'open' as const, phone, at, nonce: randomB64u(16), eph };
  const k1 = await hkdf(concat(await dh(pair.privateKey, cafePublic), await dh(phonePrivate, cafePublic)), SALT, openInfo(head));
  const box = await seal(await gcm(k1, ['encrypt']), openInfo(head), utf8(JSON.stringify(credentials)));
  return { request: { ...head, ...box } as AdminOpenRequest, k1, ephPrivate: pair.privateKey };
}
/** The café: the credentials and k1, or null when the request was not made by this paired device (or was edited). */
export async function readAdminOpen(cafePrivate: CryptoKey, phonePublic: string, r: AdminOpenRequest): Promise<{ credentials: AdminCredentials; k1: Uint8Array } | null> {
  try {
    if (!PUBLIC_KEY.test(r.eph) || !PUBLIC_KEY.test(phonePublic)) return null;
    const k1 = await hkdf(concat(await dh(cafePrivate, r.eph), await dh(cafePrivate, phonePublic)), SALT, openInfo(r));
    const c = JSON.parse(td.decode(await unseal(await gcm(k1, ['decrypt']), openInfo(r), r))) as AdminCredentials;
    return typeof c?.password === 'string' && typeof c.code === 'string' ? { credentials: c, k1 } : null;
  } catch { return null; }
}
export async function sealOpenAnswer(k1: Uint8Array, nonce: string, answer: AdminOpenAnswer) { return seal(await gcm(k1, ['encrypt']), answerInfo(nonce), utf8(JSON.stringify(answer))); }
export async function readOpenAnswer(k1: Uint8Array, nonce: string, box: { iv: string; ct: string }) { return JSON.parse(td.decode(await unseal(await gcm(k1, ['decrypt']), answerInfo(nonce), box))) as AdminOpenAnswer; }

// ---------- Oturum anahtarı ----------
const sessionInfo = (sid: string, deviceEph: string, cafeEph: string) => `yonet-oturum|${sid}|${deviceEph}|${cafeEph}`;
const sessionKey = async (shared: Uint8Array, k1: Uint8Array, info: string) => gcm(await hkdf(concat(shared, k1), SALT, info), ['encrypt', 'decrypt']);
/** The café's half: its fresh ephemeral key (sent to the device) and the session key K (never leaves this process). */
export async function cafeSession(k1: Uint8Array, deviceEph: string, sid: string) {
  const pair = await subtle().generateKey(X25519, false, ['deriveBits']) as CryptoKeyPair, eph = toB64u(await subtle().exportKey('raw', pair.publicKey));
  return { eph, key: await sessionKey(await dh(pair.privateKey, deviceEph), k1, sessionInfo(sid, deviceEph, eph)) };
}
/** The device's half: the same K (a non-extractable AES key; it may be kept in IndexedDB, never read out). */
export async function deviceSession(k1: Uint8Array, ephPrivate: CryptoKey, deviceEph: string, cafeEph: string, sid: string) {
  if (!PUBLIC_KEY.test(cafeEph)) throw new Error('Geçersiz anahtar.');
  return sessionKey(await dh(ephPrivate, cafeEph), k1, sessionInfo(sid, deviceEph, cafeEph));
}

// ---------- İstekler ve yanıtlar ----------
/** One /api request through the tunnel: method, path (with query), the few headers the café reads, the body text. */
export type TunnelRequest = { m: 'GET' | 'POST'; p: string; h: Record<string, string>; b?: string };
/** Its answer: status, the headers the screens read, the body as base64url bytes. */
export type TunnelResponse = { s: number; h: Record<string, string>; b?: string };
export type AdminCall = { v: 1; op: 'call'; sid: string; tab: string; seq: number; at: number; iv: string; ct: string };
const callInfo = (c: Pick<AdminCall, 'sid' | 'tab' | 'seq' | 'at'>) => `yonet-istek|${c.sid}|${c.tab}|${c.seq}|${c.at}`;
const replyInfo = (c: Pick<AdminCall, 'sid' | 'tab' | 'seq'>) => `yonet-yanit|${c.sid}|${c.tab}|${c.seq}`;
export async function sealCall(key: CryptoKey, head: Omit<AdminCall, 'v' | 'op' | 'iv' | 'ct'>, request: TunnelRequest): Promise<AdminCall> {
  return { v: 1, op: 'call', ...head, ...await seal(key, callInfo(head), utf8(JSON.stringify(request))) };
}
export async function openCall(key: CryptoKey, call: AdminCall): Promise<TunnelRequest | null> {
  try { return JSON.parse(td.decode(await unseal(key, callInfo(call), call))) as TunnelRequest; } catch { return null; }
}
/** The café's sealed answer to one call (ct may then travel in parts: AdminAnswer.parts). */
export async function sealReply(key: CryptoKey, call: Pick<AdminCall, 'sid' | 'tab' | 'seq'>, response: TunnelResponse) { return seal(key, replyInfo(call), utf8(JSON.stringify(response))); }
export async function openReply(key: CryptoKey, call: Pick<AdminCall, 'sid' | 'tab' | 'seq'>, box: { iv: string; ct: string }) { return JSON.parse(td.decode(await unseal(key, replyInfo(call), box))) as TunnelResponse; }
/** What the café sends back for a call: the whole box, or its first part and how to fetch the rest (`ref`, `parts`). */
export type AdminAnswer = { iv: string; ct: string; parts?: number; ref?: string };
/** Answers above this many base64 characters travel in parts (each well within the köprü's reply limit). */
export const PART_CHARS = 4 * 1024 * 1024;

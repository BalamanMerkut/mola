import { bytes, fromB64u, toB64u, utf8 } from './remote-crypto.js';

/*
 * İşletmemi yönet "Çıkış" (0.1.24): the device locks itself and keeps its keys; the e-mail and the password open it again.
 * With the café computer on, the café checks them (the usual sign-in, with the code step). With it off (the owner's case:
 * Çıkış at night, the café closed, locked out), the device checks them itself against this verifier, made at the last
 * successful sign-in: PBKDF2-SHA256 (WebCrypto, browser and tests alike), a random salt, never the password itself.
 * It guards the screen, not the keys: whoever holds the unlocked browser profile holds the keys and the last report anyway
 * (that is why the code step is skipped offline: the device already proved itself at its sign-in). Wrong tries slow down:
 * 5 free, then 1 minute, 2, 4 … (at most an hour), kept with the device record so a reload does not reset them.
 */
export const VERIFIER_ITERATIONS = 310_000;
export type LocalVerifier = { v: 1; salt: string; iterations: number; hash: string };
export type LocalTries = { count: number; waitUntil: number };
/** E-mail as compared here and kept on the device (Mola Merkez folds case the same way). */
export const plainEmail = (email: string) => email.trim().toLowerCase();

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await globalThis.crypto.subtle.importKey('raw', bytes(utf8(password.normalize('NFC'))), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations }, key, 256));
}
export async function makeVerifier(password: string, iterations = VERIFIER_ITERATIONS): Promise<LocalVerifier> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, salt: toB64u(salt), iterations, hash: toB64u(await derive(password, salt, iterations)) };
}
/** True when `password` made this verifier; a verifier weaker than ours (an edited record) never matches. */
export async function checkVerifier(v: LocalVerifier | undefined, password: string) {
  if (!v || v.v !== 1 || !(v.iterations >= VERIFIER_ITERATIONS) || typeof v.salt !== 'string' || typeof v.hash !== 'string') return false;
  const got = await derive(password, fromB64u(v.salt), v.iterations), want = fromB64u(v.hash);
  let diff = got.length ^ want.length; for (let i = 0; i < got.length; i++) diff |= got[i] ^ (want[i] ?? 0);
  return diff === 0;
}
/** Milliseconds still to wait before the next try (0: go ahead). */
export const localWait = (tries: LocalTries | undefined, now = Date.now()) => tries && tries.waitUntil > now ? tries.waitUntil - now : 0;
/** One more wrong try: from the 5th on, 1 minute, then doubling (at most 60 minutes). */
export function localFailed(tries: LocalTries | undefined, now = Date.now()): LocalTries {
  const count = (tries?.count ?? 0) + 1;
  return { count, waitUntil: count >= 5 ? now + Math.min(60, 2 ** (count - 5)) * 60_000 : 0 };
}
/** "1 dakika", "8 dakika" for the wait message. */
export const waitText = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.ceil(ms / 1000))} saniye` : `${Math.ceil(ms / 60_000)} dakika`;

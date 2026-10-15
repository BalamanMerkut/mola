import type { LocalTries, LocalVerifier } from '../packages/domain/local-verifier';
import type { PhoneReport } from '../packages/domain/remote-report';

/*
 * The phone's own safe for "Raporlarım" (IndexedDB, this browser only): its X25519 private key as a non-extractable
 * CryptoKey (it can be used here, never read out or sent), the token Mola Merkez knows it by, the café's public key from the
 * pairing QR, and the last report it opened (so the page shows "Son durum" with no internet at all). Never sent anywhere.
 */
export type Paired = {
  v: 1; phoneId: string; token: string; cafePublic: string; business: string; pairedAt: string;
  privateKey: CryptoKey; publicKey: string;
  /** The newest report this phone opened (live or from the postbox) and how it came. */
  last?: { report: PhoneReport; kind: 'live' | 'snapshot' };
  /**
   * 0.1.24 "Çıkış" locks the device instead of forgetting it: `locked`, and the e-mail (shown on "Kafeyi yönet") with the
   * verifier from the last sign-in the café confirmed open it again while the café is off (packages/domain/local-verifier.ts).
   */
  email?: string; verifier?: LocalVerifier; locked?: boolean; tries?: LocalTries;
};
const DB = 'mola-raporlarim', STORE = 'kasa', KEY = 'telefon';
function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error ?? new Error('Telefon kasası açılamadı.'));
  });
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((done, fail) => {
      const tx = db.transaction(STORE, mode), r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => done(r.result); tx.onerror = () => fail(tx.error ?? new Error('Telefon kasası yazılamadı.')); tx.onabort = () => fail(tx.error ?? new Error('Telefon kasası yazılamadı.'));
    });
  } finally { db.close(); }
}
/*
 * This browser's own random id (0.1.23), sent inside the sealed sign-in: the café replaces the entry of the same id when the
 * owner signs in again (Safari dropped the keys but kept one of the two). Kept in localStorage and in IndexedDB; a browser
 * that forgot both is simply a new device (the limit screen "Hangisinin yerine?" handles it). Never a secret.
 */
const ID_KEY = 'mola-cihaz-id', ID_FORM = /^[A-Za-z0-9_-]{22}$/;
export async function deviceId() {
  let id: string | undefined;
  try { const v = localStorage.getItem(ID_KEY); if (v && ID_FORM.test(v)) id = v; } catch { /* storage blocked */ }
  if (!id) try { const v = await run<unknown>('readonly', s => s.get('cihaz')); if (typeof v === 'string' && ID_FORM.test(v)) id = v; } catch { /* none */ }
  id ??= btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { localStorage.setItem(ID_KEY, id); } catch { /* the other copy */ }
  try { await run('readwrite', s => s.put(id, 'cihaz')); } catch { /* the other copy */ }
  return id;
}
export const readPaired = () => run<Paired | undefined>('readonly', s => s.get(KEY) as IDBRequest<Paired | undefined>);
export const savePaired = (p: Paired) => run('readwrite', s => s.put(p, KEY));
export const forgetPaired = () => run('readwrite', s => s.delete(KEY));

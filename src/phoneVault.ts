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
export const readPaired = () => run<Paired | undefined>('readonly', s => s.get(KEY) as IDBRequest<Paired | undefined>);
export const savePaired = (p: Paired) => run('readwrite', s => s.put(p, KEY));
export const forgetPaired = () => run('readwrite', s => s.delete(KEY));

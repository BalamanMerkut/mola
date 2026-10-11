/*
 * The owner's agreement window after signing in (src/LicenseAgreement.tsx OwnerAgreementPrompt): what this tab remembers.
 *   "Daha sonra" / ×   closed for this sign-in: a refresh of the page, the screen mounting again (the window's rail appearing,
 *                      İki ekran) and the polls never bring it back; the next sign-in asks again (forgetAgreementLater, called
 *                      by the sign-in screen).
 *   Accepted           closed for good in this tab even before the server's answer is read again; the server keeps it.
 * Kept in sessionStorage (this window only, gone when Mola is closed) with an in-memory copy for when storage is refused.
 */
const KEY = 'mola-agreement';
type Kept = { later?: string[]; accepted?: string[] };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
let memory: Kept = {};
const mark = (username: string, version: number) => `${username}:${version}`;
const store = (): Storage | undefined => { try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; } };
function read(s: Storage | undefined = store()): Kept {
  try { const v = JSON.parse(s?.getItem(KEY) ?? 'null') as Kept | null; if (v && typeof v === 'object') return { later: Array.isArray(v.later) ? v.later.filter(x => typeof x === 'string') : [], accepted: Array.isArray(v.accepted) ? v.accepted.filter(x => typeof x === 'string') : [] }; } catch { /* the memory copy */ }
  return memory;
}
function write(next: Kept, s: Storage | undefined = store()) {
  memory = next;
  try { s?.setItem(KEY, JSON.stringify(next)); } catch { /* remembered for this page only */ }
}
const add = (list: string[] | undefined, item: string) => [...new Set([...(list ?? []), item])].slice(-20);

/** Whether the window should open: the server says a (new) text waits, and this sign-in neither postponed nor accepted it. */
export function shouldAsk(state: { needed: boolean; version: number } | null, username: string, s?: Storage) {
  if (!state?.needed) return false;
  const kept = read(s), m = mark(username, state.version);
  return !kept.later?.includes(m) && !kept.accepted?.includes(m);
}
/** "Daha sonra" or ×: not again during this sign-in. */
export function postponeAgreement(username: string, version: number, s?: Storage) { const kept = read(s); write({ ...kept, later: add(kept.later, mark(username, version)) }, s); }
/** "Okudum, kabul ediyorum" saved. */
export function rememberAccepted(username: string, version: number, s?: Storage) { const kept = read(s); write({ ...kept, accepted: add(kept.accepted, mark(username, version)) }, s); }
/** A new sign-in: "Daha sonra" ends with the sign-in it was said in (an acceptance stays). */
export function forgetAgreementLater(s?: Storage) { const kept = read(s); write({ ...kept, later: [] }, s); }
/** Tests only: the in-memory copy back to empty. */
export function resetAgreementMemory() { memory = {}; }

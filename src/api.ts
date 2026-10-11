import { SESSION_LOCK_EVENT, userActive } from './activity';
// Sahibin uzaktan yönetimi: on Mola Merkez's /yonet page every call goes through the sealed tunnel (src/remoteTransport.ts).
import { transport } from './remoteTransport';
// The guest menu over the internet runs under Mola Merkez's /q/<kod>/ prefix (src/basePath.ts); everywhere else this is '/'.
import { withBase } from './basePath';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public trackingId?: string) { super(message); }
}
/**
 * `wait`: how long to wait for the answer; only slow, read-only counts (years of payments) ask for more than 12 s.
 * A call made right after a tap or key says so (`X-Mola-Activity`): the owner's idle lock counts only those (src/activity.ts).
 */
export async function api<T>(path: string, body?: unknown, guest?: string, wait = 12000): Promise<T> {
  const response = await transport()(withBase(path), { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(wait), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(guest ? { 'X-Guest-Session': guest } : {}), ...(userActive() ? { 'X-Mola-Activity': '1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return parse<T>(response);
}
/** The owner's session is locked (server/owner-lock.ts): every answer says so, polling ones too. */
function sessionLock(response: Response) { if (response.headers.get('X-Mola-Locked') === '1') window.dispatchEvent(new Event(SESSION_LOCK_EVENT)); }
/**
 * Screen polling: sends the tag of the snapshot on screen; the server answers 204 when nothing changed, so tablets
 * polling every few seconds skip downloading, parsing and re-rendering an identical snapshot. null = unchanged.
 */
export async function poll<T>(path: string, tag: string, guest?: string): Promise<{ data: T; tag: string } | null> {
  const response = await transport()(withBase(path), { credentials: 'same-origin', signal: AbortSignal.timeout(12000), headers: { ...(tag ? { 'X-Mola-Tag': tag } : {}), ...(guest ? { 'X-Guest-Session': guest } : {}) } });
  sessionLock(response);
  if (response.status === 204) return null;
  return { data: await parse<T>(response), tag: response.headers.get('X-Mola-Tag') ?? '' };
}
async function parse<T>(response: Response): Promise<T> {
  sessionLock(response);
  // 423: the data key is locked on the café computer; the page switches to the locked screen (src/Locked.tsx). Not the
  // owner's own idle lock (SESSION_LOCKED), which only covers this screen with the password (src/OwnerLock.tsx).
  let result: any;
  try { result = await response.json(); }
  catch (e) { if (response.status === 423) window.dispatchEvent(new Event('mola:locked')); throw e; }
  if (response.status === 423 && result?.code !== 'SESSION_LOCKED') window.dispatchEvent(new Event('mola:locked'));
  if (!response.ok) {
    // Vardiya takibi: the shift ended (closing, 05:00) or never started; the workspace shows "Vardiyayı başlat" (src/Shifts.tsx).
    if (result.code === 'SHIFT_REQUIRED') window.dispatchEvent(new Event('mola:shift'));
    const trackingId = response.status >= 500 && typeof result.requestId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(result.requestId) ? result.requestId : undefined;
    const message = result.message ?? 'İşlem tamamlanamadı.';
    throw new ApiError(trackingId ? `${message} Takip kodu: ${trackingId}` : message, response.status, result.code, trackingId);
  }
  return result as T;
}
export function requestId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }
export function money(amount: number) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: amount % 100 === 0 ? 0 : 2 }).format(amount / 100); }
/**
 * Money as people type it in Türkiye, to kuruş: "1250", "1.250", "25.000", "1.250,50", "1250,5", "1250.50" and "₺1.250" /
 * "1250 TL". A dot followed by exactly three digits separates thousands; one dot with one or two digits after it is the
 * kuruş. Anything else ("1,250.50", "12,505", "1.25.0") is NaN rather than a guess; moneyError says why.
 */
const MONEY_FORMS = [/^(\d{1,9})$/, /^(\d{1,3}(?:\.\d{3})+)$/, /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/, /^(\d+),(\d{1,2})$/, /^(\d+)\.(\d{1,2})$/];
const MAX_LIRA = 9_999_999;
const cleanMoney = (value: string) => value.trim().replace(/\s+/g, '').replace(/^₺|₺$|tl$/gi, '');
export function parseMoney(value: string) {
  const text = cleanMoney(value);
  for (const form of MONEY_FORMS) {
    const m = form.exec(text);
    if (!m) continue;
    const lira = Number(m[1].replace(/\./g, ''));
    return lira <= MAX_LIRA ? lira * 100 + Number((m[2] ?? '').padEnd(2, '0')) : NaN;
  }
  return NaN;
}
/**
 * The inline message under a money field ('' when it is fine): empty, not a Turkish amount, too small or too large.
 * `min`/`max` in kuruş; `required: false` lets an empty field pass.
 */
export function moneyError(value: string, { required = true, min = 1, max = 100_000_000 }: { required?: boolean; min?: number; max?: number } = {}) {
  const text = cleanMoney(value);
  if (!text) return required ? 'Tutarı yazın.' : '';
  const v = parseMoney(value);
  if (!Number.isFinite(v)) {
    if (/^\d[\d.]*,\d{3,}$/.test(text) || /^\d+\.\d{4,}$/.test(text)) return 'Kuruş en fazla iki hane olabilir: örn. 12,50.';
    if (/,.*\./.test(text)) return 'Binlik için nokta, kuruş için virgül kullanın: örn. 1.250,50.';
    if (/^\d+(\.\d+)+$/.test(text) || /^\d{4,}\.\d{3}$/.test(text)) return 'Binlik noktası üç hanede bir olur: örn. 1.250 ya da 25.000.';
    if (/[^\d.,]/.test(text)) return 'Yalnız rakam yazın: örn. 1.250 ya da 1.250,50.';
    return 'Tutar anlaşılamadı: örn. 1.250 ya da 1.250,50 yazın.';
  }
  if (v < min) return min <= 1 ? 'Sıfırdan büyük bir tutar yazın.' : `En az ${money(min)} yazın.`;
  if (v > max) return `En fazla ${money(max)} yazılabilir.`;
  return '';
}
/** Kuruş back to what a person would type ("1.250", "1.250,50"); parseMoney reads it again. */
export function moneyInput(kurus: number) {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: kurus % 100 ? 2 : 0, maximumFractionDigits: 2, useGrouping: true }).format(kurus / 100);
}

/**
 * A slip that did not print, in the counter's words. The server's tracking id stays out of sight (it is in the server's
 * failure log and here in the browser console) because the cashier can do nothing with it; a missing printer keeps its
 * own message (where to add one).
 */
export function printProblem(e: unknown) {
  if (e instanceof ApiError && e.trackingId) console.warn(`Yazdırma hatası, takip kodu: ${e.trackingId}`);
  if (e instanceof ApiError && e.status < 500 && e.code !== 'PRINTER_UNREACHABLE') return e.message;
  return 'Yazıcıya ulaşılamadı. Kağıdı ve kabloyu kontrol edin.';
}

export function parseAdjustment(value: string) {
  const text = value.trim();
  return text.startsWith('-') ? -parseMoney(text.slice(1)) : parseMoney(text.startsWith('+') ? text.slice(1) : text);
}

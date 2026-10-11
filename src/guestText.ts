import { ApiError } from './api';
// The server answers guests in Turkish; on the English menu the common answers are said in English instead.
const english: Record<string, string> = {
  BUSINESS_OFFLINE: 'We are not accepting orders right now. Please ask our staff.',
  MENU_UNAVAILABLE: 'The menu is not available right now. Please ask our staff.',
  ORDER_CONTEXT_CHANGED: 'Your table was changed. Please ask our staff before ordering again.',
  PRICE_CHANGED: 'Prices have changed. Please check your basket and send it again.',
  ITEM_UNAVAILABLE: 'A product in your basket has just sold out. Remove it and send again.',
  // QR siparişleri kapalı (8 Ekim) and the café unreachable (Mola Merkez's menu copy): packages/domain/qr-ordering.ts.
  ORDERING_CLOSED: 'We are not taking orders right now. Please ask your waiter.',
  CAFE_OFFLINE: 'Orders cannot be placed right now. Please ask your waiter.',
  CALL_UNAVAILABLE: 'Staff screens are not connected right now. Please call out to our staff.',
  CAMPAIGN_LIMIT: 'This offer has just run out. Please check your basket.',
  OPTION_REQUIRED: 'Please choose the required options.', INVALID_OPTIONS: 'Please check the options you chose.',
  INVALID_CART: 'Please check your basket.', INVALID_VALUE: 'Please check the amounts in your basket.',
  INVALID_NOTE: 'Please shorten your note.', INVALID_WEIGHT: 'Please choose a weight between 50 g and 20 kg.',
  ACCOUNT_CLOSED: 'Your bill has been closed. Scan the QR code again to order.',
  TABLE_CLEANING: 'This table is being prepared. Please wait a moment.',
  TABLE_REMOVED: 'This table is no longer in use. Please scan the QR code on your table.',
  INVALID_QR: 'This QR code was not found. Please scan the code on your table.',
  DEMO_RENEWED: 'This demo has been renewed. Please scan the new QR code on the table.',
  BROWSER_BLOCKED: 'Ordering from this phone is not possible. Please ask our staff.',
  NO_ACCOUNT: 'There is no open bill at this table yet.',
  RATE_LIMIT: 'Too many tries. Please wait a moment.',
  UNAUTHORIZED: 'Please scan the QR code on your table again.',
  EDIT_CLOSED: 'The time to change this order has ended.', CANCEL_CLOSED: 'This order can no longer be cancelled here. Please ask our staff.',
  CANCEL_DECLINED: 'Your cancellation request was declined. Please ask our staff.',
};
// Server words meant for staff forms ("Alanları kontrol edin") read as jargon on a guest's phone.
const turkish: Record<string, string> = {
  VALIDATION_ERROR: 'İstek okunamadı. Lütfen tekrar deneyin ya da personelden yardım isteyin.',
};
export function guestMessage(e: unknown, en: boolean) {
  const text = e instanceof Error ? e.message : String(e);
  if (!en) return (e instanceof ApiError && turkish[e.code]) || text;
  return (e instanceof ApiError && english[e.code]) || 'Something went wrong. Please ask our staff.';
}
/** An old, renewed or mistyped QR link: trying the same link again never helps, the current code on the table does. */
export const qrLinkProblem = (e: unknown) => e instanceof ApiError && ['INVALID_QR', 'VALIDATION_ERROR', 'TABLE_REMOVED', 'UNAUTHORIZED'].includes(e.code);
/** A demo QR renewed by a "Tanıtımı sıfırla" before 5 Oct 2026 (resets keep the table QRs now): "Bu tanıtım yenilendi". */
export const demoRenewed = (e: unknown) => e instanceof ApiError && e.code === 'DEMO_RENEWED';
export const qrLinkText =(en: boolean) => en ? 'This QR code may have been renewed. Scan the current code on your table or ask our staff.' : 'Bu QR kodu yenilenmiş olabilir. Masanızdaki güncel kodu okutun ya da personelden yardım isteyin.';
/**
 * K-H (9 Ekim kullanıcı testi): the menu's first language follows the phone. Turkish when the phone's first preferred
 * language is Turkish ("tr", "tr-TR"), English otherwise; an unknown language stays Turkish. A guest's own EN/TR choice
 * (`saved`, "mola-language") always wins.
 */
export function startsInEnglish(saved: string | null, languages: readonly string[]) {
  if (saved === 'en' || saved === 'tr') return saved === 'en';
  const first = languages.find(l => !!l);
  return !!first && !first.toLowerCase().startsWith('tr');
}
/** "Masa 08" on the English menu reads "Table 08"; names the owner chose ("Bahçe 3") stay as they are. */
export const guestTableName = (name: string, en: boolean) => en ? name.replace(/^Masa(?=\s|$)/, 'Table') : name;

/*
 * Mutfak fişi modu (Ayarlar → Sipariş ve kasa → "Mutfak nasıl çalışıyor?" → Fiş): the kitchen works from paper, not from a
 * screen. When a kitchen ticket cannot be printed, the order keeps a `printProblems` entry per printer until someone prints
 * it again or says it went to the kitchen by hand (tek mutfak: there is no other printer to send it to). These are the plain causes staff read.
 * 11 Ekim (hafta sonu bulgusu 1, kâğıt bitmişken uyarı yoktu): the printer's own state is asked too (ESC/POS real-time
 * status on network printers, the Windows spooler for USB ones), so "Yazıcıda kâğıt yok" and "Yazıcının kapağı açık" are
 * said by name; in Ekran modu the kitchen card shows the same warning.
 * Browser-safe on purpose (no engine.ts): the banner (src/KitchenTickets.tsx) imports this file directly.
 */
export type KitchenMode = 'screen' | 'ticket';
export const PRINT_CAUSES = ['paper', 'cover', 'error', 'offline', 'network', 'windows', 'unknown', 'no_printer'] as const;
export type PrintCause = typeof PRINT_CAUSES[number];
/** `printerId` is 'none' when no printer holds "Mutfak fişleri" (none chosen, or it was switched off). `printer`: its name then. */
export type PrintProblem = { printerId: string; cause: PrintCause; at: string; printer?: string };
export const NO_PRINTER = 'none';
export const printCauseText: Record<PrintCause, string> = {
  paper: 'Yazıcıda kâğıt yok',
  cover: 'Yazıcının kapağı açık',
  error: 'Yazıcı hata veriyor (kâğıt sıkışmış olabilir)',
  offline: 'Yazıcı kapalı ya da kablosu çıkmış',
  network: 'Yazıcıya ağdan ulaşılamıyor',
  windows: 'Windows yazıcısı hata verdi',
  unknown: 'Yazıcı yanıt vermedi',
  no_printer: 'Mutfak fişleri için yazıcı seçilmemiş',
};
export const causeText = (cause: string) => printCauseText[cause as PrintCause] ?? printCauseText.unknown;
/** What to do before "Tekrar bas", in one short sentence. */
export const printCauseAdvice: Record<PrintCause, string> = {
  paper: 'Yeni rulo takın, sonra “Tekrar bas”a basın.',
  cover: 'Yazıcının kapağını kapatın, sonra “Tekrar bas”a basın.',
  error: 'Kâğıdı ve kapağı kontrol edin, yazıcıyı kapatıp açın, sonra “Tekrar bas”a basın.',
  offline: 'Yazıcıyı açın, kablosunu kontrol edin, sonra “Tekrar bas”a basın.',
  network: 'Yazıcının açık ve aynı ağda olduğunu kontrol edin, sonra “Tekrar bas”a basın.',
  windows: 'Yazıcının Windows’ta kurulu ve açık olduğunu kontrol edin, sonra “Tekrar bas”a basın.',
  unknown: 'Yazıcıyı kapatıp açın, sonra “Tekrar bas”a basın.',
  no_printer: 'İşletme sahibi Ayarlar → Cihazlar → Yazıcılar’dan bir yazıcıyı “Mutfak fişleri” için seçmeli.',
};
export const causeAdvice = (cause: string) => printCauseAdvice[cause as PrintCause] ?? printCauseAdvice.unknown;
/** "Yazıcıda kâğıt yok · Mutfak": the cause and, when known, which printer. */
export const problemText = (cause: string, printer?: string) => printer ? `${causeText(cause)} · ${printer}` : causeText(cause);

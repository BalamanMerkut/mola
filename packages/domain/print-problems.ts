/*
 * Mutfak fişi modu (Ayarlar → Sipariş ve kasa → "Mutfak nasıl çalışıyor?" → Fiş): the kitchen works from paper, not from a
 * screen. When a kitchen ticket cannot be printed, the order keeps a `printProblems` entry per printer until someone prints
 * it again or says it went to the kitchen by hand (tek mutfak: there is no other printer to send it to). These are the plain causes staff read.
 * Browser-safe on purpose (no engine.ts): the banner (src/KitchenTickets.tsx) imports this file directly.
 */
export type KitchenMode = 'screen' | 'ticket';
export const PRINT_CAUSES = ['paper', 'offline', 'network', 'windows', 'unknown', 'no_printer'] as const;
export type PrintCause = typeof PRINT_CAUSES[number];
/** `printerId` is 'none' when no printer holds "Mutfak fişleri" (none chosen, or it was switched off). */
export type PrintProblem = { printerId: string; cause: PrintCause; at: string };
export const NO_PRINTER = 'none';
export const printCauseText: Record<PrintCause, string> = {
  paper: 'Kâğıt bitti',
  offline: 'Yazıcı kapalı ya da kablosu çıkmış',
  network: 'Yazıcıya ağdan ulaşılamıyor',
  windows: 'Windows yazıcısı hata verdi',
  unknown: 'Yazıcı yanıt vermedi',
  no_printer: 'Mutfak fişleri için yazıcı seçilmemiş',
};
export const causeText = (cause: string) => printCauseText[cause as PrintCause] ?? printCauseText.unknown;

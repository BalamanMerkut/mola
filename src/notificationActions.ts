import type { GoTo } from './navigate';

/** A notification of the owner's bell (GET /api/staff/notifications). */
export type NotificationItem = { id: string; kind: 'reminder' | 'license' | 'backup' | 'merkez' | 'stock' | 'cash' | 'expense' | 'report' | 'demo' | 'campaign' | 'printer'; title: string; text: string; at: string; day?: string; read: boolean; /** 'campaign': the ended campaign (src/CampaignEnded.tsx). */ campaign?: { id: string; reportId: string; reason: 'time' | 'quota'; endedAt: string; uses?: number } };
/** The count on the bell: "3", and "9+" above nine (10 Ekim). */
export const bellCount = (unread: number) => unread > 9 ? '9+' : String(unread);
/**
 * The toasts that stay until closed (10 Ekim, src/NotificationToasts.tsx): a cashier's refund request, a cash difference or
 * shortfall (closing, shift handover, opening, the expected cash below zero), licence and backup problems. Every other one
 * hides after a few seconds; all stay in Bildirimler.
 */
export function importantNotification(n: Pick<NotificationItem, 'kind' | 'title'>) {
  // A printer out of paper stays until closed too (11 Ekim); "kâğıt azaldı" is only a note.
  if (n.kind === 'license' || n.kind === 'backup' || (n.kind === 'printer' && !/azaldı/.test(n.title))) return true;
  if (n.kind !== 'cash') return false;
  const title = n.title.toLocaleLowerCase('tr-TR');
  return /^iade isteği:/.test(title) || /eksi|açı[kğ]/.test(title) || (/fark/.test(title) && !/fark yok/.test(title));
}
/**
 * Each notification opens the home of its topic (10 Ekim düzeni): an İade isteği → Kasa ve giderler → İadeler, a closing
 * difference → Kapanışlar, an expense → Giderler, low stock → Stok → Malzemeler, a Mola support session → Destek → Uzaktan
 * erişim, the owner's own remote login or a paired device → Ayarlar → Uzaktan erişim.
 * Titles are matched in Turkish lower case: JavaScript's /i does not fold "İ" to "i", so "İade yapıldı: ₺190 · Masa 03"
 * (the owner's refund, K-A) offered "Kapanışları aç" (10 Ekim son kullanıcı testi).
 */
export function notificationActionOf(n: Pick<NotificationItem, 'kind' | 'title' | 'campaign'>): [string, GoTo] | null {
  const title = n.title.toLocaleLowerCase('tr-TR');
  if (n.kind === 'campaign') return ['Raporu aç', { view: 'reports', tab: 'campaigns', ...(n.campaign ? { campaign: n.campaign.reportId } : {}) }];
  if (n.kind === 'stock') return ['Stoğa git', { view: 'stock', tab: 'items' }];
  if (n.kind === 'expense' || /gider/.test(title)) return ['Giderleri aç', { view: 'cash', tab: 'expenses', part: 'records' }];
  if (n.kind === 'cash' && /^iade isteği:/.test(title)) return ['İadeyi yap', { view: 'cash', tab: 'refunds' }];
  if (n.kind === 'cash' && /iade/.test(title)) return ['İadeleri aç', { view: 'cash', tab: 'refunds' }];
  if (n.kind === 'cash') return ['Kapanışları aç', { view: 'cash', tab: 'closings' }];
  if (n.kind === 'merkez' && /mola (ekibi|destek)/.test(title)) return ['Uzaktan erişim', { view: 'support', tab: 'remote' }];
  if (n.kind === 'merkez' && /uzaktan yönetim|cihaz eşleştirildi/.test(title)) return ['Uzaktan erişim', { view: 'settings', topic: 'remote' }];
  if (n.kind === 'report') return ['Raporları aç', { view: 'reports', tab: 'summary' }];
  if (n.kind === 'license') return ['Paket ve lisans', { view: 'settings', topic: 'business', part: 'package' }];
  if (n.kind === 'backup') return ['Yedek', { view: 'settings', topic: 'security', part: 'backup' }];
  if (n.kind === 'printer') return ['Yazıcılar', { view: 'settings', topic: 'devices', part: 'printers' }];
  return null;
}

import type { Role } from './types.js';

/*
 * Roles and the "Müdür" (manager) permission table. Browser-safe (types only): the screens, the server and the docs read
 * the same lists. Every rule is enforced on the server too (requireRole lists in engine.ts, approvals.ts, server/*.ts);
 * these lists are what Çalışanlar shows when a Müdür account is made and what tests/manager-role.test.ts checks.
 */
export const roleNames: Record<Role, string> = { owner: 'İşletme sahibi', manager: 'Müdür', cashier: 'Kasiyer', waiter: 'Garson', kitchen: 'Mutfak', support: 'Mola destek' };
/** Roles the owner can give in Çalışanlar (never "İşletme sahibi"). */
export const employeeRoles = ['manager', 'cashier', 'waiter', 'kitchen'] as const satisfies readonly Role[];
export type EmployeeRole = typeof employeeRoles[number];
/** The owner or the Müdür: runs the day (menu, stock, campaigns, reports, refunds) on top of the cashier's and waiter's work. */
export const isManagement = (role: string | undefined): role is 'owner' | 'manager' => role === 'owner' || role === 'manager';

/** Müdür: what the account can do (short, plain Turkish; shown in Çalışanlar and in docs/GELISTIRICI_REHBERI.md). */
export const MANAGER_CAN = [
  'Sipariş alır, masasız sipariş açar, masa taşır ve birleştirir, siparişi nedeniyle iptal eder',
  'QR siparişlerini onaylar ya da reddeder, otomatik onayı açıp kapatır, müşterinin iptal isteğini karşılar',
  'Ödeme alır, hesap fişi yazdırır, masayı “Temizlendi” yapar',
  'Kasa: açılış, para bozdurma, gider kaydı, vardiya devri ve gün sonu',
  'İade ve düzeltme (tutar sınırı yok), kalan kapora için “İade et / İşletmede kalsın”',
  'Rezervasyon ve etkinlik yazar, Ajanda\'yı kullanır',
  'Satış ve Raporlar\'ın hepsini görür (Kârlılık, Personel dahil; Kasa kapanışları\'nda kim, ne zaman, ne saydı — beklenen nakit ve fark yalnız sahipte)',
  'Stok\'un tamamı: malzeme, reçete, alış, sayım ve fire',
  'Kampanyaları ve Menü yönetimini (ürün, fiyat, fotoğraf, kategori) yönetir',
  'Mola ekibinin duyurularını okur (Duyurular; “Okudum” onayı ve Mola ekibine yazmak sahibindir)',
] as const;
/** Müdür: what stays with the owner. The server answers 403 to every one of these. */
export const MANAGER_CANNOT = [
  'Ayarlar (hiçbir konu)',
  'Çalışanlar: hesap açma ya da kapatma, şifre, yetki, açık oturumlar, vardiya planı ve vardiya saatini düzeltme',
  'Sahibin kasa hareketleri (“Sahip aldı”, “Bankaya yatırıldı”, “Diğer çıkış”, “Kasaya para kondu”) ve kapanışa düzeltme',
  'Gider düzeltme ya da silme, otomatik giderler',
  'Rapor güvenlik kodunu kurma, kapatma, sıfırlama (kod açıksa raporlar için sahibin kodunu girer)',
  'Lisans, Destek ve Bildirimler, yedek, güvenlik, kurtarma kodu, güncelleme',
  'Entegrasyon bağlantı bilgileri, masa ekleme/çıkarma, QR yenileme',
] as const;

/**
 * "Mola destek" (`support`): the Mola team inside the café's own screens, only while the owner keeps "Uzaktan destek izni" on
 * (Destek → Uzaktan erişim). Never a staff account. Enforced on the café server (server/support-session.ts: an allow-list of
 * routes, everything else 403) and shown to the owner in Destek with these two lists.
 */
export const isSupport = (role: string | undefined): role is 'support' => role === 'support';
export const SUPPORT_CAN = [
  'Menü, kategoriler, ürünler, fotoğraflar ve kampanyalar',
  'Masalar ve QR kodları (masa ekleme/çıkarma, QR yenileme)',
  'Yazıcılar, sesler ve cihaz bağlantısı',
  'Para ve güvenlik dışındaki ayarlar (işletme görünümü, sipariş ve onay)',
  'Bağlantı ve hata durumu (tanılama)',
] as const;
export const SUPPORT_CANNOT = [
  'Satış ve Raporlar, ödemeler, tahsilat ve iade kayıtları',
  'Kasa günü ve kapanışlar, giderler, stok maliyeti ve kârlılık',
  'Çalışan şifreleri ve oturumları, rapor güvenlik kodu',
  'Yedek, kurtarma kodu, entegrasyon anahtarları',
  'Misafir telefonları, açık hesaplar ve siparişler',
] as const;

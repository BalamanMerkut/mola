/*
 * The short line under each page's title in the café workspace (src/Workspace.tsx). A role sees a line about what it can
 * open there: the cashier's Kasa is Bugün only, and the Müdür's homes have no owner-only tab (Kasa ayarları, Çalışanlar,
 * Personel ayarları, KDV oranları). 10 Ekim son kullanıcı testi: the Müdür's Kasa ve giderler promised "kasa ayarları".
 */
const subtitles: Record<string, string> = {
  tables: 'Masaları takip edin, siparişleri ve hesapları kolayca yönetin.', kitchen: 'Yeni siparişten servise, bütün hazırlık akışı burada.',
  menu: 'Ürünleriniz, fiyatlarınız, kampanyalarınız ve KDV oranlarınız.', staff: 'Masayı ya da masasız siparişi seçin, ürünleri ekleyin ve mutfağa gönderin.',
  ready: 'Mutfakta hazırlanan siparişleri masaya götürün.', reports: 'Tahsilatlarınızı ve siparişlerinizi tek yerden takip edin.',
  settings: 'Bir kez kurulan ayarlar: işletme, masalar ve QR, sipariş ve mutfak, cihazlar, güvenlik ve yedek.',
  users: 'Çalışan hesapları, vardiya kayıtları, bahşiş payları ve personel ayarları.', integrations: 'Paket servis platformlarıyla bağlantı denemeleri.',
  support: 'Mola ekibine buradan yazın, duyuruları okuyun, uzaktan desteğe izin verin.', notifications: 'Kasa farkları, iade istekleri, azalan stok, giderler, raporlar ve hatırlatmalar.', announcements: 'Mola ekibinden gelen duyurular: yeni özellikler, bakım saatleri, önemli bilgiler.', agenda: 'Rezervasyonlar, etkinlikler, notlar ve hatırlatıcılar tek yerde.', password: 'Şifrenizi değiştirin veya çıkış yapın.',
  stock: 'Malzemeleriniz, reçeteleriniz ve menünüzden kaç ürün daha çıkacağı.',
  cash: 'Kasanın bugünü, giderler, kapanışlar, iadeler ve kasa ayarları tek yerde.',
};
/** The cashier's Kasa is Bugün only: the old line. */
const cashierCashLine = 'Kasa açılışı, para bozdurma, gider, vardiya kodu ve gün sonu.';
const managerLines: Record<string, string> = {
  cash: 'Kasanın bugünü, giderler, kapanışlar ve iadeler tek yerde.', users: 'Vardiya kayıtları ve bahşiş payları.', menu: 'Ürünleriniz, fiyatlarınız ve kampanyalarınız.',
};
export const pageLine = (view: string, role: string) => view === 'cash' && role === 'cashier' ? cashierCashLine : (role === 'manager' && managerLines[view]) || subtitles[view] || '';

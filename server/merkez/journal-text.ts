/*
 * İşlem kayıtları: the words. Plain module (no Node imports): the server writes these texts into the chain, and the Mola
 * Yönetim screens (src/PlatformJournal.tsx, src/PlatformBusiness.tsx) show the same words for older lines.
 * Every action code has one plain Turkish sentence and a group ("İşlem türü" filter). A code missing here is shown as is.
 */
export type JournalSource = 'bu-bilgisayar' | 'yerel-ag' | 'uzak' | 'sistem';
export type JournalResult = 'basarili' | 'basarisiz' | 'reddedildi';
export type JournalActorKind = 'admin' | 'system' | 'cafe' | 'token';
export type JournalGroup = 'giris' | 'lisans' | 'satis' | 'isletme' | 'destek' | 'guncelleme' | 'yedek' | 'ayar' | 'kafe' | 'kayit';

export const GROUP_NAMES: Record<JournalGroup, string> = {
  giris: 'Giriş ve hesap güvenliği', lisans: 'Lisans ve hizmet', satis: 'Paketler, fiyatlar ve satışlar', isletme: 'İşletme kayıtları ve başvurular', destek: 'Destek ve uzaktan erişim',
  guncelleme: 'Güncellemeler', yedek: 'Yedek ve veri anahtarı', ayar: 'Ayarlar', kafe: 'İşletmenin bilgisayarından', kayit: 'İşlem kayıtları',
};
export const SOURCE_NAMES: Record<JournalSource, string> = { 'bu-bilgisayar': 'Bu bilgisayar', 'yerel-ag': 'Yerel ağ', uzak: 'Uzak (internet)', sistem: 'Sistem (zamanlanmış)' };
export const RESULT_NAMES: Record<JournalResult, string> = { basarili: 'Başarılı', basarisiz: 'Başarısız', reddedildi: 'Reddedildi' };
export const ACTOR_NAMES: Record<JournalActorKind, string> = { admin: 'Yönetici', system: 'Mola Merkez', cafe: 'İşletmenin bilgisayarı', token: 'Geliştirici erişimi' };

const A: Record<string, [string, JournalGroup]> = {
  // Giriş ve hesap güvenliği
  'admin.login': ['Yönetici girişi yapıldı', 'giris'],
  'admin.login_failed': ['Yönetici girişi başarısız', 'giris'],
  'admin.login_refused': ['Yönetici girişi geçici olarak durduruldu (çok fazla yanlış deneme)', 'giris'],
  'admin.logout': ['Yönetici çıkış yaptı', 'giris'],
  'admin.password_changed': ['Yönetici şifresi değiştirildi', 'giris'],
  'admin.password_change_failed': ['Yönetici şifresi değiştirilemedi (mevcut şifre yanlış)', 'giris'],
  'admin.check_failed': ['Güvenlik doğrulaması başarısız (şifre ya da kod yanlış)', 'giris'],
  'admin.mfa_enabled': ['İki adımlı giriş açıldı', 'giris'],
  'admin.mfa_disabled': ['İki adımlı giriş kapatıldı', 'giris'],
  'admin.mfa_recovery_used': ['Kurtarma koduyla giriş yapıldı', 'giris'],
  'admin.password_reset': ['Yönetici şifresi “Şifremi unuttum” ile yenilendi', 'giris'],
  'admin.reset_failed': ['“Şifremi unuttum” denemesi başarısız (kod yanlış)', 'giris'],
  'admin.mfa_reset': ['İki adımlı giriş şifre sıfırlamada kapatıldı', 'giris'],
  'admin.password_reset_offline': ['Yönetici şifresi Sifre-Sifirla komutuyla geçici şifreye çevrildi', 'giris'],
  'admin.reset_code_sent': ['Şifre sıfırlama kodu e-postayla gönderildi', 'giris'],
  'admin.reset_code_failed': ['Şifre sıfırlama kodu e-postayla gönderilemedi', 'giris'],
  // Kullanıcılar (13 Ekim): the owner's yetkililer
  'admin.user_added': ['Yetkili kullanıcı eklendi', 'giris'],
  'admin.user_removed': ['Yetkili kullanıcı silindi', 'giris'],
  'admin.user_password_set': ['Yetkili kullanıcıya yeni ilk şifre verildi', 'giris'],
  'token.created': ['Geliştirici erişim anahtarı oluşturuldu', 'giris'],
  'token.revoked': ['Geliştirici erişim anahtarı iptal edildi', 'giris'],
  'token.refused': ['Geçersiz ya da iptal edilmiş geliştirici anahtarıyla istek reddedildi', 'giris'],
  // Lisans ve hizmet
  'business.created': ['İşletme oluşturuldu', 'lisans'],
  'code.created': ['Yeni etkinleştirme kodu oluşturuldu', 'lisans'],
  'trial.started': ['Deneme başlatıldı', 'lisans'],
  'trial.converted': ['Aboneliğe geçildi', 'lisans'],
  'license.updated': ['Lisans güncellendi', 'lisans'],
  'license.extended': ['Lisans uzatıldı', 'lisans'],
  'license.plan_changed': ['Abonelik planı değiştirildi', 'lisans'],
  'license.suspended': ['Hizmet askıya alındı', 'lisans'],
  'license.resumed': ['Hizmet yeniden açıldı', 'lisans'],
  'service-plan.full': ['Hizmet paketi: Tam sisteme geçirildi', 'lisans'],
  'service-plan.menu': ['Hizmet paketi: Sadece QR menüye geçirildi', 'lisans'],
  'services.changed': ['İşletmenin hizmet paketi değiştirildi', 'lisans'],
  'services.package_updated': ['İşletmenin paketi güncellendi (hizmetleri değişti)', 'lisans'],
  // Paketler, fiyatlar ve satışlar
  'catalog.created': ['Hizmet paketleri oluşturuldu, işletmeler eski planlarına bağlandı', 'satis'],
  'catalog.service_added': ['Kataloğa yeni hizmet eklendi (eski planlara ve denemelere açıldı)', 'satis'],
  'catalog.single_licence': ['Lisanslar tek kopya ve hizmet listesiyle yeniden imzalandı (güvenlik)', 'lisans'],
  'catalog.prices_changed':['Hizmet fiyatları değiştirildi', 'satis'],
  'catalog.prices_2026_10': ['Fiyatlar 2026-10 listesine güncellendi (Uzaktan erişim tek hizmet)', 'satis'],
  'catalog.vat_changed': ['Yazılım hizmeti KDV oranı değiştirildi', 'satis'],
  'package.created': ['Yeni paket oluşturuldu', 'satis'],
  'package.updated': ['Paket değiştirildi', 'satis'],
  'package.archived': ['Paket arşive alındı', 'satis'],
  'package.restored': ['Paket arşivden geri alındı', 'satis'],
  'sale.created': ['Satış / ödeme kaydı eklendi', 'satis'],
  'sale.updated': ['Satış kaydı düzeltildi', 'satis'],
  'sale.paid': ['Satış ödendi olarak işaretlendi', 'satis'],
  'sale.unpaid': ['Satış ödenmedi olarak işaretlendi', 'satis'],
  'sale.cancelled': ['Satış kaydı iptal edildi', 'satis'],
  'sales.exported': ['Satışlarım raporu alındı', 'satis'],
  'freeze.requested': ['Dondurma istendi', 'lisans'],
  'freeze.approved': ['Dondurma onaylandı', 'lisans'],
  'freeze.rejected': ['Dondurma reddedildi', 'lisans'],
  'freeze.ended': ['Dondurma bitirildi', 'lisans'],
  'agreement.accepted': ['Mola Lisans Sözleşmesi kabul edildi', 'lisans'],
  'owner_reset.issued': ['Sahip şifresi sıfırlama kodu verildi', 'lisans'],
  'owner_reset.used': ['Sahip şifresi Mola ekibinin koduyla yenilendi', 'lisans'],
  'demo.on': ['Tanıtım işletmesi yapıldı', 'lisans'],
  'demo.off': ['Tanıtım işletmesi olmaktan çıkarıldı', 'lisans'],
  'demo.reset_requested': ['Tanıtımı sıfırla istendi', 'lisans'],
  'demo.reset_done': ['Tanıtım sıfırlandı (Mola Yönetim’den)', 'lisans'],
  'demo.reset_by_owner': ['Tanıtım işletme sahibince sıfırlandı', 'lisans'],
  'demo.reset_failed': ['Tanıtım sıfırlanamadı', 'lisans'],
  'demo.reset_expired': ['Tanıtım sıfırlama isteğinin süresi doldu', 'lisans'],
  // İşletme kayıtları ve başvurular
  'business.activated': ['İşletme etkinleştirme koduyla etkinleştirildi', 'isletme'],
  'trial.self_started': ['İşletme ücretsiz denemeyi kendisi başlattı', 'isletme'],
  'business.imported': ['İşletme eski kurulumdan aktarıldı', 'isletme'],
  'business.deleted': ['İşletme kaydı silindi', 'isletme'],
  'activation.repeated': ['Etkinleştirme yeniden denendi (aynı kayıt)', 'isletme'],
  'application.received': ['Hesap açma başvurusu geldi', 'isletme'],
  'application.updated': ['Başvuru düzeltildi', 'isletme'],
  'application.duplicate_tax': ['Başvuru reddedildi: vergi / T.C. no daha önce kullanılmış', 'isletme'],
  'application.approved': ['Başvuru onaylandı, deneme başladı', 'isletme'],
  'application.branch_approved': ['Başvuru ek şube olarak kabul edildi', 'isletme'],
  'application.rejected': ['Başvuru reddedildi', 'isletme'],
  'application.replaced': ['Başvuru kodla etkinleştirmeye geçince kaldırıldı', 'isletme'],
  // Web sitesi talepleri (server/merkez/site-leads.ts)
  'site.lead_received': ['Web sitesinden talep geldi', 'isletme'],
  'site.lead_called': ['Web sitesi talebi: arandı', 'isletme'],
  'site.lead_closed': ['Web sitesi talebi kapatıldı', 'isletme'],
  'site.lead_reopened': ['Web sitesi talebi yeniden açıldı', 'isletme'],
  'site.lead_note': ['Web sitesi talebine not eklendi', 'isletme'],
  'site.lead_linked': ['Web sitesi talebinden işletme eklendi', 'isletme'],
  'site.lead_deleted': ['Web sitesi talebi silindi', 'isletme'],
  'invoice.updated': ['Fatura bilgileri güncellendi', 'isletme'],
  'notes.updated': ['Satıcı notu güncellendi', 'isletme'],
  'install.machine_changed': ['Lisans yeni bir bilgisayarda kullanılmaya başlandı', 'isletme'],
  'install.machine_restored': ['Eski bilgisayar yeniden etkinleştirildi', 'isletme'],
  'install.reimported': ['Klasör yeniden içe aktarıldı (aynı kurulum, yeni gizli anahtar)', 'isletme'],
  // Destek ve uzaktan erişim
  'ticket.replied': ['Destek yanıtı yazıldı', 'destek'],
  'ticket.started': ['Mola ekibi işletmeyle yeni bir görüşme başlattı', 'destek'],
  'announcement.sent': ['Duyuru gönderildi', 'destek'],
  'announcement.edited': ['Duyuru düzeltildi', 'destek'],
  'announcement.withdrawn': ['Duyuru geri çekildi', 'destek'],
  'ticket.closed': ['Destek talebi çözüldü', 'destek'],
  'diagnostics.exported': ['Hata raporu indirildi', 'destek'],
  'support.access_on': ['İşletme sahibi uzaktan destek iznini açtı', 'destek'],
  'support.access_off': ['İşletme sahibi uzaktan destek iznini kapattı', 'destek'],
  'support.session_started': ['Uzaktan destek oturumu başladı', 'destek'],
  'support.session_ended': ['Uzaktan destek oturumu bitti', 'destek'],
  'support.action': ['Uzaktan destekte işlem yapıldı', 'destek'],
  'remote.phone_paired': ['İşletme sahibi bir cihaz eşleştirdi (İşletmemi yönet)', 'destek'],
  'remote_admin.session_started': ['İşletme sahibi uzaktan yönetime girdi', 'destek'],
  'remote_admin.session_ended': ['İşletme sahibinin uzaktan yönetim oturumu bitti', 'destek'],
  // Güncellemeler
  'release.imported': ['Güncelleme paketi yüklendi', 'guncelleme'],
  'release.published': ['Güncelleme herkese yayınlandı', 'guncelleme'],
  'release.pilot': ['Güncelleme pilot işletmelere yayınlandı', 'guncelleme'],
  'release.stopped': ['Güncelleme durduruldu', 'guncelleme'],
  'release.deleted': ['Güncelleme paketi silindi', 'guncelleme'],
  'release.notes': ['Güncelleme notu değiştirildi', 'guncelleme'],
  'release.step_up': ['Güncelleme yetkisi açıldı (doğrulayıcı koduyla)', 'guncelleme'],
  'release.step_up_failed': ['Güncelleme yetkisi açılamadı (doğrulayıcı kodu yanlış)', 'guncelleme'],
  'release.step_up_refused': ['Güncelleme yetkisi reddedildi', 'guncelleme'],
  'release.step_up_ended': ['Güncelleme yetkisi kapatıldı', 'guncelleme'],
  'cafe.version_changed': ['İşletmenin Mola sürümü değişti', 'guncelleme'],
  'integrity.changed': ['İşletmenin bilgisayarında Mola program dosyaları değiştirilmiş bulundu', 'kafe'],
  'integrity.restored': ['İşletmenin bilgisayarındaki Mola program dosyaları yeniden imzalı listeyle aynı', 'kafe'],
  // Yedek ve veri anahtarı
  'merkez.backup_made': ['Merkez yedeği alındı', 'yedek'],
  'merkez.backup_failed': ['Merkez yedeği alınamadı', 'yedek'],
  'merkez.backup_auto': ['Gece yedeği alındı ve doğrulandı', 'yedek'],
  'merkez.backup_auto_failed': ['Gece yedeği alınamadı', 'yedek'],
  'merkez.second_place_set': ['İkinci yedek yeri ayarlandı', 'yedek'],
  'merkez.second_place_off': ['İkinci yedek yeri kapatıldı', 'yedek'],
  'merkez.recovery_shown': ['Merkez kurtarma kodu ekranda gösterildi', 'yedek'],
  'merkez.recovery_confirmed': ['Merkez kurtarma kodu kaydedildi', 'yedek'],
  'merkez.recovery_renewed': ['Yeni Merkez kurtarma kodu oluşturuldu', 'yedek'],
  'merkez.restored': ['Mola Merkez yedekten geri yüklendi', 'yedek'],
  'merkez.key_protected': ['Veri anahtarı korumaya alındı', 'yedek'],
  'merkez.key_warning': ['Veri anahtarı uyarısı', 'yedek'],
  'merkez.started_locked': ['Mola Merkez veriler kilitli açıldı', 'yedek'],
  'merkez.unlocked': ['Veri kilidi Merkez kurtarma koduyla açıldı', 'yedek'],
  'merkez.unlock_failed': ['Veri kilidi açılamadı (kurtarma kodu yanlış)', 'yedek'],
  'merkez.unlock_retried': ['Veri kilidi Windows kilidiyle yeniden açıldı', 'yedek'],
  // Ayarlar
  'email.settings_saved': ['E-posta bildirim ayarları kaydedildi', 'ayar'],
  'email.test_sent': ['Deneme e-postası gönderildi', 'ayar'],
  'contact.updated': ['Mola ekibi iletişim bilgileri güncellendi', 'ayar'],
  'merkez.address_announced': ['Yeni Merkez adresi duyuruldu', 'ayar'],
  'merkez.address_cleared': ['Merkez adresi duyurusu kaldırıldı', 'ayar'],
  'workfolder.set': ['Çalışma klasörü ayarlandı', 'ayar'],
  'workfolder.off': ['Çalışma klasörü kapatıldı', 'ayar'],
  // İşlem kayıtları
  'journal.started': ['İşlem kayıtları başlatıldı', 'kayit'],
  'journal.legacy_imported': ['Geçmiş kayıtlar aktarıldı', 'kayit'],
  'journal.retention_set': ['İşlem kayıtlarının saklama süresi değiştirildi', 'kayit'],
  'journal.pruned': ['Saklama süresi dolan eski işlem kayıtları silindi', 'kayit'],
  'journal.exported': ['İşlem kayıtları raporu alındı', 'kayit'],
  'journal.broken': ['İşlem kayıtlarının bütünlük denetimi BOZUK buldu', 'kayit'],
  'journal.addresses_masked': ['1 yılı geçen kayıtların IP adresleri silindi', 'kayit'],
  // Saklama süreleri (8 Ekim): kapanan destek talepleri 2 yıl, reddedilen başvurular 1 yıl (server/merkez/app.ts retention).
  'ticket.deleted_retention': ['Kapanalı 2 yılı geçen destek talebi silindi', 'destek'],
  'application.deleted_retention': ['Reddedileli 1 yılı geçen başvuru silindi', 'isletme'],
};
/** Actions done by the café's own computer (a heartbeat, an activation) when the line itself does not say who. */
export const CAFE_ACTIONS = new Set(['business.activated', 'activation.repeated', 'trial.self_started', 'freeze.requested', 'application.replaced', 'application.received', 'application.updated', 'install.machine_changed', 'owner_reset.used', 'support.access_on', 'support.access_off', 'remote.phone_paired', 'remote_admin.session_started', 'remote_admin.session_ended', 'cafe.version_changed', 'agreement.accepted', 'integrity.changed', 'integrity.restored']);

export const actionText = (action: string) => A[action]?.[0] ?? action;
export const actionGroup = (action: string): JournalGroup => A[action]?.[1] ?? (action.startsWith('admin.') ? 'giris' : action.startsWith('merkez.') ? 'yedek' : 'ayar');
export const knownActions = () => Object.keys(A);
/** Failed and refused codes; everything else is "Başarılı". */
export function resultOf(action: string): JournalResult {
  if (/(_refused|\.refused)$/.test(action)) return 'reddedildi';
  if (/(_failed|\.failed|\.broken)$/.test(action) || action === 'merkez.key_warning') return 'basarisiz';
  return 'basarili';
}
/**
 * Canonical JSON (the bytes every hash is taken over): object keys sorted by UTF-16 code units, no spaces, `undefined`
 * left out, arrays in order, strings as JSON.stringify writes them. Re-implementable in any language (docs/ISLEM_KAYITLARI.md).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => v === undefined ? 'null' : canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).filter(k => (value as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
/** "2026-10-05" in Türkiye for an ISO time. */
export function istanbulDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
/** "05.10.2026 14:05:09" in Türkiye. */
export function istanbulTime(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

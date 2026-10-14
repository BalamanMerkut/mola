/*
 * Mola Yönetim Kılavuzu: yalnız satıcı (Merkut Studios) için. Kafelere verilmez.
 * Kurumsal ve kısa: yalnız programın bugünkü hâli, fiyat yok. Metinde uzun tire kullanılmaz.
 */
import type { Belge } from './sablon.ts';
import { adimlar, bolum, h2, h3, liste, not, p, sekil, sss, tablo } from './sablon.ts';

function genel() {
  return [
    bolum('Genel bakış ve giriş', 'Mola Yönetim, Mola Merkez sunucusunun yönetim ekranıdır: <b>https://merkez.molayazilim.com.tr</b>. Lisans, paket, destek, duyuru, yedek ve güncelleme işlemleri buradan yapılır.'),
    tablo(['', 'Kafe (işletmenin bilgisayarı)', 'Mola Merkez (sunucu)'], [
      ['Çalışan', 'Sipariş, kasa, mutfak, menü, raporlar, yedek, yazıcı', 'Mola Yönetim, lisans, etkinleştirme, destek, duyuru, güncelleme'],
      ['Veri', 'Bütün işletme verisi, şifreli', 'İşletme kayıtları, lisanslar, destek talepleri, işlem kayıtları'],
      ['Bağlantı', 'Merkez\'e yalnız dışarıya doğru bağlanır', 'Kafeye bağlanmaz, yalnız yanıt verir'],
    ]),
    not('Satış verisi Merkez\'e gelmez. Merkez yalnız sayıları (masa, ürün, çalışan), sürümü, yedek durumunu ve destek mesajlarını görür. Kafelerin bulut yedekleri Merkez\'de şifreli durur; Merkez bunları açamaz.', 'bilgi'),
    h2('Menü'),
    tablo(['Bölüm', 'İşlev'], [
      ['<b>Bugün</b>', 'Günün yapılacakları, en acilden başlayarak.'],
      ['<b>İşletmeler</b>', 'Bütün kafeler; işletme sayfası (Özet, Lisans, Hizmet, Bilgiler, Destek).'],
      ['<b>Başvurular</b>', 'Hesap açma başvuruları ve web sitesi talepleri.'],
      ['<b>Duyurular</b>', 'Kafelere duyuru gönderme ve okunma takibi.'],
      ['<b>Satışlarım</b>', 'Tahsilatlar, bekleyen ödemeler, muhasebe çıktıları.'],
      ['<b>Paketler</b>', 'Paketler ve Hizmet fiyatları.'],
      ['<b>Yedek</b>', 'Merkez yedeği, kurtarma kodu, kafelerin bulut yedekleri.'],
      ['<b>Güncellemeler</b>', 'Kafe sürümünü yükleme ve yayınlama.'],
      ['<b>Destek</b> (altta)', 'Bütün kafelerin destek talepleri.'],
      ['<b>Ayarlar</b> (altta)', 'Hesap güvenliği, Kullanıcılar, E-posta bildirimleri, İletişim bilgileri, İşlem kayıtları, Çalışma klasörü, Geliştirici erişimi.'],
      ['<b>Zil</b> (sağ üst)', 'Bildirim merkezi: olayların kaydı.'],
    ], 'kucuk'),
    p('Telefon ve tablette Yedek, Güncellemeler, Paketler ve Duyurular üst çubukta simge olarak yer alır.'),
    sekil('y-bugun', { genislik: 580, aciklamalar: ['Sol menü.', '"Bugün yapılacaklar" listesi.', 'Zil: Bildirim merkezi (okunmamış olay sayısı).'] }),
    h2('Bugün ve Bildirim merkezi'),
    liste([
      '<b>Bugün</b> her satırda bir cümle ve bir düğme gösterir: Merkez yedeği alınamadı, biten ya da 7 gün içinde bitecek lisans, yanıt bekleyen destek, onay bekleyen başvuru ve web sitesi talebi, dondurma isteği, iki farklı bilgisayar, 3 günden uzun bağlanmayan işletme, yedeği başarısız işletme, dosyaları değişmiş kurulum, gönderilemeyen e-posta. Liste boşsa "Her şey yolunda" yazar.',
      '<b>Bildirim merkezi</b> olayları saklar. Süzgeçler: Tümü, Okunmamış, Önemli. Olayın düğmesi ilgili yeri açar; zarf simgesi okundu ya da okunmadı yapar. E-posta bildirimleri açıksa önemli olaylar e-postayla da gelir.',
      '<b>Sürüm satırı</b> (sayfanın altı): "Mola Yönetim x · Merkez y". Merkez güncellendiğinde açık sayfa sessiz bir anda kendiliğinden yenilenir; yenilenmemişse satırda <b>"Yeni sürüm yüklendi · Yenile"</b> çıkar.',
    ]),
    h2('Giriş ve iki adımlı giriş'),
    adimlar([
      '<b>https://merkez.molayazilim.com.tr</b> adresini açın.',
      'Kullanıcı adı ve şifreyi yazın, <b>Giriş yap</b>.',
      'Authenticator kodunu (ya da kurtarma kodlarınızdan birini) yazın, <b>Doğrula ve giriş yap</b>.',
    ]),
    p('Şifre unutulursa giriş ekranında <b>Şifremi unuttum → E-postama kod gönder</b>. Kod, E-posta bildirimleri ayarlıysa yönetici e-postasına gelir.'),
    h3('İki adımlı girişi açmak'),
    adimlar([
      'Ayarlar → <b>Hesap güvenliği</b> → İki adımlı giriş.',
      'QR kodu telefondaki doğrulama uygulamasıyla (Authenticator) okutun.',
      'Kurtarma kodlarını kâğıda yazın.',
      'Uygulamadaki ilk kodu yazıp doğrulayın.',
    ]),
    h2('Adım onayı'),
    p('Para ya da bütün kafeleri etkileyen işlemler güncel Authenticator kodunu yeniden ister. Doğru kod 10 dakikalık bir yetki açar. İki adımlı giriş kapalıysa bu işlemler yapılamaz; kutudaki <b>"İki adımlı doğrulamayı aç"</b> Hesap güvenliği\'ni açar, kurulumdan sonra işleme dönülür.'),
    tablo(['Adım onayı ister', 'İstemez'], [[
      'Hizmet fiyatları ve yazılım KDV oranı<br>Paket oluşturma, düzenleme, kopyalama, arşivleme<br>İşletmenin hizmetini değiştirme<br>Lisans uzatmada "Ödeme alındı"<br>Satışlarım: ekleme, düzeltme, "Ödendi"<br>Duyuru gönderme, düzenleme, geri çekme<br>Güncelleme yükleme, yayınlama, durdurma, silme, not',
      'Ödemesiz lisans uzatma<br>Askıya alma, hizmeti açma<br>Destek yanıtı, "Yeni mesaj"<br>Başvuru onayı ve reddi',
    ]], 'kucuk'),
    h2('Yetkili kullanıcılar'),
    adimlar([
      'Ayarlar → <b>Kullanıcılar</b> (yalnız admin görür).',
      'Adı soyadı, kullanıcı adı (ör. ayse.yilmaz) ve ilk şifreyi yazın; kendi şifrenizle onaylayın.',
      'Ekranda bir kez gösterilen adres, kullanıcı adı ve ilk şifreyi telefonla ya da yüz yüze iletin.',
      'Yetkili ilk girişte kendi şifresini belirler, ardından kendi iki adımlı girişini açar.',
    ]),
    tablo(['Yetkili', 'Yalnız admin'], [[
      'İşletmeler, Başvurular, Destek, Duyurular, Satışlarım, Paketler, Yedek durumu, Güncellemeler, İşlem kayıtları<br>Kendi şifresi ve iki adımlı girişi',
      'Kullanıcılar (ekleme, yeni ilk şifre, silme)<br>E-posta bildirim ayarları<br>Merkez kurtarma kodu<br>Geliştirici erişim anahtarları',
    ]], 'kucuk'),
    liste([
      'Yetkili adım onayında kendi Authenticator kodunu kullanır. İşlemleri İşlem kayıtları\'nda "Ad Soyad (yetkili)" olarak görünür.',
      'Şifresini unutan yetkili: Kullanıcılar → anahtar düğmesi → <b>Yeni ilk şifreyi ver</b>.',
      'Silinen yetkilinin oturumu hemen kapanır.',
      'Yetkililer işletmelerin fatura ve iletişim bilgilerini görür; gizlilik yükümlülüğü yazılı olarak bildirilmelidir.',
    ]),
  ].join('');
}

function isletmeler() {
  return [
    bolum('İşletmeler', 'Her kafe bir satırdır; satıra dokununca işletme sayfası açılır.'),
    sekil('y-isletmeler', { genislik: 560, aciklamalar: ['Arama: ad (önceki ad dahil), telefon, e-posta, vergi no, yetkili.', 'İşletme satırı: ad, il, tür, durum, plan, sürüm, son bağlantı.', '"CSV indir": listede görüneni dışa aktarır.'] }),
    p('Durum çipleri: Tümü, Çalışıyor, Deneme, Bitiyor, Bağlantı yok, Askıda. Kod bekleniyor, kurulum bekliyor, süresi doldu ve yedek sorunu "Diğer durumlar" altındadır.'),
    h2('İşletme ekleme ve etkinleştirme kodu'),
    adimlar([
      'İşletmeler → <b>İşletme ekle</b>. İsterseniz işletme türünü ve paketi seçin.',
      'Üretilen etkinleştirme kodunu <b>Kodu kopyala</b>, <b>Yazdır</b> ya da <b>WhatsApp ile gönder</b> ile iletin. Kod 14 gün geçerli, tek kullanımlıktır ve bir kez gösterilir.',
      'Kafenin bilgisayarına Mola\'yı kurun. İlk açılışta <b>Etkinleştirme kodum var</b> seçilir, kod yazılır, <b>Etkinleştir</b>.',
    ]),
    p('Kod kaybolursa işletme sayfası → Lisans → <b>Yeni kod oluştur</b>.'),
    not('Bir bilgisayardaki Mola tek bir işletmeye bağlanır. Aynı bilgisayarda başka bir işletme açmak için Mola "Verileri ve yedekleri de sil" işaretli kaldırılıp yeniden kurulur; önceki işletmenin verisi silinir.', 'dikkat'),
    h2('İşletme sayfası'),
    tablo(['Sekme', 'İçerik'], [
      ['<b>Özet</b>', 'Sıradaki işler, Lisans ve paket, Bağlantı ve cihaz (son bağlantı, QR siparişleri, internetten menü, bilgisayarlar, sürüm), Yedekler, Satıcı notu, Diğer bilgiler.'],
      ['<b>Lisans</b>', 'Lisans süresi, Süreyi uzat, Abonelik planı, Hizmeti dondurma, Lisans sözleşmesi, sahip şifresi ve taşıma kodları, Dikkat kartı.'],
      ['<b>Hizmet</b>', 'Paket ya da Özel hizmet seçimi, Bu işletme için fiyat, Tanıtım işletmesi.'],
      ['<b>Bilgiler</b>', 'İletişim, adres, fatura bilgileri, sosyal medya, cihaz ve kurulum, olası tekrar kayıtlar, geçmiş.'],
      ['<b>Destek</b>', 'Talepler, Yeni mesaj, Uzaktan destek, Hata kayıtları.'],
    ], 'kucuk'),
    p('Müşteri sipariş veremiyorsa önce Özet\'teki <b>QR siparişleri</b> kutusuna bakılır:'),
    tablo(['QR siparişleri', 'Anlamı'], [
      ['Açık', 'Müşteri telefondan sipariş verebilir.'],
      ['Kapalı · personel ekranı bağlı değil', 'Kafede mutfak, garson ya da kasa ekranı açık değil.'],
      ['Kapalı · gün sonu yapıldı', 'Kasiyer "Aç" diyene, kasa açılana ya da 05:00\'e kadar.'],
      ['Kapalı · elle durduruldu', 'Kafede "QR siparişlerini durdur" seçildi.'],
      ['Kapalı · kafe bilgisayarı bağlı değil', 'Menü Merkez\'deki kopyadan açılır, sipariş alınmaz.'],
    ], 'kucuk'),
    h2('Lisans işlemleri'),
    tablo(['İşlem', 'Yöntem'], [
      ['Süre uzatma', 'Süreyi uzat → süre seçin. Süre bitiş tarihine (bitmişse bugüne) eklenir. <b>Ödeme alındı</b> açıksa tutar, yöntem, fatura no ve durum Satışlarım\'a yazılır (adım onayı). Ödemesiz uzatma için kapatın.'],
      ['Plan değiştirme', 'Abonelik planı: aylık, 6 aylık, yıllık. Bitiş tarihi değişmez.'],
      ['Askıya alma', 'Dikkat → Askıya al, neden yazılır. Kafede menü ve yeni sipariş kapanır. <b>Hizmeti aç</b> geri açar.'],
      ['Dondurma', 'Yalnız yıllık abonelikte, 12 ayda bir, en fazla 60 gün. Kafenin isteği Bugün\'e düşer; onaylanır. Süre korunur.'],
      ['Sahip şifresi', '<b>Sahip şifresi sıfırlama kodu ver</b>: 30 dakika geçerli, tek kullanımlık. Yalnız arayan doğrulandıktan sonra verilir.'],
      ['Yeni bilgisayar', '<b>Taşıma kodu ver</b>: sahibin şifresi yoksa kurtarma koduyla birlikte kullanılır (Bölüm 3, "Veri erişimi").'],
      ['Kaydı silme', 'Hiç bağlanmamış kayıt doğrudan silinir. Bağlanmış işletme yalnız askıdayken ve adı yeniden yazılarak silinir; kafedeki Mola kalıcı olarak kilitlenir.'],
    ], 'kucuk'),
    p('Lisans değişiklikleri kafeye en geç 10 dakikada ulaşır.'),
    h2('Paket ve hizmet değiştirme'),
    adimlar([
      'İşletme sayfası → <b>Hizmet</b>.',
      'Bir paket kartı ya da hizmetleri tek tek seçmek için <b>Özel</b>.',
      'Alttaki değişiklik çubuğunda <b>Neler değişiyor</b> ile kontrol edin.',
      '<b>Değişikliği uygula</b> → Authenticator kodu.',
    ]),
    liste([
      'Kapanan hizmetin verisi silinmez; sahip onu "Pakette yok" olarak görür.',
      '<b>Bu işletme için fiyat</b>: işletmeye özel indirim (tutar ya da yüzde).',
      '<b>Tanıtım işletmesi</b>: satış sunumu yapılan kafeyi işaretler; "Tanıtımı sıfırla" örnek veriye döndürür. Masa QR\'ları değişmez.',
    ]),
    h2('"Dosyalar değiştirilmiş" uyarısı'),
    liste([
      'Kafeler program dosyalarını günde bir kez imzalı listeyle karşılaştırır. Fark varsa işletme satırında <b>"Dosyalar değiştirilmiş"</b>, Bugün\'de bir satır ve Bildirim merkezinde bir olay çıkar; dosyalar Lisans sekmesinde listelenir.',
      'Kafe durdurulmaz. İşletme aranır, Mola yeniden kurdurulur; gerekirse askıya alınır. Virüs programının karantinaya aldığı dosya "eksik" görünebilir.',
      'Denetim için her kafe sürümünün güncelleme paketi Güncellemeler\'e yüklenmiş olmalıdır.',
    ]),
  ].join('');
}

function basvuruDestek() {
  return [
    bolum('Başvurular, destek ve duyurular'),
    h2('Hesap açma başvuruları'),
    p('Kafe Mola\'yı kurup "Kodum yok, başvuru yapacağım" formunu doldurunca başvuru Başvurular\'a düşer.'),
    sekil('y-basvurular', { genislik: 540, aciklamalar: ['"30 günlük denemeyi başlat": kafe birkaç saniyede açılır, bütün hizmetler açıktır.', '"Reddet": kısa bir neden yazılır; sahip düzeltip yeniden gönderir.'] }),
    liste([
      'Aynı vergi numarası daha önce kullanıldıysa başvuru işaretlenir: <b>Ek şube olarak kabul et</b> ya da <b>Reddet</b>.',
      'Reddedilenler "Düzeltme bekleyenler" bölümündedir.',
      'Deneme yalnız onayla başlar.',
    ]),
    h3('Web sitesi talepleri'),
    p('molayazilim.com.tr iletişim formundan gelenler Başvurular → <b>Web sitesi talepleri</b> altındadır. İşlemler: <b>Arandı</b>, not ekleme, <b>Kapandı</b>, e-posta, <b>İşletme ekle</b> (talepten işletme kaydı). <b>Sil</b> yalnız KVKK silme isteği içindir.'),
    h2('Destek'),
    liste([
      'Destek sayfası bütün kafelerin taleplerini gösterir: Açık, Yanıt bekleniyor, Kapandı. Talep yalnız Mola ekibince kapatılır.',
      'Ek: fotoğraf ve PDF, dosya başına 10 MB, mesaj başına 5 dosya. Ekler 14 gün sonra silinir.',
      'İşletme adına dokununca özet açılır (durum, paket, lisans, son bağlantı, QR siparişleri, telefon, e-posta) ve ilgili sekmeye geçilir.',
      '"Hata takip kodunu sorgula", kafenin ekranındaki koda ait hata kaydını bulur.',
      'Görüşmeyi Mola ekibi başlatmak için: işletme sayfası → Destek → <b>Yeni mesaj</b>.',
    ]),
    h3('Uzaktan destek'),
    adimlar([
      'Sahip kafede Destek → Uzaktan erişim → <b>Uzaktan destek izni</b>\'ni açar.',
      'İşletme sayfası → Destek → <b>Kafeye bağlan</b>. Kafenin ekranları yeni sekmede açılır.',
      'İş bitince <b>Bağlantıyı kes</b>.',
    ]),
    tablo(['Uzaktan yapılabilir', 'Görülemez'], [[
      'Menü, masalar, yazıcı ve görünüm ayarları',
      'Satış raporları, ödemeler, kasa kapanışları, çalışan şifreleri, misafir telefonları',
    ]], 'kucuk'),
    p('Her bağlantı iki tarafta da kayıt altına alınır.'),
    h2('Veri erişimi: işletme aradığında'),
    p('Kafelerin sunucu yedekleri işletmenin anahtarıyla şifrelidir; Mola Yönetim açamaz. Arayan önce doğrulanır: Bilgiler\'deki yetkili adı ve telefonla karşılaştırılır, numara geri aranır, vergi numarasının son 4 hanesi ve son ödeme tarihi sorulur. Şüphede kod verilmez.'),
    tablo(['Durum', 'İşletme', 'Mola ekibi'], [
      ['Şifresini biliyor', 'Yeni bilgisayarda <b>İşletmem var</b> → e-posta kodu → <b>İndir ve geri yükle</b>.', 'İşlem gerekmez. "Bilgiler eşleşmedi" çıkarsa sahip eski bilgisayarda Ayarlar → Yedek → İşletmem var → "Hazırla".'],
      ['Şifreyi unuttu, kurtarma kodu var', '<b>Mola Merkez\'den geri yükle</b>: taşıma kodu + kurtarma kodu.', 'Lisans → <b>Taşıma kodu ver</b>; kod telefonda okunur.'],
      ['Bilgisayar çalışıyor, şifreyi unuttu', 'Sol şerit → Güvenlik → <b>İşletme sahibi şifresini unuttum</b>.', 'Kurtarma kodu yoksa Lisans → <b>Sahip şifresi sıfırlama kodu ver</b>.'],
      ['Şifre, kod ve bilgisayar yok', 'Sıfırdan kurulum.', 'Veri açılamaz. Yeni etkinleştirme kodu verilir, kalan süre aktarılır.'],
    ]),
    liste([
      '<b>İşletmem var</b> için gerekenler: Bulutta şifreli yedek hizmeti, doğrulanmış e-posta ve sahibin kafede "İşletmem var hazır" yazısını görmesi.',
      'Sahip eski e-postasına ulaşamıyorsa: Bilgiler → İşletmem var → "Doğrulanmış adresi kaldır" (arayan doğrulandıktan sonra).',
      'Her başarılı girişte işletmenin adreslerine "İşletmeniz yeni bir bilgisayarda açıldı" e-postası gider.',
    ]),
    h2('Duyurular'),
    adimlar([
      'Duyurular → <b>Yeni duyuru</b>.',
      'Başlık ve metni yazın; hedefi seçin: tüm işletmeler, bir paketteki işletmeler ya da seçili işletmeler.',
      'Gerekirse <b>Önemli</b> (sahip girişte pencereyle görür) ve <b>E-postayla da gönder</b> (fatura e-postasına kopya).',
      'Önizlemeyi kontrol edin, <b>Duyuruyu gönder</b> → Authenticator kodu.',
    ]),
    sekil('y-duyuru-yaz', { genislik: 440, aciklamalar: ['Başlık ve metin.', 'Hedef.', '"Önemli".', 'Önizleme.'] }),
    liste([
      'Hedef gönderim anında sabitlenir; sonradan katılan kafe duyuruyu görmez.',
      'Kafeye en geç 10 dakikada ulaşır. Duyuruyu sahip ve Müdür görür; kasiyer, garson ve mutfak görmez.',
      'Duyuru açılınca okuyanlar ve okumayanlar saatleriyle listelenir. <b>Geri çek</b> duyuruyu kafelerden kaldırır.',
    ]),
  ].join('');
}

function satisPaket() {
  return [
    bolum('Satışlarım, Paketler ve Güncellemeler'),
    h2('Satışlarım'),
    sekil('y-satislarim', { genislik: 520, aciklamalar: ['Excel: satışlar, aylık toplam, KDV dökümü.', 'PDF.'] }),
    liste([
      'Üst kartlar: <b>Bu ay tahsilat</b> (KDV dahil), <b>Aylık düzenli gelir</b> (yıllık planda yıllığın 12\'de biri), <b>Bekleyen ödemeler</b>.',
      'Süzgeçler: yıl, ay, işletme. Muhasebe için Excel, PDF ve Yazdır.',
      'Kayıtlar lisans uzatmadaki "Ödeme alındı"dan gelir ya da <b>Ödeme ekle</b> ile girilir. Her kayıt düzeltilebilir ve "Ödendi" yapılabilir.',
      '<b>Yazılım hizmeti KDV oranı</b> (varsayılan %20) yeni kayıtlara uygulanır; her kayıt kendi oranını saklar.',
    ]),
    h2('Paketler'),
    p('Paketler sayfasının iki sekmesi vardır: <b>Paketler</b> ve <b>Hizmet fiyatları</b>. Hazır paketler: Çay bahçesi, Kafe Standart, Restoran Pro.'),
    adimlar([
      '<b>Yeni paket</b> → paket adı.',
      'Hizmetleri seçin. Adisyon çekirdeği her pakette bulunur; gerektirdiği hizmet kendiliğinden eklenir (QR sipariş için QR menü). "Yakında" olanlar seçilemez.',
      'İsterseniz paket indirimi (tutar ya da yüzde) girin; toplam sağda hesaplanır.',
      'Kaydedin → Authenticator kodu.',
    ]),
    liste([
      'Paket kartı: Düzenle, Kopyala, Arşivle. Kullanımdaki bir paket değişirse ek onay istenir ve o paketteki bütün işletmelerin lisansı güncellenir.',
      '<b>Hizmet fiyatları</b>: her hizmet için aylık ve yıllık tutar; yıllık boşsa aylıktan hesaplanır. Fiyatlar KDV hariçtir. Satır sonundaki simge başlangıç değerine döndürür.',
      'Tek işletmeye indirim: işletme sayfası → Hizmet → <b>Bu işletme için fiyat</b>.',
    ]),
  ].join('');
}

function guncellemeler() {
  return [
    h2('Güncellemeler'),
    p('Yeni kafe sürümü Güncellemeler sayfasından yüklenir, Merkez tarafından denetlenip imzalanır, önce pilot işletmelere sonra herkese yayınlanır.'),
    sekil('y-guncellemeler', { genislik: 580 }),
    h3('Yayınlama'),
    adimlar([
      'Kaynak klasörde sürümü yükseltin, <b>npm.cmd run installer</b> çalıştırın. <b>Guncelleme</b> klasöründe <b>.mola-guncelleme</b> dosyaları oluşur (Windows, macOS, Linux).',
      'İsterseniz <b>İşletme sahibine not</b> yazın; sahibin güncelleme penceresinde "Neler yeni" olarak görünür.',
      'Dosyayı alana sürükleyin (ya da <b>Dosya seç</b>) → <b>Yükle ve doğrula</b> → Authenticator kodu. Paket denetlenir ve imzalanır; hiçbir kafeye gitmez.',
      '<b>Önce pilot işletmelere</b> → bir iki kafe seçin → <b>Pilotu başlat</b>.',
      '<b>İşletmelerin sürümleri</b> tablosunda pilot kafelerin "kuruldu" durumunu kontrol edin.',
      'Sorun yoksa <b>Herkese yayınla</b>.',
    ]),
    h3('Kafede ne olur'),
    tablo(['Adım', 'Kafe'], [
      ['İndirme', 'Yayındaki sürümü arka planda kendiliğinden indirir.'],
      ['Güncelleme penceresi', 'Sahip ekranında pencere açılır: <b>Şimdi güncelle</b>, <b>1 saat sonra hatırlat</b>, <b>Kapanışta kur</b>.'],
      ['Şimdi güncelle', 'Önce yedek alınır; ilerleme yüzdeyle gösterilir; bitince sayfa kendiliğinden yenilenir. Açık masa ya da bitmemiş sipariş varken bu düğme kapalıdır.'],
      ['Ertelenirse', 'Kapanışta, sabah açılışta ya da boştayken, önce yedek alınarak kurulur.'],
      ['Hata', 'Yeni sürüm açılmazsa önceki sürüme kendiliğinden döner; olay Bildirim merkezine düşer.'],
      ['Açık ekranlar', 'Tabletler ve diğer açık sayfalar sessiz bir anda kendiliğinden yenilenir.'],
    ], 'kucuk'),
    h3('Diğer işlemler'),
    liste([
      '<b>Durdur</b>: henüz kurmamış kafeler beklemeye geçer. Kurulmuş sürüm geri alınmaz; düzeltme yeni sürümle yapılır.',
      '<b>Sil</b>: yalnız yayında olmayan paket. <b>Notu düzenle</b>: sürüm yeniden imzalanır.',
      '<b>Klasörde hazır</b>: çalışma klasörüne bırakılan paketler buradan yüklenir.',
      'Güncelleme yetkisi: bir kod 10 dakika geçerlidir; bu sürede yeniden sorulmaz.',
      'Kafeye elle kurulan her sürümün paketi de buraya yüklenir (yayınlanmadan); dosya denetimi imzalı listeyi buradan alır.',
    ]),
    not('<b>Sıra:</b> önce Mola Merkez güncellenir (Bölüm 6), sonra kafe sürümü yayınlanır.', 'dikkat'),
  ].join('');
}

function yedekAyarlar() {
  return [
    bolum('Yedek ve Ayarlar'),
    h2('Yedek'),
    tablo(['Kart', 'İşlev'], [
      ['<b>Yedekler nerede?</b>', 'Merkez yedeği (bu sunucu), ikinci yer ve kafelerin bulut yedekleri. Merkez yedeği her gece şifreli alınır ve doğrulanır; <b>Şimdi yedekle</b> hemen alır. Alınamazsa Bugün\'ün en üstüne düşer.'],
      ['<b>Saklanan yedekler</b>', 'En yeni yedekler tutulur; en eskisi silinir.'],
      ['<b>İkinci yedek yeri</b>', 'Yedeklerin kopyalandığı ikinci klasör. Yolu yazıp <b>Kaydet</b>; "Göz at" yalnız Merkez\'in çalıştığı bilgisayarda görünür.'],
      ['<b>Kurtarma kodu</b>', 'Yedekleri açan anahtar; kâğıda yazılıp ayrı saklanır. VDS\'te ekranda gösterilmez.'],
      ['<b>Geri yüklemeye hazırlık</b>', 'Merkez\'i yeni bir sunucuda geri getirmek için gerekenler: yedek, kurtarma kodu, ikinci yerde kopya.'],
      ['<b>Sunucu diski</b> ve liste', 'Kafelerin bulut yedekleri: işletme başına son yükleme, boyut, "2 gündür yok" uyarısı, disk ve kota. Her kafenin son 3 günün ve son 2 haftanın kopyası saklanır.'],
    ], 'kucuk'),
    p('Merkez kurtarma kodunu yenilemek (SSH): <b>sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/kurtarma-kodu.sh; sudo systemctl start mola-merkez</b>. Yeni kod ekrana yazılır, iki parçası geri sorulur; eski kod geçersiz olur.'),
    h2('Ayarlar'),
    tablo(['Bölüm', 'İçerik'], [
      ['<b>Hesap güvenliği</b>', 'Yönetici şifresi, İki adımlı giriş, Kurtarma kodları.'],
      ['<b>Kullanıcılar</b>', 'Yetkili ekleme, yeni ilk şifre, silme (yalnız admin).'],
      ['<b>E-posta bildirimleri</b>', 'SMTP hesabı, adresler, deneme e-postası, son e-postalar.'],
      ['<b>İletişim bilgileri</b>', 'Mola ekibinin telefonu, WhatsApp\'ı, e-postası, çalışma saatleri. Kafelerdeki "Mola ekibine ulaşın" ve web sitesi bunları gösterir.'],
      ['<b>İşlem kayıtları</b>', 'Mola Yönetim\'de yapılan her işlemin değiştirilemez kaydı.'],
      ['<b>Çalışma klasörü</b>', 'Durum özeti ve işlem kayıtlarının günlük kopyası; vds:cek bilgisayara çeker.'],
      ['<b>Geliştirici erişimi</b>', 'Yayınlama komutu için erişim anahtarı; bir kez gösterilir, iptal edilebilir.'],
    ], 'kucuk'),
    h2('E-posta bildirimleri'),
    p('Önemli olaylar, şifre sıfırlama kodu, İşletmem var kodları ve duyuru kopyaları bu hesapla gönderilir. Her SMTP hesabı kullanılabilir.'),
    adimlar([
      'Ayarlar → <b>E-posta bildirimleri</b> → "Önemli olayları e-postayla da gönder" açık.',
      '<b>Sunucu</b>: SMTP adresi, bağlantı türü, port.',
      '<b>Gönderen hesap</b>: kullanıcı ve şifre (Gmail\'de uygulama şifresi, gönderim hizmetinde SMTP anahtarı).',
      '<b>Adresler</b>: bildirimlerin gideceği adres, gönderen adresi, yönetici e-postası.',
      '<b>E-posta ayarlarını kaydet</b> → <b>Deneme e-postası gönder</b>.',
    ]),
    tablo(['', 'Gmail', 'Gönderim hizmeti (ör. Brevo)'], [
      ['Sunucu', 'smtp.gmail.com', 'smtp-relay.brevo.com'],
      ['Bağlantı ve port', 'Güvenli (TLS), 465', 'STARTTLS, 587'],
      ['Kullanıcı ve şifre', 'Gmail adresi ve 16 harflik uygulama şifresi', 'Hizmetin verdiği SMTP kullanıcısı ve anahtarı'],
      ['Gönderen adresi', 'Boşsa kullanıcı adresi', 'Hizmette doğrulanmış adres: destek@molayazilim.com.tr'],
    ]),
    liste([
      '<b>Aylık kontrol</b>: 30 gün hiç e-posta gönderilmezse Merkez bildirim adresine kısa bir kontrol e-postası gönderir; kullanılmayan SMTP anahtarının kapanmasını önler.',
      'Gönderilemeyen e-posta 1, 5, 30 dakika, 2 ve 6 saat sonra yeniden denenir. Yine gönderilemezse Bildirim merkezinde <b>"E-posta gönderilemiyor"</b> çıkar ve Bugün\'e düşer.',
      'Şifre Merkez\'de şifreli saklanır, ekranda gösterilmez. Kullanıcı adı, şifre ve anahtarlar şifre yöneticisinde tutulur.',
    ]),
    h2('İşlem kayıtları'),
    sekil('y-islem-kayitlari', { genislik: 540, aciklamalar: ['Bütünlük denetimi: "Kayıtlar bütün".', 'Rapor al: PDF, Excel, JSONL.', 'Dönem: Tümü, Bugün, 7 gün, 30 gün, Başarısız olanlar.', 'Süzgeçler: işletme, kişi, sonuç, tarih.'] }),
    p('Her işlem kim, ne zaman, nereden ve eski → yeni değerleriyle kaydedilir. Kayıtlar mühürlüdür; bozulma kırmızı uyarıyla gösterilir. Saklama süresi 10 yıl; IP adresleri 1 yıl sonra silinir.'),
    h2('Satıcı bilgisayarı'),
    p('Mola Yönetim ve Merkez VDS\'tedir; satıcı bilgisayarı arızalansa da kafeler çalışır. Bilgisayarda yedeklenmesi gerekenler:'),
    tablo(['Ne', 'Kaybolursa', 'Önlem'], [
      ['Kaynak kod (GitHub)', 'Gönderilmemiş değişiklikler', 'Her işten sonra commit + push'],
      ['Merkez yedekleri (C:\\MolaCalisma\\vds)', 'VDS\'te ve Drive\'da kopya var', '<b>npm run vds:cek</b> her gün 07:00'],
      ['Android imza anahtarı (.local\\android-imza)', 'APK aynı imzayla güncellenemez', '<b>npm run bilgisayar:yedek</b>; şifresi şifre yöneticisinde'],
      ['SSH anahtarı (%USERPROFILE%\\.ssh)', 'VDS konsolundan yeni anahtar eklenir', 'bilgisayar:yedek (parolalı)'],
      ['Şifreler ve kodlar', 'Bilgisayarda tutulmaz', 'Şifre yöneticisi ve kasadaki zarf'],
    ]),
  ].join('');
}

function sunucu() {
  return [
    bolum('Sunucu, internetten menü ve web sitesi', 'Kurulum adımları docs/VDS_KURULUM.md\'dedir. Bu bölüm düzenli işleri içerir.'),
    h2('Adresler'),
    tablo(['Adres', 'İşlev'], [
      ['https://molayazilim.com.tr', 'Web sitesi (www buraya yönlenir)'],
      ['https://molayazilim.com.tr/api/site/*', 'İletişim formu → Mola Merkez'],
      ['https://molayazilim.com.tr/s/*', 'Sosyal medya QR kısa adresleri'],
      ['https://menu.molayazilim.com.tr/q/*', 'İnternetten menü (masa QR\'ları)'],
      ['https://merkez.molayazilim.com.tr', 'Mola Merkez, Mola Yönetim, kafe bağlantıları'],
    ], 'kucuk'),
    liste([
      'DNS Cloudflare\'dedir. Dört A kaydı (<b>@, www, merkez, menu</b>) sunucu IP\'sine gider; hepsi <b>DNS only</b> (gri bulut).',
      'VDS: Ubuntu 24.04; yalnız 22, 80 ve 443 açık. Mola Merkez bir systemd servisidir; Caddy HTTPS sertifikasını kendisi yeniler.',
      'Alan adının otomatik yenilemesi açık tutulur. Alan adı düşerse QR\'lar, lisans bağlantısı ve site birlikte durur.',
    ]),
    h2('Mola Merkez\'i güncellemek'),
    adimlar([
      'Mola Yönetim → Yedek → <b>Şimdi yedekle</b>.',
      '<b>npm.cmd run merkez:linux-paket</b> ile Linux paketini hazırlayıp sunucuya kopyalayın.',
      'Sunucuda: <b>tar xzf Mola-Merkez-Linux-x64-&lt;sürüm&gt;.tar.gz && cd mola-merkez && sudo ./kur.sh</b>. Veri ve ayarlar korunur.',
      '<b>npm run vds -- durum</b>: sağlık yanıtında yeni sürüm görünmelidir.',
      'Açık Mola Yönetim sayfaları kendiliğinden yenilenir; yenilenmeyen sayfada sürüm satırındaki <b>Yenile</b>.',
    ]),
    p('Önceki sürüme dönüş: <b>sudo systemctl stop mola-merkez && sudo rm -rf /opt/mola-merkez && sudo mv /opt/mola-merkez.eski /opt/mola-merkez && sudo systemctl start mola-merkez</b>.'),
    h2('Düzenli kontroller'),
    tablo(['Sıklık', 'İş'], [
      ['Sürekli', 'Uptime hizmeti: https://merkez.molayazilim.com.tr/api/merkez/v1/health'],
      ['Her gün', 'Bugün ve Bildirim merkezi; destek ve web sitesi talepleri.'],
      ['Haftalık', '<b>npm run vds -- ozet</b> (Merkez, Caddy, disk, son yedek, sertifika); disk %80\'in altında; vds:cek günlüğü; bağlanmayan kafeler.'],
      ['Aylık', 'Sunucu güncellemeleri (sudo apt update && sudo apt -y upgrade); bekleyen ödemeler; biten lisanslar; geri yükleme provası (<b>npm.cmd run merkez:restore</b> ile ayrı klasöre; "Geri yüklendi ve doğrulandı" yazmalı).'],
      ['Her yeni sürümde', 'Önce Merkez, sonra kafe sürümü; önce pilot, sonra herkese.'],
      ['Yılda bir', 'Alan adı ve VDS yenilemesi; Merkez kurtarma kodunun yerinde olması.'],
    ], 'kucuk'),
    h2('İnternetten menü'),
    p('Masa QR\'ları misafirin mobil verisinden de açılır: <b>https://menu.molayazilim.com.tr/q/&lt;menü kodu&gt;/&lt;masa kodu&gt;</b>. Menü Merkez üzerinden gelir, sipariş kafeye gider; kafe Merkez\'e dışarıya doğru şifreli tünel açar, port ya da modem ayarı gerekmez. Yeni kafede adres 10 ile 20 dakikada gelir; QR\'lar bundan sonra basılır.'),
    tablo(['Durum', 'Misafirin gördüğü'], [
      ['Açık, kafe bağlı', 'Menü'],
      ['Askıda, lisans bitmiş, dondurulmuş, 14 gündür bağlanmamış ya da pakette QR menü yok', '"Bu işletmenin dijital menüsü şu anda kullanılamıyor."'],
      ['Kafe bilgisayarı kapalı ya da interneti yok', 'Menü kopyadan açılır; "Şu an sipariş alınamıyor, lütfen garsonunuza sorun."'],
      ['Kafe bağlı, QR siparişleri kapalı', 'Menü; "Şu an sipariş almıyoruz, lütfen garsonunuza sorun."'],
      ['Bilinmeyen kod', '"Bu bağlantı bulunamadı. Masanızdaki QR kodunu yeniden okutun."'],
    ], 'kucuk'),
    not('Sunucuda <b>MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr</b> ve <b>MERKEZ_SITE_ORIGIN=https://molayazilim.com.tr</b> ayarlı olmalıdır (/etc/mola-merkez/ayarlar.env). Toplu QR basımından önce pilot kafede Wi-Fi\'si kapalı bir telefonla deneme siparişi verilir.', 'dikkat'),
    h2('Web sitesi'),
    p('molayazilim.com.tr düz HTML\'dir; çerez, analiz aracı ve fiyat içermez. İletişim bilgileri Ayarlar → İletişim bilgileri\'nden gelir. Yasal sayfalar avukat onayına kadar taslaktır (config.json: legalDraft).'),
    p('<b>Yayınlama:</b> yedek iletişim bilgileri <b>site/config.json</b>\'a yazılır. İndirme sayfası için <b>npm.cmd run installer</b> (MOLA_MERKEZ_URL ile), <b>npm.cmd run site:indir</b> ve config.json\'da <b>downloads.enabled: true</b>. Ardından <b>npm.cmd run site:build</b>; site/dist içeriği sunucuda /var/www/molayazilim klasörüne yüklenir.'),
  ].join('');
}

function sorunlar() {
  return [
    bolum('Sorun giderme'),
    sss('Kafe "Mola Merkez\'e ulaşılamıyor" diyor.', 'Kafe nedeni gösterir: internet yok, Merkez yanıt vermiyor, adres yanlış ya da bilgisayar saati yanlış. Merkez\'in sağlık adresi kontrol edilir; sorun kafedeyse internet ve saat kontrol ettirilir. Kafe 14 güne kadar Merkez\'siz çalışır.'),
    sss('Müşteri QR\'dan sipariş veremiyor.', 'İşletme sayfası → Özet → <b>QR siparişleri</b> kutusundaki nedene bakılır (Bölüm 2).'),
    sss('Etkinleştirmede "kod geçersiz" çıkıyor.', 'Kafe başka bir Merkez adresiyle hazırlanmış paketle kurulmuştur. Mola "Verileri ve yedekleri de sil" işaretli kaldırılır, sitedeki paketle yeniden kurulur.'),
    sss('Kafe yeni bilgisayara geçiyor.', 'Sahip yeni bilgisayarda <b>İşletmem var</b> ile girer (Bölüm 3, "Veri erişimi"). "İki farklı bilgisayar" uyarısı işletme Özet\'inden "Eski bilgisayarı yeniden etkinleştir" ile çözülür.'),
    sss('Kafe güncellemeyi kurmadı.', 'Güncellemeler → İşletmelerin sürümleri: durum ve son bilgi. "Kurulamadı" ya da "geri alındı" ise Bildirim merkezindeki olaya bakılır. Açık masa varken kurulum kapanışa kalır.'),
    sss('Mola Yönetim eski görünüyor.', 'Sayfa sessiz bir anda kendiliğinden yenilenir. Beklemeden yenilemek için sürüm satırındaki <b>Yenile</b>.'),
    sss('E-postalar gelmiyor.', 'Ayarlar → E-posta bildirimleri → Son e-postalar: hata metni okunur, ayarlar düzeltilir, <b>Deneme e-postası gönder</b>. Gönderim hizmetinde gönderen adresinin doğrulanmış olması gerekir.'),
    sss('Şifremi ve Authenticator\'ı kaybettim.', 'Authenticator yerine kurtarma kodlarından biri kullanılır. Şifre için <b>Şifremi unuttum → E-postama kod gönder</b>.'),
    sss('Merkez başka bir sunucuya taşınacak.', 'Kafeler yeni adresi imzalı duyuruyla öğrenir. Adımlar: docs/VDS_KURULUM.md, "Kafeleri yeni adrese geçirin".'),
  ].join('');
}

export function yonetimKilavuzu(): Belge {
  return {
    dosya: 'Mola-Yonetim-Kilavuzu.pdf', baslik: 'Mola Yönetim Kılavuzu', altBaslik: 'Lisans, paket, destek, güncelleme ve sunucu işlemleri', kisa: 'Mola Yönetim Kılavuzu', tocDerinlik: 2,
    kapakNotu: '<p><b>Yalnız Merkut Studios içindir.</b> Kafelere verilmez.</p><p>Ekranlar örnek işletmelerle alınmıştır.</p>',
    icerik: [genel(), isletmeler(), basvuruDestek(), satisPaket(), guncellemeler(), yedekAyarlar(), sunucu(), sorunlar()].join(''),
  };
}

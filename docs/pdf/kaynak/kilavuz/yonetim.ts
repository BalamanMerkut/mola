/*
 * Mola Yönetim Kılavuzu: yalnız satıcı (Merkut Studios) için. Kafelere verilmez. Metinde uzun tire kullanılmaz.
 */
import type { Belge } from './sablon.ts';
import { adimlar, bolum, h2, h3, liste, not, p, sekil, sss, tablo } from './sablon.ts';

function giris() {
  return [
    bolum('Mola Yönetim nedir?', 'Mola Yönetim, Mola Merkez sunucusunun yönetim ekranıdır: https://merkez.molayazilim.com.tr. Bütün kafelerin lisansını, paketini, desteğini, duyurularını ve güncellemelerini buradan yönetirsiniz.'),
    tablo(['', 'Kafe (işletmenin bilgisayarı)', 'Mola Merkez (sizin sunucunuz)'], [
      ['Ne çalışır', 'Sipariş, kasa, mutfak, menü, raporlar, yedek, yazıcı', 'Mola Yönetim, lisans, etkinleştirme, destek, duyuru, güncelleme'],
      ['Veri', 'Bütün işletme verisi, şifreli', 'İşletme kayıtları, lisanslar, destek talepleri, işlem kayıtları'],
      ['Bağlantı', 'Merkez\'e yalnız dışarıya doğru bağlanır', 'Kafeye hiç bağlanmaz, yalnız yanıt verir'],
    ]),
    not('<b>Satış verisi Merkez\'e gelmez.</b> Merkez yalnız sayıları (masa, ürün, çalışan), sürümü, yedek durumunu ve destek mesajlarını görür. Kafelerin bulut yedekleri Merkez\'de şifreli durur; Merkez onları açamaz.', 'bilgi'),
    h2('Giriş ve hesap güvenliği'),
    p('Kullanıcı adı, şifre ve iki adımlı giriş açıksa <b>Authenticator</b> (telefondaki doğrulama uygulaması) koduyla girilir. Siz (admin) ve eklediğiniz yetkililer kendi hesaplarıyla girer.'),
    sekil('y-giris-kod', { genislik: 480, aciklamalar: ['Authenticator kodu ya da kurtarma kodlarınızdan biri.'] }),
    p('Ayarlar → <b>Hesap güvenliği</b> üç karttır: <b>Yönetici şifresi</b>, <b>İki adımlı giriş</b> ve <b>Kurtarma kodları</b>. İki adımlı girişi açmak üç adımdır: QR kodu okutun, kurtarma kodlarını kâğıda yazın, ilk kodu doğrulayın. Şifrenizi unutursanız e-postanıza gelen kodla yenisini belirlersiniz.'),
    sekil('y-hesap-guvenligi'),
    h2('Kullanıcılar (yetkililer)'),
    p('Ayarlar → <b>Kullanıcılar</b> yalnız admin\'de görünür. Mola Yönetim\'e girecek kişiyi adı soyadı, kullanıcı adı (ör. ayse.yilmaz) ve ilk şifreyle eklersiniz; kendi şifreniz sorulur. Adres, kullanıcı adı ve ilk şifre bir kez gösterilir; telefonla ya da yüz yüze iletin. Yetkili ilk girişte kendi şifresini belirler.'),
    sekil('y-kullanicilar', { baslik: 'Ayarlar → Kullanıcılar' }),
    tablo(['Yetkili yapabilir', 'Yalnız siz (admin)'], [[
      'İşletmeler, başvurular, lisans ve hizmet, destek, duyurular, Satışlarım, Paketler, güncellemeler, yedek durumu, İşlem kayıtları<br>Kendi şifresi ve kendi iki adımlı girişi',
      'Kullanıcılar (ekleme, yeni ilk şifre, silme)<br>E-posta bildirim ayarları<br>Merkez kurtarma kodu<br>Geliştirici erişim anahtarları',
    ]]),
    not('Adım onayı isteyen işlemlerde yetkili <b>kendi</b> Authenticator kodunu kullanır; önce kendi iki adımlı girişini açmalıdır. İşlemleri İşlem kayıtları\'nda "Ad Soyad (yetkili)" diye görünür. Şifresini unutan yetkili için: Kullanıcılar → anahtar düğmesi → <b>Yeni ilk şifreyi ver</b>. Sildiğiniz yetkilinin oturumu hemen kapanır. Yetkililer işletmelerin fatura ve iletişim bilgilerini görür; gizliliği onlarla konuşun.', 'dikkat'),
    h2('Adım onayı'),
    p('Para ya da bütün kafeleri etkileyen işlemler bir kez daha güncel Authenticator kodunu ister. Doğru kod 10 dakikalık bir yetki penceresi açar; bu sürede yeniden sorulmaz. İki adımlı giriş kapalıysa bu işlemler yapılamaz: kutudaki <b>"İki adımlı doğrulamayı aç"</b> sizi Hesap güvenliği\'ne götürür, kurulumdan sonra kaldığınız yere dönersiniz.'),
    sekil('y-adim-onayi', { genislik: 380, yan: true, aciklamalar: ['Doğrulayıcı kodu (6 hane).', '"Onayla ve devam et".'] }),
    tablo(['Adım onayı isteyenler', 'İstemeyenler'], [[
      'Hizmet fiyatları ve yazılım KDV oranı<br>Paket oluşturma, düzenleme, kopyalama, arşivleme<br>İşletmenin hizmetini değiştirme<br>Lisans uzatmada "Ödeme alındı"<br>Satışlarım: ekleme, düzeltme, "Ödendi"<br>Duyuru gönderme, düzenleme, geri çekme<br>Güncelleme yükleme, yayınlama, durdurma, silme',
      'Ödemesiz lisans uzatma<br>Askıya alma ve hizmeti açma<br>Destek yanıtı ve "Yeni mesaj"<br>Başvuru onayı ve reddi',
    ]]),
    h2('Bugün ve Bildirim merkezi'),
    p('Mola Yönetim "Bugün" sayfasıyla açılır: yapılacaklar en acilden başlayarak sıralanır, her satırda bir cümle ve bir düğme vardır. Liste boşsa "Her şey yolunda" yazar.'),
    sekil('y-bugun', { aciklamalar: ['Sol menü: Bugün, İşletmeler, Başvurular, Duyurular, Satışlarım, Paketler; altta Destek ve Ayarlar.', '"Bugün yapılacaklar" listesi.', 'Zil: Bildirim merkezi (okunmamış olay sayısı).'] }),
    p('Listeye düşenler: Merkez yedeği alınamadı, biten ya da 7 gün içinde bitecek lisans, yanıt bekleyen destek, onay bekleyen başvuru ve web sitesi talebi, dondurma isteği, iki farklı bilgisayar uyarısı, 3 günden uzun bağlanmayan işletme, yedeği başarısız işletme, dosyaları değişmiş kurulum, gönderilemeyen e-posta.'),
    sekil('y-bildirim-merkezi', { baslik: 'Bildirim merkezi' }),
    p('<b>Bildirim merkezi</b> (zil) olayların kaydıdır: yeni başvuru, destek mesajı, biten lisans, yedek sorunu, kurulamayan güncelleme, değişmiş dosyalar, web sitesi talebi. Olayın sağındaki düğme ilgili yeri açar; zarf simgesi okundu ya da okunmadı yapar. Süzgeçler: Tümü, Okunmamış, Önemli. E-posta bildirimleri açıksa önemli olaylar e-postanıza da gelir.'),
  ].join('');
}

function isletmeler() {
  return [
    bolum('İşletmeler', 'Her kafe bir kutudur; dokununca işletmenin sayfası açılır.'),
    sekil('y-isletmeler', { aciklamalar: ['Arama: ad (önceki adı da), telefon, e-posta, vergi no, yetkili.', 'İşletme kutusu: ad, il, tür, durum çipi, plan, sürüm, son bağlantı.', '"CSV indir": listede görüneni Excel\'e alır.'] }),
    p('Durum çipleri: Tümü, Çalışıyor, Deneme, Bitiyor, Bağlantı yok, Askıda. Seyrek durumlar (kod bekleniyor, kurulum bekliyor, süresi doldu, yedek sorunu) "Diğer durumlar" altındadır.'),
    h3('Yeni işletme ve etkinleştirme kodu'),
    p('"İşletme ekle" bir etkinleştirme kodu üretir: 14 gün geçerli, tek kullanımlık, bir kez gösterilir. Pencerede <b>Kodu kopyala</b>, <b>Yazdır</b> ve <b>WhatsApp ile gönder</b> vardır. Kod kaybolursa Lisans sekmesinden "Yeni kod oluştur". Kod Mola Yönetim\'e değil, kafenin bilgisayarına girilir:'),
    adimlar(['Kafenin bilgisayarına Mola\'yı kurun.', 'İlk açılışta "Mola\'yı etkinleştir" ekranında <b>Etkinleştirme kodum var</b>ı seçin.', 'Kodu yazıp <b>Etkinleştir</b>e basın (büyük/küçük harf fark etmez).']),
    not('Bir bilgisayardaki Mola tek bir işletmeye bağlanır. Aynı bilgisayarda başka bir işletme açmak için Mola\'yı "Verileri ve yedekleri de sil" işaretli kaldırıp yeniden kurun; önceki işletmenin verisi silinir. İşaretsiz kaldırıp kurmak yetmez.', 'dikkat'),
    h2('İşletme sayfası: Özet'),
    p('Beş sekme vardır: <b>Özet, Lisans, Hizmet, Bilgiler, Destek</b>. Kartların açıklaması sağ üstteki gri <b>ⓘ</b>\'dedir.'),
    p('Özet\'te <b>Sıradaki işler</b>, <b>Lisans ve paket</b>, <b>Bağlantı ve cihaz</b> (son bağlantı, QR siparişleri, internetten menü, bilgisayarlar, sürüm) ve <b>Yedekler</b> kartları, yalnız sizin gördüğünüz <b>Satıcı notu</b> ve açılır <b>Diğer bilgiler</b> vardır. Bir kafe "müşteri sipariş veremiyor" diye ararsa önce <b>QR siparişleri</b> kutusuna bakın:'),
    tablo(['QR siparişleri', 'Anlamı'], [
      ['Açık', 'Müşteri telefondan sipariş verebilir.'],
      ['Kapalı · personel ekranı bağlı değil', 'Kafede mutfak, garson ya da kasa ekranı açık değil.'],
      ['Kapalı · gün sonu yapıldı', 'Kasiyer "Aç" diyene, kasa açılana ya da sabah 05:00\'e kadar.'],
      ['Kapalı · elle durduruldu', 'Kafede biri "QR siparişlerini durdur" dedi.'],
      ['Kapalı · kafe bilgisayarı bağlı değil', 'Menü Merkez\'deki kopyadan görünür, sipariş alınmaz.'],
    ], 'kucuk'),
    sekil('y-internet-menu', { genislik: 600, baslik: 'Özet → Diğer bilgiler', aciklamalar: ['"İnternetten menü": bağlı mı, kaç istek geldi.', '"Menünün kopyası": Merkez\'deki kopyanın tarihi, ürün ve fotoğraf sayısı, boyutu.'] }),
    h2('Lisans'),
    p('Kartlar: <b>Lisans süresi</b> (kalan gün, plan, son değişikliğin kafeye ulaşıp ulaşmadığı), <b>Süreyi uzat</b> (1 ay, 6 ay, 1 yıl) ve <b>Ödeme alındı</b>, <b>Abonelik planı</b> (aylık, 6 aylık, yıllık; plan değişince bitiş tarihi değişmez), Hizmeti dondurma, Lisans sözleşmesi, Sahip şifresi sıfırlama, Yeni bilgisayara taşıma ve kırmızı <b>Dikkat</b> kartı.'),
    liste([
      '<b>Deneme:</b> Başvurular\'dan "30 günlük denemeyi başlat" ile başlar; bütün hizmetler açıktır.',
      '<b>Uzatma</b> bitiş tarihine (bitmişse bugüne) süre ekler; plan değişmez. Kafeye en geç 10 dakikada ulaşır.',
      '<b>Ödeme alındı</b> varsayılan açıktır; tutar, yöntem, fatura no ve durum uzatmayla birlikte Satışlarım\'a kaydedilir. Ödemesiz uzatmak için kapatın.',
      '<b>Askıya al:</b> neden yazılır (yalnız siz görürsünüz). Kafede menü ve yeni sipariş kapanır, internetten menü "kullanılamıyor" der. "Hizmeti aç" geri açar.',
      '<b>Dondurma:</b> yıllık abonelikte 12 ayda bir, en fazla 60 gün. Kafenin isteği Bugün listesine düşer, siz onaylarsınız. Süre korunur.',
    ]),
    sekil('y-isletme-lisans-2', { aciklamalar: ['Hizmeti dondurma.', 'Lisans sözleşmesi: hangi sürümü, ne zaman, kim kabul etti.', 'Sahip şifresi sıfırlama kodu (30 dakika, tek kullanımlık).', '"Dikkat" kutusu: askıya al ve kaydı sil.'] }),
    not('<b>Sahip şifresi kodunu</b> yalnız arayanın gerçekten işletme sahibi olduğunu doğruladıktan sonra verin. Şifreyi siz göremez ve belirleyemezsiniz; sahip kafede yazar.', 'dikkat'),
    p('<b>Kaydı sil:</b> hiç bağlanmamış kayıt doğrudan silinir. Bağlanmış işletme ancak askıdayken ve adı yeniden yazılarak silinir; kafedeki Mola kalıcı olarak kilitlenir. Geri alınamaz.'),
    h2('Hizmet'),
    p('Üstte açık paket ve hizmet sayısı yazar. Altında paket kartları (Çay bahçesi, Kafe Standart, Restoran Pro ve sizin paketleriniz) ve hizmetleri tek tek seçtiğiniz <b>Özel</b> kart, en altta <b>Bu işletme için fiyat</b> ve işletmeye özel indirim (tutar ya da yüzde) vardır.'),
    p('Paket ya da hizmet değişince altta bir <b>değişiklik çubuğu</b> belirir: kaç hizmet değişti, aylık fiyat farkı, <b>Neler değişiyor</b>, <b>Vazgeç</b> ve <b>Değişikliği uygula</b>. Uygula, doğrulayıcı kodunu ister. Kafe yeni lisansı en geç 10 dakikada alır; kapanan hizmetin verisi silinmez, sahip onu "Pakette yok" olarak görür.'),
    p('<b>Tanıtım işletmesi</b> anahtarı satış sunumu yaptığınız kafeyi işaretler: ekranlarına "Tanıtım" etiketi konur, "Tanıtımı sıfırla" örnek veriye döndürür (en geç 10 dakikada). Masa QR\'ları değişmez.'),
    h2('Bilgiler ve Destek'),
    sekil('y-isletme-bilgiler', { aciklamalar: ['İletişim ve adres; her satırda kopyala.', 'Fatura bilgileri; "Düzenle" ile düzeltirsiniz.'] }),
    p('Altında <b>Sosyal medya</b>, <b>Cihaz ve kurulum</b> ve <b>Olası tekrar</b> kartları (aynı vergi no, bilgisayar, telefon ya da e-postayla açılmış başka kayıtlar), en altta işletmenin geçmişi vardır.'),
    p('Kafelerin "Bizi takip edin" QR kartları Merkez\'deki kısa adresi taşır (<b>molayazilim.com.tr/s/&lt;kod&gt;/instagram</b>). Sahip bağlantıyı değiştirse de basılı kart çalışır. İşletme askıdaysa ya da paketinde "Sosyal medya ve QR kartları" yoksa kısa adres "hizmet kullanılamıyor" sayfasını açar.'),
    sekil('y-isletme-destek', { aciklamalar: ['"Yeni mesaj": bu işletmeyle siz bir görüşme başlatırsınız.'] }),
    p('Destek sekmesinde işletmenin talepleri sohbet olarak açılır ve yerinde yanıtlanır. <b>Uzaktan destek</b>: sahip izin verdiyse "Kafeye bağlan" kafenin ekranlarını yeni sekmede açar. Menü, masalar, yazıcı ve görünüm ayarlarına yardım edersiniz; satış raporlarını, ödemeleri, kasa kapanışlarını, çalışan şifrelerini ve misafir telefonlarını göremezsiniz. Her bağlantı iki tarafta da kayıtlıdır; "Bağlantıyı kes" oturumu bitirir. <b>Hata kayıtları</b> ayrı bir karttır.'),
    h2('"Dosyalar değiştirilmiş" uyarısı'),
    sekil('y-dosya-degisti', { genislik: 560, baslik: 'Bir kafenin program dosyaları değişmişse' }),
    p('Kafeler program dosyalarını günde bir kez imzalı listeyle karşılaştırır. Bir dosya değişmişse işletme kutusunda <b>"Dosyalar değiştirilmiş"</b> çipi, Bugün\'de bir satır ve Bildirim merkezinde bir olay çıkar; Lisans sekmesinde hangi dosyalar olduğu yazar. Kafe durdurulmaz; arayın, yeniden kurdurun, gerekirse askıya alın. Virüs programının karantinaya aldığı dosya "eksik" görünebilir. Denetim için her sürümün güncelleme paketi Mola Yönetim\'e yüklenmiş olmalıdır (Güncellemeler).'),
  ].join('');
}

function basvurular() {
  return [
    bolum('Başvurular, destek ve duyurular'),
    h2('Hesap açma başvuruları'),
    p('Yeni bir kafe Mola\'yı kurup "Kodum yok, başvuru yapacağım" ile formu doldurunca başvuru burada görünür: işletme adı ve türü, fatura bilgileri, yetkili, telefon, e-posta.'),
    sekil('y-basvurular', { aciklamalar: ['"30 günlük denemeyi başlat": kafe birkaç saniyede açılır.', '"Reddet": kısa bir neden yazın; sahip düzeltip yeniden gönderir.'] }),
    liste(['Aynı vergi numarası daha önce kullanıldıysa başvuru işaretlenir (başvurana söylenmez). "Ek şube olarak kabul et" ya da "Reddet" seçersiniz.', 'Reddedilenler "Düzeltme bekleyenler" bölümündedir.', 'Her deneme sizin onayınızla başlar.']),
    h2('Web sitesi talepleri'),
    p('molayazilim.com.tr iletişim formundan gelen talepler aynı sayfada, "Web sitesi talepleri" çipinin altındadır. Formda e-posta zorunludur.'),
    sekil('y-web-talepleri', { aciklamalar: ['Web sitesi talepleri.', '"Arandı": aradığınızı işaretleyin.', '"İşletme ekle": talepten doğrudan işletme kaydı açılır.'] }),
    p('Talebe not ekleyebilir, kapatıp yeniden açabilir, e-posta gönderebilirsiniz. "Sil", kişinin KVKK silme isteği içindir.'),
    h2('Destek'),
    sekil('y-destek', { baslik: 'Bütün kafelerin talepleri: Açık / Yanıt bekleniyor / Kapandı' }),
    p('Talepler sohbet gibi görünür. Fotoğraf ve PDF eklenebilir (dosya başına 10 MB, mesaj başına 5); ekler 14 gün sonra silinir. Talebi yalnız Mola ekibi kapatır. <b>İşletme adına</b> dokununca kısa bir özet açılır (durum, paket, lisans, son bağlantı, QR siparişleri, telefon, e-posta) ve "İşletme sayfası", "Hizmet", "Lisans" düğmeleri o sekmeyi açar. "Hata takip kodunu sorgula" kafenin ekranındaki koda ait hata kaydını bulur.'),
    h2('Duyurular'),
    sekil('y-duyuru-yaz', { aciklamalar: ['Başlık ve metin. Bağlantılar tıklanır olur.', 'Hedef: tüm işletmeler, bir paketteki işletmeler ya da seçili işletmeler.', '"Önemli": sahip girişte ortada bir pencereyle görür.', 'Önizleme: kafenin göreceği kart.'] }),
    liste(['Gönder, düzenle ve geri çek adım onayı ister.', 'Hedef gönderildiği anda sabitlenir; sonradan katılan kafe duyuruyu görmez.', 'Kafeye en geç 10 dakikada ulaşır; interneti olmayan kafe bağlanınca alır.', 'Duyuruyu işletme sahibi ve Müdür görür; kasiyer, garson ve mutfak görmez.', 'E-posta bildirimleri ayarlıysa <b>"E-postayla da gönder"</b> her işletmenin fatura e-postasına bir kopya yollar.']),
    sekil('y-duyurular', { aciklamalar: ['Duyuru satırı: tarih, hedef, Önemli çipi ve "Okuyan: X/Y".'] }),
    p('Duyuruyu açınca "Henüz okumayanlar", "Okuyanlar" ve Önemli duyuruda "Okudum" demeyenler saatleriyle görünür. "Geri çek" duyuruyu kafelerden kaldırır.'),
  ].join('');
}

function paketler() {
  return [
    bolum('Paketler, fiyatlar ve Satışlarım'),
    h2('Paketler'),
    p('Sol menü → Paketler. Üstte iki sekme vardır: <b>Paketler</b> ve <b>Hizmet fiyatları</b>.'),
    p('Her paket kartında ad, aylık ve yıllık toplam, hizmetler, indirim ve kaç işletmede kullanıldığı yazar: Düzenle, Kopyala, Arşivle. Kullanılan bir paket değişirse ikinci bir onay istenir ve o paketteki bütün işletmelerin lisansları güncellenir. Hazır gelen paketler (Paketler\'den değiştirebilirsiniz):'),
    liste([
      '<b>Çay bahçesi:</b> Adisyon çekirdeği, QR menü, E-posta raporları.',
      '<b>Kafe Standart:</b> bunlara ek QR sipariş ve garson çağırma, Stok ve reçete, Uzaktan raporlar.',
      '<b>Restoran Pro:</b> bunlara ek Uzaktan yönetim, Rezervasyon ve etkinlik, Vardiya ve bahşiş, İki ekran, Gelişmiş raporlar, Sosyal medya ve QR kartları, <b>Bulutta şifreli yedek</b>.',
    ]),
    p('<b>Yeni paket</b>: adı yazın, hizmetleri seçin; aylık ve yıllık toplam sağda canlı hesaplanır. "Adisyon çekirdeği" her zaman vardır. Bir hizmet başka birini gerektiriyorsa o da eklenir (QR sipariş için QR menü). "Yakında" olanlar seçilemez. Paket indirimi tutar ya da yüzde olabilir.'),
    h2('Hizmet fiyatları'),
    p('Her hizmetin <b>Aylık</b> ve <b>Yıllık</b> kutusu vardır; yıllık boş bırakılırsa aylıktan hesaplanır. Değişen satır sarı olur ve eski → yeni fiyatı yazar; satır sonundaki simge başlangıç fiyatına döndürür. Fiyatlar KDV hariçtir. Tek bir işletmeye indirim, işletme sayfası → Hizmet → "Bu işletme için fiyat"tan verilir; "Ödeme alındı" tutarı bu fiyatla dolar.'),
    h2('Satışlarım'),
    liste(['<b>Bu ay tahsilat</b> (KDV dahil), <b>Aylık düzenli gelir</b> (yıllık planda yıllığın 12\'de biri) ve <b>Bekleyen ödemeler</b>.', 'Süzgeçler: yıl, ay, işletme. <b>Excel</b> (satışlar, aylık toplam, KDV dökümü), <b>PDF</b> ve <b>Yazdır</b> muhasebeci içindir.', 'Kayıtlar lisans uzatmadaki "Ödeme alındı"dan gelir ya da "Ödeme ekle" ile elle girilir. Her kayıt düzeltilebilir, "Ödendi" yapılabilir.', '<b>Yazılım hizmeti KDV oranı</b> (varsayılan %20) yeni kayıtlar içindir; her kayıt kendi oranını saklar.']),
  ].join('');
}

function guncellemeler() {
  return [
    bolum('Güncellemeler', 'Yeni Mola sürümünü kafelere Ayarlar → Güncellemeler\'den gönderirsiniz. Kafeler arka planda indirir; kapanışta, sabah açılışta ya da boştayken, önce yedek alarak kurar. Sorun olursa önceki sürüme kendileri döner.'),
    sekil('y-guncellemeler', { baslik: 'Ayarlar → Güncellemeler' }),
    p('Üstte durum kartı (son yüklenen ve yayındaki sürüm, işletme sayısı, güncelleme yetkisi), altında sürükleme alanı ve not kutusu, <b>Sürümler</b> listesi (yayınla, durdur, sil, not) ve <b>İşletmelerin sürümleri</b> tablosu vardır.'),
    adimlar([
      'Kaynak klasörde sürümü yükseltin ve <b>npm.cmd run installer</b> çalıştırın. "Guncelleme" klasöründe <b>.mola-guncelleme</b> dosyaları çıkar (Windows, macOS, Linux).',
      'İsterseniz işletme sahibinin göreceği kısa notu yazın.',
      'Dosyayı büyük alana <b>sürükleyip bırakın</b> (ya da "Dosya seç"). Yüklenir, denetlenir ve imzalanır; henüz hiçbir kafeye gitmez.',
      '<b>"Önce pilot işletmelere"</b> seçip bir iki kafeyi işaretleyin.',
      'Pilot kafelerde sorun yoksa <b>"Herkese yayınla"</b>.',
    ]),
    liste(['<b>Durdur:</b> henüz kurmamış kafeler bekler. Kurmuş olanlar geri alınmaz; düzeltme için daha yeni bir sürüm yayınlayın.', '<b>Sil:</b> yalnız yayında olmayan paket.', 'Tablo her işletmenin sürümünü ve durumunu gösterir (indiriliyor, kuruldu, kurulamadı, geri alındı). Kurulamayan güncelleme Bildirim merkezine düşer.', 'Kafeye elle kurduğunuz her sürümün paketini de buraya yükleyin (yayınlamadan); dosya denetimi imzalı listeyi buradan alır.']),
    not('<b>Sıra:</b> önce Mola Merkez\'i güncelleyin (Sunucu bölümü), sonra kafe sürümünü yayınlayın. Merkez güncellendikten sonra açık Mola Yönetim sekmesini <b>Ctrl+F5</b> ile yenileyin.', 'dikkat'),
  ].join('');
}

function ayarlar() {
  return [
    bolum('Ayarlar ve yedek', 'Ayarlar\'ın bölümleri üstte simgeli sekmelerdir: Hesap güvenliği, Kullanıcılar (yalnız admin), Yedek, Güncellemeler, E-posta bildirimleri, İletişim bilgileri, İşlem kayıtları, Çalışma klasörü, Geliştirici erişimi.'),
    h2('Yedek'),
    sekil('y-yedek', { baslik: 'Ayarlar → Yedek' }),
    liste([
      '<b>Merkez yedeği:</b> Merkez her gece kendi verisini şifreli yedekler; "Şimdi yedekle" her zaman çalışır. Yedek alınamazsa Bugün listesinin en üstüne düşer.',
      '<b>Merkez kurtarma kodu:</b> yedekler bu kodla açılır; kâğıda yazın. VDS\'te kod ekranda gösterilmez. Yenilemek için SSH ile: <b>sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/kurtarma-kodu.sh; sudo systemctl start mola-merkez</b>. Yeni kod ekrana yazılır, iki parçası geri sorulur; eski kod bundan sonra açmaz.',
      '<b>İkinci yedek yeri:</b> yedeklerin kopyasının gideceği ikinci klasör. Yolu yazıp "Kaydet"e basın; "Göz at" yalnız Merkez\'in çalıştığı bilgisayarda görünür.',
      '<b>Kafelerin sunucu yedekleri:</b> "Bulutta şifreli yedek" hizmetiyle gelen kopyalar. İşletme başına son yükleme, boyut ve "2 gündür yok" uyarısı, disk, saklama süresi ve kota. Sunucuda her kafenin son 3 günün ve son 2 haftanın birer kopyası durur.',
    ]),
    h2('İşletme aradı: verisine erişemiyor'),
    p('Kafelerin sunucu yedeklerini siz açamazsınız; işletmenin anahtarıyla şifrelidir. Yeni bir sunucu yedeği için işletme kendi bilgisayarında sol şerit → <b>Yedekle → Şimdi yedekle</b> der.'),
    tablo(['Durum', 'İşletme', 'Siz'], [
      ['Şifresini biliyor', 'Yeni bilgisayarda <b>İşletmem var</b> → e-posta kodu → <b>İndir ve geri yükle</b>.', 'Bir şey yapmazsınız. "Bilgiler eşleşmedi" derse sahip eski bilgisayarda Ayarlar → Yedek → İşletmem var kartında "Hazırla"ya basmalıdır. Kod gelmiyorsa e-posta ayarınıza bakın.'],
      ['Şifreyi unuttu, kurtarma kodu var', '<b>Mola Merkez\'den geri yükle</b>: taşıma kodu + kurtarma kodu.', 'Arayanı doğrulayın; Lisans → <b>Taşıma kodu ver</b>, kodu telefonda okuyun.'],
      ['Bilgisayar çalışıyor, şifreyi unuttu', 'Sol şerit → Güvenlik → <b>İşletme sahibi şifresini unuttum</b>.', 'Kurtarma kodu yoksa: Lisans → <b>Sahip şifresi sıfırlama kodu ver</b>.'],
      ['Şifre, kod ve bilgisayar yok', 'Sıfırdan kurulum.', 'Veri açılamaz. Yeni etkinleştirme kodu verin, kalan süreyi aktarın.'],
    ], 'kucuk'),
    liste([
      '<b>Arayanı doğrulamak:</b> Bilgiler\'deki yetkili adı ve telefonla karşılaştırın, o numarayı siz geri arayın; vergi numarasının son 4 hanesini ve son ödeme tarihini sorun. Şüphedeyseniz kod vermeyin.',
      '<b>İşletmem var için gerekenler:</b> Bulutta şifreli yedek hizmeti, doğrulanmış bir e-posta (başvurudaki fatura e-postası ya da sahibin kafede doğruladığı adres) ve sahibin kafede "İşletmem var hazır" yazısını görmesi. Kodla etkinleşen işletmeye kurulumda e-postasını doğrulatın.',
      'Sahip eski e-postasına ulaşamıyorsa: İşletme → Bilgiler → <b>İşletmem var</b> kartı → "Doğrulanmış adresi kaldır" (önce arayanı doğrulayın).',
      'Her başarılı İşletmem var girişinde işletmenin e-posta adreslerine "İşletmeniz yeni bir bilgisayarda açıldı" e-postası gider. En kötü durumda son yedekten sonraki satışlar kaybolur.',
    ]),
    h2('Satıcı bilgisayarı formatlanırsa'),
    p('Mola Yönetim ve Merkez VDS\'tedir; bilgisayarınız gitse de kafeler çalışır. Kaybolabilecekler:'),
    tablo(['Ne (nerede)', 'Format atılırsa', 'Önlem'], [
      ['<b>Kaynak kod ve belgeler</b><br>GitHub', 'Kaybolmaz (gönderilmemiş değişiklikler hariç)', 'Her işten sonra commit + push'],
      ['<b>Merkez yedekleri</b><br>VDS, C:\\MolaCalisma\\vds, Google Drive', 'Kaybolmaz', '<b>npm run vds:cek</b> her sabah 07:00'],
      ['<b>Kafelerin sunucu yedekleri</b><br>VDS, C:\\MolaCalisma\\vds\\kafe-yedekleri', 'VDS durdukça kaybolmaz', 'vds:cek bilgisayara çeker; Drive\'a gitmez (KVKK)'],
      ['<b>Android imza anahtarı</b><br>.local\\android-imza', '<b>Kaybolur</b>: APK aynı imzayla güncellenemez', '<b>npm run bilgisayar:yedek</b> Drive\'a kopyalar; sifre.txt şifre yöneticisinde'],
      ['<b>SSH anahtarı</b><br>%USERPROFILE%\\.ssh', '<b>Kaybolur</b>: VDS panelinin konsolundan girip yeni anahtar eklenir', 'bilgisayar:yedek (parolalı)'],
      ['<b>Claude sohbetleri</b><br>%USERPROFILE%\\.claude\\projects', '<b>Kaybolur</b>', 'bilgisayar:yedek her gün Drive\'a kopyalar. İçinde şifre olabilir: paylaşmayın'],
      ['<b>Şifreler ve kodlar</b>', 'Bilgisayarda değil', 'Şifre yöneticisi ve kasadaki zarf'],
    ], 'kucuk'),
    h2('İşlem kayıtları'),
    sekil('y-islem-kayitlari', { aciklamalar: ['Bütünlük denetimi: "Kayıtlar bütün".', 'Rapor al: PDF, Excel ya da JSONL.', 'Dönem çipleri: Tümü, Bugün, 7 gün, 30 gün, Başarısız olanlar.', '"Süzgeçler": işletme, kişi, sonuç ve tarih.'] }),
    p('Mola Yönetim\'de yapılan her işlem kim, ne zaman, nereden ve eski → yeni değerleriyle kaydedilir. Kayıtlar mühürlenir, değiştirilemez; bozulma olursa kırmızı uyarı çıkar. Satıra dokununca ayrıntı açılır. Saklama süresi varsayılan 10 yıldır; IP adresleri 1 yıl sonra silinir.'),
    h2('Diğer ayarlar'),
    liste([
      '<b>E-posta bildirimleri:</b> SMTP hesabınız (Gmail\'de "uygulama şifresi"), alıcı adresi, deneme e-postası. Şifre sıfırlama kodunuz ve İşletmem var kodları bu hesapla gider.',
      '<b>İletişim bilgileri:</b> Mola ekibinin telefonu, WhatsApp\'ı, e-postası ve çalışma saatleri. Kafelerdeki "Mola ekibine ulaşın" düğmeleri ve molayazilim.com.tr bunları gösterir (sitede en geç 1 dakikada).',
      '<b>Çalışma klasörü:</b> durum özeti ve işlem kayıtlarının günlük kopyası buraya yazılır; vds:cek bilgisayarınıza çeker.',
      '<b>Geliştirici erişimi:</b> yayınlama komutu için erişim anahtarı. Bir kez gösterilir, iptal edilebilir.',
    ]),
    sekil('y-iletisim', { baslik: 'Ayarlar → İletişim bilgileri' }),
    sekil('y-eposta', { baslik: 'Ayarlar → E-posta bildirimleri' }),
  ].join('');
}

function internetMenu() {
  return [
    bolum('İnternetten menü ve web sitesi'),
    h2('İnternetten menü'),
    p('Masa QR\'ları misafirin mobil verisinden de açılır. Menü Mola Merkez üzerinden gelir, sipariş kafenin bilgisayarına gider. Kafe Merkez\'e dışarıya doğru şifreli bir bağlantı (tünel) açık tutar; kafede port açmak ya da modem ayarı gerekmez.'),
    liste([
      'Masa QR\'ı şu adresi taşır: <b>https://menu.molayazilim.com.tr/q/&lt;menü kodu&gt;/&lt;masa kodu&gt;</b>. Menü kodu kafe etkinleşince verilir, hiç değişmez.',
      'Yeni kafede QR\'ın internet adresi 10 ile 20 dakika sonra gelir; QR\'ları bundan sonra basın.',
      'Bu adresten yalnız misafir sayfası (menü, sepet, sipariş, garson çağrısı, hesap isteği) açılır. Personel ekranları ve Mola Yönetim açılmaz.',
      'Kafe menüsünü her değişiklikten birkaç saniye sonra Merkez\'e şifreli kopya olarak gönderir (tipik 20 ile 30 MB). Kopyada satış, müşteri ya da çalışan bilgisi yoktur; siparişi her zaman kafe kabul eder.',
    ]),
    tablo(['Durum', 'Misafirin gördüğü'], [
      ['Açık, kafe bağlı', 'Menü'],
      ['Askıda, lisans bitmiş, dondurulmuş, 14 gündür bağlanmamış ya da pakette QR menü yok', '"Bu işletmenin dijital menüsü şu anda kullanılamıyor."'],
      ['Kafe bilgisayarı kapalı ya da interneti yok', 'Menü kopyadan açılır; üstte "Şu an sipariş alınamıyor, lütfen garsonunuza sorun." Kafe dönünce sipariş açılır, sepet kaybolmaz.'],
      ['Kafe bağlı ama QR siparişleri kapalı', 'Menü; üstte "Şu an sipariş almıyoruz, lütfen garsonunuza sorun."'],
      ['Bilinmeyen kod', '"Bu bağlantı bulunamadı. Masanızdaki QR kodunu yeniden okutun."'],
    ], 'kucuk'),
    not('Sunucuda <b>MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr</b> ve <b>MERKEZ_SITE_ORIGIN=https://molayazilim.com.tr</b> ayarlı olmalıdır (/etc/mola-merkez/ayarlar.env). Toplu QR basımından önce bir pilot kafede Ayarlar → Masalar ve QR\'da "QR kodları internet adresini taşır · Bağlı" yazısını görün, bir masa kartını Wi-Fi\'si kapalı bir telefonla okutun ve deneme siparişinin mutfağa düştüğünü kontrol edin.', 'dikkat'),
    p('<b>Saklama süreleri:</b> kapanan destek görüşmeleri son mesajdan 2 yıl, reddedilen başvurular 1 yıl, web sitesi talepleri kapandıktan 2 yıl sonra silinir. Merkez misafir trafiğini saklamaz; yalnız kafe başına sayaç tutar.'),
    h2('Web sitesi'),
    p('molayazilim.com.tr düz HTML sayfalarıdır: Ana sayfa, Özellikler, Uygulamayı indir, Destek ve İletişim, KVKK, Gizlilik, Çerez. Çerez ya da analiz aracı yoktur; fiyat yazmaz. Telefon, WhatsApp, e-posta ve çalışma saatleri Ayarlar → <b>İletişim bilgileri</b>\'nden gelir; siteyi yeniden yüklemek gerekmez.'),
    sekil('w-iletisim', { baslik: 'Destek ve İletişim sayfası ve form' }),
    p('Form talepleri Başvurular → Web sitesi talepleri\'ne düşer. Formda e-posta zorunludur; adres başına saatte 5, günde toplam 200 talep alınır. Yasal sayfalar <b>taslaktır</b> (sarı şerit); avukat onayından sonra config.json\'da legalDraft kapatılır.'),
    h3('Siteyi yayınlamak'),
    adimlar(['Adresi ve yedek iletişim bilgilerini <b>site/config.json</b>\'a yazın (Merkez\'e ulaşılamazsa bunlar görünür).', '<b>npm.cmd run site:build</b> ile site/dist klasörünü üretin.', 'site/dist içeriğini sunucuda /var/www/molayazilim klasörüne yükleyin. Caddy\'yi yeniden başlatmak gerekmez.']),
    h3('Uygulamayı indir (/indir/)'),
    p('Windows ve Android personel uygulaması (APK) açık, Mac ve Linux "Yakında". Sayfa kurulum adımlarını ve SmartScreen notunu ("Ek bilgi → Yine de çalıştır") gösterir.'),
    adimlar(['Kafe paketini VDS adresiyle hazırlayın (MOLA_MERKEZ_URL ile <b>npm.cmd run installer</b>).', '<b>npm.cmd run site:indir</b>: dosyaları site/dist/indir\'e alır, boyut ve SHA-256\'yı config.json\'a yazar.', 'config.json\'da <b>downloads.enabled: true</b>, sonra <b>npm.cmd run site:build</b> ve yükleme.']),
  ].join('');
}

function operasyon() {
  return [
    bolum('Sunucu (VDS) ve düzenli kontroller', 'Adım adım kurulum docs/VDS_KURULUM.md\'dedir; burada günlük işler özetlenir.'),
    h2('Alan adı: molayazilim.com.tr'),
    tablo(['Adres', 'Ne'], [
      ['https://molayazilim.com.tr', 'Web sitesi (www buraya yönlenir)'],
      ['https://molayazilim.com.tr/api/site/*', 'İletişim formu → Mola Merkez'],
      ['https://molayazilim.com.tr/s/*', 'Sosyal medya QR kısa adresleri'],
      ['https://menu.molayazilim.com.tr/q/*', 'İnternetten menü (masa QR\'ları)'],
      ['https://merkez.molayazilim.com.tr', 'Mola Merkez, Mola Yönetim ve kafelerin bağlantıları'],
    ]),
    liste([
      'Alan adı Metunic\'te, DNS ücretsiz <b>Cloudflare</b>\'de. Dört A kaydı (<b>@, www, merkez, menu</b>) sunucu IP\'sine gider ve hepsi <b>DNS only (gri bulut)</b>. Turuncu bulut (proxy) kullanmayın.',
      'Mola Yönetim yalnız <b>https://merkez.molayazilim.com.tr</b> adresinden kullanılır (Edge\'de "uygulama olarak yükle").',
      'Alan adının yenileme tarihini takvime yazın, otomatik yenilemeyi açın. Alan adı düşerse QR\'lar, lisans bağlantısı ve site birlikte durur.',
    ]),
    h2('VDS (İstanbul)'),
    p('Keyubu/Datacasa VDS L-TR 6GB, Ubuntu 24.04, 170 GB disk. Yalnız 22, 80 ve 443 açıktır. Mola Merkez bir systemd servisidir; Caddy HTTPS sertifikasını kendisi alır ve yeniler.'),
    tablo(['Neye bakın', 'Nasıl', 'Ne sıklıkla'], [
      ['Merkez çalışıyor mu', 'Ücretsiz bir "uptime" hizmetine https://merkez.molayazilim.com.tr/api/merkez/v1/health adresini ekleyin.', 'Sürekli'],
      ['Genel durum', 'Windows\'ta <b>npm run vds -- ozet</b> (Merkez, Caddy, disk, son yedek, sertifika)', 'Haftalık'],
      ['Disk', 'df -h; yüzde 80\'i geçmesin', 'Haftalık'],
      ['Kayıtlar', 'journalctl -u mola-merkez --since today', 'Sorun olunca'],
      ['Sunucu güncellemeleri', 'sudo apt update && sudo apt -y upgrade; gerekirse yeniden başlatın (Merkez kendiliğinden başlar)', 'Aylık'],
    ], 'kucuk'),
    h2('Mola Merkez\'i güncellemek'),
    adimlar([
      'Mola Yönetim → Ayarlar → Yedek → <b>Şimdi yedekle</b>.',
      'Windows\'ta <b>npm.cmd run merkez:linux-paket</b> ile Linux Merkez paketini hazırlayın ve sunucuya kopyalayın.',
      'Sunucuda: <b>tar xzf Mola-Merkez-Linux-x64-&lt;sürüm&gt;.tar.gz && cd mola-merkez && sudo ./kur.sh</b>. Veri ve ayarlara dokunulmaz.',
      '<b>npm run vds -- durum</b>: sağlık yanıtında yeni sürüm görünmeli.',
      'Açık Mola Yönetim sekmesini <b>Ctrl+F5</b> ile yenileyin.',
    ]),
    p('Sorun olursa önceki sürüme dönmek: <b>sudo systemctl stop mola-merkez && sudo rm -rf /opt/mola-merkez && sudo mv /opt/mola-merkez.eski /opt/mola-merkez && sudo systemctl start mola-merkez</b>.'),
    h2('Merkez yedeğini bilgisayarınıza çekin'),
    liste([
      '<b>npm run vds:cek</b> her gün 07:00\'de yedekleri C:\\MolaCalisma\\vds\'ye ve Google Drive\'a çeker (VDS_KURULUM.md bölüm 15). Yedekler Merkez kurtarma koduyla açılır.',
      '<b>Ayda bir geri yükleme provası</b> (5 dakika): en yeni yedeği <b>npm.cmd run merkez:restore</b> ile ayrı bir klasöre açın; "Geri yüklendi ve doğrulandı: N işletme" yazmalı. Sonra prova klasörünü silin.',
    ]),
    h2('Kontrol listesi'),
    tablo(['Sıklık', 'İş'], [
      ['Her gün', 'Bugün listesi ve Bildirim merkezi; destek ve web sitesi talepleri.'],
      ['Haftalık', 'npm run vds -- ozet; vds:cek günlüğünde bugünün yedeği; bağlanmayan kafeler.'],
      ['Aylık', 'Geri yükleme provası; sunucu güncellemeleri; bekleyen ödemeler; biten lisanslar.'],
      ['Her yeni sürümde', 'Önce Merkez, sonra güncelleme paketi; önce pilot, sonra herkese.'],
      ['Yılda bir', 'Alan adı ve VDS yenilemesi; Merkez kurtarma kodu yerinde mi.'],
    ]),
    h2('Sık sorulanlar'),
    sss('Kafe "Mola Merkez\'e ulaşılamıyor" diyor.', 'Kafe nedeni söyler: internet yok, Merkez yanıt vermiyor, adres yanlış ya da bilgisayarın saati yanlış. Merkez\'in sağlık adresine bakın; sorun kafedeyse internetini ve saatini kontrol ettirin. Kafe 14 güne kadar Merkez\'siz çalışır.'),
    sss('Kafe yeni bilgisayara geçiyor.', 'Çoğu zaman size iş düşmez: sahip yeni bilgisayarda <b>İşletmem var</b> ile girer (bkz. "İşletme aradı" tablosu). "İki farklı bilgisayar" uyarısı çıkarsa işletme Özet\'inden "Eski bilgisayarı yeniden etkinleştir" ile çözersiniz.'),
    sss('Etkinleştirmede "kod geçersiz" diyor.', 'Kafe başka bir Merkez adresiyle hazırlanmış paketle kurulmuş. Mola\'yı "Verileri ve yedekleri de sil" işaretli kaldırın, sitedeki paketle (Uygulamayı indir) yeniden kurun.'),
    sss('Merkez başka bir sunucuya taşınacak.', 'Kafeler yeni adresi imzalı bir duyuruyla öğrenir. Adımlar: docs/VDS_KURULUM.md "Kafeleri yeni adrese geçirin".'),
  ].join('');
}

export function yonetimKilavuzu(): Belge {
  return {
    dosya: 'Mola-Yonetim-Kilavuzu.pdf', baslik: 'Mola Yönetim Kılavuzu', altBaslik: 'Satıcı için: lisanslar, paketler, destek, güncellemeler ve sunucu', kisa: 'Mola Yönetim Kılavuzu', tocDerinlik: 2,
    kapakNotu: '<p><b>Yalnız Merkut Studios içindir.</b> Bu kılavuz kafelere verilmez.</p><p>Mola Yönetim\'in sayfaları, adım onayı isteyen işlemler ve sunucunun düzenli bakımı. Ekranlar örnek işletmelerle alınmıştır.</p>',
    icerik: [giris(), isletmeler(), basvurular(), paketler(), guncellemeler(), ayarlar(), internetMenu(), operasyon()].join(''),
  };
}

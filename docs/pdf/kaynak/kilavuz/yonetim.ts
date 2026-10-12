/*
 * Mola Yönetim Kılavuzu: yalnız satıcı (Merkut Studios) için. Kafelere verilmez. Metinde uzun tire kullanılmaz.
 */
import type { Belge } from './sablon.ts';
import { adimlar, bolum, h2, h3, liste, not, p, sekil, sss, tablo } from './sablon.ts';

function giris() {
  return [
    bolum('Mola Yönetim nedir?', 'Mola Yönetim, Mola Merkez sunucusunun yönetim ekranıdır. Bütün kafelerin lisansını, paketini, desteğini, duyurularını ve güncellemelerini buradan yönetirsiniz.'),
    tablo(['', 'Kafe (işletmenin bilgisayarı)', 'Mola Merkez (sizin sunucunuz)'], [
      ['Ne çalışır', 'Sipariş, kasa, mutfak, menü, raporlar, yedek, yazıcı', 'Mola Yönetim, lisans imzalama, etkinleştirme, destek, duyuru, güncelleme'],
      ['Veri', 'Bütün işletme verisi, şifreli', 'İşletme kayıtları, lisanslar, destek talepleri, işlem kayıtları'],
      ['Bağlantı', 'Merkez\'e yalnız dışarıya doğru bağlanır', 'Kafeye hiç bağlanmaz, yalnız yanıt verir'],
    ]),
    not('<b>Satış verisi Merkez\'e gelmez.</b> Kafelerin satışları, müşterileri ve raporları kafenin bilgisayarında kalır. Merkez yalnız sayılar (masa, ürün, çalışan sayısı), sürüm, yedek durumu ve destek mesajlarını görür. Kafelerin bulut yedekleri Merkez\'de şifreli durur; Merkez onları açamaz.', 'bilgi'),
    h2('Giriş ve iki adımlı doğrulama'),
    p('Mola Yönetim tek bir yönetici hesabıyla açılır: şifre ve <b>Authenticator</b> (telefonunuzdaki doğrulama uygulaması) kodu.'),
    sekil('y-giris', { genislik: 560, aciklamalar: ['Şifre.'] }),
    sekil('y-giris-kod', { genislik: 560, aciklamalar: ['Authenticator kodu ya da kurtarma kodlarınızdan biri.'] }),
    p('Ayarlar → <b>Hesap güvenliği</b> üç karttır: <b>Yönetici şifresi</b>, <b>İki adımlı giriş</b> (Açık/Kapalı çipi) ve <b>Kurtarma kodları</b> (kaç kod kaldığı). İki adımlı girişi açarken kurulum tek geniş kartta üç adımdır: QR kodu okutun, kurtarma kodlarını kâğıda yazın, ilk kodu doğrulayın. Şifrenizi unutursanız Merkez\'in bilgisayarından ya da e-postanıza gelen kodla yenisini belirlersiniz.'),
    sekil('y-hesap-guvenligi'),
    h2('Adım onayı (Authenticator ile)'),
    p('Bazı işlemler para ya da bütün kafeleri etkilediği için girişten sonra bir kez daha <b>güncel Authenticator kodunu</b> ister. Doğru kod 10 dakikalık bir "yetki penceresi" açar; bu sürede ikinci kez sorulmaz.'),
    sekil('y-adim-onayi', { genislik: 380, yan: true, aciklamalar: ['Doğrulayıcı kodu (6 hane).', '"Onayla ve devam et".'] }),
    tablo(['Adım onayı isteyenler', 'İstemeyenler'], [[
      'Hizmet fiyatları ve yazılım KDV oranı<br>Paket oluşturma, düzenleme, kopyalama, arşivleme<br>İşletmenin hizmetini değiştirme ("Değişikliği uygula")<br>Lisans uzatmada "Ödeme alındı"<br>Satışlarım: ekleme, düzeltme, "Ödendi"<br>Duyuru gönderme, düzenleme, geri çekme<br>Güncelleme yükleme, yayınlama, durdurma, silme, not düzenleme',
      'Ödemesiz lisans uzatma<br>Askıya alma ve hizmeti açma<br>Destek yanıtı ve "Yeni mesaj"<br>Başvuru onayı ve reddi',
    ]]),
    not('İki adımlı doğrulama kapalıysa bu işlemler hiç yapılamaz: "Fiyat, paket ve ödeme değişiklikleri için önce iki adımlı doğrulamayı açın" denir. Kutudaki <b>"İki adımlı doğrulamayı aç"</b> sizi doğrudan Ayarlar → Hesap güvenliği\'ne götürür: kart en üstte, bekleyen işlemin adı yazılı, şifre kutusu hazırdır. Kurulumu bitirip yeniden giriş yapınca Mola Yönetim sizi kaldığınız yere (örneğin işletmenin Hizmet sekmesine, seçtiğiniz paketle) geri getirir; "Kaldığım yere dön" kurmadan geri döner.', 'dikkat'),
    sekil('y-guncelleme-yetkisi', { genislik: 520, baslik: 'Yetki penceresi açıkken: bitiş saati ve "Yetkiyi kapat"' }),
  ].join('');
}

function bugun() {
  return [
    bolum('Bugün ve Bildirim merkezi', 'Mola Yönetim her açılışta "Bugün" sayfasıyla başlar: yapılacaklar en acilden başlayarak, her satır bir cümle ve bir düğme.'),
    sekil('y-bugun', { aciklamalar: ['Sol menü: Bugün, İşletmeler, Başvurular, Destek, Duyurular, Satışlarım; altta Ayarlar.', '"Bugün yapılacaklar" listesi.', 'Zil: Bildirim merkezi (okunmamış olay sayısı).'] }),
    p('Listede sırasıyla şunlar çıkar: Merkez yedeği alınamadı, süresi biten ya da 7 gün içinde bitecek lisans, yanıt bekleyen destek talebi, onay bekleyen başvuru ve web sitesi talebi, dondurma isteği, iki farklı bilgisayar uyarısı, 3 günden uzun bağlanmayan işletme, yedeği başarısız işletme, dosyaları değişmiş kurulum, gönderilemeyen e-posta. Liste boşsa "Her şey yolunda" yazar.'),
    sekil('y-bildirim-merkezi', { baslik: 'Bildirim merkezi' }),
    p('Bildirim merkezi olayların kaydıdır: yeni başvuru, yeni destek mesajı, biten lisans, yedek sorunu, güncelleme kurulamadı, dosyalar değiştirilmiş, web sitesi talebi. Her olay bir karttır: solda türünün simgesi (başvuru, destek, lisans, yedek, bağlantı, güvenlik, web talebi…), başlık ve "Yeni" etiketi, altında tür, <b>Önemli</b> ya da <b>Düşük öncelik</b> çipi, işletmenin adı ve "3 saat önce" gibi zaman. Sağdaki düğme ilgili yeri açar ("İşletmeyi aç", "Talebi aç", "Talepleri aç", "Başvuruyu aç"); yanındaki küçük zarf simgesi okundu / okunmadı yapar. Süzgeçler: <b>Tümü, Okunmamış, Önemli</b> (yedek, bağlantı, güvenlik, lisans sorunları). "Tümünü okundu işaretle" üsttedir; yanındaki dişli E-posta bildirimleri ayarını açar. Ayarlar → E-posta bildirimleri açıksa önemli olaylar e-postanıza da gelir.'),
  ].join('');
}

function isletmeler() {
  return [
    bolum('İşletmeler', 'Her kafe büyük bir kutu olarak görünür. Bir kutuya dokununca işletmenin sayfası açılır.'),
    sekil('y-isletmeler', { aciklamalar: ['Arama: ad (işletme sahibi adı değiştirdiyse önceki adı da; kutuda "Önceki adı: …" yazar), telefon, e-posta, vergi no, yetkili.', 'İşletme kutusu: ad, il, tür, durum çipi, plan, sürüm, son bağlantı.', '"CSV indir": listede görüneni Excel\'e alır.'] }),
    p('Çipler: Tümü, Çalışıyor, Deneme, Bitiyor, Bağlantı yok, Askıda. Seyrek durumlar "Diğer durumlar" altındadır (kod bekleniyor, kurulum bekliyor, süresi doldu, yedek sorunu). Yeni bir işletmeyi "İşletme ekle" ile açar, etkinleştirme kodunu bir kez görürsünüz (14 gün geçerli, tek kullanımlık).'),
    p('Kod Mola Yönetim\'e girilmez; <b>kafenin bilgisayarındaki Mola\'ya</b> girilir: 1) kafenin bilgisayarına Mola\'yı kurun, 2) ilk açılışta "Mola\'yı etkinleştir" ekranında <b>"Etkinleştirme kodum var"</b>ı seçin, 3) kodu yazıp "Etkinleştir"e basın (büyük/küçük harf fark etmez). Kod penceresinde <b>Kodu kopyala</b>, <b>Yazdır</b> ve <b>WhatsApp ile gönder</b> (işletmenin telefonu biliniyorsa doğrudan ona) düğmeleri vardır. Kod beklenirken işletme kutusu ve Lisans sekmesi aynı adımları gösterir; kod kaybolursa Lisans\'tan "Yeni kod oluştur".'),
    not('Bir bilgisayardaki Mola tek bir işletmeye bağlanır; etkinleştirilmiş bir bilgisayarda "Mola\'yı etkinleştir" ekranı bir daha çıkmaz. İkinci bir işletmeyi denemek için başka bir bilgisayar kullanın ya da Mola\'yı "Verileri ve yedekleri de sil" işaretli kaldırıp yeniden kurun (o bilgisayardaki önceki işletmenin verileri silinir). Yalnız kaldırıp kurmak yetmez: veriler kalır, Mola aynı işletmeyle açılır.', 'dikkat'),
    h2('İşletme sayfası'),
    p('Sayfanın beş sekmesi vardır: <b>Özet, Lisans, Hizmet, Bilgiler, Destek</b>. Başlıkta durum çipi ve kafenin Mola sürümü yazar. Her sekme kartlardan oluşur: pastel simge, kısa başlık; açıklamalar kartın sağ üstündeki gri <b>ⓘ</b>\'dedir.'),
    sekil('y-isletme-ozet', { aciklamalar: ['Sekmeler: Özet, Lisans, Hizmet, Bilgiler, Destek.', 'Kare göstergeler; küçük ok ilgili sekmeyi açar (burada Lisans).', '"QR siparişleri": müşteriler şu anda telefondan sipariş verebiliyor mu, veremiyorsa neden.', '"İnternetten menü": kafenin tüneli bağlı mı.'] }),
    p('<b>Özet:</b> en üstte 12 kare gösterge: Durum, Lisans bitişi, Paket, Son bağlantı, <b>QR siparişleri</b>, İnternetten menü, Bilgisayarlar, Sürüm (dosya denetimi), Son yedek, İkinci yedek, Sunucu yedeği ve Sözleşme. Altında <b>Sıradaki işler</b>, yan yana <b>Satıcı notu</b> (yalnız siz görürsünüz) ve <b>Bilgisayarlar</b>, sunucu yedeği, kurulum ilerlemesi ve açılır <b>Diğer bilgiler</b> kartı (kurulum, masa · çalışan · ürün sayısı, ilk giriş, İnternetten menü sayaçları, Menünün kopyası).'),
    p('<b>QR siparişleri</b> kutusu kafenin o anki durumunu söyler: <b>Açık</b>; <b>Kapalı · personel ekranı bağlı değil</b> (kafede siparişi görecek mutfak, garson ya da kasa ekranı açık değil); <b>Kapalı · gün sonu yapıldı</b> (kasiyer "Aç" diyene, kasa açılana ya da sabah 05:00\'e kadar); <b>Kapalı · elle durduruldu</b> (biri "QR siparişlerini durdur" dedi); <b>Kapalı · kafe bilgisayarı bağlı değil</b> (menü Merkez\'deki kopyadan görünür, sipariş alınmaz). Bir kafe "müşteri sipariş veremiyor" diye ararsa önce buraya bakın.'),
    sekil('y-internet-menu', { genislik: 600, baslik: 'Özet → Diğer bilgiler', aciklamalar: ['"İnternetten menü" satırı: "Bağlı · N istek", "Kafe bilgisayarı bağlı değil", "Kapalı (lisans ya da paket)" ya da "Henüz yok (işletmenin Mola sürümü eski)".', '"Menünün kopyası": Merkez\'deki kopyanın en son ne zaman geldiği, kaç ürün ve fotoğraf, ne kadar yer kapladığı.'] }),
    h2('Lisans: deneme, uzatma, plan, askı, dondurma'),
    p('Lisans sekmesinin kartları: <b>Lisans süresi</b> (kalan gün halkası, plan ve son değişikliğin kafeye ulaşıp ulaşmadığı), <b>Süreyi uzat</b> ve <b>Ödeme alındı</b>, <b>Abonelik planı</b>; yan yana <b>Hizmeti dondurma</b>, <b>Lisans sözleşmesi</b> ve <b>Program dosyaları</b>; <b>Sahip şifresi sıfırlama</b> ve <b>Yeni bilgisayara taşıma</b>; en altta pastel kırmızı <b>Dikkat</b> kartı.'),
    sekil('y-isletme-lisans', { aciklamalar: ['"Ödeme alındı": uzatmayla birlikte Satışlarım\'a kayıt düşer (tutar, KDV, yöntem, fatura no, durum).', 'Süreyi uzat: 1 ay, 6 ay, 1 yıl. "Emin misiniz?" diye sorar.', 'Abonelik planı: aylık, 6 aylık, yıllık. Plan değişince bitiş tarihi değişmez.'] }),
    liste([
      '<b>Deneme:</b> Başvurular\'dan "30 günlük denemeyi başlat" ile başlar. Denemede bütün hizmetler açıktır. Denemedeyken uzatma düğmeleri "… aboneliğe geçir" olur.',
      '<b>Uzatma</b> yalnız süre ekler; plan ve dondurma hakkı değişmez. Bitiş tarihine (bitmişse bugüne) eklenir. Değişiklik kafeye en geç 10 dakikada ulaşır.',
      '<b>Ödeme alındı</b> varsayılan açıktır; tutar işletmenin paket fiyatı × süreyle önceden dolu gelir. Ödemesiz uzatmak için kapatın.',
      '<b>Askıya al:</b> bir neden yazılır (yalnız siz görürsünüz). Askıdaki kafede menü ve yeni sipariş kapanır, internetten QR menü hemen "kullanılamıyor" der. "Hizmeti aç" geri açar.',
      '<b>Dondurma:</b> yıllık abonelikte 12 ayda bir, en fazla 60 gün. Kafenin isteği Bugün listesine düşer; onaylarsınız. Süre korunur.',
    ]),
    sekil('y-isletme-lisans-2', { aciklamalar: ['Hizmeti dondurma.', 'Lisans sözleşmesi: hangi sürümü, ne zaman, kim kabul etti (ya da "Henüz kabul edilmedi").', 'Sahip şifresi sıfırlama kodu (30 dakika, tek kullanımlık).', '"Dikkat" kutusu: askıya al ve kaydı sil.'] }),
    not('<b>Sahip şifresi kodu</b> yalnız arayanın gerçekten işletme sahibi olduğunu doğruladıktan sonra verilir. Satıcı sahibin şifresini kendisi göremez ve belirleyemez; şifreyi sahip kafede yazar.', 'dikkat'),
    p('<b>Kaydı sil:</b> hiç bağlanmamış kayıt (yarım başvuru, kullanılmamış kod) doğrudan silinir. Bağlanmış bir işletme ancak askıdayken ve adı yeniden yazılarak silinir; kafedeki Mola kalıcı olarak kilitlenir. Geri alınamaz.'),
    h2('Hizmet: paket, Özel ve işletmeye özel indirim'),
    sekil('y-isletme-hizmet', { aciklamalar: ['Hizmet durumu: deneme mi, hangi hizmetler açık.', 'Paket seçimi: Çay bahçesi, Kafe Standart, Restoran Pro ve sizin paketleriniz.', '"Özel": hizmetleri tek tek seçersiniz.', 'Bu işletme için fiyat ve işletmeye özel indirim (₺ ya da %).'] }),
    p('Paket ya da hizmet değişince ekranın altında bir <b>değişiklik çubuğu</b> belirir ve sayfayı kaydırırken de yerinde kalır: "3 hizmet değişti · ₺2.500 → ₺975/ay", <b>Vazgeç</b> ve <b>Değişikliği uygula</b>. "Neler değişiyor" eklenen ve çıkan hizmetleri, indirimi ve aylık farkı açar. "Değişikliği uygula" doğrudan doğrulayıcı kodunu ister ("Emin misiniz?" sorulmaz). Kafe yeni lisansı en geç 10 dakikada alır; kapanan hizmetin verisi silinmez, sahip onu soluk ve "Pakette yok" olarak görür.'),
    sekil('y-hizmet-degisiklik', { genislik: 600, aciklamalar: ['Değişiklik çubuğu (sayfa kayarken altta kalır): kaç hizmet değişti, paket (burada Kafe Standart) ve eski → yeni aylık fiyat; "Neler değişiyor" ayrıntıyı açar.', '"Değişikliği uygula".'] }),
    p('Sayfanın altında <b>Tanıtım işletmesi</b> anahtarı vardır: satış sunumu yaptığınız bir kafeyi işaretler, ekranlarına "Tanıtım" etiketi koyar ve "Tanıtımı sıfırla" ile örnek veriye döndürmenizi sağlar. Sıfırlama yalnız elle yapılır, kafeye kalp atışıyla (en geç 10 dakika) ulaşır; masa QR\'ları değişmez.'),
    h2('Bilgiler'),
    sekil('y-isletme-bilgiler', { aciklamalar: ['İletişim: yetkili, telefon (ara simgesi), e-posta (yaz simgesi); her satırda kopyala. Yanında Adres.', 'Fatura bilgileri: unvan, vergi dairesi ve no, adres, yetkili, telefon, e-posta; her satırda kopyala, "Düzenle" ile düzeltirsiniz.'] }),
    p('Altında <b>Sosyal medya</b> ile <b>Cihaz ve kurulum</b> (Mola sürümü, bilgisayar, kurulum no, etkinleştirme, kurulum, ilk giriş, son bağlantı, masa · çalışan · ürün sayısı) yan yanadır. "Olası tekrar" kartı aynı vergi numarası, aynı bilgisayar, aynı telefon ya da e-postayla açılmış diğer kayıtları nedeniyle listeler. En altta "Bu işletmenin geçmişi".'),
    sekil('y-isletme-sosyal', { aciklamalar: ['Kafenin sosyal medya bağlantıları (salt okunur, simgeli). Kalıcı QR kartları bunların kısa adresini taşır.', 'Cihaz ve kurulum.'] }),
    h3('Sosyal medya kısa adresleri'),
    p('Kafelerin "Bizi takip edin" QR kartları bağlantının kendisini değil, Merkez\'deki kısa adresi taşır: <b>molayazilim.com.tr/s/&lt;kod&gt;/instagram</b>. Kod asla değişmez; sahip bağlantısını değiştirirse basılı kart yenisini açar. İşletme askıya alınırsa ya da paketinde "Sosyal medya ve QR kartları" yoksa kısa adres "Bu işletmenin bu hizmeti şu anda kullanılamıyor" sayfasını gösterir; hizmet açılınca kartlar yeniden basılmadan çalışır.'),
    h2('Destek sekmesi ve "Yeni mesaj"'),
    p('Destek sekmesinde işletmenin talepleri ana Destek sayfasındaki gibi sohbet olarak açılır ve yerinde yanıtlanır. Kartın başlığında açık talep çipi, "Destek sayfasında aç" simgesi ve <b>Yeni mesaj</b>; altında yetkilinin telefon ve e-posta çipleri. <b>Uzaktan destek</b> ve <b>Hata kayıtları</b> ayrı kartlardır.'),
    sekil('y-isletme-destek', { aciklamalar: ['"Yeni mesaj": bu işletmeyle siz bir görüşme başlatırsınız.'] }),
    sekil('y-yeni-mesaj', { genislik: 440, yan: true, baslik: 'Konu, mesaj ve en çok 5 ek' }),
    p('Aynı sekmede <b>Uzaktan destek</b> vardır: sahip izin verdiyse "Kafeye bağlan" yeni sekmede kafenin ekranlarını açar. Satış raporlarını, ödemeleri, kasa kapanışlarını, çalışan şifrelerini ve misafir telefonlarını göremezsiniz; menü, masalar, yazıcı ve görünüm ayarlarına yardım edersiniz. Her bağlantı ve yapılan her değişiklik iki tarafta da kayıtlıdır. "Bağlantıyı kes" oturumu bitirir.'),
    h2('Dosya bütünlüğü uyarısı'),
    sekil('y-dosya-degisti', { baslik: 'Bir kafenin program dosyaları değişmişse' }),
    p('Kurulu kafeler program dosyalarını günde bir kez, imzalı listeyle karşılaştırır. Biri lisans denetimini çıkarmak için dosyayı değiştirirse işletme kutusunda <b>"Dosyalar değiştirilmiş"</b> çipi, Bugün\'de bir satır ve Bildirim merkezinde bir olay çıkar; Lisans sekmesinde hangi dosyaların değiştiği yazar. Kafe hiçbir durumda durdurulmaz; ne yapacağınıza siz karar verirsiniz: arayın, yeniden kurdurun, gerekirse askıya alın. Virüs programının karantinaya aldığı dosya "eksik" görünebilir.'),
    not('Bu denetimin çalışması için <b>kafelere kurduğunuz her sürümün güncelleme paketini Mola Yönetim\'e yükleyin</b> (yayınlamanız gerekmez). Yüklenmemiş sürümde kafe "denetlenemedi" kalır ve uyarı vermez.', 'dikkat'),
  ].join('');
}

function basvurular() {
  return [
    bolum('Başvurular ve Destek'),
    h2('Hesap açma başvuruları'),
    p('Yeni bir kafe Mola\'yı kurup "Kodum yok, başvuru yapacağım" ile hesap açma başvurusunu doldurunca burada görünür (zilde "Yeni hesap açma başvurusu"): işletme adı ve türü, fatura bilgileri, yetkili, telefon, e-posta.'),
    sekil('y-basvurular', { aciklamalar: ['"30 günlük denemeyi başlat": kafe birkaç saniyede açılır.', '"Reddet": kısa bir neden yazın; sahip düzeltip yeniden gönderir.'] }),
    liste(['Aynı vergi numarası daha önce kullanıldıysa başvuru işaretlenir. Başvurana bu söylenmez. "Ek şube olarak kabul et" ya da "Reddet" seçersiniz.', 'Reddedilenler alttaki "Düzeltme bekleyenler" bölümündedir.', 'Kendi kendine deneme yoktur: her deneme sizin onayınızla başlar.']),
    h2('Web sitesi talepleri'),
    p('molayazilim.com.tr\'deki iletişim formundan gelen talepler aynı sayfada, "Web sitesi talepleri" çipinin altındadır. Menüdeki rozet bekleyen başvurularla yeni talepleri birlikte sayar.'),
    sekil('y-web-talepleri', { aciklamalar: ['Web sitesi talepleri.', '"Arandı": aradığınızı işaretleyin.', '"İşletme ekle": talepten doğrudan işletme kaydı açılır.'] }),
    p('Taleplerde not ekleyebilir, kapatıp yeniden açabilir, e-posta gönderebilirsiniz. "Sil", kişinin KVKK silme isteği içindir. Formdan gelen kişinin onay zamanı ve aydınlatma metninin sürümü saklanır.'),
    h2('Destek'),
    sekil('y-destek', { baslik: 'Bütün kafelerin talepleri: Açık / Yanıt bekleniyor / Kapandı' }),
    p('Kafeden gelen talepler sohbet gibi görünür. Fotoğraf ve PDF eklenebilir (dosya başına 10 MB, mesaj başına 5); ekler 14 gün sonra silinir. Talebi yalnız Mola ekibi kapatır. Talebin başlığında ve listede <b>işletme adına</b> dokununca kısa bir özet açılır: durum çipi, paket ve dahil hizmet sayısı, lisans ve kalan gün / bitiş tarihi, deneme, son bağlantı, QR siparişleri, açık talep sayısı, telefon ve e-posta (kopyalanabilir); "İşletme sayfası", "Hizmet" ve "Lisans" düğmeleri o sekmeyi açar. Esc ya da dışarı dokunmak kapatır; telefonda alttan açılır. "Hata takip kodunu sorgula" ile kafenin ekranındaki koda ait hata kaydını bulursunuz.'),
  ].join('');
}

function duyurular() {
  return [
    bolum('Duyurular', 'Bütün kafelere, bir paketteki kafelere ya da seçtiğiniz kafelere duyuru gönderirsiniz.'),
    sekil('y-duyuru-yaz', { aciklamalar: ['Başlık ve metin. Bağlantılar tıklanır olur.', 'Hedef: Tüm işletmeler, bir paketteki işletmeler ya da seçili işletmeler.', '"Önemli": sahip girişte ortada bir pencereyle görür.', 'Önizleme: kafenin göreceği kart.'] }),
    liste(['Gönder, düzenle ve geri çek adım onayı ister.', 'Hedef gönderildiği anda sabitlenir; sonradan katılan kafe eski duyuruyu görmez.', 'Teslim kalp atışıyla olur (en geç 10 dakika). İnterneti olmayan kafe bağlanınca alır.', 'Kafede duyuruyu işletme sahibi ve Müdür görür; kasiyer, garson ve mutfak görmez.', '<b>E-posta kopyası:</b> e-posta bildirimleri ayarlıysa "E-postayla da gönder" seçeneği çıkar; her işletmenin fatura e-postasına bir kopya gider.']),
    sekil('y-duyurular', { aciklamalar: ['Duyuru satırı: tarih, hedef, Önemli çipi ve "Okuyan: X/Y".'] }),
    sekil('y-duyuru-okuma', { genislik: 600, baslik: 'Bir duyuruyu açınca: kimler okudu, kimler henüz okumadı' }),
    p('<b>Okundu takibi:</b> bir duyuruyu açınca "Henüz okumayanlar", "Okudu, Okudum demedi" (Önemli\'de) ve "Okuyanlar" listeleri ve saatleri görünür. Önemli duyuruda sahip "Okudum" der. "Geri çek" duyuruyu kafelerden kaldırır.'),
  ].join('');
}

function paketler() {
  return [
    bolum('Paketler, fiyatlar ve Satışlarım'),
    h2('Paketler'),
    sekil('y-paketler', { baslik: 'Ayarlar → Paketler' }),
    p('Her paket kartında ad, aylık ve yıllık toplam, hizmetler, indirim ve kaç işletmede kullanıldığı yazar. Düzenle, Kopyala, Arşivle. Kullanılan bir paket değişirse ikinci bir onay istenir ve o paketteki bütün işletmelerin lisansları güncellenir. "Eski planlar" eski "Tam sistem" ve "Sadece QR menü" kayıtlarıdır.'),
    sekil('y-paket-olustur', { aciklamalar: ['Paket adı.', 'Canlı aylık ve yıllık toplam.'] }),
    p('Yeni paket oluştururken hizmetler gruplara ayrılır. "Adisyon çekirdeği" her pakette vardır, çıkarılamaz. Bir hizmet başka bir hizmeti gerektiriyorsa kendiliğinden eklenir (QR sipariş için QR menü). "Yakında" olanlar seçilemez. Paket indirimi tutar ya da yüzde olabilir.'),
    h2('Hizmet fiyatları'),
    sekil('y-hizmet-fiyatlari'),
    p('Her hizmet bir satırdır: simgesi, adı, <b>Aylık</b> ve <b>Yıllık</b> kutuları. Yıllık boş bırakılırsa aylığın 10 katıdır. Değiştirdiğiniz satır sarı olur ve eski → yeni fiyatı yazar ("Aylık ₺200 → ₺250"); satırın sonundaki simge başlangıç fiyatına döndürür. Kaydet çubuğu sayfanın altında sabit durur. Fiyatlar KDV hariçtir.'),
    h2('İşletmeye özel indirim'),
    p('İşletme sayfası → Hizmet\'te "Bu işletme için fiyat" altında tutar ya da yüzde indirim verilir. "Ödeme alındı" tutarı bu indirimli fiyatla dolar.'),
    h2('Satışlarım'),
    sekil('y-satislarim', { aciklamalar: ['Excel: satışlar, aylık toplam ve KDV dökümü.', 'PDF: yazdırılabilir döküm.'] }),
    liste(['<b>Bu ay tahsilat</b> (KDV dahil), <b>Aylık düzenli gelir</b> (çalışan ücretli işletmeler; yıllık planda yıllığın 12\'de biri) ve <b>Bekleyen ödemeler</b>.', 'Süzgeçler: yıl, ay, işletme. Dönem toplamı: KDV hariç, KDV, toplam, bekleyen.', 'Kayıtlar lisans uzatmadaki "Ödeme alındı"dan gelir; "Ödeme ekle" ile elle de eklenir. Her kayıt düzeltilebilir, "Ödendi" yapılabilir; geçmişi saklanır.', '<b>Yazılım hizmeti KDV oranı</b> (varsayılan %20) yeni kayıtlar içindir; her kayıt kendi oranını saklar.']),
  ].join('');
}

function guncellemeler() {
  return [
    bolum('Güncellemeler', 'Yeni Mola sürümünü kafelere buradan gönderirsiniz. Kafeler arka planda indirir; kapanışta, sabah açılışta ya da boştayken, önce yedek alarak kurar. Sorun olursa eski sürüme kendileri döner.'),
    sekil('y-guncellemeler', { baslik: 'Ayarlar → Güncellemeler' }),
    p('Sayfanın başında tek bir durum kartı vardır: son yüklenen sürüm, yayındaki sürüm, işletme sayısı ve içinde kısa <b>Güncelleme yetkisi</b> şeridi. Altında üç adımlık şerit (yükleyin, Merkez denetler ve imzalar, yayınlayın), sürükleme alanı ve not; çalışma klasörüne konan paketler açılır <b>Klasörde hazır</b> listesindedir. <b>Sürümler</b> bir zaman çizelgesidir: her sürümün yanında yayınla, durdur, sil ve not simge düğmeleri. En altta <b>İşletmelerin sürümleri</b> kartı.'),
    adimlar([
      'Kaynak klasörde sürümü yükseltin ve <b>npm.cmd run installer</b> çalıştırın. Kurulum paketlerinin yanında "Guncelleme" klasöründe <b>.mola-guncelleme</b> dosyaları çıkar (Windows, macOS, Linux).',
      'İsterseniz işletme sahibinin göreceği kısa notu yazın.',
      'Dosyayı Güncellemeler sayfasındaki büyük alana <b>sürükleyip bırakın</b> (ya da "Dosya seç"). Kendiliğinden yüklenir, denetlenir ve imzalanır. Adım onayı ister.',
      '"Yüklendi, denetlendi ve imzalandı. Henüz hiçbir işletmeye gitmedi" satırında <b>"Önce pilot işletmelere"</b> seçin ve bir iki kafeyi işaretleyin.',
      'Pilot kafelerde sorun yoksa <b>"Herkese yayınla"</b>.',
    ]),
    liste(['<b>Durdur:</b> henüz kurmamış kafeler indirdiklerini bırakır. Kurmuş olanlar geri alınmaz; düzeltme için daha yeni bir sürüm yayınlanır.', '<b>Sil:</b> yalnız yayında olmayan paket.', 'Tablo her işletmenin sürümünü ve durumunu gösterir: indiriliyor, indirildi, kuruluyor, kuruldu, kurulamadı, geri alındı. Kurulamayan ya da geri alınan güncelleme Bildirim merkezine düşer.', 'Geri sürüme inme yoktur. Mola Yönetim kendisi bu yolla güncellenmez; yeni Merkez paketini siz kurarsınız.']),
    not('<b>Sıra:</b> önce Mola Merkez (Mola Yönetim) güncellenir, sonra kafe sürümleri yayınlanır. Eski Merkez yeni kafelerin bazı özelliklerini (internetten menü, duyurular, paketler) tanımaz.', 'dikkat'),
    not('Kafeye elle kurduğunuz her sürümün güncelleme paketini de buraya yükleyin (yayınlamadan). Dosya bütünlüğü denetimi imzalı listeyi buradan alır.', 'ipucu'),
  ].join('');
}

function ayarlar() {
  return [
    bolum('Ayarlar, yedek ve kayıtlar'),
    p('Ayarlar\'ın bölümleri sayfanın üstünde simgeli sekmelerdir: Hesap güvenliği, Paketler, Hizmet fiyatları, Yedek, Güncellemeler, E-posta bildirimleri, İletişim bilgileri, İşlem kayıtları, Çalışma klasörü, Geliştirici erişimi. Sekmeler sığmazsa iki satıra iner, telefonda kendi içinde yana kayar. Her bölüm aynı kart düzenindedir; açıklamalar kartın sağ üstündeki gri <b>ⓘ</b>\'dedir.'),
    h2('Yedek ve Sunucu yedeği'),
    sekil('y-yedek', { baslik: 'Ayarlar → Yedek' }),
    p('En üstte durum kartı: son yedek, sonraki yedek, saklanan yedek sayısı, ikinci yer ve sağlık çipi, "Şimdi yedekle". Altında <b>Saklanan yedekler</b>, <b>İkinci yedek yeri</b>, <b>Kurtarma kodu</b> (veri anahtarı satırıyla), <b>Geri yüklemeye hazırlık</b> (yedek var mı, kod kaydedildi mi, ikinci yer var mı) ve <b>Kafelerin sunucu yedekleri</b> kartları.'),
    liste(['<b>Merkez yedeği:</b> Merkez her gece kendi verisini şifreli olarak yedekler. "Şimdi yedekle" her zaman çalışır. Yedek alınamazsa Bugün listesinin en üstüne ve Bildirim merkezine düşer.', '<b>Merkez kurtarma kodu:</b> yedekler bu kodla açılır. Bir kez gösterilir; kâğıda yazın. Kaybolduysa "Yeni kurtarma kodu oluştur".', '<b>İkinci yedek yeri:</b> yedeklerin kopyasının gideceği ikinci klasör (Google Drive, OneDrive ya da flash bellek; içinde "Mola-Merkez-Yedek" klasörü oluşur, yedekler şifrelidir). <b>Göz at</b> Windows\'un klasör seçme penceresini bu bilgisayarda açar; altında bu bilgisayarda bulunan hazır yerler çip olarak durur (ör. "Google Drive (G:) · G:\\Drive\'ım"). Seçip "Kaydet"e basın. Göz at yalnız Mola Merkez\'in çalıştığı bilgisayarda görünür; başka yerde yol elle yazılır.', '<b>Sunucu yedeği:</b> kafelerin "Bulutta şifreli yedek" hizmetiyle gelen kopyaları. Disk durumu, işletme başına son yükleme, boyut, kopya sayısı ve "2 gündür yok" uyarısı; saklama süresi ve kota. Yeni bilgisayara geçen kafe için tek kullanımlık taşıma kodu işletme sayfası → Lisans → "Yeni bilgisayara taşıma"dan verilir. Merkez bu kopyaları açamaz.']),
    h2('İşlem kayıtları'),
    sekil('y-islem-kayitlari', { aciklamalar: ['Bütünlük denetimi: "Kayıtlar bütün".', 'Rapor al: PDF, Excel ya da JSONL.', 'Dönem çipleri: Tümü, Bugün, 7 gün, 30 gün, Başarısız olanlar.', '"Süzgeçler": işletme, kişi, sonuç ve tarih.'] }),
    p('Mola Yönetim\'de yapılan her şey (lisans, paket, fiyat, ödeme, duyuru, güncelleme, giriş) kim, ne zaman, nereden ve eski → yeni değerleriyle zincirleme kaydedilir. Kayıtlar saatte bir mühürlenir, değiştirilemez; bozulma olursa ekran kırmızı uyarı verir. Arama kutusu ve dönem çipleri hep görünür; diğer süzgeçler <b>Süzgeçler</b> düğmesinin altındadır, "Süzgeçleri temizle" hepsini kaldırır. Her kayıt grup simgeli tek satırdır; satıra dokununca kim, nereden, eski → yeni, tam saat ve sıra numarası açılır. Saklama süresi (varsayılan 10 yıl) katlanan bir karttadır.'),
    h2('Diğer ayarlar'),
    liste(['<b>E-posta bildirimleri:</b> kendi SMTP hesabınız (Gmail\'de "uygulama şifresi"), alıcı adresi, deneme e-postası.', '<b>İletişim bilgileri:</b> Mola ekibinin telefonu, WhatsApp\'ı, e-postası ve çalışma saatleri. Kafelerde "Mola ekibine ulaşın" düğmeleri buradan çıkar; boş alan gösterilmez.', '<b>Çalışma klasörü:</b> durum özeti ve işlem kayıtlarının günlük kopyası bilgisayarınızdaki bir klasöre yazılır (kurulu Mola Yönetim\'de C:\\MolaCalisma). Klasörü değiştirirken "Göz at" ile seçebilirsiniz; OneDrive ve Google Drive dışında bir klasör olmalı.', '<b>Geliştirici erişimi:</b> yayınlama komutu için erişim anahtarı. Bir kez gösterilir, iptal edilebilir.']),
    sekil('y-iletisim', { baslik: 'Ayarlar → İletişim bilgileri' }),
    sekil('y-eposta', { baslik: 'Ayarlar → E-posta bildirimleri' }),
    sekil('y-calisma-klasoru', { baslik: 'Ayarlar → Çalışma klasörü' }),
    sekil('y-gelistirici', { baslik: 'Ayarlar → Geliştirici erişimi' }),
  ].join('');
}

function internetMenu() {
  return [
    bolum('İnternetten menü', 'Masa QR\'ları misafirin kendi mobil verisinden de açılır. Menü Mola Merkez üzerinden gelir; sipariş kafenin bilgisayarına gider. Kafe bilgisayarı kapalıyken de menü Merkez\'deki kopyasından görünür.'),
    adimlar([
      'Kafe etkinleşince Merkez ona bir <b>menü kodu</b> verir (10 harf/rakam, hiç değişmez).',
      'Kafe Merkez\'e dışarıya doğru tek bir şifreli bağlantı (tünel) açık tutar. Kafede port açmak ya da modem ayarı gerekmez.',
      'Masa QR\'ı menünün kendi adresini taşır: <b>https://menu.molayazilim.com.tr/q/&lt;kod&gt;/&lt;masa kodu&gt;</b>. Misafirin istekleri Merkez\'den tünelle kafeye geçer.',
      'Merkez yalnız misafir sayfasını, menüyü, sepeti, siparişi, garson çağrısını ve hesap isteğini geçirir. Personel ve sahip ekranları ve Mola Yönetim bu adresten hiç açılmaz; menü de Mola Yönetim\'in ya da sitenin adresinde açılmaz (eski adresle basılmış QR menü adresine yönlenir).',
    ]),
    tablo(['Durum', 'Misafirin gördüğü'], [
      ['Açık, kafe bağlı', 'Menü'],
      ['Askıda, lisansı bitmiş, dondurulmuş, 14 gündür bağlanmamış ya da pakette QR menü yok', '"Bu işletmenin dijital menüsü şu anda kullanılamıyor." Merkez kafeye sormadan karar verir.'],
      ['Kafe bilgisayarı kapalı ya da interneti yok', 'Menü Merkez\'deki <b>kopyasından</b> açılır; üstte "Şu an sipariş alınamıyor, lütfen garsonunuza sorun." Kafe dönünce sayfa kendiliğinden siparişe açılır, sepet kaybolmaz. (Kopyası hiç gelmemiş eski bir kafede: "Menü şu anda açılamıyor".)'],
      ['Kafe bağlı ama QR siparişleri kapalı (personel ekranı yok, gün sonu, elle durduruldu)', 'Menü; üstte "Şu an sipariş almıyoruz, lütfen garsonunuza sorun."'],
      ['Bilinmeyen kod', '"Bu bağlantı bulunamadı. Masanızdaki QR kodunu yeniden okutun."'],
    ]),
    not('<b>MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr ayarını toplu QR basımından önce yapın</b> (güvenlik gereği; DNS\'te <b>menu</b> kaydı ve Caddy\'de <b>menu.</b> bloğu ile). Basılı bir QR adresini sonradan değiştiremez. Kafelerin gönderdiği menü sayfası böylece Mola Yönetim\'in ve sitenin adresinden ayrı bir adreste açılır; oradaki çerez ve anahtarlara ulaşamaz. Sosyal medya QR kartlarının kısa adresleri için ayrıca <b>MERKEZ_SITE_ORIGIN=https://molayazilim.com.tr</b>. Ayardan sonra bir masa kartını Wi-Fi\'si kapalı bir telefonla okutup deneyin.', 'dikkat'),
    liste(['Yeni etkinleşen kafede masa QR\'ının internet adresi <b>iki kalp atışı (10 ile 20 dakika)</b> sonra gelir; o zamana kadar QR Wi-Fi adresini taşır. QR\'ı bundan sonra basın.', 'Caddy\'de <b>menu.</b> adresinde yalnız <b>/q/*</b>, sitede <b>/s/*</b> Merkez\'e iletilir; eski adreslerdeki <b>/q/*</b> menü adresine yönlenir. Merkez bloğu kafelerin tünellerini taşır.', 'Eski kafe sürümü menü kodu almaz; QR\'ları Wi-Fi adresinde kalır ve sahibine "internet adresi hazır olunca yeniden basılmalı" notu çıkar. Eski Merkez internetten menüyü bilmez: önce Merkez\'i güncelleyin.', 'Merkez misafir trafiğini saklamaz ve günlüğe yazmaz; yalnız kafe başına sayaçlar bellekte durur (işletme Özet\'inde "İnternetten menü" satırı).']),
    h2('Menünün Merkez\'deki kopyası'),
    p('Kafe menüsünü (ürünler, fiyatlar, kampanyalar, "tükendi", görünüm, ürün fotoğrafları) her değişiklikten birkaç saniye sonra Merkez\'e gönderir; fotoğraf aynıysa bir daha göndermez. Merkez bunu şifreli olarak saklar ve kafe kapalıyken misafire menüyü bundan gösterir. Siparişi her zaman kafe kabul eder: az önce tükenen bir ürün için misafir "Bu ürün az önce tükendi" görür. Kopyada satış, sipariş, müşteri ya da çalışan bilgisi yoktur; işletmenin kaydını silince kopyası da silinir. Tipik boyut kafe başına 20–30 MB; Menü metni Merkez\'in gece yedeğine girer, fotoğraflar girmez (kafeler eksik fotoğrafı yeniden gönderir).'),
    h2('Saklama süreleri'),
    liste(['İşlem kayıtlarındaki IP adresleri 1 yıl sonra kendiliğinden silinir; kayıtların bütünlük denetimi yine "Kayıtlar bütün" der (silme de bir kayıt olarak görünür: "1 yılı geçen kayıtların IP adresleri silindi").', 'Kapanan destek görüşmeleri son mesajdan 2 yıl, reddedilen hesap açma başvuruları 1 yıl sonra silinir (işlem kayıtlarında "… silindi" satırı, kişisel bilgi olmadan).', 'Destek ekleri 14 gün, web sitesi talepleri kapandıktan 2 yıl sonra silinir (değişmedi).']),
  ].join('');
}

function webSitesi() {
  return [
    bolum('Web sitesi ve iletişim formu'),
    p('molayazilim.com.tr düz HTML sayfalarından oluşur: Ana sayfa, Özellikler, Uygulamayı indir, Destek ve İletişim, KVKK, Gizlilik, Çerez. Sitede çerez, analiz aracı ya da dışarıdan yüklenen bir şey yoktur. Hizmet adları ve "Yakında" bilgisi programın hizmet listesinden gelir; sitede fiyat yazmaz.'),
    sekil('w-ana-sayfa', { baslik: 'Ana sayfa' }),
    adimlar(['İletişim bilgilerini <b>site/config.json</b>\'a yazın (telefon, WhatsApp, e-posta, adres, çalışma saatleri).', '<b>npm.cmd run site:build</b> ile site/dist klasörünü üretin; derleme eksik numarayı uyarır.', 'site/dist içeriğini sunucuda /var/www/molayazilim klasörüne yükleyin. Caddy\'yi yeniden başlatmak gerekmez.', 'Ekran videolarını yenilemek için <b>npm.cmd run site:videos</b>.']),
    sekil('w-iletisim', { baslik: 'Destek ve İletişim sayfası ve form' }),
    p('Form Mola Merkez\'e gider ve Başvurular → Web sitesi talepleri\'ne düşer; zilde "Web sitesi talebi" çıkar. Form kötüye kullanıma karşı sınırlıdır (adres başına saatte 5 talep, günde toplam 200). Yasal sayfalar şu an <b>taslaktır</b> (sarı şerit); avukat onayından sonra config.json\'da legalDraft kapatılır.'),
    h2('Uygulamayı indir (/indir/)'),
    p('"Uygulamayı indir" sayfasında şu an <b>Windows</b> ve <b>Android personel uygulaması (APK)</b> açık, Mac ve Linux <b>"Yakında"</b>. Sayfa dört adımı (indir ve kur → "Kodum yok, başvuru yapacağım" ya da "Etkinleştirme kodum var" → siz onaylarsınız → 30 gün deneme) ve SmartScreen notunu ("Ek bilgi → Yine de çalıştır") gösterir. Dosyası olmayan kart "Yakında" der; config.json\'da <b>downloads.enabled</b> false iken hepsi.'),
    adimlar(['Kafe paketini VDS adresi ve açık anahtarıyla hazırlayın (MOLA_MERKEZ_URL ile <b>npm.cmd run installer</b>).', '<b>npm.cmd run site:indir</b>: Windows ZIP\'ini, Mac/Linux arşivlerini ve .local/android/Mola.apk\'yı site/dist/indir\'e alır, boyut ve SHA-256\'yı config.json\'a yazar, dosyaların hangi Merkez\'e bağlandığını söyler.', '<b>downloads.enabled: true</b>, <b>npm.cmd run site:build</b>, yükleme (docs/VDS_KURULUM.md bölüm 13).']),
    not('<b>Paketi yeni kafe kurmadan önce hazırlayın.</b> Eski paketle kurulan kafe kodu eski Merkez\'e sorar ve "kod geçersiz" der; Mola\'yı "Verileri ve yedekleri de sil" işaretli kaldırıp yeni paketle kurun.', 'dikkat'),
    p('VDS\'ten önce bütün yolu evde denemek için <b>npm.cmd run ev-provasi</b>: kurulum dosyalarını bu bilgisayarın ev ağı adresiyle ayrı bir klasöre hazırlar ve siteyi ev ağında yayınlar; Mola Yönetim\'de <b>MERKEZ_LAN=1</b> gerekir (Mola Yönetim ekranları yine yalnız bu bilgisayardan açılır). Adımlar ve geri alma: docs/EV_AGI_PROVASI.md.'),
  ].join('');
}

function operasyon() {
  return [
    bolum('Operasyon: alan adı, VDS ve düzenli kontroller', 'Mola Merkez internetteki bir sunucuda (VDS) çalışır. Adım adım kurulum docs/VDS_KURULUM.md\'dedir; burada neye dikkat edeceğiniz özetlenir.'),
    h2('Alan adı: molayazilim.com.tr'),
    tablo(['Adres', 'Ne'], [
      ['https://molayazilim.com.tr', 'Web sitesi'],
      ['https://www.molayazilim.com.tr', 'Siteye kalıcı yönlendirme'],
      ['https://molayazilim.com.tr/api/site/*', 'İletişim formu → Mola Merkez'],
      ['https://molayazilim.com.tr/s/*', 'Sosyal medya QR kısa adresleri'],
      ['https://menu.molayazilim.com.tr/q/*', 'İnternetten menü (masa QR\'ları), kendi adresinde; başka hiçbir şey'],
      ['https://merkez.molayazilim.com.tr', 'Mola Merkez, Mola Yönetim ve kafelerin bağlantıları'],
    ]),
    liste([
      'Alan adı Metunic\'te kayıtlı; DNS\'i <b>ücretsiz Cloudflare</b> yönetir (ad sunucuları Cloudflare\'de). Dört A kaydı: <b>@, www, merkez, menu</b> → sunucu IP\'si.',
      'Dört kayıt da <b>DNS only (gri bulut)</b>. Turuncu bulut (proxy) kullanılmaz: misafir başına sınırlar herkesi tek misafir sayar, sertifika bozulur. "Only allow Cloudflare IPs" önerisi de uygulanmaz.',
      'Mola Yönetim yalnız <b>https://merkez.molayazilim.com.tr</b> adresinden kullanılır (Edge\'de "uygulama olarak yükle"). Eski Windows Mola Yönetim taşımadan sonra eşitlenmez; orada değişiklik yapmayın.',
    ]),
    not('Alan adının yenileme tarihini takviminize yazın ve otomatik yenilemeyi açın. Alan adı düşerse bütün QR\'lar, kafelerin lisans bağlantısı ve web sitesi aynı anda durur.', 'dikkat'),
    h2('VDS (İstanbul)'),
    p('Keyubu/Datacasa VDS L-TR 6GB, İstanbul (veriler yurt dışına çıkmaz), Ubuntu 24.04, 170 GB disk. Yalnız 22, 80 ve 443 açık (ufw); Mola Merkez systemd servisi, Caddy HTTPS sertifikasını kendisi alır ve yeniler.'),
    tablo(['Neye bakın', 'Nasıl', 'Ne sıklıkla'], [
      ['Merkez çalışıyor mu', 'Ücretsiz bir "uptime" hizmetine https://merkez.molayazilim.com.tr/api/merkez/v1/health adresini ekleyin; erişilemezse e-posta gelir.', 'Sürekli'],
      ['Disk', 'df -h; yüzde 80\'i geçmesin. Sunucu yedekleri disk kullanır (Ayarlar → Yedek → Kafelerin sunucu yedekleri).', 'Haftalık'],
      ['Kayıtlar', 'journalctl -u mola-merkez --since today', 'Sorun olunca'],
      ['Güvenlik güncellemeleri', 'sudo apt update && sudo apt -y upgrade; gerekirse yeniden başlatın (Merkez kendiliğinden başlar).', 'Aylık'],
      ['Sertifika', 'Caddy yeniler; sudo journalctl -u caddy -n 50', 'Aylık'],
      ['Bildirim merkezi', 'Merkez yedeği, kafe yedekleri, bağlanmayan kafeler, dosya bütünlüğü', 'Her gün'],
    ]),
    h2('Merkez yedeğini kendi bilgisayarınıza çekin'),
    liste([
      'Merkez her gece şifreli yedek alır; yedek aynı sunucudadır. <b>npm run vds:cek</b> yedekleri her gün 07:00\'de bilgisayarınıza (C:\\MolaCalisma\\vds) ve Google Drive\'a çeker (docs/VDS_KURULUM.md bölüm 15). Yedekler Merkez kurtarma koduyla açılır.',
      '<b>Ayda bir geri yükleme provası</b> (5 dakika): en yeni yedeği <b>npm.cmd run merkez:restore</b> ile ayrı bir klasöre açın; "Geri yüklendi ve doğrulandı: N işletme" yazmalı. Sonra prova klasörünü silin.',
    ]),
    h2('Her sürümün güncelleme paketini yükleyin'),
    p('Kafelere hangi sürümü kurarsanız kurun (otomatik güncellemeyle ya da elle) o sürümün .mola-guncelleme paketini Mola Yönetim → Güncellemeler\'e yükleyin. Yayınlamak gerekmez. Dosya bütünlüğü denetimi imzalı listeyi buradan alır; yüklenmemiş sürümü denetleyemez.'),
    h2('Toplu QR basımından önce'),
    adimlar(['DNS\'te menu kaydını ve Caddy\'de menu. bloğunu kurun; MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr ayarını yapın (/etc/mola-merkez/ayarlar.env, sonra sudo systemctl restart mola-merkez).', 'Bir pilot kafede Ayarlar → Masalar ve QR\'da "QR kodları internet adresini taşır (menu.molayazilim.com.tr/q/…) · Bağlı" yazdığını görün.', 'Bir masa kartını basın ve Wi-Fi\'si kapalı bir telefonla okutun: menü açılmalı, deneme siparişi kafenin mutfağına düşmeli.', 'Ancak ondan sonra kafelere toplu baskı yaptırın.']),
    h2('Kontrol listesi'),
    tablo(['Sıklık', 'İş'], [
      ['Her gün', 'Bugün listesi ve Bildirim merkezi; yanıt bekleyen destek talepleri; web sitesi talepleri.'],
      ['Haftalık', 'npm run vds -- ozet; vds:cek günlüğünde bugünün yedeği; bağlanmayan kafeler.'],
      ['Aylık', 'Geri yükleme provası; sunucu güncellemeleri; Satışlarım\'da bekleyen ödemeler; biten lisanslar.'],
      ['Her yeni sürümde', 'Önce Merkez\'i güncelleyin; güncelleme paketini yükleyin; önce pilot, sonra herkese.'],
      ['Yılda bir', 'Alan adı ve VDS yenilemesi; Merkez kurtarma kodu hâlâ yerinde mi.'],
    ]),
    h2('Sık sorulanlar'),
    sss('Bir kafe "Mola Merkez\'e ulaşılamıyor" diyor.', 'Kafe nedeni ayrı söyler: internet yok, Merkez yanıt vermiyor, adres yanlış ya da bilgisayarın saati yanlış. Merkez\'in sağlık adresini kontrol edin; sorun kafedeyse internetini ve saatini kontrol ettirin. Kafe 14 güne kadar Merkez\'siz çalışır.'),
    sss('Kafe yeni bilgisayara geçiyor.', 'Bulut yedeği varsa işletme sayfası → Lisans → <b>Yeni bilgisayara taşıma</b>\'dan taşıma kodu verin; yoksa kafe USB\'deki yedeği ve kurtarma kodunu kullanır. "İki farklı bilgisayar" uyarısı çıkarsa işletme Özet\'inden "Eski bilgisayarı yeniden etkinleştir" ile çözersiniz.'),
    sss('Menü adresi (menu.) her istekte hata (500) veriyor.', 'Merkez sürümü eski: sunucunun kum havuzunda ağ adresleri okunamıyordu, 12 Ekim\'de düzeltildi. Merkez\'i güncelleyin.'),
    sss('Yeni kafe etkinleştirmede "kod geçersiz" diyor.', 'Kafe eski paketle kurulmuş, kodu eski Merkez\'e soruyor. VDS adresiyle hazırlanmış paketle yeniden kurun (Web sitesi → Uygulamayı indir).'),
    sss('Merkez\'in bilgisayarı değişti.', 'Kafeler yeni adresi imzalı bir duyuruyla öğrenir ve doğrular. Adım adım: docs/VDS_KURULUM.md "Kafeleri yeni adrese geçirin".'),
  ].join('');
}

export function yonetimKilavuzu(): Belge {
  return {
    dosya: 'Mola-Yonetim-Kilavuzu.pdf', baslik: 'Mola Yönetim Kılavuzu', altBaslik: 'Satıcı için: lisanslar, paketler, destek, güncellemeler ve sunucu', kisa: 'Mola Yönetim Kılavuzu', tocDerinlik: 2,
    kapakNotu: '<p><b>Yalnız Merkut Studios içindir.</b> Bu kılavuz kafelere verilmez.</p><p>Mola Yönetim\'in her sayfası, her işlemin ne zaman adım onayı istediği ve sunucunun düzenli bakımı. Ekranlar geçici bir deneme sunucusundan, örnek işletmelerle alınmıştır.</p>',
    icerik: [giris(), bugun(), isletmeler(), basvurular(), duyurular(), paketler(), guncellemeler(), ayarlar(), internetMenu(), webSitesi(), operasyon()].join(''),
  };
}

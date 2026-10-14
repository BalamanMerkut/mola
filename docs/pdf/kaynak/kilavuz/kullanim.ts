/*
 * Mola Kullanım Kılavuzu (kafeler ve restoranlar için). Sade ve kısa: işletme sahibinin işini yapması için gerekenler.
 * FİYAT YAZILMAZ. Hizmetler ve başlangıç paketleri packages/domain/features.ts'ten gelir (hizmet()). Uzun tire kullanılmaz.
 */
import { features, defaultPackages } from '../../../../packages/domain/features.ts';
import type { Belge } from './sablon.ts';
import { adimlar, bolum, h2, h3, hizmet, liste, not, p, sekil, serit, sss, tablo } from './sablon.ts';

const ok = '<b style="color:#1f5135">✓</b>', yok = '<span style="color:#a3a8a3">–</span>';

function tanitim() {
  const satilan = features.filter(f => !f.soon);
  return [
    bolum('Mola\'yı tanıyın', 'Mola, kafenizin adisyon programı ve QR menüsüdür. Sipariş, mutfak, kasa, menü ve raporlar tek yerde durur. Verileriniz kafenizdeki bilgisayarda, şifreli olarak saklanır.'),
    h2('Kim neyi kullanır?'),
    tablo(['Hesap', 'Nerede', 'Günlük işi'], [
      ['<b>Garson</b>', 'Telefon', 'Sipariş alır, QR siparişlerini onaylar, servis eder.'],
      ['<b>Kasiyer</b>', 'Kasa bilgisayarı ya da tablet', 'Kasayı açar, ödeme alır, gün sonunu yapar.'],
      ['<b>Mutfak</b>', 'Mutfaktaki tablet ya da fiş yazıcısı', 'Siparişleri hazırlar, "Hazır" der.'],
      ['<b>Müdür</b>', 'Her cihaz', 'Siz yokken günü yönetir.'],
      ['<b>İşletme sahibi</b>', 'Her cihaz, telefondan uzaktan da', 'Her şeyi görür ve ayarlar.'],
    ]),
    h2('Hizmetler ve paketler'),
    p('<b>Adisyon çekirdeği</b> her pakette vardır, diğer hizmetler ihtiyaca göre eklenir. Paketinizde olmayan bölüm soluk görünür ve <b>"Pakette yok"</b> yazar; dokunup <b>"Mola ekibine yaz"</b> deyin. Kapanan hizmetin verisi silinmez.'),
    tablo(['Hizmet', 'Ne yapar', ...defaultPackages.map(x => x.name)], satilan.map(f => [`<b>${f.name}</b>`, f.description, ...defaultPackages.map(x => (x.features as string[]).includes(f.id) ? ok : yok)]), 'kucuk'),
  ].join('');
}

function ilkGun() {
  return [
    bolum('İlk gün kurulumu', 'Mola kurulunca sırayla bunları yapın. Hepsi bir saatten kısa sürer.'),
    adimlar([
      '<b>Etkinleştirme:</b> Mola ilk açıldığında "Mola\'yı etkinleştir" ekranı gelir. Kodunuz varsa <b>Etkinleştirme kodum var</b>; yoksa <b>Kodum yok, başvuru yapacağım</b> deyip formu doldurun (Mola ekibi onaylayınca 30 günlük deneme başlar). Kurulum dosyası: <b>molayazilim.com.tr/indir/</b>.',
      '<b>Sahip hesabı:</b> kendi kullanıcı adınızı ve şifrenizi belirleyin. Lisans Sözleşmesi\'ni okuyup kabul edin.',
      '<b>Kurtarma kodu:</b> ekrana gelen kodu kâğıda yazın ve saklayın. Bilgisayar bozulursa verileriniz bu kodla açılır.',
      '<b>Menü:</b> Menü yönetimi\'nde ürünleri ve fiyatları kendinize göre düzeltin.',
      '<b>Görünüm:</b> Ayarlar → İşletme → Görünüm: ad, logo, renk paleti, karşılama yazısı.',
      '<b>Çalışanlar:</b> Personel → Çalışanlar\'da herkese ayrı hesap açın. Ortak şifre kullanmayın.',
      '<b>Yazıcı ve mutfak:</b> Ayarlar → Cihazlar → Yazıcılar; mutfak ekranla mı fişle mi çalışacak, seçin.',
      '<b>Cihaz bağla:</b> Ayarlar → Cihazlar → Cihaz bağla. Android telefonlara Mola uygulamasını kurun.',
      '<b>İkinci yedek yeri:</b> kasa bilgisayarının sol şeridinden Yedekle → bir USB bellek seçin.',
      '<b>QR kodları:</b> Ayarlar → Masalar ve QR\'da "Bağlı" yazınca basın.',
      '<b>Deneme:</b> kendi telefonunuzla bir masadan sipariş verin, mutfakta hazırlayın, kasada kapatın.',
    ]),
  ].join('');
}

function musteri() {
  return [
    bolum('Müşteri QR\'dan sipariş verir', 'Müşteri masadaki QR kodu telefonuyla okutur, menü açılır. Wi-Fi gerekmez; kendi mobil verisiyle de açılır.'),
    hizmet(['qr-menu', 'qr-order'], 'Müşteri garsonu beklemeden sipariş verir. Garsonunuz servise zaman ayırır, siparişler yanlış yazılmaz.'),
    serit([
      { ad: 'm-menu', baslik: '1. Menü açılır', aciklamalar: ['Masa adı üstte yazar.', 'Garson çağır.', 'Kategoriler.', 'Ürüne dokunur.'] },
      { ad: 'm-urun', baslik: '2. Ürünü seçer', aciklamalar: ['Seçenekler (boy, süt).', 'Adet.', '"Sepete ekle".'] },
      { ad: 'm-sepet', baslik: '3. Gönderir', aciklamalar: ['2 Caffè Latte.', '1 San Sebastian cheesecake.', '"Siparişi gönder".'] },
    ], { genislik: 165 }),
    adimlar([
      'Sipariş, ayarınıza göre önce garsonun onayına ya da doğrudan mutfağa gider.',
      'Mutfak "Hazır" deyince garsonun telefonu haber verir; garson servis edip <b>Teslim edildi</b> der.',
      'Müşteri <b>Hesabı iste</b>\'ye basar, nakit ya da kart seçer. Kasada "Masa 05 · Hesap istiyor" uyarısı çıkar.',
      'Kasiyer ödemeyi kaydedince müşterinin telefonunda "Hesabınız kapandı" ve Google değerlendirme düğmesi çıkar.',
    ]),
  ].join('');
}

function garson() {
  return [
    bolum('Garson', 'Garson Mola\'yı telefonundan kullanır. Altta beş düğme vardır: Masalar, Sipariş al, Servise hazır, Rezervasyon, Daha fazla.'),
    serit([
      { ad: 'g-masalar', baslik: 'Masalar', aciklamalar: ['Özet: açık masa ve tutar.', 'Filtreler.', 'Masa kutusu: tutar ve durum.', 'Alt menü.'] },
      { ad: 'g-siparis', baslik: 'Sipariş al', aciklamalar: ['Masa seçimi.', 'Ürün arama.', '+ bir adet ekler.', 'Sepet ve Gönder.'] },
    ], { genislik: 230 }),
    h3('Sipariş almak'),
    adimlar([
      '<b>Sipariş al</b>\'a dokunun, üstten masayı seçin.',
      'Ürünün yanındaki <b>+</b>\'ya basın. Seçenekli üründe küçük pencere açılır.',
      'İsterseniz sepeti açıp not yazın ("az şekerli") ya da <b>Paket yapılsın</b> deyin.',
      '<b>Gönder</b>\'e basın. Sipariş mutfağa gider.',
    ]),
    h3('Gün içinde'),
    tablo(['Ne oldu', 'Ne yapılır'], [
      ['QR siparişi onay bekliyor', 'Doğruysa <b>Onayla ve mutfağa gönder</b>, yanlışsa <b>Reddet</b>.'],
      ['Telefon titredi: "Masa 3 · #5 hazır"', 'Siparişi götürün, <b>Teslim edildi</b>\'ye basın.'],
      ['Üstte şerit: "Masa 15 · Garson çağırıyor"', 'Masaya gidin, <b>Tamam</b>\'a basın.'],
      ['"Masa 5: 45 dakikadır yeni sipariş yok"', 'Masaya uğrayın, <b>Gittim</b>\'e basın.'],
      ['Müşteri fikrini değiştirdi', 'Masaya dokunun → siparişin altında <b>Değiştir</b> → <b>Değişikliği kaydet</b>. Mutfak başladıysa <b>İptal et</b> ile çıkarıp yenisini girin.'],
      ['Kalabalık grup, iki masa', 'Masa penceresi → <b>Taşı / birleştir</b> → diğer masa → <b>Hesapları birleştir</b>.'],
      ['Sarı satır: "QR siparişleri kapalı"', 'Siparişi siz alın; açmak için kasiyere ya da müdüre söyleyin.'],
    ]),
    liste(['<b>Daha fazla:</b> Rezervasyon (izin verildiyse), Hesabım (şifre değiştirme), Çıkış.', 'Oturumlar her gün 05:00\'te kapanır; sabah yeniden giriş yapılır. Sepetteki ürünler kaybolmaz.']),
  ].join('');
}

function kasiyer() {
  return [
    bolum('Kasiyer', 'Kasiyer kasayı açar, ödemeleri alır, al götür satış yapar ve günü kapatır.'),
    h2('Kasa açılışı'),
    p('Sabah ilk girişte "Kasa açılışı" kutusu çıkar. Kasadaki nakdi sayın, tutarı yazın, <b>Açılışı kaydet</b>\'e basın. Vardiya değişiminde aynı kutu <b>Vardiya devrini al</b> diye çıkar.'),
    sekil('c-kasa-acilis', { genislik: 560, aciklamalar: ['Kasadaki nakit.', '"Açılışı kaydet".'] }),
    h2('Ödeme almak'),
    adimlar([
      'Masaya dokunun, <b>Ödeme al</b>\'a basın.',
      'Ne kadar ödenecek: tamamı, bir kısmı ya da ürün seçerek (hesap bölmek için).',
      '<b>Nakit</b> ya da <b>Kart</b> seçin. Nakitte alınan parayı yazın; para üstü büyük yazıyla görünür.',
      'Bahşiş varsa <b>+ Bahşiş ekle</b> (satışa sayılmaz).',
      '<b>Ödemeyi kaydet</b>. Hesap bittiyse masa kapanır.',
    ]),
    sekil('c-odeme-nakit', { genislik: 300, yan: true, aciklamalar: ['Ne kadar ödenecek.', 'Ödeme türü.', 'Alınan nakit ve para üstü.', '"Ödemeyi kaydet".'] }),
    liste([
      '<b>Fiş basılamazsa</b> üstte kırmızı satır nedenini yazar ("Yazıcıda kâğıt yok"). Sorunu giderip <b>Tekrar bas</b>.',
      '<b>Yazar kasa yardımcısı</b> açıksa her ödemeden sonra köşede yazar kasaya girilecek tutar ve KDV bölümü çıkar. Girince <b>Girildi</b> deyin. Mola yazar kasaya bağlanmaz; tutarı siz girersiniz.',
    ]),
    h2('Al götür (masasız) satış'),
    adimlar([
      'Sipariş al\'da ilk seçenek <b>Masasız sipariş</b>: müşterinin adını yazın.',
      'Ürünleri ekleyip gönderin. Ödeme penceresi açılır; sonra ödeyecekse <b>Sonra öde</b>.',
      'Sipariş Masalar\'daki "Masasız siparişler" şeridinde durur. Verince <b>Teslim edildi</b>.',
    ]),
    h3('Kasa işlemleri ve iade'),
    sekil('c-kasa-menu', { genislik: 300, yan: true, aciklamalar: ['Kasa çipi: ne zamandan beri açık.', '"Gider kaydet": ekmek, süt gibi bir ödeme. Kasadan mı, kasa dışından mı çıktı seçilir.', '"İade": müşteriye para iadesi.', '"Gün sonu": kasayı kapatır.'] }),
    liste([
      '<b>Kasa hareketi:</b> kasaya para konması ya da alınması. <b>Para bozdurma:</b> toplam değişmez.',
      '<b>İade:</b> bugünkü ödemelerden birini seçin, ürünleri ve nedeni işaretleyin. Kasiyerin iade sınırı vardır; fazlası işletme sahibine sorulur.',
    ]),
    h2('Gün sonu'),
    adimlar([
      'Kasa çipinden <b>Gün sonu</b>. Açık hesaplar ve bitmemiş siparişler varsa söylenir.',
      'Kasadaki nakdi sayıp yazın, <b>Sayımı kaydet</b>. Beklenen tutarı ve farkı yalnız işletme sahibi görür.',
      'Yazar kasa yardımcısı açıksa Z raporu toplamını yazın.',
      '<b>Kapanışı tamamla</b>. Bir dakika sonra kendiliğinden yedek alınır.',
    ]),
    sekil('c-gun-sonu-sonuc', { genislik: 300, yan: true, aciklamalar: ['İşletme sahibinde: sayılan ve beklenen nakit; fark varsa açıklama istenir.', 'Yazar kasa yardımcısı açıksa Z raporu toplamı.'] }),
    not('İş günü 05:00\'te döner: gece 01:30\'daki satış o gecenin gününe yazılır.', 'bilgi'),
    h2('QR siparişlerini durdurmak ve açmak'),
    p('Sol menünün üstündeki kart QR siparişlerinin durumunu yazar. Mutfak yetişemiyorsa <b>Durdur</b>\'a basın. Kapalıysa kart sarıdır ve nedenini yazar:'),
    tablo(['Kartta yazan', 'Ne yapılır'], [
      ['Gün sonu yapıldı', 'Satışa devam edecekseniz <b>Siparişleri aç</b>. Sabah kasa açılınca ya da 05:00\'te kendiliğinden açılır.'],
      ['Elle durduruldu', '<b>Siparişleri aç</b>.'],
      ['Personel ekranı bağlı değil', 'Mutfak, garson ya da kasa ekranından birinde giriş yapın.'],
    ]),
    sekil('c-qr-durumu', { genislik: 520, aciklamalar: ['Kart: "QR siparişleri kapalı · Gün sonu yapıldı".', '"Siparişleri aç".', 'Masalar\'ın üstündeki şerit; "Aç" aynı işi yapar.'] }),
  ].join('');
}

function mutfak() {
  return [
    bolum('Mutfak', 'Mutfak ya bir tablet ya da ekranda (Ekran), ya da mutfak yazıcısından çıkan fişlerle (Fiş) çalışır.'),
    sekil('k-pano', { genislik: 560, aciklamalar: ['Yeni siparişler.', 'Hazırlananlar.', 'Hazır olanlar.', '"Stok": sayım ve fire.'] }),
    liste([
      'Her kart bir siparişdir: masa, kaç dakikadır beklediği, ürünler ve notlar.',
      '<b>Hazırlamaya başla</b>, sonra <b>Hazır olarak işaretle</b>. Garsonun telefonu o anda haber alır. Yanlış basarsanız 5 saniye içinde <b>Geri al</b>.',
      '10 dakikayı geçen kart turuncu, 20 dakikayı geçen kırmızı olur.',
      'İptal edilen siparişte kırmızı <b>İPTAL</b> şeridi, değişen üründe turuncu <b>Değişti</b> satırı çıkar.',
      'Sesler için ekrana bir kez dokunun. <b>Ekranı açık tut</b> tabletin kararmasını önler. Dik tablette sütunlar sekme olur.',
    ]),
    h3('Fiş modu'),
    p('Ekran yoksa siparişler mutfak yazıcısından fiş olarak çıkar; değişiklikte <b>DEĞİŞİKLİK</b> fişi gelir. Ayar: Ayarlar → Sipariş ve mutfak → Mutfak. Önce Ayarlar → Cihazlar → Yazıcılar\'da bir yazıcıyı "Mutfak fişleri" için seçin.'),
    not('Kâğıt biterse ya da yazıcı kapalıysa "Fiş basılamadı: Yazıcıda kâğıt yok · Mutfak" uyarısı kasada ve garson telefonlarında çıkar. Rulo takıp <b>Tekrar bas</b>\'a basın. Bazı USB yazıcılar bu uyarıyı veremez; yazıcının kendi sürücüsünü kurun ya da ağ kablosuyla bağlayın.', 'ipucu'),
  ].join('');
}

function mudur() {
  return [
    bolum('Müdür', 'Müdür, siz kafede değilken günü yönetir. Sizin şifrenizi paylaşmanıza gerek kalmaz.'),
    p('Açmak için: Personel → Çalışanlar → <b>Çalışan ekle</b> → Görevi: <b>Müdür</b>.'),
    tablo(['Müdür yapabilir', 'Yalnız siz'], [[
      'Sipariş, ödeme, iptal, masa taşıma, QR onayı<br>QR siparişlerini durdurma ve açma<br>Kasa ve giderler (kasa farkı hariç), iadeler<br>Stok<br>Ürünler ve kampanyalar<br>Vardiya ve bahşişi görme<br>Rezervasyon ve etkinlik<br>Satış ve Raporlar',
      'Ayarlar ve bölümlerin ayar sekmeleri<br>Çalışan hesapları<br>Kasadan "Sahip aldı / Bankaya", kapanış düzeltme<br>Gider düzeltme ve silme, otomatik giderler<br>Masa ekleme ve çıkarma, QR yenileme<br>Destek, lisans, yedek, güncelleme',
    ]]),
    not('Müdür kasa farkını hiçbir yerde görmez. Raporlar için telefon kodu kurduysanız müdür raporları açarken sizin telefonunuzdaki 6 haneli kodu yazar.', 'bilgi'),
  ].join('');
}

function sahip() {
  return [
    bolum('İşletme sahibi', 'Siz Mola\'nın her yerini görürsünüz. Sol menüde iki başlık vardır: GÜNLÜK (Masalar, Sipariş al, Kasa ve giderler, Ajanda) ve İŞLETME (Menü yönetimi, Stok, Personel, Satış ve Raporlar). Altta Ayarlar, Hesabım ve Destek durur.'),
    sekil('s-masalar', { genislik: 560, aciklamalar: ['Sol menü.', 'Günün özeti.', 'Kasa çipi ve kasa işlemleri.', 'Masa ekle, masa çıkar, sipariş al.', 'Masaların durumu renkle görünür.', '"İlk adımlar": kurulumda yapılacaklar.'] }),
    p('Her bölümün sekmeleri üsttedir. Dişli simgeli ayar sekmesi en sondadır ve yalnız size görünür.'),
    tablo(['Bölüm', 'Sekmeler'], [
      ['Kasa ve giderler', 'Bugün · Giderler · Kapanışlar · İadeler · Kasa ayarları'],
      ['Menü yönetimi', 'Ürünler · Kampanyalar · KDV oranları'],
      ['Personel', 'Çalışanlar · Vardiya ve bahşiş · Personel ayarları'],
      ['Ajanda ve rezervasyon', 'Rezervasyonlar · Etkinlikler · Takvim · Ayarlar'],
      ['Satış ve Raporlar', 'Satış · Personel · Rezervasyon'],
    ]),

    h2('Kasa ve giderler'),
    liste([
      '<b>Bugün:</b> kasa açılışı, kasa hareketi (Sahip aldı, Bankaya), Gider kaydet, İade, Gün sonu.',
      '<b>Giderler:</b> giderlerin listesi ve düzeltme. <b>Otomatik giderler</b>: kira, maaş gibi düzenli giderler günü gelince kendiliğinden yazılır.',
      '<b>Kapanışlar:</b> her gün sonu, kim saydı, fark var mı. Gerekirse <b>Düzeltme ekle</b>.',
      '<b>İadeler:</b> iade istekleri ve yanlış seçilen ödeme türünü düzeltme.',
      '<b>Kasa ayarları:</b> gün sonu kuralları, kart komisyonu, yazar kasa yardımcısı, kasiyerin iade sınırı ve Kasa güvenliği.',
    ]),
    h3('Kasa güvenliği'),
    p('Sayımı sıkılaştıran altı önlem. Hepsi kapalı gelir; <b>Önerilenleri aç</b> altısını birden açar.'),
    tablo(['Önlem', 'Açıkken'], [
      ['Açılışta kör sayım', 'Sabah kasayı açan devreden tutarı görmeden sayar.'],
      ['Kasadan çıkan parayı teslim al', 'Gün sonunda alınan parayı siz sayıp onaylarsınız.'],
      ['Vardiya devrini alan da sayar', 'Fark iki kişi arasında yazılır.'],
      ['Sayımı sıkılaştır', 'Gün sonunu yalnız siz geri alırsınız.'],
      ['POS toplamı zorunlu', 'Kart POS cihazının gün sonu toplamı yazılmadan kapanış olmaz.'],
      ['Ödeme türü değişince bildir', 'Nakit ↔ kart değişikliği size bildirilir.'],
    ]),

    h2('Menü ve kampanyalar'),
    sekil('s-menu-yonetimi', { genislik: 600, aciklamalar: ['Ürün ekle.', 'Kategorilerin sırası.', 'Menüyü önizle.', 'Taslaklar.', '"Tükendi": ürün sipariş edilemez.'] }),
    liste([
      'Ürüne dokunun: ad, fiyat, KDV, kategori, fotoğraf ve seçenekler (boy, süt). Kutu ve şişe gibi mutfakta hazırlanmayanlara <b>Hazır ürün</b> deyin.',
      'Değişiklik müşteri menüsüne hemen gider; QR kodları aynı kalır.',
      'Biten ürüne <b>Tükendi</b> deyin; menüde soluk görünür.',
    ]),
    h3('Kampanya kurmak'),
    adimlar([
      'Kampanyalar → <b>Kampanya ekle</b>.',
      'İndirim: yüzde ya da TL. Hangi ürünler?',
      'Ne zaman: tarih aralığı, haftanın belli gün ve saatleri ya da ayın bir günü.',
      'İsterseniz adet koşulu ("4 çay ve üzeri"). Yandaki kutu müşterinin göreceği fiyatı gösterir. Kaydedin.',
    ]),
    p('Kampanya kendiliğinden başlar ve biter. Bitince sonucu bir pencerede görürsünüz; <b>Kampanyayı yinele</b> aynısını yeni tarihle açar.'),

    h2('Stok'),
    hizmet('stock', 'Malzeme bitmeden haber alırsınız, ürün başına gerçek kârınızı görürsünüz.'),
    sekil('s-stok-malzemeler', { genislik: 560, aciklamalar: ['Malzemeler ve elde kalan.', 'Malzeme ekle.', 'Azalan malzeme renkli görünür.'] }),
    liste([
      '<b>Malzemeler:</b> kahve, süt gibi malzemeler ve uyarı sınırı. Sınırın altına düşünce bildirim gelir.',
      '<b>Reçeteler:</b> bir latte = 18 g kahve + 200 ml süt. Satışta stoktan kendiliğinden düşer.',
      '<b>Alış ve sayım:</b> alış, sayım ve fire kaydı. Alışta "Para nereden çıktı?" sorulur; gider kendiliğinden yazılır.',
      'Yanlış kayıt: satırın sonundaki üç nokta → <b>Bu kaydı geri al</b> (yalnız bugünün kayıtları).',
      'Satış ve Raporlar → Kârlılık: hangi ürün ne kadar kazandırıyor.',
    ]),

    h2('Satış ve Raporlar'),
    sekil('s-rapor-sade', { genislik: 600, aciklamalar: ['Dönem: Bugün, 7 gün, 30 gün, Yıl, Tümü, Tarih seç.', 'Günün tek cümlelik özeti.', '"Detaylı göster": bütün raporlar.', '"Yazdır ve paylaş".'] }),
    liste([
      '<b>Bugün</b> 05:00\'ten 05:00\'e kadardır.',
      '<b>Elde kalan</b> = satış − giderler − iadeler − kart komisyonu.',
      '<b>Detaylı göster:</b> ürünler, kârlılık, kampanyalar, çalışan başına satış, rezervasyonlar, KDV dökümü.',
      '<b>Yazdır ve paylaş → Muhasebeci için indir:</b> ayın satış, gider, kasa ve KDV bilgisi tek Excel dosyasında.',
    ]),
    not('Mola\'nın bastığı fiş bilgi fişidir; resmi fiş yazar kasadan kesilir. KDV dökümü bilgi içindir, beyanı mali müşaviriniz yapar.', 'bilgi'),
    h3('Raporlar e-postayla'),
    hizmet('email-reports', 'Gün sonu, haftalık ve aylık rapor e-postanıza gelir.'),
    p('Yazdır ve paylaş → <b>Raporları gönder</b>. Kendi e-posta hesabınızı yazın (Gmail\'de "uygulama şifresi" denen 16 harflik özel şifre gerekir), en fazla 5 alıcı ekleyin, <b>Deneme e-postası gönder</b> ile deneyin.'),

    h2('Rezervasyon ve etkinlik'),
    hizmet('reservations', 'Masa ayırma ve kapora düzenli olur.'),
    sekil('s-ajanda', { genislik: 560, aciklamalar: ['Rezervasyonlar: masa planı.', 'Etkinlikler.', 'Takvim: gün notları.', 'Seçili güne not.'] }),
    adimlar([
      'Gün ve saati seçin, <b>boş masaya dokunun</b>.',
      'Misafirin adını ve kişi sayısını yazın; telefon ve kapora isteğe bağlı. Kaydedin.',
      'Saatten 30 dakika önce masa ayrılır ve QR\'ı yeni siparişe kapanır.',
      'Misafir gelince <b>Geldi</b>: hesap onun adıyla açılır, kapora düşülür. Gelmezse <b>Gelmedi</b>.',
    ]),
    p('<b>Etkinlik</b> (maç günü, özel gece): o gece için geçici masalar açar (D1, D2…). Sipariş ve ödeme normal masa gibidir.'),

    h2('Personel'),
    sekil('s-calisanlar', { genislik: 560, aciklamalar: ['Çalışan ekle: ad, kullanıcı adı, görev, şifre.', 'Şifreyi yenile.'] }),
    liste([
      'Ayrılan çalışan: <b>Hesabı kapat</b>. Geçmişi silinmez.',
      '<b>Açık oturumlar:</b> kaybolan telefonun oturumunu buradan kapatın.',
      '<b>Vardiya ve bahşiş:</b> kim kaç saat çalıştı, kim geç kaldı, bahşiş payları. Kuralları Personel ayarları\'ndan seçersiniz.',
    ]),
  ].join('');
}

function ayarlar() {
  return [
    bolum('Ayarlar', 'Bir kez kurulan ayarlar burada durur. Beş konu vardır; her konunun altında bölümleri sıralanır.'),
    sekil('yeni-duzen-ayarlar', { genislik: 560, baslik: 'Ayarlar: konular üstte, bölümler altında.' }),
    tablo(['Konu', 'Bölümler ve işleri'], [
      ['<b>İşletme</b>', '<b>Görünüm</b> (ad, logo, renk paleti, karşılama yazısı) · <b>Sosyal medya</b> (hesaplarınız, Google değerlendirme bağlantısı) · <b>Paket ve lisans</b> (paketiniz, kalan gün, Mola ekibinin iletişim bilgileri)'],
      ['<b>Masalar ve QR</b>', 'Masa ekleme ve bölümler (İç, Bahçe) · <b>QR kodlarını yazdır</b> · Engellenen telefonlar'],
      ['<b>Sipariş ve mutfak</b>', 'QR siparişine garson onayı ya da otomatik onay, ödeme ne zaman alınır · Mutfak: Ekran ya da Fiş'],
      ['<b>Cihazlar</b>', 'Yazıcılar · Sesler · Cihaz bağla (personel tabletleri, laptop ve telefonlar)'],
      ['<b>Güvenlik ve yedek</b>', 'Yedek · Kilit ve güncelleme (sahip ekranının otomatik kilidi, raporlar için telefon kodu)'],
      ['<b>Uzaktan erişim</b>', 'Telefon kodu, e-posta, cihaz girişi, uzaktan yönetim (yalnız işletme sahibi)'],
    ]),
    h2('Renk paleti'),
    p('Ayarlar → İşletme → Görünüm → <b>Renk paleti</b>. Seçtiğiniz renk müşterinin QR menüsünü ve bütün işletme ekranlarını boyar. Masa durumu ve uyarı renkleri değişmez, böylece "hazır" ya da "gecikti" her zaman aynı renkte görünür. Kaydedince menü ve ekranlar hemen güncellenir.'),
    h2('QR kodlarını basmak'),
    sekil('s-qr-kodlari', { genislik: 560, aciklamalar: ['QR\'ın adresi: "İnternet adresi: her ağdan açılır" seçili olsun.', 'Baskı: A4\'e 6 ya da 12 QR, A6 masa standı.', 'Yazdır.'] }),
    adimlar([
      'Ayarlar → Masalar ve QR\'da <b>"Bağlı"</b> yazdığını görün (yeni kafede 10-20 dakika sürebilir).',
      'Önce bir masanın kartını basıp iki telefonla deneyin: biri Wi-Fi\'de, biri yalnız mobil veride.',
      'Sonra hepsini basın. <b>A6 masa standı</b> logonuzu, QR\'ı ve masa adını büyük yazar.',
    ]),
    liste([
      'Mat kâğıt ya da mat laminasyon kullanın; parlak yüzeyi kamera okuyamaz. QR\'ı kesmeyin, katlamayın.',
      'Bir takım yedek basıp kasada saklayın.',
      'Kaybolan ya da çalınan QR: masa penceresinde <b>QR yenile</b>, yeni kartı basın. Eski kart açılmaz.',
    ]),
    h2('Yazıcılar ve tabletler'),
    liste([
      '<b>Yazıcılar:</b> yazıcıyı ekleyin, hangi fişin (mutfak, hesap, kasa) hangi yazıcıdan çıkacağını seçin.',
      '<b>Cihaz bağla:</b> cihaz bağlama ve bağlantı kontrolü. Android uygulaması molayazilim.com.tr/indir/ adresinde ya da kasa bilgisayarındaki <b>Cihaz bağla</b> penceresinin QR kodundadır.',
    ]),
    not('Telefonlar bağlanamıyorsa: Windows Ayarları → Ağ ve İnternet → bağlantınız → Ağ profili türü: <b>Özel ağ</b>.', 'dikkat'),
  ].join('');
}

function yedekGuncelleme() {
  return [
    bolum('Yedek ve güncelleme', 'Mola verilerinizi kendiliğinden yedekler ve kendini güncel tutar. Sizin işiniz kurtarma kodunu saklamak.'),
    h3('Kasa bilgisayarının şeridi'),
    p('Kasa bilgisayarındaki Mola penceresinin solunda bir şerit vardır: <b>İkiye böl, Yedekle, Cihaz bağla, Güvenlik, Kapat</b>. Bu şerit yalnız kasa bilgisayarında görünür.'),
    sekil('d-serit', { genislik: 560, aciklamalar: ['Kasa bilgisayarının şeridi.'] }),
    h3('Kurtarma kodu'),
    sekil('d-kurtarma-kodu', { genislik: 300, yan: true, aciklamalar: ['Kurtarma kodu (bir daha gösterilmez).', 'Yazdır.', '"Kaydettim".'] }),
    p('Kurtarma kodu verilerinizin anahtarıdır. Kâğıda yazın, bilgisayardan uzakta saklayın. Yedekle aynı USB belleğe ya da aynı e-postaya koymayın.'),
    h2('Yedekler'),
    tablo(['Ne zaman', 'Ne olur'], [
      ['Gün sonu', 'Kapanıştan 1 dakika sonra yedek alınır.'],
      ['Gece 03:30', 'O gün değişiklik olduysa yedek alınır.'],
      ['İstediğiniz an', 'Şerit → <b>Yedekle</b> → <b>Şimdi yedekle</b>.'],
    ]),
    liste([
      '<b>İkinci yedek yeri:</b> bir USB bellek seçin; her yedeğin kopyası oraya da gider.',
      'Ayarlar → Güvenlik ve yedek → <b>Yedekleriniz nerede?</b> son yedeklerin zamanını gösterir.',
      'Her takvim yılı ertesi yılın 1 Şubat\'ında kapanır. Kapanmış yıla kayıt girilmez; kaydı bugünün tarihiyle girin.',
    ]),
    hizmet('cloud-backup', 'Yedeğin şifreli bir kopyası Mola\'nın sunucusunda da durur; bilgisayar bozulursa yeni bilgisayara kolayca geçersiniz.'),
    h2('Bilgisayarım bozuldu'),
    tablo(['Durumunuz', 'Ne yaparsınız'], [
      ['Şifrenizi biliyorsunuz', 'Yeni bilgisayara Mola\'yı kurun → <b>İşletmem var</b> → e-posta, kullanıcı adı ve şifre → e-postanıza gelen kod → <b>İndir ve geri yükle</b>.'],
      ['Şifreyi unuttunuz, kurtarma kodu kâğıtta', 'Mola ekibini arayın, <b>taşıma kodu</b> alın. İlk ekranda <b>Mola Merkez\'den geri yükle</b>: taşıma kodu + kurtarma kodu.'],
      ['Bilgisayar çalışıyor, yalnız şifreyi unuttunuz', 'Şerit → <b>Güvenlik</b> → <b>İşletme sahibi şifresini unuttum</b>.'],
      ['Şifre de kurtarma kodu da yok', 'Veriler açılamaz; Mola ekibi de açamaz.'],
    ]),
    not('<b>İşletmem var</b> için hazırlık: Ayarlar → Güvenlik ve yedek → Yedek\'teki <b>Yeni bilgisayar için e-posta</b> kartı "İşletmem var hazır" demelidir. Demiyorsa e-postanızı doğrulayıp <b>Hazırla</b>\'ya basın.', 'ipucu'),
    h2('Güncelleme'),
    p('Yeni sürüm kendiliğinden indirilir. Hazır olunca ekranınızda bir pencere açılır:'),
    tablo(['Seçenek', 'Ne olur'], [
      ['<b>Şimdi güncelle</b>', 'Önce verileriniz yedeklenir. Pencerede yüzde ilerler; Mola kısa bir süre kapanıp açılır ve sayfa kendiliğinden yenilenir. Bu sırada pencereyi ve bilgisayarı kapatmayın.'],
      ['<b>1 saat sonra hatırlat</b>', 'Pencere bir saat sonra yeniden gelir.'],
      ['<b>Kapanışta kur</b>', 'Gün sonunda ya da yarın açılışta kendiliğinden, yedek alınarak kurulur.'],
    ]),
    liste([
      'Açık masa ya da bitmemiş sipariş varken <b>Şimdi güncelle</b> kapalıdır; hesaplar kapanınca güncelleyebilirsiniz.',
      'Erteleseniz de Masalar\'ın üstünde "Yeni sürüm hazır" yazar; <b>Şimdi kur</b> pencereyi yeniden açar.',
      'Yeni sürüm açılmazsa Mola önceki sürüme kendiliğinden döner, verileriniz yerinde kalır.',
      'Tabletler ve diğer açık ekranlar boş bir anda kendiliğinden yenilenir.',
    ]),
  ].join('');
}

function uzaktan() {
  return [
    bolum('Telefondan takip ve destek'),
    h2('Raporlarım telefonda'),
    hizmet('remote-reports', 'Kafede olmasanız da bugünün satışını ve kasayı telefonunuzdan görürsünüz.'),
    sekil('t-raporlarim', { genislik: 220, yan: true, aciklamalar: ['Bugünün satışı: nakit, kart, sipariş sayısı.'] }),
    p('Kasada bir kez: <b>Ayarlar → Uzaktan erişim</b>. Sonra her yerden tek adres.'),
    adimlar([
      '<b>Telefon kodunu kurun</b>: telefona ücretsiz bir doğrulama uygulaması kurun, ekrandaki QR kodu okutun, uygulamadaki 6 haneli kodu yazın. Kurtarma kodlarını kâğıda yazın.',
      '<b>E-postanızı doğrulayın</b>: adresinizi yazın, gelen 6 haneli kodu girin.',
      'Sonra telefonunuzda ve laptopunuzda <b>merkez.molayazilim.com.tr/raporlarim</b> adresine e-posta, şifre ve kodla girin. Önce telefon, sonra laptop.',
    ]),
    p('Cihaz bir kez girince hatırlanır. Yeni cihaz girerken kasa bilgisayarı açık olmalı; kasa kapalıyken de raporlar son durumla açılır.'),
    p('En fazla 3 cihaz. Kaybolan telefonu aynı sayfadan kaldırın: şifreniz sorulur, telefon kodu sorulmaz. Ortak bir laptopta işiniz bitince <b>Çıkış</b>\'a basın.'),
    h2('Uzaktan yönetim'),
    hizmet('remote-admin', 'Kafeye gitmeden fiyat değiştirir, kampanya açar, çalışan hesabı kapatırsınız.'),
    adimlar([
      'Raporlarım\'a telefonunuzla girin (yukarıda).',
      '<b>4 · Uzaktan yönetim</b>\'de <b>Aç</b>: şifre ve 6 haneli kod. Bu adım yalnız kafede yapılır.',
      'Raporlarım → <b>Kafeyi yönet · Satış ve Raporlar, menü, ayarlar</b>: her girişte şifre ve telefon kodu.',
    ]),
    p('Her uzaktan giriş size bildirilir.'),
    h3('İki ekran'),
    hizmet('split-screen', 'Kasa bilgisayarında ekranı ikiye bölersiniz: solda kasa, sağda mutfak ya da ikinci kasiyer.'),
    p('Şeritten <b>İkiye böl</b>. Her yarıya ayrı hesapla girilir; <b>Tek ekran</b> ile geri dönersiniz.'),
    h3('Bildirimler'),
    p('Sağ üstteki <b>zil</b> kasa farkı, iade isteği, azalan stok, lisans ve yedek uyarılarını toplar. Her bildirimin yanındaki düğme ilgili yeri açar.'),
    h2('Destek'),
    sekil('s-destek', { genislik: 560, aciklamalar: ['Talepler: Mola ekibiyle yazışma.', 'Duyurular: Mola ekibinin duyuruları.', 'Mola desteği: destek izni.'] }),
    liste([
      '<b>Talepler → Yeni talep:</b> sorunu yazın, isterseniz ekran fotoğrafı ekleyin. Yanıt aynı yazışmaya gelir.',
      '<b>Duyurular:</b> Mola ekibinin duyuruları. Önemli olanlar girişte pencereyle gelir.',
      '<b>Mola desteği:</b> <b>Mola ekibi bağlanabilsin</b> açıkken ekibimiz ekranlarınızı açıp yardım eder. Satışlarınızı, ödemeleri, kasa kapanışlarını ve şifreleri göremez. Siz kapatana kadar açık kalır.',
    ]),
  ].join('');
}

function sorular() {
  return [
    bolum('İnternet, sorular ve sorunlar'),
    h2('İnternet kesilirse'),
    tablo(['Ne', 'İnternet yokken'], [
      ['Garson, kasa, mutfak, yazıcı', '<b>Çalışır.</b> Hepsi kafenin Wi-Fi\'si üzerinden kasa bilgisayarına bağlıdır.'],
      ['Müşterinin QR menüsü', 'Menü görünür, <b>sipariş verilemez</b>. Siparişi garson alır.'],
      ['Telefondan raporlar, e-posta, destek, bulut yedek', 'İnternet gelince devam eder.'],
      ['Lisans', 'Mola 14 güne kadar internetsiz çalışır.'],
    ]),
    p('İnternet uzun süre gelmeyecekse kasa bilgisayarını telefonunuzun internet paylaşımına (hotspot) bağlayın. Kasa bilgisayarı kapalıysa hiçbir ekran çalışmaz; açılınca Mola kaldığı yerden devam eder.'),
    h2('Sık sorulanlar'),
    sss('Şifremi unuttum.', 'Çalışan şifresini siz verirsiniz: Personel → Çalışanlar → <b>Şifreyi yenile</b>. Kendi şifreniz için kasa bilgisayarındaki şeritten Güvenlik → <b>İşletme sahibi şifresini unuttum</b>.'),
    sss('Ekran kendiliğinden kilitlendi.', 'Sahip ekranının otomatik kilidi. Şifrenizi yazıp <b>Kilidi aç</b>. Süre: Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme.'),
    sss('Fiyat değiştirdim, QR\'ları yeniden basmalı mıyım?', 'Hayır. Değişiklik menüye hemen gider.'),
    sss('Kart yerine nakit seçtim.', 'Kasa ve giderler → İadeler\'den ödemeyi düzeltin.'),
    sss('Muhasebecim hangi dosyayı istiyor?', 'Satış ve Raporlar → Yazdır ve paylaş → <b>Muhasebeci için indir</b>.'),
    h2('Sorun giderme'),
    tablo(['Ne oluyor', 'Ne yapın'], [
      ['Tablet "bağlantı yok" diyor', 'Tablet kafenin Wi-Fi\'sinde mi, kasa bilgisayarı açık mı? Modemde kasa bilgisayarına sabit IP verin.'],
      ['QR menü açılmıyor', 'Ayarlar → Masalar ve QR\'da "Bağlı" yazıyor mu? Kasa bilgisayarı açık ve internette mi?'],
      ['Müşteri "Şu an sipariş almıyoruz" görüyor', 'Sol menüdeki QR siparişleri kartına bakın ve <b>Siparişleri aç</b>; ya da bir personel ekranında giriş yapın.'],
      ['Müşteri "Şu an sipariş alınamıyor" görüyor', 'Kafenin interneti ya da kasa bilgisayarı kapalı.'],
      ['Fiş çıkmıyor', 'Kâğıdı ve kabloyu kontrol edin, <b>Tekrar bas</b>. Yazıcının IP adresi Ayarlar → Cihazlar → Yazıcılar\'dakiyle aynı mı?'],
      ['Ses gelmiyor', '"Ses kapalı · açmak için dokunun" yazısına dokunun, tabletin sesini açın.'],
      ['Mutfak tableti kararıyor', '<b>Ekranı açık tut</b>\'u açın, tableti şarjda tutun.'],
      ['Yedek hatası', 'USB bellek takılı mı, disk dolu mu? Çözülmezse Destek\'ten yazın.'],
    ]),
    h3('Mola ekibine ulaşın'),
    liste([
      'En hızlı yol: <b>Destek → Talepler</b>. Ekran fotoğrafı ekleyin.',
      'Telefon, WhatsApp ve e-posta: Ayarlar → İşletme → Paket ve lisans → "Mola ekibine ulaşın".',
      'Web: molayazilim.com.tr',
    ]),
    not('Mola ekibi sizden asla şifrenizi ya da kurtarma kodunuzu istemez.', 'dikkat'),
  ].join('');
}

export function kullanimKilavuzu(): Belge {
  return {
    dosya: 'Mola-Kullanim-Kilavuzu.pdf', baslik: 'Kullanım Kılavuzu', altBaslik: 'Kafeler ve restoranlar için adım adım', kisa: 'Mola Kullanım Kılavuzu', tocDerinlik: 2,
    kapakNotu: '<p>Mola\'yı ilk günden rahatça kullanmanız için kısa bir rehber: önce kurulum, sonra her çalışanın günlük işi, en sonda ayarlar, yedek ve sık sorulanlar.</p><p>Ekranlardaki kırmızı numaralar, altındaki ya da yanındaki aynı numaralı açıklamayı gösterir. Ekran görüntüleri örnek işletme "Mola Örnek Kafe"den alınmıştır.</p>',
    icerik: [tanitim(), ilkGun(), musteri(), garson(), kasiyer(), mutfak(), mudur(), sahip(), ayarlar(), yedekGuncelleme(), uzaktan(), sorular()].join(''),
  };
}

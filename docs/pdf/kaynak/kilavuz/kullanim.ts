/*
 * Mola Kullanım Kılavuzu (kafeler ve restoranlar için). FİYAT YAZILMAZ. Her özelliğin hizmeti ve başlangıç paketleri
 * packages/domain/features.ts'ten gelir (hizmet()). Metinde uzun tire kullanılmaz.
 */
import { features, defaultPackages } from '../../../../packages/domain/features.ts';
import type { Belge } from './sablon.ts';
import { adimlar, bolum, h2, h3, hizmet, liste, not, p, sekil, serit, sss, tablo } from './sablon.ts';

const ok = '<b style="color:#1f5135">✓</b>', yok = '<span style="color:#a3a8a3">–</span>';

function tanitim() {
  const satilan = features.filter(f => !f.soon);
  return [
    bolum('Mola\'yı tanıyın', 'Mola, kafenizin adisyon programı ve QR menüsüdür. Siparişler, mutfak, kasa, menü ve raporlar tek yerde durur. Verileriniz kafenizdeki bilgisayarda saklanır.'),
    h2('Kim neyi kullanır?'),
    p('Mola\'da beş çeşit hesap vardır. Her çalışan yalnız kendi işine yarayan ekranları görür.'),
    tablo(['Hesap', 'Nerede çalışır', 'Günlük işi'], [
      ['<b>Garson</b>', 'Telefon', 'Masaları izler, sipariş alır, QR siparişlerini onaylar, servis eder.'],
      ['<b>Kasiyer</b>', 'Kasa bilgisayarı ya da tablet', 'Kasayı açar, ödeme alır, masasız satış yapar, gün sonunu kapatır.'],
      ['<b>Mutfak</b>', 'Mutfaktaki tablet ya da ekran (ya da fiş yazıcısı)', 'Siparişleri hazırlar, "Hazır" der, stok sayar.'],
      ['<b>Müdür</b>', 'Her cihaz', 'Sahibin yerine günü yönetir: menü, stok, raporlar, iadeler.'],
      ['<b>İşletme sahibi</b>', 'Her cihaz, telefonundan uzaktan da', 'Her şeyi görür ve ayarlar.'],
    ]),
    h2('Hizmetler ve paketler'),
    p('Mola hizmetlerden oluşur. "Adisyon çekirdeği" her pakette vardır; diğer hizmetler ihtiyacınıza göre eklenir. Üç başlangıç paketi vardır: <b>Çay bahçesi</b>, <b>Kafe Standart</b> ve <b>Restoran Pro</b>. Mola ekibi size özel bir paket de hazırlayabilir.'),
    tablo(['Hizmet', 'Ne yapar', ...defaultPackages.map(x => x.name)], satilan.map(f => [`<b>${f.name}</b>`, f.description, ...defaultPackages.map(x => (x.features as string[]).includes(f.id) ? ok : yok)]), 'kucuk'),
    p('Bu kılavuzda özelliklerin başında küçük bir kutu vardır: özelliğin hangi hizmete ait olduğunu, hangi paketlerde bulunduğunu (✓) ve size ne kazandırdığını yazar.'),
    not('Paketinizde olmayan bir hizmet ekranda <b>soluk</b> görünür ve yanında "Pakette yok" yazar. Dokununca kısa bir kart açılır; <b>"Mola ekibine yaz"</b> ile hizmeti ekletirsiniz. Kapalı bir hizmetteki verileriniz silinmez. Kasiyer, garson ve mutfak kapalı hizmetleri görmez.', 'bilgi'),
    sekil('s-kilitli-menu', { genislik: 420, yan: true, aciklamalar: ['Paketinizde olmayan bölüm soluk ve "Pakette yok" yazılı.'] }),
    h2('Bu kılavuzu nasıl okuyacaksınız?'),
    p('Ekran görüntülerinin üstündeki <b style="color:#d7261e">kırmızı numaralar</b> ve oklar, yanındaki ya da altındaki aynı numaralı açıklamayı gösterir. Ekranlar örnek işletme "Mola Örnek Kafe"dendir; tutarlar örnektir.'),
  ].join('');
}

function musteri() {
  return [
    bolum('Bir müşterinin hikâyesi', 'Ayşe Hanım kafenize geliyor, Masa 5\'e oturuyor ve telefonundan sipariş veriyor. Her adımda hangi ekranın ne yaptığını göreceksiniz.'),
    hizmet(['qr-menu', 'qr-order'], 'Müşteri garsonu beklemeden menüye bakar, siparişini kendisi verir. Garsonunuz servise ve misafire zaman ayırır; siparişler yanlış yazılmaz.'),
    h2('Masaya oturur, QR kodu okutur'),
    p('Masadaki standın üstünde masanın QR kodu ve büyük harflerle "MASA 05" yazar. Ayşe Hanım telefonunun kamerasını QR koda tutar, menü açılır. Wi-Fi şifresi sormasına gerek yoktur; QR kendi mobil verisiyle de açılır. Sipariş kafenizdeki bilgisayara gider.'),
    serit([
      { ad: 'm-menu', baslik: '1. Menü açılır', aciklamalar: ['Hangi masada olduğu üstte yazar.', 'Garsonu tek dokunuşla çağırır.', 'Kategoriler arasında gezinir.', 'Ürüne dokunur.'] },
      { ad: 'm-urun', baslik: '2. Ürünü seçer', aciklamalar: ['Boy ve süt gibi seçenekleri seçer.', 'Adedi 2 yapar.', '"Sepete ekle"ye basar.'] },
      { ad: 'm-sepet', baslik: '3. Sepete bakar', aciklamalar: ['2 Caffè Latte', '1 San Sebastian cheesecake', '"Siparişi gönder"e basar.'] },
    ]),
    p('Ekranın altındaki sepet çubuğu kaç ürün seçildiğini ve tutarı gösterir. Sepette ürün çıkarılır, adet değişir, ürüne not yazılır.'),
    not('<b>Menü her zaman görünür, sipariş her zaman değil.</b> Gün sonundan sonra, kasiyer QR siparişlerini durdurduğunda ya da kafede açık bir personel ekranı yokken menünün üstünde <b>"Şu an sipariş almıyoruz, lütfen garsonunuza sorun."</b> yazar. Müşteri menüye bakar ama sipariş gönderemez.', 'bilgi'),
    sekil('m-siparis-kapali', { genislik: 300, yan: true, aciklamalar: ['"Şu an sipariş almıyoruz, lütfen garsonunuza sorun."', '"Garson çağır" yine çalışır.'] }),
    h2('Sipariş mutfağa düşer'),
    p('İsterseniz QR siparişleri önce garsonun onayına düşer (Ayarlar → Sipariş ve mutfak → Sipariş ve onay). Garson siparişi telefonunda görür ve "Onayla ve mutfağa gönder" der. "Otomatik onay" açıksa sipariş doğrudan mutfağa gider.'),
    serit([
      { ad: 'm-gonderildi', baslik: '4. Sipariş gönderildi', aciklamalar: ['Müşteri siparişin alındığını görür.'] },
      { ad: 'g-qr-onay', baslik: '5. Garson onaylar', aciklamalar: ['Masa ve sipariş numarası.', 'Mutfağa gönderir.', 'Gerekirse reddeder.'] },
    ], { genislik: 230 }),
    p('Müşteri gönderdikten sonra kısa bir süre (örnekte 60 saniye) siparişini kendisi düzeltebilir. Mutfakta bu süre "Müşteri değiştirebilir" diye görünür; bitince "Hazırlamaya başla" çıkar.'),
    sekil('k-yeni', { genislik: 600, aciklamalar: ['Masa 5\'in siparişi "Yeni sipariş" sütununa düştü.', '"Hazırlamaya başla", sonra "Hazır olarak işaretle".', 'Üstte her aşamada kaç sipariş olduğu yazar.'] }),
    h2('Garson servis eder'),
    p('Mutfak "Hazır" deyince garsonun telefonu sesle ve titreşimle haber verir. Garson tepsiyi masaya götürür ve "Teslim edildi"ye basar.'),
    serit([
      { ad: 'g-servise-hazir', baslik: '6. Servise hazır', aciklamalar: ['Bekleyen sipariş sayısı.', 'Masa 5\'in siparişi.', 'Masaya götürünce "Teslim edildi".'] },
      { ad: 'm-siparislerim', baslik: '7. Müşteri takip eder', aciklamalar: ['"Siparişlerim": masanın bütün hesabı; garsonun eklediği ürünler "Garson ekledi" yazar.', 'Siparişin durumu.', 'Hesabı ister.'] },
    ], { genislik: 230 }),
    h2('Hesabı ister, öder'),
    p('Ayşe Hanım "Hesabı iste"ye basar ve nasıl ödeyeceğini seçer: nakit ya da kart. Kasada ve garsonların ekranında "Masa 05 · Hesap istiyor" uyarısı çıkar.'),
    serit([
      { ad: 'm-hesap-iste', baslik: '8. Nasıl ödeyecek?', aciklamalar: ['Nakit ya da kart seçer.'] },
      { ad: 'm-hesap-istendi', baslik: '9. Hesap istendi', aciklamalar: ['Düğme "Hesap istendi" olur; kasa haberdardır.'] },
    ], { genislik: 230 }),
    sekil('c-odeme', { genislik: 520, aciklamalar: ['Kasiyer ödeme türünü seçer (burada kart).', 'İsterse bahşişi ayrıca yazar.', '"Ödemeyi kaydet" ile hesap kapanır.'] }),
    h2('"Hesabınız kapandı"'),
    sekil('m-kapandi', { aciklamalar: ['Müşterinin telefonunda "Hesabınız kapandı" yazar.', 'Google\'da değerlendirme bağlantısı.', 'Instagram\'da takip bağlantısı.'] }),
    p('Ödeme kaydedilince müşterinin telefonu bunu kendiliğinden gösterir. Altında <b>"Bizi değerlendirin ve takip edin"</b> kartı çıkar: Google değerlendirme düğmesi ve sosyal medya hesaplarınız. Memnun bir müşteri iki dokunuşla size yorum bırakır.'),
    p('Menünün en altındaki <b>"Gizlilik"</b> bağlantısında müşteri, menünün hangi bilgileri kullandığını sade bir dille okur.'),
  ].join('');
}

function garson() {
  return [
    bolum('Garson', 'Garson Mola\'yı telefonundan kullanır. Altta beş düğmelik bir menü vardır.'),
    hizmet('core', 'Garson sipariş defteri taşımaz, mutfağa koşmaz. Sipariş birkaç dokunuşla mutfağa gider, hazır olunca telefon haber verir.'),
    h2('Masalar'),
    sekil('g-masalar', { aciklamalar: ['Tek satırda özet: kaç masa açık, toplam açık hesap.', 'Filtreler: Tümü, Açık, Boş, Hazır.', 'Her masa küçük bir kutu: masa numarası, tutar, durum.', 'Alt menü: Masalar, Sipariş al, Servise hazır, Rezervasyon, Daha fazla.'] }),
    p('Garson çağıran masalar ve onay bekleyen QR siparişleri masaların üstünde küçük bir şeritte durur. Bir masaya dokununca masanın penceresi açılır.'),
    sekil('g-masa-penceresi', { aciklamalar: ['"Sipariş ekle" bu masaya yeni sipariş açar.', '"Taşı / birleştir" hesabı başka masaya taşır ya da iki masayı birleştirir.'] }),
    p('<b>Kalabalık grup:</b> masanın penceresinde <b>Taşı / birleştir</b>\'e basın, "Dolu masalar" arasından diğer masayı seçin ve <b>Hesapları birleştir</b> deyin. Siparişler ve alınan ödemeler tek hesapta toplanır.'),
    h2('Sipariş almak'),
    adimlar(['Alt menüden <b>Sipariş al</b>\'a dokunun.', 'Üstteki masa çipinden masayı seçin (örneğin "Masa 08").', 'Ürünün yanındaki <b>+</b> düğmesine basın. Seçenekli üründe küçük bir pencere açılır. Ürünü adıyla ya da numarasıyla arayabilirsiniz.', 'Alttaki çubukta <b>Gönder</b>\'e basın. Sipariş mutfağa gider, telefon Masalar\'a döner.']),
    sekil('g-siparis', { aciklamalar: ['Siparişin masası. İlk seçenek "Masasız sipariş".', 'Ürün adı ya da numarasıyla arama.', 'Yuvarlak + bir adet ekler.', 'Sepet çubuğu: ürün sayısı, tutar ve Gönder.'] }),
    p('Çubuğun soluna dokununca sepet açılır: adedi değiştirir, ürüne not yazarsınız ("az şekerli"). Götürülecek ürün için <b>"Paket yapılsın"</b>, hepsi için <b>"Hepsini paketle"</b>; mutfakta ve fişte <b>PAKET</b> yazar.'),
    sekil('g-sepet', { aciklamalar: ['Adedi artırın ya da azaltın.', '"Hepsini paketle": siparişin tamamı götürülecek.', 'Siparişi mutfağa gönderin.'] }),
    h2('QR siparişlerini onaylamak'),
    p('İşletmeniz onay istiyorsa müşterinin siparişi "QR sipariş onayları" kutusuna düşer ve telefon kısa bir ses çalar. Doğruysa "Onayla ve mutfağa gönder", yanlışsa "Reddet" deyin.'),
    h2('Servise hazır ve "Teslim edildi"'),
    p('Mutfak bir siparişi hazır yapınca telefonunuz titrer ("Masa 03 · #5 hazır") ve "Servise hazır" düğmesinde sayı belirir. Siparişi götürünce <b>"Teslim edildi"</b>ye basın. Masalar garsonlara paylaştırıldıysa yalnız kendi masalarınızın haberi gelir; diğerleri <b>"Diğer garsonların masaları"</b>ndadır.'),
    h2('Siparişi değiştirmek'),
    p('Müşteri fikrini değiştirdiyse masanın penceresinde siparişin altındaki <b>Değiştir</b>\'e basın, yeni ürünü ya da adedi seçin ve <b>Değişikliği kaydet</b> deyin. Hesap kendiliğinden düzelir, mutfak değişikliği görür.'),
    liste(['Mutfak hazırlamaya başladıysa ürünü <b>İptal et</b> ile çıkarıp yenisini sipariş edin.', '<b>Hazır ürünler</b> (kola, ayran, su) hesap ödenene kadar <b>Hazır ürünü değiştir</b> ile değişir.', 'Ödemesi alınmış ürün değişmez; gerekirse işletme sahibi iade yapar.']),
    h2('Garson çağrısı ve hesap isteme'),
    p('Müşteri garson çağırınca ya da hesap isteyince ekranın üstünde renkli bir şerit çıkar: "Masa 15 · Garson çağırıyor · 3 dk bekliyor". Masaya gidince <b>Tamam</b>\'a basın.'),
    p('Bir masada uzun süredir (başlangıçta 45 dakika) yeni sipariş yoksa ekranda <b>"Masa 5: 45 dakikadır yeni sipariş yok. Bir isteği var mı?"</b> notu çıkar. Masaya uğrayınca <b>Gittim</b>\'e basın.'),
    h2('QR siparişleri açık mı?'),
    p('QR siparişleri kapalıysa üst çubuğun altında sarı bir satır durur: <b>"QR siparişleri kapalı"</b> ve nedeni. Müşteri sipariş veremez; siparişi siz alırsınız. Açmak için kasiyere, müdüre ya da sahibe söyleyin.'),
    h2('Daha fazla'),
    sekil('g-daha-fazla', { aciklamalar: ['"Daha fazla" alttan açılır: Ajanda ve rezervasyon, Hesabım ve Çıkış yap gibi diğer yerler.'] }),
    liste(['<b>Rezervasyon:</b> işletme sahibi izin verdiyse garson da masa ayırabilir.', '<b>Hesabım:</b> kendi şifrenizi değiştirirsiniz.', '<b>Oturumlar 05:00\'te biter.</b> Ertesi gün yeniden giriş yaparsınız; sepetinizdeki ürünler kaybolmaz.']),
  ].join('');
}

function kasiyer() {
  return [
    bolum('Kasiyer', 'Kasiyer Mola\'yı genellikle kasadaki bilgisayardan kullanır. Kasayı açar, ödemeleri alır, masasız satış yapar ve günü kapatır.'),
    hizmet('core', 'Hangi ödemenin nakit, hangisinin kart olduğu, kasada ne kadar para olması gerektiği ve gün sonunda fark olup olmadığı kendiliğinden hesaplanır.'),
    h2('Güne başlarken: kasa açılışı'),
    p('Sabah ilk girişte Masalar ekranında "Kasa açılışı" kutusu çıkar. Kasadaki nakdi sayın, tutarı yazın ve "Açılışı kaydet"e basın. Dünkü kapanıştan farklıysa işletme sahibine bildirilir. Vardiya devrinden sonra gelen kişi için aynı kutu <b>"Vardiya devrini al"</b> diye çıkar.'),
    sekil('c-kasa-acilis', { genislik: 560, aciklamalar: ['Kasadaki nakit (örneğin 500).', '"Açılışı kaydet".'] }),
    h2('Ödeme almak'),
    adimlar(['Masalar ekranında masaya dokunun ve <b>Ödeme al</b>\'a basın.', 'Ne kadar ödeneceğini seçin: tamamı, bir kısmı ya da ürün seçerek (hesabı bölmek için).', 'Ödeme türünü seçin: <b>Nakit</b> ya da <b>Kart</b>. Nakitte "Alınan nakit"i yazın (hızlı düğmeler: Tam, ₺100, ₺200, ₺500, ₺1000); para üstü büyük yazıyla görünür.', 'İsterseniz "+ Bahşiş ekle" ile bahşişi ayrıca yazın. Bahşiş satıştan sayılmaz.', '<b>Ödemeyi kaydet</b>\'e basın. Hesap tamamen ödendiyse masa kapanır.']),
    sekil('c-masa-penceresi', { genislik: 500, aciklamalar: ['Masa penceresindeki "Ödeme al".'] }),
    sekil('c-odeme-nakit', { genislik: 420, yan: true, aciklamalar: ['Ne kadar ödenecek: tamamı, bir kısmı ya da ürün seçerek.', 'Ödeme türü: Nakit.', 'Alınan nakit; para üstü hemen altında.', '"Ödemeyi kaydet".'] }),
    p('<b>Fiş basılamazsa</b> ekranın üstünde kırmızı bir satır nedenini söyler (örneğin "Yazıcıda kâğıt yok · Kasa"). Sorunu giderip <b>Tekrar bas</b>\'a basın.'),
    h2('Yazar kasa yardımcısı'),
    p('İşletme sahibi Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa\'dan açarsa her ödemeden sonra köşede küçük bir kart yazar kasaya (ÖKC) neyin girileceğini söyler: KDV departmanı, tutar, ödeme türü. Girince <b>"Girildi"</b>ye basın. Mola yazar kasaya bağlanmaz; tutarları siz girersiniz.'),
    sekil('c-yazar-kasa', { genislik: 400, yan: true, aciklamalar: ['Yazar kasaya girilecek tutar, KDV departmanı ve ödeme türü.', 'Girince "Girildi"ye basın.'] }),
    h2('Masasız (al götür) satış'),
    p('Tezgâhtan alıp giden müşteri için masa açmanıza gerek yoktur. Sipariş al ekranındaki ilk seçenek <b>"Masasız sipariş"</b>tir.'),
    sekil('c-siparis-al', { genislik: 600, aciklamalar: ['"Masasız sipariş": masaya bağlı olmayan satış.', 'Ya da masayı seçin.'] }),
    adimlar(['"Masasız sipariş"e basın ve müşterinin adını yazın.', 'Ürünleri ekleyin ve siparişi gönderin. Mutfakta "MASASIZ #1" olarak görünür.', 'Ödeme penceresi hemen açılır. Müşteri sonra ödeyecekse "Sonra öde" deyin.', 'Sipariş Masalar ekranındaki "Masasız siparişler" şeridinde durur. Hazır olunca müşteriye verin ve <b>"Teslim edildi"</b>ye basın.']),
    sekil('c-masasiz', { genislik: 420, yan: true, aciklamalar: ['Müşterinin adı (çağırırken kullanılır).', 'Sepeti görüntüleyip gönderin.'] }),
    h2('Kasa işlemleri'),
    p('Masalar ekranındaki yeşil kasa çipine ("Kasa açık · 08:12\'den beri") dokununca kasa işlemleri açılır. Aynı işler soldaki menüde (telefonda alt çubukta) <b>Kasa</b>\'dadır.'),
    sekil('c-kasa-menu', { genislik: 300, yan: true, aciklamalar: ['Kasa çipi: kasanın ne zamandan beri açık olduğu ve açılış tutarı.', '"Gider kaydet": yapılan bir ödeme (ekmek, süt). Para <b>Kasadan</b> mı, <b>Kasa dışından</b> mı çıktı seçersiniz; yalnız "Kasadan" kasadaki nakitten düşer.', '"İade": müşteriye para iadesi.', '"Gün sonu": kasayı kapatır.'] }),
    liste(['<b>Para bozdurma:</b> kasaya giren ve çıkan bozuk parayı kaydeder; toplam değişmez.', '<b>Kasa hareketi:</b> kasaya para konması ya da çıkması.', '<b>Vardiya kodu:</b> vardiya takibi açıksa çalışanların vardiyaya başlarken yazdığı kod.']),
    h2('İade'),
    p('İade penceresinde bugünkü ödemeler listelenir. Masa, tutar ya da saatle arayın, ödemeye dokunun, iade edilecek ürünleri ve nedeni seçin. Kasiyerin iade sınırı vardır; fazlası için işletme sahibine istek gider. Sahip iadeyi kendi telefonundan yaparsa kasada yeşil bir şerit çıkar: "Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye verin."'),
    sekil('c-iade', { genislik: 420, yan: true, aciklamalar: [] }),
    h2('Gün sonu'),
    adimlar(['Kasa çipinden <b>Gün sonu</b>\'na basın. Pencere açık hesapları ve mutfakta bitmemiş siparişleri söyler.', 'Kasadaki nakdi sayıp yazın ve "Sayımı kaydet"e basın. Kasiyer ve müdür beklenen tutarı ve farkı görmez; fark yalnız işletme sahibine gösterilir.', 'Yazar kasa yardımcısı açıksa Z raporu toplamını yazın.', '<b>"Kapanışı tamamla"</b>ya basın. Bir dakika sonra kendiliğinden yedek alınır.']),
    sekil('c-gun-sonu', { genislik: 360, yan: true, baslik: 'Kasa sayımı: banknot ve madeni paraları tek tek ya da tek toplam olarak yazın.' }),
    sekil('c-gun-sonu-sonuc', { genislik: 360, yan: true, baslik: 'Sayımdan sonra', aciklamalar: ['İşletme sahibinde: sayılan ve beklenen nakit; fark varsa "Kasa fazla" ya da "Kasa eksik" yazar ve açıklama istenir. Kasiyer ve müdür yalnız saydıkları tutarı görür.', 'Yazar kasa yardımcısı açıksa: Z raporu toplamı ve yazar kasaya girilmemiş görünen ödemeler.'] }),
    not('İş günü 05:00\'te döner. Gece 01:30\'da yaptığınız satış o gecenin gününe yazılır.', 'bilgi'),
    h2('QR siparişlerini durdurmak ve açmak'),
    p('Sol menünün üstünde (telefonda üst çubuğun altında) QR siparişlerinin durumu yazar. Açıkken yeşil kartta <b>"QR siparişleri açık"</b> ve <b>Durdur</b> düğmesi durur. Kapalıyken kart sarıdır, nedenini yazar ve <b>Siparişleri aç</b> düğmesi çıkar. Menü her durumda görünür.'),
    tablo(['Kartta yazan', 'Ne yapılır'], [
      ['Gün sonu yapıldı', 'Satışa devam edecekseniz <b>Siparişleri aç</b>\'a basın. Sabah kasayı açınca ya da 05:00\'te kendiliğinden açılır.'],
      ['Elle durduruldu', '<b>Siparişleri aç</b>\'a basın.'],
      ['Personel ekranı bağlı değil', 'Mutfak, garson ya da kasa ekranından birini açıp giriş yapın; siparişler kendiliğinden açılır.'],
    ]),
    sekil('c-qr-durumu', { genislik: 520, aciklamalar: ['Gün sonundan sonra sol menüdeki kart: "QR siparişleri kapalı · Gün sonu yapıldı".', '"Siparişleri aç": tek dokunuşla yeniden açar.', 'Masalar\'ın üstündeki ince şerit; "Aç" aynı işi yapar.'] }),
    p('Mutfak yetişemiyorsa ya da kısa bir ara verecekseniz karttaki <b>Durdur</b>\'a basın ve onaylayın. Durdurup açma kasiyer, müdür ve işletme sahibi ekranındadır; garson yalnız görür.'),
  ].join('');
}

function mutfak() {
  return [
    bolum('Mutfak', 'Mutfak iki şekilde çalışabilir: mutfaktaki bir tablet ya da ekranda (Ekran modu) veya mutfak yazıcısından çıkan fişlerle (Fiş modu).'),
    hizmet('core', 'Siparişler kâğıt kaybolmadan, sırasıyla ve hangi masaya ait olduğu belli olarak mutfağa düşer. Geciken sipariş renk değiştirir.'),
    h2('Mutfak ekranı'),
    sekil('k-pano', { genislik: 620, aciklamalar: ['Yeni siparişler.', 'Hazırlananlar.', 'Hazır olanlar: garson götürünce "Teslim edildi".', '"Stok": mutfak sayım ve fire kaydeder.'] }),
    liste(['Her kart bir siparişdir: masa, sipariş numarası, kaç dakikadır beklediği, ürünler, seçenekler ve notlar.', '<b>"Hazırlamaya başla"</b> kartı ortadaki sütuna, <b>"Hazır olarak işaretle"</b> sağdaki sütuna taşır. Garsonun telefonu o anda haber alır.', 'Yanlışlıkla bastıysanız 5 saniye içinde <b>"Geri al"</b> çıkar.', 'Bir sipariş iptal edilirse panonun üstünde kırmızı <b>"İPTAL"</b> şeridi çıkar ve ses çalar.', 'Garson bir ürünü değiştirirse kartta turuncu <b>"Değişti"</b> satırı çıkar.', 'Sesler için ekrana bir kez dokunun. "Ekranı açık tut" tabletin kararmasını önler.']),
    sekil('k-gecikti', { genislik: 260, yan: true, aciklamalar: ['10 dakikayı geçen kart turuncu ("Gecikti"), 20 dakikayı geçen kırmızı ("Çok gecikti") olur.'] }),
    h2('Dik tablet ya da telefon'),
    sekil('k-dik', { genislik: 330, yan: true, aciklamalar: ['Dar ekranda üç sütun yerine "Yeni · Hazırlanıyor · Hazır" sekmeleri.'] }),
    h2('Fiş modu (mutfak yazıcısı)'),
    p('Mutfakta ekran kullanmıyorsanız siparişler mutfak yazıcısından fiş olarak çıkar. Fiş basılınca sipariş "Hazırlanıyor" olur. Garson götürünce "Teslim edildi" der; demezse hesap kapanınca teslim edilmiş sayılır. Garson bir ürünü değiştirirse mutfağa <b>DEĞİŞİKLİK</b> fişi çıkar.'),
    sekil('s-mutfak-modu', { genislik: 560, aciklamalar: ['Ekran: siparişler tablette kart olarak görünür.', 'Fiş: her sipariş mutfak yazıcısından çıkar.'] }),
    p('Ayar yeri: Ayarlar → Sipariş ve mutfak → Mutfak. Fiş için önce Ayarlar → Cihazlar → Yazıcılar\'dan bir yazıcıyı "Mutfak fişleri" için seçin.'),
    h2('Yazıcıda kâğıt yok'),
    p('Kâğıt bitmişse, kapak açıksa ya da yazıcı kapalıysa fiş basılmaz ve uyarı çıkar: <b>"Fiş basılamadı: Yazıcıda kâğıt yok · Mutfak."</b> Uyarı kasada, garson telefonlarında ve mutfak kartında görünür. Rulo takınca <b>Tekrar bas</b>\'a basın.'),
    not('Bazı USB yazıcılarda (özellikle "Generic / Text Only" sürücüsüyle) bu uyarı çıkmayabilir. Yazıcının kendi sürücüsünü kurun ya da ağ (Ethernet) bağlantısı kullanın.', 'bilgi'),
  ].join('');
}

function mudur() {
  return [
    bolum('Müdür', 'Müdür, işletme sahibi kafede değilken günü yönetir. Müdür hesabı her pakette vardır.'),
    hizmet('core', 'Sahibin şifresini kimseyle paylaşmadan, günlük yönetimi güvendiğiniz birine bırakırsınız.'),
    p('Müdür hesabını işletme sahibi açar: Personel → Çalışanlar → Çalışan ekle → Görevi: <b>Müdür</b>. Müdürün neyi yapıp neyi yapamayacağı aynı pencerede listelenir.'),
    sekil('mu-calisan-ekle', { genislik: 380, yan: true, aciklamalar: ['Görevi "Müdür" seçin.'] }),
    tablo(['Müdür yapabilir', 'Müdür yapamaz (yalnız sahip)'], [[
      'Sipariş, ödeme, iptal, masa taşıma, QR onayı<br>QR siparişlerini durdurma ve açma<br>Kasa ve giderler: Bugün, Giderler (kayıt ekler), Kapanışlar (farkı görmez), İadeler<br>Stok (alış dahil)<br>Menü yönetimi: Ürünler, Kampanyalar<br>Personel: Vardiya ve bahşiş (okur)<br>Ajanda, rezervasyon ve etkinlik<br>Satış ve Raporlar',
      'Ayarlar ve her bölümün ayar sekmesi (Kasa ayarları, Personel ayarları, KDV oranları, Ajanda → Ayarlar)<br>Personel → Çalışanlar (hesaplar)<br>Kasadan "Sahip aldı / Bankaya" çıkışları, kapanış düzeltme<br>Gider düzeltme ve silme, otomatik giderler<br>Masa ekleme ve çıkarma, QR yenileme<br>Destek, lisans, yedek, güncelleme',
    ]]),
    sekil('mu-ekran', { genislik: 600, aciklamalar: ['Müdürün menüsü: GÜNLÜK (Masalar, Sipariş al, Kasa ve giderler, Ajanda) ve İŞLETME (Menü yönetimi, Stok, Personel, Satış ve Raporlar); Ayarlar yoktur.', 'Kasa ve giderler: Bugün, Giderler, Kapanışlar, İadeler.'] }),
    not('Müdür kasa farkını hiçbir yerde görmez; beklenen nakit ve fark yalnız işletme sahibindedir. İşletme sahibi raporlar için telefon kodu kurduysa müdür raporları açarken <b>sahibin</b> telefonundaki 6 haneli kodu yazar.', 'bilgi'),
  ].join('');
}

function sahip() {
  return [
    bolum('İşletme sahibi', 'İşletme sahibi Mola\'nın her yerini görür. Bu bölüm menüdeki her yeri sırasıyla anlatır.'),
    h2('İlk giriş: lisans sözleşmesi'),
    p('İlk girişinizde Mola Lisans Sözleşmesi sorulur. Okuyup "Okudum, kabul ediyorum" deyin. Şimdi okuyamıyorsanız "Daha sonra" deyin; bir sonraki girişte yeniden sorulur. Bu pencere siparişleri ve kasayı durdurmaz.'),
    sekil('s-lisans-sozlesmesi', { genislik: 470, yan: true, aciklamalar: ['Sözleşmeyi kabul edin.', 'Ya da sonraya bırakın.'] }),
    h2('Masalar'),
    sekil('s-masalar', { genislik: 665, aciklamalar: ['Sol menü iki başlık altında: GÜNLÜK (Masalar, Sipariş al, Kasa ve giderler, Ajanda ve rezervasyon) ve İŞLETME (Menü yönetimi, Stok, Personel, Satış ve Raporlar); altta Ayarlar ve Hesabım, en altta Destek.', 'Günün özeti: açık masa, açık hesap, bugünkü satış, mutfaktaki ve onay bekleyen siparişler, servise hazır.', 'Kasa çipi ve kasa işlemleri (Gider kaydet, İade, Gün sonu).', 'Masa ekle, masa çıkar, sipariş al.', 'Masaların durumu renkle görünür.', '"İlk adımlar": kurulumda yapılacaklar listesi.'] }),
    p('Masalar bölümlere ayrılır (İç salon, Bahçe, Teras). Her masa durumunu renkle söyler: boş, yeni sipariş, hazırlanıyor, servise hazır, teslim edildi, onay bekliyor, temizlik bekliyor.'),
    p('<b>İlk adımlar</b> kartı kurulumda yapılacakları listeler: menüyü kontrol edin, çalışan ekleyin, yazıcı bağlayın, QR kodlarını basın, kurtarma kodunu kaydedin, ikinci yedek yerini seçin. Yaptıkça işaretlenir.'),
    h3('Masa penceresi'),
    sekil('s-masa-penceresi', { genislik: 420, yan: true, aciklamalar: ['"QR menüyü aç": masanın QR kodu ve adresi.', 'Sipariş ekle.', 'Taşı / birleştir.', 'Ödeme al.'] }),
    p('"QR kodunu indir" ile bir masanın QR kodunu resim olarak alırsınız. Kaybolan ya da çalınan bir QR için "QR yenile" eskisini geçersiz yapar.'),
    h2('Sipariş al'),
    p('İşletme sahibi de garson ve kasiyer gibi sipariş alır: masayı seçin, ürünleri + ile ekleyin, Gönder deyin. Ürün numarasıyla hızlı ekleme kutusu da vardır. Al götür satış için ilk seçenek "Masasız sipariş"tir (Kasiyer bölümünde anlatıldı).'),
    h2('Menünün düzeni'),
    p('Her konu kendi sayfasında, sekmelerle durur: günlük işi, kayıtları ve ayarı bir arada. Üstte büyük sekmeler, gerekiyorsa altında alt sekmeler vardır. Ayar sekmesi en sondadır, dişli simgesi taşır ve yalnız sizde görünür.'),
    tablo(['Bölüm', 'Sekmeler (alt sekmeler)', 'Kim görür'], [
      ['Kasa ve giderler (telefonda "Kasa")', 'Bugün · Giderler (Kayıtlar · Otomatik giderler) · Kapanışlar · İadeler · Kasa ayarları (Gün sonu · Kart ve yazar kasa · Kasiyer yetkileri · Kasa güvenliği)', 'Siz hepsini; Müdür Kasa ayarları ve Otomatik giderler hariç; kasiyer yalnız Bugün'],
      ['Menü yönetimi', 'Ürünler · Kampanyalar · KDV oranları', 'Siz; Müdür KDV oranları hariç'],
      ['Personel', 'Çalışanlar · Vardiya ve bahşiş (Vardiyalar · Bahşiş) · Personel ayarları (Vardiya · Bahşiş · Garson ataması)', 'Siz; Müdür yalnız Vardiya ve bahşiş'],
      ['Ajanda ve rezervasyon', 'Rezervasyonlar · Etkinlikler · Takvim · Ayarlar', 'Siz; Müdür Ayarlar hariç; kasiyer ve garson izinle'],
      ['Satış ve Raporlar', 'Satış (Özet, Ürünler, Kârlılık, Kampanyalar) · Personel (Çalışanlar) · Rezervasyon', 'Siz ve Müdür'],
      ['Ayarlar', 'İşletme · Masalar ve QR · Sipariş ve mutfak · Cihazlar · Güvenlik ve yedek', 'Yalnız siz'],
    ]),
    sekil('yeni-duzen-sahip-masaustu', { baslik: 'Sol menü: GÜNLÜK ve İŞLETME başlıkları. Bölümün sekmeleri ve alt sekmeleri. Sağ üstte Bildirimler zili.' }),

    h2('Kasa ve giderler'),
    hizmet('core', 'Kasanın bugünü, giderleriniz, kasa kapanışları ve iadeler tek yerde; kasa ayarları da yanında.'),
    liste(['<b>Bugün:</b> kasa açılışı, Kasa hareketi (Sahip aldı, Bankaya, para bozdurma), <b>Gider kaydet</b>, İade, Vardiya kodu ve Gün sonu. Masalar\'daki kasa çipi bunun kısayoludur.', '<b>Giderler → Kayıtlar:</b> dönemin giderleri, "Gider ekle", "Düzelt" (yalnız siz), silinen giderler.', '<b>Giderler → Otomatik giderler:</b> kira, maaş, abonelik gibi düzenli giderler günü gelince kendiliğinden yazılır.', '<b>Kapanışlar:</b> gün sonu ve vardiya devirleri, kişilere göre farklar, "Düzeltme ekle", kapanış fişi.', '<b>İadeler:</b> tahsilatlar, bekleyen iade istekleri, iade ve ödeme türü düzeltme.', '<b>Kasa ayarları:</b> <b>Gün sonu</b> (kapanış saati, not isteyen fark, kart bahşişini kasadan nakit öde), <b>Kart ve yazar kasa</b> (POS komisyon oranı, yazar kasa yardımcısı), <b>Kasiyer yetkileri</b> (iade sınırları, nakit gider uyarısı), <b>Kasa güvenliği</b> (aşağıda).']),
    not('Raporlar için telefon kodu kurduysanız Giderler, Kapanışlar ve İadeler de bu kodla açılır. "Yazdır ve paylaş" menüsü (Yazdır / PDF, Muhasebeci için indir) burada da vardır.', 'bilgi'),
    h3('Kasa güvenliği'),
    p('Kasa ayarları → <b>Kasa güvenliği</b>\'nde sayımı sıkılaştıran altı önlem vardır. Her biri ayrı açılır; hepsi kapalı gelir. <b>Önerilenleri aç</b> altısını birden açar.'),
    sekil('s-kasa-guvenligi', { genislik: 560, aciklamalar: ['"Önerilenleri aç": altı önlemi birden açar; sonra istediğinizi kapatırsınız.'] }),
    tablo(['Önlem', 'Açıkken ne olur'], [
      ['Açılışta kör sayım', 'Sabah kasayı açan dünden devreden tutarı görmeden sayar; fark size bildirilir.'],
      ['Kasadan çıkarılan parayı teslim al', 'Gün sonunda kasadan çıkarılan para, siz <b>Bugün → Teslim al</b>\'da sayıp yazana kadar bekler; fark kapanışa yazılır. Gün sonunu siz yaptıysanız sorulmaz.'],
      ['Vardiya devrini alan da sayar', 'Devri alan kişi kasayı tutarı görmeden sayar; fark iki kişi arasında yazılır.'],
      ['Sayımı sıkılaştır', 'Gün sonunu yalnız siz geri alırsınız; sayan kişi yazar kasa bölümünde nakit / kart ayrımını görmez.'],
      ['POS toplamı zorunlu', 'Kartla ödeme alınan vardiya, banka POS cihazının gün sonu toplamı yazılmadan kapanmaz.'],
      ['Ödeme türü değişince bildir', 'Bir ödeme sonradan nakit ↔ kart diye değiştirilirse size bildirilir.'],
    ]),

    h2('Menü yönetimi'),
    hizmet('core', 'Fiyatı, ürünü, fotoğrafı ve "tükendi" durumunu anında değiştirirsiniz. Değişiklik bütün tabletlere ve müşteri menüsüne hemen gider.'),
    p('Üç sekme: <b>Ürünler</b>, <b>Kampanyalar</b> ve <b>KDV oranları</b> (yalnız siz).'),
    sekil('s-menu-yonetimi', { aciklamalar: ['Ürün ekle.', 'Kategoriler ve sıra: müşterinin göreceği sekme sırası (sürükleyin, sonra "Sırayı kaydet").', 'Menüyü önizle: müşterinin gördüğü menü.', 'Taslaklar: henüz yayınlanmamış ürün ve değişiklikler.', '"Tükendi": ürün menüde soluk görünür, sipariş alınmaz.'] }),
    sekil('s-urun-duzenle', { genislik: 420, yan: true, aciklamalar: ['Fiyat.', 'KDV oranı.'] }),
    p('Ürün penceresinde ad, fiyat, kategori, açıklama, fotoğraf, seçenek grupları (boy, süt, şeker) ve ürün kodu bulunur. Kutu, şişe gibi mutfakta hazırlanmayan ürünlerde <b>"Hazır ürün"</b>ü işaretleyin. Fotoğrafı telefonla çekip seçebilirsiniz. Değişikliği "Taslak" olarak saklayıp sonra yayınlayabilirsiniz.'),

    h3('Kampanyalar'),
    hizmet('core', 'Sakin saatleri doldurur, ürün satışını artırırsınız. Kampanya kendiliğinden başlar ve biter; kasada indirim elle yazılmaz.'),
    sekil('s-kampanyalar', { aciklamalar: ['Kampanya ekle.', 'Örnek: "Çay Keyfi: 4 çay ve üzeri %25".'] }),
    p('Kampanya beş adımda kurulur: <b>1. Ne indirimi?</b> (yüzde ya da TL), <b>2. Hangi ürünler?</b>, <b>3. Ne zaman?</b> (tarih aralığı, her hafta seçilen gün ve saatler ya da her ayın bir günü), <b>4. Sınır</b> (isteğe bağlı adet koşulu) ve <b>5. Durum</b>. Yandaki <b>"Müşteri menüde böyle görür"</b> kutusu müşterinin göreceği fiyatı gösterir.'),
    p('Kartta durum yazar: <b>Taslak</b>, <b>Planlandı</b>, <b>Aktif</b> ya da <b>Bitti</b>. Aktif kampanya menüde "Kampanyalı ürünler" altında görünür. "Sonuçları gör" kampanya raporunu açar. Kampanya bitince bir kez sonuç penceresi çıkar (satılan adet, ciro, verilen indirim); <b>Kampanyayı yinele</b> aynı kampanyayı yeni tarihlerle açar.'),
    sekil('s-kampanya-ekle', { genislik: 400, yan: true }),

    h2('Stok, reçete ve kârlılık'),
    hizmet('stock', 'Hangi malzemenin azaldığını bitmeden görür, ürün başına gerçek kârınızı öğrenirsiniz.'),
    sekil('s-stok-malzemeler', { aciklamalar: ['Malzemeler: elde ne kadar var, uyarı sınırı.', 'Malzeme ekle.', 'Sınırın altına düşen malzeme uyarı rengiyle görünür.'] }),
    liste(['<b>Malzemeler:</b> kahve, süt, şeker gibi malzemeler; birimi, elde kalan, uyarı sınırı ve birim fiyatı. Stok uyarı sınırının altına düşünce size "Azalıyor" bildirimi gelir.', '<b>Reçeteler:</b> bir latte = 18 g kahve + 200 ml süt. Hazır alınan ürün (cheesecake) adetle izlenir. Seçenekler stoktan düşen miktarı değiştirebilir (Büyük boy %150, Ekstra shot +9 g kahve, yulaf sütü sütün yerine).', '<b>Ürünler:</b> her ürünün maliyeti ve "kaç adet yapılabilir".', '<b>Alış ve sayım:</b> alış faturası, sayım ve fire kaydı. Mutfak sayım ve fire yazabilir. Alışta <b>"Para nereden çıktı?"</b> sorulur: <b>Kasadan</b>, <b>Kasa dışından</b> ya da <b>Ödenmedi (veresiye)</b>. Gider kendiliğinden Kasa ve giderler → Giderler\'e yazılır.', '<b>İşlem geçmişi:</b> sağ üstteki düğme. Kim, ne zaman, hangi malzemede ne yaptı.', 'Sipariş iptal edilince Mola "ürün yapıldı mı?" diye sorar; yapılmadıysa stok geri gelir.']),
    sekil('s-stok-receteler', { genislik: 500, aciklamalar: ['Caffè Latte\'nin reçetesi: hangi malzemeden ne kadar.'] }),
    sekil('s-stok-urunler', { genislik: 560, aciklamalar: ['"Sınırlayan malzeme": tarifte en önce bitecek malzeme; <b>i</b> hesabı gösterir.'] }),
    h3('Yanlış kaydı geri almak'),
    p('Son hareketler\'de satırın sonundaki üç noktaya basın ve <b>"Bu kaydı geri al"</b> deyin. Önce stoğun nasıl değişeceği yazılır; "Evet, geri al" demeden bir şey değişmez. Yalnız bugünün kayıtları geri alınır; daha eski bir hata için sayım yapın.'),
    sekil('s-stok-geri-al', { genislik: 560, aciklamalar: ['Satırın sonundaki üç nokta.', '"Bu kaydı geri al".'] }),
    sekil('s-rapor-karlilik', { baslik: 'Satış ve Raporlar → Satış → Kârlılık' }),
    p('Stok → Reçeteler\'deki "Kârlılığı gör" bu raporu açar. <b>"Uyarı sınırları"</b> (yalnız siz) düşük kâr uyarısının sınırlarını değiştirir.'),

    h2('Satış ve Raporlar'),
    hizmet('core', 'Günün, haftanın, ayın ve yılın sonucunu tek cümleyle görürsünüz; muhasebeciniz için dosyayı tek tuşla alırsınız.'),
    p('Satış ve Raporlar önce <b>sade özet</b> olarak açılır: tek bir cümle, dört büyük sayı, en çok kazandıran üç ürün ve kasa durumu.'),
    sekil('s-rapor-sade', { aciklamalar: ['Dönem: Bugün, 7 gün, 30 gün, Yıl ▾, Tümü, Tarih seç.', 'Günün tek cümlelik özeti ve dünle karşılaştırma.', '"Detaylı göster": bütün raporlar ve grafikler.', '"Yazdır ve paylaş": Yazdır / PDF, Muhasebeci için indir (Excel), Raporları gönder, Raporları telefonda gör.'] }),
    liste(['<b>Bugün</b> iş gününü gösterir: 05:00\'ten 05:00\'e.', '<b>Yıl ▾</b> bu yılı ya da kayıtlı eski yılları açar. <b>Tümü</b> yılları bir tablo olarak gösterir.', '<b>Elde kalan</b> = satış − giderler − iadeler − kart komisyonu. Karta dokununca hesap satır satır açılır.', '<b>Giderler</b> kartındaki "Gider kayıtlarını aç" Kasa ve giderler → Giderler\'i açar.', 'Gün sonu yapılmış bir günü seçince Kasa durumu kartında sayım, beklenen ve fark yazar (yalnız işletme sahibine).']),
    sekil('s-rapor-tumu', { aciklamalar: ['"Tümü".', 'Yıllara göre tablo ve toplam.'] }),
    h3('Detaylı raporlar'),
    sekil('s-rapor-detay', { aciklamalar: ['Gruplar: Satış, Personel, Rezervasyon.', 'Seçili grubun raporları (Özet, Ürünler, Kârlılık, Kampanyalar…).', 'Dönem çubuğu bütün raporlar için ortaktır.'] }),
    tablo(['Grup', 'Raporlar'], [
      ['Satış', 'Özet (grafik, yoğun saatler, gün notları), Ürünler, Kârlılık, Kampanyalar'],
      ['Personel', 'Çalışanlar (çalışan başına satış)'],
      ['Rezervasyon', 'Gelme oranı, kapora, etkinlik sonuçları'],
    ]),
    p('Kasa kapanışları, giderler ve iadeler <b>Kasa ve giderler</b>\'de; vardiya ve bahşiş <b>Personel → Vardiya ve bahşiş</b>\'tedir.'),
    h3('KDV dökümü'),
    hizmet('reports-advanced', 'Muhasebecinize her ay aynı düzende, eksiksiz bir dosya gider; KDV dökümü hazırdır.'),
    p('Detaylı Özet\'in altında satışlar KDV oranına göre ayrılır: satış (KDV dahil), matrah ve KDV. Her ürün satıldığı andaki oranla sayılır. Bu döküm bilgi amaçlıdır; resmi beyan yazar kasa ve mali müşaviriniz üzerinden yapılır. Mola\'nın bastığı fiş "BİLGİ FİŞİ"dir; resmi fiş yazar kasadan kesilir.'),
    sekil('s-kdv', { genislik: 600 }),
    p('<b>Muhasebeci için indir</b> tek bir Excel dosyası verir: günlük satışlar, ödemeler, giderler, iadeler, kasa kapanışları, KDV dökümü ve ürün satışları. Ayı seçersiniz; ay başında geçen ay hazır seçilidir.'),
    sekil('s-muhasebeci', { genislik: 380, yan: true }),

    h2('Ajanda ve rezervasyon'),
    hizmet('reservations', 'Masa ayırma, kapora ve kalabalık geceler düzenli olur; gelmeyen müşterinin kaporası unutulmaz.'),
    sekil('s-ajanda', { aciklamalar: ['Rezervasyonlar: masa planı (ilk sekme).', 'Etkinlikler (maç günü, özel gece).', 'Takvim: gün notları ve hatırlatıcılar (yalnız işletme sahibi).', 'Seçili güne not ekleyin.'] }),
    p('<b>Rezervasyonlar</b> sekmesi masaları bir plan olarak gösterir. Üstte gün ve saat seçersiniz; her masa <b>Boş</b>, <b>Rezerve 20:00</b> ya da <b>Dolu</b> yazar. Rezervasyon için <b>boş masaya dokunun</b>, misafirin adını ve kişi sayısını yazıp kaydedin; telefon, not ve kapora isteğe bağlıdır. Rezerve masaya dokununca <b>Geldi</b>, <b>Düzenle</b> ve <b>İptal et</b> çıkar. Günün rezervasyonları planın altında listelenir.'),
    liste(['Saat ve tarihi rakamla yazmanız yeter: "2030" → 20:30, "08102026" → 08.10.2026.', 'Rezervasyondan <b>30 dakika önce</b> masa ayrılır: Masalar\'da "Rezerve · Ahmet · 4 kişi · 20:00" yazar ve masanın QR\'ı yeni siparişe kapanır. Siparişi garson alır.', 'Saat geçince "Geldi mi?" sorulur: <b>Geldi</b> (hesap misafirin adıyla açılır, kapora hesaptan düşülür), 15 dk bekle ya da <b>Gelmedi</b>.', '"Bana hatırlat" ile bir saat ya da bir gün önce bildirim alırsınız.', '<b>Etkinlik:</b> bir gece için geçici masalar açarsınız (D1, D2…). "Etkinlik oluştur"da ad, gün ve saat, masa sayısı ve masa adlarını girersiniz. Sipariş ve ödeme normal masa gibidir; etkinlik bitince raporu çıkar.', 'Kapora kararı bekleyenler planın en altındadır: "İade et" ya da "İşletmede kalsın".', 'Kimin rezervasyon yazabileceği ve masanın kaç dakika önce ayrılacağı: <b>Ajanda ve rezervasyon → Ayarlar</b> (yalnız siz).']),
    sekil('s-rezervasyon-form', { genislik: 400, yan: true }),
    sekil('s-etkinlikler'),

    h2('Personel'),
    p('Üç sekme: <b>Çalışanlar</b> (hesaplar, vardiya planı, açık oturumlar), <b>Vardiya ve bahşiş</b> (saatler, geç kalma, her çalışanın bahşiş payı) ve <b>Personel ayarları</b> (vardiya takibi, bahşiş dağıtım kuralı, hangi garsonun hangi masaya baktığı).'),
    sekil('yeni-duzen-personel', { baslik: 'Personel sekmeleri. Personel ayarları alt sekmeleri.' }),
    sekil('s-calisanlar', { aciklamalar: ['Çalışan ekle: ad, kullanıcı adı, görev, şifre.', 'Şifreyi yenile: çalışan şifresini unuttuysa.'] }),
    liste(['Ayrılan çalışanın hesabını <b>"Hesabı kapat"</b> ile kapatın; geçmişi silinmez.', '<b>Vardiya planı</b> (isteğe bağlı): saatler ve çalıştığı günler. Plan varsa raporda geç başlayan "N dk geç" olarak görünür.', '<b>Açık oturumlar:</b> hangi cihazda kimin girişli olduğu. Kaybolan bir telefonun oturumunu buradan kapatırsınız.']),
    sekil('s-rapor-personel', { baslik: 'Personel → Vardiya ve bahşiş (Vardiyalar · Bahşiş)' }),
    hizmet('shifts', 'Kim kaç saat çalıştı, kim geç kaldı, bahşiş adil paylaşıldı mı; tartışmaya gerek kalmaz.'),

    ...ayarlar(),
    ...destek(),
    ...uzaktan(),
    ...yedekler(),
  ].join('');
}

function ayarlar() {
  return [
    h2('Ayarlar'),
    p('Ayarlar\'da bir kez kurulan, işletmenin ve cihazların genelini ilgilendiren ayarlar durur. Beş konu vardır; her konunun altında bölümleri sıralanır. Dikkat isteyen bir şey varsa sekmede küçük bir rozet çıkar (örneğin "Eksik").'),
    sekil('yeni-duzen-ayarlar', { baslik: 'Konular: İşletme, Masalar ve QR, Sipariş ve mutfak, Cihazlar, Güvenlik ve yedek. Güvenlik ve yedek için bölümler: Yedek, Kilit ve güncelleme, Telefonum.' }),
    tablo(['Konu', 'Bölümler'], [
      ['İşletme', 'Görünüm · Sosyal medya · Paket ve lisans'],
      ['Masalar ve QR', 'Masalar ve QR · QR kodlarını yazdır · Engellenen telefonlar'],
      ['Sipariş ve mutfak', 'Sipariş ve onay · Mutfak (Ekran / Fiş) · Paket platformları'],
      ['Cihazlar', 'Yazıcılar · Sesler · Tablet ve telefonlar'],
      ['Güvenlik ve yedek', 'Yedek · Kilit ve güncelleme · Telefonum'],
    ]),
    h3('İşletme'),
    p('<b>Görünüm:</b> işletmenin adı, logosu, renkleri ve müşteri menüsünün karşılama yazısı. <b>Paket ve lisans:</b> paketinizin adı ve durumu ("Aktif" ya da "Deneme · N gün kaldı"), içindeki hizmetler, lisansın kalan günü, <b>Hizmeti dondurma</b> talebi (yıllık abonelikte, en fazla 60 gün) ve <b>Sözleşmeyi oku</b>.'),
    sekil('s-paket-kafe-standart', { genislik: 520, aciklamalar: ['Paketinizdeki hizmetler (yeşil tik).', 'Pakette olmayanlar soluk; "Pakete ekle"ye dokununca açıklama ve Mola ekibinin iletişim düğmeleri çıkar.'] }),
    hizmet('social', 'Müşteri menüsünün altında takip simgeleri, ödeme sonrası takip düğmeleri ve masalara koyacağınız kalıcı QR kartları.'),
    sekil('s-sosyal', { aciklamalar: ['Hesabınızı yazın: kullanıcı adı ya da bağlantı.', '"QR oluştur": bu hesabın kalıcı QR kartı (PDF indir ya da yazdır).'] }),
    p('Google değerlendirme bağlantısı her pakette vardır. Kalıcı QR kartını bir kez basarsınız; bağlantınızı sonradan değiştirseniz de aynı kart yenisini açar.'),
    h3('Raporları gönder (e-posta raporları)'),
    hizmet('email-reports', 'Gün sonu, haftalık, aylık ve yıllık rapor kendiliğinden e-postanıza gelir; kafeye gitmeden günü öğrenirsiniz.'),
    sekil('s-eposta'),
    p('Satış ve Raporlar → <b>Yazdır ve paylaş</b> → <b>Raporları gönder</b> ile açılır. Raporlar kendi e-posta hesabınızdan gönderilir (Gmail için "uygulama şifresi"). En fazla 5 alıcı yazabilirsiniz (örneğin siz ve muhasebeciniz). "Deneme e-postası gönder" ile denersiniz. E-postada kısa bir özet ve PDF eki bulunur.'),
    h3('Masalar ve QR'),
    p('<b>Masalar ve QR:</b> masa ekle ve çıkar, bölümler (İç, Bahçe, Teras) ve sıraları, masa temizliği takibi, tek bir masanın QR kodunu yenileme. Bir masanın bölümünü yanındaki seçimden değiştirir, yeni bölüm açar, oklarla sırayı değiştirirsiniz. <b>QR kodlarını yazdır:</b> A4\'e 6\'lı ya da 12\'li, A6 masa standı ve PDF. <b>Engellenen telefonlar:</b> masa penceresinden engellediğiniz telefonlar.'),
    sekil('s-qr-kodlari', { aciklamalar: ['Yeni kodların taşıyacağı adres: "İnternet adresi: her ağdan açılır" ya da Wi-Fi adresi.', 'Baskı türü: A4\'e 6 QR, 12 QR ya da A6 masa standı.', 'Yazdır.'] }),
    p('<b>A6 masa standı</b> (10,5 × 14,8 cm) her masa için logonuz, işletmenizin adı, QR kod ve büyük harflerle masa adı olan bir kart hazırlar. A4\'e 4\'lü ya da A6 kâğıda tek basılır; "PDF indir" ile matbaaya gönderebilirsiniz.'),
    sekil('k-qr-a6-sayfa', { genislik: 330, yan: true, baslik: 'A6 masa standı kartları, A4\'e 4\'lü (kesim çizgili).' }),
    not('QR kodlarını Ayarlar → Masalar ve QR\'da <b>"Bağlı"</b> yazınca basın; böyle basılan QR misafirin mobil verisinden de açılır. Yeni kurulan kafede bu 10-20 dakika sürebilir. Masalar\'da "yeniden basılmalı" uyarısı görürseniz QR\'ları yeniden basın.', 'dikkat'),
    h3('Sipariş ve mutfak'),
    p('<b>Sipariş ve onay:</b> ödeme ne zaman alınır (servisten sonra ya da önce), müşterinin siparişini değiştirebileceği süre, QR siparişine garson onayı ya da otomatik onay, garson hatırlatması (uzun süredir sipariş vermeyen masa; ilk hâli 45 dk). <b>Mutfak:</b> Ekran ya da Fiş. <b>Paket platformları:</b> yakında.'),
    sekil('s-siparis-onay', { baslik: 'Sipariş ve mutfak → Sipariş ve onay' }),
    h3('Cihazlar'),
    p('<b>Yazıcılar:</b> fiş yazıcısını ekler, hangi fişin (mutfak, hesap, kasa) hangi yazıcıdan çıkacağını seçersiniz. <b>Sesler:</b> garson çağrısı, hesap isteme, yeni sipariş, sipariş hazır gibi olaylar için ses seçimi. <b>Tablet ve telefonlar:</b> bağlantı kontrolü ve cihaz bağlama. Android personel uygulaması molayazilim.com.tr/indir/ sayfasında ve kasa bilgisayarındaki Tabletler penceresinin QR kodundadır.'),
    not('Telefonlar bağlanamıyorsa ve Mola sarı bir uyarı gösteriyorsa: Windows Ayarları → Ağ ve İnternet → bağlantınız → Ağ profili türü: <b>Özel ağ</b>.', 'dikkat'),
    sekil('s-yazicilar'),
    sekil('s-cihazlar', { baslik: 'Cihazlar → Tablet ve telefonlar' }),
    h3('Güvenlik ve yedek'),
    liste(['<b>Yedek:</b> son yedeğin zamanı, "Yedekle ve ikinci yer", "Kurtarma kodu" ve <b>Yeni bilgisayar için e-posta</b> kartı (aşağıda, "Bilgisayarım bozuldu").', '<b>Kilit ve güncelleme:</b> sahip hesabının otomatik kilidi (5, 10 ya da 30 dakika) ve güncellemeler. Ekran kilitliyken siparişler gelmeye devam eder. Hemen kilitlemek için sol alttaki kilit düğmesi.', '<b>Telefonum:</b> <b>Raporlar için telefon kodu</b>, <b>Telefonu eşleştir</b> ve <b>Uzaktan yönetim</b>.']),
    sekil('s-guvenlik', { aciklamalar: ['Sahip hesabı otomatik kilit: 5, 10 ya da 30 dakika kullanılmazsa ekran kilitlenir.'] }),
  ];
}

function destek() {
  return [
    h2('Bildirimler (zil)'),
    p('Sağ üstteki <b>zil</b> işletmenizin haberlerini toplar: kasa farkı, iade isteği, azalan stok, büyük giderler, biten kampanyalar, raporlar, ajanda hatırlatmaları, lisans ve yedek uyarıları. Okunmamış bildirim varsa zil renklenir ve sayısı yazar. Her bildirimin yanında onu çözen yere giden bir düğme vardır (<b>İadeyi yap</b>, <b>Kapanışları aç</b>, <b>Stoğa git</b>…).'),
    p('Mola açıkken yeni bir bildirim gelirse zilin altında birkaç saniye küçük bir kutu çıkar; önemli olanlar siz kapatana kadar kalır. Bildirim sesi için: Ayarlar → Cihazlar → Sesler → Bildirim sesi.'),
    sekil('s-bildirimler', { baslik: 'Bildirimler: sağ üstteki zil' }),
    h2('Destek'),
    p('Destek Mola ekibiyle konuşmanın yeridir.'),
    sekil('s-destek', { aciklamalar: ['Talepler: Mola ekibiyle yazışma.', 'Duyurular: Mola ekibinin bütün kafelere duyuruları.', 'Uzaktan erişim: Mola ekibine uzaktan destek izni ve kim ne zaman bağlandı.'] }),
    liste(['<b>Talepler:</b> <b>"Yeni talep"</b>e basın, konuyu ve sorunu yazın, isterseniz fotoğraf ya da PDF ekleyin, "Destek talebi aç" deyin. Mola ekibinin yanıtı aynı yazışmaya düşer. İnternet yokken yazdığınız talep bağlantı gelince gider.', '<b>Duyurular:</b> Mola ekibinin duyuruları; okunmamış duyuru varsa Destek düğmesinde kırmızı nokta yanar. "Önemli" duyuru girişte bir pencereyle gelir.']),
    sekil('s-yeni-talep', { aciklamalar: ['"Yeni talep": formu açar.', 'Konu ve sorun; isterseniz fotoğraf ya da PDF.', '"Destek talebi aç". Vazgeçmek için "Vazgeç".'] }),
    h3('Uzaktan erişim'),
    sekil('s-uzaktan-erisim', { baslik: 'Uzaktan destek izni' }),
    p('<b>Mola ekibi bağlanabilsin</b> açıkken Mola ekibi sorununuzu çözmek için kafenizin ekranlarını internetten açabilir. Siz kapatana kadar açık kalır. Mola ekibi satış raporlarını, ödemeleri, kasa kapanışlarını ve şifreleri göremez. Kimin ne zaman bağlandığı aynı sayfada yazar.'),
  ];
}

function uzaktan() {
  return [
    h2('Raporlarım telefonda'),
    hizmet('remote-reports', 'Kafede olmasanız da bugünün satışını, kasayı ve son 30 günü telefonunuzdan görürsünüz.'),
    adimlar(['Kafedeki bilgisayarda Ayarlar → Güvenlik ve yedek → Telefonum → <b>Telefonu eşleştir</b>\'e basın.', 'Cihaza bir ad verin ("Serkan\'ın telefonu") ve şifrenizi yeniden yazın.', 'Ekrana gelen QR kodu telefonunuzla okutun ve "Eşleştir"e basın.', 'Raporlarım sayfasını telefonunuzun ana ekranına ekleyin.']),
    sekil('s-telefon-eslestir', { genislik: 560, aciklamalar: ['Telefonla okutulacak eşleştirme QR kodu (10 dakika geçerli).'] }),
    serit([{ ad: 't-raporlarim', baslik: 'Raporlarım: bugün', aciklamalar: ['Bugünün satışı: nakit, kart, sipariş sayısı.'] }, { ad: 't-raporlarim-2', baslik: 'Aşağı kaydırınca', metin: 'En çok kazandıranlar, kasa durumu ve son 30 gün.' }], { genislik: 230 }),
    p('En fazla 3 cihaz eşleşir. Kaybolan telefonu aynı sayfadan kaldırın.'),
    h2('Uzaktan yönetim'),
    hizmet('remote-admin', 'Kafeye gitmeden fiyat değiştirir, kampanya açar, çalışan hesabı kapatırsınız; kafedeki ekranların aynısı telefonunuzda.'),
    adimlar(['Ayarlar → Güvenlik ve yedek → Telefonum → <b>Raporlar için telefon kodu</b>\'nu kurun.', 'Aynı sayfada telefonunuzu eşleştirin.', '<b>Uzaktan yönetim</b> kartında "Aç"a basın, şifrenizi ve telefonunuzdaki doğrulama uygulamasının (Authenticator) 6 haneli kodunu yazın. Bu adım yalnız kafedeki bilgisayardan yapılır.', 'Telefonunuzda Raporlarım → <b>Kafeyi yönet</b>: şifre ve telefon kodu ile girin.']),
    sekil('s-uzaktan-yonetim', { genislik: 560 }),
    p('Her uzaktan giriş size bildirilir. Uzaktan yönetimi her yerden kapatabilirsiniz.'),
    h2('İki ekran'),
    hizmet('split-screen', 'Kasa bilgisayarında ekranı ikiye bölersiniz: solda kasa, sağda mutfak ya da ikinci bir kasiyer.'),
    p('Kasa bilgisayarındaki Mola penceresinde soldaki şeritten <b>İkiye böl</b>\'e basın. Her yarıya ayrı bir hesapla girilir. Ortadaki ayraçla genişliği değiştirir, "Tek ekran" ile geri dönersiniz.'),
    sekil('d-iki-ekran'),
  ];
}

function yedekler() {
  return [
    h2('Kasa bilgisayarı: şerit, yedekler ve kurtarma kodu'),
    p('Kasa bilgisayarındaki Mola penceresinin solunda koyu yeşil bir şerit vardır: <b>İkiye böl, Yedekle, Tabletler, Güvenlik, Kapat</b>. Bu şerit yalnız kasa bilgisayarında görünür.'),
    sekil('d-serit', { aciklamalar: ['Kasa bilgisayarının şeridi.'] }),
    h3('Kurtarma kodu'),
    p('İlk açılışta Mola bir <b>kurtarma kodu</b> gösterir. Bilgisayar bozulursa ya da şifrenizi unutursanız verileriniz bu kodla açılır. Kodu kâğıda yazın ya da yazdırın, bilgisayardan uzakta güvenli bir yerde saklayın.'),
    sekil('d-kurtarma-kodu', { genislik: 400, yan: true, aciklamalar: ['Kurtarma kodu (bir daha gösterilmez).', 'Yazdır.', '"Kaydettim".'] }),
    h3('Yedekler'),
    sekil('d-yedekle', { genislik: 440, yan: true, aciklamalar: [] }),
    tablo(['Ne zaman', 'Ne olur'], [
      ['<b>Gün sonu</b>', 'Kapanıştan 1 dakika sonra yedek alınır.'],
      ['<b>Gece 03:30</b>', 'O gün değişiklik olduysa yedek alınır. Bilgisayar kapalıysa açıldıktan 2 dakika sonra alınır.'],
      ['<b>Şimdi yedekle</b>', 'Sol şeritte <b>Yedekle</b> → <b>Şimdi yedekle</b>: istediğiniz an.'],
    ]),
    liste(['<b>İkinci yedek yeri:</b> bir USB bellek ya da başka bir disk seçin; her yedeğin kopyası oraya da gider.', 'Son 7 günün, son 4 haftanın ve son 12 ayın birer yedeği ve her yılın <b>yıl paketi</b> saklanır.', 'Ayarlar → Güvenlik ve yedek → <b>Yedekleriniz nerede?</b> yedeklerin bu bilgisayarda, ikinci yerde ve sunucuda en son ne zaman alındığını gösterir.']),
    hizmet('cloud-backup', 'Yedeklerin şifreli bir kopyası Mola\'nın sunucusunda da durur. Bilgisayar bozulur ya da çalınırsa yeni bilgisayara kolayca geçersiniz.'),
    not('Yedeği ve kurtarma kodunu aynı USB belleğe ya da aynı e-postaya koymayın.', 'dikkat'),
    h3('Bilgisayarım bozuldu, verilerime erişemiyorum'),
    tablo(['Durumunuz', 'Ne yaparsınız'], [
      ['Bilgisayar bozuldu ya da değişti; <b>şifrenizi biliyorsunuz</b>', 'Yeni bilgisayara Mola\'yı kurun, ilk ekranda <b>İşletmem var</b>. İşletmenin e-postası, kullanıcı adınız ve şifreniz → e-postanıza gelen 6 haneli kod → yedeği seçin → <b>İndir ve geri yükle</b>.'],
      ['Bilgisayar gitti; şifreyi unuttunuz ama <b>kurtarma kodu kâğıtta</b>', 'Mola ekibini arayın; size tek kullanımlık <b>taşıma kodu</b> verir. İlk ekranda <b>Mola Merkez\'den geri yükle</b>: taşıma kodu + kurtarma kodunuz.'],
      ['Bilgisayar çalışıyor; <b>yalnız şifreyi unuttunuz</b>', 'Sol şerit → <b>Güvenlik</b> → <b>İşletme sahibi şifresini unuttum</b>: kurtarma kodunuzla ya da Mola ekibinin verdiği kodla yeni şifre.'],
      ['Şifre de kurtarma kodu da yok, bilgisayar da yok', 'Veriler açılamaz; Mola ekibi de açamaz. Kurtarma kodunu bu yüzden kâğıtta saklayın.'],
    ]),
    h3('İşletmem var için hazırlık'),
    p('Yeni bilgisayarda <b>İşletmem var</b> için Ayarlar → Güvenlik ve yedek → Yedek\'teki <b>Yeni bilgisayar için e-posta</b> kartı <b>"İşletmem var hazır"</b> demelidir. Bilgisayarı değiştirmeden önce buna bakın.'),
    liste(['<b>"Henüz hazır değil":</b> e-posta adresi yoksa adresinizi ve şifrenizi yazıp gelen kodla doğrulayın; sonra şifrenizi yazıp <b>Hazırla</b>\'ya basın.', '<b>"Sunucu yedeği alınıyor":</b> birkaç dakika bekleyin.', '<b>"İşletmem var hazır":</b> kart yeni bilgisayarda sorulacak kullanıcı adını da yazar.', 'Adresi değiştirmek için <b>Değiştir</b>: şifreniz, eski adrese ve yeni adrese gelen kodlar istenir.', 'Geri yüklemeden sonra Mola yeni bir kurtarma kodu gösterir; onu da kâğıda yazın. Eski bilgisayarda sipariş alınmaz.', 'İşletmeniz başka bir bilgisayarda açılırsa bu adrese e-posta gelir. Siz yapmadıysanız hemen Mola ekibini arayın.']),
    h3('Yıl paketleri'),
    p('Her takvim yılı bir sonraki yılın <b>1 Şubat</b>\'ında kendi dosyasına paketlenir ve kapanır; size bildirim gelir. Kapanmış bir yıla tarihli gider, kasa düzeltmesi ya da stok kaydı yapılamaz; kaydı bugünün tarihiyle girin. Eski bir hesaba iade yapılabilir. Paketlenirken müşterilerin kişisel bilgileri (rezervasyon adı, telefon) silinir; satış rakamları korunur.'),
    sekil('k-kapali-yil', { genislik: 600, baslik: 'Kapanmış yıla tarihli kayıt denenince çıkan uyarı' }),
  ];
}

function ilkGun() {
  return [
    bolum('İlk gün kurulumu', 'Mola kurulduğunda yapmanız gerekenler sırasıyla. Hepsi bir saatten kısa sürer.'),
    adimlar([
      '<b>Etkinleştirme:</b> kasa bilgisayarında Mola ilk açıldığında "Mola\'yı etkinleştir" ekranı gelir. Kodunuz yoksa <b>"Kodum yok, başvuru yapacağım"</b>ı seçip başvuruyu doldurun (Mola ekibi onaylayınca 30 günlük deneme başlar); kodunuz varsa <b>"Etkinleştirme kodum var"</b>. Kurulum dosyası <b>molayazilim.com.tr/indir/</b> adresindedir. Lisans Sözleşmesi\'ni okuyup işaretleyin.',
      '<b>Sahip hesabı:</b> kendi kullanıcı adınızı ve şifrenizi belirleyin.',
      '<b>Kurulum sihirbazı:</b> işletme türü, adı, masa sayısı ve temel kurallar.',
      '<b>Kurtarma kodu:</b> ekrana gelen kodu kâğıda yazın, güvenli yerde saklayın.',
      '<b>Menü:</b> Menü yönetimi\'nde başlangıç menüsünü kendi ürünleriniz ve fiyatlarınızla düzeltin. "Menüyü önizle" ile müşterinin gözüyle bakın.',
      '<b>Görünüm:</b> Ayarlar → İşletme → Görünüm: logo, renk, karşılama yazısı. Google değerlendirme bağlantınızı Sosyal medya\'ya yazın.',
      '<b>Personel → Çalışanlar:</b> her çalışana kendi hesabını açın. Ortak şifre kullanmayın.',
      '<b>Yazıcı ve mutfak:</b> Ayarlar → Cihazlar → Yazıcılar; mutfak Ekran mı, Fiş mi? (Ayarlar → Sipariş ve mutfak → Mutfak)',
      '<b>Tablet ve telefonlar:</b> Ayarlar → Cihazlar → Tablet ve telefonlar. Android telefonlara Mola personel uygulamasını kurun (molayazilim.com.tr/indir/ ya da kasa bilgisayarındaki <b>Tabletler</b> penceresinin QR kodu).',
      '<b>İkinci yedek yeri:</b> kasa bilgisayarının şeridinden Yedekle → bir USB bellek seçin.',
      '<b>QR kodları:</b> Ayarlar → Masalar ve QR\'da "Bağlı" yazınca QR kodlarını yazdır bölümünden basın.',
      '<b>Deneme:</b> bir masaya kendi telefonunuzla sipariş verin, mutfakta hazırlayın, kasada kapatın.',
    ]),
  ].join('');
}

function qrKoruma() {
  return [
    bolum('QR kodları: basma ve koruma', 'Masadaki QR kod müşterinin kafenize açılan kapısıdır. Okunmayan bir QR sipariş kaybettirir.'),
    h2('Basmadan önce'),
    liste(['Ayarlar → Masalar ve QR\'da <b>"QR kodları internet adresini taşır · Bağlı"</b> yazdığını görün.', 'Önce bir masanın kartını basın ve <b>iki telefonla</b> deneyin: biri kafenin Wi-Fi\'sinde, diğeri yalnız mobil veride. İkisinde de menü açılmalı.', 'Masa adlarını kontrol edin. Kartta büyük harflerle yazan ad, misafirin kasada söyleyeceği addır.']),
    h2('Koruma önerileri'),
    tablo(['Öneri', 'Neden'], [
      ['<b>Mat kâğıt</b> ya da mat laminasyon', 'Parlak yüzey ışığı yansıtır, kamera okuyamaz.'],
      ['<b>Akrilik A6 masa standı</b> (10,5 × 14,8 cm)', 'Kart dik durur, ıslanmaz. Mola\'nın A6 kartı bu standa göredir.'],
      ['<b>Laminasyon</b>', 'Kahve, çay ve su lekesine karşı. Silinerek temizlenir.'],
      ['<b>Yedek set</b>', 'Bütün masaların bir takımını fazladan basıp kasada saklayın.'],
      ['<b>QR\'ı kesmeyin, katlamayın</b>', 'Kenar boşluğu okumak için gereklidir.'],
    ]),
    p('Bir QR kaybolur ya da çalınırsa masa penceresinden "QR yenile" deyin ve yeni kartı basın. Eski kart açılmaz.'),
    not('Lisans biterse masa QR\'ları menüyü açmaz. QR kartlarınızı atmayın: hizmet açılınca aynı kartlar yeniden çalışır.', 'bilgi'),
  ].join('');
}

function internet() {
  return [
    bolum('İnternet kesilirse', 'Kafenin interneti gitse de Mola çalışmaya devam eder.'),
    tablo(['Ne', 'İnternet yokken'], [
      ['Garson, kasa, mutfak, tabletler, fiş yazıcısı', '<b>Çalışır.</b> Hepsi kafenin Wi-Fi\'si üzerinden kasa bilgisayarına bağlıdır.'],
      ['Müşterinin QR menüsü', '<b>Görünür, sipariş verilemez.</b> Üstte "Şu an sipariş alınamıyor, lütfen garsonunuza sorun." yazar; siparişi garson alır. İnternet dönünce sipariş kendiliğinden açılır.'],
      ['Raporlarım, uzaktan yönetim, e-posta raporları, destek talepleri, bulut yedek', '<b>Bekler.</b> İnternet gelince devam eder.'],
      ['Lisans', 'Mola 14 güne kadar internetsiz çalışır. Uzun kesintide Mola ekibine haber verin.'],
    ]),
    sekil('m-kopyadan', { genislik: 300, yan: true, aciklamalar: ['Kafenin interneti yokken misafir: "Şu an sipariş alınamıyor, lütfen garsonunuza sorun."', 'Menü, fiyatlar ve fotoğraflar yine görünür.'] }),
    not('<b>Yedek internet:</b> internet uzun süre gelmeyecekse kasa bilgisayarını bir telefonun erişim noktasına (hotspot) bağlayın; QR siparişleri yeniden açılır. Garson ve mutfak cihazları kafenin Wi-Fi\'sinde kalabilir.', 'ipucu'),
    not('Kasa bilgisayarı kapalıysa hiçbir personel ekranı çalışmaz; veriler o bilgisayardadır. Elektrik gelip bilgisayar açılınca Mola kaldığı yerden devam eder.', 'dikkat'),
  ].join('');
}

function sssBolum() {
  return [
    bolum('Sık sorulan sorular'),
    sss('Verilerim nerede duruyor?', 'Satışlarınız, menünüz ve çalışan bilgileriniz kafenizdeki bilgisayarda, şifreli olarak durur.'),
    sss('Müşteri QR\'ı okutmak için Wi-Fi\'ye bağlanmalı mı?', 'Hayır. QR kendi mobil verisiyle de açılır.'),
    sss('Kafe kapalıyken müşteri QR\'ı okutursa ne olur?', 'Menüyü görür, sipariş veremez. Gün sonunu yapınca QR siparişleri durur; sabah kasayı açınca ya da 05:00\'te kendiliğinden açılır.'),
    sss('Bir çalışan ayrıldı. Ne yapmalıyım?', 'Personel → Çalışanlar\'da hesabını "Hesabı kapat" ile kapatın. Geçmiş satışları ve vardiyaları silinmez.'),
    sss('Şifremi unuttum.', 'Çalışanların şifresini işletme sahibi Personel → Çalışanlar → "Şifreyi yenile" ile verir. İşletme sahibi şifresini unuttuysa kasa bilgisayarındaki şeritten Güvenlik → "İşletme sahibi şifresini unuttum".'),
    sss('Ekran kendiliğinden kilitlendi.', 'Sahip hesabının otomatik kilidi. Şifrenizi yazıp "Kilidi aç" deyin. Süreyi Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme\'den değiştirebilirsiniz.'),
    sss('Sabah herkes yeniden giriş yapıyor.', 'Oturumlar iş gününün bittiği 05:00\'te kapanır.'),
    sss('Fiyatı değiştirdim, menüyü yeniden basmam gerekir mi?', 'Hayır. Değişiklik müşteri menüsüne hemen gider. QR kodları aynı kalır.'),
    sss('Yanlış ödeme türü seçtim (kart yerine nakit).', 'Kasa ve giderler → İadeler\'den ödemeyi düzeltin (kapanmış masanın penceresindeki "Ödemeyi düzelt" de oraya açılır).'),
    sss('Bir hizmet soluk görünüyor.', 'Paketinizde yok. Dokunun ve "Mola ekibine yaz" deyin.'),
    sss('Yeni sürüm geldi mi nasıl anlarım?', 'Masalar\'ın üstünde "Yeni sürüm hazır · kapanışta ya da yarın açılışta kurulacak" yazar. Güncelleme kendiliğinden ve yedek alınarak kurulur. Açık masa varken kurulmaz.'),
    sss('Muhasebecim hangi dosyayı istiyor?', 'Satış ve Raporlar → "Muhasebeci için indir". Ay başında "Geçen ay" hazır seçilidir.'),
  ].join('');
}

function sorunGiderme() {
  return [
    bolum('Sorun giderme'),
    tablo(['Ne oluyor', 'Ne yapın'], [
      ['Tablet "bağlantı yok" diyor', 'Tablet kafenin Wi-Fi\'sinde mi? Kasa bilgisayarı açık mı? Modemi yeniden başlattıysanız modemde kasa bilgisayarına sabit IP verin.'],
      ['QR menü açılmıyor', 'Ayarlar → Masalar ve QR\'da "Bağlı" yazıyor mu? Kasa bilgisayarı açık ve internete bağlı mı? QR eskiyse yeniden basın.'],
      ['Müşteri "Şu an sipariş almıyoruz" görüyor', 'Sol menünün üstündeki "QR siparişleri" kartına bakın: "Gün sonu yapıldı" ya da "Elle durduruldu" ise "Siparişleri aç"a basın; "Personel ekranı bağlı değil" ise mutfak, garson ya da kasa ekranından birini açıp giriş yapın.'],
      ['Müşteri "Bu masa 20:00 için ayrılmıştır" görüyor', 'Masanın yakında rezervasyonu var. Siparişi garson alır. Rezervasyonlu misafir geldiyse "Geldi"ye basın.'],
      ['Müşteri "Şu an sipariş alınamıyor" görüyor', 'Kafenin interneti ya da kasa bilgisayarı kapalı. Kontrol edin; gerekirse telefonun erişim noktasını kullanın.'],
      ['Fiş çıkmıyor', 'Kâğıt ve kabloyu kontrol edin, uyarıdaki "Tekrar bas"a basın. Yazıcının ayar fişindeki IP adresini Ayarlar → Cihazlar → Yazıcılar\'daki adresle karşılaştırın; port genelde 9100\'dür.'],
      ['Ses gelmiyor', 'Ekranın üstündeki "Ses kapalı · açmak için dokunun"a dokunun. Tabletin sesini açın.'],
      ['Mutfak tableti kararıyor', 'Mutfak ekranında "Ekranı açık tut"u açın; tableti şarjda tutun.'],
      ['"Bu yıl kapandı" uyarısı', 'Kaydı bugünün tarihiyle girin.'],
      ['Yedek hatası bildirimi', 'İkinci yedek yeri (USB) takılı mı? Disk dolu mu? Çözülmezse Destek\'ten yazın.'],
    ]),
    p('Çözemediğiniz bir sorunda Destek → Talepler\'den yazın; mümkünse ekranın fotoğrafını ekleyin. Gerekirse Uzaktan erişim\'den "Mola ekibi bağlanabilsin"i açın.'),
  ].join('');
}

function iletisim() {
  return [
    bolum('İletişim'),
    p('Mola, <b>Merkut Studios</b> tarafından geliştirilir.'),
    liste(['<b>Programın içinden:</b> Destek → Talepler. En hızlı yol budur; yazışma kaydı saklanır.', '<b>Telefon, WhatsApp ve e-posta:</b> Ayarlar → İşletme → Paket ve lisans\'taki "Mola ekibine ulaşın" bölümünde yazar.', '<b>Web sitesi:</b> molayazilim.com.tr']),
    not('Mola ekibi sizden asla şifrenizi ya da kurtarma kodunuzu istemez.', 'dikkat'),
  ].join('');
}

export function kullanimKilavuzu(): Belge {
  return {
    dosya: 'Mola-Kullanim-Kilavuzu.pdf', baslik: 'Kullanım Kılavuzu', altBaslik: 'Kafeler ve restoranlar için adım adım', kisa: 'Mola Kullanım Kılavuzu', tocDerinlik: 2,
    kapakNotu: '<p>Bu kılavuz Mola\'yı ilk günden rahatça kullanmanız için hazırlandı. Önce bir müşterinin hikâyesini izliyoruz, sonra her çalışanın ekranını ve günlük işlerini anlatıyoruz.</p><p>Ekranlardaki kırmızı numaralar, yanındaki kısa açıklamalarla aynıdır. Ekran görüntüleri örnek işletme "Mola Örnek Kafe"den alınmıştır.</p>',
    icerik: [tanitim(), musteri(), garson(), kasiyer(), mutfak(), mudur(), sahip(), ilkGun(), qrKoruma(), internet(), sssBolum(), sorunGiderme(), iletisim()].join(''),
  };
}

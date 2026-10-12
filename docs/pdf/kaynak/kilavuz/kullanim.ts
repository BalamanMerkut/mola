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
    p('Mola\'da beş çeşit hesap vardır. Her çalışan yalnız kendi işine yarayan ekranları görür; görmediği bir işlemi yapamaz.'),
    tablo(['Hesap', 'Nerede çalışır', 'Günlük işi'], [
      ['<b>Garson</b>', 'Telefon', 'Masaları izler, sipariş alır, QR siparişlerini onaylar, servis eder.'],
      ['<b>Kasiyer</b>', 'Kasa bilgisayarı ya da tablet', 'Kasayı açar, ödeme alır, masasız satış yapar, gün sonunu kapatır.'],
      ['<b>Mutfak</b>', 'Mutfaktaki tablet ya da ekran (ya da fiş yazıcısı)', 'Siparişleri hazırlar, "Hazır" der, stok sayar.'],
      ['<b>Müdür</b>', 'Her cihaz', 'Sahibin yerine günü yönetir: menü, stok, raporlar, iadeler.'],
      ['<b>İşletme sahibi</b>', 'Her cihaz, telefonundan uzaktan da', 'Her şeyi görür ve ayarlar. Bu kılavuzun en uzun bölümü onun içindir.'],
    ]),
    h2('Hizmetler ve paketler'),
    p('Mola parça parça hizmetlerden oluşur. "Adisyon çekirdeği" her pakette vardır; diğer hizmetler işletmenizin ihtiyacına göre eklenir. Üç başlangıç paketi vardır: <b>Çay bahçesi</b>, <b>Kafe Standart</b> ve <b>Restoran Pro</b>. Mola ekibi size özel bir paket de hazırlayabilir.'),
    tablo(['Hizmet', 'Ne yapar', ...defaultPackages.map(x => x.name)], satilan.map(f => [`<b>${f.name}</b>`, f.description, ...defaultPackages.map(x => (x.features as string[]).includes(f.id) ? ok : yok)]), 'kucuk'),
    p('Bu kılavuzda her özelliğin başında küçük bir kutu vardır. Kutuda özelliğin hangi hizmete ait olduğu, hangi başlangıç paketlerinde bulunduğu (✓) ve size ne kazandırdığı yazar.'),
    hizmet('core', 'Masalar, sipariş, mutfak, kasa, menü, kampanyalar, temel raporlar, Müdür hesabı ve telefon uygulaması her pakette vardır.'),
    not('Paketinizde olmayan bir hizmet ekranda <b>soluk</b> görünür ve yanında "Pakette yok" yazar. Dokununca ne işe yaradığını anlatan kısa bir kart açılır. Karttaki <b>"Mola ekibine yaz"</b> düğmesi Destek\'te hazır bir talep açar; hizmet birkaç dakika içinde açılır. Kapalı bir hizmetteki verileriniz silinmez, hizmet açılınca geri gelir. Kasiyer, garson ve mutfak kapalı hizmetleri hiç görmez.', 'bilgi'),
    sekil('s-kilitli-menu', { genislik: 420, yan: true, aciklamalar: ['Paketinizde olmayan bölüm soluk ve "Pakette yok" yazılı.'] }),
    sekil('s-kilitli-hizmet', { genislik: 560, aciklamalar: ['"Bu hizmet paketinizde yok" kartı ve hizmetin kısa açıklaması.', '"Mola ekibine yaz" ile hizmeti ekletirsiniz.'] }),
    h2('Bu kılavuzu nasıl okuyacaksınız?'),
    p('Ekran görüntülerinin üstündeki <b style="color:#d7261e">kırmızı numaralar</b> ve oklar, görüntünün yanındaki ya da altındaki aynı numaralı açıklamayı gösterir. Ekranlar örnek işletme "Mola Örnek Kafe"dendir; tutarlar örnektir.'),
  ].join('');
}

function musteri() {
  return [
    bolum('Bir müşterinin hikâyesi', 'Mola\'yı en iyi bir müşterinin gözünden anlarsınız. Ayşe Hanım kafenize geliyor, Masa 5\'e oturuyor ve telefonundan sipariş veriyor. Her adımda hangi ekranın ne yaptığını göreceksiniz.'),
    hizmet(['qr-menu', 'qr-order'], 'Müşteri garsonu beklemeden menüye bakar, siparişini kendisi verir. Garsonunuz sipariş yazmak yerine servise ve misafire zaman ayırır; siparişler yanlış yazılmaz.'),
    h2('Masaya oturur, QR kodu okutur'),
    p('Ayşe Hanım Masa 5\'e oturur. Masadaki akrilik standın üstünde masanın QR kodu ve büyük harflerle "MASA 05" yazar. Telefonunun kamerasını QR koda tutar.',
      'Kafenin Wi-Fi şifresini sormasına gerek yoktur. QR kod <b>kendi mobil verisiyle</b> de, herhangi bir Wi-Fi ağıyla da açılır. Menü Mola\'nın menüye ayrılmış internet adresinden (<b>menu.molayazilim.com.tr/q/…</b>) gelir, sipariş doğrudan kafenizdeki bilgisayara ulaşır.'),
    serit([
      { ad: 'm-menu', baslik: '1. Menü açılır', aciklamalar: ['Hangi masada olduğu üstte yazar.', 'Garsonu tek dokunuşla çağırır.', 'Kategoriler arasında gezinir.', 'Ürüne dokunur.'] },
      { ad: 'm-urun', baslik: '2. Ürünü seçer', aciklamalar: ['Boy ve süt gibi seçenekleri seçer.', 'Adedi 2 yapar.', '"Sepete ekle"ye basar.'] },
      { ad: 'm-sepet', baslik: '3. Sepete bakar', aciklamalar: ['2 Caffè Latte', '1 San Sebastian cheesecake', '"Siparişi gönder"e basar.'] },
    ]),
    not('<b>Menü her zaman görünür, sipariş her zaman değil.</b> Müşteri telefondan ancak kafede siparişi görecek bir personel ekranı (mutfak, garson ya da kasa) açıkken sipariş verebilir. Gün sonundan sonra ve kasiyer "QR siparişlerini durdur" dediğinde de sipariş durur. Bu durumlarda menünün üstünde <b>"Şu an sipariş almıyoruz, lütfen garsonunuza sorun."</b> yazar; müşteri yine menüye bakar, sepetine ekler ama gönderemez. "Garson çağır" bir personel ekranı açık olduğu sürece çalışır.', 'bilgi'),
    sekil('m-siparis-kapali', { genislik: 300, yan: true, aciklamalar: ['"Şu an sipariş almıyoruz, lütfen garsonunuza sorun."', '"Garson çağır" yine çalışır.'] }),
    p('Ayşe Hanım iki latte ve bir San Sebastian cheesecake seçer. Ekranın altındaki sepet çubuğu kaç ürün seçtiğini ve tutarı hep gösterir. Sepette ürün çıkarabilir, adedi değiştirebilir, ürüne not yazabilir. Telefonun dili Türkçe değilse menü kendiliğinden İngilizce açılır; sağ üstteki "EN" / "TR" düğmesiyle dil değişir ve o telefonda hatırlanır.'),
    h2('Sipariş mutfağa düşer'),
    p('İsterseniz QR siparişleri önce garsonun onayına düşer (Ayarlar → Sipariş ve mutfak → Sipariş ve onay). Bu, şakayla verilen siparişleri ve yanlış masayı önler. Garson siparişi telefonunda görür ve "Onayla ve mutfağa gönder" der. Onay istemiyorsanız "Otomatik onay"ı açarsınız; sipariş doğrudan mutfağa gider.'),
    serit([
      { ad: 'm-gonderildi', baslik: '4. Sipariş gönderildi', aciklamalar: ['Müşteri siparişin alındığını görür.'] },
      { ad: 'g-qr-onay', baslik: '5. Garson onaylar', aciklamalar: ['Masa ve sipariş numarası.', 'Mutfağa gönderir.', 'Gerekirse reddeder.'] },
    ], { genislik: 230 }),
    liste(['Müşteri gönderdikten sonra kısa bir süre (örnekte 60 saniye) siparişini kendisi düzeltebilir. Mutfakta bu süre "Müşteri değiştirebilir" diye görünür; bitince "Hazırlamaya başla" çıkar.', 'Değiştirirken süre biterse müşteri <b>"Değişiklik süreniz doldu"</b> görür; yarım değişiklik kaydedilmez, garsona seslenir.', 'Mutfak bir iptal isteğini gerekçeyle reddederse müşteri o siparişte bir daha "Siparişi iptal et" görmez.']),
    sekil('k-degistirebilir', { genislik: 300, yan: true, aciklamalar: ['Masa 5\'in siparişi mutfakta.', 'Müşterinin değiştirme süresi: süre bitince hazırlık başlar.'] }),
    sekil('k-yeni', { genislik: 600, aciklamalar: ['Masa 5\'in siparişi "Yeni sipariş" sütununa düştü.', '"Hazırlamaya başla", sonra "Hazır olarak işaretle".', 'Üstte her aşamada kaç sipariş olduğu yazar.'] }),
    h2('Garson servis eder'),
    p('Mutfak "Hazır" deyince garsonun telefonu kısa bir sesle ve titreşimle haber verir. "Servise hazır" sekmesinde kaç siparişin beklediği yazar. Garson tepsiyi masaya götürür ve "Teslim edildi"ye basar.'),
    serit([
      { ad: 'g-servise-hazir', baslik: '6. Servise hazır', aciklamalar: ['Bekleyen sipariş sayısı.', 'Masa 5\'in siparişi.', 'Masaya götürünce "Teslim edildi".'] },
      { ad: 'm-siparislerim', baslik: '7. Müşteri takip eder', aciklamalar: ['"Siparişlerim" sekmesi: masanın bütün hesabı; garsonun eklediği ürünler "Garson ekledi" yazar.', 'Siparişin durumu.', 'Hesabı ister.'] },
    ], { genislik: 230 }),
    h2('Hesabı ister, öder'),
    p('Ayşe Hanım kalkmadan önce "Hesabı iste"ye basar ve nasıl ödeyeceğini seçer: nakit ya da kart. Kasada ve garsonların ekranında "Masa 05 · Hesap istiyor" uyarısı çıkar.'),
    serit([
      { ad: 'm-hesap-iste', baslik: '8. Nasıl ödeyecek?', aciklamalar: ['Nakit ya da kart seçer.'] },
      { ad: 'm-hesap-istendi', baslik: '9. Hesap istendi', aciklamalar: ['Düğme "Hesap istendi" olur; kasa haberdardır.'] },
    ], { genislik: 230 }),
    sekil('c-odeme', { genislik: 520, aciklamalar: ['Kasiyer ödeme türünü seçer (burada kart).', 'İsterse bahşişi ayrıca yazar.', '"Ödemeyi kaydet" ile hesap kapanır.'] }),
    not('<b>Kart bahşişi kasadan nakit mi veriliyor?</b> İlk hâli kapalıdır; sahip Kasa ve giderler → Kasa ayarları → Gün sonu\'nda <b>"Kart bahşişini kasadan nakit öde"</b>yi açar. Açıksa kartla bahşişte pencere sorar: "Bahşiş garsona kasadan nakit verildi mi?" <b>Evet</b>: kasadan "Kart bahşişi nakit ödendi" çıkışı yazılır, beklenen nakitten düşer. <b>Hayır</b>: bahşiş garsona ödenecek olarak Vardiya ve bahşiş\'te kalır.', 'bilgi'),
    h2('"Hesabınız kapandı"'),
    sekil('m-kapandi', { aciklamalar: ['Müşterinin telefonunda "Hesabınız kapandı" yazar.', 'Google\'da değerlendirme bağlantısı.', 'Instagram\'da takip bağlantısı.'] }),
    p('Ödeme kaydedilince müşterinin telefonu bunu kendiliğinden gösterir. Hemen altında <b>"Bizi değerlendirin ve takip edin"</b> kartı çıkar: Google değerlendirme düğmesi ve işletmenizin sosyal medya hesapları. Memnun bir müşteri o anda iki dokunuşla size yorum bırakır.'),
    h2('"Gizlilik"'),
    p('Menünün en altında küçük bir <b>"Gizlilik"</b> bağlantısı vardır. Müşteri dokununca bu menünün neyi işlediğini sade bir dille okur: siparişin içeriği ve masa, "Siparişlerim" için telefonda tutulan küçük bir çerez (30 gün), menünün internetten Mola Merkez üzerinden geldiği ve Mola\'nın bu trafiği saklamadığı, menünün bir kopyasının Mola\'da durduğu. Verilerden işletmeniz sorumludur; Mola hizmet sağlayıcıdır. Metin şimdilik <b>taslaktır</b> (avukat kontrolünde).'),
    sekil('m-gizlilik', { genislik: 300, yan: true, aciklamalar: ['"TASLAK" etiketi: metin avukat kontrolünde.', 'Telefonda tutulan tek çerez ve neden tutulduğu.'] }),
    hizmet('social', 'Google değerlendirme düğmesi her pakette vardır. Instagram, TikTok gibi takip bağlantıları ve kalıcı QR kartları "Sosyal medya ve QR kartları" hizmetiyle gelir; ödeme sonrası her memnun müşteri yeni bir takipçi olabilir.'),
  ].join('');
}

function garson() {
  return [
    bolum('Garson', 'Garson Mola\'yı telefonundan kullanır. Ekranlar parmakla kolay basılacak kadar büyüktür; altta beş düğmelik bir menü vardır.'),
    hizmet('core', 'Garson sipariş defteri taşımaz, mutfağa koşmaz. Sipariş birkaç dokunuşla mutfağa gider, hazır olunca telefon haber verir.'),
    h2('Masalar'),
    sekil('g-masalar', { aciklamalar: ['Tek satırda özet: kaç masa açık, toplam açık hesap.', 'Filtreler: Tümü, Açık, Boş, Hazır. Hazır siparişi olan masa sayısı turuncu yanar.', 'Her masa küçük bir kutu: masa numarası, tutar, durum.', 'Alt menü: Masalar, Sipariş al, Servise hazır, Rezervasyon, Daha fazla.'] }),
    p('Masaların üstünde, varsa, garson çağıran masalar küçük bir şeritte durur (çoksa parmakla sağa kaydırın; <b>✓</b> "Tamam" demektir) ve onay bekleyen QR siparişleri tek satırdadır ("1 QR siparişi onay bekliyor · <b>Göster</b>"). Böylece masalar hep ilk ekranda kalır.'),
    p('Bir masaya dokununca masanın penceresi açılır. Burada masanın siparişlerini görür, yeni sipariş ekler ya da masayı başka bir masaya taşırsınız.'),
    sekil('g-masa-penceresi', { aciklamalar: ['"Sipariş ekle" bu masaya yeni sipariş açar.', '"Taşı / birleştir" hesabı başka masaya taşır ya da iki masayı birleştirir.'] }),
    p('<b>Kalabalık grup:</b> iki masayı birleştirmek için kasiyere gitmeniz gerekmez. Masanın penceresinde <b>Taşı / birleştir</b>\'e basın ve "Dolu masalar" arasından diğer masayı seçin; pencere "Masa 11 boşalır; iki masanın hesabı Masa 12 üzerinde tek hesap olur" der. <b>Hesapları birleştir</b> deyin. Siparişler, fiyatlar ve alınan ödemeler korunur, işlem kayda geçer (kasiyerinkiyle aynı kurallar).'),
    h2('Sipariş almak'),
    adimlar(['Alt menüden <b>Sipariş al</b>\'a dokunun.', 'Üstteki masa çipinden masayı seçin (örneğin "Masa 08").', 'Ürünün yanındaki yuvarlak <b>+</b> düğmesine basın. Seçeneği olmayan ürün hemen eklenir; seçenekli üründe küçük bir pencere açılır.', 'Aramak için ürünün adını ya da numarasını yazın.', 'Alttaki çubukta "3 ürün · ₺… · Gönder" yazar. <b>Gönder</b>\'e basınca sipariş mutfağa gider; telefon Masalar\'a döner ve masa seçimi boşalır (bir sonraki sipariş farkında olmadan aynı masaya gitmez).']),
    sekil('g-siparis', { aciklamalar: ['Siparişin masası. İlk seçenek "Masasız sipariş".', 'Ürün adı ya da numarasıyla arama.', 'Yuvarlak + bir adet ekler.', 'Sepet çubuğu: ürün sayısı, tutar ve Gönder.'] }),
    p('Çubuğun soluna dokunursanız sepet açılır. Burada adedi değiştirir, ürüne not yazar ("az şekerli", "buzsuz") ve masada oturan müşterinin siparişini <b>"Paketlensin"</b> diye işaretlersiniz.'),
    sekil('g-sepet', { aciklamalar: ['Adedi artırın ya da azaltın.', '"Paketlensin": masada sipariş verilen ama yanında götürülecek ürünler.', 'Siparişi mutfağa gönderin.'] }),
    not('Masa 5\'e 2 latte ve 1 cheesecake göndermek yaklaşık 8 dokunuştur.', 'ipucu'),
    h2('QR siparişlerini onaylamak'),
    p('İşletmeniz QR siparişlerine onay istiyorsa, müşterinin siparişi önce "QR sipariş onayları" kutusuna düşer ve telefon kısa bir ses çalar. Siparişe bakın, doğruysa "Onayla ve mutfağa gönder", yanlışsa "Reddet" deyin. "Otomatik onay" kutusu işaretliyse onay beklenmez.'),
    h2('Servise hazır ve "Teslim edildi"'),
    p('Mutfak bir siparişi hazır yapınca telefonunuz titrer, kısa bir not çıkar ("Masa 03 · #5 hazır") ve alt menüdeki "Servise hazır" düğmesinin üstünde sayı belirir. Siparişi götürünce <b>"Teslim edildi"</b>ye basın.'),
    p('İşletme sahibi masaları garsonlara paylaştırdıysa (garson ataması) ses, titreşim ve sayı yalnız <b>sizin masalarınız</b> ve kimseye verilmemiş masalar içindir. Başka garsonun masasındaki hazır sipariş listede gizli durur; gerekirse <b>"Diğer garsonların masaları"</b>na dokunup onu da teslim edebilirsiniz.'),
    h2('Siparişi değiştirmek (kola yerine ayran)'),
    p('Müşteri fikrini değiştirdiyse masanın penceresinde siparişin altındaki <b>Değiştir</b>\'e basın. Hangi ürünün değişeceğini, yeni ürünü, adedi, seçeneği ya da notu seçin; pencere eski ve yeni ürünü ve hesaptaki farkı ("Hesap farkı +₺50") gösterir. <b>Değişikliği kaydet</b> deyince hesap kendiliğinden düzelir, mutfak kartında "Değişti: 2 x Çay → 1 x Limonata" yazar; fiş basılmışsa mutfağa <b>DEĞİŞİKLİK</b> fişi çıkar.'),
    liste(['Hazırlanan ürünler <b>mutfak başlayana kadar</b> değişir. Mutfak başladıysa pencerede tek satır söyler: ürünü <b>İptal et</b> ile nedeniyle çıkarıp yenisini sipariş edin.', '<b>Hazır ürünler</b> (kutu kola, ayran, su, soda; işletme sahibi üründe "Hazır ürün" işaretler) <b>hesap ödenene kadar her zaman</b> başka bir hazır ürünle ya da adediyle değişir: masa penceresinde <b>Hazır ürünü değiştir</b>. Mutfak uyarılmaz; fiyat farkı hesaba yansır ve kasada "Değişti: Ayran → Kola · +₺5 · Garson · 21:40" diye görünür.', 'Ödemesi alınmış ürün değişmez; para geri verilecekse işletme sahibi iade yapar.']),
    h2('Uzun süredir sipariş vermeyen masa'),
    p('Hesabı açık bir masada uzun süredir (başlangıçta 45 dakika) yeni sipariş, çağrı ya da hesap isteği yoksa ekranın üstünde yumuşak bir not çıkar ve bir kez kısa bir ses çalar: <b>"Masa 5: 45 dakikadır yeni sipariş yok. Bir isteği var mı?"</b> Masaya uğrayınca <b>Gittim</b>\'e basın; not kapanır, aynı masa için en erken yine 45 dakika sonra gelir. Garson ataması açıksa not yalnız o masanın garsonuna gelir. Hesabı isteyen ya da mutfakta siparişi bekleyen masa için çıkmaz.'),
    h2('Garson çağrısı ve hesap isteme'),
    p('Müşteri telefonundan garson çağırınca ya da hesap isteyince ekranın üstünde renkli bir şerit çıkar: "Masa 15 · Garson çağırıyor · 3 dk bekliyor". Masaya gidince şeritteki <b>Tamam</b>\'a basın. İşletme sahibi masaları garsonlara paylaştırdıysa, sesi yalnız o masanın garsonu duyar.'),
    h2('QR siparişleri açık mı?'),
    p('QR siparişleri kapalıysa üst çubuğun altında ince sarı bir satır durur: <b>"QR siparişleri kapalı · elle durduruldu"</b> (ya da "gün sonu yapıldı", "personel ekranı bağlı değil"). Müşteri menüye bakar ama sipariş veremez; siparişi siz alırsınız. Garson açıp kapatamaz; kasiyere, müdüre ya da sahibe söyleyin.'),
    sekil('g-qr-kapali', { genislik: 300, yan: true, aciklamalar: ['Üst çubuğun altındaki satır: QR siparişleri kapalı ve nedeni (elle durduruldu).'] }),
    h2('Daha fazla'),
    sekil('g-daha-fazla', { aciklamalar: ['"Daha fazla" alttan açılır: Ajanda ve rezervasyon, Hesabım ve Çıkış yap gibi diğer yerler.'] }),
    liste(['<b>Rezervasyon:</b> İşletme sahibi izin verdiyse garson da masa ayırabilir. Garson rezervasyonda yalnız müşterinin adını görür, telefonunu görmez. Rezervasyondan 30 dakika önce masanın QR\'ı yeni siparişe kapanır ("QR kapalı · 20:00 rezervasyonu"); o masada müşteri sipariş isterse siz kendi telefonunuzdan alırsınız.', '<b>Hesabım:</b> Kendi şifrenizi değiştirirsiniz.', '<b>Oturumlar 05:00\'te biter.</b> İş günü sabah 05:00\'te döner; 04:30\'dan itibaren ekranda küçük bir uyarı çıkar. Ertesi gün yeniden giriş yaparsınız. Sepetinizdeki ürünler kaybolmaz.']),
  ].join('');
}

function kasiyer() {
  return [
    bolum('Kasiyer', 'Kasiyer Mola\'yı genellikle kasadaki bilgisayardan kullanır. Kasayı açar, ödemeleri alır, masasız satış yapar ve günü kapatır.'),
    hizmet('core', 'Kasa her zaman doğru: hangi ödemenin nakit, hangisinin kart olduğu, kasada ne kadar para olması gerektiği ve gün sonunda fark olup olmadığı kendiliğinden hesaplanır.'),
    h2('Güne başlarken: kasa açılışı'),
    p('Sabah ilk girişte Masalar ekranında "Kasa açılışı" kutusu çıkar. Kasadaki nakdi sayın, tutarı yazın ve "Açılışı kaydet"e basın. Dünkü kapanıştan farklıysa Mola bunu not eder ve işletme sahibine bildirir.'),
    sekil('c-kasa-acilis', { genislik: 560, aciklamalar: ['Kasadaki nakit (örneğin 500).', '"Açılışı kaydet".'] }),
    h2('Ödeme almak'),
    adimlar(['Masalar ekranında masaya dokunun. Hesap isteyen masalar ekranın üstünde uyarıyla görünür.', 'Masa penceresinde <b>Ödeme al</b>\'a basın.', 'Ne kadar ödeneceğini seçin: tamamı, bir kısmı ya da ürün seçerek (hesabı bölmek için).', 'Ödeme türünü seçin: <b>Nakit</b> ya da <b>Kart</b>. Müşteri hesabı isterken bir tür seçtiyse pencere o türle açılır ("Müşteri hesabı isterken “Kart” dedi."; not hesap kapanana kadar kalır). Nakitte "Alınan nakit"i yazın (hızlı düğmeler: Tam, ₺100, ₺200, ₺500, ₺1000); para üstü büyük yazıyla görünür ve kaydedince birkaç saniye kalır.', 'İsterseniz "+ Bahşiş ekle" ile bahşişi ayrıca yazın. Bahşiş satıştan sayılmaz.', '<b>Ödemeyi kaydet</b>\'e basın. Hesap tamamen ödendiyse masa kapanır.']),
    sekil('c-masa-penceresi', { genislik: 500, aciklamalar: ['Masa penceresindeki "Ödeme al".'] }),
    p('Garson bir ürünü değiştirdiyse (örneğin ayran yerine kola) ödeme penceresinde ve masa penceresinde turuncu bir satır görünür: <b>"Değişti: 1 x Ayran → 1 x Kola · +₺5 · Garson · 21:40"</b>. Fark hesaba zaten yansımıştır; kalan tutar masaya gidenin tutarıdır.'),
    p('<b>Fiş basılamazsa</b> (yazıcıda kâğıt yok, kapak açık, yazıcı kapalı) ekranın üstünde kırmızı bir satır nedenini ve yazıcıyı söyler: "Yazıcıda kâğıt yok · Kasa. Yeni rulo takın, sonra “Tekrar bas”a basın." Rulo takınca <b>Tekrar bas</b>\'a basın.'),
    sekil('c-odeme-nakit', { genislik: 420, yan: true, aciklamalar: ['Ne kadar ödenecek: tamamı, bir kısmı ya da ürün seçerek.', 'Ödeme türü: Nakit.', 'Alınan nakit; para üstü hemen altında.', '"Ödemeyi kaydet".'] }),
    h2('Yazar kasa yardımcısı'),
    p('İlk hâli <b>kapalıdır</b>; işletme sahibi Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa\'dan açar. Açıksa her ödemeden sonra köşede küçük bir kart yazar kasaya (ÖKC) neyin girileceğini söyler: KDV departmanı, tutar, ödeme türü. Girince <b>"Girildi"</b>ye basın. 3\'ten fazla kart birikirse eskiler tek satırda toplanır ("4 ödeme yazar kasaya girilmedi"). Gün sonunda Mola, Z raporu ile kendi toplamını karşılaştırır.'),
    sekil('c-yazar-kasa', { genislik: 400, yan: true, aciklamalar: ['Yazar kasaya girilecek tutar, KDV departmanı ve ödeme türü.', 'Girince "Girildi"ye basın.'] }),
    not('Mola henüz yazar kasaya doğrudan bağlanmaz (ÖKC entegrasyonu yoktur). Yardımcı, tutarları elle doğru girmeniz içindir.', 'bilgi'),
    h2('Masasız (al götür) satış'),
    p('Tezgâhtan alıp giden ya da ayakta bekleyen müşteri için masa açmanıza gerek yoktur. Sipariş al ekranındaki ilk seçenek <b>"Masasız sipariş"</b>tir.'),
    sekil('c-siparis-al', { genislik: 600, aciklamalar: ['"Masasız sipariş": masaya bağlı olmayan satış.', 'Ya da masayı seçin.'] }),
    adimlar(['"Masasız sipariş"e basın ve müşterinin adını yazın (telefon numarası yazmayın).', 'Ürünleri ekleyin ve siparişi gönderin. Mutfakta "MASASIZ #1" olarak görünür.', 'Ödeme penceresi hemen açılır. Müşteri sonra ödeyecekse "Sonra öde" deyin.', 'Masalar ekranında "Masasız siparişler" şeridi çıkar. Sipariş hazır olunca müşteriye verin ve <b>"Teslim edildi"</b>ye basın.']),
    sekil('c-masasiz', { genislik: 420, yan: true, aciklamalar: ['Müşterinin adı (çağırırken kullanılır).', 'Sepeti görüntüleyip gönderin.'] }),
    sekil('c-masasiz-serit', { genislik: 600, aciklamalar: ['Açık masasız siparişler: ad, aşama ve ödeme durumu.'] }),
    h2('Kasa işlemleri'),
    p('Masalar ekranındaki yeşil kasa çipine ("Kasa açık · 08:12\'den beri") dokununca kasa işlemleri açılır. Aynı işler soldaki menüde (telefonda alt çubukta) <b>Kasa</b>\'dadır: kasiyerin Kasa\'sında tek sayfa vardır (Bugün), sekme çubuğu yoktur.'),
    sekil('yeni-duzen-kasiyer', { genislik: 560, baslik: 'Soldaki menüde Kasa. Kasa: açılış, para bozdurma, Gider kaydet, İade, Vardiya kodu, Gün sonu.' }),
    sekil('c-kasa-menu', { genislik: 300, yan: true, aciklamalar: ['Kasa çipi: kasanın ne zamandan beri açık olduğu ve açılış tutarı.', '"Gider kaydet": yapılan bir ödeme (örneğin ekmek, süt). Paranın <b>Kasadan</b> mı, <b>Kasa dışından</b> mı (cepten, bankadan) çıktığını seçersiniz; yalnız "Kasadan" gün sonunda kasadaki nakitten düşer.', '"İade": müşteriye para iadesi.', '"Gün sonu": kasayı kapatır.'] }),
    liste(['<b>Para bozdurma:</b> Kasaya giren ve çıkan bozuk parayı kaydeder; toplam değişmez.', '<b>Kasa hareketi:</b> Kasaya para konması ya da çıkması.', '<b>Vardiya kodu:</b> Vardiya takibi açıksa çalışanların vardiyaya başlarken yazdığı kodu gösterir.']),
    h2('İade'),
    p('İade penceresinde bugünkü ödemeler listelenir. Masa, tutar ya da saatle arayın, ödemeye dokunun, iade edilecek ürünleri ve nedeni seçin. Kasiyerin bir seferde ve bir günde yapabileceği iadenin sınırı vardır; fazlası için işletme sahibine istek gider. İşletme sahibi (ya da müdür) iadeyi kendi telefonundan yaparsa kasanın Masalar ekranında yeşil bir şerit çıkar: "Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye verin." Yazar kasa iade kartı da kasanın ekranına düşer. Şeridi ✕ ile kapatırsınız; kayıt sahibin Bildirimler\'inde de durur.'),
    sekil('c-iade', { genislik: 420, yan: true, aciklamalar: [] }),
    h2('Gün sonu'),
    adimlar(['Kasa çipinden <b>Gün sonu</b>\'na basın. Pencere açık hesapları ve mutfakta bitmemiş siparişleri söyler.', 'Kasadaki nakdi sayıp yazın ve "Sayımı kaydet"e basın. <b>Kör sayım:</b> kasiyer ve müdür beklenen tutarı ve farkı ne önce ne sonra görür; ekranda "Gün sonu kaydedildi; sayım işletme sahibine iletildi." yazar. Fark yalnız sahibe gösterilir ve bildirilir.', 'Yazar kasa yardımcısı açıksa Z raporu toplamını yazın.', '<b>"Kapanışı tamamla"</b>ya basın. Bir dakika sonra kendiliğinden yedek alınır.']),
    p('Gün sonu yalnız sayımı yapanın vardiyasını bitirir; mutfak ve garsonlar kendi "Vardiyayı bitir"iyle ya da 05:00\'te çıkar.'),
    sekil('c-gun-sonu', { genislik: 360, yan: true, baslik: 'Kasa sayımı: banknot ve madeni paraları tek tek ya da tek toplam olarak yazın.' }),
    sekil('c-gun-sonu-sonuc', { genislik: 360, yan: true, baslik: 'Sayımdan sonra', aciklamalar: ['İşletme sahibinde: sayılan ve beklenen nakit; fark varsa \"Kasa fazla" ya da \"Kasa eksik" yazar ve açıklama istenir. Beklenen nakit eksiye düştüyse (kasadan yazılan giderler kasaya girenden fazla) nedeni de yazılır. Kasiyer ve müdür yalnız saydıkları tutarı görür.', 'Yazar kasanın Z raporu toplamı: Mola kendi toplamıyla karşılaştırır.', 'Yazar kasaya girilmemiş görünen ödemeler; girdiyseniz \"Girildi" deyin.'] }),
    not('Gün 05:00\'te döner. Gece 01:30\'da yaptığınız satış o gecenin gününe yazılır, ertesi güne değil.', 'bilgi'),
    h2('QR siparişleri: Açık / Kapalı'),
    p('Sol menünün en üstünde, işletme kartınızın hemen altında küçük bir kart durur. Açıkken sakin yeşildir: <b>"QR siparişleri açık · Müşteriler telefondan sipariş verebilir"</b> ve küçük bir <b>Durdur</b> düğmesi. Kapalıyken sarıdır: <b>"QR siparişleri kapalı"</b>, altında nedeni ve <b>Siparişleri aç</b> düğmesi. Kapalıyken Masalar\'ın en üstünde ince sarı bir şerit de çıkar: "QR siparişleri kapalı: müşteriler masadan sipariş veremiyor · Aç". Telefonda sol menü olmadığı için aynı bilgi üst çubuğun altında tek satırdır. Menü her durumda görünür.'),
    tablo(['Kartta yazan', 'Ne demek', 'Ne yapılır'], [
      ['Gün sonu yapıldı · müşteriler telefondan sipariş veremiyor', 'Gün sonunu tamamladınız; QR siparişleri o gün için durdu.', 'Satışa devam edecekseniz <b>Siparişleri aç</b>\'a basın. Sabah kasayı açınca ya da 05:00\'te kendiliğinden açılır.'],
      ['Elle durduruldu', 'Biri "Durdur" dedi.', '<b>Siparişleri aç</b>\'a basın. 30 dakikadan uzun kapalı kalırsa her ekranın üstünde "QR siparişleri 30 dakikadır kapalı" hatırlatması çıkar.'],
      ['Personel ekranı bağlı değil', 'Kafede siparişi görecek bir ekran (mutfak, garson, kasa) açık değil.', 'Bir ekranı açıp giriş yapın; birkaç saniyede kendiliğinden açılır.'],
    ]),
    sekil('c-qr-durumu', { genislik: 520, aciklamalar: ['Gün sonundan sonra sol menüdeki kart: "QR siparişleri kapalı · Gün sonu yapıldı".', '"Siparişleri aç": tek dokunuşla yeniden açar.', 'Masalar\'ın üstündeki ince şerit; "Aç" aynı işi yapar.'] }),
    adimlar(['Kalabalıkta mutfak yetişemiyorsa ya da kısa bir ara verecekseniz sol menünün üstündeki QR kartında <b>Durdur</b>a basın (telefonda üst çubuğun altındaki satırda).', 'Mola sorar: "Emin misiniz? Müşteriler telefondan sipariş veremez. Menü görünmeye devam eder, siparişleri garsonlar alır." <b>Durdur</b> deyin (vazgeçmek için Vazgeç).', 'Açmak için karttaki <b>Siparişleri aç</b>\'a ya da Masalar\'daki şeritte <b>Aç</b>\'a basın.']),
    sekil('c-qr-durdur', { genislik: 420, yan: true, aciklamalar: ['"Durdur": QR siparişleri durur, menü görünür.', '"Vazgeç": hiçbir şey değişmez.'] }),
    not('Durdurup açma kasiyer, müdür ve işletme sahibi ekranındadır; garson yalnız görür. Ayrı bir "kapanış saati" ayarı yoktur: gün sonu yapınca QR siparişleri kendiliğinden durur. Paket servis platformlarından gelen siparişler bu durumdan etkilenmez.', 'bilgi'),
  ].join('');
}

function mutfak() {
  return [
    bolum('Mutfak', 'Mutfak iki şekilde çalışabilir: mutfaktaki bir tablet ya da ekranda (Ekran modu) veya tek bir mutfak yazıcısından çıkan fişlerle (Fiş modu).'),
    hizmet('core', 'Siparişler kâğıt kaybolmadan, sırasıyla ve hangi masaya ait olduğu belli olarak mutfağa düşer. Geciken sipariş renk değiştirir.'),
    h2('Mutfak ekranı'),
    sekil('k-pano', { genislik: 620, aciklamalar: ['Yeni siparişler.', 'Hazırlananlar.', 'Hazır olanlar: garson götürünce "Teslim edildi".', '"Stok": mutfak sayım ve fire kaydeder.'] }),
    liste(['Her kart bir siparişdir: masa, sipariş numarası, kimin verdiği (personel ya da misafir), kaç dakikadır beklediği, ürünler, seçenekler ve notlar.', '<b>"Hazırlamaya başla"</b> kartı ortadaki sütuna, <b>"Hazır olarak işaretle"</b> sağdaki sütuna taşır. Garsonun telefonu o anda haber alır.', 'Yanlışlıkla bastıysanız 5 saniye içinde <b>"Geri al"</b> çıkar.', 'QR siparişinde müşteri ilk dakikada siparişini değiştirebilir; kartta "Müşteri değiştirebilir" yazar, süre bitince başlayabilirsiniz.', 'Biri bir siparişi iptal ederse panonun üstünde yarım dakika kırmızı <b>"İPTAL"</b> şeridi çıkar ve ses çalar.', 'Sesler için ekrana bir kez dokunun. "Ekranı açık tut" tabletin kararmasını önler.']),
    sekil('k-gecikti', { genislik: 260, yan: true, aciklamalar: ['10 dakikayı geçen kart turuncu ("Gecikti"), 20 dakikayı geçen kırmızı ("Çok gecikti") olur.'] }),
    h2('Dik tablet ya da telefon'),
    sekil('k-dik', { genislik: 330, yan: true, aciklamalar: ['Dar ekranda üç sütun yerine "Yeni · Hazırlanıyor · Hazır" sekmeleri.'] }),
    h2('Fiş modu (tek mutfak yazıcısı)'),
    p('Mutfakta ekran kullanmıyorsanız siparişler mutfak yazıcısından fiş olarak çıkar. Fiş basılınca sipariş "Hazırlanıyor" olur. Garson götürünce masadan "Teslim edildi" der; demezse hesap kapanınca kendiliğinden teslim edilmiş sayılır.'),
    sekil('s-mutfak-modu', { genislik: 560, aciklamalar: ['Ekran: siparişler tablette kart olarak görünür.', 'Fiş: her sipariş mutfak yazıcısından çıkar.'] }),
    not('Fiş basılamazsa ("Yazıcıda kâğıt yok · Mutfak", "Yazıcının kapağı açık", kablo çıktı) kasada ve garson telefonlarında kırmızı uyarı çıkar: "Tekrar bas" ya da "Elle iletildi". Ayar yeri: Ayarlar → Sipariş ve mutfak → Mutfak. Fiş için önce Ayarlar → Cihazlar → Yazıcılar\'dan bir yazıcıyı "Mutfak fişleri" için seçin.', 'dikkat'),
    h2('Yazıcıda kâğıt yok'),
    p('Mola fişi göndermeden önce yazıcıya durumunu sorar (ağ yazıcısında doğrudan yazıcıya, USB yazıcıda Windows\'a). Kâğıt bitmişse, kapak açıksa ya da yazıcı kapalıysa fiş gönderilmez ve uyarı çıkar. Ekran modunda uyarı mutfak kartındadır: <b>"Fiş basılamadı: Yazıcıda kâğıt yok · Mutfak."</b> Rulo takınca karttaki <b>Tekrar bas</b>\'a basın. İşletme sahibine de zilde bir bildirim gider. Rulo bitmek üzereyse ("kâğıt azaldı") sahibe günde bir kez haber verilir.'),
    not('Bazı USB yazıcıların Windows sürücüsü "kâğıt yok" bilgisini Windows\'a vermez (özellikle "Generic / Text Only"). Böyle bir yazıcıda uyarı çıkmayabilir; yazıcının kendi sürücüsünü kurmak ya da ağ (Ethernet) bağlantısı kullanmak en güvenlisidir.', 'bilgi'),
    h2('Garsonun değişiklikleri'),
    p('Garson mutfak başlamadan bir ürünü değiştirirse kartta turuncu bir satır çıkar: <b>"Değişti: 2 x Demleme Çay → 1 x Ev Yapımı Limonata · Garson"</b>, panonun üstünde kısa bir <b>DEĞİŞTİ</b> şeridi ve sipariş sesi çalar. Fiş modunda mutfağa <b>DEĞİŞİKLİK</b> fişi çıkar (eski ve yeni ürün, siparişin son hali). Hazır ürünlerin (kola, ayran…) değişmesi mutfağa gelmez.'),
  ].join('');
}

function mudur() {
  return [
    bolum('Müdür', 'Müdür, işletme sahibi kafede değilken günü yönetir. Müdür hesabı her pakette vardır.'),
    hizmet('core', 'Sahibin şifresini kimseyle paylaşmadan, günlük yönetimi güvendiğiniz birine bırakırsınız.'),
    p('Müdür hesabını işletme sahibi açar: Personel → Çalışanlar → Çalışan ekle → Görevi: <b>Müdür</b>. Görev seçilince müdürün neyi yapıp neyi yapamayacağı aynı pencerede listelenir.'),
    sekil('mu-calisan-ekle', { genislik: 380, yan: true, aciklamalar: ['Görevi "Müdür" seçin.'] }),
    tablo(['Müdür yapabilir', 'Müdür yapamaz (yalnız sahip)'], [[
      'Sipariş, ödeme, iptal, masa taşıma<br>QR siparişi onayı<br>Kasa ve giderler: Bugün (açılış, gider, gün sonu), Giderler (kayıt ekler), Kapanışlar (farkı görmez), İadeler (sınırsız)<br>QR siparişlerini durdurma ve açma<br>Stok (alış dahil)<br>Menü yönetimi: Ürünler, Kampanyalar<br>Personel: Vardiya ve bahşiş (okur)<br>Ajanda, rezervasyon ve etkinlik<br>Satış ve Raporlar',
      'Ayarlar ve her evin "ayarlar" sekmesi (Kasa ayarları, Personel ayarları, KDV oranları, Ajanda → Ayarlar)<br>Personel → Çalışanlar (hesaplar)<br>Kasadan "Sahip aldı / Bankaya" çıkışları, kapanışa düzeltme<br>Gider düzeltme ve silme, otomatik giderler<br>Masa ekleme ve çıkarma, QR yenileme<br>Destek, bildirim zili, lisans, yedek, güncelleme<br>Rapor kodunu kurmak',
    ]]),
    sekil('mu-ekran', { genislik: 600, aciklamalar: ['Müdürün menüsü: GÜNLÜK (Masalar, Sipariş al, Kasa ve giderler, Ajanda) ve İŞLETME (Menü yönetimi, Stok, Personel, Satış ve Raporlar); Ayarlar yoktur.', 'Kasa ve giderler: Bugün, Giderler, Kapanışlar, İadeler (Kasa ayarları yoktur).'] }),
    p('Müdür <b>Personel</b>\'de yalnız <b>Vardiya ve bahşiş</b>\'i görür (sekme çubuğu yoktur); çalışan hesaplarını açamaz. Telefonda alt çubuk: Masalar · Sipariş al · Kasa · Raporlar; Stok "Daha fazla"dadır.'),
    not('Müdür kasa farkını hiçbir yerde görmez: gün sonu sayımında, Kasa ve giderler → Kapanışlar\'da, yazdırılan sayfada ve Excel\'de yalnız kimin, ne zaman, ne saydığı yazar; beklenen nakit ve fark yalnız işletme sahibindedir. İşletme sahibi raporlar için telefon kodu kurduysa müdür raporları açarken <b>sahibin</b> telefonundaki 6 haneli kodu yazar. Müdür, sahibin "önemli duyuru" penceresini görmez ama Duyurular\'ı okuyabilir.', 'bilgi'),
  ].join('');
}

function sahip() {
  return [
    bolum('İşletme sahibi', 'İşletme sahibi Mola\'nın her yerini görür. Bu bölüm menüdeki her yeri ve her ayarı sırasıyla anlatır.'),
    h2('İlk giriş: lisans sözleşmesi'),
    p('İlk girişinizde (ve sözleşmenin yeni bir sürümü çıktığında) Mola Lisans Sözleşmesi bir kez sorulur. Okuyup "Okudum, kabul ediyorum" deyin. Şimdi okuyamıyorsanız "Daha sonra" deyin (ya da pencereyi kapatın): bu girişte bir daha sorulmaz, sayfa yenilense de gelmez; bir sonraki girişte yeniden sorulur. Kabul ettikten sonra hiç sorulmaz. Pencere açıkken ekran kilitlenirse önce şifrenizle kilidi açın; pencere yerinde durur. Bu pencere siparişleri, ödemeyi ve mutfağı hiç durdurmaz; çalışanlarınız görmez.'),
    sekil('s-lisans-sozlesmesi', { genislik: 470, yan: true, aciklamalar: ['Sözleşmeyi kabul edin.', 'Ya da sonraya bırakın.'] }),
    h2('Masalar'),
    sekil('s-masalar', { genislik: 665, aciklamalar: ['Sol menü iki başlık altında: GÜNLÜK (Masalar, Sipariş al, Kasa ve giderler, Ajanda ve rezervasyon) ve İŞLETME (Menü yönetimi, Stok, Personel, Satış ve Raporlar); altta Ayarlar ve Hesabım, en altta Destek.', 'Günün özeti: açık masa, açık hesap, bugünkü satış, mutfaktaki ve onay bekleyen siparişler ("Mutfakta 3 · Onayda 4"), servise hazır.', 'Kasa çipi ve kasa işlemleri (Gider kaydet, İade, Gün sonu): Kasa ve giderler → Bugün\'ün kısayolu.', 'Masa ekle, masa çıkar, sipariş al.', 'Masaların durumu renkle görünür.', '"İlk adımlar": kurulumda yapılacaklar listesi.'] }),
    p('Telefonda Masalar, garson telefonundaki gibi sadedir: tek satırlık özet, Tümü / Açık / Boş / Hazır çipleri ve küçük masa kutuları; slogan ve büyük kartlar yoktur, "İlk adımlar" tek satırda kapalı durur.'),
    p('Masalar ekranı işletmenin anlık hâlidir. Masalar bölümlere ayrılır (İç salon, Bahçe, Teras). Her masa durumunu renkle söyler: boş, yeni sipariş, hazırlanıyor, servise hazır, teslim edildi, onay bekliyor, temizlik bekliyor.'),
    h3('İlk adımlar'),
    p('Kurulumdan sonra Masalar\'ın üstünde "İlk adımlar" kartı durur: menüyü kontrol edin, çalışan ekleyin, yazıcı bağlayın, QR kodlarını basın, kurtarma kodunu kaydedin, ikinci yedek yerini seçin. Yaptıkça işaretlenir.'),
    sekil('s-ilk-adimlar', { genislik: 600 }),
    h3('Masa penceresi ve QR menü'),
    sekil('s-masa-penceresi', { genislik: 420, yan: true, aciklamalar: ['"QR menüyü aç": masanın QR kodu ve adresi.', 'Sipariş ekle.', 'Taşı / birleştir.', 'Ödeme al.'] }),
    sekil('s-masa-qr', { genislik: 330, yan: true, aciklamalar: ['QR kodun taşıdığı internet adresi.', 'Müşterinin göreceği menüyü kendiniz açın.'] }),
    p('"QR kodunu indir" ile tek bir masanın QR kodunu, altında büyük masa adıyla resim olarak alırsınız. Kaybolan ya da çalınan bir QR için "QR yenile" eskisini geçersiz yapar.'),

    h2('Sipariş al'),
    p('İşletme sahibi de garson ve kasiyer gibi sipariş alır: Masalar\'daki <b>Sipariş al</b> düğmesi ya da soldaki menü. Masayı seçin, ürünleri + ile ekleyin, Gönder deyin. Kasiyer ve sahip ekranında ürün numarasıyla hızlı ekleme kutusu da vardır. Masasız (al götür) satış için ilk seçenek \'Masasız sipariş\'tir (Kasiyer bölümünde anlatıldı).'),
    h2('Yeni düzen: her konunun tek evi'),
    p('10 Ekim 2026\'dan beri her konunun tek bir evi vardır: o konunun günlük işi, kayıt defteri ve ayarı aynı yerde, sekmelerle durur. Üstte simgeli büyük sekmeler (1. seviye), bir sekme birden fazla şey tutuyorsa altında daha sade ikinci bir sekme satırı (2. seviye) vardır; üçüncü bir seviye yoktur. Evin <b>ayarlar sekmesi</b> her zaman en sondadır, dişli simgesi taşır ve yalnız sizde görünür. Seçtiğiniz sekme ve alt sekme o cihazda hatırlanır.'),
    tablo(['Ev', 'Sekmeler (alt sekmeler)', 'Kim görür'], [
      ['Kasa ve giderler (telefonda "Kasa")', 'Bugün · Giderler (Kayıtlar · Otomatik giderler) · Kapanışlar · İadeler · Kasa ayarları (Gün sonu · Kart ve yazar kasa · Kasiyer yetkileri)', 'Siz hepsini; Müdür Kasa ayarları ve Otomatik giderler hariç; kasiyer yalnız Bugün'],
      ['Menü yönetimi', 'Ürünler · Kampanyalar · KDV oranları', 'Siz; Müdür KDV oranları hariç'],
      ['Personel (eski adı Çalışanlar)', 'Çalışanlar · Vardiya ve bahşiş (Vardiyalar · Bahşiş) · Personel ayarları (Vardiya · Bahşiş · Garson ataması)', 'Siz; Müdür yalnız Vardiya ve bahşiş'],
      ['Ajanda ve rezervasyon', 'Rezervasyonlar · Etkinlikler · Takvim · Ayarlar', 'Siz; Müdür Ayarlar hariç; kasiyer ve garson izinle'],
      ['Satış ve Raporlar', 'Yalnız okunan raporlar: Satış (Özet, Ürünler, Kârlılık, Kampanyalar) · Personel (Çalışanlar) · Rezervasyon', 'Siz ve Müdür'],
      ['Ayarlar', 'Bir kez kurulanlar: İşletme · Masalar ve QR · Sipariş ve mutfak · Cihazlar · Güvenlik ve yedek', 'Yalnız siz'],
    ]),
    p('<b>Bildirimler</b> artık sağ üstteki <b>zil</b>dedir: okunmamış bildirim varsa zil yumuşak bir mercan rengine döner ve üstünde sayısı yazar; her bildirimin yanında onu çözen yere giden bir düğme vardır ("İadeyi yap", "Kapanışları aç", "Giderleri aç", "Stoğa git"). Eski yerlerde iki sürüm boyunca <b>"Taşındı → Git"</b> satırları durur; basınca yeni yer açılır. Ayarlar\'ın en altındaki <b>"Aradığınız ayar burada yok mu? Taşınan ayarlar"</b> listesi de taşınan her ayarı gösterir.'),
    sekil('yeni-duzen-sahip-masaustu', { baslik: 'Sol menü: GÜNLÜK ve İŞLETME başlıkları. Evin sekmeleri (1. seviye). Alt sekmeler (2. seviye): Kayıtlar · Otomatik giderler. Sağ üstte Bildirimler zili.' }),

    h2('Kasa ve giderler'),
    hizmet('core', 'Kasanın bugünü, giderleriniz, kasa kapanışları ve iadeler tek yerde; kasa ayarları da yanında.'),
    liste(['<b>Bugün:</b> kasa açılışı, Kasa hareketi (Sahip aldı, Bankaya, para bozdurma), <b>Gider kaydet</b>, İade, Vardiya kodu ve Gün sonu. Masalar\'daki kasa çipi aynı işlerin kısayoludur.', '<b>Giderler → Kayıtlar:</b> dönemin giderleri, "Gider ekle", "Düzelt" (yalnız siz), silinen giderler; "Otomatik" rozetli satır kuralını açar. "Kasiyerin gider sınırı" bağlantısı Kasa ayarları\'na gider.', '<b>Giderler → Otomatik giderler:</b> kira, maaş, abonelik gibi düzenli giderler günü gelince kendiliğinden yazılır (yalnız siz).', '<b>Kapanışlar:</b> gün sonu ve vardiya devirleri, kişilere göre farklar, "Düzeltme ekle", kapanış fişi.', '<b>İadeler:</b> tahsilat defteri, bekleyen iade istekleri, iade ve ödeme türü düzeltme. Kapanmış masadaki "Ödemeyi düzelt" buraya, o ödemenin gününe açılır.', '<b>Kasa ayarları</b> (yalnız siz): <b>Gün sonu</b> (kapanış saati, not isteyen fark, kart bahşişini kasadan nakit öde), <b>Kart ve yazar kasa</b> (POS komisyon oranı, yazar kasa yardımcısı; ilk hâli kapalı), <b>Kasiyer yetkileri</b> (iade sınırları, nakit gider uyarısı, kim ne yapabilir).']),
    not('Giderler, Kapanışlar ve İadeler, raporlar gibi <b>telefon kodu</b> ekranının arkasındadır (kod kurduysanız). Dönem seçimi, "Yazdır / PDF" ve "Muhasebeci için indir" burada da vardır.', 'bilgi'),
    sekil('yeni-duzen-kasa-ayarlari', { baslik: 'Kasa ayarları sekmesi. Alt sekmeler: Gün sonu · Kart ve yazar kasa · Kasiyer yetkileri.' }),

    h2('Menü yönetimi'),
    p('Üç sekme: <b>Ürünler</b> (aşağıda), <b>Kampanyalar</b> (eskiden ayrı bir yerdi) ve <b>KDV oranları</b> (yalnız siz; eskiden Ayarlar → Giderler ve kâr). Ürün penceresindeki KDV listesinin altındaki "KDV oranlarını yönet" de bu sekmeyi açar; "Menüyü önizle" penceresindeki "Görünümü değiştir" Ayarlar → İşletme → Görünüm\'ü açar.'),
    hizmet('core', 'Fiyatı, ürünü, fotoğrafı ve "tükendi" durumunu anında değiştirirsiniz. Değişiklik bütün tabletlere ve müşteri menüsüne hemen gider; menü yeniden basılmaz.'),
    sekil('s-menu-yonetimi', { aciklamalar: ['Ürün ekle.', 'Kategorileri yönet: ekle, sırala, alt başlıklar.', 'Menüyü önizle: müşterinin gördüğü menü.', 'Taslaklar: henüz yayınlanmamış ürün ve değişiklikler.', '"Tükendi": ürün menüde soluk görünür, sipariş alınmaz.'] }),
    sekil('s-urun-duzenle', { genislik: 420, yan: true, aciklamalar: ['Fiyat.', 'KDV oranı. Alkollü içecek gibi görünen yeni üründe Mola %20\'yi kendisi seçer; değilse değiştirirsiniz.'] }),
    p('Ürün penceresinde ad, İngilizce ad, fiyat, kategori, açıklama, içindekiler, fotoğraf, seçenek grupları (boy, süt, şeker) ve ürün kodu bulunur. <b>"Hazır ürün"</b> kutusunu kutu, şişe gibi mutfakta hazırlanmayan ürünlerde işaretleyin: garson bu ürünü hesap ödenene kadar değiştirebilir. Fotoğrafı telefonla çekip seçebilirsiniz (iPhone dahil); büyük fotoğraf göndermeden önce telefonda kendiliğinden küçültülür ve düz çevrilir. Değişikliği "Taslak" olarak saklayıp sonra yayınlayabilirsiniz. "Bu bölümdeki ürünlere uygula" ile bir KDV oranını bütün kategoriye verirsiniz.'),

    h3('Menü yönetimi → Kampanyalar'),
    hizmet('core', 'Sakin saatleri doldurur, ürün satışını artırırsınız. Kampanya kendiliğinden başlar ve biter; kasada indirim elle yazılmaz.'),
    sekil('s-kampanyalar', { aciklamalar: ['Kampanya ekle.', 'Örnek: "Çay Keyfi: 4 çay ve üzeri %25".'] }),
    p('Kampanya penceresi beş adımdır: <b>1. Ne indirimi?</b> (ad, yüzde ya da TL), <b>2. Hangi ürünler?</b> (seçtiğiniz ürünler ya da bir bölümün tamamı), <b>3. Ne zaman?</b> (<b>Tarih aralığı</b>; <b>Her hafta</b>: seçtiğiniz günler, örneğin hafta içi 12:00–15:00; <b>Her ay</b>: ayın bir günü, örneğin maaş günü her ayın 15\'i; o gün olmayan aylarda ayın son günü), <b>4. Sınır</b> (isteğe bağlı: adet koşulu, toplam adet sınırı) ve <b>5. Durum</b>. Sağda (telefonda en altta) <b>"Müşteri menüde böyle görür"</b> kutusu müşterinin göreceği fiyatı ve kampanyanın ne zaman görüneceğini gösterir.'),
    p('Kampanya hiçbir onay beklemez. Her kartın üstünde dört durumdan biri yazar: <b>Taslak</b> (kapalı; menüde görünmez), <b>Planlandı</b> (başlangıcı gelince kendiliğinden başlar; o zamana kadar menüde görünmez), <b>Aktif</b> (menüde görünür, indirim kendiliğinden uygulanır; tekrarlanan kampanyada yalnız seçilen gün ve saatlerde) ve <b>Bitti</b> (süresi ya da adet sınırı doldu). Adet sınırlı kartta yazan "garson onayı bekleyen QR siparişleri de sayılır" cümlesi siparişler içindir, kampanya için değil. Kampanyalı ürün müşteri menüsünde "Kampanyalı ürünler" altında görünür; adet koşullu kampanyada üründe "2 adet ve üzeri indirimli" yazar, tek adet normal fiyatındadır. Her ay tekrarlanan kampanyanın raporunda her ayın günü ayrı satırdır ("Tekrarlar").'),
    p('Kampanya kartındaki "Sonuçları gör" Satış ve Raporlar → Satış → Kampanyalar\'ı o kampanyayla açar; raporda "Kampanyayı düzenle" geri getirir.'),
    p('<b>Kampanya bitince</b> (süresi dolunca ya da adet sınırı dolunca) bir sonraki açılışta size bir kez <b>"Kampanya bitti: 2 al 1 öde · Latte"</b> penceresi çıkar: kaç siparişte uygulandığı, kampanyalı kaç adet satıldığı, indirim sonrası ciro ve verilen indirim toplamı. Ürünlerin reçete maliyeti varsa <b>brüt kâr</b>, raporda karşılaştırma varsa önceki dönemin günlük satışına göre değişim de yazar (yoksa yazılmaz, tahmin edilmez). <b>Raporu aç</b> kampanya raporunu, <b>Kampanyayı yinele</b> aynı kampanyanın bir kopyasını bugünden başlayan ve aynı süren yeni tarihlerle düzenleyicide açar (kaydetmeden önce değiştirebilirsiniz), <b>Kapat</b> pencereyi kapatır. Pencere bir daha çıkmaz; haberi Bildirimler\'de (zil) kalır. Müdür yalnız zildeki bildirimi görür; bu sürümden önce biten kampanyalar için pencere çıkmaz.'),    sekil('s-kampanya-ekle', { genislik: 400, yan: true }),

    h2('Stok, reçete ve kârlılık'),
    hizmet('stock', 'Hangi malzemenin bittiğini önceden görür, ürün başına gerçek kârınızı öğrenirsiniz. "Kaç adet yapılabilir" sorusunun cevabı ekranda.'),
    sekil('s-stok-malzemeler', { aciklamalar: ['Malzemeler: elde ne kadar var, uyarı sınırı.', 'Malzeme ekle.', 'Sınırın altına düşen malzeme uyarı rengiyle görünür.'] }),
    liste(['<b>Malzemeler:</b> Kahve, süt, şeker gibi malzemeler; birimi, elde kalan, uyarı sınırı ve birim fiyatı. <b>Uyarı sınırı:</b> stok bu miktarın altına düşünce size "Azalıyor" bildirimi gelir (örneğin süt için 2 litre); boş bırakırsanız uyarı gelmez. "Malzeme ekle" penceresinde her alanın yanındaki gri <b>i</b> işareti o alanı kısaca anlatır.', '<b>Reçeteler:</b> Bir latte = 18 g kahve + 200 ml süt. Hazır alınan ürün (cheesecake) adetle izlenir. <b>"Seçenekler stoktan düşen miktarı değiştiriyor mu?"</b> bölümü müşteriye görünmez: Değişmez; Miktar değişir (%) (reçetedeki bütün malzemeler bu oranda, Büyük boy %150); Malzeme eklenir (Ekstra shot +9 g kahve); Yerine başka malzeme (yulaf sütü sütün yerine). Her seçeneğin altında "Sütlü satılınca stoktan: Kahve 20 g, Süt 100 ml düşer." cümlesi, altta her seçeneğin maliyeti, satış fiyatı ve kâr oranı küçük bir tabloda görünür (Kârlılık raporuyla aynı hesap).', '<b>İşlem geçmişi:</b> Stok ekranının sağ üstündeki düğme (ve malzeme penceresindeki "Bu malzemenin işlem geçmişi"). Alış, sayım, fire, iade, fiyat düzeltme, geri alma, reçete değişikliği, malzeme ekleme / düzenleme / silme ve uyarı sınırı değişiklikleri; kim (rolüyle), ne zaman, hangi malzeme, ne kadar ve önce → sonra. Bugün / 7 gün / 30 gün / Tümü, malzeme, kişi ve arama ile süzülür; en yenisi üstte, 25 kayıt bir sayfa. İşletme sahibi ve Müdür herkesi görür; mutfak yalnız kendi sayım ve fire kayıtlarını.', '<b>Ürünler:</b> Her ürünün maliyeti ve "kaç adet yapılabilir". Altındaki <b>"Sınırlayan malzeme: Süt"</b>, tarifte en önce bitecek malzemedir; yanındaki <b>i</b> hesabı gösterir ("en fazla 200 adet yapılabilir; süt stoğu 50 L, ürün başına 250 ml").', '<b>Alış ve sayım:</b> Alış faturası, sayım ve fire kaydı. Mutfak sayım ve fire yazabilir. Alışta tek soru vardır: <b>\"Para nereden çıktı?\"</b> <b>Kasadan</b> (gün sonunda beklenen nakitten düşer), <b>Kasa dışından</b> (cepten, bankadan ya da kartla; \"Nasıl ödendi?\" de sorulur, kasa değişmez) ya da <b>Ödenmedi (veresiye)</b> (gider yazılmaz, yalnız stok artar; ödeyince Kasa ve giderler → Giderler\'den eklersiniz). Formdaki ve kaydettikten sonraki yeşil satırdaki "Giderlerde gör", Kasa ve giderler → Giderler → Kayıtlar\'ı açar; yeşil satırdan açınca o gider işaretli ve görünür hâlde gelir. Hiçbiri hazır seçili gelmez; seçmeden kaydedilmez, böylece kasadan ödenen alış gidersiz kalmaz. Kasadan derseniz ve kasada o kadar nakit görünmüyorsa, sorunun hemen altında kısa sarı bir not çıkar (\"Kasada şu an ₺410 görünüyor; bu çıkışla −₺57 olur. Para kasadan çıkmadıysa ‘Kasa dışından’ı seçin.\"). Para gerçekten kasadan çıktıysa <b>Alışı kaydet</b>\'e basmanız yeter; Giderler\'deki <b>Gider ekle</b> de aynı çalışır.', '<b>Son hareketler:</b> son 3 kayıt; hepsi sağ üstteki <b>Tümü</b> ile İşlem geçmişinde.', '<b>Yanlış kaydı geri almak:</b> Son hareketler\'de satırın sonundaki <b>üç nokta</b> düğmesi → <b>"Bu kaydı geri al"</b>. Önce ne olacağı yazılır ("Bu alış kaydı silinir. Kahve stoğu 1 kg → 0 g olur."); "Evet, geri al" demeden hiçbir şey değişmez. Yalnız <b>bugün</b> yazılan kayıtlar geri alınır (iş günü 05:00\'te değişir). Daha eski bir kayıt ya da başlangıç miktarı yanlışsa sayım yapın: stok sayılan miktardan devam eder. Geri alınan kayıt silinmez; kimin ne zaman geri aldığıyla "Geri alınanlar" listesinde kalır. Mutfak yalnız kendi sayım ve fire kaydını geri alabilir.', 'Sipariş iptal edilince Mola "ürün yapıldı mı?" diye sorar; yapılmadıysa stok geri gelir.']),
    sekil('s-stok-receteler', { genislik: 500, aciklamalar: ['Caffè Latte\'nin reçetesi: hangi malzemeden ne kadar.'] }),
    sekil('s-stok-urunler', { genislik: 560, aciklamalar: ['"Sınırlayan malzeme": tarifte en önce bitecek malzeme; <b>i</b> hesabı gösterir.'] }),
    sekil('s-stok-geri-al', { genislik: 560, aciklamalar: ['Satırın sonundaki üç nokta.', '"Bu kaydı geri al".'] }),
    sekil('s-stok-geri-al-onay', { genislik: 400, yan: true, baslik: 'Önce stoğun nasıl değişeceği yazılır; "Evet, geri al" demeden hiçbir şey değişmez.' }),
    sekil('s-rapor-karlilik', { baslik: 'Satış ve Raporlar → Satış → Kârlılık' }),
    p('Stok → Reçeteler\'deki "Kârlılığı gör" bu raporu açar. <b>"Uyarı sınırları"</b> düğmesi (yalnız siz) düşük kâr uyarısının ürün gruplarına göre sınırlarını değiştirir (eskiden Ayarlar → Giderler ve kâr).'),

    h2('Satış ve Raporlar'),
    hizmet('core', 'Günün, haftanın, ayın ve yılın sonucunu tek cümleyle görürsünüz; muhasebeciniz için dosyayı tek tuşla alırsınız.'),
    p('Satış ve Raporlar yeni bir cihazda önce <b>sade özet</b> olarak açılır: tek bir cümle, dört büyük sayı, en çok kazandıran üç ürün (tutarıyla) ve kasa durumu.'),
    sekil('s-rapor-sade', { aciklamalar: ['Dönem: Bugün, 7 gün, 30 gün, Yıl ▾, Tümü, Tarih seç.', 'Günün tek cümlelik özeti ve dünle karşılaştırma.', '"Detaylı göster": bütün raporlar ve grafikler.', 'Yazdır / PDF.', 'Muhasebeci için indir (Excel).'] }),
    liste(['<b>Bugün</b> iş gününü gösterir: 05:00\'ten 05:00\'e. Gece 01:30\'daki satış o gecenin günüdür.', '<b>Yıl ▾</b> bu yılı açar; menüden kayıt olan eski yılları seçersiniz. Bu yıl "geçen yılın aynı dönemine göre", geçmiş bir yıl "önceki yıla göre" karşılaştırılır. "Açık hesaplar" (henüz ödenmemiş masalar) yalnız bugünü içeren dönemlerde görünür.', '<b>Tümü</b> yılları bir tablo olarak gösterir: satış, iade, gider, elde kalan ve KDV. Bir yıla dokununca o yıl açılır.', '<b>Elde kalan</b> = satış − giderler − iadeler − kart komisyonu. Karta dokunun (bilgisayarda üzerine gelin): hesap satır satır açılır. Kart komisyonunun yanında kart satışına oranı yazar (örn. %2,5); çok yüksekse "POS oranını kontrol et" bağlantısı Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa\'yı açar.', '<b>Giderler</b> kartındaki "Gider kayıtlarını aç" Kasa ve giderler → Giderler\'i açar; karta dokununca neyin gider sayıldığı görünür: stok alışları, diğer giderler ve kayıtlar tek tek. Stok alışları alındığı gün gider sayılır; malzemenin kâra etkisi Kârlılık\'ta ayrıca görünür.', 'Bir günü seçtiğinizde ve gün sonu yapıldıysa Kasa durumu kartında <b>"Gün sonu sayımı · Beklenen · Fark"</b> satırı çıkar (yalnız işletme sahibine): sayım yalnız kasadaki nakdi gösterir, Elde kalan kart dahil bütün satıştan hesaplanır.']),
    sekil('s-rapor-yil', { genislik: 420, yan: true, aciklamalar: ['Yıl seçici: bu yıl ve kayıtlı eski yıllar.'] }),
    sekil('s-rapor-tumu', { aciklamalar: ['"Tümü".', 'Yıllara göre tablo ve toplam.'] }),
    h3('Detaylı raporlar'),
    p('Raporlar yalnız okunur: "işletme nasıl gidiyor?" sorusunun yeri. Kayıt defterleri evlerine taşındı: Kasa kapanışları, Giderler, İade ve düzeltme → <b>Kasa ve giderler</b>; Personel ve bahşiş → <b>Personel → Vardiya ve bahşiş</b>. Eski <b>Para</b> grubu iki sürüm boyunca "Taşındı → Git" tabelasıdır. Araç çubuğunda yalnız sizde iki düğme daha vardır: <b>Raporları gönder</b> (e-posta raporları, eskiden Ayarlar → İşletme → Raporlar ve e-posta) ve <b>Raporları telefonda gör</b> (Ayarlar → Güvenlik ve yedek → Telefonum).'),
    sekil('s-rapor-detay', { aciklamalar: ['Gruplar: Satış, Para (taşındı tabelası), Personel, Rezervasyon.', 'Seçili grubun raporları (Özet, Ürünler, Kârlılık, Kampanyalar…).', 'Dönem çubuğu bütün raporlar için ortaktır.'] }),
    tablo(['Grup', 'Raporlar'], [
      ['Satış', 'Özet (grafik, yoğun saatler, gün notları), Ürünler, Kârlılık, Kampanyalar'],
      ['Para', '"Taşındı" tabelası: Kasa kapanışları, Giderler ve İade ve düzeltme artık Kasa ve giderler\'de (Kapanışlar, Giderler, İadeler)'],
      ['Personel', 'Çalışanlar (çalışan başına satış). Vardiya ve bahşiş: Personel → Vardiya ve bahşiş'],
      ['Rezervasyon', 'Gelme oranı, kapora, etkinlik sonuçları'],
    ]),
    h3('KDV dökümü'),
    hizmet('reports-advanced', 'Muhasebecinize her ay aynı düzende, eksiksiz bir dosya gider; KDV dökümü hazırdır.'),
    p('Detaylı Özet\'in altında satışlar KDV oranına göre ayrılır: satış (KDV dahil), matrah ve KDV. Her ürün <b>satıldığı anda geçerli olan oranla</b> sayılır; bugün bir oranı değiştirmek geçmiş günlerin dökümünü değiştirmez. Bu döküm bilgi amaçlıdır; resmi beyan yazar kasa ve mali müşaviriniz üzerinden yapılır. Müşteri menüsünde KDV görünmez (fiyatlar KDV dahildir). Sade özetin Satış kartında "Bu satışın içindeki KDV: ₺…" yazar; müşterinin telefonundaki "Masanın hesabı" ve basılan fiş de hesabın içindeki KDV\'yi gösterir. Mola\'nın fişinde yalnız bilgiler vardır; başlığı "BİLGİ FİŞİ"dir, resmi (mali) fiş yine yazar kasadan kesilir.'),
    sekil('s-kdv', { genislik: 600 }),
    sekil('s-rapor-yazdir', { genislik: 520, aciklamalar: ['Yazdır: A4 sayfa.', 'PDF indir.'] }),
    p('<b>Muhasebeci için indir</b> tek bir Excel dosyası verir: günlük satışlar, ödemeler, giderler, iadeler, kasa kapanışları, KDV dökümü ve ürün satışları. Bu ay, geçen ay, başka bir ay ya da ekrandaki dönem seçilir. Ayın ilk günlerinde geçen ay hazır seçilidir; geçen ay hiç satış yoksa (kafe bu ay açıldıysa) bu ay seçili gelir.'),
    sekil('s-muhasebeci', { genislik: 380, yan: true }),
    sekil('s-rapor-personel', { baslik: 'Personel → Vardiya ve bahşiş (Vardiyalar · Bahşiş)' }),
    hizmet('shifts', 'Kim kaç saat çalıştı, kim geç kaldı, bahşiş adil paylaşıldı mı; tartışmaya gerek kalmaz.'),

    h2('Ajanda ve rezervasyon'),
    sekil('s-ajanda', { aciklamalar: ['Rezervasyonlar: masa planı (ilk sekme).', 'Etkinlikler (maç günü, özel gece).', 'Takvim: gün notları ve hatırlatıcılar (yalnız işletme sahibi).', 'Seçili güne not ekleyin.'] }),
    hizmet('reservations', 'Masa ayırma, kapora ve kalabalık geceler düzenli olur; gelmeyen müşterinin kaporası unutulmaz.'),
    p('<b>Rezervasyonlar</b> sekmesi kafenin masalarını bir plan olarak gösterir. Üstte bir gün ve bir saat seçersiniz; her masa <b>Boş</b>, <b>Rezerve 20:00</b> (seçtiğiniz saatin 2 saat öncesi ya da sonrasında rezervasyonu var) ya da <b>Dolu</b> (bugün, masada açık hesap var) yazar. Rezervasyon yapmak için <b>boş masaya dokunun</b>: masa, gün ve saat dolu gelen kısa bir pencere açılır; misafirin adını ve kişi sayısını yazıp kaydedersiniz. Telefon, not ve kapora isteğe bağlıdır. <b>Rezerve masaya dokunursanız</b> o masanın rezervasyonları açılır: <b>Geldi</b> (saati yaklaşınca), <b>Düzenle</b>, <b>İptal et</b>. Günün bütün rezervasyonları planın altında liste olarak durur.'),
    liste(['Saatler her yerde 24 saat biçimindedir (09:00, 20:30); bilgisayarın dili ne olursa olsun "AM/PM" çıkmaz. "2030" yazmanız yeterli, araya iki nokta kendisi girer.', 'Tarihler her yerde gün.ay.yıl biçimindedir (08.10.2026). "08102026" yazmanız yeterli, noktalar kendiliğinden girer; alanın sağındaki küçük takvim düğmesiyle günü takvimden de seçebilirsiniz.', 'Aynı masaya 2 saat içinde ikinci rezervasyon yazılırsa önce uyarı çıkar; isterseniz "Yine de kaydet" dersiniz. Geçmiş bir saate yazılan rezervasyon da önce uyarı verir. Gece yarısını geçince açık kalan ekranın günü kendiliğinden ertesi güne geçer.', '"Masa ayır" düğmesi tam formu açar (masayı listeden seçersiniz). "Bana hatırlat" ile bir saat ya da bir gün önce bildirim alırsınız.', 'Rezervasyon saatinden <b>30 dakika önce</b> masa ayrılır (süre Ayarlar\'dan değişir): Masalar ekranında masada "Rezerve · Ahmet · 4 kişi · 20:00" ve "QR kapalı · 20:00 rezervasyonu" yazar. O masanın QR\'ından yeni sipariş verilemez; müşteri menüyü görür ve "Bu masa 20:00 için ayrılmıştır. Sipariş için lütfen garsonunuza sorun." yazısını okur. Garson çağır ve Hesabı iste açıktır; garson kendi telefonundan her zaman sipariş alır. Bu 30 dakikadan önce masa normal bir masadır; masa penceresinde yalnız küçük bir "Bugün 20:00 rezervasyon" notu ve erken gelen misafir için <b>Geldi</b> düğmesi durur.', 'Saat geçince "Geldi mi?" sorulur: <b>Geldi</b> (hesap misafirin adıyla açılır, kapora hesaptan düşülür, masanın QR\'ı o misafir için çalışır; hesap ödenip kapanınca rezervasyon biter ve masa normale döner), 15 dk bekle ya da <b>Gelmedi</b>. Gelmedi ya da iptal edilen rezervasyonda masa hemen normale döner. Kimse karar vermezse masa en geç sabah 05:00\'te serbest kalır.', 'Rezervasyonun 30 dakikası başladığında masada hâlâ başka bir misafir oturuyorsa (açık hesap) masada <b>"20:00 rezervasyonu · masada hâlâ misafir var"</b> yazar. O misafirin siparişleri ve Hesabı iste düğmesi telefonunda kalır; yalnız QR\'dan yeni sipariş veremez, garsona söyler. Hesap kapanınca rezervasyonlu misafiri oturtursunuz.', '<b>Etkinlik:</b> bir gece için geçici masalar açarsınız (D1, D2…). "Etkinlik oluştur" penceresi adım adımdır: <b>Etkinlik</b> (ad), <b>Ne zaman?</b> (gün, başlangıç, isteğe bağlı bitiş saati: o saatte yalnız "Etkinlik bitti mi?" diye sorulur), <b>Kaç masa?</b> (geçici masa sayısı; isteğe bağlı bir masada kaç kişi), <b>Masa adları</b> (Numaralı: D1, D2… ya da "Adları ben yazayım": her satıra bir ad; açılacak masalar hemen altında görünür) ve <b>Masalar ekranı</b> (etkinlik sürerken yalnız etkinlik masalarını göster). Etkinliğin masaları da aynı şekilde dokunarak ayrılır; masanın adını küçük kalem simgesiyle değiştirirsiniz. O günün planında etkinlik masaları ayrı bir bölüm olarak görünür. Sipariş ve ödeme normal masa gibidir; etkinlik bitince raporu çıkar.', 'Kapora kararı bekleyenler (gelmeyen, iptal edilen) planın en altındadır: "İade et" ya da "İşletmede kalsın".', 'Kim rezervasyon yazabilir ve <b>"Rezervasyondan kaç dakika önce masa ayrılsın"</b> (varsayılan 30 dk; aynı süre hem "Rezerve" yazısını hem QR\'ın kapanmasını belirler; "Kapalı" seçilirse QR açık kalır ve "Rezerve" yalnız rezervasyon saatinde görünür): <b>Ajanda ve rezervasyon → Ayarlar</b> sekmesi (yalnız siz; dişli simgeli, en sonda). "Rezervasyon raporu" bağlantısı Satış ve Raporlar → Rezervasyon\'u açar.']),
    sekil('s-rezervasyon-form', { genislik: 400, yan: true }),
    sekil('s-etkinlikler'),

    h2('Personel'),
    p('Eski adı "Çalışanlar". Üç sekme: <b>Çalışanlar</b> (hesaplar, vardiya planı, açık oturumlar), <b>Vardiya ve bahşiş</b> (alt sekmeler <b>Vardiyalar</b>: saatler, geç kalma, vardiyayı düzelt; <b>Bahşiş</b>: her çalışanın payı; eskiden Satış ve Raporlar → Personel ve bahşiş) ve <b>Personel ayarları</b> (alt sekmeler <b>Vardiya</b>: vardiya takibi ve görevler, <b>Bahşiş</b>: dağıtım kuralı, <b>Garson ataması</b>: hangi garson hangi masa ve bölümde; eskiden Ayarlar → Sipariş ve kasa).'),
    sekil('yeni-duzen-personel', { baslik: 'Personel sekmeleri. Personel ayarları alt sekmeleri.' }),
    sekil('s-calisanlar', { aciklamalar: ['Çalışan ekle: ad, kullanıcı adı, görev, şifre.', 'Şifreyi yenile: çalışan şifresini unuttuysa.'] }),
    liste(['Görev değiştirmek için çalışanın kartındaki listeyi kullanın. Ayrılan çalışanın hesabını <b>"Hesabı kapat"</b> ile kapatın; geçmişi silinmez.', '<b>Vardiya planı</b> (isteğe bağlı): başlangıç ve bitiş saati yan yana (24 saat, ör. 09:00 – 17:00) ve çalıştığı günler. "Hafta içi" ve "Her gün" kısayolları vardır. Plan varsa raporda geç başlayan "N dk geç" olarak görünür.','<b>Açık oturumlar:</b> hangi cihazda kimin girişli olduğu. Kaybolan bir telefonun oturumunu buradan kapatırsınız.']),
    sekil('s-oturumlar', { genislik: 600 }),

    ...ayarlar(),
    ...destek(),
    ...uzaktan(),
    ...yedekler(),
  ].join('');
}

function ayarlar() {
  return [
    h2('Ayarlar'),
    p('Ayarlar\'da yalnız <b>bir kez kurulan</b>, işletmenin ya da cihazların genelini ilgilendiren ayarlar durur. Beş konu vardır; üstteki her konu sekmesinin kendi simgesi vardır (1. seviye) ve her konunun altında daha sade bir bölüm satırı (2. seviye) bulunur; böylece hiçbir sayfa uzamaz. Geniş ekranda kartlar iki sütun hâlinde dizilir, telefonda alt alta. Uzun açıklamalar gri <b>ⓘ</b> balonlarındadır. Dikkat isteyen bir şey varsa sekmede küçük bir rozet çıkar (örneğin "Eksik"). Günlük işin ayarı ise o işin evindedir (Kasa ayarları, Personel ayarları, KDV oranları, Ajanda → Ayarlar).'),
    sekil('yeni-duzen-ayarlar', { baslik: 'Konular: İşletme, Masalar ve QR, Sipariş ve mutfak, Cihazlar, Güvenlik ve yedek. Konunun bölümleri: Güvenlik ve yedek için Yedek, Kilit ve güncelleme, Telefonum.' }),
    tablo(['Konu', 'Bölümler'], [
      ['İşletme', 'Görünüm · Sosyal medya · Paket ve lisans'],
      ['Masalar ve QR', 'Masalar ve QR (Masa ekle / çıkar burada da) · QR kodlarını yazdır · Engellenen telefonlar'],
      ['Sipariş ve mutfak', 'Sipariş ve onay · Mutfak (Ekran / Fiş) · Paket platformları'],
      ['Cihazlar', 'Yazıcılar · Sesler · Tablet ve telefonlar'],
      ['Güvenlik ve yedek', 'Yedek · Kilit ve güncelleme · Telefonum (rapor kodu, telefonu eşleştir, uzaktan yönetim)'],
    ]),
    not('Ayarlar\'dan taşınanlar: Kasa ve ödeme → <b>Kasa ve giderler → Kasa ayarları</b>; Otomatik giderler → <b>Kasa ve giderler → Giderler → Otomatik giderler</b>; KDV oranları → <b>Menü yönetimi → KDV oranları</b>; Düşük kâr uyarısı → <b>Satış ve Raporlar → Kârlılık → Uyarı sınırları</b>; Vardiya ve bahşiş, garson ataması → <b>Personel → Personel ayarları</b>; Rezervasyon → <b>Ajanda ve rezervasyon → Ayarlar</b>; Raporlar ve e-posta → <b>Satış ve Raporlar → Raporları gönder</b>. Ayarlar sayfasının altındaki "Taşınan ayarlar" listesi her birine götürür.', 'bilgi'),
    h3('İşletme → Görünüm, Sosyal medya, Paket ve lisans'),
    p('<b>Görünüm:</b> işletmenin adı, logosu, renk paleti ve müşteri menüsünün karşılama yazısı. <b>Paket ve lisans:</b> paketinizin adı, durumu ("Aktif" ya da "Deneme · N gün kaldı"), içindeki hizmetler ve eklenebilecekler; altında lisansın kalan günü, <b>Hizmeti dondurma</b> talebi (yıllık abonelikte; başlangıç tarihi, süre en fazla 60 gün, gerekçe; Mola ekibi onaylar) ve <b>Sözleşmeyi oku</b>. Eskiden lisans Destek → Talepler\'in altındaydı.'),
    sekil('s-paketiniz', { genislik: 560, aciklamalar: ['Paketin adı.', 'Durumu.'] }),
    sekil('s-paket-kafe-standart', { genislik: 520, aciklamalar: ['Paketinizdeki hizmetler (yeşil tik).', 'Pakette olmayanlar soluk; "Pakete ekle"ye dokununca açıklama ve Mola ekibinin iletişim düğmeleri çıkar.'] }),
    hizmet('social', 'Müşteri menüsünün altında takip simgeleri, ödeme sonrası takip düğmeleri ve masalara koyacağınız kalıcı QR kartları.'),
    sekil('s-sosyal', { aciklamalar: ['Hesabınızı yazın: kullanıcı adı ya da bağlantı.', '"QR oluştur": bu hesabın kalıcı QR kartı (PDF indir ya da yazdır).'] }),
    p('Google değerlendirme bağlantısı her pakette vardır. Kalıcı QR kartları Mola\'nın kısa adresini taşır; bağlantınızı sonradan değiştirseniz de basılı QR yenisini açar. İşletme askıya alınırsa QR\'lar da durur ve misafir "Bu işletmenin bu hizmeti şu anda kullanılamıyor" sayfasını görür.'),
    h3('Raporları gönder (e-posta raporları)'),
    hizmet('email-reports', 'Gün sonu, haftalık, aylık ve yıllık rapor kendiliğinden e-postanıza gelir; kafeye gitmeden günü öğrenirsiniz.'),
    sekil('s-eposta'),
    p('Satış ve Raporlar\'daki <b>Raporları gönder</b> düğmesi açar (eskiden Ayarlar → İşletme → Raporlar ve e-posta). Raporlar <b>kendi e-posta hesabınızdan</b> gönderilir (Gmail için "uygulama şifresi"). En fazla 5 alıcı yazabilirsiniz (örneğin siz ve muhasebeciniz). "Deneme e-postası gönder" ile denersiniz. E-postada düz bir özet cümlesi ve yazdırılabilir PDF eki bulunur; müşteri adı ya da telefonu yoktur. 05:00\'ten sonra gelen günlük raporda, gün kapanırken ödenmemiş hesaplar <b>"Gün kapanırken açık kalan hesaplar"</b> satırında yazar.'),
    h3('Masalar ve QR'),
    p('<b>Masalar ve bölümler</b> kartında her bölüm (İç, Dış, Üst kat…) masalarıyla birlikte durur. Bir masanın bölümünü yanındaki seçimden değiştirin; listede olmayan bölüm için <b>"Yeni bölüm…"</b> seçip adını yazın (bölümsüz bir masa da böyle bir bölüme alınır). Oklarla (↑ ↓) masaların bölüm içindeki ve bölümlerin sırasını değiştirin; Masalar ekranı bu sırayla gösterir. Kalemle bir bölümün adını değiştirirsiniz ("Bahçe" → "Teras"); bütün masaları ve garson atamaları yeni adla sürer. Her değişiklik hemen kaydedilir.'),
    p('Üç bölüm vardır. <b>Masalar ve QR:</b> <b>Masa ekle</b> ve <b>Masa çıkar</b> (Masalar\'daki düğmelerle aynı), bölümler ve sıra, masa temizliği takibi, QR kodlarının hangi adresi taşıdığı (internet ya da yalnız kafenin Wi-Fi\'si) ve sızan tek bir masanın QR kodunu yenileme. "Hangi garson hangi bölümde?" Personel ayarları\'nı açar. <b>QR kodlarını yazdır:</b> A4\'e 6\'lı ya da 12\'li, A6 masa standı ve PDF. <b>Engellenen telefonlar:</b> masa penceresinden "Bu tarayıcıyı engelle" ile engellediğiniz telefonlar.'),
    sekil('s-masalar-qr', { baslik: 'Masalar ve QR: masa ekle / çıkar, bölümler, temizlik takibi, QR adresi ve tek masanın kodunu yenileme' }),
    sekil('s-qr-kodlari', { aciklamalar: ['Yeni kodların taşıyacağı adres: "İnternet adresi: her ağdan açılır" ya da Wi-Fi adresi.', 'Baskı türü: A4\'e 6 QR, 12 QR ya da A6 masa standı.', 'Yazdır.'] }),
    p('<b>A6 masa standı</b> (10,5 × 14,8 cm) her masa için bir kart hazırlar: logonuz, işletmenizin adı, QR kod ve çok büyük harflerle masa adı. A4\'e 4\'lü (kesim çizgili) ya da A6 kâğıda tek basılır; "PDF indir" ile matbaaya gönderebilirsiniz. "Hangi masalar?" ile yalnız seçtiğiniz masaları basarsınız.'),
    sekil('k-qr-a6-sayfa', { genislik: 330, yan: true, baslik: 'A6 masa standı kartları, A4\'e 4\'lü (kesim çizgili). Her kartta logo, işletme adı, QR kod ve çok büyük masa adı.' }),
    not('Masa QR\'ları <b>menu.molayazilim.com.tr</b> adresini taşır; misafir mobil veriyle de açar. Yeni kurulan kafede bu adresin gelmesi 10-20 dakika sürebilir; o arada kart "QR kodları internet adresi hazır olunca yeniden basılmalı" der ve QR\'lar yalnız kafenin Wi-Fi\'sinde açılır. "Bağlı" yazınca yeniden basın. Wi-Fi adresli eski QR\'lar için Masalar\'da "Masa QR kodları internet adresiyle yeniden basılmalı" uyarısı çıkar.', 'dikkat'),
    h3('Sipariş ve mutfak'),
    p('Üç bölüm vardır. <b>Sipariş ve onay:</b> ödeme ne zaman alınır (servisten sonra ya da önce), müşterinin siparişini değiştirebileceği süre, QR siparişine garson onayı ve otomatik onay, <b>Garson hatırlatması</b> (uzun süredir sipariş vermeyen masa; ilk hâli 45 dk, 10-240 dk ya da kapalı). <b>Mutfak:</b> mutfağın Ekran ya da Fiş ile çalışması. <b>Paket platformları:</b> Yemeksepeti, Getir, Trendyol (yakında). Kasa ve ödeme ile vardiya ve bahşiş artık kendi evlerinde: Sipariş ve onay sayfasının altındaki "Taşındı → Git" satırları oraya götürür.'),
    hizmet('integrations', 'Platform siparişleri doğrudan mutfağa düşecek; ayrı tablet ve elle yazma derdi bitecek.'),
    sekil('s-siparis-onay', { baslik: 'Sipariş ve mutfak → Sipariş ve onay' }),
    h3('Cihazlar'),
    p('<b>Yazıcılar:</b> fiş yazıcısını ağ adresiyle ekler, hangi fişlerin (mutfak, hesap ve kasa) hangi yazıcıdan çıkacağını seçersiniz. <b>Sesler:</b> garson çağrısı, hesap isteme, QR onayı, yeni sipariş, sipariş hazır ve iptal için 20 ayrı ses arasından seçim. <b>Tablet ve telefonlar:</b> bağlantı kontrolü, tablet ve telefon bağlama (Android personel uygulaması; APK molayazilim.com.tr/indir/ sayfasında ve şeritteki Tabletler penceresinin QR kodunda), fotoğraf alanı. Bilgisayarın ağı Windows\'ta "Genel" olarak ayarlıysa telefonlar bağlanamaz; Mola bunu burada ve Tabletler penceresinde sarı bir uyarıyla söyler. Windows Ayarları → Ağ ve İnternet → bağlantınız → Ağ profili türü: <b>Özel ağ</b>.'),
    sekil('s-yazicilar'),
    sekil('s-cihazlar', { baslik: 'Cihazlar → Tablet ve telefonlar' }),
    h3('Güvenlik ve yedek'),
    liste(['<b>Yedek:</b> son yedeğin zamanı; "Yedekle ve ikinci yer", "Kurtarma kodu" (kasa bilgisayarındaki Mola penceresinde açılır). "Açık oturumlar" bağlantısı Personel → Çalışanlar\'a gider.', '<b>Kilit ve güncelleme:</b> sahip hesabı otomatik kilit (5, 10 ya da 30 dakika) ve güncellemeler. Ekran kilitlenince siparişler gelmeye ve sesler çalmaya devam eder. Hemen kilitlemek için sol alttaki kilit düğmesi ya da Hesabım → Kilitle.', '<b>Telefonum:</b> sahibin telefonuyla ilgili üç adım sırayla: <b>Raporlar için telefon kodu</b>, <b>Telefonu eşleştir</b> (Raporlarım telefonda; eskiden Destek → Uzaktan erişim) ve <b>Uzaktan yönetim</b>.']),
    sekil('s-guvenlik', { aciklamalar: ['Sahip hesabı otomatik kilit: 5, 10 ya da 30 dakika kullanılmazsa ekran kilitlenir.'] }),
    sekil('s-kilit', { genislik: 330, yan: true, aciklamalar: ['Şifrenizi yazın.', '"Kilidi aç". Kilit yalnız sahip hesabındadır; çalışanların ekranları kilitlenmez.'] }),
  ];
}

function destek() {
  return [
    h2('Bildirimler (zil)'),
    p('Sağ üstteki <b>zil</b> işletmenizin kendi haberlerini toplar: kasa kapanış farkı, kasiyerin iade isteği, azalan stok, otomatik ve büyük giderler, biten kampanyalar ("Kampanya bitti", Raporu aç), gün/hafta/ay/yıl raporları, ajanda hatırlatmaları, lisans ve yedek uyarıları. Okunmamış bildirim varsa zil yumuşak bir mercan rengine döner, çalan zil simgesi ve sayısı görünür ("3"; dokuzdan fazlaysa "9+"); hepsini okuyunca sade haline döner. Masalar\'daki "Yeni bir bildiriminiz var" kutusu da zili açar. Her bildirimin yanında onu çözen yere giden bir düğme vardır: <b>İadeyi yap</b> (Kasa ve giderler → İadeler), <b>Kapanışları aç</b>, <b>Giderleri aç</b>, <b>Stoğa git</b>, <b>Ajandada göster</b>.'),
    p('<b>Mola açıkken yeni bir bildirim gelirse</b> zilin hemen altında küçük bir kutu çıkar: başlığı, tek satır açıklaması ve <b>Aç</b> düğmesi (bildirimin yerini açar ve okundu sayar). Kutular birkaç saniye sonra kendiliğinden kaybolur; önemli olanlar (iade isteği, kasa farkı ya da açığı, lisans ve yedek sorunları) siz kapatana kadar kalır. Aynı anda en çok iki kutu görünür. Mola\'yı açtığınızda zaten var olan bildirimler kutu olarak çıkmaz, yalnız zilin sayısında görünür. Müdür yalnız kampanya bildirimlerini görür.'),
    p('İsterseniz yeni bildirimde kısa bir ses de çalar: <b>Ayarlar → Cihazlar → Sesler → Bildirim sesi</b> (başlangıçta kapalıdır).'),
    sekil('s-bildirimler', { baslik: 'Bildirimler: sağ üstteki zil' }),
    h2('Destek: Talepler, Duyurular, Uzaktan erişim'),
    p('Destek yalnız Mola ekibiyle konuşmanın yeridir. Bildirimler zile, lisans Ayarlar → İşletme → Paket ve lisans\'a, telefon eşleştirme Ayarlar → Güvenlik ve yedek → Telefonum\'a taşındı; Destek\'teki küçük satırlar oraya götürür.'),
    sekil('s-destek', { aciklamalar: ['Talepler: Mola ekibiyle yazışma.', 'Duyurular: Mola ekibinin bütün kafelere duyuruları.', 'Uzaktan erişim: Mola ekibine uzaktan destek izni ve kim ne zaman bağlandı.'] }),
    liste(['<b>Talepler:</b> solda yazışmalarınızın listesi. Yeni bir sorun için <b>"Yeni talep"</b>e basın: konuyu ve sorunu yazın, isterseniz fotoğraf ya da PDF ekleyin, "Destek talebi aç" deyin; gönderince yeni talebiniz açılır. Telefonda form tam ekran açılır, sol üstteki okla listeye dönersiniz. Mola ekibinin yanıtı aynı yazışmaya düşer. İnternet yokken yazdığınız talep kaybolmaz, bağlantı gelince gider. Altta Mola ekibinin iletişim bilgileri ve "Paket ve lisans" bağlantısı.', '<b>Duyurular:</b> Mola ekibinin duyuruları; okunmamış duyuru varsa Destek düğmesinde kırmızı nokta yanar. "Önemli" duyuru girişte ortada bir pencereyle gelir: "Okudum", "Daha sonra" ya da "Duyurulara git". "Bu konuda Mola ekibine yaz" hazır bir talep açar.']),
    sekil('s-talepler', { baslik: 'Talepler: Mola ekibiyle yazışmalarınız' }),
    sekil('s-yeni-talep', { aciklamalar: ['"Yeni talep": formu açar.', 'Konu ve sorun; isterseniz fotoğraf ya da PDF.', '"Destek talebi aç". Vazgeçmek için "Vazgeç".'] }),
    sekil('s-onemli-duyuru', { genislik: 420, yan: true, aciklamalar: ['"Okudum": Mola ekibi okuduğunuzu görür.', '"Daha sonra": bir sonraki girişte yeniden gelir.'] }),
    sekil('s-duyurular', { baslik: 'Duyurular: Mola ekibinin duyuruları, Önemli olanlar işaretli' }),
    h3('Uzaktan erişim'),
    sekil('s-uzaktan-erisim', { baslik: 'Uzaktan destek izni' }),
    p('<b>Mola ekibi bağlanabilsin</b> açıkken Mola ekibi, sizi arayıp sorununuzu çözmek için kafenizin ekranlarını internetten açabilir. Siz kapatana kadar açık kalır; kapatınca bağlantı hemen biter. Mola ekibi satış raporlarını, ödemeleri, kasa kapanışlarını, çalışan şifrelerini ve misafir telefonlarını göremez. Kimin ne zaman bağlandığı aynı sayfada yazar.'),
  ];
}

function uzaktan() {
  return [
    h2('Raporlarım telefonda'),
    hizmet('remote-reports', 'Kafede olmasanız da bugünün satışını, kasayı ve son 30 günü telefonunuzdan görürsünüz.'),
    adimlar(['Kafedeki bilgisayarda Ayarlar → Güvenlik ve yedek → Telefonum → <b>Telefonu eşleştir</b>\'e basın (Satış ve Raporlar\'daki "Raporları telefonda gör" de buraya açılır).', 'Cihaza bir ad verin ("Serkan\'ın telefonu") ve şifrenizi yeniden yazın.', 'Ekrana gelen QR kodu telefonunuzla okutun ve "Eşleştir"e basın. Eşleştirme yalnız kafedeki ekrandan ve şifreyle yapılır.', 'Raporlarım sayfasını telefonunuzun ana ekranına ekleyin.']),
    sekil('s-telefon-eslestir', { genislik: 560, aciklamalar: ['Telefonla okutulacak eşleştirme QR kodu (10 dakika geçerli).'] }),
    serit([{ ad: 't-raporlarim', baslik: 'Raporlarım: bugün', aciklamalar: ['Bugünün satışı: nakit, kart, sipariş sayısı.'] }, { ad: 't-raporlarim-2', baslik: 'Aşağı kaydırınca', metin: 'En çok kazandıranlar, kasa durumu ve son 30 gün.' }], { genislik: 230 }),
    not('Raporlar telefonunuz için şifrelenir; Mola\'nın sunucusu onları okuyamaz, yalnız iletir. En fazla 3 cihaz eşleşir. Kaybolan telefonu aynı sayfadan "kaldır"ın.', 'bilgi'),
    h2('Uzaktan yönetim'),
    hizmet('remote-admin', 'Kafeye gitmeden fiyat değiştirir, kampanya açar, çalışan hesabı kapatırsınız; kafedeki ekranların aynısı telefonunuzda.'),
    adimlar(['Önce Ayarlar → Güvenlik ve yedek → Telefonum → <b>Raporlar için telefon kodu</b>\'nu kurun.', 'Aynı sayfada telefonunuzu eşleştirin (Raporlarım).', 'Aynı sayfanın <b>Uzaktan yönetim</b> kartında "Aç"a basın, şifrenizi ve telefonunuzdaki doğrulama uygulamasının (Authenticator) 6 haneli kodunu yazın. Açmak yalnız kafedeki bilgisayardan olur.', 'Telefonunuzda Raporlarım → <b>Kafeyi yönet</b>: şifre ve telefon kodu ile girin. Üstte "Uzaktan · uçtan uca şifreli" yazar.']),
    sekil('s-uzaktan-yonetim', { genislik: 560 }),
    p('Her uzaktan giriş size bildirilir (zil) ve kafede kayıt olur. Uzaktan yönetimi her yerden kapatabilirsiniz. Uzaktan oturum da 05:00\'te biter ve otomatik kilide uyar.'),
    h2('İki ekran'),
    hizmet('split-screen', 'Kasa bilgisayarında ekranı ikiye bölersiniz: solda kasa, sağda mutfak ya da ikinci bir kasiyer. Ayrı bir mutfak ekranı almanız gerekmez.'),
    p('Kasa bilgisayarındaki Mola penceresinde soldaki şeritten <b>İkiye böl</b>\'e basın. Her yarıya ayrı bir hesapla girilir. Ortadaki ayraçla genişliği değiştirirsiniz; "Tek ekran" ile geri dönersiniz.'),
    sekil('d-iki-ekran'),
  ];
}

function yedekler() {
  return [
    h2('Kasa bilgisayarı: şerit, yedekler ve kurtarma kodu'),
    p('Kasa bilgisayarındaki Mola penceresinin solunda koyu yeşil bir şerit vardır: <b>İkiye böl, Yedekle, Tabletler, Güvenlik, Kapat</b>. Bu şerit yalnız kasa bilgisayarında görünür; tablet ve telefonlarda yoktur.'),
    sekil('d-serit', { aciklamalar: ['Kasa bilgisayarının şeridi.'] }),
    h3('Kurtarma kodu'),
    p('İlk açılışta Mola bir <b>kurtarma kodu</b> gösterir. Bilgisayar bozulursa, çalınırsa ya da Windows şifresi sıfırlanırsa verileriniz yalnız bu kodla açılır. Kodu kâğıda yazın ya da yazdırın, güvenli bir yerde saklayın. Fotoğrafını çekmeyin, kâğıdı bilgisayarın yanında tutmayın.'),
    sekil('d-kurtarma-kodu', { genislik: 400, yan: true, aciklamalar: ['Kurtarma kodu (bir daha gösterilmez).', 'Yazdır.', '"Kaydettim".'] }),
    h3('Yedekler'),
    sekil('d-yedekle', { genislik: 440, yan: true, aciklamalar: [] }),
    liste(['Mola her gece <b>03:30</b>\'da şifreli bir yedek alır ve yedeği açıp deneyerek doğrular. Bilgisayar gece kapalıysa açıldıktan 2 dakika sonra alır.', '<b>Değişiklik yoksa gece yedeği alınmaz</b> ("Gece yedeği gerekmedi: … yedeğinden beri değişiklik yok"). Haftada en az bir yedek her durumda alınır.', 'Gün sonu kapanışından bir dakika sonra da bir yedek alınır. "Şimdi yedekle" her zaman çalışır.', '<b>Saklama:</b> son 7 günün, son 4 haftanın ve son 12 ayın birer yedeği. Ayrıca her yılın <b>yıl paketi</b> süresiz saklanır.', '<b>İkinci yedek yeri:</b> bir USB bellek ya da başka bir disk seçin; her yedeğin kopyası oraya da gider.']),
    hizmet('cloud-backup', 'Yedeklerin şifreli bir kopyası Mola\'nın sunucusunda da durur. Bilgisayar yanar ya da çalınırsa yeni bilgisayara kolayca taşınırsınız. Mola bu kopyayı açamaz.'),
    not('Yedeği ve kurtarma kodunu asla aynı USB belleğe ya da aynı e-postaya koymayın.', 'dikkat'),
    h3('Yıl paketleri'),
    p('Her takvim yılı, bir sonraki yılın <b>1 Şubat</b>\'ında kendi dosyasına paketlenir ve kapanır. Ocak ayı geçen yılın Aralık düzeltmeleri için açık kalır. Paketleme sizin bir şey yapmanızı istemez; bittiğinde "2025 yılı kapandı ve paketlendi" bildirimi gelir.'),
    liste(['Kapanmış bir yıla geriye dönük kayıt yapılamaz: o yıla tarihli gider, kasa düzeltmesi, vardiya ya da stok kaydı reddedilir. "Kaydı bugünün tarihiyle girin" denir.', 'Eski bir hesaba <b>iade yapılabilir</b>; iade bugünün kaydı olarak yazılır.', 'Paketlenirken müşterilerin kişisel bilgileri (rezervasyon adı, telefon, not; paket servis adresi) silinir. Satış rakamları olduğu gibi korunur.', 'Raporlarda eski yıllar "Yıl ▾" ve "Tümü" ile açılır; hızları değişmez.']),
    sekil('k-kapali-yil', { genislik: 600, baslik: 'Kapanmış yıla tarihli kayıt denenince çıkan uyarı' }),
    h3('Gün sonu ve 05:00'),
    p('İş günü sabah <b>05:00</b>\'te döner. Kasa günü, raporlar ve "Bugün" aynı günü okur. Bütün çalışan oturumları 05:00\'te biter; çalışanlar ertesi gün yeniden giriş yapar.'),
  ];
}

function ilkGun() {
  return [
    bolum('İlk gün kurulumu', 'Mola kurulduğunda yapmanız gerekenler sırasıyla. Hepsi bir saatten kısa sürer.'),
    adimlar([
      '<b>Etkinleştirme:</b> Kasa bilgisayarında Mola ilk açıldığında "Mola\'yı etkinleştir" ekranı gelir. Kodunuz yoksa <b>"Kodum yok, başvuru yapacağım"</b>ı seçip hesap açma başvurusunu doldurun (kod gerekmez; Mola ekibi onaylayınca 30 günlük deneme başlar); Mola ekibi size kod verdiyse <b>"Etkinleştirme kodum var"</b>. Mola\'yı kendiniz kuracaksanız Windows kurulum dosyası <b>molayazilim.com.tr/indir/</b> adresindedir. Mola Lisans Sözleşmesi\'ni okuyup işaretleyin.',
      '<b>Sahip hesabı:</b> kendi kullanıcı adınızı ve şifrenizi belirleyin.',
      '<b>Kurulum sihirbazı:</b> işletme türü (kafe, restoran, tatlıcı), adı, masa sayısı ve temel kurallar.',
      '<b>Kurtarma kodu:</b> ekrana gelen kodu kâğıda yazın, güvenli yerde saklayın.',
      '<b>Menü:</b> Menü yönetimi\'nde başlangıç menüsünü kendi ürünlerinizle ve fiyatlarınızla düzeltin. "Menüyü önizle" ile müşterinin gözüyle bakın.',
      '<b>Görünüm:</b> Ayarlar → İşletme → Görünüm: logo, renk, menü karşılama yazısı. Google değerlendirme bağlantınızı Sosyal medya\'ya yazın.',
      '<b>Personel → Çalışanlar:</b> her çalışana kendi hesabını açın. Ortak şifre kullanmayın.',
      '<b>Yazıcı:</b> Ayarlar → Cihazlar → Yazıcılar. Mutfak Ekran mı, Fiş mi? (Ayarlar → Sipariş ve mutfak → Mutfak)',
      '<b>Tablet ve telefonlar:</b> Ayarlar → Cihazlar → Tablet ve telefonlar. Android telefonlara Mola personel uygulamasını kurun: APK dosyası molayazilim.com.tr/indir/ sayfasında ve kasa bilgisayarındaki <b>Tabletler</b> penceresinin QR kodundadır.',
      '<b>İkinci yedek yeri:</b> kasa bilgisayarının şeridinden Yedekle → bir USB bellek seçin.',
      '<b>QR kodları:</b> Ayarlar → Masalar ve QR\'da "QR kodları internet adresini taşır · Bağlı" yazınca QR kodlarını yazdır sekmesinden basın. Yeni kurulan kafede internet adresinin gelmesi 10-20 dakika sürebilir; o arada basılan QR\'lar Wi-Fi adresini taşır, "Bağlı" yazınca yeniden basın.',
      '<b>Deneme:</b> bir masaya kendi telefonunuzla sipariş verin, mutfakta hazırlayın, kasada kapatın. Masalar\'daki "İlk adımlar" kartı yaptıklarınızı işaretler.',
    ]),
  ].join('');
}

function qrKoruma() {
  return [
    bolum('QR kodları: basma ve koruma', 'Masadaki QR kod müşterinin kafenize açılan kapısıdır. Okunmayan bir QR sipariş kaybettirir.'),
    h2('Basmadan önce'),
    liste(['Ayarlar → Masalar ve QR\'da <b>"QR kodları internet adresini taşır · Bağlı"</b> yazdığını görün. Böyle basılan QR her ağdan, misafirin mobil verisinden de açılır.', 'Önce bir masanın kartını basın ve <b>iki farklı telefonla</b> deneyin: biri kafenin Wi-Fi\'sinde, diğeri Wi-Fi kapalı, yalnız mobil veride. İkisinde de menü açılmalı.', 'Masa adlarını kontrol edin. Kartta büyük harflerle yazan ad, misafirin kasada söyleyeceği addır.']),
    h2('Koruma önerileri'),
    tablo(['Öneri', 'Neden'], [
      ['<b>Mat kâğıt</b> ya da mat laminasyon', 'Parlak yüzey ışığı yansıtır, kamera okuyamaz.'],
      ['<b>Akrilik A6 masa standı</b> (10,5 × 14,8 cm)', 'Kart dik durur, ıslanmaz, devrilmez. Mola\'nın A6 kartı bu standa göre hazırlanır.'],
      ['<b>Laminasyon</b>', 'Kahve, çay ve su lekesine karşı. Silinerek temizlenir.'],
      ['<b>Yedek set</b>', 'Bütün masaların bir takımını fazladan basıp kasada saklayın. Kırılan ya da kaybolan kartı hemen değiştirirsiniz.'],
      ['<b>QR\'ı kesmeyin, katlamayın</b>', 'Kenar boşluğu (sessiz alan) okumak için gereklidir.'],
    ]),
    p('Bir QR kaybolur ya da çalınırsa masa penceresinden "QR yenile" deyin ve yeni kartı basın. Eski kart artık açılmaz.'),
    not('İşletme askıya alınır ya da lisans biterse masa QR\'ları menüyü açmaz; misafir "Bu işletmenin dijital menüsü şu anda kullanılamıyor" sayfasını görür. QR kartlarınızı atmayın: hizmet açılınca aynı kartlar yeniden çalışır.', 'bilgi'),
  ].join('');
}

function internet() {
  return [
    bolum('İnternet kesilirse', 'Kafenin interneti gitse de Mola çalışmaya devam eder. Neyin çalıştığını ve neyin beklediğini bilin.'),
    tablo(['Ne', 'İnternet yokken'], [
      ['Garson, kasa, mutfak, tabletler', '<b>Çalışır.</b> Hepsi kafenin kendi ağı (modem/Wi-Fi) üzerinden kasa bilgisayarına bağlıdır.'],
      ['Sipariş, ödeme, mutfak, fiş yazıcısı', '<b>Çalışır.</b>'],
      ['Müşterinin QR menüsü', '<b>Görünür, sipariş verilemez.</b> Menünün bir kopyası Mola\'nın sunucusunda durur; misafir menüye bakar ama üstte "Şu an sipariş alınamıyor, lütfen garsonunuza sorun." yazar. Bu sırada siparişi garson alır. İnternet dönünce menü kendiliğinden siparişe açılır; misafirin sepetine eklediği ürünler kaybolmaz.'],
      ['Raporlarım, uzaktan yönetim, e-posta raporları, destek talepleri, bulut yedek', '<b>Bekler.</b> İnternet gelince kaldığı yerden devam eder. Yazdığınız talep kaybolmaz.'],
      ['Lisans', 'Mola 14 güne kadar internetsiz çalışır. Uzun kesintide Mola ekibine haber verin.'],
    ]),
    sekil('m-kopyadan', { genislik: 300, yan: true, aciklamalar: ['Kafenin interneti yokken misafir: "Şu an sipariş alınamıyor, lütfen garsonunuza sorun."', 'Menü, fiyatlar ve fotoğraflar yine görünür.'] }),
    p('Personel çalışmaya devam eder: garson telefonları, mutfak tableti ve kasa kafenin kendi Wi-Fi\'si üzerinden kasa bilgisayarına bağlıdır; internet gerekmez. Yalnız müşterinin telefondan sipariş vermesi kafenin internetini ister.'),
    not('<b>Yedek internet:</b> internet uzun süre gelmeyecekse kasa bilgisayarını bir telefonun erişim noktasına (hotspot) bağlayın. Birkaç saniye içinde QR siparişleri yeniden açılır; günlük kullanım çok az veri harcar. Garson ve mutfak cihazları kafenin Wi-Fi\'sinde kalabilir.', 'ipucu'),
    not('Kasa bilgisayarı kapalıysa hiçbir personel ekranı çalışmaz; çünkü veriler o bilgisayardadır. Müşteri menüyü yine görür, sipariş veremez. Elektrik kesintisinde bilgisayar açılınca Mola kaldığı yerden devam eder.', 'dikkat'),
  ].join('');
}

function sssBolum() {
  return [
    bolum('Sık sorulan sorular'),
    sss('Verilerim nerede duruyor?', 'Satışlarınız, menünüz ve çalışan bilgileriniz kafenizdeki bilgisayarda, şifreli olarak durur. Mola\'nın sunucusu satış verinizi görmez.'),
    sss('Müşteri QR\'ı okutmak için Wi-Fi\'ye bağlanmalı mı?', 'Hayır. QR kendi mobil verisiyle de açılır.'),
    sss('Kafe kapalıyken müşteri QR\'ı okutursa ne olur?', 'Menüyü görür, sipariş veremez. Gün sonundan sonra QR siparişleri kendiliğinden durur; kafede açık bir personel ekranı yoksa da sipariş alınmaz. Menü her zaman görünür.'),
    sss('Neden ayrı bir kapanış saati ayarı yok?', 'Gerek yok: gün sonunu yapınca QR siparişleri durur, sabah kasayı açınca ya da 05:00\'te kendiliğinden açılır. Gün içinde kısa bir ara için "QR siparişlerini durdur"u kullanın.'),
    sss('Bir çalışan ayrıldı. Ne yapmalıyım?', 'Personel → Çalışanlar\'da hesabını "Hesabı kapat" ile kapatın. Geçmiş satışları ve vardiyaları silinmez.'),
    sss('Şifremi unuttum.', 'Çalışanların şifresini işletme sahibi Personel → Çalışanlar → "Şifreyi yenile" ile verir. İşletme sahibi şifresini unuttuysa kasa bilgisayarındaki şeritten Güvenlik → "İşletme sahibi şifresini unuttum": kurtarma kodu ya da Mola ekibinden alınan tek kullanımlık kodla yeni şifre belirlenir.'),
    sss('Ekran kendiliğinden kilitlendi.', 'Sahip hesabının otomatik kilidi. Şifrenizi yazıp "Kilidi aç" deyin. Süreyi Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme\'den değiştirebilirsiniz.'),
    sss('Neden sabah herkes yeniden giriş yapıyor?', 'Oturumlar iş gününün bittiği 05:00\'te kapanır. Bu, başkasının dün açık kalan bir hesabı kullanmasını önler.'),
    sss('Fiyatı değiştirdim, menüyü yeniden basmam gerekir mi?', 'Hayır. Değişiklik müşteri menüsüne hemen gider. Yalnız QR kodları basılıdır ve değişmez.'),
    sss('Yanlış ödeme türü seçtim (kart yerine nakit).', 'Kasa ve giderler → İadeler\'den ödemeyi düzeltin (kapanmış masanın penceresindeki "Ödemeyi düzelt" de oraya açılır). Kapanmış bir yılın ödemesi düzeltilemez.'),
    sss('Bir hizmet soluk görünüyor.', 'Paketinizde yok. Dokunun ve "Mola ekibine yaz" deyin.'),
    sss('Yeni sürüm geldi mi nasıl anlarım?', 'Masalar\'ın üstünde "Yeni sürüm hazır · kapanışta ya da yarın açılışta kurulacak" yazar. Güncelleme kendiliğinden ve yedek alınarak kurulur; sorun olursa eski sürüme kendisi döner. Açık masa varken kurulmaz.'),
    sss('Muhasebecim hangi dosyayı istiyor?', 'Satış ve Raporlar → "Muhasebeci için indir". Ay başında "Geçen ay" hazır seçilidir (geçen ay satış yoksa "Bu ay").'),
  ].join('');
}

function sorunGiderme() {
  return [
    bolum('Sorun giderme'),
    tablo(['Ne oluyor', 'Ne yapın'], [
      ['Tablet "bağlantı yok" diyor', 'Tablet kafenin Wi-Fi\'sinde mi? Kasa bilgisayarı açık mı? Modemi yeniden başlattıysanız bilgisayarın adresi değişmiş olabilir; modemde kasa bilgisayarına sabit IP verin.'],
      ['QR menü açılmıyor', 'Ayarlar → Masalar ve QR\'da "Bağlı" yazıyor mu? Kasa bilgisayarı açık ve internete bağlı mı? QR eski (Wi-Fi adresli) olabilir: yeniden basın. Yeni kurulan kafede internet adresi 10-20 dakikada gelir.'],
      ['Müşteri "Şu an sipariş almıyoruz" görüyor', 'Kasa bilgisayarında sol menünün üstündeki "QR siparişleri" kartına (telefonda üst çubuğun altındaki satıra) bakın: "Gün sonu yapıldı" ya da "Elle durduruldu" ise "Siparişleri aç"a basın; "personel ekranı bağlı değil" ise mutfak, garson ya da kasa ekranından birini açıp giriş yapın.'],
      ['Müşteri "Bu masa 20:00 için ayrılmıştır" görüyor', 'Masanın 30 dakika içinde rezervasyonu var; Masalar\'da masada "QR kapalı · 20:00 rezervasyonu" yazar. Siparişi garson kendi telefonundan alır. Rezervasyonlu misafir geldiyse masada "Geldi"ye basın (QR onun için açılır); gelmediyse "Gelmedi" ya da rezervasyonu iptal edin, masa hemen normale döner.'],
      ['Müşteri "Şu an sipariş alınamıyor" görüyor', 'Kafenin interneti ya da kasa bilgisayarı kapalı. İnterneti ve bilgisayarı kontrol edin; gerekirse telefonun erişim noktasını kullanın.'],
      ['Fiş çıkmıyor', 'Kâğıt ve kabloyu kontrol edin. Uyarıdaki "Tekrar bas"a basın. Yazıcının ayar fişindeki IP adresini Ayarlar → Yazıcılar\'daki adresle karşılaştırın; port genelde 9100\'dür.'],
      ['Ses gelmiyor', 'Ekranın üstündeki "Ses kapalı · açmak için dokunun"a dokunun. Tabletin sesini açın.'],
      ['Mutfak tableti kararıyor', 'Mutfak ekranında "Ekranı açık tut"u açın; tabletin şarjda olduğundan emin olun.'],
      ['"Bu yıl kapandı" uyarısı', 'Kapanmış yıla kayıt yapılamaz. Kaydı bugünün tarihiyle girin.'],
      ['Yedek hatası bildirimi', 'İkinci yedek yeri (USB) takılı mı? Disk dolu mu? Çözülmezse Destek\'ten yazın.'],
    ]),
    p('Çözemediğiniz bir sorunda Destek → Talepler\'den yazın; mümkünse ekranın fotoğrafını ekleyin. Gerekirse Uzaktan erişim\'den "Mola ekibi bağlanabilsin"i açın.'),
  ].join('');
}

function iletisim() {
  return [
    bolum('İletişim'),
    p('Mola, <b>Merkut Studios</b> tarafından geliştirilir.'),
    liste(['<b>Programın içinden:</b> Destek → Talepler. En hızlı yol budur; yazışma kaydı saklanır.', '<b>Telefon, WhatsApp ve e-posta:</b> Ayarlar → İşletme → Paket ve lisans sekmesindeki "Mola ekibine ulaşın" bölümünde yazar.', '<b>Web sitesi:</b> molayazilim.com.tr']),
    not('Mola ekibi sizden asla şifrenizi ya da kurtarma kodunuzu istemez.', 'dikkat'),
  ].join('');
}

export function kullanimKilavuzu(): Belge {
  return {
    dosya: 'Mola-Kullanim-Kilavuzu.pdf', baslik: 'Kullanım Kılavuzu', altBaslik: 'Kafeler ve restoranlar için adım adım', kisa: 'Mola Kullanım Kılavuzu', tocDerinlik: 2,
    kapakNotu: '<p>Bu kılavuz Mola\'yı ilk günden itibaren rahatça kullanmanız için hazırlandı. Önce bir müşterinin hikâyesini izliyoruz, sonra her çalışanın ekranını ve günlük işlerini anlatıyoruz.</p><p>Ekranlardaki kırmızı numaralar, yanındaki kısa açıklamalarla aynıdır. Ekran görüntüleri örnek işletme "Mola Örnek Kafe"den alınmıştır.</p>',
    icerik: [tanitim(), musteri(), garson(), kasiyer(), mutfak(), mudur(), sahip(), ilkGun(), qrKoruma(), internet(), sssBolum(), sorunGiderme(), iletisim()].join(''),
  };
}

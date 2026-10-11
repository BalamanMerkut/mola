# Test planı ve ilk doğrulama sonuçları

Sürüm 0.1.0 · 16 Eylül 2026 · Windows / Node 24.14.0 / Chrome.

## Hangi ortamda test edeceğiz?

| Ortam | Amaç | Erişim |
|---|---|---|
| Localhost | Geliştirme, iş kuralları, ilk ekran denemesi | Aynı bilgisayardan `http://localhost:3000` |
| Yerel ağ testi | Gerçek telefon/tablet, dokunma, QR ve ekran boyutu | `npm run dev:lan`, bilgisayarın IPv4 adresi ve port 3000 |
| Ayrı HTTPS test ortamı | Mobil internet, gerçek bağlantı gecikmesi, merkez–işletme aktarımı, SMS ve güvenlik | Üretim temeli tamamlanınca sahte verilerle kurulacak |
| Kontrollü pilot | Gerçek işletme akışı, personel kullanımı, günlük kapanış | Güvenlik ve kabul kriterleri tamamlandıktan sonra |

Localhost başlangıç için doğrudur; müşteriye sunma kararı için tek başına yeterli değildir. Aynı Wi-Fi yalnızca yerel deneme yöntemidir; ürünün müşteri kullanım koşulu değildir. Bu aşamada internete açık test sunucusu kurulmadı.

## Çalıştırılan otomasyonlar

| Kontrol | Sonuç |
|---|---|
| `npm run typecheck` | Geçti |
| `npm test` | Node test koşucusunda 50 test geçti, 0 hata. Buna 9 HTTP alt testi ve kapsayıcı test dahildir. |
| `npm run build` | Geçti; JS yaklaşık 305 kB, gzip yaklaşık 96 kB; CSS yaklaşık 33 kB. Bu ölçüm tüm sayfa hız puanı değildir. |
| `npm run test:e2e` | Chrome üzerinde 15 senaryo geçti (kategori yönetimi, sipariş düzenleme, masa taşıma ve performans dahil). |
| `npm run test:load` | 20 eşzamanlı misafir, 180 istek, 80 sipariş, 0 hata |

Yerel yük kontrolü örnek ölçümü: toplam 392 ms, p50 36 ms, p95 71 ms. Aynı makinedeki kısa, küçük veri testi olduğu için bu rakamlar sunucu satın alma veya günlük kapasite garantisi vermez. Büyük arşiv, merkez aktarımı, farklı internet bağlantıları ve gerçek cihazlarla yeniden ölçülecek.

## İş kuralı/API test kapsamı

- Dört tarayıcının aynı masada tek hesap kullanması; farklı misafir etiketleri.
- Eşzamanlı 20 yeniden gönderimde tek sipariş oluşması; aynı işlem kimliğinin farklı içerikte reddi.
- Müşterinin değiştirdiği toplamın kabul edilmemesi; eski sipariş fiyatının menü fiyatından etkilenmemesi.
- Zorunlu seçenek, bağımsız boy/süt farkı, tekrarlı seçenek, tükenen ürün ve geçersiz adet doğrulaması.
- Başka masaya/işletmeye yazma, başka müşterinin siparişini iptal etme, garsonun ödeme kaydetme girişimlerinin reddi.
- Tek tarayıcı engellenirken aynı IP'deki diğer tarayıcının çalışması; IP engelleme uç noktasının bulunmaması.
- İptal süresi, hazırlık durumu, yanlış durum sırası ve eski sürümle işlem çakışmaları.
- Kısmi nakit/kart, POS komisyon kopyası, para üstü, fazla/eksik tahsilat, çift kasiyer çakışması.
- Tahsilat tekrarıyla ikinci ödeme oluşmaması; ödeme sonrası eski oturumun kapanması.
- Hesap kapansa bile mutfakta tamamlanmamış siparişlerin kaybolmaması.
- Giriş/Origin denetimi, işletme işlemcisinin gerçekten kullanılamaması, mutfak yanıtında sipariş tutarlarının gizlenmesi.
- Şifreli pakette değişiklik, yanlış anahtar, yanlış işletme bağlamı; kalıcı kaydın yeniden açılması ve başarısız işlemin geri alınması.

## Tarayıcı test kapsamı

1. İşletme girişi → QR menüsü → müşteri siparişi → mutfakta hazırlama → 35 TL hesaba 50 TL nakit/15 TL para üstü → masa hesabını yenileme.
2. 320 px müşteri ekranında sayfa taşmaması, tükenen ürünün seçilememesi, İngilizce ana metinler; 768 px garson ekranında ürün koduyla sipariş ve yetkiyle menü yönetiminin gizlenmesi.
3. Ürün oluşturma, tükendi işareti, sayfa yenilemede kalıcı durum. Bu testin yakaladığı asenkron kutucuk sorunu düzeltildi.
4. Sunucu siparişi kabul ettikten sonra yanıt kaybı taklidi; yeniden kontrol ile ikinci sipariş oluşmaması. Ardından ağ kesilince yeni sipariş düğmelerinin devre dışı kalması.

Ekran görüntüleri `test-results/` altına yazılır. Masaüstü ve 320 px müşteri ekranı görsel olarak da incelendi. Playwright sonraki çalışmada eski sonuçları yenileyebilir. 390 px ve 768 px testleri de geçmiştir; gerçek iPhone/Android donanım testi yapılmış sayılmaz.

## Elle yapacağımız kabul turu

| Senaryo | Beklenen |
|---|---|
| Aynı QR ile 4 farklı telefon | Ayrı müşteri siparişleri, tek masa hesabı |
| Çay siparişine sonradan fiyat değişikliği | Önceki sipariş fiyatı korunur |
| Garson 21 koduyla çay seçer | Doğru masaya yalnızca bir mutfak işi |
| Yeni sipariş 60 saniye içinde iptal | Hazırlık başlamadıysa hesap azalır |
| Hazırlanan sipariş iptal isteği | Otomatik silinmez; işletme kararı bekler |
| Kısmi nakit + kalan kart | Ayrı ödeme kayıtları, tam ödemede kapanış |
| Sipariş gelirken kasa ödeme kaydeder | Eski hesap sürümü reddedilir, güncel tutar gösterilir |
| İşletme sekmesi arka plana geçer/kapanır | Yerel işletme işlemcisi çalışıyorsa sipariş devam eder; tarayıcı sinyali belirleyici değildir |
| Uygulama kapatılıp yeniden açılır | Siparişler korunur; kullanıcı girişi/QR oturumu yenilenir |
| Dar ekran / büyük yazı / yatay tablet | Ürün kartları ve kritik düğmeler kullanılabilir |

## Üretimden önce eklenmesi gereken testler

- HTTPS test ortamında Android Chrome ve iOS Safari; düşük güçlü telefon, yavaş ağ, ekran okuyucu ve klavye erişimi.
- 5–25 işletme ve yoğun saat profili; günlük istek sayısından ayrı eşzamanlı aktif bağlantı/okuma/yazma ölçümü. Örneğin 5.000 istek/gün ortalaması yaklaşık 0,058 istek/sn olsa da seçim yoğun saat, görsel trafik ve iki saniyelik ekran sorgularına göre yapılmalı.
- Uzun süreli dayanıklılık, büyük arşiv, disk dolması, ani işlem sonlandırma, yedekten dönüş ve migration geri dönüşü.
- Şifreli merkez aktarımı, anahtar yenileme, işletme cihazı kaybı, rapor 2FA, kurtarma yetkisinin önce loglanması ve denetim kaydının bütünlüğü.
- Merkezi çok işletmeli veritabanı/önbellek/gerçek zamanlı bağlantı izolasyonu; davetsiz kullanıcı, süresi dolmuş oturum ve yetki değişimi.
- Fotoğraf/kırpma, kampanya birleşimi, fiyat değişimi, masa taşıma/birleştirme, iade/düzeltme, yıllık rapor mutabakatı.
- Tarayıcı tamamen kapanınca belirsiz işlem kurtarma; aynı işletme işlemcisinin iki kopyasının aynı anda açılması.
- Bağımlılık ve bağımsız güvenlik incelemesi, gerçek dağıtım yapılandırması, kayıtlarda sır/finans verisi taraması.

Bu maddeler şu an geçti olarak raporlanmaz. Yayına çıkış, ilgili modüller tamamlanıp bu senaryolar doğrulandığında değerlendirilecek.

## Son düzenlemelerin doğrulaması

- 60 saniyelik pencerenin son milisaniyesinde hazırlık reddediliyor; tam bitişte kabul ediliyor. Süreyi sıfırlamak mevcut siparişin süresini kısaltmıyor; yeni sipariş hemen hazırlanabiliyor.
- Gerçek tarayıcıda kısa geri sayımla düğmenin soluk/kilitli durumdan aktif duruma geçişi ve API reddi doğrulandı.
- Kahvede eklenen Boy alanının Tatlılar kategorisine taşınmadığı; sütlü alt türü, servis tercihi ve ek ücretin kaydedildiği doğrulandı.
- Test için üretilmiş görselle fotoğraf seçme → kırpma önizleme → yükleme → menüde WebP gösterimi doğrulandı. Görsel test dosyası gerçek ürün fotoğrafı değildir.
- 800/320 piksel WebP çıktıları, metadata çıkarılması, sahte görsel/SVG ve fazla boyutun reddi; fotoğraf yüklemede işletme sahibi yetkisi test edildi.
- Açılır sipariş onayı önceki sipariş/kasa ve yanıt kaybı testlerine dahil edildi.

Görsel işleme davranışı için başvuru: [Sharp çıktı seçenekleri](https://sharp.pixelplumbing.com/api-output/).

## Son hata düzeltmelerinin testleri

- 120 saniye çalışan tarayıcı sinyali olmadan, mutfakta bekleyen siparişler varken 12 masanın hepsine yeni sipariş kabul edildi.
- Gerçek işlemci kullanılamama yanıtı doğru açıklamayla gösterildi; sonrasında yeniden gönderimde tek sipariş oluştu. Kabul sonrası yanıt kaybında aynı işlemle yeniden kontrol testi de geçmeye devam ediyor.
- Ürün adı seçimi dışarı sürüklenince pencere açık kaldı. Dış alanda sürükleme kapatmadı; tek normal dış tıklama kapattı.
- Eksik alanlarda düğmenin pasifliği, üzerine gelme açıklaması, alanların doldurulunca etkinleşmesi ve kayıtsız müşteri önizlemesi doğrulandı.

## Ürün düzenleyicisi performans ölçümü

Aynı Chrome/yerel makinede, derlenmiş arayüzde 4 kat CPU yavaşlatma ile 8 grup × 12 seçenek (96 seçenek), 40 metin girişi ve kaydırma denendi. Tek karşılaştırma koşusudur; gerçek cihaz garantisi veya tam INP ölçümü değildir. Giriş olayı başlangıcından sonraki animation frame'e kadar olan süre ölçülür.

| Ölçüm | Önce | Sonra |
|---|---:|---:|
| Giriş → sonraki kare p50 | 20 ms | 4 ms |
| Giriş → sonraki kare p95 | 27 ms | 6 ms |
| Toplam script çalışma süresi | 745 ms | 124 ms |
| Toplam ana iş süresi | 1634 ms | 730 ms |

Test: `tests/browser/editor-performance.spec.ts`. Çalıştırma: `npm run build` ardından `npm run test:e2e -- --grep "editor performance"`. Değişken donanım nedeniyle milisaniye eşiğiyle kırılgan test yazılmadı; sonuçlar JSON ekine kaydedilir. Mevcut sekiz işlevsel tarayıcı senaryosu da geçti.

## Fotoğraf, QR ve mutfak sesi

- Kırpılmamış kaynak ve kadraj değerleri yeniden açılabiliyor; başka işletmeden kaynak erişimi reddediliyor. Eski fotoğraflar mevcut kırpımları üzerinden açılıyor.
- Tarayıcı testinde dosya tekrar seçilmeden Fotoğrafı düzenle ile kadraj açıldı; müşteri detayında fotoğrafın kare ölçüsü ve contain gösterimi doğrulandı.
- QR testinde localhost yerine bildirilen LAN adresi kullanıldığı doğrulandı. Gerçek yerel ağ adresi bu bilgisayardan HTTP 200 döndü; telefonun kendisinden erişim henüz kullanıcı tarafından doğrulanmadı.
- Mutfak sesi testinde kullanıcı etkinleştirmesi, yeni siparişte bir kez ses üretimi, sonraki sorgularda tekrarlamaması ve susturma doğrulandı. Otomasyonda ses API'si taklit edildi; fiziksel hoparlör duyulabilirliği ayrıca denenmeli.

## Kurulum ve çalışan yönetimi doğrulaması

- Kullanıcı adı benzersizliği, çalışan sahibine ait olmayan hesaba müdahale reddi, çalışan için yönetim yetkisi reddi ve owner hesabını koruma.
- Rol/aktiflik/şifre değişiminde mevcut oturumun reddedilmesi; eski şifrenin çalışmaması, yeni şifreyle giriş.
- Yeniden açılan veritabanında hesap ve şifre sürümünün korunması; demo hesabının tekrar sıfırlanmaması.
- Kurulumun 12 masayı 25'e çıkarırken mevcut QR, menü, sipariş ve hesapları koruması; tekrar kaydın çoğaltmaması; eski ayar sürümünün ve masa sayısı azaltmanın reddi.
- Tarayıcıda üç adımlı kurulum, yeni garson hesabıyla giriş ve hesap kapatma sonrası giriş ekranına dönme.
- İlk toplu tarayıcı çalışmasında testler dakika içindeki 12 giriş sınırına takıldı (429). Sınır gevşetilmedi; aynı dosyadaki yönetim testleri tek giriş oturumunu paylaşıyor.

## Çalışan raporu doğrulaması
37 otomatik test ve 13 tarayıcı senaryosu geçti. Çalışan/QR ayrımı, iptal ayrımı, idempotent tekrar, canlı/arşiv tekilleştirme, kapalı hesapların geçmişi, Türkiye gece yarısı sınırı, geçersiz tarih, işletmeler arası izolasyon ve çalışan erişim reddi doğrulandı. Tarayıcıda rapor filtresi ve kapalı çalışan satırı kontrol edildi.

## Genel mali durum doğrulaması
38 otomatik test ve 13 tarayıcı senaryosu geçti. Nakit para üstünün tahsilata dahil edilmemesi, kısmi nakit/kart ödeme, ödeme/sipariş tarihi ayrımı, Türkiye gece yarısı, iptal ayrımı, arşiv tekilleştirme, kayıt anındaki komisyon ve eksik komisyon doğrulandı. Mali rapor çalışan erişimini reddediyor. İki sekme ve 390px mobil görünüm tarayıcıda kontrol edildi.

### Grafik etkileşimleri
Tahsilat grafiğinde fareyle tarih seçimi, klavyede End ile son günü seçme ve bilgi kutusu doğrulandı. Çalışan halka grafiği gerçek test siparişiyle kontrol edildi; QR siparişleri dağılımdan hariç. Typecheck, derleme ve ilgili 2 yönetim tarayıcı senaryosu geçti.

## Sipariş değiştirme
42 otomatik test geçti. Düzenleme özgün süreyi/fiyatı/kimliği korur; ürün ve seçenek değişiklikleri doğrulanır. Kesin süre sınırı, ödeme, kapalı hesap, başka misafir/masa/işletme, engelli tarayıcı ve eski sürüm reddedilir. Mobil tarayıcıda adet, boy ve ürün ekleme, kabul sonrası kayıp yanıtı aynı kimlikle tekrar gönderme, tek sürüm artışı ve mutfak yansıması doğrulandı. İlgili 3 tarayıcı senaryosu, TypeScript kontrolü ve son derleme başarılı.

## Masa taşıma doğrulaması
45 otomatik test ve 14 tarayıcı senaryosu geçti. Kısmi ödeme ve fiyat korunması, tek seferlik taşıma, eski kaynak/hedef QR oturumlarının reddi, yeni QR ile aynı hesabın sürmesi, eski mutfak işleminin reddi, dolu/değişmiş hedef, yetki ve işletme sınırları kontrol edildi. Tarayıcıda yeni masa adına geçen sipariş ve kehribar değişiklik uyarısı görüntülendi. TypeScript ve derleme başarılı.

## Garson taşıma yetkisi ve QR kullanım özeti
47 otomatik test ve ilgili 3 yönetim tarayıcı senaryosu geçti. Garsonla masa taşıma başarılı; ödeme yetkisi yok. Aynı tarayıcının tekrarları, farklı tarayıcı/hesaplar, iptaller ve arşiv kopyaları rapor testinde doğrulandı. QR/çalışan karşılaştırma grafiği görüntülendi. Derleme ve TypeScript kontrolü başarılı.

## Varsayılan mutfak sesi ve tek seferlik kurulum
47 otomatik test ve 14 tarayıcı senaryosu geçti. Son ek kontrolde sesin varsayılan açık olması, altı notanın yeni siparişte bir kez çalması, sorgu tekrarının sessiz kalması, sessize alma ve ekran değişiminde tercihin korunması doğrulandı. Kurulum ilk girişte tamamlanır; yenilemeden sonra tekrar görünmez ve sunucu yeni bir kurulum isteğini reddeder. Ses testleri Web Audio çağrılarını denetler; gerçek hoparlörün ses seviyesi/işitilebilirliği cihazda denenmelidir.


## Masa ekleme/çıkarma ve tek seferlik ses
48 otomatik test ve ilgili 3 tarayıcı senaryosu geçti. Masa ekleme/çıkarma tekrarları, yetkisiz ve farklı işletme istekleri, değişmiş masa, açık hesap, tahsil edilmiş ancak mutfakta bekleyen sipariş, eski QR iptali ve diğer QR/kayıtların korunması doğrulandı. Tarayıcıda işletme sahibi masa ekledi/çıkardı; garsonda düğme görünmedi. Sipariş başına yalnızca üç notalı tek bildirim, sessize alma ve yeniden açma kontrol edildi. TypeScript ve derleme başarılı.

## Dinamik kategori yönetimi
50 otomatik test ve 15 tarayıcı senaryosu geçti. Kategori ad değişikliğinde ürünler güncellenirken siparişlerin korunması, tekrar gönderim, eski sürüm, yetki/işletme sınırı, aynı ad, sıralama ve dolu kategori silme kontrolleri doğrulandı. Tarayıcıda özel kategori oluşturuldu, yeniden adlandırıldı, sırası değiştirildi; bu kategoride ürün oluşturulup müşteri menüsünde görüldü. Ürün editörü performans testi de geçti.

## Ürün formu hata önleme
Yeni ürün kategorisi boş başlar; ad/fiyat doluyken bile kategori seçilene kadar kaydetme kapalıdır ve açıklaması gösterilir. Hazır Boy/Süt/Servis alanlarına ikinci tıklama yeni grup üretmez; ad değiştirilse de preset kimliği korunur. Özel alanlar tekrar eklenebilir. Eski ürünler, grup kaldırıp yeniden ekleme ve kategori taslak ayrımı tarayıcıda doğrulandı. 50 otomatik test, 15 tarayıcı senaryosu ve son eski ürün uyum kontrolü geçti.


## Tam menü önizlemesi
TypeScript kontrolü, derleme ve 15 tarayıcı senaryosu geçti. Önizleme görünüm alanının tam 320/390/768 px olması, yatay sayfa taşması olmaması, kategori/ürün açma, dil düğmesi, kapalı sepete ekleme ve sipariş POST isteği oluşmaması doğrulandı. Son pencere yüksekliği düzenlemesinden sonra ilgili tarayıcı senaryosu yeniden geçti; ekran görüntüsü incelendi. Ürün düzenleyici performans senaryosu da başarılı (4 kat CPU yavaşlatmada 95. yüzdelik girişten çizime 6 ms).

## Popüler ürünler doğrulaması
52 otomatik test, 15 tarayıcı senaryosu, TypeScript kontrolü ve derleme geçti. Ürün adedi sıralaması, 6 ürün sınırı, eşitlikte tutarlı sıra, canlı/arşiv tekilleştirme, canlı iptal önceliği, tükenen/silinen ürünler, 30 günlük kesin sınır, gelecekteki kayıtlar ve boş/diğer işletme verisi doğrulandı. Tarayıcıda siparişten sonra popüler filtre, arama, Türkçe/İngilizce ve mobil taşma kontrol edildi. Yerel geliştirme sunucusu güncel sunucu koduyla yeniden başlatıldı.

## Alt kategori sıralaması doğrulaması
53 otomatik test, 15 tarayıcı senaryosu, TypeScript kontrolü ve derleme geçti. Yetki/işletme sınırları, eski menü sürümü, eksik/tekrarlı liste, idempotent tekrar, ana kategori ad değişikliğinde sıra korunması ve yeni/kaldırılmış alt türler doğrulandı. Tarayıcıda Çaylar altında Bitki türü yukarı taşındı; tam menü önizlemesinde ilk alt tür olduğu ve filtreyle yalnızca Ihlamur ürününün kaldığı kontrol edildi. Yerel sunucu güncel kodla yeniden başlatıldı.

## Alt kategori ad değiştirme ve kaldırma
54 otomatik test, 15 tarayıcı senaryosu, TypeScript kontrolü ve derleme geçti. Boş/uzun/çakışan adlar, kapsamın ana kategoriyle sınırlanması, sıra ve geçmiş sipariş korunması, ürün silinmemesi, yetki/işletme/sürüm ve tekrar gönderim kontrolleri doğrulandı. Tarayıcıda Bitki adı Bitki çayları olarak değiştirildi, Demleme alt kategorisi açıklamalı onayla kaldırıldı ve ürünün ana kategoride kaldığı kontrol edildi. Önizlemede yeni ad ve filtre doğrulandı.

## Alt kategori ekleme
55 otomatik test, 15 tarayıcı senaryosu, TypeScript kontrolü ve derleme geçti. Boş alt kategorinin serileştirme sonrası korunması; aynı adlı, boş, uzun, yetkisiz, farklı işletme ve eski sürüm isteklerinin reddi; idempotent tekrar; yeniden adlandırma/kaldırma ve ana kategori adı değişikliği doğrulandı. Tarayıcıda Özel harman eklendi, ürün düzenleyicisinde öneri olarak bulundu ve ürün atanmadığı için müşteri önizlemesinde gösterilmedi.

## 18 Eylül: Onay, kasa, platform ve destek
60 otomatik test ve 17 tarayıcı senaryosu geçti. Son arayüz düzenlemelerinde ilgili 6 yönetim senaryosu tekrar geçti. TypeScript ve son derleme başarılı.
- Garson onayı mutfak geçişini ve tahsilatı bloke eder; otomatik onay önceki bekleyenleri değiştirmez. Personel siparişi doğrudan geçer. Düzenlenen QR siparişinin tekrar onayı ve açıklamalı ret doğrulandı.
- Ürün ödeme tahsisleri, tekrar tahsilat reddi, kısmi ödeme sonrası masa birleştirme, kaynak/hedef QR iptali ve finansal toplam korunması doğrulandı.
- Kasiyer gideri yetki/açıklama/idempotent kayıt ve günlük rapor ayrımı test edildi.
- Ana panel ile işletme oturumları ayrı; işletme oluşturma tekrarı, kullanıcı/QR işletme izolasyonu, lisans askısı, ay sonu/artık yıl süresi ve destek kapsamı test edildi. SMS/e-posta gönderilmediği, yalnızca bekleyen olay kaydı oluştuğu doğrulandı.
- Tarayıcıda garson/kasiyer/işletme sahibi sekmeleri, sayısal ürün kodu, gider, ürün seçerek ödeme, hesap birleştirme, kurulum bilgi kutusu ve iki panel arasında destek yanıtı/kapanışı denendi. Ekran görüntüleri incelendi.
- Bu testler gerçek SMS teslimatı, harici e-posta, internete açık merkezi barındırma veya cihazlar arası uçtan uca şifreleme testi değildir.


## 20 Eylül 2026 ek doğrulamalar

- Negatif seçenek farkı: 50 TL ürünün −10 TL seçeneği 40 TL; adetle çarpma ve kabulden sonra fiyat sabitleme. Sıfır/negatif son fiyat ve birden fazla grubun toplam indirimi reddedilir.
- Temizlik: tam ödeme sonrası bekleme, temizlik sırasında sipariş/taşıma engeli, garson/sahip yetkisi, eski sürüm ve tekrar gönderim; taşıma/birleştirmede yalnızca boşalan masa.
- Tarayıcı: QR okutunca beyaz, sipariş gelince sarı, teslim edilince yeşil, hesap kapanınca kırmızı, garson temizleyince beyaz. Ödenen ürün tekrar seçilemez ve masa detayında işaretlenir.
- Rapor sekmeleri, 6 ay/1 yıl aralıkları, 320/390/1280 pikselde bilgi kutularının taşmaması ve Destek düğmesinin görünürlüğü.
- Tam kontrol: 63 otomatik test ve 19 Chrome senaryosu geçti. Son rapor yerleşiminden sonra ilgili 8 yönetim senaryosu yeniden geçti. TypeScript kontrolü ve derleme başarılı.


## 20 Eylül 2026 — Ödeme sırası ve iç/dış masa kabulü

- 66 otomatik test başarılı. Önce ödeme için hazırlık ve teslim kilidi, ödeme politikasının sipariş anında sabitlenmesi, ödenmiş siparişin yeni ürün eklenince yeniden kilitlenmemesi ve teslim sonrası tek kapanış doğrulandı.
- Tarayıcı paketindeki 21 farklı senaryo doğrulandı: ilk tam çalıştırmada 20 geçti, son senaryonun masa numarası yerine sipariş numarasıyla seçim yapması düzeltildi; ardından ilgili 10 yönetim senaryosunun tamamı geçti. Son görünürlük düzenlemesinden sonra iki ödeme senaryosu tekrar geçti.
- Üç ayrı kısmi tahsilat aynı pencerede; ilk yanıt kaybolduğunda aynı ödeme iki kez kaydedilmiyor. Tam tahsilat pencereyi kapatıyor. Kalan hesap, ödenen adetler ve son para üstü pencere içinde gösteriliyor.
- Önce ödeme modunda sipariş mutfakta görünür ancak hazırlık düğmesi soluk; kısmi ödeme kilidi açmaz, sipariş tamamı ödenince açılır. Garson hazır siparişi teslim eder; hem garson hem mutfak ekranından kaybolur, hesap kapanır, temizlik tercihi uygulanır.
- İç/dış masa kurulum sayıları, aynı ekrandaki bölüm başlıkları, sonradan bölüm değişikliği ve eski QR kodlarının korunması doğrulandı.
- TypeScript kontrolü ve derleme başarılı; localhost:3000 sağlık kontrolü HTTP 200.

## 21 Eylül — Sabit TL indirimi
- 83 otomatik test, tür kontrolü ve derleme başarılı. Kuruş hassasiyeti, seçenekler dahil birim indirim, adet çarpımı, yüzde + TL birleşimi, en düşük teklif, fiyat alt sınırı, eski sipariş/rapor dönemi ve tahsilat ataması kontrol edildi.
- API testinde sıfır/negatif/kesirli kuruş/aşırı tutar ve aynı anda yüzde/TL alanları reddedildi. Owner yetkisi, sürüm ve aynı işlemin tekrarının korunması doğrulandı.
- Kampanya ve taslak tarayıcı senaryoları geçti. Kampanya testi gerçek müşteri siparişini ve nakit tahsilatını içerir: 35 TL − 10,25 TL = 24,75 TL; 2 adet = 49,50 TL; raporda indirim = 20,50 TL. Önceki yüzde kampanyasının 28 TL siparişi değişmedi. Mobil form ve rapor görüntüleri incelendi.

## 21 Eylül — Adet koşulu
- 87 otomatik test geçti. Aynı ürünün farklı boy/satırlarını sayma, farklı ürün/siparişleri birleştirmeme, koşulsuz/koşullu teklif karşılaştırması, yüzde ve TL eşikleri doğrulandı.
- Sipariş anında eşik altında olan satırın koşulları saklandı. Sonradan fiyat/kampanya değişse veya kampanya kapatılsa da artırma/azaltma kayıtlı şartlarla hesaplandı. Yanlış eski indirimli toplam reddedildi; tekrar isteği tek uygulandı. Ödeme sonrası değişiklik ve kalem bazlı tahsilat kuralları korundu. Rapor indirimi/geliri kontrol edildi.
- 11 mevcut kampanya/müşteri/mutfak tarayıcı senaryosu geçti. Yeni adet senaryosunda geçmiş test siparişini seçme sorunu giderildi; tekrar çalıştırması başarılı. Sepette ayrı iki ekleme, birini çıkarma, sipariş sonrası azaltma/artırma, kampanyayı kapatma, nakit ödeme ve rapor test edildi. Mobil görüntüler incelendi; yatay taşma yok.

## 21 Eylül — Toplam kampanya kontenjanı
- 93 otomatik test başarılı. Tam 50 adet ve 51. ürün, farklı ürün/satırlarda ortak kullanım, eşzamanlı son adet, aynı isteğin tekrarı, onay bekleyen rezervasyon, iptal/azaltma, eski siparişte artış, birleşen indirimler, arşivde tek sayım ve serileştirme doğrulandı.
- API: geçersiz limitler, minimum koşuldan veya kullanılan adetten küçük limit, düzenleme sonrası kullanım korunması, sınır alanının eksik gelmesiyle sınırın kaldırılamaması ve işletme izolasyonu kontrol edildi.
- Kontenjan/yüzde-TL/minimum-adet üç tarayıcı senaryosu birlikte geçti. Kontenjan testinde örnek 50 değeri, mobil form, fazla adedin reddi, sayaç güncellemesi, dolunca normal fiyat, iptalle tekrar indirimli fiyat ve düzenleyerek sayacı sıfırlayamama test edildi. Test seçicileri başka testlerin kampanya/masa kayıtlarıyla karışmayacak şekilde güncellendi.

## 21 Eylül — Yenileme sonrası QR gönderimi
- 96 otomatik test geçti: geçici kaydın gövde/toplam eşitliği, QR yollarının ayrılması, bozuk/engelli depolama, eski yanıtın yeni kaydı silmemesi; sunucuda aynı tarayıcı/hesapta tekrar, yeni tarayıcı veya masa sürümünde kabul edilmemiş eski isteğin reddi.
- 10 mevcut müşteri/mutfak senaryosu geçti. Üç yeni tarayıcı testi son derlemeyle geçti: kabul edilmiş gönderim ürün yayından kalkıp hesap kapandıktan sonra aynı kimlikle bulunur; hiç ulaşmamış gönderim yenilemeden sonra bir kez kabul edilir; çerezler değişince eski gönderim otomatik sipariş oluşturamaz.
- Başarılı kontrolde sessionStorage temizliği, özgün HTTP gövdesinin korunması, yeni hesap açılmaması ve 390 px ekranın taşmaması doğrulandı. Gerçek yerel işletme verileri test amacıyla değiştirilmedi.


## 21 Eylül — Yenileme sonrası tahsilat kontrolü
- 99 birim/API testi ve tür kontrolü/derleme geçti. İşletme/çalışan kapsamı, yeniden giriş ve kapanan hesaba aynı işlemle erişim, rol kısıtları, bozuk/depolaması engelli kayıt, özgün seçim/tutar, geç gelen yanıtın yeni kaydı silmemesi kontrol edildi.
- 6 ilgili tarayıcı testi geçti. Kabul edilen tam tahsilatın yanıtı kaybedildi, masa kapandı, sayfa yenilendi ve aynı sonuç/para üstü yeniden alındı. Kısmi ürün tahsilatı yenilemeden sonra aynı HTTP gövdesiyle kontrol edildi, 1/3 ödendi işareti ve 170 TL kalan korundu; kalan ürünler aynı pencerede ödendi.
- Sunucuya hiç ulaşmayan kart tahsilatı başka çalışan hesabında gösterilmedi ve API yanlış çalışanla reddetti; ilk hesapta geri açılıp bir kez kaydedildi. Başka kasadan değiştirilen hesapta eski istek reddedildi, önceki gerçek tahsilat ve bakiye değişmedi. Mevcut kayıp yanıtla kısmi ödeme ve önce ödeme/hazırlık kilidi akışları da doğrulandı.
- 390 px mobil kurtarma ekranı görsel olarak kontrol edildi ve yatay taşma yok. Testler ayrı .local/e2e ortamında çalıştırıldı; .local/development verileri test amaçlı değiştirilmedi.


## 21 Eylül — Yenileme sonrası sipariş değişikliği
- 103 birim/API testi, tür kontrolü ve derleme geçti. Kalem kimliği/sipariş sürümü/gönderilen toplam korunması, QR bazlı ayrım, bozuk kayıtlar ve depolama engeli; kesin ret ile belirsiz yanıt ayrımı doğrulandı.
- API'de süre geçtikten ve hesap kapandıktan sonra kabul edilmiş değişikliğin aynı sonuçla dönmesi, kabul edilmemiş geç değişikliğin reddi, farklı tarayıcı/masa oturumu koruması ve tek order.edited denetim kaydı kontrol edildi.
- 6 tarayıcı senaryosu geçti: kabul + yanıt kaybı + tahsilatla kapanış + yenileme; ulaşmamış isteğin süre içinde tek kabulü; ulaşmamış isteğin süre sonrası reddi; tarayıcı kimliği değişimi; mevcut seçenek/adet/ürün ekleme ve kayıp yanıt; adet kampanyasıyla düzenleme/ödeme/rapor. Yenilenen isteğin özgün HTTP gövdesiyle eşitliği ve sessionStorage temizliği doğrulandı.
- Mobil 390 px kurtarma ekranı incelendi, yatay taşma yok. Testler .local/e2e ve .local/tests altında izole verilerle çalıştırıldı.


## 21 Eylül — Yenileme sonrası iptal talebi
- 106 birim/API testi geçti. Özgün sipariş sürümü, QR bazlı ayrım, bozuk/engelli depolama ve eski yanıtın yeni kaydı silmemesi doğrulandı. API testi, hesabı kapanan doğrudan iptalin ve sonradan işletmece onaylanan talebin kayıtlı sonucunun tekrarını kontrol eder; sipariş sürümleri mükerrer artmaz.
- Dört yeni iptal tarayıcı testi geçti: kabul edilmiş doğrudan iptal ve kapanmış hesap; onay bekleyen iptal isteği; ulaşmamış isteğin süre sonrasında onaya gitmesi; tarayıcı değişimiyle eski isteğin reddi. Özgün HTTP gövdesi, kayıt temizliği ve doğru sonuç mesajları kontrol edildi. Kapanmış iptal siparişinin aktif listeden çıkması testte dikkate alındı.
- Dört mevcut değişiklik kurtarma testi de geçti. 390 px mobil iptal kontrolü görsel olarak incelendi, yatay taşma yok. Gerçek işletme verilerine test siparişi veya tahsilatı eklenmedi.


## 21 Eylül — Fotoğraf depolama koruması
- 108 birim/API testi ve tür kontrolü geçti. Eşzamanlı iki yüklemeden yalnız kalan alana sığanın kabulü, kaynak/küçük görsel/metadata toplamı, ayrı işletmenin bağımsız sınırı, mevcut fotoğrafın korunması ve WebP şeffaflığı doğrulandı.
- İkinci dosyanın açılmasında ENOSPC enjekte edildi; bu yüklemenin ilk dosyası kaldırıldı, önceden var olan fotoğraf ve byte toplamı korundu. Hata sonrasında yeni yükleme başarılı oldu.
- Mevcut fotoğraf kırpma/yeniden düzenleme ve müşteri alt kategori/önizleme tarayıcı testi geçti. PHOTO_QUOTA yanıtı simüle edildiğinde ürün adı ve kırpma alanı korunuyor; yeniden denemede gerçek sunucuya yükleme tamamlanıyor. Tarayıcı kotayı doldurmak için gerçek veri üretmez; kota sınırı sunucu birim testinde düşük limitlerle doğrulanır.

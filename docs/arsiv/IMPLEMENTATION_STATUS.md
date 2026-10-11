# Uygulama durumu — 0.1 geliştirme devamı

Kaynak: Ürün Dokümantasyonu v1.1 ve Ayrıntılı Kodlama Haritası v1. Belgeler değiştirilmedi. Bu kayıt yapılan kodu, eksikleri ve sıradaki adımı ayırır. Tarih: 16 Eylül 2026.

## Çalışan ilk dilim

- 12 örnek masa, 8 ürün, kategori/ad/ürün koduyla arama.
- Müşterinin hesap açmadan QR üzerinden sipariş vermesi; işletmeye özel rastgele tarayıcı kimliğiyle engelleme/kaldırma. IP/MAC engeli yok.
- Dört misafirin bir masa hesabında ayrı sipariş vermesi, kendi siparişlerini görmesi.
- Boy/süt/şeker seçeneklerinin örnek ürünlerde birbirinden bağımsız işlenmesi; server tarafında fiyat hesabı ve kabul anında fiyat kopyası.
- Yeni/hazırlanıyor/hazır/teslim edildi mutfak akışı; süre içinde iptal, süre geçince veya hazırlık başlayınca iptal isteği.
- Garsonun tarayıcı/tablet ekranından masa seçerek anında sipariş girmesi; sonradan satış ekleme ekranı yok.
- Nakit/kart ve kısmi ödeme, para üstü, tahsilat anına ait komisyon oranı hesabı, tam ödeme ile masa hesabını yenileme.
- Ödeme kapanınca eski misafir oturumundan yeni sipariş engeli; bitmemiş mutfak işinin korunması.
- Ürün ekleme/düzenleme, benzersiz ürün kodu, tükendi işareti. Kaydet ve yayınla tek işlem; taslak/yayın ayrımı sonraki aşama.
- İşletme sahibi/kasiyer/garson/mutfak demo yetkileri; ikinci örnek işletmeyle API sınırı testi.
- Şifreli yerel kalıcı kayıt, işlem geri alma, tekrar gönderimde aynı sonucu döndürme, sürüm çakışması kontrolü.
- Responsive ekranlar; müşteri ekranının ana düğme ve başlıklarında TR/EN başlangıcı. Tam dil kapsamı henüz yok.

## Haritaya karşılık

| Paket | Mevcut durum |
|---|---|
| G00 kararlar | Yerel prototip kararı kaydedildi. Üretim anahtar/güven modeli henüz kapanmadı. |
| G01 çalışma alanı | React/TypeScript/Node temeli, kilitli bağımlılıklar, test komutları var. |
| G02 yetki/işletme | Yerel kalıcı çalışan hesabı, rol/şifre değişimi ve oturum iptali var; merkezi üretim kimlik sistemi ve 2FA yok. |
| G03 şifreleme/cihaz | Yalnızca yerel geliştirme şifrelemesi var; merkez-işletme şifreli aktarımı ve masaüstü anahtar kasası yok. |
| G04 kurulum/masa | Yerel kurulum sihirbazı, mevcut QR’ları koruyan masa ekleme var; masa azaltma/arşivleme ve merkezi kurulum yok. |
| G05 menü | Fotoğraf/kırpma, alt kategori ve bağımsız seçenek editörü var; gelişmiş işletme şablonları ve taslak/yayın ayrımı yok. |
| G06 fiyat/kampanya | Kuruş temelli fiyat, seçenek farkları ve fiyat kopyası var; kampanya motoru yok. |
| G07 misafir | Yerel QR oturumu ve tarayıcı engeli var; merkezi ölçeklenebilir oturum servisi yok. |
| G08 kabul | Yerel atomik kabul ve yinelenme koruması var; merkezde kalıcı kuyruk/outbox ve cihaz devri yok. |
| G09 mutfak/değişiklik | Durumlar, iptal ve süre içinde müşteri ürün/adet/seçenek değişikliği var. Süre sonrası değişiklik onayı henüz yok. |
| G10 garson | Tablet uyumlu web ekranı var; APK/PWA paketi yok. |
| G11 masa işlemleri | Ortak hesap ve sıfırlama var; masa taşıma/birleştirme/ayırma yok. |
| G12 ödeme | Temel tahsilat var; ürün/kişi seçerek ödeme, düzeltme/iade akışları yok. |
| G13 arşiv | Yerel şifreli hesap kopyası var; merkezi saklama/silme süreleri ve arşiv eşitleme yok. |
| G14 raporlar | Henüz yok: dönem raporu, net gelir, yatay grafik, popüler ürünler. |
| G15 kurtarma | Henüz yok; dolayısıyla admin anahtar görüntüleme yetkisi sunulmuyor. |
| G16 ana panel | Henüz yok. |
| G17 mobil/dil | Temel responsive ve kısmi TR/EN var; cihaz matrisi, performans bütçesi ve tam çeviri bekliyor. |
| G18 test | Bu dilimin otomasyonları var; ürünün bütün kabul testleri tamamlanmadı. |
| G19 pilot/dağıtım | Başlamadı; gerçek müşteri yayını kapalı. |

Güvenlik temelini bekleyen üretim paketleri tamamlandı sayılmaz. Görsel ekranların öne alınması, G00–G03'ün üretim gerekliliklerini kaldırmaz.

## Özellikle henüz bulunmayanlar

Windows kurulum uygulaması, işletme bilgisayarından merkeze güvenli dış bağlantı, merkezi müşteri/çalışan kullanıcı yönetimi, SMS/TOTP, ana panel kurtarma isteğini anahtar açılmadan önce değiştirilemez denetim kaydına yazma, otomatik çeviri, kampanya birleşim kuralları, merkezi kurulum ve tüm hata durumlarını kapsayan dağıtık senkronizasyon.

Şimdiki REST istekleri yerel işlemciye açıktır. Gerçek merkez bu API'nin aynısı olarak yayımlanmayacak; merkez finansal içeriği açmadan şifreli paket taşıyacak. Anahtarın aynı bilgisayarda dosyada tutulması yalnızca geliştirme kolaylığıdır.

## Teknik sınırlar

- Yerel SQLite her işletme durumunu tek şifreli paket olarak kaydeder. Veri arttığında maliyet yükselir; üretim tablo/migration ve anahtar sürümü tasarımı gereklidir.
- Sipariş geçmişi ve işlem tekrar anahtarları henüz otomatik temizlenmez. Ekranda masa sıfırlansa bile yerel şifreli geçmiş rapor temeli için kalır; kalıcı saklama politikası ayrı geliştirilecek.
- Yerel işletme işlemcisi çalıştığı sürece sipariş alınabilir. Yönetim sekmesinin arka plana geçmesi veya kapanması işlemciyi çevrimdışı saydırmaz. Gerçek merkezi sürümde işlemci bağlantısı ayrı izlenecek.
- Tarayıcı ve çalışan oturumları sunucu belleğindedir; yeniden başlatmada giriş/QR yeniden açılır. Sipariş/tahsilat kayıtları korunur.
- Sipariş/ödeme tekrar anahtarı açık formdaki yeniden denemeleri korur. Tarayıcı kapatıp yeni form açma için kalıcı istemci işlem kutusu henüz yok; kesinti sonrası mevcut hesap mutlaka kontrol edilmeli.
- Menüye erişim ve QR siparişi yalnızca `mola-demo` işletmesi için bağlıdır. İkinci işletme API izolasyon denemesi içindir; tam çok işletmeli müşteri yönlendirmesi yapılmadı.
- Ödeme yapılmış hesaba müşteri iptali uygulanmaz; kasiyer incelemesi istenir. İade/düzeltme özelliği henüz yok.
- Kampanya, sadakat ve uzaktan sipariş kuralları şimdilik uygulanmadı. İç kimlikler ürün kodundan ayrı; `source` sipariş kaynağını ayırır. Gelecekte üyelik/teslimat için yine veri modeli değişiklikleri ve test gerekir.

## Bir sonraki geliştirme sırası

1. G00–G03: üretim güven modeli, masaüstü güvenli anahtar deposu, işletme kayıt/cihaz yetkisi ve şifreli merkez aktarımının küçük kanıt uygulaması.
2. Üretim veri modeli/migration, kalıcı işlem kutusu, yeniden bağlanma ve anahtar yenileme testleri.
3. Kurulum, işletme şablonları ve yayın yönetimi; fotoğraf/seçenek editörünü gerçek cihazlarda genişletme.
4. Kampanyalar, kalem bazında değişiklik, masa taşıma/birleştirme, tahsilat düzeltmeleri.
5. Şifreli raporlar, iki adımlı doğrulama, kurtarma denetimi ve ana panel.
6. Gerçek cihaz ve güvenlik testleri, ayrı HTTPS test ortamı, kontrollü pilot.

## Son düzenlemeler

- Başarılı sipariş geri bildirimi odak alan, kapatılabilir açılır pencereye taşındı.
- İşletmenin belirlediği süre boyunca mutfakta hazırlama düğmesi soluk ve kilitli; API de erken hazırlığı reddediyor. Süre sipariş kabulünde sabitleniyor. Ayarın değiştirilmesi yeni siparişlerde geçerli; sıfır saniye yeni siparişleri bekletmiyor.
- Ürün editöründe kahve boy/süt önerileri ve tatlı türü/servis önerileri var. Öneriler zorunlu değil; alan adı, seçenekler, zorunluluk ve ek ücretler bağımsız düzenlenebilir. Kategori değişiminde alan taslakları birbirine karışmaz.
- Alt kategori müşteri menüsünde filtre olarak görünür. İçindekiler ve açıklama ayrı isteğe bağlı alanlar.
- JPG/PNG/WebP fotoğraf yükleme (10 MB istemci sınırı), kare kırpma, yakınlaştırma/konum önizlemesi, sunucuda tekrar doğrulama ve 800/320 piksel WebP üretimi eklendi. Metadata korunmaz. Menü kartları responsive küçük kopya ve lazy loading kullanır.
- Fotoğraflar yerel veri klasörünün media altındadır ve menü içeriği olarak herkese açıktır. İptal edilmiş taslakların yüklediği kullanılmayan fotoğraflar henüz otomatik temizlenmez.
- Müşteri süre içinde ürün ekleyip çıkarabilir, adet ve seçenekleri değiştirebilir; tamamını kaldırmak için iptal akışı kullanılır. Yerel kurulum sihirbazı var; süre buradan veya Ayarlar bölümünden değiştirilir.

## Pencere, önizleme ve sipariş bağlantısı düzeltmeleri

- Dış alana tıklama kapanışı yalnızca fare basma ve bırakma dış alanda, sürükleme olmadan gerçekleşirse uygulanır. Metin seçerek dışarı sürüklemek ve boşlukta sürüklemek pencereyi kapatmaz.
- Zorunlu ürün/alan bilgileri yıldızla işaretli; kaydet düğmesi doğrulama bitene kadar pasif. Üzerine gelme/klavye odak açıklaması ve dokunmatik için görünür eksik alan metni var. Fotoğraf kırpması tamamlanmadıysa bu da açıklanır.
- Kaydedilmemiş ürün, seçenek/fiyat/fotoğrafıyla müşteri önizlemesinde incelenebilir; önizleme sipariş veya ürün kaydı oluşturmaz.
- Tüm masaları yanlışlıkla çevrimdışı saydırabilen 15 saniyelik yönetim sekmesi sinyali bağımlılığı kaldırıldı. Yerel sunucu işletme işlemcisinin kendisi olduğundan tarayıcı zamanlayıcısı sağlık kaynağı değil. Mutfak hazırlık onayı yeni sipariş için önkoşul değildir.
- BUSINESS_OFFLINE yanıtı artık belirsiz bağlantı hatası diye etiketlenmez; sunucunun açıklaması gösterilir. Gerçek yanıt kaybında mevcut işlem anahtarıyla güvenli tekrar korunur.

## Ürün düzenleyicisi optimizasyonu

- Form, seçenek alanları ve fotoğraf alanı yeniden çizim açısından ayrıldı. Ürün adı yazılırken değişmeyen seçenekler ve fotoğraf bileşeni tekrar işlenmez.
- Ana ekranın periyodik güncellemeleri sabit parametreli ürün düzenleyicisini yeniden çizdirmez.
- Müşteri önizlemesi için ürün kopyası yalnızca önizleme açıkken oluşturulur.
- Uzun ürün penceresinin arkasındaki bulanıklık kaldırıldı, gölge hafifletildi.
- Kırpma önizlemesi 320 pikselde ve animation frame ile birleştirilerek çizilir; kaydetmede ayrı 800 piksel çıktı oluşturulur. WebP kodlama asenkron toBlob ile yapılır; çıktı çözünürlüğü düşürülmedi.

## Fotoğraf yeniden düzenleme, QR ve ses

- Fotoğrafı düzenle, yeniden dosya seçmeden kadrajı açar. Yeni fotoğrafların en fazla 2048 piksel kaynak kopyası ve kırpma ayarları ayrı, yalnızca işletme sahibinin okuyabildiği klasörde saklanır. Bu işlem öncesindeki fotoğrafların silinmiş kenarları geri getirilemez.
- Müşteri detayında fotoğraf kare ve daha büyük gösterilir; ek CSS kırpması kaldırıldı.
- LAN modunda QR bağlantısı yerel ağ adresini kullanır; yalnızca bilgisayarda çalışan modda telefon erişiminin kapalı olduğu açıklanır. Windows güvenlik duvarı/ağ izolasyonu hâlâ fiziksel telefon testinde kontrol edilmelidir.
- Mutfak ekranında Sesi aç ve dene, Sesi dene ve Sesi kapat düğmeleri var. Yeni siparişler bir kez ses üretir; ilk açılışta eski siparişler için ses çalmaz. Sayfa yenilenince veya mutfak ekranı yeniden açılınca ses tekrar etkinleştirilir.

Güncel öncelikli eksikler: [Kalan işler](KALAN_ISLER.md).

## Yerel kurulum ve kalıcı çalışan hesapları

- İşletme kurulumu üç adımla ad, masa sayısı, yeni siparişlerin bekleme süresi ve POS komisyonunu kaydeder. Mevcut tablolar silinmez; yalnızca yeni masalar eklenir. Kurulum sürüm kontrolü ve tekrar işlem anahtarıyla korunur.
- Hesaplar artık kod içindeki sabit listeden okunmaz. Şifreler rastgele salt ve scrypt özetiyle, yerel şifreli veritabanında saklanır. İlk geçiş mevcut demo hesaplarını korur; sonraki başlatmalarda hesaplar tekrar oluşturulmaz.
- İşletme sahibi personel oluşturabilir, rolünü değiştirebilir, kapatabilir/açabilir ve şifresini yenileyebilir. Owner rolü bu ekranda atanamaz veya kapatılamaz.
- Her çalışan mevcut şifresiyle kendi şifresini değiştirebilir. Hesap sürümü her istekte denetlenir; şifre/rol/aktiflik değişiminde eski oturum hemen geçersiz olur.
- Merkezi işletme kaydı, üretim kimlik servisi, 2FA ve kurtarma bu yerel modülün tamamlanmasıyla bitmiş sayılmaz.
- Eklemeli veri yükseltmesinden önce şifreli SQLite yedeği oluşturulur. Ürünler, fotoğraflar, QR kodları ve satışlar sıfırlanmaz.

## Masa taşıma ve mutfak uyarısı
- İşletme sahibi/kasiyer/garson açık hesabı boş masaya taşır. Hesap kimliği, sipariş fiyatı, son değişiklik süresi ve ödeme kayıtları korunur.
- Kaynak ve hedef masanın eski QR oturumları geçersiz olur; yeni masanın QR koduyla aynı tarayıcı kendi siparişlerini görmeye devam eder.
- Hedef doluysa veya hesap/hedef sürümü değişmişse işlem reddedilir. İşlem kimliği tekrarları tek kez uygulanır.
- Eski mutfak ekranındaki işlemler sipariş sürümü kontrolüyle reddedilir; güncel masa bilgisiyle tekrar denenir.
- Müşteri güncellemesi ve masa taşıma bilgisi koyu kehribar yazı, açık zemin ve sol kenar vurgusuyla gösterilir.
- Dolu hesapları birleştirme/ayırma bu aşamaya dahil değildir.

## Tek seferlik kurulum ve kompakt ses
Kurulum tamamlanmamış işletme sahibine ilk giriş ekranı gösterilir; tamamlanan kurulum tekrar açılamaz. Kalıcı kurulum menüsü kaldırıldı. İşletme adı/logo/arka plan düzenlemesi ana panel kapsamına taşındı; mevcut Ayarlar bekleme süresi/POS komisyonunu yönetir. Mutfak ses kontrolü başlık yanında hoparlör simgesidir, varsayılan açıktır ve tarayıcı engeline göre etkinleştirme durumu gösterilir. İki yükselen üç notalı zil kullanılır; sessize alma aynı sekmede korunur.


## İşletme sahibine masa ekleme/çıkarma
Masalar ekranına yalnızca owner için iki işlem eklendi. Kullanımdan kaldırılan masalar retiredTables içinde tutulur; eski QR ile yeni oturum alınamaz ve eski açık menüye 410 yanıtı verilir. Aktif hesap veya new/preparing/ready sipariş varsa kaldırma reddedilir. Diğer QR kodları ve geçmiş raporlar korunur. Sipariş sesi tek yükselen üç notalı bildirim oldu; tekrar eden ikinci bölüm kaldırıldı.


## Dinamik menü kategorileri
Sabit dört kategorili ürün doğrulaması kaldırıldı; işletmeye ait kategori listesiyle doğrulama yapılıyor. Owner kategori ekleyebilir, yeniden adlandırabilir, sıralayabilir ve boş kategoriyi silebilir. Güncellemeler menü sürümü ve işlem kimliğiyle korunur. Müşteri/garson menüleri aynı kategori sırasını kullanır. Özel kategorilerde ürün editörü boş öneri listesi ve özelleştirilebilir alanlarla çalışır; mevcut ürünün görsel türü korunur.


## Tam menü önizlemesi
İşletme sahibi Menü yönetimi > Menüyü önizle üzerinden kaydedilmiş menüyü açabilir. 320/390 px telefon ve 768 px tablet seçenekleri gerçek iframe görünüm alanını değiştirir; müşteri menüsüyle aynı Composer ve ürün detay bileşeni kullanılır. Kategori, arama, dil ve ürün seçenekleri incelenebilir. Sepete ekleme ve sipariş gönderme kapalıdır. Yenile düğmesi kaydedilmiş verileri tekrar alır. Kaydedilmemiş ürün taslakları mevcut ürün önizlemesinden incelenir.

## Popüler ürünler
Müşteri menüsü ve işletme sahibinin tam menü önizlemesi, veri varsa Popüler ürünler filtresini gösterir. Son 30 günlük kayan zaman aralığında QR ve personel siparişleri ürün adediyle sıralanır; iptaller sayılmaz, canlı/arşiv kopyaları tek sayılır ve canlı durum önceliklidir. En fazla 6 mevcut ve tükenmemiş ürün seçilir. Henüz ödenmemiş siparişler de dahildir; bu bir tahsilat sıralaması değildir. Eşitlikte ürün kimliğiyle sabit sıra kullanılır. Müşteri API yanıtına yalnızca ürün kimlikleri eklenir; sıralama adetleri ve mali toplamlar gönderilmez. Veri yoksa filtre gizlenir. Arama, dil seçimi ve mevcut ürün detaylarıyla birlikte çalışır.

## Alt kategori sıralaması
Owner Kategorileri yönet ekranında her ana kategorinin Alt kategorileri sırala bölümünü açıp yukarı/aşağı düğmeleriyle sıralama yapabilir. Sıra isteğe bağlı subcategoryOrders alanında saklanır; eski kayıtlar ürünlerden türetilen sırayla çalışır. Kullanılmayan alt türler görünmez, yeni türler sona eklenir. Ana kategori ad değişikliği sırayı taşır, kategori silinmesi ilişkili sıra kaydını kaldırır. Sunucu owner/işletme sınırı, menü sürümü, eksiksiz ve tekrarsız liste kontrolü yapar; işlem kimliği tekrarları tek kez uygulanır ve denetim kaydı tutulur. Mevcut müşteri, garson ve önizleme filtreleri bu sırayı kullanır.

## Alt kategori düzenleme
Kategorileri yönet ekranında Alt kategorileri yönet bölümü boş kategorilerde de görünür. Düzenle işlemi aynı ana kategorideki eşleşen ürünlerin alt kategori adını topluca günceller ve sıralamayı korur. Boş/uzun ad ve aynı ana kategoride ad çakışması reddedilir. Kaldır işlemi açıklamalı arayüz onayından sonra yalnızca alt kategori bağlantısını temizler; ürünleri, ana kategoriyi ve geçmiş siparişleri silmez. Owner/işletme/sürüm ve idempotent tekrar kontrolleri aynen uygulanır. Yeni alt kategori oluşturma ürün düzenleyicisindeki tür alanından yapılmaya devam eder.

## Boş alt kategori oluşturma
Alt kategorileri yönet bölümüne Yeni alt kategori adı ve Alt kategori ekle eklendi. Açıkça oluşturulmuş alt kategoriler isteğe bağlı subcategoryCatalog içinde, sıralamadan ayrı tutulur; ürünü olmasa da yönetimde kalır. Eklemede aynı ana kategoride ad çakışması, uzunluk, yetki, menü sürümü ve tekrar işlem kimliği denetlenir. Katalog ana kategori/alt kategori ad değişikliği ve kaldırma işlemlerini takip eder. Ürün düzenleyicisinin alt kategori önerileri kayıtlı adları da içerir. Müşteri, garson ve önizleme filtreleri yalnızca ürünlerde kullanılan alt kategorileri gösterir.

## 18 Eylül 2026: Garson onayı ve yeni operasyon akışları
- QR siparişi, işletme onay kuralı açık ve garson otomatik onayı kapalıysa awaiting_approval durumundadır. Mutfak snapshot'ından gizlenir; mutfak geçişi ve hesaba tahsilat sunucuda engellenir. Garson onaylayabilir veya müşteriye görünen zorunlu açıklamayla reddedebilir. Onay mevcut değişiklik süresini kaldırmaz. Süre içinde düzenlenen onaylı sipariş, otomatik onay kapalıysa tekrar onaya düşer.
- Garsonun otomatik onay anahtarı işletme genelindedir, sürüm/işlem kimliği kontrolü ve audit kaydı vardır. Önceden bekleyenler otomatik kabul edilmez. Personelin girdiği sipariş onay beklemez. Bekleyen QR siparişleri popüler ürün/sipariş raporu adetlerine dahil edilmez.
- Kurulum sorularında fare, klavye ve dokunma ile açılan küçük gri bilgi düğmeleri var. Garson onayı ilk kurulum ve daha sonra Ayarlar ekranından değiştirilebilir. Gece QR yenileme iptal edildi; basılı QR değişmez.
- İşletme sahibi Masalar ve yönetim ekranlarını görür, Sipariş al ve Mutfak sekmelerini görmez. Önceki yönetici API yetkileri bu görsel düzenlemeden ayrı korunur. İptal talebi onayı işletme sahibinin Masa detayına taşındı. Kasiyer Masalar üzerinden ürün ekleme/tahsilat yapar; ayrı Sipariş al sekmesi yoktur.
- Garson ürün kodunu sayısal klavye isteyen alana girip doğrudan sepete ekler. Seçenekli ürün önce detay açar; tükenen/bulunmayan ürün açıklanır.
- Kasiyer pozitif nakit gider tutarı ve zorunlu açıklama kaydeder. Kaydeden kişi ve sunucu saati saklanır. Rapor giderleri ayrı eksi kalem olarak gösterir; satış ve tahsilat toplamları değiştirilmez. Nakit tahsilat eksi kayıtlı giderler, açılış bakiyesi içermeyen ayrı bir göstergedir.
- Ürün seçerek ödeme orderId/lineId/adet tahsislerini kaydeder. Aynı adet iki kez ödenemez, miktar/fiyat ve hesap sürümü sunucuda kontrol edilir. Eski tutar bazlı ödemesi olan hesaplarda ürün tahsisi belirsizdir; kalan ödeme tutar bazında alınır.
- İşletme sahibi/kasiyer iki açık hesabı birleştirir. Önceki ödemeler, dondurulmuş fiyatlar ve ürün bazlı ödeme tahsisleri korunur. Kaynak ve hedef QR oturumları geçersizleşir; QR görseli değişmez. Ayırma/geri alma bu aşamada yoktur.

## Yerel platform, lisans ve destek
- /platform işletme oturumundan ayrı, rastgele ilk şifreyle giriş yapar. Şifre hash'i şifreli yerel platform tablosundadır. İlk giriş dosyası .local/development/platform-first-login.txt içinde oluşturulur; finansal API'ye platform oturumuyla erişilemez.
- Ana panel işletme ve sahip hesabı açar, 1 ay/12 ay lisans verir, uzatır/askıya alır. Kalan gün hesaplanır; ay sonu ve artık yıl kuralları uygulanır. Lisans süresi bitince/askıya alınca yeni siparişler reddedilir, önceki kabul edilmiş siparişin idempotent tekrarı korunur. Mevcut hesap tahsilatı, rapor ve destek erişimi devam eder.
- Bu, aynı yerel sunucudaki çok işletmeli geliştirme modelidir. Ayrı işletme cihazları, merkezi HTTPS dağıtımı, işletme anahtarlarının platformdan ayrılması ve uçtan uca şifreleme tamamlanmış değildir. Ana panel finansal raporları döndürmez; bugünkü şifreleme sunucu işletmecisine karşı kriptografik finansal gizlilik garantisi sağlamaz.
- İşletme sahibi Destek sekmesinden talep açar/yanıtlar. Platform destek mesajı yazıp çözülmüş olarak kapatır. İşletmeler birbirinin taleplerini göremez. Talep olayları için e-posta/SMS kayıtları awaiting_configuration durumunda tutulur; hiçbir gerçek SMS/e-posta gönderilmez. Kullanıcı ücretli servisleri şimdilik erteledi.
- Üretim öncesi platform yönetici hesap/şifre yaşam döngüsü, ayrıntılı yetkiler, iletişim bilgisi/doğrulama, bildirim sağlayıcısı ve teslimat/yeniden deneme işçisi gereklidir.


## 20 Eylül 2026 — Menü, raporlar ve masa temizliği

- Satış ve Raporlar: Genel Mali Durum, Çalışanlar ve Ürünler. Ürün adet grafiği ayrı sekmede; tarih aralığı mali durum ile korunur.
- Ödeme dağılımına ekstra gider eklendi. Tahsilat özeti nakit + kart = toplam, toplam − POS komisyonu − gider = kalan olarak gösterilir; eksik komisyon varsa kesin kalan sunulmaz.
- Çalışan raporuna takvim ayına göre Son 6 ay ve Son 1 yıl eklendi.
- Alt kategori, kategoriyle aynı seçim görünümünde. Negatif seçenek farkı hem sunucuda hem müşterinin sepetinde uygulanır; tüm geçerli kombinasyonlarda birim fiyat en az 0,01 TL olmalıdır. Eski sipariş fiyatları korunur.
- Ürün bazlı ödeme: masa detayında ve ödeme listesinde “Ödendi” ya da ödenen adet görünür. Tam ödenen kalem tekrar seçilemez. Tutar bazlı ödeme herhangi bir ürüne keyfi atanmaz.
- Masa renkleri: boş beyaz, aktif sipariş bekleyen açık sarı, iptal edilmemiş tüm siparişleri teslim edilen açık yeşil. QR okutmak rengi değiştirmez.
- İsteğe bağlı temizlik takibi ilk kurulumdan veya Ayarlar'dan açılır. Hesap kapanınca/taşınınca/birleşince boşalan masa açık kırmızı olur; garson veya sahip “Temizlendi” ile açar. Temizlik bekleyen masaya yeni sipariş ve masa taşıma sunucuda engellenir. Ayarı kapatmak bekleyen masaları açar. Ödeme, bitmemiş mutfak işini silmez; temizlik işareti fiziksel doluluk sensörü değildir.
- Destek masaüstünde yan menünün altına, mobilde görünür sabit düğmeye alındı. Çalışan oluştururken görev yetkileri açıklanır. Bilgi kutuları ekran sınırlarına göre yerleşir.
- Şeffaf fotoğraflarda alfa korunur; açık nötr zemin kullanılır. Yeniden kırpmada önceki kare temizlenerek saydam bölgede iz kalması önlendi.


## 20 Eylül 2026 — Kesintisiz tahsilat, masa bölümleri, ödeme sırası

- Kısmi ödeme sonrası tahsilat penceresi açık kalır. Ödenen adetler ve kalan hesap yenilenir; seçim sıfırlanır, son para üstü pencere içinde gösterilir. Tam tahsilatta pencere kapanır. Yanıt kaybında aynı işlem kimliği ile tekrar kontrol edilir; kalan kayıtlar yenilenmeden yeni tahsilat açılamaz.
- İsteğe bağlı iç/dış masa sayıları kurulumda; masa eklerken bölüm seçimi ve mevcut masa detayından bölüm değişikliği. Masalar tek ekranda İç masalar / Dış masalar / gerekiyorsa Bölümsüz masalar başlıklarıyla grupludur. Mevcut QR ve masa numaraları korunur.
- Ödeme sırası kurulum ve Ayarlar'da: önce servis (eski varsayılan), veya önce ödeme. Tercih sipariş anında saklanır; mevcut siparişe geriye dönük uygulanmaz.
- Önce ödeme: sipariş normal garson onayı kuralından sonra mutfakta hemen görünür; hazırlanıyor ve teslim edildi geçişleri ödeme yoksa API'de de engellenir. Ödeme gelince mutfak düğmesi kendiliğinden açılır; mevcut değişiklik süresi ayrıca korunur.
- Bir siparişin tüm ürünleri seçilerek ödendiyse o sipariş hazırlanabilir; tutar bazlı kısmi ödemenin ürün dağılımı varsayılmaz. Daha sonra masaya yeni sipariş gelmesi, zaten ödenen siparişi yeniden kilitlemez.
- Önce ödeme siparişinde tam tahsilat tek başına hesabı/masayı kapatmaz. Teslimler tamamlanınca ve bakiye sıfırsa hesap bir kez arşivlenir; temizlik açıksa masa o zaman temizlik bekler. Önce servis modunun önceki kapanış davranışı korunur.
- Garsonun Servise hazır ekranı ödeme alınmış siparişleri de gösterir. Hazır → teslim edildi mutfak ve garson tarafından yapılabilir; garson diğer hazırlık aşamalarını değiştiremez. Sürüm kontrolü çift teslim işlemine engel olur.

## 20 Eylül 2026 — Kontrollü 30 günlük pilot lisans

- Ana panelde yeni işletme için 30 gün ücretsiz deneme, 1 aylık veya 1 yıllık abonelik seçilebilir. Eski lisanslar abonelik olarak okunur; mevcut bitiş tarihleri korunur.
- Deneme hesabı oluşturulunca süre başlamaz. İşletme sahibi ilk kurulumu ve menüyü hazırlayabilir; sipariş kabulü ana panelde Denemeyi başlat işleminden sonra açılır. Kurulum tamamlanmadan veya hizmet askıdayken başlatma API'de de reddedilir.
- Başlangıç sunucu saatiyle kaydedilir; tam 30 gün sonra yeni sipariş kapanır. Mevcut siparişin aynı işlem kimliğiyle tekrarı, tahsilat ve destek korunur. Deneme kendiliğinden ücretli aboneliğe dönüşmez.
- Başlatma yalnızca bir kez uygulanır; kaybolan yanıtın tekrarı süreyi uzatmaz. Başlatma ve aboneliğe geçiş denetim kaydındadır. Aboneliğe erken geçişte kalan deneme günlerinin sonuna satın alınan takvim ayları eklenir.
- Ana panel ve işletmenin Destek ekranı deneme/abonelik türünü, kalan günü ve bitişi gösterir. Ana panel formu mobilde tek sütundur.
- Doğrulama: 67 otomatik test; süre sonunun tam sınırı, yetki, ilk kurulum, tekrar başlatma, tahsilat ve erken dönüşüm kapsamda. Ayrı tarayıcı senaryosu masaüstü/mobil, kayıp başlatma yanıtı ve aboneliğe dönüşümü doğrular. Yerel geliştirme verilerine test kaydı eklenmez.

## Ticari ve görsel yön

- Yerel Elazığ hizmeti ve yüz yüze kurulum pilotta değerlendirilecek; 750 TL görüşmeler için fiyat varsayımıdır, kodda sabit ücret veya otomatik tahsilat tanımlanmadı.
- Fotoğraf aşamasında gerçek ürün/sunum referansları ve uygulamanın renkleriyle kullanılacak görsel üretim promptu hazırlanacak. Chatbot eklenmeyecek.
- Tanıtım/fiyatlandırma kitapçığı ve kullanım rehberi uygulama tamamlandıktan sonra hazırlanacak. Süresiz bağımsız kurulum, kaynak koruma ve bakım koşulları ayrı çalışma gerektirir.

## 20 Eylül 2026 — Askıda/süresi dolmuş işletmede müşteri menüsü

- Askı, lisans süresi sonu ve henüz başlatılmamış pilotta yeni QR oturumu ve mevcut müşteri menü API erişimi MENU_UNAVAILABLE ile reddedilir. Müşteriye lisans/borç ayrıntısı gösterilmez.
- Açık müşteri ekranı sonraki durum sorgusunda eski menü ve düzenleme penceresini kaldırır. Hizmet yeniden açıldığında mevcut oturum yenilenir; yeni QR açılışındaki hata ekranında Yeniden kontrol et vardır.
- Kamuya açık fotoğraf istekleri de lisans kontrolünden geçer. Aynı işletmenin yetkili personeli menü yönetimine devam eder. Fotoğraflarda private/no-cache ile yeniden doğrulama kullanılır; önceden indirilmiş veya eski uzun süreli önbelleğe alınmış dosyalar geriye dönük silinemez.
- Askıda siparişe yeni kalem ekleme/değişiklik engellenir; kabul edilmiş işlemin aynı kimlikle tekrar sorgulanması korunur. Mevcut tahsilat, personel yönetimi, raporlar ve destek açık kalır.
- 67 otomatik test ve pilot tarayıcı senaryosu geçti: yeni/mevcut QR, askı kaldırma, fotoğraf erişimi, süre sonu ve tahsilat kontrol edildi.
- Dondurma ayrı bir öneri olarak görüşülüyor; henüz eklenmedi. Askıya alma lisans süresini durdurmaz.

## 21 Eylül 2026 — Yıllık abonelikte hizmet dondurma

- İşletme sahibi Destek > Hizmeti dondurma bölümünden başlangıç tarihi, 1–60 gün ve zorunlu gerekçeyle talep gönderir. Aylık/pilot, süresi dolmuş veya askıdaki lisans talep oluşturamaz. Aynı anda tek bekleyen/planlanan işlem olabilir.
- Ana panel işletme kartında talebi onaylar veya gerekçeyle reddeder. Başlangıç önceki kullanılan dondurma başlangıcından en az 12 ay sonra olmalıdır; ret ve başlamadan iptal hakkı tüketmez. Erken açma kullanılmış hakkı sıfırlamaz.
- Bugünkü tarih için onay anında, ileri tarih için Türkiye saatiyle 00:00'da başlar. Geçmiş başlangıç talebi onaylanamaz; reddedilip yeni tarih istenir. Başlangıç aktif lisans bitmeden olmalıdır.
- Onayda bitiş tarihine dondurma süresi eklenir. Dondurma aralığında müşteri menüsü/fotoğraf erişimi ve yeni sipariş kapalıdır; kalan gün sabittir. Aralık bitince zaman kontrolüyle kendiliğinden açılır; zamanlayıcı işçisi veya yeniden başlatmada sıfırlanan sayaç kullanılmaz. Başka bir askı engeli varsa devam eder.
- Ana panel ileri tarihli dondurmayı iptal edebilir veya aktif dondurmayı erken bitirebilir. Kullanılmayan süre milisaniye hesabıyla lisans bitişinden düşülür. Normal askıya alma ayrı kalır ve lisans süresini durdurmaz.
- Talep/onay/ret/erken bitiş işlem kimliğiyle korunur ve denetim kaydı tutulur. İşletme başka işletmenin talebini veya platform onayını yönetemez. Gerçek SMS/e-posta yoktur.
- Önceki lisans kayıtlarında satın alınan ay bilgisi eski işlem kayıtlarından okunur; başlangıç demo yıllık lisansları korunur. Yeni alım/yenilemelerde 1/12 aylık plan bilgisi açıkça saklanır.
- Doğrulama: TypeScript kontrolü, build, 71 otomatik test ve genişletilmiş pilot tarayıcı testi başarılı. Testler 20 günlük lisansın 60 günlük dondurulması, tam başlangıç/bitiş sınırı, erken açma, ret/iptal, 12 ay limiti, kayıp onay yanıtı ve müşteri menüsünün kapanıp açılmasını kapsar.

## 21 Eylül 2026 — Yeni ürün taslağı ve yayınlama

- Yeni ürün ve mevcut taslak için Taslak kaydet düğmesi eklendi. Kod ve ad zorunlu; kategori/fiyat daha sonra tamamlanabilir. Eklenen seçeneklerde ad/fiyat farkı doğrulamaları korunur. Yayınlamak için kategori, pozitif fiyat ve tüm fiyat kombinasyonlarının geçerliliği gerekir.
- Menü yönetiminde Taslak/Yayında etiketleri gösterilir. Taslak düzenlenip Kaydet ve yayınla ile aynı ürün kimliği üzerinden yayınlanır. Tükendi ayrı bir durumdur. Eski ürünler yayınlanmış kabul edilir.
- Taslaklar müşteri, garson, kasiyer, mutfak ürün listesi, tam müşteri önizlemesi ve popüler ürünlerden çıkarılır. Sunucu doğrudan ürün kimliğiyle taslak siparişi kabul etmez. Taslağın tek ürün önizlemesi editörde kullanılabilir.
- Editör kayıtları işlem kimliğiyle tekrarlanabilir; kayıp yanıtta alanlar kilitlenir, Kaydı yeniden kontrol et aynı içeriği gönderir. Açıldığı andaki menü sürümü kullanılarak eski ekranın güncel değişiklikleri ezmesi engellenir.
- Yayındaki ürünün ayrı bir bekleyen düzenleme kopyasını tutma henüz yoktur; yayındaki ürünün düzenlemeleri Kaydet ve yayınla ile uygulanır. Taslak düğmesi yeni ürünlerde ve taslaklarda sunulur.
- Doğrulama: 72 otomatik test ve 12 tarayıcı testi geçti; derleme/tür kontrolü başarılı. 4x işlemci yavaşlatması/96 seçenek testinde girişten kareye P95 yaklaşık 6 ms. Kaybolan kayıt yanıtı, tek kayıt, taslak gizliliği ve yayın sonrası müşteri görünürlüğü doğrulandı.

## 21 Eylül 2026 — Yayındaki ürünün ayrı düzenleme taslağı

- Yayındaki ürünlerde Taslak kaydet artık ayrı productDrafts kaydını değiştirir; çalışan ve müşteri menüsü, sipariş fiyatları ve tam menü önizlemesi mevcut yayınla çalışır. Taslak verisi yalnızca owner snapshot'ına eklenir.
- Düzenle, varsa kayıtlı düzenleme taslağını açar. Güncel Tükendi durumu korunur. Kaydet ve yayınla aynı ürün kimliğine yeni içeriği uygular ve düzenleme taslağını temizler; geçmiş sipariş satırları değiştirilmez.
- Liste Yayında · Taslak değişiklik var etiketi gösterir. Taslak değişiklikleri sil, açık onayla yalnızca düzenleme taslağını kaldırır; canlı ürün korunur. Silme yetki/sürüm/işlem kimliği denetimlerine sahiptir.
- Ürün kodları taslaklar dahil ayrılmıştır; başka ürün aynı kodu alamaz. Kategori/alt kategori ad değişiklikleri düzenleme taslaklarına da uygulanır; taslağın kullandığı ana kategori silinemez.
- Mevcut Tükendi hızlı işlemi düzenleme taslağını silmez. Editördeki yayın işlemi açıkça publish eylemini gönderir.
- Doğrulama: 72 otomatik test; taslak içeriğinin personel/müşteriye sızmaması, canlı fiyatın korunması, yayın ve silmenin idempotent tekrarı. Tür kontrolü/build ve taslak/performance tarayıcı testleri başarılı.

## 21 Eylül 2026 — Yüzde kampanyaları

- İşletme sahibine Kampanyalar sekmesi eklendi. Yayındaki ürün seçimi, %1–90 tam sayı indirim, Türkiye saatinde başlangıç/bitiş, süresiz, etkin/pasif ve birleşme tercihi var.
- İndirim boy/süt vb. seçenekler dahil birim tutara uygulanır. Birleşmeye izinli kampanyalar sabit kimlik sırasıyla art arda hesaplanır; her adım kuruşa yuvarlanır. Birleşmeyen teklifler ayrı hesaplanır, birleşik sonuç veya tek tekliften düşük fiyat seçilir. Birim tutar en az 1 kuruştur.
- Tek paylaşılan hesaplayıcı müşteri kartı, ürün detayları, sepet, garson/kasiyer siparişi, sipariş düzenleme ve sunucuda kullanılır. Sunucu kendi saatine göre uygun kampanyaları seçer; başlangıç dahil, bitiş hariçtir. Sınır anında eski toplamla gönderilen sipariş fiyat değişti yanıtıyla reddedilir.
- Kabul edilmiş sipariş satırında indirimsiz birim fiyat ve uygulanan kampanya ad/kimliği saklanır. Sonraki kampanya/ürün değişiklikleri geçmiş satır tutarını değiştirmez. Sipariş değişikliğinde mevcut fiyatı koruma kuralı devam eder. Mutfak sipariş yanıtına indirimsiz mali tutar gönderilmez.
- Kampanya yazma yalnızca owner; işletme sınırı, menü sürümü ve işlem kimliği ile korunur. Kaybolan yanıtta aynı kayıt tekrar sorgulanır. Denetim kaydı tutulur.
- Kapsam sınırı: Bu aşama yüzde kampanyasıdır. Sabit TL indirimi, adet eşikleri, iki ürün paket fiyatı ve farklı kampanya türlerini birleştirme henüz yoktur. Nakit ödemeye özel kampanya eklenmedi.
- Doğrulama: Tür kontrolü/build, kampanya hesaplama ve HTTP yetki/tarih/idempotence testleri. Mobil tarayıcıda kampanya kaydı (yanıt kaybı dahil), müşteri sepeti, 35 TL → 28 TL gerçek sipariş, kampanya kapatılması ve eski fiyatın korunması başarılı.

## 21 Eylül: Kampanya seçimi ve performans raporları
- Kampanyalar için ayrı etiket simgesi; ürünler menü kartlarından seçilir. Son 30 günün çok satanları, ürün kodu/isim araması ve kategori filtreleri bulunur. Müşteri menüsünde Kampanyalı ürünler filtresi vardır.
- Owner raporlarında Kampanyalar sekmesi: kampanya sürüm dönemleri, önceki 7 günün aynı ürünleri, adet/gün karşılaştırması, değişim oranı, uygulanan indirim ve indirimli sipariş tutarı. Bir günden kısa dönemlerde oran/ortalama gösterilmez. İptal ve onay bekleyenler hariç, tahsil edilmemişler dahil; nedensellik iddiası yoktur.
- Kampanya düzenlenince eski dönem korunur; yeni siparişler kampanya rapor sürümünü taşır. Eski kayıtlarda gerçek etkinleştirme zamanı bulunmadığında tanımlı başlangıç kullanılır.
- Genel mali durumda kampanyalı, diğer ve ayrıştırılamayan tahsilatlar ayrı gösterilir. Ürün seçimi veya kesin hesap bilgisiyle ödeme anında atama yapılır. Karma, tutar bazlı kısmi ödeme tahminle paylaştırılmaz. Birleşik kampanyalı satırlar genel toplamda bir kez sayılır.
- Kart grafiğinde bilinen net yeşil, POS kesintisi yumuşak toprak tonu, komisyonu bilinmeyen kısım çizgili gösterilir; erişilebilir açıklama ve tutarlar bulunur.
- Doğrulama: tür kontrolü, üretim derlemesi, 79 otomatik test ve kampanya uçtan uca tarayıcı testi başarılı. Mobil seçim/rapor, gerçek kart ödemesi, POS grafiği ve mutfak rapor yetkisi kontrol edildi.

## 21 Eylül: İşletme ekranlarında görsel sadeleştirme
- Ödeme dağılımındaki gider yüzdesi kaldırıldı; kâr açıklaması kartın bilgi kutusuna taşındı.
- Mali özetler hizalı iki sütunlu kartlara ayrıldı; kalan tutar vurgulandı. Mobilde tek sütun, açıklamalar ilgili kartların altında.
- Çalışan pasta grafikleri geniş ekranda yan yana; tekrar eden çubuk grafikler kaldırıldı, sayısal ayrıntılar kartlarda korundu.
- Ürün raporları fotoğraf, isim, adet ve sipariş tutarı içeren küçük kartlara dönüştü. Tutarın tahsilat/kâr olmadığı açıklaması korundu.
- Kampanya listesi ürün görselleriyle uyarlanabilir kartlara, kampanya raporları ortak kart düzenine alındı.
- Menü önizleme, kategori yönetimi ve ürün ekleme tek araç çubuğunda. Ürün formunda ad önde; ek seçenekler ve diğer bilgiler açılır bölümlerde. Mevcut ürünün seçenekleri düzenlemede açık gelir. Mobilde temel alanlar tek sütun.
- Ayarlar sipariş akışı, masa/onay, değişiklik süresi ve kart tahsilatı olarak gruplandı.
- Tür kontrolü ve derleme başarılı. İlgili 21 tarayıcı testi geçti. 1440, 768 ve 390 piksel genişliklerde görüntü/taşma kontrolü yapıldı. Yerel işletme kayıtları görsel kontrol sırasında değiştirilmedi.

## 21 Eylül: Menü odaklı kompakt çalışma alanı
- Kullanıcı tercihi: işletme arayüzünde sadelik, kolay tarama ve kompakt düzen; yalnızca düğmeleri taşımak yeterli değil. Sık kullanılan işlem sol başta, ileri ayrıntılar gerektiğinde açılır. Kampanya yönetiminin beğenilen kart görünümü korundu.
- Menü yönetimi bağımsız MenuManagement bileşenine taşındı: Ürün ekle sol başta, yanında kategoriler/önizleme; arama, kategori ve yayında/taslak/tükendi filtreleri aynı yüzeyde. Fiyat, durum ve düzenleme kontrolleri hizalı satırlarda. Filtre boş sonucu ve temizleme işlemi eklendi.
- Ürün formu: geniş ekranda temel alanlar ve fotoğraf yan yana; mobilde tek akış. İç bölüm kaydırılırken alt kaydet/önizleme düğmeleri sabit görünür. Uzun eksik alan listesi özetlenir, tamamı odaklanabilir kaydet ipucunda bulunur. Yeni ürün fiyatı boş başlar; zorunlu kategori seçimi korunur.
- Ayarlar SettingsPanel bileşenine taşındı: açıklama/kontrol hizalı satırlar, açık/kapalı anahtarları, kaydedilmemiş değişiklik göstergesi; engellenen tarayıcılar sayaçlı açılır bölüm.
- Raporlar: ortak ReportPeriod araç çubuğu, seçili dönem vurgusu, açılır özel tarihler; temel rakamlar/grafikler önde, hesaplama açıklamaları bilgi kutularında. Kalan kartı komisyon ve kayıtlı giderler sonrasını gösterir. Finansal hesap/API kuralları değişmedi.
- 1440/768/390 pikselde menü, ayarlar ve tüm rapor sekmelerinin görüntüleri incelendi; 320×568 ekranda seçenek düzenleme ve kaydet düğmesinin erişimi ayrıca kontrol edildi. Yerel işletme verileri görsel kontrollerde değiştirilmedi.
- Doğrulama: tür kontrolü ve üretim derlemesi başarılı; ilgili 23 tarayıcı testi geçti. 96 seçenekli formda 4× işlemci yavaşlatmasıyla ölçülen girişten sonraki kare süresi p95 9 ms (yerel otomatik ölçüm; saha performans garantisi değildir). Yeni menü filtreleri, taslak/yayın akışı, fotoğraf düzenleme, ayar kaydı ve rapor erişimi doğrulandı.

## 21 Eylül: Taslağa alma ve eksik komisyon gösterimi
- Kullanıcının yeni kararı önceki ayrı düzenleme taslağı arayüzünün yerini alır: yayındaki üründe ikincil işlem artık açıkça **Taslağa al**. Ürün müşteri/garson kataloğundan kaldırılır; düzenlenen içerik aynı ürün kimliğiyle taslakta kalır. Mevcut sipariş satırları ve fiyatları korunur. Yeni üründe **Taslak kaydet** devam eder.
- Sunucuda owner yetkili, sürüm ve işlem kimliği denetimli `unpublish` eylemi eklendi; kayıp yanıt sonrası aynı işlem güvenle yeniden kontrol edilir. Eski `draft` API davranışı eski istemciler için korunur, yeni arayüz bunu yayındaki ürünlerde kullanmaz. Mevcut canlı ürünler kendiliğinden taslağa çevrilmez.
- Menü aramasının odak çizgisi simge, yazı ve temizleme düğmesini kapsayan dış kutuya taşındı; iç input üzerindeki ikinci çizgi kaldırıldı.
- Komisyonu kayıtsız eski kart ödemelerinde kesin kalan hâlâ hesaplanamaz. Arayüz toplam tahsilattan bilinen komisyon ve kayıtlı giderleri çıkararak **Geçici kalan** gösterir; eksik kesintilerin düşülmediğini belirtir. Güncel oran geçmişe uygulanmaz. Eksik/bozuk eski komisyon değerleri bilinmeyen kabul edilir; kayıtlı sıfır komisyon geçerlidir.
- Doğrulama: tür kontrolü, üretim derlemesi ve 80 otomatik test başarılı. İlgili iki tarayıcı testi geçti; taslak/yayın, kayıp yanıt, mevcut sipariş fiyatı ve kampanya/rapor akışı kontrol edildi. Gerçek yerel veriler değiştirilmeden 1440 ve 390 pikselde odak çizgisi ve geçici kalan doğrulandı; yatay sayfa taşması yok. Yerel sunucu güncel kodla yeniden başlatıldı.

## 21 Eylül: Sabit TL kampanyaları
- Kampanya formuna Yüzde indirimi / Tutar indirimi seçimi eklendi. TL tutarı virgül veya noktayla, en fazla iki ondalık basamakla girilebilir. Sunucu yalnızca pozitif tam kuruş kabul eder; yüzde ve TL alanlarının birlikte gönderilmesini reddeder. Eski tür alanı bulunmayan yüzde kayıtları korunur.
- TL indirimi, boy/süt gibi seçenekler dahil her bir ürün adedinden düşer; sepet toplamından tek defa düşülmez. Müşteri, garson, kasiyer, sipariş düzenleme ve sunucu aynı fiyat hesaplayıcısını kullanır. Fiyat alt sınırı mevcut kurala uygun 1 kuruştur.
- Birleşmeye açık tekliflerde önce yüzdeler, ardından TL tutarları uygulanır. Tür içinde kimlik sırası deterministiktir. Birleşmeyen her teklif ve birleşik sonuç karşılaştırılır, düşük fiyat seçilir. Örnek: 100 TL → %10 → 90 TL → 20 TL indirim → 70 TL.
- Kampanya kartları ve rapor dönemi seçimi indirim türünü/tutarını gösterir. Tür değişikliği yeni rapor sürümü oluşturur; eski sipariş fiyatları, kampanya bilgileri, tahsilat atamaları ve önceki rapor dönemi değişmez.
- Doğrulama: tür kontrolü ve derleme başarılı; 83 otomatik test geçti. İlgili iki tarayıcı senaryosu başarılı: yüzde kampanyasını TL'ye çevirme, geçersiz tutarlar, kayıp kayıt yanıtından güvenli tekrar, 35 TL üründe 10,25 TL indirim, 2 adet için 49,50 TL sipariş/tahsilat, 20,50 TL rapor indirimi ve eski siparişin korunması. Mobil form/rapor görüntüleri incelendi.
- Adet eşikleri, iki ürün paket fiyatı ve ücretsiz ürün kampanyası bu aşamaya dahil değildir. Gerçek işletme verileri test amacıyla değiştirilmedi.

## 21 Eylül: Adet koşullu yüzde / TL kampanyaları
- Formdaki isteğe bağlı **Adet koşulu ekle → En az kaç adet?** ile 2–20 adet eşiği seçilir. Eski kampanyalar koşulsuz devam eder. Sunucu geçersiz adetleri reddeder; sürüm, işletme yetkisi ve yinelenme koruması devam eder.
- Aynı siparişte aynı ürünün farklı seçenek/satır adetleri toplanır. Koşul sağlanınca o ürünün tüm adetlerine indirim uygulanır; farklı ürünler, ayrı siparişler veya aynı masadaki farklı müşteriler birleştirilmez. Koşulu sağlamayan teklif birleşik indirim hesabına girmez.
- Menü kartında adet kampanyası işareti, detayda eşik ve kapsam açıklaması var. Ürün penceresi sepetteki aynı ürünleri hesaba katar; sepetten ürün çıkarıldığında kalan ürünlerin indirimi yeniden hesaplanır. Müşteri, garson ve kasiyer aynı hesaplayıcıyı kullanır.
- Adet kampanyası mevcutken sipariş satırına fiyat ve aktif teklif koşullarının kopyası yazılır (henüz eşik sağlanmasa da). Seçenekleri değişmeyen satırlar, değişiklik süresi içinde kayıtlı koşullar ve yeni toplam adetle hesaplanır. Adet sınırı altına inilince eski kampanyalı fiyatla sipariş tutma engellenir; sonra tekrar artırmada kayıtlı kampanya geçerlidir. Seçenek değişikliği/yeni ürün güncel koşullarla hesaplanır. Eski, koşulsuz satırların birim fiyat koruma davranışı değişmedi.
- Ödeme girilmiş hesaptaki sipariş değiştirme yasağı korunur. Mutfak sipariş yanıtında yeni fiyat/teklif kopyası gizlenir. Raporlar kampanya eşiğini dönem bilgisiyle birlikte taşır ve gerçek uygulanan indirim/tahsilatı kullanır.
- Doğrulama: tür kontrolü ve derleme; 87 otomatik test başarılı. İlgili tarayıcı paketinde 11 senaryo geçti; yeni adet testinin geçmiş siparişleri seçen test verisi düzeltildikten sonra o senaryo da geçti (toplam 12 senaryo doğrulandı). Mobil form/ürün/sipariş düzenleme görüntüleri incelendi. 35 TL çaydan iki adet için 50 TL; bire düşürmede 35 TL; kampanya kapatıldıktan sonra eski siparişte tekrar iki adette 50 TL ve 20 TL rapor indirimi doğrulandı.
- Sabit paket fiyatı, yalnız ikinci adede indirim ve ücretsiz ürün henüz kapsamda değildir. Yerel işletme verileri test için değiştirilmedi.

## 21 Eylül — Kampanyanın toplam adet sınırı
- Kampanya formuna isteğe bağlı **Toplam adet sınırı koy** eklendi; başlangıç değeri 50. Bu, minimum alım koşulundan ayrıdır: kampanyadaki bütün ürünler/masalar/siparişler ortak kontenjanı tüketir. Yüzde, TL ve minimum adet kampanyalarıyla çalışır.
- Kabul edilen siparişte indirim gerçekten uygulanmış adetler sayılır; garson onayı bekleyenler yer ayırır. İptal, ret ve adet azaltma kontenjanı geri açar; iptal isteği henüz onaylanmadıysa adet ayrılmış kalır. Ödeme zamanı tüketimi değiştirmez. Canlı/arşiv aynı sipariş kimliği bir kez sayılır; diskten yeniden açılınca kullanım korunur.
- Kontenjan ve fiyat sunucu işlemi içinde denetlenir. Son adet için eşzamanlı iki istekten yalnız biri indirimle kabul edilir. Kalan adetten fazla kampanyalı ürün istenirse bütün gönderim açıklamayla reddedilir; kısmi indirim veya sessizce normal fiyat uygulanmaz. Tükenen kampanyanın eski fiyatıyla gönderim PRICE_CHANGED ile reddedilir; güncel menü normal fiyatı gösterir.
- Kampanya düzenleme sayacı sıfırlamaz; kimlik bazında önceki sürümlerin kullanımı devam eder. Sınır kullanılan adedin veya minimum alım adedinin altına indirilemez. Eski istemcinin sınır alanını göndermemesi sınırı kaldırmaz; açık null kaldırır. Yeni kampanya ayrı kimlikle başlar.
- Panelde kullanılan/toplam, kalan adet, ilerleme çubuğu ve **Adet sınırı doldu** durumu var; açık sekmede 5 saniyede yenilenir. Minimum alım koşulunu karşılamayan son kontenjan ayrıca açıklanır. Müşteri detayında kampanyanın kalan ortak adedi gösterilir; sipariş kabulünde yeniden doğrulanır. Raporda kontenjanı dolan güncel kampanya devam ediyor diye işaretlenmez; dönem karşılaştırması tanımlı tarih aralığını kullanır.
- Doğrulama: 93 otomatik test, tür kontrolü ve derleme başarılı. Üç ilgili tarayıcı senaryosu birlikte geçti. Tam 50 adette durma, 51. ürüne eski fiyatın reddi, eşzamanlı son adet, farklı ürün/satırlarda ortak sınır, arşivde tek sayım, eski siparişi artırarak sınırı aşamama, iptal/azaltma, limit güncelleme ve eski yüzde/TL/adet akışları kontrol edildi. Mobil form ve dolan sayaç görüntüleri incelendi.

## 21 Eylül: QR siparişi gönderimini yenilemeden sonra kurtarma
- Gönderimden önce requestId, istek içeriği, gönderilen toplam ve küçük ürün/seçenek etiketleri QR yoluna göre sekmenin sessionStorage alanına kaydedilir. Yetkilendirme oturum anahtarı veya fotoğraf saklanmaz. Sadece devam eden gönderim tutulur; tamamlandığında veya sunucu kesin reddettiğinde temizlenir. Geç gelen eski yanıt yeni kaydı silemez.
- Yenilemeden sonra sepet, gönderim anındaki içerikle ve **Gönderimi yeniden kontrol et** düğmesiyle geri açılır. Sonuç belirsizken içerik değiştirilmez; aynı kimlik ve aynı gövde tekrar gönderilir. Menüde fiyat değişmesi veya ürünün yayından kaldırılması kontrol ekranını bozmaz.
- Sunucunun verdiği guestContext, işletme + tarayıcı + masa + masa oturumu sürümüne bağlıdır. Yeni gönderimde doğrulanır; çerez değişimi veya yeni masa hesabında eski istek yeniden sipariş oluşturamaz. Aynı tarayıcının daha önce kabul edilmiş isteği, hesap kapansa dahi mevcut idempotence sonucuyla cevaplanır.
- Bağlam değiştiğinde yeniden gönderim engellenir; kullanıcı işletmeyle kontrol ettikten sonra bekleyen kaydı kapatabilir. Bu düğme sipariş oluşturmaz veya siparişi iptal etmez. Depolama engelliyse mevcut sayfadaki tekrar korunur ve sayfayı açık tutma bilgisi gösterilir. Bozuk kayıtlar çalıştırılmaz.
- Kapsam: müşteri QR siparişi ve aynı sekmede yenileme/menüye geri dönme. Sekmeyi kapatma, başka cihazdan devam etme, kasa tahsilatı ve sipariş düzenleme henüz bu istemci kaydına dahil değildir. İnternet olmadan sipariş kabulü eklenmedi.
- Doğrulama: tür kontrolü, derleme ve 96 otomatik test başarılı. Mevcut 10 müşteri/mutfak tarayıcı senaryosu geçti. Üç yeni kurtarma senaryosu doğrulandı: kabulden sonra yanıt kaybı + ürün yayından kaldırma + hesap kapatma + yenileme; kabulden önce bağlantı kaybı + aynı istekle tek kabul; çerez değişiminde eski gönderimin reddi ve sıfır yeni sipariş. Testlerin tekrar giriş hız sınırına takılması ortak test oturumuyla giderildi. Mobil kurtarma görüntüsü incelendi.


## 21 Eylül: Tahsilatı yenileme sonrasında kurtarma
- İşletme sahibi ve kasiyer ödeme gönderiminden önce aynı sekmenin sessionStorage alanına işlem kimliği, hesap kimliği/sürümü, yöntem, kuruş cinsinden tutar/alınan para ve varsa seçilen kalemleri kaydeder. Yalnızca belirsiz gönderim ve küçük masa/hesap özeti saklanır; şifre, oturum anahtarı ve ürün fotoğrafı tutulmaz.
- Kimlik kapsamı sunucuda işletme + çalışan kimliğinden üretilir. Bekleyen kayıt farklı çalışan/işletme hesabında gösterilmez; yanlış hesapla gönderildiğinde API reddeder. Garson ve mutfak bu alanı almaz. Aynı çalışan yeniden giriş yaptığında kayıt geri gelir. Hash bir yetkilendirme anahtarı değildir; mevcut oturum/rol doğrulaması aynen uygulanır.
- Sayfa yenilenince **Tahsilat kontrolü** açılır. Gönderim öncesinde kaydedilmiş özgün gövde aynı işlem kimliğiyle kontrol edilir. Önceden kabul edilen tahsilat hesap kapansa bile mevcut sonucu döndürür. Henüz sunucuya ulaşmamış istek hesap sürümü uygunsa bir kez kaydedilir; başka kasadan hesap değiştiyse açıklamayla reddedilir.
- Masa anketle yenilendiğinde kapanan hesabın ödeme penceresi kaybolmaz; yanıt belirsizse eski işlem kontrol edilebilir. Kontrol ekranında eski tutarın güncel borç sanılmaması için başlık **Nakit tahsilat/Kart tahsilatı**dır. Kısmi ödeme sonrası aynı pencere kalan ürünlerle devam eder; yalnız tam ödeme sonucunda kapanır.
- Başarılı sonuç veya kesin alan/hesap reddi geçici kaydı siler. Bağlantı, kimlik doğrulama, hız sınırı ve belirsiz hatalar aynı isteği korur. Eski yanıt yeni gönderimi silemez. Bozuk kayıt yürütülmez; depolama kapalıysa sayfayı açık tutma açıklamasıyla bellek içi kontrol sürer. Sonucu belirsizken kapatma düğmesi gösterilmez; yeni tahsilat başlatılmaz.
- Kapsam aynı sekmede yenilemedir. Sekme kapatma, tarayıcı depolamasını silme veya cihaz değiştirme için kurtarma garantisi verilmez. Nakit/kart tahsilat kaydı tutulur; banka/POS cihazından gerçek çekim yapılmaz.
- Doğrulama: tür kontrolü, üretim derlemesi ve **99 birim/API testi** başarılı. **6 ilgili tarayıcı testi** geçti: mevcut kısmi ödeme ve ödeme öncesi hazırlık kilidi; tam tahsilatın yanıtı kaybolup hesap kapandıktan sonra yenileme; ürün seçerek kısmi ödeme + yenileme + kalan ürünlerin ödenmesi; hiç ulaşmamış isteğin çalışan değiştirilerek korunması; başka kasadan değişen hesapta eski isteğin reddi. Özgün gövde, para üstü, kayıt temizliği ve 390 px taşma kontrolü doğrulandı. Mobil görünüm incelendi; gerçek geliştirme verilerine test siparişi/tahsilatı eklenmedi.


## 21 Eylül: Müşteri sipariş değişikliğini yenilemeden sonra kurtarma
- Kaydet düğmesiyle gönderilen değişiklik, gönderilmeden önce QR bağlantısına göre sekmenin sessionStorage alanına yazılır. Özgün requestId, sipariş/sürüm kimliği, eski kalem kimlikleri, seçenekler, adetler, gönderilen toplam ve küçük ürün etiketleri korunur. Henüz gönderilmemiş düzenlemeler taslak olarak saklanmaz; şifre, oturum anahtarı ve fotoğraf kaydedilmez.
- Bağlantı yanıtı alınamazsa **Değişiklik kontrolü** açılır. Aynı sekmede yenileme sonrası da bu ekran geri gelir; güncel menü veya açık sipariş listesine bağlı kalmadan gönderilen toplam gösterilir. Aynı gövdeyle kontrol edilir; kabul edilmiş değişiklik tekrar uygulanmaz. Sonuç kesinleşmeden yeni düzenleme başlatılmaz.
- API'de işletme/tarayıcı/masa/masa oturumu bağlamı yeni değişiklik öncesinde doğrulanır. Önceden kabul edilmiş aynı istek, süre geçse ve hesap kapansa bile kayıtlı sonucunu döndürür. Kabul edilmemiş istek süresi dolmuşsa reddedilir. Yeni tarayıcı/masa oturumunda eski istek uygulanmaz; kullanıcı işletmeyle kontrol ettikten sonra geçici kaydı kapatabilir. Bu kapatma siparişi değiştirmez veya iptal etmez.
- Kesin alan/fiyat/süre/hesap reddinde geçici kayıt temizlenir ve siparişe dönme sağlanır. Bağlantı, giriş süresi, hız sınırı ve belirsiz yanıtlar özgün kaydı korur. Oturum geçersizse kaydı koruyarak oturumu yenileme düğmesi vardır. Depolama kapalıysa sayfayı açık tutma bilgisiyle bellek içi kontrol sürer. Kapsam aynı sekmede yenilemedir; sekme kapatma veya depolama temizleme için kurtarma garantisi yoktur.
- Türkçe/İngilizce kontrol metinleri eklendi. Mevcut sade modal bileşeni kullanıldı; 390 px mobil ekran incelendi, yatay taşma yok.
- Doğrulama: **103 birim/API testi**, tür kontrolü ve derleme başarılı. **6 ilgili tarayıcı senaryosu** geçti: kaydedilen değişikliğin yanıtı kaybolup ödeme ile hesap kapandıktan sonra yenileme; hiç ulaşmamış değişikliğin süre içinde bir kez uygulanması; süresi dolan değişikliğin reddi; tarayıcı kimliği değişince reddi; mevcut adet/seçenek/ürün ekleme ve kayıp yanıt akışı; adet kampanyasıyla sipariş düzenleme, ödeme ve raporlama. Özgün gövde/sürüm, geçici kayıt temizliği, süre uzamaması ve denetim kaydının bir kez oluşması kontrol edildi. Gerçek yerel işletme verileri test için değiştirilmedi.


## 21 Eylül: Müşteri iptal talebini yenilemeden sonra kurtarma
- İptal düğmesine basıldığında özgün işlem kimliği, sipariş kimliği/sürümü ve masa/tarayıcı bağlamı QR bağlantısına göre sessionStorage alanına kaydedilir. İlk tıklamada istek hemen gönderilir; ek onay adımı yoktur. Yanıt kaybolursa aynı sekmede yenileme sonrasında iptal kontrolü açılır, yeniden gönderimde aynı kimlik ve gövde kullanılır.
- Sunucu kayıtlı sonucu aynı talep için tekrar döndürür. Hesap kapansa ve iptal edilmiş sipariş aktif listeden çıksa bile sonuç alınabilir. Yeni tarayıcı veya masa oturumunda kabul edilmemiş eski talep uygulanmaz; kullanıcı işletmeyle kontrol ettikten sonra yalnız geçici kaydı kapatabilir.
- Sonuçlar ayrıdır: doğrudan iptal için **Siparişiniz iptal edildi**; işletme onayı gereken durumda **İptal talebiniz işletmeye iletildi**. Talep, iptal edilmiş sipariş olarak sunulmaz. Hiç ulaşmamış bir talep süre dolduktan sonra yeniden denenirse mevcut kural gereği onaya gider; süreyi aşarak otomatik iptal sağlamaz. Onay bekleyen siparişlerin mevcut otomatik iptal kuralı korunur.
- Sonuç belirsizken pencere kapanmaz; yeni iptal veya düzenleme başlatılmaz. Kesin ret geçici kaydı siler ve siparişe dönmeyi sağlar. Oturum süresi, bağlantı ve belirsiz hatalar özgün kaydı korur. Depolama engelliyse sayfayı açık tutma bilgisiyle bellek içi kontrol sürer. Şifre/oturum anahtarı saklanmaz; sekme kapatma veya depolama temizleme sonrası garanti verilmez.
- Doğrulama: **106 birim/API testi**, tür kontrolü ve derleme başarılı. Dört yeni iptal tarayıcı senaryosu geçti: doğrudan iptal + kapanmış hesap + yanıt kaybı + yenileme; onaya giden talebin yenilemede tek kalması; hiç ulaşmayan talebin süre sonrası onaya gitmesi; tarayıcı kimliği değişiminin reddi. Dört mevcut sipariş değişikliği kurtarma testi de geçti. Bir testte kapanan iptal siparişinin aktif listede kalacağı varsayımı düzeltildi; uygulamanın aktif/arşiv ayrımı değiştirilmedi. Mobil ekran incelendi, yatay taşma yok. Test verileri izole ortamdadır.


## 21 Eylül: Fotoğraf depolama sınırı ve yarım yükleme koruması
- Yerel sunucuda işletme başına 500 MiB varsayılan fotoğraf sınırı eklendi (PHOTO_QUOTA_BYTES). Büyük WebP, 320 px küçük fotoğraf, özel yeniden düzenleme kaynağı ve kırpma JSON'u gerçek disk boyutlarıyla birlikte sayılır. Diğer işletmenin kullanımı bu sınıra dahil edilmez. Bu bir fiyatlandırma/lisans paketi değildir; merkezi paket ayarı henüz yapılmadı.
- Aynı işletmenin fotoğraf hazırlama/kota kontrolü/yazma işleri sıraya alınır. Aynı anda gelen iki yükleme son boş alanı birlikte tüketemez. Süreç genelinde kabul edilen hazırlama işleri sekizle sınırlıdır; fazlasına tekrar deneme açıklaması döner. Bu kilit tek Node süreci kapsamındadır; çok işlemcili sunucuda ortak kilit/depolama hizmeti ayrıca gerekir.
- Dosyalar wx bayrağıyla oluşturulur. Yazma sırasında hata olursa yalnız bu yüklemenin gerçekten oluşturduğu dosyalar kaldırılır; önceki ürün/taslak fotoğrafları silinmez. ENOSPC/EDQUOT için anlaşılır boş alan açıklaması döner. Temizlik başarısızsa destek kontrolü gerektiği belirtilir. İşlem ani güç/süreç kesintisinde try/catch çalıştıramayacağından bu durum için kurtarma taraması ileriki kapsamdadır.
- Kota dolunca ürün/kırpma formu korunur; mevcut arayüzde açıklama gösterilir. Kaynak ve küçük görsel aynı sınıra dahil olduğundan yalnız müşteri fotoğrafı boyutuna bakılarak alan aşılmaz. Şeffaf arka plan korunur; mevcut WebP boyut/kalite ayarları değişmez.
- Kullanılmayan eski yüklemeler otomatik silinmez; ürün ve taslak referanslarını koruyan temizlik ve yedekleme henüz yapılmadı. Kullanım hesabı yükleme sırasında diskten alınır; büyük arşivlerde indeksleme sonraki optimizasyon adımıdır.
- Doğrulama: tür kontrolü ve **108 birim/API testi** geçti. Sınırın son alanına iki eşzamanlı yükleme, kaynak+küçük görsel+metadata toplamı, işletme izolasyonu, şeffaflık ve yol doğrulaması test edildi. Disk dolması ikinci dosyayı açarken simüle edildi: ilk yarım dosya temizlendi, önceki fotoğraflar aynı kaldı, sonraki yükleme çalıştı. Fotoğraf kırpma/yeniden düzenleme/müşteri önizlemesi tarayıcı senaryosu geçti; kota hatası API yanıtı simülasyonunda form ve kırpma korunup başarılı tekrar yapılabildi. Gerçek işletme verileri test için değiştirilmedi.


## 21 Eylül: Fotoğraf alanını salt okunur inceleme
- İşletme sahibinin Ayarlar ekranına kapalı başlayan Fotoğraf alanı bölümü eklendi. Kullanılan/toplam alan, ürünlerde kullanılan fotoğraf grupları, son yedi günlük yeni yüklemeler ve hiçbir ürün/taslakta olmayan eski gruplar gösterilir. Küçük dosyalar KB cinsinden gösterilir. Bölüm ilk açıldığında veya yeniden kontrol düğmesine basıldığında tarar; periyodik panel sorgularında disk taraması yapmaz.
- Aynı fotoğrafın büyük/küçük sürümü, kaynağı ve kırpma bilgisi tek grup sayılır. Yayındaki, tükenmiş, yayından kaldırılmış ürünler ve ayrı düzenleme taslakları referans olarak korunur. Grubun herhangi bir dosyası yeni ise grup yeni sayılır. Tanınmayan dosyaların boyutu toplam kullanıma dahil, sınıflandırma dışında tutulur. Sembolik dosya bağlantıları izlenmez.
- API yalnız işletme sahibine açıktır, işletme kimliği oturumdan alınır; dosya yolları veya ürün isimleri dışarı verilmez. Ürün/taslak referansları tarama sonunda yeniden okunur. Bu salt okunur bir özet olduğundan devam eden yüklemelerde sonraki kontrolde güncellenebilir; silme için tek başına yetki veya güvenli işlem listesi değildir.
- Hiçbir dosya silinmez veya taşınmaz. Son yedi günlük yüklemeler kaydedilmemiş formlara ait olabileceğinden ayrı tutulur; ilerideki temizleme işlemi öncesinde güncel referans kontrolü, geri alma ve kayıt akışı ayrıca geliştirilecektir.
- Doğrulama: 110 birim/API testi, tür kontrolü ve derleme başarılı. Yayındaki/gizli/taslak referanslar, çok dosyalı grubun yeni kaynak dosyası, eski kullanılmayan fotoğraf, bilinmeyen dosya, başka işletme, yol sınırı ve tarama sonundaki güncel referanslar test edildi. Mobil tarayıcı testinde dosyalar ve kaydedilmemiş ayar değeri korundu, yatay taşma yok. Gerçek işletme verileri test amaçlı değiştirilmedi.

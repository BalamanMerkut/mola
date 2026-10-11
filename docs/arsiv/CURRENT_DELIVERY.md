# Ana panel ve pilot hazırlığı — 26 Eylül 2026

## Tamamlanan yerel işler

1. Ana panelden temiz kafe şablonuyla işletme, sahip hesabı, deneme/aylık/yıllık lisans açılması. İsim ve optimize logo düzenlemesi; müşteri menüsüne ve işletme paneline yansıması. Eski düzenlemeler sürüm kontrolüyle reddedilir.
2. Hesap oluşturma, sahibin ilk girişi, ilk kurulum ve deneme başlangıcının takibi. Eski kayıtlara uydurma tarih eklenmez.
3. Sahibe son 7 gün, süre dolması, askı ve dondurma uyarıları. Müşteri menüsü ve yeni sipariş kısıtları sunucuda uygulanır; mevcut tahsilat ve destek korunur.
4. Son personel panel bağlantısı, sunucu sürümü, açık destek sayısı ve son 100 yönetim olayı. Bağlantı en sık dakikada bir kalıcı yazılır; cihazın çevrimiçi olduğu garanti edilmez. Ana panel cevabı mali verileri içermez. SMS/e-posta gönderilmez.
5. Yerel pilot paketleme: açık dosya listesi; mevcut veriler, şifreler, anahtarlar, yedekler ve node_modules dahil edilmez. Temiz başlangıçta demo hesap oluşturulmaz. Yeni işletmeler 8 örnek ürün, kategoriler ve boş işlem geçmişiyle başlar.

## Testler

- 123 birim/API testi geçti: işletme ayrımı, roller, tekrarlı istekler, lisans, logo, temiz kurulum, yeniden açılış ve geri yükleme dahil.
- Mevcut 19 tarayıcı paketi geçti. Ek ana panel profil testi geçti. Son giriş değişikliği sonrası 10 temel akış yeniden geçti.
- Tip kontrolü ve derleme geçti. Ana panel 390 px genişlikte görsel olarak kontrol edildi.
- Paket kendi klasöründen boş veri diziniyle başladı; demoAvailable=false doğrulandı. Geliştirme bilgisayarının bağımlılıkları kullanıldı; yeni Windows bilgisayarına bağımsız kurulum henüz denenmedi.
- En son yalnız ilerleme kutularının eksik tarih açıklaması düzeltildi; tip kontrolü/derleme tekrar geçti.

## Yedekler ve paket

- Mevcut veriler: `.local/backups/backup-2026-09-25T14-52-15-976Z-049068f0` (37 dosya). Ayrı geri yükleme: `.local/restored/restore-XulkZj`.
- Temiz şablon: `.local/backups/backup-2026-09-25T14-52-43-670Z-0064c2b3` (3 dosya). Ayrı geri yükleme: `.local/restored/restore-klEoCf`.
- İki geri yükleme de doğrulandı. Anahtarlar `.local/backup-keys` altında ayrı dosyalardadır. Harici konuma kopyalama yapılmadı.
- Güncel paket: `.local/packages/mola-pilot-1790389587463-cc26dca4`. `ILK_KURULUM.txt` ve SHA-256 `manifest.json` içerir.
- Yeniden üretme: `npm.cmd run pilot:package`.

## 6. İnternet yayını — tamamlanmadı

Sunucu/alan adı bilgisi bekleniyor. Satın alma veya yayın yapılmadı. Yerel prototipin NODE_ENV=production engeli korunuyor.

Üretim için kalanlar:

1. Merkezi sunucu ve işletme işlemcisinin dağıtım sınırları.
2. Finansal anahtar dağıtımı, yedekleme ve denetlenen yönetici kurtarması. Mevcut şifreleme anahtarına sunucu erişebilir; uçtan uca şifreleme değildir.
3. Seçilen altyapıda HTTPS, güvenli oturumlar, proxy sınırı, secret yönetimi, izleme ve dış yedekleme.
4. Yeni bilgisayarda kurulum/güncelleme, gerçek telefon/tablet, mobil internetten QR, yeniden başlatma ve kesinti kabul testleri.
5. Üretim mimarisinde güvenlik ve kapasite doğrulaması.

Paket kaynak kod içerir; Node.js 24+ ve ilk bağımlılık kurulumu için internet gerekir. Tek dosyalı çevrimdışı yükleyici veya kod korumalı dağıtım değildir. Yerel testler üretim güvenliği veya satışa hazır olma garantisi olarak sunulmaz.


## Ek geliştirme — ana panel hesap güvenliği

Ana panelde Hesap güvenliği sekmesi eklendi. Mevcut şifre doğrulanarak en az 12 karakterli yeni şifre belirlenir. Başarılı değişiklik tüm yönetici oturumlarını kapatır; işletme oturumları etkilenmez. Eski şifreyle aynı anda devam eden girişler yeniden doğrulanır. Başarısız şifre denemeleri sınırlandırılır. Denetim kaydında yalnız işlem adı ve zamanı tutulur, şifre saklanmaz. İlk giriş dosyasındaki şifre artık geçersiz olur; yeni şifre o dosyaya yazılmaz.

Doğrulama: 124 birim/API testi, tip kontrolü ve derleme geçti. Ek tarayıcı testi normal şifre değişikliğini, ikinci yönetici oturumunun iptalini, mobil genişliği ve yanıt kaybından sonra yeni şifreyle girişi doğruladı. Gerçek geliştirme hesabının şifresi test amacıyla değiştirilmedi.

Güncel yerel paket: `.local/packages/mola-pilot-1790391571946-f40ece05`. Önceki paket yolunun yerine kullanılır. İnternet yayını ve üretim anahtar yönetimi halen tamamlanmadı.


## Ek geliştirme — işletme listesi

Ana panelde Türkçe işletme adı araması; aktif, son 7 gün, kurulum bekleyen, deneme, askıda, dondurulmuş, süresi dolmuş ve açık destek talebi filtreleri eklendi. Filtrelerin yanında adetler gösterilir. Liste sayfa başına en fazla 12 işletme kartı oluşturur. Arama/filtre değişince ilk sayfaya, işletme açılınca yeni kaydın bulunduğu son sayfaya geçer. Sonuç bulunamadığında açık mesaj ve filtre temizleme seçeneği vardır.

Tip kontrolü, derleme ve 14 işletmelik örnek veriyle tarayıcı testi geçti: Türkçe arama, filtreler, sayfalama, boş sonuç ve 390 px mobil genişlik doğrulandı. Bu sayfalama tarayıcıdaki kart sayısını azaltır; API halen tüm işletme özetini döndürür. Çok büyük merkezi dağıtım için sunucu tarafı sorgulama/sayfalama ayrıca gereklidir.

Güncel paket: `.local/packages/mola-pilot-1790391921928-0f20fd0d`.


## Ek geliştirme — destek kutusu

Ana panel ve işletme Destek ekranında ortak talep listesi eklendi. Konu/talep numarasıyla, ana panelde ayrıca işletme adıyla arama yapılır. Tümü, açık, destek yanıtı bekleyen ve çözüldü filtreleri adetleriyle görünür. Son mesaj tarihi, gönderen ve kısa önizleme gösterilir; son mesaja göre sıralanır. Sayfa başına 10 talep gösterilir. Son yanıt bilgisi okunmuş/okunmamış takibi değildir.

Tip kontrolü ve derleme geçti. Tarayıcı testi gerçek yerel API üzerinden talep açma, ana panel arama/yanıt/kapatma, işletmenin yanıtı görmesi, 12 talebin sayfalanması, ikinci sayfadan arama ve 390 px mobil taşma kontrolünü geçti. Ücretli bildirim veya dış gönderim eklenmedi. Sunucu tüm talep verisini döndürmeye devam eder; bu değişiklik ekran listesini sınırlar.

Güncel yerel paket: `.local/packages/mola-pilot-1790392367884-d22c8cf1`.


## Tasarım düzenlemesi — işletme kartları

Kullanıcının Masalar ekranına benzer sade düzen isteği uygulandı. İşletmeler logo/simge, ad, lisans durumu, kalan gün ve kısa destek/kurulum bilgisi içeren kartlara dönüştürüldü. Ayrıntılar karta tıklanınca pencerede açılır: Lisans ve hizmet / Kurulum ve bilgiler. İşletme ekleme formu ayrı düğmeden açılır. İşlem sürerken veya sonucu belirsizken pencere kapanmaz; yeniden kontrol düğmesi pencerenin içinde erişilebilir kalır. Ayrıntıdan çıkış arama ve sayfalamayı korur.

Tip kontrolü ve derleme geçti. Deneme/abonelik/askı/dondurma akışı, logo düzenleme, kart açma-kapatma, Türkçe filtreler, sayfalama ve mobil taşma testleri geçti. Masaüstü ekran görüntüsü görsel olarak incelendi. Mevcut iş verileri değiştirilmedi.

Güncel yerel paket: `.local/packages/mola-pilot-1790393161934-f1b3c387`.


## Tasarım düzenlemesi — destek kartları ve ayrı yazışma penceresi

Ana panel ve işletme destek talepleri, işletme kartlarına benzer responsive kartlara dönüştürüldü. Kartlarda konu, durum, işletme/talep numarası, son mesaj zamanı ve kısa önizleme bulunur. Karta tıklanınca yazışma ve yanıt alanı ayrı pencerede açılır; kapanınca arama ve sayfa korunur. Yanıt sürerken veya sonucu belirsizken pencere kapatılamaz. Talep arka planda kapanmış olsa bile belirsiz yanıtın yeniden kontrolü erişilebilir kalır.

Performans: ana panel dinamik yüklemeye ayrıldı. Ana JavaScript dosyası 501,27 kB yerine 483,64 kB (gzip 144,24 kB); ayrı Platform dosyası 19,36 kB (gzip 6,17 kB). Bu ayrım indirilen kodu azaltır; tek başına ölçülmüş cihaz hızlanması iddiası değildir.

Tip kontrolü, derleme ve gerçek yerel API ile tarayıcı testi geçti: talep açma, kart/pencere, yanıt verme/kapatma, kaybolan yanıtı ikinci kayıt oluşturmadan kontrol etme, 12 talep sayfalama, filtre koruma ve mobil taşma kontrolü. Mobil ekran görüntüsü incelendi.

Güncel yerel paket: `.local/packages/mola-pilot-1790394517140-2e95210c`.


## İşletme ve destek bağlantısı

İşletme ayrıntı penceresine açık destek adedi ve Destek geçmişini aç düğmesi eklendi. Düğme yalnız seçili işletmenin taleplerini gösterir. Ana panel destek ekranında işletme seçicisi ve tüm işletmelere dönüş bulunur. Durum adetleri seçilen işletmeye göre hesaplanır. Filtreleme adla değil işletme kimliğiyle yapılır; aynı adlı işletmelerin kayıtları karışmaz. İşletme kullanıcılarının mevcut API erişim sınırları korunur.

Tip kontrolü/derleme ve iki işletmeyle gerçek API tarayıcı testi geçti: doğrudan geçiş, işletme seçimi, yazışmadan dönünce filtre koruma, tümünü gösterme ve mobil taşma. Yeni testte işletme sahibinin yalnız kendi talebini aldığı da doğrulandı.

Güncel paket: `.local/packages/mola-pilot-1790408038157-ca934123`.


## Toplu düzenleme — geçmiş, bildirimler ve destek bağlamı

- İşlem geçmişi: Son 100 kayıt içinde işlem/işletme/konu araması, Türkiye saatine göre başlangıç-bitiş tarihi ve 20 kayıtlık sayfalama. Hatalı tarih aralığı açıkça belirtilir. Destek işlemlerinde işletme adı ve konu gösterilir; yönetici şifre işlemleri Ana panel hesabı olarak adlandırılır.
- Bildirimler: SMS/e-posta gönderilmemiş kayıt toplamları, kanal seçimi, 20 kayıtlık sayfalama. Gönderim veya otomatik yeniden deneme eklenmedi.
- Destek penceresi: Ana panelde görüşülen işletmenin adı belirgin şekilde gösterilir.

Tip kontrolü ve derleme geçti. Toplu tarayıcı doğrulamasında arama, tarih aralığı/gece UTC-Türkiye sınırı, hatalı tarih, kayıt sayfalama, kanal sayıları, işletmeye bağlı görüşme ve mobil taşma geçti.

Güncel yerel paket: `.local/packages/mola-pilot-1790411052620-0018a559`.


## İşletme sahibi hesabı kurtarma

Ana panel işletme ayrıntısına Hesap erişimi sekmesi eklendi. Kullanıcı adı görünür; yönetici kendi şifresini doğrulayarak en az 12 karakterli yeni işletme sahibi şifresi belirler. Yalnız hedef işletmenin aktif sahibi ve beklenen hesap sürümü kabul edilir. Sahibin oturumları sürüm artırımıyla iptal edilir; çalışan hesapları, QR/iş verileri ve mali rapor MFA ayarları değiştirilmez. Yönetici ve işletme denetim kayıtlarında işlem bulunur; parolalar kaydedilmez. Tekrar kontrol aynı istek için ikinci yenileme yapmaz; parola içeriğini karşılaştırmak için sunucu anahtarlı HMAC saklanır. Beş doğrulama girişimi/dakika sınırı vardır.

124 birim/API testi ve yeni tarayıcı senaryosu geçti. Yanlış parola, yetkisiz işletme kullanıcısı, farklı hesap hedefi, eski şifre reddi, yeni şifreyle giriş, kayıp yanıttan sonra tek işlem ve garson oturumunun korunması doğrulandı. Gerçek işletme hesaplarının şifreleri test amacıyla değiştirilmedi.

Güncel paket: `.local/packages/mola-pilot-1790412966743-86c9bdd6`.


## Altyapı — işletme başına ayrı veri anahtarı

İşletme verileri bağımsız rastgele anahtarlarla şifrelenir; bu anahtarlar mevcut yerel üst anahtarla sarılır. Eski verilerin atomik geçişi, öncesi veritabanı kopyası ve eski/yeni yedek uyumluluğu eklendi. Bu henüz uçtan uca şifreleme veya merkezi güvenlik ayrımı değildir. Ayrıntı: decisions/002-tenant-keys.md.

126 birim/API testi, tip kontrolü ve 10 sipariş/mutfak/ödeme tarayıcı senaryosu geçti. Üç mevcut işletme önce geri yüklenen kopyada, sonra asıl veride geçirildi; içerikleri SHA-256 ile birebir karşılaştırıldı.

Geçiş öncesi tam yedek: `.local/backups/backup-2026-09-26T09-06-24-416Z-df53c594`; doğrulanmış ve prova yapılan kopya: `.local/restored/restore-hZzTmd`.
Geçiş sonrası tam yedek: `.local/backups/backup-2026-09-26T09-08-14-050Z-a99b7d7f`; doğrulanmış geri yükleme: `.local/restored/restore-V6tlCZ`.
Temiz şablon yeni biçimde yedeklendi ve `.local/restored/restore-PncIzM` içine doğrulandı. Anahtar dosyaları ayrı backup-keys dizinindedir; dış yedekleme kurulmadı.

## Yönetim özeti — 26 Eylül 2026

Ana panel işletme listesi artık özel işletme snapshot'larını okumaz. Ayrı şifreli `business_directory` tablosunda yalnız işletme kimliği/adı/logo, kurulum durumu/tarihi, bilgi sürümü ve sahibinin hesap kimliği/kullanıcı adı/sürümü bulunur. Şifre özeti, MFA, siparişler, ödemeler ve müşteri bilgileri bu özete alınmaz. Profil ve hesap değişiklikleri asıl kayıtla aynı işlemde güncellenir; satış işlemleri özeti değiştirmiyorsa ek yazma yapılmaz. Eski işletmelerin özetleri başlangıçta oluşturulur; yedek geri yükleme bu tablonun şifreli kayıtlarını da doğrular.

127 birim/API testi, tip kontrolü ve ana panel profil/logo/mobil tarayıcı testi geçti. Özel kayıt okuma işlevi engellendiğinde ana panel listesi çalışmaya devam etti. Kayıt hatasında özet ve asıl verinin birlikte geri alınması, tekrar açılış ve alan sınırları test edildi.

Geçiş öncesi yedek: `.local/backups/backup-2026-09-26T12-34-34-319Z-dcc75791`. Üç mevcut işletmenin içeriğinin geçişte değişmediği SHA-256 karşılaştırmasıyla doğrulandı. Sunucu yeniden açıldı.

Sınır: Aynı süreç ve yerel üst anahtar kullanılmaya devam eder. Profil/hesap değiştirme komutları ve işletme oturumu işlemleri hâlâ özel kayıtlara erişir. Bu adım fiziksel sunucu ayrımı veya uçtan uca şifreleme değildir.

## Giriş verilerinin ayrılması — 26 Eylül 2026

Kullanıcı adı arama ve şifre doğrulama, işletmelerin sipariş/mali snapshot'larını açmak yerine ayrı şifreli `staff_credentials` tablosunu kullanır. Yalnız kimlik, kullanıcı adı, rol, aktiflik, sürüm ve parola doğrulama salt/hash değerleri bulunur; MFA sırları ve işletme iş verileri alınmaz. Bu tablo ana panelin işletme listesine verilmez. Hesap değişiklikleri aynı veritabanı işlemi içinde yansıtılır; değişmeyen giriş kayıtları tekrar yazılmaz. Eski kayıtlar başlangıçta tamamlanır. Asenkron şifre doğrulaması sonrasında işletme, hesap kimliği, sürüm ve parola kaydının değişmediği yeniden denetlenir.

128 birim/API testi ve tip kontrolü geçti. Tam işletme kayıtlarının okunması engellendiğinde doğru/yanlış parola girişleri doğrulandı. Şifre kurtarma tarayıcı testinde kayıp yanıttan sonra tek işlem ve garson oturumunun korunması geçti. Üç işletmenin geçiş öncesi/sonrası içerikleri eşleşti.

Geçiş öncesi yedek: `.local/backups/backup-2026-09-26T13-08-41-726Z-40766d51`. Geçiş sonrası yedek: `.local/backups/backup-2026-09-26T13-09-03-225Z-18fbd0d7`.

Bu bir geçiş adımıdır: Hesapların asıl kayıtları hâlâ işletme snapshot'ında bulunur; oturum yetkisi ve iş işlemleri bu kaydı kullanmaya devam eder. Giriş tablosu aynı yerel üst anahtarla korunur; bağımsız kimlik sunucusu veya E2E uygulanmış değildir.

## Oturum kontrolünün ayrılması — 26 Eylül 2026

Çalışan oturum doğrulaması ve `/api/staff/me` artık özel işletme snapshot'ını okumaz; yalnız ilgili işletmenin şifreli hesap kaydını kullanır. Süresi dolan, rolü/sürümü değişen veya kapatılan hesabın oturumu bellekten çıkarılır. Hesabı yeniden açmak iptal edilen oturumu canlandırmaz. Yetki her istekte yeniden denetlenir. İş işlemlerinin kendi alan yetkisi kontrolleri ve MFA mevcut şekilde korunur.

129 birim/API testi, tip kontrolü ve 10 sipariş/mutfak/ödeme/mobil tarayıcı senaryosu geçti. Güncelleme öncesi yedek: `.local/backups/backup-2026-09-26T13-25-15-685Z-ad5fb8a1`. Veritabanı biçimi bu adımda değişmedi. Sunucu yeniden açıldı. Mimari sınırlar ve sonraki ayrım için `decisions/003-management-and-identity-projections.md` yazıldı.

## İndeksli kullanıcı adı araması — 26 Eylül 2026

Giriş araması artık tüm işletmelerin hesaplarını taramaz. HMAC belirteciyle indeksli sorgu yalnız ilgili işletmenin şifreli hesap kaydını seçer. Kullanıcı adları indeks tablosunda açık tutulmaz. Yinelenen adlar veritabanında da reddedilir; yanlış yönlendirilmiş indeks kimlik kontrolünü geçemez. Açılışta türetilmiş indeks hesap kayıtlarından yeniden kurulur; mali kayıtların biçimi değişmedi.

130 birim/API testi, tip kontrolü ve hesap kurtarma tarayıcı testi geçti. Diğer işletmenin bozuk hesap kaydıyla hedef giriş, indeks yönlendirme bozukluğu, çakışmada geri alma, ad değiştirme ve eski yedek biçiminden yeniden oluşturma test edildi. Üç mevcut işletmenin içeriği geçişte birebir korundu. Geçiş öncesi yedek: `.local/backups/backup-2026-09-26T13-29-16-198Z-a2e0dcaa`.

## Geri yükleme tutarlılığı ve yarıda kalma koruması — 26 Eylül 2026

Geri yükleme, hesap ve yönetim özetlerini asıl işletme snapshot'larından türetilen değerlerle karşılaştırır. Mevcut özet tablosunda eksik/fazla işletme veya eski değer bulunması reddedilir. Bu tabloları henüz içermeyen eski yedekler desteklenir ve açılışta tamamlanır. Veri anahtarı boyutu, zorunlu dosyalar ve işletme kimliği de kontrol edilir.

Yeni hedef klasöre ilk olarak `RESTORE_IN_PROGRESS.txt` konur; yalnız bütün doğrulamalar geçince kaldırılır. Hata durumunda `RESTORE_FAILED.txt` de bırakılır. Uygulama açılışı, doğrudan Store kullanımı ve yedekleme bu işaretli klasörleri reddeder. İşaretleri silerek kullanıma açmak yerine sağlam yedekten yeni klasöre tekrar geri yükleme yapılmalıdır.

132 birim/API testi ve tip kontrolü geçti. Eski yedek uyumluluğu, şifre doğrulaması geçen ama içerik olarak eski/eksik özetler ve yarıda kalmış klasörlerin açılamaması test edildi. Mevcut 37 dosyalık yedek `.local/backups/backup-2026-09-26T13-52-04-943Z-7825cc2b`, `.local/restored/restore-gnF1V5` içine başarıyla geri yüklendi; üç işletmenin açılışta değişmediği doğrulandı. Sunucu yeniden açıldı.

## Toplu pilot hazırlığı — 26 Eylül 2026

Kurulum öncesi kontrol paket manifestindeki dosyaların SHA-256 değerlerini, zorunlu dosyaları, dosya yolu/bağlantı güvenliğini, port kullanılabilirliğini, veri klasörü kilidini, geri yükleme işaretlerini ve veri anahtarı boyutunu denetler. `PORT` ve `BACKUP_DIR` desteklenir. Yedek tamamlanma tarihi, geri yükleme doğrulaması olmadığı açıkça belirtilerek gösterilir. Manifest imzalı yayın doğrulaması değildir; yerel pilot sınırı devam eder.

133 birim/API testi ve tip kontrolü geçti. Paket bozulması, kullanılan port, geçersiz port, eksik anahtar, geri yükleme işareti, kilit ve yedek bildirimi sınandı. Güncel kapsam/öncelik listesi `SATISA_HAZIRLIK_2026-09-26.md` dosyasında toplandı; eski kapsam listesi tarihsel referans olarak tutuldu. Bu tur mevcut işletme verisi veya arayüz akışı değiştirilmedi.

## HTTPS bağlantı ve oturum hazırlığı — 26 Eylül 2026

İsteğe bağlı sabit HTTPS dış adres, açıkça etkinleştirilen loopback proxy güveni ve HTTPS modunda zorunlu yazma Origin kontrolü eklendi. Çalışan, ana panel ve müşteri çerezleri güvenli bağlantıda Secure olarak oluşturulur; çıkışta da aynı seçeneklerle silinir. Yerel mod sahte forwarded-protocol başlığına güvenmez. HTTPS test modu derlenmiş arayüz ve loopback gerektirir; üretim başlatma engeli korunur. Gerçek TLS/proxy barındırması henüz kurulmadı. Ayrıntılar `HTTPS_TEST_HAZIRLIGI.md` içinde.

134 birim/API testi, ek müşteri/ana panel çerez doğrulaması, tip kontrolü ve 10 tarayıcı akışı geçti. Yanlış/eksik Origin, güvensiz bağlantı, açıkça güvenilmeyen proxy ve yerel giriş uyumluluğu doğrulandı. Güncelleme öncesi yedek: `.local/backups/backup-2026-09-26T14-10-46-077Z-c85aa7aa`. Yerel sunucu yeniden açıldı.

## Doğrudan masa QR araması — 26 Eylül 2026

QR müşteri oturumu artık tüm işletmeleri taramadan HMAC tabanlı indeksle hedef masayı bulur. Hedef snapshot'ta masa ve token yeniden doğrulanır; yanlış yönlendirme oturum açmaz. Masa silme/yenileme ve indeks atomiktir; değişmeyen masa düzeni gereksiz indeks yazımı yapmaz. Basılı QR'lar korunur, otomatik yenileme eklenmedi.

136 birim/API testi, tip kontrolü ve 10 tarayıcı senaryosu geçti. Diğer işletmenin bozuk snapshot'ından etkilenmeme, bilinmeyen QR'da snapshot okumama, token çakışması, geri alma, kaldırma ve eski biçimden indeks oluşturma doğrulandı. Üç mevcut işletmenin içeriği geçişte değişmedi. Öncesi yedek: `.local/backups/backup-2026-09-26T14-17-35-498Z-d795112a`.

## Sunucu başlatma ve normal kapanış — 26 Eylül 2026

Sunucu yaşam döngüsü `server/runtime.ts` altında toplandı. Başlatma hatası (ör. kullanılan port) Vite/veritabanı kaynaklarını ve yalnız kendi veri kilidini bırakır. Port aralığı kilit alınmadan doğrulanır. Tekrarlanan kapanış çağrıları aynı işlemi bekler; aktif HTTP isteği tamamlanmadan veritabanı kapatılmaz. Vite izleyicisi `.local` ve `test-results` değişikliklerinde gereksiz sayfa yenilemesi yapmaz.

138 birim/API testi, tip kontrolü ve ana panel profil/mobil tarayıcı testi geçti. Dolu port sonrası aynı klasörde başlatma, ikinci sunucunun mevcut kilidi koruması, çift kapanış ve yarım gönderilmiş HTTP isteğinin tamamlanmasını bekleme doğrulandı. Normal kapanış garantisi elektrik kesilmesi veya zorla süreç sonlandırmayı kapsamaz; bu durumlarda eski kilit kontrolü hâlâ gerekir.

Yedek: `.local/backups/backup-2026-09-26T14-21-51-169Z-327a6dd4`. Veri biçimi değişmedi; sunucu güncellendi.

## Süreli bellek kayıtları — 26 Eylül 2026

Çalışan, müşteri ve platform oturumları; mali rapor doğrulama izinleri/kurulum sırları/deneme sayaçları ve genel istek deneme sayaçları sınırlandırılmış süreli depoya taşındı. Okunan kayıt süresi dolduğu anda reddedilir. Trafikte en fazla 30 saniye aralıklarla toplu temizlik yapılır; boşta zamanlayıcı çalışmaz. Kapasiteye erişilirse temizlik en fazla saniyede bir yapılır ve aktif kayıtlar atılmadan yeni kayıt 503/SESSION_CAPACITY ile reddedilir.

Süreç başına teknik üst sınırlar: 10.000 çalışan, 50.000 müşteri, 1.000 platform oturumu; mali doğrulama depolarının her biri 10.000, genel deneme sayacı 20.000 kayıt. Bunlar işletme lisans/kullanıcı hakkı değil kaynak koruma sınırlarıdır. Dağıtık oturum deposu veya işletme başına kapasite ayırma henüz yoktur. Yeniden başlatmada oturumlar önceki gibi kapanır; sipariş/mali veriler etkilenmez.

141 birim/API testi, tip kontrolü ve hesap kurtarma tarayıcı testi geçti. Tam süre sınırı, kapasitede aktif oturum koruma, süre dolunca yer açma, çıkış/yenileme ve dokunulmayan eski kayıt temizliği doğrulandı.

## Teknik hata kaydı ve toplu doğrulama — 26 Eylül 2026

Her API isteğine sunucunun ürettiği takip kimliği eklendi. 5xx teknik kayıtları yalnız kimlik, yöntem, rota kalıbı, durum/kod ve süre içerir; gövde, sorgu, çerez, şifre, mali tutar ve dahili hata/stack içermez. Bozuk JSON 400, büyük içerik 413 döndürür; beklenmeyen dahili SyntaxError 500 olarak ayrılır. Kalıcı teknik log arşivi veya harici sağlayıcı eklenmedi. Ayrıntı: `TEKNIK_HATA_TAKIBI.md`.

142 birim/API testi, tip kontrolü, derleme ve 25 tarayıcı paketindeki 54 senaryo geçti. Yerel 20 eşzamanlı müşteri/80 sipariş yük provası hatasız tamamlandı. Güncel yedek ayrı klasöre doğrulandı. Ölçümler ve sınırlar: `TOPLU_TEST_2026-09-26.md`.

## Ana panel iki adımlı giriş — 26 Eylül 2026

Hesap güvenliğine isteğe bağlı Authenticator kurulumu eklendi. Şifre doğrulaması, 10 dakikalık kurulum, etkinleştirmeden önce saklanan sekiz tek kullanımlık kurtarma kodu ve TOTP doğrulaması vardır. Açma/kapatma mevcut yönetici oturumlarını iptal eder; şifre değiştirme MFA'yı korur. Kurtarma koduyla giriş korumayı kapatmaz. Gizli veriler ana panel durum yanıtında yer almaz. İşlemler okunabilir denetim kayıtlarına eklenir. Mevcut işletmeler ve gerçek ana panel hesabı için otomatik etkinleştirme yapılmadı.

143 birim/API testi, tip kontrolü ve derleme geçti. Yeni mobil tarayıcı testi kurtarma kodlarını saklamadan etkinleştirmeyi engelleme, kayıp etkinleştirme yanıtı sonrası kurtarma koduyla giriş ve korumayı kapatma akışlarını doğruladı. Mevcut ana panel şifre değiştirme tarayıcı testi de geçti. Ayrıntılar: `ANA_PANEL_AUTHENTICATOR.md`. Önceki toplu test raporu bu yeni ekranı kapsamıyordu; bu tur ilgili iki tarayıcı paketi çalıştırıldı.

## Yedek oluştururken doğrulama — 26 Eylül 2026

Oluşturma ve geri yükleme aynı salt okunur veritabanı doğrulamasını kullanır. Oluşturulan SQLite kopyası; veri anahtarı, şifreli snapshot'lar, yönetim/hesap özeti tutarlılığı ve platform verisi açısından doğrulanmadan yedek tamamlanmaz. Geçici tamamlanma kaydı en son yeniden adlandırılır. Başarısızlıkta BACKUP_FAILED işareti bırakılır; geçici veritabanı kopyası/manifest temizlenmeye çalışılır, kaynak işletme verisi korunur. Ani süreç kesintisinde tamamlandı kaydı yoksa yedek kabul edilmez; kalan dosyalar otomatik silinmez.

Geri yükleme başarısız/yarım yedek işaretlerini reddeder ve tamamlanma kaydını şifreli manifestteki tarih/dosya sayısıyla karşılaştırır. Kurulum kontrolü başarısız işaretli yedeği son tamamlanmış yedek olarak göstermez. Eski geçerli yedek biçimi desteklenir.

144 birim/API testi, tip kontrolü ve ek kurulum kontrolü testi geçti. Güncel 37 dosyalık yerel veri yeni kontrollerle `.local/backups/backup-2026-09-26T20-31-41-818Z-c28b29ff` dizinine yedeklendi ve ayrı klasöre geri yükleme doğrulandı. Bu değişiklik arayüz akışlarını değiştirmedi.

## Fotoğraf dosyası kontrolü — 27 Eylül 2026

İşletme Ayarlar bölümündeki fotoğraf alanı denetimi; eksik/boş ana fotoğraf ve küçük görsel, eksik düzenleme kaynağı çifti, yedi günden eski tamamlanmamış yükleme ve geçersiz fotoğraf başvurularını ayrı sayar. Yeni yüklemeler eski dosya uyarısına girmez; düzenleme kaynağı olmayan eski geçerli fotoğraflar desteklenir. Dosya yolları veya diğer işletmelerin kimlikleri yanıtta gösterilmez. Denetim ürünleri ve dosyaları değiştirmez; görsel içeriğini çözerek bozulma kontrolü yapmaz. Uyarı sayıları aynı fotoğrafı kapsayabilir.

145 birim/API testi, tip kontrolü, derleme ve mobil fotoğraf alanı tarayıcı testi geçti. Testler eksik/boş dosyaları, eski/yeni yüklemeleri, kaynak çifti tutarlılığını, yabancı başvuruları ve denetimde dosyaların korunmasını kapsar. Mobil akışta kaydedilmemiş ayarlar korunur ve yatay taşma oluşmaz. Güncel 37 dosyalık veri `.local/backups/backup-2026-09-27T06-29-41-351Z-6bf81037` dizinine yedeklendi.

## Kurulumda disk kapasitesi — 27 Eylül 2026

Pilot kurulum denetimine veri diski kapasite ölçümü eklendi. Ayrılmış/yetkili kullanıcıya ait bloklar yerine sürecin kullanabileceği alan hesaplanır. 256 MiB altı başlatma kontrolünü başarısız kılar; 2 GiB veya %5 altı uyarı üretir. Erişim hatası ya da geçersiz sayaçlar sessizce yeterli sayılmaz, ölçülemedi uyarısı verir. Hata yanıtına dosya yolu veya dahili hata bilgisi taşınmaz. Kontrol sürekli izleme, yedek diski kontrolü veya alan rezervasyonu değildir; mevcut sunucuya ve verilere müdahale etmez.

147 birim/API testi ve tip kontrolü geçti. Eşiklerin iki tarafı, tam dolu disk, oransal azalma, geçersiz sayaçlar, erişim hatası ve kurulumda kritik/uyarı ayrımı doğrulandı. Arayüz değişikliği yoktur.

## Yedek güncelliği, hedef diski ve prova — 27 Eylül 2026

Kurulum kontrolü mevcut veritabanında 24 saatten eski yedek için uyarır; gelecekteki tarihleri güncel yedek saymaz. Mevcut yedek hedefinin disk kapasitesi ayrıca ölçülür; olmayan hedef oluşturulmadan açık uyarı verilir. Yedek hedefi kapasite uyarıları çalışan uygulamayı veya yeni başlatmayı tek başına engellemez.

`backup verify` komutu mevcut doğrulanmış geri yükleme akışını benzersiz prova klasöründe çalıştırır; başarılıysa tarih, dosya sayısı ve denetim kapsamını raporlar. Canlı veriler değişmez. Kopyalar özel veri içerdiğinden otomatik silinmez. Ayrıntı: `YEDEK_PROVASI.md`.

148 birim/API testi ve tip kontrolü geçti. 37 dosyalık güncel yedek yeni komutla `.local/restore-checks/restore-DMd8gO` klasöründe başarıyla doğrulandı. Bu tur arayüz değişmedi; otomatik yedek zamanlaması veya harici depolama kurulmadı.

## Mutfakta ekranı açık tutma — 27 Eylül 2026

Mutfak başlığındaki ses kontrolünün yanına isteğe bağlı “Ekranı açık tut” düğmesi eklendi. Yalnız güvenli bağlamda ve destekleyen tarayıcıda kullanılır. Kilit alınmadan etkin görünmez; başarısızlık ve sistemin kilidi bırakması açık durum mesajlarıyla gösterilir. Görünür sekmeye dönüldüğünde kullanıcı tercihi devam ediyorsa tekrar istenir. Mutfak ekranından ayrılınca kilit bırakılır; bekleyen istek ayrıldıktan sonra sonuçlansa bile serbest bırakılır. Sürekli zamanlayıcı yoktur; tercih sayfa yenilemeleri arasında otomatik açılmaz.

Tip kontrolü, derleme ve iki yeni mobil tarayıcı testi geçti. Testler tarayıcı API taklidiyle alma/bırakma, görünürlük olayıyla yeniden alma, reddedilen isteği tekrar deneme, sekme değişiminde bırakma, destek yokluğu ve 390 px taşma kontrolünü kapsar. İlk test mobilde gizli çıkış düğmesini beklediği için düzeltildi; son çalışmada iki test geçti. Gerçek tablet, pil tasarrufu, cihazın güç düğmesi veya arka planda ses garantisi test edilmiş değildir. HTTPS/LAN koşulları ve cihaz davranışı saha kabulünde doğrulanmalıdır.

API kaynağı: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API

## Mutfak kontrol simgeleri — 27 Eylül 2026
Ekranı açık tutma ve sipariş sesi aynı boyutta simge düğmelerine dönüştürüldü. Görünür uzun durum metinleri bilgi balonlarına taşındı; ekran okuyucu durumları korundu. Her simgenin yanında fare, klavye ve dokunmayla açılan küçük bilgi düğmesi var. Etkin durum tema yeşiliyle, bekleme/yeniden deneme durumu yumuşak uyarı rengiyle gösterilir. Tip kontrolü, derleme ve iki tarayıcı testi geçti; mobil ekran görüntüsü incelendi, bilgi balonlarında yatay taşma yok.

## Bekleyen ekran isteğini iptal etme — 27 Eylül 2026
Mutfak ekranını açık tutma isteği tarayıcıda beklerken aynı simgeyle iptal edilebilir. Geç gelen yanıt iptalden veya mutfaktan ayrıldıktan sonra ekran kilidini yeniden etkinleştirmez; alınan kilit bırakılır. Simge düzeni korunur. Tip kontrolü, derleme ve üç mutfak tarayıcı testi geçti; yeni test gecikmiş yanıtı kontrollü olarak üretir. Gerçek cihaz uyku testi yerine geçmez.

## Mutfak sesinde sekmeye dönüş — 27 Eylül 2026
Mutfak sekmesi yeniden görünür olduğunda askıya alınmış ses bağlamını devam ettirme denenir; sessiz tercihi korunur ve dönüşte deneme sesi çalmaz. Otomatik devam isteği beklerken tekrar gelen etkileşimler aynı isteği çoğaltmaz. Ekrandan ayrılınca görünürlük dinleyicisi temizlenir ve ses kapatma hatası yakalanır. Tip kontrolü, derleme ve ses API taklidiyle sekmeye dönüş/sessiz tercih/kaynak kapatma tarayıcı testi geçti. Gerçek cihazda arka plan sesi veya uyku sırasında bildirim garantisi yoktur.

## Toplu doğrulama — 27 Eylül 2026
Tip kontrolü, derleme, 148 birim/API testi ve 28 tarayıcı grubundaki 59 senaryo geçti. Bu çalışmada hata veya kod düzeltmesi gerekmedi. Ayrıntılar ve sınırlar TOPLU_TEST_2026-09-27.md dosyasında. Güncel pilot paketi tüm son mutfak kontrollerini içerir.

## Yerel HTTPS ortamı — 27 Eylül 2026
Doğrudan TLS destekli runtime, sertifika üretme ve ayrı demo veriyle 3443 HTTPS başlatıcısı eklendi. Mevcut localhost verisi korunur. Sertifika deposu/güvenlik duvarı otomatik değiştirilmez. Gerçek TLS ve güvenli çerez/Origin/QR kontrolleri, 148 birim/API testi ve tip kontrolü geçti. Yerel ağ adresi sertifika doğrulanarak 200 yanıtladı. Telefon sertifika kurulumu ve cihaz testi kullanıcı tarafında bekliyor; rehber YEREL_HTTPS.md.

## HTTPS başlatma doğrulaması — 27 Eylül 2026
Sertifika tarihleri, yerel IPv4, mevcut ağ adresi, SAN/IP eşleşmesi, özel anahtar ve CA imzası veri klasörü açılmadan denetlenir. Süre bitimine yedi gün kala uyarı, eksik/bozuk ayarda anlaşılır hata eklenmiştir. 149 birim/API testi, tip kontrolü ve gerçek TLS testi geçti. Yeni test kendi geçici sertifikasını üretir; mevcut sertifikaları ve cihaz güven depolarını değiştirmez.

## Cihaz tanılama ve destek takip kodları — 27 Eylül 2026
Ayarlar bölümüne kapalı başlayan Bağlantı ve cihaz kontrolü eklendi. Elle başlatılan beş saniye zaman aşımlı erişim ölçümü, HTTPS/HTTP ayrımı, güvenli bağlam ve ekran açık tutma desteği gösterilir. Salt okunur destek özeti hesap, satış, adres veya kimlik bilgisi içermez; otomatik gönderilmez. Kaydedilmemiş ayarlar korunur. Mobil ekran görüntüsü incelendi, hata ve yeniden deneme testi geçti.
Ortak API istemcisi 5xx hatalarında yalnız biçimi geçerli sunucu takip UUID'sini mesajda gösterir; ApiError durum/kod sınıflandırması korunur. Bu kimlik mevcut teknik logla eşleştirme içindir; henüz ana panel log arama ekranı yoktur. 150 birim/API testi, tip kontrolü, derleme ve dört tahsilat kurtarma senaryosu geçti.

## Ana panel teknik hata sorgusu — 27 Eylül 2026
Destek bölümünde takip UUID'si ile sorgulama eklendi. Yalnız platform oturumu erişebilir. Son 24 saat/en fazla 500 teknik hata bellekte tutulur; yeniden başlatmada silinir. İstek gövdesi, hesap, satış, çerez, sorgu parametresi ve hata stack'i saklanmaz. Kayıt bulunamamasının işlemin yapılmadığı anlamına gelmediği açıklanır. 151 birim/API testi, tip kontrolü, derleme ve destek gezinme/sorgu tarayıcı testi geçti. Yerel HTTP ve HTTPS sunucuları güncellendi.

## Destek sorgusu kullanılabilirliği — 27 Eylül 2026
Takip kodu alanı tam hata mesajından tek bir UUID'yi ayırır; sunucuya yalnız kod gönderilir. Eksik veya birden fazla farklı kodda açık açıklama gösterilir; büyük/küçük harf farkı giderilir. Alan zorunlu işaretli, sorgu düzeni dar ekrana uyarlıdır. 152 birim/API testi, tip kontrolü, derleme ve destek tarayıcı testi geçti.

## Pilot paket temiz açılış provası — 27 Eylül 2026
Paket rehberleri ve manifest oluşturma tarihi eklendi. İlk paket provasında API çalışırken .local altındaki paket için /platform 404 verdi. sendFile mutlak yol yerine açık dist kökü ve index.html dosya adıyla düzeltildi. Sonuç yeniden doğrulanıyor.

Yeniden doğrulama başarılı: .local/packages/mola-pilot-1790510670794-577d9b02 paketi, aynı test veri klasörünü koruyarak açıldı. /platform ve JS dosyası 200; demoAvailable false; demo girişi ve yetkisiz platform erişimi 401. Paket bütünlüğü doğrulandı. Test sunucusu kapatıldı. Mevcut Node ve üst klasör bağımlılıkları kullanıldı; temiz Windows makinesi kurulumu henüz doğrulanmadı.

## Otomatik pilot paket provası — 27 Eylül 2026
Yeni test:package komutu derleyip gerçek dağıtım paketini oluşturur; kendi boş test verisiyle başlatır. Manifest, özel dosyaların dışarıda kalması, rehberler, .local altından SPA/JS erişimi, demo hesap olmaması, yetkisiz erişim, işletme oluşturma ve normal yeniden başlatmada işletme/yönetici bilgilerinin korunması kontrol edilir. Test geçti; paket .local/packages/mola-pilot-1790511542967-1a2cf192. Tip kontrolü ve derleme de geçti. test:all sonuna paket provası eklendi. Üst klasörün bağımlılıkları kullanıldığından bu test temiz Windows kurulumu veya gerçek sürüm düşürme testi değildir.

## Eksik paket ve veri yolu açılış kontrolleri — 27 Eylül 2026
Runtime derlenmiş index.html ile doğrudan başvurulan JS/CSS dosyalarını veri kilidi/veritabanı açmadan kontrol eder. Eksik, boş, dış adrese veya üst klasöre yönelen referanslar açık hata verir. Veri klasörü yerine dosya/erişilemeyen klasör seçilirse anlaşılır mesaj gösterilir. 153 testlik tam çalışma geçti; ardından eklenen veri yolu testiyle iki hedefli test de geçti. Tip kontrolü, derleme ve otomatik paket provası başarılı. Paket provasında eski keep-alive bağlantısının yeniden başlatmada ECONNRESET üretmesi nedeniyle test istekleri Connection: close ile ayrıldı; uygulama hatalarını gizleyen otomatik tekrar eklenmedi. Yeni paket: .local/packages/mola-pilot-1790526910762-256672c5. Kontrol tüm tembel yüklenen dosyaları taramaz; paket manifest doğrulaması ayrıca kullanılır.

## Her açılışta paket bütünlüğü — 27 Eylül 2026
Manifest denetimi ortak modüle taşındı ve runtime başlangıcına eklendi. Paket dosyası eksik/değişmişse veri kilidi ve veritabanı açılmadan durur. Temiz-Pilot-Baslat.cmd bulunan klasörde manifestin eksik olması da reddedilir. Geliştirme klasöründe manifest zorunlu değildir. Bu dosya tutarlılığı denetimidir, dijital imza veya kötü niyetli değiştirmeye karşı güven kökü değildir. Tip kontrolü, derleme, beş ilgili test ve otomatik paket provası geçti. Prova şablonu geçici değiştirerek açılışın reddini ve veritabanının aynı kalmasını doğruladı; dosya geri konduktan sonra manifest yeniden doğrulandı. Paket: .local/packages/mola-pilot-1790528062818-d159a486.

## Seçilebilir yedek hedefleri — 27 Eylül 2026
backup create isteğe bağlı yedek ve ayrı anahtar hedeflerini birlikte alır; restore için hedef seçimi eklendi. Windows farklı sürücülerinin yanlışlıkla veri klasörü içinde sayılması düzeltildi. Mevcut yol bağlantıları çözümlenerek veri/yedek/anahtar hedeflerinde aynı veya iç içe yollar reddedilir. Varsayılan hedefler korunur. 156 test ve tip kontrolü geçti. Fiziksel harici disk takma/çıkarma testi yapılmadı; ücretli veya otomatik dış yedekleme kurulmadı.

## Geri yükleme hedef korumaları — 27 Eylül 2026
Geri yükleme hedefleri yedek/anahtar klasörleriyle çakışmaya ve mevcut işletme veri klasörü altına kurulmaya karşı denetlenir. Tamamlanmamış yedek hatası hedef kontrolünden önce korunur. 157 test ve tip kontrolü geçti. Önceki özel hedef test yedeği .local/tests/custom-restore-checks/restore-MJxwqO klasörüne doğrulanarak geri yüklendi; canlı veriye dokunulmadı.

## Destek taleplerinde yanıt önceliği — 27 Eylül 2026
Ortak destek listesine Son mesaj önce / Yanıt bekleyenler önce seçimi eklendi. İkinci seçenek, açık ve işletmeden yanıt bekleyen talepleri en uzun bekleyenden başlayarak sıralar; işletmenin hatırlatma mesajı önceliği düşürmez. Yanıtlanmış ve kapatılmış talepler sonra gelir. Sıralama değişince sayfalama sıfırlanır. 158 testlik tam çalışma, tip kontrolü ve derleme geçti. Son hatırlatma düzenlemesinden sonra hedefli sıralama testi yeniden geçti; destek gezinme tarayıcı testi de başarılı.


## Destek yanıtını yanlışlıkla kaybetme koruması — 27 Eylül 2026
İşletme ve platform destek görüşmesinde gönderilmemiş yanıt varken kapatma veya Escape, Yazmaya devam et / Yanıtı sil ve kapat seçeneklerini gösterir. Devam seçildiğinde metin korunur ve odak yanıt alanına döner. Gönderim başarılı olunca kapatma işareti temizlenir. Dolu veya sonucu belirsiz yanıt sırasında beforeunload uyarısı bağlanır; tarayıcı desteğine bağlıdır, kalıcı taslak kaydı değildir. Tip kontrolü, derleme ve genişletilen destek tarayıcı senaryosu geçti. Mobil genişlik, iki rolde vazgeçme/devam, başarılı gönderim sonrası kapanma ve sunucuda kaydedildikten sonra bağlantısı kesilen yanıtın tekrar kontrolde yalnız bir kez kalması doğrulandı. İlk testte etiket seçicisi alanı bulamadı; erişilebilir textbox rolüyle doğrulama geçti. Canlı veriler değiştirilmedi.


## İşletme lisans sıralaması — 28 Eylül 2026
İşletmeler eklenme sırası, Türkçe ada göre veya aktif lisansı önce bitecekler şeklinde sıralanır. Sıralama sayfayı bire alır; yeni işletme oluşturunca eklenme sırası geri gelir. Dondurulmuş, askıdaki, süresi dolmuş ve tarihsiz hesaplar aktif bitiş önceliğine alınmaz. Son 7 gün filtresi 7 gün içinde bitecek olarak netleştirildi; aktif kartlarda bitiş tarihi gösterilir. Tip kontrolü, derleme, iki sıralama testi ve filtre/sayfalama/mobil tarayıcı senaryosu geçti.


## Tam doğrulama ve güncel pilot paket — 28 Eylül 2026
Tip kontrolü, 160 birim/API testi, derleme, 29 tarayıcı grubunda 60 senaryo ve temiz pilot paket provası geçti. Paket .local/packages/mola-pilot-1790568097177-243e80e4. Sonuçlar TOPLU_TEST_2026-09-28.md içinde; satışa hazırlık listesi yerel HTTPS ve yedek araçlarının mevcut durumuna göre güncellendi. Bu turda testleri geçirmek için uygulama değişikliği gerekmedi.

## Güncelleme ön kontrolü — 28 Eylül 2026
update:check komutu eski/yeni manifestli paketleri, arayüz dosyalarını, sürüm tutarlılığını, veri yolu ve anahtar varlığını, işlem kilidi ve yarım geri yükleme durumunu salt okunur kontrol eder. Aday kodu çalıştırmaz. Başarı yalnız ayrı veride provaya uygunluk bildirir; yedek doğrulaması veya veri sürümü uyumluluğu değildir. Aynı sürüm numaralı farklı paketler uyarılır. Geri dönüş rehberi eski uygulamanın değiştirilmiş canlı veri üzerinde açılmamasını ve yedekten sonraki işlemlerin geri yüklemede bulunmayacağını açıklar. İki hedefli test, tip kontrolü, derleme ve paket provası geçti. Komut iki gerçek pilot paket ve kapalı geri yükleme test kopyası üzerinde de başarılı çalıştı. Yeni paket .local/packages/mola-pilot-1790569049631-6d7275a3; rehber docs/GUNCELLEME_PROVASI.md. Otomatik geçiş/geri dönüş tamamlanmış değildir.


## Paketler arası veri geçişi ve geri dönüş provası — 28 Eylül 2026
Yeni test:update komutu eski yerel paketi ve güncel üretilmiş paketi yalnız yeni test verisinde çalıştırır. İşletme hesabı, ürünler, destek, sipariş, kısmi nakit tahsilatı ve kalan borç yeni pakette korundu. Aynı ödeme isteği yeniden kontrol edildiğinde çoğalmadı. Eski yedekten ayrı klasöre geri dönüş aynı kayıtları korudu; güncelleme sonrası destek kaydı doğal olarak eski yedekte yoktu. Kaynak ve aday veritabanı özetleri geri dönüş sırasında değişmedi. İlk mali prova kurulumda mevcut masaları azaltmayı denediği için doğru şekilde reddedildi; test mevcut masa sayısını koruyacak biçimde düzeltildi. Tip kontrolü, derleme ve genişletilmiş prova geçti. Sonuç .local/tests/update-rehearsal-fAu1fw/result.json; aday paket .local/packages/mola-pilot-1790570254243-0a07796e. İki paket de 0.1.0: gerçek şema sürümü geçişi, tüm finansal senaryolar, otomatik canlı güncelleme veya temiz Windows kurulumu tamamlanmış sayılmaz.

## Veri biçimi sürüm koruması — 28 Eylül 2026
Store yazmaya başlamadan SQLite user_version denetler; 0 eski işaretsiz biçim, 1 mevcut biçimdir. Geçişler tamamlandıktan sonra mevcut indeks işlemiyle aynı transaction içinde işaretlenir. Bilinmeyen sürümde bağlantı kapanır, journal/şema değişmez. Yedek doğrulaması da sürümü denetler. Eski verilerin kayıtları korunarak işaretlendiği, sürüm 999 verisinin dosya içeriği ve journal modu değişmeden reddedildiği test edildi. 164 test, tip kontrolü, derleme ve paket geçiş/geri dönüş provası geçti. Sonuç .local/tests/update-rehearsal-g602jD/result.json; aday .local/packages/mola-pilot-1790571425204-3b758cfc. Eski korumasız paketlerin yeni veriyi açmasını geriye dönük engellemez; canlı veri üzerinde sürüm düşürme yapılmamalıdır.

## Aday pakete göre veri uyumluluk ön kontrolü — 28 Eylül 2026
Çalışma zamanı ve paket ortak data-format.json bildirimi kullanır. Güncelleme kontrolü adayın manifest içindeki bildirimini doğrular; SQLite sürümünü salt okunur okuyarak adayın aralığıyla karşılaştırır. Eski paket bildirimsiz olabilir; yeni aday bildirimsiz kabul edilmez. Beş hedefli test, tip kontrolü, derleme ve gerçek yerel paketlerle geçiş/geri dönüş provası geçti. Sonuç .local/tests/update-rehearsal-knDJg7/result.json; aday .local/packages/mola-pilot-1790571562410-a97a8b09. Kontrol aday kodunu çalıştırmaz; sürüm aralığı tüm geçişlerin doğru olduğunu kanıtlamaz.

## Teslim öncesi kurulum raporu — 28 Eylül 2026
pilot:check mevcut veritabanının user_version ve SQLite quick_check sonucunu salt okunur kontrol eder; kilitli/yarım geri yüklenmiş veriyi incelemeyi atlar. --report ile tarihli JSON sonucu yeni dosyaya kaydeder, üzerine yazmayı reddeder. İki kurulum testi, tip kontrolü, derleme ve temiz paket provası geçti. Kapalı test verisinde rapor oluşturma ve ikinci çalıştırmada dosyanın değişmeden kalması doğrulandı. Rapor .local/tests/pilot-check-20260928.json; paket .local/packages/mola-pilot-1790571696316-333c279b. SQLite bütünlüğü şifreli kayıtların açılması veya üretim onayı değildir. Canlı veri değiştirilmedi.

## Kart teması, özel masa bölümleri ve katalog silme — 28 Eylül 2026
Ürün düzenleme ve kampanya düzenlemeye kırmızı çöp kutulu silme düğmeleri, açıklamalı onay ve belirsiz yanıtta aynı isteği kontrol etme eklendi. Sunucu yalnız işletme sahibini kabul eder, menü sürümünü kontrol eder ve tekrarı tek işlem sayar. Ürün/taslak menüden kaldırılır; sipariş, ödeme ve arşivler değiştirilmez. Kampanya silinirken rapor geçmişi korunur. Süresi dolan kampanyalar otomatik gizlenmez.
Masa ekleme ve masa ayrıntısında İç/Dış/Bölümsüz kartları ve Yeni + ile 40 karaktere kadar özel bölüm adı seçimi eklendi. Üst kat gibi bölümler masalar ekranında kendi başlığıyla görünür; garson seçicisinde doğru ad gösterilir. Bölüm adları masaların üzerinde saklanır; boş bağımsız bölüm kataloğu yoktur.
Ayarlar iki sütunlu açıklamalı kartlara, ek araçlar açılabilir kartlara dönüştürüldü. Çalışanlar görev açıklaması ve yetki bilgi balonuyla kart düzeninde. Mobil görünüm tek sütuna iner. Masa numarası/QR değişmez.
167 birim/API testi, tip kontrolü ve derleme geçti. Yeni tarayıcı senaryosunda özel bölümün yenileme sonrası korunması, silmeden vazgeçme, kayıp yanıttan sonra güvenli silme, bitmiş kampanyayı kaldırma ve mobil taşma kontrol edildi. Yönetim paketinin 10 senaryosu ayrı temiz veride geçti. İlk birlikte çalıştırmada ürün silme testi diğer paketin örnek ürününü kaldırdığı için senaryolar ayrıldı; eski select seçicisi kart düğmesine güncellendi. Masaüstü/telefon görüntüleri incelendi. Yerel HTTP sunucusu güncel kodla yeniden başlatıldı (PID 49896, exec 54884); mevcut işletme verisi silinmedi.

## Fotoğraf alanı ve düzenleyici işlem satırları — 28 Eylül 2026
Fotoğraf alanı içeriği bağımsız dolgulu gövdeye alındı; kullanım özetinde taşan büyük tutar küçültüldü, üç dar sütun yerine okunabilir dikey bilgi kartları ve aralıklı işlem düğmeleri kullanıldı. Ürünü sil, Vazgeç ve Önizleme arasına, önizlemenin hemen soluna taşındı. Kampanya düzenleyicisi kampanya/indirim, adet seçenekleri, süre, ürünler ve uygulama tercihleri bölümlerine ayrıldı. Kaydet/Vazgeç sağda ve sil solda, telefonlarda taşmadan satırlara ayrılan sabit alt işlem alanında. Tip kontrolü, derleme ve yönetim kartları tarayıcı testi geçti; masaüstü/telefon ekran görüntüleri incelendi.


## Tüm zamanlar raporları ve büyük geçmiş hesabı — 28 Eylül 2026
Ortak dönem seçicisine Tümü eklendi; özel tarih seçimi korunur. Finansal/ürün, çalışan ve masa tahsilat raporları kayıtlı tüm geçmişi kapsar. Özel tarih için 366 günlük sınır devam eder. Tüm zamanlar grafiği yalnız tahsilat olan günleri sıralı gösterir; boş veri güvenle işlenir. Eski tahsilatların kampanya payı için her ödeme başına tüm siparişleri taramak yerine hesap/sipariş/kalem indeksi kullanılır. Hesaplar arası veya bulunamayan seçimler bilinmeyen tutar olarak kalır. 10.000 sipariş ve 10.002 tahsilatla hesap doğruluğu, yıllar öncesi arşiv kayıtları ve karışık tarih modlarının reddi doğrulandı. Tip kontrolü, 169 birim/API testi, derleme ve rapor tarih/scroll tarayıcı senaryosu geçti. Bu test uçtan uca çok yıllık yük veya eşzamanlı kullanıcı kapasitesi ölçümü değildir.


## İşletmeye özel hazır renk paletleri — 28 Eylül 2026
Ana panel > İşletme > Kurulum ve bilgiler > İşletme adı, logo ve görünüm bölümüne Adaçayı, Kahve-Krem, Lacivert ve Bordo seçimi ile küçük önizleme eklendi. Seçim mevcut profil sürümü/idempotency denetimiyle saklanır; geçersiz palet ve işletme hesabından ana panel değişikliği reddedilir. Eski profil istekleri tema alanı göndermediğinde mevcut seçim korunur. Tema yalnız ilgili işletmenin panel, ilk kurulum, müşteri menüsü ve iframe menü önizlemesine kapsamlı CSS değişkenleriyle uygulanır; durum/uyarılar ve veri grafikleri anlam renklerini korur. Bu sürüm serbest renk düzenleyicisi veya tüm dekoratif renklerin yeniden tasarımı değildir. Logosu olmayan müşteri menüsünde işletme adı gösterilir; ürün yer tutucudaki MOLA SELECTION metni MENÜ oldu. Çalışan kartlarının soluk rol simgeleri de ana renk değişkenini kullanır. Tip kontrolü, 169 birim/API testi, derleme ve platform profil tarayıcı testi başarılı. İlk görsel testte eski müşteri arka plan kuralının paleti ezmesi düzeltildi; yeniden doğrulamada panel/menü rengi, kaydedilmiş seçim ve mobil taşma kontrol edildi. Yerel sunucu yeniden başlatıldı.


## Ana panelde açık gezinme ve işletme yönetim kartları — 28 Eylül 2026
Üstteki birbirine benzer düğmeler yerine masaüstünde açıklamalı yan gezinme, mobilde simgeli bölüm kartları eklendi. İşletme arama/filtre/sıralama ve oluşturma tek araç alanında toplandı. İşletme ayrıntıları Lisans ve hizmet, Görünüm ve kimlik, Kurulum ve bilgiler, Hesap erişimi kartlarına ayrıldı. İsim/logo/palet artık kurulumun altında kapalı bir açıklamada değil, doğrudan Görünüm ve kimlik ekranında. Lisans işlemleri, güvenlik kartları, bildirim ve denetim listeleri ortak aralık/kart düzenine alındı. Mobil/masaüstü görüntüler incelendi. Tip kontrolü, derleme ve altı ilgili tarayıcı senaryosu (profil, filtre, destek, kayıtlar, şifre, MFA) başarılı. API veya canlı işletme verileri değiştirilmedi; arayüz yerel geliştirme sunucusunda güncel.


## Geniş palet ve işletmeye özel karşılama — 28 Eylül 2026
Palet sayısı 16 oldu; ana düğme ve gövde metninin kontrast oranları otomatik doğrulandı. Menü karşılama alanının Türkçe/İngilizce başlığı, açıklaması ve kahve/çay/yemek/tatlı simgesi işletme profiline eklenir. Müşteri ve önizleme aynı bileşeni kullanır. Fotoğrafsız ürünlerde çemberi kaydıran transform kaldırıldı; simge ve çember merkezleri tarayıcıda ölçüldü. 170 birim/API testi, tip kontrolü, derleme ve profil tarayıcı senaryosu geçti. HTTP sunucusu güncellendi.

## Görünüm değişikliklerini kaybetme koruması — 28 Eylül 2026
Görünüm formunda değişiklik durumu ve sabit kaydet satırı gösterilir. Sekme değiştirme, destek geçişi, kapatma ve Escape; kaydedilmemiş değişiklik varsa düzenlemeye devam et/bırak seçenekleri sunar. Sayfa yenileme ve sekme kapatma için tarayıcı beforeunload uyarısı yalnız değişiklik varken bağlanır; kalıcı taslak değildir. Başarılı kayıtta alanlar güncel sunucu verisiyle yeniden açılır ve onay gösterilir. Kayıp kayıt yanıtı aynı istekle kontrol edildiğinde form sürümü ve kirli durum da sıfırlanır. Tip kontrolü, derleme ve genişletilmiş profil tarayıcı testi geçti: devamda metin korunması, Escape, açıkça bırakma ve sunucuda kayıttan sonra bağlantı kesilerek yeniden kontrol doğrulandı.


## İsteğe bağlı yönetim ekranları ve açılış paketi — 28 Eylül 2026
Raporlar, Ayarlar ve Entegrasyonlar lazy import ile yalnız açıldıklarında yüklenir; Suspense ekran yüklenirken ana gezinmeyi korur. Bölüm hata sınırı dosya yükleme hatasında açıklama ve elle yenileme sunar. Rapor doğrulama kapısı korunur. İlk JS 503,65 KB / gzip 150,34 KB değerinden 440,02 KB / gzip 134,15 KB değerine indi; ilk CSS 109,59 KB yerine 80,83 KB. Bunlar Vite derleme boyutlarıdır, gerçek cihaz süre ölçümü değildir. Tip kontrolü, derleme ve üç tarayıcı senaryosu geçti: yeni gecikmiş/başarısız dosya yükleme, rapor scroll ve yönetim kartları. Yeni test ilk açılışta üç ekranın JS dosyalarının istenmediğini, raporun ilk açılışta bir kez indirildiğini ve hatada Masalar ekranına dönülebildiğini doğrular.


## Müşteri ve personel ekranlarının ayrı yüklenmesi — 28 Eylül 2026
App yalnız yönlendirmeyi yapar; Customer ve Workspace ayrı dosyalara taşındı. Personel ekranı, ana panel ve menü önizlemesi gerektiğinde yüklenir. İlk JS 440,02 KB / gzip 134,15 KB yerine 274,58 KB / gzip 86,93 KB; ilk CSS 70,13 KB. QR menüsü ve ürün ayrıntısı açılırken Workspace/Platform/SalesReports/SettingsPanel/Integrations/Support JS-CSS dosyalarının istenmediği doğrulandı. Gerçek cihaz süre ölçümü değildir. Geniş akış testinde logosuz işletme adının 320/390 px ekranlarda taşması bulundu; başlık küçülebilir ve satıra bölünebilir hale getirildi. Tip kontrolü, derleme, 2 yükleme senaryosu, 10 sipariş/yönetim/mutfak akışı ve ana panel profil senaryosu geçti. Arka uç veya işletme kayıtları değiştirilmedi.


## Destek kapatma, logo hizalama ve Google değerlendirmesi — 28 Eylül 2026
Ana panel destek görüşmesinde soldaki “Sorun çözüldü, talebi kapat” düğmesi ayrı bir işlem olarak çalışır; boş yanıtta otomatik kapanış mesajı gönderir. Yanıt gönder sağdadır. Kayıp yanıt aynı istek kimliğiyle tekrar kontrol edilir; kapanış mesajı çoğalmaz.
Görünüm ve kimlik bölümünde logo için kare şeffaf önizleme, yakınlaştırma, yatay/dikey konum ve yeniden düzenleme eklendi. Ürün ve logo düzenleyicisindeki her kontrolün ayrı Sıfırla düğmesi vardır. Logo menü başlığında sabit bir çerçevede işletme adıyla birlikte görünür. Şeffaf PNG yükleme, WebP dönüşümü, sunucuda yeniden sıkıştırma ve düzenleyicide tekrar açma sonrasında alfa kanalı test edildi. Kaydedilmiş logo tekrar açıldığında ilave iç boşluk eklenmez. Mevcut resmin arka planı otomatik kaldırılmaz; kaydedilmiş kırpımın dışındaki pikseller geri getirilemez.
İşletme oluşturma ve lisans uzatmaya 6 ay eklendi. Google değerlendirme bağlantısı Görünüm ve kimlik bölümünden girilir; müşteri menüsü ve önizlemenin altında ayrı sekmede açılan düğme gösterilir. Boşsa görünmez. HTTPS ve desteklenen Google alan adları doğrulanır; API anahtarı veya ücretli servis kullanılmaz.
Doğrulama: tip kontrolü, üretim derlemesi, 171 birim/API testi ve 12 tarayıcı senaryosu (10 akış, destek, profil) geçti. Yeni sıfırlama düğmesi nedeniyle belirsizleşen eski test seçicisi slider rolüne daraltıldı. Mobil menü ekran görüntüsü incelendi. Yerel sunucu güncel kodla localhost:3000 üzerinde yeniden başlatıldı. Canlı işletme ayarları test amacıyla değiştirilmedi; tarayıcı testleri izole veritabanında çalıştı.


## Aşamalı giriş ve sipariş sonrası değerlendirme — 28 Eylül 2026
Ana panel ve işletme girişinde önce kullanıcı adı/şifre, yalnız doğru bilgiler ve etkin Authenticator varsa ayrı kod ekranı gösterilir. Doğrulama öncesinde oturum verilmez. Kod adımında credentials yalnız bileşen belleğinde tutulur, yeniden sunucuda doğrulanır; geri dönüş, başarı veya yenilemede kod temizlenir. Kurtarma kodları tek kullanımlı tüketilir. İşletmenin mevcut mali rapor Authenticator ayarı artık girişte de uygulanır; raporların ayrı doğrulama kapısı korunur. Giriş indeksi yalnız mfaEnabled bayrağı taşır, gizli anahtarları içermez; başlangıçta mevcut kayıtlarla eşitlenir. Kod denemeleri mevcut giriş hız sınırına tabidir.
Google değerlendirme bağlantısı tanımlıysa müşteri sipariş başarı penceresinde de gösterilir; ayrı sekmede açılır ve sipariş akışını zorunlu olarak yönlendirmez. share.google bağlantıları da desteklenir.
Tip kontrolü, derleme, 171 birim/API testi ve üç ilgili tarayıcı senaryosu geçti: ana panel MFA, işletme MFA ve profil/sipariş sonrası bağlantı. Yerel sunucu güncel kodla yeniden başlatıldı.


## Mutfakta iptal talebi onayı — 29 Eylül 2026
Mutfak kartında yalnız işletme sahibine gösterildiği için erişilemeyen iptal onayı düzeltildi. Bekleyen talep yanında küçük İptali onayla düğmesi bulunur. Mutfak yalnız new/preparing/ready durumlarında müşterinin mevcut iptal talebini onaylayabilir; talep olmayan siparişi iptal edemez. Sürüm, hesap, işletme ve ödeme denetimleri korunur. İşlem audit kaydına eklenir. Tekrar deneme aynı işlem kimliğini kullanır; işlem sürerken düğme kilitlidir. Hazırlama düğmesinin mevcut davranışı değiştirilmedi.
Tip kontrolü, üretim derlemesi, 171 birim/API testi ve yeni tablet mutfak tarayıcı senaryosu başarılı. Mutfak yetkisi, talep yokken ret, garson için ret, tekrarın aynı sonucu vermesi ve sunucu işlemi sonrası kaybolan yanıt doğrulandı. Sunucu localhost:3000 üzerinde güncellendi.


## İptal talebini açıklamayla reddetme — 29 Eylül 2026
Mutfaktaki küçük iptal alanında Reddet seçeneği eklendi. Açılan satır içi form 3–200 karakter açıklama ister; müşterinin siparişinde iptal onaylanmadı metni ve açıklama gösterilir. Sipariş durumu ve tutarı değişmez. Yeni bir iptal talebi açılırsa önceki ret açıklaması temizlenir. Sunucuda owner/kitchen yetkisi, açık hesap, new/preparing/ready durumu, bekleyen talep ve sürüm kontrolü yapılır; sonuç aynı istek kimliğiyle tekrar alınabilir, audit kaydı tutulur. Belirsiz ağ sonucunda form başka bir işleme çevrilemez.
171 birim/API testi, genişletilmiş mutfak tarayıcı senaryosu, tip kontrolü ve derleme geçti. Yerel sunucu güncellendi.


## İptal talebi sonuçlanmadan hazırlık/teslim engeli — 29 Eylül 2026
Bekleyen iptal talebi varken new → preparing, preparing → ready ve ready → served geçişleri CANCELLATION_PENDING ile reddedilir. Mutfak ve garson düğmeleri açıklamalı şekilde pasiftir. Ret sonrası mevcut ödeme/değişiklik süresi koşullarıyla tekrar açılır. 175 birim/API testi, mutfak tarayıcı testi, tip kontrolü ve derleme başarılı. Yerel sunucu güncellendi.


## Müşteride iptal durumunun açık gösterimi — 29 Eylül 2026
Sipariş kartında simgeli ve temaya uygun durum alanı eklendi: onay bekliyor, iptal edildi veya onaylanmadı ve işletmenin açıklaması. Bekleyen talebin henüz iptal olmadığı belirtilir. Sonuç geldikten sonra eski talep gönderildi bildirimini üstte tutan davranış kaldırıldı. Türkçe/İngilizce sistem metinleri bulunur; işletmenin yazdığı ret açıklaması değiştirilmez. Tip kontrolü ve derleme başarılı.


## Toplu doğrulama — 29 Eylül 2026
32 tarayıcı grubundaki 65 senaryo, ilk tarama ve iki etkilenen grubun tekrar çalıştırılmasıyla doğrulandı. Hesap kapandıktan sonra iptal kurtarma sonucu görünmeme sorunu düzeltildi. Eski destek checkbox testi yeni düğme akışına uyarlandı. Güncel temiz paket provası geçti. Ayrıntılar TOPLU_TEST_2026-09-29.md dosyasındadır.


## QR menüsünde Yeni sekmesi — 29 Eylül 2026
Yeni oluşturulan ürünün ilk yayın tarihi sunucuda tutulur. Taslakta süre başlamaz; ilk yayın sonrası 30 gün Yeni sekmesinde görünür, daha sonra normal kategorisinde kalır. Düzenleme, yayından kaldırma/tekrar yayınlama ve tekrar gönderim tarihi yenilemez. Tarihi bilinmeyen eski ürünler ve başlangıç şablonu yeni sayılmaz. Sıralama en yeni yayından eskiye doğrudur. Sunucu her menü cevabında süreyi hesaplar; cron gerekmez. Boş sekme gizlenir; açıkken son ürünün süresi dolarsa Tümü seçimine dönülür. Müşteri menüsü ve menü önizlemesi aynı filtreyi kullanır. 176 birim/API testi, yeni QR tarayıcı senaryosu, tip kontrolü ve derleme geçti. Yerel sunucu güncellendi.


## Menü sekmelerinde küçük simgeler — 29 Eylül 2026
Ortak menü bileşeninde Tümü/ana kategoriler, Yeni (yıldız), Popüler ürünler (yükselen çizgi) ve Kampanyalı ürünler (panelle aynı Tags) sekmelerine 13–14 px ince çizgi simgeler eklendi. Metin etiketleri korunur, dekoratif simgeler erişilebilir ada dahil edilmez. Tema renkleri, satıra sarılma ve klavye odak çerçevesi korunur. 390 px ekran görüntüsü incelendi; 320 px ve 768 px taşma kontrolleri dahil temel akış testleri çalıştırıldı. Tip kontrolü ve derleme başarılı. Sunucu değişikliği yok; yerel arayüz otomatik güncellendi.


## Sipariş onayından takibe geçiş — 29 Eylül 2026
Müşteri sipariş başarı penceresine Siparişimi takip et / Track my order düğmesi eklendi. Siparişlerim sekmesini açar, klavye odağını sekmeye taşır; yeni sipariş isteği oluşturmaz. Tamam düğmesi ve isteğe bağlı Google değerlendirme bağlantısı korunur. Personel sipariş ekranının davranışı değişmedi. Tip kontrolü, derleme ve sipariş gönderimi, değerlendirme bağlantısı, takip ekranı ve odak kontrolünü içeren profil tarayıcı senaryosu geçti.


## Müşteri takip kartlarında durum renkleri — 29 Eylül 2026
Yeni/onay bekleyen/hazırlanan sipariş kartları pastel sarı, hazır/teslim edilen kartlar pastel yeşil, iptaller nötr pembe zeminde gösterilir. Durum etiketi aynı anlam renginde simge ve metin içerir. Anlam renkleri işletme paletinden bağımsızdır. Durum sunucu güncellemesiyle otomatik yansır. Gerçek mutfak hazırlama/hazır geçişinde CSS renkleri doğrulandı ve mobil ekran görüntüsü incelendi. Tip kontrolü ve derleme geçti.


## Müşteri menüsünde görünürlüğe bağlı yenileme — 29 Eylül 2026
Müşteri menüsünün zamanlanmış GET yenilemeleri document.hidden olduğunda durur; visibilitychange ve online olaylarında görünürse hemen kontrol edilir. Yavaş yanıt bitmeden sonraki zamanlanmış sorgu başlamaz. Açıkken yanıt sonrası iki saniyede kontrol sürer. Sipariş gönderimleri, mutfak ses/heartbeat akışı değiştirilmedi. Devam eden sorgu gizlenince iptal edilmez. Tarayıcı testinde görünürlük durumu simüle edilerek bekleme ve dönüş, geciktirilmiş yanıtta üst üste sorgu olmaması doğrulandı; fiziksel telefon kilidi testi değildir. Tip kontrolü ve derleme başarılı.


## Gecikmiş müşteri yanıtına karşı koruma — 29 Eylül 2026
Müşteri durum okumaları sıra numarasıyla korunur. Daha yeni okuma başlatılmışsa önceki cevabın verisi veya hatası uygulanmaz. Ekran/oturum temizliğinde bekleyen cevaplar geçersizleşir. Yeni siparişten önce alınmış cevabın bekletilip sipariş gönderiminden sonraki cevaptan sonra döndürülmesi test edildi; sipariş kartı korunur. Tip kontrolü, derleme ve iki yenileme tarayıcı senaryosu geçti.


## 30 Eylül 2026 — İşletme panelinde gecikmiş yanıt koruması
- Personel durum okumaları sıralandı; daha eski başarı/hata yanıtları güncel görünümü değiştiremez.
- Arka plan sorgusu sürerken yeni periyodik sorgu başlatılmaz; işlem sonrası yenilemeler beklemeden çalışabilir. Mutfak arka plan takibi korunur.
- Çıkış başladığında bekleyen okumalar geçersizleşir. Başarılı çıkıştan sonra sorgulama durur, tekrar girişte açılır. Başarısız çıkış paneli kapatmaz ve tekrar denenebilir.
- Doğrulama: typecheck ve production build başarılı. staff-polling 2/2 (yavaş sorgu, gecikmiş yanıt, çıkış, farklı rolle tekrar giriş, başarısız çıkış tekrarı); flows 10/10 tarayıcı senaryosu başarılı.


## 30 Eylül 2026 — Ana panel oturum ve gecikmiş yanıt koruması
- Platform durum okumalarında eski başarı/hata yanıtları elenir; bekleyen sorgu varken periyodik sorgular birikmez.
- Çıkış ve güvenlik ayarı sonrası oturum kapanışı bekleyen okumaları geçersizleştirir. Yeniden giriş okumaları tekrar açar; başarısız çıkış tekrar denenebilir.
- Çıkış düğmesi sürmekte olan/belirsiz işlemlerde pasiftir. Kaydedilmemiş görünüm değişikliklerinde mevcut ayrılma uyarısı kullanılır.
- Doğrulama: typecheck ve build başarılı. Güncel derlemede platform-polling 2/2, platform-mfa 2/2 başarılı. İlk polling çalışması build tamamlanmadan eski dist ile başlatıldığı için başarısız oldu; derleme sonrası tekrar doğrulandı.


## 30 Eylül 2026 — Tahsilatta ürün listesinin bağlantı hatasından toparlanması
- Ürün seçerek ödeme listesi yüklenirken erişilebilir durum metni gösterilir.
- Ürün listesi okunamazsa aynı pencere içinde Yeniden yükle düğmesi kullanılabilir. Yeni okumada eski hata ve seçimler temizlenir; yüklenmeyen listeyle tahsilat yapılamaz.
- Yeniden yükleme yalnız okuma yapar, tahsilat oluşturmaz.
- Doğrulama: typecheck/build başarılı; payment-recovery 5/5. Bağlantı hatasından pencere kapatmadan toparlanma, kayıt oluşturmadan ürün seçebilme, kayıp ödeme yanıtı, kısmi ödeme, çalışan değişimi ve eski hesap sürümü senaryoları geçti.


## 30 Eylül 2026 — Açık tahsilat ekranında hesap değişikliği
- Başka bir işlem hesabın sürümünü değiştirdiğinde açık tahsilat ekranı kalan tutarı gösterir ve yeni tahsilattan önce Güncel hesabı kullan düğmesiyle inceleme ister. Yazılmış tutar sessizce değiştirilmez.
- İnceleme sonrasında tutar güncel bakiyeye alınır ve ürün seçimi temizlenir. Aynı ekrandaki başarılı kısmi ödeme akışı ek inceleme gerektirmez; belirsiz tahsilatın özgün işlem kimliği korunur.
- Doğrulama: typecheck/build başarılı; payment-recovery 6/6. Yeni senaryoda diğer kasiyer 170 TL hesabın 85 TL kısmını öder, açık ekran tahsilatı kilitler ve inceleme sonrası yalnız kalan 85 TL alınır.


## 30 Eylül 2026 — Güncel toplu test ve pilot paketi
- test:all başarılı: 176 birim/API testi, 36 tarayıcı grubu ve 74 senaryo; typecheck, build ve paket doğrulaması geçti.
- Rapor: TOPLU_TEST_2026-09-30.md.
- Güncel paket: C:\Users\yesbo\OneDrive\Masaüstü\kafe uygulama\.local\packages\mola-pilot-1790759981814-bd88b966


## 30 Eylül 2026 — Yerel işletim provaları
- Önceki yerel paketten güncel pakete geçiş ve yedekten geri dönüş başarılı.
- Yerel HTTPS güvenlik testi başarılı.
- Ayrı veride 20 eşzamanlı misafir, 180 istek ve 80 sipariş: hata yok.
- Ayrıntılar ve sınırlar TOPLU_TEST_2026-09-30.md belgesine eklendi.


## 30 Eylül 2026 — Okunabilir kurulum kontrolü
- pilot:check için --summary eklendi; teknik JSON/--report davranışı korundu.
- Paket başlatıcısı Türkçe özet kullanır ve başarısız kontrolde pencereyi açık tutar.
- Geçersiz portla hata/rapor yazma, geçerli portla başarılı özet doğrulandı; typecheck ve paket testi geçti.
- Güncel paket: .local/packages/mola-pilot-1790762482841-2d898eea


## 30 Eylül 2026 — Tek komutla doğrulanmış yedek
- backup create-verified eklendi: hedef kontrolü, şifreli yedek, ayrı geri yükleme, ardından verification.json.
- Kaynak verinin korunması, başarılı doğrulama kaydı, çalışan sunucu kilidi ve çakışan hedef reddi iki testle doğrulandı; typecheck geçti.
- Zamanlanmış görev veya canlı yedekleme kurulmadı.


## 30 Eylül 2026 — Yerel paket planı ve doğrulama hata kaydı
- Modüler hizmetler ve yerel süresiz sürüm, çekirdek tamamlandıktan sonra ve fiyatlandırma/teslim belgelerinden önce uygulanacak aşama olarak satışa hazırlık planına eklendi. Henüz uygulanmadı.
- Doğrulanmış yedekte geri yükleme/başarı kaydı hatası için gizli içerik taşımayan verification-failed.json eklendi; arşiv korunur, hata yayılır.
- Typecheck ve 3 doğrulanmış yedek testi geçti.


## 30 Eylül 2026 — Kurulumda yedek doğrulama görünürlüğü
- Son tamamlanmış yedeğin prova durumu teknik çıktıya ve Türkçe özete eklendi.
- Başarısız/geçersiz/eksik kayıtlar ayrı uyarılar verir; kayıt varlığı yeniden doğrulama olarak sunulmaz.
- Tarih, konum ve dosya sayısı uyumsuzluğu test edildi. Typecheck ve ilgili 5 test başarılı.

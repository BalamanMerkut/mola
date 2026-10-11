# Satışa hazırlık — güncel durum

Bu liste 30 Eylül 2026 itibarıyla güncellenmiştir. `arsiv/KALAN_ISLER.md` önceki kapsamın tarihsel listesidir; güncel tamamlanma durumu olarak kullanılmamalıdır.

## Çalışan yerel kapsam

- QR menü/sipariş, garson ve mutfak akışı, kısmi tahsilat, masa yönetimi.
- Menü, fotoğraf düzenleme, kampanya ve raporlar; hesap rolleri ve rapor doğrulaması.
- Mola Merkez + Mola Yönetim: işletme ekleme (etkinleştirme kodu), ücretsiz deneme, imzalı lisans, dondurma, destek. Profil ve sahibin şifre kurtarması kafede (3 Ekim, Merkez ayrımı).
- Ayrı işletme şifreleme anahtarları, yönetim ve giriş özetleri, indeksli hesap arama.
- Şifreli yedek, ayrı klasöre doğrulanmış geri yükleme, yarım geri yüklemeden açılış engeli.
- Temiz kafe şablonu ve yerel pilot paketi; kurulum öncesi bütünlük/port/veri klasörü kontrolleri.

## Son tamamlanan akışlar — 29 Eylül

- Ana panel ve işletme hesabında şifre sonrası ayrı Authenticator/kurtarma kodu ekranı.
- 6 aylık lisans, 16 renk paleti, işletmeye özel karşılama ve şeffaf logo hizalama.
- Ürün ve logo düzenleyicisinde bağımsız konum/yakınlaştırma sıfırlama.
- Google değerlendirme bağlantısı: menü altında ve sipariş başarı penceresinde; share.google dahil.
- Destek talebini ayrı tek tık işlemle kapatma.
- Mutfakta iptal talebini onaylama veya açıklamayla reddetme; sonuç müşteriye yansır.
- Bekleyen iptal talebinde hazırlık/teslim engeli; tablet ve müşteri mobil görünümü doğrulanır.

## 2 Ekim eklemeleri

- **Garson çağır / Hesabı iste:** Müşteri menüsünde iki küçük düğme. Masa başına her tür için tek açık çağrı; garson ve kasiyer ekranının üstünde çağrı şeridi ve kısa ses, masa kartında zil. Hesap kapanınca veya masa taşınınca çağrı kendiliğinden düşer. Engelli tarayıcı çağrı yapamaz.
- **Fiş yazıcısı (ESC/POS):** Ağ (9100 portu) ve Windows USB yazıcıları. Kategoriye göre bar/mutfak ayrımı, 58/80 mm, Türkçe karakter (kod sayfası 857) veya sade harf seçeneği, deneme fişi, otomatik yeniden deneme, iptal fişi, mutfakta yeniden yazdırma, kasada bilgi amaçlı hesap fişi. Gerçek yazıcıyla henüz denenmedi; sahte ağ yazıcısıyla uçtan uca doğrulandı. Yazdırma sunucunun çalıştığı bilgisayardan yapılır.
- **Sadece QR menü paketi:** Ana panel → İşletme → Lisans → Hizmet paketi. Sepet, sipariş ve çağrılar sunucuda da kapanır; menü açık kalır.
- **Hata kayıtları:** Kalıcı, işletme bazında, 7 gün. Kayıtta hatanın koddaki yeri bulunur; veri bulunmaz. Ana panelden indirilip geliştiriciye gönderilir.
- **Geliştirici rehberi:** `docs/GELISTIRICI_REHBERI.md`.

## 2 Ekim, ikinci tur

- Kasada hesap fişi ve ödeme fişi (ödeme penceresinden), ayırt edilebilir üç bildirim sesi, Ayarlar → Bildirim sesleri.
- Güvenlik sertleştirmesi: adres (/64) bazlı sınırlar, masa başına en fazla 20 başlamamış QR siparişi, katı /media yolu, `dev:lan` kaynak kodu vermiyor, demo şifresi istemci kodunda yok. Ayrıntı: `docs/GELISTIRICI_REHBERI.md` → Güvenlik notları.
- Ana panel → İşletme → Kurulum: tek masanın QR kodunu acil durumda yenileme (eski QR hemen geçersiz olur).
- Arayüz: telefonda küçük karşılama alanı, sabit "Sepete ekle", hatırlanan dil, garsonun her ekranında onay kuyruğu, net masa durumları, sıkışık personel ürün kartları, büyük mutfak yazıları, iptal talebinde ana düğme "İptali onayla", ekranı açık tut varsayılan açık, ödemede Tamamı/Bir kısmı/Ürün seç, tek "Taşı / birleştir", Entegrasyonlar gizli (geliştirici ayarıyla açılır), ayarlar kendiliğinden kaydedilir, çalışan kullanıcı adı ad soyaddan oluşur, askıya alma ve "Sadece QR menü" iki aşamalı onay ister, dondurma talepleri işletme kartında görünür.

## 3 Ekim eklemeleri (ikinci tur)

- **Sektörler:** Kurulumun ilk adımı "İşletme türü: Kafe / Restoran / Tatlıcı-Pastane". Her biri kendi hazır menüsü ve ürün çizimleriyle gelir. Örnek veri: `npm.cmd run demo:template -- <klasör> --sektor=kafe|restoran|tatlici`.
- **Masasız sipariş (tezgâh satışı):** ayarı yok, her işletmede açık. Sipariş al ekranında (işletme sahibi, kasiyer, garson) masa listesinin üstündeki ilk seçenek "Masasız sipariş": masaya bağlı olmayan satış, tezgâhtan alıp giden ya da ayakta bekleyen müşteri. Günlük numara (Masasız #12), mutfakta "MASASIZ #12" olarak belirgin, ödeme tezgâhta. Masalar'da yalnız açık masasız sipariş varken küçük bir şerit görünür. Masa planını ve QR'ları etkilemez. Eve teslim (paket servis) değildir; o ileride entegrasyonlarla gelecek.
- **Paketlensin:** masadaki müşteri sepette "Paketlensin (yanımda götüreceğim)" diyebilir; mutfakta "PAKETLENECEK", fişte kalın satır.
- **Not örnekleri ürüne göre:** çayda "Örn. açık demli, limonlu", kahvede "Örn. az sütlü, ekstra sıcak", yemekte "Örn. soğansız, az pişmiş".
- **Ürün notu** (müşteri ve garson, mutfak ekranı ve mutfak fişinde) ve **kilo ile satış** (₺/kg, 250 g · 500 g · 1 kg veya gram; raporlarda toplam ağırlık).
- **Kampanyalar:** belirli günlerde/saatlerde tekrarlayan kampanya (ör. her hafta sonu, 5 hafta). Raporda "Kampanyasız tutar".
- **İade ve düzeltme:** tek tahsilat defteri (bugün, en yeni üstte, masa/tutar/saat araması, Nakit/Kart/Düzeltilenler).
- **Giderler:** işletme sahibi de gider ekler (kira, elektrik, maaş).
- **Fiş:** normal (A4, lazer/mürekkep) yazıcılar için "Normal yazıcı (A4)" türü; termal fiş yazıcıları ESC/POS ile devam eder.
- **İngilizce menü:** kategori ve alt kategoriler sözlükle çevrilir, işletme kendi İngilizce adını da verebilir.
- **Garson çağrısı ve hesap isteme:** garson ekranında her yerde; sahip ve kasiyerde yalnız Masalar'da.
- **Uzun süreli kullanım:** 1,3 yıllık yoğun veride tablet donmaları 2,9 sn'den en kötü 0,33 sn'ye indi; bellek 560 MB'tan 380 MB'a; gece yedeği kafeyi dondurmuyor; ekranlar değişmeyen veriyi yeniden indirmiyor.
- **Bilinen açıklar:** Ana panel işletme listesinde sektör görünmüyor; Masalar'dan "Ödemeyi düzelt" kısayolu yok; ürün açıklamaları ve seçenek adları İngilizceye çevrilmiyor; geçmiş satırlarını sıkıştırma (diski ~3,5 kat azaltır) veri sürümü 3 olarak bekliyor.

## 3 Ekim eklemeleri

- **Hız (geçmişi ayrı saklama):** Kapanmış hesaplar, giderler, düzeltmeler ve işlem kayıtları ayrı şifreli satırlara taşındı, raporlar gün sonu özetlerinden okunuyor. 20.000 hesaplık geçmişte bir işlem 2,3 sn'den 2 ms'ye indi. Eski veri ilk açılışta kendiliğinden taşınır, öncesinde `<veri>-tasima-oncesi-<zaman>` güvenlik kopyası alınır.
- **Satış ve raporlar yeniden tasarlandı:** Tek dönem çubuğu (Bugün, Bu hafta, Son 30 gün, Tümü, Tarih seç); sekmeler Özet, Ürünler, Çalışanlar, Kampanyalar, Giderler, İade ve düzeltme. Özet'te yalnız üç ana rakam (Satış, Çıkan para, Elde kalan) ve önceki döneme göre değişim, günlük satış grafiği, en çok satanlar, yoğun saatler.
- **Örnek kafe şablonu:** `npm.cmd run demo:template -- <klasör>` 30 günlük gerçekçi bir işletme üretir (satış demosu için).

- **Marka:** Yazılımın adı Mola, şirket adı Merkut Studios. "Coffee House" yazısı kalktı; giriş ekranında "Adisyon · QR menü", altta ve müşteri menüsünün sonunda küçük "Mola · Merkut Studios" satırı var.

- **Otomatik yedek:** Sunucu çalışırken her gece 03:30'da (gece kapalıysa açılıştan 2 dakika sonra) şifreli yedek alınır, ayrı klasöre geri yüklenerek doğrulanır, en yeni 14 otomatik yedek saklanır. Durum ve "Şimdi yedek al" kasa bilgisayarında şerit → Yedekle'de; satıcı her işletmenin yedek durumunu Mola Yönetim'de görür.
- **Masaüstü uygulaması (Windows, macOS, Linux):** `npm.cmd run installer` her bilgisayar türü için ayrı klasör üretir. Windows'ta `Mola.exe` (49 KB başlatıcı, Windows'un kendi C# derleyicisiyle), Mac'te `Mola.app`, Linux'ta başlatıcı ve `kur.sh`. Mola adres çubuksuz kendi penceresinde açılır; soldaki şerit (Panel, Yedekle, Tabletler, Güvenlik, Kapat; 3 Ekim'den beri "Yönetim" yok) yalnız kafe bilgisayarındaki pencerede görünür. İnternetsiz, yönetici yetkisiz kurulum; güncellemede veri korunur. Windows paketi bu bilgisayarda kuruldu ve denendi (sunucuyu başlatma, pencere, yedek, tablet QR, kapatma). Mac ve Linux paketleri derlendi ve içerikleri doğrulandı, ama gerçek Mac/Linux bilgisayarda henüz denenmedi. Temiz bir Windows bilgisayarda kısayollar ve açılışta başlama da henüz denenmedi.
- **Kalıntı kilit:** Elektrik kesintisi ya da zorla kapatmadan kalan veri kilidi, kilidi yazan program artık çalışmıyorsa açılışta kendiliğinden kaldırılır.

## 3 Ekim: Kafe ve Mola Merkez ayrıldı (PHASE M1)

- **Neden:** İşletmenin verisi yalnız kafenin bilgisayarında kalsın; satıcı (biz) veri işleyen olmayalım. Önceden yönetim paneli her kafe sunucusunun içindeydi; işletme sahibi "Yönetim"e girip kendi lisansını uzatabilirdi.
- **Şimdi iki rol, tek kod:** *Kafe* (işletmenin bilgisayarı: sipariş, kasa, menü, raporlar, yedek) ve *Mola Merkez* (ileride VDS'te: Mola Yönetim paneli, lisans imzalama, etkinleştirme, destek). Kafede `/platform` ve şeritteki "Yönetim" yok. **Satış verisi Merkez'e gitmez:** Merkez yalnız işletme adı/türü, kurulum durumu, masa/çalışan/ürün sayısı, sürüm, son yedeğin durumu, hata kodu konumları ve sahibin yazdığı destek mesajlarını alır.
- **İmzalı lisans:** Merkez lisansı Ed25519 ile imzalar; kafe açık anahtarla doğrular, değiştirilmiş/sahte/eski lisansı kullanmaz. İnternet yoksa son lisans bitiş tarihine kadar geçerli. Kurallar aynı: lisans biterse/askıya alınırsa/dondurulursa menü ve yeni sipariş kapanır, hesap kapatma ve destek açık kalır; "Sadece QR menü" paketi de lisanstan gelir.
- **İlk açılış:** "Mola'yı etkinleştir": *Hesap açma başvurusu* (işletme, fatura ve iletişim bilgileri; Mola Yönetim'de onaylanınca 30 günlük deneme başlar, 3 Ekim kararı: kendi kendine deneme yok) ya da *Etkinleştirme kodum var* (Mola Yönetim → İşletme ekle'de oluşturulan, 14 gün geçerli tek kullanımlık kod). Sonra işletme sahibi kullanıcı adı ve şifresini kafede belirler; Merkez görmez. İnternet yoksa açık bir mesaj ve "Yeniden dene".
- **Kalp atışı:** kafe her 10 dakikada bir Merkez'e imzalı (HMAC) bir durum mesajı gönderir; Mola Yönetim'de "son görülme", sürüm, yedek uyarısı görünür. Destek talepleri kafede kuyruğa girer, ulaşınca "Gönderildi", yanıt gelince "Yanıtlandı" olur.
- **Sahibine geçenler:** işletme adı/logo/renk/karşılama ve Google bağlantısı (Ayarlar → İşletme görünümü), masa QR'ını yenileme (aynı yerde), unutulan şifre (kasa bilgisayarında Güvenlik → kurtarma koduyla). Satıcı bunları artık yapamaz.
- **Geliştirici ortamı:** `npm.cmd run merkez:dev` (port 4000) + `npm.cmd run dev`. Eski klasörler (`.local/development`, `.local/ornek-*`) bir kez `npm.cmd run merkez:import -- <klasör>` ile bağlanmalı; yoksa açılışta etkinleştirme ekranı çıkar. Ayrıntı: `docs/GELISTIRICI_REHBERI.md` bölüm 12.
- **Henüz yok (PHASE M2):** sahibin açıp kapattığı uzaktan destek erişimi (paraya hiç dokunamayan "destek" rolü) ve Merkez'den imzalı güncelleme dağıtımı (boşta kurulum, önce yedek, otomatik geri dönüş). Kod içinde yerleri ayrıldı.
- **Satıştan önce:** Mola Merkez için VDS + alan adı + HTTPS (ücretli; kullanıcı onayı gerekir), Merkez verisinin yedeği, sürüm paketine Merkez açık anahtarının gömülmesi ve `MOLA_MERKEZ_URL` ile paket üretimi.

## Satıştan önce tamamlanacak ana işler

1. **Merkezi dağıtım ve mali gizlilik:** Kafe/Merkez ayrımı yapıldı (yukarıda): işletme verisi ve anahtarları yalnız kafede, Merkez'de yalnız lisans ve destek. Kalanlar: Mola Merkez'in VDS'e kurulumu (HTTPS, yedek, izleme), uzaktan destek erişimi ve güncelleme dağıtımı (PHASE M2).
2. **HTTPS ve cihaz testi:** Yerel HTTPS, ayrı test verisi ve yerel sertifika üretimi hazır; güvenli çerez, TLS ve Origin kontrolleri otomatik doğrulandı. Gerçek Android/iPhone üzerinde sertifika güveni, QR erişimi, mutfak sesi ve ekran uyku davranışı denenmeli. Şimdiki kapsam yerel testtir; VDS, alan adı veya ücretli hizmet alınmadı. İnternete açılış ayrıca planlanacak.
3. **Dağıtım ve güncelleme:** Mevcut paket kaynak kod içerir ve Node.js/ilk bağımlılık kurulumu ister. Tek tık Windows kurulumu, güvenilir güncelleme ve önceki sürüme dönüş tamamlanmalı. Manifest yalnız dosya tutarlılığı kontrolüdür; imzalı yayın değildir.
4. **İşletim:** Ayrı yedek/anahtar hedefleri, doğrulanmış geri yükleme komutu, başlangıçta disk kapasitesi kontrolü ve ana panelde sınırlı teknik hata sorgusu hazır. Fiziksel harici disk provası, düzenli yedekleme zamanlaması, sürekli izleme ve olay müdahale akışı tamamlanmalı. Aynı bilgisayardaki yedek cihaz kaybına karşı yeterli değildir; hata indeksi yeniden başlatılınca silinir.
5. **Saha kabulü:** Gerçek Android/iPhone/tablet, zayıf bağlantı, mutfak sesi/uyku, eşzamanlı masalar ve büyük geçmiş ile uzun süreli test; ardından bir kafede kontrollü pilot.


6. **Satış tanıtımı ve işletme rehberi:** Son teslimden önce iki ayrı PDF hazırlanacak. Bir sayfalık satış tanıtımında yazılımın sundukları, fiyat/paket, pilot süresi, kurulum ve destek kapsamı kısa anlatılacak. Fiyat, destek saatleri ve taahhütler kararlaştırılmadan kesin bilgi gibi yazılmayacak. İkinci PDF işletme kullanım rehberi olacak; gerçek ekran görüntüleriyle her özellik için nereden açılır, nasıl kullanılır ve sonucu nedir birkaç kısa cümlede açıklanacak. İşletme sahibi, kasiyer, garson ve mutfak görevleri ayrılacak. Doğal Türkçe, kısa paragraflar, abartısız anlatım kullanılacak; uzun tireler, çift tireler ve yapay pazarlama kalıpları kullanılmayacak. Arayüz kesinleşince üretilecek.
7. **Son teslim kontrolü:** Son görsel ve kullanım kontrolü, rehberlerle uygulamanın tutarlılığı ve pilot geri bildirimlerinin kapatılması.

Üretim başlatma engeli bu işler tamamlanmadan kaldırılmamalı. Test sayısı tek başına satışa hazır olunduğunu göstermez.

## İlk satış için zorunlu olmayan, sonraya bırakılanlar

Gerçek yemek platformu entegrasyonları, SMS/e-posta sağlayıcısı, sadakat/üyelik, uzaktan yemek siparişi, diğer sektör şablonları ve gelişmiş kampanya türleri. Ücretli bağlantılar ayrıca kararlaştırılacak. Son kullanıcı kitapçığı arayüz ve akışlar kesinleşince hazırlanacak.

## Yerel kurulum kontrolü

Sunucu kapalıyken `npm.cmd run pilot:check` çalıştırılır. `DATA_DIR`, `PORT` ve isteğe bağlı `BACKUP_DIR` ortam değişkenleri okunur. Paket içindeyse manifestteki dosyalar doğrulanır. Kilit, yarım geri yükleme, eksik/yanlış boyutlu anahtar veya kullanılan port hata verir. Geliştirme klasöründe manifest bulunmaması uyarıdır. Son yedek tarihi yalnız tamamlanma kaydından gelir; ayrıca geri yükleme testi gerekir.

27 Eylül eklemesi: Veri klasörünün bulunduğu diskte sürecin kullanabileceği boş alan ölçülür. 256 MiB altında kurulum kontrolü başarısız olur; 2 GiB veya disk kapasitesinin %5'i altında uyarı verilir. Ölçülemiyorsa sonuç açıkça bilinmiyor olarak gösterilir ve elle kontrol istenir. Bu bir başlangıç kontrolüdür; alan rezervasyonu veya sürekli disk izleme yapmaz, çalışan sunucuyu kapatmaz. Mevcut yedek hedefi de ayrıca ölçülür; buradaki az alan yalnız uyarıdır. Yedek güncelliği ve yeni `backup verify` prova komutu için `YEDEK_PROVASI.md` dosyasına bakın.


## Değerlendirilecek isteğe bağlı özellik

Müşteriye dönük kasa ekranı: İlk pilot için zorunlu değil. Talep olursa tam panel yansıtmak yerine yalnız seçilen hesabın ürünleri, tutarları, indirimleri ve kalan ödeme bilgisi gösterilecek. Yönetim/rapor erişimi verilmeyecek, işlem bitince ekran temizlenecek. Aynı bilgisayarın ikinci ekranı ilk kapsam olabilir; ayrı tablet erişimi ayrıca yetkilendirme gerektirir. Henüz uygulanmadı. Yazar kasa veya banka POS entegrasyonu anlamına gelmez.


## Onaylanan sonraki ürün aşaması: modüller ve yerel paket

Çekirdek uygulama tamamlandıktan sonra, fiyatlandırma ve satış belgelerinden önce uygulanacak. Fiyatlar bu aşamada belirlenmeyecek.

- Dijital menü, QR sipariş, işletme operasyonu, satış/raporlar ve kampanyalar ayrı yetkilendirilebilir modüller olacak. Bağımlılıklar kontrol edilecek; yalnız sekme gizlemek yerine sunucu erişimi de sınırlandırılacak.
- Yalnız satış ve rapor isteyen işletmeye kendi bilgisayarında internetsiz çalışan yerel paket sunulacak. Bu pakette kayıt oluşturmak için basit satış, tahsilat ve gider girişi bulunacak.
- Yerel pakette satın alınan sürüm için süresiz kullanım modeli hazırlanacak. Kurulum, eğitim, bakım, destek, büyük sürüm yükseltmeleri ve çevrimiçi hizmetlerin kapsamı ayrı belirlenecek.
- Masaüstü simgesiyle açılış, gerekli çalışma ortamının kurulması, veri/yedek hedefleri ve güncelleme akışı hazırlanacak. Kullanıcıya localhost adresi yazdırma veya elle sunucu başlatma gerekmeyecek.
- Çevrimiçi paket müşteri mobil internetinden QR sipariş ve uzaktan hizmet için korunacak. İnternetsiz müşteri QR siparişi vaat edilmeyecek.
- Paket yükseltmede veri korunacak; paket küçültmede kayıtlar silinmeyecek. Finansal rapor erişimi ve dışa aktarma koşulları ayrıca belirlenecek.
- İlk aşamada aynı verinin yerel ve bulut arasında çift yönlü çevrimdışı eşitlenmesi kapsam dışında. Yerelden çevrimiçi hizmete geçiş ayrıca test edilecek.
- Bu bölüm ürün kararıdır; yerel süresiz lisans/kurulum veya modül yetkilendirmesi henüz uygulanmış değildir.

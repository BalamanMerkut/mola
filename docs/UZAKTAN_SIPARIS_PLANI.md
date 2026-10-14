# Uzaktan sipariş planı (taslak)

Tarih: 14 Ekim 2026 · Durum: **yalnız plan, kod yazılmadı** · Hazırlayan: Claude (kodu okuyarak)

Bu belge "müşteri evden sipariş versin, sipariş kafenin bilgisayarına düşsün" fikrini kod yazmadan önce baştan sona düşünmek için yazıldı. Sonunda sizin vermeniz gereken kararların listesi var (bölüm 9.4).

> Hukuk ve vergi bölümleri genel bilgidir. Ben avukat ya da mali müşavir değilim; o maddeler yayından önce bir avukata ve mali müşavire onaylatılmalıdır.

---

## 1. Özet

- Müşteriler tek bir siteden (ileride bir de uygulamadan) kafeye **evden ya da yoldan sipariş** verir.
- Site, her kafenin menüsünü Mola Merkez'deki **menü kopyasından** gösterir (bugün QR menü için zaten tutuluyor).
- Sipariş Merkez'e gelir, Merkez onu kafenin **zaten açık olan tüneliyle** kafe bilgisayarına iletir.
- Kafede ses çalar; kasiyer "Kabul (20 dk)" ya da "Reddet (neden)" der. Müşteri durumu sitede canlı görür.
- Yalnız **"Uzaktan sipariş" hizmetini satın alan** işletmeler sitede görünür. Hizmet, bugünkü paket sisteminde yeni bir satır olur.
- İlk aşamada ödeme **kapıda ya da gel-al'da** yapılır; internetten kartla ödeme sonraki aşamadır.

**Önerim (tek paragraf):** Altyapının büyük kısmı hazır: tünel, menü kopyası, paket ve lisans sistemi, kafedeki "Onay bekliyor" kutusu (Yemeksepeti gibi platformlar için yazılmıştı). Bu yüzden iş "sıfırdan bir sipariş sistemi" değil, mevcut parçaları birbirine bağlamaktır. Müşteri sitesi için **ayrı, kısa bir alan adı** almanızı öneriyorum (aynı VDS'te çalışır, yeni sunucu gerekmez). Ancak en büyük karar teknik değil: bugüne kadar "müşteri bilgisi Merkez'e gelmez" ilkesiyle ilerlediniz. Adrese teslim siparişte müşterinin adı, telefonu ve adresi Merkez'den **geçmek zorunda**. Bunu "geçir ama saklama" diye tasarlamayı ve yayından önce avukata göstermeyi öneriyorum. Başlangıç için en güvenli yol: **Aşama 1'i önce yalnız "gel-al" ile açmak**, adrese teslimi hukuk onayı gelince eklemek.

---

## 2. Alan adı kararı

### 2.1 Seçenekler

| | (a) Alt alan adı | (b) Ayrı tüketici alan adı | (c) Kafenin kendi alan adı |
|---|---|---|---|
| Örnek | `siparis.molayazilim.com.tr` | `molasiparis.com.tr` gibi kısa bir ad | `kahvedurağı.com` → kafenin sayfası |
| Maliyet | Yok (alan adı zaten sizin) | Yıllık alan adı ücreti | Kafe öder |
| Müşteri gözünde | "yazılım" kelimesi müşteriye bir şey anlatmaz, uzun | Kısa, akılda kalır, reklamı kolay | Kafeye özel, güçlü |
| Güvenlik | Yönetim paneliyle **aynı site** sayılır | Yönetim panelinden **tamamen ayrı** | Ayrı |
| Ne zaman | Hemen | Hemen | Sonra, ek hizmet olarak |

### 2.2 Bilinmesi gerekenler

- **Yeni alan adı yeni sunucu demek değildir.** Yeni ad, Cloudflare'de aynı VDS'in IP'sine (31.57.187.132) bağlanır. Caddy (sunucudaki web kapısı) birden çok adı aynı anda sunar ve her ad için HTTPS sertifikasını kendisi alır. Bugün de dört adı böyle sunuyor (`docs/VDS_KURULUM.md` §5 ve §13).
- **Ayrı alan adının güvenlik artısı:** Tarayıcılar `merkez.molayazilim.com.tr` ile `siparis.molayazilim.com.tr`'yi "aynı site" sayar. Ayrı bir alan adında, müşterilerin girdiği sayfa ile sizin Mola Yönetim paneliniz birbirinin çerezlerine ve "aynı site" korumalarına hiç dokunamaz. Bugün menü için bu ayrımın bir benzeri yapıldı (`server/merkez/menu-host.ts`: menü kendi adında, orada Yönetim yok); ayrı alan adı bunu bir adım ileri taşır.
- **Marka:** Müşteri "yazılım" almıyor, kahve alıyor. Tüketiciye "Mola'dan sipariş ver" demek kolay; "molayazilim" demek zor.
- **Maliyet:** Yalnız yıllık alan adı ücreti. Sunucu, sertifika, Cloudflare DNS ücretsiz kalır.
- **`.com.tr` kuralları:** 2022'den beri `.com.tr` adları TRABİS üzerinden ve çoğu durumda belge istenmeden alınabiliyor. Yine de **kayıt kuralları kayıt firmasında (Metunic) teyit edilmeli.**
- **Uygun ad:** `mola.com.tr` büyük olasılıkla çoktan alınmıştır. Bakılabilecek örnekler: `molasiparis.com.tr`, `molaver.com.tr`, `molada.com.tr`, `molagel.com.tr`, aynılarının `.com` hâlleri. **Ben hiçbirinin boş olup olmadığına ya da fiyatına bakmadım;** bunu kayıt firmasında siz kontrol etmelisiniz. Türkçe harf (ş, ı, ğ) içermeyen ad seçin: yazması ve paylaşması kolay olur.
- **Marka tescili:** "Mola" günlük bir kelime. Tüketiciye açık bir marka olarak kullanmadan önce TÜRKPATENT'te benzer bir marka olup olmadığına bakılmalı (avukat ya da marka vekili).

### 2.3 Öneri

**(b) Ayrı, kısa bir `.com.tr` alan adı alın**, aynı VDS'e bağlayın. Yanına `www` ekleyin. `siparis.molayazilim.com.tr`'yi de yedek olarak bu yeni ada yönlendirin (bedava). (c) seçeneğini (kafenin kendi adı) Aşama 3'te ücretli ek olarak düşünün. Alan adı ücretli olduğu için **siz onay vermeden alınmayacak.**

---

## 3. Nasıl çalışır (akış)

### 3.1 Bir siparişin yolu

```
 Müşteri telefonu            Mola Merkez (VDS)                  Kafe bilgisayarı
 ─────────────────           ──────────────────                 ────────────────
 site/<kafe-adı>   ──1──▶   menüyü kopyadan gösterir
 sepete ekler
 ad, telefon, adres
 ya da "gel-al"   ──2──▶   fiyatları kopyayla denetler
                            kafe açık mı? tünel bağlı mı?
                            ──3── tünelden iletir ──────────▶  "Onay bekliyor" + ses
                                                               Kabul (20 dk) / Reddet
                            ◀──4── yanıt ────────────────────
 "Kabul edildi, 20 dk" ◀──5──
 durum sayfası               ◀── 6: Hazır / Yolda / Teslim ──  mutfak ve kasa
```

1. Müşteri kafenin bağlantısını açar (QR, Instagram, Google). Menü, Merkez'deki menü kopyasından gelir; kafe bilgisayarı kapalı olsa bile menü görünür.
2. Müşteri sepeti, adını, telefonunu ve (adrese teslimse) adresini gönderir.
3. Merkez fiyatları kopyayla karşılaştırır (sayfanın gönderdiği fiyata güvenmez), sonra siparişi kafenin **açık tüneliyle** gönderir. Kafe tarafında gelen istek, Yemeksepeti siparişleri için yazılmış **"Onay bekliyor"** kutusuna düşer.
4. Kasiyer, müdür, sahip ya da mutfak "Kabul" (tahmini süreyle) veya "Reddet" (hazır nedenler: "Ürün tükendi", "Mutfak çok yoğun", "Teslimat bölgesi dışında"…) der.
5. Müşteri cevabı sitede görür. Kabul edilen sipariş mutfağa "masasız" bir fiş olarak gider (bugünkü platform siparişi gibi).
6. Mutfak "Hazır" deyince, kasa "Teslim edildi" deyince müşterinin sayfası da değişir.

### 3.2 Kafe kapalıysa ya da bilgisayar kapalıysa

| Durum | Müşteri ne görür | Sipariş ne olur |
|---|---|---|
| Kafe bilgisayarı kapalı / internet yok (tünel kopuk) | Menü görünür, "Şu an sipariş alınamıyor" | Hiç gönderilmez. Merkez siparişi **bekletmez, sıraya koymaz** (çevrimdışı sipariş yok kararınızla aynı) |
| Personel ekranı açık değil | Aynı | Gönderilmez (QR siparişindeki "personel ekranı bağlı" kuralı) |
| Kafe "Uzaktan siparişi durdur" / "Yoğunuz" dedi | "Şu an sipariş almıyor, 19:30'da yeniden açılacak" | Gönderilmez |
| Çalışma saati dışında (bu ayar olursa) | "Bugün 22:00'de kapandı" | Gönderilmez |
| Sipariş gitti ama kafe 5–8 dk yanıt vermedi | "İşletme yanıt vermedi, sipariş iptal edildi" | Kendiliğinden düşer (kodda platformlar için "süre doldu" durumu zaten var) |
| Sipariş gönderilirken tünel koptu | "Sipariş iletilemedi, tekrar deneyin" | Kafeye ulaşmadıysa hiç yok sayılır; ulaştıysa aynı numarayla iki kez eklenmez (platform siparişlerindeki tekrar önleme) |

---

## 4. Paket ve kafe ayarları

### 4.1 Yeni hizmet

`packages/domain/features.ts` listesine yeni bir hizmet eklenir, örneğin **"Uzaktan sipariş"** (kod adı `online-order`), grup "Sipariş ve servis". Bu liste hem Mola Yönetim'deki paket ekranını, hem imzalı lisansı, hem de kafedeki "paketinizde yok" görünümünü besliyor; yani yeni hizmet otomatik olarak fiyat listesine, paketlere ve "Hizmet" sekmesine girer.

- Menü kopyası bugün yalnız "QR menü" hizmeti olan işletmeler için gönderiliyor (`server/menu-mirror.ts`). Bu yüzden ya yeni hizmet **"QR menü"yü gerektirir** (`requires: ['qr-menu']`, en kolayı), ya da kopya bu hizmette de gönderilir.
- **Sitede yalnız bu hizmeti olan işletmeler görünür.** Merkez bunu kafeye sormadan bilir: QR menüde `menuOpen` (`server/merkez/guest-tunnel.ts`) aynı işi yapıyor (lisans etkin mi, hizmet var mı, kafe son 14 günde görüldü mü).
- Kafe tarafında da yeni yollar `feature-gate.ts` ROUTES listesine bir satırla eklenir; hizmet yoksa istek `featureRefusal` ile reddedilir (bugün QR siparişi böyle korunuyor).
- **Fiyat sizin kararınız.** Karşılaştırma için: `docs/FIYAT_ARASTIRMASI.md`'de bir rakibin "Online satış + QR" eki aylık 312,50 TL görünüyor. Önemli seçim: **sabit aylık ücret** mi, **sipariş başına komisyon** mu? Komisyonsuz sabit ücret, Yemeksepeti'ye karşı güçlü bir satış cümlesi olur ("sipariş başına pay almıyoruz").

### 4.2 Kafenin göreceği ayarlar (Ayarlar → Uzaktan sipariş)

| Ayar | Açıklama |
|---|---|
| Aç / Kapat | Hizmet paketteyse bile sahip açmadıkça sitede görünmez |
| Teslim şekli | Gel-al · Adrese teslim · ikisi |
| Teslimat bölgesi | En basit ve ücretsiz yol: kafenin seçtiği **mahalle listesi**, her mahalleye teslimat ücreti. (Harita ve km hesabı Google Maps gibi ücretli servis ister; şimdilik gerek yok.) |
| En az sipariş tutarı | Örnek: 150 TL altı adrese teslim yok |
| Tahmini süre | Varsayılan 20 dk; kabul ederken değiştirilebilir |
| "Yoğunuz" | 15 / 30 / 60 dk ya da "Ben açana kadar" duraklat (QR'daki "Durdur" gibi) |
| Çalışma saatleri | **Karar gerekli:** QR siparişinde kapanış saatini reddetmiştiniz. Uzaktan siparişte müşteri kafede olmadığı için saat bilgisi faydalı olabilir |
| Online'da gizli ürünler | Paket servise uygun olmayan ürünler (ör. köpüklü içecekler) sitede çıkmaz |
| Otomatik kabul | Kodda platformlar için zaten var (`autoAccept`); ilk aşamada kapalı önerilir |

Kafede "Uzaktan sipariş açık mı" kuralı, QR siparişindeki kuralı tekrar kullanır (`packages/domain/qr-ordering.ts`): personel ekranı bağlı, gün sonu yapılmamış, elle durdurulmamış.

---

## 5. Site yapısı

- **Aşama 1'de liste yok.** Her kafenin kendi sayfası olur: `alanadi.com.tr/kahve-duragi`. Kısa adı (slug) Mola Yönetim'de siz verirsiniz; menü kodundan (rastgele 10 harf) ayrıdır, çünkü bu ad akılda kalmak için var.
- Kafe bu bağlantıyı şuralarda paylaşır: Instagram profil bağlantısı, Google İşletme Profili'ndeki web sitesi / sipariş bağlantısı alanı, WhatsApp, kapıdaki ve paket poşetindeki QR. Bugünkü "Sosyal medya ve QR kartları" hizmetinin QR kartı üretme kodu buraya uyarlanabilir.
- **Ana sayfa (Aşama 1):** "Mola ile sipariş veren işletmeler yakında burada" + işletmeler için tanıtım + yasal bağlantılar.
- **Liste ve arama (Aşama 3):** Bir şehirde yeterli işletme olduğunda (ör. 10–15) şehir → işletme listesi → arama. Az işletmeyle boş görünen bir liste, hiç liste olmamasından kötüdür.
- Sayfalar hafif olmalı: menü fotoğrafları zaten küçültülmüş WebP olarak kopyada duruyor.
- Müşteri **hesap açmaz** (bugünkü "müşteri hesapsız" kararı). Telefonunda yalnız teknik bir çerez ("Siparişlerim" için) ve isterse ad-adres hatırlama (yalnız kendi telefonunda) olur.

---

## 6. Mobil uygulama

1. **Önce web sitesi.** Her telefonda, uygulama kurmadan çalışır. Alan adı HTTPS olduğu için site "Ana ekrana ekle" ile uygulama gibi de kurulabilir (PWA). Bugünkü kafe ağındaki düz HTTP sorunu burada yoktur.
2. **Sonra Google Play (Aşama 3).** Siteyi saran ince bir uygulama (TWA ya da WebView). Bugünkü personel uygulaması da ince bir kabuk (`mobile/android/`, `com.merkutstudios.mola`), aynı yöntem tanıdık. Ama:
   - Müşteri uygulaması **ayrı bir paket adı** olmalı (ör. `com.merkutstudios.molasiparis`); personel uygulamasıyla karışmamalı.
   - Uygulama ile alan adı **Digital Asset Links** dosyasıyla bağlanır (`/.well-known/assetlinks.json`, alan adına konan küçük bir dosya). Bu yüzden alan adı kararı uygulamadan önce kesinleşmeli.
   - Google Play geliştirici hesabı tek seferlik ücretlidir (bildiğim kadarıyla 25 ABD doları). Yeni kişisel hesaplarda yayından önce belirli sayıda test kullanıcısıyla kapalı test şartı var. **Güncel ücret ve kuralları Play Console'da kontrol edin.** Şirket hesabı D-U-N-S numarası ister.
3. **App Store en sona.** Apple yıllık ücret ister (bildiğim kadarıyla 99 ABD doları/yıl; güncelini kontrol edin) ve daha önce bu maliyeti istemediğinizi söylemiştiniz. Apple yalnız siteyi saran uygulamaları "yetersiz işlev" diye reddedebilir. iPhone kullanıcıları Safari'den sorunsuz sipariş verir.
4. **Bildirimler** ("Siparişiniz kabul edildi", "Yolda"): Aşama 1'de durum sayfası açık kalır ve kendini yeniler. Sonra web bildirimi (Android'de tarayıcıdan; iPhone'da yalnız ana ekrana eklenmiş sitede çalışır) ya da Play uygulamasında ücretsiz Firebase bildirimleri. SMS ücretlidir.

---

## 7. Güvenlik ve kötüye kullanım

| Risk | Önlem |
|---|---|
| Sahte sipariş (şaka, rakip) | Aşama 1: kafe, **yeni telefon numarasından gelen ilk siparişi arayarak** onaylar (ekranda "İlk sipariş · arayın" etiketi). Kafede "Bu numarayı engelle" (bugünkü "Bu tarayıcıyı engelle" gibi, süreli). Aşama 2: SMS doğrulama kodu (**ücretli**, sizin onayınız gerekir). |
| Bot ve seri gönderim | Merkez'de adres başına sınırlar (`clientKey`: IPv4 ve IPv6 /64, `server/http-security.ts`), telefon başına ve işletme başına sınırlar. Web sitesi formundaki ücretsiz korumalar (gizli tuzak alanı, form anahtarı, en az bekleme süresi: `server/merkez/site-leads.ts`) aynen kullanılır. Cloudflare Turnstile ücretsiz bir "robot musun" kontrolüdür ama dışarıdan yüklenen bir hizmettir ("üçüncü taraf yok" ilkenize aykırı); gerekirse sonra. |
| Fiyat oynama | Merkez ve kafe fiyatı **kendi** menüsünden hesaplar; sayfanın gönderdiği fiyata bakılmaz. |
| Kafe bilgisayarına saldırı | Kafe **hiçbir port açmaz**. Bugünkü tünel kafeden dışarı açılan tek bir HTTPS bağlantısıdır; Merkez yalnız izin listesindeki istekleri geçirir, kafe aynı listeyi kendisi bir kez daha denetler (`server/guest-tunnel.ts` `tunnelAllowed`). Uzaktan sipariş için listeye yalnız 1–2 yeni yol eklenir. |
| Yönetim paneline sızma | Müşteri sitesi ayrı alan adında; Merkez bugün menü adında yaptığı gibi o adda **yalnız sipariş yollarını** açar, Yönetim'i hiç açmaz (`menu-host.ts` örneği). |
| Büyük saldırı (DDoS) | DNS'te Cloudflare "gri bulut" kullanılıyor (`VDS_KURULUM.md` §5: turuncu bulut misafir sınırlarını bozuyor). Yani Cloudflare'in saldırı kalkanı şu an devrede değil. Küçük ölçekte sorun değil; büyürse ayrıca düşünülmeli. |

---

## 8. Hukuk ve KVKK

> Bu bölüm bir kontrol listesidir, hukuki görüş değildir. **Avukat ve mali müşavir onayı olmadan adrese teslim açılmamalıdır.**

### 8.1 Kişisel veri: "geçir, saklama"

Bugünkü ilkeniz: satış ve müşteri verisi kafede kalır, Merkez'e gelmez (`site/src/pages/gizlilik.html`, `docs/hukuk/MOLA_LISANS_SOZLESMESI.md` veri bölümü). Lisans sözleşmesinde "Paket servis siparişlerinde teslimat adresi ve telefon hiçbir zaman saklanmaz" yazıyor. Uzaktan siparişte ad, telefon ve adres **Merkez'den geçmek zorunda.** Önerilen tasarım:

- Merkez kişisel bilgiyi **veritabanına yazmaz**, yalnız bellekte tutar ve kafeye iletir. Böylece Merkez'in gece yedeğine ve Google Drive kopyasına hiç girmez (yurt dışına aktarım sorusu doğmaz).
- Merkez'de yalnız "sipariş numarası, işletme, durum, saat" gibi kişisel olmayan bilgi kısa süre (ör. 24 saat) durur.
- Kafede telefon ve adres yalnız sipariş açıkken ekranda ve fişte görünür; sipariş kapanınca silinir (bugün platform siparişinde müşteri adı geçmişe yazılmıyor: `withoutPersonal`, `packages/domain/platforms.ts`). Bugünkü kurallar masasız fiş adına telefon yazılmasını zaten engelliyor (`takeawayLabel`), bu yüzden telefon ayrı, geçici bir alanda tutulmalı.
- **Kim veri sorumlusu?** Muhtemelen siparişin verisi için kafe veri sorumlusu, Mola veri işleyen; müşteri sitesinin kendisi için Mola veri sorumlusu. Bu, "veri işleyen yükü istemiyorum" kararınızı değiştirir. Avukatla netleştirilmeli; VERBİS kaydı gerekip gerekmediği de sorulmalı.
- Yeni metinler: müşteri sitesi için **aydınlatma metni** ve gizlilik metni; kafelerle **veri işleme eki** (lisans sözleşmesine); `kvkk.html` ve `gizlilik.html` güncellemesi. Pazarlama SMS'i ya da e-postası Aşama 1'de **yok** (olursa İYS kaydı ve ayrı onay gerekir).

### 8.2 Elektronik ticaret ve tüketici

- Mola, kafelerin satış yaptığı bir site işletirse 6563 sayılı Elektronik Ticaret Kanunu açısından **"aracı hizmet sağlayıcı"** sayılabilir. Olası yükümlülükler: **ETBİS** (Elektronik Ticaret Bilgi Sistemi) kaydı, sitede satıcının (kafenin) unvanı ve iletişim bilgisi, aracı olarak kendi bilgileriniz. Büyük aracılar için ek kurallar var; küçük ölçekte uygulanıp uygulanmadığı sorulmalı.
- **Mesafeli satış:** Sipariş öncesi bilgilendirme (satıcı, fiyat KDV dahil, teslim şekli). Çabuk bozulan yiyeceklerde cayma hakkının istisnası olduğu biliniyor; yine de metin avukatla hazırlanmalı.
- **Fiş / fatura:** Satışı kafe yapar, belgesini de kafe keser (kapıda kart için kafenin kendi POS cihazı). Mali müşavire sorulmalı: kapıda ödemede fişin nasıl kesileceği, adrese teslimde e-arşiv gerekip gerekmediği.

### 8.3 İnternetten kartla ödeme (ayrı yol)

Mola **para tutmamalı.** Doğru yöntem iyzico, PayTR gibi lisanslı bir ödeme kuruluşunun **pazaryeri** çözümü: müşterinin parası doğrudan kafenin hesabına gider, her kafe o kuruluşta "alt üye işyeri" olur. Başvuru, sözleşme, komisyon oranları ve vergi tarafı ayrı bir iştir; aylar sürebilir. Aşama 3'e bırakılmalı.

---

## 9. Aşamalar ve tahmini süre

Süreler kabadır ve kod işini anlatır; hukuk, alan adı ve ödeme kuruluşu onayları bunun dışında, sizin takviminize bağlıdır.

### 9.1 Aşama 1: Bağlantı + sipariş + kabul/ret (ödeme kapıda)

- Alan adı, Caddy ve DNS (yarım gün; `VDS_KURULUM.md` §5, §7, §13'e bir blok)
- Yeni hizmet + Mola Yönetim'de kısa ad (slug) verme
- Müşteri sitesi: kafe sayfası, sepet, sipariş formu, durum sayfası
- Merkez: sipariş yolu, fiyat denetimi, tünelden iletme, kısa süreli durum kaydı
- Kafe: yeni "Mola site" kaynağı olarak "Onay bekliyor" kutusuna düşme, kabul süresi, ret nedeni, ses
- Basit ayarlar: aç/kapa, gel-al, en az tutar, "Yoğunuz"
- Testler (birim + tarayıcı) ve gerçek telefonla deneme
- **Tahmin: 2–3 haftalık çalışma.** Gel-al ile başlanırsa daha kısa.

### 9.2 Aşama 2: Güven ve ayarlar

- Adrese teslim: mahalle listesi, teslimat ücreti
- İlk sipariş "arayın" etiketi, numara engelleme, sınırlar
- Online'da gizli ürünler, çalışma saatleri (karar verilirse)
- Web bildirimi; yeni yasal metinler sitede
- **Tahmin: 2 hafta.** (SMS doğrulama seçilirse +1 hafta ve aylık SMS ücreti.)

### 9.3 Aşama 3: Büyüme

- Şehir bazında işletme listesi ve arama
- Google Play uygulaması (+ Digital Asset Links)
- İnternetten kartla ödeme (ödeme kuruluşu pazaryeri)
- Kafenin kendi alan adı (ücretli ek)
- **Tahmin: 4–6 hafta kod + dış onay süreleri.**

### 9.4 Kod yazmadan önce sizin kararınız gerekenler

| # | Karar | Seçenekler |
|---|---|---|
| 1 | Alan adı | Ayrı kısa ad (önerim) / `siparis.molayazilim.com.tr` |
| 2 | Hangi ad | Kayıt firmasında boş olanlara bakıp siz seçersiniz (ücretli, onayınızla) |
| 3 | Hizmetin adı | "Uzaktan sipariş" / "Online sipariş" / başka |
| 4 | Ücret modeli | Sabit aylık / sipariş başına komisyon / ikisi |
| 5 | Aşama 1 kapsamı | Yalnız gel-al (önerim) / gel-al + adrese teslim |
| 6 | Teslimat bölgesi | Mahalle listesi (önerim, ücretsiz) / km (ücretli harita servisi) |
| 7 | Çalışma saatleri ayarı | Olsun / olmasın (QR'da reddetmiştiniz) |
| 8 | Sahte sipariş önlemi | İlk siparişte kafe arar (ücretsiz) / SMS kodu (ücretli) |
| 9 | Kişisel bilginin Merkez'de kalma süresi | Hiç (yalnız bellek, önerim) / birkaç saat |
| 10 | Kim kabul eder | Kasiyer + müdür + sahip + mutfak (platformdaki gibi) / daha dar |
| 11 | Otomatik kabul | Kapalı (önerim) / kafe seçsin |
| 12 | Kapıda ödeme yöntemleri | Nakit / kart / ikisi (müşteri seçer) |
| 13 | Müşteri hesabı | Hesapsız devam (önerim) / ileride isteğe bağlı hesap |
| 14 | Hukuk | Avukat ve mali müşavirle ne zaman görüşülecek (adrese teslimden önce şart) |
| 15 | Play hesabı | Kişisel / şirket (Aşama 3'te) |

---

## 10. Riskler ve açık sorular

1. **İlke değişikliği:** "Müşteri verisi Merkez'e gelmez" ilkesi adrese teslimde korunamaz. Bu bilinçli bir karar olmalı.
2. **Kafe bilgisayarı tek nokta:** Bilgisayar kapanırsa sipariş alınamaz. Kafeler gece PC kapatıyor; gündüz de elektrik ya da internet kesilirse sipariş kapanır. Müşteriye bu durum net söylenmeli.
3. **Yanıtsız siparişler:** Kasiyer sesi duymazsa müşteri bekler. Kısa onay süresi ve "yanıt vermedi" düşmesi şart; mutfak ekranında da görünmeli.
4. **Kafenin kurye işi:** Mola kurye sağlamaz. Kafe kendi kuryesiyle teslim eder; bu satışta açıkça söylenmeli.
5. **Hukuki belirsizlik:** Aracı hizmet sağlayıcı yükümlülükleri, ETBİS, veri işleyen sözleşmesi. Onaysız adrese teslim açılmamalı.
6. **Marka çakışması:** "Mola" adıyla başka tescilli bir marka olabilir.
7. **Büyük platformlarla rekabet:** Müşteri alışkanlığı Yemeksepeti'de. Satış cümlesi "komisyonsuz, kendi müşterinize kendi bağlantınız" olmalı; liste sitesi baştan büyük beklenti yaratmamalı.
8. **Yük ve saldırı:** Cloudflare kalkanı kapalı (gri bulut). Küçük ölçekte sorun değil, izlenmeli.
9. **Açık soru:** Aynı işletmenin hem Yemeksepeti'si hem Mola sitesi olursa raporlarda ayrı "kanal" olarak görünmeli (`packages/domain/platforms.ts` kanal listesine yeni satır).
10. **Açık soru:** "Paket servis platformları" hizmeti bugün "Yakında" ve kilitli. Uzaktan sipariş aynı "Onay bekliyor" ekranını kullanacağı için, o ekranın bu hizmetle de açılması gerekir.

---

## 11. Mevcut altyapıdan kullanılacaklar / yazılacaklar

| Parça | Bugün var mı | Dosya | Ne yapılacak |
|---|---|---|---|
| Kafe ↔ Merkez tüneli (kafe port açmaz) | Var | `server/guest-tunnel.ts`, `server/merkez/guest-tunnel.ts`, `server/tunnel-protocol.ts` | İzin listesine 1–2 yeni yol (sipariş gönder, durum sor) |
| Menünün Merkez'deki kopyası (fiyat, kampanya, "tükendi", fotoğraf) | Var | `server/menu-mirror.ts`, `server/merkez/menu-mirror.ts`, `packages/domain/menu-mirror.ts` | Bu hizmette de gönderilsin; "online'da gizli" ürün bilgisi eklensin |
| Ayrı adda menü sunma | Var | `server/merkez/menu-host.ts` (`MERKEZ_MENU_ORIGIN`) | Aynı kalıpla yeni ad (ör. `MERKEZ_SIPARIS_ORIGIN`) |
| Menü açık mı kuralı (lisans, hizmet, 14 gün) | Var | `menuOpen`, `server/merkez/guest-tunnel.ts` | Yeni hizmet için benzeri |
| Hizmet listesi ve paketler | Var | `packages/domain/features.ts`, `server/merkez/catalog.ts` | Yeni hizmet satırı + fiyat |
| Hizmet kapısı (yoksa reddet) | Var | `packages/domain/feature-gate.ts`, `server/feature-guard.ts` (`featureRefusal`) | ROUTES'a yeni satır |
| Lisans ve işletme kaydı | Var | `server/kafe-link.ts`, `server/merkez/store.ts` (`MerkezBusiness`) | Kısa ad (slug), uzaktan sipariş ayarlarının Merkez'e özeti |
| "Onay bekliyor", kabul/ret, nedenler, süre dolması, tekrar önleme | Var (platformlar için) | `packages/domain/external-orders.ts`, `packages/domain/platforms.ts`, `server/integrations/` | Yeni kaynak "Mola site"; tahmini süre; telefon/adres geçici alanı |
| Masasız fiş (mutfak, kasa, rapor) | Var | `packages/domain/takeaway.ts` | Değişiklik yok, kabul edilen sipariş buraya düşer |
| Sipariş açık mı (personel bağlı, gün sonu, durdur) | Var (QR için) | `packages/domain/qr-ordering.ts`, `server/qr-ordering.ts` | Aynı kural + "Yoğunuz" süresi |
| Bildirim sesi | Var | `src/sounds.ts`, `packages/domain/sound-settings.ts` | Yeni olay "Uzaktan sipariş" |
| Bot koruması (tuzak alan, form anahtarı, sınırlar) | Var (web formu) | `server/merkez/site-leads.ts`, `server/http-security.ts` | Sipariş formuna uyarla |
| Tarayıcı engelleme | Var (QR) | `server/qr-ordering.ts` (90 gün) | Telefon numarası engelleme |
| Caddy, DNS, HTTPS | Var (4 ad) | `docs/VDS_KURULUM.md` §5, §7, §13 | Yeni alan adı bloğu |
| Android kabuk | Var (personel için) | `mobile/android/`, `scripts/build-apk.mjs` | Müşteri için ayrı paket, Aşama 3 |
| Yasal metinler | Var (site formu, menü) | `site/src/pages/kvkk.html`, `gizlilik.html`, `docs/hukuk/MOLA_LISANS_SOZLESMESI.md` | Müşteri aydınlatması, veri işleme eki, mesafeli satış bilgilendirmesi |
| Müşteri sitesi (kafe sayfası, sepet, durum) | **Yok** | — | Yeni |
| Teslimat bölgesi, en az tutar, teslimat ücreti | **Yok** | — | Yeni |
| Müşteri bildirimi (web push / uygulama) | **Yok** | — | Aşama 2–3 |
| İşletme listesi ve arama | **Yok** | — | Aşama 3 |
| Online ödeme | **Yok** | — | Aşama 3, ödeme kuruluşuyla |

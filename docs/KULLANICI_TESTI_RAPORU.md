# Mola kullanıcı testi raporu

9 Ekim 2026 · Mola 0.1.0 · Hafta sonu "herkes kendi cihazında" denemesinden önce, sizin gözünüzle bir kullanıcı testi: "kod çalışıyor mu" değil, "bu ne işe yarıyor, en kısa yol bu mu, kafeci anlar mı, rakamlar tutuyor mu, yanlış kişi bir şey görüyor mu, bir şey iki kez soruluyor mu, her düğme görünür bir şey yapıyor mu".

Ekran görüntüleri: `docs/ekran/kullanici-testi/` (dosya adları aşağıda parantez içinde).

## 1. Ne denendi?

### A. Kurulu programla kalabalık bir saat (paket, bu bilgisayarda)

Kurulu programın aynısı (`npm run test:paket` ile derlenen Mola ve Mola Yönetim, geçici veriyle, 3501 / 3591). Sizin kurulumunuza ve verinize dokunulmadı. Tarayıcı Edge, Türkçe. Aynı anda açık cihazlar:

| Cihaz | Ekran | Kim |
|---|---|---|
| Kasa bilgisayarı | 1366 × 768 | Kasiyer Zeynep (ilk kurulumu sahip yaptı) |
| Sahibin bilgisayarı | 1366 × 768 | Sahip (raporlar, Destek) |
| Garson telefonu 1 ve 2 | 390 × 844 | Ayşe ve Mehmet |
| Mutfak tableti | 1024 × 768 yatay ve 768 × 1024 dik | Can |
| Sahibin telefonu | 390 × 844 | Ali (iade, gider, stok, ayar, QR çipi) |
| Müdür telefonu | 390 × 844 | Burak |
| 4 misafir telefonu | 390 × 844 | Masa 01, 02, 03 (Türkçe) ve Masa 09 (İngilizce telefon) |
| Mola Yönetim | 1280 × 860 | Satıcı |

Oynanan saat: Mola Yönetim'den işletme ekleme ve kod, kafede etkinleştirme, sahip hesabı, kurulum sihirbazı, 5 çalışan, kasa açılışı ₺500; dört misafirin aynı anda seçenekli sipariş vermesi (Büyük boy, Yulaf sütü, şekerli); süre içinde değiştirme ve süre bitince açılan pencere; iki garsonun aynı siparişi aynı anda onaylaması, mutfağın aynı anda onaylaması; garsonların aynı masaya aynı anda sipariş eklemesi ve misafirin "Garson ekledi"yi görmesi; teslimden sonra misafirin iptal isteği, mutfağın gerekçeyle reddi; mutfakta başla, Geri al, hazır, garsonun teslimi; garson çağır, hesabı iste (Kart); ödemeler (ürün seçerek nakit, bir kısmı kart, kalanı nakit, kart + bahşiş, tam nakit, masasız "Sonra öde"); temizlik bekleyen masada misafir, Temizlendi, yeni hesap; QR çipi (Vazgeç, Durdur, Aç), bütün personel ekranları kapalıyken QR'ın kendiliğinden kapanması ve mutfak girince 3 saniyede açılması; gider (kasadan ve kasa dışı), para bozdurma, stok alışı (Kasadan nakit) ve sayım, reçete (Büyük boy %150), stok işlem geçmişi; kasiyer iadesi ₺35, sınırı aşan ₺190 isteği ve sahibin telefondan yapması; kart bahşişi ayarı açık ve kapalı; masaya dokunarak rezervasyon; vardiya kodu (5 kişi); Müdür girişi; kasiyerin kör gün sonu ve Z raporu, sahibin incelemesi, gün sonundan sonra ödeme ve ek kapanış; mutfak iptaliyle aynı anda ödeme; raporlar (sade, detaylı, Yıl, Tümü, Excel, PDF); Mola Yönetim: önemli duyuru (doğrulayıcıyla), kafeden "Bu konuda Mola ekibine yaz", Destek'te işletme özeti, yanıt, paket değişikliği (yapışkan çubuk, "Emin misiniz?", doğrulayıcı), Yedek → Göz at (pencere açılmadan, taklitle), İşlem kayıtları PDF ve Yazdır.

### B. 5 yıllık kafe, kullanıcı gözüyle

"Orta kafe" (günde ~160 hesap, 5 yılda 424 bin sipariş, 30 masa) bu bilgisayarda yeniden üretildi; geliştirme sunucusu, 3500. Sahip olarak: Masalar ve sipariş, Satış ve Raporlar (Bugün, Yıl, Tümü, yıllar tablosu, 2023'e dokunma, detay), Excel (2023 ve Tümü), 4 yıl önceki bir hesabın iadesi, Kasa kapanışları (Tümü, Daha eski), Personel ve bahşiş, Rezervasyon raporu, Stok işlem geçmişi, Ajanda, Ayarlar → Güvenlik ve yedek.

### Denenemeyenler

- **Fiş modu ve yazıcı:** bu bilgisayarda gerçek yazıcı yok; sahte ağ yazıcısı Windows güvenlik duvarı penceresi açabileceği için kurulmadı. Fiş yolu `npm run test:paket`te sahte yazıcıyla deneniyor.
- **QR'daki Wi-Fi adresi (192.168…):** aynı nedenle sunucu yalnız bu bilgisayara açıldı; misafirler 127.0.0.1'den bağlandı. Telefonlarla gerçek Wi-Fi denemesi hafta sonu yapılacak.
- **Raporlarım (telefon raporu), uzaktan yönetim:** eşleştirme gerektiriyor, denenmedi.
- **Yedekler ekranındaki yıl paketleri:** yalnız Mola penceresinde (sol şerit) görünüyor; düz tarayıcıda yok. 5 yıllık kafenin Mola Yönetim sayfası da yok (o kafe bir Mola Merkez'e bağlı değildi).

## 2. Para sağlaması (A bölümü, elle hesap ile Mola)

Satışlar: Masa 09 ₺270 (kart, +₺20 kart bahşiş), Masa 02 ₺285 nakit + ₺120 kart, Masa 01 ₺200 kart + ₺295 nakit, Masa 04 ₺405 nakit, Masa 03 ₺275 kart (+₺25 kart bahşiş, kasadan nakit verildi), Masasız ₺230 nakit; gün sonundan sonra Masa 01 ₺85 nakit (ek kapanış).

| Kalem | Elle hesap | Mola'nın gösterdiği | Sonuç |
|---|---|---|---|
| Satış (gün sonuna kadar) | 270 + 405 + 495 + 405 + 275 + 230 = ₺2.080 | ₺2.080 (sade özet, Müdür, Raporlar) | Tutuyor |
| Nakit / Kart | 285 + 295 + 405 + 230 = ₺1.215 / 270 + 120 + 200 + 275 = ₺865 | ₺1.215 / ₺865 | Tutuyor |
| Giderler | 30 (kasadan) + 150 (kasa dışı) + 120 (süt alışı, kasadan) = ₺300 | ₺300, "Stok alışları dahil (₺120)" | Tutuyor |
| İadeler | 35 + 190 = ₺225 | ₺225 | Tutuyor |
| Kart komisyonu | 865 × %1,79 = ₺15,48 | ₺15,48 | Tutuyor |
| Elde kalan | 2.080 − 300 − 225 − 15,48 = ₺1.539,52 | ₺1.539,52 | Tutuyor |
| Beklenen nakit | 500 + 1.215 − 150 (kasadan gider) − 225 (iade) − 25 (kasadan bahşiş) = ₺1.315 | ₺1.315, formül cümlesi aynı toplamla bitiyor | Tutuyor |
| Sayım farkı | 1.305 − 1.315 = −₺10 | −₺10 (yalnız sahipte) | Tutuyor |
| POS | 865 + 45 bahşiş = ₺910 | Kart farkı ₺0 | Tutuyor |
| Z raporu | Mola ₺2.080, iade ₺225 | ₺2.080 yazınca "tutuyor"; ₺1.855 yazınca "fark bugünkü iadeler kadar" | Anlaşılır |
| Ek kapanış | 500 + 85 = ₺585 | ₺585, fark yok | Tutuyor |
| Gün toplamı ve KDV | 2.165 − 225 = 1.940 → matrah ₺1.763,64, KDV ₺176,36 | Aynı | Tutuyor |
| Açık hesap (gün içinde) | 495 + 405 + 240 + 270 + 405 = ₺1.815 | ₺1.815 | Tutuyor |

Kasiyer sayımda yalnız saydığını gördü; Müdür'e giden kapanış "kör" (beklenen ve fark yok). Mutfak iptaliyle aynı anda kaydedilen ödeme reddedildi ("Bu hesap başka bir işlemle güncellendi"), güncel tutar ₺35 ile doğru kapandı. İki garsonun aynı anda onayında ikinciye "Sipariş değişti" dendi, sipariş bir kez mutfağa düştü.

B bölümünde 5 yılın rakamları (yıllar tablosu, 2023, Tümü) kendi içinde tutarlı; 2022'deki bir hesabın ₺85,50 iadesi 2022'yi değiştirmedi, bugünün iadelerine yazıldı.

## 3. Bulunanlar ve düzeltilenler

Ağırlık: **Kritik** (para yanlış ya da yanlış kişi görüyor), **Önemli** (kafede iş aksar ya da yanıltır), **Küçük** (anlaşılırlık, görünüm). Bu turda **kritik bulgu çıkmadı.**

### Düzeltildi (her birinin testi var)

1. **Önemli · İşlenmiş iade isteği uyarısı kalıyordu.** Sahip ₺190'lık isteği telefondan yaptıktan sonra Masalar'da hâlâ "İade isteği: Masa 02 · ₺190 · İadeyi yap" yazıyordu (`17-once-islenmis-iade-istegi-hala-uyari.png`). Artık istek yapılınca ya da reddedilince o bildirim okundu sayılır. (`tests/refunds.test.ts`)
2. **Önemli · 4 yıllık hesabın iadesi nereye yazılacağını söylemiyordu.** Onay yalnız "₺85,50 nakit iade kaydedilecek · Masa 19 · Parayı kasadan verin" diyordu (`37-once-4-yillik-hesap-iadesi-not-yok.png`). Artık eski bir günün ödemesinde: "Ödeme 08.10.2022 tarihli (kapanmış yıl); iade bugünün raporuna yazılır, o günün rakamları değişmez." (Yıl 1 Şubat'ta kapanır.) (`tests/refunds.test.ts`)
3. **Önemli · 5 yıllık kafede Stok → İşlem geçmişi her süzgeçte 2,5–3 saniye bekletiyor, ekranda hiçbir şey yazmıyordu** (`40-once-5yil-stok-gecmisi-bekleme.png`). Bekleme sürerken artık "Yükleniyor…" yazar. Hızın kendisi de düzeldi: K-T.
4. **Küçük · Garson onayındaki siparişe "mutfağa iletildi" deniyordu.** Süre bitince çıkan pencere, sipariş daha garson onayındayken "Siparişiniz mutfağa iletildi" diyordu (`03-once-sure-doldu-mutfaga-iletildi.png`). Artık "Siparişiniz garson onayında; değişiklik için garsonunuza seslenin." (İngilizcesi de.) (`tests/browser/guest-experience.spec.ts`)
5. **Küçük · Gün sonundan sonra ödeme alınınca "ek kapanış yapın" 30 saniyeye kadar gecikiyordu;** şerit "Yarın sabah açılış" demeye devam ediyordu. Artık hemen. (`tests/browser/kasa-gece.spec.ts`)
6. **Küçük · Ürün numarasıyla aynı ürün iki kez eklenince iki ayrı satır oluyordu** ("1 Demleme Çay", "1 Demleme Çay"; `42-once-masasiz-cay-iki-satir.png`). Artık "+" gibi tek satırda adet artar (K8). (`tests/browser/management.spec.ts`)
7. **Küçük · Kurulum sihirbazından sonra Masalar 80 px aşağı kaymış açılıyordu;** üstteki QR çipi ve tarih görünmüyordu. Artık sayfanın başından açılır. (`tests/browser/first-day.spec.ts`)
8. **Küçük · 5 yılda binlik ayırıcısız sayılar:** "78828 sipariş", "İptal 1644", "350042 tahsilat", "124307 sa", rezervasyon "3652", "14697 kişi". Artık 78.828, 1.644, 350.042 gibi.
9. **Küçük · Kasa kapanışları → Tümü'nde başka yılların günleri yılsız** ("14 Ağustos Pazar": hangi yıl?). Artık bu yıl değilse yıl da yazar ("14 Ağustos 2022 Pazar").
10. **Sizin isteğiniz · Reçete → "Bu ürün nasıl takip edilsin?":** üç düğme eşit genişlikte, simge ve yazı ortada, her ekranda tek satır. (`tests/browser/stock.spec.ts`)
11. **Sizin isteğiniz · Stok → İşlem geçmişi:** satırda önce kişinin adı (kalın), yanında küçük rol çipi: "Mehmet Aydın [Mutfak]". Kişi süzgeci "Ad · Rol". Kişisi bilinmeyen eski kayıtlarda "—" kalır. (`tests/browser/stock.spec.ts`; `docs/ekran/kafe/stok-islem-gecmisi.png` ve `recete-secenek-maliyet.png` yenilendi.)

### Kararlar: yapıldı (9 Ekim, sahibin onayıyla, raporda önerildiği gibi)

Aşağıdaki 22 maddenin hepsi önerildiği gibi yapıldı. Her birinin testi var; tarayıcı testleri tek tek (3400/3490) geçti. Gerçek telefonlarla hafta sonu görülecek.

**Önemli**

- **K-A · Sahip iadeyi telefondan yapınca kasiyer haberdar olmuyordu. Yapıldı.** Sahip ya da Müdür (kasada olmayan biri) iade yapınca kasiyerin Masalar'ında kısa yeşil şerit çıkar: "Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye verin." (kartla iadede "Kart iadesini POS cihazından yapın."). Şerit ✕ ile kapanır, o kişide bir daha çıkmaz; 3 saat sonra kendiliğinden düşer. Yazar kasa iade kartı kasiyerin ekranına düşer. Sahibin Bildirimler'inde "İade yapıldı: ₺190 · Masa 02" kaydı durur (yapan kişi için okunmuş). (`packages/domain/till-notices.ts`, `src/TillNotices.tsx`; `tests/refunds.test.ts`, `tests/browser/refunds.spec.ts`)
- **K-B · Vardiya takibi gün ortasında açılınca herkes anında kilitleniyordu. Yapıldı.** Açarken o an girişli çalışan varsa sorulur: "Şu an N kişi çalışıyor. Kod bir sonraki girişlerinde mi istensin, hemen mi?" İlk hâli **Bir sonraki girişte**: şu an çalışanlar işine devam eder, çıkıp yeniden girdiklerinde (en geç 05:00'ten sonra) kodu yazarlar. Yalnız **Hemen** şu anki oturumları kilitler. Kimse girişli değilse soru çıkmaz. (`tests/shifts.test.ts`, `tests/browser/shifts.spec.ts`)
- **K-C · Gün sonu bütün açık vardiyaları bitiriyordu. Yapıldı.** Sayım penceresi açık hesabın yanında mutfağı da söyler: "Mutfakta 3 sipariş bitmedi." Gün sonu yalnız sayımı yapanın vardiyasını bitirir; mutfak ve garsonlar kendi "Vardiyayı bitir"iyle ya da 05:00'te biter, gün sonundan sonraki ödeme için yeni kod gerekmez. Vardiya takibi açıksa pencerede bu da yazar. (`tests/shifts.test.ts`, `tests/browser/owner-day.spec.ts`)
- **K-T · 5 yıllık kafede Stok işlem geçmişi yavaştı. Yapıldı.** Asıl zaman her süzgeçte 30 bin kaydın baştan biçimlendirilmesine gidiyordu (kayıtlar şifreli tutulduğu için süzgeç SQL'de yapılamıyor). Artık geçmiş, stok bilgisiyle bir kez sıralı bir dizine çevrilir; her istek yalnız istenen dönemi bulur ve yalnız gösterilen 25 satırı biçimlendirir; yeni bir kayıt beş yılı yeniden okumadan araya eklenir. Çıktı eskisiyle satır satır aynı (eski işlev testte örnek olarak duruyor). Ölçüm: 5 yıla yayılmış 30.000 kayıtlı yapay kafe (`npx.cmd tsx scripts/stok-gecmisi-hiz.ts`; orta kafenin 5 yıllık verisi silinmişti, yeniden üretmek saatler sürüyor), gerçek HTTP ucu, 5 ölçümün ortancası:

  | Süzgeç | Önce | Sonra |
  |---|---|---|
  | Bugün | 3,98 sn | 11 ms |
  | 7 gün | 4,80 sn | 10 ms |
  | 30 gün | 4,73 sn | 10 ms |
  | Tümü | 4,06 sn | 10 ms |
  | Tümü · 40. sayfa | 4,92 sn | 8 ms |
  | Tümü · bir malzeme | 4,33 sn | 10 ms |
  | Tümü · bir kişi | 4,85 sn | 9 ms |
  | Tümü · arama | 4,29 sn | 20 ms (ilk arama 0,4 sn) |
  | Bir stok kaydından sonra 7 gün | 3,64 sn | 35 ms |
  | Ekranın ilk açılışı (şifreli kayıtları diskten okuma) | 4,55 sn | 0,8–1,3 sn |

  İlk açılışta kalan süre 30 bin şifreli kaydın bir kez okunmasıdır; Stok ekranı açılırken zaten ödenir. (`tests/stock-history.test.ts`)

**Küçük**

- **K-D · Parça ödemede para üstü küçük kalıyordu. Yapıldı.** Kaydedince büyük kutu 8 saniye (ya da bir sonraki yazıya kadar) "Verilecek para üstü ₺15" der. Hesap tam ödenip pencere kapanınca da ekranın altında büyük "Verilecek para üstü ₺5" 8 saniye kalır (✕ ile kapanır). (`tests/browser/fiscal-helper.spec.ts`, `kasa-gece.spec.ts`)
- **K-E · Yazar kasa kartları birikiyordu. Yapıldı.** "Girildi" denen kart hemen kalkar (pencerede girildi denen kart köşeye hiç gelmez). Köşede 3'ten fazla kart olunca eskiler tek satırda toplanır: "4 ödeme yazar kasaya girilmedi"; dokununca açılır. (`tests/browser/fiscal-helper.spec.ts`)
- **K-F · "bekleyen" sayısı yanıltıcıydı. Yapıldı.** Kasanın satırı "Mutfakta 3 · Onayda 4" der (mutfakta: yeni + hazırlanan; onayda yalnız varsa). (`tests/browser/counter-floor.spec.ts`)
- **K-G · Garson gönderince masa seçili kalıyordu. Yapıldı.** Gönderince masa seçimi boşalır; garson telefonu Masalar'a döner, kasa Sipariş al'da "Önce bir masa seçin"de kalır. "Masa 02 · Sipariş #12 mutfağa gönderildi." bildirimi çıkar. (`tests/browser/waiter-phone.spec.ts`)
- **K-H · İngilizce telefonda menü Türkçe açılıyordu. Yapıldı.** Telefonun ilk dili Türkçe değilse menü İngilizce başlar; EN/TR düğmesi kalır ve seçilen dil hatırlanır. (`tests/browser/menu-language.spec.ts`)
- **K-I · Reddedilen iptal isteğinden sonra "Siparişi iptal et" yeniden çıkıyordu. Yapıldı.** Reddedilen siparişte düğme gizli; sunucu da ikinci isteği reddeder ("İptal talebiniz reddedildi. Lütfen personelle görüşün."). Personel siparişi yine iptal edebilir. (`tests/browser/kitchen-cancellation.spec.ts`)
- **K-J · Misafirde eski yazılar kalıyordu. Yapıldı.** "Siparişiniz güncellendi." 4,5 saniyede kaybolur. Gönderildi penceresi siparişi izler: onaylanınca "Onaylandı, hazırlanıyor", mutfak başlayınca "Siparişiniz hazırlanıyor", hazır ya da iptal olunca o; "60 sn içinde değiştirebilirsiniz" satırı kalkar. (`tests/browser/guest-experience.spec.ts`)
- **K-K · Stok alışında "Gider olarak da kaydet" ilk hâli kapalıydı. Yapıldı.** Kutu yerine tek soru: "Para nereden çıktı? Kasadan / Kasa dışından / Ödenmedi (veresiye)", hiçbiri seçili gelmez ve seçmeden kaydedilmez. Kasadan beklenen nakitten düşer (kasa eksiye düşecekse sarı not); Kasa dışından'da "Nasıl ödendi?" sorulur, kasa değişmez; Ödenmedi'de gider yazılmaz, satırda "Ödenmedi (veresiye)". (`tests/stock-purchase-paid.test.ts`, `tests/browser/stock.spec.ts`)
- **K-L · Stokta aynı kayıtlar iki yerdeydi. Yapıldı.** "Son hareketler" yalnız son 3 satır + "Tümü" (İşlem geçmişini Tümü seçili açar); "Bu kaydı geri al" bu satırlarda çalışır. (`tests/browser/stock.spec.ts`)
- **K-M · Muhasebeci Excel'i "Geçen ay" seçili açılıyordu. Yapıldı.** Ayın ilk 10 gününde geçen ayda satış yoksa "Bu ay" seçili gelir (yalnız geçen ayın özeti okunur, beş yıl taranmaz). (`tests/browser/report-simple.spec.ts`)
- **K-N · "En çok satan" ciroya göre sıralı ama yanında adet yazıyordu. Yapıldı.** Liste her yerde ciroya göre olduğu için başlık "En çok kazandıran" oldu ve yanında tutar yazar (adet ikinci sırada): sade özet, detaylı Özet, telefon raporu, e-posta, yazdırma/PDF. (`tests/reports.test.ts`, `report-export.test.ts`, `email-reports.test.ts`)
- **K-O · Geçmiş yılın raporunda bugünün açık hesabı. Yapıldı.** "Açık hesaplar" yalnız bugünü içeren dönemlerde (Bugün, Tümü, bu yıl…) görünür. E-postadaki gün raporunda da yalnız rapor bugünün ise. (`tests/reports.test.ts`)
- **K-P · "önceki 281 günün aynı saatine göre" anlaşılmıyordu. Yapıldı.** Karşılaştırma da yanlıştı (yılın başından bugüne, önceki 281 günle kıyaslanıyordu). Artık bu yıl geçen yılın aynı dönemiyle (1 Ocak'tan aynı güne, aynı saate) kıyaslanır: "geçen yılın aynı dönemine göre"; geçmiş bir yılın tamamı "önceki yıla göre". (`tests/reports.test.ts`)
- **K-Q · Gece yarısından sonra Ajanda tarihi yenilenmiyordu. Yapıldı.** Açık kalan Rezervasyonlar ve Takvim ekranı gece yarısını geçince bugünü kendiliğinden ertesi güne alır (başka bir gün seçiliyse dokunmaz). Geçmiş bir saate rezervasyon önce uyarır: "… 21:00 geçti. Geçmiş bir saate rezervasyon yazıyorsunuz; günü ve saati kontrol edin." ve ancak "Yine de kaydet" ile kaydedilir. (`tests/browser/reservations.spec.ts`)
- **K-R · Mola Yönetim "Göz at". Yapıldı.** Pencere açıkken düğme "Pencere açık…" ve yanında "Klasör seçme penceresi açıldı (görev çubuğuna bakın)."; ikinci basışta hata yerine aynı not. (`tests/browser/platform-backup.spec.ts`)
- **K-S · Sahibin telefonunda Masalar eski geniş görünümdeydi. Yapıldı.** Her telefonda (sahip, Müdür, kasiyer, garson) aynı sade görünüm: tek satır özet, Tümü/Açık/Boş/Hazır, küçük masa kutuları; slogan ve büyük kartlar yok, "İlk adımlar" tek satırda kapalı. (`tests/browser/waiter-phone.spec.ts`)
- **K-U · Etkinlikler raporu eskiden yeniyeydi. Yapıldı.** En yeni etkinlik en üstte. (`tests/reservations.test.ts`)
- **K-V · Paket değişikliğinde iki onay vardı. Yapıldı.** Çubuktaki "Değişikliği uygula" doğrudan doğrulayıcı kodunu ister; "Emin misiniz? Evet, uygula" kalktı. (`tests/browser/platform-packages.spec.ts`)

## 4. Hız (kullanıcı gözüyle)

| İş | Paket (bugünkü kafe) | 5 yıllık kafe |
|---|---|---|
| Misafir menüsünün açılması | ~0,6 sn | - |
| Giriş → Masalar | - | 1,2 sn |
| Sipariş gönder, ödeme kaydet (sunucu) | anında | 8 ms / 4 ms |
| Satış ve Raporlar sade özet | anında | 0,8 sn |
| Tümü, 2023, detay | anında | 0,3–0,5 sn |
| İade listesi Tümü (350 bin tahsilat) | - | 0,5 sn |
| Kasa kapanışları Tümü / Daha eski | - | 0,6 / 0,5 sn |
| Muhasebeci Excel (2023 / Tümü) | anında | 0,7 sn / 0,7 sn |
| PDF (Satış özeti / İşlem kayıtları) | 2,1 sn / 1,3 sn | - |
| Stok işlem geçmişi (süzgeç değişince) | anında | 2,5–3 sn → **0,01–0,04 sn** (K-T; 30 bin kayıtlı yapay ölçüm) |

1 saniyeyi geçen tek uzun bekleme stok işlem geçmişiydi; K-T ile süzgeçler artık beklemiyor (yalnız ekranın ilk açılışı 1 sn kadar, "Yükleniyor…" yazar). PDF indirmede pencere "PDF indirildi" diyor.

## 5. İyi çalışanlar (değişmesin)

- QR siparişleri: personel ekranı kalmayınca 90 sn içinde kapanıyor, mutfak girince 3 sn'de açılıyor; misafirin sepeti duruyor; Durdur onay penceresi açık ve anlaşılır.
- Aynı anda işlem: iki garsonun onayı, iki garsonun aynı masaya siparişi, mutfak iptali ile ödeme. Hiçbirinde çift kayıt ya da yanlış tutar yok.
- Kör sayım: kasiyer ve Müdür beklenen nakdi ve farkı hiçbir yerde görmüyor; Z raporu karşılaştırması iadeleri açıklıyor.
- Misafir "Masanın hesabı": "Garson ekledi" ve ödenenler doğru; hesap kapanınca kendiliğinden "Hesabınız kapandı".
- Mola Yönetim: önemli duyuru kafede ortada çıkıyor, "Bu konuda Mola ekibine yaz" talebi doldurulmuş açıyor; Destek'te işletme özeti tek dokunuşta.

## 6. Son denetimler

Düzeltmelerden sonra bir kez: tip denetimi temiz; birim testleri 773 (772 geçti, 1 atlandı); derleme temiz; tarayıcı testlerinin tamamı (113 dosya) geçti (yeni "ek kapanış hemen" denetimi ilk koşuda yakaladığı bir eksikle düzeltildi ve tek başına yeniden geçti); kurulu paket testi 25 denetim; kurulum paketleri ve pilot paket denetimi geçti. Kullanım kılavuzunda eski kalan 3 şekil (misafirin internetten sipariş akışı, Ajanda "Not ekle", gün sonu "Girildi") yeniden çekildi; kılavuzlar ve test listesi PDF'i yeniden basıldı.

Testlerin kapsamadığı: gerçek telefonlarla Wi-Fi, gerçek fiş yazıcısı, Raporlarım. Bunlar hafta sonu denemesinde görülecek.

## 7. Hafta sonu için

`docs/HAFTA_SONU_SENARYOSU.md` ve basılı hâli `docs/pdf/Mola-Hafta-Sonu-Senaryosu.pdf` (2 sayfa): kim hangi cihazla, hazırlık, dakika dakika kalabalık saat, herkesin neyi bozmaya çalışacağı, elle sağlama ve nasıl bildirileceği. Yukarıdaki karar maddelerinin hepsi (K-A … K-V) 9 Ekim'de yapıldı; hafta sonu senaryosu ve gerçek cihaz test listesi buna göre güncellendi.

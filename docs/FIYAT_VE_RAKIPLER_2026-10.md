# Fiyat ve rakipler (15 Ekim 2026)

Bu belge 5 Ekim tarihli `FIYAT_ARASTIRMASI.md`'nin yerini alır. Rakip fiyatları resmî sayfalardan 15.10.2026'da alındı. Belirtilmedikçe fiyatlar KDV hariçtir; sayfada KDV yazmıyorsa "KDV ?" yazdım. Döviz çevirileri yaklaşıktır: 1 USD ≈ 49,3 TL, 1 EUR ≈ 55,3 TL (12 Ekim serbest piyasa, [ekonomist.com.tr](https://www.ekonomist.com.tr/doviz/dolar-ve-euro-yeni-haftaya-nasil-basladi-12-ekim-2026-guncel-doviz-kurlari-79737)). Bölüm E öneridir, kaynaklı bilgi değildir.

**Satış belgelerine girecek her rakamı bir kez tarayıcıda gözle kontrol edin.**

## A. Kısa özet

- **Bugünkü Mola fiyatları (kodda, KDV hariç):** Çay bahçesi 1.025 TL/ay, Kafe Standart 1.625 TL/ay, Restoran Pro 2.450 TL/ay; yıllık = 10 ay. Restoran Pro 5 Ekim belgesindeki 2.350 değil, 2.450: bulutta yedek pakete geri eklenmiş (`packages/domain/features.ts`, commit a4ff8b0).
- **Üst çapa Adisyo:** Lite + QR 1.796, Standart + QR 2.396, Pro + QR 3.126 TL/ay. Fiyatlar 5 Ekim'den beri aynı. Yazar kasa (+565) ve platformlar (+225–325) ayrı.
- **Alt çapa ucuz bulut programları:** GoPOS + QR ≈ 770 TL/ay; Restomenum 699 TL/ay (yıllıkta 583); 3E Yazılım 6.990 TL/yıl; Kafe360 8.999 TL/yıl (≈ 750/ay). Bunlarda QR menü ve stok çoğunlukla dahil. 5 Ekim'de bu grup tabloda yoktu; piyasanın alt ucu sandığımızdan ucuz.
- **Konum (bugünkü fiyatla):** Mola, Adisyo'nun aynı düzey paketinin %22–43 altında; en küçük paketiyle ucuz bulut programlarının (≈ 750–770 TL/ay) %30–40 üstünde. Bu farkı haklı çıkaran şeyler: internet kesilince de çalışması, verinin kafede kalması, Elazığ'da yerinde kurulum ve destek, sınırsız cihaz, mutfak ekranının en küçük pakette olması.
- **Alıcının ilk soracağı eksikler:** yazar kasa (ÖKC) bağlantısı, Yemeksepeti/Getir/Trendyol bağlantısı (bizde "yakında"), e-fatura/e-arşiv, sadakat, çoklu şube. Rakipler bunları genelde ücretli ek olarak satıyor.
- **Salt QR menü satamıyoruz:** kodda çekirdek her pakette zorunlu, en ucuz "yalnız QR" 950 TL/ay ediyor. Salt QR rakipleri yılda 4.555–5.000 TL (Akınsoft, qrmenu.rest).
- **Öneri:** "Değer odaklı" seçenek. Hizmet fiyatları aynı kalsın, paketlere indirim konsun: Çay bahçesi 950, Kafe Standart 1.490, Restoran Pro 2.190 TL/ay (KDV hariç). Bunun yanında güçlü bir kurucu müşteri teklifi verilsin.
- **Değişenler (5 Ekim'den bu yana):** Adisyo'nun donanımlı başlangıç paketi 54.900'den 43.900 TL'ye (KDV dahil) indi. Menulux sayfasından fiyat tablosu kalktı, artık yalnız "cihaz başına aylık 5 USD'den başlayan" yazıyor. Diğer kontrol edilen fiyatlar aynı.

## B. Rakip tablosu

Bütün sayfalar 15.10.2026'da kontrol edildi.

| Ürün | Model | Fiyat | Dahil olanlar | Ücretli ekler | Donanım / internetsiz / deneme | Kaynak |
|---|---|---|---|---|---|---|
| **Adisyo** Lite / Standart / Pro | Bulut, aylık ya da yıllık peşin | 1.250 / 1.850 / 2.580 TL/ay · 12.500 / 18.500 / 25.800 TL/yıl + KDV (aylıkta KDV yazmıyor) | Hepsinde: masa, sipariş, sınırsız yazıcı, gelişmiş rapor, patron ve garson uygulaması, online kurulum. Standart: + mutfak ekranı, stok/reçete, kuver. Pro: + sadakat, maliyet/kârlılık, rapor sihirbazı. Personel sınırı: 1–3 / 4–7 / çok | QR menü 546 · Trendyol Go + Getir 325 · diğer platformlar 225'ten · yazar kasa 565 · kurye 565 · sadakat 565 · API 565 · otel 445 · kiosk 2.500 (TL/ay) · e-dönüşüm ve çoklu şube teklifle | Donanım şart değil, satıyor: başlangıç paketi (1 yıl Lite + Windows POS + yazıcı) 43.900 TL KDV dahil. İnternetsiz: sayfada yok. Deneme 15 gün | [adisyo.com/fiyatlar](https://www.adisyo.com/fiyatlar) |
| **GoPOS** | Bulut, aylık (yıllıkta %25 indirim) | 582,50 TL/ay · 5.242,50 TL/yıl (3 kullanıcı) | Mutfak/bar ekranı, stok ve reçete, patron ve garson uygulaması, gelir-gider, SMS, arayan numara, güncellemeler; kurulum ve eğitim dahil | Ek kullanıcı 200 / 150 / 135 TL/ay · Yemeksepeti, Getir, Uber Eats, Migros her biri 100 TL/ay · QR menü 187 TL/ay · Online satış + QR 312,50 TL/ay · Mobil kurye 208 TL/ay · yazar kasa: var, fiyat açık değil | İnternetsiz: sayfada yok. Deneme 15 gün | [gopos.com.tr/fiyatlandirma](https://www.gopos.com.tr/fiyatlandirma/) |
| **Menulux** | Aylık lisans | Fiyat açık değil. Sayfada yalnız "cihaz başına aylık 5 USD'den başlayan" (≈ 250 TL) | Mobil, Web, Tablet, Premium POS; internet kesilince de çalışır | QR menü, garson terminali, sadakat, kurye ayrı ürün. Yazar kasa ve online sipariş entegrasyonu ayrı lisans. Ekim–Aralık kampanyası: yeni müşteriye %15, rakipten geçene %30 | Donanım ve kurulum ayrı. Deneme süresi yazmıyor | [menulux.com](https://www.menulux.com/restoran-otomasyonu/pos-sistemi/restoran-adisyon-programi), [kampanyalar](https://www.menulux.com/kampanyalar) |
| **Simpra POS** | Bulut, aylık/yıllık | 50 €/ay (≈ 2.765 TL) · 500 €/yıl (≈ 27.650 TL), vergi dahil | Sınırsız personel, QR menü, çok dil, döviz ile ödeme, 7/24 destek | Mutfak ekranı, stok, entegrasyonlar ayrı sayfada, fiyat açık değil | Windows, Mac, Linux, iOS, Android. İnternetsiz: sayfada yok. "Ücretsiz dene" var, süre yok | [simprasuite.com](https://simprasuite.com/restaurant-software/pos-system/price/) |
| **robotPOS** | Tek seferlik lisans + aylık modül, USD + KDV | Ana lisans 1.950 $ (≈ 96.000 TL) · ek terminal 750 $ · mobil terminal 450 $ · mutfak ekranı 450 $ | Hibrit: "merkezi bulut kesintisinde bile satış durmaz" | QR menü 25 $/ay · stok 45 $/ay + 250 $ kurulum · rezervasyon 75 $/ay + 250 $ · CRM/sadakat 45 $/ay · franchise 75 $/ay · web sipariş 25 $/ay · kiosk lisansı 2.950 $ · yazar kasa, e-fatura, platformlar: fiyat açık değil | Donanım ayrı | [robotpos.com/fiyatlandirma](https://www.robotpos.com/fiyatlandirma) |
| **SambaPOS V5 Pro** | Ömür boyu lisans | 339 $ (≈ 16.700 TL), KDV yazmıyor | Çoklu bilgisayar, stok ve maliyet, özel raporlar | Uzaktan rapor (Metrik): 77 / 119 / 179 $/yıl (≈ 3.800–8.800 TL/yıl) | Windows 10+. İnternetsiz: yerel program ama sayfada yazmıyor | [sambapos.com](https://sambapos.com/tr/sambapos-v5-pro/), [Metrik](https://sambapos.com/tr/metrik/) |
| **NarPOS** | Bulut aylık; ya da banka POS'u ile; ya da tek seferlik | Cloud 1.200 TL/ay · Halkbank ERP: yazılım ücreti yok, POS komisyonu %2,88 · tek seferlik 3.000 $ | Çekirdek modüller, paket servis ve pazar yerleri, 7/24 destek. Yazar kasa POS (Param, Beko, Pavo) bağlantısı | Kurumsal (şube, maliyet) teklifle | Lokal ve bulut seçeneği. Deneme yazmıyor | [narpos.com.tr/fiyatlarimiz](https://www.narpos.com.tr/fiyatlarimiz) |
| **Kafe360** | Yıllık (aylık ve 6 aylık var, fiyatı yok) | Ücretsiz QR menü (500 ürün) · tam paket 8.999 TL/yıl (≈ 750/ay), KDV yazmıyor | Sipariş ve adisyon, mutfak ekranı, termal yazıcı, rapor, stok, cari | – | PWA; kısa kesintilerde çalışır, sonra eşitler. Deneme 30 gün | [kafe360.com](https://kafe360.com/) |
| **Restomenum** | Aylık / yıllık | 699 TL/ay · 6.990 TL/yıl (≈ 583/ay) | Sipariş ve masa, stok, paket servis modülü, her cihazda | QR menü 1.990 · Yemeksepeti, Getir, Trendyol her biri 1.090 · kurye 1.990 · online mağaza 2.990 (TL/yıl, KDV hariç) | İnternetsiz: sayfada yok. Deneme 15 gün | [restomenum.com/urunler](https://restomenum.com/urunler) |
| **3E Yazılım** | Yıllık (kampanya fiyatı, 30.07.2026) | Standart 6.990 · Orta 15.000 · Profesyonel 25.000 TL/yıl, KDV yazmıyor | Standart: satış, masa, QR menü, stok, mutfak, rapor. Orta: + yazar kasa/e-fatura, online mağaza, şube. Pro: + platformlar, kiosk | – | Kendi blog yazısından; liste fiyatı yok | [3eyazilim.com](https://3eyazilim.com/blog/restoran-adisyon-programi-fiyatlari/) |
| **OxyMenu** | Aylık | Start 1.499 · Growth 2.799 · Corporate 4.499 TL/ay; uygulamalı paketler 3.999–11.999 TL/ay | Start: POS, garson, QR menü, temel stok, raporlar. Growth: + reçete, patron mobil. App paketleri: + markalı uygulama, sadakat | Ek şube 1.199–10.999 TL/ay | Yıllık fiyat, KDV, deneme yazmıyor | [oxymenu.com/fiyatlandirma](https://oxymenu.com/fiyatlandirma) |
| **FineDine** (QR + sipariş) | Yıllık faturalı | 900 / 2.025 / 3.525 TL/ay | QR menü, sipariş paneli, hızlı ödeme, bahşiş, hizmet talebi, rezervasyon (50 / 250 / sınırsız) | SMS bildirimleri 250–500 /ay | Adisyon değil | [finedinemenu.com](https://www.finedinemenu.com/tr/fiyatlandirma) |
| **Akınsoft QR Menü** | Yıllık, şube başına | 4.555 TL/yıl (≈ 380/ay) + KDV | Dijital menü, çoklu şube, kendi alan adı, Wolvox Restoran bağlantısı | Eğitim ayrı | Deneme 30 gün | [qrmenu.akinsoft.com.tr/fiyatlandirma](https://qrmenu.akinsoft.com.tr/fiyatlandirma) |
| **qrmenu.rest** | Yıllık | 5.000 TL/yıl (liste 6.500), KDV yazmıyor | Yalnız menü; kurulum dahil | – | Deneme 7 gün | [qrmenu.rest](https://qrmenu.rest/) |
| **MONU** (QR) | Aylık | 0 / 249 / 699 / 1.299 / 2.499 TL/ay | Ücretsizi reklamlı; Pro'da çok dil, alerjen | Masa QR/NFC standı 80–250 TL/adet; fotoğraf ve çeviri hizmeti ayrı (fiyatsız) | Kurulum ücreti yok | [monu.com.tr](https://www.monu.com.tr/blog/qr-menu-fiyatlari) (kendi blogu) |
| Akınsoft Wolvox Restoran, Hızlı Adisyon, Kolay Adisyon, Paşa POS, Paket Taxi | – | Fiyat açık değil (bayi / teklif) | | | | – |
| Yemeksepeti, Getir, Trendyol | – | Kendi adisyon/POS ürünü bulunamadı; yalnız sipariş paneli ve uygulamaları var | | | | – |

Not: Adisyo QR menü ekinin yıllık fiyatı sayfada yok. GoPOS sayfasındaki "Toplam 5.242,50 ₺/yıl" satırı entegrasyon toplamıyla tutmuyor; yazım hatası gibi duruyor.

## C. Özellik karşılaştırması

İşaretler: ✓ dahil · ✗ yok · ₺ ücretli ek (tutar TL/ay, KDV hariç) · ? sayfada bilgi yok. Rakip hücreleri yalnız resmî sayfada yazanı gösterir.

| | Mola | Adisyo | GoPOS | Menulux | Simpra | robotPOS | SambaPOS | Kafe360 | NarPOS |
|---|---|---|---|---|---|---|---|---|---|
| Adisyon, masa, kasa | ✓ 750 | ✓ | ✓ | ✓ | ✓ | ✓ lisans | ✓ lisans | ✓ | ✓ |
| Mutfak ekranı / fiş | ✓ çekirdekte | Standart+ | ✓ | ? | ? (ayrı) | ₺ 450 $ tek sefer | ? | ✓ | ✓ |
| QR menü | ₺ 200 | ₺ 546 | ₺ 187 | ₺ ayrı ürün | ✓ | ₺ 25 $ | ? | ✓ (ücretsiz) | ✓ |
| QR sipariş + garson çağırma | ₺ 150 | ? | ₺ 312,50 (online + QR) | ₺ ayrı | ? | ₺ web sipariş 25 $ | ? | ? | ✓ (QR sipariş) |
| Stok, reçete, kârlılık | ₺ 250 | Standart+ (kârlılık Pro) | ✓ | ? | ? (ayrı) | ₺ 45 $ + kurulum | ✓ | ✓ | ✓ |
| Uzaktan rapor (telefon) | ₺ 200 | ✓ patron uyg. | ✓ patron uyg. | ? | ✓ | ? | ₺ 77–179 $/yıl | ? | ? |
| Uzaktan yönetim | ₺ 100 | ✓ (bulut) | ✓ (bulut) | ? | ✓ (bulut) | ? | ✗ | ✓ (bulut) | ? |
| E-posta raporları | ₺ 75 | ? | ? | ? | ? | ? | ? | ? | ? |
| Gelişmiş rapor (PDF, Excel, KDV) | ₺ 150 | ✓ | ? | ? | ✓ | ? | ✓ | ✓ | ? |
| Rezervasyon | ₺ 150 | ? | ? | ? | ? | ₺ 75 $ + kurulum | ? | ? | ? |
| Vardiya, bahşiş | ₺ 150 | ? | ? | ? | ? | ₺ operasyon 45 $ | ? | ? | ? |
| Sosyal medya, QR kartları | ₺ 75 | ? | ? | ? | ? | ? | ? | ? | ? |
| İki ekran (kasada) | ₺ 100 | ? | ? | ? | ? | ? | ? | ? | ? |
| Bulut yedek | ₺ 100 | ✓ (bulut) | ✓ (bulut) | ? | ✓ (bulut) | ✓ (hibrit) | ? | ✓ (bulut) | ✓ (bulut) |
| **İnternetsiz çalışma** | ✓ tam (kafe bilgisayarı) | ? | ? | ✓ | ? | ✓ satış durmaz | ? (yerel) | kısmi (kısa kesinti) | ? (lokal seçenek) |
| **Veri işletmede (KVKK)** | ✓ | ✗ bulut | ✗ bulut | ? | ✗ bulut | kısmi | ✓ yerel | ✗ bulut | lokal seçenekte |
| **Donanım şartı** | Var olan Windows PC + telefon/tablet; donanım satmıyoruz | yok; donanım satıyor | yok | donanım ayrı | Windows/Mac/tablet | donanım ayrı | Windows | yok | ? |
| **Kurulum ücreti** | öneri 2.000 (pilotta yok) | online kurulum dahil | dahil | ayrı | ? | modül başı 250 $ | ? | ? | ? |
| **Deneme** | 30 gün, her şey açık | 15 gün | 15 gün | ? | var, süre yok | ? | ? | 30 gün | ? |
| **Android / iPhone** | Android APK (Play Store yok); iPhone Safari "Ana Ekrana Ekle" | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ / ✓ | ✓ mobil terminal | ? | PWA | ? |
| **Uçtan uca şifreleme** | ✓ uzaktan rapor ve yönetim | ? | ? | ? | ? | ? | ? | ? | ? |
| **Paket servis entegrasyonu** | ✗ yakında (125/platform planlı) | ₺ 225–325 | ₺ 100/platform | ₺ ayrı lisans | ? | ? | ? | ? | ✓ (Cloud'da) |
| **Yazar kasa / ÖKC** | ✗ (yalnız "yazar kasa yardımcısı": ne girileceğini gösterir) | ₺ 565 | ₺ fiyat açık değil | ₺ ayrı lisans | ? | ? | ? | ? | ✓ Param, Beko, Pavo |
| **e-Fatura / e-Arşiv** | ✗ | ₺ teklifle | ? | ? | ? | ? | ? | ? | ✓ (entegrasyon listesinde) |
| **Sadakat / müşteri** | ✗ | Pro ya da ₺ 565 | ? | ₺ Sadakat App | ? | ₺ 45 $ | ? | ? | ? |
| **Çoklu şube** | ✗ birleşik görünüm yok (her şube ayrı işletme) | ₺ teklifle | ₺ Franchise teklifle | ✓ Premium | ✓ merkezi yönetim | ₺ franchise 75 $ | ₺ Metrik'te | ? | ₺ kurumsal |

## D. Artılarımız ve eksiklerimiz

**Artılar (satışta öne çıkarılacak):**
- İnternet kesilince kafe durmaz: sunucu kafe bilgisayarında. Bulut rakiplerinin çoğu bunu sayfasında söylemiyor; söyleyenler Menulux ve robotPOS.
- Veri kafede kalır, Mola Merkez'e satış verisi gitmez. Uzaktan rapor ve yönetim uçtan uca şifreli. KVKK konusunda hassas işletmeye güçlü cevap.
- En küçük pakette mutfak ekranı ve fiş modu, sınırsız cihaz. Adisyo'da mutfak ekranı Standart'ta (1.850), GoPOS'ta 3 kullanıcıdan sonra kişi başı 135–200 TL ek.
- 30 gün deneme ve denemede her şey açık. Adisyo, GoPOS, Restomenum 15 gün.
- Elazığ'da yerinde kurulum, eğitim, yazıcı ayarı. Ulusal rakipler online kurulum yapıyor.
- Donanım satmıyoruz: kafenin var olan bilgisayarı, ESC/POS yazıcısı, Android tableti ve iPhone'u yeter.
- QR sipariş + garson çağırma + hesap isteme, rezervasyon/kapora, vardiya/bahşiş, e-posta raporları, gece şifreli yedek, otomatik güncelleme, uzaktan destek. Bunların bir kısmını rakipler hiç yazmıyor ya da ayrı satıyor.

**Eksikler (alıcı soracak):**

| Eksik | Rakipler nasıl satıyor | Not |
|---|---|---|
| Yazar kasa (ÖKC) bağlantısı | Adisyo +565 TL/ay; NarPOS banka POS'uyla; 3E Orta pakette (15.000/yıl); Menulux ayrı lisans | En sık sorulacak madde. Bizde yalnız yardımcı ekran var. Beko, Pavo, Param gibi yazar kasa POS'larından biriyle bağlantı öncelik olmalı |
| Paket servis platformları | GoPOS 100/platform; Adisyo 225–325; Restomenum 1.090/yıl/platform | Bizde altyapı hazır, platform izni bekleniyor. Satışta "yakında" deyin, tarih vermeyin |
| e-Fatura / e-Arşiv / e-Adisyon | Adisyo teklifle; 3E Orta pakette; NarPOS entegrasyon listesinde | e-Adisyon'da genel bir başlangıç tarihi bulunamadı; GİB işletmeyi bildirimle (en az 3 ay süreyle) belirliyor. Mali müşavirle doğrulayın |
| Sadakat / müşteri kartı | Adisyo Pro ya da +565; robotPOS 45 $; Menulux ayrı uygulama | Küçük kafede ilk sırada değil |
| Çoklu şube görünümü | Çoğu teklifle; OxyMenu ek şube 1.199+ /ay | Her şube ayrı işletme olarak açılabiliyor; birleşik rapor yok |
| Play Store / App Store | Rakiplerin mağaza uygulamaları var | Android APK kafeden kurulur, iPhone Safari'den. Bazı sahipler mağazada görmek isteyecek |
| Salt QR menü | Akınsoft 4.555/yıl, qrmenu.rest 5.000/yıl, Kafe360 ücretsiz | Bizde çekirdek zorunlu; en ucuzu 950/ay |
| 7/24 destek | GoPOS 7 gün, Simpra 7/24, NarPOS 7/24 | Biz mesai içi; ücretli acil müdahale |

## E. Fiyat önerisi

> **Sahibin son kararı (15 Ekim 2026, uygulamada).** "Uzaktan raporlar" ve "Uzaktan yönetim" tek hizmet olarak satılır: **Uzaktan erişim** (55 + 75 = 130 TL/ay). Hizmet fiyatları, KDV hariç, TL/ay:
>
> | Hizmet | TL/ay | Hizmet | TL/ay |
> |---|---|---|---|
> | Adisyon çekirdeği | 750 | Gelişmiş raporlar | 100 |
> | QR menü | 200 | Rezervasyon ve etkinlik | 50 |
> | QR sipariş ve garson çağırma | 300 | Sosyal medya ve QR kartları | 20 |
> | Stok, reçete ve kârlılık | 650 | Vardiya, bahşiş ve personel raporu | 20 |
> | **Uzaktan erişim** (raporlar + yönetim) | **130** | İki ekran | 50 |
> | E-posta raporları | 30 | Bulutta şifreli yedek | 300 |
> | | | Paket servis platformları (yakında) | 125 |
>
> | Paket | Hizmet toplamı | Paket indirimi | Aylık hariç | Aylık dahil | Yıllık hariç |
> |---|---|---|---|---|---|
> | Çay bahçesi | 980 | yok | **980** | 1.176 | 9.800 |
> | Kafe Standart (Uzaktan erişim dahil) | 2.060 | 110 | **1.950** | 2.340 | 19.500 |
> | Restoran Pro | 2.600 | yok | **2.600** | 3.120 | 26.000 |
>
> Kodda başlangıç fiyatları bunlar (`packages/domain/features.ts`); canlı Merkez ilk açılışta bir kez bu listeye geçer (katalog adımı 4). Aşağıdaki seçenekler bu karardan önceki çalışmadır.

Kurallar: KDV hariç fiyat esas, yazılım hizmetinde KDV %20. Yıllık = 10 ay (kodla aynı). Yıllık sözleşmede "her yıl TÜFE oranında güncellenir" maddesi. Mola Yönetim'de hem hizmet fiyatı hem paket indirimi ayarlanabiliyor; aşağıdaki iki seçenek de kod değişikliği istemez.

### Seçenek 1: Düşük giriş

Hizmet fiyatları düşer, ucuz bulut programlarıyla aynı yerden girilir.

| Paket | Aylık hariç | Aylık dahil | Yıllık hariç | Yıllık dahil |
|---|---|---|---|---|
| Çay bahçesi | 750 | 900 | 7.500 | 9.000 |
| Kafe Standart | 1.225 | 1.470 | 12.250 | 14.700 |
| Restoran Pro | 1.800 | 2.160 | 18.000 | 21.600 |

Hizmetler (TL/ay): çekirdek 550 · QR menü 150 · QR sipariş 125 · stok 200 · uzaktan rapor 150 · uzaktan yönetim 75 · e-posta rapor 50 · gelişmiş rapor 100 · rezervasyon 100 · vardiya 100 · sosyal medya 50 · iki ekran 75 · bulut yedek 75 · platform (yakında) 100.

Artısı: GoPOS + QR (770) ve Kafe360 (≈ 750) ile aynı düzey; Elazığ'da "pahalı" itirazı az. Eksisi: yerinde hizmetin ve internetsiz çalışmanın değeri fiyata yansımaz; sonradan zam zor.

### Seçenek 2: Değer odaklı (önerilen)

Hizmet fiyatları bugünkü gibi kalır (Özel paket bunlarla hesaplanır), hazır paketlere paket indirimi konur.

| Paket | Hizmet toplamı | Paket indirimi | Aylık hariç | Aylık dahil | Yıllık hariç | Yıllık dahil |
|---|---|---|---|---|---|---|
| Çay bahçesi | 1.025 | 75 | **950** | 1.140 | 9.500 | 11.400 |
| Kafe Standart | 1.625 | 135 | **1.490** | 1.788 | 14.900 | 17.880 |
| Restoran Pro | 2.450 | 260 | **2.190** | 2.628 | 21.900 | 26.280 |

Özel paket hizmet fiyatları (TL/ay, KDV hariç; yıllık ×10), bugünkü değerler:

| Hizmet | Aylık | Rakip çapası |
|---|---|---|
| Adisyon çekirdeği (mutfak ekranı, kasa, sınırsız cihaz, Android) | 750 | Adisyo Lite 1.250; GoPOS 582,50 (3 kullanıcı) |
| QR menü | 200 | GoPOS 187; Adisyo 546; Akınsoft ≈ 380 |
| QR sipariş ve garson çağırma | 150 | GoPOS online + QR 312,50 |
| Stok, reçete, kârlılık | 250 | robotPOS ≈ 2.200 (45 $); Adisyo Standart farkı 600 |
| Uzaktan raporlar | 200 | SambaPOS Metrik ≈ 316–735 /ay |
| Uzaktan yönetim | 100 | – |
| E-posta raporları | 75 | – |
| Gelişmiş raporlar | 150 | – |
| Rezervasyon ve etkinlik | 150 | robotPOS ≈ 3.700 (75 $) |
| Vardiya, bahşiş, personel | 150 | robotPOS operasyon ≈ 2.200 (45 $) |
| Sosyal medya ve QR kartları | 75 | – |
| İki ekran | 100 | – |
| Bulutta şifreli yedek | 100 | Bulut rakiplerde dahil; bizde isteğe bağlı |
| Paket servis platformu (yakında, platform başına) | 125 | GoPOS 100; Adisyo 225–325 |

Gerekçe:
- Çay bahçesi 950: Adisyo Lite + QR'nin (1.796) yarısı; Kafe360 ve Restomenum + QR'nin (yılda ≈ 9.000) yıllıkta biraz üstü (9.500). Mutfak ekranı ve sınırsız cihaz dahil.
- Kafe Standart 1.490: Adisyo Standart + QR'nin (2.396) %38 altı, OxyMenu Start'ın (1.499) hemen altı. QR sipariş ve uzaktan rapor da dahil.
- Restoran Pro 2.190: Adisyo Pro + QR'nin (3.126) %30 altı, Simpra'nın (≈ 2.300 hariç) altında.
- Özel paketle her şeyi tek tek alan, hazır paketten pahalıya alır. Bu da hazır paketleri cazip yapar.

### Kurucu müşteri ve açılış teklifi

- **İlk 5 işletme (kurucu müşteri):** 30 gün deneme + 2 ay ücretsiz; sonra ilk yıl %40 indirim (Kafe Standart ≈ 894 TL/ay); fiyat 2 yıl sabit. Karşılığında referans, adını kullanma izni, ayda bir geri bildirim.
- **Elazığ açılışı (ilk 20 işletme, yıl sonuna kadar):** yıllık peşin ödemede kurulum ücretsiz ve 2 ay hediye (yıllık zaten 10 ay; toplam 14 ay kullanım).
- **Rakipten geçene:** ilk yıl %25 indirim ve menünün ücretsiz aktarımı. Menulux da geçenlere %30 veriyor.
- **Çay bahçeleri için sezon planı:** 6 ay = aylık × 5 (Çay bahçesi 4.750 TL).

### Kurulum ve görsel hazırlama hizmeti

Rakip çapaları: Adisyo ve GoPOS kurulumu (online) dahil; robotPOS modül başına 250 $ (≈ 12.300 TL); Menulux kurulum ayrı, fiyat açık değil; MONU fotoğraf ve çeviriyi ayrı satıyor (fiyatsız); Armut'ta İzmir'de QR menü hazırlama hizmeti 2.000–7.000 TL ([armut.com](https://armut.com/narlidere-qr-menu)).

| Hizmet | Öneri (KDV hariç, tek sefer) |
|---|---|
| Temel kurulum: yerinde kurulum, yazıcı ve tablet ayarı, 60 ürüne kadar menü girişi, 1 saat eğitim | 1.500 TL. Yıllık peşin ödeyene ve kurucu müşteriye ücretsiz |
| Görsel paket: logo düzenleme, 40 ürüne kadar ürün görseli (yapay zekâ yardımıyla ışık, arka plan, kırpma), QR masa kartı tasarımı | 2.000 TL; ek ürün başı 40 TL |
| Kurulum + görsel birlikte | 3.000 TL |
| Menüyü baştan yeniden girme, ek eğitim | 750 TL / seferi |

Not: Ürün görselleri kafenin kendi ürününün fotoğrafından yapılmalı. Yapay zekâ ışığı, arka planı ve düzeni iyileştirebilir; menüde olmayan ya da farklı görünen bir ürün üretmek müşteriyi yanıltır ve şikâyet riski taşır.

### Karar için

1. Seçenek 2'yi seçerseniz Mola Yönetim → Paketler'de üç pakete ₺ indirim girmeniz yeter (75 / 135 / 260).
2. Salt QR menü satmak istiyorsanız önce kodda "çekirdeksiz QR menü" kararı gerekir. Satılacaksa 400 TL/ay ya da 4.000 TL/yıl uygun (Akınsoft 4.555, qrmenu.rest 5.000).
3. Yazar kasa bağlantısı gelene kadar satış görüşmesinde "yazar kasa yardımcısı" gösterilmeli ve dürüstçe "bağlantı yok" denmeli.

## F. Kaynaklar ve kontrol tarihi

Hepsi 15.10.2026'da açıldı.

- Adisyo: https://www.adisyo.com/fiyatlar
- GoPOS: https://www.gopos.com.tr/fiyatlandirma/
- Menulux: https://www.menulux.com/restoran-otomasyonu/pos-sistemi/restoran-adisyon-programi · https://www.menulux.com/restoran-otomasyonu/dijital-menu/karekod-qr-menu · https://www.menulux.com/kampanyalar
- Simpra: https://simprasuite.com/restaurant-software/pos-system/price/
- robotPOS: https://www.robotpos.com/fiyatlandirma
- SambaPOS: https://sambapos.com/tr/sambapos-v5-pro/ · https://sambapos.com/tr/metrik/
- NarPOS: https://www.narpos.com.tr/fiyatlarimiz
- Kafe360: https://kafe360.com/
- Restomenum: https://restomenum.com/urunler
- 3E Yazılım: https://3eyazilim.com/blog/restoran-adisyon-programi-fiyatlari/
- OxyMenu: https://oxymenu.com/fiyatlandirma
- FineDine: https://www.finedinemenu.com/tr/fiyatlandirma
- Akınsoft QR Menü: https://qrmenu.akinsoft.com.tr/fiyatlandirma
- qrmenu.rest: https://qrmenu.rest/
- MONU: https://www.monu.com.tr/blog/qr-menu-fiyatlari
- Armut (QR menü hizmeti): https://armut.com/narlidere-qr-menu
- Kur: https://www.ekonomist.com.tr/doviz/dolar-ve-euro-yeni-haftaya-nasil-basladi-12-ekim-2026-guncel-doviz-kurlari-79737
- e-Adisyon: https://sovos.com/tr/blog/kdv/e-adisyon-donemi-basliyor-beklenen-kilavuz-yayimlandi/ · https://multinet.com.tr/blog/vergi-muhasebe/e-adisyon-nedir-kimler-icin-zorunludur
- Mola fiyatları: `packages/domain/features.ts` (hizmetler ve başlangıç paketleri), `packages/domain/service-pricing.ts`

**Doğrulanamayanlar:** Menulux'ün paket fiyatları (5 Ekim'deki 750 / 1.000 / 1.500 ve QR 250 artık sayfada yok); Akınsoft Wolvox Restoran, Hızlı Adisyon, Kolay Adisyon, Paşa POS, Paket Taxi (fiyat açık değil); Yemeksepeti/Getir/Trendyol'un kendi POS ürünü (bulunamadı); Adisyo ve GoPOS'un internetsiz çalışması; Kafe360'ın aylık fiyatı; NarPOS'ta hangi modülün hangi pakette olduğu.

**Satış belgelerine girecek her rakamı bir kez tarayıcıda gözle kontrol edin.**

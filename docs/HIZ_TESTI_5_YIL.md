# 5 yıllık hız ve hata testi (6 Ekim 2026)

Soru şuydu: **Bir kafe Mola'yı 5 yıl boyunca her gün kullanırsa, normal bir kafe bilgisayarında program hâlâ hızlı ve doğru çalışır mı?**

Bunu görmek için bilgisayarda iki sahte kafe kurduk ve 5 yıllık geçmişlerini gün gün, programın kendi kurallarıyla oluşturduk: menü, masalar, siparişler, ödemeler, iadeler, kasa kapanışları, stok, vardiyalar, rezervasyonlar. Sonra gerçek programı bu verilerle açtık ve yoğun bir akşamı taklit ettik (10 personel tableti, mutfak ekranı, 20 müşteri telefonu, raporlara bakan işletme sahibi).

| | Orta kafe | Yoğun kafe (Elazığ, hafta sonu ve maç akşamları dolu) |
|---|---|---|
| Günde ortalama hesap | 160 | 640 |
| 5 yılda hesap / sipariş / ürün | 293 bin / 428 bin / 1,3 milyon | 1,16 milyon / 1,6 milyon / 4,7 milyon |
| 5 yıllık ciro (tahsilat) | 95 milyon TL | 343 milyon TL |
| Veritabanı boyutu | 0,55 GB | 1,8 GB |

## Kısa sonuç

**5 yıl sonra yoğun bir kafede program 2 saniyede açılıyor, sipariş ve ödeme 0,04 saniyede kaydediliyor, bugünün, haftanın ve ayın raporu 0,25 saniyenin altında, yıllık rapor 0,5 ile 1,5 saniye, 5 yılın tamamı ("Tümü") 1 ile 6 saniye sürüyor.**

**5 yılın her günü kuruşu kuruşuna tuttu.** Günlük, aylık, yıllık ve 5 yıllık toplamlar, KDV dökümü, gün sonu kasa kapanışları, stok, yedekten geri yükleme hepsi bizim ayrıca tuttuğumuz defterle aynı çıktı. Sunucuyu yoğun anda iki kez fişini çeker gibi kapattık: onaylanan hiçbir sipariş ve ödeme kaybolmadı, hiçbiri iki kez yazılmadı.

Test sırasında 10 yavaşlık bulup düzelttik (aşağıda). **İki konu sizin kararınızı bekliyor:** yedekler yıllar içinde büyüyor ve "Tümü" gibi çok uzun raporlar hesaplanırken birkaç saniye diğer tabletler de bekliyor.

| Alan | Orta kafe | Yoğun kafe | Durum |
|---|---|---|---|
| Program açılışı (ilk ekran gelene kadar) | 2 - 2,5 sn | 2 sn | Yeşil |
| Sipariş gönderme | 0,02 sn | 0,04 sn (en yavaş %5'i 0,15 sn) | Yeşil |
| Ödeme alma | 0,02 sn | 0,04 sn | Yeşil |
| Mutfak ekranının yeni siparişi görmesi | 1,5 sn içinde | 1,5 sn içinde | Yeşil |
| Masalar ekranı (tabletlerin yenilemesi) | 0,005 sn | 0,01 sn | Yeşil |
| Müşterinin QR menüsü | 0,004 sn | 0,008 sn | Yeşil |
| Bugün / hafta / ay raporları | 0,02 - 0,2 sn | 0,03 - 0,25 sn | Yeşil |
| Yıllık rapor | 0,1 - 1,2 sn | 0,2 - 1,3 sn | Yeşil |
| 5 yılın tamamı ("Tümü") | 0,6 - 6 sn (Faz 2 sonrası 0,01 - 0,15 sn; Kârlılık 0,7 sn, parça parça) | 0,9 - 6 sn (Faz 2 sonrası 0,02 - 0,3 sn; Kârlılık 1,1 sn, parça parça) | Sarı → Yeşil |
| Muhasebeci Excel'i: ay / yıl / 5 yıl | 0,2 / 1,5 / 6,7 sn (Faz 2: 5 yıl 0,2 sn) | 0,2 / 1,4 / 6,9 sn (Faz 2: 5 yıl 0,3 sn) | Yeşil |
| PDF rapor: ay / yıl | 2,3 / 2,6 sn | 2,2 / 2,5 sn | Yeşil |
| Gün sonu kasa kapanışı | 0,04 sn | 0,1 sn | Yeşil |
| Stok ekranı ("kaç adet yapılabilir") | 0,35 sn | 0,4 sn | Yeşil |
| 4 yıl önceki bir hesabı bulmak, iade yapmak | 0,03 sn | 0,1 sn | Yeşil |
| Gece yedeği (doğrulanmış) | 1,7 dk, 0,54 GB (Faz 4 sonrası 13 sn, 77 MB) | 5 dk, 1,8 GB (Faz 4 sonrası 24 sn, 0,27 GB) | Sarı / Kırmızı → Yeşil |
| Yedekten geri yükleme (yeni bilgisayar) | 49 sn | 2,3 dk | Yeşil |
| Sunucu yedeği (internetle Mola Merkez'e) | her seferinde 0,7 GB (Faz 4 sonrası gece 77 MB) | her seferinde 2,4 GB, 10 Mbps hatla 32 dk (Faz 4 sonrası gece 0,27 GB, 3,6 dk) | Sarı / Kırmızı → Yeşil |
| Bellek (RAM) | 0,3 GB, ağır raporlardan sonra 0,75 GB | 0,35 GB, ağır raporlardan sonra 1 GB | Sarı |
| Doğruluk (toplamlar, KDV, kasa, stok, geri yükleme, ani kapanma) | hata yok | hata yok | Yeşil |

Süreler hızlı bir bilgisayarda ölçüldü. Ucuz bir kafe bilgisayarı için aşağıdaki "Zayıf kafe bilgisayarında" bölümüne bakın.

## Zayıf kafe bilgisayarında

Ölçümler AMD Ryzen 5 5600X, 32 GB RAM ve hızlı NVMe disk olan bir bilgisayarda yapıldı. Kafelerde sık görülen ucuz bir bilgisayar (4 çekirdekli Celeron / Pentium Silver, 4-8 GB RAM, SATA SSD) tek çekirdekte yaklaşık **2,5 kat** yavaştır; Mola'nın sunucusu işini tek çekirdekte yaptığı için süreleri 2,5 ile çarpmak doğru bir tahmindir. 10. nesil i3 gibi bir işlemcide çarpan yaklaşık 1,3'tür.

| | Hızlı bilgisayar (ölçüm) | Celeron tahmini |
|---|---|---|
| Açılış | 2 sn | 5 sn |
| Sipariş ve ödeme | 0,04 sn | 0,1 sn |
| Yoğun anda en yavaş siparişler | 0,15 sn | 0,4 sn |
| Ay raporu | 0,1 sn | 0,25 sn |
| Yıllık rapor | 0,5 - 1,5 sn | 1 - 4 sn |
| 5 yılın tamamı | 1 - 6 sn | 2,5 - 15 sn |
| Gece yedeği (yoğun kafe) | 5 dk | 12 - 15 dk |

Ayrıca sunucuyu bu bilgisayarda yalnız 2 mantıksal çekirdeğe ve düşük önceliğe sıkıştırıp tarayıcıyı 4 kat yavaşlatarak bir tur daha ölçtük (ikinci bölümdeki "zayıf" sütunları). Sipariş ve ödemeler yine 0,1 saniyenin altında kaldı, ekranlarda donma görülmedi.

Öneriler: **SSD disk şart** (eski tip mekanik diskte yedek ve ilk raporlar belirgin yavaşlar). **8 GB RAM önerilir**; 4 GB'ta Windows, kasa ekranı ve Mola birlikte sınırda çalışır.

## Bu testte düzeltilenler

Hepsi küçük ve güvenli değişiklikler. Bütün otomatik testler ve ilgili tarayıcı testleri geçti; çoğu için yeni test eklendi.

| Ne yavaştı | Önce | Sonra |
|---|---|---|
| Her raporda, okunan her kayıt için işletmenin şifre anahtarı baştan açılıyordu (raporların yarı süresi buydu) | | Anahtar bir kez açılıyor; raporlar yaklaşık 2 kat hızlı |
| Program açıldıktan sonraki ilk rapor bütün hesapları tarıyordu ("en uzun hesap" araması) | Orta kafede 2,4 sn, yoğunda tahminen 8 sn donma | Anında (yeni dizin; bir kerelik kurulumu 0,6 sn) |
| Personel ve bahşiş raporu, "bugün" seçilse de 5 yılın bütün bahşişlerini okuyordu | 1,8 sn | 0,02 sn |
| Rezervasyon raporu "Tümü": her etkinlik için üç günün bütün hesapları açılıyordu | Orta 16,5 sn | Orta 5,6 sn; etkinliğin özeti artık kapanıştan 3 gün sonra bir kez hesaplanıp saklanıyor, yoğun kafede 1,3 sn. Bu sürümden önce kapanmış etkinlikler ilk "Tümü"de bir kez hesaplanır (yoğun kafede 28 sn) |
| Sade özet, yazdırılabilir sayfa ve muhasebeci Excel'i aynı 5 yılı iki kez okuyordu (orta kafe) | Excel "Tümü" 15,1 sn, sade özet 11,8 sn | Önce anahtar düzeltmesiyle 6,7 ve 6 sn, çift okuma da kalkınca 3,2 sn |
| Kasa kapanışları "Tümü": tarayıcıya her kapanışın, hiç gösterilmeyen ödeme listesi de gidiyordu | 111 MB | 4,7 MB |
| Kasa kapanışları: 1.800 kapanış kartı birden çiziliyor, her kart sunucuya ayrı soru soruyordu | 1.800 istek, ekran 0,6 sn donuyor | Tek istek, önce son 62 kapanış ("Daha eski kapanışlar" düğmesi) |
| Personel ve bahşiş "Tümü" zayıf bilgisayarda (aynı sebeple) | 25 sn | 1,5 sn |
| 30 günlük ödeme araması | 1,1 sn | 0,16 sn |
| Stok uyarısı, açılıştan bir dakika sonra 5 yılın günlük özetlerini birden okuyordu; bir güncelleme özetleri yenilerse dakikalarca donma olabilirdi | 1 sn donma | Özetler arka planda parça parça okunuyor, stok uyarısı bunun bitmesini bekliyor |
| Gün sonu kapanış kaydına, "Girildi" işareti hiç kullanılmasa da günün bütün ödemelerinin listesi yazılıyordu | Kapanış başına 40-60 KB | 2 KB (liste zaten hiçbir yerde gösterilmiyordu) |

Ayrıca tarih sınırları için yeni testler eklendi: 29 Şubat 2028, yılbaşı gecesi 04:59 / 05:00, bilgisayarın saat dilimi yanlış ayarlıysa, gece yarısını ve gün sonunu geçen açık masa. Hepsi doğru çalışıyor.

## Karar bekleyenler

### 1. Yedekler yıllar içinde büyüyor (en önemlisi)

Bugün her gece 03:30'da, her gün sonundan sonra ve sabah açılışta (gece kapalıysa) veritabanının **tamamı** kopyalanıyor, açılıp doğrulanıyor ve son 14 kopya saklanıyor. Sunucu yedeği açıksa kopyanın tamamı internetle Mola Merkez'e de gidiyor. Yoğun kafede 5 yıl sonra bu:

- her yedek 5 dakika (Celeron'da 12-15 dakika) sürüyor; bu sırada tabletler biraz yavaşlıyor ama donmuyor,
- 14 kopya diskte 25 GB yer tutuyor,
- her gün sonundan sonra (gün sonu yapılmadıysa gece) 2,4 GB internetten gönderiliyor (10 Mbps yüklemeyle 32 dakika, kafe açıkken interneti de yavaşlatır); Merkez'in diski de her kafe için bu kadar büyüyor.

Seçenekler:

| Seçenek | Ne yapar | İş | Risk |
|---|---|---|---|
| A. Ayarları akıllandırmak | Gün sonu yedeğinden kısa süre sonra gelen gece yedeğini atlamak, eski kopyaları seyrekleştirmek (son 7 gün + 4 hafta), sunucu yedeğini kafe kapalıyken (gece) göndermek | 1 gün | Düşük |
| B. Geçmiş yılları ayrı dosyaya almak | Kapanan yıllar ayrı, değişmeyen bir dosyaya taşınır; o dosya bir kez yedeklenir. Günlük yedek ve gönderim yalnız bu yılın verisi kadar kalır (5. yılda 5 kat küçük) | 1-2 hafta | Orta (taşıma ve geri yükleme dikkat ister) |
| C. Artımlı yedek | Her yedekte yalnız son yedekten beri eklenen kayıtlar alınır, ayda bir tam yedek | 1-2 hafta | Orta-yüksek (geri yüklemek için yedek zinciri gerekir) |

**Öneri:** Pilottan önce A (ucuz, hemen fark eder); ilk kafeler 1 yılı doldurmadan B.

**Durum (6 Ekim):** A yapıldı: değişiklik yoksa gece yedeği alınmaz (haftada en az bir), iş günü başına bir yedek, 7 günlük + 4 haftalık + 3 aylık saklama, flash bellekte 3 kopya, Merkez'de 3 günlük + 2 haftalık ve kafenin boyutuna göre yer, ham bayt yükleme (%25 az trafik). Ayrıntı GELISTIRICI_REHBERI bölüm 7 ve 11.

**Durum (6 Ekim, Faz 4):** B de yapıldı (kapanan yıl paketleri). Yoğun kafede 5 yıl sonra gece yedeği 5 dakikadan 24 saniyeye, her yedek 1,8 GB'tan 0,27 GB'a indi; saklama 7 günlük + 4 haftalık + 12 aylık oldu, bu bilgisayardaki yedekler 24 GB yerine yaklaşık 7 GB. Aşağıdaki "Faz 4 sonrası" bölümüne bakın.

### 2. Çok uzun raporlarda diğer tabletlerin beklemesi

Mola'nın sunucusu bir işi bitirmeden sıradakine geçmez. "Tümü" raporu, 5 yıllık Excel veya PDF hesaplanırken (yoğun kafede 1-7 saniye, Celeron'da 15 saniyeye kadar) o sırada sipariş gönderen garsonun ekranı da bu kadar bekler. Günlük işlerde bu hiç görülmedi; yalnız sahip uzun bir rapor açınca olur.

| Seçenek | Ne yapar | İş | Risk |
|---|---|---|---|
| A. Uzun raporları ayrı bir iş parçacığında hesaplamak | Rapor arka planda hazırlanır, tabletler hiç beklemez | 3-5 gün | Düşük-orta |
| B. Aylık özet satırları | Her ayın toplamı bir kez saklanır; "Tümü" 1.800 gün yerine 60 ay okur (10 kat hızlı) | 3-5 gün | Orta (geçmiş bir gün değişince ay da yenilenmeli) |
| C. Ekranda "Tümü" yerine yıl seçimi | "Tümü"ye basınca "Hazırlanıyor" yazar, varsayılan yıllık görünüm | 1 gün | Düşük |

**Öneri:** A (gerekirse C ile birlikte).

**Durum (6 Ekim):** sahibin onayıyla dört aşamalı plan. Faz 2 (B + C: aylık ve yıllık özetler, yıl seçici) yapıldı; aşağıdaki "Faz 2 sonrası" bölümüne bakın. A (ayrı iş parçacığı) Faz 3'te.

### 3. Bellek

Ağır raporlardan sonra Mola'nın bellek kullanımı yoğun kafede 1 GB'a çıkıyor (gerçekte tuttuğu veri 60 MB; geri kalanı Node.js'in sonradan kullanmak üzere elde tuttuğu boş alan). 8 GB RAM'li bilgisayarda sorun yok, 4 GB'ta sınırda. Ayrı bir iş yapmaya gerek yok: 2. maddedeki A seçeneği yapılırsa bu da kendiliğinden düşer. Kafe bilgisayarı için 8 GB önermek yeterli.

### 4. Küçük not: işlem kayıtları sınırsız büyüyor

Her masa temizliği, her taşıma gibi işlemlerin kaydı (işlem geçmişi) hiç silinmiyor: yoğun kafede 5 yılda 1,1 milyon satır, 0,2 GB. Bunlar hiçbir ekranı yavaşlatmıyor, yalnız yer tutuyor. İsterseniz "2 yıldan eski işlem kayıtları özetlenip silinsin" gibi bir kural konabilir (yarım gün iş). Acil değil.

---

## Faz 2 sonrası (6 Ekim): aylık ve yıllık özetler, yıl seçici

**Ne değişti.** Biten her ayın ve her yılın satış, kasa (bahşiş, gün sonu kapanışları) ve personel (çalışma saatleri, vardiyalar, bahşiş payları) toplamı bir kez hesaplanıp ayrı, şifreli bir satırda saklanıyor. "Tümü" ya da bir yıl istendiğinde program 1.800 günü, 70 bin bahşişi, 1.800 kapanışı ve binlerce vardiyayı tek tek açmak yerine bu birkaç satırı okuyor. Geçmiş bir günü değiştiren her işlem (geç kapanan hesap, eski bir hesaba iade, ödeme yöntemi düzeltmesi, geriye tarihli ya da düzeltilen/silinen gider, kapanışa düzeltme, vardiya düzeltmesi) o ayın ve yılın özetini siliyor; bir sonraki rapor onu parça parça yeniden kuruyor. Sunucu açıldıktan yarım dakika sonra eksik özetler arka planda da kuruluyor.

**Ekranda.** Satış ve Raporlar'da dönemler: Bugün · 7 gün · 30 gün · **Yıl ▾** · Tümü · Tarih seç. Açılışta yine "Bugün" seçili. "Yıl"a basınca bu yıl (bugüne kadar) açılıyor, küçük menüden kaydı olan önceki yıllar seçiliyor. "Tümü"de en üstte yıllar tablosu var (Yıl, Satış, İade, Gider, Elde kalan, KDV ve toplam satırı); bir yıla dokununca o yılın raporu açılıyor. Telefonda tablo üç sütuna iniyor, iade, gider ve KDV yılın altında küçük bir satırda. Uzun listeler sayfa sayfa: Kasa kapanışlarında en yeni 62 kapanış ("Daha eski kapanışlar"), Personel ve bahşişte vardiya listesi dönemin son 62 günü, Giderlerde "Tümü"nde en yeni 200 kayıt (toplamlar her zaman bütün kayıtları sayar). Muhasebeci Excel'i ve yazdırılabilir sayfa "Tümü"de yıllara ve aylara göre; tek tek gider, iade ve kapanış listesi için bir yıl seçiliyor. Ekran görüntüleri: `docs/ekran/kafe/rapor-yil-secici.png`, `rapor-tumu.png`, `rapor-tumu-telefon.png`.

**KDV satıldığı orandan.** Önceden geçmiş satışların KDV dökümü ürünlerin bugünkü oranıyla hesaplanıyordu: bir ürünün oranını değiştirmek geçmişi de değiştiriyordu. Artık her sipariş satırı satıldığı oranı taşıyor; bu sürümden önceki satırlar, sürümden sonraki ilk işlemde bir kez kaydedilen oranlarla sayılıyor; aylık ve yıllık özetler oranlarını donduruyor. Bir oranı bugün değiştirmek hiçbir geçmiş günün, ayın ya da yılın KDV'sini değiştirmiyor. "Tümü"nün KDV'si yılların toplamı (yıl tablosu toplamıyla aynı).

**Doğruluk.** Özetlerden okunan her rakam, aynı dönemin gün gün okunan rakamıyla kuruşu kuruşuna aynı: satış, iade, gider, KDV satırları, ödeme türleri, kanallar, ürünler, kampanyalar, saatlik dağılım, çalışanların siparişleri, bahşiş, kasa kapanışları, kişilere göre kasa farkları, personel saatleri, elde kalan. 5 yıllık iki kafede "Tümü", her yıl ve 12 rastgele dönem (19 dönem × 2 kafe) birebir aynı çıktı (`scripts/bes-yil-faz2.ts --dogrula`); otomatik testler geçmiş bir gün değiştiğinde ay ve yıl toplamlarının da tam güncellendiğini, oran değişince geçmiş KDV'nin değişmediğini sınıyor (`tests/rollups.test.ts`). Tek fark: QR menüden sipariş veren farklı tarayıcı sayısı aylar toplanınca **yaklaşık** (iki ayda gelen aynı telefon iki kez sayılıyor); ekranda "yaklaşık" yazıyor.

**Ölçümler** (aynı bilgisayar, HTTP, ms; ikinci açılış; sunucu 3500 portunda, otomatik yedek kapalı):

| Rapor | Orta önce | Orta sonra | Yoğun önce | Yoğun sonra |
|---|---|---|---|---|
| Tümü · özet | 1.211 | 25 | 1.186 | 22 |
| Tümü · sade özet (açılış ekranı) | 2.625 | 89 | 4.158 | 142 |
| Tümü · yıllar tablosu (yeni) | — | 26 | — | 33 |
| Tümü · ürünler / çalışanlar | 560 / 571 | 12 / 17 | 696 / 722 | 15 / 20 |
| Tümü · giderler | 1.440 (3,6 MB) | 41 (0,2 MB) | 1.920 (5,3 MB) | 40 (0,2 MB) |
| Tümü · personel ve bahşiş | 1.591 (0,65 MB) | 61 (0,09 MB) | 2.761 (1,4 MB) | 108 (0,19 MB) |
| Tümü · kasa kapanışları | 237 (3,6 MB) | 54 (0,13 MB) | 169 (4,7 MB) | 66 (0,18 MB) |
| Tümü · rezervasyon | 717 | 145 | 1.142 | 307 |
| Tümü · kârlılık | 771 | 734 | 798 | 1.131 |
| 2025 yılı · özet / sade özet | 368 / 616 | 158 / 47 | 336 / 833 | 146 / 72 |
| 2025 yılı · personel / kasa | 321 / 65 | 38 / 22 | 531 / 65 | 44 / 31 |
| Excel · Tümü / 2025 | 3.236 / 704 | 207 / 340 | 4.818 / 1.000 | 310 / 356 |
| Yazdırılabilir sayfa · Tümü | 2.632 | 149 | 4.001 | 248 |
| Bugün · özet | 12 | 17 | 45 | 42 |
| Bu raporlar sırasında bir tabletin en uzun beklemesi | 3.180 | 282 | 4.819 | 313 |
| Ağır raporlardan sonra bellek (özel bayt) | 919 MB | 371 MB | 932 MB | 431 MB |

Açılıştan hemen sonra ilk "Tümü" (bir tablet 50 ms'de bir sunucuya soruyor):

| Durum | Orta önce | Orta sonra | Yoğun önce | Yoğun sonra |
|---|---|---|---|---|
| Aylık özetler hiç yokken (bu sürüme geçişten sonraki ilk açılış) | — | 0,7 sn; tablet en çok 0,06 sn bekledi | — | 1,0 sn; tablet en çok 0,49 sn |
| Günlük özetler de yokken (özet biçimini değiştiren bir güncelleme) | 33 sn, bütün tabletler 33 sn bekledi | 26-28 sn, tabletler en çok 0,46 sn (bir ölçümde bir kez 2 sn) | 78 sn, bütün tabletler 78 sn bekledi | 79 sn, tabletler p99 0,1 sn (bir kez 2 sn) |
| Arka planda hepsinin kuruluşu (kimse rapor istemeden) | — | açılıştan 37 sn sonra hazır; tablet en çok 0,28 sn | — | 39 sn sonra hazır; tablet en çok 0,17 sn |

Yoğun kafede 5 yıl: 178 aylık + 5 yıllık özet satırı. Kısaca: "Tümü" ve yıllık raporlar 10-50 kat hızlı, tarayıcıya giden veri 20-30 kat küçük, raporlar sırasında tabletlerin en uzun beklemesi 5 saniyeden 0,3 saniyeye indi, bellek yarıya düştü. "Tümü" yıllar tablosu hedeflenen 0,3 saniyenin çok altında (0,03 sn).

**Kalanlar (Faz 3 ve 4 için).** Kârlılık her günü o günün reçete ve fiyatıyla hesapladığı için hâlâ 5 yılın günlük özetlerini okuyor (okuma parça parça, ama son hesap 0,3-0,6 sn tek parça); rezervasyon raporunun "Tümü"sü bütün rezervasyonları okuyor (0,1-0,3 sn); bir yılın Excel'i o yılın tek tek gider, iade ve kapanış kayıtlarını okuyor (0,35 sn). Özet biçimi değişen bir güncellemeden sonra günlük özetlerin yeniden kurulması toplamda yine 30-80 sn işlemci işi (artık tabletleri bekletmiyor). Bunlar Faz 3'te (ağır raporlar ayrı iş parçacığında) ele alınacak. Faz 4'te (kapanan yıl paketleri) yıllık ve aylık özet satırları paketle birlikte taşınabilir; kapanmış yılların raporları o zaman da yalnız özetlerden okunur.

**Yeniden çalıştırma.**

```powershell
npx.cmd tsx scripts/bes-yil-testi.ts uret --profil=orta --kok=<klasör>
npx.cmd tsx scripts/bes-yil-faz2.ts --profil=orta --kok=<klasör> --kaynak=<eski sürümün kopyası> --etiket=once   # önce
npx.cmd tsx scripts/bes-yil-faz2.ts --profil=orta --kok=<klasör> --etiket=sonra --soguk --isinma             # sonra
npx.cmd tsx scripts/bes-yil-faz2.ts --profil=orta --kok=<klasör> --etiket=sonra --gunler-soguk               # günlük özetler de yokken
npx.cmd tsx scripts/bes-yil-faz2.ts --profil=orta --kok=<klasör> --dogrula --soguk                           # özet = gün gün
```

Port 3500 (Merkez adresi 3590, kapalı), otomatik yedek kapalı. Veri bu sefer de silindi (2,5 GB); ham sonuçlar `.local/test-5yil/sonuc-2026-10-06-faz2/`.

---

## Faz 4 sonrası (6 Ekim): kapanan yıl paketleri

**Ne değişti.** Her takvim yılı, bir sonraki yılın **1 Şubat**'ından sonra kendi dosyasına taşınıyor: `yil-2025.sqlite` (Ocak, Aralık'taki düzeltmeler için açık kalıyor). Kayıtlar olduğu gibi, şifreli ve bayt bayt taşınıyor; yılın günlük, aylık ve yıllık özetleri de yanında. Paket bir kez yazılıyor, bir daha hiç değişmiyor. Her gün çalışan dosya (`merchant.sqlite`) artık yalnız açık yılı tutuyor. İşletme sahibi tek bir bildirim görüyor: **"2025 yılı kapandı ve paketlendi."** Raporlar, Excel, kasa ve personel raporları, eski hesap araması ve iadesi paketleri kendiliğinden okuyor; ekranda hiçbir şey değişmiyor. Kafe boşken (gece) yapılıyor; bir güncellemeden sonraki ilk hafta hiç yapılmıyor; önce doğrulanmış bir yedek alınıyor. Eski bir yedekten geri yüklenen ve birkaç geçmiş yılı olan veri ilk fırsatta yıl yıl paketleniyor.

**Kapanan yılın kuralları (sahibin kararı).** Kapanan yıl hiç yeniden açılmıyor. O yılın bir hesabına **iade yapılabiliyor**, ama iade bugünün kaydı oluyor (ürün iadesi de: ürünler bugünün satışından düşüyor); kapanan yılın hiçbir rakamı değişmiyor. Şunlar düz bir cümleyle reddediliyor: o yıla geriye tarihli gider, o yılın giderini düzeltmek ya da silmek, bir gideri o yıla taşımak, o yılın bir ödemesinin yöntemini düzeltmek, o yılın kasa kapanışına düzeltme, o yılın vardiyasını düzeltmek ya da bir vardiyayı o yıla taşımak, o yıla tarihli stok kaydı ve o yılın stok kaydını geri almak. Ekranda: *"Bu yıl kapandı: 2025 yılının kayıtları paketlendi ve artık değiştirilemez. Kaydı bugünün tarihiyle girin."* (`docs/ekran/kafe/kapali-yil-uyari.png`). Yılın bir şeyi hâlâ açıksa (2025'ten açık kalmış bir masa, kapatılmamış bir kasa günü) paketleme bekliyor ve sahibe "2025 yılı henüz paketlenemedi: …" yazıyor. 31 Aralık'ta açılıp 1 Ocak'ta (iş günü) ödenen hesabın siparişleri 31 Aralık'ta, ödemesi 1 Ocak'ta sayılıyor, bugünkü raporlar gibi.

**Stok.** Her malzemenin 1 Ocak 05:00'teki miktarı ve birim maliyeti yeni yıla "Yıl açılışı" sayımı olarak yazılıyor; eski yılın alış, sayım ve fire kayıtları pakete gidiyor. İki kafede 84 malzemenin stoğu paketlemeden önceki ve sonraki hesapta birebir aynı; Kârlılık eski yılları kendi fiyatlarıyla hesaplamaya devam ediyor.

**Yedekler.** Saklama 7 günlük + 4 haftalık + **12 aylık** (önce 3) oldu. Yıl paketleri yedeklere her seferinde girmiyor: her paket bir kez şifrelenip yedek klasörünün yanındaki `yillar/` klasörüne konuyor ve hep saklanıyor; şifreli hâli her seferinde aynı baytlar olduğu için flash belleğe ve Mola Merkez'e de **bir kez** gidiyor, Merkez onu hiç silmiyor. Geri yükleme bütün paketleri getirip tek tek denetliyor. Şerit → Yedekle → "Saklanan yedekler"de her paket "Yıl paketi 2025 · Kalıcı" satırı (`docs/ekran/kafe/yil-paketi.png`). Paketler haftada bir SHA-256 ile, ayda bir satır satır açılarak denetleniyor; bozuk ya da eksik paket bu bilgisayardaki yedekten, flash bellekten ya da Mola Merkez'den kendiliğinden geri geliyor, sahibe haber veriliyor.

**Doğruluk.** İki kafede paketlemeden önce ve sonra 5 yılın bütün rakamları (Tümü, her yıl, 12 rastgele dönem ve dört yılbaşı gecesi; satış, iade, gider, KDV dökümü, ürünler, çalışanlar, kasa ve kapanış farkları, kapanış sayısı, personel saatleri ve bahşiş, tahsilat sayısı ve tutarı, rezervasyon ve etkinlikler, Kârlılık, stok, işlem kaydı) **birebir aynı**: yoğun kafede bütün rakam dosyasının SHA-256'sı eşit; orta kafede tek fark işlem kaydının 4 satır fazla olması (iki ölçüm arasında indirilen 4 Excel'in kaydı). Paketlerden geri yüklenen klasör de aynı rakamları veriyor. Çalışan dosyada paketlenen yılların hiçbir kaydı kalmadı.

**Ölçümler** (aynı bilgisayar; orta kafe ölçülürken yoğun kafe arka planda üretiliyordu, yoğun kafe boş bilgisayarda):

| | Orta önce | Orta sonra | Yoğun önce | Yoğun sonra |
|---|---|---|---|---|
| Çalışan veri dosyası | 499 MB | 77 MB | 1.767 MB | 270 MB |
| Yıl paketleri (2021–2025, 5 dosya) | — | 442 MB | — | 1.579 MB |
| Gece yedeği: yedek + doğrulama provası | 40 + 38 sn | 7 + 6 sn | 85 + 79 sn | 13 + 12 sn |
| Bir yedeğin boyutu | 484 MB | 77 MB | 1.716 MB | 270 MB |
| İlk yedek (paketler bir kez şifrelenir) | — | 9 + 6 sn | — | 18 + 12 sn |
| Sunucu yedeği her gece | 484 MB | 77 MB | 1.716 MB | 270 MB |
| Sunucu yedeği bir kez (paketler) | — | 442 MB | — | 1.579 MB |
| Yeni klasöre geri yükleme (paketler dahil, her satır denetlenerek) | 36 sn | 40 sn | 79 sn | 77 sn |
| Paketleme (5 yıl birden, bir kerelik; sunucu kapalıyken)¹ | | 3,8 dk | | 10 dk (yıl başına 1,8–2,5 dk) |
| Paketlemeden sonraki ilk açılışta boş yerin geri verilmesi | | 1,3 sn | | 2,7 sn |
| 4 yıl önceki bir hesap: bulma / iade penceresi / iade | | 54 / 3 / 13 ms | | 100 / 3 / 8 ms |

¹ Bu iki sayı, silme adımı tabletler için küçültülmeden önceki sürümle ölçüldü; son sürümde silme daha küçük adımlarla yapıldığı için yıl başına yaklaşık 1 dakika daha uzun (aşağıdaki canlı ölçüm).

Bir kafede her yıl yalnız bir yıl paketlenir: yoğun kafede yaklaşık 3 dakika, gece, kafe boşken. Bunu çalışan sunucunun içinde de ölçtük (2 yıllık yoğun kafe, 2024'ün son üç ayı ve 2025 birlikte; bir tablet 50 ms'de bir soruyor): paketleme 3,8 dk sürdü, tablet yanıtlarının yarısı 25 ms, %99'u 0,13 sn içinde geldi; 2.319 istekten 4'ü 0,2 sn'yi aştı, en uzun bekleme 0,6 sn (ilk paketten önceki kopya alınırken). İlk ölçümde en uzun bekleme 1,1 sn idi; satırların canlı dosyadan silinmesi paketin anahtar dizinine göre (hiç tablo taranmadan) ve stok açılışı parça parça yapılınca 0,4–0,6 sn'ye indi (`MOLA_YIL_PAKETI_IZ=1` adımları sunucu kaydına yazar). Celeron'da (2,5 kat) gece yedeği yaklaşık 1 dakika (önce 7 dakika).

Raporlar (yoğun kafe, HTTP, ms, ikinci açılış; önce → sonra): Tümü özet 18 → 21, sade özet 134 → 143, yıllar 35 → 36, ürünler 13 → 17, giderler 41 → 38, personel ve bahşiş 95 → 99, kasa kapanışları 65 → 60, rezervasyon 314 → 306, Kârlılık 780 → 902, 2025 özet 127 → 132, 2025 kasa 18 → 19, Excel Tümü 282 → 270, Excel 2025 344 → 311, yazdırılabilir Tümü 222 → 214, Bugün 33 → 32. Bu raporlar sırasında bir tabletin en uzun beklemesi 283 → 257 ms; bellek (özel bayt) 590 → 514 MB. Sunucu açıldıktan sonra bir paketin ilk okunuşu dosyayı diskten ilk kez okuduğu için bir kez daha uzun sürüyor (Excel 2025 ilk kez 1,0 sn; tablet bir kez 0,9 sn bekledi), sonraki her okuma önceki gibi.

**Disk kullanımı (yoğun kafe, 5. yıl, Ekim):**

| | Bugün (Faz 1–3) | Faz 4 sonrası |
|---|---|---|
| Veri klasörü | 1,8 GB | 1,85 GB (0,27 çalışan + 1,58 paket) |
| Bu bilgisayardaki yedekler | 14 yedek × 1,72 GB = 24 GB | 23 yedek ≈ 5,7 GB + paketler bir kez 1,6 GB = **7,3 GB** |
| Bu bilgisayarda toplam | ≈ 26 GB | ≈ 9 GB |
| Flash bellek | 3 × 1,72 = 5,2 GB | 3 × 0,27 + 1,6 = 2,4 GB |
| Mola Merkez'de bu kafe için | 5 × 1,72 = 8,6 GB | 5 × 0,27 + 1,6 = 2,9 GB |
| Her gece internetten | 1,72 GB (10 Mbps: 23 dk) | 0,27 GB (3,6 dk); yılda bir 0,37 GB paket |

23 yedeğin toplamı hesap: aylık yedeklerin Kasım–Ocak'takileri bir önceki yılı da taşır (o yıl 1 Şubat'ta paketlenir), Şubat'tan sonrakiler yalnız açık yılı; ortalama bir yedek yaklaşık 0,25 GB. İlk paketten önce bir kez alınan okunabilir kopya (`<veri>-tasima-oncesi-v3-…`, 1,8 GB) bu tabloya dahil değil; ilk paketten sonra bir süre saklanıp silinebilir. Hedef (6–7 GB) yedekler için tutuyor; veri klasörüyle birlikte toplam 9 GB.

**Kalanlar.** Faz 3 kalıntılarından ikisi bu turda yapıldı: Kârlılık'ın son hesabı ve stok kayıtlarının ilk okunuşu (5 yılda 30 bin kayıt, 0,7 sn) ile rezervasyon "Tümü" artık parça parça; tabletler beklemiyor. Kârlılık "Tümü" yine her günü okuyor (yaklaşık 1 sn iş, parça parça). Bir paketin açılıştan sonraki ilk okunuşu (yukarıda) disk ısınana kadar bir kez yavaş.

**Yeniden çalıştırma.**

```powershell
npx.cmd tsx scripts/bes-yil-testi.ts uret --profil=yogun --kok=<klasör>
npx.cmd tsx scripts/bes-yil-faz2.ts --profil=yogun --kok=<klasör> --etiket=faz4-once     # raporlar (MOLA_YIL_PAKETI=0)
npx.cmd tsx scripts/bes-yil-faz4.ts once --profil=yogun --kok=<klasör>                   # rakamlar, dosya, yedek, geri yükleme
npx.cmd tsx scripts/bes-yil-faz4.ts paketle --profil=yogun --kok=<klasör>                # geçmiş yıllar, yıl yıl
npx.cmd tsx scripts/bes-yil-faz4.ts sonra --profil=yogun --kok=<klasör>                  # aynı rakamlar mı, yedek, geri yükleme
npx.cmd tsx scripts/bes-yil-faz2.ts --profil=yogun --kok=<klasör> --etiket=faz4-sonra    # raporlar
npx.cmd tsx scripts/bes-yil-faz4.ts iade --profil=yogun --kok=<klasör>                   # 4 yıl önceki hesaba bugün iade
npx.cmd tsx scripts/bes-yil-faz4.ts canli --profil=yogun --kok=<klasör>                  # sunucunun kendisi paketlerken tabletin beklemesi (port 3500)
```

Veri ölçümden sonra silindi (5 yıllık iki kafe 4,5 GB, 2 yıllık yoğun kafe 1,5 GB); ham sonuçlar `.local/test-5yil/sonuc-2026-10-06-faz4/`.

---

## Zayıf bilgisayar son kontrol (7 Ekim)

**Soru:** Bütün işler bittikten sonra, ucuz bir kafe bilgisayarında 5 yıllık bir kafe hâlâ akıcı çalışıyor mu? Kural (sahibin koordinatörü): yılda bir yapılan yıl paketleme dışında hiçbir tablet 0,5 saniyeden uzun beklememeli.

**Nasıl ölçtük.** Orta kafe (günde yaklaşık 160 hesap, 5 yılda 293 bin hesap) yeniden üretildi. 2021–2024 önceden paketlendi, **2025 çalışan sunucunun kendi içinde** paketlendi. Sunucu bu bilgisayarda yalnız **2 mantıksal çekirdek ve düşük öncelikle** çalıştı (`--zayif`, Celeron'a yakın). Aynı anda 10 personel tableti (Masalar 3 sn'de bir), mutfak ekranı, 20 müşteri telefonu, sipariş veren garsonlar ve misafirler, ödeme alan kasiyer vardı; "tablet beklemesi" her 0,25–0,5 sn'de bir sunucuya sorulan boş bir sorunun (`/api/health`) yanıt süresidir.

**Müşteri bilgileri.** Paketlerdeki 554.319 satırın hepsi açılıp tek tek bakıldı: silinmesi gereken kişisel bilgi **0**, telefon numarası **0**. 57.873 hesap satırı (oturan misafirin adı, QR misafirinin tarayıcı kimliği) ve 3.088 rezervasyon satırı (ad, telefon, not) bilgisi silinerek yeniden mühürlendi. **Paketlemeden önce ve sonra bütün rakamlar aynı:** 5 yılın Tümü'sü, her yıl, 12 rastgele dönem ve yılbaşı geceleri (satış, iade, gider, KDV, ürünler, çalışanlar, kasa, personel, rezervasyon ve etkinlikler, Kârlılık, stok, işlem kaydı) tek bir dosyada; dosyanın SHA-256'sı iki ayrı turda paketlemeden önce ve sonra birebir aynı çıktı. Yedekten geri yüklenen klasör de aynı rakamları verdi.

**Sonuç: kural tutuyor.** İki yavaşlık bulundu ve düzeltildi (aşağıda); son ölçümde paketleme dışında hiçbir tablet 0,5 saniyeyi aşmadı.

| Aşama (zayıf mod, son ölçüm) | Tablet beklemesi p50 | p95 | p99 | En uzun |
|---|---|---|---|---|
| Açılış ve yoğun servis (6 dk) | 0,8 ms | 4 ms | 48 ms | 421 ms |
| Bunun içinde gece yedeği (açılıştan 2 dk sonra, 135. sn'de bitti) | 8 ms | 58 ms | 89 ms | 89 ms |
| Raporlar: Bugün, 7 gün, 30 gün, 1 yıl, Tümü, 4 yıl önce; Kârlılık ve rezervasyon Tümü dahil | 11 ms | 82 ms | 194 ms | 193 ms |
| Muhasebeci Excel'i (ay, yıl, Tümü), yazdırılabilir sayfa, PDF | 1 ms | 109 ms | 191 ms | 191 ms |
| Stok ekranı, 4 yıl önceki hesap ve iadesi, 30 günlük arama | 148 ms | 322 ms | 322 ms | 322 ms |
| Yoğun servis, ısınmış (6 dk) | 0,8 ms | 4 ms | 9 ms | 433 ms |
| Gün sonu (sayım ve kapanış) | 1 ms | 1 ms | 1 ms | 1 ms |
| Gün sonu yedeği (gece yedeğiyle aynı doğrulanmış yedek, 70 sn) | 0,7 ms | 22 ms | 43 ms | 46 ms |
| **Yıl paketleme (2025, çalışan sunucunun içinde, 45 sn; yılda bir, kural dışı)** | 10 ms | 65 ms | 104 ms | 647 ms |

Servis sırasında: **sipariş gönderme** p50 16–21 ms, p95 28–47 ms; **ödeme** p50 13–20 ms, p95 23–26 ms; **Masalar** (tablet yenilemesi) p50 4 ms, p95 8 ms, p99 0,33 sn, en uzun 0,34 sn. Raporlar zayıf modda: Tümü özet 0,03 sn, 1 yıl özet 0,18 sn, rezervasyon Tümü 0,2 sn, Kârlılık Tümü 0,85–0,9 sn (parça parça), Excel yıl 0,38 sn, Excel Tümü 0,23 sn, PDF 2,5–2,9 sn (PDF'i Edge yapıyor), kampanyalar 3,9 sn (parça parça; o sırada tabletler en çok 0,19 sn bekledi). Gün sonu sayımı 0,03 sn, kapanış 0,02 sn. Açılış: sunucu 1,1 sn'de yanıt verdi, ilk Masalar 1,6 sn'de geldi.

**Düzeltilenler.**

| Ne bekletiyordu | Önce (zayıf mod) | Sonra |
|---|---|---|
| Kampanyalar raporu 5 yıllık bütün kampanyaları (haftalık kampanyalarda her saat dilimini ayrı) tek parça hesaplıyordu | Bütün tabletler 3,4–3,6 sn bekledi (iki ölçümde) | Her kampanya penceresi ayrı bir adım; tabletler en çok 0,19 sn |
| Açılıştan 3 sn sonra Mola Merkez bağlantısı bilgisayarın kimliğini okumak için `reg.exe` başlatıyordu; Windows'un bir program başlatması zayıf bilgisayarda sunucuyu yarım saniyeden fazla durduruyordu (CPU profiliyle bulundu) | 0,5–0,9 sn | Programlar artık ayrı bir iş parçacığından başlatılıyor; açılıştaki en uzun bekleme 0,42 sn |

Aynı yol (programı ayrı iş parçacığından başlatmak) şunlara da uygulandı: Windows anahtar kilidi, USB fiş yazıcısına giden her fiş (PowerShell; bu bilgisayarda USB yazıcı olmadığı için ölçülmedi, ama artık sunucuyu durduramaz) ve PDF için Edge. PDF'ten sonraki geçici klasörün silinmesi de arka plana alındı (dosya kilitliyse yeniden denemeleri 3 sn'ye kadar sürebiliyordu).

**Kalanlar (kural içinde).** Sunucu açıldıktan sonraki ilk Masalar isteği stok kayıtlarını ilk kez okuduğu için tabletleri bir kez 0,42 sn bekletiyor; yoğun serviste en uzun bekleme 0,43 sn. Yıl paketleme sırasında bir kez 0,65 sn ve o sırada Masalar'ın %5'i 0,63 sn'yi aştı: yılda bir, gece, kafe boşken yapıldığı için kural dışı. Yıl paketleme bu bilgisayarda (zayıf modda) bir yıl için 45 sn sürdü; bunun 9 sn'si müşteri bilgilerinin silinmesi (sunucunun kendi iş parçacığında 12 ms'lik dilimlerle), 5 sn'si doğrulama (ayrı iş parçacığında).

**Yeniden çalıştırma** (port 3500, Merkez adresi 3590, kapalı):

```powershell
npx.cmd tsx scripts/bes-yil-testi.ts uret --profil=orta --kok=<klasör>
npx.cmd tsx scripts/bes-yil-faz4.ts once --profil=orta --kok=<klasör>                  # bütün rakamlar (önce)
npx.cmd tsx scripts/bes-yil-faz4.ts paketle --son=2024 --profil=orta --kok=<klasör>    # 2021–2024
npx.cmd tsx scripts/bes-yil-faz4.ts canli --zayif --profil=orta --kok=<klasör>         # 2025'i çalışan sunucu paketler
npx.cmd tsx scripts/bes-yil-faz4.ts sonra --profil=orta --kok=<klasör>                 # aynı rakamlar mı + paketlerde kişisel bilgi taraması
npx.cmd tsx scripts/bes-yil-testi.ts canli --profil=orta --kok=<klasör>                # bugünün salonu
npx.cmd tsx scripts/bes-yil-olcum.ts --profil=orta --kok=<klasör> --zayif --port=3500 --atla=kapat
```

Veri ölçümden sonra silindi (her tur yaklaşık 1,5 GB); ham sonuçlar (üç ölçüm turu, düzeltmelerden önce ve sonra) `.local/test-5yil/sonuc-2026-10-07-zayif/`.

---

## Teknik ek

### Yöntem

**Veri üretimi** (`scripts/bes-yil-testi.ts uret`, yardımcı veri `scripts/bes-yil-veri.ts`): boş bir geçici klasörde (varsayılan `%TEMP%\mola-bes-yil`, OneDrive dışı; gerçek kurulum klasörleri ve `.local/merkez`, `.local/ornek-*`, `.local/development` korumalı) tek işletme. 30 masa (iç salon, bahçe, teras), 8 kategoride 120 ürün (boy, süt, şurup, şeker, ekstra seçenekleri; Meşrubat %20, diğerleri %10 KDV), her 1 Ocak ve 1 Temmuz'da %18 fiyat artışı, 5 haftada bir kampanya (saatli, kategori, adet koşullu, sabit indirim), 60 malzeme + 24 hazır ürün, reçeteler (900. günde bir kısmının yeni sürümü), personel kadroları (orta 8, yoğun 15 kişi; 6-30 ayda bir değişen kişiler, eski hesaplar kapatılıyor). Her gün: hafta günü, ay, Ramazan ve maç akşamına göre hesap sayısı; saatlere göre dağılmış ziyaretler; personel ve QR siparişleri (1-3 tur), mutfak durumları, %2 iptal (tamamı ya da bir ürün), masa taşıma, hesap birleştirme, masasız siparişler (masa yoksa da masasız), nakit/kart/bölünmüş/ürün seçerek/parça ödemeler, bahşiş, aynı gün ve aylar önceki hesaplara iade, ödeme yöntemi düzeltmeleri, rezervasyon (kaporalı, gelmedi, iptal, kapora kararı), ayda 1-2 etkinlik (geçici masalar), kasa açılışı, para bozdurma, haftalık "kasadan alınan", gün sonu kör sayım (%85 tam, %15 farklı), vardiyalar (sabah/akşam, geç kalma), giderler (kira, maaş, faturalar, kasadan küçük giderler), stok alışları (%40'ı aynı zamanda gider olarak), ayın 1'inde sayım (malzemelerin 1/3'ü hiç sayılmıyor), fire, ajanda notları, bildirimler, gece yarısını ve gün sonunu geçen uzun masalar.

Her işlem gerçek kurallarla yapıldı: `submitOrder`, `setStatus`, `recordPayment`, `cancelByStaff`, `moveTable`, `mergeAccounts`, `submitTakeaway`, `adjustPayment`, `recordExpense`, rezervasyon ve etkinlik kuralları, `CashBook` (açılış, sayım, kapanış, bahşiş), `ShiftBook`, `StockBook`, `AgendaBook`, `Notifications`; kapanan hesapları geçmiş tablolarına `History.persist` taşıdı (sunucunun kendisi gibi iki saatte bir). HTTP kullanılmadı (5 yıllık yoğun kafe HTTP ile günler sürerdi). Rastgelelik her gün için ayrı tohumla sabit: aynı komut aynı sayıları verir (kimlikler hariç). Kural reddi sıfır. Yanında senaryonun kendi defteri tutuldu (`beklenen.json`: gün gün tahsilat, iade, gider, kapanış farkı, stokta kalan). Destek talepleri ve platform (Yemeksepeti) deneme siparişleri üretilmedi.

`canli` aynı kuralla bugünün 05:00'inden şu ana kadarki salonu kurar (açık masalar, son 6 saatin kapanmış hesapları). `sikistir` sunucunun tek seferlik "geçmiş sıkıştırma" geçişini önceden yapar (gerçek bir kafede bu iş zaten yapılmış olur; orta 22 sn, yoğun 48 sn).

**Ölçüm** (`scripts/bes-yil-olcum.ts`): gerçek sunucu (`server/index.ts`, `SERVE_BUILD=1`, tsx ile), port 3400, Merkez adresi kapalı 3490 (lisans çevrimdışı geçerli), otomatik yedek açık. Yük A (6 dk): açılış, arka plan işleri ve sabah telafi yedeği sürerken; Yük B (6 dk): her şey ısınmışken yoğun saat. Yük: 10 personel cihazı 3 sn'de bir Masalar, mutfak ekranı 2,5 sn'de bir, 20 müşteri telefonu 4 sn'de bir menü, 4 müşteri sipariş veriyor, garsonlar masa açıp sipariş gönderiyor, servis ediyor, temizliyor, kasiyerler ödeme alıyor, sahip 30 sn'de bir bugünün özetine bakıyor; yoğun saatin 4 katı hız (yoğun kafede dakikada 4 yeni hesap). Her 0,5 sn'de bir boş istek (`/api/health`) atılarak sunucunun donma süreleri ölçüldü. Sonra bütün raporlar (bugün, 7, 30, 365 gün, Tümü, 4 yıl önceki bir ay; ilk ve ikinci açılış), dışa aktarmalar, geçmiş ekranları, gün sonu, iki ani kapatma (taskkill /F) ve yeniden açılış. `--zayif`: sunucu Windows `start /affinity 3 /belownormal` ile 2 mantıksal çekirdekte, düşük öncelikte. `--soguk`: günlük özetler silinmiş halde (özet biçimini değiştiren bir güncellemeden sonraki durum). `--tarayici`: Playwright ile sahibin ekranları (`scripts/bes-yil-tarayici.spec.ts`), `--zayif` ile Chrome 4 kat yavaş.

**Doğrulama** (`scripts/bes-yil-dogrula.ts`, sunucu kapalıyken): sunucunun günlük özetleri senaryonun defteriyle her gün için, yıllık finans raporu her yıl için, KDV dökümü, bütün kapanış pencereleri, stok seviyeleri, e-posta dönem raporları (PDF dahil), telefon raporu, doğrulanmış yedek ve yeni klasöre geri yükleme.

### Makine

AMD Ryzen 5 5600X (6 çekirdek / 12 iş parçacığı), 32 GB RAM, Samsung 970 EVO Plus NVMe, Windows 11 Pro, Node 24.14. Sunucu geliştirme biçimiyle (tsx) çalıştı; kurulum paketindeki derlenmiş sunucu açılışta biraz daha hızlıdır. Üretim sırasında diğer profil arka planda üretiliyordu; ilk orta kafe ölçümü bundan biraz etkilenmiş olabilir.

### Üretim

| | Orta | Yoğun |
|---|---|---|
| Süre | 14 dk | 80 dk |
| Gün | 1.826 (2021-10-06 - 2026-10-05) | 1.826 |
| Ziyaret / masasız / QR siparişi | 266 bin / 26 bin / 83 bin | 868 bin / 297 bin / 271 bin |
| İptal (tam / kısmi), taşıma, birleştirme | 3.986 / 4.001, 3.996, 1.620 | 12.964 / 13.112, 10.858, 4.353 |
| İade (aynı gün / eski hesap), yöntem düzeltme | 1.769 / 203, 692 | 6.777 / 212, 2.640 |
| Rezervasyon (geldi / gelmedi), etkinlik | 3.652 (2.942 / 361), 58 | 10.956 (8.547 / 1.256), 112 |
| Gün sonu kapanışı, bahşiş | 1.826, 21.260 | 1.826, 68.801 |
| Stok alışı, sayım, fire | 26.285, 3.360, 550 | 29.180, 3.360, 562 |
| SQLite dosyası | 545 MB | 1.813 MB |
| Geçmiş hesap satırı / işlem kaydı / ödeme dizini | 294 bin / 358 bin / 350 bin | 1,17 milyon / 1,11 milyon / 1,35 milyon |
| Yer kaplayanlar (yoğun) | | hesaplar 864 MB, işlem kaydı 176 MB, ödeme dizini 305 MB, kasa kayıtları 135 MB |

### Ham sayılar (yoğun kafe, düzeltmelerden sonra; ms)

Yük B (ısınmış, 6 dk), hızlı bilgisayar / zayıf mod:

| İstek | p50 | p95 | p99 | en çok | zayıf p50 | zayıf p95 |
|---|---|---|---|---|---|---|
| Sipariş gönder (`POST /staff/orders`) | 35 | 150 | 160 | 160 | 54 | 267 |
| Ödeme (`POST /staff/payments`) | 39 | 139 | 139 | 139 | 98 | 231 |
| Mutfak durumu (hazırlanıyor / hazır) | 28 | 44 | 74 | 275 | 83 | 112 |
| Servis edildi | 32 | 245 | 256 | 256 | 73 | 501 |
| Masalar, tablet (90-170 KB, değişmediyse 204) | 10 | 19 | 87 | 406 | 18 | 64 |
| Müşteri menüsü (44 KB) | 8 | 16 | 468 | 589 | 10 | 46 |
| Donma ölçer (`/api/health`) | 1 | 8,5 | 33 | 722 | 1,1 | 21 |

Yük A (açılış + sabah yedeği 4 dk sürerken): sipariş p50 54 / p95 102, ödeme 56 / 140, donma ölçer p99 82, en uzun 1.075 ms. Açılış: sunucu cevap verene kadar 1,2 sn, ilk Masalar verisi 1,9 sn (özet biçimi değişmişse 3,6 sn). Mutfak yeni siparişi 1,6 sn (p50) içinde gördü (2,5 sn'lik yenilemeyle). Bellek: açılışta 250 MB, Yük A sonunda 330 MB, raporlardan sonra 970 MB; orta kafede çöp toplandıktan sonra gerçekten tutulan veri 60 MB (stok için 5 yılın günlük karışımı dahil), gerisi V8'in boş ama işletim sistemine geri vermediği alan.

Raporlar (ilk / ikinci açılış, hızlı bilgisayar):

| | Bugün | 30 gün | 1 yıl | Tümü |
|---|---|---|---|---|
| Özet | 52 | 91 | 456 | 1.570 |
| Ürünler | 45 | 49 | 181 | 875 |
| Finans | 43 | 59 | 400 | 2.101 |
| Çalışanlar | 42 | 55 | 161 | 908 |
| Kârlılık | 200 | 175 | 312 | 987 |
| Personel ve bahşiş | 40 | 88 | 736 | 3.452 |
| Rezervasyon | 36 | 136 | 2.020 / 259 | 28.189 / 1.279 (eski etkinlikler ilk kez) |
| Kasa kapanışları | 31 | 78 | 466 | 2.326 (gösterilmeyen liste gönderilmeyince 1.447) |
| Sade özet | 109 | 167 | 1.246 | 5.996 |

Dışa aktarma: Excel ay 201 / yıl 1.436 / Tümü 6.865 ms (755 KB); yazdırılabilir sayfa ay 161 / yıl 1.260 / Tümü 6.027; PDF ay 2.182 / yıl 2.533 / Tümü 7.569 (Chrome'un PDF'e çevirmesi 1,5-2 sn). Geçmiş: 4 yıl önceki bir günün ödemeleri 349, o günün bir hesabı 28, iade penceresi 26, iade 75; 30 günde "Masa 07" araması 2.057 (ilk), 1 yılın toplamları 265, 5 yılın 569. Ajanda 13, rezervasyon listesi 19, bildirimler 19. Gün sonu: sayım 60, tamamla 41. Stok ekranı 406 / 307. E-posta raporları: gün 5 (PDF 1,4 sn), hafta 12, ay 45, yıl 1.481 (PDF 1,5 sn), Tümü 7.382. Telefon raporu 25 ms, 5 KB.

Tarayıcı (Playwright, 1280x800; hızlı / Chrome 4 kat yavaş): Masalar ilk açılış 957 / 1.162 ms; Sipariş al 82 / 170, masa seçince menü 49 / 239; Satış ve Raporlar 847 / 899; Özet 1 yıl 1.520 / 2.267, Tümü 6.385 / 8.293 (sunucunun hesabı); Ürünler Tümü 231 / 658; Kârlılık 1.105 / 193; Kasa kapanışları Tümü 1.626 / 2.017 (en uzun ana iş parçacığı bloğu 52 / 306); Personel ve bahşiş Tümü 933 / 1.475; Menü yönetimi 76 / 338; Stok 34 / 86. Düzeltmeden önce Kasa kapanışları Tümü 1.800 `/api/staff/me` isteği atıyor ve 571 ms blok yapıyordu; zayıf modda Personel ve bahşiş 25,5 sn sürüyordu.

Güncellemeden sonra (`--soguk`: günlük özetler silinmiş, özet biçimini değiştiren bir güncellemenin ardından olduğu gibi): ilk Masalar verisi 3,6 sn (son 30 günün özetleri o anda yeniden hesaplanıyor). Özetler arka planda 12 ms'lik dilimlerle yaklaşık 4 dakikada yeniden kuruldu (5 yıl, 141 işlemci-sn); bu sırada donma ölçer p95 66, en uzun 734 ms, sipariş ve ödeme normal. 6. dakikadaki raporlar ısınmış hâldeki kadar hızlıydı (Tümü özet 1.620, sade özet 6.535). Bu 4 dakika içinde biri "Tümü"yü açarsa eksik günler o anda hesaplanır ve o istek (Celeron'da) dakikalar sürebilir: karar 2'deki A seçeneği bunu da çözer.

Yedek (sunucu kapalı, `createVerifiedBackup`): orta 103 sn, 206 işlemci-sn, 540 MB; geri yükleme 49 sn. Yoğun 296 sn, 806 işlemci-sn (yedek bir iş parçacığında kopyalanıyor, doğrulama ana iş parçacığında 25 ms'lik dilimlerle), 1.804 MB; geri yükleme 138 sn. Geri yüklenen klasörde 5 yılın toplamları ve tablo satır sayıları birebir aynı. Sunucu yedeği klasörü base64 parçalarla gönderir: yaklaşık 4/3 boyut (orta 720 MB, yoğun 2,4 GB).

Önce / sonra (orta kafe, HTTP, ms): Personel ve bahşiş bugün 1.760 / 18, Tümü 4.198 / 1.633; Rezervasyon 1 yıl 1.632 / 478, Tümü 16.530 / 5.561; sade özet 1 yıl 2.259 / 1.211, Tümü 11.820 / 5.982; Özet Tümü 2.623 / 1.322; Finans Tümü 3.191 / 1.480; Kasa kapanışları Tümü 2.318 / 1.709; Excel Tümü 15.110 / 6.690; yazdırılabilir Tümü 12.698 / 5.374; PDF Tümü 13.356 / 6.614; 30 günlük arama 1.079 / 161; Yük A'da en uzun donma 2.913 / 565. Aynı işlerin sunucu içinden ölçümü (`reportWindow` "Tümü"): 5.069 / 3.178, yıl 956 / 635. İlk ölçümlerde en çok zaman alan iş (CPU profili) `snapshotKey` idi: rapor turunun %46'sı.

### Doğruluk sonuçları

- 1.826 günün her biri: tahsilat (nakit + kart + kaporayla ödenen), iade ve gider sunucunun günlük özetiyle senaryonun defterinde birebir aynı; iki profilde de fark 0. Kuruşlar tam sayı, NaN yok, eksi değer yok.
- Her yıl ve 5 yılın tamamı: finans raporu = günlerin toplamı = senaryonun defteri (orta 94,8 milyon TL, yoğun 343,3 milyon TL tahsilat).
- KDV: ay ve yıl için oran satırlarının toplamı genel toplama, her satırda matrah + KDV = brüt, brüt = satış - iade.
- Kasa: 1.826 kapanışın pencereleri arka arkaya, boşluk yok; her kapanışta beklenen = açılış + nakit satış - nakit iade - nakit gider + konan - alınan + nakit bahşiş + kapora; sayım farklarının toplamı senaryonunkiyle aynı (orta 633 TL, yoğun 541 TL); pencereler, kaporayla ödenen tutar dışında bütün tahsilatı içeriyor.
- Stok: 84 kalemin hepsinde sunucunun hesapladığı stok (5 yıllık satış, reçete sürümleri, seçenekler, alış, sayım, fire) senaryonun defteriyle aynı; eksi stok yok.
- Ani kapatma: yoğun kafede 43 ve 17 onaylı işlem varken sunucu zorla kapatıldı; açılışta hepsi yerinde, aynı isteği tekrar göndermek aynı sipariş ve ödeme numarasını döndürdü (çift kayıt yok). Yeniden açılış 1,1-1,4 sn.
- Yedek ve geri yükleme: aynı toplamlar, aynı satır sayıları.
- Tarih sınırları: `tests/date-edges.test.ts` (29 Şubat 2028, yılbaşı, TZ=UTC / New York / Tokyo / Londra, gün sonunu geçen masa) ve üretilen verideki 280-299 gece masası.
- Sunucu kayıtlarında hiç hata satırı yok.

### Yapılan değişiklikler (kod)

- `server/store.ts` `snapshotKey`: açılmış işletme anahtarı, satırın baytları her seferinde karşılaştırılarak, veritabanı başına saklanıyor.
- `server/history.ts`: `history_archives_span` dizini (`closed_at - first_at`).
- `server/shifts.ts`: Personel ve bahşiş bahşişleri kasa gününe göre (dizinli) okuyor; kişi başına en yeni 120 vardiya listeleniyor, hepsi sayılıyor (`shiftCount`).
- `server/reservations.ts`: etkinlik satırı yalnız etkinliğin hesaplarını açıyor (oluşturulduğu andan kapandıktan 1 saat sonrasına); taşınan etkinliğin satırı `event_reports` tablosuna bir kez yazılıyor (yedek doğrulaması ve Tanıtım sıfırlaması bu tabloyu da biliyor).
- `server/email-reports-content.ts` `periodData`, `server/report-export.ts` `reportWindow`: rapor ve tabloları aynı okumayı paylaşıyor.
- `server/stock.ts`: stok kullanan işletmede açılış ısınması bütün günleri okuyor; dakikalık stok taraması bunun bitmesini bekliyor.
- `server/cash-closing.ts`: "Girildi" kullanılmadıysa kapanış kaydına ödeme listesi yazılmıyor; Kasa kapanışları raporu eski kayıtların gösterilmeyen listesini göndermiyor.
- `src/CashReports.tsx`: kapanış listesi 62'şer kart; rol bir kez soruluyor; vardiya listesi kısaltıldıysa not.
- Testler: yeni `tests/sealed-reads.test.ts` (3), `tests/report-payloads.test.ts` (2), `tests/date-edges.test.ts` (3); `tests/reservations.test.ts` ve `tests/fiscal-helper.test.ts`'e birer test. Toplam 670 birim testi (669 geçti, 1 atlanan), ilgili 18 tarayıcı test dosyası geçti.

### Yeniden çalıştırma

```powershell
# 1. Veri (orta yaklaşık 15 dk, yoğun 80 dk). Varsayılan klasör %TEMP%\mola-bes-yil; --kok=<klasör> ile değişir.
npx.cmd tsx scripts/bes-yil-testi.ts uret --profil=orta          # yeniden üretmek için --sil
npx.cmd tsx scripts/bes-yil-testi.ts sikistir --profil=orta      # yalnız eski bir üretimde; yeni üretim bunu kendisi yapar
# 2. Doğrulama ve yedek (sunucu kapalı; canli'den önce çalışırsa stok da birebir karşılaştırılır)
npx.cmd tsx scripts/bes-yil-dogrula.ts --profil=orta
# 3. Bugünün salonu (günde bir kez) ve ölçüm (port 3400, yaklaşık 25 dk)
npx.cmd tsx scripts/bes-yil-testi.ts canli --profil=orta
npx.cmd tsx scripts/bes-yil-olcum.ts --profil=orta [--dakika=6] [--zayif] [--soguk] [--atla=rapor,kapat]
npx.cmd tsx scripts/bes-yil-olcum.ts --profil=orta --tarayici [--zayif]
```

Sonuçlar profil klasöründe: `uretim.json`, `beklenen.json`, `dogrulama.json`, `olcum*.json`, `tarayici*.json`, `sunucu*.log`. Lisans 10 yıllık bir test anahtarıyla imzalı, Merkez'e bağlanmadan 14 gün geçerli; daha sonra veri yeniden üretilmeli. Ölçüm bittiğinde bu testin veri klasörleri silindi (yedekleriyle birlikte 5,2 GB); komutlar aynı veriyi yeniden üretir. Bu turun ham sonuç dosyaları (birkaç yüz KB) `.local/test-5yil/sonuc-2026-10-06/` klasöründe.

# Son kullanıcı testi (10 Ekim 2026)

Yeni yerleşimden ("Her şey yerli yerinde") sonra, hafta sonu arkadaş denemesinden önceki son bağımsız deneme.

## 1. Ne denendi?

- **Kurulu paket**, geliştirme sunucusu değil: Windows paketi ve Mola Yönetim paketi geçici klasöre kuruldu (3501 / 3591), geçici verilerle. Sizin kurulumunuza ve verinize dokunulmadı.
- **Hafta sonu senaryosu baştan sona, cihazlar aynı anda:** kasa bilgisayarı (1366 × 768), iki garson telefonu, mutfak tableti (yatay), sahibin telefonu ve bilgisayarı, Müdür telefonu, dört misafir telefonu (biri İngilizce).
- Her rol günlük işini yeni yerinde buldu mu: kasiyer (Kasa = yalnız Bugün), garson, mutfak, Müdür (Kasa ayarları yok, farkı görmüyor), sahip.
- (13 Ekim: "Taşındı → Git" tabelaları kaldırıldı; eski hatırlanan yerler yeni yere açılır.) **Zil**deki her bildirimin düğmesi, **derin bağlantılar** (Gider kaydet, İadeyi yap, Gün sonuna git, QR kodlarına git, Ödemeyi düzelt), **hatırlanan sekmeler**, **telefon kodu** açıkken taşınan para sekmeleri.
- **Elle sağlama** (kâğıt ile Mola aynı mı):

| | Kâğıt | Mola |
|---|---|---|
| Satış | ₺910 | ₺910 |
| Nakit / Kart | ₺535 / ₺375 | ₺535 / ₺375 |
| Giderler (ekmek ₺30 + süt alışı ₺60) | ₺90 | ₺90 |
| İadeler (kasiyer ₺35 + sahip ₺190) | ₺225 | ₺225 |
| Kart komisyonu %2,5 | ₺9,38 | ₺9,38 |
| Elde kalan | ₺585,62 | ₺585,62 |
| Beklenen nakit (500 + 535 − 90 − 225 − 15 bahşiş) | ₺705 | ₺705 |
| Sayılan / fark | ₺695 / −₺10 | ₺695 / −₺10 |
| Banka POS (kart ₺375 + kart bahşişi ₺35) | ₺410 | ₺410, fark ₺0 |
| Z raporu | ₺910 | ₺910 |
| Ek kapanış (gün sonundan sonra ₺35) | ₺535, fark yok | ₺535, fark yok |

Müdür ve kasiyer hiçbir ekranda beklenen nakdi ve farkı görmedi; kasiyer Kasa'da yalnız Bugün'ü gördü (diğerlerine sunucu da kapalı).

## 2. Düzeltilenler

1. **Lisans sözleşmesi penceresi bazen iki kez açılıyordu** (10 girişten 3'ünde; üsttekini kabul edince alttaki kalıyordu). İki pencere aynı anahtarı kullanıyordu; düzeltildi.
2. **Kasa bilgisayarında (1366 × 768) sol menüde "Ayarlar" yarım görünüyordu, "Hesabım" hiç görünmüyordu** (sahip ve Müdür). Kısa ekranda menü sıklaştırıldı; Mola penceresinin boyunda (1366 × 690) da her şey görünüyor.
3. **"İade yapıldı" bildirimi "Kapanışları aç" diyordu.** Artık "İadeleri aç" (Kasa ve giderler → İadeler).
4. **Kart bahşişi kasadan verilince kapanışta "· · kartla bahşiş" yazıyordu** (masa adı yoktu). Artık "Masa 05 · kartla bahşiş".
5. **Mutfak iptal ederken kasa aynı anda ödemeyi alırsa mutfağa misafirin yazısı çıkıyordu** ("QR kodunu yeniden açın"). Artık: "Bu siparişin hesabı kapandı (ödeme alındı); para geri verilecekse kasada İade yapılır." (Hangisi önce gelirse o geçerli; rakamlar iki durumda da doğru.)
6. **Müdür'ün sayfa açıklamaları sahibe göreydi** (Kasa ve giderler'de "kasa ayarları"). Artık rolüne göre.
7. **Eski cihazda hatırlanan yerler:** "Yazıcı ve ses → Sesler" ve "Güvenlik ve diğer → Cihazlar" ilk sekmeye açılıyordu; artık kendi yerine açılır.
8. Kasiyer yetkileri ⓘ'sinde eski yer adı ("İade ve düzeltme") → "Kasa ve giderler → İadeler".
9. Hafta sonu senaryosunun "teslimden sonra iptal" adımı uygulamayla uyuşmuyordu (teslim edilen siparişte iptal düğmesi yok). Adım "mutfak hazırlarken" olarak düzeltildi, PDF yenilendi.
10. Kılavuz çekimi eski "Çalışanlar" yerine Personel → Çalışanlar'a gidiyor; Mola Yönetim testi bu bilgisayarın dolu diskinden etkilenmiyor.

Her düzeltmenin otomatik testi var (birim: sayfa açıklamaları, bildirim düğmeleri, pencere anahtarları, mutfak iptali; tarayıcı: kısa ekranda menü, sözleşme tek pencere, bahşiş satırı, eski Ayarlar yerleri). Kullanım kılavuzu PDF'inde yeni yerleşimin beş resmi eksikti ve Ayarlar resimlerinin bir kısmı eski düzendeydi; hepsi yeniden çekildi.

Son koşu: birim testleri 788 (787 geçti, 1 atlandı), tarayıcı testleri 115 dosya (114 ilk seferde, 1'i test yardımcısındaki zamanlama yüzünden; düzeltildi ve geçti), kurulu paket testi 25/25, kurulum paketleri ve pilot paket denetimi geçti.

Bu testlerin kapsamadığı: gerçek telefonlar/tabletler ve gerçek Wi-Fi (denemeler bu bilgisayarda tarayıcı ekranlarıyla yapıldı), gerçek fiş yazıcısı, Mola penceresinin (Mola.exe) kendisi, internetten (VDS) menü.

## 3. Karar gerekenler

- **K1 · Misafirin ödeme tercihi:** Misafir "Hesabı iste → Kart" deyince ödeme penceresi "Müşteri Kart dedi" diye açılıyor. Garson çağrıyı ✓ ile kapatırsa bu not kayboluyor. Önerim: hesap kapanana kadar kalsın.
- **K2 · Stok alışından sonra "Giderlerde gör":** bağlantı yalnız formun içinde var; kaydettikten sonraki yeşil satırda yok. Önerim: yeşil satıra da eklensin.

## 4. Güncelleme denetimi

Önceki paket (9 Ekim kurulum dosyası) geçici bir klasörde çalıştırıldı: etkinleştirme, çalışanlar, ayarlar (komisyon, kasiyer iade sınırı ₺50, kart bahşişi kasadan), otomatik gider (kira), yarın için rezervasyon ve ajanda notu, iki ödeme, gider, iade, farklı bir gün sonu; sahip sözleşmeyi kabul etti, eski Ayarlar'da "Sipariş ve kasa → Kasa ve ödeme"yi, raporlarda "Para → Giderler"i açık bıraktı. Sonra program dosyaları yeni paketle değiştirildi, **aynı veri klasörüyle** açıldı:

- Rakamlar, ayarlar, çalışanlar, otomatik gider, rezervasyon, ajanda, kampanya, KDV, kapanış ve farkı: **önce = sonra**, hiçbir şey kaybolmadı.
- Sahibin bilgisayarı ve kasiyer tableti **girişli kaldı**.
- Sözleşme (sürüm 3) **yeniden sorulmadı**.
- Hatırlanan eski yerler yeni evlerine açıldı: Ayarlar → Sipariş ve mutfak (üstte "Kasa ve ödeme taşındı → Git"), Raporlar → "Para taşındı" (Git → Kasa ve giderler → Giderler, ekmek gideri orada).
- Yeni sürümde sipariş ve ödeme sorunsuz sürdü.

## 5. Hafta sonu için kurulum

1. Yeni `Mola Kurulum.exe`'yi (`.local/installer/Mola-0.1.0/Windows`) kafe bilgisayarında çalıştırın; kaldırmayın, üstüne kurun (veriler korunur).
2. Mola açılınca sahip olarak girin; Ayarlar → Güvenlik ve yedek → Yedek'ten "Şimdi yedekle".
3. Personel → Çalışanlar'dan hesapları açın; Kasa ve giderler → Kasa ayarları → Kasiyer yetkileri: iade sınırı ₺50.
4. Bilgisayarın ağı "Özel" olsun; telefonlar ve tablet aynı Wi-Fi'da, Mola uygulaması ya da tarayıcıdan bağlanır.
5. `docs/pdf/Mola-Hafta-Sonu-Senaryosu.pdf`'yi yazdırıp dağıtın; Kasa açılışı ₺500 ile başlayın.

# Mola denetim raporu

8 Ekim 2026 · Mola 0.1.0 · Bağımsız denetim: "sahip bulmadan önce bulalım"

## 1. Ne denendi?

Kurulu programın **aynısı** denendi (geliştirme sunucusu değil): `npm run test:paket` ile derlenen Mola ve Mola Yönetim, kendi geçici verisiyle bu bilgisayarda (3501 / 3591). Sizin kurulumunuza ve verinize dokunulmadı.

Tarayıcı: Edge (Mola penceresiyle aynı). Ekranlar: telefon 390, tablet 1024 × 768 (yatay) ve 768 × 1024 (dik), bilgisayar 1280 × 900 ve 1366 × 768. Dil: Türkçe ve İngilizce Windows gibi (en-US).

Baştan sona bir gün oynandı:

- **Mola Yönetim:** İşletme ekle (önce boş ad, sonra emojili ad), kod, işletme sayfasının sekmeleri.
- **İlk kurulum:** etkinleştirme (sözleşme kutusu işaretsiz de denendi), sahip hesabı (hatalı kullanıcı adı, kısa ve eşleşmeyen şifre), sihirbaz bilerek yanlış girişlerle: komisyona `30`, `2.5`, `2,5`, `%1,79`, `0,0179`, `-1`, `abc`; 0 ve 101 masa; iç masa sayısı toplamdan büyük; 700 ve −5 saniye; 1 harflik ad, 80 harften uzun ad, emoji.
- **Çalışanlar:** garson, mutfak, kasiyer, müdür.
- **Menü:** "Bira" ürünü.
- **Servis:** kasiyer açılışı ₺500 · misafir telefondan sipariş (sepet, adet, ürün çıkarma, değiştirme süresi) · garson onayı · mutfak (başla, hazır) · garson teslim · garson telefonundan sipariş · masasız sipariş.
- **Ödemeler:** ürün seçerek nakit (₺200 verildi, para üstü ₺10) · bir kısmı kartla · kalanı ₺500 ile (para üstü ₺370) · kart + ₺20 bahşiş · tam nakit · kart · masasız nakit.
- **Kasa:** kasiyer gideri "Kasadan" ₺30 · para bozdurma ₺200 · kasiyer iadesi ₺35 (nakit) · sınırı aşan iade (₺160, kart) → sahibe istek → sahip iadeyi yaptı · sahibin stok alışı ₺300 "Kasa dışı nakit" · kasiyer kör gün sonu (₺10 eksik sayım, POS ₺571).
- **Raporlar (sahip):** sade özet, detaylı özet, KDV dökümü, Kasa kapanışları, İade ve düzeltme.
- **Kim neyi görüyor:** garson, mutfak, kasiyer ve müdür hesaplarıyla bütün para ekranları denendi (ekrandan ve doğrudan sunucudan).

Yazdırma, PDF, A4 ve Excel tarafını paket testi zaten kurulu programda otomatik deniyor (25 denetim); bu denetimin sonunda yeniden çalıştırıldı.

Denenmeyenler (zaman): telefon raporu (Raporlarım), yedek ve geri yükleme, vardiya kodu, destek yazışması, uzaktan destek, dondurma.

## 2. Para sağlaması (elle hesap ile Mola karşılaştırması)

| Kalem | Elle hesap | Mola'nın gösterdiği | Sonuç |
|---|---|---|---|
| Satış | 520 + 266 + 105 + 245 + 110 = ₺1.246 | ₺1.246 (sade özet, detay, Masalar "Bugün") | Tutuyor |
| Nakit / Kart | 190 + 130 + 105 + 110 = ₺535 / 200 + 266 + 245 = ₺711 | ₺535 / ₺711 | Tutuyor |
| Giderler | 30 (kasadan) + 300 (stok, kasa dışı) = ₺330 | ₺330, "Stok alışları dahil (₺300)" | Tutuyor |
| İadeler | 35 + 160 = ₺195 | ₺195 | Tutuyor |
| Kart komisyonu | 711 × %1,79 = ₺12,73 | ₺12,73 | Tutuyor |
| Elde kalan | 1.246 − 330 − 195 − 12,73 = ₺708,27 | ₺708,27 | Tutuyor |
| Beklenen nakit | 500 + 535 − 35 − 30 = ₺970 | ₺970 | Tutuyor |
| Sayım farkı | 960 − 970 = −₺10 | −₺10 (yalnız sahipte) | Tutuyor |
| Kart (Mola) / POS | 711 + 20 bahşiş − 160 = ₺571 | ₺571, fark ₺0 | Tutuyor |
| KDV (%10) | 1.246 − 195 = ₺1.051 → matrah ₺955,45, KDV ₺95,55 | Aynı | Tutuyor (ama Bira %10 kaydedilmişti, aşağıda 3.3) |

Kasiyer, gün sonunda yalnız saydığı ₺960'ı gördü: beklenen, fark, "eksik/fazla" hiçbir yerde yok.

## 3. Bulunan ve düzeltilenler

### Önemli

**3.1 İngilizce Windows'ta tarayıcının kendi yazıları İngilizce, tarihler ay/gün sırasıyla çıkıyordu.**
- **Önce:** Boş zorunlu alanda "Please fill out this field." çıkıyordu (`once-ingilizce-uyari-please-fill.png`). Tarih alanları **10/08/2026** gösteriyordu. Bu "8 Ekim" demek, ama Türk biri "10 Ağustos" okur (`once-rezervasyon-inside-outside-ve-tarih-ay-gun.png`). Gider tarihi, rezervasyon günü, kampanya ve dondurma tarihleri bundan etkileniyordu. 12 saat sorununun kardeşi.
- **Sonra:** Mola ve Mola Yönetim penceresi Edge'i Türkçe açar (`--lang=tr`). Uyarı "Lütfen bu alanı doldurun." olur, tarih **08.10.2026**, saat 24 saat olur (`sonra-edge-lang-tr-tarih-saat.png`). Bilgisayarın dili ne olursa olsun böyle. Not: pencere bir kez kapanıp açılınca geçerli olur.

**3.2 Stok → Alış kaydet ve Giderler → Gider ekle: "Kasadan nakit" seçince üç düğme (sizin isteğiniz).**
- **Önce:** Ödeme yöntemi zaten seçilmişken, kaydete basınca kırmızı kutu ve üç düğme çıkıyordu: "Kasa dışından", "Kasadan, yine de kaydet", "Başka yöntem seç".
- **Sonra:** Seçimin hemen altında kısa sarı bir not çıkar: "Kasada şu an ₺410 görünüyor; bu çıkışla −₺57 olur. Para kasadan çıkmadıysa “Kasa dışı nakit”i seçin." Ek düğme yok. Para gerçekten kasadan çıktıysa normal **Alışı kaydet** / **Gideri kaydet** kaydeder (`sonra-kasadan-nakit-tek-not.png`). Kılavuz ve test listesi (12.6a) güncellendi.

**3.3 "Bira" %10 KDV ile sessizce kaydediliyordu; yazar kasa listesi de yanlış çıkıyordu.**
- **Önce:** "Alkollü içecek gibi görünüyor… %20 seç" ipucu çıkıyor ama basılmazsa ürün %10 ile kaydediliyordu. Gün sonundaki "yazar kasaya girilmesi gereken" satırı da Bira'yı %10'da gösterdi.
- **Sonra:** Adı alkollü içecek gibi görünen **yeni** ürün kendiliğinden %20'ye geçer. Altında "Alkollü içecek gibi göründüğü için %20 seçildi. Değilse yukarıdan değiştirin." yazar. Sizin elle seçtiğiniz oran her zaman geçerlidir.

**3.4 Mutfak tableti (yatay): QR siparişinin "Onayla" ve "Reddet" düğmeleri görünmüyordu.**
- **Önce:** Onay kutusu panonun üstünde kısa bir şerit. İki ürünlük bir siparişte bile düğmeler şeridin altında kalıyordu. Dokunmatik ekranda kaydırma çubuğu da görünmüyor (`once-mutfak-onay-dugmeleri-gizli.png`).
- **Sonra:** Mutfakta düğmeler masa adının yanında, her zaman görünür.

**3.5 Gün sonu, açık hesap varken hiçbir şey söylemiyordu.**
- **Önce:** Masa 02'nin ₺230'luk hesabı açıkken kasiyer gün sonunu yaptı, uyarı çıkmadı.
- **Sonra:** Sayım penceresinde tek satır: "1 açık hesap var: Masa 02 ₺230. Mümkünse önce ödemesini alın; gün sonundan sonra alınan ödeme için ek kapanış gerekir." Sayım engellenmez.

**3.6 Sade özetteki "Beklenen" formülü kâğıtta tutmuyordu.**
- **Önce:** "Beklenen = açılış ₺500 + nakit satış ₺535 − kasadan ödenen gider ₺30 (nakit iade, bahşiş… ile)". Toplamı ₺1.005 çıkıyor, ama Beklenen ₺970 yazıyordu. ₺35'lik nakit iade yalnız parantezde anılıyordu (`once-beklenen-formulu-tutmuyor.png`).
- **Sonra:** "… − kasadan ödenen gider ₺30 − nakit iade, bahşiş ve sahibin hareketleri ₺35 = ₺970." Formül her zaman beklenen tutarla biter.

### Küçük

- **3.7** Ajanda → Rezervasyonlar masa planında bölüm adları **"inside" / "outside"** diye İngilizce yazıyordu. Artık "İç masalar" / "Dış masalar".
- **3.8** Kurulum sihirbazında **Devam** düğmesi gri kalıyor ama nedeni yazmıyordu: ad 2 harften kısa, iç masa sayısı toplamdan büyük, değişiklik süresi 600'ü aşıyor ya da eksi. Artık her birinin altında kısa bir açıklama var. Özette "₺500 TL üstü" yazıyordu, artık "₺500 üstü".
- **3.9** Ödeme penceresindeki hızlı düğme "₺1000" yazıyordu, artık "₺1.000". Mutfak kartındaki **Geri al** düğmesi iki satıra bölünüyordu, düzeltildi.

Her düzeltmenin testi var: `tests/owner-day.test.ts`, `tests/area-title.test.ts`, `tests/browser/owner-day.spec.ts` (tek not, açık hesap satırı, tutan formül), `tests/browser/kitchen-floor.spec.ts` (1024 × 768'de düğme görünür), `tests/browser/report-simple.spec.ts` (Bira %20).

## 4. Kararlarınız ve yapılanlar (8 Ekim)

Raporun ilk hâlindeki 12 karar maddesine verdiğiniz cevaplar uygulandı.

| # | Karar | Yapılan |
|---|---|---|
| K1 | Müdür beklenen nakdi ve farkı hiçbir yerde görmesin. | **Yapıldı.** Satış ve Raporlar → Kasa kapanışları müdüre yalnız gün, kim, ne zaman ve sayılan tutarı gösterir; "Fark" sütununda "—" var. Sade özet cümlesi müdüre "Gün sonu kapanışı yapıldı." der, tutar söylemez. Yazdır / PDF ve Muhasebeci Excel'i de böyle. Sunucu bu bilgileri müdüre hiç göndermez. Bildirimler zaten yalnız sahipte. Çalışan ekleme penceresindeki müdür listesi ve geliştirici rehberindeki yetki tablosu güncellendi. |
| K2 | Kartla bahşiş garsona kasadan verilirse tek soru sorulsun; bir ayara bağlı, ilk hâli kapalı. | **Yapıldı.** Ayar: Ayarlar → Sipariş ve kasa → Kasa ve ödeme → **Kart bahşişini kasadan nakit öde** (ⓘ ile açıklamalı, ilk hâli kapalı). Açıkken kartla bahşiş yazılınca soru çıkar: "Bahşiş garsona kasadan nakit verildi mi?" **Evet** derseniz kasaya "Kart bahşişi nakit ödendi" çıkışı yazılır ve beklenen nakit düşer; kasa kapanışında ayrı satır olarak görünür. **Hayır** derseniz bahşiş raporda garsona ödenecek olarak kalır. Ayar kapalıyken hiçbir şey değişmedi. |
| K3 | Garson "Otomatik onay"ı açabilsin. | **Olduğu gibi kaldı.** |
| K4 | Bildirim ne olduğunu söylesin ve doğrudan işe götürsün. | **Yapıldı.** Masalar'daki uyarı en yeni bildirimin başlığını yazar (örneğin "İade isteği: Masa 06 · ₺160 · 1 bildirim daha"). İade isteğinde düğme **İadeyi yap**'tır ve doğrudan bekleyen iade istekleri açılır. Diğer bildirimlerde düğme **Bildirimleri aç** olarak kalır. |
| K5 | Mola'nın kendi tarih alanı (gün.ay.yıl). | **Yapıldı.** Bütün tarih alanları "08.10.2026" gösterir ve öyle yazılır: kafede ve Mola Yönetim'de, telefonda ve İngilizce bilgisayarda aynı. Rakamları yazmak yeter ("08102026"), noktalar kendiliğinden girer. Sağdaki küçük takvim düğmesiyle gün takvimden de seçilir. 15 ekran etkilendi: gider tarihi, rezervasyon ve etkinlik günü, kampanya tarihleri, dondurma, rapor "Tarih seç", iade dönemi, otomatik giderler, Mola Yönetim kayıt ve satış tarihleri. |
| K6 | Garson telefonu Masalar'da açılsın; boş onay kutusu görünmesin. | **Yapıldı.** Onay bekleyen sipariş yokken "0 bekleyen" kutusu görünmez. Otomatik onay açıksa kutu durur ki kapatılabilsin. |
| K7 | Masasız sipariş kartında tek durum. | **Yapıldı.** Kartta tek satır var, örneğin "Yeni sipariş · Ödendi" ya da "Hazır · Ödeme bekliyor · ₺110". Ayrı "Mutfakta hazırlanıyor" yazısı kalktı. |
| K8 | Aynı ürün tekrar eklenince adedi artsın. | **Yapıldı.** Aynı ürün aynı seçenek ve notla eklenince tek satırda adet artar. Notlu ya da paketlenen ürün ayrı satır kalır. |
| K9 | Mola Yönetim önceki adla da bulsun. | **Yapıldı.** İşletme sahibi adı değiştirince eski ad saklanır (en çok 5 ad). Arama eski adı da bulur, kutuda "Önceki adı: …" yazar. |
| K10 | Komisyon oranı iki ondalıkla görünsün. | **Yapıldı.** Raporlarda "kart satışına oranı %1,79" yazar. |
| K11 | Mutfağa fiyat gönderilmesin. | **Yapıldı.** Mutfak tabletine giden menüde fiyat, seçenek farkı ve kampanya bilgisi yok. |
| K12 | Sol menünün altı 1366 × 768'de görünsün. | **Yapıldı.** Destek, Kilitle ve Çıkış menünün altında hep görünür (menü üstünde kayar). Kısa ekranlarda boşluklar azaldı. Kullanıcı satırı artık üç satıra bölünmüyor. |

## 5. Test listesiyle (GERCEK_CIHAZ_TESTI) uyuşmayanlar

- **1.1 ve 1.6:** "Yedekten geri yükle" seçeneği ve kurtarma kodu penceresi yalnız Mola penceresinde (masaüstü simgesinden) çıkar. Aynı adres normal tarayıcıda açılırsa çıkmaz. Test Mola penceresiyle yapılacağı için sorun yok.
- **3.4:** Bira artık kendiliğinden %20 (güncellendi).
- **5.6:** Not sepette değil, ürün penceresinde yazılıyor (K8).
- **12.6a:** Yeni adım eklendi: Kasadan nakit notu.

## 6. Sonuç

Paranın sağlaması her yerde tuttu. Kör sayım kasiyerde ve artık müdürde de her yerde geçerli. Yazdırma ve PDF kurulu programda çalışıyor.

İlk hâlindeki üç asıl risk kapandı:

- **Dil ve biçim:** Mola penceresi Türkçe açılıyor. Tarihler her cihazda gün.ay.yıl, saatler 24 saat.
- **Rol görünürlüğü:** Müdür kasa farkını hiçbir yerde görmüyor (K1).
- **Açıklamasız sayılar:** Beklenen formülü tutuyor. Kartla bahşişin kasadan verilmesi, isterseniz açacağınız bir ayarla kayda geçiyor (K2).

En sık işlerde fazlalık temizlendi:

- Üç düğme bire indi.
- Bira için ek tıklama kalktı.
- Mutfakta onay düğmeleri görünür oldu.
- Bildirim doğrudan işe götürüyor.
- Masasız kartında tek durum var.
- Sepette aynı ürün tek satırda.

# Gece test raporu (5 Ekim 2026)

Uygulamanın son hali altı rolde, gerçek kullanıcı gibi davranan testlerle baştan sona denendi. Her test kendi deneme sunucusunda çalıştı; kurulu Mola'nıza, Mola Yönetim'e ve verilerinize dokunulmadı.

| Rol | Cihaz | Ne denendi |
|---|---|---|
| Müşteri | iPhone 13 ve küçük Android boyutu | QR, menü, arama, seçenekler, kilo, kampanya, sepet, sipariş, değiştirme/iptal, garson çağırma, hesap, İngilizce, kötü niyetli istekler |
| Garson | Telefon | Giriş, vardiya kodu, sipariş, QR onayı, çağrılar, temizlik, taşıma, iptal, rezervasyon, etkinlik masaları, yetki sınırları |
| Kasiyer | Kasa bilgisayarı ve tablet | 3 kasa günü: açılış, her tür ödeme, bahşiş, masasız, platform, kapora, para bozdurma, gider, vardiya devri, gün sonu |
| Mutfak | Duvar tableti, yatay ve dik | Sipariş akışı, onay kuyruğu, iptal ve stok sorusu, platform siparişi, sesler, 20+ sipariş yükü, mutfağın stok ekranı |
| İşletme sahibi | Bilgisayar ve telefon | Temiz kurulumdan başlayıp bir tam gün: menü, stok, kampanya, raporlar, ajanda, rezervasyon, kasa, vardiya, destek, şifremi unuttum |
| Mola ekibi + derbi gecesi | Mola Yönetim + 16 cihaz aynı anda | Başvuru, lisans, hizmet, destek, bildirim, güncelleme; 25 geçici masalı derbi gecesi |

## Kısaca sonuç

**Düzeltmelerden sonra bütün testler geçti:**
- 499 birim testinden 498'i geçti; 1'i bu bilgisayarda PowerShell 7 olmadığı için atlandı.
- 166 tarayıcı testinin hepsi iki kez arka arkaya, tek seferde, hatasız geçti. İkinci tur gece 05:00 gün dönümünü de kapsadı.
- Paketler yeniden üretildi: `.local\installer\Mola-0.1.0`.

- **Para doğru.** Üç kasa günü ve iki derbi gecesi boyunca bütün rakamlar kuruşu kuruşuna tuttu: kasa kapanışı, Özet, Ürünler, Kârlılık, Personel, Rezervasyon ve Stok birbirini doğruladı. İki derbi gecesinde de kasa farkı 0 çıktı.
- **Güvenlik sağlam.** Müşteri, garson, kasiyer ve mutfak yetkisi olmayan hiçbir şeyi yapamadı; denenen bütün sahte istekler reddedildi. Bulunan birkaç küçük açık kapatıldı (aşağıda).
- **Hız iyi.** Derbi gecesinde 16 cihaz 10 dakikada 300'den fazla sipariş girdi; sunucu yanıtlarının %95'i 44 milisaniyenin altında kaldı, ekran donması olmadı.
- **40'tan fazla hata bulundu, hepsi düzeltildi** ve her birine bir daha olmaması için test eklendi.
- **Sadelik:** müşteri ekranı çok iyi (5/5). Zayıf noktalar garsonun telefondaki Masalar ve Sipariş al ekranları ile mutfak panosu (2/5). Bunlar için önerilerim aşağıda; tasarımı değiştirdikleri için sizin onayınızı bekliyorlar.

## Düzeltilen önemli hatalar

**Yüksek önemde olanlar**
1. **Gün sonu kapanışı, kapanışı yapan kasiyerin vardiyasını bitiriyordu.** Ekran sonucun ortasında vardiya kapısına atlıyor, fiş yazdırılamıyordu. Sabah dünün kasası kapatılınca bugün başlayan vardiyalar da bitiyordu. Artık yalnız kapanan günün vardiyaları bitiyor; kapanışı yapanın vardiyası "Tamam"a basınca bitiyor.
2. **"Kasada bırakılan" tutar 15 saniye sonra kendiliğinden değişiyordu.** Yarının açılışı yanlış kaydediliyordu. Düzeldi.
3. **Mutfakta hızlı çift dokunuş alttaki siparişi de ilerletiyordu** ve geri alınamıyordu. Artık kart kayarken diğer kartlara dokunuş sayılmıyor; her adımdan sonra 5 saniye "Geri al" var.
4. **Mutfak Stok ekranındayken yeni sipariş sesi çalmıyordu.** Artık Mola'nın her ekranında çalıyor; garson, kasiyer ve sahip için de aynı.
5. **Garson ve masasız siparişler mutfakta 60 saniye "Müşteri değiştirebilir" diye kilitleniyordu.** Değiştirme süresi artık yalnız QR'dan gelen müşteri siparişlerinde var.
6. **Garson telefonunda "Sipariş hazır" yalnız sesle bildiriliyordu.** Artık sayı rozeti, "Masa 03 · #5 hazır" notu ve titreşim var.
7. **Kuryeyle giden platform siparişleri garsonun telefonunu çaldırıyor ve teslim listesine düşüyordu.** Artık garsona gitmiyor.
8. **Masa taşınınca ya da birleştirilince müşteriye "Hesabınız kapandı, teşekkürler" ve yorum isteği çıkıyordu**, siparişleri kayboluyordu. Artık "Siparişleriniz başka bir masaya taşındı" yazıyor; yeni masanın adı gösterilmiyor.

**Orta önemde olanlar (seçmeler)**
- Gece yarısından sonra raporlar farklı günlere yazıyordu (Özet bir günde, kasa kapanışı başka günde). Artık bütün raporlar, kasa ve stok aynı **kasa gününü (05:00–05:00)** kullanıyor; gece 01:30'da "Bugün" o akşamı gösteriyor.
- "1.250", "25.000" gibi noktalı tutarlar reddediliyordu, bazen hiç mesaj vermeden. Artık bütün Türkçe yazımlar kabul ediliyor.
- Mutfak sayımında birim kg/L gelip ekranda g/ml gösteriliyordu: 850 yazınca 850 kg kaydoluyordu. Artık gösterilen birim geliyor ve 10 kattan büyük farkta onay soruluyor.
- Ödeme ekranında bahşiş açılınca "Para üstü" ve "Kaydet" ekranın altına kayıyordu. Artık altta sabit duruyorlar. Ayrıca Tam / ₺100 / ₺200 / ₺500 / ₺1000 hızlı düğmeleri, kapora satırı ve artı/eksi düğmeleri eklendi.
- Kasa kapanışında kartla alınan kapora ayrı satırda görünmüyordu; düzeldi.
- Dik tablette mutfak sütunları alt alta diziliyordu. Artık "Yeni · Hazırlanıyor · Hazır" sekmeleri var.
- İptaller mutfağa sessiz geliyordu. Artık ayrı bir iptal sesi ve 30 saniye görünen kırmızı "İPTAL" şeridi var.
- İptal penceresi, sunucunun reddedeceği adetleri seçtiriyordu (kampanyalı ve kısmen ödenmiş ürünler). Artık bunlar baştan seçilemiyor ve sebebi yazıyor.
- 05:00'te garson açıklamasız giriş ekranına düşüyor, yarım sepeti kayboluyordu. Artık "İş günü bitti" yazıyor ve sepet korunuyor.
- Müşteri: Türkçe klavyeyle arama ("ihlamur", "cay") ürün bulamıyordu. Sayfa yenilenince sepet boşalıyordu. Tükenen ürünün adı söylenmiyordu. İngilizce menüde "MENÜ" yazıyordu. Hepsi düzeldi.
- Mola Yönetim:
  - Yıllık abonelikte "1 ay uzat" planı aylığa çeviriyordu.
  - Aynı vergi numarasında önce başvuran işletme onaylanamıyordu.
  - Yeni 30 günlük deneme ilk günden "Bitiyor" görünüyordu.

  Hepsi düzeldi.
- Etkinlik sırasında Masalar'daki "Açık masa" ve "Açık hesap" sayıları geçici masaları saymıyordu; düzeldi.

**Güvenlik açıkları (kapatıldı)**
- İşletmeler listesinin CSV dosyası, Excel'de formül çalıştırmaya açıktı (başvuru formu herkese açık olduğu için önemliydi). Düzeltildi.
- Mola Yönetim çok zayıf şifreleri ("aaaaaaaaaaaa", "111111111111") kabul ediyordu. Artık tekrar, sıra, yıl ve yaygın kelimeler reddediliyor. Bugünkü şifreniz çalışmaya devam eder; bir sonraki değişiklikte yeni kurala uymalı.
- Doğru iki adımlı doğrulama kodu bir yanlış denemeden sonra 1 dakika reddediliyordu. Artık yalnız yanlış denemeler sayılıyor.
- Ek dosya adlarındaki görünmez yön değiştirme karakterleri ("gizli‮gpj.exe" gibi) temizleniyor.
- Mola Yönetim'in e-posta gönderen adresi boş kalabiliyordu; artık zorunlu.

**Performans iyileştirmesi:** Personel ekranlarının sunucudan sürekli çektiği veri küçültüldü. Mutfakta 179 KB'tan 48 KB'a, diğer ekranlarda 196 KB'tan 114 KB'a indi. Aynı tür ses de en çok 5 saniyede bir çalıyor; derbi gecesinde garson telefonları 4–5 saniyede bir çalıyordu.

## Sadelik değerlendirmesi

5 = ilk kez kullanan biri hemen anlar.

| Rol | Puan | Güçlü yan | Zorlayan |
|---|---|---|---|
| Müşteri | 4–5 | Menü, seçenekler, sepet, garson çağırma çok net; latte 4 dokunuşta | Siparişi değiştir penceresi (2/5) ekleme penceresinden farklı ve kodlu |
| Garson (telefon) | 2–3 | Rezervasyon "Geldi mi?" (5/5), sipariş kuralları | **Masalar** ve **Sipariş al** ekranlarında masalar ve ürünler ilk ekranda görünmüyor; "Masa 5'e 2 latte + 1 cheesecake" 10 dokunuş + 2 kaydırma |
| Kasiyer | 3–4 | Kör sayım, gider, para bozdurma, platform onayı | Masalar'da kasa ve istatistik kartları masaları aşağı itiyor |
| Mutfak | 2–4 | 2 dokunuşla sipariş, iptal ve stok sorusu net | Pano: kenar çubuğu ve başlık yer kaplıyor, yazılar uzaktan okunmuyor |
| İşletme sahibi | 3–4 | Kurulum, stok, ajanda, şifremi unuttum çok iyi | İlk Masalar ekranı (2/5) kalabalık; 10 Ayarlar konusu; telefonda 11 öğeli üst menü |
| Mola ekibi | 4 | İşletmeler, lisans, destek, bildirimler | Başvuru kartları kalabalık; bu yüzden "Olası tekrar" satırları katlanabilir yapıldı |

## Önerilerim (onayınızı bekliyor)

Önem ve etki sırasına göre:
1. **Garson telefonunu sadeleştirmek.** Masalar'da masa ızgarası en üstte, istatistikler gizli ya da tek ince satır olsun. Sipariş al'da masa seçilince ürünler hemen altta başlasın; seçeneksiz ürüne tek dokunuşla +1 eklensin. Garson telefonunda "Ürün numarası" kutusu kalksın; arama zaten kodu buluyor. Hedef: "2 latte + 1 cheesecake" 5–6 dokunuş.
2. **Mutfak modu.** Kenar çubuğu ve başlık olmadan tam ekran pano, yaklaşık 1,5 kat büyük yazılar, geciken siparişte kartın tamamı renkli.
3. **Telefonda alt menü çubuğu.** 4–5 ana öğe ve "Daha fazla". Bugün 11 öğe yana kayıyor.
4. **İlk Masalar ekranını toparlamak** (sahip ve kasiyer). Tek kasa kartı olsun ve masalar istatistiklerin üstüne çıksın.
5. **Garsona bölüm/masa ataması.** "Hazır" sesi ve listesi yalnız kendi masaları için gelsin. Derbi gecesinde her garson her siparişte çaldı.
6. **Ayarlar'ı 10 konudan 6'ya indirmek:** İşletme · Masalar ve QR · Yazıcı ve ses · Sipariş ve kasa · Giderler ve kâr · Güvenlik; Cihazlar ve Entegrasyonlar "Diğer" altında.
7. **Müşteri menüsü.** Fotoğrafsız ürünleri kompakt satır olarak göstermek (bugün bir ekranda yalnız 2 ürün görünüyor). Kampanyanın koşulunu yazmak ("2 al, her biri ₺10 indirimli"). "Ekstra" grubunda birden fazla seçim (shot + krema).
8. **Kampanyalarda "Bütün kategoriyi seç"** ve "3 al 2 öde" türü kampanya.
9. **Ürün bazlı iade.** Bugün iade yalnız tutar olarak yapılıyor.
10. Dokunulmamış "yeni" sipariş birkaç dakika sonra mutfakta bir kez daha çalsın.

## Size sorularım

1. **Otomatik onay:** Garson ve mutfak, bütün işletme için QR "Otomatik onay"ını açıp kapatabiliyor. Yalnız sahipte mi olsun?
2. **Rezervasyon telefonları:** Garson ve kasiyer rezervasyon telefon numaralarını görebiliyor; bir istekle bir yıllık listeyi çekebiliyorlar. Önerim: telefonu yalnız sahip ve kasiyer görsün, garson yalnız adı.
3. Garson Masalar'da para tutarlarını (açık hesap toplamı, masa bakiyesi) görsün mü?
4. Garson yokken kasiyer masayı "Temizlendi" yapabilsin mi?
5. Kasiyer küçük iadeleri (ör. bir çay) kendisi yapabilsin mi, yoksa "Sahibe iade isteği gönder" mi olsun?
6. Kasiyerin nakit gider uyarısı yalnız tek kayda mı baksın, günlük toplama da mı? Bugün 3 × ₺190 gider, ₺200 sınırına takılmıyor.
7. **Kira:** "Elde kalan"da ödendiği gün tek seferde mi görünsün, aya yayılarak mı? İlk günde −₺23.863 görmek korkutucu olabilir; şimdilik altına açıklama notu eklendi.
8. Gün sonundan sonra satış olursa ikinci bir "Gün sonu" yapılıyor. Bu yöntem uygun mu?
9. Personel oturumları 05:00'te bitiyor. Daha geç açık kalan işletmeler için bir tolerans gerekir mi?
10. Müşterinin siparişini değiştirme süresi 60 saniye. Yeterli mi?
11. Tarayıcı engelleme çerez silinerek aşılabiliyor. Masa bazında "QR siparişlerini durdur" seçeneği ister misiniz?
12. Mutfak kartında rezervasyonlu misafirin adı ve etkinlik adı görünsün mü?
13. Vardiya başlamadan gelen siparişler, mutfak vardiyayı başlatınca bir kez çalsın mı?
14. "Sadece QR menü" paketinde personel siparişi, kasa, mutfak ve raporlar bugün açık. Kapalı mı olmalı?
15. Raporları görebilen ama ayarları değiştiremeyen bir "Müdür" rolü ister misiniz?
16. Hesap istenirken müşteri "Nakit / Kart" seçsin mi? Garson doğru cihazla gelir.
17. Mola Yönetim yönetici şifresini unutursanız bugün sıfırlama yolu yok. Kurtarma kodlarıyla (iki adımlı doğrulamanın yedek kodları) ya da bilgisayarda bir komutla sıfırlama ekleyeyim mi?

## Kararlarınız uygulandı: roller ve vardiya

- **1. Otomatik onay:** yalnız siz, müdür ve garson açıp kapatır; mutfak açamaz (siparişleri tek tek onaylamaya devam eder). Sizde Ayarlar → Sipariş ve kasa → Sipariş ve onay'da.
- **2. Rezervasyon telefonu:** garson yalnız misafirin adını görür; telefon ve not ona hiç gönderilmez. Garson yeni rezervasyona telefon yazabilir ama sonra göremez. Kasiyer, müdür ve siz görürsünüz.
- **3.** Garson masa tutarlarını görmeye devam ediyor. **4.** Kasiyer masayı “Temizlendi” yapabiliyor.
- **Garson ataması** (isteğe bağlı, kapalı): Ayarlar → Sipariş ve kasa → Sipariş ve onay'da her garsona bölüm ya da masa verirsiniz; hazır sipariş, garson çağrısı ve hesap isteme yalnız o garsonun telefonunu çaldırır, kimseye verilmemiş masalar herkesi.
- **Vardiya görev seçimi:** Ayarlar → Kasa ve vardiya'da hangi görevlerin vardiya başlatacağını seçersiniz (Garson · Kasiyer · Mutfak · Müdür; başta hepsi). Vardiya başlamadan gelen siparişler için vardiya başlayınca bir kez “Vardiya başlamadan N sipariş geldi” notu ve tek ses çıkar.
- **12.** Mutfak kartında rezervasyon, misafir ve etkinlik adı görünmez.
- **15. Müdür rolü:** sipariş, ödeme, kasa ve gün sonu, sınırsız iade, rezervasyon, bütün raporlar, stok, kampanya ve menü. Ayarlar, Çalışanlar, sahibin kasa çıkışları, gider düzeltme, rapor kodu kurulumu, lisans/destek/yedek yapamaz. Raporlar kodla korunuyorsa müdür sizin kodunuzu girer. Tam liste Çalışanlar'da “Müdür” seçince ve `docs/GELISTIRICI_REHBERI.md` → “Roller ve yetkiler”de.

## Gerçek cihazda denenmesi gerekenler

- iPhone Safari ve Android uygulamasında QR okutma, kamera, ses ve ekranın açık kalması.
- Gerçek fiş yazıcısı ve A4 yazıcı.
- Mac ve Linux paketleri.
- Windows'un yönetici onayı penceresi (güvenlik duvarı izni).
- Gerçek Gmail ile e-posta gönderimi.

## Onaylanan sadeleştirmeler (5 Ekim, öğleden sonra)

Önerilerden 1, 2, 3, 4 ve 6 yapıldı:
- **Mutfak modu.** Mutfak hesabı tam ekran panoda çalışıyor: kenar çubuğu ve başlık yok, ince üst çubukta işletme, saat, ses, aşama sayıları, Stok, Hesabım, Çıkış. Yazılar yaklaşık 1,5 kat; 10 dakikayı geçen siparişin bütün kartı turuncu, 20 dakikayı geçen kırmızımsı. Her sütun kendi içinde kayıyor. Pano yalnız mutfak hesabında (5 Ekim: sahibin "Mutfak ekranı" kaldırıldı; kasa ve mutfak tek ekranda "İkiye böl" ile). Çift dokunuş koruması, "Geri al", İPTAL şeridi, stok soruları ve onay kuyruğu aynen duruyor.
- **Telefonda alt menü.** Telefonda (700 px'e kadar) üstte kayan menü yerine altta sabit çubuk: her rolün en çok kullandığı 4 yer ve "Daha fazla". Sayılar ve kırmızı nokta çubukta da görünüyor.
- **Garson telefonu.** Masalar'da tek satır özet, Tümü/Açık/Boş/Hazır çipleri ve 3 sütun küçük masa kutusu: 12 masa kaydırmadan görünüyor. Sipariş al'da masa tek çip, tek arama kutusu, ürünler satır satır; seçeneksiz ürüne "+" tek dokunuşla ekliyor, altta "3 ürün · ₺330 · Gönder" çubuğu. "Masa 05'e 2 latte + 1 cheesecake" 8 dokunuş, kaydırma yok (eskiden 10 dokunuş + 2 kaydırma).
- **Tezgâhta Masalar** (sahip ve kasiyer, bilgisayar ve yatay tablet): slogan ve 4 kart yerine tek satır, kasa şeridi tek çip (menüsünde bütün kasa işlemleri), İlk adımlar katlı; 12 masa 1280×800 ekranda kaydırmadan görünüyor. Hiçbir işlem kaybolmadı; test her birini tek tek açıyor.
- **Ayarlar 10 konudan 6'ya:** İşletme · Masalar ve QR · Yazıcı ve ses · Sipariş ve kasa · Giderler ve kâr · Güvenlik ve diğer. Eski her ayarın yerinde olduğunu bir test tek tek kontrol ediyor. Güvenlik'teki teknik sözcükler ("Authenticator", "IP engeli", "BitLocker", "tarayıcı kaydı") sade Türkçeye çevrildi.

Ekranlar: `docs/ekran/kafe/mutfak-modu.png`, `mutfak-modu-dik.png`, `alt-menu-garson.png`, `alt-menu-sahip.png`, `garson-masalar.png`, `garson-siparis.png`, `masalar-sahip.png`, `ayarlar-6-konu.png`.

## İki ekran (5 Ekim)

- **İkiye böl.** Kasa bilgisayarının Mola penceresinde şeritteki "İkiye böl" iki Mola ekranını yan yana açıyor; solda kasiyer, sağda mutfak ayrı ayrı giriş yaptı. Kasiyerin gönderdiği sipariş mutfak bölmesinde sesle (ses sayacı) göründü. İki 960 px bölme tablet düzeninde, yana kayma yok; mutfak üç sütun. ◀ / ▶ / "Ekranı ikiye eşit böl", sürükleme (%30) ve Ctrl+Alt+← / → çalıştı; yeniden yüklemede bölme, oran ve iki giriş geri geldi; soldan çıkış sağdaki mutfağı etkilemedi; "Tek ekran" ve yeniden bölme sağ oturumu korudu (	ests/browser/split-screen.spec.ts, ekran docs/ekran/kafe/iki-ekran.png).
- **Oturum ayrımı.** Bölme başına HttpOnly/SameSite=Strict çerez (mola_staff, mola_staff_p2), bölme başına çıkış, sahip kilidi ve 05:00 sonu; anahtarsız, vekil üzerinden, masaüstü uygulaması olmayan ya da ağdaki cihazdan bölme kipi 403 PANE_REFUSED; bölme masaüstü araçlarına ulaşamıyor; yabancı Origin reddediliyor (	ests/split-panes.test.ts, 6 test).

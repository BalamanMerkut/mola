# Mola Gerçek Cihaz Testi

Kendi bilgisayarınızda, telefonlarınızda ve tabletinizde Mola'yı baştan sona denemek için adım adım liste. VDS (internetteki sunucu) kurulmadan önceki yerel deneme içindir. Mola 0.1.0 · 8 Ekim 2026.

> **Bilgi:** Bu dosya iki yerde kullanılır: burada okunur ve `npm.cmd run pdf:test-listesi` ile yazdırılabilir PDF olur (`docs/pdf/Mola-Gercek-Cihaz-Testi.pdf`). Bir şeyi değiştirmek için yalnız bu dosyayı düzeltin, sonra PDF'i yeniden üretin.

## Bu liste nasıl kullanılır?

- Bölümleri sırayla yapın. Her bölüm, öncekilerin hazırladığı şeyleri kullanır.
- Her satırda önce **Ne yapın** sütununu uygulayın. Sonra ekranı **Ne olmalı** sütunuyla karşılaştırın.
- Aynıysa ☐ kutusunu işaretleyin (✓). Farklıysa kutuya **X** koyun, **Not** sütununa kısaca yazın ve ekran görüntüsü alın. Nasıl bildireceğiniz Bölüm 30'da.
- Kısmen doğruysa kutuya **~** koyun ve nedenini yazın.
- "İsteğe bağlı" yazan bölümleri vaktiniz olursa yapın.
- Bir adım takılır ve sonrakileri de engellerse durun ve bana yazın. Engellemiyorsa not alıp devam edin.
- Süreler tahminidir. Toplam yaklaşık 11 saat. İki güne bölün:

| Ne zaman | Bölümler | Süre |
|---|---|---|
| 1. gün sabah | 0 Hazırlık, 1 İlk gün, 2 Cihazlar, 3 Menü | ~3 saat |
| 1. gün öğleden sonra | 4 QR kodları, 5 Müşteri, 6 Garson, 7 Mutfak, 8 Kasiyer, 9 QR açık/kapalı, 10 Gün sonu | ~4 saat |
| 2. gün sabah 05:00'ten sonra | 16.9 Oturumların 05:00'te bitmesi | 5 dk |
| 2. gün | 11 ile 29 arası | ~4,5 saat |

Ekranlarda gördüğünüz düğme adları bu listede **kalın** yazılır. Ok işareti (→) "sonra buna basın" demektir.

## 0. Hazırlık

*Süre: yaklaşık 60 dakika.*

### 0.1 Gerekenler

| Ne | Ne için | ☐ |
|---|---|---|
| Windows bilgisayarınız (Mola Yönetim'in kurulu olduğu bilgisayar) | Kasa bilgisayarı ve Mola Yönetim | ☐ |
| Android telefon | Garson telefonu (Mola uygulaması) ve müşteri telefonu | ☐ |
| iPhone | Müşteri telefonu, sonra Müdür | ☐ |
| Tablet (Android ya da iPad) | Mutfak ekranı | ☐ |
| Modemin kendi Wi-Fi ağı | Bütün cihazlar aynı ağda olmalı. Misafir ağına (Guest) bağlanmayın. | ☐ |
| Telefonda doğrulama uygulaması (Google Authenticator ya da Microsoft Authenticator) | Mola Yönetim adım onayı ve "Raporlar için telefon kodu" | ☐ |
| Boş bir USB flash bellek (en az 1 GB) | İkinci yedek yeri ve geri yükleme | ☐ |
| Kâğıt ve kalem | Kurtarma kodları, şifreler, notlar | ☐ |
| Bilgisayarda 3 ya da 4 ürün fotoğrafı (JPG ya da PNG) | Menü | ☐ |
| Yazıcı (isteğe bağlı): fiş yazıcısı ya da HP LaserJet'iniz | QR baskısı, mutfak fişi, hesap fişi | ☐ |
| Gmail hesabı ve "uygulama şifresi" (isteğe bağlı) | E-posta raporları | ☐ |

### 0.2 Cihaz listesi

Doldurun. Hata bildirirken "hangi cihaz" sorusunun cevabı bu tablodur.

| Cihaz | Marka ve model | Sürüm (Android, iOS, Windows) | Bu testteki görevi |
|---|---|---|---|
| Bilgisayar |  | Windows 11 | Kasa, işletme sahibi, Mola Yönetim |
| Android telefon |  |  | Garson (Mola uygulaması) ve müşteri (Chrome) |
| iPhone |  |  | Müşteri (Safari), sonra Müdür |
| Tablet |  |  | Mutfak |

### 0.3 Önce okuyun: VDS'ten önce neler denenemez?

> **Dikkat:** Mola Merkez şimdilik sizin bilgisayarınızda, Mola Yönetim'in içinde çalışıyor. İnternetteki sunucu (VDS) henüz yok. Bu yüzden bu testte:
>
> - Masa QR kodları kafenin **Wi-Fi adresini** taşır (örneğin `http://192.168.1.102:3000/m/…`). QR kartı da bunu söyler: "internet adresi Mola sunucusu (VDS) kurulunca gelir". Test telefonları **bilgisayarla aynı Wi-Fi'de** olmalı. Mobil veriyle QR okutma VDS'ten sonra denenecek.
> - Kafe bilgisayarı kapalıyken menünün Mola Merkez'deki kopyasından açılması VDS'ten sonra denenecek.
> - Sosyal medya QR kartları bilgisayarınızın yerel adresini taşır. Kartı oluşturup PDF alabilirsiniz ama telefonla okutunca açılmaz. Yönlendirme VDS'ten sonra.
> - Web sitesi iletişim formu VDS'ten sonra.
> - Raporlarım ve uzaktan yönetim bu testte **telefonda değil**, aynı bilgisayardaki bir tarayıcıda denenir. Telefon için HTTPS gerekir.
>
> Bunların tam listesi Bölüm 31'de.

### 0.4 Var olan kurulumlarınızı koruyun

Bu bilgisayarda 3 ve 4 Ekim'den kalma iki kurulum var: **Mola Yönetim** ve bir deneme **Mola** (kafe) kurulumu.

- **Mola Yönetim'i kaldırmayın.** Yeni sürümü üstüne kuracağız. İşletmeler, lisanslar ve imza anahtarı korunur. Kaldırma penceresindeki "Merkez verilerini ve imza anahtarını da sil" kutusunu **asla** işaretlemeyin: kafe kurulum paketleri bu anahtara bağlıdır.
- Test için ayrı bir işletme açacağız: **TEST Kafe**. Mola Yönetim'deki başka bir işletmeye dokunmayın.
- Eski deneme kafe kurulumunu silmeden kenara alacağız (klasörün adını değiştireceğiz). Test bitince isterseniz geri getirirsiniz (29.10).

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 0.4.1 | Dosya Gezgini'ni açın. Adres çubuğuna `%LOCALAPPDATA%` yazıp Enter'a basın. | Klasör listesi açılır. "Mola" ve "Mola Yonetim" klasörleri görünür. | ☐ |  |
| 0.4.2 | "Mola" klasörü yoksa 0.4.3 ile 0.4.5'i atlayın. |  | ☐ |  |
| 0.4.3 | Mola penceresi açıksa soldaki şeritten **Kapat** → **Mola'yı kapat**. Pencere açık değilse "Mola" klasöründeki **Mola-Durdur.cmd** dosyasına çift tıklayın. | Mola kapanır. | ☐ |  |
| 0.4.4 | "Mola" klasörüne sağ tıklayın → **Yeniden adlandır** → `Mola-eski` yazın → Enter. | Klasörün adı "Mola-eski" olur. "Klasör kullanımda" derse 0.4.3'ü tekrarlayın, bir dakika bekleyip yeniden deneyin. | ☐ |  |
| 0.4.5 | Hiçbir dosyayı silmeyin. "Mola Yonetim" klasörüne dokunmayın. |  | ☐ |  |

### 0.5 Bilgisayarın ağ ayarı (önemli)

> **Önemli:** Bu bilgisayarın ağ profili şu an **Genel (Public)** görünüyor (bazı Windows sürümlerinde "Ortak"). Mola'nın Windows güvenlik duvarı izni yalnız **Özel** ağda çalışır. Profil Genel kalırsa telefonlar ve tablet Mola'ya bağlanamaz. Mola bunu Tabletler penceresinde ve Ayarlar → Güvenlik ve diğer → Cihazlar'da sarı bir uyarıyla söyler ("Bu bilgisayarın ağı “Genel” olarak ayarlı; telefonlar ve tabletler bağlanamaz."), ama ayarı kendisi **değiştirmez**. Değişikliği aşağıdaki gibi siz yaparsınız.

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 0.5.1 | Başlat → **Ayarlar** → **Ağ ve İnternet** → **Ethernet** (kabloyla bağlıysanız) ya da **Wi-Fi** → bağlı ağın adı (**Özellikler**). | Ağın özellikleri açılır. | ☐ |  |
| 0.5.2 | **Ağ profili türü**nde **Özel ağ**ı seçin. | "Özel ağ" seçili görünür. (Unutursanız Mola'nın Tabletler penceresi 2.3'te sarı uyarıyla hatırlatır.) | ☐ |  |
| 0.5.3 | **Ayarlar** → **Sistem** → **Güç** → **Ekran ve uyku**: test boyunca uyku süresini **Hiçbir zaman** yapın. | Bilgisayar test sırasında uykuya geçmez. | ☐ |  |
| 0.5.4 | Telefonları ve tableti modemin Wi-Fi ağına bağlayın (misafir ağı değil). | Her cihazda Wi-Fi simgesi var. | ☐ |  |
| 0.5.5 | Test boyunca modemi kapatıp açmayın. | Modem yeniden başlarsa bilgisayarın adresi değişebilir. O zaman Mola uyarır (bu da bir testtir, 4.10). | ☐ |  |

### 0.6 Kurulum dosyaları

Hepsi şu klasörde: `C:\Users\yesbo\OneDrive\Masaüstü\kafe uygulama\.local\installer\Mola-0.1.0\`

| Klasör | Dosya | Ne için |
|---|---|---|
| Mola-Yonetim | Mola Yönetim Kurulum.exe | Sizin bilgisayarınız: Mola Yönetim ve Mola Merkez |
| Windows | Mola Kurulum.exe | Kafe uygulaması. Bu testte aynı bilgisayara kurulur. |
| Guncelleme | Mola-0.1.0-windows.mola-guncelleme | Bölüm 25 (Güncellemeler) |
| Windows\program\app\mobil | Mola.apk | Android uygulaması. Elle kopyalamanız gerekmez: telefona kafe bilgisayarından iner (Bölüm 2). |

> **İpucu:** Gerçek bir kafedeki gibi denemek isterseniz "Windows" klasörünü flash belleğe kopyalayın ve kurulumu oradan çalıştırın.

### 0.7 Mola Yönetim'i güncelleyin

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 0.7.1 | Mola-Yonetim klasöründeki **Mola Yönetim Kurulum.exe**'ye çift tıklayın. Windows "Bilgisayarınız korundu" derse **Ek bilgi** → **Yine de çalıştır**. | Kurulum penceresi açılır. | ☐ |  |
| 0.7.2 | "Bilgisayar açılınca Merkez'i başlat (kafeler bağlanabilsin)" işaretli kalsın. **Kur**'a basın. | Kurulum biter. Hata penceresi çıkmaz. | ☐ |  |
| 0.7.3 | **Mola Yönetim'i aç**'a basın. Kendi yönetici şifrenizle girin. Şifreyi hatırlamıyorsanız giriş ekranındaki **Şifremi unuttum**. | **Bugün** sayfası açılır. Solda: Bugün, İşletmeler, Başvurular, Destek, Duyurular, Satışlarım ve altta Ayarlar. | ☐ |  |
| 0.7.4 | **Ayarlar** → **Hesap güvenliği**. İki adımlı giriş kapalıysa açın: QR'ı Authenticator'a ekleyin, kurtarma kodlarını **Yazdır** ya da **Dosya olarak indir**, "Kurtarma kodlarını güvenli bir yerde sakladım"ı işaretleyin, 6 haneli kodu yazın → **İki adımlı girişi etkinleştir**. | İki adımlı giriş açık. (Fiyat, paket, ödeme, duyuru ve güncelleme işlemleri bunu ister.) | ☐ |  |
| 0.7.5 | Ekranda "Merkez kurtarma kodu" uyarısı varsa **Kurtarma koduna git**. Kodu kâğıda yazın ve kaydettiğinizi onaylayın. | Uyarı kaybolur. | ☐ |  |

### 0.8 Test işletmesini açın

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 0.8.1 | **İşletmeler** → ilk kutu **İşletme ekle**. | "İşletme ekle" penceresi açılır. | ☐ |  |
| 0.8.2 | İşletme adı: `TEST Kafe`. İşletme türü: **Kafe**. | Kafe seçili. | ☐ |  |
| 0.8.3 | Lisans türü: **1 yıllık abonelik**. Paket: **Restoran Pro**. (Paket kilidi denemesi denemede değil, abonelikte çalışır. Restoran Pro'da bulut yedek dışında her hizmet var.) | Restoran Pro kartı seçili. | ☐ |  |
| 0.8.4 | Fatura bilgilerini boş bırakın → **İşletmeyi oluştur**. | "Etkinleştirme kodu" penceresi: "TEST Kafe için tek kullanımlık kod". Kod ve son geçerlilik tarihi yazar. | ☐ |  |
| 0.8.5 | Kodu buraya yazın: ____-____-____ ya da **Kodu kopyala** → **Tamam**. | Listede "TEST Kafe", durumu "Kod bekleniyor". | ☐ |  |

### 0.9 Kafe uygulamasını kurun

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 0.9.1 | Windows klasöründeki **Mola Kurulum.exe**'ye çift tıklayın. "Bilgisayarınız korundu" derse **Ek bilgi** → **Yine de çalıştır**. | Kurulum penceresi. Kurulduğu klasör: `%LOCALAPPDATA%\Mola`. | ☐ |  |
| 0.9.2 | "Masaüstüne simge ekle" ve "Bilgisayar açılınca başlat" işaretli kalsın → **Kur**. | Windows bir kez "değişiklik yapılsın mı?" diye sorar. | ☐ |  |
| 0.9.3 | **Evet** deyin (tabletler için güvenlik duvarı izni, yalnız özel ağ). | Kurulum biter. | ☐ |  |
| 0.9.4 | **Mola'yı aç**. | Mola kendi penceresinde açılır. Solda koyu yeşil şerit: Panel, İkiye böl, Yedekle, Tabletler, Güvenlik, Kapat. | ☐ |  |
| 0.9.5 | Masaüstünde "Mola" ve "Mola Yönetim" simgelerinin ikisi de var mı bakın. | İki simge de var. | ☐ |  |

## 1. İlk gün kurulumu

*Süre: yaklaşık 30 dakika. Bilgisayarda, Mola penceresinde.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 1.1 | İlk ekranı okuyun. | "Bu bilgisayarda henüz işletme yok. Nasıl başlamak istersiniz?" Seçenekler: Yeni kurulum, Yedekten geri yükle, Mola Merkez'den geri yükle. | ☐ |  |
| 1.2 | **Yeni kurulum**. | "Mola'yı etkinleştir" ekranı: "Mola ekibinden bir etkinleştirme kodu aldınız mı?" ve iki seçenek: **Kodum yok, başvuru yapacağım** (hesap açma başvurusu) ve **Etkinleştirme kodum var**. | ☐ |  |
| 1.3 | **Etkinleştirme kodum var** → kodu yazın. Sözleşme kutusunu işaretlemeden **Etkinleştir**'e basın. | "Devam etmek için Mola Lisans Sözleşmesi'ni kabul edin." uyarısı. | ☐ |  |
| 1.4 | Mola Lisans Sözleşmesi kutusunu işaretleyin → **Etkinleştir**. | Kısa süre "Mola Merkez'e bağlanılıyor…", sonra "İşletme sahibi hesabı" formu. | ☐ |  |
| 1.5 | Kullanıcı adı (örneğin `test.sahip`), adınız, şifre (en az 10 karakter) ve şifre tekrarı → **Hesabı oluştur**. Şifreyi kâğıda yazın. | Hesap açılır. Yeniden giriş istenmez. | ☐ |  |
| 1.6 | Kurtarma kodu penceresi: kodu kâğıda yazın (ya da **Yazdır**) → **Kaydettim** → istenen iki parçayı yazın → **Onayla**. | Kod kaydedildi sayılır. (Penceredeki "Sonra kaydedeceğim"i bu testte kullanmayın.) | ☐ |  |
| 1.7 | Sihirbaz "İşletmenizi hazırlayalım": İşletme türü **Kafe**. | "Kafe başlangıç menüsü hazır" benzeri bir yazı. | ☐ |  |
| 1.8 | İşletme adı `TEST Kafe`. "İç ve dış masaları ayır"ı açın: iç **6**, dış **2**. | Masalar "Masa 01"den başlar. | ☐ |  |
| 1.9 | Çalışma kuralları: Ödeme sırası **Sonra ödeme · Önce servis**. Masa temizliği takibi **açık**. "QR siparişleri garson onayına sunulsun" **açık**. Değişiklik süresi **60** saniye. POS komisyonu `1,79` (altında "₺100 kart satışında ₺1,79 komisyon" yazar; `30` yazınca "çok yüksek" uyarısı çıkar, kaydedilmez). | Alanlar kabul edilir. | ☐ |  |
| 1.10 | "Kurulumu kontrol edin" sayfasını okuyun → kaydedin. | Masalar ekranı açılır. Üstte "İlk adımlar" kartı. 8 masa, ikisi dış bölümde. | ☐ |  |
| 1.11 | Mola Yönetim'e geçin: **İşletmeler** → **TEST Kafe**. | Durum "Çalışıyor". Son bağlantı birkaç saniye önce. Sürüm 0.1.0. | ☐ |  |
| 1.12 | TEST Kafe → **Lisans** sekmesi. | Lisans sözleşmesinin hangi sürümünü, ne zaman, kimin kabul ettiği yazar. | ☐ |  |
| 1.13 | Kafede: **Ayarlar** → **İşletme** → **Paket ve lisans** sekmesi. | "Restoran Pro", "Yıllık plan" ve hizmetler yeşil tikli. | ☐ |  |
| 1.14 | Aynı sayfada logo yükleyin, bir renk seçin, menü karşılama yazısı yazın, kaydedin. | Kaydedilir. Karşılama önizlemesi Türkçe ve English gösterir. | ☐ |  |
| 1.15 | **Ayarlar** → **İşletme** → **Sosyal medya**: Google değerlendirme bağlantınızı ve Instagram kullanıcı adınızı yazın, kaydedin. **Bağlantıyı aç**'ı deneyin. | Önizleme çipi görünür. Bağlantı doğru sayfayı açar. | ☐ |  |
| 1.16 | Masalar'daki **İlk adımlar** kartını okuyun. | Yaptıklarınız (kurtarma kodu gibi) işaretli. Kalanlar listede. | ☐ |  |

## 2. Personel ve cihazları bağlama

*Süre: yaklaşık 30 dakika.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 2.1 | Bilgisayarda **Personel** → **Çalışanlar** → **Çalışan ekle**: `garson1` (Görevi: Garson), `mutfak1` (Mutfak), `kasiyer1` (Kasiyer). Şifreleri kâğıda yazın. | Üç hesap listede, görevleriyle. | ☐ |  |
| 2.2 | Soldaki şeritten **Tabletler**. | "Telefon ya da tabletin kamerasıyla okutun", bir QR ve altında `http://192.168.x.x:3000/uygulama`. Adresi yazın: ______________ | ☐ |  |
| 2.3 | Aynı pencerede iki uyarıya bakın. **Sarı** "Bu bilgisayarın ağı “Genel” olarak ayarlı; telefonlar ve tabletler bağlanamaz." varsa 0.5.1 ve 0.5.2'yi yapın (uyarıda adımlar ve bağlantının adı yazar), sonra Tabletler penceresini kapatıp yeniden açın. "Windows güvenlik duvarı izni eksik" uyarısı varsa **İzni düzelt** → Windows sorarsa **Evet**. | İki uyarı da yok (ya da düzeltince kaybolur). "Mola şu anda yalnız bu bilgisayara açık" yazmamalı. Aynı sarı uyarı Ayarlar → Güvenlik ve diğer → Cihazlar'daki "Tablet ve telefon bağlama" kartında da çıkar. | ☐ |  |
| 2.4 | **Android telefon:** kamerayla QR'ı okutun, bağlantıyı açın. | "Mola'yı telefona ve tablete kurun" sayfası. Üstte "Android telefon ve tablet" kartı. | ☐ |  |
| 2.5 | **Mola uygulamasını indir** → indirilen Mola.apk'yı açın → telefon sorarsa **Ayarlar** → **Bu kaynaktan izin ver** → geri dönün → **Yükle** → **Aç**. Play Protect uyarırsa "Yine de yükle". | Mola uygulaması açılır, kafeyi kendisi bulur ve giriş ekranını gösterir. Bulamazsa sayfadaki **Uygulamada aç**. | ☐ |  |
| 2.6 | Uygulamada `garson1` ile giriş yapın. | Garson ekranı. Altta Masalar, Sipariş al, Servise hazır ve Daha fazla. Masalar ilk ekranda. | ☐ |  |
| 2.7 | **Tablet:** aynı QR'ı okutun. Android tablette 2.5 gibi uygulamayı kurun. iPad'de Safari'de **Paylaş** → **Ana Ekrana Ekle** → **Ekle**. | Ana ekranda Mola simgesi. | ☐ |  |
| 2.8 | Tablette Mola'yı simgeden açın, `mutfak1` ile girin. Ekrana bir kez dokunun (sesler için). "Ekranı açık tut"u açın. | Mutfak panosu: Yeni, Hazırlanıyor, Hazır sütunları. Dik tablette bunlar sekme olur. | ☐ |  |
| 2.9 | **iPhone:** QR'ı kamerayla okutun → Safari'de açılır → **Paylaş** → **Ana Ekrana Ekle** → **Ekle**. Şimdilik giriş yapmayın (Bölüm 15'te Müdür olacak). | Ana ekranda Mola simgesi. Simgeden açınca adres çubuğu olmayan Mola giriş ekranı. | ☐ |  |
| 2.10 | Telefonun Wi-Fi'sini kapatıp (mobil veri açık) Tabletler QR'ını okutun. | "Bu sayfa yalnız kafenin Wi-Fi ağında çalışır…" ya da sayfa hiç açılmaz. Bu beklenen durum. Sonra Wi-Fi'yi geri açın. | ☐ |  |

## 3. Menü, KDV, kampanyalar ve tükendi

*Süre: yaklaşık 30 dakika. Bilgisayarda işletme sahibi olarak.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 3.1 | **Menü yönetimi**'ni açın. | Başlangıç menüsü kategorileriyle listelenir. Üstte Ürün ekle, Kategorileri yönet, Menüyü önizle. | ☐ |  |
| 3.2 | **Ürün ekle**: ürün adı, kategori, fiyat, açıklama, İngilizce adı. **Ürün fotoğrafı**'ndan bilgisayardaki bir fotoğrafı seçin, kırpın. | Fotoğraf kare kırpılır. "Telefonla çekilmiş fotoğraf da olur (JPG, PNG, WebP, iPhone HEIC)". | ☐ |  |
| 3.2a | **Telefondan:** iPhone'da Safari ve Android'de Chrome ile kafeye girin, bir ürünün **Fotoğraf seç**'ine dokunup kamerayla yeni bir fotoğraf çekin (48 MP kamera varsa onunla), kırpın, **Fotoğrafı kullan**. Bir de telefonu yan tutarak çekin. | "Kaynak fotoğraf çok büyük" çıkmaz; fotoğraf birkaç saniyede yüklenir ve **düz** durur (yan tutulan da). **Fotoğrafı düzenle** kırpımı geri getirir. iPhone HEIC açılamazsa ekranda ne yapılacağı yazar. | ☐ |  |
| 3.3 | Aynı üründe KDV listesinden %10 seçin. Bir seçenek grubu ekleyin (**Boy ekle**: Küçük, Büyük +15 TL). → **Kaydet ve yayınla**. | Ürün menüde fotoğrafıyla görünür. | ☐ |  |
| 3.4 | Yeni bir ürün: adı `Bira` olsun. KDV alanına bakın. | KDV kendiliğinden %20 olur, altında "Alkollü içecek gibi göründüğü için %20 seçildi." yazar. Kaydedin. | ☐ |  |
| 3.5 | Bir ürünü düzenleyin, fiyatını değiştirin → **Taslak kaydet**. Müşteri menüsüne (Menüyü önizle) bakın. | Taslak henüz müşteri menüsünde görünmez. | ☐ |  |
| 3.6 | Taslağı açıp **Kaydet ve yayınla**. | Yeni fiyat müşteri menüsünde. | ☐ |  |
| 3.7 | Bir kategoride ürün düzenleyicideki **Bu bölümdeki ürünlere uygula** ile KDV'yi %20 yapın, sonra yine %10'a döndürün. | O kategorideki bütün ürünlerin KDV'si değişir. | ☐ |  |
| 3.8 | **Kategorileri yönet**: yeni kategori ekleyin, adını değiştirin, sırasını değiştirin. | Değişiklik menüye yansır. | ☐ |  |
| 3.9 | Bir ürünü **Tükendi** yapın. | Üründe "Tükendi" yazar. Bölüm 5'te müşteri menüsünde soluk görünmeli. | ☐ |  |
| 3.10 | **Menü yönetimi** → **Kampanyalar** sekmesi → **Kampanya ekle**: yüzde indirim, "Seçtiğim ürünler", bugün için tarih aralığı → kaydedin. Pencere 5 adımdır (Ne indirimi? · Hangi ürünler? · Ne zaman? · Sınır · Durum); sağdaki "Müşteri menüde böyle görür" kutusuna bakın. | Kutular hizalı, taşma yok. Kampanya kartında **Aktif** · "Şu an uygulanıyor"; hiçbir yerde onay beklemez. Müşteri menüsünde indirimli fiyat ve sepette aynı fiyat. | ☐ |  |
| 3.10a | Bir kampanya daha: başlangıcı **yarın** olan tarih aralığı. Sonra bir kampanyada **Kampanya etkin**'i kapatın. | İlki **Planlandı** · "Başlıyor: Yarın …", müşteri menüsünde görünmez. Kapatılan **Taslak** · "Menüde görünmez". Listenin üstünde dört durumun tek satırlık açıklaması. | ☐ |  |
| 3.10b | **Her ay** kampanyası: ayın bugünkü günü, 2 ay (ör. maaş günü her ayın 15'i). Sonra ayın gününü başka bir güne çevirin. | Kartta "Her ayın N. günü · 2 ay (…)". Bugün indirim var; gün değişince indirim hemen kalkar, kartta "Sıradaki: …". Satış ve Raporlar → Kampanyalar'da "Tekrarlar" tablosu: her ayın günü bir satır. | ☐ |  |
| 3.11 | İkinci kampanya: adet koşullu ("En az kaç adet?" 4), örneğin çayda %25. | Kaydedilir. | ☐ |  |
| 3.12 | Üçüncü kampanya: "Her hafta", bugünün günü, şu andan sonraki bir saat aralığı. | Kart **Aktif** · "Sıradaki: Bugün …" der; o saate kadar müşteri menüsünde indirim yok. | ☐ |  |
| 3.13 | **Menüyü önizle**. | Müşterinin göreceği menü: fotoğraflar, fiyatlar, "Kampanyalı ürünler". KDV yazmaz. | ☐ |  |
| 3.14 | Dördüncü kampanya: bitişi **5 dakika sonra** olan bir tarih aralığı (ya da "Toplam adet sınırı" 2), o üründen sipariş verin. Bitiş geçince Mola'yı yeniden açın (ya da başka bir sayfaya geçip 1 dakika bekleyin). | İşletme sahibine bir kez **"Kampanya bitti: … · …"** penceresi: kaç siparişte uygulandı, kampanyalı adet, ciro, verilen indirim (reçete maliyeti varsa brüt kâr). **Kampanyayı yinele** kopyayı bugünden başlayan, aynı süren tarihlerle açar; **Raporu aç** kampanya raporunu. Pencere bir daha çıkmaz, zilde kalır. Müdür'ün zilinde yalnız bildirim, pencere yok; kasiyer ve garson hiçbir şey görmez. | ☐ |  |

## 4. Masa QR kodları

*Süre: yaklaşık 20 dakika. Yazıcı yoksa "Microsoft Print to PDF" seçip ekrandaki PDF'ten okutun.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 4.1 | **Ayarlar** → **Masalar ve QR** → **Masalar ve QR** sekmesi → "Masa QR kodları" kartını okuyun. | "QR kodları bu bilgisayarın ağ adresini taşır (192.168.x.x:3000)" yazar. Altında not: "Şimdilik yalnız işletmenin Wi-Fi'sinde açılır. QR kodları şu an kafenin Wi-Fi adresini taşır; internet adresi Mola sunucusu (VDS) kurulunca gelir. QR kodları internet adresi hazır olunca yeniden basılmalı." | ☐ |  |
| 4.2 | Kartta `127.0.0.1` ya da "QR kodları internet adresini taşır · Bağlı" yazıyor mu? | **Yazmamalı.** Mola Merkez şimdilik bu bilgisayarda olduğu için Mola internet adresini QR'lara koymaz; QR'lar 4.1'deki Wi-Fi adresini taşır. Yazıyorsa telefonlar bu QR'ları açamaz: durun, ekran görüntüsü alın ve bana yazın. | ☐ |  |
| 4.3 | **QR kodlarını yazdır** sekmesi → Hangi masalar? **Bütün masalar** → Baskı **6 QR** → **Yazdır**. | Sekmenin üstündeki çip "Wi-Fi adresi: 192.168.x.x:3000" der. A4'te 6 QR. Her QR'ın altında büyük ve kalın masa adı. | ☐ |  |
| 4.4 | Baskı **12 QR** → Yazdır. | A4'te 12 küçük QR. "Küçük kodlar masaya yakın okutulmalı" notu. | ☐ |  |
| 4.5 | Baskı **A6 masa standı** → Kâğıt **A4'e 4'lü (kesim çizgili)** → Yazdır. Sonra **A6 kâğıda tek** ve **PDF indir**'i deneyin. | Her kartta logo, işletme adı, büyük QR, çok büyük masa adı ve "Menü ve sipariş için okutun". | ☐ |  |
| 4.6 | Hangi masalar? **Seçtiğim masalar** → Masa 01 ve Masa 02 → **PDF indir**. | Yalnız seçtiğiniz iki masa. | ☐ |  |
| 4.7 | Masalar → **Masa 03** → **QR menüyü aç**. **Müşteri menüsünü aç** ve **QR kodunu indir**'i deneyin. | QR ve adresi görünür. İnen PNG'de masa adı var. | ☐ |  |
| 4.8 | **Android** ve **iPhone** kamerasıyla kâğıttaki (ya da ekrandaki) Masa 01 ve Masa 02 QR'larını okutun. Yakından, uzaktan, loş ışıkta deneyin. | Menü birkaç saniyede açılır. Üstte doğru masa adı. | ☐ |  |
| 4.9 | Ayarlar → Masalar ve QR → **Masalar ve QR** sekmesi → **Tek masanın QR kodunu yenile** → Masa 08 → **Yenile**. Eski Masa 08 kâğıdını okutun. Sonra yeni Masa 08 QR'ını okutun. | Eski QR: "Bu QR kodu yenilenmiş olabilir…" benzeri uyarı. Yeni QR çalışır. | ☐ |  |
| 4.10 | (İsteğe bağlı) Modemi yeniden başlatın. Bilgisayarın adresi değiştiyse Masalar'a bakın. | "Bilgisayarın ağ adresi değişti; basılı QR'lar çalışmayabilir." uyarısı ve **QR'ları yeniden yazdır**. Adres değişmediyse uyarı çıkmaz, bu da doğru. | ☐ |  |
| 4.11 | **İlk adımlar** kartına bakın. | QR adımı işaretlendi. | ☐ |  |

## 5. Müşteri yolculuğu

*Süre: yaklaşık 45 dakika. Android Chrome = müşteri A (Masa 01). iPhone Safari = müşteri B (Masa 02). Garson telefonu ve mutfak tableti açık. Bilgisayarda işletme sahibi.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 5.1 | Android'de Masa 01 QR'ını okutun (Chrome'da açılsın). | Menü açılır. Üstte "Masa 01", logo, karşılama yazısı, kategoriler, fotoğraflar. Wi-Fi şifresi istenmez. | ☐ |  |
| 5.2 | Sağ üstteki **EN**'e basın, sonra Türkçe'ye dönün. (Dili İngilizce bir telefonla da okutun.) | Menü İngilizce olur, geri döner. Telefonun dili Türkçe değilse menü kendiliğinden İngilizce açılır; seçtiğiniz dil hatırlanır. | ☐ |  |
| 5.3 | Tükendi yaptığınız ürüne bakın. | Soluk, sepete eklenemez. | ☐ |  |
| 5.4 | Bir ürüne dokunun → seçenek (Büyük) → adet 2 → **Sepete ekle**. | Alttaki sepet çubuğu ürün sayısını ve tutarı gösterir. Büyük boyun farkı tutara eklenir. | ☐ |  |
| 5.5 | Kampanyalı bir ürün ekleyin. | İndirim tutara yansır. | ☐ |  |
| 5.6 | Bir ürünü ürün penceresinde not yazarak ekleyin ("az şekerli"); aynı ürünü aynı seçenekle bir kez daha ekleyin. Sepeti açın: bir ürünün adedini değiştirin, birini çıkarın → **Siparişi gönder**. | Aynı ürün aynı seçenekle tek satırda "2" olur (notlu olan ayrı satır). "Siparişiniz alındı" penceresi. Altta takip simgeleri. | ☐ |  |
| 5.7 | Garson telefonuna bakın. | Kısa bir ses. "1 QR siparişi onay bekliyor · Göster". | ☐ |  |
| 5.8 | Müşteri telefonunda 60 saniye dolmadan **Siparişlerim** → siparişte **Değiştir** → adet değiştirin → **Değişiklikleri kaydet**. | "Siparişiniz güncellendi." birkaç saniyede kaybolur. Pencerede kalan saniye yazar. | ☐ |  |
| 5.9 | Mutfak tabletine bakın. | Sipariş kartında "Müşteri değiştirebilir" ve süre. Süre bitmeden "Hazırlamaya başla" yok. | ☐ |  |
| 5.10 | 60 saniye geçince Değiştir'i yeniden deneyin. | "Değiştirme süresi doldu." ya da Değiştir düğmesi kalkar. | ☐ |  |
| 5.10a | Değiştir penceresini açık bırakıp süreyi bitirin (bir ürün eklemiş olun, kaydetmeyin). | Ortada **Değişiklik süreniz doldu** penceresi: "Siparişiniz mutfağa iletildi; değişiklik için garsonunuza seslenin." **Tamam** iki pencereyi de kapatır. Kaydet düğmesi soluk; mutfaktaki sipariş değişmemiştir. İngilizce menüde "Your editing time is up". | ☐ |  |
| 5.11 | Garson: **Göster** → **Onayla ve mutfağa gönder**. | Sipariş mutfağa düşer. Müşterinin ekranında açık kalan "garson onayına gönderildi" penceresi "Onaylandı, hazırlanıyor" olur; kalan saniye yazısı kalkar. | ☐ |  |
| 5.12 | Müşteri A ikinci bir sipariş göndersin, sonra hemen **Siparişi iptal et** → **Emin misiniz? Evet, iptal et**. | "Siparişiniz iptal edildi." Mutfakta ve garsonda kaybolur. | ☐ |  |
| 5.12a | Teslim edilmiş bir siparişte **Siparişi iptal et** → iptal isteği; mutfak gerekçeyle reddetsin. | Siparişlerim'de "İptal talebi onaylanmadı" ve gerekçe. **Siparişi iptal et** bir daha çıkmaz. | ☐ |  |
| 5.13 | Mutfak: **Hazırlamaya başla**. | Müşteri telefonunda durum "Hazırlanıyor" olur. | ☐ |  |
| 5.14 | Mutfak: **Hazır olarak işaretle**. | Garson telefonu titrer ve ses çıkarır: "Masa 01 · #N hazır". Servise hazır düğmesinde sayı. | ☐ |  |
| 5.15 | Garson: **Servise hazır** → **Teslim edildi**. | Müşteride durum teslim edildi olur. | ☐ |  |
| 5.16 | Müşteri A: **Garson çağır**. | Düğme "Garson çağrıldı" olur. Garson ekranında şerit: "Masa 01 · Garson çağırıyor · N dk bekliyor" ve ses. Bilgisayarda da görünür. | ☐ |  |
| 5.17 | Garson şeritteki **✓** (Tamam). | Çağrı kalkar. Müşteride düğme yeniden "Garson çağır" olur. | ☐ |  |
| 5.18 | iPhone'da Masa 02 QR'ını okutun, 2 ürün sipariş edin. Garson onaylasın, mutfak hazırlasın, garson teslim etsin. | Akış 5.6 ile 5.15 gibi çalışır. | ☐ |  |
| 5.19 | iPhone: **Hesabı iste** → "Nasıl ödeyeceksiniz?" **Kart**. | Düğme "Hesap istendi" olur. Bilgisayarda ve garsonda "Masa 02 · Hesap istiyor". | ☐ |  |
| 5.19a | Garson telefonunda Masa 02'nin "Hesap · Kart" çağrısını **Tamam** (✓) ile kapatın. Bilgisayarda Masa 02'yi açın, sonra **Ödeme al**. | Çağrı kalkar ama masa penceresinde ve ödeme penceresinde "Müşteri hesabı isterken “Kart” dedi." yazısı durur; ödeme penceresi Kart seçili açılır. Hesap kapanınca yazı kalkar. | ☐ |  |
| 5.20 | iPhone'da **Siparişlerim** → **Masanın hesabı**'na bakın. | Masanın toplamı doğru; "Ödenecek" tutarı kalan hesap. | ☐ |  |
| 5.20a | Garson telefonundan Masa 02'ye bir ürün ekleyin (Sipariş al). iPhone'da Siparişlerim'e bakın (yenilemeden). | Garsonun eklediği sipariş "Garson ekledi" etiketiyle görünür, tutar Masanın hesabı'na eklenir. Bu siparişte Değiştir ve İptal yok. | ☐ |  |
| 5.20b | Yeni bir masada önce garson sipariş girsin, sonra müşteri o masanın QR'ını ilk kez okutsun → Siparişlerim. | Garsonun siparişi ve masanın toplamı görünür; **Hesabı iste** çalışır. | ☐ |  |
| 5.21 | Bilgisayar: Masa 02 → **Ödeme al** → **Tamamı** → **Kart** → Bahşiş (TL) alanına `20` (alan kapalıysa önce bahşiş ekle düğmesi) → **Ödemeyi kaydet**. | Masa kapanır. Bahşiş satışa eklenmez, ayrı görünür. | ☐ |  |
| 5.22 | iPhone'a bakın (sayfayı yenilemeyin). | Kendiliğinden "Hesabınız kapandı" kartı ve altında "Bizi değerlendirin ve takip edin": Google düğmesi ve Instagram simgesi. | ☐ |  |
| 5.23 | Google ve Instagram düğmelerine dokunun. | Doğru sayfalar açılır. | ☐ |  |
| 5.24 | Masa 01'de parça parça ödeme: Bilgisayar → Masa 01 → Ödeme al → **Ürün seç** → bir ürünü seçin → **Nakit** → Alınan nakit 200 → **Ödemeyi kaydet**. | Kaydedince büyük kutuda birkaç saniye **Verilecek para üstü ₺…** yazar. Ödenen ürün "Ödendi" olur. | ☐ |  |
| 5.25 | Android'de Masanın hesabı'na bakın. | "Ödenen" satırı çıkar, ödenen ürün "Ödendi" yazar ve düşülmüş. | ☐ |  |
| 5.26 | Masa 01 → Ödeme al → **Bir kısmı** → tutar yazın → Kart → kaydedin. | Kalan hesap azalır. | ☐ |  |
| 5.27 | Masa 01 → Ödeme al → Tamamı → Nakit → kaydedin. | Masa kapanır. Android'de "Hesabınız kapandı". | ☐ |  |
| 5.28 | Kapanan masa Masalar ekranında "temizlik bekliyor" görünür. Bu sırada Android'le Masa 01'i yeniden okutun. | Müşteri: "Masa temizlik bekliyor…" yazar, sipariş veremez. | ☐ |  |
| 5.29 | Garson Masa 01'de **Temizlendi** desin. Müşteri **Yeni hesapla sipariş ver**. | Müşteri yeniden sipariş verebilir. Siparişlerim boştur: kapanan hesabın hiçbir ürünü görünmez. | ☐ |  |
| 5.30 | Müşteri menüsünün en altındaki **Gizlilik** bağlantısı. | Sade bir gizlilik sayfası, "TASLAK" etiketi, çerez açıklaması. | ☐ |  |
| 5.31 | Menünün altındaki takip simgeleri. | Instagram ve Google simgeleri görünür, doğru yere gider. | ☐ |  |
| 5.32 | (İsteğe bağlı) Bilgisayarda bir QR siparişinin penceresinden **Bu tarayıcıyı engelle**. Android müşteri yeniden sipariş vermeyi denesin. | "Bu telefondan sipariş verilemiyor. Lütfen siparişinizi personele iletin." Sonra Ayarlar → Güvenlik ve diğer → Engellenen müşteri telefonları → **Engeli kaldır**. | ☐ |  |

## 6. Garson telefonu

*Süre: yaklaşık 20 dakika. Android'de Mola uygulaması, garson1.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 6.1 | Masalar ekranına bakın. | Üstte tek satır özet. Filtreler: Tümü, Açık, Boş, Hazır. Masalar küçük kutular. Yatay kayma yok. | ☐ |  |
| 6.2 | **Sipariş al** → üstteki masa çipinden Masa 04 → ürünlerin yanındaki yuvarlak **+** ile 3 ürün. Arama kutusuna bir ürün adı ya da numarası yazın. | Seçenekli üründe küçük pencere açılır. Alttaki çubukta "3 ürün · ₺… · Gönder". | ☐ |  |
| 6.3 | Çubuğun soluna dokunun: sepette adet değiştirin, not yazın, bir ürünü **Paketlensin** yapın → **Gönder**. | Sipariş mutfağa gider (personel siparişi onay beklemez). Mutfak kartında not ve paket bilgisi görünür. Telefon Masalar'a döner; Sipariş al'da masa seçili kalmaz. | ☐ |  |
| 6.3a | (Sahip ve kasiyer telefonu) Masalar'a bakın. | Garson telefonu gibi sade: tek satır özet, Tümü/Açık/Boş/Hazır çipleri, küçük masa kutuları. Slogan, büyük kartlar ve açık "İlk adımlar" yok. | ☐ |  |
| 6.4 | Masa 04'e dokunun → masa penceresi → **Sipariş ekle**. | Bu masaya yeni sipariş açılır. | ☐ |  |
| 6.5 | Masa 04 → **Taşı / birleştir** → Masa 05'e taşıyın. | Hesap Masa 05'e geçer. | ☐ |  |
| 6.6 | Henüz hazırlanmayan bir siparişi garson iptal etsin (**İptal** → İptal nedeni seçin). | Mutfakta yarım dakika kırmızı "İPTAL" şeridi ve ses. | ☐ |  |
| 6.7 | Mutfak başladıktan sonra bir siparişi iptal edin. | Mutfakta "Bu üründen stok kullanıldı mı?" sorusu çıkar. | ☐ |  |
| 6.7a | Mutfak başlamadan bir siparişte masa penceresi → **Değiştir** → çayı limonata yapın, adedi azaltın → **Değişikliği kaydet**. | Pencerede eski/yeni ürün ve "Hesap farkı +₺…". Hesap yeni tutara döner. Mutfak kartında "Değişti: 2 x … → 1 x … · garson adı", panoda kısa DEĞİŞTİ şeridi ve sipariş sesi. Fiş modunda mutfağa **DEĞİŞİKLİK** fişi çıkar. | ☐ |  |
| 6.7b | Mutfak "Hazırlamaya başla" dedikten sonra aynı siparişe bakın. | **Değiştir** yok; tek satır: "Mutfak hazırlamaya başladı: … İptal et ile çıkarıp yenisini sipariş edin". | ☐ |  |
| 6.7c | (Sahip) Menü yönetimi → Kola ve Ayran'da **Hazır ürün** kutusunu işaretleyin. Garson Ayran siparişi versin; mutfak başlasın, hatta **Teslim edildi** olsun. Garson masa penceresinde **Hazır ürünü değiştir** → Kola. | Değişir; mutfakta hiçbir şey çıkmaz (şerit, ses, fiş yok). Kasada masa penceresinde ve **Ödeme al** penceresinde turuncu "Değişti: 1 x Ayran → 1 x Kola · +₺… · garson adı · saat"; kalan hesap Kola'yla. Ödeme alındıktan sonra değiştirilemez. | ☐ |  |
| 6.7d | Kalabalık grup: iki dolu masa. Garson Masa 04 → **Taşı / birleştir** → "Dolu masalar"dan Masa 05 → **Hesapları birleştir**. | Kasiyere gerek kalmadan birleşir: "Hesaplar Masa 05 üzerinde birleştirildi." Masa 04 boşalır, ödemeler korunur. | ☐ |  |
| 6.7e | (Sahip) Ayarlar → Sipariş ve mutfak → Sipariş ve onay → **Garson hatırlatması**: süreyi **10** dakika yapın. Bir masaya sipariş verin, mutfak hazır, garson teslim etsin; 10 dakika masaya dokunmayın. | Garson ekranında "Masa …: 10 dakikadır yeni sipariş yok. Bir isteği var mı?" ve bir kez yumuşak ses. **Gittim** → kalkar, 10 dakika sonra yine gelebilir. Kasiyer ve sahip ekranında çıkmaz. Sonra süreyi 45'e geri alın. | ☐ |  |
| 6.7f | (Sahip) Personel → Personel ayarları → Garson ataması açık: garson1'e Masa 01, garson2'ye Masa 02. İki masada da sipariş hazır olsun. | garson1'in telefonunda yalnız Masa 01 için ses/titreşim; "Servise hazır" sayısı 1; Masa 02 "Diğer garsonların masaları (1)" arkasında. Sonra atamayı kapatın. | ☐ |  |
| 6.8 | Üstteki QR çipine bakın. | "QR açık" yazar. | ☐ |  |
| 6.9 | **Daha fazla** menüsünü açın. | Hesabım ve Çıkış yap gibi yerler. Ayarlar ve raporlar yok. | ☐ |  |
| 6.10 | Telefonu yatay çevirin, sonra dik. | Ekran bozulmaz, yazılar kesilmez. | ☐ |  |
| 6.11 | Telefonu 5 dakika kilitli bırakın, sonra açın. | Mola kaldığı yerden devam eder, yeniden giriş istemez. | ☐ |  |

## 7. Mutfak ekranı ve fiş modu

*Süre: yaklaşık 25 dakika. Fiş modu bölümü yazıcı ister (isteğe bağlı).*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 7.1 | Tablette bir siparişin kartını okuyun. | Masa, sipariş numarası, kimin verdiği (personel ya da misafir), bekleme süresi, ürünler, seçenekler, notlar. | ☐ |  |
| 7.2 | **Hazırlamaya başla** deyip hemen **Geri al**. | 5 saniye içinde "Geri al" çıkar, kart eski sütununa döner. | ☐ |  |
| 7.3 | Mutfakta bir siparişi gerekçeyle iptal edin. | Garsonda ve bilgisayarda görünür. | ☐ |  |
| 7.4 | Mutfak ekranındaki **Stok**'a basın. | Sayım ve fire yazabilir. Para (fiyat, tutar) görmez. | ☐ |  |
| 7.5 | (İsteğe bağlı) Bir siparişi 10 dakika bekletin. | Kart turuncu "Gecikti" olur (20 dakikada kırmızı). | ☐ |  |
| 7.6 | Tablet ekranı 10 dakika açık kalsın. | "Ekranı açık tut" açıkken ekran kararmaz. | ☐ |  |
| 7.7 | (Yazıcıyla) **Ayarlar** → **Cihazlar** → **Yazıcılar** → **Yazıcı ekle**. Ağ yazıcısı: IP ve port 9100. USB: **USB (Windows)** → listeden yazıcı. HP LaserJet için Yazıcı türü **Normal yazıcı (A4)**. "Ne yazdırsın?": **Mutfak fişleri** ve **Hesap ve kasa fişleri**. | Yazıcı listeye eklenir. | ☐ |  |
| 7.8 | **Deneme fişi**. | Yazıcıdan deneme fişi çıkar. | ☐ |  |
| 7.9 | **Ayarlar** → **Sipariş ve mutfak** → **Mutfak** → "Mutfak nasıl çalışıyor" → **Fiş**. | Fiş modu seçili. | ☐ |  |
| 7.10 | Garson bir sipariş göndersin. Sonra müşteri QR'dan bir sipariş göndersin. | Personel siparişi fişi hemen çıkar. QR siparişinin fişi değişiklik süresi (60 sn) ve garson onayından sonra çıkar. Müşteride "Hazırlanıyor". | ☐ |  |
| 7.11 | Garson masada **Teslim edildi** desin. Başka bir masada demeden ödemeyi alın. | İkisinde de masa düzgün kapanır (ödenince kendiliğinden teslim sayılır). | ☐ |  |
| 7.12 | Yazıcının **kâğıdını çıkarın** (rulo bitmiş gibi), yeni sipariş gönderin. Sonra kapağı açık bırakıp, sonra yazıcıyı kapatıp tekrarlayın. | Kasada ve garson telefonunda kalıcı kırmızı uyarı, nedeni ve yazıcının adıyla: "Yazıcıda kâğıt yok · Mutfak", "Yazıcının kapağı açık", "Yazıcı kapalı ya da kablosu çıkmış"; **Tekrar bas** ya da **Elle iletildi**. Sahibin zilinde "Yazıcıda kâğıt yok · Mutfak" bildirimi (bir kez). Not: hangi yazıcı (marka, ağ/USB, sürücü adı) — USB'de uyarı çıkmazsa yazın. | ☐ |  |
| 7.13 | Kâğıdı takın / yazıcıyı açın → **Tekrar bas**. | Fiş **bir kez** çıkar (USB'de Windows kuyruğunda bekleyen kopya ayrıca basılmaz), uyarı kalkar. | ☐ |  |
| 7.14 | Mutfak modunu yine **Ekran** yapın. | Siparişler yeniden tablete düşer. | ☐ |  |
| 7.15 | (Ekran modu, yazıcı "Mutfak fişleri"nde) Kâğıdı çıkarın, garson sipariş göndersin. | Mutfak kartında "Fiş basılamadı: Yazıcıda kâğıt yok · Mutfak." ve **Tekrar bas**; kısa uyarı sesi. Kâğıdı takıp **Tekrar bas** → fiş çıkar, satır kalkar. | ☐ |  |
| 7.16 | (Kasada, yazıcıyla) Kâğıt yokken **Hesap fişi**. | Masalar'ın üstünde kırmızı satır: "Yazıcıda kâğıt yok · Kasa. Yeni rulo takın, sonra “Tekrar bas”a basın." ve **Tekrar bas**. Kâğıdı takıp basınca "Hesap fişi yazdırıldı." | ☐ |  |

## 8. Kasiyer

*Süre: yaklaşık 35 dakika. Önce 8.1'i işletme sahibi olarak yapın. Sonra bilgisayarda Hesabım → Çıkış yap ve kasiyer1 ile girin.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 8.1 | (Sahip) **Kasa ve giderler** → **Kasa ayarları** → **Kasiyer yetkileri**: kasiyer iade sınırını tek seferde **50 TL** yapın. **Kart ve yazar kasa**: "Yazar kasa yardımcısı" açık olsun. | Kaydedilir. | ☐ |  |
| 8.2 | Kasiyer olarak girin. | Menüde Masalar, Sipariş al, Kasa. Ayarlar, Raporlar, Menü yönetimi yok. | ☐ |  |
| 8.3 | "Kasa açılışı" kutusu: Kasadaki nakit `500` → **Açılışı kaydet**. | Yeşil çip: "Kasa açık · HH:MM'den beri". | ☐ |  |
| 8.4 | Bir masadan nakit ödeme alın: **Ödeme al** → Tamamı → Nakit → hızlı düğmelerden biri (₺200 gibi) → **Ödemeyi kaydet**. | Para üstü doğru ve büyük yazıyla. Pencere kapanınca da ekranın altında birkaç saniye büyük **Verilecek para üstü ₺…** kalır (✕ ile kapanır). | ☐ |  |
| 8.5 | Ödemeden sonra ekranın köşesine bakın. | Yazar kasa kartı: hangi KDV departmanına ne kadar, ödeme türü. **Girildi**'ye basın, kart hemen kalkar. | ☐ |  |
| 8.5a | Art arda 4 ödeme alın, kartlara dokunmayın. | Köşede 3'ten fazla kart birikmez: eskiler tek satırda "N ödeme yazar kasaya girilmedi"; dokununca açılır, masaların üstünü kapatmaz. | ☐ |  |
| 8.6 | (Yazıcıyla) Ödeme penceresinde **Hesap fişi**. | Fişin başında yalnız "BİLGİ FİŞİ"; altta "KDV dahildir · %10: …" satırı. "Bilgi fişidir. Mali değeri yoktur." ya da "Teşekkür ederiz" gibi cümleler **yok**. Müşterinin telefonunda "Masanın hesabı"nın altında "Fiyatlara KDV dahildir · bu hesaptaki KDV ₺…" yazar ve fişteki KDV ile aynıdır. | ☐ |  |
| 8.7 | **Sipariş al** → ilk seçenek **Masasız sipariş** → müşteri adı `Ahmet` → 2 ürün → gönderin. | Mutfakta "MASASIZ #1" olarak görünür. Ödeme penceresi hemen açılır. | ☐ |  |
| 8.8 | Ödeme penceresinde **Sonra öde**. | Masalar'da "Masasız siparişler" şeridi: ad, aşama, ödeme durumu. | ☐ |  |
| 8.9 | Mutfak hazır desin. Şeritten **Ödeme al** → kaydedin. | "Ödendi · Müşteri alınca 'Teslim edildi'ye basın". | ☐ |  |
| 8.10 | **Teslim edildi**. | Masasız sipariş şeritten kalkar. | ☐ |  |
| 8.11 | Kasa çipine dokunun → **Gider kaydet**: 30 TL "ekmek". "Para nereden çıktı?" sorusunda **Kasadan**ı seçin. | Seçmeden "Gideri kaydet" basılmaz. Kaydedilir. | ☐ |  |
| 8.12 | Kasa çipi → **Para bozdurma**: 200 TL verildi, 10 × 20 TL alındı. | "Beklenen tutar değişmez." | ☐ |  |
| 8.13 | Kasa çipi → **İade** → bugünkü bir ödemeyi seçin → bir ürün ve neden seçin (40 TL'nin altında) → kaydedin. | İade yapılır. Yazar kasa kartı "iade / ters işlem" der. | ☐ |  |
| 8.14 | 50 TL'yi aşan bir iade deneyin. | Kasiyer iadeyi kendisi yapamaz, **sahibe iade isteği** gönderir. "İade isteklerim"de "Sahibin onayını bekliyor". | ☐ |  |
| 8.15 | Sahip olarak (telefondan) girin. Sağ üstteki **zil** mercan renginde ve üstünde sayı var (Mola açıkken geldiyse zilin altında "İade isteği" kutusu da çıkar, siz kapatana kadar durur); Masalar'ın sağ altındaki uyarıdan ya da zildeki bildirimden **İadeyi yap** (Kasa ve giderler → İadeler açılır) ile iadeyi yapın. | Kasiyerin Masalar'ında hemen yeşil şerit: "Sahip iadeyi yaptı: Masa … · ₺… nakit. Parayı müşteriye verin." ve köşede yazar kasa iade kartı. Şerit ✕ ile kapanır (bir daha çıkmaz). Sahibin Bildirimler'inde "İade yapıldı" (okunmuş). İade İsteklerim'de "Sahip iadeyi yaptı". | ☐ |  |
| 8.15a | (İsteğe bağlı) Sahip: Kasa ve giderler → Kasa ayarları → Gün sonu → **Kart bahşişini kasadan nakit öde**'yi açın. Kasiyer kartla ödeme alırken ₺20 bahşiş yazsın. | Ödeme penceresinde tek soru: "Bahşiş garsona kasadan nakit verildi mi?" **Evet** → kasa hareketlerinde "Kart bahşişi nakit ödendi ₺20", beklenen nakit ₺20 azalır. Sonra ayarı kapatın. | ☐ |  |
| 8.16 | Kasiyer bir masayı **Temizlendi** yapmayı denesin. | Yapamaz. "Garson temizleyince masa açılır" benzeri yazı. | ☐ |  |

## 9. QR siparişleri: açık ve kapalı

*Süre: yaklaşık 20 dakika.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 9.1 | Bilgisayarda (kasiyer ya da sahip) sol menünün en üstüne, işletme kartının altına bakın. Üst çubukta QR çipi yok. | Yeşil kart: "QR siparişleri açık · Müşteriler telefondan sipariş verebilir" ve küçük **Durdur**. Masalar'da şerit yok. 1366×768'de menünün hepsi (Hesabım dahil) görünür. | ☐ |  |
| 9.2 | Karttaki **Durdur**. | Onay penceresi: "Emin misiniz? Müşteriler telefondan sipariş veremez. Menü görünmeye devam eder…" ve **Durdur**, **Vazgeç**. | ☐ |  |
| 9.3 | Önce **Vazgeç**, sonra yeniden durdurup **Durdur**. | Vazgeç'te hiçbir şey değişmez. Durdur'da kart sarı: "QR siparişleri kapalı · Elle durduruldu (adınız)" ve **Siparişleri aç**. Masalar'ın üstünde ince sarı şerit: "QR siparişleri kapalı: müşteriler masadan sipariş veremiyor · Aç". Başka sayfada (Kasa, Raporlar) şerit yok, kart var. | ☐ |  |
| 9.4 | Müşteri telefonunda menüyü yenileyin, sepete ürün ekleyip göndermeyi deneyin. | Menü görünür. Üstte "Şu an sipariş almıyoruz, lütfen garsonunuza sorun." Gönderilemez. | ☐ |  |
| 9.5 | Müşteri **Garson çağır**. | Çağrı garsona gider. | ☐ |  |
| 9.6 | Garson telefonunda üst çubuğun altına bakın. Kasiyer ya da sahip telefonuna da bakın. | Garson: ince sarı satır "QR siparişleri kapalı · elle durduruldu", düğme yok. Kasiyer/sahip telefonu: aynı satırda **Aç**; açıkken yeşil "QR siparişleri açık · Durdur" satırı. Yana kayma yok. | ☐ |  |
| 9.7 | Mola Yönetim → TEST Kafe → Özet → "QR siparişleri". | "Kapalı · elle durduruldu". | ☐ |  |
| 9.8 | (İsteğe bağlı) 30 dakika kapalı bırakın, Kasa sayfasına geçin. | Her sayfanın üstünde hatırlatma: "QR siparişleri 30 dakikadır kapalı: müşteriler masadan sipariş veremiyor · Aç"; kartta "· 30 dakikadır". | ☐ |  |
| 9.9 | Bilgisayarda **Siparişleri aç** (ya da şeritte **Aç**). | Kart yeniden yeşil, şerit kaybolur. Müşteri sipariş verebilir, sepetindeki ürünler durur. | ☐ |  |
| 9.10 | **Bütün personel ekranlarını kapatın:** garson uygulamasını kapatın (ya da Çıkış yap), tablette Çıkış yapın, bilgisayardaki Mola penceresini sağ üstteki **X** ile kapatın (Mola arka planda çalışmaya devam eder). 2 dakika bekleyin. | Müşteri menüsü görünür ama sipariş gönderilemez: "Şu an sipariş almıyoruz…". Garson çağır da çalışmaz. Mola Yönetim'de "Kapalı · personel ekranı bağlı değil". | ☐ |  |
| 9.11 | Tablette yeniden mutfak1 ile girin. | Birkaç saniye içinde QR siparişi kendiliğinden açılır. | ☐ |  |
| 9.12 | Masaüstündeki Mola simgesiyle pencereyi yeniden açın. | Mola hemen açılır (yeniden başlamaz), veriler yerinde. | ☐ |  |

## 10. Gün sonu ve kasa sayımı

*Süre: yaklaşık 15 dakika. Önce açık masaları kapatın.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 10.1 | Kasa çipi → **Gün sonu** (bütün hesaplar kapalıysa **Gün sonunu yap**). | Kasa sayımı ekranı: banknot ve madeni paralar ya da tek toplam. Beklenen tutar önceden gösterilmez (kör sayım). | ☐ |  |
| 10.2 | Kasiyer olarak: beklenenden 10 TL az yazın → **Sayımı kaydet**. | Yalnız sayılan tutar görünür; beklenen tutar, fark, "Kasa eksik/fazla" hiçbir yerde yok. Not isteğe bağlıdır. | ☐ |  |
| 10.3 | Z raporu toplamı alanına Mola'nın söylediği tutarı yazın. | "Z raporu tutuyor". Farklı yazarsanız "Z farkı". | ☐ |  |
| 10.4 | **Kapanışı tamamla**. | Kasiyerde "Gün sonu kaydedildi; sayım işletme sahibine iletildi." (sahipte "Gün sonu kasası kapatıldı."). Çip "Kasa kapandı". | ☐ |  |
| 10.5 | Sol menünün üstündeki QR kartına bakın. | Sarı kart: "QR siparişleri kapalı · Gün sonu yapıldı · müşteriler telefondan sipariş veremiyor" ve **Siparişleri aç**; Masalar'da ince sarı şerit. | ☐ |  |
| 10.6 | Müşteri telefonunda sipariş vermeyi deneyin. | "Şu an sipariş almıyoruz, lütfen garsonunuza sorun." | ☐ |  |
| 10.7 | Bir dakika sonra şeritten **Yedekle**'ye bakın. | Son yedek gün sonundan hemen sonra alınmış. | ☐ |  |
| 10.8 | QR kartında **Siparişleri aç**. Bir satış yapın. | Satış alınır. Kasada "Gün sonundan sonra satış var · ek kapanış yapın". | ☐ |  |
| 10.9 | Ek kapanışı yapın. | Ek kapanış kaydedilir. | ☐ |  |
| 10.10 | **Kasa ve giderler** → **Kapanışlar** → bir kapanışa tıklayın → **A4 yazdır**. Yazıcı: "Microsoft Print to PDF". | Önizlemede ve PDF'te işletme adı, Beklenen / Sayılan nakit ve fark var. Sayfa boş değil. | ☐ |  |

## 11. Satış ve Raporlar

*Süre: yaklaşık 20 dakika. İşletme sahibi olarak.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 11.1 | **Satış ve Raporlar**. | Sade özet: tek cümle, dört büyük sayı, en çok kazandıran 3 ürün (tutarıyla), kasa durumu. | ☐ |  |
| 11.2 | Dönem: **Bugün**, **7 gün**, **30 gün**, **Yıl ▾**, **Tümü**, **Tarih seç** sırayla. | Her biri açılır. Bugünün sayıları bugünkü satışlarınızla tutar. Yıl'da karşılaştırma "geçen yılın aynı dönemine göre" der. "Açık hesaplar" yalnız bugünü içeren dönemde görünür. | ☐ |  |
| 11.3 | **Tümü**. | Yıllar tablosu (şimdilik yalnız 2026): Satış, İade, Gider, Elde kalan, KDV ve toplam. | ☐ |  |
| 11.4 | **Detaylı göster**. | Gruplar: Satış (Özet, Ürünler, Kârlılık, Kampanyalar), Para ("Taşındı" tabelası: Kasa ve giderler'e gider), Personel (Çalışanlar), Rezervasyon. **Para**'daki **Git** düğmeleri Kasa ve giderler'i açar. | ☐ |  |
| 11.5 | Özet'in altında **KDV dökümü**. | %10 ve %20 satırları: Satış (KDV dahil), Matrah, KDV. Bira %20'de. | ☐ |  |
| 11.6 | Kampanyalar raporu. | Kampanyalı satışlar görünür. | ☐ |  |
| 11.7 | **Kasa ve giderler** → **Kapanışlar**. | Gün sonu ve ek kapanış, 10 TL eksik, kimin yaptığı. | ☐ |  |
| 11.8 | **Kasa ve giderler** → **İadeler** → bir nakit ödemeyi kart yapın (**Ödemeyi düzelt**). | Ödeme türü değişir, kasa hesabı güncellenir. | ☐ |  |
| 11.9 | **Kasa ve giderler** → **Giderler** → **Kayıtlar** → **Gider ekle**: dünün tarihiyle 100 TL kira (tarih alanı gün.ay.yıl: `07102026` yazın ya da sağdaki takvim düğmesi). Sonra **Düzelt**. | Gider dünün gününe yazılır, düzeltme kaydedilir. | ☐ |  |
| 11.10 | **Yazdır / PDF** (Özet'te ve birkaç gün sonu yapılmış bir dönemde). Yazıcı: "Microsoft Print to PDF". | Anlaşılır A4 sayfa, sayfa numaralı. "Kasa kapanışı" satırlarındaki "Kasa fazla ₺… (sayılan ₺… · beklenen ₺…)" yazısı sütunun içinde alt satıra geçer; hiçbir yazı sayfadan taşmaz ya da kesilmez, tutarlar bölünmez. | ☐ |  |
| 11.10a | Sade özette **Satış** kartı. | Altında "Bu satışın içindeki KDV: ₺…" yazar; Detaylı Özet'teki KDV dökümünün toplam KDV'siyle aynıdır. | ☐ |  |
| 11.11 | **Muhasebeci için indir**: ayın ilk günlerinde geçen ay satış yoksa **Bu ay** seçili gelir. Bu ay ile indirin. | Excel dosyası iner ve açılır: günlük satış, ödemeler, giderler, iadeler, kasa kapanışları, KDV dökümü, ürün satışları. | ☐ |  |
| 11.12 | Garson telefonunda raporlara girmeyi deneyin. | Garson raporları göremez. | ☐ |  |

## 12. Stok, reçete ve kârlılık

*Süre: yaklaşık 20 dakika.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 12.1 | **Stok** → **Malzemeler** → **Malzeme ekle**: "Kahve çekirdeği" (gram, elde 1000, **Uyarı sınırı** 200, birim fiyat) ve "Süt" (ml, elde 3000). Alanların yanındaki gri **ⓘ**'lere dokunun. | ⓘ'ler alanı kısaca anlatır; Uyarı sınırının altında "Kalan miktar 200 g sınırının altına inince size “Azalıyor” bildirimi gelir." yazar. İki malzeme listede, kartlarda "Uyarı sınırı". | ☐ |  |
| 12.2 | **Reçeteler**: Caffè Latte = 18 g kahve + 200 ml süt. Büyük boy %150. | Reçete kaydedilir. | ☐ |  |
| 12.2a | Reçete penceresinde **Seçenekler stoktan düşen miktarı değiştiriyor mu?** bölümünü açın; gri **ⓘ**'ye dokunun. Yulaf sütü = "Yerine başka malzeme" (sütün yerine). | Başlığın yanında "Müşteriye görünmez". ⓘ dört kuralı anlatır (Miktar değişir = reçetedeki bütün malzemeler bu oranda). Her seçeneğin altında "… satılınca stoktan: Kahve 18 g, Süt 200 ml düşer." Altta küçük tablo: her seçenek için maliyet · satış · kâr (seçenek fiyatı eklenmiş, örn. "Büyük boy (+₺25)"). Rakamlar Kârlılık raporundakiyle aynı. | ☐ |  |
| 12.3 | **Ürünler** sekmesi. Latte satırındaki **ⓘ**'ye dokunun. | Latte'nin maliyeti, "≈N adet yapılabilir" ve altında "Sınırlayan malzeme: Süt" (ya da Kahve). ⓘ hesabı söyler; reçete penceresi açılmaz. | ☐ |  |
| 12.4 | Garsondan 3 latte siparişi verin, mutfak hazırlasın. | Elde kalan kahve ve süt düşer, "yapılabilir" sayısı azalır. | ☐ |  |
| 12.5 | Sütü uyarı sınırının altına düşürecek kadar satış ya da sayım yapın. | Malzeme uyarı rengiyle görünür. | ☐ |  |
| 12.6 | **Alış ve sayım**: süt alışı, kahve sayımı, 1 latte fire. | Kayıtlar listede, stok güncellenir. | ☐ |  |
| 12.6a | **Alış kaydet**: tutarı kasadaki nakitten büyük yazın (örneğin 5.000 TL). **Para nereden çıktı?** sorusunda hiçbir şey seçmeden kaydetmeyi deneyin, sonra **Kasadan**. | Seçmeden **Alışı kaydet** basılmaz ("Paranın nereden çıktığını seçin."). Kasadan seçilince altında kısa sarı not: "Kasada şu an ₺… görünüyor; bu çıkışla −₺… olur. Para kasadan çıkmadıysa “Kasa dışından”ı seçin." Ek düğme yok. **Vazgeç** deyin. | ☐ |  |
| 12.6b | Bir alışı **Kasa dışından** → **Nasıl ödendi?** Kart ile, bir başkasını **Ödenmedi (veresiye)** ile kaydedin. | Kasa dışından: Giderler'e yazılır, beklenen nakit değişmez. Ödenmedi: gider yazılmaz ("Ödenmedi: gider yazılmadı."), Son hareketler'de ve İşlem geçmişinde "Ödenmedi (veresiye)". | ☐ |  |
| 12.6c | Kasa dışından kaydedilen alıştan sonra çıkan yeşil satırdaki **Giderlerde gör**'e basın. | Kasa ve giderler → Giderler → Kayıtlar açılır; "Stok alışı: …" satırı yeşil işaretli ve ekranda görünür. Veresiye alışın yeşil satırında bu bağlantı yoktur. | ☐ |  |
| 12.7 | 6.7'deki iptal sorusuna mutfak "Evet" desin. | Fire olarak kaydedilir. | ☐ |  |
| 12.8 | Satış ve Raporlar → Satış → **Kârlılık**. | Ürün başına maliyet ve kâr. "Satış anındaki fiyatlarla / Bugünkü fiyatlarla" seçimi. | ☐ |  |
| 12.9 | Kasiyer ya da garson Stok'u görebiliyor mu? | Göremez. | ☐ |  |
| 12.9a | Stok'un sağ üstündeki **İşlem geçmişi** (ve bir malzemenin penceresindeki "Bu malzemenin işlem geçmişi"). Bugün / 7 gün / 30 gün / Tümü, malzeme, kişi ve aramayı deneyin. Aynısını mutfak tabletinde açın. | Alış, sayım, fire, geri alma, reçete değişikliği, malzeme ekleme/düzenleme/silme, uyarı sınırı değişikliği; kişi, rol, saat, miktar, önce → sonra; en yenisi üstte. Sahip ve Müdür herkesi görür; mutfak yalnız kendi sayım ve fire kayıtlarını görür, kişi seçimi ve para yoktur. | ☐ |  |
| 12.9b | **Alış ve sayım** → Son hareketler. | Yalnız son 3 kayıt; sağ üstte **Tümü** İşlem geçmişini "Tümü" seçili açar. 5 yıllık kafede İşlem geçmişinin süzgeçleri bekletmez. | ☐ |  |
| 12.10 | **Alış ve sayım** → Son hareketler: bugün yazdığınız süt alışının sonundaki **⋯** → **Bu kaydı geri al**. Önce **Vazgeç**, sonra yeniden açıp **Evet, geri al**. | Satırda "Geri al" bağlantısı yok; yalnız ⋯ menüsünde. Pencere etkisini söyler ("Bu alış kaydı silinir. Süt stoğu … → … olur."). Vazgeç hiçbir şeyi değiştirmez; Evet deyince stok eski hâline döner, kayıt silinmez, "Geri alınanlar"da kim ve ne zaman yazar. Önceki günlerin kayıtlarında ⋯ yoktur. | ☐ |  |

## 13. Rezervasyon ve etkinlik

*Süre: yaklaşık 15 dakika.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 13.1 | **Ajanda ve rezervasyon** açın. | İlk sekme **Rezervasyonlar**: üstte gün ve saat, altında masa planı (her masa Boş / Rezerve / Dolu), en altta günün listesi. | ☐ |  |
| 13.1a | Saati 20 dakika sonrasına yazın (ör. "2030" yazın, 20:30 olur; AM/PM çıkmamalı). Planda **Masa 06**'ya dokunun: ad "Ayşe", 4 kişi, telefon, kapora 100 TL ("Kapora alındı"), Hatırlatıcı **1 saat önce** → Kaydet. | Pencerede masa, gün ve saat hazır gelir. Kaydedilir; Masa 06 "Rezerve HH:MM · Ayşe · 4 kişi" olur. | ☐ |  |
| 13.1b | Masa 06'ya yeniden dokunun. | Ayşe'nin rezervasyonu: **Geldi**, **Düzenle**, **İptal et**. Açık hesabı olan bir masa "Dolu" yazar. | ☐ |  |
| 13.2 | Masalar'da Masa 06. | "Rezerve · Ayşe · 4 kişi · saat" yazar. | ☐ |  |
| 13.3 | Saat gelince (ya da geçince) masaya bakın → **Geldi**. | Hesap açılır, kapora hesaptan düşülür. | ☐ |  |
| 13.4 | İkinci rezervasyon yapın, saat geçince **Gelmedi**. | "Kapora kararı bekleyenler"de görünür: **İade et** ya da **İşletmede kalsın**. | ☐ |  |
| 13.4a | **Etkinlik oluştur** penceresine telefonda ve bilgisayarda bakın: bitiş saatini başlangıçtan önce yazın (ör. 01:30), "Bir masada kaç kişi?"ye 4 yazın, **Adları ben yazayım** ile üç ad yazın, sonra **Numaralı**'ya dönün. | Adımlar: Etkinlik · Ne zaman? · Kaç masa? · Masa adları · Masalar ekranı. Kutular hizalı, kayma yok. "… – 01:30 (ertesi gün)", "25 geçici masa · toplam 100 kişilik yer", masa adları altta tek tek (D1 … ve "+ 13 masa daha"). Ayrıntılar gri ⓘ'lerde. | ☐ |  |
| 13.5 | **Etkinlikler** → **Etkinlik oluştur**: "Maç gecesi", bugün, 2 geçici masa. D1'e dokunun → ad yazıp kaydedin. → **Etkinliği başlat**. | D1 "Rezerve" olur (masa adı kalem simgesiyle değişir). Masalar'da geçici masalar (QR'sız). Rezervasyonlar planında da "Etkinlik: Maç gecesi" bölümü görünür. | ☐ |  |
| 13.6 | Geçici masaya sipariş ve ödeme → **Etkinliği kapat**. | Etkinlik raporu çıkar. Satış ve Raporlar → Rezervasyon'da görünür. | ☐ |  |
| 13.6a | Satış ve Raporlar → Rezervasyon → Etkinlikler. | En yeni etkinlik en üstte. | ☐ |  |
| 13.6b | Bilgisayarın saatini gece yarısından hemen önce düşünün: Rezervasyonlar ekranını 23:55'te açık bırakın, 00:05'te bakın. Sonra **Masa ayır** ile geçmiş bir saati (ör. dün 21:00) seçip **Kaydet**. | Gün kendiliğinden ertesi güne geçer. Geçmiş saatte "… geçti. Geçmiş bir saate rezervasyon yazıyorsunuz" uyarısı; ancak **Yine de kaydet** ile kaydedilir. | ☐ |  |
| 13.7 | **Takvim** → bir güne **Not ekle**. | Not takvimde görünür. | ☐ |  |
| 13.8 | **Ajanda ve rezervasyon** → **Ayarlar** sekmesi (dişli, en sonda): garsonların yazmasına izin verin. Garson telefonuna bakın. | Garsonda Rezervasyon görünür. Garson müşterinin adını görür, telefonunu görmez. | ☐ |  |

## 14. Vardiya ve bahşiş

*Süre: yaklaşık 15 dakika.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 14.1 | **Personel** → **Personel ayarları** → **Vardiya** → **Vardiya takibi** açık. **Bahşiş** alt sekmesi: "O gün çalışılan süreye göre". | Garson ya da mutfak girişliyse önce soru: "Şu an N kişi çalışıyor. Kod bir sonraki girişlerinde mi istensin, hemen mi?" (**Bir sonraki girişte** seçili). Bir sonraki girişte deyin: çalışanlar işine devam eder. Sonra "Açık. Kod, kasiyer ya da sizin Masalar ekranınızda 'Vardiya kodu'nda görünür." | ☐ |  |
| 14.2 | Garson telefonunda çıkış yapıp yeniden girin. | "Vardiya kodu (6 hane)" ekranı ve **QR okut**. | ☐ |  |
| 14.3 | Bilgisayarda kasa çipi → **Vardiya kodu**. | Bir QR ve 6 haneli kod. | ☐ |  |
| 14.4 | Garson **QR okut** ile okutsun → **Vardiyayı başlat**. | Garson ekranında "Vardiyada" çipi. Bilgisayarda kod yenilenir. | ☐ |  |
| 14.5 | Eski kodu (fotoğrafını çektiyseniz) tablette denemek. | Çalışmaz: kod bir kez kullanılır. | ☐ |  |
| 14.6 | Tablette mutfak1 de 6 haneli kodu elle yazarak vardiyaya başlasın. | Mutfak çalışmaya başlar. | ☐ |  |
| 14.7 | Bir ödemede bahşiş alın. Sonra garson **Vardiyayı bitir** (yeni kodla). | Vardiya biter. |
| 14.7b | Mutfak vardiyadayken kasiyer **Gün sonu**'nu yapsın (mutfakta bitmemiş bir sipariş bırakın). | Sayım penceresinde "Mutfakta N sipariş bitmedi." ve "Gün sonu yalnız sizin vardiyanızı bitirir…". Gün sonundan sonra mutfak ve garson yeni kod istemeden çalışır; vardiyaları kendi "Vardiyayı bitir"iyle ya da 05:00'te biter. | ☐ |  |
| 14.7a | **Personel** → **Çalışanlar** → Garson → **Vardiya planı**. Bitiş'e "1730" yazın. | Başlangıç ve Bitiş yan yana, 24 saat (09:00 – 17:30; bilgisayarın dili İngilizce olsa da AM/PM yok). Günler eşit aralıklı yedi kutu; "Hafta içi" / "Her gün" kısayolları. Açıklama ⓘ'de. | ☐ |  |
| 14.8 | **Personel** → **Vardiya ve bahşiş** → **Vardiyalar**, sonra **Bahşiş**. | Vardiya saatleri; Bahşiş'te her çalışanın payı. | ☐ |  |
| 14.9 | Vardiya takibini kapatın (sonraki testler kolay olsun). | Kapalı. | ☐ |  |

## 15. Müdür

*Süre: yaklaşık 10 dakika. iPhone'daki Mola simgesiyle.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 15.1 | **Personel** → **Çalışanlar** → **Çalışan ekle** → `mudur1`, Görevi **Müdür**. | Pencerede müdürün yapabildikleri ve yapamadıkları listelenir. | ☐ |  |
| 15.2 | iPhone'da Mola'yı açıp mudur1 ile girin. | Ayarlar ve Destek yok; Personel'de yalnız Vardiya ve bahşiş (hesaplar yok); Kasa ve giderler'de Kasa ayarları yok. Duyurular var. Alt menü: Masalar · Sipariş al · Kasa · Raporlar. | ☐ |  |
| 15.3 | Müdür: menüde bir fiyat değiştirsin, bir kampanyayı kapatıp açsın. | Yapabilir. | ☐ |  |
| 15.4 | Müdür: QR siparişlerini durdurup açsın. 100 TL'lik bir iade yapsın. | İkisini de yapabilir (iade sınırı yok). | ☐ |  |
| 15.5 | Müdür: kasa işlemlerinde "Sahip aldı" ya da "Bankaya yatırıldı" arasın. | Yok (yalnız sahip). | ☐ |  |
| 15.5a | Müdür: **Kasa ve giderler** → **Kapanışlar**; Satış ve Raporlar sade özetteki kasa cümlesi. | Kapanışlarda yalnız gün, kim ve sayılan tutar; "Fark" sütununda tutar yok. Beklenen nakit, "kasa ₺… eksik/fazla çıktı" hiçbir yerde yok (yazdırma ve Excel'de de). | ☐ |  |
| 15.6 | Müdür: Satış ve Raporlar. ("Raporlar için telefon kodu" 20.1'de kurulunca bu adımı tekrarlayın.) | Raporlar açılır. Kod kuruluysa **sahibin** telefonundaki 6 haneli kod istenir. | ☐ |  |

## 16. Çalışan hesapları, şifreler, otomatik kilit ve 05:00

*Süre: yaklaşık 15 dakika ve ertesi sabah 5 dakika.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 16.1 | Personel → Çalışanlar → garson1 → **Şifreyi yenile**. Garson telefonunda yeni şifreyle girin. | Yeni şifre çalışır, eskisi çalışmaz. | ☐ |  |
| 16.2 | Garson telefonunda **Hesabım** → kendi şifresini değiştirsin. | Değişir. | ☐ |  |
| 16.3 | Personel → Çalışanlar → **Açık oturumlar**: tabletin oturumunu kapatın. | Tablet birkaç saniye içinde giriş ekranına döner. | ☐ |  |
| 16.4 | `deneme1` adında bir garson hesabı açın, sonra **Hesabı kapat**. Bu hesapla girmeyi deneyin. | Giremez. Geçmişi silinmez. | ☐ |  |
| 16.5 | **Ayarlar** → **Güvenlik ve yedek** → **Kilit ve güncelleme** → Sahip hesabı otomatik kilit: **5 dakika**. Bilgisayara 5 dakika dokunmayın, bu sırada garson bir sipariş göndersin. | "Sahip hesabı kilitlendi". Sipariş gelmeye ve ses çalmaya devam eder. | ☐ |  |
| 16.6 | Şifrenizi yazın → **Kilidi aç**. | Açık sayfanız ve yazdıklarınız olduğu gibi durur. | ☐ |  |
| 16.7 | Sol alttaki kilit düğmesi (ya da **Hesabım** → **Kilitle**). | Ekran hemen kilitlenir. | ☐ |  |
| 16.8 | Kilit süresini **10 dakika** yapın. | Kaydedilir. | ☐ |  |
| 16.9 | (Ertesi sabah) 04:30'dan sonra bir personel ekranına bakın. 05:00'ten sonra yeniden bakın. | 04:30'dan itibaren küçük uyarı. 05:00'ten sonra bütün çalışanlar yeniden giriş yapar. Sepetteki ürünler kaybolmaz. | ☐ |  |

## 17. İkiye böl

*Süre: yaklaşık 10 dakika. Bilgisayarda.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 17.1 | Soldaki şeritten **İkiye böl**. | Pencere ikiye bölünür: Sol ekran ve Sağ ekran, ikisi de giriş ister. | ☐ |  |
| 17.2 | Solda kasiyer1, sağda mutfak1 ile girin. | Solda kasa, sağda mutfak panosu. | ☐ |  |
| 17.3 | Ortadaki ayracı sürükleyin. | Genişlikler değişir. | ☐ |  |
| 17.4 | Garson telefonundan sipariş gönderin. Sağda hazırlayın, solda ödemeyi alın. | İkisi birbirini bozmadan çalışır. Sesler duyulur. | ☐ |  |
| 17.5 | Şeritten **Tek ekran**. | Tek Mola ekranına (sol ekranın girişiyle) döner. | ☐ |  |

## 18. Ayarlar

*Süre: yaklaşık 30 dakika. İşletme sahibi olarak. Ayarlar beş konudur (yalnız bir kez kurulanlar): İşletme, Masalar ve QR, Sipariş ve mutfak, Cihazlar, Güvenlik ve yedek. Günlük işin ayarı evindedir: Kasa ve giderler → Kasa ayarları, Personel → Personel ayarları, Menü yönetimi → KDV oranları, Ajanda → Ayarlar.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 18.1 | Ayarlar'ı açın, konular arasında gezin. | Konular üstte, her birinin simgesi var (Destek sekmeleri gibi; dar ekranda simge yazının üstünde). Her konunun altında ikinci bir sekme satırı var (İşletme: Görünüm, Paketiniz, Sosyal medya, Raporlar ve e-posta; Masalar ve QR: Masalar ve QR, QR kodlarını yazdır, Rezervasyon; Sipariş ve kasa: Sipariş ve onay, Kasa ve ödeme, Vardiya ve bahşiş). Uzun açıklamalar gri ⓘ'de. Dikkat isteyen konuda rozet (örneğin "Eksik"). | ☐ |  |
| 18.2 | **İşletme** → **Sosyal medya** → bir hesabın yanında **QR oluştur**. Sonra "Bizi takip edin" kartı → **PDF indir** ve Yazdır. | Kart ve PDF hazırlanır. Kartın taşıdığı adres bu bilgisayarın yerel adresidir. **Telefonla okutmayın**: yönlendirme VDS'ten sonra denenecek. | ☐ |  |
| 18.3 | **Masalar ve QR** → "Masalar ve bölümler": bölümsüz bir masanın yanındaki seçimden **Yeni bölüm…** → `Üst kat`; başka bir masayı listeden Üst kat'a alın; ↑↓ ile bir masayı ve Üst kat bölümünü yukarı taşıyın; kalemle "Üst kat"ın adını `Teras` yapın. Masalar ekranında **Masa ekle** ve **Masa çıkar**. | Her değişiklik hemen kaydedilir ("… bölümüne alındı"). Masalar ekranında "Teras masaları" en üstte, masalar sizin sıranızla. Garson ataması Teras'a verilmişse adı değişince de sürer. Telefonda sayfa yana kaymaz. Masa eklenir ve çıkar. | ☐ |  |
| 18.4 | **Cihazlar** → **Sesler**: birkaç sese **Dinle** ile basın. Garson çağrısının sesini değiştirin. | Sesler çalar. Bir dakika içinde garson telefonu yeni sesi çalar. | ☐ |  |
| 18.5 | Garson telefonunda **Ses düzeyi**ni kısın. | Yalnız o cihazda değişir. | ☐ |  |
| 18.6 | **Sipariş ve mutfak** → **Sipariş ve onay**: **Otomatik onay**'ı açın. Müşteri sipariş versin. | Sipariş garson onayı beklemeden mutfağa gider. Sonra kapatın. | ☐ |  |
| 18.7 | Değişiklik süresini **0** yapın, müşteri sipariş versin. | Değiştir ve iptal düğmesi çıkmaz, sipariş hemen mutfağa geçer. Sonra 60'a döndürün. | ☐ |  |
| 18.8 | **Kasa ve giderler** → **Giderler** → **Otomatik giderler** → otomatik gider ekleyin (Kira, ayın bugünkü günü). | Gider kendiliğinden yazılır, Kayıtlar'da "Otomatik" görünür ve zile (Bildirimler) düşer. | ☐ |  |
| 18.9 | Düşük kâr uyarısı ve **KDV oranları** kartlarına bakın. | %10 ve %20 tanımlı, varsayılan %10. | ☐ |  |
| 18.10 | **Güvenlik ve yedek** → **Yedek**, **Kilit ve güncelleme**, **Telefonum**; **Masalar ve QR** → **Engellenen telefonlar**. Ayarlar'ın altındaki "Taşınan ayarlar" listesini açıp bir **Git**'e basın. | Son yedek zamanı; otomatik kilit ve güncelleme; Raporlar için telefon kodu, telefonu eşleştir, uzaktan yönetim; engellenen müşteriler. Git doğru eve açılır. | ☐ |  |
| 18.11 | **Cihazlar** → **Bağlantıyı kontrol et** → **Destek için özeti göster**. | "Başarılı" ve kopyalanabilir bir özet. (Hata bildirirken işe yarar.) | ☐ |  |
| 18.12 | Garson telefonunu bilgisayardan 20 metre uzağa götürün ya da başka odaya geçin, birkaç işlem yapın. | Wi-Fi zayıfsa yavaşlar ama çalışır. Bağlantı koparsa uyarı çıkar ve dönünce düzelir. | ☐ |  |

## 19. Destek ve Mola ekibiyle yazışma

*Süre: yaklaşık 25 dakika. Kafede işletme sahibi, Mola Yönetim'de siz. İpucu: kafede Destek ekranı açıkken Mola Yönetim'deki değişiklikler 15 ile 20 saniyede gelir; değilse en geç 10 dakikada.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 19.1 | Kafe: **Destek** → **Talepler** → **Yeni talep**: Konu, "Sorunu anlatın", **Fotoğraf veya PDF ekle** ile bir ekran görüntüsü → **Destek talebi aç**. | Form kendiliğinden açık değildir; "Yeni talep" açar, imleç Konu'dadır ("Vazgeç" kapatır). Gönderince yeni talep listede ve açık. Ek yüklendi. | ☐ |  |
| 19.2 | Mola Yönetim: **Destek**. | Yeni talep, ekiyle. Zilde (Bildirim merkezi) yeni olay. | ☐ |  |
| 19.2a | Talebin başlığındaki (ve listedeki) **işletme adına** dokunun; sonra Esc. Telefonda da deneyin. | Küçük özet açılır: durum çipi, paket ve hizmet sayısı, lisans ve kalan gün, deneme, son bağlantı, QR siparişleri, açık talep, telefon/e-posta (kopyala). **İşletme sayfası**, **Hizmet**, **Lisans** o sekmeyi açar. Esc ya da dışarı dokunmak kapatır, sohbet açık kalır. Telefonda alttan açılır. | ☐ |  |
| 19.3 | Mola Yönetim'de yanıt yazın, bir fotoğraf ekleyin, gönderin. | Gönderilir. | ☐ |  |
| 19.4 | Kafe: Destek'e bakın. | Yanıt aynı yazışmada. Destek düğmesinde kırmızı nokta. Ek açılır. | ☐ |  |
| 19.5 | Mola Yönetim: İşletmeler → TEST Kafe → **Destek** sekmesi → **Yeni mesaj** (konu, mesaj, ek). | Gönderilir. | ☐ |  |
| 19.6 | Kafe: Talepler. | Yeni görüşme okunmamış, "Mola ekibi başlattı". | ☐ |  |
| 19.7 | Mola Yönetim: **Duyurular** → **Yeni duyuru**: başlık, metin, Kime: seçili işletmeler → TEST Kafe. Önizlemeye bakın ("İşletmede böyle görünür"). Gönderin (Authenticator kodu istenir). | Duyuru listede, "Okuyan: 0/1". | ☐ |  |
| 19.8 | Kafe: **Destek** → **Duyurular**. | Duyuru görünür. | ☐ |  |
| 19.9 | İkinci duyuru, bu kez **Önemli** işaretli. Kafede sahip çıkış yapıp yeniden girsin. | Girişte ortada pencere: **Okudum**, **Daha sonra**, **Duyurulara git**. | ☐ |  |
| 19.10 | **Daha sonra**, sonra yeniden giriş → **Okudum**. | Daha sonra'da bir sonraki girişte yine gelir. Okudum'dan sonra Mola Yönetim'de "Okuyan: 1/1". | ☐ |  |
| 19.11 | Duyurudaki "Bu konuda Mola ekibine yaz". | Hazır bir talep açılır. | ☐ |  |
| 19.12 | Müdür (iPhone) ve garson duyurulara bakabiliyor mu? | Müdür Duyurular'ı görür, Önemli penceresini görmez. Garson hiç görmez. | ☐ |  |
| 19.13 | Mola Yönetim'de bir duyuruyu **Geri çek**. | Kafeden kalkar. | ☐ |  |
| 19.14 | Kafe: sağ üstteki **zil** (Bildirimler). Destek'te yalnız Talepler, Duyurular, Uzaktan erişim var. | Kasa açılış farkı, kasiyer iadesi, otomatik gider gibi olaylar. Okunmamış varken zil mercan renginde, çalan zil simgesi ve sayı ("3"; 9'dan fazlaysa "9+"); hepsi okununca sade zil. | ☐ |  |
| 19.14a | Sahip Mola'yı açık tutarken Ajanda'ya hatırlatması şimdi olan bir not eklesin; sonra kasiyer sınırı aşan bir iade isteği göndersin. | En geç 15 sn içinde zilin altında küçük kutu: başlık, tek satır, **Aç**. Hatırlatma kutusu ~6 sn sonra kendiliğinden kaybolur; "İade isteği" kutusu ✕'e basana kadar kalır. **Aç** bildirimin yerini açar (İadeler) ve zilin sayısı bir azalır. Sayfayı yenileyince eski bildirimler kutu olarak çıkmaz. Aynı anda en çok iki kutu. Müdür ekranında yalnız kampanya bildirimleri kutu olur. | ☐ |  |
| 19.14b | (İsteğe bağlı) Ayarlar → Cihazlar → Sesler → **Bildirim sesi**'ni açın (başlangıçta kapalı); ekrana bir kez dokunun, yeni bir bildirim gelsin. | Kutuyla birlikte kısa "Nazik" sesi. Sonra kapatın. | ☐ |  |
| 19.15 | Kafe: **Destek** → **Uzaktan erişim** → "Mola ekibi bağlanabilsin": **İzni aç** (şifrenizle). | "Açık · Mola ekibi bağlanabilir". | ☐ |  |
| 19.16 | Mola Yönetim: TEST Kafe → Destek → Uzaktan destek → **Kafeye bağlan**. | Yeni sekmede kafenin ekranları. Menü, kampanya, masa ve görünüm ayarları açılır. Satış raporları, ödemeler, kasa ve çalışan şifreleri görünmez. | ☐ |  |
| 19.17 | Kafe ekranlarına bakın. | Bütün ekranlarda üstte "Mola ekibi bağlı". | ☐ |  |
| 19.18 | Kafe: **Bağlantıyı kes**. Sonra izni kapatın. | Mola Yönetim'deki sekme kapanır ya da bağlantı biter. Kimin ne zaman bağlandığı sayfada yazar. | ☐ |  |

## 20. Raporlarım ve uzaktan yönetim

*Süre: yaklaşık 25 dakika. VDS'ten önce bu bölüm telefonda değil, **aynı bilgisayardaki** Chrome ya da Edge'de yapılır.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 20.1 | Kafe: **Ayarlar** → **Güvenlik ve yedek** → **Telefonum** → **Raporlar için telefon kodu** → **Telefon kodunu kur**: işletme şifreniz, QR'ı Authenticator'a ekleyin, 6 haneli kod → **Korumayı etkinleştir** → kurtarma kodlarını yazın → **Kodları sakladım**. | "Telefon kodu açık." | ☐ |  |
| 20.2 | Satış ve Raporlar'ı açın. | Önce telefondaki 6 haneli kod istenir (**Raporları aç**). 15.6'yı Müdür ile tekrarlayın. | ☐ |  |
| 20.3 | **Destek** → **Uzaktan erişim** → **Telefonu eşleştir**: cihaz adı "Test tarayıcı", şifreniz. | Eşleştirme QR'ı (10 dakika geçerli) ve altında bağlantı. **QR'ı telefonla okutmayın**, bu testte açılmaz. | ☐ |  |
| 20.4 | **Bağlantıyı kopyala** → bilgisayarda Chrome ya da Edge'i açın (Mola penceresi değil) → adres çubuğuna yapıştırın. | Raporlarım sayfası açılır, eşleştirmeyi sorar. Telefon kodu istenirse yazın. | ☐ |  |
| 20.5 | Eşleştirin. | Bugünün satışı (nakit, kart, sipariş sayısı). Aşağıda en çok satanlar, kasa durumu, son 30 gün. Kafede Bildirimler'e "Cihaz eşleştirildi". | ☐ |  |
| 20.6 | Kafede bir satış yapın, Raporlarım'ı yenileyin. | Yeni satış görünür. | ☐ |  |
| 20.7 | Kafe: Ayarlar → Güvenlik ve yedek → Telefonum → Uzaktan yönetim kartı → **Uzaktan yönetimi aç**: şifreniz ve telefon kodu. | "Açık". | ☐ |  |
| 20.8 | Raporlarım sayfasında **Kafeyi yönet** → şifre ve telefon kodu. | Kafe yönetimi açılır, üstte "Uzaktan · uçtan uca şifreli". | ☐ |  |
| 20.9 | Uzaktan bir ürünün fiyatını değiştirin. | Kafede ve müşteri menüsünde değişir. Kafeye "uzaktan giriş" bildirimi. | ☐ |  |
| 20.10 | Kafede **Bütün uzak oturumları kapat**. Sonra eşleşmiş cihazı kaldırın. | Uzaktaki sekme düşer. Cihaz listeden kalkar. | ☐ |  |

## 21. E-posta raporları (isteğe bağlı)

*Süre: yaklaşık 15 dakika. Gmail'de 2 Adımlı Doğrulama açık olmalı. Uygulama şifresi: Google hesabı → Güvenlik → 2 Adımlı Doğrulama → Uygulama şifreleri.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 21.1 | **Ayarlar** → **İşletme** → **Raporlar ve e-posta** → Gmail: Gmail adresi ve 16 harflik uygulama şifresi → **Hesabı kaydet**. | "E-posta hesabı kaydedildi. Şifre bu bilgisayarda şifreli saklanır…" | ☐ |  |
| 21.2 | Raporların gideceği adresi yazın (en fazla 5) → kaydedin → **Deneme e-postası gönder**. | Deneme e-postası birkaç dakikada gelir. | ☐ |  |
| 21.3 | "Gün sonu raporu" açık olsun. Bir gün sonu (ya da ek kapanış) yapın. | Gün sonu e-postası: düz özet cümlesi ve yazdırılabilir PDF eki. Müşteri adı ya da telefonu yok. | ☐ |  |
| 21.4 | Normal Gmail şifrenizi deneyin. | Çalışmaz, anlaşılır bir hata verir. | ☐ |  |

## 22. Lisans işlemleri (Mola Yönetim'den)

*Süre: yaklaşık 35 dakika. Kafede Destek ekranını açık tutun.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 22.1 | Kafe: Ayarlar → İşletme → **Paket ve lisans** → Lisans kartı. Bitiş tarihini yazın: ________ | Abonelik, kalan gün ve bitiş. | ☐ |  |
| 22.2 | Mola Yönetim: TEST Kafe → **Lisans** → **Süreyi uzat** → **1 ay uzat**. "Ödeme alındı" açık, tutar önceden dolu. | Düğme "Emin misiniz? 1 ay eklenir" olur. | ☐ |  |
| 22.3 | Yeniden basın. Authenticator kodu istenirse yazın (**Onayla ve devam et**). | Bitiş tarihi 1 ay ileri gider. | ☐ |  |
| 22.4 | Kafede Lisans ve iletişim'e bakın. | Yeni bitiş tarihi (en geç 10 dakika). | ☐ |  |
| 22.5 | Mola Yönetim: Lisans → **Askıya al** → nedeni yazın → onaylayın. | Durum "Askıda". | ☐ |  |
| 22.6 | Kafede ve müşteri telefonunda bakın (müşteri menüyü yenilesin). | Kafede askıda olduğunu söyleyen uyarı. Müşteri menüsü açılmaz ya da sipariş alınmaz. Ekrandaki yazıları not edin. | ☐ |  |
| 22.7 | Mola Yönetim: **Hizmeti aç**. | Kafe ve müşteri menüsü yeniden çalışır. | ☐ |  |
| 22.8 | Mola Yönetim: Lisans → **Abonelik planı**'na bakın, aylık plana geçip yıllığa geri dönün. | "Emin misiniz?" sorar. Bitiş tarihi değişmez. | ☐ |  |
| 22.9 | Kafe, işletme sahibi olarak: **Destek** → **Talepler** → sayfanın en altına inin ("Lisans ve iletişim"in altı). | "Hizmeti dondurma" bölümü: "Yıllık abonelikte 12 ayda bir, en fazla 60 gün…" ve **Dondurma talebi oluştur** düğmesi. Düğme yalnız sahipte, yıllık abonelikte, lisans askıda değilken ve süresi dolmamışken basılır (22.8'de yıllık plana döndüğünüzden emin olun; aylıkta düğme soluktur ve "Bu işlem için yıllık abonelik kaydı gerekir." yazar). | ☐ |  |
| 22.10 | **Dondurma talebi oluştur** → Başlangıç tarihi: **yarın**, Dondurma süresi: `7`, Gerekçe: `Deneme: tadilat` → **Talebi gönder**. | "İşlem kaydedildi." Altta "Onay bekliyor" ve tarih, 7 gün, gerekçe. Düğme kaybolur (bekleyen talep varken ikincisi açılmaz). | ☐ |  |
| 22.11 | Mola Yönetim: **Bugün** → "TEST Kafe hizmeti dondurmak istiyor." → **İsteği incele** (ya da TEST Kafe → Lisans → Hizmeti dondurma). Yanıt kutusuna kısa bir not yazın → **Dondurmayı onayla**. | Talep "Planlandı", altında "Yeniden açılma: …". Lisans bitişi 7 gün ileri gider. | ☐ |  |
| 22.12 | Kafe: Ayarlar → İşletme → Paket ve lisans → Lisans kartına bakın (15 ile 20 saniye sonra sayfayı yeniden açın). | "Planlandı", "Destek yanıtı: …" ve "Yeniden açılma". Lisans kartında bitiş 7 gün ileri. Dondurma yarın başlayacağı için menü ve siparişler bugün çalışmaya devam eder. | ☐ |  |
| 22.13 | Mola Yönetim: aynı talepte **Planlanan dondurmayı iptal et**. Sonra kafede Destek'e bakın. | İki yerde de "Tamamlandı" ve "Erken bitiş: …". Bitiş tarihi 22.10'dan önceki tarihe döner. İptal edilen dondurma hakkı harcamaz: kafede **Dondurma talebi oluştur** yeniden görünür. | ☐ |  |
| 22.14 | (İsteğe bağlı) Bugün başlayan bir dondurma: 22.10'u başlangıç tarihi **bugün** ile yapın, 22.11 gibi onaylayın. Müşteri telefonunda menüyü yenileyin. Sonra Mola Yönetim'de **Dondurmayı bitir**. | Kafede "Donduruldu"; müşteri menüsü açılmaz, yeni sipariş alınmaz, açık hesaplar kapatılabilir. "Dondurmayı bitir"den sonra menü ve siparişler geri gelir. Bu dondurma 12 aylık hakkı kullanır (bir yıl yeni talep açılmaz). | ☐ |  |
| 22.15 | Mola Yönetim: Lisans → **Sahip şifresi sıfırlama kodu ver**. Kodu yazın. | 30 dakika geçerli, tek kullanımlık kod. | ☐ |  |
| 22.16 | Kafe: şeritten **Güvenlik** → **İşletme sahibi şifresini unuttum** → **Mola ekibinden kod** → kodu yazın → **Kodu kontrol et** → yeni şifre iki kez → **Yeni şifreyi kaydet**. | "Yeni şifre kaydedildi." Sahip yeni şifreyle girer. | ☐ |  |
| 22.17 | Aynı yoldan kurtarma koduyla da deneyin (kâğıttaki kod). | Kurtarma koduyla da şifre yenilenir. | ☐ |  |

## 23. Paketler, hizmet kilidi ve Satışlarım

*Süre: yaklaşık 20 dakika. Kafede Destek ekranını açık tutun.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 23.1 | Mola Yönetim: TEST Kafe → **Hizmet** → paket **Çay bahçesi**. | Altta Değişiklik bölümü: eklenen ve çıkan hizmetler, aylık fark. | ☐ |  |
| 23.2 | **Değişikliği uygula** → Authenticator kodu ("Emin misiniz?" sorulmaz). | Uygulanır. | ☐ |  |
| 23.3 | Kafede (sahip) menüye bakın. | Stok, rezervasyon, İkiye böl gibi kapanan hizmetler **soluk** ve "Pakette yok". | ☐ |  |
| 23.4 | Soluk bir yere dokunun. | "Bu hizmet paketinizde yok" kartı, kısa açıklama ve **Mola ekibine yaz**. | ☐ |  |
| 23.5 | **Mola ekibine yaz**. | Destek'te hazır talep: "Paketime hizmet eklemek / değiştirmek istiyorum". | ☐ |  |
| 23.6 | Ayarlar → İşletme → **Paket ve lisans** sekmesi. | "Çay bahçesi", paketteki hizmetler ve "Paketinize eklenebilecekler" (**Pakete ekle**). | ☐ |  |
| 23.7 | Garson telefonu ve mutfak tableti. | Kapanan hizmetler hiç görünmez (soluk da değil). | ☐ |  |
| 23.8 | Müşteri telefonunda menüyü yenileyin. | Menü görünür ama QR'dan sipariş verilemez (Çay bahçesinde QR sipariş yok). | ☐ |  |
| 23.9 | Mola Yönetim: Hizmet → **Restoran Pro** → uygula. | Kafede her şey geri gelir. Stok malzemeleri ve rezervasyonlar silinmemiş. | ☐ |  |
| 23.10 | Mola Yönetim: **Satışlarım**. | 22.3'teki uzatma kaydı. Bu ay tahsilat, aylık düzenli gelir, bekleyen ödemeler. | ☐ |  |
| 23.11 | **Ödeme ekle** (Authenticator ister) → kaydedin. Sonra bir kaydı **Ödendi** yapın. | Kayıtlar ve KDV dökümü güncellenir. | ☐ |  |
| 23.12 | Excel ve **Yazdır** (PDF). | Excel açılır. PDF düzgün. | ☐ |  |
| 23.12a | **Ayarlar** → **İşlem kayıtları** → Rapor al: **PDF**, sonra **Yazdır**. | PDF iner (Edge ile hazırlanır). Yazdır, aynı raporu yazdırma penceresinde açar. "PDF oluşturulamadı" çıkarsa mesajı ve logs\merkez.log'daki "[PDF" satırını bana gönderin. | ☐ |  |
| 23.13 | (İsteğe bağlı) Ayarlar → **Paketler**: bir paketi **Kopyala**, adını değiştirin, kaydedin, sonra arşivleyin. | Adım onayı ister. Paket listede görünür, sonra arşive gider. | ☐ |  |

## 24. Yedekler

*Süre: yaklaşık 20 dakika. USB flash belleği takın.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 24.1 | Şerit → **Yedekle**. | Son yedek zamanı, sonraki otomatik yedek (03:30) ve "Saklanan yedekler" listesi. | ☐ |  |
| 24.2 | **Şimdi yedekle**. | "Yedek alındı ve doğrulandı." | ☐ |  |
| 24.3 | Aynı pencerede **İkinci yedek yeri** → **Yer seç** → flash belleği seçin → **Bu yeri kullan**. | Yer: flash bellek. | ☐ |  |
| 24.4 | **Şimdi yedekle**. Sonra Dosya Gezgini'nde flash belleğe bakın. | Flash bellekte "Mola-Yedek" klasörü ve içinde yedek. "Son kopya" zamanı güncel. | ☐ |  |
| 24.5 | Flash belleği çıkarın → **Şimdi yedekle**. | Bilgisayardaki yedek alınır. İkinci yer için uyarı çıkar, şeritte Yedekle'nin yanında nokta. | ☐ |  |
| 24.6 | Flash belleği geri takın → Şimdi yedekle. | Uyarı kalkar. | ☐ |  |
| 24.7 | **Yedek klasörünü aç**. | `%LOCALAPPDATA%\Mola\backups` açılır. | ☐ |  |
| 24.8 | Kafe: Ayarlar → Güvenlik ve yedek → Yedek. | Son yedek zamanı doğru. | ☐ |  |
| 24.9 | Mola Yönetim: **Ayarlar** → **Yedek** → **Şimdi yedekle**. | Merkez yedeği alınır ve doğrulanır. | ☐ |  |
| 24.9a | Mola Yönetim: Ayarlar → Yedek → İkinci yedek yeri → **Göz at**; pencere Mola'nın arkasında kalırsa bir daha **Göz at**'a basın. | Düğme "Pencere açık…" olur, yanında "Klasör seçme penceresi açıldı (görev çubuğuna bakın)." İkinci basışta hata değil aynı not. | ☐ |  |
| 24.10 | Ertesi sabah Yedekle penceresine bakın. | 03:30 yedeği alınmış ya da "Gece yedeği gerekmedi: …" yazıyor. | ☐ |  |

## 25. Güncellemeler ve dosya bütünlüğü (isteğe bağlı)

*Süre: yaklaşık 20 dakika. Gerçek bir güncellemeyi denemek için yeni bir sürüm (0.1.1) gerekir. Hazırlamamı isterseniz söyleyin.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 25.1 | Mola Yönetim: **Ayarlar** → **Güncellemeler**. | "Yeni sürümü buraya sürükleyin" alanı ve işletmelerin sürümleri tablosu. | ☐ |  |
| 25.2 | `Guncelleme\Mola-0.1.0-windows.mola-guncelleme` dosyasını alana sürükleyin → **Yükle ve doğrula** (Authenticator kodu). | Sürüm listede: 0.1.0 Windows, "Henüz hiçbir işletmeye gitmedi". **Yayınlamayın:** kafe zaten 0.1.0. | ☐ |  |
| 25.3 | İşletmelerin sürümleri tablosuna bakın. | TEST Kafe satırında sürüm 0.1.0. Güncelleme sütununda bir şey indirilmiyor. | ☐ |  |
| 25.4 | Kafe: Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme → güncelleme satırı. | "Güncel. Yeni sürüm çıkınca kendiliğinden indirilir." | ☐ |  |
| 25.5 | (Dosya bütünlüğü) Kafede şeritten **Kapat**. `%LOCALAPPDATA%\Mola\app\dist\assets` içinde adı **AppVersion** ile başlayan **.css** dosyasını Not Defteri'yle açın, en sona bir boş satır ekleyip kaydedin. Mola'yı masaüstü simgesinden açın. | Mola normal açılır. | ☐ |  |
| 25.6 | 10 ile 15 dakika bekleyin. Mola Yönetim: İşletmeler ve TEST Kafe → Lisans. | "Dosyalar değiştirilmiş" çipi, Bugün'de bir satır, zilde olay. Lisans sekmesinde değişen dosyanın adı. Kafe hiçbir şekilde durmaz. | ☐ |  |
| 25.7 | Düzeltmek için **Mola Kurulum.exe**'yi yeniden çalıştırın (üstüne kurulum). | Program dosyaları yenilenir, veriler korunur. Bir sonraki denetimde uyarı kalkar. | ☐ |  |

## 26. Hız hissi (en zayıf cihaz)

*Süre: yaklaşık 15 dakika. En eski ya da en yavaş telefon veya tabletinizle. Süreleri içinizden sayarak tahmin edin.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 26.1 | Mola'yı kapatıp açın, giriş yapın. | Masalar 3 saniyeden kısa sürede görünür. Süre: ___ sn | ☐ |  |
| 26.2 | Sipariş al'da menüyü baştan sona kaydırın, ürün arayın. | Takılma yok, fotoğraflar gecikmeden yüklenir. | ☐ |  |
| 26.3 | 5 ürünlük bir sipariş gönderin. | Gönder'den sonra 1 saniyeden kısa sürede onay. | ☐ |  |
| 26.4 | Müşteri olarak bu cihazda QR okutun, ilk açılış. | Menü 3 saniyeden kısa sürede. Süre: ___ sn | ☐ |  |
| 26.5 | Bilgisayarda Satış ve Raporlar → Tümü, Muhasebeci için indir. | Birkaç saniyede biter. Bu sırada garson telefonu donmaz. | ☐ |  |
| 26.6 | Dört cihaz aynı anda kullanılırken bilgisayarın Görev Yöneticisi'ne bakın. | Mola (node.exe) belleği ve işlemcisi makul. Değerleri not edin. | ☐ |  |

## 27. İnternet kesintisi

*Süre: yaklaşık 10 dakika. Wi-Fi açık kalsın, yalnız internet gitsin.*

> **Bilgi:** Bu testte Mola Merkez sizin bilgisayarınızda olduğu için internet kesilse de Merkez'e bağlantı sürer. Gerçek kafede Merkez internette olacak. Bu yüzden burada asıl denediğimiz şey personelin internetsiz çalışması.

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 27.1 | Test telefonlarında mobil veriyi kapatın (telefon Wi-Fi'nin interneti yok diye mobil veriye geçmesin). | Telefonlar yalnız Wi-Fi'de. | ☐ |  |
| 27.2 | Modemin internet kablosunu (telefon hattı ya da fiber) çıkarın. Wi-Fi ışığı yanmaya devam etmeli. | Bilgisayarda ve telefonlarda "internet yok" işareti. | ☐ |  |
| 27.3 | Garson sipariş alsın, mutfak hazırlasın, kasada ödeme alın, gün içi işlemler yapın. | Hepsi çalışır. | ☐ |  |
| 27.4 | Müşteri (Wi-Fi'deki telefon) QR'dan sipariş versin. | Çalışır (QR Wi-Fi adresini taşıdığı için). | ☐ |  |
| 27.5 | E-posta raporu açıksa **Deneme e-postası gönder**. | Anlaşılır bir hata. Mola donmaz. | ☐ |  |
| 27.6 | İnternet kablosunu geri takın. | Her şey normal. Bekleyen işler (e-posta gibi) kendiliğinden gider. | ☐ |  |

## 28. Elektrik kesintisi

*Süre: yaklaşık 15 dakika. Bilgisayarda kaydedilmemiş başka bir işiniz olmasın. Dizüstü bilgisayarda fişi çekmek yetmez (pil var): güç düğmesini 10 saniye basılı tutun.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 28.1 | Servis ortamı hazırlayın: iki açık masa, birinde mutfakta "Hazırlanıyor" sipariş, birinde kısmi ödeme. Bir masasız sipariş. Tutarları yazın: ________ | Hazır. | ☐ |  |
| 28.2 | Garson tam o sırada bir sipariş göndersin ve hemen bilgisayarın fişini çekin (ya da güç düğmesini 10 saniye tutun). | Bilgisayar kapanır. Telefonlarda bağlantı yok uyarısı. | ☐ |  |
| 28.3 | 1 dakika bekleyin. Bilgisayarı açın, Windows'a giriş yapın. | Mola ve Mola Yönetim arka planda kendiliğinden başlar. | ☐ |  |
| 28.4 | Telefonlara ve tablete bakın (gerekirse sayfayı yenileyin). | Kendiliğinden yeniden bağlanırlar. | ☐ |  |
| 28.5 | Mola'yı simgeden açın. Masaları, tutarları, mutfak aşamalarını, kısmi ödemeyi kontrol edin. | Hepsi kesintiden önceki gibi. Kayıp yok, çift sipariş yok. 28.2'deki sipariş ya hiç yok ya da bir kez var. | ☐ |  |
| 28.6 | Kasa açık mı, raporlar doğru mu? | Kasa ve bugünkü satış aynı. | ☐ |  |
| 28.7 | Mola Yönetim'i açın. | Açılır, TEST Kafe "Çalışıyor". | ☐ |  |

## 29. Geri yükleme, kaldırma ve temizlik

*Süre: yaklaşık 30 dakika. Bu bölüm yalnız TEST kurulumunu siler. Kurtarma kodu kâğıdınız ve flash bellek elinizde olsun.*

| # | Ne yapın | Ne olmalı | ☐ | Not |
|---|---|---|---|---|
| 29.1 | Bugünkü satış toplamını, masa sayısını, ürün sayısını ve çalışanları yazın: ________ | Not alındı. | ☐ |  |
| 29.2 | Flash bellek takılıyken şerit → Yedekle → **Şimdi yedekle**. | Flash bellekte yeni kopya. | ☐ |  |
| 29.3 | Windows **Ayarlar** → **Uygulamalar** → **Yüklü uygulamalar** → **Mola** → **Kaldır**. "Verileri ve yedekleri de sil"i **işaretleyin** (yalnız TEST kurulumu). Mola Yönetim'i kaldırmayın. | Mola kaldırılır. Flash bellekteki Mola-Yedek'e dokunulmaz. | ☐ |  |
| 29.4 | **Mola Kurulum.exe**'yi yeniden çalıştırın → Kur → Mola'yı aç. | "Bu bilgisayarda henüz işletme yok…" ekranı. | ☐ |  |
| 29.5 | **Yedekten geri yükle** → **Ara** → flash bellekteki yedeği seçin → kurtarma kodunu yazın → **Geri yükle**. | "Yedek açılıyor ve doğrulanıyor…", sonra "Veriler geri yüklendi ve doğrulandı. Mola yeniden açılıyor…" | ☐ |  |
| 29.6 | 29.1'deki bilgileri karşılaştırın. Ürün fotoğraflarına bakın. | Hepsi aynı. Fotoğraflar yerinde. Eski şifrelerle girilir. | ☐ |  |
| 29.7 | Telefonlarda ve tablette Mola'yı açın. | Yeniden giriş isteyebilir, sonra aynı kafeye bağlanır. Masa QR'ları çalışır. | ☐ |  |
| 29.8 | Testi bitirince TEST kurulumunu kaldırın (29.3 gibi, "Verileri ve yedekleri de sil" işaretli). Telefonlardan ve tabletten Mola uygulamasını ve ana ekran simgelerini silin. | Temizlendi. | ☐ |  |
| 29.9 | Mola Yönetim: TEST Kafe → Lisans → **Askıya al** → **Kaydı sil** → işletmenin adını yazın → **Evet, kalıcı olarak sil**. | TEST Kafe listeden kalkar. Başka işletmelere dokunulmaz. | ☐ |  |
| 29.10 | (İsteğe bağlı) Eski deneme kurulumunu geri getirin: `%LOCALAPPDATA%` içinde "Mola-eski"nin adını yeniden `Mola` yapın, sonra **Mola Kurulum.exe**'yi çalıştırın. | Eski kurulum yeni sürümle, eski verileriyle açılır. | ☐ |  |
| 29.11 | Bilgisayarın uyku ayarını eski hâline getirin. Ağ profilini Özel bırakabilirsiniz (ev ve kafe ağı için doğrusu bu). | Tamam. | ☐ |  |

## 30. Hata bildirme

Her sorunu ayrı bildirin. En hızlı çözüm için şu dört şey yeter: **ekran görüntüsü**, **hangi cihaz**, **hangi adım numarası**, **ne bekliyordunuz**.

### 30.1 Ekran görüntüsü

- Bilgisayarda: **Windows + Shift + S** ile seçin ya da **PrtSc**. Dosya adı adım numarası olsun: `5.22-iphone.png`.
- iPhone: yan tuş ve ses açma tuşu birlikte.
- Android: güç tuşu ve ses kısma tuşu birlikte.
- Masaüstünde **Mola-Test-Hatalar** adında bir klasör açın, bütün görüntüleri oraya koyun.

### 30.2 Ekranda bir "Takip kodu" görürseniz

Bazı hata mesajlarının sonunda "Takip kodu" ve uzun bir kod yazar. O kodu da aynen yazın. Mola Yönetim'de İşletmeler → TEST Kafe → **Hata kayıtları** bölümünde ve Destek'teki "Hata takip kodunu sorgula" ile bulunur.

### 30.3 Kayıt dosyaları

Test sonunda (ya da ciddi bir hatadan hemen sonra) bu iki klasörü **Mola-Test-Hatalar** klasörüne kopyalayın:

| Ne | Nerede |
|---|---|
| Kafe uygulaması kayıtları | `%LOCALAPPDATA%\Mola\logs` (sunucu.log, kurulum.log) |
| Mola Yönetim ve Merkez kayıtları | `%LOCALAPPDATA%\Mola Yonetim\logs` (merkez.log, kurulum.log) |
| Bağlantı özeti | Kafe: Ayarlar → Cihazlar → Tablet ve telefonlar → **Bağlantıyı kontrol et** → **Destek için özeti göster** → kopyalayıp bir metin dosyasına yapıştırın. Sorunlu cihazda yapın. |

Kayıt dosyalarında şifre ve satış bilgisi yoktur.

### 30.4 Nasıl gönderilir?

- **Bana (Claude):** bu sohbete aşağıdaki kalıpla yazın, ekran görüntülerini ekleyin. Birkaç hatayı tek mesajda gönderebilirsiniz.
- **Programın içinden:** kafede **Destek** → **Talepler** → **Yeni talep**. Bu talep sizin Mola Yönetim'inize gelir (Bölüm 19'un denemesi de olur). Ben oradakini göremem; önemli olanları bana da yazın.

### 30.5 Hata kalıbı

| Alan | Doldurun |
|---|---|
| Hata no | H-__ |
| Adım no | (örneğin 5.22) |
| Cihaz ve hesap | (Bilgisayar / Android / iPhone / tablet · sahip, garson, kasiyer, mutfak, müdür, müşteri) |
| Ne yaptım |  |
| Ne bekliyordum |  |
| Ne oldu | (ekrandaki yazıyı aynen; takip kodu varsa onu da) |
| Saat | (kayıtlarda bulmak için) |
| Tekrar oluyor mu? | Her seferinde / Bazen / Bir kez |
| Önemi | İşi durdurdu / Rahatsız etti / Küçük (yazı, renk, hizalama) |
| Ekran görüntüsü | (dosya adı) |

Örnek: "H-03 · 9.10 · iPhone, müşteri · Bütün personel ekranlarını kapattım, 2 dakika bekledim · Sipariş verilemez yazmasını bekliyordum · Sipariş gitti, mutfakta göründü · 14:52 · Her seferinde · İşi durdurmadı · 9.10-iphone.png"

## 31. VDS'ten sonra denenecekler

VDS kurulup Mola Merkez internete taşınınca (docs/VDS_KURULUM.md) şunları ayrıca deneyeceğiz:

| # | Ne denenecek | ☐ |
|---|---|---|
| 31.1 | Masa QR'larının internet adresini taşıması ("QR kodları internet adresini taşır · Bağlı", `menu.molayazilim.com.tr/q/…`) ve eski Wi-Fi adresli QR'lar için "yeniden basılmalı" uyarısı | ☐ |
| 31.2 | Wi-Fi'si kapalı, yalnız mobil verili telefonla masa QR'ı: menü, sipariş, garson çağırma, hesap isteme | ☐ |
| 31.3 | Kafe bilgisayarı kapalıyken menünün Merkez'deki kopyasından açılması ("Şu an sipariş alınamıyor…"), bilgisayar açılınca siparişe dönmesi, sepetin kaybolmaması | ☐ |
| 31.4 | Kafenin interneti kesikken müşteri menüsü ve telefon erişim noktasıyla (hotspot) siparişin geri gelmesi | ☐ |
| 31.5 | Askıya alınan işletmede internet menüsünün "dijital menü şu anda kullanılamıyor" demesi | ☐ |
| 31.6 | Sosyal medya QR kartlarının kısa adresi (`/s/…`): yönlendirme, askıda "Bu işletmenin bu hizmeti şu anda kullanılamıyor" | ☐ |
| 31.7 | Web sitesi iletişim formu → Mola Yönetim → Başvurular → Web sitesi talepleri (Arandı, Kapandı, İşletme ekle) | ☐ |
| 31.8 | Raporlarım ve Kafeyi yönet gerçek telefonda, mobil veriyle, HTTPS üzerinden | ☐ |
| 31.9 | Uzaktan destek (Kafeye bağlan) internet üzerinden | ☐ |
| 31.10 | Bulutta şifreli yedek ve yeni bilgisayarda "Mola Merkez'den geri yükle" (taşıma kodu) | ☐ |
| 31.11 | Hesap açma başvurusu: başka bir bilgisayardan, internet üzerinden, "30 günlük denemeyi başlat" (önce evde: docs/EV_AGI_PROVASI.md) | ☐ |
| 31.11a | molayazilim.com.tr → **Uygulamayı indir**: VDS paketleriyle `npm.cmd run site:indir`, `downloads.enabled: true`; başka bir bilgisayardan indirip SHA-256'yı karşılaştırma, SmartScreen "Ek bilgi → Yine de çalıştır" | ☐ |
| 31.12 | Gerçek güncelleme: 0.1.1'i önce pilot, sonra herkese yayınlama; kafenin indirip kapanışta kurması | ☐ |
| 31.13 | Kafeleri yeni Merkez adresine geçirme (VDS_KURULUM bölüm 9) | ☐ |
| 31.14 | Mola Yönetim'e başka bir cihazdan HTTPS ile giriş ve iki adımlı doğrulama | ☐ |
| 31.15 | Mola Yönetim e-posta bildirimleri ve duyuruların e-posta kopyası | ☐ |
| 31.16 | Dondurma talebinin internet üzerinden gidip gelmesi (kafeden talep, VDS'teki Mola Yönetim'den onay; yerel deneme 22.9–22.14) | ☐ |
| 31.17 | Zayıf mobil veriyle menü hızı ve fotoğrafların yüklenmesi | ☐ |
| 31.18 | Merkez sağlık takibi ve Merkez yedeğinin kendi bilgisayarınıza indirilip geri yükleme provası | ☐ |

## 32. Sonuç özeti

Test bitince doldurun.

| Bölüm | Tamam | Hata sayısı | Not |
|---|---|---|---|
| 0 Hazırlık |  |  |  |
| 1 İlk gün kurulumu |  |  |  |
| 2 Personel ve cihazlar |  |  |  |
| 3 Menü |  |  |  |
| 4 Masa QR kodları |  |  |  |
| 5 Müşteri yolculuğu |  |  |  |
| 6 Garson |  |  |  |
| 7 Mutfak |  |  |  |
| 8 Kasiyer |  |  |  |
| 9 QR açık ve kapalı |  |  |  |
| 10 Gün sonu |  |  |  |
| 11 Raporlar |  |  |  |
| 12 Stok |  |  |  |
| 13 Rezervasyon |  |  |  |
| 14 Vardiya |  |  |  |
| 15 Müdür |  |  |  |
| 16 Hesaplar ve kilit |  |  |  |
| 17 İkiye böl |  |  |  |
| 18 Ayarlar |  |  |  |
| 19 Destek |  |  |  |
| 20 Raporlarım |  |  |  |
| 21 E-posta |  |  |  |
| 22 Lisans |  |  |  |
| 23 Paketler |  |  |  |
| 24 Yedekler |  |  |  |
| 25 Güncellemeler |  |  |  |
| 26 Hız |  |  |  |
| 27 İnternet kesintisi |  |  |  |
| 28 Elektrik kesintisi |  |  |  |
| 29 Geri yükleme |  |  |  |

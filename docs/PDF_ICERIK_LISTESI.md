# PDF'lere girecek konular (kontrol listesi)

PDF'ler en son, ekranlar kesinleşince hazırlanır. Her yeni özellik buraya eklenir ve doğru PDF'in doğru bölümüne yazılır.

## 1. Mola Kullanım Kılavuzu (kafeler için, fiyatsız)
Üretildi (7 Ekim): `docs/pdf/Mola-Kullanim-Kilavuzu.pdf` · aşağıdaki maddelerin hepsi işlendi (8 Ekim kararları da işlendi, 8 Ekim yeniden üretimi) · yeniden üretmek: `npm.cmd run pdf:kilavuz` (kaynak `docs/pdf/kaynak/kilavuz/kullanim.ts`).
Numaralı adımlar + oklu ekran görüntüleri. Her özelliğin hangi pakette olduğu yazılır.
- Müşteri yolculuğu: masaya oturma, QR okutma, menü, sepet, sipariş, garson çağırma, hesap isteme, ödeme sonrası "Bizi değerlendirin ve takip edin", "Hesabınız kapandı"
- Garson, Kasiyer, Mutfak (fiş modu, tek mutfak), Müdür, İşletme sahibi
- Masalar, Sipariş al, masasız (al götür) satış ve "Teslim edildi"
- Kasa ve gün sonu, iade, yazar kasa yardımcısı (ÖKC entegrasyonu henüz yok)
- Satış ve Raporlar: Bugün / 7 gün / 30 gün / Yıl ▾ / Tümü (yıl tablosu), KDV (satış anındaki oranla), Excel/PDF
- Yıl paketi: 1 Şubat'ta kapanış, kapanmış yıla geriye dönük kayıt yapılamaz, eski hesaba iade bugüne yazılır, kişisel bilgilerin silinmesi
- Yedekler: gece yedeği atlama, 7 gün / 4 hafta / 12 ay + yıl paketleri, USB, bulut yedek
- Stok, reçete, kârlılık; rezervasyon ve etkinlik; vardiya ve bahşiş; ajanda
- Menü yönetimi, kampanyalar, KDV oranları
- Ayarlar: İşletme (Görünüm, Sosyal medya, Raporlar ve e-posta), Masalar ve QR (6'lı / 12'li / A6 masa standı, masa adı), Yazıcı ve ses, Sipariş ve kasa, Giderler ve kâr, Güvenlik
- Sosyal medya ve QR kartları (ücretli hizmet; Google değerlendirme ücretsiz), QR'ların askıda çalışmaması, PDF indir / yazdır
- Paketiniz kartı, kilitli hizmet görünümü, "Mola ekibine yaz"
- Destek: Talepler, Bildirimler, Duyurular (Önemli duyuru penceresi), Uzaktan erişim
- Raporlarım telefonda (telefon eşleştirme kafeden, şifreyle), uzaktan yönetim (şifre + Authenticator), e-posta raporları, iki ekran
- Lisans sözleşmesi onayı, otomatik kilit, oturumların 05:00'te bitmesi
- QR'ları koruma önerileri: mat baskı, akrilik A6 stand, laminasyon, yedek set
- QR siparişlerinin açık/kapalı olması (8 Ekim kararı, **yapıldı**, kılavuzda): menü her zaman görünür (VDS'teki kopyadan); sipariş yalnız siparişi görecek bir personel ekranı (mutfak, garson, kasa) o anda bağlıyken alınır; gün sonundan sonra sipariş durur, kasiyer ekranındaki "QR siparişleri: Kapalı · gün sonu yapıldı · Aç" ile yeniden açılır; elle "QR siparişlerini durdur" (onay penceresi: "Emin misiniz? Müşteriler telefondan sipariş veremez, menü görünmeye devam eder") ve uzun süre kapalı kalınca hatırlatma; kasa/garson ekranındaki durum etiketi; müşterinin gördüğü "Şu an sipariş almıyoruz, lütfen garsonunuza sorun"; kafenin interneti kesilince QR siparişinin durması, personelin kafe ağında çalışmaya devam etmesi, yedek internet olarak telefon hotspot önerisi
- Gizlilik: müşteri menüsünün altındaki "Gizlilik" bağlantısı (**yapıldı**, kılavuzda; ekran `docs/ekran/misafir/gizlilik.png`)
- İnternetten menü: masa QR'ı her ağdan açılır (misafirin kendi mobil verisi ya da herhangi bir Wi-Fi; adres menünün kendi adresi `menu.molayazilim.com.tr/q/…`, 11 Ekim), Masalar ve QR'daki "QR kodları internet adresini taşır · Bağlı" satırı, internet adresi hazır değilken Wi-Fi adresi ve "yeniden basılmalı" notu, eski (Wi-Fi'li) QR'ları yeniden basma uyarısı; kafe bilgisayarı kapalıyken misafirin gördüğü "Menü şu anda açılamıyor. Lütfen garsonunuza sorun." sayfası, askıdaki işletmede "dijital menü kullanılamıyor" sayfası (ekranlar `docs/ekran/misafir/internetten-menu.png`, `menu-acilamiyor.png`, `docs/ekran/kafe/masa-qr-internet.png`)

## 2. Mola Yönetim Kılavuzu (sadece satıcı için)
Üretildi (7 Ekim): `docs/pdf/Mola-Yonetim-Kilavuzu.pdf` · aşağıdaki maddelerin hepsi işlendi (8 Ekim maddeleri de işlendi) · aynı komut (kaynak `docs/pdf/kaynak/kilavuz/yonetim.ts`).
- Bugün, İşletmeler (kutucuklar, Lisans / Hizmet / Bilgiler / Destek sekmeleri), Başvurular (web sitesi talepleri dahil)
- Lisans: deneme, uzatma, plan, askıya alma, dondurma, "Ödeme alındı"
- Paketler, Hizmet fiyatları, işletmeye özel indirim, Satışlarım (KDV, Excel/PDF)
- Duyurular (hedefleme, Önemli, okundu takibi, e-posta kopyası), Yeni mesaj, Destek sohbetleri
- Güncellemeler (sürükle bırak, pilot, yayınla), Authenticator adım onayı (fiyat, paket, ödeme, duyuru, yayın)
- Sunucu yedeği ve uyarılar, dosya bütünlük uyarısı, lisans sözleşmesi kabulü, İşlem kayıtları
- Sosyal medya kısa adresleri, web sitesi ve iletişim formu
- İnternetten menü: Merkez'in kafelere menü kodu vermesi (`/q/<kod>`), **`MERKEZ_MENU_ORIGIN`** (menünün kendi alt alan adı, `menu.molayazilim.com.tr`; güvenlik gereği, DNS `menu` kaydı) **toplu masa QR basımından önce**, Caddy'de `menu.` bloğu yalnız `/q/*`, eski adreslerden `308`, sosyal medya kısa adresleri (`/s/`, `MERKEZ_SITE_ORIGIN`) sitede, askı/dondurma/lisans bitişinin internet menüsünü Merkez'de kapatması, kafe bilgisayarı kapalıyken misafirin gördüğü sayfa, eski Merkez/eski kafe uyumu
- Menünün VDS'teki kopyası (8 Ekim kararı, **yapıldı**, kılavuzda): kafe menü değişikliğini birkaç saniyede Merkez'e gönderir, misafir menüyü (ürün, fiyat, fotoğraf, tükendi) Merkez'den açar; sipariş ve canlı işler tünelle kafeye gider; Mola Yönetim'de "QR siparişleri açık/kapalı" durumu
- VDS ve alan adı (molayazilim.com.tr), Merkez yedeğinin kendi bilgisayara çekilmesi
- 11 Ekim (güvenlik denetimi; kılavuz kaynağına menü adresi işlendi, PDF yeniden üretilmedi): DNS'te dört kayıt (`@`, `www`, `merkez`, `menu`), menünün kendi adresi; lisans artık tek kopya ve hizmet listesiyle (Merkez güncellenince bütün lisanslar bir kez yeniden imzalanır, kafeler hizmetlerini kaybetmez; eski, paketlemeden önceki kafe sürümleri önce güncellenmeli)

## 3. Avukat için bilgi dosyası
- Mimari: veri kafede, Merkez satış verisi görmez; şifreleme; lisans imzası
- İşlenen kişisel veriler ve yerleri: personel, rezervasyon müşterisi, paket servis müşterisi, QR misafir oturumu, destek talepleri ve ekleri (14 gün), web sitesi iletişim formu, işletme sahibi iletişim bilgileri, e-posta raporları
- Saklama: yedek kademeleri, yıl paketleri (kişisel alanlar silinir), Merkez bulut yedeği, işlem kayıtları
- İnternetten menü (7 Ekim): misafirin QR menü trafiği (menü, sepet, sipariş, garson çağrısı, hesap isteği, ürün fotoğrafları) Mola Merkez'den **geçer**; Merkez TLS'i kendisi sonlandırdığı için bu trafiği açık hâlde görür ama **saklamaz ve günlüğe yazmaz** (yalnız istek/hata sayaçları, bellekte; ürün fotoğrafları ve program dosyaları birkaç dakika/saat önbellekte), misafirin IP adresi yalnız sınırlar için kafeye iletilir ve saklanmaz; satış verisi yine yalnız kafede. Aydınlatma metnine "QR menü internet üzerinden Mola Merkez aracılığıyla sunulur; Mola içeriği saklamaz" cümlesi; `mola_browser` çerezinin (30 gün, yalnız o işletmenin menü adresine) çerez metnine eklenmesi
- Menünün Merkez'deki kopyası (8 Ekim, **yapıldı**, avukat dosyasında): menünün herkese açık içeriği (ürün adı, açıklama, fiyat, kampanya, fotoğraf, masa adı; satış/misafir/çalışan bilgisi yok) Merkez'de mühürlü durur, işletme kaydı silinince silinir; misafir menüsünün altında "Gizlilik" sayfası (TASLAK, işletme veri sorumlusu, Mola hizmet sağlayıcı, `mola_browser` 30 gün)
- Saklama süreleri (8 Ekim, **yapıldı**, avukat dosyasında): işlem kayıtlarında IP 1 yıl (zincir doğrulanabilir kalır), kapanan destek 2 yıl, reddedilen başvuru 1 yıl, engellenen misafir tarayıcısı 90 gün; lisans sözleşmesi 9.3/9.4 düzeltildi (Sürüm 3), web sitesi gizlilik/KVKK metinleri düzeltildi
- Yurt dışı aktarım yok hedefi (VDS İstanbul), e-posta sağlayıcısı kararı
- Mola Merkez'in kendi şifreli yedeğinin ikinci kopyası satıcının Google Drive'ında (Google Drive masaüstü uygulamasının klasörü "İkinci yedek yeri" olarak seçilir; kurtarma kodu Drive'da tutulmaz): şifreli de olsa yurt dışı aktarım sayılır mı, avukata sorulacak
- Gereken metinler: aydınlatma metinleri, gizlilik, çerez (izleme yok), son kullanıcı lisans sözleşmesi (taslak docs/hukuk), abonelik/hizmet sözleşmesi, veri işleme sözleşmesi
- Açık sorular: e-Adisyon, ÖKC, fiş kuralları, çalışan verisinin saklama süresi, "Mola" marka araştırması

## 4. Hocalar için teknik anlatım
- Diller ve araçlar, katmanlar, şemalar; her fonksiyonun arkada nasıl çalıştığı
- Kafe sunucusu, Merkez, Mola Yönetim, Android, web sitesi; senkron, röle, uçtan uca şifreleme
- İnternetten menü: kafeden dışa doğru tek WebSocket tüneli (imzalı açılış, istek başına HMAC, çoklama, parçalı yanıt, sıra/eşzamanlılık sınırı), iki taraflı izin listesi, misafir sayfasının ayrı Vite girişi ve göreli dosya adresleri, SHA-256 ile içerik adresli önbellek, ölçümler (eklenen gecikme, 50 kafe × 30 misafir yükü, yavaş kafenin diğerlerini etkilememesi)
- Menü kopyası ve sipariş kabul kuralı (8 Ekim, **yapıldı**, teknik anlatımda): menünün Merkez'de tutulan kopyası ve eşitlenmesi, "aktif personel ekranı" sinyali, gün sonu duraklaması, elle durdurma
- Veri saklama: SQLite, mühürlü satırlar, gün/ay/yıl özetleri, yıl paketleri, yedekleme algoritması
- Güvenlik: lisans imzası, bütünlük kontrolü, adım onayı, oturumlar
- Test: birim, tarayıcı, 5 yıllık yük testi ve zayıf bilgisayar testi
- Yapay zeka ile geliştirme bölümü

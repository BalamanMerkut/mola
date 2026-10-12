# Mola — adisyon ve QR menü

Merkut Studios

İki Word belgesindeki plana göre ilk çalışan geliştirme dilimi, sürüm **0.1.0**. Ürün adı Mola, geliştiren Merkut Studios. Bu sürüm bilgisayarda sahte verilerle test içindir; müşteri yayınına hazır değildir.

## Hemen açma

Bu klasörde PowerShell/terminal açın. Node.js 24 gereklidir. Bağımlılıklar bu bilgisayarda kuruldu; başka bir bilgisayarda önce `npm ci` çalıştırın.

```powershell
npm run dev
```

Tarayıcıda **http://localhost:3000** adresini açın. Sunucuyu durdurmak için terminalde `Ctrl+C` kullanın. Uygulama çalışırken terminal açık kalmalıdır.

| Deneme hesabı | Kullanıcı adı | Şifre |
|---|---|---|
| İşletme sahibi | isletme | MolaDemo!2026 |
| Kasiyer | kasiyer | MolaDemo!2026 |
| Garson | garson | MolaDemo!2026 |
| Mutfak | mutfak | MolaDemo!2026 |

Bu hesaplar yalnızca geliştirme içindir. Giriş ekranına kullanıcı adını yazın. Çalışanlar bölümünden eklediğiniz hesaplarla da giriş yapabilirsiniz. Farklı çalışan rollerini aynı anda denemek için ayrı tarayıcı profilleri/gizli pencereler kullanın; normal sekmeler aynı çalışan çerezini paylaşır.

## İlk deneme: siparişten hesap kapatmaya

1. İşletme sahibi hesabıyla giriş yapın; bu ekran açık kalsın.
2. **Masa 01 → QR menüyü aç → Müşteri menüsünü aç** yolunu izleyin.
3. Müşteri menüsünden ürünü seçip **Sepete ekle → Sepetimi görüntüle → Siparişi gönder** düğmelerini kullanın.
4. İşletme ekranında **Mutfak** bölümünde siparişi hazırlamaya alın, hazır ve teslim edildi durumlarını deneyin.
5. **Masalar → Masa 01 → Ödeme al** bölümünden nakit/kart seçin. Kısmi ödeme için tutarı azaltın. Nakit alınan tutarı yükselttiğinizde para üstünü görün.
6. Tam ödeme sonrasında masa yeni hesaba hazır olur. Eski müşteri ekranında hesap kapandı mesajı görünür. Yeni sipariş için QR bağlantısını yeniden açın.
7. Dört ayrı tarayıcı profiliyle aynı QR'ı açarak aynı masaya sipariş verin. Hesap birleşir; müşteri yalnızca kendi siparişlerini görür.

Ödeme ekranı **gerçek para çekmez**; kasada gerçekleşen tahsilatı deneme hesabına kaydeder. QR oluşturulması, siparişin fiziksel olarak işletme içinden verildiğini kanıtlamaz. Tarayıcı engeli çerez silinerek/açılan yeni profille aşılabilir; IP engeli yoktur.

## Telefon veya Android tabletle deneme

Önce normal sunucuyu durdurun, ardından:

```powershell
npm run dev:lan
ipconfig
```

Bilgisayarınızın bağlı ağındaki **IPv4 adresini** bulun. Örneğin `192.168.1.50` ise telefonda `http://192.168.1.50:3000` açın. Bilgisayar ve telefon aynı güvenilir yerel ağda olmalıdır. Gerekirse Windows Güvenlik Duvarı'nda Node için yalnızca özel ağ erişimine izin verin.

QR'ı oluştururken işletme ekranını da bu IP adresinden açın. `localhost` içeren QR telefonda bilgisayarı göstermez; telefonun kendisini gösterir. Misafir ağı cihazlar arası erişimi engelliyorsa farklı güvenilir ağ kullanın.

**Bu aynı ağa bağlanma koşulu yalnızca yerel test içindir.** Hedef canlı üründe müşteri mobil internetiyle merkezdeki HTTPS adresine bağlanacak; işletme Wi-Fi'si şart olmayacak. Mevcut sürümde bu merkezi aktarım katmanı henüz yoktur. Tablet ekranı tarayıcıda çalışır; APK ve kurulabilir PWA henüz üretilmedi.

## Otomatik testler

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:load
```

İlk dört kontrolü sırayla çalıştırmak için `npm run test:all` da kullanılabilir. Tarayıcı testleri bu Windows kurulumunda Chrome kullanır. Ayrı yerel test sunucusu port **3100**'de otomatik açılıp kapanır. Öncesinde `npm run build` gerekir. Test verileri `.local/tests`, `.local/e2e`, `.local/load` altındadır; elle denediğiniz `.local/development` kayıtlarına dokunulmaz.

`npm run test:load` dış adrese istek göndermez; kendi geçici yerel sunucusunu başlatır. Gerçek üretim kapasitesini ölçmez.

## Kayıtlar ve güvenlik sınırı

- İşletme işlem bileşeninin yerel prototipi `server/` altındadır. Veriler `.local/development/merchant.sqlite` içinde şifreli saklanır ve uygulama kapanıp açılınca korunur.
- Geliştirme anahtarı aynı klasördeki `development.key` dosyasındadır. **Veritabanıyla anahtar birlikte ele geçirilirse veriler okunabilir.** Bu model üretim için uçtan uca şifreleme, donanım kasası veya admin kurtarma sistemi değildir.
- Kafedeki masaüstü uygulamasında ham anahtar diskte durmaz: `anahtar.json` içinde Windows kilidi (DPAPI) ve kurtarma koduyla korunur; yedekler kodla yeni bilgisayarda açılır. Ayrıntılar: `docs/GELISTIRICI_REHBERI.md` bölüm 11.
- Anahtarı tek başına silmeyin: kayıtlar açılamaz. Gerçek işletme verisini bu sürüme girmeyin. Çalışma klasörü OneDrive içindedir; `.gitignore` OneDrive eşitlemesini engellemez.
- Bu yerel sunucuyu internete açmayın veya tünelle paylaşmayın. İlk hesaplar demo şifreleriyle oluşturulur; şifreler sonradan değiştirilebilir. `NODE_ENV=production` ile çalıştırma özellikle engellenmiştir. `npm run build` başarılı olması üretim güvenliğinin tamamlandığı anlamına gelmez.
- Arşivler yerel şifreli kayıtta oluşur; yıllık rapor ekranı, SMS/TOTP, kurtarma yetkisi ve merkezi ana panel henüz uygulanmadı.

## Kod düzeni

| Yol | Görevi |
|---|---|
| `packages/domain/` | Fiyat, sipariş durumu, ödeme ve hesap kapatma iş kuralları |
| `server/` | Yerel işletme işlemcisi, API, yetki ve şifreli SQLite saklama |
| `src/` | Müşteri, işletme, mutfak ve garson ekranları |
| `tests/` | İş kuralları, HTTP bütünleşme ve gerçek tarayıcı testleri |
| `scripts/` | İzole tarayıcı test sunucusu ve yerel yük kontrolü |
| `docs/` | Uygulanan kapsam, kararlar ve test planı |

Sorun çözme, yazıcı kurulumu ve hata raporu için: [geliştirici rehberi](docs/GELISTIRICI_REHBERI.md). Ayrıntılar: [satışa hazırlık](docs/SATISA_HAZIRLIK_2026-09-26.md), [test planı](docs/TEST_PLANI.md), [mimari karar](docs/decisions/001-local-development.md).

## Yeni menü düzenleyicisi ve hazırlık süresi

Menü yönetimi → Ürün ekle/Düzenle ekranında kategori seçin. Kahvede Boy/Süt tercihi düğmeleri isteğe bağlı alan ekler. Tatlılarda Sütlü/Şerbetli gibi tür yazabilir, servis tercihleri ekleyebilirsiniz. Fotoğraf seçtikten sonra kırpma önizlemesini ayarlayıp Fotoğrafı kullan ve Kaydet ve yayınla düğmelerini kullanın. İçindekiler ve açıklama ayrı alanlardır.

Ayarlar → Sipariş değişiklik süresi, yeni siparişlerin mutfağa hazırlık için ne zaman açılacağını belirler. Geri sayım dolmadan düğme kullanılamaz. Sıfır saniye yeni siparişlerde beklemeyi kaldırır. Mevcut siparişin daha önce verilmiş süresi korunur.

## Telefon QR'ı, fotoğrafı yeniden düzenleme ve mutfak sesi

`npm run dev:lan` ile çalıştırıldığında QR penceresi bilgisayarın yerel ağ IP adresini kullanır. Eski localhost QR'larını yeniden oluşturun. Aynı ağdaki telefon bu IP'ye erişebilmelidir; güvenlik duvarı veya misafir ağı cihaz izolasyonu erişimi engelleyebilir. Bu yerel testtir; canlı sistemin Wi-Fi zorunluluğu olmayacak.

Fotoğraf yüklendikten sonra **Fotoğrafı düzenle** ile kadraja geri dönebilirsiniz. Yeni yüklemelerin boyutlandırılmış kaynak kopyası saklanır. Eski fotoğrafların yalnızca mevcut kırpımı yeniden düzenlenebilir.

Mutfak sesi varsayılan açıktır. Başlığın yanındaki hoparlör düğmesiyle sessize alınır/açılır; sessize alma aynı sekmenin oturumunda korunur. Tarayıcı otomatik sesi engellerse sarı nokta ve Ses için dokunun bilgisi görünür. İlk etkileşimde veya hoparlöre dokununca ses etkinleşir. Yeni siparişte tek seferlik, üç notalı yükselen zil çalar; eski siparişler ve tekrar sorgular ses üretmez. Ses mutfak ekranı açıkken çalışır; cihaz/sekme sessizdeyse duyulmaz.

Güncel durum ve sıradaki işler: [satışa hazırlık](docs/SATISA_HAZIRLIK_2026-09-26.md). Eski teslim ve test raporları: [docs/arsiv](docs/arsiv/).

## İşletme kurulumu ve çalışan hesapları

- **Satış ve Raporlar:** Yalnızca işletme sahibi çalışan sipariş özetini görebilir. Tarih aralığı Türkiye saatine ve siparişin oluşturulma zamanına göre seçilir. Sipariş sayısı, ürün adedi, sipariş tutarı ve iptal sayısı gösterilir; QR siparişleri ayrı satırdadır. Tahsil edilmiş ciro veya net gelir raporu değildir. Ortak hesabı kullanan kişileri birbirinden ayıramaz; kişi bazında takip için ayrı hesap kullanın.

- **İşletme kurulumu:** İşletme adı, toplam masa sayısı, sipariş değişiklik süresi ve POS komisyonunu üç adımda ayarlayın. Mevcut masa/QR/siparişler korunur; bu ekrandan yalnızca yeni masa eklenir, mevcut masa sayısı azaltılmaz.
- **Çalışanlar:** İşletme sahibi kasiyer, garson veya mutfak hesabı açabilir; yetkiyi değiştirebilir, hesabı kapatıp açabilir ve şifreyi yenileyebilir.
- **Şifrem:** Her çalışan mevcut şifresini doğrulayarak kendi şifresini değiştirebilir. En az 10 karakter gerekir.
- Yetki, etkinlik veya şifre değişiminde önceki oturumlar geçersizleşir. Şifreler salt içeren scrypt özetiyle saklanır; yönetim ekranından okunamaz.
- Eski kayıtlar ilk başlangıçta eklemeli olarak yükseltilir. Öncesindeki şifreli SQLite kopyası `.local/development/backups` altındadır; anahtar dosyası da korunmalıdır. Mevcut demo girişleri ilk geçişte korunur. Sonraki başlangıçlar kapattığınız hesapları veya değiştirdiğiniz şifreleri sıfırlamaz.
- Bu özellikler yerel sürüm içindir. Merkezi işletme sağlama, SMS/TOTP, cihaz/anahtar kasası, kurtarma ve internet yayını hâlâ tamamlanmadı.

### Genel Mali Durum
Satış ve Raporlar iki katlı sekmelidir: üstte dört grup, altında grubun raporları: Satış (Özet, Ürünler, Kârlılık, Kampanyalar), Para (Kasa kapanışları, Giderler, İade ve düzeltme), Personel (Çalışanlar, Personel ve bahşiş) ve Rezervasyon. Hepsi yalnızca işletme sahibine açıktır; son açılan grup ve rapor cihazda hatırlanır. Mali görünümde nakit/kart tahsilatları ödeme tarihine; ürünler ve sipariş tutarı sipariş tarihine göre hesaplanır. Türkiye saati kullanılır; tek sorgu en fazla 366 gündür. Komisyonlar ödeme anındaki kayıtlarından okunur, eksik komisyon sıfır sayılmaz. Tahsilat kâr değildir. Raporlar hâlâ yerel test sürümündedir; rapora özel SMS/TOTP ve merkezi uçtan uca şifreleme tamamlanmamıştır.

### Müşterinin siparişini değiştirmesi
Siparişlerim ekranındaki Siparişi değiştir düğmesi, işletmenin bekleme süresi içinde kullanılabilir. Ürün ekleme/çıkarma, adet ve seçenek değişikliği aynı sipariş üzerinde yapılır. Süre uzamaz ve raporda yeni sipariş sayılmaz. Aynı ürün ve seçeneklerde birim fiyat korunur; yeni ürün/seçenek güncel fiyatla müşterinin onayladığı toplam üzerinden kaydedilir. Tükenen ürünün adedi artırılamaz. Tamamını çıkarmak yerine sipariş iptal akışı kullanılır. Hesaba ödeme girildiğinde değişiklik kapanır. Mutfak güncel içeriği ve değişiklik bilgisini görür. Belirsiz yanıt aynı işlem kimliğiyle tekrar kontrol edilir; sayfa yenilenince taslak kurtarma henüz yoktur.

### Masa taşıma
Masalar ekranından açık masayı seçip Masayı taşı düğmesine basın. İşletme sahibi, kasiyer ve garson yalnızca boş masaya taşıyabilir. Hesap, kısmi ödemeler, siparişler ve fiyatlar korunur. Her iki masanın eski QR oturumları kapanır; müşteri yeni masanın QR kodunu okutarak devam eder. Mutfakta yeni masa adı ve taşıma uyarısı gösterilir. Dolu masaları birleştirme bu işlemden ayrıdır ve henüz yoktur. Sipariş güncelleme ve masa taşıma uyarıları koyu kehribar renkle vurgulanır.

### QR kullanımını ölçme
Satış ve Raporlar → Çalışanlar ekranının üst bölümünde QR sipariş adedi, çalışan üzerinden alınan sipariş adedi, QR yüzdesi, farklı tarayıcı ve masa hesabı sayısı gösterilir. Tarih filtresi uygulanır; iptaller hariçtir. Aynı tarayıcının tekrarlayan siparişleri ayrı sipariş, tek tarayıcı sayılır. Arşiv kopyaları ve sipariş düzenleme çift sayılmaz. Tarayıcı/hesap kimlikleri rapor yanıtında paylaşılmaz. Bu veriler kesin kişi sayısını veya hiç personel yardımı alınmadığını kanıtlamaz. Rapor yalnızca işletme sahibine açıktır; garsonun yeni yetkisi yalnızca masa taşımadır.

### Tek seferlik ilk kurulum
İşletme sahibinin ilk girişinde kurulum tamamlanmadan çalışma paneli açılmaz. Tamamlanınca kurulum ekranı ve menü bağlantısı kalmaz. Aynı başarılı isteğin güvenli tekrarı dışında sunucu ikinci kurulumu reddeder. İşletme adı, logo ve arka plan değişiklikleri merkezi ana panel kapsamındadır; ana panel henüz tamamlanmamıştır. Bekleme süresi/POS komisyonu mevcut Ayarlar ekranında kalır.

### İşletme sahibinin masa yönetimi
Masalar başlığındaki Masa ekle ve Masa çıkar düğmeleri yalnızca işletme sahibine açıktır. Eklenen masa yeni QR ve tekrar kullanılmayan sıra numarası alır. En fazla 100 aktif masa desteklenir; son masa çıkarılamaz. Açık hesap veya tamamlanmamış mutfak işi varsa çıkarma engellenir. Çıkarılan masanın QR kodu ve eski oturumu kullanılamaz; geçmiş hesaplar ve raporlar korunur. Garson masa taşıyabilir, ekleyip çıkaramaz.

### Menü kategorileri
Menü yönetimi → Kategorileri yönet üzerinden işletme sahibi kategori ekleyebilir, adını değiştirebilir, boş kategoriyi silebilir ve yukarı/aşağı düğmeleriyle sıralayabilir. Ad değişikliği mevcut ürünlere uygulanır, geçmiş siparişlere uygulanmaz. Dolu kategori silinmez; ürün düzenlemeden başka kategoriye taşınabilir. Özel kategorilerde ayrıntılar ve seçenekler işletme tarafından eklenir. Müşteri ve garson menüleri belirlenen sırayı kullanır; boş kategoriler müşteri menüsünde gösterilmez. Eski kayıtların kategori listesi ürünlerden türetilir, ilk yönetim işleminde kalıcılaşır.


Yeni ürün eklerken kategori otomatik seçilmez; Kategori seçiniz ile başlar ve zorunludur. Hazır Boy/Süt/Servis alanları ürün başına bir kez eklenir; tekrarında uyarı gösterilir. Alanı kaldırdıktan sonra tekrar ekleyebilirsiniz. Özel alan ekle için tekillik kısıtı yoktur (toplam 8 grup sınırı korunur).


### Mola Merkez ve Mola Yönetim
Satıcının paneli artık kafe sunucusunda değil, ayrı bir süreç olan **Mola Merkez**'dedir: `npm.cmd run merkez:dev` → `http://localhost:4000` (kullanıcı `admin`, ilk şifre `.local/merkez/merkez-first-login.txt`). Kafe sunucusu (`npm.cmd run dev`) lisansını ondan imzalı olarak alır ve yalnız dışarıya bağlanır. İşletme verisi (satış, ödeme, menü, çalışan) Merkez'e gitmez. Yeni kafe ilk açılışta "Mola'yı etkinleştir" der (30 gün deneme ya da Mola Yönetim'den alınan kod). Bölünme öncesi veri klasörleri bir kez `npm.cmd run merkez:import -- <klasör>` ile bağlanır. Ayrıntılar: `docs/GELISTIRICI_REHBERI.md` bölüm 12. SMS/e-posta gönderimi kapalıdır ve ücretli servis satın alınmamıştır.

### Mola Merkez sunucuda (VDS): yedekleri çekmek ve sunucuya bakmak
Merkez'in VDS'e taşınması adım adım `docs/VDS_KURULUM.md`'de (en üstte "Kurulum sırası"; yazdırılabilir hâli `docs/pdf/Mola-VDS-Kurulum-Rehberi.pdf`, `npm.cmd run pdf:vds`). Taşındıktan sonra iki araç sunucuya **yalnız okumak için** bağlanır (Windows'un SSH'ı, sizin anahtarınız; sunucuda `mola-oku` yardımcısı ve `/etc/sudoers.d/mola-okuma` izni):
- `npm run vds:cek`: sunucudaki Mola çalışma klasörünü ve en yeni 14 Merkez yedeğini `C:\MolaCalisma\vds`'e, şifreli yedekleri ayrıca Google Drive'a çeker (çalışma klasörü Drive'a gitmez). İlk kez: `npm run vds:cek -- --kur --host yonetici@<IP>`, sonra parmak izini onaylama. Her gün 07:00 için Görev Zamanlayıcı komutunu `--zamanla` yazar; komutu siz çalıştırırsınız.
- `npm run vds -- <komut>`: `durum`, `kayitlar [--son N] [--hata]`, `caddy`, `hatalar`, `yedek`, `disk`, `sertifika`, `guvenlik`, `ozet`. Sabit komut listesi, serbest komut yok; `--kuru` gönderilecek komutu yalnız yazar.
Kayıtlar: `.local/kayitlar/vds-cek.log`, `.local/kayitlar/vds.log`; ayar: `.local/vds.json`. Sunucuda bir şeyi değiştiren her işlemi sahip kendisi yapar (`docs/VDS_KURULUM.md` bölüm 15, "Claude için").

## Klasör düzeni

| Klasör | İçinde |
|---|---|
| `src/` | Ekranlar (React) |
| `server/` | Kafe sunucusu (Express) |
| `server/merkez/` | Mola Merkez (lisans, etkinleştirme, destek, Mola Yönetim) |
| `packages/domain/` | İş kuralları (sipariş, ödeme, rapor, kampanya…) |
| `tests/` | Birim testleri; `tests/browser/` tarayıcı testleri |
| `scripts/` | Komutlar (kurulum paketi, yedek, örnek veri…); `scripts/desktop/` masaüstü uygulaması |
| `templates/` | Kafe / restoran / tatlıcı hazır menüleri |
| `docs/` | Rehberler; `docs/arsiv/` eski raporlar, `docs/kaynak/` ilk planlama belgeleri (.docx) |
| `brand/` | Logo taslakları |
| `public/` | Simgeler |
| `.local/` | Bu bilgisayarın verileri (git'e girmez): `development/` deneme verin, `ornek-*` örnek işletmeler, `backups/` yedekler, `installer/` kurulum paketleri, `guvenlik-kopyalari/` taşıma öncesi kopyalar, `kayitlar/` eski test kayıtları |
| `_arsiv/` | Kullanılmayan eski dosyalar (silinmedi, buraya taşındı) |
| `dist/`, `test-results/`, `node_modules/` | Otomatik üretilir |
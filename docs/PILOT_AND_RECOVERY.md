# Yerel pilot ve kurtarma

## Yeni işletme açılışı

Ana panelden işletme açıldığında temiz kafe şablonu kullanılır: Kahveler, Çaylar, Soğuk İçecekler, Tatlılar; alt kategoriler ve sekiz örnek ürün. Siparişler, tahsilatlar, çalışanlar ve işlem geçmişi kopyalanmaz. İşletme sahibi hesabı ve masaların QR kimlikleri yeniden oluşturulur. Kurulum tamamlanmadan pilot başlamaz. Örnek fiyatları, ürünleri ve seçenekleri işletmeyle kontrol edin.

Mevcut işletmeler otomatik sıfırlanmaz. Yeniden kullanılabilir menü şablonu `templates/cafe-v1.json` dosyasındadır. Yeni işletme üretimi `server/starter-template.ts` içindeki aynı şablon üreticisini kullanır.

Kurulum sihirbazının ilk adımında işletme türü seçilir (Kafe, Restoran, Tatlıcı / Pastane). Restoran ve tatlıcı seçilirse, menü henüz hiç değiştirilmemişse `server/sector-templates.ts` içindeki başlangıç menüsü yüklenir. Masasız sipariş (tezgâh satışı) her türde ayarsız açıktır; sihirbaz onu sormaz. Okunabilir kopyaları `templates/restaurant-v1.json` ve `templates/dessert-v1.json`; `npm.cmd run template:backup` üçünü de yeniden yazar, `tests/sector.test.ts` dosyalarla kodun aynı kaldığını denetler. Tür daha sonra Ayarlar'dan yalnız etiket olarak değiştirilir; menü yeniden yüklenmez.

## Başlatma

Bu paket yerel pilot içindir; internet sunucusunda üretim yayını değildir. Bilgisayarda Node.js 24+ ve proje bağımlılıkları gerekir. Yeni bilgisayarda proje klasöründe bir kez `npm.cmd ci` ve `npm.cmd run build` çalıştırın.

- Kafe kurulumu artık masaüstü uygulamasıyla yapılır (`npm.cmd run installer`, bkz. `GELISTIRICI_REHBERI.md`). Eski `Pilot-Baslat.cmd` / `Pilot-LAN-Baslat.cmd` dosyaları `_arsiv/2026-10-03/kok` klasörüne taşındı; kaynak koddan çalıştırmak için `npm.cmd run dev` / `dev:lan` kullanılır.
- `npm.cmd run pilot:check`: sürüm, derlenmiş arayüz, şablon ve veri klasörü kontrolü; erişilebilecek yerel ağ adreslerini listeler. Ağın telefon tarafından erişilebilir olduğunu garanti etmez.

Varsayılan veri klasörü `.local/development`, adres `http://localhost:3000`. Sunucuyu terminalde Ctrl+C ile durdurun. Yeni kuruluma mevcut `.local/development` klasörünü taşımayın: bu klasör mevcut işletme verilerinizi içerir. Bağımlılıklar ve Node kurulu değilse bu dosyalar tek başına çevrimdışı USB kurulum paketi değildir.

## Tam şifreli yedek

Sunucuyu kapatın. `npm.cmd run backup -- create .local/development` çalıştırın. Yedek `.local/backups`, ayrı anahtar `.local/backup-keys` altında oluşur. Veri klasörü kilidi aynı anda sunucu/yedek çalışmasını engeller. Beklenmeyen kapanmada `.mola-operation.lock` kalırsa dosyadaki PID'nin artık çalışmadığını doğrulamadan kaldırmayın.

AES-256-GCM ile dosyalar ve dosya listesi şifrelenir. Veritabanı, fotoğraflar, özel fotoğraf kaynakları, geri alınabilir fotoğraf arşivi ve yerel anahtarlar tam yedeğe dahildir. Bu yönetici yedeği tüm işletmeleri kapsar; işletmelere paylaşılacak bir dosya değildir. Yedek anahtarını yedekten ayrı güvenli yerde saklayın. Anahtar kaybolursa yedek açılamaz. Aynı bilgisayardaki iki klasör bilgisayar kaybına karşı koruma sağlamaz.

`npm.cmd run backup -- restore "YEDEK_KLASÖRÜ" "ANAHTAR_DOSYASI"` her seferinde `.local/restored/restore-*` altında yeni klasör oluşturur. Mevcut verilerin üzerine yazmaz. Kimlik doğrulama etiketleri, SHA-256 dosya özetleri, SQLite bütünlüğü ve işletme kayıtlarının şifresinin açılması doğrulanır. Başarısız klasör RESTORE_FAILED.txt ile işaretlenir ve kullanılmamalıdır.

Doğrulanmış geri yüklemeyi incelemek için uygulama kapalıyken PowerShell'de `$env:DATA_DIR = 'DOĞRULANMIŞ_KLASÖR'` ayarlayıp başlatın. İş bitince `Remove-Item Env:DATA_DIR` ile varsayılana dönün. Canlı veriyi değiştirme ayrı bir operatör işlemidir.

Bu yerel depolama/yedek koruması, merkezi sunucuda uçtan uca finansal şifreleme tamamlandı anlamına gelmez.

## Fotoğraf arşivi

Ayarlar → Fotoğraf alanı → Kullanılmayanları arşivle. Yayındaki, gizli ve taslak ürün referansları korunur. Son yedi günde yüklenen dosyalar korunur. Taşıma öncesi kalıcı dosya listesi yazılır; kesintiye uğrayan taşıma da geri alınabilir. Geri al, fotoğrafları eski yollarına döndürür; ürünün fotoğraf seçimini değiştirmez. Kalıcı silme otomatik değildir. Arşiv diskte yer tutar; geri alma etkin alanı kota üzerine çıkarırsa yeni yükleme mevcut kota kontrolünde engellenir.

## Tahsilat düzeltme ve iade

Satış ve Raporlar → Tahsilat kayıtları: masa başlıkları altında tarih filtresi ve masa başına 20 kayıtlık sayfalar. Aktif masalar ve geçmiş kaydı olan kaldırılmış masalar aynı listede görünür. Masa adı/numarasıyla arama yapılabilir. Başlığı açınca tahsilat tarihi, saati, tutarı ve işlem geçmişi görünür; hesabın siparişleri ayrıca açılabilir. Kısmi tahsilatta hesap siparişleri, ödemenin birebir ürün dağılımı olarak sunulmaz. Varsayılan son 30 gündür; özel tarihle geçmiş kayıtlara erişilebilir. Bir sorgu en fazla 366 gündür. Tüm tahsilatlar, işlem yapılanlar ve iade yapılanlar filtreleri bulunur. Tarih ilk tahsilata göre uygulanır; karttaki geçmiş sonraki tarihlerde yapılan iadeleri de içerir. Yalnız işletme sahibi kullanır. Zorunlu gerekçe ve tarihli geçmiş saklanır. Nakit/kart yöntem düzeltmesi ilk kaydı korur ve tahsilat gününün raporunu düzeltir. Kart komisyonu tutar olarak girilir. İadeli kaydın yöntemi değiştirilemez.

İade kısmi/tam olabilir; toplam iade ilk tahsilatı aşamaz. İade, yapıldığı günün kalan tutarından düşülür. Nakit iade nakit kalanından da düşülür. POS komisyonunun bankadan döndüğü varsayılmaz; mevcut komisyon gideri korunur. Kapalı masa yeniden açılmaz; sipariş miktarı/popülerlik ve kampanya kotası geriye alınmaz. Kampanya tahsilatları ve günlük tahsilat grafiği brüttür; iadeler tahsilat özetinde ayrı düşülür. Bu ekran gerçek banka/POS iadesini gerçekleştirmez.

## Authenticator

Ayarlar → Mali rapor güvenliği. Mevcut şifreyle kurulum başlatın; Authenticator uygulamasından QR okutun, altı haneli kodu girin. Kurtarma kodlarını güvenli yerde saklayın; yalnız bir kez gösterilir. Kurulum tamamlanıncaya kadar mevcut rapor erişimi devam eder; tamamlandıktan sonra raporlar ve tahsilat düzeltmeleri sunucuda ikinci doğrulama gerektirir. Doğrulama o oturumda 10 dakika geçerlidir. Kod tekrar kullanılamaz; yeni kodu bekleyin.

Telefon kaybında şifre + kurtarma koduyla koruma sıfırlanır ve yeniden kurulmalıdır. Eski kurtarma kodları geçersizleşir. SMS veya dış servis ücreti yoktur. Sunucu/telefon saatinin doğru olması gerekir. Algoritma testleri [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238) SHA-1 test vektörlerini kapsar.

## Pilot kabulü

Otomatik kontroller: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:e2e`, `npm.cmd run test:load`.

İşletmede ayrıca gerçek Android tablet ve iPhone/Android telefonla QR, ürün fotoğrafı, sipariş, mutfak sesi (ilk dokunma sonrası), kısmi ödeme, servis, bağlantı kopması ve tekrar giriş denenmelidir. Tarayıcı mobil boyut testi gerçek cihaz testinin yerine geçmez. Henüz internet yayını, tek dosyalık bağımsız kurulum ve dış güvenlik denetimi tamamlandı denmez.

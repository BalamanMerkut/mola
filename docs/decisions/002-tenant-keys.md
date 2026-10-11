# İşletme anahtarlarının ayrılması — 26 Eylül 2026

## Uygulanan yerel aşama

Her işletme snapshot verisi bağımsız rastgele 256 bit AES-GCM anahtarıyla şifrelenir. Anahtarlar SQLite tenant_keys tablosunda, development.key ile AES-GCM kullanılarak sarılmış halde durur. İşletme kimliği hem veri hem anahtar kaydının doğrulama bağlamına katılır. Bir işletmenin veri anahtarı diğer işletmenin verisini açmaz. Platform yönetimi ayrı bağlamda mevcut üst anahtarı kullanmaya devam eder.

Bu, merkezi sunucunun veriyi okuyamadığı bir sistem değildir. Üst anahtarı ve veritabanını elde eden kişi işletme anahtarlarını açabilir. Aynı süreç tüm anahtarları açabilmektedir. Anahtarlar henüz işletim sistemi kasasında veya harici KMS'de değildir.

## Geçiş

Eski snapshotların tamamı önce doğrulanır. Veritabanının geçiş öncesi kopyası backups/before-tenant-keys-* altına alınır. Anahtar kayıtları ve yeniden şifrelenen içerikler tek SQLite işleminde kaydedilir. Hata halinde geri alınır. Sonraki açılış aynı anahtarları korur. Yeni şifreli kaydın anahtarı kayıpsa yeni anahtar üretilerek veri ezilmez; açılış başarısız olur.

Yeni işletme oluşturma, profil güncelleme, parola kurtarma ve normal mutasyonlar Store.encode üzerinden aynı biçimi kullanır. Geri yükleme denetimi eski ve yeni biçimi okuyabilir. Tam yedek üst anahtarı da kapsar ve bağımsız yedek anahtarıyla şifrelenir.

## Geri dönüş

Eski uygulama yeni biçimi açamaz. Eski sürüme dönülecekse geçiş öncesi tam yedek ayrı dizine geri yüklenmeli ve eski sürüm o dizine yönlendirilmelidir. Geçişten sonra oluşan yeni siparişler eski yedekte bulunmaz; doğrudan geri dönüş bunları kaybettirir. Canlı klasörün üzerine yazılmaz.

Doğrulama komutu, sunucu kapalıyken önce geri yüklenmiş kopyada çalıştırılır:

`node --import tsx scripts/verify-key-migration.ts <veri-klasörü>`

Komut içeriğin SHA-256 karşılaştırmasını yapar; iş verisini veya anahtarları ekrana yazmaz.

## Sonraki aşama

Veri anahtarlarını açma yetkisini yerel prototip sürecinden işletme bileşenine taşımak; merkezi katalog/yönetim verileri ile özel sipariş-finans verilerini ayırmak; güvenilir cihaz kaydı, taşıma protokolü, anahtar yenileme ve denetlenen kurtarma tasarlamak. Üretim engeli ve gerçek internet yayını beklemeye devam eder.

## Ek, 3 Ekim 2026: üst anahtarın korunması

Masaüstü kurulumunda üst anahtar artık `development.key` dosyasında durmaz. `anahtar.json` içinde iki ayrı kilitle saklanır: bu bilgisayarın kullanıcısı (Windows DPAPI, Mac Keychain; Linux'ta korumasız) ve 24 karakterlik kurtarma kodu (scrypt + AES-256-GCM). Yedekler kendi anahtarlarını içlerinde, üst anahtardan türetilen anahtarla ve kurtarma kaydının kopyasıyla taşır. Ayrıntılar ve geçiş adımları: `docs/GELISTIRICI_REHBERI.md` bölüm 11. Üst anahtar değişmez (yalnız kilitleri yenilenir); anahtar döndürme hâlâ sonraki aşamadadır.

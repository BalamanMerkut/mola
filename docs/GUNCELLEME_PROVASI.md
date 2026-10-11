# Yerel güncelleme ön kontrolü

Bu adım salt okunurdur: yeni paket kodunu çalıştırmaz, veri taşımaz, sunucuyu başlatmaz veya kapatmaz. Otomatik güncelleme ya da veri sürümü uyumluluğu garantisi değildir.

1. Sunucuyu normal şekilde durdurun. Eski uygulama klasörünü saklayın.
2. Güncelleme öncesi şifreli yedek alın; ayrı anahtarla geri yükleme provası yapın (`YEDEK_PROVASI.md`).
3. Yeni paketi eski paketten ve veri klasöründen ayrı bir klasöre açın. Yalnız güvendiğiniz kaynaktan paket kullanın; manifest dijital imza değildir.
4. Bu araç bulunan uygulama klasöründe tam yollarla çalıştırın:

```powershell
npm.cmd run update:check -- "C:/Mola/eski" "C:/Mola/yeni" "C:/Mola/eski/veri"
```

Kontrol iki paketin dosya bütünlüğünü ve derlenmiş arayüzünü, sürüm bilgilerini, mevcut veri/anahtar varlığını, yarım geri yükleme işaretlerini ve işlem kilidini inceler. Aynı veya iç içe paketler reddedilir. Klasör bağlantılarının gerçek hedefleri kullanılır. Hata durumunda kilit silinmez, dosya onarılmaz.

Başarılı sonuç yalnız **ayrı veride güncelleme provası yapılabilir** demektir. Yedek doğrulamasını, boş disk kontrolünü ve gerçek sürüm geçişinde verilerin okunabilir kaldığını ayrıca doğrulamak gerekir. Aynı sürüm numarasına sahip farklı paketler uyarı verir; manifest kimlikleri sonuçta yer alır.

## Geri dönüş kuralı

Yeni uygulama canlı veriyi değiştirdiyse eski uygulamayı aynı veri üzerinde başlatmayın. Eski uygulama ile güncelleme öncesi yedeğin **ayrı klasöre doğrulanmış geri yüklemesini** kullanın. Bu yedekten sonra alınan siparişler ve tahsilatlar o kopyada bulunmaz; farklar değerlendirilmeden hizmete açmayın. Mevcut veri klasörünü silmeyin veya üzerine yazmayın.

Sürüm uyumluluk politikası, gerçek geçiş/geri dönüş provası ve otomatik geçiş henüz tamamlanmadı. Araç çıktısı üretim onayı değildir.

## Geliştirici için otomatik paketler arası prova

```powershell
npm.cmd run test:update -- <güvenilen-eski-yerel-paket>
```

Yalnız geliştirici çalışma klasöründe çalışır. Belirtilen eski paketin kodunu çalıştırdığı için yalnız kendinizin ürettiği, güvendiğiniz paketi seçin. Manifest tek başına güven kanıtı değildir. Komut güncel paketi üretir; eski pakette sıfırdan ayrı test işletmesi, menü, sipariş, kısmi nakit tahsilat ve destek kaydı oluşturur. Mevcut işletme veri yolu kabul etmez.

Şifreli yedeği yeni pakete ayrı klasörde geri yükler, hesapları ve kayıtları doğrular, tahsilat tekrarının ikinci kez yazılmadığını kontrol eder. Ardından eski yedeği başka klasöre geri yükleyip eski pakette aynı kayıtları doğrular. Yeni pakette eklenen destek kaydının eski yedekte bulunmadığı da kontrol edilir. Kaynak ve yeni veri kopyaları silinmez veya üzerlerine yazılmaz.

Başarılı sonuç `.local/tests/update-rehearsal-*/result.json` dosyasına yazılır. Test klasörleri deneme hesapları, anahtarlar ve açılmış test verileri içerir; paylaşılmamalıdır. Bu komut otomatik canlı güncelleme değildir. 28 Eylül provası aynı 0.1.0 sürüm numaralı iki farklı paketle geçti; gerçek şema değişikliği veya tüm finansal senaryolar için uyumluluk kanıtı değildir.

## Veri biçimi sürümü

28 Eylül itibarıyla yeni uygulama SQLite `user_version` alanını denetler. Eski işaretsiz veriler 0 kabul edilir; mevcut geçişler başarıyla tamamlandığında 1 olarak işaretlenir. Desteklenmeyen daha yeni veya geçersiz sürüm, şema/günlük değişikliklerinden önce reddedilir. Yedek doğrulaması da desteklenmeyen biçimi reddeder. Sürüm numarası elle düşürülmemelidir.

Bu korumayı içermeyen eski paketler geriye dönük olarak engellenemez; eski paket hâlâ yalnız güncelleme öncesi yedeğin ayrı geri yüklemesiyle çalıştırılmalıdır. Bu işaret dijital imza veya tüm veri geçişlerinin doğruluğuna dair garanti değildir. Gelecekte biçim değişikliğinde sürüm yükseltme ve ayrı geçiş testi gereklidir.

### Aday paketin veri bildirimi

Yeni paketler `packages/domain/data-format.json` içinde okunabilen en küçük/en büyük biçimi ve yazılan sürümü bildirir. Dosya manifest kapsamındadır; çalışma zamanı da aynı tanımı kullanır. `update:check` aday kodu çalıştırmadan bu bildirimi okur ve veritabanını salt okunur açıp sürüm aralığını karşılaştırır. Yeni adayın bildirimi eksik, geçersiz veya manifest dışında ise kontrol reddedilir. Önceki pakette bildirimin olmaması tarihsel paketlerin prova kaynağı olmasını engellemez.

Aralığın tutması yalnız bir ön koşuldur; geçişin mantıksal doğruluğu, yedek ve gerçek iş akışları ayrıca test edilmelidir. Manifest yayıncı imzası değildir.

## Kurulum kontrolünü rapor dosyasına kaydetme

Sunucu kapalıyken DATA_DIR, PORT ve BACKUP_DIR değerlerini doğru işletme/hedef için ayarlayın:

```powershell
npm.cmd run pilot:check -- --report "kontrol-2026-09-28.json"
```

Var olan raporun üzerine yazılmaz; her kontrol için yeni dosya adı seçin. Üst klasör önceden bulunmalıdır. Başarısız kontrol de raporlanır ve komut başarısız çıkış kodu verir. Dosyada kontrol zamanı, veritabanı sürümü/bütünlüğü, paket, disk, port ve yedek güncelliği sonuçları bulunur. Şifre veya satış kaydı yazılmaz.

Mevcut veritabanı salt okunur kontrol edilir; kurulum kontrolü sürüm yükseltmez. İşlem kilidi veya yarım geri yükleme varsa veritabanı incelemesi atlanır ve diğer hata bilgileri korunur. SQLite bütünlüğü doğrulaması şifreli kayıtların anahtarla açıldığını kanıtlamaz; bunun için ayrı yedek doğrulaması gerekir. Yedek tarihi seçilen BACKUP_DIR altındaki tamamlanma kayıtlarından gelir; bu tek başına ilgili işletmenin geri yüklenebilir yedeğinin kanıtı değildir.


## Kısa Türkçe kurulum özeti

`npm.cmd run pilot:check -- --summary` komutu sonucu, veri klasörünü, paket/veritabanı kontrolünü, giderilecek sorunları ve uyarıları ayrı başlıklarda gösterir. `--report <yeni-json-dosyası>` ile birlikte kullanılabilir; rapor yine teknik JSON biçimindedir. Parametresiz komutun JSON çıktısı korunur. Yeni yerel paket başlatıcısı bu özeti kullanır; başarısız kontrolde sunucuyu başlatmaz ve hata okunabilsin diye tuş bekler.

# Toplu doğrulama — 30 Eylül 2026

`npm.cmd run test:all` başarıyla tamamlandı.

- TypeScript tip kontrolü ve üretim derlemesi başarılı.
- 176 birim/API testi geçti.
- 36 ayrı tarayıcı grubu, toplam 74 senaryo geçti.
- Yerel pilot paket doğrulaması başarılı: dosya bütünlüğü, özel verilerin dışlanması, temiz kurulum, ana panel yetkisi, işletme oluşturma ve yeniden başlatmada veri koruma.

## Güncel yerel pilot paketi

`C:\Users\yesbo\OneDrive\Masaüstü\kafe uygulama\.local\packages\mola-pilot-1790759981814-bd88b966`

Bu paket yerel test içindir; kaynak kod ve Node.js bağımlılığı içerir. Bu doğrulama gerçek cihaz/saha testinin veya internete açık dağıtım onayının yerine geçmez. Güncel kalan işler `SATISA_HAZIRLIK_2026-09-26.md` belgesinde listelenmiştir.

Test günlüğü: `.local/regression-2026-09-30.log`. Mevcut geliştirme işletmesinin verileri testlerde kullanılmadı.

## Güncelleme, HTTPS ve eşzamanlı sipariş ek doğrulaması

- `test:update`: 29 Eylül paketinden güncel pakete şifreli yedek üzerinden ayrı klasörde geçiş ve eski paket/eski yedekle geri dönüş başarılı. İşletme, ürün, sipariş, kısmi tahsilat, kalan bakiye ve destek kayıtları kontrol edildi. Eski tahsilat isteğinin tekrarı ek tahsilat üretmedi. Kaynak veri değişmedi.
- Prova sonucu: `C:\Users\yesbo\OneDrive\Masaüstü\kafe uygulama\.local\tests\update-rehearsal-xBbQvB\result.json`
- Provanın oluşturduğu aday paket: `C:\Users\yesbo\OneDrive\Masaüstü\kafe uygulama\.local\packages\mola-pilot-1790761962769-857e82b3`
- `test:https`: Yerel sertifika ile güvenilir TLS bağlantısı, güvenilmeyen sertifikanın reddi, Origin kontrolü, Secure/HttpOnly/SameSite çerez ve HTTPS QR adresi doğrulandı. Gerçek telefonun sertifikaya güvenmesi bu testin kapsamı değildir.
- `test:load`: 20 eşzamanlı misafir, 180 istek, 80 kabul edilen sipariş, 0 başarısız istek. Bu çalıştırmada toplam 475 ms, p50 43 ms, p95 88 ms. Yerel kısa testtir; internet/VDS kapasitesi veya uzun süreli yük garantisi değildir.
- Güncelleme provası aynı veri biçimini kullanan iki yerel paket içindir; gelecekteki şema değişikliklerini kanıtlamaz. Geri dönüş kopyası yalnız yedek tarihine kadar olan kayıtları içerir.

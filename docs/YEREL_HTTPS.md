# Yerel HTTPS testi

VDS, alan adı veya ücretli hizmet gerekmez. Mevcut `http://localhost:3000` sunucusu ve verileri korunur. HTTPS ortamı ayrı `.local/https-test-data` demo verisi kullanır. Bu veride yapılan siparişler mevcut işletme ekranına yansımaz.

## Bu bilgisayarda hazırlanan ortam

- Adres: `https://192.168.1.103:3443`
- Başlatma: `npm.cmd run dev:https`
- Bağlantı denetimi: `npm.cmd run test:https` (ayrı test verisi ve 3444 portu)
- Sertifika klasörü: `.local/https`
- Cihaza aktarılacak dosya: `.local/https/Mola-Local-Test-CA.cer`

Sunucu başlatıcısı derlenmiş `dist` arayüzünü kullanır. Arayüz değişikliğinden sonra `npm.cmd run build` çalıştırın. Backend değişirse HTTPS sunucusunu yeniden başlatın. Çıkmak için başlatıldığı terminalde Ctrl+C kullanın.

## Telefon ve tablet

1. Bilgisayar ve cihaz aynı güvenilir yerel ağda olmalı. Bu yalnız geliştirme testi içindir; gerçek müşterinin Wi-Fi'ye katılması ürün şartı değildir.
2. Yalnız `Mola-Local-Test-CA.cer` dosyasını kendi test cihazına aktarın. `server-key.pem` özel anahtardır, paylaşılmaz.
3. Cihazın sertifika yönetiminden bu yerel test CA sertifikasına güven verin. iPhone/iPad'de profil kurulumu sonrasında sertifika için tam güven ayrıca gerekebilir; Android'de menü adı üreticiye göre değişebilir. Windows'ta yalnız kendi kullanıcınızın güvenilir kök sertifikaları bölümüne kurulabilir. Sistem çapında otomatik güven değişikliği yapılmadı.
4. Yukarıdaki HTTPS adresini açın. Sertifika uyarısını atlamak güvenilir HTTPS testi sayılmaz; uyarısız açılması gerekir.
5. İşletme demo hesabıyla kurulumu tamamlayın, ardından Mutfak hesabında ses ve ekran simgelerini deneyin. QR bağlantıları bu HTTPS adresini kullanır.
6. Test bittiğinde cihazdan “Mola Local Test CA” sertifikasının güvenini kaldırabilirsiniz.

Bağlantı hiç açılmazsa Windows güvenlik duvarı, ağın özel ağ olması ve modem istemci izolasyonu kontrol edilir. Güvenlik duvarı kapatılmaz; gerekirse yalnız özel yerel ağdan TCP 3443 için dar kapsamlı izin verilir. Bu geliştirmede güvenlik duvarı veya modem ayarı değiştirilmedi, internete port yönlendirilmedi.

## IP veya süre değişimi

Sertifikalar 90 gün geçerlidir. Bilgisayarın IP adresi değişirse başlatıcı bunu bildirir. PowerShell 7 ile yeni, boş bir klasörde sertifika üretin. Windows ile gelen eski PowerShell (5.1) bu betiği çalıştıramaz; PowerShell 7 yoksa önce `winget install Microsoft.PowerShell` ile kurun.

```powershell
pwsh ./scripts/local-https-cert.ps1 -Address 192.168.1.103 -OutputDirectory .local/https-yeni
$env:HTTPS_CERT_DIR = '.local/https-yeni'
npm.cmd run dev:https
```

Address değerini bilgisayarın güncel yerel IPv4 adresiyle değiştirin. Yeni CA sertifikasını test cihazlarında yeniden tanıtın. Mevcut klasörün üzerine yazılmaz. CA'nın özel imzalama anahtarı diske kaydedilmez; yalnız sunucu özel anahtarı saklanır. Sertifikalar pilot paketine dahil edilmez.

## Doğrulananlar ve sınırlar

Gerçek TLS üzerinden güvenilir CA ile bağlantı, güvenilmeyen sertifikanın reddi, yanlış/eksik Origin reddi, Secure/HttpOnly/SameSite çerezleri ve HTTPS QR adresi doğrulandı. 148 birim/API testi ve tip kontrolü geçti. Telefonun sertifika kurulumu, fiziksel uyku davranışı ve mobil tarayıcıdaki güvenli bağlam henüz cihaz üzerinde doğrulanmadı. Üretim başlatma engeli korunur.

Kaynaklar: [Node.js HTTPS](https://nodejs.org/api/https.html), [Microsoft CertificateRequest](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.x509certificates.certificaterequest).

## Başlatma kontrolleri
Başlatıcı veri klasörünü açmadan sertifika ve özel anahtar eşleşmesini, test CA imzasını, IP eşleşmesini ve sertifika tarihlerini kontrol eder. Süre dolduysa veya IP değiştiyse açık hata verir; yedi gün kala uyarır. Süre bilgisi config.json yerine sertifikanın kendisinden okunur. Eksik derlenmiş arayüzde build komutunu belirtir. Gerçek cihazda güven tanımlama adımı yine gereklidir.

# Karar 001 — Yerel çalışan ilk dilim

Durum: geliştirme kararı; üretim mimarisinin yerine geçmez.

## Neden

Kullanıcı iki Word belgesine göre kodlamaya başlamayı ve müşterilere sunmadan önce kapsamlı denemeyi istedi. İlk dilim, sahte verilerle sipariş → mutfak → ödeme → masa yenileme akışını somutlaştırır. Dış servis, SMS sağlayıcısı, ücretli barındırma veya gerçek işletme kurulumu gerektirmez.

## Teknoloji

React + TypeScript müşteri ve çalışan arayüzünde ortak bileşenler sağlar. Node 24 ve Express yerel işlem bileşenini yürütür. İş kuralları `packages/domain` içinde taşınabilir tutulur. Node'un SQLite modülü disk kalıcılığı sağlar; mevcut Node sürümünde deneysel uyarısı verir. Sürümler `package-lock.json` içinde kilitlidir.

Bu aşamada üretim PostgreSQL, Electron/Tauri veya merkezi kuyruk seçimi yapılmış sayılmaz. Masaüstü paketleme ve güvenli işletme anahtarı deposu G03'te değerlendirilecek.

## Güven sınırı

Yerel Node işlemi işletme işlemcisinin prototipidir. Merkezi SaaS sunucusu değildir. Bellekte sipariş/finans verilerini açık işler; diske AES-256-GCM ile kimlik doğrulamalı şifreli paket yazar. İşletme kimliği şifreli paketin bağlamına dahil edilir; paket başka işletmede açılamaz. Anahtar dosyası geliştirme içindir, aynı makineden anahtar ve verinin birlikte çalınmasını engellemez.

Hedef üretim modelinde müşteri merkezden menüyü alır; sipariş içeriği yetkili işletme işlemcisine şifreli taşınır. İşletme bilgisayarı merkeze dışarı doğru bağlanır. Bu aktarım, web koduna güven, anahtar dağıtımı/kurtarma ve cihaz güvenliği çözülmeden gerçek finans verisiyle pilot yapılmaz.

## Tekrarlanan işlem ve para

Para kuruş tamsayısıdır. İstemcinin toplamına güvenilmez; ürün/seçenek fiyatı yerel işlemcide yeniden hesaplanır. Kabul anındaki isim/kod/fiyat saklanır. Sipariş ve ödeme işlem kimliğiyle tekrarlandığında aynı sonuç döner. Aynı anahtar farklı içerikte reddedilir. Hesap sürümü, eşzamanlı tahsilat çakışmasını yakalar. Sonuç ile durum aynı disk işleminde kaydolur.

## Sonuçlar

Windows'ta kurulabilir bağımsız işletme uygulaması henüz yoktur; tarayıcıdan gösterilen geliştirme arayüzü vardır. Gerçek internet kesintisini destekleyen LAN/offline mod yoktur. `dev:lan` sadece test cihazlarını bu bilgisayara bağlar. Üretim sunucusu gibi kullanımı engellemek için `NODE_ENV=production` başlangıcı reddedilir.

Ürün kodu ve tablet ekranı, kullanıcının son sorularını deneyebilmesi için bu örneğe dahil edildi; ayrı mobil uygulama mağazası dağıtımı veya üyelik sistemi eklenmedi.

## Teknik başvuru kaynakları

- [Vite — geliştirme sunucusu ve ağ erişimi](https://vite.dev/config/server-options)
- [Node.js 24 — SQLite](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html)
- [Playwright — test sunucusu](https://playwright.dev/docs/test-webserver)

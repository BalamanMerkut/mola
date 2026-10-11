# HTTPS test hazırlığı

Bu değişiklik üretim yayını açmaz. `NODE_ENV=production` engeli devam eder. Mevcut localhost ve güvenilir LAN testleri varsayılan ayarlarla çalışır.

## Hazırlanan davranış

`PUBLIC_ORIGIN=https://pilot.example.com` ile sabit dış adres tanımlanabilir. Kök HTTPS adresi zorunludur; kullanıcı bilgisi, alt yol, sorgu veya fragment kabul edilmez. Bu modda API yalnız HTTPS olarak doğrulanan istekleri kabul eder. Yazma isteklerinde Origin zorunludur ve tanımlanan adresle birebir eşleşmelidir. Oturum açma ve silme çerezleri Secure, HttpOnly ve SameSite=Strict kullanır.

Başlatıcı HTTP dinlediğinden bu test düzeni aynı bilgisayarda TLS sonlandıran reverse proxy gerektirir: `TRUST_LOCAL_PROXY=1`, `SERVE_BUILD=1`, loopback dinleme. `--lan` ile birlikte açılamaz. Tüm proxy adreslerine güven verilmez. Varsayılan modda istemcinin X-Forwarded-Proto başlığı dikkate alınmaz.

Proxy, istemciden gelen X-Forwarded-Proto/Host/For başlıklarını silip kendi doğruladığı değerlerle değiştirmeli; uygulama portu internete açılmamalı. Loopback üzerindeki diğer yerel süreçler bu güven sınırının içindedir. Yalnız yapılandırma ve HTTP testleri tamamlandı; gerçek TLS sertifikası, reverse proxy ve uzak tarayıcı denemesi yapılmadı.

Kaynak: [Express — reverse proxy arkasında çalışma](https://expressjs.com/en/guide/behind-proxies/).

## Sonraki doğrulama

Barındırma seçilince HTTPS testi ayrı ortamda yapılmalı: sertifika, HTTP yönlendirme, yanlış alan adı, proxy başlık temizliği, güvenli çerezlerin tarayıcıda saklanması ve QR üzerinden telefon girişi. MFA/mali anahtar ayrımı ve diğer üretim engelleri ayrıca tamamlanmalı. Bu doküman ücretli sunucu veya alan adı satın alma talimatı değildir.

# Toplu doğrulama — 28 Eylül 2026

`npm.cmd run test:all` baştan sona başarılı tamamlandı.

- Tip kontrolü ve üretim derlemesi geçti.
- 160 birim/API testi geçti; başarısız veya atlanan test yok.
- 29 ayrı tarayıcı grubunda 60 senaryo geçti. Gruplar ayrı sunucu ve test verisi kullandı.
- Temiz pilot paket provası geçti: `.local/packages/mola-pilot-1790568097177-243e80e4`.
- Canlı işletme verileri değiştirilmedi; ücretli hizmet veya internet dağıtımı yapılmadı.

## Doğrulanan akışlar

QR siparişi, mutfak, garson onayı, önce ödeme, ürün seçerek kısmi tahsilat, masa birleştirme, gider ve iade; yanıt kaybından sonra sipariş/iptal/değişiklik/ödeme kurtarma; menü, fotoğraf, kategori, taslak ve kampanya sınırları; raporların kaydırma konumu; ana panel işletme/lisans sıralaması, deneme ve abonelik; destek yanıtının yanlışlıkla silinmesini önleme ve güvenli tekrar; hesap kurtarma ve iki adımlı giriş.

## Menü editörü ölçümü

Chrome 4 kat işlemci yavaşlatması, 96 seçenek ve 40 yazı örneğinde girişten görüntü karesine medyan 3 ms, yüzde 95 değeri 7 ms ölçüldü. Script 120 ms, task 827 ms, layout 26 ms. Yerel kısa ölçümdür; gerçek telefon veya uzun süreli saha yükünü temsil etmez.

## Paket provası

Dosya bütünlüğü, özel verilerin paket dışında kalması, SPA ve JavaScript erişimi, demo hesapsız başlangıç, yetkisiz ana panel erişiminin reddi, işletme oluşturma ve yeniden başlatmada işletme/yönetici bilgilerinin korunması doğrulandı. Değişmiş paket dosyasının açılışı engellemesi de kontrol edildi. Prova mevcut bilgisayarın Node ve bağımlılıklarını kullanır; temiz Windows kurulumu veya imzalı güncelleme değildir.

## Satış öncesi kalanlar

- Merkezi yönetim ile işletme işlemcisinin ve mali anahtar yetkisinin ayrılması; mevcut yapı E2E değildir.
- Gerçek Android/iPhone/tablette yerel HTTPS, QR, ses ve uyku davranışlarının doğrulanması. Ses/ekran kilidi otomatik testleri fiziksel cihaz testi yerine geçmez.
- Güvenilir kurulum, sürüm güncelleme ve geri dönüş akışı.
- Harici disk üzerinde yedek/geri yükleme provası, zamanlama ve işletim takibi.
- Bir işletmede kontrollü saha pilotu.

Yerel test başarısı üretim onayı değildir; üretim başlatma engeli korunur. Güncel liste: `SATISA_HAZIRLIK_2026-09-26.md`.

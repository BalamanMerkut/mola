# Toplu doğrulama — 26 Eylül 2026

## Sonuç

- Tip kontrolü ve arayüz derlemesi başarılı.
- 142 birim/API testi başarılı.
- 25 ayrı tarayıcı paketi, toplam 54 senaryo başarılı. Her paket ayrı test verisi ve sunucuyla çalıştı.
- Güncel 37 dosyalık işletme yedeği ayrı klasöre doğrulanarak geri yüklendi.

Tarayıcı kapsamı: müşteri siparişi/değiştirme/iptal, mutfak ve bekleme süresi, önce ödeme, garson onayı, kısmi tahsilat ve iade, kayıp yanıttan kurtarma, masa işlemleri, taslaklar/fotoğraflar/menü, kampanyalar, rapor kaydırma, personel, ana panel lisans/deneme/güvenlik, destek ve demo entegrasyonlar. Demo entegrasyon testi gerçek sağlayıcı bağlantısını doğrulamaz.

## Yerel yük provası

20 eşzamanlı müşteri, 180 ölçülen HTTP isteği, 80 kabul edilen sipariş; hata 0. Tek masa hesabı korundu. Ölçülen toplam süre 517 ms, medyan 48 ms, yüzde 95 gecikme 88 ms. Test izole veri kullandı; aynı bilgisayardaki başka işler sonucu etkileyebilir. Bu kısa prova gerçek sunucu kapasitesi, uzun süreli yük veya internet gecikmesi ölçümü değildir.

## Menü editörü

Chrome işlemci yavaşlatma katsayısı 4, 96 seçenek, 40 örnek. Girişten görüntü karesine ölçülen medyan 4 ms; yüzde 95 değeri 8 ms. Script 118 ms, task 865 ms, layout 29 ms. Gerçek düşük donanımlı telefon ölçümü yerine geçmez.

## Yedek ve sınırlar

Yedek: `.local/backups/backup-2026-09-26T20-17-28-140Z-133c5697`.
Doğrulanmış kopya: `.local/restored/restore-zohOR7`.
Anahtar ayrı `backup-keys` dizininde; içerikler burada yayımlanmaz.

Satış öncesi açık ana işler değişmedi: merkezi mimari ve mali anahtar yetkileri, gerçek HTTPS ortamı, güvenilir Windows dağıtım/güncelleme, harici yedek/izleme ve saha pilotu. Bu sonuç üretim onayı değildir. Güncel öncelik listesi `SATISA_HAZIRLIK_2026-09-26.md` içindedir.

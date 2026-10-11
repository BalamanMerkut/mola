# Toplu doğrulama — 27 Eylül 2026

`npm.cmd run test:all` baştan sona başarılı tamamlandı.

- Tip kontrolü ve derleme başarılı.
- 148 birim/API testi geçti; başarısız veya atlanan test yok.
- 28 ayrı tarayıcı grubunda 59 senaryo geçti. Her grup ayrı sunucu ve veri klasörü kullandı.
- Bu çalışmada uygulama hatası saptanmadı; testleri geçirmek için kod değişikliği gerekmedi.

## Kapsam

QR siparişi, değişiklik ve iptal; kayıp yanıt sonrası güvenli tekrar; garson onayı; önce ödeme ve sonra hazırlama; ürün seçerek kısmi tahsilat; kapalı hesabın tahsilatını kurtarma; masa birleştirme; giderler ve iadeler; menü, taslak, fotoğraf, kategori ve kampanyalar; raporların kaydırma konumunu koruma; destek; lisans/deneme; işletme profil yönetimi; hesap kurtarma ve ana panel iki adımlı giriş kontrol edildi.

Yeni mutfak kontrollerinde bilgi balonları, dar ekran yerleşimi, ekran kilidi isteğini iptal etme, geç yanıtı bırakma ve sekmeye dönüşte sesin sessiz tercihini koruması da test edildi. Ekran kilidi/ses yaşam döngüsü testleri kontrollü tarayıcı API taklitleri kullanır; gerçek cihazın fiziksel uyku davranışını kanıtlamaz. Demo entegrasyon testleri gerçek dış sağlayıcı bağlantısı değildir.

## Menü editörü ölçümü

Chrome 4 kat işlemci yavaşlatması, 96 seçenekli ürün, 40 yazı örneği: girişten görüntü karesine medyan 6 ms, yüzde 95 değeri 10 ms. Script 173 ms, task 1333 ms, layout 39 ms. Bunlar bu bilgisayardaki kısa ölçümlerdir; gerçek telefon veya uzun süreli yük ölçümü değildir. Bu tur ayrı yük provası tekrar çalıştırılmadı.

## Satışa hazırlık sınırı

Yerel kapsamın toplu testleri geçti. Gerçek HTTPS ortamı, merkezi mimari ve mali anahtar yetkisi ayrımı, güvenilir Windows dağıtım/güncelleme, harici yedekleme ve gerçek cihaz/kafe pilotu hâlâ açık. Üretim başlatma engeli korunur. Ayrıntılı liste: `SATISA_HAZIRLIK_2026-09-26.md`.

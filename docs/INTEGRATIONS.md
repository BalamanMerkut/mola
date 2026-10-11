# Entegrasyon deneme altyapısı

25 Eylül 2026

İşletme sahibine özel Entegrasyonlar sekmesi eklendi. Sağlayıcı kartları canlı bağlantı değildir. API anahtarı alınmaz; dış servise istek/ücretli işlem yapılmaz.

Yerel örnek siparişler ayrı integrationDemo kaydında, mevcut şifreli depoda saklanır. Sabit örnek ürünler kullanılır. Masalar, mutfak üretimi, tahsilatlar, kampanya kotası ve finansal raporlar etkilenmez. Hazırlama, hazır, teslim ve iptal geçişleri sahibi yetkisi, sürüm ve işlem kimliğiyle korunur. En fazla 100 örnek tutulur. Yenileme sonrası kayıtlar görülebilir; bekleyen gönderim aynı sekmede yenileme sonrası geri açılır. İşletme/çalışan bağlamı sunucuda doğrulanır. sessionStorage kullanılır; sekme kapatma veya tarayıcı verisi silme sonrasında kurtarma garanti edilmez. Tarayıcı kayıt alanına erişilemiyorsa kullanıcı uyarılır.

121 birim/API testi ve mobil entegrasyon tarayıcı senaryosu geçti. Gerçek sağlayıcı adaptörleri, menü eşleştirme, doğrulanmış bildirim alımı, gerçek paket mutfak kuyruğu ve finansal entegrasyon sonraki aşamadır. Test erişimi ve güncel restoran dokümantasyonu alınmadan platform bağlantısı hazır kabul edilmez.

Gönderim kurtarma: sunucu kaydı sonrası yanıt kesilmesi, sayfa yenileme, aynı isteğin tekrarı ve yanlış hesap bağlamı tarayıcı testinde doğrulandı. Normal deneme akışı ayrı test verisiyle geçti.

## 4 Ekim 2026: gerçek altyapı

Bu deneme alanının yerini adaptör altyapısı ve Mola içindeki Deneme platformu aldı (Entegrasyonlar sayfası, Onay bekliyor kartları, mutfakta platform etiketi, Platform ödemesi, rapor kanalları). Ayrıntı ve gerçek platform bağlama adımları: GELISTIRICI_REHBERI.md bölüm 13. Eski demo ekranı ve testleri `_arsiv/2026-10-04-entegrasyon-demosu/`.

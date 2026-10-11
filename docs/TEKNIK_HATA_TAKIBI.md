# Teknik hata takibi

API her isteğe sunucuda rastgele bir takip kimliği üretir ve `X-Request-Id` başlığıyla döndürür. Hata yanıtında aynı değer `requestId` alanında bulunur. Bu değer siparişin tekrar gönderimini önleyen işlem kimliğinden farklıdır; her HTTP denemesinde yenilenir.

Beklenmeyen sunucu hatalarında yalnız şu alanlar standart hata çıktısına yazılır: olay adı, takip kimliği, HTTP yöntemi, kodda tanımlanmış rota kalıbı, HTTP durumu, hata kodu, geçen süre. URL sorgusu, istek gövdesi, çerezler, şifreler, finansal değerler, hata mesajı ve stack yazılmaz. Gelen istemci takip başlığı güvenilerek kullanılmaz.

Bozuk JSON 400/INVALID_JSON; boyut sınırını aşan içerik 413/PAYLOAD_TOO_LARGE döndürür. Uygulama içindeki beklenmeyen SyntaxError kullanıcı hatası gibi gösterilmez; 500 olarak kaydedilir. Log yazımı başarısız olsa da HTTP yanıtı değişmez.

Bu aşamada kalıcı log arşivi, harici hata takip sağlayıcısı, alarm ve ana panelde teknik log ekranı yoktur. Takip kimliği API yanıtında bulunur; mevcut arayüzlerde otomatik destek bileti açılmaz. Kalıcı kayıt ve saklama süreleri merkezi dağıtım sırasında ayrıca belirlenmelidir.

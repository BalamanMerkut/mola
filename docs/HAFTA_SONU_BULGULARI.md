# Hafta sonu testi: bulgular ve bekleyen işler

Sahip testten sonra bulgularını toplu gönderecek; hepsi tek turda düzeltilecek. Bu dosya o turun başlangıç listesidir.

## Testten önce not edilenler

1. **Telefondan ürün fotoğrafı yüklenemiyor (11 Ekim).** Menü yönetimi'nde telefonla çekilen fotoğraf "Kaynak fotoğraf çok büyük" hatası veriyor. Neden: kırpmayı sonradan yeniden ayarlamak için gönderilen asıl fotoğrafın sınırı 4 MB (`server/photos.ts`), telefon fotoğrafları 3-8 MB ve üstü. Çözüm: fotoğrafı göndermeden önce telefonda en fazla 2048 piksele küçültmek (canvas, JPEG/WebP ~0,85); iPhone HEIC ve yön (EXIF) düzeltmesi; sunucu sınırları aynen kalır. 12 MP ve 48 MP fotoğrafla denenecek.

## Sahibin gönderdiği bulgular

(Test sonrası buraya eklenecek.)

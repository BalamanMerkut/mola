# Ev ağı provası — VDS'ten önce, evdeki bilgisayarla

Amaç: VDS'e geçmeden önce bütün yolu evde denemek. **Sizin bilgisayarınız ve ev modeminiz "VDS" olur.** Aynı Wi-Fi'deki arkadaşlarınız kendi dizüstü bilgisayarlarından ve telefonlarından web sitesini açar, Mola'yı indirip kurar, **"Kodum yok, başvuru yapacağım"** ile başvurur; siz kendi **Mola Yönetim**'inizden onaylarsınız, arkadaşınızın Mola'sı 30 günlük denemeyle açılır.

Bu prova yalnız **ev ağında** çalışır (internete açılmaz). Sistem ayarlarınızı betik değiştirmez: güvenlik duvarı sorularını Windows size sorar, siz cevaplarsınız.

## Ne gerekir?

- Bu bilgisayarda kurulu ve açık **Mola Yönetim** (Mola Merkez onunla birlikte çalışır).
- Kaynak klasörü (`kafe uygulama`) ve `npm.cmd` (her zamanki gibi).
- Arkadaşlar **aynı Wi-Fi'de** olmalı. Misafir ağı (guest Wi-Fi) çoğu modemde cihazları birbirinden ayırır: orada çalışmaz.
- Tavsiye: modemin ayarlarından bu bilgisayara **sabit IP** verin (adres değişirse kurulan kafeler Merkez'i bulamaz).

## 1. Bilgisayarın ev ağındaki adresini öğrenin

Betik adresi kendisi bulur. Emin olmak için PowerShell'de `ipconfig` → Wi-Fi ya da Ethernet bölümündeki **IPv4 Adresi** (ör. `192.168.1.20`).

## 2. Mola Yönetim'i ev ağına açın (MERKEZ_LAN)

Arkadaşlarınızın Mola'sı başvuruyu Mola Merkez'e gönderir; Merkez bunun için ev ağından erişilebilir olmalı.

1. Dosya Gezgini'nin adres çubuğuna `%LOCALAPPDATA%\Mola Yonetim` yazıp Enter'a basın.
2. Orada **`ayarlar.cmd`** adlı bir dosya var mı bakın. Yoksa: sağ tık → Yeni → Metin Belgesi, adını `ayarlar.cmd` yapın ("uzantı değişsin mi?" → Evet). Not Defteri ile açın.
3. İçine şu satırı ekleyin, kaydedin:
   ```
   set MERKEZ_LAN=1
   ```
4. **"Mola Yönetim Kurulum.exe"yi yeniden çalıştırın** (verileriniz korunur). Windows bir kez yönetici onayı sorar: **Evet**. Kurulum "Mola Yönetim" için yalnız **özel ağlarda** geçerli bir güvenlik duvarı izni ekler ve Merkez'i ağa açık başlatır.
   - Bunun yerine Mola Yönetim'i kapatıp açarsanız Windows "Windows Güvenlik Duvarı bu uygulamanın bazı özelliklerini engelledi" diye sorabilir: yalnız **"Özel ağlar"** işaretli kalsın, **"Erişime izin ver"**e basın. **"Ortak ağlar"ı işaretlemeyin.**
5. Ev ağınız Windows'ta **"Özel"** olmalı: Ayarlar → Ağ ve İnternet → Wi-Fi (ya da Ethernet) → ağınız → Ağ profili türü: **Özel ağ**. ("Genel" ise izin işe yaramaz.)

**Mola Yönetim ekranları yine yalnız bu bilgisayardan açılır.** Ağa yalnız kafelerin konuştuğu kısım (`/api/merkez/v1`) açılır; başka bir cihazdan Mola Yönetim'e girilmeye çalışılırsa "Mola Yönetim yalnız Mola Merkez’in çalıştığı bilgisayardan açılır" yanıtı gelir (bu durum 10 Ekim'de denendi).

## 3. Provayı başlatın

Kaynak klasöründe PowerShell:

```powershell
npm.cmd run ev-provasi
```

Adresi kendiniz vermek isterseniz: `npm.cmd run ev-provasi -- --ip=192.168.1.20`

Betik sırasıyla:

1. Kafe kurulum dosyalarını **bu bilgisayarın ev ağı adresiyle** hazırlar (`http://<IP>:4000`; anahtar: kurulu Mola Yönetim'inizin açık anahtarı, yalnız okunur). Dosyalar ayrı bir klasöre gider: `.local\ev-provasi\kurulum` — asıl kurulum klasörünüz (`.local\installer\Mola-0.1.0`) değişmez. İlk sefer birkaç dakika sürer.
2. Web sitesini indirme **açık** olarak hazırlar (`.local\ev-provasi\site`; asıl site ve `site/config.json` değişmez).
3. Siteyi ev ağında yayınlar: `http://<IP>:8080`. İletişim formu ve diğer Merkez istekleri, VDS'teki Caddy gibi bu bilgisayardaki Merkez'e iletilir.
4. Ekrana adresi, bir **QR kodu** ve "Mola Merkez ev ağından: AÇIK / KAPALI" satırını yazar. KAPALI ise 2. adımı kontrol edin.

İlk açılışta Windows bu site için de (Node.js) güvenlik duvarı sorabilir: yalnız **"Özel ağlar"** → **"Erişime izin ver"**.

Kurulum dosyalarını yeniden hazırlamadan başlatmak için: `npm.cmd run ev-provasi -- --hazir`. Yalnız Windows dosyası için (daha hızlı): `npm.cmd run ev-provasi -- --platforms=windows`.

## 4. Arkadaşlarınız ne yapar?

1. Telefonun kamerasıyla QR'ı okutur ya da bilgisayarında `http://<IP>:8080/indir/` adresini açar.
2. Bilgisayarına uygun dosyayı indirir (Windows: ZIP). ZIP'e sağ tık → **Tümünü ayıkla**, içindeki **"Mola Kurulum.exe"** → **Kur**.
   - Windows **"Bilgisayarınız korundu"** derse: **"Ek bilgi"** → **"Yine de çalıştır"** (Mola henüz kod imzalı değil).
3. Mola açılınca **"Mola'yı etkinleştir"** ekranı gelir → **"Kodum yok, başvuru yapacağım"** → formu doldurup **Başvuruyu gönder**. Ekran "Başvurunuz alındı · Onay bekleniyor" der.
4. Telefon ve tablet: Android uygulaması siteden değil, arkadaşınızın kurduğu Mola'dan kurulur (Mola penceresinin kenarındaki **Tabletler** → QR). iPhone: aynı QR → Safari → Paylaş → "Ana Ekrana Ekle".

## 5. Siz onaylarsınız

Mola Yönetim → **Başvurular** (zilde de "Yeni hesap açma başvurusu" görünür) → başvuruyu kontrol edin → **30 günlük denemeyi başlat**. Arkadaşınızın ekranı birkaç saniye içinde kendiliğinden **"İşletme sahibi hesabı"**na geçer; hesabını oluşturup kurulum sihirbazına devam eder.

## 6. Bitince geri alın

1. Betiğin çalıştığı pencerede **Ctrl+C** (site kapanır).
2. `%LOCALAPPDATA%\Mola Yonetim\ayarlar.cmd` içindeki `set MERKEZ_LAN=1` satırını silin (dosyada başka satır yoksa dosyayı silin), sonra **"Mola Yönetim Kurulum.exe"yi yeniden çalıştırın** ya da Mola Yönetim'i kapatıp açın: Merkez yeniden yalnız bu bilgisayardan erişilir olur.
3. İsterseniz Mola Yönetim'deki deneme işletmelerini kaldırın (Mola Yönetim → İşletmeler → işletme → Sil) ve arkadaşlarınız Mola'yı "Mola'yı kaldır" ile kaldırsın. Bu kurulumlar ev adresinize bağlıdır; VDS'e geçince işe yaramazlar.
4. `.local\ev-provasi` klasörünü silebilirsiniz.

## Sorun olursa

| Belirti | Neden / çözüm |
|---|---|
| Arkadaşın tarayıcısı site adresini açmıyor | Aynı Wi-Fi mi (misafir ağı değil)? Windows'un Node.js için güvenlik duvarı sorusuna "İzin ver" dediniz mi? Ağ profili "Özel" mi? |
| Mola başvuruda "Mola Merkez'e ulaşılamadı" diyor | 2. adım: `MERKEZ_LAN=1` ve Mola Yönetim yeniden başlatıldı mı? Betiğin "Mola Merkez ev ağından" satırı AÇIK mı? |
| Bilgisayarın adresi değişti | Kurulan Mola'lar eski adresi arar. Modemden sabit IP verin, betiği yeniden çalıştırın, arkadaşlar yeni dosyayı kursun. |
| "Mola Merkez adresi güvenli değil" | Dosyalar `npm.cmd run ev-provasi` ile hazırlanmamış (ev ağı Merkez'i için gereken ayar yok). Bu betikle hazırlanan dosyayı kullanın. |

Teknik not: `scripts/ev-provasi.ts` (adres bulma, `scripts/build-installer.mjs --cikti`, `scripts/site-indir.ts`, `scripts/site-dev.ts --host 0.0.0.0`). Kurulumdaki kafe programı ev ağı Merkez'i için `MOLA_MERKEZ_LAN=1` taşır (Windows `Mola-Sunucu.cmd`, Mac/Linux başlatıcıları).

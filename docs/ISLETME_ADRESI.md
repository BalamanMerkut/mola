# İşletmemi yönet'in adresi: kafem'den isletme.molayazilim.com.tr'ye geçiş

İşletmemi yönet (işletme sahiplerinin girişi, raporları ve uzaktan yönetimi; eski adı "Kafemi yönet") bu adımlardan sonra `https://isletme.molayazilim.com.tr` adresinde açılır. Mola yalnız kafeler için olmadığından adres `kafem.` yerine `isletme.` oldu (16 Ekim, sahibin kararı). `merkez.molayazilim.com.tr/yonet` açılmaz; sitede de `/yonet` gibi kısa adres sayfası yoktur (`molayazilim.com.tr/yonet` sitenin 404 sayfası). Henüz müşteri olmadığı için eski `kafem.` adresi yönlendirilmez.

**Önce:** sunucuda bu değişikliği içeren Mola Merkez sürümü kurulu olmalı (0.1.29'dan sonraki ilk sürüm; `docs/VDS_KURULUM.md` §11). Kafeler yeni adresi Merkez'den öğrenir (kalp atışı): kafelerde ayrıca bir şey yapılmaz. Adımları sırayla yapın; her adım 2 ile 5 dakika.

## 1. DNS kaydı (Cloudflare)

Cloudflare → `molayazilim.com.tr` → **DNS → Records → Add record**:

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| `A` | `isletme` | `31.57.187.132` | **DNS only** (gri bulut) |

Kaydedin. Windows'ta bekleyin, sonra deneyin: `nslookup isletme.molayazilim.com.tr` → `31.57.187.132` göstermeli (Cloudflare adresi değil). Turuncu bulut **kullanmayın** (sertifika alınamaz). Eski `kafem` kaydını şimdilik silmeyin (5. adım).

## 2. Sunucuda geçiş betiği

Betik `scripts/vds/isletme-gecis.sh` Caddy'deki `kafem.molayazilim.com.tr {` bloğunun adını `isletme.molayazilim.com.tr {` yapar (blok yoksa tam bloğu ekler), `/etc/mola-merkez/ayarlar.env` içinde `MERKEZ_OWNER_ORIGIN=https://isletme.molayazilim.com.tr` yazar (satır varsa değiştirir, yoksa ekler), Caddy ayarını doğrular, Caddy'yi yeniden yükler, Mola Merkez'i yeniden başlatır. Önce iki dosyanın yedeğini alır (`Caddyfile.yedek-isletme`, `ayarlar.env.yedek-isletme`); Caddy ayarı geçersiz çıkarsa yedekleri geri koyar ve durur. İki kez çalıştırılsa da aynı sonucu verir.

Windows'ta, kaynak klasöründe:

```powershell
scp .\scripts\vds\isletme-gecis.sh yonetici@31.57.187.132:~/
```

Sunucuda:

```bash
ssh yonetici@31.57.187.132
sudo bash ~/isletme-gecis.sh
```

Son satır `ISLETME_TAMAM` olmalı. "UYARI: Merkez … yok saydı" yazarsa çıktının tamamını saklayın: Merkez ayarı kabul etmedi (yazım hatası ya da başka bir adla çakışma) ve sayfayı ayar yokmuş gibi `merkez.…/yonet`'te açar; `journalctl -u mola-merkez -n 50 --no-pager | grep "yok sayıldı"` satırı nedenini söyler. Düzeltemezseniz "Geri almak" bölümüne bakın. Caddy sertifikayı bir dakika içinde kendisi alır.

Betiği kullanmak istemezseniz elle: `sudo nano /etc/caddy/Caddyfile` ile `kafem.molayazilim.com.tr {` satırını `isletme.molayazilim.com.tr {` yapın; `sudo nano /etc/mola-merkez/ayarlar.env` ile `MERKEZ_OWNER_ORIGIN=https://isletme.molayazilim.com.tr` yazın; sonra `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, `sudo systemctl reload caddy`, `sudo systemctl restart mola-merkez`.

## 3. Deneyin

Kendi bilgisayarınızdan (PowerShell'de `curl.exe`):

```
curl.exe -sI https://isletme.molayazilim.com.tr/
curl.exe -sI https://merkez.molayazilim.com.tr/yonet
curl.exe -sI https://isletme.molayazilim.com.tr/api/merkez/admin/state
```

1. → `HTTP/1.1 200` (ya da `HTTP/2 200`), `x-robots-tag: noindex`, `strict-transport-security` var.
2. → `404` (İşletmemi yönet yalnız isletme adresinde).
3. → `404` (Mola Yönetim bu adreste yok).

Tarayıcıda `https://isletme.molayazilim.com.tr` → "İşletmemi yönet" girişi. Kafede **Ayarlar → Uzaktan erişim** en geç 10 dakika sonra (bir sonraki bağlantıda) `isletme.molayazilim.com.tr` gösterir.

Daha önce bir cihazda `kafem.` adresinden girildiyse o cihaz yeni adreste bir kez yeniden giriş yapar (e-posta, şifre, telefon kodu): tarayıcılar cihaz anahtarlarını adrese göre ayrı tutar.

## 4. Site

Windows'ta `npm.cmd run site:build` ve siteyi her zamanki gibi yükleyin (`docs/VDS_KURULUM.md` §13 "Siteyi yükleme"; `rsync --delete` eski `/yonet`, `/raporlarim`, `/kafemi-yonet` sayfalarını sunucudan kaldırır). Betik bu üç klasörü `/var/www/molayazilim` altında bulursa zaten siler. Sonra `curl.exe -sI https://molayazilim.com.tr/yonet` → `404`.

## 5. İsteğe bağlı: eski kafem kaydını silmek

Yeni adres birkaç gün sorunsuz çalıştıktan sonra Cloudflare → DNS'te `kafem` A kaydını silin. Caddyfile'da `kafem.` bloğu kalmadığı için (betik adını değiştirdi) sunucuda başka bir şey yapılmaz.

## Geri almak

```bash
sudo cp /etc/caddy/Caddyfile.yedek-isletme /etc/caddy/Caddyfile
sudo cp -p /etc/mola-merkez/ayarlar.env.yedek-isletme /etc/mola-merkez/ayarlar.env
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
sudo systemctl restart mola-merkez
```

Sayfa yeniden `kafem.molayazilim.com.tr`'de açılır (Cloudflare'deki `kafem` kaydı silinmediyse). Betik yedeği yalnız bir dosyayı gerçekten değiştirirken alır: yeniden çalıştırmak yedeği bozmaz, yedekler geçişten önceki hâldir.

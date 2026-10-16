# Kafemi yönet'i kendi adresine taşıma: kafem.molayazilim.com.tr

Kafemi yönet (işletme sahiplerinin girişi, raporları ve uzaktan yönetimi) bu adımlardan sonra `https://kafem.molayazilim.com.tr` adresinde açılır; sahipler "merkez" adını hiç görmez. `merkez.molayazilim.com.tr/yonet` artık açılmaz (henüz müşteri olmadığı için eski adres yönlendirilmez); sitedeki kısa adresler (`molayazilim.com.tr/yonet`, `/raporlarim`, `/kafemi-yonet`) yeni adrese gönderir.

**Önce:** sunucuda bu özelliği içeren Mola Merkez sürümü kurulu olmalı (0.1.28'den sonraki ilk sürüm; `docs/VDS_KURULUM.md` §11). Adımları sırayla yapın; her adım 2 ile 5 dakika.

## 1. DNS kaydı (Cloudflare)

Cloudflare → `molayazilim.com.tr` → **DNS → Records → Add record**:

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| `A` | `kafem` | `31.57.187.132` | **DNS only** (gri bulut) |

Kaydedin. Windows'ta bekleyin, sonra deneyin: `nslookup kafem.molayazilim.com.tr` → `31.57.187.132` göstermeli (Cloudflare adresi değil). Turuncu bulut **kullanmayın** (sertifika alınamaz).

## 2. Caddy (sunucuda)

```bash
ssh yonetici@31.57.187.132
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.yedek-kafem
sudo nano /etc/caddy/Caddyfile
```

Dosyanın **en sonuna** şu bloğu yapıştırın (başka hiçbir satırı değiştirmeyin), kaydedin: Ctrl+O, Enter, Ctrl+X.

```
# Kafemi yönet: işletme sahiplerinin sayfası, kendi adında (MERKEZ_OWNER_ORIGIN). Host olduğu gibi gider: Merkez bu adla
# yalnız sayfayı ("/"), dosyalarını ve sayfanın çağrılarını açar; gerisi 404. Kafeyi yönet'ten gönderilen bir ürün
# fotoğrafı şifreli hâliyle en çok ~13 MB'tır. Sayfanın CSP'si Merkez'den gelir.
kafem.molayazilim.com.tr {
	encode zstd gzip
	request_body {
		max_size 16MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "DENY"
		-Server
	}
	reverse_proxy 127.0.0.1:4000
}
```

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`validate` "Valid configuration" demeli; demiyorsa `reload` yapmayın, yedeği geri koyun (aşağıda "Geri almak"). Caddy sertifikayı bir dakika içinde kendisi alır. Bu anda `https://kafem.molayazilim.com.tr` henüz "Bu adres bu sunucuya ait değil" der; 3. adımdan sonra açılır.

## 3. Mola Merkez ayarı (sunucuda)

```bash
sudo nano /etc/mola-merkez/ayarlar.env
```

`MERKEZ_MENU_ORIGIN=…` satırının altına şu satırı ekleyin, kaydedin:

```
MERKEZ_OWNER_ORIGIN=https://kafem.molayazilim.com.tr
```

```bash
sudo systemctl restart mola-merkez
systemctl status mola-merkez --no-pager
journalctl -u mola-merkez -n 50 --no-pager | grep "MERKEZ_OWNER_ORIGIN yok sayıldı"
```

`status` "active (running)" demeli; son komut **hiçbir şey yazmamalı** (yazıyorsa satırda yazım hatası var: `https://` ile başlamalı, sonunda `/` ya da yol olmamalı).

## 4. Deneyin

Kendi bilgisayarınızdan (PowerShell'de `curl.exe`):

```
curl.exe -sI https://kafem.molayazilim.com.tr/
curl.exe -sI https://merkez.molayazilim.com.tr/yonet
curl.exe -sI https://kafem.molayazilim.com.tr/api/merkez/admin/state
```

1. → `HTTP/1.1 200` (ya da `HTTP/2 200`), `x-robots-tag: noindex`, `strict-transport-security` var.
2. → `404` (Kafemi yönet artık yalnız kafem adresinde).
3. → `404` (Mola Yönetim bu adreste yok).

Tarayıcıda `https://kafem.molayazilim.com.tr` → "Kafemi yönet" girişi. Kafede **Ayarlar → Uzaktan erişim** en geç 10 dakika sonra (bir sonraki bağlantıda) `kafem.molayazilim.com.tr` gösterir.

**Site:** Windows'ta `npm.cmd run site:build` ve siteyi her zamanki gibi yükleyin (`docs/VDS_KURULUM.md` §13 "Siteyi yükleme"); `molayazilim.com.tr/yonet` artık kafem adresine gönderir.

## Geri almak

```bash
sudo nano /etc/mola-merkez/ayarlar.env        # MERKEZ_OWNER_ORIGIN satırını silin
sudo systemctl restart mola-merkez
```

Her şey eskisi gibi `merkez.molayazilim.com.tr/yonet`'te çalışır. Caddy bloğunu da kaldırmak isterseniz: `sudo cp /etc/caddy/Caddyfile.yedek-kafem /etc/caddy/Caddyfile`, `sudo caddy validate --config /etc/caddy/Caddyfile`, `sudo systemctl reload caddy`; sonra Cloudflare'de `kafem` kaydını silin. Site yeni derlenip yüklendiyse sitedeki `/yonet` kafem adresine gönderir: geri alma kalıcıysa siteyi bu değişiklikten önceki derlemeyle yükleyin.

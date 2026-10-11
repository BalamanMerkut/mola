# Mola Merkez'i bir sunucuya (VDS) taşıma — adım adım

Bu belge, Mola Merkez'i (lisanslar, etkinleştirme, destek, Mola Yönetim) şu an çalıştığı Windows bilgisayardan internetteki bir Linux sunucuya (VDS) **HTTPS** ile taşımayı anlatır. Uzman olmanız gerekmez; komutları sırayla kopyalayıp yapıştırın.

> **Satış verisi taşınmaz.** Kafelerin satışları, müşterileri ve raporları hiçbir zaman Merkez'e gelmez; kafenin bilgisayarında kalır. Merkez'de yalnız işletme kayıtları, lisanslar, destek talepleri ve Mola Yönetim hesabı vardır.

Aşağıda **örnek** değerler kullanılıyor; kendi değerlerinizle değiştirin:

| Örnek | Ne |
|---|---|
| `merkez.ornek-alanadi.com` | Merkez'in internet adresi (alan adınızın bir alt adı) |
| `203.0.113.10` | Sunucunuzun IP adresi (VDS firması verir) |
| `yonetici` | Sunucuda sizin kullanıcı adınız |

Hiçbir şey satın alınmadan önce bu belgeyi baştan sona bir kez okuyun. Gereken: bir VDS (en az 1 işlemci, 1 GB bellek, 20 GB disk yeter), bir alan adı, Windows bilgisayarınızda Mola'nın kaynak klasörü.

---

## 1. Paketi hazırlayın (Windows bilgisayarınızda)

Kaynak klasöründe PowerShell açın:

```powershell
npm.cmd run merkez:linux-paket
```

Sonuç: `.local\installer\Mola-Merkez-Linux-<sürüm>\Mola-Merkez-Linux-x64-<sürüm>.tar.gz`. İçinde Node.js, Mola Merkez, Mola Yönetim ekranları, `kur.sh`, `mola-merkez.service` (systemd), `ayarlar.env.ornek` ve `Caddyfile.ornek` vardır. Komut sonunda paketin yapısını kendisi denetler ("Paket yapısı doğru"). Veri, anahtar ya da yedek **pakete girmez**. (`npm.cmd run installer -- --platforms=merkez-linux` de aynı paketi hazırlar.)

## 2. Sunucuyu kurun: Ubuntu LTS

VDS firmasının panelinden işletim sistemi olarak **Ubuntu 24.04 LTS** (ya da 22.04 LTS) seçin. LTS sürümleri 5 yıl güvenlik güncellemesi alır.

## 3. SSH anahtarı (şifresiz, güvenli giriş)

Windows bilgisayarınızda PowerShell:

```powershell
ssh-keygen -t ed25519 -C "mola-merkez"
```

Sorulara Enter ile geçin (isterseniz anahtara bir parola koyun). Açık anahtarınızı görün ve kopyalayın:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

Bu satırı VDS panelindeki "SSH anahtarları" bölümüne yapıştırın (sunucu kurulurken) ya da ilk girişten sonra sunucuda `~/.ssh/authorized_keys` dosyasına ekleyin.

İlk giriş (panel root şifresi verdiyse onunla):

```powershell
ssh root@203.0.113.10
```

Kendinize bir kullanıcı açın ve anahtarınızı ona verin:

```bash
adduser yonetici
usermod -aG sudo yonetici
mkdir -p /home/yonetici/.ssh && cp ~/.ssh/authorized_keys /home/yonetici/.ssh/
chown -R yonetici:yonetici /home/yonetici/.ssh && chmod 700 /home/yonetici/.ssh && chmod 600 /home/yonetici/.ssh/authorized_keys
```

Yeni pencerede `ssh yonetici@203.0.113.10` ile girebildiğinizi **deneyin**. Girebiliyorsanız şifreyle ve root ile girişi kapatın:

```bash
sudo nano /etc/ssh/sshd_config.d/90-mola.conf
```

İçine yazın, kaydedin (Ctrl+O, Enter, Ctrl+X):

```
PasswordAuthentication no
PermitRootLogin no
```

```bash
sudo systemctl restart ssh
```

## 4. Güncellemeler ve güvenlik duvarı (yalnız 22, 80, 443)

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install unattended-upgrades ufw
sudo dpkg-reconfigure -plow unattended-upgrades     # "Yes": güvenlik güncellemeleri kendiliğinden kurulur
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTPS sertifikası için (Caddy, HTTP'yi HTTPS'e yönlendirir)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
sudo ufw status
```

Merkez'in kendi portu (4000) dışarıya **açılmaz**; yalnız sunucunun içinden Caddy ulaşır.

## 5. Alan adı (DNS)

Alan adınızın DNS panelinde iki **A kaydı** ekleyin: `merkez` → `203.0.113.10` (Mola Merkez ve Mola Yönetim) ve `menu` → aynı IP (misafirlerin QR menüsü, kendi adresinde; bölüm 13). Birkaç dakika sonra Windows'ta `nslookup merkez.ornek-alanadi.com` ve `nslookup menu.ornek-alanadi.com` sunucunuzun IP'sini göstermeli. HTTPS sertifikası ancak bundan sonra alınabilir.

## 6. Mola Merkez'i kurun (systemd servisi)

Paketi sunucuya kopyalayın (Windows PowerShell, paketin klasöründe):

```powershell
scp .\Mola-Merkez-Linux-x64-0.1.0.tar.gz yonetici@203.0.113.10:~
```

Sunucuda:

```bash
tar xzf Mola-Merkez-Linux-x64-0.1.0.tar.gz
cd mola-merkez
sudo ./kur.sh
```

`kur.sh` şunları yapar: `mola` adlı bir sistem kullanıcısı açar (Merkez onunla, yetkisiz çalışır), programı `/opt/mola-merkez`'e koyar, veri klasörünü `/var/lib/mola-merkez` olarak açar (yalnız `mola` okuyabilir), ayarları `/etc/mola-merkez/ayarlar.env`'e koyar, **anahtar parolasını** rastgele üretir (`/etc/mola-merkez/anahtar-parolasi`) ve `mola-merkez` servisini kurar.

### Veri klasörü ve anahtar koruması

* Veri: `/var/lib/mola-merkez/veri` (işletmeler, lisanslar, destek; imza anahtarı), gece yedekleri: `/var/lib/mola-merkez/merkez-yedek`.
* `MERKEZ_KEY_PROTECTION=1` ve `MERKEZ_KEY_PASSPHRASE_FILE`: Merkez'in veri anahtarı, Windows'taki DPAPI yerine bu **parola dosyasıyla** kilitlenir (`server/merkez/key-guard.ts`). Kilit, Merkez kurtarma kodu onaylanmışsa ilk açılışta kendiliğinden kurulur; bir kopyası da 24 harflik **Merkez kurtarma kodu** ile açılır.
* **Parola dosyasının bir kopyasını** (`sudo cat /etc/mola-merkez/anahtar-parolasi`) ve **Merkez kurtarma kodunu** sunucu dışında, güvenli bir yerde (şifre yöneticisi, kasadaki kâğıt) saklayın. Sunucu kaybolursa yedekler bu kodla açılır.

Ayarları açın ve **PUBLIC_ORIGIN**'i kendi adresinizle değiştirin:

```bash
sudo nano /etc/mola-merkez/ayarlar.env
```

```
PUBLIC_ORIGIN=https://merkez.ornek-alanadi.com
TRUST_LOCAL_PROXY=1
MERKEZ_MENU_ORIGIN=https://menu.ornek-alanadi.com
```

`PUBLIC_ORIGIN`: Merkez yalnız bu HTTPS adresine gelen istekleri kabul eder (başka ad, düz HTTP reddedilir). `TRUST_LOCAL_PROXY=1`: aynı sunucudaki Caddy'nin "bu istek HTTPS ile geldi" bilgisine güvenir. `MERKEZ_MENU_ORIGIN`: misafirlerin QR menüsünün **kendi adresi** (güvenlik, bölüm 13): masa QR'ları bu adresi taşır; Merkez menüyü (`/q/…`) yalnız bu adreste açar, bu adreste de menüden başka hiçbir şey açmaz.

## 7. Caddy: otomatik HTTPS

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
sudo cp ~/mola-merkez/Caddyfile.ornek /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # merkez.ornek-alanadi.com ve menu.ornek-alanadi.com yerine kendi adresleriniz
sudo systemctl reload caddy
```

Caddy sertifikayı (Let's Encrypt) kendisi alır ve yeniler; sizin bir şey yapmanız gerekmez.

## 8. Mevcut Merkez'i taşıyın (yedekten) ya da boş başlatın

**Mevcut Merkez'iniz varsa (önerilen; kafeler aynı anahtarı tanır):**

1. Windows'taki Mola Yönetim → Ayarlar → Yedek → **Şimdi yedekle**. Yedek klasörü: `%LOCALAPPDATA%\Mola Yonetim\merkez-yedek\<en yeni>`.
2. Windows'ta, kaynak klasöründe yedeği yeni bir klasöre açın (kurtarma kodu sorulur, ekranda görünmez):
   ```powershell
   npm.cmd run merkez:restore -- "$env:LOCALAPPDATA\Mola Yonetim\merkez-yedek\<en-yeni>" .local\vds-veri
   ```
3. Klasörü sunucuya kopyalayın ve yerine koyun:
   ```powershell
   scp -r .local\vds-veri yonetici@203.0.113.10:~/veri
   ```
   ```bash
   sudo systemctl stop mola-merkez
   sudo rm -rf /var/lib/mola-merkez/veri && sudo mv ~/veri /var/lib/mola-merkez/veri
   sudo chown -R mola:mola /var/lib/mola-merkez && sudo chmod -R go-rwx /var/lib/mola-merkez
   ```
4. Windows'taki `.local\vds-veri` klasörünü silin (içinde açık anahtar var).

**Boş (yeni) Merkez:** hiçbir şey yapmayın; ilk açılışta yeni anahtar oluşur. Dikkat: o zaman bugüne kadarki kafe paketleri bu Merkez'i tanımaz; kafe paketlerini yeni anahtarla hazırlamak gerekir.

Başlatın ve bakın:

```bash
sudo systemctl start mola-merkez
systemctl status mola-merkez          # "active (running)"
journalctl -u mola-merkez -n 50       # kayıtlar
curl -fsS https://merkez.ornek-alanadi.com/api/merkez/v1/health
```

Sağlık yanıtı `{"ok":true,"role":"merkez",...}` olmalı. Tarayıcıda `https://merkez.ornek-alanadi.com` → Mola Yönetim girişi. (Boş Merkez'in ilk şifresi: `sudo cat /var/lib/mola-merkez/veri/merkez-first-login.txt`; girer girmez değiştirin ve iki adımlı girişi açın.)

Mola Yönetim → Ayarlar → Yedek "kurtarma kodunu kaydedin" derse: yedeği açarken yazdığınız kod budur; "Kodu kaydettim"e basın ve `sudo systemctl restart mola-merkez`. Bu açılışta veri anahtarı parola dosyasına kilitlenir (Ayarlar → Yedek'te "anahtar koruması: sunucu parolası").

> Bazı işlemler güvenlik için yalnız Merkez'in kendi bilgisayarında yapılır (kurtarma kodunu ekranda göstermek, kilit ekranı). Kurtarma kodunu taşımadan **önce** Windows'taki Mola Yönetim'de kaydedin. Şifre unutulursa son çare: `sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/sifre-sifirla.sh && sudo systemctl start mola-merkez`.

## 9. Kafeleri yeni adrese geçirin ("Merkez adresi")

Kafeler Merkez'in adresini kurulum paketinden bilir. Taşınınca adres, **eski Merkez'in imzalı duyurusuyla** değişir; kafe kimseye körü körüne inanmaz:

1. Eski Merkez (Windows) kafelere yeni adresi **imzalı** bildirir (nabız yanıtında).
2. Kafe imzayı programındaki Merkez anahtarıyla doğrular. İmzasız ya da başka anahtarla imzalı duyuruyu yok sayar.
3. Kafe yeni adrese kendi rastgele sayısını gönderir; yeni adres **aynı anahtarla** imzalı bir kanıt döndürmeli ve bu kafenin kurulumunu tanımalıdır.
4. Ancak o zaman kafe geçer (kafenin işlem geçmişine "Merkez adresi değişti" yazılır). Kanıt olmazsa eski adreste kalır ve bir sonraki nabızda yeniden dener.

Yapılacak tek şey, **eski** Merkez'de duyuruyu açmak: Windows'ta `%LOCALAPPDATA%\Mola Yonetim\ayarlar.cmd` dosyasına (yoksa oluşturun) şu satırı ekleyin ve Mola Yönetim'i kapatıp açın (Merkez-Durdur.cmd, sonra Mola Yönetim):

```
set MERKEZ_YENI_ADRES=https://merkez.ornek-alanadi.com
```

Açık olan her kafe en geç 10 dakikada geçer; kapalı olanlar açıldıklarında. Yeni Mola Yönetim'de (HTTPS adresinde) işletmelerin "son görülme" saatleri güncellenmeye başlar. **Eski Merkez'i birkaç hafta açık tutun** (uzun süre kapalı kalan kafeler de geçsin). Taşıma sürerken yeni kafe etkinleştirmeyin ve Mola Yönetim işlerini yeni adreste yapın (yedekten sonra eski Merkez'de yapılan değişiklikler yeniye geçmez).

Yeni kafe paketlerini artık yeni adresle hazırlayın:

```powershell
$env:MOLA_MERKEZ_URL="https://merkez.ornek-alanadi.com"; npm.cmd run installer
```

## 10. Yedekler: ikinci bir yer ve geri yükleme provası

Merkez her gece `/var/lib/mola-merkez/merkez-yedek` içine yedek alır. Yedekler Merkez anahtarıyla şifrelidir; açmak için kurtarma kodu gerekir. Aynı diskteki yedek, sunucu kaybolursa işe yaramaz: **ikinci bir yere** de koyun.

En basit yol: haftada bir Windows bilgisayarınıza indirin (PowerShell):

```powershell
scp -r yonetici@203.0.113.10:/var/lib/mola-merkez/merkez-yedek "$env:USERPROFILE\Documents\Mola-Merkez-Yedek"
```

(Bunun için sunucuda bir kez: `sudo setfacl -R -m u:yonetici:rX /var/lib/mola-merkez/merkez-yedek` ve `sudo setfacl -d -m u:yonetici:rX /var/lib/mola-merkez/merkez-yedek`; `acl` paketi: `sudo apt -y install acl`.) Windows "Görev Zamanlayıcı" ile bu komutu haftalık çalıştırabilirsiniz. Başka bir depolama hizmeti (ör. bir "storage box") da olur; yedekler şifreli olduğu için orada okunamaz.

**Geri yükleme provası (ayda bir, 5 dakika):** indirdiğiniz en yeni yedeği Windows'ta deneyin:

```powershell
npm.cmd run merkez:restore -- "$env:USERPROFILE\Documents\Mola-Merkez-Yedek\<en-yeni>" .local\prova
```

"Geri yüklendi ve doğrulandı: N işletme" yazmalı. Sonra `.local\prova` klasörünü silin. Kod ya da yedek açılmıyorsa bunu sorun çıkmadan öğrenmiş olursunuz.

## 11. Güncelleme

Yeni sürümün Linux Merkez paketini hazırlayıp (1. adım) sunucuya kopyalayın ve:

```bash
tar xzf Mola-Merkez-Linux-x64-<yeni>.tar.gz && cd mola-merkez && sudo ./kur.sh
```

`kur.sh` Merkez'i durdurur, programı değiştirir (eskisi `/opt/mola-merkez.eski`'de kalır), verilere ve ayarlara dokunmaz, yeniden başlatır. Sorun olursa geri dönüş: `sudo systemctl stop mola-merkez && sudo rm -rf /opt/mola-merkez && sudo mv /opt/mola-merkez.eski /opt/mola-merkez && sudo systemctl start mola-merkez`. Güncellemeden önce Mola Yönetim → Ayarlar → Yedek → Şimdi yedekle.

Ubuntu'nun güvenlik güncellemeleri kendiliğinden kurulur; ayda bir `sudo apt update && sudo apt -y upgrade` ve gerekirse `sudo reboot` (Merkez kendiliğinden başlar).

## 12. Sağlık takibi

* Durum: `systemctl status mola-merkez`; çökerse systemd 5 saniyede yeniden başlatır.
* Kayıtlar: `journalctl -u mola-merkez --since today`
* Dışarıdan takip: ücretsiz bir "uptime" hizmetine (ör. UptimeRobot) şu adresi ekleyin; erişilemezse size e-posta gelir:
  `https://merkez.ornek-alanadi.com/api/merkez/v1/health`
* Disk: `df -h` (yüzde 80'i geçmesin). Sertifika: Caddy yeniler; `sudo journalctl -u caddy -n 50`.
* Mola Yönetim → Bildirim merkezi: yedek alınamadıysa, kafelerin yedekleri başarısızsa orada görünür; Ayarlar → E-posta bildirimleri açıksa e-postayla da gelir.

## 13. Web sitesi (molayazilim.com.tr) aynı sunucuda

Tanıtım sitesi (Ana sayfa, Özellikler, Destek ve İletişim, yasal sayfalar) **düz dosyalardır**: Windows'ta `npm.cmd run site:build` ile `site\dist` klasörüne derlenir, sunucuda Caddy doğrudan sunar. Sitede veritabanı, çerez, analiz aracı ya da dışarıdan yüklenen bir şey yoktur. Yalnız iletişim formu Mola Merkez'e gider; Caddy `/api/site/*` adresini **aynı sunucudaki** Merkez'e iletir (aynı adres olduğu için CORS gerekmez). Gelen talepler Mola Yönetim → **Başvurular → "Web sitesi talepleri"**nde görünür (ayrıntı: GELISTIRICI_REHBERI "Web sitesi").

**Önerilen düzen (tek VDS):**

| Adres | Ne |
|---|---|
| `https://molayazilim.com.tr` | Web sitesi (Caddy, `/var/www/molayazilim`) |
| `https://www.molayazilim.com.tr` | Yukarıdakine kalıcı yönlendirme |
| `https://molayazilim.com.tr/api/site/*` | İletişim formu → Mola Merkez (127.0.0.1:4000) |
| `https://molayazilim.com.tr/s/*` | Sosyal medya QR kısa adresleri → Mola Merkez (yalnız yönlendirme; aşağıda) |
| `https://menu.molayazilim.com.tr/q/*` | **İnternetten menü**: masa QR'ları (`/q/<kod>/<masa kodu>`) → Mola Merkez → kafenin kendi tüneli (aşağıda). Bu adreste menüden başka hiçbir şey yoktur (`MERKEZ_MENU_ORIGIN`) |
| `https://merkez.molayazilim.com.tr` | Mola Merkez ve Mola Yönetim (bölüm 6–9, `PUBLIC_ORIGIN`); kafelerin misafir tünelleri de buraya bağlanır (WebSocket, `/api/merkez/v1/tunnel`) |
| `https://molayazilim.com.tr/q/*`, `https://merkez.molayazilim.com.tr/q/*` | Eski adresle basılmış QR'lar: `308` ile `menu.` adresine |

**Neden ayrı bir menü adresi (11 Ekim, güvenlik denetimi Y1, sahibin kararı):** misafir menüsünün sayfası ve dosyaları kafenin bilgisayarından gelir. Değiştirilmiş (ya da ele geçirilmiş) bir kafe kendi menü sayfasına istediği kodu koyabilir. Bu sayfa Mola Yönetim'in adresinde açılsaydı, Mola Yönetim'e girişliyken menüyü açan sizin adınıza işlem yapabilirdi; aynı telefonda "Raporlarım" ya da "Kafeyi yönet" kullanan bir işletme sahibinin cihaz anahtarlarına ulaşabilirdi. Tarayıcılar çerezleri ve yerel kayıtları adrese (ada) göre ayırır: `menu.` adresinde Mola Yönetim'in ya da sitenin hiçbir çerezi ve anahtarı yoktur. Misafir çerezi (`mola_browser`) yalnız `menu.` adına ve yalnız o işletmenin yoluna (`/q/<kod>/`) yazılır. Lisans ve güncelleme imzası VDS'te kalır (sahibin kararı; bu değişiklik ona dokunmaz).

**Sosyal medya kısa adresleri (`/s/`) sitede kalır:** bunlar Merkez'in yalnız işletmenin kendi bağlantısına `302` ile yönlendirdiği adreslerdir; sayfa, betik ya da kafeden gelen bir dosya sunulmaz. Basılmış kartlar da bu adresi taşıdığı için yerinde kalır. (`menu.` adresinde `/s/` açılmaz.)

### DNS

Alan adı panelinde (Metunic) dört **A kaydı**: `@` → sunucu IP'si, `www` → aynı IP, `merkez` → aynı IP, `menu` → aynı IP.

### Caddyfile (tamamı)

`/etc/caddy/Caddyfile` dosyasını şununla değiştirin (paketteki `Caddyfile.ornek` yalnız Merkez bölümünü içerir):

```
# Yavaş istemciler (slowloris) bağlantıyı tutamasın: başlıklar 15 sn içinde, boşta bekleyen bağlantı en çok 2 dakika.
{
	servers {
		timeouts {
			read_header 15s
			idle 2m
		}
	}
}

# Mola Merkez ve Mola Yönetim
merkez.molayazilim.com.tr {
	encode zstd gzip
	request_body {
		max_size 30MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}
	# Güvenlik (docs/GUVENLIK_DENETIMI.md Y1): misafir menüsü kafelerin gönderdiği dosyaları taşır; Mola Yönetim'in adresinde
	# asla açılmaz, yalnız kendi adresinde (menu., aşağıda). Bu adresle basılmış bir QR da çalışır: menü adresine yönlenir.
	redir /q/* https://menu.molayazilim.com.tr{uri} 308
	# Kafelerin misafir tünelleri (WebSocket, İnternetten menü) buradan geçer; Caddy WebSocket'i kendiliğinden taşır. Caddy
	# yeniden yüklenince açık tüneller 5 dakika daha tutulur (kafeler zaten birkaç saniyede kendiliğinden yeniden bağlanır).
	reverse_proxy 127.0.0.1:4000 {
		stream_close_delay 5m
	}
}

# Web sitesi
molayazilim.com.tr {
	encode zstd gzip
	root * /var/www/molayazilim
	# Her yanıtta (Merkez'e giden /s/ ve /api/site/ dahil). Sitenin kendi CSP'si aşağıda yalnız sitenin dosyalarına konur.
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		-Server
	}
	# İletişim formu → Mola Merkez. Merkez yalnız kendi adını (Host) ve kendi kökenini (Origin) kabul eder: ikisi
	# burada Merkez'inkiyle değiştirilir. Gerçek ziyaretçi adresi X-Forwarded-For ile gider (sınırlar adres başına).
	handle /api/site/* {
		request_body {
			max_size 64KB
		}
		reverse_proxy 127.0.0.1:4000 {
			header_up Host merkez.molayazilim.com.tr
			header_up Origin https://merkez.molayazilim.com.tr
		}
	}
	# Sosyal medya QR kısa adresleri (/s/<kod>/<platform>): Merkez yalnız işletmenin bağlantısına yönlendirir (302).
	handle /s/* {
		reverse_proxy 127.0.0.1:4000 {
			header_up Host merkez.molayazilim.com.tr
		}
	}
	# Misafir menüsü bu adreste açılmaz: daha önce bu adresle basılmış masa QR'ları menü adresine yönlenir.
	redir /q/* https://menu.molayazilim.com.tr{uri} 308
	# Merkez'in başka hiçbir yolu bu adresten açılmaz (Mola Yönetim yalnız merkez.molayazilim.com.tr'de).
	handle /api/* {
		respond 404
	}
	handle {
		header {
			Content-Security-Policy "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
			Referrer-Policy "strict-origin-when-cross-origin"
			X-Frame-Options "DENY"
			Permissions-Policy "camera=(), microphone=(), geolocation=()"
		}
		@assets path /assets/* /favicon.svg /favicon-32.png /apple-touch-icon.png
		header @assets Cache-Control "public, max-age=604800"
		try_files {path} {path}/index.html
		file_server
	}
	handle_errors {
		@notfound expression {err.status_code} == 404
		handle @notfound {
			root * /var/www/molayazilim
			rewrite * /404.html
			file_server
		}
	}
}

www.molayazilim.com.tr {
	redir https://molayazilim.com.tr{uri} permanent
}

# İnternetten menü: masa QR'ları (/q/<kod>/<masa kodu>), kendi adında (MERKEZ_MENU_ORIGIN). Burada Mola Yönetim'in ya da sitenin
# hiçbir çerezi yoktur. Host olduğu gibi gider: Merkez /q/*'yi yalnız bu adla açar. Merkez yalnız misafir yollarını kafenin
# tüneline geçirir (misafir sayfası ve dosyaları, /api/guest/*, ürün fotoğrafları); gerisi 404. Gerçek misafir adresi
# X-Forwarded-For ile gider (Merkez'in ve kafenin sınırları misafir başına). Bir sipariş birkaç kB'tır. Menünün CSP'si
# Merkez'den gelir (tek CSP); burada başka CSP eklenmez.
menu.molayazilim.com.tr {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		X-Frame-Options "DENY"
		-Server
	}
	handle /q/* {
		request_body {
			max_size 64KB
		}
		reverse_proxy 127.0.0.1:4000
	}
	# Başka hiçbir şey: Mola Yönetim, /api, /s/ bu adreste yoktur.
	handle {
		respond 404
	}
}
```

`sudo caddy validate --config /etc/caddy/Caddyfile` ile denetleyip `sudo systemctl reload caddy`. Caddy dört ad için de sertifikayı kendisi alır.

Merkez'in ayarlarında (`/etc/mola-merkez/ayarlar.env`) `PUBLIC_ORIGIN=https://merkez.molayazilim.com.tr`, `TRUST_LOCAL_PROXY=1` ve `MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr` olur; **PUBLIC_ORIGIN mantığı değişmedi**. Site üzerinden gelen istek Merkez'e `merkez.molayazilim.com.tr` adıyla ve HTTPS olarak ulaştığı için kabul edilir; Mola Yönetim'in kendisi yine yalnız `merkez.` adresinden açılır. `menu.` adıyla gelen istekte Merkez yalnız `/q/*`'yi açar, gerisine 404 der (Caddy'den geçmeyen bir istek de olsa); başka bir adla gelen `/q/*` isteğini kendisi de `308` ile `menu.` adresine yönlendirir.

### Siteyi yükleme ve güncelleme

Windows'ta, kaynak klasöründe:

```powershell
npm.cmd run site:build
scp -r .\site\dist yonetici@203.0.113.10:~/site-yeni
```

Sunucuda (ilk kez `sudo mkdir -p /var/www/molayazilim`):

```bash
sudo rsync -a --delete ~/site-yeni/ /var/www/molayazilim/ && rm -rf ~/site-yeni
```

Caddy'yi yeniden başlatmak gerekmez. Telefon, WhatsApp ve e-posta `site/config.json`'dan gelir; değiştirince yeniden derleyip yükleyin. Derleme "telefon numarası henüz doldurulmadı" diyorsa yayından önce doldurun.

### Uygulamayı indir (`/indir/`): kurulum dosyalarını sitede yayınlama

Sitedeki "Uygulamayı indir" sayfası (`molayazilim.com.tr/indir/`) Windows, Mac (Apple Silicon / Intel) ve Linux kartlarını gösterir. `site/config.json` → `downloads.enabled` **false** iken her kart **"Yakında"** der ve hiçbir dosya bağlantısı yoktur. Bugünkü kurulum dosyaları bu bilgisayardaki Merkez'e (`http://127.0.0.1:4000`) bağlanır; bunlar siteye konmaz.

VDS hazır olduktan sonra, sırasıyla:

1. **VDS Merkez'i için kafe paketini hazırlayın** (Windows'ta, kaynak klasöründe; anahtar VDS'teki Merkez'in açık anahtarıdır, bölüm 8):
   ```powershell
   $env:MOLA_MERKEZ_URL="https://merkez.molayazilim.com.tr"; $env:MOLA_MERKEZ_PUBLIC_KEY="C:\yol\merkez-public-key.txt"; npm.cmd run installer
   ```
   Sonundaki "Kafe paketlerinin Mola Merkezi" özeti "Adres: https://merkez.molayazilim.com.tr" demeli.
2. **Dosyaları siteye alın:** `npm.cmd run site:indir`. Betik `.local\installer\Mola-<sürüm>` içinden Windows klasörünü `Mola-Windows-<sürüm>.zip` yapar, Mac ve Linux arşivlerini kopyalar (`site\dist\indir\`), her dosyanın boyutunu ve SHA-256'sını `site/config.json` → `downloads.files`'a ve `site\dist\indir\SHA256SUMS.txt`'ye yazar, siteyi yeniden derler. Sonunda dosyaların hangi Merkez'e bağlandığını yazar; `127.0.0.1` görürseniz 1. adıma dönün.
3. **İndirmeyi açın:** `site/config.json` → `"downloads": { "enabled": true, … }`, sonra `npm.cmd run site:build` (derleme `site\dist\indir`'i silmez; dosya eksikse uyarır).
4. **Yükleyin:** yukarıdaki gibi `scp -r .\site\dist …` ve `rsync`. `/indir/` altındaki dosyaları Caddy'nin `file_server`'ı verir; ek ayar gerekmez.
5. **Deneyin:** başka bir bilgisayardan `https://molayazilim.com.tr/indir/` → Windows → İndir; ZIP'i açıp "Mola Kurulum.exe" → "Mola'yı etkinleştir" → "Kodum yok, başvuru yapacağım" → Mola Yönetim → Başvurular'da görünmeli.

Kapatmak için `enabled: false` yapıp yeniden derleyip yükleyin. Yeni sürümde 1–4'ü tekrarlayın (eski sürümün dosyaları `site:indir` ile silinir). Program henüz kod imzalı olmadığı için Windows SmartScreen "Bilgisayarınız korundu" diyebilir; sayfa "Ek bilgi → Yine de çalıştır"ı anlatır. Eve özel bir prova için (VDS'ten önce, ev ağında): `docs/EV_AGI_PROVASI.md`.

### Sosyal medya QR kısa adresleri: karar verin, sonra basın

Kafelerin "Bizi takip edin" QR kartları bir kısa adres taşır (`<adres>/s/<kod>/instagram`); **basılmış bir QR kartı adresini sonradan değiştiremez.** İki seçenek:

1. **Hiçbir şey yapmazsanız:** kartlar `https://merkez.molayazilim.com.tr/s/…` taşır (Merkez'in `PUBLIC_ORIGIN`'i). Çalışır (yalnız yönlendirme); ama Mola Yönetim'in adresi kartlarda görünür.
2. **Önerilen:** kartlar `https://molayazilim.com.tr/s/…` taşısın (kısa, tanıdık adres). `/etc/mola-merkez/ayarlar.env`'e şu satırı ekleyip `sudo systemctl restart mola-merkez`:
   ```
   MERKEZ_SITE_ORIGIN=https://molayazilim.com.tr
   ```
   Merkez kafelere bir sonraki kalp atışında bu adresi verir (`server/merkez/site-leads.ts` `shortLinkOrigin`); yukarıdaki Caddyfile `/s/*`'yi Merkez'e iletir. Yanlış bir değer (https kök adresi değilse) yok sayılır, eski adres kullanılır.

Hangisini seçerseniz seçin, **kafelere toplu QR kartı bastırmadan önce** seçin ve bir kartı telefonla okutup deneyin. Sonradan değiştirirseniz eski kartların çalışması için eski adresin de Merkez'e yönlenmeye devam etmesi gerekir.

### İnternetten menü (masa QR'ları her ağdan açılır)

Masa QR'ları menünün **kendi adresini** taşır: `https://menu.molayazilim.com.tr/q/<kod>/<masa kodu>` (`MERKEZ_MENU_ORIGIN`). Misafir QR'ı kendi mobil verisiyle ya da herhangi bir Wi-Fi'den açar; Mola Merkez misafirin isteklerini kafenin **kendi açtığı** tünele (kafeden dışa doğru tek WebSocket, kurulum anahtarıyla imzalı) geçirir. Kafede port açmak, modem ayarı ya da üçüncü bir hizmet gerekmez. Ayrıntı: GELISTIRICI_REHBERI bölüm 14e.

* **Gerekli ayar (güvenlik, bulgu Y1):** `/etc/mola-merkez/ayarlar.env`'de `MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr`, DNS'te `menu` A kaydı ve yukarıdaki Caddyfile'daki `menu.` bloğu. Değer `PUBLIC_ORIGIN`'den ve siteden farklı bir https kök adresi olmalı; değilse yok sayılır ve `journalctl -u mola-merkez`'e "MERKEZ_MENU_ORIGIN yok sayıldı" yazılır (o zaman menü eskisi gibi `MERKEZ_SITE_ORIGIN`/`PUBLIC_ORIGIN` adresine düşer: düzeltin).
* **Karar ve sıra:** **masa QR'larını toplu bastırmadan önce** verin. Kafe, Merkez'in bu sürümünü gördükten sonraki ilk kalp atışlarında (en geç ~20 dakika) internet adresini alır; Ayarlar → Masalar ve QR'da "QR kodları internet adresini taşır (menu.molayazilim.com.tr/q/…) · Bağlı" yazar. Daha önce basılmış (Wi-Fi adresli) QR'lar için sahibe Masalar'da "Masa QR kodları internet adresiyle yeniden basılmalı" uyarısı çıkar. Eski internet adresiyle (`molayazilim.com.tr/q/…` ya da `merkez.…/q/…`) basılmış QR'lar yeniden basılmadan çalışır (Caddy ve Merkez `308` ile `menu.` adresine yönlendirir); bu yüzden onlar için uyarı çıkmaz.
* **Uyumluluk:** yeni Merkez, kalp atışında `guest.menu-origin` der ve menü adresini verir; yeni kafe bu durumda QR'a hiçbir zaman Merkez'in kendi adresini koymaz. Eski kafe de verilen adresi (artık `menu.`) kullanır. Eski Merkez'e bağlı yeni kafe eskisi gibi davranır. Önce Merkez güncellenir, sonra kafeler.
* **Ev ağı provası ve yerel denemeler:** `MERKEZ_MENU_ORIGIN` yokken hiçbir şey değişmez; yerel ağdaki Merkez'in (`http://192.168.x.x`) adresi zaten QR'a girmez, QR'lar kafenin Wi-Fi adresini taşır.
* **Ne zaman açılmaz:** işletme askıda, lisansı bitmiş ya da dondurulmuş, kafe 14 gündür bağlanmamış ya da pakette "QR menü" yoksa Merkez kafeye sormadan "Bu işletmenin dijital menüsü şu anda kullanılamıyor." gösterir; kafe bilgisayarı kapalıysa ya da interneti yoksa menü Merkez'deki **kopyasından** açılır (sipariş kapalı: "Şu an sipariş alınamıyor, lütfen garsonunuza sorun."); kafe henüz kopya göndermemişse (eski sürüm) "Menü şu anda açılamıyor. Lütfen garsonunuza sorun." (sayfa 15 saniyede bir kendiliğinden yeniden dener).
* **Menünün kopyası (8 Ekim):** her kafe menüsünün herkese açık kopyasını ve ürün fotoğraflarını Merkez'e gönderir (`POST /api/merkez/v1/menu` ve `/menu/photo/…`, Merkez bloğundaki `request_body 30MB` yeterli; fotoğraf ≤ 2 MB, kopya ≤ 2 MB). Kopya `merkez.sqlite`'ta, fotoğraflar veri klasörünün yanında `/var/lib/mola-merkez/veri-menu/` (mühürlü; ~20–30 MB/kafe, kafe başına en çok `MERKEZ_MENU_MB=64`, diskte `MERKEZ_MENU_BOS_MB=1024` MB boş yer kalınca yeni fotoğraf alınmaz). Bu klasör **yedeğe gerekmez**: Merkez geri yüklenince kafeler tünel bağlanır bağlanmaz yeniden gönderir. İşletme kaydı silinince kopyası da silinir. Ayar gerekmez (`ayarlar.env`'de isteğe bağlı `MERKEZ_MENU_MB`, `MERKEZ_MENU_BOS_MB`).
* **Saklama (8 Ekim):** Merkez işlem kayıtlarındaki IP adreslerini 1 yıl, kapanan destek görüşmelerini 2 yıl, reddedilen başvuruları 1 yıl sonra kendisi siler (6 saatte bir). Caddy erişim kaydı tutmaz (Caddyfile'da `log` yönergesi yok; eklemeyin, web sitesinin gizlilik metni "ziyaret kaydı tutulmaz" der).
* **Yük:** 50 kafe × 30 misafir yerelde ölçüldü (GELISTIRICI_REHBERI bölüm 14e): Merkez ~200 MB bellek, istek başına birkaç milisaniye. Her kafenin aynı anda en çok 48 isteği işlenir, fazlası kendi sırasında bekler; yavaş bir kafe diğerlerini etkilemez.
* **Gizlilik:** Merkez misafir trafiğini (menü, sipariş) TLS'i kendisi sonlandırdığı için açık hâlde görür ama **saklamaz ve günlüğe yazmaz** (`journalctl`'da da yoktur); yalnız kafe başına sayaçlar bellekte durur. Program dosyaları (herkeste aynı) bellekte önbellekte tutulur; ürün fotoğrafları menünün kopyasından (yukarıda) ya da en çok 10 dakika bellekten verilir.

### Denetim

* `curl -fsS https://molayazilim.com.tr/ | head -5` → sayfa; `curl -fsS https://molayazilim.com.tr/api/site/form` → `{"token":…}`.
* `curl -I https://molayazilim.com.tr/api/merkez/admin/state` → **404** (Mola Yönetim bu adresten açılmamalı).
* İnternetten menü: `curl -I https://menu.molayazilim.com.tr/q/AAAAAAAAAA/x` → **404** ("Bu bağlantı bulunamadı."); bir kafenin adresiyle (Ayarlar → Masalar ve QR'da yazar) `curl -I https://menu.molayazilim.com.tr/q/<kod>/api/staff/state` → **404** (personel yolları bu adresten hiç açılmaz). `curl -I https://menu.molayazilim.com.tr/` ve `…/api/merkez/admin/state` → **404**. `curl -I https://molayazilim.com.tr/q/AAAAAAAAAA/x` ve `curl -I https://merkez.molayazilim.com.tr/q/AAAAAAAAAA/x` → **308**, `location: https://menu.molayazilim.com.tr/q/…`. Sonra bir masa QR'ını **Wi-Fi'si kapalı bir telefonla** (mobil veri) okutun: menü açılmalı, adres çubuğunda `menu.molayazilim.com.tr` görünmeli, deneme siparişi kafenin mutfağına düşmeli.
* Formdan bir deneme talebi gönderin; Mola Yönetim → Başvurular → Web sitesi talepleri'nde görünmeli, zilde "Web sitesi talebi" çıkmalı. Sonra "Sil" ile silin.

## 14. Sunucu sertleştirme kontrol listesi (güvenlik denetimi, 11 Ekim)

Kurulumdan sonra bir kez, her maddeyi işaretleyerek geçin. Ayrıntılı gerekçe: `docs/GUVENLIK_DENETIMI.md`.

**SSH**
- [ ] Bölüm 3'teki `/etc/ssh/sshd_config.d/90-mola.conf` dosyasına şunları da ekleyin, sonra `sudo sshd -t && sudo systemctl restart ssh` (yeni pencerede girişi denemeden eski pencereyi kapatmayın):
  ```
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  PermitRootLogin no
  AllowUsers yonetici
  MaxAuthTries 3
  X11Forwarding no
  ```
- [ ] fail2ban (SSH'a deneme yapanları bir süre engeller):
  ```bash
  sudo apt -y install fail2ban
  printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\nfindtime = 10m\n' | sudo tee /etc/fail2ban/jail.d/mola.local
  sudo systemctl enable --now fail2ban && sudo fail2ban-client status sshd
  ```

**Güvenlik duvarı ve güncellemeler**
- [ ] `sudo ufw status verbose`: yalnız 22, 80, 443 açık; 4000 **yok** (bölüm 4). `sudo ss -ltnp`: Merkez yalnız `127.0.0.1:4000` dinlemeli.
- [ ] Otomatik güvenlik güncellemeleri açık (`unattended-upgrades`, bölüm 4). İsterseniz gece 04:00'te gereken yeniden başlatma: `/etc/apt/apt.conf.d/52mola` içine `Unattended-Upgrade::Automatic-Reboot "true"; Unattended-Upgrade::Automatic-Reboot-Time "04:00";`

**Mola Merkez servisi**
- [ ] Paketteki `mola-merkez.service` yetkisiz `mola` kullanıcısıyla ve kum havuzunda çalışır (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, `PrivateDevices`, yetki yok, yalnız ağ soketleri). Denetleyin: `systemd-analyze security mola-merkez` (puan 3–4 civarı "OK" beklenir).
- [ ] `/etc/mola-merkez/ayarlar.env`: `PUBLIC_ORIGIN=https://merkez.molayazilim.com.tr`, `TRUST_LOCAL_PROXY=1`, **`MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr`** (misafir menüsü kendi adresinde; Mola Yönetim'in ya da sitenin adresinde asla) ve `MERKEZ_SITE_ORIGIN=https://molayazilim.com.tr` (sosyal medya kısa adresleri). `journalctl -u mola-merkez | grep "MERKEZ_MENU_ORIGIN yok sayıldı"` boş olmalı. `MOLA_TEST_TUNNEL`, `MERKEZ_INITIAL_PASSWORD`, `NODE_ENV` gibi test değişkenleri **olmamalı**.
- [ ] Dosya izinleri: `sudo ls -la /var/lib/mola-merkez /etc/mola-merkez` → veri yalnız `mola`, parola dosyası `root:mola 440`.

**Caddy**
- [ ] DNS'te `menu` A kaydı (bölüm 5 ve 13). Bölüm 13'teki Caddyfile (zaman aşımları, `request_body` sınırları, HSTS, `nosniff`, `menu.` bloğu yalnız `/q/*`, `merkez.` ve site bloklarında `/q/*` → `menu.` yönlendirmesi). `sudo caddy validate --config /etc/caddy/Caddyfile`.
- [ ] Erişim kaydı (`log`) eklemeyin (gizlilik metni). Caddy'nin kendi hata kayıtları `journalctl -u caddy`'de kalır.
- [ ] İsteğe bağlı (önerilir): Mola Yönetim'i yalnız sizin bağlantınızdan açın. Ev/ofis IP'niz sabitse `merkez.` bloğuna, `reverse_proxy`'den önce:
  ```
  @yonetim {
  	path / /merkez.html /api/merkez/admin/*
  	not remote_ip 198.51.100.7
  }
  respond @yonetim 404
  ```
  (198.51.100.7 yerine kendi IP'niz). IP'niz değişiyorsa bunun yerine SSH tüneli: `ssh -L 4000:127.0.0.1:4000 yonetici@203.0.113.10` ve tarayıcıda `http://localhost:4000`. Kafelerin `/api/merkez/v1`, `/yonet`, `/raporlarim`, `/destek` yolları bundan etkilenmemeli; bu ayarı yaptıktan sonra bir kafeyle kalp atışını ve Raporlarım'ı deneyin.

**Kayıtlar, yedek, takip**
- [ ] Günlük boyutu: `/etc/systemd/journald.conf.d/mola.conf` içine `[Journal]` / `SystemMaxUse=500M` / `MaxRetentionSec=3month`, sonra `sudo systemctl restart systemd-journald`.
- [ ] Yedekler sunucu dışında (bölüm 10): haftalık indirme ve aylık geri yükleme provası. Anahtar parolası dosyası ve Merkez kurtarma kodu sunucu dışında, ayrı yerlerde.
- [ ] Takip (bölüm 12): UptimeRobot benzeri bir hizmet `https://merkez.molayazilim.com.tr/api/merkez/v1/health` ve `https://molayazilim.com.tr/`'yi izlesin; disk %80'i geçmesin.
- [ ] VDS sağlayıcısının panelinde iki adımlı giriş açık; panel şifresi ve SSH anahtarının parolası şifre yöneticisinde.

**Canlıya açmadan önce dışarıdan denetim** (kendi bilgisayarınızdan)
- [ ] `curl -sI https://merkez.molayazilim.com.tr/api/merkez/v1/health` → 200 ve `strict-transport-security`, `x-content-type-options` başlıkları; `server:` başlığı yok.
- [ ] `curl -sI http://merkez.molayazilim.com.tr/` → HTTPS'e yönlendirme.
- [ ] `curl -sI https://merkez.molayazilim.com.tr/q/AAAAAAAAAA/x` ve `curl -sI https://molayazilim.com.tr/q/AAAAAAAAAA/x` → 308, `location: https://menu.molayazilim.com.tr/q/…`. `curl -sI https://menu.molayazilim.com.tr/` ve `curl -sI https://menu.molayazilim.com.tr/api/merkez/admin/state` → 404.
- [ ] `curl -s -X POST -H 'Content-Type: application/json' --data-binary @buyuk.json https://merkez.molayazilim.com.tr/api/merkez/v1/relay/poll` (1 MB'lık herhangi bir dosya) → hemen `401 INSTALL_AUTH` (gövde okunmadan).
- [ ] `curl -sI https://molayazilim.com.tr/api/merkez/admin/state` → 404; `curl -s https://merkez.molayazilim.com.tr/api/merkez/admin/state -H 'X-Forwarded-For: 127.0.0.1'` → 401 (giriş gerekli; başlık bir şey değiştirmez).
- [ ] `nmap -Pn -p 1-65535 203.0.113.10` (yalnız kendi sunucunuza): yalnız 22, 80, 443 açık.
- [ ] Mola Yönetim girişinde yanlış şifre denemelerinin yavaşladığını ve iki adımlı girişin istendiğini görün.

## Kısa sözlük

* **VDS**: internette kiralanan, size ait sanal sunucu.
* **SSH**: sunucuya güvenli uzaktan bağlantı; anahtarla giriş şifreden güvenlidir.
* **ufw**: Ubuntu'nun güvenlik duvarı.
* **systemd servisi**: sunucu açılınca Merkez'i başlatan, çökerse yeniden başlatan sistem parçası.
* **Caddy**: HTTPS sertifikasını alıp yenileyen ve istekleri Merkez'e ileten program (reverse proxy).
* **PUBLIC_ORIGIN**: Merkez'in kabul ettiği tek dış adres (https ile).

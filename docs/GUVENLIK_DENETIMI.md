# Güvenlik denetimi (11 Ekim 2026)

Mola internete açılmadan önce yapılan güvenlik denetimi: neye bakıldı, ne bulundu, ne düzeltildi, sizin karar vermeniz gereken ne kaldı.

> **Dürüst not:** Bu denetimi, kodu okuyan ve bu bilgisayardaki deneme sunucularına saldırı deneyen bir yapay zekâ yaptı. Gerçek sunucu (VDS), gerçek Caddy ve gerçek internet trafiği burada yoktu. Bu denetim, bağımsız bir uzmanın yapacağı **profesyonel sızma testinin yerini tutmaz**. Kafeler çoğaldığında ya da ödeme ve kişisel veri arttığında, bir güvenlik firmasına gerçek sunucu üzerinde sızma testi yaptırmanız önerilir.

## Neye bakıldı

1. **İnternete açık Mola Merkez:**
   - `/api/merkez/v1/*`: kalp atışı, etkinleştirme, başvuru, köprü, telefon, sunucu yedeği, ekler, menü kopyası, güncelleme paketi.
   - `/q/` (internetten menü), `/s/` (kısa adresler), `/api/site/*` (web sitesi formu), tünel WebSocket'i ve Mola Yönetim.
   - Her biri için: kimlik doğrulama, işletmeler arası ayrım, girdi denetimi, tekrar oynatma, hız sınırları, büyük istekler, hata metinleri, çerezler, güvenlik başlıkları ve yönlendirmeler.
2. **Misafir tüneli:** `/q/` üzerinden personel yollarına ulaşma denemeleri.
   - Kodlanmış eğik çizgi, `..`, büyük/küçük harf, sondaki `/`, yöntem değiştirme başlıkları.
   - Kafeye sahte tünel işareti.
   - Başka masanın ya da başka işletmenin verisi.
3. **Kafe sunucusu (yerel ağ):**
   - Beş rolün her `/api/staff` işlemindeki yetkisi, rapor kodu, sahip kilidi, uzaktan yönetim.
   - Oturumlar, kaba kuvvet sınırları, CSRF, masaüstüne özel yollar.
   - Kayıtlı XSS (yazdırma sayfaları, PDF, e-posta).
   - Dosya yükleme ve yedekten geri yükleme.
4. **Kriptografi ve sırlar:**
   - Lisans ve güncelleme imzaları, kurulum HMAC'i, tünel imzası.
   - Anahtar kasası, kurtarma kodları, TOTP, şifre özetleri.
   - Paketlere sızan gizli bilgi.
5. **Bağımlılıklar:** `npm audit` (11 Ekim sonrası: sharp 0.35.5, `npm audit --omit=dev` temiz).
6. **Web sitesi:** form uç noktası ve CSP.
7. **VDS sertleştirme:** sunucu olmadığı için denenmedi. Adım adım kontrol listesi `docs/VDS_KURULUM.md` bölüm 14'e yazıldı.

Saldırılar yalnız bu bilgisayardaki geçici deneme sunucularına yapıldı. Gerçek kurulumlara ve verilere dokunulmadı. Saldırıların hepsi kalıcı test olarak duruyor: `tests/security-audit.test.ts`.

## Bulgular

Durum sütunu:
- **düzeltildi**: kod değişti ve testi var.
- **kısmen**: bir kısmı düzeltildi, kalanı sizin kararınız.
- **karar gerekli**: kod değişmedi; mimari bir değişiklik ya da sizin kararınız gerekiyor.

### Kritik

Kritik bulgu yok. Kimlik doğrulamasız biri internetten başka bir işletmenin verisine ulaşamadı, Mola Yönetim'e giremedi, kafe bilgisayarında komut çalıştıramadı.

### Yüksek

**Y1. Misafir menüsü Mola Yönetim ile aynı adreste açılabiliyordu (düzeltildi)**

- **Sorun:**
  - Misafir menüsünün sayfası ve dosyaları kafenin bilgisayarından gelir.
  - `MERKEZ_SITE_ORIGIN` verilmezse masa QR'ları `merkez.molayazilim.com.tr/q/...` adresini taşıyordu. Bu, Mola Yönetim'in kendi adresidir.
  - Program dosyaları değiştirilmiş (ya da ele geçirilmiş) tek bir kafe, kendi menü sayfasına istediği kodu koyabilir.
- **Etkisi:** Siz Mola Yönetim'e girişliyken o menüyü açarsanız, o kod sizin adınıza Mola Yönetim'de işlem yapabilirdi. Ayrıca bir başka işletmenin sahibi aynı telefonda "Raporlarım" ya da "Kafeyi yönet" kullanıyorsa, o kod sahibin cihaz anahtarlarını kullanabilirdi.
- **Düzeltme (sahibin kararı: ayrı alt alan adı):**
  - Misafir menüsü kendi adresinde açılır: `https://menu.molayazilim.com.tr/q/<kod>/<masa>` (`MERKEZ_MENU_ORIGIN`). Bu ad ne Mola Yönetim'in (`merkez.`) ne sitenin (`molayazilim.com.tr`) adıdır; tarayıcı çerezleri ve yerel kayıtları ada göre ayırdığı için orada başka bir adresin çerezi ya da anahtarı görünmez.
  - Merkez `/q/*`'yi yalnız istek bu adla geldiğinde açar. Başka bir adla gelen `/q/*` isteği `308` ile menü adresine gider (eski basılı QR'lar çalışır; POST reddedilir). Menü adında `/q/*` dışındaki her şey 404'tür: Mola Yönetim, `/api`, `/s/`, tünel.
  - Misafirin POST'u yalnız menü adresinden (`Origin`) kabul edilir. Misafir çerezi (`mola_browser`) `Domain` almaz: yalnız menü adına ve yalnız `/q/<kod>/` yoluna yazılır.
  - Merkez kalp atışında `guest.menu-origin` der ve menü adresini verir; yeni kafe bu durumda masa QR'ına Merkez'in kendi adresini asla koymaz (adres gelene kadar bekler). Eski Merkez'e bağlı kafe eskisi gibi; eski kafe yeni Merkez'den gelen menü adresini kullanır.
  - Caddyfile (VDS_KURULUM bölüm 13 ve Linux paketindeki örnek): `menu.` bloğu yalnız `/q/*`'yi Merkez'e iletir (Host olduğu gibi), gerisi 404. `merkez.` ve site bloklarında `/q/*` → `308` menü adresine. DNS'e `menu` A kaydı eklendi.
  - Sosyal medya kısa adresleri (`/s/`) sitede kaldı: yalnız işletmenin bağlantısına `302` ile yönlendirir, sayfa ya da kafeden gelen dosya sunmaz (D8 ayrı).
  - Yerel ağda (ev ağı provası, Mola Yönetim bilgisayardayken) hiçbir şey değişmez: `MERKEZ_MENU_ORIGIN` yoktur, QR'lar kafenin Wi-Fi adresini taşır.
- **Dosyalar:** `server/merkez/menu-host.ts` (yeni), `server/merkez/app.ts`, `server/merkez/guest-tunnel.ts`, `server/http-security.ts`, `server/kafe-link.ts`, `server/sync-protocol.ts`, `scripts/merkez-linux-paket.mjs`, `scripts/test-server.mjs`.
- **Testler:** `tests/guest-tunnel.test.ts` ("menu host"), `tests/browser/guest-internet.spec.ts` (menü `menu.localhost`'ta, Mola Yönetim `127.0.0.1`'de).
- **Ek (16 Ekim, sahibin kararı): Kafemi yönet de kendi adında.** İşletme sahiplerinin sayfası (cihaz anahtarları IndexedDB'de) `https://kafem.molayazilim.com.tr` adresine taşındı (`MERKEZ_OWNER_ORIGIN`, `server/merkez/owner-host.ts`, menü adresiyle aynı model). Böylece sahibin anahtarları ne Mola Yönetim'in (`merkez.`) çerezleriyle ne menünün adıyla aynı kökende durur; sahip "merkez" adını görmez.
  - `kafem.` adında Merkez yalnız sayfayı (`/`), derlenmiş dosyalarını (`/assets/…`, sayfanın adını verdiği simgeler) ve sayfanın yaptığı çağrıları tam olarak açar: `POST /api/merkez/v1/phone/login/start`, `login`, `live`, `status`, `postbox`, `forget`, `admin`. Gerisi 404 (`no-store`, `noindex`, her şeyi kapatan CSP): Mola Yönetim ve `/api/merkez/admin`, öteki sayfalar (`merkez.html`, `index.html`, manifestler), `/q/`, `/s/`, `/k/`, kafelerin imzalı çağrıları, sağlık adresi. (`/yonet` ve yazım biçimleri orada `308` ile `/`'a: elle yazılan adres.)
  - Bu adın `/api` istekleri yalnız bu kökenden (`Origin: https://kafem.…`) kabul edilir; `PUBLIC_ORIGIN`'den gelen ya da başka kökenli istek `ORIGIN_REJECTED` (`server/http-security.ts` `ownOrigins`). Host denetimi aynı: bilinmeyen ad 403.
  - `merkez.` adında Kafemi yönet sayfası **sunulmaz**: `/yonet`, `/raporlarim` ve yazım biçimleri bilinmeyen her adres gibi 404 (henüz müşteri olmadığı için eski adres yönlendirilmez; sahibin kararı). Sitedeki `/yonet`, `/raporlarim`, `/kafemi-yonet` kısa adres sayfaları `kafem.` adresine gönderir.
  - Değer https kök adresi olmalı ve `PUBLIC_ORIGIN`, `MERKEZ_SITE_ORIGIN`, `MERKEZ_MENU_ORIGIN` adlarından farklı olmalı; değilse yok sayılır ("MERKEZ_OWNER_ORIGIN yok sayıldı") ve her şey eskisi gibi `merkez.…/yonet`'te kalır. Yalnız tarayıcı testlerinde (`MOLA_TEST_TUNNEL=1`, sürüm derlemesinde asla) `http://kafem.localhost`.
  - **Testler:** `tests/owner-host.test.ts`, `tests/browser/owner-host.spec.ts` (sayfa `kafem.localhost`'ta).

**Y2. Uzaktan destek oturumunda kafeden gelen yanıtlar Mola Yönetim adresinde çalışabiliyordu (düzeltildi)**

- **Sorun:** Destek oturumunda kafenin ekranları Merkez'in adresinden açılır. Kafenin yanıtı, kafenin söylediği türle (ör. `text/html`) olduğu gibi sunuluyordu. Değiştirilmiş bir kafe, satıcının tarayıcısında Mola Yönetim adına kod çalıştırabilirdi.
- **Düzeltme:**
  - Yalnız bilinen türler geçer (JSON, resim, PDF, Excel). HTML yalnız yazdırma raporunda geçer.
  - Her yanıta "hiçbir şey çalışmaz" CSP'si (`sandbox`) ve `nosniff` eklendi.
  - Yazdırma önizlemelerindeki iframe'ler betik çalıştırmayan `sandbox` ile açılıyor (ReportSimple, İşlem kayıtları).
- **Dosyalar:** `server/merkez/relay.ts`, `src/ReportSimple.tsx`, `src/PlatformJournal.tsx`.

**Y3. Kafe: yoldaki harf büyüklüğü ya da sondaki "/" ile korumalar atlanıyordu (düzeltildi)**

- **Sorun:** Express, `/api/Staff/users` ya da `/api/staff/users/` isteğini de aynı işleme bağlıyordu. Önlerindeki korumalar ise yolu yazıldığı gibi karşılaştırıyordu. Bu yolla atlanabilenler:
  - Sahip hesabı otomatik kilidi: kilitli bir tarayıcıda konsoldan müdür hesabı açılabilirdi.
  - Uzaktan yönetimin "yalnız kafede" listesi: uzaktan yeni cihaz eşleştirme, Mola destek iznini açma, telefon kodu sorulmadan şifre değiştirme.
  - Hizmet paketi kısıtları.
- **Düzeltme:** Yollar artık yazıldığı gibi eşleşir. `/api` altında sondaki `/` 404 döner.
- **Dosya:** `server/app.ts`.

**Y4. Lisanslar ve güncellemeler aynı, çevrimiçi duran anahtarla imzalanıyor (karar gerekli)**

- **Sorun:** Merkez'in imza anahtarı VDS'te, veri anahtarıyla mühürlü duruyor. VDS'te anahtar parolası da aynı diskte.
- **Etkisi:** Sunucuyu ele geçiren biri (bir yazılım açığı, sızan bir disk yedeği) kendi güncelleme paketini imzalayabilir. Kafeler bu paketi kendiliğinden kurar: bütün kafelerde kod çalışır. Anahtarı değiştirmenin ya da iptal etmenin bir yolu da yok.
- **Öneri:**
  - Güncellemeler için ayrı ve çevrimdışı bir "yayın anahtarı" kullanılsın. Paket sizin Windows bilgisayarınızda imzalansın (`npm run yayinla`); Merkez yalnız önceden imzalanmış paketi dağıtsın.
  - Kafe paketine iki açık anahtar gömülsün ve güncellemede yayın anahtarı zorunlu olsun.
  - Bu, kafe paketinin yeniden dağıtılmasını gerektirir. VDS'ten ve ilk satışlardan **önce** yapılması en kolayıdır.
- **Sahibin kararı (11 Ekim):** lisans ve güncelleme imzası VDS'te kalır; şimdilik değişiklik yapılmadı.

### Orta

**O1. Merkez, kimliği olmayan birinden büyük istekleri okuyup ayrıştırıyordu (düzeltildi)**

- **Sorun:** Kafelerin imzalı çağrıları 3–15 MB'a kadar gövde kabul eder. İmza ise gövde tamamen okunup JSON olarak ayrıştırıldıktan sonra denetleniyordu. İnternetteki biri art arda büyük istekler göndererek 1 GB bellekli bir VDS'i kilitleyebilirdi.
- **Düzeltme:**
  - İmzalı yollarda başlıklar (biçim, bilinen kurulum, saat) gövdeden önce denetleniyor. Harf ve sondaki `/` hileleri de yakalanıyor.
  - Herkese açık yollar en çok 64 kB alıyor, parçalı (chunked) gövde kabul edilmiyor.
  - Telefonun 13 MB'lık uzaktan yönetim çağrısı adres başına gövdeden önce sayılıyor (büyük gövde dakikada 30).
- **Dosyalar:** `server/merkez/app.ts`, `server/merkez/remote-admin.ts`.

**O2. Müdür, sahibin rapor kodunu deneme yoluyla bulabilirdi (düzeltildi)**

- **Sorun:** Dakikada 8 deneme vardı ve sayaç her dakika sıfırlanıyordu. Bir ayda bulma olasılığı yaklaşık %65'ti.
- **Düzeltme:** 5 yanlıştan sonra her deneme iki kat bekler (1, 2, 4 … en çok 15 dk). Günde 50 yanlıştan sonra ertesi güne kadar kapalı.
- **Dosya:** `server/report-security.ts`.

**O3. Yazıcı adı olarak ağ yolu verilebiliyordu (düzeltildi)**

- **Sorun:** `\\sunucu\yazıcı` gibi bir ad, Windows'u o bilgisayara bağlatıp kafe bilgisayarındaki hesabın parola özetini (NTLM) gönderebilirdi. Mola destek oturumu da yazıcı ayarlayabiliyor.
- **Düzeltme:** Ağ yolu biçimindeki ad yalnız bu bilgisayarda kurulu bir yazıcıysa kabul edilir.
- **Dosya:** `server/printing.ts`.

**O4. Geliştirme modunda (`npm run dev:lan`) kaynak kodu yerel ağdan okunabiliyordu (düzeltildi)**

- **Sorun:** `/server/app` ya da `/package` gibi uzantısız adresler Vite'a gidiyor ve kaynak kod olarak dönüyordu.
- **Düzeltme:** Projedeki bir dosyaya ya da klasöre karşılık gelen uzantısız adres artık 404 döner. Kurulu paket bu modu hiç kullanmaz.
- **Dosya:** `server/web-serving.ts`.

**O5. Resim kitaplığı (sharp / librsvg) açığı (düzeltildi)**

- **Sorun:** `npm audit` "high" diyordu (sharp < 0.35.5, SVG okuyan librsvg). İşletme logosu yükleme yolu, "PNG" etiketli bir SVG'yi bu kitaplığa veriyordu.
- **Düzeltme:**
  - Logo ve ürün fotoğraflarında baytlara bakılıyor; yalnız gerçek PNG, JPEG ya da WebP kitaplığa gider. Merkez ekleri zaten böyleydi.
  - sharp 0.35.5'e yükseltildi (sahibin onayıyla npm'den; `package.json` tam sürüm). Kurulum paketleri her platformun dosyalarını sharp'ın kendi listesinden (aynı sürüm) alır: Windows (kafe ve Mola Yönetim) `@img/sharp-win32-x64`, macOS `@img/sharp-darwin-arm64/x64` + `sharp-libvips-…` 1.3.4, Linux ve Mola-Merkez-Linux `@img/sharp-linux-x64` + `sharp-libvips-linux-x64` 1.3.4. `npm audit --omit=dev`: 0 açık. (Kalan tek "high", yalnız derleme aracındaki `source-map-js`; pakete girmez.)

**O6. "Özelliksiz" lisans kopyasıyla hizmet paketi kısıtı aşılabiliyordu (düzeltildi)**

- **Sorun:** Merkez her lisansı iki biçimde gönderiyordu: eski kafeler için `features` alanı olmayan biçim ve yeni biçim (aynı seri numarası). Teknik bilgisi olan bir sahip, kendi bilgisayarındaki veriyi açıp özelliksiz kopyayı yazarsa, satın almadığı paketleri açabilirdi.
- **Düzeltme:**
  - Merkez artık yalnız tek lisans imzalar ve gönderir: her zaman `features` ile (etkinleştirme, içe aktarma, kalp atışı). Güncellenen Merkez ilk açılışta bağlı her işletmenin lisansını bir kez yeniden imzalar (katalog adımı 3, seri + 1, hizmetler aynı; İşlem kayıtları "Lisanslar tek kopya…").
  - Kafe: `features`'ı olmayan bir lisans "her şey açık" demek **yalnız** 12 Ekim 2026 00:00'dan (Türkiye) önce imzalanmışsa ve o işletme için bu bilgisayarda hiç `features`'lı lisans alınmamışsa geçerlidir; aksi hâlde yalnız temel hizmetler açılır. "Alındı" bilgisi hem kayıtta hem veri klasörünün dışındaki mühürlü izde (`lisans-izi`) tutulur.
  - Eski kurulum (yalnız eski kopyayı görmüş): bir sonraki kalp atışına kadar her şey açık kalır, kalp atışıyla gelen tek lisansla tam olarak ödediği hizmetlere geçer. Eski Merkez'in imzaladığı ikiz (aynı seri) `features`'lı kopya, özelliksiz kopyanın yerini alabilir; tersi olamaz.
  - Kalan risk: kendi bilgisayarının veri anahtarına sahip biri hem kaydı hem izi birlikte silip eski (12 Ekim öncesi) bir özelliksiz kopyayı yazabilir. Bunun için o kopyanın elinde olması gerekir; Merkez'in yeni lisansı daha yüksek seri numarasıyla ilk kalp atışında yeniden yazılır.
- **Dosyalar:** `server/merkez/store.ts` (`issue`), `server/merkez/catalog.ts` (adım 3), `server/merkez/app.ts`, `server/kafe-link.ts` (`LEGACY_LICENCE_UNTIL`, `accept`, `listedFeatures`).
- **Testler:** `tests/feature-gate.test.ts` ("O6"), `tests/merkez-packages.test.ts` ("O6"), `tests/social-package.test.ts`.

**O7. Kafe girişinde deneme sınırı her dakika sıfırlanıyor (karar gerekli)**

- **Sorun:** Kullanıcı ve cihaz başına dakikada 12 yanlış hakkı var. Kafe ağında birden çok adres kullanan biri, bir kullanıcının şifresini uzun sürede deneyebilir.
- **Öneri:**
  - Giderek artan bekleme ve kullanıcı başına günlük tavan.
  - Çok yanlış denemede sahibe bildirim.
  - Personel şifrelerinde en az 10 karakter kuralı sürsün.

**O8. Kafe ağı düz HTTP (karar gerekli, mimari)**

- **Sorun:** Misafirler QR menü için aynı Wi-Fi'ye bağlanırsa, ağ şifresini bilen biri personel giriş şifresini ve oturum çerezini görebilir.
- **Öneri:**
  - Misafir ağı ile personel/kasa ağı ayrılsın (modemde "misafir ağı").
  - İnternetten menü (VDS) hazır olunca misafirler kafenin Wi-Fi'sine hiç gerekmez.
  - İleride kalıcı yerel HTTPS düşünülebilir.

### Düşük

| No | Bulgu | Durum |
|---|---|---|
| D1 | "Şifrem"de mevcut şifre sınırsız denenebiliyordu (açık kalan bir tablet). Artık 15 dakikada 5 yanlış. `server/management.ts` | düzeltildi |
| D2 | Hazırlanmış bir yedek dosyası, geri yüklemede yıl paketini başka bir klasöre ya da ağ yoluna yönlendirebiliyordu. Artık ad her zaman `yil-YYYY.sqlite`. `server/backup.ts` | düzeltildi |
| D3 | Beklenmeyen bir hatada Express'in kendi sayfası yığın izi ve klasör yolu gösterebiliyordu. Artık göstermiyor (kafe, Merkez, kilitli ve geri yükleme ekranları). | düzeltildi |
| D4 | Yazdırma ve rapor sayfaları (`/api/staff/reports/document`, Satışlarım raporu) CSP'siz sunuluyordu; CSP eklendi. PDF'i üreten Edge/Chrome'da betiği kapatmak (`scriptEnabled=false`) PDF üretimini bozdu, geri alındı: sayfalarda betik yok ve bütün metinler kaçışlı (escape), risk düşük. | düzeltildi (PDF: bilgi) |
| D5 | Kafe, fotoğraf ve destek eki yollarında 8/15 MB'lık gövdeyi oturum denetiminden önce okuyor. Yalnız yerel ağdan, saldırı etkisi sınırlı. | karar gerekli |
| D6 | Kafe, saat farkını imzasız bir "saat farklı" yanıtından öğreniyor. Araya giren biri lisansı "süresi dolmuş" gösterebilir; lisans uzatamaz. | karar gerekli |
| D7 | Müdür, eski günlerin ödemelerini de iade edebiliyor (rapor kodu sorulmadan). Rehberdeki "Müdür: İade sınırsız" kararıyla uyumlu olabilir. Bilerek mi? | karar gerekli |
| D8 | `/s/<kod>/website`, işletmenin kendi yazdığı herhangi bir HTTPS siteye yönlendirir. Marka adresinden (`molayazilim.com.tr/s/…`) yönlenen bir bağlantı oltalama için kullanılabilir. Yalnız lisanslı işletmeler, siz askıya alabilirsiniz. | karar gerekli |
| D9 | Etkinleştirme kodunda bütün adreslerden 10 dakikada 300 yanlış olunca herkes bekliyor. Bir saldırgan yeni kurulumların etkinleşmesini geciktirebilir. Web sitesi formunda da günlük 200 talep tavanı doldurulabilir. | bilgi |

### Bilgi

- **Mola Yönetim internetten açılıyor.** `PUBLIC_ORIGIN` varken bu, tasarımın kendisidir. Şifre, iki adımlı giriş ve artan bekleme var. Daha sıkı istenirse Caddy'de IP kısıtı ya da SSH tüneli (VDS_KURULUM bölüm 14).
- **Kurulum imzası sorgu dizesini kapsamıyor.** Bugün hiçbir imzalı yol sorgu okumuyor. İleride okuyan bir yol eklenirse imza genişletilmeli.
- **AES-GCM etiket uzunluğu sabitlenmemiş** (`authTagLength: 16`). İstismar yolu yok.
- **Güncelleyici, yerel `bekleyen.json` dosyasına güveniyor.** Yazabilen yerel bir program zaten aynı kullanıcıdır.
- **Tanıtım işletmesi personel şifresi sabit** (`Tanitim-2026!`). Yalnız tanıtım işletmeleri için.
- **Kafe paketi hazırlanırken anahtar verilmezse** (`MOLA_MERKEZ_PUBLIC_KEY`) paket, geliştirme Merkezi'nin anahtarını ve `127.0.0.1` adresini gömüyor. VDS paketi için mutlaka anahtar ve adres verin (VDS_KURULUM bölüm 13).
- **Kafe paketinde Mola Yönetim arayüz dosyası da var.** Gizli bilgi değil.
- **Mola destek isteklerinde "yerel değil" işareti yok.** Şu an izin listesi kapattığı için istismar edilemiyor.
- **Kilitli sahip oturumu canlı durumu okumaya devam ediyor.** Salon çalabilsin diye tasarım gereği.
- **Vardiya kodu kullanılana kadar geçerli.** 5 denemede kilit var; etkisi yalnız vardiya kaydı.
- **Sunucu yedeğinin dosya listesinde sayı ve ad sınırı yok** (Windows'a özel adlar dahil). İkinci yedek yerinde `realpath` yerine `resolve` kullanılıyor. İkisi de yalnız kendi kurulumu ya da masaüstü anahtarıyla.
- **`source-map-js` açığı** yalnız derleme aracında (Vite). Pakete girmiyor.
- **Sağlam bulunanlar:**
  - Rol tablosu her işlemde sunucuda denetleniyor. Müdür beklenen nakdi ve kasa farkını görmüyor. Mutfak fiyat ve misafir adı almıyor. Garson rezervasyon telefonunu okumuyor.
  - Oturum çerezleri HttpOnly, SameSite=Strict, HTTPS'te Secure.
  - CSRF koruması (JSON zorunlu, Origin denetimi) ve Host denetimi (DNS rebinding) var.
  - Kurulum HMAC'i: zaman penceresi, tek kullanımlık nonce, sabit zamanlı karşılaştırma.
  - Tünelin iki uçlu izin listesi var.
  - İşletmeler arası ayrım: sunucu yedeği, ekler, menü kopyası ve fotoğraflar hep kendi kurulumu ya da işletmesi.
  - Güncelleme paketinde imza açmadan önce denetleniyor; zip-slip ve sürüm geri alma yok.
  - Lisans saati geri alınamıyor.
  - Uçtan uca raporlarda X25519 ve AES-GCM kullanılıyor.
  - Şifreler scrypt ile saklanıyor; TOTP'de aynı kod iki kez kullanılamıyor.
  - Paketlerde özel anahtar ya da demo şifresi yok.

## Gerçek VDS'te denenecekler

`docs/VDS_KURULUM.md` bölüm 14'teki listeyi sırayla uygulayın. Özellikle şunlara bakın:

1. `MERKEZ_MENU_ORIGIN=https://menu.molayazilim.com.tr` ayarlı ve DNS'te `menu` kaydı olsun. `curl -sI https://merkez.molayazilim.com.tr/q/AAAAAAAAAA/x` ve `curl -sI https://molayazilim.com.tr/q/AAAAAAAAAA/x` → `308`, `menu.` adresine; `curl -sI https://menu.molayazilim.com.tr/` → `404`. Kafemi yönet için `docs/KAFEM_ADRESI.md` 4. adım: `kafem.` kökü 200, `merkez.…/yonet` → 404, `kafem.…/api/merkez/admin/state` → 404.
2. Bir masa QR'ını mobil veriyle açın, sipariş verin: adres çubuğunda `menu.molayazilim.com.tr`. Tarayıcının geliştirici araçlarında `/q/` yanıtlarında **tek** CSP başlığı olmalı; Uygulama → Çerezler'de yalnız `mola_browser` (yolu `/q/<kod>/`).
3. Caddy'nin `X-Forwarded-For`'u kendisi yazdığını doğrulayın: dışarıdan `X-Forwarded-For: 1.2.3.4` gönderilen istekte Merkez'in hız sınırı sizin gerçek adresinizi saymalı. Mola Yönetim'de 6 yanlış girişten sonra bekleme, başlığı değiştirince kalkmamalı.
4. 1 MB'lık gövdeyle `/api/merkez/v1/relay/poll` → hemen `401`.
5. `systemd-analyze security mola-merkez`, `ss -ltnp` (4000 yalnız 127.0.0.1), `ufw status`, `fail2ban-client status sshd`.
6. Bir kafeyle tam tur: etkinleştirme, kalp atışı, sunucu yedeği, destek oturumu (yazdırma önizlemesi açılıyor mu), Raporlarım, Kafeyi yönet, güncelleme indirme.
7. Sertifika, HSTS ve HTTP'den HTTPS'e yönlendirme; `nmap` ile yalnız 22, 80 ve 443 açık.

## Testler

- `tests/security-audit.test.ts` (8 test):
  - Merkez'in kimliksiz büyük gövdeyi okumaması (imzalı yollar, harf hileleri, parçalı gövde, telefon sınırı).
  - Mola Yönetim'in yalnız bu bilgisayardan açılması (sahte `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, yabancı `Host`).
  - `/q/` üzerinden 20'den fazla yol hilesi ve yöntem, başka siteden POST, kafeye sahte tünel işareti.
  - Kafede harf ve sondaki `/` hileleri, ağ yazıcısı, rapor kodu ve "Şifrem" denemeleri.
  - Destek yanıt türleri, geliştirme sunucusunun kaynak dosyaları, hazırlanmış yedek, SVG logo.
- Bütün birim testleri, derleme ve tarayıcı testleri bu değişikliklerle yeniden çalıştırıldı (sonuç `docs/TOPARLAMA_PLANI.md` durum satırında).

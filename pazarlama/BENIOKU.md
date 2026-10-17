# Mola Pazarlama

Elazığ'daki kafe, restoran, pastane/tatlıcı, çay bahçesi gibi işletmelerin **herkese açık** iletişim bilgilerini
(Instagram, e-posta, telefon, web) bir listede toplar. Kime yazdığınızı, kimin cevap verdiğini, kime gideceğinizi
buradan takip edersiniz.

Mola uygulamasından, Merkez'den ve siteden **ayrı**, yalnızca bu bilgisayarda çalışan küçük bir araçtır.

- Kendiliğinden **hiç kimseye mesaj atmaz.** Mesajı her zaman siz elle atarsınız.
- Instagram, Facebook, TikTok **taranmaz**. Takipçi sayısı, son gönderi gibi bilgileri profili açtığınızda siz
  işaretlersiniz (birkaç saniye sürer).

## Başlatmak

Depo klasöründe:

```
npm run pazarlama
```

Tarayıcıda `http://localhost:3700` açılır. Kapatmak için komut penceresinde `Ctrl+C`.

- Yalnızca bu bilgisayardan açılır (127.0.0.1). Aynı ağdaki başka bir cihaz açamaz.
- Veriler `.local/pazarlama/veri.json` dosyasındadır. Bu dosya git'e girmez. Yedeklemek için bu dosyayı kopyalayın.
- İlk açılışta liste boştur. **Topla** sekmesinden "OpenStreetMap'ten getir" düğmesine basın.

## Ekranlar

- **Liste**: Bütün işletmeler. Tür, ilçe, mahalle, durum, "Instagram var/yok", "e-posta var", "zincirleri gizle"
  filtreleri, arama ve sıralama var. Filtreler bu tarayıcıda hatırlanır. "CSV indir (Excel)" o an görünen kayıtları indirir.
- **İşletme kartı**: Satıra tıklayınca açılır. Her alan değiştirilebilir ve değişiklik hemen kaydedilir.
  - Durum: Bulundu → Takip edildi → Mesaj atıldı → Cevap verdi → Ziyaret/görüşme → Pilot → Müşteri (ya da İlgilenmiyor).
    Durum her değiştiğinde notlara tarihli bir satır düşer.
  - Notlar: tarihli. Hazır notlar ("Instagram'dan yazdım" gibi) tek dokunuşla eklenir.
  - Sonraki takip: tarih ya da "Yarın / +3 gün / +1 hafta / +2 hafta".
  - "İşine yatırım yapıyor mu?": takipçi (<1K, 1–5K, 5–20K, 20K+ ya da tam sayı), son gönderi (son 1 hafta / son 1 ay /
    daha eski / hiç, ya da tarih), kampanya/duyuru yapıyor, menü (yok / kâğıt / QR var).
  - Instagram yoksa: "Instagram'da ara", "Google: Instagram", "Google Haritalar" bağlantıları. Bulduğunuz profil
    adresini Instagram alanına yapıştırın (`instagram.com/...`, `@ad` ya da `?igsh=...` ekli adres olur).
  - Kaydı sil: işletme isterse bilgilerini buradan silersiniz.
- **Bugün**: Takip tarihi bugün ya da geçmiş olanlar (müşteri ve ilgilenmeyenler hariç). Üstteki sekmede sayısı görünür.
- **Ziyaret listesi**: Öncelik puanı eşiğin üstünde olan, henüz yazılmamış (Bulundu / Takip edildi) ve zincir olmayan
  işletmeler, **mahalleye göre gruplu** (yürüyerek gezmek için). Eşiği sayfada değiştirebilir, listeyi yazdırabilirsiniz.
  "Gittim" düğmesi durumu Ziyaret/görüşme yapar.
- **Topla**: Üç kaynak (aşağıda). İlerleme ve "yeni / güncellenen / değişmeyen" özeti görünür.

## Kaynaklar

### 1. OpenStreetMap (ücretsiz)

Overpass API'ye tek bir sorgu gönderilir: Elazığ il sınırındaki (ya da yalnızca Merkez ilçedeki) kafe, restoran,
hızlı yemek, dondurmacı, bar, pastane/şekerci ve fırınlar. Ad, adres, ilçe, mahalle, konum, telefon, web, e-posta ve
kayıtlıysa Instagram/Facebook/TikTok gelir.

- Mahalle, OSM'deki mahalle sınırından bulunur. Sınır yoksa en yakın mahalle noktası yazılır ve yanına "~" /
  "(yaklaşık)" konur.
- Sonuç 24 saat saklanır (`.local/pazarlama/onbellek`). Aynı gün yeniden basarsanız sunucuya tekrar sorulmaz.
  Tazelemek için "Yeniden sor" kutusunu işaretleyin.
- Overpass ücretsiz ve herkesin ortak sunucusudur. Bazen "meşgul" der. Birkaç dakika sonra tekrar deneyin.
- **Önemli:** Elazığ'da OSM'ye girilmiş işletme sayısı azdır (Ekim 2026'da tüm ilde adı olan yaklaşık 30 kayıt).
  Listeyi asıl dolduracak kaynak Google'dır.

### 2. Google Haritalar (isteğe bağlı, anahtar gerekir)

Places API (New) "Text Search" ile "kafe Elazığ", "pastane Elazığ" gibi aramalar yapılır. Her arama en fazla 3 sayfa
(60 sonuç) getirir. Ad, adres, mahalle, telefon, web sitesi, Google puanı, yorum sayısı ve harita bağlantısı gelir.
Birçok esnaf Instagram'ını "web sitesi" diye yazar. Böyle bir adres Instagram (ya da Facebook/TikTok) alanına taşınır.

- Düğmeye basmadan önce en fazla kaç istek yapılacağı yazar (arama sayısı × 3, varsayılan 30).
- **Ücret:** Google her ay belli bir ücretsiz kullanım verir, üstünde ücret alır. Telefon, web, puan gibi alanlar
  istendiği için bu aramalar Places'in pahalı basamağındadır. **Güncel fiyatı ve ücretsiz kotayı Google Cloud'un
  fiyat sayfasında kontrol edin.**
- Anahtar yoksa bu kaynak kapalıdır.

**Anahtar almak:**

1. https://console.cloud.google.com adresine Google hesabınızla girin. Yeni bir proje açın (ör. "Mola Pazarlama").
2. **Faturalandırma** hesabı bağlayın (kart ister). Google, ücretsiz kota için bile bunu şart koşar.
3. "API'ler ve Hizmetler → Kitaplık" bölümünde **Places API (New)** arayın ve **Etkinleştir**'e basın.
   (Eski "Places API" değil, "(New)" olan.)
4. "API'ler ve Hizmetler → Kimlik bilgileri → Kimlik bilgisi oluştur → API anahtarı".
5. Anahtarı **kısıtlayın**: "API kısıtlamaları"nda yalnızca **Places API (New)** seçin. İsterseniz "Bütçeler ve
   uyarılar"dan küçük bir aylık bütçe uyarısı da kurun.
6. `pazarlama/ayarlar.ornek.json` dosyasını `pazarlama/ayarlar.json` adıyla kopyalayın. Anahtarı
   `"googleApiAnahtari"` alanına yapıştırın. `ayarlar.json` git'e girmez. Anahtarı kimseyle paylaşmayın.
7. Aracı kapatıp açmanıza gerek yok. Topla sayfasını yenileyin, düğme açılır.

Aramaları `ayarlar.json` içindeki `"googleAramalari"` listesinden değiştirebilirsiniz.

### 3. Web sitelerinden e-posta / Instagram

Kendi web sitesi olan işletmelerin (Instagram/Facebook adresi değil) **yalnızca ana sayfasına**, orada e-posta ya da
Instagram yoksa en fazla bir **İletişim** sayfasına bakılır. `mailto:` bağlantıları, sayfada görünen e-postalar ve
Instagram/Facebook/TikTok/X/WhatsApp bağlantıları alınır.

- Kibar çalışır: robots.txt'e uyulur, saniyede en fazla 1 istek, 10 saniye zaman aşımı, sayfa başına en fazla 600 KB.
- Her site bir kez taranır. Kartta web adresini değiştirirseniz site yeniden taranır.

### 4. Elle

"+ İşletme ekle" ile listede olmayan bir yeri eklersiniz. Kartta elle değiştirdiğiniz bir alanın **üstüne kaynaklar bir
daha yazmaz** (ör. düzelttiğiniz bir telefonu Google geri bozmaz).

### Aynı işletme iki kez gelirse

Kaynaklar birleştirilir. Aynı işletme sayılma şartları:

- Adın ayırt edici kısmı aynıysa (ya da biri ötekini içeriyorsa) ve aralarında 80 metreden az mesafe varsa. "Cafe",
  "restoran", "pastanesi" gibi genel sözcükler karşılaştırmaya girmez.
- Ya da telefon, web sitesi veya Instagram aynıysa ve aralarında 300 metreden az mesafe varsa. Zincirin başka
  şubeleri aynı telefonu kullanabilir, bu yüzden mesafeye de bakılır.

### Zincirler

Starbucks, Kahve Dünyası, Simit Sarayı, Burger King, McDonald's, Domino's gibi zincirler işaretlenir. Bunlarda karar
genelde genel merkezdedir. Listede "Zincirleri gizle" varsayılan olarak açıktır. Liste `ayarlar.json` →
`"zincirler"` alanındadır, istediğiniz adı ekleyip çıkarabilirsiniz. Kartta "Zincir / Zincir değil" seçerek tek bir
kaydı elle de düzeltebilirsiniz.

## Öncelik puanı (0–100)

Satın alma ihtimali yüksek işletmeyi bulmak için: işine yatırım yapan, sosyal medyada etkin, kampanya yapan.
Puan iki bölümün toplamıdır, 100'de kesilir:

| İşaret | Puan |
|---|---|
| **Elle (profil açılınca)** | |
| Instagram takipçi | 20K+ → 25 · 5–20K → 20 · 1–5K → 12 · 1K altı → 5 |
| Son gönderi | son 1 hafta → 15 · son 1 ay → 10 · daha eski → 3 · hiç → 0 |
| Kampanya/duyuru yapıyor | 10 |
| Menü | kâğıt menü → 10 · menü yok → 6 · QR menü var → 3 |
| **Otomatik** | |
| Google puanı | 4,3+ → 6 · 4,0+ → 4 · daha düşük → 1 |
| Google yorum sayısı | 500+ → 10 · 100+ → 7 · 30+ → 4 · 1+ → 1 |
| Kendi web sitesi var | 6 |
| Instagram hesabı biliniyor | 8 |
| E-posta biliniyor | 3 |
| Açılış saatleri girilmiş | 3 |
| OSM kaydının doluluğu (telefon, web/sosyal, adres, saat, mutfak) | 0–4 |

- Zincirlerde toplam **0,2 ile çarpılır.**
- Son gönderi için tarih girildiyse kova o günün tarihine göre hesaplanır.
- **Ziyaret listesi** eşiği varsayılan olarak 30'dur.
- Kartta "Neden?" bölümü puanın nereden geldiğini gösterir.
- Bütün sayılar `ayarlar.json` → `"oncelik"` bölümünden değiştirilebilir. Basamaklı olanlar `[eşik, puan]`
  çiftleridir. Örneğin QR menüsü olanı daha çok istiyorsanız `"menu": { "qr": 10 }`.

Yalnızca otomatik işaretlerle en fazla 40 puan alınabilir. Eşiği geçmek için genellikle ya Google verisi ya da elle
işaretleme gerekir. Bu bilinçli: yürüyerek gideceğiniz yerleri profilini gördüğünüz işletmelerden seçmeniz için.

## KVKK ve İYS notu (hukuki danışmanlık değildir)

- Yalnızca işletmenin **herkese açık işletme iletişim bilgileri** tutulur (işletme Instagram'ı, işletme e-postası,
  işletme telefonu). Çalışanların ya da sahiplerin kişisel hesaplarını, ev telefonlarını yazmayın.
- Esnaf ve tacirlere gönderilen B2B tanıtım mesajları için önceden onay (İYS kaydı) genelde gerekmez. Ancak:
  - Her mesajda kim olduğunuzu açıkça yazın (Mola, Emirhan İspir, destek@molayazilim.com.tr).
  - Her mesaja kolay bir **"istemiyorum"** yolu koyun (ör. "Bir daha yazmamamı isterseniz söylemeniz yeter.").
  - "İstemiyorum" diyen işletmeyi **İlgilenmiyor** yapın ve bir daha yazmayın.
- İşletme bilgilerinin silinmesini isterse kartındaki **Kaydı sil** ile hemen silin.
- Gerekmeyen kayıtları zaman zaman temizleyin. Veri yalnızca bu bilgisayardadır, kimseyle paylaşılmaz.
- Instagram, Facebook ve TikTok **taranmaz**. Bu platformların kuralları otomatik veri toplamayı yasaklar. Takipçi
  ve gönderi bilgisini profili kendiniz açıp işaretlersiniz.
- Google verisini Google'ın kullanım koşullarına uygun kullanın. Listeyi başkasına satmayın ya da yayımlamayın.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `sunucu.ts` | Yerel sunucu (127.0.0.1:3700) ve API |
| `topla.ts` | Toplama işleri. Komut satırından: `npx tsx pazarlama/topla.ts osm [--il] [--yenile]`, `... web 20`, `... ozet` |
| `kaynaklar/osm.ts`, `google.ts`, `web.ts` | Üç kaynak |
| `yardimci.ts` | Eşleştirme, zincir, sosyal adres, e-posta bulma, CSV, öncelik puanı |
| `depo.ts` | `.local/pazarlama/veri.json` okuma/yazma |
| `arayuz/` | Ekran (HTML, CSS, JS) |
| `ayarlar.ornek.json` | Ayar örneği. `ayarlar.json` adıyla kopyalanır |
| `test/` | Testler: `npm run test:pazarlama` |

## Bilinen sınırlar

- OSM'de Elazığ verisi azdır. Google anahtarı olmadan liste kısa kalır.
- Mahalle bazen yaklaşıktır ("~"). OSM'de mahalle sınırı olmayan yerlerde en yakın mahalle noktası kullanılır.
- Web taraması yalnızca ana sayfaya ve bir iletişim sayfasına bakar. JavaScript ile sonradan yüklenen e-postaları
  göremez.
- Harita yok. Ziyaret listesi mahalleye göre gruplanır, her satırda "Harita" bağlantısı vardır.
- Aynı anda tek bir toplama işi çalışır.

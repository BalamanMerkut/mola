# İşlem kayıtları (Mola Merkez) — yöntem ve bağımsız denetim

Bu belge, Mola Yönetim'in **İşlem kayıtları**nın nasıl tutulduğunu ve bir kopyanın Mola olmadan nasıl denetleneceğini anlatır.
Bir gün resmî bir makama kayıt verilirse bu belge de verilebilir.

## Ne kaydedilir

Mola Yönetim'de ve Mola Merkez'de yapılan her işlem ve her güvenlik olayı:

- Yönetici girişi (başarılı / başarısız / çok denemede durdurulan), çıkış, şifre ve iki adımlı giriş değişiklikleri, "Şifremi unuttum" ve `Sifre-Sifirla`, güvenlik doğrulamasında yanlış şifre/kod
- Veri anahtarı olayları: korumaya alınma, kilitli açılış, kurtarma koduyla kilit açma (başarılı/başarısız), uyarılar; kurtarma kodunun gösterilmesi, kaydedilmesi, yenilenmesi
- Lisans: oluşturma, kod, uzatma, plan değişikliği, askıya alma/açma (nedeniyle), silme; dondurma; hizmet paketi; tanıtım işletmesi ve sıfırlamaları; sahip şifresi kodu
- Başvurular: geliş, düzeltme, onay (ek şube), ret
- Güncellemeler: paket yükleme (ekrandan, çalışma klasöründen ya da `npm run yayinla` ile), not, pilot, herkese, durdurma, silme; işletmenin Mola sürümünün değişmesi
- Destek: yanıt, kapatma, hata raporu indirme; uzaktan destek izni, oturum başlangıç/bitiş ve **oturumdaki her değişiklik** (ekranın isteği ve sonucu; içerik yok)
- İşletme sahibinin uzaktan yönetim oturumları: başlangıç ve bitiş (kafenin bildirdiği; yalnız zaman ve neden, içerik yok)
- Ayarlar: e-posta (eski → yeni; uygulama şifresi hiçbir zaman), iletişim bilgileri (eski → yeni), ikinci yedek yeri, çalışma klasörü, saklama süresi, Merkez adresi; geliştirici erişim anahtarı oluşturma / iptal / reddedilen kullanım
- Yedek: "Şimdi yedekle" ve gece yedeği (başarılı/başarısız), yedekten geri yükleme
- İşlem kayıtlarının kendisi: başlatılma, geçmiş kayıtların aktarılması, rapor alınması, saklama süresiyle silme, bütünlük bozulması

**Hiçbir zaman yazılmaz:** şifreler, kodlar (etkinleştirme, sıfırlama, kurtarma), anahtarlar, erişim anahtarları, SMTP şifresi, fatura bilgisi değerleri, satış verisi.

Her kayıtta: zaman (ISO, UTC; ekranda Türkiye saati), kim (`actor`: yönetici / Mola Merkez / işletmenin bilgisayarı / geliştirici erişimi + ad), işlem kodu ve düz Türkçe açıklama, hedef ve işletme (ad + kimlik), değişikliklerde alan alan eski → yeni, nereden (`source`: bu bilgisayar / yerel ağ / uzak / sistem; bu bilgisayar dışından gelen isteklerde IP adresi, **1 yıl** tutulur, aşağıda), sonuç (başarılı / başarısız / reddedildi). Web sitesi formunun ziyaretçisinin adresi hiç yazılmaz.

## IP adreslerinin 1 yıl sonra silinmesi (8 Ekim)

Kişisel veri sayılabilecek IP adresleri kayıttan bir yıl sonra silinir; zincir yine baştan sona doğrulanabilir kalır:

- **8 Ekim'den sonraki kayıtlar:** adres zincirdeki içeriğe hiç girmez. Kayıtta yalnız `addressMark` = SHA-256(`"mola-islem-adres-1\n"` + 16 baytlık rastgele tuz (onaltılık) + `"\n"` + adres) bulunur; adres ve tuz ayrı bir mühürlü tabloda (`islem_adresleri`) durur. Adres dururken denetim adresin bu özete uyduğunu da kontrol eder (adres sonradan değiştirilirse "adres bilgisi değiştirilmiş"). Bir yıl dolunca yalnız ayrı tablodaki satır silinir: hiçbir kaydın özeti değişmez, tuz olmadığı için özetten adres de bulunamaz.
- **8 Ekim'den önceki kayıtlar:** adres içeriğin parçasıydı. Bir yıl dolunca içerik adres olmadan yeniden mühürlenir ve `masked: { fields: ["address"], at }` alanını alır; kaydın sırası, zamanı, zincirdeki özeti (`hash`) ve önceki özeti değişmez (veritabanı bunları değiştiren güncellemeyi reddeder). Aynı anda zincire bir **"1 yılı geçen kayıtların IP adresleri silindi"** (`journal.addresses_masked`) kaydı eklenir; `masks` alanı her maskelenen kaydı `{ seq, hash: zincirdeki (eski) özet, masked: yeni içeriğin özeti }` olarak sayar. Denetim maskelenmiş bir kaydı yalnız bu listede sayıldığı haliyle kabul eder; sonradan yapılan her değişiklik "içeriği değiştirilmiş" olarak bulunur. Maskelemeden önceki içerik (adresli hali) ancak daha önce alınmış bir kopyayla karşılaştırılabilir.
- Denetlenebilir kopyada (JSONL) adresi duran kaydın satırında `adres: { address, salt }`, maskelenmiş kaydın satırında `maskedHash` bulunur. Çalışma klasörünün günlük dosyalarında adres hiç yoktur; maskelenen bir günün eski `.onceki-` kopyaları silinir.
- Silme günde dört kez kendiliğinden yapılır (Mola Merkez `retention`).

## Nasıl korunur

- Kayıtlar `merkez.sqlite` içindeki `islem_kayitlari` tablosuna **yalnız eklenir**. SQLite tetikleyicileri UPDATE'i ve DELETE'i reddeder; tek istisna, saklama süresi dolan en eski kayıtları silen günlük temizliktir (en az 2 yıl, varsayılan 10 yıl).
- Her satırın içeriği Merkez veri anahtarından türetilen anahtarla AES-256-GCM ile mühürlüdür ve satırın sıra numarasına bağlıdır (başka satıra taşınamaz).
- **Zincir:** `hash = SHA-256(kanonik JSON(entry))`. `entry` kendi sıra numarasını (`seq`) ve bir önceki kaydın özetini (`prev`) içerir; ilk kaydın `prev` değeri 64 sıfırdır (ya da saklama temizliğinin bıraktığı başlangıç özeti).
- **Mühür:** saatte bir (ve her rapordan, her günlük nottan önce) zincirin başı Mola Merkez'in Ed25519 anahtarıyla (lisansları imzalayan anahtar, ayrı alan adıyla) imzalanır: ileti `"mola-islem-muhur-1\n" + kanonik JSON({at, count, head, keyId, seq, v})`. Mühür, son kayıtların silinmesini ve zincirin baştan yeniden yazılmasını görünür kılar.
- **Denetim:** Mola Yönetim → Ayarlar → İşlem kayıtları her açılışta zinciri baştan sona denetler: "Kayıtlar bütün" ya da "Zincir N. kayıtta bozuk: …" (eksik / değiştirilmiş / sırası değişmiş / mühür tutmuyor). Bozulma Bildirim merkezine de düşer.
- **Dışarıdaki kopyalar:** çalışma klasöründeki günlük dosyalar (`islem-kayitlari\GGGG-AA-GG.jsonl`), alınan raporlar ve JSONL kopyaları ayrı yerde durur. Veritabanına ve anahtara erişen biri zinciri baştan yazıp yeniden mühürleyebilir; bu, **daha önce alınmış** bir kopya ya da günlük dosyayla karşılaştırınca ortaya çıkar (bu yüzden mühür parmak izi her raporun kapağında yazar).

### Kanonik JSON

Nesne anahtarları UTF-16 kod birimi sırasıyla dizilir, boşluk yoktur, `undefined` alanlar yazılmaz, diziler sırasıyla, metinler `JSON.stringify` kurallarıyla (UTF-8). Örnek: `{"b":1,"a":[true,"ğ"]}` → `{"a":[true,"ğ"],"b":1}`.

### Geçmiş kayıtlar

Bu sürümden önceki "İşlem geçmişi" listesi (en çok son 2000 satır) ilk açılışta **tek bir kayıt** olarak zincire aktarıldı: `journal.legacy_imported` ("Geçmiş kayıtlar aktarıldı"). Kaydın `legacy.entries` alanı eski satırları, `legacy.hash` bunların kanonik JSON'unun SHA-256'sını taşır. Bu satırların kendi aralarında zinciri yoktur (o zaman tutulmuyordu); blok bir bütün olarak korunur.

## Rapor almak

Mola Yönetim → Ayarlar → İşlem kayıtları → süzgeçler (tarih, işletme, kim, işlem türü, sonuç, arama) → **Rapor al**:

- **PDF**: kapak sayfası (dönem, süzgeçler, kayıt sayısı, zincir denetimi, mühür no/zaman/parmak izi, Merkez anahtarının parmak izi), ardından tablo (no, zaman, kim · nereden, ne yapıldı, işletme, ayrıntı). Bilgisayardaki Edge/Chrome ile üretilir.
- **Excel**: aynı satırlar, her satırın özetiyle; ikinci sayfada rapor bilgisi.
- **Denetlenebilir kopya (JSONL)**: yalnız tarih aralığı uygulanır (bağımsız denetim için dönemin bütün kayıtları kesintisiz gerekir). İlk satır `baslik` (biçim, dönem, ilk/son no, ilk kaydın `prev`'i, Merkez açık anahtarı), sonra her kayıt `{"type":"kayit","hash":…,"entry":{…}}`, sonra dönemdeki mühürler, en sonda `son` (kayıt sayısı, son özet).

Her rapor alma işlemi de bir kayıttır.

## Bağımsız denetim

Node.js yeterli, başka paket gerekmez (`scripts/islem-dogrula.mjs`, Mola'nın kodunu kullanmaz):

    node scripts/islem-dogrula.mjs islem-kayitlari-2026-10-01-2026-10-31.jsonl
    node scripts/islem-dogrula.mjs C:\MolaCalisma\islem-kayitlari
    node scripts/islem-dogrula.mjs kopya.jsonl --anahtar merkez-public-key.txt

Çıktı "Kayıtlar bütün: N kayıt (#a – #b), M mühür doğrulandı" ya da "BOZUK: Zincir N. kayıtta bozuk: …" (çıkış kodu 0 / 1). Dosyadaki açık anahtar yerine bilinen anahtarı (`--anahtar`) vermek daha güçlüdür; yazdırılan parmak izini raporun kapağıyla ve Mola Yönetim kurulumundaki `merkez-public-key.txt` ile karşılaştırın.

Elle (başka bir dilde) denetlemek için: her satırda `entry`'nin kanonik JSON'unun SHA-256'sı `hash`'e eşit olmalı (maskelenmiş kayıtta — `entry.masked` var — bunun yerine `journal.addresses_masked` kaydının `masks` listesindeki `masked` değerine, `hash` de listedeki `hash`'e eşit olmalı; o kayıt dosyada yoksa satırın `maskedHash`'ine; satırda `adres` varsa SHA-256(`"mola-islem-adres-1\n" + salt + "\n" + address`) `entry.addressMark`'a eşit olmalı); `entry.prev` bir önceki satırın `hash`'i olmalı (ilk satırda başlıktaki `startPrev`); `entry.seq` birer birer artmalı; her mühürde Ed25519 imzası yukarıdaki iletiyle doğrulanmalı ve `head`, `seq` numaralı satırın `hash`'i olmalı.

## Testler

`tests/retention.test.ts` (IP adresinin 1 yıl sonra silinmesi: yeni ve eski kayıt, bağımsız denetleyici, sonradan değiştirme), `tests/merkez-journal.test.ts` (zincir, mühür, değiştirme/silme/sıra değiştirme/son kayıtları kesme, her işlemin kaydı, gizli bilgi yok, aktarım, PDF/Excel/JSONL ve bağımsız denetleyici, saklama süresi), `tests/merkez-workfolder.test.ts`, `tests/yayinla.test.ts`, `tests/browser/platform-journal.spec.ts`.

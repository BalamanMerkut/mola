# Yedek güncelliği ve geri yükleme provası

## Kurulum kontrolü

`npm.cmd run pilot:check` veri diskinin yanında, `BACKUP_DIR` ile belirtilen mevcut yedek hedefinin boş alanını da ölçer. Hedef yoksa oluşturmaz ve ölçüm yapılmadığını bildirir. Yedek diskindeki az alan uyarıdır; uygulamanın açılmasını tek başına engellemez.

Mevcut veritabanında son tamamlanmış yedek 24 saatten eskiyse uyarı verir. Gelecek tarihli kayıtlar güncel yedek sayılmaz; bilgisayar saatinin kontrol edilmesi istenir. Tarih bir tamamlanma kaydından okunur; şifreli yedeğin sağlamlığını kanıtlamaz. Güncellik kontrolü otomatik yedekleme veya sürekli izleme değildir.

## Korumalı kurulumda (masaüstü uygulaması)

Kafedeki masaüstü kurulumunda ana anahtar Windows kilidi ve kurtarma koduyla korunur (bkz. `docs/GELISTIRICI_REHBERI.md` bölüm 11). Orada:

- Yedeği çalışan Mola alır: her gece 03:30 ve şerit → Yedekle → Şimdi yedekle. Her yedek ayrı klasöre geri yüklenerek doğrulanır. Aşağıdaki çevrimdışı `create`/`create-verified` komutları korumalı veri klasöründe çalışmaz (anahtar dosyada değildir) ve bunu açıkça söyler.
- Yedeğin anahtarı yedeğin içinde (`anahtar-kurtarma.json`) kilitlidir; `backup-keys` klasörü boş kalır. Koruma açılmadan önce alınmış yedeklerin ham anahtar dosyaları ilk açılışta yedeğin içine kilitlenip silinir.
- Kurtarma koduyla prova ya da geri yükleme (kod klavyeden sorulur, ekranda görünmez, komut satırına ya da kayda yazılmaz):

```powershell
npm.cmd run backup -- restore-with-code <yedek-klasörü> [hedef]
```

  Sonuç yeni ve doğrulanmış bir klasördür; anahtarı komutu çalıştıran bilgisayarın Windows kullanıcısına kilitlenir. Kafe bilgisayarına geri götürülürse orada da aynı kurtarma koduyla açılır.
- İkinci yedek yeri seçildiyse her doğrulanmış yedeğin kopyası `<seçilen>/Mola-Yedek/<kurulum>/` altındadır; aynı komutla oradan da geri yüklenir. Flash bellek takılı değilse ana yedek yine alınır, uyarı çıkar.
- Yeni bilgisayarda en kolay yol masaüstü uygulamasının ilk ekranı: "Yedekten geri yükle".

## Tek komutla prova

```powershell
npm.cmd run backup -- verify <yedek-klasörü> <anahtar-dosyası>
```

İsteğe bağlı son parametre prova hedefidir:

```powershell
npm.cmd run backup -- verify <yedek-klasörü> <anahtar-dosyası> <prova-hedefi>
```

Her çalıştırma hedefin altında yeni ve benzersiz bir klasör açar. Varsayılan hedef `.local/restore-checks` dizinidir. Canlı veri klasörü ve kaynak yedek değiştirilmez; sunucuyu kapatmak gerekmez. Yedek oluşturma ise hâlâ sunucu kapalıyken yapılır.

Prova dosya şifre çözümünü, SHA-256 özetlerini, SQLite bütünlüğünü, işletme anahtarlarıyla kayıtların açılmasını ve mevcut hesap/yönetim özetlerinin tutarlılığını doğrular. Başarı çıktısı tarih, doğrulanan dosya sayısı ve yeni klasörü gösterir. Başarısızlıkta başarılı rapor verilmez; geri yükleme klasörü başarısız işaretiyle uygulamanın açılmasına kapatılır.

Doğrulanan kopya ve başarısız provanın kısmi dosyaları anahtarlar ve özel veriler içerebilir. Otomatik silinmez; erişimi sınırlandırılmış alanda tutulmalıdır. Bu prova gerçek cihaz/ekran testi veya cihaz kaybına karşı harici yedek yerine geçmez. Aynı diskteki yedeği ayrı bir güvenli hedefe aktarma ve zamanlama henüz otomatik değildir.

## Farklı disk veya klasöre yedek

Sunucu kapalıyken iki hedefi birlikte belirtin. Örnek yolları kendi disklerinize göre değiştirin:

```powershell
npm.cmd run backup -- create ".local/development" "D:/MolaYedekler" "E:/MolaAnahtarlar"
```

Yedek ve anahtar klasörleri veri klasöründen ve birbirinden ayrı olmalıdır; aynı veya iç içe klasör kabul edilmez. Var olan klasör bağlantıları çözümlenerek hedefler kontrol edilir. Özel hedef belirtilmezse önceki `.local/backups` ve `.local/backup-keys` varsayılanları korunur. İki klasörün ayrı olması tek başına ayrı fiziksel diskte olduklarını garanti etmez.

`restore` komutu da isteğe bağlı son hedef kabul eder; hedef altında daima yeni bir geri yükleme klasörü oluşturulur. Mevcut işletme verisinin üzerine yazılmaz. Bu özellik otomatik zamanlama veya bulut yedekleme değildir; takılı olmayan disk bağlanmaz ve ücretli hizmet alınmaz.

Geri yükleme hedefi yedek ve anahtar klasörleriyle aynı veya iç içe olamaz. Hedefin kendisinde ya da üst klasörlerinde işletme veritabanı, işlem kilidi veya geri yükleme hata işareti varsa ayrı klasör seçilmesi istenir. Kontroller klasör oluşturulmadan yapılır; her başarılı provada yeni alt klasör oluşturulur.


## Yedek alma ve doğrulamayı birlikte çalıştırma

Sunucu kapalıyken:

```powershell
npm.cmd run backup -- create-verified <veri-dizini> <yedek-hedefi> <anahtar-hedefi> <prova-hedefi>
```

Dört hedef açıkça belirtilmelidir. Önce hedeflerin ayrılığı kontrol edilir, ardından şifreli yedek oluşturulur ve yeni bir prova klasörüne geri yüklenir. Başarı halinde yedek klasörüne `verification.json` yazılır. Bu kayıt anahtar veya satış içeriği taşımaz; konum ve kontrol zamanını içerir. Kayıt kendi başına dijital imzalı kanıt değildir.

Geri yükleme başarısız olursa komut hata verir ve başarı kaydı oluşturmaz. Oluşmuş yedek, anahtar ve kısmi prova dosyaları otomatik silinmez. Prova klasörü açık veriler ve anahtarlar içerir; erişimini sınırlandırın. Düzenli çalıştırmada depolama alanı ayrıca planlanmalıdır.

Bu komut otomatik zamanlamanın hazırlığıdır; zamanlanmış görev kurulmaz, çalışan sunucu kapatılmaz. Sunucu çalışıyorsa kilit nedeniyle hata verir. Canlı yedekleme ve servisle koordineli zamanlama henüz tamamlanmadı.

Doğrulama veya başarı kaydı yazımı başarısız olursa, hedef yazılabilir durumdaysa yedek klasörüne `verification-failed.json` kaydı eklenir. Bu kayıt hatanın aşamasını belirtir; teknik hata içeriği veya gizli veri yazmaz. Yedek diski de yazılamıyorsa bu kayıt oluşturulamayabilir; komut yine başarısız çıkar. `complete.json` yalnız yedek oluşturmanın tamamlandığını gösterir, ayrı geri yüklemenin başarılı olduğunu göstermez.

Kurulum kontrolü son tamamlanmış yedek için `backupVerification` durumunu da döndürür: yedek yok, prova kaydı yok, başarısız, geçersiz veya başarılı prova kaydı var. Başarılı kayıt yedek konumu, dosya sayısı ve tarihle karşılaştırılır; bozuk/gelecek tarihli kayıt başarılı sayılmaz. Taşınan yedeğin eski konum içeren kaydı geçersiz sayılır ve yeniden prova gerekir. Bu inceleme yedeği açıp tekrar doğrulamaz; aynı hedefte birden fazla işletme varsa kaydın doğru işletmeye ait olduğunu tek başına kanıtlamaz.

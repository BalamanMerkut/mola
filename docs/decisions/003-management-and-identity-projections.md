# Yönetim ve hesap okuma ayrımı

26 Eylül 2026 — yerel mimaride uygulanan geçiş aşaması.

## Veri yolları

- Ana panel işletme listesi `business_directory` tablosundan ad, logo, kurulum ve sahip hesap kimliği/sürümü okur.
- Kullanıcı adı araması ve parola doğrulaması `staff_credentials` tablosunu kullanır.
- Çalışan oturumu kontrolü aynı tablodan yalnız ilgili işletmenin kaydını seçer; `sessionUser` kimlik, kullanıcı adı, rol, aktiflik ve sürüm döndürür.
- İş akışları, MFA ve hesap düzenleme hâlâ işletme snapshot'ını kullanır. Snapshot asıl kayıt olmaya devam eder.

## Tutarlılık ve sınırlar

İki özet, snapshot yazımıyla aynı SQLite işleminde güncellenir. İlgili alanlar değişmedikçe ek yazma yapılmaz. Eski verilerde eksik özetler açılışta oluşturulur. Yedek geri yükleme tüm mevcut özetlerin şifreli içeriklerini doğrular. Çalışan yetkisi önbelleğe alınmaz: her istekte güncel hesap kaydı kontrol edilir.

Süresi dolmuş, kapatılmış, sürümü veya rolü değişmiş oturum bellekten çıkarılır. Hesabı yeniden etkinleştirmek eski iptal edilmiş oturumu canlandırmaz. Normal hesap işlemleri sürümü artırır; rol karşılaştırması sürüm artırımı unutulmasına karşı ek kontroldür.

Bu tablolar merkezi bir dış sunucuya gönderilmez. Hepsi aynı veritabanı ve süreçtedir; yerel üst anahtar ile farklı AES-GCM bağlamlarında korunur. `staff_credentials` parola doğrulama sırları içerir ve panel yanıtlarına verilmez. Uçtan uca şifreleme veya ayrı kimlik hizmeti değildir.

Kullanıcı adı araması `staff_login_lookup` indeksini kullanır. Alan ayrımlı HMAC-SHA256 kullanıcı adı belirteci işletme kimliğine bağlanır; kullanıcı adı bu tabloda açık saklanmaz. Sonuçtaki şifreli hesap içinden kullanıcı adı yeniden eşleştirilir. Bilinmeyen isim hiçbir hesap kaydını açmaz; bilinen isim yalnız hedef işletmenin kaydını açar. Benzersiz indeks yinelenen kullanıcı adlarını veritabanı düzeyinde de reddeder. Hesap değişiklikleriyle aynı işlemde güncellenir; her açılışta şifreli hesap kayıtlarından atomik olarak yeniden kurulur. Bu türetilmiş indeks eski yedeklerde bulunmak zorunda değildir. Üst anahtarın ele geçirilmesine karşı koruma iddiası yoktur.

## QR yönlendirme indeksi

Müşteri oturumu açarken tüm işletme snapshot'ları taranmaz. `table_qr_lookup`, ayrı bağlamlı HMAC belirteciyle işletme ve masa kimliğini bulur. Açık QR tokenı indeks tablosunda saklanmaz. Sonuç yalnız yönlendirme ipucudur: hedef işletmenin doğrulanmış snapshot'ında masa kimliği ve token yeniden karşılaştırılmadan oturum oluşturulmaz. Bilinmeyen token snapshot açmaz. Mevcut basılı QR tokenları değişmez; periyodik/gecelik yenileme yoktur.

Masa değişikliği ve indeks aynı işlemde yazılır. Normal sipariş/ödeme indeksi değiştirmiyorsa ek yazma yapılmaz. Başlangıçta eski yedeklerden de türetilebilir; asıl kayıt snapshot'tır. Bu adım hedef işletmenin verisini okumayı kaldırmaz ve fiziksel sunucu ayrımı sağlamaz.

## Doğrulama kapsamı

API testleri özel snapshot okuması kapalıyken ana panel listesi, giriş ve çalışan kimliğinin çalıştığını doğrular. İşletmeye bağlı hesap arama, yanlış parola, rol/sürüm değişikliği, pasifleştirme, tam oturum bitiş anı ve diğer işletme oturumlarının korunması sınanır. Depolama testleri hata halinde özet ve asıl kaydın birlikte geri alınmasını ve geçişte iş verilerinin değişmemesini doğrular.

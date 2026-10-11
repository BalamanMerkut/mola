# Kalan işler ve önerilen geliştirme sırası

18 Eylül 2026 · Mevcut çalışan yerel sürüme göre hazırlanmıştır.

Uygulama şu anda gerçek müşteri yayınına hazır değildir. Aşağıdaki liste, iki Word belgesindeki kapsamın henüz tamamlanmamış bölümlerini gösterir. Fotoğraf düzenleme, temel seçenek editörü, müşteri önizlemesi, mutfak geri sayımı ve yeni sipariş sesi artık çalışan özelliklerdir.

## 1. Gerçek işletme kurulumu ve güvenlik temeli

- Windows'a kurulabilir işletme uygulaması ve güvenli güncelleme sistemi.
- Merkezi işletme oluşturma ve logo/arka plan kurulumu. Yerel işletme adı, masa ekleme, bekleme süresi ve POS komisyonu sihirbazı tamamlandı.
- Merkezi kullanıcı sağlama, davet/kurtarma ve daha ayrıntılı görev yetkileri. Yerel kalıcı hesap açma/kapatma, rol değiştirme, şifre değiştirme/yenileme ve oturum iptali tamamlandı.
- Tamamlandı (yerel): Ana panelden ayrı işletme ve sahip hesabı açma; her işletmenin QR bağlantısı doğru işletmeye çözülür. Ayrı cihazlar ve merkezi dağıtım henüz yok.
- İşletme bilgisayarındaki anahtarın güvenli işletim sistemi kasasında tutulması.
- Merkez ile işletme işlemcisi arasında şifreli sipariş/sonuç aktarımı ve anahtar yenileme.
- Merkezi sunucunun finansal içeriği açık görmeden çalışacağı mimarinin tamamlanması. Bugünkü yerel disk şifrelemesi bu hedefin tamamlandığı anlamına gelmez.

**Bitiş ölçütü:** İki ayrı işletme birbirinin verisine erişememeli; anahtar/cihaz değişimi ve bağlantı kesintileri doğrulanmalı.

## 2. Sipariş, masa ve tahsilatın eksik akışları

- Tamamlandı: Müşterinin süre içinde ürün ekleme/çıkarma, adet ve seçenek değiştirmesi. Aynı sipariş güncellenir, bekleme süresi uzamaz. Ödeme girilmiş hesap, kapalı masa, engelli tarayıcı ve süre dışı değişiklikler sunucuda reddedilir.
- Siparişin tamamı yerine tek kalemi değiştirme/iptal etme; işletme onayının müşteriye açık sonucu.
- Tamamlandı: İşletme sahibi/kasiyer/garson açık hesabı boş masaya taşıyabilir; sipariş ve ödemeler korunur, eski QR oturumları kapanır. İşletme sahibi/kasiyer dolu hesapları sipariş ve ödemeleri koruyarak birleştirebilir. Kalan: birleşik hesapları ayırma.
- Tamamlandı: Ürün/adet seçerek ve tutar bazında kısmi ödeme. Tutar bazlı ödeme içeren hesapta kalem dağılımı belirsiz olduğu için ürün seçimi kapalıdır. Kişi bazlı otomatik paylaştırma henüz yok.
- Tamamlandı (yerel): gerekçeli nakit/kart düzeltmesi, kısmi/tam iade, sahip yetkisi ve denetim kaydı. Tahsilat geçmişinde tarih filtresi, 20 kayıtlık sayfalama ve iade etiketleri vardır.
- Kısmen tamamlandı: QR siparişi gönderiminde, müşteri sipariş değişikliklerinde, iptal taleplerinde ve kasiyer/işletme sahibi tahsilatlarında aynı sekmede yenileme sonrası belirsiz gönderimin requestId/içerik/toplamıyla geri açılması, aynı işlemi güvenle kontrol etme ve eski masa/tarayıcı bağlamında yeni sipariş oluşturmayı engelleme. Geçici kayıt sessionStorage'dadır. Kalan: sekme kapandıktan sonra kurtarma garantisi, kalıcı cihaz işlem kutusu. İptal kontrolü, doğrudan iptal ile işletme onayı gereken talebi ayırır. Tahsilat kaydı işletme ve çalışan kimliğine bağlıdır; farklı hesapla yeniden gönderilemez.
- Merkezi bağlantının kesilmesi, işletme bilgisayarının yeniden başlaması ve iki işlemci açılması durumlarında tutarlılık.

**Bitiş ölçütü:** Çift sipariş/çift tahsilat oluşmamalı; masa taşıma ve değişikliklerde hesap tutarları korunmalı.

## 3. Menü, tasarım ve kampanyalar

- İşletmeye özel logo, arka plan, renk ve hazır kafe/restoran/dönerci şablonları.
- Tamamlandı: Ana kategori ekleme, yeniden adlandırma, boş kategori silme ve sıralama. Kullanılan alt kategoriler Kategorileri yönet ekranından sıralanabilir, yeniden adlandırılabilir ve ürünler korunarak kaldırılabilir; müşteri/garson menüsü ve önizleme aynı sırayı kullanır. Boş alt kategoriler bu ekrandan eklenebilir; ürün düzenleyicisinde öneri olarak sunulur.
- Tamamlandı: Kaydedilmiş menünün tamamını 320/390 px telefon ve 768 px tablet görünümünde, gerçek sipariş oluşturmadan önizleme.
- Tamamlandı: Yeni ürünü taslak kaydetme, taslağı düzenleme/yayınlama. Müşteri/personel yalnızca yayındaki ürünleri görür. Tam menü önizlemesi taslakları içermez. Tamamlandı: yayındaki ürün için ayrı düzenleme taslağı, sonradan yayınlama ve canlı ürünü koruyarak taslağı silme.
- Tamamlandı: yüzde ve sabit TL indirimi, ürün kapsamı, başlangıç/bitiş ve süresiz seçenek. TL indirimi seçenekler dahil her ürün adedinden düşülür. İsteğe bağlı 2–20 adet eşiği aynı siparişte aynı ürünün bütün boylarını toplar; eşik sağlanırsa o ürünün tüm adetleri indirimlidir. Kalan: paket fiyatları, ikinci ürüne özel indirim ve ücretsiz ürün kampanyaları.
- Tamamlandı: işletme birleşme tercihi; önce art arda yüzdeler, sonra TL kesintileri uygulanır. Tek/birleşik tekliften düşük fiyat seçilir. Birim fiyat en az 1 kuruştur. Kampanya türü değişince önceki rapor dönemi korunur.
- Tamamlandı (tek yerel sunucu): İşletme başına 500 MiB fotoğraf sınırı; büyük fotoğraf, küçük önizleme, yeniden düzenleme kaynağı ve kırpma bilgisi birlikte sayılır. Eşzamanlı yüklemelerde sınır aşımı ve yakalanan yazma hatasında yarım dosya bırakma önlenir. Kalan: kullanılmayan eski yüklemelerin referansları gözeterek temizliği, ani süreç kapanmasında yarım yüklemelerin uzlaştırılması, yedekleme ve çok işlemcili dağıtımda ortak kota kilidi. Fotoğraf ekleme/kırpma/yeniden düzenleme tamamlandı.
- Tüm müşteri metinlerini çeviri sözlüğüne taşıma, otomatik çeviri ve işletmenin çeviriyi düzeltmesi. Mevcut İngilizce kapsamı kısmidir.

## 4. Satış ve raporlar

Tamamlandı: İşletme sahibine özel çalışan sipariş özeti; tarih aralığı, bugün/son 7/son 30 gün, yatay çubuklar, sipariş/ürün adedi, sipariş tutarı ve ayrı iptal sayısı. QR siparişleri ayrı tutulur. Kapalı hesapların geçmişi korunur. Arşiv ve canlı kopyalar tek sayılır. Tutar tahsilat/net gelir değildir. Henüz ikinci doğrulama yoktur.

- Tamamlandı: Genel Mali Durum ve Çalışanlar sekmeleri; en fazla 366 günlük tarih aralığı, günlük tahsilat grafiği, nakit/kart dağılımı, ürün grafiği ve sipariş/iptal özeti.
- Tamamlandı: Nakit/kart tahsilatı, kayıtlı POS komisyonu ve komisyon sonrası tahsilat. Eksik komisyon varsa kesin toplam gösterilmez. Kasiyerin açıklamalı nakit giderleri ayrıca raporlanır. Kâr hesabı kapsamda değildir.
- Tamamlandı: İptal edilmeyen siparişlerde en çok alınan ilk 10 ürün, adet bazında yatay çubuklar. Ödenmemiş siparişler dahil olduğu ekranda belirtilir.
- Tamamlandı: Müşteri menüsünde ve tam menü önizlemesinde Popüler ürünler filtresi. Son 30 günlük iptal edilmemiş sipariş adetlerine göre en fazla 6 mevcut, tükenmemiş ürün; müşteri yanıtında sadece ürün kimlikleri bulunur.
- Raporlara erişirken SMS/TOTP ile ikinci doğrulama.
- Bir yıllık şifreli arşiv, saklama/silme politikaları ve yedekten geri yükleme.

## 5. Ana panel ve kurtarma

Ana panel işletme panelinden ayrı bir platform yönetimi olacaktır. Yerel /platform ana paneli çalışır: ayrı yönetici girişi, işletme oluşturma, aylık/yıllık lisans uzatma/askıya alma, destek yanıtı/kapatma vardır. Merkezi internet dağıtımı henüz yoktur. Uygulama planı: önce ayrı platform-admin kimliği ve yetki kontrolleri, sonra işletme oluşturma/askıya alma, işletme cihazı eşleştirme, bağlantı/sürüm bilgisi ve denetlenen destek işlemleri. İşletme sahibinin şifresi görüntülenmez. Finansal raporlar standart platform-admin erişiminin dışında kalır. Uzaktan yönetim, işletmenin uygulama ayarları ve hizmet erişimiyle sınırlıdır; bilgisayarı genel amaçlı uzaktan kontrol etmez. Anahtar kurtarma ayrı yetki ve açılmadan önce denetim kaydı gerektirir. Bu işler merkezi sunucu ve şifreli aktarım tamamlanırken geliştirilecektir.

- Tamamlandı (yerel): İşletmeler, lisans süresi, destek talepleri ve bekleyen bildirim kayıtları. Kalan: platform yöneticileri için çoklu hesap/yetki, şifre yenileme/kurtarma, sürüm ve cihaz bağlantı durumu.
- İşletme sahibinin kurtarma anahtarı akışı.
- Ayrı yetkili adminin kurtarma işlemi; anahtar açılmadan önce isteğin denetim kaydına yazılması.
- Denetim kayıtlarının bütünlüğü ve sıradan ana panel kullanıcılarının finansal veriye erişememesi.
- Destek işlemlerinin kapsamı, kim tarafından ne zaman yapıldığının kaydı.

## 6. Yayına hazırlık ve saha testi

- Ayrı HTTPS test sunucusu ve gerçek merkezi barındırma. Mevcut LAN testi internete yayın değildir.
- Gerçek iPhone/Android/tablet ve düşük güçlü bilgisayar testleri.
- Mutfak ekranının uyku/arka plan davranışı ve masaüstü bildirimleri. Ses mutfak ekranında varsayılan açıktır; tarayıcı engellerse ilk etkileşim veya hoparlör düğmesi gerekir; cihaz uyurken bildirim garantisi yoktur.
- Uygulama paketi/PWA değerlendirmesi; mevcut garson ekranı tarayıcıda çalışır.
- Uzun süreli yük, büyük arşiv, yedekleme, disk dolması, ani kapanma ve sürüm geçişi testleri.
- Güvenlik incelemesi, hata izleme, veri sızdırmayan teknik loglar ve dağıtım/geri dönüş planı.
- Bir pilot kafede kontrollü deneme; sonrasında diğer işletmelere açılma.

## Daha sonraki büyüme seçenekleri

İlk sürüm tamamlandıktan sonra değerlendirilecek; şu anda uygulanmıyor:

- Müşteri üyeliği ve sadakat puanı.
- Şehir içi uzaktan sipariş, adres ve teslimat akışları.
- Çok şube ve daha kapsamlı işletme şablonları.

## Önerim

Bir sonraki büyük adım **merkezi işletme sağlama, cihaz güvenliği ve şifreli merkez–işletme bağlantısı** olmalı. Ardından sipariş/masa/tahsilat eksiklerini, kampanyaları ve raporları tamamlayabiliriz. Yeni ekranların görünmesi, güvenlik ve saha testlerinin tamamlandığı anlamına gelmeyecek.

## Güncel kurulum kararı
Yerel kurulum yalnızca ilk girişte gösterilir ve tamamlanınca kilitlenir. İşletme adı/logo/arka plan değişiklikleri ana panelden yönetilecek; işletme panelinde kalıcı kurulum sekmesi olmayacak.

## 18 Eylül: Onay, roller ve destek kararı

- Garson onayı kurulum ve ayarlardan açılır. Garsonun işletme genelindeki otomatik onay tercihi yalnızca yeni QR siparişlerini etkiler; önceki bekleyenler ayrıca onaylanır. Personel siparişleri doğrudan mutfağa gider.
- İşletme sahibinde Masalar kalır, Sipariş al/Mutfak gizlidir. Kasiyerde Sipariş al sekmesi yoktur; masa içinden ürün ekleyebilir. Garsonda numara ile sepete ekleme vardır.
- Gece QR/oturum yenileme kullanıcı kararıyla iptal edildi. Sabit QR ve mevcut altı saatlik oturum sınırı korunur.
- SMS, e-posta ve alan adı satın alma ertelendi. Panel içi destek çalışır; dış bildirim olayları yalnızca yapılandırma bekleyen kayıt olarak tutulur. Gerçek gönderim yapılmaz.
- Ürün taslağı/yayın ayrımı, bu istek paketi nedeniyle sonraya bırakıldı.

## 20 Eylül güncellemesi: Pilot lisans tamamlandı
Ana panelden hazırlık süresi sayılmayan 30 günlük deneme işletmesi açılabilir. İlk kurulum sonrası manuel başlatılır; aylık/yıllık aboneliğe geçişte kalan deneme süresi korunur. Yetki, idempotent tekrar, süre sonu ve mevcut tahsilat erişimi test edildi. Merkezi yayın/bağımsız kurulum ve gerçek ödeme altyapısı bu değişikliğin kapsamında değildir.

## 21 Eylül: Dondurma tamamlandı
Yıllık abonelikte işletme talebi + ana panel onayı, en fazla 60 gün, önceki başlangıçtan itibaren 12 ayda bir. Kalan süre korunur; otomatik veya erken açma, müşteri menüsü erişimi ve idempotent tekrar test edildi. Takip eden geliştirmeler: ürün taslak/yayın ayrımı, kampanyalar; merkezi dağıtım ve finansal şifreleme hedefi ayrıca devam ediyor.

## 21 Eylül: Kampanya raporları güncellemesi
Ürün taslak/yayın ayrımı, yüzde kampanyaları, menüden ürün seçimi, çok satanlar seçimi, kampanya dönem karşılaştırması ve mali tahsilat ayrımı tamamlandı. Sabit TL, adet/paket kampanyaları ve uzun süreli saha verisiyle performans doğrulaması sonraki kapsamda. Karma tutar bazlı kısmi ödemelerin ürün ataması bilinmiyorsa rapor bunu açıkça ayrıştırılamayan tahsilat olarak gösterir.

## 21 Eylül: Son güncelleme
Sabit TL indirimi de tamamlandı; kampanya kapsamındaki sonraki adımlar adet eşikleri ve paket fiyatlarıdır. Yayındaki üründe **Taslağa al**, ürünü müşteri menüsünden kaldırır; eski ayrı düzenleme taslağı API'si uyumluluk amacıyla korunur. Komisyonu eksik ödemelerde artık bilinen kesintiler sonrası **Geçici kalan** gösterilir; eksik POS kesintileri tahmin edilmez.

## 21 Eylül: Adet koşulu tamamlandı
Yüzde ve TL kampanyalarına minimum adet koşulu eklendi. Aynı ürün ayrı sepet satırlarında/farklı boylarda birlikte sayılır; farklı ürünler, ayrı siparişler ve telefonlar birleştirilmez. Sipariş düzenlemede adet azalınca indirim koşulu tekrar denetlenir. Kampanya koşulları ve seçenekler dahil fiyat sipariş anında saklanır; daha sonraki fiyat/kampanya değişikliği önceki koşulları bozmaz. Sabit paket fiyatı henüz yapılmadı.

## 21 Eylül: Toplam kampanya kontenjanı tamamlandı
İsteğe bağlı toplam adet sınırı (örneğin 50) eklendi. Seçili tüm ürünlerde ortak kullanım, panel sayacı, kabulde kontenjan ayırma, iptal/rette geri açma ve eşzamanlı sınır denetimi çalışır. Kampanyayı düzenlemek sayacı sıfırlamaz. Bu toplam sınır, aynı siparişteki minimum alım koşulundan bağımsızdır.

## 21 Eylül: QR siparişinde yenileme sonrası kurtarma
Sonucu belirsiz gönderim, aynı sekmede menü yeniden açıldığında otomatik geri yüklenir. Kullanıcı **Gönderimi yeniden kontrol et** ile aynı işlem kimliğini kullanır. Başarılı sonuçta geçici kayıt temizlenir. Sıradaki bağlantı güvenilirliği adımı kasiyer tahsilatıdır; sekme kapatma/cihaz değiştirme garantisi henüz yoktur.


## 21 Eylül: Fotoğraf alanı incelemesi
İşletme sahibi Ayarlar > Fotoğraf alanı bölümünde kullanılan, yeni yüklenen ve kullanılmayan eski fotoğrafları görebilir. Yayındaki/gizli ürünler ve taslak referansları birlikte sayılır. Ekran salt okunurdur; silme/taşıma veya otomatik temizlik yapmaz. Güvenli temizleme, geri alma ve yedekleme sıradaki depolama adımlarıdır.

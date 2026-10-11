# Her şey yerli yerinde: Mola kafe uygulamasının yerleşim önerisi

Tarih: 9 Ekim 2026 · Durum: **uygulandı (10 Ekim 2026)**. Sahip onayladı; açık soruların hepsinde önerilen cevap seçildi (Destek'in üçüncü sekmesinin adı "Uzaktan erişim" olarak kaldı). Ek karar: her ev iki seviye sekme kullanır (simgeli sekmeler, altında sade alt sekmeler; ör. Kasa ayarları → Gün sonu · Kart ve yazar kasa · Kasiyer yetkileri, Personel → Vardiya ve bahşiş → Vardiyalar · Bahşiş). Uygulamanın kod haritası docs/GELISTIRICI_REHBERI.md (Evler satırı).
Kapsam: kafe uygulaması (sahip, Müdür, kasiyer, garson, mutfak). Mola Yönetim ve müşteri menüsü kapsam dışı.

---

## 0. Kısaca

Bugün bir konunun parçaları üç dört ayrı yerde duruyor. En belirgin örnek giderler: gider **kaydı** Satış ve Raporlar'da, **otomatik giderler** Ayarlar'da, kasiyerin **Gider kaydet** düğmesi Masalar'da, kasiyerin **gider uyarı sınırı** Ayarlar → Sipariş ve kasa'da, giderin **bildirimi** Destek'te. Öneri dört büyük taşımadan oluşuyor:

1. **Yeni bir yer: "Kasa ve giderler".** Kasanın bugünkü işi, giderler (otomatik giderler dahil), kasa kapanışları, iadeler ve kasa ayarları tek yerde, sekmelerle. Satış ve Raporlar'daki "Para" grubu ve Ayarlar'daki "Kasa ve ödeme" ile "Giderler ve kâr" buraya gelir.
2. **"Çalışanlar" → "Personel".** Hesaplar, vardiya kayıtları, bahşiş payları ve vardiya/bahşiş/garson ataması ayarları bir arada.
3. **Ayarlar 6 konudan 5 konuya iner** ve içinde yalnız bir kez kurulan şeyler kalır. Rezervasyon ayarı Ajanda'ya, KDV oranları Menü'ye, düşük kâr sınırı Kârlılık raporunun yanına gider.
4. **Bildirimler Destek'ten çıkar**, üst çubukta bir zil olur. Sahibin telefonuyla ilgili üç ayar (rapor kodu, telefonu eşleştirme, uzaktan yönetim) Güvenlik'te bir araya gelir.

Hiçbir işlev silinmiyor. Eski yerlerde iki sürüm boyunca "Taşındı → Git" tabelası duruyor.

---

## 1. İlke

Sizin cümleniz: **"Her konunun tek bir evi olsun: o konunun günlük işi, ayarı ve geçmişi aynı yerde, sekmelerle."**

Bu ilke doğru. Uygularken dört küçük ek gerekiyor, yoksa bazı yerler ikiye bölünür ya da Raporlar boşalır:

| # | Kural | Neden |
|---|---|---|
| 1 | **Tek ev.** Bir konunun günlük işi, ayarı ve **kayıt defteri** (eklenen, düzeltilen, silinen kayıtlar) aynı yerde durur, sekmelerle. | Gider listesinde "Gider ekle" ve "Düzelt" var. Bu rapor değil, iş. İşin geçmişi işin yanında olmalı. |
| 2 | **Raporlar "işletme nasıl gidiyor?" sorusunun yeridir.** Dönem seçilen, yalnız okunan, konuları karşılaştıran sayfalar orada kalır: Özet, Ürünler, Kârlılık, Kampanya sonuçları, Çalışan satışları, Rezervasyon sonuçları, KDV, yıllar, muhasebeci dosyası. Her ev kendi raporuna, her rapor da kaydın evine bir bağlantı verir. | Her raporu evine taşırsak Raporlar boşalır, Müdür'ün menüsü karışır, muhasebeci dosyası ile yıl tablosu sahipsiz kalır. |
| 3 | **Servis sırasında elde olması gerekenler Masalar'da kısayol olarak kalır**: Gün sonu, Gider kaydet, İade, Masa ekle/çıkar. Kısayol ev değildir; basınca evdeki aynı pencere açılır. | Kalabalıkta kasiyer menüde gezinmemeli. |
| 4 | **Her evin son sekmesi "Ayarlar"dır ve yalnız sahipte görünür.** Müdür evi görür, ayar sekmesini görmez. Kasiyer yalnız kendi işini (ör. Kasa → Bugün) görür. | Bugün Müdür'ün Ayarlar'ı hiç görmemesiyle aynı güvenlik, ama ayar artık konusunun yanında. |
| 5 | **Ayarlar ekranında yalnız bir kez kurulan, işletmenin ya da cihazların genelini ilgilendiren ayarlar kalır** (işletme görünümü, masalar ve QR, sipariş akışı, yazıcı ve sesler, güvenlik ve yedek). | "Ayarlar" kelimesi "bir kere kurup unuttuğum şeyler" demek olsun. |
| 6 | **Hiçbir şey silinmez.** Taşınan şeyin eski yerinde iki sürüm boyunca "Taşındı: Kasa ve giderler → Giderler · Git" tabelası durur. | Alışkanlıkla eski yere giden siz ya da Müdür kaybolmasın. |

---

## 2. Bugün neden dağınık? (somut örnekler)

| Konu | Bugün kaç yerde | Nerelerde |
|---|---|---|
| Giderler | 6 | Satış ve Raporlar → Detaylı → Para → Giderler (liste, Gider ekle, Düzelt) · Ayarlar → Giderler ve kâr (Otomatik giderler) · Masalar başlığı ve kasa çipi "Gider kaydet" (yalnız kasiyer ve Müdür; sahibin kasa şeridinde bu düğme yok, şerit "Satış ve Raporlar → Para → Giderler'i kullanın" diyor) · Stok → Alış ve sayım "Gider olarak da kaydet" · Ayarlar → Sipariş ve kasa → Kasa ve ödeme (kasiyerin nakit gider uyarı sınırı) · Destek → Bildirimler (otomatik gider ve büyük gider haberleri) |
| Kasa | 5 | Masalar'daki kasa şeridi/çipi · telefonda "Kasa" (yalnız kasiyer ve Müdür; sahipte ve tablette yok) · Ayarlar → Sipariş ve kasa → Kasa ve ödeme · Satış ve Raporlar → Para → Kasa kapanışları ve İade ve düzeltme · Destek → Bildirimler (kapanış farkı, iade isteği) |
| Vardiya ve bahşiş | 4 | Ayarlar → Sipariş ve kasa → Vardiya ve bahşiş · Çalışanlar (vardiya planı) · kasa şeridi (vardiya kodu) · Satış ve Raporlar → Personel → Personel ve bahşiş (kayıtlar ve "Düzelt") |
| Sahibin telefonu | 3 | Ayarlar → Güvenlik ve diğer (Raporlar için telefon kodu, Uzaktan yönetim) · Destek → Uzaktan erişim (Telefonu eşleştir). Kılavuz ise uzaktan yönetimin Destek'te açıldığını yazıyor; kod Ayarlar'da gösteriyor. |
| KDV | 3 | Ayarlar → **Giderler ve kâr** → KDV oranları (KDV gider değil) · ürün penceresi (ürünün oranı) · Raporlar → Özet (KDV dökümü) |
| Düşük kâr uyarısı | 2 | Ayar Ayarlar → Giderler ve kâr'da, etkisi Satış ve Raporlar → Kârlılık'ta ve Stok → Reçeteler'de |
| Rezervasyon | 3 | Ajanda ve rezervasyon (iş) · Ayarlar → **Masalar ve QR** → Rezervasyon (ayar) · Satış ve Raporlar → Rezervasyon (sonuç) |
| Bildirimler | 1 ama yanlış rafta | Destek → Bildirimler: kasa farkı, azalan stok, iade isteği, gün sonu raporu, ajanda hatırlatması. Bunlar destek değil, işletmenin kendi haberleri. |
| Entegrasyonlar | 2 | Sol menü "Entegrasyonlar" (önizleme açıkken) ve Ayarlar → Güvenlik ve diğer → Entegrasyonlar: aynı ekran iki yerde |
| Güncelleme | 3 | Ayarlar → Güvenlik ve yedek → Güncelleme · Hesabım altındaki sürüm satırı · Ayarlar altındaki sürüm satırı |

---

## 3. Bugünkü yer → önerilen yer

Kısaltmalar: **S** sahip, **M** Müdür, **K** kasiyer, **G** garson, **Mu** mutfak. "Aynı kalır" satırları envanter tam olsun diye yazıldı.

### 3.1 Satış ve kasa

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Masa durumu, masa penceresi (sipariş ekle, ödeme al, taşı/birleştir, temizlendi) | Masalar | Aynı kalır | Servisin kalbi. |
| Sipariş al, Masasız sipariş | Sipariş al | Aynı kalır | |
| Servise hazır (G) | Servise hazır | Aynı kalır | |
| QR siparişleri Açık / Kapalı / Durdur | Üst çubuktaki çip | Aynı kalır | Her ekranda görünmeli. |
| QR onay kuyruğu, garson çağrıları, paket servis gelen kutusu | Masalar (garsonda her ekran) | Aynı kalır | |
| Bugünkü satış ve açık hesap toplamı | Masalar başlığı | Aynı kalır | |
| Kasa açılışı, kasa durumu, para bozdurma, sahip hareketleri (Sahip aldı, Bankaya), vardiya kodu, Gün sonu | Masalar → kasa şeridi/çipi; telefonda K ve M için "Kasa" | **Kasa ve giderler → Bugün** (S, M, K). Masalar'daki çip kısayol olarak kalır. | Kasanın bir evi olsun; sahip ve tabletteki kasiyer de bulsun. |
| Gün sonu hatırlatması (Mola'yı kapatırken) | Kasa bilgisayarı şeridi → Kapat | Aynı kalır; "Gün sonuna git" Kasa → Bugün'ü açar | |
| Kasa kapanışları: geçmiş, kişilere göre farklar, "Düzeltme ekle", kapanış fişi | Satış ve Raporlar → Detaylı → Para → Kasa kapanışları | **Kasa ve giderler → Kapanışlar** (S; M yalnız kimin ne saydığını görür, bugünkü gibi) | Düzeltme eklenen bir kayıt defteri; kasanın geçmişi kasada. |
| İade ve ödeme düzeltme | Satış ve Raporlar → Para → İade ve düzeltme; kasa çipinde "İade"; kapanmış masada "Ödemeyi düzelt" | **Kasa ve giderler → İadeler** (S, M). Çipteki "İade" ve masadaki "Ödemeyi düzelt" kısayol kalır ve buraya açılır. | İade kasadan çıkan para. |
| Gün sonu kasası ayarları: kapanış saati, not isteyen fark, kart bahşişini kasadan nakit öde | Ayarlar → Sipariş ve kasa → Kasa ve ödeme | **Kasa ve giderler → Kasa ayarları** (yalnız S) | Ayar, etkilediği işin yanında. |
| POS komisyon oranı | Ayarlar → Sipariş ve kasa → Kasa ve ödeme | **Kasa ve giderler → Kasa ayarları** | |
| Yazar kasa yardımcısı (aç/kapa, "Girildi" onayı) | Ayarlar → Sipariş ve kasa → Kasa ve ödeme | **Kasa ve giderler → Kasa ayarları** | |
| Kasiyer iade sınırları ve nakit gider uyarı sınırları | Ayarlar → Sipariş ve kasa → Kasa ve ödeme | **Kasa ve giderler → Kasa ayarları** | |
| "Kim ne yapabilir" (kasa yetkileri) | Ayarlar → Sipariş ve kasa → Kasa ve ödeme | **Kasa ve giderler → Kasa ayarları** | |
| Kapanış farkı ve iade isteği bildirimleri | Destek → Bildirimler | **Bildirimler (üst çubukta zil)**; bildirime basınca Kasa → Kapanışlar / İadeler açılır | Bkz. 3.11. |

### 3.2 Giderler

**Karar:** Giderler sol menüde ayrı bir yer **olmasın**; **Kasa ve giderler**'in bir sekmesi olsun. Raporlar'ın sekmesi de olmasın. Nedenleri:
- Gider girmek bir iştir, rapor değildir. Kasiyer de gideri kasada giriyor.
- Kasiyerin gider uyarı sınırı, POS komisyonu ve kasa ayarları zaten kasa konusu; otomatik giderlerle aynı evde dururlar.
- Raporlar sade kalır: "Elde kalan" ve gider toplamı Özet'te görünmeye devam eder, yanında "Gider kayıtlarını aç" bağlantısı olur.
- Sol menüye yeni bir yer eklenir ama Kampanyalar Menü'nün sekmesi olunca (soru 2) toplam yer sayısı değişmez.

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Gider ekle (S) | Satış ve Raporlar → Para → Giderler → "Gider ekle" | **Kasa ve giderler → Giderler → Kayıtlar → "Gider ekle"** | Gider işinin evi. |
| Gider kaydet (K, M) | Masalar başlığı ve kasa çipi; telefonda Kasa | Kısayol olarak aynı yerde kalır; ayrıca Kasa → Giderler'de. **Sahibin kasa çipine de "Gider kaydet" eklenir.** | Sahip bugün gider için Raporlar'a gitmek zorunda. |
| Gider listesi, Düzelt (S), silinen giderler, "Otomatik" rozeti ve kuralı açan bağlantı | Satış ve Raporlar → Para → Giderler | **Kasa ve giderler → Giderler → Kayıtlar** (S, M; düzeltme yalnız S, bugünkü gibi) | |
| Otomatik giderler (kira, maaş, abonelik kuralları) ve "Nasıl çalışır?" | Ayarlar → Giderler ve kâr | **Kasa ve giderler → Giderler → Otomatik giderler** (yalnız S) | Sizin verdiğiniz örnek: kural ile kural yazdığı kayıt yan yana. |
| Stok alışını gider olarak kaydet | Stok → Alış ve sayım | Aynı kalır; kayıttan sonra "Giderlerde gör" bağlantısı | Alış faturası stok işinin parçası. |
| Gider toplamı, "Elde kalan" hesabı | Satış ve Raporlar → Sade özet / Özet | Aynı kalır (analiz); "Gider kayıtlarını aç" bağlantısı | Kural 2. |
| Kasiyerin büyük nakit gider uyarısı | Ayarlar → Sipariş ve kasa → Kasa ve ödeme | **Kasa ve giderler → Kasa ayarları**; Giderler sekmesinden bağlantı | |
| "Otomatik gider kaydedildi" ve "büyük gider" bildirimleri | Destek → Bildirimler | **Bildirimler (zil)** | |

### 3.3 Stok

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Malzemeler, Reçeteler, Ürünler, Alış ve sayım, İşlem geçmişi | Stok | Aynı kalır | Zaten tek ev. |
| Sayım ve fire (Mu) | Mutfak modu → Stok | Aynı kalır | |
| İptalde "stok kullanıldı mı?", iadede "stoğa ekle" | Sipariş/iade pencereleri | Aynı kalır | |
| Azalan stok bildirimi | Destek → Bildirimler | **Bildirimler (zil)**; bildirim Stok → Malzemeler'i açar | |
| Kârlılık raporu | Satış ve Raporlar → Satış → Kârlılık | Aynı kalır (analiz). Stok → Reçeteler'e "Kârlılığı gör" bağlantısı (ters yönde "Reçete ekle" zaten var). | Soru 5. |
| Düşük kâr uyarısı sınırları (ürün gruplarına göre) | Ayarlar → Giderler ve kâr | **Satış ve Raporlar → Kârlılık → "Uyarı sınırları"** düğmesi (yalnız S) | İşaretini gördüğünüz yerde değiştirirsiniz. |

### 3.4 Menü ve kampanyalar

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Ürün ekle/düzenle, Tükendi, Taslaklar, Menüyü önizle, Kategorileri yönet | Menü yönetimi | Aynı kalır (sekme: **Ürünler**) | |
| KDV oranları (hangi oranlar, varsayılan) | Ayarlar → Giderler ve kâr → KDV oranları | **Menü yönetimi → "KDV oranları"** (yalnız S; Kategorileri yönet'in yanında) | KDV ürünün özelliği; ürün penceresindeki KDV listesinin yanında olmalı. |
| Ürünün KDV oranı, "Bu bölümdeki ürünlere uygula" | Ürün penceresi | Aynı kalır; listenin altında "KDV oranlarını yönet" bağlantısı | |
| KDV dökümü | Satış ve Raporlar → Özet | Aynı kalır | Analiz. |
| Kampanya ekle/düzenle | Sol menü → Kampanyalar | **Menü yönetimi → Kampanyalar sekmesi** (S, M) | Kampanya menüdeki ürünlere uygulanır, müşteri de menüde görür. Sol menüde bir yer azalır. Soru 2. |
| Kampanya sonuçları | Satış ve Raporlar → Satış → Kampanyalar | Aynı kalır (analiz); her kampanya kartında "Sonuçları gör", raporda "Kampanyayı düzenle" | |
| Müşteri menüsünün görünümü (logo, renk, karşılama yazısı, İngilizce metinler, işletme türü, Google yorum bağlantısı) | Ayarlar → İşletme → Görünüm | Aynı kalır; Menüyü önizle'de "Görünümü değiştir" bağlantısı | Bir kez kurulur (Kural 5). |
| Fotoğraf alanı (ürün fotoğraflarının kapladığı yer) | Ayarlar → Güvenlik ve diğer → Cihazlar | **Ayarlar → Cihazlar → Tablet ve telefonlar** altında kalır | Bilgisayarın diskiyle ilgili bakım işi. Soru 14. |

### 3.5 Masalar ve QR

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Masa ekle, Masa çıkar | Masalar başlığı (S) | Masalar'da kısayol olarak kalır. **Ayarlar → Masalar ve QR sayfası da aynı düğmeleri gösterir** (bugün yalnız "Masalar ekranındadır" yazıyor). | Kurulum ayarlarının evi Ayarlar; günlük kısayol Masalar. Soru 8. |
| Masanın bölümü (iç, dış, bahçe) | Masa penceresi | Aynı kalır | |
| Masa temizliği takibi | Ayarlar → Masalar ve QR | Aynı kalır | |
| QR adresi (Wi-Fi / internet), tek masanın QR'ını yenileme | Ayarlar → Masalar ve QR; masa penceresi | Aynı kalır | |
| QR kodlarını yazdır (A4, A6, PDF) | Ayarlar → Masalar ve QR → QR kodlarını yazdır | Aynı kalır | |
| "QR'ları yeniden basın" uyarısı | Masalar | Aynı kalır | |
| Engellenen müşteri telefonları | Ayarlar → Güvenlik ve diğer → Güvenlik ve yedek | **Ayarlar → Masalar ve QR → Engellenen telefonlar** | QR siparişiyle ilgili; engel zaten masa penceresinden konur. |
| Rezervasyon ayarları | Ayarlar → Masalar ve QR → Rezervasyon | **Ajanda ve rezervasyon → Ayarlar** | Bkz. 3.7. |
| Garson masa/bölüm ataması | Ayarlar → Sipariş ve kasa → Sipariş ve onay | **Personel → Personel ayarları**; Masalar ve QR'dan bağlantı | Bkz. 3.6. |
| Ödeme sırası, değiştirme süresi, QR'da garson onayı, otomatik onay | Ayarlar → Sipariş ve kasa → Sipariş ve onay | **Ayarlar → Sipariş ve mutfak → Sipariş ve onay** (sayfa aynı, konunun adı değişir) | Kasa çıkınca konu "Sipariş ve mutfak" olur. |

### 3.6 Personel ve vardiya

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Çalışan ekle, görev, şifre yenile, hesabı kapat, Müdür yetki listesi | Çalışanlar (S) | **Personel → Çalışanlar** (S) | Ev genişleyince adı "Personel". Soru 3. |
| Vardiya planı (saat, günler) | Çalışanlar | **Personel → Çalışanlar** (aynı kartta) | |
| Açık oturumlar (kaybolan tableti çıkarma) | Çalışanlar | **Personel → Çalışanlar**; Ayarlar → Güvenlik ve yedek'ten bağlantı | Kimin girişli olduğu kişiyle ilgili. |
| Vardiya takibi (aç/kapa, görevlere göre), bahşiş dağıtımı | Ayarlar → Sipariş ve kasa → Vardiya ve bahşiş | **Personel → Personel ayarları** (yalnız S) | |
| Garson ataması | Ayarlar → Sipariş ve kasa → Sipariş ve onay (Çalışanlar'da yalnız okunur satır) | **Personel → Personel ayarları** | Ayar ile okunur satır aynı evde. |
| Vardiya kayıtları, geç kalma, vardiyayı düzelt, bahşiş payları | Satış ve Raporlar → Personel → Personel ve bahşiş | **Personel → Vardiya ve bahşiş** (S; M okur) | Düzeltilen kayıt defteri. Müdür'ün menüsüne "Personel" gelir, içinde yalnız bu sekme. |
| Çalışan başına satış | Satış ve Raporlar → Personel → Çalışanlar | Aynı kalır (analiz); Personel'den bağlantı | Kural 2. |
| Vardiya kodu (kasada) | Kasa şeridi | **Kasa ve giderler → Bugün** (ve Masalar çipi) | Kod kasada okutulur. |
| Vardiya kapısı, "Vardiyada" çipi, "Vardiyayı bitir" | Giriş sonrası / üst çubuk | Aynı kalır | |

### 3.7 Rezervasyon ve ajanda

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Rezervasyonlar, Etkinlikler, Takvim (notlar, hatırlatıcılar) | Ajanda ve rezervasyon | Aynı kalır | |
| Masada "Rezerve", "Geldi mi?", etkinlik masaları | Masalar | Aynı kalır | |
| Kapora kararı (iade et / işletmede kalsın) | Ajanda → Rezervasyonlar | Aynı kalır | |
| Rezervasyon ayarları ("Rezerve" ne zaman görünsün, "Geldi mi?" ne zaman sorulsun, kasiyer/garson yazabilir mi) | Ayarlar → Masalar ve QR → Rezervasyon | **Ajanda ve rezervasyon → Ayarlar** (yalnız S) | Kural 1 ve 4. Kasiyerin "yazma yetkiniz yok" yazısı da buraya yönlendirir. |
| Rezervasyon sonuçları (gelme oranı, kapora, etkinlik sonucu) | Satış ve Raporlar → Rezervasyon | Aynı kalır (analiz); Ajanda'da "Rezervasyon raporu" bağlantısı | Kural 2. |
| Hatırlatma bildirimi | Destek → Bildirimler | **Bildirimler (zil)**; "Ajandada göster" aynı kalır | |
| Satış notu (rapor grafiğinde güne not) | Satış ve Raporlar → Özet grafiği; Takvim'de de görünür | Aynı kalır | Zaten iki yönlü. |

### 3.8 Raporlar

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Sade özet, Detaylı → Özet, Ürünler; dönem; Yıl; Tümü; KDV dökümü; Yazdır/PDF; Muhasebeci için indir | Satış ve Raporlar | Aynı kalır | |
| "Para" grubu: Kasa kapanışları, Giderler, İade ve düzeltme | Satış ve Raporlar → Detaylı → Para | **Kasa ve giderler**'e taşınır. Raporlar'da "Para" yerine iki sürüm boyunca tabela. | Kayıt defterleri (Kural 1). |
| Personel ve bahşiş | Satış ve Raporlar → Personel | **Personel → Vardiya ve bahşiş** | |
| Kârlılık, Kampanyalar, Çalışanlar, Rezervasyon | Satış ve Raporlar | Aynı kalır | Analiz. |
| E-posta raporları (e-posta hesabı, hangi raporlar gelsin, son gönderilenler) | Ayarlar → İşletme → Raporlar ve e-posta | **Satış ve Raporlar → "Raporları gönder"** düğmesi (yalnız S; Yazdır ve Muhasebeci için indir'in yanında) | Raporun ayarı raporun yanında. Soru 6. |
| Raporlar için telefon kodu (kurma, sıfırlama) | Ayarlar → Güvenlik ve diğer → Güvenlik ve yedek | **Ayarlar → Güvenlik ve yedek → Telefonum**; Raporlar'ın kod sorduğu ekrandan bağlantı | Sahibin telefonuyla ilgili üç ayar bir arada. |
| Raporlarım telefonda (Telefonu eşleştir) | Destek → Uzaktan erişim | **Ayarlar → Güvenlik ve yedek → Telefonum**; Raporlar'dan "Raporları telefonda gör" bağlantısı | Destek işi değil; bir cihaza güven verme işi. |
| Gün/hafta/ay/yıl raporu bildirimleri | Destek → Bildirimler | **Bildirimler (zil)** | |

Raporlar'ın detaylı görünümü öneriden sonra: **Satış** (Özet, Ürünler, Kârlılık, Kampanyalar) · **Personel** (Çalışanlar) · **Rezervasyon**.

### 3.9 İşletme ve paket

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Görünüm, Sosyal medya | Ayarlar → İşletme | Aynı kalır | Bir kez kurulur. |
| Paketiniz | Ayarlar → İşletme → Paketiniz | **Ayarlar → İşletme → Paket ve lisans** | |
| Lisans durumu (kalan gün), Hizmeti dondurma talebi | Destek → Talepler sayfasının altı | **Ayarlar → İşletme → Paket ve lisans**; Destek'te tek satırlık bağlantı | Paket ve lisans aynı konu. Dondurma yine talep olarak gider. Soru 13. |
| Lisans sözleşmesi | Girişte açılan pencere | Aynı kalır; Paket ve lisans'ta "Sözleşmeyi oku" | |
| Deneme süresi uyarısı, "Pakette yok" soluk yerler, "Mola ekibine yaz" | Açılır pencere / her yerde | Aynı kalır | |
| Tanıtım işletmesini sıfırla | Ayarlar → Güvenlik ve yedek | Aynı kalır | |

### 3.10 Cihazlar ve güvenlik

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Yazıcılar, Sesler | Ayarlar → Yazıcı ve ses | **Ayarlar → Cihazlar → Yazıcılar / Sesler** | Yazıcı, ses ve tablet aynı türden ayar. |
| Bağlantı kontrolü, tablet ve telefon bağlama | Ayarlar → Güvenlik ve diğer → Cihazlar | **Ayarlar → Cihazlar → Tablet ve telefonlar** | |
| Mutfak Ekran / Fiş | Ayarlar → Sipariş ve kasa → Sipariş ve onay ("Mutfak nasıl çalışıyor?") | **Ayarlar → Sipariş ve mutfak → Mutfak**; Yazıcılar ile iki yönlü bağlantı (bugün de var) | |
| Paket servis platformları (Entegrasyonlar) | Sol menü (önizleme) ve Ayarlar → Güvenlik ve diğer → Entegrasyonlar | **Ayarlar → Sipariş ve mutfak → Paket platformları**; gelen siparişler Masalar'da (aynı) | Siparişin bir kaynağı; güvenlikle ilgisi yok. Soru 11. |
| Yedek durumu | Ayarlar → Güvenlik ve diğer → Güvenlik ve yedek | **Ayarlar → Güvenlik ve yedek → Yedek** | |
| Şimdi yedekle, ikinci yedek yeri, geri yükleme, kurtarma kodu, anahtar koruması | Kasa bilgisayarı şeridi (Yedekle, Güvenlik) | Aynı kalır (yalnız o bilgisayarda yapılabilir); Ayarlar'daki düğmeler şeridi açar (bugünkü gibi) | |
| İkiye böl, Tabletler, Kapat | Kasa bilgisayarı şeridi | Aynı kalır | Bilgisayarın kendi araçları. |
| Sahip hesabı otomatik kilit | Ayarlar → Güvenlik ve yedek | **Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme**; Hesabım ve sol alttaki "Kilitle" kısayol kalır | |
| Güncelleme ayarı | Ayarlar → Güvenlik ve yedek; sürüm satırı Hesabım'da ve Ayarlar'ın altında | **Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme** tek ev; sürüm satırları bağlantı olur | |
| Uzaktan yönetim | Ayarlar → Güvenlik ve yedek (kılavuz "Destek → Uzaktan erişim" diyor) | **Ayarlar → Güvenlik ve yedek → Telefonum** | Önce telefon kodu, sonra eşleştirme, sonra uzaktan yönetim: üç adım aynı sayfada sırayla. |

### 3.11 Destek, bildirimler, Hesabım

| İşlev | Bugün | Öneri | Neden |
|---|---|---|---|
| Talepler | Destek (S) | Aynı kalır | |
| Duyurular | Destek (S); sol menüde "Duyurular" (M) | Aynı kalır | Mola ekibinden gelir, destek konusu. |
| Önemli duyuru penceresi | Girişte | Aynı kalır | |
| **Bildirimler** (kasa farkı, iade isteği, azalan stok, otomatik gider, rapor, hatırlatma, lisans, yedek) | Destek → Bildirimler | **Üst çubukta zil: "Bildirimler"** (S; kırmızı nokta her ekranda). Masalar'daki "Yeni bir bildiriminiz var" kutusu zili açar. Destek'te bağlantı kalır. | İşletmenin kendi haberleri; Destek'e gitmek mantıksız. Soru 7. |
| Uzaktan destek izni ve "kim ne zaman bağlandı" | Destek → Uzaktan erişim | Aynı kalır; sekmenin adı **"Mola ekibi bağlantısı"** olur (eşleştirme çıkınca) | Mola ekibiyle ilgili. |
| Hesabım: şifre değiştir, Kilitle, Çıkış yap, sürüm | Hesabım | Aynı kalır | |

---

## 4. Önerilen menüler

### 4.1 Sol menü (tablet ve bilgisayar), rol başına

Sıra sık kullanılandan seyreğe. İsterseniz menüde iki küçük başlık olur: **GÜNLÜK** ve **İŞLETME** (soru 17). Destek sahipte bugünkü gibi sol altta durur.

| Rol | Bugün | Öneri |
|---|---|---|
| **Sahip** | Masalar · Sipariş al · Menü yönetimi · Stok · Kampanyalar · Ayarlar · Satış ve Raporlar · Ajanda ve rezervasyon · Çalışanlar · (Entegrasyonlar) · Destek · Hesabım | GÜNLÜK: Masalar · Sipariş al · **Kasa ve giderler** · Ajanda ve rezervasyon<br>İŞLETME: Menü yönetimi (Kampanyalar içinde) · Stok · **Personel** · Satış ve Raporlar<br>ALTTA: Ayarlar · Destek · Hesabım<br>Üst çubukta: **Bildirimler zili** |
| **Müdür** | Masalar · Sipariş al · Menü yönetimi · Stok · Kampanyalar · Satış ve Raporlar · Ajanda ve rezervasyon · Duyurular · Hesabım (Kasa yalnız telefonda) | Masalar · Sipariş al · **Kasa ve giderler** · Ajanda ve rezervasyon · Menü yönetimi · Stok · **Personel** (yalnız Vardiya ve bahşiş) · Satış ve Raporlar · Duyurular · Hesabım |
| **Kasiyer** | Masalar · Sipariş al · Rezervasyon (izin varsa) · Hesabım (Kasa yalnız telefonda) | Masalar · Sipariş al · **Kasa** (yalnız Bugün) · Rezervasyon (izin varsa) · Hesabım |
| **Garson** | Masalar · Sipariş al · Servise hazır · Rezervasyon (izin varsa) · Hesabım | Aynı kalır |
| **Mutfak** | Mutfak panosu · Stok (Sayım ve fire) · Hesabım | Aynı kalır |
| **Mola destek** (uzaktan) | Menü yönetimi · Kampanyalar · Masalar ve QR · Yazıcı ve ses · Ayarlar · Tanılama | Menü yönetimi (Kampanyalar içinde) · Masalar ve QR · Cihazlar · Ayarlar · Tanılama (yalnız adlar değişir, yetki aynı) |

Sahibin sol menüsü bugün 11 yer (+ önizlemede Entegrasyonlar), öneride yine 11: Kasa ve giderler eklenir, Kampanyalar Menü'ye girer.

### 4.2 Telefon alt çubuğu (4 yer + "Daha fazla")

| Rol | Bugün | Öneri |
|---|---|---|
| Sahip | Masalar · Sipariş al · Raporlar · Ayarlar | Masalar · Sipariş al · **Kasa** · Raporlar (Ayarlar "Daha fazla"ya) — soru 12 |
| Müdür | Masalar · Sipariş al · Raporlar · Stok | Masalar · Sipariş al · **Kasa** · Raporlar (Stok "Daha fazla"ya) |
| Kasiyer | Masalar · Sipariş al · Kasa · Rezervasyon | Aynı kalır |
| Garson | Masalar · Sipariş al · Servise hazır · Rezervasyon | Aynı kalır |

### 4.3 Evlerin sekmeleri (kim neyi görür)

Bütün evler aynı sekme çubuğunu kullanır (bugün Ayarlar, Raporlar, Stok, Destek'te kullanılan çubuk). Yalnız sahibin gördüğü ayar sekmesi her zaman en sonda ve dişli simgeli.

| Ev | Sekmeler | S | M | K | G | Mu |
|---|---|---|---|---|---|---|
| **Kasa ve giderler** | Bugün | ✓ | ✓ | ✓ | | |
| | Giderler → Kayıtlar | ✓ | ✓ (düzeltemez) | | | |
| | Giderler → Otomatik giderler | ✓ | | | | |
| | Kapanışlar | ✓ | ✓ (farkı görmez) | | | |
| | İadeler | ✓ | ✓ | | | |
| | Kasa ayarları | ✓ | | | | |
| **Menü yönetimi** | Ürünler (Kategorileri yönet, Önizle düğme olarak) | ✓ | ✓ | | | |
| | Kampanyalar | ✓ | ✓ | | | |
| | KDV oranları | ✓ | | | | |
| **Stok** | Malzemeler · Reçeteler · Ürünler · Alış ve sayım | ✓ | ✓ | | | Sayım ve fire |
| **Personel** | Çalışanlar | ✓ | | | | |
| | Vardiya ve bahşiş | ✓ | ✓ (okur) | | | |
| | Personel ayarları | ✓ | | | | |
| **Ajanda ve rezervasyon** | Rezervasyonlar · Etkinlikler | ✓ | ✓ | izinle | izinle | |
| | Takvim | ✓ | ✓ | | | |
| | Ayarlar | ✓ | | | | |
| **Satış ve Raporlar** | Sade özet / Detaylı: Satış (Özet, Ürünler, Kârlılık, Kampanyalar) · Personel (Çalışanlar) · Rezervasyon | ✓ | ✓ | | | |
| | "Raporları gönder" (e-posta), Kârlılık → "Uyarı sınırları" | ✓ | | | | |

Yalnız tek sekmesi kalan biri için (ör. kasiyerin Kasa'sı) sekme çubuğu hiç gösterilmez.

### 4.4 Ayarlar'da kalanlar (6 konu → 5 konu)

| Konu | Bölümler | Bugünden farkı |
|---|---|---|
| **İşletme** | Görünüm · Sosyal medya · Paket ve lisans | "Raporlar ve e-posta" Raporlar'a gider; Paketiniz lisansla birleşir |
| **Masalar ve QR** | Masalar ve QR · QR kodlarını yazdır · Engellenen telefonlar | Rezervasyon Ajanda'ya gider; engellenen telefonlar gelir; masa ekle/çıkar düğmeleri sayfada da görünür |
| **Sipariş ve mutfak** (eski "Sipariş ve kasa") | Sipariş ve onay · Mutfak · Paket platformları | Kasa ve ödeme Kasa'ya, Vardiya ve bahşiş ile garson ataması Personel'e gider; Entegrasyonlar gelir |
| **Cihazlar** (eski "Yazıcı ve ses") | Yazıcılar · Sesler · Tablet ve telefonlar | Cihazlar Güvenlik'ten gelir |
| **Güvenlik ve yedek** (eski "Güvenlik ve diğer") | Yedek · Kilit ve güncelleme · Telefonum | Telefonu eşleştir Destek'ten gelir; engellenen telefonlar Masalar ve QR'a gider |

Ayarlar'dan çıkanlar: **Kasa ve ödeme**, **Vardiya ve bahşiş**, **Giderler ve kâr** (otomatik giderler → Kasa, düşük kâr → Kârlılık, KDV oranları → Menü), **Rezervasyon**, **Raporlar ve e-posta**, **garson ataması**.

### 4.5 Kasa bilgisayarı şeridi

Panel · İkiye böl · Yedekle · Tabletler · Güvenlik · Kapat: **aynı kalır.** Bunlar yalnız o bilgisayarda yapılabilen işler. Ayarlar'daki Yedek ve Tablet ve telefonlar sayfaları durumu gösterip şeridi açmaya devam eder.

---

## 5. Taşımak yerine bağlantı (kısayollar)

Bir işlev iki yerde birden gerekiyorsa evinde durur, öbür yerde bir bağlantı ya da düğme olur.

| Nerede | Bağlantı / düğme | Nereye açılır |
|---|---|---|
| Kasa → Giderler → Kayıtlar başlığı | "Otomatik giderleri yönet" | Kasa → Giderler → Otomatik giderler |
| Gider satırındaki "Otomatik" rozeti | "Kira kuralı" (bugün de var) | O kuralın penceresi |
| Kasa → Giderler | "Kasiyerin gider sınırı" | Kasa → Kasa ayarları |
| Masalar kasa çipi (S, M, K) | "Gider kaydet", "İade", "Gün sonu" | Kasa evindeki aynı pencereler |
| Kapanmış masanın penceresi | "Ödemeyi düzelt" | Kasa → İadeler (bugün Raporlar'a açılıyor) |
| Stok → Alış ve sayım (gider olarak kaydedince) | "Giderlerde gör" | Kasa → Giderler → Kayıtlar |
| Raporlar → Sade özet / Özet, Giderler kartı | "Gider kayıtlarını aç" | Kasa → Giderler |
| Raporlar → Kasa durumu kartı | "Kasa kapanışları" | Kasa → Kapanışlar |
| Raporlar → komisyon oranı uyarısı | "POS oranını kontrol et" | Kasa → Kasa ayarları |
| Raporlar → eski "Para" yeri (iki sürüm) | "Taşındı: Kasa ve giderler · Git" | Kasa ve giderler |
| Raporlar → Kârlılık | "Reçete ekle" (var), "Uyarı sınırları" (S) | Stok → Reçeteler / sınır penceresi |
| Stok → Reçeteler | "Kârlılığı gör" | Raporlar → Kârlılık |
| Menü → Kampanyalar, kampanya kartı | "Sonuçları gör" | Raporlar → Kampanyalar |
| Raporlar → Kampanyalar | "Kampanyayı düzenle" | Menü → Kampanyalar |
| Ürün penceresi, KDV listesi | "KDV oranlarını yönet" | Menü → KDV oranları |
| Menüyü önizle | "Görünümü değiştir" | Ayarlar → İşletme → Görünüm |
| Ajanda | "Rezervasyon raporu" | Raporlar → Rezervasyon |
| Rezervasyonlar, "yazma yetkiniz yok" yazısı | "Ayarı sahibe sorun" (sahipte "Ayarla") | Ajanda → Ayarlar |
| Personel → Vardiya ve bahşiş | "Çalışan satışları" | Raporlar → Personel → Çalışanlar |
| Personel ayarları → Vardiya takibi | "Vardiya kodu kasada" | Kasa → Bugün |
| Ayarlar → Masalar ve QR → Masalar ve bölümler | "Hangi garson hangi bölümde?" | Personel → Personel ayarları |
| Ayarlar → Güvenlik ve yedek | "Açık oturumlar" | Personel → Çalışanlar |
| Raporlar, telefon kodu soran ekran | "Telefon kodunu kur" (S) | Ayarlar → Güvenlik ve yedek → Telefonum |
| Raporlar araç çubuğu | "Raporları telefonda gör" | Ayarlar → Güvenlik ve yedek → Telefonum |
| Sipariş ve mutfak → Mutfak (Fiş) | "Mutfak yazıcısını seç" (var) | Ayarlar → Cihazlar → Yazıcılar |
| Masalar, "Yeni bir bildiriminiz var" | "Bildirimleri aç" | Zil (Bildirimler) |
| Destek | "Bildirimler artık üst çubukta" (iki sürüm), "Paket ve lisans" | Zil / Ayarlar → İşletme → Paket ve lisans |
| Kasa bilgisayarı şeridi → Kapat | "Gün sonuna git" (var) | Kasa → Bugün |

---

## 6. Etki, riskler, efor ve sıra

### 6.1 Veri ve güvenlik
- **Hiçbir veri taşınmaz, sunucuya yeni bir şey eklenmez.** İş yalnız ekranların yerini değiştirir; her işlem bugünkü gibi sunucuda yetki kontrolünden geçer.
- **Rapor kodu (telefon kodu) kapısı:** sunucu bugün `/api/staff/reports/...` ve `/api/staff/payment-adjustments` isteklerini telefon kodu olmadan açmıyor. Giderler, Kapanışlar, İadeler ve Vardiya ve bahşiş bu isteklerle çalışıyor. Bu sekmeler Kasa'ya ve Personel'e taşınınca **aynı "telefon kodu" ekranının arkasında durmalı**, yoksa kod kurulu işletmede hata yazısı çıkar. Güvenlik açığı oluşmaz (sunucu yine kapatır) ama ekran bozuk görünür.
- **Kasiyerin Kasa'sı** yalnız "Bugün"ü göstermeli. Diğer sekmeleri sunucu zaten kapatıyor.
- **Kör sayım** (Müdür ve kasiyer kasa farkını görmez) aynı parçalar kullanıldığı için değişmez; yine de test edilmeli.

### 6.2 Testler
- Tarayıcı testlerinin çoğu ortak yardımcılar üzerinden yer açıyor (`tests/browser/helpers.ts`: `openSettings` 68 kez, `openReport` 45 kez, `openView`). Bunların içindeki yer haritası (`settingsPlaces`, `reportGroupOf`) güncellenince testlerin çoğu kendiliğinden yeni yere gider. Yeni bir yardımcı gerekir: Kasa ve Personel sekmeleri için.
- Baştan yazılacaklar: `settings-topics.spec.ts` (Ayarlar'ın her sayfasını tek tek geziyor), `bottom-nav.spec.ts` (telefon çubuğu), `manager-role.spec.ts` (Müdür menüsü), `report-simple.spec.ts` ("Giderler ve kâr"ı açıyor).
- Adı geçen testler: "İade ve düzeltme" ~30 dosyada, "Kasa kapanışları" ~23, "Personel ve bahşiş" ~10, "Destek → Bildirimler" ~5. Çoğu yardımcıyla açıyor; bir kısmı ekrandaki yazıyı arıyor.
- Sunucu ve kural testleri (`tests/*.test.ts`) etkilenmez.

### 6.3 Kullanım kılavuzu (`docs/pdf/kaynak/kilavuz/kullanim.ts`)
Değişecek bölümler: Kasiyer → Kasa işlemleri ve Gün sonu · Müdür (yetki tablosu ve `mu-ekran` resmi) · Sahip → Masalar (sol menü resmi), Menü yönetimi (KDV ve Kampanyalar), Stok ve kârlılık, Satış ve Raporlar ("Para" grubu çıkar), Ajanda (Ayarlar sekmesi), Çalışanlar → Personel, Ayarlar (6 konu → 5 konu), Destek (Bildirimler çıkar), Raporlarım telefonda ve Uzaktan yönetim adımları. Ayrıca yeni bir "Kasa ve giderler" bölümü.
Yeniden çekilecek ~20 ekran görüntüsü: `s-masalar`, `s-ayarlar`, `s-giderler-kar`, `s-kdv-oranlari`, `s-kasa-odeme`, `s-vardiya-bahsis`, `s-siparis-onay`, `s-yazicilar`, `s-cihazlar`, `s-guvenlik`, `s-masalar-qr`, `s-rapor-detay`, `s-rapor-personel`, `s-bildirimler`, `s-destek`, `s-uzaktan-erisim`, `s-telefon-eslestir`, `s-calisanlar`, `s-ajanda`, `s-paketiniz`, `mu-ekran`, `g-daha-fazla` (gerekirse).

### 6.4 Ekrandaki "→" yol yazıları
Uygulamanın içinde birçok açıklama yer tarifi veriyor ("Ayarlar → Sipariş ve kasa → Kasa ve ödeme" gibi). Kabaca sayım: taşınan yerlerin adları kod ve sunucuda ~230, belgelerde ~220 kez geçiyor (bir kısmı geliştirici notu; ekranda görünen yer tarifleri bunun bir bölümü). Sunucunun bildirim metinlerinde de var. Her tur kendi taşıdığı yerin yazılarını düzeltmeli. Mola Yönetim'deki birkaç metin de değişir ("Destek → Uzaktan erişim", "Destek → Duyurular" yazıları).

### 6.5 Alışkanlıklar
- Siz ve Müdür'ün bildiği yollar değişir: telefon çubuğunda Ayarlar'ın yerini Kasa alır, "Satış ve Raporlar → Para" kalkar, Ayarlar'ın konuları değişir.
- Önlemler: (1) eski yerlerde iki sürüm "Taşındı → Git" tabelası; (2) cihazın hatırladığı son sekme (rapor ve ayar yeri) eski bir yeri gösteriyorsa yeni yere açılır (Ayarlar'ın 10 konudan 6 konuya geçişinde aynısı yapılmıştı); (3) güncellemeyle birlikte tek bir "Neler değişti?" duyurusu.

### 6.6 Zaten var olan tutarsızlıklar (bu işle düzelir)
- Kılavuz uzaktan yönetimin "Destek → Uzaktan erişim"de açıldığını yazıyor; uygulamada Ayarlar → Güvenlik ve diğer'de.
- Test yardımcısının açıklaması "Giderler ve kâr'ın bölümü yok" diyor, ama o sayfada üç ayrı kart var (otomatik giderler, düşük kâr, KDV).
- Geliştirici rehberindeki Ayarlar satırı eski bir adı ("Kasa ve vardiya") kullanıyor ve KDV oranlarını saymıyor.

### 6.7 Efor ve sıra

Sizin tercihinize uygun olarak küçük turlar. Her tur kendi testleri yeşil, kendi kılavuz paragrafı güncel olarak biter.

| Tur | İş | Tahmini süre |
|---|---|---|
| **1** | **Kasa ve giderler** evi: Bugün · Giderler (Kayıtlar, Otomatik giderler) · Kapanışlar · İadeler · Kasa ayarları. Raporlar'da "Para" tabelası, Ayarlar'dan Kasa ve ödeme ile otomatik giderlerin çıkışı, sahibin kasa çipine "Gider kaydet", "Ödemeyi düzelt" ve bildirim bağlantıları, telefon kodu kapısı. | ~2 gün |
| **2** | "Giderler ve kâr" konusunun kalkması: KDV oranları → Menü, düşük kâr → Kârlılık. | ~0,5 gün |
| **3** | Bildirimler zili; Güvenlik → Telefonum (telefon kodu + eşleştirme + uzaktan yönetim); Paket ve lisans; Destek'in sadeleşmesi. | ~1 gün |
| **4** | Personel evi (Vardiya ve bahşiş, Personel ayarları, garson ataması); Ajanda → Ayarlar (rezervasyon). | ~1–1,5 gün |
| **5** | Ayarlar'ın 5 konusu (Sipariş ve mutfak, Cihazlar, Engellenen telefonlar, Paket platformları); E-posta raporları → Raporlar. | ~1 gün |
| **6** | Menüler: sıra ve başlıklar, Kampanyalar → Menü (onaylarsanız), telefon çubuğu, kasiyerin sol menüsünde Kasa, Mola destek menüsünün adları. | ~0,5–1 gün |
| **7** | Kılavuz ekran görüntüleri, geliştirici rehberi, son kontrol; tabelaların iki sürüm sonra kaldırılma notu. | ~1–1,5 gün |
| | **Toplam** | **~7–9 iş günü** |

Neden bu sıra: Tur 1 sizin verdiğiniz örneği çözüyor ve diğer evler için kalıp oluyor (sekmeler, sahibe özel ayar sekmesi, telefon kodu kapısı, tabela). Tur 2 ve 3 küçük ve bağımsız. Tur 4 Müdür'ün menüsünü değiştirdiği için Tur 1'den öğrenilenlerle yapılmalı. Menü sırası ve çubuk (Tur 6) en sonda, çünkü yerler netleşmeden sıralamak boşa iş olur.

---

## 7. Açık sorular (her birinde önerim var)

| # | Soru | Önerim |
|---|---|---|
| 1 | Yeni yerin adı ne olsun: "Kasa ve giderler", "Kasa" ya da "Para"? | Sol menüde **"Kasa ve giderler"**, telefon çubuğunda kısa ad **"Kasa"**. Kafeci "kasa" der; "giderler" kelimesi aradığı şeyi gösterir. |
| 2 | Kampanyalar ayrı bir yer olarak mı kalsın, Menü yönetimi'nin sekmesi mi olsun? | **Menü'nün sekmesi olsun.** Kampanya menüdeki ürüne uygulanır, sol menüde bir yer azalır. Kampanyayı çok sık kullanıyorsanız ayrı kalabilir; o zaman sol menü 12 yer olur. |
| 3 | "Çalışanlar"ın adı "Personel" olsun mu? Müdür bu yeri görsün mü (yalnız Vardiya ve bahşiş)? | **Evet, "Personel".** İçinde hesapların yanında vardiya ve bahşiş de olacak. Müdür bugün bu kayıtları Raporlar'da okuyor; aynı şeyi Personel'de okur, hesaplara dokunamaz. |
| 4 | Analiz raporları (Kampanyalar, Çalışanlar, Rezervasyon) da evlerine mi gitsin? | **Hayır, Raporlar'da kalsın**, iki yönlü bağlantıyla (Kural 2). Hepsi gitse Raporlar'da yalnız Özet ve Ürünler kalır, muhasebeci dosyası ile yıl tablosu her konuya bölünür. |
| 5 | Kârlılık Stok'a mı taşınsın? (Kılavuzda "Stok, reçete ve kârlılık" diye anlatılıyor.) | **Raporlar'da kalsın**: dönem seçilen bir rapor. Stok → Reçeteler'den bir bağlantı yeter. Düşük kâr sınırları Kârlılık'ın içine gelir. |
| 6 | E-posta raporları Raporlar'a mı, Ayarlar'da mı? | **Raporlar'a** ("Raporları gönder" düğmesi). E-posta hesabı bir kez kurulsa da "hangi rapor gelsin" ve "son gönderilenler" raporun parçası. |
| 7 | Bildirimler nerede dursun: üst çubukta zil mi, sol menüde ayrı bir yer mi? | **Üst çubukta zil.** Her ekranda görünür, sol menüye yer eklemez. Herkesin bildiği bir kalıp. |
| 8 | Masa ekle / çıkar Masalar'da mı kalsın? | **Masalar'da kalsın** (kısayol) ve **Ayarlar → Masalar ve QR'da da** gerçek düğme olarak dursun. Bugünkü "Masalar ekranındadır" yazısı kalkar. Masalar başlığında tek bir "Masaları düzenle" düğmesi de düşünülebilir; acil değil. |
| 9 | Sahibin telefonuyla ilgili üç ayar Güvenlik'te mi, Destek'te mi toplansın? | **Ayarlar → Güvenlik ve yedek → Telefonum.** Üçü de güvenlik ayarı ve bu sırayla kurulur. Destek yalnız Mola ekibiyle ilgili kalır. |
| 10 | Engellenen müşteri telefonları Masalar ve QR'a mı? | **Evet.** QR siparişinin ayarı; engel masa penceresinden konuyor. |
| 11 | Sol menüdeki "Entegrasyonlar" (önizleme) kopyası kalsın mı? | Tek ev **Ayarlar → Sipariş ve mutfak → Paket platformları** olsun. Önizleme bitince sol menüdeki kopya kalksın; gelen siparişler zaten Masalar'da. |
| 12 | Sahibin telefon çubuğunda Ayarlar'ın yerini Kasa mı alsın? | **Evet: Masalar · Sipariş al · Kasa · Raporlar.** Ayarlar seyrek açılacak ("Daha fazla"da). Telefonda Ayarlar'ı sık açıyorsanız Sipariş al'ın yerine Ayarlar kalabilir. |
| 13 | Lisans durumu ve "Hizmeti dondur" Paket ve lisans'a mı? | **Evet**; dondurma yine bir talep olarak Mola ekibine gider. Destek'te tek satırlık bağlantı kalır. |
| 14 | Fotoğraf alanı Menü'ye mi, Cihazlar'da mı? | **Cihazlar'da kalsın.** Bilgisayarın diskiyle ilgili, seyrek bir bakım işi. |
| 15 | Kasiyerin sol menüsüne (tablet ve bilgisayar) "Kasa" eklensin mi? | **Evet.** Bugün yalnız telefonda var; her ekranda aynı yerde olması tutarlı. Masalar'daki şerit de kalır. |
| 16 | "Kart bahşişini kasadan nakit öde" Kasa ayarlarında mı, Personel ayarlarında mı? | **Kasa ayarlarında.** Kasadan para çıkarıyor ve gün sonunu etkiliyor. Bahşişin nasıl paylaşılacağı Personel'de. |
| 17 | Sol menüye "GÜNLÜK / İŞLETME" küçük başlıkları konsun mu? | **Evet**, maliyeti düşük; 11 yer iki gruba ayrılınca göz daha kolay bulur. İstemezseniz yalnız sıralama yeter. |
| 18 | Otomatik giderleri Müdür görsün mü (yalnız okuma)? | **Hayır**, bugünkü gibi yalnız sahip. Müdür otomatik yazılan giderleri Kayıtlar'da "Otomatik" rozetiyle zaten görür. |

# Mola Görsel Stüdyosu · Kullanım şablonu

Bu dosya, "Mola Görsel Stüdyosu" Gem'iyle bir işletmenin görsellerini baştan sona hazırlarken sırayla kopyalayıp dolduracağınız mesajlardır. `<...>` olan yerleri doldurun, gerisini olduğu gibi bırakın.

**Altın kural:** Her işletme için Gemini'de **ayrı bir sohbet** açın. Sohbetin adını işletmenin adı yapın (sohbet menüsü → Yeniden adlandır). O işletmenin bütün işleri o sohbette yapılır.

---

## ADIM 0 · Hazırlık (işletmeye gitmeden önce)

İşletmeden toplayacaklarınız:

- [ ] İşletmenin tam adı (tabeladaki yazılışıyla)
- [ ] Türü (kafe / restoran / tatlıcı-pastane / çay bahçesi)
- [ ] Mola'da seçtikleri renk paleti (Ayarlar → İşletme → Renk paleti)
- [ ] Varsa mevcut logoları (fotoğraf ya da dosya)
- [ ] Tabak, kâse, bardak, fincan, çatal-kaşık fotoğrafları (aşağıdaki çekim notu)
- [ ] Masa yüzeyi ve duvar/ortam fotoğrafı (yalnız MEKÂN tarzı için)
- [ ] Menü listesi (ürün adları, varsa içerikleri)

**Kap fotoğrafı çekim notu:** Her parçayı boş, temiz, gün ışığında, sade bir masada çekin. Her biri için bir yandan (göz hizası) bir de hafif yukarıdan fotoğraf. Arkada dağınıklık olmasın, flaş kullanmayın.

---

## ADIM 1 · İşletme kartı (sohbetin ilk mesajı)

```
Yeni işletme.
İşletme adı: <tabeladaki yazılışıyla>
Tür: <kafe / restoran / tatlıcı-pastane / çay bahçesi>
Palet: <Mola paleti, örn. Kahve · Krem>
Tarz: <modern-sade / sıcak-ahşap / geleneksel / endüstriyel / lüks / genç-renkli>
Logo: <istiyorum: amblem + ad / yalnız amblem / monogram · istemiyorum>
Logo sembolü (isteğe bağlı): <fincan / çatal / yaprak / çay bardağı / yok>
Menü görsel tarzı: <STÜDYO / MEKÂN>
Zemin (STÜDYO ise): <kırık beyaz / saf beyaz>
Notlar: <örn. işletme 1985'ten beri var, geleneksel his istiyorlar>
```

Gem kartı tablo hâlinde özetler. Her satırı kontrol edin (özellikle adın yazılışını), sonra:

```
Onaylıyorum.
```

---

## ADIM 2 · Kapları tanıtmak (sahne şablonu)

Her kap için ayrı mesaj gönderin; fotoğrafları ekleyin.

```
Bu <kabın adı, örn. çay bardağı / tatlı tabağı / soğuk içecek bardağı>.
Bu kapta servis edilenler: <örn. demleme çay, bitki çayları>.
Sahne şablonuna ekle; şeklini, boyunu, rengini, desenini ve malzemesini aynen koru.
```

Gem tarif eder. Doğruysa:

```
Doğru, kaydet.
```

Yanlışsa:

```
Düzelt: <örn. kenarı altın değil gümüş, tabak yuvarlak değil oval>.
```

Bütün kaplar bitince:

```
Kaplar bu kadar. Sahne/stüdyo setini özetle ve onayıma sun.
```

Gem'in özetine bakın, ardından `Onaylıyorum.` yazın.

---

## ADIM 3 · Logo (istenirse)

```
Logo hazırla. 3 farklı yön göster.
```

Birini seçmek için:

```
<1 / 2 / 3> numaralıyı seçiyorum. Şunları değiştir: <örn. yazı biraz daha kalın, amblem daha sade>.
```

Bitince:

```
Logo tamam. Kartın Logo satırına renk kodlarıyla kaydet ve son hâlini 1024×1024 PNG ver.
```

**Logoyu kontrol edin:** Köşeler dahil zemin dolu mu (beyaz köşe yok)? Telefonda pul kadar küçültünce ne olduğu anlaşılıyor mu? Mola'ya yazısız sürüm yüklenir (ad zaten yanında yazar).

Baskı ve sosyal medya için yazılı sürüm:

```
Aynı amblemle BASKI SÜRÜMÜNÜ de ver: altında işletme adı. Ad doğru yazılsın (ç, ğ, ı, İ, ö, ş, ü).
```

---

## ADIM 4A · Fotoğrafı olmayan ürün (STÜDYO çekimi)

```
Stüdyo çekimi: <ürün adı>.
Kap: <hangi kap, örn. bizim çay bardağımız>.
Görünüş: <örn. bardak 4/5 dolu, koyu amber renk, üstünde köpük yok>.
Yanında: <örn. tabağında 2 küp şeker ve ince çay kaşığı / hiçbir şey>.
Süsleme: <örn. bir dal nane / yok>.
Ekleme yapma; yalnız yazdıklarımı kullan.
```

Hazır örnekler:

```
Stüdyo çekimi: demleme çay.
Kap: bizim ince belli çay bardağımız, kendi tabağında.
Görünüş: bardak 4/5 dolu, berrak koyu amber.
Yanında: tabakta 2 küp şeker ve ince çay kaşığı.
Süsleme: yok.
Ekleme yapma; yalnız yazdıklarımı kullan.
```

```
Stüdyo çekimi: ev yapımı limonata.
Kap: bizim soğuk içecek bardağımız.
Görünüş: bardak 4/5 dolu, açık sarı, içinde 3–4 buz, bardağın yüzeyinde hafif buğu ve su damlaları.
Yanında: hiçbir şey.
Süsleme: kenarda ince limon dilimi, bir dal taze nane, pipet yok.
Ekleme yapma; yalnız yazdıklarımı kullan.
```

```
Stüdyo çekimi: Türk kahvesi.
Kap: bizim porselen kahve fincanımız ve tabağı.
Görünüş: üstü yoğun köpüklü.
Yanında: küçük bir bardak su, tabakta bir adet lokum.
Süsleme: yok.
Ekleme yapma; yalnız yazdıklarımı kullan.
```

---

## ADIM 4B · İşletmenin gönderdiği fotoğraftan (gerçek ürün)

İşletmenin WhatsApp'tan attığı fotoğrafı ekleyin:

```
Bu <ürün adı>, işletmenin gerçek ürünü.
Profesyonel çekim gibi yap; <STÜDYO setimizle / MEKÂN sahnemizle>.
Ürünü, porsiyonu, malzemeleri, sosu, süslemeyi ve kabı AYNEN koru; yalnız ışığı, açıyı, arka planı ve dağınıklığı düzelt.
```

Fotoğrafta birden fazla ürün varsa:

```
Fotoğraftaki <soldaki / ortadaki / sağdaki> ürün: <ürün adı>. Yalnız onu kullan.
```

---

## ADIM 5 · Düzeltme kalıpları

Görsel beğenilmezse bunlardan birini ya da birkaçını yazın:

```
Işık biraz daha sıcak olsun.
Işık biraz daha soğuk ve temiz olsun.
Zemin daha açık olsun.
Ürün biraz daha büyük görünsün; üstte ve altta boşluk yine kalsın.
Ürün biraz daha küçük görünsün, tam ortada dursun.
Açı biraz daha yukarıdan olsun.
Açı biraz daha göz hizasında olsun.
Bardak/tabak bizim kabımıza tam benzemiyor; şablondaki kabın aynısını kullan.
Şunu kaldır: <örn. arkadaki yaprak>.
Daha gerçekçi olsun; yapay ve plastik görünüyor.
Bu görsel, bu sohbetteki diğer ürünlerle aynı ışık ve zeminde değil; eşitle.
```

---

## ADIM 6 · Ürün metni (isteğe bağlı)

```
<ürün adı> için Mola'ya ad ve açıklama yaz. Türkçe ve İngilizce.
Ad en fazla 80, açıklama en fazla 240 karakter.
İçindekiler: <örn. demleme siyah çay, Rize>.
Uydurma iddia yok (ev yapımı, organik, sağlıklı vb. yazma).
```

---

## ADIM 7 · Mola'ya yüklemeden önce son kontrol

Her görsel için:

- [ ] Ürün gerçeğiyle aynı mı (porsiyon, malzeme, süsleme, kap)?
- [ ] Menüdeki açıklamada yazan her şey görselde de var mı (nane, limon, buz…)?
- [ ] Kare mi, ürün ortada mı, üstte ve altta boşluk var mı?
- [ ] Yazı, filigran, el ya da başka marka var mı? (Olmamalı.)
- [ ] Bu işletmenin diğer görselleriyle aynı ışık ve zeminde mi?
- [ ] Dosya adı: `isletme-adi_kategori_urun-adi.png`

Yükleme yerleri:

- **Logo:** Mola → Ayarlar → İşletme → Görünüm → Logo seç.
- **Ürün fotoğrafı:** Mola → Menü yönetimi → ürün → Fotoğraf.

---

## İşletme takip tablosu (kopyalayıp her işletme için doldurun)

| İşletme | Gemini sohbet adı | Palet | Tarz | Logo | Kaplar tanıtıldı | Hazır görseller | Bekleyen ürünler |
|---|---|---|---|---|---|---|---|
| <ad> | <ad> | <palet> | STÜDYO / MEKÂN | ✓ / ✗ | ✓ / ✗ | <sayı> | <liste> |

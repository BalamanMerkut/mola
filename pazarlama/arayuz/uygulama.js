// Mola Pazarlama arayüzü. Bütün metinler textContent ile yazılır (innerHTML yok); bağlantılar yalnızca http(s)/mailto/tel.
'use strict';

const durum = { isletmeler: [], bilgi: null, bugun: '', yukleniyor: null };
const FILTRE_ANAHTARI = 'mola-pazarlama-filtre';
const varsayilanFiltre = { ara: '', tur: '', ilce: '', mahalle: '', durum: '', instagram: '', eposta: false, zincirGizle: true, sirala: 'oncelik' };
let filtre = { ...varsayilanFiltre };
try { filtre = { ...varsayilanFiltre, ...JSON.parse(localStorage.getItem(FILTRE_ANAHTARI) || '{}') }; } catch { /* özel pencere */ }
const filtreKaydet = () => { try { localStorage.setItem(FILTRE_ANAHTARI, JSON.stringify(filtre)); } catch { /* geç */ } };

// ---------- Yardımcılar ----------

function guvenliUrl(u) {
  const s = String(u || '').trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(s) ? s : '';
}

/** h('div', { class: 'x', onclick: f }, 'metin', çocuk...) */
function h(etiket, ozellik, ...cocuklar) {
  const el = document.createElement(etiket);
  for (const [k, v] of Object.entries(ozellik || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'href') { const g = guvenliUrl(v) || (String(v).startsWith('#') ? v : ''); if (g) el.setAttribute('href', g); if (/^https?:/i.test(g)) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } }
    else if (k === 'value') el.value = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM: CSP satır içi stil özelliğine izin vermez
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of cocuklar.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(yontem, yol, govde) {
  const y = await fetch(yol, { method: yontem, headers: govde !== undefined ? { 'Content-Type': 'application/json' } : {}, body: govde !== undefined ? JSON.stringify(govde) : undefined });
  const tur = y.headers.get('content-type') || '';
  const veri = tur.includes('json') ? await y.json() : await y.blob();
  if (!y.ok) throw new Error((veri && veri.hata) || `Hata ${y.status}`);
  return veri;
}

let bildirimZamani;
function bildir(metin, hata = false) {
  const el = document.getElementById('bildirim');
  el.textContent = metin; el.hidden = false; el.classList.toggle('hata', hata);
  clearTimeout(bildirimZamani);
  bildirimZamani = setTimeout(() => { el.hidden = true; }, hata ? 5000 : 1800);
}

const sade = (s) => String(s || '').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
const durumAdi = (kod) => (durum.bilgi?.durumlar.find((d) => d.kod === kod) || { ad: kod }).ad;
const tarihYaz = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const gunYaz = (g) => { if (!g) return ''; const [y, a, d] = g.split('-').map(Number); return new Date(y, a - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' }); };
function gunEkle(gunSayisi) { const [y, a, d] = durum.bugun.split('-').map(Number); const t = new Date(Date.UTC(y, a - 1, d + gunSayisi)); return t.toISOString().slice(0, 10); }
const puanSinifi = (p) => `puan${p >= 50 ? ' yuksek' : p >= 25 ? ' orta' : ''}`;
const hostAdi = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const kaynakAdi = { osm: 'OSM', google: 'Google', foursquare: 'Foursquare', web: 'Web', elle: 'Elle' };
const instaUrl = (ad) => `https://www.instagram.com/${encodeURIComponent(ad)}/`;
const takipEdilmedi = (k) => k.durum === 'bulundu' || k.durum === 'takip';

async function yukle() {
  const [liste, bilgi] = await Promise.all([api('GET', '/api/isletmeler'), api('GET', '/api/durum')]);
  durum.isletmeler = liste.isletmeler; durum.bugun = liste.bugun; durum.bilgi = bilgi;
  const bugunSay = bugunListesi().length;
  const r = document.getElementById('bugun-sayi');
  r.textContent = String(bugunSay); r.hidden = !bugunSay;
}

function kaydiGuncelle(k) {
  const i = durum.isletmeler.findIndex((x) => x.id === k.id);
  if (i >= 0) durum.isletmeler[i] = k; else durum.isletmeler.push(k);
}

// ---------- Liste ----------

function filtrele() {
  const ara = sade(filtre.ara);
  let l = durum.isletmeler.filter((k) => {
    if (filtre.zincirGizle && k.zincir) return false;
    if (filtre.tur && k.tur !== filtre.tur) return false;
    if (filtre.ilce && k.ilce !== filtre.ilce) return false;
    if (filtre.mahalle && k.mahalle !== filtre.mahalle) return false;
    if (filtre.durum && k.durum !== filtre.durum) return false;
    if (filtre.instagram === 'var' && !k.instagram) return false;
    if (filtre.instagram === 'yok' && k.instagram) return false;
    if (filtre.eposta && !k.eposta) return false;
    if (ara && !sade([k.ad, k.mahalle, k.ilce, k.adres, k.instagram, k.eposta, k.tur].join(' ')).includes(ara)) return false;
    return true;
  });
  const s = filtre.sirala;
  const ad = (a, b) => a.ad.localeCompare(b.ad, 'tr');
  l = l.sort(s === 'ad' ? ad
    : s === 'mahalle' ? (a, b) => (a.mahalle || 'zzz').localeCompare(b.mahalle || 'zzz', 'tr') || ad(a, b)
      : s === 'takip' ? (a, b) => (a.sonrakiTakip || '9999').localeCompare(b.sonrakiTakip || '9999') || ad(a, b)
        : s === 'guncelleme' ? (a, b) => b.guncelleme.localeCompare(a.guncelleme)
          : s === 'yorum' ? (a, b) => (b.googleYorum ?? -1) - (a.googleYorum ?? -1) || ad(a, b)
            : (a, b) => b.oncelik - a.oncelik || ad(a, b));
  return l;
}

const essiz = (alan) => [...new Set(durum.isletmeler.map((k) => k[alan]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

function secim(alan, bos, secenekler) {
  return h('select', { 'aria-label': bos, onchange: (e) => { filtre[alan] = e.target.value; filtreKaydet(); cizListe(); } },
    h('option', { value: '' }, bos), secenekler.map(([v, t]) => h('option', { value: v, selected: filtre[alan] === v }, t)));
}

let aramaZamani;
function cizListe() {
  const ana = document.getElementById('ana');
  const liste = filtrele();
  const tablo = h('div', { class: 'tablo-kap' });
  if (!durum.isletmeler.length) {
    tablo.append(h('div', { class: 'bos' }, h('p', null, 'Liste boş.'), h('a', { class: 'dugme dugme-ana', href: '#/topla' }, 'OpenStreetMap\'ten getir')));
  } else if (!liste.length) {
    tablo.append(h('div', { class: 'bos' }, 'Bu filtrelere uyan işletme yok.'));
  } else {
    tablo.append(h('table', null,
      h('thead', null, h('tr', null, ['Öncelik', 'İşletme', 'Yer', 'Instagram', 'E-posta', 'Telefon', 'Web', 'Kaynak', 'Durum', 'Son not', 'Takip'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, liste.map(satir))));
  }
  const aramaKutusu = h('input', { type: 'search', placeholder: 'Ara: ad, mahalle, @instagram…', value: filtre.ara, 'aria-label': 'Ara',
    oninput: (e) => { filtre.ara = e.target.value; filtreKaydet(); clearTimeout(aramaZamani); aramaZamani = setTimeout(() => { cizListe(); const k = document.querySelector('.filtreler input[type=search]'); if (k) { k.focus(); k.setSelectionRange(k.value.length, k.value.length); } }, 200); } });
  ana.replaceChildren(
    h('div', { class: 'ozet-satiri' },
      h('h1', null, 'İşletmeler'),
      h('div', { class: 'dugmeler' },
        h('span', { class: 'soluk' }, `${liste.length} / ${durum.isletmeler.length} kayıt`),
        h('button', { class: 'dugme kucuk', type: 'button', onclick: () => csvIndir(liste) }, 'CSV indir (Excel)'),
        h('button', { class: 'dugme kucuk', type: 'button', onclick: () => { filtre = { ...varsayilanFiltre }; filtreKaydet(); cizListe(); } }, 'Filtreleri temizle'))),
    h('div', { class: 'filtreler' },
      aramaKutusu,
      secim('tur', 'Tür: hepsi', essiz('tur').map((t) => [t, t])),
      secim('ilce', 'İlçe: hepsi', essiz('ilce').map((t) => [t, t])),
      secim('mahalle', 'Mahalle: hepsi', essiz('mahalle').map((t) => [t, t])),
      secim('durum', 'Durum: hepsi', (durum.bilgi?.durumlar || []).map((d) => [d.kod, d.ad])),
      secim('instagram', 'Instagram: hepsi', [['var', 'Instagram var'], ['yok', 'Instagram yok']]),
      h('label', { class: 'onay' }, h('input', { type: 'checkbox', checked: filtre.eposta, onchange: (e) => { filtre.eposta = e.target.checked; filtreKaydet(); cizListe(); } }), 'E-posta var'),
      h('label', { class: 'onay' }, h('input', { type: 'checkbox', checked: filtre.zincirGizle, onchange: (e) => { filtre.zincirGizle = e.target.checked; filtreKaydet(); cizListe(); } }), 'Zincirleri gizle'),
      h('select', { 'aria-label': 'Sırala', onchange: (e) => { filtre.sirala = e.target.value; filtreKaydet(); cizListe(); } },
        [['oncelik', 'Sırala: öncelik'], ['ad', 'Sırala: ad'], ['mahalle', 'Sırala: mahalle'], ['takip', 'Sırala: takip tarihi'], ['guncelleme', 'Sırala: son değişen'], ['yorum', 'Sırala: Google yorum']]
          .map(([v, t]) => h('option', { value: v, selected: filtre.sirala === v }, t)))),
    tablo);
}

function satir(k) {
  const son = k.notlar[k.notlar.length - 1];
  const dur = (e) => e.stopPropagation();
  return h('tr', { onclick: () => { location.hash = `#/isletme/${k.id}`; } },
    h('td', null, h('span', { class: puanSinifi(k.oncelik), title: 'Öncelik puanı (0–100)' }, k.oncelik)),
    h('td', { class: 'ad' }, h('a', { href: `#/isletme/${k.id}`, onclick: dur }, h('b', null, k.ad)), h('span', { class: 'alt' }, k.tur || '', k.zincir ? ' · ' : '', k.zincir ? h('span', { class: 'cip cip-zincir' }, 'zincir') : null)),
    h('td', null, k.mahalle || '', k.mahalleYaklasik && k.mahalle ? ' ~' : '', h('span', { class: 'alt' }, k.ilce || '')),
    h('td', { class: 'dar' }, k.instagram ? h('a', { href: instaUrl(k.instagram), onclick: dur }, `@${k.instagram}`) : h('span', { class: 'soluk' }, '—')),
    h('td', { class: 'dar' }, k.eposta ? h('a', { href: `mailto:${k.eposta}`, onclick: dur }, k.eposta) : ''),
    h('td', { class: 'dar' }, k.telefon ? h('a', { href: `tel:${k.telefon.replace(/[^\d+]/g, '')}`, onclick: dur }, k.telefonYerel) : ''),
    h('td', { class: 'dar' }, k.web ? h('a', { href: k.web, onclick: dur }, hostAdi(k.web)) : ''),
    h('td', null, k.kaynaklar.map((s) => h('span', { class: 'cip cip-kaynak' }, kaynakAdi[s] || s)), ' '),
    h('td', null, h('span', { class: `cip d-${k.durum}` }, durumAdi(k.durum))),
    h('td', { class: 'not-kisa' }, son ? son.metin.slice(0, 80) : ''),
    h('td', { class: 'dar' + (k.sonrakiTakip && k.sonrakiTakip <= durum.bugun ? ' gecikti' : '') }, gunYaz(k.sonrakiTakip)));
}

async function csvIndir(liste) {
  try {
    const blob = await api('POST', '/api/disa-aktar', { ids: liste.map((k) => k.id) });
    const a = h('a', null);
    a.href = URL.createObjectURL(blob); a.download = `mola-pazarlama-${durum.bugun}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { bildir(e.message, true); }
}

// ---------- İşletme kartı ----------

async function kaydet(k, alanlar, mesaj = 'Kaydedildi') {
  try {
    const yeni = await api('PATCH', `/api/isletmeler/${k.id}`, alanlar);
    kaydiGuncelle(yeni); bildir(mesaj);
    return yeni;
  } catch (e) { bildir(e.message, true); return null; }
}

function metinAlani(k, alan, etiket, ozellik = {}) {
  return h('label', { class: 'alan' }, etiket,
    h('input', { value: k[alan] ?? '', ...ozellik, onchange: async (e) => { const y = await kaydet(k, { [alan]: e.target.value }); if (y) cizKart(y.id); else e.target.value = k[alan] ?? ''; } }));
}

function secenekDugmeleri(k, alan, secenekler, cizAyni = true) {
  return h('div', { class: 'dugmeler' }, secenekler.map(([deger, etiket]) =>
    h('button', { type: 'button', class: 'dugme kucuk', 'aria-pressed': String(k[alan] === deger),
      onclick: async () => { const y = await kaydet(k, { [alan]: k[alan] === deger ? (typeof deger === 'number' ? null : '') : deger }); if (y && cizAyni) cizKart(y.id); } }, etiket)));
}

function cizKart(id) {
  const k = durum.isletmeler.find((x) => x.id === id);
  const ana = document.getElementById('ana');
  if (!k) { ana.replaceChildren(h('p', null, 'Kayıt bulunamadı. ', h('a', { href: '#/liste' }, 'Listeye dön'))); return; }
  const araliklar = durum.bilgi?.takipciAraliklari || [];
  const aralikSecili = (deger, i) => k.takipci != null && k.takipci >= deger && (i === araliklar.length - 1 || k.takipci < araliklar[i + 1].deger);
  const notKutusu = h('textarea', { placeholder: 'Ne oldu? (ör. "Instagram\'dan yazdım, akşam bakacaklarmış")', 'aria-label': 'Yeni not' });
  const notEkle = async (metin) => {
    if (!metin.trim()) return;
    try { const y = await api('POST', `/api/isletmeler/${k.id}/notlar`, { metin }); kaydiGuncelle(y); bildir('Not eklendi'); cizKart(k.id); } catch (e) { bildir(e.message, true); }
  };

  const ust = h('div', { class: 'kart-ust' },
    h('div', null,
      h('a', { href: '#/liste', class: 'kucuk-yazi' }, '← Listeye dön'),
      h('h1', null, k.ad),
      h('div', { class: 'dugmeler' },
        h('span', { class: `cip d-${k.durum}` }, durumAdi(k.durum)),
        k.tur ? h('span', { class: 'cip' }, k.tur) : null,
        k.zincir ? h('span', { class: 'cip cip-zincir' }, 'zincir') : null,
        k.kaynaklar.map((s) => h('span', { class: 'cip cip-kaynak' }, kaynakAdi[s] || s)),
        [k.mahalle, k.ilce].filter(Boolean).length ? h('span', { class: 'soluk' }, [k.mahalle && `${k.mahalle}${k.mahalleYaklasik ? ' (yaklaşık)' : ''}`, k.ilce].filter(Boolean).join(' · ')) : null)),
    h('div', { class: 'buyuk-puan' },
      h('span', { class: puanSinifi(k.oncelik) }, k.oncelik),
      h('div', { class: 'soluk kucuk-yazi' }, 'Öncelik'),
      h('details', null, h('summary', { class: 'kucuk-yazi' }, 'Neden?'),
        h('ul', { class: 'dokum' }, k.oncelikParcalari.filter((p) => p.puan).map((p) => h('li', null, h('span', null, p.ad), h('b', null, `+${p.puan}`))),
          k.zincir ? h('li', null, h('span', null, 'Zincir (çarpan)'), h('b', null, '×')) : null,
          !k.oncelikParcalari.some((p) => p.puan) ? h('li', null, 'Henüz bilgi yok') : null))));

  const durumKarti = h('section', { class: 'kart' },
    h('h3', { class: 'grup-baslik' }, 'Durum'),
    h('div', { class: 'dugmeler' }, (durum.bilgi?.durumlar || []).map((d) =>
      h('button', { type: 'button', class: 'dugme kucuk', 'aria-pressed': String(k.durum === d.kod), onclick: async () => { const y = await kaydet(k, { durum: d.kod }, `Durum: ${d.ad}`); if (y) cizKart(y.id); } }, d.ad))),
    h('h3', { class: 'grup-baslik' }, 'Sonraki takip'),
    h('div', { class: 'satir' },
      h('input', { type: 'date', value: k.sonrakiTakip, 'aria-label': 'Sonraki takip tarihi', style: 'max-width:180px', onchange: async (e) => { const y = await kaydet(k, { sonrakiTakip: e.target.value }); if (y) cizKart(y.id); } }),
      [['Yarın', 1], ['+3 gün', 3], ['+1 hafta', 7], ['+2 hafta', 14]].map(([t, g]) => h('button', { type: 'button', class: 'dugme kucuk', onclick: async () => { const y = await kaydet(k, { sonrakiTakip: gunEkle(g) }, `Takip: ${gunYaz(gunEkle(g))}`); if (y) cizKart(y.id); } }, t)),
      k.sonrakiTakip ? h('button', { type: 'button', class: 'dugme kucuk', onclick: async () => { const y = await kaydet(k, { sonrakiTakip: '' }); if (y) cizKart(y.id); } }, 'Kaldır') : null),
    h('h3', { class: 'grup-baslik' }, 'Notlar'),
    notKutusu,
    h('div', { class: 'dugmeler', style: 'margin-top:6px' },
      h('button', { type: 'button', class: 'dugme dugme-ana kucuk', onclick: () => notEkle(notKutusu.value) }, 'Notu ekle'),
      ['Instagram\'dan yazdım', 'E-posta attım', 'Aradım, ulaşamadım', 'Uğradım, yetkili yoktu'].map((t) => h('button', { type: 'button', class: 'dugme kucuk', onclick: () => notEkle(t) }, t))),
    h('ul', { class: 'notlar' }, [...k.notlar.entries()].reverse().map(([i, n]) => h('li', null,
      h('time', { datetime: n.tarih }, tarihYaz(n.tarih)), h('div', { class: 'not-metin' }, n.metin),
      h('button', { type: 'button', class: 'sil', title: 'Notu sil', onclick: async () => { if (!confirm('Bu not silinsin mi?')) return; try { const y = await api('DELETE', `/api/isletmeler/${k.id}/notlar/${i}`); kaydiGuncelle(y); cizKart(k.id); } catch (e) { bildir(e.message, true); } } }, 'sil')))));

  const yatirimKarti = h('section', { class: 'kart' },
    h('h3', { class: 'grup-baslik' }, 'İşine yatırım yapıyor mu?'),
    h('p', { class: 'soluk kucuk-yazi' }, 'Profili açtığınızda birkaç saniyede işaretleyin; öncelik puanı buna göre değişir.'),
    h('div', { class: 'grup-baslik' }, 'Instagram takipçi'),
    h('div', { class: 'satir' },
      h('div', { class: 'dugmeler' }, araliklar.map((a, i) => h('button', { type: 'button', class: 'dugme kucuk', 'aria-pressed': String(aralikSecili(a.deger, i)),
        onclick: async () => { const y = await kaydet(k, { takipci: aralikSecili(a.deger, i) ? null : a.deger }); if (y) cizKart(y.id); } }, a.etiket))),
      h('input', { type: 'number', min: '0', step: '1', placeholder: 'tam sayı', value: k.takipci ?? '', 'aria-label': 'Takipçi sayısı', style: 'max-width:130px',
        onchange: async (e) => { const y = await kaydet(k, { takipci: e.target.value }); if (y) cizKart(y.id); } })),
    h('div', { class: 'grup-baslik' }, 'Son gönderi'),
    h('div', { class: 'satir' },
      secenekDugmeleri(k, 'sonGonderi', [['hafta', 'Son 1 hafta'], ['ay', 'Son 1 ay'], ['eski', 'Daha eski'], ['hic', 'Hiç yok']]),
      h('input', { type: 'date', value: k.sonGonderiTarihi, 'aria-label': 'Son gönderi tarihi', title: 'ya da tarih', style: 'max-width:170px', onchange: async (e) => { const y = await kaydet(k, { sonGonderiTarihi: e.target.value }); if (y) cizKart(y.id); } })),
    h('div', { class: 'grup-baslik' }, 'Kampanya / duyuru'),
    h('div', { class: 'dugmeler' }, h('button', { type: 'button', class: 'dugme kucuk', 'aria-pressed': String(k.kampanya), onclick: async () => { const y = await kaydet(k, { kampanya: !k.kampanya }); if (y) cizKart(y.id); } }, k.kampanya ? '✓ Kampanya/duyuru yapıyor' : 'Kampanya/duyuru yapıyor')),
    h('div', { class: 'grup-baslik' }, 'Menü'),
    secenekDugmeleri(k, 'menu', [['yok', 'Menü yok'], ['kagit', 'Kâğıt menü'], ['qr', 'QR menü var']]));

  const yardim = h('div', { class: 'yardim-baglanti' }, k.baglantilar.map((b) => h('a', { class: 'dugme kucuk', href: b.url }, b.etiket, ' ↗')));
  const iletisimKarti = h('section', { class: 'kart' },
    h('h3', { class: 'grup-baslik' }, 'İletişim'),
    !k.instagram ? h('div', { class: 'uyari' }, 'Instagram bilinmiyor. Aşağıdaki bağlantılarla arayın, bulduğunuz profil adresini Instagram alanına yapıştırın.', yardim) : null,
    h('div', { class: 'alanlar', style: 'margin-top:10px' },
      h('label', { class: 'alan' }, 'Instagram (adres ya da @ad)',
        h('div', { class: 'satir' },
          h('input', { value: k.instagram ? `@${k.instagram}` : '', placeholder: 'instagram.com/…', onchange: async (e) => { const y = await kaydet(k, { instagram: e.target.value }); if (y) cizKart(y.id); else e.target.value = k.instagram ? `@${k.instagram}` : ''; } }),
          k.instagram ? h('a', { class: 'dugme kucuk', href: instaUrl(k.instagram) }, 'Aç ↗') : null)),
      metinAlani(k, 'eposta', 'E-posta', { type: 'email' }),
      metinAlani(k, 'telefon', 'Telefon', { type: 'tel' }),
      metinAlani(k, 'web', 'Web sitesi', { placeholder: 'https://…' }),
      metinAlani(k, 'facebook', 'Facebook'),
      metinAlani(k, 'tiktok', 'TikTok'),
      metinAlani(k, 'x', 'X (Twitter)'),
      metinAlani(k, 'whatsapp', 'WhatsApp numarası')),
    h('div', { class: 'dugmeler', style: 'margin-top:10px' },
      k.eposta ? h('a', { class: 'dugme kucuk', href: `mailto:${k.eposta}` }, 'E-posta yaz') : null,
      k.telefon ? h('a', { class: 'dugme kucuk', href: `tel:${k.telefon.replace(/[^\d+]/g, '')}` }, 'Ara') : null,
      k.web ? h('a', { class: 'dugme kucuk', href: k.web }, 'Siteyi aç ↗') : null,
      k.facebook ? h('a', { class: 'dugme kucuk', href: /^\d+$/.test(k.facebook) ? `https://www.facebook.com/profile.php?id=${k.facebook}` : `https://www.facebook.com/${encodeURIComponent(k.facebook)}` }, 'Facebook ↗') : null,
      k.tiktok ? h('a', { class: 'dugme kucuk', href: `https://www.tiktok.com/@${encodeURIComponent(k.tiktok)}` }, 'TikTok ↗') : null,
      k.whatsapp ? h('a', { class: 'dugme kucuk', href: `https://wa.me/${k.whatsapp}` }, 'WhatsApp ↗') : null),
    k.instagram ? h('details', { style: 'margin-top:10px' }, h('summary', { class: 'kucuk-yazi' }, 'Arama bağlantıları'), yardim) : null,
    k.webSonuc ? h('p', { class: 'soluk kucuk-yazi', style: 'margin-top:10px' }, `Web taraması (${tarihYaz(k.webTarandi)}): ${k.webSonuc}`) : null);

  const yerKarti = h('section', { class: 'kart' },
    h('h3', { class: 'grup-baslik' }, 'İşletme ve yer'),
    h('div', { class: 'alanlar' },
      metinAlani(k, 'ad', 'Ad'),
      metinAlani(k, 'tur', 'Tür', { list: 'tur-listesi' }),
      metinAlani(k, 'ilce', 'İlçe'),
      metinAlani(k, 'mahalle', 'Mahalle'),
      metinAlani(k, 'adres', 'Adres'),
      metinAlani(k, 'googlePuan', 'Google puanı', { type: 'number', step: '0.1', min: '0', max: '5' }),
      metinAlani(k, 'googleYorum', 'Google yorum sayısı', { type: 'number', min: '0' }),
      k.fsqPuan != null ? h('div', { class: 'alan' }, 'Foursquare puanı (/10)', h('span', null, String(k.fsqPuan))) : null),
    h('datalist', { id: 'tur-listesi' }, ['Kafe', 'Restoran', 'Lokanta', 'Pastane / tatlıcı', 'Çay bahçesi', 'Nargile kafe', 'Hızlı yemek', 'Dondurmacı', 'Fırın', 'Bar / pub', 'Diğer'].map((t) => h('option', { value: t }))),
    h('div', { class: 'satir', style: 'margin-top:10px' },
      h('span', { class: 'soluk kucuk-yazi' }, 'Zincir mi?'),
      h('div', { class: 'dugmeler' }, [[null, 'Otomatik'], [true, 'Zincir'], [false, 'Zincir değil']].map(([v, t]) =>
        h('button', { type: 'button', class: 'dugme kucuk', 'aria-pressed': String(k.zincirElle === v), onclick: async () => { const y = await kaydet(k, { zincirElle: v }); if (y) cizKart(y.id); } }, t)))),
    h('p', { class: 'soluk kucuk-yazi', style: 'margin-top:12px' },
      k.lat != null ? `Konum: ${k.lat.toFixed(5)}, ${k.lon.toFixed(5)} · ` : '',
      k.osmId ? h('a', { href: `https://www.openstreetmap.org/${k.osmId}` }, `OSM ${k.osmId}`) : null, k.osmId ? ' · ' : '',
      k.fsqId ? h('a', { href: `https://foursquare.com/v/${encodeURIComponent(k.fsqId)}` }, 'Foursquare') : null, k.fsqId ? ' · ' : '',
      `Eklendi ${tarihYaz(k.olusturma)} · Değişti ${tarihYaz(k.guncelleme)}`),
    h('div', { class: 'dugmeler yazdirma-yok' }, h('button', { type: 'button', class: 'dugme kucuk dugme-tehlike', onclick: async () => {
      if (!confirm(`"${k.ad}" kaydı ve notları bu bilgisayardan silinsin mi? (İşletme isterse bilgilerini silmek gerekir.)`)) return;
      try { await api('DELETE', `/api/isletmeler/${k.id}`); durum.isletmeler = durum.isletmeler.filter((x) => x.id !== k.id); bildir('Silindi'); location.hash = '#/liste'; } catch (e) { bildir(e.message, true); }
    } }, 'Kaydı sil')));

  ana.replaceChildren(ust, h('div', { class: 'izgara' }, h('div', null, durumKarti, yatirimKarti), h('div', null, iletisimKarti, yerKarti)));
}

// ---------- Bugün ----------

function bugunListesi() {
  return durum.isletmeler.filter((k) => k.sonrakiTakip && k.sonrakiTakip <= durum.bugun && k.durum !== 'musteri' && k.durum !== 'ilgilenmiyor')
    .sort((a, b) => a.sonrakiTakip.localeCompare(b.sonrakiTakip) || b.oncelik - a.oncelik);
}

function cizBugun() {
  const l = bugunListesi();
  const gecikme = (g) => { const [y, a, d] = g.split('-').map(Number); const [by, ba, bd] = durum.bugun.split('-').map(Number); return Math.round((Date.UTC(by, ba - 1, bd) - Date.UTC(y, a - 1, d)) / 86_400_000); };
  document.getElementById('ana').replaceChildren(
    h('h1', null, 'Bugün takip edilecekler'),
    h('p', { class: 'soluk' }, `${gunYaz(durum.bugun)} · takip tarihi bugün ya da geçmiş olanlar (müşteri ve ilgilenmeyenler hariç).`),
    !l.length ? h('div', { class: 'kart bos' }, 'Bugün için takip yok. Kartlarda "Sonraki takip" tarihi koyunca burada görünür.')
      : h('div', { class: 'kart' }, l.map((k) => {
        const g = gecikme(k.sonrakiTakip), son = k.notlar[k.notlar.length - 1];
        return h('div', { class: 'ziyaret-satir' },
          h('span', { class: puanSinifi(k.oncelik) }, k.oncelik),
          h('div', null,
            h('a', { href: `#/isletme/${k.id}` }, h('b', null, k.ad)), ' ', h('span', { class: `cip d-${k.durum}` }, durumAdi(k.durum)),
            h('div', { class: 'kucuk-yazi' }, h('span', { class: g > 0 ? 'gecikti' : 'soluk' }, g > 0 ? `${g} gün gecikti` : 'Bugün'),
              k.instagram ? ' · ' : '', k.instagram ? h('a', { href: instaUrl(k.instagram) }, `@${k.instagram}`) : null,
              k.telefon ? ` · ${k.telefonYerel}` : ''),
            son ? h('div', { class: 'soluk kucuk-yazi' }, `Son not: ${son.metin.slice(0, 120)}`) : null),
          h('div', { class: 'dugmeler' },
            h('button', { type: 'button', class: 'dugme kucuk', onclick: async () => { if (await kaydet(k, { sonrakiTakip: gunEkle(3) }, '3 gün ertelendi')) { await yukle(); cizBugun(); } } }, '+3 gün'),
            h('a', { class: 'dugme kucuk dugme-ana', href: `#/isletme/${k.id}` }, 'Aç')));
      })));
}

// ---------- Ziyaret listesi ----------

let ziyaretEsigi = null;
function cizZiyaret() {
  const esik = ziyaretEsigi ?? durum.bilgi?.ziyaretEsigi ?? 30;
  const l = durum.isletmeler.filter((k) => k.oncelik >= esik && takipEdilmedi(k) && !k.zincir);
  const gruplar = new Map();
  for (const k of l) {
    const anahtar = `${k.ilce || 'İlçe bilinmiyor'}|${k.mahalle || ''}`;
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, []);
    gruplar.get(anahtar).push(k);
  }
  const sirali = [...gruplar.entries()].sort(([a, la], [b, lb]) => {
    const [ia, ma] = a.split('|'), [ib, mb] = b.split('|');
    return ia.localeCompare(ib, 'tr') || (!ma) - (!mb) || lb.length - la.length || ma.localeCompare(mb, 'tr');
  });
  document.getElementById('ana').replaceChildren(
    h('div', { class: 'ozet-satiri' },
      h('h1', null, 'Ziyaret listesi'),
      h('div', { class: 'dugmeler yazdirma-yok' },
        h('label', { class: 'onay' }, 'En az puan', h('input', { type: 'number', min: '0', max: '100', value: esik, style: 'width:80px', onchange: (e) => { ziyaretEsigi = Number(e.target.value) || 0; cizZiyaret(); } })),
        h('button', { type: 'button', class: 'dugme kucuk', onclick: () => window.print() }, 'Yazdır'))),
    h('p', { class: 'soluk' }, `Öncelik ${esik} ve üstü, henüz yazılmamış (Bulundu / Takip edildi), zincir olmayan ${l.length} işletme; yürüyerek gezmek için mahalleye göre.`),
    !l.length ? h('div', { class: 'kart bos' }, 'Bu eşikte işletme yok. Eşiği düşürün ya da kartlarda takipçi / son gönderi / menü bilgisini işaretleyin.')
      : h('div', null, sirali.map(([anahtar, grup]) => {
        const [ilce, mahalle] = anahtar.split('|');
        return h('section', { class: 'kart mahalle-grup' },
          h('h2', null, mahalle || 'Mahallesi bilinmiyor', h('span', { class: 'soluk kucuk-yazi' }, `${ilce} · ${grup.length} işletme`)),
          grup.sort((a, b) => b.oncelik - a.oncelik).map((k) => h('div', { class: 'ziyaret-satir' },
            h('span', { class: puanSinifi(k.oncelik) }, k.oncelik),
            h('div', null,
              h('a', { href: `#/isletme/${k.id}` }, h('b', null, k.ad)), h('span', { class: 'soluk' }, k.tur ? ` · ${k.tur}` : ''),
              h('div', { class: 'kucuk-yazi soluk' }, [k.adres, k.telefonYerel, k.instagram ? `@${k.instagram}` : '', k.googlePuan ? `Google ${k.googlePuan} (${k.googleYorum ?? 0})` : '', k.fsqPuan != null ? `Foursquare ${k.fsqPuan}/10` : ''].filter(Boolean).join(' · '))),
            h('div', { class: 'dugmeler yazdirma-yok' },
              h('a', { class: 'dugme kucuk', href: k.baglantilar.find((b) => b.etiket === 'Google Haritalar')?.url }, 'Harita ↗'),
              h('button', { type: 'button', class: 'dugme kucuk', onclick: async () => { if (await kaydet(k, { durum: 'ziyaret' }, 'Ziyaret edildi olarak işaretlendi')) cizZiyaret(); } }, 'Gittim')))));
      })));
}

// ---------- Topla ----------

let isZamani = null;
function cizTopla() {
  const b = durum.bilgi;
  const s = b.sayilar;
  const kapsamSec = h('select', { 'aria-label': 'Kapsam' }, h('option', { value: 'merkez', selected: b.kapsam === 'merkez' }, 'Yalnızca Merkez ilçe'), h('option', { value: 'il', selected: b.kapsam === 'il' }, 'Tüm Elazığ ili (11 ilçe)'));
  const yenile = h('input', { type: 'checkbox' });
  const googleOnay = h('input', { type: 'checkbox' });
  const fsqOnay = h('input', { type: 'checkbox' });
  const f = b.foursquare;
  const sinir = h('input', { type: 'number', min: '1', max: '500', value: Math.min(30, Math.max(1, b.taranacakSite)), style: 'width:90px' });
  const basla = async (yol, govde) => {
    try { await api('POST', yol, govde); isIzle(); } catch (e) { bildir(e.message, true); }
  };
  const sayi = (n, t) => h('div', { class: 'sayi' }, h('b', null, n), h('span', null, t));
  document.getElementById('ana').replaceChildren(
    h('h1', null, 'Topla'),
    h('p', { class: 'soluk' }, 'Yalnızca herkese açık işletme bilgileri toplanır. Instagram ve Facebook taranmaz; mesajı her zaman siz elle atarsınız.'),
    h('div', { class: 'kart' },
      h('h3', { class: 'grup-baslik' }, 'Şu an listede'),
      h('div', { class: 'sayilar' }, sayi(s.toplam, 'işletme'), sayi(s.instagram, 'Instagram var'), sayi(s.eposta, 'e-posta var'), sayi(s.web, 'web sitesi var'), sayi(s.telefon, 'telefon var'), sayi(s.zincir, 'zincir')),
      h('p', { class: 'soluk kucuk-yazi', style: 'margin:10px 0 0' }, `Veri dosyası: ${b.veriDosyasi}`)),
    h('div', { class: 'kart', id: 'is-kutusu', hidden: true }),
    h('div', { class: 'izgara', style: 'margin-top:14px' },
      h('section', { class: 'kart' },
        h('h2', null, 'OpenStreetMap'),
        h('p', null, 'Ücretsiz. Elazığ\'daki kafe, restoran, hızlı yemek, pastane/tatlıcı, fırın, dondurmacı ve barları getirir: ad, adres, mahalle, telefon, web, e-posta ve kayıtlıysa Instagram/Facebook.'),
        h('p', { class: 'soluk kucuk-yazi' }, 'Tek sorgu; sonuç 24 saat saklanır. OSM\'de her işletme yoktur, Google kaynağı eksikleri tamamlar.'),
        h('div', { class: 'satir' }, kapsamSec, h('label', { class: 'onay' }, yenile, 'Yeniden sor (önbelleği kullanma)')),
        h('div', { class: 'dugmeler', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'dugme dugme-ana', onclick: () => basla('/api/topla/osm', { kapsam: kapsamSec.value, yenile: yenile.checked }) }, 'OpenStreetMap\'ten getir'))),
      h('section', { class: 'kart' },
        h('h2', null, 'Google Haritalar'),
        b.google.var ? [
          h('p', null, `Ayarlardaki ${b.google.aramalar.length} arama ("${b.google.aramalar.slice(0, 3).join('", "')}"…) yapılır; puan, yorum sayısı, telefon, web sitesi ve harita bağlantısı gelir.`),
          h('div', { class: 'uyari' }, `En fazla ${b.google.istekTahmini} istek (arama başına 3 sayfa). Google aylık ücretsiz kullanımın üstünde ücret alabilir; güncel fiyatı Google Cloud'da kontrol edin.`),
          h('div', { class: 'satir', style: 'margin-top:10px' }, kapsamSec.cloneNode(true), h('label', { class: 'onay' }, googleOnay, 'Okudum, çalıştır')),
          h('div', { class: 'dugmeler', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'dugme dugme-ana', onclick: (e) => {
            if (!googleOnay.checked) { bildir('Önce "Okudum, çalıştır" kutusunu işaretleyin.', true); return; }
            basla('/api/topla/google', { onay: true, kapsam: e.target.closest('section').querySelector('select').value });
          } }, 'Google\'dan getir'))]
          : [h('p', null, 'Kapalı: Google anahtarı yok.'),
            h('p', { class: 'soluk kucuk-yazi' }, 'Açmak için Google Cloud Console\'da Places API (New) için bir API anahtarı alın ve pazarlama/ayarlar.json dosyasına "googleApiAnahtari" olarak yazın (BENIOKU.md\'de adım adım).'),
            h('button', { type: 'button', class: 'dugme', disabled: true }, 'Google\'dan getir (anahtar gerekir)')]),
      h('section', { class: 'kart' },
        h('h2', null, 'Foursquare'),
        f.var ? [
          h('p', null, 'Elazığ\'daki kafe, restoran, fırın, tatlıcı, bar ve kahvaltı yerlerini getirir: adres, telefon, web, e-posta ve kayıtlıysa Instagram/Facebook/X.'),
          h('div', { class: 'uyari' },
            `En fazla ${f.istekTahmini} istek (çalıştırma başına ${f.istekSiniri}). Bu ay ${f.buAy} istek yapıldı; aylık sınıra (${f.aylikSinir}) ${f.kalan} istek kaldı. `,
            f.premium ? 'Premium alanlar (puan, saatler) AÇIK: Premium\'un ücretsiz kotası yok, her istek ücretlidir. ' : 'Yalnızca ücretsiz Pro alanlar istenir. ',
            'Güncel kotayı ve fiyatı Foursquare\'in fiyat sayfasında kontrol edin.'),
          h('div', { class: 'satir', style: 'margin-top:10px' }, kapsamSec.cloneNode(true), h('label', { class: 'onay' }, fsqOnay, 'Okudum, çalıştır')),
          h('div', { class: 'dugmeler', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'dugme dugme-ana', disabled: f.kalan <= 0, onclick: (e) => {
            if (!fsqOnay.checked) { bildir('Önce "Okudum, çalıştır" kutusunu işaretleyin.', true); return; }
            basla('/api/topla/foursquare', { onay: true, kapsam: e.target.closest('section').querySelector('select').value });
          } }, f.kalan > 0 ? 'Foursquare\'den getir' : 'Bu ayın sınırı doldu'))]
          : [h('p', null, 'Kapalı: Foursquare anahtarı yok.'),
            h('p', { class: 'soluk kucuk-yazi' }, 'Açmak için foursquare.com/developers adresinde bir proje açıp Service API Key alın ve pazarlama/ayarlar.json dosyasına "foursquare": { "anahtar": "…" } olarak yazın (BENIOKU.md\'de adım adım).'),
            h('p', { class: 'soluk kucuk-yazi' }, `Bu ay sayılan istek: ${f.buAy} / ${f.aylikSinir}.`),
            h('button', { type: 'button', class: 'dugme', disabled: true }, 'Foursquare\'den getir (anahtar gerekir)')]),
      h('section', { class: 'kart' },
        h('h2', null, 'Web sitelerinden bul'),
        h('p', null, 'Kendi web sitesi olan işletmelerin yalnızca ana sayfasına (gerekirse İletişim sayfasına) bakar; e-posta ve Instagram/Facebook/TikTok/WhatsApp bağlantılarını alır.'),
        h('p', { class: 'soluk kucuk-yazi' }, `Saniyede en fazla 1 istek, robots.txt'e uyulur. Henüz bakılmamış ${b.taranacakSite} site var.`),
        h('div', { class: 'satir' }, h('label', { class: 'onay' }, 'En fazla', sinir, 'site')),
        h('div', { class: 'dugmeler', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'dugme dugme-ana', disabled: !b.taranacakSite, onclick: () => basla('/api/topla/web', { sinir: Number(sinir.value) }) }, 'Web sitelerinden e-posta/Instagram bul')))));
  if (b.is) isCiz(b.is);
  if (b.is && !b.is.bitti) isIzle();
}

function isCiz(is) {
  const kutu = document.getElementById('is-kutusu');
  if (!kutu) return;
  kutu.hidden = false;
  const ad = { osm: 'OpenStreetMap', google: 'Google', foursquare: 'Foursquare', web: 'Web siteleri' }[is.tur] || is.tur;
  const o = is.ozet;
  kutu.replaceChildren(...[
    h('h3', { class: 'grup-baslik' }, `${ad}:${is.bitti ? (is.hata ? 'olmadı' : 'bitti') : 'sürüyor…'}`),
    !is.bitti ? h('div', { class: `ilerleme${is.ilerleme == null ? ' belirsiz' : ''}` }, h('div', { style: is.ilerleme != null ? `width:${Math.round(is.ilerleme * 100)}%` : null })) : null,
    is.hata ? h('div', { class: 'uyari' }, is.hata) : null,
    o ? h('div', { class: 'bilgi' }, `Yeni ${o.yeni} · güncellenen ${o.guncellenen} · değişmeyen ${o.ayni}`,
      o.bakilan != null ? ` · bakılan site ${o.bakilan}, bulunan e-posta ${o.eposta}, Instagram ${o.instagram}` : '', o.not ? h('div', { class: 'kucuk-yazi' }, o.not) : null) : null,
    is.mesajlar.length ? h('div', { class: 'kayit', style: 'margin-top:8px' }, is.mesajlar.slice(-12).join('\n')) : null].filter(Boolean));
}

function isIzle() {
  clearTimeout(isZamani);
  const tur = async () => {
    try {
      const { is } = await api('GET', '/api/is');
      if (!is) return;
      if (location.hash === '#/topla') isCiz(is);
      if (!is.bitti) { isZamani = setTimeout(tur, 1000); return; }
      await yukle();
      if (location.hash === '#/topla') { cizTopla(); }
      bildir(is.hata ? 'Toplama olmadı' : 'Toplama bitti', !!is.hata);
    } catch (e) { bildir(e.message, true); }
  };
  tur();
}

// ---------- Yeni işletme ----------

function cizYeni() {
  const ad = h('input', { required: true, placeholder: 'ör. Harput Kahve Evi' });
  const tur = h('input', { list: 'tur-listesi2', placeholder: 'Kafe' });
  const mahalle = h('input', { placeholder: 'ör. Cumhuriyet' });
  const instagram = h('input', { placeholder: 'instagram.com/… ya da @ad' });
  const form = h('form', { class: 'kart', style: 'max-width:640px', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const k = await api('POST', '/api/isletmeler', { ad: ad.value, tur: tur.value, mahalle: mahalle.value, ilce: 'Merkez', instagram: instagram.value });
      kaydiGuncelle(k); bildir('Eklendi'); location.hash = `#/isletme/${k.id}`;
    } catch (err) { bildir(err.message, true); }
  } },
  h('h1', null, 'İşletme ekle'),
  h('p', { class: 'soluk' }, 'Elle bulduğunuz bir işletme. Diğer bilgileri kartında doldurursunuz.'),
  h('div', { class: 'alanlar' },
    h('label', { class: 'alan' }, 'Ad', ad), h('label', { class: 'alan' }, 'Tür', tur),
    h('label', { class: 'alan' }, 'Mahalle', mahalle), h('label', { class: 'alan' }, 'Instagram', instagram)),
  h('datalist', { id: 'tur-listesi2' }, ['Kafe', 'Restoran', 'Lokanta', 'Pastane / tatlıcı', 'Çay bahçesi', 'Nargile kafe', 'Hızlı yemek', 'Dondurmacı', 'Fırın'].map((t) => h('option', { value: t }))),
  h('div', { class: 'dugmeler', style: 'margin-top:12px' }, h('button', { type: 'submit', class: 'dugme dugme-ana' }, 'Ekle'), h('a', { class: 'dugme', href: '#/liste' }, 'Vazgeç')));
  document.getElementById('ana').replaceChildren(form);
  ad.focus();
}

// ---------- Yönlendirme ----------

async function git() {
  const yol = location.hash || '#/liste';
  const sekme = yol.split('/')[1] || 'liste';
  for (const a of document.querySelectorAll('.sekmeler a')) { if (a.dataset.sekme === sekme) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  try {
    if (!durum.bilgi || sekme === 'topla' || sekme === 'bugun' || sekme === 'liste' || sekme === 'ziyaret') await yukle();
    if (sekme === 'isletme') cizKart(yol.split('/')[2]);
    else if (sekme === 'bugun') cizBugun();
    else if (sekme === 'ziyaret') cizZiyaret();
    else if (sekme === 'topla') cizTopla();
    else if (sekme === 'yeni') cizYeni();
    else cizListe();
  } catch (e) {
    document.getElementById('ana').replaceChildren(h('div', { class: 'kart uyari' }, `Sunucuya ulaşılamadı: ${e.message}. Komut penceresinde "npm run pazarlama" açık mı?`));
  }
  if (sekme !== 'liste') window.scrollTo(0, 0);
}

window.addEventListener('hashchange', git);
git();

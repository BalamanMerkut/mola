import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Depo, ayarlariOku, yeniId } from './depo.js';
import type { Ayarlar, Isletme } from './tipler.js';
import { birlestir, sosyalBul, zincirMi } from './yardimci.js';
import { osmGetir } from './kaynaklar/osm.js';
import { googleGetir } from './kaynaklar/google.js';
import { AylikSayac, foursquareGetir, istekTahmini as fsqTahmin } from './kaynaklar/foursquare.js';
import { siteTara } from './kaynaklar/web.js';

/* Toplama işleri: arayüzdeki düğmeler ve komut satırı (npx tsx pazarlama/topla.ts osm|google|foursquare|web|ozet) aynı işleri çağırır. */

export type Haber = (s: string, ilerleme?: number) => void;
export type Ozet = { yeni: number; guncellenen: number; ayni: number; not?: string };

export async function osmTopla(depo: Depo, kapsam: 'merkez' | 'il', yenile: boolean, haber: Haber): Promise<Ozet> {
  const s = await osmGetir(kapsam, yenile, haber);
  haber(`${s.adaylar.length} işletme geldi (${s.ilceSayisi} ilçe). Listeyle birleştiriliyor…`, 0.9);
  const ozet = birlestir(depo.isletmeler, s.adaylar, yeniId);
  depo.kaydet();
  return { ...ozet, not: s.onbellekten ? 'Önbellekteki son sonuç kullanıldı (24 saat). Tazelemek için "Yeniden sor" seçin.' : undefined };
}

export async function googleTopla(depo: Depo, ayarlar: Ayarlar, kapsam: 'merkez' | 'il', haber: Haber): Promise<Ozet> {
  if (!ayarlar.googleApiAnahtari) throw new Error('Google anahtarı yok (pazarlama/ayarlar.json).');
  const s = await googleGetir(ayarlar.googleApiAnahtari, ayarlar.googleAramalari, kapsam, (m) => haber(m));
  const ozet = birlestir(depo.isletmeler, s.adaylar, yeniId);
  depo.kaydet();
  return { ...ozet, not: `${s.istek} Google isteği yapıldı.` };
}

export async function foursquareTopla(depo: Depo, ayarlar: Ayarlar, kapsam: 'merkez' | 'il', haber: Haber, sayac = new AylikSayac()): Promise<Ozet> {
  const s = await foursquareGetir(ayarlar.foursquare, kapsam, (m) => haber(m), { sayac });
  haber(`${s.adaylar.length} işletme geldi. Listeyle birleştiriliyor…`, 0.9);
  const ozet = birlestir(depo.isletmeler, s.adaylar, yeniId);
  depo.kaydet();
  return { ...ozet, not: `${s.istek} Foursquare isteği yapıldı. Bu ay kalan: ${s.kalan} / ${ayarlar.foursquare.aylikSinir}.` };
}

export function taranacakSiteler(depo: Depo): Isletme[] {
  return depo.isletmeler.filter((k) => k.web && !sosyalBul(k.web) && !k.webTarandi);
}

export async function webTopla(depo: Depo, sinir: number, haber: Haber): Promise<Ozet & { bakilan: number; eposta: number; instagram: number }> {
  const liste = taranacakSiteler(depo).slice(0, Math.max(1, sinir));
  const ozet = { yeni: 0, guncellenen: 0, ayni: 0, bakilan: 0, eposta: 0, instagram: 0 };
  for (const [i, k] of liste.entries()) {
    haber(`${i + 1}/${liste.length}: ${k.ad}`, i / liste.length);
    const s = await siteTara(k.web);
    ozet.bakilan++;
    let degisti = false;
    const yaz = (alan: 'eposta' | 'instagram' | 'facebook' | 'tiktok' | 'x' | 'whatsapp', deger: string | undefined) => {
      if (!deger || k[alan] || k.elleDegisen.includes(alan)) return false;
      k[alan] = deger; degisti = true; return true;
    };
    if (yaz('eposta', s.epostalar[0])) ozet.eposta++;
    for (const so of s.sosyal) if (yaz(so.tur, so.kimlik) && so.tur === 'instagram') ozet.instagram++;
    k.webTarandi = new Date().toISOString();
    k.webSonuc = s.sonuc;
    if (degisti) { if (!k.kaynaklar.includes('web')) k.kaynaklar.push('web'); k.guncelleme = k.webTarandi; ozet.guncellenen++; } else ozet.ayni++;
    if (i % 5 === 4) depo.kaydet();
  }
  depo.kaydet();
  return ozet;
}

/** Sayılar (kişisel veri değil): kaç işletme, kaçında Instagram/e-posta/web/telefon var. */
export function sayilar(depo: Depo, ayarlar: Ayarlar) {
  const l = depo.isletmeler;
  const say = (f: (k: Isletme) => boolean) => l.filter(f).length;
  const turler: Record<string, number> = {};
  for (const k of l) turler[k.tur || 'Diğer'] = (turler[k.tur || 'Diğer'] ?? 0) + 1;
  return {
    toplam: l.length, zincir: say((k) => zincirMi(k, ayarlar.zincirler)), instagram: say((k) => !!k.instagram), eposta: say((k) => !!k.eposta),
    web: say((k) => !!k.web && !sosyalBul(k.web)), telefon: say((k) => !!k.telefon), facebook: say((k) => !!k.facebook), mahalle: say((k) => !!k.mahalle), turler,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [is = 'ozet', ...arg] = process.argv.slice(2);
  const depo = new Depo();
  const ayarlar = ayarlariOku();
  const haber: Haber = (m) => console.log(`  ${m}`);
  const kapsam = arg.includes('--il') ? 'il' : ayarlar.kapsam;
  const sinirArg = arg.find((a) => /^\d+$/.test(a));
  try {
    if (is === 'osm') console.log(await osmTopla(depo, kapsam, arg.includes('--yenile'), haber));
    else if (is === 'web') console.log(await webTopla(depo, Number(sinirArg ?? 20), haber));
    else if (is === 'google') console.log(await googleTopla(depo, ayarlar, kapsam, haber));
    else if (is === 'foursquare') {
      const f = ayarlar.foursquare;
      console.log(`  Foursquare: en fazla ${fsqTahmin(f)} istek (bu ay kalan ${new AylikSayac().kalan(f.aylikSinir)} / ${f.aylikSinir}).`);
      if (f.premiumAlanlar && !arg.includes('--onay')) throw new Error('Premium alanlar açık: her istek ücretlidir. Okuduysanız komutu --onay ile yeniden çalıştırın.');
      console.log(await foursquareTopla(depo, ayarlar, kapsam, haber));
    }
    console.log(sayilar(depo, ayarlar));
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
}

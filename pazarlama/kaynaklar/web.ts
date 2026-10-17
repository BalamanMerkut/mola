import { htmlTara, iletisimSayfasi, robotsIzinli, type Sosyal } from '../yardimci.js';
import { KULLANICI_AJANI } from './osm.js';

/*
 * İşletmenin kendi web sitesi (sosyal ağ adresi değil): yalnızca ana sayfa ve en fazla bir "İletişim" sayfası. Kibar:
 * robots.txt'e uyulur, saniyede en fazla 1 istek, 10 sn zaman aşımı, sayfa başına en fazla 600 KB okunur.
 */

const SINIR = 600_000;
const ARALIK_MS = 1000;
let sonIstek = 0;

async function sira() {
  const bekle = sonIstek + ARALIK_MS - Date.now();
  if (bekle > 0) await new Promise((r) => setTimeout(r, bekle));
  sonIstek = Date.now();
}

/** Yerel ağ ve bu bilgisayar adreslerine hiç gidilmez. */
export function disAdresMi(u: URL): boolean {
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') || h.includes(':')) return false;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224 || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  return true;
}

async function getir(url: string, html: boolean): Promise<{ durum: number; metin: string; son: string } | null> {
  await sira();
  try {
    const y = await fetch(url, { headers: { 'User-Agent': KULLANICI_AJANI, Accept: html ? 'text/html,application/xhtml+xml' : 'text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    const son = y.url || url;
    if (!disAdresMi(new URL(son))) { await y.body?.cancel(); return null; }
    if (html && !/html|xml/i.test(y.headers.get('content-type') ?? 'text/html')) { await y.body?.cancel(); return { durum: y.status, metin: '', son }; }
    const okuyucu = y.body?.getReader();
    let metin = '', boyut = 0;
    const cozucu = new TextDecoder('utf-8');
    if (okuyucu) {
      for (;;) {
        const { done, value } = await okuyucu.read();
        if (done) break;
        boyut += value.byteLength; metin += cozucu.decode(value, { stream: true });
        if (boyut >= SINIR) { await okuyucu.cancel(); break; }
      }
    }
    return { durum: y.status, metin, son };
  } catch { return null; }
}

const robotsOnbellek = new Map<string, string>();
async function izinli(url: URL): Promise<boolean> {
  let robots = robotsOnbellek.get(url.origin);
  if (robots === undefined) {
    const r = await getir(`${url.origin}/robots.txt`, false);
    robots = r && r.durum === 200 ? r.metin : '';
    robotsOnbellek.set(url.origin, robots);
  }
  return robotsIzinli(robots, url.pathname + url.search);
}

export type SiteSonucu = { epostalar: string[]; sosyal: Sosyal[]; sonuc: string };

export async function siteTara(adres: string): Promise<SiteSonucu> {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(adres) ? adres : `http://${adres}`); } catch { return { epostalar: [], sosyal: [], sonuc: 'Adres geçersiz' }; }
  if (!disAdresMi(url)) return { epostalar: [], sosyal: [], sonuc: 'Adres taranmaz' };
  const ana = new URL('/', url);
  if (!await izinli(ana)) return { epostalar: [], sosyal: [], sonuc: 'robots.txt izin vermiyor' };
  const sayfa = await getir(ana.href, true);
  if (!sayfa) return { epostalar: [], sosyal: [], sonuc: 'Siteye ulaşılamadı' };
  if (sayfa.durum >= 400) return { epostalar: [], sosyal: [], sonuc: `Site hata verdi (${sayfa.durum})` };
  const bulunan = htmlTara(sayfa.metin);
  const epostalar = [...bulunan.epostalar], sosyal = [...bulunan.sosyal];
  let iletisimBakildi = false;
  if (!epostalar.length || !sosyal.some((s) => s.tur === 'instagram')) {
    const iletisim = iletisimSayfasi(bulunan.baglantilar, sayfa.son);
    if (iletisim && iletisim !== sayfa.son) {
      const iu = new URL(iletisim);
      if (disAdresMi(iu) && await izinli(iu)) {
        const s2 = await getir(iletisim, true);
        iletisimBakildi = true;
        if (s2 && s2.durum < 400) {
          const b2 = htmlTara(s2.metin);
          for (const e of b2.epostalar) if (!epostalar.includes(e)) epostalar.push(e);
          for (const s of b2.sosyal) if (!sosyal.some((x) => x.tur === s.tur && x.kimlik === s.kimlik)) sosyal.push(s);
        }
      }
    }
  }
  const parcalar = [epostalar.length ? `${epostalar.length} e-posta` : '', sosyal.length ? sosyal.map((s) => s.tur).join(', ') : ''].filter(Boolean);
  return { epostalar, sosyal, sonuc: (parcalar.join(' · ') || 'Bir şey bulunamadı') + (iletisimBakildi ? ' (iletişim sayfasına da bakıldı)' : '') };
}

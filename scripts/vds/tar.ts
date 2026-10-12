/*
 * A small streaming tar reader (ustar, GNU long names, pax "path"/"size") for "npm run vds:cek": the server's read-only helper
 * sends the requested files as one tar stream over SSH (GNU tar --format=pax); each file goes straight to a temporary file
 * here, nothing is held whole in memory. File names are UTF-8 (Turkish letters, spaces). Only regular files are given to the
 * receiver; folders, links and anything else are skipped. Also a writer (for tests and the local rehearsal source).
 */
export type TarGirdi = { ad: string; boyut: number };
export type TarAlici = (g: TarGirdi) => Promise<{ yaz(parca: Buffer): void | Promise<void>; bitir(): Promise<void>; iptal(): Promise<void> } | null>;
export class TarHatasi extends Error {}

const BLOK = 512, OZEL_SINIR = 1 << 20;
const alan = (h: Buffer, a: number, b: number) => { const p = h.subarray(a, b), z = p.indexOf(0); return (z < 0 ? p : p.subarray(0, z)).toString('utf8'); };
function sayi(h: Buffer, a: number, b: number) {
  if (h[a] & 0x80) { let n = 0; for (let i = a + 1; i < b; i++) n = n * 256 + h[i]; return n; } // base-256 (very large files)
  const s = alan(h, a, b).trim();
  return s ? parseInt(s, 8) : 0;
}
function baslikDogru(h: Buffer) {
  let toplam = 0;
  for (let i = 0; i < BLOK; i++) toplam += i >= 148 && i < 156 ? 32 : h[i];
  return toplam === sayi(h, 148, 156);
}
/** pax records "<len> <key>=<value>\n" (values may hold any byte, even a line break). */
export function paxCoz(veri: Buffer) {
  const sonuc = new Map<string, string>();
  let i = 0;
  while (i < veri.length) {
    const bosluk = veri.indexOf(0x20, i); if (bosluk < 0) break;
    const uzunluk = parseInt(veri.subarray(i, bosluk).toString('ascii'), 10);
    if (!Number.isFinite(uzunluk) || uzunluk <= 0 || i + uzunluk > veri.length) throw new TarHatasi('pax kaydı bozuk');
    const kayit = veri.subarray(bosluk + 1, i + uzunluk - 1), esit = kayit.indexOf(0x3d);
    if (esit > 0) sonuc.set(kayit.subarray(0, esit).toString('utf8'), kayit.subarray(esit + 1).toString('utf8'));
    i += uzunluk;
  }
  return sonuc;
}

/**
 * Reads a tar stream. Returns how many regular files were given and whether the stream ended cleanly (a cut stream leaves
 * the file being written cancelled: `iptal`). A damaged header throws TarHatasi (the files given so far are finished).
 */
export async function tarOku(akis: AsyncIterable<Buffer | string>, alici: TarAlici) {
  let bekleyen: Buffer = Buffer.alloc(0), durum: 'baslik' | 'veri' | 'dolgu' = 'baslik';
  let kalan = 0, dolgu = 0, dosyalar = 0, son = false;
  let hedef: Awaited<ReturnType<TarAlici>> = null, ozel: { tur: string; parcalar: Buffer[]; boyut: number } | null = null;
  let uzunAd: string | undefined, pax = new Map<string, string>();
  const girdiBitti = async () => {
    if (ozel) {
      const veri = Buffer.concat(ozel.parcalar);
      if (ozel.tur === 'L') uzunAd = alan(veri, 0, veri.length);
      else if (ozel.tur === 'x') pax = paxCoz(veri);
      ozel = null;
    } else if (hedef) { const h = hedef; hedef = null; await h.bitir(); dosyalar++; }
    durum = dolgu ? 'dolgu' : 'baslik';
  };
  for await (const p of akis) {
    // After the end blocks the rest (tar's record padding) is read and dropped: the sender must not see a closed pipe.
    if (son) continue;
    const parca = typeof p === 'string' ? Buffer.from(p) : p;
    bekleyen = bekleyen.length ? Buffer.concat([bekleyen, parca]) : parca;
    let i = 0;
    while (!son) {
      if (durum === 'baslik') {
        if (bekleyen.length - i < BLOK) break;
        const h = bekleyen.subarray(i, i + BLOK); i += BLOK;
        if (h.every(b => b === 0)) { son = true; break; }
        if (!baslikDogru(h)) throw new TarHatasi('tar başlığı bozuk');
        const tur = String.fromCharCode(h[156] || 48), onEk = h.subarray(257, 262).toString('latin1') === 'ustar' ? alan(h, 345, 500) : '';
        let ad = alan(h, 0, 100); if (onEk) ad = `${onEk}/${ad}`;
        const boyut = tur === 'x' || tur === 'g' || tur === 'L' || tur === 'K' ? sayi(h, 124, 136) : Number(pax.get('size') ?? sayi(h, 124, 136));
        kalan = boyut; dolgu = (BLOK - (boyut % BLOK)) % BLOK;
        if (tur === 'L' || tur === 'x' || tur === 'g' || tur === 'K') {
          if (boyut > OZEL_SINIR) throw new TarHatasi('tar özel kaydı çok büyük');
          ozel = { tur, parcalar: [], boyut };
        } else {
          if (uzunAd !== undefined) ad = uzunAd;
          if (pax.has('path')) ad = pax.get('path')!;
          uzunAd = undefined; pax = new Map();
          hedef = tur === '0' || tur === '7' ? await alici({ ad, boyut }) : null;
        }
        durum = 'veri';
        if (kalan === 0) await girdiBitti();
      } else if (durum === 'veri') {
        const n = Math.min(kalan, bekleyen.length - i);
        if (n === 0) break;
        const veri = bekleyen.subarray(i, i + n); i += n; kalan -= n;
        if (ozel) ozel.parcalar.push(veri); else if (hedef) await hedef.yaz(veri);
        if (kalan === 0) await girdiBitti();
      } else {
        const n = Math.min(dolgu, bekleyen.length - i);
        if (n === 0) break;
        i += n; dolgu -= n;
        if (dolgu === 0) durum = 'baslik';
      }
    }
    bekleyen = bekleyen.subarray(i);
  }
  const temiz = son || (durum === 'baslik' && bekleyen.length === 0);
  if (hedef) { const h = hedef as NonNullable<typeof hedef>; hedef = null; await h.iptal(); }
  return { dosyalar, temiz };
}

/** A pax tar of the given files in memory (tests, the local rehearsal source). Non-ASCII or long names get a pax "path". */
export function tarYaz(girdiler: { ad: string; veri: Buffer; zaman?: number }[]) {
  const bloklar: Buffer[] = [];
  const baslik = (ad: string, boyut: number, tur: string, zaman: number) => {
    const h = Buffer.alloc(BLOK);
    h.write(ad, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(boyut.toString(8).padStart(11, '0') + '\0', 124); h.write(Math.floor(zaman).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); h.write(tur, 156); h.write('ustar\0', 257); h.write('00', 263);
    let t = 0; for (const b of h) t += b;
    h.write(t.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const ekle = (veri: Buffer) => { bloklar.push(veri); if (veri.length % BLOK) bloklar.push(Buffer.alloc(BLOK - (veri.length % BLOK))); };
  for (const g of girdiler) {
    const zaman = g.zaman ?? Date.now() / 1000;
    if (/[^\x20-\x7e]/.test(g.ad) || Buffer.byteLength(g.ad) > 99) {
      const kayit = (k: string, v: string) => { const govde = ` ${k}=${v}\n`; let n = Buffer.byteLength(govde) + 1; while (String(n).length + Buffer.byteLength(govde) !== n) n++; return `${n}${govde}`; };
      const pax = Buffer.from(kayit('path', g.ad), 'utf8');
      bloklar.push(baslik('PaxHeader/dosya', pax.length, 'x', zaman)); ekle(pax);
      bloklar.push(baslik('dosya', g.veri.length, '0', zaman));
    } else bloklar.push(baslik(g.ad, g.veri.length, '0', zaman));
    ekle(g.veri);
  }
  bloklar.push(Buffer.alloc(BLOK * 2));
  return Buffer.concat(bloklar);
}

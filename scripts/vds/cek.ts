import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { writeAtomic } from '../../server/merkez/workfolder.js';
import { IKINCI_KLASOR } from './ayar.js';
import { BaglantiHatasi, type Islem, type Ssh } from './ssh.js';
import { OKU, okuHatasi } from './komutlar.js';
import { tarOku, TarHatasi } from './tar.js';

/*
 * "npm run vds:cek": the VDS's Mola çalışma klasörü and newest Merkez backups → this PC (and the backups only → Google Drive).
 *   <hedef>\calisma\        mirror of the server's work folder (files gone there go here too; support tickets are personal
 *                           data: skipped when <hedef> is cloud-synced)
 *   <hedef>\merkez-yedek\   newest N Merkez backups (encrypted) + merkez-yedek-durum.json
 *   <ikinci>\Mola-Merkez-VDS\  the same backups only (never the work folder: KVKK, nothing personal goes to Drive)
 * Read-only on the server: one listing (sizes, times, SHA-256 of small files), hashes of the big files to fetch, one tar
 * stream of exactly the new/changed files. Each file is checked (size + SHA-256) before it replaces anything; a new backup
 * folder appears whole or not at all (<ad>.kopyalaniyor, then a rename). Deleting happens only inside these folders.
 */
export const MERKEZ_YEDEK_ADI = /^merkez-yedek-\d{4}-\d{2}-\d{2}T[\w-]+$/; // as server/merkez/backup.ts NAME
export const YEDEK_DURUM = 'merkez-yedek-durum.json';
export const CALISMA_ALT = 'calisma', YEDEK_ALT = 'merkez-yedek';
const GECICI = /\.(kopyalaniyor|yaziliyor)$|\.eski-[0-9a-f]{8}$/;

export type Kok = 'calisma' | 'yedek';
export type UzakDosya = { kok: Kok; yol: string; boyut: number; zaman: number; ozet: string | null };
export type Liste = { calismaKok: string | null; yedekKok: string | null; dosyalar: UzakDosya[]; bozuk: number };
/** Where files come from: the VDS over SSH (KaynakSsh), or anything that answers the same three questions (tests). */
export interface Kaynak {
  liste(): Promise<Liste>;
  ozetler(adlar: string[]): Promise<Map<string, string>>;
  /** A tar stream of the named files ("calisma/…", "yedek/…"); entry names are the full server paths without the leading "/". */
  paket(adlar: string[]): Islem;
}
export const adi = (d: Pick<UzakDosya, 'kok' | 'yol'>) => `${d.kok}/${d.yol}`;

// ---------- The helper's answers ----------
/** "MOLA-LISTE\t1\t<calisma>\t<yedek>\0" then "<kök>\t<boyut>\t<zaman>\t<sha|->\t<yol>\0" per file. */
export function listeCoz(veri: Buffer): Liste {
  const kayitlar = veri.toString('utf8').split('\0');
  if (kayitlar.at(-1) === '') kayitlar.pop();
  const bas = (kayitlar.shift() ?? '').split('\t');
  if (bas[0] !== 'MOLA-LISTE' || bas[1] !== '1') throw new Error('Sunucudaki mola-oku tanınmayan bir liste verdi (paketi bu sürümle yeniden kurun).');
  const kok = (s?: string) => s && s !== '-' ? s : null;
  const dosyalar: UzakDosya[] = []; let bozuk = 0;
  for (const k of kayitlar) {
    const p = k.split('\t'), yol = p.slice(4).join('\t');
    const [ad, boyut, zaman, ozet] = p;
    if ((ad !== 'calisma' && ad !== 'yedek') || !/^\d+$/.test(boyut ?? '') || !/^\d+$/.test(zaman ?? '') || !(ozet === '-' || /^[0-9a-f]{64}$/.test(ozet ?? '')) || !yol) { bozuk++; continue; }
    dosyalar.push({ kok: ad, yol, boyut: Number(boyut), zaman: Number(zaman), ozet: ozet === '-' ? null : ozet });
  }
  return { calismaKok: kok(bas[2]), yedekKok: kok(bas[3]), dosyalar, bozuk };
}
/** "<sha>\t<ad>\0" per file. */
export function ozetlerCoz(veri: Buffer) {
  const sonuc = new Map<string, string>();
  for (const k of veri.toString('utf8').split('\0')) { const t = k.indexOf('\t'); if (t === 64 && /^[0-9a-f]{64}$/.test(k.slice(0, 64))) sonuc.set(k.slice(65), k.slice(0, 64)); }
  return sonuc;
}
const adlarGirdisi = (adlar: string[]) => Buffer.from(adlar.map(a => `${a}\0`).join(''), 'utf8');

/** The VDS: the read-only helper through sudo -n -u mola (komutlar.ts OKU), nothing else. */
export class KaynakSsh implements Kaynak {
  constructor(private ssh: Ssh) {}
  async liste() {
    const r = await this.ssh.calistirTopla(`${OKU} liste`);
    if (!r.cikti.subarray(0, 10).equals(Buffer.from('MOLA-LISTE'))) throw new BaglantiHatasi(okuHatasi(r.hata));
    return listeCoz(r.cikti);
  }
  async ozetler(adlar: string[]) {
    const r = await this.ssh.calistirTopla(`${OKU} ozet`, adlarGirdisi(adlar));
    if (r.kod !== 0) throw new BaglantiHatasi(okuHatasi(r.hata));
    return ozetlerCoz(r.cikti);
  }
  paket(adlar: string[]) { return this.ssh.baslat(`${OKU} paket`, adlarGirdisi(adlar)); }
}

// ---------- Local side ----------
const YASAK = /[<>:"|?*\\\x00-\x1f]/, AYGIT = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
/** A server file name that is safe as a Windows path under our folder: no "..", no drive, no reserved names. */
export function yolGecerli(yol: string) {
  return !!yol && yol.length <= 400 && yol.split('/').every(p => !!p && p !== '.' && p !== '..' && !YASAK.test(p) && !AYGIT.test(p) && !/[. ]$/.test(p) && Buffer.byteLength(p) <= 255);
}
const icinde = (yol: string, kok: string) => { const a = resolve(yol).toLowerCase(), b = resolve(kok).toLowerCase(); return a.startsWith(b.endsWith(sep) ? b : b + sep); };
function yerel(kok: string, yol: string) {
  const tam = join(kok, ...yol.split('/'));
  if (!icinde(tam, kok)) throw new Error(`Klasör dışına yol: ${yol}`);
  return tam;
}
export async function dosyaOzeti(yol: string) {
  const h = createHash('sha256');
  for await (const p of createReadStream(yol)) h.update(p as Buffer);
  return h.digest('hex');
}
async function yeniden<T>(is: () => Promise<T>) {
  for (let i = 0; ; i++) {
    try { return await is(); } catch (e) { if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    await new Promise(r => setTimeout(r, 150 * (i + 1)));
  }
}
/** Files below a folder as "a/b.md" → full path (no links followed). */
async function dosyalar(kok: string, alt = ''): Promise<Map<string, string>> {
  const sonuc = new Map<string, string>();
  let girdiler; try { girdiler = await fs.readdir(join(kok, alt), { withFileTypes: true }); } catch { return sonuc; }
  for (const g of girdiler) {
    const yol = alt ? `${alt}/${g.name}` : g.name;
    if (g.isDirectory()) for (const [k, v] of await dosyalar(kok, yol)) sonuc.set(k, v);
    else if (g.isFile()) sonuc.set(yol, join(kok, ...yol.split('/')));
  }
  return sonuc;
}
async function bosKlasorleriSil(kok: string, alt = ''): Promise<boolean> {
  let girdiler; try { girdiler = await fs.readdir(join(kok, alt), { withFileTypes: true }); } catch { return false; }
  let bos = true;
  for (const g of girdiler) {
    if (g.isDirectory() && await bosKlasorleriSil(kok, alt ? `${alt}/${g.name}` : g.name)) continue;
    bos = false;
  }
  if (bos && alt) await fs.rmdir(join(kok, alt)).catch(() => {});
  return bos;
}
/** Unchanged: same size, and the same SHA-256 when the server gave one (else the same time, set by us when it was copied). */
async function ayni(d: UzakDosya, tam: string) {
  let st; try { st = await fs.stat(tam); } catch { return false; }
  if (!st.isFile() || st.size !== d.boyut) return false;
  if (Math.abs(Math.floor(st.mtimeMs / 1000) - d.zaman) <= 1) return true;
  if (!d.ozet || (await dosyaOzeti(tam)) !== d.ozet) return false;
  await fs.utimes(tam, d.zaman, d.zaman).catch(() => {});
  return true;
}
const yedekTamam = async (klasor: string) => existsSync(join(klasor, 'complete.json')) && !existsSync(join(klasor, 'YEDEK_SURUYOR.txt'));
/** Backup folders (Merkez's names only) in a folder, newest first. */
async function yedekKlasorleri(klasor: string) {
  try { return (await fs.readdir(klasor, { withFileTypes: true })).filter(e => e.isDirectory() && MERKEZ_YEDEK_ADI.test(e.name)).map(e => e.name).sort().reverse(); } catch { return []; }
}
/** Leftovers of a cut run (only our own temporary names) in one folder. */
async function artiklariSil(klasor: string) {
  for (const e of await fs.readdir(klasor, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && (GECICI.test(e.name) || /^\.gelen-[0-9a-f]{8}$/.test(e.name))) await fs.rm(join(klasor, e.name), { recursive: true, force: true }).catch(() => {});
}

export type CekSecenek = {
  hedef: string; ikinci: string | null; yedekSayisi: number;
  /** <hedef> is cloud-synced: support tickets (personal data) are not copied (and earlier copies there go). */
  bulut?: boolean;
  /** The folders .local/vds.json expects on the server (a different answer is only a warning). */
  beklenen?: { calisma: string; yedek: string };
  simdi?: () => Date;
};
export type CekSonuc = {
  yeni: number; bayt: number; silinen: number; calismaDosya: number;
  yedekler: string[]; sonYedek: { ad: string; zaman: string | null } | null;
  ikinci: { klasor: string; kopyalanan: number; silinen: number } | null;
  atlanan: { ad: string; neden: string }[]; uyarilar: string[]; hatalar: string[];
};

/** One run. Never writes on the server; throws only when the server cannot be read at all (BaglantiHatasi). */
export async function cek(kaynak: Kaynak, o: CekSecenek): Promise<CekSonuc> {
  const simdi = o.simdi ?? (() => new Date());
  const calismaKlasor = join(o.hedef, CALISMA_ALT), yedekKlasor = join(o.hedef, YEDEK_ALT);
  const s: CekSonuc = { yeni: 0, bayt: 0, silinen: 0, calismaDosya: 0, yedekler: [], sonYedek: null, ikinci: null, atlanan: [], uyarilar: [], hatalar: [] };
  await fs.mkdir(calismaKlasor, { recursive: true }); await fs.mkdir(yedekKlasor, { recursive: true });
  await artiklariSil(o.hedef); await artiklariSil(yedekKlasor);

  const liste = await kaynak.liste();
  if (liste.bozuk) s.uyarilar.push(`Sunucunun listesinde okunamayan ${liste.bozuk} satır atlandı.`);
  if (o.beklenen && liste.calismaKok && liste.calismaKok !== o.beklenen.calisma) s.uyarilar.push(`Sunucudaki çalışma klasörü ${liste.calismaKok} (ayarda ${o.beklenen.calisma}).`);
  if (o.beklenen && liste.yedekKok && liste.yedekKok !== o.beklenen.yedek) s.uyarilar.push(`Sunucudaki yedek klasörü ${liste.yedekKok} (ayarda ${o.beklenen.yedek}).`);

  // What the server has.
  const calisma = new Map<string, UzakDosya>(), yedekGrup = new Map<string, UzakDosya[]>();
  let durumDosyasi: UzakDosya | undefined, destekAtlandi = false;
  for (const d of liste.dosyalar) {
    if (!yolGecerli(d.yol)) { s.atlanan.push({ ad: adi(d), neden: 'bu bilgisayarda geçersiz dosya adı' }); continue; }
    if (d.kok === 'calisma') {
      if (/\.(yaziliyor|mola-guncelleme)$/i.test(d.yol)) continue;
      if (o.bulut && d.yol.startsWith('destek-talepleri/')) { destekAtlandi = true; continue; }
      calisma.set(d.yol, d);
    } else {
      const p = d.yol.split('/');
      if (p.length === 1 && p[0] === YEDEK_DURUM) durumDosyasi = d;
      else if (p.length === 2 && MERKEZ_YEDEK_ADI.test(p[0]) && /^[\w.-]+$/.test(p[1])) (yedekGrup.get(p[0]) ?? yedekGrup.set(p[0], []).get(p[0])!).push(d);
    }
  }
  if (destekAtlandi) s.uyarilar.push('Hedef klasör bir bulut klasöründe: destek talepleri (kişisel veri) kopyalanmadı.');
  const tamamlar = [...yedekGrup].filter(([, f]) => f.some(x => x.yol.endsWith('/complete.json')) && !f.some(x => x.yol.endsWith('/YEDEK_SURUYOR.txt'))).map(([ad]) => ad).sort().reverse();
  const secilen = tamamlar.slice(0, o.yedekSayisi);
  if (!liste.yedekKok) s.uyarilar.push('Sunucuda Merkez yedek klasörü yok.');
  else if (!tamamlar.length) s.uyarilar.push('Sunucuda tamamlanmış Merkez yedeği yok.');

  // What is new or changed.
  const yerelYol = (d: UzakDosya) => d.kok === 'calisma' ? yerel(calismaKlasor, d.yol) : yerel(yedekKlasor, d.yol);
  const indir: UzakDosya[] = [];
  const aday = [...calisma.values(), ...(durumDosyasi ? [durumDosyasi] : []), ...secilen.flatMap(ad => yedekGrup.get(ad)!)];
  for (const d of aday) if (!(await ayni(d, yerelYol(d)))) indir.push(d);
  s.calismaDosya = calisma.size;

  // Hashes of the big files, then one tar stream.
  const eksik = indir.filter(d => !d.ozet);
  if (eksik.length) {
    const ozet = await kaynak.ozetler(eksik.map(adi));
    for (const d of eksik) d.ozet = ozet.get(adi(d)) ?? null;
  }
  const istenen = indir.filter(d => { if (d.ozet) return true; s.atlanan.push({ ad: adi(d), neden: 'sunucuda artık yok' }); return false; });
  const gelen = join(o.hedef, `.gelen-${randomBytes(4).toString('hex')}`);
  const alinan = new Map<UzakDosya, { gecici: string; ozet: string; boyut: number }>();
  try {
    if (istenen.length) {
      await fs.mkdir(gelen, { recursive: true });
      const tarAdi = (d: UzakDosya) => `${(d.kok === 'calisma' ? liste.calismaKok : liste.yedekKok)!.replace(/^\/+/, '')}/${d.yol}`;
      const beklenen = new Map(istenen.map(d => [tarAdi(d), d]));
      const islem = kaynak.paket(istenen.map(adi));
      let n = 0, temiz = false;
      try {
        ({ temiz } = await tarOku(islem.cikti, async g => {
          const d = beklenen.get(g.ad);
          if (!d || alinan.has(d)) return null;
          const gecici = join(gelen, `${n++}.dat`), yaz = createWriteStream(gecici), h = createHash('sha256');
          yaz.on('error', () => { /* (disk full…) finished()/once() below reject with it */ });
          let boyut = 0;
          return {
            yaz: async p => { h.update(p); boyut += p.length; if (!yaz.write(p)) await once(yaz, 'drain'); },
            bitir: async () => { yaz.end(); await finished(yaz); alinan.set(d, { gecici, ozet: h.digest('hex'), boyut }); },
            iptal: async () => { yaz.destroy(); await fs.rm(gecici, { force: true }); },
          };
        }));
      } catch (e) {
        islem.cikti.destroy();
        s.hatalar.push(e instanceof TarHatasi ? `Aktarım bozuk geldi (${e.message}); alınabilenler kaydedildi.` : `Aktarım kesildi: ${(e as Error).message}`);
      }
      const { kod, hata } = await islem.bitti;
      if (kod === 255 || kod === -1) s.hatalar.push(`Aktarım sırasında bağlantı koptu: ${hata.trim().split(/\r?\n/).at(-1) ?? ''}`);
      else if (!temiz && !s.hatalar.length) s.hatalar.push('Aktarım yarım kaldı; alınabilenler kaydedildi, kalanlar bir sonraki çalıştırmada.');
    }

    // Check each file, then put it in place.
    const dogru = new Set<UzakDosya>();
    for (const d of istenen) {
      const r = alinan.get(d);
      if (!r) { s.atlanan.push({ ad: adi(d), neden: 'alınamadı' }); continue; }
      if (r.boyut !== d.boyut || r.ozet !== d.ozet) {
        // A work folder file Merkez rewrote in between is normal (next run); a backup file must never differ.
        if (d.kok === 'yedek') s.hatalar.push(`Yedek dosyası doğrulanamadı: ${d.yol} (boyut/SHA-256 farklı); yerine konmadı.`);
        else s.atlanan.push({ ad: adi(d), neden: 'aktarımda değişti, doğrulanamadı (bir sonraki çalıştırmada alınır)' });
        await fs.rm(r.gecici, { force: true });
        continue;
      }
      await fs.utimes(r.gecici, d.zaman, d.zaman);
      dogru.add(d);
    }
    const yerine = async (d: UzakDosya, hedefYol: string) => {
      const r = alinan.get(d)!;
      await fs.mkdir(resolve(hedefYol, '..'), { recursive: true });
      await yeniden(() => fs.rename(r.gecici, hedefYol));
      s.yeni++; s.bayt += d.boyut;
    };
    for (const d of [...calisma.values(), ...(durumDosyasi ? [durumDosyasi] : [])]) if (dogru.has(d)) await yerine(d, yerelYol(d));
    for (const ad of secilen) {
      const dosyaListesi = yedekGrup.get(ad)!, klasor = join(yedekKlasor, ad), gelecek = dosyaListesi.filter(d => indir.includes(d));
      if (!gelecek.length) continue;
      if (existsSync(klasor)) { for (const d of gelecek) if (dogru.has(d)) await yerine(d, yerelYol(d)); continue; }
      if (!gelecek.every(d => dogru.has(d))) { s.hatalar.push(`Yedek ${ad} tam alınamadı; bu bilgisayara konmadı (bir sonraki çalıştırmada yeniden denenir).`); continue; }
      const gecici = `${klasor}.kopyalaniyor`;
      await fs.rm(gecici, { recursive: true, force: true }); await fs.mkdir(gecici, { recursive: true });
      const once0 = { yeni: s.yeni, bayt: s.bayt };
      for (const d of gelecek) await yerine(d, join(gecici, d.yol.split('/')[1]));
      try { await yeniden(() => fs.rename(gecici, klasor)); }
      catch (e) { Object.assign(s, once0); s.hatalar.push(`Yedek ${ad} yerine konamadı: ${(e as Error).message}`); }
    }
  } finally { await fs.rm(gelen, { recursive: true, force: true }).catch(() => {}); }

  // Files gone from the server's work folder go here too (deleted tickets, expired attachments), never on an empty listing.
  if (!calisma.size) s.uyarilar.push(`Sunucuda çalışma klasörü boş ya da yok (${liste.calismaKok ?? 'MERKEZ_CALISMA_KLASORU ayarlı değil'}); bu bilgisayardaki kopyaya dokunulmadı.`);
  else {
    for (const [yol, tam] of await dosyalar(calismaKlasor)) if (!calisma.has(yol) && icinde(tam, calismaKlasor)) { await yeniden(() => fs.rm(tam, { force: true })); s.silinen++; }
    await bosKlasorleriSil(calismaKlasor);
  }

  // Only the newest N backups stay here (only Merkez's backup folder names, only in our own folder).
  const yereldekiler = await yedekKlasorleri(yedekKlasor);
  for (const ad of yereldekiler.slice(o.yedekSayisi)) await fs.rm(join(yedekKlasor, ad), { recursive: true, force: true });
  s.yedekler = yereldekiler.slice(0, o.yedekSayisi);
  for (const ad of s.yedekler) {
    if (!(await yedekTamam(join(yedekKlasor, ad)))) continue;
    let zaman: string | null = null;
    try { const c = JSON.parse(await fs.readFile(join(yedekKlasor, ad, 'complete.json'), 'utf8')) as { createdAt?: string }; zaman = c.createdAt && Number.isFinite(Date.parse(c.createdAt)) ? c.createdAt : null; } catch { /* the name says enough */ }
    s.sonYedek = { ad, zaman }; break;
  }
  if (!s.sonYedek) s.uyarilar.push('Bu bilgisayarda hiç Merkez yedeği yok.');
  else if (s.sonYedek.zaman && simdi().getTime() - Date.parse(s.sonYedek.zaman) > 36 * 3600_000) s.uyarilar.push(`Son Merkez yedeği eski: ${tarihYaz(s.sonYedek.zaman)}. Mola Yönetim → Ayarlar → Yedek'e bakın.`);

  if (o.ikinci) await ikinciyeKopyala(o.ikinci, yedekKlasor, s.yedekler, o.yedekSayisi, s, join(o.hedef, 'ikinci-kopyalar.json'));
  await writeAtomic(join(o.hedef, 'BENIOKU.txt'), BENIOKU(o.yedekSayisi));
  await writeAtomic(join(o.hedef, 'vds-cek-durum.json'), JSON.stringify({ format: 1, at: simdi().toISOString(), yeni: s.yeni, bayt: s.bayt, silinen: s.silinen, sonYedek: s.sonYedek, yedekler: s.yedekler, ikinci: s.ikinci, atlanan: s.atlanan.length, uyarilar: s.uyarilar, hatalar: s.hatalar }, null, 2) + '\n');
  return s;
}

/**
 * The second place (Google Drive): only the encrypted backup folders, each file checked after copying; old ones go only there.
 * What was copied is remembered here (<hedef>\ikinci-kopyalar.json: names, sizes, times of the local copy), so Drive's files
 * are never read back (a streamed Drive would download them) and an unchanged backup is not copied again.
 */
async function ikinciyeKopyala(kok: string, kaynakKlasor: string, adlar: string[], sayi: number, s: CekSonuc, kayitDosyasi: string) {
  if (!existsSync(kok)) { s.hatalar.push(`İkinci yer bulunamadı: ${kok} (Google Drive açık mı?). Yedekler yalnız bu bilgisayarda.`); return; }
  const klasor = join(kok, IKINCI_KLASOR);
  s.ikinci = { klasor, kopyalanan: 0, silinen: 0 };
  let kayit: Record<string, string> = {};
  try { kayit = JSON.parse(await fs.readFile(kayitDosyasi, 'utf8')); } catch { /* first copy */ }
  const imza = async (k: string) => (await Promise.all((await fs.readdir(k, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort().map(async f => { const st = await fs.stat(join(k, f)); return `${f}:${st.size}:${Math.floor(st.mtimeMs / 1000)}`; }))).join('|');
  try {
    await fs.mkdir(klasor, { recursive: true }); await artiklariSil(klasor);
    for (const ad of adlar) {
      const kaynak = join(kaynakKlasor, ad), hedef = join(klasor, ad);
      if (!(await yedekTamam(kaynak))) continue;
      const dosyaAdlari = (await fs.readdir(kaynak, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name);
      const simdikiImza = await imza(kaynak);
      if (existsSync(hedef) && kayit[ad] === simdikiImza) continue;
      const gecici = `${hedef}.kopyalaniyor`;
      await fs.rm(gecici, { recursive: true, force: true }); await fs.mkdir(gecici, { recursive: true });
      for (const f of dosyaAdlari) {
        await fs.copyFile(join(kaynak, f), join(gecici, f));
        if ((await dosyaOzeti(join(kaynak, f))) !== (await dosyaOzeti(join(gecici, f)))) throw new Error(`kopya doğrulanamadı: ${ad}/${f}`);
        const st = await fs.stat(join(kaynak, f)); await fs.utimes(join(gecici, f), st.atime, st.mtime);
      }
      const eski = `${hedef}.eski-${randomBytes(4).toString('hex')}`;
      if (existsSync(hedef)) await yeniden(() => fs.rename(hedef, eski));
      await yeniden(() => fs.rename(gecici, hedef));
      await fs.rm(eski, { recursive: true, force: true });
      kayit[ad] = simdikiImza;
      s.ikinci.kopyalanan++;
    }
    for (const ad of (await yedekKlasorleri(klasor)).slice(sayi)) { await fs.rm(join(klasor, ad), { recursive: true, force: true }); s.ikinci.silinen++; }
  } catch (e) {
    s.hatalar.push(`İkinci yere (Google Drive) kopyalanamadı: ${(e as Error).message}`);
  } finally {
    await writeAtomic(kayitDosyasi, JSON.stringify(Object.fromEntries(Object.entries(kayit).filter(([ad]) => adlar.includes(ad))), null, 2) + '\n').catch(() => {});
  }
}

export const BENIOKU = (n: number) => '﻿' + [
  'Mola: VDS\'teki Mola Merkez\'in bu bilgisayardaki kopyası. "npm run vds:cek" doldurur; dosyaları elle değiştirmeyin.',
  '',
  '  calisma\\              Sunucudaki Mola çalışma klasörü (içindeki README.md her dosyayı anlatır).',
  '                        destek-talepleri\\ KİŞİSEL VERİ içerir: paylaşmayın, bulut klasörüne kopyalamayın.',
  `  merkez-yedek\\         En yeni ${n} Merkez yedeği (şifreli; açmak için Merkez kurtarma kodu gerekir).`,
  '  vds-cek-durum.json    Son çalıştırmanın özeti.',
  '',
  'Geri yükleme provası (ayda bir): npm.cmd run merkez:restore -- "<bu klasör>\\merkez-yedek\\<en yeni>" .local\\prova',
  'Sunucuda hiçbir şey yazılmaz ya da silinmez. Eski yedekler yalnız bu klasörde (ve Google Drive\'daki Mola-Merkez-VDS',
  'klasöründe) silinir. Ayrıntı: docs/VDS_KURULUM.md bölüm 15.',
  '',
].join('\r\n');

/** "12 Ekim 03:30" in Türkiye. */
export function tarihYaz(iso: string) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export const mbYaz = (bayt: number) => (bayt / 1048576).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** "12 yeni dosya · son Merkez yedeği 12 Ekim 03:30 · 2,1 MB" (+ the second place). */
export function ozetSatiri(s: CekSonuc) {
  const yedek = s.sonYedek ? `son Merkez yedeği ${s.sonYedek.zaman ? tarihYaz(s.sonYedek.zaman) : s.sonYedek.ad}` : 'Merkez yedeği yok';
  const ikinci = s.ikinci ? ` · Google Drive'a ${s.ikinci.kopyalanan} yedek` : '';
  return `${s.yeni} yeni dosya · ${yedek} · ${mbYaz(s.bayt)} MB${ikinci}`;
}

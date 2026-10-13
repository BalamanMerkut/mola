import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Kaynak, Liste, UzakDosya } from '../scripts/vds/cek.js';
import { hazirIslem } from '../scripts/vds/ssh.js';
import { tarYaz } from '../scripts/vds/tar.js';

/*
 * A pretend VDS for "npm run vds:cek" tests: two local folders play /var/lib/mola-merkez/calisma and …/merkez-yedek, and
 * YerelKaynak answers like the server's read-only helper (scripts/linux/mola-oku): the same listing, hashes and tar stream.
 * Scratch folders only (system temp, with a space and Turkish letters in the path); never C:\MolaCalisma or .local.
 */
export const gecici = (ad: string) => mkdtempSync(join(tmpdir(), `mola vds-çek ${ad}-`));
export const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export function yaz(kok: string, yol: string, veri: Buffer | string, zaman?: number) {
  const tam = join(kok, ...yol.split('/'));
  mkdirSync(dirname(tam), { recursive: true }); writeFileSync(tam, veri);
  if (zaman) utimesSync(tam, zaman, zaman);
  return tam;
}
export function agac(kok: string, alt = ''): string[] {
  let girdiler: string[]; try { girdiler = readdirSync(join(kok, alt)); } catch { return []; }
  return girdiler.flatMap(f => { const y = alt ? `${alt}/${f}` : f; return statSync(join(kok, y)).isDirectory() ? agac(kok, y) : [y]; }).sort();
}
export const UZAK_CALISMA = '/var/lib/mola-merkez/calisma', UZAK_YEDEK = '/var/lib/mola-merkez/merkez-yedek', UZAK_KAFE = '/var/lib/mola-merkez/veri-sunucu-yedekleri';

export class YerelKaynak implements Kaynak {
  /** bozan: changes what the "server" sends for a name (a damaged transfer). */
  bozan?: (ad: string, veri: Buffer) => Buffer;
  istenenPaketler: string[][] = []; istenenOzetler: string[][] = [];
  /**
   * kafe: the folder playing <veri>-sunucu-yedekleri (null: not there). kokler.kafe undefined plays an older helper whose
   * listing has no third folder (and lists none of its files).
   */
  constructor(public calisma: string, public yedek: string, public kokler: { calisma: string | null; yedek: string | null; kafe?: string | null } = { calisma: UZAK_CALISMA, yedek: UZAK_YEDEK, kafe: UZAK_KAFE }, public kafe: string | null = null) {}
  private tam(ad: string) { const [kok, ...p] = ad.split('/'); return join(kok === 'calisma' ? this.calisma : kok === 'kafe' ? this.kafe ?? '' : this.yedek, ...p); }
  async liste(): Promise<Liste> {
    const dosyalar: UzakDosya[] = [];
    const kokler = [['calisma', this.calisma, 6], ['yedek', this.yedek, 2], ...(this.kafe && this.kokler.kafe !== undefined ? [['kafe', this.kafe, 3] as const] : [])] as const;
    for (const [kok, klasor, derinlik] of kokler) {
      for (const yol of agac(klasor)) {
        if (yol.split('/').length > derinlik || (kok === 'kafe' && yol.split('/').includes('yukleme'))) continue;
        const st = statSync(join(klasor, ...yol.split('/')));
        dosyalar.push({ kok, yol, boyut: st.size, zaman: Math.floor(st.mtimeMs / 1000), ozet: st.size <= 1048576 ? sha(readFileSync(join(klasor, ...yol.split('/')))) : null });
      }
    }
    return { calismaKok: this.kokler.calisma, yedekKok: this.kokler.yedek, ...(this.kokler.kafe !== undefined ? { kafeKok: this.kokler.kafe } : {}), dosyalar, bozuk: 0 };
  }
  async ozetler(adlar: string[]) {
    this.istenenOzetler.push(adlar);
    const m = new Map<string, string>();
    for (const ad of adlar) { try { m.set(ad, sha(readFileSync(this.tam(ad)))); } catch { /* gone */ } }
    return m;
  }
  paket(adlar: string[]) {
    this.istenenPaketler.push(adlar);
    const girdiler: { ad: string; veri: Buffer }[] = [];
    for (const ad of adlar) {
      if (ad.startsWith('kafe/') && ad.split('/').includes('yukleme')) continue; // as the helper's coz()
      let veri: Buffer; try { veri = readFileSync(this.tam(ad)); } catch { continue; }
      const [kok, ...p] = ad.split('/');
      girdiler.push({ ad: `${(kok === 'calisma' ? this.kokler.calisma : kok === 'kafe' ? this.kokler.kafe : this.kokler.yedek)!.slice(1)}/${p.join('/')}`, veri: this.bozan ? this.bozan(ad, veri) : veri });
    }
    return hazirIslem(tarYaz(girdiler));
  }
}

/** A Merkez backup folder as server/merkez/backup.ts writes it (contents are random: encrypted anyway). */
export function yedekYaz(yedek: string, ad: string, createdAt: string, o: { buyuk?: boolean; yarim?: boolean } = {}) {
  const k = join(yedek, ad);
  yaz(k, '0.bin', randomBytes(o.buyuk ? 1_200_000 : 4000));
  yaz(k, '1.bin', randomBytes(300));
  yaz(k, 'manifest.bin', randomBytes(200));
  yaz(k, 'anahtar-kurtarma.json', JSON.stringify({ v: 1, wrapped: randomBytes(16).toString('hex') }));
  if (o.yarim) yaz(k, 'YEDEK_SURUYOR.txt', 'Yedek henüz tamamlanmadı.');
  else { yaz(k, 'complete.json', JSON.stringify({ format: 1, kind: 'merkez', createdAt, files: 2 })); yaz(k, 'verification.json', JSON.stringify({ verified: true })); }
  return k;
}
/**
 * One café's "Sunucu yedeği" as server/merkez/backup-vault.ts keeps it under <veri>-sunucu-yedekleri: blobs named by their
 * SHA-256, a copy naming them, durum.json, and an upload in progress (yukleme/, never copied). Returns the blob names.
 */
export const kurulumAdi = (n: number) => `${String(n).padStart(8, '0')}-1111-4222-8333-444455556666`;
export function kafeYaz(kafe: string, kurulum: string, o: { buyuk?: boolean; kopya?: string } = {}) {
  yaz(kafe, 'BENIOKU.txt', 'MOLA MERKEZ: SUNUCU YEDEKLERİ\r\n');
  const parcalar = [randomBytes(o.buyuk ? 1_200_000 : 3000), randomBytes(500)].map(veri => { const h = sha(veri); yaz(kafe, `${kurulum}/parcalar/${h}`, veri); return h; });
  const kopya = o.kopya ?? 'backup-2026-10-12T00-30-00';
  yaz(kafe, `${kurulum}/kopyalar/${kopya}.json`, JSON.stringify({ id: kopya, installId: kurulum, files: parcalar.map((h, i) => ({ name: `${i}.bin`, sha256: h })) }));
  yaz(kafe, `${kurulum}/durum.json`, JSON.stringify({ lastUploadAt: '2026-10-12T00:31:00.000Z', lastCopyId: kopya }));
  const yukleme = randomBytes(16).toString('hex');
  yaz(kafe, `${kurulum}/yukleme/${yukleme}.json`, JSON.stringify({ id: yukleme }));
  yaz(kafe, `${kurulum}/yukleme/${yukleme}/${'a'.repeat(64)}.part`, 'yarım yükleme');
  return parcalar;
}
export const yedekAdi = (gun: number, saat = '00-30') => `merkez-yedek-2026-10-${String(gun).padStart(2, '0')}T${saat}-00-000Z-${String(gun).padStart(2, '0')}abcdef`;

/** A small work folder like server/merkez/workfolder.ts writes: with a support ticket (personal data) and Turkish names. */
export const KISISEL = 'Ayşe Yılmaz · 0532 000 00 00';
export function calismaYaz(calisma: string) {
  yaz(calisma, 'README.md', '# Mola çalışma klasörü\n');
  yaz(calisma, 'durum-ozeti.md', '# Mola durum özeti\n| Çay Ocağı | Çalışıyor |\n');
  yaz(calisma, 'islem-kayitlari/2026-10-11.jsonl', '{"type":"kayit"}\n');
  yaz(calisma, 'islem-kayitlari/2026-10-12.jsonl', '{"type":"kayit"}\n{"type":"kayit"}\n');
  yaz(calisma, 'hata-kayitlari/hatalar.json', '{"format":1,"groups":[]}\n');
  yaz(calisma, 'destek-talepleri/KISISEL-VERI.txt', 'KİŞİSEL VERİ');
  yaz(calisma, 'destek-talepleri/cay-ocagi-1a2b3c4d/2026-10-12-yazıcı çalışmıyor-9f8e7d6c.md', `# Yazıcı çalışmıyor\n> ${KISISEL}\n`);
  yaz(calisma, 'destek-talepleri/cay-ocagi-1a2b3c4d/ekler/1a2b3c4d-fiş fotoğrafı.jpg', randomBytes(500));
  yaz(calisma, 'surumler/yayinlar.md', '# Güncelleme paketleri\n');
}

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
export const UZAK_CALISMA = '/var/lib/mola-merkez/calisma', UZAK_YEDEK = '/var/lib/mola-merkez/merkez-yedek';

export class YerelKaynak implements Kaynak {
  /** bozan: changes what the "server" sends for a name (a damaged transfer). */
  bozan?: (ad: string, veri: Buffer) => Buffer;
  istenenPaketler: string[][] = []; istenenOzetler: string[][] = [];
  constructor(public calisma: string, public yedek: string, public kokler = { calisma: UZAK_CALISMA as string | null, yedek: UZAK_YEDEK as string | null }) {}
  private tam(ad: string) { const [kok, ...p] = ad.split('/'); return join(kok === 'calisma' ? this.calisma : this.yedek, ...p); }
  async liste(): Promise<Liste> {
    const dosyalar: UzakDosya[] = [];
    for (const [kok, klasor, derinlik] of [['calisma', this.calisma, 6], ['yedek', this.yedek, 2]] as const) {
      for (const yol of agac(klasor)) {
        if (yol.split('/').length > derinlik) continue;
        const st = statSync(join(klasor, ...yol.split('/')));
        dosyalar.push({ kok, yol, boyut: st.size, zaman: Math.floor(st.mtimeMs / 1000), ozet: st.size <= 1048576 ? sha(readFileSync(join(klasor, ...yol.split('/')))) : null });
      }
    }
    return { calismaKok: this.kokler.calisma, yedekKok: this.kokler.yedek, dosyalar, bozuk: 0 };
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
      let veri: Buffer; try { veri = readFileSync(this.tam(ad)); } catch { continue; }
      const [kok, ...p] = ad.split('/');
      girdiler.push({ ad: `${(kok === 'calisma' ? this.kokler.calisma : this.kokler.yedek)!.slice(1)}/${p.join('/')}`, veri: this.bozan ? this.bozan(ad, veri) : veri });
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

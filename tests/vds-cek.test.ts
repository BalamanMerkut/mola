import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cek, ozetSatiri, yolGecerli } from '../scripts/vds/cek.js';
import { IKINCI_KLASOR } from '../scripts/vds/ayar.js';
import { agac, calismaYaz, gecici, KISISEL, sha, yaz, yedekAdi, yedekYaz, YerelKaynak } from './vds-fixture.js';

/*
 * "npm run vds:cek" against a pretend server (tests/vds-fixture.ts): incremental copy, hash checks, retention only inside its
 * own folders, the Google Drive split (only encrypted backups, never the work folder) and the cloud rule for support tickets.
 */
function kurulum(ad: string) {
  const kok = gecici(ad), sunucu = join(kok, 'sunucu'), calisma = join(sunucu, 'calisma'), yedek = join(sunucu, 'merkez-yedek');
  const hedef = join(kok, 'Masaüstü kopya', 'vds'), drive = join(kok, "G Drive'ım");
  mkdirSync(calisma, { recursive: true }); mkdirSync(yedek, { recursive: true }); mkdirSync(drive, { recursive: true });
  return { kok, sunucu, calisma, yedek, hedef, drive, kaynak: new YerelKaynak(calisma, yedek), temizle: () => rmSync(kok, { recursive: true, force: true }) };
}
const simdi = () => new Date('2026-10-12T05:00:00.000Z');

test('first run copies the work folder and backups (Turkish names, spaces); the second copies nothing; a change is one file', async t => {
  const k = kurulum('ilk'); t.after(k.temizle);
  calismaYaz(k.calisma);
  yedekYaz(k.yedek, yedekAdi(11), '2026-10-11T00:30:00.000Z');
  yedekYaz(k.yedek, yedekAdi(12), '2026-10-12T00:30:00.000Z', { buyuk: true });
  yaz(k.yedek, 'merkez-yedek-durum.json', JSON.stringify({ lastSuccessAt: '2026-10-12T00:30:00.000Z' }));
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(s.hatalar, []); assert.deepEqual(s.atlanan, []);
  assert.deepEqual(agac(join(k.hedef, 'calisma')), agac(k.calisma), 'the whole work folder, same names');
  assert.equal(readFileSync(join(k.hedef, 'calisma', 'destek-talepleri', 'cay-ocagi-1a2b3c4d', '2026-10-12-yazıcı çalışmıyor-9f8e7d6c.md'), 'utf8'), readFileSync(join(k.calisma, 'destek-talepleri', 'cay-ocagi-1a2b3c4d', '2026-10-12-yazıcı çalışmıyor-9f8e7d6c.md'), 'utf8'));
  for (const ad of [yedekAdi(11), yedekAdi(12)]) for (const f of agac(join(k.yedek, ad))) assert.equal(sha(readFileSync(join(k.hedef, 'merkez-yedek', ad, f))), sha(readFileSync(join(k.yedek, ad, f))), `${ad}/${f}`);
  assert.ok(existsSync(join(k.hedef, 'merkez-yedek', 'merkez-yedek-durum.json')));
  assert.ok(k.kaynak.istenenOzetler.flat().includes(`yedek/${yedekAdi(12)}/0.bin`), 'the big file (no hash in the listing) was hashed on the server');
  assert.equal(s.yeni, agac(k.calisma).length + 12 + 1);
  assert.equal(s.sonYedek?.ad, yedekAdi(12));
  assert.match(ozetSatiri(s), /^\d+ yeni dosya · son Merkez yedeği 12 Ekim 03:30 · \d+,\d MB$/);
  // Server times are kept (the next run compares them).
  assert.equal(Math.floor(statSync(join(k.hedef, 'calisma', 'README.md')).mtimeMs / 1000), Math.floor(statSync(join(k.calisma, 'README.md')).mtimeMs / 1000));
  assert.ok(existsSync(join(k.hedef, 'BENIOKU.txt')) && existsSync(join(k.hedef, 'vds-cek-durum.json')));
  assert.deepEqual(agac(k.hedef).filter(f => /\.gelen-|kopyalaniyor|\.dat$/.test(f)), [], 'no temporary files left');

  const ikinci = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(ikinci.yeni, 0); assert.equal(k.kaynak.istenenPaketler.length, 1, 'nothing new: no transfer at all');
  assert.match(ozetSatiri(ikinci), /^0 yeni dosya · son Merkez yedeği 12 Ekim 03:30 · 0,0 MB$/);

  yaz(k.calisma, 'durum-ozeti.md', '# Mola durum özeti\n| Çay Ocağı | Askıda |\n');
  const ucuncu = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(ucuncu.yeni, 1);
  assert.deepEqual(k.kaynak.istenenPaketler.at(-1), ['calisma/durum-ozeti.md']);
  assert.match(readFileSync(join(k.hedef, 'calisma', 'durum-ozeti.md'), 'utf8'), /Askıda/);
});

test('files gone from the server go here too (only inside calisma\\); an empty listing never wipes the copy', async t => {
  const k = kurulum('silme'); t.after(k.temizle);
  calismaYaz(k.calisma);
  await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  rmSync(join(k.calisma, 'destek-talepleri', 'cay-ocagi-1a2b3c4d'), { recursive: true });
  writeFileSync(join(k.hedef, 'benim notum.txt'), 'sahibin kendi dosyası');
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(s.silinen, 2);
  assert.equal(existsSync(join(k.hedef, 'calisma', 'destek-talepleri', 'cay-ocagi-1a2b3c4d')), false, 'empty folders go too');
  assert.ok(existsSync(join(k.hedef, 'benim notum.txt')), 'nothing outside calisma\\ is touched');
  // The server's work folder empty (MERKEZ_CALISMA_KLASORU missing): the local copy stays as it is.
  rmSync(k.calisma, { recursive: true }); mkdirSync(k.calisma);
  const bos = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(bos.silinen, 0);
  assert.ok(bos.uyarilar.some(u => /çalışma klasörü boş/.test(u)));
  assert.ok(existsSync(join(k.hedef, 'calisma', 'README.md')));
});

test('backups: only the newest N complete ones; local copies beyond N go, only Merkez backup folders, only in our folder', async t => {
  const k = kurulum('saklama'); t.after(k.temizle);
  for (let g = 1; g <= 16; g++) yedekYaz(k.yedek, yedekAdi(g), `2026-10-${String(g).padStart(2, '0')}T00:30:00.000Z`);
  yedekYaz(k.yedek, yedekAdi(17), '2026-10-17T00:30:00.000Z', { yarim: true });
  // Here already: an older backup (beyond N after this run), something of the owner's that looks similar, and a cut copy.
  yedekYaz(join(k.hedef, 'merkez-yedek'), 'merkez-yedek-2026-09-01T00-30-00-000Z-eskieski', '2026-09-01T00:30:00.000Z');
  mkdirSync(join(k.hedef, 'merkez-yedek', 'merkez-yedek-notlarim'), { recursive: true });
  mkdirSync(join(k.hedef, 'merkez-yedek', `${yedekAdi(16)}.kopyalaniyor`), { recursive: true });
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi: () => new Date('2026-10-16T05:00:00.000Z') });
  assert.deepEqual(s.hatalar, []);
  const yerel = agac(join(k.hedef, 'merkez-yedek')).map(f => f.split('/')[0]);
  const adlar = [...new Set(yerel)].filter(a => a.startsWith('merkez-yedek-2026')).sort();
  assert.deepEqual(adlar, Array.from({ length: 14 }, (_, i) => yedekAdi(i + 3)), 'newest 14 complete ones; the half-written 17th is not copied');
  assert.ok(existsSync(join(k.hedef, 'merkez-yedek', 'merkez-yedek-notlarim')), 'a folder that is not a Merkez backup name stays');
  assert.equal(existsSync(join(k.hedef, 'merkez-yedek', `${yedekAdi(16)}.kopyalaniyor`)), false, 'a cut copy of ours is cleaned up');
  assert.equal(s.sonYedek?.ad, yedekAdi(16));
  // Merkez deletes its oldest when a new one comes: here the 15th newest goes too.
  yedekYaz(k.yedek, yedekAdi(18), '2026-10-18T00:30:00.000Z');
  const s2 = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi: () => new Date('2026-10-18T05:00:00.000Z') });
  assert.equal(s2.yedekler.length, 14); assert.equal(s2.yedekler[0], yedekAdi(18)); assert.equal(existsSync(join(k.hedef, 'merkez-yedek', yedekAdi(3))), false);
  // The server lost its backups: the copies here stay (only the count rule removes them).
  rmSync(k.yedek, { recursive: true }); mkdirSync(k.yedek);
  const s3 = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi: () => new Date('2026-10-18T05:00:00.000Z') });
  assert.equal(s3.yedekler.length, 14);
  assert.ok(s3.uyarilar.some(u => /tamamlanmış Merkez yedeği yok/.test(u)));
});

test('a file that does not match its hash never replaces anything; a new backup appears whole or not at all', async t => {
  const k = kurulum('ozet'); t.after(k.temizle);
  calismaYaz(k.calisma); yedekYaz(k.yedek, yedekAdi(11), '2026-10-11T00:30:00.000Z');
  await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  const eski = readFileSync(join(k.hedef, 'calisma', 'durum-ozeti.md'), 'utf8');
  yaz(k.calisma, 'durum-ozeti.md', '# yeni hâli\n');
  yedekYaz(k.yedek, yedekAdi(12), '2026-10-12T00:30:00.000Z', { buyuk: true });
  k.kaynak.bozan = (ad, veri) => ad === 'calisma/durum-ozeti.md' || ad.endsWith('/0.bin') ? Buffer.concat([veri.subarray(0, veri.length - 1), Buffer.from([veri.at(-1)! ^ 1])]) : veri;
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(readFileSync(join(k.hedef, 'calisma', 'durum-ozeti.md'), 'utf8'), eski, 'the old copy stays');
  assert.ok(s.atlanan.some(a => a.ad === 'calisma/durum-ozeti.md' && /doğrulanamadı/.test(a.neden)));
  assert.ok(s.hatalar.some(h => /Yedek dosyası doğrulanamadı/.test(h)) && s.hatalar.some(h => /tam alınamadı/.test(h)));
  assert.equal(existsSync(join(k.hedef, 'merkez-yedek', yedekAdi(12))), false, 'no half backup');
  assert.deepEqual(agac(k.hedef).filter(f => /\.gelen-|kopyalaniyor|\.dat$/.test(f)), []);
  assert.equal(s.sonYedek?.ad, yedekAdi(11));
  // A cut stream: the next run takes what is missing.
  k.kaynak.bozan = undefined;
  const iyi = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(iyi.hatalar, []); assert.equal(iyi.sonYedek?.ad, yedekAdi(12));
  assert.equal(readFileSync(join(k.hedef, 'calisma', 'durum-ozeti.md'), 'utf8'), '# yeni hâli\n');
});

test('Google Drive gets only the encrypted backups, never the work folder or a support ticket (KVKK); its own retention', async t => {
  const k = kurulum('drive'); t.after(k.temizle);
  calismaYaz(k.calisma);
  for (let g = 1; g <= 4; g++) yedekYaz(k.yedek, yedekAdi(g), `2026-10-0${g}T00:30:00.000Z`);
  writeFileSync(join(k.drive, 'tatil fotoğrafları.txt'), 'sahibin kendi dosyası');
  yedekYaz(join(k.drive, IKINCI_KLASOR), 'merkez-yedek-2026-09-01T00-30-00-000Z-eskieski', '2026-09-01T00:30:00.000Z');
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: k.drive, yedekSayisi: 3, simdi: () => new Date('2026-10-04T05:00:00.000Z') });
  assert.deepEqual(s.hatalar, []);
  assert.equal(s.ikinci?.kopyalanan, 3);
  const driveDosyalari = agac(k.drive);
  for (const f of driveDosyalari) assert.ok(f === 'tatil fotoğrafları.txt' || new RegExp(`^${IKINCI_KLASOR}/merkez-yedek-2026-10-0[234]T[^/]+/[\\w.-]+$`).test(f), `only backups in Drive: ${f}`);
  for (const f of driveDosyalari) assert.equal(readFileSync(join(k.drive, f)).includes(Buffer.from(KISISEL)), false, `no personal data in Drive: ${f}`);
  assert.ok(!driveDosyalari.some(f => /destek|calisma|durum-ozeti|islem-kayitlari|README/.test(f)));
  for (const f of agac(join(k.drive, IKINCI_KLASOR))) assert.equal(sha(readFileSync(join(k.drive, IKINCI_KLASOR, f))), sha(readFileSync(join(k.hedef, 'merkez-yedek', f))));
  assert.equal(readFileSync(join(k.drive, 'tatil fotoğrafları.txt'), 'utf8'), 'sahibin kendi dosyası');
  assert.match(ozetSatiri(s), /Google Drive'a 3 yedek$/);
  // Unchanged: not copied again (Drive's own files are never read back).
  const tekrar = await cek(k.kaynak, { hedef: k.hedef, ikinci: k.drive, yedekSayisi: 3, simdi: () => new Date('2026-10-04T05:00:00.000Z') });
  assert.equal(tekrar.ikinci?.kopyalanan, 0);
  // Drive not there (not signed in): an error, the local copy still made.
  rmSync(k.drive, { recursive: true });
  const yok = await cek(k.kaynak, { hedef: k.hedef, ikinci: k.drive, yedekSayisi: 3, simdi: () => new Date('2026-10-04T05:00:00.000Z') });
  assert.ok(yok.hatalar.some(h => /İkinci yer bulunamadı/.test(h)));
  assert.equal(existsSync(k.drive), false, 'nothing is created where Drive was');
});

test('a cloud-synced target gets no support tickets (and earlier copies there go); unsafe server names are skipped', async t => {
  const k = kurulum('bulut'); t.after(k.temizle);
  calismaYaz(k.calisma);
  await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.ok(existsSync(join(k.hedef, 'calisma', 'destek-talepleri')));
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, bulut: true, simdi });
  assert.equal(existsSync(join(k.hedef, 'calisma', 'destek-talepleri')), false);
  assert.ok(s.uyarilar.some(u => /bulut klasöründe: destek talepleri/.test(u)));
  for (const f of agac(k.hedef)) assert.equal(readFileSync(join(k.hedef, f)).includes(Buffer.from(KISISEL)), false, f);

  for (const kotu of ['../disari.txt', 'a/../../disari.txt', 'CON', 'hata/NUL.txt', 'a:b.txt', 'nokta.', 'ters\\bolu.txt', 'satir\nsonu.txt', '']) assert.equal(yolGecerli(kotu), false, JSON.stringify(kotu));
  assert.ok(yolGecerli('destek-talepleri/çay-ocağı-1a2b/2026-10-12-şikâyet ve öneri.md'));
  // A listing that names files outside (a damaged or hostile server): nothing is written outside the target.
  const sahte = new YerelKaynak(k.calisma, k.yedek);
  const liste = sahte.liste.bind(sahte);
  sahte.liste = async () => { const l = await liste(); l.dosyalar.push({ kok: 'calisma', yol: '../../disari.txt', boyut: 3, zaman: 1, ozet: sha('abc') }, { kok: 'yedek', yol: '../calisma/x.txt', boyut: 3, zaman: 1, ozet: sha('abc') }); return l; };
  const r = await cek(sahte, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(r.atlanan.filter(a => /geçersiz dosya adı/.test(a.neden)).length, 2);
  assert.equal(existsSync(join(k.hedef, '..', 'disari.txt')), false); assert.equal(existsSync(join(k.hedef, 'disari.txt')), false);
});

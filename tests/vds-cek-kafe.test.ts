import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENIOKU, cek, ESKI_YARDIMCI, KAFE_ALT, kafeYolu, listeCoz, ozetSatiri } from '../scripts/vds/cek.js';
import { agac, calismaYaz, gecici, kafeYaz, kurulumAdi, sha, UZAK_CALISMA, UZAK_YEDEK, yaz, yedekAdi, yedekYaz, YerelKaynak } from './vds-fixture.js';

/*
 * "npm run vds:cek", third folder: the cafés' encrypted "Sunucu yedeği" copies (<veri>-sunucu-yedekleri on the server) →
 * <hedef>\kafe-yedekleri\, the disaster copy. Mirrors the server (blobs checked by their SHA-256 name), never uploads in
 * progress, never wipes on an empty listing, never to Google Drive or a cloud-synced target, skipped with an older helper.
 */
function kurulum(ad: string) {
  const kok = gecici(`kafe-${ad}`), sunucu = join(kok, 'sunucu'), calisma = join(sunucu, 'calisma'), yedek = join(sunucu, 'merkez-yedek'), kafe = join(sunucu, 'veri-sunucu-yedekleri');
  const hedef = join(kok, 'Masaüstü kopya', 'vds'), drive = join(kok, "G Drive'ım");
  mkdirSync(calisma, { recursive: true }); mkdirSync(yedek, { recursive: true }); mkdirSync(kafe, { recursive: true }); mkdirSync(drive, { recursive: true });
  calismaYaz(calisma); yedekYaz(yedek, yedekAdi(12), '2026-10-12T00:30:00.000Z');
  const kaynak = new YerelKaynak(calisma, yedek, undefined, kafe);
  return { kok, calisma, yedek, kafe, hedef, drive, yerelKafe: join(hedef, KAFE_ALT), kaynak, temizle: () => rmSync(kok, { recursive: true, force: true }) };
}
const simdi = () => new Date('2026-10-12T05:00:00.000Z');
const kafeIstenen = (k: ReturnType<typeof kurulum>) => k.kaynak.istenenPaketler.flat().filter(a => a.startsWith('kafe/'));

test('the cafés\' copies come whole (blobs checked by name, the big one never hashed on the server), never an upload in progress', async t => {
  const k = kurulum('ilk'); t.after(k.temizle);
  const a = kafeYaz(k.kafe, kurulumAdi(1), { buyuk: true }), b = kafeYaz(k.kafe, kurulumAdi(2));
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(s.hatalar, []); assert.deepEqual(s.atlanan, []); assert.deepEqual(s.uyarilar, []);
  const sunucuda = agac(k.kafe).filter(f => !f.includes('/yukleme/'));
  assert.deepEqual(agac(k.yerelKafe), sunucuda, 'the same files, uploads in progress left out');
  for (const f of sunucuda) assert.equal(sha(readFileSync(join(k.yerelKafe, ...f.split('/')))), sha(readFileSync(join(k.kafe, ...f.split('/')))), f);
  for (const h of [...a, ...b]) assert.ok(existsSync(join(k.yerelKafe, kurulumAdi(h === a[0] || h === a[1] ? 1 : 2), 'parcalar', h)));
  assert.ok(!kafeIstenen(k).some(x => x.includes('yukleme')), 'yukleme/ is never asked for');
  assert.ok(!k.kaynak.istenenOzetler.flat().some(x => x.startsWith('kafe/')), 'a blob\'s name is its SHA-256: no hashing on the server');
  assert.deepEqual(s.kafe, { kurulum: 2, dosya: sunucuda.length, bayt: sunucuda.reduce((n, f) => n + readFileSync(join(k.kafe, ...f.split('/'))).length, 0), silinen: 0 });
  assert.match(ozetSatiri(s), /^\d+ yeni dosya · son Merkez yedeği 12 Ekim 03:30 · \d+,\d MB · kafe yedekleri: 2 kurulum, 1,\d MB$/);
  const durum = JSON.parse(readFileSync(join(k.hedef, 'vds-cek-durum.json'), 'utf8'));
  assert.equal(durum.kafe.kurulum, 2);
  assert.match(readFileSync(join(k.hedef, 'BENIOKU.txt'), 'utf8'), /kafe-yedekleri\\[\s\S]*\/var\/lib\/mola-merkez\/veri-sunucu-yedekleri[\s\S]*mola:mola/);

  // Nothing new: nothing fetched. A new copy: only its new blobs and files.
  const tekrar = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(tekrar.yeni, 0); assert.equal(k.kaynak.istenenPaketler.length, 1);
  const yeni = sha(Buffer.from('yeni parça'));
  yaz(k.kafe, `${kurulumAdi(2)}/parcalar/${yeni}`, 'yeni parça');
  yaz(k.kafe, `${kurulumAdi(2)}/kopyalar/backup-2026-10-13T00-30-00.json`, '{"id":"backup-2026-10-13T00-30-00"}');
  const ucuncu = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(ucuncu.hatalar, []);
  assert.deepEqual(k.kaynak.istenenPaketler.at(-1)!.sort(), [`kafe/${kurulumAdi(2)}/kopyalar/backup-2026-10-13T00-30-00.json`, `kafe/${kurulumAdi(2)}/parcalar/${yeni}`].sort());
  assert.equal(readFileSync(join(k.yerelKafe, kurulumAdi(2), 'parcalar', yeni), 'utf8'), 'yeni parça');
});

test('what the server pruned goes here too (only our file names); an empty or missing folder on the server never wipes the copy', async t => {
  const k = kurulum('silme'); t.after(k.temizle);
  const a = kafeYaz(k.kafe, kurulumAdi(1)); kafeYaz(k.kafe, kurulumAdi(2));
  await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  // Merkez dropped an old copy and its blob; the owner keeps a note of his own in the folder.
  rmSync(join(k.kafe, kurulumAdi(1), 'parcalar', a[1])); rmSync(join(k.kafe, kurulumAdi(1), 'kopyalar'), { recursive: true });
  writeFileSync(join(k.yerelKafe, 'benim notum (kafe).txt'), 'sahibin kendi dosyası');
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(s.hatalar, []);
  assert.equal(s.kafe?.silinen, 2); assert.equal(s.silinen, 2);
  assert.equal(existsSync(join(k.yerelKafe, kurulumAdi(1), 'parcalar', a[1])), false);
  assert.equal(existsSync(join(k.yerelKafe, kurulumAdi(1), 'kopyalar')), false, 'its empty folder goes too');
  assert.ok(existsSync(join(k.yerelKafe, kurulumAdi(1), 'parcalar', a[0])));
  assert.ok(existsSync(join(k.yerelKafe, 'benim notum (kafe).txt')), 'not a name of Merkez\'s: stays');
  const once = agac(k.yerelKafe);

  // Emptied on the server (only Merkez's BENIOKU.txt came back): nothing goes here.
  rmSync(k.kafe, { recursive: true }); yaz(k.kafe, 'BENIOKU.txt', 'MOLA MERKEZ: SUNUCU YEDEKLERİ\r\n');
  const bos = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(bos.kafe?.silinen, 0);
  assert.ok(bos.uyarilar.some(u => /Sunucuda kafe yedeği yok .*dokunulmadı/.test(u)), bos.uyarilar.join(' | '));
  assert.deepEqual(agac(k.yerelKafe), once);
  // The folder gone altogether, or not readable (the helper said "-"): the same.
  rmSync(k.kafe, { recursive: true });
  const yok = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(yok.kafe?.silinen, 0); assert.deepEqual(agac(k.yerelKafe), once);
  k.kaynak.kokler.kafe = null;
  const tire = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.ok(tire.uyarilar.some(u => /kafe yedekleri klasörü okunamadı/.test(u)));
  assert.deepEqual(agac(k.yerelKafe), once);
});

test('a blob that does not match its SHA-256 never replaces anything; a damaged blob on the server is an error and the copy here stays', async t => {
  const k = kurulum('ozet'); t.after(k.temizle);
  const a = kafeYaz(k.kafe, kurulumAdi(1), { buyuk: true });
  k.kaynak.bozan = (ad, veri) => ad.includes('/parcalar/') || ad.endsWith('/durum.json') ? Buffer.concat([veri.subarray(0, veri.length - 1), Buffer.from([veri.at(-1)! ^ 1])]) : veri;
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.equal(s.hatalar.filter(h => /Kafe yedeği parçası doğrulanamadı/.test(h)).length, 2, s.hatalar.join(' | '));
  assert.ok(s.atlanan.some(x => x.ad.endsWith('/durum.json') && /doğrulanamadı/.test(x.neden)), 'durum.json is rewritten by Merkez: next run');
  for (const h of a) assert.equal(existsSync(join(k.yerelKafe, kurulumAdi(1), 'parcalar', h)), false);
  assert.deepEqual(agac(k.hedef).filter(f => /\.gelen-|kopyalaniyor|\.dat$/.test(f)), []);
  k.kaynak.bozan = undefined;
  const iyi = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(iyi.hatalar, []);
  for (const h of a) assert.equal(sha(readFileSync(join(k.yerelKafe, kurulumAdi(1), 'parcalar', h))), h);

  // The server's small blob went bad (its listed SHA-256 is not its name): not fetched, an error, the good copy here stays.
  writeFileSync(join(k.kafe, kurulumAdi(1), 'parcalar', a[1]), 'bozuldu');
  const bozuk = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.ok(bozuk.hatalar.some(h => /kafe yedeği parçası bozuk/.test(h)));
  assert.equal(sha(readFileSync(join(k.yerelKafe, kurulumAdi(1), 'parcalar', a[1]))), a[1]);
  assert.equal(bozuk.kafe?.silinen, 0);
});

test('Google Drive never gets the cafés\' copies (KVKK); a cloud-synced target skips them and leaves what is there', async t => {
  const k = kurulum('drive'); t.after(k.temizle);
  kafeYaz(k.kafe, kurulumAdi(1));
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: k.drive, yedekSayisi: 3, simdi });
  assert.deepEqual(s.hatalar, []);
  assert.equal(s.kafe?.kurulum, 1);
  const driveDosyalari = agac(k.drive);
  assert.ok(driveDosyalari.length > 0);
  for (const f of driveDosyalari) assert.match(f, /^Mola-Merkez-VDS\/merkez-yedek-[^/]+\/[\w.-]+$/, `only Merkez backups in Drive: ${f}`);
  assert.ok(!driveDosyalari.some(f => /kafe|parcalar|kopyalar|sunucu-yedek|[0-9a-f]{64}/.test(f)));

  const bulut = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, bulut: true, simdi });
  assert.equal(bulut.kafe, null);
  assert.ok(bulut.uyarilar.some(u => /bulut klasöründe: kafe yedekleri .*kopyalanmadı.*dokunulmadı/.test(u)), bulut.uyarilar.join(' | '));
  assert.ok(existsSync(join(k.yerelKafe, kurulumAdi(1), 'durum.json')), 'a disaster copy is never deleted by a setting');
  // A fresh cloud-synced target: nothing of the cafés lands there at all.
  const hedef2 = join(k.kok, 'OneDrive', 'vds');
  const ilk = await cek(k.kaynak, { hedef: hedef2, ikinci: null, yedekSayisi: 14, bulut: true, simdi });
  assert.equal(existsSync(join(hedef2, KAFE_ALT)), false);
  assert.ok(!ilk.uyarilar.some(u => /dokunulmadı/.test(u)));
  assert.ok(!k.kaynak.istenenPaketler.at(-1)!.some(a => a.startsWith('kafe/')));
});

test('an older helper on the server (no third folder in its listing): the cafés\' copies are skipped with a plain warning', async t => {
  const k = kurulum('eski'); t.after(k.temizle);
  kafeYaz(k.kafe, kurulumAdi(1));
  await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  const once = agac(k.yerelKafe); assert.ok(once.length);
  k.kaynak.kokler = { calisma: UZAK_CALISMA, yedek: UZAK_YEDEK };
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(s.hatalar, []);
  assert.ok(s.uyarilar.includes(ESKI_YARDIMCI)); assert.match(ESKI_YARDIMCI, /okuma yardımcısı eski; kafe yedekleri için Merkez'i güncelleyin \(kur\.sh\)/);
  assert.equal(s.kafe, null); assert.doesNotMatch(ozetSatiri(s), /kafe/);
  assert.deepEqual(agac(k.yerelKafe), once, 'nothing here is touched');
  // The listing itself: the old header has four fields, the new one five; old clients read only the first two folders.
  const z = '0'.repeat(64);
  const eski = listeCoz(Buffer.from(`MOLA-LISTE\t1\t/a\t/b\0calisma\t1\t1\t${z}\tx.md\0`));
  assert.equal(eski.kafeKok, undefined); assert.equal('kafeKok' in eski, false);
  const yeni = listeCoz(Buffer.from(`MOLA-LISTE\t1\t/a\t/b\t/var/lib/mola-merkez/veri-sunucu-yedekleri\0kafe\t5\t1760000000\t-\t${kurulumAdi(1)}/parcalar/${z}\0`));
  assert.equal(yeni.kafeKok, '/var/lib/mola-merkez/veri-sunucu-yedekleri'); assert.equal(yeni.bozuk, 0);
  assert.deepEqual(yeni.dosyalar[0], { kok: 'kafe', yol: `${kurulumAdi(1)}/parcalar/${z}`, boyut: 5, zaman: 1760000000, ozet: null });
  assert.equal(listeCoz(Buffer.from('MOLA-LISTE\t1\t/a\t/b\t-\0')).kafeKok, null, '"-": the helper knows the folder but cannot read it');
});

test('only Merkez\'s own names: uploads in progress, temporary files and anything else a listing names are ignored', async t => {
  const k = kurulum('adlar'); t.after(k.temizle);
  const h = '0123456789abcdef'.repeat(4), u = kurulumAdi(1);
  for (const [yol, beklenen] of [
    ['BENIOKU.txt', 'dosya'], ['ayarlar.json', 'dosya'], [`${u}/durum.json`, 'dosya'], [`${u}/yillar.json`, 'dosya'], [`${u}/kopyalar/backup-2026-10-12T00-30-00.json`, 'dosya'], [`${u}/parcalar/${h}`, 'parca'],
    [`${u}/yukleme/${'1'.repeat(32)}.json`, null], [`${u}/yukleme/x/${h}.part`, null], [`${u}/durum.json.1a2b3c4d.yaz`, null], [`${u}/parcalar/kisa`, null], [`${u}/kopyalar/x.txt`, null], ['kafe-baska/durum.json', null], [`${u}/a/b/c`, null],
  ] as const) assert.equal(kafeYolu(yol), beklenen, yol);
  kafeYaz(k.kafe, u);
  const liste = k.kaynak.liste.bind(k.kaynak);
  k.kaynak.liste = async () => { const l = await liste(); l.dosyalar.push({ kok: 'kafe', yol: `${u}/yukleme/${'1'.repeat(32)}.json`, boyut: 2, zaman: 1, ozet: sha('{}') }, { kok: 'kafe', yol: `${u}/durum.json.1a2b3c4d.yaz`, boyut: 2, zaman: 1, ozet: sha('{}') }); return l; };
  const s = await cek(k.kaynak, { hedef: k.hedef, ikinci: null, yedekSayisi: 14, simdi });
  assert.deepEqual(s.hatalar, []);
  assert.ok(!kafeIstenen(k).some(a => /yukleme|\.yaz$/.test(a)));
  assert.ok(!agac(k.yerelKafe).some(f => /yukleme|\.yaz$/.test(f)));
  assert.match(BENIOKU(14), /Google Drive'a ya da\r\n\s+bir bulut klasörüne kopyalanmaz \(KVKK\)/);
});

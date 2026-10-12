// npm run vds:cek: the VDS's Mola çalışma klasörü and newest Merkez backups → this PC (and the encrypted backups only →
// Google Drive). Read-only on the server (scripts/linux/mola-oku through sudo -n -u mola). Step by step: docs/VDS_KURULUM.md
// bölüm 15. Logic: scripts/vds/cek.ts; settings: .local/vds.json (scripts/vds/ayar.ts).
//
//   npm run vds:cek -- --kur --host yonetici@<IP> [--anahtar C:\Users\…\.ssh\id_ed25519] [--port 22] [--hedef C:\MolaCalisma\vds]
//                        [--ikinci "G:\Drive'ım\Mola-Merkez-Yedek" | --ikinci yok] [--yedek-sayisi 14] [--alan-adi molayazilim.com.tr]
//   npm run vds:cek                        first time: connects once, shows the server's fingerprint; afterwards: copies
//   npm run vds:cek -- --onayla SHA256:…   the fingerprint you compared with the server's own (bölüm 15)
//   npm run vds:cek -- --zamanla           prints the Görev Zamanlayıcı command (daily 07:00); it is NOT run
//   npm run vds:cek -- --zamanlamayi-kaldir
import { resolve } from 'node:path';
import { backupPlaces } from '../server/second-backup.js';
import { AyarHatasi, ayarOku, ayarYaz, hedefBulutta, ikinciKlasor, kurulumAyari, type VdsAyar } from './vds/ayar.js';
import { cek, KaynakSsh, ozetSatiri } from './vds/cek.js';
import { OKU, okuHatasi } from './vds/komutlar.js';
import { BaglantiHatasi, bilinenParmakIzleri, Ssh } from './vds/ssh.js';
import { gunlugeYaz, kilitAl, zamanlaKomutu, zamanlamaSorguKomutu, zamanlamayiKaldirKomutu } from './vds/yardimci.js';

const GUNLUK = 'vds-cek.log';
const argv = process.argv.slice(2);
const bayrak = (ad: string) => argv.includes(`--${ad}`);
function deger(ad: string) {
  const i = argv.indexOf(`--${ad}`);
  if (i >= 0) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new AyarHatasi(`--${ad} için bir değer yazın.`); return v; }
  return argv.find(a => a.startsWith(`--${ad}=`))?.slice(ad.length + 3);
}
const BILINEN = ['kur', 'host', 'anahtar', 'port', 'hedef', 'ikinci', 'yedek-sayisi', 'alan-adi', 'merkez-port', 'onayla', 'zamanla', 'zamanlamayi-kaldir', 'yardim'];

function yardim() {
  console.log(`Mola: VDS'ten çalışma klasörü ve Merkez yedeklerini bu bilgisayara çeker (sunucuda hiçbir şey değiştirmez).

  npm run vds:cek -- --kur --host yonetici@<IP> [--anahtar <özel anahtar>] [--port 22] [--hedef C:\\MolaCalisma\\vds]
                       [--ikinci "<Google Drive klasörü>" | --ikinci yok] [--yedek-sayisi 14] [--alan-adi molayazilim.com.tr]
  npm run vds:cek                         ilk kez: sunucunun parmak izini gösterir; sonra: yeni ve değişen dosyaları çeker
  npm run vds:cek -- --onayla SHA256:…    parmak izini sunucununkiyle karşılaştırdıktan sonra
  npm run vds:cek -- --zamanla            her gün 07:00 için Görev Zamanlayıcı komutunu YAZAR (çalıştırmaz)
  npm run vds:cek -- --zamanlamayi-kaldir

Ayrıntı: docs/VDS_KURULUM.md bölüm 15.`);
}

async function kur() {
  const onceki = (() => { try { return ayarOku(); } catch { return null; } })();
  const ikinci = deger('ikinci');
  const ayar = ayarYaz(kurulumAyari(onceki, {
    host: deger('host'), port: deger('port'), hedef: deger('hedef'), yedekSayisi: deger('yedek-sayisi'), alanAdi: deger('alan-adi'), merkezPort: deger('merkez-port'),
    ...(deger('anahtar') !== undefined ? { anahtar: deger('anahtar')!.toLowerCase() === 'yok' ? null : deger('anahtar')! } : {}),
    ...(ikinci !== undefined ? { ikinci: ikinci.toLowerCase() === 'yok' ? null : ikinci } : {}),
  }));
  console.log(`Kaydedildi: .local\\vds.json
  Sunucu:        ${ayar.sunucu} (port ${ayar.port})${ayar.anahtar ? `, anahtar ${ayar.anahtar}` : ', anahtar: ssh-agent / varsayılan'}
  Bu bilgisayar: ${ayar.hedef}${hedefBulutta(ayar) ? '  (bulut klasörü: destek talepleri buraya kopyalanmaz)' : ''}
  İkinci yer:    ${ayar.ikinciHedef ? `${ikinciKlasor(ayar)} (yalnız şifreli Merkez yedekleri)` : 'yok'}
  Yedek sayısı:  ${ayar.yedekSayisi} · alan adı ${ayar.alanAdi} · parmak izi ${ayar.parmakIzi ?? 'henüz onaylanmadı'}`);
  if (!ayar.ikinciHedef) {
    const drive = (await backupPlaces().catch(() => [])).filter(p => p.kind === 'gdrive');
    if (drive.length) console.log(`\nGoogle Drive bulundu: ${drive.map(p => p.path).join(', ')}\nYedekleri oraya da koymak için (yalnız şifreli yedekler gider, çalışma klasörü gitmez):\n  npm run vds:cek -- --kur --ikinci "${drive[0].path}"`);
  }
  if (!ayar.parmakIzi) console.log('\nSıradaki adım: npm run vds:cek  (ilk bağlantı; sunucunun parmak izini gösterir)');
}

async function ilkBaglanti(ayar: VdsAyar) {
  const ssh = new Ssh(ayar);
  const r = await ssh.calistirTopla(`${OKU} surum`, undefined, true);
  const izler = await bilinenParmakIzleri(ayar);
  console.log(`Sunucuya ilk kez bağlanıldı (${ayar.sunucu}). Bilgisayarınız sunucunun kimliğini şöyle kaydetti:\n`);
  for (const iz of izler) console.log(`  ${iz}`);
  console.log(`\nBunu sunucunun KENDİ söylediğiyle karşılaştırın (VDS panelindeki konsolda ya da daha önce açtığınız SSH penceresinde):
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
Aynıysa onaylayın:
  npm run vds:cek -- --onayla ${izler[0] ?? 'SHA256:…'}
Farklıysa onaylamayın: araya biri girmiş olabilir (docs/VDS_KURULUM.md bölüm 15).`);
  if (r.kod !== 0 || !r.cikti.toString('utf8').startsWith('MOLA-OKU')) console.log(`\nNot: sunucudaki okuma yardımcısı yanıt vermedi: ${okuHatasi(r.hata)}`);
  gunlugeYaz(GUNLUK, `ilk bağlantı ${ayar.sunucu}: ${izler.join(', ') || 'parmak izi okunamadı'}`);
}

async function onayla(ayar: VdsAyar, iz: string) {
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(iz)) throw new AyarHatasi('Parmak izini SHA256:… biçiminde, tam olarak yazın.');
  const izler = await bilinenParmakIzleri(ayar);
  if (!izler.includes(iz)) throw new AyarHatasi(`Bu parmak izi bilgisayarınızın kaydettiğiyle aynı değil (${izler.join(', ') || 'kayıt yok: önce npm run vds:cek'}).`);
  ayarYaz({ ...ayar, parmakIzi: iz });
  gunlugeYaz(GUNLUK, `parmak izi onaylandı ${ayar.sunucu}: ${iz}`);
  console.log(`Onaylandı. Bundan sonra yalnız bu kimlikteki sunucuya bağlanılır.\nŞimdi: npm run vds:cek`);
}

async function calistir(ayar: VdsAyar) {
  const izler = await bilinenParmakIzleri(ayar);
  if (!izler.includes(ayar.parmakIzi!)) throw new BaglantiHatasi(`Bilgisayarınızın kaydettiği sunucu kimliği onaylanan parmak izi değil (${ayar.parmakIzi}). Bağlanılmadı (docs/VDS_KURULUM.md bölüm 15, "Parmak izi değişti").`);
  const kilit = kilitAl(ayar.hedef);
  if (!kilit) { console.log('Başka bir "npm run vds:cek" çalışıyor; bu çalıştırma atlandı.'); gunlugeYaz(GUNLUK, 'atlandı: başka bir çalıştırma sürüyor'); return 0; }
  try {
    const bas = Date.now();
    const s = await cek(new KaynakSsh(new Ssh(ayar)), { hedef: ayar.hedef, ikinci: ayar.ikinciHedef, yedekSayisi: ayar.yedekSayisi, bulut: hedefBulutta(ayar), beklenen: { calisma: ayar.uzak.calisma, yedek: ayar.uzak.yedek } });
    const satir = ozetSatiri(s);
    console.log(satir);
    console.log(`  ${ayar.hedef}${s.ikinci ? `  ·  ${s.ikinci.klasor}` : ''}`);
    for (const u of s.uyarilar) console.log(`  ! ${u}`);
    for (const a of s.atlanan.slice(0, 10)) console.log(`  · atlandı: ${a.ad} (${a.neden})`);
    if (s.atlanan.length > 10) console.log(`  · ve ${s.atlanan.length - 10} dosya daha atlandı`);
    for (const h of s.hatalar) console.log(`  HATA: ${h}`);
    gunlugeYaz(GUNLUK, `${satir} · silinen ${s.silinen} · atlanan ${s.atlanan.length} · ${((Date.now() - bas) / 1000).toFixed(1)} sn${s.uyarilar.length ? ` · uyarı: ${s.uyarilar.join(' | ')}` : ''}${s.hatalar.length ? ` · HATA: ${s.hatalar.join(' | ')}` : ''}`);
    return s.hatalar.length ? 1 : 0;
  } finally { kilit(); }
}

async function ana() {
  const bilinmeyen = argv.filter(a => a.startsWith('--') && !BILINEN.includes(a.slice(2).split('=')[0]));
  if (bilinmeyen.length) { console.error(`Bilinmeyen seçenek: ${bilinmeyen.join(' ')}`); yardim(); return 2; }
  if (bayrak('yardim')) { yardim(); return 0; }
  if (bayrak('zamanla')) {
    console.log(`Görev Zamanlayıcı'ya her gün 07:00 için bir görev eklemek size kalmış (sistem ayarıdır; bu araç eklemez).
PowerShell'de, bir kez, kendiniz çalıştırın:

  ${zamanlaKomutu(resolve(import.meta.dirname, '..'))}

Görev yalnız siz oturum açmışken çalışır (şifre saklanmaz). SSH anahtarınızın parolası varsa anahtar ssh-agent'ta olmalı
(docs/VDS_KURULUM.md bölüm 15). Kontrol: ${zamanlamaSorguKomutu()}
Kaldırmak: npm run vds:cek -- --zamanlamayi-kaldir`);
    return 0;
  }
  if (bayrak('zamanlamayi-kaldir')) { console.log(`Görevi kaldırmak için PowerShell'de kendiniz çalıştırın:\n\n  ${zamanlamayiKaldirKomutu()}`); return 0; }
  if (bayrak('kur')) { await kur(); return 0; }
  const ayar = ayarOku();
  if (!ayar) { console.error('Önce kurun: npm run vds:cek -- --kur --host yonetici@<sunucu IP>'); return 2; }
  const iz = deger('onayla');
  if (iz !== undefined) { await onayla(ayar, iz); return 0; }
  if (!ayar.parmakIzi) { await ilkBaglanti(ayar); return 0; }
  return calistir(ayar);
}

ana().then(kod => { process.exitCode = kod; }, e => {
  const mesaj = e instanceof AyarHatasi || e instanceof BaglantiHatasi ? e.message : `Beklenmeyen hata: ${e instanceof Error ? e.stack ?? e.message : String(e)}`;
  console.error(mesaj);
  gunlugeYaz(GUNLUK, `HATA: ${mesaj}`);
  process.exitCode = 1;
});

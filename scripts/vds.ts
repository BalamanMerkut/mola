// npm run vds -- <komut>: looks at the VDS with a FIXED list of read-only commands (scripts/vds/komutlar.ts). For the owner and
// for Claude: no free shell; anything that changes the server is the owner's own step (docs/VDS_KURULUM.md bölüm 15).
//   npm run vds -- durum | kayitlar [--son N] [--hata] | caddy [--son N] | hatalar | yedek | disk | sertifika | guvenlik | ozet
//   --kuru  prints the exact ssh command and does not run it
// Every run is written to .local/kayitlar/vds.log (time, command, result; never the server's output).
import { AyarHatasi, ayarOku, sertifikaAdlari } from './vds/ayar.js';
import { bolumler, diskOku, durumOku, KOMUTLAR, KomutHatasi, komutCoz, okuHatasi, ozetMetni, sertifikaOku, uzakKomut, yedekOku, type KomutIstegi } from './vds/komutlar.js';
import { BaglantiHatasi, bilinenParmakIzleri, komutSatiri, Ssh, sshArgumanlari, sshProgrami } from './vds/ssh.js';
import { gunlugeYaz } from './vds/yardimci.js';

const GUNLUK = 'vds.log';
const BASLIK: Record<string, string> = { ufw: 'Güvenlik duvarı (ufw)', fail2ban: 'fail2ban (sshd)', girisler: 'Son girişler (last -n 20)', 'guvenlik-guncellemeleri': 'Bekleyen güvenlik güncellemesi sayısı', hatalar: 'Hata kayıtları (hatalar.json)', 'durum-ozeti': 'Durum özeti (durum-ozeti.md)' };

function yardim() {
  console.log(`Mola sunucusunu yalnız okuyarak inceler. Komutlar:\n${Object.entries(KOMUTLAR).map(([ad, k]) => `  ${ad.padEnd(10)} ${k.aciklama}`).join('\n')}\n\nÖrnek: npm run vds -- ozet   ·   npm run vds -- kayitlar --son 200 --hata   ·   --kuru: komutu yalnız yazar`);
}
const etiket = (i: KomutIstegi) => [i.ad, ...(i.son ? [`--son ${i.son}`] : []), ...(i.hata ? ['--hata'] : []), ...(i.kuru ? ['--kuru'] : [])].join(' ');

function yazdir(istek: KomutIstegi, cikti: string, alanAdi: string) {
  const b = bolumler(cikti);
  const bulgu = (x: { satirlar: string[]; dikkat: string[] }) => { for (const s of x.satirlar) console.log(s); for (const d of x.dikkat) console.log(`  ! ${d}`); };
  switch (istek.ad) {
    case 'ozet': console.log(ozetMetni(cikti, { alanAdi })); return;
    case 'durum': bulgu(durumOku(b)); return;
    case 'disk': bulgu(diskOku(b)); console.log(`\n${b.get('df') ?? ''}`); return;
    case 'yedek': {
      bulgu(yedekOku(b));
      for (const l of (b.get('yedekler') ?? '').split('\n').filter(Boolean)) { const [ad, boyut, tamam, dogru] = l.split('\t'); console.log(`  ${ad}  ${(Number(boyut) / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB  ${tamam === '1' ? (dogru === '1' ? 'tamam, doğrulandı' : 'tamam') : 'YARIM'}`); }
      return;
    }
    case 'sertifika': bulgu(sertifikaOku(b, sertifikaAdlari({ alanAdi }))); for (const ad of sertifikaAdlari({ alanAdi })) console.log(`  ${ad}: ${b.get(`sertifika ${ad}`) || 'okunamadı'}`); return;
    case 'guvenlik': case 'hatalar':
      for (const [ad, metin] of b) console.log(`\n== ${BASLIK[ad] ?? ad} ==\n${metin || '(boş)'}`);
      return;
    default: process.stdout.write(cikti.endsWith('\n') ? cikti : `${cikti}\n`);
  }
}

async function ana() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--yardim' || argv[0] === 'yardim') { yardim(); return 0; }
  let istek: KomutIstegi;
  try { istek = komutCoz(argv); }
  catch (e) { if (e instanceof KomutHatasi) { console.error(e.message); gunlugeYaz(GUNLUK, `REDDEDİLDİ\t${argv.join(' ').slice(0, 200)}`); return 2; } throw e; }
  const ayar = ayarOku();
  if (!ayar) { console.error('Önce kurun: npm run vds:cek -- --kur --host yonetici@<sunucu IP> (docs/VDS_KURULUM.md bölüm 15).'); return 2; }
  const uzak = uzakKomut(istek, ayar);
  if (istek.kuru) {
    console.log(komutSatiri(sshProgrami(), sshArgumanlari(ayar, uzak, !ayar.parmakIzi)));
    if (!ayar.parmakIzi) console.log('(Parmak izi henüz onaylanmadı: gerçek çalıştırma önce "npm run vds:cek" ister.)');
    gunlugeYaz(GUNLUK, `${etiket(istek)}\tyalnız yazıldı`);
    return 0;
  }
  if (!ayar.parmakIzi) throw new BaglantiHatasi('Sunucunun parmak izi henüz onaylanmadı: önce "npm run vds:cek" (ilk bağlantı) ve "--onayla".');
  if (!(await bilinenParmakIzleri(ayar)).includes(ayar.parmakIzi)) throw new BaglantiHatasi(`Bilgisayarınızın kaydettiği sunucu kimliği onaylanan parmak izi değil (${ayar.parmakIzi}). Bağlanılmadı.`);
  const bas = Date.now();
  const r = await new Ssh(ayar).calistirTopla(uzak);
  const cikti = r.cikti.toString('utf8');
  yazdir(istek, cikti, ayar.alanAdi);
  const hata = r.hata.trim();
  if (hata) console.error(`\n(sunucu: ${/sudo|mola-oku/.test(hata) ? okuHatasi(hata) : hata.split(/\r?\n/).slice(-3).join(' · ')})`);
  gunlugeYaz(GUNLUK, `${etiket(istek)}\tçıkış ${r.kod}\t${((Date.now() - bas) / 1000).toFixed(1)} sn`);
  return 0;
}

ana().then(kod => { process.exitCode = kod; }, e => {
  const mesaj = e instanceof AyarHatasi || e instanceof BaglantiHatasi || e instanceof KomutHatasi ? e.message : `Beklenmeyen hata: ${e instanceof Error ? e.message : String(e)}`;
  console.error(mesaj);
  gunlugeYaz(GUNLUK, `HATA\t${process.argv.slice(2).join(' ').slice(0, 200)}\t${mesaj}`);
  process.exitCode = 1;
});

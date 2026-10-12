import { alanAdiGecerli, sertifikaAdlari, type VdsAyar } from './ayar.js';

/*
 * "npm run vds -- <komut>": the ONLY commands these tools send to the server. Each name maps to one fixed command string;
 * nothing the user types reaches it except a checked number (--son 1…2000) and the checked values of .local/vds.json (port,
 * domain). All of them only read: systemctl is-active, uptime, curl to 127.0.0.1, journalctl, df, openssl s_client, last,
 * apt list, and through sudo -n exactly the commands in scripts/linux/mola-okuma.sudoers.ornek (the read-only helper
 * mola-oku as the mola user; ufw status verbose and fail2ban-client status sshd as root). Anything that changes the
 * server is not here: it is done by the owner himself, after reading what it does (docs/VDS_KURULUM.md bölüm 15).
 */
export const OKU_YARDIMCI = '/usr/local/sbin/mola-oku';
export const OKU = `sudo -n -u mola ${OKU_YARDIMCI}`;
export const SUDO_KOK_KOMUTLARI = ['/usr/sbin/ufw status verbose', '/usr/bin/fail2ban-client status sshd'] as const;

export type KomutAdi = 'durum' | 'kayitlar' | 'caddy' | 'hatalar' | 'yedek' | 'disk' | 'sertifika' | 'guvenlik' | 'ozet';
export const KOMUTLAR: Record<KomutAdi, { aciklama: string; secenek: readonly ('son' | 'hata')[] }> = {
  durum: { aciklama: 'Mola Merkez ve Caddy çalışıyor mu, sunucu ne zamandır açık, Merkez sağlık yanıtı ve sürümü', secenek: [] },
  kayitlar: { aciklama: 'Mola Merkez kayıtları (journalctl); --son N (en çok 2000, varsayılan 100), --hata yalnız hatalar', secenek: ['son', 'hata'] },
  caddy: { aciklama: 'Caddy kayıtları (sertifika, HTTPS); --son N (en çok 2000, varsayılan 50)', secenek: ['son'] },
  hatalar: { aciklama: 'Çalışma klasöründeki hata kayıtları özeti (hatalar.json) ve durum-ozeti.md', secenek: [] },
  yedek: { aciklama: 'Merkez yedekleri (ad, boyut, tamam/doğrulandı) ve yedek durumu', secenek: [] },
  disk: { aciklama: 'Disk doluluğu (df) ve Mola klasörlerinin boyutu (du)', secenek: [] },
  sertifika: { aciklama: 'Dört adın HTTPS sertifikası ne zaman bitiyor', secenek: [] },
  guvenlik: { aciklama: 'Güvenlik duvarı, fail2ban, son girişler, bekleyen güvenlik güncellemeleri', secenek: [] },
  ozet: { aciklama: 'durum + disk + yedek + sertifika, tek bir sade özet', secenek: [] },
};
export type KomutIstegi = { ad: KomutAdi; son?: number; hata?: boolean; kuru: boolean };
export class KomutHatasi extends Error {}

/** argv after "npm run vds --": a known command name and only its own checked options; anything else is refused. */
export function komutCoz(argv: string[]): KomutIstegi {
  const [ad, ...kalan] = argv;
  if (!ad || !Object.hasOwn(KOMUTLAR, ad)) throw new KomutHatasi(ad ? `Bilinmeyen komut: "${ad}". İzin verilenler: ${Object.keys(KOMUTLAR).join(', ')}.` : `Komut yazın: ${Object.keys(KOMUTLAR).join(', ')}.`);
  const istek: KomutIstegi = { ad: ad as KomutAdi, kuru: false }, izin = KOMUTLAR[ad as KomutAdi].secenek;
  for (let i = 0; i < kalan.length; i++) {
    const a = kalan[i];
    if (a === '--kuru') { istek.kuru = true; continue; }
    if (a === '--hata' && izin.includes('hata')) { istek.hata = true; continue; }
    const son = a === '--son' ? kalan[++i] : a.startsWith('--son=') ? a.slice(6) : undefined;
    if ((a === '--son' || a.startsWith('--son=')) && izin.includes('son')) {
      if (son === undefined || !/^\d{1,4}$/.test(son) || Number(son) < 1 || Number(son) > 2000) throw new KomutHatasi('--son 1 ile 2000 arasında bir sayı olmalı (ör. --son 200).');
      istek.son = Number(son); continue;
    }
    throw new KomutHatasi(`"${ad}" komutu "${a}" seçeneğini almaz.${izin.length ? ` Alabildikleri: ${izin.map(x => `--${x}`).join(', ')}, --kuru.` : ' Yalnız --kuru.'}`);
  }
  return istek;
}

const B = (ad: string) => `echo '##mola:${ad}'`;
const parca = {
  aktif: () => `${B('aktif')}; systemctl is-active mola-merkez caddy`,
  uptime: () => `${B('uptime')}; uptime`,
  saglik: (port: number) => `${B('saglik')}; curl -fsS --max-time 5 http://127.0.0.1:${port}/api/merkez/v1/health; echo`,
  df: () => `${B('df')}; df -hP / /var/lib/mola-merkez`,
  boyut: () => `${OKU} boyut`,
  yedekler: () => `${OKU} yedekler`,
  sertifika: (adlar: string[]) => adlar.map(a => `${B(`sertifika ${a}`)}; timeout 10 openssl s_client -connect 127.0.0.1:443 -servername ${a} </dev/null 2>/dev/null | openssl x509 -noout -enddate`).join('; '),
};
/** The exact remote command for a request (checked again here: a changed .local/vds.json cannot slip a fragment in). */
export function uzakKomut(istek: KomutIstegi, ayar: Pick<VdsAyar, 'merkezPort' | 'alanAdi'>): string {
  const port = ayar.merkezPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new KomutHatasi('Merkez portu geçersiz.');
  const adlar = sertifikaAdlari(ayar);
  if (!adlar.every(alanAdiGecerli)) throw new KomutHatasi('Alan adı geçersiz.');
  const n = (v: number | undefined, varsayilan: number) => { const x = v ?? varsayilan; if (!Number.isInteger(x) || x < 1 || x > 2000) throw new KomutHatasi('--son 1 ile 2000 arasında olmalı.'); return x; };
  switch (istek.ad) {
    case 'durum': return [parca.aktif(), parca.uptime(), parca.saglik(port)].join('; ');
    case 'kayitlar': return `journalctl -u mola-merkez -n ${n(istek.son, 100)} --no-pager -o short-iso${istek.hata ? ' -p err' : ''}`;
    case 'caddy': return `journalctl -u caddy -n ${n(istek.son, 50)} --no-pager -o short-iso`;
    case 'hatalar': return `${OKU} hatalar`;
    case 'yedek': return parca.yedekler();
    case 'disk': return [parca.df(), parca.boyut()].join('; ');
    case 'sertifika': return parca.sertifika(adlar);
    case 'guvenlik': return [`${B('ufw')}; sudo -n ${SUDO_KOK_KOMUTLARI[0]}`, `${B('fail2ban')}; sudo -n ${SUDO_KOK_KOMUTLARI[1]}`, `${B('girisler')}; last -n 20`, `${B('guvenlik-guncellemeleri')}; apt list --upgradable 2>/dev/null | grep -i security | wc -l`].join('; ');
    case 'ozet': return [parca.aktif(), parca.uptime(), parca.saglik(port), parca.df(), parca.boyut(), parca.yedekler(), parca.sertifika(adlar)].join('; ');
  }
}

/** Plain Turkish for the helper's / sudo's refusals (the server is set up, but a step of bölüm 15 is missing). */
export function okuHatasi(hata: string) {
  if (/a password is required|may not run sudo|not allowed to execute|is not in the sudoers/i.test(hata)) return 'Sunucuda parolasız okuma izni yok: /etc/sudoers.d/mola-okuma kurulmamış ya da bu komutu içermiyor (docs/VDS_KURULUM.md bölüm 15).';
  if (/mola-oku.*(not found|No such file)/i.test(hata)) return 'Sunucuda /usr/local/sbin/mola-oku yok: Merkez paketini bu sürümle yeniden kurun (sudo ./kur.sh).';
  if (/unknown user:? mola/i.test(hata)) return 'Sunucuda "mola" kullanıcısı yok: Mola Merkez kurulmamış (sudo ./kur.sh).';
  return `Sunucu okunamadı: ${hata.trim().split(/\r?\n/).slice(-2).join(' ') || 'bilinmeyen hata'}`;
}

// ---------- Reading the answers ----------
/** "##mola:<ad>" lines split the output into sections. */
export function bolumler(cikti: string) {
  const sonuc = new Map<string, string>();
  let ad = '', satirlar: string[] = [];
  const kapat = () => { if (ad) sonuc.set(ad, satirlar.join('\n').trim()); };
  for (const satir of cikti.replace(/\r/g, '').split('\n')) {
    const m = /^##mola:(.+)$/.exec(satir);
    if (m) { kapat(); ad = m[1].trim(); satirlar = []; } else satirlar.push(satir);
  }
  kapat();
  return sonuc;
}
const AYLAR: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** openssl's "notAfter=Jan  9 12:00:00 2027 GMT" → Date. */
export function sertifikaBitisi(metin: string) {
  const m = /notAfter=(\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4}) GMT/.exec(metin);
  if (!m || AYLAR[m[1]] === undefined) return null;
  return new Date(Date.UTC(Number(m[6]), AYLAR[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])));
}
const gun = (d: Date) => new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const saat = (iso: string) => new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const mb = (b: number) => `${(b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;

export type Bulgu = { satirlar: string[]; dikkat: string[] };
export function durumOku(b: Map<string, string>): Bulgu {
  const satirlar: string[] = [], dikkat: string[] = [];
  const [merkez = '?', caddy = '?'] = (b.get('aktif') ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  const ad = (s: string) => s === 'active' ? 'çalışıyor' : s === 'activating' ? 'başlıyor' : `ÇALIŞMIYOR (${s})`;
  if (merkez !== 'active') dikkat.push(`Mola Merkez çalışmıyor (${merkez}): npm run vds -- kayitlar --hata`);
  if (caddy !== 'active') dikkat.push(`Caddy çalışmıyor (${caddy}): npm run vds -- caddy`);
  let saglik = 'yanıt yok';
  try {
    const h = JSON.parse(b.get('saglik') || 'null') as { ok?: boolean; role?: string; version?: string; mode?: string } | null;
    if (h?.ok && h.role === 'merkez') saglik = `tamam (Merkez ${h.version ?? '?'}${h.mode === 'installed' ? '' : `, ${h.mode}`})`;
    else dikkat.push('Merkez sağlık yanıtı beklenen gibi değil.');
  } catch { dikkat.push('Merkez sağlık yanıtı alınamadı (127.0.0.1).'); }
  satirlar.push(`Mola Merkez: ${ad(merkez)} · Caddy: ${ad(caddy)} · sağlık: ${saglik}`);
  const up = /up\s+(.+?),\s+\d+ users?,\s+load average:\s*([\d.,]+)/.exec(b.get('uptime') ?? '');
  if (up) satirlar.push(`Sunucu açık: ${up[1].replace(/days?/, 'gün').replace(/min/, 'dk')} · yük ${up[2].split(',')[0].trim()}`);
  return { satirlar, dikkat };
}
export function diskOku(b: Map<string, string>): Bulgu {
  const satirlar: string[] = [], dikkat: string[] = [];
  const df = (b.get('df') ?? '').split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(p => p.length >= 6);
  for (const [, boyut, , bos, yuzde, yer] of df) {
    const y = Number(yuzde.replace('%', ''));
    satirlar.push(`Disk ${yer}: %${y} dolu (${bos} boş / ${boyut})`);
    if (y >= 80) dikkat.push(`Disk ${yer} %${y} dolu (%80'i geçmesin).`);
  }
  const du = (b.get('boyut') ?? '').split('\n').map(l => /^(\d+)\s+(.+?)\/?$/.exec(l.trim())).filter(Boolean) as RegExpExecArray[];
  if (du.length) satirlar.push(`Mola klasörleri: ${du.map(m => `${m[2].split('/').pop()} ${mb(Number(m[1]))}`).join(', ')}`);
  return { satirlar, dikkat };
}
export function yedekOku(b: Map<string, string>, simdi = new Date()): Bulgu {
  const satirlar: string[] = [], dikkat: string[] = [];
  const yedekler = (b.get('yedekler') ?? '').split('\n').map(l => l.split('\t')).filter(p => p.length === 4 && /^merkez-yedek-/.test(p[0]));
  const tamam = yedekler.filter(p => p[2] === '1'), toplam = yedekler.reduce((n, p) => n + Number(p[1] || 0), 0);
  let durum: { lastSuccessAt?: string; lastError?: string; nextRunAt?: string } | null = null;
  try { durum = JSON.parse(b.get('yedek-durum') || 'null'); } catch { /* no status file yet */ }
  const son = durum?.lastSuccessAt;
  satirlar.push(`Merkez yedeği: ${son ? `son ${saat(son)}` : 'henüz başarılı yedek yok'} · sunucuda ${tamam.length} yedek (${mb(toplam)})${durum?.nextRunAt ? ` · sonraki ${saat(durum.nextRunAt)}` : ''}`);
  if (!son) dikkat.push('Sunucuda başarılı Merkez yedeği yok.');
  else if (simdi.getTime() - Date.parse(son) > 36 * 3600_000) dikkat.push(`Son Merkez yedeği eski (${saat(son)}).`);
  if (durum?.lastError) dikkat.push(`Son yedek hatası: ${durum.lastError}`);
  const dogrulanmamis = tamam.filter(p => p[3] !== '1').length;
  if (dogrulanmamis > 1) dikkat.push(`${dogrulanmamis} yedek doğrulanmamış görünüyor.`);
  return { satirlar, dikkat };
}
export function sertifikaOku(b: Map<string, string>, adlar: string[], simdi = new Date()): Bulgu {
  const satirlar: string[] = [], dikkat: string[] = [];
  const bitisler: { ad: string; tarih: Date }[] = [];
  for (const ad of adlar) {
    const t = sertifikaBitisi(b.get(`sertifika ${ad}`) ?? '');
    if (!t) { dikkat.push(`${ad}: sertifika okunamadı (DNS kaydı ve Caddyfile'da bu ad var mı?).`); continue; }
    const kalan = Math.floor((t.getTime() - simdi.getTime()) / 86400_000);
    bitisler.push({ ad, tarih: t });
    if (kalan < 14) dikkat.push(`${ad}: sertifika ${kalan < 0 ? 'SÜRESİ DOLMUŞ' : `${kalan} gün içinde bitiyor`} (Caddy yenileyemiyor olabilir: npm run vds -- caddy).`);
  }
  if (bitisler.length) {
    const ilk = bitisler.sort((a, b2) => a.tarih.getTime() - b2.tarih.getTime())[0];
    satirlar.push(`Sertifikalar: ${bitisler.length}/${adlar.length} ad okundu; en erken ${ilk.ad} ${gun(ilk.tarih)} (${Math.floor((ilk.tarih.getTime() - simdi.getTime()) / 86400_000)} gün)`);
  }
  return { satirlar, dikkat };
}
/** "ozet": one plain Turkish summary. */
export function ozetMetni(cikti: string, ayar: Pick<VdsAyar, 'alanAdi'>, simdi = new Date()) {
  const b = bolumler(cikti);
  const parcalar = [durumOku(b), diskOku(b), yedekOku(b, simdi), sertifikaOku(b, sertifikaAdlari(ayar), simdi)];
  const dikkat = parcalar.flatMap(p => p.dikkat);
  return [
    `Mola sunucusu · ${saat(simdi.toISOString())}`,
    ...parcalar.flatMap(p => p.satirlar).map(s => `  ${s}`),
    dikkat.length ? `Dikkat (${dikkat.length}):\n${dikkat.map(d => `  - ${d}`).join('\n')}` : 'Sonuç: her şey yolunda.',
  ].join('\n');
}

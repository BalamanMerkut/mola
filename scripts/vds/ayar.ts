import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, sep, win32 } from 'node:path';
import { cloudFolder } from '../../server/merkez/workfolder.js';

/*
 * .local/vds.json: where the owner's VDS is and where its copies go on this PC ("npm run vds:cek", "npm run vds").
 * Written by `npm run vds:cek -- --kur --host yonetici@<IP> …`. No secret in it (the SSH key stays where it is; only its path).
 * Every value that ever reaches an SSH command line (host, user, port, domain names, remote folders) is checked here, so the
 * fixed commands in komutlar.ts / cek.ts never carry a shell fragment.
 */
export const AYAR_DOSYASI = '.local/vds.json';
export const VARSAYILAN_HEDEF = 'C:\\MolaCalisma\\vds';
/** The folder made inside the optional second (Google Drive) place: only encrypted Merkez backups go there. */
export const IKINCI_KLASOR = 'Mola-Merkez-VDS';
export const UZAK_VARSAYILAN = { veri: '/var/lib/mola-merkez/veri', calisma: '/var/lib/mola-merkez/calisma', yedek: '/var/lib/mola-merkez/merkez-yedek' } as const;

export type VdsAyar = {
  bicim: 1;
  /** user@host, e.g. yonetici@203.0.113.10 */
  sunucu: string;
  port: number;
  /** Private key file (Windows path) or null: ssh's own default keys / ssh-agent. */
  anahtar: string | null;
  /** The server's host key fingerprint the owner confirmed ("SHA256:…"); null until then (only the first-connection probe runs). */
  parmakIzi: string | null;
  /** Merkez's folders on the server (the Linux package's defaults); the read-only helper reports its own and must agree. */
  uzak: { veri: string; calisma: string; yedek: string };
  /** Merkez's local port on the server (health check through 127.0.0.1). */
  merkezPort: number;
  /** The web site's domain: the four certificate names are it, www., merkez., menu. */
  alanAdi: string;
  /** This PC: the work folder copy and the Merkez backups (not cloud-synced). */
  hedef: string;
  /** Optional second place (Google Drive folder): only the encrypted backups, never the work folder (KVKK). */
  ikinciHedef: string | null;
  /** How many newest Merkez backups are kept (here and in the second place); Merkez keeps 14 too. */
  yedekSayisi: number;
};

export class AyarHatasi extends Error {}

const KULLANICI = /^[a-z_][a-z0-9_-]{0,31}$/;
const ETIKET = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const ALAN = new RegExp(`^${ETIKET}(?:\\.${ETIKET})*$`);
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^\[[0-9a-fA-F:.]{2,45}\]$/;
const UZAK_YOL = /^\/[A-Za-z0-9._/-]{1,200}$/;

/** A host name (or IP) safe on an SSH command line and in a remote command: letters, digits, dots, hyphens only. */
export function alanAdiGecerli(ad: string) { return ad.length <= 253 && ALAN.test(ad) && !ad.startsWith('-'); }
/** "yonetici@203.0.113.10" → parts, or the plain Turkish reason. Never an option ("-o…"), a space, a quote or a ";". */
export function sunucuCoz(deger: string): { kullanici: string; adres: string } {
  const v = deger.trim(), m = /^([^@]+)@(.+)$/.exec(v);
  if (!m) throw new AyarHatasi('Sunucuyu kullanıcı@adres biçiminde yazın, ör. yonetici@203.0.113.10');
  const [, kullanici, adres] = m;
  if (!KULLANICI.test(kullanici)) throw new AyarHatasi(`Kullanıcı adı geçersiz: "${kullanici}" (küçük harf, rakam, - ve _).`);
  if (!(IPV4.test(adres) || IPV6.test(adres) || (alanAdiGecerli(adres) && /[A-Za-z]/.test(adres)))) throw new AyarHatasi(`Sunucu adresi geçersiz: "${adres}" (IP adresi ya da alan adı).`);
  return { kullanici, adres };
}
function port(deger: unknown, ad: string) {
  const n = typeof deger === 'string' && /^\d{1,5}$/.test(deger) ? Number(deger) : deger;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 65535) throw new AyarHatasi(`${ad} 1 ile 65535 arasında bir sayı olmalı.`);
  return n;
}
/** A full Windows path (or a full path of this system): never a drive root, never relative, no quote or line break. */
export function yerelYol(deger: string, ad: string) {
  const v = deger.trim();
  if (!v) throw new AyarHatasi(`${ad}: klasör yolunu yazın.`);
  if (/["\r\n\0]/.test(v)) throw new AyarHatasi(`${ad}: yolda tırnak ya da satır sonu olamaz.`);
  if (!(win32.isAbsolute(v) && /^[A-Za-z]:[\\/]|^\\\\/.test(v)) && !(process.platform !== 'win32' && isAbsolute(v))) throw new AyarHatasi(`${ad}: tam yol yazın (ör. C:\\MolaCalisma\\vds).`);
  const tam = resolve(v);
  if (tam === parse(tam).root) throw new AyarHatasi(`${ad}: diskin kökü seçilemez; bir klasör yazın.`);
  return tam;
}
const icinde = (a: string, b: string) => { const x = resolve(a).toLowerCase(), y = resolve(b).toLowerCase(); return x === y || x.startsWith(y.endsWith(sep) ? y : y + sep); };

/** Checks a whole configuration (as read from .local/vds.json or made by --kur); returns it normalized or throws AyarHatasi. */
export function ayarDenetle(girdi: unknown): VdsAyar {
  if (!girdi || typeof girdi !== 'object') throw new AyarHatasi('.local/vds.json okunamadı.');
  const a = girdi as Record<string, unknown>;
  if (a.bicim !== 1) throw new AyarHatasi('.local/vds.json biçimi tanınmadı (bicim: 1 olmalı).');
  if (typeof a.sunucu !== 'string') throw new AyarHatasi('Sunucu yazılmamış.');
  const { kullanici, adres } = sunucuCoz(a.sunucu);
  const anahtar = a.anahtar === null || a.anahtar === undefined ? null : yerelYol(String(a.anahtar), 'SSH anahtarı');
  const parmakIzi = a.parmakIzi === null || a.parmakIzi === undefined ? null : String(a.parmakIzi);
  if (parmakIzi !== null && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(parmakIzi)) throw new AyarHatasi('Parmak izi SHA256:… biçiminde olmalı.');
  const u = (a.uzak ?? {}) as Record<string, unknown>, uzak = { ...UZAK_VARSAYILAN } as VdsAyar['uzak'];
  for (const k of ['veri', 'calisma', 'yedek'] as const) {
    const v = u[k] === undefined ? UZAK_VARSAYILAN[k] : String(u[k]);
    if (!UZAK_YOL.test(v) || v.split('/').some(p => p === '..' || p === '.')) throw new AyarHatasi(`Sunucudaki ${k} klasörü geçersiz: "${v}".`);
    uzak[k] = v;
  }
  const alanAdi = String(a.alanAdi ?? 'molayazilim.com.tr').toLowerCase();
  if (!alanAdiGecerli(alanAdi) || !alanAdi.includes('.')) throw new AyarHatasi(`Alan adı geçersiz: "${alanAdi}".`);
  const hedef = yerelYol(String(a.hedef ?? VARSAYILAN_HEDEF), 'Hedef klasör');
  const ikinciHedef = a.ikinciHedef === null || a.ikinciHedef === undefined ? null : yerelYol(String(a.ikinciHedef), 'İkinci yer');
  if (ikinciHedef && (icinde(ikinciHedef, hedef) || icinde(hedef, ikinciHedef))) throw new AyarHatasi('İkinci yer (Google Drive) hedef klasörden ayrı olmalı.');
  const yedekSayisi = a.yedekSayisi === undefined ? 14 : Number(a.yedekSayisi);
  if (!Number.isInteger(yedekSayisi) || yedekSayisi < 1 || yedekSayisi > 60) throw new AyarHatasi('Saklanacak yedek sayısı 1 ile 60 arasında olmalı.');
  return { bicim: 1, sunucu: `${kullanici}@${adres}`, port: port(a.port ?? 22, 'SSH portu'), anahtar, parmakIzi, uzak, merkezPort: port(a.merkezPort ?? 4000, 'Merkez portu'), alanAdi, hedef, ikinciHedef, yedekSayisi };
}

/** The four names Caddy holds a certificate for (docs/VDS_KURULUM.md bölüm 13). */
export const sertifikaAdlari = (a: Pick<VdsAyar, 'alanAdi'>) => [a.alanAdi, `www.${a.alanAdi}`, `merkez.${a.alanAdi}`, `menu.${a.alanAdi}`];
/** The local target is cloud-synced (OneDrive, Google Drive…): support tickets (personal data) are then not copied there. */
export const hedefBulutta = (a: Pick<VdsAyar, 'hedef'>, env = process.env) => cloudFolder(a.hedef, env);

export function ayarOku(dosya = AYAR_DOSYASI): VdsAyar | null {
  if (!existsSync(dosya)) return null;
  let girdi: unknown;
  try { girdi = JSON.parse(readFileSync(dosya, 'utf8')); } catch { throw new AyarHatasi(`${dosya} bozuk (JSON okunamadı). Silip --kur ile yeniden oluşturun.`); }
  return ayarDenetle(girdi);
}
export function ayarYaz(ayar: VdsAyar, dosya = AYAR_DOSYASI) {
  const temiz = ayarDenetle(ayar);
  mkdirSync(dirname(dosya), { recursive: true });
  const gecici = `${dosya}.${process.pid}.yaziliyor`;
  writeFileSync(gecici, JSON.stringify(temiz, null, 2) + '\n');
  renameSync(gecici, dosya);
  return temiz;
}

/** --kur: the given flags over the existing file (or the defaults). A new host forgets the confirmed fingerprint. */
export function kurulumAyari(onceki: VdsAyar | null, s: { host?: string; anahtar?: string | null; port?: string; hedef?: string; ikinci?: string | null; yedekSayisi?: string; alanAdi?: string; merkezPort?: string }): VdsAyar {
  const host = s.host ?? onceki?.sunucu;
  if (!host) throw new AyarHatasi('İlk kurulumda --host yonetici@<IP> gerekli.');
  const sunucu = (() => { const { kullanici, adres } = sunucuCoz(host); return `${kullanici}@${adres}`; })();
  const yeniPort = s.port !== undefined ? port(s.port, 'SSH portu') : onceki?.port ?? 22;
  const ayniSunucu = !!onceki && onceki.sunucu === sunucu && onceki.port === yeniPort;
  return ayarDenetle({
    bicim: 1, sunucu, port: yeniPort,
    anahtar: s.anahtar !== undefined ? s.anahtar : onceki?.anahtar ?? null,
    parmakIzi: ayniSunucu ? onceki!.parmakIzi : null,
    uzak: onceki?.uzak ?? UZAK_VARSAYILAN,
    merkezPort: s.merkezPort ?? onceki?.merkezPort ?? 4000,
    alanAdi: s.alanAdi ?? onceki?.alanAdi ?? 'molayazilim.com.tr',
    hedef: s.hedef ?? onceki?.hedef ?? VARSAYILAN_HEDEF,
    ikinciHedef: s.ikinci !== undefined ? s.ikinci : onceki?.ikinciHedef ?? null,
    yedekSayisi: s.yedekSayisi ?? onceki?.yedekSayisi ?? 14,
  });
}
/** Where the backups go inside the second place. */
export const ikinciKlasor = (a: Pick<VdsAyar, 'ikinciHedef'>) => a.ikinciHedef ? join(a.ikinciHedef, IKINCI_KLASOR) : null;

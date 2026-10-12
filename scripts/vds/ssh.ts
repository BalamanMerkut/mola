import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { sunucuCoz, type VdsAyar } from './ayar.js';

/*
 * The only way these tools reach the server: Windows' own OpenSSH client (ssh.exe) started WITHOUT a shell, with an argument
 * list, BatchMode (never a password prompt) and strict host key checking once the owner confirmed the fingerprint. The remote
 * command is always one of the fixed strings in komutlar.ts / cek.ts. Tests replace the runner (Calistirici).
 */
export type Islem = { cikti: Readable; bitti: Promise<{ kod: number; hata: string }> };
export type Calistirici = (program: string, args: string[], girdi?: Buffer) => Islem;

/** Starts a program (no shell), feeds `girdi` to it, gives its output as a stream. Exit code -1: it could not start. */
export const gercekCalistirici: Calistirici = (program, args, girdi) => {
  const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  let hata = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (s: string) => { if (hata.length < 20000) hata += s; });
  const bitti = new Promise<{ kod: number; hata: string }>(done => {
    child.on('error', e => done({ kod: -1, hata: `${program} çalıştırılamadı: ${e.message}` }));
    child.on('close', kod => done({ kod: kod ?? -1, hata }));
  });
  child.stdin.on('error', () => { /* the program ended before reading everything: its exit code tells */ });
  child.stdin.end(girdi ?? Buffer.alloc(0));
  return { cikti: child.stdout, bitti };
};
/** Whole output of a finished program. */
export async function topla(islem: Islem) {
  const parcalar: Buffer[] = [];
  for await (const p of islem.cikti) parcalar.push(Buffer.isBuffer(p) ? p : Buffer.from(p));
  const { kod, hata } = await islem.bitti;
  return { kod, cikti: Buffer.concat(parcalar), hata };
}
/** A finished program's result as an Islem (fake runners in tests). */
export function hazirIslem(cikti: Buffer | string, kod = 0, hata = ''): Islem {
  return { cikti: Readable.from([Buffer.from(cikti)]), bitti: Promise.resolve({ kod, hata }) };
}

/** Windows' own OpenSSH (not Git's), so known_hosts and ssh-agent are the ones the owner set up. */
export function sshProgrami(ad: 'ssh' | 'ssh-keygen' = 'ssh') {
  const windows = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', `${ad}.exe`);
  return process.platform === 'win32' && existsSync(windows) ? windows : ad;
}

export class BaglantiHatasi extends Error {}

/** ssh's arguments for one fixed remote command. `ilk`: the first-connection probe (accept-new), else strict. */
export function sshArgumanlari(ayar: VdsAyar, uzakKomut: string, ilk = false) {
  sunucuCoz(ayar.sunucu); // checked again right before use: never an option, a space or a shell character
  if (!ilk && !ayar.parmakIzi) throw new BaglantiHatasi('Sunucunun parmak izi henüz onaylanmadı: önce "npm run vds:cek" (ilk bağlantı) ve "--onayla".');
  if (/[\r\n\0]/.test(uzakKomut)) throw new BaglantiHatasi('Komut satır sonu içeremez.');
  return [
    '-o', 'BatchMode=yes',
    '-o', `StrictHostKeyChecking=${ilk ? 'accept-new' : 'yes'}`,
    '-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
    '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no', '-o', 'LogLevel=ERROR',
    ...(ayar.anahtar ? ['-i', ayar.anahtar, '-o', 'IdentitiesOnly=yes'] : []),
    '-p', String(ayar.port),
    '--', ayar.sunucu, uzakKomut,
  ];
}
/** For --kuru: the command as one PowerShell line (arguments with spaces in double quotes; remote commands hold no " or $). */
export function komutSatiri(program: string, args: string[]) {
  const q = (s: string) => /^[A-Za-z0-9_@%+=:,./\\-]+$/.test(s) ? s : `"${s}"`;
  return [program.includes(' ') ? `& "${program}"` : program, ...args.map(q)].join(' ');
}
/** Plain Turkish for ssh's usual failures (exit code 255). */
export function sshHatasi(hata: string, ayar: VdsAyar) {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(hata)) return `Sunucunun kimliği (parmak izi) beklenenden farklı. Sunucu yeniden kurulduysa docs/VDS_KURULUM.md "Parmak izi değişti" bölümüne bakın; kurulmadıysa BAĞLANMAYIN.`;
  if (/Permission denied/i.test(hata)) return `Sunucu girişi reddetti (${ayar.sunucu}). SSH anahtarı sunucuda kayıtlı mı? Anahtarın parolası varsa ssh-agent'a eklendi mi (ssh-add)?`;
  if (/timed out|Connection refused|No route|Could not resolve|Network is unreachable/i.test(hata)) return `Sunucuya ulaşılamadı (${ayar.sunucu}, port ${ayar.port}). İnternet bağlantısını ve sunucunun açık olduğunu kontrol edin.`;
  return `SSH bağlantısı kurulamadı: ${hata.trim().split(/\r?\n/).slice(-2).join(' ') || 'bilinmeyen hata'}`;
}

export class Ssh {
  constructor(public ayar: VdsAyar, private calistir: Calistirici = gercekCalistirici, public program = sshProgrami()) {}
  argumanlar(uzakKomut: string, ilk = false) { return sshArgumanlari(this.ayar, uzakKomut, ilk); }
  baslat(uzakKomut: string, girdi?: Buffer, ilk = false): Islem { return this.calistir(this.program, this.argumanlar(uzakKomut, ilk), girdi); }
  /** Runs and collects; ssh's own failure (255, or it could not start) throws in plain Turkish. */
  async calistirTopla(uzakKomut: string, girdi?: Buffer, ilk = false) {
    const r = await topla(this.baslat(uzakKomut, girdi, ilk));
    if (r.kod === 255 || r.kod === -1) throw new BaglantiHatasi(sshHatasi(r.hata, this.ayar));
    return r;
  }
}

// ---------- Host key ----------
/** The host name as known_hosts writes it ("[host]:2222" for another port). */
export const knownHostsAdi = (ayar: VdsAyar) => { const { adres } = sunucuCoz(ayar.sunucu); return ayar.port === 22 ? adres : `[${adres}]:${ayar.port}`; };
/** Fingerprints (SHA256:…) known_hosts holds for the server, read with ssh-keygen -F (nothing is changed). */
export async function bilinenParmakIzleri(ayar: VdsAyar, calistir: Calistirici = gercekCalistirici, dosya = join(homedir(), '.ssh', 'known_hosts')) {
  const r = await topla(calistir(sshProgrami('ssh-keygen'), ['-l', '-F', knownHostsAdi(ayar), '-f', dosya]));
  return [...new Set(r.cikti.toString('utf8').match(/SHA256:[A-Za-z0-9+/]{43}/g) ?? [])];
}

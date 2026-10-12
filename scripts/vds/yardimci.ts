import { appendFileSync, closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** .local/kayitlar/<dosya>: one line per run (time, command, result). Never the server's output. */
export const KAYIT_KLASORU = '.local/kayitlar';
export function gunlugeYaz(dosya: string, satir: string, klasor = KAYIT_KLASORU, simdi = new Date()) {
  try {
    mkdirSync(klasor, { recursive: true });
    appendFileSync(join(klasor, dosya), `${simdi.toISOString()}\t${satir.replace(/[\r\n]+/g, ' ').slice(0, 2000)}\n`, 'utf8');
  } catch { /* a log that cannot be written never stops the tool */ }
}

/** One run at a time (the daily task and a manual run): a lock file in the target folder; an old one (2 h) is taken over. */
export function kilitAl(klasor: string, simdi = Date.now()) {
  mkdirSync(klasor, { recursive: true });
  const dosya = join(klasor, '.vds-cek.kilit');
  for (let i = 0; i < 2; i++) {
    try { const fd = openSync(dosya, 'wx'); writeSync(fd, `${process.pid}\n`); closeSync(fd); return () => rmSync(dosya, { force: true }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (simdi - statSync(dosya).mtimeMs > 2 * 3600_000) { rmSync(dosya, { force: true }); continue; } } catch { continue; }
      return null;
    }
  }
  return null;
}

// ---------- Windows Görev Zamanlayıcı: printed for the owner, never run by the tool ----------
export const GOREV_ADI = 'Mola\\VDS yedek cek';
/** The small .cmd the task starts (it runs "npm run vds:cek" in the project folder). */
export const gorevDosyasi = (proje: string) => join(resolve(proje), 'scripts', 'vds-cek.cmd');
/**
 * schtasks: every day at 07:00, ONLY while the owner is logged on (/IT: no password is stored; the SSH key comes from
 * ssh-agent). "--%" makes PowerShell pass the rest exactly as written (the quotes around a path with spaces).
 */
export function zamanlaKomutu(proje: string, saat = '07:00') {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(saat)) throw new Error('Saat SS:DD biçiminde olmalı (ör. 07:00).');
  const tr = `"\\"${gorevDosyasi(proje)}\\""`;
  if (tr.length > 261) throw new Error('Proje klasörünün yolu Görev Zamanlayıcı için çok uzun (261 karakter).');
  return `schtasks --% /Create /TN "${GOREV_ADI}" /TR ${tr} /SC DAILY /ST ${saat} /IT /F`;
}
export const zamanlamayiKaldirKomutu = () => `schtasks /Delete /TN "${GOREV_ADI}" /F`;
export const zamanlamaSorguKomutu = () => `schtasks /Query /TN "${GOREV_ADI}" /V /FO LIST`;

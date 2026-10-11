import { randomInt } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { DomainError } from '../../packages/domain/engine.js';
import { adminRecord } from '../admin-auth.js';
import { dataLock } from '../data-lock.js';
import type { KdfParams } from '../key-vault.js';
import { addAlert } from './alerts.js';
import { MerkezKeyGuard, type MerkezLock } from './key-guard.js';
import { MerkezStore } from './store.js';

/*
 * "Sifre-Sifirla" (last resort, no code at hand): the Mola Yönetim admin password becomes a one-time temporary password that
 * must be changed at the next login (the forced first-password change). Run on the Merkez computer by the OS user who owns
 * the data: the data is opened exactly like the server opens it (server/merkez/key-guard.ts: development.key, or anahtar.json
 * behind the Windows/macOS lock or the server passphrase), so another user gets "kilitli" and is asked for the Merkez recovery
 * code (which then locks the key for that user). The data lock refuses while Merkez runs.
 * Nothing is written in plain: the temporary password is only returned (the command prints it). Audit + Bildirim merkezi
 * (+ e-mail on the next start when SMTP is set up).
 */
export class OfflineResetError extends Error {
  constructor(public code: 'NO_DATA' | 'RUNNING' | 'LOCKED', message: string) { super(message); }
}
/** No 0/O, 1/I/L: read from a console and typed by hand. 16 symbols of 31: about 79 bits. */
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const temporaryPassword = () => Array.from({ length: 16 }, () => LETTERS[randomInt(LETTERS.length)]).join('').replace(/(.{4})(?!$)/g, '$1-');

export type OfflineReset = { mfa: boolean; unlocked: boolean; apply(options?: { resetAuthenticator?: boolean }): Promise<{ password: string; mfaReset: boolean }>; close(): void };
/**
 * `askCode`: the key is locked for this computer user (another user, a reset Windows password, another computer): ask the
 * Merkez recovery code (`attempt` 1–3, `problem`: why the last one failed; null gives up). A right code opens the data and
 * locks the key again for this user, like the unlock screen. Without it a locked key is OfflineResetError('LOCKED').
 */
export type OfflineOptions = { protect: boolean; osLock?: MerkezLock; kdf?: KdfParams; now?: () => Date; askCode?: (attempt: number, problem?: string) => Promise<string | null> };
/** Opens the Merkez data folder for a reset (the server must be stopped). Call close() in every case. */
export async function openOfflineReset(directory: string, options: OfflineOptions = { protect: false }): Promise<OfflineReset> {
  const dir = resolve(directory), now = options.now ?? (() => new Date());
  if (!existsSync(join(dir, 'merkez.sqlite'))) throw new OfflineResetError('NO_DATA', `Bu klasörde Mola Merkez verisi yok: ${dir}. Mola Yönetim'in "veri" klasörünü verin.`);
  let release: () => void;
  try { release = dataLock(dir, 'merkez-sifre-sifirla'); }
  catch (error) {
    if (error instanceof Error && /kullanımda/.test(error.message)) throw new OfflineResetError('RUNNING', 'Mola Merkez şu anda çalışıyor. Önce durdurun (Mola Yönetim klasöründeki Merkez-Durdur.cmd), sonra yeniden deneyin.');
    throw error;
  }
  let store: MerkezStore | undefined, unlocked = false;
  try {
    // Opened as the server opens it, but never migrated here: a plain key stays plain, a protected one protected.
    const guard = await MerkezKeyGuard.open(dir, { protect: options.protect, osLock: options.osLock, migrate: false });
    const locked = `Merkez verileri bu kullanıcıyla açılamadı${guard.lockReason ? ` (${guard.lockReason})` : ''}. Komutu Mola Yönetim'i kuran ve kullanan bilgisayar kullanıcısıyla, Merkez'in kendi bilgisayarında çalıştırın ya da Merkez kurtarma kodunu girin.`;
    if (guard.state === 'locked' && !options.askCode) throw new OfflineResetError('LOCKED', locked);
    let problem: string | undefined;
    for (let attempt = 1; guard.state === 'locked' && attempt <= 3; attempt++) {
      const code = await options.askCode!(attempt, problem);
      if (code === null) break;
      try { await guard.unlock(code); unlocked = true; }
      catch (e) { if (e instanceof DomainError && ['WRONG_CODE', 'INVALID_CODE'].includes(e.code)) problem = e.message; else throw e; }
    }
    if (guard.state !== 'open' || !guard.key) throw new OfflineResetError('LOCKED', problem ? `${problem} Hiçbir şey değişmedi.` : locked);
    try { store = new MerkezStore(dir, guard.key); }
    catch { throw new OfflineResetError('LOCKED', 'Merkez verileri bu anahtarla açılamadı. Komutu Mola Yönetim\'in kendi bilgisayarında, onu kuran kullanıcıyla çalıştırın.'); }
  } catch (error) { try { store?.close(); } finally { release(); } throw error; }
  const opened = store!;
  let closed = false;
  return {
    mfa: !!opened.read().admin.mfa, unlocked,
    async apply({ resetAuthenticator = false } = {}) {
      const password = temporaryPassword(), record = await adminRecord(password), at = now().toISOString();
      let who = ''; try { who = userInfo().username; } catch { /* no name */ }
      const mfaReset = opened.mutate(d => {
        const mfa = d.admin.mfa, off = !!mfa && resetAuthenticator;
        d.admin = { ...record, mustChange: true, ...(mfa && !off ? { mfa } : {}) };
        d.audit.push({ action: 'admin.password_reset_offline', target: 'admin', at, by: 'system', detail: `Sifre-Sifirla komutu${who ? ` (bilgisayar kullanıcısı: ${who})` : ''}; geçici şifre ilk girişte değiştirilmeli` });
        if (off) d.audit.push({ action: 'admin.mfa_reset', target: 'admin', at, by: 'system', detail: 'Sifre-Sifirla komutunda doğrulayıcı da sıfırlandı' });
        addAlert(d, at, 'admin.password_reset', `Mola Yönetim yönetici şifresi Merkez'in bilgisayarında Sifre-Sifirla komutuyla geçici bir şifreye çevrildi${who ? ` (bilgisayar kullanıcısı: ${who})` : ''}. İlk girişte yeni şifre belirlenir.${off ? ' İki adımlı giriş de kapatıldı: Ayarlar → Hesap güvenliği’nden yeniden kurun.' : ''} Bunu siz yapmadıysanız hemen şifreyi değiştirin.`);
        return off;
      });
      // The first-login file holds an older generated password that no longer works: the desktop window must not show it.
      try { rmSync(join(dir, 'merkez-first-login.txt'), { force: true }); } catch { /* removed at the next change */ }
      return { password, mfaReset };
    },
    close() { if (closed) return; closed = true; try { opened.close(); } finally { release(); } },
  };
}

import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { dataLock } from '../data-lock.js';
import type { KdfParams } from '../key-vault.js';
import { addAlert } from './alerts.js';
import { besideData, MerkezBackups, MerkezRecovery } from './backup.js';
import { MerkezKeyGuard, type MerkezLock } from './key-guard.js';
import { OfflineResetError } from './offline-reset.js';
import { MerkezStore } from './store.js';

/*
 * "kurtarma-kodu.sh" (13 Ekim): a new Merkez recovery code on a server (VDS). Mola Yönetim shows and renews the code only on
 * the Merkez computer's own browser, and a public (HTTPS) Merkez has no such browser: there the vendor connects with SSH and
 * runs this command, Merkez stopped, as the user who owns the data (mola). The data opens exactly as the server opens it
 * (server/merkez/key-guard.ts; on a VDS the passphrase file). The new code is made and checked first; nothing is written
 * until the vendor typed parts of it back (commit). Then: merkez-kurtarma.json and the key file take the new block (the
 * old code opens neither any more), the backups this server keeps take it too (copies elsewhere: npm run vds:cek brings
 * the changed key files the next morning), and İşlem geçmişi + Bildirim merkezi record it. The code itself is only printed.
 */
export type OfflineRecovery = {
  /** The new code (not in effect yet). */
  code: string;
  /** Puts the new code in effect; returns how many backups now open with it. */
  commit(): Promise<{ rewrapped: number }>;
  close(): void;
};
export type OfflineRecoveryOptions = { protect: boolean; osLock?: MerkezLock; kdf?: KdfParams; backupDirectory?: string; now?: () => Date };

export async function openOfflineRecovery(directory: string, options: OfflineRecoveryOptions = { protect: false }): Promise<OfflineRecovery> {
  const dir = resolve(directory), now = options.now ?? (() => new Date());
  if (!existsSync(join(dir, 'merkez.sqlite'))) throw new OfflineResetError('NO_DATA', `Bu klasörde Mola Merkez verisi yok: ${dir}. Merkez'in "veri" klasörünü verin.`);
  let release: () => void;
  try { release = dataLock(dir, 'merkez-kurtarma-kodu'); }
  catch (error) {
    if (error instanceof Error && /kullanımda/.test(error.message)) throw new OfflineResetError('RUNNING', 'Mola Merkez şu anda çalışıyor. Önce durdurun: sudo systemctl stop mola-merkez');
    throw error;
  }
  let store: MerkezStore | undefined;
  try {
    const guard = await MerkezKeyGuard.open(dir, { protect: options.protect, osLock: options.osLock, migrate: false });
    if (guard.state !== 'open' || !guard.key) throw new OfflineResetError('LOCKED', `Merkez verileri bu kullanıcıyla açılamadı${guard.lockReason ? ` (${guard.lockReason})` : ''}. Komutu Merkez'in kullanıcısıyla çalıştırın: sudo -u mola /opt/mola-merkez/kurtarma-kodu.sh`);
    try { store = new MerkezStore(dir, guard.key); }
    catch { throw new OfflineResetError('LOCKED', 'Merkez verileri bu anahtarla açılamadı.'); }
    const recovery = await MerkezRecovery.open(dir, guard.key, options.kdf, { seed: guard.seed(), onChange: f => guard.syncRecovery(f) });
    const prepared = await recovery.prepare(), opened = store;
    let closed = false, done = false;
    return {
      code: prepared.code,
      async commit() {
        if (done) throw new Error('Kod zaten kaydedildi.');
        await prepared.commit();
        // The key file (anahtar.json) must carry the new block before anything else counts: checked through the lock.
        await guard.syncRecovery(recovery.file);
        done = true;
        const backups = new MerkezBackups(dir, { folder: options.backupDirectory ?? process.env.MERKEZ_BACKUP_DIR ?? besideData(dir, 'merkez-yedek'), checks: besideData(dir, 'merkez-yedek-prova'), settings: join(dir, 'merkez-yedek-ayar.json'), auto: false, protection: () => recovery.protection() });
        await backups.start();
        const rewrapped = await backups.rewrap(recovery.protection()).catch(() => 0);
        const at = now().toISOString();
        let who = ''; try { who = userInfo().username; } catch { /* no name */ }
        opened.mutate(d => {
          d.audit.push({ action: 'merkez.recovery_renewed', target: 'admin', at, by: 'system', detail: `Sunucuda kurtarma-kodu komutuyla${who ? ` (kullanıcı: ${who})` : ''}; ${rewrapped} yedek yeni kodla açılır` });
          addAlert(d, at, 'merkez.recovery', `Mola Merkez kurtarma kodu sunucuda kurtarma-kodu komutuyla yenilendi${who ? ` (kullanıcı: ${who})` : ''}. Eski kod artık açmaz; sunucudaki ${rewrapped} yedek yeni kodla açılır. Bunu siz yapmadıysanız hemen sunucunun erişimlerini kontrol edin.`);
        });
        return { rewrapped };
      },
      close() { if (closed) return; closed = true; try { opened.close(); } finally { release(); } },
    };
  } catch (error) { try { store?.close(); } finally { release(); } throw error; }
}

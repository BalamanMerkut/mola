import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from './api';
import { Modal } from './components';
import { ADMIN } from './platformStatus';

/** How Mola Merkez keeps its data key (server/merkez/key-guard.ts `KeyProtectionView`). */
export type KeyProtection = { wanted: boolean; mode: 'plain' | 'protected'; kind: 'dpapi' | 'keychain' | 'file' | 'parola' | null; protectsAtRest: boolean; waitingForCode: boolean; migratesAtNextStart: boolean; safetyCopy: boolean; warning: string | null };
export const lockNames: Record<string, string> = { dpapi: 'bu Windows kullanıcısına (Windows kilidi)', keychain: 'bu Mac’in anahtarlığına', parola: 'sunucunun parolasına (MERKEZ_KEY_PASSPHRASE)', file: 'dosyaya (yalnız dosya izniyle korunuyor)' };
/** One line for Ayarlar → Yedek. */
export function keyProtectionText(k: KeyProtection) {
  if (k.mode === 'protected') return `Veri anahtarı ${lockNames[k.kind ?? 'file']} ve Merkez kurtarma koduna kilitli.${k.safetyCopy ? ' Taşımadan kalan düz kopya bir sonraki açılışta silinecek.' : ''}`;
  if (!k.wanted) return 'Veri anahtarı düz dosyada (development.key; geliştirme ya da koruma kapalı).';
  if (k.waitingForCode) return 'Veri anahtarı henüz düz dosyada (development.key). Önce kurtarma kodunu kaydedin; sonraki açılışta Windows kullanıcınıza kilitlenir.';
  return 'Kurtarma kodu kaydedildi: veri anahtarı Mola Merkez’in bir sonraki açılışında Windows kullanıcınıza kilitlenecek.';
}
const SKIP = 'mola-yonetim-anahtar-karti';

/**
 * "Önce kurtarma kodunuzu kaydedin": the installed Mola Yönetim wants to lock its data key to the Windows user, but only
 * after the Merkez recovery code is saved (otherwise a reset Windows password would lose the signing key). Blocking but
 * skippable: "Sonra" hides it for this browser session; it comes back at the next sign-in until the code is confirmed.
 */
export function PlatformKeyCard({ onOpenBackup }: { onOpenBackup: () => void }) {
  const [key, setKey] = useState<KeyProtection | null>(null), [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(SKIP) === '1'; } catch { return false; } });
  useEffect(() => { if (!hidden) void api<{ keyProtection: KeyProtection | null }>(`${ADMIN}/backup`).then(r => setKey(r.keyProtection), () => {}); }, [hidden]);
  if (hidden || !key?.waitingForCode) return null;
  const skip = () => { try { sessionStorage.setItem(SKIP, '1'); } catch { /* shown again next time */ } setHidden(true); };
  return <Modal title="Önce kurtarma kodunuzu kaydedin" className="key-card-dialog" onClose={skip}>
    <div className="key-card">
      <p><ShieldCheck size={18} aria-hidden="true" /> Mola Yönetim, Merkez verilerinin anahtarını (lisansları imzalayan anahtar dahil) bu Windows kullanıcısına kilitleyecek. Bilgisayar ya da disk çalınırsa veriler okunamaz.</p>
      <p>Bundan önce <strong>Merkez kurtarma kodunu</strong> kaydetmelisiniz: Windows şifreniz sıfırlanırsa ya da yeni bilgisayara geçerseniz veriler yalnız bu kodla açılır. Kod kaydedilince anahtar Mola Merkez’in bir sonraki açılışında kilitlenir; veriler değişmez.</p>
      <div className="application-actions">
        <button type="button" className="btn primary small-btn" onClick={() => { skip(); onOpenBackup(); }}><KeyRound size={14} aria-hidden="true" />Kurtarma koduna git</button>
        <button type="button" className="btn secondary small-btn" onClick={skip}>Sonra</button>
      </div>
    </div>
  </Modal>;
}

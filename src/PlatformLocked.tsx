import { useEffect, useState } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import { api, ApiError } from './api';
import { Notice } from './components';
import { ADMIN, signInError } from './platformStatus';

type Lock = { locked: boolean; reason: string | null; local: boolean; kind: string };

/**
 * Mola Merkez started with its data key locked (server/merkez/locked.ts): the computer user's lock did not open it (another
 * Windows user, a reset Windows password, a new computer, a missing server passphrase). The Merkez recovery code (Ayarlar →
 * Yedek, 24 characters) opens it and Merkez locks it again for this user; then the full Mola Yönetim starts. Only on the
 * Merkez computer itself (on a VDS: through an SSH tunnel).
 */
export function PlatformLocked() {
  const [lock, setLock] = useState<Lock | null>(null), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState('');
  useEffect(() => { void api<Lock>(`${ADMIN}/lock`).then(setLock, e => setError(signInError(e))); }, []);
  /** The full Merkez answers once it is open: then the page starts again as the normal Mola Yönetim. */
  async function opened(message: string) {
    setInfo(message);
    for (let i = 0; i < 40; i++) {
      try { const h = await (await fetch('/api/merkez/v1/health', { cache: 'no-store' })).json() as { locked?: boolean }; if (!h.locked) break; } catch { /* starting */ }
      await new Promise(r => setTimeout(r, 250));
    }
    location.reload();
  }
  async function unlock() {
    if (busy || !code.trim()) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await api<{ ok: boolean; warning: string | null }>(`${ADMIN}/unlock`, { code: code.trim() });
      setCode('');
      await opened(r.warning ?? 'Kilit açıldı. Anahtar bu bilgisayar kullanıcısına yeniden kilitlendi; Mola Yönetim açılıyor…');
    } catch (e) { setError(e instanceof ApiError && e.code === 'WRONG_CODE' ? 'Kurtarma kodu yanlış. Kâğıttaki kodu harf harf kontrol edin.' : signInError(e)); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (busy) return;
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await api<{ ok: boolean; reason: string | null }>(`${ADMIN}/unlock/retry`, {});
      if (r.ok) await opened('Windows kilidi açıldı; Mola Yönetim açılıyor…');
      else setError(r.reason ?? 'Windows kilidi yine açılmadı. Kurtarma kodunu kullanın.');
    } catch (e) { setError(signInError(e)); } finally { setBusy(false); }
  }
  const remote = lock && !lock.local;
  return <form className="auth-form auth-locked" onSubmit={e => { e.preventDefault(); void unlock(); }}>
    <header className="auth-head"><h1><LockKeyhole size={22} aria-hidden="true" /> Veriler kilitli</h1>
      <p>Mola Merkez’in veri anahtarı bu bilgisayar kullanıcısıyla açılamadı: başka bir Windows kullanıcısı, sıfırlanan Windows şifresi ya da yeni bir bilgisayar. Merkez kurtarma kodunu girin; anahtar bu kullanıcıya yeniden kilitlenir ve Mola Yönetim açılır. Kafeler bu sırada lisans alamaz, kilit açılınca kendiliğinden bağlanır.</p></header>
    {lock?.reason && <p className="muted small">Neden: {lock.reason}</p>}
    {remote ? <Notice>Kilit yalnız Mola Merkez’in çalıştığı bilgisayardan açılır. Merkez bir sunucudaysa (VDS) SSH tüneliyle bağlanın (ssh -L 4000:127.0.0.1:4000 …) ve http://127.0.0.1:4000 adresini açın.</Notice> : <>
      <label>Merkez kurtarma kodu<input value={code} onChange={e => setCode(e.target.value)} required maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy || !lock} placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" autoFocus /></label>
      <p className="muted small">Ayarlar → Yedek’te gösterilen, yazdırdığınız ya da kopyaladığınız 24 harflik kod.</p>
    </>}
    <div className="auth-messages" aria-live="polite">{info && <Notice tone="success">{info}</Notice>}{error && <Notice tone="error">{error}</Notice>}</div>
    {!remote && <>
      <button className="btn primary auth-submit" disabled={busy || !lock || !code.trim()}>{busy ? 'Kod doğrulanıyor…' : 'Kilidi aç'}</button>
      <button type="button" className="text-btn" disabled={busy || !lock} onClick={() => void retry()}><RefreshCw size={15} aria-hidden="true" />Windows kilidini yeniden dene</button>
    </>}
    <p className="auth-dev">Kod da yoksa veriler açılamaz: kod hiçbir yerde saklanmaz. Eski Windows kullanıcısıyla oturum açabiliyorsanız Mola Yönetim’i o kullanıcıyla açın.</p>
  </form>;
}

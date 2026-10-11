import { useEffect, useState } from 'react';
import { Lock, LockOpen, RefreshCw } from 'lucide-react';
import { Brand, Notice } from './components';
import { HelpTip } from './HelpTip';
import { MolaContact } from './MolaContact';
import { desktopCall, desktopToken } from './desktop-call';
import './security.css';

export const LOCKED_EVENT = 'mola:locked';
/** Any API answer 423 ("Veriler kilitli") switches the whole page to the locked screen; no extra request on normal pages. */
export function useLocked() {
  const [locked, setLocked] = useState(false);
  useEffect(() => { const on = () => setLocked(true); window.addEventListener(LOCKED_EVENT, on); return () => window.removeEventListener(LOCKED_EVENT, on); }, []);
  return locked;
}

/**
 * The OS lock did not open the data key (Windows password reset, another user, data moved to another computer).
 * The café computer's own window unlocks with the recovery code; tablets, phones and guests only see a plain message.
 */
export function LockedScreen({ guest = false }: { guest?: boolean }) {
  const [token, setToken] = useState<string | null | undefined>(undefined), [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const stored = desktopToken();
    void (async () => {
      if (stored) { try { const s = await desktopCall<{ lockReason?: string | null }>(stored, '/api/desktop/status'); if (live) { setReason(s.lockReason ?? null); setToken(stored); } return; } catch { /* an old key */ } }
      try { const h = await (await fetch('/api/health')).json() as { desktop?: boolean }; if (live) setToken(h.desktop ? '' : null); } catch { if (live) setToken(null); }
    })();
    return () => { live = false; };
  }, []);
  return <main className="locked-screen" data-testid="locked-screen">
    <div className="locked-card">
      <Brand />
      <span className="locked-icon" aria-hidden="true"><Lock size={30} strokeWidth={1.6} /></span>
      {token === undefined ? <p className="muted">Yükleniyor…</p> : token === null ? <>
        <h1>{guest ? 'Menü şu anda açılamıyor' : 'Veriler kilitli'}</h1>
        <p>{guest ? 'Lütfen personele haber verin.' : 'Kasa bilgisayarında kilit açılmalı. Kilit açılınca bu ekran kendiliğinden yenilenir.'}</p>
        {!guest && <><WaitForUnlock /><MolaContact note="Kasa bilgisayarında kilit açılamıyorsa:" /></>}
      </> : <UnlockForm token={token} reason={reason} />}
    </div>
  </main>;
}

/** Tablets: look again every 20 seconds; once the café computer unlocks, reload into the normal screen. */
function WaitForUnlock() {
  useEffect(() => {
    const t = setInterval(() => { void fetch('/api/health').then(r => r.json()).then((h: { locked?: boolean }) => { if (!h.locked) location.reload(); }).catch(() => {}); }, 20000);
    return () => clearInterval(t);
  }, []);
  return null;
}

function UnlockForm({ token, reason }: { token: string; reason: string | null }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  async function unlock() {
    setBusy(true); setError('');
    try { await desktopCall(token, '/api/desktop/unlock', { code }); setDone(true); setCode(''); setTimeout(() => location.reload(), 1200); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function retry() {
    setBusy(true); setError('');
    try { const r = await desktopCall<{ ok: boolean }>(token, '/api/desktop/unlock/retry', {}); if (r.ok) { setDone(true); setTimeout(() => location.reload(), 800); } else { setError('Windows kilidi yine açmadı. Kurtarma kodunu girin.'); setBusy(false); } }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (done) return <><h1>Kilit açıldı</h1><Notice tone="success">Veriler açıldı ve bu bilgisayar için yeniden kilitlendi. Mola açılıyor…</Notice></>;
  return <>
    <h1>Veriler kilitli <HelpTip title="Neden kilitli?">Mola’nın anahtarı bu bilgisayarın Windows kullanıcısına kilitlidir. Windows şifresi sıfırlandıysa, başka kullanıcıyla girildiyse ya da veriler başka bilgisayara taşındıysa kilit açılmaz. Kurulumda yazdırdığınız kurtarma koduyla açın; Mola anahtarı bu kullanıcı için yeniden kilitler. Kod yoksa destekle görüşün: kod olmadan veriler açılamaz.</HelpTip></h1>
    <p>Bu bilgisayarın Windows kilidi Mola’nın verilerini açamadı. Kurulumda yazdırdığınız <strong>kurtarma kodunu</strong> girin.</p>
    {reason && <p className="muted small">{reason}</p>}
    <form onSubmit={e => { e.preventDefault(); void unlock(); }} className="locked-form">
      <label>Kurtarma kodu<input value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus /></label>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn primary" disabled={busy || code.replace(/[\s-]/g, '').length < 24}><LockOpen size={16} />{busy ? 'Açılıyor…' : 'Kilidi aç'}</button>
      <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void retry()}><RefreshCw size={15} />Windows kilidini yeniden dene</button>
    </form>
    {/* Shown when this computer kept the contact beside its data and the locked server serves it (/api/contact). */}
    <MolaContact title="Kurtarma kodunuz yok mu?" note="Kod olmadan veriler açılamaz; Mola ekibi size yol gösterir." />
  </>;
}

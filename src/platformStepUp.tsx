import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from './api';
import { Modal, Notice } from './components';
import { ADMIN } from './platformStatus';
import './platform-releases.css';

/*
 * Prices, packages and payments in Mola Yönetim need the same Authenticator step-up as Güncellemeler (server/merkez/step-up.ts,
 * 'sales'): one right code opens 10 minutes for this session, for both. A screen sends its change through `withStepUp`; when
 * the server answers STEP_UP_REQUIRED the code box opens over the screen ("“Değişikliği uygula” için onay"), the code goes to
 * the release route (/releases/yetki, same check, same window) and the change is sent again by itself. Without two-step login
 * (MFA_REQUIRED) the box says so with "İki adımlı doğrulamayı aç", like the Güncellemeler card. <StepUpDialog> lives once in
 * src/Platform.tsx, whose openSecurity goes to Hesap güvenliği even while the change is still being sent (it used to go
 * through `go`, which ignores clicks while busy, so the button did nothing for Hizmet and Lisans).
 */
type Ask = { label: string; blocked?: string; done: (ok: boolean) => void };
const EVENT = 'mola:yonetim-step-up';
export const STEP_UP_CANCELLED = 'İşlem yapılmadı: doğrulayıcı kodu girilmedi.';

/** Sends `send()`; asks for the Authenticator code when the server wants it, then sends once more. */
export async function withStepUp<T>(label: string, send: () => Promise<T>): Promise<T> {
  try { return await send(); }
  catch (e) {
    if (!(e instanceof ApiError) || !['STEP_UP_REQUIRED', 'MFA_REQUIRED'].includes(e.code)) throw e;
    const ok = await new Promise<boolean>(done => window.dispatchEvent(new CustomEvent<Ask>(EVENT, { detail: { label, done, ...(e.code === 'MFA_REQUIRED' ? { blocked: e.message } : {}) } })));
    if (!ok) throw e.code === 'MFA_REQUIRED' ? e : new ApiError(STEP_UP_CANCELLED, 403, 'STEP_UP_CANCELLED');
    return send();
  }
}

/** The code box over the screen (or, without two-step login, the way to Hesap güvenliği). */
export function StepUpDialog({ onSecurity }: { onSecurity?: (label: string) => void }) {
  const [ask, setAsk] = useState<Ask | null>(null), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), current = useRef<Ask | null>(null);
  current.current = ask;
  useEffect(() => {
    const open = (e: Event) => { current.current?.done(false); setAsk((e as CustomEvent<Ask>).detail); setCode(''); setError(''); setTimeout(() => input.current?.focus(), 0); };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  if (!ask) return null;
  const close = (ok: boolean) => { ask.done(ok); setAsk(null); setCode(''); setError(''); };
  async function confirm() {
    setBusy(true); setError('');
    try { await api(`${ADMIN}/releases/yetki`, { code }); close(true); }
    catch (e) {
      setCode('');
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') setAsk(a => a && { ...a, blocked: e.message });
      else setError((e as Error).message);
    } finally { setBusy(false); }
  }
  return <Modal title={ask.blocked ? 'İki adımlı doğrulama gerekli' : 'Doğrulayıcı kodu'} className="step-up-dialog" onClose={() => { if (!busy) close(false); }}>
    <div className="modal-body">
      {ask.blocked ? <div className="release-right blocked" role="region" aria-label="Doğrulayıcı onayı">
        <p><ShieldCheck size={16} aria-hidden="true" /> <b>{ask.blocked}</b> Fiyat, paket ve ödeme değişiklikleri, güncelleme yayını gibi doğrulayıcı uygulamanın koduyla onaylanır.</p>
        <div className="application-actions">
          {/* Goes to Ayarlar → Hesap güvenliği with the setup in front; Mola Yönetim brings the vendor back afterwards (src/Platform.tsx openSecurity). */}
          {onSecurity && <button type="button" className="btn primary small-btn" onClick={() => { const label = ask.label; close(false); onSecurity(label); }}><ShieldCheck size={16} aria-hidden="true" />İki adımlı doğrulamayı aç</button>}
          <button type="button" className="btn secondary small-btn" onClick={() => close(false)}>Kapat</button>
        </div>
      </div> : <form className="release-right" aria-label="Doğrulayıcı onayı" onSubmit={e => { e.preventDefault(); void confirm(); }}>
        <p><ShieldCheck size={16} aria-hidden="true" /> <b>“{ask.label}” için onay:</b> doğrulayıcı uygulamadaki (Authenticator) güncel 6 haneli kodu girin. Onay 10 dakika geçerli olur; bu sürede fiyat, paket, ödeme ve güncelleme işlemleri yeniden kod sormaz.</p>
        <div className="release-code">
          <input ref={input} aria-label="Doğrulayıcı kodu" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
          <button className="btn primary small-btn" disabled={busy || code.replace(/\s/g, '').length !== 6}>Onayla ve devam et</button>
          <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => close(false)}>Vazgeç</button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>}
    </div>
  </Modal>;
}

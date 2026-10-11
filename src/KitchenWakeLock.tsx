import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { HelpTip } from './HelpTip';
import { inMolaApp } from './molaApp';

export function KitchenWakeLock() {
  const supported = window.isSecureContext && !!navigator.wakeLock;
  // On by default so a forgotten tap never lets the kitchen tablet sleep through orders; an explicit "off" is remembered for the session.
  const [enabled, setEnabledState] = useState(() => { try { return sessionStorage.getItem('mola-kitchen-awake-off') !== '1'; } catch { return true; } });
  const setEnabled = (value: boolean) => { setEnabledState(value); try { if (value) sessionStorage.removeItem('mola-kitchen-awake-off'); else sessionStorage.setItem('mola-kitchen-awake-off', '1'); } catch { /* preference only */ } };
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'off' | 'pending' | 'active' | 'paused' | 'failed'>('off');
  useEffect(() => {
    if (!enabled || !supported) { setStatus('off'); return; }
    let live = true, pending = false, lock: WakeLockSentinel | null = null;
    const release = (item: WakeLockSentinel) => { void item.release().catch(() => {}); };
    const acquire = async () => {
      if (!live || pending || lock && !lock.released || document.visibilityState !== 'visible') return;
      pending = true; setStatus('pending');
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (!live || document.visibilityState !== 'visible') { release(acquired); return; }
        lock = acquired;
        acquired.addEventListener('release', () => {
          if (lock === acquired) { lock = null; if (live) setStatus('paused'); }
        }, { once: true });
        setStatus(acquired.released ? 'paused' : 'active');
      } catch { if (live) setStatus('failed'); }
      finally { pending = false; }
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void acquire();
      else { if (lock) { const previous = lock; lock = null; release(previous); } setStatus('paused'); }
    };
    void acquire(); document.addEventListener('visibilitychange', visibility);
    return () => { live = false; document.removeEventListener('visibilitychange', visibility); if (lock) release(lock); };
  }, [enabled, supported, attempt]);
  // The Android Mola app keeps the screen on by itself (FLAG_KEEP_SCREEN_ON); its WebView has no wake lock on plain http.
  if (!supported && inMolaApp()) return <div className="kitchen-awake">
    <button type="button" className="sound-icon sound-on" disabled aria-label="Ekran açık: Mola uygulaması" title="Ekran açık: Mola uygulaması" aria-pressed={true}><Monitor size={23} aria-hidden="true" /></button>
    <HelpTip title="Ekranı açık tut">Mola uygulaması açıkken tabletin ekranı kapanmaz. Tableti şarja takılı tutun.</HelpTip>
    <span className="kitchen-status-sr" role="status">Mola uygulaması ekranı açık tutuyor.</span>
  </div>;
  const active = status === 'active';
  const label = active ? 'Ekranı açık tutmayı kapat' : status === 'pending' ? 'Ekranı açık tutma isteğini iptal et' : 'Ekranı açık tut';
  const message = !supported ? 'Bu bağlantı veya tarayıcı desteklemiyor.' : status === 'failed' ? 'Etkinleşmedi; tekrar deneyin.' : status === 'paused' ? 'Durakladı; yeniden açabilirsiniz.' : active ? 'Mutfak ekrandayken etkin.' : status === 'pending' ? 'Etkinleştiriliyor.' : 'Şu anda kapalı.';
  return <div className="kitchen-awake">
    <button type="button" className={`sound-icon ${active ? 'sound-on' : ''} ${status === 'pending' || status === 'failed' || status === 'paused' ? 'sound-pending' : ''}`} disabled={!supported} aria-label={label} title={label} aria-pressed={active}
      onClick={() => { if (active || status === 'pending') setEnabled(false); else { setEnabled(true); setAttempt(value => value + 1); } }}><Monitor size={23} aria-hidden="true" /></button>
    <HelpTip title="Ekranı açık tut">{`${message} Tabletin ekranı uyursa yeni siparişler ekranda görünmez ve sipariş sesi çalmaz; siparişler kaybolmaz ama geç fark edilir. Bu simge açıkken mutfak ekranı görünür kaldıkça ekran kapanmaz. Tableti şarja takılı tutun; pil tasarrufu bunu durdurabilir.`}</HelpTip>
    <span className="kitchen-status-sr" role="status">{message}</span>
    {/* Said plainly on the screen itself, not only in the tip: a sleeping tablet means missed orders. */}
    {!active && status !== 'pending' && <p className="kitchen-awake-note">{supported ? 'Ekran açık tutulmuyor: tablet uyursa yeni sipariş görünmez, ses çalmaz.' : 'Bu tablet ekranı açık tutamıyor: ayarlardan ekran kapanma süresini uzatın.'}</p>}
  </div>;
}

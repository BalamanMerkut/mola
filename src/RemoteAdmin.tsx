import { lazy, useEffect, useId, useState, type FormEvent } from 'react';
import { DeferredPanel } from './DeferredPanel';
import { readPaired, type Paired } from './phoneVault';
import { openRemote, REMOTE_ENDED_EVENT, RemoteError, resumeRemote, type RemoteSession } from './remoteTransport';
import './remote-admin.css';

/*
 * "Kafeyi yönet" on Mola Merkez's /yonet page (the owner's paired device; server/remote-admin.ts). The device's keys come
 * from Raporlarım's own safe (src/phoneVault.ts, same origin). Every sign-in asks the owner's password and the 6-digit code;
 * then the café's usual screens (src/Workspace.tsx) run here with every request sealed through src/remoteTransport.ts.
 * When the session ends (Çıkış, "Bütün uzak oturumları kapat", 05:00, the device removed…) this page comes back with why.
 */
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })));
type Phase = 'checking' | 'https' | 'unpaired' | 'revoked' | 'login' | 'in';

export function RemoteShell() {
  const [phase, setPhase] = useState<Phase>('checking'), [paired, setPaired] = useState<Paired | null>(null);
  const [session, setSession] = useState<RemoteSession | null>(null), [notice, setNotice] = useState('');
  useEffect(() => {
    document.title = 'Kafeyi yönet · Mola';
    if (!window.isSecureContext || !globalThis.crypto?.subtle || !('indexedDB' in window)) { setPhase('https'); return; }
    void (async () => {
      let p: Paired | undefined; try { p = await readPaired(); } catch { p = undefined; }
      if (!p) { setPhase('unpaired'); return; }
      setPaired(p);
      const s = await resumeRemote(p);
      if (s) { setSession(s); setPhase('in'); } else setPhase('login');
    })();
  }, []);
  useEffect(() => {
    const off = (e: Event) => { setSession(null); setNotice(String((e as CustomEvent).detail ?? 'Uzak oturum kapandı.')); setPhase(p => p === 'in' ? 'login' : p); };
    window.addEventListener(REMOTE_ENDED_EVENT, off);
    return () => window.removeEventListener(REMOTE_ENDED_EVENT, off);
  }, []);
  if (phase === 'in' && session) return <>
    <div className="remote-pill" role="status" aria-label="Uzaktan yönetim">Uzaktan · uçtan uca şifreli</div>
    <DeferredPanel><Workspace key={session.sid} /></DeferredPanel>
  </>;
  return <div className="remote-page"><header className="remote-head"><span className="remote-logo" aria-hidden="true">M</span><div><strong>Kafeyi yönet</strong>{paired && <span>{paired.business}</span>}</div></header>
    <main>
      {phase === 'checking' && <p className="remote-muted" aria-busy="true">Açılıyor…</p>}
      {phase === 'https' && <section className="remote-card" role="alert"><h1>Bu sayfa burada açılamıyor</h1><p>Kafeyi yönet yalnız güvenli bağlantıyla (https://) ve güncel bir tarayıcıda açılır.</p></section>}
      {(phase === 'unpaired' || phase === 'revoked') && <section className="remote-card"><h1>{phase === 'revoked' ? 'Bu cihazın eşleşmesi kaldırıldı' : 'Bu cihaz eşleşmemiş'}</h1>
        <p>Kafeyi uzaktan yönetmek için önce bu cihazı eşleştirin: kafede <strong>Ayarlar → Uzaktan erişim</strong>’deki adımlar.</p>
        <a className="remote-link" href="/raporlarim">Raporlarım’a dön</a></section>}
      {phase === 'login' && paired && <Login paired={paired} notice={notice} onIn={s => { setNotice(''); setSession(s); setPhase('in'); }} onRevoked={() => setPhase('revoked')} />}
    </main>
    <footer className="remote-foot">Bütün istekler bu cihazla kafe bilgisayarı arasında şifrelenir. Mola Merkez yalnız iletir, okuyamaz.</footer>
  </div>;
}

function Login({ paired, notice, onIn, onRevoked }: { paired: Paired; notice: string; onIn: (s: RemoteSession) => void; onRevoked: () => void }) {
  const id = useId();
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const typed = password; setPassword('');
    try { const s = await openRemote(paired, typed, code); setCode(''); onIn(s); }
    catch (err) {
      setCode('');
      if (err instanceof RemoteError && ['PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(err.code)) { onRevoked(); return; }
      setError(err instanceof RemoteError ? err.message : 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.');
    } finally { setBusy(false); }
  }
  return <form className="remote-card remote-login" aria-label="Kafeyi yönet" onSubmit={e => void submit(e)}>
    <h1>Kafeyi yönet</h1>
    <p>Kafenin bütün ekranlarını bu cihazdan, işletme sahibi olarak açın. Her girişte şifreniz ve doğrulama uygulamanızdaki 6 haneli telefon kodu sorulur.</p>
    {notice && <p className="remote-note" role="status">{notice}</p>}
    {/* The last report from the café says it is off (0.1.21): where to turn it on, before a wasted try. */}
    {!notice && paired.last?.report.admin === 'off' && <p className="remote-note" role="status">Uzaktan yönetim kapalı. Kafedeyken <strong>Ayarlar → Uzaktan erişim → Uzaktan yönetim</strong>’den açın.</p>}
    <label htmlFor={`${id}-password`}>Şifreniz</label>
    <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
    <label htmlFor={`${id}-code`}>Telefon kodu</label>
    <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {error && <p className="remote-error" role="alert">{error}</p>}
    <button type="submit" className="remote-btn" disabled={busy || !password || code.length !== 6}>{busy ? 'Bağlanılıyor…' : 'Giriş yap'}</button>
    <p className="remote-muted">Uzaktan yönetim kafede Ayarlar → Uzaktan erişim → <strong>Uzaktan yönetim</strong>’den açılır. Yedekten geri yükleme, kurtarma kodu ve cihaz eşleştirme yalnız kafede yapılır.</p>
    <a className="remote-link" href="/raporlarim">Raporlarım’a dön</a>
  </form>;
}

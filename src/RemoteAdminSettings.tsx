import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Copy, Globe2, LockKeyhole } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { copyText } from './PermanentLink';
import { Card } from './SettingsKit';
import './remote-admin.css';

/*
 * Ayarlar → Uzaktan erişim → "5 · Uzaktan yönetim" (0.1.21; server/remote-admin.ts; the owner's own account). Off by default.
 * Turning it on asks the password and the 6-digit phone code, on a computer of the café only; turning it off works from
 * anywhere and ends every remote session. 0.1.23, very plain: the state in one line with Aç/Kapat, the Kafemi yönet address
 * once it is on, and the open remote sessions with "Bütün uzak oturumları kapat" only when there are any (the history stays
 * in the record and Mola Merkez's İşlem kayıtları).
 */
type Session = { id: string; device: string; startedAt: string; endedAt?: string; endedText: string | null };
type View = { on: boolean; since: string | null; code: boolean; activated: boolean; devices: string[]; active: { id: string; device: string; startedAt: string; current: boolean }[]; sessions: Session[]; remote: boolean };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function RemoteAdminSettings({ title = 'Uzaktan yönetim', address }: { title?: string; address?: string | null }) {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [asking, setAsking] = useState(false), [copied, setCopied] = useState(false);
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [hidden, setHidden] = useState(false);
  const load = useCallback(() => api<View>('/api/staff/remote-admin').then(v => { setView(v); setError(''); }).catch(e => { if ((e as { status?: number }).status === 403) setHidden(true); else setError((e as Error).message); }), []);
  useEffect(() => { void load(); }, [load]);
  async function send(body: unknown, path = '/api/staff/remote-admin') {
    setBusy(true); setError('');
    try { setView(await api<View>(path, body)); setAsking(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); setPassword(''); setCode(''); }
  }
  function turnOn(e: FormEvent) { e.preventDefault(); void send({ on: true, password, code }); }
  if (hidden) return null;
  return <Card icon={<Globe2 size={18} aria-hidden="true" />} title={title} className="remote-admin-settings"
    lead="Kafenin bütün ekranlarını eşleşmiş cihazınızdan her yerden açın.">
    {!view ? (error ? <Notice tone="error">{error}</Notice> : <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>) : <>
      {/* What keeps it closed is said in the status line itself; "Aç" shows only when it can open. */}
      <div className="settings-row"><div className="settings-row-copy"><div className="settings-row-title"><strong>Durum</strong></div><p role="status">{view.on ? `Açık${view.since ? ` · ${when(view.since)}'den beri` : ''}`
          : view.remote ? 'Kapalı.' : !view.code ? 'Kapalı. Açmak için önce 1. adımda telefon kodunu kurun.' : !view.activated ? 'Kapalı. Mola bu bilgisayarda etkinleştirilince açılabilir.' : 'Kapalı · uzaktan giriş yapılamaz.'}</p></div>
        <div className="settings-row-control">{view.on ? <button type="button" className="btn secondary" disabled={busy} onClick={() => void send({ on: false })}>Kapat</button>
          : !view.remote && view.code && view.activated && <button type="button" className="btn primary" disabled={busy || asking} onClick={() => { setAsking(true); setError(''); }}>Aç</button>}</div>
      </div>
      {view.on && address && <div className="remote-address"><strong className="remote-address-text">{address.replace(/^https?:\/\//, '')}</strong>
        <button type="button" className="btn secondary small-btn" onClick={() => setCopied(copyText(address))}><Copy size={14} aria-hidden="true" />{copied ? 'Kopyalandı' : 'Kopyala'}</button></div>}
      {asking && !view.on && <form className="remote-admin-form" aria-label="Uzaktan yönetimi aç" onSubmit={turnOn}>
        <label htmlFor={`${id}-password`}>Şifreniz</label>
        <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
        <label htmlFor={`${id}-code`}>Telefon kodu</label>
        <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <p className="settings-field-hint"><LockKeyhole size={13} aria-hidden="true" /> Güvenlik için şifrenizi ve doğrulama uygulamanızdaki kodu yazın.</p>
        <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !password || code.length !== 6}>{busy ? 'Doğrulanıyor…' : 'Uzaktan yönetimi aç'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => { setAsking(false); setPassword(''); setCode(''); }}>Vazgeç</button></div>
      </form>}
      {view.active.length > 0 && <>
        <ul className="remote-admin-list" aria-label="Açık uzak oturumlar">{view.active.map(a => <li key={a.id}><strong>{a.device}{a.current ? ' · bu oturum' : ''}</strong><span>Giriş: {when(a.startedAt)} · açık</span></li>)}</ul>
        <div className="settings-actions"><button type="button" className="btn danger" disabled={busy} onClick={() => void send({}, '/api/staff/remote-admin/end-all')}>Bütün uzak oturumları kapat</button></div>
      </>}
      {error && <Notice tone="error">{error}</Notice>}
    </>}
  </Card>;
}

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Globe2, LockKeyhole } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { Card } from './SettingsKit';
import './remote-admin.css';

/*
 * Ayarlar → Uzaktan erişim → "Uzaktan yönetim" (0.1.21; server/remote-admin.ts; the owner's own account). Off by default.
 * Turning it on asks the password and the 6-digit phone code, on a computer of the café only; turning it off works from
 * anywhere and ends every remote session. The list shows each remote session's device, start and end (no address), and
 * "Bütün uzak oturumları kapat".
 */
type Session = { id: string; device: string; startedAt: string; endedAt?: string; endedText: string | null };
type View = { on: boolean; since: string | null; code: boolean; activated: boolean; devices: string[]; active: { id: string; device: string; startedAt: string; current: boolean }[]; sessions: Session[]; remote: boolean };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function RemoteAdminSettings({ title = 'Uzaktan yönetim' }: { title?: string }) {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [asking, setAsking] = useState(false);
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
    lead="Eşleşmiş cihazınızdan (Raporlarım → “Kafeyi yönet”) Satış ve Raporlar, menü ve ayarları her yerden açın. Her girişte şifre ve telefon kodu sorulur; bağlantı uçtan uca şifrelidir.">
    {!view ? (error ? <Notice tone="error">{error}</Notice> : <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>) : <>
      {/* What keeps it closed is said in the status line itself; "Aç" shows only when it can open. */}
      <div className="settings-row"><div className="settings-row-copy"><div className="settings-row-title"><strong>Durum</strong></div><p role="status">{view.on ? `Açık${view.since ? ` · ${when(view.since)}'den beri` : ''}`
          : view.remote ? 'Kapalı.' : !view.code ? 'Kapalı. Açmak için önce 1. adımda telefon kodunu kurun.' : !view.activated ? 'Kapalı. Mola bu bilgisayarda etkinleştirilince açılabilir.' : 'Kapalı · uzaktan giriş yapılamaz.'}</p></div>
        <div className="settings-row-control">{view.on ? <button type="button" className="btn secondary" disabled={busy} onClick={() => void send({ on: false })}>Kapat</button>
          : !view.remote && view.code && view.activated && <button type="button" className="btn primary" disabled={busy || asking} onClick={() => { setAsking(true); setError(''); }}>Aç</button>}</div>
      </div>
      {view.remote && <p className="settings-field-hint">Bu ekranı uzaktan açtınız. Uzaktan yönetimi buradan kapatabilirsiniz; açmak yalnız kafedeki bilgisayardan olur.</p>}
      {asking && !view.on && <form className="remote-admin-form" aria-label="Uzaktan yönetimi aç" onSubmit={turnOn}>
        <label htmlFor={`${id}-password`}>Şifreniz</label>
        <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
        <label htmlFor={`${id}-code`}>Telefon kodu</label>
        <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <p className="settings-field-hint"><LockKeyhole size={13} aria-hidden="true" /> Güvenlik için şifrenizi ve doğrulama uygulamanızdaki kodu yazın.</p>
        <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !password || code.length !== 6}>{busy ? 'Doğrulanıyor…' : 'Uzaktan yönetimi aç'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => { setAsking(false); setPassword(''); setCode(''); }}>Vazgeç</button></div>
      </form>}
      {/* The devices themselves are listed in step 5 (this card's own list could lag behind a pairing made a moment ago). */}
      <p className="settings-field-hint">Her uzaktan girişte Bildirimler’e not düşer.</p>
      {view.active.length > 0 && <>
        <ul className="remote-admin-list" aria-label="Açık uzak oturumlar">{view.active.map(a => <li key={a.id}><strong>{a.device}{a.current ? ' · bu oturum' : ''}</strong><span>Giriş: {when(a.startedAt)} · açık</span></li>)}</ul>
        <div className="settings-actions"><button type="button" className="btn danger" disabled={busy} onClick={() => void send({}, '/api/staff/remote-admin/end-all')}>Bütün uzak oturumları kapat</button></div>
      </>}
      {view.sessions.some(s => s.endedAt) && <details><summary>Geçmiş uzak oturumlar</summary>
        <ul className="remote-admin-list">{view.sessions.filter(s => s.endedAt).map(s => <li key={s.id}><strong>{s.device}</strong><span>{when(s.startedAt)} → {when(s.endedAt!)}{s.endedText ? ` · ${s.endedText}` : ''}</span></li>)}</ul>
      </details>}
      {error && <Notice tone="error">{error}</Notice>}
    </>}
  </Card>;
}

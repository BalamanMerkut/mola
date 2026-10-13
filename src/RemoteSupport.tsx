import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Check, History, LifeBuoy, ListChecks, LockKeyhole, Unplug, X } from 'lucide-react';
import { saatEki } from '../packages/domain/saat-eki';
import { api } from './api';
import { Notice } from './components';
import { Card, Row, Toggle } from './SettingsKit';
import './remote-support.css';

/*
 * Destek → Uzaktan erişim (owner only): "Uzaktan destek izni" (the Mola team may open this café's screens, without money and
 * security; server/support-session.ts; turning it on asks the owner's password again, turning it off never does).
 * Everything the Mola team changes is listed here, with who connected when. "Raporlarım telefonda" (src/PhonePairing.tsx)
 * is in Ayarlar → Güvenlik ve yedek → Telefonum.
 */
type Session = { id: string; startedAt: string; endedAt?: string; endedBy?: 'owner' | 'vendor' | 'timeout' | 'restart' | 'off'; actions: number };
type View = { on: boolean; since: string | null; by: string | null; active: { since: string } | null; relay: { connected: boolean; error: string | null }; sessions: Session[]; log: { at: string; session: string; text: string }[]; can: string[]; cannot: string[] };
const time = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' });
const ended: Record<NonNullable<Session['endedBy']>, string> = { owner: 'siz kestiniz', vendor: 'Mola ekibi kapattı', timeout: '30 dakika işlem yapılmadı', restart: 'bilgisayar yeniden açıldı', off: 'izin kapatıldı' };

export function RemoteAccess() {
  return <div className="remote-access"><RemoteSupport /></div>;
}

function RemoteSupport() {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Turning it on asks the owner's password again (checked by the server in the same request); turning it off does not.
  const [asking, setAsking] = useState(false), [password, setPassword] = useState('');
  const load = useCallback(() => api<View>('/api/staff/remote-support').then(v => { setView(v); setError(''); }).catch(e => setError((e as Error).message)), []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(t); }, [load]);
  async function change(path: string, body: object) { setBusy(true); setError(''); try { setView(await api<View>(path, body)); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); } }
  async function allow(e: FormEvent) { e.preventDefault(); const typed = password; setPassword(''); if (await change('/api/staff/remote-support', { on: true, password: typed })) setAsking(false); }
  function toggle(on: boolean) { if (on) { setAsking(true); setPassword(''); setError(''); } else { setAsking(false); void change('/api/staff/remote-support', { on: false }); } }
  if (!view) return <Card icon={<LifeBuoy size={18} aria-hidden="true" />} title="Uzaktan destek izni">{error ? <Notice tone="error">{error}</Notice> : <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>}</Card>;
  const state = view.on ? view.active ? `Açık · Mola ekibi şu an bağlı (${saatEki(time(view.active.since), 'den')} beri)` : 'Açık · Mola ekibi bağlanabilir' : 'Kapalı · Mola ekibi bağlanamaz';
  return <>
    <Card icon={<LifeBuoy size={18} aria-hidden="true" />} title="Uzaktan destek izni" className="remote-support-card"
      lead="Açıkken Mola ekibi, sizi arayıp sorununuzu çözmek için bu kafenin ekranlarını internet üzerinden açabilir. Siz kapatana kadar açık kalır.">
      <Row id={`${id}-on`} label="Mola ekibi bağlanabilsin" line={state}>
        <Toggle id={`${id}-on`} checked={view.on} disabled={busy} onChange={toggle} />
      </Row>
      {asking && !view.on && <form className="reauth-ask" aria-label="Uzaktan destek iznini aç" onSubmit={e => void allow(e)}>
        <label htmlFor={`${id}-password`}>Şifreniz</label>
        <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoFocus autoComplete="current-password" disabled={busy} aria-describedby={`${id}-why`} onChange={e => setPassword(e.target.value)} />
        <p id={`${id}-why`} className="settings-field-hint"><LockKeyhole size={13} aria-hidden="true" /> İzni açmak için giriş şifrenizi yeniden yazın. Kapatmak için şifre gerekmez.</p>
        <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !password}>{busy ? 'Doğrulanıyor…' : 'İzni aç'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => { setAsking(false); setPassword(''); setError(''); }}>Vazgeç</button></div>
      </form>}
      {view.active && <div className="remote-live" role="status"><span className="remote-live-dot" aria-hidden="true" /><p><strong>Mola ekibi bağlı.</strong> Bütün ekranlarda üstte “Mola ekibi bağlı” yazar.</p><button type="button" className="btn secondary" disabled={busy} onClick={() => void change('/api/staff/remote-support/end', {})}><Unplug size={16} aria-hidden="true" />Bağlantıyı kes</button></div>}
      {view.on && !view.relay.connected && <p className="settings-field-hint">{view.relay.error ? `Mola Merkez’e ulaşılamıyor: ${view.relay.error}` : 'Mola Merkez’e bağlanılıyor…'}</p>}
      <div className="remote-rules">
        <div><h4>Mola ekibi yapabilir</h4><ul>{view.can.map(t => <li key={t}><Check size={14} aria-hidden="true" />{t}</li>)}</ul></div>
        <div><h4>Mola ekibi göremez</h4><ul>{view.cannot.map(t => <li key={t}><X size={14} aria-hidden="true" />{t}</li>)}</ul></div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
    <Card icon={<History size={18} aria-hidden="true" />} title="Kim ne zaman bağlandı" className="remote-history">
      {view.sessions.length ? <ul className="remote-sessions">{view.sessions.map(s => <li key={s.id}><strong>{day(s.startedAt)} · {time(s.startedAt)}{s.endedAt ? `–${time(s.endedAt)}` : ' · şu an bağlı'}</strong><span>Mola ekibi{s.endedBy ? ` · ${ended[s.endedBy]}` : ''} · {s.actions ? `${s.actions} değişiklik` : 'değişiklik yok'}</span></li>)}</ul>
        : <p className="settings-card-note">Mola ekibi henüz bağlanmadı.</p>}
    </Card>
    {view.log.length > 0 && <Card icon={<ListChecks size={18} aria-hidden="true" />} title="Mola ekibinin yaptıkları" className="remote-log">
      <ul className="remote-log-list">{view.log.map((l, i) => <li key={`${l.at}-${i}`}><time dateTime={l.at}>{day(l.at)} {time(l.at)}</time><span>{l.session ? 'Mola destek: ' : ''}{l.text}</span></li>)}</ul>
    </Card>}
  </>;
}

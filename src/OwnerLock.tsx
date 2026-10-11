import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Lock, LockOpen, LogOut } from 'lucide-react';
import { api } from './api';
import { noteInput, SESSION_LOCK_EVENT } from './activity';
import { Notice } from './components';
import { Card, Row } from './SettingsKit';
import './owner-lock.css';

/*
 * Sahip hesabı otomatik kilit (server/owner-lock.ts). The server locks an owner session after N minutes without the person's
 * activity (or at once on "Kilitle"); every answer then carries `X-Mola-Locked` (src/api.ts raises SESSION_LOCK_EVENT) and
 * this screen covers the page: "Sahip hesabı kilitlendi · devam etmek için şifrenizi girin". The page underneath stays as it
 * was (no logout, drafts and open windows kept) but is inert and fully covered; the floor keeps polling and ringing.
 */
type LockView = { locked: boolean; minutes: number; choices: number[] };
const ACTIVITY_PING_MS = 30_000;

/** "Kilitle": locks this owner session now. */
export async function lockNow() {
  try { await api('/api/staff/lock', {}); } catch { /* the screen covers the page anyway; the server answers 423 later */ }
  window.dispatchEvent(new Event(SESSION_LOCK_EVENT));
}

/** Mounted once for the owner (src/Workspace.tsx). */
export function OwnerLock({ name, onLogout }: { name?: string; onLogout: () => void }) {
  const [locked, setLocked] = useState(false), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const id = useId(), lockedRef = useRef(false);
  lockedRef.current = locked;
  useEffect(() => {
    const on = () => setLocked(true);
    window.addEventListener(SESSION_LOCK_EVENT, on);
    void api<LockView>('/api/staff/lock').then(v => { if (v.locked) setLocked(true); }).catch(() => {});
    return () => window.removeEventListener(SESSION_LOCK_EVENT, on);
  }, []);
  // Reading without any other request still counts: a tap or key sends a small "activity" at most every 30 s.
  useEffect(() => {
    let last = 0;
    const ping = () => { if (lockedRef.current) return; const t = Date.now(); if (t - last < ACTIVITY_PING_MS && t >= last) return; last = t; noteInput(); void api('/api/staff/activity', {}).catch(() => {}); };
    const types = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const type of types) window.addEventListener(type, ping, { passive: true });
    return () => { for (const type of types) window.removeEventListener(type, ping); };
  }, []);
  // While locked: unlocked from another tab of this browser? (the same session)
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => { if (!document.hidden) void api<LockView>('/api/staff/lock').then(v => { if (!v.locked) { setLocked(false); setPassword(''); setError(''); } }).catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [locked]);
  // The page underneath: covered, and out of reach of the keyboard and screen readers.
  useEffect(() => {
    const page = document.querySelector('.workspace');
    if (!locked || !page) return;
    page.setAttribute('inert', ''); page.setAttribute('aria-hidden', 'true');
    return () => { page.removeAttribute('inert'); page.removeAttribute('aria-hidden'); };
  }, [locked]);
  async function unlock(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const typed = password; setPassword('');
    try { const v = await api<LockView>('/api/staff/unlock', { password: typed }); if (!v.locked) setLocked(false); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if (!locked) return null;
  return createPortal(<LockLayer labelledBy={`${id}-title`}>
    <form className="owner-lock-card" onSubmit={e => void unlock(e)}>
      <span className="owner-lock-icon" aria-hidden="true"><Lock size={28} strokeWidth={1.7} /></span>
      <h1 id={`${id}-title`}>Sahip hesabı kilitlendi</h1>
      <p>Devam etmek için şifrenizi girin.</p>
      {name && <p className="owner-lock-who">Hesap: <strong>{name}</strong></p>}
      <label htmlFor={`${id}-password`}>Şifreniz</label>
      <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoFocus autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
      {error && <Notice tone="error">{error}</Notice>}
      <button type="submit" className="btn primary" disabled={busy || !password}><LockOpen size={16} aria-hidden="true" />{busy ? 'Açılıyor…' : 'Kilidi aç'}</button>
      <p className="owner-lock-note">Açık sayfanız ve yazdıklarınız olduğu gibi duruyor. Siparişler gelmeye ve sesler çalmaya devam eder.</p>
      <button type="button" className="text-btn owner-lock-logout" onClick={onLogout}><LogOut size={15} aria-hidden="true" />Çıkış yap</button>
    </form>
  </LockLayer>, document.body);
}
/**
 * The lock screen is a modal <dialog> of its own, outside the (inert) page: the browser's top layer puts it above every window
 * already open on the page (an open window would otherwise sit over a plain fixed layer, its buttons inert and the lock form
 * under it out of reach: the agreement window on 8 Ekim). A window opened while locked goes under it again. Esc does nothing.
 */
function LockLayer({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!, raise = () => { try { if (d.open) d.close(); d.showModal(); } catch { /* not in the document */ } };
    raise();
    const watch = new MutationObserver(list => { if (list.some(m => m.target !== d && m.target instanceof HTMLDialogElement && m.target.open)) raise(); });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => { watch.disconnect(); d.close(); };
  }, []);
  return <dialog ref={ref} className="owner-lock" aria-labelledby={labelledBy} onCancel={e => e.preventDefault()}>{children}</dialog>;
}

const label = (m: number) => m ? `${m} dakika` : 'Kapalı';
/** Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme: "Sahip hesabı otomatik kilit". */
export function OwnerLockSettings() {
  const id = useId();
  const [view, setView] = useState<LockView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => { void api<LockView>('/api/staff/lock').then(setView).catch(e => setError((e as Error).message)); }, []);
  async function choose(minutes: number) {
    setBusy(true); setError(''); setSaved(false);
    try { setView(await api<LockView>('/api/staff/lock/settings', { minutes })); setSaved(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Card icon={<Lock size={18} aria-hidden="true" />} title="Sahip hesabı otomatik kilit" className="owner-lock-settings"
    lead="İşletme sahibi hesabıyla açık ekran bir süre kullanılmazsa kilitlenir; devam etmek için şifreniz sorulur. Açık sayfa ve yazdıklarınız kaybolmaz, siparişler ve sesler sürer. Müdür, kasiyer, garson ve mutfak hesapları kilitlenmez.">
    {!view ? (error ? <Notice tone="error">{error}</Notice> : <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>) : <>
      <Row id={`${id}-minutes`} label="Kullanılmazsa kilitle" line={view.minutes ? `${view.minutes} dakika işlem yapılmazsa ekran kilitlenir.` : 'Kapalı · ekran kendiliğinden kilitlenmez.'}>
        <select id={`${id}-minutes`} value={view.minutes} disabled={busy} onChange={e => void choose(Number(e.target.value))}>
          {view.choices.map(m => <option key={m} value={m}>{label(m)}</option>)}
        </select>
      </Row>
      <p className="settings-field-hint">Hemen kilitlemek için sol alttaki kilit düğmesine ya da Hesabım → <strong>Kilitle</strong>’ye basın.</p>
      {saved && <p className="settings-field-hint" role="status">Kaydedildi.</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </>}
  </Card>;
}

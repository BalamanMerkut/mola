import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BellRing, Check, Megaphone, MessageSquarePlus } from 'lucide-react';
import { linkParts } from '../packages/domain/announcement';
import { api } from './api';
import { Modal, Notice } from './components';
import './announcements.css';

/*
 * Duyurular from the Mola team (Mola Yönetim → Duyurular; server/merkez/announcements.ts, server/kafe-link.ts). The owner sees
 * them in Destek → Duyurular, the Müdür under "Duyurular" in the menu; both get a red dot while one is unread. An Önemli one
 * opens a window for the owner after signing in (and at the next look while signed in) until "Okudum"; it never covers
 * anyone else's screen and never waits on orders, payments or the kitchen.
 */
export type AnnouncementItem = { id: string; title: string; text: string; important: boolean; sentAt: string; editedAt?: string; read: boolean; acknowledged: boolean };
export type AnnouncementState = { items: AnnouncementItem[]; unread: number; pending: AnnouncementItem | null };
const CHANGED = 'mola:announcements';
const changed = () => window.dispatchEvent(new Event(CHANGED));
export const announcementDay = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The owner's and the Müdür's announcements; asks every 15 s while the page is visible, on return and after a change here. */
export function useAnnouncements(enabled: boolean) {
  const [state, setState] = useState<AnnouncementState | null>(null);
  useEffect(() => {
    if (!enabled) { setState(null); return; }
    let live = true;
    const read = () => { if (document.hidden) return; api<AnnouncementState>('/api/staff/announcements').then(s => { if (live) setState(s); }).catch(() => { /* the next look tries again */ }); };
    read();
    const timer = setInterval(read, 15000);
    window.addEventListener(CHANGED, read); document.addEventListener('visibilitychange', read);
    return () => { live = false; clearInterval(timer); window.removeEventListener(CHANGED, read); document.removeEventListener('visibilitychange', read); };
  }, [enabled]);
  return state;
}

/** Plain text with its own lines; web addresses become links (opened in a new tab, nothing else is HTML). */
export function AnnouncementText({ text }: { text: string }) {
  return <p className="announcement-text">{linkParts(text).map((p, i) => p.href ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a> : <span key={i}>{p.text}</span>)}</p>;
}
/** One announcement as the café shows it (Mola Yönetim's preview uses the same card). */
export function AnnouncementCard({ item, unread = false, actions, as: Tag = 'article' }: { item: Pick<AnnouncementItem, 'title' | 'text' | 'important' | 'sentAt' | 'editedAt'>; unread?: boolean; actions?: ReactNode; as?: 'article' | 'div' }) {
  return <Tag className={`announcement-card${item.important ? ' important' : ''}${unread ? ' unread' : ''}`} aria-label={item.title}>
    <header className="announcement-head">
      <span className="announcement-icon" aria-hidden="true">{item.important ? <BellRing size={19} /> : <Megaphone size={19} />}</span>
      <div className="announcement-title">
        <h3>{item.title}</h3>
        <p className="announcement-meta"><span>Mola ekibi · {announcementDay(item.sentAt)}</span>{item.editedAt && <span className="announcement-edited" title={`Düzenlendi: ${announcementDay(item.editedAt)}`}>düzenlendi</span>}</p>
      </div>
      <span className="announcement-chips">{item.important && <span className="announcement-chip">Önemli</span>}{unread && <span className="announcement-new">Yeni</span>}</span>
    </header>
    <AnnouncementText text={item.text} />
    {actions && <div className="announcement-actions">{actions}</div>}
  </Tag>;
}

/**
 * Destek → Duyurular (owner) and the Müdür's "Duyurular": newest first. What is on the screen counts as read for this account
 * (the business's first reader tells Mola). The owner can write to the Mola team about one ("Bu konuda Mola ekibine yaz"
 * opens a new ticket with it filled in) and says "Okudum" on an Önemli one.
 */
export function AnnouncementList({ owner, onWrite }: { owner: boolean; onWrite?: (draft: { subject: string; text: string }) => void }) {
  const [state, setState] = useState<AnnouncementState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  // Unread when the list was first shown: the "Yeni" mark stays for this visit even after it was sent as read.
  const fresh = useRef<Set<string> | null>(null);
  const load = useCallback(async () => { try { setState(await api<AnnouncementState>('/api/staff/announcements')); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!state) return;
    fresh.current ??= new Set(state.items.filter(a => !a.read).map(a => a.id));
    const unread = state.items.filter(a => !a.read).map(a => a.id);
    if (!unread.length) return;
    for (const id of unread) fresh.current.add(id);
    void api<AnnouncementState>('/api/staff/announcements/read', { ids: unread }).then(s => { setState(s); changed(); }).catch(() => { /* marked at the next look */ });
  }, [state]);
  async function acknowledge(id: string) {
    setBusy(id); setError('');
    try { setState(await api<AnnouncementState>('/api/staff/announcements/ack', { id })); changed(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  return <section className="panel announcement-list" aria-label="Duyurular">
    <div className="notification-head"><div><h2>Mola ekibinden duyurular</h2><p className="muted small">Yeni özellikler, bakım saatleri ve önemli bilgiler burada. Sorunuz olursa duyurunun altından bize yazabilirsiniz.</p></div></div>
    {error && <Notice tone="error">{error}</Notice>}
    {!state && !error ? <p className="muted" role="status">Duyurular yükleniyor…</p>
      : !state?.items.length ? <div className="notification-empty"><Megaphone size={30} strokeWidth={1.4} aria-hidden="true" /><p>Henüz duyuru yok.</p><span className="muted small">Mola ekibi bir duyuru gönderdiğinde burada görünür.</span></div>
      : <div className="announcement-items">{state.items.map(a => <AnnouncementCard key={a.id} item={a} unread={!!fresh.current?.has(a.id)} actions={<>
        {owner && a.important && !a.acknowledged && <button type="button" className="btn primary" disabled={busy === a.id} onClick={() => void acknowledge(a.id)}><Check size={17} aria-hidden="true" />Okudum</button>}
        {owner && a.important && a.acknowledged && <span className="announcement-done"><Check size={15} aria-hidden="true" />Okudunuz</span>}
        {owner && onWrite && <button type="button" className="btn secondary" onClick={() => onWrite(announcementDraft(a))}><MessageSquarePlus size={17} aria-hidden="true" />Bu konuda Mola ekibine yaz</button>}
      </>} />)}</div>}
  </section>;
}
/** The new ticket "Bu konuda Mola ekibine yaz" opens: the subject names the announcement, the owner writes the rest. */
export const announcementDraft = (a: Pick<AnnouncementItem, 'title' | 'sentAt'>) => ({ subject: `Duyuru: ${a.title}`.slice(0, 120), text: `“${a.title}” duyurusu hakkında (${announcementDay(a.sentAt)}):\n\n` });

/**
 * The owner's window for an Önemli announcement: centred, after signing in, and at the next look while signed in. "Okudum"
 * says it was read (Mola sees it); "Daha sonra" closes it until the next sign-in. Nothing else waits on it.
 */
export function ImportantAnnouncement({ state, onOpenList }: { state: AnnouncementState | null; onOpenList: () => void }) {
  const [later, setLater] = useState<Set<string>>(() => new Set()), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const item = state?.pending && !later.has(state.pending.id) ? state.pending : null;
  if (!item) return null;
  const close = () => setLater(s => new Set([...s, item.id]));
  async function acknowledge() {
    setBusy(true); setError('');
    try { await api('/api/staff/announcements/ack', { id: item!.id }); changed(); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Mola ekibinden önemli duyuru" className="announcement-dialog" onClose={close}>
    <div className="modal-body">
      <AnnouncementCard as="div" item={item} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions announcement-dialog-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { close(); onOpenList(); }}>Duyurulara git</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={close}>Daha sonra</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void acknowledge()}><Check size={17} aria-hidden="true" />{busy ? 'Kaydediliyor…' : 'Okudum'}</button>
      </div>
    </div>
  </Modal>;
}

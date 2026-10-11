import { useEffect, useRef, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { importantNotification } from './notificationActions';
import type { RecentNotification } from './notificationCount';
import { alertMemory, playEvent, soundChoice } from './sounds';
import './notification-toasts.css';

/** A toast hides after this long (unless it is an important one, or the pointer or focus is on it). */
export const TOAST_MS = 6000;
const MAX_TOASTS = 2;

/*
 * A new notification while Mola is open (10 Ekim, sahibin onayı): a small card in the top corner, under the bell, with its
 * title, one line and "Aç" (its place, as in Bildirimler). Important ones (a refund request, a cash difference, licence and
 * backup problems: src/notificationActions.ts importantNotification) stay until closed; the rest hide after 6 seconds. At
 * most two at a time, newest first. What was already there when the screen opened never pops up (no flood after signing in):
 * the first look only notes it, for the whole page visit of this person (alertMemory, like the floor's sounds). The roles
 * are the bell's: the owner, and the Müdür with campaign notifications only (the server sends only those). "Bildirim sesi"
 * (Ayarlar → Cihazlar → Sesler, off until switched on) plays with each new one; browsers allow sound only after a tap.
 */
export function NotificationToasts({ recent, memory, onOpen }: { recent?: RecentNotification[]; memory: string; onOpen: (n: RecentNotification) => void }) {
  const [toasts, setToasts] = useState<RecentNotification[]>([]);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    // The sound's context opens with the first tap or key while the sound is on (most cafés leave it off: no context at all).
    const unlock = () => {
      if (!soundChoice('notification').on) return;
      try { audio.current ??= new AudioContext(); if (audio.current.state !== 'running') void audio.current.resume().catch(() => {}); } catch { /* sound is optional */ }
    };
    document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock);
    return () => { document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); void audio.current?.close().catch(() => {}); audio.current = null; };
  }, []);
  useEffect(() => {
    if (!recent) return;
    const m = alertMemory(memory), fresh = m.first ? [] : recent.filter(n => !m.seen.has(n.id));
    for (const n of recent) m.seen.add(n.id);
    // A notification read meanwhile (Bildirimler, another device) leaves; new ones come on top.
    setToasts(list => { const still = list.filter(t => recent.some(r => r.id === t.id) && !fresh.some(f => f.id === t.id)); return fresh.length || still.length !== list.length ? [...fresh, ...still].slice(0, MAX_TOASTS) : list; });
    if (fresh.length && audio.current?.state === 'running') playEvent(audio.current, 'notification');
  }, [recent, memory]);
  const close = (id: string) => setToasts(list => list.filter(t => t.id !== id));
  return <div className="note-toasts" aria-live="polite" aria-relevant="additions">
    {toasts.map(n => <NoteToast key={n.id} n={n} onClose={() => close(n.id)} onOpen={() => { close(n.id); onOpen(n); }} />)}
  </div>;
}

function NoteToast({ n, onClose, onOpen }: { n: RecentNotification; onClose: () => void; onOpen: () => void }) {
  const important = importantNotification(n), [hold, setHold] = useState(false);
  const done = useRef(onClose); done.current = onClose;
  useEffect(() => { if (important || hold) return; const t = setTimeout(() => done.current(), TOAST_MS); return () => clearTimeout(t); }, [important, hold]);
  return <div className={`note-toast${important ? ' important' : ''}`} data-testid="notification-toast" data-important={important ? 'yes' : 'no'}
    onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
    <span className="note-toast-icon" aria-hidden="true"><BellRing size={16} /></span>
    <div className="note-toast-text"><strong>{n.title}</strong><span title={n.text}>{n.text}</span></div>
    <div className="note-toast-actions">
      <button type="button" className="btn primary" aria-label={`Aç: ${n.title}`} onClick={onOpen}>Aç</button>
      <button type="button" className="icon-btn" aria-label="Bildirimi kapat" onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </div>
  </div>;
}

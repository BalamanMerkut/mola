import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BellRing, ChevronDown, ChevronUp, Clock, Pencil, Plus, Trash } from 'lucide-react';
import { istanbulDay, longDay, monthGrid, REMINDER_OFFSETS, reminderText, shiftMonth, WEEKDAYS, type AgendaNote, type ReminderOffset } from '../packages/domain/agenda';
import { api } from './api';
import { Modal, Notice } from './components';
import { notificationsChanged } from './notificationCount';
import { TimeField } from './TimeField';
import './agenda.css';

/** Notes between two days (inclusive); `reload` after a change. */
export function useAgendaNotes(from: string | null, to: string | null) {
  const [notes, setNotes] = useState<AgendaNote[] | null>(null), [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!from || !to) return;
    let live = true; setError('');
    api<{ notes: AgendaNote[] }>(`/api/staff/agenda?from=${from}&to=${to}`).then(r => { if (live) setNotes(r.notes); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [from, to, version]);
  return { notes, error, reload: useCallback(() => setVersion(v => v + 1), []) };
}

type Draft = { id?: string; title: string; text: string; time: string; reminder: '' | ReminderOffset; reminderTime: string; kind: AgendaNote['kind'] };
const draftOf = (note?: AgendaNote, kind: AgendaNote['kind'] = 'agenda'): Draft => ({ id: note?.id, title: note?.title ?? '', text: note?.text ?? '', time: note?.time ?? '', reminder: note?.reminder?.offset ?? '', reminderTime: note?.reminder?.time ?? note?.time ?? '09:00', kind: note?.kind ?? kind });

/**
 * Writes or edits one note of a day. `simple`: only the text (the "Satış notu" of the daily sales chart).
 */
export function NoteForm({ day, note, kind = 'agenda', simple = false, onSaved, onCancel }: { day: string; note?: AgendaNote; kind?: AgendaNote['kind']; simple?: boolean; onSaved: (note: AgendaNote) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(note, kind)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  const set = (patch: Partial<Draft>) => setD(v => ({ ...v, ...patch }));
  const empty = !d.title.trim() && !d.text.trim();
  async function save() {
    if (busy || empty) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ note: AgendaNote }>('/api/staff/agenda', { ...(d.id ? { id: d.id } : {}), day, kind: d.kind, title: d.title.trim(), text: d.text.trim(), time: d.time || null, reminder: d.reminder ? { offset: d.reminder, time: d.reminderTime || '09:00' } : null });
      if (r.note.reminder) notificationsChanged();
      onSaved(r.note);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form className="agenda-form" onSubmit={e => { e.preventDefault(); void save(); }} aria-label={note ? 'Notu düzenle' : 'Yeni not'}>
    {!simple && <label>Başlık<input ref={first} aria-label="Başlık" maxLength={80} value={d.title} placeholder="Ör. Cumartesi düğün yemeği" onChange={e => set({ title: e.target.value })} /></label>}
    <label>{simple ? 'Bu günün notu' : 'Not'}<textarea ref={simple ? first : undefined} aria-label={simple ? 'Bu günün notu' : 'Not'} maxLength={1000} rows={simple ? 3 : 4} value={d.text} placeholder={simple ? 'Ör. Kampanya bugün satışları bayağı artırdı' : 'Ör. Salon kapalı, 80 kişi'} onChange={e => set({ text: e.target.value })} /></label>
    {!simple && <div className="agenda-form-row">
      <label>Saat <small>(isteğe bağlı)</small><TimeField aria-label="Saat" value={d.time} onChange={time => set({ time })} /></label>
      <label>Hatırlatıcı<select aria-label="Hatırlatıcı" value={d.reminder} onChange={e => set({ reminder: e.target.value as Draft['reminder'] })}><option value="">Hatırlatma yok</option>{(Object.keys(REMINDER_OFFSETS) as ReminderOffset[]).map(k => <option key={k} value={k}>{REMINDER_OFFSETS[k]}</option>)}</select></label>
      {d.reminder && <label>Hatırlatma saati<TimeField aria-label="Hatırlatma saati" required value={d.reminderTime} onChange={reminderTime => set({ reminderTime })} /></label>}
    </div>}
    {d.reminder && <p className="muted small agenda-form-hint">Hatırlatma zamanı gelince Bildirimler'e düşer ve üst çubuktaki zilde kırmızı nokta çıkar.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="agenda-form-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Vazgeç</button><button className="btn primary" disabled={busy || empty}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
  </form>;
}

/** Asks once before a note is deleted. */
export function DeleteNote({ note, onClose, onDeleted }: { note: AgendaNote; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function remove() { setBusy(true); setError(''); try { await api('/api/staff/agenda/delete', { id: note.id }); onDeleted(); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return <Modal title="Not silinsin mi?" onClose={onClose} dismissible={!busy}><div className="modal-body agenda-delete"><p><strong>{note.title || note.text.slice(0, 60)}</strong><br /><span className="muted">{longDay(note.day)}</span></p><p className="muted small">Silinen not geri getirilemez.</p>{error && <Notice tone="error">{error}</Notice>}<div className="agenda-form-actions"><button className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Siliniyor…' : 'Notu sil'}</button></div></div></Modal>;
}

/** One note as a calm card: time, title, text, "Satış notu" and the reminder; edit and delete on the right. */
export function NoteCard({ note, onEdit, onDelete }: { note: AgendaNote; onEdit: () => void; onDelete: () => void }) {
  const label = note.title || note.text.slice(0, 40);
  return <li className={`agenda-note ${note.kind === 'sales' ? 'sales' : ''}`}>
    <div className="agenda-note-body">
      <div className="agenda-note-tags">{note.time && <span className="agenda-tag"><Clock size={13} aria-hidden="true" />{note.time}</span>}{note.kind === 'sales' && <span className="agenda-tag sales">Satış notu</span>}{note.reminder && <span className="agenda-tag reminder"><BellRing size={13} aria-hidden="true" />{reminderText(note.reminder)}</span>}</div>
      {note.title && <strong>{note.title}</strong>}
      {note.text && <p>{note.text}</p>}
    </div>
    <div className="agenda-note-actions"><button type="button" className="icon-btn" aria-label={`${label} notunu düzenle`} title="Düzenle" onClick={onEdit}><Pencil size={17} /></button><button type="button" className="icon-btn" aria-label={`${label} notunu sil`} title="Sil" onClick={onDelete}><Trash size={17} /></button></div>
  </li>;
}

const monthTitle = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function todayTitle(day: string) {
  const d = new Date(`${day}T12:00:00Z`), weekday = d.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'UTC' });
  return `${weekday}, ${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
}

/**
 * Ajanda (owner only): a month calendar like the Windows clock flyout — today filled, the chosen day ringed, days with a
 * note or a reminder marked — and the chosen day's notes beside it (below it on phones). Always 6 rows, so the height never
 * changes between months.
 */
/** marks/onRange/dayExtra (Ajanda ve rezervasyon): days with reservations or events get their own mark, and the chosen day shows them above its notes. */
export function Agenda({ initialDay, marks, onRange, dayExtra }: { initialDay?: string; marks?: Map<string, string>; onRange?: (from: string, to: string) => void; dayExtra?: (day: string) => ReactNode }) {
  const today = istanbulDay();
  const [selected, setSelected] = useState(initialDay ?? today), [month, setMonth] = useState((initialDay ?? today).slice(0, 7));
  // K-Q (9 Ekim): left open over midnight, "today" (and a chosen today) moves on with the clock.
  const [shownToday, setShownToday] = useState(today);
  useEffect(() => {
    const check = () => { const now = istanbulDay(); if (now === shownToday) return; setShownToday(now); if (selected === shownToday) { setSelected(now); setMonth(now.slice(0, 7)); } };
    const id = setInterval(check, 30_000); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [shownToday, selected]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const { notes, error, reload } = useAgendaNotes(grid[0], grid[41]);
  useEffect(() => { onRange?.(grid[0], grid[41]); }, [grid, onRange]);
  const [editing, setEditing] = useState<AgendaNote | 'new' | null>(null), [deleting, setDeleting] = useState<AgendaNote | null>(null);
  const [saved, setSaved] = useState('');
  const byDay = useMemo(() => { const m = new Map<string, AgendaNote[]>(); for (const n of notes ?? []) m.set(n.day, [...(m.get(n.day) ?? []), n]); return m; }, [notes]);
  const dayNotes = byDay.get(selected) ?? [];
  function choose(day: string) { setSelected(day); setEditing(null); setSaved(''); if (day.slice(0, 7) !== month) setMonth(day.slice(0, 7)); }
  const panel = useRef<HTMLElement>(null);
  return <div className="agenda">
    <section className="agenda-calendar" aria-label="Takvim">
      <header className="agenda-head"><strong>{todayTitle(today)}</strong><button type="button" className="btn secondary agenda-today-btn" onClick={() => choose(today)}>Bugün</button></header>
      <div className="agenda-month"><h2 aria-live="polite">{monthTitle(month)}</h2><div className="agenda-month-nav"><button type="button" className="icon-btn" aria-label="Önceki ay" onClick={() => setMonth(m => shiftMonth(m, -1))}><ChevronUp size={20} /></button><button type="button" className="icon-btn" aria-label="Sonraki ay" onClick={() => setMonth(m => shiftMonth(m, 1))}><ChevronDown size={20} /></button></div></div>
      <div className="agenda-weekdays" aria-hidden="true">{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</div>
      <div className="agenda-grid" role="group" aria-label={monthTitle(month)}>{grid.map(day => {
        const list = byDay.get(day) ?? [], reminder = list.some(n => n.reminder), outside = day.slice(0, 7) !== month;
        const status = `${list.length ? `, ${list.length} not${reminder ? ', hatırlatıcı var' : ''}` : ''}${marks?.has(day) ? `, ${marks.get(day)}` : ''}`;
        return <button type="button" key={day} className={['agenda-cell', outside && 'outside', day === today && 'today', day === selected && 'selected', list.length && 'has-note', reminder && 'has-reminder', marks?.has(day) && 'has-resv'].filter(Boolean).join(' ')} aria-pressed={day === selected} aria-label={`${longDay(day)}${day === today ? ' (bugün)' : ''}${status}`} onClick={() => { choose(day); if (window.matchMedia('(max-width: 1000px)').matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>
          <span className="agenda-num">{Number(day.slice(8))}</span><span className="agenda-mark" aria-hidden="true" />{marks?.has(day) && <span className="agenda-resv-mark" aria-hidden="true" />}
        </button>;
      })}</div>
      <div className="agenda-legend"><span><i className="legend-note" />Not var</span><span><i className="legend-reminder" />Hatırlatıcı var</span>{marks && <span><i className="legend-resv" />Rezervasyon / etkinlik</span>}</div>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
    <section className="agenda-day panel" ref={panel} aria-label={`${longDay(selected)} notları`}>
      <div className="agenda-day-head"><div><h2>{longDay(selected)}</h2><span className="muted small">{selected === today ? 'Bugün' : dayNotes.length ? `${dayNotes.length} not` : 'Not yok'}</span></div>{editing === null && <button type="button" className="btn primary" onClick={() => { setSaved(''); setEditing('new'); }}><Plus size={17} />Not ekle</button>}</div>
      {saved && <Notice tone="success">{saved}</Notice>}
      {dayExtra?.(selected)}
      {editing === 'new' && <NoteForm key={`new-${selected}`} day={selected} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved('Not kaydedildi.'); reload(); }} />}
      {notes === null && !error ? <p className="muted" role="status">Notlar yükleniyor…</p> : !dayNotes.length && editing !== 'new' ? <p className="agenda-empty">Bu gün için not yok. Düğün, toplu sipariş, tedarikçi günü gibi şeyleri buraya yazabilirsiniz.</p> : <ul className="agenda-notes">{dayNotes.map(n => editing !== null && editing !== 'new' && editing.id === n.id
        ? <li key={n.id} className="agenda-note editing"><NoteForm day={selected} note={n} simple={false} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSaved('Not güncellendi.'); reload(); }} /></li>
        : <NoteCard key={n.id} note={n} onEdit={() => { setSaved(''); setEditing(n); }} onDelete={() => setDeleting(n)} />)}</ul>}
    </section>
    {deleting && <DeleteNote note={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); setSaved('Not silindi.'); reload(); }} />}
  </div>;
}

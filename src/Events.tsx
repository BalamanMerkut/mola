import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Hand, Pencil, Play, Plus, Users } from 'lucide-react';
import { DateField } from './DateField';
import { eventOverdue, eventStarted, statusNames, turkishDay, type CafeEvent, type Reservation } from '../packages/domain/reservations';
import { longDay } from '../packages/domain/agenda';
import { api, requestId } from './api';
import { Modal, Notice } from './components';
import { CloseEventDialog, useClock } from './ReservationFloor';
import { CancelDialog, PlanLegend, ReservationFormWith, TablePlan, TableSheet, depositLine, type FormTable, type PlanTable, type ReservationsView } from './Reservations';
import { TimeField } from './TimeField';
import './reservations.css';

/*
 * Ajanda ve rezervasyon → Etkinlikler: maç günü gibi etkinlikler. "Etkinlik oluştur" makes the event and its temporary tables
 * (D1…D25 or the owner's own names, no QR). Reservations go onto those tables; from the start (or "Etkinliği başlat") the
 * tables are on Masalar in their own section. Only "Etkinliği kapat" ends it, once every bill there is closed.
 */
type TableState = { id: string; name: string; guest?: string; open?: boolean };
type EventRow = CafeEvent & { tableState: TableState[] };
type EventsView = { today: string; events: EventRow[]; reservations: Reservation[]; canRun: boolean; canReserve: boolean };

function useEvents() {
  const [data, setData] = useState<EventsView | null>(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  useEffect(() => { let live = true; api<EventsView>('/api/staff/events').then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, [version]);
  return { data, error, reload: useCallback(() => setVersion(v => v + 1), []) };
}

/** Create or change an event; the table count and names only when creating. */
function EventForm({ event, today, onClose, onSaved }: { event?: EventRow; today: string; onClose: () => void; onSaved: (message: string) => void }) {
  const [f, setF] = useState({ name: event?.name ?? '', day: event?.day ?? today, start: event?.start ?? '19:00', end: event?.end ?? '', count: '25', naming: 'prefix' as 'prefix' | 'custom', prefix: 'D', names: '', capacity: '', hideNormal: event?.hideNormal ?? false });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (patch: Partial<typeof f>) => setF(v => ({ ...v, ...patch }));
  const count = Number(f.count) || 0, custom = f.names.split('\n').map(n => n.trim()).filter(Boolean);
  const preview = f.naming === 'prefix' ? (count > 0 ? `${f.prefix || 'D'}1, ${f.prefix || 'D'}2 … ${f.prefix || 'D'}${count}` : '') : `${custom.length} ad yazıldı`;
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      if (event) await api('/api/staff/events/update', { requestId: requestId(), id: event.id, name: f.name, day: f.day, start: f.start, end: f.end || null, hideNormal: f.hideNormal });
      else await api('/api/staff/events', { requestId: requestId(), name: f.name, day: f.day, start: f.start, end: f.end || null, count, ...(f.naming === 'custom' ? { names: custom } : { prefix: f.prefix || 'D' }), capacity: Number(f.capacity) || null, hideNormal: f.hideNormal });
      onSaved(event ? 'Etkinlik güncellendi.' : `${f.name.trim()} oluşturuldu: ${count} geçici masa.`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <Modal title={event ? 'Etkinliği düzenle' : 'Etkinlik oluştur'} onClose={onClose} dismissible={!busy} wide><form className="modal-body resv-form" onSubmit={e => void save(e)}>
    <div className="resv-form-grid">
      <label className="wide">Etkinlik adı *<input required maxLength={60} autoFocus value={f.name} placeholder="Ör. Elazığspor derbisi" onChange={e => set({ name: e.target.value })} /></label>
      <label>Gün *<DateField required value={f.day} onChange={v => set({ day: v })} /></label>
      <label>Başlangıç *<TimeField required value={f.start} onChange={start => set({ start })} /></label>
      <label>Planlanan bitiş <small>(isteğe bağlı)</small><TimeField value={f.end} onChange={end => set({ end })} /><small>Bitişte yalnız “Etkinlik bitti mi?” diye sorulur; etkinlik kendiliğinden kapanmaz.</small></label>
      {!event && <>
        <label>Geçici masa sayısı *<input inputMode="numeric" required value={f.count} maxLength={3} onChange={e => set({ count: e.target.value.replace(/\D/g, '') })} /></label>
        <label>Masa başı kişi <small>(isteğe bağlı)</small><input inputMode="numeric" value={f.capacity} maxLength={3} onChange={e => set({ capacity: e.target.value.replace(/\D/g, '') })} /></label>
        <div className="wide resv-naming"><span className="resv-label">Masa adları</span>
          <div className="resv-method" role="group" aria-label="Masa adları">{([['prefix', 'Sıra numarası'], ['custom', 'Kendi adlarım']] as const).map(([v, l]) => <button type="button" key={v} aria-pressed={f.naming === v} className={f.naming === v ? 'selected' : ''} onClick={() => set({ naming: v })}>{l}</button>)}</div>
          {f.naming === 'prefix' ? <label>Ön ad<input maxLength={12} value={f.prefix} onChange={e => set({ prefix: e.target.value })} /></label>
            : <label>Her satıra bir masa adı<textarea rows={4} value={f.names} placeholder={'Sahne önü\nPencere 1\nPencere 2'} onChange={e => set({ names: e.target.value })} /></label>}
          <small className="muted">{preview}. Adları sonra da değiştirebilirsiniz. Geçici masaların QR kodu yoktur; siparişi personel alır.</small></div>
      </>}
      <label className="wide resv-check"><input type="checkbox" checked={f.hideNormal} onChange={e => set({ hideNormal: e.target.checked })} />Etkinlik sırasında normal masaları gizle</label>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="resv-dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !f.name.trim() || (!event && (count < 1 || (f.naming === 'custom' && custom.length !== count)))}>{busy ? 'Kaydediliyor…' : event ? 'Kaydet' : 'Etkinliği oluştur'}</button></div>
  </form></Modal>;
}

function RenameTable({ table, onClose, onSaved }: { table: TableState; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(table.name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={`${table.name} · masa adı`} onClose={onClose} dismissible={!busy}><form className="modal-body resv-form" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void api('/api/staff/events/table-name', { requestId: requestId(), tableId: table.id, name }).then(() => onSaved(`Masa adı “${name.trim()}” oldu.`)).catch(err => { setError((err as Error).message); setBusy(false); }); }}>
    <label>Yeni ad<input required maxLength={20} autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="resv-dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !name.trim()}>Kaydet</button></div>
  </form></Modal>;
}

function EventCard({ e, view, now, onDone, onError }: { e: EventRow; view: EventsView; now: number; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false), [closing, setClosing] = useState(false), [renaming, setRenaming] = useState<TableState | null>(null);
  // Tapping a temporary table: a free one opens the reservation sheet for it (the event's day and start), a reserved one its reservations.
  const [reserving, setReserving] = useState<{ tableId?: string; r?: Reservation; fromTable?: boolean; contact?: boolean } | null>(null), [sheet, setSheet] = useState<PlanTable | null>(null), [cancelling, setCancelling] = useState<Reservation | null>(null);
  const closed = !!e.closedAt, started = eventStarted(e, now), overdue = !closed && eventOverdue(e, now);
  const mine = view.reservations.filter(r => r.eventId === e.id).sort((a, b) => a.at.localeCompare(b.at) || a.tableName.localeCompare(b.tableName, 'tr'));
  const state = closed ? 'Kapandı' : overdue ? 'Bitiş saati geçti · Etkinlik bitti mi?' : started ? 'Sürüyor · Masalar ekranında' : 'Başlamadı';
  const formTables: FormTable[] = e.tableState.map(t => ({ id: t.id, name: t.name, ...(t.open ? { busy: true } : {}), eventId: e.id, eventName: e.name, eventDay: e.day }));
  const finish = (m: string) => { setReserving(null); setSheet(null); setCancelling(null); onDone(m); };
  // "Düzenle" from the sheet: the events list comes without phones, so the change is made on the full record read from
  // Rezervasyonlar (with its phone, for those who may read it); otherwise a saved phone would be lost.
  const pick = (t: PlanTable, tile: { all: Reservation[] }) => { onError(''); if (tile.all.length) setSheet(t); else if (view.canReserve) setReserving({ tableId: t.id, fromTable: true }); };
  const start = () => { onError(''); void api('/api/staff/events/start', { requestId: requestId(), id: e.id }).then(() => onDone(`${e.name} başladı. Masalar ekranında.`)).catch(err => onError((err as Error).message)); };
  return <article className={`panel event-card${closed ? ' closed' : ''}`} aria-label={e.name} data-event={e.id}>
    <header className="event-card-head">
      <div><h3>{e.name}</h3><span className="muted small">{longDay(e.day)} · {e.start}{e.end ? `–${e.end}` : ''} · {e.tables.length} masa{e.capacity ? ` · masa başı ${e.capacity} kişi` : ''}{e.hideNormal ? ' · normal masalar gizlenir' : ''}</span></div>
      <span className={`event-state${overdue ? ' overdue' : started && !closed ? ' running' : ''}`}>{state}</span>
    </header>
    {!closed && <div className="event-actions">
      {view.canReserve && <button type="button" className="btn secondary" onClick={() => setReserving({})}><Plus size={16} />Masaya rezervasyon</button>}
      {view.canRun && !started && <button type="button" className="btn secondary" onClick={start}><Play size={16} />Etkinliği başlat</button>}
      {view.canRun && <button type="button" className="btn secondary" onClick={() => setEditing(true)}><Pencil size={15} />Düzenle</button>}
      {view.canRun && <button type="button" className="btn secondary" onClick={() => setClosing(true)}>Etkinliği kapat</button>}
    </div>}
    {!closed && <>{view.canReserve && <div className="resv-plan-hint"><Hand size={15} aria-hidden="true" /><span>Boş masaya dokunun, rezervasyon açılır.</span><PlanLegend /></div>}
      <TablePlan className="event-tables" tables={formTables} reservations={mine} at={null} busyNow canWrite={view.canReserve} label={`${e.name} masaları`} onPick={pick}
        extra={t => view.canRun ? <button type="button" className="plan-rename icon-btn" title="Adı değiştir" aria-label={`${t.name} masasının adını değiştir`} onClick={() => setRenaming(e.tableState.find(x => x.id === t.id)!)}><Pencil size={14} aria-hidden="true" /></button> : null} /></>}
    {mine.length > 0 && <details className="event-resv" open={!closed}><summary><Users size={15} aria-hidden="true" />Rezervasyonlar ({mine.length})</summary>
      <ul>{mine.map(r => <li key={r.id}><span className="resv-time small">{r.time}</span><span><strong>{r.name}</strong> · {r.people} kişi · {r.tableName}{r.deposit ? ` · ${depositLine(r)}` : ''}</span><span className={`resv-status ${r.status}`}>{statusNames[r.status]}</span></li>)}</ul></details>}
    {editing && <EventForm event={e} today={view.today} onClose={() => setEditing(false)} onSaved={m => { setEditing(false); onDone(m); }} />}
    {closing && <CloseEventDialog event={e} waiting={mine.filter(r => r.status === 'booked').length} onClose={() => setClosing(false)} onClosed={m => { setClosing(false); onDone(m); }} />}
    {renaming && <RenameTable table={renaming} onClose={() => setRenaming(null)} onSaved={m => { setRenaming(null); onDone(m); }} />}
    {reserving && <ReservationFormWith initial={reserving.r} tables={formTables} day={e.day} time={e.start} tableId={reserving.tableId} fromTable={reserving.fromTable} contact={reserving.contact ?? true} onClose={() => setReserving(null)} onSaved={finish} />}
    {sheet && <TableSheet table={sheet} list={mine.filter(r => r.tableId === sheet.id && (r.status === 'booked' || r.status === 'seated'))} canWrite={view.canReserve} busyNow={started} onClose={() => setSheet(null)} onDone={finish}
      onEdit={r => { setSheet(null); void api<ReservationsView>(`/api/staff/reservations?from=${r.day}&to=${r.day}`).then(v => setReserving({ r: v.reservations.find(x => x.id === r.id) ?? r, contact: v.contact !== false })).catch(err => onError((err as Error).message)); }} onCancel={r => { setSheet(null); setCancelling(r); }} onNew={() => { const id = sheet.id; setSheet(null); setReserving({ tableId: id, fromTable: true }); }} />}
    {cancelling && <CancelDialog r={cancelling} onClose={() => setCancelling(null)} onDone={finish} />}
  </article>;
}

export function EventsTab() {
  const { data, error, reload } = useEvents(), now = useClock(15_000);
  const [creating, setCreating] = useState(false), [notice, setNotice] = useState(''), [problem, setProblem] = useState('');
  const done = (m: string) => { setNotice(m); setProblem(''); reload(); };
  const open = data?.events.filter(e => !e.closedAt) ?? [], past = data?.events.filter(e => e.closedAt).reverse() ?? [];
  return <div className="resv-tab">
    <div className="resv-toolbar"><p className="muted resv-lead"><CalendarClock size={16} aria-hidden="true" />Maç günü, konser gibi akşamlar için geçici masalar açın. Etkinlik yalnız siz kapatınca biter.</p>
      {data?.canRun && <button type="button" className="btn primary" onClick={() => { setNotice(''); setCreating(true); }}><Plus size={17} />Etkinlik oluştur</button>}</div>
    {notice && <Notice tone="success">{notice}</Notice>}
    {(problem || error) && <Notice tone="error">{problem || error}</Notice>}
    {data && !open.length && <p className="resv-empty panel">Açık etkinlik yok.{data.canRun ? ' “Etkinlik oluştur” ile başlayın.' : ''}</p>}
    {open.map(e => <EventCard key={e.id} e={e} view={data!} now={now} onDone={done} onError={setProblem} />)}
    {past.length > 0 && <details className="panel event-past"><summary>Geçmiş etkinlikler ({past.length})</summary>{past.map(e => <EventCard key={e.id} e={e} view={data!} now={now} onDone={done} onError={setProblem} />)}<p className="muted small">Satış, kapora ve masa sayıları Satış ve Raporlar → Rezervasyon'da (Ajanda'daki “Rezervasyon raporu”).</p></details>}
    {creating && data && <EventForm today={data.today || turkishDay()} onClose={() => setCreating(false)} onSaved={m => { setCreating(false); done(m); }} />}
  </div>;
}

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Hand, Phone, Plus, Wallet } from 'lucide-react';
import { DateField } from './DateField';
import { areaTitle } from '../packages/domain/table-label';
import { addDays, CONFLICT_MS, depositMethodNames, instantOf, pendingReasonNames, statusNames, turkishDay, turkishTime, type CafeEvent, type DepositMethod, type FloorRules, type Reservation } from '../packages/domain/reservations';
import { longDay } from '../packages/domain/agenda';
import { api, ApiError, money, moneyError, parseMoney, requestId } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';
import { TimeField, isTime } from './TimeField';
import './reservations.css';

/*
 * Ajanda ve rezervasyon → Rezervasyonlar: the café's tables as a plan for one day and one time. A tile says Boş,
 * "Rezerve 20:00" (a reservation within the ±2 hour window of the chosen time) or Dolu (a bill is open there now, today
 * only). Tapping a free table opens a short "Rezervasyon" sheet with that table, the day and the time already filled;
 * tapping a reserved one shows its reservations with Düzenle / İptal / Geldi. The day's list sits below the plan; "Masa
 * ayır" (the full form), the kapora choices that wait for the owner and the ±2 hour warning stay as they were. An event of
 * that day shows its temporary tables as their own part of the plan (Etkinlikler has the same tiles).
 * Phone numbers show only to the cashier, the Müdür and the owner: a waiter's list comes without phones and notes
 * (server/reservations.ts).
 */
export type FormTable = { id: string; name: string; area?: string; busy?: boolean; eventId?: string; eventName?: string; eventDay?: string };
/** `owner`: the kapora choices are shown (owner, Müdür). `contact`: phones and notes come with the list (not for waiters). */
export type ReservationsView = { today: string; reservations: Reservation[]; events: CafeEvent[]; pending: Reservation[]; tables: FormTable[]; rules: FloorRules; owner: boolean; contact?: boolean };

export function useReservations(from: string | null, to: string | null) {
  const [data, setData] = useState<ReservationsView | null>(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  useEffect(() => {
    if (!from || !to) return;
    let live = true; setError('');
    api<ReservationsView>(`/api/staff/reservations?from=${from}&to=${to}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [from, to, version]);
  return { data, error, reload: useCallback(() => setVersion(v => v + 1), []) };
}

const tl = (kurus: number) => String(kurus / 100).replace('.', ',');
/** Kapora as a short line: "Kapora 500 ₺ · Nakit · hesaba düşüldü". */
export function depositLine(r: Reservation) {
  const d = r.deposit; if (!d) return '';
  const state = d.pending ? `karar bekliyor (${money(d.pending.amount)})` : d.decision ? `${d.decision.kind === 'refund' ? 'iade edildi' : 'işletmede kaldı'} (${money(d.decision.amount)})` : d.applied !== undefined ? 'hesaba düşüldü' : r.status === 'seated' ? 'hesapta' : '';
  return `Kapora ${money(d.amount)} · ${depositMethodNames[d.method]}${state ? ` · ${state}` : ''}`;
}
const live = (r: Reservation) => r.status === 'booked' || r.status === 'seated';
/** The next half hour from now ("19:10" → "19:30"), the default time of today's plan; other days start at 20:00. */
export const nextHalfHour = (now = Date.now()) => turkishTime(Math.ceil(now / 1_800_000) * 1_800_000);

/**
 * "Masa ayır", the sheet from a tapped table and changes of a waiting reservation; a clash within two hours asks "Yine de
 * kaydet". `fromTable`: opened by tapping a table, so the table and the day are shown as one line ("Değiştir" opens them).
 * `contact` false (a waiter): a new reservation may carry a phone and a note, but they are never read back, so changing
 * one later shows neither field and keeps what was saved (packages/domain/reservation-rules.ts).
 */
export function ReservationFormWith({ initial, tables, day, tableId, time, fromTable = false, taken = '', onClose, onSaved, contact = true }: { initial?: Reservation; tables: FormTable[]; day: string; tableId?: string; time?: string; fromTable?: boolean; taken?: string; onClose: () => void; onSaved: (message: string) => void; contact?: boolean }) {
  const blind = !contact && !!initial;
  const [f, setF] = useState(() => ({ name: initial?.name ?? '', people: String(initial?.people ?? 2), day: initial?.day ?? day, time: initial?.time ?? time ?? '20:00', tableId: initial?.tableId ?? tableId ?? '', phone: initial?.phone ?? '', note: initial?.note ?? '', deposit: !!initial?.deposit, amount: initial?.deposit ? tl(initial.deposit.amount) : '', method: (initial?.deposit?.method ?? 'cash') as DepositMethod, remind: initial?.remind ?? '' }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [clash, setClash] = useState(''), [where, setWhere] = useState(!fromTable || !!initial);
  // 9 Ekim kullanıcı testi (K-Q): at 00:01 a screen opened at 23:39 still offered "8 Ekim" and took 21:00, a time already
  // past ("Geldi mi?" at once). A time in the past asks once: "Yine de kaydet".
  const [pastOk, setPastOk] = useState(false), [past, setPast] = useState('');
  const set = (patch: Partial<typeof f>) => { setF(v => ({ ...v, ...patch })); setClash(''); setPast(''); setPastOk(false); };
  const fixedDeposit = !!initial?.deposit, amount = parseMoney(f.amount);
  const floor = tables.filter(t => !t.eventId), events = [...new Map(tables.filter(t => t.eventId).map(t => [t.eventId!, t.eventName ?? 'Etkinlik'])).entries()];
  const table = tables.find(t => t.id === f.tableId);
  async function save(force = false, pastConfirmed = pastOk) {
    if (busy) return;
    if (!isTime(f.time)) { setError('Saati 24 saat biçiminde yazın, ör. 20:30.'); return; }
    if (f.deposit && !fixedDeposit && !(amount > 0)) { setError('Kapora tutarını yazın (ör. 500).'); return; }
    const moved = !initial || initial.day !== f.day || initial.time !== f.time;
    if (moved && !pastConfirmed && !force && Date.parse(instantOf(f.day, f.time)) < Date.now()) { setPast(`${longDay(f.day)} ${f.time} geçti. Geçmiş bir saate rezervasyon yazıyorsunuz; günü ve saati kontrol edin.`); return; }
    setBusy(true); setError('');
    try {
      await api('/api/staff/reservations', { requestId: requestId(), ...(initial ? { id: initial.id } : {}), tableId: f.tableId, day: f.day, time: f.time, name: f.name, people: Number(f.people) || 0, ...(blind ? {} : { phone: f.phone.trim() || null, note: f.note.trim() || null }),
        deposit: f.deposit ? (fixedDeposit ? { amount: initial!.deposit!.amount, method: initial!.deposit!.method } : { amount, method: f.method }) : null, remind: f.remind || null, ...(force ? { force: true } : {}) });
      onSaved(initial ? 'Rezervasyon güncellendi.' : `${f.name.trim()} için ${table?.name ?? 'masa'} ayrıldı (${f.time}).`);
    } catch (e) { if (e instanceof ApiError && e.code === 'RESERVATION_CONFLICT') setClash(e.message); else setError((e as Error).message); setBusy(false); }
  }
  const title = initial ? 'Rezervasyonu düzenle' : fromTable ? `Rezervasyon · ${table?.name ?? 'Masa'}` : 'Masa ayır';
  return <Modal title={title} onClose={onClose} dismissible={!busy} wide={!fromTable} className={fromTable ? 'resv-sheet' : ''}><form className="modal-body resv-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void save(); }}>
    {!where && <div className="resv-sheet-where"><span><strong>{table?.name ?? 'Masa'}</strong>{table?.eventName ? ` · ${table.eventName}` : ''} · {longDay(f.day)}</span><button type="button" className="text-btn" onClick={() => setWhere(true)}>Değiştir</button></div>}
    {taken && <p className="resv-sheet-taken"><CalendarClock size={14} aria-hidden="true" />Bu masada o gün: {taken}</p>}
    {fromTable && table?.busy && f.day === turkishDay() && <p className="resv-sheet-taken">Masa şu an dolu (açık hesap var).</p>}
    <div className="resv-form-grid">
      <label className="wide">Misafir adı *<input required maxLength={40} value={f.name} autoFocus placeholder="Ör. Ahmet Yılmaz" onChange={e => set({ name: e.target.value })} /></label>
      <label className="half">Kişi sayısı<input inputMode="numeric" required value={f.people} maxLength={3} onChange={e => set({ people: e.target.value.replace(/\D/g, '') })} /></label>
      <label className="half">Saat *<TimeField required value={f.time} onChange={v => set({ time: v })} /></label>
      {where && <><label>Masa *<select required value={f.tableId} onChange={e => set({ tableId: e.target.value })}><option value="">Masa seçin</option>
        <optgroup label="Masalar">{floor.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
        {events.map(([id, name]) => <optgroup key={id} label={`Etkinlik: ${name}`}>{tables.filter(t => t.eventId === id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}</select></label>
      <label>Gün *<DateField required value={f.day} onChange={v => set({ day: v })} /></label></>}
      {blind ? <p className="wide muted small">Telefon ve not kayıtlı kalır; onları kasiyer, müdür ve işletme sahibi görür.</p> : <>
      <label className="wide"><span>Telefon <small>(isteğe bağlı)</small></span><input type="tel" inputMode="tel" maxLength={20} value={f.phone} placeholder="0532 123 45 67" onChange={e => set({ phone: e.target.value })} /></label>
      <label className="wide"><span>Not <small>(isteğe bağlı)</small></span><input maxLength={200} value={f.note} placeholder="Ör. Doğum günü, pencere kenarı" onChange={e => set({ note: e.target.value })} /></label></>}
    </div>
    {!blind && <p className="resv-privacy muted small">Telefon ve not yalnız kafede kalır<HelpTip title="Kişisel veri">{contact ? 'Telefon yalnız bu kafenin bilgisayarında saklanır, raporlara ve masalara çıkmaz; yalnız rezervasyon için kullanılır. Yıl paketlenirken ad, telefon ve not silinir (KVKK).' : 'Kaydettikten sonra telefonu ve notu yalnız kasiyer, müdür ve işletme sahibi görür (KVKK).'}</HelpTip></p>}
    <fieldset className="resv-deposit"><legend><Wallet size={16} aria-hidden="true" />Kapora <small>(isteğe bağlı)</small><HelpTip title="Kapora kuralları">Kapora kasaya şimdi girer. Misafir gelince hesabından kendiliğinden düşülür; gelmezse kaporayı iade etmeye ya da işletmede bırakmaya işletme sahibi karar verir.</HelpTip></legend>
      {fixedDeposit ? <p className="muted">{depositLine(initial!)}. Alınan kapora değiştirilemez; gerekirse rezervasyonu iptal edip kaporayı iade edin.</p> : <>
        <label className="resv-check"><input type="checkbox" checked={f.deposit} onChange={e => set({ deposit: e.target.checked })} />Kapora alındı</label>
        {f.deposit && <div className="resv-deposit-row"><label>Tutar (TL)<input inputMode="decimal" value={f.amount} placeholder="500" aria-invalid={!!f.amount && !(amount > 0)} onChange={e => set({ amount: e.target.value })} />{!!f.amount && moneyError(f.amount) && <small className="field-error" role="alert">{moneyError(f.amount)}</small>}</label>
          <div className="resv-method" role="group" aria-label="Kapora nasıl alındı">{(['cash', 'card'] as const).map(m => <button type="button" key={m} aria-pressed={f.method === m} className={f.method === m ? 'selected' : ''} onClick={() => set({ method: m })}>{depositMethodNames[m]}</button>)}</div></div>}</>}
    </fieldset>
    <label className="resv-remind">Hatırlatıcı<select value={f.remind} onChange={e => set({ remind: e.target.value as typeof f.remind })}><option value="">Hatırlatma yok</option><option value="hour">1 saat önce</option><option value="day">1 gün önce</option></select></label>
    {past && <div data-testid="resv-past"><Notice tone="error">{past}<button type="button" className="text-btn" disabled={busy} onClick={() => { setPast(''); setPastOk(true); void save(false, true); }}>Yine de kaydet</button></Notice></div>}
    {clash && <Notice>{clash} Aynı masaya yine de yazılsın mı?<button type="button" className="text-btn" disabled={busy} onClick={() => void save(true)}>Yine de kaydet</button></Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="resv-dialog-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !f.name.trim() || !f.tableId}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
  </form></Modal>;
}

/** The owner's choice for a kapora left over. */
function DepositChoice({ r, onDone, onError }: { r: Reservation; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const decide = (kind: 'refund' | 'keep') => { setBusy(true); onError(''); void api('/api/staff/reservations/deposit', { requestId: requestId(), id: r.id, kind }).then(() => onDone(kind === 'refund' ? `${r.name} kaporası iade edildi olarak kaydedildi.` : `${r.name} kaporası işletmede kaldı.`)).catch(e => onError((e as Error).message)).finally(() => setBusy(false)); };
  return <div className="resv-choice"><button type="button" className="btn secondary" disabled={busy} onClick={() => decide('refund')}>İade et</button><button type="button" className="btn primary" disabled={busy} onClick={() => decide('keep')}>İşletmede kalsın</button></div>;
}

export function CancelDialog({ r, onClose, onDone }: { r: Reservation; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="Rezervasyon iptal edilsin mi?" onClose={onClose} dismissible={!busy}><div className="modal-body resv-dialog">
    <p><strong>{r.name}</strong> · {longDay(r.day)} {r.time} · {r.tableName}</p>
    {r.deposit && <p className="muted">{money(r.deposit.amount)} kapora iade mi edilecek, işletmede mi kalacak; bunu işletme sahibi Rezervasyonlar'da seçer.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="resv-dialog-actions"><button className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy} onClick={() => { setBusy(true); void api('/api/staff/reservations/cancel', { requestId: requestId(), id: r.id }).then(() => onDone('Rezervasyon iptal edildi.')).catch(e => { setError((e as Error).message); setBusy(false); }); }}>İptal et</button></div>
  </div></Modal>;
}

/** "Geldi" is offered from the plan when the reservation is within half a day of now (the floor has the same button). */
const seatable = (r: Reservation, now = Date.now()) => r.status === 'booked' && Math.abs(Date.parse(r.at) - now) < 12 * 3600_000;

export function ReservationCard({ r, canWrite, onEdit, onCancel, onSeat }: { r: Reservation; canWrite: boolean; onEdit: () => void; onCancel: () => void; onSeat?: () => void }) {
  return <li className={`resv-card status-${r.status}`} data-reservation={r.id}>
    <div className="resv-time">{r.time}</div>
    <div className="resv-body">
      <strong>{r.name}</strong>
      <span>{r.people} kişi · {r.tableName}</span>
      {r.note && <p>{r.note}</p>}
      <div className="resv-tags"><span className={`resv-status ${r.status}`}>{statusNames[r.status]}</span>{r.deposit && <span className="resv-tag">{depositLine(r)}</span>}{r.remind && <span className="resv-tag">Hatırlatıcı</span>}</div>
      {r.phone && <a className="resv-phone" href={`tel:${r.phone.replace(/[^+0-9]/g, '')}`}><Phone size={13} aria-hidden="true" />{r.phone}</a>}
    </div>
    {r.status === 'booked' && (canWrite || onSeat) && <div className="resv-actions">
      {onSeat && <button type="button" className="btn primary resv-seat" aria-label={`${r.name} geldi`} onClick={onSeat}>Geldi</button>}
      {canWrite && <button type="button" className="text-btn" aria-label={`${r.name} rezervasyonunu düzenle`} onClick={onEdit}>Düzenle</button>}
      {canWrite && <button type="button" className="text-btn" aria-label={`${r.name} rezervasyonunu iptal et`} onClick={onCancel}>İptal et</button>}
    </div>}
  </li>;
}

// ---- The table plan (Rezervasyonlar and each event in Etkinlikler) ----
export type PlanTable = { id: string; name: string; busy?: boolean };
type Tile = { kind: 'free' | 'reserved' | 'busy'; state: string; sub?: string; near: Reservation[]; all: Reservation[] };
/**
 * A table's state on the plan. `at` (the chosen time, ms): "Rezerve" only for a reservation within ±2 hours of it (the same
 * window as the clash warning); without `at` (an event's evening) any reservation of the day makes it "Rezerve".
 * `busyNow`: Dolu is shown only for today.
 */
export function tileOf(t: PlanTable, list: Reservation[], at: number | null, busyNow: boolean): Tile {
  const all = list.filter(r => r.tableId === t.id && live(r)).sort((a, b) => a.at.localeCompare(b.at));
  const near = at === null ? all : all.filter(r => Math.abs(Date.parse(r.at) - at) < CONFLICT_MS);
  const first = near[0], reservedText = first ? `${first.status === 'seated' ? 'Geldi' : 'Rezerve'} ${first.time}` : '';
  if (busyNow && t.busy) return { kind: 'busy', state: 'Dolu', sub: first ? reservedText : undefined, near, all };
  if (first) return { kind: 'reserved', state: reservedText, sub: `${first.name} · ${first.people} kişi${near.length > 1 ? ` · +${near.length - 1}` : ''}`, near, all };
  return { kind: 'free', state: 'Boş', sub: all.length ? `Başka saat: ${all.map(r => r.time).join(', ')}` : undefined, near, all };
}

export function PlanLegend() {
  return <ul className="plan-legend" aria-label="Masa durumları"><li><i className="free" />Boş</li><li><i className="reserved" />Rezerve</li><li><i className="busy" />Dolu</li></ul>;
}

/** One group of tiles. `extra`: something more inside a tile's cell (an event table's rename button). */
export function TablePlan({ tables, reservations, at, busyNow, canWrite, label, className = '', onPick, extra }: { tables: PlanTable[]; reservations: Reservation[]; at: number | null; busyNow: boolean; canWrite: boolean; label: string; className?: string; onPick: (t: PlanTable, tile: Tile) => void; extra?: (t: PlanTable) => ReactNode }) {
  return <ul className={`plan-grid ${className}`.trim()} aria-label={label}>{tables.map(t => {
    const tile = tileOf(t, reservations, at, busyNow), usable = tile.near.length > 0 || tile.all.length > 0 || canWrite;
    return <li key={t.id} className={`plan-cell ${tile.kind}`} data-table={t.name}>
      <button type="button" className="plan-tile" disabled={!usable} title={tile.kind === 'free' && canWrite ? 'Dokunun: rezervasyon' : undefined} onClick={() => onPick(t, tile)}>
        <strong>{t.name}</strong><span className="plan-state">{tile.state}</span>{tile.sub && <span className="plan-sub">{tile.sub}</span>}
      </button>{extra?.(t)}
    </li>;
  })}</ul>;
}

/** A reserved table tapped: its reservations of the day with Geldi / Düzenle / İptal, and a new one for another time. */
export function TableSheet({ table, list, canWrite, busyNow, onClose, onEdit, onCancel, onNew, onDone }: { table: PlanTable; list: Reservation[]; canWrite: boolean; busyNow: boolean; onClose: () => void; onEdit: (r: Reservation) => void; onCancel: (r: Reservation) => void; onNew: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const seat = (r: Reservation) => { if (busy) return; setBusy(true); setError(''); void api('/api/staff/reservations/seat', { requestId: requestId(), id: r.id }).then(() => onDone(`${r.name} masaya oturdu.`)).catch(e => { setError((e as Error).message); setBusy(false); }); };
  return <Modal title={`${table.name} · Rezervasyon`} onClose={onClose} dismissible={!busy} className="resv-sheet"><div className="modal-body resv-table-sheet">
    {busyNow && table.busy && <p className="resv-sheet-taken">Masa şu an dolu (açık hesap var). Misafir gelince önce o hesap kapanmalı.</p>}
    <ul className="resv-list">{list.map(r => <ReservationCard key={r.id} r={r} canWrite={canWrite} onEdit={() => onEdit(r)} onCancel={() => onCancel(r)} onSeat={seatable(r) && !(busyNow && table.busy) ? () => seat(r) : undefined} />)}</ul>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="resv-dialog-actions">{canWrite && <button type="button" className="btn secondary" onClick={onNew}><Plus size={16} aria-hidden="true" />Başka saate rezervasyon</button>}<button type="button" className="btn primary" onClick={onClose}>Tamam</button></div>
  </div></Modal>;
}

type Editing = { r?: Reservation; tableId?: string; fromTable?: boolean };

/** Rezervasyonlar: one day and one time on the table plan, the day's list below. */
export function ReservationsTab({ initialDay }: { initialDay?: string }) {
  const [day, setDay] = useState(initialDay ?? turkishDay());
  const today = turkishDay(), isToday = day === today;
  const [time, setTime] = useState(() => (initialDay ?? today) === today ? nextHalfHour() : '20:00');
  const { data, error, reload } = useReservations(day, day);
  const [editing, setEditing] = useState<Editing | null>(null), [cancelling, setCancelling] = useState<Reservation | null>(null), [sheet, setSheet] = useState<PlanTable | null>(null);
  const [notice, setNotice] = useState(''), [problem, setProblem] = useState('');
  const done = (message: string) => { setEditing(null); setCancelling(null); setSheet(null); setNotice(message); setProblem(''); reload(); };
  const list = useMemo(() => data?.reservations ?? [], [data]), shown = list.filter(live);
  const canWrite = !!data?.rules.canReserve, at = isTime(time) ? Date.parse(instantOf(day, time)) : null;
  // The chosen time stays when the day changes (a 20:00 plan is looked at day after day).
  const changeDay = (next: string) => setDay(next);
  // K-Q (9 Ekim): a screen left open over midnight moves "today" on with the clock (a plan of another day stays where it is).
  const [shownToday, setShownToday] = useState(today);
  useEffect(() => {
    const check = () => { const now = turkishDay(); if (now === shownToday) return; setShownToday(now); setDay(d => d === shownToday ? now : d); setTime(t => day === shownToday ? nextHalfHour() : t); };
    const id = setInterval(check, 30_000); document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [shownToday, day]);
  // The floor in its sections (Bahçe, Salon…), then each event of this day with its temporary tables.
  const groups = useMemo(() => {
    const floor = (data?.tables ?? []).filter(t => !t.eventId), areas: [string, FormTable[]][] = [];
    for (const t of floor) { const name = t.area ?? ''; const g = areas.find(([n]) => n === name); if (g) g[1].push(t); else areas.push([name, [t]]); }
    const events = [...new Map((data?.tables ?? []).filter(t => t.eventId && t.eventDay === day).map(t => [t.eventId!, t.eventName ?? 'Etkinlik'])).entries()];
    return [...areas.map(([name, tables]) => ({ key: `area:${name}`, title: areas.length > 1 || name ? areaTitle(name) : '', tables, event: false })),
      ...events.map(([id, name]) => ({ key: `event:${id}`, title: `Etkinlik: ${name}`, tables: (data?.tables ?? []).filter(t => t.eventId === id), event: true }))];
  }, [data, day]);
  const pick = (t: PlanTable, tile: Tile) => {
    setNotice('');
    if (tile.near.length || (!canWrite && tile.all.length)) setSheet(t);
    else if (canWrite) setEditing({ tableId: t.id, fromTable: true });
  };
  const takenOn = (id?: string) => id ? list.filter(r => r.tableId === id && live(r)).map(r => `${r.time} ${r.name}`).join(', ') : '';
  return <div className="resv-tab">
    <div className="resv-plan-bar">
      <div className="resv-daynav" role="group" aria-label="Gün seçimi">
        <button type="button" className="icon-btn" aria-label="Önceki gün" onClick={() => changeDay(addDays(day, -1))}><ChevronLeft size={20} /></button>
        <DateField aria-label="Gün" value={day} onChange={v => v && changeDay(v)} />
        <button type="button" className="icon-btn" aria-label="Sonraki gün" onClick={() => changeDay(addDays(day, 1))}><ChevronRight size={20} /></button>
        {!isToday && <button type="button" className="btn secondary" onClick={() => changeDay(today)}>Bugün</button>}
      </div>
      <label className="resv-plan-time">Saat<TimeField value={time} onChange={setTime} /></label>
      {canWrite && <button type="button" className="btn secondary resv-plan-new" onClick={() => { setNotice(''); setEditing({}); }}><Plus size={17} />Masa ayır</button>}
    </div>
    {notice && <Notice tone="success">{notice}</Notice>}
    {(problem || error) && <Notice tone="error">{problem || error}</Notice>}
    <section className="panel resv-plan" aria-label="Masa planı">
      <div className="resv-plan-head"><h2>{longDay(day)}{isTime(time) ? ` · ${time}` : ''}</h2><PlanLegend /></div>
      {canWrite && <p className="resv-plan-hint"><Hand size={15} aria-hidden="true" /><span>Boş masaya dokunun, rezervasyon açılır. Rezerve masaya dokunun, rezervasyonu görün.</span></p>}
      {!data ? <p className="muted small" role="status">Yükleniyor…</p> : groups.map(g => <div key={g.key} className={`plan-group${g.event ? ' event' : ''}`}>
        {g.title && <h3>{g.title}</h3>}
        <TablePlan tables={g.tables} reservations={list} at={g.event ? null : at} busyNow={isToday} canWrite={canWrite} label={g.title || 'Masalar'} onPick={pick} />
      </div>)}
    </section>
    <section className="panel resv-day" aria-label={`${longDay(day)} rezervasyonları`}>
      <div className="resv-day-head"><h2>Günün rezervasyonları</h2><span className="muted small">{data ? shown.length ? `${shown.length} rezervasyon · ${shown.reduce((n, r) => n + r.people, 0)} kişi` : 'Rezervasyon yok' : 'Yükleniyor…'}</span></div>
      {data && !list.length ? <p className="resv-empty">Bu gün için rezervasyon yok.{canWrite ? ' Yukarıda boş bir masaya dokunarak ekleyebilirsiniz.' : ''}</p>
        : <ul className="resv-list">{list.map(r => <ReservationCard key={r.id} r={r} canWrite={canWrite} onEdit={() => { setNotice(''); setEditing({ r }); }} onCancel={() => setCancelling(r)} />)}</ul>}
      {!canWrite && data && <p className="muted small">Rezervasyon yazma yetkiniz yok; ayarı işletme sahibine sorun (Ajanda ve rezervasyon → Ayarlar).</p>}
    </section>
    {!!data?.pending.length && <section className="panel resv-pending" aria-label="Kapora kararı bekleyenler"><h3>Kapora kararı bekleyenler<HelpTip title="Kapora kararı">Gelmeyen, iptal edilen ya da hesaptan artan kapora: iade ettiyseniz “İade et”, işletmede kalıyorsa “İşletmede kalsın”. Kalan kapora satış sayılmaz, raporda ayrı görünür.</HelpTip></h3>
      <ul>{data.pending.map(r => <li key={r.id} className="resv-pending-row"><div><strong>{r.name} · {longDay(r.day)} {r.time}</strong><span>{pendingReasonNames[r.deposit!.pending!.reason]} · {money(r.deposit!.pending!.amount)} · {depositMethodNames[r.deposit!.method]}</span></div><DepositChoice r={r} onDone={done} onError={setProblem} /></li>)}</ul></section>}
    {sheet && data && <TableSheet table={sheet} list={list.filter(r => r.tableId === sheet.id && live(r))} canWrite={canWrite} busyNow={isToday} onClose={() => setSheet(null)} onDone={done}
      onEdit={r => { setSheet(null); setEditing({ r }); }} onCancel={r => { setSheet(null); setCancelling(r); }} onNew={() => { const id = sheet.id; setSheet(null); setEditing({ tableId: id, fromTable: true }); }} />}
    {editing && data && <ReservationFormWith initial={editing.r} tables={data.tables} day={day} time={isTime(time) ? time : undefined} tableId={editing.tableId} fromTable={editing.fromTable} taken={editing.fromTable ? takenOn(editing.tableId) : ''} contact={data.contact !== false} onClose={() => setEditing(null)} onSaved={done} />}
    {cancelling && <CancelDialog r={cancelling} onClose={() => setCancelling(null)} onDone={done} />}
  </div>;
}

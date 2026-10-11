import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarClock, UserRound, Wallet } from 'lucide-react';
import type { StaffSnapshot, TableView } from '../packages/domain/types';
import { cashDayOf } from '../packages/domain/cash';
import { depositMethodNames, eventOverdue, eventStarted, markPhase, markText, DEFAULT_ASK, DEFAULT_LEAD, type PublicEvent, type ReservationMark } from '../packages/domain/reservations';
import { api, money, requestId } from './api';
import { Modal, Notice } from './components';
import './reservations.css';

/*
 * Masalar's part of Ajanda ve rezervasyon: "Rezerve · Ahmet · 4 kişi · 20:00" on a table from an hour before (Ayarlar), the
 * small "Ahmet · 20:00 · Geldi mi?" question half an hour after (Geldi / 15 dk daha bekle / Gelmedi), the seated name on the
 * table and its window, a started event's temporary tables in their own section ("Etkinlik: Derbi"), walk-in names and
 * "Kaporayla kapat". Nothing changes by itself: the screen only asks; staff decide. The clock is this device's.
 */

/** This device's clock, ticking every `ms` (the floor's phases change with time, not with the snapshot). */
export function useClock(ms = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export type FloorMark = { mark: ReservationMark; phase: 'reserved' | 'ask' };
export type Floor = {
  /** Started, not closed events, and their temporary tables in the event's order. */
  events: PublicEvent[]; eventTables: TableView[];
  /** A started event asked to hide the normal tables. */
  hideNormal: boolean;
  /** The next reservation shown on each table (Rezerve or Geldi mi?). */
  marks: Map<string, FloorMark>;
  /** Every reservation whose "Geldi mi?" question is due. */
  asks: ReservationMark[];
  names: Map<string, string>;
  canRunEvents: boolean;
};
export function floorParts(data: StaffSnapshot, now: number): Floor {
  const rules = data.reservations ?? { leadMinutes: DEFAULT_LEAD, askMinutes: DEFAULT_ASK, canReserve: false, canRunEvents: false };
  const events = (data.events ?? []).filter(e => eventStarted(e, now)), ids = new Set(events.map(e => e.id));
  const eventTables = (data.eventTables ?? []).filter(t => t.event && ids.has(t.event.id));
  const marks = new Map<string, FloorMark>(), asks: ReservationMark[] = [];
  for (const mark of data.reservationMarks ?? []) {
    const phase = markPhase(mark, now, rules);
    if (phase === 'later') continue;
    if (phase === 'ask') asks.push(mark);
    if (!marks.has(mark.tableId)) marks.set(mark.tableId, { mark, phase });
  }
  const names = new Map([...data.tables, ...(data.eventTables ?? [])].map(t => [t.id, t.name]));
  return { events, eventTables, hideNormal: events.some(e => e.hideNormal), marks, asks, names, canRunEvents: rules.canRunEvents };
}

/** The lines on a table card: who sits there, and the reservation coming. */
export function TableBadge({ table, floor }: { table: TableView; floor: Floor }) {
  const guest = table.account?.guest, m = floor.marks.get(table.id);
  if (!guest && !m) return null;
  return <span className="table-resv-lines">
    {guest && <span className="table-guest"><UserRound size={13} aria-hidden="true" />{guest.name}{guest.people ? ` · ${guest.people} kişi` : ''}</span>}
    {m && (m.phase === 'ask' ? <span className="table-resv ask">{m.mark.name} · {m.mark.time} · Geldi mi?</span> : <span className="table-resv"><CalendarClock size={13} aria-hidden="true" />Rezerve · {markText(m.mark)}</span>)}
  </span>;
}

type Done = (message: string) => void;
/** Geldi / 15 dk daha bekle / Gelmedi for one reservation; Gelmedi asks once more (it frees the table). */
function AskButtons({ mark, busyTable, onDone, onError }: { mark: ReservationMark; busyTable?: boolean; onDone: Done; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false), [sure, setSure] = useState(false);
  async function act(path: string, message: string) {
    if (busy) return; setBusy(true); onError('');
    try { await api(`/api/staff/reservations/${path}`, { requestId: requestId(), id: mark.id }); onDone(message); } catch (e) { onError((e as Error).message); } finally { setBusy(false); setSure(false); }
  }
  return <div className="resv-ask-actions">
    <button type="button" className="btn primary" disabled={busy || busyTable} title={busyTable ? 'Masa dolu: önce hesabı kapatın ya da rezervasyonu başka masaya alın' : undefined} onClick={() => void act('seat', `${mark.name} masaya oturdu.`)}>Geldi</button>
    <button type="button" className="btn secondary" disabled={busy} onClick={() => void act('wait', `${mark.name} için 15 dakika daha beklenecek.`)}>15 dk daha bekle</button>
    {sure ? <button type="button" className="btn danger-soft" disabled={busy} onClick={() => void act('no-show', `${mark.name} gelmedi olarak işaretlendi. Masa boşaldı.`)}>Evet, gelmedi</button>
      : <button type="button" className="btn ghost" disabled={busy} onClick={() => setSure(true)}>Gelmedi</button>}
  </div>;
}

/** The "Geldi mi?" questions due now, above the tables. */
export function ReservationQuestions({ floor, data, onDone, onError }: { floor: Floor; data: StaffSnapshot; onDone: Done; onError: (m: string) => void }) {
  if (!floor.asks.length) return null;
  const busy = (id: string) => !![...data.tables, ...(data.eventTables ?? [])].find(t => t.id === id)?.account;
  return <section className="resv-asks" aria-label="Rezervasyon soruları">
    {floor.asks.map(m => <article className="resv-ask" key={m.id} data-reservation={m.id}>
      <div className="resv-ask-copy"><strong>{m.name} · {m.time} · Geldi mi?</strong><span>{floor.names.get(m.tableId) ?? 'Masa'} · {m.people} kişi{m.deposit ? ` · Kapora ${money(m.deposit)}` : ''}{busy(m.tableId) ? ' · masa şu an dolu' : ''}</span></div>
      <AskButtons mark={m} busyTable={busy(m.tableId)} onDone={onDone} onError={onError} />
    </article>)}
  </section>;
}

/** Inside a table's window: the seated name (changeable), the kapora, the coming reservation, a walk-in name on an event table. */
export function TablePanel({ table, data, floor, onDone, onError }: { table: TableView; data: StaffSnapshot; floor: Floor; onDone: Done; onError: (m: string) => void }) {
  // The reservation on the floor now, else the next one of tonight on this table (the night turns at 05:00 like the cash day,
  // so at 22:45 a 00:45 guest can be seated early). A started event's temporary table offers the event's own at any hour.
  const shown = floor.marks.get(table.id), tonight = cashDayOf(Date.now());
  const a = table.account, guest = a?.guest, next = shown?.mark ?? (data.reservationMarks ?? []).find(m => m.tableId === table.id && (!!table.event || cashDayOf(m.at) === tonight)), phase = shown?.phase;
  const [editing, setEditing] = useState(false), [name, setName] = useState(''), [people, setPeople] = useState(''), [busy, setBusy] = useState(false);
  const staff = data.role !== 'kitchen';
  const nameable = staff && (!!table.event || !!guest) && !table.needsCleaning;
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy || !name.trim()) return; setBusy(true); onError('');
    const count = Number(people) || undefined;
    try {
      if (a) await api('/api/staff/reservations/guest-name', { requestId: requestId(), accountId: a.id, name: name.trim(), ...(count ? { people: count } : {}) });
      else await api('/api/staff/reservations/walk-in', { requestId: requestId(), tableId: table.id, name: name.trim(), ...(count ? { people: count } : {}) });
      setEditing(false); onDone(a ? 'Ad değişti.' : `${table.name}: ${name.trim()} oturdu.`);
    } catch (err) { onError((err as Error).message); } finally { setBusy(false); }
  }
  const form = <form className="resv-name-form" onSubmit={e => void save(e)}>
    <label>Misafir adı<input value={name} maxLength={40} autoFocus placeholder={a ? '' : 'Ör. Mehmet (rezervasyonsuz)'} onChange={e => setName(e.target.value)} /></label>
    <label>Kişi<input inputMode="numeric" value={people} maxLength={3} onChange={e => setPeople(e.target.value.replace(/\D/g, ''))} /></label>
    <div className="resv-name-actions">{a && <button type="button" className="btn secondary" onClick={() => setEditing(false)}>Vazgeç</button>}<button className="btn primary" disabled={busy || !name.trim()}>{a ? 'Kaydet' : 'Adı yaz'}</button></div>
  </form>;
  if (!guest && !next && !(table.event && staff)) return null;
  return <div className="resv-panel">
    {guest && (editing ? form : <div className="resv-panel-row"><UserRound size={18} aria-hidden="true" /><div><strong>{guest.name}</strong><span>{guest.people ? `${guest.people} kişi · ` : ''}{guest.walkIn ? 'Rezervasyonsuz' : 'Rezervasyonla geldi'}</span></div>{nameable && <button type="button" className="text-btn" onClick={() => { setName(guest.name); setPeople(guest.people ? String(guest.people) : ''); setEditing(true); }}>Adı değiştir</button>}</div>)}
    {a?.deposit && !a.deposit.settledAt && <div className="resv-panel-row deposit"><Wallet size={18} aria-hidden="true" /><div><strong>Kapora {money(a.deposit.amount)} ({depositMethodNames[a.deposit.method]})</strong><span>{a.depositCredit ? `${money(a.depositCredit)} bu hesaptan düşüldü.` : 'Sipariş gelince bu hesaptan düşülür.'}{a.deposit.amount > (a.depositCredit ?? 0) && a.total > 0 ? ' Artan kapora için karar işletme sahibine kalır.' : ''}</span></div></div>}
    {!a && table.event && staff && !table.needsCleaning && (editing ? form : <div className="resv-panel-row"><UserRound size={18} aria-hidden="true" /><div><strong>Rezervasyonsuz misafir</strong><span>Adını yazarsanız masada ve hesapta görünür.</span></div><button type="button" className="btn secondary" onClick={() => { setName(''); setPeople(''); setEditing(true); }}>Ad yaz</button></div>)}
    {a && !guest && table.event && staff && (editing ? form : <div className="resv-panel-row"><UserRound size={18} aria-hidden="true" /><div><strong>Adı yazılmadı</strong></div><button type="button" className="text-btn" onClick={() => { setName(''); setPeople(''); setEditing(true); }}>Ad yaz</button></div>)}
    {next && staff && <div className={`resv-panel-next${phase === 'ask' ? ' ask' : ''}`}><div><strong>{phase === 'ask' ? `${next.name} · ${next.time} · Geldi mi?` : `Rezervasyon: ${markText(next)}`}</strong>{next.deposit ? <span>Kapora {money(next.deposit)}</span> : null}{a && <span>Masa şu an dolu. Önce bu hesabı kapatın.</span>}</div><AskButtons mark={next} busyTable={!!a} onDone={onDone} onError={onError} /></div>}
  </div>;
}

/** "Kaporayla kapat": the kapora pays the whole bill, nothing is left to collect. */
export function DepositClose({ table, onDone, onError }: { table: TableView; onDone: Done; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false), a = table.account!;
  return <button className="btn primary" disabled={busy} onClick={() => { setBusy(true); onError(''); void api('/api/staff/reservations/close-with-deposit', { requestId: requestId(), accountId: a.id, version: a.version }).then(() => onDone('Hesap kaporayla kapandı.')).catch(e => onError((e as Error).message)).finally(() => setBusy(false)); }}><Wallet size={17} />Kaporayla kapat</button>;
}

/** "Etkinliği kapat": refused while a temporary table still has an open bill (the server lists them). */
export function CloseEventDialog({ event, waiting = 0, onClose, onClosed }: { event: { id: string; name: string }; waiting?: number; onClose: () => void; onClosed: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function close() {
    setBusy(true); setError('');
    try { const r = await api<{ noShow: number }>('/api/staff/events/close', { requestId: requestId(), id: event.id }); onClosed(`${event.name} kapandı.${r.noShow ? ` ${r.noShow} rezervasyon gelmedi olarak işaretlendi.` : ''}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Modal title="Etkinlik kapatılsın mı?" onClose={onClose} dismissible={!busy}><div className="modal-body resv-dialog">
    <p><strong>{event.name}</strong></p>
    <p className="muted">Geçici masalar Masalar ekranından kalkar. Kapanan hesaplar raporlarda masa adlarıyla kalır. Açık hesap varsa önce onlar kapatılmalı.</p>
    {waiting > 0 && <p className="muted">Hâlâ beklenen {waiting} rezervasyon “gelmedi” olarak işaretlenir.</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="resv-dialog-actions"><button className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy} onClick={() => void close()}>{busy ? 'Kapatılıyor…' : 'Etkinliği kapat'}</button></div>
  </div></Modal>;
}

/** A started event's temporary tables, each event its own section, with a gentle "Etkinlik bitti mi?" after the planned end. */
export function EventSections({ floor, now, filter, card, onDone }: { floor: Floor; now: number; filter: (t: TableView) => boolean; card: (t: TableView) => ReactNode; onDone: Done }) {
  const [closing, setClosing] = useState<PublicEvent | null>(null);
  if (!floor.events.length) return null;
  return <>{floor.events.map(e => {
    const tables = floor.eventTables.filter(t => t.event?.id === e.id), overdue = eventOverdue(e, now);
    return <section className="table-area-section event-section" key={e.id} aria-label={`Etkinlik: ${e.name}`}>
      <div className="event-section-head"><h3>Etkinlik: {e.name}</h3><span className="muted small">{e.start}{e.end ? `–${e.end}` : ''} · {tables.length} masa · {tables.filter(t => t.account).length} dolu</span>
        {overdue && <span className="event-overdue">Planlanan bitiş geçti · Etkinlik bitti mi?</span>}
        {floor.canRunEvents && <button type="button" className="btn secondary event-close-btn" onClick={() => setClosing(e)}>Etkinliği kapat</button>}</div>
      <div className="table-grid">{tables.filter(filter).map(card)}</div>
    </section>;
  })}{closing && <CloseEventDialog event={closing} onClose={() => setClosing(null)} onClosed={message => { setClosing(null); onDone(message); }} />}</>;
}

/** While an event hides the normal tables, one line says so and brings them back. */
export function NormalTablesToggle({ floor, show, onShow }: { floor: Floor; show: boolean; onShow: (v: boolean) => void }) {
  if (!floor.hideNormal) return null;
  return <div className="event-normal-toggle"><span>{show ? 'Normal masalar da gösteriliyor.' : 'Etkinlik sürerken normal masalar gizli.'}</span><button type="button" className="text-btn" onClick={() => onShow(!show)}>{show ? 'Normal masaları gizle' : 'Normal masaları göster'}</button></div>;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarRange, PartyPopper, Settings, type LucideIcon } from 'lucide-react';
import { ReservationSettingsCard } from './ReservationSettings';
import { PlaceLink } from './Moved';
import type { Role } from '../packages/domain/types';
import { statusNames } from '../packages/domain/reservations';
import { Agenda } from './Agenda';
import { PillTabs } from './PillTabs';
import { ReservationsTab, useReservations } from './Reservations';
import { EventsTab } from './Events';
import './reservations.css';
// Hizmet paketi: without "Rezervasyon ve etkinlik" Takvim stays; the other two parts are faded with the card (owner, Müdür).
import { FeatureLockView, usePackage } from './FeatureLock';

/*
 * "Ajanda ve rezervasyon": one main menu item with three parts. Rezervasyonlar (the table plan: tap a table to reserve it),
 * Etkinlikler and Takvim (owner: notes, reminders, and days with reservations or events marked). Cashier and waiter (when the owner lets them write
 * reservations) see only Rezervasyonlar and Etkinlikler. The owner's last tab, "Ayarlar" (gear), holds the reservation
 * settings (once Ayarlar → Masalar ve QR → Rezervasyon). The last part chosen stays on this device.
 */
type Part = 'calendar' | 'reservations' | 'events' | 'settings';
// Rezervasyonlar first (8 Ekim, the owner's test: a first-time user opens the table plan and taps a table); Takvim last.
const PARTS: { id: Part; label: string; icon: LucideIcon }[] = [{ id: 'reservations', label: 'Rezervasyonlar', icon: CalendarRange }, { id: 'events', label: 'Etkinlikler', icon: PartyPopper }, { id: 'calendar', label: 'Takvim', icon: CalendarDays }, { id: 'settings', label: 'Ayarlar', icon: Settings }];
const KEY = 'mola-agenda-part';

export function AgendaHub({ role, initialDay, initialPart }: { role: Role; initialDay?: string; initialPart?: 'settings' }) {
  // Takvim (day notes): the owner and the Müdür; the cashier and waiters see reservations and events only. Ayarlar: the owner.
  const owner = role === 'owner' || role === 'manager', parts = PARTS.filter(p => (owner || p.id !== 'calendar') && (role === 'owner' || p.id !== 'settings'));
  const resvOn = usePackage().has('reservations');
  const [part, setPart] = useState<Part>(() => {
    if (initialDay && owner) return 'calendar';
    if (initialPart && parts.some(p => p.id === initialPart)) return initialPart;
    try { const v = localStorage.getItem(KEY) as Part | null; if (v && parts.some(p => p.id === v)) return v; } catch { /* preference only */ }
    // Without "Rezervasyon ve etkinlik" in the package the owner starts on Takvim (the other two are locked).
    return !resvOn && owner ? 'calendar' : parts[0].id;
  });
  useEffect(() => { try { localStorage.setItem(KEY, part); } catch { /* preference only */ } }, [part]);
  return <div className="agenda-hub">
    <PillTabs label="Ajanda bölümleri" className="agenda-parts" value={part} onChange={setPart} items={parts.map(p => ({ id: p.id, label: p.label, icon: p.icon, locked: !resvOn && p.id !== 'calendar' }))} />
    {owner && part !== 'settings' && resvOn && <div className="home-links agenda-links"><PlaceLink to={{ view: 'reports', tab: 'reservations' }}>Rezervasyon raporu</PlaceLink></div>}
    {part === 'calendar' && owner && <CalendarPart initialDay={initialDay} reservations={resvOn} />}
    {part !== 'calendar' && !resvOn && <FeatureLockView feature="reservations" compact onClose={owner ? () => setPart('calendar') : undefined} />}
    {part === 'reservations' && resvOn && <ReservationsTab />}
    {part === 'events' && resvOn && <EventsTab />}
    {part === 'settings' && resvOn && <div className="settings-shell home-settings"><div className="settings-page"><div className="settings-page-body"><ReservationSettingsCard /></div></div></div>}
  </div>;
}

/** Takvim: the owner's Ajanda with each day's reservations and events marked and listed above the notes. */
function CalendarPart({ initialDay, reservations = true }: { initialDay?: string; reservations?: boolean }) {
  const [range, setRange] = useState<[string, string] | null>(null);
  const onRange = useCallback((from: string, to: string) => setRange(r => r && r[0] === from && r[1] === to ? r : [from, to]), []);
  const { data } = useReservations(reservations ? range?.[0] ?? null : null, reservations ? range?.[1] ?? null : null);
  const live = useMemo(() => (data?.reservations ?? []).filter(r => r.status === 'booked' || r.status === 'seated'), [data]);
  const marks = useMemo(() => {
    const m = new Map<string, string>();
    const days = new Set([...live.map(r => r.day), ...(data?.events ?? []).map(e => e.day)]);
    for (const day of days) {
      const n = live.filter(r => r.day === day).length, ev = (data?.events ?? []).filter(e => e.day === day);
      m.set(day, [n ? `${n} rezervasyon` : '', ...ev.map(e => `etkinlik: ${e.name}`)].filter(Boolean).join(', '));
    }
    return m;
  }, [live, data]);
  const extra = (day: string) => {
    const list = live.filter(r => r.day === day), events = (data?.events ?? []).filter(e => e.day === day);
    if (!list.length && !events.length) return null;
    return <div className="agenda-resv" aria-label="Bu günün rezervasyonları">
      {events.map(e => <p key={e.id} className="agenda-resv-event"><strong>Etkinlik: {e.name}</strong> · {e.start}{e.end ? `–${e.end}` : ''} · {e.tables.length} masa{e.closedAt ? ' · kapandı' : ''}</p>)}
      {list.length > 0 && <ul>{list.map(r => <li key={r.id}><span className="resv-time small">{r.time}</span><span><strong>{r.name}</strong> · {r.people} kişi · {r.tableName}</span><span className={`resv-status ${r.status}`}>{statusNames[r.status]}</span></li>)}</ul>}
    </div>;
  };
  return <Agenda initialDay={initialDay} marks={marks} onRange={onRange} dayExtra={extra} />;
}

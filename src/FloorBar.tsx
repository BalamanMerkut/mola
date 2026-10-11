import { useEffect, useState } from 'react';
import { BellRing, CalendarClock, ReceiptText, Sparkles } from 'lucide-react';
import type { TableView } from '../packages/domain/types';
import { api, money } from './api';
import { reportToday } from './ReportPeriod';
import type { Floor } from './ReservationFloor';
import './floor-bar.css';
// The staff side of Sipariş al (rows with "+", the basket bar); the Composer itself lives in src/components.tsx.
import './staff-order.css';

/*
 * Masalar, the compact way (no slogan, no four big number cards; the tables start near the top):
 * - the waiter's phone (≤ 700 px): one thin line "Masalar · 5 açık · ₺1.240", filter chips with counts, then a
 *   three-column grid of small tiles (number, amount or "boş", one state word);
 * - the counter computer or tablet (owner, cashier; ≥ 900 px): one thin line of the day's figures beside the cash chip and
 *   the table actions (FloorHead in Workspace), then the usual table cards.
 */
export type FloorFilter = 'all' | 'open' | 'empty' | 'ready';

/**
 * Today's sales for the owner's line ("Bugün ₺3.540"), read from the same report as Satış ve Raporlar → Özet, once a minute
 * while Masalar is open. `null` when it cannot be read (the report code is not entered yet): the line then leaves it out.
 * Never for the cashier: the expected cash stays hidden from whoever counts the drawer.
 */
export function useTodaySales(active: boolean) {
  const [sales, setSales] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const read = () => { const day = reportToday(); void api<{ sales: number }>(`/api/staff/reports/overview?from=${day}&to=${day}`).then(r => { if (live) setSales(r.sales); }).catch(() => { if (live) setSales(null); }); };
    read(); const id = setInterval(() => { if (!document.hidden) read(); }, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [active]);
  return active ? sales : null;
}

/** "Masalar · 5 açık · ₺1.240": what the old cards said, in one line. */
export function WaiterFloorLine({ open, seats, outstanding }: { open: number; seats: number; outstanding: number }) {
  return <p className="floor-line" aria-label="Masa özeti"><strong>Masalar</strong><span>{open} açık / {seats}</span><span>{money(outstanding)}</span></p>;
}

/**
 * The counter's line: "5/12 açık · Açık hesap ₺1.240 · Bugün ₺3.540 · Mutfakta 3 · Onayda 4" (Bugün only for the owner).
 * 9 Ekim kullanıcı testi (K-F): "0 bekleyen" while four QR orders waited for approval; `kitchen` is new + preparing,
 * `approval` the orders still waiting for a waiter's (or the kitchen's) approval, shown only when there are some.
 */
export function CounterFloorLine({ open, seats, outstanding, today, kitchen, approval, ready }: { open: number; seats: number; outstanding: number; today: number | null; kitchen: number; approval: number; ready: number }) {
  return <p className="floor-line counter" aria-label="Günün özeti">
    <span><strong>{open}/{seats}</strong> açık</span>
    <span>Açık hesap <strong>{money(outstanding)}</strong></span>
    {today !== null && <span>Bugün <strong>{money(today)}</strong></span>}
    <span data-testid="floor-kitchen">Mutfakta <strong>{kitchen}</strong></span>
    {approval > 0 && <span className="floor-line-approval" data-testid="floor-approval">Onayda <strong>{approval}</strong></span>}
    {ready > 0 && <span className="floor-line-ready"><strong>{ready}</strong> servise hazır</span>}
  </p>;
}

/** Tümü · Açık · Boş · Hazır with their counts; "Hazır" lights up while something waits to be carried. */
export function FloorFilters({ value, onChange, counts }: { value: FloorFilter; onChange: (f: FloorFilter) => void; counts: Record<FloorFilter, number> }) {
  const names: [FloorFilter, string][] = [['all', 'Tümü'], ['open', 'Açık'], ['empty', 'Boş'], ['ready', 'Hazır']];
  return <div className="floor-filters" role="group" aria-label="Masa filtresi">{names.map(([id, name]) => <button type="button" key={id} aria-pressed={value === id} className={`${value === id ? 'selected' : ''}${id === 'ready' && counts.ready > 0 ? ' attention' : ''}`} onClick={() => onChange(id)}>{name}<span>{counts[id]}</span></button>)}</div>;
}

/** One small tile: the table's number, its open amount or "boş", one word for its state. */
export function CompactTable({ table, state, floor, calls, onOpen }: { table: TableView; state: { label: string; tone: string }; floor: Floor; calls: ('bill' | 'call')[]; onOpen: () => void }) {
  const mark = !table.account ? floor.marks.get(table.id) : undefined;
  const word = table.needsCleaning ? 'Temizlik' : mark ? mark.phase === 'ask' ? 'Geldi mi?' : `Rezerve ${mark.mark.time}` : state.label === 'Servise hazır' ? 'Hazır' : table.account ? state.label : '';
  const tone = table.needsCleaning ? 'cleaning' : mark ? mark.phase === 'ask' ? 'asking' : 'reserved' : state.label === 'Servise hazır' ? 'ready' : table.account ? 'open' : 'empty';
  return <button type="button" className={`floor-tile ${tone}`} data-table={table.id} onClick={onOpen} aria-label={`${table.name}${table.account ? ` · ${money(table.account.balance)}` : ' · boş'}${word ? ` · ${word}` : ''}${calls.length ? ` · ${calls.includes('bill') ? 'Hesap istiyor' : 'Garson çağırıyor'}` : ''}`}>
    <span className="floor-tile-top"><strong>{table.name.replace(/^Masa\s+/i, '')}</strong>{calls.length > 0 && <span className="floor-tile-call" aria-hidden="true">{calls.includes('bill') ? <ReceiptText size={13} /> : <BellRing size={13} />}</span>}</span>
    <span className="floor-tile-amount">{table.account ? money(table.account.balance) : 'boş'}</span>
    {word && <span className="floor-tile-state">{tone === 'reserved' || tone === 'asking' ? <CalendarClock size={12} aria-hidden="true" /> : tone === 'cleaning' ? <Sparkles size={12} aria-hidden="true" /> : null}{word}</span>}
  </button>;
}

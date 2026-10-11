import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { api, money } from './api';
import { reportToday } from './ReportPeriod';
import './report-years.css';

/*
 * Satış ve Raporlar by calendar year (docs/HIZ_TESTI_5_YIL.md, "Faz 2"):
 *   YearPicker  the "Yıl ▾" chip of the period bar: a tap chooses this year, the menu any earlier year with records;
 *   YearTable   "Tümü" as a table of years (Satış, İade, Gider, Elde kalan, KDV) with the grand total, served from the
 *               yearly roll-ups (GET /api/staff/reports/years); a year opens that year.
 */
export type Range = { from: string; to: string };
type YearRow = { year: string; sales: number; refunds: number; expenses: number; kept: number; orders: number; vat?: number };
type Years = { today: string; years: string[]; table: { years: YearRow[]; total: YearRow } };

/** A calendar year as a report period: this year up to today (no empty days ahead), an earlier one whole. */
export function yearRange(year: string, today = reportToday()): Range { return { from: `${year}-01-01`, to: today.startsWith(year) ? today : `${year}-12-31` }; }
/** The year a period is, if it is one (yearRange); null otherwise. */
export function yearOf(r: Range, today = reportToday()) {
  if (!/^\d{4}-01-01$/.test(r.from)) return null;
  const y = r.from.slice(0, 4), whole = yearRange(y, today);
  return r.to === whole.to ? y : null;
}

/** The years with records, newest first, and the table of years; read once per screen. */
function useYears(on: boolean) {
  const [data, setData] = useState<Years | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!on || data) return;
    let live = true;
    api<Years>('/api/staff/reports/years').then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [on, data]);
  return { data, error };
}

/** "Yıl ▾": chooses this year at once; the menu lists the earlier years that have records. */
export function YearPicker({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false), [end, setEnd] = useState(false), box = useRef<HTMLDivElement>(null), today = reportToday();
  const chosen = yearOf(range, today), { data } = useYears(open || !!chosen);
  const years = data?.years.length ? data.years : [today.slice(0, 4)];
  // Near the right edge (a phone: the chip ends the first row) the menu opens leftwards, inside the screen.
  useLayoutEffect(() => { if (open && box.current) setEnd(box.current.getBoundingClientRect().left + 230 > document.documentElement.clientWidth - 8); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="period-year" ref={box}>
    <button type="button" className={chosen ? 'active' : ''} aria-pressed={!!chosen} aria-haspopup="menu" aria-expanded={open} aria-label={chosen ? `Yıl: ${chosen}` : 'Yıl'}
      onClick={() => { if (!chosen) onChange(yearRange(today.slice(0, 4), today)); setOpen(o => !o); }}>
      <CalendarRange size={14} aria-hidden="true" />{chosen ?? 'Yıl'}<ChevronDown size={14} aria-hidden="true" className="period-year-chevron" />
    </button>
    {open && <div className={`period-year-menu${end ? ' end' : ''}`} role="menu" aria-label="Yıl seçin">
      {years.map(y => <button type="button" role="menuitemradio" aria-checked={chosen === y} key={y} className={chosen === y ? 'active' : ''} onClick={() => { onChange(yearRange(y, today)); setOpen(false); }}>
        <span>{y}</span><small>{y === today.slice(0, 4) ? 'bu yıl, bugüne kadar' : 'tüm yıl'}</small>{chosen === y && <Check size={15} aria-hidden="true" />}</button>)}
    </div>}
  </div>;
}

/** "Tümü": one row a year, newest first, and the total; a row opens its year. KDV only with "Gelişmiş raporlar" (the server leaves it out). */
export function YearTable({ onYear }: { onYear: (r: Range) => void }) {
  const { data, error } = useYears(true);
  if (error) return null;
  if (!data) return <section className="panel year-table-card" aria-label="Yıllara göre"><p role="status" className="report-loading">Yıllar yükleniyor…</p></section>;
  const rows = data.table.years.filter(y => y.sales || y.expenses || y.refunds || y.orders), vat = rows.some(y => y.vat !== undefined);
  if (rows.length < 2) return null;
  return <section className="panel year-table-card" aria-label="Yıllara göre">
    <div className="report-section-heading"><h3>Yıllara göre</h3><span className="muted small">Bir yıla dokunun, o yılın raporu açılır</span></div>
    <table className={`year-table${vat ? ' with-vat' : ''}`}>
      <thead><tr><th scope="col">Yıl</th><th scope="col">Satış</th><th scope="col" className="year-col-more">İade</th><th scope="col" className="year-col-more">Gider</th><th scope="col">Elde kalan</th>{vat && <th scope="col" className="year-col-more">KDV</th>}</tr></thead>
      <tbody>{rows.map(y => <tr key={y.year}>
        <th scope="row"><button type="button" className="year-open" aria-label={`${y.year} yılını aç`} onClick={() => onYear(yearRange(y.year, data.today))}>{y.year}<ChevronRight size={14} aria-hidden="true" /></button>
          <small className="year-more-line">İade {money(y.refunds)} · Gider {money(y.expenses)}{vat ? ` · KDV ${money(y.vat ?? 0)}` : ''}</small></th>
        <td>{money(y.sales)}</td><td className="year-col-more">{money(y.refunds)}</td><td className="year-col-more">{money(y.expenses)}</td><td className={y.kept < 0 ? 'year-negative' : ''}>{money(y.kept)}</td>{vat && <td className="year-col-more">{money(y.vat ?? 0)}</td>}</tr>)}</tbody>
      <tfoot><tr><th scope="row">Toplam<small className="year-more-line">İade {money(data.table.total.refunds)} · Gider {money(data.table.total.expenses)}{vat ? ` · KDV ${money(data.table.total.vat ?? 0)}` : ''}</small></th><td>{money(data.table.total.sales)}</td><td className="year-col-more">{money(data.table.total.refunds)}</td><td className="year-col-more">{money(data.table.total.expenses)}</td><td className={data.table.total.kept < 0 ? 'year-negative' : ''}>{money(data.table.total.kept)}</td>{vat && <td className="year-col-more">{money(data.table.total.vat ?? 0)}</td>}</tr></tfoot>
    </table>
    <p className="muted small year-note">Elde kalan = satış − iadeler − kart komisyonu − giderler. Bu yılın satırı bugüne kadardır.</p>
  </section>;
}

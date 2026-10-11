import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, Ellipsis, LogOut, X, type LucideIcon } from 'lucide-react';
import type { Role } from '../packages/domain/types';
import './bottom-nav.css';

/*
 * Phones (≤ 700 px): a fixed bottom tab bar instead of the sliding top menu. Four places each role uses most, then
 * "Daha fazla", which opens a sheet with the rest and "Çıkış yap". Badges and red dots come along (a count on "Servise
 * hazır", Destek's red dot also on "Daha fazla"; the owner's Bildirimler is the bell on the slim top bar).
 * 10 Ekim düzeni: the owner and the Müdür have "Kasa" (Kasa ve giderler) in the bar; Ayarlar and Stok wait in "Daha fazla". Above 700 px the bar is not shown (CSS): tablets and the computer keep
 * the sidebar. The kitchen account has no bar: it works in Mutfak modu (src/KitchenMode.tsx).
 * Every bar item says its full name to screen readers and tests ("Satış ve Raporlar"), its short one on screen ("Raporlar").
 */
/** locked: a closed service the owner/Müdür still sees, faded with "Pakette yok" (src/FeatureLock.tsx). */
export type NavItem = { id: string; label: string; icon: LucideIcon; locked?: boolean };
/** The four places in the bar, per role, in order; missing ones (no right) are skipped and the next useful view moves up. */
const PRIMARY: Partial<Record<Role | string, string[]>> = {
  waiter: ['tables', 'staff', 'ready', 'agenda'],
  cashier: ['tables', 'staff', 'cash', 'agenda'],
  owner: ['tables', 'staff', 'cash', 'reports'],
  manager: ['tables', 'staff', 'cash', 'reports'],
};
const DEFAULT_PRIMARY = ['tables', 'staff', 'reports', 'agenda'];
/** Never pulled up into the bar: they live in "Daha fazla". */
const ONLY_MORE = new Set(['password', 'support', 'announcements', 'kitchen', 'integrations']);
const isLocked = (i: NavItem) => !!i.locked;
const SHORT: Record<string, string> = { reports: 'Raporlar', menu: 'Menü', ready: 'Servise hazır', cash: 'Kasa' };
const shortLabel = (item: NavItem, role: string) => item.id === 'agenda' ? role === 'owner' ? 'Ajanda' : 'Rezervasyon' : SHORT[item.id] ?? item.label;

/** True while the window is phone-wide (≤ 700 px): where the bottom bar and the waiter's compact screens are used. */
export const PHONE_QUERY = '(max-width: 700px)';
export function useNarrow(query = PHONE_QUERY) {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query), sync = () => setNarrow(list.matches);
    sync(); list.addEventListener('change', sync);
    return () => list.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}

export function splitNav(items: NavItem[], role: string) {
  const order = PRIMARY[role] ?? DEFAULT_PRIMARY, has = (id: string) => items.some(i => i.id === id);
  const ids = order.filter(has);
  // A faded (closed) service never takes one of the four places in the bar: it waits in "Daha fazla".
  const order2 = order.filter(id => has(id) && !isLocked(items.find(i => i.id === id)!));
  ids.splice(0, ids.length, ...order2);
  for (const i of items) { if (ids.length >= 4) break; if (!ids.includes(i.id) && !ONLY_MORE.has(i.id) && !isLocked(i)) ids.push(i.id); }
  return { primary: ids.map(id => items.find(i => i.id === id)!), more: items.filter(i => !ids.includes(i.id)) };
}

export function BottomNav({ items, role, view, onGo, counts = {}, dots = {}, onLogout, loggingOut }: {
  items: NavItem[]; role: string; view: string; onGo: (id: string) => void;
  /** A number badge per view ("Servise hazır": orders to carry). */
  counts?: Record<string, number>;
  /** A red dot per view (Destek: unread notifications or announcements; the Müdür's Duyurular). */
  dots?: Record<string, boolean>;
  onLogout: () => void; loggingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { primary, more } = splitNav(items, role);
  const moreActive = more.some(i => i.id === view), moreDot = more.some(i => dots[i.id]), moreCount = more.reduce((n, i) => n + (counts[i.id] ?? 0), 0);
  const titleId = useId(), sheet = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null);
  // The sheet takes the focus while open; Escape or a tap outside closes it and gives the focus back to "Daha fazla".
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>('button')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  function close() { setOpen(false); opener.current?.focus(); }
  const go = (id: string) => { setOpen(false); onGo(id); };
  const count = (n: number | undefined, label: string) => n ? <><span className="bottom-nav-count" aria-hidden="true">{n}</span><span className="sr-only">, {n} {label}</span></> : null;

  return <>
    <nav className="bottom-nav" aria-label="Alt menü">
      {primary.map(item => <button type="button" key={item.id} className={`bottom-nav-item${view === item.id ? ' active' : ''}`} aria-current={view === item.id ? 'page' : undefined} data-view={item.id} onClick={() => go(item.id)}>
        <span className="sr-only">{item.label}</span>
        <span className="bottom-nav-icon"><item.icon size={22} aria-hidden="true" />{count(counts[item.id], 'sipariş')}{dots[item.id] && <span className="red-dot bottom-nav-dot" aria-hidden="true" />}</span>
        <span className="bottom-nav-label" aria-hidden="true">{shortLabel(item, role)}</span>
      </button>)}
      {more.length > 0 && <button type="button" ref={opener} className={`bottom-nav-item${moreActive || open ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={open} data-view="more" onClick={() => setOpen(o => !o)}>
        <span className="sr-only">Daha fazla</span>
        <span className="bottom-nav-icon"><Ellipsis size={22} aria-hidden="true" />{count(moreCount, 'bekleyen')}{moreDot && <span className="red-dot bottom-nav-dot" aria-hidden="true" />}</span>
        <span className="bottom-nav-label" aria-hidden="true">Daha fazla</span>{moreDot && <span className="sr-only">, okunmamış bildirim var</span>}
      </button>}
    </nav>
    {open && <div className="bottom-sheet-layer" onClick={close}>
      <div className="bottom-sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
        <span className="bottom-sheet-grip" aria-hidden="true" />
        <div className="bottom-sheet-head"><h2 id={titleId}>Daha fazla</h2><button type="button" className="icon-btn" aria-label="Kapat" onClick={close}><X size={20} /></button></div>
        <ul className="bottom-sheet-list">{more.map(item => <li key={item.id}><button type="button" className={(view === item.id ? 'active' : '') + (item.locked ? ' nav-locked' : '')} aria-label={item.locked ? `${item.label}, pakette yok` : undefined} aria-current={view === item.id ? 'page' : undefined} data-view={item.id} onClick={() => go(item.id)}>
          <span className="bottom-sheet-icon"><item.icon size={20} aria-hidden="true" /></span><span className="bottom-sheet-label">{item.label}</span>{item.locked && <span className="feature-locked-hint">Pakette yok</span>}
          {dots[item.id] && <span className="red-dot bottom-sheet-dot" title="Okunmamış bildirim var"><span className="sr-only">, okunmamış bildirim var</span></span>}
          {!!counts[item.id] && <span className="nav-count">{counts[item.id]}</span>}
          <ChevronRight size={18} aria-hidden="true" className="bottom-sheet-chevron" />
        </button></li>)}</ul>
        <button type="button" className="bottom-sheet-logout" disabled={loggingOut} onClick={() => { setOpen(false); onLogout(); }}><LogOut size={19} aria-hidden="true" />{loggingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</button>
      </div>
    </div>}
  </>;
}

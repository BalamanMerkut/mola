import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import './pill-tabs.css';

/**
 * The centred pill tab bar of Ayarlar, shared by every in-page tab row of the café app (Menü yönetimi, Satış ve Raporlar,
 * Destek). It follows the width it gets, not the window:
 * - one row when every tab fits;
 * - otherwise two centred rows of equal columns (half the tabs each), when those fit (tablets, the café computer);
 * - otherwise (phones, under 580 px) one row that slides inside itself, with the chosen tab brought into view; the page
 *   itself never scrolls sideways.
 * Every tab is at least 44 px tall. `kind` keeps each screen's meaning for screen readers and tests: 'nav' (a navigation
 * with aria-current="page"), 'tabs' (a tablist of tabs with aria-selected) or 'filter' (a group of pressed buttons).
 * Opt-in looks (Satış ve Raporlar; every other bar keeps the plain one):
 * - `variant="sub"`: the quieter second row under a main bar: text tabs on a hairline, the chosen one underlined;
 * - `phoneStack`: on a phone-wide bar (under 480 px) each tab's icon sits above its label and the tabs share the full
 *   width, so a few short tabs (four groups) fit one row without sliding.
 */
export type PillTab<T extends string> = {
  id: T; label: ReactNode; icon?: LucideIcon;
  /** Small chip after the label (a count, "Eksik"); `badgeTone: 'warn'` for what needs a look. */
  badge?: ReactNode; badgeTone?: 'quiet' | 'warn';
  /** Extra marks inside the tab (a red dot), not part of its name. */
  extra?: ReactNode;
  title?: string; ariaLabel?: string;
  /** Hizmet paketi: not in the business's package (faded, "Pakette yok"; the page shows src/FeatureLock.tsx). */
  locked?: boolean;
};
type Layout = 'one' | 'two' | 'scroll';
const PHONE = 580;

export function PillTabs<T extends string>({ items, value, onChange, label, kind = 'nav', className = '', wrapClassName = '', idPrefix, panelId, dataAttr, variant = 'main', phoneStack = false }: {
  items: PillTab<T>[]; value: T; onChange: (id: T) => void; label: string; kind?: 'nav' | 'tabs' | 'filter'; className?: string; wrapClassName?: string;
  /** 'tabs': ids of the tabs (`<prefix>-<id>`) and the panel each controls (`panelId(id)`). */
  idPrefix?: string; panelId?: (id: T) => string;
  /** Adds data-<name>="<id>" to each tab (tests and styles). */
  dataAttr?: string;
  /** 'sub': the second, quieter row under a main bar (see above). */
  variant?: 'main' | 'sub';
  /** Phones: icon above label, the tabs filling the row (see above). */
  phoneStack?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null), row = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<Layout>('one');
  // Natural widths are read from each tab's content (independent of the current layout), so the choice never flips back and forth.
  const choose = useCallback(() => {
    const box = wrap.current, bar = row.current;
    if (!box || !bar) return;
    const width = box.clientWidth, buttons = [...bar.querySelectorAll<HTMLElement>(':scope > .pill-tab')];
    if (!buttons.length || !width) return;
    const style = getComputedStyle(bar), gap = parseFloat(style.columnGap) || 0, pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const natural = buttons.map(b => { const s = getComputedStyle(b), inner = b.querySelector<HTMLElement>('.pill-tab-inner'); return Math.ceil((inner?.scrollWidth ?? b.scrollWidth) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + 1); });
    const one = natural.reduce((n, w) => n + w, 0) + gap * (natural.length - 1) + pad;
    let next: Layout;
    if (one <= width) next = 'one';
    else if (width < PHONE || buttons.length < 3) next = 'scroll';
    else {
      const cols = Math.ceil(buttons.length / 2);
      const columns = Array.from({ length: cols }, (_, i) => Math.max(natural[i], natural[i + cols] ?? 0));
      next = columns.reduce((n, w) => n + w, 0) + gap * (cols - 1) + pad <= width ? 'two' : 'scroll';
    }
    setLayout(l => l === next ? l : next);
  }, []);
  useLayoutEffect(() => {
    choose();
    const box = wrap.current; if (!box || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => choose()); watch.observe(box);
    // Also on window resizes (a turned tablet), in case the observer waits for the next paint.
    window.addEventListener('resize', choose);
    // Web fonts change label widths once they arrive.
    void document.fonts?.ready.then(() => choose()).catch(() => {});
    return () => { watch.disconnect(); window.removeEventListener('resize', choose); };
  }, [choose, items.length]);
  useLayoutEffect(() => { choose(); });
  // In the sliding row the chosen tab is brought into view (to the middle of the row).
  useLayoutEffect(() => {
    const bar = row.current, item = bar?.querySelector<HTMLElement>('.pill-tab.active');
    if (!bar || !item || layout !== 'scroll' || bar.scrollWidth <= bar.clientWidth) return;
    if (item.offsetLeft < bar.scrollLeft || item.offsetLeft + item.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: item.offsetLeft - (bar.clientWidth - item.offsetWidth) / 2 });
  }, [value, layout]);

  const cols = Math.ceil(items.length / 2);
  const tabs = items.map(t => {
    const active = t.id === value;
    const semantics = kind === 'nav' ? { 'aria-current': active ? 'page' as const : undefined } : kind === 'tabs' ? { role: 'tab', 'aria-selected': active, id: idPrefix ? `${idPrefix}-${t.id}` : undefined, 'aria-controls': panelId?.(t.id) } : { 'aria-pressed': active };
    return <button type="button" key={t.id} className={`pill-tab${active ? ' active' : ''}${t.locked ? ' locked' : ''}`} title={t.title} aria-label={t.ariaLabel} {...semantics} {...(dataAttr ? { [`data-${dataAttr}`]: t.id } : {})} onClick={() => onChange(t.id)}>
      <span className="pill-tab-inner">{t.icon && <t.icon size={17} aria-hidden="true" />}<span className="pill-tab-label">{t.label}</span>{t.badge !== undefined && t.badge !== null && t.badge !== false && <span className={`pill-tab-badge ${t.badgeTone ?? 'quiet'}`}>{t.badge}</span>}{t.locked && <span className="pill-tab-locked">Pakette yok</span>}{t.extra}</span>
    </button>;
  });
  const common = { ref: row as never, className: `pill-tabs layout-${layout} ${className}`.trim(), style: layout === 'two' ? { gridTemplateColumns: `repeat(${cols}, auto)` } : undefined };
  return <div className={['pill-tabs-wrap', variant === 'sub' && 'pill-tabs-sub', phoneStack && 'pill-tabs-stack', wrapClassName].filter(Boolean).join(' ')} ref={wrap}>
    {kind === 'nav' ? <nav {...common} aria-label={label}>{tabs}</nav>
      : kind === 'tabs' ? <div {...common} role="tablist" aria-label={label}>{tabs}</div>
      : <div {...common} role="group" aria-label={label}>{tabs}</div>}
  </div>;
}

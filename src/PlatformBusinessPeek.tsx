import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';
import { ContactLinks, type DetailTab } from './PlatformDetail';
import { dateTime, planText, qrOrderingFact, rowStatus, seenAgo, shortDate, type Business } from './platformStatus';
import './platform-peek.css';

const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 599.98px)').matches;

/**
 * Mola Yönetim → Destek (8 Ekim): the business name in a ticket's header and in the ticket list opens a short preview, so
 * the vendor answers knowing the café without leaving the conversation: status, package and services, licence and days
 * left, trial, last contact, QR ordering, open tickets, phone and e-mail (with copy), and the way to its page, Hizmet or
 * Lisans. A popover under the name; a bottom sheet on phones. Escape or a tap outside closes it and gives focus back.
 */
export function BusinessPeek({ business: l, onOpen, className = '' }: { business: Business; onOpen: (tab: DetailTab) => void; className?: string }) {
  const [open, setOpen] = useState(false), [style, setStyle] = useState<CSSProperties>({ opacity: 0 }), [sheet, setSheet] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null), titleId = useId();
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = trigger.current?.getBoundingClientRect(), el = box.current;
      if (!a || !el) return;
      if (phone()) { setSheet(true); setStyle({}); return; }
      setSheet(false);
      const vw = document.documentElement.clientWidth, width = Math.min(390, vw - 24), height = el.scrollHeight + 2;
      const below = window.innerHeight - a.bottom - 16, above = below < height && a.top > below;
      setStyle({ width, left: Math.max(12, Math.min(a.left, vw - width - 12)), top: above ? Math.max(12, a.top - Math.min(height, a.top - 16) - 6) : a.bottom + 6, maxHeight: Math.max(160, above ? a.top - 16 : below), opacity: 1 });
    };
    place(); box.current?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !trigger.current?.contains(t)) close(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const status = rowStatus(l), qr = qrOrderingFact(l);
  const licence = !l.endsAt ? 'Başlatılmadı' : !l.active ? `Süresi doldu · ${shortDate(l.endsAt)}` : `${l.daysRemaining} gün kaldı · bitiş ${shortDate(l.endsAt)}`;
  const go = (tab: DetailTab) => { setOpen(false); onOpen(tab); };
  const facts: [string, string, string?][] = [
    ['Paket', l.services ? l.services.packageName : l.service === 'menu' ? 'Sadece QR menü' : 'Tam sistem', l.services ? `${l.services.features.length} hizmet dahil` : undefined],
    ['Lisans', planText(l), licence],
    ['Deneme', l.kind === 'trial' ? (l.active ? `Denemede · ${l.daysRemaining} gün kaldı` : 'Deneme bitti') : 'Yok · abonelik', l.kind === 'trial' && l.services ? `Aboneliğe geçince “${l.services.packageName}”` : undefined],
    ['Son bağlantı', seenAgo(l.lastSeenAt), l.lastSeenAt ? dateTime(l.lastSeenAt) : undefined],
    ['QR siparişleri', qr.value, qr.sub],
    ['Açık talep', String(l.openTickets)],
  ];
  return <>
    <button ref={trigger} type="button" className={`peek-trigger ${className}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${l.name}: işletme özeti`} onClick={() => open ? close() : setOpen(true)}>{l.name}</button>
    {open && createPortal(<>
      {sheet && <div className="peek-backdrop" aria-hidden="true" onClick={() => close()} />}
      <div ref={box} className={`peek${sheet ? ' sheet' : ''}`} role="dialog" aria-labelledby={titleId} tabIndex={-1} style={style}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
        <div className="peek-head"><h3 id={titleId}>{l.name}</h3><span className={`status-chip ${status.tone}`}>{status.label}</span><button type="button" className="icon-btn peek-close" aria-label="Özeti kapat" onClick={() => close()}><X size={18} /></button></div>
        <dl className="peek-facts">{facts.map(([k, v, sub]) => <div key={k}><dt>{k}</dt><dd>{v}{sub && <small>{sub}</small>}</dd></div>)}</dl>
        <ContactLinks phone={l.invoice?.phone} email={l.invoice?.email} name={l.contactName} />
        <div className="peek-actions"><button type="button" className="btn primary small-btn" onClick={() => go('summary')}>İşletme sayfası<ChevronRight size={15} aria-hidden="true" /></button><button type="button" className="btn secondary small-btn" onClick={() => go('service')}>Hizmet</button><button type="button" className="btn secondary small-btn" onClick={() => go('license')}>Lisans</button></div>
      </div>
    </>, document.querySelector('.yonetim') ?? document.body)}
  </>;
}

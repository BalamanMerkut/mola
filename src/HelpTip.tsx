import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

export function HelpTip({ title, children }: { title: string; children: string }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const id = useId(), anchor = useRef<HTMLButtonElement>(null), bubble = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!anchor.current || !bubble.current) return;
      const a = anchor.current.getBoundingClientRect();
      const width = Math.min(290, document.documentElement.clientWidth - 24);
      bubble.current.style.width = width + 'px';
      const height = bubble.current.scrollHeight + 2;
      const availableBelow = window.innerHeight - a.bottom - 20;
      const above = availableBelow < height && a.top > availableBelow;
      const maxHeight = Math.max(40, above ? a.top - 20 : availableBelow);
      setPosition({ visibility: 'visible', width, maxHeight, left: Math.max(12, Math.min(a.left, document.documentElement.clientWidth - width - 12)), top: above ? Math.max(12, a.top - Math.min(height, maxHeight) - 8) : a.bottom + 8 });
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, children]);
  return <span className="help-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <button ref={anchor} type="button" className="help-dot" aria-label={title + ' hakkında bilgi'} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={e => { e.preventDefault(); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>i</button>
    {open && <span ref={bubble} id={id} role="tooltip" className="help-bubble" style={position}>{children}</span>}
  </span>;
}

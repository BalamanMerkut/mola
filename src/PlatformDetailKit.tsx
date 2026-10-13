import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { HelpTip } from './HelpTip';
import type { Tone } from './platformStatus';
import './platform-detail.css';

/*
 * The pieces of a business page in Mola Yönetim (Özet, Lisans, Bilgiler, Destek; styles in platform-detail.css), so the tabs
 * read like the screens the owner likes (Hizmet, Satışlarım, Paketler): white cards on the page, a pastel icon tile and a
 * short title, the explanation behind a grey ⓘ in the card's top-right corner, small icon buttons.
 */

/** One card: icon tile, title, actions and ⓘ on the right. Still a region named after its title (the browser specs use them). */
export function DCard({ title, icon, tone = 'ok', tip, actions, label, className = '', children, id }: {
  title: ReactNode; icon?: ReactNode; tone?: Tone; tip?: string; actions?: ReactNode; label?: string; className?: string; children?: ReactNode;
  /** An anchor the page scrolls to (Özet → "Sunucu yedeğine bak", "Uzaktan bağlan"). */
  id?: string;
}) {
  const name = label ?? (typeof title === 'string' ? title : undefined);
  return <section id={id} className={`detail-section dcard ${className}`.trim()} aria-label={name}>
    <header className="dcard-head">
      {icon && <span className={`dcard-icon ${tone}`} aria-hidden="true">{icon}</span>}
      <h2>{title}</h2>
      {(actions || tip) && <span className="dcard-actions">{actions}{tip && <HelpTip title={name ?? 'Bu bölüm'}>{tip}</HelpTip>}</span>}
    </header>
    {children}
  </section>;
}

/**
 * One KPI tile on Özet: icon, name, the value large, a quiet line, an optional arrow to the tab it belongs to. `tone`: a state
 * colour (dot, tile edge) only for a state; `accent`: the icon tile's pastel colour when nothing is wrong.
 */
export type Fact = { label: string; value: string; sub?: string; tone?: Tone; accent?: Tone; icon?: ReactNode; go?: { label: string; onClick: () => void; disabled?: boolean } };
export function FactTiles({ facts, label }: { facts: Fact[]; label: string }) {
  return <dl className="detail-facts dtiles" aria-label={label}>{facts.map(f => <div key={f.label} className={`dtile${f.tone ? ` tone-${f.tone}` : ''}`}>
    <dt>{f.icon && <span className={`dtile-icon ${f.tone && f.tone !== 'ok' ? f.tone : f.accent ?? f.tone ?? 'idle'}`} aria-hidden="true">{f.icon}</span>}<span className="dtile-label">{f.label}</span></dt>
    <dd className={f.tone ? `dtile-value fact-${f.tone}` : 'dtile-value'}>{f.tone && <span className="fact-dot" aria-hidden="true" />}{f.value}</dd>
    {f.sub && <dd className="fact-sub">{f.sub}</dd>}
    {f.go && <dd className="dtile-go"><button type="button" className="dicon-btn" aria-label={f.go.label} title={f.go.label} disabled={f.go.disabled} onClick={f.go.onClick}><ChevronRight size={16} aria-hidden="true" /></button></dd>}
  </div>)}</dl>;
}

/** A small copy button (44 px to touch, a 16-px icon); shows a tick for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="dicon-btn" aria-label={label} title={label} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {}); }}>
    {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>;
}

/** Definition rows inside a card: the name small on the left, the value on the right, an optional copy/call button. */
export type Row = { label: string; value: ReactNode; copy?: string; copyLabel?: string; action?: ReactNode; tone?: Tone };
export function DefList({ rows, label, className = '' }: { rows: Row[]; label?: string; className?: string }) {
  return <dl className={`ddefs ${className}`.trim()} aria-label={label}>{rows.map(r => <div key={r.label}>
    <dt>{r.label}</dt><dd className={r.tone ? `fact-${r.tone}` : undefined}><span className="ddefs-value">{r.value}</span>{(r.action || r.copy) && <span className="ddefs-actions">{r.action}{r.copy && <CopyButton text={r.copy} label={r.copyLabel ?? `${r.label} kopyala`} />}</span>}</dd>
  </div>)}</dl>;
}

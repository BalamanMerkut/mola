import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { HelpTip } from './HelpTip';
import './platform-settings.css';

/*
 * Mola Yönetim → Ayarlar: the pieces every section is built from (styles in platform-settings.css), so the sections read like
 * Paketler and İletişim bilgileri: square white cards with a pastel icon tile, a short title and the grey ⓘ at the top right
 * (the explanation lives there, not in a paragraph), small 44 px icon buttons, and quiet status tiles.
 * Cards are plain <article>s, never named regions: each section keeps its one region ("Yedek", "Güncellemeler", …).
 */
export type Tone = 'green' | 'blue' | 'amber' | 'rose' | 'lilac' | 'grey';

/** A square card: icon tile, title, optional line under it, ⓘ top right, optional actions beside the title. */
export function SCard({ icon: Icon, title, sub, tip, tipLabel, aside, tone = 'green', className = '', children, wide = false, testId }: {
  icon: LucideIcon; title: ReactNode; sub?: ReactNode; tip?: string;
  /** The ⓘ's name ("<x> hakkında bilgi") when the title would clash with a field's label. */
  tipLabel?: string; aside?: ReactNode; tone?: Tone; className?: string; children?: ReactNode; wide?: boolean; testId?: string;
}) {
  return <article className={`ps-card${wide ? ' wide' : ''} ${className}`.trim()} data-testid={testId}>
    <header className="ps-card-head">
      <span className={`ps-tile ${tone}`} aria-hidden="true"><Icon size={19} /></span>
      <div className="ps-card-title"><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
      {aside && <div className="ps-card-aside">{aside}</div>}
      {tip && <span className="ps-card-tip"><HelpTip title={tipLabel ?? (typeof title === 'string' ? title : 'Bu kart')}>{tip}</HelpTip></span>}
    </header>
    {children}
  </article>;
}

/** A small square icon button (44 px); the name is said to screen readers and as a tooltip. */
export function IconBtn({ icon: Icon, label, onClick, disabled, tone, type = 'button', pressed, expanded, className = '', text }: {
  icon: LucideIcon; label: string; onClick?: () => void; disabled?: boolean; tone?: 'primary' | 'danger'; type?: 'button' | 'submit'; pressed?: boolean; expanded?: boolean; className?: string;
  /** A short word shown beside the icon on wider screens ("Yedekle"); the accessible name stays `label`. */
  text?: string;
}) {
  return <button type={type} className={`ps-icon-btn${tone ? ` ${tone}` : ''}${text ? ' with-text' : ''} ${className}`.trim()} aria-label={label} title={label} disabled={disabled} aria-pressed={pressed} aria-expanded={expanded} onClick={onClick}>
    <Icon size={18} aria-hidden="true" />{text && <span aria-hidden="true">{text}</span>}
  </button>;
}

/** A quiet status tile ("Son yedek · 8 Eki 03:45"). `tone` colours the dot only. */
export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return <div className={`ps-stat${tone ? ` ${tone}` : ''}`}>
    <dt>{tone && <i className="ps-dot" aria-hidden="true" />}{label}</dt>
    <dd>{value}</dd>
    {sub && <dd className="ps-stat-sub">{sub}</dd>}
  </div>;
}

/** A small state chip in a card head ("Açık", "Kapalı", "Pilot"). */
export const Chip = ({ tone = 'idle', children }: { tone?: 'ok' | 'warn' | 'bad' | 'idle' | 'info'; children: ReactNode }) => <span className={`ps-chip ${tone}`}>{children}</span>;

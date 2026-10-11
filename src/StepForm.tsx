import type { ReactNode } from 'react';
import { HelpTip } from './HelpTip';
import './step-form.css';

/*
 * Adım adım form (11 Ekim, sahibin "ilkel" bulduğu Etkinlik oluştur ve Kampanya pencereleri): numbered cards, one question each
 * ("Ne zaman?", "Kaç masa?"), plain labels, details in the grey ⓘ of the card's title, the same aligned grid on every width.
 *   Step       a card: number, title, optional "(isteğe bağlı)", ⓘ, then its fields.
 *   Choice     the segmented buttons of a card (aria-pressed), e.g. "Tarih aralığı · Her hafta · Her ay".
 * Fields are ordinary <label>s inside `.step-row` (one row of aligned fields that stacks on a phone).
 */
export function Step({ n, title, help, optional = false, children, className = '' }: { n?: number; title: string; help?: string; optional?: boolean; children: ReactNode; className?: string }) {
  return <section className={`step-card ${className}`.trim()} aria-label={title}>
    <div className="step-head">{n !== undefined && <span className="step-num" aria-hidden="true">{n}</span>}<h3>{title}{optional && <small> (isteğe bağlı)</small>}</h3>{help && <HelpTip title={title}>{help}</HelpTip>}</div>
    {children}
  </section>;
}
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void }) {
  return <div className="step-choice" role="group" aria-label={label}>{options.map(([v, text]) => <button type="button" key={v} aria-pressed={value === v} className={value === v ? 'selected' : ''} onClick={() => onChange(v)}>{text}</button>)}</div>;
}

import { useId, useRef, type ReactNode } from 'react';
import { Check, ImagePlus, Trash2, type LucideIcon } from 'lucide-react';
import { HelpTip } from './HelpTip';
// The kit's look; also needed where a kit piece opens outside Ayarlar (the automatic expense window in Satış ve Raporlar).
import './settings-workspace.css';

/*
 * The building blocks of every Ayarlar page (styles in settings-workspace.css), so all topics read alike: a white card
 * with an icon tile, a title and a short lead; setting rows with the name and a line on the left and the control on the
 * right; switches, segmented choices, fields, a Turkish file picker and a quiet empty state.
 */

/** A white card with an icon tile, a heading, an optional short lead and an optional thing on the right (a count, a button). */
export function Card({ icon, title, lead, aside, children, className = '', tip }: { icon: ReactNode; title: string; lead?: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string; tip?: string }) {
  const id = useId();
  return <section className={`settings-card ${className}`.trim()} aria-labelledby={id}>
    <div className="settings-card-head">{icon}<h3 id={id}>{title}{tip && <HelpTip title={title}>{tip}</HelpTip>}</h3>{aside}</div>
    {lead && <p className="settings-card-note">{lead}</p>}
    {children}
  </section>;
}
/**
 * Two columns of cards on a wide page (`settings-page wide`, from about 900 px of page), one column on phones and upright
 * tablets: the left column's cards, then the right's. Each column stacks its own cards, so a tall card never leaves a hole.
 */
export function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return <div className="settings-grid"><div className="settings-stack">{left}</div><div className="settings-stack">{right}</div></div>;
}
/** A small count chip for a card's head ("8", "2 yazıcı"). */
export const Count = ({ children }: { children: ReactNode }) => <span className="settings-block-count">{children}</span>;

/** One setting: name with help and a short line on the left, its control on the right (below it on a narrow screen). */
export function Row({ id, label, tip = label, help, line, children, stack = false }: { id: string; label: string; tip?: string; help?: string; line: ReactNode; children: ReactNode; stack?: boolean }) {
  return <div className={`settings-row${stack ? ' stack' : ''}`}>
    <div className="settings-row-copy">
      <div className="settings-row-title"><label htmlFor={id}>{label}</label>{help && <HelpTip title={tip}>{help}</HelpTip>}</div>
      <p id={`${id}-help`}>{line}</p>
    </div>
    <div className="settings-row-control">{children}</div>
  </div>;
}

/** An on/off switch with its word ("Açık" / "Kapalı") beside it. */
export function Toggle({ id, checked, disabled, onChange, label }: { id?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; label?: string }) {
  return <div className="settings-toggle"><span aria-hidden="true">{checked ? 'Açık' : 'Kapalı'}</span><input id={id} type="checkbox" aria-label={label} aria-describedby={id ? `${id}-help` : undefined} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /></div>;
}

/** Two to four choices side by side; the chosen one is white. */
export function Segmented<T extends string | number>({ value, options, onChange, label, disabled, wide = false }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean; wide?: boolean }) {
  return <div className={`settings-segmented${wide ? ' wide' : ''}`} role="group" aria-label={label}>
    {options.map(o => <button type="button" key={String(o.value)} title={o.title} aria-pressed={o.value === value} className={o.value === value ? 'selected' : ''} disabled={disabled} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>;
}

/** A labelled field: the name above, the control, then a quiet hint (and an error) below (outside the label, so the name stays short). */
export function Field({ label, hint, error, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return <div className={`settings-field ${className}`.trim()}><label><span className="settings-field-label">{label}</span>{children}</label>{hint && <span className="settings-field-hint">{hint}</span>}{error && <small className="field-error" role="alert">{error}</small>}</div>;
}

/**
 * The Turkish file picker ("Logo seç" instead of the browser's "Choose File / No file chosen"): a preview tile, a line about
 * the file, the choose button (the real file input sits inside it, invisible) and "Kaldır".
 */
export function FilePicker({ label, accept, preview, previewAlt, empty, note, disabled, choose = 'Dosya seç', change = 'Değiştir', onFile, onRemove, extra, icon: Icon = ImagePlus }: {
  label: string; accept: string; preview?: string | null; previewAlt: string; empty: string; note?: ReactNode; disabled?: boolean; choose?: string; change?: string;
  onFile: (file: File) => void; onRemove?: () => void; extra?: ReactNode; icon?: LucideIcon;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className={`file-picker${disabled ? ' disabled' : ''}`}>
    <div className={`file-picker-preview${preview ? '' : ' empty'}`}>{preview ? <img src={preview} width={72} height={72} alt={previewAlt} /> : <Icon size={24} aria-hidden="true" />}</div>
    <div className="file-picker-copy">
      <strong>{preview ? 'Seçili' : empty}</strong>
      {note && <span>{note}</span>}
      <div className="file-picker-actions">
        <label className={`btn secondary file-picker-choose${disabled ? ' disabled' : ''}`}>
          <ImagePlus size={16} aria-hidden="true" />{preview ? change : choose}
          <input ref={input} type="file" aria-label={label} accept={accept} disabled={disabled} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </label>
        {extra}
        {preview && onRemove && <button type="button" className="btn ghost file-picker-remove" disabled={disabled} onClick={onRemove}><Trash2 size={15} aria-hidden="true" />Kaldır</button>}
      </div>
    </div>
  </div>;
}

/** A quiet "nothing here yet" box with an icon, a line and an optional action. */
export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return <div className="settings-empty">{icon}<strong>{title}</strong>{text && <span>{text}</span>}{action}</div>;
}

/** The "saves by itself" line under switches and choices. */
export function AutoSave({ busy }: { busy: boolean }) {
  return <p className="settings-autosave" role="status">{busy ? 'Kaydediliyor…' : <><Check size={15} aria-hidden="true" />Değişiklikler kendiliğinden kaydedilir.</>}</p>;
}

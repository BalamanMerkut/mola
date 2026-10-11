import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { CalendarDays } from 'lucide-react';
import { dayOf, shapeDay, showDay } from './dateText';
import './time-field.css';

/*
 * Tarih alanı, always gün.ay.yıl ("08.10.2026"), like the 24-hour TimeField: the browser's own <input type="date"> follows
 * the computer's or phone's language and showed 10/08/2026 (month first) on an English Windows (8 Ekim denetimi K5).
 * A text field with the number keyboard ("08102026" becomes "08.10.2026"); the small calendar button opens the browser's
 * own picker for those who prefer to tap a day. The parent hears only whole days ("2026-10-08") or "" (cleared).
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue' | 'min' | 'max'> & { value: string; onChange: (value: string) => void; min?: string; max?: string };

export function DateField({ value, onChange, min, max, onBlur, className = '', placeholder = 'gg.aa.yyyy', disabled, ...rest }: Props) {
  const [draft, setDraft] = useState(showDay(value));
  const input = useRef<HTMLInputElement>(null), native = useRef<HTMLInputElement>(null);
  // A new value from outside (another choice, a reset, the picker) replaces what is shown, unless the field already says it.
  useEffect(() => { setDraft(d => dayOf(d) === value ? d : showDay(value)); }, [value]);
  const day = dayOf(draft), bad = draft !== '' && !day, outside = !!day && ((!!min && day < min) || (!!max && day > max));
  useEffect(() => { input.current?.setCustomValidity(bad ? 'Tarihi gün.ay.yıl olarak yazın, ör. 08.10.2026' : outside ? `Tarih ${min ? showDay(min) : ''}${min && max ? ' ile ' : ''}${max ? showDay(max) : ''} arasında olmalı.` : ''); }, [bad, outside, min, max]);
  return <span className={`date-field ${className}`.trim()}>
    <input {...rest} ref={input} type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder={placeholder} disabled={disabled}
      value={draft} aria-invalid={rest['aria-invalid'] ?? (bad || outside || undefined)}
      onChange={e => { const next = shapeDay(e.target.value, draft); setDraft(next); const d = dayOf(next); if (next === '' || d) onChange(d); }}
      onBlur={e => { if (day && draft !== showDay(day)) setDraft(showDay(day)); onBlur?.(e); }} />
    <button type="button" className="date-field-pick" aria-label="Takvimden seç" tabIndex={-1} disabled={disabled} onClick={() => { const n = native.current; if (!n) return; try { n.showPicker(); } catch { n.focus(); } }}><CalendarDays size={17} aria-hidden="true" /></button>
    <input ref={native} className="date-field-native" type="date" tabIndex={-1} aria-hidden="true" value={value} min={min} max={max} disabled={disabled} onChange={e => { onChange(e.target.value); setDraft(showDay(e.target.value)); }} />
  </span>;
}

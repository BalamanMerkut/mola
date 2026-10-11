import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { finishTime, isTime, shapeTime } from './timeText';
import './time-field.css';
import { DateField } from './DateField';
export { isTime } from './timeText';

/*
 * Saat alanı, always 24 hours ("09:00", "21:30"): the browser's own <input type="time"> follows the computer's or phone's
 * language and shows "09:00 AM / 05:00 PM" on an English Windows, so every time field of the app is this one instead.
 * A plain text field with the number keyboard: "1930" becomes "19:30", "9" + leaving the field becomes "09:00", "930"
 * becomes "09:30". The parent hears only complete times ("HH:MM") or "" (cleared); a half-typed time keeps the last good
 * one there and marks the field so the form does not send ("Saati 24 saat biçiminde yazın, ör. 09:30").
 */
/** `onCommit`: on leaving the field, the finished time ("" when emptied); not called while it is still half-typed. */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'defaultValue'> & { value: string; onChange: (value: string) => void; onCommit?: (value: string) => void };

export function TimeField({ value, onChange, onCommit, onBlur, className = '', placeholder = 'ss:dd', ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  // A new value from outside (another choice, a reset) replaces what is shown, unless it is what the field already says.
  useEffect(() => { setDraft(d => (d === value || finishTime(d) === value) ? d : value); }, [value]);
  const bad = draft !== '' && !isTime(draft);
  useEffect(() => { input.current?.setCustomValidity(bad ? 'Saati 24 saat biçiminde yazın, ör. 09:30' : ''); }, [bad]);
  return <input {...rest} ref={input} type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder={placeholder}
    className={`time-field ${className}`.trim()} value={draft} aria-invalid={bad || undefined}
    onChange={e => { const next = shapeTime(e.target.value, draft); setDraft(next); if (next === '' || isTime(next)) onChange(next); }}
    onBlur={e => { const done = finishTime(draft), ok = done === '' || isTime(done); if (done !== draft) { setDraft(done); if (ok) onChange(done); } if (ok) onCommit?.(done); onBlur?.(e); }} />;
}

/** A day and a 24-hour time side by side, as one "YYYY-MM-DDTHH:MM" value (what <input type="datetime-local"> gave). */
export function DateTimeField({ value, onChange, label, required, disabled, min, id }: { value: string; onChange: (value: string) => void; label: string; required?: boolean; disabled?: boolean; min?: string; id?: string }) {
  const [day = '', time = ''] = value ? value.split('T') : [];
  const set = (d: string, t: string) => onChange(d ? `${d}T${t || '00:00'}` : '');
  return <span className="datetime-field">
    <DateField id={id} aria-label={`${label} günü`} required={required} disabled={disabled} min={min?.slice(0, 10)} value={day} onChange={v => set(v, time)} />
    <TimeField aria-label={`${label} saati`} required={required} disabled={disabled} value={time.slice(0, 5)} onChange={t => set(day, t)} />
  </span>;
}

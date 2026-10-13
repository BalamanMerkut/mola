import { MessageSquareText, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { formatWeight, GRAM_MAX, GRAM_MIN, GRAM_PRESETS, GRAM_STEP, NOTE_MAX, noteLength, notePlaceholder, validGrams } from '../packages/domain/lines';
import './order-lines.css';

/** Weight for products sold by kg: quick chips plus a gram field. `value` is the typed text, so half-typed numbers stay editable. */
export function WeightPicker({ value, onChange, en, disabled = false, name }: { value: string; onChange: (value: string) => void; en: boolean; disabled?: boolean; name?: string }) {
  const valid = validGrams(Number(value));
  return <fieldset className="weight-picker" disabled={disabled}><legend>{en ? 'Weight' : 'Ağırlık'}{name ? <span className="sr-only"> · {name}</span> : null}</legend>
    <div className="weight-presets">{GRAM_PRESETS.map(g => <button type="button" key={g} aria-pressed={Number(value) === g} className={Number(value) === g ? 'selected' : ''} onClick={() => onChange(String(g))}>{formatWeight(g, en)}</button>)}</div>
    <label>{en ? 'Other weight (grams)' : 'Başka ağırlık (gram)'}<input aria-label={en ? `Weight in grams${name ? ` · ${name}` : ''}` : `Ağırlık (gram)${name ? ` · ${name}` : ''}`} type="number" inputMode="numeric" min={GRAM_MIN} max={GRAM_MAX} step={GRAM_STEP} value={value} onChange={e => onChange(e.target.value)} /></label>
    {valid ? <small className="muted">{formatWeight(Number(value), en)}</small> : <small role="status" className="weight-error">{en ? 'Enter 50 g to 20 kg in 50 g steps.' : '50 g ile 20 kg arasında, 50 g adımlarla girin.'}</small>}
  </fieldset>;
}
/** Optional free text for one line ("Açık demli"); the example fits `product` (tea, coffee, food…). The server cleans and checks it again. */
export function NoteField({ value, onChange, en, disabled = false, name, product }: { value: string; onChange: (value: string) => void; en: boolean; disabled?: boolean; name?: string; product?: Parameters<typeof notePlaceholder>[0] }) {
  return <div className="note-field"><label>{en ? 'Add a note (optional)' : 'Not ekle (isteğe bağlı)'}<input aria-label={(en ? 'Add a note (optional)' : 'Not ekle (isteğe bağlı)') + (name ? ` · ${name}` : '')} value={value} maxLength={NOTE_MAX} disabled={disabled} placeholder={product ? notePlaceholder(product, en) : en ? 'e.g. Any special request' : 'Örn. özel isteğiniz'} onChange={e => onChange(e.target.value)} /></label>{value && <small className="muted">{noteLength(value)}/{NOTE_MAX}</small>}</div>;
}
/**
 * Under each basket line (13 Ekim tanıtım): "Paket yapılsın" for this item only, and the note added or changed here too (it
 * was only in the product window, and guests did not find it). `packable`: a table order (masasız tickets are always to go).
 */
export function CartLineExtras({ packed, note, packable, en, disabled, name, product, onChange }: { packed?: boolean; note?: string; packable: boolean; en: boolean; disabled: boolean; name: string; product?: Parameters<typeof notePlaceholder>[0]; onChange: (update: { packed?: boolean; note?: string }) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="cart-line-extras">
    {packable && <label className="checkbox-label line-packed-choice"><input type="checkbox" checked={!!packed} disabled={disabled} aria-label={`${en ? 'Pack to go' : 'Paket yapılsın'} · ${name}`} onChange={e => onChange({ packed: e.target.checked || undefined })} /><ShoppingBag size={14} aria-hidden="true" />{en ? 'Pack to go' : 'Paket yapılsın'}</label>}
    {!open && <button type="button" className="text-btn line-note-btn" disabled={disabled} onClick={() => setOpen(true)}><MessageSquareText size={14} aria-hidden="true" />{note ? (en ? 'Change note' : 'Notu değiştir') : (en ? 'Add a note' : 'Not ekle')}</button>}
    {open && <NoteField value={note ?? ''} onChange={v => onChange({ note: v || undefined })} en={en} disabled={disabled} name={name} product={product} />}
  </div>;
}
/** The note as staff and guests read it under a line: highlighted, with an icon, never mistaken for an option. */
export function LineNote({ note, en = false }: { note?: string; en?: boolean }) {
  if (!note) return null;
  return <small className="line-note"><MessageSquareText size={14} aria-hidden="true" /><span><span className="sr-only">{en ? 'Note: ' : 'Not: '}</span>{note}</span></small>;
}

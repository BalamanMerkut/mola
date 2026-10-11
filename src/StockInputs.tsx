import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { bigUnit, formatAmount, inputUnits, parseAmount, smallUnit, type StockUnit } from '../packages/domain/stock';
import { HelpTip } from './HelpTip';
import type { ItemView } from './stockView';

/** A typed amount with its unit ("1,5" + "kg"); the value in base units comes from `amountOf`. */
export type AmountDraft = { text: string; unit: string };
export const emptyAmount = (unit: StockUnit, smallFirst = false): AmountDraft => ({ text: '', unit: inputUnits(unit, smallFirst)[0] });
export const amountOf = (d: AmountDraft) => parseAmount(d.text, d.unit);
/** Base units back to a draft in the unit a person would type ("1,5 kg" rather than "1500 g"). */
export function draftOf(amount: number, unit: StockUnit): AmountDraft {
  const big = unit !== 'piece' && amount >= 1000, shown = big ? amount / 1000 : amount;
  return { text: String(Math.round(shown * 1000) / 1000).replace('.', ','), unit: unit === 'piece' ? 'adet' : big ? (unit === 'g' ? 'kg' : 'L') : unit };
}
/** The unit an amount is shown in ("904 g", "1,2 kg"): a count starts in the unit its "Beklenen" line uses. */
export const shownUnit = (amount: number, unit: StockUnit) => unit === 'piece' ? 'adet' : Math.abs(amount) >= 1000 ? bigUnit(unit).label : smallUnit(unit);
/** An empty field in the unit "Beklenen" is shown in. */
export const amountLike = (expected: number, unit: StockUnit): AmountDraft => ({ text: '', unit: shownUnit(expected, unit) });
/**
 * A typed amount that is more than ten times off what is expected (850 kg typed where 904 g is on the shelf): usually the
 * wrong unit. `both`: also when it is ten times smaller (counts and purchases; a small fire is normal).
 */
export function unlikely(value: number, reference: number | null | undefined, unit: StockUnit, both = true) {
  if (!(value > 0) || !reference || reference <= 0) return '';
  if (value > reference * 10 || (both && value * 10 < reference)) return `${formatAmount(value, unit)} mı? Beklenen ${formatAmount(reference, unit)}.`;
  return '';
}
/** Enter inside a field must not send a surrounding form (the product editor's). */
export const noEnter = (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); };

/** A field's name with its grey ⓘ beside it (outside the label, so the field's name stays just the label). */
export function LabelWithHelp({ label, help, htmlFor }: { label: string; help?: string; htmlFor?: string }) {
  const name = htmlFor ? <label htmlFor={htmlFor} className="stock-label">{label}</label> : <span className="stock-label">{label}</span>;
  return help ? <div className="stock-label-row">{name}<HelpTip title={label}>{help}</HelpTip></div> : name;
}

/**
 * Number field with a small unit choice beside it (kg / g, L / ml) or a fixed "adet". `help`: the ⓘ beside the label;
 * `hint`: one plain line under the field (read with it by screen readers).
 */
export function AmountInput({ label, value, unit, onChange, smallFirst = false, disabled, invalid, hideLabel = false, placeholder, help, hint }: { label: string; value: AmountDraft; unit: StockUnit; onChange: (d: AmountDraft) => void; smallFirst?: boolean; disabled?: boolean; invalid?: boolean; hideLabel?: boolean; placeholder?: string; help?: string; hint?: ReactNode }) {
  const id = useId(), units = inputUnits(unit, smallFirst);
  return <div className="stock-amount">
    {hideLabel ? <label htmlFor={id} className="sr-only">{label}</label> : <LabelWithHelp label={label} help={help} htmlFor={id} />}
    <div className="stock-amount-row">
      <input id={id} inputMode="decimal" autoComplete="off" value={value.text} placeholder={placeholder ?? '0'} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={hint ? `${id}-hint` : undefined} onKeyDown={noEnter} onChange={e => onChange({ ...value, text: e.target.value })} />
      {units.length > 1 ? <select aria-label={`${label} birimi`} value={units.includes(value.unit) ? value.unit : units[0]} disabled={disabled} onChange={e => onChange({ ...value, unit: e.target.value })}>{units.map(u => <option key={u} value={u}>{u}</option>)}</select> : <span className="stock-unit-fixed">{units[0]}</span>}
    </div>
    {hint && <small id={`${id}-hint`} className="stock-hint">{hint}</small>}
  </div>;
}

/** Item picker: ingredients first, ready-bought products in their own group. */
export function ItemSelect({ label, items, value, onChange, disabled, allowProducts = true, placeholder = 'Malzeme seçin', hideLabel = false }: { label: string; items: ItemView[]; value: string; onChange: (id: string) => void; disabled?: boolean; allowProducts?: boolean; placeholder?: string; hideLabel?: boolean }) {
  const id = useId(), ingredients = items.filter(i => i.kind !== 'product'), products = allowProducts ? items.filter(i => i.kind === 'product') : [];
  return <div className="stock-field">
    <label htmlFor={id} className={hideLabel ? 'sr-only' : 'stock-label'}>{label}</label>
    <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {products.length ? <><optgroup label="Malzemeler">{ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup><optgroup label="Hazır ürünler">{products.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup></> : ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  </div>;
}

/** A labelled plain field in the stock forms (one control inside, named by the label). */
export function StockField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <div className="stock-field"><label><span className="stock-label">{label}</span>{children}</label>{hint && <small className="stock-hint">{hint}</small>}</div>;
}

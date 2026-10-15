import { useId, useState } from 'react';
import { Check, Lock, Sparkles } from 'lucide-react';
import { featureById, shownFeatures, type FeatureGroup, type FeatureId } from '../packages/domain/features';
import { addedFor, discountText, normalFeatures, priceFor, withoutFeature, type Discount, type Price, type ServicePackage, type ServicePrices } from '../packages/domain/service-pricing';
import { money, moneyError, moneyInput, parseMoney } from './api';
import './platform-sales.css';

/*
 * Shared pieces of the service screens in Mola Yönetim (Ayarlar → Hizmet fiyatları / Paketler, işletme → Hizmet,
 * Satışlarım): what Mola Merkez sends (server/merkez/catalog.ts catalogView / servicesView) and the service picker, the
 * discount field and the live total. Prices are kuruş without KDV; the same rules as the server (packages/domain/service-pricing.ts).
 */
export type FeatureView = { id: FeatureId; name: string; description: string; group: FeatureGroup; required: boolean; requires: FeatureId[]; soon: boolean; defaultMonthly: number; monthly: number; yearly: number; yearlyTyped: boolean; changed: boolean };
export type PackageView = ServicePackage & { price: Price; businesses: number };
export type CatalogView = { vatRate: number; updatedAt: string; features: FeatureView[]; packages: PackageView[] };
export type ServicesView = { packageId?: string | null; packageName: string; chosen: boolean; legacy?: 'full' | 'menu'; features: FeatureId[]; licenseFeatures: FeatureId[]; discount?: Discount; price: Price; packagePrice: Price; updatedAt?: string };
export const GROUPS: FeatureGroup[] = ['Sipariş ve servis', 'Raporlar', 'Ekler', 'Uzaktan', 'Cihaz ve güvenlik', 'Yakında'];
export const featureName = (id: FeatureId) => featureById.get(id)?.name ?? id;
/** How many services a list holds as people count them ("Uzaktan yönetim" is inside "Uzaktan erişim"). */
export const serviceCount = (ids: readonly FeatureId[]) => shownFeatures(ids).length;
/** The vendor's current prices as the pricing rules want them. */
export const pricesOf = (c: CatalogView): ServicePrices => Object.fromEntries(c.features.map(f => [f.id, { monthly: f.monthly, ...(f.yearlyTyped ? { yearly: f.yearly } : {}) }]));
export const livePrice = (c: CatalogView, ids: FeatureId[], ...discounts: (Discount | undefined)[]) => priceFor(ids, pricesOf(c), ...discounts);
/** Packages a business may be given now (not archived, not an old plan). */
export const offeredPackages = (c: CatalogView) => c.packages.filter(p => !p.archived && !p.legacy);

/** Services as small chips ("Adisyon çekirdeği", "QR menü" …), `max` of them and "+N". */
export function FeatureChips({ ids, max = 99, tone = '' }: { ids: FeatureId[]; max?: number; tone?: '' | 'off' | 'on' }) {
  const visible = shownFeatures(ids), shown = visible.slice(0, max), rest = visible.length - shown.length;
  return <ul className={`feature-chips ${tone}`} aria-label="Hizmetler">{shown.map(id => <li key={id}>{featureName(id)}</li>)}{rest > 0 && <li className="more">+{rest}</li>}</ul>;
}

/**
 * Checkbox cards, one per service, grouped (Sipariş ve servis, Raporlar, …): name, one line, monthly price. Core is always on
 * (locked); "Yakında" is shown but cannot be ticked. Ticking one adds what it needs; unticking one takes off what needs it,
 * and a short note says so ("QR sipariş için QR menü de eklendi").
 */
export function FeaturePicker({ catalog, chosen, onChange, disabled, label = 'Hizmetler' }: { catalog: CatalogView; chosen: FeatureId[]; onChange: (next: FeatureId[]) => void; disabled?: boolean; label?: string }) {
  const [note, setNote] = useState('');
  const toggle = (id: FeatureId) => {
    if (chosen.includes(id)) {
      const next = withoutFeature(chosen, id), gone = shownFeatures(chosen.filter(x => x !== id && !next.includes(x)));
      setNote(gone.length ? `${gone.map(featureName).join(', ')} da çıkarıldı (${featureName(id)} gerektirir).` : '');
      onChange(next);
    } else {
      const next = normalFeatures([...chosen, id]), brought = shownFeatures(next.filter(x => x !== id && !chosen.includes(x)));
      setNote(brought.length ? `${featureName(id)} için ${brought.map(featureName).join(', ')} de eklendi.` : '');
      onChange(next);
    }
  };
  const because = new Map(addedFor(chosen));
  return <div className="feature-picker" role="group" aria-label={label}>
    {note && <p className="feature-note" role="status"><Sparkles size={15} aria-hidden="true" />{note}</p>}
    {GROUPS.map(group => {
      const list = catalog.features.filter(f => f.group === group);
      if (!list.length) return null;
      const on = list.filter(f => chosen.includes(f.id)).length;
      return <section key={group} className="feature-group" aria-label={group}>
        <header><h4>{group}</h4>{group !== 'Yakında' && <span className="muted small">{on}/{list.length}</span>}</header>
        <div className="feature-grid">{list.map(f => {
          const checked = f.required || chosen.includes(f.id), why = because.get(f.id);
          return <label key={f.id} className={`feature-card${checked ? ' on' : ''}${f.required ? ' locked' : ''}${f.soon ? ' soon' : ''}`}>
            <input type="checkbox" checked={checked && !f.soon} disabled={disabled || f.required || f.soon} onChange={() => toggle(f.id)} />
            <span className="feature-tick" aria-hidden="true">{f.required ? <Lock size={13} /> : <Check size={14} strokeWidth={3} />}</span>
            <span className="feature-body">
              <span className="feature-title"><strong>{f.name}</strong>{f.required && <em className="feature-tag">Her pakette</em>}{f.soon && <em className="feature-tag soon">Yakında</em>}</span>
              <small>{f.description}</small>
              {why && checked && <small className="feature-why">{featureName(why)} için gerekli</small>}
            </span>
            <span className="feature-price">{money(f.monthly)}<small>/ay</small></span>
          </label>;
        })}</div>
      </section>;
    })}
  </div>;
}

/** "İndirim": none, ₺ off per month, or % off. The amount is typed the Turkish way ("150", "1.250,50"). */
export function DiscountField({ value, onChange, disabled, label = 'İndirim', max }: { value: Discount | undefined; onChange: (d: Discount | undefined, valid: boolean) => void; disabled?: boolean; label?: string; max?: number }) {
  const kind = value?.kind ?? 'none';
  const [text, setText] = useState(value ? (value.kind === 'percent' ? String(value.value) : moneyInput(value.value)) : '');
  const id = useId();
  const problem = kind === 'none' ? '' : kind === 'percent' ? (!/^\d{1,3}$/.test(text.trim()) || Number(text) < 1 || Number(text) > 100 ? 'Yüzde 1 ile 100 arasında olmalı.' : '') : moneyError(text, { max });
  const set = (k: 'none' | 'amount' | 'percent', t = text) => {
    if (k === 'none') { onChange(undefined, true); return; }
    const v = k === 'percent' ? Number(t.trim()) : parseMoney(t);
    const ok = k === 'percent' ? /^\d{1,3}$/.test(t.trim()) && v >= 1 && v <= 100 : !moneyError(t, { max });
    onChange({ kind: k, value: ok ? v : 0 }, ok);
  };
  return <div className="discount-field">
    <span className="discount-label" id={id}>{label}</span>
    <div className="discount-row">
      <div className="segmented discount-kind" role="radiogroup" aria-labelledby={id}>{([['none', 'Yok'], ['amount', '₺ / ay'], ['percent', '%']] as const).map(([k, t]) =>
        <button type="button" role="radio" key={k} aria-checked={kind === k} className={kind === k ? 'active' : ''} disabled={disabled} onClick={() => { if (k !== 'none' && kind === 'none') setText(''); set(k, k === kind ? text : ''); }}>{t}</button>)}</div>
      {kind !== 'none' && <label className="discount-input"><span className="visually-hidden">{kind === 'percent' ? 'İndirim yüzdesi' : 'Aylık indirim tutarı'}</span>
        <span className="affix">{kind === 'percent' ? '%' : '₺'}</span><input inputMode={kind === 'percent' ? 'numeric' : 'decimal'} disabled={disabled} value={text} aria-invalid={!!problem && !!text} placeholder={kind === 'percent' ? '10' : '100'} onChange={e => { setText(e.target.value); set(kind, e.target.value); }} /></label>}
    </div>
    {problem && text && <small className="field-problem">{problem}</small>}
  </div>;
}

/** A discount's size for "Paket indirimi ₺110/ay" / "%10" (the label says "indirim"; "₺110/ay indirim" beside ₺1.950 read as 110 off 1.950). */
export const discountSize = (d?: Discount) => !d || !d.value ? '' : d.kind === 'percent' ? `%${d.value}` : `${money(d.value)}/ay`;
/** The list price, struck through and read out as "Liste fiyatı ₺2.060" (screen readers say nothing for <s> by itself). */
export const ListPrice = ({ amount }: { amount: number }) => <s className="list-price"><span className="visually-hidden">Liste fiyatı </span>{money(amount)}</s>;
/** Before the price a discount gave: read out as "… paket fiyatı ₺1.950". */
export const NowLabel = ({ text = 'İndirimli fiyat' }: { text?: string }) => <span className="visually-hidden">{text} </span>;

/**
 * A package's price on its card. With a package discount: the list price small and struck through above, the price big, the
 * yearly line with its struck list price, then "Paket indirimi ₺110/ay". Without one: the price and the yearly line only.
 */
export function PackagePrice({ price, discount }: { price: Price; discount?: Discount }) {
  const off = price.listMonthly !== price.monthly, offYear = price.listYearly !== price.yearly, size = off ? discountSize(discount) : '';
  return <div className={`package-price${off ? ' discounted' : ''}`}>
    {off && <ListPrice amount={price.listMonthly} />}
    <span className="package-now">{off && <NowLabel text="Paket fiyatı" />}<strong>{money(price.monthly)}</strong><span>/ay</span></span>
    <small>{offYear && <><ListPrice amount={price.listYearly} /> <span className="price-arrow" aria-hidden="true">→</span> </>}{money(price.yearly)} / yıl</small>
    {size && <small className="package-discount">Paket indirimi {size}</small>}
  </div>;
}

/** Monthly and yearly side by side; with a discount the list price small and struck through above each. */
export function PriceBlock({ price, label = 'Fiyat', compact = false }: { price: Price; label?: string; compact?: boolean }) {
  const off = price.listMonthly !== price.monthly || price.listYearly !== price.yearly;
  return <div className={`price-block${compact ? ' compact' : ''}`} aria-label={label}>
    <div><span>Aylık</span>{off && <ListPrice amount={price.listMonthly} />}<strong>{off && <NowLabel />}{money(price.monthly)}</strong></div>
    <div><span>Yıllık</span>{off && <ListPrice amount={price.listYearly} />}<strong>{off && <NowLabel />}{money(price.yearly)}</strong>{!off && <small>2 ay bedava</small>}</div>
  </div>;
}
export { discountText };

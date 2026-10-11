import { useEffect, useId, useState } from 'react';
import { Percent, Plus, Trash2 } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { Card } from './SettingsKit';
import { DEFAULT_VAT, MAX_VAT_RATES, VAT_NOTE } from '../packages/domain/vat';
import './vat.css';

type VatView = { rates: number[]; default: number; counts: Record<string, number>; products: number };
/**
 * Menü yönetimi → "KDV oranları" (owner; once Ayarlar → Giderler ve kâr): the rates products can be given in Menü yönetimi, and the default one
 * (new products, and products never given a rate). Ready with %10 and %20. Information only: menu prices include KDV, the
 * guest menu never shows it; reports split sales by rate and the bill receipt ends "KDV dahildir · %10: ₺X".
 */
export function VatSettingsCard() {
  const id = useId();
  const [view, setView] = useState<VatView | null>(null), [rates, setRates] = useState<number[]>([]), [def, setDef] = useState(10);
  const [adding, setAdding] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  const fill = (v: VatView) => { setView(v); setRates(v.rates); setDef(v.default); };
  useEffect(() => { void api<VatView>('/api/staff/vat').then(fill).catch(e => setError((e as Error).message)); }, []);
  const added = Number(adding.replace(',', '.').replace('%', '').trim());
  const addError = !adding.trim() ? '' : !Number.isInteger(added) || added < 0 || added > 100 ? 'Oranı 0 ile 100 arasında tam sayı olarak yazın.' : rates.includes(added) ? 'Bu oran zaten listede.' : rates.length >= MAX_VAT_RATES ? `En fazla ${MAX_VAT_RATES} oran tanımlanabilir.` : '';
  const changed = !!view && (def !== view.default || rates.join(',') !== view.rates.join(','));
  async function save(next = { rates, default: def }) {
    setBusy(true); setError(''); setDone(false);
    try { fill(await api<VatView>('/api/staff/vat', next)); setDone(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const add = () => { if (!adding.trim() || addError) return; setRates(r => [...r, added].sort((a, b) => a - b)); setAdding(''); setDone(false); };
  return <Card icon={<Percent size={18} aria-hidden="true" />} title="KDV oranları" className="vat-card"
    tip={`Menüdeki fiyatlar KDV dahildir; müşteri menüsünde KDV gösterilmez. Ürün eklerken KDV bu listeden seçilir (Menü yönetimi → ürün → KDV). Satış ve Raporlar'daki KDV dökümü ve hesap fişinin altındaki "KDV dahildir" satırı bu oranlarla hesaplanır. ${VAT_NOTE}`}
    lead="Menü yönetiminde ürün eklerken seçilecek oranlar. Yeni ürünler varsayılan oranla başlar; alkollü içeceklerde yüksek oran önerilir.">
    {!view && !error ? <p className="settings-card-note" aria-busy="true">Okunuyor…</p> : view && <form className="vat-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset className="vat-rates"><legend className="sr-only">Oranlar ve varsayılan</legend>
        {rates.map(r => <div key={r} className={`vat-rate${r === def ? ' is-default' : ''}`}>
          <strong>%{r}</strong>
          <label className="vat-default" htmlFor={`${id}-${r}`}><input id={`${id}-${r}`} type="radio" name={`${id}-default`} checked={r === def} disabled={busy} onChange={() => { setDef(r); setDone(false); }} />Varsayılan</label>
          <span className="vat-count">{view.counts[r] ?? 0} ürün</span>
          <button type="button" className="icon-btn" aria-label={`%${r} oranını kaldır`} disabled={busy || r === def || rates.length <= 1} title={r === def ? 'Varsayılan oran kaldırılamaz; önce başka bir oranı varsayılan yapın.' : undefined} onClick={() => { setRates(x => x.filter(y => y !== r)); setDone(false); }}><Trash2 size={16} aria-hidden="true" /></button>
        </div>)}
      </fieldset>
      <div className="vat-add"><label>Yeni oran<span className="settings-number-control"><span aria-hidden="true">%</span><input inputMode="numeric" aria-label="Yeni KDV oranı (%)" placeholder="Örn. 1" value={adding} disabled={busy} aria-invalid={!!addError || undefined} onChange={e => setAdding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></span></label><button type="button" className="btn secondary" disabled={busy || !adding.trim() || !!addError} onClick={add}><Plus size={16} aria-hidden="true" />Ekle</button></div>
      {addError && <p className="option-hint" role="status">{addError}</p>}
      <p className="settings-card-note">Bir oranı kaldırırsanız o orandaki ürünler varsayılan oranla ({`%${def}`}) sayılır. {VAT_NOTE}</p>
      <div className="margin-actions"><button className="btn primary" disabled={busy || !changed}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => { setRates([...DEFAULT_VAT.rates]); setDef(DEFAULT_VAT.default); void save({ rates: [...DEFAULT_VAT.rates], default: DEFAULT_VAT.default }); }}>Varsayılana dön (%10 ve %20)</button></div>
    </form>}
    {done && <Notice tone="success">Kaydedildi. Menü yönetiminde ürünlerin KDV listesi bu oranları gösterir.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

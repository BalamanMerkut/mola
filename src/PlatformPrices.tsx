import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, Tags, Undo2 } from 'lucide-react';
import type { FeatureId } from '../packages/domain/features';
import { api, money, moneyError, moneyInput, parseMoney, requestId } from './api';
import { Notice } from './components';
import { featureIcons } from './featureIcons';
import { HelpTip } from './HelpTip';
import { GROUPS, type CatalogView } from './platformCatalog';
import { ADMIN, dateTime } from './platformStatus';
import { withStepUp } from './platformStepUp';
import { IconBtn } from './platformSettingsKit';

type Row = { monthly: string; yearly: string };
const TIP = 'Aylık fiyatlar KDV hariçtir. Yıllık fiyat boş bırakılırsa aylığın 10 katıdır (2 ay bedava). “Yakında” olan hizmetler satılmaz; fiyatı hazırlık içindir. Kaydedince paketler ve işletme fiyatları yeni fiyatlarla hesaplanır; önceki satış kayıtları değişmez. Her değişiklik İşlem kayıtları’na eski → yeni olarak yazılır.';
/**
 * Paketler → "Hizmet fiyatları" (once Ayarlar → Hizmet fiyatları): each service's monthly price (KDV hariç); the yearly price is the monthly × 10 unless typed.
 * "Yakında" services are shown with their planned price but are not sold yet. Saving writes only what changed to İşlem
 * kayıtları (old → new). Packages and businesses use the new prices at once; earlier sales keep their amounts.
 * One tidy row per service: its icon, name, the two price boxes side by side, what changed, and a reset to the start price.
 */
export function PlatformPrices({ onChanged }: { onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<CatalogView | null>(null), [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const fill = (c: CatalogView) => { setCatalog(c); setRows(Object.fromEntries(c.features.map(f => [f.id, { monthly: moneyInput(f.monthly), yearly: f.yearlyTyped ? moneyInput(f.yearly) : '' }]))); };
  const load = () => api<CatalogView>(`${ADMIN}/catalog`).then(fill, e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  const parsed = useMemo(() => catalog?.features.map(f => {
    const r = rows[f.id] ?? { monthly: '', yearly: '' }, monthly = parseMoney(r.monthly), yearly = r.yearly.trim() ? parseMoney(r.yearly) : null;
    const problem = moneyError(r.monthly, { min: 0 }) || (r.yearly.trim() ? moneyError(r.yearly, { min: 0 }) : '');
    const changed = !problem && (monthly !== f.monthly || (yearly ?? null) !== (f.yearlyTyped ? f.yearly : null));
    return { f, monthly, yearly, problem, changed };
  }) ?? [], [catalog, rows]);
  const changes = parsed.filter(p => p.changed), problems = parsed.filter(p => p.problem);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { requestId: requestId(), prices: changes.map(p => ({ id: p.f.id, monthly: p.monthly, yearly: p.yearly })) };
      await withStepUp('Fiyatları kaydet', () => api(`${ADMIN}/catalog/prices`, body));
      setNotice(`${changes.length} hizmetin fiyatı kaydedildi. Paketler ve işletme fiyatları yeni fiyatlarla hesaplanır; önceki satış kayıtları değişmez.`);
      await load(); onChanged?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const set = (id: FeatureId, k: keyof Row, v: string) => { setRows(r => ({ ...r, [id]: { ...r[id], [k]: v } })); setNotice(''); };
  const head = <div className="ps-section-head"><span className="ps-tile green" aria-hidden="true"><Tags size={19} /></span>
    <div><h2>Hizmet fiyatları <HelpTip title="Hizmet fiyatları">{TIP}</HelpTip></h2><p className="muted small">KDV hariç · yıllık boşsa aylık × 10</p></div>
    {catalog?.updatedAt && <span className="ps-chip idle price-updated">Son değişiklik: {dateTime(catalog.updatedAt)}</span>}</div>;
  if (!catalog) return <section className="price-settings ps-prices" aria-label="Hizmet fiyatları">{head}{error ? <Notice tone="error">{error}</Notice> : <p className="muted">Yükleniyor…</p>}</section>;
  return <section className="price-settings ps-prices" aria-label="Hizmet fiyatları">
    {head}
    <form onSubmit={e => { e.preventDefault(); if (!problems.length && changes.length) void save(); }}>
      {GROUPS.map(group => {
        const list = parsed.filter(p => p.f.group === group);
        if (!list.length) return null;
        return <fieldset key={group} className="ps-price-group"><legend>{group}<span>{list.length}</span></legend>
          <div className="ps-price-cols" aria-hidden="true"><span>Aylık</span><span>Yıllık <em className="x10">boşsa ×10</em></span></div>
          {list.map(({ f, monthly, yearly, problem, changed }) => {
            const r = rows[f.id], auto = Number.isFinite(monthly) ? monthly * 10 : NaN, Icon = featureIcons[f.id] ?? Tags;
            const fromYearly = f.yearlyTyped ? f.yearly : f.monthly * 10, toYearly = yearly ?? monthly * 10;
            return <div key={f.id} className={`ps-price-row${changed ? ' changed' : ''}${f.soon ? ' soon' : ''}${problem ? ' problem' : ''}`}>
              <span className="ps-tile grey" aria-hidden="true"><Icon size={18} /></span>
              <div className="ps-price-name">
                <strong>{f.name}{f.soon && <em className="feature-tag soon">Yakında</em>}{f.required && <em className="feature-tag">Her pakette</em>}</strong>
                <small>{f.description}</small>
                {problem ? <small className="field-problem">{problem}</small>
                  : changed && <small className="ps-price-change">{monthly !== f.monthly ? `Aylık ${money(f.monthly)} → ${money(monthly)}` : `Yıllık ${money(fromYearly)} → ${money(toYearly)}`}</small>}
              </div>
              <label className="ps-money"><span>Aylık</span><span className="money-input"><span className="affix">₺</span><input inputMode="decimal" aria-label={`${f.name} aylık fiyat`} disabled={busy} value={r?.monthly ?? ''} aria-invalid={!!problem} onChange={e => set(f.id, 'monthly', e.target.value)} /></span></label>
              <label className="ps-money"><span>Yıllık {!r?.yearly.trim() && <em className="x10">×10</em>}</span><span className="money-input"><span className="affix">₺</span><input inputMode="decimal" aria-label={`${f.name} yıllık fiyat`} disabled={busy} value={r?.yearly ?? ''} placeholder={Number.isFinite(auto) ? moneyInput(auto) : ''} onChange={e => set(f.id, 'yearly', e.target.value)} /></span></label>
              <div className="ps-price-reset">{f.defaultMonthly !== monthly || r?.yearly.trim()
                ? <IconBtn icon={RotateCcw} label={`Başlangıç fiyatına dön: ${money(f.defaultMonthly)}`} disabled={busy} onClick={() => setRows(x => ({ ...x, [f.id]: { monthly: moneyInput(f.defaultMonthly), yearly: '' } }))} />
                : <span className="ps-price-start" title="Başlangıç fiyatı" />}</div>
            </div>;
          })}
        </fieldset>;
      })}
      <div className={`price-save ps-save-bar${changes.length ? ' dirty' : ''}`}>
        <span>{problems.length ? `${problems.length} alanı düzeltin.` : changes.length ? `${changes.length} değişiklik kaydedilmedi.` : 'Değişiklik yok.'}</span>
        <div className="ps-actions">
          <IconBtn icon={Undo2} label="Vazgeç" disabled={busy || !changes.length} onClick={() => fill(catalog)} />
          <button className="btn primary small-btn" disabled={busy || !changes.length || !!problems.length}><Save size={16} aria-hidden="true" />{busy ? 'Kaydediliyor…' : 'Fiyatları kaydet'}</button>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    </form>
  </section>;
}

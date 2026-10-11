import { lazy, Suspense, useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Modal } from './components';
import { usePackage } from './FeatureLock';
import type { ProfitBasis, ProfitCategory, ProfitReport as Report, ProfitRow } from '../packages/domain/profit';
import { marginGroupNames } from '../packages/domain/margins';
import { formatWeight } from '../packages/domain/lines';
import { api, money } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { RefreshStatus } from './RefreshStatus';
import './stock.css';
// "Uyarı sınırları" (owner): the Düşük kâr uyarısı card, once Ayarlar → Giderler ve kâr (src/SettingsExpenses.tsx).
const MarginCard = lazy(() => import('./SettingsExpenses').then(m => ({ default: m.MarginCard })));

const BASIS: Record<ProfitBasis, string> = { sale: 'Satış anındaki fiyatlarla', today: 'Bugünkü fiyatlarla' };
/** "İçecekler grubunda kâr oranı %70'in altında" */
const lowTitle = (r: Pick<ProfitRow, 'group' | 'threshold'>) => r.threshold === null ? '' : `Kâr oranı ${r.group ? `${marginGroupNames[r.group]} grubunun` : 'belirlenen'} sınırının (%${Math.round(r.threshold * 100)}) altında.`;
const categoryLow = (c: Pick<ProfitCategory, 'margin' | 'threshold'>) => c.margin !== null && c.threshold !== null && c.margin < c.threshold;
const pct = (n: number | null) => n === null ? '—' : `%${Math.round(n * 100)}`;
const qty = (r: ProfitRow) => r.unit === 'kg' && r.grams ? formatWeight(r.grams) : `${r.quantity.toLocaleString('tr-TR')} ${r.unit === 'kg' ? 'satış' : 'adet'}`;

/**
 * Satış ve Raporlar → Kârlılık: what each product and category earned in the period after its ingredient cost. Products
 * without a recipe or price read "Maliyet girilmemiş" with a way to add the recipe (Stok → Reçeteler). The owner changes
 * the "Düşük kâr" lines here ("Uyarı sınırları", where the mark is seen); `margins` opens that window at once.
 */
export function ProfitReport({ range, onRecipe, margins = false }: { range: { from: string; to: string }; onRecipe?: (productId: string) => void; margins?: boolean }) {
  const owner = usePackage().owner, [limits, setLimits] = useState(margins), [version, setVersion] = useState(0);
  const [data, setData] = useState<Report | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [category, setCategory] = useState(''), [basis, setBasis] = useState<ProfitBasis>('sale');
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    api<Report>(`/api/staff/reports/profit?from=${range.from}&to=${range.to}&basis=${basis}`).then(d => { if (live) setData(d); }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range.from, range.to, basis, version]);
  const limitsWindow = limits && <Modal title="Düşük kâr uyarı sınırları" wide onClose={() => { setLimits(false); setVersion(v => v + 1); }}><div className="modal-body settings-shell"><div className="settings-page"><div className="settings-page-body"><Suspense fallback={<p role="status">Yükleniyor…</p>}><MarginCard /></Suspense></div></div></div></Modal>;
  if (!data) return <>{error ? <Notice tone="error">{error}</Notice> : <p role="status" className="report-loading">Rapor yükleniyor…</p>}{limitsWindow}</>;
  const t = data.totals, rows = data.rows.filter(r => !category || r.category === category);
  const categories = data.categories.map(c => c.name);
  const coverage = t.revenue ? t.costedRevenue / t.revenue : 0;
  const topProfit = Math.max(1, ...rows.map(r => Math.abs(r.profit ?? 0)));
  return <>
    {loading && <RefreshStatus />}{error && <Notice tone="error">{error} Önceki sonuçlar gösteriliyor.</Notice>}
    {limitsWindow}
    {/* Which prices the cost uses: the ones in force at each sale (default) or today's, for every sale in the period. */}
    <div className="profit-basis"><span className="profit-basis-label">Maliyet: <b>{BASIS[data.basis ?? 'sale']}</b></span><div className="period-pills" role="group" aria-label="Maliyet hesabı">{(['sale', 'today'] as const).map(b => <button type="button" key={b} className={basis === b ? 'active' : ''} aria-pressed={basis === b} onClick={() => setBasis(b)}>{BASIS[b]}</button>)}</div>
      <p className="muted small">{basis === 'sale' ? 'Her satış, satıldığı gündeki reçete ve alış fiyatıyla hesaplanır.' : 'Bütün satışlar bugünkü reçete ve son alış fiyatlarıyla yeniden hesaplanır: fiyatlar değiştiyse bugün aynı satış ne kazandırırdı?'}</p></div>
    <div className="kpi-row">
      <article className="kpi"><span>Satış<HelpTip title="Satış">Ürünlerin bu dönemde satıldığı tutar; kampanya indirimleri düşülmüş, iptaller hariç. Siparişin verildiği güne yazılır.</HelpTip></span><strong>{money(t.revenue)}</strong><small>{rows.length ? `${data.rows.length} ürün` : 'Bu dönemde satış yok'}</small></article>
      <article className="kpi"><span>Malzeme maliyeti<HelpTip title="Malzeme maliyeti">{`${data.basis === 'today' ? 'Bugünkü reçete × son alış fiyatı, dönemdeki bütün satışlar için.' : 'Satış anındaki reçete × o günkü alış fiyatı. Stok takibinden önceki satışlarda ilk reçete ve ilk fiyat kullanılır.'} Kira, maaş gibi giderler dahil değildir.`}</HelpTip></span><strong>{money(t.cost)}</strong><small>{t.uncostedProducts ? `${t.uncostedProducts} ürünün maliyeti girilmemiş` : 'Bütün ürünlerin maliyeti biliniyor'}</small></article>
      <article className="kpi kpi-main"><span>Brüt kâr<HelpTip title="Brüt kâr">Maliyeti bilinen ürünlerin satışı − malzeme maliyeti. İadeler, POS komisyonu ve diğer giderler düşülmemiştir; net kâr değildir.</HelpTip></span><strong>{money(t.profit)}</strong><small>Kâr oranı <b>{pct(t.margin)}</b></small></article>
    </div>
    {t.uncostedProducts > 0 && t.revenue > 0 && <Notice>Satışın {pct(coverage)} kadarının maliyeti biliniyor. Kalan {money(t.uncostedRevenue)} ({t.uncostedProducts} ürün) için reçete ya da fiyat girilmemiş; kâra katılmadı.</Notice>}
    {data.categories.length > 0 && <section className="panel profit-categories" aria-label="Kategoriler"><div className="report-section-heading"><h3>Kategoriler</h3><span className="muted small">Kâr oranı · brüt kâr</span></div>
      {data.categories.map(c => <div className="profit-category" key={c.name}>
        <span className="rank-name">{c.name}{c.uncosted > 0 && <small> · {c.uncosted} ürün maliyetsiz</small>}</span>
        <span className="profit-bar" aria-hidden="true"><i className={categoryLow(c) ? 'low' : ''} style={{ width: `${Math.max(0, Math.min(1, c.margin ?? 0)) * 100}%` }} /></span>
        <b className={categoryLow(c) ? 'warn' : ''} title={c.threshold !== null && c.group ? `${marginGroupNames[c.group]}: %${Math.round(c.threshold * 100)} altı düşük kâr` : undefined}>{pct(c.margin)}</b>
        <strong>{c.costedRevenue ? money(c.profit) : '—'}</strong>
      </div>)}
    </section>}
    <section className="panel product-table profit-table" aria-label="Ürün kârlılığı">
      <div className="report-section-heading"><h3>Ürünler<HelpTip title="Ürün kârlılığı">{data.marginAlerts ? `Kâr oranı, ürünün grubundaki sınırın altında kalan ürünler 'Düşük kâr' diye turuncu işaretlenir (varsayılan: içecekler %70, yemek ve tatlı %65, hazır ürünler %30; bu sayfadaki “Uyarı sınırları”ndan değiştirilebilir). "Düşük kâr" işaretinin üzerine gelince o grubun sınırı görünür. Maliyeti girilmemiş ürünlere Stok → Reçeteler'den reçete ekleyebilirsiniz.` : `Düşük kâr uyarısı kapalı (“Uyarı sınırları”ndan açılır). Maliyeti girilmemiş ürünlere Stok → Reçeteler'den reçete ekleyebilirsiniz.`}</HelpTip></h3>{t.lowProducts > 0 && <span className="stock-chip warn">{t.lowProducts} ürün düşük kârlı</span>}{owner && <button type="button" className="btn secondary small-btn profit-limits-btn" onClick={() => setLimits(true)}><SlidersHorizontal size={15} aria-hidden="true" />Uyarı sınırları</button>}</div>
      {categories.length > 1 && <div className="period-pills category-pills" role="group" aria-label="Kategori"><button type="button" className={!category ? 'active' : ''} onClick={() => setCategory('')}>Tümü</button>{categories.map(c => <button type="button" key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>}
      {!rows.length ? <p className="report-empty-note">Bu dönemde satılan ürün yok.</p> : <table><thead><tr><th>Ürün</th><th className="profit-num">Satış</th><th className="profit-num profit-cost">Maliyet</th><th className="profit-num">Kâr</th><th className="profit-num">Oran</th></tr></thead><tbody>{rows.map(r => <tr key={r.id} className={r.low ? 'profit-low' : r.cost === null ? 'profit-missing' : ''}>
        <th>{r.name}{r.low && <b className="stock-chip warn profit-low-chip" title={lowTitle(r)}>Düşük kâr</b>}<small>{r.category} · {qty(r)}</small>{r.cost === null && <small className="profit-missing-note">Maliyet girilmemiş{r.missing === 'price' && r.missingItems?.length ? `: ${r.missingItems.join(', ')} fiyatı yok` : ''}{onRecipe && r.missing === 'recipe' && <> · <button type="button" className="text-btn" onClick={() => onRecipe(r.id)}>Reçete ekle</button></>}</small>}</th>
        <td className="profit-num">{money(r.revenue)}</td>
        <td className="profit-num profit-cost">{r.cost === null ? '—' : money(r.cost)}</td>
        <td className="profit-num">{r.profit === null ? '—' : <span className="profit-cell"><span className="profit-mini" aria-hidden="true"><i className={r.low ? 'low' : ''} style={{ width: `${Math.max(0, r.profit) / topProfit * 100}%` }} /></span>{money(r.profit)}</span>}</td>
        <td className="profit-num">{r.margin === null ? '—' : <b className={r.low ? 'warn' : ''}>{pct(r.margin)}</b>}</td>
      </tr>)}</tbody></table>}
    </section>
  </>;
}

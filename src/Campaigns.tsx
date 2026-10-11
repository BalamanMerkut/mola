import { DeleteCatalogItem } from './DeleteCatalogItem';
import { CampaignProductPicker } from './CampaignProductPicker';
import { DateField } from './DateField';
import { useEffect, useRef, useState } from 'react';
import './campaigns.css';
import { CAMPAIGN_MAX_MONTHS, CAMPAIGN_MAX_WEEKS, CAMPAIGN_STATES, campaignDiscountLabel, campaignProducts, campaignState, campaignTimingError, campaignWhen, categoriesPlace, categoryOfferText, discountedPrice, isMonthly, monthDayText, repeatEnd, repeatMonths, repeatMonthsEnd, scheduleSummary, WEEKDAY_NAMES, WEEKDAY_SHORT, weightRuleMessage, type Campaign, type CampaignSchedule, type CampaignState, type CampaignView, type DiscountOffer } from '../packages/domain/campaigns';
import { soldByWeight } from '../packages/domain/lines';
import type { Product } from '../packages/domain/types';
import { api, ApiError, money, moneyError, parseMoney, requestId } from './api';
import { Modal, Notice, ProductArt } from './components';
import { renewedTiming } from '../packages/domain/campaign-ends';
import { DateTimeField, TimeField } from './TimeField';
import { Choice, Step } from './StepForm';
const DAY = 86400000, WEEK = 7 * DAY;
/** "12 Eki 2026 14:00": owners never need seconds on a campaign date. */
const shortTime = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const localDate = (iso: string) => new Date(Date.parse(iso) + 3 * 3600000).toISOString().slice(0, 16);
/** Turkish wall time ("2026-10-03T14:00:00") to ISO, or '' while the field is incomplete. */
const turkish = (local: string, plus = 0) => { const t = Date.parse(`${local}+03:00`); return Number.isFinite(t) ? new Date(t + plus).toISOString() : ''; };
type Timing = Pick<Campaign, 'startsAt' | 'endsAt' | 'schedule'>;
type Repeat = 'range' | 'weekly' | 'monthly';
const STATE_ORDER: CampaignState[] = ['draft', 'planned', 'active', 'ended'];
function CampaignQuota({ campaign: c }: { campaign: CampaignView }) {
  if (c.maxQuantity == null) return null;
  // "Onay bekleyenler dahil" read like the campaign itself waited for approval (11 Ekim): it is about QR orders.
  return <div className="campaign-quota"><div><strong>{c.usedQuantity} / {c.maxQuantity} adet</strong><span>{c.remainingQuantity} adet kaldı</span></div><progress aria-label={`${c.name} adet kullanımı`} value={Math.min(c.usedQuantity, c.maxQuantity)} max={c.maxQuantity} /><small>Garson onayı bekleyen QR siparişleri de sayılır; iptal edilenler sayılmaz.</small></div>;
}
/** "Bölüm: Tatlılar · 2 ürün" on the owner's card; the count is what the categories hold now (minus exclusions). */
const scopeLine = (c: Campaign, products: Product[]) => c.categories ? `Bölüm: ${c.categories.join(', ') || 'seçilmedi'} · ${campaignProducts(c, products.filter(p => p.published !== false)).length} ürün${c.excludedProductIds?.length ? ` · ${c.excludedProductIds.length} hariç` : ''}` : `${c.productIds.length} ürün`;
const timingLine = (c: Timing) => c.schedule ? scheduleSummary(c) : c.endsAt ? `${shortTime(c.startsAt)} – ${shortTime(c.endsAt)}` : `${shortTime(c.startsAt)} itibarıyla · Süresiz`;
export function CampaignStateChip({ state }: { state: CampaignState }) { return <span className={`campaign-state state-${state}`}>{CAMPAIGN_STATES[state].label}</span>; }
/** Menü yönetimi → Kampanyalar. `onResults`: "Sonuçları gör" opens Satış ve Raporlar → Kampanyalar on that campaign. */
export function Campaigns({ products, renew, onSaved, onResults }: { products: Product[]; renew?: string; onSaved: () => void; onResults?: (id: string) => void }) {
  const [data, setData] = useState<{ campaigns: CampaignView[]; categories?: string[]; revision: number } | null>(null), [error, setError] = useState('');
  // copy: Kampanyayı yinele (the "Kampanya bitti" window): the editor starts from the ended campaign with new dates and saves a new one.
  const [editing, setEditing] = useState<{ campaign?: CampaignView; copy?: boolean; categories: string[]; revision: number } | null>(null);
  async function load() { const d = await api<{ campaigns: CampaignView[]; categories?: string[]; revision: number }>('/api/staff/campaigns'); setData(d); return d; }
  useEffect(() => { void load().catch(e => setError(e.message)); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load().catch(() => {}); }, 5000); return () => clearInterval(timer); }, []);
  async function open(id?: string, copy = false) { try { const d = await load(), found = d.campaigns.find(c => c.id === id); setEditing({ campaign: found && copy ? { ...found, ...renewedTiming(found, Date.now()), enabled: true, usedQuantity: 0, remainingQuantity: found.maxQuantity ?? null } : found, copy: copy && !!found, categories: d.categories ?? [...new Set(products.map(p => p.category))], revision: d.revision }); setError(copy && !found ? 'Bu kampanya silinmiş; yenisini Kampanya ekle ile oluşturun.' : ''); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { if (renew) void open(renew, true); }, [renew]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now(), list = data?.campaigns ?? [], state = (c: CampaignView) => campaignState(c, now);
  const byStart = (a: CampaignView, b: CampaignView) => a.startsAt.localeCompare(b.startsAt);
  const of = (s: CampaignState) => list.filter(c => state(c) === s);
  const ended = of('ended').sort((a, b) => (b.endsAt ?? '').localeCompare(a.endsAt ?? ''));
  const card = (c: CampaignView) => { const st = state(c); return <article className={`panel campaign-card state-${st}`} key={c.id} aria-label={c.name}><div className="campaign-products-preview">{(c.categories ? campaignProducts(c, products.filter(p => p.published !== false)) : c.productIds.map(id => products.find(p => p.id === id))).slice(0, 3).map(p => p ? <ProductArt key={p.id} kind={p.art} photo={p.photo} alt={p.name} /> : null)}</div>
    <div className="campaign-card-state"><CampaignStateChip state={st} /><span>{campaignWhen(c, now)}</span></div>
    <h3>{c.name} · {campaignDiscountLabel(c)}</h3><p>{scopeLine(c, products)} · {timingLine(c)}</p><CampaignQuota campaign={c} /><p className="muted small">{c.combine ? 'Birleşmeye açık kampanyalarla birlikte uygulanabilir.' : 'Başka kampanyayla birleşmez.'}</p><div className="campaign-card-actions"><button className="btn secondary" onClick={() => void open(c.id)}>Kampanyayı düzenle</button>{onResults && <button type="button" className="text-btn" onClick={() => onResults(c.id)}>Sonuçları gör</button>}</div></article>; };
  return <><div className="section-heading"><h2>Kampanyalar</h2><button className="btn primary" onClick={() => void open()}>Kampanya ekle</button></div>
    <p className="muted">Seçtiğiniz ürünlere ya da menüdeki bir bölümün tamamına (örneğin Tatlılar) yüzde veya TL indirimi uygulayın. Kaydettiğiniz kampanya onay beklemez: zamanı gelince kendiliğinden başlar. Sipariş verildiğinde fiyat sabitlenir.</p>
    {/* The four states, one line each: what the owner reads on every card (11 Ekim, "onaya düşüyor" karışıklığı). */}
    <ul className="campaign-states" aria-label="Kampanya durumları">{STATE_ORDER.map(s => <li key={s}><CampaignStateChip state={s} /><span>{CAMPAIGN_STATES[s].line}</span></li>)}</ul>
    {error && <Notice tone="error">{error}</Notice>}
    {!data?.campaigns.length && <section className="panel">Henüz kampanya yok.</section>}
    {/* Running ones first, then those still to start and the drafts; finished ones are folded away at the bottom. */}
    <div className="campaign-card-grid">{[...of('active'), ...of('planned').sort(byStart), ...of('draft')].map(card)}</div>
    {ended.length > 0 && <details className="campaign-ended"><summary>Biten kampanyalar ({ended.length})</summary><div className="campaign-card-grid">{ended.map(card)}</div></details>}
    {editing && <CampaignEditor key={editing.copy ? 'copy' : editing.campaign?.id ?? 'new'} copy={editing.copy} initial={editing.campaign} revision={editing.revision} products={products} categories={editing.categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load().catch(e => setError(e.message)); onSaved(); }} />}
  </>;
}
/**
 * "Müşteri menüde böyle görür": the first covered product as the guest's card shows it (crossed-out price, the badge), and
 * when it shows at all. Prices come from the same rule as the menu (discountedPrice).
 */
function GuestPreview({ product, offer, state, when }: { product?: Product; offer: DiscountOffer | null; state: CampaignState; when: string }) {
  const visible = state === 'active' || state === 'planned';
  const price = product && offer ? discountedPrice({ discounts: [offer] }, product.price, offer.minQuantity ?? 1).price : product?.price ?? 0;
  const badge = offer?.categories?.length ? categoryOfferText(offer) : (offer?.minQuantity ?? 1) > 1 ? `${offer!.minQuantity} adet ve üzeri indirimli` : '';
  return <aside className="campaign-preview" aria-label="Müşteri menüde böyle görür"><h3>Müşteri menüde böyle görür</h3>
    {product ? <div className={`campaign-preview-card${visible ? '' : ' faded'}`}><ProductArt kind={product.art} photo={product.photo} alt={product.name} /><div><strong>{product.name}</strong>{badge && <span className="campaign-preview-badge">{badge}</span>}<p>{price < product.price && <del>{money(product.price)}</del>}<b>{money(price)}{soldByWeight(product) ? ' / kg' : ''}</b></p></div></div>
      : <p className="step-hint">Ürün ya da bölüm seçince burada görünür.</p>}
    <p className={`campaign-preview-when state-${state}`}><CampaignStateChip state={state} /><span>{when}</span></p>
    <p className="step-hint">{CAMPAIGN_STATES[state].line}</p>
  </aside>;
}
function CampaignEditor({ initial, copy = false, revision, products, categories, onClose, onSaved }: { initial?: CampaignView; copy?: boolean; revision: number; products: Product[]; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? ''), [percent, setPercent] = useState(String(initial?.percent ?? 10)), [ids, setIds] = useState(initial?.productIds ?? []);
  // "Kampanya neye uygulansın?": chosen products (as before) or whole menu categories with optional exclusions.
  const [scope, setScope] = useState<'products' | 'categories'>(initial?.categories ? 'categories' : 'products'), [cats, setCats] = useState(initial?.categories ?? []), [excluded, setExcluded] = useState(initial?.excludedProductIds ?? []);
  // A new category campaign names itself ("Tatlılarda %10 indirim") until the owner types a name.
  const [nameEdited, setNameEdited] = useState(!!initial), [excludeOpen] = useState(!!initial?.excludedProductIds?.length);
  const [kind, setKind] = useState<'percent' | 'fixed'>(initial?.kind ?? 'percent'), [amount, setAmount] = useState(initial?.kind === 'fixed' ? String(initial.amount / 100).replace('.', ',') : '');
  const [start, setStart] = useState(localDate(initial?.startsAt ?? new Date().toISOString())), [end, setEnd] = useState(initial?.endsAt ? localDate(initial.endsAt) : ''), [endless, setEndless] = useState(!initial?.endsAt);
  // Repeats: chosen weekdays (weekly) or a day of the month (monthly) from a start date, for N weeks/months or through a last day.
  const saved = initial?.schedule, savedMonthly = isMonthly(saved);
  const savedWeeks = saved && !savedMonthly && initial?.endsAt ? (Date.parse(initial.endsAt) - Date.parse(initial.startsAt)) / WEEK : NaN, wholeWeeks = Number.isInteger(savedWeeks) && savedWeeks >= 1 && savedWeeks <= CAMPAIGN_MAX_WEEKS;
  const savedMonths = savedMonthly && initial ? repeatMonths(initial) : null;
  const [repeat, setRepeat] = useState<Repeat>(!saved ? 'range' : savedMonthly ? 'monthly' : 'weekly'), weekly = repeat !== 'range';
  const [days, setDays] = useState<number[]>(saved && !isMonthly(saved) ? saved.days : []);
  const [monthDay, setMonthDay] = useState(savedMonthly ? String(saved.monthDay) : String(new Date(Date.now() + 3 * 3600000).getUTCDate()));
  const [windowOn, setWindowOn] = useState(!!saved?.from), [from, setFrom] = useState(saved?.from ?? '14:00'), [to, setTo] = useState(saved?.to ?? '17:00');
  const [byWeeks, setByWeeks] = useState(!saved || (savedMonthly ? savedMonths !== null : wholeWeeks)), [weeks, setWeeks] = useState(String(wholeWeeks ? savedWeeks : 4)), [months, setMonths] = useState(String(savedMonths ?? 3));
  const [lastDay, setLastDay] = useState(saved && initial?.endsAt ? localDate(new Date(Date.parse(initial.endsAt) - 1).toISOString()).slice(0, 10) : '');
  const startDay = start.slice(0, 10), weeklyStart = turkish(`${startDay}T00:00:00`);
  const monthly = repeat === 'monthly', max = monthly ? CAMPAIGN_MAX_MONTHS : CAMPAIGN_MAX_WEEKS, count = monthly ? months : weeks;
  const validCount = /^\d+$/.test(count) && Number(count) >= 1 && Number(count) <= max;
  const repeatEndOf = (n: number) => monthly ? repeatMonthsEnd(weeklyStart, n) : repeatEnd(weeklyStart, n);
  const windowPart = windowOn ? { from, to } : {};
  const schedule: CampaignSchedule = monthly ? { monthDay: Number(monthDay), ...windowPart } : { days, ...windowPart };
  const timing: Timing = weekly
    ? { startsAt: weeklyStart, endsAt: byWeeks ? (validCount && weeklyStart ? repeatEndOf(Number(count)) : '') : lastDay ? turkish(`${lastDay}T00:00:00`, DAY) : '', schedule }
    : { startsAt: turkish(`${start}:00`), endsAt: endless ? null : turkish(`${end}:00`) };
  // Date-range campaigns keep their server-side check; the repeating form explains itself as it is filled in.
  const timingError = !weekly ? (timing.startsAt && timing.endsAt && Date.parse(timing.endsAt) <= Date.parse(timing.startsAt) ? 'Bitiş, başlangıçtan sonra olmalı.' : '') : !weeklyStart ? 'Başlangıç tarihini seçin.' : timing.endsAt === '' ? (byWeeks ? `1–${max} arasında bir ${monthly ? 'ay' : 'hafta'} sayısı girin.` : 'Son günü seçin.') : campaignTimingError(timing) ?? '';
  const [enabled, setEnabled] = useState(initial?.enabled ?? true), [combine, setCombine] = useState(initial?.combine ?? false);
  const [quantityEnabled, setQuantityEnabled] = useState((initial?.minQuantity ?? 1) > 1), [minimum, setMinimum] = useState(String(initial?.minQuantity && initial.minQuantity > 1 ? initial.minQuantity : 2));
  const [limitEnabled, setLimitEnabled] = useState(initial?.maxQuantity != null), [limit, setLimit] = useState(String(initial?.maxQuantity ?? 50));
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''); const pending = useRef<object | null>(null);
  const [picker, setPicker] = useState(false), [popular, setPopular] = useState<{ id: string; quantity: number }[]>([]);
  // Best sellers are a bonus: if the financial reports are locked behind the security code, open the picker without them.
  async function openPicker() { try { const to = localDate(new Date().toISOString()).slice(0, 10); const from = new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10); const r = await api<{ products: { id: string; quantity: number }[] }>(`/api/staff/reports/financial?from=${from}&to=${to}`); setPopular(r.products); } catch { setPopular([]); } setPicker(true); }
  const locked = busy || uncertain;
  const validQuantity = !quantityEnabled || /^\d+$/.test(minimum) && Number(minimum) >= 2 && Number(minimum) <= 20;
  const validLimit = !limitEnabled || /^\d+$/.test(limit) && Number(limit) >= Math.max(quantityEnabled ? Number(minimum) : 1, copy ? 0 : initial?.usedQuantity ?? 0) && Number(limit) <= 1_000_000;
  // Products sold by kg: quantity conditions count pieces, so they are refused; discounts apply to the weighed line's amount.
  const byCategory = scope === 'categories', published = products.filter(p => p.published !== false);
  const inCats = published.filter(p => cats.includes(p.category)), minQuantity = quantityEnabled ? Number(minimum) || 2 : 1;
  const covered = campaignProducts({ productIds: [], categories: cats, excludedProductIds: excluded, minQuantity }, published);
  const chosen = byCategory ? covered : ids.map(id => products.find(p => p.id === id)).filter((p): p is Product => !!p);
  const weighed = chosen.filter(soldByWeight);
  // Chosen kg products refuse a quantity condition; in a category they are simply left out of it (campaignCovers).
  const weightRuleError = !byCategory && quantityEnabled && weighed.length ? weightRuleMessage(weighed.map(p => p.name)) : '';
  const weighedSkipped = byCategory && quantityEnabled ? inCats.filter(p => soldByWeight(p) && !excluded.includes(p.id)) : [];
  const validDiscount = kind === 'fixed' ? Number.isInteger(parseMoney(amount)) && parseMoney(amount) > 0 && parseMoney(amount) <= 100_000_000 : /^\d+$/.test(percent) && Number(percent) >= 1 && Number(percent) <= 90;
  const discount = kind === 'fixed' ? { kind, amount: validDiscount ? parseMoney(amount) : 0 } as const : { kind, percent: Number(percent) || 0 } as const;
  const offerText = cats.length ? categoryOfferText({ categories: cats, minQuantity: 1, ...discount }) : '';
  useEffect(() => { if (!nameEdited) setName(byCategory && validDiscount ? offerText.slice(0, 80) : ''); }, [nameEdited, byCategory, offerText, validDiscount]);
  const validScope = byCategory ? cats.length > 0 : ids.length > 0;
  // What saving does, before saving: the state the campaign will be in and when the guest sees it.
  const now = Date.now(), timingOk = !timingError && !!timing.startsAt && timing.endsAt !== '';
  const previewTiming = { ...timing, enabled, remainingQuantity: null, minQuantity };
  const previewState: CampaignState = !enabled ? 'draft' : timingOk ? campaignState(previewTiming, now) : 'planned';
  const previewWhen = !timingOk ? 'Tarihleri tamamlayın' : previewState === 'active' && !timing.schedule ? (timing.endsAt ? `Şimdi başlar · ${shortTime(timing.endsAt)}'e kadar` : 'Şimdi başlar · süresiz') : campaignWhen(previewTiming, now);
  const offer: DiscountOffer | null = validDiscount ? { id: 'onizleme', name: name || 'Kampanya', combine, minQuantity, ...(byCategory ? { categories: cats } : {}), ...discount } : null;
  async function save() {
    if (busy) return; setBusy(true); setError('');
    try {
      pending.current ??= { requestId: requestId(), revision, campaign: { id: copy ? undefined : initial?.id, name, maxQuantity: limitEnabled ? Number(limit) : null, minQuantity: quantityEnabled ? Number(minimum) : 1, ...(kind === 'fixed' ? { kind, amount: parseMoney(amount) } : { kind, percent: Number(percent) }), ...(byCategory ? { productIds: [], categories: cats, excludedProductIds: excluded.filter(id => products.some(p => p.id === id && cats.includes(p.category))) } : { productIds: ids }), startsAt: new Date(weekly ? timing.startsAt : `${start}:00+03:00`).toISOString(), endsAt: weekly ? timing.endsAt : endless ? null : new Date(`${end}:00+03:00`).toISOString(), schedule: weekly ? timing.schedule : null, enabled, combine } };
      await api('/api/staff/campaigns', pending.current); pending.current = null; setUncertain(false); onSaved();
    } catch (e) { const u = !!pending.current && (uncertain || !(e instanceof ApiError) || e.status >= 500); setUncertain(u); if (!u) pending.current = null; setError((e as Error).message); } finally { setBusy(false); }
  }
  const windowFields = <><label className="step-check"><input type="checkbox" checked={windowOn} onChange={e => setWindowOn(e.target.checked)} />Saat aralığı ekle</label>{windowOn && <div className="step-row keep"><label>Başlangıç saati *<TimeField required value={from} onChange={setFrom} /></label><label>Bitiş saati *<TimeField required value={to} onChange={setTo} /></label></div>}</>;
  let n = 0;
  return <><Modal wide className="campaign-editor-dialog" title={copy ? 'Kampanyayı yinele' : initial ? 'Kampanyayı düzenle' : 'Yeni kampanya'} onClose={() => { if (!locked) onClose(); }}><form className="campaign-editor-form" onSubmit={e => { e.preventDefault(); void save(); }}>
    <div className="campaign-editor-layout"><fieldset className="editor-fields campaign-editor-fields step-form" disabled={locked}>
    <Step n={++n} title="Ne indirimi?" help={kind === 'fixed' ? 'Yazdığınız tutar, ürünün her bir adedinden düşülür. Örneğin 140 TL ürün, 20 TL indirimle 120 TL olur. Kiloyla satılan üründe TL indirimi satırdan bir kez düşülür.' : 'İndirim, boy ve diğer seçenekler dahil ürünün birim fiyatından hesaplanır. Örneğin 100 TL ürün %20 indirimle 80 TL olur.'}>
      <label>Kampanya adı *<input required minLength={2} maxLength={80} value={name} placeholder="Ör. Maaş günü indirimi" onChange={e => { setNameEdited(true); setName(e.target.value); }} /></label>
      <div className="step-row keep"><label>İndirim türü *<select value={kind} onChange={e => setKind(e.target.value as 'percent' | 'fixed')}><option value="percent">Yüzde (%)</option><option value="fixed">Tutar (TL)</option></select></label>{kind === 'fixed' ? <label>İndirim tutarı (TL) *<input required inputMode="decimal" placeholder="Örn. 20" value={amount} aria-invalid={!!amount && !validDiscount} onChange={e => setAmount(e.target.value)} /></label> : <label>İndirim (%) *<input required type="number" min="1" max="90" step="1" value={percent} onChange={e => setPercent(e.target.value)} /></label>}</div>
      {!validDiscount && <p className="form-error" role="status">{kind === 'fixed' ? (amount ? moneyError(amount) || '0,01–1.000.000 TL arasında, en fazla iki ondalık basamaklı bir tutar girin.' : 'İndirim tutarını yazın.') : '1–90 arasında bir tam sayı girin.'}</p>}
      {weighed.length > 0 && <p className="step-hint">Kiloyla satılan ürünlerde indirim, seçilen ağırlığın tutarına uygulanır{kind === 'fixed' ? '; TL indirimi her satırdan bir kez düşülür, kilo başına değil' : ''}. Toplam adet sınırında her kiloluk satış 1 adet sayılır.</p>}
    </Step>
    <Step n={++n} title="Hangi ürünler?" help="Seçtiğiniz ürünlere ya da menüdeki bir bölümün tamamına uygulanır. Bölüm seçerseniz bölüme sonradan eklenen ürünler de kampanyaya kendiliğinden girer; başka bölüme taşınan ürün çıkar.">
      <Choice label="Kampanya neye uygulansın?" value={scope} options={[['products', 'Seçtiğim ürünler'], ['categories', 'Bütün bir bölüm']]} onChange={setScope} />
      {!byCategory ? <><button type="button" className="btn secondary campaign-pick-btn" onClick={() => void openPicker()}>Menüden seç · {ids.length} ürün</button><p className="step-hint">{ids.map(id => products.find(p => p.id === id)?.name ?? 'Ürün').join(' · ') || 'Menü kartlarından veya çok satanlardan seçim yapın.'}</p></>
      : <><fieldset className="campaign-categories"><legend>Hangi bölüm? Birden fazla seçebilirsiniz.</legend><div>{categories.map(c => { const on = cats.includes(c), count = published.filter(p => p.category === c).length; return <button type="button" key={c} aria-pressed={on} className={on ? 'selected' : ''} onClick={() => setCats(list => on ? list.filter(n => n !== c) : categories.filter(n => n === c || list.includes(n)))}><span>{c}</span><small>{count} ürün</small></button>; })}</div></fieldset>
        {cats.length > 0 && <p className="campaign-schedule-summary step-result" role="status">{validDiscount ? offerText : categoriesPlace(cats)} · şu an {covered.length} ürün</p>}
        {inCats.length > 0 && <details className="campaign-exclude" open={excludeOpen}><summary>Hariç tut <span className="muted small">(isteğe bağlı) · {inCats.filter(p => excluded.includes(p.id)).length} ürün</span></summary><p className="muted small">Dokunduğunuz ürün bu kampanyaya girmez. Tekrar dokunursanız kampanyaya geri girer.</p><div role="group" aria-label="Hariç tutulacak ürünler">{inCats.map(p => { const out = excluded.includes(p.id); return <button type="button" key={p.id} aria-pressed={out} className={out ? 'excluded' : ''} onClick={() => setExcluded(list => out ? list.filter(id => id !== p.id) : [...list, p.id])}><span>{p.name}</span><small>{out ? 'Hariç' : `#${p.code}`}</small></button>; })}</div></details>}
        {weighedSkipped.length > 0 && <p className="step-hint">Adet koşulu kiloyla satılan ürünlere uygulanmaz; bu kampanya onlarda geçerli olmaz: {weighedSkipped.map(p => p.name).join(', ')}.</p>}</>}
    </Step>
    <Step n={++n} title="Ne zaman?" help="Tarih aralığı: başlangıçtan bitişe kadar her an geçerli. Her hafta: seçtiğiniz gün(ler)de. Her ay: ayın seçtiğiniz gününde (ör. maaş günü her ayın 15'i); o gün olmayan aylarda ayın son günü. İsterseniz yalnız belli saatlerde geçerli olur. Saatler Türkiye saatidir; diğer zamanlarda ürünler normal fiyatındadır.">
      <Choice label="Kampanya ne zaman geçerli?" value={repeat} options={[['range', 'Tarih aralığı'], ['weekly', 'Her hafta'], ['monthly', 'Her ay']]} onChange={setRepeat} />
      {!weekly ? <><div className="step-row"><label>Başlangıç *<DateTimeField required label="Başlangıç" value={start} onChange={setStart} /></label>{!endless && <label>Bitiş *<DateTimeField required label="Bitiş" value={end} onChange={setEnd} /></label>}</div><label className="step-check"><input type="checkbox" checked={endless} onChange={e => setEndless(e.target.checked)} />Süresiz (ben kapatana kadar)</label>{timingError && <p role="status" className="form-error">{timingError}</p>}</>
      : <>{monthly ? <div className="step-row two"><label>Ayın kaçıncı günü? *<select value={monthDay} onChange={e => setMonthDay(e.target.value)}>{Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}</select></label></div>
        : <fieldset className="campaign-weekdays"><legend>Hangi günler? *</legend><div>{WEEKDAY_SHORT.map((label, i) => <button type="button" key={label} aria-label={WEEKDAY_NAMES[i]} aria-pressed={days.includes(i + 1)} className={days.includes(i + 1) ? 'selected' : ''} onClick={() => setDays(d => d.includes(i + 1) ? d.filter(v => v !== i + 1) : [...d, i + 1].sort((a, b) => a - b))}>{label}</button>)}</div></fieldset>}
        {monthly && Number(monthDay) >= 29 && <p className="step-hint">{monthDayText(Number(monthDay))}.</p>}
        {windowFields}
        <div className="step-row"><label>Başlangıç tarihi *<DateField required value={startDay} onChange={v => setStart(v ? `${v}T00:00` : '')} /></label>
          <div className="step-duration"><Choice label="Ne kadar sürsün?" value={byWeeks ? 'count' : 'last'} options={[['count', monthly ? 'Ay sayısı' : 'Hafta sayısı'], ['last', 'Son gün']]} onChange={v => { if (v === 'count') { setByWeeks(true); return; } setByWeeks(false); if (!lastDay && weeklyStart) setLastDay(localDate(new Date(Date.parse(repeatEndOf(validCount ? Number(count) : monthly ? 3 : 4)) - DAY).toISOString()).slice(0, 10)); }} />
            {byWeeks ? (monthly ? <label>Kaç ay? *<input required type="number" inputMode="numeric" min="1" max={CAMPAIGN_MAX_MONTHS} step="1" value={months} onChange={e => setMonths(e.target.value)} /></label> : <label>Kaç hafta? *<input required type="number" inputMode="numeric" min="1" max={CAMPAIGN_MAX_WEEKS} step="1" value={weeks} onChange={e => setWeeks(e.target.value)} /></label>) : <label>Son gün (dahil) *<DateField required min={startDay} value={lastDay} onChange={v => setLastDay(v)} /></label>}</div></div>
        {!monthly && !days.length ? <p className="step-hint">Kampanyanın geçerli olacağı günleri seçin.</p> : timingError ? <p role="status" className="form-error">{timingError}</p> : <p className="campaign-schedule-summary step-result" role="status">{scheduleSummary(timing)}</p>}</>}
    </Step>
    <Step n={++n} title="Sınır" optional help="Adet koşulu: aynı siparişte aynı üründen en az bu kadar alınırsa o ürünün bütün adetleri indirimli olur (farklı boylar birlikte sayılır). Toplam adet sınırı: kampanya bütün siparişlerde toplam bu kadar adetle biter; sipariş kabul edilince yer ayrılır, iptal edilince geri açılır. Süre ya da adet, hangisi önce dolarsa kampanya biter.">
      <label className="step-check"><input type="checkbox" checked={quantityEnabled} onChange={e => setQuantityEnabled(e.target.checked)} />Adet koşulu ekle</label>{quantityEnabled && <div className="step-sub"><div className="step-row"><label>En az kaç adet? *<input required type="number" inputMode="numeric" min="2" max="20" step="1" value={minimum} onChange={e => setMinimum(e.target.value)} /></label></div><p className="step-hint">Aynı siparişte aynı üründen {validQuantity ? minimum : 'belirlenen'} adet veya fazlası alınınca o ürünün tüm adetlerine indirim uygulanır. Daha azında ürün normal fiyatındadır; müşteri menüde “{validQuantity ? minimum : 2} adet ve üzeri indirimli” yazısını görür.</p>{weightRuleError && <p role="alert" className="form-error">{weightRuleError}</p>}</div>}
      <label className="step-check"><input type="checkbox" checked={limitEnabled} onChange={e => setLimitEnabled(e.target.checked)} />Toplam adet sınırı koy</label>{limitEnabled && <div className="step-sub"><div className="step-row"><label>Kampanya kaç adetle sınırlı? *<input required type="number" inputMode="numeric" min="1" max="1000000" step="1" value={limit} onChange={e => setLimit(e.target.value)} /></label></div><p className="step-hint">Seçili bütün ürünler için ortak sınırdır: örneğin 30 çay + 20 kahve = 50 adet.</p>{!copy && !!initial?.usedQuantity && <p className="step-hint">Şu ana kadar kullanılan: {initial.usedQuantity} adet. Düzenleme sayacı sıfırlamaz; yeni bir kampanya ayrı başlar.</p>}{!validLimit && <p role="status" className="form-error">1–1.000.000 arasında bir tam sayı girin. Sınır, kullanılan adetten veya en az alım adedinden küçük olamaz.</p>}</div>}
      <label className="step-check"><input type="checkbox" checked={combine} onChange={e => setCombine(e.target.checked)} />Diğer birleşmeye açık kampanyalarla birleştir</label>
      <details className="finance-details"><summary>İndirimler nasıl birleşir?</summary><p className="muted small">Önce yüzde indirimleri art arda uygulanır, sonra TL indirimleri düşülür. Örneğin 100 TL üründe %10 ve 20 TL indirim birleşirse fiyat 70 TL olur. Birleşmeyen teklifler ile birleşik sonuç karşılaştırılır; müşteri için düşük fiyat kullanılır. Birim fiyat en az 0,01 TL olur.</p></details>
    </Step>
    <Step n={++n} title="Durum" help="Kampanya onay beklemez. Etkinse zamanı gelince kendiliğinden başlar ve menüde görünür; kapalıysa Taslak olarak saklanır.">
      <label className="step-check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Kampanya etkin</label>
      <p className="step-hint">{enabled ? 'Kaydedince ' + (previewState === 'active' ? 'hemen Aktif olur.' : previewState === 'planned' ? 'Planlandı olur; başlangıçta kendiliğinden Aktif olur.' : 'Bitti olarak görünür: bitiş zamanı geçmiş.') : 'Kaydedince Taslak olur: menüde görünmez, indirim uygulanmaz.'}</p>
    </Step></fieldset>
    <GuestPreview product={chosen[0]} offer={offer} state={previewState} when={previewWhen} /></div>
    {error && <div className="campaign-editor-error"><Notice tone="error">{error}</Notice></div>}<footer className="campaign-editor-actions">{initial && !copy && <DeleteCatalogItem kind="campaign" id={initial.id} name={initial.name} revision={revision} disabled={locked} onDeleted={onSaved} />}<div className="campaign-save-actions"><button type="button" className="btn secondary" disabled={locked} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || (!uncertain && (name.trim().length < 2 || !validScope || !validDiscount || !validQuantity || !validLimit || !!timingError || !!weightRuleError))}>{uncertain ? 'Kampanya kaydını yeniden kontrol et' : 'Kampanyayı kaydet'}</button></div></footer>
  </form></Modal>{picker && <CampaignProductPicker products={products} selected={ids} popular={popular} onChange={setIds} onClose={() => setPicker(false)} />}</>;
}

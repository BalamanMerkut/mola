import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Lock, PauseCircle, Settings2, ShieldCheck } from 'lucide-react';
import { shownFeatures, type FeatureId } from '../packages/domain/features';
import { discountText, sellableFeatures, type Discount } from '../packages/domain/service-pricing';
import { money } from './api';
import { DemoSection } from './PlatformDemo';
import { DiscountField, FeatureChips, FeaturePicker, ListPrice, NowLabel, PriceBlock, discountSize, featureName, livePrice, offeredPackages, serviceCount, type CatalogView } from './platformCatalog';
import { ADMIN, type Business } from './platformStatus';
import './platform-service-bar.css';

type Mutate = (path: string, body: object) => Promise<boolean>;
const CUSTOM = 'ozel';
/**
 * Hizmet: which services this business has. A package (cards) or "Özel" (checkbox cards per service), this business's own
 * discount, the price for it, and what the trial means ("şu an her şey açık", what stays and what closes afterwards; data is
 * kept). A change shows what it changes (services, price) and is applied with "Değişikliği uygula" and the Authenticator code. Mola Merkez signs the licence
 * again (with `features`); the café has it within about 10 minutes. Below: Tanıtım işletmesi (src/PlatformDemo.tsx).
 */
export function ServiceTab({ l, catalog, disabled, mutate }: { l: Business; catalog?: CatalogView; disabled: boolean; mutate: Mutate }) {
  if (!catalog || !l.services) return <div className="detail-sheet"><section className="detail-section"><h2>Hizmet paketi</h2><p className="section-lead">Yükleniyor…</p></section><DemoSection l={l} disabled={disabled} mutate={mutate} /></div>;
  return <ServiceChoice key={`${l.tenantId}:${l.services.updatedAt ?? ''}`} l={l} s={l.services} catalog={catalog} disabled={disabled} mutate={mutate} />;
}

/*
 * A change that waits for two-step login: "İki adımlı doğrulamayı aç" (src/Platform.tsx openSecurity) holds the unsaved
 * choice, and the Hizmet tab opened again for the same business (unchanged since) starts from it, with the bar showing.
 */
type Draft = { tenantId: string; updatedAt: string; choice: string; custom: FeatureId[]; discount?: Discount };
let lastDraft: Draft | null = null, heldDraft: Draft | null = null;
export function holdServiceDraft(tenantId: string) { heldDraft = lastDraft?.tenantId === tenantId ? lastDraft : null; }

function ServiceChoice({ l, s, catalog, disabled, mutate }: { l: Business; s: NonNullable<Business['services']>; catalog: CatalogView; disabled: boolean; mutate: Mutate }) {
  const currentChoice = s.chosen ? (s.packageId ?? CUSTOM) : '';
  const [held] = useState(() => heldDraft && heldDraft.tenantId === l.tenantId && heldDraft.updatedAt === (s.updatedAt ?? '') ? heldDraft : null);
  useEffect(() => { heldDraft = null; }, []);
  const [choice, setChoice] = useState(held?.choice ?? currentChoice), [custom, setCustom] = useState<FeatureId[]>(held?.custom ?? s.features);
  const [discount, setDiscount] = useState<Discount | undefined>(held ? held.discount : s.discount), [discountOk, setDiscountOk] = useState(true);
  useEffect(() => { lastDraft = { tenantId: l.tenantId, updatedAt: s.updatedAt ?? '', choice, custom, discount }; }, [l.tenantId, s.updatedAt, choice, custom, discount]);
  const offered = offeredPackages(catalog), current = catalog.packages.find(p => p.id === s.packageId);
  // The business's own package stays selectable even when archived or an old plan.
  const cards = current && !offered.includes(current) ? [current, ...offered] : offered;
  const pkg = choice && choice !== CUSTOM ? catalog.packages.find(p => p.id === choice) : undefined;
  const features = choice === CUSTOM ? custom : pkg ? pkg.features : s.features;
  const price = livePrice(catalog, features, pkg?.discount, discount), base = livePrice(catalog, features, pkg?.discount);
  const nowPrice = s.price;
  const trial = l.kind === 'trial', running = !!l.endsAt && l.active;
  const sameDiscount = (discountText(discount) || '') === (discountText(s.discount) || '');
  const dirty = !!choice && (choice !== currentChoice || (choice === CUSTOM && custom.join() !== s.features.join()) || !sameDiscount);
  // As people count them: "Uzaktan yönetim" is inside "Uzaktan erişim" (packages/domain/features.ts partOf).
  const all = useMemo(() => shownFeatures(sellableFeatures()), []);
  const stays = shownFeatures(features), closes = all.filter(f => !features.includes(f));
  const removed = shownFeatures(s.features.filter(f => !features.includes(f))), added = shownFeatures(features.filter(f => !s.features.includes(f)));
  const choiceName = choice === CUSTOM ? 'Özel' : pkg?.name ?? 'Paket seçilmedi';
  // One press: the bar already says what changes, and the Authenticator code (src/platformStepUp.tsx) is the confirmation
  // (docs/KULLANICI_TESTI_RAPORU.md K-V; there is no extra "Emin misiniz?" step).
  async function apply() {
    await mutate(`${ADMIN}/business-services`, { tenantId: l.tenantId, packageId: choice === CUSTOM ? null : choice, ...(choice === CUSTOM ? { features: custom } : {}), discount: discount && discount.value ? discount : null, expectedUpdatedAt: s.updatedAt ?? null });
  }
  const diff = price.monthly - nowPrice.monthly;
  // The bar's one line: "3 hizmet değişti · Kafe Standart → Özel · indirim değişti".
  const changed = added.length + removed.length;
  const summary = [changed > 0 && `${changed} hizmet değişti`, choiceName !== s.packageName && `${s.packageName} → ${choiceName}`, !sameDiscount && 'indirim değişti'].filter(Boolean).join(' · ') || 'Değişiklik var';
  return <div className="detail-sheet service-sheet">
    <section className="detail-section" aria-label="Hizmet durumu">
      <div className={`service-state ${l.suspended ? 'bad' : trial ? 'info' : 'ok'}`}>
        <span className="service-state-icon" aria-hidden="true">{l.suspended ? <PauseCircle size={22} /> : trial ? <Clock3 size={22} /> : <ShieldCheck size={22} />}</span>
        <div>
          <strong>{l.suspended ? 'Hizmet askıda · müşteri menüsü ve yeni sipariş kapalı' : trial ? (running ? `Deneme: ${l.daysRemaining} gün kaldı · şu an her şey açık` : 'Deneme · şu an her şey açık') : `Şu an açık: ${s.packageName} · ${serviceCount(s.licenseFeatures)} hizmet`}</strong>
          <p>{trial ? `Deneme bitince ${s.chosen ? `“${s.packageName}”` : 'seçilen paket'} geçerli olur: ${serviceCount(s.features)} hizmet açık kalır${all.length - serviceCount(s.features) ? `, ${all.length - serviceCount(s.features)} hizmet kapanır (veriler saklanır)` : ''}.` : `Aylık ${money(nowPrice.monthly)} · yıllık ${money(nowPrice.yearly)} (KDV hariç)${s.discount ? ` · işletme indirimi: ${discountText(s.discount)}` : ''}.`}</p>
        </div>
      </div>
      {!s.chosen && <p className="service-warn" role="status">Bu işletmeye henüz paket seçilmedi: ücretli aboneliğe geçince bütün hizmetler açık kalır. Aşağıdan bir paket seçin.</p>}
    </section>

    <section className="detail-section" aria-label="Hizmet paketi">
      <div className="detail-section-head"><h2>Hizmet paketi</h2><span className="muted small">Fiyatlar KDV hariç</span></div>
      <p className="section-lead">Bir paket seçin ya da “Özel” ile hizmetleri tek tek işaretleyin. Paketten çıkan hizmetin verileri silinmez, yalnız gizlenir; geri eklenince kaldığı yerden döner.</p>
      <div className="service-packages" role="radiogroup" aria-label="Hizmet paketi">
        {cards.map(p => {
          const selected = choice === p.id, now = currentChoice === p.id, off = p.price.listMonthly !== p.price.monthly;
          return <button type="button" role="radio" key={p.id} aria-checked={selected} disabled={disabled} className={`service-card${selected ? ' selected' : ''}${p.legacy ? ' legacy' : ''}`} onClick={() => setChoice(p.id)}>
            <span className="service-card-head"><strong>{p.name}</strong>{now ? <span className="status-chip ok">Şu anki</span> : p.legacy ? <span className="status-chip idle">Eski plan</span> : p.archived ? <span className="status-chip idle">Arşivde</span> : null}</span>
            <span className="service-card-price">{off && <ListPrice amount={p.price.listMonthly} />}<b>{off && <NowLabel text="Paket fiyatı" />}{money(p.price.monthly)}</b>/ay <small>· {money(p.price.yearly)}/yıl</small></span>
            <FeatureChips ids={p.features} max={5} />
            <span className="service-foot">{selected ? <><CheckCircle2 size={15} aria-hidden="true" />Seçili</> : `${serviceCount(p.features)} hizmet`}</span>
          </button>;
        })}
        <button type="button" role="radio" aria-checked={choice === CUSTOM} disabled={disabled} className={`service-card custom${choice === CUSTOM ? ' selected' : ''}`} onClick={() => setChoice(CUSTOM)}>
          <span className="service-card-head"><strong>Özel</strong>{currentChoice === CUSTOM && <span className="status-chip ok">Şu anki</span>}</span>
          <span className="service-summary"><Settings2 size={15} aria-hidden="true" /> Bu işletmeye özel: hizmetleri tek tek seçin.</span>
          <span className="service-foot">{choice === CUSTOM ? <><CheckCircle2 size={15} aria-hidden="true" />Seçili</> : 'Hizmetleri seç'}</span>
        </button>
      </div>
      {choice === CUSTOM && <FeaturePicker catalog={catalog} chosen={custom} disabled={disabled} onChange={setCustom} label="Bu işletmenin hizmetleri" />}
    </section>

    <section className="detail-section" aria-label="Bu işletme için fiyat">
      <h2>Bu işletme için fiyat</h2>
      <div className="service-price-grid">
        <DiscountField key={`d:${s.updatedAt ?? ''}`} label="İşletmeye özel indirim (isteğe bağlı)" value={discount} disabled={disabled} max={base.monthly} onChange={(d, ok) => { setDiscount(d); setDiscountOk(ok); }} />
        <div className="service-price">
          <PriceBlock price={price} label="Bu işletmenin fiyatı" />
          <dl className="price-steps">
            <div><dt>Liste fiyatı</dt><dd>{money(price.listMonthly)}/ay</dd></div>
            {pkg?.discount && <div><dt>Paket indirimi</dt><dd>{discountSize(pkg.discount)}</dd></div>}
            {discount && discount.value > 0 && <div><dt>İşletme indirimi</dt><dd>{discountSize(discount)}</dd></div>}
          </dl>
        </div>
      </div>
    </section>

    <section className="detail-section" aria-label={trial ? 'Deneme bitince' : 'Açık ve kapalı hizmetler'}>
      <h2>{trial ? 'Deneme bitince' : 'Açık ve kapalı hizmetler'}</h2>
      <div className="service-split">
        <div><h3><CheckCircle2 size={16} aria-hidden="true" />{trial ? 'Açık kalacaklar' : 'Açık'} ({stays.length})</h3><FeatureChips ids={stays} tone="on" /></div>
        <div><h3><Lock size={16} aria-hidden="true" />{trial ? 'Kapanacaklar' : 'Kapalı'} ({closes.length})</h3>{closes.length ? <FeatureChips ids={closes} tone="off" /> : <p className="muted small">Hiçbiri: bütün hizmetler açık.</p>}{closes.length > 0 && <p className="muted small">Kapanan hizmetlerin verileri saklanır; geri açılınca kaldığı yerden devam eder.</p>}</div>
      </div>
    </section>

    {/* "Tanıtım işletmesi" and "Tanıtımı sıfırla" (src/PlatformDemo.tsx). */}
    <DemoSection l={l} disabled={disabled} mutate={mutate} />
    {/* The pending change as a bar that stays at the bottom of the screen while the vendor scrolls (sticky inside this
        sheet): "3 hizmet değişti · ₺2.500 → ₺975/ay", Vazgeç and Değişikliği uygula (straight to the Authenticator code);
        the details open under "Neler değişiyor". */}
    {dirty && <section className="service-confirm service-bar" aria-label="Değişikliği onayla">
      <div className="service-bar-main">
        <div className="service-bar-text">
          <strong>{summary}</strong>
          <span className="service-bar-price"><span>{money(nowPrice.monthly)} → <b>{money(price.monthly)}</b>/ay</span>{diff ? <span className={`service-bar-diff ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '+' : '−'}{money(Math.abs(diff))}</span> : null}</span>
        </div>
        <div className="service-bar-actions">
          <button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => { setChoice(currentChoice); setCustom(s.features); setDiscount(s.discount); setDiscountOk(true); }}>Vazgeç</button>
          <button type="button" className="btn primary small-btn" disabled={disabled || !discountOk || (choice === CUSTOM && !custom.length)} onClick={() => void apply()}>Değişikliği uygula</button>
        </div>
      </div>
      <details className="service-bar-more">
        <summary>Neler değişiyor</summary>
      <ul className="change-list">
        {choiceName !== s.packageName && <li><span>Paket</span><b>{s.packageName} → {choiceName}</b></li>}
        {added.length > 0 && <li><span>Eklenen</span><b>{added.map(featureName).join(', ')}</b></li>}
        {removed.length > 0 && <li><span>Çıkan</span><b>{removed.map(featureName).join(', ')}</b></li>}
        {!sameDiscount && <li><span>İşletme indirimi</span><b>{discountText(s.discount) || 'yok'} → {discountText(discount) || 'yok'}</b></li>}
        <li><span>Aylık fiyat</span><b>{money(nowPrice.monthly)} → {money(price.monthly)}{diff ? ` (${diff > 0 ? '+' : '−'}${money(Math.abs(diff))})` : ''}</b></li>
      </ul>
      <p className="section-note">{trial ? 'Deneme sürerken her şey açık kalır; bu seçim deneme bitince (ücretli aboneliğe geçince) geçerli olur.' : 'Lisans yeniden imzalanır; işletmenin bilgisayarına en geç 10 dakikada ulaşır. Kapanan hizmetlerin verileri silinmez.'}{l.kind !== 'trial' && diff !== 0 ? ' Ücret farkı bir sonraki uzatmada Satışlarım’a yansır.' : ''}</p>
      </details>
    </section>}
  </div>;
}

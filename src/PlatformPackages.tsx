import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, Copy, Package, PackagePlus, Pencil, Store } from 'lucide-react';
import type { FeatureId } from '../packages/domain/features';
import { addedFor, normalFeatures, type Discount } from '../packages/domain/service-pricing';
import { api, money, requestId } from './api';
import { Notice } from './components';
import { DiscountField, FeatureChips, FeaturePicker, PriceBlock, discountText, featureName, livePrice, type CatalogView, type PackageView } from './platformCatalog';
import { ADMIN } from './platformStatus';
import { withStepUp } from './platformStepUp';

type Draft = { id?: string; name: string; features: FeatureId[]; discount?: Discount; discountOk: boolean; updatedAt?: string; legacy?: boolean; businesses: number };
/**
 * Paketler (left menu, 13 Ekim; once Ayarlar → Paketler): every package as a card (services, monthly and yearly total, how many businesses use it), "Yeni paket"
 * opens the builder: a name, the services as checkbox cards (core always on, requirements added with a note), an optional
 * package discount and the live total. Edit, duplicate, archive. The two "eski plan" packages are the plans from before
 * packaging: shown apart, they can only be copied.
 */
export function PlatformPackages({ onChanged }: { onChanged?: () => void }) {
  const [catalog, setCatalog] = useState<CatalogView | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [asking, setAsking] = useState(false);
  const load = () => api<CatalogView>(`${ADMIN}/catalog`).then(setCatalog, e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!asking) return; const t = setTimeout(() => setAsking(false), 6000); return () => clearTimeout(t); }, [asking]);
  const open = (d: Draft) => { setDraft(d); setError(''); setNotice(''); setAsking(false); window.scrollTo?.(0, 0); };
  const fromPackage = (p: PackageView, copy = false): Draft => copy ? { name: `${p.name.replace(/ \(eski plan\)$/, '')} (kopya)`, features: [...p.features], discount: p.discount, discountOk: true, businesses: 0 }
    : { id: p.id, name: p.name, features: [...p.features], discount: p.discount, discountOk: true, updatedAt: p.updatedAt, legacy: !!p.legacy, businesses: p.businesses };
  async function save() {
    if (!draft) return;
    if (draft.id && draft.businesses > 0 && !asking) { setAsking(true); return; }
    setBusy(true); setError(''); setAsking(false);
    try {
      const body = { requestId: requestId(), ...(draft.id ? { id: draft.id, expectedUpdatedAt: draft.updatedAt } : {}), name: draft.name.trim(), features: draft.features, discount: draft.discount && draft.discount.value ? draft.discount : null };
      const r = await withStepUp(draft.id ? 'Paketi kaydet' : 'Paketi oluştur', () => api<{ id: string; businesses?: number }>(`${ADMIN}/packages`, body));
      setNotice(draft.id ? `“${draft.name.trim()}” kaydedildi.${r.businesses ? ` ${r.businesses} işletmenin hizmetleri güncellendi; lisansları en geç 10 dakikada ulaşır.` : ''}` : `“${draft.name.trim()}” paketi oluşturuldu. İşletme sayfasındaki Hizmet bölümünden atanabilir.`);
      setDraft(null); await load(); onChanged?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function archive(p: PackageView, archived: boolean) {
    setBusy(true); setError(''); setNotice('');
    const body = { requestId: requestId(), id: p.id, archived };
    try { await withStepUp(archived ? 'Arşive al' : 'Geri al', () => api(`${ADMIN}/packages/archive`, body)); setNotice(archived ? `“${p.name}” arşive alındı.${p.businesses ? ` ${p.businesses} işletme bu paketle devam ediyor.` : ''}` : `“${p.name}” yeniden sunuluyor.`); await load(); onChanged?.(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!catalog) return <section className="panel" aria-label="Paketler"><h2><Package size={18} /> Paketler</h2>{error ? <Notice tone="error">{error}</Notice> : <p className="muted">Yükleniyor…</p>}</section>;
  if (draft) return <PackageBuilder catalog={catalog} draft={draft} onDraft={d => { setDraft(d); setAsking(false); }} busy={busy} asking={asking} error={error} onSave={() => void save()} onCancel={() => { setDraft(null); setError(''); }} />;
  const live = catalog.packages.filter(p => !p.archived && !p.legacy), archived = catalog.packages.filter(p => p.archived && !p.legacy), legacy = catalog.packages.filter(p => p.legacy);
  const card = (p: PackageView) => <article key={p.id} className={`package-card${p.archived ? ' archived' : ''}${p.legacy ? ' legacy' : ''}`} aria-label={p.name}>
    <header><h3>{p.name}</h3>{p.legacy ? <span className="status-chip idle">Eski plan</span> : p.archived ? <span className="status-chip idle">Arşivde</span> : null}</header>
    <div className="package-price"><strong>{money(p.price.monthly)}</strong><span>/ay</span><small>{money(p.price.yearly)} / yıl</small></div>
    {p.discount && <span className="discount-chip">{discountText(p.discount)}</span>}
    <FeatureChips ids={p.features} max={7} />
    <footer>
      <span className="package-use"><Store size={14} aria-hidden="true" />{p.businesses ? `${p.businesses} işletmede` : 'Henüz kullanılmıyor'}</span>
      <div className="package-actions">
        {p.legacy ? <button type="button" className="btn secondary small-btn grow" disabled={busy} aria-label={`${p.name} paketini kopyala`} onClick={() => open(fromPackage(p, true))}><Copy size={14} />Kopyala</button> : <>
          {p.archived ? <button type="button" className="btn secondary small-btn grow" disabled={busy} aria-label={`${p.name} paketini geri al`} onClick={() => void archive(p, false)}><ArchiveRestore size={14} />Geri al</button>
            : <button type="button" className="btn secondary small-btn grow" disabled={busy} aria-label={`${p.name} paketini düzenle`} onClick={() => open(fromPackage(p))}><Pencil size={14} />Düzenle</button>}
          <button type="button" className="btn secondary small-btn icon-only" disabled={busy} title="Kopyala" aria-label={`${p.name} paketini kopyala`} onClick={() => open(fromPackage(p, true))}><Copy size={16} /></button>
          {!p.archived && <button type="button" className="btn secondary small-btn icon-only" disabled={busy} title="Arşivle" aria-label={`${p.name} paketini arşivle`} onClick={() => void archive(p, true)}><Archive size={16} /></button>}
        </>}
      </div>
    </footer>
  </article>;
  return <section className="packages-page" aria-label="Paketler">
    <div className="packages-head"><div><h2><Package size={20} /> Hizmet paketleri</h2><p className="muted">İşletmelere atanan paketler. Fiyatlar “Hizmet fiyatları” sekmesinden hesaplanır (KDV hariç).</p></div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => open({ name: '', features: normalFeatures([]), discountOk: true, businesses: 0 })}><PackagePlus size={16} />Yeni paket</button></div>
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <div className="package-grid">{live.map(card)}
      <button type="button" className="package-card package-new" disabled={busy} onClick={() => open({ name: '', features: normalFeatures([]), discountOk: true, businesses: 0 })}><span className="add-tile-icon"><PackagePlus size={22} /></span><strong>Yeni paket</strong><small>Hizmetleri seçin, fiyat kendiliğinden hesaplanır.</small></button>
    </div>
    {archived.length > 0 && <details className="package-more"><summary>Arşivdeki paketler ({archived.length})</summary><div className="package-grid">{archived.map(card)}</div></details>}
    {legacy.length > 0 && <section className="package-legacy" aria-label="Eski planlar"><h3>Eski planlar</h3>
      <p className="muted small">Paketlemeden önceki işletmeler bu planlarda kaldı; davranışları değişmedi. Yeni işletmelere verilmez; içerikleri değiştirilemez, kopyalanabilir.</p>
      <div className="package-grid">{legacy.map(card)}</div></section>}
  </section>;
}

/** The builder: services on the left, the name, discount and live total on the right (under them on a phone). */
function PackageBuilder({ catalog, draft, onDraft, busy, asking, error, onSave, onCancel }: { catalog: CatalogView; draft: Draft; onDraft: (d: Draft) => void; busy: boolean; asking: boolean; error: string; onSave: () => void; onCancel: () => void }) {
  const price = livePrice(catalog, draft.features, draft.discount), list = livePrice(catalog, draft.features);
  const nameProblem = draft.name.trim().length < 2 ? 'Paket adını yazın (en az 2 harf).' : catalog.packages.some(p => p.id !== draft.id && !p.archived && p.name.toLocaleLowerCase('tr-TR') === draft.name.trim().toLocaleLowerCase('tr-TR')) ? 'Bu adda bir paket var.' : '';
  const brought = addedFor(draft.features);
  const ready = !nameProblem && draft.discountOk && !draft.legacy;
  return <section className="package-builder" aria-label={draft.id ? 'Paketi düzenle' : 'Yeni paket'}>
    <button type="button" className="text-btn back-link" disabled={busy} onClick={onCancel}><ArrowLeft size={16} aria-hidden="true" />Paketler</button>
    <header className="builder-head"><h2>{draft.id ? draft.name || 'Paket' : 'Yeni paket'}</h2><p className="muted">Hizmetleri seçin; gerekenler kendiliğinden eklenir. Toplam sağda canlı hesaplanır.</p></header>
    <div className="builder-layout">
      <div className="builder-main"><FeaturePicker catalog={catalog} chosen={draft.features} disabled={busy || draft.legacy} onChange={features => onDraft({ ...draft, features })} label="Paketteki hizmetler" /></div>
      <aside className="builder-summary" aria-label="Paket özeti">
        <label className="builder-name">Paket adı<input value={draft.name} maxLength={60} disabled={busy || draft.legacy} placeholder="ör. Kafe Standart" onChange={e => onDraft({ ...draft, name: e.target.value })} aria-invalid={!!nameProblem && !!draft.name} /></label>
        {nameProblem && draft.name && <small className="field-problem">{nameProblem}</small>}
        <DiscountField label="Paket indirimi (isteğe bağlı)" value={draft.discount} disabled={busy} max={list.listMonthly} onChange={(discount, ok) => onDraft({ ...draft, discount, discountOk: ok })} />
        <div className="builder-total">
          <span className="builder-count">{draft.features.length} hizmet</span>
          <PriceBlock price={price} label="Paket toplamı" />
          {price.listMonthly !== price.monthly && <small className="muted">Liste fiyatı {money(price.listMonthly)}/ay · {discountText(draft.discount)}</small>}
          <small className="muted">KDV hariç. Yıllık = 10 ay.</small>
        </div>
        {brought.length > 0 && <ul className="builder-notes">{brought.map(([need, by]) => <li key={need}>{featureName(by)} için {featureName(need)} de eklendi.</li>)}</ul>}
        {draft.id && draft.businesses > 0 && <p className={`builder-warning${asking ? ' asking' : ''}`} role={asking ? 'alert' : undefined}>{asking ? `Emin misiniz? ${draft.businesses} işletmenin hizmetleri de değişir ve lisansları yeniden imzalanır. Onaylamak için yeniden “Kaydet”e dokunun.` : `Bu paket ${draft.businesses} işletmede kullanılıyor; değişiklik onlara da uygulanır.`}</p>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="builder-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Vazgeç</button>
          <button type="button" className={`btn primary${asking ? ' confirm' : ''}`} disabled={busy || !ready} onClick={onSave}>{busy ? 'Kaydediliyor…' : asking ? 'Evet, kaydet' : draft.id ? 'Kaydet' : 'Paketi oluştur'}</button>
        </div>
      </aside>
    </div>
  </section>;
}

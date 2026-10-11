import { SocialFollow } from './SocialFollow';
import { MenuHero } from './MenuHero';
import { businessTheme } from './BusinessTheme';
import { useEffect, useState } from 'react';
import { Coffee } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api } from './api';
import { sectorSlogan } from '../packages/domain/sector';
import { hasFeature } from '../packages/domain/feature-gate';
import { BusinessBrand, Brand, Composer, Modal, Notice } from './components';

import { goTo } from './navigate';
/** owner: "Görünümü değiştir" opens Ayarlar → İşletme → Görünüm (logo, renk, karşılama yazısı). */
export function MenuPreview({ onClose, owner = false }: { onClose: () => void; owner?: boolean }) {
  const [width, setWidth] = useState(390); const [revision, setRevision] = useState(0);
  return <Modal title="Menü önizlemesi" className="menu-preview-dialog" onClose={onClose}><div className="preview-toolbar"><label>Ekran boyutu<select aria-label="Önizleme ekran boyutu" value={width} onChange={e => setWidth(Number(e.target.value))}><option value={320}>Küçük telefon · 320 px</option><option value={390}>Telefon · 390 px</option><option value={768}>Tablet · 768 px</option></select></label><button className="btn secondary small-btn" onClick={() => setRevision(n => n + 1)}>Önizlemeyi yenile</button>{owner && <button type="button" className="btn secondary small-btn" onClick={() => { onClose(); goTo({ view: 'settings', topic: 'business', part: 'profile' }); }}>Görünümü değiştir</button>}</div><p className="preview-caption muted small">Yayındaki menünüz gösterilir; taslaklar dahil değildir. Ürünlere dokunarak seçenekleri inceleyebilirsiniz; sipariş gönderilemez.</p><div className="menu-preview-stage"><iframe key={revision} title="Müşteri menüsü önizlemesi" src="/menu-preview" style={{ width }} /></div></Modal>;
}

export function MenuPreviewPage() {
  const [data, setData] = useState<StaffSnapshot | null>(null); const [error, setError] = useState(''); const [en, setEn] = useState(false);
  useEffect(() => { let live = true; api<StaffSnapshot>('/api/staff/state').then(d => { if (live) { if (d.role !== 'owner' && d.role !== 'manager' && d.role !== 'support') setError('Menü önizlemesi yalnızca işletme sahibine ve müdüre açıktır.'); else setData(d); } }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  if (error) return <div className="modal-body"><Notice tone="error">{error}</Notice></div>;
  if (!data) return <p role="status" className="modal-body">Menü hazırlanıyor…</p>;
  return <div className="customer business-themed" style={businessTheme(data.theme)}><header className="customer-header"><BusinessBrand name={data.name} logo={data.logo} /><div className="customer-header-right"><button className="language-btn" onClick={() => setEn(v => !v)}>{en ? 'TR' : 'EN'}</button><span className="table-pill">{en ? 'Preview' : 'Önizleme'}</span></div></header><MenuHero name={data.name} value={data.menuHero} en={en} /><main className="customer-main"><Notice>{en ? 'Preview only. No order will be placed.' : 'Önizleme modu. Gerçek sipariş oluşturulmaz.'}</Notice><Composer namesEn={data.categoryNamesEn} newProductIds={data.newProductIds} preview popularProductIds={data.popularProductIds} subcategoryOrder={data.subcategories} categoryOrder={data.categories} products={data.products.filter(p => p.published !== false)} tableId="" enabled onSent={() => {}} en={en} /></main><footer className="customer-footer">{hasFeature(data.pkg?.enabled, 'social') && <SocialFollow links={data.socialLinks} en={en} />}<Brand name={data.name} /><p>{sectorSlogan(data.sector, en)}</p></footer></div>;
}

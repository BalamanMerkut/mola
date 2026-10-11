import { lazy } from 'react';
import { CalendarCheck, Clock3, Coffee, MoonStar, Percent, Receipt, Settings, Tags, Undo2, Users } from 'lucide-react';
import type { Product, StaffSnapshot } from '../packages/domain/types';
import { PillTabs } from './PillTabs';
import { DeferredPanel } from './DeferredPanel';
import { useRememberedTab } from './remember';
import { Employees } from './Administration';
import { MenuManagement } from './MenuManagement';
import { Campaigns } from './Campaigns';
import { VatSettingsCard } from './VatSettings';
import { goTo, type CashTab, type MenuTab, type StaffTab } from './navigate';
import type { CashOpening, StaffOpening } from './HomeBooks';
import './moved.css';

/*
 * The homes of the 10 Ekim düzeni (docs/BILGI_MIMARISI_ONERISI.md, "Her konunun tek bir evi"): a topic's daily work, its
 * record book and its settings in one place, in tabs. Level 1 is the icon pill row below; level 2 (a tab holding more than
 * one kind of thing) is the quieter row of src/HomeBooks.tsx. The owner-only settings tab is always last, with the gear.
 * A role with a single tab (the cashier's Kasa, the Müdür's Personel) sees no tab row at all. Every tab stays chosen on
 * this device; a link (`open`) wins.
 */
const Books = {
  Cash: lazy(() => import('./HomeBooks').then(m => ({ default: m.CashBooks }))),
  Staff: lazy(() => import('./HomeBooks').then(m => ({ default: m.StaffBooks }))),
};

const CASH_TABS: { id: CashTab; label: string; icon: typeof Clock3 }[] = [
  { id: 'today', label: 'Bugün', icon: CalendarCheck }, { id: 'expenses', label: 'Giderler', icon: Receipt },
  { id: 'closings', label: 'Kapanışlar', icon: MoonStar }, { id: 'refunds', label: 'İadeler', icon: Undo2 }, { id: 'settings', label: 'Kasa ayarları', icon: Settings },
];
/** Owner: all five; Müdür: no Kasa ayarları (blind on the closing difference, as before); cashier: Bugün only. */
export const cashTabsFor = (role: string): CashTab[] => role === 'owner' ? ['today', 'expenses', 'closings', 'refunds', 'settings'] : role === 'manager' ? ['today', 'expenses', 'closings', 'refunds'] : ['today'];

/**
 * Kasa ve giderler (phone: "Kasa"). Bugün is the cash strip of Masalar (opening, Para bozdurma / Kasa hareketi, Gider kaydet,
 * İade, Vardiya kodu, Gün sonu): src/CashDay.tsx renders it into `onSlot`, so one panel serves Masalar and this tab.
 */
export function CashHome({ data, open, onSlot, onSaved }: { data: StaffSnapshot; open?: CashOpening; onSlot: (el: HTMLElement | null) => void; onSaved: () => void }) {
  const allowed = cashTabsFor(data.role);
  const [tab, setTab] = useRememberedTab<CashTab>('mola-cash-tab', allowed, 'today', open?.tab, open?.key);
  return <div className="home cash-home">
    {allowed.length > 1 && <PillTabs label="Kasa ve giderler bölümleri" className="home-tabs" dataAttr="home-tab" value={tab} onChange={setTab} items={CASH_TABS.filter(t => allowed.includes(t.id)).map(t => ({ id: t.id, label: t.label, icon: t.icon }))} />}
    {tab === 'today' ? <div className="cash-today" ref={onSlot} /> : <DeferredPanel><Books.Cash key={open?.key} tab={tab} open={open} data={data} onSaved={onSaved} /></DeferredPanel>}
  </div>;
}

const STAFF_TABS: { id: StaffTab; label: string; icon: typeof Clock3 }[] = [
  { id: 'staff', label: 'Çalışanlar', icon: Users }, { id: 'shifts', label: 'Vardiya ve bahşiş', icon: Clock3 }, { id: 'settings', label: 'Personel ayarları', icon: Settings },
];
/** Personel (eski adı "Çalışanlar"): the owner's three tabs; the Müdür reads Vardiya ve bahşiş only. */
export function StaffHome({ role, open }: { role: string; open?: StaffOpening }) {
  const allowed: StaffTab[] = role === 'owner' ? ['staff', 'shifts', 'settings'] : ['shifts'];
  const [tab, setTab] = useRememberedTab<StaffTab>('mola-staff-tab', allowed, allowed[0], open?.tab, open?.key);
  return <div className="home staff-home">
    {allowed.length > 1 && <PillTabs label="Personel bölümleri" className="home-tabs" dataAttr="home-tab" value={tab} onChange={setTab} items={STAFF_TABS.filter(t => allowed.includes(t.id)).map(t => ({ id: t.id, label: t.label, icon: t.icon }))} />}
    {tab === 'staff' ? <Employees /> : <DeferredPanel><Books.Staff key={open?.key} tab={tab} open={open} /></DeferredPanel>}
  </div>;
}

export type MenuOpening = { key: number; tab?: MenuTab; renew?: string };
const MENU_TABS: { id: MenuTab; label: string; icon: typeof Clock3 }[] = [{ id: 'products', label: 'Ürünler', icon: Coffee }, { id: 'campaigns', label: 'Kampanyalar', icon: Tags }, { id: 'vat', label: 'KDV oranları', icon: Percent }];
/**
 * Menü yönetimi: Ürünler (Kategorileri yönet and Menüyü önizle as buttons), Kampanyalar (once a place of its own) and, the
 * owner's, KDV oranları (once Ayarlar → Giderler ve kâr). Mola destek uses it too, without KDV and without reports.
 */
export function MenuHome({ data, owner, open, reports = true, onAdd, onEdit, onCategories, onPreview, onSaved, onError }: { data: StaffSnapshot; owner: boolean; open?: MenuOpening; reports?: boolean; onAdd: () => void; onEdit: (p: Product) => void; onCategories: () => void; onPreview: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const allowed: MenuTab[] = owner ? ['products', 'campaigns', 'vat'] : ['products', 'campaigns'];
  const [tab, setTab] = useRememberedTab<MenuTab>('mola-menu-tab', allowed, 'products', open?.tab, open?.key);
  return <div className="home menu-home">
    <PillTabs label="Menü yönetimi bölümleri" className="home-tabs" dataAttr="home-tab" value={tab} onChange={setTab} items={MENU_TABS.filter(t => allowed.includes(t.id)).map(t => ({ id: t.id, label: t.label, icon: t.icon }))} />
    {tab === 'products' && <MenuManagement data={data} onAdd={onAdd} onEdit={onEdit} onCategories={onCategories} onPreview={onPreview} onSaved={onSaved} onError={onError} />}
    {tab === 'campaigns' && <Campaigns key={open?.renew ? open.key : undefined} renew={open?.renew} products={data.products} onSaved={() => void onSaved()} onResults={reports ? id => goTo({ view: 'reports', tab: 'campaigns', campaign: id }) : undefined} />}
    {tab === 'vat' && owner && <div className="settings-shell home-settings"><div className="settings-page"><div className="settings-page-body"><VatSettingsCard /></div></div></div>}
  </div>;
}

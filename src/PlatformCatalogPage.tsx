import { Package, Tags } from 'lucide-react';
import { PillTabs } from './PillTabs';
import { PlatformPackages } from './PlatformPackages';
import { PlatformPrices } from './PlatformPrices';
import './platform-settings.css';

export type PackagesTab = 'packages' | 'prices';
export const packagesTabs: [PackagesTab, string][] = [['packages', 'Paketler'], ['prices', 'Hizmet fiyatları']];

/**
 * "Paketler" in the left menu (13 Ekim; once two sections of Ayarlar): the service packages and, as its one sub-tab, "Hizmet
 * fiyatları" (each service's price; the packages are priced from it). The tab lives in src/Platform.tsx so the step-up's
 * "Kaldığım yere dön" comes back to the same one.
 */
export function PlatformCatalogPage({ tab, onTab, onChanged }: { tab: PackagesTab; onTab: (tab: PackagesTab) => void; onChanged?: () => void }) {
  return <div className="platform-settings platform-catalog-page">
    <header className="page-head"><div><h1>Paketler</h1><p className="page-lead">İşletmelere verilen hizmet paketleri ve hizmetlerin fiyatları.</p></div></header>
    <PillTabs items={packagesTabs.map(([id, label]) => ({ id, label, icon: id === 'packages' ? Package : Tags }))} value={tab} onChange={onTab} label="Paketler bölümleri" kind="nav" wrapClassName="settings-pill-tabs" />
    {tab === 'packages' ? <PlatformPackages onChanged={onChanged} /> : <div className="platform-settings-wide"><PlatformPrices onChanged={onChanged} /></div>}
  </div>;
}

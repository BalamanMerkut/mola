import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import './network-profile.css';

/** server/network-profile.ts: the connections phones use that Windows has on the "Genel" (Public) profile. */
export type NetworkProfileView = { checked: boolean; public: string[] };

/** Reads the profile once when the screen opens (`load`: the desktop window's or the staff route); null until it answers. */
export function useNetworkProfile(load: () => Promise<NetworkProfileView>, active = true) {
  const [view, setView] = useState<NetworkProfileView | null>(null);
  useEffect(() => { if (!active) return; let live = true; void load().then(v => { if (live) setView(v); }).catch(() => {}); return () => { live = false; }; }, [active]);
  return view;
}

/**
 * Tabletler (src/DesktopRail.tsx) and Ayarlar → Cihazlar (src/SettingsPages.tsx): Mola's firewall rule allows private networks
 * only, so on a "Genel" connection phones and tablets cannot reach Mola. Mola never changes the setting; this says how.
 */
export function NetworkProfileNotice({ view }: { view: NetworkProfileView | null }) {
  if (!view?.public.length) return null;
  const name = view.public.join(' / ');
  return <div className="network-profile-warning" role="alert" data-testid="network-profile-warning">
    <TriangleAlert size={18} aria-hidden="true" />
    <div>
      <strong>Bu bilgisayarın ağı “Genel” olarak ayarlı; telefonlar ve tabletler bağlanamaz.</strong>
      <p>Windows Ayarları → Ağ ve İnternet → {name} → Ağ profili: <b>Özel</b>.</p>
      <ol>
        <li>Başlat → <b>Ayarlar</b> → <b>Ağ ve İnternet</b>.</li>
        <li>Bağlantıyı açın: <b>{name}</b>. Wi-Fi ise bağlı ağın <b>Özellikler</b>'ine girin.</li>
        <li><b>Ağ profili türü</b> bölümünde <b>Özel ağ</b>'ı seçin.</li>
        <li>Bu pencereyi kapatıp yeniden açın; uyarı kaybolur.</li>
      </ol>
      <small>Mola bu ayarı kendisi değiştirmez. Kafenin kendi Wi-Fi'si ya da kablolu ağı için “Özel” doğrudur.</small>
    </div>
  </div>;
}

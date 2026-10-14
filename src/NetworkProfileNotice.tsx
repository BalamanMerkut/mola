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
 * Kafe içi cihazlar (src/DesktopRail.tsx) and Ayarlar → Cihazlar (src/SettingsPages.tsx): a "Genel" connection while Mola's firewall
 * rule is still the old private-only one (server/network-profile.ts reports nothing once the rule covers every profile).
 * The fix is "İzni düzelt" (Kafe içi cihazlar): Mola's own rule, the network setting stays as it is; Windows' setting is the other way.
 */
export function NetworkProfileNotice({ view, here = false }: { view: NetworkProfileView | null; /** In Kafe içi cihazlar, right above "İzni düzelt". */ here?: boolean }) {
  if (!view?.public.length) return null;
  const name = view.public.join(' / ');
  return <div className="network-profile-warning" role="alert" data-testid="network-profile-warning">
    <TriangleAlert size={18} aria-hidden="true" />
    <div>
      <strong>Telefonlar ve tabletler bu bilgisayara bağlanamıyor: ağ “Genel” olarak ayarlı, Mola'nın güvenlik duvarı izni eski.</strong>
      {here
        ? <p>Aşağıdaki <b>İzni düzelt</b>'e basın; Windows bir kez “Evet” diye sorar. Ağ ayarınız değişmez.</p>
        : <p>Kasa bilgisayarındaki Mola penceresinde sol şeritten <b>Kafe içi cihazlar</b> → <b>İzni düzelt</b>'e basın; Windows bir kez “Evet” diye sorar. Ağ ayarınız değişmez.</p>}
      <small>Ya da Windows Ayarları → Ağ ve İnternet → {name} → Ağ profili: Özel.</small>
    </div>
  </div>;
}

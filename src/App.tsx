import { lazy, Suspense } from 'react';
import { DeferredPanel } from './DeferredPanel';
import { Customer } from './Customer';
import { DesktopRail } from './DesktopRail';
import { LockedScreen, useLocked } from './Locked';
import { guestPageHead } from './molaApp';
import { ownerPageHere } from './ownerHome';
import { pane } from './pane';
import { useServerVersion } from './versionReload';
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })));
const MenuPreviewPage = lazy(() => import('./MenuPreview').then(module => ({ default: module.MenuPreviewPage })));
// /uygulama: installing Mola on phones and tablets; needs no data and no sign-in.
const InstallPage = lazy(() => import('./InstallPage').then(module => ({ default: module.InstallPage })));
// /yonet (served only by Mola Merkez; "/" of its own name isletme.…, src/ownerHome.ts): "İşletmemi yönet", the owner's sign-in,
// reports and these screens through the sealed tunnel.
const OwnerPage = lazy(() => import('./ReportsPhone').then(module => ({ default: module.OwnerPage })));
export function App() {
  const locked = useLocked();
  // After a café update the window, tablets and phones reload themselves at a quiet moment (src/versionReload.ts). Never the
  // guests' menu (a cart in progress) or the owner's tunnelled screens (/yonet or isletme.…/, their own server).
  useServerVersion(() => /^\/(m|yonet)(\/|$)/.test(location.pathname) || ownerPageHere() ? Promise.resolve(undefined) : fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).then((h: { version?: string }) => h.version));
  if (/^\/uygulama\/?$/.test(location.pathname)) return <DeferredPanel><InstallPage /></DeferredPanel>;
  if (ownerPageHere()) { if (location.pathname !== '/yonet' && location.pathname !== '/') history.replaceState(null, '', `/yonet${location.search}${location.hash}`); return <DeferredPanel><Suspense fallback={<OwnerBoot />}><OwnerPage /></Suspense></DeferredPanel>; }
  if (locked) return <LockedScreen guest={location.pathname.startsWith('/m/')} />;
  if (location.pathname.startsWith('/m/')) { guestPageHead(); return <Customer token={location.pathname.slice(3)} />; }
  const page = <DeferredPanel>{location.pathname === '/menu-preview' ? <MenuPreviewPage /> : <Workspace />}</DeferredPanel>;
  // İki ekran: a pane is one plain Mola screen; the rail (and its desktop key) stays with the outer window (src/SplitView.tsx).
  // Menü önizlemesi is a frame inside the owner's screen: never the rail (13 Ekim: on the café computer with "İkiye böl"
  // remembered, the frame showed two staff screens instead of the guest menu).
  if (pane || location.pathname === '/menu-preview') return page;
  return <DesktopRail>{page}</DesktopRail>;
}
/** İşletmemi yönet while its code loads: the same neutral "logo + Açılıyor…" the page shows until it knows the state (0.1.24). */
function OwnerBoot() {
  return <div role="status" aria-busy="true" style={{ minHeight: '100dvh', display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 14, background: 'var(--brand-bg, #ece7dc)', color: '#66726b', font: '15px Inter, "Segoe UI", system-ui, sans-serif' }}>
    <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 16, background: '#234c3e', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 24 }}>M</span>Açılıyor…
  </div>;
}

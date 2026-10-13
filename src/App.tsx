import { lazy } from 'react';
import { DeferredPanel } from './DeferredPanel';
import { Customer } from './Customer';
import { DesktopRail } from './DesktopRail';
import { LockedScreen, useLocked } from './Locked';
import { guestPageHead } from './molaApp';
import { pane } from './pane';
import { useServerVersion } from './versionReload';
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })));
const MenuPreviewPage = lazy(() => import('./MenuPreview').then(module => ({ default: module.MenuPreviewPage })));
// /uygulama: installing Mola on phones and tablets; needs no data and no sign-in.
const InstallPage = lazy(() => import('./InstallPage').then(module => ({ default: module.InstallPage })));
// /yonet (served only by Mola Merkez): the owner's paired device runs these screens through the sealed tunnel.
const RemoteShell = lazy(() => import('./RemoteAdmin').then(module => ({ default: module.RemoteShell })));
export function App() {
  const locked = useLocked();
  // After a café update the window, tablets and phones reload themselves at a quiet moment (src/versionReload.ts). Never the
  // guests' menu (a cart in progress) or the owner's tunnelled screens (/yonet, their own server).
  useServerVersion(() => /^\/(m|yonet)(\/|$)/.test(location.pathname) ? Promise.resolve(undefined) : fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).then((h: { version?: string }) => h.version));
  if (/^\/uygulama\/?$/.test(location.pathname)) return <DeferredPanel><InstallPage /></DeferredPanel>;
  if (/^\/yonet\/?$/.test(location.pathname)) return <DeferredPanel><RemoteShell /></DeferredPanel>;
  if (locked) return <LockedScreen guest={location.pathname.startsWith('/m/')} />;
  if (location.pathname.startsWith('/m/')) { guestPageHead(); return <Customer token={location.pathname.slice(3)} />; }
  const page = <DeferredPanel>{location.pathname === '/menu-preview' ? <MenuPreviewPage /> : <Workspace />}</DeferredPanel>;
  // İki ekran: a pane is one plain Mola screen; the rail (and its desktop key) stays with the outer window (src/SplitView.tsx).
  // Menü önizlemesi is a frame inside the owner's screen: never the rail (13 Ekim: on the café computer with "İkiye böl"
  // remembered, the frame showed two staff screens instead of the guest menu).
  if (pane || location.pathname === '/menu-preview') return page;
  return <DesktopRail>{page}</DesktopRail>;
}

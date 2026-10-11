import { lazy } from 'react';
import { DeferredPanel } from './DeferredPanel';
import { Customer } from './Customer';
import { DesktopRail } from './DesktopRail';
import { LockedScreen, useLocked } from './Locked';
import { guestPageHead } from './molaApp';
import { pane } from './pane';
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })));
const MenuPreviewPage = lazy(() => import('./MenuPreview').then(module => ({ default: module.MenuPreviewPage })));
// /uygulama: installing Mola on phones and tablets; needs no data and no sign-in.
const InstallPage = lazy(() => import('./InstallPage').then(module => ({ default: module.InstallPage })));
// /yonet (served only by Mola Merkez): the owner's paired device runs these screens through the sealed tunnel.
const RemoteShell = lazy(() => import('./RemoteAdmin').then(module => ({ default: module.RemoteShell })));
export function App() {
  const locked = useLocked();
  if (/^\/uygulama\/?$/.test(location.pathname)) return <DeferredPanel><InstallPage /></DeferredPanel>;
  if (/^\/yonet\/?$/.test(location.pathname)) return <DeferredPanel><RemoteShell /></DeferredPanel>;
  if (locked) return <LockedScreen guest={location.pathname.startsWith('/m/')} />;
  if (location.pathname.startsWith('/m/')) { guestPageHead(); return <Customer token={location.pathname.slice(3)} />; }
  const page = <DeferredPanel>{location.pathname === '/menu-preview' ? <MenuPreviewPage /> : <Workspace />}</DeferredPanel>;
  // İki ekran: a pane is one plain Mola screen; the rail (and its desktop key) stays with the outer window (src/SplitView.tsx).
  if (pane) return page;
  return <DesktopRail>{page}</DesktopRail>;
}

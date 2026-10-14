import { lazy, useEffect, useState } from 'react';
import { DeferredPanel } from './DeferredPanel';
import { closeRemote, type RemoteSession } from './remoteTransport';
import './remote-admin.css';

/*
 * "Kafeyi yönet" inside Kafemi yönet (/yonet on Mola Merkez, src/ReportsPhone.tsx decides when): the café's usual screens
 * (src/Workspace.tsx) run here with every request sealed through src/remoteTransport.ts. A slim bar over them says where
 * they run: "<İşletme> · Uzaktan", the connection, "Raporlar" (the report view, the session stays) and "Çıkış" (ends this
 * remote session; the device stays signed in). The bar's height is taken off the screens' own layout (remote-admin.css).
 */
const Workspace = lazy(() => import('./Workspace').then(module => ({ default: module.Workspace })));

export function ManageFrame({ session, onReports }: { session: RemoteSession; onReports: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add('remote-on');
    return () => document.documentElement.classList.remove('remote-on');
  }, []);
  return <>
    <div className="remote-bar" role="region" aria-label="Uzaktan yönetim">
      <span className="remote-bar-mark" aria-hidden="true">M</span>
      <strong className="remote-bar-name">{session.business}</strong><span className="remote-bar-tag">Uzaktan</span>
      <span className="remote-bar-state" role="status"><span className="remote-bar-dot" aria-hidden="true" />Bağlı · şifreli</span>
      <span className="remote-bar-gap" />
      <button type="button" className="remote-bar-btn" onClick={onReports}>Raporlar</button>
      <button type="button" className="remote-bar-btn" disabled={leaving} onClick={() => { setLeaving(true); void closeRemote().finally(() => setLeaving(false)); }}>{leaving ? 'Çıkılıyor…' : 'Çıkış'}</button>
    </div>
    <DeferredPanel><Workspace key={session.sid} /></DeferredPanel>
  </>;
}

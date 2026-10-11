import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lock } from 'lucide-react';
import { setBasePath } from './basePath';
import { Customer } from './Customer';
import { Brand } from './components';
import { LOCKED_EVENT } from './Locked';
import './style.css';
import './service-features.css';
import './security.css';

/*
 * The guest menu over the internet (menu.html): Mola Merkez serves it at /q/<kod>/<masa kodu> and passes its /api/guest and
 * /media requests to the café computer through the café's own outbound tunnel (server/guest-tunnel.ts,
 * server/merkez/guest-tunnel.ts). Only the guest screen is in this bundle: no staff screens, no sign-in, no desktop rail. Its
 * files are addressed relative to the page, its calls go under the same prefix (src/basePath.ts), so the same build works on
 * molayazilim.com.tr/q/…, on Merkez's own address and in the browser tests' http://127.0.0.1 Merkez.
 */
const path = location.pathname, cut = path.lastIndexOf('/');
setBasePath(path.slice(0, cut + 1));
const token = path.slice(cut + 1);
/** Data locked on the café computer (423): the same plain guest line as the café's own menu (src/Locked.tsx). */
function GuestMenu() {
  const [locked, setLocked] = useState(false);
  useEffect(() => { const on = () => setLocked(true); window.addEventListener(LOCKED_EVENT, on); return () => window.removeEventListener(LOCKED_EVENT, on); }, []);
  if (locked) return <main className="locked-screen" data-testid="locked-screen"><div className="locked-card"><Brand /><span className="locked-icon" aria-hidden="true"><Lock size={30} strokeWidth={1.6} /></span><h1>Menü şu anda açılamıyor</h1><p>Lütfen personele haber verin.</p></div></main>;
  return <Customer token={token} />;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><GuestMenu /></React.StrictMode>);

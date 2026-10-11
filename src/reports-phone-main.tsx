import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReportsPhone } from './ReportsPhone';
import { showStudioSplash } from './StudioSplash';
import './reports-phone.css';

// "Raporlarım": the café owner's phone page, served only by Mola Merkez (raporlarim.html; server/merkez/relay.ts).
// Merkut Studios açılışı: off until "raporlarim" is turned on in src/studio-splash.json.
showStudioSplash('raporlarim');
createRoot(document.getElementById('root')!).render(<React.StrictMode><ReportsPhone /></React.StrictMode>);

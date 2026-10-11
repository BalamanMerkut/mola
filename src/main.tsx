import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installPane } from './pane';
import { showStudioSplash } from './StudioSplash';
import './style.css';
import './service-features.css';
import './app-shell.css';

// İki ekran: inside a pane of the café computer's window every API call names its pane (src/pane.ts); elsewhere nothing changes.
installPane();
// Merkut Studios açılışı: only on a Mola.exe launch (its one-time `#masaustu=` address, read here before src/desktop-call.ts
// drops it), over the sign-in that loads beneath it; never on tablets, phones or the guest menu (src/splashRules.ts).
showStudioSplash('kafe');
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

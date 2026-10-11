import React from 'react';
import { createRoot } from 'react-dom/client';
import { Platform } from './Platform';
import { showStudioSplash } from './StudioSplash';
import './style.css';

// Mola Yönetim: the vendor's panel, served only by Mola Merkez (merkez.html). Café computers never load it.
// Merkut Studios açılışı: off until "yonetim" is turned on in src/studio-splash.json.
showStudioSplash('yonetim');
createRoot(document.getElementById('root')!).render(<React.StrictMode><Platform /></React.StrictMode>);

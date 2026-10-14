import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { molaIcons } from './scripts/mola-icons.mjs';
import { studioLogoPlugin } from './scripts/studio-logo.mjs';

export default defineConfig({
  // molaIcons: icon-192/512, maskable and apple-touch-icon PNGs drawn from scripts/desktop/mola-icon.svg (none kept in public/).
  // studioLogoPlugin: the Merkut Studios opening's logo (AVIF/WebP/JPEG, 600 px) from brand/merkut-studios (src/StudioSplash.tsx).
  plugins: [react(), molaIcons(), studioLogoPlugin()],
  // /@fs/ requests bypass the route allow-list in server/runtime.ts, so the same folders are denied here as well.
  server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.local/**', '**/.docwork/**', '**/_arsiv/**', '**/*.docx', '**/.claude/**', '**/server/**', '**/scripts/**', '**/docs/**', '**/tests/**', '**/test-results/**', '*.sqlite', 'platform-first-login.txt', 'merkez-first-login.txt'] } },
  // Two pages: index.html for cafés (server/runtime.ts; Mola Merkez also serves it for the owner's /yonet and Mola destek) and
  // merkez.html for Mola Yönetim (served only by server/merkez/runtime.ts). 0.1.23: raporlarim.html went into /yonet.
  // menu.html: the guest menu over the internet (Mola Merkez's /q/<kod>/…, server/merkez/guest-tunnel.ts). The café sends it
  // and exactly the files it needs, read from the manifest (.vite/manifest.json; a dot folder, never served as a file).
  build: { outDir: 'dist', sourcemap: false, manifest: true, rollupOptions: { input: { main: 'index.html', merkez: 'merkez.html', menu: 'menu.html' } } },
  // Files a script or a style sheet loads (lazy screens, their CSS, images) are found from that script's own address, so they
  // work under any prefix. Pages keep root addresses ('/assets/…': index.html also answers deep paths like /m/<kod> and
  // /destek/<oturum>), except menu.html, which lives under /q/<kod>/ and names its files relative to itself.
  experimental: {
    renderBuiltUrl(filename, { hostType, hostId, type }) {
      // (`relative: true` in a page still gives the root address while `base` is '/': the relative one is written out here.)
      if (hostType === 'html') return type !== 'public' && /(^|[\\/])menu\.html$/.test(hostId) ? `./${filename}` : `/${filename}`;
      return { relative: true };
    },
  },
});

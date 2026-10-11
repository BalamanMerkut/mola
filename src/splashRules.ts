import surfaces from './studio-splash.json';

/*
 * Merkut Studios açılışı: when it shows (src/StudioSplash.tsx draws it). Pure, so tests/studio-splash.test.ts checks it.
 *
 * Owner's decision (5 Ekim): ONLY when the café app is opened with Mola.exe. The launcher opens its window at
 * `/#masaustu=<desktop key>` (scripts/desktop/Mola.cs); that address is the one-time launch marker: src/desktop-call.ts
 * removes it from the address on the first load, so page changes and reloads never carry it, and a sessionStorage flag
 * stops a second showing in the same window anyway. Opening Mola.exe again while the window is open only brings the window
 * forward (no new start, no opening). Tablets' and phones' browsers, the guest menu (/m/…), frames (İki ekran panes) and
 * browser automation (navigator.webdriver: the browser tests sign in right after loading; tests/browser/studio-splash.spec.ts
 * turns it back on) never show it.
 *
 * The other surfaces are switched in ONE file, src/studio-splash.json (all off for now): "android" (the app's own native
 * opening, mobile/android; scripts/build-apk.mjs writes it into the APK; the web opening never shows inside the app),
 * "yonetim" (Mola Yönetim) and "raporlarim" (Raporlarım): once per browser session when turned on. "masaustu": the above.
 */
export const SPLASH_SEEN = 'mola-acilis-gosterildi';
/** ms. In 600, hold ~1.2 s, out 600, then 150 ms to the app; the logo may take up to 700 ms to arrive (hold shrinks). */
export const SPLASH_TIMING = { fadeIn: 600, hold: 1150, fadeOut: 600, leave: 150, waitImage: 700, reduced: 600, total: 2500 } as const;
export type SplashPlace = 'kafe' | 'yonetim' | 'raporlarim';
export type SplashSurfaces = { masaustu: boolean; android: boolean; yonetim: boolean; raporlarim: boolean };
export const SPLASH_SURFACES: SplashSurfaces = surfaces;
/** The address Mola.exe opens its window with (src/desktop-call.ts reads the same key and then drops it). */
export const DESKTOP_LAUNCH = /^#masaustu=[A-Za-z0-9_-]{43}$/;

export type SplashEnv = { path: string; hash: string; framed: boolean; app: boolean; automated: boolean; seen: boolean };
/** Whether this page start shows the opening. */
export function splashWanted(place: SplashPlace, env: SplashEnv, on: SplashSurfaces = SPLASH_SURFACES) {
  if (env.seen || env.framed || env.app || env.automated) return false;
  if (place === 'kafe') return on.masaustu && DESKTOP_LAUNCH.test(env.hash) && !/^\/m\//.test(env.path);
  return on[place];
}
/** Hold so the whole opening stays within 2.5 s whatever the logo took to arrive (≤ 700 ms). */
export const holdFor = (waited: number) => Math.max(450, SPLASH_TIMING.hold - Math.max(0, waited));

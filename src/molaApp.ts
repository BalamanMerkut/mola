/*
 * Where this page runs: the Android Mola app (a WebView that adds "MolaApp/<version>" to its User-Agent, mobile/android),
 * a home-screen web app (iPhone/iPad "Ana Ekrana Ekle", Android "Ana ekrana ekle"), or a plain browser tab.
 */
export function molaAppVersion(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  return /\bMolaApp\/([0-9][0-9A-Za-z.-]{0,31})/.exec(userAgent)?.[1] ?? null;
}
export const inMolaApp = () => molaAppVersion() !== null;
/** Opened from the home screen (no browser bars): iOS reports navigator.standalone, the others the display mode. */
export function standalone() {
  if (typeof window === 'undefined') return false;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
}
/** Installed one way or the other: hints like "Ana ekrana ekle" are not shown there. */
export const installed = () => inMolaApp() || standalone();
export type DeviceKind = 'android' | 'ios' | 'other';
export function deviceKind(userAgent = navigator.userAgent, touchMac = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)): DeviceKind {
  if (/Android/i.test(userAgent)) return 'android';
  // iPadOS asks for the desktop site and says "Macintosh"; a Mac with a touch screen does not exist.
  if (/iPhone|iPad|iPod/i.test(userAgent) || touchMac) return 'ios';
  return 'other';
}
/**
 * The guest menu (/m/...) is not the staff app: "Ana Ekrana Ekle" there should keep the menu's own address in Safari,
 * not open the staff sign-in. Its page drops the web app manifest and the iOS app tags.
 */
export function guestPageHead() {
  for (const el of document.querySelectorAll('link[rel="manifest"], meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]')) el.remove();
}

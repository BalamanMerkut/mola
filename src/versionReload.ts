import { useEffect, useSyncExternalStore } from 'react';
import { APP_VERSION } from './version';

/*
 * After an update the open pages still run the old screens until someone presses F5 (14 Ekim: Mola Yönetim kept showing the
 * old look after the Merkez update; the café window and the tablets the same after a café update). Each screen tells this
 * the server's version whenever it learns it; a different one reloads the page by itself, but only at a quiet moment: nobody
 * has touched the screen or a key for 30 s (or the page is in the background), nothing typed in the focused field and no window
 * (<dialog>) is open, so a half-typed order or form is never lost. The page is fetched fresh first (an old cached copy would
 * bring the old screens back). Once per version in a tab: if the reload still shows the old version, it does not try again.
 */
const TRIED = 'mola-surum-yenilendi';
export const QUIET_MS = 30_000;
let pending: string | null = null, lastInput = Date.now();

function tried(version: string) { try { return sessionStorage.getItem(TRIED) === version; } catch { return false; } }
function remember(version: string) { try { sessionStorage.setItem(TRIED, version); } catch { /* private mode: at worst one more reload later */ } }
/**
 * Something would be lost: a window open, or text typed in the field that has the focus. 14 Ekim: an empty field that kept
 * the focus (a search box clicked once) held the reload back for good, and Mola Yönetim stayed on 0.1.15 under Merkez 0.1.17.
 */
function busy() {
  if (document.querySelector('dialog[open]')) return true;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  if (active.isContentEditable) return !!active.textContent?.trim();
  if (active instanceof HTMLTextAreaElement) return !!active.value.trim();
  if (active instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(active.type) && !!active.value.trim();
  return false;
}
/** The newer version the server has (null: the same): the version lines offer "Yenile" with it (src/AppVersion.tsx). */
let newer: string | null = null;
const listeners = new Set<() => void>();
export function useNewerVersion() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => newer, () => null);
}
/** Reloads now, the page fetched fresh first. */
export function reloadFresh() {
  void fetch(location.pathname, { cache: 'reload', credentials: 'same-origin' }).catch(() => undefined).finally(() => location.reload());
}

/** The server answered with this version (undefined/empty: unknown, nothing happens). */
export function serverVersion(version: string | null | undefined) {
  if (version && version !== APP_VERSION && newer !== version) { newer = version; listeners.forEach(fn => fn()); }
  if (!version || version === APP_VERSION || pending === version || tried(version) || typeof document === 'undefined') return;
  pending = version;
  const touched = () => { lastInput = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(type, touched, { capture: true, passive: true });
  lastInput = Date.now();
  const check = setInterval(() => {
    if (busy() || (!document.hidden && Date.now() - lastInput < QUIET_MS)) return;
    clearInterval(check);
    remember(version);
    reloadFresh();
  }, 5000);
}

/** Asks `read` for the server's version now and every `everyMs` (screens that do not already poll something with it). */
export function useServerVersion(read: () => Promise<string | null | undefined>, everyMs = 120_000) {
  useEffect(() => {
    let live = true;
    const ask = () => void read().then(v => { if (live) serverVersion(v); }, () => undefined);
    ask();
    const t = setInterval(ask, everyMs);
    return () => { live = false; clearInterval(t); };
  }, []);
}

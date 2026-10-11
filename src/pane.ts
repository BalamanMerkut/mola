/*
 * İki ekran (src/SplitView.tsx): the café computer's Mola window can show two Mola screens side by side (say the cashier on
 * the left, the kitchen on the right), each an iframe of this same page with a sign-in of its own.
 *
 * Cookies are shared by every frame of one origin, so the frame names its pane on every API call (`X-Mola-Pane: 1|2`, plus the
 * window's pane key) and the server reads and writes that pane's own HttpOnly session cookie (mola_staff / mola_staff_p2;
 * server/sessions.ts, server/desktop.ts `paneGuard`). The pane is known from the frame's name (`mola-pane-N`, kept by the
 * browser across the frame's own reloads and links) and only inside a same-origin parent; the key comes from the outer
 * window's rail (GET /api/desktop/pane). Tablets and phones never run in pane mode, and the server refuses the header from them.
 *
 * Every same-origin /api call of a pane carries the pane: fetch and XMLHttpRequest are wrapped once at start (installPane),
 * so screens that call fetch themselves (downloads, uploads) can never fall back to the other pane's sign-in.
 * Pane content never calls the desktop tools (/api/desktop: the server refuses them for a pane); the few things that belong to
 * the outer window (opening a rail dialog, the data-key lock screen, Ctrl+Alt+arrows) are passed up to it.
 */
export type PaneId = 1 | 2;
/** sessionStorage (shared by the window and its frames): the pane key the rail fetched. */
export const PANE_KEY_STORE = 'mola-pane-key';
export const paneFrameName = (p: PaneId) => `mola-pane-${p}`;
/** Messages between a pane and the window (postMessage, same origin only). */
export type PaneMessage = { mola: 'split-key'; key: 'ArrowLeft' | 'ArrowRight'; pane: PaneId } | { mola: 'split-focus'; pane: PaneId };

function detect(): PaneId | null {
  try {
    if (window.parent === window) return null;
    // A parent on another origin throws here: never a pane.
    if (window.parent.location.origin !== location.origin) return null;
    const m = /^mola-pane-([12])$/.exec(window.name) ?? /[?&]pane=([12])(?:&|$)/.exec(location.search);
    return m ? (Number(m[1]) as PaneId) : null;
  } catch { return null; }
}
/** This page's pane, or null (an ordinary window, tablet, phone, guest menu). */
export const pane: PaneId | null = typeof window === 'undefined' ? null : detect();

export function paneHeaders(): Record<string, string> {
  if (!pane) return {};
  let key = '';
  try { key = sessionStorage.getItem(PANE_KEY_STORE) ?? ''; } catch { /* no storage: the server refuses without the key */ }
  return { 'X-Mola-Pane': String(pane), ...(key ? { 'X-Mola-Pane-Key': key } : {}) };
}
function sameOriginApi(url: string) {
  try { const u = new URL(url, location.href); return u.origin === location.origin && u.pathname.startsWith('/api/'); } catch { return false; }
}
function toParent(type: string, detail?: unknown) {
  try { const P = window.parent as Window & typeof globalThis; P.dispatchEvent(new P.CustomEvent(type, { detail })); } catch { /* the window went away */ }
}

let installed = false;
/** Pane mode only: tags every API call, passes the outer window's events and keys up. Does nothing in an ordinary window. */
export function installPane() {
  if (!pane || installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!sameOriginApi(url)) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [k, v] of Object.entries(paneHeaders())) headers.set(k, v);
    return original(input, { ...init, headers });
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    (open as (...a: unknown[]) => void).apply(this, args);
    if (sameOriginApi(String(args[1]))) for (const [k, v] of Object.entries(paneHeaders())) this.setRequestHeader(k, v);
  } as typeof open;
  // Screens that point to the rail (İlk adımlar, Ayarlar → Güvenlik) treat a pane as the café computer's window; the page itself
  // keeps no room for a rail (the window's rail sits outside the pane).
  document.body.classList.add('desktop-shell', 'desktop-pane');
  document.getElementById('root')?.style.setProperty('margin-left', '0');
  // The outer window's: İlk adımlar / Ayarlar open the rail's dialogs, a locked data key shows the unlock screen there.
  for (const type of ['mola:open', 'mola:locked']) window.addEventListener(type, e => toParent(type, (e as CustomEvent).detail));
  const post = (m: PaneMessage) => { try { window.parent.postMessage(m, location.origin); } catch { /* the window went away */ } };
  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); post({ mola: 'split-key', key: e.key, pane: pane! }); }
  }, true);
  for (const type of ['pointerdown', 'focusin']) window.addEventListener(type, () => post({ mola: 'split-focus', pane: pane! }), { capture: true, passive: true });
}

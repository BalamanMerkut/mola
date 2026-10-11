import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import logo from 'virtual:merkut-studios-logo';
import { inMolaApp } from './molaApp';
import { holdFor, SPLASH_SEEN, SPLASH_TIMING, splashWanted, type SplashPlace } from './splashRules';
import './studio-splash.css';

/*
 * Merkut Studios açılışı: black screen → the studio logo fades in (600 ms) → holds (~1.2 s) → fades out to black (600 ms) →
 * Mola's own sign-in or loading screen (it loaded underneath meanwhile). At most 2.5 s; a tap, click or any key skips it.
 * "Reduce motion": the logo shows still for 600 ms. When it shows (only on a Mola.exe launch for now): src/splashRules.ts.
 */
function storage(): Storage | null { try { return window.sessionStorage; } catch { return null; } }
function seen() { try { return storage()?.getItem(SPLASH_SEEN) === '1'; } catch { return false; } }
function remember() { try { storage()?.setItem(SPLASH_SEEN, '1'); } catch { /* private mode: shows again next time, harmless */ } }
function framed() { try { return window.top !== window; } catch { return true; } }

type Phase = 'black' | 'in' | 'hold' | 'out' | 'leave';
function StudioSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>('black');
  const image = useRef<HTMLImageElement>(null), box = useRef<HTMLDialogElement>(null), done = useRef(false);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useLayoutEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [], at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const dialog = box.current;
    // A modal <dialog>: the browser's top layer, above any z-index, and the app beneath is inert (no focus, no typing).
    // Mola's own dialogs are modal too (the window's "Kurtarma kodunuz" can open right at launch): one opened meanwhile would
    // sit above, so the opening moves back to the top at once (before anything is painted).
    const top = () => { if (!dialog || done.current) return; try { if (dialog.open) dialog.close(); dialog.showModal(); } catch { /* not connected */ } };
    top();
    const others = new MutationObserver(records => { if (records.some(r => r.target !== dialog && (r.target as Element).hasAttribute('open'))) top(); });
    others.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    const finish = () => { if (done.current) return; done.current = true; others.disconnect(); timers.forEach(clearTimeout); try { dialog?.close(); } catch { /* gone */ } onDone(); };
    const skip = () => finish();
    // Escape would close the dialog by itself: it skips instead.
    const cancel = (e: Event) => { e.preventDefault(); finish(); };
    dialog?.addEventListener('cancel', cancel);
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(type, skip, { capture: true, passive: true });
    const started = performance.now();
    let begun = false;
    const begin = () => {
      if (begun || done.current) return; begun = true;
      const waited = performance.now() - started;
      if (reduced) { setPhase('hold'); at(SPLASH_TIMING.reduced, finish); return; }
      // Next frame: the browser has painted the logo at opacity 0, so the transition runs.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!done.current) setPhase('in'); }));
      const hold = holdFor(waited);
      at(SPLASH_TIMING.fadeIn, () => setPhase('hold'));
      at(SPLASH_TIMING.fadeIn + hold, () => setPhase('out'));
      at(SPLASH_TIMING.fadeIn + hold + SPLASH_TIMING.fadeOut, () => setPhase('leave'));
      at(SPLASH_TIMING.fadeIn + hold + SPLASH_TIMING.fadeOut + SPLASH_TIMING.leave, finish);
    };
    // Preloaded and decoded first, so the fade is smooth; a logo that does not arrive in 700 ms is left out.
    const img = image.current;
    if (img) {
      const ready = () => void (img.decode ? img.decode().catch(() => undefined) : Promise.resolve()).then(begin);
      if (img.complete && img.naturalWidth) ready(); else { img.addEventListener('load', ready, { once: true }); img.addEventListener('error', finish, { once: true }); }
    }
    at(SPLASH_TIMING.waitImage, () => { if (!begun) finish(); });
    return () => {
      others.disconnect(); timers.forEach(clearTimeout); dialog?.removeEventListener('cancel', cancel);
      for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) window.removeEventListener(type, skip, { capture: true });
    };
  }, [onDone, reduced]);
  return <dialog ref={box} className={`studio-splash phase-${phase}${reduced ? ' reduced' : ''}`} data-phase={phase} aria-label="Merkut Studios">
    <picture>
      <source type="image/avif" srcSet={logo.avif} />
      <source type="image/webp" srcSet={logo.webp} />
      <img ref={image} src={logo.jpg} width={logo.width} height={logo.height} alt="Merkut Studios" decoding="async" fetchPriority="high" draggable={false} />
    </picture>
  </dialog>;
}

/** Shows the opening over the page (its own root, outside the app), if this start wants it. */
export function showStudioSplash(place: SplashPlace) {
  if (typeof document === 'undefined') return false;
  const automated = navigator.webdriver === true;
  if (!splashWanted(place, { path: location.pathname, hash: location.hash, framed: framed(), app: inMolaApp(), automated, seen: seen() })) return false;
  remember();
  const host = document.createElement('div');
  host.className = 'studio-splash-host';
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<StudioSplash onDone={() => { setTimeout(() => { root.unmount(); host.remove(); }, 0); }} />);
  return true;
}

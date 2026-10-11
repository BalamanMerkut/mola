import { useEffect } from 'react';

/**
 * Keeps the screen awake while this page is visible (waiter phones; the kitchen has its own switch in KitchenWakeLock).
 * Uses the Screen Wake Lock API when the browser has it (it needs a secure page: HTTPS or this computer); the lock is
 * dropped by the browser when the page is hidden and taken again when it comes back, or at the next tap if a request
 * failed. Silent: no control, no message. In the Android Mola app the app itself keeps the screen on.
 */
export function useScreenAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.wakeLock || !window.isSecureContext) return;
    let live = true, pending = false, lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (!live || pending || (lock && !lock.released) || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (!live || document.visibilityState !== 'visible') { void next.release().catch(() => {}); return; }
        lock = next;
        next.addEventListener('release', () => { if (lock === next) lock = null; }, { once: true });
      } catch { /* refused (battery saver, hidden page): tried again on the next visibility change or tap */ }
      finally { pending = false; }
    };
    const visibility = () => { if (document.visibilityState === 'visible') void acquire(); };
    const tap = () => { if (!lock) void acquire(); };
    void acquire();
    document.addEventListener('visibilitychange', visibility); document.addEventListener('pointerdown', tap);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerdown', tap);
      if (lock) void lock.release().catch(() => {});
    };
  }, [enabled]);
}

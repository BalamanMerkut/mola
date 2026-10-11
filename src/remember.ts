import { useEffect, useState } from 'react';

/**
 * A tab (or sub-tab) that stays chosen on this device (localStorage), like Ayarlar's topics: every home of the café app
 * comes back where it was. `wanted` (a link that opens one tab) wins when it is allowed here; `wantedKey` changes with each
 * new link, so the same link pressed twice still lands. A remembered value that is no longer allowed (an old place, a role
 * without that tab) falls back quietly.
 */
export function useRememberedTab<T extends string>(key: string, allowed: readonly T[], fallback: T, wanted?: T, wantedKey?: number): [T, (next: T) => void] {
  const ok = (v: unknown): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v);
  const [tab, setTab] = useState<T>(() => {
    if (ok(wanted)) return wanted;
    try { const v = localStorage.getItem(key); if (ok(v)) return v; } catch { /* preference only */ }
    return ok(fallback) ? fallback : allowed[0];
  });
  useEffect(() => { if (ok(wanted)) setTab(wanted); }, [wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = ok(tab) ? tab : ok(fallback) ? fallback : allowed[0];
  useEffect(() => { try { localStorage.setItem(key, current); } catch { /* preference only */ } }, [key, current]);
  return [current, setTab];
}

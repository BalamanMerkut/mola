/*
 * The person at this screen, for the owner's idle lock (server/owner-lock.ts, src/OwnerLock.tsx): the last real tap, click,
 * key or wheel on this page. API calls made within a few seconds of it carry `X-Mola-Activity: 1` (src/api.ts); background
 * polling, which runs without anyone touching the screen, never does.
 */
const ACTIVE_MS = 5000;
let lastInput = Date.now();
export function noteInput() { lastInput = Date.now(); }
/** Someone touched this page in the last few seconds. */
export function userActive() { const ms = Date.now() - lastInput; return ms >= 0 && ms < ACTIVE_MS; }
if (typeof window !== 'undefined') for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(type, noteInput, { capture: true, passive: true });
/** A locked owner session (423 SESSION_LOCKED or the `X-Mola-Locked` answer header): the lock screen opens (src/OwnerLock.tsx). */
export const SESSION_LOCK_EVENT = 'mola:session-lock';

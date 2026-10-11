const KEY = 'mola-desktop';

/** The desktop app passes its key once in the address (#masaustu=…); it is kept for this window only and removed from view. */
export function desktopToken() {
  const m = /^#masaustu=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  try {
    if (m) { sessionStorage.setItem(KEY, m[1]); history.replaceState(null, '', location.pathname + location.search); }
    return sessionStorage.getItem(KEY);
  } catch { return m?.[1] ?? null; }
}
export function forgetDesktopToken() { try { sessionStorage.removeItem(KEY); } catch { /* private mode */ } }
/** A call from the café computer's own window. body undefined = GET. */
export async function desktopCall<T>(token: string, path: string, body?: unknown, wait?: number): Promise<T> {
  const post = body !== undefined;
  let response: Response;
  // The browser's own words ("Failed to fetch", "signal timed out") never reach the owner.
  try { response = await fetch(path, { method: post ? 'POST' : 'GET', headers: { ...(token ? { 'X-Mola-Desktop': token } : {}), ...(post ? { 'Content-Type': 'application/json' } : {}) }, body: post ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(wait ?? (post ? 120000 : 15000)) }); }
  catch (e) { throw Object.assign(new Error((e as Error).name === 'TimeoutError' ? 'İşlem uzun sürdü. Biraz bekleyip yeniden deneyin.' : 'Mola’ya ulaşılamadı. Mola kapandıysa masaüstündeki Mola simgesiyle yeniden açın.'), { status: 0 }); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message ?? 'İşlem tamamlanamadı.'), { status: response.status, code: result.code as string | undefined });
  return result as T;
}
/** The calls of the security cards in the café computer's window (/api/desktop). */
export type SecurityCaller = <T>(path: string, body?: unknown) => Promise<T>;

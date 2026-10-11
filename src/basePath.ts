/*
 * Where this page's server lives. On the café's own address (LAN, the café computer) everything is at the root: '/'. The guest
 * menu opened over the internet runs under Mola Merkez's public prefix (`/q/<kod>/`, server/merkez/guest-tunnel.ts): its
 * /api and /media requests go to `/q/<kod>/api/…` and `/q/<kod>/media/…`, which Mola Merkez passes to the café. Only
 * src/guest-main.tsx sets it; the staff app never changes it.
 */
let base = '/';
/** `/q/AbCdEfGhIj/` (always with the trailing slash); anything else keeps the root. */
export function setBasePath(value: string) { base = /^\/q\/[A-Za-z0-9]{10}\/$/.test(value) ? value : '/'; }
export const basePath = () => base;
/** An /api or /media path under this page's prefix; other values (data: logos, full addresses) stay as they are. */
export function withBase(path: string): string;
export function withBase(path: string | undefined | null): string | undefined;
export function withBase(path: string | undefined | null) {
  if (!path) return path ?? undefined;
  return base !== '/' && /^\/(api|media)\//.test(path) ? base + path.slice(1) : path;
}

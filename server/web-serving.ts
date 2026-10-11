import type { Express, NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * How both servers hand out their screens (café: index.html; Mola Merkez: merkez.html).
 *   pageHeaders   security headers on every page and file (not on /api, which sets its own)
 *   devAllowList  development only (Vite): browser code and page routes; never server code, docs, data or a path with ".."
 */
const PAGE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
  "connect-src 'self' data: blob:", "media-src 'self' data: blob:", "manifest-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'",
];
/**
 * `frames`: 'self' for the café (Ayarlar → "Menü önizlemesi" shows the guest menu in a frame of its own page), 'none' for
 * Mola Yönetim (never inside another page). Development adds what Vite needs (its inline preamble and the reload socket).
 */
export function pageHeaders(app: Express, options: { frames: 'self' | 'none'; development: boolean }) {
  const csp = [...PAGE_CSP.map(p => options.development && p.startsWith('script-src') ? "script-src 'self' 'unsafe-inline'" : options.development && p.startsWith('connect-src') ? "connect-src 'self' data: blob: ws: wss:" : p), `frame-ancestors '${options.frames}'`].join('; ');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next();
    res.set('Content-Security-Policy', csp); res.set('X-Frame-Options', options.frames === 'self' ? 'SAMEORIGIN' : 'DENY');
    res.set('Referrer-Policy', 'no-referrer'); res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
}
/** "..", its encodings ("%2e", "%2E"), backslashes and encoded slashes never reach Vite or the file system. */
export const unsafePath = (url: string) => /\.\.|%2e|\\|%5c|%2f|%00/i.test(url);
/** An extension-less path that Vite would resolve to a file or folder of the project (development only). */
function projectFile(path: string) {
  let base: string; try { base = join(process.cwd(), decodeURIComponent(path)); } catch { return true; }
  return ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json'].some(ext => existsSync(base + ext));
}
export function devAllowList(app: Express, page: string) {
  app.use((req, res, next) => {
    const path = req.path, raw = req.originalUrl.split('?')[0];
    if (unsafePath(raw) || unsafePath(path)) { res.status(404).end(); return; }
    // /@fs/ is how Vite reaches dependency files by absolute path; only dependency folders may go that way.
    if (path.startsWith('/@fs/')) { if (/\/node_modules\//.test(decodeURIComponent(path))) return next(); res.status(404).end(); return; }
    if (/^\/(src|packages|node_modules|@vite|@id|@react-refresh|__vite)(\/|$)/.test(path) || path === `/${page}` || /^\/(favicon(-yonetim)?\.svg|favicon(-yonetim)?-(16|32)\.png|apple-touch-icon\.png|icon(-yonetim)?(-maskable)?-(192|256|512)\.png|manifest(-yonetim)?\.webmanifest)$/.test(path)) return next();
    // A page route (/m/<kod>, /uygulama, …) has no extension. Vite answers any extension-less path that names a project file
    // or folder as a module (/server/app → server/app.ts, /package → package.json): those, and hidden names, never go on.
    if (path === '/' || (!/\.[^/]*$/.test(path) && !/\/\./.test(path) && !projectFile(path))) return next();
    res.status(404).end();
  });
  // Vite's own refusals (outside its allow-list) print the full folder path: replaced by a plain line.
  app.use((_req, res, next) => {
    const write = res.write.bind(res) as (...a: unknown[]) => boolean, end = res.end.bind(res) as (...a: unknown[]) => Response;
    const plain = () => { if (!res.headersSent) { res.removeHeader('Content-Length'); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); } };
    (res as { write: unknown }).write = (...a: unknown[]) => res.statusCode === 403 ? (plain(), true) : write(...a);
    (res as { end: unknown }).end = (...a: unknown[]) => { if (res.statusCode !== 403) return end(...a); plain(); return end('Erişim engellendi.'); };
    next();
  });
}

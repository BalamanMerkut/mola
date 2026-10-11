import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express, Request } from 'express';
import { DomainError } from '../packages/domain/engine.js';

/*
 * Phones and tablets of the café (docs/GELISTIRICI_REHBERI.md, "Telefon ve tablet uygulaması"):
 *   GET /api/uygulama        what the /uygulama page and the Android app's café search need: business name, version, APK
 *   GET /uygulama/Mola.apk   the thin Android app (a WebView shell; the screens still come from this server)
 * Both answer only the café's own network (and this computer): a request through a tunnel or proxy, or from a public
 * address, gets 404 as if they did not exist. The APK is public software, so no sign-in is asked.
 */
const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip'];
/** Private, loopback and link-local addresses: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fc00::/7, fe80::/10, ::1. */
export function privateAddress(address: string) {
  let ip = address.toLowerCase().split('%')[0];
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  if (ip.includes(':')) return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
/** A device on the café network talking to this server directly: a private socket address and no forwarding header. */
export function lanClient(req: Pick<Request, 'headers'> & { socket: { remoteAddress?: string } }) {
  return !FORWARDED.some(h => req.headers[h] !== undefined) && privateAddress(req.socket.remoteAddress ?? '');
}
/**
 * Where the built APK is: MOLA_APK, the packaged app's mobil/Mola.apk (the server runs in app/), or development's build
 * output (.local/android/Mola.apk from `npm run apk`).
 */
export function apkFile() {
  for (const file of [process.env.MOLA_APK, 'mobil/Mola.apk', '.local/android/Mola.apk']) if (file && existsSync(file) && statSync(file).isFile()) return resolve(file);
  return undefined;
}
export type MobileAppInfo = { name: () => string | null; version: string; apk?: () => string | undefined };
export function mobileAppRoutes(app: Express, info: MobileAppInfo) {
  const lanOnly = (req: Request) => { if (!lanClient(req)) throw new DomainError('NOT_FOUND', 'İşlem bulunamadı.', 404); };
  const apk = info.apk ?? apkFile;
  // `app: 'mola'` + `role: 'kafe'` is the signature the Android app's network search looks for (with /api/health).
  app.get('/api/uygulama', (req, res) => {
    lanOnly(req);
    const file = apk();
    res.json({ app: 'mola', role: 'kafe', name: info.name(), version: info.version, apk: file ? { size: statSync(file).size, path: '/uygulama/Mola.apk' } : null });
  });
  app.get('/uygulama/Mola.apk', (req, res) => {
    const file = lanClient(req) ? apk() : undefined;
    if (!file) { res.status(404).type('text/plain').send('Bulunamadı.'); return; }
    res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-cache');
    res.set('Content-Disposition', 'attachment; filename="Mola.apk"');
    res.type('application/vnd.android.package-archive');
    // dotfiles: the development build lives under .local/; the path is this server's own, never the request's.
    res.sendFile(file, { dotfiles: 'allow', cacheControl: false, headers: { 'Content-Type': 'application/vnd.android.package-archive' } }, error => { if (error && !res.headersSent) res.status(404).end(); });
  });
}

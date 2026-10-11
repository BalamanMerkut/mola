/*
 * npm.cmd run site:dev: the web site on this computer, the way Caddy serves it on the VDS (docs/VDS_KURULUM.md "Web sitesi").
 *   http://127.0.0.1:5180          site/dist (built now, rebuilt on every change under site/)
 *   /api/site/*, /s/*, /q/*        passed to a Mola Merkez (default http://127.0.0.1:4000 = npm run merkez:dev), so the
 *                                  contact form lands in that Merkez's Mola Yönetim → Başvurular (/q/: İnternetten menü).
 * Options: --port 5180, --merkez http://127.0.0.1:4000 (or SITE_MERKEZ_URL), --no-watch, --no-build, --host 0.0.0.0 (the home
 * rehearsal, scripts/ev-provasi.ts: friends on the same Wi-Fi), --dist <folder> and --config <file> (another build and config).
 * Like Caddy it gives the Merkez its own Host and Origin for /api/site (the Merkez checks both); unlike Caddy it adds no
 * X-Forwarded-* header, so a Merkez without PUBLIC_ORIGIN still sees "this computer".
 */
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { buildSite, DIST as SITE_DIST, SITE } from './site-build.js';

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(option('--port') ?? process.env.SITE_PORT ?? 5180);
const merkez = new URL(option('--merkez') ?? process.env.SITE_MERKEZ_URL ?? 'http://127.0.0.1:4000');
const host = option('--host') ?? '127.0.0.1', DIST = option('--dist') ? resolve(option('--dist')!) : SITE_DIST, CONFIG = option('--config') ? resolve(option('--config')!) : undefined;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.zip': 'application/zip', '.gz': 'application/gzip' };
/** The same headers as the Caddyfile (docs/VDS_KURULUM.md): no outside sources, no framing, no referrer to other sites. */
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

function proxy(req: IncomingMessage, res: ServerResponse) {
  const headers = { ...req.headers };
  for (const h of ['host', 'origin', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip']) delete headers[h];
  headers.host = merkez.host;
  if (req.headers.origin && (req.url?.startsWith('/api/site/') || req.url?.startsWith('/q/'))) headers.origin = merkez.origin;
  const out = request({ hostname: merkez.hostname, port: merkez.port || 80, path: req.url, method: req.method, headers }, answer => {
    res.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(res);
  });
  out.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ code: 'MERKEZ_UNREACHABLE', message: `Mola Merkez’e ulaşılamadı (${merkez.origin}). npm.cmd run merkez:dev açık mı?` })); });
  req.pipe(out);
}

function serveFile(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://site');
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) && file !== DIST) { res.writeHead(403).end(); return; }
  let target = file;
  if (existsSync(target) && statSync(target).isDirectory()) {
    if (!path.endsWith('/')) { res.writeHead(301, { Location: `${path}/${url.search}` }).end(); return; }
    target = join(target, 'index.html');
  }
  const status = existsSync(target) && statSync(target).isFile() ? 200 : 404;
  if (status === 404) target = join(DIST, '404.html');
  const size = statSync(target).size, type = TYPES[extname(target)] ?? 'application/octet-stream';
  const base = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', ...SECURITY };
  // Byte ranges: Safari plays an MP4 only when the server answers them.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && status === 200) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(target, { start, end }).pipe(res); return;
  }
  res.writeHead(status, { ...base, 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
}

const build = () => buildSite({ dist: DIST, config: CONFIG });
if (!args.includes('--no-build')) await build();
if (!existsSync(join(DIST, 'index.html'))) { console.error('site/dist yok: önce npm.cmd run site:build'); process.exit(1); }
const server = createServer((req, res) => {
  const path = req.url ?? '/';
  if (path.startsWith('/api/site/') || path.startsWith('/s/') || path.startsWith('/q/')) return proxy(req, res);
  if (path.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"code":"NOT_FOUND"}'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  serveFile(req, res);
});
server.listen(port, host, () => console.log(`Web sitesi: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}  (form → ${merkez.origin}/api/site/talep)`));
if (!args.includes('--no-watch')) {
  let timer: NodeJS.Timeout | undefined, building = false;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(async () => { if (building) return rebuild(); building = true; try { await build(); } catch (e) { console.error(e instanceof Error ? e.message : e); } finally { building = false; } }, 250); };
  for (const dir of [join(SITE, 'src'), resolve(SITE, 'config.json')]) watch(dir, { recursive: dir.endsWith('src') }, rebuild);
}
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { server.close(); process.exit(0); });

import type { Express, Request, CookieOptions } from 'express';
import { hostname, networkInterfaces } from 'node:os';
import { DomainError } from '../packages/domain/engine.js';

export type HttpSecurity = { publicOrigin?: string; trustLocalProxy?: boolean };
/**
 * The key used for per-client limits. One IPv6 subscriber usually owns a whole /64, so counting single
 * IPv6 addresses would give an attacker billions of fresh "clients"; IPv4-mapped forms count as IPv4.
 */
export function clientKey(req: Request) {
  // İnternetten menü: a guest request that came through Mola Merkez's tunnel counts by the guest's own address, which Merkez
  // sent signed (server/guest-tunnel.ts sets it only after that check), not by the tunnel's loopback replay.
  const tunnelled = (req as Request & { molaClient?: string }).molaClient;
  if (tunnelled) return tunnelled;
  let ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (ip.toLowerCase().startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('%')[0].split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${full.slice(0, 4).map(part => part.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const LOOPBACK_SOCKETS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const FORWARDED = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip'];
/** The host name of a Host header, lower case, without port or trailing dot ("[::1]:3000" → "[::1]"). */
export function hostName(header?: string) {
  const value = (header ?? '').trim().toLowerCase();
  const name = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.split(':')[0];
  return name.replace(/\.$/, '');
}
/** Same computer, no proxy: the socket is loopback, no forwarding header, and the Host is a loopback name (no rebinding). */
export function loopbackRequest(req: Request) {
  return LOOPBACK_SOCKETS.includes(req.socket.remoteAddress ?? '') && !FORWARDED.some(h => req.headers[h] !== undefined) && LOOPBACK_HOSTS.includes(hostName(req.headers.host));
}
/** True only for a browser on this same computer talking to the server directly, with no proxy in between. */
export function directLoopback(req: Request, config: HttpSecurity) {
  if (config.publicOrigin || config.trustLocalProxy) return false;
  return loopbackRequest(req);
}
export function canonicalOrigin(value?: string) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN yalnız HTTPS kök adresi olmalı.');
  return url.origin;
}
let machine = { at: -Infinity, hosts: new Set<string>() };
/**
 * Names this computer answers to: loopback, its LAN addresses (re-read every 30 s: DHCP may change them), its computer name
 * (and name.local), plus MOLA_ALLOWED_HOSTS (comma separated, e.g. a router's DNS name for the café).
 */
export function machineHosts(now = Date.now(), refresh = false) {
  if (!refresh && now - machine.at < 30_000) return machine.hosts;
  const hosts = new Set(LOOPBACK_HOSTS);
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) hosts.add(i.family === 'IPv6' ? `[${i.address.split('%')[0].toLowerCase()}]` : i.address);
  try { const name = hostname().toLowerCase(); if (name) { hosts.add(name); hosts.add(`${name}.local`); } } catch { /* no name */ }
  for (const extra of (process.env.MOLA_ALLOWED_HOSTS ?? '').split(',')) if (extra.trim()) hosts.add(hostName(extra));
  machine = { at: now, hosts };
  return hosts;
}
/**
 * DNS rebinding guard: a page on evil.example whose name briefly points at this computer sends Host "evil.example"; only
 * names that really belong to this server (or PUBLIC_ORIGIN's host) are answered.
 */
export function hostAllowed(header: string | undefined, publicOrigin?: string) {
  const name = hostName(header);
  if (!name) return false;
  if (publicOrigin && name === new URL(publicOrigin).hostname.toLowerCase()) return true;
  return machineHosts().has(name);
}
export function sessionCookie(req: Request, path = '/'): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure: req.secure, path };
}
// Café installs call these from their own server process: no browser, no cookie; /sync is HMAC-signed, the rest is anonymous
// by design. A browser's Origin would mean nothing to them, so it is not required (HTTPS still is).
const SERVER_TO_SERVER = /^\/merkez\/v1\//;
/** `alsoHosts`: further names answered (Mola Merkez: the guest menu's own name, MERKEZ_MENU_ORIGIN, for /q/* only: merkez/menu-host.ts). */
export function configureHttpSecurity(app: Express, config: HttpSecurity, alsoHosts: string[] = []) {
  const origin = canonicalOrigin(config.publicOrigin);
  if (config.trustLocalProxy && !origin) throw new Error('Yerel proxy güveni için PUBLIC_ORIGIN gerekli.');
  // Only an explicitly enabled same-machine TLS proxy may supply forwarded protocol.
  app.set('trust proxy', config.trustLocalProxy ? 'loopback' : false);
  app.use((req, res, next) => {
    if (hostAllowed(req.headers.host, origin) || (alsoHosts.length && alsoHosts.includes(hostName(req.headers.host)))) return next();
    res.status(403);
    if (req.path.startsWith('/api/')) res.json({ code: 'HOST_REJECTED', message: 'Bu adres bu sunucuya ait değil.' }); else res.type('text/plain').send('Bu adres bu sunucuya ait değil.');
  });
  app.use('/api', (req, _res, next) => {
    if (origin && !req.secure) return next(new DomainError('HTTPS_REQUIRED', 'Güvenli bağlantı gerekli.', 403));
    const supplied = req.get('Origin');
    const expected = origin ?? `${req.protocol}://${req.get('host')}`;
    if (supplied && supplied !== expected) return next(new DomainError('ORIGIN_REJECTED', 'İstek kaynağı geçersiz.', 403));
    if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !supplied && !SERVER_TO_SERVER.test(req.path)) return next(new DomainError('ORIGIN_REQUIRED', 'İstek kaynağı gerekli.', 403));
    next();
  });
}

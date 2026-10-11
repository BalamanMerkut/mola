import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { newInstallSecret } from '../server/install-auth.js';
import { MerkezLink } from '../server/kafe-link.js';
import { licenseClaims, newSigningPair, privateKeyFrom, publicKeyFrom, signLicense, type License } from '../server/license.js';
import { createMerkezApp, type MerkezOptions } from '../server/merkez/app.js';
import { MerkezStore } from '../server/merkez/store.js';
import { tunnelUpgrades, type GuestTunnelHub } from '../server/merkez/guest-tunnel.js';
import { Store } from '../server/store.js';
import type { FailureEvent } from '../server/request-diagnostics.js';
import { totp } from '../server/totp.js';
import { AGREEMENT_VERSION } from '../packages/domain/agreement.js';
import { featureIds } from '../packages/domain/feature-gate.js';

/*
 * Test helpers for the Kafe/Merkez split.
 *   licensed(store)  every business in a café folder gets a valid signed licence, as if registered at Merkez, for tests
 *                    about café behaviour that need an active licence (guest menu, orders) but no running Merkez.
 *   merkezPair()     a real Mola Merkez and a Kafe server on free ports with their own folders, talking over HTTP.
 */
const pair = newSigningPair();
const testPrivate = privateKeyFrom(pair.privateKey);
export const TEST_PUBLIC_KEY = pair.publicKey;
// createApp's own link (no explicit one passed) resolves the key from here, so these licences verify.
process.env.MOLA_MERKEZ_PUBLIC_KEY = pair.publicKey;
// Mola Yönetim passwords: a cheap scrypt in tests (production 2^17; tests/merkez-admin.test.ts checks the real one).
process.env.MOLA_TEST_ADMIN_SCRYPT_N = '1024';
const YEAR = 365 * 86400000;
/** Signs with the test key: a licence like Merkez would issue. */
export function testLicense(installId: string, license: License, serial = 1, at = new Date()) { return signLicense(licenseClaims(license, installId, serial, at), testPrivate); }
/** greement: Mola Lisans Sözleşmesi recorded as accepted too (a café folder a browser test opens with the owner). */
export function licensed(store: Store, overrides: Partial<License> = {}, agreement = false) {
  const link = new MerkezLink(store, { publicKey: publicKeyFrom(pair.publicKey) }), installId = randomUUID();
  const tenants = (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
  // Every service by default, listed (a licence without `features` opens the core only from 12 Ekim: server/kafe-link.ts O6).
  const licenses = tenants.map(tenant => testLicense(installId, { tenantId: tenant, name: store.directoryEntry(tenant).name, endsAt: new Date(Date.now() + 10 * YEAR).toISOString(), suspended: false, kind: 'subscription', planMonths: 12, service: 'full', features: [...featureIds], ...overrides }));
  // No Merkez time yet: licence time follows the test's own clock.
  link.adopt({ installId, secret: newInstallSecret(), licenses, serverTime: new Date(0).toISOString() }, [], agreement ? { version: AGREEMENT_VERSION, acceptedAt: new Date().toISOString(), name: 'Deneme verisi' } : undefined);
  return installId;
}
export function temp(name: string) { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/${name}-`)); }
async function listen(server: Server) { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
/** A cookie jar client; a guest session from /guest/session is sent back as X-Guest-Session. */
export function client(base: string) {
  const jar = new Map<string, string>(); let session = '';
  return async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(session ? { 'X-Guest-Session': session } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [k, v] = c.split(';')[0].split('='); jar.set(k, v); }
    const data = await r.json().catch(() => ({})) as any;
    if (data?.session) session = data.session;
    return { status: r.status, data, headers: r.headers };
  };
}
export const MERKEZ_PASSWORD = 'MerkezTest!2026';
/** The test Authenticator's secret (base32) for adminStepUp. */
const STEP_UP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
/** merkezPair({ desktop: true }): the café computer's own window sends this key (X-Mola-Desktop). */
export const DESKTOP_KEY = 'test-masaustu-anahtari-0123456789';
/**
 * A Mola Merkez and a café server, each with its own folder and port. `demo`: the café folder starts with the demo
 * businesses (not yet linked); otherwise it is a clean install. Both read the same clock.
 */
export async function merkezPair(name: string, options: { now?: () => Date; demo?: boolean; logFailure?: (event: FailureEvent) => void; fetch?: typeof fetch; machineKey?: string; desktop?: boolean; merkez?: Omit<MerkezOptions, 'now'> } = {}) {
  const dir = temp(name), now = options.now ?? (() => new Date());
  const merkezStore = new MerkezStore(join(dir, 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  // merkezApp / kafeApp: tests reach app.locals (the köprü's hub and the café's relay, support desk and remote reports).
  const merkezApp = createMerkezApp(merkezStore, { now, ...options.merkez }), merkezServer = createServer(merkezApp);
  // İnternetten menü: the cafés' guest tunnels arrive as WebSocket upgrades, as in server/merkez/runtime.ts.
  tunnelUpgrades(merkezServer, () => merkezApp.locals.guestTunnel as GuestTunnelHub);
  const merkezBase = await listen(merkezServer);
  const store = new Store(join(dir, 'kafe'), options.demo ? undefined : []);
  const link = new MerkezLink(store, { now, url: merkezBase, publicKey: publicKeyFrom(merkezStore.publicKey), machineId: 'a'.repeat(64), machineKey: options.machineKey ?? 'test:kasa-pc', fetch: options.fetch });
  const kafeApp = createApp(store, now, undefined, undefined, undefined, options.logFailure ?? (() => {}), undefined, undefined, options.desktop ? { token: DESKTOP_KEY, shutdown: () => {} } : undefined, undefined, link), kafeServer = createServer(kafeApp);
  const kafeBase = await listen(kafeServer);
  const admin = client(`${merkezBase}/api/merkez/admin`);
  return {
    dir, merkezStore, merkezBase, store, link, kafeBase, admin, merkezApp, kafeApp,
    kafe: () => client(`${kafeBase}/api`),
    async adminLogin() { const r = await admin('/login', { username: 'admin', password: MERKEZ_PASSWORD }); if (r.status !== 200) throw new Error('Merkez girişi olmadı'); },
    /**
     * The Authenticator step-up (server/merkez/step-up.ts) for the test's admin session: two-step login switched on in the
     * record (when it is not), then the next unused code opens the 10-minute window. Prices, packages and payments need it.
     */
    async adminStepUp() {
      if (!merkezStore.read().admin.mfa) merkezStore.mutate(d => { d.admin.mfa = { secret: STEP_UP_SECRET, lastStep: -1, recoveryHashes: [] }; });
      const secret = merkezStore.read().admin.mfa!.secret;
      for (;;) {
        const current = Math.floor(Date.now() / 30000), step = Math.max(current, merkezStore.read().admin.mfa!.lastStep + 1);
        if (step > current + 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
        const r = await admin('/releases/yetki', { code: totp(secret, step * 30000) });
        if (r.status !== 200) throw new Error(`Doğrulayıcı onayı açılmadı: ${JSON.stringify(r.data)}`);
        return;
      }
    },
    /** Registers the demo businesses at Merkez like scripts/merkez-import.ts does. */
    async importDemo() {
      const tenants = (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
      // Its own admin session, so the test's admin client stays signed out until the test signs it in.
      const importer = client(`${merkezBase}/api/merkez/admin`); await importer('/login', { username: 'admin', password: MERKEZ_PASSWORD });
      const r = await importer('/import', { requestId: randomUUID().replace(/-/g, ''), businesses: tenants.map(t => ({ tenantId: t, name: store.directoryEntry(t).name, sector: store.directoryEntry(t).sector, license: { endsAt: new Date(now().getTime() + YEAR).toISOString(), suspended: false, kind: 'subscription', planMonths: 12 } })) });
      if (r.status !== 200) throw new Error(`İçe aktarma olmadı: ${JSON.stringify(r.data)}`);
      link.adopt(r.data);
      return r.data as { installId: string };
    },
    async close() {
      link.stop();
      // Upgraded tunnel sockets are not the HTTP server's any more: they are closed first.
      (merkezApp.locals.guestTunnel as { close(): void } | undefined)?.close();
      for (const s of [kafeServer, merkezServer]) { s.closeAllConnections(); await new Promise<void>(r => s.close(() => r())); }
      (merkezApp.locals.relayHub as { close(): void } | undefined)?.close();
      store.close(); merkezStore.close();
    },
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PASSWORD } from '../server/app.js';
import { NetworkProfile, type ProfileReader } from '../server/network-profile.js';
import { DESKTOP_KEY, merkezPair } from './merkez-fixture.js';

/*
 * Windows' network profile (server/network-profile.ts): on a "Genel" (Public) connection the old firewall rule (private networks
 * only, 0.1.12 and before) keeps phones and tablets out; the current rule (every profile, local network only) does not, so the
 * warning shows only while the rule is the old one. Mola only reads the profile (Get-NetConnectionProfile through the worker of
 * server/programs.ts); here PowerShell and the firewall helper are fakes.
 */
const fake = (out: string, code = 0) => { const calls = { n: 0 }; const read: ProfileReader = async () => { calls.n++; return { code, out }; }; return { read, calls }; };

test('network profile: "Genel" on a connection phones use is reported; other connections, other systems and failures are not', async () => {
  // Windows' answer: one line per connection; only those with the café network addresses (lanOrigins) count.
  const windows = fake('Public|Ethernet\r\nPrivate|Wi-Fi\r\nPublic|vEthernet (WSL)\r\nDomainAuthenticated|Şirket Ağı\r\n');
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: windows.read, lan: () => ['Ethernet', 'Wi-Fi'] }).view(), { checked: true, public: ['Ethernet'] });
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: windows.read, lan: () => ['Wi-Fi'] }).view(), { checked: true, public: [] });
  // Turkish connection names come through as written (PowerShell writes UTF-8).
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: fake('Public|Kablosuz Ağ Bağlantısı\n').read, lan: () => ['Kablosuz Ağ Bağlantısı'] }).view(), { checked: true, public: ['Kablosuz Ağ Bağlantısı'] });
  // Mola open only to this computer (no LAN address): nothing to warn about.
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: windows.read, lan: () => [] }).view(), { checked: true, public: [] });
  // Not Windows: PowerShell is never asked.
  const mac = fake('Public|en0');
  assert.deepEqual(await new NetworkProfile({ platform: 'darwin', read: mac.read, lan: () => ['en0'] }).view(), { checked: false, public: [] });
  assert.equal(mac.calls.n, 0);
  // PowerShell failing, refusing or missing: no warning (never a false alarm), never an error.
  for (const read of [fake('', 1).read, (async () => { throw new Error('ENOENT'); }) as ProfileReader, fake('beklenmeyen çıktı').read]) {
    const view = await new NetworkProfile({ platform: 'win32', read, lan: () => ['Ethernet'] }).view();
    assert.equal(view.public.length, 0);
  }
});

test('network profile: one PowerShell for many screens; asked again after 15 s, so a profile changed in Windows shows', async () => {
  let clock = 1_000_000, out = 'Public|Ethernet';
  const calls = { n: 0 }, read: ProfileReader = async () => { calls.n++; await new Promise(r => setTimeout(r, 20)); return { code: 0, out }; };
  const profile = new NetworkProfile({ platform: 'win32', read, lan: () => ['Ethernet'], now: () => clock });
  const [a, b, c] = await Promise.all([profile.view(), profile.view(), profile.view()]);
  assert.equal(calls.n, 1, 'screens opened together share one PowerShell');
  for (const v of [a, b, c]) assert.deepEqual(v.public, ['Ethernet']);
  clock += 14_000; await profile.view(); assert.equal(calls.n, 1, 'cached');
  // The owner sets "Özel ağ" in Windows and opens the window again.
  out = 'Private|Ethernet'; clock += 2_000;
  assert.deepEqual(await profile.view(), { checked: true, public: [] }); assert.equal(calls.n, 2);
});

test('network profile: no warning once the firewall rule covers every profile; the rule is asked only for a "Genel" connection', async () => {
  let asked = 0, rule = true;
  const covered = async () => { asked++; return rule; };
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: fake('Public|Ethernet').read, lan: () => ['Ethernet'], covered }).view(), { checked: true, public: [] });
  assert.equal(asked, 1);
  // Every connection "Özel": nothing to ask.
  await new NetworkProfile({ platform: 'win32', read: fake('Private|Ethernet').read, lan: () => ['Ethernet'], covered }).view();
  assert.equal(asked, 1);
  // The old private-only rule (or none), or the helper failing: the warning stays, "İzni düzelt" fixes it.
  rule = false;
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: fake('Public|Ethernet').read, lan: () => ['Ethernet'], covered }).view(), { checked: true, public: ['Ethernet'] });
  const failing = async () => { throw new Error('helper'); };
  assert.deepEqual(await new NetworkProfile({ platform: 'win32', read: fake('Public|Ethernet').read, lan: () => ['Ethernet'], covered: failing }).view(), { checked: true, public: ['Ethernet'] });
});

test('network profile routes: the Kafe içi cihazlar window (desktop key) and Ayarlar → Cihazlar (owner); read only', async t => {
  const pair = await merkezPair('net-profile', { demo: true, desktop: true }); t.after(() => pair.close());
  await pair.importDemo();
  const profile = pair.kafeApp.locals.networkProfile as NetworkProfile, windows = fake('Public|Ethernet\nPrivate|Wi-Fi\n');
  Object.assign(profile.options, { platform: 'win32', read: windows.read, lan: () => ['Ethernet'] });
  const owner = pair.kafe();
  // The desktop route answers the café computer's own window only (as every /api/desktop route).
  assert.equal((await owner('/desktop/network-profile')).status, 404);
  const desktop = await owner('/desktop/network-profile', undefined, { 'X-Mola-Desktop': DESKTOP_KEY });
  assert.equal(desktop.status, 200); assert.deepEqual(desktop.data, { checked: true, public: ['Ethernet'] });
  // The staff route: signed-in owner (or Müdür) only.
  assert.equal((await owner('/staff/network-profile')).status, 401);
  assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.deepEqual((await owner('/staff/network-profile')).data, { checked: true, public: ['Ethernet'] });
  assert.equal(windows.calls.n, 1, 'both screens used the same answer');
  // Only GET: nothing here changes Windows.
  assert.equal((await owner('/staff/network-profile', {})).status, 404);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEMO_PASSWORD } from '../server/app.js';
import { MerkezLink } from '../server/kafe-link.js';
import { privateLanOrigin, syncRequest } from '../server/sync-protocol.js';
import { Store } from '../server/store.js';
import { DESKTOP_KEY, merkezPair, temp } from './merkez-fixture.js';

/*
 * Kalıcı bağlantı (server/merkez/lan-link.ts): the café sends its network addresses with the heartbeat, Merkez gives each
 * business one /k/<code> and sends a visitor from the café's own public address to the café computer, anyone else to
 * Raporlarım (with the service) or a plain page; /k/<code>/kur adds the link to a device (0.1.21).
 */
const page = async (url: string) => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), text: await r.text(), cache: r.headers.get('cache-control'), robots: r.headers.get('x-robots-tag') }; };
const ORIGIN = 'http://192.168.1.104:3000';

test('Kalıcı bağlantı: code given once and kept; same network → 302 to the café; elsewhere → 302 to Raporlarım with the service, else a plain page; ?kafe=1; the shortcut page; unknown → 404', async t => {
  const pair = await merkezPair('lan-link', { demo: true, desktop: true }); t.after(() => pair.close());
  await pair.importDemo();
  let addresses = [ORIGIN, 'http://8.8.8.8:3000'];
  pair.link.reporter = { ...pair.link.reporter, lan: () => addresses };
  // First heartbeat learns 'lan.link', the next one carries the addresses (the public one never leaves the café).
  assert.equal((await pair.link.sync()).ok, true);
  assert.deepEqual(pair.link.payload(pair.link.read()!).lan, { origins: [ORIGIN] });
  assert.equal((await pair.link.sync()).ok, true);
  const biz = () => pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!;
  const install = () => pair.merkezStore.read().installs.find(i => i.id === biz().installId)!;
  const code = biz().lanCode!;
  assert.match(code, /^[A-Za-z0-9]{10}$/);
  assert.deepEqual(install().lan?.origins, [ORIGIN]); assert.equal(install().lan?.client, '127.0.0.1');
  // The café keeps it and shows it: the desktop window's Kafe içi cihazlar and the owner's Ayarlar (not a waiter).
  const url = `${pair.merkezBase}/k/${code}`;
  assert.deepEqual(pair.link.lanAddress('mola-demo'), { url });
  const status = await (await fetch(`${pair.kafeBase}/api/desktop/status`, { headers: { 'X-Mola-Desktop': DESKTOP_KEY } })).json();
  assert.deepEqual(status.link, { url });
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  assert.deepEqual((await owner('/staff/network')).data.link, { url });
  const waiter = pair.kafe(); assert.equal((await waiter('/login', { username: 'garson', password: DEMO_PASSWORD })).status, 200);
  assert.equal('link' in (await waiter('/staff/network')).data, false);
  // Stable: another heartbeat (and a new address from the modem) keeps the code; the redirect follows the address.
  addresses = ['http://192.168.1.120:3000'];
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(biz().lanCode, code); assert.deepEqual(pair.link.lanAddress('mola-demo'), { url });
  // Same public address as the café's heartbeat: straight on to the café computer, never cached, not indexed.
  let p = await page(url);
  assert.equal(p.status, 302); assert.equal(p.location, 'http://192.168.1.120:3000/'); assert.match(p.cache ?? '', /no-store/); assert.equal(p.robots, 'noindex');
  // The trailing slash (the installed icon's start address) is the same link.
  assert.equal((await page(`${url}/`)).location, 'http://192.168.1.120:3000/');
  // Another network, with Raporlarım in the licence: straight on to Raporlarım (no page in between), with the code for
  // "Kafedeyim, kasayı aç".
  const services = (features: string[]) => pair.merkezStore.mutate(d => { d.businesses.find(b => b.tenantId === 'mola-demo')!.services = { packageId: null, features: features as never, updatedAt: new Date().toISOString() }; });
  services(['remote-reports']);
  pair.merkezStore.mutate(d => { d.installs.find(i => i.id === biz().installId)!.lan!.client = '203.0.113.7'; });
  p = await page(url);
  assert.equal(p.status, 302); assert.equal(p.location, `/yonet#k=${code}`); assert.match(p.cache ?? '', /no-store/);
  // "Kafedeyim, kasayı aç" (?kafe=1): the café computer's address, whatever the visitor's public address.
  assert.equal((await page(`${url}?kafe=1`)).location, 'http://192.168.1.120:3000/');
  // Without the service: a small page that says so, how to reach the Mola team, and the café's own address; nothing leads to "/".
  services(['qr-menu']);
  pair.merkezStore.mutate(d => { d.contact = { phone: '0532 111 22 33', whatsapp: '', email: 'destek@example.com', hours: '', web: 'https://mola.example.com/iletisim/', updatedAt: new Date().toISOString() }; });
  p = await page(url);
  assert.equal(p.status, 200); assert.equal(p.location, null);
  assert.match(p.text, /Uzaktan erişim paketinizde yok\. Kafedeyken bu bağlantı kasayı açar\. Paket için Mola ekibine ulaşın\./); assert.match(p.text, /lang="en"/);
  assert.match(p.text, new RegExp(`href="/k/${code}\\?kafe=1">Kafedeyim, kasayı aç`));
  assert.match(p.text, /href="https:\/\/mola\.example\.com\/iletisim\/">Mola ekibine ulaşın/);
  assert.match(p.text, /href="tel:05321112233">0532 111 22 33/); assert.match(p.text, /href="mailto:destek@example\.com"/);
  assert.equal(/href="\/"|Yönetim|\/raporlarim|\/yonet/.test(p.text), false, 'nothing leads to Mola Yönetim or Kafemi yönet');
  assert.ok(p.text.includes(biz().name.replace(/'/g, '&#39;')), 'the business name is the title');
  // Stale (no heartbeat for 30 minutes), back on the café's address: not sent to the café computer; Raporlarım with the service.
  pair.merkezStore.mutate(d => { const lan = d.installs.find(i => i.id === biz().installId)!.lan!; lan.client = '127.0.0.1'; lan.at = new Date(Date.now() - 31 * 60_000).toISOString(); });
  p = await page(url);
  assert.equal(p.status, 200); assert.match(p.text, /paketinizde yok/);
  services(['remote-reports']);
  assert.equal((await page(url)).location, `/yonet#k=${code}`);
  assert.equal((await page(`${url}?kafe=1`)).location, 'http://192.168.1.120:3000/');
  // "Mola'yı bu cihaza ekle": the page (its one script allowed by hash), the web app manifest (start address inside the scope,
  // the café's Mola icons) and a service worker that keeps nothing and answers nothing.
  const kur = await fetch(`${url}/kur`), kurText = await kur.text(), csp = kur.headers.get('content-security-policy') ?? '';
  assert.equal(kur.status, 200); assert.match(kurText, /Mola'yı bu cihaza ekle/); assert.match(kurText, /Ana Ekrana Ekle/); assert.match(kurText, /Web Uygulaması olarak aç/);
  assert.match(kurText, new RegExp(`data-base="/k/${code}"`)); assert.equal(/href="\/"/.test(kurText), false);
  assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/); assert.match(csp, /manifest-src 'self'/); assert.match(csp, /worker-src 'self'/); assert.doesNotMatch(csp, /unsafe-inline'[^;]*script|script-src[^;]*unsafe/);
  const script = /<script>([\s\S]*)<\/script>/.exec(kurText)![1];
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`), 'the CSP hash is the page script');
  const m = await fetch(`${url}/manifest.webmanifest`), manifest = await m.json() as { id: string; start_url: string; scope: string; name: string; short_name: string; display: string; icons: { src: string }[] };
  assert.match(m.headers.get('content-type') ?? '', /application\/manifest\+json/);
  assert.equal(manifest.scope, `/k/${code}/`); assert.equal(manifest.start_url, `/k/${code}/`); assert.equal(manifest.id, `/k/${code}/`);
  assert.ok(new URL(manifest.start_url, url).pathname.startsWith(new URL(manifest.scope, url).pathname), 'start_url within scope');
  assert.equal(manifest.short_name, 'Mola'); assert.equal(manifest.name, `Mola · ${biz().name}`); assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map(i => i.src), ['/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png']);
  const sw = await fetch(`${url}/sw.js`), swText = await sw.text();
  assert.match(sw.headers.get('content-type') ?? '', /javascript/); assert.match(swText, /addEventListener\('fetch'/);
  for (const word of ['respondWith', 'caches', 'cache.put', 'fetch(']) assert.equal(swText.includes(word), false, `sw.js: ${word}`);
  for (const path of ['kur', 'manifest.webmanifest', 'sw.js']) assert.equal((await fetch(`${pair.merkezBase}/k/AAAAAAAAAA/${path}`)).status, 404, path);
  // Unknown or malformed code: the 404 page.
  assert.equal((await page(`${pair.merkezBase}/k/AAAAAAAAAA`)).status, 404);
  assert.match((await page(`${pair.merkezBase}/k/AAAAAAAAAA`)).text, /Bu bağlantı bulunamadı/);
  assert.equal((await page(`${pair.merkezBase}/k/${code.slice(0, 9)}`)).status, 404);
  // Mola closed to the network: nothing sent, Merkez forgets the addresses (the code stays), the café says 'off'.
  addresses = [];
  assert.equal('lan' in pair.link.payload(pair.link.read()!), false);
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(install().lan, undefined); assert.equal(biz().lanCode, code);
  assert.deepEqual(pair.link.lanAddress('mola-demo'), { problem: 'off' });
  assert.equal((await page(`${url}?kafe=1`)).location, `/yonet#k=${code}`, 'no address known: ?kafe=1 goes on as usual');
  services(['qr-menu']);
  p = await page(url);
  assert.match(p.text, /paketinizde yok/); assert.equal(p.text.includes('Kafedeyim'), false);
  // An older Merkez (no 'lan.link' in accepts) gets no `lan` field.
  addresses = [ORIGIN];
  assert.equal('lan' in pair.link.payload({ ...pair.link.read()!, accepts: ['backup.second', 'social'] }), false);
  // Limited per address like /s/.
  let limited = 0; for (let i = 0; i < 70; i++) if ((await page(`${pair.merkezBase}/k/BBBBBBBBBB`)).status === 429) limited++;
  assert.ok(limited > 0);
});

test('Kalıcı bağlantı addresses: only http://<private IPv4>:<port>; the strict heartbeat refuses anything else', () => {
  for (const ok of ['http://192.168.1.104:3000', 'http://10.0.0.5:80', 'http://172.16.0.1:3000', 'http://172.31.255.254:65535']) assert.equal(privateLanOrigin(ok), true, ok);
  for (const no of ['http://8.8.8.8:3000', 'http://172.32.0.1:3000', 'http://100.64.0.1:3000', 'https://192.168.1.4:3000', 'http://192.168.1.4', 'http://192.168.1.4:3000/', 'http://192.168.1.256:3000',
    'http://192.168.01.4:3000', 'http://192.168.1.4:70000', 'http://192.168.1.4:0', 'http://kasa.local:3000', 'http://[fe80::1]:3000', 'http://user@192.168.1.4:3000', ' http://192.168.1.4:3000']) assert.equal(privateLanOrigin(no), false, no);
  const base = { v: 1, appVersion: '0.1.18', sentAt: new Date().toISOString(), businesses: [], backup: { enabled: false, lastSuccessAt: null, failing: false }, failures: [], tickets: [], freezes: [] };
  assert.equal(syncRequest.safeParse({ ...base, lan: { origins: ['http://192.168.1.104:3000'] } }).success, true);
  assert.equal(syncRequest.safeParse({ ...base, lan: { origins: ['http://8.8.8.8:3000'] } }).success, false, 'a public address');
  assert.equal(syncRequest.safeParse({ ...base, lan: { origins: ['http://192.168.1.104:3000/x'] } }).success, false, 'a path');
  assert.equal(syncRequest.safeParse({ ...base, lan: { origins: [] } }).success, false, 'empty');
  assert.equal(syncRequest.safeParse({ ...base, lan: { origins: Array(5).fill('http://192.168.1.104:3000') } }).success, false, 'more than 4');
  assert.equal(syncRequest.safeParse({ ...base, lan: { origins: ['http://192.168.1.104:3000'], name: 'kasa' } }).success, false, 'strict');
  // Not activated: no link.
  assert.deepEqual(new MerkezLink(new Store(temp('lan-inactive'), [])).lanAddress('mola-demo'), { problem: 'inactive' });
});

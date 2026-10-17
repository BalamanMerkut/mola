import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import { e2eRun, ensureSetup, MERKEZ, openView, ownerEmailOn, phoneCodeOn, raporlarimLogin, remoteLoginOpen } from './helpers';

/*
 * İşletmemi yönet, product photos through the tunnel (src/remoteTransport.ts; 17 Ekim, the owner's case: "Menüden kampanya
 * ürünü seç" stuttered with a menu of photos). 45 photo products, 41 different photos (the template's own: real sizes).
 * On a processor slowed 4× (a mid phone), Menü yönetimi → Kampanyalar → the picker, scrolled to the end, category chips back
 * and forth, the search, closed and opened again. Every photo comes through the tunnel once (the 320 px thumbnail: rows and
 * cards are small), only the ones near the screen at a time, never as a /media request to Mola Merkez itself; a screen's own
 * call is not stuck behind the photos; the main thread decodes the thumbnails once and nothing else.
 * Before (0.1.30), opening Menü yönetimi: 82 photo requests at once (each thumbnail, then its 800 px file), a screen call
 * behind up to 81 of them (1.4–2 s), 21 /media requests to Mola Merkez, ~2.8 MB to decode, one long task of 1.1–1.6 s;
 * after: 13 requests (4 at a time), a call behind at most 4 (0.2–0.3 s), none to Merkez, ~420 KB for all 41 photos.
 */
const PASSWORD = 'MolaDemo!2026';
type Perf = { media: { p: string; at: number }[]; long: { at: number; d: number }[]; flying: number; mostFlying: number; mediaBytes: number; apiBehind: { at: number; n: number }[] };
const ROWS = '.menu-row .product-photo img', CARDS = 'dialog[open] .product-card .product-photo img';

/** Every photo of `selector` on the screen right now (inside its dialog's window) has loaded (through the tunnel: from a blob:). */
const visibleLoaded = (page: Page, selector: string, remote: boolean) => page.evaluate(([selector, remote]) => {
  const shown = [...document.querySelectorAll<HTMLImageElement>(selector)].filter(i => {
    const r = i.getBoundingClientRect(), box = i.closest('dialog')?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
    return r.height > 0 && r.bottom > Math.max(0, box.top) && r.top < Math.min(innerHeight, box.bottom);
  });
  return shown.length > 0 && shown.every(i => i.complete && i.naturalWidth > 1 && (!remote || i.currentSrc.startsWith('blob:')));
}, [selector, remote] as const);
const perf = (page: Page) => page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);
const longSince = (p: Perf, from: number) => p.long.filter(l => l.at >= from);
const sum = (list: { d: number }[]) => Math.round(list.reduce((n, l) => n + l.d, 0));
const now = (page: Page) => page.evaluate(() => performance.now());
/** Since `from`: how long, how many photos through the tunnel (since `mark`), the long tasks, the most photos a call waited behind. */
async function phase(page: Page, from: number, mark: number) {
  const q = await perf(page), long = longSince(q, from);
  return { ms: Math.round((await now(page)) - from), media: q.media.length - mark, long: long.length, longMs: sum(long), longestMs: Math.round(Math.max(0, ...long.map(l => l.d))), apiBehind: Math.max(0, ...q.apiBehind.filter(a => a.at >= from).map(a => a.n)) };
}
/** What the tunnel carries, read where it is sealed (the page sends only ciphertext), and the long tasks. */
function instrument(page: Page) {
  return page.addInitScript(() => {
    const w = window as unknown as { __perf: Perf }; w.__perf = { media: [], long: [], flying: 0, mostFlying: 0, mediaBytes: 0, apiBehind: [] };
    const encrypt = SubtleCrypto.prototype.encrypt, td = new TextDecoder(), mediaSeq = new Set<string>();
    SubtleCrypto.prototype.encrypt = function (this: SubtleCrypto, ...args: Parameters<SubtleCrypto['encrypt']>) {
      try {
        const text = td.decode(args[2] as ArrayBuffer), aad = td.decode((args[0] as AesGcmParams).additionalData as ArrayBuffer);
        if (text.startsWith('{"m":')) { const p = (JSON.parse(text) as { p?: string }).p; if (p?.startsWith('/media/')) { w.__perf.media.push({ p, at: performance.now() }); mediaSeq.add(aad.split('|')[3]); } }
      } catch { /* not a call */ }
      return encrypt.apply(this, args);
    } as SubtleCrypto['encrypt'];
    // On the wire (Mola Merkez's queue for the café): photos travelling at once, how many each screen call waits behind.
    const send = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      let seq: string | undefined;
      try { if (String(input).endsWith('/api/merkez/v1/phone/admin') && typeof init?.body === 'string') seq = String((JSON.parse(init.body) as { request?: { seq?: number } }).request?.seq ?? ''); } catch { /* not a call */ }
      if (!seq) return send.call(this, input, init);
      if (!mediaSeq.has(seq)) { w.__perf.apiBehind.push({ at: performance.now(), n: w.__perf.flying }); return send.call(this, input, init); }
      w.__perf.flying++; w.__perf.mostFlying = Math.max(w.__perf.mostFlying, w.__perf.flying);
      // The sealed answers' size: what this page decodes (base64 twice, JSON) on its main thread for the photos.
      return send.call(this, input, init).then(async r => { w.__perf.mediaBytes += Number(r.headers.get('content-length')) || (await r.clone().text()).length; return r; }).finally(() => { w.__perf.flying--; });
    } as typeof fetch;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) w.__perf.long.push({ at: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no long tasks here */ }
  });
}
/** A mid phone's processor. */
async function slow(context: BrowserContext, page: Page, rate: number) { await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate }); }
/**
 * Menü yönetimi, then Kampanyalar → Kampanya ekle → "Menüden seç": each until the photos on the screen have loaded. A
 * screen's own call is sent the moment each starts (`apiMs`: how long it waited through the tunnel meanwhile).
 */
async function menuAndPicker(page: Page, pictured: number, remote: boolean) {
  const probe = () => page.evaluate(() => { const t = performance.now(); (window as unknown as { __api: Promise<number> }).__api = fetch('/api/staff/state').then(r => r.text()).then(() => Math.round(performance.now() - t)); });
  const probed = () => page.evaluate(() => (window as unknown as { __api: Promise<number> }).__api);
  let mark = (await perf(page)).media.length;
  const t1 = await now(page);
  await openView(page, 'Menü yönetimi');
  await probe();
  await expect(page.locator(ROWS)).toHaveCount(pictured, { timeout: 30_000 });
  await expect.poll(() => visibleLoaded(page, ROWS, remote), { timeout: 60_000, intervals: [100] }).toBe(true);
  const menu = { ...await phase(page, t1, mark), apiMs: await probed() };
  await openView(page, 'Kampanyalar');
  await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByRole('button', { name: /Menüden seç/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  mark = (await perf(page)).media.length;
  const t2 = await now(page);
  await editor.getByRole('button', { name: /Menüden seç/ }).click();
  await probe();
  const picker = page.getByRole('dialog', { name: 'Menüden kampanya ürünü seç' });
  await expect(picker.locator('.product-card .product-photo img')).toHaveCount(pictured, { timeout: 30_000 });
  await expect.poll(() => visibleLoaded(page, CARDS, remote), { timeout: 60_000, intervals: [100] }).toBe(true);
  const opened = { ...await phase(page, t2, mark), apiMs: await probed() };
  return { menu, opened, editor, picker };
}

test('İşletmemi yönet: 45 photo products in Menü yönetimi and the campaign picker: each photo once, near the screen, small, no long stalls', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const phoneCode = await phoneCodeOn(cafe.request, PASSWORD);
    await ownerEmailOn(cafe.request);
    const on = await cafe.request.post('/api/staff/remote-admin', { data: { on: true, password: PASSWORD, code: await phoneCode.code() } });
    expect(on.ok(), await on.text()).toBe(true);

    // 41 template photos (800 px + the 320 px thumbnail) stored as this business's own, as an upload stores them.
    const state = await (await cafe.request.get('/api/staff/state')).json() as { products: { id: string; category: string; code: string; published?: boolean; nameEn?: string; description?: string }[] };
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#8a5a3c' } }).png().toBuffer();
    const square = await cafe.request.post('/api/staff/photos', { data: { data: `data:image/png;base64,${png.toString('base64')}` } });
    expect(square.ok(), await square.text()).toBe(true);
    const tenant = /^\/media\/([^/]+)\//.exec((await square.json() as { photo: string }).photo)![1];
    const folder = join(e2eRun(), 'kafe', 'media', tenant); mkdirSync(folder, { recursive: true });
    const names = readdirSync('templates/gorseller').filter(n => n.endsWith('.webp') && !n.endsWith('-small.webp')).map(n => n.slice(0, -5));
    expect(names.length).toBeGreaterThanOrEqual(40);
    const photos = names.map(name => {
      const id = randomUUID();
      copyFileSync(join('templates/gorseller', `${name}.webp`), join(folder, `${id}.webp`));
      copyFileSync(join('templates/gorseller', `${name}-small.webp`), join(folder, `${id}-small.webp`));
      return `/media/${tenant}/${id}.webp`;
    });
    const thumbnails = names.reduce((n, name) => n + statSync(join('templates/gorseller', `${name}-small.webp`)).size, 0);
    const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))];
    const used = new Set(state.products.map(p => p.code));
    // The menu's own products get a photo each (they come first in the picker), then new ones up to 45 photo products: every
    // photo once, the last few on a second product too (the same photo shown twice is fetched once).
    let n = 0, code = 700;
    for (const product of state.products.filter(x => x.published !== false)) {
      const saved = await cafe.request.post('/api/staff/products', { data: { id: product.id, product: { ...product, nameEn: product.nameEn ?? '', description: product.description ?? '', photo: photos[n++ % photos.length] } } });
      expect(saved.ok(), await saved.text()).toBe(true);
    }
    for (; n < 45; n++) {
      while (used.has(String(code))) code++;
      used.add(String(code));
      const product = { code: String(code), name: `Fotoğraflı ürün ${n + 1}`, nameEn: '', category: categories[n % categories.length], description: '', price: 5000 + n * 100, soldOut: false, art: 'food', photo: photos[n % photos.length] };
      const saved = await cafe.request.post('/api/staff/products', { data: { product } });
      expect(saved.ok(), await saved.text()).toBe(true);
    }
    // The picker lists the published products; a demo product may have had a photo of its own already.
    const listed = ((await (await cafe.request.get('/api/staff/state')).json()) as { products: { photo?: string | null; published?: boolean }[] }).products.filter(x => x.photo && x.published !== false);
    const pictured = listed.length, unique = new Set(listed.map(x => x.photo)).size;
    expect(pictured).toBeGreaterThanOrEqual(45);

    // The same screens on the café computer itself (no tunnel: the browser's own srcset and lazy loading, untouched): what
    // they cost the main thread on their own.
    const own = await cafe.newPage();
    await instrument(own);
    await own.goto('/');
    await own.locator('.sidebar nav').waitFor({ timeout: 30_000 });
    await own.waitForTimeout(1500);
    await slow(cafe, own, 4);
    const local = await menuAndPicker(own, pictured, false);
    const ownSrc = await own.locator(CARDS).evaluateAll(list => list.map(e => (e as HTMLImageElement).currentSrc).filter(Boolean));
    expect(ownSrc.length).toBeGreaterThan(0);
    for (const src of ownSrc) expect(new URL(src).pathname).toMatch(/^\/media\/.+-small\.webp$/);
    await own.close();

    await remoteLoginOpen();
    const device = await laptop.newPage();
    const direct: string[] = [];
    device.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/media/')) direct.push(u.pathname); });
    await instrument(device);
    await device.goto(`${MERKEZ}/yonet`);
    await raporlarimLogin(device, { code: () => phoneCode.code() });
    await expect(device.getByRole('region', { name: 'Uzaktan yönetim' })).toBeVisible({ timeout: 30_000 });
    await device.locator('.sidebar nav').waitFor({ timeout: 30_000 });
    await device.waitForTimeout(1500);
    await slow(laptop, device, 4);

    // 1–2. Menü yönetimi and the picker: the photos on the screen.
    const start = (await perf(device)).media.length;
    const { menu, opened, editor, picker } = await menuAndPicker(device, pictured, true);
    await device.screenshot({ path: info.outputPath('kampanya-urun-secimi.png') });

    // 3. Scroll through the whole grid: every photo loads.
    let mark = (await perf(device)).media.length;
    const t3 = await now(device);
    for (let i = 0; i < 40; i++) {
      const end = await picker.evaluate((d: HTMLElement) => { d.scrollTop += 250; return d.scrollTop + d.clientHeight >= d.scrollHeight - 2; });
      await device.waitForTimeout(120);
      if (end) break;
    }
    const images = picker.locator('.product-card .product-photo img');
    await expect.poll(() => images.evaluateAll(list => list.every(e => { const i = e as HTMLImageElement; return i.complete && i.naturalWidth > 1 && i.currentSrc.startsWith('blob:'); })), { timeout: 90_000, intervals: [200] }).toBe(true);
    const scrolled = await phase(device, t3, mark);

    // 4. Category chips back and forth, the search, the picker closed and opened again: nothing new through the tunnel.
    await picker.evaluate((d: HTMLElement) => { d.scrollTop = 0; });
    mark = (await perf(device)).media.length;
    const t4 = await now(device);
    const chips = picker.locator('.category-tabs button');
    for (let round = 0; round < 2; round++) for (const name of [categories[1] ?? categories[0], 'Tümü', categories[0], 'Tümü']) { await chips.filter({ hasText: new RegExp(`^${name}$`) }).first().click(); await device.waitForTimeout(150); }
    await picker.getByLabel('Ürün ara').fill('Fotoğraflı');
    await device.waitForTimeout(200);
    await picker.getByLabel('Ürün ara').fill('');
    await picker.getByRole('button', { name: /Seçimi tamamla/ }).click();
    await editor.getByRole('button', { name: /Menüden seç/ }).click();
    await expect(images).toHaveCount(pictured);
    await expect.poll(() => visibleLoaded(device, CARDS, true), { timeout: 30_000, intervals: [100] }).toBe(true);
    const browsing = await phase(device, t4, mark);
    await slow(laptop, device, 1);

    const q = await perf(device), paths = q.media.slice(start).map(m => m.p);
    const summary = { products: pictured, unique, mostFlying: q.mostFlying, mediaKB: Math.round(q.mediaBytes / 1024), thumbnailsKB: Math.round(thumbnails / 1024), local: { menu: local.menu, opened: local.opened }, remote: { menu, opened, scrolled, browsing }, fetched: paths.length, distinct: new Set(paths).size, small: paths.filter(x => x.endsWith('-small.webp')).length, direct: direct.length };
    console.log(`remote-photos: ${JSON.stringify(summary)}`);
    await info.attach('olcum.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });

    // Each photo through the tunnel once, the thumbnail (rows 48 px, cards ~130 px wide), none asked of Mola Merkez directly.
    expect(paths.length, paths.join('\n')).toBe(unique);
    expect(new Set(paths).size).toBe(unique);
    expect(summary.small).toBe(unique);
    expect(direct, direct.join('\n')).toEqual([]);
    expect(browsing.media).toBe(0);
    // Near the screen only: Menü yönetimi does not fetch the whole menu, nor the picker every card at once.
    expect(menu.media).toBeGreaterThan(0);
    expect(menu.media + opened.media).toBeLessThan(unique);
    // A screen's own call is not stuck behind the photos: at most 4 travel at a time (before: up to 80 at Mola Merkez, the
    // screen's call behind them). (apiMs, the call's time, is reported only: it also counts this machine's busy moments.)
    expect(summary.mostFlying, JSON.stringify(summary)).toBeLessThanOrEqual(4);
    for (const p of [menu, opened, scrolled, browsing]) expect(p.apiBehind, JSON.stringify(summary)).toBeLessThanOrEqual(4);
    // The main thread. What it decodes for the photos (each sealed answer is base64 of JSON holding base64): the 41 thumbnails
    // once, about 1.8 times their size on the wire: ~420 KB (before: every thumbnail and its 800 px photo, ~2.8 MB).
    expect(q.mediaBytes, JSON.stringify(summary)).toBeLessThan(2.2 * thumbnails);
    // Long tasks are timings on a shared test machine (4× slowed, other work beside it), so this is a bound against a relapse,
    // not a benchmark; the numbers are in olcum.json, with the café computer's own screens as the yardstick. Scrolling the
    // picker renders nothing new: its 25-odd photos arriving 4 at a time decode in a few milliseconds each, so no single task
    // comes near the one of 1.1–2 s that opening Menü yönetimi cost before (82 answers, 41 of them 800 px, at once). Seen
    // after: 0 ms on a quiet machine, at most ~220 ms on a loaded one.
    expect(scrolled.longestMs, JSON.stringify(summary)).toBeLessThan(400);
  } finally { await laptop.close(); await cafe.close(); }
});

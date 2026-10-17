import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { defaultPackages, features } from '../../packages/domain/features';
import { lira, priceFor } from '../../packages/domain/service-pricing';
import { MERKEZ } from './helpers';

/*
 * molayazilim.com.tr → Özellikler → Paketler (scripts/site-build.ts packagePriceHtml): the three packages' prices from the
 * code's defaults (packages/domain/features.ts), "+ KDV" beside each, the package discount's list price struck above,
 * "Yıllık ödemede 2 ay bedava", "İlk 30 gün ücretsiz · Kurulum ücretsiz" above the cards, the Özel card without prices.
 * The site is built into a scratch folder (never site/dist) and served as Caddy does (scripts/site-dev.ts). Port: E2E_PORT + 44.
 * Screenshots also go to $env:SITE_EKRAN when it is set (e.g. docs/ekran/site).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100) + 44, SITE = `http://127.0.0.1:${PORT}`;
let scratch = '';
let server: ChildProcess | undefined;
test.beforeAll(async () => {
  test.setTimeout(180000);
  mkdirSync('.local/e2e', { recursive: true }); scratch = mkdtempSync(resolve('.local/e2e/site-paketler-'));
  const config = join(scratch, 'config.json');
  writeFileSync(config, JSON.stringify({ ...JSON.parse(readFileSync('site/config.json', 'utf8')), downloads: { enabled: false, version: '', files: {} } }));
  server = spawn(process.execPath, ['--import', 'tsx', 'scripts/site-dev.ts', '--port', String(PORT), '--merkez', MERKEZ, '--no-watch', '--dist', join(scratch, 'dist'), '--config', config], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${SITE}/ozellikler/`)).ok) break; } catch { /* building */ }
    if (i > 400 || server.exitCode !== null) throw new Error('Web sitesi açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
});
test.afterAll(() => { if (server && server.exitCode === null) server.kill(); if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });

async function shot(page: Page, info: TestInfo, name: string) {
  const section = page.locator('#paketler');
  await section.screenshot({ path: info.outputPath(name) });
  if (process.env.SITE_EKRAN) { mkdirSync(process.env.SITE_EKRAN, { recursive: true }); await section.screenshot({ path: join(process.env.SITE_EKRAN, name) }); }
}
const card = (page: Page, id: string) => page.locator(`#paketler article[data-paket="${id}"]`);

for (const [width, height, name] of [[1280, 900, 'paketler-masaustu.png'], [360, 780, 'paketler-telefon.png']] as const) {
  test(`Paketler (${width} px): three prices + KDV, Restoran Pro's struck list price, the yearly line, "İlk 30 gün ücretsiz", Özel without prices`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await page.goto(`${SITE}/ozellikler/#paketler`);
    const section = page.locator('#paketler');
    // One clear line above the cards.
    const offer = section.locator('.package-offer');
    await expect(offer).toHaveText('İlk 30 gün ücretsiz · Kurulum ücretsiz');
    expect((await offer.boundingBox())!.y).toBeLessThan((await section.locator('.packages').boundingBox())!.y);
    // The owner's prices (17 Ekim), KDV hariç, "+ KDV" always beside the price.
    const expected = { 'cay-bahcesi': ['₺750', '₺7.500'], 'kafe-standart': ['₺1.375', '₺13.750'], 'restoran-pro': ['₺1.875', '₺18.750'] } as const;
    for (const [id, [monthly, yearly]] of Object.entries(expected)) {
      const c = card(page, id), now = c.locator('.package-price .now');
      await expect(now.locator('b')).toHaveText(monthly);
      await expect(now.locator('.per')).toHaveText('/ay + KDV'); await expect(now.locator('.per')).toBeVisible();
      // "+ KDV" on the price's own line (not wrapped under it), also at 360 px.
      const [b, per] = [(await now.locator('b').boundingBox())!, (await now.locator('.per').boundingBox())!];
      expect(per.y, `${id}: + KDV fiyatın yanında`).toBeLessThan(b.y + b.height); expect(per.x).toBeGreaterThan(b.x);
      await expect(c.locator('.package-price .year')).toHaveText(`Yıllık ödemede 2 ay bedava: ${yearly} + KDV`);
    }
    // Restoran Pro: ₺1.910 struck through above ₺1.875, read out as "Liste fiyatı ₺1.910", then "Paket fiyatı ₺1.875".
    const pro = card(page, 'restoran-pro'), was = pro.locator('s.was');
    await expect(was).toHaveText('Liste fiyatı ₺1.910'); await expect(was).toBeVisible();
    await expect(pro.locator('.package-price .now')).toHaveText('Paket fiyatı ₺1.875 /ay + KDV');
    expect(await was.evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('line-through');
    expect((await was.boundingBox())!.y + (await was.boundingBox())!.height).toBeLessThanOrEqual((await pro.locator('.now b').boundingBox())!.y + 1);
    for (const id of ['cay-bahcesi', 'kafe-standart']) await expect(card(page, id).locator('s')).toHaveCount(0);
    // Worked out from the code (no price typed into the page): the same as Mola Merkez's priceFor on the defaults.
    for (const p of defaultPackages) {
      const price = priceFor(p.features, {}, p.discount);
      await expect(card(page, p.id).locator('.now b')).toHaveText(lira(price.monthly));
      await expect(card(page, p.id).locator('.year')).toContainText(lira(price.yearly));
    }
    // Özel: no per-service prices, a way to İletişim.
    const custom = card(page, 'ozel');
    await expect(custom).toContainText('İhtiyacınız olan hizmetleri birlikte seçelim');
    await expect(custom).not.toContainText('₺');
    await expect(custom.getByRole('link')).toHaveAttribute('href', /^\/iletisim\//);
    // No pilot or launch discount on the site.
    await expect(section).not.toContainText(/pilot|açılış|lansman/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(page, info, name);
    expect(errors).toEqual([]);
  });
}

/*
 * "Hangi pakette ne var?" (scripts/site-build.ts packageMatrixHtml) under the cards: a row per service as the cards list them
 * (no Uzaktan yönetim, it is inside Uzaktan erişim), ✓ read out as "var", – as "yok", Özel "seçilebilir" (Adisyon çekirdeği
 * "her zaman"), Paket servis platformları "yakında" across. At 360 px the column names shorten and the page never scrolls sideways.
 */
for (const [width, height, name] of [[1280, 900, 'paketler-tablo-masaustu.png'], [360, 780, 'paketler-tablo-telefon.png']] as const) {
  test(`Hangi pakette ne var? (${width} px): a row per service, ✓ "var" / – "yok", Restoran Pro all ✓, no sideways scroll`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await page.goto(`${SITE}/ozellikler/#paket-karsilastirma`);
    const matrix = page.locator('#paketler .package-matrix');
    await expect(matrix.getByRole('heading', { level: 3 })).toHaveText('Hangi pakette ne var?');
    const table = matrix.getByRole('table', { name: 'Hangi pakette ne var?' });
    await expect(table).toBeVisible();
    // Under the cards.
    expect((await matrix.boundingBox())!.y).toBeGreaterThan((await page.locator('#paketler .packages').boundingBox())!.y);
    // Columns: the default packages, then Özel (full names read out, also where they look short).
    await expect(table.getByRole('columnheader')).toHaveText(['Hizmet', ...defaultPackages.map(p => p.name), 'Özel paket']);
    // One row per service as the site shows them.
    const shown = features.filter(f => !f.partOf);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(shown.length);
    for (const f of shown) await expect(table.locator(`tbody tr[data-hizmet="${f.id}"] th`)).toContainText(f.name);
    await expect(table.locator('tbody tr[data-hizmet="remote-admin"]')).toHaveCount(0);
    const cells = (id: string) => table.locator(`tbody tr[data-hizmet="${id}"] td`);
    // Every package column from the code: ✓ "var" where the package holds it, – "yok" where not.
    for (const f of shown.filter(x => !x.soon)) {
      const c = cells(f.id);
      await expect(c).toHaveCount(defaultPackages.length + 1);
      for (const [i, p] of defaultPackages.entries()) {
        const has = p.features.includes(f.id), cell = c.nth(i);
        await expect(cell, `${p.name} · ${f.name}`).toHaveAccessibleName(has ? 'var' : 'yok');
        await expect(cell.locator('.mx-tik')).toHaveCount(has ? 1 : 0);
      }
      await expect(c.last()).toHaveText(f.required ? 'her zaman' : 'seçilebilir');
    }
    // Restoran Pro: ✓ on every row but "yakında"; Çay bahçesi: no Stok.
    const pro = defaultPackages.findIndex(p => p.id === 'restoran-pro'), cay = defaultPackages.findIndex(p => p.id === 'cay-bahcesi');
    for (const f of shown.filter(x => !x.soon)) await expect(cells(f.id).nth(pro)).toHaveAccessibleName('var');
    await expect(cells('stock').nth(cay)).toHaveAccessibleName('yok');
    await expect(cells('stock').nth(cay)).toContainText('–');
    await expect(table.getByRole('cell', { name: 'var' })).toHaveCount(shown.filter(x => !x.soon).reduce((n, f) => n + defaultPackages.filter(p => p.features.includes(f.id)).length, 0));
    // "Yakında": one cell across.
    for (const f of shown.filter(x => x.soon)) { await expect(cells(f.id)).toHaveCount(1); await expect(cells(f.id)).toHaveText('yakında'); await expect(cells(f.id)).toHaveAttribute('colspan', String(defaultPackages.length + 1)); }
    // Kafe Standart's column stands out (tinted).
    const standart = table.getByRole('columnheader', { name: 'Kafe Standart' });
    expect(await standart.evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(await table.getByRole('columnheader', { name: 'Restoran Pro' }).evaluate(e => getComputedStyle(e).backgroundColor));
    await expect(matrix.locator('.mx-kural')).toHaveText('Bütün paketlerde: sınırsız cihaz, internet kesilse de çalışma, gece otomatik yedek, ilk 30 gün bütün hizmetler açık.');
    // No sideways page scroll; at 360 px the table fits its box too (short column names).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = matrix.locator('.mx-kutu');
    expect(await box.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    // Phones: "Çay" on screen, "Çay bahçesi" read out.
    const tail = table.locator('thead th .mx-tam').first();
    if (width === 360) expect(await tail.evaluate(e => e.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    else expect(await tail.evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(10);
    // The whole table on one picture (taller than the window).
    await page.setViewportSize({ width, height: 1500 });
    await matrix.screenshot({ path: info.outputPath(name) });
    if (process.env.SITE_EKRAN) { mkdirSync(process.env.SITE_EKRAN, { recursive: true }); await matrix.screenshot({ path: join(process.env.SITE_EKRAN, name) }); }
    expect(errors).toEqual([]);
  });
}

test('Destek ve İletişim: "Fiyatlar ne kadar?" points to the packages, no typed-in price', async ({ page }) => {
  await page.goto(`${SITE}/iletisim/`);
  const answer = page.locator('details').filter({ hasText: 'Fiyatlar ne kadar?' });
  await answer.locator('summary').click();
  await expect(answer.getByRole('link', { name: /Paketler/ })).toHaveAttribute('href', '/ozellikler/#paketler');
  await expect(answer).toContainText('İlk 30 gün ücretsiz'); await expect(answer).not.toContainText('₺');
});

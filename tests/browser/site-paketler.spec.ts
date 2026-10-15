import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { defaultPackages } from '../../packages/domain/features';
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
  test(`Paketler (${width} px): three prices + KDV, Kafe Standart's struck list price, the yearly line, "İlk 30 gün ücretsiz", Özel without prices`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height });
    await page.goto(`${SITE}/ozellikler/#paketler`);
    const section = page.locator('#paketler');
    // One clear line above the cards.
    const offer = section.locator('.package-offer');
    await expect(offer).toHaveText('İlk 30 gün ücretsiz · Kurulum ücretsiz');
    expect((await offer.boundingBox())!.y).toBeLessThan((await section.locator('.packages').boundingBox())!.y);
    // The owner's prices (15 Ekim), KDV hariç, "+ KDV" always beside the price.
    const expected = { 'cay-bahcesi': ['₺980', '₺9.800'], 'kafe-standart': ['₺1.950', '₺19.500'], 'restoran-pro': ['₺2.600', '₺26.000'] } as const;
    for (const [id, [monthly, yearly]] of Object.entries(expected)) {
      const c = card(page, id), now = c.locator('.package-price .now');
      await expect(now.locator('b')).toHaveText(monthly);
      await expect(now.locator('.per')).toHaveText('/ay + KDV'); await expect(now.locator('.per')).toBeVisible();
      // "+ KDV" on the price's own line (not wrapped under it), also at 360 px.
      const [b, per] = [(await now.locator('b').boundingBox())!, (await now.locator('.per').boundingBox())!];
      expect(per.y, `${id}: + KDV fiyatın yanında`).toBeLessThan(b.y + b.height); expect(per.x).toBeGreaterThan(b.x);
      await expect(c.locator('.package-price .year')).toHaveText(`Yıllık ödemede 2 ay bedava: ${yearly} + KDV`);
    }
    // Kafe Standart: ₺2.060 struck through above ₺1.950, read out as "Liste fiyatı ₺2.060", then "Paket fiyatı ₺1.950".
    const standart = card(page, 'kafe-standart'), was = standart.locator('s.was');
    await expect(was).toHaveText('Liste fiyatı ₺2.060'); await expect(was).toBeVisible();
    await expect(standart.locator('.package-price .now')).toHaveText('Paket fiyatı ₺1.950 /ay + KDV');
    expect(await was.evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('line-through');
    expect((await was.boundingBox())!.y + (await was.boundingBox())!.height).toBeLessThanOrEqual((await standart.locator('.now b').boundingBox())!.y + 1);
    for (const id of ['cay-bahcesi', 'restoran-pro']) await expect(card(page, id).locator('s')).toHaveCount(0);
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

test('Destek ve İletişim: "Fiyatlar ne kadar?" points to the packages, no typed-in price', async ({ page }) => {
  await page.goto(`${SITE}/iletisim/`);
  const answer = page.locator('details').filter({ hasText: 'Fiyatlar ne kadar?' });
  await answer.locator('summary').click();
  await expect(answer.getByRole('link', { name: /Paketler/ })).toHaveAttribute('href', '/ozellikler/#paketler');
  await expect(answer).toContainText('İlk 30 gün ücretsiz'); await expect(answer).not.toContainText('₺');
});

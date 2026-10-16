import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_API, MERKEZ, e2eRun, openView, openYonetim, yonetimState } from './helpers';
import { protectedPort, protectedServer, scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

/*
 * Hazır şablon görselleri (server/template-photos.ts): a new business made the real way (application, approval in Mola Yönetim,
 * owner account) starts with the café menu's photos: in Menü yönetimi, the product editor and the guest's QR menu, on a phone
 * (Sipariş al lists products without pictures).
 */
const PHOTOS = ['Caffè Latte', 'Americano', 'Türk Kahvesi', 'Demleme Çay', 'Ihlamur', 'Ev Yapımı Limonata', 'San Sebastian', 'Çikolatalı Brownie'];
/** Every photo really loaded (scrolled to first: they load lazily) and square, as an upload. */
async function loaded(images: Locator) {
  const count = await images.count();
  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0 && e.naturalWidth === e.naturalHeight), { timeout: 10_000 }).toBe(true);
  }
  return count;
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('a new café starts with the template photos: Menü yönetimi, the editor and the guest QR menu (phone); Sipariş al stays a list', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const root = scenario('template-photos');
  const server = await protectedServer(root, protectedPort(0), 'kafe-pc', true, { MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt'), MOLA_HEARTBEAT_MS: '2000', MOLA_SYNC_SOON_MS: '1000' });
  const admin = await browser.newPage();
  try {
    const applied = await page.request.post(`${server.base}/api/activation/application`, { data: { businessName: 'Fotoğraflı Kafe', sector: 'cafe', contactName: 'Deniz Er', consent: true, agreement: { version: AGREEMENT_VERSION },
      invoice: { legalName: 'Fotoğraflı Kafe Ltd. Şti.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1111111114', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 9', phone: '+905321119977', email: 'deniz@example.com' } } });
    expect(applied.ok(), await applied.text()).toBe(true);
    await openYonetim(admin);
    const tenantId = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Fotoğraflı Kafe').tenantId;
    expect((await admin.request.post(`${ADMIN_API}/applications/approve`, { data: { requestId: randomUUID().replace(/-/g, ''), tenantId } })).ok()).toBe(true);
    await expect.poll(async () => (await (await page.request.get(`${server.base}/api/activation`)).json()).state, { timeout: 15000 }).toBe('owner');
    const owner = await page.request.post(`${server.base}/api/activation/owner`, { data: { username: 'deniz', password: 'DenizKafe!2026' } });
    expect(owner.ok(), await owner.text()).toBe(true);
    let state = await (await page.request.get(`${server.base}/api/staff/state`)).json();
    const setup = await page.request.post(`${server.base}/api/staff/setup`, { data: { requestId: randomUUID().replace(/-/g, ''), version: state.businessRevision ?? 0, name: 'Fotoğraflı Kafe', sector: 'cafe', tableCount: 3, changeSeconds: 60, commissionBps: null } });
    expect(setup.ok(), await setup.text()).toBe(true);
    state = await (await page.request.get(`${server.base}/api/staff/state`)).json();
    expect(state.products.filter((p: any) => p.photo).map((p: any) => p.name)).toEqual(PHOTOS);

    // Sipariş al on a phone: a compact list without pictures (src/components.tsx staff cards), the same eight products.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.base);
    await openView(page, 'Sipariş al');
    await page.getByLabel('Sipariş masası').first().selectOption({ index: 2 });
    await expect(page.locator('.staff-card')).toHaveCount(8);
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('siparis-al-telefon.png'), fullPage: true });

    // Menü yönetimi: all eight photos in the list (square, as uploads), no drawing left.
    await openView(page, 'Menü yönetimi');
    await expect(page.locator('h1')).toHaveText('Menü yönetimi');
    const rows = page.locator('.menu-row');
    await expect(rows).toHaveCount(8);
    expect(await loaded(rows.locator('.product-photo img'))).toBe(8);
    await expect(rows.locator('.art-circle')).toHaveCount(0);
    for (const box of await rows.locator('.product-photo').evaluateAll(list => list.map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }))) expect(Math.abs(box[0] - box[1])).toBeLessThan(2);
    expect(await fits(page)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath('menu-yonetimi-telefon.png'), fullPage: true });
    // The editor shows it as the product's current photo (replace or remove like any upload).
    await rows.filter({ hasText: 'Caffè Latte' }).getByRole('button', { name: 'Düzenle' }).click();
    expect(await loaded(page.locator('.photo-current .product-photo img'))).toBe(1);
    await page.screenshot({ path: info.outputPath('urun-duzenle-telefon.png') });
    await page.keyboard.press('Escape');

    // The guest's QR menu on a phone.
    const guest = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'tr-TR' })).newPage();
    await guest.goto(`${server.base}/m/${state.tables[0].token}`);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 15_000 });
    expect(await loaded(guest.locator('.product-card .product-photo img'))).toBe(8);
    expect(await fits(guest)).toBe(true);
    await guest.evaluate(() => window.scrollTo(0, 0));
    await guest.screenshot({ path: info.outputPath('misafir-menu-telefon.png'), fullPage: true });
    // The product window shows the large one.
    await guest.getByRole('button', { name: /Caffè Latte/ }).first().click();
    const large = guest.locator('.product-photo.art-large img');
    await expect(large).toBeVisible();
    expect(await loaded(large)).toBe(1);
    await guest.screenshot({ path: info.outputPath('misafir-urun-telefon.png') });
    await guest.context().close();
  } finally {
    await admin.close();
    await server.stop();
  }
});

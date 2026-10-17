import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect, type Locator } from '@playwright/test';
import { ADMIN_API, MERKEZ, e2eRun, openView, openYonetim, yonetimState } from './helpers';
import { protectedPort, protectedServer, scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

/*
 * Kampanyalar → "Menüden kampanya ürünü seç" on a business made from the template (server/template-photos.ts): the picker's
 * product cards show the same photos as Menü yönetimi, every one loaded (no broken image with its name in a grey box).
 */
async function loaded(images: Locator) {
  const count = await images.count();
  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
  }
  return count;
}

test('Kampanyalar product picker shows the template photos loaded', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const root = scenario('campaign-picker-photos');
  const server = await protectedServer(root, protectedPort(0), 'kafe-pc', true, { MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt'), MOLA_HEARTBEAT_MS: '2000', MOLA_SYNC_SOON_MS: '1000' });
  const admin = await browser.newPage();
  try {
    const applied = await page.request.post(`${server.base}/api/activation/application`, { data: { businessName: 'Kampanya Fotoğraflı Kafe', sector: 'cafe', contactName: 'Ece Er', consent: true, agreement: { version: AGREEMENT_VERSION },
      invoice: { legalName: 'Kampanya Fotoğraflı Kafe Ltd. Şti.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1111111114', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 11', phone: '+905321119978', email: 'ece@example.com' } } });
    expect(applied.ok(), await applied.text()).toBe(true);
    await openYonetim(admin);
    const tenantId = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'Kampanya Fotoğraflı Kafe').tenantId;
    expect((await admin.request.post(`${ADMIN_API}/applications/approve`, { data: { requestId: randomUUID().replace(/-/g, ''), tenantId } })).ok()).toBe(true);
    await expect.poll(async () => (await (await page.request.get(`${server.base}/api/activation`)).json()).state, { timeout: 15000 }).toBe('owner');
    const owner = await page.request.post(`${server.base}/api/activation/owner`, { data: { username: 'ece', password: 'EceKafe!2026' } });
    expect(owner.ok(), await owner.text()).toBe(true);
    let state = await (await page.request.get(`${server.base}/api/staff/state`)).json();
    const setup = await page.request.post(`${server.base}/api/staff/setup`, { data: { requestId: randomUUID().replace(/-/g, ''), version: state.businessRevision ?? 0, name: 'Kampanya Fotoğraflı Kafe', sector: 'cafe', tableCount: 3, changeSeconds: 60, commissionBps: null } });
    expect(setup.ok(), await setup.text()).toBe(true);
    state = await (await page.request.get(`${server.base}/api/staff/state`)).json();
    const photos = state.products.filter((p: any) => p.photo).length;
    expect(photos).toBeGreaterThan(0);

    await page.goto(server.base);
    await openView(page, 'Kampanyalar');
    await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('button', { name: /Menüden seç/ }).click();
    const picker = page.getByRole('dialog', { name: 'Menüden kampanya ürünü seç' });
    await expect(picker).toBeVisible();
    const cards = picker.locator('.product-card');
    await expect(cards).toHaveCount(state.products.filter((p: any) => p.published !== false).length);
    const images = picker.locator('.product-card .product-photo img');
    await expect(images).toHaveCount(photos);
    for (const src of await images.evaluateAll(list => list.map(e => (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src))) expect(new URL(src).pathname).toMatch(/^\/media\/[^/]+\/[0-9a-f-]+(-small)?\.webp$/);
    expect(await loaded(images)).toBe(photos);
    await picker.getByRole('button', { name: /Seçimi tamamla/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('kampanya-urun-secimi.png') });
  } finally {
    await admin.close();
    await server.stop();
  }
});

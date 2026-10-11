import { test, expect, type Browser, type Page } from '@playwright/test';
import { ensureSetup, openView } from './helpers';

// Dış sipariş entegrasyonları: Deneme platformu → Onay bekliyor (countdown) → Kabul → kitchen card with the platform label →
// Hazır → Kuryeye teslim edildi → the report's sales channel. Phone, tablet and desktop sizes never scroll sideways.

async function login(page: Page, username: string) {
  await page.goto('/');
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(username);
  await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await ensureSetup(page.request); await page.reload();
  await expect(page.locator('.workspace')).toBeVisible();
}
async function staffPage(browser: Browser, username: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport }); const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('mola-integrations', '1'));
  await login(page, username); return { context, page };
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
/** Every visible button inside `selector` is at least 44 px tall (touch). */
const smallTargets = (page: Page, selector: string) => page.evaluate(sel => [...document.querySelectorAll<HTMLElement>(`${sel} button, ${sel} select, ${sel} input[type=checkbox]`)]
  .filter(el => el.offsetParent && el.getBoundingClientRect().height > 0)
  .map(el => el.closest('label') ?? el).filter(el => el.getBoundingClientRect().height < 43.5).map(el => (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40)), selector);
const SIZES = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1366, height: 860 }];

test('test platform order: approval with countdown → kitchen card with platform label → ready → handed to courier → report channel', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const owner = await staffPage(browser, 'isletme', { width: 390, height: 844 }), o = owner.page; o.on('pageerror', e => errors.push(e.message));
  expect((await o.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  await openView(o, 'Entegrasyonlar');
  await expect(o.getByText('Gerçek bağlantı için platformun entegrasyon izni ve API anahtarı gerekir; Mola ekibi yardımcı olur.', { exact: false })).toBeVisible();
  for (const name of ['Yemeksepeti', 'Getir Yemek', 'Trendyol Yemek', 'Migros Yemek']) await expect(o.getByRole('article', { name, exact: true }).getByRole('status')).toHaveText('Bağlantı izni bekleniyor');
  const testCard = o.getByRole('article', { name: 'Deneme platformu', exact: true });
  await expect(testCard.getByRole('button', { name: 'Deneme siparişi gönder' })).toBeDisabled();
  await testCard.getByRole('button', { name: 'Aç', exact: true }).click();
  await expect(testCard.getByRole('status')).toHaveText('Bağlı', { timeout: 15_000 });
  await testCard.getByRole('button', { name: 'Deneme siparişi gönder' }).click();
  const pending = o.locator('.external-card');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText('Deneme platformu #'); await expect(pending).toContainText('Kurye ile teslim'); await expect(pending).toContainText('Çevrimiçi ödendi');
  await expect(pending.getByText('Menüde eşleşmeyen ürün')).toBeVisible();
  // The countdown has a fixed width: the card does not move while it counts.
  const timer = pending.getByRole('timer'); await expect(timer).toBeVisible();
  const box1 = await timer.boundingBox(); await o.waitForTimeout(1100); const box2 = await timer.boundingBox();
  expect(Math.abs(box1!.x - box2!.x)).toBeLessThan(1); expect(Math.abs(box1!.width - box2!.width)).toBeLessThan(1);
  expect(await noSideScroll(o)).toBe(true); expect(await smallTargets(o, '.integration-page')).toEqual([]);
  await o.screenshot({ path: info.outputPath('integrations-phone.png'), fullPage: true });
  const code = ((await pending.locator('.platform-badge').first().textContent()) ?? '').replace(/^.*#/, '');
  expect(code).toMatch(/^\d{4}$/);

  // The kitchen sees the same order waiting (no prices) and the owner accepts it from the Masalar screen.
  const kitchen = await staffPage(browser, 'mutfak', { width: 820, height: 1180 }), k = kitchen.page; k.on('pageerror', e => errors.push(e.message));
  await expect(k.locator('.external-card')).toHaveCount(1);
  await expect(k.locator('.external-card .total-line')).toHaveCount(0);
  await openView(o, 'Masalar');
  await o.locator('.external-card').getByRole('button', { name: 'Kabul et' }).click();
  await expect(o.locator('.external-card')).toHaveCount(0);
  // Paid online: the masasız strip shows the platform ticket as paid, never "Ödeme bekliyor".
  const strip = o.locator('.takeaway-card').filter({ hasText: `Deneme platformu #${code}` });
  await expect(strip).toContainText('Ödendi');

  const card = k.locator('.kitchen-card').filter({ hasText: `DENEME #${code}` });
  await expect(card).toBeVisible(); await expect(k.locator('.external-card')).toHaveCount(0);
  await expect(card.locator('.platform-heading')).toHaveText(`DENEME #${code}`);
  await expect(card).toContainText('Kurye ile teslim'); await expect(card).toContainText('Menüde eşleşmeyen ürün');
  expect(await noSideScroll(k)).toBe(true);
  await k.screenshot({ path: info.outputPath('kitchen-tablet.png'), fullPage: true });
  // A portrait tablet shows one stage at a time: the cook follows the order with the stage tabs.
  const stage = (name: string) => k.getByRole('tablist', { name: 'Mutfak aşamaları' }).getByRole('tab', { name: new RegExp(`^${name}\\s*\\d+$`) });
  await card.getByRole('button', { name: 'Hazırlamaya başla' }).click();
  await stage('Hazırlanıyor').click();
  await card.getByRole('button', { name: 'Hazır olarak işaretle' }).click();
  await stage('Hazır').click();
  await card.getByRole('button', { name: 'Kuryeye teslim edildi' }).click();
  await expect(k.locator('.kitchen-card').filter({ hasText: `DENEME #${code}` })).toHaveCount(0);

  // The platform hears "ready" and "delivered" (outbox, a few seconds); the list says so.
  await openView(o, 'Entegrasyonlar');
  await expect(o.locator('.external-history article').filter({ hasText: `#${code}` }).locator('.stage')).toHaveText('Kuryeye teslim edildi', { timeout: 20_000 });
  await expect.poll(async () => (await (await o.request.get('/api/staff/integrations')).json()).orders.find((x: { code: string }) => x.code === code).reported, { timeout: 20_000 }).toEqual(['accept', 'ready', 'delivered']);

  // Reports: the sale is in its own channel and the money is "Platform ödemesi", not cash.
  const day = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10); // the business day: 05:00 Türkiye = 02:00 UTC
  const overview = await (await o.request.get(`/api/staff/reports/overview?from=${day}&to=${day}`)).json();
  expect(overview.channels.find((c: { id: string }) => c.id === 'test')).toMatchObject({ name: 'Deneme platformu', orders: 1 });
  expect(overview.platform).toBeGreaterThan(0);
  await openView(o, 'Satış ve Raporlar');
  await expect(o.locator('section[aria-label="Kanallar"]')).toContainText('Deneme platformu');
  await expect(o.getByText('Platform ödemesi', { exact: false }).first()).toBeVisible();
  expect(await noSideScroll(o)).toBe(true);

  // Every size: no sideways scrolling on the integration page and the kitchen board, touch targets stay large.
  await openView(o, 'Entegrasyonlar');
  await o.getByRole('article', { name: 'Deneme platformu', exact: true }).getByRole('button', { name: 'Deneme siparişi gönder' }).click();
  await expect(o.locator('.external-card')).toHaveCount(1);
  for (const size of SIZES) {
    await o.setViewportSize(size); await k.setViewportSize(size);
    await expect(o.locator('.external-card')).toBeVisible(); await expect(k.locator('.external-card')).toBeVisible();
    expect(await noSideScroll(o), `entegrasyonlar ${size.width}×${size.height}`).toBe(true);
    expect(await noSideScroll(k), `mutfak ${size.width}×${size.height}`).toBe(true);
    expect(await smallTargets(o, '.integration-page'), `dokunma ${size.width}`).toEqual([]);
    expect(await smallTargets(k, '.external-inbox'), `mutfak dokunma ${size.width}`).toEqual([]);
  }
  await o.screenshot({ path: info.outputPath('integrations-desktop.png'), fullPage: true });
  // Reddet with a reason closes it everywhere.
  await o.locator('.external-card').getByRole('button', { name: 'Reddet' }).click();
  await o.getByRole('radio', { name: 'Mutfak çok yoğun' }).check();
  await o.getByRole('button', { name: 'Siparişi reddet' }).click();
  await expect(o.locator('.external-card')).toHaveCount(0); await expect(k.locator('.external-card')).toHaveCount(0);
  await expect(o.locator('.external-history article').first()).toContainText('Neden: Mutfak çok yoğun');
  // Only the owner opens Entegrasyonlar and stores keys.
  expect((await k.request.get('/api/staff/integrations')).status()).toBe(403);
  expect(errors).toEqual([]);
  await owner.context.close(); await kitchen.context.close();
});

import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cashAction, ensureSetup, openReport, openSettings, openStaff } from './helpers';

const PASSWORD = 'MolaDemo!2026';
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const smallFields = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=radio]),select,textarea')].filter(e => e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 16).map(e => e.getAttribute('aria-label') ?? e.id));
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  return page;
}
const digits = async (page: Page) => ((await page.locator('.counter-code-digits').textContent()) ?? '').replace(/\D/g, '');

test('vardiya takibi: the waiter is stopped until the counter\'s code is typed, the code changes after each use, the shift ends with a fresh code; Personel ve bahşiş report', async ({ page, browser }, info) => {
  test.setTimeout(240000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  // The owner switches it on in Personel → Personel ayarları → Vardiya, picks a tip rule (Bahşiş) and plans the waiter's shift in Çalışanlar.
  await openSettings(page, 'Vardiya ve bahşiş');
  // K-B (9 Ekim): someone is working (a waiter signed in) → it asks first, "Bir sonraki girişte" chosen; here "Hemen".
  const early = (await browser.newContext()).request;
  expect((await early.post('/api/login', { data: { username: 'garson', password: PASSWORD } })).ok()).toBe(true);
  await page.getByRole('checkbox', { name: /Vardiya takibi/ }).click();
  const ask = page.getByRole('dialog', { name: 'Vardiya takibi açılsın mı?' });
  await expect(ask).toContainText(/Şu an \d+ kişi çalışıyor\. Kod bir sonraki girişlerinde mi istensin, hemen mi\?/);
  await expect(ask.getByRole('radio', { name: 'Bir sonraki girişte' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('checkbox', { name: /Vardiya takibi/ })).not.toBeChecked();
  await shot(page, 'vardiya-ac-soru.png', info.outputPath('vardiya-ac-soru.png'));
  await ask.getByRole('radio', { name: 'Hemen' }).click();
  await ask.getByRole('button', { name: 'Vardiya takibini aç' }).click();
  await expect(page.getByText('Açık. Kod, kasiyer ya da sizin Masalar ekranınızda')).toBeVisible();
  // "Hemen": the session signed in before is stopped at once.
  expect((await (await early.get('/api/staff/shifts/me')).json()).required).toBe(true);
  await early.dispose();
  await openStaff(page, 'Personel ayarları', 'Bahşiş');
  await page.getByRole('group', { name: 'Bahşiş dağıtımı' }).getByRole('button', { name: 'Çalışılan saate göre' }).click();
  await expect(page.getByRole('group', { name: 'Bahşiş dağıtımı' }).getByRole('button', { name: 'Çalışılan saate göre' })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'vardiya-ayarlar.png', info.outputPath('vardiya-ayarlar.png'), true);
  await openStaff(page, 'Çalışanlar');
  await page.getByRole('button', { name: 'Garson vardiya planı' }).click();
  const plan = page.getByRole('dialog', { name: 'Garson · Vardiya planı' });
  // 24 hours whatever the computer's language (never "09:00 AM"); start and end side by side; seven even day chips.
  await expect(plan.getByLabel('Başlangıç')).toHaveValue('09:00'); await expect(plan.getByLabel('Bitiş')).toHaveValue('17:00');
  await expect(plan.getByLabel('Başlangıç')).toHaveAttribute('type', 'text');
  await plan.getByLabel('Bitiş').fill(''); await plan.getByLabel('Bitiş').pressSequentially('1730');
  await expect(plan.getByLabel('Bitiş')).toHaveValue('17:30');
  const [from, to] = await Promise.all([plan.getByLabel('Başlangıç').boundingBox(), plan.getByLabel('Bitiş').boundingBox()]);
  expect(Math.abs(from!.y - to!.y)).toBeLessThan(2);
  const chips = await plan.locator('.shift-plan-days button').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().width)));
  expect(Math.max(...chips) - Math.min(...chips)).toBeLessThanOrEqual(1);
  await shot(page, 'vardiya-plani.png', info.outputPath('vardiya-plani.png'));
  await plan.getByLabel('Bitiş').fill('17:00');
  await plan.getByRole('button', { name: 'Cmt' }).click(); await plan.getByRole('button', { name: 'Paz' }).click();
  await plan.getByRole('button', { name: 'Planı kaydet' }).click();
  await expect(page.getByRole('button', { name: 'Garson vardiya planı' })).toContainText('09:00–17:00 · her gün');

  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 });
  const owner = page;
  try {
    // The waiter's phone shows only "Vardiyayı başlat"; the server refuses actions too.
    await expect(waiter.getByRole('heading', { name: 'Vardiyayı başlat', level: 1 })).toBeVisible();
    await expect(waiter.locator('.sidebar')).toHaveCount(0);
    const refused = await waiter.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), tableId: 'table-2', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } });
    expect(refused.status()).toBe(403); expect((await refused.json()).code).toBe('SHIFT_REQUIRED');
    expect((await waiter.request.get('/api/staff/shifts/code')).status()).toBe(403);
    expect(await noSideScroll(waiter)).toBe(true); expect(await smallFields(waiter)).toEqual([]);
    await expect(waiter.getByRole('button', { name: 'QR okut' })).toHaveCount(0);
    await shot(waiter, 'vardiya-baslat.png', info.outputPath('vardiya-baslat.png'));

    // The counter: Masalar → "Vardiya kodu" shows the one-time code as QR and digits.
    await owner.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true }).click();
    await cashAction(owner, 'Vardiya kodu');
    const codeDialog = owner.getByRole('dialog', { name: 'Vardiya kodu' });
    await expect(codeDialog.getByAltText('Vardiya kodu QR')).toBeVisible();
    const first = await digits(owner);
    expect(first).toMatch(/^\d{6}$/);
    await shot(owner, 'vardiya-kodu.png', info.outputPath('vardiya-kodu.png'));

    // A wrong code is told, with the tries left; the right one starts the shift at once.
    const box = waiter.getByLabel('Vardiya kodu (6 hane)');
    await box.fill(first === '000000' ? '111111' : '000000');
    await expect(waiter.getByText(/Kod yanlış\. .*\(4 deneme kaldı\)/)).toBeVisible();
    await box.fill(first);
    await expect(waiter.getByRole('heading', { name: 'Vardiyayı başlat', level: 1 })).toHaveCount(0);
    await expect(waiter.getByRole('button', { name: /^Vardiyada/ })).toBeVisible();
    expect(await noSideScroll(waiter)).toBe(true);
    // The counter's code is replaced the moment it was used, and the waiter is listed as on shift.
    await expect.poll(() => digits(owner), { timeout: 10000 }).not.toBe(first);
    await expect(codeDialog).toContainText('Garson');
    const second = await digits(owner);
    const order = await waiter.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), tableId: 'table-2', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 } });
    expect(order.ok()).toBe(true);

    // Ending the shift takes the fresh code too; the old one no longer works.
    await waiter.getByRole('button', { name: /^Vardiyada/ }).click();
    const end = waiter.getByRole('dialog', { name: 'Vardiyayı bitir' });
    await end.getByLabel('Vardiya kodu (6 hane)').fill(first);
    await expect(end.getByText(/Kod yanlış/)).toBeVisible();
    await end.getByLabel('Vardiya kodu (6 hane)').fill(second);
    await expect(waiter.getByRole('heading', { name: 'Vardiyayı başlat', level: 1 })).toBeVisible();
    await codeDialog.getByRole('button', { name: 'Kapat' }).click();

    // Personel → Vardiya ve bahşiş → Vardiyalar (once Satış ve Raporlar → Personel ve bahşiş): the shift, its hours and the waiter's orders.
    await openReport(owner, 'Personel ve bahşiş');
    // Shifts belong to their cash day (05:00 to 05:00) while "Bugün" is the calendar day: between midnight and 05:00 a shift
    // started tonight is yesterday's. "7 gün" holds it at any hour the suite runs.
    await owner.getByRole('group', { name: 'Dönem' }).getByRole('button', { name: '7 gün', exact: true }).click();
    const row = owner.locator('tr.staff-line', { hasText: 'Garson' });
    await expect(row).toBeVisible();
    await expect(owner.locator('.cash-kpis')).toContainText('Çalışılan süre');
    await row.getByRole('button', { name: /Garson/ }).click();
    await expect(owner.locator('tr.staff-shifts')).toContainText('sa');
    await shot(owner, 'personel-rapor.png', info.outputPath('personel-rapor.png'), true);
    // The Bahşiş sub-tab: the rule and each one's share.
    await openStaff(owner, 'Vardiya ve bahşiş', 'Bahşiş');
    await expect(owner.locator('.cash-kpis')).toContainText('Çalışılan saate göre');
    await expect(owner.getByRole('region', { name: 'Bahşiş payları' })).toBeVisible();
    for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1280, 860]] as const) {
      await owner.setViewportSize({ width, height }); expect(await noSideScroll(owner), `report ${width}`).toBe(true);
    }
    await owner.setViewportSize({ width: 390, height: 844 });
    await shot(owner, 'personel-rapor-telefon.png', info.outputPath('personel-rapor-telefon.png'));
  } finally {
    // Off again for the other scenarios.
    await page.request.post('/api/staff/cash/settings', { data: { shiftTracking: false, tipRule: 'equal' } });
    await waiter.context().close();
  }
});

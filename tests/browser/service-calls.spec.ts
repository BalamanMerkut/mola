import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

test('guest calls the waiter; waiter sees it, answers once and the guest button resets', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const state = await (await page.request.get('/api/staff/state')).json();
  // A table nobody sits at ("Hesabı iste" belongs to an open bill), also when other suites shared this server before.
  const table = state.tables.find((t: any) => !t.account && !t.needsCleaning);
  const guest = await browser.newContext({ viewport: { width: 375, height: 812 } }), menu = await guest.newPage();
  await menu.goto(`/m/${table.token}`);
  await expect(menu.getByRole('button', { name: 'Hesabı iste' })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Garson çağır' }).click();
  // "Çağrıldı", not "geliyor": nobody has seen the call yet.
  await expect(menu.getByRole('button', { name: 'Garson çağrıldı' })).toBeDisabled();
  expect(await menu.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const staff = await browser.newContext(), waiter = await staff.newPage();
  await waiter.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } });
  await waiter.goto('/');
  const chip = waiter.locator('.service-call-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText(table.name);
  await expect(chip).toContainText('Garson çağırıyor');
  await waiter.getByRole('button', { name: `${table.name} çağrısını kapat` }).click();
  await expect(chip).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Garson çağır' })).toBeEnabled();
  await guest.close(); await staff.close();
});

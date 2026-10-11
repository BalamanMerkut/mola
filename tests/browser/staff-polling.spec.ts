import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

test('slow staff polling does not overlap and a late response cannot restore a logged-out session', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let captured = false, count = 0;
  await page.route('**/api/staff/state', async route => {
    count++;
    const response = await route.fetch();
    captured = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await expect.poll(() => captured).toBe(true);
    await page.waitForTimeout(2500);
    expect(count).toBe(1);
    await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
    const response = page.waitForResponse(r => r.url().endsWith('/api/staff/state'));
    release(); await response;
    await page.waitForTimeout(250);
    await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toHaveCount(0);
    await page.unroute('**/api/staff/state');
    await page.getByLabel('Kullanıcı adı', { exact: true }).fill('mutfak');
    await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
    await page.getByRole('button', { name: 'Çalışma alanını aç' }).click();
    await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
    // The kitchen account opens "Mutfak modu" (no sidebar, no user row): its own bar and board.
    await expect(page.locator('.kitchen-bar')).toContainText('Mutfak');
    await expect(page.locator('.kitchen-board')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Menü yönetimi', exact: true })).toHaveCount(0);
  } finally { release(); }
});

test('failed logout keeps the workspace available and can be retried', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
  await page.route('**/api/logout', route => route.abort());
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toHaveCount(0);
  await page.unroute('**/api/logout');
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
});

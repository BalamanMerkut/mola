import { test, expect } from '@playwright/test';
import { ADMIN_API, MERKEZ, merkezPassword } from './helpers';

// Mola Yönetim (on Mola Merkez) polls its state like the old Ana panel did.
test('late Mola Yönetim polling does not overlap and a late response cannot restore a logged-out session', async ({ page }) => {
  await page.request.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword() } });
  await page.goto(`${MERKEZ}/`);
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let captured = false, count = 0;
  await page.route('**/api/merkez/admin/state', async route => {
    count++;
    const response = await route.fetch();
    captured = true;
    await gate;
    await route.fulfill({ response });
  });
  try {
    await expect.poll(() => captured, { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(2500);
    expect(count).toBe(1);
    await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
    const response = page.waitForResponse(r => r.url().endsWith('/api/merkez/admin/state'));
    release(); await response;
    await page.waitForTimeout(250);
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toHaveCount(0);
    await page.unroute('**/api/merkez/admin/state');
    await page.getByLabel('Şifre', { exact: true }).fill(merkezPassword());
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bugün yapılacaklar' })).toBeVisible();
  } finally { release(); }
});

test('failed logout keeps the workspace available and can be retried', async ({ page }) => {
  await page.request.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword() } });
  await page.goto(`${MERKEZ}/`);
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
  await page.route('**/api/merkez/admin/logout', route => route.abort());
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toHaveCount(0);
  await page.unroute('**/api/merkez/admin/logout');
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
});

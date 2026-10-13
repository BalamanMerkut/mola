import { test, expect } from '@playwright/test';
import { MERKEZ } from './helpers';

/*
 * After an update the open pages reload themselves (src/versionReload.ts): only at a quiet moment (30 s without a tap or key,
 * no field in use, no window open), once per version in a tab. The server's newer version is faked here.
 */
test('café: a newer server version reloads the page once it is quiet; never while a field is in use; once only', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/health', async route => { const r = await route.fetch(); route.fulfill({ response: r, json: { ...(await r.json()), version: '9.9.9' } }); });
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto('/');
  const user = page.getByLabel('Kullanıcı adı');
  await expect(user).toBeVisible();
  // Typing in a field: no reload however long it takes.
  await user.click(); await user.fill('yarim');
  await page.clock.runFor(90_000);
  expect(loads).toBe(1);
  await expect(user).toHaveValue('yarim');
  // Field left, nobody touches anything for 30 s: one reload, fetched fresh.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.clock.runFor(40_000);
  await expect.poll(() => loads).toBe(2);
  await expect(page.getByLabel('Kullanıcı adı')).toBeVisible();
  // The server still says 9.9.9 after the reload (an old copy came back): it does not try again in this tab.
  await page.clock.runFor(300_000);
  expect(loads).toBe(2);
});

test('Mola Yönetim: the sign-in page reloads after a Merkez update the same way', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/merkez/v1/health', async route => { const r = await route.fetch(); route.fulfill({ response: r, json: { ...(await r.json()), version: '9.9.9' } }); });
  let loads = 0;
  page.on('load', () => { loads++; });
  await page.goto(`${MERKEZ}/`);
  await expect(page.getByLabel('Şifre', { exact: true })).toBeVisible();
  await page.clock.runFor(40_000);
  await expect.poll(() => loads).toBe(2);
});

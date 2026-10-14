import { test, expect } from '@playwright/test';
import { ensureSetup, MERKEZ } from './helpers';

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
  // The version line offers the newer version at once (should the page never reload by itself).
  await expect(page.getByTestId('app-version').first()).toContainText('Yeni sürüm (9.9.9) yüklendi');
  // The field emptied but still holding the focus (14 Ekim: a search box clicked once held the reload back for good):
  // nobody touches anything for 30 s, one reload, fetched fresh.
  await user.fill('');
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

test('update window: "Şimdi güncelle" counts up while Mola restarts, reaches 100 % when the new version answers, then reloads', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const current = JSON.parse(readFileSync('package.json', 'utf8')).version as string, next = '9.9.9';
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  let installed = false, restartedAt = 0;
  await page.route('**/api/staff/update', r => r.fulfill({ json: { current, state: 'ready', version: next, notes: 'Hesap ekranı yenilendi.', error: null, from: null, seen: false, progress: null, idleInstall: true, idleMinutes: 15, canInstallNow: true, openAccounts: 0, pendingOrders: 0, restartable: true } }));
  await page.route('**/api/staff/update/install', r => { installed = true; restartedAt = Date.now(); return r.fulfill({ json: { ok: true, restarting: true } }); });
  // While "restarting" (4 s) the server does not answer; then it answers with the new version.
  await page.route('**/api/health', async r => {
    if (!installed) return r.fallback();
    if (Date.now() - restartedAt < 4000) return r.abort('connectionrefused');
    const res = await r.fetch(); return r.fulfill({ response: res, json: { ...(await res.json()), version: next } });
  });
  let loads = 0; page.on('load', () => { loads++; });
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: `Mola ${next} hazır` });
  await expect(dialog).toContainText('Hesap ekranı yenilendi.');
  await dialog.getByRole('button', { name: 'Şimdi güncelle' }).click();
  const percent = dialog.getByTestId('update-percent');
  await expect(percent).toHaveText('%100', { timeout: 15000 });
  await expect(dialog).toContainText('Güncellendi. Sayfa yenileniyor');
  await expect.poll(() => loads, { timeout: 10000 }).toBe(2);
});

import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

test('kitchen wake lock handles release, retry, navigation and mobile layout', async ({ page }, info) => {
  await page.addInitScript(() => {
    const state = { requests: 0, releases: 0, fail: false, current: null as any };
    (window as any).__wake = state;
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      state.requests++; if (state.fail) throw new Error('denied');
      const sentinel = new EventTarget() as any; sentinel.released = false;
      sentinel.release = async () => { if (!sentinel.released) { sentinel.released = true; state.releases++; sentinel.dispatchEvent(new Event('release')); } };
      state.current = sentinel; return sentinel;
    } } });
  });
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('.kitchen-tools .sound-icon')).toHaveCount(2);
  for (const title of ['Ekranı açık tut hakkında bilgi', 'Sipariş sesi hakkında bilgi']) {
    await page.getByRole('button', { name: title }).click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: info.outputPath('kitchen-controls-mobile.png') });
  const button = page.getByRole('button', { name: 'Ekranı açık tut', exact: true });
  // On by default: the kitchen screen stays awake without anyone tapping.
  await expect(page.getByRole('button', { name: 'Ekranı açık tutmayı kapat' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => (window as any).__wake.current.release());
  await expect(page.locator('.kitchen-awake [role=status]')).toHaveText('Durakladı; yeniden açabilirsiniz.');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Ekranı açık tutmayı kapat' })).toBeVisible();
  await page.getByRole('button', { name: 'Ekranı açık tutmayı kapat' }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { (window as any).__wake.fail = true; });
  await button.click(); await expect(page.locator('.kitchen-awake [role=status]')).toHaveText('Etkinleşmedi; tekrar deneyin.');
  await page.evaluate(() => { (window as any).__wake.fail = false; });
  await button.click(); await expect(page.getByRole('button', { name: 'Ekranı açık tutmayı kapat' })).toBeVisible();
  // The tablet stays awake on the kitchen's other views (Stok, Hesabım); only signing out lets it sleep.
  await page.getByRole('button', { name: 'Hesabım', exact: true }).click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__wake.current.released)).toBe(false);
  await page.locator('.account-logout').getByRole('button', { name: 'Çıkış yap' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__wake.current.released)).toBe(true);
});

test('unsupported browsers show an honest disabled control', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'wakeLock', { value: undefined }));
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ekranı açık tut', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Ekranı açık tut hakkında bilgi' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Bu bağlantı veya tarayıcı desteklemiyor.');
});

test('late wake lock responses cannot reactivate a cancelled request or leak after leaving kitchen', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { resolve: null as any, releases: 0 };
    (window as any).__lateWake = state;
    Object.defineProperty(navigator, 'wakeLock', { value: { request: () => new Promise(resolve => {
      state.resolve = () => {
        const sentinel = new EventTarget() as any; sentinel.released = false;
        sentinel.release = async () => { if (!sentinel.released) { sentinel.released = true; state.releases++; sentinel.dispatchEvent(new Event('release')); } };
        resolve(sentinel);
      };
    }) } });
  });
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await page.goto('/');
  // The default-on request is already pending here.
  await page.getByRole('button', { name: 'Ekranı açık tutma isteğini iptal et' }).click();
  await expect(page.locator('.kitchen-awake [role=status]')).toHaveText('Şu anda kapalı.');
  await page.evaluate(() => (window as any).__lateWake.resolve());
  await expect.poll(() => page.evaluate(() => (window as any).__lateWake.releases)).toBe(1);
  await expect(page.getByRole('button', { name: 'Ekranı açık tut', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Ekranı açık tut', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ekranı açık tutma isteğini iptal et' })).toBeVisible();
  // Leaving the kitchen (signing out) while the request is still pending: the late answer is released at once.
  await page.getByRole('button', { name: 'Hesabım', exact: true }).click();
  await page.locator('.account-logout').getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
  await page.evaluate(() => (window as any).__lateWake.resolve());
  await expect.poll(() => page.evaluate(() => (window as any).__lateWake.releases)).toBe(2);
});


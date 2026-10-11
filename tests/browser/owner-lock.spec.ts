import { test, expect } from '@playwright/test';
import { ensureSetup, openSettings, openView } from './helpers';

/*
 * Sahip hesabı otomatik kilit (server/owner-lock.ts, src/OwnerLock.tsx). The idle timing itself is the server's (its clock,
 * requests marked by a real tap): tests/owner-lock.test.ts moves that clock. Here: the setting in Ayarlar (5 / 10 / 30 /
 * Kapalı), a session the server locked shows the lock screen within one poll, polling (page.clock moved on) neither unlocks
 * it nor stops it, owner data answers 423 meanwhile, a wrong password is refused, the right one brings back the page exactly
 * as it was (a half-typed field included), and "Kilitle" locks at once.
 */
const PASSWORD = 'MolaDemo!2026';

test('Sahip hesabı kilidi: Ayarlar, kilit ekranı, yoklama kilidi açmaz, şifreyle açılır, Kilitle', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const page = await cafe.newPage();
    await page.clock.install();
    await page.goto('/');

    // Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme: 5 / 10 / 30 dakika / Kapalı (default 10).
    await openSettings(page, 'Kilit ve güncelleme');
    const card = page.locator('.owner-lock-settings');
    const select = card.getByLabel('Kullanılmazsa kilitle');
    await expect(select).toHaveValue('10');
    expect(await select.locator('option').allTextContents()).toEqual(['5 dakika', '10 dakika', '30 dakika', 'Kapalı']);
    await select.selectOption({ label: 'Kapalı' });
    await expect(card.getByText('Kapalı · ekran kendiliğinden kilitlenmez.')).toBeVisible();
    expect((await (await cafe.request.get('/api/staff/lock')).json()).minutes).toBe(0);
    await select.selectOption({ label: '5 dakika' });
    await expect(card.getByText('5 dakika işlem yapılmazsa ekran kilitlenir.')).toBeVisible();
    await page.screenshot({ path: info.outputPath('ayarlar-sahip-kilidi.png'), fullPage: true });

    // A half-typed field on the page (Hesabım): it must survive the lock.
    await openView(page, 'Hesabım');
    await page.getByLabel('Yeni şifre', { exact: true }).fill('yarim-kalan-taslak');

    // The server locks this session (as the idle timer does): the open page shows the lock screen within one poll.
    expect((await cafe.request.post('/api/staff/lock', { data: {} })).ok()).toBe(true);
    await page.clock.fastForward(3000);
    const lock = page.getByRole('dialog', { name: 'Sahip hesabı kilitlendi' });
    await expect(lock).toBeVisible();
    await expect(lock).toContainText('Devam etmek için şifrenizi girin.');
    await expect(page.locator('.workspace')).toHaveAttribute('inert', '');
    await page.screenshot({ path: info.outputPath('sahip-kilit-ekrani.png'), fullPage: true });

    // Owner data is refused on the server meanwhile; the floor's polling goes on and does not unlock.
    const users = await cafe.request.get('/api/staff/users');
    expect(users.status()).toBe(423); expect((await users.json()).code).toBe('SESSION_LOCKED');
    const [polled] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/staff/state') && r.request().method() === 'GET'), page.clock.fastForward(60_000)]);
    expect(polled.headers()['x-mola-locked']).toBe('1');
    await page.clock.fastForward(60_000);
    await expect(lock).toBeVisible();
    expect((await cafe.request.get('/api/staff/users')).status()).toBe(423);

    // A wrong password: refused, still locked. The right one: the page exactly as it was.
    await lock.getByLabel('Şifreniz').fill('yanlis-sifre');
    await lock.getByRole('button', { name: 'Kilidi aç' }).click();
    await expect(lock.getByText(/^Şifre yanlış/)).toBeVisible();
    await expect(lock.getByLabel('Şifreniz')).toHaveValue('');
    await lock.getByLabel('Şifreniz').fill(PASSWORD);
    await lock.getByRole('button', { name: 'Kilidi aç' }).click();
    await expect(lock).toHaveCount(0);
    await expect(page.locator('.workspace')).not.toHaveAttribute('inert', '');
    await expect(page.getByLabel('Yeni şifre', { exact: true })).toHaveValue('yarim-kalan-taslak');
    expect((await cafe.request.get('/api/staff/users')).status()).toBe(200);

    // "Kilitle" (beside Çıkış yap): at once.
    await page.getByRole('button', { name: 'Kilitle', exact: true }).first().click();
    await expect(lock).toBeVisible();
    expect((await cafe.request.get('/api/staff/users')).status()).toBe(423);
    await lock.getByLabel('Şifreniz').fill(PASSWORD);
    await lock.getByRole('button', { name: 'Kilidi aç' }).click();
    await expect(lock).toHaveCount(0);
  } finally {
    // The shared test server keeps the default for the other suites.
    await cafe.request.post('/api/staff/unlock', { data: { password: PASSWORD } }).catch(() => {});
    await cafe.request.post('/api/staff/lock/settings', { data: { minutes: 10 }, headers: { 'X-Mola-Activity': '1' } }).catch(() => {});
    await cafe.close();
  }
});

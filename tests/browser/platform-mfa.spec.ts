import { test, expect } from '@playwright/test';
import { totp } from '../../server/totp';
import { MERKEZ, merkezPassword, yonetimSettings, yonetimShot } from './helpers';

test('admin saves recovery codes before enabling MFA and recovers a lost enable response on mobile', async ({ page }) => {
  const password = merkezPassword();
  await page.goto(`${MERKEZ}/`); await page.getByLabel('Şifre', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await yonetimSettings(page, 'Hesap güvenliği');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Güvenlik ayarı için yönetici şifresi').fill(password);
  const pending = page.waitForResponse('**/api/merkez/admin/mfa/setup');
  await page.getByRole('button', { name: 'Authenticator kurulumunu başlat' }).click();
  const setup = await (await pending).json();
  await expect(page.getByLabel('Yönetim kurtarma kodları')).toHaveValue(setup.recoveryCodes.join('\n'));
  const enable = page.getByRole('button', { name: 'İki adımlı girişi etkinleştir' });
  await page.getByLabel('3. Altı haneli doğrulama kodu').fill(totp(setup.secret, Date.now()));
  await expect(enable).toBeDisabled();
  await page.getByLabel('Kurtarma kodlarını güvenli bir yerde sakladım').check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // A typo: a definite answer, said as it is (no "sonucu belirsizse"); the right code right after it is not refused.
  await page.getByLabel('3. Altı haneli doğrulama kodu').fill(totp(setup.secret, Date.now()) === '000000' ? '111111' : '000000');
  await enable.click();
  await expect(page.locator('.notice-error')).toHaveText('Doğrulama kodu geçersiz.');
  await page.getByLabel('3. Altı haneli doğrulama kodu').fill(totp(setup.secret, Date.now()));
  await page.route('**/api/merkez/admin/mfa/enable', async route => { await route.fetch(); await route.abort('failed'); await page.unroute('**/api/merkez/admin/mfa/enable'); });
  // The answer is lost on the way back: only now the "check again" hint.
  await enable.click(); await expect(page.getByText(/İşlem sonucu belirsizse/)).toBeVisible();
  await page.reload();
  await page.getByLabel('Şifre', { exact: true }).fill(password);
  await expect(page.getByLabel('Authenticator veya kurtarma kodu', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  // The factor step stays in the same login card.
  await expect(page.locator('.auth-card').getByRole('heading', { name: 'Girişinizi doğrulayın' })).toBeVisible();
  await yonetimShot(page, 'telefon-giris-dogrulama.png', test.info().outputPath('factor-mobile.png'));
  await page.getByLabel('Authenticator veya kurtarma kodu', { exact: true }).fill(setup.recoveryCodes[0]);
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
  await yonetimSettings(page, 'Hesap güvenliği');
  await expect(page.getByText('Koruma açık. 7 kurtarma kodu kaldı.')).toBeVisible();
  await page.getByLabel('Güvenlik ayarı için yönetici şifresi').fill(password);
  await page.getByLabel('Authenticator veya kullanılmamış kurtarma kodu').fill(setup.recoveryCodes[1]);
  await page.getByRole('button', { name: 'İki adımlı girişi kapat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
});


test('owner sees factor step only after correct credentials and recovery opens workspace', async ({ page }) => {
 await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
 const setup = await (await page.request.post('/api/staff/report-security/setup', { data: { password: 'MolaDemo!2026' } })).json();
 const enabled = await (await page.request.post('/api/staff/report-security/enable', { data: { code: totp(setup.secret, Date.now()) } })).json();
 expect((await page.request.post('/api/logout', { data: {} })).ok()).toBe(true);
 await page.goto('/');
 await expect(page.getByLabel('Authenticator veya kurtarma kodu', { exact: true })).toHaveCount(0);
 // An installed café (the test server) fills in no demo account.
 await page.getByLabel('Kullanıcı adı', { exact: true }).fill('isletme');
 await page.getByLabel('Şifre', { exact: true }).fill('wrong');
 await page.getByRole('button', { name: 'Çalışma alanını aç' }).click();
 await expect(page.getByText('Kullanıcı adı veya şifre yanlış.', { exact: true })).toBeVisible();
 await expect(page.getByLabel('Authenticator veya kurtarma kodu', { exact: true })).toHaveCount(0);
 await page.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
 await page.getByRole('button', { name: 'Çalışma alanını aç' }).click();
 await expect(page.getByLabel('Authenticator veya kurtarma kodu', { exact: true })).toBeFocused();
 expect((await page.request.get('/api/staff/state')).status()).toBe(401);
 await page.getByLabel('Authenticator veya kurtarma kodu', { exact: true }).fill('wrong');
 await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
 await expect(page.getByText(/Kod yanlış, kullanılmış/)).toBeVisible();
 await page.getByLabel('Authenticator veya kurtarma kodu', { exact: true }).fill(enabled.recoveryCodes[0]);
 await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
 await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
});

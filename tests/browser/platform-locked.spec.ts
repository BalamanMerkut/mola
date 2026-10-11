import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { merkezPort, yonetimShot } from './helpers';
import { scenario } from './protected-server';

/*
 * The installed Mola Yönetim locks its data key to the Windows user (MERKEZ_KEY_PROTECTION=1) once the Merkez recovery code
 * is saved. Its own Merkez (port 3194 / E2E_MERKEZ_PORT+4) with a test lock instead of DPAPI (scripts/merkez-test-protected.ts):
 * MOLA_TEST_OS_USER is "the Windows user"; another name = a reset Windows password or a new computer.
 */
test('Mola Yönetim key protection: "Önce kurtarma kodunuzu kaydedin", the key locked at the next start, another Windows user gets the unlock screen and the recovery code opens it', async ({ page }) => {
  test.setTimeout(180_000);
  const port = merkezPort(4), root = scenario('merkez-kilit'), data = join(root, 'veri'), base = `http://127.0.0.1:${port}`, password = 'Kilitli-Mavi-Kapi-58';
  let child: ChildProcess | undefined;
  async function start(user: string) {
    child = spawn(process.execPath, ['--import', 'tsx', 'scripts/merkez-test-protected.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(port), MERKEZ_DATA_DIR: data, MOLA_TEST_OS_USER: user, MOLA_AUTO_BACKUP: '0', MOLA_MODE: 'installed', MERKEZ_INITIAL_PASSWORD: password } });
    for (let i = 0; ; i++) {
      try { const r = await fetch(`${base}/api/merkez/v1/health`); if (r.ok) return (await r.json()) as { locked?: boolean }; } catch { /* starting */ }
      if (i > 240 || child.exitCode !== null) throw new Error('Korumalı test Merkezi açılmadı.');
      await new Promise(r => setTimeout(r, 125));
    }
  }
  async function stop() { if (!child || child.exitCode !== null) return; const exited = new Promise(done => child!.once('exit', done)); child.kill(); await exited; }
  const api = async (path: string, body?: unknown, cookie = '') => {
    const r = await fetch(`${base}/api/merkez/admin${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), data: await r.json().catch(() => ({})) as Record<string, any> };
  };
  try {
    // 1. First start: the key is still a plain file; the code is not saved yet, so the card asks for it first (skippable).
    expect((await start('satici')).locked).toBeUndefined();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/`);
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    const card = page.getByRole('dialog', { name: 'Önce kurtarma kodunuzu kaydedin' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Windows kullanıcısına kilitleyecek');
    await yonetimShot(page, 'anahtar-once-kod.png', test.info().outputPath('card.png'));
    await card.getByRole('button', { name: 'Kurtarma koduna git' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Yedek' })).toBeVisible();
    await expect(page.getByTestId('merkez-key-protection')).toContainText('Önce kurtarma kodunu kaydedin');
    // Ayarlar → Yedek: show the code, "Kodu kaydettim"; the key is locked at the next start.
    await page.getByRole('button', { name: 'Kurtarma kodunu göster' }).click();
    const code = (await page.getByTestId('merkez-recovery-code').locator('span').allInnerTexts()).join('-');
    expect(code).toMatch(/^([A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);
    await page.getByRole('button', { name: 'Kodu kaydettim' }).click();
    await expect(page.getByTestId('merkez-key-protection')).toContainText('bir sonraki açılışında');
    expect(existsSync(join(data, 'development.key'))).toBe(true);
    // 2. The next start (same Windows user): migrated; the start after it removes the plain copy.
    await stop(); await start('satici');
    expect(existsSync(join(data, 'anahtar.json'))).toBe(true); expect(existsSync(join(data, 'development.key'))).toBe(false);
    await page.reload();
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await page.getByRole('button', { name: 'Ayarlar' }).click();
    await page.getByRole('button', { name: 'Yedek', exact: true }).click();
    await expect(page.getByTestId('merkez-key-protection')).toContainText('bu Windows kullanıcısına');
    await expect(page.getByRole('dialog', { name: 'Önce kurtarma kodunuzu kaydedin' })).toHaveCount(0);
    await yonetimShot(page, 'anahtar-korumada.png', test.info().outputPath('protected.png'));
    await stop(); await start('satici');
    expect(existsSync(join(data, 'development.key.tasindi'))).toBe(false);
    await stop();
    // 3. Another Windows user (a reset Windows password, a new computer): Merkez starts locked; only the unlock screen.
    expect((await start('yeni-kullanici')).locked).toBe(true);
    expect((await api('/state')).status).toBe(423);
    await page.goto(`${base}/`);
    await expect(page.getByRole('heading', { name: 'Veriler kilitli' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toHaveCount(0);
    await yonetimShot(page, 'veriler-kilitli.png', test.info().outputPath('locked.png'));
    await page.getByLabel('Merkez kurtarma kodu').fill('2222-3333-4444-5555-6666-7777');
    await page.getByRole('button', { name: 'Kilidi aç' }).click();
    await expect(page.locator('.notice-error')).toContainText('Kurtarma kodu yanlış');
    await page.getByLabel('Merkez kurtarma kodu').fill(code.toLowerCase());
    await page.getByRole('button', { name: 'Kilidi aç' }).click();
    // The full Mola Yönetim starts in the same process; the page comes back as the login.
    await expect(page.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' })).toBeVisible();
    // On a phone the locked screen fits too (checked on the next locked start below).
    await stop();
    // 4. Locked again for the new user: it opens without the code; the old user is the one locked out now.
    expect((await start('yeni-kullanici')).locked).toBeUndefined();
    await stop();
    expect((await start('satici')).locked).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/`);
    await expect(page.getByRole('heading', { name: 'Veriler kilitli' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await stop(); }
});

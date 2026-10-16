import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { merkezPort } from './helpers';
import { scenario } from './protected-server';

/*
 * Kafemi yönet'in kendi adresi (MERKEZ_OWNER_ORIGIN, server/merkez/owner-host.ts; https://kafem.molayazilim.com.tr on the VDS):
 * its own Mola Merkez (port 3197 / E2E_MERKEZ_PORT+7) with the owner's page on kafem.localhost (the browser resolves
 * *.localhost to this computer; Node on this machine does not, so every check of that name goes through the browser). The
 * page's calls go to its own name and are answered; Merkez's own name has no owner's page.
 */
test('Kafemi yönet on its own name: the sign-in there, the page talks to its own name; nothing else there, no owner’s page on Merkez’s name', async ({ page }) => {
  test.setTimeout(90_000);
  const port = merkezPort(7), root = scenario('kafem'), merkez = `http://127.0.0.1:${port}`, kafem = `http://kafem.localhost:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(port), MERKEZ_DATA_DIR: join(root, 'merkez'), SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MOLA_TEST_TUNNEL: '1', MERKEZ_OWNER_ORIGIN: kafem } });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(`${merkez}/api/merkez/v1/health`)).ok) break; } catch { /* starting */ } if (i > 160) throw new Error('Merkez açılmadı.'); await new Promise(r => setTimeout(r, 125)); }
    // The sign-in at the root of its own name; a typed /raporlarım there comes back to the root.
    for (const path of ['/', '/raporlar%C4%B1m']) {
      await page.goto(`${kafem}${path}`);
      await expect(page).toHaveURL(`${kafem}/`);
      await expect(page).toHaveTitle('Kafemi yönet · Mola');
      await expect(page.getByRole('form', { name: 'Giriş yap' })).toBeVisible();
    }
    // The page's own calls go to its own name (same origin, its Origin accepted): an unknown e-mail gets the plain refusal.
    const calls: string[] = [];
    page.on('request', r => { if (r.url().includes('/api/')) calls.push(r.url()); });
    const form = page.getByRole('form', { name: 'Giriş yap' });
    await form.getByLabel('E-posta').fill('kimse@example.com');
    await form.getByLabel('Şifre', { exact: true }).fill('Bir-Sifre-2026');
    await form.getByRole('button', { name: 'Devam' }).click();
    await expect(page.getByText(/E-posta ya da şifre hatalı/)).toBeVisible();
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) expect(url.startsWith(`${kafem}/api/merkez/v1/phone/`), url).toBe(true);
    // /yonet on its own name: back to "/"; Mola Yönetim and the other pages are not there; Mola Yönetim stays on Merkez's name.
    await page.goto(`${kafem}/yonet`); await expect(page).toHaveURL(`${kafem}/`);
    for (const path of ['/merkez.html', '/api/merkez/admin/state', '/q/AAAAAAAAAA/x']) expect((await page.goto(`${kafem}${path}`))!.status(), path).toBe(404);
    await page.goto(`${merkez}/`); await expect(page).toHaveTitle('Mola Yönetim');
    // Merkez's own name has no owner's page: the plain 404 page, its one link to Kafemi yönet on its own name.
    expect((await page.goto(`${merkez}/yonet`))!.status()).toBe(404);
    await page.getByRole('link', { name: 'Kafemi yönet’e git' }).click();
    await expect(page).toHaveURL(`${kafem}/`); await expect(page.getByRole('form', { name: 'Giriş yap' })).toBeVisible();
  } finally { child.kill(); await exited; }
});

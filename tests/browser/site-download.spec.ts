import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { MERKEZ } from './helpers';

/*
 * molayazilim.com.tr → "Uygulamayı indir" (/indir/): built from site/config.json → downloads (scripts/site-build.ts). Until
 * downloads.enabled is true every platform says "Yakında"; with it, each card links its file under /indir/ with size and
 * SHA-256. Two builds in scratch folders (never site/dist): today's config, and a fake one turned on with small files.
 * Ports: E2E_PORT + 41 and + 42.
 */
const BASE = Number(process.env.E2E_PORT ?? 3100), SOON = `http://127.0.0.1:${BASE + 41}`, OPEN = `http://127.0.0.1:${BASE + 42}`;
// Made in beforeAll: Playwright also loads this file once to list the tests, and that must leave nothing behind.
let scratch = '';
const servers: ChildProcess[] = [];
async function serve(port: number, dist: string, config: string) {
  const server = spawn(process.execPath, ['--import', 'tsx', 'scripts/site-dev.ts', '--port', String(port), '--merkez', MERKEZ, '--no-watch', '--dist', dist, '--config', config], { stdio: ['ignore', 'ignore', 'inherit'] });
  servers.push(server);
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/indir/`)).ok) return; } catch { /* building */ }
    if (i > 400 || server.exitCode !== null) throw new Error('Web sitesi açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
}
const fake = { windows: 'Mola-Windows-0.1.0.zip', 'macos-arm64': 'Mola-macOS-AppleSilicon-0.1.0.tar.gz', 'macos-x64': 'Mola-macOS-Intel-0.1.0.tar.gz', 'linux-x64': 'Mola-Linux-x64-0.1.0.tar.gz', android: 'Mola-Android-0.1.0.apk' };
test.beforeAll(async () => {
  test.setTimeout(180000);
  mkdirSync('.local/e2e', { recursive: true }); scratch = mkdtempSync(resolve('.local/e2e/site-indir-'));
  // The "Yakında" build turns downloads off itself: the real config has them on since the VDS (12 Ekim).
  const config = JSON.parse(readFileSync('site/config.json', 'utf8'));
  const soonConfig = join(scratch, 'config-yakinda.json'); writeFileSync(soonConfig, JSON.stringify({ ...config, downloads: { enabled: false, version: '', files: {} } }));
  const openDist = join(scratch, 'acik'); mkdirSync(join(openDist, 'indir'), { recursive: true });
  const files: Record<string, { file: string; size: number; sha256: string }> = {};
  for (const [p, file] of Object.entries(fake)) {
    const data = Buffer.alloc(3 * 1048576, p); writeFileSync(join(openDist, 'indir', file), data);
    files[p] = { file, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  const openConfig = join(scratch, 'config-acik.json');
  writeFileSync(openConfig, JSON.stringify({ ...config, downloads: { enabled: true, version: '0.1.0', files } }));
  await Promise.all([serve(BASE + 41, join(scratch, 'yakinda'), soonConfig), serve(BASE + 42, openDist, openConfig)]);
});
test.afterAll(() => { for (const s of servers) if (s.exitCode === null) s.kill(); if (scratch) rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); });

test('Uygulamayı indir: every platform says "Yakında" until downloads.enabled; steps, phone notes and the SmartScreen note; fits a phone', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${SOON}/`);
  // In the menu and as a button on the home page.
  await page.locator('.main-nav').getByRole('link', { name: 'Uygulamayı indir' }).click();
  await expect(page).toHaveURL(`${SOON}/indir/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Mola’yı kafenizin bilgisayarına kurun' })).toBeVisible();
  await expect(page.locator('.main-nav a[aria-current="page"]')).toHaveText('Uygulamayı indir');
  const cards = page.locator('.dl-card');
  await expect(cards).toHaveCount(5);
  await expect(cards.locator('h3')).toHaveText(['Windows 10 / 11', 'Mac · Apple Silicon', 'Mac · Intel', 'Linux', 'Android · personel']);
  for (const card of await cards.all()) await expect(card.locator('.dl-soon')).toHaveText('Yakında');
  await expect(page.locator('a[download]')).toHaveCount(0);
  await expect(page.locator('.dl-notes')).toContainText('Android telefon ve tablet');
  await expect(page.locator('.dl-notes')).toContainText('“Kafe içi cihazlar” düğmesine');
  await expect(page.locator('.dl-notes')).toContainText('“Ana Ekrana Ekle”');
  await expect(page.locator('.dl-warn')).toContainText('“Ek bilgi”');
  await expect(page.locator('.dl-warn')).toContainText('“Yine de çalıştır”');
  const steps = page.locator('.minute article');
  await expect(steps.locator('h3')).toHaveText(['İndirin ve kurun', 'Başvuru yapın', 'Mola ekibi onaylar', '30 gün ücretsiz deneme']);
  await expect(steps.nth(1)).toContainText('“Kodum yok, başvuru yapacağım”'); await expect(steps.nth(1)).toContainText('“Etkinleştirme kodum var”');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('seen')));
  await page.waitForTimeout(800);
  await page.screenshot({ path: info.outputPath('indir.png'), fullPage: true });
  if (process.env.SITE_EKRAN) { mkdirSync(process.env.SITE_EKRAN, { recursive: true }); await page.screenshot({ path: join(process.env.SITE_EKRAN, 'indir.png'), fullPage: true }); }
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Uygulamayı indir with downloads.enabled: each card links its file under /indir/ with its size and SHA-256', async ({ page }) => {
  await page.goto(`${OPEN}/indir/`);
  await expect(page.locator('.dl-soon')).toHaveCount(0);
  const windows = page.locator('.dl-card[data-platform="windows"]');
  const link = windows.getByRole('link', { name: 'İndir' });
  await expect(link).toHaveAttribute('href', '/indir/Mola-Windows-0.1.0.zip');
  await expect(windows.locator('.dl-meta')).toHaveText('Mola-Windows-0.1.0.zip · 3 MB');
  await expect(windows).toContainText('Mola Kurulum.exe');
  await windows.locator('.dl-sum summary').click();
  await expect(windows.locator('.dl-sum code')).toHaveText(createHash('sha256').update(Buffer.alloc(3 * 1048576, 'windows')).digest('hex'));
  for (const [p, file] of Object.entries(fake)) {
    await expect(page.locator(`.dl-card[data-platform="${p}"] a[download]`)).toHaveAttribute('href', `/indir/${file}`);
    const r = await page.request.get(`${OPEN}/indir/${file}`);
    expect(r.status()).toBe(200); expect((await r.body()).length).toBe(3 * 1048576);
  }
  expect((await page.request.head(`${OPEN}/indir/Mola-Windows-0.1.0.zip`)).headers()['content-type']).toBe('application/zip');
});

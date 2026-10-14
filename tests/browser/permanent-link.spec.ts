import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { e2eRun, ensureSetup, openSettings } from './helpers';

// Kalıcı bağlantı (src/PermanentLink.tsx): the business's permanent Merkez link to the café computer, in the desktop window's
// Tabletler and in Ayarlar → Cihazlar. The test server has no Merkez link, so the answers are given here.
const URL = 'https://merkez.example.com/k/Ab3dEf7hJk';
const LINE = 'Laptop ve telefonlar için: modem adresi değiştirse de çalışır. İşletmenin Wi-Fi\'sinde kasa bilgisayarını açar.';

test('Tabletler: the permanent link with Kopyala under the QR; "birkaç dakika içinde" while it is on its way', async ({ page }) => {
  const key = readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
  await page.addInitScript(() => { sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); });
  let link: unknown = { url: URL };
  await page.route('**/api/desktop/status', route => route.fulfill({ json: { ok: true, lan: true, addresses: [{ name: 'Ethernet', origin: 'http://192.168.1.20:3000' }], backup: { enabled: false }, link } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/#masaustu=${key}`);
  const open = async () => { await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: /Tabletler/ }).click(); return page.getByRole('dialog', { name: 'Tabletler' }); };
  let dialog = await open();
  const block = dialog.getByTestId('permanent-link');
  await expect(block).toContainText('Kalıcı bağlantı');
  await expect(block.locator('code')).toHaveText(URL);
  await expect(block).toContainText(LINE);
  await block.getByRole('button', { name: 'Kopyala' }).click();
  await expect(block.getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
  await expect(dialog.locator('.desktop-address')).toContainText('192.168.1.20:3000/uygulama');
  // The palette's own surfaces (dark themes included), never a fixed white.
  expect(await block.evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await page.evaluate(() => { const p = document.createElement('div'); p.style.background = 'var(--paper)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }));
  await page.keyboard.press('Escape');
  // Not there yet (the next heartbeat brings it): a quiet line, no Kopyala.
  link = { problem: 'waiting' };
  await page.reload();
  dialog = await open();
  await expect(dialog.getByTestId('permanent-link')).toHaveText('Kalıcı bağlantı birkaç dakika içinde hazır olur.');
  await expect(dialog.getByRole('button', { name: 'Kopyala' })).toHaveCount(0);
});

test('Ayarlar → Cihazlar: the owner sees the permanent link with Kopyala; nothing when Mola is closed to the network', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  let body: Record<string, unknown> = { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], link: { url: URL } };
  await page.route('**/api/staff/network', route => route.fulfill({ json: body }));
  await page.goto('/');
  await openSettings(page, 'Cihazlar');
  const card = page.locator('.connect-tablet'), block = card.getByTestId('permanent-link');
  await expect(block.locator('code')).toHaveText(URL);
  await expect(block).toContainText(LINE);
  await block.getByRole('button', { name: 'Kopyala' }).click();
  await expect(block.getByRole('button', { name: 'Kopyalandı' })).toBeVisible();
  await expect(card.locator('.connect-tablet-address code')).toHaveText('192.168.1.20:3000/uygulama');
  body = { lan: false, addresses: [], link: { problem: 'off' } };
  await page.reload();
  await openSettings(page, 'Cihazlar');
  await expect(page.locator('.connect-tablet')).toContainText('Mola şu anda yalnız bu bilgisayara açık');
  await expect(page.getByTestId('permanent-link')).toHaveCount(0);
});

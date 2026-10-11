import { test, expect } from '@playwright/test';
import { ensureSetup } from './helpers';

test('returning to kitchen resumes suspended sound without a test chime and respects mute', async ({ page }) => {
  await page.addInitScript(() => {
    class AudioMock {
      state = 'suspended'; onstatechange: (() => void) | null = null;
      resumes = 0; rings = 0; closed = false;
      constructor() { (window as any).__audio = this; }
      async resume() { this.resumes++; this.state = 'running'; this.onstatechange?.(); }
      async close() { this.closed = true; this.state = 'closed'; }
      createOscillator() { this.rings++; throw new Error('Unexpected notification'); }
    }
    Object.defineProperty(window, 'AudioContext', { value: AudioMock });
  });
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
  const suspend = async () => page.evaluate(() => { const audio = (window as any).__audio; audio.state = 'suspended'; audio.onstatechange?.(); });
  await suspend();
  await expect(page.getByRole('button', { name: 'Sipariş sesini etkinleştir' })).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__audio.rings)).toBe(0);
  await page.getByRole('button', { name: 'Sipariş sesini kapat' }).click();
  const before = await page.evaluate(() => (window as any).__audio.resumes);
  await suspend(); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('button', { name: 'Sipariş sesini aç' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__audio.resumes)).toBe(before);
  // The kitchen's sound lives on its other views too (Stok, Hesabım); signing out closes it.
  await page.getByRole('button', { name: 'Hesabım', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__audio.closed)).toBe(false);
  await page.locator('.account-logout').getByRole('button', { name: 'Çıkış yap' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__audio.closed)).toBe(true);
});

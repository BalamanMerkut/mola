import { test, expect, type Browser } from '@playwright/test';
import { ensureSetup } from './helpers';

/*
 * 10 Ekim son kullanıcı testi (kurulu paket, kasa bilgisayarı 1366 × 768): the owner's menu showed "Ayarlar" cut in half under
 * the sticky foot ("Avarlar") and Hesabım was out of sight; the Müdür lost Hesabım. On a short screen every place of the menu
 * is fully in sight above the foot (Destek, the user line), down to the Mola window's ~1366 × 690 (title bar + taskbar).
 */
const PASSWORD = 'MolaDemo!2026', MANAGER = { username: 'kisa.mudur', password: 'Kisa-Ekran-Mudur-26!' };
async function menuFits(browser: Browser, username: string, height: number) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height } });
  const page = await ctx.newPage();
  try {
    expect((await page.request.post('/api/login', { data: { username, password: username === MANAGER.username ? MANAGER.password : PASSWORD } })).ok()).toBe(true);
    if (username === 'isletme') await ensureSetup(page.request);
    await page.goto('/');
    await page.locator('.sidebar nav').waitFor();
    await page.waitForTimeout(500);
    return await page.evaluate(() => {
      const foot = document.querySelector('.sidebar > .sidebar-bottom')!.getBoundingClientRect().top;
      return [...document.querySelectorAll<HTMLElement>('.sidebar nav button')].filter(b => b.offsetParent !== null)
        .map(b => ({ name: (b.textContent ?? '').trim(), hidden: b.getBoundingClientRect().bottom > foot + 0.5 }));
    });
  } finally { await ctx.close(); }
}

test('short screens: the owner\'s and the Müdür\'s whole menu is in sight above the sidebar foot', async ({ browser, page }) => {
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
  await ensureSetup(page.request);
  const made = await page.request.post('/api/staff/users', { data: { ...MANAGER, name: 'Kısa Ekran Müdür', role: 'manager' } });
  expect(made.ok(), await made.text()).toBe(true);
  for (const [username, last] of [['isletme', 'Hesabım'], [MANAGER.username, 'Hesabım']] as const) {
    for (const height of [768, 690]) {
      const items = await menuFits(browser, username, height);
      expect(items.map(i => i.name), `${username} ${height}`).toContain(last);
      expect(items.filter(i => i.hidden).map(i => i.name), `${username} 1366 × ${height}: under the foot`).toEqual([]);
    }
  }
});

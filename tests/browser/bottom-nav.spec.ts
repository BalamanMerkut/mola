import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bell, bottomNav, ensureSetup, moreSheet, openView } from './helpers';

/*
 * Telefonda alt menü çubuğu (src/BottomNav.tsx): up to 700 px the sidebar steps aside for a bottom bar with four places
 * per role and "Daha fazla" (a sheet with the rest and Çıkış yap). Wider screens keep the sidebar; the kitchen has no bar.
 * 10 Ekim düzeni: the owner and the Müdür have "Kasa" (Kasa ve giderler) in the bar; Ayarlar and Stok wait in "Daha fazla";
 * the owner's Bildirimler is the bell on the slim top bar.
 */
const PASSWORD = 'MolaDemo!2026';
const id = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
async function signedIn(browser: Browser, username: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, hasTouch: true });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: passwordOf(username) } })).ok()).toBe(true);
  return page;
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** The bar's items in order, as written on screen (short labels). */
const barNames = async (page: Page) => (await bottomNav(page).locator('.bottom-nav-label').allInnerTexts()).map(t => t.trim());

/** Per role: the four places shown in the bar, then what "Daha fazla" holds (the rest of that role's places). */
const ROLES = {
  garson: { bar: ['Masalar', 'Sipariş al', 'Servise hazır', 'Rezervasyon'], more: ['Hesabım'] },
  kasiyer: { bar: ['Masalar', 'Sipariş al', 'Kasa', 'Rezervasyon'], more: ['Hesabım'] },
  isletme: { bar: ['Masalar', 'Sipariş al', 'Kasa', 'Raporlar'], more: ['Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Ayarlar', 'Destek', 'Hesabım'] },
  // The owner has no "Mutfak ekranı" (the kitchen board is the kitchen account's; one screen for both: İkiye böl).
  // Müdür (src/roleNav.ts): no Ayarlar or Destek; Kasa ve giderler and Personel (Vardiya ve bahşiş) like the owner.
  mudur: { bar: ['Masalar', 'Sipariş al', 'Kasa', 'Raporlar'], more: ['Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Duyurular', 'Hesabım'] },
} as const;
/** The Müdür is made by the owner (beforeEach); the demo accounts share one password. */
const MANAGER = { username: 'mudur', password: 'MudurDeneme!2026' };
const passwordOf = (username: string) => username === MANAGER.username ? MANAGER.password : PASSWORD;
/** What each place shows when opened: its page title (h1). */
const TITLES: Record<string, RegExp> = {
  'Masalar': /Her masa, güzel bir mola\./, 'Sipariş al': /^Sipariş al$/, 'Servise hazır': /^Servise hazır$/, 'Rezervasyon': /^Ajanda ve rezervasyon$/, 'Ajanda ve rezervasyon': /^Ajanda ve rezervasyon$/,
  'Kasa': /^Kasa( ve giderler)?$/, 'Raporlar': /^Satış ve Raporlar$/, 'Ayarlar': /^Ayarlar$/, 'Menü yönetimi': /^Menü yönetimi$/, 'Stok': /^Stok$/,
  'Personel': /^Personel$/, 'Destek': /^Destek$/, 'Duyurular': /^Duyurular$/, 'Hesabım': /^Hesabım$/,
};
const FULL: Record<string, string> = { 'Rezervasyon': 'Ajanda ve rezervasyon', 'Raporlar': 'Satış ve Raporlar' };

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  const users = await (await page.request.get('/api/staff/users')).json() as { username: string }[];
  if (!users.some(u => u.username === MANAGER.username)) {
    const made = await page.request.post('/api/staff/users', { data: { ...MANAGER, name: 'Müdür Mehmet', role: 'manager' } });
    expect(made.ok(), await made.text()).toBe(true);
  }
});

for (const width of [360, 390]) for (const [user, places] of Object.entries(ROLES)) {
  test(`${width} px · ${user}: the bottom bar holds the role's four places and "Daha fazla" the rest; every one opens; nothing hides behind the bar`, async ({ browser }, info) => {
    const page = await signedIn(browser, user, { width, height: width === 360 ? 780 : 844 });
    try {
      await page.goto('/');
      const bar = bottomNav(page);
      await expect(bar).toBeVisible();
      await expect(page.locator('.sidebar')).toBeHidden();
      // Four places and "Daha fazla", short labels of at least 12 px, targets of at least 48 px, fixed to the bottom.
      expect(await barNames(page)).toEqual([...places.bar, 'Daha fazla']);
      const box = (await bar.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(width === 360 ? 780 : 844);
      for (const b of await bar.getByRole('button').all()) {
        const r = (await b.boundingBox())!;
        expect(r.height, await b.innerText()).toBeGreaterThanOrEqual(48);
        expect(r.width, await b.innerText()).toBeGreaterThanOrEqual(48);
        expect(await b.locator('.bottom-nav-label').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
      }
      expect(await fits(page)).toBe(true);
      // Every place of the role opens from the bar or the sheet, and is then marked as the current one.
      for (const name of [...places.bar, ...places.more]) {
        await openView(page, FULL[name] ?? name);
        // Masalar has no title on a phone (every role since 9 Ekim, K-S): its one-line summary instead (tests/browser/waiter-phone.spec.ts).
        if (name === 'Masalar') await expect(page.getByLabel('Masa özeti')).toBeVisible();
        else await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLES[name]);
        if ((places.bar as readonly string[]).includes(name)) await expect(bar.getByRole('button', { name: new RegExp(`^${FULL[name] ?? name}`) })).toHaveAttribute('aria-current', 'page');
        else { await expect(bar.getByRole('button', { name: /^Daha fazla/ })).toHaveClass(/active/); await expect(moreSheet(page)).toHaveCount(0); }
        expect(await fits(page), name).toBe(true);
        // Scrolled to the very bottom, the page's last line ends above the bar (the page has room for it).
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const footer = (await page.locator('.workspace-footer').boundingBox())!, barTop = (await bar.boundingBox())!.y;
        expect(footer.y + footer.height, name).toBeLessThanOrEqual(barTop + 1);
        await page.evaluate(() => scrollTo(0, 0));
      }
      // "Daha fazla": the rest of the role's places and Çıkış yap; Escape closes it.
      await bar.getByRole('button', { name: /^Daha fazla/ }).click();
      const sheet = moreSheet(page);
      await expect(sheet).toBeVisible();
      for (const name of places.more) await expect(sheet.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
      expect(await fits(page)).toBe(true);
      if (width === 390 && user === 'isletme') await shot(page, 'alt-menu-sahip.png', info.outputPath('alt-menu-sahip.png'));
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      if (width === 390 && user === 'garson') { await openView(page, 'Masalar'); await shot(page, 'alt-menu-garson.png', info.outputPath('alt-menu-garson.png')); }
      // Çıkış yap from the sheet signs out.
      await bar.getByRole('button', { name: /^Daha fazla/ }).click();
      await sheet.getByRole('button', { name: 'Çıkış yap' }).click();
      await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toBeVisible();
    } finally { await page.context().close(); }
  });
}

test('badges come along: the waiter\'s "Servise hazır" count, the owner\'s Bildirimler red dot on the bell of the slim top bar', async ({ browser, page: owner }) => {
  const kitchen = (await browser.newContext()).request, waiterApi = (await browser.newContext()).request;
  for (const [r, u] of [[kitchen, 'mutfak'], [waiterApi, 'garson']] as [APIRequestContext, string][]) expect((await r.post('/api/login', { data: { username: u, password: PASSWORD } })).ok()).toBe(true);
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 });
  const phone = await signedIn(browser, 'isletme', { width: 390, height: 844 });
  try {
    await waiter.goto('/');
    const sent = await (await waiterApi.post('/api/staff/orders', { data: { requestId: id(), tableId: 'table-3', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).json();
    for (const status of ['preparing', 'ready'] as const) {
      const o = (await (await kitchen.get('/api/staff/state')).json()).orders.find((x: { id: string }) => x.id === sent.orderId);
      expect((await kitchen.post('/api/staff/status', { data: { requestId: id(), orderId: sent.orderId, version: o.version, status } })).ok()).toBe(true);
    }
    const ready = bottomNav(waiter).getByRole('button', { name: /^Servise hazır/ });
    await expect(ready.locator('.bottom-nav-count')).toHaveText(/^\d+$/);
    await expect(ready).toHaveAccessibleName(/Servise hazır\s*, \d+ sipariş/);
    // An unread notification (a note reminding now): the count on the bell (Bildirimler, once a tab of Destek; 10 Ekim: the count, not a dot).
    const now = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const [day, time] = now.split(' ');
    expect((await owner.request.post('/api/staff/agenda', { data: { day, title: 'Alt menü hatırlatması', text: '', reminder: { offset: 'same', time } } })).ok()).toBe(true);
    await phone.goto('/');
    await expect(bell(phone).getByTestId('bell-count')).toHaveText(/^(\d|9\+)$/, { timeout: 25000 });
    await expect(bell(phone)).toHaveClass(/has-unread/);
    await expect(bell(phone)).toHaveAccessibleName(/Bildirimler, \d+ okunmamış/);
    await bell(phone).click();
    await expect(phone.getByRole('region', { name: 'Bildirimler' })).toContainText('Alt menü hatırlatması');
  } finally { await waiter.context().close(); await phone.context().close(); }
});

test('wider screens keep the sidebar and show no bar; the kitchen has no bar; nothing scrolls sideways from 360 to 1280', async ({ browser }) => {
  const owner = await signedIn(browser, 'isletme', { width: 1280, height: 800 });
  try {
    await owner.goto('/');
    for (const width of [360, 390, 600, 700, 701, 768, 820, 1024, 1280]) {
      await owner.setViewportSize({ width, height: 800 });
      await owner.waitForTimeout(50);
      if (width <= 700) { await expect(bottomNav(owner), `${width}`).toBeVisible(); await expect(owner.locator('.sidebar'), `${width}`).toBeHidden(); }
      else { await expect(bottomNav(owner), `${width}`).toBeHidden(); await expect(owner.locator('.sidebar nav'), `${width}`).toBeVisible(); }
      expect(await fits(owner), `${width}`).toBe(true);
    }
  } finally { await owner.context().close(); }
  const cook = await signedIn(browser, 'mutfak', { width: 390, height: 844 });
  try { await cook.goto('/'); await expect(cook.locator('.kitchen-bar')).toBeVisible(); await expect(bottomNav(cook)).toHaveCount(0); } finally { await cook.context().close(); }
});

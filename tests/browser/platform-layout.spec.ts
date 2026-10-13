import { test, expect, type Page } from '@playwright/test';
import { ADMIN_API, MERKEZ, detailTab, merkezPassword, openBusiness, yonetimBell, yonetimGo, yonetimNav, yonetimPackages, yonetimSettings, yonetimState } from './helpers';

// Phones, tablets (portrait and landscape) and a desktop: the owner plans phone and tablet apps for Mola Yönetim.
const sizes = [[360, 800], [390, 844], [768, 1024], [820, 1180], [800, 360], [844, 390], [1024, 768], [1180, 820], [1280, 860]] as const;

/** No sideways page scroll, and nothing pokes out of the right edge. */
async function fits(page: Page) {
  return page.evaluate(() => {
    const wide = document.documentElement.scrollWidth > innerWidth + 1;
    const out = [...document.querySelectorAll<HTMLElement>('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest('.platform-pills, .detail-tabs, .segmented, .pill-tabs'); })
      .slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${e.className}`);
    return wide || out.length ? `taşıyor: ${out.join(', ') || 'sayfa'}` : 'ok';
  });
}
/** Buttons, links and fields a finger can hit: at least 44px tall (inline text links and checkboxes aside). */
async function smallTargets(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('main button, main a, main input:not([type=checkbox]):not([type=radio]), main select, main summary')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && !e.closest('.inline-link, p, small') && getComputedStyle(e).visibility !== 'hidden'; })
    .slice(0, 5).map(e => `${e.tagName.toLowerCase()} “${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}” ${Math.round(e.getBoundingClientRect().height)}px`));
}

test('Mola Yönetim fits phones, tablets (both ways) and desktop: no sideways scroll, 44px touch targets, the top bar never cut', async ({ page }) => {
  test.setTimeout(240_000);
  const name = (await (await page.request.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword() } })).ok()) && (await yonetimState(page.request)).businesses.find((b: any) => !b.application)?.name;
  expect(name).toBeTruthy();
  // The login door first (a fresh context, signed out).
  const door = await page.context().browser()!.newPage();
  await door.goto(`${MERKEZ}/`);
  for (const [width, height] of sizes) {
    await door.setViewportSize({ width, height });
    await expect(door.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible();
    expect(await fits(door), `giriş ${width}×${height}`).toBe('ok');
    expect(await smallTargets(door), `giriş ${width}×${height}`).toEqual([]);
    // The form is reachable without scrolling sideways, and on a phone it starts on the first screen.
    const box = (await door.getByRole('button', { name: 'Giriş yap', exact: true }).boundingBox())!;
    expect(box.x >= 0 && box.x + box.width <= width).toBe(true);
  }
  await door.close();

  await page.goto(`${MERKEZ}/`);
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true })).toBeVisible();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const at = `${width}×${height}`;
    const check = async (screen: string) => {
      expect(await fits(page), `${screen} ${at}`).toBe('ok');
      expect(await smallTargets(page), `${screen} ${at}`).toEqual([]);
    };
    // All items of the sidebar / top bar are inside the screen and their labels are not cut (on phones Duyurular is the
    // megaphone beside the bell, so the strip keeps six).
    expect(await yonetimNav(page).evaluate(n => [...n.querySelectorAll('button')].filter(b => b.offsetParent !== null).every(b => { const r = b.getBoundingClientRect(), label = b.querySelector('span') as HTMLElement; return r.left >= 0 && r.right <= innerWidth + 0.5 && r.height >= 44 && label.scrollWidth <= label.clientWidth + 1; })), `menü ${at}`).toBe(true);
    await yonetimGo(page, 'Bugün'); await expect(page.getByRole('heading', { name: 'Bugün yapılacaklar' })).toBeVisible(); await check('Bugün');
    await yonetimGo(page, 'İşletmeler'); await expect(page.locator('.business-tile').first()).toBeVisible(); await check('İşletmeler');
    // Tiles in one row share one height (no jumping when a name or a chip is longer).
    const heights = await page.locator('.business-tile').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter((r, _, all) => Math.abs(r.top - all[0].top) < 1).map(r => Math.round(r.height)));
    expect(new Set(heights).size, `kutular ${at}`).toBe(1);
    const detail = await openBusiness(page, name);
    // The five tabs fit without scrolling, centred under the name.
    expect(await detail.locator('.detail-tabs').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `sekmeler ${at}`).toBe(true);
    for (const tab of ['Özet', 'Lisans', 'Hizmet', 'Bilgiler', 'Destek'] as const) {
      await detailTab(detail, tab).click(); await expect(detailTab(detail, tab)).toHaveAttribute('aria-pressed', 'true');
      await check(`İşletme · ${tab}`);
    }
    await yonetimGo(page, 'Başvurular'); await expect(page.getByRole('heading', { name: 'Başvurular', exact: true })).toBeVisible(); await check('Başvurular');
    await yonetimGo(page, 'Destek'); await expect(page.getByRole('heading', { name: 'Destek', exact: true })).toBeVisible(); await check('Destek');
    await yonetimGo(page, 'Duyurular'); await expect(page.getByRole('heading', { name: 'Duyurular', exact: true })).toBeVisible(); await check('Duyurular');
    await yonetimGo(page, 'Satışlarım'); await expect(page.getByRole('heading', { name: 'Satışlarım', exact: true })).toBeVisible(); await check('Satışlarım');
    for (const tab of ['Paketler', 'Hizmet fiyatları'] as const) { await yonetimPackages(page, tab); await check(`Paketler · ${tab}`); }
    for (const section of ['Hesap güvenliği', 'Yedek', 'E-posta bildirimleri', 'İletişim bilgileri', 'İşlem geçmişi'] as const) { await yonetimSettings(page, section); await check(`Ayarlar · ${section}`); }
    // Yedek → the cafés' cloud backups list (opened from "Yedekler nerede?").
    await yonetimSettings(page, 'Yedek'); await page.getByRole('button', { name: /Kafelerin bulut yedekleri/ }).click();
    await expect(page.getByRole('group', { name: 'Kafelerin bulut yedekleri listesi' })).toBeVisible(); await check('Ayarlar · Yedek · bulut listesi');
    await yonetimBell(page).click(); await expect(page.getByRole('heading', { name: 'Bildirim merkezi' })).toBeVisible(); await check('Bildirim merkezi');
  }
});

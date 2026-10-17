import { test, expect, type Locator, type Page } from '@playwright/test';
import { ensureSetup, openCash, openSettings, openStaff, openView } from './helpers';

/*
 * 17 Ekim (sahibin isteği): links to another place ("Hangi garson hangi bölümde? →", src/Moved.tsx PlaceLink) were small
 * underlined text on the card and got missed. Now one soft pill everywhere: the palette colour on its tint, medium weight,
 * an arrow, no underline; readable (AA) on every palette, never wider than the screen, and not a filled button.
 */
const PASSWORD = 'MolaDemo!2026';

async function theme(page: Page, id: string) {
  const s = await (await page.request.get('/api/staff/state')).json();
  const saved = await page.request.post('/api/staff/business-profile', { data: { requestId: `link-theme-${id}-${Date.now()}`, version: s.businessRevision ?? 0, name: s.name, logo: s.logo ?? null, theme: id } });
  expect(saved.ok(), await saved.text()).toBe(true);
}

/** The pill: visible, inside the screen, tinted, rounded, medium weight, no underline, arrow, ≥ 4.5:1. */
async function checkPill(page: Page, link: Locator, where: string) {
  // In the middle of the screen (a phone's bottom bar covers the last rows), the pointer away from it: at rest.
  await link.evaluate(el => el.scrollIntoView({ block: 'center' })); await page.mouse.move(1, 1);
  await expect(link, where).toBeVisible();
  await expect(link.locator('svg'), `${where}: arrow`).toHaveCount(1);
  const look = await link.evaluate(el => {
    const css = getComputedStyle(el), rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
    const lum = (c: number[]) => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [a, b] = [lum(rgb(css.color)), lum(rgb(css.backgroundColor))].sort((x, y) => y - x);
    const box = el.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { covered: !el.contains(hit), contrast: (a + 0.05) / (b + 0.05), alpha: rgb(css.backgroundColor)[3] ?? 1, radius: parseFloat(css.borderTopLeftRadius), weight: Number(css.fontWeight), underline: css.textDecorationLine, height: box.height, left: box.left, right: box.right, width: innerWidth, scroll: document.documentElement.scrollWidth };
  });
  expect(look.covered, `${where}: nothing lies over it`).toBe(false);
  expect(look.contrast, `${where}: contrast ${look.contrast.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  expect(look.alpha, `${where}: a tinted background, not transparent`).toBeGreaterThan(0);
  expect(look.radius, `${where}: pill`).toBeGreaterThanOrEqual(14);
  expect(look.weight, `${where}: medium weight`).toBeGreaterThanOrEqual(600);
  expect(look.underline, `${where}: no underline at rest`).toBe('none');
  expect(look.height, `${where}: a comfortable target`).toBeGreaterThanOrEqual(30);
  expect(look.left, `${where}: inside the screen`).toBeGreaterThanOrEqual(0);
  expect(look.right, `${where}: inside the screen`).toBeLessThanOrEqual(look.width + 0.5);
  expect(look.scroll, `${where}: no sideways page scroll`).toBeLessThanOrEqual(look.width);
}

async function shot(page: Page, link: Locator, path: string) {
  const box = (await link.boundingBox())!, view = page.viewportSize()!;
  const x = Math.max(0, box.x - 160), y = Math.max(0, box.y - 120);
  await page.screenshot({ path, clip: { x, y, width: Math.min(view.width - x, box.width + 320), height: Math.min(view.height - y, box.height + 200) } });
}

test('place links: a clear soft pill on every palette, desktop and phone (Masalar ve QR)', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } }); await ensureSetup(page.request);
  try {
    for (const id of ['sage', 'copper', 'rose', 'navy']) {
      await theme(page, id);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 860 }); await page.goto('/');
        await openSettings(page, 'Masalar ve QR');
        const link = page.getByRole('button', { name: 'Hangi garson hangi bölümde?', exact: true });
        await checkPill(page, link, `${id} ${width}`);
        // Still a link, not a primary button: its background is not the palette colour.
        const [bg, primary] = await link.evaluate(el => [getComputedStyle(el).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--green').trim()]);
        expect(bg).not.toBe(primary);
        await shot(page, link, info.outputPath(`place-link-${id}-${width}.png`));
        await link.hover(); await expect(link).toHaveCSS('text-decoration-line', 'underline');
        if (width === 1280) await shot(page, link, info.outputPath(`place-link-${id}-${width}-hover.png`));
      }
    }
    // Opens the other place.
    await page.setViewportSize({ width: 1280, height: 860 }); await page.goto('/'); await openSettings(page, 'Masalar ve QR');
    await page.getByRole('button', { name: 'Hangi garson hangi bölümde?', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Personel ayarları bölümleri', exact: true }).getByRole('button', { name: /^Garson ataması/ })).toHaveAttribute('aria-current', 'page');
  } finally { await theme(page, 'sage'); }
});

test('place links: Personel, Kasa, Satış ve Raporlar and Destek show the same pill, nothing overflows', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } }); await ensureSetup(page.request);
  await theme(page, 'copper'); // the palette with the lowest contrast
  try {
    const screens: [string, (p: Page) => Promise<unknown>, RegExp][] = [
      ['personel', p => openStaff(p, 'Vardiya ve bahşiş', 'Vardiyalar'), /^Çalışan satışları/],
      ['kasa', p => openCash(p, 'Giderler', 'Kayıtlar'), /^Kasiyerin gider sınırı/],
      ['raporlar', p => openView(p, 'Satış ve Raporlar'), /^(Gider kayıtlarını aç|Kasa kapanışları)/],
      ['destek', p => openView(p, 'Destek'), /^Paket ve lisans/],
    ];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 860 });
      for (const [name, open, label] of screens) {
        await page.goto('/'); await open(page);
        const link = page.locator('button.place-link').filter({ hasText: label }).first();
        await checkPill(page, link, `${name} ${width}`);
        await shot(page, link, info.outputPath(`place-link-${name}-${width}.png`));
      }
    }
  } finally { await theme(page, 'sage'); }
});

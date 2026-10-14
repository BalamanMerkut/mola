import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ADMIN_API, detailTab, openBusiness, openYonetim, yonetimBell, yonetimGo, yonetimSettings, yonetimState } from './helpers';

/*
 * 13 Ekim tanıtım geri bildirimi (docs/HAFTA_SONU_BULGULARI.md 2. tur, 6, 7, 8, 15, 16) in Mola Yönetim: Paketler in the menu with
 * Hizmet fiyatları as its sub-tab, Destek above Ayarlar; the business page's identity card with "Uzaktan bağlan"; the plain
 * notification list grouped by day with "Uzaktan bağlan" on remote-support events; Ayarlar → Yedek's "Yedekler nerede?" and the
 * cafés' cloud backups list (read only, no download). The screens are saved to docs/ekran/yonetim-yeni/ (EKRAN_YENI=0: not).
 */
const folder = resolve('docs/ekran/yonetim-yeni');
async function shot(page: Page, file: string, fullPage = false) {
  await page.locator('.platform-local-note').evaluateAll(els => els.forEach(e => { (e as HTMLElement).style.visibility = 'hidden'; })).catch(() => {});
  await page.screenshot({ path: test.info().outputPath(file), fullPage });
  if (process.env.EKRAN_YENI !== '0') { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
const businessWithComputer = async (page: Page) => {
  let demo: any;
  await expect.poll(async () => { demo = (await yonetimState(page.request)).businesses.find((b: any) => b.source === 'import' && b.machines?.length); return !!demo; }, { timeout: 20_000 }).toBe(true);
  return demo as { tenantId: string; name: string };
};

test('menu: Paketler with Hizmet fiyatları under it, Destek above Ayarlar; phones keep six places', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await openYonetim(page);
  const nav = page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' });
  expect(await nav.getByRole('button').evaluateAll(items => items.map(b => b.getAttribute('aria-label')))).toEqual(['Bugün', 'İşletmeler', 'Başvurular', 'Duyurular', 'Satışlarım', 'Paketler', 'Yedek', 'Güncellemeler', 'Destek', 'Ayarlar']);
  await yonetimGo(page, 'Paketler');
  await expect(page.getByRole('heading', { name: 'Paketler', level: 1 })).toBeVisible();
  const tabs = page.getByRole('navigation', { name: 'Paketler bölümleri' });
  await expect(tabs.getByRole('button')).toHaveText(['Paketler', 'Hizmet fiyatları']);
  await expect(tabs.getByRole('button', { name: 'Paketler', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Paketler' }).getByRole('article', { name: 'Kafe Standart' })).toBeVisible();
  await shot(page, 'menu-paketler.png');
  await tabs.getByRole('button', { name: 'Hizmet fiyatları', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Hizmet fiyatları' })).toContainText('Yakında');
  await expect(nav.getByRole('button', { name: 'Paketler', exact: true })).toHaveAttribute('aria-current', 'page');
  // Ayarlar no longer has them.
  await yonetimSettings(page, 'Hesap güvenliği');
  await expect(page.getByRole('navigation', { name: 'Ayarlar bölümleri' }).getByRole('button', { name: 'Paketler', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Ayarlar bölümleri' }).getByRole('button', { name: 'Hizmet fiyatları', exact: true })).toHaveCount(0);
  // A phone: six places in the strip (Destek and Ayarlar among them); Duyurular and Paketler are icons beside the bell.
  await page.setViewportSize({ width: 390, height: 844 });
  const visible = await nav.getByRole('button').evaluateAll(items => items.filter(b => (b as HTMLElement).offsetParent !== null).map(b => b.getAttribute('aria-label')));
  expect(visible).toEqual(['Bugün', 'İşletmeler', 'Başvurular', 'Satışlarım', 'Destek', 'Ayarlar']);
  await yonetimGo(page, 'Paketler');
  await expect(page.locator('.yonetim-topbar').getByRole('button', { name: 'Paketler', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'menu-telefon.png');
});

test('business page: identity card, tabs with icons, Özet in three cards; "Uzaktan bağlan" leads to the remote-support card', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openYonetim(page);
  const demo = await businessWithComputer(page);
  const detail = await openBusiness(page, demo.name);
  const card = detail.locator('.detail-header.did-card');
  await expect(card.locator('h1')).toHaveText(demo.name);
  await expect(card.locator('.did-facts dt')).toHaveText(['Son bağlantı', 'Paket', 'Lisans']);
  const remote = card.getByRole('button', { name: /Uzaktan bağlan|Yeniden bağlan/ });
  await expect(remote).toBeVisible();
  await expect(detail.locator('.dsum-card')).toHaveCount(3);
  await expect(detail.getByRole('region', { name: 'Sunucu yedeği' })).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.yonetim-main')?.scrollTo(0, 0); });
  await shot(page, 'isletme-ozet.png', true);
  await detailTab(detail, 'Lisans').click();
  await expect(detail.getByRole('region', { name: 'Lisans süresi' })).toBeVisible();
  await expect(detail.getByRole('region', { name: 'Yeni bilgisayara taşıma' }).getByRole('button', { name: 'Taşıma kodu ver' })).toBeVisible();
  await shot(page, 'isletme-lisans.png', true);
  // The owner has not allowed remote support in this run: the button opens Destek's card, which says why.
  await remote.click();
  await expect(detailTab(detail, 'Destek')).toHaveAttribute('aria-pressed', 'true');
  const section = detail.getByRole('region', { name: 'Uzaktan destek' });
  await expect(section).toHaveClass(/focused/);
  await expect(section.getByRole('button', { name: 'Kafeye bağlan' })).toBeDisabled();
  await expect(section).toContainText(/İzin/);
  await shot(page, 'isletme-destek-uzaktan.png');
  for (const [width, height] of [[390, 844], [768, 1024]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}`).toBe(true);
    expect(await detail.locator('.detail-tabs').evaluate(n => n.scrollWidth <= n.clientWidth + 1), `sekmeler ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await detailTab(detail, 'Özet').click();
  await shot(page, 'isletme-ozet-telefon.png', true);
});

test('Bildirim merkezi: day groups, quiet rows, one action; a remote-support event says "Uzaktan bağlan"', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openYonetim(page);
  const demo = await businessWithComputer(page);
  const hour = 3600_000, now = Date.now();
  await page.route('**/api/merkez/admin/state', async route => {
    const response = await route.fetch(); if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const body = await response.json(), other = body.businesses.find((b: any) => b.tenantId !== demo.tenantId && !b.application) ?? body.businesses[0];
    const list: [string, string, string, number, string?, boolean?, string?][] = [
      ['support.access', 'Uzaktan destek izni verildi', `${demo.name}: işletme sahibi uzaktan destek iznini açtı.`, 0.3, demo.tenantId],
      ['ticket.new', 'Yeni destek talebi', 'Yazıcı fiş basmıyor', 1.2, other.tenantId],
      ['license.expiring', 'Lisans 7 gün içinde bitiyor', `${other.name} lisansı 20 Ekim’de bitiyor.`, 3, other.tenantId],
      ['cafe.cloud_backup', 'Sunucu yedeği gelmedi', `${other.name}: 2 günden uzun süredir sunucu yedeği gelmedi.`, 26, other.tenantId],
      ['application.new', 'Yeni hesap açma başvurusu', 'Deniz Kafe · Elazığ', 30, other.tenantId, true],
      ['cafe.backup', 'İkinci yedek yeri ayarlı değil', `${demo.name}: ikinci yedek yeri yok.`, 52, demo.tenantId, true, 'low'],
      ['update.published', 'Güncelleme yayınlandı', 'Mola 0.1.1 işletmelere gidiyor.', 75, undefined, true],
    ];
    body.alerts = list.reverse().map(([kind, title, text, ago, tenantId, read, priority], i) => ({ id: `yeni-${i}`, kind, title, text, at: new Date(now - ago * hour).toISOString(), ...(tenantId ? { tenantId } : {}), ...(read ? { readAt: new Date(now - hour).toISOString() } : {}), ...(priority ? { priority } : {}) }));
    body.unread = body.alerts.filter((a: any) => !a.readAt).length;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await yonetimBell(page).click();
  await expect(page.getByRole('heading', { name: 'Bildirim merkezi' })).toBeVisible();
  const rows = page.locator('.alert-list li');
  await expect(rows).toHaveCount(7);
  const days = await page.locator('.alert-day-title').evaluateAll(h => h.map(x => x.firstChild?.textContent ?? ''));
  expect(days).toEqual(['Bugün', 'Dün', 'Daha eski'].filter(d => days.includes(d)));
  expect(days).toContain('Daha eski');
  // One quiet action per line (none for an event without a record), the read mark beside it.
  for (const row of await rows.all()) expect(await row.locator('.alert-open').count()).toBeLessThanOrEqual(1);
  const support = rows.filter({ hasText: 'Uzaktan destek izni verildi' });
  await expect(support).toHaveClass(/unread/);
  await expect(support.locator('.alert-dot')).toHaveCount(1);
  await expect(support.getByRole('button', { name: 'Uzaktan bağlan' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Güncelleme yayınlandı' }).locator('.alert-open')).toHaveCount(0);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.yonetim-main')?.scrollTo(0, 0); });
  await shot(page, 'bildirim-merkezi.png', true);
  await support.getByRole('button', { name: 'Uzaktan bağlan' }).click();
  const detail = page.getByRole('region', { name: demo.name, exact: true });
  await expect(detailTab(detail, 'Destek')).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByRole('region', { name: 'Uzaktan destek' }).getByRole('button', { name: 'Kafeye bağlan' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await yonetimBell(page).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'bildirim-merkezi-telefon.png');
});

test('Ayarlar → Yedek: "Yedekler nerede?" first, details folded; the cafés’ cloud backups list has no download', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openYonetim(page);
  // The recovery code saved (as after the first day): nothing in "Ayrıntılar" needs a look, so it stays closed.
  expect((await page.request.post(`${ADMIN_API}/recovery/show`, { data: {} })).ok()).toBe(true);
  expect((await page.request.post(`${ADMIN_API}/recovery/confirm`, { data: {} })).ok()).toBe(true);
  // The real list (empty in this run: no café sends copies here) and the same screen with a few cafés, for the picture.
  const real = await (await page.request.get(`${ADMIN_API}/cloud-backups/overview`)).json();
  expect(real.total).toBeTruthy(); expect(Array.isArray(real.businesses)).toBe(true);
  // Businesses with a name of their own (the demo data has branches with the same name).
  const all = (await yonetimState(page.request)).businesses.filter((b: any) => b.activation === 'active');
  const names = all.filter((b: any, i: number) => all.findIndex((x: any) => x.name === b.name) === i).map((b: any) => [b.tenantId, b.name]);
  const day = 86400_000, now = Date.now(), MB = 1024 * 1024;
  const rows = [
    { scope: 'full', packageName: 'Restoran Pro', lastUploadAt: new Date(now - 3 * day - 2 * 3600_000).toISOString(), count: 5, bytes: 312 * MB, days: 3, status: 'stale', statusText: '3 gündür yedek gelmedi' },
    { scope: 'cloud', packageName: 'Kafe Standart', lastUploadAt: new Date(now - 2 * 3600_000).toISOString(), count: 5, bytes: 148 * MB, days: 0, status: 'ok', statusText: 'Sağlıklı' },
    { scope: 'full', packageName: 'Deneme', lastUploadAt: new Date(now - 9 * 3600_000).toISOString(), count: 3, bytes: 64 * MB, days: 0, status: 'ok', statusText: 'Sağlıklı' },
    { scope: 'cloud', packageName: 'Özel', lastUploadAt: null, count: 0, bytes: 0, days: null, status: 'none', statusText: 'Henüz yedek gelmedi' },
  ].slice(0, Math.max(1, names.length)).map((r, i) => ({ tenantId: names[i]?.[0] ?? `t${i}`, name: names[i]?.[1] ?? `İşletme ${i + 1}`, suspended: false, ...r }));
  await page.route('**/api/merkez/admin/cloud-backups/overview', route => route.fulfill({ json: { staleDays: 2, total: { businesses: rows.filter(r => r.count).length, copies: rows.reduce((n, r) => n + r.count, 0), bytes: rows.reduce((n, r) => n + r.bytes, 0), lastUploadAt: rows[1]?.lastUploadAt ?? rows[0].lastUploadAt, attention: 1 }, businesses: rows } }));
  await yonetimSettings(page, 'Yedek');
  const card = page.getByRole('region', { name: 'Yedek' });
  const places = card.getByRole('list', { name: 'Yedek yerleri' }).getByRole('listitem');
  await expect(places).toHaveCount(3);
  await expect(places.nth(0)).toContainText('Bu sunucu'); await expect(places.nth(0).locator('code')).not.toBeEmpty();
  await expect(places.nth(1)).toContainText('İkinci yer');
  await expect(places.nth(2)).toContainText('Kafelerin bulut yedekleri'); await expect(places.nth(2)).toContainText('1 işletmede sorun');
  await expect(card.locator('details.bk-details')).not.toHaveAttribute('open', '');
  await shot(page, 'yedek.png', true);
  await card.getByRole('button', { name: /Kafelerin bulut yedekleri/ }).click();
  const list = card.getByRole('group', { name: 'Kafelerin bulut yedekleri listesi' });
  await expect(list.getByRole('row')).toHaveCount(rows.length + 1);
  await expect(list.getByRole('row').nth(1)).toContainText('3 gündür yedek gelmedi');
  await expect(list.getByRole('row').nth(1)).toContainText('Tam paket');
  // Read only: no download anywhere on the list (KVKK: Mola Yönetim never opens a café's backup).
  await expect(list.getByRole('button', { name: /İndir|indir/ })).toHaveCount(0);
  await expect(list.getByRole('link')).toHaveCount(0);
  await expect(list.locator('[download]')).toHaveCount(0);
  await list.scrollIntoViewIfNeeded();
  await shot(page, 'yedek-liste.png', true);
  // "Ayrıntılar" still has everything: kept backups, the second place, the recovery code, readiness, the disk.
  await card.locator('details.bk-details > summary').click();
  for (const name of ['Saklanan yedekler', 'İkinci yedek yeri', 'Kurtarma kodu', 'Geri yüklemeye hazırlık']) await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
  // A row's arrow opens the business.
  await list.getByRole('button', { name: `${rows[0].name} işletme sayfası` }).click();
  await expect(page.getByRole('region', { name: rows[0].name, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await yonetimSettings(page, 'Yedek');
  await card.getByRole('button', { name: /Kafelerin bulut yedekleri/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'yedek-liste-telefon.png', true);
});

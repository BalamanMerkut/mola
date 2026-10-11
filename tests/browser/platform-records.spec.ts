import { test, expect } from '@playwright/test';
import { MERKEZ, merkezPassword, yonetimBell, yonetimNav, yonetimShot } from './helpers';

// İşlem kayıtları (Ayarlar; filters, Turkish day boundaries, Rapor al) are in platform-journal.spec.ts.
test('the notification centre counts, pages, marks read and links stay clear', async ({ page }) => {
  await page.route('**/api/merkez/admin/state', async route => {
    const response = await route.fetch(); if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const body = await response.json();
    body.businesses[0].name = 'Şube Alfa'; body.businesses[1].name = 'Şube Beta';
    // Each kind its own icon and words; the newest (shown first) is an application. "Önemli": the failing backup and the ending licence.
    const kinds = [['application.new', 'Yeni hesap açma başvurusu', 'Başvuru'], ['ticket.new', 'Yeni destek talebi', 'Yazıcı çıktı vermiyor'], ['backup.failing', 'Mola Merkez yedeği alınamadı', 'Disk dolu'],
      ['license.expiring', 'Lisans 7 gün içinde bitiyor', 'Lisans bitiyor'], ['site.lead', 'Web sitesi talebi', 'Çay bahçesi · Elazığ'], ['cafe.backup', 'İkinci yedek yeri ayarlı değil', 'İkinci yedek yeri yok']] as const;
    body.alerts = Array.from({ length: 25 }, (_, i) => { const [kind, title, text] = kinds[i === 24 ? 0 : i % 6]; return { id: `alert-${i}`, kind, title, text: `${text} ${i}`, at: new Date(Date.now() - (25 - i) * 2.5 * 3600_000).toISOString(), ...(kind !== 'backup.failing' && kind !== 'site.lead' ? { tenantId: body.businesses[i % 2].tenantId } : {}), ...(kind === 'cafe.backup' ? { priority: 'low' } : {}), ...(i < 4 ? { readAt: '2026-01-03T13:00:00Z' } : {}) }; });
    body.unread = 21;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${MERKEZ}/`); await page.getByLabel('Şifre', { exact: true }).fill(merkezPassword());
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  // The bell says how many are unread and opens "Bildirim merkezi".
  await expect(page.getByRole('button', { name: 'Bildirim merkezi, 21 okunmamış' })).toBeVisible();
  await page.getByRole('button', { name: 'Bildirim merkezi, 21 okunmamış' }).click();
  await expect(page.getByRole('heading', { name: 'Bildirim merkezi' })).toBeVisible();
  // The bell opens its own page; no sidebar item is current there.
  await expect(yonetimNav(page).locator('[aria-current=page]')).toHaveCount(0);
  const pills = page.getByRole('group', { name: 'Bildirim süzgeci' });
  await expect(pills.getByRole('button')).toHaveText(['Tümü25', 'Okunmamış21', 'Önemli8']);
  await expect(page.locator('.alert-list li')).toHaveCount(20);
  // Cards: an icon and a word for the kind, "Önemli" / "Düşük öncelik", the business, a relative time; one action button and
  // read / unread as a small icon button.
  const first = page.locator('.alert-list li').first();
  await expect(first.locator('.alert-kind')).toHaveText('Başvuru');
  await expect(first.locator('.alert-business')).toHaveText('Şube Alfa');
  await expect(first.locator('time')).toHaveText(/saat önce/);
  await expect(first.getByRole('button', { name: 'Okundu olarak işaretle' })).toBeVisible();
  await expect(page.locator('.alert-list li').filter({ hasText: 'Mola Merkez yedeği alınamadı' }).first().locator('.alert-level')).toHaveText('Önemli');
  await expect(page.locator('.alert-list li').filter({ hasText: 'Web sitesi talebi' }).first().getByRole('button', { name: 'Talepleri aç' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'E-posta bildirim ayarları' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await yonetimShot(page, 'bildirim-merkezi.png', test.info().outputPath('bildirim-merkezi.png'), false);
  await pills.getByRole('button', { name: /^Önemli/ }).click();
  await expect(page.locator('.alert-list li')).toHaveCount(8);
  await pills.getByRole('button', { name: /^Tümü/ }).click();
  await page.getByRole('button', { name: 'Sonraki bildirimler' }).click(); await expect(page.locator('.alert-list li')).toHaveCount(5);
  await pills.getByRole('button', { name: /^Okunmamış/ }).click();
  await expect(page.locator('.alert-list li.unread')).toHaveCount(20);
  // An entry opens the business it is about.
  await page.locator('.alert-list li').first().getByRole('button', { name: 'Başvuruyu aç' }).click();
  await expect(page.getByRole('region', { name: 'Şube Alfa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'İşletmeler listesine dön' }).click();
  await yonetimBell(page).click();
  await expect(page.getByRole('heading', { name: 'Bildirim merkezi' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

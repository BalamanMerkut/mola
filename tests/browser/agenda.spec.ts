import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { businessDay } from '../../packages/domain/business-day';
import { ensureSetup } from './helpers';

const istanbul = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', ...options }).format(new Date());
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' });
const VIEWPORTS = [[360, 800], [390, 844], [768, 1024], [1024, 768], [820, 1180], [1180, 820], [1280, 860]] as const;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Screens for the owner's guide: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}

test('a day note written in reports shows in Ajanda; a due reminder brings the red dot and banner; reading clears them', async ({ page }, info) => {
  test.setTimeout(150000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 860 });
  // Ajanda's "today" is the calendar day; the reports' last bar is the business day (05:00–05:00), so between 00:00 and
  // 05:00 the sales note sits on the evening before. Both are checked at any hour.
  const today = istanbul({}), dayLabel = longDay(today), salesDay = businessDay(Date.now()), salesLabel = longDay(salesDay);
  await page.goto('/');

  // Satış ve Raporlar → 7 gün → today's bar → write the day's note.
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await page.getByRole('button', { name: '7 gün', exact: true }).click();
  await expect(page.locator('.daily-bars button')).toHaveCount(7);
  await page.locator('.daily-bars button').last().click();
  const dayNotes = page.getByRole('region', { name: `${salesLabel} notları` });
  await dayNotes.getByRole('button', { name: 'Bu güne not yaz' }).click();
  await dayNotes.getByLabel('Bu günün notu').fill('Kampanya bugün satışları bayağı artırdı');
  await dayNotes.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dayNotes.locator('.agenda-note')).toContainText('Kampanya bugün satışları bayağı artırdı');
  await expect(dayNotes.locator('.agenda-tag.sales')).toHaveText('Satış notu');
  await expect(page.locator('.daily-bars button.noted')).toHaveCount(1);
  await expect(page.locator('.daily-bars button').last()).toHaveAttribute('aria-label', /not var$/);
  for (const [width, height] of [[360, 800], [768, 1024]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page)).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });

  // Ajanda opens on today: the same note, marked "Satış notu" (after midnight: on the evening before, one tap away).
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  // Rezervasyonlar is the first part since 8 Ekim (the table plan); Takvim holds the notes.
  await page.getByRole('navigation', { name: 'Ajanda bölümleri' }).getByRole('button', { name: 'Takvim' }).click();
  const todayCell = page.locator('.agenda-cell.today');
  await expect(todayCell).toHaveAttribute('aria-pressed', 'true');
  const panel = page.getByRole('region', { name: `${dayLabel} notları` });
  if (salesDay === today) {
    await expect(todayCell).toHaveClass(/has-note/);
    await expect(panel).toContainText('Kampanya bugün satışları bayağı artırdı');
    await expect(panel.locator('.agenda-tag.sales')).toHaveText('Satış notu');
  } else {
    if (salesDay.slice(0, 7) !== today.slice(0, 7)) await page.getByRole('button', { name: 'Önceki ay' }).click();
    const salesCell = page.locator('.agenda-cell:not(.outside)').filter({ has: page.locator('.agenda-num', { hasText: new RegExp(`^${Number(salesDay.slice(8))}$`) }) });
    await expect(salesCell).toHaveClass(/has-note/);
    await salesCell.click();
    const salesPanel = page.getByRole('region', { name: `${salesLabel} notları` });
    await expect(salesPanel).toContainText('Kampanya bugün satışları bayağı artırdı');
    await expect(salesPanel.locator('.agenda-tag.sales')).toHaveText('Satış notu');
    await page.getByRole('button', { name: 'Bugün', exact: true }).click();
    await expect(todayCell).not.toHaveClass(/has-note/);
  }
  // The grid keeps six rows: the same height in every month.
  const gridHeight = async () => (await page.locator('.agenda-grid').boundingBox())!.height;
  const first = await gridHeight();
  for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: 'Sonraki ay' }).click(); expect(await gridHeight()).toBe(first); await expect(page.locator('.agenda-cell')).toHaveCount(42); }
  await page.getByRole('button', { name: 'Bugün', exact: true }).click();
  await expect(todayCell).toHaveAttribute('aria-pressed', 'true');

  // An Ajanda note with a reminder due right now (today, "O gün", this minute in Turkey).
  await panel.getByRole('button', { name: 'Not ekle' }).click();
  await panel.getByLabel('Başlık').fill('Tedarikçi aranacak');
  await panel.getByLabel('Not', { exact: true }).fill('Süt ve kahve siparişi');
  await panel.getByLabel('Hatırlatıcı').selectOption('same');
  await panel.getByLabel('Hatırlatma saati').fill(istanbul({ hour: '2-digit', minute: '2-digit', hour12: false }));
  await panel.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(panel.locator('.agenda-note')).toHaveCount(salesDay === today ? 2 : 1);
  await expect(panel.locator('.agenda-tag.reminder')).toContainText('O gün');
  await expect(todayCell).toHaveClass(/has-reminder/);
  // The bell (Bildirimler, top bar; 10 Ekim) turns soft coral with its count, without any screen being opened.
  const supportDot = page.locator('header.topbar .topbar-bell [data-testid="bell-count"]');
  await expect(supportDot).toHaveText(/^(\d|9\+)$/, { timeout: 20000 });
  await expect(page.locator('header.topbar .topbar-bell')).toHaveClass(/has-unread/);
  await page.getByRole('button', { name: 'Sonraki ay' }).click(); await page.getByRole('button', { name: 'Bugün', exact: true }).click();
  await shot(page, 'ajanda.png', info.outputPath('ajanda.png'), false);

  // Edit and delete (with a question first).
  const card = panel.locator('.agenda-note').filter({ hasText: 'Tedarikçi aranacak' });
  await card.getByRole('button', { name: 'Tedarikçi aranacak notunu düzenle' }).click();
  await panel.getByLabel('Not', { exact: true }).fill('Süt, kahve ve bardak siparişi');
  await panel.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(panel).toContainText('Süt, kahve ve bardak siparişi');
  await panel.getByRole('button', { name: 'Not ekle' }).click();
  await panel.getByLabel('Başlık').fill('Silinecek not');
  await panel.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await panel.getByRole('button', { name: 'Silinecek not notunu sil' }).click();
  await expect(page.getByRole('dialog')).toContainText('Silinen not geri getirilemez.');
  await page.getByRole('button', { name: 'Notu sil', exact: true }).click();
  await expect(panel.getByText('Silinecek not')).toHaveCount(0);

  // Every screen size: no sideways scroll, day cells and controls at least 44 px.
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    expect(await noSideScroll(page), `Ajanda ${width}×${height}`).toBe(true);
    const cell = (await page.locator('.agenda-cell').first().boundingBox())!;
    expect(cell.height, `day cell height ${width}`).toBeGreaterThanOrEqual(44); expect(cell.width, `day cell width ${width}`).toBeGreaterThanOrEqual(43);
    expect((await page.getByRole('button', { name: 'Sonraki ay' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'ajanda-telefon.png', info.outputPath('ajanda-telefon.png'));
  await page.setViewportSize({ width: 1280, height: 860 });

  // Masalar: the banner; it opens Bildirimler (the bell).
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const banner = page.locator('.notification-banner');
  // It says what happened (8 Ekim denetimi K4), not only "Yeni bir bildiriminiz var".
  await expect(banner).toContainText('Hatırlatma: Tedarikçi aranacak');
  for (const [width, height] of [[360, 800], [820, 1180]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page)).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });
  await banner.getByRole('button', { name: 'Bildirimleri aç' }).click();
  const tabs = page.getByRole('tablist', { name: 'Destek bölümleri' });
  await expect(page.getByRole('region', { name: 'Bildirimler' })).toBeVisible();
  await expect(page.locator('header.topbar .topbar-bell')).toHaveAttribute('aria-current', 'page');
  const item = page.locator('.notification-item').filter({ hasText: 'Hatırlatma: Tedarikçi aranacak' });
  await expect(item).toHaveClass(/unread/);
  await shot(page, 'destek-bildirimler.png', info.outputPath('destek-bildirimler.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Bildirimler ${width}×${height}`).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'destek-bildirimler-telefon.png', info.outputPath('destek-bildirimler-telefon.png'));
  await page.setViewportSize({ width: 1280, height: 860 });
  // Opening it marks it read: the dots go.
  await item.getByRole('button', { name: /Hatırlatma: Tedarikçi aranacak/ }).click();
  await expect(item).not.toHaveClass(/unread/);
  await expect(supportDot).toHaveCount(0);
  // "Ajandada göster" opens that day in Ajanda.
  await item.getByRole('button', { name: 'Ajandada göster' }).click();
  await expect(page.getByRole('region', { name: `${dayLabel} notları` })).toContainText('Tedarikçi aranacak');
  // Talepler is still the default part of Destek; the banner stays away once everything is read.
  await page.getByRole('button', { name: 'Destek', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'Talepler' })).toHaveAttribute('aria-selected', 'true');
  // 8 Ekim: the new-ticket form opens with "Yeni talep" (no longer open by default).
  await expect(page.locator('.tc-list').getByRole('button', { name: 'Yeni talep', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  await expect(banner).toHaveCount(0);
});

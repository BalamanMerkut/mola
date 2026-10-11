import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openSettings, openView } from './helpers';

/*
 * Hafta sonu bulgusu 6 (11 Ekim): the owner puts an existing table into a section (bölümsüz → "Üst kat"), renames a section,
 * and changes the order of tables and sections in Ayarlar → Masalar ve QR → Masalar ve QR (src/TableLayout.tsx). Masalar
 * follows that order. Screens for docs/ekran/kafe when KAFE_EKRAN is set.
 */
const PASSWORD = 'MolaDemo!2026';
async function shot(page: Page, file: string, path: string) {
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 });
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}

test('sections: a table moves into a new section, the section is renamed and goes first, a table moves up; Masalar follows', async ({ page }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('/');
  await openSettings(page, 'Masalar ve QR');
  const layout = page.locator('.table-layout');
  await expect(layout.locator('.layout-section').first()).toContainText('masa');
  // Masa 03 (bölümsüz) → a new section "Üst kat"; Masa 04 joins it by choosing it.
  await layout.getByLabel('Masa 03 bölümü').selectOption('#new');
  await layout.getByLabel('Yeni bölüm adı').fill('Üst kat');
  await layout.getByRole('button', { name: 'Bölüme al' }).click();
  const upstairs = layout.locator('.layout-section', { hasText: 'Üst kat masaları' });
  await expect(upstairs).toContainText('Masa 03');
  await layout.getByLabel('Masa 04 bölümü').selectOption('Üst kat');
  await expect(upstairs.locator('.layout-table-name')).toHaveText(['Masa 03', 'Masa 04']);
  // Masa 04 up within its section, then the section to the top.
  await upstairs.getByRole('button', { name: 'Masa 04 yukarı' }).click();
  await expect(upstairs.locator('.layout-table-name')).toHaveText(['Masa 04', 'Masa 03']);
  const sections = layout.locator('.layout-section');
  for (let i = 0; i < 6 && !(await sections.first().innerText()).includes('Üst kat'); i++) {
    await upstairs.getByRole('button', { name: 'Üst kat bölümünü yukarı taşı' }).click();
    await expect(layout).toHaveAttribute('aria-busy', 'false');
    await page.waitForTimeout(600);
  }
  await expect(sections.first()).toContainText('Üst kat masaları');
  // Rename: "Üst kat" → "Teras"; the tables go with it.
  await upstairs.getByRole('button', { name: 'Üst kat bölümünün adını değiştir' }).click();
  await layout.getByLabel('Bölümün yeni adı').fill('Teras');
  await layout.getByRole('button', { name: 'Kaydet' }).click();
  const terrace = layout.locator('.layout-section', { hasText: 'Teras masaları' });
  await expect(terrace.locator('.layout-table-name')).toHaveText(['Masa 04', 'Masa 03']);
  await expect(layout.locator('.layout-saved')).toContainText('Teras');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'ayarlar-masa-bolumleri.png', info.outputPath('ayarlar-masa-bolumleri.png'));
  // Masalar: "Teras masaları" first, Masa 04 before Masa 03.
  await openView(page, 'Masalar');
  const first = page.locator('.table-area-section').first();
  await expect(first.locator(':scope > h3')).toHaveText('Teras masaları');
  await expect(first.locator('.table-card h3')).toHaveText(['Masa 04', 'Masa 03']);
  // A phone keeps the page inside the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await openSettings(page, 'Masalar ve QR');
  await expect(page.locator('.table-layout')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'ayarlar-masa-bolumleri-telefon.png', info.outputPath('ayarlar-masa-bolumleri-telefon.png'));
});

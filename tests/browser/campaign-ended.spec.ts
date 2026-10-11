import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bell, ensureSetup } from './helpers';

/*
 * "Kampanya bitti" (10 Ekim, sahibin onayı): a campaign that ends opens a one-time window for the owner with its results from
 * the campaign report, "Raporu aç", "Kampanyayı yinele" (the editor on a copy, same length from today) and "Kapat"; it stays in
 * Bildirimler. The Müdür gets only the notification. This spec's devices do not carry playwright.config's
 * `mola-campaign-ended: off`.
 */
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}
const PASSWORD = 'MolaDemo!2026';

test('Kampanya bitti: the owner sees the results once, renews it as a copy with today\'s dates; the Müdür only in Bildirimler', async ({ page, browser }, info) => {
  test.setTimeout(120000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } }); await ensureSetup(page.request);
  // The first look marks what had already ended (no flood after the update).
  await page.request.get('/api/staff/notifications');
  const state = await (await page.request.get('/api/staff/state')).json();
  const tea = state.products.find((p: { id: string }) => p.id === 'tea');
  const ends = Date.now() + 8000, starts = ends - 2 * 86400000;
  const { revision } = await (await page.request.get('/api/staff/campaigns')).json();
  const saved = await page.request.post('/api/staff/campaigns', { data: { requestId: randomUUID(), revision, campaign: { name: '2 al 1 öde', productIds: ['tea'], percent: 50, minQuantity: 2, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString(), enabled: true, combine: false } } });
  expect(saved.ok(), await saved.text()).toBe(true);
  for (const [tableId, quantity] of [['table-3', 2], ['table-4', 4]] as const) {
    const r = await page.request.post('/api/staff/orders', { data: { requestId: randomUUID(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: tea.price / 2 * quantity } });
    expect(r.ok(), await r.text()).toBe(true);
  }
  await expect.poll(async () => (await (await page.request.get('/api/staff/notifications')).json()).items.filter((n: { kind: string }) => n.kind === 'campaign').length, { timeout: 30000 }).toBe(1);

  const owner = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1280, height: 860 }, storageState: { cookies: [], origins: [] } });
  const manager = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1280, height: 860 }, storageState: { cookies: [], origins: [] } });
  try {
    const o = await owner.newPage();
    await o.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
    await o.goto('/');
    const dialog = o.getByRole('dialog', { name: `Kampanya bitti: 2 al 1 öde · ${tea.name}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Kampanyanın süresi doldu');
    const figures = dialog.locator('.campaign-ended-figures');
    await expect(figures).toContainText('Kaç kez uygulandı2 siparişte');
    await expect(figures).toContainText('Kampanyalı satılan6 adet');
    await expect(figures).toContainText(`Verilen indirim₺${(tea.price * 3 / 100).toLocaleString('tr-TR')}`);
    // No recipe cost for çay in the demo: no profit line is guessed.
    await expect(figures).not.toContainText('Brüt kâr');
    await shot(o, 'kampanya-bitti.png', info.outputPath('kampanya-bitti.png'));
    // A fake clock three days on (set once the screen is up: the splash counts real time): the copy starts on that day.
    const later = new Date(Date.now() + 3 * 86400000);
    await o.clock.setFixedTime(later);
    await dialog.getByRole('button', { name: 'Kampanyayı yinele' }).click();
    const editor = o.getByRole('dialog', { name: 'Kampanyayı yinele' });
    await expect(editor.getByLabel('Kampanya adı')).toHaveValue('2 al 1 öde');
    const day = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' }).format(later);
    await expect(editor.getByLabel('Başlangıç günü')).toHaveValue(day);
    await expect(editor.getByRole('button', { name: /Sil/ })).toHaveCount(0);
    await editor.getByRole('button', { name: 'Kampanyayı kaydet' }).click();
    await expect(editor).toHaveCount(0);
    // A new campaign beside the ended one (which stays under "Biten kampanyalar" with its own report).
    await expect(o.locator('.campaign-card').filter({ hasText: '2 al 1 öde' })).toHaveCount(2);
    await expect(o.locator('.campaign-ended .campaign-card')).toHaveCount(1);
    // Once only: the window does not come back; the notification stays in Bildirimler with "Raporu aç".
    await o.reload();
    await expect(o.locator('.topbar-bell')).toBeVisible();
    await expect(o.getByRole('dialog', { name: /Kampanya bitti/ })).toHaveCount(0);
    await bell(o).click();
    const entry = o.locator('.notification-item').filter({ hasText: 'Kampanya bitti: 2 al 1 öde' });
    await expect(entry).toBeVisible();
    await entry.getByRole('button', { name: 'Raporu aç' }).click();
    await expect(o.getByLabel('Kampanya dönemi')).toContainText('2 al 1 öde');

    // The Müdür: the bell, no window.
    const users = (await (await page.request.get('/api/staff/users')).json()).users ?? [];
    if (!users.some((u: { username: string }) => u.username === 'mudur.kampanya')) {
      const made = await page.request.post('/api/staff/users', { data: { username: 'mudur.kampanya', name: 'Selin Müdür', role: 'manager', password: 'MudurKampanya!2026' } });
      expect(made.ok(), await made.text()).toBe(true);
    }
    const m = await manager.newPage();
    expect((await m.request.post('/api/login', { data: { username: 'mudur.kampanya', password: 'MudurKampanya!2026' } })).ok()).toBe(true);
    await m.goto('/');
    await expect(bell(m)).toHaveAccessibleName(/Bildirimler, 1 okunmamış/);
    await expect(m.getByRole('dialog', { name: /Kampanya bitti/ })).toHaveCount(0);
    await bell(m).click();
    await expect(m.locator('.notification-item')).toHaveCount(1);
    await expect(m.locator('.notification-item')).toContainText('Kampanya bitti: 2 al 1 öde');
  } finally { await owner.close(); await manager.close(); }
});

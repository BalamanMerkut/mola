// "5 yıllık hız ve hata testi", browser part: the owner's screens on the five-year café (a server started by
// scripts/bes-yil-olcum.ts --tarayici, port 3400). Time until each screen shows its content, and the long tasks
// (main-thread blocks over 50 ms) while it does: a frozen screen shows here. Not part of the normal suite (tests/browser).
//   npx playwright test -c scripts/bes-yil-tarayici.config.ts
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openReport, openView } from '../tests/browser/helpers.js';

const PASSWORD = 'MolaDemo!2026';
const results: Record<string, unknown>[] = [];
async function longTasks(page: Page) { return page.evaluate(() => { const w = window as unknown as { __long?: number[] }; const list = (w.__long ?? []).splice(0); return { count: list.length, total: Math.round(list.reduce((a, b) => a + b, 0)), max: Math.round(Math.max(0, ...list)) }; }); }
async function timed(page: Page, name: string, act: () => Promise<unknown>, ready: () => Promise<unknown>) {
  await longTasks(page);
  // The server's part: every API answer of the screen, with its time and size.
  const calls: [string, number, number][] = [], seen = (r: import('@playwright/test').Response) => { if (r.url().includes('/api/staff/')) void r.body().then(b => calls.push([r.url().split('/api/staff/')[1].split('?')[0], Math.round(r.request().timing().responseEnd), Math.round(b.length / 1024)]), () => {}); };
  page.on('response', seen);
  const t = Date.now(); await act(); await ready(); const ms = Date.now() - t;
  // Let late work (charts, lists) finish and count it too.
  await page.waitForTimeout(1500);
  page.off('response', seen);
  results.push({ screen: name, ms, longTasks: await longTasks(page), api: calls });
}

/** Runs `act` and waits for the report request it starts (the server's work), not just for a quiet network. */
async function answered(page: Page, act: () => Promise<unknown>) {
  const response = page.waitForResponse(r => r.url().includes('/api/staff/reports/'), { timeout: 300_000 });
  await act(); await response;
}
/** Every request the screen made has an answer (one report may ask for several). */
async function settled(page: Page) { await page.waitForLoadState('networkidle', { timeout: 300_000 }); }

test.beforeEach(async ({ page }) => {
  // A weak café PC: Chrome's own CPU slow-down (BES_YIL_CPU_YAVAS=4 → four times slower).
  const slow = Number(process.env.BES_YIL_CPU_YAVAS ?? 1);
  if (slow > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: slow });
  await page.addInitScript(() => { const w = window as unknown as { __long: number[] }; w.__long = []; new PerformanceObserver(l => { for (const e of l.getEntries()) w.__long.push(e.duration); }).observe({ type: 'longtask', buffered: true }); });
});

test('5 yıllık kafede sahibin ekranları', async ({ page }) => {
  test.setTimeout(600_000);
  const login = await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  // A folder made before the generator recorded the agreement: accept it like the owner would, once.
  const agreement = await (await page.request.get('/api/staff/license/agreement')).json();
  if (agreement.needed) await page.request.post('/api/staff/license/agreement', { data: { version: agreement.version } });
  await timed(page, 'Masalar (ilk açılış)', () => page.goto('/'), () => expect(page.getByText('Masa 01', { exact: false }).first()).toBeVisible({ timeout: 120_000 }));
  const picker = page.getByRole('combobox', { name: 'Sipariş masası' });
  await timed(page, 'Sipariş al', () => openView(page, 'Sipariş al'), () => expect(picker).toBeVisible({ timeout: 120_000 }));
  await timed(page, 'Sipariş al · masa seçilince menü', () => picker.selectOption({ index: 2 }), () => expect(page.getByText('Caffè Latte').first()).toBeVisible({ timeout: 120_000 }));
  await timed(page, 'Satış ve Raporlar (bugün)', () => openView(page, 'Satış ve Raporlar'), () => page.locator('nav[aria-label="Rapor bölümleri"], .simple-detail-btn').first().waitFor({ timeout: 120_000 }));
  await openReport(page, 'Özet');
  for (const period of ['1 yıl', 'Tümü']) {
    await timed(page, `Satış ve Raporlar · Özet (${period})`, () => answered(page, () => page.getByRole('button', { name: period, exact: true }).first().click()), () => settled(page));
  }
  for (const tab of ['Ürünler', 'Kârlılık', 'Kasa kapanışları', 'Personel ve bahşiş'] as const) {
    await timed(page, `Satış ve Raporlar · ${tab} (Tümü)`, () => answered(page, () => openReport(page, tab)), () => settled(page));
  }
  await timed(page, 'Menü yönetimi', () => openView(page, 'Menü yönetimi'), () => expect(page.getByText('Caffè Latte').first()).toBeVisible({ timeout: 120_000 }));
  await timed(page, 'Stok', () => openView(page, 'Stok'), async () => { await page.waitForLoadState('networkidle', { timeout: 120_000 }); });
  await timed(page, 'Masalar (geri dönüş)', () => openView(page, 'Masalar'), () => expect(page.getByText('Masa 01', { exact: false }).first()).toBeVisible({ timeout: 120_000 }));
  const file = process.env.BES_YIL_TARAYICI_OUT;
  if (file) writeFileSync(file, JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
});

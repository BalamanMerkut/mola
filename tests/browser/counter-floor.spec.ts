import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup } from './helpers';

/*
 * Masalar on the counter computer or tablet (owner, cashier; ≥ 900 px), made compact as approved: no slogan, the cash strip
 * folded into one chip at the top right, the four number cards as one line, İlk adımlar folded to one line, the tables right
 * below. The owner's condition: nothing may be lost. This walks every action that was on the screen before.
 */
const PASSWORD = 'MolaDemo!2026';
const id = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}
async function desk(browser: Browser, username: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return page;
}
const istanbul = (ms: number) => { const [day, time] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)).split(' '); return { day, time }; };
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Opens the cash chip's menu and one of its actions. */
async function cashAction(page: Page, name: string) {
  const menu = page.getByRole('group', { name: 'Kasa işlemleri' });
  if (!await menu.isVisible()) await page.locator('.cash-chip').click();
  await menu.getByRole('button', { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
});

test('owner, 1280×800: one line, the cash chip with every strip action, the table actions, İlk adımlar folded, all tables in view', async ({ browser, page: api }, info) => {
  expect((await api.request.post('/api/staff/cash/settings', { data: { shiftTracking: true } })).ok()).toBe(true);
  const first = await desk(browser, 'isletme');
  try {
    // A plain day: every normal table is on screen at 1280×800 without scrolling (12 tables).
    await first.goto('/');
    await expect(first.getByLabel('Günün özeti')).toBeVisible();
    const cards = first.locator('.tables-section .table-grid > .table-card');
    await expect(cards.first()).toBeVisible();
    const shown = await cards.evaluateAll(list => list.filter(el => el.getBoundingClientRect().bottom <= innerHeight).length);
    await shot(first, 'masalar-sahip.png', info.outputPath('masalar-sahip.png'));
    expect(shown).toBe(await cards.count());
    expect(await fits(first)).toBe(true);
  } finally { await first.context().close(); await api.request.post('/api/staff/cash/settings', { data: { shiftTracking: false } }); }
  expect((await api.request.post('/api/staff/cash/settings', { data: { shiftTracking: true } })).ok()).toBe(true);
  const owner = await desk(browser, 'isletme');
  try {
    // A masasız ticket, a QR order waiting for approval and a reservation due "Geldi mi?" on this screen's clock.
    const waiter = (await browser.newContext()).request;
    expect((await waiter.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    expect((await waiter.post('/api/staff/takeaway/orders', { data: { requestId: id(), lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).ok()).toBe(true);
    const at = Math.ceil((Date.now() + 2 * 3600_000) / 300_000) * 300_000, when = istanbul(at);
    const resv = await api.request.post('/api/staff/reservations', { data: { requestId: id(), tableId: 'table-9', day: when.day, time: when.time, name: 'Ayla Demir', people: 2 } });
    expect(resv.ok(), await resv.text()).toBe(true);
    await owner.clock.install({ time: at + 35 * 60_000 });
    await owner.goto('/');
    // No slogan and no number cards; one line with the day's figures.
    const line = owner.getByLabel('Günün özeti');
    await expect(line).toBeVisible();
    await expect(owner.locator('.page-heading')).toHaveCount(0);
    await expect(owner.locator('.metric-grid')).toHaveCount(0);
    await expect(line).toContainText(/\d+\/\d+ açık/);
    await expect(line).toContainText('Açık hesap');
    // K-F (9 Ekim): "Mutfakta n" (new + preparing); the masasız tea above is in the kitchen.
    await expect(line).not.toContainText('bekleyen');
    await expect(line.getByTestId('floor-kitchen')).toContainText(/Mutfakta\s*[1-9]/);
    // The cash strip is one chip; its menu has every action the strip had.
    const chip = owner.locator('.cash-chip');
    await expect(chip).toContainText(/^Kasa/);
    await expect(owner.locator('.cash-strip')).toHaveCount(0);
    await chip.click();
    const menu = owner.getByRole('group', { name: 'Kasa işlemleri' });
    for (const name of ['Kasa hareketi', 'İade', 'Vardiya kodu', 'Gün sonu']) await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    await owner.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    for (const [name, dialog] of [['Kasa hareketi', /Kasa hareketi/], ['Vardiya kodu', /Vardiya kodu/], ['Gün sonu', /Gün sonu|Kasa sayımı|kasa/i], ['İade', /İade/]] as const) {
      await cashAction(owner, name);
      const d = owner.getByRole('dialog').filter({ hasText: dialog }).first();
      await expect(d).toBeVisible();
      await d.getByRole('button', { name: /^(Kapat|Vazgeç)$/ }).first().click();
      await expect(owner.getByRole('dialog')).toHaveCount(0);
    }
    // The morning opening, when it waits, is a banner under the head (never a second "Kasa açılmadı" card).
    const opening = owner.locator('.cash-day.compact').getByRole('button', { name: /Açılışı onayla|Kasayı aç|Açılışı kaydet/ });
    if (await opening.count()) { await expect(opening.first()).toBeVisible(); }
    await expect(owner.getByText('Kasa açılmadı', { exact: true })).toHaveCount(0);
    // Table actions stay in the head: Masa ekle, Masa çıkar, Sipariş al.
    const head = owner.locator('.floor-head');
    await head.getByRole('button', { name: 'Masa ekle' }).click();
    await expect(owner.getByRole('dialog')).toBeVisible();
    await owner.getByRole('dialog').getByRole('button', { name: /^(Kapat|Vazgeç)$/ }).first().click();
    await head.getByRole('button', { name: 'Masa çıkar' }).click();
    await expect(owner.getByRole('dialog')).toBeVisible();
    await owner.getByRole('dialog').getByRole('button', { name: /^(Kapat|Vazgeç)$/ }).first().click();
    // İlk adımlar: one line "İlk adımlar n/m" that opens the list with its links.
    const steps = owner.getByRole('region', { name: 'İlk adımlar' });
    if (await steps.count()) {
      const toggle = steps.getByRole('button', { name: /^İlk adımlar\s*\d/ });
      await expect(toggle).toHaveText(/İlk adımlar\s*\d+\/\d+/);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(steps.locator('li')).toHaveCount(0);
      await toggle.click();
      await expect(steps.locator('li').first()).toBeVisible();
      await toggle.click();
    }
    // Reservation question, masasız ticket: still on the screen.
    await expect(owner.getByRole('region', { name: 'Rezervasyon soruları' })).toContainText('Ayla Demir');
    await expect(owner.getByRole('region', { name: 'Rezervasyon soruları' }).getByRole('button', { name: 'Geldi', exact: true })).toBeVisible();
    await expect(owner.locator('.takeaway-strip, [aria-label*="Masasız"]').first()).toBeVisible();
    expect(await fits(owner)).toBe(true);
    await head.getByRole('button', { name: 'Sipariş al' }).click();
    await expect(owner.getByLabel('Sipariş masası')).toBeVisible();
    // A tablet in portrait (≤ 900 px) keeps the full layout.
    await owner.setViewportSize({ width: 820, height: 1180 });
    await owner.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true }).click();
    await expect(owner.locator('.page-heading')).toBeVisible();
    await expect(owner.locator('.cash-strip')).toBeVisible();
  } finally {
    await owner.context().close();
    await api.request.post('/api/staff/cash/settings', { data: { shiftTracking: false } });
  }
});

test('cashier, 1024×768: the chip holds Para bozdurma, Gider kaydet and Gün sonu; approvals stay for the owner', async ({ browser, page: api }) => {
  const cashier = await desk(browser, 'kasiyer', { width: 1024, height: 768 });
  try {
    await cashier.goto('/');
    await expect(cashier.getByLabel('Günün özeti')).toBeVisible();
    await expect(cashier.getByLabel('Günün özeti')).not.toContainText('Bugün');
    await cashier.locator('.cash-chip').click();
    const menu = cashier.getByRole('group', { name: 'Kasa işlemleri' });
    for (const name of ['Para bozdurma', 'Gider kaydet', 'Gün sonu']) await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
    await menu.getByRole('button', { name: 'Gider kaydet', exact: true }).click();
    await expect(cashier.getByRole('dialog', { name: /gider/i })).toBeVisible();
    await cashier.getByRole('dialog').getByRole('button', { name: /^(Kapat|Vazgeç)$/ }).first().click();
    await cashAction(cashier, 'Para bozdurma');
    await expect(cashier.getByRole('dialog')).toBeVisible();
    await cashier.getByRole('dialog').getByRole('button', { name: /^(Kapat|Vazgeç)$/ }).first().click();
    await expect(cashier.locator('.floor-head').getByRole('button', { name: 'Sipariş al' })).toBeVisible();
    expect(await fits(cashier)).toBe(true);
  } finally { await cashier.context().close(); }
  // QR approvals still show on the owner's compact Masalar.
  expect((await api.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: true, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  const owner = await desk(browser, 'isletme'), guest = await browser.newContext();
  try {
    const table = (await (await api.request.get('/api/staff/state')).json()).tables[2];
    const session = await (await guest.request.post('/api/guest/session', { data: { token: table.token } })).json();
    expect((await guest.request.post('/api/guest/orders', { headers: { 'X-Guest-Session': session.session }, data: { requestId: id(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).ok()).toBe(true);
    await owner.goto('/');
    await expect(owner.getByRole('region', { name: 'QR sipariş onayları' })).toBeVisible();
    // K-F: the order waiting for approval is counted on the line ("0 bekleyen" before).
    await expect(owner.getByLabel('Günün özeti').getByTestId('floor-approval')).toHaveText(/Onayda\s*1/);
  } finally { await guest.close(); await owner.context().close(); await api.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: null } }); }
});

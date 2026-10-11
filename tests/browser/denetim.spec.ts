import { test, expect, type Browser } from '@playwright/test';
import { ensureSetup, openView } from './helpers';

/*
 * The owner's decisions on the 8 Ekim audit (docs/DENETIM_RAPORU.md): a card tip paid out in cash (K2, behind a setting),
 * gün.ay.yıl date fields (K5), the waiter's phone opening on Masalar (K6), the sidebar's foot on a 1366 × 768 laptop (K12).
 */
const PASSWORD = 'MolaDemo!2026';
const rid = () => crypto.randomUUID().replace(/-/g, '');
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'en-US' });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  return page;
}

test('K2: with "Kart bahşişini kasadan nakit öde" on, a card tip asks once and "Evet" lowers the expected cash', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  try {
    const open = await cashier.request.post('/api/staff/cash/open', { data: { requestId: rid(), amount: 0 } });
    expect(open.ok() || (await open.json()).code === 'CASH_ALREADY_OPEN').toBe(true);
    const placed = async (tableId: string) => expect((await waiter.request.post('/api/staff/orders', { data: { requestId: rid(), tableId, lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 } })).ok()).toBe(true);
    const pay = async (table: string) => {
      await cashier.reload();
      await cashier.locator('.table-card', { hasText: table }).click();
      await cashier.getByRole('button', { name: 'Ödeme al' }).click();
      const d = cashier.getByRole('dialog', { name: `${table} · Ödeme al` });
      await d.getByRole('button', { name: 'Kart', exact: true }).click();
      await d.getByRole('button', { name: '+ Bahşiş ekle' }).click();
      await d.getByLabel('Bahşiş tutarı').fill('20');
      return d;
    };
    // Off (the default): nothing is asked, as before.
    await placed('table-7');
    let d = await pay('Masa 07');
    await expect(d.getByRole('radiogroup', { name: 'Bahşiş garsona kasadan nakit verildi mi' })).toHaveCount(0);
    await d.getByRole('button', { name: /Ödemeyi kaydet/ }).click();
    await expect(cashier.getByText(/Bahşiş: ₺20/).first()).toBeVisible();
    // On: one question, the save waits for it; "Evet" writes "Kart bahşişi nakit ödendi".
    expect((await page.request.post('/api/staff/cash/settings', { data: { tipCashOut: true } })).ok()).toBe(true);
    const before = (await (await page.request.get('/api/staff/cash/expected')).json()).expected;
    await placed('table-8');
    d = await pay('Masa 08');
    const ask = d.getByRole('radiogroup', { name: 'Bahşiş garsona kasadan nakit verildi mi' });
    await expect(ask).toBeVisible();
    await expect(d.getByRole('button', { name: /Ödemeyi kaydet/ })).toBeDisabled();
    await ask.getByRole('radio', { name: 'Evet' }).click();
    await d.getByRole('button', { name: /Ödemeyi kaydet/ }).click();
    await expect.poll(async () => (await (await page.request.get('/api/staff/cash/expected')).json()).expected).toBe(before - 2000);
    const status = await (await cashier.request.get('/api/staff/cash/status')).json();
    expect(status.movements.some((m: { type: string; amount: number }) => m.type === 'tip_out' && m.amount === 2000)).toBe(true);
    // The movement names its table (10 Ekim: the note was " · kartla bahşiş", the closing showed "· · kartla bahşiş").
    expect(status.movements.find((m: { type: string }) => m.type === 'tip_out').note).toBe('Masa 08 · kartla bahşiş');
  } finally {
    await page.request.post('/api/staff/cash/settings', { data: { tipCashOut: false } });
    await cashier.context().close(); await waiter.context().close();
  }
});

test('K5, K6, K12: gün.ay.yıl dates on an English computer, the waiter starts on Masalar, the sidebar foot on 1366 × 768', async ({ browser }) => {
  const owner = await signedIn(browser, 'isletme', { width: 1366, height: 768 });
  const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 });
  try {
    // K12: Destek, Kilitle and Çıkış in sight without scrolling the menu.
    for (const name of ['Kilitle', 'Çıkış yap']) {
      const b = owner.locator('.sidebar').getByRole('button', { name, exact: true });
      const box = (await b.boundingBox())!;
      expect(box.y + box.height, name).toBeLessThanOrEqual(768);
    }
    // K5: the reservation day reads 08.10.2026 even with an English browser, and takes typed days.
    await openView(owner, 'Ajanda ve rezervasyon');
    const day = owner.getByLabel('Gün', { exact: true });
    await expect(day).toHaveValue(/^\d{2}\.\d{2}\.\d{4}$/);
    await day.fill('');
    await day.pressSequentially('01022027');
    await expect(day).toHaveValue('01.02.2027');
    await expect(owner.getByText('1 Şubat 2027')).toBeVisible();
    // K6: the waiter's phone opens on Masalar, without an empty approvals box.
    await expect(waiter.getByText(/açık \/ \d+/).first()).toBeVisible();
    await expect(waiter.getByText('0 bekleyen')).toHaveCount(0);
  } finally { await owner.context().close(); await waiter.context().close(); }
});

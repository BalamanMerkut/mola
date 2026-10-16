import { test, expect, type Browser, type Page } from '@playwright/test';
import { networkInterfaces } from 'node:os';
import { fakePrinter } from '../fake-printer';
import { ensureSetup, openReport, openView } from './helpers';

/*
 * Hesap kampanyaları (packages/domain/deals.ts): the owner makes "2 al 1 öde" on Demleme Çay and a gift campaign "2 çay →
 * Americano"; the waiter orders 3 teas (one free), the table window's hint adds the Americano (free); the bill, the printed
 * bill, the campaign report and the guest's QR menu say so.
 */
const PASSWORD = 'MolaDemo!2026', PRINTER_PORT = 9107;
const lanAddress = () => Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
async function login(page: Page, role = 'isletme') {
  await page.goto('/');
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(role);
  await page.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await ensureSetup(page.request); await page.reload();
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
}
async function staffPage(browser: Browser, role: string) { const context = await browser.newContext({ viewport: { width: 1024, height: 900 } }); const page = await context.newPage(); await login(page, role); return { context, page }; }
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('2 al 1 öde and a gift: the form, the waiter, the hint, the bill, the report and the guest menu', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  const initial = await (await page.request.get('/api/staff/state')).json();
  const americano = initial.products.find((p: { name: string }) => p.name === 'Americano');
  const [table, guestTable] = initial.tables.filter((t: { account: unknown; needsCleaning?: boolean }) => !t.account && !t.needsCleaning);

  // ---- The owner: Menü → Kampanyalar → Kampanya ekle, one screenshot per new kind. ----
  await openView(page, 'Kampanyalar');
  const editor = page.getByRole('dialog');
  async function pickTea() {
    await editor.getByRole('button', { name: /Menüden seç/ }).click();
    const picker = page.getByRole('dialog', { name: 'Menüden kampanya ürünü seç' });
    await picker.getByRole('button', { name: /Demleme Çay/ }).click();
    await picker.getByRole('button', { name: /Seçimi tamamla/ }).click();
  }
  await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
  const kinds = editor.getByLabel('Kampanya türü');
  await expect(kinds.locator('option')).toHaveText(['Yüzde indirim', 'Tutar indirimi', 'X al Y öde', 'İkincisi indirimli', 'Hediye ürün']);
  await kinds.selectOption('buyPay');
  await expect(editor.getByLabel('Kaç adet alınca?')).toHaveValue('2');
  await expect(editor.getByLabel('Kaçının parası ödenir?')).toHaveValue('1');
  await expect(editor.getByRole('checkbox', { name: 'Adet koşulu ekle' })).toHaveCount(0);
  await pickTea();
  await expect(editor.getByText('Örnek: 2 Demleme Çay alana en ucuz 1 tanesi bedava.')).toBeVisible();
  await expect(editor.getByLabel('Kampanya adı')).toHaveValue('2 al 1 öde · Demleme Çay');
  await expect(editor.locator('.campaign-preview')).toContainText('2 al 1 öde');
  await editor.getByLabel('Kaçının parası ödenir?').fill('2');
  await expect(editor.getByText('Ödenen adet 1–1 arasında olmalı.')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Kampanyayı kaydet' })).toBeDisabled();
  await editor.getByLabel('Kaçının parası ödenir?').fill('1');
  await page.screenshot({ path: info.outputPath('form-x-al-y-ode.png') });
  await editor.getByRole('button', { name: 'Kampanyayı kaydet' }).click();
  const card = page.locator('.campaign-card').filter({ hasText: '2 al 1 öde · Demleme Çay' });
  await expect(card.locator('h3')).toHaveText('2 al 1 öde · Demleme Çay · 2 al 1 öde');
  await expect(card.locator('.campaign-state')).toHaveText('Aktif');

  // "İkincisi indirimli": only looked at, not saved.
  await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
  await kinds.selectOption('second');
  await expect(editor.getByLabel('İkincisinde indirim (%)')).toHaveValue('50');
  await pickTea();
  await expect(editor.getByText('Örnek: 2 Demleme Çay alana ucuz olana %50 indirim.')).toBeVisible();
  await page.screenshot({ path: info.outputPath('form-ikincisi-indirimli.png') });
  await editor.getByRole('button', { name: 'Vazgeç', exact: true }).click();

  await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
  await kinds.selectOption('gift');
  await pickTea();
  await expect(editor.getByText('Hediye ürünü menüden seçin.')).toBeVisible();
  await editor.getByRole('combobox', { name: /^Hediye ürün/ }).selectOption(americano.id);
  await expect(editor.getByText('Örnek: 2 Demleme Çay alana Americano bedava.')).toBeVisible();
  await expect(editor.getByLabel('Kampanya adı')).toHaveValue('Hediye: Americano');
  await page.screenshot({ path: info.outputPath('form-hediye-urun.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('form-hediye-urun-telefon.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await editor.getByRole('button', { name: 'Kampanyayı kaydet' }).click();
  await expect(page.locator('.campaign-card').filter({ hasText: 'Hediye: Americano' }).locator('h3')).toContainText('2 adet alana Americano bedava');
  // A saved account campaign keeps its family: its editor offers no percent or TL.
  await card.getByRole('button', { name: 'Kampanyayı düzenle' }).click();
  await expect(kinds.locator('option')).toHaveText(['X al Y öde', 'İkincisi indirimli', 'Hediye ürün']);
  await editor.getByRole('button', { name: 'Vazgeç', exact: true }).click();

  // ---- The waiter: 3 teas, the basket says one is free. ----
  const waiter = await staffPage(browser, 'garson');
  await openView(waiter.page, 'Sipariş al');
  await waiter.page.getByLabel('Sipariş masası').selectOption(table.id);
  const add = waiter.page.getByRole('button', { name: 'Demleme Çay · bir adet ekle' });
  await add.click(); await add.click(); await add.click();
  await expect(waiter.page.locator('.staff-basket-bar')).toContainText('3 ürün · ₺70');
  await waiter.page.locator('.staff-basket-open').click();
  await expect(waiter.page.getByRole('dialog').locator('.deal-saving')).toContainText('−₺35');
  await waiter.page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(waiter.page.getByText(/Sipariş #\d+ mutfağa gönderildi/)).toBeVisible();
  let state = await (await page.request.get('/api/staff/state')).json();
  const teaOrder = state.orders.find((o: { tableName: string }) => o.tableName === table.name);
  expect(teaOrder.total).toBe(7000);
  expect(teaOrder.lines[0].deals.map((d: { units: number; off: number }) => [d.units, d.off])).toEqual([[1, 3500]]);

  // ---- The table window: "Kampanya: Americano bedava · Ekle" sends it, free. ----
  await openView(waiter.page, 'Masalar');
  await waiter.page.locator('.table-card').filter({ has: waiter.page.getByRole('heading', { name: table.name, exact: true }) }).click();
  const detail = waiter.page.getByRole('dialog', { name: table.name });
  const chip = detail.getByRole('button', { name: /Kampanya: Americano bedava/ });
  await expect(chip).toBeVisible();
  await expect(detail.locator('.deal-label')).toHaveText('2 al 1 öde · −₺35');
  await waiter.page.screenshot({ path: info.outputPath('masa-ipucu.png') });
  await chip.click();
  await expect(waiter.page.locator('.toast')).toContainText('Americano eklendi; kampanyayla bedava.');
  await expect(detail.getByRole('button', { name: /Kampanya: Americano bedava/ })).toHaveCount(0);
  await expect(detail.locator('.deal-label')).toHaveText(['2 al 1 öde · −₺35', 'Hediye: Americano · −₺110']);
  await expect(detail.locator('.table-detail-summary h2')).toHaveText('₺70');
  expect(await fits(waiter.page)).toBe(true);
  await waiter.page.screenshot({ path: info.outputPath('hesap-indirimler.png') });
  state = await (await page.request.get('/api/staff/state')).json();
  const account = state.tables.find((t: { id: string }) => t.id === table.id).account;
  expect(account.total).toBe(7000);
  // The kitchen sees what to make, never the money.
  const kitchen = await staffPage(browser, 'mutfak');
  const kitchenState = await (await kitchen.page.request.get('/api/staff/state')).json();
  expect(kitchenState.orders.flatMap((o: { lines: { deals?: unknown; dealOffers?: unknown }[] }) => o.lines).every((l: { deals?: unknown; dealOffers?: unknown }) => l.deals === undefined && l.dealOffers === undefined)).toBe(true);
  await kitchen.context.close();

  // ---- The printed bill (a pretend printer on this computer's LAN address, when it has one). ----
  const host = lanAddress(), printer = host ? await fakePrinter('0.0.0.0', PRINTER_PORT).catch(() => null) : null;
  if (host && printer) {
    try {
      for (const p of (await (await page.request.get('/api/staff/printers')).json()).printers) await page.request.post('/api/staff/printers/delete', { data: { id: p.id } });
      expect((await page.request.post('/api/staff/printers', { data: { printer: { name: 'Kasa', enabled: true, connection: { type: 'network', host, port: PRINTER_PORT }, width: 80, charset: 'ascii', orders: false, categories: [], bill: true } } })).ok()).toBe(true);
      expect((await page.request.post('/api/staff/print/bill', { data: { accountId: account.id } })).ok()).toBe(true);
      await expect.poll(() => printer.bytes().toString('latin1')).toContain('Hediye: Americano: -110,00 TL');
      const text = printer.bytes().toString('latin1');
      expect(text).toContain('2 al 1 ode: -35,00 TL'); expect(text).toContain('Kampanya indirimi'); expect(text).toContain('-145,00 TL');
    } finally { await printer.close(); }
  } else test.info().annotations.push({ type: 'not', description: 'Yerel ağ adresi ya da yazıcı portu yok: basılı hesap fişi atlandı (birim testleri kapsıyor).' });

  // ---- Paid; Satış ve Raporlar → Kampanyalar. ----
  expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 7000, tendered: 7000, method: 'cash' } })).ok()).toBe(true);
  const report = await (await page.request.get('/api/staff/reports/campaigns')).json();
  const twoForOne = report.campaigns.find((c: { name: string }) => c.name === '2 al 1 öde · Demleme Çay'), gift = report.campaigns.find((c: { name: string }) => c.name === 'Hediye: Americano');
  expect([twoForOne.kind, twoForOne.appliedQuantity, twoForOne.discount]).toEqual(['buyPay', 1, 3500]);
  expect([gift.kind, gift.appliedQuantity, gift.discount, gift.giftName]).toEqual(['gift', 1, 11000, 'Americano']);
  await openReport(page, 'Kampanyalar');
  await page.getByLabel('Kampanya dönemi').selectOption(gift.id);
  await expect(page.locator('.campaign-order-totals')).toContainText('Bedava verilen adet');
  await expect(page.locator('.campaign-order-totals')).toContainText('₺110');
  await expect(page.getByLabel('Kampanya dönemi').locator('option:checked')).toContainText('2 adet alana Americano bedava');
  await page.screenshot({ path: info.outputPath('rapor-hediye.png'), fullPage: true });

  // ---- The guest's QR menu names both campaigns on the teas and the gift on the Americano. ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await phone.newPage();
    await guest.goto(`/m/${guestTable.token}`);
    const card = (name: string) => guest.locator('.product-card').filter({ has: guest.getByRole('heading', { name, exact: true }) });
    const teaCard = card('Demleme Çay');
    await expect(teaCard).toContainText('2 al 1 öde');
    await expect(teaCard).toContainText('2 Demleme Çay alana Americano bedava');
    await expect(teaCard).toContainText('₺35');
    await expect(card('Americano')).toContainText('2 Demleme Çay alana bedava');
    expect(await fits(guest)).toBe(true);
    await guest.screenshot({ path: info.outputPath('misafir-menu.png'), fullPage: true });
    await teaCard.click();
    await expect(guest.getByRole('dialog')).toContainText('Masanın hesabındaki bütün siparişler birlikte sayılır');
    await guest.getByRole('button', { name: 'Adedi artır' }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await expect(guest.getByRole('dialog').locator('.deal-saving')).toContainText('−₺35');
    await expect(guest.getByRole('dialog').locator('.total-line').last()).toContainText('₺35');
    await guest.screenshot({ path: info.outputPath('misafir-sepet.png') });
  } finally { await phone.close(); await waiter.context.close(); }
  expect(errors).toEqual([]);
});

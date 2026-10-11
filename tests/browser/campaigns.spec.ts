import { test, expect } from '@playwright/test';
import { ensureSetup, openReport, openView, reportTabs } from './helpers';

test('owner campaign applies to customer, preserves accepted price and hides financials from kitchen', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  const initial = await (await page.request.get('/api/staff/state')).json();
  await page.goto('/'); await openView(page, 'Kampanyalar');
  await page.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const campaignCard = page.locator('.campaign-card').filter({ hasText: 'Açılışa özel' });
  await dialog.getByLabel('Kampanya adı').fill('Açılışa özel');
  await dialog.getByLabel('İndirim (%)').fill('20');
  await dialog.getByRole('button', { name: /Menüden seç/ }).click();
  const picker = page.getByRole('dialog', { name: 'Menüden kampanya ürünü seç' });
  // A new business has no sales yet: the empty best-seller tab is not shown.
  await expect(picker.getByRole('button', { name: /Demleme Çay/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Çok satanlar · Son 30 gün' })).toHaveCount(0);
  await picker.getByRole('button', { name: /Demleme Çay/ }).click();
  await picker.getByRole('button', { name: /Seçimi tamamla/ }).click();
  await page.route('**/api/staff/campaigns', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fetch(); await route.abort('failed'); await page.unroute('**/api/staff/campaigns');
  });
  await dialog.getByRole('button', { name: 'Kampanyayı kaydet', exact: true }).click();
  await dialog.getByRole('button', { name: 'Kampanya kaydını yeniden kontrol et', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Açılışa özel · %20' })).toHaveCount(1);
  // A date-range campaign keeps its familiar label.
  await expect(campaignCard).toContainText('Aktif · 1 ürün · Süresiz');
  const customer = await browser.newContext(), kitchen = await browser.newContext();
  try {
    const guest = await customer.newPage(); await guest.goto(`/m/${initial.tables[0].token}`);
    await guest.getByRole('button', { name: 'Kampanyalı ürünler', exact: true }).click();
    await expect(guest.getByRole('button', { name: /Caffè Latte/ })).toHaveCount(0);
    const product = guest.getByRole('button', { name: /Demleme Çay/ });
    await expect(product).toContainText('₺28'); await product.click();
    await expect(guest.getByRole('dialog')).toContainText('Açılışa özel');
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await expect(guest.getByRole('dialog')).toContainText('₺28');
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    const orders = (await (await page.request.get('/api/staff/state')).json()).orders;
    const order = orders.find((o: any) => o.tableName === initial.tables[0].name && !initial.orders.some((old: any) => old.id === o.id));
    expect(order.total).toBe(2800); expect(order.lines[0].originalUnitPrice).toBe(3500);
    await kitchen.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
    expect((await kitchen.request.get('/api/staff/campaigns')).status()).toBe(403);
    const hidden = (await (await kitchen.request.get('/api/staff/state')).json()).orders.find((o: any) => o.id === order.id);
    expect(hidden.lines[0].originalUnitPrice).toBeUndefined();
    await campaignCard.getByRole('button', { name: 'Kampanyayı düzenle', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Kampanya etkin', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Kampanyayı kaydet', exact: true }).click();
    // With no active campaign left, the empty campaign tab disappears and the guest is back on the full menu.
    await expect(guest.getByRole('button', { name: 'Kampanyalı ürünler', exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Tümü', exact: true })).toHaveClass(/selected/);
    await guest.getByRole('button', { name: 'Tümü', exact: true }).click();
    await expect(product).toContainText('₺35');
    expect((await kitchen.request.get('/api/staff/reports/campaigns')).status()).toBe(403);
    const report = await (await page.request.get('/api/staff/reports/campaigns')).json();
    expect(report.campaigns[0].appliedAmount).toBe(2800);
    expect((await (await page.request.get('/api/staff/state')).json()).orders.find((o: any) => o.id === order.id).total).toBe(2800);
    await page.setViewportSize({ width: 390, height: 844 });
    await campaignCard.getByRole('button', { name: 'Kampanyayı düzenle', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('campaign-mobile.png') });
    await dialog.getByRole('button', { name: /Menüden seç/ }).click();
    await picker.getByRole('button', { name: 'Çok satanlar · Son 30 gün' }).click();
    await expect(picker.getByRole('button', { name: /Demleme Çay/ })).toContainText('1 adet');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('campaign-picker-mobile.png') });
    await picker.getByRole('button', { name: /Seçimi tamamla/ }).click();
    await dialog.getByRole('button', { name: 'Kapat', exact: true }).click();
    const state = await (await page.request.get('/api/staff/state')).json();
    const account = state.tables[0].account;
    expect((await page.request.post('/api/staff/settings', { data: { changeSeconds: state.changeSeconds, commissionBps: 1000 } })).ok()).toBe(true);
    expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, method: 'card', amount: 2800, tendered: 2800 } })).ok()).toBe(true);
    await openView(page, 'Satış ve Raporlar');
    await expect(page.locator('.kpi-main')).toContainText('Elde kalan');
    // The campaign share of sales is no longer a card on the summary; the report data still has to split it correctly.
    // Reports run on business days (05:00–05:00 Türkiye): after midnight today is still the evening's date.
    const day = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10);
    expect((await (await page.request.get(`/api/staff/reports/financial?from=${day}&to=${day}`)).json()).campaignCollected).toBe(2800);
    // 10% POS commission on the 28 TL card payment is shown under "Çıkan para".
    await expect(page.locator('.kpi').nth(1)).toContainText('POS ₺2,80');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('commission-mobile.png'), fullPage: true });
    await openReport(page, 'Kampanyalar');
    await expect(page.getByRole('heading', { name: 'Kampanya performansı' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bu kampanyanın uygulandığı siparişler' })).toBeVisible();
    // Undiscounted value sits next to the discount; the method is one help bubble, not an open/close box.
    await expect(page.locator('.campaign-order-totals')).toContainText('Kampanyasız tutar₺35');
    await expect(page.getByText('Önceki 7 gün', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Karşılaştırma nasıl hesaplanır hakkında bilgi' }).click();
    await expect(page.getByRole('tooltip')).toContainText('(7 gün)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('campaign-report-mobile.png'), fullPage: true });
    // Switch the same campaign from percentage to TL; its previous order and report must survive.
    await openView(page, 'Kampanyalar');
    await campaignCard.getByRole('button', { name: 'Kampanyayı düzenle', exact: true }).click();
    await dialog.getByLabel('İndirim türü').selectOption('fixed');
    const amount = dialog.getByLabel('İndirim tutarı (TL)');
    for (const invalid of ['0', '-10', '1,234', '1000001']) {
      await amount.fill(invalid);
      await expect(dialog.getByRole('button', { name: 'Kampanyayı kaydet', exact: true })).toBeDisabled();
    }
    await amount.fill('10,25');
    await dialog.getByRole('checkbox', { name: 'Kampanya etkin', exact: true }).check();
    await dialog.getByText('İndirimler nasıl birleşir?', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('fixed-campaign-mobile.png'), fullPage: true });
    await page.route('**/api/staff/campaigns', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fetch(); await route.abort('failed'); await page.unroute('**/api/staff/campaigns');
    });
    await dialog.getByRole('button', { name: 'Kampanyayı kaydet', exact: true }).click();
    await dialog.getByRole('button', { name: 'Kampanya kaydını yeniden kontrol et', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Açılışa özel · 10,25 TL indirim', exact: true })).toHaveCount(1);
    await guest.goto(`/m/${initial.tables[1].token}`);
    await expect(product).toContainText('₺24,75');
    await product.click();
    await guest.getByRole('button', { name: 'Adedi artır', exact: true }).click();
    await expect(guest.getByRole('button', { name: /Sepete ekle/ })).toContainText('₺49,50');
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    const fixedState = await (await page.request.get('/api/staff/state')).json();
    const fixedOrder = fixedState.orders.find((o: any) => o.tableName === initial.tables[1].name);
    expect(fixedOrder.total).toBe(4950); expect(fixedOrder.lines[0].originalUnitPrice).toBe(3500);
    expect(fixedState.orders.find((o: any) => o.id === order.id).total).toBe(2800);
    const fixedAccount = fixedState.tables[1].account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: fixedAccount.id, version: fixedAccount.version, method: 'cash', amount: 4950, tendered: 5000 } })).ok()).toBe(true);
    await campaignCard.getByRole('button', { name: 'Kampanyayı düzenle', exact: true }).click();
    await expect(amount).toHaveValue('10,25');
    await dialog.getByRole('checkbox', { name: 'Kampanya etkin', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Kampanyayı kaydet', exact: true }).click();
    const fixedReport = await (await page.request.get('/api/staff/reports/campaigns')).json();
    const fixedPeriod = fixedReport.campaigns.find((c: any) => c.kind === 'fixed');
    expect(fixedPeriod.amount).toBe(1025); expect(fixedPeriod.appliedAmount).toBe(4950); expect(fixedPeriod.discount).toBe(2050);
    await openView(page, 'Satış ve Raporlar');
    // The reports open where they were left on this device (Satış → Kampanyalar); Özet is one tap away.
    await expect(reportTabs(page).getByRole('button', { name: 'Kampanyalar', exact: true })).toHaveAttribute('aria-current', 'page');
    await openReport(page, 'Özet');
    await expect(page.locator('.kpi-main')).toContainText('Elde kalan');
    const today = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10); // the business day (05:00 Türkiye)
    expect((await (await page.request.get(`/api/staff/reports/financial?from=${today}&to=${today}`)).json()).campaignCollected).toBe(7750);
    await openReport(page, 'Kampanyalar');
    await page.getByLabel('Kampanya dönemi').selectOption(fixedPeriod.id);
    await expect(page.getByLabel('Kampanya dönemi').locator('option:checked')).toContainText('10,25 TL indirim');
    await expect(page.getByText('₺49,50', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('fixed-campaign-report-mobile.png'), fullPage: true });
  } finally { await customer.close(); await kitchen.close(); }
});

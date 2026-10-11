import { test, expect, type APIRequestContext } from '@playwright/test';
import { ensureSetup, openReport, reportGroups, reportTabs } from './helpers';
async function order(request: APIRequestContext, tableId: string, lines: { productId: string; quantity: number }[], expectedTotal: number) {
  expect((await request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID(), tableId, lines: lines.map(l => ({ ...l, selections: [] })), expectedTotal } })).ok()).toBe(true);
  return (await (await request.get('/api/staff/state')).json()).tables.find((t: any) => t.id === tableId).account;
}
test('owner finds a payment in the statement, corrects cash to card and records a partial refund', async ({ page }, info) => {
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true); await ensureSetup(page.request);
  await page.request.post('/api/staff/heartbeat', { data: {} });
  const account = await order(page.request, 'table-12', [{ productId: 'tea', quantity: 1 }], 3500);
  expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 3500, tendered: 5000, method: 'cash' } })).ok()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click(); await openReport(page, 'İade ve düzeltme');
  await expect(page.getByRole('heading', { name: 'İade ve düzeltme' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Tahsilat dönemi' }).getByRole('button', { name: 'Bugün', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const row = page.locator('.ledger-row').filter({ hasText: 'Masa 12' });
  await expect(row).toHaveCount(1); await expect(row.locator('.ledger-badge')).toHaveText(['Nakit']);
  // One search box: a table, an amount or a time; nothing else matches.
  const search = page.getByLabel('Tahsilat ara', { exact: true });
  for (const [text, found] of [['Masa 11', 0], ['12', 1], ['35', 1], ['35,50', 0], ['Masa 12', 1]] as const) {
    await search.fill(text); await expect(row).toHaveCount(found);
    if (!found) await expect(page.getByText('Aramanıza uygun tahsilat yok.', { exact: true })).toBeVisible();
  }
  // Method correction with POS commission, then a partial refund: the same rules and form as before.
  await row.getByRole('button', { name: 'Düzelt / iade', exact: true }).click();
  await page.getByRole('combobox', { name: 'İşlem', exact: true }).selectOption('method'); await page.getByLabel('Doğru ödeme yöntemi').selectOption('card');
  await page.getByLabel('Kaydedilecek POS komisyonu (TL) *').fill('1'); await page.getByLabel('Gerekçe *').fill('Kart olarak alındı');
  await page.getByRole('button', { name: 'Kaydı onayla' }).click(); await expect(row.getByText('Karta çevrildi', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Düzelt / iade', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Ödeme yöntemini düzelt' })).toHaveJSProperty('disabled', false);
  // "Tutar olarak iade" (item refunds are tests/browser/refunds.spec.ts); the method starts as the payment's own (now card).
  await page.getByRole('button', { name: 'Tutar olarak iade', exact: true }).click();
  await page.getByLabel('İade tutarı (TL) *').fill('10');
  await page.getByRole('group', { name: 'İade nedeni' }).getByRole('button', { name: 'Diğer' }).click(); await page.getByLabel('Açıklama *').fill('Kısmi iade yapıldı');
  // A refund asks once more, with the amount and the method, before it is recorded.
  await page.getByRole('button', { name: 'İadeyi kaydet' }).click();
  await expect(page.getByRole('group', { name: 'İade onayı' })).toContainText('₺10 kart iade');
  await page.getByRole('button', { name: 'Evet, iadeyi kaydet' }).click(); await expect(row.getByText('Kısmi iade ₺10', { exact: true })).toBeVisible();
  await expect(row.locator('.ledger-badge')).toHaveText(['Kart', 'Kısmi iade ₺10', 'Karta çevrildi']);
  // Filter chips use the corrected method.
  await search.fill('');
  // The search is applied a moment after typing (and closes an open form when it reloads): wait for it.
  await expect(page.locator('.ledger-summary')).not.toContainText('(filtreli)');
  const kinds =page.getByRole('group', { name: 'Tahsilat türü' }), periods = page.getByRole('group', { name: 'Tahsilat dönemi' });
  for (const [chip, found] of [['Nakit', 0], ['Kart', 1], ['Düzeltilenler', 1], ['Tümü', 1]] as const) {
    await kinds.getByRole('button', { name: chip, exact: true }).click();
    await expect(kinds.getByRole('button', { name: chip, exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(row).toHaveCount(found);
  }
  // A row opens on click (not the button): items, commission, corrections with reason and who recorded them.
  await row.locator('.ledger-main').click(); await expect(row.locator('.ledger-main')).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByText('1 × Demleme Çay', { exact: true })).toBeVisible();
  await expect(row.getByText('Ürün seçilmeden tutar olarak alındı.', { exact: false })).toBeVisible();
  await expect(row.locator('.ledger-facts')).toContainText('POS komisyonu₺1');
  await expect(row.locator('.ledger-corrections li')).toHaveCount(2);
  await expect(row.getByText('Kart olarak alındı', { exact: true })).toBeVisible(); await expect(row.getByText('Kısmi iade yapıldı', { exact: true })).toBeVisible();
  await expect(row.locator('.ledger-corrections li').first()).toContainText('İşletme sahibi');
  await expect(page.getByRole('option', { name: 'Ödeme yöntemini düzelt' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Düzelt / iade', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Ödeme yöntemini düzelt' })).toHaveJSProperty('disabled', true);
  await expect(page.getByText('Kalan iade hakkı: ₺25', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  // The note about refunds lives in the help next to the heading.
  await page.getByRole('button', { name: 'İade ve düzeltme hakkında bilgi', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('İade kaydı bankadan para göndermez');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('refund-ledger-mobile.png'), fullPage: true });
  // Own period control: Bugün · 7 gün · 30 gün · 1 yıl · Tümü, or any custom range; long periods count their totals apart.
  for (const [pill, label] of [['7 gün', 'Son 7 gün'], ['30 gün', 'Son 30 gün'], ['1 yıl', 'Son 1 yıl'], ['Tümü', 'Tüm zamanlar']] as const) {
    await periods.getByRole('button', { name: pill, exact: true }).click(); await expect(periods.getByRole('button', { name: pill, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ledger-summary')).toContainText(`${label} · 1 tahsilat · ₺35`); await expect(row).toHaveCount(1);
  }
  await periods.getByRole('button', { name: 'Tarih seç', exact: true }).click();
  await page.getByLabel('Başlangıç', { exact: true }).fill('2020-01-01'); await page.getByLabel('Bitiş', { exact: true }).fill('2020-12-31');
  await page.getByRole('button', { name: 'Göster', exact: true }).click();
  await expect(page.locator('.ledger-summary')).toContainText('1 Oca 2020 – 31 Ara 2020'); await expect(page.getByText('Bu dönemde tahsilat yok.', { exact: true })).toBeVisible();
  await periods.getByRole('button', { name: 'Bugün', exact: true }).click(); await expect(row).toHaveCount(1);
  await openReport(page, 'Özet');
  // 35 TL sale − 1 TL POS commission − 10 TL refund.
  const kept = page.locator('.kpi-main'); await expect(kept).toContainText('İadeler ₺10'); await expect(kept.locator('strong')).toHaveText('₺24');
  const after = await (await page.request.get('/api/staff/state')).json(); expect(after.tables.find((t: any) => t.id === 'table-12').account).toBeNull();
  await page.screenshot({ path: info.outputPath('refund-summary-mobile.png'), fullPage: true });
});

test('the statement pages by 50 rows and keeps scroll and content while it refreshes', async ({ page }) => {
  test.setTimeout(120000);
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true); await ensureSetup(page.request);
  // 56 payments today: 55 small ones on Masa 03, one on Masa 12.
  let account = await order(page.request, 'table-3', [{ productId: 'tea', quantity: 20 }, { productId: 'herbal', quantity: 20 }], 240000);
  for (let i = 0; i < 55; i++) {
    expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 3500, tendered: 3500, method: i % 2 ? 'card' : 'cash' } })).ok()).toBe(true);
    account = { ...account, version: account.version + 1 };
  }
  const other = await order(page.request, 'table-12', [{ productId: 'tea', quantity: 1 }], 3500);
  expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: other.id, version: other.version, amount: 3500, tendered: 3500, method: 'cash' } })).ok()).toBe(true);
  // Earlier tests in this file may have added payments today; the statement counts all of them.
  const total = (await (await page.request.get('/api/staff/payment-adjustments')).json()).total as number; expect(total).toBeGreaterThanOrEqual(56);
  await page.setViewportSize({ width: 390, height: 650 }); await page.goto('/');
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click(); await openReport(page, 'İade ve düzeltme');
  const rows = page.locator('.ledger-row');
  await expect(rows).toHaveCount(50); await expect(page.getByText(`50 / ${total} gösteriliyor`, { exact: true })).toBeVisible();
  await expect(rows.first()).toContainText('Masa 12');
  await page.getByRole('button', { name: 'Daha fazla göster', exact: true }).click();
  await expect(rows).toHaveCount(total); await expect(page.getByRole('button', { name: 'Daha fazla göster', exact: true })).toHaveCount(0);
  await expect(page.locator('.ledger-summary')).toContainText(`${total} tahsilat`);
  // Refresh while scrolled down: the old rows stay mounted and the page does not jump.
  await page.getByText(`${total} / ${total} gösteriliyor`, { exact: true }).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY); expect(before).toBeGreaterThan(500);
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  await page.route('**/api/staff/payment-adjustments?*', async route => { await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Yenile', exact: true }).dispatchEvent('click');
    await expect(page.getByText('Güncelleniyor… Önceki sonuçlar gösteriliyor.', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(total); expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(5);
  } finally { release(); }
  await expect(page.getByText('Güncelleniyor… Önceki sonuçlar gösteriliyor.', { exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(total); expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(5);
  await page.unroute('**/api/staff/payment-adjustments?*');
  // Server-side filters narrow the whole period, not only the rows on screen.
  await page.getByLabel('Tahsilat ara', { exact: true }).fill('Masa 3');
  await expect(page.locator('.ledger-summary')).toContainText('55 tahsilat'); await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Kart', exact: true }).click();
  await expect(page.locator('.ledger-summary')).toContainText('27 tahsilat'); await expect(rows).toHaveCount(27);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('"Ödemeyi düzelt" on a table just paid opens the statement on that table and day', async ({ page }) => {
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true); await ensureSetup(page.request);
  const account = await order(page.request, 'table-5', [{ productId: 'tea', quantity: 2 }], 7000);
  expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, amount: 7000, tendered: 7000, method: 'card' } })).ok()).toBe(true);
  const table = (await (await page.request.get('/api/staff/state')).json()).tables.find((t: any) => t.id === 'table-5');
  expect(table.account).toBeNull(); expect(table.lastPaidAt).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  // The owner's phone has the plain tiles too (K-S, 9 Ekim).
  await page.locator(`.floor-tile[data-table="${table.id}"]`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Kapanan hesabın son ödemesi');
  await dialog.getByRole('button', { name: 'Ödemeyi düzelt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'İade ve düzeltme' })).toBeVisible();
  // The link lands on its home (10 Ekim): Kasa ve giderler → İadeler.
  await expect(page.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }).getByRole('button', { name: /^İadeler/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Tahsilat ara', { exact: true })).toHaveValue(table.name);
  await expect(page.getByRole('group', { name: 'Tahsilat dönemi' }).getByRole('button', { name: 'Bugün', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ledger-row')).toHaveCount(1); await expect(page.locator('.ledger-row')).toContainText(table.name);
  await expect(page.locator('.ledger-summary')).toContainText('Bugün · 1 tahsilat · ₺70 (filtreli)');
  // The row is ready to correct (the owner-only field is covered in tests/payment-history.test.ts).
  await expect(page.locator('.ledger-row').getByRole('button', { name: 'Düzelt / iade', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openCash, openMenu, openSettings, openView, reportAction, reportGroups } from './helpers';

// A new device: Satış ve Raporlar opens on the plain summary (the other specs remember "Detaylı göster").
test.use({ storageState: { cookies: [], origins: [] } });

/** Screens for the owner: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
const login = async (page: Page) => { await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request); };
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
/** Two bills today: tea (KDV %10) in cash, a product of another category made %20 by card. */
async function sales(page: Page) {
  const state = await (await page.request.get('/api/staff/state')).json(), tea = state.products.find((p: { id: string }) => p.id === 'tea');
  const other = state.products.find((p: { category: string; groups: unknown[]; unit?: string; published?: boolean }) => p.category !== tea.category && !p.groups.length && p.unit !== 'kg' && p.published !== false);
  expect((await page.request.post('/api/staff/vat/apply', { data: { requestId: crypto.randomUUID(), category: other.category, rate: 20 } })).ok()).toBe(true);
  for (const [i, [product, quantity, method]] of ([[tea, 3, 'cash'], [other, 2, 'card']] as const).entries()) {
    const placed = await page.request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID(), tableId: state.tables[i + 2].id, lines: [{ productId: product.id, quantity, selections: [] }], expectedTotal: product.price * quantity } });
    expect(placed.ok(), await placed.text()).toBe(true);
    const account = (await (await page.request.get('/api/staff/state')).json()).tables[i + 2].account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: account.id, version: account.version, method, amount: account.balance, tendered: account.balance } })).ok()).toBe(true);
  }
  return { tea, other, total: tea.price * 3 + other.price * 2 };
}

test('Satış ve Raporlar: sade özet first, "Detaylı göster" remembered, KDV dökümü, Yazdır / PDF, Muhasebeci için indir; nothing overflows 360–1280', async ({ page }, info) => {
  test.setTimeout(150_000);
  await login(page); const sold = await sales(page);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openView(page, 'Satış ve Raporlar');
  // The plain summary: one sentence, the numbers that matter, the kasa; no tabs yet.
  const summary = page.getByLabel('Sade özet');
  // K-N: the list is in order of money taken, so it is "En çok kazandıran" with the amount.
  await expect(page.getByTestId('simple-sentence')).toHaveText(/^Bugün 2 sipariş, ₺[\d.,]+ satış\. En çok kazandıran: .+ \(₺[\d.,]+\)\. Kasa/);
  await expect(summary.getByText('Elde kalan = satış − giderler − iadeler − kart komisyonu')).toBeVisible();
  await expect(summary.getByLabel('Ödeme türleri')).toContainText('Nakit'); await expect(summary.getByLabel('Ödeme türleri')).toContainText('Kart');
  await expect(summary.getByLabel('En çok kazandıranlar').locator('li')).toHaveCount(2);
  await expect(summary.getByRole('heading', { name: 'En çok kazandıran 3 ürün' })).toBeVisible();
  await expect(summary.getByLabel('Kasa durumu')).toBeVisible();
  // Prices include KDV (11 Ekim): the Satış card says how much of it is KDV, the same sum as the KDV dökümü.
  const kdv = (gross: number, rate: number) => gross - Math.round(gross * 100 / (100 + rate)), inside = kdv(sold.tea.price * 3, 10) + kdv(sold.total - sold.tea.price * 3, 20);
  await expect(summary.getByTestId('simple-vat')).toHaveText(`Bu satışın içindeki KDV: ${new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: inside % 100 ? 2 : 0 }).format(inside / 100)}`);
  await expect(reportGroups(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Dönem' })).toBeVisible();
  await shot(page, 'rapor-sade.png', info.outputPath('rapor-sade.png'));

  // "Detaylı göster": the reports as before, with the KDV dökümü under Özet; remembered on this device.
  await page.getByRole('button', { name: 'Detaylı göster' }).click();
  await expect(reportGroups(page)).toBeVisible();
  await expect(page.locator('.kpi-main')).toContainText('Elde kalan');
  await expect(page.getByText('POS komisyonu = bankanın kart satışlarından aldığı pay')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'En çok kazandıranlar' })).toBeVisible();
  // K-O: today holds the bills open now.
  await expect(page.getByTestId('open-accounts')).toContainText('Açık hesaplar:');
  const vat = page.getByRole('region', { name: 'KDV dökümü' }).or(page.getByLabel('KDV dökümü'));
  await expect(vat.locator('tbody tr')).toHaveCount(2);
  await expect(vat.locator('tbody tr').first()).toContainText('%10'); await expect(vat.locator('tbody tr').nth(1)).toContainText('%20');
  await expect(vat.locator('tfoot')).toContainText(new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: sold.total % 100 ? 2 : 0 }).format(sold.total / 100));
  await expect(vat).toContainText('Bilgi amaçlıdır; resmi beyan yazar kasa ve mali müşaviriniz üzerinden yapılır.');
  await shot(page, 'rapor-detay.png', info.outputPath('rapor-detay.png'));
  await vat.scrollIntoViewIfNeeded();
  await vat.screenshot({ path: info.outputPath('kdv-dokumu.png') });
  if (process.env.KAFE_EKRAN) await vat.screenshot({ path: join(process.env.KAFE_EKRAN, 'kdv-dokumu.png') });
  // K-P: "Yıl" (this year so far) is compared with the same dates of last year, in plain words.
  await page.getByRole('group', { name: 'Dönem' }).getByRole('button', { name: 'Yıl', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.kpi').first()).toContainText('geçen yılın aynı dönemine göre');
  await expect(page.locator('.kpi').first()).not.toContainText(/önceki \d+ gün/);
  await page.getByRole('group', { name: 'Dönem' }).getByRole('button', { name: 'Bugün', exact: true }).click();
  await page.reload(); await openView(page, 'Satış ve Raporlar');
  await expect(reportGroups(page)).toBeVisible();
  await page.getByRole('button', { name: 'Sade özete dön' }).click();
  await expect(page.getByTestId('simple-sentence')).toBeVisible();
  await page.reload(); await openView(page, 'Satış ve Raporlar');
  await expect(page.getByTestId('simple-sentence')).toBeVisible(); await expect(reportGroups(page)).toHaveCount(0);

  // "Yazdır / PDF": a clean A4 page of the open report and period, printed by the browser; "PDF indir" from the café computer.
  await reportAction(page, 'Yazdır / PDF');
  const dialog = page.getByRole('dialog', { name: 'Yazdır / PDF' });
  const paper = page.frameLocator('iframe[title="Yazdırılacak sayfa"]');
  await expect(paper.locator('h1')).toHaveText(/ · \d+ Ekim 2026 \S+ · Satış özeti$/);
  await expect(paper.locator('.lead')).toHaveText(/^Bugün şu ana kadar 2 sipariş/);
  await expect(paper.getByRole('heading', { name: 'KDV dökümü' })).toBeVisible();
  await expect(paper.locator('button, nav, .sidebar')).toHaveCount(0);
  await page.evaluate(() => { const w = document.querySelector<HTMLIFrameElement>('iframe[title="Yazdırılacak sayfa"]')!.contentWindow!; (window as unknown as { printed: number }).printed = 0; w.print = () => { (window as unknown as { printed: number }).printed++; }; });
  await dialog.getByRole('button', { name: 'Yazdır' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await shot(page, 'rapor-yazdir.png', info.outputPath('rapor-yazdir.png'), false);
  // A PDF when this computer has Edge or Chrome, else the plain hint.
  const download = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
  await dialog.getByRole('button', { name: 'PDF indir' }).click();
  await expect(dialog.getByText(/PDF indirildi: Mola-Satis-ozeti-\d{4}-\d{2}-\d{2}\.pdf|PDF olarak kaydet/)).toBeVisible({ timeout: 60_000 });
  const pdf = await download;
  if (pdf) { expect(pdf.suggestedFilename()).toMatch(/\.pdf$/); expect(readFileSync(await pdf.path()).subarray(0, 5).toString('latin1')).toBe('%PDF-'); }
  await dialog.getByRole('button', { name: 'Kapat' }).first().click();

  // No "Para" group any more (13 Ekim); a record book prints from its home: Kasa ve giderler → Giderler.
  await page.getByRole('button', { name: 'Detaylı göster' }).click();
  await expect(reportGroups(page).getByRole('button', { name: 'Para', exact: true })).toHaveCount(0);
  await openCash(page, 'Giderler', 'Kayıtlar');
  await reportAction(page, 'Yazdır / PDF');
  await expect(paper.locator('h1')).toHaveText(/ · Giderler$/);
  await expect(paper.getByRole('heading', { name: 'Gider kayıtları' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Yazdır / PDF' }).getByRole('button', { name: 'Kapat' }).first().click();

  // "Muhasebeci için indir": one .xlsx of the chosen period.
  await reportAction(page, 'Muhasebeci için indir');
  const excel = page.getByRole('dialog', { name: 'Muhasebeci için indir' });
  await expect(excel.getByRole('radio', { name: /Bu ay/ })).toBeVisible();
  // K-M: early in a month "Geçen ay" is chosen only when the month before sold something; else "Bu ay".
  const today = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10), [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), lastEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const before = await (await page.request.get(`/api/staff/reports/overview?from=${last}-01&to=${lastEnd}`)).json();
  const expected = Number(today.slice(8, 10)) <= 10 && (before.sales || before.orders) ? /^Geçen ay/ : /^Bu ay/;
  await expect(excel.getByRole('radio', { name: expected })).toBeChecked();
  await expect(excel.getByRole('button', { name: 'Excel dosyasını indir' })).toBeEnabled();
  await excel.getByRole('radio', { name: /Ekrandaki dönem/ }).check();
  const file = page.waitForEvent('download');
  await excel.getByRole('button', { name: 'Excel dosyasını indir' }).click();
  const xlsx = await file;
  expect(xlsx.suggestedFilename()).toMatch(/^Mola-Muhasebe-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const bytes = readFileSync(await xlsx.path());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  for (const part of ['xl/workbook.xml', 'xl/worksheets/sheet6.xml', 'xl/worksheets/sheet7.xml']) expect(bytes.includes(Buffer.from(part))).toBe(true);
  await expect(excel.getByText(/İndirildi: Mola-Muhasebe/)).toBeVisible();
  await excel.getByRole('button', { name: 'Kapat' }).first().click();

  // Nothing wider than the screen, on the plain summary and the detailed Özet (back from Kasa ve giderler).
  await openView(page, 'Satış ve Raporlar');
  await page.getByRole('button', { name: 'Sade özete dön' }).click();
  for (const width of [360, 390, 768, 820, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('simple-sentence')).toBeVisible();
    expect(await fits(page), `sade özet ${width}`).toBe(true);
    const tools = await page.getByRole('group', { name: 'Rapor dosyaları' }).boundingBox();
    expect(tools!.x + tools!.width, `tools ${width}`).toBeLessThanOrEqual(width + 1);
  }
  await page.getByRole('button', { name: 'Detaylı göster' }).click();
  await reportGroups(page).getByRole('button', { name: 'Satış', exact: true }).click();
  await page.getByRole('navigation', { name: 'Rapor sekmeleri' }).getByRole('button', { name: 'Özet', exact: true }).click();
  for (const width of [360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('KDV dökümü').locator('tbody tr').first()).toBeVisible();
    expect(await fits(page), `detaylı ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Sade özete dön' }).click();
  await shot(page, 'rapor-sade-telefon.png', info.outputPath('rapor-sade-telefon.png'));
  await reportAction(page, 'Yazdır / PDF');
  await expect(paper.locator('h1')).toBeVisible();
  expect(await fits(page), 'print preview 390').toBe(true);
});

test('KDV: Menü yönetimi → KDV oranları (once Ayarlar → Giderler ve kâr); Menü yönetimi → ürün → KDV (default %10, alcohol hint %20, bölüme uygula); no KDV on the guest menu', async ({ page }, info) => {
  test.setTimeout(90_000);
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openSettings(page, 'KDV oranları');
  const card = page.locator('.vat-card');
  await expect(card.getByRole('heading', { name: 'KDV oranları' })).toBeVisible();
  await expect(card.locator('.vat-rate')).toHaveCount(2);
  await expect(card.locator('.vat-rate.is-default')).toContainText('%10');
  await card.getByLabel('Yeni KDV oranı (%)').fill('1'); await card.getByRole('button', { name: 'Ekle' }).click();
  await expect(card.locator('.vat-rate')).toHaveCount(3);
  await card.getByRole('button', { name: 'Kaydet' }).click();
  await expect(card.getByText(/^Kaydedildi\./)).toBeVisible();
  await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: info.outputPath('kdv-oranlari.png') });
  if (process.env.KAFE_EKRAN) await card.screenshot({ path: join(process.env.KAFE_EKRAN, 'kdv-oranlari.png') });

  await openMenu(page, 'Ürünler');
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const select = dialog.getByLabel('KDV', { exact: true });
  await expect(select).toHaveValue('10');
  await expect(select.locator('option')).toHaveText(['%1', '%10 (varsayılan)', '%20']);
  await dialog.getByLabel('Ürün adı', { exact: true }).fill('Efes Bira');
  // A new product that reads like alcohol starts on %20 by itself (8 Ekim denetimi: the hint alone let "Bira" go out at %10).
  await expect(select).toHaveValue('20');
  await expect(dialog.getByText('Alkollü içecek gibi göründüğü için %20 seçildi. Değilse yukarıdan değiştirin.')).toBeVisible();
  // The owner's own choice wins: %10 stays, the old hint offers %20 again.
  await select.selectOption('10');
  await expect(dialog.getByText(/Alkollü içecek gibi görünüyor: genelde %20 uygulanır/)).toBeVisible();
  await dialog.getByRole('button', { name: '%20 seç' }).click();
  await expect(select).toHaveValue('20'); await expect(dialog.getByText(/Alkollü içecek gibi/)).toHaveCount(0);
  await dialog.getByLabel('Kategori', { exact: true }).selectOption('Soğuk İçecekler');
  await dialog.getByLabel('Fiyat (TL)', { exact: true }).fill('120');
  await page.screenshot({ path: info.outputPath('urun-kdv.png') });
  await dialog.getByRole('button', { name: 'Kaydet ve yayınla', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = (await (await page.request.get('/api/staff/state')).json()).products.find((p: { name: string }) => p.name === 'Efes Bira');
  expect(saved.vatRate).toBe(20);
  // "Bu bölümdeki ürünlere uygula": the whole category at once (the owner confirms).
  await page.locator('.menu-row').filter({ hasText: 'Efes Bira' }).getByRole('button', { name: 'Düzenle', exact: true }).click();
  await dialog.getByRole('button', { name: 'Bu bölümdeki ürünlere uygula' }).click();
  await expect(dialog.getByText('Soğuk İçecekler bölümündeki bütün ürünler %20 olsun mu?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Evet, uygula' }).click();
  // (The first test may already have made this category %20.)
  await expect(dialog.getByText(/Soğuk İçecekler bölümündeki (\d+ ürün %20 oldu|ürünler zaten %20)\./)).toBeVisible();
  await dialog.getByLabel('Fiyat (TL)', { exact: true }).fill('125');
  await dialog.getByRole('button', { name: 'Kaydet ve yayınla', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const products = (await (await page.request.get('/api/staff/state')).json()).products as { category: string; vatRate?: number; price: number; name: string }[];
  expect(products.filter(p => p.category === 'Soğuk İçecekler').every(p => p.vatRate === 20)).toBe(true);
  expect(products.find(p => p.name === 'Efes Bira')!.price).toBe(12500);
  // The guest menu never mentions KDV.
  const state = await (await page.request.get('/api/staff/state')).json();
  const guest = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const menu = await guest.newPage(); await menu.goto(`/m/${state.tables[0].token}`);
    await expect(menu.getByText('Efes Bira').first()).toBeVisible();
    await expect(menu.getByText(/KDV/)).toHaveCount(0);
  } finally { await guest.close(); }
});

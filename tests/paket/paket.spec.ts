import { test, expect, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReport, openSettings, openView, yonetimGo, yonetimSettings } from '../browser/helpers';

/*
 * Paket testi, browser part (scripts/paket-testi.ts runs it against the PACKAGED café and Mola Yönetim it started; never
 * against the development server). Microsoft Edge, as the Mola window. What gets printed is read in print media: the
 * body's visible text then is exactly what the paper shows (display:none drops out), so a blank page fails here.
 */
const state = JSON.parse(readFileSync(process.env.PAKET_DURUM ?? '.local/e2e/paket-testi/durum.json', 'utf8')) as { kafe: string; merkez: string; owner: { username: string; password: string }; merkezPassword: string; business: string };
const BUSINESS = state.business;

async function stubPrint(page: Page) { await page.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed++; }; }); }
const printedCount = (page: Page) => page.evaluate(() => (window as unknown as { __printed: number }).__printed);
/** The text the paper would show, and the printed sheet's height. */
async function printed(page: Page, sheet: string) {
  await page.emulateMedia({ media: 'print' });
  const r = await page.evaluate(selector => { const el = document.querySelector(selector) as HTMLElement | null; return { text: document.body.innerText, height: el?.getBoundingClientRect().height ?? 0, images: [...(el?.querySelectorAll('img') ?? [])].filter(i => i.naturalWidth > 0 && i.getBoundingClientRect().width > 0).length }; }, sheet);
  return r;
}
async function afterPrint(page: Page) { await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => dispatchEvent(new Event('afterprint'))); }
async function fileOf(download: Download) { return readFileSync((await download.path())!); }
async function cafe(page: Page) {
  const r = await page.request.post('/api/login', { data: state.owner }); expect(r.ok(), await r.text()).toBe(true);
  await page.goto('/');
  await page.locator('.sidebar nav:visible, nav.bottom-nav:visible').first().waitFor();
}

test('Kafe: Kasa kapanışı "A4 yazdır" prints the closing, not a blank page', async ({ page }, info) => {
  await stubPrint(page); await cafe(page);
  await openView(page, 'Satış ve Raporlar');
  await openReport(page, 'Kasa kapanışları');
  const week = page.getByRole('button', { name: '7 gün', exact: true });
  if (await week.isVisible()) await week.click();
  const card = page.locator('.cash-closing-card').first();
  await card.locator('.cash-closing-head').click();
  await card.getByRole('button', { name: 'A4 yazdır' }).click();
  await expect.poll(() => printedCount(page)).toBe(1);
  const paper = await printed(page, '.cash-print-root');
  await page.screenshot({ path: info.outputPath('kasa-a4-yazdir.png'), fullPage: true });
  expect(paper.height, 'the A4 sheet is visible when printing').toBeGreaterThan(100);
  expect(paper.text).toContain(BUSINESS); expect(paper.text).toContain('Beklenen nakit'); expect(paper.text).toContain('Sayılan nakit');
  expect(paper.text, 'only the sheet is printed').not.toContain('Kasa kapanışları');
  await afterPrint(page);
});

test('Kafe: QR print sheets (6, 12, A6 stand) print the codes; the A6 PDF downloads', async ({ page }, info) => {
  await stubPrint(page); await cafe(page);
  const tables = ((await (await page.request.get('/api/staff/state')).json()) as { tables: { name: string }[] }).tables;
  await openSettings(page, 'QR kodlarını yazdır');
  const card = page.locator('.qr-codes-card');
  let prints = 0;
  for (const layout of ['6 QR', '12 QR']) {
    await card.getByRole('button', { name: layout, exact: true }).click();
    await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
    await expect.poll(() => printedCount(page)).toBe(++prints);
    const paper = await printed(page, '.qr-print-root');
    await page.screenshot({ path: info.outputPath(`qr-${layout.replace(' ', '-')}.png`), fullPage: true });
    expect(paper.height).toBeGreaterThan(100); expect(paper.images).toBe(tables.length);
    expect(paper.text).toContain('Menü ve sipariş için'); for (const t of tables) expect(paper.text).toContain(t.name);
    await afterPrint(page);
    await expect(page.getByTestId('qr-print-sheet')).toHaveCount(0);
  }
  await card.getByRole('button', { name: /^A6 masa standı/ }).click();
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect.poll(() => printedCount(page)).toBe(++prints);
  const stand = await printed(page, '[data-testid="qr-print-sheet"][data-sheet="a6"]');
  expect(stand.height).toBeGreaterThan(100); expect(stand.images).toBe(tables.length);
  await afterPrint(page);
  const [pdf] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'PDF indir' }).click()]);
  const data = await fileOf(pdf); expect(data.subarray(0, 5).toString('latin1')).toBe('%PDF-'); expect(data.length).toBeGreaterThan(5000);
});

test('Kafe: Satış ve Raporlar → Yazdır / PDF and Muhasebeci için indir', async ({ page }) => {
  await cafe(page);
  await openView(page, 'Satış ve Raporlar');
  await openReport(page, 'Özet');
  const tool = page.getByRole('button', { name: /^Yazdır \/ PDF/ }).first();
  test.skip(await tool.evaluate(el => el.classList.contains('locked')), 'Gelişmiş raporlar bu pakette kapalı');
  await tool.click();
  const dialog = page.getByRole('dialog', { name: 'Yazdır / PDF' });
  const frame = dialog.frameLocator('iframe[title="Yazdırılacak sayfa"]');
  await expect(frame.locator('body')).toContainText(BUSINESS, { timeout: 30_000 });
  await dialog.locator('iframe').evaluate((f: HTMLIFrameElement) => { (window as unknown as { __printed: number }).__printed = 0; f.contentWindow!.print = () => { (window as unknown as { __printed: number }).__printed++; }; });
  await dialog.getByRole('button', { name: 'Yazdır', exact: true }).click();
  expect(await printedCount(page)).toBe(1);
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), dialog.getByRole('button', { name: 'PDF indir' }).click()]);
  expect((await fileOf(pdf)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: /^Muhasebeci için indir/ }).first().click();
  const excel = page.getByRole('dialog', { name: 'Muhasebeci için indir' });
  const [xlsx] = await Promise.all([page.waitForEvent('download'), excel.getByRole('button', { name: 'Excel dosyasını indir' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/); expect((await fileOf(xlsx)).subarray(0, 2).toString('latin1')).toBe('PK');
});

test('Kafe: Sosyal medya QR card as PNG, PDF and print', async ({ page }) => {
  await stubPrint(page); await cafe(page);
  await openSettings(page, 'Sosyal medya');
  const card = page.locator('section.social-settings');
  await card.getByLabel('Instagram', { exact: true }).fill('@paketkafe');
  await card.getByRole('button', { name: 'Bağlantıları kaydet' }).click();
  await expect(card.getByText('Sosyal medya bağlantıları kaydedildi.', { exact: false })).toBeVisible();
  await card.getByRole('button', { name: 'Instagram için QR oluştur' }).click();
  const dialog = page.getByRole('dialog', { name: 'Instagram QR kodu' });
  await expect(dialog.locator('img.social-card-preview')).toBeVisible({ timeout: 30_000 });
  const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'PNG indir' }).click()]);
  expect((await fileOf(png)).subarray(1, 4).toString('latin1')).toBe('PNG');
  const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'PDF indir' }).click()]);
  expect((await fileOf(pdf)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await dialog.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect.poll(() => printedCount(page)).toBe(1);
  const paper = await printed(page, '[data-testid="social-print-sheet"]');
  expect(paper.height).toBeGreaterThan(100); expect(paper.images).toBeGreaterThan(0); expect(paper.text).toContain('@paketkafe');
  await afterPrint(page);
});

test('Mola Yönetim: İşlem kayıtları PDF and Yazdır; Satışlarım Excel, PDF and Yazdır', async ({ page }) => {
  await page.goto(`${state.merkez}/`);
  await page.getByLabel('Şifre', { exact: true }).fill(state.merkezPassword);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).waitFor();
  await yonetimSettings(page, 'İşlem kayıtları');
  const report = page.getByRole('region', { name: 'Rapor al' });
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), report.getByRole('button', { name: 'PDF indir' }).click()]);
  expect((await fileOf(pdf)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(page.locator('.notice-error, [role="alert"]').filter({ hasText: 'PDF' })).toHaveCount(0);
  await report.getByRole('button', { name: 'Yazdır' }).click();
  const frame = page.locator('iframe[data-testid="journal-print-frame"]');
  await expect(frame).toHaveCount(1);
  await expect(page.frameLocator('iframe[data-testid="journal-print-frame"]').locator('h1')).toHaveText('İşlem kayıtları raporu');
  await yonetimGo(page, 'Satışlarım');
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel', exact: true }).click()]);
  expect((await fileOf(xlsx)).subarray(0, 2).toString('latin1')).toBe('PK');
  const [salesPdf] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByRole('button', { name: 'PDF', exact: true }).click()]);
  expect((await fileOf(salesPdf)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByRole('link', { name: 'Yazdırılabilir sayfayı aç' }).click()]);
  await popup.waitForLoadState();
  expect((await popup.locator('body').innerText()).length).toBeGreaterThan(50);
});

import { test, expect, type APIRequestContext } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { bottomNav, ensureSetup, moreSheet, openReport, openSettings, openView, reportGroups, reportTabs, settingsParts, settingsTopics } from './helpers';

const login = (request: APIRequestContext, username: string) => request.post('/api/login', { data: { username, password: 'MolaDemo!2026' } });
async function order(request: APIRequestContext, tableId: string, quantity = 2) {
  expect((await request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity } })).ok()).toBe(true);
  return (await (await request.get('/api/staff/state')).json()).tables.find((t: any) => t.id === tableId);
}
/** A business day (05:00–05:00 Türkiye, like every report and the gün sonu kasası), offset days from today's. */
const istanbulDay = (offset: number) => new Date(Date.now() + 3 * 3600_000 - 5 * 3600_000 + offset * 86400000).toISOString().slice(0, 10);

test('owner table window: payment first, section picker folded, order adding, part payment in amber; kitchen without codes', async ({ page, browser }, info) => {
  await login(page.request, 'isletme'); await ensureSetup(page.request);
  const table = await order(page.request, 'table-2');
  // Part of the bill paid: the window says so plainly, and "Kapanan hesabın son ödemesi" is only for closed bills.
  expect((await page.request.post('/api/staff/payments', { data: { requestId: crypto.randomUUID(), accountId: table.account.id, version: table.account.version, amount: 3500, tendered: 3500, method: 'cash' } })).ok()).toBe(true);
  await page.goto('/');
  await page.locator('.table-card').filter({ has: page.getByRole('heading', { name: table.name, exact: true }) }).click();
  const dialog = page.getByRole('dialog', { name: table.name });
  await expect(dialog.getByRole('button', { name: 'Ödeme al' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Sipariş ekle' })).toBeVisible();
  await expect(dialog.getByText('₺35 ödendi · kalanı bekleniyor')).toBeVisible();
  await expect(dialog).not.toContainText('Kapanan hesabın son ödemesi');
  // The section picker is folded below everything and opens on demand.
  await expect(dialog.getByRole('button', { name: 'Dış', exact: true })).toBeHidden();
  const payTop = (await dialog.getByRole('button', { name: 'Ödeme al' }).boundingBox())!.y, foldTop = (await dialog.locator('.area-fold').boundingBox())!.y;
  expect(foldTop).toBeGreaterThan(payTop);
  await page.screenshot({ path: info.outputPath('owner-table-window.png') });
  await dialog.getByRole('button', { name: 'Sipariş ekle' }).click();
  await expect(page.getByRole('dialog', { name: `${table.name} · Ürün ekle` })).toBeVisible();
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();

  const kitchen = await browser.newContext();
  try {
    await login(kitchen.request, 'mutfak');
    const screen = await kitchen.newPage(); await screen.goto('/');
    const card = screen.locator('.kitchen-card').filter({ hasText: table.name }).first();
    await expect(card).toContainText('Demleme Çay');
    // Names, not product numbers, on the kitchen card; and how long the order has been waiting.
    await expect(card.locator('.order-line small')).toHaveCount(0);
    await expect(card.locator('.waiting-time')).toHaveText(/şimdi|\d+ dk/);
  } finally { await kitchen.close(); }
});

test('owner records, corrects and deletes an expense with date and method; the deleted one stays in the record', async ({ page }) => {
  await login(page.request, 'isletme'); await ensureSetup(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await openReport(page, 'Giderler');
  await page.getByRole('button', { name: '7 gün', exact: true }).click();
  await page.getByRole('button', { name: 'Gider ekle', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Gider ekle' });
  // gün.ay.yıl whatever the computer's language (src/DateField.tsx, 8 Ekim denetimi K5).
  await expect(form.getByLabel('Gider tarihi')).toHaveValue(istanbulDay(0).split('-').reverse().join('.'));
  await form.getByLabel('Gider tarihi').fill(istanbulDay(1));
  await expect(form.getByText('Bugün ya da en fazla 1 yıl önceki bir gün seçin.')).toBeVisible();
  await form.getByLabel('Gider tarihi').fill(istanbulDay(-1));
  await form.getByLabel('Gider tutarı').fill('450'); await form.getByLabel('Gider açıklaması').fill('Elektrik faturası');
  await form.getByLabel('Ödeme yöntemi').selectOption('transfer');
  await form.getByRole('button', { name: 'Gideri kaydet' }).click();
  const row = page.locator('.expense-table tbody tr').filter({ hasText: 'Elektrik faturası' });
  await expect(row).toContainText('Havale / EFT'); await expect(row).toContainText('₺450');
  await row.getByRole('button', { name: 'Elektrik faturası giderini düzelt' }).click();
  const edit = page.getByRole('dialog', { name: 'Gideri düzelt' });
  await edit.getByLabel('Gider tutarı').fill('480'); await edit.getByRole('button', { name: 'Düzeltmeyi kaydet' }).click();
  await expect(page.getByText('Gider düzeltildi.')).toBeVisible();
  await expect(row).toContainText('₺480'); await expect(row).toContainText('Düzeltildi');
  await expect(page.locator('.kpi').first()).toContainText('₺480');
  await row.getByRole('button', { name: 'Elektrik faturası giderini düzelt' }).click();
  await edit.getByRole('button', { name: 'Gideri sil' }).click();
  await edit.getByRole('button', { name: 'Evet, gideri sil' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('.kpi').first()).toContainText('₺0');
  await page.getByText('Silinen giderler (1)').click();
  await expect(page.locator('.expense-deleted')).toContainText('Elektrik faturası');
  await expect(page.locator('.expense-deleted')).toContainText('sildi');
  await expect(page.locator('.expense-deleted')).toContainText('önceki: ₺450');
});

test('printer form names the wrong field; QR codes print on A4 and a changed computer address is reported', async ({ page }, info) => {
  await page.addInitScript(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await login(page.request, 'isletme'); await ensureSetup(page.request);
  const state = await (await page.request.get('/api/staff/state')).json();
  await page.goto('/');
  await openSettings(page, 'Yazıcılar');
  await page.getByRole('button', { name: /Yazıcı ekle/ }).click();
  const printer = page.getByRole('dialog', { name: 'Yazıcı ekle' });
  await printer.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(printer.getByText('Yazıcıya bir ad verin (ör. Mutfak).')).toBeVisible();
  await expect(printer.getByText('IP adresini yazın. Yazıcının ayar fişinde yazar.')).toBeVisible();
  await printer.getByLabel('Yazıcı adı *').fill('Mutfak'); await printer.getByLabel('IP adresi *').fill('8.8.8.8');
  await expect(printer.getByText('Yazıcıya bir ad verin (ör. Mutfak).')).toHaveCount(0);
  await expect(printer.getByText('Yerel ağ IP adresi girin (ör. 192.168.1.50).')).toBeVisible();
  await printer.getByRole('button', { name: 'Vazgeç', exact: true }).click();

  await openSettings(page, 'Masalar ve QR');
  const card = page.locator('.qr-codes-card');
  await expect(card.getByRole('heading', { name: /Tek masanın QR kodunu yenile/ })).toBeVisible();
  // Printing is its own sub-tab (Masalar ve QR → QR kodlarını yazdır).
  await openSettings(page, 'QR kodlarını yazdır');
  await card.getByRole('button', { name: '12 QR', exact: true }).click();
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  const sheet = page.getByTestId('qr-print-sheet');
  await expect(sheet.locator('.qr-cell')).toHaveCount(state.tables.length);
  await expect(sheet.locator('.qr-sheet')).toHaveCount(Math.ceil(state.tables.length / 12));
  await expect(sheet.locator('.qr-cell').first()).toContainText(state.tables[0].name);
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
  await page.emulateMedia({ media: 'print' }); await page.screenshot({ path: info.outputPath('qr-sheet-print.png'), fullPage: true }); await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(sheet).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get('/api/staff/network')).json()).printed?.origin).toBeTruthy();
  // The table's name under each code: large and bold; a long custom name (shown here through the state) wraps smaller and
  // still fits its cell. Six on a page is the large print.
  await page.route('**/api/staff/state', async route => { const response = await route.fetch(); const json = await response.json(); if (json.tables?.[1]) json.tables[1].name = 'Teras Pencere Kenarı 12'; await route.fulfill({ response, json }); });
  await page.reload();
  await openSettings(page, 'QR kodlarını yazdır');
  await card.getByRole('button', { name: '6 QR', exact: true }).click();
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect(sheet.locator('.qr-cell')).toHaveCount(state.tables.length);
  await page.emulateMedia({ media: 'print' });
  const labels = await sheet.locator('.qr-cell strong').evaluateAll(list => list.map(el => { const s = getComputedStyle(el), cell = el.parentElement!; return { text: el.textContent, size: parseFloat(s.fontSize), weight: Number(s.fontWeight), fits: cell.scrollHeight <= cell.clientHeight + 1 && el.scrollWidth <= cell.clientWidth }; }));
  expect(labels[0].size).toBeCloseTo(34 * 4 / 3, 0); expect(labels[0].weight).toBeGreaterThanOrEqual(700);
  expect(labels[1].text).toBe('Teras Pencere Kenarı 12'); expect(labels[1].size).toBeLessThan(labels[0].size);
  expect(labels.every(l => l.fits), JSON.stringify(labels.filter(l => !l.fits))).toBe(true);
  await page.setViewportSize({ width: 794, height: 1123 });
  await sheet.locator('.qr-sheet').first().screenshot({ path: info.outputPath('masa-qr-etiket.png') });
  if (process.env.KAFE_EKRAN) await sheet.locator('.qr-sheet').first().screenshot({ path: `${process.env.KAFE_EKRAN}/masa-qr-etiket.png` });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(sheet).toHaveCount(0);
  await page.unroute('**/api/staff/state');
  await page.setViewportSize({ width: 1280, height: 900 });
  // One table's "QR kodunu indir": the same large name under the code, in the PNG itself.
  await page.reload();
  await page.locator('.table-card').filter({ has: page.getByRole('heading', { name: state.tables[0].name, exact: true }) }).click();
  await page.getByRole('dialog', { name: state.tables[0].name }).getByRole('button', { name: 'QR menüyü aç' }).click();
  const qrWindow = page.getByRole('dialog', { name: `${state.tables[0].name} · QR menü` });
  const [single] = await Promise.all([page.waitForEvent('download'), qrWindow.getByRole('link', { name: 'QR kodunu indir' }).click()]);
  expect(single.suggestedFilename()).toBe(`${state.tables[0].name}-qr.png`);
  const singlePng = await sharp(await single.path()).metadata();
  expect(singlePng.width).toBe(1000); expect(singlePng.height!).toBeGreaterThan(1150);
  await qrWindow.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.keyboard.press('Escape');
  await openSettings(page, 'Masalar ve QR');

  // The modem gave the computer another address: the owner is told on Masalar and taken to reprint.
  await page.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Ethernet', origin: 'http://192.168.1.35:3000' }], printed: { origin: 'http://192.168.1.20:3000', at: new Date().toISOString() } } }));
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const warning = page.locator('.qr-address-warning');
  await expect(warning).toContainText("Bilgisayarın ağ adresi değişti; basılı QR'lar çalışmayabilir.");
  await expect(warning).toContainText('DHCP rezervasyonu');
  await warning.getByRole('button', { name: "QR'ları yeniden yazdır" }).click();
  await expect(settingsTopics(page).getByRole('button', { name: /^Masalar ve QR/ })).toHaveAttribute('aria-current', 'page');
  await expect(settingsTopics(page).getByRole('button', { name: /^Masalar ve QR/ })).toContainText('Adres değişti');
  await expect(page.locator('.qr-codes-card')).toBeVisible();
  await expect(settingsParts(page, 'Masalar ve QR').getByRole('button', { name: /^QR kodlarını yazdır/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'QR kodlarını yazdır' })).toBeVisible();
});

test('A6 table stands: four cards on an A4 sheet with cut lines, one per A6 sheet, the same as a PDF; chosen tables; fits a phone', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await login(page.request, 'isletme'); await ensureSetup(page.request);
  const state = await (await page.request.get('/api/staff/state')).json(), n = state.tables.length as number;
  // A long custom name (through the state) wraps smaller on its card and still fits.
  const long = 'Teras Pencere Kenarı Büyük Masa 12';
  // (Unchanged-state answers have no body: passed on as they are.)
  await page.route('**/api/staff/state', async route => { const response = await route.fetch(), body = await response.text(); if (!body) return route.fulfill({ response }); const json = JSON.parse(body); if (json.tables?.[1]) json.tables[1].name = long; await route.fulfill({ response, json }); });
  await page.goto('/');
  await openSettings(page, 'QR kodlarını yazdır');
  const card = page.locator('.qr-codes-card');
  await card.getByRole('button', { name: /^A6 masa standı/ }).click();
  await expect(card.getByRole('button', { name: /^A6 masa standı/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(card).toContainText('Akrilik A6 masa standına tam oturur. Mat kâğıda basın; parlak kâğıt ışığı yansıtır ve QR okunmayabilir. Her masa için bir yedek basıp kasada saklayın.');
  await expect(card.getByRole('button', { name: "A4'e 4'lü (kesim çizgili)" })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.qr-print-summary .settings-chip')).toHaveText(`${n} masa · ${Math.ceil(n / 4)} sayfa A4`);
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  const sheet = page.locator('[data-testid="qr-print-sheet"][data-sheet="a6"]');
  await expect(sheet.locator('.qr-stand-card')).toHaveCount(n);
  await expect(sheet.locator('.qr-stand-page')).toHaveCount(Math.ceil(n / 4));
  expect(await sheet.locator('style').textContent()).toBe('@page{size:A4 portrait;margin:0}');
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  const first = sheet.locator('.qr-stand-page').first();
  // Each card exactly 105 × 148 mm (96 px a inch), 2 × 2 from the sheet's top left; drawn at 300 dpi; every name fits.
  const cards = await first.locator('.qr-stand-card').evaluateAll(list => list.map(el => { const img = el as HTMLImageElement, r = img.getBoundingClientRect(), p = img.parentElement!.getBoundingClientRect(); return { w: r.width, h: r.height, at: [Math.round(r.left - p.left), Math.round(r.top - p.top)], natural: [img.naturalWidth, img.naturalHeight], size: Number(img.dataset.labelSize), lines: Number(img.dataset.labelLines), fits: img.dataset.labelFits, alt: img.alt }; }));
  expect(cards).toHaveLength(Math.min(4, n));
  for (const c of cards) { expect(c.w).toBeCloseTo(105 * 96 / 25.4, 0); expect(c.h).toBeCloseTo(148 * 96 / 25.4, 0); expect(c.natural).toEqual([1240, 1748]); expect(c.fits).toBe('yes'); }
  expect(cards.map(c => c.at)).toEqual([[0, 0], [397, 0], [0, 559], [397, 559]].slice(0, cards.length));
  expect(cards[0].alt).toBe(`${state.tables[0].name} masa kartı`); expect(cards[0].size).toBe(220); expect(cards[0].lines).toBe(1);
  expect(cards[1].alt).toBe(`${long} masa kartı`); expect(cards[1].size).toBeLessThan(cards[0].size); expect(cards[1].lines).toBeLessThanOrEqual(2);
  const all = await sheet.locator('.qr-stand-card').evaluateAll(list => list.map(el => (el as HTMLElement).dataset.labelFits));
  expect(all.every(f => f === 'yes')).toBe(true);
  await expect(first.locator('.qr-cut')).toHaveCount(2); await expect(first.locator('.qr-crop')).toHaveCount(4);
  // The card itself: black-on-white QR in the middle (its quiet zone white), the frame tinted, nothing on the outer edge.
  const png = Buffer.from((await first.locator('.qr-stand-card').first().getAttribute('src'))!.split(',')[1], 'base64');
  const { data, info: meta } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [...data.subarray((y * meta.width + x) * 3, (y * meta.width + x) * 3 + 3)];
  expect(px(5, 5)).toEqual([255, 255, 255]); expect(px(620, 1740)).toEqual([255, 255, 255]);
  let dark = 0; for (let y = 700; y < 900; y += 4) for (let x = 400; x < 840; x += 4) { const [r, g, b] = px(x, y); if (r + g + b < 60) dark++; else expect(r + g + b > 700 || r + g + b < 60).toBe(true); }
  expect(dark).toBeGreaterThan(200);
  await page.setViewportSize({ width: 794, height: 1123 });
  await first.screenshot({ path: info.outputPath('masa-qr-a6.png') });
  if (process.env.KAFE_EKRAN) await first.screenshot({ path: `${process.env.KAFE_EKRAN}/masa-qr-a6.png` });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(sheet).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });

  // A printer set to A6: one card on each sheet.
  await card.getByRole('button', { name: 'A6 kâğıda tek' }).click();
  await expect(card.locator('.qr-print-summary .settings-chip')).toHaveText(`${n} masa · ${n} sayfa A6`);
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect(sheet.locator('.qr-stand-page.a6')).toHaveCount(n);
  expect(await sheet.locator('style').textContent()).toBe('@page{size:105mm 148mm;margin:0}');
  await page.emulateMedia({ media: 'print' });
  expect(await sheet.locator('.qr-stand-page').evaluateAll(list => list.every(p => p.querySelectorAll('.qr-stand-card').length === 1 && !p.querySelector('.qr-cut')))).toBe(true);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(sheet).toHaveCount(0);

  // "PDF indir": a real PDF with the same pages (one card a page on A6, four on A4), cards at 300 dpi.
  for (const [paper, file, pages, size] of [['A6 kâğıda tek', 'masa-qr-a6.pdf', n, '297.64 419.53'], ["A4'e 4'lü (kesim çizgili)", 'masa-qr-a6-4lu.pdf', Math.ceil(n / 4), '595.28 841.89']] as const) {
    await card.getByRole('button', { name: paper }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'PDF indir' }).click()]);
    expect(download.suggestedFilename()).toBe(file);
    const text = (await readFile((await download.path())!)).toString('latin1');
    expect(text.slice(0, 8)).toBe('%PDF-1.4'); expect(text.endsWith('%%EOF\n')).toBe(true);
    expect(text).toContain(`/Count ${pages} >>`);
    expect(text.match(/\/Type \/Page /g)?.length).toBe(pages);
    expect(text.match(/\/Subtype \/Image \/Width 1240 \/Height 1748/g)?.length).toBe(n);
    expect(text).toContain(`/MediaBox [0 0 ${size}]`);
    expect(text.includes('[4 3] 0 d\n')).toBe(paper !== 'A6 kâğıda tek');
  }
  await expect(card.getByRole('button', { name: 'PDF indir' })).toBeEnabled();

  // Only the chosen tables.
  await card.getByLabel('Hangi masalar?').selectOption('#pick');
  await expect(card.locator('.qr-print-summary .settings-chip')).toHaveText('0 masa · 0 sayfa A4');
  await expect(card.getByRole('button', { name: 'Yazdır', exact: true })).toBeDisabled();
  await card.locator('.qr-pick').getByLabel(state.tables[0].name, { exact: true }).check();
  await card.locator('.qr-pick').getByLabel(long, { exact: true }).check();
  await expect(card.locator('.qr-print-summary .settings-chip')).toHaveText('2 masa · 1 sayfa A4');
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect(sheet.locator('.qr-stand-card')).toHaveCount(2);
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(sheet).toHaveCount(0);

  // A phone (360 px): the choices and the note stay inside the screen.
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(card.getByRole('button', { name: /^A6 masa standı/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await card.evaluate(el => [...el.querySelectorAll('.qr-print *')].every(c => { const r = c.getBoundingClientRect(); return r.width === 0 || (r.left >= -1 && r.right <= innerWidth + 1); }))).toBe(true);
  await page.screenshot({ path: info.outputPath('masa-qr-a6-telefon.png'), fullPage: true });
  await page.unroute('**/api/staff/state');
});

test('phones: the bottom bar and "Daha fazla" hold every page, Destek is a menu item (no floating button), each page opens at its top', async ({ page }, info) => {
  await login(page.request, 'isletme'); await ensureSetup(page.request);
  await page.setViewportSize({ width: 390, height: 700 }); await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.sidebar-bottom.with-support')).toBeHidden();
  const nav = bottomNav(page);
  await nav.getByRole('button', { name: /^Daha fazla/ }).click();
  await expect(moreSheet(page).getByRole('button', { name: /^Destek/ })).toBeVisible();
  // Every page has its own symbol (the bar's and the sheet's together).
  const icons = [...await nav.locator('.bottom-nav-icon svg').evaluateAll(list => list.map(svg => svg.getAttribute('class'))),
    ...await moreSheet(page).locator('.bottom-sheet-icon svg').evaluateAll(list => list.map(svg => svg.getAttribute('class')))];
  expect(new Set(icons).size).toBe(icons.length);
  await page.keyboard.press('Escape');
  await page.evaluate(() => scrollTo(0, 600)); expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await openView(page, 'Ayarlar');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('phone-nav.png') });
  // Reports: today is compared with yesterday up to the same clock time.
  await openView(page, 'Satış ve Raporlar');
  await expect(page.locator('.kpi').first()).toContainText('dünün aynı saatine göre');
  for (const pill of ['Bugün', '7 gün', '30 gün', 'Yıl', 'Tümü']) await expect(page.getByRole('group', { name: 'Dönem' }).getByRole('button', { name: pill, exact: true })).toBeVisible();
  // The three report groups (Satış, Personel, Rezervasyon; the money group left in 0.1.8) fit one row on the phone, each a finger-sized target.
  const groups = await reportGroups(page).evaluate(row => ({ slides: row.scrollWidth > row.clientWidth + 1, heights: [...row.querySelectorAll('button')].map(b => b.getBoundingClientRect().height) }));
  expect(groups.slides).toBe(false); expect(groups.heights).toHaveLength(3);
  for (const h of groups.heights) expect(h).toBeGreaterThanOrEqual(44);
  await expect(reportTabs(page).getByRole('button', { name: 'Özet', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

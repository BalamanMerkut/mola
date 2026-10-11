import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureSetup, openReport, reportTabs } from './helpers';

/*
 * Etkinlik end to end: "Etkinlik oluştur" with 25 temporary tables (D1…D25), a table renamed, a reservation with kapora on
 * D5, "Etkinliği başlat", the event's own section on Masalar (normal tables hidden, can be shown), a walk-in name on D7,
 * Geldi on D5, orders on both, "Etkinliği kapat" refused while bills are open, then closed, and the event in the report.
 */
const VIEWPORTS = [[360, 800], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1280, 860]] as const;
const tl = (k: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: k % 100 === 0 ? 0 : 2 }).format(k / 100);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
const istanbul = (at: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map(x => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
async function order(request: APIRequestContext, tableName: string, quantity: number) {
  const s = await (await request.get('/api/staff/state')).json();
  const p = s.products.find((x: any) => x.published !== false && !x.soldOut && x.price > 0 && x.unit !== 'kg' && !x.groups.some((g: any) => g.required));
  const t = s.eventTables.find((x: any) => x.name === tableName);
  const r = await request.post('/api/staff/orders', { data: { requestId: randomUUID(), tableId: t.id, lines: [{ productId: p.id, quantity, selections: [] }], expectedTotal: p.price * quantity } });
  expect(r.ok(), await r.text()).toBe(true);
  return p.price * quantity;
}
async function payRest(request: APIRequestContext, tableName: string) {
  const t = (await (await request.get('/api/staff/state')).json()).eventTables.find((x: any) => x.name === tableName);
  const r = await request.post('/api/staff/payments', { data: { requestId: randomUUID(), accountId: t.account.id, version: t.account.version, method: 'card', amount: t.account.balance, tendered: t.account.balance } });
  expect(r.ok(), await r.text()).toBe(true);
}

test('etkinlik: 25 temporary tables, reservation, walk-in, orders, closing only by hand and only with every bill closed, report', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  const start = istanbul(Math.ceil((Date.now() + 2 * 3600_000) / 300_000) * 300_000);
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ajanda bölümleri' }).getByRole('button', { name: 'Etkinlikler' }).click();
  await page.getByRole('button', { name: 'Etkinlik oluştur' }).click();
  const form = page.getByRole('dialog', { name: 'Etkinlik oluştur' });
  await form.getByLabel(/Etkinlik adı/).fill('Elazığspor derbisi');
  await form.getByLabel(/^Gün/).fill(start.day);
  await form.getByLabel(/^Başlangıç/).fill(start.time);
  await expect(form.getByLabel(/Geçici masa sayısı/)).toHaveValue('25');
  await form.getByLabel(/Bir masada kaç kişi/).fill('4');
  // Adım adım form (11 Ekim): every step says what it will do right under it.
  await expect(form.getByRole('region', { name: 'Kaç masa?' })).toContainText('25 geçici masa · toplam 100 kişilik yer');
  const chips = form.getByRole('list', { name: 'Açılacak masalar' });
  await expect(chips.getByRole('listitem')).toHaveCount(13);
  await expect(chips).toContainText('D1'); await expect(chips).toContainText('+ 13 masa daha (son: D25)');
  await form.getByLabel(/^Bitiş saati/).fill('01:30');
  // "(ertesi gün)" only when 01:30 is before the start (the start is now + 2 h, so after midnight it is the same day).
  await expect(form.getByRole('region', { name: 'Ne zaman?' })).toContainText(`${start.time} – 01:30${'01:30' < start.time ? ' (ertesi gün)' : ''}`);
  await form.getByLabel(/^Bitiş saati/).fill('');
  // Own names: as many tables as names written, the count follows; a name written twice is refused before saving.
  await form.getByRole('button', { name: 'Adları ben yazayım' }).click();
  await form.getByLabel('Her satıra bir masa adı').fill('Sahne önü\nPencere 1\nsahne önü');
  await expect(form).toContainText('“sahne önü” iki kez yazılmış');
  await expect(form.getByRole('button', { name: 'Etkinliği oluştur' })).toBeDisabled();
  await form.getByLabel('Her satıra bir masa adı').fill('Sahne önü\nPencere 1\nPencere 2');
  await expect(form.locator('.step-fixed strong')).toHaveText('3');
  await expect(chips.getByRole('listitem')).toHaveText(['Sahne önü', 'Pencere 1', 'Pencere 2']);
  await form.getByRole('button', { name: 'Numaralı (D1, D2…)' }).click();
  await expect(form.getByLabel(/Geçici masa sayısı/)).toHaveValue('25');
  await form.getByLabel('Etkinlik sürerken yalnız etkinlik masalarını göster').check();
  const sizes = await form.locator('input:not([type=checkbox]), textarea').evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
  // No sliding boxes: the fields of one row start and end on the same line, at every width, with no side scroll.
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    const rows = await form.locator('.step-row').evaluateAll(list => list.map(row => { const boxes = [...row.querySelectorAll('input:not([type=checkbox]), select, .step-fixed strong')].map(e => e.getBoundingClientRect()); const sameLine = boxes.filter(b => Math.abs(b.top - boxes[0].top) < 40); return sameLine.every(b => Math.abs(b.bottom - sameLine[0].bottom) <= 1); }));
    expect(rows.every(Boolean), `fields line up at ${width}`).toBe(true);
    expect(await noSideScroll(page), `no side scroll at ${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 1400 });
  await shot(page, 'etkinlik-olustur.png', info.outputPath('etkinlik-olustur.png'), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'etkinlik-olustur-telefon.png', info.outputPath('etkinlik-olustur-telefon.png'), false);
  await page.setViewportSize({ width: 1280, height: 860 });
  await form.getByRole('button', { name: 'Etkinliği oluştur' }).click();
  const event = page.getByRole('article', { name: 'Elazığspor derbisi' });
  await expect(event.locator('.event-tables li')).toHaveCount(25);
  await expect(event).toContainText('Başlamadı');
  // Names can change later.
  await event.getByRole('button', { name: 'D1 masasının adını değiştir' }).click();
  await page.getByRole('dialog', { name: 'D1 · masa adı' }).getByLabel('Yeni ad').fill('Sahne önü');
  await page.getByRole('dialog', { name: 'D1 · masa adı' }).getByRole('button', { name: 'Kaydet' }).click();
  await expect(event.locator('.event-tables li').first()).toContainText('Sahne önü');
  // A reservation with kapora onto D5.
  await event.getByRole('button', { name: 'Masaya rezervasyon' }).click();
  const r = page.getByRole('dialog', { name: 'Masa ayır' });
  await r.getByLabel(/Misafir adı/).fill('Selin');
  await r.getByLabel('Kişi sayısı').fill('5');
  await r.getByLabel(/^Masa/).selectOption({ label: 'D5' });
  await r.getByLabel(/^Saat/).fill(start.time);
  await r.getByLabel('Kapora alındı').check();
  await r.getByLabel('Tutar (TL)').fill('400');
  await r.getByRole('button', { name: 'Kaydet' }).click();
  await expect(event.locator('.event-tables li').nth(4)).toContainText(`Rezerve ${start.time}`);
  await expect(event.locator('.event-tables li').nth(4)).toContainText('Selin');
  // Tap a free temporary table: the short sheet opens with that table, the event's day and start; tap the reserved one: its reservation.
  await event.locator('.event-tables li').nth(5).locator('.plan-tile').click();
  const sheet = page.getByRole('dialog', { name: 'Rezervasyon · D6' });
  await expect(sheet.getByLabel(/^Saat/)).toHaveValue(start.time);
  await sheet.getByRole('button', { name: 'Vazgeç' }).click();
  await event.locator('.event-tables li').nth(4).locator('.plan-tile').click();
  const d5sheet = page.getByRole('dialog', { name: 'D5 · Rezervasyon' });
  await expect(d5sheet).toContainText('Selin');
  await expect(d5sheet.getByRole('button', { name: 'Selin rezervasyonunu düzenle' })).toBeVisible();
  await d5sheet.getByRole('button', { name: 'Tamam' }).click();
  await expect(event.locator('.event-resv')).toContainText('Selin');
  await shot(page, 'etkinlik.png', info.outputPath('etkinlik.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Etkinlikler ${width}`).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'etkinlik-telefon.png', info.outputPath('etkinlik-telefon.png'));
  await page.setViewportSize({ width: 1280, height: 860 });

  // Before the start nothing is on Masalar; "Etkinliği başlat" brings the tables now.
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const section = page.getByRole('region', { name: 'Etkinlik: Elazığspor derbisi' });
  await expect(section).toHaveCount(0);
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  await event.getByRole('button', { name: 'Etkinliği başlat' }).click();
  await expect(event).toContainText('Sürüyor');
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  await expect(section.locator('.table-card')).toHaveCount(25);
  await expect(page.getByText('Etkinlik sürerken normal masalar gizli.')).toBeVisible();
  await expect(page.locator('.table-card').filter({ has: page.getByRole('heading', { name: 'Masa 01', exact: true }) })).toHaveCount(0);
  await page.getByRole('button', { name: 'Normal masaları göster' }).click();
  await expect(page.locator('.table-card').filter({ has: page.getByRole('heading', { name: 'Masa 01', exact: true }) })).toHaveCount(1);
  await page.getByRole('button', { name: 'Normal masaları gizle' }).click();
  const card = (name: string) => section.locator('.table-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  // A walk-in sits at D7: the name on the table.
  await card('D7').click();
  const d7 = page.getByRole('dialog', { name: 'D7' });
  await expect(d7.getByRole('button', { name: 'QR menüyü aç' })).toHaveCount(0);
  await d7.getByRole('button', { name: 'Ad yaz' }).click();
  await d7.getByLabel('Misafir adı').fill('Mehmet (rezervasyonsuz)');
  await d7.getByLabel('Kişi').fill('3');
  await d7.getByRole('button', { name: 'Adı yaz' }).click();
  await expect(card('D7').locator('.table-guest')).toHaveText('Mehmet (rezervasyonsuz) · 3 kişi');
  // Selin comes: Geldi from D5's window (two hours early, at any hour: the window offers the started event's reservations).
  await card('D5').click();
  const d5 = page.getByRole('dialog', { name: 'D5' });
  await expect(d5).toContainText(`Rezervasyon: Selin · 5 kişi · ${start.time}`);
  await d5.getByRole('button', { name: 'Geldi' }).click();
  await expect(card('D5').locator('.table-guest')).toHaveText('Selin · 5 kişi');
  // Orders on both (also from Sipariş al, where the event tables are listed with the names).
  const selin = await order(page.request, 'D5', 20), mehmet = await order(page.request, 'D7', 3);
  await expect(card('D7')).toContainText(tl(mehmet));
  await page.getByRole('button', { name: 'Sipariş al', exact: true }).first().click();
  await expect(page.getByLabel('Sipariş masası').locator('option', { hasText: 'D7 · Mehmet (rezervasyonsuz)' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  await section.evaluate(e => e.scrollIntoView({ block: 'start' }));
  await shot(page, 'etkinlik-masalar.png', info.outputPath('etkinlik-masalar.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Masalar etkinlik ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });

  // Closing is refused while bills are open; the message names the tables.
  await section.getByRole('button', { name: 'Etkinliği kapat' }).click();
  const closing = page.getByRole('dialog', { name: 'Etkinlik kapatılsın mı?' });
  await closing.getByRole('button', { name: 'Etkinliği kapat' }).click();
  await expect(closing).toContainText('Önce bu masaların hesaplarını kapatın: D5, D7.');
  await shot(page, 'etkinlik-kapat.png', info.outputPath('etkinlik-kapat.png'), false);
  await closing.getByRole('button', { name: 'Vazgeç' }).click();
  await payRest(page.request, 'D5'); await payRest(page.request, 'D7');
  await section.getByRole('button', { name: 'Etkinliği kapat' }).click();
  await closing.getByRole('button', { name: 'Etkinliği kapat' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Elazığspor derbisi kapandı.' })).toBeVisible();
  await expect(section).toHaveCount(0);
  await expect(page.locator('.table-card').filter({ has: page.getByRole('heading', { name: 'Masa 01', exact: true }) })).toHaveCount(1);

  // Satış ve Raporlar → Rezervasyon: the event's tables, guests, sales, walk-in sales, kapora.
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await openReport(page, 'Rezervasyon');
  // A group with a single report has no second row.
  await expect(reportTabs(page)).toHaveCount(0);
  // The event starts two hours from now: late in the evening that is tomorrow, so every day is read.
  await page.getByRole('button', { name: 'Tümü', exact: true }).first().click();
  const row = page.locator('.resv-event-rows li').filter({ hasText: 'Elazığspor derbisi' });
  await expect(row).toContainText('2 / 25');
  await expect(row.locator('div').filter({ hasText: /^Kişi/ })).toContainText('8');
  await expect(row.locator('div').filter({ hasText: /^Satış/ })).toContainText(tl(selin + mehmet));
  await expect(row.locator('div').filter({ hasText: /^Rezervasyonsuz satış/ })).toContainText(tl(mehmet));
  await expect(row.locator('div').filter({ hasText: /^Alınan kapora/ })).toContainText(tl(40000));
  await shot(page, 'etkinlik-rapor.png', info.outputPath('etkinlik-rapor.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Rapor ${width}`).toBe(true); }
});

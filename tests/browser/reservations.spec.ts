import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureSetup, openReport, openSettings } from './helpers';

/*
 * Masa ayırma end to end: "Masa ayır" with a kapora, the ±2 hour warning, "Rezerve" on Masalar half an hour before (this tablet's
 * clock moved forward), "Geldi mi?" half an hour after, "15 dk daha bekle", Geldi (the name on the table and its window,
 * the kapora deducted), a no-show whose kapora the owner keeps, and the Rezervasyon report. No sideways scroll; 16 px fields.
 */
const VIEWPORTS = [[360, 800], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1280, 860]] as const;
const tl = (k: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: k % 100 === 0 ? 0 : 2 }).format(k / 100);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
/** The guest's screens go beside the café's (KAFE_EKRAN=docs/ekran/kafe → docs/ekran/misafir). */
async function shotIn(page: Page, folder: 'misafir', file: string, path: string) {
  await page.screenshot({ path });
  const kafe = process.env.KAFE_EKRAN;
  if (kafe) { const dir = join(dirname(kafe), folder); mkdirSync(dir, { recursive: true }); await page.screenshot({ path: join(dir, file) }); }
}
const istanbul = (at: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map(x => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
async function sellable(request: APIRequestContext) {
  const s = await (await request.get('/api/staff/state')).json();
  return s.products.find((p: any) => p.published !== false && !p.soldOut && p.price > 0 && p.unit !== 'kg' && !p.groups.some((g: any) => g.required));
}
async function order(request: APIRequestContext, tableId: string, quantity: number) {
  const p = await sellable(request);
  const r = await request.post('/api/staff/orders', { data: { requestId: randomUUID(), tableId, lines: [{ productId: p.id, quantity, selections: [] }], expectedTotal: p.price * quantity } });
  expect(r.ok(), await r.text()).toBe(true);
  return p.price * quantity;
}
async function fieldsAre16(page: Page, scope: string) {
  const sizes = await page.locator(`${scope} input:not([type=checkbox]), ${scope} select, ${scope} textarea`).evaluateAll(els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
}

test('masa ayırma: kapora, conflict warning, Rezerve and Geldi mi? on the floor after the clock moves, Geldi, no-show, report', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const start = Date.now();
  // The reservation is two hours ahead (5-minute steps); this tablet's clock is then moved forward.
  const at = Math.ceil((start + 2 * 3600_000) / 300_000) * 300_000, when = istanbul(at);
  await page.clock.install({ time: start });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  // Ayarlar → Masalar ve QR → Rezervasyon: the defaults (the table held 30 minutes before, "Geldi mi?" 30 minutes after;
  // cashier and waiter may write). Since 12 Ekim one setting: "Rezerve" on Masalar and the table QR closing together.
  await openSettings(page, 'Rezervasyon');
  const settings = page.locator('.settings-card').filter({ has: page.getByRole('heading', { name: /^Rezervasyon/ }) });
  await expect(settings.getByText('Rezervasyondan kaç dakika önce masa ayrılsın')).toBeVisible();
  await expect(settings.getByRole('button', { name: '30 dk önce' })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Kapalı', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: '30 dk sonra' })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByLabel('Garson rezervasyon yazabilir')).toBeChecked();
  await settings.evaluate(e => e.scrollIntoView({ block: 'start' }));
  await shot(page, 'rezervasyon-ayarlar.png', info.outputPath('rezervasyon-ayarlar.png'), false);
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  const parts = page.getByRole('navigation', { name: 'Ajanda bölümleri' });
  await expect(parts.getByRole('button', { name: 'Takvim' })).toBeVisible();
  await parts.getByRole('button', { name: 'Rezervasyonlar' }).click();

  // Masa ayır: Ahmet, 4 kişi, Masa 05, 500 TL kapora in cash.
  const reserve = async (name: string, table: string, extra?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) => {
    await page.getByRole('button', { name: 'Masa ayır' }).click();
    const dialog = page.getByRole('dialog', { name: 'Masa ayır' });
    await dialog.getByLabel(/Misafir adı/).fill(name);
    await dialog.getByLabel('Kişi sayısı').fill('4');
    await dialog.getByLabel(/^Masa/).selectOption({ label: table });
    await dialog.getByLabel(/^Gün/).fill(when.day);
    await dialog.getByLabel(/^Saat/).fill(when.time);
    await extra?.(dialog);
    return dialog;
  };
  let dialog = await reserve('Ahmet Yılmaz', 'Masa 05', async d => {
    await d.getByLabel(/Telefon/).fill('0532 111 22 33');
    await d.getByLabel(/^Not/).fill('Pencere kenarı');
    await d.getByLabel('Kapora alındı').check();
    await d.getByLabel('Tutar (TL)').fill('500');
  });
  await fieldsAre16(page, '.resv-form');
  await shot(page, 'rezervasyon-form.png', info.outputPath('rezervasyon-form.png'), false);
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByLabel('Gün', { exact: true }).fill(when.day);
  const card = page.locator('.resv-card').filter({ hasText: 'Ahmet Yılmaz' });
  await expect(card).toContainText('4 kişi · Masa 05');
  await expect(card).toContainText(`Kapora ${tl(50000)} · Nakit`);
  await expect(card.getByRole('link', { name: /0532 111 22 33/ })).toBeVisible();
  // The same table an hour later: a warning first, nothing saved without "Yine de kaydet".
  dialog = await reserve('Can', 'Masa 05');
  // Day and time together: after 21:00 an hour later is already tomorrow.
  await dialog.getByLabel(/^Gün/).fill(istanbul(at + 3600_000).day);
  await dialog.getByLabel(/^Saat/).fill(istanbul(at + 3600_000).time);
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(dialog.getByText(/2 saat içinde başka rezervasyon var: Ahmet Yılmaz/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Yine de kaydet' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
  // Burak at Masa 06 with a card kapora: he will not come.
  dialog = await reserve('Burak', 'Masa 06', async d => { await d.getByLabel('Kapora alındı').check(); await d.getByLabel('Tutar (TL)').fill('300'); await d.getByRole('button', { name: 'Kart' }).click(); });
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.locator('.resv-card')).toHaveCount(2);
  await shot(page, 'rezervasyon.png', info.outputPath('rezervasyon.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Rezervasyonlar ${width}`).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'rezervasyon-telefon.png', info.outputPath('rezervasyon-telefon.png'));
  await page.setViewportSize({ width: 1280, height: 860 });

  // Masalar now: two hours early, nothing on the table yet.
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const masa5 = page.locator('.table-card').filter({ has: page.getByRole('heading', { name: 'Masa 05', exact: true }) });
  await expect(masa5).toBeVisible();
  await expect(masa5).not.toContainText('Rezerve');
  // 31 minutes before (12 Ekim): still a normal table, no reserved styling; its window only notes the reservation (and
  // offers "Geldi" for an early guest).
  await page.clock.fastForward(at - 31 * 60_000 - start);
  await page.waitForTimeout(300);
  await expect(masa5).not.toContainText('Rezerve');
  await expect(masa5).not.toHaveClass(/reserved/);
  await masa5.click();
  const early = page.getByRole('dialog', { name: 'Masa 05' });
  await expect(early.getByTestId('resv-later')).toContainText(`Bugün ${when.time} rezervasyon`);
  await expect(early.getByTestId('resv-later')).toContainText('Ahmet Yılmaz · 4 kişi');
  await expect(early.getByTestId('resv-later').getByRole('button', { name: 'Geldi' })).toBeVisible();
  await expect(early.getByRole('button', { name: '15 dk daha bekle' })).toHaveCount(0);
  await early.getByRole('button', { name: 'Kapat', exact: true }).click();
  // 29 minutes before: "Rezerve · Ahmet Yılmaz · 4 kişi · 20:00" and the table QR closed (the same setting).
  await page.clock.fastForward(2 * 60_000);
  await expect(masa5).toContainText(`Rezerve · Ahmet Yılmaz · 4 kişi · ${when.time}`, { timeout: 20000 });
  await expect(masa5).toContainText(`QR kapalı · ${when.time} rezervasyonu`);
  await expect(masa5).toHaveClass(/reserved/);
  await masa5.scrollIntoViewIfNeeded();
  await shot(page, 'masalar-rezerve.png', info.outputPath('masalar-rezerve.png'), false);
  // 31 minutes after: the small question, for both.
  await page.clock.fastForward(60 * 60_000);
  const asks = page.getByRole('region', { name: 'Rezervasyon soruları' });
  const ahmet = asks.locator('.resv-ask').filter({ hasText: 'Ahmet Yılmaz' });
  await expect(ahmet).toContainText(`Ahmet Yılmaz · ${when.time} · Geldi mi?`, { timeout: 20000 });
  await expect(masa5).toContainText('Geldi mi?');
  await asks.scrollIntoViewIfNeeded();
  await shot(page, 'rezervasyon-geldi-mi.png', info.outputPath('rezervasyon-geldi-mi.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Masalar ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });
  // "15 dk daha bekle" puts the question away for 15 minutes; then it comes back.
  await ahmet.getByRole('button', { name: '15 dk daha bekle' }).click();
  await expect(ahmet).toHaveCount(0);
  await page.clock.fastForward(16 * 60_000);
  await expect(ahmet).toBeVisible({ timeout: 20000 });
  // Burak did not come: asked once more, then the table is free and the kapora waits for the owner.
  const burak = asks.locator('.resv-ask').filter({ hasText: 'Burak' });
  await burak.getByRole('button', { name: 'Gelmedi' }).click();
  await burak.getByRole('button', { name: 'Evet, gelmedi' }).click();
  await expect(burak).toHaveCount(0);
  // Ahmet came: the bill opens with his name.
  await ahmet.getByRole('button', { name: 'Geldi' }).click();
  await expect(asks).toHaveCount(0);
  await expect(masa5.locator('.table-guest')).toHaveText('Ahmet Yılmaz · 4 kişi');
  const state = await (await page.request.get('/api/staff/state')).json();
  const table5 = state.tables.find((t: any) => t.name === 'Masa 05');
  const total = await order(page.request, table5.id, 20);
  await masa5.click();
  const window5 = page.getByRole('dialog', { name: 'Masa 05 · Ahmet Yılmaz' });
  await expect(window5).toContainText(`Kapora ${tl(50000)} (Nakit)`);
  await expect(window5).toContainText(`${tl(Math.min(50000, total))} bu hesaptan düşüldü`);
  await shot(page, 'rezervasyon-masa-hesap.png', info.outputPath('rezervasyon-masa-hesap.png'), false);
  await window5.getByRole('button', { name: 'Kapat', exact: true }).click();
  // The rest is paid at the counter.
  const fresh = (await (await page.request.get('/api/staff/state')).json()).tables.find((t: any) => t.name === 'Masa 05');
  expect(fresh.account.balance).toBe(Math.max(0, total - 50000));
  if (fresh.account.balance > 0) expect((await page.request.post('/api/staff/payments', { data: { requestId: randomUUID(), accountId: fresh.account.id, version: fresh.account.version, method: 'cash', amount: fresh.account.balance, tendered: fresh.account.balance } })).ok()).toBe(true);
  else expect((await page.request.post('/api/staff/reservations/close-with-deposit', { data: { requestId: randomUUID(), accountId: fresh.account.id, version: fresh.account.version } })).ok()).toBe(true);

  // The owner: Burak's kapora stays with the business.
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ajanda bölümleri' }).getByRole('button', { name: 'Rezervasyonlar' }).click();
  const pending = page.getByRole('region', { name: 'Kapora kararı bekleyenler' });
  await expect(pending).toContainText('Burak');
  await expect(pending).toContainText(`Gelmeyen kaporası · ${tl(30000)} · Kart`);
  await shot(page, 'rezervasyon-kapora-karari.png', info.outputPath('rezervasyon-kapora-karari.png'), false);
  // (Ahmet's kapora may also be larger than his bill: that rest waits here too.)
  await pending.locator('.resv-pending-row').filter({ hasText: 'Burak' }).getByRole('button', { name: 'İşletmede kalsın' }).click();
  await expect(page.getByText('Burak kaporası işletmede kaldı.')).toBeVisible();
  await expect(pending.filter({ hasText: 'Burak' })).toHaveCount(0);

  // Takvim marks the day.
  await page.getByRole('navigation', { name: 'Ajanda bölümleri' }).getByRole('button', { name: 'Takvim' }).click();
  await expect(page.locator(`.agenda-cell.has-resv[aria-label*="rezervasyon"]`).first()).toBeVisible();

  // Satış ve Raporlar → Rezervasyon.
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await openReport(page, 'Rezervasyon');
  // The tablet's clock was moved on by hours: late in the evening it is already tomorrow there, so a week is read.
  await page.getByRole('button', { name: '7 gün', exact: true }).click();
  const money = page.getByRole('region', { name: 'Kapora' });
  await expect(money).toContainText('Alınan kapora');
  await expect(money).toContainText(tl(80000));
  await expect(money).toContainText('İşletmede kalan');
  await expect(page.locator('.kpi').filter({ hasText: 'Gelmedi' })).toContainText('Geldi 1 · Gelmedi 1');
  await shot(page, 'rezervasyon-rapor.png', info.outputPath('rezervasyon-rapor.png'), false);
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Rapor ${width}`).toBe(true); }
  // Özet: the Rezervasyon part of the sales.
  await page.setViewportSize({ width: 1280, height: 860 });
  await openReport(page, 'Özet');
  await expect(page.locator('.split-legend')).toContainText('Rezervasyon');
  // The day's bar: the tip says its coloured Rezervasyon part the way the bar's label does ("₺X, rezervasyon ₺Y").
  const resvBar = page.locator('.daily-bars button').filter({ has: page.locator('.bar-resv') }).first();
  await resvBar.hover();
  const said = (await resvBar.getAttribute('aria-label'))!.split(': ')[1].replace(/, not var$/, '');
  expect(said).toContain('rezervasyon');
  await expect(page.locator('.daily-card .chart-tip')).toContainText(said);
});

test('masa penceresi: the night turns at 05:00, so at 22:45 the 00:45 guest is seated early and the next morning stays away', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // The next 00:45 at least two hours away (the server takes real time), and 09:00 that morning on another table.
  const DAY = 86400_000, midnight = Math.floor((Date.now() + 3 * 3600_000) / DAY) * DAY - 3 * 3600_000;
  let at = midnight + 45 * 60_000;
  while (at < Date.now() + 2 * 3600_000) at += DAY;
  const state = await (await page.request.get('/api/staff/state')).json();
  const book = async (table: string, name: string, when: { day: string; time: string }) => {
    const r = await page.request.post('/api/staff/reservations', { data: { requestId: randomUUID(), tableId: state.tables.find((t: any) => t.name === table).id, day: when.day, time: when.time, name, people: 2 } });
    expect(r.ok(), await r.text()).toBe(true);
  };
  await book('Masa 03', 'Gece', istanbul(at));
  await book('Masa 04', 'Sabah', istanbul(at + 8 * 3600_000 + 15 * 60_000));
  // Both reach the floor snapshot (the window decides, not the server).
  expect((await (await page.request.get('/api/staff/state')).json()).reservationMarks.map((m: any) => m.name)).toEqual(expect.arrayContaining(['Gece', 'Sabah']));
  // This tablet: 22:45 the evening before. Masalar shows nothing yet; the window already offers tonight's guest.
  await page.clock.install({ time: at - 2 * 3600_000 });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const card = (name: string) => page.locator('.table-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card('Masa 03')).toBeVisible();
  await expect(card('Masa 03')).not.toContainText('Rezerve');
  await card('Masa 03').click();
  const w3 = page.getByRole('dialog', { name: 'Masa 03' });
  await expect(w3.getByTestId('resv-later')).toContainText('Bugün 00:45 rezervasyon');
  await expect(w3.getByTestId('resv-later')).toContainText('Gece · 2 kişi');
  await expect(w3.getByRole('button', { name: 'Geldi' })).toBeVisible();
  await w3.getByRole('button', { name: 'Kapat', exact: true }).click();
  const w4 = page.getByRole('dialog', { name: 'Masa 04' });
  await card('Masa 04').click();
  await expect(w4).toBeVisible();
  await expect(w4).not.toContainText('Sabah');
  await w4.getByRole('button', { name: 'Kapat', exact: true }).click();
  // 01:00, past midnight: 09:00 is on today's date but still the next day's, not offered from the window.
  await page.clock.fastForward(2 * 3600_000 + 15 * 60_000);
  await expect(card('Masa 03')).toContainText('Rezerve · Gece · 2 kişi · 00:45', { timeout: 20000 });
  await card('Masa 04').click();
  await expect(w4).toBeVisible();
  await expect(w4).not.toContainText('Sabah');
});

test('masa planı: tap a free table to reserve it (table, day and time filled), tap the reserved one for Geldi / Düzenle / İptal; 24-hour times', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // A day without other reservations: two days ahead.
  const day = istanbul(Date.now() + 2 * 86400_000).day;
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  // Rezervasyonlar opens first: one date picker, one time, the café's tables with their state.
  const parts = page.getByRole('navigation', { name: 'Ajanda bölümleri' });
  await parts.getByRole('button', { name: 'Rezervasyonlar' }).click();
  await page.getByLabel('Gün', { exact: true }).fill(day);
  const plan = page.getByRole('region', { name: 'Masa planı' });
  await page.locator('.resv-plan-bar').getByLabel('Saat').fill('20:30');
  const tile = (name: string) => plan.locator(`.plan-cell[data-table="${name}"]`);
  await expect(tile('Masa 07')).toContainText('Boş');
  // A free table: the short sheet, Masa 07 and the day already chosen, the time 20:30.
  await tile('Masa 07').locator('.plan-tile').click();
  const sheet = page.getByRole('dialog', { name: 'Rezervasyon · Masa 07' });
  await expect(sheet.locator('.resv-sheet-where')).toContainText('Masa 07');
  const time = sheet.getByLabel(/^Saat/);
  await expect(time).toHaveValue('20:30');
  // 24 hours, typed the quick way: "2045" becomes 20:45 (never AM/PM).
  await time.fill(''); await time.pressSequentially('2045');
  await expect(time).toHaveValue('20:45');
  await sheet.getByLabel(/Misafir adı/).fill('Zeynep Kaya');
  await sheet.getByLabel('Kişi sayısı').fill('3');
  await sheet.getByLabel(/Telefon/).fill('0532 444 55 66');
  await expect(sheet.getByLabel(/^Masa/)).toHaveCount(0);
  await shot(page, 'rezervasyon-masa.png', info.outputPath('rezervasyon-masa.png'), false);
  await sheet.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.getByText('Zeynep Kaya için Masa 07 ayrıldı (20:45).')).toBeVisible();
  await expect(tile('Masa 07')).toContainText('Rezerve 20:45');
  await expect(tile('Masa 07')).toContainText('Zeynep Kaya · 3 kişi');
  await expect(page.locator('.resv-card').filter({ hasText: 'Zeynep Kaya' })).toContainText('3 kişi · Masa 07');
  // Outside the ±2 hour window the table is free for that time, with the other time named.
  await page.locator('.resv-plan-bar').getByLabel('Saat').fill('14:00');
  await expect(tile('Masa 07')).toContainText('Boş');
  await expect(tile('Masa 07')).toContainText('Başka saat: 20:45');
  await page.locator('.resv-plan-bar').getByLabel('Saat').fill('20:00');
  // The reserved table: its reservation with Düzenle and İptal (Geldi only near the time).
  await tile('Masa 07').locator('.plan-tile').click();
  const reserved = page.getByRole('dialog', { name: 'Masa 07 · Rezervasyon' });
  await expect(reserved).toContainText('Zeynep Kaya');
  await expect(reserved.getByRole('button', { name: 'Zeynep Kaya geldi' })).toHaveCount(0);
  await reserved.getByRole('button', { name: 'Zeynep Kaya rezervasyonunu düzenle' }).click();
  const edit = page.getByRole('dialog', { name: 'Rezervasyonu düzenle' });
  await edit.getByLabel('Kişi sayısı').fill('4');
  await edit.getByRole('button', { name: 'Kaydet' }).click();
  await expect(tile('Masa 07')).toContainText('Zeynep Kaya · 4 kişi');
  // The same table half an hour later: the ±2 hour warning still asks first.
  await tile('Masa 07').locator('.plan-tile').click();
  await page.getByRole('dialog', { name: 'Masa 07 · Rezervasyon' }).getByRole('button', { name: 'Başka saate rezervasyon' }).click();
  const second = page.getByRole('dialog', { name: 'Rezervasyon · Masa 07' });
  await expect(second.locator('.resv-sheet-taken')).toContainText('20:45 Zeynep Kaya');
  await second.getByLabel(/Misafir adı/).fill('Can');
  await second.getByLabel(/^Saat/).fill('21:15');
  await second.getByRole('button', { name: 'Kaydet' }).click();
  await expect(second.getByText(/2 saat içinde başka rezervasyon var: Zeynep Kaya/)).toBeVisible();
  await second.getByRole('button', { name: 'Vazgeç' }).click();
  // İptal from the table.
  await tile('Masa 07').locator('.plan-tile').click();
  await page.getByRole('dialog', { name: 'Masa 07 · Rezervasyon' }).getByRole('button', { name: 'Zeynep Kaya rezervasyonunu iptal et' }).click();
  await page.getByRole('dialog', { name: 'Rezervasyon iptal edilsin mi?' }).getByRole('button', { name: 'İptal et' }).click();
  await expect(tile('Masa 07')).toContainText('Boş');
  await fieldsAre16(page, '.resv-plan-bar');
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Masa planı ${width}`).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'rezervasyon-plan-telefon.png', info.outputPath('rezervasyon-plan-telefon.png'));

  // Today: a bill open on a table shows "Dolu"; a reservation near now offers "Geldi" from the table.
  await page.setViewportSize({ width: 1280, height: 860 });
  const now = istanbul(Date.now() + 15 * 60_000), state = await (await page.request.get('/api/staff/state')).json();
  const t8 = state.tables.find((t: any) => t.name === 'Masa 08'), t9 = state.tables.find((t: any) => t.name === 'Masa 09');
  await order(page.request, t9.id, 1);
  if (now.day === istanbul(Date.now()).day) {
    expect((await page.request.post('/api/staff/reservations', { data: { requestId: randomUUID(), tableId: t8.id, day: now.day, time: now.time, name: 'Ece', people: 2 } })).ok()).toBe(true);
    await page.getByRole('button', { name: 'Bugün', exact: true }).click();
    await page.locator('.resv-plan-bar').getByLabel('Saat').fill(now.time);
    await expect(tile('Masa 09')).toContainText('Dolu');
    await tile('Masa 08').locator('.plan-tile').click();
    const ece = page.getByRole('dialog', { name: 'Masa 08 · Rezervasyon' });
    await ece.getByRole('button', { name: 'Ece geldi' }).click();
    await expect(page.getByText('Ece masaya oturdu.')).toBeVisible();
    await expect(tile('Masa 08')).toContainText('Dolu');
  }
});
test('rezerve masada QR (12 Ekim): 30 minutes before, the table QR stops new orders with a calm sentence; staff see why; Geldi opens it for the party', async ({ page, browser }, info) => {
  test.setTimeout(120000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { commissionBps: null, changeSeconds: 0, waiterApproval: false } })).ok()).toBe(true);
  // The server's own clock decides the guest side: a reservation a quarter of an hour from now is inside its 30 minutes.
  const when = istanbul(Date.now() + 15 * 60_000), state = await (await page.request.get('/api/staff/state')).json();
  const t10 = state.tables.find((t: any) => t.name === 'Masa 10'), t12 = state.tables.find((t: any) => t.name === 'Masa 12');
  // A walk-in already eats at Masa 12 when its reservation's half hour starts.
  await order(page.request, t12.id, 1);
  for (const [t, name] of [[t10, 'Selin Kaya'], [t12, 'Mert']] as const) {
    const r = await page.request.post('/api/staff/reservations', { data: { requestId: randomUUID(), tableId: t.id, day: when.day, time: when.time, name, people: 2 } });
    expect(r.ok(), await r.text()).toBe(true);
  }
  const reserved = `Bu masa ${when.time} için ayrılmıştır. Sipariş için lütfen garsonunuza sorun.`;
  // The guest at Masa 10: the menu, a calm note, the basket waits, Garson çağır works.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'tr-TR' }), guest = await phone.newPage();
  await guest.goto(`/m/${t10.token}`);
  await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 15000 });
  await expect(guest.getByTestId('ordering-reserved')).toContainText(reserved);
  await expect(guest.getByTestId('ordering-closed')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Garson çağır' })).toBeEnabled();
  expect(await noSideScroll(guest)).toBe(true);
  await shotIn(guest, 'misafir', 'masa-rezerve.png', info.outputPath('masa-rezerve.png'));
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await expect(guest.getByRole('button', { name: 'Siparişi gönder', exact: true })).toBeDisabled();
  await expect(guest.locator('.send-blocked-reason')).toHaveText(reserved);
  await guest.keyboard.press('Escape');
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guest.getByTestId('ordering-reserved')).toContainText(`This table is reserved for ${when.time}. Please ask your waiter to order.`);
  await guest.getByRole('button', { name: 'TR', exact: true }).click();

  // The staff side: "QR kapalı · 20:00 rezervasyonu" on the tile and in the window; the walk-in table says it plainly.
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const card = (name: string) => page.locator('.table-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(card('Masa 10')).toContainText(`Rezerve · Selin Kaya · 2 kişi · ${when.time}`, { timeout: 20000 });
  await expect(card('Masa 10').getByTestId('table-qr-held')).toHaveText(`QR kapalı · ${when.time} rezervasyonu`);
  await expect(card('Masa 12').getByTestId('table-held-busy')).toHaveText(`${when.time} rezervasyonu · masada hâlâ misafir var`);
  await expect(card('Masa 12')).toHaveClass(/held-busy/);
  await card('Masa 10').scrollIntoViewIfNeeded();
  await shot(page, 'masa-rezerve-qr-kapali.png', info.outputPath('masa-rezerve-qr-kapali.png'), false);
  await card('Masa 10').click();
  const w10 = page.getByRole('dialog', { name: 'Masa 10' });
  await expect(w10).toContainText(`QR kapalı · ${when.time} rezervasyonu`);
  await page.screenshot({ path: info.outputPath('masa-rezerve-pencere.png') });
  await w10.getByRole('button', { name: 'Kapat', exact: true }).click();
  await card('Masa 12').click();
  const w12 = page.getByRole('dialog', { name: /^Masa 12/ });
  await expect(w12).toContainText(`${when.time} rezervasyonu · masada hâlâ misafir var`);
  await w12.getByRole('button', { name: 'Kapat', exact: true }).click();
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Masalar rezerve ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });

  // Selin came: "Geldi" from the window; the same QR works for her party at once and the waiting basket goes.
  await card('Masa 10').click();
  await w10.getByRole('button', { name: 'Geldi' }).click();
  await expect(card('Masa 10').locator('.table-guest')).toHaveText('Selin Kaya · 2 kişi');
  await expect(card('Masa 10').getByTestId('table-qr-held')).toHaveCount(0);
  await expect(guest.getByTestId('ordering-reserved')).toHaveCount(0, { timeout: 10000 });
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByRole('dialog', { name: 'Siparişiniz alındı' })).toBeVisible();
  await phone.close();
});

test('K-Q (9 Ekim): a plan left open over midnight moves on to the new day; a time already past asks before it is saved', async ({ page }) => {
  test.setTimeout(120000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const today = istanbul(Date.now()).day, tomorrow = istanbul(Date.parse(`${today}T12:00:00+03:00`) + 86400_000).day;
  const shown = (day: string) => day.split('-').reverse().join('.');
  // This tablet's clock: 23:59:20 tonight (the user test: opened 23:39, used at 00:01).
  await page.clock.install({ time: Date.parse(`${today}T23:59:20+03:00`) });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajanda ve rezervasyon', exact: true }).click();
  await page.getByRole('navigation', { name: 'Ajanda bölümleri' }).getByRole('button', { name: 'Rezervasyonlar' }).click();
  const dayField = page.getByLabel('Gün', { exact: true });
  await expect(dayField).toHaveValue(shown(today));
  await page.clock.fastForward(70_000);
  await expect(dayField).toHaveValue(shown(tomorrow));
  // "Masa ayır" for 21:00 of the day that just ended: a warning first; saved only with "Yine de kaydet".
  await page.getByRole('button', { name: 'Masa ayır' }).click();
  const dialog = page.getByRole('dialog', { name: 'Masa ayır' });
  await dialog.getByLabel(/Misafir adı/).fill('Geç Kalan');
  await dialog.getByLabel(/^Masa/).selectOption({ label: 'Masa 11' });
  await dialog.getByLabel(/^Gün/).fill(today);
  await dialog.getByLabel(/^Saat/).fill('21:00');
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await expect(dialog.getByTestId('resv-past')).toContainText('21:00 geçti. Geçmiş bir saate rezervasyon yazıyorsunuz');
  await expect(dialog).toBeVisible();
  // A time ahead needs no question.
  await dialog.getByLabel(/^Gün/).fill(tomorrow);
  await expect(dialog.getByTestId('resv-past')).toHaveCount(0);
  await dialog.getByLabel(/^Gün/).fill(today);
  await dialog.getByRole('button', { name: 'Kaydet' }).click();
  await dialog.getByTestId('resv-past').getByRole('button', { name: 'Yine de kaydet' }).click();
  await expect(dialog).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/staff/reservations?from=${today}&to=${today}`)).json()).reservations.find((r: any) => r.name === 'Geç Kalan');
  expect(saved?.time).toBe('21:00');
  expect((await page.request.post('/api/staff/reservations/cancel', { data: { requestId: randomUUID(), id: saved.id } })).status()).toBeLessThan(500);
});

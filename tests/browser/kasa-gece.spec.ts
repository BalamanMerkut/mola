import { test, expect, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { cashAction, ensureSetup, openReport, type ReportTab, openView } from './helpers';

/*
 * QA turu (kasiyer, işletme sahibi, etkinlik gecesi): the payment window's sticky footer and quick cash, "Ürün seç" steppers,
 * kapora on the bill and on the card total, the Kasa strip through a day (no sale yet, a handover, gün sonu, sales after it),
 * the closing person's shift, the owner's cash out below zero, money typed the Turkish way, "Bugün" after midnight in every
 * report tab, the rent note under "Elde kalan" and the cleaning table in "Sipariş al".
 */
const PASSWORD = 'MolaDemo!2026';
const rid = () => randomUUID().replace(/-/g, '');
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çıkış yap', exact: true }).first()).toBeAttached();
  return page;
}
/** Four teas (₺140) on a table, ordered by the waiter's account. */
async function order(page: Page, tableId: string, quantity = 4) {
  const r = await page.request.post('/api/staff/orders', { data: { requestId: rid(), tableId, lines: [{ productId: 'tea', quantity, selections: [] }], expectedTotal: 3500 * quantity } });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).accountId as string;
}
async function payAll(page: Page, accountId: string, method: 'cash' | 'card' = 'cash') {
  const state = await (await page.request.get('/api/staff/state')).json();
  const account = [...state.tables, ...(state.eventTables ?? [])].find((t: { account?: { id: string } }) => t.account?.id === accountId).account;
  const r = await page.request.post('/api/staff/payments', { data: { requestId: rid(), accountId, version: account.version, method, amount: account.balance, tendered: account.balance } });
  expect(r.ok(), await r.text()).toBe(true);
}
const istanbul = (at: number) => { const v = new Date(at + 3 * 3600_000).toISOString(); return { day: v.slice(0, 10), time: v.slice(11, 16) }; };

test('Kasa şeridi before gün sonu: no reminder before the first sale, then "Bütün hesaplar kapandı"; a handover shows "Devir"', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  // "05:00" is always past (the reminder runs until 05:00 the next morning).
  expect((await page.request.post('/api/staff/cash/settings', { data: { closingTime: '05:00' } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  // The counter's compact Masalar (1280 px): the strip is one chip, "Kasa açık · 08:12'den beri · ₺500".
  const strip = cashier.locator('.cash-chip');
  try {
    await expect(cashier.getByRole('form', { name: 'Kasa açılışı' })).toBeVisible();
    await expect(cashier.locator('.cash-day')).not.toContainText('Kasa açılmadı');
    expect((await cashier.request.post('/api/staff/cash/open', { data: { requestId: rid(), amount: 0 } })).ok()).toBe(true);
    await cashier.reload();
    await expect(strip).toContainText('Kasa açık');
    await expect(strip).toContainText(/\d\d:\d\d'(den|dan|ten|tan) beri · ₺0/);
    await expect(cashier.getByText('Bütün hesaplar kapandı')).toHaveCount(0);
    await payAll(cashier, await order(waiter, 'table-1'));
    await cashier.reload();
    await expect(cashier.getByText('Bütün hesaplar kapandı')).toBeVisible();
    // A handover: "Vardiya devri · sonuç", then the strip shows what was handed over, not the morning's opening.
    await cashAction(cashier, 'Gün sonu');
    const dialog = cashier.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Vardiya devri', exact: true }).click();
    await dialog.getByRole('button', { name: 'Tek toplam' }).click();
    await dialog.getByLabel('Kasadaki nakit toplamı').fill('140');
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    await expect(cashier.getByRole('heading', { name: 'Vardiya devri · sonuç' })).toBeVisible();
    await expect(dialog.getByTestId('blind-result')).toContainText('₺'); await expect(dialog.locator('.cash-lines-total')).toHaveCount(0); // the cashier counts blind (8 Ekim)
    await dialog.getByRole('button', { name: 'Devri tamamla' }).click();
    await expect(cashier.getByRole('heading', { name: 'Vardiya devri kaydedildi' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(strip).toContainText(/Devir \d\d:\d\d · ₺140/);
  } finally {
    await page.request.post('/api/staff/cash/settings', { data: { closingTime: null } });
    for (const p of [cashier, waiter]) await p.context().close();
  }
});
test('Ödeme al: the change and "Ödemeyi kaydet" stay in sight; quick cash, − / + per item, the kapora on the bill and on the card total', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  try {
    await order(waiter, 'table-1');
    await cashier.locator('.table-card', { hasText: 'Masa 01' }).click();
    await cashier.getByRole('button', { name: 'Ödeme al' }).click();
    const pay = cashier.getByRole('dialog', { name: 'Masa 01 · Ödeme al' });
    // Quick cash: "Tam" and the notes fill "Alınan nakit"; a note smaller than the bill is greyed; the change is big.
    await expect(pay.getByRole('button', { name: '₺100', exact: true })).toBeDisabled();
    await pay.getByRole('button', { name: '₺500', exact: true }).click();
    await expect(pay.getByLabel('Alınan nakit (TL)')).toHaveValue('500');
    await expect(pay.locator('.payment-change')).toContainText('Para üstü'); await expect(pay.locator('.payment-change strong')).toHaveText('₺360');
    await pay.getByRole('button', { name: 'Tam', exact: true }).click();
    await expect(pay.getByLabel('Alınan nakit (TL)')).toHaveValue('140'); await expect(pay.locator('.payment-change strong')).toHaveText('₺0');
    // Money the Turkish way: "1.000" is a thousand lira; "1,000.50" says why it is not understood (no silent red border).
    await pay.getByLabel('Alınan nakit (TL)').fill('1.000');
    await expect(pay.locator('.payment-change strong')).toHaveText('₺860');
    await pay.getByLabel('Alınan nakit (TL)').fill('1,000.50');
    await expect(pay.getByText('Binlik için nokta, kuruş için virgül kullanın: örn. 1.250,50.').first()).toBeVisible();
    await pay.getByRole('button', { name: 'Tam', exact: true }).click();
    // "Ürün seç": − and +, never a drop-down.
    await pay.getByRole('button', { name: 'Ürün seç', exact: true }).click();
    const add = pay.getByRole('button', { name: 'Demleme Çay bir adet ekle' });
    await add.click(); await add.click();
    await expect(pay.getByText('Seçtiğiniz ürünlerin toplamı tahsil edilir: ₺70')).toBeVisible();
    await pay.getByRole('button', { name: 'Demleme Çay bir adet azalt' }).click();
    await expect(pay.getByText('Seçtiğiniz ürünlerin toplamı tahsil edilir: ₺35')).toBeVisible();
    await pay.getByRole('button', { name: 'Tamamı', exact: true }).click();
    // With a tip open the window is taller than the screen: the change and the save button stay in sight anyway.
    await pay.getByRole('button', { name: '+ Bahşiş ekle' }).click();
    await pay.getByLabel('Bahşiş tutarı').fill('20');
    for (const [width, height] of [[1280, 800], [1024, 768], [820, 1180], [390, 844]] as const) {
      await cashier.setViewportSize({ width, height });
      await expect(pay.getByRole('button', { name: 'Ödemeyi kaydet' }), `${width}×${height}`).toBeInViewport({ ratio: 1 });
      await expect(pay.locator('.payment-change'), `${width}×${height}`).toBeInViewport({ ratio: 1 });
      expect(await cashier.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}`).toBe(true);
      await cashier.screenshot({ path: info.outputPath(`odeme-${width}.png`) });
    }
    await cashier.setViewportSize({ width: 1280, height: 800 });
    await pay.getByRole('button', { name: '₺200', exact: true }).click();
    await expect(pay.locator('.payment-change strong')).toHaveText('₺40');
    await pay.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    await expect(cashier.getByRole('status').filter({ hasText: 'Para üstü: ₺40' })).toBeVisible();
    // K-D (9 Ekim): the window closed; the change stays large for a few seconds.
    await expect(cashier.getByTestId('change-due')).toContainText('Verilecek para üstü');
    await expect(cashier.getByTestId('change-due').locator('strong')).toHaveText('₺40');

    // A reservation with a ₺50 card kapora, seated on Masa 02: the bill shows it; "Ürün seç" says why it is not offered.
    const state = await (await cashier.request.get('/api/staff/state')).json();
    const masa2 = state.tables.find((t: { name: string }) => t.name === 'Masa 02');
    const when = istanbul(Date.now() + 40 * 60_000);
    const booked = await page.request.post('/api/staff/reservations', { data: { requestId: rid(), tableId: masa2.id, day: when.day, time: when.time, name: 'Kaporalı', people: 2, deposit: { amount: 5000, method: 'card' } } });
    expect(booked.ok(), await booked.text()).toBe(true);
    expect((await page.request.post('/api/staff/reservations/seat', { data: { requestId: rid(), id: (await booked.json()).id } })).ok()).toBe(true);
    await order(waiter, masa2.id);
    await cashier.reload();
    await cashier.locator('.table-card', { hasText: 'Masa 02' }).click();
    await cashier.getByRole('button', { name: 'Ödeme al' }).click();
    const pay2 = cashier.getByRole('dialog', { name: /Masa 02 · Ödeme al/ });
    await expect(pay2.locator('.payment-deposit')).toContainText('Kapora düşüldü: ₺50');
    await pay2.getByRole('button', { name: 'Ürün seç', exact: true }).click();
    await expect(pay2.getByText(/rezervasyon kaporası düşüldü/)).toBeVisible();
    await pay2.getByRole('button', { name: 'Tamamı', exact: true }).click();
    await pay2.getByRole('button', { name: 'Kart', exact: true }).click();
    await pay2.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
    await expect(pay2).toHaveCount(0);
    // The count's card line adds up: ₺90 card sale + ₺50 kapora taken by card = ₺140. Cash: ₺140 handed over + ₺140 + ₺20 tip.
    await cashAction(cashier, 'Gün sonu');
    const closing = cashier.getByRole('dialog');
    await closing.getByRole('button', { name: 'Tek toplam' }).click();
    await closing.getByLabel('Kasadaki nakit toplamı').fill('300');
    await closing.getByRole('button', { name: 'Sayımı kaydet' }).click();
    // The cashier counts blind (8 Ekim): the card line is the owner's to read.
    await expect(closing.getByTestId('blind-result')).toContainText('₺300');
    await expect(closing.locator('.cash-side')).toHaveCount(0);
    const counted = (await (await page.request.get('/api/staff/reports/cash-closings?from=all&to=all')).json()).closings[0];
    expect([counted.figures.card, counted.figures.cardSales, counted.figures.cardDeposits]).toEqual([14000, 9000, 5000]);
    await closing.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await closing.getByRole('button', { name: 'Tamam', exact: true }).click();
  } finally {
    for (const p of [cashier, waiter]) await p.context().close();
  }
});

test('Kasa şeridi after gün sonu: not the main button any more; sales after it ask for one more closing; the closer\'s shift ends after "Tamam"; the owner\'s cash out below zero is asked', async ({ page, browser }) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  const cashier = await signedIn(browser, 'kasiyer'), waiter = await signedIn(browser, 'garson');
  const owner = await signedIn(browser, 'isletme');
  // The counter's compact Masalar (1280 px): the strip is one chip; its menu ("Kasa işlemleri") holds "Gün sonu".
  const strip = cashier.locator('.cash-chip'), menu = cashier.getByRole('group', { name: 'Kasa işlemleri' });
  const dayEnd = async () => { if (!await menu.isVisible()) await strip.click(); return menu.getByRole('button', { name: 'Gün sonu' }); };
  try {
    // Closed today by the test before: the strip says so, and "Gün sonu" is no longer the green main button.
    await expect(strip).toContainText('Kasa kapandı');
    await expect(strip).toContainText('Yarın sabah açılış');
    await expect(await dayEnd()).not.toHaveClass(/primary/);
    // The night goes on: a sale after gün sonu.
    await payAll(cashier, await order(waiter, 'table-3'));
    // 9 Ekim kullanıcı testi: at once, without a reload (it used to wait up to 30 s for the next cash-day read).
    await expect(strip).toContainText('Gün sonundan sonra satış var · ek kapanış yapın', { timeout: 10_000 });
    await cashier.reload();
    await expect(strip).toContainText('Gün sonundan sonra satış var · ek kapanış yapın');
    await expect(await dayEnd()).toHaveClass(/primary/);
    // Vardiya takibi on: the cashier works on a shift; the extra closing keeps it until "Tamam" on the result.
    expect((await page.request.post('/api/staff/cash/settings', { data: { shiftTracking: true } })).ok()).toBe(true);
    const code = (await (await page.request.get('/api/staff/shifts/code')).json()).code;
    expect((await cashier.request.post('/api/staff/shifts/start', { data: { code } })).ok()).toBe(true);
    await cashier.reload();
    await cashAction(cashier, 'Gün sonu');
    const dialog = cashier.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Tek toplam' }).click();
    await dialog.getByLabel('Kasadaki nakit toplamı').fill('440');
    await dialog.getByRole('button', { name: 'Sayımı kaydet' }).click();
    await expect(dialog.getByTestId('blind-result')).toContainText('₺'); await expect(dialog.locator('.cash-lines-total')).toHaveCount(0); // the cashier counts blind (8 Ekim)
    await dialog.getByRole('button', { name: 'Kapanışı tamamla' }).click();
    await expect(dialog.getByText('Vardiyanız “Tamam”a basınca biter.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'A4 yazdır' })).toBeVisible();
    await expect(cashier.getByRole('heading', { name: 'Vardiyayı başlat' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(cashier.getByRole('heading', { name: 'Vardiyayı başlat' })).toBeVisible();
    // The owner's "Sahip aldı" larger than the drawer: asked once, with "Yine de kaydet".
    await owner.reload();
    await cashAction(owner, 'Kasa hareketi');
    const move = owner.getByRole('dialog', { name: 'Kasa hareketi' });
    await move.getByRole('button', { name: 'Sahip aldı' }).click();
    await move.getByLabel('Hareket tutarı').fill('25.000');
    await move.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(move.getByText(/beklenen nakit eksiye düşer/)).toBeVisible();
    await expect(move.getByRole('button', { name: 'Yine de kaydet' })).toBeVisible();
    await move.getByRole('button', { name: 'Tutarı düzelt' }).click();
    await expect(move.getByRole('button', { name: 'Yine de kaydet' })).toHaveCount(0);
    await move.getByLabel('Hareket tutarı').fill('1,000.50');
    await expect(move.getByText('Binlik için nokta, kuruş için virgül kullanın: örn. 1.250,50.')).toBeVisible();
  } finally {
    await page.request.post('/api/staff/cash/settings', { data: { shiftTracking: false } });
    for (const p of [cashier, waiter, owner]) await p.context().close();
  }
});

test('"Bugün" after midnight is the evening\'s business day in every report tab; the period bar says so; rent on day one gets a note', async ({ page }) => {
  test.setTimeout(120000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  // 01:30 in Türkiye on 6 October: "Bugün" is still 5 October until 05:00.
  await page.clock.install({ time: new Date('2026-10-05T22:30:00Z') });
  await page.setViewportSize({ width: 1280, height: 860 });
  const asked: string[] = [];
  page.on('request', r => { const u = new URL(r.url()); if (/\/api\/staff\/(reports\/|payment-adjustments)/.test(u.pathname) && u.searchParams.get('from')) asked.push(`${u.pathname} ${u.searchParams.get('from')} ${u.searchParams.get('to')}`); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bugün (kasa günü, 05:00\'e kadar) hakkında bilgi' })).toBeVisible();
  for (const tab of ['Özet', 'Ürünler', 'Kârlılık', 'Kasa kapanışları', 'Giderler', 'İade ve düzeltme', 'Çalışanlar', 'Personel ve bahşiş', 'Rezervasyon'] as ReportTab[]) {
    // The record books open in their homes (Kasa ve giderler, Personel; 10 Ekim): wait until each one has asked.
    await openReport(page, tab);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.report-loading, [aria-busy="true"]')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByRole('status').filter({ hasText: 'Rapor yükleniyor' })).toHaveCount(0);
  }
  const paths = new Set(asked.map(a => a.split(' ')[0]));
  for (const p of ['/api/staff/reports/overview', '/api/staff/reports/products', '/api/staff/reports/profit', '/api/staff/reports/cash-closings', '/api/staff/reports/financial', '/api/staff/payment-adjustments', '/api/staff/reports/employees', '/api/staff/reports/staff-shifts', '/api/staff/reports/reservations']) expect([...paths], p).toContain(p);
  for (const a of asked) expect(a, a).toMatch(/ 2026-10-05 2026-10-05$/);

  // Day one with a month's rent recorded today: the note under "Elde kalan" (the accounting itself stays as it is).
  await page.clock.setSystemTime(Date.now());
  const today = istanbul(Date.now() - 5 * 3600_000).day;
  const rule = await page.request.post('/api/staff/recurring-expenses', { data: { requestId: rid(), name: 'Kira', amount: 2_500_000, method: 'transfer', repeat: { every: 'month', day: Number(today.slice(8)) }, start: today, end: null, active: true } });
  expect(rule.ok(), await rule.text()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await openReport(page, 'Özet');
  await expect(page.locator('.kpi-bulk-note')).toContainText('aylık kira gibi toplu giderler var');
});

test('Sipariş al: a table waiting for cleaning says why its products are greyed out', async ({ page, browser }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null, cleaningEnabled: true } })).ok()).toBe(true);
  const waiter = await signedIn(browser, 'garson');
  await waiter.setViewportSize({ width: 390, height: 844 });
  try {
    const account = await order(waiter, 'table-5');
    await payAll(page, account);
    await waiter.reload();
    // The waiter opens on Masalar (8 Ekim denetimi K6).
    await openView(waiter, 'Sipariş al');
    // The table is offered (marked) instead of silently disabled products.
    await expect(waiter.getByLabel('Sipariş masası').locator('option[value="table-5"]')).toContainText('Temizlik bekliyor');
    await waiter.getByLabel('Sipariş masası').selectOption('table-5');
    await expect(waiter.getByText('Bu masa temizlik bekliyor — garson “Temizlendi” deyince sipariş alınabilir.')).toBeVisible();
  } finally {
    await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null, cleaningEnabled: false } });
    await waiter.context().close();
  }
});

import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openView } from './helpers';

// QR guest fixes from the 2026-10 QA round (tests/guest-experience.test.ts has the server side).
const PASSWORD = 'MolaDemo!2026';
async function owner(request: APIRequestContext) {
  await request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(request);
  await request.post('/api/staff/heartbeat', { data: {} });
  return request;
}
const staffState = async (request: APIRequestContext) => (await request.get('/api/staff/state')).json();
async function settings(request: APIRequestContext, values: { changeSeconds: number; waiterApproval?: boolean }) {
  expect((await request.post('/api/staff/settings', { data: { commissionBps: null, ...values } })).ok()).toBe(true);
}
async function guestAt(browser: Browser, request: APIRequestContext, index: number): Promise<Page> {
  const state = await staffState(request);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`/m/${state.tables[index].token}`);
  await expect(page.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
  return page;
}
async function addTea(page: Page) {
  await page.getByRole('button', { name: /Demleme Çay/ }).click();
  await page.getByRole('button', { name: /Sepete ekle/ }).click();
}
async function sendBasket(page: Page) {
  await page.getByRole('button', { name: /Sepetimi görüntüle/ }).click();
  await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
}
const accountOf = async (request: APIRequestContext, index: number) => (await staffState(request)).tables[index].account;
async function payAll(request: APIRequestContext, index: number) {
  const a = await accountOf(request, index);
  expect((await request.post('/api/staff/payments', { data: { requestId: `pay-${index}-${Date.now()}`, accountId: a.id, version: a.version, method: 'cash', amount: a.balance, tendered: a.balance } })).ok()).toBe(true);
}
async function saveProduct(request: APIRequestContext, id: string, change: Record<string, unknown>) {
  const p = (await staffState(request)).products.find((x: any) => x.id === id);
  const saved = await request.post('/api/staff/products', { data: { id, product: { ...p, ...change } } });
  expect(saved.ok(), await saved.text()).toBe(true);
}

test('moved table: no thank-you or review, orders stay listed, the new table is not named, send says why', async ({ page, browser }) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 0, waiterApproval: false });
  const state = await staffState(request);
  await request.post('/api/staff/business-profile', { data: { requestId: 'review-link-1', version: state.businessRevision ?? 0, name: state.name, logo: state.logo ?? null, googleReviewUrl: 'https://g.page/r/mola-test/review' } });
  const guest = await guestAt(browser, request, 1);
  await addTea(guest); await sendBasket(guest);
  await expect(guest.getByText(/Sipariş #\d+ alındı\./)).toBeVisible();
  await expect(guest.getByText(/Afiyet olsun/)).toHaveCount(1);
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await addTea(guest);
  const a = await accountOf(request, 1), target = (await staffState(request)).tables[9];
  expect((await request.post('/api/staff/tables/move', { data: { requestId: 'move-guest-1', accountId: a.id, version: a.version, targetId: target.id, targetEpoch: target.epoch } })).ok()).toBe(true);
  const movedText = 'Siparişleriniz başka bir masaya taşındı. Yeni masanızın QR kodunu okutun ya da personelden yardım isteyin.';
  await expect(guest.getByText(movedText).first()).toBeVisible();
  await expect(guest.getByText(/Hesabınız kapandı/)).toHaveCount(0);
  await expect(guest.locator('.review-prompt')).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Yeni hesapla sipariş ver' })).toHaveCount(0);
  // The basket is kept, and the disabled button says why.
  await guest.getByRole('button', { name: /Sepetimi görüntüle/ }).click();
  await expect(guest.getByRole('button', { name: 'Siparişi gönder', exact: true })).toBeDisabled();
  await expect(guest.locator('.send-blocked-reason')).toHaveText(movedText);
  await guest.getByRole('button', { name: 'Kapat' }).click();
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  await expect(guest.locator('.customer-order')).toHaveCount(1);
  await expect(guest.locator('body')).not.toContainText(target.name);

  // A real payment is what ends with the thank-you and the review question.
  const paid = await guestAt(browser, request, 2);
  await addTea(paid); await sendBasket(paid);
  await paid.getByRole('button', { name: 'Tamam', exact: true }).click();
  await payAll(request, 2);
  // The calm closed card (title, one thank-you line, a real button) and the review card with only its title and the Google button.
  await expect(paid.getByRole('heading', { name: 'Hesabınız kapandı' })).toBeVisible();
  await expect(paid.getByText('Teşekkür ederiz, yine bekleriz.')).toBeVisible();
  await expect(paid.getByRole('button', { name: 'Yeni hesapla sipariş ver' })).toBeVisible();
  await expect(paid.locator('.review-prompt')).toBeVisible();
  await expect(paid.locator('.review-prompt').getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('href', 'https://g.page/r/mola-test/review');
  await expect(paid.locator('.review-prompt p')).toHaveCount(0);
});

test('Turkish-insensitive search by name, code and description for guests and staff; codes stay on cards', async ({ page, browser }) => {
  const request = await owner(page.request);
  const guest = await guestAt(browser, request, 3);
  const search = guest.getByLabel('Ürün ara', { exact: true });
  for (const q of ['cay', 'CAY', 'ÇAY', 'demleme', 'DEMLEME ÇAY', '21', '#21', 'ince belli', 'INCE']) {
    await search.fill(q);
    await expect(guest.locator('.product-card').filter({ hasText: 'Demleme Çay' }), q).toHaveCount(1);
  }
  await expect(guest.locator('.product-card').filter({ hasText: 'Demleme Çay' })).toContainText('#21');
  const staff = await browser.newContext(), waiter = await staff.newPage();
  await waiter.request.post('/api/login', { data: { username: 'garson', password: PASSWORD } });
  await waiter.goto('/');
  // The waiter opens on Masalar (8 Ekim denetimi K6).
  await openView(waiter, 'Sipariş al');
  await waiter.getByLabel('Sipariş masası').selectOption('table-12');
  for (const q of ['cay', 'ÇAY', '21']) {
    await waiter.getByRole('textbox', { name: 'Ürün ara' }).fill(q);
    await expect(waiter.locator('.staff-card').filter({ hasText: 'Demleme Çay' }), q).toHaveCount(1);
  }
  await staff.close();
});

test('basket survives a reload, marks sold-out and repriced lines by name, and is cleared after sending', async ({ page, browser }) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 0, waiterApproval: false });
  const products = (await staffState(request)).products;
  const other = products.find((p: any) => p.id !== 'tea' && !p.groups.length && p.unit !== 'kg' && !p.soldOut && p.published !== false && !p.discounts?.length && !/çay/i.test(p.name));
  const guest = await guestAt(browser, request, 4);
  await addTea(guest);
  await guest.getByLabel('Ürün ara', { exact: true }).fill(other.code);
  await guest.locator('.product-card').filter({ hasText: other.name }).first().click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.reload();
  await expect(guest.locator('.cart-floating .cart-count')).toHaveText('2');
  await guest.getByRole('button', { name: /Sepetimi görüntüle/ }).click();
  const basket = guest.getByRole('dialog');
  await expect(basket.locator('.cart-line')).toHaveCount(2);
  try {
    await saveProduct(request, 'tea', { soldOut: true });
    await saveProduct(request, other.id, { price: other.price + 500 });
    const teaLine = basket.locator('.cart-line').filter({ hasText: 'Demleme Çay' });
    await expect(teaLine).toContainText('Tükendi');
    await expect(basket.getByText('Tükendi: Demleme Çay. Göndermek için sepetten çıkarın.')).toBeVisible();
    await expect(basket.locator('.cart-line').filter({ hasText: other.name })).toContainText(/Fiyat güncellendi: ₺[\d.,]+ → ₺[\d.,]+/);
    await expect(basket.getByRole('button', { name: 'Siparişi gönder', exact: true })).toBeDisabled();
    await teaLine.getByRole('button', { name: 'Ürünü kaldır' }).click();
    await basket.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await expect(guest.getByText(/Sipariş #\d+ alındı\./)).toBeVisible();
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    await guest.reload();
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible();
    await expect(guest.locator('.cart-floating')).toHaveCount(0);
  } finally {
    await saveProduct(request, 'tea', { soldOut: false });
    await saveProduct(request, other.id, { price: other.price });
  }
});

test('English menu: no Turkish "MENÜ" caption and "Table" for the table name', async ({ page, browser }) => {
  const request = await owner(page.request);
  const guest = await guestAt(browser, request, 3);
  await guest.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(guest.locator('.table-pill')).toHaveText(/^Table \d+$/);
  const captions = guest.locator('.art-caption');
  if (await captions.count()) { await expect(captions.first()).toHaveText('MENU'); await expect(guest.locator('.art-caption', { hasText: 'MENÜ' })).toHaveCount(0); }
  await guest.getByRole('button', { name: 'TR', exact: true }).click();
  await expect(guest.locator('.table-pill')).toHaveText(/^Masa \d+$/);
});

test('sent window: waiter approval is not "received", the change window is told, "Afiyet olsun" once', async ({ page, browser }) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 60, waiterApproval: true });
  try {
    const guest = await guestAt(browser, request, 5);
    await addTea(guest); await sendBasket(guest);
    const dialog = guest.getByRole('dialog', { name: 'Siparişiniz garson onayına gönderildi' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Sipariş #\d+ garson onayına gönderildi\./);
    await expect(dialog).toContainText('60 sn içinde değiştirebilirsiniz.');
    await expect(dialog).not.toContainText('alındı');
    await expect(dialog).not.toContainText('Afiyet olsun');
    // K-J (9 Ekim kullanıcı testi): the open window follows its order; approved, it no longer says "garson onayına gönderildi".
    const tableName = (await staffState(request)).tables[5].name;
    const waiting = (await staffState(request)).orders.find((o: any) => o.tableName === tableName && o.status === 'awaiting_approval');
    expect((await request.post('/api/staff/orders/review', { data: { requestId: `approve-${waiting.id}`, orderId: waiting.id, version: waiting.version, approve: true } })).ok()).toBe(true);
    const approved = guest.getByRole('dialog', { name: 'Onaylandı, hazırlanıyor' });
    await expect(approved).toContainText(`Sipariş #${waiting.number} · Onaylandı, hazırlanıyor`);
    await expect(approved).not.toContainText('garson onayına gönderildi');
    await expect(approved).not.toContainText('değiştirebilirsiniz');
    await approved.getByRole('button', { name: 'Tamam', exact: true }).click();
    await settings(request, { changeSeconds: 60, waiterApproval: false });
    await addTea(guest); await sendBasket(guest);
    const received = guest.getByRole('dialog', { name: 'Siparişiniz alındı' });
    await expect(received).toContainText(/Sipariş #\d+ alındı\./);
    await expect(received.getByText(/Afiyet olsun/)).toHaveCount(1);
    await expect(received).toContainText('60 sn içinde değiştirebilirsiniz.');
    // Kitchen-direct: once the kitchen starts it the window says so, without the change line (the kitchen can start only
    // after the change time, so this order is sent with no change time).
    await received.getByRole('button', { name: 'Tamam', exact: true }).click();
    await settings(request, { changeSeconds: 0, waiterApproval: false });
    await addTea(guest); await sendBasket(guest);
    await expect(guest.getByRole('dialog', { name: 'Siparişiniz alındı' })).toBeVisible();
    const fresh = (await staffState(request)).orders.filter((o: any) => o.tableName === tableName && o.status === 'new').sort((a: any, b: any) => b.number - a.number)[0];
    expect((await request.post('/api/staff/status', { data: { requestId: `prep-${fresh.id}`, orderId: fresh.id, version: fresh.version, status: 'preparing' } })).ok()).toBe(true);
    const preparing = guest.getByRole('dialog', { name: 'Siparişiniz hazırlanıyor' });
    await expect(preparing).toContainText(`Sipariş #${fresh.number} · Siparişiniz hazırlanıyor`);
    await expect(preparing).not.toContainText('değiştirebilirsiniz');
    await preparing.getByRole('button', { name: 'Tamam', exact: true }).click();
  } finally { await settings(request, { changeSeconds: 0, waiterApproval: false }); }
});

test('K-J: "Siparişiniz güncellendi." is a short confirmation, gone after a few seconds', async ({ page, browser }) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 60, waiterApproval: false });
  try {
    const guest = await guestAt(browser, request, 11);
    await addTea(guest); await sendBasket(guest);
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    await guest.getByRole('button', { name: /Siparişlerim/ }).click();
    await guest.getByRole('button', { name: /^Siparişi değiştir · \d+/ }).first().click();
    const editor = guest.getByRole('dialog', { name: /^Sipariş #\d+ · Değiştir$/ });
    await editor.getByLabel('Demleme Çay adet', { exact: true }).fill('2');
    await editor.getByRole('button', { name: 'Değişiklikleri kaydet', exact: true }).click();
    const notice = guest.getByText('Siparişiniz güncellendi.');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(0, { timeout: 8000 });
  } finally { await settings(request, { changeSeconds: 0, waiterApproval: false }); }
});

test('My orders: newest first, no product code under plain lines, cancelled total struck, the table total, no cancel once ready', async ({ page, browser }) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 0, waiterApproval: false });
  const guest = await guestAt(browser, request, 6);
  for (let i = 0; i < 3; i++) { await addTea(guest); await sendBasket(guest); await guest.getByRole('button', { name: 'Tamam', exact: true }).click(); }
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  const cards = guest.locator('.customer-order');
  await expect(cards).toHaveCount(3);
  const numbers = await cards.locator('h3').allTextContents();
  const n = numbers.map(t => Number(t.replace(/\D/g, '')));
  expect(n).toEqual([...n].sort((a, b) => b - a));
  await expect(guest.locator('.customer-order .order-line small', { hasText: '#21' })).toHaveCount(0);
  await expect(guest.locator('.customer-due')).toContainText('Masanın hesabı');
  await expect(guest.locator('.customer-due strong')).toHaveText('₺105');
  // Prices include KDV: the bill says how much of it is KDV, like the printed bill (11 Ekim; demo menu at %10).
  await expect(guest.locator('.customer-due-vat')).toHaveText('Fiyatlara KDV dahildir · bu hesaptaki KDV ₺9,55');
  // The guest asks to cancel the oldest order and the café approves: its total is struck and leaves the own total.
  const oldest = cards.last();
  await oldest.getByRole('button', { name: 'Siparişi iptal et' }).click();
  await oldest.getByRole('button', { name: 'Emin misiniz? Evet, iptal et' }).click();
  await expect(oldest.getByRole('button', { name: 'İptal talebi gönderildi' })).toBeDisabled();
  const asked = (await staffState(request)).orders.find((o: any) => o.cancelRequested);
  expect((await request.post('/api/staff/cancel', { data: { requestId: `approve-${asked.id}`, orderId: asked.id, version: asked.version } })).ok()).toBe(true);
  await expect(guest.locator('.customer-order[data-status="cancelled"] .order-foot del')).toBeVisible();
  await expect(guest.locator('.customer-due strong')).toHaveText('₺70');
  // The kitchen readies the newest one: the guest is no longer offered a cancel request for it.
  const state = await staffState(request);
  let newest = state.orders.filter((o: any) => o.tableName === state.tables[6].name && o.status === 'new').sort((a: any, b: any) => b.number - a.number)[0];
  for (const status of ['preparing', 'ready']) {
    expect((await request.post('/api/staff/status', { data: { requestId: `st-${status}-${newest.id}`, orderId: newest.id, version: newest.version, status } })).ok()).toBe(true);
    newest = (await staffState(request)).orders.find((o: any) => o.id === newest.id);
  }
  const readyCard = cards.filter({ has: guest.getByRole('heading', { name: `Sipariş #${newest.number}`, exact: true }) });
  await expect(readyCard).toHaveAttribute('data-status', 'ready');
  await expect(readyCard.getByRole('button', { name: 'Siparişi iptal et' })).toHaveCount(0);
});

test('plain words: old QR link, lost connection, blocked phone', async ({ page, browser }) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 0, waiterApproval: false });
  const stranger = await (await browser.newContext()).newPage();
  for (const link of ['/m/eskikodeskikodeskikod', '/m/abc']) {
    await stranger.goto(link);
    await expect(stranger.getByText('Bu QR kodu yenilenmiş olabilir. Masanızdaki güncel kodu okutun ya da personelden yardım isteyin.')).toBeVisible();
    await expect(stranger.getByText(/Alanları kontrol edin/)).toHaveCount(0);
    await expect(stranger.getByRole('button', { name: /Yeniden kontrol et|Yeniden dene/ })).toHaveCount(0);
  }
  const guest = await guestAt(browser, request, 7);
  await addTea(guest);
  let lost = false;
  await guest.route('**/api/guest/orders', async route => { if (!lost) { lost = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await sendBasket(guest);
  await expect(guest.getByText('İnternet koptu. Siparişiniz gitmiş olabilir — kontrol etmek için dokunun.')).toBeVisible();
  await guest.getByRole('button', { name: 'Gönderimi yeniden kontrol et' }).click();
  await expect(guest.getByText(/Sipariş #\d+ alındı\./)).toBeVisible();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await addTea(guest);
  const now = await staffState(request), order = now.orders.find((o: any) => o.tableName === now.tables[7].name);
  expect((await request.post('/api/staff/block', { data: { orderId: order.id, blocked: true } })).ok()).toBe(true);
  try {
    await expect(guest.getByText('Bu telefondan sipariş verilemiyor. Lütfen siparişinizi personele iletin.')).toBeVisible();
    await guest.getByRole('button', { name: /Sepetimi görüntüle/ }).click();
    await expect(guest.getByRole('button', { name: 'Siparişi gönder', exact: true })).toBeDisabled();
    await expect(guest.locator('.send-blocked-reason')).toHaveText('Lütfen siparişinizi personele iletin.');
  } finally { await request.post('/api/staff/block', { data: { orderId: order.id, blocked: false } }); }
});

/** Guest screens: also saved to docs/ekran/misafir (next to KAFE_EKRAN) when that is set. */
async function guestShot(page: Page, file: string, path: string) {
  await page.screenshot({ path, fullPage: false });
  const folder = process.env.KAFE_EKRAN && join(process.env.KAFE_EKRAN, '..', 'misafir');
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage: false }); }
}
test('Siparişlerim shows the whole table bill: the waiter\'s items labelled "Garson ekledi", read-only; payments taken off; nothing old after closing', async ({ page, browser }, info) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 60, waiterApproval: false });
  try {
    const index = 8, state = await staffState(request), table = state.tables[index];
    const tea = state.products.find((p: any) => p.name === 'Demleme Çay');
    // The waiter takes the first order from his phone, before anyone scans the QR.
    const staffOrder = async (quantity: number) => expect((await request.post('/api/staff/orders', { data: { requestId: `w-${index}-${quantity}-${Date.now()}`, tableId: table.id, lines: [{ productId: tea.id, quantity, selections: [] }], expectedTotal: tea.price * quantity } })).ok()).toBe(true);
    await staffOrder(2);
    const guest = await guestAt(browser, request, index);
    await guest.getByRole('button', { name: /Siparişlerim/ }).click();
    const cards = guest.locator('.customer-order');
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator('.customer-order-by')).toHaveText('Garson ekledi');
    await expect(guest.locator('.customer-due')).toContainText('Masanın hesabı');
    await expect(guest.locator('.customer-due strong')).toHaveText(new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(tea.price * 2 / 100));
    // "Hesabı iste" works on a bill only the waiter wrote.
    await expect(guest.getByRole('button', { name: /Hesabı iste/ })).toBeEnabled();
    // The guest orders too: own order editable, the waiter's not; no cancel on the waiter's items.
    await guest.getByRole('button', { name: /Menümüz/ }).click();
    await addTea(guest); await sendBasket(guest); await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    await guest.getByRole('button', { name: /Siparişlerim/ }).click();
    await expect(cards).toHaveCount(2);
    const waiterCard = cards.filter({ has: guest.locator('.customer-order-by') }), ownCard = cards.filter({ hasNot: guest.locator('.customer-order-by') });
    await expect(waiterCard.getByRole('button', { name: 'Siparişi iptal et' })).toHaveCount(0);
    await expect(waiterCard.getByRole('button', { name: /Değiştir/ })).toHaveCount(0);
    await expect(ownCard.getByRole('button', { name: 'Siparişi iptal et' })).toHaveCount(1);
    // A partial payment at the counter (the waiter's items): "Ödenen" shows, the rest is to pay.
    const a = await accountOf(request, index), mine = (await staffState(request)).orders.find((o: any) => o.tableName === table.name && o.source === 'staff');
    expect((await request.post('/api/staff/payments', { data: { requestId: `part-${index}-${Date.now()}`, accountId: a.id, version: a.version, method: 'card', amount: tea.price * 2, tendered: tea.price * 2, selections: [{ orderId: mine.id, lineId: mine.lines[0].id, quantity: 2 }] } })).ok()).toBe(true);
    await expect(guest.locator('.customer-due')).toContainText('Ödenen');
    await expect(waiterCard.locator('.customer-order-paid')).toHaveText('Ödendi');
    await expect(guest.locator('.customer-due strong')).toHaveText(new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(tea.price / 100));
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guestShot(guest, 'siparislerim-masa.png', info.outputPath('siparislerim-masa.png'));
    // Closed: a new scan of the same table sees nothing of the old bill.
    await payAll(request, index);
    const next = await guestAt(browser, request, index);
    await next.getByRole('button', { name: /Siparişlerim/ }).click();
    await expect(next.locator('.customer-order')).toHaveCount(0);
    await expect(next.locator('.customer-due')).toHaveCount(0);
  } finally { await settings(request, { changeSeconds: 0, waiterApproval: false }); }
});
test('8 Ekim: the change time runs out with the edit window open: a clear pop-up, nothing saved, "Tamam" closes it (TR/EN)', async ({ page, browser }, info) => {
  const request = await owner(page.request);
  await settings(request, { changeSeconds: 60, waiterApproval: false });
  try {
    const state = await staffState(request), table = state.tables[9];
    for (const en of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const guest = await context.newPage();
      await guest.clock.install();
      await guest.goto(`/m/${table.token}`);
      await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
      await addTea(guest); await sendBasket(guest);
      await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
      await guest.getByRole('button', { name: /Siparişlerim/ }).click();
      if (en) await guest.getByRole('button', { name: 'EN', exact: true }).click();
      await guest.getByRole('button', { name: en ? /^Edit order · \d+/ : /^Siparişi değiştir · \d+/ }).first().click();
      const editor = guest.getByRole('dialog', { name: en ? /^Edit order #\d+$/ : /^Sipariş #\d+ · Değiştir$/ });
      await expect(editor).toBeVisible();
      const versions = async () => Object.fromEntries((await staffState(request)).orders.map((o: any) => [o.id, o.version]));
      const before = await versions();
      // The time runs out while the window is open.
      await guest.clock.fastForward(61_000);
      const expired = guest.getByRole('dialog', { name: en ? 'Your editing time is up' : 'Değişiklik süreniz doldu' });
      await expect(expired).toBeVisible();
      await expect(expired).toContainText(en ? 'Your order has gone to the kitchen; please ask your waiter for any change.' : 'Siparişiniz mutfağa iletildi; değişiklik için garsonunuza seslenin.');
      await expect(editor.getByRole('button', { name: en ? 'Save changes' : 'Değişiklikleri kaydet' })).toBeDisabled();
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (!en) await guestShot(guest, 'degisiklik-suresi-doldu.png', info.outputPath('degisiklik-suresi-doldu.png'));
      await expired.getByRole('button', { name: en ? 'OK' : 'Tamam', exact: true }).click();
      await expect(expired).toHaveCount(0);
      await expect(editor).toHaveCount(0);
      // Nothing half-saved: the orders are as they were.
      expect(await versions()).toEqual(before);
      await context.close();
    }
    // 9 Ekim kullanıcı testi: with waiter approval on the order is not in the kitchen yet; the pop-up says where it is.
    await settings(request, { changeSeconds: 60, waiterApproval: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const guest = await context.newPage();
    await guest.clock.install();
    await guest.goto(`/m/${state.tables[10].token}`);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
    await addTea(guest); await sendBasket(guest);
    await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
    await guest.getByRole('button', { name: /Siparişlerim/ }).click();
    await guest.getByRole('button', { name: /^Siparişi değiştir · \d+/ }).first().click();
    await guest.clock.fastForward(61_000);
    const expired = guest.getByRole('dialog', { name: 'Değişiklik süreniz doldu' });
    await expect(expired).toContainText('Siparişiniz garson onayında; değişiklik için garsonunuza seslenin.');
    await expect(expired).not.toContainText('mutfağa iletildi');
    await context.close();
    // Leave the table as it was: the waiting order is turned down.
    for (const o of (await staffState(request)).orders.filter((o: any) => o.tableId === state.tables[10].id && o.status === 'awaiting_approval'))
      await request.post('/api/staff/orders/review', { data: { requestId: crypto.randomUUID().replace(/-/g, ''), orderId: o.id, version: o.version, approve: false, reason: 'Test' } });
  } finally { await settings(request, { changeSeconds: 0, waiterApproval: false }); }
});

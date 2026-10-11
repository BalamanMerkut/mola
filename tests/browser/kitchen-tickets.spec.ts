import { test, expect, type Browser } from '@playwright/test';
import { createServer, type Server } from 'node:net';
import { networkInterfaces } from 'node:os';
import { bottomNav, ensureSetup, openSettings, openView } from './helpers';

/*
 * Mutfak fişi modu with a fake network receipt printer: a TCP listener on this computer's own LAN address (the printer
 * form accepts only private addresses and ports 9100–9109). Nothing is ever sent to a real printer.
 */
const PASSWORD = 'MolaDemo!2026';
const OK_PORT = 9107, CLOSED_PORT = 9108;
const lanAddress = () => Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('.workspace')).toBeVisible();
  return page;
}

test('Fiş modu: the switch needs a printer, a printed order is Hazırlanıyor and the waiter delivers it; a failed print warns until Tekrar bas', async ({ page, browser }, info) => {
  test.setTimeout(120000);
  const host = lanAddress();
  test.skip(!host, 'Bu bilgisayarda yerel ağ IPv4 adresi yok.');
  const received: Buffer[] = [];
  const printer: Server = createServer(socket => { socket.on('data', d => received.push(d)); socket.on('error', () => {}); });
  const listening = await new Promise<boolean>(done => { printer.once('error', () => done(false)); printer.listen(OK_PORT, '0.0.0.0', () => done(true)); });
  test.skip(!listening, `${OK_PORT} numaralı port kullanımda.`);
  const printed = () => Buffer.concat(received).toString('latin1');
  try {
    await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
    await ensureSetup(page.request);
    await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
    for (const p of (await (await page.request.get('/api/staff/printers')).json()).printers) await page.request.post('/api/staff/printers/delete', { data: { id: p.id } });

    // No printer yet: Fiş cannot be chosen, and the card says why.
    await page.goto('/');
    // Ayarlar → Sipariş ve mutfak → Mutfak (10 Ekim).
    await openSettings(page, 'Mutfak');
    const card = page.locator('.settings-card', { hasText: 'Mutfak nasıl çalışıyor?' });
    await expect(card.getByRole('button', { name: /Ekran/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(card).toContainText('Örnek:');
    await card.getByRole('button', { name: /Fiş/ }).click();
    await expect(card.getByRole('alert')).toContainText('Fiş modu için önce');
    await expect(card.getByRole('button', { name: /Ekran/ })).toHaveAttribute('aria-pressed', 'true');

    const added = await page.request.post('/api/staff/printers', { data: { printer: { name: 'Mutfak', enabled: true, connection: { type: 'network', host, port: OK_PORT }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false } } });
    expect(added.ok()).toBe(true);
    const printerId = (await added.json()).printer.id as string;
    await page.reload();
    await openSettings(page, 'Mutfak');
    await card.getByRole('button', { name: /Fiş/ }).click();
    await expect(card.getByRole('button', { name: /Fiş/ })).toHaveAttribute('aria-pressed', 'true');
    await card.screenshot({ path: info.outputPath('kitchen-mode-card.png') });

    // A staff order prints at once and becomes Hazırlanıyor; the waiter delivers it from the table.
    let state = await (await page.request.get('/api/staff/state')).json();
    const tea = state.products.find((p: { groups: unknown[]; soldOut: boolean }) => !p.groups.length && !p.soldOut);
    const table = state.tables[0];
    const waiter = await signedIn(browser, 'garson', { width: 390, height: 844 });
    const order = async (n: number) => expect((await waiter.request.post('/api/staff/orders', { data: { requestId: `kitchen-ticket-e2e-${n}`, tableId: table.id, lines: [{ productId: tea.id, quantity: 1, selections: [] }], expectedTotal: tea.price } })).ok()).toBe(true);
    await order(1);
    await expect.poll(printed, { timeout: 15000 }).toContain(table.name);
    await expect.poll(async () => (await (await page.request.get('/api/staff/state')).json()).orders.find((o: { accountId: string }) => o.accountId)?.status, { timeout: 10000 }).toBe('preparing');
    // No "Servise hazır" place in Fiş modu.
    await expect(bottomNav(waiter).getByRole('button', { name: /Servise hazır/ })).toHaveCount(0);
    await openView(waiter, 'Masalar');
    await waiter.locator(`[data-table="${table.id}"]`).click();
    const dialog = waiter.getByRole('dialog', { name: table.name });
    await expect(dialog.getByText('Hazırlanıyor').first()).toBeVisible();
    await dialog.getByRole('button', { name: /teslim edildi/i }).first().click();
    await expect(waiter.locator('.toast')).toContainText('teslim edildi');

    // The printer stops answering: red warning on the counter and the waiter's phone, the order stays Yeni.
    expect((await page.request.post('/api/staff/printers', { data: { id: printerId, printer: { name: 'Mutfak', enabled: true, connection: { type: 'network', host, port: CLOSED_PORT }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false } } })).ok()).toBe(true);
    await order(2);
    const cashier = await signedIn(browser, 'kasiyer');
    const warning = cashier.locator('.print-alert', { hasText: `${table.name} siparişi mutfağa basılamadı` });
    await expect(warning).toBeVisible({ timeout: 20000 });
    await expect(warning).toContainText(/Yazıcıya ağdan ulaşılamıyor|Yazıcı kapalı ya da kablosu çıkmış|Yazıcı yanıt vermedi/);
    await expect(warning.getByRole('button', { name: 'Elle iletildi' })).toBeVisible();
    // Tek mutfak: one kitchen printer, so no "Başka yazıcıya bas" (a counter printer for bills changes nothing).
    expect((await page.request.post('/api/staff/printers', { data: { printer: { name: 'Kasa', enabled: true, connection: { type: 'network', host, port: OK_PORT + 2 }, width: 80, charset: 'pc857', orders: false, categories: [], bill: true } } })).ok()).toBe(true);
    await expect(warning.getByRole('button', { name: 'Tekrar bas' })).toBeVisible();
    await expect(warning.getByRole('button', { name: /Başka yazıcıya/ })).toHaveCount(0);
    await cashier.screenshot({ path: info.outputPath('print-warning-counter.png') });
    await expect(waiter.locator('.print-alert', { hasText: 'mutfağa basılamadı' })).toBeVisible({ timeout: 10000 });
    await waiter.screenshot({ path: info.outputPath('print-warning-waiter.png') });
    state = await (await page.request.get('/api/staff/state')).json();
    expect(state.orders.filter((o: { status: string }) => o.status === 'new').length).toBe(1);

    // Fixed (cable back in): Tekrar bas prints it and the warning goes away.
    expect((await page.request.post('/api/staff/printers', { data: { id: printerId, printer: { name: 'Mutfak', enabled: true, connection: { type: 'network', host, port: OK_PORT }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false } } })).ok()).toBe(true);
    const before = received.length;
    await warning.getByRole('button', { name: 'Tekrar bas' }).click();
    await expect(warning).toHaveCount(0, { timeout: 15000 });
    expect(received.length).toBeGreaterThan(before);
    await expect(cashier.locator('.toast')).toContainText('mutfağa basıldı');
    await expect(waiter.locator('.print-alert')).toHaveCount(0, { timeout: 10000 });

    // Printer settings: a job is "Mutfak fişleri" (one printer) and/or "Hesap ve kasa fişleri"; no category routing.
    await page.goto('/');
    await openSettings(page, 'Yazıcılar');
    const list = page.locator('.printer-settings');
    await expect(list.locator('article.printer-card', { hasText: 'Mutfak' }).first()).toContainText('Mutfak fişleri');
    await expect(list.locator('article.printer-card', { hasText: 'Kasa' }).first()).toContainText('Hesap ve kasa fişleri');
    await list.getByRole('button', { name: 'Kasa yazıcısını düzenle' }).click();
    const editor = page.getByRole('dialog', { name: 'Yazıcıyı düzenle' });
    await expect(editor.locator('.printer-categories')).toHaveCount(0);
    await expect(editor.getByRole('checkbox', { name: /Mutfak fişleri/ })).not.toBeChecked();
    await expect(editor.getByRole('checkbox', { name: /Hesap ve kasa fişleri/ })).toBeChecked();
    await editor.getByRole('checkbox', { name: /Mutfak fişleri/ }).check();
    await expect(editor.locator('.printer-move-note')).toContainText('Şu an mutfak fişleri “Mutfak” yazıcısından çıkıyor');
    await editor.screenshot({ path: info.outputPath('printer-kitchen-move.png') });
    await editor.getByRole('button', { name: 'Vazgeç', exact: true }).click();
  } finally {
    await page.request.post('/api/staff/kitchen-mode', { data: { mode: 'screen' } }).catch(() => {});
    printer.close();
  }
});

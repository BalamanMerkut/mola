import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fakePrinter } from '../fake-printer';
import { ensureSetup, openNotifications } from './helpers';

/*
 * Hafta sonu bulgusu 1 (11 Ekim): "Yazıcıda kâğıt yokken fiş basılmak istendi, uygulama uyarmadı." A pretend network receipt
 * printer on this computer's LAN address (port 9106) answers the ESC/POS status questions with "kâğıt yok" (nothing is
 * ever sent to a real printer). Ekran modu: the kitchen card warns with "Tekrar bas", the owner gets a Bildirim, the
 * cashier's bill print says it with "Tekrar bas"; with paper back both print. (Fiş modu: tests/browser/kitchen-tickets.spec.ts;
 * the Windows spooler with a fake status: tests/kitchen-tickets.test.ts.)
 */
const PASSWORD = 'MolaDemo!2026', PORT = 9106;
const lanAddress = () => Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
const id = () => crypto.randomUUID().replace(/-/g, '');
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.locator('.workspace')).toBeVisible();
  return page;
}
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}

test('paper out: kitchen card, owner Bildirim and the cashier\'s bill print say "Yazıcıda kâğıt yok · Mutfak"; Tekrar bas prints once the paper is back', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const host = lanAddress();
  test.skip(!host, 'Bu bilgisayarda yerel ağ IPv4 adresi yok.');
  const printer = await fakePrinter('0.0.0.0', PORT).catch(() => null);
  test.skip(!printer, `${PORT} numaralı port kullanımda.`);
  try {
    await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
    await ensureSetup(page.request);
    await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
    await page.request.post('/api/staff/kitchen-mode', { data: { mode: 'screen' } });
    for (const p of (await (await page.request.get('/api/staff/printers')).json()).printers) await page.request.post('/api/staff/printers/delete', { data: { id: p.id } });
    expect((await page.request.post('/api/staff/printers', { data: { printer: { name: 'Mutfak', enabled: true, connection: { type: 'network', host, port: PORT }, width: 80, charset: 'pc857', orders: true, categories: [], bill: true } } })).ok()).toBe(true);
    printer!.state.status = { printer: 0x1a, offline: 0x32, paper: 0x72 };

    // A waiter's order: its kitchen ticket cannot print.
    const waiter = await (await browser.newContext()).request;
    expect((await waiter.post('/api/login', { data: { username: 'garson', password: PASSWORD } })).ok()).toBe(true);
    const sent = await (await waiter.post('/api/staff/orders', { data: { requestId: id(), tableId: 'table-6', lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).json();
    const kitchen = await signedIn(browser, 'mutfak');
    const card = kitchen.locator('.kitchen-card', { hasText: `#${sent.number}` });
    await expect(card.locator('.print-problem')).toContainText('Fiş basılamadı: Yazıcıda kâğıt yok · Mutfak.', { timeout: 20_000 });
    await expect(card.getByRole('button', { name: 'Tekrar bas' })).toBeVisible();
    expect(printer!.bytes().includes(0x1b), 'no ticket went to a printer without paper').toBe(false);
    await shot(kitchen, 'mutfak-kagit-yok.png', info.outputPath('mutfak-kagit-yok.png'));

    // The owner's bell: one Bildirim, opening Ayarlar → Yazıcılar.
    await page.goto('/');
    await openNotifications(page);
    const note = page.getByRole('region', { name: 'Bildirimler' }).locator('.notification-item', { hasText: 'Yazıcıda kâğıt yok · Mutfak' });
    await expect(note).toHaveCount(1);
    await expect(note).toContainText('Yeni rulo takın');
    await shot(page, 'bildirim-yazici-kagit.png', info.outputPath('bildirim-yazici-kagit.png'));

    // The cashier prints the bill: the same words, with "Tekrar bas".
    const cashier = await signedIn(browser, 'kasiyer');
    await cashier.locator('.table-card, [data-table="table-6"]').filter({ hasText: 'Masa 06' }).first().click();
    await cashier.getByRole('dialog', { name: 'Masa 06' }).getByRole('button', { name: 'Hesap fişi' }).click();
    const error = cashier.locator('.notice', { hasText: 'Yazıcıda kâğıt yok · Mutfak' });
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText('Yeni rulo takın');
    await shot(cashier, 'kasa-kagit-yok.png', info.outputPath('kasa-kagit-yok.png'));

    // New roll: Tekrar bas prints the bill, and the kitchen card's Tekrar bas prints the ticket; the warning goes.
    printer!.state.status = { printer: 0x12, offline: 0x12, paper: 0x12 };
    await error.getByRole('button', { name: 'Tekrar bas' }).click();
    await expect(cashier.locator('.toast')).toContainText('Hesap fişi yazdırıldı.');
    await card.getByRole('button', { name: 'Tekrar bas' }).click();
    await expect(card.locator('.print-problem')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => printer!.bytes().toString('latin1')).toContain('Masa 06');
  } finally {
    for (const p of (await (await page.request.get('/api/staff/printers')).json()).printers ?? []) await page.request.post('/api/staff/printers/delete', { data: { id: p.id } }).catch(() => {});
    await printer?.close();
  }
});

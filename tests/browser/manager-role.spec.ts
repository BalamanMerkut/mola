import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { totp } from '../../server/totp';
import { cashAction, ensureSetup, movedReports, openCash, openReport, openSettings, openStaff, openView, reportGroupOf, type ReportTab } from './helpers';

/*
 * The owner's role decisions of 5 October in the browser: the Müdür (made in Çalışanlar, sees the reports, never Ayarlar),
 * the cashier's "Temizlendi", garson masa/bölüm ataması on and off, and vardiya per role with the one-time
 * "Vardiya başlamadan N sipariş geldi" note.
 */
const PASSWORD = 'MolaDemo!2026', MANAGER_PASSWORD = 'MudurDeneme!2026';
const rid = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
async function signedIn(browser: Browser, username: string, password = PASSWORD, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password } })).ok()).toBe(true);
  await page.goto('/');
  return page;
}
async function asOwner(page: Page) {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
}
const order = async (page: Page, tableId: string) => (await (await page.request.post('/api/staff/orders', { data: { requestId: rid(), tableId, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 } })).json()) as { orderId: string };
async function step(page: Page, orderId: string, status: 'preparing' | 'ready') {
  const o = (await (await page.request.get('/api/staff/state')).json()).orders.find((x: { id: string }) => x.id === orderId);
  expect((await page.request.post('/api/staff/status', { data: { requestId: rid(), orderId, version: o.version, status } })).ok()).toBe(true);
}

test('Müdür: made in Personel → Çalışanlar with the permission list; sees Kasa ve giderler, Personel (Vardiya ve bahşiş), reports, stock, menu; never Ayarlar, the staff accounts or Destek', async ({ page, browser }, info) => {
  await asOwner(page);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openStaff(page, 'Çalışanlar');
  await page.getByRole('button', { name: 'Çalışan ekle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Çalışan ekle' });
  await dialog.getByLabel('Ad soyad').fill('Deniz Müdür');
  await dialog.getByLabel('Yeni kullanıcı adı').fill('deniz.mudur');
  await dialog.getByRole('combobox', { name: 'Görevi' }).selectOption('manager');
  const rights = dialog.getByLabel('Müdür yetkileri');
  await expect(rights).toContainText('Satış ve Raporlar');
  await expect(rights).toContainText('Ayarlar (hiçbir konu)');
  await expect(rights).toContainText('Sahip aldı');
  await shot(page, 'mudur-yetkileri.png', info.outputPath('mudur-yetkileri.png'));
  await dialog.getByLabel('Yeni şifre').fill(MANAGER_PASSWORD);
  await dialog.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await expect(page.getByText('Çalışan hesabı oluşturuldu.')).toBeVisible();
  await expect(page.locator('.employee-row').filter({ hasText: 'Deniz Müdür' })).toContainText('Müdür');

  const manager = await signedIn(browser, 'deniz.mudur', MANAGER_PASSWORD);
  try {
    const nav = manager.locator('.sidebar nav');
    // 10 Ekim düzeni: Kasa ve giderler (no Kasa ayarları) and Personel (Vardiya ve bahşiş only); Kampanyalar is in Menü yönetimi.
    for (const name of ['Masalar', 'Sipariş al', 'Kasa ve giderler', 'Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Satış ve Raporlar', 'Duyurular', 'Hesabım']) await expect(nav.getByRole('button', { name, exact: true })).toBeVisible();
    for (const name of ['Ayarlar', 'Çalışanlar', 'Kampanyalar', 'Destek', 'Entegrasyonlar']) await expect(nav.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(manager.locator('.support-nav')).toHaveCount(0);
    await nav.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
    await expect(manager.getByRole('navigation', { name: 'Rapor bölümleri' })).toBeVisible();
    await expect(manager.locator('.kpi').first()).toBeVisible();
    await shot(manager, 'mudur-raporlar.png', info.outputPath('mudur-raporlar.png'));
    // The server says no too: settings, staff, the owner's cash out.
    expect((await manager.request.post('/api/staff/settings', { data: { changeSeconds: 60, commissionBps: null } })).status()).toBe(403);
    expect((await manager.request.get('/api/staff/users')).status()).toBe(403);
    expect((await manager.request.post('/api/staff/cash/movements', { data: { requestId: rid(), type: 'owner_took', amount: 1000 } })).status()).toBe(403);
    await nav.getByRole('button', { name: 'Stok', exact: true }).click();
    await expect(manager.getByRole('heading', { name: 'Stok', level: 1 })).toBeVisible();
    // Every place of the sidebar opens (the counter's compact Masalar has no title: its button is the current one).
    for (const name of ['Masalar', 'Sipariş al', 'Kasa ve giderler', 'Ajanda ve rezervasyon', 'Menü yönetimi', 'Stok', 'Personel', 'Satış ve Raporlar', 'Duyurular', 'Hesabım']) {
      await openView(manager, name);
      await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      if (name !== 'Masalar') await expect(manager.getByRole('heading', { level: 1 })).toHaveText(name);
      await expect(manager.getByRole('alert')).toHaveCount(0);
    }
    await openCash(manager);
    await expect(manager.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }).getByRole('button')).toHaveText(['Bugün', 'Giderler', 'Kapanışlar', 'İadeler']);
    await openView(manager, 'Personel');
    await expect(manager.getByRole('navigation', { name: 'Vardiya ve bahşiş bölümleri', exact: true })).toBeVisible();
    await expect(manager.getByRole('heading', { name: 'Çalışan hesapları' })).toHaveCount(0);
  } finally { await manager.context().close(); }
});

test('cashier: "Temizlendi" when no waiter is around', async ({ page, browser }) => {
  await asOwner(page);
  expect((await page.request.post('/api/staff/settings', { data: { cleaningEnabled: true, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
  const cashier = await signedIn(browser, 'kasiyer');
  try {
    await order(cashier, 'table-7');
    const account = (await (await cashier.request.get('/api/staff/state')).json()).tables.find((t: { id: string }) => t.id === 'table-7').account;
    expect((await cashier.request.post('/api/staff/payments', { data: { requestId: rid(), accountId: account.id, version: account.version, method: 'card', amount: 3500, tendered: 3500 } })).ok()).toBe(true);
    await cashier.reload();
    await cashier.locator('.table-card').filter({ hasText: 'Masa 07' }).click();
    const panel = cashier.getByRole('dialog', { name: 'Masa 07' });
    await expect(panel.getByText('Masa temizlik bekliyor')).toBeVisible();
    await panel.getByRole('button', { name: 'Temizlendi · Masayı hazırla' }).click();
    await expect(cashier.getByText('Masa siparişe hazır.')).toBeVisible();
    await expect(cashier.locator('.table-card').filter({ hasText: 'Masa 07' })).not.toContainText('Temizlik bekliyor');
  } finally {
    await cashier.context().close();
    await page.request.post('/api/staff/settings', { data: { cleaningEnabled: false, changeSeconds: 0, commissionBps: null } });
  }
});

test('garson ataması: on, only the responsible waiter\'s phone announces "hazır"; off, every waiter again', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  await asOwner(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  // Personel → Personel ayarları → Garson ataması (once Ayarlar → Sipariş ve kasa → Sipariş ve onay).
  await openStaff(page, 'Personel ayarları', 'Garson ataması');
  const card = page.locator('.assignment-card');
  await card.getByRole('checkbox', { name: 'Garson ataması' }).check();
  await card.getByRole('button', { name: 'Garson · masa ve bölüm seç' }).click();
  await card.getByRole('button', { name: 'Masa 01', exact: true }).click();
  await card.getByRole('button', { name: 'Kaydet' }).click();
  await expect(card.locator('.assignment-summary').first()).toContainText('Masa 01');
  await shot(page, 'garson-atamasi.png', info.outputPath('garson-atamasi.png'), true);
  // Someone else's table: Masa 02 belongs to a second waiter.
  const made = await page.request.post('/api/staff/users', { data: { username: 'garson.iki', name: 'Ayşe Garson', role: 'waiter', password: 'GarsonIki!2026' } });
  const second = (await made.json()).id ?? (await (await page.request.get('/api/staff/users')).json()).find((u: { username: string }) => u.username === 'garson.iki').id;
  expect((await page.request.post('/api/staff/assignments', { data: { waiter: { id: second, areas: [], tables: ['table-2'] } } })).ok()).toBe(true);

  const waiter = await signedIn(browser, 'garson', PASSWORD, { width: 390, height: 844 }), kitchen = await signedIn(browser, 'mutfak');
  try {
    await expect.poll(async () => (await (await waiter.request.get('/api/staff/state')).json()).assignment?.mine).toEqual(['table-1']);
    await waiter.waitForTimeout(2500); // the first look notes what is already there
    const theirs = await order(page, 'table-2');
    await step(kitchen, theirs.orderId, 'preparing'); await step(kitchen, theirs.orderId, 'ready');
    await waiter.waitForTimeout(5000);
    await expect(waiter.locator('.toast')).toHaveCount(0);
    const mine = await order(page, 'table-1');
    await step(kitchen, mine.orderId, 'preparing'); await step(kitchen, mine.orderId, 'ready');
    await expect(waiter.locator('.toast')).toContainText('Masa 01');
    await expect(waiter.locator('.toast')).toContainText('hazır');
    // Off: today's behaviour, every table rings.
    expect((await page.request.post('/api/staff/assignments', { data: { enabled: false } })).ok()).toBe(true);
    await expect.poll(async () => (await (await waiter.request.get('/api/staff/state')).json()).assignment).toBeUndefined();
    await waiter.waitForTimeout(5000);
    const again = await order(page, 'table-2');
    await step(kitchen, again.orderId, 'preparing'); await step(kitchen, again.orderId, 'ready');
    await expect(waiter.locator('.toast').filter({ hasText: 'Masa 02' })).toBeVisible({ timeout: 10000 });
  } finally {
    await waiter.context().close(); await kitchen.context().close();
    await page.request.post('/api/staff/assignments', { data: { enabled: false } });
  }
});

test('vardiya per role: the cashier unticked works at once; the kitchen starts with the code and hears "Vardiya başlamadan N sipariş geldi" once', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  await asOwner(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openSettings(page, 'Vardiya ve bahşiş');
  // K-B (9 Ekim): people are signed in, so it asks when the code starts; "Bir sonraki girişte" is chosen.
  await page.getByRole('checkbox', { name: /Vardiya takibi/ }).click();
  const ask = page.getByRole('dialog', { name: 'Vardiya takibi açılsın mı?' });
  await expect(ask.or(page.getByRole('checkbox', { name: /Vardiya takibi/ }).and(page.locator(':checked')))).toBeVisible();
  if (await ask.isVisible()) await ask.getByRole('button', { name: 'Vardiya takibini aç' }).click();
  await expect(page.getByRole('checkbox', { name: /Vardiya takibi/ })).toBeChecked();
  const roles = page.getByRole('group', { name: 'Vardiya başlatacak görevler' });
  for (const name of ['Garson', 'Kasiyer', 'Mutfak', 'Müdür']) await expect(roles.getByRole('checkbox', { name })).toBeChecked();
  await roles.getByRole('checkbox', { name: 'Kasiyer' }).uncheck();
  await expect(page.getByText('Kasiyer vardiya başlatmadan çalışır; raporda saatleri tahmini görünür.')).toBeVisible();
  await shot(page, 'vardiya-gorevler.png', info.outputPath('vardiya-gorevler.png'), true);

  const cashier = await signedIn(browser, 'kasiyer'), kitchen = await signedIn(browser, 'mutfak', PASSWORD, { width: 1024, height: 768 });
  try {
    await expect(cashier.getByRole('heading', { name: 'Vardiyayı başlat' })).toHaveCount(0);
    await expect(cashier.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true })).toBeVisible();
    await expect(kitchen.getByRole('heading', { name: 'Vardiyayı başlat', level: 1 })).toBeVisible();
    // Two orders arrive while the kitchen's gate is closed.
    await order(page, 'table-9'); await order(page, 'table-10');
    // Every order still waiting for the kitchen counts (earlier tests of this file left one on Masa 07).
    const waiting = (await (await kitchen.request.get('/api/staff/state')).json()).orders.filter((o: { status: string }) => o.status === 'new' || o.status === 'awaiting_approval').length;
    expect(waiting).toBeGreaterThanOrEqual(2);
    const code = (await (await page.request.get('/api/staff/shifts/code')).json()).code as string;
    await kitchen.getByLabel('Vardiya kodu (6 hane)').fill(code);
    const note = kitchen.locator('.preshift-notice');
    await expect(note).toContainText(`Vardiya başlamadan ${waiting} sipariş geldi`);
    await shot(kitchen, 'vardiya-oncesi-siparis.png', info.outputPath('vardiya-oncesi-siparis.png'));
    await note.getByRole('button', { name: 'Tamam' }).click();
    await expect(note).toHaveCount(0);
    await kitchen.reload();
    await expect(kitchen.locator('.kitchen-card').first()).toBeVisible();
    await kitchen.waitForTimeout(2500);
    await expect(kitchen.locator('.preshift-notice')).toHaveCount(0);
  } finally {
    await cashier.context().close(); await kitchen.context().close();
    await page.request.post('/api/staff/shifts/roles', { data: { roles: ['waiter', 'cashier', 'kitchen', 'manager'] } });
    await page.request.post('/api/staff/cash/settings', { data: { shiftTracking: false } });
  }
});

test('Müdür and the report code: every Satış ve Raporlar tab opens with the owner\'s code, İade ve düzeltme too; İade also from the cash chip', async ({ page, browser }, info) => {
  test.setTimeout(150000);
  await asOwner(page);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null } });
  // A cash payment of today on Masa 04, and a Müdür of its own (this test may run alone).
  const accountId = (await (await page.request.post('/api/staff/orders', { data: { requestId: rid(), tableId: 'table-4', lines: [{ productId: 'tea', quantity: 2, selections: [] }], expectedTotal: 7000 } })).json()).accountId as string;
  const account = (await (await page.request.get('/api/staff/state')).json()).tables.find((t: { account?: { id: string } }) => t.account?.id === accountId).account;
  expect((await page.request.post('/api/staff/payments', { data: { requestId: rid(), accountId, version: account.version, method: 'cash', amount: account.balance, tendered: account.balance } })).ok()).toBe(true);
  const made = await page.request.post('/api/staff/users', { data: { username: 'rapor.mudur', name: 'Rapor Müdür', role: 'manager', password: MANAGER_PASSWORD } });
  expect(made.ok(), await made.text()).toBe(true);
  // The owner turns the report code on (the code of the step before now, so the Müdür's current one is still unused).
  const setup = await (await page.request.post('/api/staff/report-security/setup', { data: { password: PASSWORD } })).json();
  const enabled = await page.request.post('/api/staff/report-security/enable', { data: { code: totp(setup.secret, Date.now() - 30_000) } });
  expect(enabled.ok(), await enabled.text()).toBe(true);
  const recoveryCodes = (await enabled.json()).recoveryCodes as string[];
  const manager = await signedIn(browser, 'rapor.mudur', MANAGER_PASSWORD);
  try {
    await openView(manager, 'Satış ve Raporlar');
    await expect(manager.getByRole('heading', { name: 'Raporları açmak için telefon kodu' })).toBeVisible();
    await expect(manager.getByText('Sahibin doğrulama uygulamasındaki 6 haneli kodu yazın.', { exact: false })).toBeVisible();
    await expect(manager.getByText('Telefonuma ulaşamıyorum')).toHaveCount(0);
    await manager.getByLabel('Doğrulama kodu').fill(totp(setup.secret, Date.now()));
    await manager.getByRole('button', { name: 'Raporları aç' }).click();
    await expect(manager.getByRole('navigation', { name: 'Rapor bölümleri' })).toBeVisible();
    // Every report, one by one: it loads and no error is shown.
    // The record books of Kasa ve giderler and Personel sit behind the same code (10 Ekim) and load too.
    for (const tab of [...Object.keys(reportGroupOf), ...Object.keys(movedReports)] as ReportTab[]) {
      await openReport(manager, tab);
      await manager.waitForLoadState('networkidle');
      await expect(manager.locator('.report-loading, [role="status"]:has-text("yükleniyor")')).toHaveCount(0, { timeout: 15000 });
      await expect(manager.getByRole('alert'), tab).toHaveCount(0);
    }
    // İade ve düzeltme: the row, its products and a refund by the Müdür.
    await openReport(manager, 'İade ve düzeltme');
    const row = manager.locator('.ledger-row').filter({ hasText: 'Masa 04' }).first();
    await row.locator('.ledger-main').click();
    await expect(row.locator('.ledger-items')).toContainText('Demleme Çay');
    await row.getByRole('button', { name: 'Düzelt / iade' }).click();
    await row.getByRole('button', { name: 'Tutar olarak iade' }).click();
    await row.getByLabel('İade tutarı (TL) *').fill('10');
    await row.getByRole('group', { name: 'İade nedeni' }).getByRole('button', { name: 'Yanlış ürün' }).click();
    await row.getByRole('button', { name: 'İadeyi kaydet' }).click();
    await row.getByRole('button', { name: 'Evet, iadeyi kaydet' }).click();
    await expect(manager.getByRole('status').filter({ hasText: '₺10 nakit iade kaydedildi · Masa 04.' })).toBeVisible();
    await shot(manager, 'mudur-iade-ve-duzeltme.png', info.outputPath('mudur-iade-ve-duzeltme.png'));
    // The counter's "İade" from the cash chip (compact Masalar): the Müdür, then the owner.
    for (const who of [manager, page]) {
      if (who === page) { await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/'); }
      await openView(who, 'Masalar');
      await cashAction(who, 'İade');
      const win = who.getByRole('dialog', { name: 'İade' });
      await expect(win.getByRole('list', { name: 'Bugünkü ödemeler' }).getByRole('button', { name: /Masa 04/ })).toBeVisible();
      await expect(win.getByText('Tek seferde en çok')).toHaveCount(0);
      await who.keyboard.press('Escape');
    }
  } finally {
    await manager.context().close();
    // The other suites of this server never meet the code: the owner turns it off again.
    expect((await page.request.post('/api/staff/report-security/recover', { data: { password: PASSWORD, recoveryCode: recoveryCodes[0] } })).ok()).toBe(true);
  }
});

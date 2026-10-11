import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_API, adminLogin, e2eRun, enableAdminFactor, ensureSetup, openAdminRight, openSettings, openView } from './helpers';

/*
 * Hizmet paketi on the café's screens (src/FeatureLock.tsx, src/PackageCard.tsx): Mola Yönetim gives the demo business a
 * package without Stok; the owner sees Stok faded with "Pakette yok", its page blurred with the card (no real data), and
 * "Mola ekibine yaz" opens a prefilled ticket; the cashier and the kitchen simply do not see what is closed; turned on again
 * the stock entered before is back. No page overflow at 360–1280, nor in a split pane. "Paketiniz": the package's name and
 * state, the services as cards with a check, the rest faded (a touch opens the same card; "Yakında" with its chip), the
 * contact panel with the Mola team's phone, WhatsApp and e-mail; fits 360 px (docs/ekran/kafe/paketiniz*.png).
 */
const PASSWORD = 'MolaDemo!2026', TENANT = 'mola-demo';
// Every sellable service (6 Ekim: the Müdür account is in the core; "Paket servis platformları" is "Yakında" and stays closed).
const ALL = ['core', 'qr-menu', 'qr-order', 'reports-advanced', 'stock', 'reservations', 'shifts', 'social', 'remote-reports', 'remote-admin', 'email-reports', 'split-screen', 'cloud-backup'];
const CONTACT = { phone: '0850 123 45 67', whatsapp: '0532 765 43 21', email: 'destek@mola.example', hours: 'Hafta içi 09:00–18:00', web: '' };
const rid = () => crypto.randomUUID().replace(/-/g, '');
async function shot(page: Page, file: string, path: string, fullPage = false, target?: Locator) {
  const take = (to: string) => target ? target.screenshot({ path: to }) : page.screenshot({ path: to, fullPage });
  await take(path);
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await take(join(folder, file)); }
}
let admin: APIRequestContext;
test.beforeAll(async () => {
  // Package changes need two-step login and the Authenticator step-up (server/merkez/step-up.ts): on for this suite's Merkez.
  admin = await playwrightRequest.newContext();
  await adminLogin(admin);
  if (await enableAdminFactor(admin)) await adminLogin(admin);
  await openAdminRight(admin);
  // The Mola team's contact: "Paketiniz" shows it as buttons (tel:, WhatsApp, mailto:).
  expect((await admin.post(`${ADMIN_API}/contact`, { data: CONTACT })).ok()).toBe(true);
});
test.afterAll(async () => { await admin?.dispose(); });
/** Mola Yönetim → İşletme → Hizmet → Özel, then waits until the café's licence carries it (heartbeat every 2 s in tests). */
async function setServices(page: Page, features: string[]) {
  const send = () => admin.post(`${ADMIN_API}/business-services`, { data: { requestId: rid(), tenantId: TENANT, packageId: null, features, discount: null } });
  let r = await send();
  // The 10-minute window closed meanwhile: one more code.
  if (r.status() === 403 && (await r.json()).code === 'STEP_UP_REQUIRED') { await openAdminRight(admin); r = await send(); }
  expect(r.ok(), await r.text()).toBe(true);
  await expect.poll(async () => ((await (await page.request.get('/api/staff/state')).json()).pkg?.enabled ?? []).sort().join(), { timeout: 30000 }).toBe([...new Set([...features, 'core'])].sort().join());
}
async function signedIn(browser: Browser, username: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  await page.goto('/');
  return page;
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('owner: Stok faded → blurred page with the card → "Mola ekibine yaz" prefilled; cashier and kitchen see nothing; back on, data is back', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  // Stock entered while the service is on.
  const made = await page.request.post('/api/staff/stock/items', { data: { name: 'Gizli Süt Stoğu', unit: 'ml', min: 500 } });
  expect(made.ok(), await made.text()).toBe(true);
  await setServices(page, ALL.filter(f => !['stock', 'reservations', 'reports-advanced'].includes(f)));

  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  const stockNav = page.locator('.sidebar nav').getByRole('button', { name: /^Stok/ });
  await expect(stockNav).toContainText('Pakette yok');
  await expect(stockNav).toHaveClass(/nav-locked/);
  await stockNav.click();
  const lock = page.locator('.feature-lock[data-feature="stock"]');
  await expect(lock.getByRole('heading', { name: 'Bu hizmet paketinizde yok' })).toBeVisible();
  await expect(lock).toContainText('Stok, reçete ve kârlılık');
  await expect(lock).toContainText('Paketinize eklemek isterseniz Mola ekibine yazın; birkaç dakikada açılır.');
  // Sample shapes only, heavily blurred: nothing of the business's stock is on the page.
  await expect(page.locator('body')).not.toContainText('Gizli Süt Stoğu');
  expect(await lock.locator('.feature-lock-sample').evaluate(el => getComputedStyle(el).filter)).toMatch(/blur/);
  await page.waitForTimeout(400);
  expect(await fits(page)).toBe(true);
  await shot(page, 'paket-kilitli.png', info.outputPath('paket-kilitli.png'));

  // The report buttons of Gelişmiş raporlar are faded and open the same card over the screen.
  await openView(page, 'Satış ve Raporlar');
  await page.getByRole('button', { name: /Yazdır \/ PDF/ }).click();
  const modal = page.getByRole('dialog', { name: 'Bu hizmet paketinizde yok' });
  await expect(modal).toContainText('Gelişmiş raporlar');
  await modal.getByRole('button', { name: 'Kapat', exact: true }).last().click();
  await expect(modal).toBeHidden();

  // "Mola ekibine yaz" → Destek → new ticket, prefilled.
  await openView(page, 'Stok');
  await lock.getByRole('button', { name: 'Mola ekibine yaz' }).click();
  const form = page.getByRole('form', { name: 'Yeni destek talebi' });
  await expect(form.getByLabel('Konu *')).toHaveValue('Hizmet eklemek istiyorum: Stok, reçete ve kârlılık');
  await expect(form.getByLabel('Sorunu anlatın *')).toHaveValue(/Stok, reçete ve kârlılık.*\n.*Şu anki paketimiz/s);

  // Paketiniz in Ayarlar → İşletme → Paketiniz: the name and state, the services in it as cards with a check, the rest faded.
  await openSettings(page, 'Paketiniz');
  const card = page.locator('.package-card');
  await expect(card).toContainText('Paketiniz');
  await expect(card.getByTestId('package-name')).toHaveText('Size özel paket');
  await expect(card.getByTestId('package-status')).toHaveText('Aktif');
  const included = card.getByRole('list', { name: 'Paketteki hizmetler' });
  // Core (with the Müdür account) + the 9 sellable services left on.
  await expect(card.locator('.pk-summary')).toContainText('10 hizmet açık');
  await expect(included.locator('.pk-service.on')).toHaveCount(10);
  await expect(included.locator('[data-feature="core"]')).toContainText('müdür hesabı');
  await expect(included.locator('[data-feature="qr-menu"]')).toContainText('QR menü');
  await expect(included.locator('[data-feature="qr-menu"] .pk-service-check')).toBeVisible();
  await expect(included.locator('[data-feature="qr-menu"] .pk-service-icon svg')).toBeVisible();
  const missing = card.getByRole('list', { name: 'Pakette olmayan hizmetler' });
  await expect(missing.locator('.pk-service.off')).toHaveCount(3);
  await expect(missing.locator('[data-feature="stock"]')).toContainText('Pakete ekle');
  // "Paket servis platformları": "Yakında", not "Pakete ekle".
  const soon = missing.locator('[data-feature="integrations"]');
  await expect(soon).toContainText('Yakında'); await expect(soon).not.toContainText('Pakete ekle');
  // A faded service opens the same "paketinizde yok" card over the screen.
  await missing.locator('[data-feature="stock"]').click();
  const lockCard = page.getByRole('dialog', { name: 'Bu hizmet paketinizde yok' });
  await expect(lockCard).toContainText('Stok, reçete ve kârlılık');
  await expect(lockCard.getByRole('link', { name: '0850 123 45 67' })).toHaveAttribute('href', 'tel:08501234567');
  await lockCard.getByRole('button', { name: 'Kapat', exact: true }).last().click();
  await expect(lockCard).toBeHidden();
  await soon.click();
  const soonCard = page.getByRole('dialog', { name: 'Yakında, paketinize eklenebilecek' });
  await expect(soonCard).toContainText('Paket servis platformları');
  await soonCard.getByRole('button', { name: 'Kapat', exact: true }).last().click();
  // The contact panel: "Mola ekibine yaz" and the team's phone, WhatsApp and e-mail as buttons.
  const contact = card.getByRole('region', { name: 'Mola ekibine ulaşın' });
  await expect(contact).toContainText('değişiklik birkaç dakikada açılır, verileriniz silinmez');
  await expect(contact.getByRole('link', { name: '0850 123 45 67' })).toHaveAttribute('href', 'tel:08501234567');
  await expect(contact.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/905327654321');
  await expect(contact.getByRole('link', { name: 'destek@mola.example' })).toHaveAttribute('href', 'mailto:destek@mola.example');
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0); await page.waitForTimeout(300);
  await shot(page, 'paketiniz.png', info.outputPath('paketiniz.png'), false, card);
  // Phone width: one column, nothing sideways, every card inside the screen.
  await page.setViewportSize({ width: 360, height: 780 });
  await openSettings(page, 'Paketiniz');
  await expect(card.getByTestId('package-name')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await fits(page), 'Paketiniz 360px').toBe(true);
  for (const box of await card.locator('.pk-service, .pk-contact, .pk-hero').evaluateAll(els => els.map(e => e.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(361);
  // The whole card in one picture: the fixed bottom menu would be stitched over it, so it steps aside for the shot.
  const nav = await page.addStyleTag({ content: 'nav[aria-label="Alt menü"]{visibility:hidden!important}' });
  await shot(page, 'paketiniz-telefon.png', info.outputPath('paketiniz-telefon.png'), false, card);
  await nav.evaluate(n => (n as HTMLStyleElement).remove());
  await contact.getByRole('button', { name: 'Mola ekibine yaz' }).click();
  await expect(page.getByRole('form', { name: 'Yeni destek talebi' }).getByLabel('Konu *')).toHaveValue('Paketime hizmet eklemek / değiştirmek istiyorum');
  await page.setViewportSize({ width: 1280, height: 900 });
  // "Paket servis platformları" (Yakında) is closed with a package: Entegrasyonlar blurred with the card, its routes refused.
  const platforms = await page.request.get('/api/staff/integrations');
  expect(platforms.status()).toBe(403); expect((await platforms.json()).code).toBe('FEATURE_NOT_IN_PACKAGE');
  await openSettings(page, 'Entegrasyonlar');
  await expect(page.locator('.feature-lock[data-feature="integrations"]').getByRole('heading', { name: 'Yakında, paketinize eklenebilecek' })).toBeVisible();

  // Phones and tablets: the lock page fits, at every width.
  for (const width of [360, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    await openView(page, 'Stok');
    await expect(lock.getByRole('heading', { name: 'Bu hizmet paketinizde yok' })).toBeVisible();
    expect(await fits(page), `${width}px`).toBe(true);
    const box = await lock.locator('.feature-lock-card').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }

  // Cashier: no Ajanda ve rezervasyon (reservations closed), nothing faded. Kitchen: no Stok button.
  const cashier = await signedIn(browser, 'kasiyer');
  await expect(cashier.locator('.sidebar nav')).toBeVisible();
  await expect(cashier.locator('.sidebar nav')).not.toContainText('Ajanda');
  await expect(cashier.locator('.feature-locked-hint')).toHaveCount(0);
  const kitchen = await signedIn(browser, 'mutfak');
  await expect(kitchen.locator('.kitchen-bar-btn', { hasText: 'Hesabım' })).toBeVisible();
  await expect(kitchen.locator('.kitchen-bar-btn', { hasText: 'Stok' })).toHaveCount(0);
  await cashier.context().close(); await kitchen.context().close();

  // On again: the stock entered before is there.
  await setServices(page, ALL);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openView(page, 'Stok');
  await expect(page.locator('.feature-lock')).toHaveCount(0);
  await expect(page.getByText('Gizli Süt Stoğu').first()).toBeVisible({ timeout: 15000 });
});

test('the café computer\'s window: "İkiye böl" faded without İki ekran; the lock page fits a pane-wide screen', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await setServices(page, ALL.filter(f => !['split-screen', 'stock'].includes(f)));
  const key = readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
  await page.setViewportSize({ width: 1280, height: 900 });
  // The first-look dialogs of the café window (welcome, recovery code) are not this test's subject.
  await page.addInitScript(() => { sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); });
  await page.goto(`/#masaustu=${key}`);
  const rail = page.getByRole('navigation', { name: 'Mola bilgisayar araçları' });
  const split = rail.getByRole('button', { name: /İkiye böl/ });
  await expect(split).toContainText('Pakette yok', { timeout: 15000 });
  await split.click();
  const modal = page.getByRole('dialog', { name: 'Bu hizmet paketinizde yok' });
  await expect(modal).toContainText('İki ekran');
  await modal.getByRole('button', { name: 'Kapat', exact: true }).last().click();
  await expect(page.locator('iframe[name="mola-pane-1"]')).toHaveCount(0);
  // The server refuses a pane's key too.
  expect((await page.request.get('/api/desktop/pane')).status()).toBe(403);
  // One pane of a split window is about 640–960 px wide: the lock page fits there.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await openView(page, 'Stok');
  await expect(page.locator('.feature-lock').getByRole('heading', { name: 'Bu hizmet paketinizde yok' })).toBeVisible();
  expect(await fits(page)).toBe(true);
  await setServices(page, ALL);
});

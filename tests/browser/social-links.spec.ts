import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { ADMIN_API, adminLogin, detailTab, enableAdminFactor, ensureSetup, MERKEZ, openAdminRight, openBusiness, openSettings, openYonetim } from './helpers';

/*
 * Sosyal medya: the owner types an Instagram handle, a WhatsApp number and the Google review link (its own row since 6 Ekim)
 * in Ayarlar → İşletme → Sosyal medya; the guest menu's foot shows the three icons (Google too); the "sent" window shows only
 * the follow icons; after the bill a calm "Hesabınız kapandı" card and "Bizi değerlendirin ve takip edin" (title, the Google
 * button, the follow icons). The permanent QR holds Mola Merkez's short address: it forwards to the link, shows "Bu işletmenin
 * bu hizmeti şu anda kullanılamıyor." while Mola Yönetim has suspended the business and forwards again once it is resumed.
 * The card downloads as PNG and as a real PDF (A4 / A6) and prints. Screens: docs/ekran/kafe/sosyal-medya-*.png,
 * docs/ekran/misafir/*.png (when KAFE_EKRAN is set, the guest ones next to it in ../misafir).
 */
const PASSWORD = 'MolaDemo!2026';
async function shot(page: Page, folder: 'kafe' | 'misafir', file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const kafe = process.env.KAFE_EKRAN;
  if (kafe) { const dir = folder === 'kafe' ? kafe : join(dirname(kafe), 'misafir'); mkdirSync(dir, { recursive: true }); await page.screenshot({ path: join(dir, file), fullPage }); }
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const staffState = async (request: APIRequestContext) => (await request.get('/api/staff/state')).json();
const SHORT = new RegExp(`^${MERKEZ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/[A-Za-z0-9]{10}/instagram$`);

test('Sosyal medya: Instagram, WhatsApp and the Google row; guest footer, sent window and after the bill; the QR goes through Mola Merkez, stops while suspended; PNG, PDF and print', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/heartbeat', { data: {} });
  expect((await page.request.post('/api/staff/settings', { data: { commissionBps: null, changeSeconds: 0, waiterApproval: false } })).ok()).toBe(true);
  let state = await staffState(page.request);
  // An older save from Görünüm (googleReviewUrl): it shows up as the Google row without any step.
  expect((await page.request.post('/api/staff/business-profile', { data: { requestId: 'social-review-link', version: state.businessRevision ?? 0, name: state.name, logo: state.logo ?? null, googleReviewUrl: 'https://g.page/r/mola-sosyal/review' } })).ok()).toBe(true);

  // Ayarlar → İşletme → Sosyal medya: a handle and a number become links, a wrong site is refused with a reason.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openSettings(page, 'Sosyal medya');
  const card = page.locator('section.social-settings');
  await expect(card.getByLabel('Google değerlendirme', { exact: true })).toHaveValue('https://g.page/r/mola-sosyal/review');
  await expect(card.locator('.social-row').last()).toHaveAttribute('data-platform', 'review');
  await card.getByLabel('Instagram', { exact: true }).fill('@molacoffee');
  await expect(card.locator('.social-row[data-platform="instagram"] .social-chip')).toHaveText('@molacoffee');
  await expect(card.getByRole('link', { name: 'Instagram bağlantısını aç' })).toHaveAttribute('href', 'https://instagram.com/molacoffee');
  await expect(card.getByRole('link', { name: 'Instagram bağlantısını aç' })).toHaveAttribute('rel', 'noopener noreferrer');
  // Not saved yet: no QR for it (the short address forwards to what was saved).
  await expect(card.getByRole('button', { name: 'Instagram için QR oluştur' })).toHaveCount(0);
  const x = card.getByLabel('X (Twitter)', { exact: true });
  await x.fill('https://evil.example/molacoffee'); await x.blur();
  await expect(card.locator('.social-row[data-platform="x"] .field-error')).toContainText('x.com adresine ait değil');
  await expect(card.getByRole('button', { name: 'Bağlantıları kaydet' })).toBeDisabled();
  await expect(card.locator('.profile-save-bar')).toContainText('X (Twitter) düzeltilmeli.');
  await x.fill('');
  const review = card.getByLabel('Google değerlendirme', { exact: true });
  await review.fill('https://evil.example/review'); await review.blur();
  await expect(card.locator('.social-row[data-platform="review"] .field-error')).toContainText('Google değerlendirme');
  await review.fill('https://g.page/r/mola-sosyal/review');
  await card.getByLabel('WhatsApp', { exact: true }).fill('0532 123 45 67');
  await expect(card.locator('.social-row[data-platform="whatsapp"] .social-chip')).toHaveText('+90 532 123 45 67');
  await card.getByRole('button', { name: 'Bağlantıları kaydet' }).click();
  await expect(card.getByText('Sosyal medya bağlantıları kaydedildi.', { exact: false })).toBeVisible();
  await expect(card.getByLabel('Instagram', { exact: true })).toHaveValue('https://instagram.com/molacoffee');
  state = await staffState(page.request);
  expect(state.socialLinks).toEqual({ instagram: 'https://instagram.com/molacoffee', whatsapp: 'https://wa.me/905321234567', review: 'https://g.page/r/mola-sosyal/review' });
  await expect(card).toContainText('QR, Mola üzerinden yönlenir; lisans askıdayken çalışmaz.');
  await page.setViewportSize({ width: 1280, height: 2300 });
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.getByText('Ayarlar kaydedildi.')).toHaveCount(0, { timeout: 10000 });
  await shot(page, 'kafe', 'sosyal-medya-ayar.png', info.outputPath('sosyal-medya-ayar.png'));
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await fits(page), 'Sosyal medya 360px').toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });

  // One platform's permanent QR: Mola Merkez's short address; PNG, a real PDF (A4) and print.
  await card.getByRole('button', { name: 'Instagram için QR oluştur' }).click();
  const dialog = page.getByRole('dialog', { name: 'Instagram QR kodu' });
  await expect(dialog.locator('img.social-card-preview')).toBeVisible({ timeout: 20000 });
  const encoded = await dialog.getByRole('link', { name: 'Yalnız QR kodu' }).getAttribute('data-encoded');
  expect(encoded).toMatch(SHORT);
  await expect(dialog).toContainText('QR, Mola üzerinden yönlenir; lisans askıdayken çalışmaz.');
  await expect(dialog).toContainText('https://instagram.com/molacoffee');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'PNG indir' }).click()]);
  expect(download.suggestedFilename()).toBe('instagram-qr.png');
  const png = await sharp(await download.path()).metadata();
  expect([png.format, png.width, png.height]).toEqual(['png', 1080, 1440]);
  const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'PDF indir' }).click()]);
  expect(pdf.suggestedFilename()).toBe('instagram-qr-a4.pdf');
  const pdfText = readFileSync(await pdf.path()).toString('latin1');
  expect(pdfText.startsWith('%PDF-1.4')).toBe(true); expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pdfText).toContain('/MediaBox [0 0 595.28 841.89]');
  expect(pdfText).toMatch(/\/Width 2160 \/Height 2880 \/ColorSpace \/DeviceRGB/);
  await page.waitForTimeout(200);
  await shot(page, 'kafe', 'sosyal-medya-qr.png', info.outputPath('sosyal-medya-qr.png'));
  await dialog.getByRole('button', { name: 'Yazdır', exact: true }).click();
  const sheet = page.getByTestId('social-print-sheet');
  await expect(sheet.locator('h1')).toHaveText('Bizi Instagram’da takip edin');
  await expect(sheet.locator('.social-print-handle')).toHaveText('@molacoffee');
  await expect(sheet.locator('img.social-print-qr')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(sheet.locator('.social-print-card')).toBeVisible();
  await page.screenshot({ path: info.outputPath('sosyal-medya-yazdir.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect(sheet).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Kapat' }).click();
  // The Google row's own card.
  await card.getByRole('button', { name: 'Google değerlendirme için QR oluştur' }).click();
  const googleCard = page.getByRole('dialog', { name: 'Google değerlendirme QR kodu' });
  await expect(googleCard.getByRole('link', { name: 'Yalnız QR kodu' })).toHaveAttribute('data-encoded', /\/s\/[A-Za-z0-9]{10}\/review$/, { timeout: 20000 });
  await googleCard.getByRole('button', { name: 'Kapat' }).click();
  // The combined card for the counter, as an A6 PDF.
  await card.getByRole('button', { name: 'Kartı hazırla' }).click();
  const combined = page.getByRole('dialog', { name: '“Bizi takip edin” kartı' });
  await expect(combined.locator('img.social-card-preview')).toBeVisible({ timeout: 20000 });
  const [all] = await Promise.all([page.waitForEvent('download'), combined.getByRole('link', { name: 'PNG indir' }).click()]);
  expect(all.suggestedFilename()).toBe('bizi-takip-edin.png');
  expect((await sharp(await all.path()).metadata()).width).toBe(1240);
  await combined.getByLabel('PDF kâğıt boyutu').selectOption('a6');
  const [a6] = await Promise.all([page.waitForEvent('download'), combined.getByRole('button', { name: 'PDF indir' }).click()]);
  expect(a6.suggestedFilename()).toBe('bizi-takip-edin-a6.pdf');
  const a6Text = readFileSync(await a6.path()).toString('latin1');
  expect(a6Text.startsWith('%PDF-')).toBe(true); expect(a6Text).toContain('/MediaBox [0 0 297.64 419.53]');
  await combined.screenshot({ path: info.outputPath('bizi-takip-edin-karti.png') });
  await combined.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect(sheet.locator('.social-print-cell')).toHaveCount(3);
  await expect(sheet.locator('h1')).toHaveText('Bizi takip edin ve değerlendirin');
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await combined.getByRole('button', { name: 'Kapat' }).click();

  // The short address forwards while the licence is active…
  let hop = await page.request.get(encoded!, { maxRedirects: 0 });
  expect(hop.status()).toBe(302); expect(hop.headers().location).toBe('https://instagram.com/molacoffee');
  // …and Mola Yönetim shows the links read-only (Bilgiler); "Askıya al" stops it at once, "Hizmeti aç" brings it back.
  const vendor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 360, height: 780 } });
  try {
    const yonetim = await vendor.newPage();
    await openYonetim(yonetim);
    const detail = await openBusiness(yonetim, state.name);
    await detailTab(detail, 'Bilgiler').click();
    const social = detail.getByRole('region', { name: 'Sosyal medya' });
    await expect(social.getByRole('link', { name: '@molacoffee' })).toHaveAttribute('href', 'https://instagram.com/molacoffee', { timeout: 20000 });
    await expect(social).toContainText('Google değerlendirme');
    await detailTab(detail, 'Lisans').click();
    await detail.getByRole('button', { name: 'Askıya al', exact: true }).click(); await detail.getByLabel(/Askıya alma nedeni/).fill('QR denemesi'); await detail.locator('.suspend-form').getByRole('button', { name: 'Askıya al' }).click();
    await expect(detail.getByRole('button', { name: 'Hizmeti aç', exact: true })).toBeVisible();
    const scan = await guestContext.newPage();
    await scan.goto(encoded!);
    await expect(scan.getByRole('heading', { name: 'Bu işletmenin bu hizmeti şu anda kullanılamıyor.' })).toBeVisible();
    await expect(scan.getByText('This service of the business is currently unavailable.')).toBeVisible();
    expect(await scan.content()).not.toContain('instagram.com');
    expect(await fits(scan), 'unavailable page 360px').toBe(true);
    await shot(scan, 'misafir', 'qr-askida.png', info.outputPath('qr-askida.png'));
    await detail.getByRole('button', { name: 'Hizmeti aç', exact: true }).click();
    await expect(detail.getByRole('button', { name: 'Askıya al', exact: true })).toBeVisible();
    await expect.poll(async () => (await page.request.get(encoded!, { maxRedirects: 0 })).status(), { timeout: 10000 }).toBe(302);
    // The licence also reaches the café again before the guest menu below is opened.
    await expect.poll(async () => (await (await page.request.get('/api/staff/support')).json()).license?.suspended, { timeout: 20000 }).toBe(false);
    await scan.close();

    // The guest: quiet icons at the foot of the menu (Google too), opening in a new tab.
    const guest = await guestContext.newPage();
    await guest.goto(`/m/${state.tables[2].token}`);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled({ timeout: 20000 });
    const follow = guest.locator('.customer-footer').getByRole('navigation', { name: 'Bizi takip edin' });
    await expect(follow.getByRole('link')).toHaveCount(3);
    const insta = follow.getByRole('link', { name: 'Instagram’da takip edin' });
    await expect(insta).toHaveAttribute('href', 'https://instagram.com/molacoffee');
    await expect(insta).toHaveAttribute('target', '_blank');
    await expect(insta).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(follow.getByRole('link', { name: 'WhatsApp’tan yazın' })).toHaveAttribute('href', 'https://wa.me/905321234567');
    await expect(follow.getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('href', 'https://g.page/r/mola-sosyal/review');
    expect(await fits(guest), 'guest menu 360px').toBe(true);
    await follow.scrollIntoViewIfNeeded();
    await guest.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await guest.waitForTimeout(200);
    await shot(guest, 'misafir', 'menu-sosyal.png', info.outputPath('menu-sosyal.png'));
    // English menu: "Follow us".
    await guest.getByRole('button', { name: 'EN', exact: true }).click();
    const followEn = guest.locator('.customer-footer').getByRole('navigation', { name: 'Follow us' });
    await expect(followEn).toContainText('Follow us');
    await expect(followEn.getByRole('link', { name: 'Follow us on Instagram' })).toHaveAttribute('href', 'https://instagram.com/molacoffee');
    await expect(followEn.getByRole('link', { name: 'Review us on Google' })).toBeVisible();
    await guest.getByRole('button', { name: 'TR', exact: true }).click();

    // After ordering: the "sent" window offers the follow icons only (the review comes after eating).
    await guest.getByRole('button', { name: /Demleme Çay/ }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    const sent = guest.getByRole('dialog', { name: 'Siparişiniz alındı' });
    await expect(sent.getByRole('navigation', { name: 'Bizi takip edin' }).getByRole('link')).toHaveCount(2);
    await expect(sent.getByRole('link', { name: /Google/ })).toHaveCount(0);
    await guest.screenshot({ path: info.outputPath('siparis-alindi-takip.png') });
    await sent.getByRole('button', { name: 'Tamam', exact: true }).click();
    // Paid at the counter: the calm closed card, then "Bizi değerlendirin ve takip edin": title, the Google button, the icons.
    const account = (await staffState(page.request)).tables[2].account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: 'social-after-payment', accountId: account.id, version: account.version, amount: account.balance, tendered: account.balance, method: 'cash' } })).ok()).toBe(true);
    const closed = guest.getByRole('status', { name: 'Hesabınız kapandı' });
    await expect(closed.getByRole('heading', { name: 'Hesabınız kapandı' })).toBeVisible({ timeout: 10000 });
    await expect(closed).toContainText('Teşekkür ederiz, yine bekleriz.');
    await expect(closed.getByRole('button', { name: 'Yeni hesapla sipariş ver' })).toBeVisible();
    const prompt = guest.locator('.review-prompt');
    await expect(prompt.getByRole('heading', { name: 'Bizi değerlendirin ve takip edin' })).toBeVisible({ timeout: 10000 });
    await expect(prompt.locator('p')).toHaveCount(0);
    await expect(prompt.getByRole('button', { name: 'Şimdi değil' })).toHaveCount(0);
    await expect(prompt.getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('href', 'https://g.page/r/mola-sosyal/review');
    await expect(prompt.getByRole('link', { name: /Google/ })).toHaveCount(1);
    await expect(prompt.getByRole('link', { name: 'Instagram’da takip edin' })).toHaveAttribute('href', 'https://instagram.com/molacoffee');
    await expect(prompt.getByRole('link', { name: 'WhatsApp’tan yazın' })).toBeVisible();
    expect(await fits(guest), 'after payment 360px').toBe(true);
    await guest.evaluate(() => scrollTo(0, 0));
    await closed.scrollIntoViewIfNeeded();
    await shot(guest, 'misafir', 'siparis-sonrasi-takip.png', info.outputPath('siparis-sonrasi-takip.png'));
  } finally { await guestContext.close(); await vendor.close(); }
});

test('Sosyal medya: only the social links (no Google review) → "Bizi takip edin" after the bill; none at all → nothing shown', async ({ page, browser }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/heartbeat', { data: {} });
  let state = await staffState(page.request);
  expect((await page.request.post('/api/staff/social-links', { data: { requestId: 'social-only-x', version: state.businessRevision, links: { x: '@molacoffee', review: '' } } })).ok()).toBe(true);
  state = await staffState(page.request);
  expect(state.socialLinks).toEqual({ x: 'https://x.com/molacoffee' });
  const guestContext = await browser.newContext({ viewport: { width: 360, height: 780 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/m/${state.tables[3].token}`);
    await expect(guest.locator('.customer-footer').getByRole('link', { name: 'X’te takip edin' })).toHaveAttribute('href', 'https://x.com/molacoffee');
    await guest.getByRole('button', { name: /Demleme Çay/ }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await guest.getByRole('dialog', { name: 'Siparişiniz alındı' }).getByRole('button', { name: 'Tamam', exact: true }).click();
    const account = (await staffState(page.request)).tables[3].account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: 'social-only-pay', accountId: account.id, version: account.version, amount: account.balance, tendered: account.balance, method: 'cash' } })).ok()).toBe(true);
    const prompt = guest.locator('.review-prompt');
    await expect(prompt.getByRole('heading', { name: 'Bizi takip edin' })).toBeVisible({ timeout: 10000 });
    await expect(prompt.getByRole('link', { name: /Google/ })).toHaveCount(0);
    await expect(prompt.getByRole('link', { name: 'X’te takip edin' })).toBeVisible();
    await guest.evaluate(() => scrollTo(0, 0));
    await shot(guest, 'misafir', 'hesap-kapandi.png', info.outputPath('hesap-kapandi.png'));
    // English: the same calm card.
    await guest.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Your bill is closed' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Start a new order' })).toBeVisible();
    await guest.getByRole('button', { name: 'TR', exact: true }).click();
    // The owner clears every link: the menu shows no row at all.
    state = await staffState(page.request);
    expect((await page.request.post('/api/staff/social-links', { data: { requestId: 'social-clear-all', version: state.businessRevision, links: {} } })).ok()).toBe(true);
    await guest.goto(`/m/${state.tables[4].token}`);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled();
    await expect(guest.locator('.social-follow')).toHaveCount(0);
  } finally { await guestContext.close(); }
});

/*
 * 6 Ekim: "Sosyal medya ve QR kartları" is a paid service. Without it (a package from Mola Yönetim): the Google review row
 * stays editable and saves, the other platforms are faded with "Pakette yok" (the lock card on a touch, the saved handle named),
 * the QR cards locked; "Paketiniz" lists it with "Pakete ekle"; the guest menu has no "Bizi takip edin" row, the "sent" window
 * no icons, and after the bill only "Bizi değerlendirin" with the Google button. Added back, everything is there again.
 */
const ALL = ['core', 'qr-menu', 'qr-order', 'reports-advanced', 'stock', 'reservations', 'shifts', 'social', 'remote-reports', 'remote-admin', 'email-reports', 'split-screen', 'cloud-backup'];
test('Sosyal medya not in the package: Google row usable, the rest locked; guests keep only the Google button; back on, all of it returns', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const admin = await playwrightRequest.newContext();
  const guestContext = await browser.newContext({ viewport: { width: 360, height: 780 } });
  await adminLogin(admin);
  if (await enableAdminFactor(admin)) await adminLogin(admin);
  await openAdminRight(admin);
  const setServices = async (features: string[]) => {
    const send = () => admin.post(`${ADMIN_API}/business-services`, { data: { requestId: crypto.randomUUID().replace(/-/g, ''), tenantId: 'mola-demo', packageId: null, features, discount: null } });
    let r = await send();
    if (r.status() === 403 && (await r.json()).code === 'STEP_UP_REQUIRED') { await openAdminRight(admin); r = await send(); }
    expect(r.ok(), await r.text()).toBe(true);
    await expect.poll(async () => ((await staffState(page.request)).pkg?.enabled ?? []).includes('social'), { timeout: 30000 }).toBe(features.includes('social'));
  };
  try {
    await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
    await ensureSetup(page.request);
    await page.request.post('/api/staff/heartbeat', { data: {} });
    let state = await staffState(page.request);
    expect((await page.request.post('/api/staff/social-links', { data: { requestId: 'social-locked-links', version: state.businessRevision, links: { instagram: '@molacoffee', whatsapp: '0532 123 45 67', review: 'https://g.page/r/mola-kilit/review' } } })).ok()).toBe(true);
    await setServices(ALL.filter(f => f !== 'social'));

    // Ayarlar → İşletme → Sosyal medya: the lock line, the Google row editable, the others faded.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await openSettings(page, 'Sosyal medya');
    const card = page.locator('section.social-settings');
    await expect(card.locator('.feature-locked-row[data-feature="social"]').first()).toContainText('Google değerlendirme bağlantınız açık kalır');
    const insta = card.locator('.social-row-locked[data-platform="instagram"]');
    await expect(insta).toContainText('Pakette yok'); await expect(insta).toContainText('Kayıtlı: @molacoffee');
    await expect(card.getByLabel('Instagram', { exact: true })).toHaveCount(0);
    await expect(card.locator('.social-row-locked')).toHaveCount(8);
    await insta.click();
    const lock = page.getByRole('dialog', { name: 'Bu hizmet paketinizde yok' });
    await expect(lock).toContainText('Sosyal medya ve QR kartları');
    await lock.getByRole('button', { name: 'Kapat', exact: true }).last().click();
    await expect(lock).toBeHidden();
    // The Google row's QR card is part of the paid service too.
    await card.getByRole('button', { name: 'Google değerlendirme için QR oluştur (pakette yok)' }).click();
    await expect(lock).toContainText('Sosyal medya ve QR kartları');
    await lock.getByRole('button', { name: 'Kapat', exact: true }).last().click();
    await expect(card.getByRole('button', { name: /^Kalıcı QR kartları/ })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Kartı hazırla' })).toHaveCount(0);
    const review = card.getByLabel('Google değerlendirme', { exact: true });
    await expect(review).toBeEnabled();
    await review.fill('https://g.page/r/mola-kilit-yeni/review');
    await card.getByRole('button', { name: 'Bağlantıları kaydet' }).click();
    await expect(card.getByText('Google değerlendirme bağlantısı kaydedildi.', { exact: false })).toBeVisible();
    state = await staffState(page.request);
    expect(state.socialLinks).toEqual({ instagram: 'https://instagram.com/molacoffee', whatsapp: 'https://wa.me/905321234567', review: 'https://g.page/r/mola-kilit-yeni/review' });
    // The server says the same as the screen.
    expect((await page.request.post('/api/staff/social-qr', { data: {} })).status()).toBe(403);
    const refused = await page.request.post('/api/staff/social-links', { data: { requestId: 'social-locked-insta', version: state.businessRevision, links: { instagram: '@baska' } } });
    expect(refused.status()).toBe(403); expect((await refused.json()).code).toBe('FEATURE_NOT_IN_PACKAGE');
    await page.setViewportSize({ width: 1280, height: 1750 });
    await page.evaluate(() => scrollTo(0, 0)); await page.mouse.move(0, 0);
    await expect(page.getByText('Ayarlar kaydedildi.')).toHaveCount(0, { timeout: 10000 });
    await page.waitForTimeout(300);
    await shot(page, 'kafe', 'sosyal-medya-kilitli.png', info.outputPath('sosyal-medya-kilitli.png'));
    await page.setViewportSize({ width: 360, height: 780 });
    expect(await fits(page), 'locked Sosyal medya 360px').toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Paketiniz: listed among the services not in the package, "Pakete ekle" opens the same card.
    await openSettings(page, 'Paketiniz');
    const missing = page.locator('.package-card').getByRole('list', { name: 'Pakette olmayan hizmetler' });
    await expect(missing.locator('[data-feature="social"]')).toContainText('Pakete ekle');
    await missing.locator('[data-feature="social"]').click();
    await expect(lock).toContainText('Sosyal medya ve QR kartları');
    await lock.getByRole('button', { name: 'Kapat', exact: true }).last().click();

    // The guest: no follow row at the foot, no icons in the "sent" window, only the Google button after the bill.
    const guest = await guestContext.newPage();
    await guest.goto(`/m/${state.tables[5].token}`);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled({ timeout: 20000 });
    await expect(guest.locator('.customer-footer .social-follow')).toHaveCount(0);
    await guest.getByRole('button', { name: /Demleme Çay/ }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    const sent = guest.getByRole('dialog', { name: 'Siparişiniz alındı' });
    await expect(sent).toBeVisible();
    await expect(sent.locator('.social-follow')).toHaveCount(0);
    await sent.getByRole('button', { name: 'Tamam', exact: true }).click();
    const account = (await staffState(page.request)).tables[5].account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: 'social-locked-pay', accountId: account.id, version: account.version, amount: account.balance, tendered: account.balance, method: 'cash' } })).ok()).toBe(true);
    const prompt = guest.locator('.review-prompt');
    await expect(prompt.getByRole('heading', { name: 'Bizi değerlendirin', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(prompt.getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('href', 'https://g.page/r/mola-kilit-yeni/review');
    await expect(prompt.locator('.social-follow')).toHaveCount(0);
    await expect(guest.locator('a[href*="instagram.com"]')).toHaveCount(0);

    // Added back: the rows are editable again and the guest menu shows the icons.
    await setServices(ALL);
    await page.goto('/');
    await openSettings(page, 'Sosyal medya');
    await expect(card.getByLabel('Instagram', { exact: true })).toHaveValue('https://instagram.com/molacoffee');
    await expect(card.locator('.social-row-locked')).toHaveCount(0);
    await guest.goto(`/m/${state.tables[6].token}`);
    await expect(guest.locator('.customer-footer').getByRole('link', { name: 'Instagram’da takip edin' })).toHaveAttribute('href', 'https://instagram.com/molacoffee', { timeout: 20000 });
  } finally { await guestContext.close(); await admin.dispose(); }
});

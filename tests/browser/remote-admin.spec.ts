import { test, expect, devices, type Request as PwRequest } from '@playwright/test';
import sharp from 'sharp';
import { ensureSetup, MERKEZ, openSettings, openView, OWNER_EMAIL, ownerEmailOn, phoneCodeOn, raporlarimLogin, remoteLoginOpen, reportAction } from './helpers';

/*
 * İşletmemi yönet with Uzaktan yönetim on (0.1.23: one address, /yonet; server/remote-admin.ts, src/ReportsPhone.tsx,
 * src/RemoteAdmin.tsx, src/remoteTransport.ts): a device signs in (the e-mail and the password, then the phone code) and goes
 * straight into the café's own screens, without being asked again (the sign-in's one-time grant). Satış ve Raporlar, a price
 * changed, Ayarlar, the Excel file. The café computer off: the last report with "Kasa bilgisayarı kapalı"; back on: "Kasa
 * açıldı · İşletmeyi yönet" brings the screens back with nothing typed. "Bütün uzak oturumları kapat": the password and the code
 * once (never the e-mail). Every request and answer between the device and the café is sealed: Merkez carries ciphertext.
 * 0.1.24: the connection dropping during an edit shows "Bağlantı koptu" over the screens, then the last report (nothing
 * spins); "İşletmeyi yönet" asks the same two screens as the sign-in (the e-mail shown, read-only); F5 there never shows the
 * report first (a MutationObserver from the first byte of the page).
 */
const PASSWORD = 'MolaDemo!2026';

test('İşletmemi yönet: sign in → the café screens at once, a price, reports, Excel; café off → last report; back → "İşletmeyi yönet"; Merkez sees only ciphertext', async ({ browser }, info) => {
  test.setTimeout(360_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const phoneContext = await browser.newContext({ ...devices['Pixel 7'] });
  const relay = (on: boolean) => cafe.request.post('/api/test/relay', { data: { on } });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    const phoneCode = await phoneCodeOn(cafe.request, PASSWORD);
    await ownerEmailOn(cafe.request);
    // Ayarlar → Uzaktan erişim → "5 · Uzaktan yönetim": the password and the code, at the café; then its address there.
    const owner = await cafe.newPage(); await owner.goto('/');
    await openSettings(owner, 'Uzaktan erişim');
    const card = owner.locator('.remote-admin-settings');
    await expect(card.getByRole('heading', { name: '5 · Uzaktan yönetim' })).toBeVisible();
    await expect(card).toContainText('Kapalı · uzaktan giriş yapılamaz.');
    await expect(card.locator('.remote-address-text')).toHaveCount(0);
    await card.getByRole('button', { name: 'Aç', exact: true }).click();
    const on = card.getByRole('form', { name: 'Uzaktan yönetimi aç' });
    await on.getByLabel('Şifreniz').fill(PASSWORD);
    await on.getByLabel('Telefon kodu').fill(await phoneCode.code());
    await on.getByRole('button', { name: 'Uzaktan yönetimi aç' }).click();
    await expect(card).toContainText(/Açık · .*'den beri/);
    await expect(card.locator('.remote-address-text')).toHaveText(`${MERKEZ}/yonet`.replace(/^https?:\/\//, ''));
    await expect(card.getByRole('list', { name: 'Açık uzak oturumlar' })).toHaveCount(0);
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-yonetim.png'), fullPage: true });
    await remoteLoginOpen();

    // The laptop signs in and is in the café's screens at once: no second password, no second code.
    const device = await laptop.newPage();
    const wire: Promise<string>[] = [], direct: string[] = [];
    device.on('request', (r: PwRequest) => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/merkez/v1/phone/')) wire.push(Promise.resolve(r.postData() ?? '')); else if (/^\/api\//.test(path)) direct.push(`${r.method()} ${path}`); });
    device.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/merkez/v1/phone/')) wire.push(r.text().catch(() => '')); });
    await device.goto(`${MERKEZ}/yonet`);
    await raporlarimLogin(device, { code: () => phoneCode.code() });
    const bar = device.getByRole('region', { name: 'Uzaktan yönetim' });
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar).toContainText('Uzaktan');
    await device.locator('.sidebar nav').waitFor({ timeout: 30_000 });
    await expect(device.getByRole('form', { name: 'İşletmeyi yönet' })).toHaveCount(0);
    await device.screenshot({ path: info.outputPath('laptop-1-ekranlar.png') });

    // Change a price (Menü's own call, through the tunnel), and the café has it.
    const before = await (await cafe.request.get('/api/staff/state')).json() as { products: { id: string; name: string; price: number; nameEn?: string; description?: string }[] };
    const product = before.products.find(p => p.id === 'latte') ?? before.products[0], price = product.price + 500;
    const saved = await device.evaluate(async body => { const r = await fetch('/api/staff/products', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mola-Activity': '1' }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; }, { id: product.id, product: { ...product, nameEn: product.nameEn ?? '', description: product.description ?? '', price } });
    expect(saved.status, saved.text).toBe(200);
    const after = await (await cafe.request.get('/api/staff/state')).json() as { products: { id: string; price: number }[] };
    expect(after.products.find(p => p.id === product.id)!.price).toBe(price);
    // Café-only actions answer plainly.
    const refused = await device.evaluate(async () => { const r = await fetch('/api/staff/remote-reports/phones/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', password: 'x' }) }); return r.json(); });
    expect(refused.code).toBe('REMOTE_FORBIDDEN');
    // Menü yönetimi opens with the new price; Ayarlar opens, and Uzaktan erişim there removes nothing remotely.
    await openView(device, 'Menü yönetimi');
    await expect(device.getByText(product.name).first()).toBeVisible({ timeout: 30_000 });
    // A product photo (16 Ekim, the owner's case: broken pictures in "Menüden kampanya ürünü seç" on İşletmemi yönet): every
    // <img> of the café's screens loads through the tunnel, its srcset too (the owner's own address has no /media).
    const square = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#8a5a3c' } }).png().toBuffer();
    const uploaded = await (await cafe.request.post('/api/staff/photos', { data: { data: `data:image/png;base64,${square.toString('base64')}` } })).json() as { photo: string };
    expect(uploaded.photo).toMatch(/^\/media\//);
    const pictured = await cafe.request.post('/api/staff/products', { data: { id: product.id, product: { ...product, nameEn: product.nameEn ?? '', description: product.description ?? '', price, photo: uploaded.photo } } });
    expect(pictured.ok(), await pictured.text()).toBe(true);
    const photoLoaded = async (img: import('@playwright/test').Locator) => {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0 && e.currentSrc.startsWith('blob:')), { timeout: 30_000 }).toBe(true);
    };
    await openView(device, 'Menü yönetimi');
    await photoLoaded(device.locator('.menu-row').filter({ hasText: product.name }).locator('.product-photo img'));
    await openView(device, 'Kampanyalar');
    await device.getByRole('button', { name: 'Kampanya ekle', exact: true }).click();
    await device.getByRole('dialog').getByRole('button', { name: /Menüden seç/ }).click();
    const picker = device.getByRole('dialog', { name: 'Menüden kampanya ürünü seç' });
    await photoLoaded(picker.locator('.product-card').filter({ hasText: product.name }).locator('.product-photo img'));
    await device.screenshot({ path: info.outputPath('laptop-1b-kampanya-urun-secimi.png') });
    await device.keyboard.press('Escape'); await device.keyboard.press('Escape');
    await device.getByRole('button', { name: 'Ürünler', exact: true }).click();
    await openSettings(device, 'Uzaktan erişim');
    await expect(device.getByRole('heading', { name: '1 · Telefon kodu' })).toBeVisible({ timeout: 30_000 });
    await expect(device.locator('.remote-access')).toContainText('Kurulu ✓');
    await expect(device.getByRole('list', { name: 'Eşleşmiş cihazlar' })).toContainText('Windows laptop ·');
    await expect(device.getByRole('button', { name: /cihazını kaldır$/ })).toHaveCount(0);
    // Satış ve Raporlar opens without a second code; the Excel file downloads whole.
    await openView(device, 'Satış ve Raporlar');
    await expect(device.getByRole('button', { name: 'Yazdır ve paylaş' })).toBeVisible({ timeout: 30_000 });
    await device.screenshot({ path: info.outputPath('laptop-2-raporlar.png') });
    await reportAction(device, 'Muhasebeci için indir');
    const excel = device.getByRole('dialog', { name: 'Muhasebeci için indir' });
    const file = device.waitForEvent('download');
    await excel.getByRole('button', { name: 'Excel dosyasını indir' }).click();
    const xlsx = await file;
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = await new Promise<Buffer>((done, fail) => { void xlsx.createReadStream().then(s => { const parts: Buffer[] = []; s.on('data', c => parts.push(c as Buffer)); s.on('end', () => done(Buffer.concat(parts))); s.on('error', fail); }); });
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    await device.keyboard.press('Escape');

    // "Raporlar" in the bar: the report view, the session stays; "İşletmeyi yönet" goes back with nothing typed.
    await bar.getByRole('button', { name: 'Raporlar' }).click();
    await expect(device.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });
    await device.getByRole('button', { name: /^İşletmeyi yönet/ }).click();
    await expect(bar).toBeVisible();

    // The café computer goes off while the owner marks a product "Tükendi" in Menü yönetimi (0.1.24, the owner's case):
    // "Bağlantı koptu" over the screens soon, nothing spins on "Kaydediliyor…"; ~2 s later the last report by itself.
    await openView(device, 'Menü yönetimi');
    const soldOut = device.locator('label.availability').first();
    await expect(soldOut).toBeVisible({ timeout: 30_000 });
    expect((await relay(false)).ok()).toBe(true);
    await soldOut.click();
    const lost = device.getByRole('alertdialog', { name: 'Bağlantı koptu' });
    await expect(lost).toBeVisible({ timeout: 40_000 });
    await expect(lost).toContainText('Kasa bilgisayarı kapalı ya da internete bağlı değil. Değişiklik kaydedilemedi.');
    await expect(lost.getByRole('button', { name: 'Raporlara git' })).toBeVisible();
    await device.screenshot({ path: info.outputPath('laptop-3a-baglanti-koptu.png') });
    await expect(lost).toHaveCount(0, { timeout: 5000 });
    await expect(device.getByText('Kaydediliyor…')).toHaveCount(0);
    // The last report with "Kasa bilgisayarı kapalı", not an empty screen.
    await expect(device.getByText(/^Kasa bilgisayarı kapalı · Son durum \d\d:\d\d$/)).toBeVisible({ timeout: 60_000 });
    await expect(device.getByRole('region', { name: 'Bugünün satışı' })).toContainText('Son durum ·');
    await expect(device.getByText('İşletmeyi yönet: kasa açıkken')).toBeVisible();
    await device.screenshot({ path: info.outputPath('laptop-3-kasa-kapali.png'), fullPage: true });
    // Back on: "Kasa açıldı · İşletmeyi yönet" brings the screens back, nothing typed (the same session).
    expect((await relay(true)).ok()).toBe(true);
    const back = device.getByRole('status').filter({ hasText: 'Kasa açıldı' });
    await expect(back).toBeVisible({ timeout: 60_000 });
    await device.screenshot({ path: info.outputPath('laptop-4-kasa-acildi.png'), fullPage: true });
    await back.getByRole('button', { name: 'İşletmeyi yönet' }).click();
    await expect(bar).toBeVisible();
    await device.locator('.sidebar nav').waitFor({ timeout: 30_000 });

    // A phone: the same, on a small screen (straight in after its sign-in; the bar fits).
    const phone = await phoneContext.newPage();
    await phone.goto(`${MERKEZ}/yonet`);
    await raporlarimLogin(phone, { code: () => phoneCode.code() });
    await expect(phone.getByRole('region', { name: 'Uzaktan yönetim' })).toBeVisible({ timeout: 30_000 });
    await phone.locator('.bottom-nav').waitFor({ timeout: 30_000 });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await phone.screenshot({ path: info.outputPath('telefon-1-ekranlar.png') });

    // The café sees the sessions and was told; "Bütün uzak oturumları kapat" ends them: the password and the code once.
    await owner.reload(); await openSettings(owner, 'Uzaktan erişim');
    const list = card.getByRole('list', { name: 'Açık uzak oturumlar' });
    await expect(list).toContainText('Windows laptop ·');
    const notes = await (await cafe.request.get('/api/staff/notifications')).json() as { items: { title: string }[] };
    expect(notes.items.some(n => n.title === 'Uzaktan yönetim girişi')).toBe(true);
    await card.getByRole('button', { name: 'Bütün uzak oturumları kapat' }).click();
    const unlock = device.getByRole('form', { name: 'İşletmeyi yönet' });
    await expect(unlock).toBeVisible({ timeout: 30_000 });
    await expect(unlock).toContainText('Uzak oturum kapandı');
    // The same two screens as the sign-in: the e-mail shown and read-only, then the code.
    await expect(unlock.getByLabel('E-posta')).toHaveValue(OWNER_EMAIL);
    await expect(unlock.getByLabel('E-posta')).toHaveAttribute('readonly', '');
    await expect(unlock.getByRole('button', { name: 'Devam' })).toBeVisible();
    await device.screenshot({ path: info.outputPath('laptop-5-yeniden-giris.png'), fullPage: true });
    // F5 here: from the first byte of the page on, the report never shows before this form (only "Açılıyor…").
    await device.addInitScript(() => {
      const seen: string[] = []; (window as unknown as { __seen: string[] }).__seen = seen;
      const look = () => { const s = document.querySelector('.rp-report, .rp-bar, .rp-paired') ? 'rapor' : document.querySelector('form[aria-label="İşletmeyi yönet"]') ? 'giris' : document.querySelector('.rp-opening, [aria-busy="true"]') ? 'aciliyor' : ''; if (s && seen[seen.length - 1] !== s) seen.push(s); };
      new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await device.reload();
    await expect(unlock).toBeVisible({ timeout: 30_000 });
    await device.waitForTimeout(1500);
    const seen = await device.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen, seen.join(' → ')).not.toContain('rapor');
    expect(seen[0]).toBe('aciliyor');
    expect(seen).toContain('giris');
    // Step 1: the password ("Şifre yanlış." said there), then step 2: the code.
    await unlock.getByLabel('Şifre', { exact: true }).fill('yanlis-sifre');
    await unlock.getByRole('button', { name: 'Devam' }).click();
    await expect(unlock.getByRole('alert')).toHaveText('Şifre yanlış.');
    await unlock.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
    await unlock.getByRole('button', { name: 'Devam' }).click();
    const codeStep = device.getByRole('form', { name: 'Telefon kodu' });
    await expect(codeStep.getByLabel('Telefon kodu')).toBeFocused({ timeout: 30_000 });
    await device.screenshot({ path: info.outputPath('laptop-6-yeniden-giris-kod.png'), fullPage: true });
    await codeStep.getByLabel('Telefon kodu').fill(await phoneCode.code());
    await codeStep.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(bar).toBeVisible({ timeout: 30_000 });
    // "Çıkış" in the bar ends this remote session (the device stays signed in): the password and the code next time.
    await bar.getByRole('button', { name: 'Çıkış' }).click();
    await expect(unlock).toBeVisible({ timeout: 30_000 });
    await expect(unlock.getByRole('status')).toContainText('Çıkış yaptınız.');

    // Merkez carried only ciphertext: no product, price, password, path or report in anything the device sent or received.
    const texts = await Promise.all(wire);
    expect(texts.some(t => t.includes('"op":"call"'))).toBe(true);
    for (const text of texts) for (const marker of [product.name, `"price":${price}`, PASSWORD, '"password"', 'Windows laptop', '/api/staff/', '"role":"owner"', 'accountant.xlsx', '"products"']) expect(text.includes(marker), `Merkez saw "${marker}"`).toBe(false);
    expect(direct, 'no café request went to Merkez in the clear').toEqual([]);
  } finally { await relay(true).catch(() => {}); await phoneContext.close(); await laptop.close(); await cafe.close(); }
});

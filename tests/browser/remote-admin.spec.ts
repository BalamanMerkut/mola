import { test, expect, devices, type Request as PwRequest } from '@playwright/test';
import { ensureSetup, openSettings, openView, phoneCodeOn, reportAction } from './helpers';

/*
 * Sahibin uzaktan yönetimi (server/remote-admin.ts, src/RemoteAdmin.tsx, src/remoteTransport.ts): a device paired for
 * Raporlarım (the phone first, then the laptop: 0.1.21) opens "Kafeyi yönet", signs in with the password and the phone code,
 * and runs the café's own screens through Mola Merkez: Satış ve Raporlar, Menü yönetimi (a price changed), Ayarlar. Every
 * request and answer between the device and the café is sealed: Merkez carries ciphertext only.
 */
const PASSWORD = 'MolaDemo!2026';

test('Kafeyi yönet: paired device → password + code → change a price, reports, Excel; Merkez sees only ciphertext', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const phoneContext = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    // The phone code first (pairing a device needs it), then the owner's phone (the café pairs no laptop before a phone), then
    // the laptop (the screens of pairing: remote-reports.spec.ts, permanent-link.spec.ts).
    const phoneCode = await phoneCodeOn(cafe.request, PASSWORD);
    const first = await cafe.request.post('/api/staff/remote-reports/pair', { data: { name: 'Ahmet’in telefonu', password: PASSWORD, code: await phoneCode.code() } });
    expect(first.status()).toBe(200);
    const phonePage = await phoneContext.newPage();
    await phonePage.goto((await first.json() as { url: string }).url);
    await phonePage.getByRole('button', { name: 'Eşleştir', exact: true }).click();
    await expect(phonePage.getByText(/^Eşleşti ✓/)).toBeVisible({ timeout: 30_000 });
    const paired = await cafe.request.post('/api/staff/remote-reports/pair', { data: { name: 'Ev laptopu', password: PASSWORD, code: await phoneCode.code() } });
    expect(paired.status()).toBe(200);
    const { url } = await paired.json() as { url: string };
    const device = await laptop.newPage();
    // What the device says to Mola Merkez and hears back (the privacy check at the end).
    const wire: Promise<string>[] = [], direct: string[] = [];
    device.on('request', (r: PwRequest) => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/merkez/v1/phone/')) wire.push(Promise.resolve(r.postData() ?? '')); else if (/^\/api\//.test(path)) direct.push(`${r.method()} ${path}`); });
    device.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/merkez/v1/phone/')) wire.push(r.text().catch(() => '')); });
    await device.goto(url);
    await device.getByRole('button', { name: 'Eşleştir', exact: true }).click();
    await expect(device.getByText(/^Eşleşti ✓/)).toBeVisible({ timeout: 30_000 });
    await expect(device.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });

    // Not on yet: the device is told where to turn it on, before and after a try.
    await device.getByRole('link', { name: 'Kafeyi yönet · Satış ve Raporlar, menü, ayarlar' }).click();
    await expect(device).toHaveURL(/\/yonet$/);
    const form = device.getByRole('form', { name: 'Kafeyi yönet' });
    await expect(form.getByRole('status')).toContainText('Uzaktan yönetim kapalı. Kafedeyken Ayarlar → Uzaktan erişim → Uzaktan yönetim’den açın.');
    await form.getByLabel('Şifreniz').fill(PASSWORD);
    await form.getByLabel('Telefon kodu').fill('123456');
    await form.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(form.getByRole('alert')).toContainText('Uzaktan yönetim kapalı');

    await expect(form.getByRole('alert')).toContainText('Ayarlar → Uzaktan erişim');
    // Ayarlar → Uzaktan erişim → "4 · Uzaktan yönetim": the password and the code, at the café.
    const owner = await cafe.newPage(); await owner.goto('/');
    await openSettings(owner, 'Uzaktan erişim');
    const card = owner.locator('.remote-admin-settings');
    await expect(card.getByRole('heading', { name: '4 · Uzaktan yönetim' })).toBeVisible();
    await expect(card).toContainText('Kapalı · uzaktan giriş yapılamaz.');
    await expect(card).toContainText('Her uzaktan girişte Bildirimler’e not düşer.');
    await card.getByRole('button', { name: 'Aç', exact: true }).click();
    const on = card.getByRole('form', { name: 'Uzaktan yönetimi aç' });
    await on.getByLabel('Şifreniz').fill(PASSWORD);
    await on.getByLabel('Telefon kodu').fill(await phoneCode.code());
    await on.getByRole('button', { name: 'Uzaktan yönetimi aç' }).click();
    await expect(card).toContainText(/Açık · .*'den beri/);
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-yonetim.png'), fullPage: true });

    // The device signs in: password + the next code.
    await form.getByLabel('Şifreniz').fill(PASSWORD);
    await form.getByLabel('Telefon kodu').fill(await phoneCode.code());
    await device.screenshot({ path: info.outputPath('cihaz-giris.png'), fullPage: true });
    await form.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(device.getByRole('status', { name: 'Uzaktan yönetim' })).toBeVisible({ timeout: 30_000 });
    await device.locator('.sidebar nav').waitFor({ timeout: 30_000 });

    // Change a price (Menü's own call, through the tunnel), and the café has it.
    const before = await (await cafe.request.get('/api/staff/state')).json() as { products: { id: string; name: string; price: number; nameEn?: string; description?: string }[] };
    const product = before.products.find(p => p.id === 'latte') ?? before.products[0], price = product.price + 500;
    const saved = await device.evaluate(async body => { const r = await fetch('/api/staff/products', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mola-Activity': '1' }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; }, { id: product.id, product: { ...product, nameEn: product.nameEn ?? '', description: product.description ?? '', price } });
    expect(saved.status, saved.text).toBe(200);
    const after = await (await cafe.request.get('/api/staff/state')).json() as { products: { id: string; price: number }[] };
    expect(after.products.find(p => p.id === product.id)!.price).toBe(price);
    // Café-only actions answer plainly.
    const refused = await device.evaluate(async () => { const r = await fetch('/api/staff/remote-reports/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X', password: 'x' }) }); return r.json(); });
    expect(refused.code).toBe('REMOTE_FORBIDDEN');
    // Menü yönetimi opens with the new price; Ayarlar opens, and Uzaktan erişim there says pairing is done at the café.
    await openView(device, 'Menü yönetimi');
    await expect(device.getByText(product.name).first()).toBeVisible({ timeout: 30_000 });
    await device.screenshot({ path: info.outputPath('cihaz-menu.png'), fullPage: true });
    await openSettings(device, 'Uzaktan erişim');
    await expect(device.getByRole('heading', { name: '1 · Telefonunuz' })).toBeVisible({ timeout: 30_000 });
    await expect(device.locator('.remote-access')).toContainText('Telefonunuz bağlı: Ahmet’in telefonu.');
    await expect(device.locator('.remote-access')).toContainText('Eşleştirme yalnız kafede yapılır.');
    await expect(device.getByRole('button', { name: /cihazını kaldır$/ })).toHaveCount(0);
    await openSettings(device, 'Yazıcılar');
    await expect(device.getByRole('heading', { name: /Fiş yazıcıları/ })).toBeVisible({ timeout: 30_000 });

    // Satış ve Raporlar opens without a second code; the Excel file downloads whole.
    await openView(device, 'Satış ve Raporlar');
    await expect(device.getByRole('button', { name: 'Yazdır ve paylaş' })).toBeVisible({ timeout: 30_000 });
    await device.screenshot({ path: info.outputPath('cihaz-raporlar.png'), fullPage: true });
    await reportAction(device, 'Muhasebeci için indir');
    const excel = device.getByRole('dialog', { name: 'Muhasebeci için indir' });
    const file = device.waitForEvent('download');
    await excel.getByRole('button', { name: 'Excel dosyasını indir' }).click();
    const xlsx = await file;
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = await new Promise<Buffer>((done, fail) => { void xlsx.createReadStream().then(s => { const parts: Buffer[] = []; s.on('data', c => parts.push(c as Buffer)); s.on('end', () => done(Buffer.concat(parts))); s.on('error', fail); }); });
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    // The café sees the session and was told; "Bütün uzak oturumları kapat" sends the device back to its sign-in.
    await owner.reload(); await openSettings(owner, 'Uzaktan erişim');
    const list = card.getByRole('list', { name: 'Açık uzak oturumlar' });
    await expect(list).toContainText('Ev laptopu');
    const notes = await (await cafe.request.get('/api/staff/notifications')).json() as { items: { title: string }[] };
    expect(notes.items.some(n => n.title === 'Uzaktan yönetim girişi')).toBe(true);
    await card.getByRole('button', { name: 'Bütün uzak oturumları kapat' }).click();
    await expect(device.getByRole('form', { name: 'Kafeyi yönet' })).toBeVisible({ timeout: 30_000 });
    await expect(device.getByRole('form', { name: 'Kafeyi yönet' })).toContainText('Uzak oturum kapandı');

    // Merkez carried only ciphertext: no product, price, password, path or report in anything the device sent or received.
    const texts = await Promise.all(wire);
    expect(texts.some(t => t.includes('"op":"call"'))).toBe(true);
    for (const text of texts) for (const marker of [product.name, `"price":${price}`, PASSWORD, '/api/staff/', '"role":"owner"', 'accountant.xlsx', '"products"']) expect(text.includes(marker), `Merkez saw "${marker}"`).toBe(false);
    expect(direct, 'no café request went to Merkez in the clear').toEqual([]);
  } finally { await phoneContext.close(); await laptop.close(); await cafe.close(); }
});

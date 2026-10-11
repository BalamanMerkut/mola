import { test, expect, type Request as PwRequest } from '@playwright/test';
import { ensureSetup, openSettings, openView } from './helpers';
import { totp } from '../../server/totp';

/*
 * Sahibin uzaktan yönetimi (server/remote-admin.ts, src/RemoteAdmin.tsx, src/remoteTransport.ts): a device paired for
 * Raporlarım opens "Kafeyi yönet", signs in with the password and the phone code, and runs the café's own screens through
 * Mola Merkez. Every request and answer between the device and the café is sealed: Merkez carries ciphertext only.
 */
const PASSWORD = 'MolaDemo!2026';

test('Kafeyi yönet: paired device → password + code → change a price, reports, Excel; Merkez sees only ciphertext', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const cafe = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  try {
    expect((await cafe.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
    await ensureSetup(cafe.request);
    // Pair the device first (Destek → Uzaktan erişim; covered by remote-reports.spec.ts), then set up the phone code.
    const paired = await cafe.request.post('/api/staff/remote-reports/pair', { data: { name: 'Ev laptopu', password: PASSWORD } });
    expect(paired.status()).toBe(200);
    const { url } = await paired.json() as { url: string };
    const device = await laptop.newPage();
    // What the device says to Mola Merkez and hears back (the privacy check at the end).
    const wire: Promise<string>[] = [], direct: string[] = [];
    device.on('request', (r: PwRequest) => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/merkez/v1/phone/')) wire.push(Promise.resolve(r.postData() ?? '')); else if (/^\/api\//.test(path)) direct.push(`${r.method()} ${path}`); });
    device.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/merkez/v1/phone/')) wire.push(r.text().catch(() => '')); });
    await device.goto(url);
    await device.getByRole('button', { name: 'Eşleştir', exact: true }).click();
    await expect(device.getByText(/^Canlı · \d\d:\d\d$/)).toBeVisible({ timeout: 30_000 });

    const setup = await (await cafe.request.post('/api/staff/report-security/setup', { data: { password: PASSWORD } })).json() as { secret: string };
    expect((await cafe.request.post('/api/staff/report-security/enable', { data: { code: totp(setup.secret, Date.now() - 30_000) } })).ok()).toBe(true);

    // Not on yet: the device is told where to turn it on.
    await device.getByRole('link', { name: 'Kafeyi yönet' }).click();
    await expect(device).toHaveURL(/\/yonet$/);
    const form = device.getByRole('form', { name: 'Kafeyi yönet' });
    await form.getByLabel('Şifreniz').fill(PASSWORD);
    await form.getByLabel('Telefon kodu').fill('123456');
    await form.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(form.getByRole('alert')).toContainText('Uzaktan yönetim kapalı');

    // Ayarlar → Güvenlik ve yedek → Telefonum → "Uzaktan yönetim": the password and the code, at the café.
    const owner = await cafe.newPage(); await owner.goto('/');
    await openSettings(owner, 'Telefonum');
    const card = owner.locator('.remote-admin-settings');
    await expect(card).toContainText('Kapalı · uzaktan giriş yapılamaz.');
    await expect(card).toContainText('Eşleşmiş cihazlar: Ev laptopu.');
    await card.getByRole('button', { name: 'Aç', exact: true }).click();
    const on = card.getByRole('form', { name: 'Uzaktan yönetimi aç' });
    await on.getByLabel('Şifreniz').fill(PASSWORD);
    await on.getByLabel('Telefon kodu').fill(totp(setup.secret, Date.now()));
    await on.getByRole('button', { name: 'Uzaktan yönetimi aç' }).click();
    await expect(card).toContainText(/Açık · .*'den beri/);
    await owner.screenshot({ path: info.outputPath('sahip-uzaktan-yonetim.png'), fullPage: true });

    // The device signs in: password + the next code.
    await form.getByLabel('Şifreniz').fill(PASSWORD);
    await form.getByLabel('Telefon kodu').fill(totp(setup.secret, Date.now() + 30_000));
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

    // Satış ve Raporlar opens without a second code; the Excel file downloads whole.
    await openView(device, 'Satış ve Raporlar');
    await expect(device.getByRole('button', { name: 'Muhasebeci için indir' })).toBeVisible({ timeout: 30_000 });
    await device.screenshot({ path: info.outputPath('cihaz-raporlar.png'), fullPage: true });
    await device.getByRole('button', { name: 'Muhasebeci için indir' }).click();
    const excel = device.getByRole('dialog', { name: 'Muhasebeci için indir' });
    const file = device.waitForEvent('download');
    await excel.getByRole('button', { name: 'Excel dosyasını indir' }).click();
    const xlsx = await file;
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = await new Promise<Buffer>((done, fail) => { void xlsx.createReadStream().then(s => { const parts: Buffer[] = []; s.on('data', c => parts.push(c as Buffer)); s.on('end', () => done(Buffer.concat(parts))); s.on('error', fail); }); });
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    // The café sees the session and was told; "Bütün uzak oturumları kapat" sends the device back to its sign-in.
    await owner.reload(); await openSettings(owner, 'Telefonum');
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
  } finally { await laptop.close(); await cafe.close(); }
});

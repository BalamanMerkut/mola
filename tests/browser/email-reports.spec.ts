import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { ensureSetup, openView, reportAction } from './helpers';

/** Screens for the owner: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
/** A tiny SMTP server on this computer (plain SMTP is allowed only to 127.0.0.1): keeps who got what, with the raw message. */
function fakeSmtp(password: string) {
  const mails: { to: string[]; data: string; user: string }[] = [];
  const server: Server = createServer(socket => {
    let buffer = '', data: string | null = null, to: string[] = [], user = '';
    socket.setEncoding('utf8'); socket.on('error', () => {}); socket.write('220 sahte-smtp\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\r\n')) >= 0;) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (data !== null) { if (line === '.') { mails.push({ to, data, user }); data = null; to = []; socket.write('250 alindi\r\n'); } else data += line + '\n'; continue; }
        if (/^EHLO/i.test(line)) socket.write('250-sahte-smtp\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) { const [, u, p] = Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0'); user = u; socket.write(p === password ? '235 OK\r\n' : '535 hayir\r\n'); }
        else if (/^RCPT/i.test(line)) { to.push(/<([^>]+)>/.exec(line)?.[1] ?? ''); socket.write('250 OK\r\n'); }
        else if (/^DATA/i.test(line)) { data = ''; socket.write('354 devam\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 hoscakal\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  return { mails, server, listen: () => new Promise<number>(done => server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port))) };
}
const login = async (page: Page) => { await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); };

test('Satış ve Raporlar → Raporları gönder (once Ayarlar → İşletme → Raporlar ve e-posta): the café’s own mail account, Deneme e-postası (plain summary first, printable report attached), report switches, the password never shown again', async ({ page }, info) => {
  test.setTimeout(120_000);
  const PASSWORD = 'uygulama-sifresi-16', smtp = fakeSmtp(PASSWORD), port = await smtp.listen();
  try {
    await login(page); await ensureSetup(page.request);
    await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
    await openView(page, 'Satış ve Raporlar');
    await reportAction(page, 'Raporları gönder');
    const account = page.getByRole('form', { name: 'E-posta hesabı' });
    await expect(account).toBeVisible();
    // Before an account is saved, the test button says why it waits.
    await expect(page.getByRole('button', { name: 'Deneme e-postası gönder' })).toBeDisabled();
    await expect(page.getByText('Önce hesabı kaydedin; deneme e-postası kayıtlı hesapla gönderilir.')).toBeVisible();
    // Gmail is the default (address + 16-letter app password); here "Başka e-posta sunucusu" on this computer.
    await expect(account.getByLabel('Uygulama şifresi')).toBeVisible();
    await account.getByRole('group', { name: 'E-posta türü' }).getByRole('button', { name: 'Başka e-posta sunucusu' }).click();
    await account.getByLabel('E-posta sunucusu (SMTP)').fill('127.0.0.1');
    await account.getByLabel('Bağlantı').selectOption('none');
    await account.getByLabel('Port').fill(String(port));
    await account.getByLabel('Kullanıcı adı').fill('kafe@example.com');
    await account.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
    await account.getByLabel('Raporların gideceği adresler').fill('sahip@example.com, yanlis-adres');
    // 19 Ekim: not while typing, once the field is left.
    await expect(account.getByText('Adres geçersiz: yanlis-adres')).toHaveCount(0);
    await account.getByLabel('Raporların gideceği adresler').blur();
    await expect(account.getByText('Adres geçersiz: yanlis-adres').first()).toBeVisible();
    await account.getByLabel('Raporların gideceği adresler').fill('sahip@example.com, muhasebe@example.com');
    await account.getByRole('button', { name: 'Hesabı kaydet' }).click();
    await expect(page.locator('.notice-success')).toContainText('Şifre bu bilgisayarda şifreli saklanır');
    // The password never comes back: an empty box that says it is saved.
    await expect(account.getByLabel('Şifre', { exact: true })).toHaveValue('');
    await expect(account.getByLabel('Şifre', { exact: true })).toHaveAttribute('placeholder', 'Kayıtlı · değiştirmek için yazın');
    expect(JSON.stringify(await (await page.request.get('/api/staff/email-reports')).json())).not.toContain(PASSWORD);

    // "Deneme e-postası gönder": to both addresses, from the café's account, the summary first and the printable report attached.
    await page.getByRole('button', { name: 'Deneme e-postası gönder' }).click();
    await expect(page.locator('.notice-success')).toContainText('Deneme e-postası gönderildi: sahip@example.com, muhasebe@example.com', { timeout: 60_000 });
    expect(smtp.mails).toHaveLength(1);
    const mail = smtp.mails[0];
    expect(mail.to).toEqual(['sahip@example.com', 'muhasebe@example.com']); expect(mail.user).toBe('kafe@example.com');
    const parts = mail.data.split(/\n--[^\n]+\n?/).map(block => ({ type: /Content-Type: ([^;\n]+)/i.exec(block)?.[1] ?? '', name: /filename="([^"]+)"/i.exec(block)?.[1], body: Buffer.from(block.split('\n\n').slice(1).join('').replace(/\s/g, ''), 'base64') }));
    const text = parts.find(p => p.type === 'text/plain' && !p.name)!.body.toString('utf8');
    expect(text).toContain('Bu bir deneme e-postasıdır');
    expect(text).toMatch(/\n\nBugün şu ana kadar /);
    const file = parts.find(p => p.name)!;
    // A PDF when this computer has Edge or Chrome, else the same A4 page as HTML.
    expect(file.name).toMatch(/^Mola-Gun-sonu-raporu-\d{4}-\d{2}-\d{2}\.(pdf|html)$/);
    if (file.name!.endsWith('.pdf')) expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-'); else expect(file.body.toString('utf8')).toContain('@page{size:A4');
    await expect(page.getByText(/Son deneme: .* · gönderildi/)).toBeVisible();

    // The four switches; each saves at once.
    const day = page.getByLabel('Gün sonu raporu', { exact: true });
    await expect(page.getByLabel('Haftalık rapor', { exact: true })).not.toBeChecked();
    await day.check();
    await expect.poll(async () => (await (await page.request.get('/api/staff/email-reports')).json()).reports.day).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'Son gönderim:' })).toContainText('Henüz yok');
    await shot(page, 'eposta-raporlari.png', info.outputPath('email-reports.png'));
    // On a phone the page fits.
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(page, 'eposta-raporlari-telefon.png', info.outputPath('email-reports-phone.png'));
    await page.setViewportSize({ width: 1280, height: 900 });

    // The café is left as it was: switch off, account removed.
    await day.uncheck();
    await expect.poll(async () => (await (await page.request.get('/api/staff/email-reports')).json()).reports.day).toBe(false);
    await page.getByRole('button', { name: 'Hesabı kaldır' }).click();
    await expect(page.locator('.notice-success')).toContainText('E-posta hesabı kaldırıldı');
    expect((await (await page.request.get('/api/staff/email-reports')).json()).account).toBeNull();
    // Only the owner: the cashier gets no e-mail settings.
    await page.request.post('/api/login', { data: { username: 'kasiyer', password: 'MolaDemo!2026' } });
    expect((await page.request.get('/api/staff/email-reports')).status()).toBe(403);
  } finally { smtp.server.close(); }
});

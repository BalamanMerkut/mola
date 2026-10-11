import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { merkezPort, yonetimShot } from './helpers';
import { scenario } from './protected-server';
import { totp } from '../../server/totp';

/** A tiny SMTP server on this computer (Mola allows plain SMTP only to 127.0.0.1): keeps every message's decoded text. */
function fakeSmtp() {
  const mails: { to: string; text: string }[] = [];
  const server: Server = createServer(socket => {
    let buffer = '', data = false, to = '', body = '';
    socket.setEncoding('utf8'); socket.write('220 sahte-smtp\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (data) {
          if (line === '.') { data = false; const [, encoded = ''] = body.split('\r\n\r\n'); mails.push({ to, text: Buffer.from(encoded.replace(/\s+/g, ''), 'base64').toString('utf8') }); socket.write('250 alindi\r\n'); }
          else body += line + '\r\n';
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO' || command === 'HELO') socket.write('250-sahte-smtp\r\n250 OK\r\n');
        else if (command === 'RCPT') { to = /<([^>]+)>/.exec(line)?.[1] ?? ''; socket.write('250 OK\r\n'); }
        else if (command === 'DATA') { data = true; body = ''; socket.write('354 devam\r\n'); }
        else if (command === 'QUIT') { socket.end('221 hoscakal\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return { mails, server, listen: () => new Promise<number>(done => server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port))) };
}

// Its own Mola Merkez (port 3195 / E2E_MERKEZ_PORT+5): the reset changes the admin password.
test('Şifremi unuttum → E-postama kod gönder: the code from the e-mail, a warning while two-step login is off; with it on, the Authenticator (or the Merkez recovery code) is asked too', async ({ page }) => {
  test.setTimeout(150_000);
  const smtp = fakeSmtp(), smtpPort = await smtp.listen();
  const port = merkezPort(5), root = scenario('eposta-sifirla'), base = `http://127.0.0.1:${port}`, old = 'Eski-Kirmizi-Kapi-29', fresh = 'Yeni-Mavi-Bahce-47', third = 'Mor-Sari-Bahce-61';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(port), MERKEZ_DATA_DIR: join(root, 'merkez'), SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MOLA_MODE: 'installed', MERKEZ_INITIAL_PASSWORD: old } });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  const api = async (path: string, body: unknown, cookie = '') => {
    const r = await fetch(`${base}/api/merkez/admin${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
    return { status: r.status, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), data: await r.json() as Record<string, any> };
  };
  // Only what reaches the admin address (the notification queue may also mail bildirim@example.com meanwhile).
  const mine = () => smtp.mails.filter(m => m.to === 'satici@example.com');
  const waitMail = async (count: number) => { for (let i = 0; i < 100 && mine().length < count; i++) await new Promise(r => setTimeout(r, 100)); expect(mine().length).toBeGreaterThanOrEqual(count); return mine()[count - 1]; };
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(`${base}/api/merkez/v1/health`)).ok) break; } catch { /* starting */ } if (i > 240) throw new Error('Merkez açılmadı.'); await new Promise(r => setTimeout(r, 125)); }
    await page.setViewportSize({ width: 1280, height: 900 });
    // Without SMTP the e-mail way is off, and the screen says why.
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Şifremi unuttum' }).click();
    await expect(page.getByRole('button', { name: 'E-postayla' })).toBeDisabled();
    await expect(page.locator('.reset-email-off')).toContainText('SMTP');
    // Ayarlar → E-posta bildirimleri (here a relay on this computer) with a "Yönetici e-postası".
    const login = await api('/login', { username: 'admin', password: old });
    const saved = await api('/email', { enabled: true, host: '127.0.0.1', port: smtpPort, security: 'none', user: '', to: 'bildirim@example.com', from: 'mola@example.com', adminEmail: 'satici@example.com' }, login.cookie);
    expect(saved.status).toBe(200);
    const recoveryCode = (await api('/recovery/show', {}, login.cookie)).data.code as string;
    await page.reload();
    await page.getByRole('button', { name: 'Şifremi unuttum' }).click();
    await page.getByRole('button', { name: 'E-postayla' }).click();
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Yönetici e-postası').fill('satici@example.com');
    await yonetimShot(page, 'sifremi-unuttum-eposta.png', test.info().outputPath('email-ask.png'));
    await page.locator('button.auth-submit').click();
    await expect(page.locator('.notice-success')).toContainText('kayıtlıysa 6 haneli bir kod gönderildi');
    const mail = await waitMail(1);
    expect(mail.to).toBe('satici@example.com');
    const code = /\b(\d{6})\b/.exec(mail.text)![1];
    await page.getByLabel('E-postadaki 6 haneli kod').fill(code === '000000' ? '000001' : '000000');
    await page.getByRole('button', { name: 'Devam et' }).click();
    await expect(page.locator('.notice-error')).toContainText('Kod yanlış');
    await page.getByLabel('E-postadaki 6 haneli kod').fill(code);
    await page.getByRole('button', { name: 'Devam et' }).click();
    await expect(page.getByRole('heading', { name: 'Yeni şifre belirleyin' })).toBeVisible();
    // Two-step login is off: said plainly, the reset still works (the owner's choice), MFA is recommended.
    await expect(page.locator('.notice').filter({ hasText: 'İki adımlı giriş kapalı' })).toBeVisible();
    await page.getByLabel('Yeni yönetici şifresi').fill(fresh); await page.getByLabel('Yeni şifre tekrar').fill(fresh);
    await yonetimShot(page, 'sifremi-unuttum-eposta-yeni.png', test.info().outputPath('email-new.png'));
    await page.getByRole('button', { name: 'Şifreyi yenile ve oturumları kapat' }).click();
    await expect(page.locator('.notice-success')).toContainText('Öneri: girişten sonra iki adımlı girişi açın');
    expect((await fetch(`${base}/api/merkez/admin/state`, { headers: { Cookie: login.cookie } })).status).toBe(401);
    const changed = await waitMail(2);
    expect(changed.to).toBe('satici@example.com'); expect(changed.text).toContain('e-postaya gönderilen kodla');
    // Ayarlar → Hesap güvenliği recommends two-step login (the e-mail alone can reset it now).
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(fresh);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await page.getByRole('button', { name: 'Ayarlar' }).click();
    await expect(page.getByTestId('mfa-advice')).toContainText('E-postama kod gönder');
    await yonetimShot(page, 'hesap-guvenligi-oneri.png', test.info().outputPath('advice.png'));
    // Two-step login on (through the API, as Ayarlar → Hesap güvenliği does): now the e-mail code alone is not enough.
    const signed = await api('/login', { username: 'admin', password: fresh });
    const setup = await api('/mfa/setup', { password: fresh }, signed.cookie);
    expect((await api('/mfa/enable', { code: totp(setup.data.secret, Date.now()), saved: true }, signed.cookie)).status).toBe(200);
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Şifremi unuttum' }).click();
    await page.getByRole('button', { name: 'E-postayla' }).click();
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Yönetici e-postası').fill('satici@example.com');
    await page.locator('button.auth-submit').click();
    const second = await waitMail(3);
    await page.getByLabel('E-postadaki 6 haneli kod').fill(/\b(\d{6})\b/.exec(second.text)![1]);
    await page.getByRole('button', { name: 'Devam et' }).click();
    await expect(page.getByLabel('Doğrulayıcı uygulamadaki 6 haneli kod')).toBeVisible();
    await page.getByLabel('Yeni yönetici şifresi').fill(third); await page.getByLabel('Yeni şifre tekrar').fill(third);
    await expect(page.getByRole('button', { name: 'Şifreyi yenile ve oturumları kapat' })).toBeDisabled();
    // The phone is lost: the Merkez recovery code instead (MFA is turned off with it, to set up again).
    await page.getByRole('button', { name: 'Doğrulayıcımı kaybettim' }).click();
    await page.getByLabel('Merkez kurtarma kodu (doğrulayıcı yerine)').fill(recoveryCode);
    await yonetimShot(page, 'sifremi-unuttum-eposta-dogrulayici.png', test.info().outputPath('email-mfa.png'));
    await page.getByRole('button', { name: 'Şifreyi yenile ve oturumları kapat' }).click();
    await expect(page.locator('.notice-success')).toContainText('İki adımlı giriş kapatıldı');
    await page.getByLabel('Kullanıcı adı').fill('admin');
    await page.getByLabel('Şifre', { exact: true }).fill(third);
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' })).toBeVisible();
    // On a phone the e-mail way fits too.
    await page.request.post(`${base}/api/merkez/admin/logout`, { data: {} });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Şifremi unuttum' }).click();
    await page.getByRole('button', { name: 'E-postayla' }).click();
    await expect(page.getByLabel('Yönetici e-postası')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { child.kill(); await exited; smtp.server.close(); }
});

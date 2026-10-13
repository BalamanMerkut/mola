import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { merkezPort, openSettings } from './helpers';
import { protectedPort, protectedServer, scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';
import { decodeParts, fakeSmtp } from '../fake-smtp';

/*
 * "İşletmem var" (13 Ekim): the owner installs Mola on a new computer and signs in with the business e-mail, their username
 * and password; a 6-digit code comes by e-mail; the Sunucu yedeği copy comes down and opens with the same password. No
 * recovery code, no call to Mola ekibi. Its own Mola Merkez (port E2E_MERKEZ_PORT+6), because its e-mail goes to a fake SMTP.
 */
const NAME = 'Sahip Giriş Kafesi', EMAIL = 'sahip@example.com', USER = 'sahip.kafe', PASSWORD = 'SahipGiris!2026';
test('İşletmem var: e-mail + username + password, the code from the e-mail, the café comes back from Mola Merkez on a new computer', async ({ page }, info) => {
  test.setTimeout(240_000);
  const smtp = await fakeSmtp('kullanilmaz'), root = scenario('isletmem-var'), port = merkezPort(6), base = `http://127.0.0.1:${port}`, adminPassword = 'Merkez-Sahip-Testi-58';
  const merkez = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MERKEZ_PORT: String(port), MERKEZ_DATA_DIR: join(root, 'merkez'), SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MOLA_MODE: 'installed', MERKEZ_INITIAL_PASSWORD: adminPassword } });
  const exited = new Promise<void>(done => merkez.once('exit', () => done()));
  let cookie = '';
  const admin = async (path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/merkez/admin${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); if (set) cookie = set;
    return { status: r.status, data: await r.json().catch(() => ({})) as Record<string, any> };
  };
  /** The code mails to the business, newest last (the notification queue may mail others meanwhile). */
  const codes = () => smtp.received.filter(m => m.to.some(t => t.includes(EMAIL))).map(m => /\b(\d{6})\b/.exec(decodeParts(m.data).find(p => !p.name)?.text ?? '')?.[1]).filter(Boolean) as string[];
  const env = { MOLA_MERKEZ_URL: base, MOLA_MERKEZ_PUBLIC_KEY: join(root, 'merkez', 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000' };
  let old: Awaited<ReturnType<typeof protectedServer>> | undefined, fresh: Awaited<ReturnType<typeof protectedServer>> | undefined, owner: APIRequestContext | undefined;
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(`${base}/api/merkez/v1/health`)).ok) break; } catch { /* starting */ } if (i > 240) throw new Error('Merkez açılmadı.'); await new Promise(r => setTimeout(r, 125)); }
    expect((await admin('/login', { username: 'admin', password: adminPassword })).status).toBe(200);
    expect((await admin('/email', { enabled: true, host: '127.0.0.1', port: smtp.port, security: 'none', user: '', to: 'bildirim@example.com', from: 'mola@example.com' })).status).toBe(200);

    // The old computer: an approved application (its invoice e-mail is the business's), the owner account, one sign-in
    // (it writes the owner's password lock), a backup that goes to Mola Merkez.
    old = await protectedServer(join(root, 'eski'), protectedPort(4), 'eski-pc', true, env);
    // Its own request context: both cafés are 127.0.0.1, and cookies do not tell ports apart.
    owner = await playwrightRequest.newContext({ baseURL: old.base });
    const local = (path: string, data: unknown) => owner!.post(path, { data });
    const applied = await local('/api/activation/application', { businessName: NAME, sector: 'cafe', contactName: 'Elif Su', consent: true, agreement: { version: AGREEMENT_VERSION },
      invoice: { legalName: `${NAME} Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1111111114', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 9', phone: '+905321117766', email: EMAIL } });
    expect(applied.ok(), await applied.text()).toBe(true);
    const tenantId = (await admin('/state')).data.businesses.find((b: { name: string }) => b.name === NAME).tenantId;
    expect((await admin('/applications/approve', { requestId: 'onay-sahip-giris-1', tenantId })).status).toBe(200);
    await expect.poll(async () => (await (await owner!.get('/api/activation')).json()).state, { timeout: 20000 }).toBe('owner');
    expect((await local('/api/activation/owner', { username: USER, password: PASSWORD })).ok()).toBe(true);
    await old.desktop('/api/desktop/recovery/show', {}); await old.desktop('/api/desktop/recovery/confirm', {});
    expect((await local('/api/login', { username: USER, password: PASSWORD })).ok()).toBe(true);
    await expect.poll(async () => !!(await old!.desktop<{ backup: { cloud?: unknown } }>('/api/desktop/status')).data.backup.cloud, { timeout: 30000 }).toBe(true);
    expect((await old.desktop<{ lastError: string | null }>('/api/desktop/backup', {})).data.lastError).toBeNull();
    await expect.poll(async () => (await old!.desktop<{ backup: { cloud?: { lastSuccessAt: string | null } } }>('/api/desktop/status')).data.backup.cloud?.lastSuccessAt ?? null, { timeout: 60000 }).not.toBeNull();

    // Ayarlar → Güvenlik ve yedek → Yeni bilgisayar için e-posta (13 Ekim): the application's address shows; a change needs
    // the owner's password, the old address's code and the new address's code; the old address is told.
    const NEW = 'yeni.sahip@example.com';
    // A new business opens on the setup wizard first: done here as in the other specs.
    const st = await (await owner.get('/api/staff/state')).json();
    expect((await owner.post('/api/staff/setup', { data: { requestId: 'sahip-kurulum-1', version: st.businessRevision ?? 0, name: st.name, tableCount: st.tables.length, changeSeconds: st.changeSeconds, commissionBps: st.commissionBps } })).ok()).toBe(true);
    const ownerPage = await (await page.context().browser()!.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await ownerPage.goto(old.base);
    await ownerPage.getByLabel('Kullanıcı adı', { exact: true }).fill(USER);
    await ownerPage.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
    await ownerPage.getByRole('button', { name: 'Çalışma alanını aç' }).click();
    await openSettings(ownerPage, 'Yedek');
    const card = ownerPage.locator('.owner-email-card');
    await expect(card).toContainText('s****@example.com'); await expect(card).toContainText('Başvurudaki adres');
    await card.getByRole('button', { name: 'Değiştir' }).click();
    await card.getByLabel('İşletme sahibi şifresi').fill('YanlisSifre!2026');
    await card.getByRole('button', { name: 'Eski adrese kod gönder' }).click();
    await expect(card.getByRole('alert')).toContainText('Şifre yanlış');
    await card.getByLabel('İşletme sahibi şifresi').fill(PASSWORD);
    await card.getByRole('button', { name: 'Eski adrese kod gönder' }).click();
    await expect(card).toContainText('2/3');
    const lastCode = async (to: string) => { await expect.poll(() => smtp.received.filter(m => m.to.some(t => t.includes(to))).length, { timeout: 15000 }).toBeGreaterThan(0); return /\b(\d{6})\b/.exec(decodeParts(smtp.received.filter(m => m.to.some(t => t.includes(to))).at(-1)!.data).find(p => !p.name)?.text ?? '')![1]; };
    await card.getByLabel('Eski adrese gelen kod').fill(await lastCode(EMAIL));
    await card.getByLabel('Yeni e-posta adresi').fill(NEW);
    await card.getByRole('button', { name: 'Yeni adrese kod gönder' }).click();
    await expect(card).toContainText('3/3');
    await card.getByLabel('Yeni adrese gelen kod').fill(await lastCode(NEW));
    await ownerPage.screenshot({ path: info.outputPath('5-eposta-degistir.png') });
    await card.getByRole('button', { name: 'Doğrula' }).click();
    await expect(card.getByText('E-posta doğrulandı.')).toBeVisible();
    await expect(card).toContainText('y******@example.com'); await expect(card).toContainText('Doğrulandı');
    await ownerPage.context().close();
    // The İşletmem var code mails below are counted from here (the old-address code above went to the same address).
    const earlier = codes().length;

    // A clean install on another computer. The welcome window offers "İşletmem var"; here it is put off and taken from the
    // activation screen instead (the other way in).
    fresh = await protectedServer(join(root, 'yeni'), protectedPort(5), 'yeni-pc', true, env);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${fresh.base}/#masaustu=${fresh.token}`);
    const welcome = page.getByRole('dialog', { name: 'Mola’ya hoş geldiniz' });
    await expect(welcome.getByRole('button', { name: /İşletmem var/ })).toBeVisible();
    await page.screenshot({ path: info.outputPath('1-hos-geldiniz.png') });
    await welcome.getByRole('button', { name: /Yeni kurulum/ }).click();
    await page.getByRole('button', { name: /İşletmem var/ }).click();
    const dialog = page.getByRole('dialog', { name: 'İşletmem var' });
    await expect(dialog.locator('.owner-steps li[aria-current="step"]')).toContainText('Giriş');
    // Merkez learns the owner's verifier with the old computer's heartbeat: the first tries may come before it.
    await dialog.getByLabel('İşletmenin e-posta adresi').fill(EMAIL);
    await dialog.getByLabel('Kullanıcı adı').fill(USER);
    await dialog.getByLabel('Şifre').fill('YanlisSifre!2026');
    await page.screenshot({ path: info.outputPath('2-giris.png') });
    await dialog.getByRole('button', { name: 'Kod gönder' }).click();
    await expect(dialog.getByText(/Bilgiler eşleşmedi/)).toBeVisible();
    expect(codes()).toHaveLength(earlier);
    await dialog.getByLabel('Şifre').fill(PASSWORD);
    for (let i = 0; ; i++) {
      await dialog.getByRole('button', { name: 'Kod gönder' }).click();
      await expect(dialog.getByLabel('Doğrulama kodu').or(dialog.getByRole('alert'))).toBeVisible({ timeout: 30000 });
      if (await dialog.getByLabel('Doğrulama kodu').isVisible()) break;
      expect(i, 'Merkez never learned the owner’s verifier').toBeLessThan(6); await page.waitForTimeout(3000);
    }
    // Where the code went, masked; the business's name.
    await expect(dialog).toContainText(NAME); await expect(dialog).toContainText('s****@example.com');
    await expect.poll(() => codes().length, { timeout: 15000 }).toBeGreaterThan(earlier);
    const code = codes().at(-1)!;
    await dialog.getByLabel('Doğrulama kodu').fill(code);
    await page.screenshot({ path: info.outputPath('3-eposta-kodu.png') });
    await dialog.getByLabel('Doğrulama kodu').fill(code === '000000' ? '111111' : '000000');
    await dialog.getByRole('button', { name: 'Doğrula' }).click();
    await expect(dialog.getByText(/Kod yanlış/)).toBeVisible();
    await dialog.getByLabel('Doğrulama kodu').fill(code);
    await dialog.getByRole('button', { name: 'Doğrula' }).click();
    // The Sunucu yedeği copy, picked; no recovery code asked.
    await expect(dialog.locator('.notice').first()).toContainText(`Doğrulandı: ${NAME}`);
    const copies = dialog.getByRole('radiogroup', { name: 'Mola Merkez’deki yedekler' }).getByRole('radio');
    await expect(copies).toHaveCount(1); await expect(copies.first()).toBeChecked();
    await expect(dialog.getByLabel('Kurtarma kodu')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('4-verileri-getir.png') });
    await dialog.getByRole('button', { name: 'İndir ve geri yükle' }).click();
    await expect(dialog.getByText('Veriler geri yüklendi ve doğrulandı.', { exact: false })).toBeVisible({ timeout: 60000 });
    await page.waitForURL(`${fresh.base}/`, { timeout: 15000 });
    await expect(page.getByRole('navigation', { name: 'Mola bilgisayar araçları' })).toBeVisible();
    expect((await page.request.post(`${fresh.base}/api/login`, { data: { username: USER, password: PASSWORD } })).status()).toBe(200);
    // The recovery code may be lost: the new computer makes a new one and asks the owner to save it.
    await expect.poll(async () => (await fresh!.desktop<{ available: boolean; confirmed: boolean }>('/api/desktop/recovery')).data, { timeout: 15000 }).toMatchObject({ available: true, confirmed: false });
    // Mola Yönetim hears it; the old computer stops taking orders with its next heartbeat.
    const state = (await admin('/state')).data;
    expect(state.audit.some((a: { action: string; target: string }) => a.action === 'owner_login.verified' && a.target === tenantId)).toBe(true);
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
    await expect.poll(async () => (await (await owner!.get('/api/staff/state')).json()).licenseNotice ?? '', { timeout: 60000 }).toMatch(/başka bir bilgisayarda/);
  } finally {
    await fresh?.stop(); await old?.stop(); await owner?.dispose(); merkez.kill(); await exited; await smtp.close();
  }
});

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { ADMIN_API, cleanKafe, fillApplication, cleanPort, e2eRun, MERKEZ, merkezPassword } from './helpers';
import { scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

const DEMO = 'MolaDemo!2026';
const agreementBox = (page: Page) => page.getByRole('checkbox', { name: /Mola Lisans Sözleşmesi’ni okudum ve kabul ediyorum/ });
const SHOTS = process.env.KAFE_EKRAN;

test('activation: the agreement must be ticked on both ways, and its full text opens in a readable window', async ({ page }, info) => {
  const kafe = await cleanKafe(cleanPort(6));
  try {
    await page.goto(kafe.base);
    await page.getByRole('button', { name: /Etkinleştirme kodum var/ }).click();
    await page.getByLabel(/Etkinleştirme kodu/).fill('ABCD-EFGH-JKLM');
    await expect(agreementBox(page)).not.toBeChecked();
    // Without the tick nothing is sent.
    await page.getByRole('button', { name: 'Etkinleştir', exact: true }).click();
    await expect(page.getByText('Devam etmek için Mola Lisans Sözleşmesi’ni kabul edin.')).toBeVisible();
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'lisans-sozlesmesi.png') });
    await page.getByRole('button', { name: 'Mola Lisans Sözleşmesi’ni oku' }).click();
    const sheet = page.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' });
    await expect(sheet).toContainText('TASLAK');
    await expect(sheet.getByRole('heading', { name: /Yapılmaması gerekenler/ })).toBeVisible();
    await expect(sheet).toContainText('5846 sayılı Fikir ve Sanat Eserleri Kanunu');
    await page.screenshot({ path: info.outputPath('lisans-sozlesmesi.png') });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'lisans-sozlesmesi-metin.png') });
    // A phone: the text scrolls inside the window, the page does not scroll sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 860 });
    await sheet.getByRole('button', { name: 'Kapat', exact: true }).last().click();
    await expect(sheet).toBeHidden();
    await agreementBox(page).check();
    await expect(page.getByText('Devam etmek için Mola Lisans Sözleşmesi’ni kabul edin.')).toBeHidden();
    await page.getByRole('button', { name: 'Geri' }).click();
    // The application has its own box, required the same way.
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await fillApplication(page, 'Sözleşme Pastanesi');
    await agreementBox(page).uncheck();
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByText('Devam etmek için Mola Lisans Sözleşmesi’ni kabul edin.')).toBeVisible();
  } finally { await kafe.stop(); }
});

/** A café folder registered at the test Merkez without any acceptance (as installs from before the agreement are), set up. */
async function unacceptedKafe(port: number, page: Page) {
  const root = scenario('sozlesme'), imported = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-import.ts', join(root, 'veri'), '--merkez', MERKEZ, '--merkez-data', join(e2eRun(), 'merkez'), '--demo', '--password', merkezPassword()], { encoding: 'utf8' });
  expect(imported.status, imported.stderr).toBe(0);
  const kafe = await cleanKafe(port, { root });
  // The demo business finishes its first setup (the window comes after it, never over the setup wizard).
  expect((await page.request.post(`${kafe.base}/api/login`, { data: { username: 'isletme', password: DEMO } })).ok()).toBe(true);
  const s = await (await page.request.get(`${kafe.base}/api/staff/state`)).json();
  if (!s.setupCompleted) expect((await page.request.post(`${kafe.base}/api/staff/setup`, { data: { requestId: 'sozlesme-setup', version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: s.changeSeconds, commissionBps: s.commissionBps } })).ok()).toBe(true);
  return kafe;
}

test('an install from before the agreement: the owner is asked once per sign-in, can postpone, staff never see it; acceptance reaches Mola Yönetim', async ({ browser, page }) => {
  test.setTimeout(120_000);
  const kafe = await unacceptedKafe(cleanPort(7), page);
  const staff = await browser.newContext();
  try {
    const signIn = async (p: Page, username: string) => { expect((await p.request.post(`${kafe.base}/api/login`, { data: { username, password: DEMO } })).ok()).toBe(true); await p.goto(kafe.base); };
    await signIn(page, 'isletme');
    const prompt = page.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Bu pencere çalışmanızı durdurmaz');
    // One window, not two (10 Ekim: siblings with the same React key opened it twice on about a third of the sign-ins).
    await page.waitForTimeout(1500);
    await expect(page.locator('dialog.agreement-dialog[open]')).toHaveCount(1);
    // "Daha sonra": closed for this sign-in; the owner works on. A refresh of the page and the polls do not bring it back.
    await prompt.getByRole('button', { name: 'Daha sonra' }).click();
    await expect(prompt).toBeHidden();
    await expect(page.locator('.table-card, .floor-tile').first()).toBeVisible();
    await page.waitForTimeout(4500);
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.table-card, .floor-tile').first()).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(prompt).toHaveCount(0);
    // The cashier and the kitchen never see it, before or after.
    for (const username of ['kasiyer', 'mutfak']) {
      const p = await staff.newPage(); await signIn(p, username);
      await expect(p.locator('.workspace')).toBeVisible();
      await p.waitForTimeout(800);
      await expect(p.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' })).toHaveCount(0);
      await p.request.post(`${kafe.base}/api/logout`, { data: {} }); await p.close();
    }
    // The next sign-in (through the sign-in screen of this same tab) asks again; now accepted.
    await page.getByRole('button', { name: 'Çıkış yap' }).first().click();
    await page.getByLabel('Kullanıcı adı').fill('isletme'); await page.getByLabel('Şifre').fill(DEMO);
    await page.getByRole('button', { name: /Çalışma alanını aç/ }).click();
    await expect(prompt).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('dialog.agreement-dialog[open]')).toHaveCount(1);
    await prompt.getByRole('button', { name: 'Okudum, kabul ediyorum' }).click();
    await expect(prompt).toBeHidden();
    // Never again: not with the next polls, not after a refresh, not after the next sign-in.
    await page.waitForTimeout(4500);
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.workspace')).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(prompt).toHaveCount(0);
    await page.request.post(`${kafe.base}/api/logout`, { data: {} });
    await signIn(page, 'isletme');
    await expect(page.locator('.workspace')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(prompt).toHaveCount(0);
    // Mola Merkez has it with the next heartbeat (the test café beats every 2 s).
    const admin = await browser.newContext();
    try {
      const login = await admin.request.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword() } });
      expect(login.ok()).toBe(true);
      await expect.poll(async () => {
        const state = await (await admin.request.get(`${ADMIN_API}/state`)).json();
        return state.businesses.filter((b: any) => b.agreement?.version === AGREEMENT_VERSION && b.installId === state.businesses.find((x: any) => x.agreement?.name === 'İşletme sahibi')?.installId).length;
      }, { timeout: 20_000 }).toBeGreaterThan(0);
    } finally { await admin.close(); }
  } finally { await staff.close(); await kafe.stop(); }
});

/*
 * The owner's real-device report (8 Ekim): the window stayed on the screen and neither "Kapat" nor "Okudum, kabul ediyorum"
 * did anything until Mola was closed and opened again. Cause: the owner's idle lock (10 minutes; the agreement is long, the
 * owner was away) covered the page and made it inert, but the agreement window sat in the browser's top layer above the lock
 * screen. Its buttons were inert, the lock screen under it unreachable. The lock screen now goes on top of every window.
 */
test('the owner lock while the agreement window is open: the lock screen comes on top, unlocking brings the window back and it closes', async ({ page }) => {
  test.setTimeout(120_000);
  const kafe = await unacceptedKafe(cleanPort(8), page);
  try {
    await page.goto(kafe.base);
    const prompt = page.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' });
    await expect(prompt).toBeVisible();
    // The server locks the session (as the idle timer does); the next poll shows the lock screen.
    expect((await page.request.post(`${kafe.base}/api/staff/lock`, { data: {} })).ok()).toBe(true);
    const lock = page.getByRole('dialog', { name: 'Sahip hesabı kilitlendi' });
    await expect(lock).toBeVisible();
    // The lock screen is what the owner can reach: the topmost element in its middle is the lock card, not the agreement.
    const box = (await lock.locator('.owner-lock-card').boundingBox())!;
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.owner-lock'), [box.x + box.width / 2, box.y + 20])).toBe(true);
    await lock.getByLabel('Şifreniz').fill(DEMO);
    await lock.getByRole('button', { name: 'Kilidi aç' }).click();
    await expect(lock).toBeHidden();
    // The window is still there and works: accepted, closed, and it stays closed through polls and a refresh.
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Okudum, kabul ediyorum' }).click();
    await expect(prompt).toBeHidden();
    await page.waitForTimeout(4500);
    await expect(prompt).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.workspace')).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(prompt).toHaveCount(0);
    expect((await (await page.request.get(`${kafe.base}/api/staff/license/agreement`)).json()).needed).toBe(false);
  } finally { await kafe.stop(); }
});

test('"Kapat" (×) closes the window at once, like "Daha sonra"; an accept refused by the server says why beside the buttons', async ({ page }) => {
  test.setTimeout(90_000);
  const kafe = await unacceptedKafe(cleanPort(9), page);
  try {
    await page.goto(kafe.base);
    const prompt = page.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' });
    await expect(prompt).toBeVisible();
    // A refused acceptance (here: the session was locked between the tap and the server) shows its message next to the buttons.
    await page.route('**/api/staff/license/agreement', route => route.request().method() === 'POST' ? route.fulfill({ status: 423, contentType: 'application/json', body: JSON.stringify({ code: 'SESSION_LOCKED', message: 'Sahip hesabı kilitlendi. Devam etmek için şifrenizi girin.' }) }) : route.continue());
    await prompt.getByRole('button', { name: 'Okudum, kabul ediyorum' }).click();
    await expect(prompt.locator('.agreement-actions').getByText('Sahip hesabı kilitlendi.', { exact: false })).toBeVisible();
    await page.unroute('**/api/staff/license/agreement');
    await prompt.getByRole('button', { name: 'Kapat', exact: true }).click();
    await expect(prompt).toBeHidden();
    await page.waitForTimeout(4500);
    await expect(prompt).toHaveCount(0);
  } finally { await kafe.stop(); }
});

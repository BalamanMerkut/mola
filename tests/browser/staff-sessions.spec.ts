import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanPort, e2eRun, MERKEZ, openStaff } from './helpers';
import { scenario } from './protected-server';

// "Kalıcı ama günde bir giriş": a café server of its own (port 3127 / E2E_PORT+27, built screens like an installed café),
// stopped hard like a power cut and started again on the same data.
const PORT = cleanPort(7), BASE = `http://127.0.0.1:${PORT}`, PASSWORD = 'MolaDemo!2026';
const root = scenario('sessions');
function start() {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: String(PORT), DATA_DIR: join(root, 'veri'), SERVE_BUILD: '1', MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0', MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt') },
  });
  return { child, exited: new Promise<void>(done => child.once('exit', () => done())) };
}
async function ready(child: ChildProcess) {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    if (i > 160 || child.exitCode !== null) throw new Error('Oturum testi sunucusu açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
}
/** 05:00 Türkiye time after `now` (UTC+3 all year). */
function nextDayStart(now: number) {
  const local = new Date(now + 3 * 3600_000);
  let end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 5);
  if (end <= local.getTime()) end += 86400_000;
  return end - 3 * 3600_000;
}

test('tablets stay signed in through a restart until 05:00; the owner signs a device out from Çalışanlar', async ({ browser }) => {
  test.setTimeout(120_000);
  let server = start();
  try {
    await ready(server.child);
    const owner = await browser.newContext({ baseURL: BASE }), kitchen = await browser.newContext({ baseURL: BASE, viewport: { width: 800, height: 1100 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Tab S9) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' });
    const ownerPage = await owner.newPage(), kitchenPage = await kitchen.newPage();
    for (const [page, username] of [[ownerPage, 'isletme'], [kitchenPage, 'mutfak']] as const) expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
    const s = await (await ownerPage.request.get('/api/staff/state')).json();
    if (!s.setupCompleted) expect((await ownerPage.request.post('/api/staff/setup', { data: { requestId: 'sessions-initial-setup', version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: s.changeSeconds, commissionBps: s.commissionBps } })).ok()).toBe(true);
    await kitchenPage.goto('/');
    await expect(kitchenPage.locator('.kitchen-board')).toBeVisible();
    // The login lasts the business day: the cookie ends at the next 05:00, not after a few hours.
    const cookie = (await kitchen.cookies()).find(c => c.name === 'mola_staff')!;
    expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict');
    expect(Math.abs(cookie.expires * 1000 - nextDayStart(Date.now()))).toBeLessThan(120_000);

    // Power cut: no clean shutdown, then the server comes back on the same data.
    server.child.kill('SIGKILL'); await server.exited;
    server = start(); await ready(server.child);
    await kitchenPage.reload();
    await expect(kitchenPage.locator('.kitchen-board')).toBeVisible();
    await expect(kitchenPage.getByRole('button', { name: 'Çalışma alanını aç' })).toHaveCount(0);

    // The owner finds the kitchen tablet under Personel → Çalışanlar → Açık oturumlar and signs it out.
    await ownerPage.goto('/');
    await openStaff(ownerPage, 'Çalışanlar');
    const sessions = ownerPage.getByRole('region', { name: 'Açık oturumlar' });
    await expect(sessions).toContainText('Android tablet · Chrome');
    await expect(sessions).toContainText('Bu cihaz');
    await sessions.getByRole('button', { name: /Mutfak · Android tablet · Chrome oturumunu kapat/ }).click();
    await expect(sessions).not.toContainText('Android tablet');
    // The tablet leaves the kitchen screen at its next refresh (this folder is not activated, so it shows activation, not login).
    await expect(kitchenPage.locator('.kitchen-board')).toHaveCount(0, { timeout: 10_000 });
    expect((await kitchenPage.request.get('/api/staff/me')).status()).toBe(401);
    await owner.close(); await kitchen.close();
  } finally { server.child.kill(); await server.exited; }
});

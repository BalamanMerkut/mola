import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { totp } from '../../server/totp';
import { currentPlatform } from '../../server/update-manifest';
import { testBundle } from '../update-fixture';
import { ADMIN_API, cleanKafe, cleanPort, MERKEZ, merkezPassword, openSettings, openYonetim, yonetimSettings } from './helpers';
import { scenario } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

/*
 * Otomatik güncelleme in the browser: the vendor's release management in Mola Yönetim (upload, pilot, publish, stop and every
 * café's state) and the café owner's quiet banner with "Şimdi kur" (refused while a table is open; otherwise a backup and a
 * restart for the watchdog, exit code 75), plus "Boşta kendiliğinden kur" in Ayarlar.
 */
const current = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const next = (bump: number) => current.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_m, a, b, c) => `${a}.${b}.${Number(c) + bump}`);
const platform = currentPlatform() ?? 'windows';
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/*
 * Güncelleme yetkisi (server/merkez/step-up.ts): two-step login is switched on over the API (this suite's own Merkez), the
 * sign-in uses a backup code, and every Authenticator code is used once: `nextCode` hands out the next unused one.
 */
let mfa: { secret: string; recoveryCodes: string[] } | undefined, usedStep = -1;
async function nextCode() {
  for (;;) {
    const current = Math.floor(Date.now() / 30000), step = Math.max(current, usedStep + 1);
    if (step <= current + 1) { usedStep = step; return totp(mfa!.secret, step * 30000); }
    await new Promise(r => setTimeout(r, 1000));
  }
}
async function enableMfa(api: APIRequestContext) {
  const setup = await (await api.post(`${ADMIN_API}/mfa/setup`, { data: { password: merkezPassword() } })).json();
  mfa = { secret: setup.secret, recoveryCodes: setup.recoveryCodes };
  // The step before now (still accepted), so the next one is free for the first Güncelleme yetkisi.
  usedStep = Math.floor(Date.now() / 30000) - 1;
  expect((await api.post(`${ADMIN_API}/mfa/enable`, { data: { code: totp(setup.secret, usedStep * 30000), saved: true } })).ok()).toBe(true);
}

test('Mola Yönetim → Güncellemeler: drop a bundle, confirm with the Authenticator code, pilot right there, the café downloads it, publish, stop', async ({ page }, info) => {
  test.setTimeout(150_000);
  const version = next(1), bundle = await testBundle(scenario('update-bundle'), version, { platform });
  await openYonetim(page);
  await yonetimSettings(page, 'Güncellemeler');
  const card = page.getByRole('region', { name: 'Güncellemeler' });
  await expect(card).toContainText('Henüz güncelleme paketi yüklenmedi.');
  await expect(card.getByRole('list', { name: 'Nasıl yayınlanır' })).toContainText('Yeni sürümü buraya sürükleyin');
  // Without two-step login: blocked, with the way to Hesap güvenliği.
  const right = card.getByRole('region', { name: 'Güncelleme yetkisi' });
  await expect(right).toContainText('Güncelleme yayınlamak için önce iki adımlı doğrulamayı açın.');
  await expect(card.getByLabel('Güncelleme paketi (.mola-guncelleme)')).toBeDisabled();
  await right.getByRole('button', { name: 'İki adımlı doğrulamayı aç' }).click();
  await expect(page.getByLabel('Güvenlik ayarı için yönetici şifresi')).toBeVisible();
  // Two-step login on (all sessions end), signed in again with a backup code.
  await enableMfa(page.request);
  await page.goto(`${MERKEZ}/`);
  await page.getByLabel('Şifre', { exact: true }).fill(merkezPassword());
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await page.getByLabel('Authenticator veya kurtarma kodu', { exact: true }).fill(mfa!.recoveryCodes[0]);
  await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
  await yonetimSettings(page, 'Güncellemeler');
  // Compact: what it guards is in its ⓘ.
  await expect(right).toContainText('Güncelleme yetkisi kapalı. Yükleme ve yayın için doğrulayıcı kodunu girin');
  await expect(right.getByRole('button', { name: 'Güncelleme yetkisi hakkında bilgi' })).toBeVisible();
  // Drop the file (here: choose it): the code is asked for, then it uploads by itself.
  const form = card.getByRole('form', { name: 'Güncelleme paketi yükle' });
  // Plain text: "<" and a tag-looking word are fine and shown as written (no "Alanları kontrol edin").
  await form.getByLabel(/İşletme sahibine not/).fill('Mutfak ekranı daha hızlı açılıyor (<2 sn). <b>Yeni</b> & güzel.');
  await form.getByLabel(/Güncelleme paketi/).setInputFiles(bundle.file);
  await expect(right).toContainText('“Yükle ve doğrula” için onay');
  await expect(right.getByLabel('Doğrulayıcı kodu', { exact: true })).toBeFocused();
  // A wrong code: said as it is; the right one continues the upload.
  const good = await nextCode();
  await right.getByLabel('Doğrulayıcı kodu', { exact: true }).fill(good === '000000' ? '111111' : '000000');
  await right.getByRole('button', { name: 'Onayla ve devam et' }).click();
  await expect(card.locator('.notice-error')).toContainText('Kod yanlış');
  await right.getByLabel('Doğrulayıcı kodu', { exact: true }).fill(good);
  await right.getByRole('button', { name: 'Onayla ve devam et' }).click();
  const fresh = card.getByRole('region', { name: 'Yeni yüklenen sürüm' });
  await expect(fresh).toContainText('yüklendi, denetlendi ve imzalandı', { timeout: 20000 });
  await expect(right).toContainText('Güncelleme yetkisi açık');
  await expect(card.locator('.notice-error')).toHaveCount(0);
  const release = card.getByRole('listitem', { name: new RegExp(`Sürüm ${version.replace(/\./g, '\\.')}`) });
  await expect(release).toContainText('Yayında değil');
  await expect(release.locator('.release-note')).toContainText('Mutfak ekranı daha hızlı açılıyor (<2 sn). <b>Yeni</b> & güzel.');
  await expect(release.locator('.release-note b')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('guncellemeler-yuklendi.png'), fullPage: true });
  // Pilot right there: only the chosen business's computer hears about it; the table shows its download.
  await expect(fresh.getByRole('button', { name: 'Herkese yayınla' })).toBeVisible();
  await fresh.getByRole('button', { name: 'Önce pilot işletmelere' }).click();
  const pilot = fresh.getByRole('form', { name: 'Pilot işletmeler' });
  await pilot.getByRole('checkbox').first().check();
  await pilot.getByRole('button', { name: 'Pilotu başlat' }).click();
  await expect(release.locator('.release-chip')).toHaveText('Pilot: 1 işletme');
  await expect(fresh).toHaveCount(0);
  // The same file again is refused (one version per platform); the window is open, so no code is asked.
  await form.getByLabel(/Güncelleme paketi/).setInputFiles(bundle.file);
  await expect(card.locator('.notice-error')).toContainText('zaten yüklü');
  const cafes = card.getByRole('table', { name: 'İşletmelerin sürümleri' });
  await expect(cafes).toContainText(`${version} indirildi · yeniden başlatma bekliyor`, { timeout: 45000 });
  await page.screenshot({ path: info.outputPath('guncellemeler-pilot.png'), fullPage: true });
  await release.getByRole('button', { name: 'Herkese yayınla' }).click();
  await expect(release.locator('.release-chip')).toHaveText('Herkese yayında');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await fits(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('guncellemeler-telefon.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await release.getByRole('button', { name: 'Durdur' }).click();
  await expect(release.locator('.release-chip')).toHaveText('Yayında değil');
  await expect(card.locator('.notice-success')).toContainText('durduruldu');
  // A bundle no café needs (they already run this version): it uploads, and the screen says nobody will get it.
  const same = await testBundle(scenario('update-bundle-ayni'), current, { platform });
  await form.getByLabel(/Güncelleme paketi/).setInputFiles(same.file);
  await expect(fresh).toContainText('denetlendi ve imzalandı', { timeout: 20000 });
  await expect(card.getByText(/kimseye sunulmaz/).first()).toBeVisible();
  await expect(card.getByRole('listitem', { name: new RegExp(`Sürüm ${current.replace(/\./g, '\\.')} `) }).locator('.release-warning')).toContainText('kimseye sunulmaz');
  await fresh.getByRole('button', { name: 'Sonra' }).click();
  await expect(fresh).toHaveCount(0);
  // "Yetkiyi kapat": the next critical action asks for a code again.
  await right.getByRole('button', { name: 'Yetkiyi kapat' }).click();
  await expect(right.getByLabel('Doğrulayıcı kodu', { exact: true })).toBeVisible();
  // "Notu düzenle" signs the release again: it waits for the code too, then saves by itself.
  await release.getByRole('button', { name: 'Notu düzenle' }).click();
  await release.getByLabel('İşletme sahibine not').fill('Mutfak ekranı daha hızlı açılıyor.');
  await release.getByRole('button', { name: 'Notu kaydet' }).click();
  await expect(right).toContainText('“Notu kaydet” için onay');
  await expect(release.locator('.release-note')).toHaveCount(0);
  await right.getByLabel('Doğrulayıcı kodu', { exact: true }).fill(await nextCode());
  await right.getByRole('button', { name: 'Onayla ve devam et' }).click();
  await expect(card.locator('.notice-success')).toContainText('Not kaydedildi; sürüm yeniden imzalandı.');
  await expect(release.locator('.release-note')).toContainText('Mutfak ekranı daha hızlı açılıyor.');
  await right.getByRole('button', { name: 'Yetkiyi kapat' }).click();
  // İşlem kayıtları keeps every step (the panel reads it every 10 seconds).
  await yonetimSettings(page, 'İşlem kayıtları');
  for (const line of ['Güncelleme yetkisi açıldı (doğrulayıcı koduyla)', 'Güncelleme yetkisi açılamadı (doğrulayıcı kodu yanlış)', 'Güncelleme yetkisi kapatıldı', 'Güncelleme paketi yüklendi', 'Güncelleme pilot işletmelere yayınlandı', 'Güncelleme herkese yayınlandı', 'Güncelleme durduruldu']) await expect(page.getByText(line).first()).toBeVisible({ timeout: 15000 });
});

test('café owner: "Yeni sürüm hazır" banner; "Şimdi kur" waits for open tables, then backs up and restarts for the watchdog', async ({ page }, info) => {
  test.setTimeout(150_000);
  const api = page.request;
  // Two-step login is on since the first test (or switched on now when this one runs alone).
  if (!mfa) { expect((await api.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword() } })).ok()).toBe(true); await enableMfa(api); }
  expect((await api.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword(), code: mfa!.recoveryCodes[1] } })).ok()).toBe(true);
  expect((await api.post(`${ADMIN_API}/releases/yetki`, { data: { code: await nextCode() } })).ok()).toBe(true);
  const created = await (await api.post(`${ADMIN_API}/businesses`, { data: { requestId: randomUUID().replace(/-/g, ''), name: 'Güncelleme Kafesi', kind: 'trial', sector: 'cafe' } })).json();
  // A café computer under the watchdog (MOLA_NOBETCI=1): "Şimdi kur" may restart it.
  const kafe = await cleanKafe(cleanPort(7), { env: { MOLA_NOBETCI: '1' } });
  try {
    expect((await api.post(`${kafe.base}/api/activation/code`, { data: { code: created.code, agreement: { version: AGREEMENT_VERSION } } })).ok()).toBe(true);
    expect((await api.post(`${kafe.base}/api/activation/owner`, { data: { username: 'guncelsahip', password: 'GuncelSahip!2026', name: 'Ayşe' } })).ok()).toBe(true);
    const s0 = await (await api.get(`${kafe.base}/api/staff/state`)).json();
    expect((await api.post(`${kafe.base}/api/staff/setup`, { data: { requestId: 'guncelleme-kurulum', version: s0.businessRevision ?? 0, name: 'Güncelleme Kafesi', sector: 'cafe', tableCount: 4, changeSeconds: 0, commissionBps: null } })).ok()).toBe(true);
    // The vendor publishes to this business only.
    const version = next(2), bundle = await testBundle(scenario('update-bundle'), version, { platform, notes: 'Hesap ekranı yenilendi.' });
    const up = await (await api.post(`${ADMIN_API}/releases/upload`, { headers: { 'Content-Type': 'application/octet-stream' }, data: readFileSync(bundle.file) })).json();
    expect((await api.post(`${ADMIN_API}/releases/rollout`, { data: { id: up.release.id, mode: 'pilot', pilot: [created.tenantId] } })).ok()).toBe(true);
    await expect.poll(async () => (await (await api.get(`${kafe.base}/api/staff/update`)).json()).state, { timeout: 45000 }).toBe('ready');
    // An open table with a new order.
    const s = await (await api.get(`${kafe.base}/api/staff/state`)).json();
    const product = s.products.find((p: { groups?: { required: boolean }[]; soldOut: boolean }) => !p.soldOut && !(p.groups ?? []).some(g => g.required));
    const order = await (await api.post(`${kafe.base}/api/staff/orders`, { data: { requestId: 'guncelleme-siparis', tableId: s.tables[0].id, expectedTotal: product.price, lines: [{ productId: product.id, quantity: 1, selections: [] }] } })).json();
    await page.goto(kafe.base);
    const banner = page.getByRole('region', { name: 'Yeni sürüm' });
    await expect(banner).toContainText('Yeni sürüm hazır');
    await expect(banner).toContainText('kapanışta ya da yarın açılışta kurulacak');
    await expect(banner).toContainText('Hesap ekranı yenilendi.');
    await page.screenshot({ path: info.outputPath('kafe-yeni-surum.png') });
    await banner.getByRole('button', { name: 'Şimdi kur' }).click();
    await expect(banner).toContainText('1 açık masa ve 1 bitmemiş sipariş var');
    // The server says the same even if a screen does not.
    const refused = await api.post(`${kafe.base}/api/staff/update/install`, { data: {} });
    expect(refused.status()).toBe(409); expect((await refused.json()).code).toBe('UPDATE_BUSY');
    // Ayarlar → Güvenlik ve yedek: the version and "Boşta kendiliğinden kur" (on by default).
    await openSettings(page, 'Kilit ve güncelleme');
    const updates = page.locator('.settings-card').filter({ hasText: 'Güncellemeler' });
    await expect(updates).toContainText(`Yeni sürüm (${version}) hazır`);
    const idle = updates.getByLabel('Boşta kendiliğinden kur');
    await expect(idle).toBeChecked();
    await idle.uncheck(); await expect(idle).not.toBeChecked();
    expect((await (await api.get(`${kafe.base}/api/staff/update`)).json()).idleInstall).toBe(false);
    await idle.check();
    // The table closes (the order is cancelled, the empty bill closed): now it installs.
    const placed = (await (await api.get(`${kafe.base}/api/staff/state`)).json()).orders.find((o: { id: string }) => o.id === order.orderId) ?? (await (await api.get(`${kafe.base}/api/staff/state`)).json()).orders[0];
    expect((await api.post(`${kafe.base}/api/staff/orders/cancel`, { data: { requestId: 'guncelleme-iptal', orderId: placed.id, version: placed.version, reason: 'Müşteri vazgeçti' } })).ok()).toBe(true);
    const account = (await (await api.get(`${kafe.base}/api/staff/state`)).json()).tables[0].account;
    expect((await api.post(`${kafe.base}/api/staff/close-empty`, { data: { requestId: 'guncelleme-kapat', accountId: account.id } })).ok()).toBe(true);
    await page.goto(kafe.base);
    await banner.getByRole('button', { name: 'Şimdi kur' }).click();
    await expect(page.getByText('Mola güncelleniyor.')).toBeVisible();
    await page.screenshot({ path: info.outputPath('kafe-guncelleniyor.png') });
    await kafe.exited;
    expect(kafe.exitCode(), 'the server closed itself with 75: the watchdog applies the update now').toBe(75);
  } finally { await kafe.stop(); }
});

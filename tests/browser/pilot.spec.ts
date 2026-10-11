import { test, expect } from '@playwright/test';
import { ADMIN_API, cleanKafe, cleanPort, confirmStepUp, detailTab, enableAdminFactor, openSettings, openYonetim, yonetimGo, yonetimShot } from './helpers';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

test('Mola Yönetim prepares a pilot with a code, the café activates it, and licence changes reach the café with the heartbeat', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const kafe = await cleanKafe(cleanPort(0));
  const cafe = await browser.newContext(), guestContext = await browser.newContext();
  try {
    await openYonetim(page);
    // "Ödeme alındı" needs two-step login and the Authenticator code (server/merkez/step-up.ts).
    if (await enableAdminFactor(page.request)) await openYonetim(page);
    await yonetimGo(page, 'İşletmeler');
    await page.getByRole('button', { name: 'İşletme ekle', exact: true }).click();
    await page.getByLabel('İşletme adı', { exact: true }).fill('Elazığ Pilot Kafe');
    await page.getByLabel(/Yetkili adı/).fill('Ayşe Yılmaz');
    await expect(page.getByLabel('Lisans türü')).toHaveValue('trial');
    // Optional kind of business: preselects the owner's first setup.
    const kinds = page.getByRole('group', { name: 'İşletme türü' });
    await kinds.getByRole('button', { name: 'Restoran', exact: true }).click();
    await kinds.getByRole('button', { name: 'Kafe', exact: true }).click();
    await expect(kinds.getByRole('button', { name: 'Kafe', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(kinds.getByRole('button', { name: 'Restoran', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('dialog', { name: 'İşletme ekle', exact: true }).screenshot({ path: info.outputPath('create-business.png') });
    await page.getByRole('button', { name: 'İşletmeyi oluştur' }).click();
    // The one-time code is shown once; Merkez keeps only its hash.
    const codeDialog = page.getByRole('dialog', { name: 'Etkinleştirme kodu' });
    const code = (await codeDialog.getByTestId('activation-code').textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Where it goes (the café's computer, "Etkinleştirme kodum var"), one computer = one business, and ways to hand it over.
    const steps = codeDialog.getByTestId('activation-steps');
    await expect(steps).toContainText('Bu kod Mola Yönetim’e değil, kafenin bilgisayarındaki Mola’ya girilir.');
    await expect(steps).toContainText('“Etkinleştirme kodum var”ı seçin');
    await expect(steps).toContainText('Verileri ve yedekleri de sil');
    await expect(codeDialog.getByRole('img', { name: /Etkinleştirme kodum var/ })).toContainText(code);
    const share = codeDialog.getByRole('group', { name: 'Kodu paylaş' });
    await expect(share.getByRole('button', { name: 'Kodu kopyala' })).toBeVisible();
    await expect(share.getByRole('button', { name: 'Yazdır' })).toBeVisible();
    const wa = await share.getByRole('link', { name: 'WhatsApp ile gönder' }).getAttribute('href');
    expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/); expect(decodeURIComponent(wa!.split('text=')[1])).toContain(code);
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: 1280, height: 1180 });
    await yonetimShot(page, 'etkinlestirme-kodu.png', info.outputPath('etkinlestirme-kodu.png'), false);
    await page.setViewportSize(viewport);
    await codeDialog.getByRole('button', { name: 'Tamam', exact: true }).click();
    const row = page.locator('.platform-business-row').filter({ hasText: 'Elazığ Pilot Kafe' });
    await expect(row.locator('.status-chip')).toHaveText('Kod bekleniyor');
    await expect(row).toContainText('Etkinleştirme kodum var');

    // The café computer: "Mola'yı etkinleştir" before anything else, then the owner's own account.
    const owner = await cafe.newPage();
    await owner.goto(kafe.base);
    await expect(owner.getByRole('heading', { name: 'Mola’yı etkinleştir' })).toBeVisible();
    await owner.screenshot({ path: info.outputPath('activation-choice.png') });
    await owner.getByRole('button', { name: /Etkinleştirme kodum var/ }).click();
    await owner.getByLabel(/Etkinleştirme kodu/).fill(code.toLowerCase());
    // Mola Lisans Sözleşmesi: required before "Etkinleştir"; the link opens the full text.
    await owner.getByRole('button', { name: 'Etkinleştir', exact: true }).click();
    await expect(owner.getByText('Devam etmek için Mola Lisans Sözleşmesi’ni kabul edin.')).toBeVisible();
    await owner.getByRole('button', { name: 'Mola Lisans Sözleşmesi’ni oku' }).click();
    const text = owner.getByRole('dialog', { name: 'Mola Lisans Sözleşmesi' });
    await expect(text).toContainText('TASLAK');
    await text.getByRole('button', { name: 'Kapat', exact: true }).last().click();
    await owner.getByRole('checkbox', { name: /Mola Lisans Sözleşmesi’ni okudum ve kabul ediyorum/ }).check();
    await owner.getByRole('button', { name: 'Etkinleştir', exact: true }).click();
    await expect(owner.getByRole('heading', { name: 'İşletme sahibi hesabı' })).toBeVisible();
    await expect(owner.locator('.activation-card')).toContainText('Elazığ Pilot Kafe');
    await owner.getByLabel(/Kullanıcı adı/).fill('elazig.pilot');
    // The field may carry its hint in its name ("Şifre * En az 10 karakter.").
    await owner.getByLabel(/^Şifre \*/).fill('PilotTest!2026');
    await owner.getByLabel('Şifre tekrar *', { exact: true }).fill('PilotTest!2026');
    await owner.getByRole('button', { name: 'Hesabı oluştur' }).click();
    // Signed in at once: no second login.
    await expect(owner.locator('.setup-steps')).toContainText('İşletme türü');
    const state = await (await owner.request.get(`${kafe.base}/api/staff/state`)).json();
    expect(state.sector).toBe('cafe'); expect(state.name).toBe('Elazığ Pilot Kafe');
    await setupRequest(owner.request, kafe.base);

    // Mola Yönetim: active, trial running, setup and last contact from the heartbeat.
    await expect.poll(async () => (await (await page.request.get(`${ADMIN_API}/state`)).json()).businesses.find((b: any) => b.name === 'Elazığ Pilot Kafe').setupCompleted, { timeout: 15000 }).toBe(true);
    await page.reload();
    await yonetimGo(page, 'İşletmeler');
    await expect(row.locator('.status-chip')).toHaveText('Deneme · 30 gün');
    await row.click();
    const card = page.getByRole('region', { name: 'Elazığ Pilot Kafe', exact: true });
    await expect(card).toContainText('30 gün kaldı');
    await expect(card.locator('.detail-more')).toContainText('Ayşe Yılmaz');
    await expect(card.locator('.detail-more')).toContainText('Tamamlandı');
    await detailTab(card, 'Lisans').click();
    await expect(card.getByTestId('license-agreement')).toContainText(new RegExp(`^Lisans sözleşmesi: Sürüm ${AGREEMENT_VERSION} · kabul \\d\\d\\.\\d\\d\\.\\d{4} \\d\\d:\\d\\d`));
    await page.screenshot({ path: info.outputPath('pilot-license-desktop.png'), fullPage: true });
    await owner.goto(kafe.base);
    await owner.getByRole('button', { name: 'Destek', exact: true }).click();
    await expect(owner.getByText('Ücretsiz deneme', { exact: true })).toBeVisible();
    await expect(owner.getByText(/30 gün kaldı/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 860 });
    // A paid plan asks once more on the same button.
    await card.getByRole('button', { name: '1 aylık aboneliğe geçir', exact: true }).click();
    await card.getByRole('button', { name: 'Emin misiniz? 1 aylık abonelik başlar', exact: true }).click();
    await confirmStepUp(page, 'Ödeme alındı');
    await expect(card.locator('.license-summary')).toContainText('Aylık abonelik');
    await expect(card.getByRole('button', { name: '1 ay uzat', exact: true })).toBeVisible();

    // Suspension reaches the guest's menu with the next heartbeat; staff work goes on.
    const guest = await guestContext.newPage(); await guest.goto(`${kafe.base}/m/${state.tables[0].token}`);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible();
    await card.getByRole('button', { name: 'Askıya al', exact: true }).click(); await card.getByLabel(/Askıya alma nedeni/).fill('Pilot deneme'); await card.locator('.suspend-form').getByRole('button', { name: 'Askıya al' }).click();
    await expect(guest.getByText('Bu işletmenin dijital menüsü şu anda kullanılamıyor. Lütfen personelle görüşün.')).toBeVisible({ timeout: 20000 });
    const fresh = await guestContext.newPage(); await fresh.goto(`${kafe.base}/m/${state.tables[0].token}`);
    await expect(fresh.getByText(/dijital menüsü şu anda kullanılamıyor/)).toBeVisible();
    await card.getByRole('button', { name: 'Hizmeti aç', exact: true }).click();
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 20000 });
    // "1 yıl uzat" only adds time (the monthly plan stays monthly); the plan is changed on its own.
    await card.getByRole('button', { name: '1 yıl uzat', exact: true }).click(); await card.getByRole('button', { name: 'Emin misiniz? 1 yıl eklenir', exact: true }).click();
    await expect(card.getByRole('button', { name: '1 aylık (şu anki)', exact: true })).toBeVisible();
    await expect(card.locator('.license-summary')).toContainText('Aylık abonelik');
    await card.getByRole('button', { name: '1 yıllık plana geç', exact: true }).click(); await card.getByRole('button', { name: 'Emin misiniz? 1 yıllık plana geçer', exact: true }).click();
    await expect(card.locator('.license-summary')).toContainText('Yıllık abonelik');
    // A freeze: asked on the café computer, approved in Mola Yönetim, enforced at the café.
    await expect.poll(async () => (await (await owner.request.get(`${kafe.base}/api/staff/support`)).json()).license?.planMonths, { timeout: 20000 }).toBe(12);
    await owner.reload();
    // Trial → paid with fewer services: the owner sees the one-time "Deneme süreniz bitti" window first.
    const trialEnd = owner.getByRole('dialog', { name: 'Deneme süreniz bitti' });
    await expect(trialEnd).toContainText('Paketiniz başladı');
    await trialEnd.getByRole('button', { name: 'Tamam', exact: true }).click();
    await expect(trialEnd).toBeHidden();
    // Hizmeti dondurma: Ayarlar → İşletme → Paket ve lisans (10 Ekim; once under Destek → Talepler).
    await openSettings(owner, 'Paket ve lisans');
    await owner.getByRole('button', { name: 'Dondurma talebi oluştur', exact: true }).click();
    await owner.getByLabel('Dondurma süresi (gün)').fill('30');
    await owner.getByLabel('Gerekçe', { exact: false }).fill('Yeni dükkâna taşınıyoruz.');
    await owner.getByRole('button', { name: 'Talebi gönder', exact: true }).click();
    await expect(owner.locator('.freeze-request')).toContainText('Onay bekliyor');
    await expect.poll(async () => (await (await page.request.get(`${ADMIN_API}/state`)).json()).businesses.find((b: any) => b.name === 'Elazığ Pilot Kafe').freezes?.length ?? 0, { timeout: 20000 }).toBe(1);
    // Bugün says it in one sentence; its button opens the business on Lisans.
    await page.reload();
    await page.getByRole('list', { name: 'Bugün yapılacaklar' }).getByRole('listitem').filter({ hasText: 'Elazığ Pilot Kafe hizmeti dondurmak istiyor.' }).getByRole('button', { name: 'İsteği incele' }).click();
    await expect(detailTab(card, 'Lisans')).toHaveAttribute('aria-pressed', 'true');
    await page.route('**/api/merkez/admin/freezes/review', async route => { await route.fetch(); await route.abort('failed'); await page.unroute('**/api/merkez/admin/freezes/review'); });
    await card.getByRole('button', { name: 'Dondurmayı onayla', exact: true }).click();
    await card.getByRole('button', { name: 'Dondurma işlemini yeniden kontrol et', exact: true }).click();
    await expect(card.locator('.freeze-request')).toContainText('Donduruldu');
    await expect(guest.getByText(/dijital menüsü şu anda kullanılamıyor/)).toBeVisible({ timeout: 20000 });
    const frozen = await (await page.request.get(`${ADMIN_API}/state`)).json();
    const business = frozen.businesses.find((b: any) => b.name === 'Elazığ Pilot Kafe');
    expect(frozen.audit.filter((a: any) => a.action === 'freeze.approved' && a.target === business.tenantId)).toHaveLength(1);
    // The café cannot approve or end anything itself: it has no Mola Yönetim account, and its own server has no such route.
    expect((await owner.request.post(`${ADMIN_API}/freezes/end`, { data: { requestId: 'forged-freeze-end', tenantId: business.tenantId, freezeId: business.freezes[0].id } })).status()).toBe(401);
    expect((await owner.request.post(`${kafe.base}/api/platform/freezes/end`, { data: { requestId: 'forged-freeze-end', tenantId: business.tenantId, freezeId: business.freezes[0].id } })).status()).toBe(404);
    await card.getByRole('button', { name: 'Dondurmayı bitir', exact: true }).click();
    await expect(card.locator('.freeze-request')).toContainText('Tamamlandı');
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 20000 });
  } finally { await cafe.close(); await guestContext.close(); await kafe.stop(); }
});
/** The owner's own request context already carries the café's session cookie; the baseURL of the tests is the demo café. */
async function setupRequest(request: import('@playwright/test').APIRequestContext, base: string) {
  const s = await (await request.get(`${base}/api/staff/state`)).json();
  const response = await request.post(`${base}/api/staff/setup`, { data: { requestId: 'pilot-initial-setup', version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: s.changeSeconds, commissionBps: s.commissionBps } });
  if (!response.ok()) throw new Error('Kurulum yapılamadı.');
  return request;
}

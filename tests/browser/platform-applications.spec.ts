import { test, expect } from '@playwright/test';
import { ADMIN_API, applyAt, cleanKafe, cleanPort, detailTab, fillApplication, openYonetim, yonetimGo, yonetimNav, yonetimSettings, yonetimShot, yonetimState } from './helpers';

test('Başvurular: a refusal reaches the café with its reason, the corrected application is approved and the café moves on', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const kafe = await cleanKafe(cleanPort(3));
  try {
    await page.goto(kafe.base);
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await fillApplication(page, 'Yanlış Ad Pastanesi', { taxNumber: '3333333339' });
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurunuz alındı · Onay bekleniyor' })).toBeVisible();
    const admin = await browser.newPage();
    await admin.setViewportSize({ width: 1280, height: 860 });
    await openYonetim(admin);
    // The sidebar counts what waits; Bugün says it in a sentence with one button.
    await expect(yonetimNav(admin).getByRole('button', { name: 'Başvurular', exact: true }).locator('.nav-badge')).toBeVisible();
    const todo = admin.getByRole('list', { name: 'Bugün yapılacaklar' }).getByRole('listitem').filter({ hasText: 'Yanlış Ad Pastanesi' });
    await expect(todo).toContainText('hesap açma başvurusu gönderdi; onay bekliyor.');
    await todo.getByRole('button', { name: 'Başvuruyu incele' }).click();
    await expect(yonetimNav(admin).getByRole('button', { name: 'Başvurular', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(admin.getByRole('heading', { name: 'Başvurular', exact: true })).toBeVisible();
    let card = admin.locator('.application-card').filter({ hasText: 'Yanlış Ad Pastanesi' });
    for (const text of ['Yanlış Ad Pastanesi Gıda Ltd. Şti.', 'Kadıköy', '3333333339', 'Moda Cd. No: 1, Kadıköy / İstanbul', 'zeynep@example.com', 'İlk gönderim']) await expect(card).toContainText(text);
    await expect(card.getByRole('button', { name: '30 günlük denemeyi başlat' })).toHaveClass(/primary/);
    await yonetimShot(admin, 'basvurular.png', info.outputPath('applications.png'));
    await card.getByRole('button', { name: 'Reddet', exact: true }).click();
    await card.getByLabel(/Ret nedeni/).fill('Tabela adı ile ticari unvan uyuşmuyor.');
    await card.getByRole('button', { name: 'Başvuruyu reddet' }).click();
    await expect(admin.getByText('Başvuru reddedildi; neden işletmeye gösterilir.')).toBeVisible();
    // Refused ones wait for the café's correction in their own list below.
    await expect(admin.getByRole('list', { name: 'Reddedilen başvurular' })).toContainText('Yanlış Ad Pastanesi');
    // The café shows the reason by itself and lets the owner correct the same application.
    await expect(page.getByRole('heading', { name: 'Başvurunuz onaylanmadı' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Tabela adı ile ticari unvan uyuşmuyor.')).toBeVisible();
    await page.getByRole('button', { name: 'Bilgileri düzelt ve yeniden gönder' }).click();
    await expect(page.getByLabel('Vergi kimlik no *')).toHaveValue('3333333339');
    await page.getByLabel(/^İşletme adı/).fill('Doğru Ad Pastanesi');
    await page.getByLabel('Ticari unvan *').fill('Doğru Ad Pastanesi Gıda Ltd. Şti.');
    await page.getByRole('button', { name: 'Yeniden gönder' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurunuz alındı · Onay bekleniyor' })).toBeVisible();
    // Still one record; approved from its business page.
    await admin.reload();
    await yonetimGo(admin, 'Başvurular');
    card = admin.getByRole('list', { name: 'Başvurular' }).locator('.application-card').filter({ hasText: 'Doğru Ad Pastanesi' });
    await expect(card).toBeVisible();
    expect((await yonetimState(admin.request)).businesses.filter((b: any) => b.source === 'application')).toHaveLength(1);
    await card.getByRole('button', { name: /Doğru Ad Pastanesi/ }).click();
    const detail = admin.getByRole('region', { name: 'Doğru Ad Pastanesi', exact: true });
    await detailTab(detail, 'Bilgiler').click();
    await expect(detail.getByRole('region', { name: 'Fatura bilgileri' })).toContainText('Doğru Ad Pastanesi Gıda Ltd. Şti.');
    await detailTab(detail, 'Özet').click();
    await detail.getByRole('button', { name: '30 günlük denemeyi başlat' }).click();
    await expect(admin.getByText('Başvuru onaylandı; 30 günlük deneme başladı.', { exact: false })).toBeVisible();
    // A running trial asks nothing more of the vendor.
    await expect(detail.locator('.detail-trial-note')).toContainText('başka onay gerekmez');
    await admin.screenshot({ path: info.outputPath('approved-detail.png') });
    await expect(page.getByRole('heading', { name: 'İşletme sahibi hesabı' })).toBeVisible({ timeout: 15000 });
    await admin.close();
  } finally { await kafe.stop(); }
});

test('Kaydı sil: repeated never-connected records are linked and deleted after a confirm; a connected business cannot be; a self-started trial needs no approval', async ({ page }) => {
  // The owner's case: the same café made two records that never connected.
  await applyAt(page.request, 'mcafe', { taxNumber: '6120069780', machine: 'f'.repeat(64) });
  await applyAt(page.request, 'mcafe', { taxNumber: '9000068418', machine: 'f'.repeat(64) });
  // An older self-started trial (kept for compatibility) reads "onay gerekmez".
  await page.route('**/api/merkez/admin/state', async route => {
    const response = await route.fetch(); if (response.status() !== 200) { await route.fulfill({ response }); return; }
    const body = await response.json(), legacy = body.businesses.find((b: any) => b.source === 'import');
    Object.assign(legacy, { name: 'Eski Deneme Kafe', source: 'trial', kind: 'trial', planMonths: undefined });
    await route.fulfill({ response, json: body });
  });
  await openYonetim(page);
  await yonetimGo(page, 'Başvurular');
  const waiting = page.getByRole('list', { name: 'Başvurular' }).locator('.application-card');
  await expect(waiting).toHaveCount(2);
  // Each card has one "Olası tekrar (n)" line; opened, it names the other records and why, aligned in two columns.
  const repeats = waiting.first().locator('details.application-repeats');
  await expect(repeats.locator('summary')).toHaveText('Olası tekrar (1)');
  await expect(repeats.getByRole('button', { name: /mcafe/ })).toBeHidden();
  await repeats.locator('summary').click();
  const line = repeats.getByRole('listitem').first();
  await expect(line).toContainText(/mcafe.*Aynı bilgisayar, farklı vergi no · Aynı telefon · Aynı e-posta/);
  // The reasons start at the same x on every line (a column), not right after each name.
  const [nameBox, whyBox] = [await line.getByRole('button').boundingBox(), await line.locator('small').boundingBox()];
  expect(whyBox!.x).toBeGreaterThanOrEqual(nameBox!.x + nameBox!.width);
  await waiting.first().locator('.application-name').click();
  let detail = page.getByRole('region', { name: 'mcafe', exact: true });
  await detailTab(detail, 'Bilgiler').click();
  const duplicates = detail.getByRole('region', { name: 'Olası tekrar kayıtlar' });
  await expect(duplicates).toContainText('Aynı bilgisayar'); await expect(duplicates).toContainText('Hiç bağlanmadı');
  // The hint opens the other record.
  await duplicates.getByRole('button', { name: /mcafe/ }).click();
  detail = page.getByRole('region', { name: 'mcafe', exact: true });
  await expect(detailTab(detail, 'Özet')).toHaveAttribute('aria-pressed', 'true');
  await detailTab(detail, 'Lisans').click();
  const danger = detail.getByRole('region', { name: 'Dikkat' });
  await danger.getByRole('button', { name: 'Kaydı sil', exact: true }).click();
  await expect(danger.getByText('“mcafe” kaydı silinsin mi?')).toBeVisible();
  await expect(danger.getByText('Bu işletme hiç bağlanmadı; silinince lisansı ve etkinleştirme bilgisi de silinir.')).toBeVisible();
  await danger.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(danger.getByText('“mcafe” kaydı silinsin mi?')).toHaveCount(0);
  await danger.getByRole('button', { name: 'Kaydı sil', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('delete-confirm.png') });
  await danger.getByRole('button', { name: 'Evet, kaydı sil' }).click();
  // Back on Başvurular (the deleted record was an application), with what happened.
  await expect(detail).toHaveCount(0);
  await expect(page.getByText('“mcafe” kaydı silindi.')).toBeVisible();
  await expect(yonetimNav(page).getByRole('button', { name: 'Başvurular', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(waiting).toHaveCount(1);
  // A connected business: no delete, the way to stop it instead.
  await yonetimGo(page, 'İşletmeler');
  const state = await yonetimState(page.request), connected = state.businesses.find((b: any) => b.source === 'import' && !b.neverConnected);
  expect(connected).toBeTruthy();
  const refused = await page.request.post(`${ADMIN_API}/businesses/delete`, { data: { requestId: 'silme-denemesi-1', tenantId: connected.tenantId } });
  expect(refused.status()).toBe(409);
  await page.locator('.platform-business-row').filter({ hasText: 'Eski Deneme Kafe' }).click();
  detail = page.getByRole('region', { name: 'Eski Deneme Kafe', exact: true });
  await expect(detail.locator('.detail-trial-note')).toContainText('Deneme kendiliğinden başladı; onay gerekmez.');
  await detailTab(detail, 'Lisans').click();
  await expect(detail.getByText('Bu işletme Mola Merkez’e bağlandı. Önce askıya alın, sonra silebilirsiniz.')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Kaydı sil', exact: true })).toHaveCount(0);
  // The history says what was deleted, by name.
  await yonetimSettings(page, 'İşlem geçmişi');
  await expect(page.locator('.platform-audit-list article').filter({ hasText: 'İşletme kaydı silindi' }).first()).toContainText('mcafe · hiç bağlanmamıştı');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

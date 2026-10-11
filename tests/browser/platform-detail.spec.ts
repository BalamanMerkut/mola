import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { applyAt, confirmStepUp, detailTab, enableAdminFactor, openBusiness, openYonetim, yonetimGo, yonetimSettings, yonetimState } from './helpers';

test('one search box (VKN, phone, e-mail, contact), CSV with invoice fields, a repeated tax number waits flagged for the vendor', async ({ page }) => {
  await applyAt(page.request, 'Arama Kafe', { taxNumber: '6120069780', machine: '1'.repeat(64) });
  await applyAt(page.request, 'Tekrar Vergi Kafe', { taxNumber: '6120069780', machine: '2'.repeat(64) });
  await openYonetim(page);
  await yonetimGo(page, 'İşletmeler');
  const search = page.getByRole('searchbox', { name: 'İşletme ara' });
  for (const q of ['6120069780', '0555 111 22 33', 'yetkili@EXAMPLE.com', 'Deneme Yetkili']) { await search.fill(q); await expect(page.locator('.platform-business-row')).toHaveCount(2); }
  await search.fill('9999999999'); await expect(page.getByText('Bu aramaya uygun işletme bulunamadı.')).toBeVisible();
  // Applications are on their own page; a search finds them here too, and the CSV holds what the list shows.
  await search.fill('6120069780');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV indir' }).click();
  const file = await download, csv = readFileSync(await file.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toContain('VKN/TCKN'); expect(csv).toContain('6120069780'); expect(csv).toContain('Arama Kafe Ltd. Şti.');
  // The phone stays text in Excel ("'+90…": a leading + would be a formula or a number), the name carries Türkiye's date.
  expect(csv).toContain(";'+905551112233;");
  expect(file.suggestedFilename()).toBe(`mola-isletmeler-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())}.csv`);
  // The later one with the same number: flagged only here, approved only as a branch.
  await yonetimGo(page, 'Başvurular');
  const card = (name: string) => page.locator('.application-card').filter({ has: page.locator('header .application-name', { hasText: name }) });
  const later = card('Tekrar Vergi Kafe');
  await expect(later).toContainText('Aynı vergi / T.C. kimlik no daha önce başka bir kayıtta kullanılmış');
  await expect(later.getByRole('button', { name: 'Ek şube olarak kabul et' })).toBeVisible();
  await expect(later.getByRole('button', { name: '30 günlük denemeyi başlat' })).toHaveCount(0);
  const earlier = card('Arama Kafe');
  await expect(earlier.getByRole('button', { name: '30 günlük denemeyi başlat' })).toBeVisible();
  await expect(earlier).toContainText('İlk gönderim');
  // The later one accepted first as a branch: the earlier applicant keeps "30 günlük denemeyi başlat" (not flagged by it).
  await later.getByRole('button', { name: 'Ek şube olarak kabul et' }).click();
  await expect(page.getByText('Ek şube olarak kabul edildi; 30 günlük deneme başladı.')).toBeVisible();
  await expect(earlier.getByRole('button', { name: '30 günlük denemeyi başlat' })).toBeVisible();
  await expect(earlier.getByRole('button', { name: 'Ek şube olarak kabul et' })).toHaveCount(0);
  await expect(earlier).not.toContainText('daha önce başka bir kayıtta kullanılmış');
});

test('business detail: vendor note, suspend with a reason, paid plan asks once, licence delivery and the café computer are shown', async ({ page }) => {
  test.setTimeout(90_000);
  await openYonetim(page);
  // "Ödeme alındı" and a package change need two-step login and the Authenticator code (server/merkez/step-up.ts).
  if (await enableAdminFactor(page.request)) await openYonetim(page);
  // The test café registers its computer at its first sync, a moment after the test server starts: wait for it.
  let demo: any;
  await expect.poll(async () => { demo = (await yonetimState(page.request)).businesses.find((b: any) => b.source === 'import' && b.machines?.length); return !!demo; }, { timeout: 20_000 }).toBe(true);
  const dialog = await openBusiness(page, demo.name);
  await dialog.getByRole('region', { name: 'Satıcı notu' }).getByRole('textbox').fill('Ekim sonunda yıllık ödeme yapacak.');
  await dialog.getByRole('button', { name: 'Notu kaydet' }).click();
  await expect(dialog.getByText('Kaydedildi', { exact: true })).toBeVisible();
  // The café computer that holds the licence: on Özet.
  await expect(dialog.getByRole('region', { name: 'Bilgisayarlar' })).toContainText('Etkin');
  await detailTab(dialog, 'Lisans').click();
  await expect(dialog.locator('.license-delivery')).toContainText('Son lisans işletmenin bilgisayarına ulaştı');
  // Extending asks once more on the same button, and only adds time: the yearly plan stays yearly.
  const month = dialog.getByRole('button', { name: '1 ay uzat' });
  const before = (await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === demo.tenantId);
  expect(before.planMonths).toBe(12);
  await expect(dialog.locator('.platform-license-section .section-note').first()).toContainText('Uzatma yalnız süre ekler; plan (yıllık abonelik) ve dondurma hakkı değişmez.');
  await month.click(); await expect(dialog.getByRole('button', { name: 'Emin misiniz? 1 ay eklenir' })).toBeVisible();
  expect((await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === demo.tenantId).endsAt).toBe(before.endsAt);
  await dialog.getByRole('button', { name: 'Emin misiniz? 1 ay eklenir' }).click();
  // "Ödeme alındı" is on: the Authenticator code once, then it is saved by itself (the package change below needs no second code).
  await confirmStepUp(page, 'Ödeme alındı');
  await expect(page.locator('.notice-success')).toContainText('Kaydedildi');
  const extended = (await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === demo.tenantId);
  expect(extended.planMonths).toBe(12); expect(extended.endsAt > before.endsAt).toBe(true);
  // The plan is changed on its own (no time added); here it goes to 6 months and back.
  const plan = dialog.getByRole('group', { name: 'Abonelik planı' });
  await expect(plan.getByRole('button', { name: '1 yıllık (şu anki)' })).toBeDisabled();
  await plan.getByRole('button', { name: '6 aylık plana geç' }).click(); await plan.getByRole('button', { name: 'Emin misiniz? 6 aylık plana geçer' }).click();
  await expect(plan.getByRole('button', { name: '6 aylık (şu anki)' })).toBeDisabled();
  expect((await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === demo.tenantId).endsAt).toBe(extended.endsAt);
  await plan.getByRole('button', { name: '1 yıllık plana geç' }).click(); await plan.getByRole('button', { name: 'Emin misiniz? 1 yıllık plana geçer' }).click();
  await expect(plan.getByRole('button', { name: '1 yıllık (şu anki)' })).toBeDisabled();
  // Suspend (in "Dikkat") needs a reason; it shows on Özet and in the history.
  await dialog.getByRole('region', { name: 'Dikkat' }).getByRole('button', { name: 'Askıya al', exact: true }).click();
  await dialog.getByLabel(/Askıya alma nedeni/).fill('Ödeme gecikti');
  await dialog.locator('.suspend-form').getByRole('button', { name: 'Askıya al' }).click();
  await expect(dialog.locator('.detail-header .status-chip')).toHaveText('Askıda');
  await detailTab(dialog, 'Özet').click();
  await expect(dialog.locator('.detail-trial-note')).toContainText('Askıya alma nedeni: Ödeme gecikti');
  await detailTab(dialog, 'Lisans').click();
  await dialog.getByRole('button', { name: 'Hizmeti aç' }).click();
  await expect(dialog.locator('.detail-header .status-chip')).not.toHaveText('Askıda');
  // Hizmet: another package is only chosen until "Değişikliği uygula" (what changes is shown first in the bar); one press
  // applies it (the Authenticator code's 10 minutes are still open from "Ödeme alındı"; no "Emin misiniz?" step).
  await detailTab(dialog, 'Hizmet').click();
  const cay = dialog.getByRole('radio', { name: /^Çay bahçesi/ });
  await cay.click();
  const confirm = dialog.getByRole('region', { name: 'Değişikliği onayla' });
  await expect(confirm).toContainText('Çay bahçesi');
  expect((await yonetimState(page.request)).businesses.find((b: any) => b.tenantId === demo.tenantId).services.packageName).not.toBe('Çay bahçesi');
  await confirm.getByRole('button', { name: 'Değişikliği uygula' }).click();
  await expect(page.locator('.notice-success')).toContainText('Hizmetler kaydedildi');
  await expect(dialog.locator('.detail-line')).toContainText('Çay bahçesi');
  await expect(dialog.getByRole('radio', { name: /^Çay bahçesi/ })).toHaveAttribute('aria-checked', 'true');
  // Bilgiler: this business's own history.
  await detailTab(dialog, 'Bilgiler').click();
  await expect(dialog.getByRole('region', { name: 'Bu işletmenin geçmişi' })).toContainText('Satıcı notu güncellendi');
  await expect(dialog.getByRole('region', { name: 'Bu işletmenin geçmişi' })).toContainText('İşletmenin hizmet paketi değiştirildi');
  await dialog.getByRole('button', { name: 'İşletmeler listesine dön' }).click();
  await yonetimSettings(page, 'İşlem geçmişi');
  await expect(page.locator('.platform-audit-list')).toContainText('Neden: Ödeme gecikti');
  await expect(page.locator('.platform-audit-list')).toContainText('Satıcı notu güncellendi');
  await expect(page.locator('.platform-audit-list')).toContainText('→');
});

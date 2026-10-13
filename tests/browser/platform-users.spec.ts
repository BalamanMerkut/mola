import { test, expect } from '@playwright/test';
import { MERKEZ, merkezPassword, openYonetim, yonetimGo, yonetimSettings } from './helpers';

/*
 * Ayarlar → Kullanıcılar (13 Ekim): the owner adds a yetkili (two university teachers who look around); the yetkili signs in
 * with their own name, sets their own password, works, and never sees Kullanıcılar; the owner removes them again.
 */
test('Kullanıcılar: the owner adds a yetkili, the yetkili signs in and changes the first password, sees no Kullanıcılar; the owner removes them', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openYonetim(page);
  await yonetimSettings(page, 'Kullanıcılar');
  const panel = page.getByRole('region', { name: 'Kullanıcılar' });
  await expect(panel).toContainText('Henüz yetkili yok');
  await panel.getByLabel('Adı ve soyadı').fill('Prof. Dr. Deneme Hoca');
  await panel.getByLabel('Kullanıcı adı').fill('deneme.hoca');
  const first = await panel.getByLabel('İlk şifre').inputValue();
  expect(first).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  await panel.getByLabel('Kendi (admin) şifreniz').fill('yanlis-sifre');
  await panel.getByRole('button', { name: 'Yetkiliyi ekle' }).click();
  await expect(panel.getByRole('alert')).toContainText('Kendi (admin) şifreniz yanlış');
  await panel.getByLabel('Kendi (admin) şifreniz').fill(merkezPassword());
  await panel.getByRole('button', { name: 'Yetkiliyi ekle' }).click();
  const given = panel.getByRole('status', { name: 'Yeni giriş bilgileri' });
  await expect(given).toContainText('deneme.hoca'); await expect(given).toContainText(first);
  await expect(panel.getByRole('listitem', { name: 'Yetkili Prof. Dr. Deneme Hoca' })).toContainText('İlk girişi bekliyor');
  await page.screenshot({ path: info.outputPath('kullanicilar.png') });

  // The yetkili: own sign-in name, the forced first change, then in; no Kullanıcılar tab, a line about whose account this is.
  const hoca = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await hoca.goto(`${MERKEZ}/`);
  await hoca.getByLabel('Kullanıcı adı', { exact: true }).fill('deneme.hoca');
  await hoca.getByLabel('Şifre', { exact: true }).fill(first);
  await hoca.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  const own = 'HocaKendiSifresi!2026';
  await hoca.getByLabel(/Mevcut yönetici şifresi/).fill(first);
  await hoca.getByLabel(/Yeni yönetici şifresi/).fill(own);
  await hoca.getByLabel(/Yeni şifre tekrar/).fill(own);
  await hoca.getByRole('button', { name: 'Şifreyi değiştir ve oturumları kapat' }).click();
  await hoca.getByLabel('Kullanıcı adı', { exact: true }).fill('deneme.hoca');
  await hoca.getByLabel('Şifre', { exact: true }).fill(own);
  await hoca.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  await hoca.getByRole('button', { name: 'Çıkış yap', exact: true }).waitFor();
  await yonetimGo(hoca, 'İşletmeler');
  await yonetimGo(hoca, 'Ayarlar');
  const tabs = hoca.getByRole('navigation', { name: 'Ayarlar bölümleri' });
  await expect(tabs.getByRole('button', { name: 'Hesap güvenliği', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Kullanıcılar', exact: true })).toHaveCount(0);
  await expect(hoca.getByText(/Yetkili hesabı: Prof\. Dr\. Deneme Hoca/)).toBeVisible();
  await hoca.screenshot({ path: info.outputPath('yetkili-ayarlar.png') });

  // The owner removes them: their session ends.
  await page.reload(); await page.getByRole('button', { name: 'Çıkış yap', exact: true }).waitFor();
  await yonetimSettings(page, 'Kullanıcılar');
  const row = panel.getByRole('listitem', { name: 'Yetkili Prof. Dr. Deneme Hoca' });
  await row.getByRole('button', { name: 'Prof. Dr. Deneme Hoca: sil' }).click();
  await row.getByLabel('Kendi (admin) şifreniz').fill(merkezPassword());
  await row.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(panel).toContainText('Henüz yetkili yok');
  await yonetimGo(hoca, 'İşletmeler');
  await expect(hoca.getByRole('button', { name: 'Giriş yap', exact: true })).toBeVisible({ timeout: 20_000 });
  await hoca.context().close();
});

import { test, expect, type Page } from '@playwright/test';
import { cleanKafe, ensureSetup, fillApplication, openYonetim, yonetimSettings } from './helpers';

const base = Number(process.env.E2E_PORT ?? 3100);
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('Mola ekibi iletişim bilgileri: set in Mola Yönetim → Ayarlar; the café shows them as links while its application waits, when Merkez is unreachable, and on Destek', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const admin = await browser.newPage();
  await openYonetim(admin);
  await yonetimSettings(admin, 'İletişim bilgileri');
  const card = admin.getByRole('region', { name: 'Mola ekibi iletişim bilgileri' });
  await expect(card).toContainText('Henüz kaydedilmedi');
  await card.getByLabel('Telefon', { exact: true }).fill('0850 123 45 67');
  await card.getByLabel('WhatsApp').fill('0532 765 43 21');
  await card.getByLabel('E-posta').fill('destek@mola.example');
  await card.getByLabel('Çalışma saatleri').fill('Hafta içi 09:00–18:00');
  await card.getByLabel(/Web adresi/).fill('http://mola.example');
  await card.getByRole('button', { name: 'İletişim bilgilerini kaydet' }).click();
  await expect(card.getByText('Web adresi https:// ile başlamalı.')).toBeVisible();
  await card.getByLabel(/Web adresi/).fill('https://mola.example/destek');
  // An old answer does not stay over the next try: here the browser itself stops the save (an unfinished e-mail address).
  await card.getByLabel('Telefon', { exact: true }).fill('12');
  await card.getByRole('button', { name: 'İletişim bilgilerini kaydet' }).click();
  await expect(card.getByText('Telefon numarası eksik.')).toBeVisible();
  await card.getByLabel('E-posta').fill('destek@');
  await card.getByLabel('Telefon', { exact: true }).fill('0850 123 45 67');
  await card.getByRole('button', { name: 'İletişim bilgilerini kaydet' }).click();
  expect(await card.getByLabel('E-posta').evaluate(input => (input as HTMLInputElement).validity.valid)).toBe(false);
  await expect(card.getByText('Telefon numarası eksik.')).toHaveCount(0);
  await expect(card.locator('.notice-error')).toHaveCount(0);
  await card.getByLabel('E-posta').fill('destek@mola.example');
  await card.getByRole('button', { name: 'İletişim bilgilerini kaydet' }).click();
  await expect(card.getByText(/Kaydedildi\. Bağlı işletmelere/)).toBeVisible();
  await admin.screenshot({ path: info.outputPath('yonetim-contact.png') });

  // A clean café: while its application waits, the Mola team's contact as phone, WhatsApp and e-mail links.
  const kafe = await cleanKafe(base + 25), root = kafe.root;
  try {
    await page.goto(kafe.base);
    await page.getByRole('button', { name: /Hesap açma başvurusu/ }).click();
    await fillApplication(page, 'İletişim Pastanesi', { taxNumber: '6120069780' });
    await page.getByRole('button', { name: 'Başvuruyu gönder' }).click();
    await expect(page.getByRole('heading', { name: 'Başvurunuz alındı · Onay bekleniyor' })).toBeVisible();
    const contact = page.getByRole('region', { name: 'Sorunuz mu var?' });
    await expect(contact.getByRole('link', { name: '0850 123 45 67' })).toHaveAttribute('href', 'tel:08501234567');
    await expect(contact.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/905327654321');
    await expect(contact.getByRole('link', { name: 'destek@mola.example' })).toHaveAttribute('href', 'mailto:destek@mola.example');
    await expect(contact.getByRole('link', { name: 'mola.example/destek' })).toHaveAttribute('href', 'https://mola.example/destek');
    await expect(contact).toContainText('Hafta içi 09:00–18:00');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('application-contact-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 800 });
  } finally { await kafe.stop(); }

  // The same computer, and now Merkez does not answer: the reason in plain words, "Yeniden dene", and the kept contact.
  const offline = await cleanKafe(base + 26, { root, merkezUrl: `http://127.0.0.1:${base + 98}` });
  try {
    await page.goto(offline.base);
    await expect(page.getByText(/Mola Merkez’e ulaşılamadı: Merkez şu anda yanıt vermiyor/)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Yeniden dene' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sorunuz mu var?' }).getByRole('link', { name: '0850 123 45 67' })).toBeVisible();
    await page.getByRole('button', { name: 'Yeniden dene' }).click();
    await expect(page.getByText(/Mola Merkez’e ulaşılamadı: Merkez şu anda yanıt vermiyor/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('unreachable-contact.png'), fullPage: true });
  } finally { await offline.stop(); }

  // This run's activated demo café: the heartbeat brings it (signed), Destek shows it.
  expect((await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await ensureSetup(page.request);
  await expect.poll(async () => (await (await page.request.get('/api/contact')).json()).contact?.phone ?? '', { timeout: 15000 }).toBe('0850 123 45 67');
  await page.goto('/');
  await page.getByRole('button', { name: 'Destek', exact: true }).click();
  const support = page.getByRole('region', { name: 'Mola ekibine doğrudan ulaşın' });
  await expect(support.getByRole('link', { name: 'destek@mola.example' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('destek-contact.png') });
  await admin.close();
});

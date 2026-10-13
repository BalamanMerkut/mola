import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { MERKEZ, openYonetim, yonetimBell, yonetimGo, yonetimShot } from './helpers';

/*
 * molayazilim.com.tr → "Destek ve İletişim" formu → Mola Merkez → Mola Yönetim → Başvurular → "Web sitesi talepleri".
 * The site is built and served the way Caddy does it (scripts/site-dev.ts: static files, /api/site/* passed to this suite's
 * Mola Merkez with its own Host and Origin). Port: E2E_PORT + 40.
 */
const SITE_PORT = Number(process.env.E2E_PORT ?? 3100) + 40, SITE = `http://127.0.0.1:${SITE_PORT}`;
let server: ChildProcess | undefined;
test.beforeAll(async () => {
  test.setTimeout(120000);
  server = spawn(process.execPath, ['--import', 'tsx', 'scripts/site-dev.ts', '--port', String(SITE_PORT), '--merkez', MERKEZ, '--no-watch'], { stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${SITE}/`)).ok) break; } catch { /* building */ }
    if (i > 400 || server.exitCode !== null) throw new Error('Web sitesi açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
});
test.afterAll(() => { if (server && server.exitCode === null) server.kill(); });

test('web sitesi formu: a café owner asks for a call; Mola Yönetim shows it as a web sitesi talebi (Başvurular, Bugün, zil) and the vendor marks it Arandı', async ({ page, browser }, info) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  // No cookie, no outside request: everything the page loads comes from the site itself.
  const outside: string[] = []; page.on('request', r => { if (!r.url().startsWith(SITE) && !r.url().startsWith('data:')) outside.push(r.url()); });
  await page.goto(`${SITE}/iletisim/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Size nasıl yardım edelim?' })).toBeVisible();
  const form = page.locator('#talep-formu');
  // Required fields are said next to the field, in plain words.
  await form.getByRole('button', { name: /Gönder/ }).click();
  await expect(form.locator('[data-field="business"] .error')).toHaveText('İşletmenizin adını yazın.');
  await form.getByLabel('İşletme adı *').fill('Harput Çay Bahçesi Deneme');
  await form.getByLabel('İlgili kişi *').fill('Mehmet Demir');
  await form.getByLabel('Telefon *').fill('0532 765 43 21');
  // The e-mail is required (13 Ekim): sign-ins and codes go there.
  await form.getByRole('button', { name: /Gönder/ }).click();
  await expect(form.locator('[data-field="email"] .error')).toHaveText('E-posta adresinizi yazın.');
  await form.getByLabel('E-posta *').fill('mehmet@example.com');
  await expect(form.getByLabel('Şehir')).toHaveValue('Elazığ');
  await form.getByLabel(/Masa sayısı/).fill('24');
  await form.getByText('Çay bahçesi', { exact: true }).click();
  await form.getByLabel(/Mesajınız/).fill('Hafta içi öğleden sonra arayabilirsiniz.');
  await form.getByRole('button', { name: /Gönder/ }).click();
  await expect(form.locator('[data-field="consent"] .error')).toContainText('KVKK Aydınlatma Metni');
  await expect(form.getByRole('link', { name: 'KVKK Aydınlatma Metni' })).toHaveAttribute('href', '/kvkk/');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: /Gönder/ }).click();
  await expect(page.getByRole('heading', { name: 'Talebiniz bize ulaştı' })).toBeVisible({ timeout: 15000 });
  expect(await page.context().cookies()).toEqual([]);
  expect(outside).toEqual([]);
  expect(errors).toEqual([]);

  // Mola Yönetim: its own kind on Başvurular, with everything the person wrote and the KVKK tick.
  const vendor = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openYonetim(vendor);
  await expect(vendor.getByRole('list', { name: 'Bugün yapılacaklar' })).toContainText('Web sitesinden 1 talep aranmayı bekliyor.');
  await yonetimGo(vendor, 'Başvurular');
  const kinds = vendor.getByRole('group', { name: 'Başvuru türü' });
  await kinds.getByRole('button', { name: /Web sitesi talepleri/ }).click();
  const card = vendor.getByRole('listitem', { name: 'Harput Çay Bahçesi Deneme · web sitesi talebi' });
  await expect(card).toContainText('Web sitesi talebi');
  await expect(card).toContainText('Yeni');
  await expect(card).toContainText('Çay bahçesi · Elazığ · 24 masa');
  await expect(card).toContainText('Mehmet Demir');
  await expect(card.getByRole('link', { name: '+90 532 765 43 21' })).toHaveAttribute('href', 'tel:+905327654321');
  await expect(card).toContainText('mehmet@example.com');
  await expect(card).toContainText('Hafta içi öğleden sonra arayabilirsiniz.');
  await expect(card).toContainText('kvkk-aydinlatma-');
  await yonetimShot(vendor, 'web-talepleri.png', info.outputPath('web-talepleri.png'), false);
  await card.getByRole('button', { name: 'Arandı' }).click();
  await expect(card).toContainText('Arandı');
  await card.getByRole('button', { name: 'Not ekle' }).click();
  await card.getByLabel(/Not/).fill('Cuma günü kurulum için uğranacak.');
  await card.getByRole('button', { name: 'Notu kaydet' }).click();
  await expect(card).toContainText('Cuma günü kurulum için uğranacak.');
  // "İşletme ekle" starts filled from the lead.
  await card.getByRole('button', { name: 'İşletme ekle' }).click();
  const dialog = vendor.getByRole('dialog', { name: 'İşletme ekle' });
  await expect(dialog.getByLabel('İşletme adı')).toHaveValue('Harput Çay Bahçesi Deneme');
  await expect(dialog.getByLabel(/Yetkili adı/)).toHaveValue('Mehmet Demir');
  await dialog.getByRole('button', { name: 'Vazgeç' }).click();
  // The bell has it as "Web sitesi talebi" (no phone or name in it), opening the list again.
  await yonetimBell(vendor).click();
  const alert = vendor.locator('.alert-list li', { hasText: 'Web sitesi talebi' }).first();
  await expect(alert).toContainText('Çay bahçesi · Elazığ');
  await expect(alert).not.toContainText('Mehmet');
  await alert.getByRole('button', { name: 'Talepleri aç' }).click();
  await expect(vendor.getByRole('heading', { level: 1, name: 'Başvurular' })).toBeVisible();
  await expect(vendor.getByRole('listitem', { name: 'Harput Çay Bahçesi Deneme · web sitesi talebi' })).toContainText('Arandı');
  // İşlem kayıtları has both, without the person.
  const audit = (await (await vendor.request.get(`${MERKEZ}/api/merkez/admin/state`)).json()).audit as { action: string; detail?: string }[];
  expect(audit.map(a => a.action)).toEqual(expect.arrayContaining(['site.lead_received', 'site.lead_called', 'site.lead_note']));
  expect(audit.filter(a => a.action.startsWith('site.')).some(a => /Mehmet|765/.test(a.detail ?? ''))).toBe(false);
  await vendor.close();
});

test('Mola Yönetim’s contact on the site: the cards, the footer, the hours and the WhatsApp buttons take what GET /api/site/iletisim gives; markup in it stays text', async ({ page }, info) => {
  // The answer is set here (this suite's Merkez keeps its own contact for the café specs; the endpoint has its own unit test).
  await page.route('**/api/site/iletisim', r => r.fulfill({ json: { contact: { phone: '0538 049 20 02', whatsapp: '0538 049 20 02', email: 'merkut@example.com', hours: 'Her gün <b>10:00</b>–20:00' } } }));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${SITE}/iletisim/`);
  const list = page.locator('.contact-list');
  await expect(list.getByRole('link', { name: /WhatsApp’tan yazın/ })).toHaveAttribute('href', /^https:\/\/wa\.me\/905380492002\?text=/);
  await expect(list.getByRole('link', { name: /Bizi arayın/ })).toHaveAttribute('href', 'tel:+905380492002');
  await expect(list.getByRole('link', { name: /Bizi arayın/ })).toContainText('0538 049 20 02');
  await expect(list.getByRole('link', { name: /E-posta gönderin/ })).toHaveAttribute('href', 'mailto:merkut@example.com');
  await expect(list).not.toContainText('Numara yakında burada');
  await expect(page.locator('.hours')).toContainText('Her gün <b>10:00</b>–20:00');
  const footer = page.locator('footer');
  await expect(footer.getByRole('link', { name: '0538 049 20 02' })).toHaveAttribute('href', 'tel:+905380492002');
  await expect(footer.getByRole('link', { name: 'merkut@example.com' })).toBeVisible();
  await expect(footer.getByRole('link', { name: 'WhatsApp', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('site-iletisim-merkezden.png'), fullPage: true });
  // Another page: the WhatsApp button of the closing band shows up with the number.
  await page.goto(`${SITE}/`);
  await expect(page.getByRole('link', { name: 'WhatsApp’tan yazın' }).first()).toHaveAttribute('href', /wa\.me\/905380492002/);
  expect(errors).toEqual([]);
});

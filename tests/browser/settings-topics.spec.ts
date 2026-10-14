import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openCash, openFirstSteps, openReport, openSettings, openStaff, openView, reportAction, settingsPageNames, settingsParts, settingsPlaces, settingsTopicNames, settingsTopics, type SettingsPage } from './helpers';

/** Screens for the owner: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
/** A stand-in AudioContext: every started oscillator's frequency lands in window.__notes. */
const fakeAudio = () => {
  (window as any).__notes = [];
  const param = () => ({ value: 0, setValueAtTime(v: number) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  (window as any).AudioContext = class {
    state = 'suspended'; currentTime = 0; sampleRate = 8000; destination = {}; onstatechange = null;
    async resume() { this.state = 'running'; } async close() { this.state = 'closed'; }
    createGain() { return { ...node(), gain: param() }; }
    createOscillator() { const o = { ...node(), type: 'sine', frequency: param(), onended: null, start() { (window as any).__notes.push(o.frequency.value); }, stop() {} }; return o; }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { ...node(), buffer: null, onended: null, start() {} }; }
    createBiquadFilter() { return { ...node(), type: 'lowpass', frequency: param(), Q: param() }; }
  };
};
const login = async (page: Page, username = 'isletme') => { await page.request.post('/api/login', { data: { username, password: 'MolaDemo!2026' } }); };

test('Ayarlar: six topics of one-time settings (Uzaktan erişim the owner\'s own); every setting of the earlier pages is still there (here or in its home); parts, memory and links land right', async ({ page }, info) => {
  test.setTimeout(90000);
  await login(page); await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 860 }); await page.goto('/');
  await openView(page, 'Ayarlar');
  const topics = settingsTopics(page);
  await expect(topics.getByRole('button')).toHaveCount(6);
  for (const [i, name] of settingsTopicNames.entries()) await expect(topics.getByRole('button').nth(i)).toContainText(name);
  await expect(topics.getByRole('button', { name: /^İşletme/ })).toHaveAttribute('aria-current', 'page');
  await expect(topics.getByRole('button', { name: /^Cihazlar/ })).toHaveAttribute('title', /yazıcı/);
  // A centred tab bar in one row at the top; the page sits in the centred column right below it.
  await expect(topics).toHaveClass(/layout-one/);
  // Every topic carries its icon, like Destek's tabs and the parts below (8 Ekim: the owner saw plain words).
  for (const tab of await topics.getByRole('button').all()) await expect(tab.locator('svg')).toBeVisible();
  await shot(page, 'ayar-sekmeler-ikonlu.png', info.outputPath('ayar-sekmeler-ikonlu.png'), false);
  const bar = (await topics.boundingBox())!, body = (await page.locator('.settings-page').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(body.y);
  expect(Math.abs((bar.x + bar.width / 2) - (body.x + body.width / 2))).toBeLessThanOrEqual(2);
  await openSettings(page, 'Sesler');
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, 'ayarlar-5-konu.png', info.outputPath('ayarlar-5-konu.png'), false);

  // Every setting, by its own name, on its page now.
  const visible = (l: ReturnType<Page['getByText']>) => expect(l.first()).toBeVisible();
  const reach: Record<SettingsPage, (p: Page) => Promise<void>> = {
    'İşletme': async p => { await expect(p.locator('.package-card')).toHaveCount(0); await visible(p.getByLabel('İşletme türü', { exact: true })); await visible(p.getByRole('heading', { name: /İşletme görünümü/ })); await visible(p.getByLabel('İşletme adı *')); await visible(p.getByLabel('Logo', { exact: true })); await visible(p.getByText('Renk paleti')); await visible(p.getByLabel('Karşılama başlığı *')); await visible(p.getByLabel('Menü simgesi', { exact: true })); await visible(p.getByText('İngilizce metinler')); await expect(p.getByLabel('Google işletme bağlantısı')).toHaveCount(0); },
    'Sosyal medya': async p => { for (const name of ['Instagram', 'Facebook', 'TikTok', 'X (Twitter)', 'YouTube', 'WhatsApp', 'Web sitesi', 'Google Haritalar', 'Google değerlendirme']) await visible(p.getByLabel(name, { exact: true })); await visible(p.getByRole('heading', { name: /Kalıcı QR kodları/ })); },
    'Paket ve lisans': async p => { await visible(p.locator('.package-card')); await visible(p.getByTestId('package-name')); await visible(p.getByRole('list', { name: 'Paketteki hizmetler' })); await visible(p.getByRole('heading', { name: 'Lisans', exact: true })); await visible(p.getByRole('button', { name: 'Sözleşmeyi oku' })); await expect(p.getByLabel('İşletme türü', { exact: true })).toHaveCount(0); },
    'Masalar ve QR': async p => { await visible(p.getByRole('checkbox', { name: /Masa temizliği takibi/ })); await visible(p.getByRole('button', { name: 'Masa ekle' })); await visible(p.getByRole('button', { name: 'Masa çıkar' })); await visible(p.getByRole('heading', { name: /Masa QR kodları/ })); await visible(p.getByRole('heading', { name: /Tek masanın QR kodunu yenile/ })); await expect(p.locator('.layout-section').first()).toContainText('masa'); await expect(p.getByRole('button', { name: 'Yazdır', exact: true })).toHaveCount(0); },
    'QR kodlarını yazdır': async p => { await visible(p.getByRole('heading', { name: 'QR kodlarını yazdır' })); for (const n of ['6 QR', '12 QR', 'Yazdır']) await visible(p.getByRole('button', { name: n, exact: true })); await visible(p.getByRole('button', { name: /^A6 masa standı/ })); await expect(p.getByRole('heading', { name: /Tek masanın QR kodunu yenile/ })).toHaveCount(0); },
    'Engellenen telefonlar': async p => { await visible(p.getByRole('heading', { name: /Engellenen müşteri telefonları/ })); },
    'Sipariş ve onay': async p => { await visible(p.getByLabel('Ödeme sırası', { exact: true })); await visible(p.getByRole('checkbox', { name: /Müşteri siparişini değiştirip iptal edebilsin/ })); await visible(p.getByLabel('Sipariş değişiklik süresi (saniye)', { exact: true })); await visible(p.getByRole('checkbox', { name: /QR siparişlerinde garson onayı/ })); await expect(p.getByRole('checkbox', { name: /Otomatik onay/ })).toBeDisabled(); await expect(p.getByRole('button', { name: /^Kasa ve ödeme: Kasa ve giderler → Kasa ayarları/ })).toHaveCount(0); },
    'Mutfak': async p => { await visible(p.getByRole('group', { name: 'Mutfak nasıl çalışıyor?' })); },
    'Paket platformları': async p => { await expect(p.locator('.settings-integrations')).toBeVisible(); await expect(p.getByRole('heading', { name: 'Ekran açılamadı' })).toHaveCount(0); await expect(p.locator('.settings-integrations')).not.toBeEmpty(); },
    'Yazıcılar': async p => { await visible(p.getByRole('heading', { name: /Fiş yazıcıları/ })); await visible(p.getByRole('button', { name: /Yazıcı ekle/ })); },
    'Sesler': async p => { for (const event of ['Garson çağrısı', 'Hesap isteme', 'Yeni QR siparişi (onay bekliyor)', 'Mutfağa yeni sipariş', 'Sipariş hazır (garsona)', 'Dış platform siparişi']) await visible(p.getByLabel(`${event} sesi`, { exact: true })); await expect(p.locator('.sound-chip')).toHaveCount(20); await visible(p.getByRole('slider', { name: 'Bu cihazın ses düzeyi' })); },
    'Cihaz bağla': async p => { await visible(p.getByRole('heading', { name: 'Bağlantı ve cihaz kontrolü' })); await visible(p.getByRole('heading', { name: 'Cihaz bağla', exact: true })); await visible(p.getByRole('button', { name: /Ayarlar → Uzaktan erişim/ })); await expect(p.locator('.photo-storage summary')).toContainText('Fotoğraf alanı'); },
    'Yedek': async p => { await visible(p.getByRole('heading', { name: 'Yedek', exact: true })); await visible(p.getByRole('button', { name: /^Açık oturumlar/ })); },
    'Kilit ve güncelleme': async p => { await visible(p.getByRole('heading', { name: /Güncellemeler/ })); await visible(p.getByText('Sahip hesabı otomatik kilit').first()); await visible(p.locator('summary').getByText('Raporlar için telefon kodu', { exact: true })); },
    // One page, no second row: five numbered steps (0.1.22: the devices sign in on the Raporlarım address; nothing to pair here).
    'Uzaktan erişim': async p => { await expect(settingsParts(p, 'Uzaktan erişim')).toHaveCount(0); for (const h of ['1 · Telefon kodu', '2 · E-posta', '3 · Cihazlarınızı bağlayın', '4 · Uzaktan yönetim', '5 · Eşleşmiş cihazlar']) await visible(p.getByRole('heading', { name: h })); await visible(p.getByText('Telefonunuzda ve laptopunuzda bu adresi açın, e-posta, şifre ve telefon kodunuzla giriş yapın.')); await expect(p.getByText('Bu ekranı şu an telefonunuzdan mı açtınız?')).toHaveCount(0); await expect(p.getByRole('button', { name: /eşleştir/i })).toHaveCount(0); },
  };
  expect(Object.keys(reach).sort()).toEqual([...settingsPageNames].sort());
  for (const name of settingsPageNames) {
    await openSettings(page, name);
    const [topic] = settingsPlaces[name];
    await expect(topics.getByRole('button', { name: new RegExp(`^${topic}`) })).toHaveAttribute('aria-current', 'page');
    await reach[name](page);
  }
  // What left Ayarlar (10 Ekim) lives in its home, each with the same settings; the old name opens the new place.
  const moved: [string, (p: Page) => Promise<void>][] = [
    ['Kasa ayarları', async p => { await visible(p.getByLabel('Kapanış saati', { exact: true })); await visible(p.getByLabel('Not isteyen fark (TL)', { exact: true })); await visible(p.getByRole('checkbox', { name: /Kart bahşişini kasadan nakit öde/ })); await openCash(p, 'Kasa ayarları', 'Kart ve yazar kasa'); await visible(p.getByLabel('POS komisyon oranı (%)', { exact: true })); await visible(p.getByRole('checkbox', { name: /^Yazar kasa yardımcısı/ })); await openCash(p, 'Kasa ayarları', 'Kasiyer yetkileri'); for (const label of ['Kasiyerin yapabileceği en yüksek iade (TL)', 'Tek seferde (TL)', 'Gün içinde toplam (TL)']) await visible(p.getByLabel(label, { exact: true })); await openCash(p, 'Kasa ayarları', 'Gün sonu'); }],
    ['Vardiya ve bahşiş', async p => { await visible(p.getByRole('checkbox', { name: /Vardiya takibi/ })); await openStaff(p, 'Personel ayarları', 'Bahşiş'); await visible(p.getByRole('group', { name: 'Bahşiş dağıtımı' })); await openStaff(p, 'Personel ayarları', 'Garson ataması'); await visible(p.getByText('Garson ataması').first()); await openStaff(p, 'Personel ayarları', 'Vardiya'); }],
    ['Giderler', async p => { await visible(p.getByRole('heading', { name: /Otomatik giderler/ })); await visible(p.getByRole('button', { name: /Otomatik gider ekle/ })); }],
    ['KDV oranları', async p => { await visible(p.getByRole('heading', { name: 'KDV oranları' })); }],
    ['Rezervasyon', async p => { await visible(p.getByRole('heading', { name: /^Rezervasyon/ })); await visible(p.getByText('Kasiyer rezervasyon yazabilir')); await visible(p.getByText('Garson rezervasyon yazabilir')); }],
  ];
  for (const [name, check] of moved) { await openSettings(page, name); await check(page); }
  // Düşük kâr uyarısı: Satış ve Raporlar → Kârlılık → "Uyarı sınırları"; e-posta raporları: "Raporları gönder".
  await openView(page, 'Satış ve Raporlar'); await openReport(page, 'Kârlılık');
  await page.getByRole('button', { name: 'Uyarı sınırları' }).click();
  await visible(page.getByRole('dialog', { name: 'Düşük kâr uyarı sınırları' }).getByRole('heading', { name: /Düşük kâr uyarısı/ }));
  await page.keyboard.press('Escape');
  await reportAction(page, 'Raporları gönder');
  await visible(page.getByRole('dialog', { name: 'Raporları gönder' }).getByRole('heading', { name: /E-posta hesabı/ }));
  await page.keyboard.press('Escape');
  // No jargon left in Güvenlik: the words the owner asked to replace are gone from the page (help texts may name the app).
  for (const part of ['Yedek', 'Kilit ve güncelleme'] as const) {
    await openSettings(page, part);
    const securityText = await page.locator('.settings-page-body').innerText();
    for (const word of ['Authenticator', 'IP engeli', 'BitLocker', 'tarayıcı kaydı']) expect(securityText, `${part}: ${word}`).not.toContain(word);
  }
  // Waiter approval switched on here makes "Otomatik onay" usable on the same page.
  await openSettings(page, 'Sipariş ve onay');
  await page.getByRole('checkbox', { name: /QR siparişlerinde garson onayı/ }).check();
  await expect(page.getByText('Ayarlar kaydedildi.', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Otomatik onay/ })).toBeEnabled();
  // Quiet states sit in the page's head; the tab carries a chip only for what needs a look ("Eksik" below).
  await expect(page.locator('.settings-page-state')).toHaveText('Onay açık');
  await page.request.post('/api/staff/settings', { data: { waiterApproval: false, changeSeconds: 60, commissionBps: null } });

  // Remembered per device: the topic, and in each topic its part.
  await openSettings(page, 'Mutfak');
  await openSettings(page, 'Yazıcılar');
  await page.reload();
  await openView(page, 'Ayarlar');
  await expect(topics.getByRole('button', { name: /^Cihazlar/ })).toHaveAttribute('aria-current', 'page');
  await expect(settingsParts(page, 'Cihazlar').getByRole('button', { name: /^Yazıcılar/ })).toHaveAttribute('aria-current', 'page');
  const printers = (await (await page.request.get('/api/staff/printers')).json()).printers.length;
  if (!printers) { await expect(topics.getByRole('button', { name: /^Cihazlar/ })).toContainText('Eksik'); await expect(settingsParts(page, 'Cihazlar').getByRole('button', { name: /^Yazıcılar/ })).toContainText('Eksik'); }
  await topics.getByRole('button', { name: /^Sipariş ve mutfak/ }).click();
  await expect(settingsParts(page, 'Sipariş ve mutfak').getByRole('button', { name: /^Mutfak/ })).toHaveAttribute('aria-current', 'page');
  // A device that remembered a topic of the earlier Ayarlar (ten, then six topics) opens its new place, without an error.
  for (const [old, topic, part] of [['sounds', 'Cihazlar', 'Sesler'], ['print', 'Cihazlar', 'Yazıcılar'], ['cash', 'Sipariş ve mutfak', 'Sipariş ve onay'], ['devices', 'Cihazlar', 'Yazıcılar'], ['other', 'Güvenlik ve yedek', 'Yedek'], ['expenses', 'İşletme', 'Görünüm'], ['integrations', 'Sipariş ve mutfak', 'Paket platformları'], ['tables', 'Masalar ve QR', 'Masalar ve QR']] as const) {
    await page.evaluate(v => { localStorage.setItem('mola-settings-topic', v); localStorage.setItem('mola-settings-part', JSON.stringify({ orders: 'cash', tables: 'reservations', business: 'reports', other: 'security' })); }, old);
    await page.reload(); await openView(page, 'Ayarlar');
    await expect(topics.getByRole('button', { name: new RegExp(`^${topic}`) })).toHaveAttribute('aria-current', 'page');
    await expect(settingsParts(page, topic).getByRole('button', { name: new RegExp(`^${part}`) })).toHaveAttribute('aria-current', 'page');
  }
  // The part remembered under an earlier topic lands on its new page (10 Ekim son kullanıcı testi: the topic's first part).
  for (const [old, parts, topic, part] of [['print', { print: 'sounds' }, 'Cihazlar', 'Sesler'], ['other', { other: 'devices' }, 'Cihazlar', 'Cihaz bağla'], ['other', { other: 'integrations' }, 'Sipariş ve mutfak', 'Paket platformları']] as const) {
    await page.evaluate(([v, p]) => { localStorage.setItem('mola-settings-topic', v); localStorage.setItem('mola-settings-part', JSON.stringify(p)); }, [old, parts] as const);
    await page.reload(); await openView(page, 'Ayarlar');
    await expect(topics.getByRole('button', { name: new RegExp(`^${topic}`) })).toHaveAttribute('aria-current', 'page');
    await expect(settingsParts(page, topic).getByRole('button', { name: new RegExp(`^${part}`) })).toHaveAttribute('aria-current', 'page');
  }
  // Güvenlik ve yedek → Telefonum (until 0.1.20) opens Uzaktan erişim.
  await page.evaluate(() => { localStorage.setItem('mola-settings-topic', 'security'); localStorage.setItem('mola-settings-part', JSON.stringify({ security: 'phone' })); });
  await page.reload(); await openView(page, 'Ayarlar');
  await expect(topics.getByRole('button', { name: /^Uzaktan erişim/ })).toHaveAttribute('aria-current', 'page');
  // Links from elsewhere: İlk adımlar' "Yazıcı bağla" lands on Yazıcılar, "QR kodlarına git" on the QR card (when those steps show).
  await openView(page, 'Masalar');
  const steps = page.locator('.first-steps');
  await openFirstSteps(page);
  if (await steps.getByRole('button', { name: 'Yazıcı bağla' }).count()) {
    await openSettings(page, 'İşletme'); await openView(page, 'Masalar'); await openFirstSteps(page);
    await steps.getByRole('button', { name: 'Yazıcı bağla' }).click();
    await expect(settingsParts(page, 'Cihazlar').getByRole('button', { name: /^Yazıcılar/ })).toHaveAttribute('aria-current', 'page');
    await openView(page, 'Masalar'); await openFirstSteps(page);
  }
  if (await steps.getByRole('button', { name: 'QR kodlarına git' }).count()) {
    await steps.getByRole('button', { name: 'QR kodlarına git' }).click();
    await expect(topics.getByRole('button', { name: /^Masalar ve QR/ })).toHaveAttribute('aria-current', 'page');
    await expect(settingsParts(page, 'Masalar ve QR').getByRole('button', { name: /^QR kodlarını yazdır/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.qr-codes-card')).toBeVisible();
  }
});
test('Sesler: the owner picks a sound per event; it is kept on the server and a waiter tablet plays it', async ({ page, browser }, info) => {
  await page.addInitScript(fakeAudio);
  await login(page); await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openSettings(page, 'Sesler');
  const select = page.getByLabel('Garson çağrısı sesi', { exact: true });
  await expect(select).toHaveValue('dingdong');
  // 10 Ekim: "Bildirim sesi" (a new notification on the bell) starts off, and is not counted as a sound switched off.
  await expect(page.getByRole('checkbox', { name: 'Bildirim sesi açık' })).not.toBeChecked();
  await expect(page.getByLabel('Bildirim sesi', { exact: true })).toHaveValue('nazik');
  await expect(page.locator('.settings-page-state')).toHaveText('Sesler açık');
  await page.getByRole('button', { name: 'Garson çağrısı sesini dinle' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__notes)).toEqual([784, 587]);
  await select.selectOption({ label: 'Kuş' });
  await expect.poll(async () => (await (await page.request.get('/api/staff/sounds')).json()).waiterCall).toEqual({ sound: 'kus', on: true });
  await page.getByRole('checkbox', { name: 'Hesap isteme sesi açık' }).uncheck();
  await expect.poll(async () => (await (await page.request.get('/api/staff/sounds')).json()).billRequest.on).toBe(false);
  await expect(page.locator('.settings-page-state')).toHaveText('1 ses kapalı');
  // This device's volume stays on this device only.
  await page.getByRole('slider', { name: 'Bu cihazın ses düzeyi' }).fill('50');
  expect(await page.evaluate(() => localStorage.getItem('mola-sound-volume'))).toBe('0.5');
  await page.evaluate(() => { (window as any).__notes = []; });
  await page.getByRole('button', { name: 'Gong sesini dinle' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__notes[0])).toBe(196);
  // Tall windows instead of full-page captures: the fixed menus would otherwise sit in the middle of the picture.
  await page.setViewportSize({ width: 1280, height: 1560 });
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, 'ayarlar-sesler.png', info.outputPath('ayarlar-sesler.png'), false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 2600 });
  await shot(page, 'ayarlar-sesler-telefon.png', info.outputPath('ayarlar-sesler-telefon.png'), false);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Kept on the server: a reload shows the same choice.
  await page.reload();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Ayarlar', exact: true }).click();
  await expect(page.getByLabel('Garson çağrısı sesi', { exact: true })).toHaveValue('kus');

  // A waiter's tablet plays the chosen sound for a waiter call, and nothing for the switched-off bill request.
  const state = await (await page.request.get('/api/staff/state')).json();
  const staff = await browser.newContext(), waiter = await staff.newPage();
  await waiter.addInitScript(fakeAudio);
  await waiter.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } });
  await waiter.goto('/');
  await waiter.locator('.sidebar nav').getByRole('button', { name: /Sipariş al/ }).click(); // a tap unlocks sound
  const guest = await browser.newContext({ viewport: { width: 375, height: 812 } }), menu = await guest.newPage();
  await menu.goto(`/m/${state.tables[1].token}`);
  await menu.getByRole('button', { name: 'Garson çağır' }).click();
  await expect(waiter.locator('.service-call-chip')).toHaveCount(1);
  await expect.poll(() => waiter.evaluate(() => (window as any).__notes)).toEqual([2200, 2200, 2200, 2700]);
  await guest.close(); await staff.close();
  await page.request.post('/api/staff/sounds', { data: { event: 'waiterCall', sound: 'dingdong' } });
  await page.request.post('/api/staff/sounds', { data: { event: 'billRequest', on: true } });
});

﻿test('Ayarlar fits phones, tablets (both ways) and the desktop: one row of topics where there is room, no sideways scroll', async ({ page }, info) => {
  // 7 sizes × 15 pages, each checked for overflow, 44 px targets and (since 8 Ekim) the topic icons.
  test.setTimeout(120000);
  await login(page); await ensureSetup(page.request);
  await page.goto('/');
  await openView(page, 'Ayarlar');
  const sizes = [[360, 800], [390, 844], [768, 1024], [1024, 768], [820, 1180], [1180, 820], [1280, 800]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const name of settingsPageNames) {
      await openSettings(page, name);
      await page.waitForTimeout(50);
      const wide = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: innerWidth }));
      expect(wide.page, `${name} ${width}×${height}`).toBeLessThanOrEqual(wide.view);
      // The rows may slide sideways inside themselves (phones), never the page; the chosen tab is in view; 44 px targets.
      for (const row of await page.locator('.settings-layout .pill-tabs').all()) {
        const heights = await row.getByRole('button').evaluateAll(list => list.map(b => b.getBoundingClientRect().height));
        for (const h of heights) expect(h, `${name} ${width}×${height}`).toBeGreaterThanOrEqual(44);
        const shown = await row.evaluate(r => { const box = r.getBoundingClientRect(), a = r.querySelector('[aria-current="page"]')!.getBoundingClientRect(); return a.left >= box.left - 1 && a.right <= box.right + 1; });
        expect(shown, `${name} ${width}×${height}`).toBe(true);
      }
    }
    // One row of topics on the computer and a turned tablet (and an upright 820 tablet); phones slide in one row.
    const rows = await settingsTopics(page).getByRole('button').evaluateAll(list => new Set(list.map(b => Math.round(b.getBoundingClientRect().top))).size);
    // An upright tablet (768/820, beside the sidebar) may use two rows.
    expect(rows, `${width}×${height}`).toBeLessThanOrEqual(width >= 700 && width < 900 ? 2 : 1);
    if (width >= 1024) await expect(settingsTopics(page), `${width}`).toHaveClass(/layout-one/);
    // Icons stay at every width (above the word where the bar is narrow).
    for (const tab of await settingsTopics(page).getByRole('button').all()) expect(await tab.locator('svg').evaluate(s => getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().width > 0), `icon ${width}`).toBe(true);
    if (width === 390 || width === 1024) await shot(page, `ayarlar-${width}.png`, info.outputPath(`ayarlar-${width}.png`), false);
  }
});
test('Sesler: a delivery platform order plays the "Dış platform siparişi" sound in the kitchen, once (waiting, then accepted)', async ({ page, browser }) => {
  await login(page); await ensureSetup(page.request);
  expect((await page.request.post('/api/staff/sounds', { data: { event: 'externalOrder', sound: 'retro' } })).ok()).toBe(true);
  expect((await page.request.post('/api/staff/integrations/settings', { data: { platform: 'test', enabled: true } })).ok()).toBe(true);
  const staff = await browser.newContext(), kitchen = await staff.newPage();
  await kitchen.addInitScript(fakeAudio);
  await kitchen.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await kitchen.goto('/');
  await expect(kitchen.getByRole('button', { name: 'Sipariş sesini kapat' })).toBeVisible();
  const sent = await (await page.request.post('/api/staff/integrations/test-order', { data: { requestId: 'sound-platform-order-1' } })).json();
  await expect.poll(() => kitchen.evaluate(() => (window as any).__notes)).toEqual([988, 1319]);
  // Accepted: the order reaches the kitchen board with `external`; the same platform order does not ring again.
  const waiting = (await (await page.request.get('/api/staff/state')).json()).externalOrders.find((e: any) => e.externalId === sent.externalId);
  expect((await page.request.post('/api/staff/integrations/orders/accept', { data: { requestId: 'sound-platform-accept-1', id: waiting.id, version: waiting.version } })).ok()).toBe(true);
  await expect(kitchen.locator('.kitchen-card')).not.toHaveCount(0);
  await kitchen.waitForTimeout(2500);
  expect(await kitchen.evaluate(() => (window as any).__notes)).toEqual([988, 1319]);
  await staff.close();
  await page.request.post('/api/staff/integrations/settings', { data: { platform: 'test', enabled: false } });
  await page.request.post('/api/staff/sounds', { data: { event: 'externalOrder', sound: 'acil' } });
});

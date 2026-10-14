import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ensureSetup, openReport, openSettings, reportGroupOf, reportGroups, reportTabs, settingsPageNames, type ReportTab, type SettingsPage } from './helpers';
import { businessDay } from '../../packages/domain/business-day';
/** The day number of a month's last day ('2026-10-06' → '31'), to tell whether today closes its month. */
const lastOfMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).toISOString().slice(8, 10);

/** Screens for the owner: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
const login = async (page: Page) => { await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request); };
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const files: Record<SettingsPage, string> = { 'İşletme': 'isletme', 'Paket ve lisans': 'isletme-paket-lisans', 'Sosyal medya': 'sosyal-medya', 'Masalar ve QR': 'masalar-qr', 'QR kodlarını yazdır': 'qr-yazdir', 'Engellenen telefonlar': 'engellenen-telefonlar', 'Sipariş ve onay': 'siparis-onay', 'Mutfak': 'mutfak', 'Paket platformları': 'paket-platformlari', 'Yazıcılar': 'yazicilar', 'Sesler': 'sesler-sayfa', 'Kafe içi cihazlar': 'cihazlar', 'Yedek': 'yedek', 'Kilit ve güncelleme': 'kilit-guncelleme', 'Uzaktan erişim': 'uzaktan-erisim' };

/** A year of synthetic sales (weekends busier, a slow winter), in the server's overview shape. */
function syntheticOverview(from: string, to: string) {
  const end = Date.parse('2026-10-04T12:00:00Z'), count = from === 'all' ? 900 : Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const days = Array.from({ length: count }, (_, k) => { const i = count - 1 - k, d = new Date(end - i * 86400000), weekend = [0, 6].includes(d.getUTCDay()); return { day: d.toISOString().slice(0, 10), sales: Math.round((900000 + 350000 * Math.sin(i / 29) + (weekend ? 450000 : 0)) * (0.85 + 0.3 * ((i * 7919) % 13) / 13)) }; });
  const daily = days.length > 400 ? [...days.reduce((m, d) => m.set(d.day.slice(0, 7), (m.get(d.day.slice(0, 7)) ?? 0) + d.sales), new Map<string, number>())].map(([day, sales]) => ({ day, sales })) : days;
  const sales = days.reduce((n, d) => n + d.sales, 0);
  return { range: { from: days[0].day, to: days.at(-1)!.day, days: days.length }, sales, cash: Math.round(sales * 0.38), card: sales - Math.round(sales * 0.38), posCommission: Math.round(sales * 0.012), expenses: 4500000 * Math.ceil(count / 30), refunds: 0, kept: sales - Math.round(sales * 0.012) - 4500000 * Math.ceil(count / 30),
    previous: from === 'all' ? null : { from: '2025-10-05', to: '2025-11-03', sales: Math.round(sales * 0.92), kept: 0 }, daily, openAccounts: 128000,
    topProducts: [{ id: 'a', name: 'Türk Kahvesi', qty: 54 * count, amount: 54 * count * 8000 }, { id: 'b', name: 'Demleme Çay', qty: 91 * count, amount: 91 * count * 2500 }, { id: 'c', name: 'San Sebastian Cheesecake', qty: 18 * count, amount: 18 * count * 18000 }, { id: 'd', name: 'Limonata', qty: 22 * count, amount: 22 * count * 9000 }],
    hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, sales: h >= 8 && h <= 23 ? 40000 * count * (1 + Math.sin((h - 8) / 3) ** 2) : 0, orders: h >= 8 && h <= 23 ? Math.round(12 * count * (1 + Math.sin((h - 8) / 3) ** 2)) : 0 })),
    orders: 140 * count, closedAccounts: 95 * count, averageAccount: Math.round(sales / (95 * count)), cancelled: { count: 2 * count, amount: 2 * count * 6000 }, channels: [{ id: 'salon', name: 'Salon / QR', orders: 110 * count, amount: Math.round(sales * 0.8) }, { id: 'masasiz', name: 'Masasız', orders: 30 * count, amount: Math.round(sales * 0.2) }] };
}

test('Ayarlar pages: cards, rows and controls fit every width; the Turkish file picker chooses, crops and removes a logo', async ({ page }, info) => {
  // 15 full-page captures and 6 widths × 15 pages: more than the default 30 s on a busy computer.
  test.setTimeout(120000);
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  // Polished pages: every page is a column of cards with an icon tile and a heading, no raw file input in sight.
  await openSettings(page, 'İşletme');
  const picker = page.locator('.file-picker');
  await expect(picker).toContainText('Henüz logo yok');
  await expect(picker.getByText('Logo seç', { exact: true })).toBeVisible();
  expect(await page.getByLabel('Logo', { exact: true }).evaluate(i => getComputedStyle(i).opacity)).toBe('0');
  const logo = await sharp({ create: { width: 200, height: 200, channels: 4, background: '#234f41' } }).png().toBuffer();
  await page.getByLabel('Logo', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
  await page.getByRole('button', { name: 'Logoyu kullan', exact: true }).click();
  await expect(picker.getByAltText('Logo önizlemesi')).toBeVisible();
  await expect(picker.getByText('Başka logo seç', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-save-bar')).toContainText('Kaydedilmemiş değişiklikler var.');
  await picker.getByRole('button', { name: 'Kaldır', exact: true }).click();
  await expect(picker).toContainText('Henüz logo yok');

  for (const name of settingsPageNames) {
    await openSettings(page, name);
    await expect(page.locator('.settings-page .settings-card, .settings-page .settings-card-fold, .settings-page .settings-integrations').first()).toBeVisible();
    // Every card head carries its icon tile and a heading.
    for (const head of await page.locator('.settings-page .settings-card-head').all()) await expect(head.locator('h3')).toHaveCount(1);
    await page.waitForTimeout(150);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await shot(page, `ayarlar-${files[name]}.png`, info.outputPath(`ayarlar-${files[name]}.png`), true);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  for (const [width, height] of [[360, 780], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    for (const name of settingsPageNames) {
      await openSettings(page, name);
      await page.waitForTimeout(60);
      expect(await fits(page), `${name} ${width}×${height}`).toBe(true);
      // Buttons, selects and switches are finger-sized.
      const small = await page.locator('.settings-page').evaluate(root => [...root.querySelectorAll<HTMLElement>('.settings-card .btn, .settings-page select, .settings-segmented button, .settings-toggle input')].filter(e => e.offsetParent && e.getBoundingClientRect().height < 27).map(e => e.textContent || e.tagName));
      expect(small, `${name} ${width}×${height}`).toEqual([]);
    }
    if (width === 390) { await openSettings(page, 'Giderler'); await shot(page, 'ayarlar-giderler-telefon.png', info.outputPath('ayarlar-giderler-telefon.png'), true); }
  }
});

test('Otomatik giderler: added in Ayarlar → Giderler, recorded today, shown as "Otomatik" in Satış ve Raporlar with its rule, and notified', async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await openSettings(page, 'Giderler');
  await expect(page.locator('.settings-empty')).toContainText('Henüz otomatik gider yok');
  await page.getByRole('button', { name: 'Otomatik gider ekle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Otomatik gider ekle' });
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog.getByText('Gidere bir ad verin (ör. Kira).')).toBeVisible();
  await dialog.getByLabel('Gider adı *').fill('Kira');
  await dialog.getByLabel('Tutar (TL) *').fill('15000');
  await dialog.getByRole('button', { name: 'Havale / EFT', exact: true }).click();
  // Every 31st: the short-month rule is said before saving.
  await dialog.getByLabel('Ayın kaçında?').selectOption('31');
  await expect(dialog).toContainText('31 çekmeyen aylarda ayın son günü kaydedilir');
  // Today's day of the month: recorded at once.
  // The business day (it turns at 05:00 Türkiye, like the gün sonu kasası): after midnight it is still the evening's date.
  const today = new Date(Date.now() + 3 * 3600_000 - 5 * 3600_000).toISOString().slice(0, 10);
  await dialog.getByLabel('Ayın kaçında?').selectOption(String(Number(today.slice(8))));
  await expect(dialog.locator('.recurring-preview')).toContainText('Sonraki kayıtlar: bugün');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.recurring-row')).toHaveCount(1);
  await expect(page.locator('.recurring-row')).toContainText('Kira');
  await expect(page.locator('.recurring-row')).toContainText('Havale / EFT');
  await expect(page.getByText(/Bugünün gideri de kaydedildi/)).toBeVisible();
  // A second, weekly cash one (paused): listed as "Durduruldu", nothing recorded.
  await page.getByRole('button', { name: 'Otomatik gider ekle' }).click();
  const second = page.getByRole('dialog', { name: 'Otomatik gider ekle' });
  await second.getByLabel('Gider adı *').fill('Temizlik');
  await second.getByLabel('Tutar (TL) *').fill('750');
  await second.getByRole('button', { name: 'Nakit', exact: true }).click();
  await second.getByRole('button', { name: 'Her hafta', exact: true }).click();
  await second.getByRole('button', { name: 'Pazartesi', exact: true }).click();
  await second.getByRole('checkbox', { name: 'Aktif' }).uncheck();
  await second.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.locator('.recurring-row')).toHaveCount(2);
  await expect(page.locator('.recurring-row').filter({ hasText: 'Temizlik' })).toContainText('Durduruldu');
  await page.setViewportSize({ width: 1280, height: 1100 });
  await shot(page, 'ayarlar-giderler-kurallar.png', info.outputPath('ayarlar-giderler-kurallar.png'), true);

  await page.locator('.sidebar nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await openReport(page, 'Giderler');
  const row = page.locator('.expense-table tbody tr').filter({ hasText: 'Kira' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.expense-auto-badge')).toHaveText('Otomatik');
  await expect(row).toContainText('Havale / EFT');
  await shot(page, 'satis-raporlar-giderler.png', info.outputPath('satis-raporlar-giderler.png'));
  // The link opens the rule right here.
  await row.getByRole('button', { name: 'Kira kuralı' }).click();
  await expect(page.getByRole('dialog', { name: 'Otomatik gideri düzenle' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Otomatik gideri düzenle' }).getByRole('button', { name: 'Vazgeç', exact: true }).click();
  // The recorded one is corrected like any expense; it says where it came from.
  await row.getByRole('button', { name: 'Kira giderini düzelt' }).click();
  await expect(page.getByRole('dialog', { name: 'Gideri düzelt' })).toContainText('Otomatik giderler\'deki bir kuralla kaydedildi');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Gideri düzelt' })).toHaveCount(0);
  for (const width of [360, 390]) { await page.setViewportSize({ width, height: 844 }); expect(await fits(page), `Giderler ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 900 });
  // Bildirimler (the bell).
  const inbox = await (await page.request.get('/api/staff/notifications')).json();
  expect(inbox.items.map((n: any) => n.title)).toContain('Otomatik gider kaydedildi: Kira');
});

test('Satış ve Raporlar: four groups over their reports (remembered, fit 360–1280); Yıl and Tümü draw monthly bars (no 365 day bars), every block fits', async ({ page }, info) => {
  test.setTimeout(120000);
  await login(page);
  await page.route('**/api/staff/reports/overview?*', route => { const q = new URL(route.request().url()).searchParams; return route.fulfill({ json: syntheticOverview(q.get('from')!, q.get('to')!) }); });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await page.locator('.sidebar nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  // Top: the four groups in the shared pill bar; under it the chosen group's reports, quieter (smaller, no capsule).
  const groups = reportGroups(page), tabs = reportTabs(page);
  await expect(groups).toHaveClass(/pill-tabs/);
  await expect(groups.getByRole('button')).toHaveText(['Satış', 'Personel', 'Rezervasyon']);
  await expect(groups.getByRole('button', { name: 'Satış', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('button')).toHaveText(['Özet', 'Ürünler', 'Kârlılık', 'Kampanyalar']);
  await expect(tabs.getByRole('button', { name: 'Özet', exact: true })).toHaveAttribute('aria-current', 'page');
  const look = await page.evaluate(() => { const main = document.querySelector<HTMLElement>('[data-report-group="sales"]')!, sub = document.querySelector<HTMLElement>('[data-report-tab="summary"]')!; return { main: parseFloat(getComputedStyle(main).fontSize), sub: parseFloat(getComputedStyle(sub).fontSize), subBar: getComputedStyle(sub.parentElement!).backgroundColor, subHeight: sub.getBoundingClientRect().height, subIcons: sub.parentElement!.querySelectorAll('svg').length }; });
  expect(look.sub).toBeLessThan(look.main); expect(look.subBar).toBe('rgba(0, 0, 0, 0)'); expect(look.subHeight).toBeGreaterThanOrEqual(44); expect(look.subIcons).toBe(0);
  const period = page.getByRole('group', { name: 'Dönem' });
  const card = page.locator('.daily-card');
  await period.getByRole('button', { name: '30 gün', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Günlük satış' })).toBeVisible();
  await expect(card.locator('.daily-bars button')).toHaveCount(30);
  await shot(page, 'satis-raporlar-gruplar.png', info.outputPath('satis-raporlar-gruplar.png'));
  await page.setViewportSize({ width: 1280, height: 1500 });
  await shot(page, 'satis-raporlar-30gun.png', info.outputPath('satis-raporlar-30gun.png'));
  await page.setViewportSize({ width: 1280, height: 900 });
  // About three months: weekly bars.
  await period.locator('summary').click();
  await page.getByLabel('Başlangıç').fill('2026-07-06'); await page.getByLabel('Bitiş').fill('2026-10-04');
  await page.getByRole('button', { name: 'Göster', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Haftalık satış' })).toBeVisible();
  await expect(card.locator('.daily-bars button')).toHaveCount(13);
  // "Yıl": this calendar year up to today, one bar a month (partial months marked), a tip on hover with the month. The
  // synthetic answer covers as many days as the year so far, ending on its own fixed day.
  const today = businessDay(Date.now()), synthetic = syntheticOverview(`${today.slice(0, 4)}-01-01`, today).daily as { day: string }[];
  const months = new Set(synthetic.map(d => d.day.slice(0, 7))).size, partial = (synthetic[0].day.endsWith('-01') ? 0 : 1) + (synthetic.at(-1)!.day.slice(8) === lastOfMonth(synthetic.at(-1)!.day) ? 0 : 1);
  await period.getByRole('button', { name: 'Yıl', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(period.getByRole('button', { name: `Yıl: ${today.slice(0, 4)}` })).toHaveAttribute('aria-pressed', 'true');
  if (synthetic.length > 120) {
    await expect(card.getByRole('heading', { name: 'Aylık satış' })).toBeVisible();
    await expect(card.locator('.daily-bars button')).toHaveCount(months);
    await expect(card.locator('.daily-bars button.partial')).toHaveCount(partial);
    await card.locator('.daily-bars button').nth(Math.min(3, months - 1)).hover();
    await expect(card.locator('.chart-tip')).toContainText('2026');
  }
  await page.setViewportSize({ width: 1280, height: 1500 });
  await shot(page, 'satis-raporlar-1yil.png', info.outputPath('satis-raporlar-1yil.png'));
  for (const preset of ['Yıl', 'Tümü']) {
    await page.setViewportSize({ width: 1280, height: 900 });
    if (preset === 'Tümü') await period.getByRole('button', { name: preset, exact: true }).click();
    else { await period.getByRole('button', { name: /^Yıl/ }).click(); await page.keyboard.press('Escape'); }
    await expect(card.getByRole('heading', { name: 'Aylık satış' })).toBeVisible();
    expect(await card.locator('.daily-bars button').count()).toBeLessThanOrEqual(31);
    for (const width of [360, 390, 768, 820, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50);
      expect(await fits(page), `${preset} ${width}`).toBe(true);
      // Nothing inside the cards runs out of them either.
      const out = await page.locator('.reports-v2').evaluate(root => [...root.querySelectorAll<HTMLElement>('.panel, .kpi, .daily-bars, .hour-heat, .chart-ticks')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className));
      expect(out, `${preset} ${width}`).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 390, height: 1600 });
  await shot(page, 'satis-raporlar-1yil-telefon.png', info.outputPath('satis-raporlar-1yil-telefon.png'));

  // Every report at every width: both rows inside the page, 44 px targets, the chosen ones in view; the four groups never
  // slide (on a phone each icon sits above its name), the reports' row may slide inside itself. Rezervasyon has no second row.
  const every = Object.keys(reportGroupOf) as ReportTab[];
  for (const width of [360, 390, 768, 820, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of every) {
      // Groups with one report (Personel's Çalışanlar, Rezervasyon) have no second row.
      const single = ['Rezervasyon', 'Çalışanlar'].includes(name);
      await openReport(page, name);
      await expect(groups.getByRole('button', { name: reportGroupOf[name], exact: true })).toHaveAttribute('aria-current', 'page');
      if (!single) await expect(tabs.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      const rows = await page.locator('.report-nav').evaluate(nav => [...nav.querySelectorAll<HTMLElement>('.pill-tabs')].map(row => {
        const box = row.getBoundingClientRect(), active = row.querySelector<HTMLElement>('[aria-current="page"]')!.getBoundingClientRect();
        return { slides: row.scrollWidth > row.clientWidth + 1, inPage: box.left >= -1 && box.right <= innerWidth + 1, activeShown: active.left >= box.left - 1 && active.right <= box.right + 1, small: [...row.querySelectorAll('button')].filter(b => b.getBoundingClientRect().height < 44).length };
      }));
      expect(rows.length, `${name} ${width}`).toBe(single ? 1 : 2);
      expect(rows[0].slides, `groups ${width}`).toBe(false);
      for (const row of rows) expect(row, `${name} ${width}`).toEqual({ slides: row.slides, inPage: true, activeShown: true, small: 0 });
      expect(await fits(page), `${name} ${width}`).toBe(true);
      // The longest reports' row (Satış) on each width, for a look.
      if (name === 'Kampanyalar') await page.screenshot({ path: info.outputPath(`rapor-sekmeleri-${width}.png`) });
    }
  }
  // Tablets and the café computer: one row each.
  for (const width of [768, 1024, 1280]) { await page.setViewportSize({ width, height: 900 }); await openReport(page, 'Özet'); await expect(groups).toHaveClass(/layout-one/); await expect(tabs).toHaveClass(/layout-one/); }
  // The phone screen for the owner: the groups over Satış's reports.
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page, 'Özet'); await period.getByRole('button', { name: '30 gün', exact: true }).click();
  await expect(card.getByRole('heading', { name: 'Günlük satış' })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, 'satis-raporlar-gruplar-telefon.png', info.outputPath('satis-raporlar-gruplar-telefon.png'));

  // Remembered on this device: a group comes back on its last report, and the reports open where they were left.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openReport(page, 'Kârlılık'); await openReport(page, 'Çalışanlar');
  await groups.getByRole('button', { name: 'Satış', exact: true }).click();
  await expect(tabs.getByRole('button', { name: 'Kârlılık', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(tabs.getByRole('button', { name: 'Kârlılık', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(tabs.getByRole('button', { name: 'Kârlılık', exact: true })).toHaveAttribute('aria-current', 'page');
  // A device that remembered the old "Para" group (gone 13 Ekim) or one of its books opens Özet, without an error; the
  // other groups keep their last report.
  for (const saved of ['{"tab":"expenses","last":{"money":"corrections","sales":"profit"}}', '{"tab":"money","last":{"money":"money"}}']) {
    await page.evaluate(v => localStorage.setItem('mola-report-place', v), saved);
    await page.reload();
    await page.locator('.sidebar nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
    await expect(tabs.getByRole('button', { name: 'Özet', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('region', { name: 'Para taşındı' })).toHaveCount(0);
  }
  // A broken saved value (another version, a hand edit) is ignored: Satış → Özet.
  await page.evaluate(() => localStorage.setItem('mola-report-place', '{"tab":"eski","last":{"sales":"cash"}}'));
  await page.reload();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(tabs.getByRole('button', { name: 'Özet', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('Menü yönetimi: the status tabs are the shared pill bar with counts; they filter and fit phones', async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('/');
  await page.locator('.sidebar nav').getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  const status = page.getByRole('group', { name: 'Ürün durumu' });
  await expect(status).toHaveClass(/pill-tabs/);
  await expect(status.getByRole('button', { name: /^Tümü/ })).toHaveAttribute('aria-pressed', 'true');
  const all = await page.locator('.menu-row').count();
  await expect(status.getByRole('button', { name: /^Tümü/ }).locator('.pill-tab-badge')).toHaveText(String(all));
  await status.getByRole('button', { name: /^Tükendi/ }).click();
  await expect(status.getByRole('button', { name: /^Tükendi/ })).toHaveAttribute('aria-pressed', 'true');
  await status.getByRole('button', { name: /^Tümü/ }).click();
  await shot(page, 'menu-yonetimi.png', info.outputPath('menu-yonetimi.png'));
  for (const width of [360, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await fits(page), `menu ${width}`).toBe(true);
    const heights = await status.getByRole('button').evaluateAll(list => list.map(b => b.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'menu-yonetimi-telefon.png', info.outputPath('menu-yonetimi-telefon.png'));
});

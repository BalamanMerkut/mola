import { test, expect, type Page } from '@playwright/test';
import type { PhoneReport } from '../../packages/domain/remote-report';
import { MERKEZ } from './helpers';

/*
 * İşletmemi yönet's report, how it looks (0.1.24: the owner found it "biraz ilkel"; src/ReportsPhone.tsx ReportView): the day
 * on top with the comparison, payments as one stacked bar with its legend, top products as ranked rows with bars, the last
 * 30 days as a bar chart with dates, the average line and a value on tap. A signed-in device is put in this browser's
 * IndexedDB with a full last report and Mola Merkez answers "the café is off", so the page shows exactly that report at
 * 360, 390, 430 px and on a laptop, light and dark; then the empty day ("Bugün henüz satış yok").
 */
const day = (offset: number) => new Date(Date.now() + 3 * 3600_000 - 5 * 3600_000 + offset * 86400000).toISOString().slice(0, 10);
const days = Array.from({ length: 30 }, (_, i) => {
  const d = day(i - 29), weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
  // A café's month: busier weekends, two quiet days, a slow start.
  const sales = i < 3 ? 0 : i === 11 ? 0 : Math.round((620_000 + ((i * 7919) % 230_000) + (weekday === 0 || weekday === 6 ? 380_000 : 0)) / 100) * 100;
  return { day: d, sales };
});
const report = (empty = false): PhoneReport => ({
  v: 1, business: 'Mola Örnek Kafe', at: new Date(Date.now() - 25 * 60_000).toISOString(), day: day(0), reason: 'shutdown', theme: 'sage',
  today: empty ? { sales: 0, cash: 0, card: 0, platform: 0, orders: 0, closedAccounts: 0, averageAccount: 0, expenses: 0, refunds: 0, kept: 0, cancelled: { count: 0, amount: 0 }, channels: [], previous: { sales: 452_000, partial: true } }
    : { sales: 1_245_000, cash: 412_000, card: 698_000, platform: 135_000, orders: 86, closedAccounts: 41, averageAccount: 30_366, expenses: 85_000, refunds: 12_000, kept: 1_090_000, cancelled: { count: 2, amount: 18_000 },
      channels: [{ name: 'Masa', orders: 61, amount: 905_000 }, { name: 'Al götür', orders: 17, amount: 205_000 }, { name: 'Yemeksepeti', orders: 8, amount: 135_000 }], previous: { sales: 1_098_000, partial: true } },
  topProducts: empty ? [] : [
    { name: 'Caffè Latte', qty: 42, amount: 378_000 }, { name: 'Türk Kahvesi', qty: 38, amount: 228_000 }, { name: 'San Sebastian Cheesecake', qty: 14, amount: 196_000 },
    { name: 'Çay', qty: 120, amount: 120_000 }, { name: 'Tost', qty: 11, amount: 99_000 }, { name: 'Lokum', qty: 1, amount: 64_000, unit: 'kg', grams: 1600 }],
  hourly: [], open: { accounts: empty ? 0 : 3, amount: empty ? 0 : 74_000 },
  lastClosing: { at: new Date(Date.now() - 20 * 3600_000).toISOString(), day: day(-1), byName: 'Ayşe Kaya', counted: 402_000, expected: 404_500, difference: -2500 },
  days: empty ? days.map((d, i) => i === 29 ? { ...d, sales: 0 } : d) : days.map((d, i) => i === 29 ? { ...d, sales: 1_245_000 } : d),
});

/** A signed-in device with this last report (keys made here, as the sign-in would), the café "off". */
async function signedIn(page: Page, r: PhoneReport) {
  await page.route(`${MERKEZ}/api/merkez/v1/phone/live`, route => route.fulfill({ json: { offline: true, seenAt: r.at, waiting: false } }));
  await page.route(`${MERKEZ}/api/merkez/v1/phone/postbox`, route => route.fulfill({ json: { box: null, online: false, seenAt: r.at } }));
  await page.goto(`${MERKEZ}/yonet`);
  await page.evaluate(async report => {
    const mine = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    const cafe = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
    const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const paired = { v: 1, phoneId: 'A'.repeat(22), token: 'B'.repeat(43), cafePublic: b64u(await crypto.subtle.exportKey('raw', cafe.publicKey)), business: report.business, pairedAt: new Date().toISOString(), privateKey: mine.privateKey, publicKey: b64u(await crypto.subtle.exportKey('raw', mine.publicKey)), last: { report, kind: 'snapshot' } };
    await new Promise<void>((done, fail) => {
      const open = indexedDB.open('mola-raporlarim', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kasa')) open.result.createObjectStore('kasa'); };
      open.onsuccess = () => { const tx = open.result.transaction('kasa', 'readwrite'); tx.objectStore('kasa').put(paired, 'telefon'); tx.oncomplete = () => { open.result.close(); done(); }; tx.onerror = () => fail(tx.error); };
      open.onerror = () => fail(open.error);
    });
  }, r);
  await page.reload();
  await expect(page.getByText(/^Kasa bilgisayarı kapalı · Son durum/)).toBeVisible({ timeout: 30_000 });
}
const wide = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('the report looks right at 360–430 px and on a laptop, light and dark; the chart answers a tap; the empty day', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, report());
  const hero = page.getByRole('region', { name: 'Bugünün satışı' });
  await expect(hero).toContainText('Son durum ·');
  await expect(hero).toContainText('₺12.450');
  await expect(hero).toContainText('▲ %13');
  await expect(hero).toContainText('dün aynı saate kadar ₺10.980');
  // Payments: the stacked bar's three parts and the legend with the amounts and shares.
  const payments = page.getByRole('region', { name: 'Ödemeler' });
  await expect(payments.locator('.rp-stack span')).toHaveCount(3);
  await expect(payments.getByRole('listitem')).toHaveText([/^Nakit%33₺4\.120$/, /^Kart%56₺6\.980$/, /^Platform%11₺1\.350$/]);
  // Ranked products with bars in proportion to the first.
  const top = page.getByRole('region', { name: 'En çok kazandıranlar' });
  await expect(top.getByRole('listitem')).toHaveCount(6);
  await expect(top.getByRole('listitem').first()).toContainText('Caffè Latte');
  await expect(top.getByRole('listitem').last()).toContainText('1,6 kg');
  // The month: 30 bars, dates under them, the average line; a tap shows that day.
  const month = page.getByRole('region', { name: 'Son 30 gün' });
  await expect(month.locator('.rp-col')).toHaveCount(30);
  await expect(month.locator('.rp-avg')).toHaveCount(1);
  await expect(month.locator('.rp-tick')).toHaveCount(5);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    expect(await wide(page), `${width} px`).toBe(true);
    await page.screenshot({ path: info.outputPath(`rapor-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await month.locator('.rp-hit').nth(25).click();
  await expect(month.getByRole('status')).toContainText('₺');
  await month.screenshot({ path: info.outputPath('rapor-390-grafik-dokunma.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: info.outputPath('rapor-390-koyu.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  // A laptop: two columns.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  expect(await wide(page)).toBe(true);
  const [a, b] = await Promise.all([payments.boundingBox(), page.getByRole('region', { name: 'Günün sayıları' }).boundingBox()]);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(4); expect(b!.x).toBeGreaterThan(a!.x + 100);
  await page.screenshot({ path: info.outputPath('rapor-laptop.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: info.outputPath('rapor-laptop-koyu.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });

  // The empty day: plain sentences, no empty boxes.
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, report(true));
  await expect(hero).toContainText('Bugün henüz satış yok');
  await expect(payments).toContainText('Bugün henüz ödeme alınmadı.');
  await expect(top).toContainText('Bugün henüz satış yok.');
  expect(await wide(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('rapor-390-bos-gun.png'), fullPage: true });
});

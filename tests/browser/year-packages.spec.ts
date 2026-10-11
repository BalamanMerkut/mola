import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { protectedPort, protectedServer, scenario } from './protected-server';
import { openReport, openView } from './helpers';
import { cafe, DAYS } from '../year-fixture';
import { licensed, TEST_PUBLIC_KEY } from '../merkez-fixture';
import { businessDay, dayStart } from '../../packages/domain/business-day';

/*
 * Yıl paketleri (docs/GELISTIRICI_REHBERI.md "Yıl paketleri"): a café computer with 2024 and 2025 seals both years by itself
 * (here 1.5 s after its start; in a café hourly from 10 minutes after the start, from 1 February, when it is quiet). The owner
 * hears "2025 yılı kapandı ve paketlendi.", the rail's Yedekle lists "Yıl paketi 2025" among the kept backups, a back-dated
 * expense into 2025 is refused with "Bu yıl kapandı", and a refund of a 2025 bill shows in today's report.
 */
async function shot(page: Page, file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
const tl = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 ? 2 : 0 }).format(kurus / 100);

test('yıl paketleri: sealed by themselves, listed in Yedekle, a back-dated expense refused, an old bill refunded today', async ({ page }, info) => {
  test.setTimeout(240_000);
  // The café's data: bills, closings, shifts and stock in December 2024, December 2025 and January 2026 (tests/year-fixture.ts).
  const root = scenario('yil-paketi'), c = cafe(join(root, 'veri'), DAYS);
  c.apply(s => { s.setupCompleted = true; s.name = 'Yıl Kafe'; });
  c.at(dayStart('2026-01-25')); c.apply(() => {});
  licensed(c.store, {}, true); c.store.close();
  const server = await protectedServer(root, protectedPort(9), 'yil-pc', false, { MOLA_MERKEZ_PUBLIC_KEY: TEST_PUBLIC_KEY, MOLA_YIL_PAKETI_MS: '1500' });
  try {
    await server.desktop('/api/desktop/recovery/show', {}); await server.desktop('/api/desktop/recovery/confirm', {});
    // Both closed years are sealed by the computer itself (a verified backup before each and one after).
    await expect.poll(async () => (await server.desktop<{ backup: { packages?: { year: string }[] } }>('/api/desktop/status')).data.backup.packages?.map(p => p.year).join(',') ?? '', { timeout: 150_000, intervals: [1000] }).toBe('2024,2025');
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    await page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: 'Yedekle' }).click();
    const dialog = page.getByRole('dialog', { name: 'Yedekle' });
    await expect(dialog.getByText('Son yedek:', { exact: false })).toBeVisible({ timeout: 30_000 });
    await dialog.locator('details.backup-kept summary').click();
    const kept = dialog.getByRole('list', { name: 'Saklanan yedekler' });
    await expect(kept.locator('li.year-package')).toHaveText([/Yıl paketi 2024.*Kalıcı/, /Yıl paketi 2025.*Kalıcı/]);
    // What a package keeps (owner's decision, 7 October), and the readable copy from before the first package until it goes.
    await expect(dialog.getByTestId('package-privacy')).toHaveText('Yıl paketlenirken müşterilerin kişisel bilgileri (rezervasyon adı, telefon, not; paket servis adresi) silinir; satış rakamları korunur.');
    await expect(dialog.getByTestId('safety-copy')).toHaveText(/^İlk yıl paketinden önce alınan okunabilir kopya \d{1,2} \S+ \d{4} tarihinde kendiliğinden silinecek\.$/);
    await shot(page, 'yil-paketi.png', info.outputPath('yil-paketi.png'));
    await page.keyboard.press('Escape');

    // The owner: the notice, then a back-dated expense into 2025.
    expect((await page.request.post(`${server.base}/api/login`, { data: { username: 'isletme', password: 'MolaDemo!2026' } })).ok()).toBe(true);
    const notices = await (await page.request.get(`${server.base}/api/staff/notifications`)).json();
    expect(JSON.stringify(notices)).toContain('2025 yılı kapandı ve paketlendi.');
    expect(JSON.stringify(notices)).toContain('müşterilerin kişisel bilgileri (rezervasyon adı, telefon, not; paket servis adresi) silinir');
    await page.goto(`${server.base}/`);
    await openView(page, 'Satış ve Raporlar');
    await openReport(page, 'Giderler');
    await page.getByRole('button', { name: 'Gider ekle', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Gider ekle' });
    await form.getByLabel('Gider tarihi').fill('2025-12-30');
    await form.getByLabel('Gider tutarı').fill('850'); await form.getByLabel('Gider açıklaması').fill('Aralık doğalgaz faturası');
    await form.getByLabel('Ödeme yöntemi').selectOption('transfer');
    await form.getByRole('button', { name: 'Gideri kaydet' }).click();
    await expect(form.getByText(/^Bu yıl kapandı: 2025 yılının kayıtları paketlendi ve artık değiştirilemez\. Kaydı bugünün tarihiyle girin\.$/)).toBeVisible();
    await shot(page, 'kapali-yil-uyari.png', info.outputPath('kapali-yil-uyari.png'));
    // Today's date goes through.
    const today = businessDay(Date.now());
    await form.getByLabel('Gider tarihi').fill(today);
    await form.getByRole('button', { name: 'Gideri kaydet' }).click();
    await expect(page.locator('.expense-table tbody tr').filter({ hasText: 'Aralık doğalgaz faturası' })).toHaveCount(1);

    // A bill of 29 December 2025: found and refunded today; the refund is in today's report, 2025 stays as it was.
    const ledger = await (await page.request.get(`${server.base}/api/staff/payment-adjustments?from=2025-12-29&to=2025-12-29&limit=50`)).json();
    const old = ledger.rows.find((r: { refunded: number; method: string }) => !r.refunded && r.method === 'cash');
    const year = await (await page.request.get(`${server.base}/api/staff/reports/overview?from=2025-01-01&to=2025-12-31`)).json();
    const refund = await page.request.post(`${server.base}/api/staff/payment-adjustments`, { data: { requestId: randomUUID(), paymentId: old.id, revision: old.revision, kind: 'refund', amount: 2000, method: 'cash', commission: 0, reason: 'Eski hesaba iade' } });
    expect(refund.ok(), await refund.text()).toBe(true);
    expect(await (await page.request.get(`${server.base}/api/staff/reports/overview?from=2025-01-01&to=2025-12-31`)).json()).toEqual(year);
    await openReport(page, 'Özet');
    await page.getByRole('group', { name: 'Dönem' }).getByRole('button', { name: 'Bugün', exact: true }).click();
    await expect(page.locator('main')).toContainText(tl(2000));
  } finally { await server.stop(); }
});

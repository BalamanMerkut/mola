import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { printDocument, type DocTable } from '../../server/report-document';
import { sections } from '../../server/email-reports-content';
import { ensureSetup } from './helpers';

/*
 * Satış ve Raporlar → Yazdır / PDF (11 Ekim): "Kasa kapanışı" rows ran off the A4 page and were cut in print. Every section of
 * the printable page is measured in print media at the A4 content width (210 mm − 2 × 14 mm margins), with the worst content a
 * café can have: long names without spaces, many digits, many closings, a Müdür's blind page; and every real report view.
 */
const A4_CONTENT_PX = Math.floor((210 - 28) / 25.4 * 96);
/** Everything that sticks out of the page or is cut inside its own box, with its text. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 0.5, out: string[] = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px`);
    for (const e of document.querySelectorAll<HTMLElement>('body *')) {
      const r = e.getBoundingClientRect();
      if (r.width && r.right > limit) out.push(`${e.tagName}.${e.className} ends at ${Math.round(r.right)}px: ${e.textContent?.slice(0, 60)}`);
      if (['TD', 'TH', 'STRONG', 'P', 'H1', 'H2'].includes(e.tagName) && e.scrollWidth > e.clientWidth + 1) out.push(`${e.tagName} is cut: ${e.textContent?.slice(0, 60)}`);
    }
    // A text that spills out of its column of the two-column parts (the Kasa kapanışı bug) also counts.
    for (const s of document.querySelectorAll<HTMLElement>('.parts section')) for (const t of s.querySelectorAll('td')) if (t.getBoundingClientRect().right > s.getBoundingClientRect().right + 0.5) out.push(`spills out of its column: ${t.textContent?.slice(0, 60)}`);
    return out;
  });
}
async function inPrint(page: Page, html: string) {
  await page.setViewportSize({ width: A4_CONTENT_PX, height: 1100 });
  await page.emulateMedia({ media: 'print' });
  await page.setContent(html);
}
const long = 'Kahvaltılık-Serpme-Köy-Kahvaltısı-İki-Kişilik-Bol-Çeşitli';
const big = (k: number) => `${k < 0 ? '−' : ''}₺${(Math.abs(k) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
/** The worst period report a café can have for the summary's parts (server/email-reports-content.ts sections). */
const report = (blind: boolean) => ({
  kind: 'month', business: 'Mola Coffee House', previous: { total: 12_345_678_90, label: 'geçen aya', partial: false },
  sales: { total: 98_765_432_10, cash: 45_678_901_23, card: 43_210_987_65, platform: 9_875_543_22, orders: 123456, accounts: 98765, average: 1_234_56 },
  openBills: 12_345_67, openAtClose: 9_876_54, tips: { total: 1_234_567_89, cash: 234_567_89, card: 1_000_000_00 }, refunds: { total: 12_345_678, count: 4321 },
  cancelled: { count: 321, amount: 1_234_567 }, expenses: { total: 23_456_789_01, count: 9876 }, commission: 1_234_567_89, kept: 70_000_000_00,
  top: [{ name: long, amount: 12_345_678_90, qty: 123456 }, { name: 'Türk Kahvesi (Duble, Sade, Lokum ile)', amount: 9_876_543_21, qty: 98765 }],
  closings: { count: 12, blind, short: 5, over: 6, difference: 1_250_00, list: Array.from({ length: 12 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, time: '23:59', extra: i % 3 === 0, by: i % 2 ? 'Abdurrahman Gülşenoğlu-Karamanlıoğulları' : 'Ayşe', difference: (i % 2 ? 1 : -1) * 1_250_000_00, counted: 9_876_543_21, expected: 8_626_543_21 })) },
  vat: { rows: [{ rate: 1, gross: 12_345_678_90, base: 12_223_444_45, vat: 122_234_45 }, { rate: 10, gross: 76_543_210_98, base: 69_584_737_25, vat: 6_958_473_73 }, { rate: 20, gross: 9_876_543_21, base: 8_230_452_68, vat: 1_646_090_53 }], total: { rate: -1, gross: 98_765_433_09, base: 90_038_634_38, vat: 8_726_798_71 } },
  staff: [{ name: long, minutes: 98765, estimated: true }],
});
const tables: DocTable[] = [
  { title: 'Gün sonu kapanışları', head: ['Gün', 'Saat', 'Kapatan', 'Beklenen', 'Sayılan', 'Fark'], right: [3, 4, 5], rows: Array.from({ length: 8 }, () => ['12.10.2026', '23:59 · ek', long, big(98_765_432_10), big(98_765_432_10), big(-1_250_000_00)]) },
  { title: 'Ürün satışları', head: ['Ürün', 'Kategori', 'KDV', 'Adet', 'Tutar', 'Pay'], right: [2, 3, 4, 5], rows: [[long, 'Kahvaltılar ve Serpme Kahvaltı Tabakları', '%20', '1.234.567', big(98_765_432_10), '%100']], foot: ['Toplam', '', '', '', big(98_765_432_10), ''] },
  { title: 'İadeler', head: ['Tarih', 'Saat', 'Ne için', 'Yöntem', 'Kim', 'Tutar'], right: [5], rows: [['12.10.2026', '23:59', Array.from({ length: 6 }, () => `2 × ${long}`).join(', '), 'Nakit', long, big(1_234_567_89)]] },
  { title: 'Kampanyalar', head: ['Kampanya', 'İndirimli satış', 'İndirim', 'Günlük adet (önce → sırasında)', 'Değişim'], right: [1, 2, 3, 4], rows: [[`${long} (sürüyor)`, big(98_765_432_10), big(9_876_543_21), '12.345,6 → 98.765,4', '%12345']] },
];

test('Yazdır / PDF: no text runs off an A4 page or out of its column, with the longest names and the biggest amounts', async ({ page }, info) => {
  for (const blind of [false, true]) {
    const html = printDocument({ business: 'Satış ve Raporlar', title: `Mola Coffee House Kahve ve Kahvaltı Evi · Ekim 2026 · Satış özeti`, when: '1 Ekim 2026 – 31 Ekim 2026', lead: `${long} ${'çok uzun bir cümle '.repeat(20)}`,
      figures: [['Toplam tahsilat', big(98_765_432_10)], ['Sipariş', '1.234.567'], ['Gider', big(23_456_789_01)], ['Elde kalan', big(-70_000_000_00)]], parts: sections(report(blind) as never), tables, prepared: 'Hazırlanma: 12 Ekim 2026 09:00' });
    await inPrint(page, html);
    expect(await overflow(page), blind ? 'Müdür (kör)' : 'sahip').toEqual([]);
    await expect(page.locator('section').filter({ hasText: 'Kasa kapanışı' })).toContainText(blind ? 'sayılan ₺9.876.543,21' : 'Kasa fazla ₺1.250.000 (sayılan ₺9.876.543,21 · beklenen ₺8.626.543,21)');
    if (!blind) {
      await page.pdf({ path: info.outputPath('rapor-yazdir-uzun.pdf'), format: 'A4' });
      await page.emulateMedia({ media: 'screen' }); await page.setViewportSize({ width: 900, height: 1300 });
      await page.screenshot({ path: info.outputPath('rapor-yazdir-uzun.png'), fullPage: true });
      const folder = process.env.KAFE_EKRAN;
      if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, 'rapor-yazdir-kasa.png'), clip: { x: 0, y: 0, width: 900, height: 1300 } }); }
    }
  }
});

test('Yazdır / PDF: every report view of the café prints inside the page', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } }); await ensureSetup(page.request);
  const today = new Date(Date.now() - 2 * 3600_000).toISOString().slice(0, 10), from = `${today.slice(0, 7)}-01`;
  for (const view of ['summary', 'products', 'profit', 'campaigns', 'cash', 'expenses', 'corrections', 'employees', 'staff', 'reservations']) {
    for (const range of [`from=${today}&to=${today}`, `from=${from}&to=${today}`, 'from=all&to=all']) {
      const r = await page.request.get(`/api/staff/reports/document?view=${view}&${range}`);
      expect(r.ok(), `${view} ${range}`).toBe(true);
      await inPrint(page, await r.text());
      expect(await overflow(page), `${view} ${range}`).toEqual([]);
    }
  }
});

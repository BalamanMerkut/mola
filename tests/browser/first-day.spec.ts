import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { ADMIN_API, MERKEZ, e2eRun, openFirstSteps, openYonetim, yonetimState } from './helpers';
import { protectedPort, protectedServer, scenario, typeGroups } from './protected-server';
import { AGREEMENT_VERSION } from '../../packages/domain/agreement';

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('first day: no recovery code before the owner account; the account signs in at once; the code after it (put off, then confirmed); 3 tables; "İlk adımlar" ticks and goes away', async ({ page, browser }, info) => {
  test.setTimeout(150_000);
  const root = scenario('first-day');
  const server = await protectedServer(root, protectedPort(8), 'kafe-pc', true, { MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt'), MOLA_HEARTBEAT_MS: '2000', MOLA_SYNC_SOON_MS: '1000' });
  const admin = await browser.newPage();
  try {
    await page.goto(`${server.base}/#masaustu=${server.token}`);
    // No welcome window (0.1.11): straight to the activation screen, which offers every way in.
    await expect(page.getByRole('heading', { name: 'Mola’yı etkinleştir' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Mola’ya hoş geldiniz' })).toHaveCount(0);
    for (const name of [/Kodum yok, başvuru yapacağım/, /Etkinleştirme kodum var/, /İşletmem var/, /Yedekten geri yükle/, /Mola Merkez’den geri yükle/]) await expect(page.getByRole('button', { name })).toBeVisible();
    // The code waits for the owner account: nothing on the activation screens.
    await page.waitForTimeout(3500);
    await expect(page.getByRole('dialog', { name: 'Kurtarma kodunuz' })).toHaveCount(0);

    const applied = await page.request.post(`${server.base}/api/activation/application`, { data: { businessName: 'İlk Gün Kafe', sector: 'cafe', contactName: 'Selin Ak', consent: true, agreement: { version: AGREEMENT_VERSION },
      invoice: { legalName: 'İlk Gün Kafe Ltd. Şti.', taxOffice: 'Kadıköy', taxType: 'company', taxNumber: '1111111114', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 7', phone: '+905321119988', email: 'selin@example.com' } } });
    expect(applied.ok(), await applied.text()).toBe(true);
    await openYonetim(admin);
    const tenantId = (await yonetimState(admin.request)).businesses.find((b: any) => b.name === 'İlk Gün Kafe').tenantId;
    expect((await admin.request.post(`${ADMIN_API}/applications/approve`, { data: { requestId: randomUUID().replace(/-/g, ''), tenantId } })).ok()).toBe(true);
    await expect.poll(async () => (await (await page.request.get(`${server.base}/api/activation`)).json()).state, { timeout: 15000 }).toBe('owner');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'İşletme sahibi hesabı' })).toBeVisible();
    await page.getByLabel(/Kullanıcı adı/).fill('selin');
    // The field may carry its hint in its name ("Şifre * En az 10 karakter.").
    await page.getByLabel(/^Şifre \*/).fill('SelinKafe!2026');
    await page.getByLabel('Şifre tekrar *', { exact: true }).fill('SelinKafe!2026');
    await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
    // Straight in (no second login), and now the recovery code.
    await expect(page.locator('.setup-steps')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Çalışma alanını aç' })).toHaveCount(0);
    const recovery = page.getByRole('dialog', { name: 'Kurtarma kodunuz' });
    await expect(recovery.getByTestId('recovery-code')).toBeVisible({ timeout: 10000 });
    const code = (await recovery.getByTestId('recovery-code').locator('span').allTextContents()).join('-');
    await expect(recovery.getByRole('button', { name: 'Yazdır' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('code-after-owner.png') });
    // Only an explicit "Sonra kaydedeceğim" lets it go; the rail keeps its reminder dot.
    await page.keyboard.press('Escape'); await expect(recovery).toBeVisible();
    await recovery.getByRole('button', { name: 'Sonra kaydedeceğim' }).click();
    await expect(recovery).toHaveCount(0);
    await expect(page.getByLabel('Bakılması gereken güvenlik adımı var')).toHaveCount(1);

    // The wizard: 3 tables (fewer than the starter 12), no stale "platform yönetimi" text.
    await expect(page.getByText('platform yönetim', { exact: false })).toHaveCount(0);
    await page.getByRole('button', { name: 'Devam' }).click();
    await page.getByLabel('Toplam masa sayısı').fill('0');
    await expect(page.getByText('1 ile 100 arasında bir sayı yazın.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Devam' })).toBeDisabled();
    await page.getByLabel('Toplam masa sayısı').fill('3');
    await page.getByRole('button', { name: 'Devam' }).click();
    await page.getByRole('button', { name: 'Devam' }).click();
    await expect(page.locator('.setup-summary')).toContainText('Masa3');
    // 9 Ekim kullanıcı testi: the wizard's page was scrolled; Masalar opened 80 px down, its top bar (QR çipi, tarih) out of sight.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.getByRole('button', { name: 'Kurulumu kaydet' }).click();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // Masalar: three tables and the "İlk adımlar" card.
    // The counter's compact Masalar (≥ 900 px) folds it to one line "İlk adımlar 0/6" that opens the list.
    const card = page.getByRole('region', { name: 'İlk adımlar' });
    await expect(card).toBeVisible();
    const state = await (await page.request.get(`${server.base}/api/staff/state`)).json();
    expect(state.tables.length).toBe(3);
    await expect(card.locator('.first-steps-toggle')).toHaveText(/İlk adımlar\s*0\/6/);
    await openFirstSteps(page);
    await expect(card.locator('li')).toHaveCount(6);
    await page.screenshot({ path: info.outputPath('first-steps.png'), fullPage: true });
    // No step title runs into what is on its right ("Kodu göster" here; on another device the long "Kasa bilgisayarındaki
    // Mola penceresinden…" hint): at 1024, 1280 and 1440, in the desktop window and in a plain browser.
    const plain = await page.context().newPage();
    try {
      await plain.goto(server.base);
      for (const view of [page, plain]) {
        const steps = view.getByRole('region', { name: 'İlk adımlar' });
        await steps.waitFor(); await openFirstSteps(view);
        await expect(steps.locator('li')).toHaveCount(6);
        if (view === plain) await expect(steps.locator('li small')).toHaveCount(2);
        for (const width of [1024, 1280, 1440]) {
          await view.setViewportSize({ width, height: 900 });
          const clashes = await steps.locator('li').evaluateAll(items => items.flatMap(li => {
            const title = li.querySelector('.grow')!, aside = li.querySelector('.text-btn, small');
            if (!aside) return [];
            const range = document.createRange(); range.selectNodeContents(title);
            const a = [...range.getClientRects()], b = aside.getBoundingClientRect(), box = li.getBoundingClientRect();
            const overlap = a.some(r => r.right > b.left + 1 && r.left < b.right - 1 && r.bottom > b.top + 1 && r.top < b.bottom - 1);
            const outside = a.some(r => r.right > box.right + 1) || b.right > box.right + 1;
            return overlap || outside ? [title.textContent] : [];
          }));
          expect(clashes, `${view === page ? 'masaüstü penceresi' : 'tarayıcı'} ${width}px`).toEqual([]);
        }
        await view.screenshot({ path: info.outputPath(`first-steps-${view === page ? 'pencere' : 'tarayici'}-1440.png`), fullPage: true });
      }
    } finally { await plain.close(); await page.setViewportSize({ width: 1280, height: 860 }); }
    // The QR step opens Ayarlar → Masalar ve QR → QR kodlarını yazdır; one A4 print of all three tables ticks it (State.qrPrint).
    await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
    await card.getByRole('button', { name: 'QR kodlarına git' }).click();
    const qrCard = page.locator('.qr-codes-card');
    await expect(qrCard).toBeVisible();
    await qrCard.getByRole('button', { name: 'Yazdır', exact: true }).click();
    await expect(page.getByTestId('qr-print-sheet').locator('.qr-cell')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect.poll(async () => (await (await page.request.get(`${server.base}/api/staff/first-steps`)).json()).steps.qr).toBe(true);
    await page.getByRole('button', { name: /Masalar/ }).first().click();
    await expect(card.locator('li.done')).toHaveCount(1);
    // The recovery step opens the code again from the card; two groups confirm it.
    await card.getByRole('button', { name: 'Kodu göster' }).click();
    await expect(recovery.getByTestId('recovery-code')).toBeVisible();
    await recovery.getByRole('button', { name: 'Kaydettim', exact: true }).click();
    await typeGroups(recovery, code);
    await expect(recovery).toHaveCount(0);
    await expect(card.locator('li.done')).toHaveCount(2);
    await expect(page.getByLabel('Bakılması gereken güvenlik adımı var')).toHaveCount(0);
    // The second-place step opens Yedekle.
    await card.getByRole('button', { name: 'Yer seç' }).click();
    const backup = page.getByRole('dialog', { name: 'Yedekle' });
    await expect(backup.getByText('Seçilmedi')).toBeVisible();
    await backup.getByRole('button', { name: 'Kapat', exact: true }).click();
    // "Menüye git" counts as checked and opens the menu.
    await card.getByRole('button', { name: 'Menüye git' }).click();
    await expect(page.locator('h1')).toHaveText('Menü yönetimi');
    await page.getByRole('button', { name: /Masalar/ }).first().click();
    await expect(card.locator('li.done')).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await fits(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('first-steps-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 860 });
    // Put away for good.
    await card.getByRole('button', { name: 'İlk adımları kapat' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Mola bilgisayar araçları' })).toBeVisible();
    await expect(page.getByLabel('Günün özeti')).toBeVisible();
    await expect(page.getByRole('region', { name: 'İlk adımlar' })).toHaveCount(0);
    await expect(page.getByText('Kurtarma kodunuzu henüz kaydetmediniz.')).toHaveCount(0);
  } finally { await admin.close(); await server.stop(); }
});

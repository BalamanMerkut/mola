import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { detailTab, ensureSetup, openYonetim, yonetimGo, yonetimNav, yonetimState } from './helpers';

test('business card opens its support history; selector and clear restore the right scope', async ({ page, browser }, info) => {
  const owner = await browser.newContext(), other = await browser.newContext();
  try {
    await owner.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
    await other.request.post('/api/login', { data: { username: 'diger', password: 'MolaDemo!2026' } });
    for (const [context, name] of [[owner, 'Birinci talep'], [other, 'İkinci talep']] as const) {
      const result = await context.request.post('/api/staff/support', { data: { requestId: 'support-navigation-create', subject: name, text: 'Yardım almak istiyorum.' } }); expect(result.ok()).toBe(true);
    }
    const isolated = await (await owner.request.get('/api/staff/support')).json();
    expect(isolated.tickets).toHaveLength(1); expect(isolated.tickets[0].subject).toBe('Birinci talep');
    await openYonetim(page);
    await expect(page.getByRole('heading', { name: 'Bugün yapılacaklar' })).toBeVisible();
    // The café delivers new tickets to Mola Merkez right away (and retries until it is confirmed).
    await expect.poll(async () => (await yonetimState(page.request)).tickets.length, { timeout: 15000 }).toBe(2);
    await page.reload();
    const state = await yonetimState(page.request);
    const first = state.businesses.find((l: any) => l.tenantId === 'mola-demo'), second = state.businesses.find((l: any) => l.tenantId === 'other-demo');
    // Waiting work shows on Bugün, the sidebar badge and the list row before any business is opened.
    await expect(page.getByRole('list', { name: 'Bugün yapılacaklar' }).getByRole('listitem').filter({ hasText: 'Birinci talep' }).getByRole('button')).toHaveText('Talebi aç');
    await expect(yonetimNav(page).getByRole('button', { name: 'Destek', exact: true }).locator('.nav-badge')).toHaveText('2');
    await yonetimGo(page, 'İşletmeler');
    const row = page.locator('.platform-business-row').filter({ hasText: first.name }).first();
    await expect(row).toContainText('1 açık talep');
    await row.click();
    const dialog = page.getByRole('region', { name: first.name, exact: true });
    await detailTab(dialog, 'Destek').click();
    await expect(dialog.getByRole('region', { name: 'Destek talepleri' })).toContainText('1 açık destek talebi');
    // The business page's Destek tab is the same chat, for this business only; a ticket opens in place.
    await expect(dialog.locator('.tc-item')).toHaveCount(1);
    await dialog.locator('.tc-item').filter({ hasText: 'Birinci talep' }).click();
    await expect(dialog.getByRole('region', { name: 'Talep: Birinci talep' }).locator('.tc-row.theirs')).toContainText('Yardım almak istiyorum.');
    await dialog.getByRole('button', { name: 'Destek sayfasında aç' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByText('Hata takip kodunu sorgula', { exact: true }).click();
    await page.getByLabel('Takip kodu', { exact: true }).fill('eksik');
    await expect(page.getByRole('button', { name: 'Kaydı bul', exact: true })).toBeDisabled();
    await expect(page.getByText(/Tek bir geçerli takip kodu/)).toBeVisible();
    await page.getByLabel('Takip kodu', { exact: true }).fill('İşlem tamamlanamadı. Takip kodu: F155C0EF-A134-47BA-9385-60AF1EE039E2');
    await page.getByRole('button', { name: 'Kaydı bul', exact: true }).click();
    await expect(page.getByText(/Kayıt bulunamadı. Kod başka sunucuya/)).toBeVisible();

    await expect(page.getByRole('combobox', { name: 'Destek işletmesi' })).toHaveValue(first.tenantId);
    await expect(page.locator('.tc-item')).toHaveCount(1);
    await expect(page.locator('.tc-item')).toContainText('Birinci talep');
    await expect(page.locator('.tc-items li .tc-item-business-line')).toHaveText(first.name);
    await page.locator('.tc-item').click();
    const conversation = page.getByRole('region', { name: 'Talep: Birinci talep' });
    await expect(conversation.locator('.tc-head')).toContainText(first.name);
    await page.getByRole('combobox', { name: 'Destek işletmesi' }).selectOption(second.tenantId);
    await expect(page.locator('.tc-item')).toHaveCount(1);
    await expect(page.locator('.tc-item')).toContainText('İkinci talep');
    // Another business: the open conversation of the first one closes.
    await expect(conversation).toHaveCount(0);
    await page.getByRole('button', { name: 'Filtreleri temizle' }).click();
    await expect(page.locator('.tc-item')).toHaveCount(2);
    await expect(page.getByRole('combobox', { name: 'Destek işletmesi' })).toHaveValue('');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('support-business-selector.png'), fullPage: true });
    // A draft stays with its ticket: back to the list (Escape on a phone) and in again, the text is still there.
    await page.locator('.tc-item').filter({ hasText: 'Birinci talep' }).click();
    await conversation.getByRole('textbox', { name: 'Mesajınız', exact: true }).fill('Kaybolmaması gereken yanıt');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(conversation).toHaveCount(0);
    await page.locator('.tc-item').filter({ hasText: 'Birinci talep' }).click();
    await expect(conversation.getByRole('textbox', { name: 'Mesajınız', exact: true })).toHaveValue('Kaybolmaması gereken yanıt');
    await conversation.getByRole('textbox', { name: 'Mesajınız', exact: true }).fill('Tek kez kaydedilecek destek yanıtı');
    // Saved at Mola Merkez, but the answer is lost on the way: "Tekrar dene" sends the same request, saved once.
    await page.route('**/api/merkez/admin/tickets/reply', async route => {
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      await route.abort();
    });
    await conversation.getByRole('button', { name: 'Gönder', exact: true }).click();
    await expect(conversation.locator('.tc-failed')).toContainText('Gönderilemedi · Tekrar dene');
    await expect(conversation.getByRole('textbox', { name: 'Mesajınız', exact: true })).toHaveValue('');
    await expect(conversation.getByRole('button', { name: 'Gönder', exact: true })).toBeDisabled();
    await page.unroute('**/api/merkez/admin/tickets/reply');
    await conversation.getByRole('button', { name: 'Tekrar dene', exact: true }).click();
    await expect(conversation.locator('.tc-failed')).toHaveCount(0);
    await expect(conversation.locator('.tc-row.mine')).toHaveCount(1);
    const after = await yonetimState(page.request);
    expect(after.tickets.find((t: any) => t.subject === 'Birinci talep').messages.filter((m: any) => m.source === 'support')).toHaveLength(1);
    await conversation.getByRole('button', { name: 'Taleplere dön' }).click();
    await expect(conversation).toHaveCount(0);
    // The owner sees the answer arrive while the Destek screen is open, and replies from the café computer.
    await ensureSetup(owner.request);
    const ownerPage = await owner.newPage(); await ownerPage.goto('/');
    await ownerPage.getByRole('button', { name: 'Destek', exact: true }).click();
    await expect(ownerPage.locator('.tc-item .tc-chip')).toHaveText('Açık', { timeout: 15000 });
    await ownerPage.locator('.tc-item').click();
    const ownerThread = ownerPage.getByRole('region', { name: 'Talep: Birinci talep' });
    await expect(ownerThread.locator('.tc-row.theirs')).toContainText('Tek kez kaydedilecek destek yanıtı');
    await expect(ownerThread.locator('.tc-row.theirs .tc-sender')).toHaveText('Mola ekibi');
    await ownerThread.getByRole('textbox', { name: 'Mesajınız', exact: true }).fill('İşletmenin yazdığı yanıt');
    await ownerThread.getByRole('button', { name: 'Gönder', exact: true }).click();
    await expect(ownerThread.getByRole('textbox', { name: 'Mesajınız', exact: true })).toHaveValue('');
    await expect(ownerThread.locator('.tc-row.mine')).toHaveCount(2);
    await expect.poll(async () => (await yonetimState(page.request)).tickets.find((t: any) => t.subject === 'Birinci talep').messages.length, { timeout: 15000 }).toBe(3);
    await page.reload(); await yonetimGo(page, 'Destek');
    await page.locator('.tc-item').filter({ hasText: 'Birinci talep' }).click();
    await expect(conversation.getByRole('textbox', { name: 'Mesajınız', exact: true })).toHaveValue('');
    await expect(conversation.locator('.tc-row.theirs').last()).toContainText('İşletmenin yazdığı yanıt');
    // Closing, with the answer lost on the way: the retry closes it once, with one closing message.
    await page.route('**/api/merkez/admin/tickets/reply', async route => { const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort(); });
    await conversation.getByRole('button', { name: 'Talebi kapat', exact: true }).click();
    await conversation.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
    await expect(conversation.locator('.tc-failed')).toContainText('Gönderilemedi · Tekrar dene');
    await page.unroute('**/api/merkez/admin/tickets/reply');
    await conversation.getByRole('button', { name: 'Tekrar dene', exact: true }).click();
    await expect(conversation.getByRole('textbox', { name: 'Mesajınız', exact: true })).toHaveCount(0);
    await expect(conversation.locator('.tc-system').last()).toContainText('Talep kapatıldı');
    const closed = (await yonetimState(page.request)).tickets.find((t: any) => t.subject === 'Birinci talep');
    expect(closed.status).toBe('closed');
    expect(closed.messages.filter((m: any) => m.text === 'Sorun çözüldü. Destek talebi kapatıldı.')).toHaveLength(1);
    // The owner's screen follows: closed, no message box, a way to a new ticket.
    await expect(ownerPage.locator('.tc-item .tc-chip')).toHaveText('Kapandı', { timeout: 15000 });
    await expect(ownerThread.getByRole('textbox', { name: 'Mesajınız', exact: true })).toHaveCount(0);
    await expect(ownerThread.getByRole('button', { name: 'Yeni talep aç', exact: true })).toBeVisible();
  } finally { await owner.close(); await other.close(); }
});

test('8 Ekim Destek: the business name (header and list) opens a short preview; keyboard and Escape; a bottom sheet on phones', async ({ page, browser }, info) => {
  const owner = await browser.newContext();
  try {
    await owner.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
    expect((await owner.request.post('/api/staff/support', { data: { requestId: 'support-peek-create', subject: 'Önizleme talebi', text: 'Menü fotoğrafları görünmüyor.' } })).ok()).toBe(true);
    await openYonetim(page);
    await expect.poll(async () => (await yonetimState(page.request)).tickets.some((t: any) => t.subject === 'Önizleme talebi'), { timeout: 15000 }).toBe(true);
    const state = await yonetimState(page.request), cafe = state.businesses.find((l: any) => l.tenantId === 'mola-demo');
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.reload(); await yonetimGo(page, 'Destek');
    await page.locator('.tc-item').filter({ hasText: 'Önizleme talebi' }).click();
    const thread = page.getByRole('region', { name: 'Talep: Önizleme talebi' });
    const name = thread.locator('.tc-head').getByRole('button', { name: `${cafe.name}: işletme özeti` });
    await expect(name).toHaveAttribute('aria-expanded', 'false');
    await name.click();
    const peek = page.getByRole('dialog', { name: cafe.name });
    await expect(peek).toBeVisible();
    await expect(peek).toBeFocused();
    await expect(name).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Paket', 'Lisans', 'Deneme', 'Son bağlantı', 'QR siparişleri', 'Açık talep']) await expect(peek.locator('dt', { hasText: label })).toHaveCount(1);
    await expect(peek.locator('.status-chip')).toBeVisible();
    await expect(peek.locator('dt', { hasText: 'Açık talep' }).locator('xpath=following-sibling::dd')).toHaveText(String(cafe.openTickets));
    for (const button of ['İşletme sayfası', 'Hizmet', 'Lisans']) await expect(peek.getByRole('button', { name: button, exact: true })).toBeVisible();
    // The message box is not covered by it, and nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('destek-isletme-onizleme.png') });
    if (process.env.YONETIM_EKRAN) { mkdirSync(process.env.YONETIM_EKRAN, { recursive: true }); await page.screenshot({ path: `${process.env.YONETIM_EKRAN}/destek-isletme-onizleme.png` }); }
    // Escape closes it and gives the focus back to the name (the conversation stays open).
    await page.keyboard.press('Escape');
    await expect(peek).toHaveCount(0);
    await expect(name).toBeFocused();
    await expect(thread).toBeVisible();
    // Keyboard: Enter on the name opens it again; a click outside closes it.
    await page.keyboard.press('Enter');
    await expect(peek).toBeVisible();
    await page.mouse.click(5, 400);
    await expect(peek).toHaveCount(0);
    // The ticket list has the same name; "Lisans" opens the business page on its Lisans tab.
    const listName = page.locator('.tc-items li').filter({ hasText: 'Önizleme talebi' }).locator('.tc-item-business-line').getByRole('button', { name: `${cafe.name}: işletme özeti` });
    await listName.click();
    await expect(peek).toBeVisible();
    await peek.getByRole('button', { name: 'Lisans', exact: true }).click();
    const detail = page.getByRole('region', { name: cafe.name, exact: true });
    await expect(detail).toBeVisible();
    await expect(detailTab(detail, 'Lisans')).toHaveAttribute('aria-pressed', 'true');
    // A phone: a bottom sheet over a dimmed page.
    await yonetimGo(page, 'Destek');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.tc-items li').filter({ hasText: 'Önizleme talebi' }).locator('.tc-item-business-line').getByRole('button').click();
    await expect(peek).toHaveClass(/sheet/);
    const box = (await peek.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(843);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('destek-isletme-onizleme-telefon.png') });
    await page.keyboard.press('Escape');
    await expect(peek).toHaveCount(0);
  } finally { await owner.close(); }
});
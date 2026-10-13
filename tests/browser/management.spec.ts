import { bottomNav, cashAction, ensureSetup, moreSheet, openReport, openSettings, openStaff, openView, openYonetim, yonetimBell, yonetimGo, yonetimState } from './helpers';
import { test, expect, type BrowserContext } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
let ownerCookies: Awaited<ReturnType<BrowserContext['cookies']>>;

test('waiter approval, quick product code, cashier expenses, selected item payments and merging', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies); await page.goto('/');
  // Sipariş al is for everyone at the counter now (tables and masasız orders); only the kitchen has no order entry.
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Sipariş al', exact: true })).toHaveCount(1);
  // The owner has no kitchen place at all: the board (Mutfak modu) is the kitchen account's alone (İkiye böl puts both on one screen).
  await expect(page.getByRole('navigation').getByRole('button', { name: /Mutfak/ })).toHaveCount(0);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 0, commissionBps: null, waiterApproval: true } });
  const state = await (await page.request.get('/api/staff/state')).json();
  const [one, two, three] = state.tables.filter((t: any) => !t.account).slice(-3);
  const guestContext = await browser.newContext(), guest = await guestContext.newPage();
  await guest.goto(`/m/${one.token}`); await guest.getByRole('button', { name: /Demleme Çay/ }).click(); await guest.getByRole('button', { name: /Sepete ekle/ }).click(); await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click(); await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click(); await guest.getByRole('button', { name: 'Tamam', exact: true }).click(); await guest.getByRole('button', { name: /Siparişlerim/ }).click(); await expect(guest.getByText('Garson onayı bekleniyor', { exact: true })).toBeVisible();
  const waiterContext = await browser.newContext(); await waiterContext.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } }); const waiter = await waiterContext.newPage(); await waiter.goto('/'); await openView(waiter, 'Sipariş al'); // the waiter opens on Masalar (K6)
  await expect(waiter.locator('.approval-queue')).toContainText(one.name); await waiter.getByRole('button', { name: 'Onayla ve mutfağa gönder' }).click(); await expect(guest.getByText('Sipariş alındı', { exact: true })).toBeVisible();
  await waiter.getByLabel('Sipariş masası', { exact: true }).selectOption(two.id);
  // Waiters add with the card's "+" (no product-number box for them; the owner's is checked at the end).
  await expect(waiter.getByLabel('Sepete eklenecek ürün numarası')).toHaveCount(0); await waiter.getByRole('button', { name: /^Demleme Çay · bir adet ekle/ }).click(); await waiter.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click(); await waiter.getByRole('button', { name: 'Siparişi gönder', exact: true }).click(); await expect(waiter.getByText(/mutfağa gönderildi/)).toBeVisible();
  await waiter.getByRole('checkbox', { name: /Otomatik onay/ }).check(); await expect(waiter.locator('.approval-queue')).toContainText('Otomatik onay açık');
  await waiter.screenshot({ path: info.outputPath('waiter-approval.png'), fullPage: true });
  const cashierContext = await browser.newContext(); await cashierContext.request.post('/api/login', { data: { username: 'kasiyer', password: 'MolaDemo!2026' } }); const cashier = await cashierContext.newPage(); await cashier.goto('/');
  await expect(cashier.getByRole('navigation').getByRole('button', { name: 'Sipariş al', exact: true })).toHaveCount(1);
  await cashAction(cashier, 'Gider kaydet'); await cashier.getByLabel('Gider tutarı', { exact: true }).fill('25'); await expect(cashier.getByRole('button', { name: 'Gideri kaydet' })).toBeDisabled(); await cashier.getByLabel('Gider açıklaması', { exact: true }).fill('Test süt alımı'); await cashier.getByRole('radio', { name: /^Kasadan/ }).click(); await cashier.getByRole('button', { name: 'Gideri kaydet' }).click(); await expect(cashier.getByText('Gider kaydedildi.', { exact: true })).toBeVisible();
  await cashier.getByRole('button', { name: new RegExp(one.name) }).click(); await cashier.getByRole('button', { name: 'Taşı / birleştir', exact: true }).click(); await cashier.getByLabel('Hedef masa').selectOption(two.id); await cashier.getByRole('button', { name: `Hesapları birleştir · ${two.name}` }).click(); await expect(cashier.getByText(`Hesaplar ${two.name} üzerinde birleştirildi.`)).toBeVisible();
  await cashier.getByRole('button', { name: new RegExp(two.name) }).click(); await cashier.getByRole('button', { name: 'Ödeme al', exact: true }).click(); await cashier.getByRole('button', { name: 'Ürün seç', exact: true }).click(); await cashier.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).first().click(); await expect(cashier.getByText('Seçtiğiniz ürünlerin toplamı tahsil edilir: ₺35')).toBeVisible(); await cashier.getByLabel('Alınan nakit (TL)').fill('50'); await cashier.screenshot({ path: info.outputPath('cashier-item-payment.png') }); await cashier.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click(); await expect(cashier.getByText(/Ödeme kaydedildi. Kalan:/)).toBeVisible();
  await expect(cashier.getByRole('dialog')).toBeVisible(); await expect(cashier.locator('.payment-item.line-paid')).toContainText('Ödendi'); await cashier.getByRole('button', { name: 'Kapat', exact: true }).click();
  await cashier.getByRole('button', { name: new RegExp(three.name) }).click(); await cashier.getByRole('button', { name: 'Sipariş ekle', exact: true }).click(); await expect(cashier.getByRole('dialog')).toContainText('Ürün ekle'); await cashier.getByRole('button', { name: 'Kapat', exact: true }).click();
  // The quick product code: the counter's (owner, cashier) number box.
  await openView(page, 'Sipariş al'); await page.getByLabel('Sipariş masası', { exact: true }).selectOption(three.id);
  const code = page.getByLabel('Sepete eklenecek ürün numarası'); await expect(code).toHaveAttribute('inputmode', 'numeric'); await code.fill('21'); await page.getByRole('button', { name: 'Numarayla sepete ekle' }).click();
  await expect(page.getByRole('button', { name: /^Demleme Çay · bir adet ekle \(sepette 1\)/ })).toBeVisible();
  // 9 Ekim kullanıcı testi: the same number again grows the same line (K8), it does not add a second "1 Demleme Çay".
  await code.fill('21'); await page.getByRole('button', { name: 'Numarayla sepete ekle' }).click();
  await expect(page.getByRole('button', { name: /^Demleme Çay · bir adet ekle \(sepette 2\)/ })).toBeVisible();
  await page.getByRole('button', { name: /Sepeti görüntüle/ }).click();
  const basket = page.getByRole('dialog', { name: /· Sepet$/ });
  await expect(basket.getByRole('button', { name: 'Demleme Çay adedini artır' })).toHaveCount(1);
  await basket.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 60, commissionBps: null, waiterApproval: false } });
  await guestContext.close(); await waiterContext.close(); await cashierContext.close();
});

test('Mola Yönetim and the owner exchange a support ticket; the new ticket shows in the notification centre', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies); await page.goto('/'); await page.getByRole('button', { name: 'Destek', exact: true }).click();
  // The form opens with "Yeni talep" (8 Ekim: no longer open by default).
  await page.locator('.tc-list').getByRole('button', { name: 'Yeni talep', exact: true }).click();
  await page.getByLabel('Konu', { exact: false }).fill('Test destek talebi'); await page.getByLabel('Sorunu anlatın', { exact: false }).fill('Test ekranında yardım istiyorum.'); await page.getByRole('button', { name: 'Destek talebi aç' }).click(); await expect(page.getByRole('region', { name: 'Talep: Test destek talebi' })).toBeVisible();
  // Delivered once Mola Merkez confirmed it ("Gönderilmeyi bekliyor" goes away); the vendor answers in Mola Yönetim.
  await expect.poll(async () => (await (await page.request.get('/api/staff/support')).json()).tickets.some((t: any) => t.messages.some((m: any) => m.queued)), { timeout: 15000 }).toBe(false);
  await expect(page.locator('.tc-item').filter({ hasText: 'Test destek talebi' })).not.toContainText('Gönderilmeyi bekliyor');
  const context = await browser.newContext(), admin = await context.newPage(); await openYonetim(admin); await expect(admin.getByRole('heading', { name: 'Bugün yapılacaklar' })).toBeVisible();
  await expect.poll(async () => (await yonetimState(admin.request)).tickets.length, { timeout: 15000 }).toBeGreaterThan(0); await admin.reload();
  await yonetimGo(admin, 'Destek');
  await expect(admin.locator('.tc-item').filter({ hasText: 'Test destek talebi' }).locator('.tc-chip')).toHaveText('Yanıt bekleniyor');
  await admin.getByLabel('Destek talebi ara', { exact: true }).fill('BULUNMAYAN');
  await expect(admin.getByText('Bu aramaya uygun destek talebi bulunamadı.')).toBeVisible();
  await admin.getByLabel('Destek talebi ara', { exact: true }).fill('TEST DESTEK');
  await admin.locator('.tc-item').filter({ hasText: 'Test destek talebi' }).click();
  const conversation = admin.getByRole('region', { name: 'Talep: Test destek talebi' });
  await conversation.getByRole('textbox', { name: 'Mesajınız' }).fill('Kontrol edildi, sorun çözüldü.');
  await admin.route('**/api/merkez/admin/tickets/reply', async route => { await route.fetch(); await route.abort('failed'); await admin.unroute('**/api/merkez/admin/tickets/reply'); });
  await conversation.getByRole('button', { name: 'Talebi kapat', exact: true }).click(); await conversation.getByRole('button', { name: 'Evet, kapat', exact: true }).click();
  await expect(conversation.locator('.tc-failed')).toContainText('Gönderilemedi · Tekrar dene');
  await conversation.getByRole('button', { name: 'Tekrar dene', exact: true }).click(); await expect(conversation.locator('.tc-head .tc-chip')).toHaveText('Kapandı');
  await expect(conversation.locator('.tc-system').last()).toContainText('Talep kapatıldı');
  await expect(admin.getByLabel('Destek talebi ara', { exact: true })).toHaveValue('TEST DESTEK');
  await admin.getByRole('group', { name: 'Talep durumu' }).getByRole('button', { name: /Tümü/ }).click();
  await expect(admin.locator('.tc-item')).toContainText('Kontrol edildi, sorun çözüldü.');
  await admin.setViewportSize({ width: 390, height: 844 });
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await admin.screenshot({ path: info.outputPath('support-inbox-mobile.png'), fullPage: true });
  // On a phone the conversation covers the screen: back to the list before the bell.
  await conversation.getByRole('button', { name: 'Taleplere dön' }).click();
  await page.reload(); await page.getByRole('button', { name: 'Destek', exact: true }).click(); await expect(page.locator('.tc-item').filter({ hasText: 'Test destek talebi' }).locator('.tc-chip')).toHaveText('Kapandı', { timeout: 15000 }); await page.locator('.tc-item').filter({ hasText: 'Test destek talebi' }).click(); await expect(page.locator('.tc-row.theirs')).toContainText('Kontrol edildi, sorun çözüldü.');
  await yonetimBell(admin).click(); await expect(admin.getByRole('heading', { name: 'Bildirim merkezi' })).toBeVisible(); await expect(admin.locator('.alert-list li').filter({ hasText: 'Yeni destek talebi' }).filter({ hasText: 'Test destek talebi' })).toBeVisible(); for (let i = 0; i < 11; i++) {
    const created = await page.request.post('/api/staff/support', { data: { requestId: `support-pagination-${i}`, subject: `Liste testi ${i}`, text: 'Liste kontrolü için örnek talep.' } }); expect(created.ok()).toBe(true);
  }
  await page.reload(); await page.getByRole('button', { name: 'Destek', exact: true }).click();
  await expect(page.locator('.tc-item')).toHaveCount(12);
  await page.getByLabel('Destek talebi ara', { exact: true }).fill('TEST DESTEK');
  await expect(page.locator('.tc-item')).toHaveCount(1);
  await expect(page.locator('.tc-item .tc-chip')).toHaveText('Kapandı');
  await admin.screenshot({ path: info.outputPath('platform-notifications.png') }); await context.close();
});

test('owner adds custom category, creates a product, renames and reorders the customer menu', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies); await page.goto('/');
  const initial = await (await page.request.get('/api/staff/state')).json();
  for (const [id, subtype] of [['tea', 'Demleme'], ['herbal', 'Bitki']]) {
    const product = initial.products.find((p: { id: string }) => p.id === id);
    expect((await page.request.post('/api/staff/products', { data: { id, product: { ...product, subtype } } })).ok()).toBe(true);
  }
  await page.reload();
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Kategoriler ve sıra', exact: true }).click();
  // 13 Ekim: the order first; name, English name, sub-categories and delete behind each row's "Düzenle".
  const teaCategory = page.locator('.category-order-row').filter({ has: page.locator('strong', { hasText: /^Çaylar$/ }) });
  await teaCategory.locator('.category-order-main').getByRole('button', { name: 'Düzenle', exact: true }).click();
  await teaCategory.locator('summary', { hasText: /^Alt kategoriler/ }).click();
  await page.getByLabel('Çaylar yeni alt kategori adı', { exact: true }).fill('Özel harman');
  await teaCategory.getByRole('button', { name: 'Alt kategori ekle', exact: true }).click();
  await expect(teaCategory.locator('.subcategory-manage-row').filter({ hasText: 'Özel harman' })).toBeVisible();
  await page.getByRole('button', { name: 'Çaylar / Bitki yukarı', exact: true }).click();
  await expect(teaCategory.locator('.subcategory-manage-row').first()).toContainText('Bitki');
  const herb = teaCategory.locator('.subcategory-manage-row').filter({ has: page.locator('span', { hasText: /^Bitki$/ }) });
  await herb.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await page.getByLabel('Alt kategori yeni adı', { exact: true }).fill('Bitki çayları');
  await page.getByRole('button', { name: 'Alt kategori adını kaydet', exact: true }).click();
  await expect(teaCategory.locator('.subcategory-manage-row').first()).toContainText('Bitki çayları');
  const brewed = teaCategory.locator('.subcategory-manage-row').filter({ has: page.locator('span', { hasText: /^Demleme$/ }) });
  await brewed.getByRole('button', { name: 'Kaldır', exact: true }).click();
  await expect(brewed).toContainText('Ürünler silinmez.');
  await brewed.getByRole('button', { name: 'Alt kategoriyi kaldır', exact: true }).click();
  await expect(teaCategory.locator('.subcategory-manage-row')).toHaveCount(2);
  const afterSubcategory = await (await page.request.get('/api/staff/state')).json();
  expect(afterSubcategory.products.find((p: { id: string }) => p.id === 'tea').subtype).toBe('');
  await page.getByLabel('Yeni kategori adı').fill('Kahvaltılar'); await page.getByRole('button', { name: 'Kategori ekle', exact: true }).click();
  const row = page.locator('.category-order-row').filter({ hasText: 'Kahvaltılar' }); await expect(row).toBeVisible();
  await row.locator('.category-order-main').getByRole('button', { name: 'Düzenle', exact: true }).click();
  await row.getByRole('button', { name: 'Adını değiştir' }).click(); await row.getByLabel('Kategori yeni adı').fill('Kahvaltı'); await row.getByRole('button', { name: 'Adı kaydet' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Kahvaltı yukarı', exact: true }).click();
  // The guest tabs preview follows before saving; one "Sırayı kaydet" sends it.
  await expect(page.locator('.category-preview-tabs span').first()).toHaveText('Kahvaltı');
  await page.getByRole('button', { name: 'Sırayı kaydet', exact: true }).click();
  await expect(page.getByText('Sıra kaydedildi. Müşteri menüsü bu sırayla açılır.')).toBeVisible();
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  await page.getByLabel('Kategori', { exact: true }).selectOption('Çaylar');
  await expect(page.locator('#product-subtypes option[value="Özel harman"]')).toHaveCount(1);
  await page.getByLabel('Kategori', { exact: true }).selectOption('Kahvaltı');
  await page.getByLabel('Ürün adı', { exact: true }).fill('Simit tabağı'); await page.getByLabel('Fiyat (TL)', { exact: true }).fill('75');
  await page.getByRole('button', { name: 'Kaydet ve yayınla', exact: true }).click();
  await expect(page.locator('.menu-row').filter({ hasText: 'Simit tabağı' })).toBeVisible();
  await page.getByRole('button', { name: 'Kategoriler ve sıra', exact: true }).click();
  const breakfast = page.locator('.category-order-row').filter({ has: page.locator('strong', { hasText: /^Kahvaltı$/ }) });
  await breakfast.locator('.category-order-main').getByRole('button', { name: 'Düzenle', exact: true }).click();
  await expect(breakfast.getByRole('button', { name: /^Sil/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  let submitted = 0; page.on('request', r => { if (r.method() === 'POST' && /\/api\/(guest|staff)\/orders(?:\/|$)/.test(r.url())) submitted++; });
  await page.getByRole('button', { name: 'Menüyü önizle', exact: true }).click();
  const preview = page.frameLocator('iframe[title="Müşteri menüsü önizlemesi"]');
  await expect(preview.getByText('Önizleme modu. Gerçek sipariş oluşturulmaz.')).toBeVisible();
  await preview.getByRole('button', { name: 'Çaylar', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Özel harman', exact: true })).toHaveCount(0);
  await expect(preview.locator('.subcategory-tabs button').nth(1)).toHaveText('Bitki çayları');
  await preview.getByRole('button', { name: 'Bitki çayları', exact: true }).click();
  await expect(preview.locator('.product-card')).toHaveCount(1);
  await expect(preview.locator('.product-card')).toContainText('Ihlamur');
  for (const width of [320, 390, 768]) {
    await page.getByLabel('Önizleme ekran boyutu').selectOption(String(width));
    await expect.poll(async () => preview.locator('body').evaluate(() => innerWidth)).toBe(width);
    expect(await preview.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await preview.getByRole('button', { name: 'Kahvaltı', exact: true }).click();
  await preview.getByRole('button', { name: /Simit tabağı/ }).click();
  await expect(preview.getByRole('dialog').getByRole('button', { name: /Sepete ekle/ })).toBeDisabled();
  await expect(preview.getByRole('dialog')).toContainText('Bu ekrandan sipariş gönderilmez.');
  await preview.getByRole('button', { name: 'Kapat', exact: true }).click();
  await preview.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(preview.getByText('Preview only. No order will be placed.')).toBeVisible();
  expect(submitted).toBe(0);
  await page.getByLabel('Önizleme ekran boyutu').selectOption('390');
  await page.screenshot({ path: info.outputPath('menu-preview.png') });
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  const state = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext(); const guest = await context.newPage(); await guest.goto(`/m/${state.tables[0].token}`);
  await expect(guest.locator('.category-tabs button').nth(1)).toHaveText('Kahvaltı');
  // "Tümü" follows the same order (13 Ekim: it still listed the first-added category first).
  await expect(guest.locator('.product-card').first()).toContainText('Simit tabağı');
  await guest.getByRole('button', { name: 'Kahvaltı', exact: true }).click(); await expect(guest.getByRole('button', { name: /Simit tabağı/ })).toBeVisible();
  await context.close();
});
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}` });
  const login = await context.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  expect(login.ok()).toBe(true); await ensureSetup(context.request); ownerCookies = await context.cookies(); await context.close();
});

test('customer edits quantity/options and adds a product; lost update response retries once and kitchen sees changes', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies);
  await page.request.post('/api/staff/settings', { data: { changeSeconds: 60, commissionBps: null } });
  const before = await (await page.request.get('/api/staff/state')).json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(`/m/${before.tables[5].token}`);
  await guest.getByRole('button', { name: /Caffè Latte/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  await guest.getByRole('button', { name: /Siparişi değiştir/ }).click();
  const dialog = guest.getByRole('dialog');
  await dialog.getByLabel('Caffè Latte adet').fill('2');
  await dialog.getByLabel('Boy', { exact: true }).selectOption('large');
  await dialog.getByLabel('Ürün ekle', { exact: true }).selectOption('tea');
  await dialog.getByRole('button', { name: 'Seçili ürünü ekle' }).click();
  await expect(dialog.locator('.total-line')).toContainText('365');
  await guest.screenshot({ path: info.outputPath('edit-order-mobile.png'), fullPage: true });
  let lost = false;
  await guest.route('**/api/guest/orders/edit', async route => {
    if (!lost) { lost = true; await route.fetch(); await route.abort(); } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
  await dialog.getByRole('button', { name: 'Değişikliği yeniden kontrol et' }).click();
  await expect(guest.getByText('Siparişiniz güncellendi.')).toBeVisible();
  const after = await (await page.request.get('/api/staff/state')).json();
  const edited = after.orders.find((o: any) => !before.orders.some((old: any) => old.id === o.id));
  expect(edited.total).toBe(36500); expect(edited.version).toBe(2); expect(edited.lines).toHaveLength(2);
  expect(after.orders.length).toBe(before.orders.length + 1);
  expect(Date.parse(edited.editableUntil) - Date.parse(edited.createdAt)).toBe(60000);
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  // The kitchen account works in Mutfak modu: the board straight away, no menu.
  await page.goto('/'); await expect(page.locator('.kitchen-bar')).toBeVisible();
  const card = page.locator('.kitchen-card').filter({ hasText: before.tables[5].name });
  await expect(card).toContainText('Müşteri siparişi güncelledi');
  await expect(card).toContainText('Büyük boy');
  await expect(card.getByRole('button', { name: /Müşteri değiştirebilir/ })).toBeDisabled();
  expect((await page.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Masalar', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(before.tables[5].name) }).click();
  await expect(page.getByRole('button', { name: 'Ödeme al', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Masa ekle', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Taşı / birleştir', exact: true }).click();
  const destination = before.tables.filter((t: any) => !t.account && t.id !== before.tables[5].id).at(-1);
  await page.getByLabel('Hedef masa', { exact: true }).selectOption(destination.id);
  await page.getByRole('button', { name: `Hesabı taşı · ${destination.name}` }).click();
  await expect(page.getByText(`Hesap taşındı · ${destination.name}`)).toBeVisible();
  // A moved bill is not a paid one: no "Hesabınız kapandı", no review prompt, and the new table is not named.
  await expect(guest.getByText(/Siparişleriniz başka bir masaya taşındı\. Yeni masanızın QR kodunu okutun/).first()).toBeVisible();
  await expect(guest.getByText(/Hesabınız kapandı/)).toHaveCount(0);
  await guest.goto(`/m/${destination.token}`);
  await guest.getByRole('button', { name: /Siparişlerim/ }).click();
  await expect(guest.locator('.customer-order')).toContainText('365');
  await page.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } }); await page.goto('/');
  await expect(page.locator('.kitchen-bar')).toBeVisible();
  const movedCard = page.locator('.kitchen-card').filter({ has: page.getByRole('heading', { name: destination.name, exact: true }) });
  await expect(movedCard).toContainText(`Masa taşındı: ${before.tables[5].name}`);
  await page.screenshot({ path: info.outputPath('kitchen-updates.png'), fullPage: true });
  await context.close();
});

test('owner configures the business in three steps and keeps original QR codes', async ({ page }, info) => {
  await page.request.post('/api/login', { data: { username: 'diger', password: 'MolaDemo!2026' } });
  const before = await (await page.request.get('/api/staff/state')).json();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'İşletmenizi hazırlayalım' })).toBeVisible();
  // First step: the kind of business; a café keeps its menu.
  await expect(page.getByRole('radio', { name: /Kafe/ })).toBeChecked();
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  await page.getByRole('button', { name: 'Masa sayısı hakkında bilgi' }).click();
  await expect(page.getByRole('tooltip')).toContainText('sabit bir QR');
  await page.getByRole('button', { name: 'Masa sayısı hakkında bilgi' }).press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByLabel('İşletme adı', { exact: true }).fill('Deneme Bahçe Kafe');
  await page.getByLabel('Toplam masa sayısı', { exact: true }).fill('25');
  await page.getByRole('checkbox', { name: 'İç ve dış masaları ayır' }).check();
  await page.getByLabel('İç masa sayısı', { exact: true }).fill('15');
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  await page.getByLabel('Değişiklik süresi', { exact: true }).fill('60');
  await page.getByLabel('POS komisyonu', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Devam', exact: true }).click();
  await expect(page.locator('.setup-summary')).toContainText('Deneme Bahçe Kafe');
  await page.screenshot({ path: info.outputPath('setup-summary.png'), fullPage: true });
  await page.getByRole('button', { name: 'Kurulumu kaydet', exact: true }).click();
  await expect(page.getByText('İşletme ayarları kaydedildi.')).toBeVisible();
  const after = await (await page.request.get('/api/staff/state')).json();
  await page.reload(); await expect(page.getByRole('heading', { name: 'İşletmenizi hazırlayalım' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'İşletme kurulumu', exact: true })).toHaveCount(0);
  expect(after.name).toBe('Deneme Bahçe Kafe'); expect(after.tables).toHaveLength(25);
  expect(after.tables.filter((t: any) => t.area === 'inside')).toHaveLength(15); expect(after.tables.filter((t: any) => t.area === 'outside')).toHaveLength(10);
  await expect(page.locator('.table-area-section').filter({ has: page.getByRole('heading', { name: 'İç masalar', exact: true }) }).locator('.table-card')).toHaveCount(15);
  await expect(page.locator('.table-area-section').filter({ has: page.getByRole('heading', { name: 'Dış masalar', exact: true }) }).locator('.table-card')).toHaveCount(10);
  // The section picker is folded at the bottom of the table window, so "Ödeme al" stays on top.
  await page.locator('.table-card').first().click(); await page.getByText('Masa bölümü ·').click(); await page.getByRole('button', { name: 'Dış', exact: true }).click(); await expect(page.getByText('Masa bölümü güncellendi.', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await page.screenshot({ path: info.outputPath('table-areas.png'), fullPage: true });
  expect(after.tables[0].token).toBe(before.tables[0].token); expect(after.orders.length).toBe(before.orders.length);
  await page.getByRole('button', { name: 'Masa ekle', exact: true }).click();
  await page.getByRole('button', { name: 'Yeni masayı oluştur' }).click();
  await expect(page.getByRole('button', { name: /Masa 26/ })).toBeVisible();
  const table = (await (await page.request.get('/api/staff/state')).json()).tables.find((t: any) => t.name === 'Masa 26');
  await page.getByRole('button', { name: 'Masa çıkar', exact: true }).click();
  await page.getByLabel('Çıkarılacak masa', { exact: true }).selectOption(table.id);
  await page.getByRole('button', { name: 'Seçili masayı çıkar' }).click();
  await expect(page.getByRole('button', { name: /Masa 26/ })).toHaveCount(0);
});

test('owner creates and closes employee account; employee session is revoked', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies);
  await page.goto('/'); await openStaff(page, 'Çalışanlar');
  await page.getByRole('button', { name: 'Çalışan ekle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Çalışan ekle', exact: true });
  await dialog.getByLabel('Ad soyad', { exact: true }).fill('Deniz Test');
  await dialog.getByLabel('Yeni kullanıcı adı', { exact: true }).fill('deniz.e2e');
  await dialog.getByLabel('Yeni şifre', { exact: true }).fill('DenizTest!2026');
  await dialog.getByRole('button', { name: 'Hesabı oluştur', exact: true }).click();
  const row = page.locator('.employee-row').filter({ hasText: 'deniz.e2e' });
  await expect(row).toBeVisible();
  const context = await browser.newContext(); const employee = await context.newPage();
  await employee.goto('/'); await employee.getByLabel('Kullanıcı adı', { exact: true }).fill('deniz.e2e');
  await employee.getByLabel('Şifre', { exact: true }).fill('DenizTest!2026');
  await employee.getByRole('button', { name: 'Çalışma alanını aç' }).click();
  // A waiter opens on Masalar (8 Ekim denetimi K6); Sipariş al is one tap away.
  await openView(employee, 'Sipariş al');
  await expect(employee.getByLabel('Sipariş masası')).toBeVisible();
  await expect(employee.getByRole('button', { name: 'Çalışanlar', exact: true })).toHaveCount(0);
  await expect(employee.getByRole('button', { name: 'Satış ve Raporlar', exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'Hesabı kapat', exact: true }).click();
  await expect(row).toContainText('Kapalı');
  await expect(employee.getByLabel('Kullanıcı adı', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('employee-management.png'), fullPage: true });
  const order = await page.request.post('/api/staff/orders', { data: { requestId: 'chart-owner-order', tableId: 'table-1', expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] } });
  expect(order.ok()).toBe(true);
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Rapor bölümleri' })).toBeVisible();
  await page.getByRole('button', { name: '30 gün', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Günlük satış' })).toBeVisible();
  // Hovering a day shows that day's date and amount right above the bar.
  const lastDay = page.locator('.daily-bars button').last();
  await lastDay.hover();
  await expect(page.locator('.daily-card .chart-tip')).toContainText((await lastDay.getAttribute('aria-label'))!.split(': ')[1]);
  await page.screenshot({ path: info.outputPath('financial-report.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('financial-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await openReport(page, 'Çalışanlar');
  await expect(page.getByRole('heading', { name: 'Müşterilerin kendi verdiği siparişler' })).toBeVisible();
  await page.getByRole('button', { name: '30 gün', exact: true }).click();
  await expect(page.locator('.report-row').filter({ hasText: 'Deniz Test' })).toContainText('Kapalı hesap');
  await expect(page.locator('.report-row').filter({ hasText: 'Müşteri QR siparişi' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Çalışan sipariş dağılımı/ })).toBeVisible();
  await expect(page.locator('.employee-distribution:not(.self-service-report) .donut-legend')).not.toContainText('Müşteri QR siparişi');
  await expect(page.getByRole('heading', { name: 'Müşterilerin kendi verdiği siparişler' })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR sipariş payı/ })).toBeVisible();
  await expect(page.locator('.self-service-report')).toContainText('farklı tarayıcı');
  await page.screenshot({ path: info.outputPath('employee-report.png'), fullPage: true });
  await context.close();
});


test('discounted options, paid labels, cleaning colors and report tabs work together', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies); await page.goto('/');
  await openSettings(page, 'Masalar ve QR');
  await page.getByRole('checkbox', { name: /Masa temizliği takibi/ }).check();
  await expect(page.getByText('Ayarlar kaydedildi.', { exact: true })).toBeVisible();
  await openSettings(page, 'Sipariş ve onay');
  await page.getByLabel('Sipariş değişiklik süresi (saniye)').fill('0');
  await page.getByLabel('Sipariş değişiklik süresi (saniye)').press('Tab'); /* settings save themselves */
  await expect(page.getByText('Ayarlar kaydedildi.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün ekle', exact: true }).click();
  await page.getByLabel('Kategori', { exact: true }).selectOption('Kahveler');
  await expect(page.locator('#product-subtypes')).toHaveJSProperty('tagName', 'SELECT');
  await page.getByLabel('Ürün kodu', { exact: true }).fill('909');
  await page.getByLabel('Ürün adı', { exact: true }).fill('İndirimli boy testi');
  await page.getByLabel('Fiyat (TL)', { exact: true }).fill('50');
  if (!await page.getByRole('button', { name: 'Boy ekle', exact: true }).isVisible()) await page.locator('summary').filter({ hasText: 'Müşteri seçenekleri' }).click();
  await page.getByRole('button', { name: 'Boy ekle', exact: true }).click();
  await page.getByLabel('Ek ücret (TL)', { exact: true }).first().fill('-50');
  await expect(page.getByRole('button', { name: 'Kaydet ve yayınla', exact: true })).toBeDisabled();
  await page.getByLabel('Ek ücret (TL)', { exact: true }).first().fill('-10');
  await page.getByRole('button', { name: 'Kaydet ve yayınla', exact: true }).click();
  await expect(page.locator('.menu-row').filter({ hasText: 'İndirimli boy testi' })).toBeVisible();
  let state = await (await page.request.get('/api/staff/state')).json();
  const table = state.tables.find((t: any) => !t.account && !t.needsCleaning);
  const product = state.products.find((p: any) => p.code === '909');
  await page.getByRole('button', { name: 'Masalar', exact: true }).click();
  const card = page.locator('.table-card').filter({ has: page.getByRole('heading', { name: table.name, exact: true }) });
  await expect(card).toHaveClass(/available/);
  const guestContext = await browser.newContext(), guest = await guestContext.newPage();
  await guest.goto('/m/' + table.token);
  await expect(card).toHaveClass(/available/);
  await guest.getByRole('button', { name: /İndirimli boy testi/ }).click();
  await guest.locator('.options label').filter({ hasText: product.groups[0].options[0].name }).click();
  await expect(guest.getByRole('button', { name: /Sepete ekle/ })).toContainText('40');
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await guest.getByRole('button', { name: 'Tamam', exact: true }).click();
  await expect(card).toHaveClass(/waiting/);
  state = await (await page.request.get('/api/staff/state')).json();
  const order = state.orders.find((o: any) => o.accountId === state.tables.find((t: any) => t.id === table.id).account.id);
  expect(order.total).toBe(4000);
  for (const [n, status] of ['preparing', 'ready', 'served'].entries()) expect((await page.request.post('/api/staff/status', { data: { requestId: 'color-status-' + n, orderId: order.id, version: order.version + n, status } })).ok()).toBe(true);
  await expect(card).toHaveClass(/served/);
  expect((await page.request.post('/api/staff/orders', { data: { requestId: 'paid-label-extra', tableId: table.id, expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] } })).ok()).toBe(true);
  await expect(card).toHaveClass(/waiting/);
  await card.click(); await page.getByRole('button', { name: 'Ödeme al', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün seç', exact: true }).click();
  await page.getByRole('button', { name: 'İndirimli boy testi bir adet ekle' }).click();
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.getByText(/Ödeme kaydedildi. Kalan:/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: table.name + ' · Ödeme al', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ürün seç', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.payment-item.line-paid')).toContainText('Ödendi');
  await expect(page.getByRole('button', { name: 'İndirimli boy testi bir adet ekle' })).toBeDisabled();
  await page.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click();
  await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(card).toHaveClass(/needs-cleaning/);
  await guest.reload(); await expect(guest.getByText(/Masa temizlik bekliyor/)).toBeVisible();
  const blocked = await page.request.post('/api/staff/orders', { data: { requestId: 'blocked-cleaning-order', tableId: table.id, expectedTotal: 3500, lines: [{ productId: 'tea', quantity: 1, selections: [] }] } });
  expect(blocked.status()).toBe(409);
  const waiterContext = await browser.newContext(); await waiterContext.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } });
  const waiter = await waiterContext.newPage(); await waiter.goto('/'); await waiter.getByRole('button', { name: 'Masalar', exact: true }).click();
  await waiter.locator('.table-card').filter({ has: waiter.getByRole('heading', { name: table.name, exact: true }) }).click();
  await waiter.getByRole('button', { name: 'Temizlendi · Masayı hazırla' }).click();
  await expect(card).toHaveClass(/available/);
  await expect(guest.getByText(/Masa temizlik bekliyor/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ürün satışları' })).toHaveCount(0);
  await expect(page.locator('.kpi-main')).toContainText('Elde kalan');
  await openReport(page, 'Ürünler');
  await expect(page.getByRole('heading', { name: 'Ürün satışları' })).toBeVisible();
  await expect(page.locator('.kpi-main')).toHaveCount(0);
  await openReport(page, 'Çalışanlar');
  for (const label of ['7 gün', 'Tümü']) { await page.getByRole('button', { name: label, exact: true }).click(); await expect(page.getByRole('heading', { name: 'Müşterilerin kendi verdiği siparişler' })).toBeVisible(); }
  await page.request.post('/api/staff/settings', { data: { cleaningEnabled: false, changeSeconds: 60, commissionBps: null, waiterApproval: false } });
  await guestContext.close(); await waiterContext.close();
});

test('help tips stay inside viewport and support stays separate on desktop and mobile', async ({ page }, info) => {
  await page.context().addCookies(ownerCookies); await page.goto('/');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Destek', exact: true })).toHaveCount(0);
  await openStaff(page, 'Çalışanlar');
  await page.getByRole('button', { name: 'Çalışan ekle', exact: true }).click();
  for (const role of ['waiter', 'cashier', 'kitchen']) {
    await page.getByLabel('Görevi', { exact: true }).selectOption(role);
    await page.getByRole('button', { name: 'Çalışan yetkileri hakkında bilgi' }).click();
    await expect(page.getByRole('tooltip')).toContainText(role === 'kitchen' ? 'Yalnızca Mutfak' : role === 'cashier' ? 'Masalar ekranından ödeme' : 'Sipariş al, Masalar');
    await page.getByRole('button', { name: 'Çalışan yetkileri hakkında bilgi' }).press('Escape');
  }
  await page.getByRole('button', { name: 'Kapat', exact: true }).click();
  await openSettings(page, 'Sipariş ve onay');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Garson onayı hakkında bilgi' }).click();
    const bounds = await page.getByRole('tooltip').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('help-' + width + '.png'), fullPage: true });
    await page.getByRole('button', { name: 'Garson onayı hakkında bilgi' }).press('Escape');
    // Desktop: Destek at the bottom of the sidebar. Phones: an item of the bottom bar's "Daha fazla", never a button floating over content.
    if (width > 600) await expect(page.locator('.sidebar-bottom').getByRole('button', { name: 'Destek', exact: true })).toBeInViewport();
    else {
      await expect(page.locator('.sidebar-bottom')).toBeHidden();
      await bottomNav(page).getByRole('button', { name: /^Daha fazla/ }).click();
      await expect(moreSheet(page).getByRole('button', { name: /^Destek/ })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(moreSheet(page)).toHaveCount(0);
    }
  }
});


test('partial item payment survives a lost response and waiter serves a paid order', async ({ page, browser }) => {
  await page.context().addCookies(ownerCookies); await page.goto('/');
  await page.request.post('/api/staff/settings', { data: { cleaningEnabled: false, changeSeconds: 0, commissionBps: null, waiterApproval: false } });
  let state = await (await page.request.get('/api/staff/state')).json(); const table = state.tables.find((t: any) => !t.account);
  const response = await page.request.post('/api/staff/orders', { data: { requestId: 'partial-retry-order', tableId: table.id, expectedTotal: 10500, lines: [{ productId: 'tea', quantity: 3, selections: [] }] } }); expect(response.ok()).toBe(true);
  const { orderId } = await response.json();
  for (const [n, status] of ['preparing', 'ready'].entries()) expect((await page.request.post('/api/staff/status', { data: { requestId: 'partial-retry-status-' + n, orderId, version: n + 1, status } })).ok()).toBe(true);
  await page.reload(); await page.locator('.table-card').filter({ has: page.getByRole('heading', { name: table.name, exact: true }) }).click(); await page.getByRole('button', { name: 'Ödeme al', exact: true }).click(); await page.getByRole('button', { name: 'Ürün seç', exact: true }).click();
  let lost = false; await page.route('**/api/staff/payments', async route => { if (!lost) { lost = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await page.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click(); await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await page.getByRole('button', { name: 'Tahsilatı yeniden kontrol et', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('.payment-item')).toContainText('1 / 3 adet ödendi');
  await page.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click(); await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click();
  await expect(page.locator('.payment-item')).toContainText('2 / 3 adet ödendi');
  await page.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click(); await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const context = await browser.newContext(); await context.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } }); const waiter = await context.newPage(); await waiter.goto('/'); await waiter.getByRole('navigation').getByRole('button', { name: 'Servise hazır', exact: false }).click();
  const ready = waiter.locator('.ready-orders article').filter({ hasText: '#' + (await (await page.request.get('/api/staff/state')).json()).orders.find((o: any) => o.id === orderId).number });
  await expect(ready).toContainText(table.name); await ready.getByRole('button', { name: 'Teslim edildi', exact: true }).click(); await expect(ready).toHaveCount(0); await context.close();
});


test('pay first shows a disabled kitchen action until cashier payment, then waiter delivers', async ({ page, browser }, info) => {
  await page.context().addCookies(ownerCookies); await page.goto('/');
  await openSettings(page, 'Sipariş ve onay'); await page.getByLabel('Ödeme sırası', { exact: true }).selectOption('before_preparation'); /* no change window: the switch off (it may be off already) */ { const change = page.getByRole('checkbox', { name: /değiştirip iptal edebilsin/ }); if (await change.isChecked()) await change.uncheck(); await expect(change).not.toBeChecked(); } /* settings save themselves */ await expect(page.getByText('Ayarlar kaydedildi.', { exact: true })).toBeVisible(); await openSettings(page, 'Masalar ve QR'); await page.getByRole('checkbox', { name: /Masa temizliği takibi/ }).check(); await expect.poll(async () => (await (await page.request.get('/api/staff/state')).json()).cleaningEnabled).toBe(true);
  let s = await (await page.request.get('/api/staff/state')).json(); const table = s.tables.find((t: any) => !t.account && !t.needsCleaning);
  const orderResponse = await page.request.post('/api/staff/orders', { data: { requestId: 'pay-first-ui-order', tableId: table.id, expectedTotal: 7000, lines: [{ productId: 'tea', quantity: 2, selections: [] }] } }); expect(orderResponse.ok()).toBe(true); const { orderId, number } = await orderResponse.json();
  const kitchenContext = await browser.newContext(); expect((await kitchenContext.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } })).ok()).toBe(true); const kitchen = await kitchenContext.newPage(); await kitchen.goto('/');
  const kitchenCard = kitchen.locator('.kitchen-card').filter({ has: kitchen.locator('.order-head > span', { hasText: new RegExp('^#' + number + '$') }) });
  await expect(kitchenCard.getByRole('button', { name: 'Ödeme bekleniyor' })).toBeDisabled(); await kitchenCard.screenshot({ path: info.outputPath('payment-locked.png') });
  await page.getByRole('button', { name: 'Masalar', exact: true }).click(); const tableCard = page.locator('.table-card').filter({ has: page.getByRole('heading', { name: table.name, exact: true }) }); await tableCard.click(); await page.getByRole('button', { name: 'Ödeme al', exact: true }).click();
  await page.getByRole('button', { name: 'Ürün seç', exact: true }).click(); await page.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click(); await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click(); await expect(page.locator('.payment-item')).toContainText('1 / 2 adet ödendi'); await page.getByRole('dialog').screenshot({ path: info.outputPath('partial-payment-open.png') }); await expect(kitchenCard.getByRole('button', { name: 'Ödeme bekleniyor' })).toBeDisabled();
  await page.getByRole('button', { name: 'Demleme Çay bir adet ekle' }).click(); await page.getByRole('button', { name: 'Ödemeyi kaydet', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(kitchenCard.getByRole('button', { name: /Ödeme alındı · Hazırlamaya başla/ })).toBeEnabled(); await expect(tableCard).toHaveClass(/waiting/);
  await kitchenCard.getByRole('button', { name: /Hazırlamaya başla/ }).click(); await kitchenCard.getByRole('button', { name: 'Hazır olarak işaretle' }).click();
  const waiterContext = await browser.newContext(); expect((await waiterContext.request.post('/api/login', { data: { username: 'garson', password: 'MolaDemo!2026' } })).ok()).toBe(true); const waiter = await waiterContext.newPage(); await waiter.goto('/'); await waiter.getByRole('navigation').getByRole('button', { name: /Servise hazır/ }).click();
  const ready = waiter.locator('.ready-orders article').filter({ has: waiter.getByRole('heading', { name: table.name + ' · #' + number, exact: true }) }); await expect(ready).toContainText('Ödendi'); await ready.getByRole('button', { name: 'Teslim edildi', exact: true }).click(); await expect(ready).toHaveCount(0); await expect(kitchenCard).toHaveCount(0); await expect(tableCard).toHaveClass(/needs-cleaning/);
  s = await (await page.request.get('/api/staff/state')).json(); expect(s.tables.find((t: any) => t.id === table.id).account).toBeNull();
  await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, changeSeconds: 60, commissionBps: null } }); await kitchenContext.close(); await waiterContext.close();
});

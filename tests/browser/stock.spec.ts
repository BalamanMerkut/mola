import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureSetup, openReport, reportGroups, reportTabs } from './helpers';

const VIEWPORTS = [[360, 800], [390, 844], [768, 1024], [820, 1180], [1024, 768], [1280, 860]] as const;
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Screens for the owner's guide: also saved to KAFE_EKRAN (docs/ekran/kafe) when that is set. */
async function shot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file), fullPage }); }
}
/** Every text field and list in view is at least 16 px (phones and tablets would zoom in otherwise). */
async function fieldsAtLeast16(page: Page, scope = 'body') {
  const sizes = await page.locator(`${scope} input:visible, ${scope} select:visible`).evaluateAll(list => list.filter(e => (e as HTMLInputElement).type !== 'checkbox').map(e => parseFloat(getComputedStyle(e).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
}
const nav = (page: Page, name: string) => page.locator('.sidebar nav').getByRole('button', { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stok bölümleri' }).getByRole('button', { name: new RegExp(`^${name}`) });

async function sell(request: APIRequestContext, lines: { productId: string; quantity: number; selections: { groupId: string; optionId: string }[] }[], tableId: string) {
  const state = await (await request.get('/api/staff/state')).json();
  const total = lines.reduce((n, l) => { const p = state.products.find((x: any) => x.id === l.productId); return n + (p.price + l.selections.reduce((m, s) => m + p.groups.find((g: any) => g.id === s.groupId).options.find((o: any) => o.id === s.optionId).extra, 0)) * l.quantity; }, 0);
  const r = await request.post('/api/staff/orders', { data: { requestId: crypto.randomUUID(), tableId, lines, expectedTotal: total } });
  expect(r.ok(), await r.text()).toBe(true);
}

test('Stok: ingredients → recipe with options → sales lower the stock → Ürünler shows ≈N → Kârlılık; fits every screen', async ({ page, browser }, info) => {
  test.setTimeout(360000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');

  // Stok opens on Malzemeler; the parts read Malzemeler · Reçeteler · Ürünler · Alış ve sayım.
  await nav(page, 'Stok').click();
  await expect(page.getByRole('navigation', { name: 'Stok bölümleri' }).getByRole('button')).toHaveText([/^Malzemeler/, /^Reçeteler/, /^Ürünler/, /^Alış ve sayım/]);
  await expect(tab(page, 'Malzemeler')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Henüz malzeme yok')).toBeVisible();
  // Nothing set up yet: a quiet guide, every product "Takip yok".
  await tab(page, 'Ürünler').click();
  await expect(page.getByRole('heading', { name: 'Stok takibi henüz başlamadı' })).toBeVisible();
  await expect(page.locator('.stock-row').filter({ hasText: 'Caffè Latte' })).toContainText('Takip yok');

  // The first two ingredients through the window: Kahve (1 kg, warn under 200 g, ₺900/kg) and Süt (10 L, warn under 2 L, ₺40/L).
  await page.getByRole('button', { name: 'İlk malzemeyi ekle' }).click();
  let dialog = page.getByRole('dialog', { name: 'Malzeme ekle' });
  await dialog.getByLabel('Malzeme adı *').fill('Kahve');
  await dialog.getByLabel('Şu an elinizde ne kadar var?', { exact: true }).fill('1');
  // 8 Ekim: "En az (uyarı sınırı)" was not understood. Now "Uyarı sınırı" with its unit, a grey ⓘ and a plain line under it.
  const limit = dialog.getByLabel('Uyarı sınırı', { exact: true });
  await expect(limit).toHaveAccessibleDescription('İsteğe bağlı. Boş bırakırsanız uyarı gelmez.');
  await limit.fill('0,2');
  await expect(dialog.getByLabel('Uyarı sınırı birimi')).toHaveValue('kg');
  await expect(limit).toHaveAccessibleDescription('Kalan miktar 200 g sınırının altına inince size “Azalıyor” bildirimi gelir.');
  for (const name of ['Ölçü birimi', 'Şu an elinizde ne kadar var?', 'Birim fiyat (TL / kg)']) await expect(dialog.getByRole('button', { name: `${name} hakkında bilgi` })).toBeVisible();
  await dialog.getByLabel('Birim fiyat (TL / kg)', { exact: true }).fill('900');
  await dialog.getByRole('button', { name: 'Uyarı sınırı hakkında bilgi' }).click();
  await expect(page.getByRole('tooltip')).toHaveText('Stok bu miktarın altına düşünce size “Azalıyor” bildirimi gelir (üst çubuktaki zil: Bildirimler). Örnek: süt için 2 litre, kahve için 500 gram.');
  await shot(page, 'stok-malzeme-ekle.png', info.outputPath('stok-malzeme-ekle.png'), false);
  for (const [width, height] of [[360, 800], [390, 844]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Malzeme ekle ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });
  await dialog.getByRole('button', { name: 'Malzemeyi ekle' }).click();
  await expect(page.getByText('Kahve eklendi.')).toBeVisible();
  await page.getByRole('button', { name: 'Malzeme ekle' }).click();
  dialog = page.getByRole('dialog', { name: 'Malzeme ekle' });
  await dialog.getByLabel('Malzeme adı *').fill('Süt');
  await dialog.getByRole('button', { name: 'ml · Litre' }).click();
  await dialog.getByLabel('Şu an elinizde ne kadar var?', { exact: true }).fill('10');
  await dialog.getByLabel('Uyarı sınırı', { exact: true }).fill('2');
  await dialog.getByLabel('Birim fiyat (TL / L)', { exact: true }).fill('40');
  await dialog.getByRole('button', { name: 'Malzemeyi ekle' }).click();
  await expect(page.getByText('Süt eklendi.')).toBeVisible();
  // The rest straight to the server: Yulaf sütü, Şeker, Limon.
  for (const item of [{ name: 'Yulaf sütü', unit: 'ml', initial: 2000, unitCost: 8 }, { name: 'Şeker', unit: 'g', initial: 5000, min: 1000, unitCost: 4 }, { name: 'Limon', unit: 'piece', initial: 40, min: 10, unitCost: 500 }])
    expect((await page.request.post('/api/staff/stock/items', { data: item })).ok()).toBe(true);
  const stock = await (await page.request.get('/api/staff/stock')).json(), id = (name: string) => stock.items.find((i: any) => i.name === name).id;

  // Caffè Latte's recipe in the window: 18 g kahve + 200 ml süt; Büyük boy %150, Yulaf sütü instead of süt.
  await tab(page, 'Reçeteler').click();
  await page.getByRole('button', { name: 'Caffè Latte reçetesi yok' }).click();
  dialog = page.getByRole('dialog', { name: 'Caffè Latte · Reçete' });
  await dialog.getByLabel('1. malzeme', { exact: true }).selectOption({ label: 'Kahve' });
  await dialog.getByLabel('1. malzemenin miktarı', { exact: true }).fill('18');
  await dialog.getByRole('button', { name: 'Malzeme ekle' }).click();
  await dialog.getByLabel('2. malzeme', { exact: true }).selectOption({ label: 'Süt' });
  await dialog.getByLabel('2. malzemenin miktarı', { exact: true }).fill('200');
  await dialog.getByText('Seçenekler stoktan düşen miktarı değiştiriyor mu?').click();
  await dialog.getByLabel('Büyük boy seçeneği reçeteyi nasıl değiştirir').selectOption('scale');
  await dialog.getByLabel('Büyük boy için yüzde').fill('150');
  await dialog.getByLabel('Yulaf sütü seçeneği reçeteyi nasıl değiştirir').selectOption('replace');
  await dialog.getByLabel('Yulaf sütü: yerine kullanılmayan malzeme').selectOption({ label: 'Süt' });
  await dialog.getByLabel('Yulaf sütü: kullanılan malzeme').selectOption({ label: 'Yulaf sütü' });
  // Cost of a plain latte with today's prices: 18 g × ₺0,90 + 200 ml × ₺0,04 = ₺24,20.
  await expect(dialog.locator('.stock-cost-preview')).toContainText('₺24,20');
  await page.setViewportSize({ width: 1280, height: 1060 });
  await shot(page, 'stok-recete.png', info.outputPath('stok-recete.png'), false);
  for (const [width, height] of [[390, 844], [820, 1180]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `recipe window ${width}`).toBe(true); await fieldsAtLeast16(page, '.stock-recipe-modal'); }
  await page.setViewportSize({ width: 1280, height: 860 });
  await dialog.getByRole('button', { name: 'Reçeteyi kaydet' }).click();
  await expect(page.getByText('Caffè Latte reçetesi kaydedildi.')).toBeVisible();
  await expect(page.locator('.stock-row').filter({ hasText: 'Caffè Latte' })).toContainText('Kahve 18 g · Süt 200 ml');
  // Türk Kahvesi (30 g kahve), limonata (2 limon, 30 g şeker) and the ready-bought cheesecake through the server.
  for (const body of [{ productId: 'turkish', mode: 'recipe', items: [{ itemId: id('Kahve'), amount: 30 }] }, { productId: 'lemonade', mode: 'recipe', items: [{ itemId: id('Limon'), amount: 2 }, { itemId: id('Şeker'), amount: 30 }] }, { productId: 'cheesecake', mode: 'ready' }])
    expect((await page.request.post('/api/staff/stock/recipes', { data: body })).ok()).toBe(true);
  const cake = (await (await page.request.get('/api/staff/stock')).json()).items.find((i: any) => i.productId === 'cheesecake');
  expect((await page.request.post('/api/staff/stock/purchase', { data: { requestId: crypto.randomUUID(), itemId: cake.id, quantity: 12, total: 12 * 12000 } })).ok()).toBe(true);

  // Sales: 2 lattes, a big oat latte, 2 Türk kahvesi, 3 cheesecakes, 2 teas (no recipe).
  const tables = (await (await page.request.get('/api/staff/state')).json()).tables;
  await sell(page.request, [{ productId: 'latte', quantity: 2, selections: [{ groupId: 'size', optionId: 'regular' }] }, { productId: 'latte', quantity: 1, selections: [{ groupId: 'size', optionId: 'large' }, { groupId: 'milk', optionId: 'oat' }] }, { productId: 'turkish', quantity: 2, selections: [{ groupId: 'sugar', optionId: 'none' }] }], tables[0].id);
  await sell(page.request, [{ productId: 'cheesecake', quantity: 3, selections: [] }, { productId: 'tea', quantity: 2, selections: [] }], tables[1].id);

  // Ürünler: kahve 1000 − (36 + 27 + 60) = 877 g, süt 9 600 ml → ≈ 48 latte (süt sınırlıyor), ≈ 29 Türk kahvesi, 9 cheesecake left.
  // 34 limon thrown away: 6 left, under the minimum of 10.
  expect((await page.request.post('/api/staff/stock/waste', { data: { requestId: crypto.randomUUID(), itemId: id('Limon'), quantity: 34, reason: 'Bozuldu' } })).ok()).toBe(true);
  await tab(page, 'Ürünler').click();
  const latteRow = page.locator('.stock-row').filter({ hasText: 'Caffè Latte' });
  await expect(latteRow).toContainText('≈ 48 adet yapılabilir');
  // 8 Ekim: "süt yüzünden" was not understood: "Sınırlayan malzeme: Süt" and its ⓘ with the numbers.
  await expect(latteRow.locator('.stock-row-limit')).toContainText('Sınırlayan malzeme: Süt');
  await expect(latteRow).not.toContainText('yüzünden');
  await latteRow.getByRole('button', { name: 'Sınırlayan malzeme hakkında bilgi' }).click();
  await expect(page.getByRole('tooltip')).toHaveText('Bu üründen en fazla 48 adet yapılabilir; çünkü tarifindeki malzemeler arasında en önce süt bitecek (stok: 9,6 L, ürün başına 200 ml).');
  await expect(page.getByRole('dialog')).toHaveCount(0); // the ⓘ is not the row's button: no recipe window
  await expect(page.locator('.stock-row').filter({ hasText: 'Türk Kahvesi' }).locator('.stock-row-limit')).toContainText('Sınırlayan malzeme: Kahve');
  await expect(page.locator('.stock-row').filter({ hasText: 'Türk Kahvesi' })).toContainText('≈ 29 adet yapılabilir');
  await expect(page.locator('.stock-row').filter({ hasText: 'San Sebastian' })).toContainText('9 adet kaldı');
  await expect(page.locator('.stock-row').filter({ hasText: 'Demleme Çay' })).toContainText('Takip yok');
  const lemonade = page.locator('.stock-row').filter({ hasText: 'Ev Yapımı Limonata' });
  await expect(lemonade).toHaveClass(/low/); await expect(lemonade).toContainText('≈ 3 adet yapılabilir'); await expect(lemonade).toContainText('Azalıyor');
  await shot(page, 'stok-urunler.png', info.outputPath('stok-urunler.png'), false);
  await page.keyboard.press('Escape');

  // Malzemeler: the cards show the new amounts, how many lattes the coffee alone is enough for, and a low item warns.
  await tab(page, 'Malzemeler').click();
  const card = (name: string) => page.locator('.stock-item').filter({ has: page.locator('.stock-item-head strong').getByText(name, { exact: true }) });
  const coffee = card('Kahve');
  await expect(coffee.locator('.stock-item-amount')).toHaveText('877 g');
  await expect(coffee.locator('.stock-hints')).toContainText('≈ 48 caffè latte');
  await expect(card('Süt').locator('.stock-item-amount')).toHaveText('9,6 L');
  const lemon = card('Limon');
  await expect(lemon).toHaveClass(/low/); await expect(lemon).toContainText('Az kaldı');
  await expect(tab(page, 'Malzemeler').locator('.pill-tab-badge')).toHaveText('1');
  await shot(page, 'stok-malzemeler.png', info.outputPath('stok-malzemeler.png'));

  // Alış ve sayım: a purchase that is also an expense, and a count with its difference.
  await tab(page, 'Alış ve sayım').click();
  await page.getByRole('button', { name: /^Alış kaydet/ }).click();
  dialog = page.getByRole('dialog', { name: 'Alış kaydet' });
  await dialog.getByLabel('Malzeme *').selectOption({ label: 'Limon' });
  await dialog.getByLabel('Alınan miktar *', { exact: true }).fill('30');
  await dialog.getByLabel('Toplam tutar (TL)').fill('150');
  await expect(dialog.locator('.stock-calc')).toContainText('₺5 / adet');
  // 9 Ekim K-K: no "Gider olarak da kaydet" box to forget; one question, nothing chosen beforehand: saving waits for it.
  await expect(dialog.getByLabel(/Gider olarak da kaydet/)).toHaveCount(0);
  const paid = dialog.getByRole('radiogroup', { name: 'Para nereden çıktı' });
  await expect(paid.getByRole('radio')).toHaveCount(3);
  await expect(paid.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(dialog.getByText('Paranın nereden çıktığını seçin.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Alışı kaydet' })).toBeDisabled();
  // Kasa dışından: then how (Kasa dışı nakit / Kart / Havale / Diğer); none of them touches the drawer.
  await paid.getByRole('radio', { name: /^Kasa dışından/ }).click();
  await expect(dialog.getByRole('button', { name: 'Alışı kaydet' })).toBeDisabled();
  await expect(dialog.getByLabel('Nasıl ödendi', { exact: true }).locator('option')).toHaveText(['Seçin', 'Kasa dışı nakit (cepten / bankadan)', 'Kart', 'Havale / EFT', 'Diğer']);
  await dialog.getByLabel('Nasıl ödendi', { exact: true }).selectOption({ label: 'Kasa dışı nakit (cepten / bankadan)' });
  await expect(dialog.getByText("Giderler'e bugünün gideri olarak yazılır; kasadaki nakit değişmez.")).toBeVisible();
  await dialog.getByRole('button', { name: 'Alışı kaydet' }).click();
  await expect(page.getByText('Limon: 30 adet alış kaydedildi. Gider olarak da yazıldı (kasa dışından).')).toBeVisible();
  // K2 (10 Ekim): the green line opens Kasa ve giderler → Giderler → Kayıtlar on that very record.
  await page.locator('.notice').filter({ hasText: 'Limon: 30 adet' }).getByRole('button', { name: 'Giderlerde gör' }).click();
  await expect(page.locator('tr.expense-focus')).toContainText('Stok alışı: Limon 30 adet');
  await nav(page, 'Stok').click();
  await tab(page, 'Alış ve sayım').click();
  // Ödenmedi (veresiye): the stock only; a short line says no expense is written.
  await page.getByRole('button', { name: /^Alış kaydet/ }).click();
  dialog = page.getByRole('dialog', { name: 'Alış kaydet' });
  await dialog.getByLabel('Malzeme *').selectOption({ label: 'Limon' });
  await dialog.getByLabel('Alınan miktar *', { exact: true }).fill('20');
  await dialog.getByLabel('Toplam tutar (TL)').fill('100');
  await dialog.getByRole('radio', { name: /^Ödenmedi \(veresiye\)/ }).click();
  await expect(dialog.getByText("Gider olarak yazılmaz; yalnız stok artar. Ödediğinizde Kasa ve giderler → Giderler'den ekleyin.")).toBeVisible();
  await dialog.getByRole('button', { name: 'Alışı kaydet' }).click();
  await expect(page.getByText('Limon: 20 adet alış kaydedildi. Ödenmedi: gider yazılmadı.')).toBeVisible();
  await page.getByRole('button', { name: /^Sayım yap/ }).click();
  dialog = page.getByRole('dialog', { name: 'Sayım yap' });
  // The row starts in the unit of its "Beklenen" line (g here): 850 means 850 g. Typed in kg it is asked about first.
  await expect(dialog.getByLabel('Kahve sayılan miktar birimi')).toHaveValue('g');
  await dialog.getByLabel('Kahve sayılan miktar', { exact: true }).fill('850');
  await dialog.getByLabel('Kahve sayılan miktar birimi').selectOption('kg');
  await dialog.getByRole('button', { name: /^Sayımı kaydet/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('Kahve: 850 kg mı? Beklenen 877 g.');
  await dialog.getByRole('button', { name: 'Düzelt' }).click();
  await dialog.getByLabel('Kahve sayılan miktar birimi').selectOption('g');
  await expect(dialog.locator('.stock-count-row').filter({ hasText: 'Kahve' }).locator('.stock-count-diff')).toHaveText('−27 g');
  await dialog.getByRole('button', { name: /^Sayımı kaydet/ }).click();
  await expect(page.getByText(/Sayım kaydedildi \(1 malzeme\)/)).toBeVisible();
  const moves = page.getByRole('region', { name: 'Son hareketler' });
  await expect(moves.locator('.stock-entry').first()).toContainText('Fark −27 g');
  await expect(moves).toContainText('Gider olarak kaydedildi'); await expect(moves).toContainText('Ödenmedi (veresiye)');
  // 9 Ekim K-L: only the last 3 here (the start amounts of the items are older); "Tümü" opens İşlem geçmişi on every period.
  await expect(moves.locator('.stock-entry')).toHaveCount(3);
  await expect(moves.getByRole('button', { name: 'Daha eski kayıtlar' })).toHaveCount(0);
  await shot(page, 'stok-alis-sayim.png', info.outputPath('stok-alis-sayim.png'));
  await moves.getByRole('button', { name: 'Tümü · İşlem geçmişi' }).click();
  const all = page.getByRole('dialog', { name: 'İşlem geçmişi' });
  await expect(all.getByRole('button', { name: 'Tümü', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(all.locator('.stock-history-row').filter({ hasText: 'Başlangıç' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(all).toHaveCount(0);

  // 8 Ekim: "Geri al" on every row emptied the coffee with one curious tap. Now a "⋯" menu → "Bu kaydı geri al", a window
  // with the exact effect, today's records only, never "Başlangıç"; the record stays under "Geri alınanlar".
  await expect(moves.getByRole('button', { name: /Geri al$/ })).toHaveCount(0);
  await expect(moves.locator('.stock-entry').filter({ hasText: 'Başlangıç' }).first().getByRole('button')).toHaveCount(0);
  expect((await page.request.post('/api/staff/stock/purchase', { data: { requestId: crypto.randomUUID(), itemId: id('Kahve'), quantity: 1000, total: 90000 } })).ok()).toBe(true);
  await tab(page, 'Malzemeler').click(); await tab(page, 'Alış ve sayım').click();
  const bought = moves.locator('.stock-entry').first();
  await expect(bought).toContainText('Kahve'); await expect(bought).toContainText('+1 kg');
  await bought.getByRole('button', { name: 'Alış · Kahve · diğer işlemler' }).click();
  await bought.getByRole('menuitem', { name: 'Bu kaydı geri al' }).click();
  const undo = page.getByRole('dialog', { name: 'Bu kaydı geri al' });
  await expect(undo.locator('.stock-undo-effect')).toHaveText('Bu alış kaydı silinir.Kahve stoğu 1,85 kg → 850 g olur.');
  await expect(undo.getByRole('button', { name: 'Vazgeç' })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 760 });
  await shot(page, 'stok-geri-al.png', info.outputPath('stok-geri-al.png'), false);
  await page.setViewportSize({ width: 1280, height: 860 });
  await undo.getByRole('button', { name: 'Evet, geri al' }).click();
  await expect(page.getByText('Kayıt geri alındı. Kahve: 850 g.')).toBeVisible();
  const undoneList = page.locator('.stock-undone');
  await undoneList.locator('summary').click();
  await expect(undoneList).toContainText('Kahve +1 kg'); await expect(undoneList).toContainText('geri alan İşletme sahibi');
  expect((await (await page.request.get('/api/staff/stock')).json()).items.find((i: any) => i.name === 'Kahve').stock).toBe(850);

  // Every screen size: no sideways scroll on any Stok part; fields at least 16 px on phones and tablets.
  for (const part of ['Ürünler', 'Malzemeler', 'Reçeteler', 'Alış ve sayım']) {
    await tab(page, part).click();
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      // Polled: the tab bar picks its layout for the new width a frame after the resize.
      await expect.poll(() => noSideScroll(page), { message: `Stok → ${part} ${width}×${height}` }).toBe(true);
      if (width <= 820 && part !== 'Malzemeler' && part !== 'Alış ve sayım') await fieldsAtLeast16(page, '.stock-workspace');
    }
    await page.setViewportSize({ width: 1280, height: 860 });
  }
  await tab(page, 'Ürünler').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'stok-telefon.png', info.outputPath('stok-telefon.png'));
  await page.setViewportSize({ width: 1280, height: 860 });

  // Kârlılık: revenue after discounts, cost from the recipes and prices, margin; tea has no cost and links to its recipe.
  await nav(page, 'Satış ve Raporlar').click();
  await openReport(page, 'Kârlılık');
  const table = page.getByRole('region', { name: 'Ürün kârlılığı' });
  // Latte: ₺280 + ₺195 = ₺475; cost 2 × ₺24,20 + 1,5 × (₺16,20 + 200 ml yulaf × ₺0,08) = ₺96,70; kâr ₺378,30 (%80).
  const latteProfit = table.locator('tr').filter({ hasText: 'Caffè Latte' });
  await expect(latteProfit).toContainText('₺475'); await expect(latteProfit).toContainText('₺96,70'); await expect(latteProfit).toContainText('₺378,30'); await expect(latteProfit).toContainText('%80');
  // Cheesecake bought ready at ₺120, sold at ₺190: %37, above the %30 line of "Hazır ürünler"; the latte (%80) is above the
  // %70 of İçecekler: nothing is "Düşük kâr" with the trade defaults.
  const cakeProfit = table.locator('tr').filter({ hasText: 'San Sebastian' });
  await expect(cakeProfit).not.toHaveClass(/profit-low/); await expect(cakeProfit).toContainText('%37');
  await expect(table.locator('.profit-low-chip')).toHaveCount(0);
  const teaProfit = table.locator('tr').filter({ hasText: 'Demleme Çay' });
  await expect(teaProfit).toContainText('Maliyet girilmemiş');
  await expect(page.locator('.kpi-main')).toContainText('Brüt kâr');
  // The cost basis is named; "Bugünkü fiyatlarla" recosts every sale with today's recipe and prices (the same here).
  await expect(page.locator('.profit-basis-label')).toHaveText('Maliyet: Satış anındaki fiyatlarla');
  await page.getByRole('group', { name: 'Maliyet hesabı' }).getByRole('button', { name: 'Bugünkü fiyatlarla' }).click();
  await expect(page.locator('.profit-basis-label')).toHaveText('Maliyet: Bugünkü fiyatlarla');
  await expect(latteProfit).toContainText('₺96,70');
  await page.getByRole('group', { name: 'Maliyet hesabı' }).getByRole('button', { name: 'Satış anındaki fiyatlarla' }).click();
  await expect(page.locator('.profit-basis-label')).toHaveText('Maliyet: Satış anındaki fiyatlarla');
  await shot(page, 'karlilik.png', info.outputPath('karlilik.png'));
  for (const [width, height] of VIEWPORTS) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `Kârlılık ${width}×${height}`).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'karlilik-telefon.png', info.outputPath('karlilik-telefon.png'));
  await page.setViewportSize({ width: 1280, height: 860 });
  // "Reçete ekle" opens Stok → Reçeteler on that product's recipe.
  await teaProfit.getByRole('button', { name: 'Reçete ekle' }).click();
  await expect(page.getByRole('dialog', { name: 'Demleme Çay · Reçete' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Stok bölümleri' }).getByRole('button', { name: /^Reçeteler/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('dialog', { name: 'Demleme Çay · Reçete' }).getByRole('button', { name: 'Vazgeç' }).click();

  // The product window has the same recipe ("Reçete" section): Türk Kahvesi 30 g → 32 g.
  await nav(page, 'Menü yönetimi').click();
  await page.locator('.menu-row').filter({ hasText: 'Türk Kahvesi' }).getByRole('button', { name: 'Düzenle' }).click();
  const editor = page.getByRole('dialog', { name: 'Ürünü düzenle' });
  await editor.locator('summary', { hasText: 'Stok ve kârlılık için' }).click();
  await expect(editor.getByLabel('1. malzemenin miktarı', { exact: true })).toHaveValue('30');
  await editor.getByLabel('1. malzemenin miktarı', { exact: true }).fill('32');
  await editor.getByLabel('1. malzemenin miktarı', { exact: true }).press('Enter'); // must not save the product
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Reçeteyi kaydet' }).click();
  await expect(editor).toContainText('Türk Kahvesi reçetesi kaydedildi.');
  const turkish = (await (await page.request.get('/api/staff/stock')).json()).recipes.find((r: any) => r.productId === 'turkish');
  expect(turkish.items[0].amount).toBe(32);
  for (const [width, height] of [[390, 844], [820, 1180]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `product window recipe ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 860 });
  await editor.getByRole('button', { name: 'Vazgeç', exact: true }).click();

  // The low limon became one notification in Destek → Bildirimler.
  const notices = (await (await page.request.get('/api/staff/notifications')).json()).items.filter((n: any) => n.kind === 'stock');
  expect(notices.map((n: any) => n.title)).toEqual(['Limon azaldı']);

  // Satış ve Raporlar → Kârlılık → "Uyarı sınırları" (10 Ekim; once Ayarlar → Giderler ve kâr): the trade defaults per group;
  // switched off, Kârlılık marks nothing. The window closes onto the report, which reads the new lines at once.
  const limits = page.getByRole('dialog', { name: 'Düşük kâr uyarı sınırları' });
  const openLimits = async () => { await openReport(page, 'Kârlılık'); await page.getByRole('button', { name: 'Uyarı sınırları' }).click(); await expect(limits).toBeVisible(); };
  await openLimits();
  const margins = limits.locator('.margin-card');
  await expect(margins).toContainText('Sektörde yaygın kabul gören maliyet oranlarına göre');
  for (const [group, value] of [['İçecekler', '70'], ['Yemekler', '65'], ['Tatlı ve fırın', '65'], ['Hazır ürünler', '30']]) await expect(margins.getByLabel(`${group}: en az kâr oranı (%)`)).toHaveValue(value);
  // Drinks must earn %85: the latte (%80) becomes "Düşük kâr", its group's line in the tooltip.
  await margins.getByLabel('İçecekler: en az kâr oranı (%)').fill('85');
  await margins.getByRole('button', { name: 'Kaydet' }).click();
  await expect(margins).toContainText('Kaydedildi.');
  await shot(page, 'ayarlar-dusuk-kar.png', info.outputPath('ayarlar-dusuk-kar.png'), false);
  // Closing the window shows Kârlılık again, with the new marks.
  const openProfit = async () => {
    await page.keyboard.press('Escape'); await expect(limits).toHaveCount(0);
    await expect(reportGroups(page).getByRole('button', { name: 'Satış', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(reportTabs(page).getByRole('button', { name: 'Kârlılık', exact: true })).toHaveAttribute('aria-current', 'page');
  };
  await openProfit();
  const lowLatte = page.getByRole('region', { name: 'Ürün kârlılığı' }).locator('tr').filter({ hasText: 'Caffè Latte' });
  await expect(lowLatte).toHaveClass(/profit-low/);
  await expect(lowLatte.locator('.profit-low-chip')).toHaveAttribute('title', 'Kâr oranı İçecekler grubunun sınırının (%85) altında.');
  // Switched off: no marks at all.
  await openLimits();
  await page.locator('.margin-card').getByRole('checkbox', { name: /Düşük kâr uyarısı/ }).uncheck();
  await page.locator('.margin-card').getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.locator('.margin-card')).toContainText('Kaydedildi.');
  await openProfit();
  await expect(page.getByRole('region', { name: 'Ürün kârlılığı' }).locator('tr').filter({ hasText: 'Caffè Latte' })).not.toHaveClass(/profit-low/);
  await expect(page.locator('.profit-low-chip')).toHaveCount(0);
  await openLimits();
  await page.locator('.margin-card').getByRole('button', { name: 'Varsayılana dön' }).click();
  await expect(page.locator('.margin-card')).toContainText('Kaydedildi.');
  await page.keyboard.press('Escape');
  expect((await (await page.request.get('/api/staff/profit/settings')).json()).enabled).toBe(true);

  // The cashier has no Stok at all.
  const cashier = await browser.newContext(); const till = await cashier.newPage();
  await till.request.post('/api/login', { data: { username: 'kasiyer', password: 'MolaDemo!2026' } });
  await till.setViewportSize({ width: 1280, height: 860 }); await till.goto('/');
  await expect(till.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true })).toBeVisible();
  await expect(till.locator('.sidebar nav').getByRole('button', { name: 'Stok', exact: true })).toHaveCount(0);
  expect((await till.request.get('/api/staff/stock')).status()).toBe(403);
  await cashier.close();

  // The kitchen: Malzemeler, Reçeteler (read only), Ürünler and "Sayım ve fire"; no prices, purchases or changes.
  const cook = await browser.newContext(); const kitchen = await cook.newPage();
  await kitchen.request.post('/api/login', { data: { username: 'mutfak', password: 'MolaDemo!2026' } });
  await kitchen.setViewportSize({ width: 1280, height: 860 }); await kitchen.goto('/');
  await kitchen.locator('.kitchen-bar').getByRole('button', { name: 'Stok', exact: true }).click();
  const kitchenTabs = kitchen.getByRole('navigation', { name: 'Stok bölümleri' });
  await expect(kitchenTabs.getByRole('button')).toHaveText([/^Malzemeler/, /^Reçeteler/, /^Ürünler/, /^Sayım ve fire/]);
  await expect(kitchen.locator('.stock-item').filter({ hasText: 'Kahve' }).first()).not.toContainText('Birim fiyat');
  await expect(kitchen.getByRole('button', { name: 'Malzeme ekle' })).toHaveCount(0);
  await kitchenTabs.getByRole('button', { name: /^Reçeteler/ }).click();
  await expect(kitchen.locator('.stock-row').filter({ hasText: 'Caffè Latte' })).toContainText('Kahve 18 g · Süt 200 ml');
  await expect(kitchen.getByRole('button', { name: /reçetesi/ })).toHaveCount(0);
  await expect(kitchen.locator('.stock-workspace')).not.toContainText('maliyet');
  await kitchenTabs.getByRole('button', { name: /^Sayım ve fire/ }).click();
  await expect(kitchen.getByRole('button', { name: /^Alış kaydet/ })).toHaveCount(0);
  await expect(kitchen.getByRole('region', { name: 'Son hareketler' })).not.toContainText('Gider olarak kaydedildi');
  await kitchen.getByRole('button', { name: /^Fire kaydet/ }).click();
  dialog = kitchen.getByRole('dialog', { name: 'Fire kaydet' });
  await dialog.getByLabel('Malzeme *').selectOption({ label: 'Süt' });
  await dialog.getByLabel('Atılan miktar *', { exact: true }).fill('100');
  await dialog.getByRole('button', { name: 'Fireyi kaydet' }).click();
  await expect(kitchen.getByText('Süt: 100 ml fire kaydedildi.')).toBeVisible();
  await shot(kitchen, 'stok-mutfak.png', info.outputPath('stok-mutfak.png'));
  for (const [width, height] of VIEWPORTS) { await kitchen.setViewportSize({ width, height }); expect(await noSideScroll(kitchen), `Stok (mutfak) ${width}×${height}`).toBe(true); }
  await kitchen.setViewportSize({ width: 1280, height: 860 });

  // A waiter's or the owner's cancellation of something the kitchen started asks the kitchen: "Bu üründen stok kullanıldı mı?"
  expect((await page.request.post('/api/staff/settings', { data: { paymentMode: 'after_service', cleaningEnabled: false, waiterApproval: false, changeSeconds: 0, commissionBps: 0 } })).ok()).toBe(true);
  await sell(page.request, [{ productId: 'turkish', quantity: 1, selections: [{ groupId: 'sugar', optionId: 'none' }] }], tables[3].id);
  const placed = (await (await kitchen.request.get('/api/staff/state')).json()).orders.find((o: any) => o.tableName === tables[3].name && o.status === 'new');
  expect((await kitchen.request.post('/api/staff/status', { data: { requestId: crypto.randomUUID(), orderId: placed.id, version: placed.version, status: 'preparing' } })).ok()).toBe(true);
  const started = (await (await page.request.get('/api/staff/state')).json()).orders.find((o: any) => o.id === placed.id);
  expect((await page.request.post('/api/staff/orders/cancel', { data: { requestId: crypto.randomUUID(), orderId: placed.id, version: started.version, reason: 'Müşteri vazgeçti' } })).ok()).toBe(true);
  await kitchen.locator('.kitchen-bar').getByRole('button', { name: 'Mutfak panosu' }).click();
  const asked = kitchen.getByRole('region', { name: 'Stok soruları' });
  await expect(asked).toContainText('Bu üründen stok kullanıldı mı?');
  await expect(asked).toContainText('Türk Kahvesi');
  await shot(kitchen, 'mutfak-stok-sorusu.png', info.outputPath('mutfak-stok-sorusu.png'), false);
  await asked.getByRole('button', { name: 'Evet, hazırlanmıştı (fire)' }).click();
  await expect(kitchen.getByText('Fire kaydedildi.')).toBeVisible();
  await expect(asked).toHaveCount(0);
  const fire = (await (await page.request.get('/api/staff/stock/entries')).json()).entries.find((e: any) => e.kind === 'waste' && e.reason.startsWith('İptal · hazırlanmıştı'));
  expect(fire.quantity).toBe(32); // Türk Kahvesi's recipe was changed to 32 g above
  await cook.close();
});

test('8 Ekim: Reçete options say what leaves the stock and cost each option; İşlem geçmişi shows who did what (owner all, kitchen its own)', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // A filter coffee sold plain (₺85) or with milk (+₺30); its own items so other tests' prices do not mix in.
  const name = 'Filtre Kahve (deneme)';
  let state = await (await page.request.get('/api/staff/state')).json();
  if (!state.products.some((p: any) => p.name === name)) expect((await page.request.post('/api/staff/products', { data: { product: { code: '187', name, nameEn: '', category: 'Kahveler', description: '', price: 8500, soldOut: false, art: 'coffee', photo: null, groups: [{ id: 'milk', name: 'Süt', required: true, options: [{ id: 'none', name: 'Sütsüz', extra: 0 }, { id: 'milk', name: 'Sütlü', extra: 3000 }] }] } } })).ok()).toBe(true);
  const stock = await (await page.request.get('/api/staff/stock')).json();
  for (const item of [{ name: 'Filtre kahve', unit: 'g', initial: 2000, unitCost: 30 }, { name: 'Tam yağlı süt', unit: 'ml', initial: 10000, min: 2000, unitCost: 3 }])
    if (!stock.items.some((i: any) => i.name === item.name)) expect((await page.request.post('/api/staff/stock/items', { data: item })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await nav(page, 'Stok').click();
  await tab(page, 'Reçeteler').click();
  await page.getByRole('button', { name: `${name} reçetesi yok` }).click();
  const dialog = page.getByRole('dialog', { name: `${name} · Reçete` });
  // 9 Ekim (sahibin isteği): "Bu ürün nasıl takip edilsin?" segments are equal and their icon + label sit in the middle.
  const modes = await dialog.getByRole('group', { name: 'Takip şekli' }).getByRole('button').evaluateAll(bs => bs.map(b => {
    const r = b.getBoundingClientRect(), kids = [...b.childNodes].map(n => { const g = document.createRange(); g.selectNodeContents(n); return g.getBoundingClientRect(); }).filter(k => k.width > 0);
    const left = Math.min(...kids.map(k => k.left)), right = Math.max(...kids.map(k => k.right));
    return { width: r.width, offset: Math.abs((left + right) / 2 - (r.left + r.width / 2)), top: r.top };
  }));
  expect(modes.length).toBe(3);
  expect(new Set(modes.map(m => Math.round(m.width))).size, 'equal segments').toBe(1);
  expect(new Set(modes.map(m => Math.round(m.top))).size, 'one row').toBe(1);
  for (const m of modes) expect(m.offset, 'centred').toBeLessThan(2);
  await dialog.getByLabel('1. malzeme', { exact: true }).selectOption({ label: 'Filtre kahve' });
  await dialog.getByLabel('1. malzemenin miktarı', { exact: true }).fill('20');
  // The section says what it is about, that guests never see it, and each rule kind in its ⓘ.
  const options = dialog.locator('.stock-options');
  await options.getByText('Seçenekler stoktan düşen miktarı değiştiriyor mu?').click();
  await expect(options.locator('summary')).toContainText('Müşteriye görünmez');
  await options.getByRole('button', { name: 'Seçenek kuralları hakkında bilgi' }).click();
  await expect(page.getByRole('tooltip')).toContainText('Miktar değişir (%): reçetedeki bütün malzemeler bu oranda düşer');
  await page.keyboard.press('Escape'); await page.mouse.move(5, 5);
  await expect(options).toHaveAttribute('open', '');
  await dialog.getByLabel('Sütlü seçeneği reçeteyi nasıl değiştirir').selectOption('add');
  await dialog.getByLabel('Sütlü ile eklenen malzeme').selectOption({ label: 'Tam yağlı süt' });
  await dialog.getByLabel('Sütlü ile eklenen miktar', { exact: true }).fill('100');
  await expect(options.locator('.stock-option-effect')).toHaveText(['Sütsüz satılınca stoktan: Filtre kahve 20 g düşer.', 'Sütlü satılınca stoktan: Filtre kahve 20 g, Tam yağlı süt 100 ml düşer.']);
  // Each option costed as Kârlılık costs it: ₺6 → ₺85 (%93), ₺9 → ₺115 (%92).
  const table = dialog.getByRole('table', { name: 'Seçeneklere göre maliyet' });
  await expect(table.locator('tbody tr')).toHaveText([/^Sütsüz\s*₺6\s*₺85\s*%93$/, /^Sütlü \(\+₺30\)\s*₺9\s*₺115\s*%92$/]);
  await dialog.locator('.stock-cost-preview').scrollIntoViewIfNeeded();
  await shot(page, 'recete-secenek-maliyet.png', info.outputPath('recete-secenek-maliyet.png'), false);
  for (const [width, height] of [[360, 800], [390, 844]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `recipe options ${width}`).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await dialog.getByRole('button', { name: 'Reçeteyi kaydet' }).click();
  await expect(page.getByText(`${name} reçetesi kaydedildi.`)).toBeVisible();

  // Some work on the milk: a purchase, a new warning line, and the kitchen's fire.
  const items = (await (await page.request.get('/api/staff/stock')).json()).items, milk = items.find((i: any) => i.name === 'Tam yağlı süt');
  expect((await page.request.post('/api/staff/stock/purchase', { data: { requestId: crypto.randomUUID(), itemId: milk.id, quantity: 12000, total: 36000, supplier: 'Sütçü Ali' } })).ok()).toBe(true);
  expect((await page.request.post('/api/staff/stock/items', { data: { id: milk.id, name: 'Tam yağlı süt', unit: 'ml', min: 3000, unitCost: 3 } })).ok()).toBe(true);
  const kitchen = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // A cook with a person's name (the demo's own kitchen account is called "Mutfak"): the history shows the name, the role as a chip.
  const users = await (await page.request.get('/api/staff/users')).json();
  if (!users.some((u: { username: string }) => u.username === 'mehmet.stok')) {
    const made = await page.request.post('/api/staff/users', { data: { username: 'mehmet.stok', name: 'Mehmet Aydın', role: 'kitchen', password: 'MutfakStok!2026' } });
    expect(made.ok(), await made.text()).toBe(true);
  }
  try {
    expect((await kitchen.request.post('/api/login', { data: { username: 'mehmet.stok', password: 'MutfakStok!2026' } })).ok()).toBe(true);
    expect((await kitchen.request.post('/api/staff/stock/waste', { data: { requestId: crypto.randomUUID(), itemId: milk.id, quantity: 500, reason: 'Döküldü / kırıldı' } })).ok()).toBe(true);

    // The owner: everything, newest first, with person, role, time and before → after.
    await page.getByRole('button', { name: 'İşlem geçmişi', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'İşlem geçmişi' });
    const rows = history.locator('.stock-history-row');
    await expect(rows.first()).toContainText('Fire');
    // 9 Ekim (sahibin isteği): the person's name first, the role as a small chip beside it.
    await expect(rows.first().locator('.stock-history-who b')).toHaveText('Mehmet Aydın');
    await expect(rows.first().locator('.stock-history-role')).toHaveText('Mutfak');
    await expect(history.getByLabel('Kişi', { exact: true }).locator('option', { hasText: 'Mehmet Aydın' })).toHaveText('Mehmet Aydın · Mutfak');
    await expect(history.locator('.stock-history-row', { hasText: 'Uyarı sınırı değişti' }).first()).toContainText('2 L → 3 L');
    await expect(history.locator('.stock-history-row', { hasText: 'Reçete değişikliği' }).filter({ hasText: name }).first()).toContainText('Reçete yok → Filtre kahve 20 g · 1 seçenek kuralı');
    await expect(history.locator('.stock-history-row', { hasText: 'Alış' }).filter({ hasText: 'Sütçü Ali' }).locator('.stock-history-who')).toHaveText('İşletme sahibi');
    await history.getByRole('button', { name: 'İşlem geçmişi hakkında bilgi' }).click();
    await expect(page.getByRole('tooltip')).toContainText('mutfak yalnız kendi sayım ve fire kayıtlarını görür');
    await page.keyboard.press('Escape'); await page.mouse.move(5, 5);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await shot(page, 'stok-islem-gecmisi.png', info.outputPath('stok-islem-gecmisi.png'), false);
    for (const [width, height] of [[360, 800], [390, 844]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `history ${width}`).toBe(true); }
    await page.setViewportSize({ width: 1280, height: 1000 });
    // Filters: the item and a search.
    await history.getByLabel('Malzeme', { exact: true }).selectOption({ label: 'Tam yağlı süt' });
    // Only the milk's records (and the recipe that uses it).
    await expect.poll(async () => (await rows.allTextContents()).every(t => t.includes('Tam yağlı süt') || t.includes(name))).toBe(true);
    await history.getByLabel('İşlem geçmişinde ara').fill('sütçü');
    await expect(rows).toHaveCount(1);
    await history.getByLabel('İşlem geçmişinde ara').fill('');
    await expect.poll(() => rows.count()).toBeGreaterThan(1);
    await history.getByRole('button', { name: 'Kapat', exact: true }).click();

    // The kitchen: only its own fire; no person filter, no purchases or money.
    const cook = await kitchen.newPage(); await cook.goto('/');
    await cook.locator('.kitchen-bar').getByRole('button', { name: 'Stok', exact: true }).click();
    await cook.getByRole('button', { name: 'İşlem geçmişi', exact: true }).click();
    const own = cook.getByRole('dialog', { name: 'İşlem geçmişi' });
    await expect(own.locator('.stock-history-row').first()).toContainText('Fire');
    await expect(own.locator('.stock-history-row', { hasText: 'Alış' })).toHaveCount(0);
    await expect(own.getByLabel('Kişi', { exact: true })).toHaveCount(0);
    expect(await noSideScroll(cook)).toBe(true);
  } finally { await kitchen.close(); }
});

test('18 Ekim: Reçete → "Toplu üretimden hesapla" divides one batch into one portion and only fills the rows', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  // A börek made ten at a time: 1,25 kg un, 250 g tereyağı, 3 yumurta.
  const name = 'Börek (deneme)';
  const state = await (await page.request.get('/api/staff/state')).json();
  if (!state.products.some((p: any) => p.name === name)) expect((await page.request.post('/api/staff/products', { data: { product: { code: '188', name, nameEn: '', category: 'Tatlılar', description: '', price: 9000, soldOut: false, art: 'cake', photo: null, groups: [] } } })).ok()).toBe(true);
  const stock = await (await page.request.get('/api/staff/stock')).json();
  for (const item of [{ name: 'Un (deneme)', unit: 'g', initial: 10000, unitCost: 3 }, { name: 'Tereyağı (deneme)', unit: 'g', initial: 2000, unitCost: 40 }, { name: 'Yumurta (deneme)', unit: 'piece', initial: 60, unitCost: 600 }])
    if (!stock.items.some((i: any) => i.name === item.name)) expect((await page.request.post('/api/staff/stock/items', { data: item })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await nav(page, 'Stok').click();
  await tab(page, 'Reçeteler').click();
  await page.getByRole('button', { name: `${name} reçetesi yok` }).click();
  const dialog = page.getByRole('dialog', { name: `${name} · Reçete` });
  const toggle = dialog.getByRole('button', { name: 'Toplu üretimden hesapla' });
  // Nothing chosen yet: a short hint, no fields.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = dialog.getByRole('region', { name: 'Bir seferde ne kadar hazırladınız?' });
  await expect(panel).toContainText('Önce malzemeleri seçin.');
  await expect(panel.getByRole('button', { name: 'Reçeteye yaz' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Kapat', exact: true }).click();
  await expect(panel).toHaveCount(0);

  await dialog.getByLabel('1. malzeme', { exact: true }).selectOption({ label: 'Un (deneme)' });
  await dialog.getByRole('button', { name: 'Malzeme ekle' }).click();
  await dialog.getByLabel('2. malzeme', { exact: true }).selectOption({ label: 'Tereyağı (deneme)' });
  await dialog.getByLabel('2. malzemenin miktarı', { exact: true }).fill('30');
  await dialog.getByRole('button', { name: 'Malzeme ekle' }).click();
  await dialog.getByLabel('3. malzeme', { exact: true }).selectOption({ label: 'Yumurta (deneme)' });
  await toggle.click();
  await expect(panel).toContainText('Kullandığınız toplam malzemeyi ve kaç porsiyon çıktığını yazın; porsiyon başını hesaplayalım.');
  // Validation in place: nothing typed, then a portion count that is not a number.
  await panel.getByRole('button', { name: 'Reçeteye yaz' }).click();
  const result = panel.locator('.stock-batch-result');
  await expect(result).toHaveText('En az bir malzemenin toplam miktarını yazın.');
  await panel.getByLabel('Un (deneme) toplam miktarı', { exact: true }).fill('1,25');
  await panel.getByLabel('Un (deneme) toplam miktarı birimi').selectOption('kg');
  await panel.getByLabel('Yumurta (deneme) toplam miktarı', { exact: true }).fill('3');
  await expect(result).toHaveText('Kaç porsiyon çıktığını yazın.');
  const portions = panel.getByLabel('Kaç porsiyon çıktı?', { exact: true });
  await portions.fill('0');
  await expect(result).toHaveText('Porsiyon sayısını 0’dan büyük bir sayı olarak yazın.');
  await portions.fill('10');
  // Tereyağı is left blank: it keeps its 30 g.
  await expect(result).toHaveText('1 porsiyon: Un (deneme) 125 g · Yumurta (deneme) 0,3 adet');
  for (const [width, height] of [[360, 800], [390, 844], [768, 1024]] as const) { await page.setViewportSize({ width, height }); expect(await noSideScroll(page), `batch panel ${width}`).toBe(true); await fieldsAtLeast16(page, '.stock-batch'); if (width === 390) { await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: info.outputPath('recete-toplu-uretim-telefon.png') }); } }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await panel.scrollIntoViewIfNeeded();
  await shot(page, 'recete-toplu-uretim.png', info.outputPath('recete-toplu-uretim.png'), false);
  await panel.getByRole('button', { name: 'Reçeteye yaz' }).click();
  await expect(panel).toHaveCount(0);
  await expect(dialog.getByLabel('1. malzemenin miktarı', { exact: true })).toHaveValue('125');
  await expect(dialog.getByLabel('1. malzemenin miktarı birimi')).toHaveValue('g');
  await expect(dialog.getByLabel('2. malzemenin miktarı', { exact: true })).toHaveValue('30');
  await expect(dialog.getByLabel('3. malzemenin miktarı', { exact: true })).toHaveValue('0,3');
  // Nothing is saved until "Reçeteyi kaydet".
  const productId = (await (await page.request.get('/api/staff/state')).json()).products.find((p: any) => p.name === name).id;
  expect((await (await page.request.get('/api/staff/stock')).json()).recipes.some((r: any) => r.productId === productId)).toBe(false);
  await dialog.getByRole('button', { name: 'Reçeteyi kaydet' }).click();
  await expect(page.getByText(`${name} reçetesi kaydedildi.`)).toBeVisible();
  await expect(page.locator('.stock-row').filter({ hasText: name })).toContainText('Un (deneme) 125 g · Tereyağı (deneme) 30 g · Yumurta (deneme) 0,3 adet');
});

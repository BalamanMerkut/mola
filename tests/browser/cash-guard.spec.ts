import { test, expect, type Page } from '@playwright/test';
import { ensureSetup, openCash } from './helpers';

/*
 * Kasa güvenliği (14 Ekim; src/CashGuardSettings.tsx, src/CashDay.tsx): the owner turns the switches on in Kasa ve giderler
 * → Kasa ayarları → Kasa güvenliği; the money a cashier took out at the gün sonu waits on the owner's Bugün for "Teslim al";
 * after a "Vardiya devri" the incoming person counts without seeing the amount. Left off again at the end (the suite shares
 * one café).
 */
const PASSWORD = 'MolaDemo!2026';
const rid = (name: string) => `${name}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
async function signedIn(page: Page, username: string) {
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  if (username === 'isletme') await ensureSetup(page.request);
  await page.goto('/');
  await page.locator('header.topbar').waitFor();
}
test.describe.configure({ timeout: 150_000 });

test('Kasa güvenliği: switches with their ties, "Teslim al" on the owner\'s Bugün, the incoming count after a devir', async ({ browser }, info) => {
  const ownerContext = await browser.newContext({ viewport: { width: 1366, height: 900 } }), owner = await ownerContext.newPage();
  await signedIn(owner, 'isletme');
  const tillContext = await browser.newContext({ viewport: { width: 1366, height: 900 } }), till = await tillContext.newPage();
  try {
    // The switches: all off at first, each says what it is tied to; "Önerilenleri aç" turns the six on.
    await openCash(owner, 'Kasa ayarları', 'Kasa güvenliği');
    const card = owner.getByRole('region', { name: /Kasa güvenliği/ });
    await expect(card).toContainText('0/6 açık');
    await expect(card).toContainText('Yalnız kartla ödeme alınan vardiyalarda istenir');
    await expect(card).toContainText('Kasiyer gider uyarıları');
    await card.getByRole('button', { name: 'Önerilenleri aç' }).click();
    await expect(card).toContainText('6/6 açık');
    await expect(card.getByRole('checkbox', { name: /Açılışta kör sayım/ })).toBeChecked();
    await owner.screenshot({ path: info.outputPath('kasa-guvenligi.png') });
    // One switch alone: off and on again.
    await card.getByRole('checkbox', { name: /Ödeme türü değişince bildir/ }).uncheck();
    await expect(card).toContainText('5/6 açık');
    await card.getByRole('checkbox', { name: /Ödeme türü değişince bildir/ }).check();
    await expect(card).toContainText('6/6 açık');

    // The cashier's day: opened if needed, counted (no card sold here, so no POS asked), 50 TL taken out.
    await signedIn(till, 'kasiyer');
    const api = till.request;
    let status = await (await api.get('/api/staff/cash/status')).json();
    if (status.draft) { const d = await (await api.get(`/api/staff/cash/closing/${status.draft.id}`)).json(); await api.post('/api/staff/cash/finish', { data: { id: d.closing.id } }); status = await (await api.get('/api/staff/cash/status')).json(); }
    if (status.showOpening || !status.opening.confirmed) expect((await api.post('/api/staff/cash/open', { data: { requestId: rid('guv-acilis'), amount: 30000 } })).ok()).toBe(true);
    const counted = await (await api.post('/api/staff/cash/count', { data: { requestId: rid('guv-sayim'), mode: 'final', counted: 30000 } })).json();
    expect(counted.id, JSON.stringify(counted)).toBeTruthy();
    expect((await api.post('/api/staff/cash/finish', { data: { id: counted.id, left: 25000 } })).ok()).toBe(true);

    // The owner's Bugün: "Teslim alınacak para: ₺50"; a short envelope needs a note.
    await openCash(owner, 'Bugün');
    const waiting = owner.locator('.cash-alert.receipt').filter({ hasText: 'Teslim alınacak para: ₺50' });
    await expect(waiting).toBeVisible({ timeout: 15_000 });
    await waiting.getByRole('button', { name: 'Teslim al' }).click();
    const dialog = owner.getByRole('dialog', { name: 'Parayı teslim al' });
    await dialog.getByLabel('Teslim alınan tutar').fill('40');
    await expect(dialog).toContainText('Fark: −₺10');
    await expect(dialog.getByRole('button', { name: 'Teslim aldım' })).toBeDisabled();
    await dialog.getByLabel('Teslim notu').fill('Zarfta 10 TL eksik');
    await owner.screenshot({ path: info.outputPath('teslim-al.png') });
    await dialog.getByRole('button', { name: 'Teslim aldım' }).click();
    await expect(dialog).toBeHidden();
    await expect(owner.locator('.cash-alert.receipt')).toHaveCount(0);
    // Kapanışlar keeps it with the closing.
    await openCash(owner, 'Kapanışlar');
    await expect(owner.locator('.cash-closing-card').filter({ hasText: 'Teslim:' }).first()).toContainText('₺40 alındı · fark −₺10 · Zarfta 10 TL eksik', { timeout: 15_000 });

    // A devir: the cashier hands over (the day is open again after an "Ek kapanış" window); the incoming count shows no amount.
    status = await (await api.get('/api/staff/cash/status')).json();
    if (status.showOpening) expect((await api.post('/api/staff/cash/open', { data: { requestId: rid('guv-acilis2'), amount: 25000 } })).ok()).toBe(true);
    const handover = await (await api.post('/api/staff/cash/count', { data: { requestId: rid('guv-devir'), mode: 'handover', counted: 25000 } })).json();
    expect(handover.id, JSON.stringify(handover)).toBeTruthy();
    expect((await api.post('/api/staff/cash/finish', { data: { id: handover.id } })).ok()).toBe(true);
    await openCash(till, 'Bugün');
    const incoming = till.locator('form.cash-opening');
    await expect(incoming.getByRole('heading', { name: 'Vardiya devrini al' })).toBeVisible({ timeout: 15_000 });
    await expect(incoming).toContainText('Devredilen tutarı görmeden');
    await expect(incoming).not.toContainText('250');
    await till.screenshot({ path: info.outputPath('devri-al.png') });
    await incoming.getByLabel('Açılış tutarı').fill('250');
    await incoming.getByRole('button', { name: 'Sayımı kaydet ve devri al' }).click();
    await expect(incoming).toBeHidden({ timeout: 15_000 });
  } finally {
    // The suite shares this café: every switch off again.
    await owner.request.post('/api/staff/cash/settings', { data: { guard: { blindOpening: false, receipt: false, handoverCount: false, strictCount: false, posRequired: false, methodAlert: false } } });
    await ownerContext.close(); await tillContext.close();
  }
});

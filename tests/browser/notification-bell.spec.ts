import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bell, ensureSetup } from './helpers';

/*
 * The bell, easier to notice (10 Ekim, sahibin onayı; src/Workspace.tsx, src/NotificationToasts.tsx): with unread ones a soft
 * coral bell that rings, with the count ("9+" above nine); plain once all are read. A notification that arrives while the
 * screen is open shows a toast under the bell (title, one line, "Aç"); important ones (refund request, cash difference,
 * licence, backup) stay until closed, the rest hide after 6 s; two at most; none for what was there when the page opened.
 * The Müdür gets campaign ones only. "Bildirim sesi" (Ayarlar → Cihazlar → Sesler) is off until switched on.
 * Screen (KAFE_EKRAN=docs/ekran/kafe): kafe/zil-bildirim.png.
 */
const PASSWORD = 'MolaDemo!2026', MANAGER = { username: 'zil.mudur', password: 'Zil-Mudur-Deneme-26!' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
/** An Ajanda note whose reminder (today 00:00) is already due: the next read of the bell turns it into a notification. */
async function remind(request: APIRequestContext, title: string) {
  const r = await request.post('/api/staff/agenda', { data: { day: today(), title, text: 'Depodan iki koli süt gelecek, kasadan ödenecek.', reminder: { offset: 'same', time: '00:00' } } });
  expect(r.ok(), await r.text()).toBe(true);
}
const unread = async (request: APIRequestContext) => (await (await request.get('/api/staff/notifications/count')).json()).unread as number;
/** The bell reads every 15 s; a change on this device asks at once (the same event the app fires after reading one). */
const nudge = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('mola:notifications')));
const toasts = (page: Page) => page.getByTestId('notification-toast');
async function signedIn(page: Page, username = 'isletme', password = PASSWORD) {
  expect((await page.request.post('/api/login', { data: { username, password } })).ok()).toBe(true);
  await page.goto('/');
  await page.locator('header.topbar').waitFor();
}
/** A stand-in AudioContext: every started oscillator's frequency lands in window.__notes (as in settings-topics.spec.ts). */
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

test.describe.configure({ timeout: 150_000 });

test('the bell: count and soft colour, a toast only for new ones, important ones stay, two at most, "Aç" opens its place', async ({ browser, request }, info) => {
  expect((await request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
  await ensureSetup(request);
  await request.post('/api/staff/notifications/read', { data: {} });
  // Already there when the page opens: in the count, never a toast.
  await remind(request, 'Eski hatırlatma');
  expect(await unread(request)).toBe(1);

  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } }), owner = await context.newPage();
  await signedIn(owner);
  const b = bell(owner);
  await expect(b).toHaveClass(/has-unread/);
  await expect(b.getByTestId('bell-count')).toHaveText('1');
  await expect(b).toHaveAccessibleName('Bildirimler, 1 okunmamış');
  await expect(b.locator('svg.bell-ring')).toHaveCount(1);
  await nudge(owner); await owner.waitForTimeout(1500);
  await expect(toasts(owner)).toHaveCount(0);

  // A new reminder while the screen is open: a toast with its title, one line and "Aç"; it hides by itself.
  await remind(request, 'Tedarikçi gelecek');
  await nudge(owner);
  const first = toasts(owner).filter({ hasText: 'Hatırlatma: Tedarikçi gelecek' });
  await expect(first).toBeVisible({ timeout: 10_000 });
  await expect(first).toHaveAttribute('data-important', 'no');
  await expect(first).toContainText('Depodan iki koli süt gelecek');
  await expect(first.getByRole('button', { name: /^Aç/ })).toBeVisible();
  await expect(owner.locator('.note-toasts')).toHaveAttribute('aria-live', 'polite');
  await expect(b.getByTestId('bell-count')).toHaveText('2');
  await expect(first).toHaveCount(0, { timeout: 10_000 });
  // Seen once is enough: the next read does not bring it back.
  await nudge(owner); await owner.waitForTimeout(1500);
  await expect(toasts(owner)).toHaveCount(0);

  // An important one (the cashier's gün sonu came out ₺50 short): it stays until closed or opened.
  const cashier = await browser.newContext(), till = cashier.request;
  expect((await till.post('/api/login', { data: { username: 'kasiyer', password: PASSWORD } })).ok()).toBe(true);
  expect((await till.post('/api/staff/cash/open', { data: { requestId: `zil-open-${Date.now()}`, amount: 50000 } })).ok()).toBe(true);
  const counted = await (await till.post('/api/staff/cash/count', { data: { requestId: `zil-count-${Date.now()}`, mode: 'final', counted: 45000 } })).json();
  expect((await till.post('/api/staff/cash/finish', { data: { id: counted.id, left: 45000, note: 'Zil denemesi' } })).ok()).toBe(true);
  await expect.poll(async () => (await (await request.get('/api/staff/notifications/count')).json()).recent.map((n: any) => n.title).join(' | ')).toMatch(/Kasa kapatıldı: fark/);
  await nudge(owner);
  const cash = toasts(owner).filter({ hasText: 'Kasa kapatıldı: fark' });
  await expect(cash).toBeVisible({ timeout: 10_000 });
  await expect(cash).toHaveAttribute('data-important', 'yes');
  await owner.waitForTimeout(7500);
  await expect(cash).toBeVisible();
  await expect(b.getByTestId('bell-count')).toHaveText('3');
  const shotOptions = { clip: { x: 1366 - 520, y: 0, width: 520, height: 230 } };
  await owner.screenshot({ path: info.outputPath('zil-bildirim.png'), ...shotOptions });
  if (process.env.KAFE_EKRAN) { mkdirSync(process.env.KAFE_EKRAN, { recursive: true }); await owner.screenshot({ path: join(process.env.KAFE_EKRAN, 'zil-bildirim.png'), ...shotOptions }); }
  // "Aç": read, and its place (as in Bildirimler): Kasa ve giderler → Kapanışlar.
  await cash.getByRole('button', { name: /^Aç/ }).click();
  await expect(owner.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }).getByRole('button', { name: /^Kapanışlar/ })).toHaveAttribute('aria-current', 'page');
  await expect(cash).toHaveCount(0);
  await expect(b.getByTestId('bell-count')).toHaveText('2');
  await cashier.close();

  // Three at once: two toasts at most, newest first.
  for (const title of ['Birinci not', 'İkinci not', 'Üçüncü not']) await remind(request, title);
  await nudge(owner);
  await expect(toasts(owner)).toHaveCount(2, { timeout: 10_000 });
  await owner.waitForTimeout(800);
  await expect(toasts(owner)).toHaveCount(2);
  // Closed by hand.
  await toasts(owner).first().getByRole('button', { name: 'Bildirimi kapat' }).click();
  await expect(toasts(owner)).toHaveCount(1);

  // Above nine: "9+"; the accessible name keeps the number.
  for (let i = 1; i <= 5; i++) await remind(request, `Toplu not ${i}`);
  const many = await unread(request);
  expect(many).toBeGreaterThan(9);
  await nudge(owner);
  await expect(b.getByTestId('bell-count')).toHaveText('9+', { timeout: 10_000 });
  await expect(b).toHaveAccessibleName(`Bildirimler, ${many} okunmamış`);

  // All read: the plain bell again.
  await request.post('/api/staff/notifications/read', { data: {} });
  await nudge(owner);
  await expect(b.getByTestId('bell-count')).toHaveCount(0, { timeout: 10_000 });
  await expect(b).not.toHaveClass(/has-unread/);
  await expect(b).toHaveAccessibleName('Bildirimler');
  await expect(b.locator('svg.bell-ring')).toHaveCount(0);
  await context.close();
});

test('Bildirim sesi rings once switched on; the Müdür gets campaign toasts only; the toast fits a phone', async ({ browser, request }) => {
  expect((await request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
  await ensureSetup(request);
  await request.post('/api/staff/notifications/read', { data: {} });
  // Off by default.
  expect((await (await request.get('/api/staff/sounds')).json()).notification).toEqual({ sound: 'nazik', on: false });
  const quiet = await browser.newContext({ viewport: { width: 1366, height: 800 } }), silent = await quiet.newPage();
  await silent.addInitScript(fakeAudio);
  await signedIn(silent);
  await silent.waitForTimeout(1000);
  await silent.locator('header.topbar .breadcrumb').click(); // a tap (sound stays off: nothing to unlock)
  await silent.evaluate(() => { (window as any).__notes = []; });
  await remind(request, 'Sessiz not');
  await nudge(silent);
  await expect(toasts(silent).filter({ hasText: 'Sessiz not' })).toBeVisible({ timeout: 10_000 });
  expect(await silent.evaluate(() => (window as any).__notes as number[])).not.toEqual(expect.arrayContaining([660, 880]));
  await quiet.close();

  // Switched on (Ayarlar → Cihazlar → Sesler): the new one rings with Nazik (660 Hz, then 880 Hz).
  expect((await request.post('/api/staff/sounds', { data: { event: 'notification', on: true } })).ok()).toBe(true);
  try {
    const loud = await browser.newContext({ viewport: { width: 1366, height: 800 } }), page = await loud.newPage();
    await page.addInitScript(fakeAudio);
    await signedIn(page);
    await page.waitForTimeout(1000); // the sound choices of this business are read when the screen opens
    await page.locator('header.topbar .breadcrumb').click(); // a tap unlocks sound
    await page.evaluate(() => { (window as any).__notes = []; });
    await remind(request, 'Sesli not');
    await nudge(page);
    await expect(toasts(page).filter({ hasText: 'Sesli not' })).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__notes as number[])).toEqual(expect.arrayContaining([660, 880]));
    await loud.close();
  } finally { await request.post('/api/staff/sounds', { data: { event: 'notification', on: false } }); }

  // The Müdür: the bell for campaign notifications only; an Ajanda reminder of the owner never pops up there.
  const made = await request.post('/api/staff/users', { data: { ...MANAGER, name: 'Zil Müdür', role: 'manager' } });
  expect(made.ok(), await made.text()).toBe(true);
  const managerContext = await browser.newContext({ viewport: { width: 1366, height: 800 } }), manager = await managerContext.newPage();
  await signedIn(manager, MANAGER.username, MANAGER.password);
  await expect(bell(manager)).toBeVisible();
  await remind(request, 'Sahibin notu');
  await nudge(manager); await manager.waitForTimeout(2000);
  await expect(toasts(manager)).toHaveCount(0);
  await expect(bell(manager).getByTestId('bell-count')).toHaveCount(0);
  await managerContext.close();

  // The owner's phone: the toast under the slim top bar, no sideways scroll.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), phone = await phoneContext.newPage();
  await signedIn(phone);
  await remind(request, 'Telefon notu');
  await nudge(phone);
  const onPhone = toasts(phone).filter({ hasText: 'Telefon notu' });
  await expect(onPhone).toBeVisible({ timeout: 10_000 });
  const box = await onPhone.boundingBox(), top = await phone.locator('header.topbar').boundingBox();
  expect(box && top && box.x >= 0 && box.x + box.width <= 390 && box.y >= top.y + top.height - 1, 'inside the screen, under the top bar').toBe(true);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await phoneContext.close();
});

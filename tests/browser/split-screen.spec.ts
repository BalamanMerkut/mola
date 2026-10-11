import { test, expect, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { e2eRun } from './helpers';

/*
 * İki ekran (src/SplitView.tsx, src/pane.ts): in the café computer's Mola window the rail's "İkiye böl" shows two Mola
 * screens side by side, each with its own sign-in (cashier left, kitchen right). ◀ / ▶ give one side the whole width, the
 * middle button splits 50/50, the divider drags; Ctrl+Alt+← / → focus and widen a side. Remembered on reload.
 */
const PASSWORD = 'MolaDemo!2026';
const RAIL = 68, DIVIDER = 22;
// Two 960 px panes beside the rail and the divider.
const VIEWPORT = { width: RAIL + DIVIDER + 2 * 960, height: 1000 };
async function shot(page: Page, file: string, path: string) {
  await page.screenshot({ path });
  const folder = process.env.KAFE_EKRAN;
  if (folder) { mkdirSync(folder, { recursive: true }); await page.screenshot({ path: join(folder, file) }); }
}
/** Counts every tone started (window.__rings) in each frame; the sound starts without a tap. */
function audioMock() {
  const w = window as any; w.__rings = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioMock {
    state = 'running'; onstatechange: (() => void) | null = null; currentTime = 0; sampleRate = 8000; destination = {};
    async resume() { this.state = 'running'; this.onstatechange?.(); } async close() { this.state = 'closed'; }
    createGain() { return { ...node(), gain: param() }; }
    createOscillator() { w.__rings++; return { ...node(), type: 'sine', frequency: param(), onended: null, start() {}, stop() {} }; }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { ...node(), buffer: null, onended: null, start() {} }; }
    createBiquadFilter() { return { ...node(), type: 'bandpass', frequency: param(), Q: param() }; }
  }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioMock });
}
const pane = (page: Page, n: 1 | 2): FrameLocator => page.frameLocator(`iframe[name="mola-pane-${n}"]`);
const frame = (page: Page, n: 1 | 2): Frame => page.frame({ name: `mola-pane-${n}` })!;
/** Who this pane's own calls speak for (its fetch carries the pane, src/pane.ts). */
const me = (page: Page, n: 1 | 2) => frame(page, n).evaluate(async () => { const r = await fetch('/api/staff/me'); return r.ok ? ((await r.json()) as { role: string }).role : r.status; });
const fits = (f: Frame) => f.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function signIn(p: FrameLocator, username: string) {
  await p.getByLabel('Kullanıcı adı').fill(username);
  await p.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
  await p.getByRole('button', { name: /Çalışma alanını aç/ }).click();
}
const box = async (page: Page, n: 1 | 2) => (await page.locator(`.split-pane[data-pane="${n}"]`).boundingBox())!;

test('İkiye böl: cashier and kitchen side by side with their own sign-ins; ◀ ▶, drag, keys; reload keeps both; logout on one side keeps the other', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const key = readFileSync(join(e2eRun(), 'masaustu.anahtar'), 'utf8').trim();
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript(audioMock);
  // This test server's key protection would show the recovery code over everything first ("Sonra kaydedeceğim" for this tab).
  await context.addInitScript(() => { try { sessionStorage.setItem('mola-welcome', '1'); sessionStorage.setItem('mola-recovery-later', '1'); } catch { /* frames */ } });
  const page = await context.newPage();
  try {
    await page.goto(`/#masaustu=${key}`);
    const rail = page.getByRole('navigation', { name: 'Mola bilgisayar araçları' });
    await rail.getByRole('button', { name: 'İkiye böl' }).click();
    await expect(rail.getByRole('button', { name: 'Tek ekran' })).toBeVisible();
    // The window itself runs no Mola screen of its own while split: only the two panes do.
    await expect(page.locator('.login-page')).toHaveCount(0);
    const left = pane(page, 1), right = pane(page, 2);
    await signIn(left, 'kasiyer');
    await expect(left.locator('.sidebar')).toBeVisible();
    await signIn(right, 'mutfak');
    await expect(right.locator('.kitchen-bar')).toBeVisible();
    // Two sessions in one window: each side's calls speak for its own account.
    expect(await me(page, 1)).toBe('cashier');
    expect(await me(page, 2)).toBe('kitchen');
    // Each side lays itself out for its own 960 px: the cashier's tablet-width counter, the kitchen's three columns.
    for (const n of [1, 2] as const) {
      expect(await frame(page, n).evaluate(() => innerWidth)).toBe(960);
      expect(await fits(frame(page, n)), `pane ${n} fits`).toBe(true);
    }
    await expect(right.locator('.kitchen-column:visible')).toHaveCount(3);

    // The cashier sends an order from the left; it rings and shows up on the kitchen board on the right.
    const product = await frame(page, 1).evaluate(() => fetch('/api/staff/state').then(r => r.json()).then((s: any) => s.products.find((p: any) => !p.groups?.length && p.unit !== 'kg' && !p.soldOut && p.published !== false)));
    const before = await frame(page, 2).evaluate(() => (window as any).__rings as number);
    await left.locator('.sidebar nav').getByRole('button', { name: 'Sipariş al', exact: true }).click();
    await left.getByLabel('Sipariş masası').selectOption({ label: 'Masa 02' });
    const add = left.locator('.staff-row', { hasText: product.name }).getByRole('button', { name: new RegExp(`${product.name} · bir adet ekle`) });
    await add.scrollIntoViewIfNeeded(); await add.click();
    await left.locator('.staff-basket-bar').getByRole('button', { name: /^Gönder/ }).click();
    const sent = left.getByText(/Sipariş #\d+ mutfağa gönderildi\./);
    await expect(sent).toBeVisible();
    const number = /#(\d+)/.exec((await sent.textContent())!)![1];
    await expect(right.locator('.kitchen-card', { hasText: `#${number}` })).toBeVisible();
    await expect.poll(() => frame(page, 2).evaluate(() => (window as any).__rings as number)).toBeGreaterThan(before);
    await shot(page, 'iki-ekran.png', info.outputPath('iki-ekran.png'));

    // ◀: the right side takes the whole width; the left folds to a strip that brings it back.
    const full = VIEWPORT.width - RAIL - DIVIDER;
    await page.getByRole('button', { name: 'Sağ ekranı büyüt' }).click();
    const strip = page.getByRole('button', { name: 'Sol ekran geri aç' });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Kasiyer');
    expect((await box(page, 2)).width).toBeGreaterThan(full - 60);
    await expect(right.locator('.kitchen-bar')).toBeVisible();
    await strip.click();
    expect(Math.round((await box(page, 1)).width)).toBe(960);
    // ▶: the other way round; the middle button splits 50/50 again.
    await page.getByRole('button', { name: 'Sol ekranı büyüt' }).click();
    await expect(page.getByRole('button', { name: 'Sağ ekran geri aç' })).toBeVisible();
    expect((await box(page, 1)).width).toBeGreaterThan(full - 60);
    await page.getByRole('button', { name: 'Ekranı ikiye eşit böl' }).click();
    expect(Math.round((await box(page, 2)).width)).toBe(960);
    // Folded, the kitchen keeps running: its board is still signed in and polling behind the strip.
    expect(await me(page, 2)).toBe('kitchen');

    // Ctrl+Alt+→ from inside the left pane: the right side gets the focus; pressed again, the whole width. Ctrl+Alt+← back.
    await left.locator('.sidebar nav').getByRole('button', { name: 'Masalar', exact: true }).click();
    await page.keyboard.press('Control+Alt+ArrowRight');
    await expect(page.locator('.split-pane[data-pane="2"]')).toHaveClass(/focused/);
    await page.keyboard.press('Control+Alt+ArrowRight');
    await expect(page.locator('.split-pane[data-pane="1"]')).toHaveClass(/folded/);
    await page.keyboard.press('Control+Alt+ArrowLeft');
    await expect(page.locator('.split-pane[data-pane="1"]')).not.toHaveClass(/folded/);
    await expect(page.locator('.split-pane[data-pane="1"]')).toHaveClass(/focused/);

    // Dragging the divider: a 30/70 split, remembered on this computer.
    const grip = (await page.locator('.split-grip').boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 80);
    await page.mouse.down();
    await page.mouse.move(RAIL + 0.3 * (VIEWPORT.width - RAIL), grip.y + 80, { steps: 8 });
    await page.mouse.up();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mola-split') ?? '{}'));
    expect(saved.on).toBe(true); expect(saved.ratio).toBeGreaterThan(0.25); expect(saved.ratio).toBeLessThan(0.35);
    const narrowLeft = (await box(page, 1)).width;
    expect(narrowLeft).toBeLessThan(700);
    expect(await fits(frame(page, 1))).toBe(true);

    // A reload (or the next start of the window) brings back the split, its ratio and both sign-ins.
    await page.reload();
    // The narrow left side (under 700 px) is laid out like a phone: the bottom bar instead of the sidebar.
    await expect(left.getByRole('navigation', { name: 'Alt menü' })).toBeVisible();
    await expect(right.locator('.kitchen-bar')).toBeVisible();
    expect(Math.abs((await box(page, 1)).width - narrowLeft)).toBeLessThan(3);
    expect(await me(page, 1)).toBe('cashier');
    expect(await me(page, 2)).toBe('kitchen');
    await page.getByRole('button', { name: 'Ekranı ikiye eşit böl' }).click();

    // Logging out on the left signs only the left out; the kitchen stays on its board.
    await left.locator('.user-row').getByRole('button', { name: 'Çıkış yap' }).click();
    await expect(left.getByRole('heading', { name: 'Hoş geldiniz.' })).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(right.locator('.kitchen-bar')).toBeVisible();
    await expect(right.locator('.kitchen-card', { hasText: `#${number}` })).toBeVisible();
    expect(await me(page, 1)).toBe(401);
    expect(await me(page, 2)).toBe('kitchen');

    // "Tek ekran": one ordinary screen again (the left side's sign-in, signed out now); the kitchen's session waits for the next split.
    await rail.getByRole('button', { name: 'Tek ekran' }).click();
    await expect(page.locator('iframe[name^="mola-pane-"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Hoş geldiniz.' })).toBeVisible();
    await rail.getByRole('button', { name: 'İkiye böl' }).click();
    await expect(right.locator('.kitchen-bar')).toBeVisible();
  } finally { await context.close(); }
});

test('outside the café computer\'s window there is no İkiye böl and a frame named like a pane gets no session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hoş geldiniz.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'İkiye böl' })).toHaveCount(0);
  // A page that frames Mola as a pane without the rail's key (a tablet trying it): every call is refused, not someone else's.
  await page.evaluate(() => { const f = document.createElement('iframe'); f.name = 'mola-pane-2'; f.src = '/?pane=2'; f.style.width = '800px'; f.style.height = '600px'; document.body.append(f); });
  await expect.poll(() => page.frame({ name: 'mola-pane-2' })?.evaluate(() => fetch('/api/staff/me').then(r => r.json()).then((v: { code?: string }) => v.code)).catch(() => undefined)).toBe('PANE_REFUSED');
});

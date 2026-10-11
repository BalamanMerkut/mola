import { ensureSetup } from './helpers';
import { test, expect } from '@playwright/test';
test('editor performance benchmark with 96 choices', async ({ page }, info) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: 'MolaDemo!2026' } });
  await ensureSetup(page.request);
  const product = { code: '881', name: 'Performans ürünü', nameEn: '', category: 'Kahveler', description: '', price: 10000, soldOut: false, art: 'coffee', groups: Array.from({ length: 8 }, (_, i) => ({ id: `group-${i}`, name: `Alan ${i}`, required: false, options: Array.from({ length: 12 }, (_, j) => ({ id: `option-${j}`, name: `Seçenek ${j}`, extra: 0 })) })) };
  expect((await page.request.post('/api/staff/products', { data: { product } })).ok()).toBe(true);
  await page.goto('/'); await page.getByRole('button', { name: 'Menü yönetimi', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Performance.enable');
  await page.locator('.menu-row').filter({ hasText: 'Performans ürünü' }).getByRole('button', { name: 'Düzenle' }).click();
  const input = page.getByLabel('Ürün adı', { exact: true }); await input.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const samples: number[] = []; (window as any).editorSamples = samples;
    document.querySelector('input[aria-label="Ürün adı"]')!.addEventListener('input', () => {
      const start = performance.now(); requestAnimationFrame(() => samples.push(performance.now() - start));
    });
  });
  const before = await cdp.send('Performance.getMetrics');
  await input.pressSequentially(' hızlı yazı denemesi bir iki üç dört beş', { delay: 15 });
  await page.evaluate(async () => { const dialog = document.querySelector('.editor-scroll-body')!; for (let i = 0; i < 24; i++) { dialog.scrollTop = i * 80; await new Promise(requestAnimationFrame); } });
  const after = await cdp.send('Performance.getMetrics');
  const samples = await page.evaluate(() => (window as any).editorSamples as number[]);
  samples.sort((a, b) => a - b);
  const delta = (name: string) => Math.round(1000 * (after.metrics.find(m => m.name === name)!.value - before.metrics.find(m => m.name === name)!.value));
  const result = { cpuSlowdown: 4, choices: 96, samples: samples.length, inputToFrameP50Ms: Math.round(samples[Math.floor(samples.length * .5)]), inputToFrameP95Ms: Math.round(samples[Math.floor(samples.length * .95)]), scriptMs: delta('ScriptDuration'), taskMs: delta('TaskDuration'), layoutMs: delta('LayoutDuration') };
  console.log('EDITOR_PERF', JSON.stringify(result));
  await info.attach('editor-performance.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await expect(input).toHaveValue(/hızlı yazı denemesi/);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
// The browser part of the package test (scripts/paket-testi.ts starts the packaged servers and writes PAKET_DURUM). Microsoft
// Edge, like the Mola window on a café computer; PAKET_KANAL=chrome for Chrome.
const state = JSON.parse(readFileSync(process.env.PAKET_DURUM ?? '.local/e2e/paket-testi/durum.json', 'utf8')) as { kafe: string };
export default defineConfig({
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '.local/e2e/paket-testi/tarayici',
  testDir: '.', testMatch: /paket\.spec\.ts$/, fullyParallel: false, workers: 1, timeout: 180_000,
  reporter: [['list']],
  use: { baseURL: state.kafe, channel: process.env.PAKET_KANAL ?? 'msedge', acceptDownloads: true, trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1280, height: 900 },
    storageState: { cookies: [], origins: [{ origin: state.kafe, localStorage: [{ name: 'mola-report-view', value: 'detail' }] }] } },
});

import { defineConfig } from '@playwright/test';
// "5 yıllık hız ve hata testi" browser part (scripts/bes-yil-tarayici.spec.ts): against a server already running on E2E_PORT
// (3400) with the five-year data; never part of the normal browser suite.
const port = process.env.E2E_PORT ?? '3400';
export default defineConfig({
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '../test-results/bes-yil',
  testDir: '.', testMatch: 'bes-yil-tarayici.spec.ts', fullyParallel: false, workers: 1, timeout: 600_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, channel: process.env.CI ? undefined : 'chrome', viewport: { width: 1280, height: 800 },
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${port}`, localStorage: [{ name: 'mola-report-view', value: 'detail' }] }] } },
});

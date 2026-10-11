import { defineConfig } from '@playwright/test';
// E2E_PORT / E2E_MERKEZ_PORT: another run on the same computer (default 3100 / 3190).
const port = process.env.E2E_PORT ?? '3100';
export default defineConfig({
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results',
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: [['list']],
  // Satış ve Raporlar opens on the plain summary for a new device; the older specs read the full reports, so their devices
  // remember "Detaylı göster" (src/SalesReports.tsx). tests/browser/report-simple.spec.ts starts like a new device.
  // locale: the guest menu starts in the phone's language (K-H, src/guestText.ts startsInEnglish); the specs are a Turkish
  // phone unless they say otherwise (tests/browser/menu-language.spec.ts opens an English one).
  // mola-campaign-ended: a campaign one spec ends (time or quota) must not open the owner's "Kampanya bitti" window over the next
  // specs' screens (src/CampaignEnded.tsx); tests/browser/campaign-ended.spec.ts opens it on its own device.
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'tr-TR', channel: process.env.CI ? undefined : 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${port}`, localStorage: [{ name: 'mola-report-view', value: 'detail' }, { name: 'mola-campaign-ended', value: 'off' }] }] } },
  webServer: { command: 'node scripts/test-server.mjs', url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false, timeout: 90000 },
});

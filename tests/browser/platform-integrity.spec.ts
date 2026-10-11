import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { ADMIN_API, detailTab, e2eRun, MERKEZ, merkezPassword, openYonetim, yonetimBell, yonetimGo, yonetimShot } from './helpers';
import { scenario } from './protected-server';

/** One signed heartbeat from the scenario's café folder with a program files report (tests/browser/integrity-report.ts). */
function report(dataDir: string, state: 'changed' | 'ok') {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/browser/integrity-report.ts', dataDir, MERKEZ, join(e2eRun(), 'merkez', 'merkez-public-key.txt'), state], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
}

test('Mola Yönetim: a café reports changed program files: chip, Lisans card, Bugün, bell and journal; nothing is suspended; back to normal clears it', async ({ page }, info) => {
  test.setTimeout(120_000);
  // A café computer of its own (demo businesses, registered at the test Merkez); its café server is not running.
  const root = scenario('butunluk'), data = join(root, 'veri');
  const imported = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/merkez-import.ts', data, '--merkez', MERKEZ, '--merkez-data', join(e2eRun(), 'merkez'), '--demo', '--sozlesme-kabul', '--password', merkezPassword()], { encoding: 'utf8' });
  expect(imported.status, imported.stderr).toBe(0);
  report(data, 'changed');

  await openYonetim(page);
  await yonetimGo(page, 'İşletmeler');
  const tiles = page.locator('.platform-business-row').filter({ has: page.locator('.files-changed-chip') });
  await expect(tiles).toHaveCount(2);
  await expect(tiles.first().locator('.files-changed-chip')).toHaveText('Dosyalar değiştirilmiş');
  const name = (await tiles.first().locator('.platform-business-name').textContent())!.trim();
  await tiles.first().click();
  const detail = page.getByRole('region', { name, exact: true });
  await detailTab(detail, 'Lisans').click();
  const card = detail.getByRole('region', { name: 'Dosyalar değiştirilmiş' });
  await expect(card).toContainText('imzalanmış dosya listesiyle uyuşmuyor');
  await expect(card.getByText('app/server.mjs')).toBeVisible();
  await expect(card.getByText('Mola-Durdur.cmd')).toBeVisible();
  await expect(card).toContainText('virüs programı');
  await expect(card).toContainText('“Askıya al”');
  // Only the vendor decides: the business is still running.
  await expect(detail.getByRole('button', { name: 'Askıya al', exact: true })).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await yonetimShot(page, 'dosya-degisti.png', info.outputPath('dosya-degisti.png'), false);
  // Bugün and the bell.
  await yonetimGo(page, 'Bugün');
  await expect(page.getByRole('list', { name: 'Bugün yapılacaklar' }).getByRole('listitem').filter({ hasText: 'Mola program dosyaları değiştirilmiş' })).toHaveCount(2);
  await yonetimBell(page).click();
  await expect(page.getByText('Dosyalar değiştirilmiş', { exact: true }).first()).toBeVisible();

  const state = async () => (await (await page.request.get(`${ADMIN_API}/state`)).json());
  let s = await state();
  const mine = s.businesses.filter((b: any) => b.integrity?.state === 'changed');
  expect(mine).toHaveLength(2);
  expect(mine.every((b: any) => !b.suspended)).toBe(true);
  expect(s.alerts.filter((a: any) => a.kind === 'cafe.integrity' && mine.some((b: any) => b.tenantId === a.tenantId))).toHaveLength(1);

  // The café's files are right again (e.g. reinstalled): the warning goes, a journal line says so.
  report(data, 'ok');
  s = await state();
  expect(s.businesses.filter((b: any) => mine.some((m: any) => m.tenantId === b.tenantId)).every((b: any) => b.integrity.state === 'ok')).toBe(true);
  await page.reload();
  await yonetimGo(page, 'İşletmeler');
  await expect(page.locator('.files-changed-chip')).toHaveCount(0);
  const journal = s.audit.filter((a: any) => mine.some((b: any) => b.tenantId === a.target)).map((a: any) => a.action);
  expect(journal).toEqual(expect.arrayContaining(['integrity.changed', 'integrity.restored']));
});

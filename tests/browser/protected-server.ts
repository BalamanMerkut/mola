import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Locator } from '@playwright/test';

/** "Kaydettim": the recovery card asks for two groups of the code ("2. parça", "5. parça"); type them from `code` (or wrong ones). */
export async function typeGroups(scope: Locator, code: string, wrong = false) {
  const parts = code.split('-'), labels = scope.locator('.recovery-groups label');
  await expect(labels).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const n = Number(/^(\d)\./.exec((await labels.nth(i).textContent()) ?? '')![1]);
    await labels.nth(i).locator('input').fill(wrong ? parts[n % 6] : parts[n - 1]);
  }
  await scope.getByRole('button', { name: 'Onayla' }).click();
}
/** Port n (0–9) of the protected-server range: 3110–3119 by default, E2E_PORT+10… when another run uses other ports. */
export const protectedPort = (n: number) => Number(process.env.E2E_PORT ?? 3100) + 10 + n;
/** A temporary folder for one protected-server scenario (data, backups, flash drive). */
export function scenario(name: string) { mkdirSync('.local/e2e', { recursive: true }); return mkdtempSync(resolve(`.local/e2e/${name}-`)); }
/**
 * A built server with key protection on and a test OS lock named `user` (another name = another Windows user).
 * Ports 3110–3119 only; the default browser-test server stays on 3100. env: e.g. the test Mola Merkez to link to.
 */
export async function protectedServer(root: string, port: number, user: string, clean = false, env: Record<string, string> = {}) {
  const keyFile = join(root, 'masaustu.anahtar'), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/test-protected-server.ts'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: String(port), DATA_DIR: join(root, 'veri'), MOLA_DESKTOP_KEY: keyFile, MOLA_TEST_OS_USER: user, MOLA_CLEAN_INSTALL: clean ? '1' : '0', MOLA_AUTO_BACKUP: '1', MOLA_BACKUP_DISCOVERY: '0', BACKUP_DIR: join(root, 'backups'), BACKUP_KEY_DIR: join(root, 'backup-keys'), BACKUP_CHECK_DIR: join(root, 'restore-checks'), ...env },
  });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    if (i > 120 || child.exitCode !== null) throw new Error('Korumalı test sunucusu açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
  const token = readFileSync(keyFile, 'utf8');
  const desktop = async <T = Record<string, unknown>>(path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Mola-Desktop': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => ({})) as T };
  };
  return {
    base, token, desktop,
    /** Through the window's own "Kapat", so the data lock is released before the next start. */
    async stop() {
      await desktop('/api/desktop/shutdown', {}).catch(() => {});
      const timer = setTimeout(() => child.kill(), 10000);
      await exited; clearTimeout(timer);
    },
  };
}

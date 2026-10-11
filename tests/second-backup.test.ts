import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { KeyVault, adoptKey } from '../server/key-vault.js';
import { BackupScheduler } from '../server/backup-scheduler.js';
import { SecondBackup, findBackups } from '../server/second-backup.js';
import { restoreBackup } from '../server/backup.js';
import { BACKUP_KEY_FILE } from '../server/backup-key.js';
import { DomainError } from '../packages/domain/engine.js';
import { FAST_KDF, assertNoSecrets, fakeOsLock } from './fake-os-lock.js';

const folder = (name: string) => { mkdirSync('.local/tests', { recursive: true }); return mkdtempSync(resolve(`.local/tests/${name}-`)); };
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function protectedCafe(root: string) {
  const data = join(root, 'veri'), lock = fakeOsLock();
  const vault = await KeyVault.open(data, { protect: true, osLock: lock, kdf: FAST_KDF });
  const code = vault.reveal(); vault.confirm();
  const store = new Store(data, ['mola-demo'], { key: vault.key! }); store.mutate('mola-demo', s => { s.name = 'İkinci yer kafe'; });
  const folders = { backups: join(root, 'backups'), keys: join(root, 'keys'), checks: join(root, 'checks') };
  return { data, vault, code, store, folders };
}

test('second place: each verified backup is copied and checked, the newest N stay, never a raw key or the code', async () => {
  const root = folder('second-copy'), { data, vault, code, store, folders } = await protectedCafe(root);
  try {
    const flash = join(root, 'flash'); mkdirSync(flash);
    const second = new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), vault.installId!, { data, ...folders }, 2);
    await second.choose(flash, 'usb', 'Flash bellek (E:)');
    let clock = new Date('2026-10-03T10:00:00');
    const scheduler = new BackupScheduler(data, { ...folders, protection: () => vault.backupProtection(), second }, () => clock);
    for (let i = 0; i < 3; i++) { const s = await scheduler.runNow(); assert.equal(s.lastError, undefined, s.lastError); clock = new Date(clock.getTime() + 60000); }
    assert.deepEqual(readdirSync(folders.keys), [], 'protected backups write no key files');
    const status = second.status();
    assert.ok(status.lastCopyAt); assert.equal(status.lastError, undefined); assert.equal(status.kept, 2);
    const copies = readdirSync(second.root!).sort();
    assert.equal(copies.length, 2); assert.ok(copies.every(n => n.startsWith('backup-')));
    assert.ok(existsSync(join(flash, 'Mola-Yedek', 'BENIOKU.txt')));
    // Copy equals the original, file by file; the newest one is the last backup made.
    const last = scheduler.status().lastDirectory!, copy = join(second.root!, copies.at(-1)!);
    assert.equal(copies.at(-1), last.split(/[\\/]/).at(-1));
    for (const name of readdirSync(last)) assert.equal(sha(join(copy, name)), sha(join(last, name)), name);
    assert.ok(readdirSync(copy).includes(BACKUP_KEY_FILE)); assert.ok(!readdirSync(copy).some(n => n.endsWith('.key')));
    // The copy alone + the recovery code = the data, on a computer that never saw this café.
    const restored = await restoreBackup(copy, { code }, join(root, 'yeni-pc'));
    await adoptKey(restored.directory, restored.master!, restored.recovery!, restored.installId!, fakeOsLock('yeni-pc'));
    const opened = await KeyVault.open(restored.directory, { protect: true, osLock: fakeOsLock('yeni-pc'), kdf: FAST_KDF });
    const copyStore = new Store(restored.directory, [], { key: opened.key! }); assert.equal(copyStore.read('mola-demo').name, 'İkinci yer kafe'); copyStore.close();
    assertNoSecrets(flash, vault.key!, [code]);
  } finally { store.close(); }
});

test('a missing flash drive is a clear warning, the backup itself still succeeds, and the next backup copies again', async () => {
  const root = folder('second-missing'), { data, vault, store, folders } = await protectedCafe(root);
  try {
    const flash = join(root, 'flash'); mkdirSync(flash);
    const second = new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), vault.installId!, { data, ...folders });
    await second.choose(flash, 'usb');
    const scheduler = new BackupScheduler(data, { ...folders, protection: () => vault.backupProtection(), second });
    renameSync(flash, join(root, 'cekmecede'));
    const missing = await scheduler.runNow();
    assert.equal(missing.lastError, undefined, 'the main backup is fine'); assert.ok(missing.lastSuccessAt);
    assert.equal(second.status().lastError, 'Flash bellek takılı değil, ikinci yedek alınamadı.');
    // The setting survives a restart, warning included, so the rail and the panel can show it.
    assert.equal(new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), vault.installId!, { data, ...folders }).status().lastError, 'Flash bellek takılı değil, ikinci yedek alınamadı.');
    renameSync(join(root, 'cekmecede'), flash);
    await scheduler.runNow();
    assert.equal(second.status().lastError, undefined); assert.equal(readdirSync(second.root!).length, 1);
  } finally { store.close(); }
});

test('a copy that does not match its original is not kept, and the place is checked when it is chosen', async () => {
  const root = folder('second-corrupt'), { data, vault, store, folders } = await protectedCafe(root);
  try {
    const flash = join(root, 'flash'); mkdirSync(flash);
    const scheduler = new BackupScheduler(data, { ...folders, protection: () => vault.backupProtection() });
    await scheduler.runNow();
    const backup = scheduler.status().lastDirectory!;
    // A flash drive that silently writes garbage into one file.
    const bad = new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), vault.installId!, { data, ...folders }, 7, async (from, to) => { await fs.copyFile(from, to); if (to.endsWith('manifest.bin')) writeFileSync(to, 'bozuk'); });
    await bad.choose(flash);
    await bad.copy(backup);
    assert.match(bad.status().lastError ?? '', /doğrulanamadı/);
    assert.equal(readdirSync(bad.root!).filter(n => !n.endsWith('.kopyalaniyor')).length, 0, 'no copy is presented as good');
    const good = new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), vault.installId!, { data, ...folders });
    await good.copy(backup);
    assert.equal(good.status().lastError, undefined); assert.deepEqual(readdirSync(good.root!), [backup.split(/[\\/]/).at(-1)], 'the leftover of the bad copy is cleaned');
    for (const [path, code] of [[join(data, 'icerde'), 'INVALID_FOLDER'], [join(folders.backups, 'alt'), 'INVALID_FOLDER'], [join(root, 'yok'), 'FOLDER_MISSING'], ['goreli/yol', 'INVALID_FOLDER']] as const) {
      if (path.startsWith(data) || path.startsWith(folders.backups)) mkdirSync(path, { recursive: true });
      await assert.rejects(good.choose(path), (e: DomainError) => e.code === code, path);
    }
    assert.equal((await good.choose(null)).folder, null);
  } finally { store.close(); }
});

test('backups that open with a recovery code are found in the second-place layout, plain backup folders and a typed folder', async () => {
  const root = folder('second-find'), { data, vault, store, folders } = await protectedCafe(root);
  try {
    const flash = join(root, 'flash'); mkdirSync(flash);
    const second = new SecondBackup(join(folders.backups, 'ikinci-yedek.json'), vault.installId!, { data, ...folders });
    await second.choose(flash);
    let clock = new Date('2026-10-03T10:00:00');
    const scheduler = new BackupScheduler(data, { ...folders, protection: () => vault.backupProtection(), second }, () => clock);
    await scheduler.runNow(); clock = new Date('2026-10-04T10:00:00'); await scheduler.runNow();
    const fromFlash = await findBackups([{ path: flash, label: 'Flash' }]);
    assert.equal(fromFlash.length, 2); assert.ok(Date.parse(fromFlash[0].createdAt) >= Date.parse(fromFlash[1].createdAt)); assert.ok(fromFlash.every(b => b.verified && b.installId === vault.installId));
    assert.equal((await findBackups([{ path: folders.backups, label: 'Bu bilgisayar' }])).length, 2);
    assert.equal((await findBackups([{ path: fromFlash[0].path, label: 'Seçilen' }])).length, 1);
    assert.deepEqual(await findBackups([{ path: join(root, 'hic-yok'), label: 'x' }]), []);
  } finally { store.close(); }
});

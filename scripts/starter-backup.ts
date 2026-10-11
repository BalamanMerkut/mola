import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Store } from '../server/store.js';
import { starterState, starterTemplate } from '../server/starter-template.js';
import { createBackup, restoreBackup } from '../server/backup.js';
import { sectorTemplate, sectorTemplateFiles } from '../server/sector-templates.js';
await fs.mkdir('templates', { recursive: true });
await fs.writeFile('templates/cafe-v1.json', JSON.stringify(starterTemplate(), null, 2));
// Restaurant and dessert-shop starter menus: the setup wizard loads them from code; these files are the readable copies.
for (const sector of ['restaurant', 'dessert'] as const) await fs.writeFile(sectorTemplateFiles[sector], JSON.stringify(sectorTemplate(sector), null, 2));
await fs.mkdir('.local/templates', { recursive: true });
const directory = await fs.mkdtemp(resolve('.local/templates/cafe-'));
const store = new Store(directory, []);
try { store.db.exec('BEGIN IMMEDIATE'); store.db.prepare('INSERT INTO snapshots VALUES (?,?)').run('starter-template', store.encode(starterState('starter-template', 'Yeni işletme'))); store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; } finally { store.close(); }
await fs.copyFile('templates/cafe-v1.json', join(directory, 'cafe-template.json'));
const backup = await createBackup(directory, '.local/backups', '.local/backup-keys');
const restored = await restoreBackup(backup.directory, backup.keyPath, '.local/restored');
console.log(JSON.stringify({ template: resolve('templates/cafe-v1.json'), backup, restored }, null, 2));

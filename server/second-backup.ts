import fs from 'node:fs/promises';
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { DomainError } from '../packages/domain/engine.js';
import { pathsOverlap } from './backup-paths.js';
import { runPowerShell } from './os-lock.js';
import { writeAtomic } from './key-vault.js';
import { BACKUP_KEY_FILE } from './backup-key.js';

export type PlaceKind = 'usb' | 'onedrive' | 'gdrive' | 'folder';
export type Place = { path: string; label: string; kind: PlaceKind };
type Saved = { folder: string | null; kind?: PlaceKind; label?: string; lastCopyAt?: string; lastError?: string; kept?: number };
export type SecondStatus = Saved & { keep: number; root: string | null };
const FOLDER = 'Mola-Yedek';
const README = `MOLA YEDEKLERİ (ikinci kopya)

Bu klasördeki yedekler şifrelidir. Açmak için Mola'nın kurtarma kodu gerekir; kod buraya yazılmaz.
Bilgisayar bozulur ya da çalınırsa: yeni bilgisayara Mola'yı kurun, ilk ekranda "Yedekten geri yükle"yi seçin,
bu klasörü gösterin ve kâğıttaki kurtarma kodunu girin.

Klasörlerin adlarını değiştirmeyin, içlerindeki dosyaları silmeyin.
`;
async function hash(path: string) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
const yieldNow = () => new Promise(r => setImmediate(r));

/**
 * "İkinci yedek yeri": after each verified backup, the encrypted backup (with its sealed key, never a raw key or the code)
 * is copied to <chosen>/Mola-Yedek/<install>/<backup>, checked file by file, and only the newest 3 are kept there (a flash
 * drive is small; the computer keeps the longer history). A missing flash drive is recorded as a warning and the next backup
 * tries again; it never fails the backup itself.
 */
export class SecondBackup {
  private saved: Saved = { folder: null };
  constructor(private file: string, private installId: string, private guard: { data: string; backups: string; checks: string }, readonly keep = 3, private copyFile: (from: string, to: string) => Promise<void> = (a, b) => fs.copyFile(a, b)) {
    try { this.saved = { folder: null, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* not chosen yet */ }
  }
  get root() { return this.saved.folder ? join(this.saved.folder, FOLDER, this.installId) : null; }
  status(): SecondStatus { return { ...this.saved, keep: this.keep, root: this.root }; }
  private async save() { await fs.mkdir(dirname(this.file), { recursive: true }); writeAtomic(this.file, JSON.stringify(this.saved, null, 2) + '\n'); }
  /** null turns it off. The place must exist and be writable now; it must not be the data or the backup folder. */
  async choose(folder: string | null, kind: PlaceKind = 'folder', label?: string) {
    if (folder === null) { this.saved = { folder: null }; await this.save(); return this.status(); }
    const path = resolve(folder.trim());
    if (!isAbsolute(folder.trim()) || folder.length > 400) throw new DomainError('INVALID_FOLDER', 'Tam bir klasör yolu yazın (ör. E:\\ ya da C:\\Users\\Kafe\\OneDrive).', 400);
    for (const other of [this.guard.data, this.guard.backups, this.guard.checks]) if (pathsOverlap(path, other)) throw new DomainError('INVALID_FOLDER', 'İkinci yedek yeri, veri ya da asıl yedek klasöründen ayrı olmalı (başka disk ya da flash bellek).', 400);
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new DomainError('FOLDER_MISSING', kind === 'usb' ? 'Flash bellek takılı değil. Takıp yeniden deneyin.' : 'Bu klasör bulunamadı.', 409);
    try {
      const target = join(path, FOLDER, this.installId); await fs.mkdir(target, { recursive: true });
      const probe = join(target, `.deneme-${randomUUID()}`); await fs.writeFile(probe, ''); await fs.rm(probe);
    } catch { throw new DomainError('FOLDER_READONLY', 'Bu klasöre yazılamıyor. Başka bir yer seçin.', 409); }
    this.saved = { folder: path, kind, label: label?.slice(0, 80) };
    await this.save();
    return this.status();
  }
  /** Never throws: the result is in the status (lastCopyAt or lastError). */
  async copy(backupDir: string) {
    const folder = this.saved.folder;
    if (!folder) return this.status();
    try {
      if (!existsSync(folder)) throw new Error(this.saved.kind === 'usb' || !existsSync(parse(folder).root) ? 'Flash bellek takılı değil, ikinci yedek alınamadı.' : 'İkinci yedek klasörü bulunamadı, ikinci yedek alınamadı.');
      const root = this.root!, name = basename(backupDir), temp = join(root, `${name}.kopyalaniyor`), final = join(root, name);
      await fs.mkdir(root, { recursive: true });
      if (!existsSync(join(folder, FOLDER, 'BENIOKU.txt'))) await fs.writeFile(join(folder, FOLDER, 'BENIOKU.txt'), '\uFEFF' + README.replace(/\n/g, '\r\n')).catch(() => {});
      await fs.rm(temp, { recursive: true, force: true }); await fs.mkdir(temp);
      // The backup folder is flat: encrypted blobs, the sealed manifest and key, completion and proof records. Never a raw key.
      const files = (await fs.readdir(backupDir, { withFileTypes: true })).filter(e => e.isFile() && !/\.key$/.test(e.name)).map(e => e.name);
      if (!files.includes('complete.json') || !files.includes(BACKUP_KEY_FILE)) throw new Error('Yedek eksik; ikinci kopya alınmadı.');
      for (const file of files) { await this.copyFile(join(backupDir, file), join(temp, file)); await yieldNow(); }
      for (const file of files) if (await hash(join(backupDir, file)) !== await hash(join(temp, file))) throw new Error('İkinci kopya doğrulanamadı (dosya bozuk yazıldı). Flash belleği kontrol edin.');
      // Year packages (server/year-packages.ts): each stored once in <place>/yillar/, never removed (backups only refer to them).
      let completion: { packages?: { blob: string; size: number; sha256: string }[] } = {};
      try { completion = JSON.parse(await fs.readFile(join(backupDir, 'complete.json'), 'utf8')); } catch { /* an older record: no packages */ }
      for (const p of completion.packages ?? []) {
        const years = join(root, 'yillar'), to = join(years, p.blob);
        if (existsSync(to) && statSync(to).size === p.size) continue;
        const from = [join(backupDir, p.blob), join(dirname(backupDir), 'yillar', p.blob)].find(path => existsSync(path));
        if (!from) throw new Error('Yıl paketi bulunamadı; ikinci kopya alınmadı.');
        await fs.mkdir(years, { recursive: true });
        const part = `${to}.kopyalaniyor`;
        await this.copyFile(from, part);
        if (await hash(part) !== p.sha256) { await fs.rm(part, { force: true }); throw new Error('İkinci kopya doğrulanamadı (yıl paketi bozuk yazıldı). Flash belleği kontrol edin.'); }
        await fs.rename(part, to);
        if (existsSync(`${from}.json`)) await fs.copyFile(`${from}.json`, `${to}.json`);
      }
      await fs.rm(final, { recursive: true, force: true }); await fs.rename(temp, final);
      // Newest N complete copies stay; older ones and leftovers of interrupted copies go (yillar/ is no copy: it stays).
      const entries = (await fs.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && e.name !== 'yillar');
      const done = entries.filter(e => /^backup-[\w-]+$/.test(e.name) && existsSync(join(root, e.name, 'complete.json'))).map(e => e.name).sort().reverse();
      for (const old of [...done.slice(this.keep), ...entries.filter(e => e.name.endsWith('.kopyalaniyor')).map(e => e.name)]) await fs.rm(join(root, old), { recursive: true, force: true });
      Object.assign(this.saved, { lastCopyAt: new Date().toISOString(), lastError: undefined, kept: Math.min(done.length, this.keep) });
    } catch (error) {
      this.saved.lastError = error instanceof Error ? error.message.slice(0, 200) : 'İkinci yedek alınamadı.';
    }
    await this.save().catch(() => {});
    return this.status();
  }
}

/** source: where the owner should think the copy is ("Bu bilgisayar", the second place, another drive or folder). */
export type BackupSource = 'local' | 'second' | 'other';
export type FoundBackup = { path: string; createdAt: string; installId: string; verified: boolean; place: string; source: BackupSource; bytes: number };
/**
 * Backups that open with a recovery code, in the given folders: the folder itself, its backup-* folders, or
 * Mola-Yedek/<install>/backup-* below it (the second place's layout). Verified first, then newest; at most 60.
 * skipInstall: this clean install's own id; its backups hold no business and would only be picked by mistake.
 */
export async function findBackups(folders: { path: string; label: string; source?: BackupSource }[], skipInstall?: string) {
  const found = new Map<string, FoundBackup>();
  async function consider(dir: string, label: string, source: BackupSource) {
    if (found.has(dir.toLowerCase()) || dir.endsWith('.kopyalaniyor')) return;
    try {
      const completion = JSON.parse(await fs.readFile(join(dir, 'complete.json'), 'utf8'));
      const key = JSON.parse(await fs.readFile(join(dir, BACKUP_KEY_FILE), 'utf8'));
      if (existsSync(join(dir, 'BACKUP_IN_PROGRESS.txt')) || existsSync(join(dir, 'BACKUP_FAILED.txt')) || (completion.format !== 1 && completion.format !== 2) || !Number.isFinite(Date.parse(completion.createdAt)) || typeof key.installId !== 'string' || key.installId === skipInstall) return;
      // The backup folder is flat (blobs + records): its size is the sum of its files, and of the year packages it refers to.
      let bytes = 0; for (const e of await fs.readdir(dir, { withFileTypes: true })) if (e.isFile()) bytes += (await fs.stat(join(dir, e.name))).size;
      for (const p of (completion.packages ?? []) as { size: number }[]) bytes += p.size;
      found.set(dir.toLowerCase(), { path: dir, createdAt: completion.createdAt, installId: key.installId, verified: existsSync(join(dir, 'verification.json')), place: label, source: source === 'other' && secondPlaceRoot(dir) ? 'second' : source, bytes });
    } catch { /* not a protected backup */ }
  }
  const subdirs = async (dir: string) => { try { return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).slice(0, 400).map(e => join(dir, e.name)); } catch { return []; } };
  for (const { path, label, source = 'other' } of folders) {
    const base = resolve(path);
    await consider(base, label, source);
    for (const dir of await subdirs(base)) {
      if (/^backup-/.test(basename(dir))) await consider(dir, label, source);
      else if (basename(dir) === FOLDER || /^[a-f0-9-]{36}$/.test(basename(dir))) for (const inner of await subdirs(dir)) {
        if (/^backup-/.test(basename(inner))) await consider(inner, label, source);
        else for (const deep of await subdirs(inner)) if (/^backup-/.test(basename(deep))) await consider(deep, label, source);
      }
      await yieldNow();
    }
  }
  // A checked copy beats a newer unchecked one: the first in the list is the one picked for the owner.
  return [...found.values()].sort((a, b) => Number(b.verified) - Number(a.verified) || Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 60);
}
/** The chosen root of a copy in the second place's layout (<root>/Mola-Yedek/<install>/backup-…), or undefined. */
export function secondPlaceRoot(backup: string) {
  const dir = resolve(backup), install = dirname(dir), folder = dirname(install);
  return /^backup-/.test(basename(dir)) && /^[a-f0-9-]{36}$/.test(basename(install)) && basename(folder) === FOLDER ? dirname(folder) : undefined;
}

/** Places to offer: flash drives, OneDrive, Google Drive for desktop. Best effort; a typed path is always possible. */
export async function backupPlaces(): Promise<Place[]> {
  const places: Place[] = [], seen = new Set<string>();
  // Tests run on real developer machines: a real Mola install's copies in OneDrive or on a USB stick must not leak in.
  if (process.env.MOLA_BACKUP_DISCOVERY === '0') return places;
  const add = (path: string, label: string, kind: PlaceKind) => { const key = resolve(path).toLowerCase(); if (!seen.has(key) && existsSync(path)) { seen.add(key); places.push({ path: resolve(path), label, kind }); } };
  const home = homedir();
  if (process.platform === 'win32') {
    try {
      const { code, out } = await runPowerShell("Get-CimInstance Win32_LogicalDisk | ForEach-Object { '{0}|{1}|{2}' -f $_.DeviceID, $_.DriveType, $_.VolumeName }", '', 10000);
      if (code === 0) for (const line of out.split(/\r?\n/)) {
        const [id, type, name = ''] = line.trim().split('|');
        if (!/^[A-Z]:$/.test(id ?? '')) continue;
        if (type === '2') add(`${id}\\`, `Flash bellek (${id}${name ? ` ${name}` : ''})`, 'usb');
        if (/google drive/i.test(name)) for (const sub of ['My Drive', "Drive'ım"]) add(`${id}\\${sub}`, `Google Drive (${id})`, 'gdrive');
      }
    } catch { /* PowerShell unavailable: typed path still works */ }
    for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (process.env[name]) add(process.env[name]!, 'OneDrive', 'onedrive');
    for (const sub of ['Google Drive', 'My Drive']) add(join(home, sub), 'Google Drive', 'gdrive');
  } else if (process.platform === 'darwin') {
    // The system disk appears in /Volumes as a link to "/"; everything else there is an external disk.
    try { for (const name of readdirSync('/Volumes')) if (!lstatSync(join('/Volumes', name)).isSymbolicLink()) add(join('/Volumes', name), `Harici disk (${name})`, 'usb'); } catch { /* none */ }
    try { for (const name of readdirSync(join(home, 'Library', 'CloudStorage'))) { const path = join(home, 'Library', 'CloudStorage', name); if (name.startsWith('OneDrive')) add(path, 'OneDrive', 'onedrive'); if (name.startsWith('GoogleDrive')) add(join(path, 'My Drive'), 'Google Drive', 'gdrive'); } } catch { /* none */ }
  } else {
    const user = userInfo().username;
    for (const base of [`/media/${user}`, `/run/media/${user}`]) { try { for (const name of readdirSync(base)) add(join(base, name), `Harici disk (${name})`, 'usb'); } catch { /* none */ } }
  }
  return places;
}

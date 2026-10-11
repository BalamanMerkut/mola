import { backupVerification } from './backup-verification.js';
import { DatabaseSync } from 'node:sqlite';
import { assertDataVersion } from './data-version.js';
import { verifyPackage } from './package-integrity.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { assertRestoreReady } from './restore-safety.js';
import { diskCapacity } from './disk-capacity.js';
import { backupAge } from './backup-age.js';
import { staleLock } from './data-lock.js';
import { readKeyFile } from './key-vault.js';

export async function pilotReadiness(root: string, dataDir: string, port: number, backupDir?: string, checkDisk = diskCapacity) {
  const failures: string[] = [], warnings: string[] = [];
  root = resolve(root); dataDir = resolve(dataDir);
  if (Number(process.versions.node.split('.')[0]) < 24) failures.push('Node.js 24 veya üstü gerekli.');
  for (const file of ['dist/index.html', 'templates/cafe-v1.json']) if (!existsSync(join(root, file))) failures.push(`${file} eksik.`);
  try { assertRestoreReady(dataDir); } catch { failures.push('Veri klasörünün geri yüklemesi tamamlanmamış veya doğrulanamamış.'); }
  const lockPath = join(dataDir, '.mola-operation.lock'), lockStale = existsSync(lockPath) && staleLock(lockPath);
  if (lockStale) warnings.push('Önceki beklenmedik kapanmadan kalan kilit var; uygulama açılırken kendiliğinden kaldırılacak.');
  else if (existsSync(lockPath)) failures.push('Veri klasörü kullanımda veya eski işlem kilidi var. Önce çalışan işlemi kontrol edin.');
  try {
    mkdirSync(dataDir, { recursive: true }); const probe = join(dataDir, `.probe-${randomUUID()}`);
    writeFileSync(probe, '', { flag: 'wx' }); unlinkSync(probe);
  } catch { failures.push('Veri klasörüne yazılamıyor.'); }
  const disk = await checkDisk(dataDir);
  if (disk.status === 'critical') failures.push(disk.message);
  else if (disk.status !== 'ok') warnings.push(disk.message);
  const hasDatabase = existsSync(join(dataDir, 'merchant.sqlite')), key = join(dataDir, 'development.key');
  // Protected installs keep the key in anahtar.json (locked by the OS and the recovery code) instead of development.key.
  let protectedKey = false;
  try { protectedKey = !!readKeyFile(dataDir); } catch { failures.push('Anahtar dosyası (anahtar.json) bozuk.'); }
  try {
    if (hasDatabase && !existsSync(key) && !protectedKey && !existsSync(join(dataDir, 'anahtar.json'))) failures.push('Veritabanının anahtarı eksik.');
    if (existsSync(key) && readFileSync(key).length !== 32) failures.push('Veri anahtarının boyutu geçersiz.');
  } catch { failures.push('Veri anahtarı okunamıyor.'); }
  let databaseCheck: { status: 'new' | 'skipped' | 'verified' | 'failed'; version: number | null } = { status: hasDatabase ? 'skipped' : 'new', version: null };
  if (hasDatabase && (lockStale || !existsSync(lockPath)) && !existsSync(join(dataDir, 'RESTORE_IN_PROGRESS.txt')) && !existsSync(join(dataDir, 'RESTORE_FAILED.txt'))) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(dataDir, 'merchant.sqlite'), { readOnly: true });
      const version = assertDataVersion(db);
      if (Object.values(db.prepare('PRAGMA quick_check').get() ?? {})[0] !== 'ok') throw new Error('Veritabanı bütünlüğü doğrulanamadı. Doğrulanmış yedeği ayrı klasörde deneyin.');
      databaseCheck = { status: 'verified', version };
    } catch (error) {
      databaseCheck = { status: 'failed', version: null };
      const message = (error as Error).message;
      failures.push(message.startsWith('Veri biçimi') || message.startsWith('Veritabanı bütünlüğü') ? message : 'Veritabanı okunamadı veya bozuk. Veri yolunu ve doğrulanmış yedeği kontrol edin.');
    } finally { db?.close(); }
  }
  let packageIntegrity: 'verified' | 'development' | 'failed' = 'development';
  try { packageIntegrity = verifyPackage(root); if (packageIntegrity === 'development') warnings.push('Geliştirme klasörü: paket bütünlük manifesti bulunmuyor.'); }
  catch (error) { packageIntegrity = 'failed'; failures.push((error as Error).message); }
  if (!Number.isInteger(port) || port < 1 || port > 65535) failures.push('Port 1–65535 arasında tam sayı olmalı.');
  else await new Promise<void>(done => {
    const server = createServer();
    server.once('error', () => { failures.push(`${port} portu kullanılamıyor; başka bir uygulama kullanıyor olabilir.`); done(); });
    server.listen(port, '127.0.0.1', () => server.close(() => done()));
  });
  let latestBackup: string | null = null; let latestBackupDirectory: string | null = null;
  if (backupDir && existsSync(backupDir)) {
    try {
      const completed = readdirSync(backupDir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('backup-')).map(e => {
        if (existsSync(join(backupDir, e.name, 'BACKUP_IN_PROGRESS.txt')) || existsSync(join(backupDir, e.name, 'BACKUP_FAILED.txt'))) return null;
        try { const m = JSON.parse(readFileSync(join(backupDir, e.name, 'complete.json'), 'utf8')); return (m.format === 1 || m.format === 2) && Number.isFinite(Date.parse(m.createdAt)) ? { createdAt: m.createdAt as string, directory: join(backupDir, e.name) } : null; } catch { return null; }
      }).filter((entry): entry is { createdAt: string; directory: string } => !!entry).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (completed.some(date => backupAge(date.createdAt).status === 'invalid')) warnings.push('Gelecek tarihli yedek kaydı bulundu; bilgisayar saatini kontrol edin. Bu kayıt güncel yedek sayılmadı.');
      const latest = completed.find(date => backupAge(date.createdAt).status !== 'invalid');
      latestBackup = latest?.createdAt ?? null; latestBackupDirectory = latest?.directory ?? null;
    } catch { warnings.push('Yedek klasörü okunamadı.'); }
  }
  if (hasDatabase && !latestBackup) warnings.push('Belirlenen yedek klasöründe tamamlanmış yedek bulunamadı.');
  if (latestBackup) warnings.push('Yedek tarihi tamamlanma kaydından okunur; geri yükleme doğrulaması yerine geçmez.');
  const verification = backupVerification(latestBackupDirectory);
  if (verification.status === 'failed') warnings.push('Son yedeğin geri yükleme doğrulaması başarısız. Ayrı klasörde yeniden prova yapın.');
  if (verification.status === 'unverified') warnings.push('Son yedek için başarılı geri yükleme doğrulama kaydı yok.');
  if (verification.status === 'invalid') warnings.push('Son yedeğin doğrulama kaydı okunamadı veya yedekle uyuşmuyor.');
  if (verification.status === 'recorded') warnings.push('Son yedek için başarılı prova kaydı var. Bu kontrol yedeği yeniden açmaz ve kaydın gerçekliğini kanıtlamaz.');
  const backupFreshness = backupAge(latestBackup);
  if (hasDatabase && backupFreshness.status === 'stale') warnings.push('Son tamamlanmış yedek 24 saatten eski. Yeni yedek ve düzenli geri yükleme provası önerilir.');
  const backupDisk = backupDir && existsSync(backupDir) ? await checkDisk(resolve(backupDir)) : null;
  if (backupDisk && backupDisk.status !== 'ok') warnings.push(`Yedek hedefi: ${backupDisk.message} Bu uyarı uygulamanın açılmasını engellemez.`);
  if (backupDir && !existsSync(backupDir)) warnings.push('Yedek hedefi henüz yok; hedef diskin boş alanı ölçülmedi.');
  return { checkedAt: new Date().toISOString(), databaseCheck, ready: failures.length === 0, mode: 'yerel-pilot', failures, warnings, packageIntegrity, latestBackup, backupFreshness, backupVerification: verification, disk, backupDisk, local: `http://localhost:${port}`, note: 'Kontrol sonucu üretim onayı değildir. Port ve disk alanı kontrolü kaynak ayırmaz; gerçek cihaz testi ve ayrı klasöre geri yükleme provası gerekir.' };
}

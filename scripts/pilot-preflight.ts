import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pilotReadiness } from '../server/pilot-readiness.js';

const rawArgs = process.argv.slice(2);
const summary = rawArgs.includes('--summary');
const args = rawArgs.filter(arg => arg !== '--summary');
if (args.length && (args.length !== 2 || args[0] !== '--report')) throw new Error('Kullanım: npm run pilot:check -- [--summary] [--report <yeni-json-dosyası>]');
const result = await pilotReadiness(resolve('.'), resolve(process.env.DATA_DIR ?? '.local/development'), Number(process.env.PORT ?? 3000), resolve(process.env.BACKUP_DIR ?? '.local/backups'));
const report = JSON.stringify(result, null, 2);
if (args.length) writeFileSync(resolve(args[1]), report + '\n', { flag: 'wx', mode: 0o600 });
if (summary) {
  console.log('\nMOLA — YEREL KURULUM KONTROLÜ\n');
  console.log(result.ready ? 'SONUÇ: Başlatma kontrolü geçti.' : 'SONUÇ: Başlatılamıyor. Aşağıdaki sorunları giderin.');
  console.log(`Veri klasörü: ${resolve(process.env.DATA_DIR ?? '.local/development')}`);
  const port = Number(process.env.PORT ?? 3000);
  console.log(`Yerel adres: ${Number.isInteger(port) && port >= 1 && port <= 65535 ? result.local : 'Geçerli port girildikten sonra belirlenecek'}`);
  console.log(`Paket: ${result.packageIntegrity === 'verified' ? 'Dosya bütünlüğü doğrulandı' : result.packageIntegrity === 'development' ? 'Geliştirme klasörü' : 'Bütünlük kontrolü başarısız'}`);
  const databaseLabels = { new: 'İlk açılışta oluşturulacak', skipped: 'Kontrol atlandı; aşağıdaki sorunları inceleyin', verified: 'Dosya bütünlüğü doğrulandı', failed: 'Kontrol başarısız' };
  console.log(`Veritabanı: ${databaseLabels[result.databaseCheck.status]}`);
  const backupLabels: Record<string, string> = { missing: 'Yedek bulunamadı', unverified: 'Prova kaydı yok', failed: 'Prova başarısız', invalid: 'Prova kaydı geçersiz', recorded: 'Başarılı prova kaydı var' };
  console.log(`Yedek doğrulaması: ${backupLabels[result.backupVerification.status]}`);
  console.log(`Disk: ${result.disk.message}`);
  if (result.failures.length) console.log('\nGİDERİLMESİ GEREKENLER\n' + result.failures.map((item, index) => `${index + 1}. ${item}`).join('\n'));
  if (result.warnings.length) console.log('\nUYARILAR\n' + result.warnings.map(item => '- ' + item).join('\n'));
  if (args.length) console.log(`\nTeknik rapor: ${resolve(args[1])}`);
  console.log('\n' + result.note + '\n');
} else console.log(report);
if (!result.ready) process.exitCode = 1;

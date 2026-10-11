// Mola Merkez on a new computer: one Merkez backup + the recovery code shown in Mola Yönetim → a working data folder.
//   npm run merkez:restore -- <yedek-klasörü> [hedef-veri-klasörü]   (default target: .local/merkez-geri-yukleme-<zaman>)
// The code is asked on the keyboard (not shown, never on the command line). The target must be new or empty; the live
// Merkez folder is never overwritten. Then start Merkez with MERKEZ_DATA_DIR=<target> (or put the folder in place of veri\).
import { resolve } from 'node:path';
import { restoreMerkezBackup } from '../server/merkez/backup.js';

const [backup, target = `.local/merkez-geri-yukleme-${new Date().toISOString().replace(/[:.]/g, '-')}`] = process.argv.slice(2);
if (!backup) { console.error('Kullanım: npm run merkez:restore -- <yedek-klasörü> [hedef-veri-klasörü]'); process.exit(2); }
function askCode(): Promise<string> {
  return new Promise(done => {
    process.stdout.write('Mola Merkez kurtarma kodu: ');
    const stdin = process.stdin; let text = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding('utf8'); stdin.resume();
    stdin.on('data', (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { if (stdin.isTTY) stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); done(text.trim()); return; }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u0008' || ch === '\u007f') text = text.slice(0, -1); else text += ch;
      }
    });
  });
}
try {
  const proof = await restoreMerkezBackup(resolve(backup), await askCode(), resolve(target));
  console.log(`Geri yüklendi ve doğrulandı: ${proof.businesses} işletme, imza anahtarı yerinde. Klasör: ${resolve(target)}`);
  console.log('İlk açılışta bütün lisanslar daha yüksek sıra numarasıyla yeniden imzalanır; kafeler bir sonraki bağlantıda alır.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Geri yüklenemedi.'); process.exitCode = 1;
}

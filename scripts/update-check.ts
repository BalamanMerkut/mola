import { updateReadiness } from '../server/update-readiness.js';
const args = process.argv.slice(2);
try {
  if (args.length !== 3) throw new Error('Kullanım: npm run update:check -- <eski-paket> <yeni-paket> <mevcut-veri-klasörü>');
  console.log(JSON.stringify(updateReadiness(args[0], args[1], args[2]), null, 2));
} catch (error) {
  console.error(`Güncelleme kontrolü başarısız: ${(error as Error).message}`);
  process.exitCode = 1;
}

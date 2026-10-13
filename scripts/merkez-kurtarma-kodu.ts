// Mola Merkez: a new recovery code on the server (a VDS), where Mola Yönetim never shows the code. Merkez stopped, as the user
// who owns the data (server/merkez/offline-recovery.ts):
//   sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/kurtarma-kodu.sh; sudo systemctl start mola-merkez
//   npm run merkez:kurtarma-kodu [-- <veri-klasörü>] [--evet]
// The new code is printed; it counts only after two of its groups are typed back (--evet: without asking, for scripts).
// Exit codes: 0 done (or cancelled: nothing changed), 1 failed, 2 usage, 3 Merkez is running.
import { randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { openOfflineRecovery } from '../server/merkez/offline-recovery.js';
import { OfflineResetError } from '../server/merkez/offline-reset.js';

const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), rest = args.filter(a => !a.startsWith('--'));
const usage = 'Kullanım: npm run merkez:kurtarma-kodu -- [veri-klasörü] [--evet]';
if (flags.some(f => f !== '--evet') || rest.length > 1) { console.error(usage); process.exit(2); }
const directory = resolve(rest[0] ?? process.env.MERKEZ_DATA_DIR ?? '.local/merkez');
const confirmed = flags.includes('--evet'), interactive = !!process.stdin.isTTY && !confirmed;
if (!interactive && !confirmed) { console.error(`Onay için --evet ekleyin.\n${usage}`); process.exit(2); }
const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

console.log(`Mola Merkez · yeni kurtarma kodu\nVeri klasörü: ${directory}\n`);
let renewal;
try { renewal = await openOfflineRecovery(directory, { protect: process.env.MERKEZ_KEY_PROTECTION === '1' }); }
catch (error) {
  console.error(error instanceof Error ? error.message : 'Merkez verileri açılamadı.');
  process.exit(error instanceof OfflineResetError && error.code === 'RUNNING' ? 3 : 1);
}
const ask = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
try {
  const groups = renewal.code.split('-');
  console.log('Yeni Merkez kurtarma kodu (henüz geçerli değil):\n');
  console.log(`    ${groups.join('  ')}\n`);
  console.log('Kâğıda yazın. Fotoğrafını çekmeyin, kimseye göndermeyin. Sunucu kaybolursa Merkez yedekleri yalnız bu kodla açılır.');
  let ok = confirmed;
  if (ask) {
    // Two groups typed back: the code was really written down before the old one stops working.
    const first = randomInt(groups.length); let second = randomInt(groups.length - 1); if (second >= first) second++;
    const asked = [first, second].sort((a, b) => a - b);
    console.log('\nYazdığınızı kontrol edelim (boş bırakıp Enter: vazgeç, hiçbir şey değişmez).');
    for (let tries = 0; tries < 3 && !ok; tries++) {
      let all = true;
      for (const g of asked) {
        const typed = await ask.question(`  ${g + 1}. parça: `);
        if (!typed.trim()) { all = false; tries = 3; break; }
        if (clean(typed) !== clean(groups[g])) all = false;
      }
      if (all) ok = true; else if (tries < 2) console.log('Parçalar tutmadı. Kâğıttakini yeniden yazın.');
    }
  }
  if (!ok) console.log('\nVazgeçildi. Eski kurtarma kodu geçerli; hiçbir şey değişmedi.');
  else {
    const done = await renewal.commit();
    console.log(`\nYeni kurtarma kodu geçerli. Eski kod artık açmaz.\nSunucudaki ${done.rewrapped} Merkez yedeği yeni kodla açılır; bilgisayarınızdaki ve Google Drive'daki kopyaları`);
    console.log('"npm run vds:cek" bir sonraki çalışmasında günceller. İşlem geçmişine ve Bildirim merkezine kaydedildi.');
    console.log('Şimdi Merkez\'i yeniden başlatın: sudo systemctl start mola-merkez');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Kurtarma kodu yenilenemedi.'); process.exitCode = 1;
} finally { ask?.close(); renewal.close(); }

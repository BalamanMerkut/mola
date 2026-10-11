import { createVerifiedBackup } from '../server/verified-backup.js';
import { createBackup, restoreBackup } from '../server/backup.js';
import { adoptKey } from '../server/key-vault.js';
const [command, source, key, output, checks] = process.argv.slice(2);

/** The recovery code is read from the keyboard (not shown) or from a pipe, never from the command line. */
async function askCode() {
  process.stderr.write('Kurtarma kodu: ');
  if (!process.stdin.isTTY) { let text = ''; for await (const chunk of process.stdin) { text += chunk; if (text.includes('\n')) break; } return text.split(/\r?\n/)[0].trim(); }
  return new Promise<string>((resolve, reject) => {
    let code = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const done = (value?: string) => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stderr.write('\n'); value === undefined ? reject(new Error('Vazgeçildi.')) : resolve(value); };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(code);
        if (ch === '\u0003') return done();
        if (ch === '\u0008' || ch === '\u007f') { if (code) { code = code.slice(0, -1); process.stderr.write('\b \b'); } continue; }
        if (ch >= ' ') { code += ch; process.stderr.write('*'); }
      }
    };
    process.stdin.on('data', onData);
  });
}

if (command === 'create-verified' && source && key && output && checks) {
  console.log(JSON.stringify(await createVerifiedBackup(source, key, output, checks), null, 2));
}
else if (command === 'create' && source) {
  if (!!key !== !!output) throw new Error('Özel yedek hedefi için hem yedek klasörünü hem ayrı anahtar klasörünü belirtin.');
  console.log(JSON.stringify(await createBackup(source, key ?? '.local/backups', output ?? '.local/backup-keys'), null, 2));
}
else if (command === 'restore' && source && key) console.log(JSON.stringify(await restoreBackup(source, key, output ?? '.local/restored'), null, 2));
else if (command === 'restore-with-code' && source) {
  // Protected backup + recovery code → a new, verified folder whose key is locked for this computer's user (never a raw key file).
  const restored = await restoreBackup(source, { code: await askCode() }, key ?? '.local/restored');
  await adoptKey(restored.directory, restored.master!, restored.recovery!, restored.installId!);
  console.log(JSON.stringify({ directory: restored.directory, files: restored.files, note: 'Doğrulandı. Klasörün anahtarı bu bilgisayarın kullanıcısına kilitlendi; başka bilgisayarda aynı kurtarma koduyla açılır. Mola bu klasörü DATA_DIR olarak açabilir.' }, null, 2));
}
else if (command === 'verify' && source && key) {
  const result = await restoreBackup(source, key, output ?? '.local/restore-checks');
  console.log(JSON.stringify({ verified: true, checkedAt: new Date().toISOString(), ...result,
    checks: ['Dosya şifre çözme ve SHA-256 bütünlüğü', 'SQLite bütünlüğü', 'İşletme anahtarları ve şifreli kayıtlar', 'Hesap ve yönetim özeti tutarlılığı'],
    note: 'Prova ayrı klasörde tamamlandı. Canlı veriler değiştirilmedi. Doğrulanan kopya anahtar ve özel veriler içerir; güvenli saklayın. Bu sonuç uygulama ekranı veya gerçek cihaz testi değildir.',
  }, null, 2));
}
else throw new Error('Kullanım: npm run backup -- create-verified <veri-dizini> <yedek-hedefi> <anahtar-hedefi> <prova-hedefi> | create <veri-dizini> [yedek-hedefi anahtar-hedefi] | restore <yedek-dizini> <anahtar-dosyası> [hedef] | restore-with-code <yedek-dizini> [hedef] (kod sorulur) | verify <yedek-dizini> <anahtar-dosyası> [prova-hedefi]. Yedek oluşturmak için önce sunucuyu durdurun.');

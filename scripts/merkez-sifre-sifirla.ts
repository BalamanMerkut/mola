// Mola Yönetim "Şifremi unuttum", last resort (no Merkez recovery code, no MFA backup code): a one-time temporary password,
// printed here, changed at the next login. On the Merkez computer, by the computer user who owns the data; Merkez stopped.
//   npm run merkez:sifre-sifirla [-- <veri-klasörü>] [--iki-adimli-kapat] [--evet]
// Installed Mola Yönetim: Sifre-Sifirla.cmd (Windows) / sifre-sifirla.sh (macOS, Linux, a VDS) next to the program.
// Exit codes: 0 done (or cancelled), 1 failed, 2 usage, 3 Merkez is running (the .cmd then offers to stop it).
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { OfflineResetError, openOfflineReset } from '../server/merkez/offline-reset.js';

const args = process.argv.slice(2), flags = args.filter(a => a.startsWith('--')), rest = args.filter(a => !a.startsWith('--'));
const usage = 'Kullanım: npm run merkez:sifre-sifirla -- [veri-klasörü] [--iki-adimli-kapat] [--evet]';
if (flags.some(f => !['--iki-adimli-kapat', '--evet'].includes(f)) || rest.length > 1) { console.error(usage); process.exit(2); }
const directory = resolve(rest[0] ?? process.env.MERKEZ_DATA_DIR ?? '.local/merkez');
const confirmed = flags.includes('--evet'), interactive = !!process.stdin.isTTY && !confirmed;
if (!interactive && !confirmed) { console.error(`Onay için --evet ekleyin.\n${usage}`); process.exit(2); }
const yes = (answer: string) => /^(e|evet|y|yes)$/i.test(answer.trim());

console.log(`Mola Yönetim · yönetici şifresini sıfırlama\nVeri klasörü: ${directory}\n`);
/**
 * The key is locked for this computer user (another user, a reset Windows password, a new computer): the Merkez recovery code
 * (Ayarlar → Yedek) opens it. Typed without being shown; without a terminal, one line from stdin (scripts, tests).
 */
let piped: Promise<string[]> | undefined;
function askCode(attempt: number, problem?: string): Promise<string | null> {
  if (attempt === 1) console.log('Merkez verileri bu bilgisayar kullanıcısıyla açılamadı (anahtar başka bir kullanıcıya ya da bilgisayara kilitli).\nMerkez kurtarma kodunu girerseniz anahtar bu kullanıcıya yeniden kilitlenir. Boş bırakıp Enter: vazgeç.');
  if (problem) console.log(problem);
  if (!process.stdin.isTTY) {
    piped ??= new Promise(done => { let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => { text += c; }); process.stdin.on('end', () => done(text.split(/\r?\n/).map(l => l.trim()))); });
    return piped.then(lines => lines[attempt - 1] || null);
  }
  return new Promise(done => {
    process.stdout.write('Merkez kurtarma kodu: ');
    const stdin = process.stdin; let text = '';
    stdin.setRawMode(true); stdin.setEncoding('utf8'); stdin.resume();
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); done(text.trim() || null); return; }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u0008' || ch === '\u007f') text = text.slice(0, -1); else text += ch;
      }
    };
    stdin.on('data', onData);
  });
}
let reset;
try {
  reset = await openOfflineReset(directory, { protect: process.env.MERKEZ_KEY_PROTECTION === '1', askCode });
  if (reset.unlocked) console.log('Kurtarma kodu doğru: Merkez anahtarı bu bilgisayar kullanıcısına yeniden kilitlendi.\n');
}
catch (error) {
  console.error(error instanceof Error ? error.message : 'Merkez verileri açılamadı.');
  process.exit(error instanceof OfflineResetError && error.code === 'RUNNING' ? 3 : 1);
}
const ask = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
try {
  if (ask && !yes(await ask.question('Yönetici şifresi (kullanıcı adı: admin) geçici bir şifreyle değiştirilecek. Devam edilsin mi? [E/H] '))) {
    console.log('Vazgeçildi. Hiçbir şey değişmedi.');
  } else {
    let resetAuthenticator = flags.includes('--iki-adimli-kapat');
    if (reset.mfa && ask) {
      console.log('\nİki adımlı giriş açık. Geçici şifreyle girerken doğrulayıcı uygulamadaki kod da sorulur.');
      resetAuthenticator = yes(await ask.question('Doğrulayıcı uygulamanız (telefon) elinizde değilse iki adımlı giriş kapatılabilir; girişten sonra yeniden kurarsınız. Kapatılsın mı? [E/H] '));
    }
    const done = await reset.apply({ resetAuthenticator });
    console.log('\nGeçici şifre oluşturuldu.\n');
    console.log('  Kullanıcı adı : admin');
    console.log(`  Geçici şifre  : ${done.password}\n`);
    console.log('Mola Yönetim\'i açın ve bu şifreyle giriş yapın; hemen kendi şifrenizi belirlemeniz istenir.');
    if (reset.mfa) console.log(done.mfaReset ? 'İki adımlı giriş kapatıldı: girişten sonra Ayarlar → Hesap güvenliği’nden yeniden kurun.' : 'İki adımlı giriş açık kaldı: girişte doğrulayıcı uygulamadaki kodu da girin.');
    console.log('Bu şifre başka hiçbir yere yazılmadı; pencereyi kapatmadan not alın. İşlem geçmişine ve Bildirim merkezine kaydedildi.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Şifre sıfırlanamadı.'); process.exitCode = 1;
} finally { ask?.close(); reset.close(); }

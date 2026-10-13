import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { AyarHatasi, ayarDenetle, ayarOku, ayarYaz, hedefBulutta, ikinciKlasor, kurulumAyari, sertifikaAdlari, sunucuCoz, type VdsAyar } from '../scripts/vds/ayar.js';
import { cek, KaynakSsh, listeCoz, ozetlerCoz } from '../scripts/vds/cek.js';
import { bolumler, KomutHatasi, KOMUTLAR, komutCoz, OKU, OKU_YARDIMCI, okuHatasi, ozetMetni, sertifikaBitisi, SUDO_KOK_KOMUTLARI, uzakKomut, type KomutAdi } from '../scripts/vds/komutlar.js';
import { bilinenParmakIzleri, hazirIslem, komutSatiri, Ssh, sshArgumanlari, type Calistirici, type Islem } from '../scripts/vds/ssh.js';
import { tarOku, TarHatasi, tarYaz } from '../scripts/vds/tar.js';
import { GOREV_ADI, gunlugeYaz, kilitAl, zamanlaKomutu, zamanlamayiKaldirKomutu } from '../scripts/vds/yardimci.js';
import { WorkFolder } from '../server/merkez/workfolder.js';
import { agac, calismaYaz, gecici, kafeYaz, kurulumAdi, sha, yaz, yedekAdi, yedekYaz } from './vds-fixture.js';

/*
 * "npm run vds" and "npm run vds:cek" without a server: settings (bad host strings, paths with spaces and Turkish letters),
 * the ssh command line, the fixed command list (unknown commands and injection attempts refused), --kuru and --zamanla, the
 * tar reader, the server helper's answers, and, when Git for Windows' bash is here, the real scripts/linux/mola-oku against
 * a local folder.
 */
const ROOT = resolve(import.meta.dirname, '..');
const IZ = 'SHA256:' + 'A'.repeat(43);
const ornek = (o: Partial<VdsAyar> = {}): VdsAyar => ayarDenetle({ bicim: 1, sunucu: 'yonetici@203.0.113.10', port: 22, anahtar: 'C:\\Users\\Ayşe Yılmaz\\.ssh\\id_ed25519', parmakIzi: IZ, hedef: 'C:\\Users\\a\\Masaüstü\\kafe uygulama\\vds', ikinciHedef: null, yedekSayisi: 14, alanAdi: 'molayazilim.com.tr', ...o });

test('settings: host strings are user@address only; paths may have spaces and Turkish letters; bad values are refused', () => {
  assert.deepEqual(sunucuCoz('yonetici@203.0.113.10'), { kullanici: 'yonetici', adres: '203.0.113.10' });
  assert.deepEqual(sunucuCoz(' yonetici@sunucu.molayazilim.com.tr '), { kullanici: 'yonetici', adres: 'sunucu.molayazilim.com.tr' });
  assert.equal(sunucuCoz('deploy_1@[2001:db8::1]').adres, '[2001:db8::1]');
  for (const kotu of ['203.0.113.10', '-oProxyCommand=calc@x', 'yonetici@-oProxyCommand=calc', 'yonetici@h;rm -rf /', 'yonetici@h h', 'yonetici@$(whoami)', 'yonetici@`id`', 'yonetici@h|nc', 'Yonetici@h.com', '@h.com', 'yonetici@', 'yonetici@203.0.113.10 -p 2222', 'yonetici@h.com\nreboot', "yonetici@h'.com", 'yonetici@999.1.1.1', 'a@b@c.com', 'yonetici@h.com&calc'])
    assert.throws(() => sunucuCoz(kotu), AyarHatasi, kotu);
  const a = ornek();
  assert.equal(a.hedef, 'C:\\Users\\a\\Masaüstü\\kafe uygulama\\vds');
  assert.equal(a.anahtar, 'C:\\Users\\Ayşe Yılmaz\\.ssh\\id_ed25519');
  assert.deepEqual(a.uzak, { veri: '/var/lib/mola-merkez/veri', calisma: '/var/lib/mola-merkez/calisma', yedek: '/var/lib/mola-merkez/merkez-yedek' });
  assert.deepEqual(sertifikaAdlari(a), ['molayazilim.com.tr', 'www.molayazilim.com.tr', 'merkez.molayazilim.com.tr', 'menu.molayazilim.com.tr']);
  assert.equal(ikinciKlasor(ornek({ ikinciHedef: "G:\\Drive'ım\\Mola-Merkez-Yedek" })), "G:\\Drive'ım\\Mola-Merkez-Yedek\\Mola-Merkez-VDS");
  const kotuler: [Partial<VdsAyar> & Record<string, unknown>, RegExp][] = [
    [{ hedef: 'vds' }, /tam yol/], [{ hedef: 'C:\\' }, /kökü/], [{ hedef: 'C:\\a"b' }, /tırnak/], [{ hedef: '\\\\?\\x\ny' }, /tırnak ya da satır/],
    [{ ikinciHedef: 'C:\\Users\\a\\Masaüstü\\kafe uygulama\\vds\\drive' }, /ayrı olmalı/], [{ ikinciHedef: 'C:\\Users\\a' }, /ayrı olmalı/],
    [{ yedekSayisi: 0 }, /1 ile 60/], [{ yedekSayisi: 61 }, /1 ile 60/], [{ yedekSayisi: 2.5 }, /1 ile 60/],
    [{ port: 0 }, /65535/], [{ port: 70000 }, /65535/], [{ merkezPort: '4000; id' as unknown as number }, /65535/],
    [{ alanAdi: 'molayazilim.com.tr; reboot' }, /Alan adı/], [{ alanAdi: 'localhost' }, /Alan adı/], [{ alanAdi: '-x.com' }, /Alan adı/],
    [{ parmakIzi: 'MD5:aa' }, /SHA256/], [{ uzak: { veri: '/var/lib/x', calisma: '/var/lib/../etc', yedek: '/x' } }, /calisma/], [{ uzak: { veri: '/var/lib/a b', calisma: '/x', yedek: '/y' } }, /veri/],
    [{ anahtar: '.ssh\\id' }, /tam yol/], [{ sunucu: 'root@h.com;id' }, /geçersiz/],
  ];
  for (const [o, m] of kotuler) assert.throws(() => ornek(o), (e: Error) => e instanceof AyarHatasi && m.test(e.message), JSON.stringify(o));
  assert.throws(() => ayarDenetle({ ...ornek(), bicim: 2 }), /biçimi/);
  assert.equal(hedefBulutta({ hedef: 'C:\\Users\\a\\OneDrive\\Masaüstü\\vds' }, {}), true);
  assert.equal(hedefBulutta({ hedef: 'C:\\MolaCalisma\\vds' }, {}), false);
});

test('--kur: defaults from the Linux package, flags over the old file, a new host forgets the confirmed fingerprint; file round trip', t => {
  const kok = gecici('ayar'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  const ilk = kurulumAyari(null, { host: 'yonetici@203.0.113.10' });
  assert.equal(ilk.hedef, 'C:\\MolaCalisma\\vds'); assert.equal(ilk.port, 22); assert.equal(ilk.yedekSayisi, 14); assert.equal(ilk.parmakIzi, null); assert.equal(ilk.anahtar, null); assert.equal(ilk.ikinciHedef, null);
  assert.throws(() => kurulumAyari(null, {}), /--host/);
  const onayli = { ...ilk, parmakIzi: IZ };
  assert.equal(kurulumAyari(onayli, { ikinci: "G:\\Drive'ım", yedekSayisi: '7' }).parmakIzi, IZ, 'same server: kept');
  assert.equal(kurulumAyari(onayli, { ikinci: "G:\\Drive'ım" }).ikinciHedef, "G:\\Drive'ım");
  assert.equal(kurulumAyari(onayli, { port: '2222' }).parmakIzi, null, 'another port: confirm again');
  assert.equal(kurulumAyari(onayli, { host: 'yonetici@203.0.113.11' }).parmakIzi, null, 'another server: confirm again');
  assert.equal(kurulumAyari({ ...onayli, ikinciHedef: 'D:\\x' }, { ikinci: null }).ikinciHedef, null);
  const dosya = join(kok, '.local', 'vds.json');
  ayarYaz(ornek(), dosya);
  assert.deepEqual(ayarOku(dosya), ornek());
  writeFileSync(dosya, JSON.stringify({ ...ornek(), sunucu: 'yonetici@x.com && calc' }));
  assert.throws(() => ayarOku(dosya), AyarHatasi, 'a hand-edited file is checked again');
  writeFileSync(dosya, '{bozuk');
  assert.throws(() => ayarOku(dosya), /bozuk/);
  assert.equal(ayarOku(join(kok, 'yok.json')), null);
});

test('ssh: an argument list (no shell), BatchMode, strict host key once confirmed, accept-new only for the first probe', () => {
  const a = ornek();
  const args = sshArgumanlari(a, `${OKU} liste`);
  const o = (k: string) => args.some((x, i) => args[i - 1] === '-o' && x === k);
  assert.ok(o('BatchMode=yes') && o('StrictHostKeyChecking=yes') && o('IdentitiesOnly=yes') && o('ForwardAgent=no') && o('RequestTTY=no'));
  assert.equal(args[args.indexOf('-i') + 1], 'C:\\Users\\Ayşe Yılmaz\\.ssh\\id_ed25519', 'the key path is one argument, spaces and all');
  assert.deepEqual(args.slice(-3), ['--', 'yonetici@203.0.113.10', 'sudo -n -u mola /usr/local/sbin/mola-oku liste']);
  assert.ok(sshArgumanlari({ ...a, parmakIzi: null }, 'x', true).includes('StrictHostKeyChecking=accept-new'));
  assert.throws(() => sshArgumanlari({ ...a, parmakIzi: null }, 'x'), /parmak izi/);
  assert.throws(() => sshArgumanlari(a, 'echo a\nreboot'), /satır sonu/);
  assert.throws(() => sshArgumanlari({ ...a, sunucu: '-oProxyCommand=calc@x' }, 'x'), AyarHatasi);
  assert.equal(sshArgumanlari({ ...a, anahtar: null, port: 2222 }, 'x').includes('-i'), false);
  assert.equal(komutSatiri('C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe', ['-o', 'BatchMode=yes', '-i', 'C:\\Users\\Ayşe Yılmaz\\id', '--', 'y@h', "echo '##mola:x'; uptime"]),
    `C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe -o BatchMode=yes -i "C:\\Users\\Ayşe Yılmaz\\id" -- y@h "echo '##mola:x'; uptime"`);
});

test('host key: fingerprints are read from known_hosts with ssh-keygen -F ([host]:port for another port), nothing written', async () => {
  const cagrilar: string[][] = [];
  const sahte: Calistirici = (program, args) => { cagrilar.push([program, ...args]); return hazirIslem(`# Host [203.0.113.10]:2222 found: line 3\n[203.0.113.10]:2222 ED25519 ${IZ}\n`); };
  assert.deepEqual(await bilinenParmakIzleri(ornek({ port: 2222 }), sahte, 'C:\\k\\known_hosts'), [IZ]);
  assert.match(cagrilar[0][0], /ssh-keygen/);
  assert.deepEqual(cagrilar[0].slice(1), ['-l', '-F', '[203.0.113.10]:2222', '-f', 'C:\\k\\known_hosts']);
});

test('allow-list: only the nine commands, only their own checked options; unknown commands and injection attempts refused', () => {
  assert.deepEqual(Object.keys(KOMUTLAR).sort(), ['caddy', 'disk', 'durum', 'guvenlik', 'hatalar', 'kayitlar', 'ozet', 'sertifika', 'yedek']);
  assert.deepEqual(komutCoz(['kayitlar', '--son', '200', '--hata']), { ad: 'kayitlar', kuru: false, son: 200, hata: true });
  assert.deepEqual(komutCoz(['caddy', '--son=2000', '--kuru']), { ad: 'caddy', kuru: true, son: 2000 });
  const reddet: string[][] = [[], ['reboot'], ['DURUM'], ['durum;reboot'], ['durum', ';', 'reboot'], ['durum', '--son', '5'], ['caddy', '--hata'], ['kayitlar', '--son'], ['kayitlar', '--son', '0'], ['kayitlar', '--son', '2001'],
    ['kayitlar', '--son', '20;reboot'], ['kayitlar', '--son', '$(reboot)'], ['kayitlar', '--son', '1e3'], ['kayitlar', '--son', '0x10'], ['kayitlar', '--son=10 -p emerg'], ['kayitlar', '--son', '10', 'extra'], ['kayitlar', '-n', '5'], ['ozet', '--', 'id'],
    ['__proto__'], ['constructor'], ['toString'], ['hatalar', '--yol', '/etc/shadow'], ['yedek', '--kuru', '--evet']];
  for (const argv of reddet) assert.throws(() => komutCoz(argv), KomutHatasi, JSON.stringify(argv));
  const a = ornek();
  assert.equal(uzakKomut(komutCoz(['kayitlar', '--son', '200', '--hata']), a), 'journalctl -u mola-merkez -n 200 --no-pager -o short-iso -p err');
  assert.equal(uzakKomut(komutCoz(['kayitlar']), a), 'journalctl -u mola-merkez -n 100 --no-pager -o short-iso');
  assert.equal(uzakKomut(komutCoz(['caddy']), a), 'journalctl -u caddy -n 50 --no-pager -o short-iso');
  assert.equal(uzakKomut(komutCoz(['durum']), a), "echo '##mola:aktif'; systemctl is-active mola-merkez caddy; echo '##mola:uptime'; uptime; echo '##mola:saglik'; curl -fsS --max-time 5 http://127.0.0.1:4000/api/merkez/v1/health; echo");
  assert.equal(uzakKomut(komutCoz(['hatalar']), a), 'sudo -n -u mola /usr/local/sbin/mola-oku hatalar');
  assert.match(uzakKomut(komutCoz(['sertifika']), a), /-servername menu\.molayazilim\.com\.tr </);
  // Every command of every name: no characters that could start another command in PowerShell or open a quote.
  for (const ad of Object.keys(KOMUTLAR) as KomutAdi[]) {
    const k = uzakKomut({ ad, kuru: false, son: 2000, hata: true }, a);
    assert.doesNotMatch(k, /["$`\r\n\\]|&&|\|\||>[^/]/, `${ad}: ${k}`);
    for (const m of k.matchAll(/sudo -n (-u mola )?([^;|]+?)(?=;|\||$)/g)) assert.ok(m[1] ? m[2].startsWith(`${OKU_YARDIMCI} `) : (SUDO_KOK_KOMUTLARI as readonly string[]).includes(m[2].trim()), `${ad}: sudo ${m[2]}`);
    assert.doesNotMatch(k, /\b(rm|mv|cp|tee|chmod|chown|kill|reboot|shutdown|systemctl (start|stop|restart|reload|enable|disable)|apt (install|upgrade|remove)|ufw (allow|deny|enable|disable|delete)|dd|truncate)\b/, `${ad} must only read`);
  }
  // A changed .local/vds.json cannot slip a fragment into a command.
  assert.throws(() => uzakKomut(komutCoz(['sertifika']), { merkezPort: 4000, alanAdi: 'x.com; reboot' }), KomutHatasi);
  assert.throws(() => uzakKomut(komutCoz(['durum']), { merkezPort: 0, alanAdi: 'x.com' }), KomutHatasi);
  assert.throws(() => uzakKomut({ ad: 'kayitlar', son: 5000, kuru: false }, a), KomutHatasi);
  assert.match(okuHatasi('sudo: a password is required'), /sudoers\.d\/mola-okuma/);
  assert.match(okuHatasi('sudo: /usr/local/sbin/mola-oku: command not found'), /kur\.sh/);
});

test('the sudo rule and the helper agree with the tools: exactly the commands used, nothing more; the package carries both', () => {
  const sudoers = readFileSync(join(ROOT, 'scripts', 'linux', 'mola-okuma.sudoers.ornek'), 'utf8');
  const kurallar = sudoers.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  assert.equal(kurallar.length, 2);
  const izinli = (satir: string) => satir.split('NOPASSWD:')[1].split(',').map(s => s.trim());
  assert.match(kurallar[0], /^yonetici ALL=\(mola\) NOPASSWD: /); assert.match(kurallar[1], /^yonetici ALL=\(root\) NOPASSWD: /);
  const yardimci = readFileSync(join(ROOT, 'scripts', 'linux', 'mola-oku'), 'utf8');
  const altKomutlar = [...yardimci.matchAll(/^ {2}([a-z]+)\)$/gm)].map(m => m[1]);
  assert.deepEqual(altKomutlar, ['surum', 'liste', 'ozet', 'paket', 'yedekler', 'hatalar', 'boyut']);
  assert.deepEqual(izinli(kurallar[0]), altKomutlar.map(a => `${OKU_YARDIMCI} ${a}`), 'each helper command, with its exact argument');
  assert.deepEqual(izinli(kurallar[1]), [...SUDO_KOK_KOMUTLARI]);
  // What the tools send through sudo is in the rule.
  const kullanilan = new Set<string>();
  for (const ad of Object.keys(KOMUTLAR) as KomutAdi[]) for (const m of uzakKomut({ ad, kuru: false }, ornek()).matchAll(/sudo -n (?:-u mola )?([^;|]+?)(?=;|\||$)/g)) kullanilan.add(m[1].trim());
  for (const k of ['liste', 'ozet', 'paket', 'surum']) kullanilan.add(`${OKU_YARDIMCI} ${k}`);
  for (const k of kullanilan) assert.ok([...izinli(kurallar[0]), ...izinli(kurallar[1])].includes(k), k);
  assert.doesNotMatch(yardimci, /\b(rm|mv|cp|tee|chmod|chown|truncate|dd)\s/, 'the helper never writes');
  assert.ok(yardimci.startsWith('#!/bin/bash\n'));
  const paket = readFileSync(join(ROOT, 'scripts', 'merkez-linux-paket.mjs'), 'utf8');
  assert.equal(paket.match(/MERKEZ_CALISMA_KLASORU=\/var\/lib\/mola-merkez\/calisma/g)?.length, 2, 'the unit and ayarlar.env.ornek');
  assert.match(paket, /install -d -o mola -g mola -m 700 \/var\/lib\/mola-merkez\/calisma/);
  assert.match(paket, /install -o root -g root -m 755 "\$HERE\/mola-oku" \/usr\/local\/sbin\/mola-oku/);
  assert.match(paket, /scripts\/linux\/mola-okuma\.sudoers\.ornek/);
});

test('the work folder on Linux: a Windows folder chosen before the move is not used; the server default (/var/lib/…/calisma) is', () => {
  const kaydi = (workFolder: { path: string | null; updatedAt: string } | undefined) => new WorkFolder({ store: { read: () => ({ workFolder }) } as never, now: () => new Date(), version: 't', fallback: '/var/lib/mola-merkez/calisma' });
  assert.equal(kaydi(undefined).path(), '/var/lib/mola-merkez/calisma');
  assert.equal(kaydi({ path: 'MolaCalisma', updatedAt: '' }).path(), '/var/lib/mola-merkez/calisma', 'not a full path here: the default');
  assert.equal(kaydi({ path: 'MolaCalisma', updatedAt: '' }).status().isDefault, true);
  assert.equal(kaydi({ path: null, updatedAt: '' }).path(), null, 'turned off stays off');
  const tam = resolve(gecici('wf'));
  try { assert.equal(kaydi({ path: tam, updatedAt: '' }).path(), tam); } finally { rmSync(tam, { recursive: true, force: true }); }
});

test('tar reader: names with Turkish letters, spaces and length > 100 bytes; one byte at a time; cut and damaged streams', async () => {
  const girdiler = [
    { ad: 'var/lib/mola-merkez/calisma/README.md', veri: Buffer.from('# Mola\n') },
    { ad: 'var/lib/mola-merkez/calisma/destek-talepleri/çay-ocağı-1a2b3c4d/ekler/1a2b3c4d-fiş fotoğrafı ŞĞÜİÖÇ.jpg', veri: Buffer.alloc(1300, 7) },
    { ad: `var/lib/mola-merkez/calisma/${'uzun-'.repeat(30)}son.md`, veri: Buffer.alloc(0) },
    { ad: 'var/lib/mola-merkez/merkez-yedek/x/0.bin', veri: Buffer.alloc(512, 1) },
  ];
  const tar = tarYaz(girdiler);
  const oku = async (akis: AsyncIterable<Buffer>) => {
    const alinan: { ad: string; veri: Buffer }[] = [], iptal: string[] = [];
    const r = await tarOku(akis, async g => { const p: Buffer[] = []; return { yaz: b => { p.push(Buffer.from(b)); }, bitir: async () => { alinan.push({ ad: g.ad, veri: Buffer.concat(p) }); }, iptal: async () => { iptal.push(g.ad); } }; });
    return { ...r, alinan, iptal };
  };
  const butun = await oku(Readable.from([tar]));
  assert.equal(butun.temiz, true); assert.deepEqual(butun.alinan, girdiler);
  const baytBayt = await oku(Readable.from((function* () { for (let i = 0; i < tar.length; i += 1) yield tar.subarray(i, i + 1); })()));
  assert.deepEqual(baytBayt.alinan, girdiler);
  const kesik = await oku(Readable.from([tar.subarray(0, 512 * 6 + 100)]));
  assert.equal(kesik.temiz, false); assert.equal(kesik.alinan.length, 1); assert.equal(kesik.iptal.length, 1, 'the half file is cancelled');
  const bozuk = Buffer.from(tar); bozuk[1024 + 20] ^= 0xff; // the second header
  await assert.rejects(oku(Readable.from([bozuk])), TarHatasi);
});

test('tar reader against GNU tar (the server\'s; here the one of Git for Windows): pax format, Turkish and long names', async t => {
  const kok = gecici('tar'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  const adlar = ['README.md', 'destek-talepleri/çay ocağı/2026-10-12-yazıcı çalışmıyor-9f8e7d6c.md', `${'uzun-ad-'.repeat(20)}.md`];
  for (const [i, ad] of adlar.entries()) yaz(kok, ad, `içerik ${i} ğüşıöç\n`.repeat(i * 100 + 1));
  // (Windows' own tar.exe takes its arguments in the ANSI code page: Turkish names do not reach it, so it is not used.)
  const programlar: [string, string[]][] = [['C:\\Program Files\\Git\\usr\\bin\\tar.exe', ['--format=pax', '-cf', '-', '-C', kok.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`), ...adlar]]];
  let denenen = 0;
  for (const [program, args] of programlar) {
    if (process.platform !== 'win32' || !existsSync(program)) continue;
    const r = spawnSync(program, args, { maxBuffer: 1 << 26, env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    if (r.status !== 0) { t.diagnostic(`${program}: ${r.stderr}`); continue; }
    const alinan = new Map<string, string>();
    await tarOku(Readable.from([r.stdout]), async g => { const p: Buffer[] = []; return { yaz: b => { p.push(Buffer.from(b)); }, bitir: async () => { alinan.set(g.ad, Buffer.concat(p).toString('utf8')); }, iptal: async () => {} }; });
    for (const ad of adlar) assert.equal(alinan.get(ad), readFileSync(join(kok, ...ad.split('/')), 'utf8'), `${program}: ${ad}`);
    denenen++;
  }
  if (!denenen) t.skip('no tar program here');
});

test('the helper\'s answers: listing (tabs in names, bad lines counted), hashes; KaynakSsh sends exactly the fixed commands', async () => {
  const z = '0'.repeat(64);
  const liste = listeCoz(Buffer.from(`MOLA-LISTE\t1\t/var/lib/mola-merkez/calisma\t-\0calisma\t5\t1760000000\t${z}\tdestek-talepleri/a\tb.md\0calisma\tx\t1\t-\tbozuk\0yedek\t9\t1\t-\tmerkez-yedek-durum.json\0`));
  assert.equal(liste.calismaKok, '/var/lib/mola-merkez/calisma'); assert.equal(liste.yedekKok, null); assert.equal(liste.bozuk, 1);
  assert.deepEqual(liste.dosyalar[0], { kok: 'calisma', yol: 'destek-talepleri/a\tb.md', boyut: 5, zaman: 1760000000, ozet: z });
  assert.throws(() => listeCoz(Buffer.from('sudo: a password is required\n')), /tanınmayan/);
  assert.deepEqual([...ozetlerCoz(Buffer.from(`${z}\tyedek/a/0.bin\0kötü\0`))], [['yedek/a/0.bin', z]]);
  const gonderilen: { komut: string; girdi: string }[] = [];
  const sahte: Calistirici = (_p, args, girdi) => { gonderilen.push({ komut: args.at(-1)!, girdi: girdi?.toString('utf8') ?? '' }); return hazirIslem(args.at(-1)!.endsWith('liste') ? 'MOLA-LISTE\t1\t-\t-\0' : ''); };
  const k = new KaynakSsh(new Ssh(ornek(), sahte, 'ssh'));
  await k.liste(); await k.ozetler(['yedek/a/0.bin', 'calisma/ç ğ.md']); k.paket(['calisma/README.md']);
  assert.deepEqual(gonderilen, [
    { komut: 'sudo -n -u mola /usr/local/sbin/mola-oku liste', girdi: '' },
    { komut: 'sudo -n -u mola /usr/local/sbin/mola-oku ozet', girdi: 'yedek/a/0.bin\0calisma/ç ğ.md\0' },
    { komut: 'sudo -n -u mola /usr/local/sbin/mola-oku paket', girdi: 'calisma/README.md\0' },
  ], 'names travel on standard input, never on the command line');
  const reddeden: Calistirici = () => hazirIslem('', 1, 'sudo: a password is required\n');
  await assert.rejects(new KaynakSsh(new Ssh(ornek(), reddeden, 'ssh')).liste(), /mola-okuma/);
  const kopuk: Calistirici = () => hazirIslem('', 255, 'ssh: connect to host 203.0.113.10 port 22: Connection timed out\n');
  await assert.rejects(new KaynakSsh(new Ssh(ornek(), kopuk, 'ssh')).liste(), /ulaşılamadı/);
  const degisti: Calistirici = () => hazirIslem('', 255, '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.\n');
  await assert.rejects(new KaynakSsh(new Ssh(ornek(), degisti, 'ssh')).liste(), /BAĞLANMAYIN/);
});

test('reading the answers: sections, certificate dates, one plain Turkish summary (all well / with problems)', () => {
  assert.equal(sertifikaBitisi('notAfter=Jan  9 12:00:00 2027 GMT')?.toISOString(), '2027-01-09T12:00:00.000Z');
  assert.equal(sertifikaBitisi('okunamadı'), null);
  const simdi = new Date('2026-10-12T05:00:00.000Z');
  const sertifika = (tarih: string) => sertifikaAdlari({ alanAdi: 'molayazilim.com.tr' }).map(a => `##mola:sertifika ${a}\nnotAfter=${tarih}`).join('\n');
  const iyi = [
    '##mola:aktif', 'active', 'active', '##mola:uptime', ' 08:00:01 up 12 days,  3:04,  1 user,  load average: 0.05, 0.01, 0.00',
    '##mola:saglik', '{"ok":true,"role":"merkez","version":"0.1.0","mode":"installed"}',
    '##mola:df', 'Filesystem      Size  Used Avail Use% Mounted on', '/dev/vda1        40G  9.1G   29G  24% /', '/dev/vda1        40G  9.1G   29G  24% /',
    '##mola:boyut', '31457280\t/var/lib/mola-merkez/veri/', '89128960\t/var/lib/mola-merkez/merkez-yedek/',
    '##mola:yedekler', `${yedekAdi(11)}\t6291456\t1\t1`, `${yedekAdi(12)}\t6291456\t1\t1`,
    '##mola:yedek-durum', JSON.stringify({ lastSuccessAt: '2026-10-12T00:45:00.000Z', nextRunAt: '2026-10-13T00:45:00.000Z' }),
    sertifika('Jan  9 12:00:00 2027 GMT'),
  ].join('\n');
  assert.deepEqual([...bolumler(iyi).keys()].slice(0, 3), ['aktif', 'uptime', 'saglik']);
  const metin = ozetMetni(iyi, { alanAdi: 'molayazilim.com.tr' }, simdi);
  assert.match(metin, /Mola Merkez: çalışıyor · Caddy: çalışıyor · sağlık: tamam \(Merkez 0\.1\.0\)/);
  assert.match(metin, /Disk \/: %24 dolu \(29G boş \/ 40G\)/);
  assert.match(metin, /Merkez yedeği: son 12 Ekim 03:45 · sunucuda 2 yedek \(12 MB\)/);
  assert.match(metin, /Sertifikalar: 4\/4 ad okundu; en erken .* 9 Ocak 2027 \(89 gün\)/);
  assert.match(metin, /Sonuç: her şey yolunda\./);
  const kotu = iyi.replace('active\nactive', 'failed\nactive').replace('24% /', '91% /').replace('"lastSuccessAt":"2026-10-12T00:45:00.000Z"', '"lastSuccessAt":"2026-10-09T00:45:00.000Z","lastError":"yedek oluşturma başarısız: disk dolu"').replace(sertifika('Jan  9 12:00:00 2027 GMT'), sertifika('Oct 20 12:00:00 2026 GMT').replace(/notAfter=.*\n?(?=##mola:sertifika menu)/, ''));
  const dikkat = ozetMetni(kotu, { alanAdi: 'molayazilim.com.tr' }, simdi);
  assert.match(dikkat, /Dikkat \(\d+\):/);
  for (const r of [/Mola Merkez çalışmıyor \(failed\)/, /Disk \/ %91 dolu/, /Son Merkez yedeği eski/, /Son yedek hatası: yedek oluşturma başarısız: disk dolu/, /8 gün içinde bitiyor/]) assert.match(dikkat, r);
});

/** The CLI in a scratch folder (its own .local): never the project's .local/vds.json. */
function cli(betik: string, args: string[], cwd: string) {
  return new Promise<{ kod: number | null; cikti: string; hata: string }>(done => {
    const c = spawn(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', betik), ...args], { cwd, env: { ...process.env, MOLA_BACKUP_DISCOVERY: '0' } });
    let cikti = '', hata = '';
    c.stdout.on('data', d => { cikti += d; }); c.stderr.on('data', d => { hata += d; });
    c.on('close', kod => done({ kod, cikti, hata }));
  });
}

test('npm run vds -- … --kuru prints the exact ssh command and runs nothing; refused commands exit 2; every run is logged (no output)', async t => {
  const kok = gecici('cli'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  ayarYaz(ornek({ hedef: join(kok, 'vds') }), join(kok, '.local', 'vds.json'));
  const kuru = await cli('vds.ts', ['kayitlar', '--son', '200', '--hata', '--kuru'], kok);
  assert.equal(kuru.kod, 0, kuru.hata);
  assert.match(kuru.cikti.trim(), /^(& "[^"]+ssh\.exe"|\S*ssh(\.exe)?) -o BatchMode=yes -o StrictHostKeyChecking=yes .* -i "C:\\Users\\Ayşe Yılmaz\\\.ssh\\id_ed25519" -o IdentitiesOnly=yes -p 22 -- yonetici@203\.0\.113\.10 "journalctl -u mola-merkez -n 200 --no-pager -o short-iso -p err"$/);
  const red = await cli('vds.ts', ['kayitlar', '--son', '10;reboot'], kok);
  assert.equal(red.kod, 2); assert.match(red.hata, /--son 1 ile 2000/);
  const bilinmeyen = await cli('vds.ts', ['sil'], kok);
  assert.equal(bilinmeyen.kod, 2); assert.match(bilinmeyen.hata, /Bilinmeyen komut: "sil"/);
  const log = readFileSync(join(kok, '.local', 'kayitlar', 'vds.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 3);
  assert.match(log[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z\tkayitlar --son 200 --hata --kuru\tyalnız yazıldı$/);
  assert.match(log[1], /\tREDDEDİLDİ\t/); assert.match(log[2], /\tREDDEDİLDİ\tsil$/);
  assert.doesNotMatch(log.join('\n'), /journalctl/, 'the command name, not what was sent or received');
});

test('npm run vds:cek -- --zamanla / --zamanlamayi-kaldir print the Görev Zamanlayıcı commands and create nothing', async t => {
  const proje = 'C:\\Users\\Ayşe\\OneDrive\\Masaüstü\\kafe uygulama';
  assert.equal(zamanlaKomutu(proje), `schtasks --% /Create /TN "Mola\\VDS yedek cek" /TR "\\"C:\\Users\\Ayşe\\OneDrive\\Masaüstü\\kafe uygulama\\scripts\\vds-cek.cmd\\"" /SC DAILY /ST 07:00 /IT /F`);
  assert.doesNotMatch(zamanlaKomutu(proje), /\/RU|\/RP/, 'no account or password: only while the owner is logged on');
  assert.throws(() => zamanlaKomutu(proje, '7'), /SS:DD/);
  assert.throws(() => zamanlaKomutu(`C:\\${'x'.repeat(260)}`), /çok uzun/);
  assert.equal(zamanlamayiKaldirKomutu(), `schtasks /Delete /TN "${GOREV_ADI}" /F`);
  const kok = gecici('zamanla'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  const r = await cli('vds-cek.ts', ['--zamanla'], kok);
  assert.equal(r.kod, 0, r.hata);
  assert.ok(r.cikti.includes(zamanlaKomutu(ROOT)), r.cikti);
  assert.match(r.cikti, /bu araç eklemez/);
  const k = await cli('vds-cek.ts', ['--zamanlamayi-kaldir'], kok);
  assert.ok(k.cikti.includes(zamanlamayiKaldirKomutu()));
  assert.equal(existsSync(join(kok, '.local')), false, 'nothing written, nothing scheduled');
  assert.ok(existsSync(join(ROOT, 'scripts', 'vds-cek.cmd')));
  const yok = await cli('vds-cek.ts', [], kok);
  assert.equal(yok.kod, 2); assert.match(yok.hata, /--kur --host/);
  const kotu = await cli('vds-cek.ts', ['--kur', '--host', 'yonetici@h.com;calc'], kok);
  assert.equal(kotu.kod, 1); assert.match(kotu.hata, /Sunucu adresi geçersiz/);
});

test('log lines and the one-run lock', t => {
  const kok = gecici('kilit'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  gunlugeYaz('x.log', 'satır\nikinci\tsekme', kok, new Date('2026-10-12T04:00:00.000Z'));
  assert.equal(readFileSync(join(kok, 'x.log'), 'utf8'), '2026-10-12T04:00:00.000Z\tsatır ikinci\tsekme\n');
  const birak = kilitAl(kok); assert.ok(birak);
  assert.equal(kilitAl(kok), null, 'a second run waits for nothing: it is skipped');
  birak!(); assert.ok(kilitAl(kok));
});

// ---------- The real helper (scripts/linux/mola-oku) with Git for Windows' bash, when it is here ----------
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const msys = (p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
function yardimciKur(kok: string, ayar: string) {
  const metin = readFileSync(join(ROOT, 'scripts', 'linux', 'mola-oku'), 'utf8').replace(/\r\n/g, '\n')
    .replace('AYAR=/etc/mola-merkez/ayarlar.env', `AYAR='${msys(join(kok, 'ayarlar.env'))}'`).replace('KOK=/var/lib/mola-merkez', `KOK='${msys(join(kok, 'mola-merkez'))}'`);
  writeFileSync(join(kok, 'mola-oku'), metin); writeFileSync(join(kok, 'ayarlar.env'), ayar);
  return (alt: string, girdi?: Buffer): Islem => {
    const c = spawn(BASH, [msys(join(kok, 'mola-oku')), ...alt.split(' ')], { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    let hata = ''; c.stderr.on('data', d => { hata += d; });
    c.stdin.end(girdi ?? Buffer.alloc(0));
    return { cikti: c.stdout, bitti: new Promise(done => c.on('close', kod => done({ kod: kod ?? -1, hata }))) };
  };
}

test('the real read-only helper (Git bash): listing, hashes, tar stream into vds:cek; refuses paths outside and the data folder', { skip: process.platform !== 'win32' || !existsSync(BASH) ? 'Git for Windows bash yok' : false }, async t => {
  const kok = gecici('yardimci'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  const merkez = join(kok, 'mola-merkez'), calisma = join(merkez, 'calisma'), yedek = join(merkez, 'merkez-yedek'), veri = join(merkez, 'veri');
  calismaYaz(calisma); yaz(calisma, 'guncellemeler/BENIOKU.txt', 'x');
  yedekYaz(yedek, yedekAdi(11), '2026-10-11T00:30:00.000Z'); yedekYaz(yedek, yedekAdi(12), '2026-10-12T00:30:00.000Z', { buyuk: true });
  yaz(yedek, 'merkez-yedek-durum.json', JSON.stringify({ lastSuccessAt: '2026-10-12T00:30:00.000Z' }));
  yaz(veri, 'development.key', 'GİZLİ ANAHTAR'); yaz(veri, 'merkez.sqlite', 'veritabanı');
  const calistir = yardimciKur(kok, `MERKEZ_DATA_DIR=${msys(veri)}\nMERKEZ_BACKUP_DIR=${msys(yedek)}\nMERKEZ_CALISMA_KLASORU=${msys(calisma)}\n`);
  // ssh replaced by the helper: the tool's own fixed command decides which part runs.
  const sahteSsh: Calistirici = (_p, args, girdi) => { const k = args.at(-1)!; assert.ok(k.startsWith(`${OKU} `), k); return calistir(k.slice(OKU.length + 1), girdi); };
  const yaziyla = async (alt: string, girdi?: Buffer) => { const p: Buffer[] = []; const i = calistir(alt, girdi); for await (const b of i.cikti) p.push(b as Buffer); return { ...(await i.bitti), cikti: Buffer.concat(p) }; };

  const surum = await yaziyla('surum');
  assert.match(surum.cikti.toString('utf8'), /^MOLA-OKU\t1\n/);
  const liste = listeCoz((await yaziyla('liste')).cikti);
  assert.equal(liste.bozuk, 0);
  assert.deepEqual(liste.dosyalar.filter(d => d.kok === 'calisma').map(d => d.yol).sort(), agac(calisma));
  assert.ok(!liste.dosyalar.some(d => /development\.key|merkez\.sqlite/.test(d.yol)), 'never the data folder');
  const readme = liste.dosyalar.find(d => d.yol === 'README.md')!;
  assert.equal(readme.ozet, sha(readFileSync(join(calisma, 'README.md'))));
  assert.equal(liste.dosyalar.find(d => d.yol === `${yedekAdi(12)}/0.bin`)!.ozet, null, 'over 1 MB: hashed only when fetched');

  // Names outside the two folders, "..", the data folder: no hash, no tar entry.
  const kotu = ['calisma/../veri/development.key', 'yedek/../veri/merkez.sqlite', 'veri/development.key', '/etc/passwd', 'calisma/', 'calisma//README.md', 'calisma/./README.md', 'calisma/yok.md'];
  assert.equal((await yaziyla('ozet', Buffer.from(kotu.map(k => `${k}\0`).join('')))).cikti.length, 0);
  const tarKotu = await yaziyla('paket', Buffer.from(kotu.map(k => `${k}\0`).join('')));
  assert.equal(tarKotu.cikti.includes(Buffer.from('GİZLİ ANAHTAR')), false);
  assert.equal((await yaziyla('liste extra')).kod, 2, 'one argument only');
  assert.equal((await yaziyla('sil')).kod, 2);

  // The whole copy through the real helper, then the read-only commands' answers.
  const hedef = join(kok, 'Masaüstü', 'vds');
  const s = await cek(new KaynakSsh(new Ssh(ornek({ hedef }), sahteSsh, 'ssh')), { hedef, ikinci: null, yedekSayisi: 14, beklenen: { calisma: msys(calisma), yedek: msys(yedek) } });
  assert.deepEqual(s.hatalar, []); assert.deepEqual(s.atlanan, []); assert.deepEqual(s.uyarilar, []);
  assert.deepEqual(agac(join(hedef, 'calisma')), agac(calisma));
  for (const f of agac(yedek)) assert.equal(sha(readFileSync(join(hedef, 'merkez-yedek', ...f.split('/')))), sha(readFileSync(join(yedek, ...f.split('/')))), f);
  const yedekler = bolumler((await yaziyla('yedekler')).cikti.toString('utf8'));
  assert.deepEqual(yedekler.get('yedekler')!.split('\n').map(l => l.split('\t')[0]), [yedekAdi(11), yedekAdi(12)]);
  assert.equal(JSON.parse(yedekler.get('yedek-durum')!).lastSuccessAt, '2026-10-12T00:30:00.000Z');
  const hatalar = bolumler((await yaziyla('hatalar')).cikti.toString('utf8'));
  assert.match(hatalar.get('hatalar')!, /"groups"/); assert.match(hatalar.get('durum-ozeti')!, /Çay Ocağı/);
  assert.match(bolumler((await yaziyla('boyut')).cikti.toString('utf8')).get('boyut')!, /\d+\t.*merkez-yedek/);

  // A misconfigured work folder pointing at the data folder (or above it) is never read.
  for (const yanlis of [veri, merkez]) {
    const c2 = yardimciKur(kok, `MERKEZ_DATA_DIR=${msys(veri)}\nMERKEZ_CALISMA_KLASORU=${msys(yanlis)}\nMERKEZ_BACKUP_DIR=${msys(yedek)}\n`);
    const p: Buffer[] = []; const i = c2('liste'); for await (const b of i.cikti) p.push(b as Buffer); await i.bitti;
    const l = listeCoz(Buffer.concat(p));
    assert.equal(l.calismaKok, null, yanlis); assert.ok(!l.dosyalar.some(d => d.kok === 'calisma'));
  }
});

test('the real helper (Git bash): the cafés\' copies beside the data folder, never yukleme/ nor the data folder; into kafe-yedekleri\\', { skip: process.platform !== 'win32' || !existsSync(BASH) ? 'Git for Windows bash yok' : false }, async t => {
  const kok = gecici('yardimci kafe'); t.after(() => rmSync(kok, { recursive: true, force: true }));
  const merkez = join(kok, 'mola-merkez'), veri = join(merkez, 'veri'), kafe = join(merkez, 'veri-sunucu-yedekleri'), u = kurulumAdi(1);
  yaz(veri, 'development.key', 'GİZLİ ANAHTAR');
  const parcalar = kafeYaz(kafe, u, { buyuk: true });
  const calistir = yardimciKur(kok, `MERKEZ_DATA_DIR=${msys(veri)}\n`);
  const yaziyla = async (alt: string, girdi?: Buffer) => { const p: Buffer[] = []; const i = calistir(alt, girdi); for await (const b of i.cikti) p.push(b as Buffer); return { ...(await i.bitti), cikti: Buffer.concat(p) }; };
  assert.match((await yaziyla('surum')).cikti.toString('utf8'), new RegExp(`\\nkafe\\t${msys(kafe).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n$`));
  const liste = listeCoz((await yaziyla('liste')).cikti);
  assert.equal(liste.kafeKok, msys(kafe)); assert.equal(liste.bozuk, 0);
  assert.deepEqual(liste.dosyalar.filter(d => d.kok === 'kafe').map(d => d.yol).sort(), agac(kafe).filter(f => !f.includes('/yukleme/')), 'everything but uploads in progress');
  assert.equal(liste.dosyalar.find(d => d.yol === `${u}/parcalar/${parcalar[0]}`)!.ozet, null, 'over 1 MB: the name is the hash');
  assert.equal(liste.dosyalar.find(d => d.yol === `${u}/parcalar/${parcalar[1]}`)!.ozet, parcalar[1]);
  // An upload in progress, the data folder, "..": no hash, no tar entry.
  const yukleme = agac(kafe).filter(f => f.includes('/yukleme/')).map(f => `kafe/${f}`);
  const kotu = [...yukleme, 'kafe/../veri/development.key', `kafe/${u}/../../veri/development.key`, 'kafe/', `kafe/${u}/parcalar/yok`];
  assert.equal(yukleme.length, 2);
  assert.equal((await yaziyla('ozet', Buffer.from(kotu.map(k => `${k}\0`).join('')))).cikti.length, 0);
  const tar = await yaziyla('paket', Buffer.from(kotu.map(k => `${k}\0`).join('')));
  assert.equal(tar.cikti.includes(Buffer.from('GİZLİ ANAHTAR')), false); assert.equal(tar.cikti.includes(Buffer.from('yarım yükleme')), false);
  assert.ok((await yaziyla('ozet', Buffer.from(`kafe/${u}/durum.json\0`))).cikti.toString('utf8').endsWith(`\tkafe/${u}/durum.json\0`));

  // The whole copy through the real helper.
  const sahteSsh: Calistirici = (_p, args, girdi) => calistir(args.at(-1)!.slice(OKU.length + 1), girdi);
  const hedef = join(kok, 'Masaüstü', 'vds');
  const s = await cek(new KaynakSsh(new Ssh(ornek({ hedef }), sahteSsh, 'ssh')), { hedef, ikinci: null, yedekSayisi: 14 });
  assert.deepEqual(s.hatalar, []); assert.deepEqual(s.atlanan, []);
  assert.ok(!s.uyarilar.some(x => /kafe yedek|okuma yardımcısı/.test(x)), s.uyarilar.join(' | '));
  assert.deepEqual(agac(join(hedef, 'kafe-yedekleri')), agac(kafe).filter(f => !f.includes('/yukleme/')));
  for (const h of parcalar) assert.equal(sha(readFileSync(join(hedef, 'kafe-yedekleri', u, 'parcalar', h))), h);

  // MERKEZ_CLOUD_BACKUP_DIR wins; pointing at (or above) the data folder it is never read.
  const baska = join(kok, 'baska-yer');
  kafeYaz(baska, kurulumAdi(2));
  for (const [ayar, beklenen] of [[msys(baska), msys(baska)], [msys(veri), null], [msys(merkez), null]] as const) {
    const c2 = yardimciKur(kok, `MERKEZ_DATA_DIR=${msys(veri)}\nMERKEZ_CLOUD_BACKUP_DIR=${ayar}\n`);
    const p: Buffer[] = []; const i = c2('liste'); for await (const b of i.cikti) p.push(b as Buffer); await i.bitti;
    const l = listeCoz(Buffer.concat(p));
    assert.equal(l.kafeKok, beklenen, ayar);
    assert.ok(!l.dosyalar.some(d => /development\.key/.test(d.yol)));
    if (beklenen) assert.ok(l.dosyalar.some(d => d.yol.startsWith(`${kurulumAdi(2)}/`)));
    else assert.ok(!l.dosyalar.some(d => d.kok === 'kafe'));
  }
});

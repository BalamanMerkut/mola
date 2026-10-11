#!/usr/bin/env node
// İşlem kayıtları: independent check, without Mola (plain Node.js, no packages). Usage:
//   node scripts/islem-dogrula.mjs <islem-kayitlari-….jsonl>          a "Denetlenebilir kopya (JSONL)" from Mola Yönetim → Rapor al
//   node scripts/islem-dogrula.mjs <çalışma klasörü>\islem-kayitlari   the daily files of the Mola çalışma klasörü
//   --anahtar <merkez-public-key.txt | base64>                        check the seals with this key instead of the one in the file
// What is checked (docs/ISLEM_KAYITLARI.md): every line's hash = SHA-256 of its entry's canonical JSON; each entry's `prev` is
// the previous line's hash and the numbers run without a gap; the "geçmiş kayıtlar aktarıldı" block's own SHA-256; every seal
// is an Ed25519 signature of "mola-islem-muhur-1\n" + canonical JSON {at,count,head,keyId,seq,v} by Mola Merkez's key, and
// its head is the hash of that line. Exit code 0: "Kayıtlar bütün"; 1: broken (the first place is printed); 2: unreadable input.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Canonical JSON: keys sorted (UTF-16 order), no spaces, undefined left out. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(x => x === undefined ? 'null' : canonical(x)).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const fingerprint = hex => hex.replace(/(.{4})(?!$)/g, '$1-');
const keyId = b64 => createHash('sha256').update(Buffer.from(b64.trim(), 'base64')).digest('hex').slice(0, 16);

/** Reads an export file or a folder of daily files into { lines, seals, publicKey, startPrev }. */
export function load(path, keyOption) {
  const parse = text => text.split(/\r?\n/).filter(l => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`Satır ${i + 1} JSON değil.`); } });
  let lines = [], seals = [], publicKey, startPrev;
  if (statSync(path).isDirectory()) {
    const days = readdirSync(path).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
    for (const f of days) lines.push(...parse(readFileSync(join(path, f), 'utf8')).filter(x => x.type === 'kayit'));
    if (existsSync(join(path, 'muhurler.jsonl'))) seals = parse(readFileSync(join(path, 'muhurler.jsonl'), 'utf8')).filter(x => x.type === 'muhur');
    if (existsSync(join(path, 'merkez-acik-anahtar.txt'))) publicKey = readFileSync(join(path, 'merkez-acik-anahtar.txt'), 'utf8').trim();
    if (existsSync(join(path, 'baslangic.json'))) { const a = JSON.parse(readFileSync(join(path, 'baslangic.json'), 'utf8')); if (lines[0] && lines[0].entry.seq === a.seq + 1) startPrev = a.hash; }
  } else {
    const all = parse(readFileSync(path, 'utf8')), head = all.find(x => x.type === 'baslik');
    if (!head || head.format !== 'mola-islem-kayitlari-1') throw new Error('Bu dosya bir Mola işlem kayıtları kopyası değil (ilk satır "baslik" olmalı).');
    lines = all.filter(x => x.type === 'kayit'); seals = all.filter(x => x.type === 'muhur'); publicKey = head.publicKey; startPrev = head.startPrev ?? undefined;
    const end = all.find(x => x.type === 'son');
    if (!end) throw new Error('Dosyanın sonu eksik ("son" satırı yok): dosya yarım.');
    if (end.count !== lines.length) throw new Error(`Dosyada ${lines.length} kayıt var, olması gereken ${end.count}: kayıt silinmiş ya da eklenmiş.`);
  }
  if (keyOption) publicKey = existsSync(keyOption) ? readFileSync(keyOption, 'utf8').trim() : keyOption.trim();
  return { lines, seals, publicKey, startPrev };
}
/** The check itself; returns { ok, text, count, first, last, seals }. */
export function check({ lines, seals, publicKey, startPrev }) {
  const hashes = new Map(); let prev = startPrev ?? lines[0]?.entry?.prev, expected = lines[0]?.entry?.seq;
  const broken = (seq, text) => ({ ok: false, text: `Zincir ${seq}. kayıtta bozuk: ${text}`, seq, count: lines.length });
  if (!lines.length) return { ok: false, text: 'Dosyada kayıt yok.', count: 0 };
  // IP adresleri 1 yıl sonra silinir (8 Ekim): an older line rewritten without its address is accepted only as a chained
  // "journal.addresses_masked" line lists it (its chain hash and the hash of its content now); a newer line's address, while
  // kept, must match the chain's salted SHA-256 (addressMark).
  const listed = new Map(); let maskedElsewhere = 0;
  for (const { entry } of lines) for (const m of entry?.masks ?? []) listed.set(m.seq, m);
  for (const { hash, entry, adres, maskedHash } of lines) {
    if (!entry || typeof entry.seq !== 'number') return broken(expected, 'kayıt okunamıyor.');
    if (entry.seq !== expected) return broken(expected, 'kayıt eksik ya da sırası değişmiş.');
    if (entry.prev !== prev) return broken(entry.seq, 'bir önceki kayda bağlanmıyor (araya kayıt eklenmiş, silinmiş ya da sıra değişmiş).');
    const h = sha(canonical(entry));
    if (entry.masked) {
      const m = listed.get(entry.seq);
      if (m ? m.hash !== hash || m.masked !== h : maskedHash !== h) return broken(entry.seq, 'adresi silinmiş kaydın içeriği değiştirilmiş.');
      if (!m) maskedElsewhere++;
    } else if (h !== hash) return broken(entry.seq, 'içeriği değiştirilmiş (özet tutmuyor).');
    if (adres && (!entry.addressMark || sha(`mola-islem-adres-1\n${adres.salt}\n${adres.address}`) !== entry.addressMark)) return broken(entry.seq, 'adres bilgisi değiştirilmiş.');
    if (entry.legacy && sha(canonical(entry.legacy.entries)) !== entry.legacy.hash) return broken(entry.seq, 'aktarılan eski kayıtlar bloğu değiştirilmiş.');
    hashes.set(entry.seq, hash); prev = hash; expected++;
  }
  let key; try { key = publicKey ? createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }) : undefined; } catch { return { ok: false, text: 'Mola Merkez açık anahtarı okunamadı.', count: lines.length }; }
  let checked = 0;
  const first = lines[0].entry.seq, last = lines.at(-1).entry.seq;
  for (const s of seals) {
    if (s.seq < first) continue;
    if (s.seq > last) return broken(s.seq, `mühür ${s.seq}. kayda kadar olanları kapsıyor ama dosyada son kayıt ${last}: son kayıtlar silinmiş.`);
    if (!key) return { ok: false, text: 'Mühürleri denetlemek için Mola Merkez açık anahtarı gerekli (--anahtar).', count: lines.length };
    const message = `mola-islem-muhur-1\n${canonical({ v: s.v, seq: s.seq, head: s.head, count: s.count, at: s.at, keyId: s.keyId })}`;
    let good = false; try { good = verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(s.signature, 'base64url')); } catch { good = false; }
    if (!good) return broken(s.seq, 'mühürün imzası geçersiz (başka anahtar ya da değiştirilmiş mühür).');
    if (hashes.get(s.seq) !== s.head) return broken(s.seq, 'kayıt mühürlendikten sonra değiştirilmiş.');
    checked++;
  }
  return { ok: true, text: 'Kayıtlar bütün', count: lines.length, first, last, seals: checked, unsealed: last - Math.max(first - 1, ...seals.filter(s => s.seq <= last).map(s => s.seq)), maskedElsewhere };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2), at = args.indexOf('--anahtar'), keyOption = at >= 0 ? args[at + 1] : undefined;
  const path = args.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1))[0];
  if (!path) { console.log('Kullanım: node scripts/islem-dogrula.mjs <dosya.jsonl | islem-kayitlari klasörü> [--anahtar merkez-public-key.txt]'); process.exit(2); }
  let input; try { input = load(path, keyOption); } catch (e) { console.error(`Okunamadı: ${e.message}`); process.exit(2); }
  const r = check(input);
  if (r.ok) {
    console.log(`Kayıtlar bütün: ${r.count} kayıt (#${r.first} – #${r.last}), ${r.seals} mühür doğrulandı${r.unsealed ? `, son ${r.unsealed} kayıt henüz mühürlenmemiş` : ''}.`);
    if (r.maskedElsewhere) console.log(`Not: ${r.maskedElsewhere} kaydın IP adresi 1 yıl sonra silinmiş; bunları listeleyen "journal.addresses_masked" kaydı bu dosyada değil (daha geniş bir dönemle denetleyin).`);
    if (input.publicKey) console.log(`Mola Merkez anahtarının parmak izi: ${fingerprint(keyId(input.publicKey))} (raporun kapağındaki ve Mola Yönetim kurulumundaki ile karşılaştırın).`);
  } else console.error(`BOZUK: ${r.text}`);
  process.exit(r.ok ? 0 : 1);
}

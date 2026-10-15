/*
 * Mola Yardım (molayazilim.com.tr, sağ alttaki "Yardım"): Mola'yı kullanan kafeler için hazır sorular ve cevaplar.
 * Yapay zekâ yok, sunucu yok: site/src/assets/yardim.json derlemede denetlenir ve site/src/assets/yardim.js'in içine gömülür
 * (dist/assets/yardim.js). site.js bu dosyayı yalnız yardımcı ilk açılınca yükler; aranan hiçbir şey ağa gitmez.
 * Kullanan: scripts/site-build.ts (derleme) ve tests/site-yardim.test.ts (arama ve içerik denetimi).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type YardimKonu = { id: string; ad: string };
/** cevap: her metin bir paragraf, her dizi numaralı adımlar. Düz metin: sayfada textContent ile yazılır. */
export type YardimSoru = { id: string; konu: string; soru: string; cevap: (string | string[])[]; anahtar: string[]; ilgili?: string[] };
export type YardimVerisi = { konular: YardimKonu[]; sikSorulanlar: string[]; sorular: YardimSoru[] };

const MARKER = '__YARDIM_VERISI__', AVATAR_MARKER = '__YARDIM_RESIM__';
/** The Mola Yardım picture beside the panel's title (same-origin files under /assets/img/). */
export type YardimAvatar = { src: string; srcset: string };
const ID = /^[a-z0-9-]{2,40}$/;
// Line and paragraph separators (U+2028, U+2029) and "<": escaped in the embedded literal.
const UNSAFE = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}<]`, 'g');

/** Reads and checks site/src/assets/yardim.json; a mistake stops the build with the question's id. */
export function readYardim(src: string): YardimVerisi {
  const file = join(src, 'assets', 'yardim.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<YardimVerisi>;
  const fail = (m: string): never => { throw new Error(`site/src/assets/yardim.json: ${m}`); };
  const text = (v: unknown, where: string, max: number) => {
    if (typeof v !== 'string' || !v.trim()) fail(`${where}: boş ya da metin değil.`);
    const s = v as string;
    if (s.length > max) fail(`${where}: en çok ${max} harf (${s.length}).`);
    if (/[<>]/.test(s)) fail(`${where}: < ve > kullanılmaz (düz metin; HTML çalışmaz).`);
    return s;
  };
  if (!Array.isArray(raw.konular) || !raw.konular.length) fail('"konular" yok.');
  if (!Array.isArray(raw.sorular) || !raw.sorular.length) fail('"sorular" yok.');
  const konular: YardimKonu[] = raw.konular!.map((k, i) => {
    if (!k || !ID.test(String(k.id))) fail(`konular[${i}]: id küçük harf, rakam ve tire olmalı.`);
    return { id: k.id, ad: text(k.ad, `konu ${k.id}`, 30) };
  });
  const konuIds = new Set(konular.map(k => k.id));
  if (konuIds.size !== konular.length) fail('aynı konu iki kez yazılmış.');
  const ids = new Set<string>();
  const sorular: YardimSoru[] = raw.sorular!.map((q, i) => {
    const where = `sorular[${i}]${q?.id ? ` (${q.id})` : ''}`;
    if (!q || !ID.test(String(q.id))) fail(`${where}: id küçük harf, rakam ve tire olmalı.`);
    if (ids.has(q.id)) fail(`${where}: bu id iki kez var.`);
    ids.add(q.id);
    if (!konuIds.has(q.konu)) fail(`${where}: bilinmeyen konu "${q.konu}".`);
    if (!Array.isArray(q.cevap) || !q.cevap.length || q.cevap.length > 6) fail(`${where}: cevap 1-6 bölüm olmalı.`);
    const cevap = q.cevap.map((b, j) => {
      if (typeof b === 'string') return text(b, `${where} cevap[${j}]`, 600);
      if (!Array.isArray(b) || b.length < 2 || b.length > 10) fail(`${where} cevap[${j}]: adım listesi 2-10 satır olmalı.`);
      return (b as unknown[]).map((s, k) => text(s, `${where} cevap[${j}][${k}]`, 320));
    });
    if (!Array.isArray(q.anahtar) || !q.anahtar.length || q.anahtar.length > 40) fail(`${where}: anahtar 1-40 kelime olmalı.`);
    const anahtar = q.anahtar.map((k, j) => text(k, `${where} anahtar[${j}]`, 40));
    const out: YardimSoru = { id: q.id, konu: q.konu, soru: text(q.soru, `${where} soru`, 120), cevap, anahtar };
    if (q.ilgili !== undefined) {
      if (!Array.isArray(q.ilgili) || q.ilgili.length > 4) fail(`${where}: ilgili en çok 4 soru.`);
      out.ilgili = q.ilgili.map(String);
    }
    return out;
  });
  for (const q of sorular) for (const r of q.ilgili ?? []) if (!ids.has(r) || r === q.id) fail(`${q.id}: ilgili "${r}" yok.`);
  for (const k of konular) if (!sorular.some(q => q.konu === k.id)) fail(`konu "${k.id}" altında soru yok.`);
  const sik = Array.isArray(raw.sikSorulanlar) ? raw.sikSorulanlar.map(String) : [];
  for (const id of sik) if (!ids.has(id)) fail(`sikSorulanlar: "${id}" yok.`);
  return { konular, sikSorulanlar: sik, sorular };
}

/** site/src/assets/yardim.js with the checked questions inside (a JS object literal: JSON, never evaluated as text). */
export function yardimScript(src: string, avatar: YardimAvatar | null = null): string {
  const code = readFileSync(join(src, 'assets', 'yardim.js'), 'utf8');
  for (const m of [MARKER, AVATAR_MARKER]) if (code.split(m).length !== 2) throw new Error(`site/src/assets/yardim.js: ${m} tam bir kez geçmeli.`);
  if (avatar && ![avatar.src, ...avatar.srcset.split(', ')].every(u => /^\/assets\/img\/[a-z0-9-]+\.png\?v=[0-9a-f]+(?: [123]x)?$/.test(u))) throw new Error('Mola Yardım resmi: yalnız /assets/img/*.png');
  // U+2028/2029 and "<" escaped: the literal stays valid JavaScript everywhere.
  const data = JSON.stringify(readYardim(src)).replace(UNSAFE, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return code.replace(MARKER, () => data).replace(AVATAR_MARKER, () => JSON.stringify(avatar));
}

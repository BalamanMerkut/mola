/*
 * Mola Yardım: hazır sorular ve cevaplar (site/src/assets/yardim.json). Browser-safe: no file access, no network.
 * - checkYardim: the build's check (scripts/site-yardim.ts stops the site build; tests/site-yardim.test.ts runs it too).
 * - forAudience: only one audience's questions ("site" for molayazilim.com.tr, a role for the café app's "?" panel).
 * - createYardimSearch: the same search as site/src/assets/yardim.js (kept in step: tests/site-yardim.test.ts compares them),
 *   used by the café app (src/HelpPanel.tsx). Nothing typed leaves the device.
 */
export const YARDIM_KITLELER = ['site', 'owner', 'manager', 'cashier', 'waiter', 'kitchen'] as const;
/** Who sees a question: the public website or one of the café app's roles (packages/domain/types.ts Role, without "support"). */
export type YardimKitle = typeof YARDIM_KITLELER[number];
export type YardimKonu = { id: string; ad: string };
/** cevap: her metin bir paragraf, her dizi numaralı adımlar. Düz metin: sayfada textContent ile yazılır. */
export type YardimSoru = { id: string; konu: string; kitle: YardimKitle[]; soru: string; cevap: (string | string[])[]; anahtar: string[]; ilgili?: string[] };
export type YardimVerisi = { konular: YardimKonu[]; sikSorulanlar: string[]; sorular: YardimSoru[] };

const ID = /^[a-z0-9-]{2,40}$/;

/** Checks the questions as written in yardim.json; a mistake throws with the question's id. */
export function checkYardim(raw: Partial<YardimVerisi>, file = 'site/src/assets/yardim.json'): YardimVerisi {
  const fail = (m: string): never => { throw new Error(`${file}: ${m}`); };
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
    if (!Array.isArray(q.kitle) || !q.kitle.length) fail(`${where}: kitle en az bir kişi olmalı (${YARDIM_KITLELER.join(', ')}).`);
    for (const k of q.kitle) if (!(YARDIM_KITLELER as readonly string[]).includes(k)) fail(`${where}: bilinmeyen kitle "${k}".`);
    if (new Set(q.kitle).size !== q.kitle.length) fail(`${where}: kitle iki kez yazılmış.`);
    if (!Array.isArray(q.cevap) || !q.cevap.length || q.cevap.length > 6) fail(`${where}: cevap 1-6 bölüm olmalı.`);
    const cevap = q.cevap.map((b, j) => {
      if (typeof b === 'string') return text(b, `${where} cevap[${j}]`, 600);
      if (!Array.isArray(b) || b.length < 2 || b.length > 10) fail(`${where} cevap[${j}]: adım listesi 2-10 satır olmalı.`);
      return (b as unknown[]).map((s, k) => text(s, `${where} cevap[${j}][${k}]`, 320));
    });
    if (!Array.isArray(q.anahtar) || !q.anahtar.length || q.anahtar.length > 40) fail(`${where}: anahtar 1-40 kelime olmalı.`);
    const anahtar = q.anahtar.map((k, j) => text(k, `${where} anahtar[${j}]`, 40));
    const out: YardimSoru = { id: q.id, konu: q.konu, kitle: [...q.kitle], soru: text(q.soru, `${where} soru`, 120), cevap, anahtar };
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

/**
 * One audience's questions (or several: a question shows when any of them is in its `kitle`; the first one's own questions
 * come first). Topics without a question for it are left out, "İlgili" links only to questions it sees, and the first
 * eight of `sikSorulanlar` it sees (its own first). The `kitle` lists stay out (the page needs none).
 */
export function forAudience(data: YardimVerisi, kitle: YardimKitle | readonly YardimKitle[]): YardimVerisi {
  const list: readonly YardimKitle[] = typeof kitle === 'string' ? [kitle] : kitle, own = (q: YardimSoru) => q.kitle.includes(list[0]);
  const shown = data.sorular.filter(q => q.kitle.some(k => list.includes(k)));
  const sorular = [...shown.filter(own), ...shown.filter(q => !own(q))], seen = new Map(sorular.map(q => [q.id, q]));
  const sik = data.sikSorulanlar.filter(id => seen.has(id));
  return {
    konular: data.konular.filter(k => sorular.some(q => q.konu === k.id)),
    sikSorulanlar: [...sik.filter(id => own(seen.get(id)!)), ...sik.filter(id => !own(seen.get(id)!))].slice(0, 8),
    sorular: sorular.map(({ kitle: _kitle, ilgili, ...q }) => {
      const rel = (ilgili ?? []).filter(id => seen.has(id));
      return rel.length ? { ...q, ilgili: rel } : q;
    }) as YardimSoru[],
  };
}
/**
 * The café app's "?" (src/HelpPanel.tsx): the owner and the Müdür read every app question (their own first), everyone
 * else only their role's. Never the website's own questions (prices, trial).
 */
export function appAudience(role: Exclude<YardimKitle, 'site'>): YardimKitle[] {
  const app: Exclude<YardimKitle, 'site'>[] = ['owner', 'manager', 'cashier', 'waiter', 'kitchen'];
  return role === 'owner' || role === 'manager' ? [role, ...app.filter(r => r !== role)] : [role];
}

// ---- Arama (site/src/assets/yardim.js ile aynı): küçük harf, Türkçe harfler sade (ö → o, ı → i), kelime ve anahtar puanı ----
const HARF: Record<string, string> = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
const BOS = new Set(('nasil ne neden niye nerede nereden nereye nedir mi mu bir ve veya ya ile icin ben benim bana beni biz bizim bu su o de da ki ' +
  'gibi olur oluyor olmuyor yapilir yapilmali yaparim yapabilirim yapmaliyim yapmak edilir ederim istiyorum lazim gerek gerekir ' +
  'hangi kac var yok acaba sey mola kafe kafemde kafemiz lutfen merhaba yardim acil').split(' '));

export function normalizeYardim(text: unknown) {
  const s = String(text ?? '').slice(0, 200);
  let low: string;
  try { low = s.toLocaleLowerCase('tr'); } catch { low = s.toLowerCase(); }
  let out = '';
  for (const c of low) out += HARF[c] ?? c;
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}
const words = (text: unknown) => { const n = normalizeYardim(text); return n ? n.split(' ') : []; };
/** Words worth searching for (not "nasıl", "ne", "bir"). */
export const meaningfulWords = (text: unknown) => words(text).filter(w => w.length >= 2 && !BOS.has(w));
const meaningful = (list: string[]) => list.filter(w => w.length >= 2 && !BOS.has(w));
// One letter added, missing or wrong ("yazci", "odme"): still the same word.
function oneEdit(a: string, b: string) {
  const la = a.length, lb = b.length; let i = 0, j = 0, edits = 0;
  if (Math.abs(la - lb) > 1) return false;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}
function wordScore(t: string, w: string, full: number) {
  if (t === w) return full;
  if (t.length >= 3 && w.startsWith(t)) return full - 1; // still typing: "yaz" → "yazici"
  if (w.length >= 4 && t.startsWith(w)) return full - 1; // with a suffix: "odemeyi" → "odeme"
  if (t.length >= 4 && w.length >= 5 && oneEdit(t, w)) return full - 1;
  return 0;
}
export type YardimHit = { id: string; soru: string; score: number };

/** The search over one set of questions (e.g. forAudience(data, 'waiter')): best first, [] when nothing fits. */
export function createYardimSearch(data: YardimVerisi) {
  const byId = new Map(data.sorular.map(q => [q.id, q]));
  const index = data.sorular.map((q, order) => {
    const phrases: string[] = [], kw = new Map<string, number>(), qw = new Set<string>(), aw = new Set<string>();
    // kw: 2 when the word is a keyword on its own ("yazici"), 1 when it is part of one ("yazici calismiyor").
    for (const k of q.anahtar) { const n = normalizeYardim(k); if (!n) continue; phrases.push(n); for (const w of meaningful(n.split(' '))) kw.set(w, Math.max(kw.get(w) ?? 0, n === w ? 2 : 1)); }
    for (const w of meaningful(words(q.soru))) qw.add(w);
    for (const t of q.cevap.flat()) for (const w of meaningful(words(t))) aw.add(w);
    return { q, order, phrases, kw, qw: [...qw], aw };
  });
  function search(text: string, limit = 6): YardimHit[] {
    const n = normalizeYardim(text), toks = meaningful(n ? n.split(' ') : []), padded = ` ${n} `;
    if (!toks.length) return [];
    const found: (YardimHit & { order: number })[] = [];
    for (const e of index) {
      let s = 0, hit = 0;
      for (const p of e.phrases) {
        if (p === n) s += 12;
        else if (p.indexOf(' ') > 0 && padded.includes(` ${p} `)) s += 6;
      }
      for (const t of toks) {
        let best = 0;
        for (const [w, kind] of e.kw) best = Math.max(best, wordScore(t, w, kind === 2 ? 6 : 5));
        for (const w of e.qw) best = Math.max(best, wordScore(t, w, 4));
        if (!best && e.aw.has(t)) best = 1;
        if (best) { hit++; s += best; }
      }
      if (hit && s >= 4) found.push({ id: e.q.id, soru: e.q.soru, score: s + (hit === toks.length ? 3 : 0), order: e.order });
    }
    found.sort((a, b) => b.score - a.score || a.order - b.order);
    return found.slice(0, limit).map(({ order: _o, ...h }) => h);
  }
  return { search, get: (id: string) => byId.get(id) ?? null };
}

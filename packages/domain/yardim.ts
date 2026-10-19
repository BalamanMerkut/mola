/*
 * Mola Yardım: hazır sorular ve cevaplar (site/src/assets/yardim.json). Browser-safe: no file access, no network.
 * - checkYardim: the build's check (scripts/site-yardim.ts stops the site build; tests/site-yardim.test.ts runs it too).
 * - forAudience: only one audience's questions ("site" for molayazilim.com.tr, a role for the café app's "?" panel).
 * - createYardimSearch: the same search as site/src/assets/yardim.js (kept in step: tests/site-yardim.test.ts compares them),
 *   used by the café app (src/HelpPanel.tsx). Nothing typed leaves the device.
 * - YARDIM_VIDEOLAR (19 Ekim): Mola's YouTube videos an answer may point to ("Videoda izleyin"), at the moment that shows it.
 */
export const YARDIM_KITLELER = ['site', 'owner', 'manager', 'cashier', 'waiter', 'kitchen'] as const;
/** Who sees a question: the public website or one of the café app's roles (packages/domain/types.ts Role, without "support"). */
export type YardimKitle = typeof YARDIM_KITLELER[number];
export type YardimKonu = { id: string; ad: string };
/**
 * 19 Ekim: a moment of one of Mola's videos under an answer. t: seconds from the start; baslik: "<video> · <what it shows>".
 * kitle (yardim.json only): who gets this one (the asker's own training video first); none = everyone who sees the question.
 */
export type YardimVideo = { id: string; t: number; baslik: string; kitle?: YardimKitle[] };
/** cevap: her metin bir paragraf, her dizi numaralı adımlar. Düz metin: sayfada textContent ile yazılır. */
export type YardimSoru = { id: string; konu: string; kitle: YardimKitle[]; soru: string; cevap: (string | string[])[]; anahtar: string[]; ilgili?: string[]; video?: YardimVideo[] };
export type YardimVerisi = { konular: YardimKonu[]; sikSorulanlar: string[]; sorular: YardimSoru[] };

const ID = /^[a-z0-9-]{2,40}$/;
/** 19 Ekim: Mola's videos on youtube.com/@molayazilim (ad: the start of every baslik; sure: length in seconds). */
export const YARDIM_VIDEOLAR: Record<string, { ad: string; sure: number }> = {
  wpMZdS5dPgw: { ad: 'Mola’yı 2 dakikada tanıyın', sure: 117 },
  GXqUnXGY5vo: { ad: 'QR menü ve QR sipariş', sure: 233 },
  NDYQ_bvUIj0: { ad: 'Stok, reçete ve kârlılık', sure: 297 },
  xAMiBM8M89I: { ad: 'Raporlar', sure: 294 },
  dSAqQq_d3fE: { ad: 'Kampanyalar ve rezervasyon', sure: 292 },
  WYMVLdIAsVs: { ad: 'Uzaktan erişim ve güvenlik', sure: 288 },
  d49M0PuJO94: { ad: 'Kurulum', sure: 309 },
  uxh2tuyR6oY: { ad: 'Garson eğitimi', sure: 190 },
  n_JDwbQ7peA: { ad: 'Kasiyer eğitimi', sure: 240 },
  H5iJWKpwtBY: { ad: 'Mutfak eğitimi', sure: 183 },
  JxhE4ESU4H4: { ad: 'Müdür eğitimi', sure: 212 },
  '2lbq7fz6BXs': { ad: 'İşletme sahibi ilk gün', sure: 240 },
};
/** The YouTube address of a video at its moment (opened in a new window: the system's browser, YouTube on a phone). */
export const yardimVideoUrl = (v: { id: string; t: number }) => `https://www.youtube.com/watch?v=${v.id}&t=${v.t}s`;
/** "2:24" */
export const yardimVideoSure = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

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
    // 19 Ekim: videos (each audience is shown at most two of them, its own first: forAudience).
    if (q.video !== undefined) {
      if (!Array.isArray(q.video) || !q.video.length || q.video.length > 6) fail(`${where}: video 1-6 tane olmalı.`);
      out.video = q.video.map((v, j) => {
        const at = `${where} video[${j}]`, known = v && Object.prototype.hasOwnProperty.call(YARDIM_VIDEOLAR, v.id) ? YARDIM_VIDEOLAR[v.id] : null;
        if (!known) fail(`${at}: bilinmeyen video "${v?.id}".`);
        if (!Number.isInteger(v.t) || v.t < 0 || v.t >= known!.sure) fail(`${at}: t 0 ile ${known!.sure - 1} saniye arası olmalı.`);
        const baslik = text(v.baslik, `${at} baslik`, 80);
        if (!baslik.startsWith(`${known!.ad} · `) || baslik.length <= known!.ad.length + 3) fail(`${at}: baslik "${known!.ad} · …" diye başlamalı.`);
        const one: YardimVideo = { id: v.id, t: v.t, baslik };
        if (v.kitle !== undefined) {
          if (!Array.isArray(v.kitle) || !v.kitle.length || v.kitle.some(k => !q.kitle.includes(k))) fail(`${at}: kitle sorunun kitlesinden olmalı.`);
          one.kitle = [...v.kitle];
        }
        return one;
      });
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
 * Videos (19 Ekim): at most two, those for the first audience (its own training video first, as written); when none is
 * for it (the owner reading a waiter's question), those for any of the others.
 */
export function forAudience(data: YardimVerisi, kitle: YardimKitle | readonly YardimKitle[]): YardimVerisi {
  const list: readonly YardimKitle[] = typeof kitle === 'string' ? [kitle] : kitle, own = (q: YardimSoru) => q.kitle.includes(list[0]);
  const shown = data.sorular.filter(q => q.kitle.some(k => list.includes(k)));
  const sorular = [...shown.filter(own), ...shown.filter(q => !own(q))], seen = new Map(sorular.map(q => [q.id, q]));
  const sik = data.sikSorulanlar.filter(id => seen.has(id));
  return {
    konular: data.konular.filter(k => sorular.some(q => q.konu === k.id)),
    sikSorulanlar: [...sik.filter(id => own(seen.get(id)!)), ...sik.filter(id => !own(seen.get(id)!))].slice(0, 8),
    sorular: sorular.map(({ kitle: _kitle, ilgili, video, ...q }) => {
      const rel = (ilgili ?? []).filter(id => seen.has(id)), out: Partial<YardimSoru> = rel.length ? { ...q, ilgili: rel } : q;
      const mine = (video ?? []).filter(v => !v.kitle || v.kitle.includes(list[0]));
      const shown = (mine.length ? mine : (video ?? []).filter(v => v.kitle!.some(k => list.includes(k)))).slice(0, 2);
      if (shown.length) out.video = shown.map(({ id, t, baslik }) => ({ id, t, baslik }));
      return out;
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
// 19 Ekim: yazım hatası payı, yapay zekâ olmadan ("giderr nasl kaydedlr", "kasyer"): soruların bilmediği bir kelime, bilinen
// bir kelimeye bir-iki harf uzaksa (harf eksik, fazla, yanlış ya da yer değiştirmiş) yine sayılır, ama tam eşleşmeden az
// puanla; eşit puanda üç harflik parçaların benzerliği öne geçirir. Emin olunamayınca cevap yerine "Bunu mu demek istediniz?".
const BOS_UZUN = [...BOS].filter(w => w.length >= 4);
/** How many letters a typo may be off: one in a short word (up to 5 letters), two in a longer one. */
const allowed = (n: number) => n <= 5 ? 1 : 2;
/** Letters added, missing, wrong or swapped ("kasyer" → "kasiyer": 1); more than `max` gives max + 1 (stops early). */
function editDistance(a: string, b: string, max: number) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let older: number[] = [], prev: number[] = [];
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let low = i;
    for (let j = 1; j <= lb; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, older[j - 2] + 1);
      cur[j] = v; if (v < low) low = v;
    }
    if (low > max) return max + 1;
    older = prev; prev = cur;
  }
  return prev[lb];
}
/** 3: the same word; 2: still typing ("yaz" → "yazici") or with a suffix ("odemeyi" → "odeme"); 1: a typo; 0: another word. */
function wordTier(t: string, w: string, typo: boolean) {
  if (t === w) return 3;
  if (t.length >= 3 && w.startsWith(t)) return 2;
  if (w.length >= 4 && t.startsWith(w)) return 2;
  if (!typo || t.length < 4 || w.length < 4) return 0;
  if (editDistance(t, w, allowed(t.length)) <= allowed(t.length)) return 1;
  // A typo with a suffix ("kaydedlr" → "kaydet") or half typed ("kasye" → "kasiyer").
  if (t.length > w.length) return w.length >= 5 && editDistance(t.slice(0, w.length), w, allowed(w.length)) <= allowed(w.length) ? 1 : 0;
  return t.length >= 5 && editDistance(t, w.slice(0, t.length), allowed(t.length)) <= allowed(t.length) ? 1 : 0;
}
/** The three-letter pieces of the words (" ka", "kas", "asa", "sa "): how alike two texts look, for a tie. */
function trigrams(list: string[]) {
  const out = new Set<string>();
  for (const w of list) { const p = ` ${w} `; for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3)); }
  return out;
}
function likeness(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let same = 0;
  a.forEach(g => { if (b.has(g)) same++; });
  return Math.round(200 * same / (a.size + b.size)) / 100;
}
export type YardimHit = { id: string; soru: string; score: number };
/** sure: the first hit is the answer; otherwise the hits are for "Bunu mu demek istediniz?" (at most three). */
export type YardimAsk = { sure: boolean; hits: YardimHit[] };

/** The search over one set of questions (e.g. forAudience(data, 'waiter')): best first, [] when nothing fits. */
export function createYardimSearch(data: YardimVerisi) {
  const byId = new Map(data.sorular.map(q => [q.id, q])), known = new Set<string>();
  const index = data.sorular.map((q, order) => {
    const phrases: string[] = [], kw = new Map<string, number>(), qw = new Set<string>(), aw = new Set<string>(), look: string[] = [];
    // kw: 2 when the word is a keyword on its own ("yazici"), 1 when it is part of one ("yazici calismiyor").
    for (const k of q.anahtar) { const n = normalizeYardim(k); if (!n) continue; phrases.push(n); for (const w of meaningful(n.split(' '))) { kw.set(w, Math.max(kw.get(w) ?? 0, n === w ? 2 : 1)); look.push(w); } }
    for (const w of meaningful(words(q.soru))) { qw.add(w); look.push(w); }
    for (const t of q.cevap.flat()) for (const w of meaningful(words(t))) aw.add(w);
    for (const w of [...kw.keys(), ...qw, ...aw]) known.add(w);
    return { q, order, phrases, kw: [...kw], qw: [...qw], aw, tri: trigrams(look) };
  });
  function rank(text: string) {
    const n = normalizeYardim(text), padded = ` ${n} `;
    // A typo of "nasıl", "nedir"… ("nasl") is left out too; a word the questions know never is.
    const toks = meaningful(n ? n.split(' ') : []).filter(t => known.has(t) || !BOS_UZUN.some(b => editDistance(t, b, 1) <= 1));
    if (!n) return [];
    // Only small words ("Mola nedir?"): a keyword written just so still answers.
    const typo = toks.map(t => !known.has(t)), anyTypo = typo.some(Boolean), tri = trigrams(toks);
    const found: (YardimHit & { order: number; like: number; fuzzy: number; all: boolean })[] = [];
    for (const e of index) {
      let s = 0, hit = 0, fuzzy = 0;
      for (const p of e.phrases) {
        if (p === n) s += 12;
        else if (p.indexOf(' ') > 0 && padded.includes(` ${p} `)) s += 6;
      }
      toks.forEach((t, i) => {
        let best = 0, tier = 0;
        // A keyword: 6 on its own, 5 as part of one; a word of the question: 4. One less with a suffix, two less with a typo.
        for (const [w, kind] of e.kw) { const r = wordTier(t, w, typo[i]); if (r) { best = Math.max(best, (kind === 2 ? 3 : 2) + r); tier = Math.max(tier, r); } }
        for (const w of e.qw) { const r = wordTier(t, w, typo[i]); if (r) { best = Math.max(best, 1 + r); tier = Math.max(tier, r); } }
        if (!best && e.aw.has(t)) { best = 1; tier = 3; }
        if (best) { hit++; s += best; if (tier === 1) fuzzy++; }
      });
      // A typo alone ("kasyer") counts when it is all that was asked.
      if ((hit && (s >= 4 || (hit === toks.length && s >= 3))) || (!toks.length && s >= 12)) found.push({ id: e.q.id, soru: e.q.soru, score: s + (hit === toks.length ? 3 : 0), order: e.order, like: likeness(tri, e.tri), fuzzy, all: hit === toks.length });
    }
    // A tie: with a typo the more alike question first; otherwise the audience's own first (forAudience's order).
    found.sort((a, b) => b.score - a.score || (anyTypo ? b.like - a.like : 0) || a.order - b.order);
    return found;
  }
  const plain = (h: YardimHit): YardimHit => ({ id: h.id, soru: h.soru, score: h.score });
  function search(text: string, limit = 6): YardimHit[] { return rank(text).slice(0, limit).map(plain); }
  /**
   * What the panel shows for what was typed: the answer when sure (every word matched as written, or the typos still point
   * clearly to one question: all words found and two points ahead of the next), otherwise up to three to choose from.
   */
  function ask(text: string, limit = 4): YardimAsk {
    const found = rank(text), top = found[0], next = found[1];
    if (!top) return { sure: false, hits: [] };
    const sure = !top.fuzzy || (top.all && (!next || top.score - next.score >= 2));
    return { sure, hits: found.slice(0, sure ? limit : 3).map(plain) };
  }
  return { search, ask, get: (id: string) => byId.get(id) ?? null };
}

/* Mola Yardım: Mola'yı kullanan ve tanımak isteyen kafeler için hazır sorular ve cevaplar. Yapay zekâ yok, sunucu yok.
 * Sorular derlemede site/src/assets/yardim.json'dan buraya gömülür (scripts/site-yardim.ts; yalnız kitlesi "site" olanlar);
 * site.js bu dosyayı yalnız yardımcı ilk açılınca yükler. Arama packages/domain/yardim.ts ile aynıdır (programın "?"ı). Bu dosya hiçbir ağ isteği yapmaz, çerez ve tarayıcı deposu kullanmaz; yazılan soru
 * tarayıcıdan çıkmaz. Her şey DOM ile ve textContent ile çizilir (innerHTML yok, eval yok, kullanıcıdan düzenli ifade yok).
 * 19 Ekim: yazım hatalarına pay (yine yapay zekâ yok) ve cevabın altında "Videoda izleyin" (YouTube, yalnız tıklanınca, yeni sekmede). */
(function (root) {
  'use strict';
  var DATA = __YARDIM_VERISI__;
  var AVATAR = __YARDIM_RESIM__; // { src, srcset } of the Mola Yardım picture (assets/img/yardimci-*.png), or null
  var has = Object.prototype.hasOwnProperty;

  // ---- Arama: küçük harf, Türkçe harfler sade (ö → o, ı → i), kelime ve anahtar puanı ----
  var HARF = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
  var BOS = Object.create(null);
  ('nasil ne neden niye nerede nereden nereye nedir mi mu bir ve veya ya ile icin ben benim bana beni biz bizim bu su o de da ki ' +
   'gibi olur oluyor olmuyor yapilir yapilmali yaparim yapabilirim yapmaliyim yapmak edilir ederim istiyorum lazim gerek gerekir ' +
   'hangi kac var yok acaba sey mola kafe kafemde kafemiz lutfen merhaba yardim acil ' +
   'uygulama uygulamasi uygulamayi uygulamada program programi programa programda yazilim').split(' ').forEach(function (w) { BOS[w] = true; });

  function normalize(text) {
    var s = String(text == null ? '' : text).slice(0, 200), low, out = '';
    try { low = s.toLocaleLowerCase('tr'); } catch (e) { low = s.toLowerCase(); }
    for (var i = 0; i < low.length; i++) { var c = low.charAt(i); out += has.call(HARF, c) ? HARF[c] : c; }
    if (out.normalize) out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return out.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function words(text) { var n = normalize(text); return n ? n.split(' ') : []; }
  function meaningful(list) { return list.filter(function (w) { return w.length >= 2 && !BOS[w]; }); }
  function flat(blocks) { var out = []; blocks.forEach(function (b) { out = out.concat(b); }); return out; }
  // 19 Ekim: yazım hatası payı, yapay zekâ olmadan ("giderr nasl kaydedlr", "kasyer"): soruların bilmediği bir kelime, bilinen
  // bir kelimeye bir-iki harf uzaksa (harf eksik, fazla, yanlış ya da yer değiştirmiş) yine sayılır, ama tam eşleşmeden az
  // puanla; eşit puanda üç harflik parçaların benzerliği öne geçirir. Emin olunamayınca cevap yerine "Bunu mu demek istediniz?".
  var BOS_UZUN = Object.keys(BOS).filter(function (w) { return w.length >= 4; });
  /** How many letters a typo may be off: one in a short word (up to 5 letters), two in a longer one. */
  function allowed(n) { return n <= 5 ? 1 : 2; }
  /** Letters added, missing, wrong or swapped ("kasyer" → "kasiyer": 1); more than `max` gives max + 1 (stops early). */
  function editDistance(a, b, max) {
    var la = a.length, lb = b.length, older = [], prev = [], i, j;
    if (Math.abs(la - lb) > max) return max + 1;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      var cur = [i], low = i;
      for (j = 1; j <= lb; j++) {
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, older[j - 2] + 1);
        cur[j] = v; if (v < low) low = v;
      }
      if (low > max) return max + 1;
      older = prev; prev = cur;
    }
    return prev[lb];
  }
  /** 3: the same word; 2: still typing ("yaz" → "yazici") or with a suffix ("odemeyi" → "odeme"); 1: a typo; 0: another word. */
  function wordTier(t, w, typo) {
    if (t === w) return 3;
    if (t.length >= 3 && w.indexOf(t) === 0) return 2;
    if (w.length >= 4 && t.indexOf(w) === 0) return 2;
    if (!typo || t.length < 4 || w.length < 4) return 0;
    if (editDistance(t, w, allowed(t.length)) <= allowed(t.length)) return 1;
    // A typo with a suffix ("kaydedlr" → "kaydet") or half typed ("kasye" → "kasiyer").
    if (t.length > w.length) return w.length >= 5 && editDistance(t.slice(0, w.length), w, allowed(w.length)) <= allowed(w.length) ? 1 : 0;
    return t.length >= 5 && editDistance(t, w.slice(0, t.length), allowed(t.length)) <= allowed(t.length) ? 1 : 0;
  }
  /** The three-letter pieces of the words (" ka", "kas", "asa", "sa "): how alike two texts look, for a tie. */
  function trigrams(list) {
    var out = { set: Object.create(null), size: 0 };
    list.forEach(function (w) {
      var p = ' ' + w + ' ';
      for (var i = 0; i + 3 <= p.length; i++) { var g = p.slice(i, i + 3); if (!out.set[g]) { out.set[g] = true; out.size++; } }
    });
    return out;
  }
  function likeness(a, b) {
    if (!a.size || !b.size) return 0;
    var same = 0;
    for (var g in a.set) if (b.set[g]) same++;
    return Math.round(200 * same / (a.size + b.size)) / 100;
  }

  var index = null, byId = Object.create(null), topicName = Object.create(null), known = Object.create(null);
  function build() {
    DATA.konular.forEach(function (k) { topicName[k.id] = k.ad; });
    index = DATA.sorular.map(function (q, order) {
      var phrases = [], kw = Object.create(null), qw = Object.create(null), aw = Object.create(null), look = [];
      byId[q.id] = q;
      // kw[w]: 2 when the word is a keyword on its own ("yazici"), 1 when it is part of one ("yazici calismiyor").
      q.anahtar.forEach(function (k) { var n = normalize(k); if (!n) return; phrases.push(n); meaningful(n.split(' ')).forEach(function (w) { kw[w] = Math.max(kw[w] || 0, n === w ? 2 : 1); look.push(w); known[w] = true; }); });
      meaningful(words(q.soru)).forEach(function (w) { qw[w] = true; look.push(w); known[w] = true; });
      flat(q.cevap).forEach(function (t) { meaningful(words(t)).forEach(function (w) { aw[w] = true; known[w] = true; }); });
      return { q: q, order: order, phrases: phrases, kw: kw, kwList: Object.keys(kw), qw: Object.keys(qw), aw: aw, tri: trigrams(look) };
    });
  }
  function rank(text) {
    if (!index) build();
    var n = normalize(text), padded = ' ' + n + ' ', found = [];
    // A typo of "nasıl", "nedir"… ("nasl") is left out too; a word the questions know never is.
    var toks = meaningful(n ? n.split(' ') : []).filter(function (t) { return known[t] || !BOS_UZUN.some(function (b) { return editDistance(t, b, 1) <= 1; }); });
    if (!n) return [];
    // Only small words ("Mola nedir?"): a keyword written just so still answers.
    var typo = toks.map(function (t) { return !known[t]; }), anyTypo = typo.indexOf(true) >= 0, tri = trigrams(toks);
    index.forEach(function (e) {
      var s = 0, hit = 0, fuzzy = 0;
      e.phrases.forEach(function (p) {
        if (p === n) s += 12;
        else if (p.indexOf(' ') > 0 && padded.indexOf(' ' + p + ' ') >= 0) s += 6;
      });
      toks.forEach(function (t, i) {
        var best = 0, tier = 0;
        // A keyword: 6 on its own, 5 as part of one; a word of the question: 4. One less with a suffix, two less with a typo.
        e.kwList.forEach(function (w) { var r = wordTier(t, w, typo[i]); if (r) { best = Math.max(best, (e.kw[w] === 2 ? 3 : 2) + r); tier = Math.max(tier, r); } });
        e.qw.forEach(function (w) { var r = wordTier(t, w, typo[i]); if (r) { best = Math.max(best, 1 + r); tier = Math.max(tier, r); } });
        if (!best && e.aw[t]) { best = 1; tier = 3; }
        if (best) { hit++; s += best; if (tier === 1) fuzzy++; }
      });
      // A typo alone ("kasyer") counts when it is all that was asked.
      if ((hit && (s >= 4 || (hit === toks.length && s >= 3))) || (!toks.length && s >= 12)) found.push({ id: e.q.id, soru: e.q.soru, score: s + (hit === toks.length ? 3 : 0), order: e.order, like: likeness(tri, e.tri), fuzzy: fuzzy, all: hit === toks.length });
    });
    // A tie: with a typo the more alike question first; otherwise the audience's own first (forAudience's order).
    found.sort(function (a, b) { return b.score - a.score || (anyTypo ? b.like - a.like : 0) || a.order - b.order; });
    return found;
  }
  function plain(h) { return { id: h.id, soru: h.soru, score: h.score }; }
  /** The best questions for what was typed, best first; [] when nothing fits. */
  function search(text, limit) { return rank(text).slice(0, limit || 6).map(plain); }
  /**
   * What the panel shows for what was typed: the answer when sure (every word matched as written; a partial match ahead of the next one; or the typos still point
   * clearly to one question: all words found and two points ahead of the next), otherwise up to three to choose from.
   */
  function ask(text, limit) {
    var found = rank(text), top = found[0], next = found[1];
    if (!top) return { sure: false, hits: [] };
    var lead = next ? top.score - next.score : 99;
    var sure = (top.all && !top.fuzzy) || (lead > 0 && (!top.fuzzy || (top.all && lead >= 2)));
    return { sure: sure, hits: found.slice(0, sure ? limit || 4 : 3).map(plain) };
  }
  function get(id) { if (!index) build(); return has.call(byId, id) ? byId[id] : null; }

  // 19 Ekim: a video's moment as a link ("Videoda izleyin: Kasiyer eğitimi · 2:54"); YouTube ids are 11 letters.
  function videoUrl(v) { return /^[A-Za-z0-9_-]{11}$/.test(v.id) && v.t >= 0 ? 'https://www.youtube.com/watch?v=' + v.id + '&t=' + Math.floor(v.t) + 's' : null; }
  function videoTime(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

  var api = root.MolaYardim = { normalize: normalize, search: search, ask: ask, get: get, videoUrl: videoUrl, data: DATA };
  if (!root.document) return;

  // ---- Panel: a short conversation (16 Ekim) ----
  // Mola Yardım greets ("Merhaba! Ne konuda yardım edeyim?"), the topics under it are quick replies, then Sık sorulanlar.
  // What is asked (typed and sent, a topic or a question tapped) appears on the right, the answer on the left with the small
  // picture; the related questions as small chips under it; nothing found: "Bunu bilmiyorum." and the ways to reach us. The
  // conversation keeps this visit's last few exchanges (KEEP), newest at the bottom; it is a polite live log for screen
  // readers. The box to type in sits at the bottom with a send button. Still the same answers and the same search.
  var doc = root.document, NS = 'http://www.w3.org/2000/svg', KEEP = 6;
  var panel, backdrop, input, chips, bodyEl, exchanges = [], said = 0;
  var opener = null, topic = null, inerted = [], measureChips = function () {};

  function el(tag, attrs, text) {
    var e = doc.createElement(tag);
    if (attrs) for (var k in attrs) if (has.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(paths) {
    var svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    paths.forEach(function (d) { var p = doc.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }
  /** A row of the conversation: Mola Yardım's (left, with the small picture) or the visitor's (right). */
  function botRow(content) {
    var row = el('div', { 'class': 'yardim-satir yardim-bot' });
    if (AVATAR) row.appendChild(el('img', { 'class': 'yardim-avatar yardim-avatar-kucuk', src: AVATAR.src, srcset: AVATAR.srcset, width: '30', height: '30', alt: '', decoding: 'async' }));
    else row.appendChild(el('span', { 'class': 'yardim-avatar-kucuk', 'aria-hidden': 'true' }));
    row.appendChild(content);
    return row;
  }
  function userRow(text) {
    var row = el('div', { 'class': 'yardim-satir yardim-kisi' });
    row.appendChild(el('p', { 'class': 'yardim-balonu yardim-sorulan' }, text));
    return row;
  }
  function questionList(items, hint) {
    var ul = el('ul', { 'class': 'yardim-liste' });
    items.forEach(function (q) {
      var li = el('li'), b = el('button', { type: 'button', 'class': 'yardim-soru' });
      b.appendChild(el('span', null, q.soru));
      if (hint) b.appendChild(el('small', null, topicName[q.konu] || ''));
      b.addEventListener('click', function () { askQuestion(q); });
      li.appendChild(b); ul.appendChild(li);
    });
    return ul;
  }
  /** Small chips under an answer: "İlgili:" or "Başka sorular:". */
  function chipsUnder(label, items) {
    var rel = el('div', { 'class': 'yardim-ilgili' });
    rel.appendChild(el('span', null, label));
    items.forEach(function (q) {
      var b = el('button', { type: 'button' }, q.soru);
      b.addEventListener('click', function () { askQuestion(q); });
      rel.appendChild(b);
    });
    return rel;
  }
  /**
   * 19 Ekim: under the text, the video that shows it at that moment: "Videoda izleyin: Kasiyer eğitimi · 2:54" and under it
   * what it shows ("Gider kaydetme"). YouTube in a new tab; the panel stays open.
   */
  function videoLinks(films) {
    var box = el('div', { 'class': 'yardim-videolar' });
    films.forEach(function (v) {
      var cut = v.baslik.indexOf(' · '), name = cut > 0 ? v.baslik.slice(0, cut) : v.baslik, what = cut > 0 ? v.baslik.slice(cut + 3) : '';
      var label = 'Videoda izleyin: ' + name + ' · ' + videoTime(v.t);
      var a = el('a', { 'class': 'yardim-video', href: videoUrl(v), target: '_blank', rel: 'noopener noreferrer', title: v.baslik + ' (YouTube, yeni sekmede açılır)', 'aria-label': label + (what ? ', ' + what : '') + ' (YouTube, yeni sekmede)' });
      a.appendChild(icon(['M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8z', 'm10 15 5-3-5-3z']));
      var words = el('span', { 'class': 'yardim-video-yazi' });
      words.appendChild(el('span', null, label));
      if (what) words.appendChild(el('small', null, what));
      a.appendChild(words);
      box.appendChild(a);
    });
    return box;
  }
  /** 19 Ekim: not sure what was meant (a typo): the closest questions to choose from, never a wrong answer. */
  function guessBubble(items) {
    var box = el('div', { 'class': 'yardim-balonu yardim-tahmin' });
    box.appendChild(el('p', { 'class': 'yardim-tahmin-baslik' }, 'Bunu mu demek istediniz?'));
    box.appendChild(questionList(items, false));
    box.appendChild(el('p', { 'class': 'yardim-tahmin-not' }, 'Hiçbiri değilse başka kelimelerle yazın.'));
    return box;
  }
  function answerBubble(q, others) {
    var id = 'yardim-cevap-' + (++said), a = el('article', { 'class': 'yardim-balonu yardim-cevap', 'aria-labelledby': id });
    a.appendChild(el('span', { 'class': 'chip' }, topicName[q.konu] || ''));
    a.appendChild(el('h3', { id: id }, q.soru));
    q.cevap.forEach(function (b) {
      if (typeof b === 'string') { a.appendChild(el('p', null, b)); return; }
      var ol = el('ol');
      b.forEach(function (step) { ol.appendChild(el('li', null, step)); });
      a.appendChild(ol);
    });
    var films = (q.video || []).filter(videoUrl);
    if (films.length) a.appendChild(videoLinks(films));
    var related = (q.ilgili || []).map(get).filter(Boolean);
    if (related.length) a.appendChild(chipsUnder('İlgili:', related));
    if (others && others.length) a.appendChild(chipsUnder('Başka sorular:', others));
    return a;
  }
  function notFoundBubble() {
    var box = el('div', { 'class': 'yardim-balonu yardim-yok' });
    box.appendChild(el('p', { 'class': 'yardim-yok-baslik' }, 'Bunu bilmiyorum.'));
    box.appendChild(el('p', null, 'Başka kelimelerle deneyin ya da bize ulaşın:'));
    var ways = el('div', { 'class': 'yardim-yollar' });
    ways.appendChild(el('a', { 'class': 'btn btn-primary', href: '/iletisim/' }, 'Destek ve İletişim'));
    // The e-mail the site already shows in its footer (site.js may have put Mola Yönetim's over it); the phone stays hidden.
    var mail = doc.querySelector('.site-footer [data-iletisim="email"] a[href^="mailto:"]'), address = mail ? mail.getAttribute('href').slice(7) : '';
    if (/^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[a-z]{2,}$/i.test(address)) ways.appendChild(el('a', { 'class': 'btn btn-ghost yardim-eposta', href: 'mailto:' + address }, address));
    box.appendChild(ways);
    box.appendChild(el('p', { 'class': 'yardim-yok-not' }, 'Mola’yı kullanıyorsanız programdan da yazabilirsiniz: Destek → Talepler.'));
    return box;
  }
  /** One exchange: the visitor's words on the right, the answer on the left; the oldest goes after KEEP; scrolled to. */
  function say(text, reply) {
    var mine = userRow(text), theirs = botRow(reply);
    bodyEl.appendChild(mine); bodyEl.appendChild(theirs);
    exchanges.push([mine, theirs]);
    while (exchanges.length > KEEP) exchanges.shift().forEach(function (n) { n.parentNode.removeChild(n); });
    bodyEl.scrollTop = Math.max(0, mine.offsetTop - 12);
  }
  function askQuestion(q) { say(q.soru, answerBubble(q)); }
  function askTopic(id) {
    topic = id;
    Array.prototype.forEach.call(chips.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-konu') === id)); });
    var box = el('div', { 'class': 'yardim-balonu' });
    box.appendChild(el('p', null, topicName[id] + ' hakkında sorulanlar:'));
    box.appendChild(questionList(DATA.sorular.filter(function (q) { return q.konu === id; }), false));
    say(topicName[id], box);
  }
  function askText() {
    var text = input.value.trim().slice(0, 120);
    if (!text) { input.focus(); return; }
    input.value = '';
    var found = ask(text, 4), results = found.hits;
    if (!results.length) { say(text, notFoundBubble()); return; }
    if (!found.sure) { say(text, guessBubble(results.map(function (r) { return get(r.id); }))); return; }
    say(text, answerBubble(get(results[0].id), results.slice(1, 4).map(function (r) { return get(r.id); })));
  }

  function create() {
    if (!index) build();
    backdrop = el('div', { 'class': 'yardim-katman', hidden: '' });
    backdrop.addEventListener('click', close);
    panel = el('section', { 'class': 'yardim-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'yardim-baslik', id: 'mola-yardim', hidden: '' });

    var head = el('header', { 'class': 'yardim-ust' });
    // The avatar beside the title is decoration (the title already says "Mola Yardım").
    if (AVATAR) head.appendChild(el('img', { 'class': 'yardim-avatar', src: AVATAR.src, srcset: AVATAR.srcset, width: '44', height: '44', alt: '', decoding: 'async' }));
    var titles = el('div', { 'class': 'yardim-basliklar' });
    titles.appendChild(el('h2', { id: 'yardim-baslik' }, 'Mola Yardım'));
    var x = el('button', { type: 'button', 'class': 'yardim-kapat', 'aria-label': 'Yardımı kapat' });
    x.appendChild(icon(['M18 6 6 18', 'm6 6 12 12']));
    x.addEventListener('click', close);
    head.appendChild(titles); head.appendChild(x);

    bodyEl = el('div', { 'class': 'yardim-govde', id: 'yardim-govde', role: 'log', 'aria-live': 'polite', 'aria-label': 'Mola Yardım ile konuşma' });
    var hello = el('div', { 'class': 'yardim-balonu yardim-selam' });
    hello.appendChild(el('p', null, 'Merhaba! Ne konuda yardım edeyim?'));
    bodyEl.appendChild(botRow(hello));
    // The topics are quick replies; they swipe sideways, for a mouse ‹ › and the wheel too (site.js MolaKaydir).
    var chipBox = el('div', { 'class': 'yardim-konular-kutu' });
    chips = el('div', { 'class': 'yardim-konular', role: 'group', 'aria-label': 'Konular' });
    DATA.konular.forEach(function (k) {
      var b = el('button', { type: 'button', 'class': 'yardim-konu', 'aria-pressed': 'false', 'data-konu': k.id }, k.ad);
      b.addEventListener('click', function () { askTopic(k.id); });
      chips.appendChild(b);
    });
    chipBox.appendChild(chips);
    bodyEl.appendChild(chipBox);
    var common = el('div', { 'class': 'yardim-balonu' });
    common.appendChild(el('h3', { 'class': 'yardim-liste-baslik' }, 'Sık sorulanlar'));
    common.appendChild(questionList(DATA.sikSorulanlar.map(get).filter(Boolean), true));
    bodyEl.appendChild(botRow(common));

    var compose = el('div', { 'class': 'yardim-yaz' });
    compose.appendChild(el('label', { 'for': 'yardim-sorgu', 'class': 'visually-hidden' }, 'Sorunuzu yazın'));
    input = el('input', { id: 'yardim-sorgu', type: 'search', placeholder: 'Sorunuzu yazın…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '120', enterkeyhint: 'send', 'aria-controls': 'yardim-govde' });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); askText(); } });
    var send = el('button', { type: 'button', 'class': 'yardim-gonder', 'aria-label': 'Gönder' });
    send.appendChild(icon(['M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z', 'M6 12h16']));
    send.addEventListener('click', function () { askText(); input.focus(); });
    compose.appendChild(input); compose.appendChild(send);

    panel.appendChild(head); panel.appendChild(bodyEl); panel.appendChild(compose);
    panel.addEventListener('keydown', onKey);
    // A link inside (Destek ve İletişim) closes the panel first: the page underneath is where it goes. A video opens in a
    // new tab: the panel stays as it was.
    panel.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a && a.target !== '_blank') close(true); });
    doc.body.appendChild(backdrop); doc.body.appendChild(panel);
    if (root.MolaKaydir) measureChips = root.MolaKaydir(chips, chipBox, 'Önceki konular', 'Sonraki konular');
  }

  // ---- Open, close, keyboard: Esc closes, Tab stays inside, focus goes back to the button that opened it ----
  function focusables() {
    return Array.prototype.filter.call(panel.querySelectorAll('button:not([tabindex="-1"]), a[href], input, [tabindex]:not([tabindex="-1"])'), function (n) {
      return !n.disabled && n.getClientRects().length > 0;
    });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables(); if (!f.length) return;
    var first = f[0], last = f[f.length - 1], active = doc.activeElement;
    if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
  function keepFocus(e) { if (panel && !panel.hidden && !panel.contains(e.target)) input.focus(); }
  function isOpen() { return !!panel && !panel.hidden; }
  function setTriggers(open) {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-yardim-ac]'), function (b) { if (b.tagName === 'BUTTON') b.setAttribute('aria-expanded', String(open)); });
  }
  function open(from) {
    if (!panel) create();
    if (isOpen()) { input.focus(); return; }
    opener = from && from.focus ? from : doc.activeElement;
    // The page behind cannot be reached while the panel is open (inert), as well as the Tab loop below.
    Array.prototype.forEach.call(doc.body.children, function (n) {
      if (n !== panel && n !== backdrop && n.tagName !== 'SCRIPT' && !n.inert) { n.inert = true; inerted.push(n); }
    });
    backdrop.hidden = false; panel.hidden = false;
    doc.documentElement.classList.add('yardim-acik');
    setTriggers(true);
    doc.addEventListener('focusin', keepFocus);
    measureChips();
    input.focus();
  }
  function close(leaving) {
    if (!isOpen()) return;
    panel.hidden = true; backdrop.hidden = true;
    doc.documentElement.classList.remove('yardim-acik');
    inerted.forEach(function (n) { n.inert = false; }); inerted = [];
    doc.removeEventListener('focusin', keepFocus);
    setTriggers(false);
    if (leaving !== true && opener && opener.isConnected && opener.focus) opener.focus();
    opener = null;
  }
  api.open = open; api.close = close; api.isOpen = isOpen;
})(this);

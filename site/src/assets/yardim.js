/* Mola Yardım: Mola'yı kullanan ve tanımak isteyen kafeler için hazır sorular ve cevaplar. Yapay zekâ yok, sunucu yok.
 * Sorular derlemede site/src/assets/yardim.json'dan buraya gömülür (scripts/site-yardim.ts; yalnız kitlesi "site" olanlar);
 * site.js bu dosyayı yalnız yardımcı ilk açılınca yükler. Arama packages/domain/yardim.ts ile aynıdır (programın "?"ı). Bu dosya hiçbir ağ isteği yapmaz, çerez ve tarayıcı deposu kullanmaz; yazılan soru
 * tarayıcıdan çıkmaz. Her şey DOM ile ve textContent ile çizilir (innerHTML yok, eval yok, kullanıcıdan düzenli ifade yok). */
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
   'hangi kac var yok acaba sey mola kafe kafemde kafemiz lutfen merhaba yardim acil').split(' ').forEach(function (w) { BOS[w] = true; });

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
  // One letter added, missing or wrong ("yazci", "odme"): still the same word.
  function oneEdit(a, b) {
    var la = a.length, lb = b.length, i = 0, j = 0, edits = 0;
    if (Math.abs(la - lb) > 1) return false;
    while (i < la && j < lb) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  }
  function wordScore(t, w, full) {
    if (t === w) return full;
    if (t.length >= 3 && w.indexOf(t) === 0) return full - 1; // still typing: "yaz" → "yazici"
    if (w.length >= 4 && t.indexOf(w) === 0) return full - 1; // with a suffix: "odemeyi" → "odeme"
    if (t.length >= 4 && w.length >= 5 && oneEdit(t, w)) return full - 1;
    return 0;
  }

  var index = null, byId = Object.create(null), topicName = Object.create(null);
  function build() {
    DATA.konular.forEach(function (k) { topicName[k.id] = k.ad; });
    index = DATA.sorular.map(function (q, order) {
      var phrases = [], kw = Object.create(null), qw = Object.create(null), aw = Object.create(null);
      byId[q.id] = q;
      // kw[w]: 2 when the word is a keyword on its own ("yazici"), 1 when it is part of one ("yazici calismiyor").
      q.anahtar.forEach(function (k) { var n = normalize(k); if (!n) return; phrases.push(n); meaningful(n.split(' ')).forEach(function (w) { kw[w] = Math.max(kw[w] || 0, n === w ? 2 : 1); }); });
      meaningful(words(q.soru)).forEach(function (w) { qw[w] = true; });
      flat(q.cevap).forEach(function (t) { meaningful(words(t)).forEach(function (w) { aw[w] = true; }); });
      return { q: q, order: order, phrases: phrases, kw: kw, kwList: Object.keys(kw), qw: Object.keys(qw), aw: aw };
    });
  }
  /** The best questions for what was typed, best first; [] when nothing fits. */
  function search(text, limit) {
    if (!index) build();
    var n = normalize(text), toks = meaningful(n ? n.split(' ') : []), padded = ' ' + n + ' ', found = [];
    if (!toks.length) return [];
    index.forEach(function (e) {
      var s = 0, hit = 0;
      e.phrases.forEach(function (p) {
        if (p === n) s += 12;
        else if (p.indexOf(' ') > 0 && padded.indexOf(' ' + p + ' ') >= 0) s += 6;
      });
      toks.forEach(function (t) {
        var best = 0;
        e.kwList.forEach(function (w) { best = Math.max(best, wordScore(t, w, e.kw[w] === 2 ? 6 : 5)); });
        e.qw.forEach(function (w) { best = Math.max(best, wordScore(t, w, 4)); });
        if (!best && e.aw[t]) best = 1;
        if (best) { hit++; s += best; }
      });
      if (hit && s >= 4) found.push({ id: e.q.id, soru: e.q.soru, score: s + (hit === toks.length ? 3 : 0), order: e.order });
    });
    found.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return found.slice(0, limit || 6);
  }
  function get(id) { if (!index) build(); return has.call(byId, id) ? byId[id] : null; }

  var api = root.MolaYardim = { normalize: normalize, search: search, get: get, data: DATA };
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
    var results = meaningful(words(text)).length ? search(text, 4) : [];
    if (!results.length) { say(text, notFoundBubble()); return; }
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
    // A link inside (Destek ve İletişim) closes the panel first: the page underneath is where it goes.
    panel.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a) close(true); });
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

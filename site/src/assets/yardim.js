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

  // ---- Panel ----
  var doc = root.document, NS = 'http://www.w3.org/2000/svg';
  var panel, backdrop, input, chips, bodyEl, answer, listTitle, list, notFound, searched, live;
  var opener = null, topic = null, selected = null, inerted = [], liveTimer = 0;

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
  function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function announce(text) { clearTimeout(liveTimer); liveTimer = setTimeout(function () { live.textContent = text; }, 450); }

  function create() {
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

    var box = el('div', { 'class': 'yardim-ara' });
    box.appendChild(el('label', { 'for': 'yardim-sorgu', 'class': 'visually-hidden' }, 'Sorunuzu yazın'));
    var glass = icon(['M21 21l-4.3-4.3', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z']);
    box.appendChild(glass);
    input = el('input', { id: 'yardim-sorgu', type: 'search', placeholder: 'Sorunuzu yazın…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '120', enterkeyhint: 'search', 'aria-controls': 'yardim-govde' });
    input.addEventListener('input', function () { topic = null; selected = null; render(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    box.appendChild(input);

    chips = el('div', { 'class': 'yardim-konular', role: 'group', 'aria-label': 'Konular' });
    DATA.konular.forEach(function (k) {
      var b = el('button', { type: 'button', 'class': 'yardim-konu', 'aria-pressed': 'false', 'data-konu': k.id }, k.ad);
      b.addEventListener('click', function () {
        topic = topic === k.id ? null : k.id; selected = null; input.value = '';
        render(); bodyEl.scrollTop = 0;
      });
      chips.appendChild(b);
    });

    bodyEl = el('div', { 'class': 'yardim-govde', id: 'yardim-govde' });
    live = el('p', { 'class': 'visually-hidden', 'aria-live': 'polite' });
    answer = el('article', { 'class': 'yardim-cevap', tabindex: '-1', 'aria-labelledby': 'yardim-cevap-baslik', hidden: '' });
    listTitle = el('h3', { 'class': 'yardim-liste-baslik', id: 'yardim-liste-baslik' });
    list = el('ul', { 'class': 'yardim-liste', 'aria-labelledby': 'yardim-liste-baslik' });
    notFound = el('div', { 'class': 'yardim-yok', hidden: '' });
    notFound.appendChild(el('p', { 'class': 'yardim-yok-baslik' }, 'Bunu bulamadım. Bize ulaşın:'));
    var ways = el('div', { 'class': 'yardim-yollar' });
    ways.appendChild(el('a', { 'class': 'btn btn-primary', href: '/iletisim/' }, 'Destek ve İletişim'));
    // The e-mail the site already shows in its footer (site.js may have put Mola Yönetim's over it); the phone stays hidden.
    var mail = doc.querySelector('.site-footer [data-iletisim="email"] a[href^="mailto:"]'), address = mail ? mail.getAttribute('href').slice(7) : '';
    if (/^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[a-z]{2,}$/i.test(address)) ways.appendChild(el('a', { 'class': 'btn btn-ghost yardim-eposta', href: 'mailto:' + address }, address));
    notFound.appendChild(ways);
    notFound.appendChild(el('p', null, 'Başka kelimelerle de deneyin. Mola’yı kullanıyorsanız programdan da yazabilirsiniz: Destek → Talepler.'));
    searched = el('p', { 'class': 'yardim-aranan' });
    notFound.appendChild(searched);
    bodyEl.appendChild(live); bodyEl.appendChild(answer); bodyEl.appendChild(notFound); bodyEl.appendChild(listTitle); bodyEl.appendChild(list);

    panel.appendChild(head); panel.appendChild(box); panel.appendChild(chips); panel.appendChild(bodyEl);
    panel.addEventListener('keydown', onKey);
    // A link inside (Destek ve İletişim) closes the panel first: the page underneath is where it goes.
    panel.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a) close(true); });
    doc.body.appendChild(backdrop); doc.body.appendChild(panel);
  }

  function questionButton(q, hint) {
    var li = el('li'), b = el('button', { type: 'button', 'class': 'yardim-soru' });
    b.appendChild(el('span', null, q.soru));
    if (hint) b.appendChild(el('small', null, hint));
    b.addEventListener('click', function () { selected = q.id; render(); bodyEl.scrollTop = 0; answer.focus(); });
    li.appendChild(b);
    return li;
  }
  function showAnswer(q) {
    empty(answer);
    answer.appendChild(el('span', { 'class': 'chip' }, topicName[q.konu] || ''));
    answer.appendChild(el('h3', { id: 'yardim-cevap-baslik' }, q.soru));
    q.cevap.forEach(function (b) {
      if (typeof b === 'string') { answer.appendChild(el('p', null, b)); return; }
      var ol = el('ol');
      b.forEach(function (step) { ol.appendChild(el('li', null, step)); });
      answer.appendChild(ol);
    });
    if (q.ilgili && q.ilgili.length) {
      var rel = el('div', { 'class': 'yardim-ilgili' });
      rel.appendChild(el('span', null, 'İlgili:'));
      q.ilgili.forEach(function (id) {
        var r = get(id); if (!r) return;
        var b = el('button', { type: 'button' }, r.soru);
        b.addEventListener('click', function () { selected = r.id; render(); bodyEl.scrollTop = 0; answer.focus(); });
        rel.appendChild(b);
      });
      answer.appendChild(rel);
    }
    answer.hidden = false;
  }
  function render() {
    var text = input.value, results = null, shown = selected ? get(selected) : null, items;
    answer.hidden = true; notFound.hidden = true; listTitle.hidden = false; empty(list);
    Array.prototype.forEach.call(chips.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-konu') === topic)); });
    if (meaningful(words(text)).length) {
      results = search(text, 7);
      if (!results.length) {
        searched.textContent = 'Aradığınız: “' + text.trim().slice(0, 120) + '”';
        notFound.hidden = false; listTitle.hidden = true;
        announce('Hazır cevap bulunamadı.');
        return;
      }
      if (!shown) shown = get(results[0].id);
      items = results.map(function (r) { return get(r.id); });
      listTitle.textContent = 'Başka sorular';
      announce(results.length === 1 ? 'Bir cevap bulundu.' : results.length + ' cevap bulundu.');
    } else if (topic) {
      items = DATA.sorular.filter(function (q) { return q.konu === topic; });
      listTitle.textContent = topicName[topic];
    } else {
      items = DATA.sikSorulanlar.map(get).filter(Boolean);
      listTitle.textContent = 'Sık sorulanlar';
    }
    if (shown) showAnswer(shown);
    items = items.filter(function (q) { return !shown || q.id !== shown.id; });
    items.forEach(function (q) { list.appendChild(questionButton(q, topic || results ? '' : topicName[q.konu])); });
    if (!items.length) listTitle.hidden = true;
  }

  // ---- Open, close, keyboard: Esc closes, Tab stays inside, focus goes back to the button that opened it ----
  function focusables() {
    return Array.prototype.filter.call(panel.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])'), function (n) {
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
    render();
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

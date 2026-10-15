/* Mola web sitesi: menü, kaydırınca beliren bölümler, sessiz videolar ve iletişim formu. Dış kaynak yok, çerez yok. */
(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Header: shadow once scrolled, menu on phones ----
  var header = document.querySelector('.site-header');
  var onScroll = function () { if (header) header.classList.toggle('scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  var toggle = document.querySelector('.menu-toggle'), nav = document.getElementById('site-nav');
  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Menüyü kapat' : 'Menüyü aç');
      toggle.querySelector('.i-open').hidden = open; toggle.querySelector('.i-close').hidden = !open;
    };
    toggle.addEventListener('click', function () { setOpen(toggle.getAttribute('aria-expanded') !== 'true'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && nav.classList.contains('open')) { setOpen(false); toggle.focus(); } });
    document.addEventListener('click', function (e) { if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
  }

  // ---- Reveal on scroll ----
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('seen'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add('seen'); });

  // ---- Videos: load only when near the screen, play while visible, a button to pause; the poster stays if a video cannot play ----
  var PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
  var videos = Array.prototype.slice.call(document.querySelectorAll('video[data-src]'));
  videos.forEach(function (v) {
    v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.loop = true;
    var holder = v.closest('.clip'), button = holder && holder.querySelector('.clip-toggle');
    v._userPaused = reduce; // with "reduce motion" nothing starts by itself
    var load = function () { if (!v.src) { v.src = v.getAttribute('data-src'); v.load(); } };
    var draw = function () { if (!button) return; var playing = !v.paused; button.innerHTML = playing ? PAUSE : PLAY; button.setAttribute('aria-label', playing ? 'Videoyu durdur' : 'Videoyu oynat'); };
    v._play = function () { load(); var p = v.play(); if (p && p.catch) p.catch(function () { draw(); }); };
    v.addEventListener('play', draw); v.addEventListener('pause', draw);
    v.addEventListener('error', function () { if (button) button.hidden = true; });
    if (button) { button.hidden = false; draw(); button.addEventListener('click', function () { if (v.paused) { v._userPaused = false; v._play(); } else { v._userPaused = true; v.pause(); } }); }
  });
  if ('IntersectionObserver' in window) {
    var vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting && e.intersectionRatio >= 0.35) { if (!v._userPaused) v._play(); }
        else if (!v.paused) v.pause();
      });
    }, { threshold: [0, 0.35, 0.7] });
    videos.forEach(function (v) { vio.observe(v); });
  }

  // ---- Mola ekibi iletişim bilgileri: what Mola Yönetim saved (GET /api/site/iletisim) over the build's own ----
  // Written as text; links only from a number's digits or a checked address. No answer: the build's own stays.
  var contactNodes = Array.prototype.slice.call(document.querySelectorAll('[data-iletisim]'));
  if (contactNodes.length && window.fetch) {
    var intl = function (v) { var d = String(v).replace(/\D/g, ''); return d.indexOf('90') === 0 ? d : d.indexOf('0') === 0 ? '9' + d : '90' + d; };
    var okPhone = function (v) { var d = intl(v); return d.length >= 11 && d.length <= 15; };
    var okMail = function (v) { return /^[^\s@<>"]{1,64}@[^\s@<>"]{1,180}\.[^\s@<>".]{2,}$/.test(v); };
    fetch('/api/site/iletisim', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var c = d && d.contact; if (!c) return;
        var links = {
          phone: c.phone && okPhone(c.phone) ? { href: 'tel:+' + intl(c.phone), text: c.phone } : null,
          whatsapp: c.whatsapp && okPhone(c.whatsapp) ? { href: 'https://wa.me/' + intl(c.whatsapp) + '?text=' + encodeURIComponent('Merhaba, Mola hakkında bilgi almak istiyorum.'), text: c.whatsapp } : null,
          email: c.email && okMail(c.email) ? { href: 'mailto:' + c.email, text: c.email } : null,
        };
        contactNodes.forEach(function (el) {
          var kind = el.getAttribute('data-iletisim');
          if (kind === 'hours') { if (typeof c.hours === 'string' && c.hours) el.textContent = c.hours; return; }
          var l = links[kind]; if (!l) return;
          if (el.classList.contains('contact-item')) {
            var a = el;
            // A "yakında" card becomes a link.
            if (el.tagName !== 'A') { a = document.createElement('a'); a.className = el.className.replace(/\s*\bpending\b/, ''); a.setAttribute('data-iletisim', kind); a.innerHTML = el.innerHTML; if (kind === 'whatsapp') a.rel = 'noopener'; el.parentNode.replaceChild(a, el); }
            // The phone and WhatsApp numbers stay behind the link (14 Ekim): the card keeps "Aramak için dokunun".
            a.href = l.href; var value = a.querySelector('span > span'); if (value) value.textContent = kind === 'email' ? l.text : kind === 'phone' ? 'Aramak için dokunun' : 'Yazmak için dokunun';
            return;
          }
          // The footer's lines and the e-mail links show the value; the WhatsApp button and line keep their words.
          var link = el.tagName === 'A' ? el : el.querySelector('a');
          if (link) { link.href = l.href; if (kind === 'email') link.textContent = l.text; else if (kind === 'phone' && el.tagName !== 'A') link.textContent = 'Telefon'; }
          el.hidden = false;
        });
      })['catch'](function () { /* the build's own contact stays */ });
  }

  // ---- Mola Yardım: hazır soru-cevaplar (assets/yardim.js). Yalnız ilk açılışta, bu sitenin kendi dosyası olarak yüklenir;
  // yardımcı hiçbir istek yapmaz, yazılan soru tarayıcıdan çıkmaz. Yüklenemezse Sık sorulan sorular açılır. ----
  var helpSrc = document.body.getAttribute('data-yardim') || '';
  var helpOpeners = document.querySelectorAll('[data-yardim-ac]');
  if (/^\/assets\/yardim\.js\?v=[0-9a-f]{6,20}$/.test(helpSrc) && helpOpeners.length) {
    var helpScript = null;
    var openHelp = function (from) {
      if (window.MolaYardim && window.MolaYardim.open) { window.MolaYardim.open(from); return; }
      if (helpScript) return;
      helpScript = document.createElement('script'); helpScript.src = helpSrc; helpScript.async = true;
      helpScript.onload = function () { if (window.MolaYardim && window.MolaYardim.open) window.MolaYardim.open(from); };
      helpScript.onerror = function () { helpScript.parentNode.removeChild(helpScript); helpScript = null; location.href = '/iletisim/#sss'; };
      document.head.appendChild(helpScript);
    };
    Array.prototype.forEach.call(helpOpeners, function (b) {
      if (b.tagName === 'BUTTON') { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'mola-yardim'); }
      b.hidden = false;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.MolaYardim && window.MolaYardim.isOpen && window.MolaYardim.isOpen()) window.MolaYardim.close(); else openHelp(b);
      });
    });
    // /iletisim/#yardim (Destek sayfasındaki kart, dışarıdan bir bağlantı): açık gelir.
    if (location.hash === '#yardim') openHelp(document.querySelector('#yardim [data-yardim-ac]') || helpOpeners[0]);
  }

  // ---- Contact form → Mola Merkez (same address: /api/site/*) ----
  var form = document.getElementById('talep-formu');
  if (!form) return;
  var status = document.getElementById('form-status'), submit = form.querySelector('button[type="submit"]');
  var token = '', tokenAt = 0, minMs = 4000;
  var getToken = function () {
    if (token && Date.now() - tokenAt < 5 * 3600 * 1000) return Promise.resolve(token);
    return fetch('/api/site/form', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('form'); return r.json(); })
      .then(function (d) { token = d.token; tokenAt = Date.now(); minMs = (d.minSeconds || 4) * 1000; return token; });
  };
  // The server takes a form only a few seconds after its key was given: a quick person waits that long here, quietly.
  var ready = function () { return getToken().then(function (t) { var wait = tokenAt + minMs + 400 - Date.now(); return new Promise(function (r) { setTimeout(function () { r(t); }, Math.max(0, wait)); }); }); };
  // Asked as soon as the person starts filling the form (the server counts the seconds from here).
  var started = false;
  form.addEventListener('focusin', function () { if (!started) { started = true; getToken().catch(function () { started = false; }); } });
  var fieldOf = function (name) { return form.querySelector('[data-field="' + name + '"]'); };
  var clearErrors = function () {
    form.querySelectorAll('.has-error').forEach(function (f) { f.classList.remove('has-error'); });
    form.querySelectorAll('[aria-invalid]').forEach(function (i) { i.removeAttribute('aria-invalid'); });
    status.className = 'form-status'; status.textContent = '';
  };
  var showError = function (name, message) {
    var f = fieldOf(name);
    if (f) {
      f.classList.add('has-error'); var e = f.querySelector('.error'); if (e) e.textContent = message;
      var input = f.querySelector('input, select, textarea'); if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    } else { status.className = 'form-status error'; status.textContent = message; status.focus(); }
  };
  form.addEventListener('input', function (e) { var f = e.target.closest('.has-error'); if (f) { f.classList.remove('has-error'); var i = f.querySelector('[aria-invalid]'); if (i) i.removeAttribute('aria-invalid'); } });
  form.addEventListener('submit', function (e) {
    e.preventDefault(); clearErrors();
    var data = new FormData(form);
    var body = {
      business: data.get('business'), person: data.get('person'), phone: data.get('phone'), email: data.get('email'),
      city: data.get('city'), type: data.get('type') || '', message: data.get('message') || undefined,
      consent: data.get('consent') === 'evet', consentVersion: form.getAttribute('data-consent-version'), website: data.get('website') || '',
    };
    // The browser's own checks first (required fields), in the same words as the server.
    if (!String(body.business || '').trim()) return showError('business', 'İşletmenizin adını yazın.');
    if (!String(body.person || '').trim()) return showError('person', 'Adınızı ve soyadınızı yazın.');
    if (!String(body.phone || '').trim()) return showError('phone', 'Telefon numaranızı yazın.');
    if (!String(body.email || '').trim()) return showError('email', 'E-posta adresinizi yazın.');
    if (!body.type) return showError('type', 'İşletme türünü seçin.');
    if (!body.consent) return showError('consent', 'Devam etmek için KVKK Aydınlatma Metni’ni okuduğunuzu onaylayın.');
    submit.disabled = true; var label = submit.innerHTML; submit.textContent = 'Gönderiliyor…';
    ready().then(function (t) {
      body.token = t;
      return fetch('/api/site/talep', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    }).then(function (res) {
      if (res.ok) {
        var done = document.getElementById('form-done'); form.hidden = true; done.hidden = false; done.focus();
        return;
      }
      if (res.d && res.d.code === 'FORM_EXPIRED') { token = ''; }
      showError(res.d && res.d.field || 'form', (res.d && res.d.message) || 'Gönderilemedi. Lütfen biraz sonra yeniden deneyin ya da bizi arayın.');
    }).catch(function () {
      showError('form', 'Bağlantı kurulamadı. İnternetinizi kontrol edip yeniden deneyin ya da bize telefon veya WhatsApp ile ulaşın.');
    }).then(function () { submit.disabled = false; submit.innerHTML = label; });
  });
})();

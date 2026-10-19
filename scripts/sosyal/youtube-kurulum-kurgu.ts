/*
 * YouTube 06 "Kurulum": a café owner installs Mola himself and starts the 30-day trial. 1920×1080 video, kapak.jpg and
 * aciklama.txt from the recordings of scripts/sosyal/youtube-kurulum-kayit.ts and the drawn Windows screens of
 * scripts/sosyal/youtube-kurulum-cizim.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts (as video 01).
 * No voice-over: captions and the background music of scripts/sosyal/muzik.py (cesit-3, soft breaks at the chapters).
 *
 *   npx tsx scripts/sosyal/youtube-kurulum-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-kurulum-kurgu.ts c1 w2        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-kurulum-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-kurulum-kurgu.ts --kapak      only the thumbnail and the description
 *   SOSYAL_CIKTI=<klasör> …                                       another output folder
 *
 * The owner's rules (18 Ekim): the logo opening, then "Kurulum"; no pointer: an ordinary tap is a soft ripple only; a red
 * outline and a slight 1.2× move at most once per step, only where something is hard to find; one subject at a time, a linear
 * story, waits cut silently (no speed notes); a label at the top right with the side and "Adım n / 10"; the waiter's screen
 * on a tablet; the closing card with molayazilim.com.tr and "30 gün ücretsiz deneme". The recovery code is blurred.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { C, H, ROOT, W, base, chapters, cutLeads, dirs, endCard, focusKeys, frameFile, img, introCard, mark, marks, meta, outlinesOf, around, shootThumb, staffScene, THUMB_TONES, toneBg, stepped, tapMarks, taps, uret, yer, type Blur, type Cam, type Caption, type CaptionsOf, type Scene } from './youtube-sahne';
import { EX, FOLDER_ROWS, ZIP_ROW, contextMenu, drawn, explorer, extractDialog, installer, smartScreen, uac, windowsCss, type Piece } from './youtube-kurulum-cizim';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'kurulum', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'kurulum', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '06 Kurulum')) });
const STEPS = 10;
const side = (who: string) => `${who} <b>· Adım {adim} / ${STEPS}</b>`;

// ---------- The Mola window (the café computer: Edge's app window, as Mola.exe opens it) ----------
const VIEW_W = 1376, VIEW_H = 774, BAR = 40;
/** Window frame at normal size (centred, under the label), and the same window filling the stage. */
const FRAMED = { x: W / 2, y: 104 + (VIEW_H + BAR) / 2, s: 1 };
const FULL = { x: W / 2, y: -BAR * (W / VIEW_W) + (VIEW_H + BAR) * (W / VIEW_W) / 2, s: W / VIEW_W };
/**
 * The Mola window full screen (the window's own bar just above the picture), captions over the bottom. `opening`: it first
 * stands as a window, then grows to fill the stage. The camera moves (1.2×) only for a control marked "!".
 */
function molaScene(name: string, clip: string, from: number, to: number, names: string[], captions: CaptionsOf, o: { step: number; toc?: string; opening?: number; gaps?: [number, number][]; blurs?: (at: (c: number) => number) => Blur[] }): Scene {
  const size = meta(clip).size;
  const { map, at, d } = cutLeads(clip, from, to, names, o.gaps), { ripples, focuses } = tapMarks(clip, names, at, d);
  const cam = focusKeys<Cam>({ x: 0, y: 0, w: size.width }, focuses, f => around(f.box, size.width / 1.2, 16 / 9, size.width, size.height));
  const keys = o.opening !== undefined ? [{ t: 0, ...FRAMED }, { t: o.opening, ...FRAMED }, { t: o.opening + .9, ...FULL }] : [{ t: 0, ...FULL }];
  return { name, duration: d, capPos: 'overlay', tag: side('Mola penceresi'), side: 'business', toc: o.toc, captions: stepped(o.step, captions(at, d)),
    layers: [{ kind: 'screen', clip, w: VIEW_W, h: VIEW_H, keys, map, cam, rings: [...ripples, ...outlinesOf(focuses)], frame: 'win', title: 'Mola · İşletme yönetimi', blurs: o.blurs?.(at) }] };
}
/** A staff device: the waiter's tablet or the kitchen screen. */
function deviceScene(name: string, clip: string, from: number, to: number, o: { frame: 'tablet' | 'display'; who: string; step: number; taps?: string[]; gaps?: [number, number][]; toc?: string }, captions: CaptionsOf): Scene {
  const s = staffScene(name, clip, from, to, { frame: o.frame, tag: side(o.who), taps: o.taps, gaps: o.gaps }, (at, d) => stepped(o.step, captions(at, d)), o.toc);
  return s;
}
/** A plain card between two parts ("Onaylandıktan sonra"). */
function card(name: string, title: string, line: string, d = 3.6): Scene {
  return { name, duration: d, card: `<div class="pass"><h2 class="serif">${title}</h2><p>${line}</p></div>`,
    css: `.pass{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${C.cup}}.pass h2{font-weight:400;font-size:96px;letter-spacing:-.02em}.pass p{margin-top:28px;font:400 34px/1.35 'Segoe UI',system-ui,sans-serif;color:rgba(243,235,221,.8)}` };
}

// ---------- Drawn Windows scenes ----------
const EXW = { x: 280, y: 122, w: 1360, h: 740 };
function downloadsScene(): Scene {
  const at = { title: 'İndirilenler', path: ['Bu bilgisayar', 'İndirilenler'], rows: [ZIP_ROW], group: 'Bugün' };
  const ex = explorer({ ...EXW, ...at }), selected = ex.replace('class="ex-row"', 'class="ex-row sel"');
  const rowY = EX.rowsTop(EXW.y), mx = EXW.x + 640, my = rowY + 34;
  const folder = explorer({ x: EXW.x + 60, y: EXW.y + 40, w: EXW.w - 60, h: EXW.h - 40, title: 'Mola-Windows-0.1.34', path: ['Bu bilgisayar', 'İndirilenler', 'Mola-Windows-0.1.34'], rows: FOLDER_ROWS });
  const T = { sel: 1.0, menu: 2.3, hl: 2.7, pick: 5.4, dlg: 6.0, ok: 9.6, prog: 9.9, done: 12.4, end: 17.5 };
  // A later piece lies on top: a window that changes keeps its old look until the new one is fully there.
  const pieces: Piece[] = [
    { html: ex, from: 0, to: T.sel + .3 },
    { html: selected, from: T.sel - .1, to: T.done + .3 },
    { html: contextMenu(mx, my), from: T.menu, to: T.hl + .3 },
    { html: contextMenu(mx, my, 1), from: T.hl, to: T.pick + .25 },
    { html: extractDialog(510, 250, false), from: T.dlg, to: T.prog + .3 },
    { html: extractDialog(510, 250, true), from: T.prog, to: T.done + .1 },
    { html: folder, from: T.done, to: 99 },
  ];
  const pct = Array.from({ length: 11 }, (_, i) => [T.prog + i * .22, `%${i * 10}`] as [number, string]);
  return { name: 'w1-ayikla', duration: T.end, capPos: 'bottom', tag: side('Windows'), side: 'business', css: windowsCss, marks: [],
    html: drawn({ pieces, texts: [{ id: 'exPct', at: pct }],
      rings: [{ piece: 0, sel: '.ex-name b', kind: 'ripple', at: T.sel - .1 }, { piece: 1, sel: '.ex-date', kind: 'ripple', at: T.menu - .15 },
        { piece: 3, sel: '.menu span:nth-of-type(2)', kind: 'outline', from: T.hl, tap: T.pick }, { piece: 4, sel: '.btn-w.pri', kind: 'ripple', at: T.ok }],
      zoom: [{ piece: 3, sel: '.menu span:nth-of-type(2)', from: T.hl - .2, to: T.pick + .5 }],
      extra: `const bar = document.getElementById('exBar'); if (bar) bar.style.width = Math.max(0, Math.min(100, (t - ${T.prog}) / 2.2 * 100)) + '%';` }),
    captions: stepped(2, [
      { from: .3, to: T.menu - .1, text: 'İndirilen dosya İndirilenler klasöründedir.' },
      { from: T.menu, to: T.dlg - .1, text: 'Dosyaya sağ tıklayın: “Tümünü ayıkla…”.' },
      { from: T.dlg, to: T.done - .1, text: '“Ayıkla”: dosyalar aynı adlı bir klasöre çıkar.' },
      { from: T.done, to: 99, text: 'Klasörde “Mola Kurulum”, BENIOKU ve “program” vardır.' },
    ]) };
}
function installScene(): Scene {
  const folder = explorer({ x: EXW.x + 60, y: EXW.y + 40, w: EXW.w - 60, h: EXW.h - 40, title: 'Mola-Windows-0.1.34', path: ['Bu bilgisayar', 'İndirilenler', 'Mola-Windows-0.1.34'], rows: FOLDER_ROWS });
  const sx = 550, sy = 190, ix = 528, iy = 200, ux = 580, uy = 250;
  const T = { dbl: 1.6, ss: 2.5, ek: 3.6, more: 6.2, run: 7.7, inst: 8.4, kur: 11.0, busy: 11.2, uac: 15.4, evet: 18.2, done: 19.2, open: 23.2, end: 24.6 };
  const status: [number, string][] = [[T.busy, 'Dosyalar kopyalanıyor… %4'], ...Array.from({ length: 9 }, (_, i) => [T.busy + .35 + i * .3, `Dosyalar kopyalanıyor… %${12 + i * 11}`] as [number, string]),
    [T.busy + 3.2, 'Windows\'a kaydediliyor…'], [T.busy + 3.6, 'Simgeler ekleniyor…'], [T.uac - .2, 'Güvenlik duvarı izni için Windows onay istiyor…'], [T.evet + .3, 'Mola başlatılıyor…']];
  const pieces: Piece[] = [
    { html: folder, from: 0, to: T.open + .3 },
    { html: smartScreen(sx, sy, false), from: T.ss, to: T.more + .3 },
    { html: smartScreen(sx, sy, true), from: T.more, to: T.run + .2 },
    { html: installer(ix, iy, 'start'), from: T.inst, to: T.busy + .3 },
    { html: installer(ix, iy, 'busy'), from: T.busy, to: T.done + .3 },
    { html: uac(ux, uy), from: T.uac, to: T.evet + .3 },
    { html: installer(ix, iy, 'done'), from: T.done, to: T.open + .4 },
  ];
  return { name: 'w2-kur', duration: T.end, capPos: 'bottom', tag: side('Windows'), side: 'business', css: windowsCss, marks: [],
    html: drawn({ pieces, texts: [{ id: 'instStatus', at: status }],
      rings: [{ piece: 0, sel: '[data-name="Mola Kurulum"] .ex-name b', kind: 'ripple', at: T.dbl }, { piece: 0, sel: '[data-name="Mola Kurulum"] .ex-name b', kind: 'ripple', at: T.dbl + .28 },
        { piece: 1, sel: 'u', kind: 'outline', from: T.ek, tap: T.more - .25 }, { piece: 2, sel: '.btns span', kind: 'ripple', at: T.run - .3 },
        { piece: 3, sel: '.b.pri', kind: 'ripple', at: T.kur }, { piece: 5, sel: '.btns .pri', kind: 'ripple', at: T.evet }, { piece: 6, sel: '.b.pri', kind: 'ripple', at: T.open }],
      zoom: [{ piece: 1, sel: 'u', from: T.ek - .1, to: T.more + .3 }] }),
    captions: stepped(3, [
      { from: .3, to: T.ss - .1, text: '“Mola Kurulum”a çift tıklayın.' },
      { from: T.ss, to: T.more - .1, text: 'Windows “Bilgisayarınız korundu” derse “Ek bilgi”ye tıklayın.' },
      { from: T.more, to: T.inst - .1, text: 'Sonra “Yine de çalıştır”.' },
      { from: T.inst, to: T.busy + .5, text: 'Kurulum penceresinde “Kur”a basın. İnternet gerekmez.' },
      { from: T.busy + .5, to: T.uac - .1, text: 'Mola kurulur; masaüstüne Mola simgesi eklenir.' },
      { from: T.uac, to: T.done - .1, text: 'Windows bir kez izin sorar: “Evet”. Tabletler bu izinle bağlanır.' },
      { from: T.done, to: 99, text: '“Mola’yı aç”. Sonra hep masaüstündeki simgeyle açın.' },
    ]) };
}

// ---------- The story ----------
function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Kurulum', 'Mola’yı indirin, kurun ve 30 günlük denemeyi başlatın.'), toc: 'İndirme ve kurulum' });

  // ===== 1. The site =====
  const S = marks('k1-site'), St = taps('k1-site');
  {
    const names = ['nav', 'download'], { map, at, d } = cutLeads('k1-site', .3, St.download.tap! + 1.5, names), { ripples } = tapMarks('k1-site', names, at, d);
    const vw = 1300, vh = vw * 720 / 1280;
    list.push({ name: 'a1-site', duration: d, capPos: 'bottom', tag: side('İnternet sitesi'), side: 'business',
      captions: stepped(1, [
        { from: .2, to: at(St.nav.on), text: 'molayazilim.com.tr adresini açın.' },
        { from: at(St.nav.on), to: at(S.card), text: '“Uygulamayı indir” sayfasına geçin.' },
        { from: at(S.card), to: 99, text: 'Windows 10 / 11 kartında “İndir”e basın.' },
      ]),
      layers: [{ kind: 'screen', clip: 'k1-site', w: vw, h: vh, keys: [{ t: 0, x: W / 2, y: 104 + (vh + 92) / 2 }], map, cam: [{ t: 0, x: 0, y: 0, w: 1280 }], rings: ripples, frame: 'browser',
        title: 'Mola', titles: [[0, 'molayazilim.com.tr', 'Mola · Kafe ve restoranlar için adisyon ve QR menü'], [at(S.indir) - .05, 'molayazilim.com.tr/indir/', 'Uygulamayı indir · Mola']] }] });
  }
  // ===== 2–3. Windows (drawn) =====
  list.push(downloadsScene());
  list.push(installScene());

  // ===== 4. Mola'yı etkinleştir: the application =====
  // The recovery code's look was also called "code" in the first recordings: the second one is "rcode".
  { const named = (meta('k2-etkin').taps ?? []).filter(t => t.name === 'code'); if (named.length > 1) named[1].name = 'rcode'; }
  const A = marks('k2-etkin'), At = taps('k2-etkin');
  // The middle of the invoice fields is cut (vergi numarası, il, ilçe appear filled): the form stays short.
  const form = ['apply', 'f-name', 'f-sector', 'f-legal', 'f-office', 'f-address', 'f-contact', 'f-phone', 'f-email', 'consent', 'agree', 'send'];
  // The first frame held a moment (from < 0): the window stands, then fills the stage.
  list.push(molaScene('c1-basvuru', 'k2-etkin', -1.3, A.waiting + 4.2, ['!code', ...form], at => [
    { from: .3, to: at(At.code.on), text: 'Mola kendi penceresinde açılır: “Mola’yı etkinleştir”.' },
    { from: at(At.code.on), to: at(At.apply.on), text: 'Mola ekibinden kod aldıysanız bu seçeneği kullanın.' },
    { from: at(At.apply.on), to: at(At['f-name'].on), text: 'Yeni başlıyorsanız “Kodum yok, başvuru yapacağım”.' },
    { from: at(At['f-name'].on), to: at(At['f-legal'].on), text: 'Hesap açma başvurusu: işletme adı ve türü.' },
    { from: at(At['f-legal'].on), to: at(At['f-contact'].on), text: 'Fatura bilgileri: unvan, vergi dairesi ve numarası, adres.' },
    { from: at(At['f-contact'].on), to: at(At.consent.on), text: 'Yetkili kişi, cep telefonu ve e-posta.' },
    { from: at(At.consent.on), to: at(At.send.on), text: 'Bilgilendirme ve lisans sözleşmesi kutularını işaretleyin.' },
    { from: at(At.send.on), to: at(A.waiting), text: '“Başvuruyu gönder”.' },
    { from: at(A.waiting), to: 99, text: 'Başvuru Mola ekibine ulaşır; onay beklenir.' },
  ], { step: 4, toc: 'Başvuru ve onay', opening: 2.5, gaps: [[At['f-office'].tap! + .7, At['f-address'].tap! - .05]] }));
  list.push(card('c2-onay', 'Onaylandıktan sonra', 'Mola ekibi başvuruyu kontrol eder; onaylanınca 30 günlük deneme başlar.', 4));

  // ===== 5. The owner account and the recovery code =====
  const codeBox = At.rcode?.box;
  const g0 = At.g0, g1 = At.g1;
  list.push(molaScene('c3-sahip', 'k2-etkin', A.owner - .4, A.wizard - .2, ['o-user', 'o-name', 'o-pass', 'o-pass2', 'create', 'saved', 'g0', 'g1', 'confirm'], at => [
    { from: .2, to: at(At['o-user'].on), text: 'Onay gelince ekran kendiliğinden işletme sahibi hesabına geçer.' },
    { from: at(At['o-user'].on), to: at(At.create.on), text: 'Kullanıcı adınızı ve en az 10 karakterlik şifrenizi belirleyin.' },
    { from: at(At.create.on), to: at(A.recovery), text: '“Hesabı oluştur”.' },
    { from: at(A.recovery), to: at(At.saved.on), text: 'Kurtarma kodunu kâğıda yazıp ya da yazdırıp saklayın.' },
    { from: at(At.saved.on), to: 99, text: '“Kaydettim”: kodun istenen iki parçasını yazıp onaylayın.' },
  // After "Hesabı oluştur" the window shows the sign-in page for one frame before the wizard: that frame is cut.
  ], { step: 5, toc: 'Sahip hesabı ve ilk kurulum', gaps: [[At.create.tap! + .1, At.create.tap! + .4]],
    blurs: at => [
      ...(codeBox ? [{ box: { x: codeBox.x + 4, y: codeBox.y + 4, width: codeBox.width - 8, height: codeBox.height - 8 }, from: at(A.recovery) - .02, to: at(At.saved.tap!) + .6 }] : []),
      ...[g0, g1].filter(Boolean).map(g => ({ box: { x: g.box.x + 2, y: g.box.y + 2, width: g.box.width - 4, height: g.box.height - 4 }, from: at(g.tap!) + .1, to: at(At.confirm.tap!) + .8 })),
    ] }));

  // ===== 6. The setup wizard, the starter menu and a price =====
  list.push(molaScene('c4-sihirbaz', 'k2-etkin', A.wizard - .1, A.end - .1, ['sector', 'next1', 'count', 'next2', 'next3', 'save'], at => [
    { from: .2, to: at(At.sector.on), text: 'Kurulum sihirbazı: dört kısa adım.' },
    { from: at(At.sector.on), to: at(A.tables), text: 'İşletme türünü seçin; başlangıç menüsü buna göre hazırlanır.' },
    { from: at(A.tables), to: at(A.rules), text: 'Masa sayısını yazın; her masaya bir QR kodu hazırlanır.' },
    { from: at(A.rules), to: at(A.summary), text: 'Sipariş ve ödeme tercihleri; hepsi sonra Ayarlar’dan değişir.' },
    { from: at(A.summary), to: at(A.masalar), text: 'Kontrol edip “Kurulumu kaydet”.' },
    { from: at(A.masalar), to: 99, text: 'Masalar açılır. Mola kullanıma hazır.' },
  ], { step: 6 }));
  const M = marks('k3-menu'), Mt = taps('k3-menu');
  list.push(molaScene('c5-menu', 'k3-menu', .2, M.end - .2, ['steps', 'menu', 'edit', '!price', 'save'], at => [
    { from: .2, to: at(Mt.menu.on), text: '“İlk adımlar” kalan işleri gösterir: menü, çalışan, yazıcı, QR kodları.' },
    { from: at(Mt.menu.on), to: at(Mt.edit.on), text: 'Başlangıç menüsü ürün fotoğraflarıyla hazırdır.' },
    { from: at(Mt.edit.on), to: at(Mt.price.on), text: 'Fiyat değiştirmek için ürünün “Düzenle” düğmesi.' },
    { from: at(Mt.price.on), to: at(Mt.save.on), text: 'Yeni fiyatı yazın.' },
    { from: at(Mt.save.on), to: 99, text: '“Kaydet ve yayınla”: yeni fiyat menüde görünür.' },
  ], { step: 6 }));

  // ===== 7. The waiter's account and tablet =====
  const P = marks('k4-personel'), Pt = taps('k4-personel');
  list.push(molaScene('d1-personel', 'k4-personel', .2, P.end - .2, ['steps', 'open', 'add', 'name', 'pass', 'create'], at => [
    { from: .2, to: at(Pt.add.on), text: 'İlk adımlar → “Hesap aç”: Personel ekranı.' },
    { from: at(Pt.add.on), to: at(Pt.role.on), text: '“Çalışan ekle”: kullanıcı adı ad soyaddan oluşur.' },
    { from: at(Pt.role.on), to: at(Pt.pass.on), text: 'Görevi: Garson.' },
    { from: at(Pt.pass.on), to: at(Pt.create.on), text: 'Garsonun şifresini belirleyin.' },
    { from: at(Pt.create.on), to: 99, text: 'Garson hesabı hazır. Mutfak hesabı da buradan açılır.' },
  ], { step: 7, toc: 'Garson tableti' }));
  const D = marks('k5-cihaz'), Dt = taps('k5-cihaz');
  list.push(molaScene('d2-cihaz', 'k5-cihaz', .2, D.end - .2, ['!rail'], at => [
    { from: .2, to: at(D.qr), text: 'Mola penceresinin solunda “Kafe içi cihazlar”.' },
    { from: at(D.qr), to: 99, text: 'Tabletin kamerasıyla bu QR kodunu okutun. Tablet aynı Wi-Fi’de olmalı.' },
  ], { step: 7 }));
  void Dt;
  list.push(deviceScene('d3-uygulama', 'k5-uygulama', .2, 7.4, { frame: 'tablet', who: 'Garson tableti', step: 7 }, () => [
    { from: .2, to: 3.8, text: 'Tablette Mola’yı kurma sayfası açılır.' },
    { from: 3.8, to: 99, text: 'Android’de uygulama indirilir; iPad’de Safari’den ana ekrana eklenir.' },
  ]));
  const L = marks('k5-giris'), Lt = taps('k5-giris');
  list.push(deviceScene('d4-giris', 'k5-giris', .3, L.end - .2, { frame: 'tablet', who: 'Garson tableti', step: 7, taps: ['user', 'pass', 'open', 'sound'] }, at => [
    { from: .2, to: at(L.in), text: 'Mola açılınca garson kendi kullanıcı adı ve şifresiyle girer.' },
    { from: at(L.in), to: 99, text: 'Garson tableti hazır: masalar ve siparişler burada.' },
  ]));
  void Lt;

  // ===== 8. The printer =====
  const Y = marks('k6-yazici'), Yt = taps('k6-yazici');
  list.push(molaScene('e1-yazici', 'k6-yazici', .2, Y.end - .2, ['ayarlar', 'topic', 'part', 'add', 'name', '!ip', 'width', 'orders', 'save'], at => [
    { from: .2, to: at(Yt.add.on), text: 'Ayarlar → Cihazlar → Yazıcılar.' },
    { from: at(Yt.add.on), to: at(Yt.name.on), text: '“Yazıcı ekle”.' },
    { from: at(Yt.name.on), to: at(Yt.ip.on), text: 'Adını yazın, bağlantıyı seçin: ağ ya da USB.' },
    { from: at(Yt.ip.on), to: at(Yt.width.on), text: 'Ağ yazıcısının IP adresi, yazıcının ayar fişinde yazar.' },
    { from: at(Yt.width.on), to: at(Yt.save.on), text: 'Kâğıt genişliğini ve yazıcının ne basacağını seçin.' },
    { from: at(Yt.save.on), to: 99, text: '“Kaydet”: yazıcı listeye eklenir; “Deneme fişi” ile denenir.' },
  ], { step: 8, toc: 'Yazıcı' }));

  // ===== 9. The first order =====
  const G = marks('k7-garson'), Gt = taps('k7-garson');
  const gNames = ['table', 'add', 'p0', 'p0add', 'p1', 'p1add', 'cart', 'send'].filter(n => Gt[n]);
  list.push(deviceScene('f1-garson', 'k7-garson', .3, G.sent + 2.4, { frame: 'tablet', who: 'Garson tableti', step: 9, taps: gNames, toc: 'İlk sipariş' }, at => [
    { from: .2, to: at(Gt.p0.on), text: 'Garson masayı seçer.' },
    { from: at(Gt.p0.on), to: at(Gt.send.on), text: 'Ürünleri ekler.' },
    { from: at(Gt.send.on), to: 99, text: 'Siparişi gönderir.' },
  ]));
  const K = marks('k7-mutfak'), Kt = taps('k7-mutfak');
  const kNames = ['start', 'ready'].filter(n => Kt[n]);
  list.push(deviceScene('f2-mutfak', 'k7-mutfak', K.ticket - 1, (Kt.ready?.tap ?? Kt.start?.tap ?? K.ticket + 3) + 1.6, { frame: 'display', who: 'Mutfak ekranı', step: 9, taps: kNames }, at => [
    { from: .2, to: Kt.start ? at(Kt.start.on) : 99, text: 'Sipariş mutfak ekranına düşer.' },
    ...(Kt.start ? [{ from: at(Kt.start.on), to: 99, text: 'Mutfak hazırlar ve hazır olduğunu işaretler.' }] : []),
  ]));
  const Q = marks('k7-kasa'), Qt = taps('k7-kasa');
  const qNames = ['cash', 'cashSave', 'table', 'pay', 'cashMethod', 'confirm'].filter(n => Qt[n]);
  list.push(molaScene('f3-kasa', 'k7-kasa', .2, Q.end - .2, qNames, at => [
    ...(Qt.cash ? [{ from: .2, to: at(Qt.table.on), text: 'Günün başında kasadaki nakdi yazıp kasayı açın.' }] : []),
    { from: Qt.cash ? at(Qt.table.on) : .2, to: at(Qt.cashMethod.on), text: 'Kasada masayı açın: “Ödeme al”.' },
    { from: at(Qt.cashMethod.on), to: at(Q.paid), text: 'Ödeme şeklini seçip “Ödemeyi kaydet”.' },
    { from: at(Q.paid), to: 99, text: 'Ödeme alındı; masa boşalır.' },
  ], { step: 9 }));

  // ===== 10. Paketiniz =====
  const Kp = marks('k8-paket'), Kpt = taps('k8-paket');
  list.push(molaScene('g1-paket', 'k8-paket', .2, Kp.end - .2, ['ayarlar', 'topic', 'part', '!status'], at => [
    { from: .2, to: at(Kp.page), text: 'Ayarlar → İşletme → Paket ve lisans.' },
    { from: at(Kp.page), to: at(Kpt.status.off!) + .2, text: 'Deneme süresi ve kalan gün burada görünür.' },
    { from: at(Kpt.status.off!) + .2, to: 99, text: 'Siparişlerinizin ne kadarını müşterileriniz QR ile veriyor? 30 günde görün.' },
  ], { step: 10, toc: 'Paket ve deneme süresi' }));
  list.push({ name: 'h0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'Mola kurulumu: indirin, kurun, 30 günlük denemeyi başlatın';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda bir kafenin Mola adisyon ve QR menü sistemini kendi bilgisayarına nasıl kurduğu adım adım gösteriliyor. Mola ekranları uygulamanın kendisinden, örnek bir işletmeyle kaydedildi; Windows pencereleri sadeleştirilmiş çizimdir.

Adımlar:
1. molayazilim.com.tr → Uygulamayı indir → Windows 10 / 11.
2. İndirilen ZIP dosyası: sağ tık → Tümünü ayıkla.
3. “Mola Kurulum” → Kur. Windows uyarı verirse: Ek bilgi → Yine de çalıştır. Güvenlik duvarı izni için Windows bir kez onay sorar.
4. Mola’yı etkinleştir → Hesap açma başvurusu. Mola ekibinden kod aldıysanız “Etkinleştirme kodum var”.
5. Onaydan sonra işletme sahibi hesabı ve kurtarma kodu.
6. Kurulum sihirbazı: işletme türü, masalar, çalışma kuralları; başlangıç menüsü ve fiyat değiştirme.
7. Çalışan ekleme ve garson tableti: Kafe içi cihazlar → QR kodu.
8. Yazıcı: Ayarlar → Cihazlar → Yazıcılar.
9. İlk sipariş: garson tableti, mutfak ekranı, kasada ödeme.
10. Ayarlar → İşletme → Paket ve lisans: deneme süresi ve kalan gün.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
Mola kurulum, adisyon programı kurulumu, kafe adisyon, restoran adisyon, kafe yazılımı, QR menü, QR sipariş, garson tableti, mutfak ekranı, fiş yazıcısı, Windows adisyon programı, ücretsiz deneme, Mola, Mola adisyon, Elazığ
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
function thumbHtml() {
  const shot = join(dirs.work, 'kapak-masalar.png');
  return base(1280, 720, `
  <div class="left"><h1 class="serif">Kurulum</h1><p>İndirin, kurun,<br>30 günlük denemeyi başlatın.</p>
    <div class="brand">${mark(60)}<span class="serif">mola<i>.</i></span></div></div>
  <div class="win"><div class="bar">${mark(18)}<em>Mola</em></div><img src="${img(shot)}"></div>
  <div class="steps"><span>1 İndir</span><span>2 Kur</span><span>3 Başvur</span></div>`, `
  body{background:${toneBg(THUMB_TONES.kurulum)};color:${C.cup}}
  .left{position:absolute;left:64px;top:0;bottom:0;width:560px;display:flex;flex-direction:column;justify-content:center}
  h1{font-weight:400;font-size:132px;line-height:1;letter-spacing:-.03em}
  .left p{margin-top:22px;font:600 34px/1.25 'Segoe UI',system-ui,sans-serif;color:rgba(243,235,221,.9)}
  .brand{display:flex;align-items:center;gap:16px;margin-top:40px;font-size:48px}.brand svg{border-radius:14px;box-shadow:0 0 0 2px rgba(243,235,221,.3)}.brand i{font-style:normal;color:${C.dot}}
  .win{position:absolute;left:640px;top:96px;width:600px;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 40px 80px -20px rgba(0,0,0,.55);transform:rotate(-2deg)}
  .win .bar{display:flex;align-items:center;gap:10px;height:34px;padding-left:14px;background:#f3f3f3;color:#222;font:400 15px 'Segoe UI',sans-serif}.win .bar svg{border-radius:4px}.win em{font-style:normal}
  .win img{display:block;width:100%}
  .steps{position:absolute;left:690px;top:520px;display:flex;gap:14px;transform:rotate(-2deg)}
  .steps span{padding:14px 22px;border-radius:999px;background:${C.cup};color:${C.green900};font:700 26px/1 'Segoe UI',sans-serif;box-shadow:0 18px 36px -14px rgba(0,0,0,.5)}`);
}
async function thumbnail(browser: Browser) {
  // The first Masalar of the new business (after the setup wizard).
  await sharp(frameFile('k2-etkin', marks('k2-etkin').end - .1)).resize(1200).png().toFile(join(dirs.work, 'kapak-masalar.png'));
  await shootThumb(browser, thumbHtml());
}

await uret({ mp4: 'Kurulum.mp4', music: 'cesit-3', description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
export { H };

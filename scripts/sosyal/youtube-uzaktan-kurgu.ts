/*
 * YouTube 05 "Uzaktan erişim ve güvenlik" (introduction series, the last one): the 1920×1080 video, kapak.jpg and aciklama.txt
 * from the recordings of scripts/sosyal/youtube-uzaktan-kayit.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts. No
 * voice-over: captions and the music of scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-uzaktan-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-uzaktan-kurgu.ts b1 d3        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-uzaktan-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-uzaktan-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-26 npx tsx scripts/sosyal/youtube-uzaktan-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                  join run again); default cesit-28 (Fa majör, 108 tempo, IV–V–I–vi)
 *   SOSYAL_CIKTI=<klasör> …                                       another output folder
 *
 * One linear story for an owner who weighs Mola, as videos 01–04, 3–5 minutes: Ayarlar → Uzaktan erişim set up on the café
 * computer (full screen; "Aç" of Uzaktan yönetim outlined), the owner's iPhone at home (İşletmemi yönet: sign-in with the phone
 * code, the café's own screens, Raporlar), a price changed from home and seen on a guest's menu, the café's internet cut (the
 * phone's "Bağlantı koptu" and last state, the waiter's tablet still working) with ONE split (kasa reachable / not), the
 * internet back and Çıkış; then on the café computer the login notification, Eşleşmiş cihazlar (a device removed), Açık
 * oturumlar (a lost tablet), Kafe içi cihazlar, Güvenlik ve yedek (Şimdi yedekle, the rail's Güvenlik) and Mola desteği (the
 * owner's permission). Every secret (the authenticator QR, the codes, the kurtarma kodları, the backup folder's path) is
 * blurred. The owner's rules (18–19 Ekim): logo opening then title; one device at a time, normal size, steady; no pointer: an
 * ordinary tap is a soft ripple; a red outline and a slight 1.2× move at most once per step, only where something small must
 * be found; a label at the top right with "· Adım n / 9"; short plain captions; "30 gün ücretsiz deneme" on the closing card only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { C, ROOT, chapters, cutLeads, dirs, endCard, fmt, guestScene, holdEnd, holdStart, introCard, introThumb, THUMB_TONES, marks, meta, ownerScene, shootThumb, splitScene, staffScene, stepped, tapMarks, taps, uret, yer, type Blur, type Box, type CaptionsOf, type Layer, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'uzaktan', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'uzaktan', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '05 Uzaktan erişim ve güvenlik')) });
const STEPS = 9, MUSIC = process.env.MUZIK ?? 'cesit-28';
const PC = `İşletme sahibi · Kasa bilgisayarı <b>· Adım {adim} / ${STEPS}</b>`, TEL = `İşletme sahibi · Telefon <b>· Adım {adim} / ${STEPS}</b>`;
const info = () => JSON.parse(readFileSync(join(dirs.rec, 'bilgi.json'), 'utf8')) as Record<string, unknown>;
type Opts = { taps?: string[]; gaps?: [number, number][]; toc?: string };

/** Every recorded tap of a clip (ordinary: a ripple); `outlined` ones get the red outline and the slight move. */
const clicks = (clip: string, ...outlined: string[]) => Object.values(taps(clip)).filter(t => t.tap !== undefined).map(t => outlined.includes(t.name) ? `!${t.name}` : t.name);
/** Blurs over a screen scene's only layer (secrets: boxes in the clip's CSS px, [from, to] in clip time). */
function blurred(scene: Scene, clip: string, list: [string, number, number][], at: (c: number) => number): Scene {
  const boxes = meta(clip).boxes ?? {};
  const blurs: Blur[] = list.flatMap(([name, from, to]) => { const b = boxes[name]; return b ? [{ box: { x: b.x - 6, y: b.y - 6, width: b.width + 12, height: b.height + 12 }, from: at(from), to: at(to) }] : []; });
  (scene.layers![0] as Extract<Layer, { kind: 'screen' }>).blurs = blurs;
  return scene;
}
/** The owner's café computer: its Mola window (with the rail), every caption carrying the step. */
function windowScene(name: string, clip: string, from: number, to: number, step: number, o: Opts, captions: CaptionsOf): Scene & { at: (c: number) => number } {
  const { at } = cutLeads(clip, from, to, o.taps ?? [], o.gaps);
  return { ...staffScene(name, clip, from, to, { frame: 'win', title: 'Mola · İşletme yönetimi', tag: PC, taps: o.taps, gaps: o.gaps }, (a, d) => stepped(step, captions(a, d)), o.toc), at };
}
/** A setting full screen (ownerScene), its first picture held for the first caption. */
function settingScene(name: string, clip: string, from: number, to: number, step: number, o: Opts, captions: CaptionsOf): Scene & { at: (c: number) => number } {
  const { at } = cutLeads(clip, from, to, o.taps ?? [], o.gaps);
  const hold = 1.2;
  return { ...holdStart(ownerScene(name, clip, from, to, o.taps ?? [], (a, d) => stepped(step, captions(a, d)), o.toc, { tag: PC, gaps: o.gaps }), hold), at: (c: number) => at(c) + hold };
}
/** A phone (the owner's or a guest's), big and steady, captions at its side. */
function phoneScene(name: string, clip: string, from: number, to: number, tag: string, side: 'guest' | 'business', step: number, o: Opts, captions: CaptionsOf): Scene & { at: (c: number) => number } {
  const names = o.taps ?? [], { map, at, d } = cutLeads(clip, from, to, names, o.gaps);
  const scene = { ...guestScene(name, clip, from, to, names, captions, o.toc), tag, side };
  const layer = scene.layers![0] as Extract<Layer, { kind: 'phone' }>;
  layer.map = map; layer.rings = tapMarks(clip, names, at, d).ripples;
  return { ...scene, duration: d, captions: stepped(step, captions(at, d)), at };
}
/** A blur over a part of the phone of phoneScene (a code being typed): box in the phone's CSS px, scene times. */
function phoneBlur(scene: Scene, b: Box | null | undefined, from: number, to: number): Scene {
  if (!b) return scene;
  const PH = 930, z = PH / 844, sw = PH * 390 / 844, x0 = 590 - sw / 2, y0 = 540 - PH / 2, pad = 5;
  const w = (b.width + 2 * pad) * z, h = (b.height + 2 * pad) * z, cx = x0 + (b.x - pad) * z + w / 2, cy = y0 + (b.y - pad) * z + h / 2;
  const layer: Layer = { kind: 'html', html: `<div style="width:${w}px;height:${h}px;border-radius:12px;backdrop-filter:blur(12px);background:rgba(230,226,214,.35)"></div>`,
    keys: [{ t: 0, x: cx, y: cy, o: 0 }, { t: Math.max(0, from - .01), x: cx, y: cy, o: 0 }, { t: from, x: cx, y: cy, o: 1 }, { t: to, x: cx, y: cy, o: 1 }, { t: to + .01, x: cx, y: cy, o: 0 }] };
  return { ...scene, layers: [...scene.layers!, layer] };
}
const money = (tl: number) => `₺${tl.toLocaleString('tr-TR')}`;

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Uzaktan erişim ve güvenlik', 'İşletmemi yönet, telefon kodu, cihazlar, yedek ve Mola desteği.'), toc: 'Giriş ve uzaktan erişim kurulumu' });

  // ===== 1. Ayarlar → Uzaktan erişim: telefon kodu, e-posta, the address (full screen) =====
  const U = marks('u1-kurulum'), Ut = taps('u1-kurulum');
  { const s = settingScene('b1-kurulum', 'u1-kurulum', .2, Ut.addressLook.off! - .2, 1, { taps: clicks('u1-kurulum'),
      gaps: [[Ut.cards.on + 1.8, Ut.cards.off!], [Ut.qrLook.on + 2, Ut.qrLook.off!], [Ut.codesLook.on + 2.2, Ut.codesLook.off!], [Ut.gonder.tap! + .8, U.mailCode - .3],
        // Straight to the settled screens where a secret appears or goes (its blur box is measured there).
        [Ut.kur.tap! + .2, U.qr - .05], [Ut.onay.tap! + .25, U.codes - .05], [Ut.sakladim.tap! + .15, U.done1], [Ut.dogrula.tap! + .25, U.done2 + .1]] }, at => [
      { from: .2, to: at(U.page), text: 'Kasa bilgisayarında: Ayarlar → Uzaktan erişim.' },
      { from: at(U.page), to: at(Ut.pw1.on), text: 'Beş adım; her biri tek kart.' },
      { from: at(Ut.pw1.on), to: at(U.qr), text: '1 · Telefon kodu: şifre → “Telefon kodunu kur”.' },
      { from: at(U.qr), to: at(U.code1), text: 'Telefondaki doğrulama uygulamasıyla QR okutulur.' },
      { from: at(U.code1), to: at(U.codes), text: 'Uygulamanın verdiği 6 haneli kod yazılır.' },
      { from: at(U.codes), to: at(U.mail), text: 'Kurtarma kodları bir kez gösterilir; kâğıda yazılır.' },
      { from: at(U.mail), to: at(U.mailCode), text: '2 · E-posta: cihazlarda bu adresle girilir.' },
      { from: at(U.mailCode), to: at(U.address), text: 'Adrese gelen kod yazılır; adres doğrulanır.' },
      { from: at(U.address), to: 99, text: '3 · Telefon ve laptopta bu adres açılır.' },
    ]);
    list.push(holdEnd(blurred(s, 'u1-kurulum', [['qr', U.qr - .05, Ut.onay.tap! + .25], ['code1', U.code1, Ut.onay.tap! + .25], ['codes', Ut.onay.tap!, Ut.sakladim.tap! + .15], ['code2', U.mailCode, Ut.dogrula.tap! + .25]], s.at), .4)); }

  // ===== 2. 5 · Uzaktan yönetim: "Aç" (outlined) =====
  { const s = settingScene('b2-yonetim', 'u1-kurulum', U.admin + .2, Ut.adminOnLook.off! - .3, 2, { taps: clicks('u1-kurulum', 'ac'), gaps: [[Ut.adminLook.on + 1.2, Ut.adminLook.off!], [Ut.adminOnLook.on + 2.6, Ut.adminOnLook.off! - .4], [Ut.acik.tap! + .25, U.adminOn - .05]] }, at => [
      { from: .2, to: at(Ut.ac.on), text: '5 · Uzaktan yönetim: kafenin ekranları telefondan açılır.' },
      { from: at(Ut.ac.on), to: at(U.adminForm), text: 'Kapalı gelir; “Aç” ile açılır.' },
      { from: at(U.adminForm), to: at(U.adminOn), text: 'Şifre ve telefon kodu istenir.' },
      { from: at(U.adminOn), to: 99, text: 'Açık. “Kapat” ile her an kapatılır.' },
    ]);
    list.push(holdEnd(blurred(s, 'u1-kurulum', [['code3', U.adminForm, Ut.acik.tap! + .25]], s.at), .6)); }

  // ===== 3. The owner's iPhone at home: İşletmemi yönet =====
  const P = marks('p1-giris'), Pt = taps('p1-giris');
  { const s = phoneScene('c1-giris', 'p1-giris', .2, Pt.yonet.tap! + 1.6, TEL, 'business', 3, { taps: clicks('p1-giris'), toc: 'İşletmemi yönet: telefondan giriş',
      gaps: [[Pt.devam.tap! + .6, P.code - .3], [Pt.giris.tap! + .8, P.screens - .6], [Pt.floor.on + 1, Pt.floor.off!], [Pt.live.off! - .2, Pt.yonet.on]] }, at => [
      { from: .2, to: at(Pt.pw.on), text: 'Evde, telefonda:<br>isletme.molayazilim.com.tr' },
      { from: at(Pt.pw.on), to: at(P.code), text: 'E-posta ve şifre,<br>sonra “Devam”.' },
      { from: at(P.code), to: at(P.screens), text: 'Doğrulama uygulamasındaki<br>6 haneli kod.' },
      { from: at(P.screens), to: at(Pt.toast?.on ?? P.screens + 2), text: 'Kafenin kendi ekranları<br>telefonda açılır.' },
      ...(Pt.toast ? [{ from: at(Pt.toast.on), to: at(Pt.raporlar.on), text: 'Her uzaktan giriş<br>bildirim olarak düşer.' }] : []),
      { from: at(Pt.raporlar.on), to: at(P.up), text: '“Raporlar”: bugünün<br>satışı, canlı.' },
      { from: at(P.up), to: 99, text: '“İşletmeyi yönet” ile<br>ekranlara dönülür.' },
    ]);
    list.push(phoneBlur(s, meta('p1-giris').boxes?.code, s.at(P.codeTyping) - .1, s.at(Pt.giris.tap!) + .3)); }

  // ===== 4. A price changed from home; the guest's menu =====
  const F = marks('p2-fiyat'), Ft = taps('p2-fiyat'), price = Number(info().newPrice);
  list.push(phoneScene('c2-fiyat', 'p2-fiyat', .2, Ft.rowAfter.off! - .2, TEL, 'business', 4, { taps: clicks('p2-fiyat'), toc: 'Uzaktan fiyat değişikliği',
    gaps: [[Ft.row.on + 1.6, Ft.row.off!], [Ft.save.tap! + .6, F.saved - .3]] }, at => [
    { from: .2, to: at(F.list), text: 'Daha fazla →<br>Menü yönetimi.' },
    { from: at(F.list), to: at(F.editor), text: `${'Caffè Latte'} →<br>“Düzenle”.` },
    { from: at(F.editor), to: at(Ft.save.on), text: `Yeni fiyat: ${money(price)}.` },
    { from: at(Ft.save.on), to: at(F.saved), text: '“Kaydet ve yayınla”.' },
    { from: at(F.saved), to: 99, text: 'Kafedeki menüye<br>hemen geçer.' },
  ]));
  const G = marks('g1-misafir'), Gt = taps('g1-misafir');
  list.push(phoneScene('c3-misafir', 'g1-misafir', .2, Gt.card.off! - .2, `Misafir telefonu <b>· Adım 4 / ${STEPS}</b>`, 'guest', 4, { taps: clicks('g1-misafir') }, at => [
    { from: .2, to: at(G.kahveler), text: 'Kafede bir misafir<br>QR menüyü açar.' },
    { from: at(G.kahveler), to: 99, text: `Caffè Latte artık<br>${money(price)}.` },
  ]));

  // ===== 5. The café's internet cut =====
  const K = marks('p3-kesinti'), Kt = taps('p3-kesinti');
  list.push(phoneScene('d1-kesinti', 'p3-kesinti', .2, Kt.offHero.off! - .2, TEL, 'business', 5, { toc: 'İnternet kesilince',
    gaps: [[K.cut + 1.6, K.dropped - .8], [Kt.offLine.on + 2.6, Kt.offLine.off!]] }, at => [
    { from: .2, to: at(K.dropped) - .4, text: 'Kafenin interneti<br>kesilir.' },
    { from: at(K.dropped) - .4, to: at(K.offline), text: '“Bağlantı koptu”:<br>değişiklik kaydedilmez.' },
    { from: at(K.offline), to: 99, text: 'Telefonda son durum<br>görünür.' },
  ]));
  const T = marks('t1-tablet'), Tt = taps('t1-tablet');
  list.push(staffScene('d2-tablet', 't1-tablet', .2, T.sent + 1.6, { frame: 'tablet', tag: `Garson tableti <b>· Adım 5 / ${STEPS}</b>`, taps: clicks('t1-tablet'), gaps: [[Tt.add.tap! + .9, Tt.cart.on + .1]] }, (at, d) => stepped(5, [
    { from: .2, to: at(Tt.send.on), text: 'Kafede tabletler, mutfak ve kasa Wi-Fi’de çalışmaya devam eder.' },
    { from: at(Tt.send.on), to: d + 1, text: 'Sipariş mutfağa gider; internet gerekmez.' },
  ])));
  const left = taps('p1-giris').live, right = taps('p3-kesinti').offLine;
  list.push({ ...splitScene('d3-karsilastirma', 'İşletmemi yönet · telefonda',
    { clip: 'p1-giris', t: left.on + 1.5, label: 'Kasa açık · tam yönetim', tone: 'on' },
    { clip: 'p3-kesinti', t: right.on + 1.5, label: 'Kasaya ulaşılamıyor · son durum', tone: 'off' },
    'Kasaya ulaşınca bütün ekranlar; ulaşılamayınca son rapor.', 8), tag: `Karşılaştırma <b>· Adım 5 / ${STEPS}</b>` });
  const B = marks('p4-geri'), Bt = taps('p4-geri');
  list.push(phoneScene('d4-geri', 'p4-geri', .2, Bt.lockedLook.off! - .2, TEL, 'business', 5, { taps: clicks('p4-geri'),
    gaps: [[B.on + 1.4, B.back - .6], [Bt.banner.on + 2.6, Bt.banner.off!], [Bt.askLook.on + 1.8, Bt.askLook.off!], [Bt.lockedLook.on + 2.8, Bt.lockedLook.off!]] }, at => [
    { from: .2, to: at(B.back), text: 'İnternet geri gelir.' },
    { from: at(B.back), to: at(B.ask), text: '“Kasa açıldı”:<br>ekranlar hazır.' },
    { from: at(B.ask), to: at(B.locked), text: '“Çıkış”: cihaz kilitlenir,<br>hatırlanır.' },
    { from: at(B.locked), to: 99, text: 'Yeniden girmek için<br>e-posta ve şifre yeter.' },
  ]));

  // ===== 6. The login notification and Eşleşmiş cihazlar, on the café computer =====
  const D = marks('s2-cihazlar'), Dt = taps('s2-cihazlar');
  list.push(holdEnd(settingScene('e1-bildirim', 's2-cihazlar', .2, Dt.note.off! - .4, 6, { taps: ['bell'], toc: 'Cihazlar ve oturumlar', gaps: [[Dt.note.on + 2.6, Dt.note.off! - .5]] }, at => [
    { from: .2, to: at(D.notes), text: 'Kafede, kasa bilgisayarında: Bildirimler.' },
    { from: at(D.notes), to: 99, text: 'Uzaktan giriş: hangi cihaz, saat kaç.' },
  ]), .4));
  // Ends with the list: card 5 below it is drawn once when the page opens, so its "Açık uzak oturumlar" still names the removed
  // laptop until the page is opened again (reported; src/RemoteAccess.tsx).
  list.push(holdEnd(settingScene('e2-cihazlar', 's2-cihazlar', Dt.nav.on - .1, D.removed + 2.2, 6, { taps: clicks('s2-cihazlar', 'kaldir').filter(n => n !== 'bell'),
    gaps: [[Dt.list.on + 2.2, Dt.list.off!]] }, at => [
    { from: .2, to: at(D.devices), text: 'Ayarlar → Uzaktan erişim.' },
    { from: at(D.devices), to: at(Dt.kaldir.on), text: '4 · Eşleşmiş cihazlar: en fazla 3 cihaz.' },
    { from: at(Dt.kaldir.on), to: at(D.removed), text: 'Kaybolan cihaz “Kaldır” ile çıkarılır; şifre sorulur.' },
    { from: at(D.removed), to: 99, text: 'Kaldırılan cihaz listeden çıkar.' },
  ]), .6));

  // ===== 7. Açık oturumlar and Kafe içi cihazlar =====
  const O = marks('s3-oturumlar'), Ot = taps('s3-oturumlar');
  list.push(holdEnd(settingScene('e3-oturumlar', 's3-oturumlar', .2, Ot.after.off! - .3, 7, { taps: clicks('s3-oturumlar', 'kapat'), gaps: [[Ot.list.on + 2.8, Ot.list.off!]] }, at => [
    { from: .2, to: at(O.sessions), text: 'Personel → Açık oturumlar.' },
    { from: at(O.sessions), to: at(Ot.kapat.on), text: 'Kafede girişli her cihaz burada.' },
    { from: at(Ot.kapat.on), to: at(O.closed), text: 'Kaybolan tablet: “Oturumu kapat”.' },
    { from: at(O.closed), to: 99, text: 'Oturumlar her sabah 05:00’te kendiliğinden kapanır.' },
  ]), .4));
  const Y = marks('s4-kafeici'), Yt = taps('s4-kafeici');
  list.push(settingScene('e4-kafeici', 's4-kafeici', .2, Yt.dialogLook.off! - .2, 7, { taps: ['rail'], gaps: [[Yt.dialogLook.on + 3.6, Yt.dialogLook.off! - .3]] }, at => [
    { from: .2, to: at(Y.dialog), text: 'Soldaki şeritte “Kafe içi cihazlar”.' },
    { from: at(Y.dialog), to: 99, text: 'Tablet ve telefonlar kafenin Wi-Fi’sinden bu QR ile bağlanır.' },
  ]));

  // ===== 8. Güvenlik ve yedek =====
  const S = marks('s5-yedek'), St = taps('s5-yedek');
  { const s = settingScene('f1-yedek', 's5-yedek', .2, St.guvenlik.on - .2, 8, { taps: clicks('s5-yedek', 'rail').filter(n => !n.startsWith('close') && !['guvenlik', 'topic', 'part'].includes(n)), toc: 'Yedek ve kurtarma kodu',
      gaps: [[St.topic.tap! - .05, S.places - .05], [St.placesLook.on + 2.8, St.placesLook.off!], [St.yedekLook.on + 2.4, St.yedekLook.off!], [St.dialogLook.on + 1.6, St.dialogLook.off!], [St.simdi.tap! + 1.2, S.done - .5], [St.kept.on - .1, St.keptLook.off!]] }, at => [
      { from: .2, to: at(S.places), text: 'Ayarlar → Güvenlik ve yedek → Yedek.' },
      { from: at(S.places), to: at(S.yedekCard), text: 'Yedekler: bu bilgisayar, ikinci yer ve bulutta şifreli sunucu yedeği.' },
      { from: at(S.yedekCard), to: at(St.rail.on), text: 'Her gün sonundan sonra ve gece 03:30’da kendiliğinden.' },
      { from: at(St.rail.on), to: at(St.simdi.on), text: 'Soldaki şeritte “Yedekle”.' },
      { from: at(St.simdi.on), to: at(S.done), text: '“Şimdi yedekle”: yedek alınır ve doğrulanır.' },
      { from: at(S.done), to: 99, text: 'Şifreli kopyası sunucuya da gider.' },
    ]);
    list.push(blurred(s, 's5-yedek', [['path', S.places - .05, S.yedekCard]], s.at)); }
  // The rail's "Güvenlik" window is taller than the 16:9 picture: shown in the whole Mola window.
  const sec = St.forgotLook ? St.forgotLook.off! - .3 : St.securityLook.off! - .3;
  list.push(holdEnd(windowScene('f2-guvenlik', 's5-yedek', St.guvenlik.on - .3, sec, 8, { taps: ['guvenlik'], gaps: [[St.securityLook.on + 3.4, St.securityLook.off!], ...(St.forgotLook ? [[St.forgotLook.on + 2.8, St.forgotLook.off! - .4] as [number, number]] : [])] }, at => [
    { from: .2, to: at(S.forgot ?? 99), text: '“Güvenlik”: anahtar bu bilgisayara kilitli; kurtarma kodu kâğıtta.' },
    ...(S.forgot ? [{ from: at(S.forgot), to: 99, text: 'Şifre unutulursa kâğıttaki kurtarma kodu kullanılır.' }] : []),
  ]), .6));

  // ===== 9. Mola desteği: the owner's permission =====
  const M = marks('s6-destek'), Mt = taps('s6-destek');
  list.push(holdEnd(settingScene('g1-destek', 's6-destek', .2, Mt.rulesLook.off! - .3, 9, { taps: clicks('s6-destek', 'toggle'), toc: 'Mola desteği',
    gaps: [[Mt.cardLook.on + 2, Mt.cardLook.off!], [Mt.onLook.on + 1.6, Mt.onLook.off!], [Mt.rulesLook.on + 3, Mt.rulesLook.off! - .4]] }, at => [
    { from: .2, to: at(M.card), text: 'Destek → Mola desteği.' },
    { from: at(M.card), to: at(Mt.toggle.on), text: 'Uzaktan destek izni kapalıyken Mola ekibi bağlanamaz.' },
    { from: at(Mt.toggle.on), to: at(M.on), text: 'İzni yalnız siz açarsınız; şifre sorulur.' },
    { from: at(M.on), to: at(M.rules), text: 'Açık: Mola ekibi ekranları açıp sorunu çözebilir.' },
    { from: at(M.rules), to: 99, text: 'Satış, kasa, şifreler ve yedek ekibe kapalıdır.' },
  ]), .6));
  // Kasa güvenliği (s7-kasa, Kasa ve giderler → Kasa ayarları) is recorded but left out: it guards the cashier's counting,
  // not remote access, and the video stays under five minutes.
  list.push({ name: 'h0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines, total } = chapters(list);
  const title = 'Uzaktan erişim ve güvenlik: telefondan yönetim, yedek | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde uzaktan erişim ve güvenlik gösteriliyor: işletmeyi telefondan yönetmek, cihazlar, oturumlar, yedek ve Mola desteği. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Videoda:
- Ayarlar → Uzaktan erişim: 1 · Telefon kodu (Google Authenticator gibi bir doğrulama uygulaması, 6 haneli kod, kurtarma kodları), 2 · E-posta (doğrulanan adres), 3 · Cihaz eşleştirme (isletme.molayazilim.com.tr), 4 · Eşleşmiş cihazlar, 5 · Uzaktan yönetim.
- İşletmemi yönet (isletme.molayazilim.com.tr): e-posta ve şifre, sonra telefon kodu. Giriş kasa bilgisayarında kontrol edilir; cihazla kasa bilgisayarı arasındaki her şey şifrelidir, Mola Merkez yalnız iletir.
- Uzaktan yönetim açıkken kafenin kendi ekranları telefonda açılır: Raporlar (bugünün satışı, canlı), menü, ayarlar. Örnekte bir ürünün fiyatı evden değiştiriliyor ve kafedeki QR menüde hemen görünüyor. Her uzaktan giriş bildirim olarak düşer.
- Kafenin interneti kesilince: telefonda “Bağlantı koptu”, ardından son durum. Kafede tabletler, mutfak ve kasa Wi-Fi üzerinden çalışmaya devam eder. İnternet gelince “Kasa açıldı · ekranlar hazır”. Önce / sonra karşılaştırmasıyla.
- “Çıkış”: cihaz kilitlenir ve hatırlanır; yeniden girmek için e-posta ve şifre yeter.
- Eşleşmiş cihazlar (en fazla 3): kaybolan cihaz şifreyle kaldırılır. Personel → Açık oturumlar: kaybolan tabletin oturumu kapatılır; oturumlar her sabah 05:00’te kapanır. Kafe içi cihazlar: tablet ve telefonlar kafenin Wi-Fi’sinden bağlanır.
- Ayarlar → Güvenlik ve yedek: yedekler bu bilgisayarda, ikinci yerde (flash bellek, OneDrive, Google Drive) ve bulutta şifreli sunucu yedeğinde. Her gün sonundan sonra ve gece 03:30’da kendiliğinden; “Şimdi yedekle”. Kurtarma kodu kâğıtta saklanır; şifre unutulursa ve yeni bilgisayara geçerken kullanılır.
- Destek → Mola desteği: uzaktan destek iznini yalnız işletme sahibi açar (şifreyle); satış, kasa, şifreler ve yedek Mola ekibine kapalıdır.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
Mola, Mola adisyon, adisyon programı, uzaktan erişim, telefondan kafe yönetimi, İşletmemi yönet, uzaktan rapor, iki adımlı doğrulama, Google Authenticator, otomatik yedek, bulut yedek, kurtarma kodu, kafe yazılımı, Elazığ
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'), `\nToplam ${fmt(total)} (${total.toFixed(1)} sn)`);
}
/** The round badge of the thumbnail: a shield with a lock (güvenlik). */
const shieldBadge = `<svg viewBox="0 0 24 24" width="70" height="70" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9.5a2 2 0 0 1 4 0V11"/></svg>`;
async function thumbnail(browser: Browser) {
  // The owner's iPhone on İşletmemi yönet ("Canlı", today's sales), shot off camera by the recorder.
  await shootThumb(browser, introThumb({ tone: THUMB_TONES.uzaktan, title: 'Uzaktan<br>erişim ve<br>güvenlik', shot: join(dirs.rec, 'kapak-telefon.png'), badge: shieldBadge }));
}

await uret({ mp4: 'Uzaktan erişim ve güvenlik.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });

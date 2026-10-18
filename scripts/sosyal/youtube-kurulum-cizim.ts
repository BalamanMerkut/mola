/*
 * YouTube 06 "Kurulum": the Windows screens between the download and the Mola window, DRAWN (they are not in a browser, so
 * they cannot be recorded like the app): the Downloads folder, "Tümünü ayıkla", the extracted folder, the SmartScreen warning,
 * "Mola Kurulum.exe" and the Windows approval for the firewall rule. Plain and simplified, no Microsoft logos; file and folder
 * names from the real package (site/dist/indir/Mola-Windows-0.1.34.zip: BENIOKU.txt, Mola Kurulum.exe, program\), the
 * installer window from scripts/desktop/Kurulum.cs (texts, colours, layout ×1.6), the warning texts from site/src/pages/indir.html
 * and the package's BENIOKU.txt.
 *
 * Each drawn scene is absolutely positioned HTML (stage pixels) whose pieces show between `from` and `to` (s); ripples and the
 * red outline (scripts/sosyal/youtube-sahne.ts rings) are placed on the drawn controls themselves; `zoom` moves the whole
 * drawing slightly (1.15×) towards the one outlined control.
 */
import { C, SANS, mark, type Scene } from './youtube-sahne';

export const VERSION = '0.1.34';
const WIN_FONT = `'Segoe UI', 'Segoe UI Variable', system-ui, sans-serif`;
const icon = {
  folder: `<svg width="30" height="30" viewBox="0 0 32 32"><path d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#f2c24f"/><path d="M3 12h26v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#f8d775"/></svg>`,
  zip: `<svg width="30" height="30" viewBox="0 0 32 32"><path d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#f2c24f"/><path d="M3 12h26v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#f8d775"/><rect x="14" y="9" width="4" height="15" fill="#6b6b6b"/><path d="M14 11h2v2h-2zM16 13h2v2h-2zM14 15h2v2h-2zM16 17h2v2h-2z" fill="#cfcfcf"/><rect x="13.5" y="19" width="5" height="5" rx="1" fill="#4a4a4a"/></svg>`,
  txt: `<svg width="30" height="30" viewBox="0 0 32 32"><path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#8a8a8a" stroke-width="1.4"/><path d="M20 3v6h6" fill="#e9e9e9" stroke="#8a8a8a" stroke-width="1.4"/><path d="M10 14h12M10 18h12M10 22h9" stroke="#7a7a7a" stroke-width="1.4"/></svg>`,
  app: (s = 30) => mark(s),
  arrow: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`,
  shield: `<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="M12 8v5M12 16h.01"/></svg>`,
};
const winButtons = `<span class="wb">&#x2013;</span><span class="wb">&#x2610;</span><span class="wb x">&#x2715;</span>`;

export type Piece = { html: string; from?: number; to?: number; id?: string };
type Row = { icon: string; name: string; date: string; type: string; size: string };
const DATE = '18.10.2026 07:04';
export const ZIP_ROW: Row = { icon: icon.zip, name: `Mola-Windows-${VERSION}`, date: DATE, type: 'Sıkıştırılmış (zip) klasör', size: '45.250 KB' };
export const FOLDER_ROWS: Row[] = [
  { icon: icon.folder, name: 'program', date: DATE, type: 'Dosya klasörü', size: '' },
  { icon: icon.txt, name: 'BENIOKU', date: DATE, type: 'Metin Belgesi', size: '5 KB' },
  { icon: icon.app(28), name: 'Mola Kurulum', date: DATE, type: 'Uygulama', size: '370 KB' },
];

/** A File Explorer window (simplified): title, address, folders on the left, the list with its columns. */
export function explorer(o: { x: number; y: number; w: number; h: number; title: string; path: string[]; rows: Row[]; group?: string }) {
  const nav = ['Giriş', 'Masaüstü', 'İndirilenler', 'Belgeler', 'Resimler', 'Bu bilgisayar'];
  const here = o.path[o.path.length - 1];
  const rowsTop = EX.rowsTop(o.y), list = o.rows.map((r, i) => `<div class="ex-row" data-name="${r.name}" style="top:${rowsTop + i * EX.rowH - o.y}px"><span class="ex-name">${r.icon}<b>${r.name}</b></span><span class="ex-date">${r.date}</span><span class="ex-type">${r.type}</span><span class="ex-size">${r.size}</span></div>`).join('');
  return `<div class="win ex" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px">
    <div class="tb">${icon.folder}<em>${o.title}</em>${winButtons}</div>
    <div class="ex-cmd"><span class="ex-nav">&#x2190;&#x2003;&#x2192;&#x2003;&#x2191;</span><span class="ex-addr">${o.path.map((p, i) => `${i ? icon.arrow : ''}<i>${p}</i>`).join('')}</span><span class="ex-search">${icon.search}<i>${here} içinde ara</i></span></div>
    <div class="ex-side">${nav.map(n => `<span class="${n === here || (here.startsWith('Mola-') && n === 'İndirilenler' && false) ? 'on' : ''}">${n}</span>`).join('')}</div>
    <div class="ex-head"><span class="ex-name">Ad</span><span class="ex-date">Değiştirme tarihi</span><span class="ex-type">Tür</span><span class="ex-size">Boyut</span></div>
    ${o.group ? `<div class="ex-group" style="top:${rowsTop - 48 - o.y}px">${o.group}</div>` : ''}
    ${list}
  </div>`;
}
/** Explorer geometry (stage px). */
export const EX = { rowH: 54, rowsTop: (y: number) => y + 52 + 62 + 52 + 48 };

export const windowsCss = `
  .ill{position:absolute;inset:0;transform-origin:0 0;will-change:transform}
  .pc{position:absolute;left:0;top:0;width:1920px;height:1080px;transition:none}
  .win{position:absolute;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(22,51,40,.55),0 0 0 1px rgba(0,0,0,.16);font-family:${WIN_FONT};color:#1b1b1b}
  .win .tb{display:flex;align-items:center;gap:14px;height:52px;padding-left:18px;background:#f3f3f3;border-bottom:1px solid #e5e5e5;font-size:20px}
  .win .tb svg{flex:none;border-radius:5px}.win .tb em{font-style:normal;flex:1;white-space:nowrap}
  .win .wb{width:64px;height:52px;display:grid;place-items:center;font-size:19px;color:#333}
  .ex-cmd{position:absolute;left:0;right:0;top:52px;height:62px;display:flex;align-items:center;gap:16px;padding:0 18px;border-bottom:1px solid #e8e8e8;background:#fbfbfb}
  .ex-nav{font-size:22px;color:#555;letter-spacing:2px}
  .ex-addr{flex:1;display:flex;align-items:center;gap:6px;height:40px;padding:0 16px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;font-size:19px}.ex-addr i{font-style:normal}
  .ex-search{width:300px;display:flex;align-items:center;gap:10px;height:40px;padding:0 14px;border:1px solid #d9d9d9;border-radius:6px;background:#fff;font-size:17px;color:#777}.ex-search i{font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ex-side{position:absolute;left:0;top:114px;bottom:0;width:280px;padding:16px 12px;border-right:1px solid #ececec;background:#fafafa;display:flex;flex-direction:column;gap:4px}
  .ex-side span{height:46px;display:flex;align-items:center;padding-left:18px;border-radius:6px;font-size:19px;color:#333}.ex-side span.on{background:#e3ecf6}
  .ex-head,.ex-row{position:absolute;left:280px;right:0;height:52px;display:flex;align-items:center;font-size:18px}
  .ex-head{top:114px;color:#555;border-bottom:1px solid #ececec}
  .ex-group{position:absolute;left:304px;font-size:18px;font-weight:600;color:#1f4f87}
  .ex-row{height:54px;margin:0 10px;border-radius:6px}
  .ex-row.sel{background:#cce4f7}.ex-row.hov{background:#e5f1fb}
  .ex-name{width:470px;padding-left:24px;display:flex;align-items:center;gap:14px}.ex-name b{font-weight:400;font-size:20px}.ex-name svg{flex:none;border-radius:4px}
  .ex-date{width:230px;color:#555}.ex-type{width:270px;color:#555}.ex-size{width:120px;text-align:right;color:#555;padding-right:20px}
  .menu{position:absolute;width:360px;padding:8px;border-radius:10px;background:#fbfbfb;box-shadow:0 20px 50px -14px rgba(0,0,0,.45),0 0 0 1px rgba(0,0,0,.12);font:400 20px/1 ${WIN_FONT};color:#1b1b1b}
  .menu span{display:flex;align-items:center;height:52px;padding-left:20px;border-radius:6px}.menu span.hl{background:#e8eef6}.menu hr{border:0;border-top:1px solid #e3e3e3;margin:6px 4px}
  .dlg .body{padding:30px 40px;font-size:20px}.dlg h3{font-weight:400;font-size:27px;color:#1f4f87;margin-bottom:26px}
  .field{display:flex;gap:14px;margin:14px 0 22px}.field i{flex:1;font-style:normal;height:46px;display:flex;align-items:center;padding:0 14px;border:1px solid #bdbdbd;border-radius:4px;background:#fff;font-size:19px}
  .btn-w{display:inline-grid;place-items:center;min-width:150px;height:46px;padding:0 22px;border:1px solid #c4c4c4;border-radius:5px;background:#fdfdfd;font-size:19px}
  .btn-w.pri{background:#2d6bb3;border-color:#2d6bb3;color:#fff}
  .chk{display:flex;align-items:center;gap:14px;font-size:19px}.chk b{width:24px;height:24px;border-radius:4px;background:#2d6bb3;color:#fff;display:grid;place-items:center;font-size:16px}
  .bar{height:14px;border-radius:7px;background:#e3e3e3;overflow:hidden}.bar i{display:block;height:100%;background:#3c9a5f}
  .ss{position:absolute;width:820px;padding:52px 56px 40px;background:#1f5ea8;color:#fff;font-family:${WIN_FONT};box-shadow:0 40px 90px -30px rgba(0,0,0,.6)}
  .ss h2{font-weight:300;font-size:46px;margin:20px 0 22px}.ss p{font-size:21px;line-height:1.45;opacity:.95}.ss u{display:inline-block;margin-top:18px;font-size:21px;text-decoration:underline}
  .ss .btns{display:flex;justify-content:flex-end;gap:16px;margin-top:40px}.ss .btns span{min-width:190px;height:50px;display:grid;place-items:center;border:2px solid rgba(255,255,255,.85);font-size:20px;padding:0 20px}
  .ss dl{margin-top:22px;font-size:21px;line-height:1.7}.ss dt{display:inline;opacity:.85}.ss dd{display:inline;margin-left:8px}
  .dim{position:absolute;inset:0;background:rgba(18,28,24,.5)}
  .uac{position:absolute;width:760px;background:#fff;border-radius:10px;overflow:hidden;font-family:${WIN_FONT};box-shadow:0 40px 90px -20px rgba(0,0,0,.6)}
  .uac .top{padding:26px 34px 28px;background:#f1f3f6;border-bottom:1px solid #dfe3e8}.uac small{font-size:17px;color:#555}.uac h2{margin-top:14px;font-weight:600;font-size:27px;line-height:1.3;color:#1b1b1b}
  .uac .app{display:flex;align-items:center;gap:18px;padding:26px 34px 6px;font-size:23px}.uac .app svg{border-radius:8px}
  .uac p{padding:6px 34px 0;font-size:19px;color:#444}.uac .btns{display:flex;gap:16px;padding:30px 34px}.uac .btns span{flex:1;height:52px;display:grid;place-items:center;border:1px solid #c4c4c4;border-radius:5px;font-size:20px}.uac .btns span.pri{background:#2d6bb3;color:#fff;border-color:#2d6bb3}
  .inst{position:absolute;width:864px;background:rgb(23,52,42);color:rgb(243,235,221);font-family:${WIN_FONT};border-radius:10px;overflow:hidden;box-shadow:0 40px 90px -30px rgba(0,0,0,.6),0 0 0 1px rgba(0,0,0,.25)}
  .inst .tb{display:flex;align-items:center;gap:14px;height:52px;padding-left:18px;background:#f3f3f3;color:#1b1b1b;font-size:20px}.inst .tb svg{border-radius:5px}.inst .tb em{font-style:normal;flex:1}.inst .tb .wb{width:64px;height:52px;display:grid;place-items:center;color:#333;font-size:19px}.inst .tb .wb.off{color:#bbb}
  .inst .c{position:relative;padding:32px 48px 36px 48px}
  .inst h2{font:400 43px/1.15 Georgia,serif;margin-left:-3px}
  .inst .s{margin-top:13px;font-size:21px;line-height:1.42;color:rgb(200,214,202)}
  .inst .lab{margin-top:19px;font-size:19px;color:rgb(200,214,202)}
  .inst .row{display:flex;gap:64px;margin-top:5px;align-items:center}.inst .tbx{width:592px;height:40px;display:flex;align-items:center;padding:0 12px;background:rgb(36,72,59);border:1px solid rgb(243,235,221);font-size:20px}
  .inst .b{display:inline-grid;place-items:center;height:57px;border:1.6px solid rgb(243,235,221);font-size:21px}
  .inst .b.ch{width:160px;height:46px}.inst .b.pri{background:rgb(243,235,221);color:rgb(23,52,42);font-weight:700}
  .inst .cb{display:flex;align-items:center;gap:14px;margin-top:12px;font-size:21px}.inst .cb b{width:22px;height:22px;border:1.6px solid rgb(243,235,221);display:grid;place-items:center;font-size:16px;background:rgb(243,235,221);color:rgb(23,52,42)}
  .inst .foot{display:flex;align-items:center;justify-content:flex-end;gap:16px;margin-top:26px;min-height:57px}.inst .st{flex:1;font-size:20px;color:rgb(200,214,202)}
  .inst .note{margin-top:20px;font-size:20px;line-height:1.4;color:rgb(200,214,202)}
  .simple{position:absolute;left:40px;top:40px;font:400 19px/1 ${SANS};color:${C.muted};opacity:.85}
`;

/** A control of a piece (its index and a CSS selector inside it): ripples, the outline and the zoom are placed on it. */
export type Spot = { piece: number; sel: string };
export type DrawnRing = Spot & ({ kind: 'ripple'; at: number } | { kind: 'outline'; from: number; tap: number });
/**
 * The script of a drawn scene: pieces fade in by their times (a later piece lies on top: a window that changes keeps its old
 * look until the new one has fully appeared), `texts` change, ripples and the one outline sit on real controls (measured from
 * the drawing), and the drawing moves gently (`s`, ~1.15×) towards the outlined control.
 */
export function drawn(o: { pieces: Piece[]; rings?: DrawnRing[]; zoom?: (Spot & { from: number; to: number; s?: number })[]; texts?: { id: string; at: [number, string][] }[]; extra?: string }) {
  const data = { p: o.pieces.map((p, i) => ({ i, from: p.from ?? -1, to: p.to ?? 1e9 })), z: o.zoom ?? [], r: o.rings ?? [], t: o.texts ?? [] };
  return `<div class="ill" id="ill">${o.pieces.map((p, i) => `<div class="pc" id="pc${i}" style="opacity:0">${p.html}</div>`).join('')}</div>
  <div class="simple">Windows ekranları sadeleştirilmiş çizimdir.</div>
  <script>
  (function () {
    const P = ${JSON.stringify(data)};
    const e3 = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, c01 = v => Math.max(0, Math.min(1, v));
    let measured = false;
    function measure() {
      const ill = document.getElementById('ill'); ill.style.transform = 'none';
      const box = x => { const el = document.querySelector('#pc' + x.piece + ' ' + x.sel); if (!el) throw new Error('Yok: ' + x.sel); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
      for (const r of P.r) { const b = box(r); D.marks.push(r.kind === 'ripple' ? { box: b, from: r.at, to: r.at + .45, ripple: true } : { box: b, from: r.from + .3, to: r.tap + .2, tap: r.tap }); }
      for (const z of P.z) { const b = box(z); z.cx = b.x + b.width / 2; z.cy = b.y + b.height / 2; }
      measured = true;
    }
    window.sceneAnim = function (t) {
      if (!measured) measure();
      for (const p of P.p) { const el = document.getElementById('pc' + p.i); const o = Math.min(c01((t - p.from) / .25), c01((p.to - t) / .2)); el.style.opacity = o; el.style.visibility = o > 0 ? 'visible' : 'hidden'; }
      for (const x of P.t) { const el = document.getElementById(x.id); if (!el) continue; const cur = [...x.at].reverse().find(a => t >= a[0]); const v = cur ? cur[1] : ''; if (el.innerHTML !== v) el.innerHTML = v; }
      let s = 1, cx = 960, cy = 540;
      for (const z of P.z) { const k = Math.min(e3(c01((t - z.from) / .7)), e3(c01((z.to - t) / .8))); if (k > 0) { s = 1 + ((z.s || 1.15) - 1) * k; cx = z.cx; cy = z.cy; } }
      const tr = 'translate(' + (cx - cx * s) + 'px,' + (cy - cy * s) + 'px) scale(' + s + ')';
      document.getElementById('ill').style.transform = tr;
      const r = document.getElementById('stageRings'); if (r) { r.style.transformOrigin = '0 0'; r.style.transform = tr; }
      ${o.extra ?? ''}
    };
  })();
  </script>`;
}

/** The installer window of scripts/desktop/Kurulum.cs at ×1.6 (Mola colours), before / during / after. */
export function installer(x: number, y: number, state: 'start' | 'busy' | 'done') {
  const folder = 'C:\\Users\\Kafe\\AppData\\Local\\Mola';
  const head = state === 'done' ? 'Kurulum tamamlandı' : 'Mola kurulumu';
  const sentence = state === 'done' ? 'Mola kuruldu ve çalışıyor. Bundan sonra masaüstündeki Mola simgesiyle açabilirsiniz.'
    : 'Mola bu bilgisayara kurulur. İnternet gerekmez. Windows yalnız tabletlerin bağlanabilmesi (güvenlik duvarı izni) için bir kez yönetici onayı sorar. Önceki verileriniz ve yedekleriniz korunur.';
  const body = state === 'done' ? `<div class="lab">Kurulduğu klasör</div><div class="row"><span class="tbx">${folder}</span></div>
      <div class="note">Güvenlik duvarı izni eklendi (yalnız yerel ağ); tabletler bağlanabilir.</div>
      <div class="foot"><span class="b pri" style="width:192px">Mola'yı aç</span><span class="b" style="width:160px">Kapat</span></div>`
    : `<div class="lab">Kurulacak klasör</div><div class="row"><span class="tbx">${folder}</span><span class="b ch" style="${state === 'busy' ? 'opacity:.45' : ''}">Değiştir</span></div>
      <div class="cb" style="margin-top:26px;${state === 'busy' ? 'opacity:.55' : ''}"><b>&#x2713;</b>Masaüstüne simge ekle</div><div class="cb" style="${state === 'busy' ? 'opacity:.55' : ''}"><b>&#x2713;</b>Bilgisayar açılınca başlat</div>
      <div class="foot"><span class="st" id="instStatus"></span><span class="b pri" style="width:208px;${state === 'busy' ? 'opacity:.45' : ''}">Kur</span></div>`;
  return `<div class="inst" style="left:${x}px;top:${y}px"><div class="tb">${icon.app(24)}<em>Mola kurulumu</em><span class="wb off">&#x2013;</span><span class="wb off">&#x2610;</span><span class="wb">&#x2715;</span></div>
    <div class="c"><h2>${head}</h2><div class="s">${sentence}</div>${body}</div></div>`;
}
export function smartScreen(x: number, y: number, more: boolean) {
  return `<div class="ss" style="left:${x}px;top:${y}px">${icon.shield}<h2>Bilgisayarınız korundu</h2>
    <p>Tanınmayan bir uygulamanın başlatılması engellendi. Bu uygulamayı çalıştırmak bilgisayarınızı riske atabilir.</p>
    ${more ? `<dl><dt>Uygulama:</dt><dd>Mola Kurulum.exe</dd><br><dt>Yayımcı:</dt><dd>Bilinmeyen yayımcı</dd></dl>` : `<u>Ek bilgi</u>`}
    <div class="btns">${more ? '<span>Yine de çalıştır</span>' : ''}<span>Çalıştırma</span></div></div>`;
}
export function uac(x: number, y: number) {
  return `<div class="dim"></div><div class="uac" style="left:${x}px;top:${y}px"><div class="top"><small>Kullanıcı Hesabı Denetimi</small><h2>Bu uygulamanın cihazınızda değişiklik yapmasına izin vermek istiyor musunuz?</h2></div>
    <div class="app">${icon.app(48)}<span>Mola Kurulum</span></div><p>Doğrulanmış yayımcı: Bilinmiyor</p>
    <div class="btns"><span class="pri">Evet</span><span>Hayır</span></div></div>`;
}
export function contextMenu(x: number, y: number, hl = -1) {
  const items = ['Aç', 'Tümünü ayıkla…', 'Yol olarak kopyala', 'Özellikler'];
  return `<div class="menu" style="left:${x}px;top:${y}px">${items.map((t, i) => `${i === 2 ? '<hr>' : ''}<span class="${i === hl ? 'hl' : ''}">${t}</span>`).join('')}</div>`;
}
export function extractDialog(x: number, y: number, progress: boolean) {
  return `<div class="win dlg" style="left:${x}px;top:${y}px;width:900px"><div class="tb"><em>&#x2190;&#x2003;Sıkıştırılmış (zip) Klasörleri Ayıkla</em><span class="wb x">&#x2715;</span></div>
    <div class="body">${progress ? `<h3>Ayıklanıyor</h3><p style="margin-bottom:18px"><span id="exPct">%0</span> tamamlandı</p><div class="bar"><i id="exBar" style="width:0%"></i></div><div style="height:150px"></div>`
      : `<h3>Hedef seçin ve dosyaları ayıklayın</h3><p>Dosyalar bu klasöre ayıklanacak:</p><div class="field"><i>C:\\Users\\Kafe\\Downloads\\Mola-Windows-${VERSION}</i><span class="btn-w">Gözat…</span></div>
      <div class="chk"><b>&#x2713;</b>Tamamlandığında ayıklanan dosyaları göster</div>`}
      <div style="display:flex;justify-content:flex-end;gap:14px;margin-top:40px">${progress ? '<span class="btn-w">İptal</span>' : '<span class="btn-w pri">Ayıkla</span><span class="btn-w">İptal</span>'}</div></div></div>`;
}

export type { Scene };

// Facebook sayfası ve X kapak görselleri (site renkleri, şablon latte fotoğrafı).
// Kullanım: node scripts/sosyal/kapak-gorselleri.mjs <çıktı klasörü>
// Facebook: 1640×924; masaüstünde yalnız ortadaki ~1640×624 bant görünür, önemli her şey o bantta.
// X: 1500×500; profil fotoğrafı sol alt köşeye biner, sol alt boş bırakılır.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const cikti = process.argv[2];
if (!cikti) throw new Error('Çıktı klasörü verin.');
mkdirSync(cikti, { recursive: true });

const latte = `data:image/webp;base64,${readFileSync('templates/gorseller/latte.webp').toString('base64')}`;

const sayfa = ({ g, y, sol, yaziBoy, fotoBoy, fotoX, ust }) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${g}px;height:${y}px;overflow:hidden}
  body{position:relative;background:#ece6da;font-family:system-ui,"Segoe UI",sans-serif}
  .yesil{position:absolute;inset:0 auto 0 0;width:${sol}px;background:radial-gradient(circle at 30% 45%,#2c5c4a 0%,#234c3e 70%);
         clip-path:polygon(0 0,100% 0,calc(100% - ${Math.round(y * 0.18)}px) 100%,0 100%)}
  .foto{position:absolute;left:${fotoX}px;top:50%;width:${fotoBoy}px;height:${fotoBoy}px;transform:translateY(-50%);
        background:url(${latte}) center/cover;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 58%,transparent 71%)}
  .yazi{position:absolute;left:${Math.round(sol * 0.12)}px;top:${ust}px;color:#f3ebdd}
  .ad{font:400 ${yaziBoy}px/1 Georgia,"Palatino Linotype",serif;letter-spacing:-.03em}
  .ad i{font-style:normal;color:#d9875f}
  .alt{margin-top:${Math.round(yaziBoy * 0.16)}px;font-weight:600;font-size:${Math.round(yaziBoy * 0.17)}px;letter-spacing:.22em;color:#cfe0d3}
  .slogan{margin-top:${Math.round(yaziBoy * 0.3)}px;font:400 ${Math.round(yaziBoy * 0.3)}px/1.2 Georgia,serif;color:#f3ebdd}
  .site{margin-top:${Math.round(yaziBoy * 0.22)}px;font-size:${Math.round(yaziBoy * 0.16)}px;color:#cfe0d3;letter-spacing:.02em}
  .site b{color:#f3ebdd;font-weight:600}
</style></head><body>
  <div class="foto"></div><div class="yesil"></div>
  <div class="yazi"><div class="ad">mola<i>.</i></div><div class="alt">ADİSYON · QR MENÜ</div>
    <div class="slogan">Kafenize güzel bir mola verin.</div>
    <div class="site"><b>molayazilim.com.tr</b> · Elazığ</div></div>
</body></html>`;

const kapaklar = {
  'kapak-facebook.png': { g: 1640, y: 924, sol: 960, yaziBoy: 150, fotoBoy: 700, fotoX: 900, ust: 250 },
  'kapak-x.png': { g: 1500, y: 500, sol: 900, yaziBoy: 112, fotoBoy: 480, fotoX: 920, ust: 70 },
};

const tarayici = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
for (const [ad, o] of Object.entries(kapaklar)) {
  const s = await tarayici.newPage({ viewport: { width: o.g, height: o.y } });
  await s.setContent(sayfa(o));
  await s.screenshot({ path: join(cikti, ad) });
  await s.close();
  console.log('yazıldı', ad);
}
await tarayici.close();

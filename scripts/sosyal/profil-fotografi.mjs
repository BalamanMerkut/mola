// Sosyal medya profil fotoğrafı: sitedeki Mola işareti (public/favicon.svg) 1080×1080, yuvarlak kırpmaya uygun.
// Kullanım: node scripts/sosyal/profil-fotografi.mjs <çıktı klasörü>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const cikti = process.argv[2];
if (!cikti) throw new Error('Çıktı klasörü verin.');
mkdirSync(cikti, { recursive: true });

// Fincan x=3…22 arasında (sap dahil): görünüm kutusu sapı kesmeyecek ve fincanı ortalayacak şekilde kaydırıldı.
const fincan = (boy, renk) => `<svg width="${boy}" height="${boy}" viewBox="0.5 0 24 24" fill="none" stroke="${renk}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/>
  <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/></svg>`;

const sayfa = (govde) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1080px;height:1080px}
  body{background:#234c3e;display:flex;flex-direction:column;align-items:center;justify-content:center;
       background-image:radial-gradient(circle at 50% 42%, #2c5c4a 0%, #234c3e 62%)}
  .yazi{font:400 150px/1 Georgia,"Palatino Linotype",serif;letter-spacing:-.03em;color:#f3ebdd;margin-top:6px}
  .yazi i{font-style:normal;color:#d9875f}
</style></head><body>${govde}</body></html>`;

const surumler = {
  'profil-fincan.png': sayfa(fincan(560, '#f3ebdd')),
  'profil-fincan-yazi.png': sayfa(`${fincan(400, '#f3ebdd')}<div class="yazi">mola<i>.</i></div>`),
};

const tarayici = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const s = await tarayici.newPage({ viewport: { width: 1080, height: 1080 } });
for (const [ad, html] of Object.entries(surumler)) {
  await s.setContent(html);
  await s.screenshot({ path: join(cikti, ad) });
  console.log('yazıldı', ad);
}
await tarayici.close();

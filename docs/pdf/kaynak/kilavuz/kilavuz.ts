/*
 * İki kılavuzu yeniden üretir: docs/pdf/Mola-Kullanim-Kilavuzu.pdf (kafeler için) ve docs/pdf/Mola-Yonetim-Kilavuzu.pdf
 * (yalnız satıcı için).
 *   npm.cmd run pdf:kilavuz                  derle, örnek işletmeyle sunucuları aç, ekranları yeniden çek, PDF'leri bas
 *   npm.cmd run pdf:kilavuz -- --ekransiz     yalnız PDF (docs/pdf/kaynak/kilavuz/ekran/ içindeki görüntülerle)
 *   npm.cmd run pdf:kilavuz -- --onizleme     ayrıca her sayfanın PNG'si (.local/kilavuz-pdf/<ad>/sayfa-*.png)
 *   npm.cmd run pdf:kilavuz -- --grup misafir --grup sahip-menu   yalnız bu çekim grupları (sunucular yine açılır)
 * Ekranlar yalnız geçici örnek verilerle çekilir (sunucular.ts); gerçek kurulumlara dokunulmaz.
 * Kontrol için sayfaların küçük resimleri: node docs/pdf/kaynak/kilavuz/temas.mjs .local/kilavuz-pdf/<ad> <çıktı öneki> (önce --onizleme).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { EKRAN, HERE } from './yollar.ts';
import { belgeHtml, kullanilan, sifirla, uyarilar, type Belge } from './sablon.ts';
import { kullanimKilavuzu } from './kullanim.ts';
import { yonetimKilavuzu } from './yonetim.ts';

const args = process.argv.slice(2);
const ekransiz = args.includes('--ekransiz'), onizleme = args.includes('--onizleme');
const gruplar = args.flatMap((a, i) => args[i - 1] === '--grup' ? [a] : []);
const ROOT = resolve(HERE, '../../../..');
const OUT = join(ROOT, 'docs', 'pdf');
const BUILD = join(ROOT, '.local', 'kilavuz-pdf');

if (!ekransiz) {
  console.log('Ekranlar derleniyor (vite build)…');
  const b = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  if (b.status !== 0) throw new Error('Derleme başarısız.');
  const { startServers } = await import('./sunucular.ts');
  const { ekranlariCek } = await import('./ekranlar.ts');
  const servers = await startServers();
  process.env.KILAVUZ_ROOT = servers.root;
  try {
    const h = await ekranlariCek(gruplar);
    if (h.length) console.log(`\nUyarı: ${h.length} çekim düştü (eski görüntüleri kullanılır):\n${h.join('\n')}\n`);
  } finally { servers.stop(); rmSync(servers.root, { recursive: true, force: true }); }
}

async function bas(uret: () => Belge) {
  sifirla();
  const b = uret();
  const dir = join(BUILD, b.dosya.replace(/\.pdf$/, ''));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'img'), { recursive: true });
  const html = belgeHtml(b, 'img/merkut.jpg');
  for (const u of uyarilar) console.log(`  Uyarı: ${u}`);
  // Görüntüler: gösterim genişliğinin iki katı, JPEG (PDF küçük kalsın, baskıda net olsun).
  for (const [ad, w] of kullanilan) {
    await sharp(join(EKRAN, `${ad}.png`)).resize({ width: Math.round(w * 2.2), withoutEnlargement: true }).flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true }).toFile(join(dir, 'img', `${ad}.jpg`));
  }
  await sharp(join(ROOT, 'brand', 'merkut-studios', 'merkut-studios-logo.jpg')).resize({ width: 300 }).jpeg({ quality: 85 }).toFile(join(dir, 'img', 'merkut.jpg'));
  writeFileSync(join(dir, 'index.html'), html);
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    await page.emulateMedia({ media: 'print' });
    await page.goto(pathToFileURL(join(dir, 'index.html')).href);
    await page.waitForFunction(() => (window as any).__hazir === true, null, { timeout: 120000 });
    const { sayfa, tasan } = await page.evaluate(() => ({ sayfa: (window as any).__sayfa, tasan: (window as any).__tasan }));
    if (tasan) console.log(`  Uyarı: ${tasan} blok sayfaya sığmadı (kırmızı kesik çizgiyle işaretli).`);
    const pdf = join(OUT, b.dosya);
    await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    console.log(`  ${b.dosya}: ${sayfa} sayfa, ${(statSync(pdf).size / 1024 / 1024).toFixed(1)} MB`);
    if (onizleme) {
      await page.emulateMedia({ media: 'screen' });
      const pages = page.locator('section.sayfa');
      const n = await pages.count();
      for (let i = 0; i < n; i++) await pages.nth(i).screenshot({ path: join(dir, `sayfa-${String(i + 1).padStart(3, '0')}.png`) });
      console.log(`  Önizleme: ${dir}`);
    }
  } finally { await browser.close(); }
}

console.log('PDF\'ler basılıyor…');
await bas(kullanimKilavuzu);
await bas(yonetimKilavuzu);

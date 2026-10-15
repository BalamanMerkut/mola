/*
 * Mola Yardım (molayazilim.com.tr, sağ alttaki "Yardım"): Mola'yı kullanan kafeler için hazır sorular ve cevaplar.
 * Yapay zekâ yok, sunucu yok: site/src/assets/yardim.json derlemede denetlenir ve site/src/assets/yardim.js'in içine gömülür
 * (dist/assets/yardim.js). site.js bu dosyayı yalnız yardımcı ilk açılınca yükler; aranan hiçbir şey ağa gitmez.
 * Yalnız kitlesinde "site" olan sorular gömülür; programın içindeki "?" aynı dosyanın kendi rolüne düşen sorularını kullanır
 * (src/HelpPanel.tsx, packages/domain/yardim.ts). Kullanan: scripts/site-build.ts ve tests/site-yardim.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkYardim, forAudience, type YardimVerisi } from '../packages/domain/yardim.js';

export type { YardimKonu, YardimSoru, YardimVerisi } from '../packages/domain/yardim.js';

const MARKER = '__YARDIM_VERISI__', AVATAR_MARKER = '__YARDIM_RESIM__';
/** The Mola Yardım picture beside the panel's title (same-origin files under /assets/img/). */
export type YardimAvatar = { src: string; srcset: string };
// Line and paragraph separators (U+2028, U+2029) and "<": escaped in the embedded literal.
const UNSAFE = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}<]`, 'g');

/** Reads and checks site/src/assets/yardim.json (packages/domain/yardim.ts); a mistake stops the build with the question's id. */
export function readYardim(src: string): YardimVerisi {
  return checkYardim(JSON.parse(readFileSync(join(src, 'assets', 'yardim.json'), 'utf8')) as Partial<YardimVerisi>);
}

/** site/src/assets/yardim.js with the website's questions inside (kitle "site"; a JS object literal: JSON, never evaluated as text). */
export function yardimScript(src: string, avatar: YardimAvatar | null = null): string {
  const code = readFileSync(join(src, 'assets', 'yardim.js'), 'utf8');
  for (const m of [MARKER, AVATAR_MARKER]) if (code.split(m).length !== 2) throw new Error(`site/src/assets/yardim.js: ${m} tam bir kez geçmeli.`);
  if (avatar && ![avatar.src, ...avatar.srcset.split(', ')].every(u => /^\/assets\/img\/[a-z0-9-]+\.png\?v=[0-9a-f]+(?: [123]x)?$/.test(u))) throw new Error('Mola Yardım resmi: yalnız /assets/img/*.png');
  // U+2028/2029 and "<" escaped: the literal stays valid JavaScript everywhere.
  const data = JSON.stringify(forAudience(readYardim(src), 'site')).replace(UNSAFE, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return code.replace(MARKER, () => data).replace(AVATAR_MARKER, () => JSON.stringify(avatar));
}

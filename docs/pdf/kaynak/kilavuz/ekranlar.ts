/*
 * Kılavuz ekranları: örnek işletmeyle (sunucular.ts) gerçek uygulamadan çekilir.
 *   npx.cmd tsx docs/pdf/kaynak/kilavuz/ekranlar.ts [grup ...]     (sunucular açıkken: sunucu-ac.ts)
 * Gruplar sırayla çalışır; biri düşerse diğerleri sürer, eski görüntü yerinde kalır.
 */
import { chromium, request as pwRequest, type APIRequestContext, type APIResponse, type Browser } from '@playwright/test';
import { KAFE, PASSWORD } from './sunucular.ts';
import { dene, hatalar } from './cekim.ts';
import { misafir } from './ekranlar-misafir.ts';
import { gruplarSahip, gruplarSon } from './ekranlar-sahip.ts';
import { gruplarYonetim } from './ekranlar-yonetim.ts';

export type Ortak = {
  sahip: APIRequestContext; id: () => string; durum: () => Promise<any>;
  ok: (r: APIResponse, what: string) => Promise<any>; api: (kullanici: string) => Promise<APIRequestContext>;
};
export type Grup = (browser: Browser, ortak: Ortak) => Promise<void>;

const id = () => crypto.randomUUID().replace(/-/g, '');
async function api(kullanici: string) {
  const ctx = await pwRequest.newContext({ baseURL: KAFE });
  const r = await ctx.post('/api/login', { data: { username: kullanici, password: PASSWORD } });
  if (!r.ok()) throw new Error(`API girişi olmadı: ${kullanici}`);
  return ctx;
}
async function ok(r: APIResponse, what: string) {
  if (!r.ok()) throw new Error(`${what}: ${r.status()} ${await r.text()}`);
  return r.json().catch(() => ({}));
}

// Sıra önemli: sözleşme penceresi ilk sahip girişinde, önemli duyuru ve paket Mola Yönetim'den sonra, gün sonu en son.
const { 'sahip-masalar': sahipMasalar, ...digerSahip } = gruplarSahip;
const gruplar: Record<string, Grup> = { misafir, 'sahip-masalar': sahipMasalar, ...digerSahip, ...gruplarYonetim, ...gruplarSon };

export async function ekranlariCek(secilen: string[] = []) {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  const sahip = await api('isletme');
  // Uzun çekim boyunca sahibin otomatik kilidi kapalı; sonunda varsayılana (10 dk) döner.
  await sahip.post('/api/staff/lock/settings', { data: { minutes: 0 } });
  const ortak: Ortak = { sahip, id, ok, api, durum: async () => (await sahip.get('/api/staff/state')).json() };
  for (const name of secilen.length ? secilen : Object.keys(gruplar)) {
    const grup = gruplar[name];
    if (!grup) { console.log(`Bilinmeyen grup: ${name} (var olanlar: ${Object.keys(gruplar).join(', ')})`); continue; }
    console.log(`Grup: ${name}`);
    await dene(name, () => grup(browser, ortak));
  }
  await sahip.post('/api/staff/lock/settings', { data: { minutes: 10 } }).catch(() => {});
  await browser.close();
  return hatalar;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('kilavuz/ekranlar.ts')) {
  const h = await ekranlariCek(process.argv.slice(2));
  console.log(h.length ? `\n${h.length} çekim düştü:\n${h.join('\n')}` : '\nBütün çekimler tamam.');
}

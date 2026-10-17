import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ayarlar, Isletme } from './tipler.js';
import { ayarlarBirlestir, bosIsletme } from './yardimci.js';

/*
 * Veri: depo dışında, .local/pazarlama/veri.json (.local git'e girmez). Yüzlerce kayıt için JSON yeter; her yazışta önce
 * geçici dosyaya yazılır, sonra yerine konur (yarım dosya kalmaz). OneDrive dosyayı bir an kilitlerse birkaç kez denenir.
 */

export const KLASOR = dirname(fileURLToPath(import.meta.url));
export const VERI_KLASORU = process.env.MOLA_PAZARLAMA_VERI ? resolve(process.env.MOLA_PAZARLAMA_VERI) : resolve(KLASOR, '..', '.local', 'pazarlama');
export const VERI_DOSYASI = join(VERI_KLASORU, 'veri.json');
export const ONBELLEK = join(VERI_KLASORU, 'onbellek');
export const AYAR_DOSYASI = join(KLASOR, 'ayarlar.json');

export function yeniId(): string { return randomBytes(6).toString('hex'); }

function guvenliYaz(dosya: string, icerik: string) {
  mkdirSync(dirname(dosya), { recursive: true });
  const gecici = `${dosya}.${process.pid}.tmp`;
  writeFileSync(gecici, icerik, 'utf8');
  for (let deneme = 0; ; deneme++) {
    try { renameSync(gecici, dosya); return; } catch (e) {
      if (deneme >= 5) throw e;
      const bitis = Date.now() + 100 * (deneme + 1);
      while (Date.now() < bitis) { /* kısa bekleme: OneDrive kilidi */ }
    }
  }
}

export class Depo {
  isletmeler: Isletme[] = [];
  constructor(readonly dosya = VERI_DOSYASI) {
    if (existsSync(dosya)) {
      const ham = JSON.parse(readFileSync(dosya, 'utf8')) as { isletmeler?: Partial<Isletme>[] };
      // Eski sürümde olmayan alanlar boş değerle tamamlanır.
      this.isletmeler = (ham.isletmeler ?? []).map((k) => ({ ...bosIsletme(k.id ?? yeniId(), k.ad ?? ''), ...k }) as Isletme);
    }
  }
  kaydet() { guvenliYaz(this.dosya, JSON.stringify({ surum: 1, kaydedildi: new Date().toISOString(), isletmeler: this.isletmeler }, null, 1)); }
  bul(id: string) { return this.isletmeler.find((k) => k.id === id); }
}

export function ayarlariOku(dosya = AYAR_DOSYASI): Ayarlar {
  try { return ayarlarBirlestir(JSON.parse(readFileSync(dosya, 'utf8'))); } catch { return ayarlarBirlestir(null); }
}

export function onbellekOku<T>(ad: string, enFazlaSaat: number): { zaman: string; veri: T } | null {
  try {
    const k = JSON.parse(readFileSync(join(ONBELLEK, ad), 'utf8')) as { zaman: string; veri: T };
    return Date.now() - Date.parse(k.zaman) < enFazlaSaat * 3_600_000 ? k : null;
  } catch { return null; }
}
export function onbellekYaz(ad: string, veri: unknown) { guvenliYaz(join(ONBELLEK, ad), JSON.stringify({ zaman: new Date().toISOString(), veri })); }

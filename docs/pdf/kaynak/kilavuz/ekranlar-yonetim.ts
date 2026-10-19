/* Mola Yönetim ekranları (yalnız satıcının kılavuzu için). Geçici test Merkez'i (sunucular.ts), örnek işletmeler. */
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { request as pwRequest, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { totp } from '../../../../server/totp.ts';
import { SITE_CONSENT_VERSION } from '../../../../packages/domain/site-lead.ts';
import { validTaxNumber } from '../../../../packages/domain/invoice.ts';
import type { Grup } from './ekranlar.ts';
import { ADMIN_PASSWORD, MERKEZ } from './sunucular.ts';
import { EKRAN, cek, dene, sleep, yeniSayfa } from './cekim.ts';

const ADMIN = `${MERKEZ}/api/merkez/admin`;
let factor: { secret: string; used: number } | undefined;
/** Sıradaki kullanılmamış Authenticator kodu (her kod bir kez geçer). */
async function kod() {
  for (;;) {
    const now = Math.floor(Date.now() / 30000), step = Math.max(now, factor!.used + 1);
    if (step <= now + 1) { factor!.used = step; return totp(factor!.secret, step * 30000); }
    await sleep(1000);
  }
}
export async function adminApi(): Promise<APIRequestContext> {
  const api = await pwRequest.newContext();
  const r = await api.post(`${ADMIN}/login`, { data: { username: 'admin', password: ADMIN_PASSWORD, ...(factor ? { code: await kod() } : {}) } });
  if (!r.ok()) throw new Error(`Mola Yönetim girişi: ${await r.text()}`);
  return api;
}
/** İki adımlı girişi (Authenticator) açar: fiyat, paket, ödeme, duyuru ve yayın bunu ister. */
async function ikiAdim() {
  if (factor) return;
  const api = await adminApi();
  const setup = await (await api.post(`${ADMIN}/mfa/setup`, { data: { password: ADMIN_PASSWORD } })).json();
  factor = { secret: setup.secret, used: Math.floor(Date.now() / 30000) - 1 };
  const r = await api.post(`${ADMIN}/mfa/enable`, { data: { code: await kod(), saved: true } });
  if (!r.ok()) throw new Error(`İki adımlı giriş açılamadı: ${await r.text()}`);
  await api.dispose();
}
const dugme = (scope: Page | Locator, ad: string | RegExp) => scope.getByRole('button', { name: ad, exact: typeof ad === 'string' }).first();
const nav = (p: Page) => p.getByRole('navigation', { name: 'Mola Yönetim bölümleri' });
async function bolum(p: Page, ad: string) { await dugme(nav(p), ad).click(); await sleep(1200); await p.evaluate(() => scrollTo(0, 0)); }
async function ayarBolumu(p: Page, ad: string) {
  // Yedek ve Güncellemeler sol menüde kendi sayfalarıdır; Paketler de (Hizmet fiyatları onun alt sekmesi).
  if (ad === 'Yedek' || ad === 'Güncellemeler') return bolum(p, ad);
  const paket = ad === 'Paketler' || ad === 'Hizmet fiyatları';
  await bolum(p, paket ? 'Paketler' : 'Ayarlar');
  await p.getByRole('navigation', { name: paket ? 'Paketler bölümleri' : 'Ayarlar bölümleri' }).getByRole('button', { name: ad, exact: true }).click();
  await sleep(1200); await p.evaluate(() => scrollTo(0, 0));
}
/** Doğrulayıcı onayı kutusu açıldıysa kodu yazar (10 dakikalık pencere açılır). */
async function onayla(p: Page, ad?: string) {
  const box = p.getByRole('form', { name: 'Doğrulayıcı onayı' });
  // isVisible() beklemez (timeout'u yok sayar): kutu biraz geç açılırsa onay atlanır ve sayfa kilitli kalırdı.
  if (!await box.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) return;
  if (ad) await dene(ad, () => cek(p, ad, { kirp: box, pay: 16, isaretler: [{ n: 1, loc: box.getByLabel('Doğrulayıcı kodu', { exact: true }), yon: 'sol' }, { n: 2, loc: dugme(box, 'Onayla ve devam et'), yon: 'sol' }] }));
  await box.getByLabel('Doğrulayıcı kodu', { exact: true }).fill(await kod());
  await dugme(box, 'Onayla ve devam et').click();
  await box.waitFor({ state: 'hidden' }).catch(() => {});
  await sleep(800);
}
async function isletmeAc(p: Page, ad: string) {
  await bolum(p, 'İşletmeler');
  await p.getByRole('searchbox', { name: 'İşletme ara' }).fill(ad);
  await sleep(500);
  await p.locator('.platform-business-row').filter({ hasText: ad }).first().click();
  await sleep(1200);
  return p.getByRole('region', { name: ad, exact: true });
}
const sekme = (d: Locator, ad: string) => d.getByRole('navigation', { name: 'İşletme yönetimi' }).getByRole('button', { name: ad, exact: true });

/** Eski (yine güncel) bir ekran görüntüsünü kılavuza alır: docs/ekran/<yol> → ekran/<ad>.png. */
async function eskiGoruntu(ad: string, yol: string, olcek = 1, yukseklik?: number) {
  const src = resolve('docs/ekran', yol);
  if (!existsSync(src)) return;
  const dst = join(EKRAN, `${ad}.png`);
  const full = await sharp(src).metadata();
  if (yukseklik && full.height! > yukseklik) await sharp(src).extract({ left: 0, top: 0, width: full.width!, height: yukseklik }).toFile(dst);
  else copyFileSync(src, dst);
  const meta = await sharp(dst).metadata();
  const file = join(EKRAN, 'isaretler.json');
  const all = JSON.parse(readFileSync(file, 'utf8'));
  all[ad] = { w: Math.round(meta.width! / olcek), h: Math.round(meta.height! / olcek), isaretler: all[ad]?.isaretler ?? [], tarih: new Date().toISOString(), kaynak: `docs/ekran/${yol}` };
  writeFileSync(file, JSON.stringify(all, null, 1));
  console.log(`  ✓ ${ad} (docs/ekran/${yol})`);
}

const yonetim: Grup = async browser => {
  // Bir hesap açma başvurusu ve bir web sitesi talebi (Başvurular sayfası boş kalmasın).
  const pub = await pwRequest.newContext();
  await pub.post(`${MERKEZ}/api/merkez/v1/applications`, { data: { requestId: randomUUID().replace(/-/g, ''), installId: randomUUID(), machineId: 'b'.repeat(64), appVersion: '0.1.0',
    businessName: 'Çınaraltı Çay Bahçesi', sector: 'cafe', contactName: 'Ayşe Yılmaz', consent: true,
    invoice: { legalName: 'Çınaraltı Gıda Ltd. Şti.', taxOffice: 'Harput', taxType: 'company', taxNumber: '1111111114', city: 'Elazığ', district: 'Merkez', address: 'Hürriyet Cd. No: 12', phone: '+905321234567', email: 'cinaralti@example.com' } } });
  const form = await (await pub.get(`${MERKEZ}/api/site/form`)).json().catch(() => ({}));
  if (form.token) {
    await sleep(4500);
    await pub.post(`${MERKEZ}/api/site/talep`, { data: { business: 'Köşebaşı Kahve', person: 'Mert Demir', phone: '0532 765 43 21', email: 'mert@example.com', city: 'Malatya', tables: '14', type: 'kafe', message: 'Öğleden sonra arayabilirsiniz.', consent: true, consentVersion: SITE_CONSENT_VERSION, website: '', token: form.token } });
  }
  await pub.dispose();
  await ikiAdim();
  // Örnek işletmenin fatura ve iletişim bilgileri (Bilgiler sekmesi boş görünmesin).
  await dene('fatura-bilgileri', async () => {
    const api = await adminApi();
    const st = await (await api.get(`${ADMIN}/state`)).json();
    const b = st.businesses?.find((x: any) => x.name === 'Mola Örnek Kafe');
    if (b && !b.invoice) {
      let vkn = 4560000000; while (!validTaxNumber('company', String(vkn))) vkn++;
      const r = await api.post(`${ADMIN}/invoice`, { data: { requestId: randomUUID().replace(/-/g, ''), tenantId: b.tenantId, invoice: { legalName: 'Mola Örnek Kafe Gıda Ltd. Şti.', taxOffice: 'Harput', taxType: 'company', taxNumber: String(vkn),
        city: 'Elazığ', district: 'Merkez', address: 'Gazi Cd. No: 8', phone: '+905321112233', email: 'ornekkafe@example.com' } } });
      if (!r.ok()) throw new Error(`Fatura bilgileri: ${await r.text()}`);
    }
    await api.dispose();
  });

  const p = await yeniSayfa(browser, 'masaustu', { yukseklik: 900 });
  await p.goto(`${MERKEZ}/`);
  await p.getByLabel('Şifre', { exact: true }).waitFor();
  await dene('y-giris', () => cek(p, 'y-giris', { isaretler: [{ n: 1, loc: p.getByLabel('Şifre', { exact: true }), yon: 'sol' }] }));
  await p.getByLabel('Şifre', { exact: true }).fill(ADMIN_PASSWORD);
  await dugme(p, 'Giriş yap').click();
  const kodAlani = p.getByLabel('Authenticator veya kurtarma kodu', { exact: true });
  await kodAlani.waitFor();
  await dene('y-giris-kod', () => cek(p, 'y-giris-kod', { isaretler: [{ n: 1, loc: kodAlani, yon: 'sol' }] }));
  await kodAlani.fill(await kod());
  await dugme(p, 'Doğrula ve giriş yap').click();
  await dugme(p, 'Çıkış yap').waitFor();
  await sleep(1500);

  await dene('y-bugun', () => cek(p, 'y-bugun', { kirp: 'ekran', isaretler: [
    { n: 1, loc: nav(p), yon: 'sag' },
    { n: 2, loc: p.getByRole('list', { name: 'Bugün yapılacaklar' }), yon: 'sol' },
    { n: 3, loc: p.getByRole('button', { name: /^Bildirim merkezi/ }), yon: 'alt' },
  ] }));
  await p.getByRole('button', { name: /^Bildirim merkezi/ }).click(); await sleep(1200);
  await dene('y-bildirim-merkezi', () => cek(p, 'y-bildirim-merkezi'));

  await bolum(p, 'İşletmeler');
  await dene('y-isletmeler', () => cek(p, 'y-isletmeler', { isaretler: [
    { n: 1, loc: p.getByRole('searchbox', { name: 'İşletme ara' }), yon: 'alt' },
    { n: 2, loc: p.locator('.platform-business-row').first(), yon: 'sag' },
    { n: 3, loc: dugme(p, 'CSV indir'), yon: 'sol' },
  ] }));

  const d = await isletmeAc(p, 'Mola Örnek Kafe');
  // QR siparişleri (kafenin tünelden söylediği) Özet'in büyük bilgileri arasında.
  // Özet (8 Ekim): 12 kare gösterge; QR siparişleri ve İnternetten menü bunların arasında.
  const kare = (ad: string) => d.locator('.detail-facts > div').filter({ has: p.locator('dt', { hasText: ad }) }).first();
  await p.setViewportSize({ width: 1280, height: 1000 }); await sleep(500);
  await dene('y-isletme-ozet', () => cek(p, 'y-isletme-ozet', { isaretler: [{ n: 1, loc: d.getByRole('navigation', { name: 'İşletme yönetimi' }), yon: 'alt' }, { n: 2, loc: kare('Lisans bitişi'), yon: 'alt' }, { n: 3, loc: kare('QR siparişleri'), yon: 'sol' }, { n: 4, loc: kare('İnternetten menü'), yon: 'alt' }] }));
  await p.setViewportSize({ width: 1280, height: 900 });
  // "Diğer bilgiler" açılır kartı: İnternetten menü sayaçları ve Menünün kopyası.
  await dene('y-internet-menu', async () => {
    const diger = d.getByRole('region', { name: 'Diğer bilgiler' });
    await diger.locator('summary').click(); await sleep(500);
    await diger.scrollIntoViewIfNeeded(); await sleep(400);
    const satir = (ad: string) => diger.locator('.detail-more > div').filter({ has: p.locator('dt', { hasText: ad }) }).first();
    await cek(p, 'y-internet-menu', { kirp: diger, pay: 12, isaretler: [{ n: 1, loc: satir('İnternetten menü'), yon: 'sol' }, { n: 2, loc: satir('Menünün kopyası'), yon: 'sol' }] });
    await diger.locator('summary').click(); await sleep(300);
  });
  await p.evaluate(() => scrollTo(0, 0));
  await sekme(d, 'Lisans').click(); await sleep(1000);
  await p.setViewportSize({ width: 1280, height: 1500 }); await sleep(600);
  await dene('y-isletme-lisans', () => cek(p, 'y-isletme-lisans', { kirp: [d.getByRole('navigation', { name: 'İşletme yönetimi' }), d.getByRole('group', { name: 'Abonelik planı' })], pay: 24, isaretler: [
    { n: 1, loc: d.getByRole('group', { name: 'Ödeme alındı' }), yon: 'sol' },
    { n: 2, loc: dugme(d, '1 ay uzat'), yon: 'ust' },
    { n: 3, loc: d.getByRole('group', { name: 'Abonelik planı' }), yon: 'sol' },
  ] }));
  const dondur = d.getByLabel('Hizmeti dondurma').first();
  await p.setViewportSize({ width: 1280, height: 2300 }); await sleep(400);
  await dondur.evaluate(e => { e.scrollIntoView({ block: 'start' }); scrollBy(0, -40); }); await sleep(500);
  await dene('y-isletme-lisans-2', () => cek(p, 'y-isletme-lisans-2', { kirp: [dondur, d.getByRole('region', { name: 'Dikkat' })], pay: 16, isaretler: [
    { n: 1, loc: dondur, yon: 'sol' },
    { n: 2, loc: d.getByText(/Lisans sözleşmesi:/).first(), yon: 'sol' },
    { n: 3, loc: dugme(d, /Sahip şifresi/), yon: 'sol' },
    { n: 4, loc: dugme(d, 'Askıya al'), yon: 'sol' },
  ] }));
  await p.evaluate(() => scrollTo(0, 0));
  // Ödeme alındı + 1 ay uzat: Satışlarım'a kayıt düşer; doğrulayıcı onayı ister.
  await dugme(d, '1 ay uzat').click();
  await dugme(d, 'Emin misiniz? 1 ay eklenir').click().catch(() => {});
  await onayla(p, 'y-adim-onayi');
  await sleep(1200);
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => scrollTo(0, 0));
  await sekme(d, 'Hizmet').click(); await sleep(1000);
  await p.setViewportSize({ width: 1280, height: 2000 }); await sleep(500);
  await dene('y-isletme-hizmet', () => cek(p, 'y-isletme-hizmet', { kirp: [d.getByRole('navigation', { name: 'İşletme yönetimi' }), d.getByLabel('Bu işletme için fiyat').first()], pay: 24, isaretler: [
    { n: 1, loc: d.getByRole('region', { name: 'Hizmet durumu' }).or(d.getByLabel('Hizmet durumu')).first(), yon: 'sol' },
    { n: 2, loc: d.getByLabel('Hizmet paketi').first(), yon: 'sol' },
    { n: 3, loc: d.getByRole('radio', { name: /^Özel/ }), yon: 'sol' },
    { n: 4, loc: d.getByLabel('Bu işletme için fiyat').first(), yon: 'sol' },
  ] }));
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => scrollTo(0, 0));
  await sekme(d, 'Bilgiler').click(); await sleep(1000);
  // Bilgiler (8 Ekim): İletişim · Adres, Fatura bilgileri, Sosyal medya · Cihaz ve kurulum kartları.
  await p.setViewportSize({ width: 1280, height: 1150 }); await sleep(500);
  await dene('y-isletme-bilgiler', () => cek(p, 'y-isletme-bilgiler', { isaretler: [
    { n: 1, loc: d.getByRole('region', { name: 'İletişim' }).first(), yon: 'sag' },
    { n: 2, loc: d.getByRole('region', { name: 'Fatura bilgileri' }), yon: 'sol' },
  ] }));
  const sosyal = d.getByRole('region', { name: 'Sosyal medya' }), cihaz = d.getByRole('region', { name: 'Cihaz ve kurulum' });
  await p.setViewportSize({ width: 1280, height: 1800 }); await sleep(500);
  await dene('y-isletme-sosyal', async () => {
    await sosyal.evaluate(e => { e.scrollIntoView({ block: 'start' }); scrollBy(0, -30); }); await sleep(400);
    await cek(p, 'y-isletme-sosyal', { kirp: [sosyal, cihaz], pay: 14, isaretler: [{ n: 1, loc: sosyal, yon: 'ust' }, { n: 2, loc: cihaz, yon: 'ust' }] });
  });
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => scrollTo(0, 0));
  await sekme(d, 'Destek').click(); await sleep(1000);
  await dene('y-isletme-destek', () => cek(p, 'y-isletme-destek', { isaretler: [{ n: 1, loc: dugme(d, 'Yeni mesaj'), yon: 'alt' }] }));
  await dugme(d, 'Yeni mesaj').click();
  const ym = p.getByRole('dialog', { name: 'Yeni mesaj' });
  await ym.getByLabel('Konu').fill('Yıllık aboneliğiniz');
  await ym.getByLabel('Mesaj').fill('Merhaba Serkan Bey, aboneliğiniz ay sonunda yenilenecek. Yıllık plana geçmek isterseniz buradan yazabilirsiniz.');
  await dene('y-yeni-mesaj', () => cek(p, 'y-yeni-mesaj', { kirp: ym, pay: 12 }));
  await dugme(ym, 'Gönder').click(); await sleep(1500);

  await bolum(p, 'Başvurular');
  await dene('y-basvurular', () => cek(p, 'y-basvurular', { isaretler: [
    { n: 1, loc: dugme(p, '30 günlük denemeyi başlat'), yon: 'ust' },
    { n: 2, loc: dugme(p, 'Reddet'), yon: 'ust' },
  ] }));
  const web = p.getByRole('button', { name: /Web sitesi talepleri/ }).first();
  if (await web.isVisible().catch(() => false)) {
    await web.click(); await sleep(1000);
    await dene('y-web-talepleri', () => cek(p, 'y-web-talepleri', { isaretler: [
      { n: 1, loc: web, yon: 'alt' }, { n: 2, loc: dugme(p, 'Arandı'), yon: 'ust' }, { n: 3, loc: dugme(p, 'İşletme ekle'), yon: 'ust' },
    ] }));
  }
  await bolum(p, 'Destek');
  await dene('y-destek', () => cek(p, 'y-destek'));

  // Duyuru: Önemli, bütün işletmelere.
  await bolum(p, 'Duyurular');
  await dugme(p, 'Yeni duyuru').click(); await sleep(800);
  const c = p.getByRole('region', { name: 'Yeni duyuru' });
  await c.getByLabel('Başlık').fill('Pazar gecesi kısa bakım');
  await c.getByLabel('Metin').fill('Merhaba,\nPazar gecesi 02:00–02:30 arasında Mola Merkez’de kısa bir bakım yapacağız. Siparişler ve kasa her zamanki gibi çalışır; yalnız destek mesajları bakım bitince gider.');
  await c.getByText('Önemli', { exact: true }).click();
  await sleep(600);
  await p.setViewportSize({ width: 1280, height: 1250 }); await sleep(500);
  await dene('y-duyuru-yaz', () => cek(p, 'y-duyuru-yaz', { isaretler: [
    { n: 1, loc: c.getByLabel('Başlık'), yon: 'sol' },
    { n: 2, loc: c.getByRole('radio').first(), yon: 'sol' },
    { n: 3, loc: c.getByText('Önemli', { exact: true }).first(), yon: 'sol' },
    { n: 4, loc: p.getByRole('complementary', { name: 'Önizleme' }), yon: 'sol' },
  ] }));
  await dugme(c, 'Duyuruyu gönder').click();
  await onayla(p);
  await sleep(1500);
  await p.setViewportSize({ width: 1280, height: 900 });
  await dene('y-duyurular', () => cek(p, 'y-duyurular', { isaretler: [{ n: 1, loc: p.locator('.ann-row').first(), yon: 'alt' }] }));

  await dene('y-duyuru-okuma', async () => {
    const row = p.locator('.ann-row').first();
    await row.getByRole('button', { name: /Pazar gecesi kısa bakım/ }).first().click(); await sleep(1000);
    await cek(p, 'y-duyuru-okuma', { kirp: row, pay: 12 });
  });
  await bolum(p, 'Satışlarım');
  await dene('y-satislarim', () => cek(p, 'y-satislarim', { isaretler: [{ n: 1, loc: dugme(p, 'Excel'), yon: 'alt' }, { n: 2, loc: dugme(p, 'PDF'), yon: 'alt' }] }));

  for (const [ad, dosya] of [['Hesap güvenliği', 'y-hesap-guvenligi'], ['Kullanıcılar', 'y-kullanicilar'], ['Paketler', 'y-paketler'], ['Hizmet fiyatları', 'y-hizmet-fiyatlari'], ['Yedek', 'y-yedek'], ['Güncellemeler', 'y-guncellemeler'],
    ['E-posta bildirimleri', 'y-eposta'], ['İletişim bilgileri', 'y-iletisim'], ['İşlem kayıtları', 'y-islem-kayitlari'], ['Çalışma klasörü', 'y-calisma-klasoru'], ['Geliştirici erişimi', 'y-gelistirici']] as const) {
    await dene(dosya, async () => {
      await ayarBolumu(p, ad);
      // Kullanıcılar (13 Ekim): an example filled in, never saved.
      if (dosya === 'y-kullanicilar') { await p.getByLabel('Adı ve soyadı').fill('Prof. Dr. Ayşe Yılmaz').catch(() => {}); await p.getByLabel('Kullanıcı adı', { exact: true }).fill('ayse.yilmaz').catch(() => {}); }
      if (dosya === 'y-iletisim') {
        // Mola ekibinin iletişim bilgileri: kafelerde "Mola ekibine ulaşın" düğmeleri bunlardan çıkar.
        const tel = p.getByLabel(/Telefon/).first();
        if (await tel.isVisible().catch(() => false) && !(await tel.inputValue())) {
          await tel.fill('0850 123 45 67');
          await p.getByLabel(/WhatsApp/).first().fill('0532 765 43 21').catch(() => {});
          await p.getByLabel(/E-posta/).first().fill('destek@molayazilim.com.tr').catch(() => {});
          await p.getByLabel(/Çalışma saatleri/).first().fill('Hafta içi 09:00–18:00').catch(() => {});
          // Sosyal medya (19 Ekim): yalnız web sitesinin altbilgisi.
          await p.getByLabel('Instagram', { exact: true }).fill('https://www.instagram.com/molayazilim/').catch(() => {});
          await p.getByLabel('YouTube', { exact: true }).fill('https://www.youtube.com/@molayazilim').catch(() => {});
          await dugme(p, 'İletişim bilgilerini kaydet').click().catch(() => {}); await onayla(p); await sleep(1000);
        }
      }
      await p.setViewportSize({ width: 1280, height: dosya === 'y-paketler' || dosya === 'y-yedek' ? 1300 : dosya === 'y-iletisim' ? 1100 : 900 });
      await sleep(500);
      if (dosya === 'y-iletisim') {
        const panel = p.getByRole('region', { name: 'Mola ekibi iletişim bilgileri' });
        await cek(p, dosya, { kirp: panel, pay: 16, isaretler: [
          { n: 1, loc: p.getByLabel(/Telefon/).first(), yon: 'ust' },
          { n: 2, loc: panel.locator('.contact-social-title'), yon: 'ust' },
          { n: 3, loc: dugme(panel, 'İletişim bilgilerini kaydet'), yon: 'sag' },
        ] });
        await p.setViewportSize({ width: 1280, height: 900 });
        return;
      }
      // İşlem kayıtları (8 Ekim): bütünlük kartı, Rapor al, dönem çipleri, diğer süzgeçler "Süzgeçler"de.
      if (dosya === 'y-islem-kayitlari') await cek(p, dosya, { isaretler: [
        { n: 1, loc: p.getByRole('status', { name: 'Bütünlük denetimi' }), yon: 'alt' },
        { n: 2, loc: p.getByRole('region', { name: 'Rapor al' }), yon: 'alt' },
        { n: 3, loc: dugme(p, 'Başarısız olanlar'), yon: 'alt' },
        { n: 4, loc: dugme(p, 'Süzgeçler'), yon: 'alt' },
      ] });
      else await cek(p, dosya);
      await p.setViewportSize({ width: 1280, height: 900 });
    });
  }
  await dene('y-paket-olustur', async () => {
    await ayarBolumu(p, 'Paketler');
    await dugme(p, 'Yeni paket').click(); await sleep(1000);
    await p.getByLabel('Paket adı').fill('Bahçe Plus').catch(() => {});
    await p.setViewportSize({ width: 1280, height: 1300 }); await sleep(500);
    await cek(p, 'y-paket-olustur', { isaretler: [{ n: 1, loc: p.getByLabel('Paket adı'), yon: 'sol' }, { n: 2, loc: p.getByLabel('Paket toplamı').or(p.getByText(/Aylık toplam|aylık/i)).first(), yon: 'sol' }] });
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.keyboard.press('Escape');
  });
  await dene('y-guncelleme-yetkisi', async () => {
    await ayarBolumu(p, 'Güncellemeler');
    const y = p.getByRole('region', { name: 'Güncelleme yetkisi' });
    if (await y.isVisible().catch(() => false)) await cek(p, 'y-guncelleme-yetkisi', { kirp: y, pay: 12 });
  });

  // Son: örnek işletmeyi "Kafe Standart" paketine geçir (kafede kilitli hizmetler görünsün).
  const d2 = await isletmeAc(p, 'Mola Örnek Kafe');
  await sekme(d2, 'Hizmet').click(); await sleep(1000);
  await d2.getByRole('radio', { name: /^Kafe Standart/ }).click();
  await sleep(800);
  const deg = d2.getByRole('region', { name: 'Değişikliği onayla' });
  // Hizmet sekmesi uzun: yalnız alttaki "Değişiklik" bölümü ve düğmesi.
  await p.setViewportSize({ width: 1280, height: 1200 }); await sleep(400);
  await deg.evaluate(e => { e.scrollIntoView({ block: 'start' }); scrollBy(0, -30); }); await sleep(600);
  await dene('y-hizmet-degisiklik', () => cek(p, 'y-hizmet-degisiklik', { kirp: [deg, dugme(d2, 'Değişikliği uygula')], pay: 16, isaretler: [{ n: 1, loc: deg, yon: 'sol' }, { n: 2, loc: dugme(d2, 'Değişikliği uygula'), yon: 'sag' }] }));
  await dugme(d2, 'Değişikliği uygula').click();
  await onayla(p);
  await sleep(6000); // kafenin kalp atışı (2 sn) yeni lisansı alsın
  await p.context().close();

  // Eski ama güncel görüntüler: dosya bütünlüğü uyarısı (gerçek bir değişmiş kurulum gerektirir) ve web sitesi.
};

/** Eski ama güncel görüntüler: kurulması uzun süren durumlar (kapanmış yıl, değişmiş program dosyası) ve web sitesi. */
const eski: Grup = async () => {
  await eskiGoruntu('y-dosya-degisti', 'yonetim/dosya-degisti.png');
  await eskiGoruntu('w-ana-sayfa', 'site/ana-sayfa.png', 1, 900);
  await eskiGoruntu('w-iletisim', 'site/iletisim.png', 1, 1150);
  await eskiGoruntu('k-kapali-yil', 'kafe/kapali-yil-uyari.png');
};

export const gruplarYonetim: Record<string, Grup> = { yonetim, eski };

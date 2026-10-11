/* Müşteri hikâyesi: misafir mobil veriyle Masa 5'in QR'ını okutur, sipariş verir; garson, mutfak, kasa. */
import type { Grup } from './ekranlar.ts';
import { KAFE } from './sunucular.ts';
import { cek, dene, giris, sesiAc, sleep, yeniSayfa } from './cekim.ts';

const dugme = (scope: import('@playwright/test').Page | import('@playwright/test').Locator, ad: string) => scope.getByRole('button', { name: ad, exact: true }).first();

export const misafir: Grup = async (browser, { sahip, durum, id, ok }) => {
  let base = '';
  for (let i = 0; i < 60 && !base; i++) { const n = await (await sahip.get('/api/staff/network')).json(); if (n.public?.connected) base = n.public.base; else await sleep(500); }
  if (!base) throw new Error('İnternetten menü adresi hazır değil.');
  let s = await durum();
  await ok(await sahip.post('/api/staff/social-links', { data: { requestId: id(), version: s.businessRevision, links: { instagram: '@molaornekkafe', review: 'https://g.page/r/mola-ornek-kafe/review' } } }), 'sosyal medya');
  s = await durum();
  // Hikâyenin masası Masa 05; bir önceki deneme onu doldurduysa ilk boş masa.
  const masa = s.tables.find((t: any) => t.name === 'Masa 05' && !t.account) ?? s.tables.find((t: any) => !t.account && !t.needsCleaning);
  const M = masa.name as string;
  const url = `${base}/${masa.token}`;

  // Misafirin telefonu mobil veride: kafe bilgisayarına hiç ulaşamaz, yalnız Mola Merkez'e.
  const g = await yeniSayfa(browser, 'telefon');
  await g.context().route(`${KAFE}/**`, r => r.abort());
  await g.goto(url);
  const latte = g.locator('.product-card').filter({ hasText: 'Caffè Latte' }).first();
  await latte.waitFor({ timeout: 20000 });
  await sleep(800);
  await dene('m-menu', () => cek(g, 'm-menu', { isaretler: [
    { n: 1, loc: g.locator('.table-pill'), yon: 'alt' },
    { n: 2, loc: g.getByRole('button', { name: 'Garson çağır' }), yon: 'alt' },
    { n: 3, loc: g.getByRole('button', { name: 'Kahveler', exact: true }), yon: 'alt' },
    { n: 4, loc: latte, yon: 'sag' },
  ] }));
  await latte.click();
  const urun = g.getByRole('dialog');
  await urun.waitFor();
  await dene('m-urun', () => cek(g, 'm-urun', { isaretler: [
    { n: 1, loc: urun.getByRole('radio', { name: /Standart/ }), yon: 'sag' },
    { n: 2, loc: urun.getByRole('button', { name: 'Adedi artır' }), yon: 'ust' },
    { n: 3, loc: urun.getByRole('button', { name: /Sepete ekle/ }), yon: 'ust' },
  ] }));
  await urun.getByRole('button', { name: 'Adedi artır' }).click();
  await urun.getByRole('button', { name: /Sepete ekle/ }).click();
  await urun.waitFor({ state: 'hidden' });
  const cake = g.locator('.product-card').filter({ hasText: 'San Sebastian' }).first();
  await cake.scrollIntoViewIfNeeded(); await cake.click();
  await g.getByRole('dialog').getByRole('button', { name: /Sepete ekle/ }).click();
  await g.getByRole('dialog').waitFor({ state: 'hidden' }).catch(() => {});
  const sepetDugme = g.getByRole('button', { name: /Sepet(imi|i) görüntüle/ });
  await sepetDugme.click();
  const gonder = g.getByRole('button', { name: 'Siparişi gönder', exact: true });
  await gonder.waitFor();
  await dene('m-sepet', () => cek(g, 'm-sepet', { isaretler: [
    { n: 1, loc: g.getByRole('dialog').getByText('Caffè Latte').last(), yon: 'sag' },
    { n: 2, loc: g.getByRole('dialog').getByText(/San Sebastian/).last(), yon: 'sag' },
    { n: 3, loc: gonder, yon: 'ust' },
  ] }));
  await gonder.click();
  const alindi = g.getByRole('dialog', { name: /Siparişiniz/ });
  await alindi.waitFor();
  await dene('m-gonderildi', () => cek(g, 'm-gonderildi', { isaretler: [{ n: 1, loc: alindi.getByRole('heading').first(), yon: 'alt' }] }));
  await alindi.getByRole('button', { name: 'Tamam', exact: true }).click();

  // Garson onayı (Ayarlar'da "QR siparişlerini garson onaylasın" açıksa).
  const garson = await yeniSayfa(browser, 'telefon');
  await giris(garson, 'garson');
  await sesiAc(garson);
  // The approval card: the smallest box with "Masa 05 · #…" and its "Onayla ve mutfağa gönder" (no longer an article.report-row).
  const onayKart = garson.locator('article, li, div').filter({ hasText: new RegExp(`${M} · #`) }).filter({ has: garson.getByRole('button', { name: /Onayla ve mutfağa gönder/ }) }).last();
  // The waiter's phone folds the waiting approvals into "N QR siparişi onay bekliyor · Göster" (8 Ekim, K6); isVisible does
  // not wait, so the list is opened and waited for (up to 10 s) before the picture.
  const goster = garson.getByRole('button', { name: /Göster$/ }).first();
  await goster.or(onayKart).first().waitFor({ timeout: 10000 }).catch(() => {});
  if (await goster.isVisible().catch(() => false)) await goster.click().catch(() => {});
  if (await onayKart.waitFor({ timeout: 10000 }).then(() => true, () => false)) {
    const onay = onayKart.getByRole('button', { name: /Onayla ve mutfağa gönder/ });
    await onay.scrollIntoViewIfNeeded();
    await garson.evaluate(() => scrollBy(0, 160));
    await dene('g-qr-onay', () => cek(garson, 'g-qr-onay', { isaretler: [
      { n: 1, loc: onayKart.getByText(new RegExp(`${M} · #`)).first(), yon: 'sag' },
      { n: 2, loc: onay, yon: 'ust' },
      { n: 3, loc: onayKart.getByRole('button', { name: /Reddet/ }), yon: 'ust' },
    ] }));
    await onay.click();
    await sleep(1000);
  }

  // Mutfak ekranı (tablet yatay).
  const mutfak = await yeniSayfa(browser, 'tablet');
  await giris(mutfak, 'mutfak');
  await sesiAc(mutfak);
  const kart = () => mutfak.locator('article.kitchen-card').filter({ has: mutfak.getByRole('heading', { name: M, exact: true }) }).last();
  await kart().waitFor({ timeout: 15000 }).catch(async e => { if (process.env.KILAVUZ_DEBUG) console.log('MUTFAK:', (await mutfak.locator('body').innerText()).slice(0, 1500), '\nGARSON:', (await garson.locator('body').innerText()).slice(0, 1500)); throw e; });
  await kart().scrollIntoViewIfNeeded();
  await sleep(500);
  // QR siparişinde misafir ilk dakikada siparişini değiştirebilir; mutfak o süre bitince başlar.
  const degis = kart().getByText(/Müşteri değiştirebilir/);
  if (await degis.isVisible().catch(() => false)) {
    await dene('k-degistirebilir', () => cek(mutfak, 'k-degistirebilir', { kirp: kart(), pay: 16, isaretler: [
      { n: 1, loc: kart().getByRole('heading', { name: M, exact: true }), yon: 'sag' },
      { n: 2, loc: degis, yon: 'alt' },
    ] }));
  }
  await kart().getByRole('button', { name: 'Hazırlamaya başla' }).waitFor({ timeout: 80000 });
  await kart().scrollIntoViewIfNeeded();
  await dene('k-yeni', () => cek(mutfak, 'k-yeni', { isaretler: [
    { n: 1, loc: kart().getByRole('heading', { name: M, exact: true }), yon: 'sag' },
    { n: 2, loc: kart().getByRole('button', { name: 'Hazırlamaya başla' }), yon: 'alt' },
    { n: 3, loc: mutfak.locator('.kitchen-bar, header').first(), yon: 'alt' },
  ] }));
  await kart().getByRole('button', { name: 'Hazırlamaya başla' }).click();
  await sleep(1200);
  await kart().getByRole('button', { name: 'Hazır olarak işaretle' }).click();
  await sleep(1500);

  // Garsonun telefonunda "Servise hazır".
  const bar = garson.getByRole('navigation', { name: 'Alt menü' });
  await bar.getByRole('button', { name: /^Servise hazır/ }).click();
  await sleep(900);
  const hazir = garson.locator('article, li').filter({ hasText: M }).filter({ has: garson.getByRole('button', { name: /Teslim edildi|Servis edildi|Teslim et/ }) }).last();
  await hazir.scrollIntoViewIfNeeded().catch(() => {});
  await dene('g-servise-hazir', () => cek(garson, 'g-servise-hazir', { isaretler: [
    { n: 1, loc: bar.getByRole('button', { name: /^Servise hazır/ }), yon: 'ust' },
    { n: 2, loc: hazir.getByText(M).first(), yon: 'sag' },
    { n: 3, loc: hazir.getByRole('button', { name: /Teslim edildi|Servis edildi|Teslim et/ }), yon: 'ust' },
  ] }));
  await hazir.getByRole('button', { name: /Teslim edildi|Servis edildi|Teslim et/ }).click();
  await sleep(1200);

  // Misafir: Siparişlerim, sonra hesap.
  await g.getByRole('button', { name: /^Siparişlerim/ }).first().click();
  await sleep(1000);
  await dene('m-siparislerim', () => cek(g, 'm-siparislerim', { isaretler: [
    { n: 1, loc: g.getByRole('button', { name: /^Siparişlerim/ }).first(), yon: 'alt' },
    { n: 2, loc: g.getByText(/Teslim edildi|Servis edildi/).first(), yon: 'sol' },
    { n: 3, loc: g.getByRole('button', { name: 'Hesabı iste' }), yon: 'ust' },
  ] }));
  await g.getByRole('button', { name: 'Hesabı iste' }).click();
  const nasil = g.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' });
  await nasil.waitFor();
  await dene('m-hesap-iste', () => cek(g, 'm-hesap-iste', { isaretler: [{ n: 1, loc: nasil, yon: 'ust' }] }));
  await nasil.getByRole('button', { name: 'Kart' }).click();
  await sleep(800);
  await dene('m-hesap-istendi', () => cek(g, 'm-hesap-istendi', { isaretler: [{ n: 1, loc: g.getByRole('button', { name: 'Hesap istendi' }), yon: 'ust' }] }));

  // Kasiyer: kasa açılışı, "Hesap istiyor" uyarısı ve ödeme.
  const kasa = await yeniSayfa(browser, 'masaustu', { yukseklik: 860 });
  await giris(kasa, 'kasiyer');
  await sesiAc(kasa);
  const acilis = kasa.getByRole('form', { name: 'Kasa açılışı' });
  if (await acilis.isVisible().catch(() => false)) {
    const alan = acilis.getByRole('textbox').first();
    await dene('c-kasa-acilis', () => cek(kasa, 'c-kasa-acilis', { kirp: acilis, pay: 16, isaretler: [
      { n: 1, loc: alan, yon: 'alt' },
      { n: 2, loc: acilis.getByRole('button', { name: 'Açılışı kaydet' }), yon: 'alt' },
    ] }));
    await alan.fill('500');
    await acilis.getByRole('button', { name: 'Açılışı kaydet' }).click();
    await sleep(1200);
  }
  const masaKart = kasa.locator('.table-card').filter({ has: kasa.getByRole('heading', { name: M, exact: true }) });
  await masaKart.click();
  const masaPen = kasa.getByRole('dialog', { name: new RegExp(M) });
  await masaPen.waitFor();
  await sleep(500);
  await dene('c-masa-penceresi', () => cek(kasa, 'c-masa-penceresi', { kirp: masaPen, pay: 12, isaretler: [
    { n: 1, loc: masaPen.getByRole('button', { name: 'Ödeme al' }), yon: 'sol' },
  ] }));
  await masaPen.getByRole('button', { name: 'Ödeme al' }).click();
  const odeme = kasa.getByRole('dialog', { name: new RegExp(`${M} · Ödeme al`) });
  await odeme.waitFor();
  await odeme.getByRole('button', { name: 'Kart', exact: true }).click().catch(() => {});
  await sleep(600);
  await dene('c-odeme', () => cek(kasa, 'c-odeme', { kirp: odeme, pay: 12, isaretler: [
    { n: 1, loc: odeme.getByRole('button', { name: 'Kart', exact: true }), yon: 'sol' },
    { n: 2, loc: odeme.getByRole('button', { name: /Bahşiş ekle/ }), yon: 'sol' },
    { n: 3, loc: odeme.getByRole('button', { name: 'Ödemeyi kaydet' }), yon: 'sol' },
  ] }));
  await odeme.getByRole('button', { name: 'Ödemeyi kaydet' }).click();
  await sleep(1500);

  const kapandi = g.getByRole('status', { name: 'Hesabınız kapandı' });
  await kapandi.getByRole('heading', { name: 'Hesabınız kapandı' }).waitFor({ timeout: 20000 });
  const tesekkur = g.locator('.review-prompt');
  await tesekkur.getByRole('heading', { name: 'Bizi değerlendirin ve takip edin' }).waitFor({ timeout: 15000 });
  await sleep(700);
  await dene('m-kapandi', () => cek(g, 'm-kapandi', { isaretler: [
    { n: 1, loc: kapandi.getByRole('heading', { name: 'Hesabınız kapandı' }), yon: 'alt' },
    { n: 2, loc: tesekkur.getByRole('link', { name: /Google/ }), yon: 'ust' },
    { n: 3, loc: tesekkur.getByRole('link', { name: /Instagram/ }), yon: 'ust' },
  ] }));
  // Menünün altındaki "Gizlilik" (TASLAK): misafire bu menünün neyi işlediğini anlatır.
  await dene('m-gizlilik', async () => {
    await g.getByRole('button', { name: 'Gizlilik', exact: true }).scrollIntoViewIfNeeded();
    await g.getByRole('button', { name: 'Gizlilik', exact: true }).click();
    const gz = g.getByTestId('guest-privacy'); await gz.waitFor(); await g.evaluate(() => scrollTo(0, 0)); await sleep(500);
    await cek(g, 'm-gizlilik', { isaretler: [{ n: 1, loc: gz.locator('.guest-privacy-draft'), yon: 'alt' }, { n: 2, loc: gz.getByText('mola_browser').first(), yon: 'ust' }] });
    await gz.getByRole('button', { name: 'Menüye dön' }).first().click();
  });

  // QR siparişlerini durdur (kasiyer): onay penceresi, misafirin gördüğü, garsonun telefonundaki satır; sonra "Aç".
  await dene('c-qr-durdur', async () => {
    await kasa.goto(KAFE); await sleep(1200);
    await kasa.getByTestId('qr-ordering-card').getByTestId('qr-ordering-stop').click();
    const onay = kasa.getByRole('dialog', { name: 'QR siparişlerini durdur' }); await onay.waitFor(); await sleep(400);
    await cek(kasa, 'c-qr-durdur', { kirp: onay, pay: 14, isaretler: [{ n: 1, loc: dugme(onay, 'Durdur'), yon: 'alt' }, { n: 2, loc: dugme(onay, 'Vazgeç'), yon: 'alt' }] });
    await dugme(onay, 'Durdur').click(); await sleep(1500);
    s = await durum();
    const bos = s.tables.find((t: any) => !t.account && !t.needsCleaning && t.name !== M) ?? masa;
    const g2 = await yeniSayfa(browser, 'telefon');
    await g2.context().route(`${KAFE}/**`, r => r.abort());
    await g2.goto(`${base}/${bos.token}`);
    const not = g2.getByTestId('ordering-closed'); await not.waitFor({ timeout: 20000 }); await sleep(600);
    await dene('m-siparis-kapali', () => cek(g2, 'm-siparis-kapali', { isaretler: [{ n: 1, loc: not, yon: 'alt' }, { n: 2, loc: g2.getByRole('button', { name: 'Garson çağır' }), yon: 'alt' }] }));
    await g2.context().close();
    await garson.goto(KAFE); await sleep(1500); await sesiAc(garson);
    const satir = garson.getByTestId('qr-ordering-bar');
    if (await satir.isVisible({ timeout: 6000 }).catch(() => false)) await dene('g-qr-kapali', () => cek(garson, 'g-qr-kapali', { kirp: [garson.locator('header.topbar'), satir], pay: 6, isaretler: [{ n: 1, loc: satir, yon: 'alt' }] }));
    await kasa.getByTestId('qr-ordering-open').click(); await sleep(1000);
  });

  // Kafe bilgisayarı kapalı ya da interneti yokken: menü Mola Merkez'deki kopyasından açılır, sipariş kapalı (tünel test için kapatılır, sonra açılır).
  if ((await sahip.post('/api/test/tunnel', { data: { on: false } })).ok()) {
    try {
      await sleep(2500);
      const yok = await yeniSayfa(browser, 'telefon');
      await yok.context().route(`${KAFE}/**`, r => r.abort());
      await yok.goto(url);
      const uyari = yok.getByTestId('ordering-offline');
      await uyari.waitFor({ timeout: 20000 }); await sleep(800);
      await dene('m-kopyadan', () => cek(yok, 'm-kopyadan', { isaretler: [{ n: 1, loc: uyari, yon: 'alt' }, { n: 2, loc: yok.locator('.product-card').first(), yon: 'sag' }] }));
      await yok.context().close();
    } finally { await sahip.post('/api/test/tunnel', { data: { on: true } }); }
  }
  for (const p of [g, garson, mutfak, kasa]) await p.context().close();
};

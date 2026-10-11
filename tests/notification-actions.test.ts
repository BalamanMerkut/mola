import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bellCount, importantNotification, notificationActionOf } from '../src/notificationActions';

// 10 Ekim son kullanıcı testi: the owner's refund notification "İade yapıldı: ₺190 · Masa 03" (K-A) offered "Kapanışları aç";
// JavaScript's /iade/i never matches the capital "İ". Every refund notification opens Kasa ve giderler → İadeler.
test('each bell notification opens its home', () => {
  const go = (kind: Parameters<typeof notificationActionOf>[0]['kind'], title: string) => { const a = notificationActionOf({ kind, title }); return a && `${a[0]} → ${JSON.stringify(a[1])}`; };
  assert.equal(go('cash', 'İade isteği: Masa 03 · ₺190'), 'İadeyi yap → {"view":"cash","tab":"refunds"}');
  assert.equal(go('cash', 'İade yapıldı: ₺190 · Masa 03'), 'İadeleri aç → {"view":"cash","tab":"refunds"}');
  assert.equal(go('cash', 'Kasiyer iadesi: ₺35 · Masa 02'), 'İadeleri aç → {"view":"cash","tab":"refunds"}');
  assert.equal(go('cash', 'Kasa kapatıldı: fark −₺10'), 'Kapanışları aç → {"view":"cash","tab":"closings"}');
  assert.equal(go('cash', 'Kasiyer kasadan gider yazdı: ₺250'), 'Giderleri aç → {"view":"cash","tab":"expenses","part":"records"}');
  assert.equal(go('expense', 'Otomatik gider kaydedildi: Kira'), 'Giderleri aç → {"view":"cash","tab":"expenses","part":"records"}');
  assert.equal(go('stock', 'Süt azalıyor'), 'Stoğa git → {"view":"stock","tab":"items"}');
  assert.equal(go('merkez', 'Mola ekibi bağlandı'), 'Uzaktan erişim → {"view":"support","tab":"remote"}');
  assert.equal(go('merkez', 'Uzaktan yönetim açıldı'), 'Telefonum → {"view":"settings","topic":"security","part":"phone"}');
  assert.equal(go('backup', 'Yedek alınamadı'), 'Yedek → {"view":"settings","topic":"security","part":"backup"}');
  assert.equal(go('reminder', 'Tedarikçiyi ara'), null);
});

// 10 Ekim: a new notification shows a toast on an open screen; these stay until closed, the rest hide after a few seconds.
test('important notifications stay as toasts until closed', () => {
  const stays = (kind: Parameters<typeof importantNotification>[0]['kind'], title: string) => importantNotification({ kind, title });
  assert.equal(stays('cash', 'İade isteği: Masa 03 · ₺190'), true);
  assert.equal(stays('cash', 'Kasa kapatıldı: fark −₺10'), true);
  assert.equal(stays('cash', 'Vardiya devri: fark +₺20'), true);
  assert.equal(stays('cash', 'Açılışta kasa farkı: −₺50'), true);
  assert.equal(stays('cash', 'Kasadaki beklenen nakit eksiye düştü: −₺200'), true);
  assert.equal(stays('license', 'Lisansınızın bitmesine 3 gün kaldı'), true);
  assert.equal(stays('backup', 'Otomatik yedek alınamadı'), true);
  assert.equal(stays('cash', 'Kasa kapatıldı: fark yok'), false);
  assert.equal(stays('cash', 'İade yapıldı: ₺190 · Masa 03'), false);
  assert.equal(stays('cash', 'Kasiyer iadesi: ₺35 · Masa 02'), false);
  assert.equal(stays('campaign', 'Kampanya bitti: Çay saati'), false);
  assert.equal(stays('stock', 'Süt azalıyor'), false);
  assert.equal(stays('reminder', 'Hatırlatma: Tedarikçi'), false);
  // The bell's count.
  assert.deepEqual([1, 3, 9, 10, 42].map(bellCount), ['1', '3', '9', '9+', '9+']);
});

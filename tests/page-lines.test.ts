import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLine } from '../src/pageLines';

// 10 Ekim son kullanıcı testi: the line under a page's title names only what that role can open there. The Müdür's
// Kasa ve giderler said "… ve kasa ayarları tek yerde" although Kasa ayarları is the owner's tab alone.
test('page lines follow the role\'s tabs', () => {
  assert.match(pageLine('cash', 'owner'), /kasa ayarları/);
  assert.doesNotMatch(pageLine('cash', 'manager'), /ayar/i);
  assert.match(pageLine('cash', 'manager'), /giderler, kapanışlar ve iadeler/);
  assert.equal(pageLine('cash', 'cashier'), 'Kasa açılışı, para bozdurma, gider, vardiya kodu ve gün sonu.');
  // The Müdür reads Personel → Vardiya ve bahşiş only, and Menü yönetimi without KDV oranları.
  assert.doesNotMatch(pageLine('users', 'manager'), /hesap|ayar/i);
  assert.doesNotMatch(pageLine('menu', 'manager'), /KDV/);
  assert.match(pageLine('menu', 'owner'), /KDV/);
  assert.equal(pageLine('nowhere', 'owner'), '');
});

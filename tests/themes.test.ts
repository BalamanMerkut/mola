import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeIds, themes } from '../packages/domain/theme.js';
function luminance(hex: string) {
 const rgb = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
 return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
test('every offered palette has readable primary buttons and body text', () => {
 assert.equal(new Set(themeIds).size, 16);
 for (const id of themeIds) {
  const p = themes[id];
  assert.ok(1.05 / (luminance(p.primary) + .05) >= 4.5, id + ' button contrast');
  assert.ok((luminance(p.background) + .05) / (luminance(p.ink) + .05) >= 4.5, id + ' body contrast');
 }
});

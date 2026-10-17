import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { surfaces, themeIds, themes } from '../packages/domain/theme.js';

/*
 * 17 Ekim (sahibin isteği): links to another place (src/Moved.tsx PlaceLink, "Hangi garson hangi bölümde? →") are a soft
 * pill: the palette colour (--green) on its light tint (--brand-soft = surfaces().selected), never the faint underlined
 * small text again. The text must stay readable (WCAG AA, 4.5:1) on every palette, the hover colour too.
 */
const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('place links: palette text on its tint is at least AA (4.5:1) on every palette, hover too', () => {
  for (const id of themeIds) {
    const tint = surfaces(id).selected;
    assert.ok(contrast(themes[id].primary, tint) >= 4.5, `${id}: ${contrast(themes[id].primary, tint).toFixed(2)}`);
    assert.ok(contrast(themes[id].hover, tint) >= 4.5, `${id} hover`);
    // The pill stands off the card it sits on (a tint, not the card colour).
    assert.notEqual(tint, surfaces(id).card);
  }
});

test('place links: one shared pill style (tint, palette colour, no underline, arrow), not a filled button', () => {
  const css = readFileSync(new URL('../src/moved.css', import.meta.url), 'utf8');
  const rule = css.match(/button\.text-btn\.place-link\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /background:var\(--brand-soft/);
  assert.match(rule, /color:var\(--green/);
  assert.match(rule, /border-radius:999px/);
  assert.match(rule, /text-decoration:none/);
  assert.match(rule, /font-weight:600/);
  assert.doesNotMatch(rule, /background:var\(--green/, 'never filled like a primary button');
  const component = readFileSync(new URL('../src/Moved.tsx', import.meta.url), 'utf8');
  assert.match(component, /place-link/); assert.match(component, /<ArrowRight/);
});

import type { CSSProperties } from 'react';
import { surfaces, themes, type ThemeId } from '../packages/domain/theme';
import './business-theme.css';
export function businessTheme(theme?: ThemeId): CSSProperties {
  const p = themes[theme ?? 'sage'] ?? themes.sage;
  const z = surfaces(theme ?? 'sage');
  // The palette's matte surfaces (packages/domain/theme.ts surfaces): page, cards (--paper), fields, hover, lines, selection.
  return { '--green': p.primary, '--brand-hover': p.hover, '--brand-soft': z.selected, '--brand-bg': z.page, '--ink': p.ink, '--accent': p.accent,
    '--paper': z.card, '--field': z.field, '--surface-soft': z.soft, '--line': z.line, '--rail': z.rail } as CSSProperties;
}
/** The same values on the page root: windows opened outside the themed area (portals), the window's rail and the body. */
export function themeOnRoot(theme?: ThemeId) {
  const root = document.documentElement, values = businessTheme(theme) as Record<string, string>;
  for (const [k, v] of Object.entries(values)) root.style.setProperty(k, v);
  return () => { for (const k of Object.keys(values)) root.style.removeProperty(k); };
}

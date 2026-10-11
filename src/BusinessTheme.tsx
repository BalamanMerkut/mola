import type { CSSProperties } from 'react';
import { themes, type ThemeId } from '../packages/domain/theme';
import './business-theme.css';
export function businessTheme(theme?: ThemeId): CSSProperties {
  const p = themes[theme ?? 'sage'] ?? themes.sage;
  return { '--green': p.primary, '--brand-hover': p.hover, '--brand-soft': p.soft, '--brand-bg': p.background, '--ink': p.ink, '--accent': p.accent } as CSSProperties;
}

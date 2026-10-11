import type { ReactNode } from 'react';
import { YonetimBrand } from './MolaLogo';

/** A calm drawing for the brand panel: the cafés as tiles (a cup, a licence key, a support bubble, a tick, one to add). */
function AuthArt() {
  const tile = (x: number, y: number, children: ReactNode, dashed = false) => <g transform={`translate(${x} ${y})`}>
    <rect width="80" height="80" rx="20" className={dashed ? 'art-tile dashed' : 'art-tile'} />{children}</g>;
  return <svg className="auth-art" viewBox="0 0 272 176" aria-hidden="true" focusable="false">
    {tile(0, 0, <><path d="M24 36h28v12a14 14 0 0 1-14 14 14 14 0 0 1-14-14z" /><path d="M52 40h3a6 6 0 0 1 0 12h-3" /><path d="M31 27c-3-4 3-6 0-11M39 27c-3-4 3-6 0-11M47 27c-3-4 3-6 0-11" className="art-steam" /></>)}
    {tile(96, 0, <><circle cx="30" cy="40" r="9" /><path d="M39 40h20M51 40v7M57 40v5" /></>)}
    {tile(192, 0, <><path d="M20 26h40a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H38l-10 8v-8h-8a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z" /><path d="M27 37h26M27 44h16" /></>)}
    {tile(0, 96, <><path d="M22 30h36M22 40h28M22 50h32" /><circle cx="60" cy="58" r="4" className="art-dot" /></>)}
    {tile(96, 96, <><circle cx="40" cy="40" r="18" /><path d="M31 40l6 6 12-12" /></>)}
    {tile(192, 96, <path d="M40 30v20M30 40h20" />, true)}
  </svg>;
}

/**
 * Mola Yönetim's door: the brand on a green panel on the left, one clean card on the right (login, the factor step, the
 * forced first password change). Stacks on a narrow screen.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="yonetim-auth">
    <aside className="auth-brand">
      <YonetimBrand light />
      <div className="auth-brand-text">
        <p className="auth-eyebrow">Mola Yönetim</p>
        <p className="auth-slogan">Kafeleriniz, lisanslar ve destek tek yerde.</p>
      </div>
      <AuthArt />
      <p className="auth-studio">Merkut Studios</p>
    </aside>
    <section className="auth-main"><div className="auth-card">{children}</div></section>
  </main>;
}

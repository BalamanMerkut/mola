import './mola-logo.css';

/*
 * The Mola symbol on pages: the cup of scripts/desktop/mola-icon.svg (the app icon), drawn inline as a vector. It sits on a
 * 24-px grid with 2-px strokes, so at its own size every line falls on whole pixels: sharp on 1x and 2x screens, never a
 * scaled bitmap. The café shows it on green (`Brand`, src/components.tsx), Mola Yönetim on near-black (`YonetimBrand`).
 */
export function MolaCup({ size = 24 }: { size?: number }) {
  return <svg className="mola-cup" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M10 2v2" /><path d="M14 2v2" /><path d="M6 2v2" />
    <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
  </svg>;
}

/** Mola Yönetim's own mark: the same cup on near-black (scripts/desktop/mola-yonetim-icon.svg) with the words "Mola Yönetim". */
export function YonetimBrand({ light = false }: { light?: boolean }) {
  return <div className={`ybrand${light ? ' light' : ''}`}>
    <span className="ybrand-mark"><MolaCup /></span>
    <span className="ybrand-word"><strong>Mola</strong> <span>Yönetim</span></span>
  </div>;
}

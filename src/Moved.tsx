import { ArrowRight, MoveRight } from 'lucide-react';
import { goTo, type GoTo } from './navigate';
import './moved.css';

/*
 * "Taşındı → Git" (docs/BILGI_MIMARISI_ONERISI.md, kural 6): where something used to be, a quiet line names its new home and
 * opens it. Kept for two releases after the move (10 Ekim 2026 düzeni), then removed (docs/GELISTIRICI_REHBERI.md).
 */
export function Moved({ what, where, to, action = 'Git' }: { what: string; where: string; to: GoTo; action?: string }) {
  return <p className="moved-sign" role="note"><MoveRight size={16} aria-hidden="true" /><span><b>{what}</b> taşındı: {where}</span>
    <button type="button" className="text-btn" aria-label={`${what}: ${where} · ${action}`} onClick={() => goTo(to)}>{action}<ArrowRight size={14} aria-hidden="true" /></button></p>;
}

/** A plain link to another place ("Gider kayıtlarını aç", "Kârlılığı gör"). */
export function PlaceLink({ to, children, className = '' }: { to: GoTo; children: React.ReactNode; className?: string }) {
  return <button type="button" className={`text-btn place-link ${className}`.trim()} onClick={() => goTo(to)}>{children}<ArrowRight size={14} aria-hidden="true" /></button>;
}

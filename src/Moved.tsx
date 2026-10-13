import { ArrowRight } from 'lucide-react';
import { goTo, type GoTo } from './navigate';
import './moved.css';

/*
 * The "Taşındı → Git" signposts of the 10 Ekim düzeni were removed on 13 Ekim (sahibin isteği: people should settle into the
 * new places). What stays is the plain link to another place.
 */

/** A plain link to another place ("Gider kayıtlarını aç", "Kârlılığı gör"). */
export function PlaceLink({ to, children, className = '' }: { to: GoTo; children: React.ReactNode; className?: string }) {
  return <button type="button" className={`text-btn place-link ${className}`.trim()} onClick={() => goTo(to)}>{children}<ArrowRight size={14} aria-hidden="true" /></button>;
}

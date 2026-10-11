import { Bike, Store } from 'lucide-react';
import { externalHeading, externalName, PLATFORMS, type ExternalSource } from '../packages/domain/platforms';
import './external-orders.css';

// A delivery platform's name on its own colour: text only, never a logo or trademark image (packages/domain/platforms.ts).
export const platformColour = (source: Pick<ExternalSource, 'platform'>) => ({ ['--platform' as string]: PLATFORMS[source.platform]?.color ?? '#4f5b66' });
/** "Yemeksepeti" on the platform's colour. `code`: "Yemeksepeti #1234". */
export function PlatformBadge({ source, code = false }: { source: Pick<ExternalSource, 'platform' | 'code' | 'externalId'>; code?: boolean }) {
  return <span className="platform-badge" style={platformColour(source)}>{code ? externalName(source) : PLATFORMS[source.platform]?.name ?? 'Platform'}</span>;
}
/** Kitchen card heading "YEMEKSEPETI #1234": loud, coloured, never mistaken for a table. */
export function PlatformHeading({ source }: { source: ExternalSource }) {
  return <h3 className="platform-heading" style={platformColour(source)}>{source.deliveryType === 'gel-al' ? <Store size={17} aria-hidden="true" /> : <Bike size={17} aria-hidden="true" />}{externalHeading(source)}</h3>;
}

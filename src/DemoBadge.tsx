import './demo-badge.css';

/**
 * "Tanıtım": a small label on every staff screen (top bar, kitchen bar) and on the guest menu of a business Mola marked as its
 * demo ("Tanıtım işletmesi", server/demo-reset.ts), so nobody mistakes a sales demo for a real café. `en`: the guest's English menu.
 */
export function DemoBadge({ on, en = false }: { on?: boolean; en?: boolean }) {
  if (!on) return null;
  return <span className="demo-badge" role="note" title={en ? 'This is a demo business: orders here are not real.' : 'Tanıtım işletmesi: buradaki siparişler gerçek değildir.'}>{en ? 'Demo' : 'Tanıtım'}</span>;
}

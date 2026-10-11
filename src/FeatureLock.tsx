import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { MessageCircle, Sparkles, X } from 'lucide-react';
import { featureById, hasFeature, seesLocked, type FeatureId } from '../packages/domain/feature-gate';
import type { Role } from '../packages/domain/types';
import { ContactButtons } from './MolaContact';
import './feature-lock.css';

/*
 * Hizmet paketi on the screens. The business's services come with the staff snapshot (`pkg.enabled`); the server refuses a
 * closed service's requests anyway (server/feature-guard.ts), these screens only decide what is shown:
 *   - owner and Müdür: a closed service stays in the menu and in Ayarlar, faded with a small "Pakette yok"; opening it shows
 *     sample shapes under a heavy blur (never the business's data: none is even asked for) and the card below;
 *   - cashier, waiter, kitchen: a closed service is simply not there (clean screens).
 * Anything may ask for the card (`openFeatureLock`) or for a prefilled Destek ticket (`writeToMola`); src/Workspace.tsx
 * listens and opens them, so a deep component (a report button, the desktop rail) needs no props for it.
 */
export type PackageAccess = { enabled?: readonly FeatureId[]; role?: Role };
const PackageContext = createContext<PackageAccess>({});
export function PackageProvider({ value, children }: { value: PackageAccess; children: ReactNode }) {
  return <PackageContext.Provider value={value}>{children}</PackageContext.Provider>;
}
/** `has`: the service is on (or nothing is known: an older server); `locked`: off, and this person sees it faded. */
export function usePackage() {
  const { enabled, role } = useContext(PackageContext);
  const has = (id: FeatureId) => hasFeature(enabled, id);
  return { enabled, role, has, locked: (id: FeatureId) => !has(id) && seesLocked(role), visible: (id: FeatureId) => has(id) || seesLocked(role), owner: role === 'owner' };
}

const LOCK_EVENT = 'mola:feature-lock', WRITE_EVENT = 'mola:feature-write';
/** Shows the "Bu hizmet paketinizde yok" card over the screen (Workspace listens). */
export const openFeatureLock = (id: FeatureId) => window.dispatchEvent(new CustomEvent(LOCK_EVENT, { detail: id }));
/** Opens Destek → new ticket, prefilled for this service (Workspace listens). */
export const writeToMola = (id: FeatureId) => window.dispatchEvent(new CustomEvent(WRITE_EVENT, { detail: id }));
export function useFeatureEvents(onLock: (id: FeatureId) => void, onWrite: (id: FeatureId) => void) {
  const latest = useRef({ onLock, onWrite }); latest.current = { onLock, onWrite };
  useEffect(() => {
    const lock = (e: Event) => { const id = (e as CustomEvent).detail; if (featureById.has(id)) latest.current.onLock(id); };
    const write = (e: Event) => { const id = (e as CustomEvent).detail; if (featureById.has(id)) latest.current.onWrite(id); };
    window.addEventListener(LOCK_EVENT, lock); window.addEventListener(WRITE_EVENT, write);
    return () => { window.removeEventListener(LOCK_EVENT, lock); window.removeEventListener(WRITE_EVENT, write); };
  }, []);
}
/** The ticket Destek opens with: subject and a short message naming the business and its current package. */
export function featureTicket(id: FeatureId, business: string, packageName?: string, enabled?: readonly FeatureId[]) {
  const name = featureById.get(id)?.name ?? id;
  const current = enabled?.filter(f => f !== 'core').map(f => featureById.get(f)?.name ?? f) ?? [];
  // 'core': the package card's general "Hizmet eklemek / değiştirmek" (no one service in particular).
  if (id === 'core') return { subject: 'Paketime hizmet eklemek / değiştirmek istiyorum', text: `Merhaba, ${business || 'işletmemiz'} için paketimize hizmet eklemek ya da paketi değiştirmek istiyoruz.\nŞu anki paketimiz: ${packageName ?? 'bilinmiyor'}${current.length ? ` (${current.join(', ')})` : ''}.\nTeşekkürler.` };
  return {
    subject: `Hizmet eklemek istiyorum: ${name}`,
    text: `Merhaba, ${business || 'işletmemiz'} için “${name}” hizmetini paketimize eklemek istiyoruz.\nŞu anki paketimiz: ${packageName ?? 'bilinmiyor'}${current.length ? ` (${current.join(', ')})` : ''}.\nTeşekkürler.`,
  };
}

/** The small, calm "Pakette yok" mark beside a faded menu item, tab or setting. */
export function LockedHint({ className = '' }: { className?: string }) {
  return <span className={`feature-locked-hint ${className}`.trim()}>Pakette yok</span>;
}

/** Sample shapes only: no names, no numbers of this business. Blurred under the card. */
function Sample({ kind }: { kind: 'page' | 'card' }) {
  const bars = [62, 38, 80, 54, 70, 46, 88, 58, 40, 74];
  return <div className={`feature-lock-sample ${kind}`} aria-hidden="true">
    <div className="fls-tiles">{[0, 1, 2].map(i => <div className="fls-tile" key={i}><span className="fls-line short" /><span className="fls-figure" /><span className="fls-line" /></div>)}</div>
    {kind === 'page' && <div className="fls-chart">{bars.map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div>}
    <div className="fls-rows">{[0, 1, 2, 3].slice(0, kind === 'page' ? 4 : 2).map(i => <div className="fls-row" key={i}><span className="fls-dot" /><span className="fls-line" /><span className="fls-line tiny" /></div>)}</div>
  </div>;
}

/** The card itself: title, the service's name and line from the catalogue, what to do, "Mola ekibine yaz" and "Kapat". */
function LockCard({ feature, onClose, titleId, modal }: { feature: FeatureId; onClose?: () => void; titleId: string; modal?: boolean }) {
  const f = featureById.get(feature), { owner } = usePackage(), first = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (modal) first.current?.focus(); }, [modal]);
  // "Yakında" (not sold yet, closed for everyone until it is): its own words, the same card.
  return <div className="feature-lock-card">
    <span className="feature-lock-icon" aria-hidden="true"><Sparkles size={22} /></span>
    <h2 id={titleId}>{f?.soon ? 'Yakında, paketinize eklenebilecek' : 'Bu hizmet paketinizde yok'}</h2>
    <p className="feature-lock-name">{f?.name}{f?.soon && <span className="feature-soon-chip">Yakında</span>}</p>
    {f?.description && <p className="feature-lock-line">{f.description}</p>}
    <p className="feature-lock-how">{f?.soon ? 'Bu hizmet hazırlanıyor; satışa çıkınca paketinize eklenebilecek. Haber almak isterseniz Mola ekibine yazın.' : owner ? 'Paketinize eklemek isterseniz Mola ekibine yazın; birkaç dakikada açılır.' : 'İşletme sahibi Mola ekibine yazarak paketinize ekletebilir; birkaç dakikada açılır.'}{f?.soon ? '' : ' Verileriniz silinmez.'}</p>
    <div className="feature-lock-actions">
      {owner && <button ref={first} type="button" className="btn primary" onClick={() => { onClose?.(); writeToMola(feature); }}><MessageCircle size={17} aria-hidden="true" />Mola ekibine yaz</button>}
      {onClose && <button ref={owner ? undefined : first} type="button" className="btn secondary" onClick={onClose}>Kapat</button>}
    </div>
    <ContactButtons className="feature-lock-contact" />
  </div>;
}

/**
 * A place of a closed service, in the content area: blurred sample shapes and the card on top. `compact`: inside a card or
 * a tab (Ayarlar, a report tab) instead of a whole page. `onClose`: "Kapat" (back to where the person was).
 */
export function FeatureLockView({ feature, onClose, compact = false }: { feature: FeatureId; onClose?: () => void; compact?: boolean }) {
  const titleId = useId();
  return <section className={`feature-lock${compact ? ' compact' : ''}`} aria-labelledby={titleId} data-feature={feature}>
    <Sample kind={compact ? 'card' : 'page'} />
    <div className="feature-lock-veil" aria-hidden="true" />
    <LockCard feature={feature} onClose={onClose} titleId={titleId} />
  </section>;
}

/** The same card over the current screen (a faded button: Yazdır / PDF, İkiye böl, a service in "Paketiniz"). Escape closes it. */
export function FeatureLockModal({ feature, onClose }: { feature: FeatureId; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [onClose]);
  return <div className="feature-lock-layer" onClick={onClose}>
    <div className="feature-lock-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-feature={feature} onClick={e => e.stopPropagation()}>
      <button type="button" className="icon-btn feature-lock-x" aria-label="Kapat" onClick={onClose}><X size={18} /></button>
      <LockCard feature={feature} onClose={onClose} titleId={titleId} modal />
    </div>
  </div>;
}

/** A faded stand-in for a settings card or a button row of a closed service: opens the card when touched. */
export function LockedRow({ feature, title, line }: { feature: FeatureId; title?: string; line?: string }) {
  const f = featureById.get(feature);
  return <button type="button" className="feature-locked-row" data-feature={feature} onClick={() => openFeatureLock(feature)}>
    <span className="feature-locked-row-text"><strong>{title ?? f?.name}</strong><span>{line ?? f?.description}</span></span>
    <LockedHint />
  </button>;
}

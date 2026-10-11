import { defaultPackages, featureById, featureIds, isFeatureId, type FeatureId } from './features.js';

/*
 * Hizmet paketi, café side: which of Mola's services (packages/domain/features.ts) this business may use, from the signed
 * licence's `features` (Mola Merkez puts the package there; during the trial every sellable service). Browser-safe: the
 * server's guard (server/feature-guard.ts) and the screens (src/FeatureLock.tsx, src/PackageCard.tsx) share these rules.
 *   - A licence WITHOUT `features` (older Merkez, older licence) = every service on: nothing changes for those cafés.
 *   - "Sadece QR menü" (`service: 'menu'`) keeps its own behaviour exactly (MENU_ONLY in server/kafe-link.ts).
 *   - A service turned off never deletes anything: its data stays, hidden; turning it on again shows it all.
 *   - The Müdür account is part of the core (6 Ekim): never gated. An old licence still listing 'manager-role' (or any id
 *     this version does not know) is read as usual; the unknown id is simply dropped.
 *   - "Sosyal medya ve QR kartları" ('social', paid since 6 Ekim; free core before): a licence WITH `features` signed by a Merkez
 *     that does not know the service yet (its heartbeat `accepts` lacks FEATURES_SOCIAL) keeps it on, as it was; an updated
 *     Merkez signs every licence again at its first start (server/merkez/catalog.ts ensureCatalog), see server/kafe-link.ts.
 */
/** Listed in Merkez's heartbeat `accepts` (server/sync-protocol.ts MERKEZ_ACCEPTS) once its licences decide 'social'. */
export const FEATURES_SOCIAL = 'features.social';
export { featureById, featureIds, features, isFeatureId, type Feature, type FeatureId } from './features.js';
export const FEATURE_NOT_IN_PACKAGE = 'FEATURE_NOT_IN_PACKAGE';

/**
 * The services a licence turns on: core always; a service whose requirement is off is off too (QR sipariş needs QR menü).
 * A "Yakında" service (soon, not sellable yet: no package and no trial licence holds it) is off like any service not in the
 * package (6 Ekim, owner: "Paket servis platformları" stays closed until it is sold); a licence without `features` keeps it on.
 */
export function enabledFeatures(raw?: readonly unknown[] | null): FeatureId[] {
  if (!Array.isArray(raw)) return [...featureIds];
  const chosen = new Set<FeatureId>(['core', ...raw.filter(isFeatureId)]);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...chosen]) if ((featureById.get(id)?.requires ?? []).some(need => !chosen.has(need))) { chosen.delete(id); changed = true; }
  }
  return featureIds.filter(id => chosen.has(id));
}
export const hasFeature = (enabled: readonly FeatureId[] | undefined, id: FeatureId) => !enabled || id === 'core' || enabled.includes(id);
/** Services that can be off (everything but the core), in the catalogue's order. */
export const optionalFeatures: FeatureId[] = featureIds.filter(id => id !== 'core');
export const featureName = (id: FeatureId) => featureById.get(id)?.name ?? id;

/** The plain sentence a refused request carries (staff and guests alike; guests get their own words below). */
export function notInPackage(id: FeatureId, who: 'staff' | 'guest' = 'staff') {
  if (who === 'guest') return id === 'qr-order' ? 'Bu işletmede menüden sipariş verilemiyor. Siparişinizi personele iletebilirsiniz.' : 'Bu işletmenin QR menüsü şu anda kullanılmıyor. Lütfen personelle görüşün.';
  return `“${featureName(id)}” işletmenizin Mola paketinde yok. Paketinize eklemek için işletme sahibi Destek'ten Mola ekibine yazabilir.`;
}

/**
 * The services a café API path belongs to (path after /api), most specific first: every listed one must be on. Core paths
 * return []. Kept here, next to the catalogue, so a new route of a service is one line (tests/feature-gate.test.ts).
 */
const ROUTES: [RegExp, FeatureId[]][] = [
  // Guests: the menu itself, then ordering, calling the waiter, asking for the bill, changing or cancelling their order.
  [/^\/guest\/(orders(\/edit)?|call|cancel)$/, ['qr-menu', 'qr-order']],
  [/^\/guest\//, ['qr-menu']],
  // "QR siparişlerini durdur / Aç" (server/qr-ordering.ts).
  [/^\/staff\/qr-ordering$/, ['qr-menu', 'qr-order']],
  // Gelişmiş raporlar: Yazdır / PDF and Muhasebeci için indir (the simple summary and the report tables stay core).
  [/^\/staff\/reports\/(document|document\.pdf|accountant\.xlsx)$/, ['reports-advanced']],
  // Stok, reçeteler, Kârlılık and its low-profit settings, the kitchen's stock answers.
  [/^\/staff\/(stock(\/.*)?|reports\/profit|profit\/settings)$/, ['stock']],
  // Rezervasyonlar and Etkinlikler (Ajanda's Takvim notes are core: /staff/agenda).
  [/^\/staff\/(reservations|events)(\/.*)?$/, ['reservations']],
  [/^\/staff\/reports\/reservations$/, ['reservations']],
  // Vardiya takibi and Personel ve bahşiş (/shifts/me stays: it answers "takip kapalı" so no screen waits for a code).
  [/^\/staff\/shifts\/(?!me$).+$/, ['shifts']],
  [/^\/staff\/(reports\/staff-shifts|cash\/closing-shift)$/, ['shifts']],
  [/^\/staff\/remote-reports(\/.*)?$/, ['remote-reports']],
  [/^\/staff\/remote-admin(\/.*)?$/, ['remote-reports', 'remote-admin']],
  [/^\/staff\/email-reports(\/.*)?$/, ['email-reports']],
  [/^\/staff\/integrations(\/.*)?$/, ['integrations']],
  // Sosyal medya ve QR kartları: the permanent QR cards (every platform, the Google one too). Saving the links is checked in
  // server/business-profile.ts: the Google review row stays core, the other platforms need this service.
  [/^\/staff\/social-qr$/, ['social']],
];
export function routeFeatures(path: string): FeatureId[] {
  const clean = path.replace(/\/+$/, '') || '/';
  return ROUTES.find(([re]) => re.test(clean))?.[1] ?? [];
}
/** The first service of `path` that is off (undefined: allowed). */
export function missingForRoute(path: string, enabled: readonly FeatureId[] | undefined) {
  return routeFeatures(path).find(id => !hasFeature(enabled, id));
}

/** The package's name for the owner: the trial, a starting package with exactly these services, or "Size özel paket". */
export function packageName(enabled: readonly FeatureId[], options: { trial?: boolean; menuOnly?: boolean; name?: string; listed?: boolean } = {}) {
  if (options.trial) return 'Deneme';
  if (options.name?.trim()) return options.name.trim();
  if (options.menuOnly) return 'Sadece QR menü';
  if (!options.listed) return 'Tam paket';
  const sellable = enabled.filter(id => !featureById.get(id)?.soon);
  const same = defaultPackages.find(p => p.features.length === sellable.length && p.features.every(id => sellable.includes(id)));
  return same?.name ?? 'Size özel paket';
}
/** The services that closed when the licence changed (trial → package): sellable ones only, never the core. */
export function closedFeatures(before: readonly FeatureId[], after: readonly FeatureId[]): FeatureId[] {
  return before.filter(id => id !== 'core' && !featureById.get(id)?.soon && !after.includes(id));
}

/**
 * What every staff snapshot carries (`StaffSnapshot.pkg`): the services on. The owner (and the Müdür, who sees the faded
 * places too) also gets the package's name, the trial and the one-time "deneme bitti" notice.
 */
export type PackageView = {
  enabled: FeatureId[];
  /** false: the licence had no `features` (older Merkez): everything is on and the card says "Tam paket". */
  listed?: boolean;
  name?: string;
  trial?: { daysLeft: number; started: boolean };
  menuOnly?: boolean;
  /** Owner only, from the licence: it runs now; after the trial its end and plan (1, 6 or 12 months) when the licence has them. */
  active?: boolean; until?: string; planMonths?: number;
  /** Deneme bitti: these services closed (once; the owner closes it with POST /api/staff/package/notice-seen). */
  notice?: { id: string; closed: FeatureId[]; at: string };
};
/** Owner and Müdür see a service that is off, faded with "Pakette yok"; everyone else simply does not see it. */
export const seesLocked = (role: string | undefined) => role === 'owner' || role === 'manager';

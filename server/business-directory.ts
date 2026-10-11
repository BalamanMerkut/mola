import type { State } from '../packages/domain/types.js';
import { sectorOf, type Sector } from '../packages/domain/sector.js';

/**
 * Explicit allowlist for management. Never spread a State or staff user into this record.
 * `sector` came later: rows written before it lack the key (see `legacyDirectoryRow`) until the business is next written.
 */
export type BusinessDirectoryEntry = {
  tenantId: string;
  name: string;
  sector: Sector;
  logo?: string;
  theme?: State['theme'];
  menuHero?: State['menuHero'];
  googleReviewUrl?: string;
  businessRevision: number;
  setupCompleted: boolean;
  setupCompletedAt?: string;
  ownerAccount?: { id: string; username: string; version: number };
};
export function businessDirectoryEntry(state: State): BusinessDirectoryEntry {
  const owner = state.staffUsers?.find(u => u.role === 'owner' && u.active);
  return {
    tenantId: state.tenantId,
    name: state.name,
    sector: sectorOf(state),
    logo: state.logo,
    theme: state.theme,
    menuHero: state.menuHero,
    googleReviewUrl: state.googleReviewUrl,
    businessRevision: state.businessRevision ?? 0,
    setupCompleted: !!state.setupCompleted,
    // The audit entry moves to the history table with the same write; the snapshot keeps its time.
    setupCompletedAt: state.setupCompletedAt ?? state.audit.find(a => a.action === 'business.configured')?.at,
    ownerAccount: owner ? { id: owner.id, username: owner.username, version: owner.version } : undefined,
  };
}
/** A row written before `sector` existed. Backups and restores of such data stay valid; the server refreshes it on start. */
export const legacyDirectoryRow = (row: object) => !('sector' in row);

import type { Role } from '../packages/domain/types';

/*
 * Which main places (Workspace sidebar, the phone's bottom bar and its "Daha fazla" sheet) each role may open. One map, so
 * the menu and the screens agree. It only decides what is shown: the server checks every action itself (403), see
 * packages/domain/roles.ts for the Müdür's table.
 * - `agenda` for the cashier and waiters only when Ajanda ve rezervasyon → Ayarlar lets them write reservations (`canReserve`);
 * - `integrations` only while the platform preview is on (`integrations`).
 * A new place goes into this map for every role that should see it.
 */
export type NavId = 'tables' | 'ready' | 'staff' | 'cash' | 'kitchen' | 'menu' | 'stock' | 'settings' | 'reports' | 'agenda' | 'users' | 'integrations' | 'support' | 'announcements' | 'password';
/*
 * 10 Ekim düzeni (docs/BILGI_MIMARISI_ONERISI.md): 'cash' is "Kasa ve giderler" (the cashier's "Kasa", Bugün only), 'users'
 * is "Personel" (the Müdür reads its Vardiya ve bahşiş only), Kampanyalar is a tab of Menü yönetimi (no place of its own),
 * and the owner's Bildirimler is the bell on the top bar (not a menu place).
 */
export const ROLE_NAV: Record<Role, readonly NavId[]> = {
  // The kitchen board ('kitchen') is the kitchen account's alone (owner's decision, 5 Ekim): no "Mutfak ekranı" for the owner;
  // one screen for the counter and the kitchen is the café computer's "İkiye böl" (src/SplitView.tsx).
  owner: ['tables', 'staff', 'cash', 'agenda', 'menu', 'stock', 'users', 'reports', 'settings', 'integrations', 'support', 'password'],
  // Müdür: the day's work and the business's numbers, never Ayarlar, the staff accounts, Entegrasyonlar or Destek. The Mola
  // team's announcements are the Müdür's to read too: their own place 'announcements' (the owner reads them in Destek → Duyurular).
  manager: ['tables', 'staff', 'cash', 'agenda', 'menu', 'stock', 'users', 'reports', 'announcements', 'password'],
  cashier: ['tables', 'staff', 'cash', 'agenda', 'password'],
  waiter: ['tables', 'ready', 'staff', 'agenda', 'password'],
  kitchen: ['kitchen', 'stock', 'password'],
  // Mola destek (remote support, src/RemoteSupportWorkspace.tsx has its own small menu): menu (with Kampanyalar) and some settings only.
  support: ['menu', 'settings'],
};
export function navAllowed(role: Role, id: string, when: { canReserve?: boolean; integrations?: boolean } = {}) {
  if (!(ROLE_NAV[role] as readonly string[] | undefined)?.includes(id)) return false;
  if (id === 'agenda' && (role === 'cashier' || role === 'waiter')) return !!when.canReserve;
  if (id === 'integrations') return !!when.integrations;
  return true;
}

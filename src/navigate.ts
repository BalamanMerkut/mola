/*
 * Links between the café's places ("Her konunun tek bir evi", docs/BILGI_MIMARISI_ONERISI.md). A deep component (a report's
 * "Gider kayıtlarını aç", a notification's "İadeyi yap", a "Taşındı → Git" signpost) calls `goTo` with the place; the
 * workspace (src/Workspace.tsx) listens and opens it, so no screen needs props for links to another one.
 */
export type CashTab = 'today' | 'expenses' | 'closings' | 'refunds' | 'settings';
export type StaffTab = 'staff' | 'shifts' | 'settings';
export type MenuTab = 'products' | 'campaigns' | 'vat';
export type GoTo =
  | { view: 'cash'; tab?: CashTab; part?: string; q?: string; day?: string; focus?: string }
  | { view: 'users'; tab?: StaffTab; part?: string }
  | { view: 'menu'; tab?: MenuTab; /** "Kampanyayı yinele": open the editor on a copy of this campaign (src/CampaignEnded.tsx). */ renew?: string }
  | { view: 'reports'; tab?: string; campaign?: string; margins?: boolean; send?: boolean }
  | { view: 'settings'; topic: string; part?: string; qr?: boolean }
  | { view: 'agenda'; part?: 'settings'; day?: string }
  | { view: 'stock'; tab?: string; productId?: string }
  | { view: 'notifications' }
  | { view: 'support'; tab?: string }
  | { view: 'tables' };
export const GO_EVENT = 'mola:go';
export const goTo = (place: GoTo) => window.dispatchEvent(new CustomEvent<GoTo>(GO_EVENT, { detail: place }));

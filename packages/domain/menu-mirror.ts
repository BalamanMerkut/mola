import { saleProducts, type Campaign } from './campaigns.js';
import type { MenuNameEn } from './menu-translation.js';
import { newProductIds } from './new-products.js';
import type { Sector } from './sector.js';
import type { SocialLinks } from './social-links.js';
import type { MenuHero, ThemeId } from './theme.js';
import type { GuestSnapshot, Product } from './types.js';

/*
 * Menünün Mola Merkez'deki kopyası (8 Ekim, sahibin fikri): the café sends the guest-visible menu to Mola Merkez a few seconds
 * after any change (server/menu-mirror.ts) and Merkez keeps it (server/merkez/menu-mirror.ts), so a guest who scans a table QR
 * while the café computer is off or its internet is down still browses the menu, served by Merkez itself. Ordering, the waiter
 * call, the bill, "Siparişlerim" and order status stay live operations: they need the café (through the tunnel), which is the
 * only judge of every order (its own current menu: sold out, price). Public menu content only: no sales, no guests, no staff.
 * This file is the copy's shape and how Merkez turns it into the guest screen's snapshot; no Node imports (browser-safe).
 */
export const MIRROR_VERSION = 1;
/** The table QR's token is never sent: only its SHA-256 (with this prefix), so Merkez knows a real table and its name. */
export const MIRROR_TABLE_PREFIX = 'mola-masa:v1:';
/** Photo and logo files by name ("<uuid>.webp", "<uuid>-small.webp") → their SHA-256 (uploaded to Merkez once per hash). */
export const MIRROR_FILE = /^[a-f0-9-]{36}(-small)?\.webp$/;
export type MirrorMenu = {
  v: 1;
  name: string; sector?: Sector; logo?: string; theme?: ThemeId; menuHero?: MenuHero; googleReviewUrl?: string;
  social: { socialLinks?: SocialLinks; socialOff?: true };
  paymentMode?: 'before_preparation' | 'after_service'; changeSeconds: number; menuRevision: number;
  /** "Sadece QR menü" (or QR sipariş not in the package): browsing only, as on the café's own menu. */
  menuOnly: boolean; demo?: boolean;
  categories: string[]; categoryNamesEn?: MenuNameEn[]; subcategories: { category: string; names: string[] }[];
  popularProductIds: string[];
  /** Published products as they are (prices without campaigns): the campaigns are applied at Merkez when the guest looks. */
  products: Product[];
  /** Campaigns with their time windows and weekly repeat; `campaignUsage`: the units already sold (quota campaigns). */
  campaigns: Campaign[]; campaignUsage: Record<string, number>;
  tables: { h: string; name: string }[];
  photos: Record<string, string>;
};

/**
 * The guest snapshot Merkez answers from its copy: the menu as the café would show it now (campaign windows at this moment,
 * new products of the last 30 days), no orders, no calls, and ordering closed ("Şu an sipariş alınamıyor"): the café cannot
 * be reached. `mirror: true` tells the screen (src/Customer.tsx).
 */
export function mirrorSnapshot(m: MirrorMenu, tableName: string, now: Date): GuestSnapshot {
  const s = { products: m.products, campaigns: m.campaigns, archivedCampaignUsage: m.campaignUsage, orders: [], archives: [] };
  return {
    mirror: true, ordering: { open: false, reason: 'offline', call: false }, ...(m.demo ? { demo: true } : {}), ...(m.sector ? { sector: m.sector } : {}), menuOnly: m.menuOnly,
    calls: { waiter: false, bill: false }, tableHasAccount: false, ...(m.logo ? { logo: m.logo } : {}), ...(m.theme ? { theme: m.theme } : {}), ...(m.menuHero ? { menuHero: m.menuHero } : {}),
    ...(m.googleReviewUrl ? { googleReviewUrl: m.googleReviewUrl } : {}), ...m.social, ...(m.paymentMode ? { paymentMode: m.paymentMode } : {}), needsCleaning: false,
    newProductIds: newProductIds(m.products, now), popularProductIds: m.popularProductIds, categories: m.categories, ...(m.categoryNamesEn ? { categoryNamesEn: m.categoryNamesEn } : {}),
    subcategories: m.subcategories, table: { name: tableName }, products: saleProducts(s, now).filter(p => p.published !== false), name: m.name, menuRevision: m.menuRevision,
    online: false, closed: false, orders: [], changeSeconds: m.changeSeconds,
  };
}
/** Every photo or logo file the copy names (each needs its bytes at Merkez). */
export function mirrorFiles(m: Pick<MirrorMenu, 'photos'>) { return Object.entries(m.photos).filter(([name, sha]) => MIRROR_FILE.test(name) && /^[a-f0-9]{64}$/.test(sha)); }

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { campaignUsage } from '../packages/domain/campaigns.js';
import { menuCategories, menuNamesEn, menuSubcategories } from '../packages/domain/categories.js';
import { MIRROR_FILE, MIRROR_TABLE_PREFIX, type MirrorMenu } from '../packages/domain/menu-mirror.js';
import { sectorOf } from '../packages/domain/sector.js';
import { guestSocial } from '../packages/domain/social-links.js';
import { floorTables } from '../packages/domain/takeaway.js';
import type { State } from '../packages/domain/types.js';
import type { MerkezLink } from './kafe-link.js';
import type { Store } from './store.js';

/*
 * Menünün Mola Merkez'deki kopyası, the café's end (shape: packages/domain/menu-mirror.ts; Merkez: server/merkez/menu-mirror.ts).
 * For every business of this install that has its public menu address (a menu code from a Merkez that takes guest tunnels)
 * and "QR menü" in its service, and only while Merkez lists 'menu.mirror' in `accepts`:
 *   - a few seconds after any change of the business's snapshot (Store.onMutate; menu, prices, campaigns, "tükendi", look,
 *     social links, tables), when the tunnel connects again, and every 10 minutes (new products, popular ones), the copy is
 *     built and, if its SHA-256 changed, sent: POST /api/merkez/v1/menu (signed like the heartbeat);
 *   - Merkez answers which photos it still needs (by SHA-256); each is sent once: POST /api/merkez/v1/menu/photo/<işletme>/<sha>
 *     (signed raw bytes). Photos Merkez no longer sees in the copy are deleted there.
 * Failures wait and try again (30 s, 2 min, 10 min); nothing here ever holds the café. No sales data, no guest, no staff.
 */
const DELAY_MS = () => Number(process.env.MOLA_MIRROR_DELAY_MS) || 3000;
const REFRESH_MS = 10 * 60_000, RETRY = [30_000, 120_000, 600_000];
export const MIRROR_MAX_BYTES = 2 * 1024 * 1024;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
/** The SHA-256 of a table QR's token as the copy carries it. */
export const tableHash = (token: string) => sha(MIRROR_TABLE_PREFIX + token).slice(0, 40);

/** The copy of one business and the photo files it names (name → path on this computer). */
export function buildMirror(s: State, directory: string, o: { menuOnly: boolean; demo: boolean; social: boolean; popular: string[] }) {
  const published = s.products.filter(p => p.published !== false), files = new Map<string, string>();
  const folder = join(directory, 'media', s.tenantId), photoOf = (photo: string | null | undefined) => {
    const m = /^\/media\/([^/]+)\/([a-f0-9-]{36})\.webp$/.exec(photo ?? '');
    if (!m || m[1] !== s.tenantId) return null;
    for (const name of [`${m[2]}.webp`, `${m[2]}-small.webp`]) files.set(name, join(folder, name));
    return photo!;
  };
  const products = published.map(({ discounts: _discounts, ...p }) => ({ ...p, photo: photoOf(p.photo) }));
  const used = Object.fromEntries(campaignUsage(s));
  const live = (s.campaigns ?? []).filter(c => c.enabled && (!c.endsAt || Date.parse(c.endsAt) > Date.now() - 86_400_000));
  const menu: Omit<MirrorMenu, 'photos'> = {
    v: 1, name: s.name, sector: sectorOf(s), ...(s.logo && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(s.logo) && s.logo.length <= 48_000 ? { logo: s.logo } : {}),
    ...(s.theme ? { theme: s.theme } : {}), ...(s.menuHero ? { menuHero: s.menuHero } : {}), ...(s.googleReviewUrl ? { googleReviewUrl: s.googleReviewUrl } : {}),
    social: guestSocial(s, o.social), paymentMode: s.paymentMode ?? 'after_service', changeSeconds: s.changeSeconds, menuRevision: s.menuRevision,
    menuOnly: o.menuOnly, ...(o.demo ? { demo: true } : {}),
    categories: menuCategories(s), categoryNamesEn: menuNamesEn(s), subcategories: menuSubcategories({ ...s, products: published }),
    popularProductIds: o.popular.filter(id => published.some(p => p.id === id)), products,
    campaigns: live, campaignUsage: Object.fromEntries(Object.entries(used).filter(([id]) => live.some(c => c.id === id))),
    tables: floorTables(s).filter(t => t.token && !t.event && !t.takeaway).map(t => ({ h: tableHash(t.token), name: t.name })),
  };
  return { menu, files };
}

type Sent = { hash: string; at: number };
export class MenuMirror {
  private dirty = new Set<string>(); private timer?: NodeJS.Timeout; private refresh: NodeJS.Timeout;
  private sent = new Map<string, Sent>(); private fileShas = new Map<string, { mtime: number; size: number; sha: string }>();
  private running = false; private again = false; private failures = 0; private retryAt = 0; private stopped = false;
  /** Last result per business (Mola Yönetim and tests read it): when it was sent and how many photos went. */
  readonly results = new Map<string, { at: string; photos: number; error?: string }>();
  constructor(private store: Store, private link: MerkezLink, private popular: (tenant: string, s: State) => string[]) {
    store.onMutate.push(tenant => this.mark(tenant));
    link.afterSync.push(() => { if (this.wanted().length && this.wanted().some(t => !this.sent.has(t))) this.markAll(); });
    link.onStop.push(() => this.stop());
    this.refresh = setInterval(() => { try { this.markAll(); } catch { /* the store is closing */ } }, REFRESH_MS); this.refresh.unref();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.refresh); }
  /** The tunnel connected again (Merkez may have restarted or lost its copy): everything goes again. */
  reconnected() { this.sent.clear(); this.markAll(); }
  /** The businesses whose copy Merkez takes now. */
  wanted(): string[] {
    const r = this.link.read();
    if (!r?.accepts?.includes('menu.mirror')) return [];
    return Object.keys(r.licenses).filter(t => 'base' in this.link.tunnelAddress(t) && this.link.has(t, 'qr-menu'));
  }
  mark(tenant: string) { this.dirty.add(tenant); this.schedule(DELAY_MS()); }
  markAll() { for (const t of this.wanted()) this.dirty.add(t); this.schedule(DELAY_MS()); }
  private schedule(ms: number) {
    if (this.stopped) return;
    const at = Math.max(Date.now() + ms, this.retryAt);
    // A store closed under the timer (tests, shutdown) ends the round quietly; the next change or reconnect marks again.
    clearTimeout(this.timer); this.timer = setTimeout(() => { this.flush().catch(() => { this.dirty.clear(); }); }, at - Date.now()); this.timer.unref();
  }
  /** Sends what changed now (tests call it directly). */
  async flush(): Promise<void> {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      const wanted = new Set(this.wanted());
      for (const tenant of [...this.dirty]) {
        this.dirty.delete(tenant);
        if (!wanted.has(tenant)) continue;
        try { await this.push(tenant); this.failures = 0; this.retryAt = 0; }
        catch (e) {
          this.dirty.add(tenant); this.results.set(tenant, { at: new Date().toISOString(), photos: 0, error: e instanceof Error ? e.message : String(e) });
          this.retryAt = Date.now() + RETRY[Math.min(this.failures++, RETRY.length - 1)];
          break;
        }
      }
    } finally {
      this.running = false;
      if (this.again || this.dirty.size) { this.again = false; this.schedule(DELAY_MS()); }
    }
  }
  private fileSha(path: string) {
    const st = statSync(path), kept = this.fileShas.get(path);
    if (kept && kept.mtime === st.mtimeMs && kept.size === st.size) return kept.sha;
    const value = sha(readFileSync(path)); this.fileShas.set(path, { mtime: st.mtimeMs, size: st.size, sha: value });
    return value;
  }
  /** One business: the copy (if it changed), then the photos Merkez asks for. */
  async push(tenant: string, force = false) {
    const s = this.store.read(tenant);
    const { menu, files } = buildMirror(s, this.store.directory, { menuOnly: this.link.menuOnly(tenant) || !this.link.has(tenant, 'qr-order'), demo: this.link.isDemo(tenant), social: this.link.has(tenant, 'social'), popular: this.popular(tenant, s) });
    const photos: Record<string, string> = {};
    for (const [name, path] of files) { if (!MIRROR_FILE.test(name)) continue; try { photos[name] = this.fileSha(path); } catch { /* a missing file: the guest sees the drawing */ } }
    const full: MirrorMenu = { ...menu, photos }, text = JSON.stringify(full), hash = sha(text);
    if (text.length > MIRROR_MAX_BYTES) throw new Error('Menü kopyası çok büyük.');
    if (!force && this.sent.get(tenant)?.hash === hash) return;
    const answer = await this.link.relayPost<{ need?: unknown }>('/menu', { tenantId: tenant, menu: full }, 30_000);
    const need = Array.isArray(answer.need) ? answer.need.filter((x): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)) : [];
    let sentPhotos = 0;
    for (const want of new Set(need)) {
      const name = Object.keys(photos).find(n => photos[n] === want), path = name ? files.get(name) : undefined;
      if (!path) continue;
      const bytes = readFileSync(path);
      if (sha(bytes) !== want) continue;
      await this.link.relayPostBytes(`/menu/photo/${encodeURIComponent(tenant)}/${want}`, bytes, 30_000);
      sentPhotos++;
    }
    this.sent.set(tenant, { hash, at: Date.now() });
    this.results.set(tenant, { at: new Date().toISOString(), photos: sentPhotos });
  }
}

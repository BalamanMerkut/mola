import { randomBytes } from 'node:crypto';
import type { Express, Request } from 'express';
import { z } from 'zod';
import { DomainError } from '../../packages/domain/engine.js';
import { featureById, featureIds, features, type FeatureId } from '../../packages/domain/features.js';
import {
  DEFAULT_VAT_RATE, LEGACY_FULL, LEGACY_MENU, discountText, lira, monthlyRevenue, normalFeatures, priceFor, priceOf, serviceOf, startingPackages,
  type Discount, type Price, type ServicePackage,
} from '../../packages/domain/service-pricing.js';
import type { JournalChange } from './journal.js';
import { assignedFeatures, licenseFeatures, type BusinessServices, type Catalog, type MerkezBusiness, type MerkezData, type MerkezStore } from './store.js';

/*
 * Hizmet paketleri, fiyatlar (Mola Yönetim → Ayarlar → Hizmet fiyatları / Paketler) and a business's services (işletme →
 * Hizmet). Registered by server/merkez/app.ts. The catalogue (packages/domain/features.ts) is shared with the café; prices and
 * packages live in Merkez's sealed record (`catalog`), each business's choice in `services`.
 *   - First start of this version (`ensureCatalog`, additive): the three starting packages and the two old plans are made;
 *     every business from before gets the old plan it had ("Tam sistem" → every sellable service, "Sadece QR menü" → the same
 *     without QR ordering), and every licence is signed again so newer cafés receive `features` (server/license.ts).
 *   - Every change that alters what a business may use signs its licence again (serial + 1); the café has it within ~10 min.
 *   - Every change is written to İşlem kayıtları with old → new values.
 */
export type CatalogDeps = {
  store: MerkezStore; now: () => Date;
  admin: (req: Request) => unknown;
  /** A price, package or service change: the admin plus the Authenticator step-up (server/merkez/step-up.ts, 'sales'). */
  change: (req: Request) => unknown;
  once: <T>(d: MerkezData, scope: string, b: object, fn: () => T) => T;
  find: (d: MerkezData, tenantId: string) => MerkezBusiness;
};
const key = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), id = z.string().min(1).max(100);
const featureId = z.enum(featureIds);
const KURUS_MAX = 10_000_000_00; // ₺10 milyon
const discountSchema = z.object({ kind: z.enum(['amount', 'percent']), value: z.number().int().min(0).max(KURUS_MAX) }).strict()
  .refine(d => d.kind !== 'percent' || d.value <= 100, 'İndirim yüzdesi 0 ile 100 arasında olmalı.');

/** The catalogue as stored; older data has none until ensureCatalog ran (then the starting state is assumed). */
export const catalogOf = (d: MerkezData): Catalog => d.catalog ?? { prices: {}, packages: startingPackages(new Date(0).toISOString()), vatRate: DEFAULT_VAT_RATE, createdAt: '', updatedAt: '' };
export const vatRateOf = (d: MerkezData) => catalogOf(d).vatRate ?? DEFAULT_VAT_RATE;
const packageOf = (d: MerkezData, packageId: string | null | undefined) => packageId ? catalogOf(d).packages.find(p => p.id === packageId) : undefined;
const featureNames = (ids: readonly FeatureId[]) => ids.map(f => featureById.get(f)?.name ?? f).join(', ');
const servicesName = (d: MerkezData, s: BusinessServices | undefined) => !s ? 'Paket seçilmedi' : s.packageId ? packageOf(d, s.packageId)?.name ?? 'Silinmiş paket' : 'Özel';

/**
 * Once, the first time this version opens the data: the starting packages and old plans, every business mapped to its old
 * plan, licences signed again (now with `features`). Nothing else is changed; running it again does nothing.
 */
export function ensureCatalog(store: MerkezStore, now: Date) {
  const stored = store.read().catalog;
  if (stored && (stored.version ?? 1) >= CATALOG_VERSION) return false;
  store.mutate(d => {
    if (d.catalog) {
      const from = d.catalog.version ?? 1;
      if (from < 2) addSocial(store, d, now);
      if (from < 3) singleLicence(store, d, now);
      d.catalog.version = CATALOG_VERSION; return;
    }
    const at = now.toISOString();
    d.catalog = { prices: {}, packages: startingPackages(at), vatRate: DEFAULT_VAT_RATE, createdAt: at, updatedAt: at, version: CATALOG_VERSION };
    let full = 0, menu = 0;
    for (const b of d.businesses) {
      if (b.services) continue;
      // Applications still waiting have no plan yet: they choose a package later (until then, as "Tam sistem").
      if (b.application && b.application.status !== 'approved' && !b.installId) continue;
      const legacy = b.service === 'menu' ? LEGACY_MENU : LEGACY_FULL;
      b.services = { packageId: legacy, features: packageOf(d, legacy)!.features, updatedAt: at };
      if (legacy === LEGACY_MENU) menu++; else full++;
      store.issue(b, now);
    }
    // A new, empty Merkez just starts with them; an existing one records the mapping (İşlem kayıtları).
    if (d.businesses.length) d.audit.push({ action: 'catalog.created', target: 'merkez', at, by: 'system', detail: `Başlangıç paketleri (${startingPackages(at).filter(p => !p.legacy).map(p => p.name).join(', ')}) ve iki eski plan eklendi. Eski plana bağlanan: Tam sistem ${full}, Sadece QR menü ${menu} işletme; davranışları değişmedi.` });
  });
  return true;
}
/**
 * Catalogue steps a stored record has had (`Catalog.version`; missing = 1, the 5 Ekim catalogue). Each step runs once, on the
 * first start of the version that brings it, and only adds:
 *   2 (6 Ekim): "Sosyal medya ve QR kartları" (`social`) became a paid service (free core before).
 *   3 (11 Ekim, güvenlik denetimi O6): one licence per business, always with `features`; the copy without them is gone.
 */
export const CATALOG_VERSION = 3;
/**
 * Step 3. Every connected business is signed again (serial + 1) with its list only: its café takes the new licence with the
 * next heartbeat (a higher serial), keeps exactly the services it has now, and from then on treats any copy without a list as
 * the core only (server/kafe-link.ts LEGACY_LICENCE_UNTIL).
 */
function singleLicence(store: MerkezStore, d: MerkezData, now: Date) {
  let signed = 0;
  for (const b of d.businesses) if (b.installId) { store.issue(b, now); signed++; } else delete b.signedFeatures;
  if (signed) d.audit.push({ action: 'catalog.single_licence', target: 'merkez', at: now.toISOString(), by: 'system', detail: `Lisanslar artık tek kopya ve hizmet listesiyle imzalanıyor (güvenlik). ${signed} işletmenin lisansı yeniden imzalandı; hizmetleri değişmedi.` });
}
/**
 * Step 2. The old plans mean "everything there is" (Tam sistem) and "everything but QR ordering" (Sadece QR menü): both get
 * `social`, and so does every business on them. Trials open every sellable service anyway. Every business whose licence now
 * holds `social` is signed again (serial + 1) so its café, which keeps 'social' on until this Merkez says it decides it
 * (FEATURES_SOCIAL in `accepts`), gets the new list with the same heartbeat; nobody loses what they had a moment ago. Other
 * packages stored here (Restoran Pro included: the vendor may have edited it) and "Özel" lists are left as they are; only a
 * new catalogue starts with Restoran Pro holding it (features.ts defaultPackages).
 */
function addSocial(store: MerkezStore, d: MerkezData, now: Date) {
  const at = now.toISOString(), c = d.catalog!, legacy = new Set<string>();
  for (const p of c.packages) if (p.legacy) {
    legacy.add(p.id);
    if (!p.features.includes('social')) { p.features = normalFeatures([...p.features, 'social']); p.updatedAt = at; }
  }
  let onPlan = 0, signed = 0;
  for (const b of d.businesses) {
    if (b.services?.packageId && legacy.has(b.services.packageId) && !b.services.features.includes('social')) {
      b.services = { ...b.services, features: [...packageOf(d, b.services.packageId)!.features] }; onPlan++;
    }
    if (b.installId && licenseFeatures(b).includes('social')) { store.issue(b, now); signed++; }
  }
  if (d.businesses.length) d.audit.push({ action: 'catalog.service_added', target: 'merkez', at, by: 'system', detail: `“Sosyal medya ve QR kartları” ücretli hizmet oldu (${lira(featureById.get('social')!.monthly)}/ay). Eski planlara eklendi (${onPlan} işletme); ${signed} işletmenin lisansı yeniden imzalandı. Diğer paketlere ve Özel listelere dokunulmadı.` });
}

/** A business's price: its services at today's prices, the package discount, then its own discount. */
export function businessPrice(d: MerkezData, b: MerkezBusiness): Price {
  const c = catalogOf(d), pkg = packageOf(d, b.services?.packageId);
  return priceFor(assignedFeatures(b), c.prices, pkg?.discount, b.services?.discount);
}
/** Monthly recurring revenue: paying businesses whose licence runs (not trial, not suspended, not the vendor's demo). */
export function recurringRevenue(d: MerkezData, now: Date) {
  let total = 0, count = 0;
  for (const b of d.businesses) {
    if (!b.installId || b.kind === 'trial' || b.suspended || b.demo || !b.endsAt || Date.parse(b.endsAt) <= now.getTime()) continue;
    total += monthlyRevenue(businessPrice(d, b), b.planMonths); count++;
  }
  return { total, count };
}
/** What Mola Yönetim shows about one business's services (işletme → Hizmet, Özet, lists). */
export function servicesView(d: MerkezData, b: MerkezBusiness) {
  const pkg = packageOf(d, b.services?.packageId), c = catalogOf(d);
  const assigned = assignedFeatures(b);
  return {
    packageId: b.services ? b.services.packageId : undefined, packageName: servicesName(d, b.services), chosen: !!b.services, legacy: pkg?.legacy,
    features: assigned, licenseFeatures: licenseFeatures(b), ...(b.services?.discount ? { discount: b.services.discount } : {}),
    price: businessPrice(d, b), packagePrice: priceFor(assigned, c.prices, pkg?.discount), updatedAt: b.services?.updatedAt,
  };
}
/** "Hizmet fiyatları" and "Paketler" for the screens: every service with its price now, every package with its totals and use. */
export function catalogView(d: MerkezData) {
  const c = catalogOf(d);
  return {
    vatRate: c.vatRate ?? DEFAULT_VAT_RATE, updatedAt: c.updatedAt,
    features: features.map(f => ({ id: f.id, name: f.name, description: f.description, group: f.group, required: !!f.required, requires: f.requires ?? [], soon: !!f.soon, defaultMonthly: f.monthly, ...priceOf(f.id, c.prices) })),
    packages: c.packages.map(p => ({ ...p, price: priceFor(p.features, c.prices, p.discount), businesses: d.businesses.filter(b => b.services?.packageId === p.id).length })),
  };
}

/** Puts a package or "Özel" on a business and signs its licence again when what it may use changed. Returns the history changes. */
export function assignServices(store: MerkezStore, d: MerkezData, b: MerkezBusiness, next: { packageId: string | null; features?: FeatureId[]; discount?: Discount | null }, now: Date): JournalChange[] {
  const pkg = next.packageId ? packageOf(d, next.packageId) : undefined;
  if (next.packageId && !pkg) throw new DomainError('PACKAGE_NOT_FOUND', 'Paket bulunamadı. Listeyi yenileyin.', 404);
  const list = pkg ? pkg.features : normalFeatures(next.features ?? []);
  if (!list.length) throw new DomainError('SERVICES_EMPTY', 'En az bir hizmet seçin.', 400);
  const before = b.services, beforeFeatures = assignedFeatures(b), beforeLicense = licenseFeatures(b);
  const discount = next.discount === undefined ? before?.discount : next.discount ?? undefined;
  const services: BusinessServices = { packageId: next.packageId, features: [...list], ...(discount && discount.value ? { discount } : {}), updatedAt: now.toISOString() };
  const changes: JournalChange[] = [];
  const fromName = servicesName(d, before), toName = servicesName(d, services);
  if (fromName !== toName || (before?.packageId ?? undefined) !== (services.packageId ?? undefined)) changes.push({ field: 'hizmet paketi', from: fromName, to: toName });
  const added = list.filter(x => !beforeFeatures.includes(x)), removed = beforeFeatures.filter(x => !list.includes(x));
  if (added.length || removed.length) changes.push({ field: 'hizmetler', from: removed.length ? `çıkan: ${featureNames(removed)}` : '—', to: added.length ? `eklenen: ${featureNames(added)}` : '—' });
  if (discountText(before?.discount) !== discountText(services.discount)) changes.push({ field: 'işletme indirimi', from: discountText(before?.discount) || 'yok', to: discountText(services.discount) || 'yok' });
  b.services = services; b.service = serviceOf(list);
  const after = licenseFeatures(b);
  if (b.installId && (after.join() !== beforeLicense.join() || !b.signed)) store.issue(b, now);
  return changes;
}

/** A new package id from its name (readable in the history), unique. */
function newPackageId(d: MerkezData, name: string) {
  const base = name.toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'paket';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export function catalogRoutes(app: Express, o: CatalogDeps) {
  const at = () => o.now().toISOString();
  // ensureCatalog ran at start; a record without one (never expected) starts from the starting state.
  const touch = (d: MerkezData) => { d.catalog ??= { prices: {}, packages: startingPackages(at()), vatRate: DEFAULT_VAT_RATE, createdAt: at(), updatedAt: at(), version: CATALOG_VERSION }; d.catalog.updatedAt = at(); return d.catalog; };
  app.get('/api/merkez/admin/catalog', (req, res) => { o.admin(req); res.json(catalogView(o.store.read())); });

  /** Hizmet fiyatları: monthly price per service; yearly typed or ×10 (null). Only what changed is written to the history. */
  app.post('/api/merkez/admin/catalog/prices', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: key, prices: z.array(z.object({ id: featureId, monthly: z.number().int().min(0).max(KURUS_MAX), yearly: z.number().int().min(0).max(KURUS_MAX).nullable() }).strict()).min(1).max(featureIds.length) }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'catalog-prices', b, () => {
      const c = touch(d), changes: JournalChange[] = [];
      for (const p of b.prices) {
        const f = featureById.get(p.id)!, old = priceOf(p.id, c.prices);
        if (p.monthly === f.monthly && p.yearly === null) delete c.prices[p.id]; else c.prices[p.id] = { monthly: p.monthly, ...(p.yearly !== null ? { yearly: p.yearly } : {}) };
        const now = priceOf(p.id, c.prices);
        const text = (x: { monthly: number; yearly: number; yearlyTyped: boolean }) => `${lira(x.monthly)}/ay · ${lira(x.yearly)}/yıl${x.yearlyTyped ? '' : ' (×10)'}`;
        if (text(old) !== text(now)) changes.push({ field: f.name, from: text(old), to: text(now) });
      }
      if (changes.length) d.audit.push({ action: 'catalog.prices_changed', target: 'merkez', at: at(), by: 'admin', detail: `${changes.length} hizmetin fiyatı değişti: ${changes.map(x => x.field).join(', ')}`, changes });
      return { ok: true, changed: changes.length };
    })));
  });

  /** "Yazılım hizmeti KDV oranı" (Satışlarım). */
  app.post('/api/merkez/admin/catalog/vat', (req, res) => {
    o.change(req); const b = z.object({ vatRate: z.number().int().min(0).max(100) }).strict().parse(req.body);
    res.json(o.store.mutate(d => {
      const c = touch(d), before = c.vatRate ?? DEFAULT_VAT_RATE;
      if (before !== b.vatRate) { c.vatRate = b.vatRate; d.audit.push({ action: 'catalog.vat_changed', target: 'merkez', at: at(), by: 'admin', detail: `%${before} → %${b.vatRate}`, changes: [{ field: 'yazılım hizmeti KDV oranı', from: `%${before}`, to: `%${b.vatRate}` }] }); }
      return { vatRate: c.vatRate };
    }));
  });

  /**
   * Paketler: a new package (no id) or a change. Its services always include core and their requirements. A change to a
   * package in use goes to every business on it (their licences are signed again); the screen asks first.
   */
  app.post('/api/merkez/admin/packages', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: key, id: id.optional(), name: z.string().trim().min(2).max(60), features: z.array(featureId).min(1).max(featureIds.length), discount: discountSchema.nullable(), expectedUpdatedAt: z.string().max(40).optional() }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'package', b, () => {
      const c = touch(d), time = at(), list = normalFeatures(b.features);
      if (b.features.some(f => featureById.get(f)?.soon)) throw new DomainError('FEATURE_SOON', 'Yakında gelecek hizmetler pakete eklenemez.', 400);
      const same = c.packages.find(p => p.id !== b.id && !p.archived && p.name.toLocaleLowerCase('tr-TR') === b.name.toLocaleLowerCase('tr-TR'));
      if (same) throw new DomainError('NAME_TAKEN', `“${same.name}” adında bir paket zaten var.`, 409);
      const discount = b.discount && b.discount.value ? b.discount : undefined;
      if (discount?.kind === 'amount' && discount.value > priceFor(list, c.prices).listMonthly) throw new DomainError('DISCOUNT_TOO_BIG', 'İndirim paketin aylık tutarından büyük olamaz.', 400);
      if (!b.id) {
        const pkg: ServicePackage = { id: newPackageId(d, b.name), name: b.name, features: list, ...(discount ? { discount } : {}), createdAt: time, updatedAt: time };
        c.packages.push(pkg);
        const p = priceFor(list, c.prices, discount);
        d.audit.push({ action: 'package.created', target: 'merkez', at: time, by: 'admin', detail: `${pkg.name} · ${list.length} hizmet · ${lira(p.monthly)}/ay · ${lira(p.yearly)}/yıl${discount ? ` · ${discountText(discount)}` : ''}`, changes: [{ field: 'paket', from: '—', to: `${pkg.name}: ${featureNames(list)}` }] });
        return { ok: true, id: pkg.id };
      }
      const pkg = c.packages.find(p => p.id === b.id);
      if (!pkg) throw new DomainError('PACKAGE_NOT_FOUND', 'Paket bulunamadı. Listeyi yenileyin.', 404);
      if (b.expectedUpdatedAt && b.expectedUpdatedAt !== pkg.updatedAt) throw new DomainError('VERSION_CONFLICT', 'Paket bu arada değişti. Listeyi yenileyin.', 409);
      if (pkg.legacy && (list.join() !== pkg.features.join() || b.name !== pkg.name)) throw new DomainError('LEGACY_LOCKED', 'Eski planların adı ve hizmetleri değiştirilemez; kopyalayıp yeni paket yapabilirsiniz.', 409);
      const changes: JournalChange[] = [];
      if (pkg.name !== b.name) changes.push({ field: 'paket adı', from: pkg.name, to: b.name });
      const added = list.filter(x => !pkg.features.includes(x)), removed = pkg.features.filter(x => !list.includes(x));
      if (added.length || removed.length) changes.push({ field: 'hizmetler', from: removed.length ? `çıkan: ${featureNames(removed)}` : '—', to: added.length ? `eklenen: ${featureNames(added)}` : '—' });
      if (discountText(pkg.discount) !== discountText(discount)) changes.push({ field: 'paket indirimi', from: discountText(pkg.discount) || 'yok', to: discountText(discount) || 'yok' });
      if (!changes.length) return { ok: true, id: pkg.id };
      pkg.name = b.name; pkg.features = list; if (discount) pkg.discount = discount; else delete pkg.discount; pkg.updatedAt = time;
      // The businesses on it follow (their licences are signed again when what they may use changed).
      let moved = 0;
      if (added.length || removed.length) for (const biz of d.businesses.filter(x => x.services?.packageId === pkg.id)) {
        const before = licenseFeatures(biz);
        biz.services = { ...biz.services!, features: [...list], updatedAt: time }; biz.service = serviceOf(list);
        if (biz.installId && licenseFeatures(biz).join() !== before.join()) o.store.issue(biz, o.now());
        d.audit.push({ action: 'services.package_updated', target: biz.tenantId, at: time, by: 'admin', detail: `${pkg.name} paketi değişti`, changes: changes.filter(x => x.field === 'hizmetler') });
        moved++;
      }
      d.audit.push({ action: 'package.updated', target: 'merkez', at: time, by: 'admin', detail: `${pkg.name}${moved ? ` · ${moved} işletmeye uygulandı` : ''}`, changes });
      return { ok: true, id: pkg.id, businesses: moved };
    })));
  });
  /** Arşivle / geri al: an archived package is not offered any more; businesses on it keep it. Old plans stay as they are. */
  app.post('/api/merkez/admin/packages/archive', (req, res) => {
    o.change(req); const b = z.object({ requestId: key, id, archived: z.boolean() }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'package-archive', b, () => {
      const c = touch(d), pkg = c.packages.find(p => p.id === b.id);
      if (!pkg) throw new DomainError('PACKAGE_NOT_FOUND', 'Paket bulunamadı. Listeyi yenileyin.', 404);
      if (pkg.legacy) throw new DomainError('LEGACY_LOCKED', 'Eski planlar arşive alınmaz; yalnız bu planı kullanan işletmelerde görünürler.', 409);
      if (!!pkg.archived === b.archived) return { ok: true };
      if (!b.archived && c.packages.some(p => p !== pkg && !p.archived && p.name.toLocaleLowerCase('tr-TR') === pkg.name.toLocaleLowerCase('tr-TR'))) throw new DomainError('NAME_TAKEN', `“${pkg.name}” adında başka bir paket var; önce birinin adını değiştirin.`, 409);
      if (b.archived) pkg.archived = true; else delete pkg.archived;
      pkg.updatedAt = at();
      const using = d.businesses.filter(x => x.services?.packageId === pkg.id).length;
      d.audit.push({ action: b.archived ? 'package.archived' : 'package.restored', target: 'merkez', at: at(), by: 'admin', detail: `${pkg.name}${b.archived && using ? ` · ${using} işletme bu paketle devam ediyor` : ''}` });
      return { ok: true };
    })));
  });

  /**
   * İşletme → Hizmet: a package, or "Özel" (packageId null + services), and this business's own discount (null: none). The
   * licence is signed again when what the café may use changes (during the trial everything stays open).
   */
  app.post('/api/merkez/admin/business-services', (req, res) => {
    o.change(req);
    const b = z.object({ requestId: key, tenantId: id, packageId: id.nullable(), features: z.array(featureId).max(featureIds.length).optional(), discount: discountSchema.nullable(), expectedUpdatedAt: z.string().max(40).nullable().optional() }).strict().parse(req.body);
    res.json(o.store.mutate(d => o.once(d, 'business-services', b, () => {
      const biz = o.find(d, b.tenantId);
      if (b.expectedUpdatedAt !== undefined && (biz.services?.updatedAt ?? null) !== b.expectedUpdatedAt) throw new DomainError('VERSION_CONFLICT', 'Bu işletmenin hizmetleri bu arada değişti. Sayfayı yenileyin.', 409);
      if (b.packageId) {
        const pkg = packageOf(d, b.packageId);
        if (!pkg) throw new DomainError('PACKAGE_NOT_FOUND', 'Paket bulunamadı. Listeyi yenileyin.', 404);
        const current = biz.services?.packageId === pkg.id;
        if ((pkg.archived || pkg.legacy) && !current) throw new DomainError('PACKAGE_UNAVAILABLE', pkg.legacy ? 'Eski planlar yeni işletmelere verilmez; bir paket ya da Özel seçin.' : 'Bu paket arşivde; önce Ayarlar → Paketler’den geri alın.', 409);
      } else if (!b.features?.length) throw new DomainError('SERVICES_EMPTY', 'Özel için en az bir hizmet seçin.', 400);
      if (b.features?.some(f => featureById.get(f)?.soon)) throw new DomainError('FEATURE_SOON', 'Yakında gelecek hizmetler seçilemez.', 400);
      if (b.discount?.kind === 'amount' && b.discount.value) {
        const list = b.packageId ? packageOf(d, b.packageId)!.features : normalFeatures(b.features ?? []);
        if (b.discount.value > priceFor(list, catalogOf(d).prices, packageOf(d, b.packageId)?.discount).monthly) throw new DomainError('DISCOUNT_TOO_BIG', 'İndirim aylık tutardan büyük olamaz.', 400);
      }
      const changes = assignServices(o.store, d, biz, { packageId: b.packageId, features: b.features, discount: b.discount }, o.now());
      if (changes.length) {
        const p = businessPrice(d, biz);
        d.audit.push({ action: 'services.changed', target: biz.tenantId, at: at(), by: 'admin', detail: `${servicesName(d, biz.services)} · ${assignedFeatures(biz).length} hizmet · ${lira(p.monthly)}/ay${biz.kind === 'trial' ? ' · deneme bitince geçerli' : ''}`, changes });
      }
      return { ok: true, changed: changes.length > 0, serial: biz.serial };
    })));
  });
}

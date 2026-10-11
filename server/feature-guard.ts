import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { DomainError, requireRole } from '../packages/domain/engine.js';
import { FEATURE_NOT_IN_PACKAGE, hasFeature, missingForRoute, notInPackage, type FeatureId } from '../packages/domain/feature-gate.js';
import type { Actor } from '../packages/domain/types.js';
import type { MerkezLink } from './kafe-link.js';
import type { Store } from './store.js';

/*
 * Hizmet paketi on the café server: every request of a service that is not in this business's package is refused here,
 * before its route (403 FEATURE_NOT_IN_PACKAGE, one plain sentence), whatever the screen shows. Nothing is deleted or
 * changed: the data of a closed service stays where it is and comes back when the service is on again.
 *   - which path belongs to which service: packages/domain/feature-gate.ts (routeFeatures), one list;
 *   - the parts of core answers that belong to a service (comparisons and channels in the report summary, KDV dökümü,
 *     the vardiya switch in the cash settings) are left out of the answer; the staff snapshot is trimmed in server/app.ts;
 *   - background work of a closed service (low-stock notices, e-mail reports, reservation reminders, the phones' postbox,
 *     remote sessions, Sunucu yedeği) is skipped where it runs (server/stock.ts, email-reports.ts, reservations.ts,
 *     remote-reports.ts, remote-admin.ts, runtime.ts).
 * "Sadece QR menü" (`service: 'menu'`) keeps its own MENU_ONLY answer for guest ordering, exactly as before.
 */
export function featureRefusal(id: FeatureId, who: 'staff' | 'guest' = 'staff') {
  return new DomainError(FEATURE_NOT_IN_PACKAGE, notInPackage(id, who), 403);
}

export type FeatureGuardOptions = {
  link: MerkezLink; store: Store;
  staffActor: (req: Request) => Actor;
  /** The business of a guest request (its QR session, or the QR token being opened); undefined: the route answers itself. */
  guestTenant: (req: Request) => string | undefined;
};

/** Answers 200 with `fn(body)` instead of the body (only JSON objects; errors pass untouched). */
function trimmed(res: Response, fn: (body: Record<string, unknown>) => Record<string, unknown>) {
  const send = res.json.bind(res);
  res.json = (body: unknown) => send(res.statusCode === 200 && body && typeof body === 'object' && !Array.isArray(body) ? fn({ ...(body as Record<string, unknown>) }) : body);
}
/** "… — dünün aynı saatine göre %12 fazla." without the comparison (server/report-export.ts simpleSentence). */
export const withoutComparison = (sentence: string) => sentence.replace(/ — [^.—]*? göre (aynı|%\d+ (fazla|az))/, '');

export function featureGuard(app: Express, o: FeatureGuardOptions) {
  const { link, store } = o;
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    // İki ekran: a pane of the café computer's window, or asking for the panes' key, only with "İki ekran" in the package.
    if ((res.locals.staffPane || path === '/desktop/pane') && !link.installHas('split-screen')) return next(featureRefusal('split-screen'));
    if (path.startsWith('/guest/')) {
      const tenant = o.guestTenant(req); if (!tenant) return next();
      const missing = missingForRoute(path, link.features(tenant));
      // "Sadece QR menü": guest ordering keeps its own answer (MENU_ONLY, 409) exactly as before.
      if (missing && !(missing === 'qr-order' && link.menuOnly(tenant))) return next(featureRefusal(missing, 'guest'));
      return next();
    }
    if (!path.startsWith('/staff/')) return next();
    let actor: Actor;
    try { actor = o.staffActor(req); } catch { return next(); }
    const enabled = link.features(actor.tenantId), has = (id: FeatureId) => hasFeature(enabled, id);
    // The Müdür account is part of the core (6 Ekim): no package check for it. A paired device's owner session (server/remote-admin.ts) while "Uzaktan yönetim" is not in the package.
    if (res.locals.remoteAdmin && !has('remote-admin')) return next(featureRefusal('remote-admin'));
    const missing = missingForRoute(path, enabled);
    if (missing) return next(featureRefusal(missing));
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Kasa ayarları are core; the vardiya switch and the bahşiş paylaşımı rule in them belong to "Vardiya".
    if (req.method === 'POST' && path === '/staff/cash/settings' && !has('shifts') && ('shiftTracking' in body || 'tipRule' in body)) return next(featureRefusal('shifts'));
    if (req.method === 'GET') {
      if (path === '/staff/reports/overview') trimmed(res, b => { if (!has('reports-advanced')) { b.previous = null; delete b.channels; } if (!has('reservations')) delete b.reservationSales; return b; });
      if (path === '/staff/reports/simple' && !has('reports-advanced')) trimmed(res, b => ({ ...b, vat: null, ...(typeof b.sentence === 'string' ? { sentence: withoutComparison(b.sentence) } : {}) }));
      // "Tümü" year table: its KDV column belongs to "Gelişmiş raporlar" like the KDV dökümü.
      if (path === '/staff/reports/years' && !has('reports-advanced')) trimmed(res, b => { const t = b.table as { years?: Record<string, unknown>[]; total?: Record<string, unknown> } | undefined; for (const r of [...(t?.years ?? []), ...(t?.total ? [t.total] : [])]) { delete r.vat; delete r.vatRows; } return b; });
      if ((path === '/staff/cash/status' || path === '/staff/cash/settings') && !has('shifts')) trimmed(res, b => {
        if ('shiftTracking' in b) b.shiftTracking = false;
        const settings = b.settings as Record<string, unknown> | undefined;
        if (settings && typeof settings === 'object' && 'shiftTracking' in settings) b.settings = { ...settings, shiftTracking: false };
        return b;
      });
    }
    next();
  });

  // The owner closed "Deneme süreniz bitti" (shown once; Bildirimler (üst çubuktaki zil) keeps a copy).
  app.post('/api/staff/package/notice-seen', (req, res) => {
    const a = o.staffActor(req); requireRole(store.read(a.tenantId), a, ['owner']);
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(req.body);
    link.seePackageNotice(a.tenantId, id);
    res.json({ ok: true });
  });
}

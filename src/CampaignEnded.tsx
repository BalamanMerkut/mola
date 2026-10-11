import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Tag } from 'lucide-react';
import type { CampaignReport } from '../packages/domain/campaign-reports';
import { BEFORE_WEEKS } from '../packages/domain/campaigns';
import type { Product } from '../packages/domain/types';
import { api, money } from './api';
import { Modal } from './components';
import { goTo } from './navigate';
import { NOTIFICATIONS_CHANGED, notificationsChanged } from './notificationCount';
import type { NotificationItem } from './notificationActions';
import './campaigns.css';

type Row = CampaignReport['campaigns'][number];
type Results = { row: Row | null; profit: number | null };
const number = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
/** Browser tests' devices say "off" (playwright.config.ts): a campaign another spec ended must not cover their screens. */
const silenced = () => { try { return localStorage.getItem('mola-campaign-ended') === 'off'; } catch { return false; } };

/**
 * "Kampanya bitti" (10 Ekim, sahibin onayı): the owner's one-time window for a campaign that ended (its end time passed or its
 * quota was used up; server/notifications.ts makes one notification each, only for campaigns that end after this version).
 * The figures come from the campaign report (Satış ve Raporlar → Kampanyalar); the gross profit only when every product sold
 * under it has a recipe cost (Stok), and the comparison only when the report has one. Any button marks it read, so it never
 * comes back; it stays in Bildirimler. The Müdür has only the notification.
 */
export function CampaignEnded({ products }: { products: Product[] }) {
  const [item, setItem] = useState<NotificationItem | null>(null), [results, setResults] = useState<Results | null>(null);
  const look = useCallback(async () => {
    if (document.hidden || silenced()) return;
    try {
      const { items } = await api<{ items: NotificationItem[] }>('/api/staff/notifications');
      const next = items.filter(n => n.kind === 'campaign' && !n.read && n.campaign).sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
      setItem(current => current ?? next);
    } catch { /* asked again on the next look */ }
  }, []);
  useEffect(() => {
    void look();
    const timer = setInterval(() => void look(), 60000);
    window.addEventListener(NOTIFICATIONS_CHANGED, look); document.addEventListener('visibilitychange', look);
    return () => { clearInterval(timer); window.removeEventListener(NOTIFICATIONS_CHANGED, look); document.removeEventListener('visibilitychange', look); };
  }, [look]);
  useEffect(() => {
    if (!item?.campaign) return;
    let live = true; setResults(null);
    (async () => {
      let row: Row | null = null, profit: number | null = null;
      // The report may sit behind the telefon kodu: then the window names the campaign and "Raporu aç" asks for the code.
      try { row = (await api<CampaignReport>('/api/staff/reports/campaigns')).campaigns.find(c => c.id === item.campaign!.reportId) ?? null; } catch { row = null; }
      const sold = row?.products.filter(p => p.appliedQuantity > 0) ?? [];
      if (row && sold.length && !sold.some(p => products.find(x => x.id === p.id)?.unit === 'kg')) {
        try {
          const stock = await api<{ products: Record<string, { cost?: number | null }> }>('/api/staff/stock');
          const costs = sold.map(p => stock.products[p.id]?.cost);
          if (costs.every(c => typeof c === 'number')) profit = row.appliedAmount - sold.reduce((n, p, i) => n + p.appliedQuantity * (costs[i] as number), 0);
        } catch { profit = null; }
      }
      if (live) setResults({ row, profit });
    })();
    return () => { live = false; };
  }, [item, products]);
  if (!item?.campaign) return null;
  const close = (then?: () => void) => {
    const id = item.id; setItem(null); setResults(null);
    void api('/api/staff/notifications/read', { ids: [id] }).catch(() => undefined).finally(() => notificationsChanged());
    then?.();
  };
  const row = results?.row, c = item.campaign;
  const compare = row && row.durationDays >= 1 && row.changePercent !== null;
  return <Modal title={item.title} className="campaign-ended-dialog" onClose={() => close()}>
    <div className="modal-body campaign-ended-body">
      <p className="campaign-ended-lead"><Tag size={18} aria-hidden="true" />{c.reason === 'quota' ? 'Adet sınırı doldu; kampanya artık uygulanmıyor.' : 'Kampanyanın süresi doldu; ürünler normal fiyatına döndü.'}</p>
      {!results ? <p className="muted" role="status">Sonuçlar hazırlanıyor…</p> : !row ? <p className="muted">Sonuçlar Satış ve Raporlar → Kampanyalar'da.</p>
        : <dl className="campaign-ended-figures">
          {c.uses !== undefined && <div><dt>Kaç kez uygulandı</dt><dd>{c.uses.toLocaleString('tr-TR')} siparişte</dd></div>}
          <div><dt>Kampanyalı satılan</dt><dd>{row.appliedQuantity.toLocaleString('tr-TR')} adet</dd></div>
          <div><dt>Ciro (indirim sonrası)</dt><dd>{money(row.appliedAmount)}</dd></div>
          <div><dt>Verilen indirim</dt><dd>{money(row.discount)}</dd></div>
          {results.profit !== null && <div><dt>Brüt kâr (reçete maliyetiyle)</dt><dd>{money(results.profit)}</dd></div>}
          {compare && <div className="campaign-ended-compare"><dt>{row.recurring ? `Önceki ${BEFORE_WEEKS} haftanın aynı günlerine göre` : 'Önceki 7 güne göre'} günlük satış</dt><dd>{number(row.dailyBefore)} → {number(row.dailyDuring)} adet/gün ({row.changePercent! > 0 ? '+' : ''}%{number(row.changePercent!)})</dd></div>}
        </dl>}
      <div className="modal-actions campaign-ended-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>Kapat</button>
        <button type="button" className="btn secondary" onClick={() => close(() => goTo({ view: 'menu', tab: 'campaigns', renew: c.id }))}><RotateCcw size={16} aria-hidden="true" />Kampanyayı yinele</button>
        <button type="button" className="btn primary" onClick={() => close(() => goTo({ view: 'reports', tab: 'campaigns', campaign: c.reportId }))}>Raporu aç</button>
      </div>
    </div>
  </Modal>;
}

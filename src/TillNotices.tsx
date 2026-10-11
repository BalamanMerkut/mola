import { useEffect, useState } from 'react';
import { HandCoins, X } from 'lucide-react';
import { tillNoticeText, type PublicTillNotice } from '../packages/domain/till-notices';
import { api, money } from './api';
import { trackFiscal } from './FiscalHelper';
import './refunds.css';

/*
 * "Sahip iadeyi yaptı" on the cashier's Masalar (9 Ekim kullanıcı testi, K-A): the owner did a refund from a phone while the
 * guest waits at the till. A short green strip per refund ("Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye
 * verin."), closed with ✕ for this person (server: POST /api/staff/refunds/till-notices/seen); the yazar kasa refund card
 * comes into this screen's dock once (src/FiscalHelper.tsx). Rules and wording: packages/domain/till-notices.ts.
 */
const tracked = new Set<string>();
const remembered = (id: string) => { try { return sessionStorage.getItem(`mola-till:${id}`) === '1'; } catch { return tracked.has(id); } };
const remember = (id: string) => { tracked.add(id); try { sessionStorage.setItem(`mola-till:${id}`, '1'); } catch { /* this tab only */ } };

export function TillNotices({ notices, visible, onError }: { notices?: PublicTillNotice[]; visible: boolean; onError: (message: string) => void }) {
  const [closing, setClosing] = useState<string[]>([]);
  // The yazar kasa card: once per refund on this screen, even while the strip is on another view's back.
  useEffect(() => {
    for (const n of notices ?? []) if (!tracked.has(n.refundId) && !remembered(n.refundId)) { remember(n.refundId); trackFiscal(n.paymentId, { refundId: n.refundId, docked: true }); }
  }, [notices]);
  const list = (notices ?? []).filter(n => !closing.includes(n.id));
  if (!visible || !list.length) return null;
  async function close(id: string) {
    setClosing(c => [...c, id]);
    try { await api('/api/staff/refunds/till-notices/seen', { id }); } catch (e) { setClosing(c => c.filter(x => x !== id)); onError((e as Error).message); }
  }
  return <div className="till-notices">{list.map(n => <div key={n.id} className="till-notice" role="status" data-testid="till-notice">
    <HandCoins size={18} aria-hidden="true" />
    <p>{tillNoticeText({ byRole: n.byRole, tableName: n.tableName, method: n.method, money: money(n.amount) })}<small>{n.byName} · {new Date(n.at).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })}</small></p>
    <button type="button" className="icon-btn" aria-label="İade uyarısını kapat" onClick={() => void close(n.id)}><X size={17} /></button>
  </div>)}</div>;
}

import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCheck, FileChartColumn, HardDrive, Inbox, Package, RotateCcw, ShieldAlert, Store } from 'lucide-react';
import { Banknote, Printer, Tag, Undo2 } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { notificationsChanged } from './notificationCount';
import { goTo } from './navigate';
// Where each notification's button goes (src/notificationActions.ts, unit-tested in tests/notification-actions.test.ts).
import { notificationActionOf as actionOf, type NotificationItem as Item } from './notificationActions';

// 'report': a period report (gün sonu, hafta, ay, yıl; also e-mailed when set up); 'demo': a "Tanıtım" business was reset.
const icons = { reminder: BellRing, license: ShieldAlert, backup: HardDrive, merkez: Store, stock: Package, cash: Banknote, expense: Banknote, report: FileChartColumn, demo: RotateCcw, campaign: Tag, printer: Printer, refund: Undo2 };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * Bildirimler (the owner's bell on the top bar; once a tab of Destek): Ajanda reminders and café notices, newest first. Opening one marks it read for this owner;
 * "Tümünü okundu say" marks all. Reminders open their day in Ajanda.
 */
export function NotificationInbox({ onAgenda, manager = false }: { onAgenda?: (day: string) => void; manager?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null), [error, setError] = useState('');
  const load = useCallback(async () => { try { setItems((await api<{ items: Item[] }>('/api/staff/notifications')).items); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(t); }, [load]);
  async function read(ids?: string[]) {
    setItems(list => list?.map(n => !ids || ids.includes(n.id) ? { ...n, read: true } : n) ?? list);
    try { await api('/api/staff/notifications/read', ids ? { ids } : {}); } catch (e) { setError((e as Error).message); }
    notificationsChanged(); void load();
  }
  const unread = items?.filter(n => !n.read).length ?? 0;
  return <section className="panel notification-inbox" aria-label="Bildirimler">
    <div className="notification-head"><div><h2>Bildirimler</h2><p className="muted small">{manager ? 'Kasiyerin iade istekleri ve biten kampanyalar burada toplanır.' : 'Kasa farkları, iade istekleri, azalan stok, giderler, biten kampanyalar, raporlar, ajanda hatırlatmaları, lisans ve yedek uyarıları burada toplanır.'}</p></div>{unread > 0 && <button type="button" className="btn secondary" onClick={() => void read()}><CheckCheck size={17} />Tümünü okundu say</button>}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {items === null && !error ? <p className="muted" role="status">Bildirimler yükleniyor…</p> : !items?.length ? <div className="notification-empty"><Inbox size={30} strokeWidth={1.4} aria-hidden="true" /><p>Henüz bildirim yok.</p><span className="muted small">{manager ? 'Kasiyer iade isteği gönderince ya da bir kampanya bitince burada görünür.' : 'Ajandaya hatırlatıcılı bir not eklediğinizde zamanı gelince burada görünür.'}</span></div>
      : <ul className="notification-list">{items.map(n => { const Icon = icons[n.kind] ?? BellRing; return <li key={n.id} className={`notification-item ${n.read ? '' : 'unread'} ${n.kind}`}>
        <button type="button" className="notification-open" aria-label={`${n.title}${n.read ? '' : ' (okunmadı)'}`} onClick={() => { if (!n.read) void read([n.id]); }}>
          <span className="notification-icon" aria-hidden="true"><Icon size={18} /></span>
          <span className="notification-text"><strong>{n.title}</strong><span>{n.text}</span><small>{when(n.at)}</small></span>
          {!n.read && <span className="notification-new" aria-hidden="true">Yeni</span>}
        </button>
        {n.kind === 'reminder' && n.day && onAgenda && <button type="button" className="text-btn notification-link" onClick={() => { if (!n.read) void read([n.id]); onAgenda(n.day!); }}>Ajandada göster</button>}
        {(() => { const a = actionOf(n); return a && <button type="button" className="text-btn notification-link" onClick={() => { if (!n.read) void read([n.id]); goTo(a[1]); }}>{a[0]}</button>; })()}
      </li>; })}</ul>}
  </section>;
}

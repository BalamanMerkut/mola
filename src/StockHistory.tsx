import { useEffect, useState } from 'react';
import { History, Search, X } from 'lucide-react';
import { STOCK_EVENT_NAMES, type StockEvent } from '../packages/domain/stock-history';
import { roleNames } from '../packages/domain/roles';
import { api } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';
import { Segmented } from './SettingsKit';
import './stock.css';

type Range = 'today' | '7' | '30' | 'all';
type HistoryView = { events: StockEvent[]; total: number; page: number; more: boolean; people: { id: string; name: string; role: string }[]; items: { id: string; name: string; removed: boolean }[]; all: boolean };
const PAGE = 25;
const RANGES: { value: Range; label: string }[] = [{ value: 'today', label: 'Bugün' }, { value: '7', label: '7 gün' }, { value: '30', label: '30 gün' }, { value: 'all', label: 'Tümü' }];
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const roleText = (role: string) => role === 'system' ? 'Mola' : roleNames[role as keyof typeof roleNames] ?? '';
const TONE: Partial<Record<StockEvent['kind'], string>> = { purchase: 'in', return: 'in', start: 'in', waste: 'out', undo: 'warn', item_remove: 'warn', recipe: 'info', min: 'info', item_edit: 'info', item_add: 'info', price: 'info' };

/** Stok → "İşlem geçmişi" button: the header (every item) and an item's window (that item). */
export function StockHistoryButton({ onClick, label = 'İşlem geçmişi' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="btn secondary small-btn stock-history-btn" onClick={onClick}><History size={16} aria-hidden="true" />{label}</button>;
}

/**
 * Stok → İşlem geçmişi (8 Ekim): who did what to the stock and when, newest first, 25 a page (server/stock.ts
 * GET /api/staff/stock/history). The owner and the Müdür see everyone's records; the kitchen only its own counts and fire.
 */
export function StockHistory({ itemId: startItem, all, onClose }: { itemId?: string; all?: boolean; onClose: () => void }) {
  const [range, setRange] = useState<Range>(startItem || all ? 'all' : '7'), [itemId, setItemId] = useState(startItem ?? ''), [by, setBy] = useState('');
  const [query, setQuery] = useState(''), [q, setQ] = useState(''), [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryView | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => { const t = setTimeout(() => { setQ(query.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => {
    let live = true; setLoading(true);
    const params = new URLSearchParams({ range, page: String(page), ...(itemId ? { itemId } : {}), ...(by ? { by } : {}), ...(q ? { q } : {}) });
    api<HistoryView>(`/api/staff/stock/history?${params}`).then(d => { if (live) { setData(d); setError(''); } }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range, itemId, by, q, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const filtered = range !== '7' || itemId || by || q;
  return <Modal title="İşlem geçmişi" wide className="stock-modal stock-history-modal" onClose={onClose}>
    <div className="modal-body stock-history">
      <p className="stock-history-lead muted small">Stokta kim, ne zaman, ne yaptı.<HelpTip title="İşlem geçmişi">Alış, sayım, fire, iade, fiyat düzeltme, geri alma, reçete değişikliği, malzeme ekleme / düzenleme / silme ve uyarı sınırı değişiklikleri; kişi, rol ve saatiyle. İşletme sahibi ve Müdür herkesin kayıtlarını görür; mutfak yalnız kendi sayım ve fire kayıtlarını görür. Satışlar burada tek tek görünmez, stoktan reçeteyle kendiliğinden düşer. Eski kayıtlarda kişi bilinmiyorsa “—” yazar.</HelpTip></p>
      <div className="stock-history-filters">
        <Segmented label="Zaman aralığı" wide value={range} options={RANGES} onChange={v => { setRange(v); setPage(1); }} />
        <div className="stock-history-selects">
          <select aria-label="Malzeme" value={itemId} onChange={e => { setItemId(e.target.value); setPage(1); }}><option value="">Tüm malzemeler</option>{data?.items.map(i => <option key={i.id} value={i.id}>{i.name}{i.removed ? ' (silindi)' : ''}</option>)}{itemId && !data?.items.some(i => i.id === itemId) && <option value={itemId}>Seçili malzeme</option>}</select>
          {data?.all && <select aria-label="Kişi" value={by} onChange={e => { setBy(e.target.value); setPage(1); }}><option value="">Herkes</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}{roleText(p.role) && roleText(p.role) !== p.name ? ` · ${roleText(p.role)}` : ''}</option>)}</select>}
          <label className="stock-search"><Search size={17} aria-hidden="true" /><input type="search" value={query} maxLength={80} onChange={e => setQuery(e.target.value)} placeholder="Ara: malzeme, kişi, not" aria-label="İşlem geçmişinde ara" />{query && <button type="button" className="icon-btn" aria-label="Aramayı temizle" onClick={() => setQuery('')}><X size={15} /></button>}</label>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {/* 9 Ekim kullanıcı testi: on a five-year café a new range takes 2–3 s; the old list stayed without a word. */}
      {loading && <p className="muted small stock-history-loading" role="status">Yükleniyor…</p>}
      {data && (!data.events.length ? <p className="stock-empty-line">{filtered ? 'Bu seçimde kayıt yok.' : 'Son 7 günde kayıt yok.'}{range !== 'all' && <> <button type="button" className="text-btn" onClick={() => { setRange('all'); setPage(1); }}>Tümünü göster</button></>}</p>
        : <ol className="stock-history-list" aria-label="Kayıtlar" aria-busy={loading || undefined}>{data.events.map(e => {
          const change = e.after !== undefined ? (e.before !== undefined ? `${e.before} → ${e.after}` : e.after) : '', amount = e.amount && !(e.before !== undefined && e.after !== undefined) ? e.amount : '';
          return <li key={e.id} className="stock-history-row">
            <span className={`stock-history-kind ${TONE[e.kind] ?? ''}`}>{STOCK_EVENT_NAMES[e.kind]}</span>
            <div className="stock-history-main">
              <p><strong>{e.subject}</strong>{amount && <span className="stock-history-amount">{amount}</span>}</p>
              {change && <p className="stock-history-change">{change}</p>}
              {e.note && <p className="stock-history-note">{e.note}</p>}
            </div>
            <p className="stock-history-meta"><span className="stock-history-who"><b>{e.byName}</b>{e.byName !== '—' && roleText(e.role) && roleText(e.role) !== e.byName && <span className="stock-history-role">{roleText(e.role)}</span>}</span><time dateTime={e.at}>{when(e.at)}</time></p>
          </li>;
        })}</ol>)}
      {data && pages > 1 && <nav className="stock-history-pager" aria-label="Sayfalar"><button type="button" className="btn secondary small-btn" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Önceki</button><span>Sayfa {page} / {pages} · {data.total} kayıt</span><button type="button" className="btn secondary small-btn" disabled={!data.more || loading} onClick={() => setPage(page + 1)}>Sonraki</button></nav>}    </div>
  </Modal>;
}

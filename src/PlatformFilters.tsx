import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { BusinessOrder } from './businessOrder';
import { backupWarning, expiresSoon, offline, runningPaid, runningTrial, waitsForAdmin, type Business } from './platformStatus';

/** The chips the owner asked for; the rarer states are in the small "Diğer durumlar" list next to them. */
export const businessFilters = [['all', 'Tümü'], ['running', 'Çalışıyor'], ['trial', 'Deneme'], ['expiring', 'Bitiyor'], ['offline', 'Bağlantı yok'], ['paused', 'Askıda']] as const;
export const moreFilters = [['pending', 'Kod bekleniyor'], ['setup', 'Kurulum bekliyor'], ['expired', 'Süresi doldu'], ['backup', 'Yedek sorunu'], ['support', 'Destek / dondurma bekleyen']] as const;
export type BusinessFilter = typeof businessFilters[number][0] | typeof moreFilters[number][0];
export function matchesBusiness(l: Business, filter: BusinessFilter) {
  switch (filter) {
    case 'running': return runningPaid(l);
    case 'trial': return runningTrial(l) || (l.kind === 'trial' && l.activation === 'active' && !l.endsAt && !l.suspended);
    case 'expiring': return expiresSoon(l);
    case 'offline': return offline(l) && !l.suspended;
    case 'paused': return l.suspended || l.frozen;
    case 'pending': return l.activation === 'pending' && !l.application;
    case 'setup': return l.activation === 'active' && !l.setupCompleted;
    case 'expired': return !!l.endsAt && !l.active && !l.suspended && !l.frozen;
    case 'backup': return backupWarning(l);
    case 'support': return waitsForAdmin(l);
    default: return true;
  }
}
/** One search box, the status chips, a small sort; the count line says how much of the list is showing. */
export function BusinessFilters({ total, query, filter, onChange, count, order, onOrderChange, extra }: { order: BusinessOrder; onOrderChange: (order: BusinessOrder) => void; total: number; query: string; filter: BusinessFilter; onChange: (query: string, filter: BusinessFilter) => void; count: number; extra?: ReactNode }) {
  const more = moreFilters.some(([id]) => id === filter);
  return <section className="platform-filters" aria-label="İşletme arama ve filtreleme">
    <div className="platform-filter-row">
      <label className="platform-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="İşletme ara" placeholder="Ad, telefon, e-posta ya da vergi no ile ara" maxLength={80} value={query} onChange={e => onChange(e.target.value, filter)} /></label>
      <select className="platform-sort" aria-label="İşletme sıralaması" value={order} onChange={e => onOrderChange(e.target.value as BusinessOrder)}><option value="created">Eklenme sırası</option><option value="name">Ada göre</option><option value="expiry">Önce bitecekler</option></select>
    </div>
    <div className="platform-chip-row">
      <div className="platform-pills" role="group" aria-label="İşletme durumu">{businessFilters.map(([id, title]) => <button type="button" key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => onChange(query, id)}>{title}</button>)}</div>
      <select className={`platform-more ${more ? 'active' : ''}`} aria-label="Diğer durumlar" value={more ? filter : ''} onChange={e => onChange(query, (e.target.value || 'all') as BusinessFilter)}><option value="">Diğer durumlar…</option>{moreFilters.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select>
    </div>
    <div className="platform-count" role="status"><span>{count === total ? `${total} işletme` : `${total} işletmeden ${count} tanesi`}</span>{(query || filter !== 'all') && <button type="button" className="text-btn" onClick={() => onChange('', 'all')}>Filtreleri temizle</button>}{extra}</div>
  </section>;
}

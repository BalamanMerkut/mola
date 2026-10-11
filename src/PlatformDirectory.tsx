import { useId } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import './platform-activation-help.css';
import './platform-integrity.css';
import { expiresSoon, filesChanged, openApplication, rowStatus, runningPaid, runningTrial, sectorChip, seenAgo, strongDuplicates, type Business } from './platformStatus';

/** Three quiet numbers on "Bugün"; each opens the list it counts. */
export function PlatformSummary({ businesses, onFilter }: { businesses: Business[]; onFilter: (filter: 'running' | 'trial' | 'expiring') => void }) {
  const items = [['running', 'Çalışıyor', businesses.filter(runningPaid).length], ['trial', 'Denemede', businesses.filter(runningTrial).length], ['expiring', 'Bitiyor', businesses.filter(expiresSoon).length]] as const;
  return <div className="platform-summary" aria-label="Özet">{items.map(([id, title, n]) => <button type="button" key={id} className={id === 'expiring' && n ? 'warn' : ''} onClick={() => onFilter(id)}><strong>{n}</strong><span>{title}</span></button>)}</div>;
}

const shortPlan = (l: Business) => openApplication(l) ? 'Başvuru' : l.kind === 'trial' ? 'Deneme' : l.planMonths === 12 ? 'Yıllık' : l.planMonths === 6 ? '6 aylık' : l.planMonths === 1 ? 'Aylık' : 'Abonelik';
/** "Son bağlantı az önce", or that the café computer has not reported in yet. */
export function lastSeenLine(l: Business) {
  if (openApplication(l)) return 'Onay bekliyor';
  if (l.activation === 'pending' || !l.lastSeenAt) return 'Henüz bağlanmadı';
  return `Son bağlantı ${seenAgo(l.lastSeenAt).toLocaleLowerCase('tr-TR')}`;
}

/**
 * İşletmeler as big tiles (like the café's "Masalar"): the name, city · kind, one status chip and a quiet grey line. The
 * whole tile opens the business. "İşletme ekle" is always the first tile.
 */
export function BusinessTiles({ items, onOpen, onAdd, addDisabled }: { items: Business[]; onOpen: (tenantId: string) => void; onAdd: () => void; addDisabled: boolean }) {
  const hint = useId();
  return <div className="business-tiles" role="list" aria-label="İşletmeler">
    <div role="listitem" className="business-tile-cell"><button type="button" className="business-tile add-tile" disabled={addDisabled} aria-label="İşletme ekle" aria-describedby={hint} onClick={onAdd}>
      <span className="add-tile-icon" aria-hidden="true"><Plus size={22} /></span><strong>İşletme ekle</strong><small id={hint}>Etkinleştirme kodu oluşturur</small>
    </button></div>
    {items.map(l => {
      const status = rowStatus(l), place = [l.invoice?.city, l.sector && sectorChip[l.sector]].filter(Boolean).join(' · ');
      // The package by name (an old plan only when it is the menu-only one, as before packaging).
      const pack = l.services ? (l.services.legacy === 'menu' ? 'QR menü' : l.services.chosen && !l.services.legacy ? l.services.packageName : '') : l.service === 'menu' ? 'QR menü' : '';
      const meta = [shortPlan(l), pack, l.appVersion && `Sürüm ${l.appVersion}`].filter(Boolean).join(' · ');
      const flags = [l.openTickets > 0 && `${l.openTickets} açık talep`, strongDuplicates(l).length > 0 && 'Olası tekrar'].filter(Boolean).join(' · ');
      return <div role="listitem" key={l.tenantId} className="business-tile-cell"><button type="button" className="business-tile platform-business-row" onClick={() => onOpen(l.tenantId)}>
        <strong className="platform-business-name">{l.name}</strong>{!!l.formerNames?.length && <small className="platform-business-former muted" title="İşletme sahibi adı Mola'da değiştirdi">Önceki adı: {l.formerNames[0]}</small>}
        <span className="tile-place">{place || 'İl ve tür girilmedi'}</span>
        <span className="tile-chips"><span className={`status-chip ${status.tone}`}>{status.label}</span>{filesChanged(l) && <span className="status-chip bad files-changed-chip">Dosyalar değiştirilmiş</span>}</span>
        <small className="tile-meta"><span>{meta}</span><span>{lastSeenLine(l)}</span>{flags && <span className="tile-flags">{flags}</span>}
          {/* "Kod bekleniyor": where the code goes, so nobody looks for a field in Mola Yönetim (details on the Lisans tab). */}
          {l.activation === 'pending' && !openApplication(l) && <span className="tile-code-hint"><KeyRound size={13} aria-hidden="true" />Kod, kafenin bilgisayarındaki Mola’da “Etkinleştirme kodum var”a girilir</span>}</small>
      </button></div>;
    })}
  </div>;
}

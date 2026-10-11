import { Clock, Plus, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Ticket } from '../server/license';
import { compareTickets, lastActivity, listTime, startedByMola, ticketChip, type TicketSide } from './ticketOrder';

type Filter = 'open' | 'all';
const STEP = 30;
const lower = (s: string) => s.toLocaleLowerCase('tr-TR');
/** A message with files only: what the preview says instead of text. */
const filesLine = (files?: { type: string }[]) => !files?.length ? '' : files.length > 1 ? `${files.length} ek gönderildi` : files[0].type === 'application/pdf' ? 'PDF gönderildi' : 'Fotoğraf gönderildi';
/**
 * Destek's ticket list (the left side of the chat, or the first screen on a phone): subject, a one-line preview of the last
 * message, its time ("14:05" / "Dün" / "3 Eki"), the status chip and a dot for an answer not read yet. Mola Yönetim also shows
 * the business and can narrow the list to one business. Newest activity first.
 */
export function TicketInbox({ side, tickets, selected, onSelect, unread, names, businesses, businessId = '', onBusinessChange, onNew, newActive = false, initialFilter = 'all', businessLabel }: {
  side: TicketSide; tickets: Ticket[]; selected: string; onSelect: (id: string) => void; unread: (t: Ticket) => boolean;
  names?: Map<string, string>; businesses?: { tenantId: string; name: string }[]; businessId?: string; onBusinessChange?: (id: string) => void;
  onNew?: () => void; newActive?: boolean; initialFilter?: Filter; businessLabel?: (tenantId: string) => ReactNode;
}) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>(initialFilter), [shown, setShown] = useState(STEP);
  const scoped = businessId ? tickets.filter(t => t.tenantId === businessId) : tickets;
  const q = lower(query.trim());
  const found = scoped.filter(t => !q || lower(`${t.subject} ${t.id} ${names?.get(t.tenantId) ?? ''} ${t.messages.at(-1)?.text ?? ''}`).includes(q)).sort((a, b) => compareTickets(a, b, 'recent'));
  // The open ticket stays in the list after it is closed (no row jumping away under the pointer).
  const filtered = found.filter(t => filter === 'all' || t.status === 'open' || t.id === selected);
  const openCount = found.filter(t => t.status === 'open').length;
  const filters: [Filter, string, number][] = [['open', 'Açık', openCount], ['all', 'Tümü', found.length]];
  return <aside className="tc-list" aria-label="Destek talepleri">
    <div className="tc-list-head">
      <div className="tc-list-title"><h2>Talepler</h2>{onNew && <button type="button" className={`btn ${newActive ? 'secondary' : 'primary'} small-btn tc-new-btn`} onClick={onNew}><Plus size={16} aria-hidden="true" />Yeni talep</button>}</div>
      {businesses && onBusinessChange && <label className="tc-business">Destek işletmesi<select value={businessId} onChange={e => { onBusinessChange(e.target.value); setShown(STEP); }}><option value="">Tüm işletmeler</option>{businesses.map(b => <option key={b.tenantId} value={b.tenantId}>{b.name}</option>)}</select></label>}
      <label className="tc-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Destek talebi ara" maxLength={120} value={query} placeholder={businesses ? 'Konu, işletme veya mesaj ara' : 'Konu veya mesaj ara'} onChange={e => { setQuery(e.target.value); setShown(STEP); }} /></label>
      <div className="tc-filter" role="group" aria-label="Talep durumu">{filters.map(([id, title, count]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setShown(STEP); }}>{title}<span>{count}</span></button>)}</div>
      {(query || businessId) && <button type="button" className="text-btn tc-clear" onClick={() => { setQuery(''); onBusinessChange?.(''); setShown(STEP); }}>Filtreleri temizle</button>}
    </div>
    {filtered.length > 0 ? <ul className="tc-items">{filtered.slice(0, shown).map(t => {
      const last = t.messages.at(-1) as (Ticket['messages'][number] & { queued?: boolean }) | undefined, chip = ticketChip(t), dot = unread(t) && t.id !== selected;
      const waiting = side === 'business' && t.messages.some(m => (m as { queued?: boolean }).queued);
      const business = side === 'support' ? names?.get(t.tenantId) ?? 'İşletme' : '';
      // Mola Yönetim: the name opens the business preview, so it sits under the card's button (never a button inside a button).
      const peek = side === 'support' ? businessLabel?.(t.tenantId) : undefined;
      return <li key={t.id} className={peek ? 'tc-peek-row' : undefined}><button type="button" className={`tc-item${t.id === selected ? ' selected' : ''}${dot ? ' unread' : ''}`} aria-current={t.id === selected ? 'true' : undefined} onClick={() => onSelect(t.id)}>
        <span className="tc-item-top"><strong className="tc-item-subject">{t.subject}</strong><time dateTime={lastActivity(t)}>{listTime(lastActivity(t))}</time></span>
        {((business && !peek) || startedByMola(t)) && <span className="tc-item-business">{!peek && business}{!peek && business && startedByMola(t) && ' · '}{startedByMola(t) && <span className="tc-item-mola">Mola ekibi başlattı</span>}</span>}
        <span className="tc-item-bottom"><span className="tc-item-preview">{waiting && <span className="tc-item-queued"><Clock size={12} aria-hidden="true" />Gönderilmeyi bekliyor · </span>}{last?.source === side && 'Siz: '}{last?.text ? last.text.slice(0, 200) : filesLine(last?.attachments)}</span>{dot && <span className="tc-dot" role="img" aria-label="Okunmamış yanıt" />}<span className={`tc-chip ${chip.tone}`}>{chip.label}</span></span>
      </button>{peek && <span className="tc-item-business-line">{peek}</span>}</li>;
    })}</ul> : <p className="tc-empty">{tickets.length ? (filter === 'open' && !q && !businessId ? 'Açık talep yok.' : 'Bu aramaya uygun destek talebi bulunamadı.') : side === 'business' ? 'Henüz destek talebi yok. Bir sorununuz olursa “Yeni talep” ile yazın; Mola ekibi buradan yanıtlar.' : 'Henüz destek talebi yok.'}</p>}
    {filtered.length > shown && <button type="button" className="text-btn tc-more" onClick={() => setShown(shown + STEP)}>Daha fazla talep göster ({filtered.length - shown})</button>}
  </aside>;
}

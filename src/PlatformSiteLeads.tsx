import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronRight, Globe, Mail, MessageSquarePlus, Phone, RotateCcw, Trash2, X } from 'lucide-react';
import { showSiteLeadPhone, SITE_LEAD_SECTOR, type SiteLeadType } from '../packages/domain/site-lead';
import { api, requestId } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';
import './platform-site-leads.css';

/*
 * Mola Yönetim → Başvurular → "Web sitesi talepleri" (server/merkez/site-leads.ts): what people sent from the contact form
 * on molayazilim.com.tr. Not a "Hesap açma başvurusu" (no café computer behind it yet): a person to call. The vendor marks
 * it "Arandı" / "Kapandı", writes notes, starts "İşletme ekle" filled from it, or deletes it (a KVKK request).
 */
export type SiteLead = {
  id: string; createdAt: string; status: 'new' | 'called' | 'closed'; statusAt?: string; statusName: string;
  business: string; person: string; phone: string; email?: string; city: string; tables?: number; type: SiteLeadType; typeName: string; message?: string;
  consent: { at: string; version: string }; notes: { at: string; text: string }[]; tenantId?: string;
};
export type SiteLeadCounts = { new: number; called: number; closed: number; open: number; total: number };
/** What "İşletme ekle" starts with when opened from a lead. */
export type LeadPrefill = { leadId: string; name: string; contactName: string; sector?: 'cafe' | 'restaurant' | 'dessert' };

/** The list and its counts, read now and every 30 seconds (the badge and Bugün use the counts). */
export function useSiteLeads() {
  const [leads, setLeads] = useState<SiteLead[] | null>(null), [counts, setCounts] = useState<SiteLeadCounts | null>(null);
  const live = useRef(true);
  const reload = useCallback(async () => {
    try { const r = await api<{ leads: SiteLead[]; counts: SiteLeadCounts }>(`${ADMIN}/site-leads`); if (live.current) { setLeads(r.leads); setCounts(r.counts); } }
    catch { /* an older Merkez without the route, or signed out: nothing shown */ }
  }, []);
  useEffect(() => { live.current = true; void reload(); const t = setInterval(() => void reload(), 30_000); return () => { live.current = false; clearInterval(t); }; }, [reload]);
  return { leads, counts, reload };
}

export function SiteLeadList({ leads, disabled, onChanged, onAddBusiness, onOpenBusiness, businessName }: {
  leads: SiteLead[]; disabled: boolean; onChanged: () => Promise<void> | void; onAddBusiness: (p: LeadPrefill) => void;
  onOpenBusiness: (tenantId: string) => void; businessName: (tenantId: string) => string | undefined;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const open = leads.filter(l => l.status !== 'closed'), closed = leads.filter(l => l.status === 'closed');
  return <div className="site-leads">
    {!open.length && <p className="platform-empty">Bekleyen web sitesi talebi yok. molayazilim.com.tr’deki formdan gelenler burada görünür.</p>}
    {open.length > 0 && <div className="application-list" role="list" aria-label="Web sitesi talepleri">{open.map(l => <LeadCard key={l.id} lead={l} disabled={disabled} onChanged={onChanged} onAddBusiness={onAddBusiness} onOpenBusiness={onOpenBusiness} businessName={businessName} />)}</div>}
    {closed.length > 0 && <section className="page-section" aria-label="Kapanan talepler">
      <button type="button" className="text-btn site-leads-closed-toggle" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>Kapanan talepler ({closed.length})<ChevronRight size={15} aria-hidden="true" /></button>
      {showClosed && <><p className="page-lead">Kapanan talepler kapandıktan 2 yıl sonra kendiliğinden silinir.</p>
        <div className="application-list" role="list" aria-label="Kapanan web sitesi talepleri">{closed.map(l => <LeadCard key={l.id} lead={l} disabled={disabled} onChanged={onChanged} onAddBusiness={onAddBusiness} onOpenBusiness={onOpenBusiness} businessName={businessName} />)}</div></>}
    </section>}
  </div>;
}

function LeadCard({ lead: l, disabled, onChanged, onAddBusiness, onOpenBusiness, businessName }: { lead: SiteLead; disabled: boolean; onChanged: () => Promise<void> | void; onAddBusiness: (p: LeadPrefill) => void; onOpenBusiness: (tenantId: string) => void; businessName: (tenantId: string) => string | undefined }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState<string | null>(null), [deleting, setDeleting] = useState(false);
  const off = disabled || busy;
  async function send(path: string, body: object) {
    setBusy(true); setError('');
    try { await api(`${ADMIN}/site-leads/${path}`, { requestId: requestId(), id: l.id, ...body }); await onChanged(); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  const linked = l.tenantId ? businessName(l.tenantId) : undefined;
  const tone = l.status === 'new' ? 'warn' : l.status === 'called' ? 'info' : 'idle';
  return <article role="listitem" className={`application-card site-lead-card status-${l.status}`} aria-label={`${l.business} · web sitesi talebi`}>
    <header>
      <strong className="site-lead-name">{l.business}</strong>
      <span className="status-chip info site-lead-kind"><Globe size={13} aria-hidden="true" />Web sitesi talebi</span>
      <span className={`status-chip ${tone}`}>{l.statusName}</span>
      <small className="muted">{[l.typeName, l.city, l.tables ? `${l.tables} masa` : '', `Gönderim: ${dateTime(l.createdAt)}`].filter(Boolean).join(' · ')}</small>
    </header>
    <dl className="invoice-facts">
      <div><dt>İlgili kişi</dt><dd>{l.person}</dd></div>
      <div><dt>Telefon</dt><dd><a href={`tel:${l.phone}`}>{showSiteLeadPhone(l.phone)}</a></dd></div>
      {l.email && <div><dt>E-posta</dt><dd><a href={`mailto:${l.email}`}>{l.email}</a></dd></div>}
      <div><dt>KVKK onayı</dt><dd>{dateTime(l.consent.at)} · {l.consent.version}</dd></div>
    </dl>
    {l.message && <blockquote className="site-lead-message">{l.message}</blockquote>}
    {l.notes.length > 0 && <ul className="site-lead-notes" aria-label="Notlar">{l.notes.map((n, i) => <li key={i}><small>{dateTime(n.at)}</small>{n.text}</li>)}</ul>}
    {l.tenantId && <p className="site-lead-linked">İşletme eklendi: {linked ? <button type="button" className="text-btn" onClick={() => onOpenBusiness(l.tenantId!)}>{linked}<ChevronRight size={13} aria-hidden="true" /></button> : 'kayıt silinmiş'}</p>}
    {error && <Notice tone="error">{error}</Notice>}
    {note !== null ? <form className="application-reject" onSubmit={e => { e.preventDefault(); void send('note', { text: note.trim() }).then(ok => { if (ok) setNote(null); }); }}>
      <label>Not (yalnız siz görürsünüz)<textarea rows={2} maxLength={500} required disabled={off} value={note} onChange={e => setNote(e.target.value)} placeholder="ör. Pazartesi 14:00’te uğrayacağız." /></label>
      <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={off} onClick={() => setNote(null)}>Vazgeç</button><button className="btn primary small-btn" disabled={off || !note.trim()}>Notu kaydet</button></div>
    </form>
      : deleting ? <div className="application-actions site-lead-delete" role="group" aria-label="Talebi sil">
        <span>Bu talep ve notları kalıcı olarak silinsin mi? (ör. kişi bilgilerinin silinmesini istediyse)</span>
        <button type="button" className="btn secondary small-btn" disabled={off} onClick={() => setDeleting(false)}>Vazgeç</button>
        <button type="button" className="btn delete-catalog small-btn" disabled={off} onClick={() => void send('delete', {})}><Trash2 size={14} />Evet, sil</button>
      </div>
      : <div className="application-actions">
        {l.status === 'new' && <button type="button" className="btn primary small-btn" disabled={off} onClick={() => void send('status', { status: 'called' })}><Phone size={14} />Arandı</button>}
        {l.status !== 'closed' && <button type="button" className="btn secondary small-btn" disabled={off} onClick={() => void send('status', { status: 'closed' })}><Check size={14} />Kapandı</button>}
        {l.status === 'closed' && <button type="button" className="btn secondary small-btn" disabled={off} onClick={() => void send('status', { status: 'new' })}><RotateCcw size={14} />Yeniden aç</button>}
        <button type="button" className="btn secondary small-btn" disabled={off} onClick={() => setNote('')}><MessageSquarePlus size={14} />Not ekle</button>
        {!l.tenantId && <button type="button" className="btn secondary small-btn" disabled={off} onClick={() => onAddBusiness({ leadId: l.id, name: l.business, contactName: l.person, sector: SITE_LEAD_SECTOR[l.type] })}><Building2 size={14} />İşletme ekle</button>}
        {l.email && <a className="btn secondary small-btn" href={`mailto:${l.email}`}><Mail size={14} />E-posta</a>}
        <button type="button" className="text-btn site-lead-remove" disabled={off} onClick={() => setDeleting(true)}><X size={14} aria-hidden="true" />Sil</button>
      </div>}
  </article>;
}
/** After "İşletme ekle" from a lead: the new business is linked to it (the lead shows "İşletme eklendi"). */
export async function linkLead(leadId: string, tenantId: string) {
  try { await api(`${ADMIN}/site-leads/link`, { requestId: requestId(), id: leadId, tenantId }); } catch { /* the business exists; the link is only a convenience */ }
}

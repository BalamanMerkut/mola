import { useState } from 'react';
import { Check, ChevronRight, Pencil, X } from 'lucide-react';
import { normalPhone, showPhone, taxTypeNames, validEmail, validTaxNumber, type Invoice, type TaxType } from '../packages/domain/invoice';
import { Notice } from './components';
import { CopyButton } from './PlatformDetailKit';
import { ADMIN, businessStatus, dateTime, sectorChip, strongDuplicates, type Business } from './platformStatus';

type Mutate = (path: string, body: object) => Promise<boolean>;

/** The invoice details as the vendor reads them (and copies them into the e-fatura / e-arşiv program). */
export function InvoiceFacts({ invoice: i, copy = false }: { invoice: Invoice; copy?: boolean }) {
  const rows: [string, string][] = [['Ticari unvan', i.legalName], ['Mükellef', taxTypeNames[i.taxType]], ['Vergi dairesi', i.taxOffice], [i.taxType === 'company' ? 'Vergi kimlik no' : 'T.C. kimlik no', i.taxNumber],
    ['Adres', `${i.address}, ${i.district} / ${i.city}`], ['Cep telefonu', showPhone(i.phone)], ['E-posta', i.email]];
  // `copy`: the business page's Bilgiler shows a small copy button beside each value (src/PlatformDetailKit.tsx).
  return <dl className={`invoice-facts${copy ? ' copyable' : ''}`}>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{copy ? <><span className="ddefs-value">{v}</span><CopyButton text={v} label={`${k} kopyala`} /></> : v}</dd></div>)}</dl>;
}
/**
 * Only the vendor sees which other records share the tax number, phone or e-mail (or this computer under another tax number);
 * the café is never told. Each repeat names the other record and why. `repeats: false`: the detail window lists them itself.
 */
export function ApplicationFlags({ l, onOpen, disabled, repeats = true }: { l: Business; onOpen?: (tenantId: string) => void; disabled?: boolean; repeats?: boolean }) {
  const others = repeats ? strongDuplicates(l).filter(o => !l.sameTax?.some(t => t.tenantId === o.tenantId)) : [];
  // An older Merkez sent only yes/no for phone and e-mail.
  const contact = repeats && !l.duplicates ? [l.sameContact?.phone && 'telefon', l.sameContact?.email && 'e-posta'].filter(Boolean) : [];
  const repeat = !!l.application?.duplicateTax && l.application.status === 'pending';
  const deleted = !!l.application?.deletedTax && l.application.status === 'pending';
  if (!l.sameTax?.length && !others.length && !contact.length && !repeat && !deleted) return null;
  return <div className="application-flags">
    {deleted && <p className="flag-warn"><strong>Bu vergi numarası daha önce silinen bir işletmeye aitti.</strong> İşletmeye bu söylenmedi; ekranında “Onay bekleniyor” görür. Yeni deneme olarak başlatabilir ya da reddedebilirsiniz.</p>}
    {repeat &&<p className="flag-warn"><strong>Aynı vergi / T.C. kimlik no daha önce başka bir kayıtta kullanılmış.</strong> İşletmeye bu söylenmedi; ekranında “Onay bekleniyor” görür. Ek şubeyse “Ek şube olarak kabul et”i, değilse “Reddet”i seçin.</p>}
    {!!l.sameTax?.length && <p><strong>Aynı vergi no ile kayıtlı işletmeler: {l.sameTax.length}</strong>{onOpen && l.sameTax.map(o => <button type="button" key={o.tenantId} className="text-btn" disabled={disabled} onClick={() => onOpen(o.tenantId)}>{o.name}<ChevronRight size={13} aria-hidden="true" /></button>)}</p>}
    {/* One line per card however many there are: "Olası tekrar (3)" opens the records and why, in two aligned columns. */}
    {others.length > 0 && <details className="application-repeats"><summary>Olası tekrar ({others.length})</summary>
      <ul aria-label="Olası tekrar kayıtlar">{others.map(o => <li key={o.tenantId}>{onOpen ? <button type="button" className="text-btn" disabled={disabled} onClick={() => onOpen(o.tenantId)}>{o.name}<ChevronRight size={13} aria-hidden="true" /></button> : <strong>{o.name}</strong>}<small className="muted">{o.reasons?.join(' · ')}</small></li>)}</ul></details>}
    {!!contact.length && <p>Olası tekrar ({contact.join('/')})</p>}
  </div>;
}
/**
 * Pending: start the 30-day trial (the café picks it up within seconds) or refuse with a reason the café shows.
 * Refused for a tax number already in use: "Ek şube olarak kabul et" starts it anyway as another branch.
 */
export function ApplicationActions({ l, disabled, mutate }: { l: Business; disabled: boolean; mutate: Mutate }) {
  const [rejecting, setRejecting] = useState(false), [reason, setReason] = useState('');
  const a = l.application; if (!a || a.status === 'approved') return null;
  if (a.status === 'rejected') return a.duplicateTax
    ? <div className="application-actions"><button type="button" className="btn primary small-btn" disabled={disabled} onClick={() => void mutate(`${ADMIN}/applications/approve`, { tenantId: l.tenantId, branch: true })}><Check size={15} />Ek şube olarak kabul et</button><span className="muted small">Kabul edilirse 30 günlük deneme başlar.</span></div>
    : <p className="muted small">Reddedildi: {a.reason}. İşletme bilgileri düzeltip yeniden gönderince burada yeniden onay bekler.</p>;
  return rejecting
    ? <form className="application-reject" onSubmit={e => { e.preventDefault(); void mutate(`${ADMIN}/applications/reject`, { tenantId: l.tenantId, reason: reason.trim() }).then(ok => { if (ok) { setRejecting(false); setReason(''); } }); }}>
      <label>Ret nedeni (işletmeye gösterilir)<textarea required minLength={3} maxLength={300} rows={2} disabled={disabled} value={reason} onChange={e => setReason(e.target.value)} placeholder="ör. Vergi dairesi ile vergi numarası eşleşmiyor." /></label>
      <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => setRejecting(false)}>Vazgeç</button><button className="btn delete-catalog small-btn" disabled={disabled || reason.trim().length < 3}><X size={15} />Başvuruyu reddet</button></div>
    </form>
    : <div className="application-actions">
      {a.duplicateTax ? <button type="button" className="btn primary small-btn" disabled={disabled} onClick={() => void mutate(`${ADMIN}/applications/approve`, { tenantId: l.tenantId, branch: true })}><Check size={15} />Ek şube olarak kabul et</button>
        : <button type="button" className="btn primary small-btn" disabled={disabled} onClick={() => void mutate(`${ADMIN}/applications/approve`, { tenantId: l.tenantId })}><Check size={15} />30 günlük denemeyi başlat</button>}
      <button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => setRejecting(true)}><X size={15} />Reddet</button>
    </div>;
}
/** "Başvurular": every application waiting for a decision (or a correction), with all its invoice details. */
export function ApplicationList({ items, disabled, mutate, onOpen, label = 'Başvurular' }: { items: Business[]; disabled: boolean; mutate: Mutate; onOpen: (tenantId: string) => void; label?: string }) {
  return <div className="application-list" role="list" aria-label={label}>
    {items.map(l => { const status = businessStatus(l); return <article role="listitem" key={l.tenantId} className="application-card">
      <header><button type="button" className="text-btn application-name" disabled={disabled} onClick={() => onOpen(l.tenantId)}>{l.name}<ChevronRight size={16} aria-hidden="true" /></button>
        {l.application?.status === 'rejected' && <span className={`status-chip ${status.tone}`}>{status.label}</span>}
        <small className="muted">{[l.sector && sectorChip[l.sector], l.contactName && `Yetkili: ${l.contactName}`, `İlk gönderim: ${dateTime(l.application?.firstSubmittedAt ?? l.application?.submittedAt)}`, (l.application?.submissions ?? 1) > 1 && `${l.application!.submissions}. gönderim: ${dateTime(l.application!.submittedAt)}`].filter(Boolean).join(' · ')}</small></header>
      {l.invoice && <InvoiceFacts invoice={l.invoice} />}
      <ApplicationFlags l={l} onOpen={onOpen} disabled={disabled} />
      <ApplicationActions l={l} disabled={disabled} mutate={mutate} />
    </article>; })}
  </div>;
}

const blank: Invoice = { legalName: '', taxOffice: '', taxType: 'company', taxNumber: '', city: '', district: '', address: '', phone: '', email: '' };
/** Genel → "Fatura bilgileri": read, or corrected by the vendor (also for businesses added with "İşletme ekle"). */
export function InvoiceSection({ l, disabled, mutate }: { l: Business; disabled: boolean; mutate: Mutate }) {
  const [draft, setDraft] = useState<Invoice | null>(null), [tried, setTried] = useState(false);
  const edit = (field: keyof Invoice) => (value: string) => setDraft(d => d && { ...d, [field]: value });
  if (!draft) return <section className="detail-section detail-invoice" aria-label="Fatura bilgileri"><div className="detail-section-head"><h2>Fatura bilgileri</h2><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => { setDraft(l.invoice ?? blank); setTried(false); }}><Pencil size={14} />{l.invoice ? 'Düzenle' : 'Fatura bilgisi ekle'}</button></div>
    {l.invoice ? <InvoiceFacts invoice={l.invoice} copy /> : <p className="section-note">Fatura bilgisi yok. E-arşiv için “Fatura bilgisi ekle” ile girebilirsiniz.</p>}</section>;
  const taxNumber = draft.taxNumber.replace(/\D/g, ''), problems = [!validTaxNumber(draft.taxType, taxNumber) && 'Vergi / T.C. kimlik numarası geçersiz.', !normalPhone(draft.phone) && 'Cep telefonu geçersiz.', !validEmail(draft.email) && 'E-posta geçersiz.'].filter(Boolean) as string[];
  const input = (label: string, field: keyof Invoice, props: { maxLength: number; minLength?: number }) => <label>{label}<input required disabled={disabled} value={draft[field]} onChange={e => edit(field)(e.target.value)} {...props} /></label>;
  return <section className="detail-section detail-invoice" aria-label="Fatura bilgileri"><h2>Fatura bilgileri</h2>
    <form className="invoice-edit" onSubmit={e => { e.preventDefault(); setTried(true); if (problems.length) return; void mutate(`${ADMIN}/invoice`, { tenantId: l.tenantId, invoice: { ...draft, taxNumber, phone: normalPhone(draft.phone), email: draft.email.trim() } }).then(ok => { if (ok) setDraft(null); }); }}>
      <label>Mükellef türü<select disabled={disabled} value={draft.taxType} onChange={e => setDraft({ ...draft, taxType: e.target.value as TaxType })}><option value="company">Şirket</option><option value="person">Şahıs işletmesi</option></select></label>
      {input('Ticari unvan', 'legalName', { minLength: 3, maxLength: 200 })}{input('Vergi dairesi', 'taxOffice', { minLength: 2, maxLength: 60 })}
      {input(draft.taxType === 'company' ? 'Vergi kimlik no' : 'T.C. kimlik no', 'taxNumber', { maxLength: 11 })}{input('İl', 'city', { minLength: 2, maxLength: 40 })}{input('İlçe', 'district', { minLength: 2, maxLength: 60 })}
      {input('Açık adres', 'address', { minLength: 5, maxLength: 300 })}{input('Cep telefonu', 'phone', { maxLength: 20 })}{input('E-posta', 'email', { maxLength: 120 })}
      {tried && problems.length > 0 && <Notice tone="error">{problems.join(' ')}</Notice>}
      <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => setDraft(null)}>Vazgeç</button><button className="btn primary small-btn" disabled={disabled}>Fatura bilgilerini kaydet</button></div>
    </form></section>;
}

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { ArrowLeft, RefreshCw, Send } from 'lucide-react';
import { normalPhone, taxTypeNames, validEmail, validTaxNumber, type Invoice, type TaxType } from '../packages/domain/invoice';
import { sectorNames, sectors, type Sector } from '../packages/domain/sector';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { AGREEMENT_PROBLEM, AgreementCheck } from './LicenseAgreement';

/** What the café sends with "Hesap açma başvurusu" (server/sync-protocol.ts `applicationForm`). */
export type ApplicationFields = { businessName: string; sector: Sector; contactName: string; consent: true; invoice: Invoice };
const empty: Invoice = { legalName: '', taxOffice: '', taxType: 'company', taxNumber: '', city: '', district: '', address: '', phone: '', email: '' };

/**
 * The account application: what the vendor needs to open the account and issue e-fatura / e-arşiv invoices. Checked here
 * with the same rules as on both servers (packages/domain/invoice.ts), so a typo is shown at its field before sending.
 */
export function ApplicationForm({ initial, busy, error, retry, submitLabel, onSubmit, onBack, backLabel = 'Geri' }: {
  initial?: ApplicationFields; busy: boolean; error: string; retry: boolean; submitLabel: string; backLabel?: string;
  onSubmit: (fields: ApplicationFields) => void; onBack: () => void;
}) {
  const [businessName, setBusinessName] = useState(initial?.businessName ?? ''), [sector, setSector] = useState<Sector>(initial?.sector ?? 'cafe');
  const [invoice, setInvoice] = useState<Invoice>(initial?.invoice ?? empty), [contactName, setContactName] = useState(initial?.contactName ?? '');
  const [consent, setConsent] = useState(!!initial), [tried, setTried] = useState(false);
  // Mola Lisans Sözleşmesi: required here too (a correction of a sent application starts ticked, like the consent).
  const [agreed, setAgreed] = useState(!!initial);
  const set = (field: keyof Invoice) => (value: string) => setInvoice(i => ({ ...i, [field]: value }));
  const taxNumber = invoice.taxNumber.replace(/\D/g, '');
  const problems: Partial<Record<'taxNumber' | 'phone' | 'email' | 'consent' | 'agreement', string>> = {
    ...(!validTaxNumber(invoice.taxType, taxNumber) ? { taxNumber: invoice.taxType === 'company' ? 'Vergi kimlik numarası 10 haneli ve geçerli olmalı.' : 'T.C. kimlik numarası 11 haneli ve geçerli olmalı.' } : {}),
    ...(!normalPhone(invoice.phone) ? { phone: 'Cep telefonunu 05xx xxx xx xx biçiminde yazın.' } : {}),
    ...(!validEmail(invoice.email) ? { email: 'Geçerli bir e-posta adresi yazın.' } : {}),
    ...(!consent ? { consent: 'Devam etmek için onay kutusunu işaretleyin.' } : {}),
    ...(!agreed ? { agreement: AGREEMENT_PROBLEM } : {}),
  };
  const hint = (field: keyof typeof problems) => tried && problems[field] ? <small className="field-error" role="alert">{problems[field]}</small> : null;
  const field = (label: ReactNode, name: keyof Invoice, props: InputHTMLAttributes<HTMLInputElement> = {}) => <label>{label}<input required disabled={busy} value={invoice[name]} onChange={e => set(name)(e.target.value)} {...props} />{hint(name as keyof typeof problems)}</label>;
  return <form className="application-form" onSubmit={e => {
    e.preventDefault(); setTried(true);
    if (Object.keys(problems).length) return;
    onSubmit({ businessName: businessName.trim(), sector, contactName: contactName.trim(), consent: true, invoice: { ...invoice, taxNumber, phone: normalPhone(invoice.phone), email: invoice.email.trim() } });
  }}>
    <fieldset><legend>İşletme</legend>
      <label>İşletme adı (tabela adı) *<input required minLength={2} maxLength={80} disabled={busy} value={businessName} onChange={e => setBusinessName(e.target.value)} /></label>
      <div><span className="small">İşletme türü <HelpTip title="İşletme türü">İlk kurulumda bu türün başlangıç menüsü yüklenir. Sonra Ayarlar’dan değiştirebilirsiniz.</HelpTip></span><div className="activation-sector" role="group" aria-label="İşletme türü">{sectors.map(s => <button type="button" key={s} aria-pressed={sector === s} disabled={busy} onClick={() => setSector(s)}>{sectorNames[s]}</button>)}</div></div>
    </fieldset>
    <fieldset><legend>Fatura bilgileri <HelpTip title="Fatura bilgileri">E-fatura / e-arşiv faturanız bu bilgilerle düzenlenir. Ticari unvan, faturada görünecek tam addır.</HelpTip></legend>
      <div className="activation-sector" role="group" aria-label="Mükellef türü">{(['company', 'person'] as TaxType[]).map(t => <button type="button" key={t} aria-pressed={invoice.taxType === t} disabled={busy} onClick={() => setInvoice(i => ({ ...i, taxType: t }))}>{taxTypeNames[t]}</button>)}</div>
      {field('Ticari unvan *', 'legalName', { minLength: 3, maxLength: 200, placeholder: invoice.taxType === 'company' ? 'ör. Ayhanlar Gıda Ltd. Şti.' : 'ör. Ahmet Ayhan – Ayhanlar Çay Evi' })}
      <div className="application-pair">
        {field('Vergi dairesi *', 'taxOffice', { minLength: 2, maxLength: 60 })}
        {field(invoice.taxType === 'company' ? 'Vergi kimlik no *' : 'T.C. kimlik no *', 'taxNumber', { inputMode: 'numeric', autoComplete: 'off', maxLength: invoice.taxType === 'company' ? 10 : 11 })}
      </div>
      <div className="application-pair">{field('İl *', 'city', { minLength: 2, maxLength: 40 })}{field('İlçe *', 'district', { minLength: 2, maxLength: 60 })}</div>
      <label>Açık adres *<textarea required minLength={5} maxLength={300} rows={2} disabled={busy} value={invoice.address} onChange={e => set('address')(e.target.value)} /></label>
    </fieldset>
    <fieldset><legend>Yetkili</legend>
      <label>Yetkili adı soyadı *<input required minLength={2} maxLength={80} autoComplete="name" disabled={busy} value={contactName} onChange={e => setContactName(e.target.value)} /></label>
      <div className="application-pair">
        {field('Cep telefonu *', 'phone', { type: 'tel', autoComplete: 'tel', maxLength: 20, placeholder: '05xx xxx xx xx' })}
        {field('E-posta *', 'email', { type: 'email', autoComplete: 'email', maxLength: 120 })}
      </div>
    </fieldset>
    <label className="application-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} /><span>Bu bilgiler yalnız hesap açma ve faturalama için Mola’ya (Merkut Studios) iletilir; satış ve menü verileriniz bu bilgisayarda kalır. *</span></label>
    {hint('consent')}
    <details className="application-notice"><summary>Aydınlatma metninin tamamı</summary>
      <p>Veri sorumlusu Merkut Studios’tur (Mola). Bu formdaki işletme, fatura ve iletişim bilgileri yalnız hesabınızı açmak, lisansınızı yönetmek, e-fatura / e-arşiv faturanızı düzenleyip size iletmek ve sizinle iletişim kurmak için işlenir. E-posta adresiniz ayrıca, bilgisayarınız değişince verilerinizi geri alırken kimliğinizi doğrulamak için (“İşletmem var” doğrulama kodu) ve işletmeniz yeni bir bilgisayarda açıldığında sizi haberdar etmek için kullanılır; yasal zorunluluklar dışında kimseyle paylaşılmaz. Satış, ödeme, menü, çalışan ve müşteri bilgileriniz bu bilgisayarda kalır, Mola’ya gönderilmez. 6698 sayılı KVKK kapsamındaki haklarınız (bilgi alma, düzeltme, silme) için Mola destek ekibine başvurabilirsiniz.</p>
    </details>
    <AgreementCheck checked={agreed} onChange={setAgreed} disabled={busy} problem={tried ? problems.agreement : undefined} />
    {error && <Notice tone="error">{error}</Notice>}
    {retry && <p className="muted small">Yeniden göndermek yeni bir başvuru açmaz; bilgileri değiştirdiyseniz aynı başvuru güncellenir.</p>}
    <div className="activation-actions">
      <button type="button" className="btn secondary" disabled={busy} onClick={onBack}><ArrowLeft size={15} />{backLabel}</button>
      <button className="btn primary" disabled={busy}>{retry ? <RefreshCw size={15} /> : <Send size={15} />}{busy ? 'Mola Merkez’e gönderiliyor…' : retry ? 'Yeniden dene' : submitLabel}</button>
    </div>
  </form>;
}

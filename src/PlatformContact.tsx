import { useEffect, useState } from 'react';
import { Headset } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';

type Contact = { phone: string; whatsapp: string; email: string; hours: string; web: string; updatedAt?: string };
const blank: Contact = { phone: '', whatsapp: '', email: '', hours: '', web: '' };
/**
 * Ayarlar → "Mola ekibi iletişim bilgileri": what the cafés show when they need the vendor (application waiting or refused,
 * Merkez unreachable, a closed or moved licence, "Şifremi unuttum", Destek). Signed by Mola Merkez; a café that has not
 * activated yet reads it from the public address, an activated one gets it with its next heartbeat (within 10 minutes) and
 * keeps it for offline use. Empty fields are not shown; all empty: nothing is shown.
 */
export function ContactSettings() {
  const [form, setForm] = useState<Contact>(blank), [saved, setSaved] = useState<Contact | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { void api<{ contact: Contact | null }>(`${ADMIN}/contact`).then(r => { setSaved(r.contact); setForm(r.contact ?? blank); }, e => setError((e as Error).message)); }, []);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<{ contact: Contact }>(`${ADMIN}/contact`, { phone: form.phone, whatsapp: form.whatsapp, email: form.email, hours: form.hours, web: form.web }); setSaved(r.contact); setForm(r.contact); setNotice('Kaydedildi. Bağlı işletmelere bir sonraki bağlantıda (en geç 10 dakikada) ulaşır.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field = (k: keyof Contact, label: string, props: { placeholder?: string; type?: string; maxLength: number }) =>
    <label>{label}<input disabled={busy} value={form[k] ?? ''} onChange={e => { setForm(f => ({ ...f, [k]: e.target.value })); setNotice(''); setError(''); }} {...props} /></label>;
  const changed = (Object.keys(blank) as (keyof Contact)[]).some(k => (form[k] ?? '').trim() !== (saved?.[k] ?? ''));
  return <section className="panel contact-settings" aria-label="Mola ekibi iletişim bilgileri">
    <h2><Headset size={18} /> Mola ekibi iletişim bilgileri</h2>
    <p className="muted small">İşletmeler bu bilgileri başvuru beklerken, Mola Merkez’e ulaşılamadığında, lisans kapandığında, “Şifremi unuttum”da ve Destek ekranında görür. Boş bıraktığınız alan gösterilmez.</p>
    {/* The browser stops a submit with an invalid field (e-mail, https address) itself: an older answer must not stay above it. */}
    <form onSubmit={e => { e.preventDefault(); void save(); }} onInvalidCapture={() => { setError(''); setNotice(''); }}>
      <div className="form-columns">
        {field('phone', 'Telefon', { placeholder: 'ör. 0850 123 45 67', type: 'tel', maxLength: 30 })}
        {field('whatsapp', 'WhatsApp', { placeholder: 'ör. 0532 123 45 67', type: 'tel', maxLength: 30 })}
        {field('email', 'E-posta', { placeholder: 'ör. destek@ornek.com', type: 'email', maxLength: 120 })}
        {field('hours', 'Çalışma saatleri', { placeholder: 'ör. Hafta içi 09:00–18:00', maxLength: 120 })}
        {field('web', 'Web adresi (isteğe bağlı)', { placeholder: 'https://', type: 'url', maxLength: 200 })}
      </div>
      {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
      <div className="application-actions"><button className="btn primary small-btn" disabled={busy || !changed}>İletişim bilgilerini kaydet</button>
        <small className="muted">{saved?.updatedAt ? `Son kayıt: ${dateTime(saved.updatedAt)}` : 'Henüz kaydedilmedi: işletmelerde gösterilmiyor.'}</small></div>
    </form>
  </section>;
}

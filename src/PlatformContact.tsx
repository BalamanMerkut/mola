import { useEffect, useState } from 'react';
import { Headset, Share2 } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';

type Social = { instagram: string; facebook: string; x: string; youtube: string };
type Contact = { phone: string; whatsapp: string; email: string; hours: string; web: string; updatedAt?: string; social?: Social };
// The form keeps the social links beside the other fields (19 Ekim); Merkez gets and gives them as `social`.
type Form = Omit<Contact, 'social'> & Social;
const blankSocial: Social = { instagram: '', facebook: '', x: '', youtube: '' };
const blank: Form = { phone: '', whatsapp: '', email: '', hours: '', web: '', ...blankSocial };
const flat = (c: Contact | null): Form => { if (!c) return blank; const { social, ...rest } = c; return { ...blankSocial, ...rest, ...social }; };
/**
 * Ayarlar → "Mola ekibi iletişim bilgileri": what the cafés show when they need the vendor (application waiting or refused,
 * Merkez unreachable, a closed or moved licence, "Şifremi unuttum", Destek). Signed by Mola Merkez; a café that has not
 * activated yet reads it from the public address, an activated one gets it with its next heartbeat (within 10 minutes) and
 * keeps it for offline use. Empty fields are not shown; all empty: nothing is shown. Sosyal medya (19 Ekim): Mola's own
 * accounts, only for the web site's footer (GET /api/site/iletisim), never sent to the cafés.
 */
export function ContactSettings() {
  const [form, setForm] = useState<Form>(blank), [saved, setSaved] = useState<Form | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { void api<{ contact: Contact | null }>(`${ADMIN}/contact`).then(r => { setSaved(r.contact && flat(r.contact)); setForm(flat(r.contact)); }, e => setError((e as Error).message)); }, []);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<{ contact: Contact }>(`${ADMIN}/contact`, { phone: form.phone, whatsapp: form.whatsapp, email: form.email, hours: form.hours, web: form.web, social: { instagram: form.instagram, facebook: form.facebook, x: form.x, youtube: form.youtube } }); setSaved(flat(r.contact)); setForm(flat(r.contact)); setNotice('Kaydedildi. Bağlı işletmelere bir sonraki bağlantıda (en geç 10 dakikada) ulaşır.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field = (k: Exclude<keyof Form, 'updatedAt'>, label: string, props: { placeholder?: string; type?: string; maxLength: number }) =>
    <label>{label}<input disabled={busy} value={form[k] ?? ''} onChange={e => { setForm(f => ({ ...f, [k]: e.target.value })); setNotice(''); setError(''); }} {...props} /></label>;
  const changed = (Object.keys(blank) as (keyof Form)[]).some(k => (form[k] ?? '').trim() !== (saved?.[k] ?? ''));
  return <section className="panel contact-settings" aria-label="Mola ekibi iletişim bilgileri">
    <h2><Headset size={18} /> Mola ekibi iletişim bilgileri</h2>
    <p className="muted small">İşletmeler bu bilgileri başvuru beklerken, Mola Merkez’e ulaşılamadığında, lisans kapandığında, “Şifremi unuttum”da ve Destek ekranında görür. Telefon, WhatsApp, e-posta ve çalışma saatleri molayazilim.com.tr’de de gösterilir (kaydettikten 1 dakika içinde). Boş bıraktığınız alan işletmelerde gösterilmez; sitede sitenin kendi bilgisi kalır.</p>
    {/* The browser stops a submit with an invalid field (e-mail, https address) itself: an older answer must not stay above it. */}
    <form onSubmit={e => { e.preventDefault(); void save(); }} onInvalidCapture={() => { setError(''); setNotice(''); }}>
      <div className="form-columns">
        {field('phone', 'Telefon', { placeholder: 'ör. 0850 123 45 67', type: 'tel', maxLength: 30 })}
        {field('whatsapp', 'WhatsApp', { placeholder: 'ör. 0532 123 45 67', type: 'tel', maxLength: 30 })}
        {field('email', 'E-posta', { placeholder: 'ör. destek@ornek.com', type: 'email', maxLength: 120 })}
        {field('hours', 'Çalışma saatleri', { placeholder: 'ör. Hafta içi 09:00–18:00', maxLength: 120 })}
        {field('web', 'Web adresi (isteğe bağlı)', { placeholder: 'https://', type: 'url', maxLength: 200 })}
      </div>
      <h3 className="contact-social-title"><Share2 size={16} /> Sosyal medya (yalnız web sitesinde)</h3>
      <p className="muted small">molayazilim.com.tr’nin alt kısmındaki simgeler. Tam adresi yazın (https://…). Hiçbiri kaydedilmediyse site kendi listesini gösterir; bir kez kaydettikten sonra boş bıraktığınız hesap sitede gizlenir. İşletmelere gitmez.</p>
      <div className="form-columns">
        {field('instagram', 'Instagram', { placeholder: 'https://www.instagram.com/…', type: 'url', maxLength: 200 })}
        {field('facebook', 'Facebook', { placeholder: 'https://www.facebook.com/…', type: 'url', maxLength: 200 })}
        {field('x', 'X (Twitter)', { placeholder: 'https://x.com/…', type: 'url', maxLength: 200 })}
        {field('youtube', 'YouTube', { placeholder: 'https://www.youtube.com/@…', type: 'url', maxLength: 200 })}
      </div>
      {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
      <div className="application-actions"><button className="btn primary small-btn" disabled={busy || !changed}>İletişim bilgilerini kaydet</button>
        <small className="muted">{saved?.updatedAt ? `Son kayıt: ${dateTime(saved.updatedAt)}` : 'Henüz kaydedilmedi: işletmelerde gösterilmiyor.'}</small></div>
    </form>
  </section>;
}

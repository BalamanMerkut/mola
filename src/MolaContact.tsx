import { useEffect, useState } from 'react';
import { Clock, Globe, Mail, MessageCircle, Phone } from 'lucide-react';
import './mola-contact.css';

/** "Mola ekibi iletişim bilgileri", as the café keeps it (signed by Mola Merkez; see server/kafe-link.ts). */
export type MolaContactInfo = { phone: string; whatsapp: string; email: string; hours: string; web: string };
const digits = (v: string) => v.replace(/\D/g, '');
export const telLink = (v: string) => `tel:${v.trim().startsWith('+') ? '+' : ''}${digits(v)}`;
/** wa.me wants the international number without "+": 0532… and a bare 532… are Turkish numbers. */
export function whatsappLink(v: string) {
  let d = digits(v);
  if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = `90${d.slice(1)}`; else if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
  return `https://wa.me/${d}`;
}
let known: MolaContactInfo | null = null;
/**
 * The vendor's contact from this café's server (`/api/contact`, kept on this computer, so offline too). Plain fetch: a locked
 * café answers 423 here and that must not switch the page again. Nothing (null) until the vendor filled it in.
 */
export function useMolaContact() {
  const [contact, setContact] = useState<MolaContactInfo | null>(known);
  useEffect(() => {
    let live = true;
    void fetch('/api/contact', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null)
      .then((body: { contact?: MolaContactInfo | null } | null) => { if (!live || !body) return; known = body.contact ?? null; setContact(known); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return contact;
}
/**
 * The Mola team's phone, WhatsApp and e-mail as small round buttons (tel:, wa.me, mailto:), only those that are known: the
 * contact panel of "Paketiniz", the "Deneme süreniz bitti" window and the "paketinizde yok" card use the same ones.
 */
export function ContactButtons({ className = '', label = 'Mola ekibinin iletişim bilgileri' }: { className?: string; label?: string }) {
  const c = useMolaContact();
  if (!c || (!c.phone && !c.whatsapp && !c.email)) return null;
  return <div className={`contact-buttons ${className}`.trim()} role="group" aria-label={label}>
    {c.phone && <a className="contact-button" href={telLink(c.phone)}><Phone size={15} aria-hidden="true" />{c.phone}</a>}
    {c.whatsapp && <a className="contact-button whatsapp" href={whatsappLink(c.whatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} aria-hidden="true" />WhatsApp</a>}
    {c.email && <a className="contact-button" href={`mailto:${c.email}`}><Mail size={15} aria-hidden="true" />{c.email}</a>}
  </div>;
}
/** Phone, WhatsApp, e-mail, web and hours as links; renders nothing when the vendor left it empty. */
export function MolaContact({ title = 'Mola ekibine ulaşın', note, className = '' }: { title?: string; note?: string; className?: string }) {
  const c = useMolaContact();
  if (!c || (!c.phone && !c.whatsapp && !c.email && !c.web && !c.hours)) return null;
  return <section className={`mola-contact ${className}`} aria-label={title}>
    <h3>{title}</h3>
    {note && <p className="muted small">{note}</p>}
    <ul>
      {c.phone && <li><a href={telLink(c.phone)}><Phone size={15} aria-hidden="true" />{c.phone}</a></li>}
      {c.whatsapp && <li><a href={whatsappLink(c.whatsapp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} aria-hidden="true" />WhatsApp: {c.whatsapp}</a></li>}
      {c.email && <li><a href={`mailto:${c.email}`}><Mail size={15} aria-hidden="true" />{c.email}</a></li>}
      {/^https:\/\//.test(c.web) && <li><a href={c.web} target="_blank" rel="noopener noreferrer"><Globe size={15} aria-hidden="true" />{c.web.replace(/^https:\/\//, '').replace(/\/$/, '')}</a></li>}
      {c.hours && <li className="mola-contact-hours"><Clock size={15} aria-hidden="true" />{c.hours}</li>}
    </ul>
  </section>;
}

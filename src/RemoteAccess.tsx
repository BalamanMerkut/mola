import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Copy, Globe2, KeyRound, Laptop, ListChecks, Mail, MonitorSmartphone, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { deviceKindOf, type DeviceKind } from '../packages/domain/remote-crypto';
import { api, ApiError } from './api';
import { Notice } from './components';
import { LockedRow, usePackage } from './FeatureLock';
import { copyText, onCafeComputer } from './PermanentLink';
import { RemoteAdminSettings } from './RemoteAdminSettings';
import { remoteMode } from './remoteTransport';
import { Card } from './SettingsKit';
import './remote-support.css';

/*
 * Ayarlar → Uzaktan erişim (0.1.22; the owner's own account; the whole page needs 'remote-reports', else the package card).
 * The owner's decision: one website sign-in, nothing is paired here any more. Five short steps:
 *   1 Telefon kodu   set up here: the password, then the authenticator app (its otpauth:// link on a phone, its QR on a
 *                    computer), then its code (server/report-security.ts; resetting stays in Güvenlik ve yedek → Kilit).
 *   2 E-posta        the verified owner e-mail Mola Merkez keeps (server/owner-email.ts). None yet: typed and verified here
 *                    with a code sent to it (the application's address may be verified as it is). Changing it: Yedek.
 *   3 Cihazlarınızı bağlayın   the Raporlarım address in big letters (Kopyala, a small QR of it): on the phone and the laptop
 *                    the owner signs in there with the e-mail, the password and the phone code (src/ReportsPhone.tsx).
 *   4 Uzaktan yönetim   src/RemoteAdminSettings.tsx ('remote-admin'; else the faded row).
 *   5 Eşleşmiş cihazlar   kind, name, last report; "Kaldır" asks the password (not the code: the lost phone may hold the app).
 * A remote session ("Kafeyi yönet") cannot set the code up or remove a device: the server refuses, the page says so.
 */
type Phone = { id: string; name: string; ownerName: string; pairedAt: string; lastSeenAt: string | null; kind: DeviceKind | null };
type View = { phones: Phone[]; max: number; address: string | null; relay: { connected: boolean; error: string | null }; code?: boolean };
/** GET /api/staff/owner-email (masked address; 'owner' = verified, 'invoice' = the application's, not verified yet). */
type Email = { available: boolean; email: string | null; source: 'owner' | 'invoice' | null; reason?: string };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
// A device paired before 0.1.21 has no kind: shown as "Cihaz" and not taken for the phone (14 Ekim: a laptop paired with 0.1.20
// read "Telefonunuz bağlı: laptop" after the real phone was removed).
const kindOf = (p: Phone): DeviceKind | 'unknown' => p.kind ?? 'unknown';
const KIND_ICON: Record<DeviceKind | 'unknown', ReactNode> = { unknown: <MonitorSmartphone size={18} aria-hidden="true" />, phone: <Smartphone size={18} aria-hidden="true" />, tablet: <Tablet size={18} aria-hidden="true" />, computer: <Laptop size={18} aria-hidden="true" /> };
const KIND_NAME: Record<DeviceKind | 'unknown', string> = { unknown: 'Cihaz', phone: 'Telefon', tablet: 'Tablet', computer: 'Bilgisayar' };

export function RemoteAccess() {
  const pk = usePackage();
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [ownerOnly, setOwnerOnly] = useState(false), [added, setAdded] = useState('');
  const [email, setEmail] = useState<Email | null | undefined>(undefined);
  const cafe = onCafeComputer(), remote = remoteMode();
  const count = useRef<number | null>(null);
  const load = useCallback(() => api<View>('/api/staff/remote-reports').then(v => {
    // A device signed in while this page is open: said here too (the owner also gets a notification).
    if (count.current !== null && v.phones.length > count.current) setAdded(v.phones[v.phones.length - 1].name);
    count.current = v.phones.length; setView(v); setError('');
  }).catch(e => { if (e instanceof ApiError && e.status === 403) setOwnerOnly(true); else setError((e as Error).message); }), []);
  // Asked of Mola Merkez through this computer: once, and again after a verification (not with every refresh).
  const loadEmail = useCallback(() => api<Email>('/api/staff/owner-email').then(setEmail, () => setEmail(v => v ?? null)), []);
  useEffect(() => { if (ownerOnly) return; void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => clearInterval(t); }, [load, ownerOnly]);
  useEffect(() => { if (!ownerOnly) void loadEmail(); }, [loadEmail, ownerOnly]);
  if (ownerOnly) return <Card icon={<Smartphone size={18} aria-hidden="true" />} title="Uzaktan erişim"><p className="settings-card-note">Uzaktan erişimi yalnız işletme sahibi kendi hesabıyla kurar.</p></Card>;
  if (!view) return error ? <Notice tone="error">{error}</Notice> : <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>;
  return <div className="remote-access">
    {added && <Notice tone="success"><CheckCircle2 size={16} aria-hidden="true" /><span>Yeni cihaz bağlandı: <strong>{added}</strong>.</span></Notice>}

    <Card icon={<KeyRound size={18} aria-hidden="true" />} title="1 · Telefon kodu" className="remote-step">
      {view.code ? <p className="remote-done" role="status"><CheckCircle2 size={16} aria-hidden="true" /> Telefon kodu kurulu.</p>
        : remote ? <p className="settings-card-note">Telefon kodu yalnız kafedeki bilgisayardan kurulur.</p>
        : <PhoneCode onPhone={!cafe && deviceKindOf(navigator.userAgent, navigator.maxTouchPoints) === 'phone'} onDone={() => void load()} />}
    </Card>

    <Card icon={<Mail size={18} aria-hidden="true" />} title="2 · E-posta" className="remote-step">
      <LoginEmail email={email} onChange={() => void loadEmail()} />
    </Card>

    <Card icon={<Globe2 size={18} aria-hidden="true" />} title="3 · Cihazlarınızı bağlayın" className="remote-step">
      <Connect address={view.address} ready={!!view.code && email?.source === 'owner'} />
    </Card>

    {/* Drawn again once the phone code is set up above (its "Aç" needs the code). */}
    {pk.has('remote-admin') ? <RemoteAdminSettings key={view.code ? 'kod' : 'kodsuz'} title="4 · Uzaktan yönetim" /> : <LockedRow feature="remote-admin" title="4 · Uzaktan yönetim" />}

    <Card icon={<ListChecks size={18} aria-hidden="true" />} title="5 · Eşleşmiş cihazlar" className="remote-step">
      <Devices view={view} remote={remote} onChange={v => { count.current = v.phones.length; setView(v); }} />
      {view.phones.length > 0 && !view.relay.connected && <p className="settings-field-hint">{view.relay.error ? `Mola Merkez’e ulaşılamıyor: ${view.relay.error} Cihazlar son durumu gösterir.` : 'Mola Merkez’e bağlanılıyor…'}</p>}
    </Card>
    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}

/** Raporlar için telefon kodu, set up right here: the password, then the authenticator app (otpauth:// link on the phone, QR on a computer), then its code. */
function PhoneCode({ onPhone, onDone }: { onPhone: boolean; onDone: () => void }) {
  const id = useId();
  const [password, setPassword] = useState(''), [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null), [image, setImage] = useState('');
  const [code, setCode] = useState(''), [codes, setCodes] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => { let live = true; if (setup && !onPhone) void QRCode.toDataURL(setup.uri, { width: 200, margin: 1 }).then(v => { if (live) setImage(v); }); return () => { live = false; }; }, [setup, onPhone]);
  async function send<T>(path: string, body: unknown) { setBusy(true); setError(''); try { return await api<T>(path, body); } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); } }
  async function start(e: FormEvent) { e.preventDefault(); const typed = password; setPassword(''); const v = await send<{ secret: string; uri: string }>('/api/staff/report-security/setup', { password: typed }); if (v) setSetup(v); }
  async function confirm(e: FormEvent) { e.preventDefault(); const v = await send<{ recoveryCodes?: string[] }>('/api/staff/report-security/enable', { code }); setCode(''); if (v?.recoveryCodes?.length) setCodes(v.recoveryCodes); else if (v) onDone(); }
  if (codes.length) return <div className="remote-code">
    <Notice tone="success">Telefon kodu kuruldu. Kurtarma kodlarını kâğıda yazıp saklayın; bir daha gösterilmez.</Notice>
    <textarea aria-label="Kurtarma kodları" readOnly rows={Math.min(8, codes.length)} value={codes.join('\n')} />
    <div className="settings-actions"><button type="button" className="btn primary" onClick={onDone}>Kodları sakladım</button></div>
  </div>;
  if (!setup) return <form className="remote-code" aria-label="Telefon kodunu kur" onSubmit={e => void start(e)}>
    <p className="settings-field-hint">Telefonunuza ücretsiz bir doğrulama uygulaması (Google Authenticator gibi) kurun. Raporlar ve cihaz girişi bu 6 haneli kodu da sorar.</p>
    <label htmlFor={`${id}-password`}>Şifreniz</label>
    <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
    <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !password}><KeyRound size={16} aria-hidden="true" />Telefon kodunu kur</button></div>
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
  return <form className="remote-code" aria-label="Telefon kodunu onayla" onSubmit={e => void confirm(e)}>
    {onPhone ? <>
      <a className="btn primary remote-otp" href={setup.uri}>Doğrulama uygulamasını aç</a>
      <p className="settings-field-hint">Uygulama açılmazsa bu kurulum anahtarını uygulamaya elle yazın:</p>
      <div className="remote-key"><code>{setup.secret}</code><button type="button" className="btn secondary small-btn" onClick={() => setCopied(copyText(setup.secret))}><Copy size={14} aria-hidden="true" />{copied ? 'Kopyalandı' : 'Kopyala'}</button></div>
    </> : <>
      <p className="settings-field-hint">Telefonunuzdaki doğrulama uygulamasıyla bu QR kodunu okutun.</p>
      {image && <img className="remote-code-qr" src={image} width={200} height={200} alt="Doğrulama uygulaması kurulum QR kodu" />}
      <details><summary>QR okutamıyorum</summary><code style={{ overflowWrap: 'anywhere' }}>{setup.secret}</code></details>
    </>}
    <label htmlFor={`${id}-code`}>Uygulamadaki 6 haneli kod</label>
    <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Kontrol ediliyor…' : 'Kodu onayla'}</button></div>
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
}

/** The address devices sign in with: verified here when there is none (a code to it; Mola Merkez keeps it). */
function LoginEmail({ email, onChange }: { email: Email | null | undefined; onChange: () => void }) {
  const id = useId();
  const [typed, setTyped] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState<{ ticket: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (email === undefined) return <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>;
  if (email === null) return <p className="settings-card-note">E-posta durumu şu an alınamadı. Biraz sonra bu sayfayı yeniden açın.</p>;
  if (!email.available) return <p className="settings-card-note">{email.reason}</p>;
  if (email.source === 'owner') return <>
    <p className="remote-done" role="status"><CheckCircle2 size={16} aria-hidden="true" /> Giriş e-postanız: {email.email}</p>
    <p className="settings-field-hint">Değiştirmek için: Güvenlik ve yedek → Yedek → Yeni bilgisayar için e-posta.</p>
  </>;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  if (sent) return <form className="remote-email" aria-label="E-postayı doğrula" onSubmit={e => { e.preventDefault(); void run(async () => { await api('/api/staff/owner-email/confirm', { ticket: sent.ticket, code }); setSent(null); setCode(''); onChange(); }); }}>
    <p className="settings-field-hint">{sent.email} adresine 6 haneli kod gönderildi. Kod 10 dakika geçerlidir.</p>
    <label htmlFor={`${id}-code`}>E-postadaki kod</label>
    <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    <div className="settings-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => { setSent(null); setCode(''); setError(''); }}>Vazgeç</button><button type="submit" className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Doğrulanıyor…' : 'Doğrula'}</button></div>
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed.trim());
  return <form className="remote-email" aria-label="E-postanızı doğrulayın" onSubmit={e => { e.preventDefault(); const pw = password; setPassword(''); void run(async () => { setSent(await api<{ ticket: string; email: string }>('/api/staff/owner-email/new-code', { email: typed.trim(), password: pw })); }); }}>
    <p className="settings-card-note">{email.source === 'invoice' ? <>Başvurudaki adresiniz <strong>{email.email}</strong>. Bu adresi yazıp doğrulayın; telefonda ve laptopta bununla girersiniz.</> : 'Telefonda ve laptopta bu e-postayla girersiniz. Adresinizi yazıp doğrulayın.'}</p>
    <label htmlFor={`${id}-email`}>E-posta</label>
    <input id={`${id}-email`} type="email" autoComplete="email" maxLength={120} required value={typed} disabled={busy} onChange={e => setTyped(e.target.value)} />
    <label htmlFor={`${id}-password`}>Şifreniz</label>
    <input id={`${id}-password`} type="password" autoComplete="current-password" maxLength={200} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
    <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !valid || !password}>{busy ? 'Gönderiliyor…' : 'Kod gönder'}</button></div>
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
}

/** "Cihazlarınızı bağlayın": the plain Raporlarım address (no secret in it), big, with Kopyala and a small QR. */
function Connect({ address, ready }: { address: string | null; ready: boolean }) {
  const [image, setImage] = useState(''), [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => { let live = true; if (address) void QRCode.toDataURL(address, { width: 240, margin: 1, color: { dark: '#234c3e', light: '#ffffff' } }).then(v => { if (live) setImage(v); }); return () => { live = false; }; }, [address]);
  if (!address) return <p className="settings-card-note">Adres, Mola bu bilgisayarda etkinleştirilince burada görünür.</p>;
  return <div className="remote-connect">
    <p className="settings-card-note">Telefonunuzda ve laptopunuzda bu adresi açın, e-posta, şifre ve telefon kodunuzla giriş yapın.</p>
    <div className="remote-address"><strong className="remote-address-text">{address.replace(/^https?:\/\//, '')}</strong>
      <button type="button" className="btn secondary small-btn" onClick={() => setCopied(copyText(address))}><Copy size={14} aria-hidden="true" />{copied ? 'Kopyalandı' : 'Kopyala'}</button></div>
    {copied === false && <input className="remote-address-copy" readOnly value={address} aria-label="Raporlarım adresi" onFocus={e => e.currentTarget.select()} />}
    {image && <img className="remote-address-qr" src={image} width={120} height={120} alt="Raporlarım adresinin QR kodu" />}
    <p className="settings-field-hint">{ready ? 'Önce telefonunuzla girin; laptop ve tablet ondan sonra. Yeni cihaz girerken kasa bilgisayarı açık olmalı.' : 'Telefon kodu ve e-posta (1 ve 2) tamamlanınca giriş açılır.'}</p>
  </div>;
}

function Devices({ view, remote, onChange }: { view: View; remote: boolean; onChange: (v: View) => void }) {
  const [removing, setRemoving] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function remove(e: FormEvent, phoneId: string) {
    e.preventDefault(); setBusy(true); setError('');
    const typed = password; setPassword('');
    try { onChange(await api<View>('/api/staff/remote-reports/phones/remove', { id: phoneId, password: typed })); setRemoving(''); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  if (!view.phones.length) return <p className="settings-card-note">Henüz eşleşmiş cihaz yok.</p>;
  return <>
    <ul className="phone-list" aria-label="Eşleşmiş cihazlar">{view.phones.map(p => <li key={p.id}>
      {KIND_ICON[kindOf(p)]}<div><strong>{p.name}</strong>
        <span>{KIND_NAME[kindOf(p)]} · {p.lastSeenAt ? `Son rapor: ${when(p.lastSeenAt)}` : 'Henüz rapor almadı'}</span>
        <span>Giriş {when(p.pairedAt)} · {p.ownerName}</span></div>
      {remote ? null : removing === p.id ? <form className="phone-confirm" aria-label={`${p.name} cihazını kaldır`} onSubmit={e => void remove(e, p.id)}>
        <input type="password" value={password} maxLength={200} required autoComplete="current-password" placeholder="Şifreniz" aria-label="Şifreniz" disabled={busy} autoFocus onChange={e => setPassword(e.target.value)} />
        <button type="submit" className="btn danger small-btn" disabled={busy || !password}>Evet, kaldır</button><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => { setRemoving(''); setPassword(''); }}>Vazgeç</button></form>
        : <button type="button" className="btn secondary small-btn" aria-label={`${p.name} cihazını kaldır`} disabled={busy} onClick={() => { setRemoving(p.id); setPassword(''); setError(''); }}><Trash2 size={15} aria-hidden="true" />Kaldır</button>}
    </li>)}</ul>
    <p className="settings-field-hint">En fazla {view.max} cihaz. <Globe2 size={13} aria-hidden="true" /> Raporlar yalnız bu cihazlar için şifrelenir; Mola Merkez okuyamaz.</p>
    {error && <Notice tone="error">{error}</Notice>}
  </>;
}

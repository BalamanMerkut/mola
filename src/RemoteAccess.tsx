import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, Copy, Globe2, KeyRound, Laptop, Link2, ListChecks, LockKeyhole, MonitorSmartphone, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { deviceKindOf, type DeviceKind } from '../packages/domain/remote-crypto';
import { api, ApiError } from './api';
import { Notice } from './components';
import { LockedRow, usePackage } from './FeatureLock';
import { copyText, onCafeComputer, PermanentLink, type LanLink } from './PermanentLink';
import { RemoteAdminSettings } from './RemoteAdminSettings';
import { remoteMode } from './remoteTransport';
import { Card } from './SettingsKit';
import { useNetwork } from './SettingsQr';
import './remote-support.css';

/*
 * Ayarlar → Uzaktan erişim (0.1.21; the owner's own account; the whole page needs 'remote-reports', else the package card).
 * One guided page, numbered so the order is obvious, after the owner's own test (iPhone and a laptop without Mola):
 *   1 Telefonunuz   first, always. "Bu ekranı şu an telefonunuzdan mı açtınız?" (suggested from this browser, the owner says).
 *                   On the phone itself (café Wi-Fi, the permanent link): the phone code with the authenticator app opened by
 *                   its otpauth:// link (or the setup key, Kopyala), then "Bu telefonu eşleştir" opens the pairing link in this
 *                   very browser. On a computer: the phone code's QR, then the pairing QR for the phone's camera.
 *   2 Laptop ve tablet   only once a phone is paired (the café refuses another device before it too: server/remote-reports.ts):
 *                   "Bu cihazı eşleştir" on that device (not on the café computer).
 *   3 Kısayol       "Bu cihaza kısayol ekle": Mola Merkez's /k/<kod>/kur (server/merkez/lan-link.ts), one time; then the icon
 *                   opens the register at the café and Raporlarım anywhere else.
 *   4 Uzaktan yönetim   src/RemoteAdminSettings.tsx ('remote-admin'; else the faded row).
 *   5 Eşleşmiş cihazlar   kind, name, last report; "Kaldır" asks the password (not the code: the lost phone may hold the app).
 * Pairing asks the device's name, the owner's password and phone code (server/remote-reports.ts); the code's set-up uses
 * server/report-security.ts (resetting it stays in Güvenlik ve yedek → Kilit ve güncelleme). A remote session ("Kafeyi yönet")
 * can pair and remove nothing: the server refuses, the page says so.
 */
type Phone = { id: string; name: string; ownerName: string; pairedAt: string; lastSeenAt: string | null; kind: DeviceKind | null };
type View = { phones: Phone[]; max: number; pairing: { expiresAt: string } | null; relay: { connected: boolean; error: string | null }; code?: boolean };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
/** Devices paired before 0.1.21 say nothing: phones. */
// A device paired before 0.1.21 has no kind: shown as "Cihaz" and not taken for the phone (14 Ekim: a laptop paired with 0.1.20
// read "Telefonunuz bağlı: laptop" after the real phone was removed).
const kindOf = (p: Phone): DeviceKind | 'unknown' => p.kind ?? 'unknown';
const KIND_ICON: Record<DeviceKind | 'unknown', ReactNode> = { unknown: <MonitorSmartphone size={18} aria-hidden="true" />, phone: <Smartphone size={18} aria-hidden="true" />, tablet: <Tablet size={18} aria-hidden="true" />, computer: <Laptop size={18} aria-hidden="true" /> };
const KIND_NAME: Record<DeviceKind | 'unknown', string> = { unknown: 'Cihaz', phone: 'Telefon', tablet: 'Tablet', computer: 'Bilgisayar' };
const thisDevice = () => deviceKindOf(navigator.userAgent, navigator.maxTouchPoints);

export function RemoteAccess() {
  const pk = usePackage();
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [ownerOnly, setOwnerOnly] = useState(false);
  const [qr, setQr] = useState<{ url: string; image: string; expiresAt: string; name: string } | null>(null), [paired, setPaired] = useState('');
  const [network] = useNetwork();
  const cafe = onCafeComputer(), remote = remoteMode();
  // "Bu ekranı şu an telefonunuzdan mı açtınız?": suggested from this browser; the café computer is never the phone.
  const [where, setWhere] = useState<'phone' | 'computer' | null>(cafe ? 'computer' : null);
  const count = useRef<number | null>(null);
  const load = useCallback(() => api<View>('/api/staff/remote-reports').then(v => {
    // A new device while the QR is on screen: it worked.
    if (count.current !== null && v.phones.length > count.current) { setPaired(v.phones[v.phones.length - 1].name); setQr(null); }
    count.current = v.phones.length; setView(v); setError('');
  }).catch(e => { if (e instanceof ApiError && e.status === 403) setOwnerOnly(true); else setError((e as Error).message); }), []);
  useEffect(() => { if (ownerOnly) return; void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, qr ? 2000 : 8000); return () => clearInterval(t); }, [load, qr, ownerOnly]);
  if (ownerOnly) return <Card icon={<Smartphone size={18} aria-hidden="true" />} title="Uzaktan erişim"><p className="settings-card-note">Uzaktan erişimi yalnız işletme sahibi kendi hesabıyla kurar.</p></Card>;
  if (!view) return error ? <Notice tone="error">{error}</Notice> : <p className="settings-card-note" aria-busy="true">Yükleniyor…</p>;
  const phones = view.phones.filter(p => kindOf(p) === 'phone'), full = view.phones.length >= view.max, here = thisDevice();
  const started = (r: { url: string; expiresAt: string; name: string } & View, show: boolean) => {
    count.current = r.phones.length; setView(r); setPaired('');
    // On the device itself: the pairing link opens right here (this browser keeps the device's keys).
    if (!show) { location.assign(r.url); return; }
    void QRCode.toDataURL(r.url, { width: 260, margin: 1, color: { dark: '#234c3e', light: '#ffffff' } }).then(image => setQr({ url: r.url, expiresAt: r.expiresAt, name: r.name, image }));
  };
  const cancel = async () => { setQr(null); try { setView(await api<View>('/api/staff/remote-reports/pair/cancel', {})); } catch { /* it expires anyway */ } };
  return <div className="remote-access">
    {paired && <Notice tone="success"><CheckCircle2 size={16} aria-hidden="true" /><span>Eşleşti: <strong>{paired}</strong>. Raporlarınız artık orada.</span></Notice>}

    <Card icon={<Smartphone size={18} aria-hidden="true" />} title="1 · Telefonunuz" className="remote-step phone-pairing">
      {phones.length ? <p className="remote-done" role="status"><CheckCircle2 size={16} aria-hidden="true" /> Telefonunuz bağlı: {phones.map(p => p.name).join(', ')}.</p>
        : remote ? <p className="settings-card-note">Önce telefonunuzu bağlayın. Eşleştirme yalnız kafede yapılır.</p>
        : <>
          <p className="settings-card-note"><strong>Önce telefonunuzu bağlayın.</strong> Telefonunuzdan her yerden raporlarınıza bakarsınız; laptop ve tablet ondan sonra eklenir.</p>
          {!cafe && <div className="remote-where" role="group" aria-label="Bu ekranı şu an telefonunuzdan mı açtınız?">
            <p>Bu ekranı şu an telefonunuzdan mı açtınız?{where === null && <span className="settings-field-hint"> {here === 'phone' ? 'Bu cihaz telefona benziyor.' : 'Bu cihaz bilgisayara benziyor.'}</span>}</p>
            <div className="settings-actions">
              <button type="button" className={`btn ${where === 'phone' || (where === null && here === 'phone') ? 'primary' : 'secondary'}`} aria-pressed={where === 'phone'} onClick={() => setWhere('phone')}>Evet, telefonumdayım</button>
              <button type="button" className={`btn ${where === 'computer' || (where === null && here !== 'phone') ? 'primary' : 'secondary'}`} aria-pressed={where === 'computer'} onClick={() => setWhere('computer')}>Hayır, bilgisayardayım</button>
            </div>
          </div>}
          {where && <ol className="remote-substeps">
            <li><h4>Telefon kodu</h4>{view.code ? <p className="remote-done"><CheckCircle2 size={16} aria-hidden="true" /> Telefon kodu kurulu.</p> : <PhoneCode onPhone={where === 'phone'} onDone={() => void load()} />}</li>
            <li><h4>{where === 'phone' ? 'Bu telefonu eşleştir' : 'Telefonu eşleştir'}</h4>
              {!view.code ? <p className="settings-field-hint">Önce telefon kodunu kurun.</p>
                : full ? <p className="settings-field-hint">En fazla {view.max} cihaz eşleşebilir; yenisi için aşağıdan birini kaldırın.</p>
                : qr ? <PairingQr qr={qr} onCancel={() => void cancel()} />
                : <PairAsk name="Telefonum" submit={where === 'phone' ? 'Bu telefonu eşleştir' : 'QR kodu göster'} onStarted={r => started(r, where !== 'phone')}
                  hint={where === 'phone' ? 'Eşleştirme bu tarayıcıda açılır; orada Eşleştir’e basın.' : 'QR kodu çıkınca telefonunuzun kamerasıyla okutun.'} />}
            </li>
          </ol>}
        </>}
    </Card>

    <Card icon={<Laptop size={18} aria-hidden="true" />} title="2 · Laptop ve tablet" className="remote-step">
      {!phones.length ? <p className="settings-card-note">Telefonunuz bağlanınca buradan eklenir.</p>
        : remote ? <p className="settings-card-note">Eşleştirme yalnız kafede yapılır.</p>
        : full ? <p className="settings-field-hint">En fazla {view.max} cihaz eşleşebilir; yenisi için aşağıdan birini kaldırın.</p>
        : cafe ? <p className="settings-card-note">Laptop ya da tableti kafenin Wi-Fi’sine bağlayın, aşağıdaki kalıcı bağlantıyı orada açıp giriş yapın; burada <strong>Bu cihazı eşleştir</strong>’e basın.</p>
        : here === 'phone' ? <p className="settings-card-note">Laptop ya da tabletinizde bu sayfayı açıp <strong>Bu cihazı eşleştir</strong>’e basın.</p>
        : <PairAsk name={here === 'tablet' ? 'Tabletim' : 'Laptopum'} submit="Bu cihazı eşleştir" onStarted={r => started(r, false)} hint="Eşleştirme bu tarayıcıda açılır; orada Eşleştir’e basın." />}
    </Card>

    <Card icon={<Link2 size={18} aria-hidden="true" />} title="3 · Kısayol" className="remote-step">
      <Shortcut link={network?.link} cafe={cafe} />
    </Card>

    {pk.has('remote-admin') ? <RemoteAdminSettings title="4 · Uzaktan yönetim" /> : <LockedRow feature="remote-admin" title="4 · Uzaktan yönetim" />}

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
    <p className="settings-field-hint">Telefonunuza ücretsiz bir doğrulama uygulaması (Google Authenticator gibi) kurun. Raporlar ve eşleştirme bu 6 haneli kodu da sorar.</p>
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

/** The device's name, the owner's password and phone code; the server checks both before any pairing link exists. */
function PairAsk({ name: initial, submit, hint, onStarted }: { name: string; submit: string; hint: string; onStarted: (r: { url: string; expiresAt: string; name: string } & View) => void }) {
  const id = useId();
  const [name, setName] = useState(initial), [password, setPassword] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function start(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const typed = password, typedCode = code; setPassword(''); setCode('');
    try { onStarted(await api<{ url: string; expiresAt: string; name: string } & View>('/api/staff/remote-reports/pair', { name: name.trim(), password: typed, code: typedCode })); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form className="pairing-ask" aria-label={submit} onSubmit={e => void start(e)}>
    <label htmlFor={`${id}-name`}>Cihazın adı</label>
    <input id={`${id}-name`} value={name} maxLength={40} required autoComplete="off" disabled={busy} onChange={e => setName(e.target.value)} />
    <label htmlFor={`${id}-password`}>Şifreniz</label>
    <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
    <label htmlFor={`${id}-code`}>Telefon kodu</label>
    <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    <p className="settings-field-hint"><LockKeyhole size={13} aria-hidden="true" /> {hint}</p>
    <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !name.trim() || !password || code.length !== 6}>{busy ? 'Doğrulanıyor…' : submit}</button></div>
    {error && <Notice tone="error">{error}</Notice>}
  </form>;
}

function PairingQr({ qr, onCancel }: { qr: { url: string; image: string; expiresAt: string; name: string }; onCancel: () => void }) {
  const [left, setLeft] = useState(0), [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => { const tick = () => { const ms = Date.parse(qr.expiresAt) - Date.now(); setLeft(Math.max(0, Math.ceil(ms / 60_000))); if (ms <= 0) onCancel(); }; tick(); const t = setInterval(tick, 5000); return () => clearInterval(t); }, [qr, onCancel]);
  return <div className="pairing-qr" role="group" aria-label="Cihaz eşleştirme QR kodu">
    <img src={qr.image} width={220} height={220} alt="Cihaz eşleştirme QR kodu" />
    <div className="pairing-qr-side">
      <h4>Telefonunuzun kamerasıyla okutun</h4>
      <p>Açılan Raporlarım sayfasında <strong>Eşleştir</strong>’e basın. Sonra telefonda bu sayfanın 3. adımıyla kısayol ekleyin.</p>
      <p className="muted small">Kod {left} dakika geçerli ve tek cihaz içindir; kimseyle paylaşmayın.</p>
      {copied === false && <input className="pairing-link" readOnly value={qr.url} aria-label="Eşleştirme bağlantısı" onFocus={e => e.currentTarget.select()} />}
      <div className="pairing-qr-actions"><button type="button" className="btn secondary small-btn" title={qr.url} onClick={() => setCopied(copyText(qr.url))}>{copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'}</button>
        <button type="button" className="btn secondary small-btn" onClick={onCancel}>Vazgeç</button></div>
    </div>
  </div>;
}

/** "Bu cihaza kısayol ekle": Mola Merkez's page for this device (one time); on the café computer the link to carry over. */
function Shortcut({ link, cafe }: { link?: LanLink; cafe: boolean }) {
  if (!link || !('url' in link)) return <p className="settings-card-note">{link && 'problem' in link && link.problem === 'waiting' ? 'Kısayol bağlantısı birkaç dakika içinde hazır olur.' : 'Kısayol bağlantısı, Mola etkinleştirilip tabletlere açıkken (Ayarlar → Cihazlar → Cihaz bağla) hazır olur.'}</p>;
  if (cafe) return <>
    <p className="settings-card-note">Laptop ve telefonda bu sayfayı açıp <strong>Bu cihaza kısayol ekle</strong>’ye bir kez basın. Simge kafedeyken kasayı, dışarıdayken Raporlarım’ı açar.</p>
    <PermanentLink link={link} />
  </>;
  return <>
    <p className="settings-card-note">Bir kez ekleyin, sonra simgeden açın: kafedeyken kasayı, dışarıdayken Raporlarım’ı açar.</p>
    <div className="settings-actions"><a className="btn primary" href={`${link.url}/kur`} target="_blank" rel="noopener noreferrer"><Link2 size={16} aria-hidden="true" />Bu cihaza kısayol ekle</a></div>
  </>;
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
        <span>Eşleşme {when(p.pairedAt)} · {p.ownerName}</span></div>
      {remote ? null : removing === p.id ? <form className="phone-confirm" aria-label={`${p.name} cihazını kaldır`} onSubmit={e => void remove(e, p.id)}>
        <input type="password" value={password} maxLength={200} required autoComplete="current-password" placeholder="Şifreniz" aria-label="Şifreniz" disabled={busy} autoFocus onChange={e => setPassword(e.target.value)} />
        <button type="submit" className="btn danger small-btn" disabled={busy || !password}>Evet, kaldır</button><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => { setRemoving(''); setPassword(''); }}>Vazgeç</button></form>
        : <button type="button" className="btn secondary small-btn" aria-label={`${p.name} cihazını kaldır`} disabled={busy} onClick={() => { setRemoving(p.id); setPassword(''); setError(''); }}><Trash2 size={15} aria-hidden="true" />Kaldır</button>}
    </li>)}</ul>
    <p className="settings-field-hint">En fazla {view.max} cihaz. <Globe2 size={13} aria-hidden="true" /> Raporlar yalnız bu cihazlar için şifrelenir; Mola Merkez okuyamaz.</p>
    {error && <Notice tone="error">{error}</Notice>}
  </>;
}

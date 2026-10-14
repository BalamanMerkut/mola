import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, ExternalLink, LockKeyhole, MonitorSmartphone, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { api, ApiError } from './api';
import { Notice } from './components';
import { copyText, onCafeComputer } from './PermanentLink';
import { Card } from './SettingsKit';

/*
 * "Raporlarım telefonda" (Ayarlar → Güvenlik ve yedek → Telefonum, once Destek → Uzaktan erişim; the owner's own account only; server/remote-reports.ts). "Telefonu
 * eşleştir" first asks the device's name ("Ahmet'in telefonu", "Ev laptopu"), the owner's password again and the 6-digit phone
 * code (0.1.20: no phone code set up, no new pairing; the card then points to "Raporlar için telefon kodu" at the top of this
 * page); only after the server checked both does the QR show, good for 10 minutes and one device. The Raporlarım page opens
 * in any browser, so a tablet or a laptop can be paired too. Reports are encrypted on this computer for each device: Mola
 * Merkez only carries them. At most 3 devices; "Kaldır" asks the password (not the code: the lost phone may hold the app).
 * Off the café computer (a laptop on the permanent link), "Bu cihazı eşleştir" opens the QR's link right here: no camera, no
 * long address to type. The link itself stays out of sight (the copy button carries it in its title).
 */
type Phone = { id: string; name: string; ownerName: string; pairedAt: string; lastSeenAt: string | null };
type View = { phones: Phone[]; max: number; pairing: { expiresAt: string } | null; relay: { connected: boolean; error: string | null }; code?: boolean };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
/** WebCrypto keys need a secure page: HTTPS, or this very computer (localhost). */
const reachable = (url: string) => { try { const u = new URL(url); return u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; } };
/** "Telefon koduna git": the Raporlar için telefon kodu sheet at the top of this same page (src/ReportSecurity.tsx), opened. */
function openPhoneCode() {
  const sheet = document.querySelector<HTMLDetailsElement>('details.report-security');
  if (!sheet) return;
  sheet.open = true; sheet.scrollIntoView({ behavior: 'smooth', block: 'start' }); sheet.querySelector('summary')?.focus({ preventScroll: true });
}

export function PhonePairing() {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ownerOnly, setOwnerOnly] = useState(false);
  const [qr, setQr] = useState<{ url: string; image: string; expiresAt: string; name: string } | null>(null), [paired, setPaired] = useState('');
  const [removing, setRemoving] = useState(''), [left, setLeft] = useState(0), [copied, setCopied] = useState<boolean | null>(null);
  // "Telefonu eşleştir" → the device's name, the owner's password and phone code; neither stays in the page after a try.
  const [asking, setAsking] = useState(false), [name, setName] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  // "Kaldır" → the password again ("Evet, kaldır").
  const [removePassword, setRemovePassword] = useState('');
  const count = useRef<number | null>(null);
  const load = useCallback(() => api<View>('/api/staff/remote-reports').then(v => {
    // A new device while the QR is on screen: it worked.
    if (count.current !== null && v.phones.length > count.current) { const fresh = v.phones[v.phones.length - 1]; setPaired(fresh.name); setQr(null); }
    count.current = v.phones.length; setView(v);
  }).catch(e => { if (e instanceof ApiError && e.status === 403) setOwnerOnly(true); else setError((e as Error).message); }), []);
  useEffect(() => { if (ownerOnly) return; void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, qr ? 2000 : 8000); return () => clearInterval(t); }, [load, qr, ownerOnly]);
  useEffect(() => { if (!qr) return; const tick = () => { const ms = Date.parse(qr.expiresAt) - Date.now(); setLeft(Math.max(0, Math.ceil(ms / 60_000))); if (ms <= 0) setQr(null); }; tick(); const t = setInterval(tick, 5000); return () => clearInterval(t); }, [qr]);
  function ask() { setAsking(true); setError(''); setPaired(''); setName(''); setPassword(''); setCode(''); }
  function stopAsking() { setAsking(false); setPassword(''); setCode(''); setError(''); }
  async function start(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setPaired('');
    const typed = password, typedCode = code; setPassword(''); setCode('');
    try {
      const r = await api<View & { url: string; expiresAt: string; name: string }>('/api/staff/remote-reports/pair', { name: name.trim(), password: typed, code: typedCode });
      setQr({ url: r.url, expiresAt: r.expiresAt, name: r.name, image: await QRCode.toDataURL(r.url, { width: 260, margin: 1, color: { dark: '#234c3e', light: '#ffffff' } }) });
      count.current = r.phones.length; setView(r); setAsking(false); setCopied(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() { setQr(null); try { setView(await api<View>('/api/staff/remote-reports/pair/cancel', {})); } catch { /* it expires anyway */ } }
  function startRemoving(phoneId: string) { setRemoving(phoneId); setRemovePassword(''); setError(''); }
  async function remove(e: FormEvent, phoneId: string) {
    e.preventDefault(); setBusy(true); setError('');
    const typed = removePassword; setRemovePassword('');
    try { const v = await api<View>('/api/staff/remote-reports/phones/remove', { id: phoneId, password: typed }); count.current = v.phones.length; setView(v); setRemoving(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const lead = 'Günün satışını ve kasa kapanışını telefon, tablet ya da dizüstü bilgisayarınızdan görün; raporlar yalnız sizin cihazlarınız için şifrelenir.';
  // Müdür and other staff: the server answers 403; no button, one plain line.
  if (ownerOnly) return <Card icon={<Smartphone size={18} aria-hidden="true" />} title="Raporlarım telefonda" className="phone-pairing" lead={lead}>
    <p className="settings-card-note">Cihaz eşleştirmeyi yalnız işletme sahibi kendi hesabıyla yapabilir.</p>
  </Card>;
  const full = !!view && view.phones.length >= view.max;
  return <Card icon={<Smartphone size={18} aria-hidden="true" />} title="Raporlarım telefonda" className="phone-pairing" lead={lead}>
    {paired && <Notice tone="success"><CheckCircle2 size={16} aria-hidden="true" /> Cihaz eşleşti: <strong>{paired}</strong>. Raporlarınızı artık oradan açabilirsiniz.</Notice>}
    {view && view.phones.length > 0 && <ul className="phone-list" aria-label="Eşleşmiş cihazlar">{view.phones.map(p => <li key={p.id}>
      <MonitorSmartphone size={18} aria-hidden="true" /><div><strong>{p.name}</strong>
        <span>{p.lastSeenAt ? `Son rapor: ${when(p.lastSeenAt)}` : 'Henüz rapor almadı'}</span>
        <span>Eşleşme {when(p.pairedAt)} · {p.ownerName}</span></div>
      {removing === p.id ? <form className="phone-confirm" aria-label={`${p.name} cihazını kaldır`} onSubmit={e => void remove(e, p.id)}>
        <input type="password" value={removePassword} maxLength={200} required autoComplete="current-password" placeholder="Şifreniz" aria-label="Şifreniz" disabled={busy} autoFocus onChange={e => setRemovePassword(e.target.value)} />
        <button type="submit" className="btn danger small-btn" disabled={busy || !removePassword}>Evet, kaldır</button><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => { setRemoving(''); setRemovePassword(''); }}>Vazgeç</button></form>
        : <button type="button" className="btn secondary small-btn" aria-label={`${p.name} cihazını kaldır`} disabled={busy} onClick={() => startRemoving(p.id)}><Trash2 size={15} aria-hidden="true" />Kaldır</button>}
    </li>)}</ul>}
    {view && !view.phones.length && !qr && !asking && <p className="settings-card-note">Henüz eşleşmiş cihaz yok.</p>}
    {qr ? <div className="pairing-qr" role="group" aria-label="Cihaz eşleştirme QR kodu">
      <img src={qr.image} width={220} height={220} alt="Cihaz eşleştirme QR kodu" />
      <div className="pairing-qr-side">
        <h4>Telefonla: kodu okutun</h4>
        <p>“{qr.name}” kamerasıyla okutun, açılan Raporlarım sayfasında <strong>Eşleştir</strong>’e basın; sonra sayfayı ana ekrana ya da yer imlerine ekleyin.</p>
        {!onCafeComputer() && <div className="pairing-qr-here"><p>Bu cihazı eşleştirmek için:</p>
          <a className="btn primary" href={qr.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" />Bu cihazı eşleştir</a></div>}
        <p className="muted small">Kod {left} dakika geçerli ve tek cihaz içindir; kimseyle paylaşmayın.{!reachable(qr.url) && ' Bu Mola Merkez adresi başka cihazdan açılmaz (HTTPS gerekli); Mola ekibine danışın.'}</p>
        {/* Copy failed (a browser that refuses both ways): the link shows so it can be selected by hand. */}
        {copied === false && <input className="pairing-link" readOnly value={qr.url} aria-label="Eşleştirme bağlantısı" onFocus={e => e.currentTarget.select()} />}
        <div className="pairing-qr-actions"><button type="button" className="btn secondary small-btn" title={qr.url} onClick={() => setCopied(copyText(qr.url))}>{copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'}</button>
          <button type="button" className="btn secondary small-btn" onClick={() => void cancel()}>Vazgeç</button></div>
      </div>
    </div> : asking ? <form className="pairing-ask" aria-label="Cihaz eşleştir" onSubmit={e => void start(e)}>
      <label htmlFor={`${id}-name`}>Cihazın adı</label>
      <input id={`${id}-name`} value={name} maxLength={40} required autoComplete="off" placeholder="Örn. Ahmet’in telefonu, Ev laptopu" disabled={busy} onChange={e => setName(e.target.value)} />
      <label htmlFor={`${id}-password`}>Şifreniz</label>
      <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} aria-describedby={`${id}-why`} onChange={e => setPassword(e.target.value)} />
      <label htmlFor={`${id}-code`}>Telefon kodu</label>
      <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6 haneli kod" disabled={busy} aria-describedby={`${id}-why`} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      <p id={`${id}-why`} className="settings-field-hint"><LockKeyhole size={13} aria-hidden="true" /> Güvenlik için giriş şifrenizi ve doğrulama uygulamanızdaki kodu yazın. QR kodu ikisi doğrulanınca görünür.</p>
      <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !name.trim() || !password || code.length !== 6}>{busy ? 'Doğrulanıyor…' : 'QR kodu göster'}</button><button type="button" className="btn secondary" disabled={busy} onClick={stopAsking}>Vazgeç</button></div>
    </form> : view && view.code === false ? <div className="settings-actions phone-pairing-needs-code"><span className="settings-field-hint">Cihaz eşleştirmek için önce telefon kodunu kurun.</span>
      <button type="button" className="btn secondary" onClick={openPhoneCode}><ShieldCheck size={16} aria-hidden="true" />Telefon koduna git</button></div>
      : <div className="settings-actions"><button type="button" className="btn primary" disabled={busy || !view || full} onClick={ask}><Smartphone size={16} aria-hidden="true" />Telefonu eşleştir</button>
      {full ? <span className="settings-field-hint">En fazla {view!.max} cihaz eşleşebilir; yenisi için birini kaldırın.</span> : <span className="settings-field-hint">Telefon, tablet ya da dizüstü bilgisayar.</span>}</div>}
    {view && view.phones.length > 0 && !view.relay.connected && <p className="settings-field-hint">{view.relay.error ? `Mola Merkez’e ulaşılamıyor: ${view.relay.error} Cihaz son durumu gösterir.` : 'Mola Merkez’e bağlanılıyor…'}</p>}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

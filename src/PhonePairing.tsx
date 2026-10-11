import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { CheckCircle2, LockKeyhole, MonitorSmartphone, Smartphone, Trash2 } from 'lucide-react';
import { api, ApiError } from './api';
import { Notice } from './components';
import { Card } from './SettingsKit';

/*
 * "Raporlarım telefonda" (Ayarlar → Güvenlik ve yedek → Telefonum, once Destek → Uzaktan erişim; the owner's own account only; server/remote-reports.ts). "Telefonu
 * eşleştir" first asks the device's name ("Ahmet'in telefonu", "Ev laptopu") and the owner's password again; only after the
 * server checked the password does the QR show, good for 10 minutes and one device. The Raporlarım page opens in any browser,
 * so a tablet or a laptop can be paired too (it then opens the QR's link). Reports are encrypted on this computer for each
 * device: Mola Merkez only carries them. At most 3 devices; "Kaldır" stops one at once (one tap + "Evet, kaldır").
 */
type Phone = { id: string; name: string; ownerName: string; pairedAt: string; lastSeenAt: string | null };
type View = { phones: Phone[]; max: number; pairing: { expiresAt: string } | null; relay: { connected: boolean; error: string | null } };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
/** WebCrypto keys need a secure page: HTTPS, or this very computer (localhost). */
const reachable = (url: string) => { try { const u = new URL(url); return u.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; } };

export function PhonePairing() {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ownerOnly, setOwnerOnly] = useState(false);
  const [qr, setQr] = useState<{ url: string; image: string; expiresAt: string; code: boolean; name: string } | null>(null), [paired, setPaired] = useState('');
  const [removing, setRemoving] = useState(''), [left, setLeft] = useState(0), [copied, setCopied] = useState(false);
  // "Telefonu eşleştir" → the device's name and the owner's password; the password never stays in the page after a try.
  const [asking, setAsking] = useState(false), [name, setName] = useState(''), [password, setPassword] = useState('');
  const count = useRef<number | null>(null);
  const load = useCallback(() => api<View>('/api/staff/remote-reports').then(v => {
    // A new device while the QR is on screen: it worked.
    if (count.current !== null && v.phones.length > count.current) { const fresh = v.phones[v.phones.length - 1]; setPaired(fresh.name); setQr(null); }
    count.current = v.phones.length; setView(v);
  }).catch(e => { if (e instanceof ApiError && e.status === 403) setOwnerOnly(true); else setError((e as Error).message); }), []);
  useEffect(() => { if (ownerOnly) return; void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, qr ? 2000 : 8000); return () => clearInterval(t); }, [load, qr, ownerOnly]);
  useEffect(() => { if (!qr) return; const tick = () => { const ms = Date.parse(qr.expiresAt) - Date.now(); setLeft(Math.max(0, Math.ceil(ms / 60_000))); if (ms <= 0) setQr(null); }; tick(); const t = setInterval(tick, 5000); return () => clearInterval(t); }, [qr]);
  function ask() { setAsking(true); setError(''); setPaired(''); setName(''); setPassword(''); }
  function stopAsking() { setAsking(false); setPassword(''); setError(''); }
  async function start(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setPaired('');
    const typed = password; setPassword('');
    try {
      const r = await api<View & { url: string; expiresAt: string; code: boolean; name: string }>('/api/staff/remote-reports/pair', { name: name.trim(), password: typed });
      setQr({ url: r.url, expiresAt: r.expiresAt, code: r.code, name: r.name, image: await QRCode.toDataURL(r.url, { width: 260, margin: 1, color: { dark: '#234c3e', light: '#ffffff' } }) });
      count.current = r.phones.length; setView(r); setAsking(false); setCopied(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() { setQr(null); try { setView(await api<View>('/api/staff/remote-reports/pair/cancel', {})); } catch { /* it expires anyway */ } }
  async function remove(phoneId: string) {
    setBusy(true); setError('');
    try { const v = await api<View>('/api/staff/remote-reports/phones/remove', { id: phoneId }); count.current = v.phones.length; setView(v); setRemoving(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const lead = 'Günün satışını, kasa kapanışını ve son 30 günü telefonunuzdan görün. Tablet ya da dizüstü bilgisayar da eşleştirebilirsiniz: Raporlarım sayfası her tarayıcıda açılır. Raporlar bu bilgisayarda yalnız sizin cihazlarınız için şifrelenir; Mola Merkez yalnız iletir, okuyamaz.';
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
      {removing === p.id ? <span className="phone-confirm"><button type="button" className="btn danger small-btn" disabled={busy} onClick={() => void remove(p.id)}>Evet, kaldır</button><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setRemoving('')}>Vazgeç</button></span>
        : <button type="button" className="btn secondary small-btn" aria-label={`${p.name} cihazını kaldır`} disabled={busy} onClick={() => setRemoving(p.id)}><Trash2 size={15} aria-hidden="true" />Kaldır</button>}
    </li>)}</ul>}
    {view && !view.phones.length && !qr && !asking && <p className="settings-card-note">Henüz eşleşmiş cihaz yok.</p>}
    {qr ? <div className="pairing-qr" role="group" aria-label="Cihaz eşleştirme QR kodu">
      <img src={qr.image} width={220} height={220} alt="Cihaz eşleştirme QR kodu" />
      <ol>
        <li>“{qr.name}” cihazının kamerasıyla bu kodu okutun. Tablet ya da bilgisayarda kamera yoksa aşağıdaki bağlantıyı o cihazın tarayıcısında açın.</li>
        <li>Açılan “Raporlarım” sayfasında <strong>Eşleştir</strong>’e basın.</li>
        {qr.code && <li><LockKeyhole size={14} aria-hidden="true" /> Raporlar için telefon kodunuz açık: doğrulama uygulamanızdaki 6 haneli kodu da yazın.</li>}
        <li>Sayfayı ana ekrana ya da yer imlerine ekleyin (iPhone: Paylaş → Ana Ekrana Ekle).</li>
      </ol>
      <div className="pairing-link"><input readOnly value={qr.url} aria-label="Eşleştirme bağlantısı" onFocus={e => e.currentTarget.select()} />
        <button type="button" className="btn secondary small-btn" onClick={() => void navigator.clipboard?.writeText(qr.url).then(() => setCopied(true), () => setCopied(false))}>{copied ? 'Kopyalandı' : 'Bağlantıyı kopyala'}</button></div>
      <p className="muted small">Kod {left} dakika geçerli ve tek cihaz içindir; kimseyle paylaşmayın.{!reachable(qr.url) && ' Bu Mola Merkez adresi başka cihazdan açılmaz (HTTPS gerekli); Mola ekibine danışın.'}</p>
      <button type="button" className="btn secondary" onClick={() => void cancel()}>Vazgeç</button>
    </div> : asking ? <form className="pairing-ask" aria-label="Cihaz eşleştir" onSubmit={e => void start(e)}>
      <label htmlFor={`${id}-name`}>Cihazın adı</label>
      <input id={`${id}-name`} value={name} maxLength={40} required autoComplete="off" placeholder="Örn. Ahmet’in telefonu, Ev laptopu" disabled={busy} onChange={e => setName(e.target.value)} />
      <label htmlFor={`${id}-password`}>Şifreniz</label>
      <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} aria-describedby={`${id}-why`} onChange={e => setPassword(e.target.value)} />
      <p id={`${id}-why`} className="settings-field-hint"><LockKeyhole size={13} aria-hidden="true" /> Güvenlik için giriş şifrenizi yeniden yazın. QR kodu şifre doğrulanınca görünür.</p>
      <div className="settings-actions"><button type="submit" className="btn primary" disabled={busy || !name.trim() || !password}>{busy ? 'Doğrulanıyor…' : 'QR kodu göster'}</button><button type="button" className="btn secondary" disabled={busy} onClick={stopAsking}>Vazgeç</button></div>
    </form> : <div className="settings-actions"><button type="button" className="btn primary" disabled={busy || !view || full} onClick={ask}><Smartphone size={16} aria-hidden="true" />Telefonu eşleştir</button>
      {full ? <span className="settings-field-hint">En fazla {view!.max} cihaz eşleşebilir; yenisi için birini kaldırın.</span> : <span className="settings-field-hint">Telefon, tablet ya da dizüstü bilgisayar.</span>}</div>}
    {view && view.phones.length > 0 && !view.relay.connected && <p className="settings-field-hint">{view.relay.error ? `Mola Merkez’e ulaşılamıyor: ${view.relay.error} Cihaz son durumu gösterir.` : 'Mola Merkez’e bağlanılıyor…'}</p>}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

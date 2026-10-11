import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { PlaceLink } from './Moved';
/** `owner: false`: a Müdür, who types the owner's code and never sets it up or resets it (server/report-security.ts). */
// The code guards Satış ve Raporlar and the record books of Kasa ve giderler (Giderler, Kapanışlar, İadeler) and Personel
// (Vardiya ve bahşiş): FinancialAccess below sits in front of each, the same screen everywhere.
type Status = { enabled: boolean; verified: boolean; until: number | null; owner?: boolean };
function Controls({ enabled, onDone, manager = false }: { enabled: boolean; onDone: () => void; manager?: boolean }) {
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [recovery, setRecovery] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null), [qr, setQr] = useState(''), [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let active = true; if (setup) void QRCode.toDataURL(setup.uri, { width: 220 }).then(v => { if (active) setQr(v); }); return () => { active = false; }; }, [setup]);
  async function action(path: string, body: unknown) { setBusy(true); setError(''); try { return await api<any>(path, body); } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); } }
  if (codes.length) return <div className="modal-body"><Notice tone="success">Telefon kodu açıldı. Kurtarma kodlarını kâğıda yazıp güvenli bir yerde saklayın; bir daha gösterilmez.</Notice><textarea aria-label="Kurtarma kodları" readOnly rows={8} value={codes.join('\n')} /><button className="btn primary" onClick={onDone}>Kodları sakladım</button></div>;
  return <div className="modal-body"><p className="muted">{manager ? 'Raporlar işletme sahibinin telefon koduyla korunuyor. Sahibin doğrulama uygulamasındaki 6 haneli kodu yazın. Kodu bir kez yazınca 10 dakika geçerlidir.' : 'Raporlar, telefonunuzdaki doğrulama uygulamasının ürettiği 6 haneli kodla açılır. SMS gelmez, ücret yoktur. Kodu bir kez yazınca 10 dakika geçerlidir.'}</p>
    {!enabled && !setup && <><label>İşletme şifreniz<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button className="btn primary" disabled={busy || !password} onClick={() => void action('/api/staff/report-security/setup', { password }).then(v => { if (v) { setSetup(v); setPassword(''); } })}>Telefon kodunu kur</button></>}
    {setup && <><p>Telefonunuzdaki doğrulama uygulamasıyla (Google Authenticator gibi) bu QR kodunu okutun, sonra uygulamadaki 6 haneli kodu yazın.</p>{qr && <img src={qr} alt="Doğrulama uygulaması kurulum QR kodu" width={220} height={220} />}<details><summary>QR okutamıyorum</summary><code style={{ overflowWrap: 'anywhere' }}>{setup.secret}</code></details></>}
    {(enabled || setup) && <form onSubmit={e => { e.preventDefault(); void action(setup ? '/api/staff/report-security/enable' : '/api/staff/report-security/verify', { code }).then(v => { if (v?.recoveryCodes) setCodes(v.recoveryCodes); else if (v) onDone(); }); }}><label>Doğrulama kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label><button className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Kontrol ediliyor…' : setup ? 'Korumayı etkinleştir' : 'Raporları aç'}</button></form>}
    {enabled && !manager && <details><summary>Telefonuma ulaşamıyorum</summary><p>Kurtarma kodu ve işletme şifresiyle korumayı sıfırlayıp yeniden kurabilirsiniz.</p><label>İşletme şifreniz<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Kurtarma kodu<input autoComplete="off" value={recovery} onChange={e => setRecovery(e.target.value.trim())} /></label><button className="btn secondary" disabled={busy || !password || recovery.length !== 32} onClick={() => void action('/api/staff/report-security/recover', { password, recoveryCode: recovery }).then(v => { if (v) onDone(); })}>Korumayı sıfırla</button></details>}
    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}
/** Ayarlar → Güvenlik ve yedek → Telefonum, the first step (`open`: shown unfolded there). */
export function ReportSecurity({ open = false }: { open?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState('');
  const load = () => api<Status>('/api/staff/report-security').then(setStatus).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  return <details className="settings-sheet report-security" open={open || undefined}><summary><ShieldCheck size={18} /><strong>Raporlar için telefon kodu</strong><span className="settings-tool-description">Satış raporları ve işletme girişi, şifreden sonra telefondaki 6 haneli kodu da ister.</span></summary>{status && <><Notice>{status.enabled ? 'Telefon kodu açık.' : 'Telefon kodu henüz kurulmadı. Telefonunuza ücretsiz bir doğrulama uygulaması (Google Authenticator ya da Microsoft Authenticator gibi) kurmanız yeterli.'}</Notice><Controls key={String(status.enabled)} enabled={status.enabled} onDone={() => void load()} /></>}{error && <Notice tone="error">{error}</Notice>}</details>;
}
export function FinancialAccess({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState('');
  async function load() { try { setStatus(await api<Status>('/api/staff/report-security')); setError(''); } catch (e) { setStatus(null); setError((e as Error).message); } }
  useEffect(() => { void load(); const id = setInterval(() => void load(), 5000); return () => clearInterval(id); }, []);
  if (error) return <Notice tone="error">{error}<button className="text-btn" onClick={() => void load()}>Yeniden kontrol et</button></Notice>;
  if (!status) return <p>Rapor erişimi kontrol ediliyor…</p>;
  if (!status.verified) return <section className="panel"><h2>Raporları açmak için telefon kodu</h2><Controls enabled manager={status.owner === false} onDone={() => void load()} />{status.owner !== false && <div className="home-links"><PlaceLink to={{ view: 'settings', topic: 'security', part: 'phone' }}>Telefon kodunu yönet (Ayarlar → Güvenlik ve yedek → Telefonum)</PlaceLink></div>}</section>;
  return <>{children}</>;
}

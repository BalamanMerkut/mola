import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, download, signInError } from './platformStatus';
import { ArrowLeft, Copy, Download, LifeBuoy, Printer, QrCode, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';
import { Chip, IconBtn, SCard } from './platformSettingsKit';
import './platform-mfa-pending.css';

const codesText = (codes: string[]) => ['Mola Yönetim · iki adımlı giriş kurtarma kodları', 'Her kod bir kez kullanılır. Telefonunuz yokken şifrenizle birlikte girin.', '', ...codes, ''].join('\n');
/** Saved as a text file the vendor keeps away from the computer (the codes are shown only now). */
const saveCodes = (codes: string[]) => download('mola-yonetim-kurtarma-kodlari.txt', codesText(codes), 'text/plain;charset=utf-8');
function printCodes(codes: string[]) {
  const frame = document.createElement('iframe'); frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(frame); const doc = frame.contentDocument!;
  doc.open(); doc.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Kurtarma kodları</title><style>body{font-family:Arial,sans-serif;margin:40px}pre{font:600 18px/1.8 Consolas,monospace}</style></head><body><pre></pre></body></html>'); doc.close();
  doc.querySelector('pre')!.textContent = codesText(codes); frame.contentWindow!.print(); setTimeout(() => frame.remove(), 60000);
}
const MFA_TIP = 'Girişte şifreden sonra telefondaki Authenticator uygulamasının (Google Authenticator, Microsoft Authenticator…) ürettiği 6 haneli kod da istenir. Fiyat, paket ve güncelleme yayını gibi önemli işlemler de bu kodla onaylanır.';
const CODES_TIP = 'Telefonunuza erişemediğinizde şifrenizle birlikte bir kurtarma kodu girebilirsiniz. Her kod tek kullanımlıktır; kurulumda bir kez gösterilir. Kodlar biterse iki adımlı girişi kapatıp yeniden kurun: yeni kodlar üretilir.';

/**
 * Hesap güvenliği: "İki adımlı giriş" and "Kurtarma kodları" cards; the setup opens as one wide card with three steps.
 * `pending`: a change waits for two-step login ("İki adımlı doğrulamayı aç" in the step-up box, src/platformStepUp.tsx): the
 * card comes first with the password field focused and says what happens next; `onBack` returns to the change, `onEnabled`
 * tells Mola Yönetim to bring the vendor back there after the new login.
 */
export function PlatformMfa({ onChanged, pending, onBack, onEnabled }: { onChanged: (message: string) => void; pending?: string; onBack?: () => void; onEnabled?: () => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; recoveryRemaining: number } | null>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; recoveryCodes: string[] } | null>(null);
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [qr, setQr] = useState('');
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  // Whether "Şifremi unuttum → E-postama kod gönder" is on: then two-step login is what keeps an e-mail alone from resetting.
  const [emailReset, setEmailReset] = useState(false);
  useEffect(() => { void api<typeof status>(`${ADMIN}/mfa`).then(setStatus).catch(e => setError(e.message)); void api<{ email?: boolean }>(`${ADMIN}/reset`).then(r => setEmailReset(!!r.email), () => {}); }, []);
  useEffect(() => { let current = true; if (setup) void QRCode.toDataURL(setup.uri, { width: 220 }).then(image => { if (current) setQr(image); }).catch(() => { if (current) setError('QR oluşturulamadı; kurulum anahtarını elle girebilirsiniz.'); }); return () => { current = false; }; }, [setup]);
  async function action(path: string, body: object) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (path.endsWith('/setup')) { setSetup(await api(path, body)); setPassword(''); setCode(''); setSaved(false); }
      else { await api(path, body); setSetup(null); setPassword(''); setCode(''); if (path.endsWith('/enable')) onEnabled?.(); onChanged(path.endsWith('/enable') ? 'İki adımlı giriş açıldı. Authenticator uygulamasında yeni kod oluşunca yeniden giriş yapın.' : 'İki adımlı giriş kapatıldı. Yeniden giriş yapın.'); }
    } catch (e) { setError(signInError(e)); }
    finally { setBusy(false); }
  }
  const on = !!status?.enabled, loaded = !!status;
  // Sent here for a waiting change: the password field is where to start.
  useEffect(() => { if (pending && loaded && !on && !setup) { passwordField.current?.focus({ preventScroll: true }); passwordField.current?.closest('article')?.scrollIntoView?.({ block: 'center' }); } }, [pending, loaded, on, setup]);
  const waiting = pending && <div className="mfa-pending" role="status" data-testid="mfa-pending">
    <ShieldCheck size={18} aria-hidden="true" />
    <p><strong>“{pending}” iki adımlı doğrulama bekliyor.</strong> {on ? 'İki adımlı giriş açık; kaldığınız yere dönüp yeniden deneyin.' : setup ? 'Üç adımı tamamlayın. Açılınca yeniden giriş yaparsınız; Mola Yönetim sizi kaldığınız yere geri getirir.' : 'Yönetici şifrenizi yazıp “Authenticator kurulumunu başlat”a basın: QR’ı telefonunuzdaki Authenticator uygulamasına ekleyin, kurtarma kodlarını saklayın, kodu girin. Açılınca yeniden giriş yaparsınız; Mola Yönetim sizi kaldığınız yere geri getirir.'}</p>
    {onBack && <button type="button" className="btn secondary small-btn" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Kaldığım yere dön</button>}
  </div>;
  if (setup) return <SCard icon={QrCode} title="Authenticator kurulumu" sub="Üç adımda tamamlanır" tip={MFA_TIP} tone="blue" wide className={`ps-mfa-setup${pending ? ' ps-mfa-focus' : ''}`}>
    {waiting}
    <ol className="ps-steps">
      <li><span className="ps-step-no" aria-hidden="true">1</span><div><strong>QR’ı Authenticator uygulamasına ekleyin.</strong>
        {qr && <img src={qr} width={180} height={180} alt="Mola Yönetim Authenticator kurulum QR kodu" />}
        <details className="ps-more"><summary>QR okutamıyorum</summary><code style={{ overflowWrap: 'anywhere' }}>{setup.secret}</code></details></div></li>
      <li><span className="ps-step-no" aria-hidden="true">2</span><div><strong>Kurtarma kodlarını güvenli bir yerde saklayın.</strong>
        <p className="muted small">Telefonunuza erişemediğinizde şifrenizle birlikte kullanabilirsiniz. Her kod tek kullanımlıktır.</p>
        <textarea aria-label="Yönetim kurtarma kodları" readOnly rows={8} value={setup.recoveryCodes.join('\n')} />
        <div className="ps-actions">
          <IconBtn icon={Copy} label={copied ? 'Kopyalandı' : 'Kodları kopyala'} onClick={() => { void navigator.clipboard?.writeText(setup.recoveryCodes.join('\n')).then(() => setCopied(true)).catch(() => setError('Kopyalanamadı; kodları elle seçip kopyalayın.')); }} />
          <IconBtn icon={Printer} label="Yazdır" onClick={() => printCodes(setup.recoveryCodes)} />
          <IconBtn icon={Download} label="Dosya olarak indir" onClick={() => saveCodes(setup.recoveryCodes)} />
        </div>
        <label className="checkbox-line"><input type="checkbox" checked={saved} disabled={busy} onChange={e => setSaved(e.target.checked)} />Kurtarma kodlarını güvenli bir yerde sakladım</label></div></li>
      <li><span className="ps-step-no" aria-hidden="true">3</span><div>
        <form className="ps-form" onSubmit={e => { e.preventDefault(); void action(`${ADMIN}/mfa/enable`, { code, saved }); }}><label>3. Altı haneli doğrulama kodu<input inputMode="numeric" autoComplete="one-time-code" required maxLength={6} disabled={busy} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          <button className="btn primary" disabled={busy || !saved || code.length !== 6}>İki adımlı girişi etkinleştir</button></form>
        <button type="button" className="text-btn" disabled={busy} onClick={() => { setSetup(null); setQr(''); setCode(''); }}>Vazgeç</button></div></li>
    </ol>
    {error && <Notice tone="error">{error}</Notice>}
  </SCard>;
  return <>
    <SCard icon={Smartphone} title="İki adımlı giriş" sub="Authenticator kodu" tip={MFA_TIP} tone="blue" aside={status && <Chip tone={on ? 'ok' : 'warn'}>{on ? 'Açık' : 'Kapalı'}</Chip>} className={`ps-mfa${pending ? ' ps-mfa-focus' : ''}`}>
      {waiting}
      {status && on && <p className="ps-line">{`Koruma açık. ${status.recoveryRemaining} kurtarma kodu kaldı.`}</p>}
      {status && !on && <div className="mfa-advice" data-testid="mfa-advice"><ShieldAlert size={16} aria-hidden="true" /><p><strong>Öneri: iki adımlı girişi açın.</strong> {emailReset
        ? 'Açık değilken e-postanıza erişen biri “Şifremi unuttum → E-postama kod gönder” ile yalnız e-postayla şifrenizi değiştirebilir. Açıkken e-postadaki koda ek olarak telefonunuzdaki kod (ya da Merkez kurtarma kodu) da istenir.'
        : 'Şifreniz başkasının eline geçse bile telefonunuzdaki kod olmadan Mola Yönetim’e girilemez.'}</p></div>}
      {status && <form className="ps-form" onSubmit={e => { e.preventDefault(); void action(`${ADMIN}/mfa/${on ? 'disable' : 'setup'}`, { password, ...(on ? { code } : {}) }); }}>
        <label>Güvenlik ayarı için yönetici şifresi<input ref={passwordField} type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
        {on && <label>Authenticator veya kullanılmamış kurtarma kodu<input autoComplete="one-time-code" required maxLength={32} disabled={busy} value={code} onChange={e => setCode(e.target.value.trim())} /></label>}
        <button className={`btn ${on ? 'secondary' : 'primary'} ps-wide-btn`} disabled={busy || !password || (on && !code)}>{on ? 'İki adımlı girişi kapat' : 'Authenticator kurulumunu başlat'}</button>
      </form>}
      {!status && !error && <p className="muted small">Yükleniyor…</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </SCard>
    <SCard icon={LifeBuoy} title="Kurtarma kodları" sub="Telefon yokken giriş" tip={CODES_TIP} tone="amber" className="ps-codes">
      {on ? <div className="ps-big"><strong>{status!.recoveryRemaining}</strong><span>kod kaldı</span></div>
        : <p className="muted small">İki adımlı giriş kurulurken 8 tek kullanımlık kod verilir; kopyalayın, yazdırın ya da dosya olarak saklayın.</p>}
      {on && status!.recoveryRemaining <= 2 && <p className="field-hint">Kodlarınız azaldı: iki adımlı girişi kapatıp yeniden kurunca yeni kodlar üretilir.</p>}
    </SCard>
  </>;
}

import { useEffect, useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { api, ApiError } from './api';
import { Notice } from './components';
import { weakAdminPassword } from '../packages/domain/admin-password';
import { ADMIN, signInError } from './platformStatus';

type Proof = 'merkez' | 'mfa';
type Method = 'code' | 'email';
const proofs: { id: Proof; label: string; hint: string; placeholder: string }[] = [
  { id: 'merkez', label: 'Merkez kurtarma kodu', hint: 'Ayarlar → Yedek’te gösterilen 24 harflik kurtarma kodu. Yazdırdığınız ya da kopyaladığınız yerde durur.', placeholder: 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ' },
  { id: 'mfa', label: 'İki adımlı doğrulama yedek kodu', hint: 'İki adımlı doğrulamanın yedek kodları: iki adımlı girişi açarken kaydettiğiniz 32 karakterlik kodlardan biri. Her kod bir kez kullanılır.', placeholder: '32 karakterlik yedek kod' },
];

/**
 * "Şifremi unuttum" on the Mola Yönetim door. Two ways:
 *   code   only on the Merkez computer itself: the Merkez recovery code or an MFA backup code (with MFA on and the Merkez
 *          code, the Authenticator code too, or "Doğrulayıcıyı da sıfırla").
 *   email  "E-postama kod gönder" (also on a VDS over HTTPS), only when SMTP is set up: account name + admin e-mail, a
 *          6-digit code by e-mail; with MFA on the Authenticator code too (or the Merkez recovery code instead). With MFA
 *          off a warning recommends it.
 * Then the new password (live hints, the same rule as Mola Merkez).
 */
export function PlatformReset({ onDone, onBack }: { onDone: (message: string) => void; onBack: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null), [recoveryOn, setRecoveryOn] = useState(true), [emailOn, setEmailOn] = useState(false);
  const [method, setMethod] = useState<Method>('code');
  const [proof, setProof] = useState<Proof>('merkez'), [code, setCode] = useState('');
  const [username, setUsername] = useState(''), [address, setAddress] = useState(''), [sent, setSent] = useState(false), [emailCode, setEmailCode] = useState('');
  const [ticket, setTicket] = useState(''), [ticketBy, setTicketBy] = useState<Method>('code'), [needsAuthenticator, setNeedsAuthenticator] = useState(false);
  const [password, setPassword] = useState(''), [repeat, setRepeat] = useState(''), [totp, setTotp] = useState(''), [merkezCode, setMerkezCode] = useState('');
  const [lost, setLost] = useState(false), [resetMfa, setResetMfa] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [info, setInfo] = useState('');
  useEffect(() => {
    void api<{ available: boolean; recoveryCode: boolean; email?: boolean }>(`${ADMIN}/reset`)
      .then(r => { setAvailable(r.available); setRecoveryOn(r.recoveryCode); setEmailOn(!!r.email); if (!r.recoveryCode) setProof('mfa'); if (!r.available && r.email) setMethod('email'); })
      .catch(e => setError(signInError(e)));
  }, []);
  const weak = password ? weakAdminPassword(password) : undefined;
  const second = !needsAuthenticator || (ticketBy === 'code' ? resetMfa || /^\d{6}$/.test(totp) : lost ? merkezCode.trim().length >= 24 : /^\d{6}$/.test(totp));
  const valid = !weak && password === repeat && second;
  function restart(message: string) { setTicket(''); setPassword(''); setRepeat(''); setTotp(''); setMerkezCode(''); setLost(false); setResetMfa(false); setSent(false); setEmailCode(''); setInfo(''); setError(message); }
  function choose(next: Method) { if (busy) return; setMethod(next); setError(''); setInfo(''); setCode(''); setSent(false); setEmailCode(''); }
  async function verify() {
    if (busy || !code.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ ticket: string; needsAuthenticator: boolean }>(`${ADMIN}/reset/verify`, { proof, code: code.trim() });
      setTicket(r.ticket); setTicketBy('code'); setNeedsAuthenticator(r.needsAuthenticator); setCode('');
    } catch (e) { setError(signInError(e)); } finally { setBusy(false); }
  }
  async function send() {
    if (busy || !username.trim() || !address.trim()) return;
    setBusy(true); setError(''); setInfo('');
    try {
      await api(`${ADMIN}/reset/email/send`, { username: username.trim(), email: address.trim() });
      setSent(true); setEmailCode('');
      setInfo('Bu kullanıcı adı ve e-posta kayıtlıysa 6 haneli bir kod gönderildi. Kod 15 dakika geçerlidir; gelmediyse istenmeyen e-postalara bakın.');
    } catch (e) { setError(signInError(e)); } finally { setBusy(false); }
  }
  async function verifyEmail() {
    if (busy || !/^\d{6}$/.test(emailCode)) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ ticket: string; needsAuthenticator: boolean }>(`${ADMIN}/reset/email/verify`, { username: username.trim(), email: address.trim(), code: emailCode });
      setTicket(r.ticket); setTicketBy('email'); setNeedsAuthenticator(r.needsAuthenticator); setEmailCode(''); setInfo('');
    } catch (e) { setError(signInError(e)); } finally { setBusy(false); }
  }
  async function complete() {
    if (busy || !valid) return;
    setBusy(true); setError('');
    const factor = !needsAuthenticator ? {} : ticketBy === 'email' ? (lost ? { recoveryCode: merkezCode.trim(), ...(resetMfa ? { resetAuthenticator: true } : {}) } : { code: totp }) : resetMfa ? { resetAuthenticator: true } : { code: totp };
    try {
      const r = await api<{ mfaReset: boolean }>(`${ADMIN}/reset/complete`, { ticket, newPassword: password, ...factor });
      onDone(`Şifreniz yenilendi. Tüm yönetici oturumları kapatıldı; yeni şifrenizle giriş yapın.${r.mfaReset ? ' İki adımlı giriş kapatıldı: girişten sonra Ayarlar → Hesap güvenliği’nden yeniden kurun.' : ''}${ticketBy === 'email' && !needsAuthenticator ? ' Öneri: girişten sonra iki adımlı girişi açın.' : ''}`);
    } catch (e) {
      if (e instanceof ApiError && ['RESET_EXPIRED', 'VERSION_CONFLICT'].includes(e.code)) restart(e.message);
      else { if (e instanceof ApiError && e.code === 'INVALID_CODE') { setTotp(''); } setError(signInError(e)); }
    } finally { setBusy(false); }
  }
  const back = <button type="button" className="text-btn auth-back" disabled={busy} onClick={onBack}>Girişe dön</button>;
  const messages = <div className="auth-messages" aria-live="polite">{info && <Notice tone="success">{info}</Notice>}{error && <Notice tone="error">{error}</Notice>}</div>;
  const lastResort = <p className="auth-dev">Hiçbir kodunuz yoksa: Mola Yönetim klasöründeki <strong>Sifre-Sifirla.cmd</strong> Merkez’in bilgisayarında geçici bir şifre verir (BENIOKU.txt → “Şifremi unuttum”). Sunucudaki (VDS) Merkez’de: sunucuda <strong>sifre-sifirla.sh</strong>.</p>;

  if (available === false && !emailOn) return <div className="auth-form auth-reset">
    <header className="auth-head"><h1>Şifremi unuttum</h1></header>
    <Notice>Kodla şifre sıfırlama yalnız Mola Merkez’in çalıştığı bilgisayarda, o bilgisayardaki tarayıcıdan yapılır. E-postayla sıfırlama da kapalı: Mola Yönetim’de e-posta (SMTP) ayarları yapılmamış. Merkez bir sunucudaysa (VDS) sunucuya bağlanıp orada şifre sıfırlama komutunu çalıştırın (sifre-sifirla.sh ya da npm run merkez:sifre-sifirla).</Notice>
    {back}
  </div>;

  if (ticket) return <form className="auth-form auth-reset" onSubmit={e => { e.preventDefault(); void complete(); }}>
    <header className="auth-head"><h1>Yeni şifre belirleyin</h1><p>Kod doğrulandı. Yeni şifreyi belirleyin; bütün Mola Yönetim oturumları kapanır.</p></header>
    {ticketBy === 'email' && !needsAuthenticator && <Notice>İki adımlı giriş kapalı: şifreniz yalnız e-postanıza gelen kodla sıfırlanıyor. E-postanıza erişen biri de bunu yapabilir. Girişten sonra Ayarlar → Hesap güvenliği’nden iki adımlı girişi açmanızı öneririz.</Notice>}
    <label>Yeni yönetici şifresi<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} autoFocus /></label>
    <label>Yeni şifre tekrar<input type="password" autoComplete="new-password" required maxLength={128} disabled={busy} value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
    <p className="muted small">En az 12 karakter; “mola”, “admin”, işletme adı, yıl, “123456” gibi tahmin edilen parçalardan oluşmasın.</p>
    {weak && password.length >= 4 && <p className="field-hint" role="status">{weak}</p>}
    {repeat && repeat !== password && <Notice>Yeni şifreler eşleşmiyor.</Notice>}
    {needsAuthenticator && ticketBy === 'code' && <div className="reset-authenticator">
      {!resetMfa && <label>Doğrulayıcı uygulamadaki 6 haneli kod<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" disabled={busy} value={totp} onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} /></label>}
      {!lost ? <button type="button" className="text-btn" disabled={busy} onClick={() => setLost(true)}>Doğrulayıcımı kaybettim</button>
        : <label className="checkbox-label"><input type="checkbox" checked={resetMfa} disabled={busy} onChange={e => setResetMfa(e.target.checked)} />Doğrulayıcıyı da sıfırla</label>}
      {lost && <p className="muted small">{resetMfa ? 'İki adımlı giriş kapanır. Girişten sonra Ayarlar → Hesap güvenliği’nden yeniden kurun.' : 'Telefonunuz ya da doğrulayıcı uygulamanız yoksa işaretleyin: iki adımlı giriş kapanır, girişten sonra yeniden kurarsınız.'}</p>}
    </div>}
    {needsAuthenticator && ticketBy === 'email' && <div className="reset-authenticator">
      <p className="muted small">İki adımlı giriş açık: e-postadaki kod tek başına yetmez.</p>
      {!lost ? <>
        <label>Doğrulayıcı uygulamadaki 6 haneli kod<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" disabled={busy} value={totp} onChange={e => setTotp(e.target.value.replace(/\D/g, ''))} /></label>
        <button type="button" className="text-btn" disabled={busy} onClick={() => { setLost(true); setTotp(''); setResetMfa(true); }}>Doğrulayıcımı kaybettim</button>
      </> : <>
        <label>Merkez kurtarma kodu (doğrulayıcı yerine)<input value={merkezCode} onChange={e => setMerkezCode(e.target.value)} maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" /></label>
        <p className="muted small">Ayarlar → Yedek’te gösterilen 24 harflik kod.</p>
        <label className="checkbox-label"><input type="checkbox" checked={resetMfa} disabled={busy} onChange={e => setResetMfa(e.target.checked)} />Doğrulayıcıyı da sıfırla (iki adımlı giriş kapanır, girişten sonra yeniden kurun)</label>
        <button type="button" className="text-btn" disabled={busy} onClick={() => { setLost(false); setMerkezCode(''); setResetMfa(false); }}>Doğrulayıcı kodunu gireceğim</button>
      </>}
    </div>}
    {messages}
    <button className="btn primary auth-submit" disabled={busy || !valid}>{busy ? 'Şifre yenileniyor…' : 'Şifreyi yenile ve oturumları kapat'}</button>
    <button type="button" className="text-btn auth-back" disabled={busy} onClick={() => restart('')}>{ticketBy === 'email' ? 'Baştan başla' : 'Başka bir kod kullan'}</button>
  </form>;

  const methods = available !== false && <div className="segmented reset-methods" role="group" aria-label="Sıfırlama yolu">
    <button type="button" aria-pressed={method === 'code'} className={method === 'code' ? 'active' : ''} disabled={busy} onClick={() => choose('code')}><KeyRound size={16} aria-hidden="true" />Kodla</button>
    <button type="button" aria-pressed={method === 'email'} className={method === 'email' ? 'active' : ''} disabled={busy || !emailOn} onClick={() => choose('email')}><Mail size={16} aria-hidden="true" />E-postayla</button>
  </div>;
  const emailOff = available !== null && !emailOn && <p className="muted small reset-email-off">E-postayla sıfırlama kapalı: Mola Yönetim’de e-posta (SMTP) ayarları yapılmamış (Ayarlar → E-posta bildirimleri).</p>;

  if (method === 'email') return <form className="auth-form auth-reset" onSubmit={e => { e.preventDefault(); void (sent ? verifyEmail() : send()); }}>
    <header className="auth-head"><h1>Şifremi unuttum</h1><p>Yönetici e-postanıza 6 haneli bir kod gönderilir.{available === false ? ' Kodla sıfırlama yalnız Merkez’in kendi bilgisayarında yapılır.' : ''}</p></header>
    {methods}
    <label>Kullanıcı adı<input value={username} onChange={e => setUsername(e.target.value)} required maxLength={64} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy || sent} /></label>
    <label>Yönetici e-postası<input type="email" value={address} onChange={e => setAddress(e.target.value)} required maxLength={200} autoComplete="email" disabled={busy || sent} /></label>
    {sent && <label>E-postadaki 6 haneli kod<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required disabled={busy} value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>}
    {messages}
    {sent ? <>
      <button className="btn primary auth-submit" disabled={busy || !/^\d{6}$/.test(emailCode)}><KeyRound size={18} aria-hidden="true" />{busy ? 'Kod doğrulanıyor…' : 'Devam et'}</button>
      <button type="button" className="text-btn" disabled={busy} onClick={() => void send()}>Kodu yeniden gönder</button>
      <button type="button" className="text-btn" disabled={busy} onClick={() => { setSent(false); setInfo(''); setError(''); }}>Bilgileri düzelt</button>
    </> : <button className="btn primary auth-submit" disabled={busy || !username.trim() || !address.trim()}><Mail size={18} aria-hidden="true" />{busy ? 'Gönderiliyor…' : 'E-postama kod gönder'}</button>}
    {lastResort}
    {back}
  </form>;

  return <form className="auth-form auth-reset" onSubmit={e => { e.preventDefault(); void verify(); }}>
    <header className="auth-head"><h1>Şifremi unuttum</h1><p>Yönetici şifresini Mola Merkez’in çalıştığı bu bilgisayarda yenileyebilirsiniz. Elinizdeki kodlardan birini seçin.</p></header>
    {methods}{emailOff}
    <fieldset className="reset-proofs" disabled={busy}>
      <legend>Hangi kodla?</legend>
      {proofs.map(p => <label key={p.id} className={`reset-proof${proof === p.id ? ' selected' : ''}`}>
        <input type="radio" name="proof" value={p.id} checked={proof === p.id} disabled={p.id === 'merkez' && !recoveryOn} onChange={() => { setProof(p.id); setCode(''); setError(''); }} />
        <span><strong>{p.label}</strong><small>{p.id === 'merkez' && !recoveryOn ? 'Bu çalıştırmada Merkez kurtarma kodu kullanılamıyor.' : p.hint}</small></span>
      </label>)}
    </fieldset>
    <label>{proof === 'merkez' ? 'Merkez kurtarma kodu' : 'Yedek kod'}<input value={code} onChange={e => setCode(e.target.value)} required maxLength={64} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={busy} placeholder={proofs.find(p => p.id === proof)!.placeholder} /></label>
    {messages}
    <button className="btn primary auth-submit" disabled={busy || available === null || !code.trim()}><KeyRound size={18} aria-hidden="true" />{busy ? 'Kod doğrulanıyor…' : 'Devam et'}</button>
    {lastResort}
    {back}
  </form>;
}

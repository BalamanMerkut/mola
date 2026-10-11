import { ShieldCheck } from 'lucide-react';
export function LoginFactor({ code, onChange, busy, onBack }: { code: string; onChange: (v: string) => void; busy: boolean; onBack: () => void }) {
 return <section className="login-factor"><ShieldCheck size={28} /><h2>Girişinizi doğrulayın</h2><p className="muted">Authenticator uygulamanızdaki kodu girin. Telefonunuza erişemiyorsanız kullanılmamış bir kurtarma kodu da kullanabilirsiniz.</p><label>Authenticator veya kurtarma kodu<input autoFocus required autoComplete="one-time-code" maxLength={32} disabled={busy} value={code} onChange={e => onChange(e.target.value.trim())} /></label><button type="button" className="text-btn" disabled={busy} onClick={onBack}>Kullanıcı adı ve şifreye dön</button></section>;
}

import { MolaContact } from './MolaContact';
import { installed } from './molaApp';

/**
 * Under the login on a phone or tablet's browser: the way to /uygulama (Android app, iPhone/iPad home screen). Not shown in
 * the Mola app, on the home-screen web app, or on a computer with a mouse.
 */
export function InstallHint() {
  if (installed() || !window.matchMedia?.('(pointer: coarse)').matches) return null;
  return <p className="login-install"><a href="/uygulama">Mola'yı bu cihaza uygulama olarak kurun</a></p>;
}

/**
 * "Şifremi unuttum" under the café login: the owner's way back (recovery code, or a one-time code from the Mola team) and the
 * staff's (the owner sets a new password), with the Mola team's contact when the vendor filled it in.
 */
export function ForgotPasswordHelp() {
  return <details className="login-forgot"><summary>Şifremi unuttum</summary>
    <p><strong>İşletme sahibi:</strong> Kasa bilgisayarındaki Mola penceresinde sol şerit → Güvenlik → İşletme sahibi şifresini unuttum. Kurtarma kodunuz yoksa Mola ekibinden tek kullanımlık kod isteyin.</p>
    <p><strong>Çalışan:</strong> İşletme sahibi, Personel → Çalışanlar'dan “Şifreyi yenile” ile yeni şifre verir.</p>
    <MolaContact title="Mola ekibi" note="Tek kullanımlık kod için arayın; kimliğinizi doğruladıktan sonra kodu okurlar." />
  </details>;
}

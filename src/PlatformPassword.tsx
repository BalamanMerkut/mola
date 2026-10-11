import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { api, ApiError } from './api';
import { Notice } from './components';
import { weakAdminPassword } from '../packages/domain/admin-password';
import { ADMIN } from './platformStatus';
import { SCard } from './platformSettingsKit';

const RULES = 'En az 12 karakter kullanın; “mola”, “admin”, işletme adı, yıl, “123456” gibi tahmin edilen parçalardan oluşmasın. Yeni şifre iki alanda aynı, mevcut şifrenizden farklı olmalı. Şifre değişince bu ekran dahil tüm Mola Yönetim oturumları kapanır; işletme hesapları etkilenmez.';

/** forced: the generated first password (merkez-first-login.txt) must be replaced before Mola Yönetim opens. */
export function PlatformPassword({ disabled, onChanged, forced = false }: { disabled: boolean; onChanged: (message: string) => void; forced?: boolean }) {
  const [currentPassword, setCurrent] = useState(''), [newPassword, setNew] = useState(''), [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The same rule as Mola Merkez (which also refuses the businesses' names): said while typing, in words.
  const weak = newPassword ? weakAdminPassword(newPassword) : undefined;
  const valid = currentPassword.length > 0 && !weak && newPassword !== currentPassword && newPassword === repeat;
  async function save() {
    if (busy || disabled || !valid) return;
    setBusy(true); setError('');
    try {
      await api(`${ADMIN}/password`, { currentPassword, newPassword });
      setCurrent(''); setNew(''); setRepeat('');
      onChanged('Şifreniz değiştirildi. Tüm yönetici oturumları kapatıldı; yeni şifrenizle giriş yapın.');
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500 || e.status === 401) {
        onChanged('İşlemin sonucu doğrulanamadı veya oturum kapandı. Önce yeni şifrenizle giriş yapın; kabul edilmezse mevcut şifrenizi deneyin.');
      } else setError((e as Error).message);
    } finally { setBusy(false); }
  }
  const fields = <>
    <div className={forced ? 'form-columns' : 'ps-fields'}>
      <label>Mevcut yönetici şifresi *<input type="password" autoComplete="current-password" required maxLength={128} disabled={disabled || busy} value={currentPassword} onChange={e => setCurrent(e.target.value)} /></label>
      <label>Yeni yönetici şifresi *<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={disabled || busy} value={newPassword} onChange={e => setNew(e.target.value)} /></label>
      <label>Yeni şifre tekrar *<input type="password" autoComplete="new-password" required maxLength={128} disabled={disabled || busy} value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
    </div>
    {forced && <p className="muted small">{RULES.split(' Şifre değişince')[0]}</p>}
    {weak && newPassword.length >= 4 && <p className="field-hint" role="status">{weak}</p>}
    {repeat && repeat !== newPassword && <Notice>Yeni şifreler eşleşmiyor.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </>;
  if (forced) return <section className="panel"><h2>İlk şifreyi değiştirin</h2><p>Bu şifre geçicidir: kurulumda üretilen ilk şifre (merkez-first-login.txt) ya da Sifre-Sifirla komutunun verdiği şifre. Devam etmek için kendi belirleyeceğiniz bir şifreyle değiştirin.</p>
    <form onSubmit={e => { e.preventDefault(); void save(); }}>{fields}<button className="btn primary" disabled={disabled || busy || !valid}>{busy ? 'Şifre değiştiriliyor…' : 'Şifreyi değiştir ve oturumları kapat'}</button></form></section>;
  return <SCard icon={KeyRound} title="Yönetici şifresi" sub="En az 12 karakter · değişince oturumlar kapanır" tip={RULES} className="ps-password">
    <form className="ps-form" onSubmit={e => { e.preventDefault(); void save(); }}>{fields}
      <button className="btn primary ps-wide-btn" disabled={disabled || busy || !valid}><LogOut size={16} aria-hidden="true" />{busy ? 'Şifre değiştiriliyor…' : 'Şifreyi değiştir ve oturumları kapat'}</button>
    </form>
  </SCard>;
}

import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquareText, Palette, Store } from 'lucide-react';
import { LogoEditor } from './LogoEditor';
import { MenuHero } from './MenuHero';
import { themes, themeIds, defaultMenuHero } from '../packages/domain/theme';
import type { StaffSnapshot } from '../packages/domain/types';
import { businessTheme } from './BusinessTheme';
import { api, ApiError, requestId } from './api';
import { Notice } from './components';
import { Card, Field, Segmented } from './SettingsKit';

/**
 * Ayarlar → İşletme görünümü: name, logo, colours and menu welcome, as three cards of one form with one save bar. Business
 * data stays on the café computer, so the owner changes it here. The Google review link moved to Sosyal medya (6 Ekim).
 */
type Profile = Pick<StaffSnapshot, 'name' | 'logo' | 'theme' | 'menuHero' | 'businessRevision'>;
export function BusinessProfile({ data, onSaved }: { data: Profile; onSaved: () => void }) {
  const [previewEnglish, setPreviewEnglish] = useState(false);
  const [theme, setTheme] = useState(data.theme ?? 'sage');
  const [menuHero, setMenuHero] = useState(data.menuHero ?? { ...defaultMenuHero });
  const [name, setName] = useState(data.name), [logo, setLogo] = useState<string | null>(data.logo ?? null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [saved, setSaved] = useState(false);
  const pending = useRef<object | null>(null);
  const initial = useRef(JSON.stringify({ name: data.name, logo: data.logo ?? null, theme: data.theme ?? 'sage', menuHero: data.menuHero ?? defaultMenuHero }));
  const dirty = loading || initial.current !== JSON.stringify({ name, logo, theme, menuHero });
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, uncertain]);
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    pending.current ??= { requestId: requestId(), version: data.businessRevision ?? 0, name, logo, theme, menuHero };
    try {
      await api('/api/staff/business-profile', pending.current); pending.current = null; setUncertain(false);
      initial.current = JSON.stringify({ name, logo, theme, menuHero }); setSaved(true); onSaved();
    } catch (e) { const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const disabled = busy || uncertain;
  const hero = (patch: Partial<typeof menuHero>) => setMenuHero({ ...menuHero, ...patch });
  return <section className="business-profile settings-profile" aria-label="İşletme görünümü">
    <form className="settings-profile-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <Card icon={<Store size={18} aria-hidden="true" />} title="İşletme görünümü" tip="İşletmenin müşteriye görünen kimliği: ad, logo, renkler ve menü karşılaması (Google değerlendirme bağlantısı: İşletme → Sosyal medya). Kaydettiğinizde menü ve panel güncellenir." lead="Müşteri menüsünün üstünde ve işletme panelinde görünen ad ve logo.">
        <div className="settings-fields">
          <Field label="İşletme adı *" hint="2–80 karakter. Fişlerde ve menü başlığında da bu ad yazar."><input required minLength={2} maxLength={80} disabled={disabled} value={name} onChange={e => setName(e.target.value)} /></Field>
          <div className="settings-field"><span className="settings-field-label" aria-hidden="true">Logo</span><LogoEditor value={logo} disabled={disabled} onChange={setLogo} onEditing={setLoading} /></div>
        </div>
      </Card>

      <Card icon={<Palette size={18} aria-hidden="true" />} title="Renk paleti" lead="Müşteri menüsünde ve işletme panelinde kullanılır. Masa durumları ve uyarı renkleri değişmez.">
        <fieldset className="business-theme-picker" disabled={disabled}><legend className="sr-only">Renk seçimi</legend>
          <div className="business-theme-options">{themeIds.map(id => <button type="button" key={id} aria-pressed={theme === id} onClick={() => setTheme(id)} className={theme === id ? 'selected' : ''}><span className="theme-swatch" style={{ background: themes[id].primary }} /><span>{themes[id].name}</span>{theme === id && <Check size={15} aria-hidden="true" className="theme-check" />}</button>)}</div>
          <div className="business-themed theme-sample" style={businessTheme(theme)}><strong>{name || 'İşletmeniz'}</strong><span>Menü ve panel renk önizlemesi</span><span className="theme-sample-button">Örnek düğme</span></div>
        </fieldset>
      </Card>

      <Card icon={<MessageSquareText size={18} aria-hidden="true" />} title="Menü karşılama alanı" lead="Müşteri QR menüyü açınca en üstte gördüğü başlık, kısa açıklama ve simge.">
        <div className="settings-fields">
          <Field label="Karşılama başlığı *"><input required maxLength={100} disabled={disabled} value={menuHero.title} onChange={e => hero({ title: e.target.value })} /></Field>
          <Field label="Karşılama açıklaması" hint="En fazla 240 karakter."><textarea aria-label="Karşılama açıklaması" maxLength={240} rows={3} disabled={disabled} value={menuHero.description} onChange={e => hero({ description: e.target.value })} /></Field>
          <Field label="Menü simgesi"><select aria-label="Menü simgesi" disabled={disabled} value={menuHero.icon} onChange={e => hero({ icon: e.target.value as typeof menuHero.icon })}><option value="coffee">Kahve fincanı</option><option value="tea">Çay yaprağı</option><option value="food">Yemek</option><option value="dessert">Tatlı</option></select></Field>
          <details className="settings-fold"><summary>İngilizce metinler</summary>
            <p className="settings-field-hint">Menü İngilizce açıldığında gösterilir. Boş bırakılırsa Türkçe metin gösterilir.</p>
            <Field label="İngilizce başlık"><input maxLength={100} disabled={disabled} value={menuHero.titleEn} onChange={e => hero({ titleEn: e.target.value })} /></Field>
            <Field label="İngilizce açıklama"><textarea aria-label="İngilizce açıklama" rows={3} maxLength={240} disabled={disabled} value={menuHero.descriptionEn} onChange={e => hero({ descriptionEn: e.target.value })} /></Field>
          </details>
        </div>
        <div className="hero-preview-heading"><strong>Karşılama önizlemesi</strong><Segmented label="Karşılama önizleme dili" value={previewEnglish ? 'en' : 'tr'} onChange={v => setPreviewEnglish(v === 'en')} options={[{ value: 'tr', label: 'Türkçe' }, { value: 'en', label: 'English' }]} /></div>
        {previewEnglish && (!menuHero.titleEn.trim() || !menuHero.descriptionEn.trim()) && <p className="settings-field-hint" role="status">İngilizcesi boş olan alanlarda Türkçe metin gösteriliyor.</p>}
        <div className="business-themed hero-live-preview" style={businessTheme(theme)}><MenuHero name={name} value={menuHero} en={previewEnglish} /></div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && !dirty && <Notice tone="success">İşletme görünümü kaydedildi. Menü ve panel güncellendi.</Notice>}
      <div className={`profile-save-bar${dirty || uncertain ? ' dirty' : ''}`}><span role="status">{uncertain ? 'Kayıt sonucu belirsiz.' : dirty ? 'Kaydedilmemiş değişiklikler var.' : 'Bilgiler güncel.'}</span><button className="btn primary" disabled={busy || loading || (!uncertain && (!dirty || name.trim().length < 2 || !menuHero.title.trim()))}>{uncertain ? 'Kaydı yeniden kontrol et' : 'Bilgileri kaydet'}</button></div>
    </form>
  </section>;
}

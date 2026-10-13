import { useEffect, useState } from 'react';
import { Code2, CloudDownload, DatabaseBackup, FolderOpen, Headset, Mail, ScrollText, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN } from './platformStatus';
import { PlatformUsers, type Me } from './PlatformUsers';
import { EmailSettings } from './PlatformAlerts';
import { PlatformBackup } from './PlatformBackup';
import { ContactSettings } from './PlatformContact';
import { PlatformDevAccess } from './PlatformDevAccess';
import { PlatformJournal } from './PlatformJournal';
import { PlatformMfa } from './PlatformMfa';
import { PlatformPassword } from './PlatformPassword';
import { PlatformReleases } from './PlatformReleases';
import type { SettingsSection } from './PlatformToday';
import { PlatformWorkFolder } from './PlatformWorkFolder';
import { PillTabs } from './PillTabs';
import './platform-journal.css';
import './platform-settings.css';

// Paketler and Hizmet fiyatları have their own page in the left menu since 13 Ekim (src/PlatformCatalogPage.tsx).
// Kullanıcılar (13 Ekim): the owner's only; a yetkili does not see the tab (src/PlatformUsers.tsx).
export const settingsSections: [SettingsSection, string][] = [['security', 'Hesap güvenliği'], ['users', 'Kullanıcılar'], ['backup', 'Yedek'], ['updates', 'Güncellemeler'], ['email', 'E-posta bildirimleri'], ['contact', 'İletişim bilgileri'], ['audit', 'İşlem kayıtları'], ['workfolder', 'Çalışma klasörü'], ['developer', 'Geliştirici erişimi']];
const icons: Record<SettingsSection, LucideIcon> = { security: ShieldCheck, users: Users, backup: DatabaseBackup, updates: CloudDownload, email: Mail, contact: Headset, audit: ScrollText, workfolder: FolderOpen, developer: Code2 };

/**
 * Ayarlar: one section at a time, picked from the shared pill tab bar (src/PillTabs.tsx: one row, two centred rows, or on a
 * phone one row that slides inside itself). The versions are in the page's one footer
 * ("Mola Yönetim X · Merkez Y · Merkut Studios", src/Platform.tsx + src/AppVersion.tsx).
 */
export function PlatformSettings({ section, onSection, disabled, onSessionEnd, security, onOpenBusiness }: {
  section: SettingsSection; onSection: (section: SettingsSection) => void; disabled: boolean;
  /** Yedek → "Kafelerin bulut yedekleri": a row opens its business. */
  onOpenBusiness?: (tenantId: string) => void;
  onSessionEnd: (message: string, tone: 'error' | 'success') => void;
  /**
   * Sent here by "İki adımlı doğrulamayı aç" (src/Platform.tsx openSecurity): `pending` names the change that waits, the
   * setup card comes first, and `onBack` returns to it; `onEnabled` lets Platform bring the vendor back after the new login.
   * `onAsk` is the same way from the Güncellemeler card.
   */
  security?: { pending?: string; onBack?: () => void; onEnabled?: () => void; onAsk?: (label: string) => void };
}) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void api<Me>(`${ADMIN}/me`).then(setMe, () => setMe(null)); }, []);
  // A yetkili: no Kullanıcılar tab (the owner's), and a line saying whose account this is and what stays the owner's.
  const sections = settingsSections.filter(([id]) => id !== 'users' || me?.owner);
  const shown = section === 'users' && !me?.owner ? 'security' : section;
  return <div className="platform-settings">
    <header className="page-head"><div><h1>Ayarlar</h1><p className="page-lead">Hesabınız, Merkez yedeği, güncellemeler ve kayıtlar.</p></div></header>
    <PillTabs items={sections.map(([id, label]) => ({ id, label, icon: icons[id] }))} value={shown} onChange={onSection} label="Ayarlar bölümleri" kind="nav" wrapClassName="settings-pill-tabs" />
    {shown === 'security' && me && !me.owner && <Notice>Yetkili hesabı: <b>{me.name}</b> ({me.username}). Şifreniz ve iki adımlı girişiniz size aittir. Kullanıcılar, e-posta ayarları, Merkez kurtarma kodu ve geliştirici erişim anahtarları Mola Yönetim sahibindedir. Şifrenizi unutursanız sahibinden yeni ilk şifre isteyin.</Notice>}
    {shown === 'users' && <PlatformUsers />}
    {shown === 'security' && <div className="ps-grid ps-security"><PlatformPassword disabled={disabled} onChanged={message => onSessionEnd(message, /değiştirildi/.test(message) ? 'success' : 'error')} /><PlatformMfa pending={security?.pending} onBack={security?.onBack} onEnabled={security?.onEnabled} onChanged={message => onSessionEnd(message, 'success')} /></div>}
    {shown === 'backup' && <PlatformBackup onOpenBusiness={onOpenBusiness} />}
    {shown === 'updates' && <PlatformReleases onSecurity={() => security?.onAsk ? security.onAsk('Güncelleme yayını') : onSection('security')} />}
    {shown === 'email' && <EmailSettings />}
    {shown === 'contact' && <div className="platform-settings-one"><ContactSettings /></div>}
    {shown === 'audit' && <PlatformJournal />}
    {shown === 'workfolder' && <PlatformWorkFolder />}
    {shown === 'developer' && <PlatformDevAccess />}
  </div>;
}

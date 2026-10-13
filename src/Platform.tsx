import { LoginFactor } from './LoginFactor';
import './platform-workspace.css';
import './platform-extras.css';
import './activation.css';
import { orderBusinesses, type BusinessOrder } from './businessOrder';
import { PlatformDiagnostics } from './PlatformDiagnostics';
import { AlertBell, AlertCenter, useAlertSound } from './PlatformAlerts';
import { Building2, CalendarDays, Store, KeyRound, Download, FileText, ChevronRight, Sun, Inbox, LifeBuoy, Settings, LogOut, ReceiptText, Megaphone, Package } from 'lucide-react';
import { TicketChat } from './TicketChat';
import { BusinessFilters, matchesBusiness, type BusinessFilter } from './PlatformFilters';
import { PlatformPassword } from './PlatformPassword';
import type { AuditEntry } from './PlatformBusiness';
import { BusinessDetail, ContactLinks, type DetailTab } from './PlatformDetail';
import { BusinessTiles } from './PlatformDirectory';
import { BusinessPeek } from './PlatformBusinessPeek';
import { holdServiceDraft } from './PlatformService';
import { ActivationSteps, CodeShare } from './PlatformActivationHelp';
import { AuthScreen } from './PlatformAuth';
import { PlatformReset } from './PlatformReset';
import { PlatformLocked } from './PlatformLocked';
import { PlatformKeyCard } from './PlatformKeyCard';
import { ApplicationList } from './PlatformApplications';
import { linkLead, SiteLeadList, useSiteLeads, type LeadPrefill } from './PlatformSiteLeads';
import { PlatformToday, type SettingsSection } from './PlatformToday';
import { PlatformSettings } from './PlatformSettings';
import { PlatformSales } from './PlatformSales';
import { PlatformAnnouncements } from './PlatformAnnouncements';
import { PlatformCatalogPage, type PackagesTab } from './PlatformCatalogPage';
import { StepUpDialog, withStepUp } from './platformStepUp';
import { FeatureChips, offeredPackages, type CatalogView } from './platformCatalog';
import { useRef, useState, useEffect, type ReactNode } from 'react';
import type { Ticket } from '../server/license';
import { ADMIN, businessesCsv, dateTime, download, localDay, matchesSearch, openApplication, pendingApplication, planText, shortDate, signInError, type AlertView, type Business } from './platformStatus';
import { sectorNames, sectors, type Sector } from '../packages/domain/sector';
import { normalPhone, validEmail, validTaxNumber, type Invoice, type TaxType } from '../packages/domain/invoice';
import { api, ApiError, money, requestId } from './api';
import { Notice, Modal } from './components';
import { YonetimBrand } from './MolaLogo';
import { AppVersion } from './AppVersion';
import { serverVersion, useServerVersion } from './versionReload';
// Local-only hints (prefilled admin name, first-login file) must not appear on the public domain.
const localDev = /^(localhost|127\.|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
type Page = 'today' | 'businesses' | 'applications' | 'support' | 'announcements' | 'sales' | 'packages' | 'settings' | 'alerts';
/** Tiles per page; with the "İşletme ekle" tile 24 fill whole rows of 2, 3 or 4. */
const PAGE = 23;
type Snapshot = { businesses: Business[]; tickets: Ticket[]; audit: AuditEntry[]; alerts: AlertView[]; unread: number; version?: string; catalog?: CatalogView };
type IssuedCode = { name: string; code: string; codeExpiresAt: string; phone?: string };
const blankInvoice: Invoice = { legalName: '', taxOffice: '', taxType: 'company', taxNumber: '', city: '', district: '', address: '', phone: '', email: '' };

/**
 * Mola Yönetim: the vendor's panel on Mola Merkez. A left sidebar (Bugün, İşletmeler, Başvurular, Duyurular, Satışlarım, Paketler;
 * Destek and Ayarlar kept at the bottom, 13 Ekim), the bell and "Çıkış yap" at the top right. Licences, activation codes, support, the notification centre and the cafés' health
 * reports. It never shows (and Merkez never has) a café's sales, payments, menu or staff.
 */
export function Platform() {
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(''), [info, setInfo] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [page, setPageName] = useState<Page>('today'), [ticketId, setTicketId] = useState('');
  const [loginUsername, setLoginUsername] = useState(localDev ? 'admin' : '');
  // After a Merkez update the open tab reloads itself at a quiet moment (src/versionReload.ts): the sign-in page asks Merkez's
  // health, the signed-in page learns the version from every /state (10 s).
  useServerVersion(() => fetch('/api/merkez/v1/health', { cache: 'no-store' }).then(r => r.json()).then((h: { version?: string }) => h.version));
  const [factorCode, setFactorCode] = useState('');
  const [factorStep, setFactorStep] = useState(false), [mustChange, setMustChange] = useState(false), [resetting, setResetting] = useState(false);
  // "Yerel test ortamı" only for a Merkez started from the project (npm run merkez); the installed Mola Yönetim says MOLA_MODE=installed.
  const [mode, setMode] = useState<'development' | 'installed' | ''>('');
  // Merkez started with its data key locked (server/merkez/locked.ts): only the unlock screen.
  const [locked, setLocked] = useState(false);
  const [businessOrder, setBusinessOrder] = useState<BusinessOrder>('created');
  const [supportBusinessId, setSupportBusinessId] = useState('');
  const [creating, setCreating] = useState(false), [selectedBusiness, setSelectedBusiness] = useState(''), [detailTab, setDetailTab] = useState<DetailTab>('summary');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('security'), [packagesTab, setPackagesTab] = useState<PackagesTab>('packages');
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<BusinessFilter>('all'), [listPage, setListPage] = useState(1);
  const [name, setName] = useState(''), [contactName, setContactName] = useState(''), [plan, setPlan] = useState('trial'), [sector, setSector] = useState<Sector | ''>(''), [packageId, setPackageId] = useState('');
  const [withInvoice, setWithInvoice] = useState(false), [invoice, setInvoice] = useState<Invoice>(blankInvoice), [invoiceTried, setInvoiceTried] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [notice, setNotice] = useState('');
  // Web sitesi talepleri (src/PlatformSiteLeads.tsx): their own list and counts; "İşletme ekle" from one remembers it.
  const siteLeads = useSiteLeads(), fromLead = useRef<LeadPrefill | null>(null);
  const [applicationKind, setApplicationKind] = useState<'all' | 'applications' | 'web'>('all');
  const signedIn = !!data;
  useEffect(() => { if (signedIn) void siteLeads.reload(); }, [signedIn, siteLeads.reload]);
  const [uncertain, setUncertain] = useState(false); const pending = useRef<{ path: string; body: object } | null>(null);
  const reads = useRef({ sequence: 0, pending: 0, enabled: true, mounted: true });
  const top = useRef<HTMLDivElement>(null);
  // "İki adımlı doğrulamayı aç" (src/platformStepUp.tsx): where the vendor was and what waited, to come back after the
  // two-step setup and the new login (`armed` once it was switched on); `toSecurity` keeps the refused change's
  // MFA_REQUIRED from showing as an error on the way.
  const returnTo = useRef<{ page: Page; section: SettingsSection; tenantId: string; tab: DetailTab; label: string; armed: boolean } | null>(null), toSecurity = useRef(false);
  const [securityPending, setSecurityPending] = useState('');
  useAlertSound(data?.alerts);
  useEffect(() => { void fetch('/api/merkez/v1/health').then(r => r.json()).then((h: { mode?: 'development' | 'installed'; locked?: boolean }) => { setMode(h.mode ?? 'development'); setLocked(!!h.locked); }).catch(() => setMode('development')); }, []);
  /** Back to the login screen; `message` says why (a success is shown green, a problem red). */
  function endSession(message = '', tone: 'error' | 'success' = 'error') {
    reads.current.enabled = false; reads.current.sequence++;
    setData(null); setMustChange(false); setError(tone === 'error' ? message : ''); setInfo(tone === 'success' ? message : ''); setPageName('today'); setSelectedBusiness('');
    setTicketId(''); setCreating(false); setIssued(null); setNotice('');
    if (!returnTo.current?.armed) returnTo.current = null;
    setSecurityPending('');
  }
  /** After the new login that follows switching two-step login on: back to the business tab or page that waited. */
  function resumePending() {
    const r = returnTo.current;
    if (!r?.armed) return;
    returnTo.current = null;
    setPageName(r.page); setSettingsSection(r.section); setSelectedBusiness(r.tenantId); setDetailTab(r.tab);
    setNotice(`İki adımlı giriş açık. “${r.label}” için kaldığınız yerdesiniz; değişikliği yeniden uygulayın (doğrulayıcı kodu bir kez sorulur).`);
  }
  async function load(background = false) {
    const guard = reads.current;
    if (!guard.mounted || !guard.enabled || (background && guard.pending > 0)) return;
    const sequence = ++guard.sequence; guard.pending++;
    const current = () => guard.mounted && guard.enabled && sequence === guard.sequence;
    try { const snapshot = await api<Snapshot>(`${ADMIN}/state`); if (current()) { setData(snapshot); setMustChange(false); serverVersion(snapshot.version); } }
    catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 401) endSession();
      else if (e instanceof ApiError && e.code === 'MERKEZ_LOCKED') setLocked(true);
      else if (e instanceof ApiError && e.code === 'PASSWORD_CHANGE_REQUIRED') setMustChange(true);
      else setError((e as Error).message);
    }
    finally { guard.pending--; }
  }
  useEffect(() => { reads.current.mounted = true; void load(); const t = setInterval(() => void load(true), 10000); return () => { clearInterval(t); reads.current.mounted = false; reads.current.sequence++; }; }, []);
  async function logout() {
    if (busy || uncertain || !reads.current.enabled) return;
    reads.current.enabled = false; reads.current.sequence++; setBusy(true); setError('');
    try { await api(`${ADMIN}/logout`, {}); if (reads.current.mounted) endSession(); }
    catch (e) { if (reads.current.mounted) { reads.current.enabled = true; setError((e as Error).message); void load(); } }
    finally { if (reads.current.mounted) setBusy(false); }
  }
  async function login() {
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await api<{ mustChangePassword?: boolean }>(`${ADMIN}/login`, { username: loginUsername, password, ...(factorCode ? { code: factorCode } : {}) });
      setPassword(''); setFactorCode(''); setFactorStep(false); reads.current.enabled = true;
      if (r.mustChangePassword) setMustChange(true); else { await load(); resumePending(); }
    } catch (e) { if (e instanceof ApiError && e.code === 'MFA_REQUIRED') { setFactorStep(true); setFactorCode(''); } else { setError(signInError(e)); if (e instanceof ApiError && e.code === 'INVALID_LOGIN') { setFactorStep(false); setFactorCode(''); setPassword(''); } } } finally { setBusy(false); }
  }
  async function mutate(path?: string, body?: object) {
    setBusy(true); setError(''); setNotice(''); pending.current ??= { path: path!, body: { requestId: requestId(), ...body } };
    try {
      // Hizmet and "Ödeme alındı" ask for the Authenticator code first when its 10 minutes are not open (src/platformStepUp.tsx).
      const asked = pending.current, label = asked.path.endsWith('/business-services') ? 'Değişikliği uygula' : asked.path.endsWith('/licenses') ? 'Ödeme alındı' : 'Kaydet';
      const result = await withStepUp(label, () => api<{ tenantId?: string; code?: string; codeExpiresAt?: string; name?: string }>(asked.path, asked.body));
      const sent = pending.current; pending.current = null; setUncertain(false);
      // The deleted record's page closes by itself (it is gone from the list); the list says what happened.
      if (sent.path.endsWith('/businesses/delete')) { const gone = data?.businesses.find(b => b.tenantId === (sent.body as { tenantId?: string }).tenantId); setSelectedBusiness(''); setPageName(gone && openApplication(gone) ? 'applications' : 'businesses'); setNotice(`“${result.name ?? 'İşletme'}” kaydı silindi.`); }
      if (sent.path.endsWith('/applications/approve')) setNotice((sent.body as { branch?: boolean }).branch ? 'Ek şube olarak kabul edildi; 30 günlük deneme başladı.' : 'Başvuru onaylandı; 30 günlük deneme başladı. İşletmenin bilgisayarı birkaç saniye içinde devam eder.');
      if (sent.path.endsWith('/applications/reject')) setNotice('Başvuru reddedildi; neden işletmeye gösterilir.');
      if (sent.path.endsWith('/licenses') || sent.path.endsWith('/service-plan') || sent.path.endsWith('/trials/start')) setNotice(`Kaydedildi. Yeni lisans işletmenin bilgisayarına bir sonraki bağlantıda (en geç 10 dakika) ulaşır.${(sent.body as { payment?: unknown }).payment ? ' Ödeme Satışlarım’a kaydedildi.' : ''}`);
      if (sent.path.endsWith('/business-services')) setNotice((result as { changed?: boolean }).changed === false ? 'Değişiklik yok.' : 'Hizmetler kaydedildi. Yeni lisans işletmenin bilgisayarına en geç 10 dakikada ulaşır.');
      if (sent.path.endsWith('/installs/machine')) setNotice('Eski bilgisayar yeniden etkinleştirildi; diğerinde sipariş bir sonraki bağlantıda kapanır.');
      if (sent.path.endsWith('/invoice') || sent.path.endsWith('/notes')) setNotice('Kaydedildi.');
      // Tanıtım işletmesi (src/PlatformDemo.tsx): both reach the café with its next heartbeat.
      if (sent.path.endsWith('/demo')) setNotice('Kaydedildi. İşletmenin bilgisayarı bir sonraki bağlantıda (en geç 10 dakika) öğrenir.');
      if (sent.path.endsWith('/demo/reset')) setNotice('Sıfırlama isteği gönderildi. İşletmenin bilgisayarı bir sonraki bağlantıda önce yedek alıp sıfırlar.');
      // The activation code is shown once, right after it is made; Merkez keeps only its hash.
      if (result.code && result.codeExpiresAt) {
        const created = sent.path.endsWith('/businesses'), known = created ? undefined : data?.businesses.find(b => b.tenantId === (sent.body as { tenantId?: string }).tenantId);
        const phone = created ? (sent.body as { invoice?: { phone?: string } }).invoice?.phone : known?.invoice?.phone;
        setIssued({ name: created ? name : known?.name ?? '', code: result.code, codeExpiresAt: result.codeExpiresAt, ...(phone ? { phone } : {}) });
      }
      if (sent.path.endsWith('/businesses') && fromLead.current && result.tenantId) { await linkLead(fromLead.current.leadId, result.tenantId); fromLead.current = null; void siteLeads.reload(); }
      if (sent.path.endsWith('/businesses')) { setCreating(false); setSelectedBusiness(''); setName(''); setContactName(''); setSector(''); setPackageId(''); setPlan('trial'); setWithInvoice(false); setInvoice(blankInvoice); setInvoiceTried(false); setQuery(''); setFilter('all'); setBusinessOrder('created'); setPageName('businesses'); setListPage(Math.ceil(((data?.businesses.filter(b => !openApplication(b)).length ?? 0) + 1) / PAGE)); }
      await load();
      return true;
    } catch (e) {
      // The vendor already went on to Hesap güvenliği from the step-up box: the refusal is not news there.
      if (toSecurity.current && e instanceof ApiError && e.code === 'MFA_REQUIRED') { toSecurity.current = false; pending.current = null; return false; }
      const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setError((e as Error).message); return false;
    } finally { setBusy(false); }
  }
  const devBadge = localDev && mode === 'development';
  if (locked) return <AuthScreen><PlatformLocked /></AuthScreen>;
  if (mustChange) return <AuthScreen><div className="auth-password"><PlatformPassword forced disabled={busy} onChanged={message => endSession(message, /değiştirildi/.test(message) ? 'success' : 'error')} /><button type="button" className="text-btn auth-back" onClick={() => void logout()}>Çıkış yap</button></div></AuthScreen>;
  if (!data && resetting) return <AuthScreen><PlatformReset onBack={() => { setResetting(false); setError(''); }} onDone={message => { setResetting(false); setPassword(''); setError(''); setInfo(message); }} /></AuthScreen>;
  if (!data) return <AuthScreen><form className="auth-form" onSubmit={e => { e.preventDefault(); void login(); }}>
    {factorStep ? <LoginFactor code={factorCode} onChange={setFactorCode} busy={busy} onBack={() => { setFactorStep(false); setFactorCode(''); setPassword(''); setError(''); }} />
      : <><header className="auth-head"><h1>Hoş geldiniz</h1><p>Lisans, etkinleştirme ve destek için yönetici girişi. İşletmelerin satış ve ödeme bilgileri burada bulunmaz.</p></header>
        <label>Kullanıcı adı<input value={loginUsername} onChange={e => setLoginUsername(e.target.value)} required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
        <label>Şifre<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label></>}
    <div className="auth-messages" aria-live="polite">{info && <Notice tone="success">{info}</Notice>}{error && <Notice tone="error">{error}</Notice>}</div>
    <button className="btn primary auth-submit" disabled={busy}>{factorStep ? 'Doğrula ve giriş yap' : 'Giriş yap'}</button>
    {!factorStep && <button type="button" className="text-btn auth-forgot" disabled={busy} onClick={() => { setResetting(true); setError(''); setInfo(''); setPassword(''); }}>Şifremi unuttum</button>}
    {devBadge && !factorStep && <p className="auth-dev">Yerel test ortamı: ilk giriş bilgileri Mola Merkez veri klasöründeki merkez-first-login.txt dosyasındadır. Şifrenizi değiştirdiyseniz belirlediğiniz yeni şifreyi kullanın.</p>}
  </form></AuthScreen>;

  // Applications have their own page; İşletmeler lists the businesses that exist (or are about to, with a code). A search
  // finds everything the vendor remembers, applications too (their chip says "Başvuru bekliyor").
  const directory = query.trim() ? data.businesses : data.businesses.filter(b => !openApplication(b));
  const ordered = (items: Business[]) => orderBusinesses(items, filter === 'expiring' && businessOrder === 'created' ? 'expiry' : businessOrder);
  const filtered = ordered(directory.filter(l => matchesSearch(l, query, data.tickets) && matchesBusiness(l, filter)));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE)), currentPage = Math.min(listPage, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE, currentPage * PAGE);
  const selected = data.businesses.find(l => l.tenantId === selectedBusiness);
  const disabled = busy || uncertain;
  // Destek's "Talep kapatıldı" lines come from İşlem geçmişi (src/TicketChat.tsx).
  const ticketEvents = data.audit.filter(a => a.action === 'ticket.closed').map(a => ({ ticketId: a.target, kind: 'closed' as const, at: a.at }));
  const openTickets = data.tickets.filter(t => t.status === 'open').length;
  const byFirst = (a: Business, b: Business) => (a.application?.firstSubmittedAt ?? a.application?.submittedAt ?? '').localeCompare(b.application?.firstSubmittedAt ?? b.application?.submittedAt ?? '');
  const waiting = data.businesses.filter(pendingApplication).sort(byFirst), refused = data.businesses.filter(b => b.application?.status === 'rejected').sort(byFirst);
  const names = new Map(data.businesses.map(b => [b.tenantId, b.name]));
  /** Every page change starts at the top, without an old message hanging over it. */
  const go = (next: Page) => { if (busy) return; returnTo.current = null; setSecurityPending(''); setPageName(next); setSelectedBusiness(''); setNotice(''); if (!uncertain) setError(''); top.current?.scrollTo?.(0, 0); window.scrollTo?.(0, 0); };
  /**
   * "İki adımlı doğrulamayı aç" from the step-up box (prices, packages, payments, Hizmet, Lisans, Duyurular) or the
   * Güncellemeler card: straight to Ayarlar → Hesap güvenliği with the setup in front, remembering where the vendor was.
   * Not through `go`: the refused change may still be finishing (busy) and `go` ignores clicks then; that was the bug.
   */
  const openSecurity = (label: string) => {
    returnTo.current = { page, section: settingsSection, tenantId: selectedBusiness, tab: detailTab, label, armed: false };
    if (selectedBusiness && detailTab === 'service') holdServiceDraft(selectedBusiness);
    toSecurity.current = busy;
    setSecurityPending(label); setSettingsSection('security'); setPageName('settings'); setSelectedBusiness(''); setCreating(false); setNotice(''); setError('');
    top.current?.scrollTo?.(0, 0); window.scrollTo?.(0, 0);
  };
  /** "Kaldığım yere dön" on Hesap güvenliği (without switching it on). */
  const backToPending = () => {
    const r = returnTo.current; if (!r) return;
    returnTo.current = null; setSecurityPending('');
    setPageName(r.page); setSettingsSection(r.section); setSelectedBusiness(r.tenantId); setDetailTab(r.tab); setNotice(''); setError('');
  };
  const showList = (f: BusinessFilter) => { go('businesses'); setQuery(''); setFilter(f); setListPage(1); };
  const open = (id: string, tab: DetailTab = 'summary') => { setError(''); setNotice(''); setSelectedBusiness(id); setDetailTab(tab); window.scrollTo?.(0, 0); };
  const openTicket = (id: string, tenantId?: string) => { setSupportBusinessId(tenantId ?? ''); setTicketId(id); go('support'); };
  const openSettings = (section: SettingsSection) => { setSettingsSection(section); go('settings'); };  const invoiceProblems = !withInvoice ? [] : [!validTaxNumber(invoice.taxType, invoice.taxNumber.replace(/\D/g, '')) && 'Vergi / T.C. kimlik numarası geçersiz.', !normalPhone(invoice.phone) && 'Cep telefonu geçersiz.', !validEmail(invoice.email) && 'E-posta geçersiz.'].filter(Boolean) as string[];
  const invoiceInput = (label: string, field: keyof Invoice, props: { maxLength: number; minLength?: number }) => <label>{label}<input required disabled={disabled} value={invoice[field]} onChange={e => setInvoice({ ...invoice, [field]: e.target.value })} {...props} /></label>;
  const current: Page = selected ? 'businesses' : page;
  // 13 Ekim: Paketler is a place of its own (Hizmet fiyatları its sub-tab); Destek sits at the bottom, right above Ayarlar.
  const nav: [Page, string, ReactNode, number][] = [['today', 'Bugün', <Sun size={18} key="i" />, 0], ['businesses', 'İşletmeler', <Building2 size={18} key="i" />, 0], ['applications', 'Başvurular', <Inbox size={18} key="i" />, waiting.length + (siteLeads.counts?.new ?? 0)], ['announcements', 'Duyurular', <Megaphone size={18} key="i" />, 0], ['sales', 'Satışlarım', <ReceiptText size={18} key="i" />, 0], ['packages', 'Paketler', <Package size={18} key="i" />, 0]];
  const pinned: [Page, string, ReactNode, number][] = [['support', 'Destek', <LifeBuoy size={18} key="i" />, openTickets], ['settings', 'Ayarlar', <Settings size={18} key="i" />, 0]];
  // İşletme ekle: the package to start with (Kafe Standart unless chosen; a trial has everything open anyway).
  const packageChoices = data.catalog ? offeredPackages(data.catalog) : [], startPackage = packageChoices.some(p => p.id === packageId) ? packageId : (packageChoices.find(p => p.id === 'kafe-standart') ?? packageChoices[0])?.id ?? '';
  // Phones (under 600 px): six places fit the top strip; Duyurular and Paketler move next to the bell (`yonetim-topbar-icon`).
  const navButton = ([id, title, icon, badge]: [Page, string, ReactNode, number]) => <button type="button" key={id} aria-label={title} title={badge > 0 ? `${title}: ${badge} bekliyor` : undefined} aria-current={current === id ? 'page' : undefined} className={`${current === id ? 'active' : ''}${id === 'announcements' ? ' nav-announcements' : id === 'packages' ? ' nav-packages' : ''}`} disabled={busy} onClick={() => go(id)}>{icon}<span>{title}</span>{badge > 0 && <span className="nav-badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}</button>;
  const topIcon = (id: Page, title: string, icon: ReactNode, extra: string) => <button type="button" className={`icon-btn yonetim-topbar-icon ${extra}${current === id ? ' active' : ''}`} aria-label={title} title={title} aria-current={current === id ? 'page' : undefined} disabled={busy} onClick={() => go(id)}>{icon}</button>;
  return <main className="platform-page platform-v2 yonetim">
    <aside className="yonetim-sidebar">
      <div className="yonetim-brand"><YonetimBrand light /></div>
      <nav className="yonetim-nav" aria-label="Mola Yönetim bölümleri">{nav.map(navButton)}<span className="yonetim-nav-gap" aria-hidden="true" />{pinned.map(navButton)}</nav>
      {devBadge && <span className="platform-local-note" title="Mola Merkez proje klasöründen (npm run merkez) çalışıyor. Kurulu Mola Yönetim’de bu etiket görünmez.">Yerel test ortamı</span>}
    </aside>
    <div className="yonetim-main" ref={top}><div className="yonetim-column">
      <header className="yonetim-topbar"><span className="yonetim-topbar-brand" aria-hidden="true"><YonetimBrand /></span><div className="yonetim-topbar-actions">{topIcon('packages', 'Paketler', <Package size={20} aria-hidden="true" />, 'yonetim-topbar-packages')}{topIcon('announcements', 'Duyurular', <Megaphone size={20} aria-hidden="true" />, 'yonetim-topbar-announce')}<AlertBell unread={data.unread} onOpen={() => go('alerts')} /><button type="button" className="btn secondary small-btn" disabled={busy || uncertain} onClick={() => void logout()}><LogOut size={15} aria-hidden="true" /><span className="yonetim-logout-text">Çıkış yap</span></button></div></header>
      <section className="platform-content" aria-label="Seçili bölüm">
        {((error && !creating) || notice || (uncertain && !creating)) && <div className="yonetim-flash">
          {error && !creating && <Notice tone="error">{error}</Notice>}{uncertain && !creating && <button className="btn primary retry-btn" disabled={busy} onClick={() => void mutate()}>İşlemi yeniden kontrol et</button>}
          {notice && <Notice tone="success">{notice}</Notice>}</div>}
        {selected ? <BusinessDetail key={selected.tenantId} business={selected} catalog={data.catalog} tickets={data.tickets} audit={data.audit} tab={detailTab} onTab={setDetailTab} disabled={disabled} busy={busy}
          mutate={(path, body) => mutate(path, body)} onReload={() => void load()} onNewCode={() => void mutate(`${ADMIN}/codes`, { tenantId: selected.tenantId })} onOpen={id => open(id)}
          onOpenTicket={id => setTicketId(id)} onAllTickets={() => { setSupportBusinessId(selected.tenantId); setTicketId(''); go('support'); }} onBack={() => go('businesses')} />
        : page === 'today' ? <PlatformToday businesses={data.businesses} tickets={data.tickets} onApplications={() => go('applications')} onTicket={openTicket} onBusiness={open} onSettings={openSettings} onFilter={showList} siteLeads={siteLeads.counts?.new ?? 0} onSiteLeads={() => { setApplicationKind('web'); go('applications'); }} />
        : page === 'businesses' ? <>
          <header className="page-head"><div><h1>İşletmeler</h1><p className="page-lead">Her kutu bir işletme: durumu, lisansı ve son bağlantısı. Açmak için kutuya dokunun.</p></div></header>
          <BusinessFilters order={businessOrder} onOrderChange={value => { setBusinessOrder(value); setListPage(1); }} total={directory.length} query={query} filter={filter} count={filtered.length} onChange={(q, f) => { setQuery(q); setFilter(f); setListPage(1); }}
            extra={<button type="button" className="text-btn platform-csv" onClick={() => download(`mola-isletmeler-${localDay()}.csv`, businessesCsv(filtered))}><Download size={15} />CSV indir</button>} />
          <BusinessTiles items={visible} onOpen={id => open(id)} onAdd={() => { fromLead.current = null; setError(''); setCreating(true); }} addDisabled={disabled} />
          {!filtered.length && <p className="platform-empty">{directory.length ? 'Bu aramaya uygun işletme bulunamadı.' : 'Henüz işletme yok. İşletmeler Mola’dan “Hesap açma başvurusu” gönderir; ya da “İşletme ekle” ile etkinleştirme kodu oluşturabilirsiniz.'}</p>}
          {pageCount > 1 && <nav className="platform-pager" aria-label="İşletme sayfaları"><button className="btn secondary small-btn" disabled={currentPage === 1} onClick={() => setListPage(currentPage - 1)}>Önceki sayfa</button><span>Sayfa {currentPage} / {pageCount}</span><button className="btn secondary small-btn" disabled={currentPage === pageCount} onClick={() => setListPage(currentPage + 1)}>Sonraki sayfa</button></nav>}
        </>
        : page === 'applications' ? <>
          <header className="page-head"><div><h1>Başvurular</h1><p className="page-lead">{waiting.length ? `${waiting.length} başvuru onay bekliyor. Onaylarsanız 30 günlük deneme başlar; işletmenin bilgisayarı birkaç saniye içinde devam eder.` : 'Onay bekleyen başvuru yok.'}</p></div></header>
          {!!siteLeads.leads?.length && <div className="platform-pills application-kinds" role="group" aria-label="Başvuru türü">{([['all', 'Tümü', waiting.length + refused.length + (siteLeads.counts?.open ?? 0)], ['applications', 'Hesap açma başvuruları', waiting.length + refused.length], ['web', 'Web sitesi talepleri', siteLeads.counts?.open ?? 0]] as const).map(([id, title, n]) => <button type="button" key={id} className={applicationKind === id ? 'active' : ''} aria-pressed={applicationKind === id} onClick={() => setApplicationKind(id)}>{title}<span className="pill-count">{n}</span></button>)}</div>}
          {applicationKind !== 'web' && <>
          {waiting.length > 0 && <ApplicationList items={waiting} disabled={disabled} mutate={(path, body) => mutate(path, body)} onOpen={id => open(id)} />}
          {refused.length > 0 && <section className="page-section" aria-label="Düzeltme bekleyenler"><h2 className="page-subhead">Düzeltme bekleyenler</h2><p className="page-lead">Reddedilen başvurular: işletme bilgileri düzeltip yeniden gönderince yukarıya geçer.</p><ApplicationList label="Reddedilen başvurular" items={refused} disabled={disabled} mutate={(path, body) => mutate(path, body)} onOpen={id => open(id)} /></section>}
          </>}
          {applicationKind !== 'applications' && !!siteLeads.leads?.length && <section className="page-section" aria-label="Web sitesi talepleri"><h2 className="page-subhead">Web sitesi talepleri</h2><p className="page-lead">molayazilim.com.tr’deki formdan gelenler: henüz Mola kurulumu olmayan, aranmayı bekleyen kişiler. Arayınca “Arandı”, iş bitince “Kapandı” deyin; deneme başlatacaksanız “İşletme ekle”.</p>
            <SiteLeadList leads={siteLeads.leads} disabled={disabled} onChanged={() => siteLeads.reload()} onOpenBusiness={id => open(id)} businessName={id => names.get(id)}
              onAddBusiness={p => { fromLead.current = p; setName(p.name); setContactName(p.contactName); setSector(p.sector ?? ''); setError(''); setCreating(true); }} /></section>}
        </>
        : page === 'support' ? <>
          <header className="page-head"><div><h1>Destek</h1><p className="page-lead">İşletmelerin destek talepleri ve hata kayıtları. Bir talebe dokunun, konuşma açılır.</p></div></header>
          <TicketChat side="support" tickets={data.tickets} selected={ticketId} onSelect={setTicketId} onSaved={() => load()} events={ticketEvents} names={names} businesses={data.businesses} businessId={supportBusinessId} onBusinessChange={setSupportBusinessId} initialFilter="open"
            businessLabel={id => { const b = data.businesses.find(l => l.tenantId === id); return b && <BusinessPeek business={b} onOpen={tab => { setTicketId(''); open(b.tenantId, tab); }} />; }}
            headerExtra={t => { const b = data.businesses.find(l => l.tenantId === t.tenantId); return b && <><button type="button" className="text-btn tc-business-link" aria-label={`${b.name} işletme sayfası`} onClick={() => { setTicketId(''); open(b.tenantId); }}>İşletme sayfası<ChevronRight size={15} aria-hidden="true" /></button><span className="muted small">{planText(b)}{b.endsAt ? ` · bitiş ${shortDate(b.endsAt)}` : ''}</span><ContactLinks phone={b.invoice?.phone} email={b.invoice?.email} name={b.contactName} /></>; }} />
          <PlatformDiagnostics businesses={data.businesses} />
        </>
        : page === 'announcements' ? <PlatformAnnouncements businesses={data.businesses} catalog={data.catalog} disabled={disabled} />
        : page === 'sales' ? <PlatformSales disabled={disabled} />
        : page === 'packages' ? <PlatformCatalogPage tab={packagesTab} onTab={setPackagesTab} onChanged={() => void load()} />
        : page === 'settings' ? <PlatformSettings section={settingsSection} onSection={setSettingsSection} disabled={disabled} onSessionEnd={endSession} onOpenBusiness={id => { setPageName('businesses'); open(id); }}
            security={{ pending: settingsSection === 'security' ? securityPending || undefined : undefined, onBack: securityPending ? backToPending : undefined, onEnabled: () => { if (returnTo.current) returnTo.current.armed = true; }, onAsk: openSecurity }} />
        : <AlertCenter alerts={data.alerts} names={names} ticketIds={new Set(data.tickets.map(t => t.id))} onChanged={() => void load()} onOpenBusiness={(id, tab) => { setPageName('businesses'); open(id, tab); }} onOpenTicket={(id, tenantId) => openTicket(id, tenantId)} onEmail={() => openSettings('email')} onOpenSiteLeads={() => { setApplicationKind('web'); go('applications'); }} />}
      </section>
      <footer className="yonetim-footer" aria-label="Sürüm"><AppVersion product="Mola Yönetim" merkez={data.version} /></footer>
    </div></div>
    <PlatformKeyCard onOpenBackup={() => openSettings('backup')} />
    <StepUpDialog onSecurity={openSecurity} />
    {creating && <Modal title="İşletme ekle" className="platform-create-dialog" wide dismissible={!disabled} onClose={() => setCreating(false)}><form className="platform-create-form" onSubmit={e => { e.preventDefault(); setInvoiceTried(true); if (invoiceProblems.length) return; void mutate(`${ADMIN}/businesses`, { name, ...(contactName.trim() ? { contactName } : {}), ...(sector ? { sector } : {}), ...(startPackage ? { packageId: startPackage } : {}), ...(plan === 'trial' ? { kind: 'trial' } : { kind: 'subscription', months: Number(plan) }), ...(withInvoice ? { invoice: { ...invoice, taxNumber: invoice.taxNumber.replace(/\D/g, ''), phone: normalPhone(invoice.phone), email: invoice.email.trim() } } : {}) }); }}><div className="platform-create-fields">
      <section className="platform-create-section"><h3><Building2 size={17} /> İşletme</h3><div className="form-columns"><label>İşletme adı<input required minLength={2} maxLength={80} disabled={disabled} value={name} onChange={e => setName(e.target.value)} /></label><label>Yetkili adı <span className="muted small">(isteğe bağlı)</span><input maxLength={80} disabled={disabled} value={contactName} onChange={e => setContactName(e.target.value)} /></label></div>
        <div className="create-sector"><span className="create-sector-label"><Store size={15} />İşletme türü <span className="muted small">(isteğe bağlı)</span></span><div className="platform-pills" role="group" aria-label="İşletme türü">{sectors.map(s => <button type="button" key={s} disabled={disabled} className={sector === s ? 'active' : ''} aria-pressed={sector === s} onClick={() => setSector(sector === s ? '' : s)}>{sectorNames[s]}</button>)}</div><p className="muted small">Seçerseniz sahibin ilk kurulumunda bu tür ve başlangıç menüsü seçili gelir; sahibi yine değiştirebilir.</p></div></section>
      <section className="platform-create-section"><h3><CalendarDays size={17} /> Deneme veya abonelik</h3><div className="form-columns"><label>Lisans türü<select disabled={disabled} value={plan} onChange={e => setPlan(e.target.value)}><option value="trial">30 gün ücretsiz deneme</option><option value="1">1 aylık abonelik</option><option value="6">6 aylık abonelik</option><option value="12">1 yıllık abonelik</option></select></label></div>
        <div className="plan-choice package-choice" role="radiogroup" aria-label="Hizmet paketi">{packageChoices.map(p => <button type="button" role="radio" aria-checked={startPackage === p.id} key={p.id} className={startPackage === p.id ? 'selected' : ''} disabled={disabled} onClick={() => setPackageId(p.id)}><strong>{p.name}</strong><small>{money(p.price.monthly)}/ay · {p.features.length} hizmet</small><FeatureChips ids={p.features} max={4} /></button>)}</div>
        <p className="muted small">Süre, işletme kodu girip Mola’yı etkinleştirdiği anda başlar. Denemede bütün hizmetler açıktır; paket deneme bitince geçerli olur ve sonra işletmenin Hizmet bölümünden değiştirilebilir. Deneme kendiliğinden ücretli aboneliğe geçmez.</p></section>
      <section className="platform-create-section"><h3><FileText size={17} /> Fatura bilgileri <span className="muted small">(isteğe bağlı)</span></h3>
        <label className="checkbox-line"><input type="checkbox" checked={withInvoice} disabled={disabled} onChange={e => setWithInvoice(e.target.checked)} />Fatura bilgilerini şimdi gir (e-arşiv için; sonra işletmenin Bilgiler bölümünden de girilebilir)</label>
        {withInvoice && <div className="invoice-edit">
          <label>Mükellef türü<select disabled={disabled} value={invoice.taxType} onChange={e => setInvoice({ ...invoice, taxType: e.target.value as TaxType })}><option value="company">Şirket</option><option value="person">Şahıs işletmesi</option></select></label>
          {invoiceInput('Ticari unvan', 'legalName', { minLength: 3, maxLength: 200 })}{invoiceInput('Vergi dairesi', 'taxOffice', { minLength: 2, maxLength: 60 })}
          {invoiceInput(invoice.taxType === 'company' ? 'Vergi kimlik no' : 'T.C. kimlik no', 'taxNumber', { maxLength: 11 })}{invoiceInput('İl', 'city', { minLength: 2, maxLength: 40 })}{invoiceInput('İlçe', 'district', { minLength: 2, maxLength: 60 })}
          {invoiceInput('Açık adres', 'address', { minLength: 5, maxLength: 300 })}{invoiceInput('Cep telefonu', 'phone', { maxLength: 20 })}{invoiceInput('E-posta', 'email', { maxLength: 120 })}
          {invoiceTried && invoiceProblems.length > 0 && <Notice tone="error">{invoiceProblems.join(' ')}</Notice>}
        </div>}</section>
      <section className="platform-create-section"><h3><KeyRound size={17} /> Etkinleştirme kodu</h3><p className="muted small">İşletme oluşunca tek kullanımlık bir kod gösterilir; 14 gün geçerlidir. Kod Mola Yönetim’e değil, kafenin bilgisayarındaki Mola’ya girilir: ilk açılışta “Mola’yı etkinleştir” ekranında “Etkinleştirme kodum var”. Kaybolursa işletmenin Lisans bölümünden yenisini oluşturabilirsiniz.</p></section>
      {error && <Notice tone="error">{error}</Notice>}{uncertain && <button type="button" className="btn secondary" disabled={busy} onClick={() => void mutate()}>İşlemi yeniden kontrol et</button>}
    </div><div className="platform-create-actions"><button type="button" className="btn secondary" disabled={disabled} onClick={() => setCreating(false)}>Vazgeç</button><button className="btn primary" disabled={disabled}>{busy ? 'Oluşturuluyor…' : 'İşletmeyi oluştur'}</button></div></form></Modal>}
    {/* The code once, where it goes (the café's computer, not Mola Yönetim), and ways to hand it over (src/PlatformActivationHelp.tsx). */}
    {issued && <Modal title="Etkinleştirme kodu" wide onClose={() => setIssued(null)}><div className="modal-body activation-code-dialog">
      <p><strong>{issued.name}</strong> için tek kullanımlık kod:</p>
      <p className="activation-code" data-testid="activation-code">{issued.code}</p>
      <p className="muted small">Bu kod yalnız şimdi gösterilir; {dateTime(issued.codeExpiresAt)} tarihine kadar geçerlidir. Kaybolursa işletmenin Lisans bölümünden yenisini oluşturun.</p>
      <CodeShare name={issued.name} code={issued.code} expiresAt={issued.codeExpiresAt} phone={issued.phone} />
      <ActivationSteps code={issued.code} />
      <div className="modal-actions"><button type="button" className="btn primary" onClick={() => setIssued(null)}>Tamam</button></div>
    </div></Modal>}
  </main>;
}

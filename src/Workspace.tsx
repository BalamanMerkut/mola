// Mutfak modu (the kitchen's full-screen board) and the phone's bottom bar.
import { KitchenMode } from './KitchenMode';
import { BottomNav, useNarrow } from './BottomNav';
// Masalar, compact: the waiter's phone and the counter (src/FloorBar.tsx).
import { CompactTable, CounterFloorLine, FloorFilters, WaiterFloorLine, useTodaySales, type FloorFilter } from './FloorBar';
import { LoginFactor } from './LoginFactor';
import { AppVersion } from './AppVersion';
import { APP_VERSION } from './version';
import { DeferredPanel } from './DeferredPanel';
import { businessTheme, themeOnRoot } from './BusinessTheme';
import { TableAreaPicker, areaName } from './TableAreaPicker';
import { Plug } from 'lucide-react';
// The homes of the 10 Ekim düzeni (Kasa ve giderler, Personel, Menü yönetimi with Kampanyalar and KDV): src/Homes.tsx.
import { CashHome, MenuHome, StaffHome, type MenuOpening } from './Homes';
import type { CashOpening, StaffOpening } from './HomeBooks';
import { GO_EVENT, type GoTo } from './navigate';
import { NotificationInbox } from './NotificationInbox';
import { Support } from './Support';
import { Megaphone } from 'lucide-react';
import { AnnouncementList, ImportantAnnouncement, useAnnouncements } from './Announcements';
import { Activation } from './Activation';
import { PaymentModal } from './PaymentModal';
import { paymentStorage, readPendingPayment, type PaymentTable, type PendingPayment } from './pendingPayment';
import { TableTransfer } from './TableTransfer';
import { ExpenseForm } from './ExpenseForm';
import { ApprovalQueue } from './ApprovalQueue';
// QR siparişleri açık mı (8 Ekim; 10 Ekim: the sidebar card, the strip on Masalar and the phone line, src/QrOrdering.tsx).
import { QrOrderingBar, QrOrderingCard } from './QrOrdering';
import { MenuPreview, MenuPreviewPage } from './MenuPreview';
import { CategoryManagement } from './CategoryManagement';
import { TableManagement } from './TableManagement';
import { OrderEditor, EditOrderButton } from './OrderEditor';
import { OrderEditRecovery } from './OrderEditRecovery';
import { CancelRecovery } from './CancelRecovery';
import { pendingCancelKey, readPendingCancel, writePendingCancel, type PendingCancel } from './pendingCancel';
import { pendingEditKey, readPendingEdit } from './pendingEdit';
import { browserOrderStorage } from './pendingOrder';
import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Bell, Check, ChartColumn, ChefHat, ChevronRight, Coffee, HandPlatter, LayoutGrid, LifeBuoy, LogOut, Plus, QrCode, ReceiptText, Settings, ShieldCheck, ShoppingBag, UserRound, Users, Wallet, Wifi, WifiOff, X } from 'lucide-react';
import { Banknote, ChevronDown } from 'lucide-react';
import './daily-screens.css';
import { QrAddressNotice, qrOrigin, recordQrOrigin, tableQrUrl, type Network } from './SettingsQr';
import { tableQrPng } from './tableQrCard';
import QRCode from 'qrcode';
import { ProductEditor } from './ProductEditor';
import { ChangePassword } from './Administration';
import { FirstSetup } from './SetupWizard';
import { FirstSteps } from './FirstSteps';
import { ForgotPasswordHelp, InstallHint } from './LoginHelp';
import { FinancialAccess } from './ReportSecurity';
import { assignmentRings, callLabel, FloorAlerts, ServiceCallBar, servable, splitReady, TableReminders } from './ServiceCallBar';
import { isManagement } from '../packages/domain/roles';
import { navAllowed } from './roleNav';
import { DeliverAll, DeliverOrder, hiddenInTicketMode, PrintAlerts } from './KitchenTickets';
import { forgetAlerts } from './sounds';
import { basketKey, readLastTable, writeLastTable } from './staffBasket';
import { BellRing, ConciergeBell, Printer } from 'lucide-react';
import { NoTableChoice, TakeawayDetail, TakeawayOrder, TakeawayStrip } from './Takeaway';
import { isTakeaway, takeawayHeading } from '../packages/domain/takeaway';
import type { GuestSnapshot, Product, PublicOrder, Role, StaffSnapshot, TableView } from '../packages/domain/types';
import { api, ApiError, money, poll, requestId } from './api';
import { useDevelopment } from './serverMode';
import { StaffCancel, canCancel, orderCancellable } from './StaffCancel';
// Garson siparişi değiştirir (11 Ekim): "Değiştir" on an order, "Değişti: Kola → Ayran" under it (src/StaffChange.tsx).
import { ChangeOpener, changeLine, OrderChanges, StaffChange } from './StaffChange';
import { canChangeLines } from '../packages/domain/order-change';
import { orderedAreas, sectionHeading } from '../packages/domain/table-sections';
import { Brand, Composer, Empty, Modal, Notice, OrderLines, PackedBadge, Status } from './components';
import { ExternalCancel, ExternalInbox, PlatformDetails, PlatformHeading } from './ExternalOrders';

const SalesReports = lazy(() => import('./SalesReports').then(module => ({ default: module.SalesReports })));
import type { ReportsOpening, ReportTab } from './SalesReports';
/** A report id of now or of the earlier reports (its own copy: SalesReports loads only when opened). */
const REPORT_TABS: ReportTab[] = ['summary', 'products', 'profit', 'campaigns', 'employees', 'reservations'];
const reportTabOf = (v?: string): ReportTab | null => !v ? 'summary' : (REPORT_TABS as string[]).includes(v) ? v as ReportTab : v === 'staff' ? 'employees' : ['cash', 'expenses', 'corrections', 'money'].includes(v) ? 'summary' : null;
// Stok (owner; the cashier reads Ürünler and Malzemeler): src/Stock.tsx.
const Stock = lazy(() => import('./Stock').then(module => ({ default: module.Stock })));
import type { StockOpening } from './Stock';
import { Package } from 'lucide-react';
// Ajanda ve rezervasyon (Takvim, Rezervasyonlar, Etkinlikler; src/AgendaHub.tsx) and the unread dot / banner of Bildirimler (üst çubuktaki zil).
const AgendaHub = lazy(() => import('./AgendaHub').then(module => ({ default: module.AgendaHub })));
// On Masalar: reserved tables, "Geldi mi?", event tables, walk-in names (src/ReservationFloor.tsx).
import { DepositClose, EventSections, floorParts, NormalTablesToggle, ReservationQuestions, TableBadge, TablePanel, useClock } from './ReservationFloor';
import { CalendarDays } from 'lucide-react';
import { notificationAction, notificationsChanged, useUnreadNotifications, type RecentNotification } from './notificationCount';
// A new notification while the screen is open: a toast under the bell (10 Ekim).
import { NotificationToasts } from './NotificationToasts';
import { bellCount, notificationActionOf } from './notificationActions';
// Otomatik güncelleme: "Yeni sürüm hazır" for the owner (server/update-routes.ts).
import { UpdateBanner } from './UpdateBanner';
// Gün sonu kasası on Masalar (owner, cashier) and vardiya takibi (src/CashDay.tsx, src/Shifts.tsx).
import { CashDayPanel } from './CashDay';
import { TillNotices } from './TillNotices';
// "Ödemeyi düzelt" opens Kasa ve giderler → İadeler on the payment's business day (05:00–05:00), like every report.
import { cashDayOf } from '../packages/domain/cash';
import { dayStartText } from '../packages/domain/business-day';
import { saatEki } from '../packages/domain/saat-eki';
import { ShiftChip, ShiftGate, useShift, usePreShiftNotice } from './Shifts';
import type { SupportTab } from './Support';
import type { SettingsOpening } from './SettingsPanel';
// "Tanıtım" label of a demo business (server/demo-reset.ts).
import { DemoBadge } from './DemoBadge';
// Uzaktan destek: Mola destek's own small workspace through Mola Merkez, and "Mola ekibi bağlı" on staff screens.
import { RemoteSupportWorkspace, SupportEnded } from './RemoteSupportWorkspace';
// Sahip hesabı otomatik kilit: the lock screen over the owner's page, and "Kilitle" (src/OwnerLock.tsx).
import { lockNow, OwnerLock } from './OwnerLock';
import { Lock } from 'lucide-react';
// Hizmet paketi: faded places for the owner and the Müdür, the blurred page and its card, "Mola ekibine yaz" (src/FeatureLock.tsx).
import { FeatureLockModal, FeatureLockView, LockedHint, PackageProvider, featureTicket, useFeatureEvents } from './FeatureLock';
import { TrialEndNotice } from './PackageCard';
import { OwnerAgreementPrompt } from './LicenseAgreement';
import { CampaignEnded } from './CampaignEnded';
import { pageLine } from './pageLines';
import { forgetAgreementLater } from './agreementPrompt';
import type { FeatureId } from '../packages/domain/feature-gate';
/** The main places that are one service each (Ajanda stays: its Takvim is core). */
const NAV_FEATURE: Partial<Record<string, FeatureId>> = { stock: 'stock', integrations: 'integrations' };
import './remote-support.css';
const SettingsPanel = lazy(() => import('./SettingsPanel').then(module => ({ default: module.SettingsPanel })));
const Integrations = lazy(() => import('./Integrations').then(module => ({ default: module.Integrations })));
const roles: Record<Role, string> = { owner: 'İşletme sahibi', manager: 'Müdür', cashier: 'Kasiyer', waiter: 'Garson', kitchen: 'Mutfak', support: 'Mola destek' };
const stageNames = { new: 'Yeni', preparing: 'Hazırlanıyor', ready: 'Hazır' } as const;
/** Where a ready order is handed over, in the waiter's words; a platform order goes with the courier or at the counter. */
function handOver(o: PublicOrder) {
  if (o.external) return o.external.deliveryType === 'gel-al' ? 'Platform · gel-al · tezgâhta teslim' : 'Platform · kuryeye teslim';
  if (o.takeaway) return `Masasız · tezgâhta teslim${o.takeaway.label ? ` · ${o.takeaway.label}` : ''}`;
  return o.guestLabel;
}
/**
 * The menu in groups (10 Ekim düzeni): GÜNLÜK, İŞLETME, then the rarely opened ones without a heading. A role with no
 * İŞLETME place (cashier, waiter) sees no headings.
 */
const DAILY = new Set(['tables', 'ready', 'staff', 'cash', 'agenda', 'kitchen']), BUSINESS = new Set(['menu', 'stock', 'users', 'reports']);
// Integrations are still a demo: hidden from owners until a real platform is connected; a developer can turn it on in the browser.
const integrationsPreview = (() => { try { return localStorage.getItem('mola-integrations') === '1'; } catch { return false; } })();
/** "Mola ekibi bağlı": on every staff screen while a Mola destek session is open (server/support-session.ts). */
function SupportBanner({ since, owner, onOpen }: { since: string; owner: boolean; onOpen?: () => void }) {
  const at = new Date(since).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
  return <div className="support-banner" role="status"><span className="remote-live-dot" aria-hidden="true" /><p><strong>Mola ekibi bağlı</strong> ({saatEki(at, 'den')} beri). Menü ve ayarlara uzaktan bakıyor; satış ve para bilgilerini göremez.</p>{owner && onOpen && <button type="button" className="text-btn" onClick={onOpen}>Uzaktan erişim</button>}</div>;
}
/** `notice`: why the screen came back here (the business day ended at 05:00), said once above the form. */
function Login({ onLogin, notice }: { onLogin: () => void; notice?: string }) {
  // Developer wording only on a development server (src/serverMode.ts), never by address.
  const localDev = useDevelopment();
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [demo, setDemo] = useState<{ username: string; password: string } | null>(null);
  const [factorStep, setFactorStep] = useState(false), [factorCode, setFactorCode] = useState('');
  // Not linked to Mola Merkez yet: "Mola'yı etkinleştir" comes before the login (server/kafe-link.ts).
  const [activation, setActivation] = useState<string | null>(null);
  // The demo account comes from the server, only for a browser on the same computer; it is not part of the public page code.
  useEffect(() => { let live = true; void api<{ activation?: string; demo?: { username: string; password: string } }>('/api/health').then(r => { if (!live) return; setActivation(r.activation ?? 'ready'); if (r.demo) { const d = r.demo; setDemo(d); setUsername(v => v || d.username); setPassword(v => v || d.password); } }).catch(() => { if (live) setActivation('ready'); }); return () => { live = false; }; }, []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function login(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/api/login', { username, password, ...(factorStep ? { code: factorCode } : {}) }); setPassword(''); setFactorCode(''); onLogin(); } catch (e) { if (e instanceof ApiError && e.code === 'MFA_REQUIRED') { setFactorStep(true); setFactorCode(''); } else { setError((e as Error).message); if (e instanceof ApiError && e.code === 'INVALID_LOGIN') { setFactorStep(false); setFactorCode(''); } } } finally { setBusy(false); } }
  if (activation === null) return <div className="login-page" aria-busy="true" />;
  if (activation !== 'ready') return <Activation onReady={name => { setActivation('ready'); if (name) { setUsername(name); setPassword(''); onLogin(); } }} />;
  return <div className="login-page"><section className="login-story"><Brand light /><div className="login-title"><span className="eyebrow">HER ŞEY YERLİ YERİNDE</span><h1>Mutlu misafir.<br />Kolay işletme.</h1><p>Siparişler bir arada, masalar ve masasız siparişler kontrolünüzde.<br />Size, misafirlerinizle ilgilenmek kalsın.</p><div className="login-art"><ConciergeBell size={150} strokeWidth={.7} /><span>bir mola ver.</span></div></div><small>MOLA · MERKUT STUDIOS</small></section><section className="login-form-area"><div className="login-form">{localDev && <span className="dev-tag">YEREL TEST SÜRÜMÜ · {APP_VERSION}</span>}<h2>Hoş geldiniz.</h2><p className="muted">Çalışma alanınıza giriş yapın.</p>{notice && <Notice>{notice}</Notice>}<form onSubmit={e => void login(e)}>{factorStep ? <LoginFactor code={factorCode} onChange={setFactorCode} busy={busy} onBack={() => { setFactorStep(false); setFactorCode(''); setPassword(''); setError(''); }} /> : <><label>Kullanıcı adı<input aria-label="Kullanıcı adı" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label><label>Şifre<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label></>}{error && <Notice tone="error">{error}</Notice>}<button className="btn primary full" disabled={busy}>{busy ? 'Giriş yapılıyor…' : factorStep ? 'Doğrula ve giriş yap' : 'Çalışma alanını aç'}<ArrowRight size={18} /></button></form><ForgotPasswordHelp /><InstallHint />{demo && <div className="demo-help"><ShieldCheck size={20} /><p>Deneme hesabı hazır.<br /><span>Demo şifresi: <code>{demo.password}</code></span></p></div>}{localDev && <p className="muted small">Bu ortam deneme içindir. Gerçek müşteri ve ödeme bilgisi girmeyin.</p>}<AppVersion /></div></section></div>;
}

export function Workspace() {
  const [data, setData] = useState<StaffSnapshot | null>(null); const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading');
  // The palette colours the whole window (14 Ekim): its windows, the desktop rail and the page behind them too.
  useEffect(() => data?.theme ? themeOnRoot(data.theme) : undefined, [data?.theme]);
  const [view, setView] = useState('tables'); const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [connected, setConnected] = useState(true);
  const [expenseForm, setExpenseForm] = useState(false); const [cashierAddTable, setCashierAddTable] = useState<TableView | null>(null);
  const [menuPreview, setMenuPreview] = useState(false); const [takeawayOpen, setTakeawayOpen] = useState(false);
  const [categoryManagement, setCategoryManagement] = useState(false);
  const [tableManagement, setTableManagement] = useState<'add' | 'remove' | null>(null);
  const [movingTable, setMovingTable] = useState<TableView | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null); const [qr, setQr] = useState<TableView | null>(null); const [payment, setPayment] = useState<{ context: string; table: PaymentTable; restored?: PendingPayment } | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null); const [tableFilter, setTableFilter] = useState('all'); const [staffTable, setStaffTable] = useState('');
  // Links into the homes (src/navigate.ts goTo): each opening carries a key so the same link pressed twice lands again.
  const [reportsAt, setReportsAt] = useState<ReportsOpening | null>(null), [cashAt, setCashAt] = useState<CashOpening | null>(null);
  const [staffAt, setStaffAt] = useState<StaffOpening | null>(null), [menuAt, setMenuAt] = useState<MenuOpening | null>(null);
  // Kasa ve giderler → Bugün: where the cash panel (src/CashDay.tsx) draws its strip.
  const [todaySlot, setTodaySlot] = useState<HTMLElement | null>(null);
  // Kârlılık → "Reçete ekle": Stok opens on that product's recipe.
  const [stockAt, setStockAt] = useState<StockOpening | null>(null);
  // Links into Ayarlar land on their topic: "QR'ları yeniden yazdır" on the QR card, İlk adımlar' "Yazıcı bağla" on Yazıcılar.
  const [settingsAt, setSettingsAt] = useState<SettingsOpening | null>(null);
  // Destek's sub-tab, the day (or Ayarlar tab) Ajanda opens on, and the unread count the banner was closed at.
  const [supportTab, setSupportTab] = useState<SupportTab>('tickets'), [agendaDay, setAgendaDay] = useState<{ key: number; day?: string; part?: 'settings' } | null>(null);
  const [bannerClosedAt, setBannerClosedAt] = useState(0);
  // Hizmet paketi: the card over the screen for a faded button, and Destek's new ticket prefilled for a service.
  const [lockOpen, setLockOpen] = useState<FeatureId | null>(null), [supportDraft, setSupportDraft] = useState<{ key: number; subject: string; text: string } | null>(null);
  useFeatureEvents(id => setLockOpen(id), id => { const d = dataRef.current; if (d?.role !== 'owner') { setLockOpen(id); return; } setLockOpen(null); setSupportDraft({ key: Date.now(), ...featureTicket(id, d.name, d.pkg?.name, d.pkg?.enabled) }); setSupportTab('tickets'); setView('support'); });
  const dataRef = useRef<StaffSnapshot | null>(null); dataRef.current = data;
  // Masalar: the device clock for reservation phases, and "Normal masaları göster" while an event hides them.
  const clockNow = useClock(10_000), [showNormal, setShowNormal] = useState(false);
  const notes = useUnreadNotifications(auth === 'in' && (data?.role === 'owner' || data?.role === 'manager') && !!data.setupCompleted), unread = notes.unread;
  // Duyurular (src/Announcements.tsx): the owner's and the Müdür's; the owner's Önemli window comes from the same look.
  const announcements = useAnnouncements(auth === 'in' && ((data?.role === 'owner' && !!data.setupCompleted) || data?.role === 'manager'));
  const unreadAnnouncements = announcements?.unread ?? 0;
  const shift = useShift(auth === 'in' ? data?.role : undefined);
  // "Vardiya başlamadan N sipariş geldi": once, right after this device starts the shift (src/Shifts.tsx).
  const preShift = usePreShiftNotice(data);
  const reads = useRef({ sequence: 0, pending: 0, enabled: true, mounted: true, tag: '' });
  const [loggingOut, setLoggingOut] = useState(false);
  const localDev = useDevelopment();
  // Phone-wide (bottom bar, the waiter's compact screens) and counter-wide (≥ 900 px: the owner's and cashier's compact Masalar).
  const narrow = useNarrow(), counterWide = useNarrow('(min-width: 900px)');
  // Where the counter's head shows the cash chip (src/CashDay.tsx renders into it).
  const [cashSlot, setCashSlot] = useState<HTMLElement | null>(null);
  const todaySales = useTodaySales(auth === 'in' && data?.role === 'owner' && view === 'tables' && counterWide);
  // Staff cancellation window (waiter, kitchen, owner) and the masasız ticket whose payment opens right after sending.
  const [cancelling, setCancelling] = useState<PublicOrder | null>(null), [payAfterSend, setPayAfterSend] = useState('');
  // The waiter's "Değiştir" window (one line of an order) and a slip that did not print, for "Tekrar bas" next to its error.
  const [changing, setChanging] = useState<PublicOrder | null>(null), [showOthers, setShowOthers] = useState(false);
  const [printRetry, setPrintRetry] = useState<{ path: string; body: unknown; message: string } | null>(null);
  // 05:00: the sign-in ends with the business day. `sessionEnd` is when (from the snapshot), `endNotice` the login's explanation.
  const sessionEnd = useRef(0), [endNotice, setEndNotice] = useState('');
  // The kitchen board (its stage tabs, "Geri al", İPTAL strip and tap guard) lives in Mutfak modu: src/KitchenMode.tsx.
  const load = useCallback(async (background = false) => {
    const guard = reads.current;
    if (!guard.mounted || !guard.enabled || (background && guard.pending > 0)) return;
    const sequence = ++guard.sequence;
    guard.pending++;
    const current = () => guard.mounted && guard.enabled && sequence === guard.sequence;
    try {
      const fresh = await poll<StaffSnapshot>('/api/staff/state', guard.tag);
      if (!current()) return;
      // null: the snapshot on screen is still current; only the connection state needs refreshing.
      if (fresh) { setData(fresh.data); guard.tag = fresh.tag; sessionEnd.current = Date.parse(fresh.data.sessionEndsAt ?? '') || 0; }
      setAuth('in'); setConnected(true);
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 401) {
        // Signed out at (or a few minutes around) the end of the business day: say why instead of a silent jump to the login.
        // The basket being written stays in this tab (src/staffBasket.ts) and comes back after signing in again.
        if (sessionEnd.current && Date.now() >= sessionEnd.current - 15 * 60_000) setEndNotice(`İş günü bitti (${dayStartText}). Yeniden giriş yapın.`);
        sessionEnd.current = 0; forgetAlerts('');
        guard.enabled = false; guard.tag = ''; setAuth('out'); setData(null);
      }
      else { setConnected(false); setError('Bağlantı kurulamadı. Son görülen bilgiler gösteriliyor.'); }
    } finally { guard.pending--; }
  }, []);
  async function logout() {
    if (!reads.current.enabled) return;
    reads.current.enabled = false; reads.current.sequence++;
    setLoggingOut(true); setError('');
    try {
      await api('/api/logout', {});
      if (!reads.current.mounted) return;
      reads.current.tag = ''; sessionEnd.current = 0; forgetAlerts(''); setAuth('out'); setData(null); setPayment(null); setActiveTable(null);
      setEditing(null); setQr(null); setToast('');
    } catch (e) {
      if (!reads.current.mounted) return;
      reads.current.enabled = true;
      setError((e as Error).message); void load();
    } finally { if (reads.current.mounted) setLoggingOut(false); }
  }
  useEffect(() => {
    if (auth !== 'in' || !data?.paymentContext) return;
    const restored = readPendingPayment(paymentStorage(), data.paymentContext);
    setPayment(restored ? { context: data.paymentContext, table: restored.table, restored } : null);
  }, [auth, data?.paymentContext]);
  // Masasız at the counter: right after sending, the payment window opens for that ticket ("Sonra öde" closes it).
  useEffect(() => {
    if (!payAfterSend || !data?.paymentContext) return;
    const ticket = data.takeaways?.find(t => t.id === payAfterSend);
    if (!ticket?.account) return;
    setPayAfterSend('');
    if (ticket.account.balance > 0) setPayment({ context: data.paymentContext, table: { name: ticket.name, account: ticket.account } });
  }, [payAfterSend, data]);
  const closeEditor = useCallback(() => setEditing(null), []);
  const saveEditor = useCallback((published: boolean) => { setEditing(null); setToast(published ? 'Ürün yayınlandı.' : 'Taslak kaydedildi. Ürün müşteri menüsünde gösterilmiyor.'); void load(); }, [load]);
  // Hidden tabs (another app in front, screen off) do not poll; coming back refreshes at once.
  useEffect(() => {
    reads.current.mounted = true; void load();
    const id = setInterval(() => { if (!document.hidden) void load(true); }, 2000);
    const back = () => { if (!document.hidden) void load(true); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', back); reads.current.mounted = false; reads.current.sequence++; };
  }, [load]);
  useEffect(() => {
    if (auth !== 'in' || !data || data.role === 'waiter') return;
    const beat = () => api('/api/staff/heartbeat', {}).catch(() => setConnected(false));
    void beat(); const id = setInterval(() => void beat(), 4000); return () => clearInterval(id);
  }, [auth, data?.role]);
  useEffect(() => { if (data?.role) setView(data.role === 'kitchen' ? 'kitchen' : 'tables'); }, [data?.role]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  /**
   * Opens a place from a link anywhere (src/navigate.ts goTo: "Gider kayıtlarını aç", "Taşındı → Git", a notification's
   * action, "Ödemeyi düzelt"). Each opening gets a new key, so the home lands on that tab even when it is already open.
   */
  const openPlace = useCallback((p: GoTo) => {
    const key = Date.now();
    setSupportDraft(null); setError(''); setReportsAt(null); setStockAt(null); setSettingsAt(null); setCashAt(null); setStaffAt(null); setMenuAt(null); setAgendaDay(null);
    if (p.view === 'cash') setCashAt({ key, tab: p.tab, part: p.part, q: p.q, day: p.day, focus: p.focus });
    else if (p.view === 'users') setStaffAt({ key, tab: p.tab, part: p.part });
    else if (p.view === 'menu') setMenuAt({ key, tab: p.tab, renew: p.renew });
    else if (p.view === 'reports') { const tab = reportTabOf(p.tab); if (tab) setReportsAt({ key, tab, campaign: p.campaign, margins: p.margins, send: p.send }); }
    else if (p.view === 'settings') setSettingsAt({ key, topic: p.topic as SettingsOpening['topic'], part: p.part as SettingsOpening['part'], qr: p.qr });
    else if (p.view === 'agenda') setAgendaDay({ key, day: p.day, part: p.part });
    else if (p.view === 'stock' && p.tab) setStockAt({ key, tab: p.tab as StockOpening['tab'], productId: p.productId });
    else if (p.view === 'support') setSupportTab((p.tab as SupportTab) ?? 'tickets');
    setView(p.view);
  }, []);
  useEffect(() => {
    const on = (e: Event) => openPlace((e as CustomEvent<GoTo>).detail);
    // The rail's "Gün sonuna git" (and every `mola:cash-close`): the closing window opens over Kasa ve giderler → Bugün.
    const close = () => { if (['owner', 'manager', 'cashier'].includes(dataRef.current?.role ?? '')) openPlace({ view: 'cash', tab: 'today' }); };
    window.addEventListener(GO_EVENT, on); window.addEventListener('mola:cash-close', close);
    return () => { window.removeEventListener(GO_EVENT, on); window.removeEventListener('mola:cash-close', close); };
  }, [openPlace]);
  // K-D (9 Ekim): a bill paid in full in cash closes its window; the change to hand over stays large for a few seconds.
  const [changeDue, setChangeDue] = useState(0);
  useEffect(() => { if (!changeDue) return; const t = setTimeout(() => setChangeDue(0), 8000); return () => clearTimeout(t); }, [changeDue]);
  // A new page starts at its top, not at the scroll position of the previous one.
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [view]);
  // The owner's table window: the section picker stays folded away unless the owner left it open last time.
  const [areaOpen, setAreaOpen] = useState(() => { try { return localStorage.getItem('mola-area-picker') === '1'; } catch { return false; } });
  const rememberArea = (open: boolean) => { setAreaOpen(open); try { localStorage.setItem('mola-area-picker', open ? '1' : '0'); } catch { /* preference only */ } };
  // A slip that did not print ("Yazıcıda kâğıt yok · Kasa…") keeps its request: the error line offers "Tekrar bas" (11 Ekim).
  async function action(path: string, body: unknown, message = 'İşlem kaydedildi.') { setError(''); setPrintRetry(null); try { await api(path, body); setToast(message); await load(); } catch (e) { setError((e as Error).message); if (path.startsWith('/api/staff/print/') && e instanceof ApiError && e.code === 'PRINTER_FAULT') { setPrintRetry({ path, body, message }); setActiveTable(null); window.scrollTo({ top: 0 }); } await load(); } }
  // Sipariş al reopens on the table this person was ordering for (also after the 05:00 sign-in); its basket comes back with it.
  // 9 Ekim kullanıcı testi (K-G): once an order is sent the table is no longer chosen (the next order could go to it unnoticed);
  // the waiter's phone goes back to Masalar, the counter stays on Sipariş al with "Önce bir masa seçin".
  const basketUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!data?.username) return;
    const last = readLastTable(data.username), exists = [...data.tables, ...(data.eventTables ?? []), ...(data.takeaways ?? [])].some(t => t.id === last);
    setStaffTable(current => current && basketUser.current === data.username ? current : exists ? last : '');
    basketUser.current = data.username;
  }, [data?.username]);
  useEffect(() => { if (basketUser.current) writeLastTable(basketUser.current, staffTable); }, [staffTable]);
  // A Mola destek session (the café's screens through Mola Merkez, /destek/<id>) has no sign-in: when it ends, it ended.
  if (auth === 'out' && location.pathname.startsWith('/destek/')) return <SupportEnded />;
  // A new sign-in: the agreement's "Daha sonra" of the previous one ends (src/agreementPrompt.ts).
  if (auth === 'out') return <Login notice={endNotice} onLogin={() => { reads.current.enabled = true; setEndNotice(''); forgetAgreementLater(); void load(); }} />;
  if (!data) return <div className="loading"><Brand /><p>Çalışma alanı hazırlanıyor…</p>{error && <Notice tone="error">{error}</Notice>}</div>;
  if (data.role === 'support') return <RemoteSupportWorkspace data={data} load={() => load()} onLogout={() => void logout()} loggingOut={loggingOut} connected={connected} />;
  if (data.role === 'owner' && !data.setupCompleted) return <><FirstSetup data={data} onSaved={() => { void load(); window.scrollTo(0, 0); setToast('İşletme ayarları kaydedildi.'); }} onLogout={() => void logout()} busy={loggingOut} /><OwnerLock name={data.displayName} onLogout={() => void logout()} /></>;
  // Vardiya takibi on: a waiter, cashier or kitchen account starts its shift with the counter's code before anything else.
  if (shift.blocked && shift.me) return <ShiftGate me={shift.me} name={data.displayName} busy={loggingOut} onLogout={() => void logout()} onStarted={started => { preShift.start(started); void shift.reload(); setToast('Vardiya başladı. İyi çalışmalar!'); void load(); }} />;
  // The most urgent state of a table, in the words staff use: what needs doing next.
  function tableState(t: TableView): { label: string; tone: string } {
    if (t.needsCleaning) return { label: 'Temizlik bekliyor', tone: 'needs-cleaning' };
    if (!t.account) return { label: 'Boş', tone: 'available' };
    const live = data!.orders.filter(o => o.accountId === t.account!.id && o.status !== 'cancelled');
    if (live.some(o => o.status === 'awaiting_approval')) return { label: 'Onay bekliyor', tone: 'waiting' };
    if (live.some(o => o.status === 'ready')) return { label: 'Servise hazır', tone: 'waiting' };
    // An order the kitchen has not started yet is new, not "preparing".
    if (live.some(o => o.status === 'new')) return { label: 'Yeni sipariş', tone: 'waiting' };
    if (live.some(o => o.status === 'preparing')) return { label: 'Hazırlanıyor', tone: 'waiting' };
    // Served and paid rounds older than 30 minutes are only counted (doneOrders), not listed.
    if (live.length || t.account.doneOrders) return { label: 'Teslim edildi', tone: 'served' };
    return { label: 'Sipariş yok', tone: 'available' };
  }
  const canMoveTable = ['owner', 'manager', 'cashier', 'waiter'].includes(data.role);
  // `manages`: the owner or the Müdür (menu, stock, campaigns, reports, refunds); `owner` alone: settings, staff, support.
  const cashier = ['owner', 'manager', 'cashier'].includes(data.role); const owner = data.role === 'owner', manages = isManagement(data.role);
  // Hizmet paketi: a place of a closed service is faded for the owner and the Müdür, gone for everyone else.
  const enabled = data.pkg?.enabled, has = (f: FeatureId) => !enabled || f === 'core' || enabled.includes(f), sees = owner || data.role === 'manager';
  const lockedNav = (id: string) => { const f = NAV_FEATURE[id]; return !!f && !has(f); };
  const can = (id: string) => navAllowed(data.role, id, { canReserve: !!data.reservations?.canReserve, integrations: integrationsPreview }) && (!lockedNav(id) || sees) && !(id === 'agenda' && !sees && !has('reservations'));
  // Event tables (Etkinlik) are tables too: an open bill there counts in "Açık masa" and "Açık hesap toplamı".
  const seats = [...data.tables, ...(data.eventTables ?? [])], active = seats.filter(t => t.account); const pending = data.orders.filter(o => o.status === 'new').length;
  // What a waiter carries to a table: platform orders leave with the courier or at the counter.
  const toServe = data.orders.filter(servable);
  // Garson ataması (11 Ekim, hafta sonu bulgusu 6): a waiter's count and list are his own tables (and tables nobody has);
  // another waiter's ready orders sit behind "Diğer garsonların masaları".
  const { mine: readyMine, others: readyOthers } = splitReady(toServe, data.role, assignmentRings(data));
  // Masasız (takeaway) tickets are never on the floor plan, but their open bills count as money still to collect.
  const tickets = data.takeaways ?? [], everyTable = [...data.tables, ...tickets, ...(data.eventTables ?? [])];
  // Ajanda ve rezervasyon on the floor: started events' tables, reserved tables, "Geldi mi?" (src/ReservationFloor.tsx).
  const floor = floorParts(data, clockNow), reservationDone = (message: string) => { setError(''); setToast(message); void load(); };
  const showTable = (t: TableView) => tableFilter === 'all' || (tableFilter === 'ready' ? tableState(t).label === 'Servise hazır' : tableFilter === 'open' ? !!t.account : !t.account && !t.needsCleaning);
  // The waiter's phone and the counter (≥ 900 px) get the compact Masalar (src/FloorBar.tsx); tablets and the rest keep the cards.
  const waiterPhone = data.role === 'waiter' && narrow, counterFloor = counterWide && ['owner', 'manager', 'cashier'].includes(data.role);
  // 9 Ekim kullanıcı testi (K-S): the owner's (and the Müdür's, the cashier's) phone had the old wide Masalar (slogan, big
  // cards, İlk adımlar open); every phone now gets the waiter's plain one: one line, filter chips, small tiles.
  const phoneFloor = narrow && ['owner', 'manager', 'cashier', 'waiter'].includes(data.role);
  const floorSeats = [...(floor.hideNormal && !showNormal ? [] : data.tables), ...floor.eventTables];
  const floorCounts = { all: floorSeats.length, open: floorSeats.filter(t => t.account).length, empty: floorSeats.filter(t => !t.account && !t.needsCleaning).length, ready: floorSeats.filter(t => tableState(t).label === 'Servise hazır').length };
  const compactCard = (t: TableView) => <CompactTable key={t.id} table={t} state={tableState(t)} floor={floor} calls={(data.serviceCalls ?? []).filter(c => c.tableId === t.id).map(c => c.kind === 'bill' ? 'bill' as const : 'call' as const)} onOpen={() => setActiveTable(t.id)} />;
  const outstanding = [...active, ...tickets].reduce((a, t) => a + (t.account?.balance ?? 0), 0);
  const selected = everyTable.find(t => t.id === activeTable); const payTable = everyTable.find(t => t.account?.id === payment?.table.account.id);
  // Who sees which place: one map for every role, src/roleNav.ts (the Müdür: no Ayarlar, Çalışanlar, Entegrasyonlar, Destek).
  const allowedViews = [{ id: 'tables', label: 'Masalar', icon: LayoutGrid }, { id: 'ready', label: 'Servise hazır', icon: HandPlatter }, { id: 'staff', label: 'Sipariş al', icon: ShoppingBag }, { id: 'cash', label: data.role === 'cashier' ? 'Kasa' : 'Kasa ve giderler', icon: Banknote }, { id: 'agenda', label: 'Ajanda ve rezervasyon', icon: CalendarDays }, { id: 'kitchen', label: 'Mutfak', icon: ChefHat }, { id: 'menu', label: 'Menü yönetimi', icon: Coffee }, { id: 'stock', label: 'Stok', icon: Package }, { id: 'users', label: 'Personel', icon: Users }, { id: 'reports', label: 'Satış ve Raporlar', icon: ChartColumn }, { id: 'settings', label: 'Ayarlar', icon: Settings }, { id: 'integrations', label: 'Entegrasyonlar', icon: Plug }, { id: 'announcements', label: 'Duyurular', icon: Megaphone }, { id: 'support', label: 'Destek', icon: LifeBuoy }, { id: 'password', label: 'Hesabım', icon: UserRound }].filter(v => can(v.id) && !hiddenInTicketMode(v.id, data)).map(v => ({ ...v, locked: lockedNav(v.id) }));
  // Kasa ve giderler is a place of its own on every screen now (the cashier's "Kasa": Bugün only); the strip stays on Masalar too.
  const views = allowedViews;
  const title = view === 'notifications' ? 'Bildirimler' : views.find(v => v.id === view)?.label ?? 'Masalar';
  const grouped = allowedViews.some(v => BUSINESS.has(v.id));
  /** Opens a view from the menus (sidebar, bottom bar, "Daha fazla"): a plain visit, no link's opening carried over. */
  /** A toast's "Aç": read now, then its place (as in Bildirimler), its Ajanda day, or Bildirimler itself. */
  const openNotification = (n: RecentNotification) => {
    void api('/api/staff/notifications/read', { ids: [n.id] }).then(notificationsChanged).catch(() => { /* stays unread; the bell says so */ });
    const place = notificationActionOf(n);
    if (place) openPlace(place[1]); else if (n.kind === 'reminder' && n.day && owner) openPlace({ view: 'agenda', day: n.day }); else go('notifications');
  };
  const go = (id: string) => { setSupportDraft(null); setView(id === 'campaigns' ? 'menu' : id); setError(''); setReportsAt(null); setStockAt(null); setSettingsAt(null); setCashAt(null); setStaffAt(null); setMenuAt(id === 'campaigns' ? { key: Date.now(), tab: 'campaigns' } : null); setSupportTab('tickets'); setAgendaDay(null); };
  // Mutfak modu (src/KitchenMode.tsx): the kitchen account's whole workspace, and only the kitchen account's (owner's decision,
  // 5 Ekim: no "Mutfak ekranı" for the owner; one screen for cashier and kitchen is the window's "İkiye böl", src/SplitView.tsx).
  if (data.role === 'kitchen') return <PackageProvider value={{ enabled, role: data.role }}><div className="workspace business-themed kitchen-mode-root" style={businessTheme(data.theme)}>
    <KitchenMode data={data} view={view} onView={next => { setView(next); setError(''); setStockAt(null); }} connected={connected} error={error} onError={setError} onToast={setToast} load={() => load()}
      onPrint={o => void action('/api/staff/print/order', { orderId: o.id }, 'Fiş yazdırıldı.')} onCancel={setCancelling} onLogout={() => void logout()} loggingOut={loggingOut}
      notice={<>{data.supportConnected && <SupportBanner since={data.supportConnected.since} owner={false} />}{preShift.notice}{!!data.sessionEndsAt && Date.parse(data.sessionEndsAt) - clockNow <= 30 * 60_000 && Date.parse(data.sessionEndsAt) > clockNow && <Notice>Oturumunuz {saatEki(dayStartText, 'de')} bitecek. Sonra yeniden giriş yapmanız gerekir.</Notice>}</>}
      shiftChip={shift.me?.tracking && shift.me.open ? <ShiftChip me={shift.me} onChanged={() => { setToast('Vardiya bitti.'); void shift.reload(); }} /> : undefined}>
      {view === 'stock' && <DeferredPanel><Stock key={stockAt?.key} data={data} open={stockAt ?? undefined} /></DeferredPanel>}
      {view === 'password' && <><ChangePassword onChanged={() => { setAuth('out'); setData(null); setView('tables'); }} /><div className="account-logout"><button className="btn secondary" disabled={loggingOut} onClick={() => void logout()}><LogOut size={17} />{loggingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</button></div><AppVersion /></>}
    </KitchenMode>
    {toast && <div className="toast" role="status"><Check size={18} />{toast}</div>}
    {cancelling && canCancel(data.role) && <StaffCancel order={data.orders.find(o => o.id === cancelling.id) ?? cancelling} kitchen tracked={data.stockProducts} onClose={() => setCancelling(null)} onDone={message => { setCancelling(null); setToast(message); void load(); }} />}
  </div></PackageProvider>;
  const day = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date());
  // One table on Masalar (normal sections and event sections alike); a reservation adds its line and colour.
  const tableCard = (t: TableView) => <button className={`table-card ${tableState(t).tone}${floor.marks.get(t.id) && !t.account ? ` reserved${floor.marks.get(t.id)!.phase === 'ask' ? ' asking' : ''}` : floor.marks.get(t.id) ? ' held-busy' : ''}`} key={t.id} onClick={() => setActiveTable(t.id)}><div className="table-top">{data.serviceCalls?.some(c => c.tableId === t.id) && <span className="table-call-badge" title={data.serviceCalls.filter(c => c.tableId === t.id).map(callLabel).join(' · ')} aria-label={data.serviceCalls.filter(c => c.tableId === t.id).map(callLabel).join(' · ')}>{data.serviceCalls.some(c => c.tableId === t.id && c.kind === 'bill') ? <ReceiptText size={13} /> : <BellRing size={13} />}</span>}<span className={`table-status ${t.account ? 'open' : ''}`}>{tableState(t).label}</span></div><h3>{t.name}</h3>{t.area && <span className="table-area">{areaName(t.area)}</span>}<TableBadge table={t} floor={floor} /><div className="table-meta">{t.account ? <><span><ReceiptText size={13} />{data.orders.filter(o => o.accountId === t.account?.id && o.status !== 'cancelled').length + (t.account.doneOrders ?? 0)} sipariş</span><strong>{money(t.account.balance)}</strong></> : null}</div></button>;
  // One ready order on the waiter's "Servise hazır" (another waiter's ones dimmed, behind "Diğer garsonların masaları").
  const readyCard = (o: PublicOrder) => <article className={`panel${readyOthers.includes(o) ? ' ready-other' : ''}`} key={o.id}><div className="order-head"><h3>{o.tableName} · #{o.number}</h3><Status value={o.status} /></div><p className="muted">{handOver(o)} · {o.paid ? 'Ödendi' : 'Ödeme alınmadı'}</p><OrderLines order={o} showPrice={false} /><button className="btn primary" disabled={o.cancelRequested || (!!o.paymentBeforePreparation && !o.paid)} onClick={() => void action('/api/staff/status', { requestId: requestId(), orderId: o.id, version: o.version, status: 'served' }, 'Sipariş teslim edildi.')}>{o.cancelRequested ? 'İptal talebi bekleniyor' : 'Teslim edildi'}</button>{o.cancelRequested && <p className="hold-hint">Mutfak iptal talebini değerlendirdikten sonra teslim edebilirsiniz.</p>}</article>;
  const cardFor = phoneFloor ? compactCard : tableCard;
  // The waiter's phone: the table as one chip ("Masa 05 ▾") beside the search; "Masasız sipariş…" is its first choice.
  const tableChip = <label className="table-chip"><span className="sr-only">Sipariş alınan masa</span><select aria-label="Sipariş masası" value={staffTable} onChange={e => { if (e.target.value === '__takeaway') { setStaffTable(''); setTakeawayOpen(true); } else setStaffTable(e.target.value); }}><option value="">Masa seçin</option><option value="__takeaway">Masasız sipariş…</option>{data.tables.map(t => <option key={t.id} value={t.id}>{t.name}{t.area ? ` · ${areaName(t.area)}` : ''}{t.needsCleaning ? ' · Temizlik bekliyor' : ''}</option>)}{floor.events.map(e => <optgroup key={e.id} label={`Etkinlik: ${e.name}`}>{floor.eventTables.filter(t => t.event?.id === e.id).map(t => <option key={t.id} value={t.id}>{t.name}{t.account?.guest ? ` · ${t.account.guest.name}` : ''}{t.needsCleaning ? ' · Temizlik bekliyor' : ''}</option>)}</optgroup>)}</select><ChevronDown size={16} aria-hidden="true" /></label>;
  return <PackageProvider value={{ enabled, role: data.role }}><div className="workspace business-themed has-bottom-nav" style={businessTheme(data.theme)}><aside className="sidebar"><Brand /><div className="business-pill"><span className="business-avatar">{data.logo ? <img src={data.logo} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} /> : data.name[0]}</span><div><strong>{data.name}</strong>{localDev && <small>Yerel geliştirme alanı</small>}</div></div>{data.qrOrdering && !narrow && <QrOrderingCard view={data.qrOrdering} now={clockNow} onChanged={() => void load()} onError={setError} />}{!grouped && <span className="nav-label">ÇALIŞMA ALANI</span>}<nav className={grouped ? 'grouped' : undefined}>{/* Destek also sits at the bottom of the sidebar. Phones (≤ 700 px) have the bottom bar (src/BottomNav.tsx) instead of this menu. */}{allowedViews.map((v, i) => { const kind = (id: string) => DAILY.has(id) ? 'daily' : BUSINESS.has(id) ? 'business' : 'rest', first = i === 0 || kind(allowedViews[i - 1].id) !== kind(v.id); return <Fragment key={v.id}>{grouped && first && (kind(v.id) === 'daily' ? <span className="nav-group-label">GÜNLÜK</span> : kind(v.id) === 'business' ? <span className="nav-group-label">İŞLETME</span> : <span className="nav-group-rule" aria-hidden="true" />)}<button className={(view === v.id ? 'active ' : '') + (v.id === 'support' ? 'nav-support-phone' : '') + (v.locked ? ' nav-locked' : '')} aria-label={v.locked ? `${v.label}, pakette yok` : undefined} aria-current={view === v.id ? 'page' : undefined} onClick={() => go(v.id)}><v.icon size={19} />{v.label}{v.locked && <LockedHint />}{(v.id === 'support' || v.id === 'announcements') && unreadAnnouncements > 0 && <span className="red-dot nav-dot" title="Okunmamış duyuru var" aria-hidden="true" />}{v.id === 'ready' && readyMine.length > 0 && <span className="nav-count" aria-label={`${readyMine.length} sipariş servise hazır`}>{readyMine.length}</span>}{v.id === 'kitchen' && pending > 0 && <span className="nav-count">{pending}</span>}</button></Fragment>; })}</nav><div className={`sidebar-bottom ${owner ? 'with-support' : ''}`}>{owner ? <button className={`btn support-nav ${view === 'support' ? 'active' : ''}`} aria-current={view === 'support' ? 'page' : undefined} onClick={() => { setView('support'); setError(''); setSupportTab('tickets'); }}><LifeBuoy size={19} />Destek{unreadAnnouncements > 0 && <span className="red-dot nav-dot" title="Okunmamış duyuru var" aria-hidden="true" />}</button> : <div className="build-label"><span />{localDev ? `YEREL TEST · ${APP_VERSION}` : `SÜRÜM ${APP_VERSION}`}</div>}<div className="user-row"><span className="user-avatar">{roles[data.role][0]}</span><div><strong>{data.displayName ?? roles[data.role]}</strong><small>{data.username} · {roles[data.role]}</small></div>{owner && <button className="icon-btn" aria-label="Kilitle" title="Kilitle: devam etmek için şifreniz sorulur" onClick={() => void lockNow()}><Lock size={17} /></button>}<button className="icon-btn" aria-label="Çıkış yap" disabled={loggingOut} onClick={() => void logout()}><LogOut size={17} /></button></div></div></aside><main className="main"><header className="topbar"><div className="topbar-business"><span className="business-avatar" aria-hidden="true">{data.logo ? <img src={data.logo} alt="" style={{ objectFit: 'contain' }} /> : data.name[0]}</span><strong>{data.name}</strong></div><div className="breadcrumb">Çalışma alanı <ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-right">{/* Floor sounds ring on every view (mounted once here); the kitchen's live in Mutfak modu. */}{<FloorAlerts calls={data.serviceCalls ?? []} orders={data.orders} external={data.externalOrders} role={data.role} memory={`floor:${data.username ?? ''}`} rings={assignmentRings(data)} ticket={!!data.printing?.ticketMode} reminders={data.tableReminders}onReady={list => setToast(list.slice(0, 3).map(o => `${o.takeaway ? takeawayHeading(o.takeaway.number) : o.tableName} · #${o.number}`).join(', ') + (list.length > 3 ? ` ve ${list.length - 3} sipariş daha` : '') + ' hazır')} />}<DemoBadge on={data.demo} /><span className={`connection ${connected ? '' : 'lost'}`}>{connected ? <Wifi size={14} /> : <WifiOff size={14} />}{connected ? 'Bağlı' : 'Bağlantı kesildi'}</span>{shift.me?.tracking && shift.me.open && <><span className="divider" /><ShiftChip me={shift.me} onChanged={() => { setToast('Vardiya bitti.'); void shift.reload(); }} /></>}<span className="divider" /><span className="date-label">{day}</span>{/* Bildirimler: the owner's bell on every screen (once Bildirimler (üst çubuktaki zil)). */}{/* 10 Ekim: with unread ones the bell turns a soft coral, rings and shows the count ("9+" above nine); plain once all are read. */}{(owner || data.role === 'manager') && <button type="button" className={`topbar-bell${unread > 0 ? ' has-unread' : ''}${view === 'notifications' ? ' active' : ''}`} aria-label={unread ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler'} title={unread ? `Bildirimler: ${unread} okunmamış` : 'Bildirimler'} aria-current={view === 'notifications' ? 'page' : undefined} onClick={() => go('notifications')}>{unread > 0 ? <BellRing key={unread} className="bell-ring" size={19} aria-hidden="true" /> : <Bell size={19} aria-hidden="true" />}{unread > 0 && <span className="bell-count" data-testid="bell-count" aria-hidden="true">{bellCount(unread)}</span>}</button>}</div></header><div className={`main-content ${['menu', 'settings', 'reports', 'stock', 'cash', 'users', 'notifications'].includes(view) ? 'owner-compact' : ''}`}>{data.qrOrdering && <QrOrderingBar view={data.qrOrdering} now={clockNow} phone={narrow} masalar={view === 'tables'} onChanged={() => void load()} onError={setError} />}<>{!owner && data.serviceNotice && <Notice tone="error">{data.serviceNotice}</Notice>}{owner && data.licenseNotice &&<Notice>{data.licenseNotice}<button className="text-btn" onClick={() => openPlace({ view: 'support', tab: 'tickets' })}>Destek ve lisans</button></Notice>}{owner && <UpdateBanner />}</>{!(view === 'tables' && (phoneFloor || counterFloor)) && <div className="page-heading"><div><span className="eyebrow">{data.name}</span><h1>{view === 'tables' ? 'Her masa, güzel bir mola.' : title}</h1><p>{pageLine(view, data.role)}</p></div>{view === 'tables' && owner && <div className="table-management-actions"><button className="btn secondary" onClick={() => setTableManagement('add')}><Plus size={18} />Masa ekle</button><button className="btn secondary" onClick={() => setTableManagement('remove')}>Masa çıkar</button><button className="btn primary" onClick={() => setView('staff')}><Plus size={18} />Sipariş al</button></div>}{view === 'tables' && !owner && <button className="btn primary" onClick={() => setView('staff')}><Plus size={18} />Sipariş al</button>}</div>}
      {error && <Notice tone="error">{error}{printRetry && <button className="btn secondary small-btn print-retry" onClick={() => { const r = printRetry; void action(r.path, r.body, r.message); }}><Printer size={15} aria-hidden="true" />Tekrar bas</button>}<button className="text-btn" onClick={() => { setError(''); setPrintRetry(null); }}>Kapat</button></Notice>}
      {/* Mutfak fişi modu: a kitchen ticket that did not print stays here in red until someone handles it (src/KitchenTickets.tsx). */}
      <PrintAlerts data={data} onError={setError} onDone={message => { if (message) setToast(message); void load(); }} />
      {data.supportConnected && <SupportBanner since={data.supportConnected.since} owner={owner} onOpen={() => { setSupportTab('remote'); setView('support'); }} />}
      {preShift.notice}
      {/* K-A (9 Ekim): "Sahip iadeyi yaptı: Masa 02 · ₺190 nakit. Parayı müşteriye verin." for the people at the till (src/TillNotices.tsx). */}
      {(data.role === 'cashier' || data.role === 'manager') && <TillNotices notices={data.tillNotices} visible={view === 'tables' || view === 'cash'} onError={setError} />}
      {/* The sign-in ends with the business day (05:00): from half an hour before, everyone sees it coming. */}
      {!!data.sessionEndsAt && Date.parse(data.sessionEndsAt) - clockNow <= 30 * 60_000 && Date.parse(data.sessionEndsAt) > clockNow && <Notice>Oturumunuz {saatEki(dayStartText, 'de')} bitecek. Sonra yeniden giriş yapmanız gerekir; yazdığınız sepet bu cihazda kalır.</Notice>}
      {/* Calls are the waiters' job: they see them on every screen. Owners and cashiers see them only on Masalar (table cards also show the bell), never in reports or settings. */}{(data.role === 'waiter' || (cashier && view === 'tables')) && <ServiceCallBar compact={phoneFloor && view === 'tables'} calls={data.serviceCalls ?? []} onOpenTable={id => setActiveTable(id)} onAnswered={() => void load()} onError={setError} />}
      {/* "Masa 5: 45 dakikadır yeni sipariş yok. Bir isteği var mı?" on the waiter's screens (11 Ekim), with "Gittim". */}
      {data.role === 'waiter' && <TableReminders reminders={data.tableReminders ?? []} compact={phoneFloor && view === 'tables'} onOpenTable={id => setActiveTable(id)} onDone={() => void load()} onError={setError} />}
      {/* QR approvals: waiters everywhere, the kitchen above its board, the owner (supervisor) on Masalar; only while one waits, except the waiter's order screen. */}
      {(data.role === 'waiter' || (manages && view === 'tables')) && <ApprovalQueue data={data} compact={phoneFloor && view === 'tables'} onlyWaiting={data.role !== 'waiter' || view !== 'staff'} onSaved={() => void load()} />}
      {/* Delivery platform orders waiting for Kabul/Reddet: the kitchen above its board, owner and cashier on Masalar (src/ExternalOrders.tsx). */}
      {!!data.externalOrders?.length && cashier && view === 'tables' && <ExternalInbox orders={data.externalOrders} role={data.role} onSaved={() => void load()} />}
      {view === 'support' && owner && <Support key={supportDraft?.key} draft={supportDraft ?? undefined} tab={supportTab} onTab={setSupportTab} announcements={unreadAnnouncements} onWrite={d => { setSupportDraft({ key: Date.now(), ...d }); setSupportTab('tickets'); }} />}
      {view === 'notifications' && (owner || data.role === 'manager') && <NotificationInbox manager={!owner} onAgenda={owner ? day => openPlace({ view: 'agenda', day }) : undefined} />}
      {view === 'announcements' && data.role === 'manager' && <AnnouncementList owner={false} />}
      {view === 'agenda' && can('agenda') && <DeferredPanel><AgendaHub key={agendaDay?.key} initialDay={agendaDay?.day} initialPart={agendaDay?.part} role={data.role} /></DeferredPanel>}
      {/* "Yeni bir bildiriminiz var" floats over the owner's Masalar until opened or closed; a newer notification brings it back. */}
      {owner && view === 'tables' && unread > 0 && unread !== bannerClosedAt && <div className="notification-banner" aria-live="polite"><p data-testid="notification-banner-text">{notes.latest?.title ?? 'Yeni bir bildiriminiz var'}{unread > 1 && <small> · {unread - 1} bildirim daha</small>}</p><button className="icon-btn" aria-label="Bildirim uyarısını kapat" onClick={() => setBannerClosedAt(unread)}><X size={18} /></button>{notificationAction(notes.latest) ? <button className="btn primary" onClick={() => { openPlace({ view: 'cash', tab: 'refunds', q: '', day: cashDayOf(new Date().toISOString()) }); setBannerClosedAt(unread); }}>{notificationAction(notes.latest)}</button> : <button className="btn primary" onClick={() => { go('notifications'); setBannerClosedAt(unread); }}>Bildirimleri aç</button>}</div>}
      {(owner || data.role === 'manager') && <NotificationToasts recent={notes.recent} memory={`notes:${data.username ?? ''}`} onOpen={openNotification} />}
      {view === 'users' && (owner || data.role === 'manager') && <StaffHome role={data.role} open={staffAt ?? undefined} />}
      {view === 'cash' && cashier && <CashHome data={data} open={cashAt ?? undefined} onSlot={setTodaySlot} onSaved={() => { void load(); setToast('Ayarlar kaydedildi.'); }} />}

      {view === 'reports' && manages && <FinancialAccess><DeferredPanel><SalesReports key={reportsAt?.key} open={reportsAt ?? undefined} onRecipe={id => { setStockAt({ key: Date.now(), tab: 'recipes', productId: id }); setView('stock'); }} /></DeferredPanel></FinancialAccess>}
      {view === 'stock' && manages && !has('stock') && <FeatureLockView feature="stock" onClose={() => go('tables')} />}
      {view === 'stock' && manages && has('stock') && <DeferredPanel><Stock key={stockAt?.key} data={data} open={stockAt ?? undefined} /></DeferredPanel>}
      {view === 'password' && <ChangePassword onChanged={() => { setAuth('out'); setData(null); setView('tables'); }} />}
      {/* Phones hide the sidebar's user row, so logout must also live here. */}
      {view === 'password' && <div className="account-logout">{owner && <button className="btn secondary" onClick={() => void lockNow()}><Lock size={17} />Kilitle</button>}<button className="btn secondary" disabled={loggingOut} onClick={() => void logout()}><LogOut size={17} />{loggingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</button></div>}
      {view === 'password' && <AppVersion update={owner} />}
      {/* One cash panel for every screen size: on the counter's compact Masalar its chip and banners show in the head (a portal), so an open count survives turning a tablet. */}{cashier && <CashDayPanel data={data} visible={view === 'tables' || (view === 'cash' && !!todaySlot)} compact={counterFloor && view === 'tables'} slot={view === 'cash' ? todaySlot : cashSlot} onExpense={() => setExpenseForm(true)} onToast={setToast} />}{view === 'tables' && <>{owner && <FirstSteps data={data} folded={counterFloor || phoneFloor}onOpen={next => next === 'settings' ? openPlace({ view: 'settings', topic: 'devices', part: 'printers' }) : next === 'users' ? openPlace({ view: 'users', tab: 'staff' }) : go(next)} onQr={() => { setSettingsAt({ key: Date.now(), topic: 'tables', qr: true }); setView('settings'); }} />}{owner && <QrAddressNotice onReprint={() => { setSettingsAt({ key: Date.now(), topic: 'tables', qr: true }); setView('settings'); }} />}{phoneFloor ? <WaiterFloorLine open={active.length} seats={seats.length} outstanding={outstanding} /> : counterFloor ? <div className="floor-head"><CounterFloorLine open={active.length} seats={seats.length} outstanding={outstanding} today={owner ? todaySales : null} kitchen={data.orders.filter(o => o.status === 'new' || o.status === 'preparing').length} approval={data.orders.filter(o => o.status === 'awaiting_approval').length} ready={readyMine.length} />{cashier && <div className="floor-head-cash" ref={setCashSlot} />}<div className="floor-head-actions">{owner && <><button className="btn secondary" onClick={() => setTableManagement('add')}><Plus size={17} />Masa ekle</button><button className="btn secondary" onClick={() => setTableManagement('remove')}>Masa çıkar</button></>}<button className="btn primary" onClick={() => setView('staff')}><Plus size={17} />Sipariş al</button></div></div> : <div className="metric-grid"><Metric label="Açık masa" value={`${active.length}`} suffix={`/ ${seats.length}`} icon={<LayoutGrid size={21} />} detail="Misafirlerinizi ağırlıyor" /><Metric label="Yeni sipariş" value={`${pending}`} icon={<ReceiptText size={21} />} detail="Hazırlanmayı bekliyor" /><Metric label="Servise hazır" value={`${readyMine.length}`} icon={<Bell size={21} />} detail="Masaya ulaşmayı bekliyor" /><Metric label="Açık hesap toplamı" value={money(outstanding)} icon={<Wallet size={21} />} detail="Henüz tahsil edilmedi" /></div>}{/* Open masasız tickets only: the cashier hands them over and sees the unpaid ones. On a phone they sit under the tiles. */}{!phoneFloor && <TakeawayStrip data={data} onOpen={id => setActiveTable(id)} onStatus={(o, status, message) => void action('/api/staff/status', { requestId: requestId(), orderId: o.id, version: o.version, status }, message)} />}{!waiterPhone && <ReservationQuestions floor={floor} data={data} onDone={reservationDone} onError={setError} />}<section className={`tables-section${phoneFloor ? ' floor-compact' : counterFloor ? ' floor-counter' : ''}`}>{phoneFloor && <FloorFilters value={tableFilter as FloorFilter} onChange={setTableFilter} counts={floorCounts} />}{!phoneFloor && <div className="section-heading"><h2>Masa görünümü <span>{data.tables.length} masa</span></h2><div className="segmented"><button className={tableFilter === 'all' ? 'selected' : ''} onClick={() => setTableFilter('all')}>Tümü</button><button className={tableFilter === 'open' ? 'selected' : ''} onClick={() => setTableFilter('open')}>Açık</button><button className={tableFilter === 'empty' ? 'selected' : ''} onClick={() => setTableFilter('empty')}>Boş</button></div></div>}<div className="table-sections"><EventSections floor={floor} now={clockNow} filter={showTable} card={cardFor} onDone={reservationDone} /><NormalTablesToggle floor={floor} show={showNormal} onShow={setShowNormal} />{(!floor.hideNormal || showNormal) && orderedAreas(data.tables, data.areaOrder).map(area => [area, sectionHeading(area, data.tables.some(t => t.area))]).map(([area, label]) => <section className="table-area-section" key={area}>{label && <h3>{label}</h3>}<div className="table-grid">{data.tables.filter(t => (t.area ?? '') === area).filter(showTable).map(cardFor)}</div></section>)}</div>{phoneFloor && <div className="floor-takeaways"><TakeawayStrip data={data} onOpen={id => setActiveTable(id)} onStatus={(o, status, message) => void action('/api/staff/status', { requestId: requestId(), orderId: o.id, version: o.version, status }, message)} /></div>}</section>{localDev && <div className="hint-row"><QrCode size={17} /><span>Müşteri menüsünü denemek için bir masayı seçip QR kodunu açın.</span></div>}</>}

      {view === 'staff' && <>{!waiterPhone && <NoTableChoice onChoose={() => { setStaffTable(''); setTakeawayOpen(true); }} />}{waiterPhone && !staffTable && <div className="staff-search-row">{tableChip}</div>}{!waiterPhone && <div className="staff-table-picker"><label>Sipariş alınan masa<select aria-label="Sipariş masası" value={staffTable} onChange={e => setStaffTable(e.target.value)}><option value="">Masa seçin</option>{data.tables.map(t => <option key={t.id} value={t.id}>{t.name}{t.area ? ` · ${areaName(t.area)}` : ''}{t.needsCleaning ? ' · Temizlik bekliyor' : ''}</option>)}{floor.events.map(e => <optgroup key={e.id} label={`Etkinlik: ${e.name}`}>{floor.eventTables.filter(t => t.event?.id === e.id).map(t => <option key={t.id} value={t.id}>{t.name}{t.account?.guest ? ` · ${t.account.guest.name}` : ''}{t.needsCleaning ? ' · Temizlik bekliyor' : ''}</option>)}</optgroup>)}</select></label><span className="muted">Ürünün adını veya kodunu yazarak hızlıca bulabilirsiniz.</span></div>}{/* A table waiting for cleaning can be chosen, but says why its products are greyed out. */}{staffTable && everyTable.find(t => t.id === staffTable)?.needsCleaning && <Notice>Bu masa temizlik bekliyor — garson “Temizlendi” deyince sipariş alınabilir.</Notice>}{staffTable ? <Composer leading={waiterPhone ? tableChip : undefined} staffBasket={basketKey(data.username, staffTable)} tableName={everyTable.find(t => t.id === staffTable)?.name} quickCode={data.role !== 'waiter'} subcategoryOrder={data.subcategories} categoryOrder={data.categories} key={staffTable} products={data.products} tableId={staffTable} enabled={connected && !everyTable.find(t => t.id === staffTable)?.needsCleaning} onSent={result => { const name = everyTable.find(t => t.id === staffTable)?.name ?? 'Masa'; setStaffTable(''); if (waiterPhone) setView('tables'); setToast(`${name} · Sipariş #${result?.number ?? ''} mutfağa gönderildi.`); void load(); }} /> : <Empty title="Önce bir masa seçin" detail="Masaya bağlı değilse üstteki “Masasız sipariş”i seçin." />}</>}
      {view === 'menu' && manages && <MenuHome data={data} owner={owner} open={menuAt ?? undefined} onAdd={() => setEditing('new')} onEdit={setEditing} onCategories={() => setCategoryManagement(true)} onPreview={() => setMenuPreview(true)} onSaved={load} onError={setError} />}
      {view === 'ready' && data.role === 'waiter' && <section className="ready-orders"><h2>Masaya teslim edilecek siparişler</h2><p className="muted">Ödemesi alınmış siparişler de teslim edilene kadar burada kalır.</p>{!readyMine.length && !readyOthers.length && <Empty title="Hazır sipariş yok" detail="Mutfak hazırlığı tamamlayınca burada göreceksiniz." />}{readyMine.length === 0 && readyOthers.length > 0 && <p className="muted small">Sizin masalarınızda hazır sipariş yok.</p>}{readyMine.map(readyCard)}{readyOthers.length > 0 && <button type="button" className="text-btn ready-others-toggle" aria-expanded={showOthers} onClick={() => setShowOthers(v => !v)}>{showOthers ? 'Diğer garsonların masalarını gizle' : `Diğer garsonların masaları (${readyOthers.length})`}</button>}{showOthers && readyOthers.map(readyCard)}</section>}
      {view === 'integrations' && owner && !has('integrations') && <FeatureLockView feature="integrations" onClose={() => go('tables')} />}
      {view === 'integrations' && owner && has('integrations') && <DeferredPanel><Integrations /></DeferredPanel>}
      {view === 'settings' && owner && <DeferredPanel><SettingsPanel data={data} open={settingsAt ?? undefined} onTables={setTableManagement} onSaved={() => { void load(); setToast('Ayarlar kaydedildi.'); }} /></DeferredPanel>}
      {view === 'settings' && owner && <AppVersion update />}
    </div><footer className="workspace-footer">Mola · Merkut Studios{localDev && <span>Yerel deneme verileri kullanılıyor.</span>}</footer></main>
    {/* Phones (≤ 700 px): the bottom bar and its "Daha fazla" sheet; hidden by CSS on wider screens. */}
    <BottomNav items={views} role={data.role} view={view} onGo={go} counts={{ ready: readyMine.length }} dots={{ support: owner && unreadAnnouncements > 0, announcements: data.role === 'manager' && unreadAnnouncements > 0 }} onLogout={() => void logout()} loggingOut={loggingOut} />
    {toast && <div className="toast" role="status"><Check size={18} />{toast}</div>}
    {changeDue > 0 && <div className="change-due" role="status" data-testid="change-due"><span>Verilecek para üstü</span><strong>{money(changeDue)}</strong><button type="button" className="icon-btn" aria-label="Para üstü notunu kapat" onClick={() => setChangeDue(0)}><X size={18} /></button></div>}
    {owner && <OwnerLock name={data.displayName} onLogout={() => void logout()} />}
    {lockOpen && <FeatureLockModal feature={lockOpen} onClose={() => setLockOpen(null)} />}
    {owner && <TrialEndNotice pkg={data.pkg} onDone={() => void load()} />}
    {/* Mola Lisans Sözleşmesi: the owner only, once per sign-in while a (new) text is not accepted; never staff (src/LicenseAgreement.tsx). */}
    {/* Keys unique among these siblings (10 Ekim son kullanıcı testi): both windows were keyed by the user name, and React's
        "two children with the same key" opened the agreement window twice on about a third of the owner's sign-ins. */}
    {owner && <OwnerAgreementPrompt key={`agreement:${data.username}`} username={data.username ?? ''} />}
    {/* "Kampanya bitti": the owner's one-time window (the Müdür has only the notification in Bildirimler). */}
    {owner && data.setupCompleted && <CampaignEnded key={`campaign-ended:${data.username}`} products={data.products} />}
    {/* Duyurular: an Önemli one opens this window for the owner (after signing in, and at the next look); never for staff. */}
    {owner && <ImportantAnnouncement key={`announcement:${data.username}`} state={announcements} onOpenList={() => { setSupportDraft(null); setSupportTab('announcements'); setView('support'); }} />}
    {/* "Gider kaydet" on the cash strip / chip: the counter's payout (cashier, Müdür), the owner's bookkeeping form (date, method). */}
    {expenseForm && cashier && <ExpenseForm owner={owner} onClose={() => setExpenseForm(false)} onSaved={message => { setExpenseForm(false); setToast(message); void load(); }} />}
    {takeawayOpen && <TakeawayOrder data={data} enabled={connected} onClose={() => setTakeawayOpen(false)} onSent={(message, tableId) => { setTakeawayOpen(false); setToast(message); if (cashier && tableId) setPayAfterSend(tableId); void load(); }} />}
    {cancelling && canCancel(data.role) && <StaffCancel order={data.orders.find(o => o.id === cancelling.id) ?? cancelling} kitchen={false} tracked={data.stockProducts} onClose={() => setCancelling(null)} onDone={message => { setCancelling(null); setToast(message); void load(); }} />}
    {changing && canChangeLines(data.role) && <StaffChange key={changing.id} order={data.orders.find(o => o.id === changing.id) ?? changing} products={data.products} ticketMode={!!data.printing?.ticketMode} onClose={() => setChanging(null)} onDone={message => { setChanging(null); setToast(message); void load(); }} />}
    {/* Cashiers and the owner add to tables here; everyone at the counter adds to an open masasız ticket here (from its card). */}
    {cashierAddTable && (cashier || isTakeaway(cashierAddTable)) && <Modal title={cashierAddTable.name + ' · Ürün ekle'} wide onClose={() => setCashierAddTable(null)}><div className="modal-body"><Composer staffBasket={basketKey(data.username, cashierAddTable.id)} tableName={cashierAddTable.name} toGo={isTakeaway(cashierAddTable)} products={data.products} categoryOrder={data.categories} subcategoryOrder={data.subcategories} tableId={cashierAddTable.id} enabled={connected} onSent={() => { void load(); }} /></div></Modal>}
    {menuPreview && manages && <MenuPreview owner={owner} onClose={() => setMenuPreview(false)} />}
    {categoryManagement && manages && <CategoryManagement data={data} onClose={() => setCategoryManagement(false)} onSaved={() => void load()} />}
    {tableManagement && owner && <TableManagement mode={tableManagement} data={data} onClose={() => setTableManagement(null)} onSaved={message => { setTableManagement(null); setToast(message); void load(); }} />}
    
    {movingTable && canMoveTable && <TableTransfer source={movingTable} tables={data.tables} canMerge={cashier || data.role === 'waiter'}onClose={() => setMovingTable(null)} onDone={message => { setMovingTable(null); setToast(message); void load(); }} />}
    {selected && isTakeaway(selected) && <TakeawayDetail onCancel={canCancel(data.role) ? o => { setCancelling(o); setActiveTable(null); } : undefined} data={data} ticket={selected} onClose={() => setActiveTable(null)} onAdd={() => { setCashierAddTable(selected); setActiveTable(null); }} onPay={() => { setPayment({ context: data.paymentContext!, table: { name: selected.name, account: selected.account! } }); setActiveTable(null); }} onAction={(path, body, message) => void action(path, body, message)} />}
    {selected && !isTakeaway(selected) && <Modal title={selected.account?.guest ? `${selected.name} · ${selected.account.guest.name}` : selected.name} onClose={() => setActiveTable(null)} wide className="modal-steady"><div className="modal-body"><div className="table-detail-summary"><div><span className="muted">Kalan hesap</span><h2>{money(selected.account?.balance ?? 0)}</h2>{!!selected.account?.paid && selected.account.balance > 0 && <small className="part-paid">{money(selected.account.paid)} ödendi · kalanı bekleniyor</small>}{selected.account && (() => { const m = data.billMethods?.find(b => b.tableId === selected.id)?.method; return m ? <small className="bill-method-note" role="status">Müşteri hesabı isterken “{m === 'card' ? 'Kart' : 'Nakit'}” dedi.</small> : null; })()}</div>{/* Event tables have no QR: staff take the orders. */}{!selected.event && has('qr-menu') && <button className="btn secondary" onClick={() => { setQr(selected); setActiveTable(null); }}><QrCode size={18} />QR menüyü aç</button>}</div><TablePanel table={selected} data={data} floor={floor} onDone={message => { setActiveTable(null); reservationDone(message); }} onError={setError} />{/* Only a table whose bill closed: an open bill's payments are in the payment window. */}{manages && !selected.account && selected.lastPaidAt && <Notice>Kapanan hesabın son ödemesi: {new Date(selected.lastPaidAt).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })}<button className="text-btn" onClick={() => { openPlace({ view: 'cash', tab: 'refunds', q: selected.name, day: cashDayOf(selected.lastPaidAt!) }); setActiveTable(null); }}>Ödemeyi düzelt</button></Notice>}{selected.account ? <>{!!selected.account.doneOrders && <p className="muted small done-orders">Önceki {selected.account.doneOrders} sipariş teslim edildi ve ödendi.</p>}{data.orders.filter(o => o.accountId === selected.account!.id).map(o => <div className="detail-order" key={o.id}><div className="order-head"><strong>#{o.number} · {o.guestLabel}</strong><Status value={o.status} /></div><OrderLines order={o} /><OrderChanges order={o} /><DeliverOrder order={o} data={data} onAction={(path, body, message) => void action(path, body, message)} />{canCancel(data.role) && orderCancellable(o) && <button className="text-btn order-cancel-open" aria-label={`Sipariş #${o.number} · iptal et`} onClick={() => { setCancelling(o); setActiveTable(null); }}>İptal et</button>}{canChangeLines(data.role) && <ChangeOpener order={o} products={data.products} ticketMode={!!data.printing?.ticketMode} onOpen={() => { setChanging(o); setActiveTable(null); }} />}{manages && o.cancelRequested && <Notice>İptal talebi var.<button className="text-btn" onClick={() => void action('/api/staff/cancel', { requestId: requestId(), orderId: o.id, version: o.version }, 'Sipariş iptal edildi.')}>İptali onayla</button></Notice>}{manages && o.source === 'qr' && <button className="text-btn muted" onClick={() => void action('/api/staff/block', { orderId: o.id, blocked: true }, 'Tarayıcı bu işletmede engellendi.')}>Bu tarayıcıyı engelle</button>}</div>)}<div className="modal-actions table-detail-actions"><DeliverAll accountId={selected.account.id} data={data} onAction={(path, body, message) => void action(path, body, message)} /><button className="btn secondary" onClick={() => { if (cashier) setCashierAddTable(selected); else { setStaffTable(selected.id); setView('staff'); } setActiveTable(null); }}><Plus size={17} />Sipariş ekle</button>{canMoveTable && <button className="btn secondary" onClick={() => { setMovingTable(selected); setActiveTable(null); }}>Taşı / birleştir</button>}{cashier && data.printing?.bill && selected.account.total > 0 && <button className="btn secondary" onClick={() => void action('/api/staff/print/bill', { accountId: selected.account!.id }, 'Hesap fişi yazdırıldı.')}><Printer size={17} />Hesap fişi</button>}{cashier && (selected.account.depositCredit && selected.account.balance === 0 ? <DepositClose table={selected} onDone={message => { setActiveTable(null); reservationDone(message); }} onError={setError} /> : selected.account.balance === 0 && selected.account.total > 0 ? <span className="notice">Ödendi · Teslim bekleniyor</span> : selected.account.balance > 0 ? <button className="btn primary" onClick={() => { setPayment({ context: data.paymentContext!, table: { name: selected.name, account: selected.account! } }); setActiveTable(null); }}><Wallet size={17} />Ödeme al</button> : <button className="btn primary" onClick={() => { void action('/api/staff/close-empty', { requestId: requestId(), accountId: selected.account!.id }, 'Boş hesap kapatıldı.'); setActiveTable(null); }}>Boş hesabı kapat</button>)}</div></> : <>{selected.needsCleaning ? <><Empty title="Masa temizlik bekliyor" detail="Masa temizlendikten sonra “Temizlendi” ile yeniden siparişe açılır." />{/* Garson; kasiyer de garson yokken (owner's decision); sahip ve müdür gözetmen. */}{(cashier || data.role === 'waiter') &&<button className="btn primary full" onClick={() => void action('/api/staff/tables/clean', { requestId: requestId(), tableId: selected.id, epoch: selected.epoch }, 'Masa siparişe hazır.')}>Temizlendi · Masayı hazırla</button>}</> : <><Empty title="Bu masa yeni siparişe hazır" detail="QR menüyü açabilir veya misafiriniz adına sipariş girebilirsiniz." /><button className="btn primary full" onClick={() => { if (cashier) setCashierAddTable(selected); else { setStaffTable(selected.id); setView('staff'); } setActiveTable(null); }}>Sipariş ekle<ArrowRight size={17} /></button></>}</>}{/* Rarely changed: folded at the bottom so it never pushes "Ödeme al" down; open or closed is remembered. */}{owner && !selected.event && <details className="area-fold" open={areaOpen} onToggle={e => { if (e.currentTarget.open !== areaOpen) rememberArea(e.currentTarget.open); }}><summary>Masa bölümü · <strong>{areaName(selected.area ?? '')}</strong></summary><TableAreaPicker value={selected.area ?? ''} areas={data.tables.map(t => t.area ?? '')} onChange={area => void action('/api/staff/tables/area', { requestId: requestId(), tableId: selected.id, version: data.businessRevision ?? 0, area: area || null }, 'Masa bölümü güncellendi.')} /></details>}</div></Modal>}
    {qr && <QrModal table={qr} business={data.name} onClose={() => setQr(null)} />}
    {cashier && payment && payment.context === data.paymentContext && <PaymentModal key={payment.context + payment.table.account.id} changes={data.orders.filter(o => o.accountId === payment.table.account.id).flatMap(o => (o.changes ?? []).map(c => changeLine(c)))} onLater={isTakeaway(payTable) ? () => setPayment(null) : undefined} context={payment.context} restored={payment.restored} canPay={!!payTable?.account && payTable.account.balance > 0} printing={!!data.printing?.bill} prefer={data.serviceCalls?.find(c => c.kind === 'bill' && c.tableId === payTable?.id)?.method ?? data.billMethods?.find(b => b.tableId === payTable?.id)?.method} onPrintError={(message, retry) => { setError(message); setPrintRetry(retry ? { ...retry, message: 'Ödeme fişi yazdırıldı.' } : null); }} table={payTable?.account ? { name: payTable.name, account: payTable.account } : payment.table} onClose={() => setPayment(null)} onSuccess={async (message, settled, change) => { if (settled) setPayment(null); setToast(settled ? message : ''); if (settled && change) setChangeDue(change); await load(); }} onRefresh={() => void load()} />}
    {editing && <ProductEditor revision={data.revision} subcategoriesKey={JSON.stringify(data.subcategories)} categoriesKey={JSON.stringify(data.categories)} liveProduct={editing === 'new' ? undefined : data.products.find(p => p.id === editing.id && p.published !== false)} initial={editing === 'new' ? null : editing} nextCode={String(Math.max(0, ...[...data.products, ...(data.productDrafts ?? [])].map(p => Number(p.code))) + 1)} onClose={closeEditor} onSave={saveEditor} onDelete={() => { closeEditor(); void load(); }} />}
  </div></PackageProvider>;
}


function Metric({ label, value, suffix, icon, detail }: { label: string; value: string; suffix?: string; icon: React.ReactNode; detail: string }) { return <div className="metric"><div className="metric-top"><span>{label}</span>{icon}</div><div className="metric-value">{value}<small>{suffix}</small></div><small className="muted">{detail}</small></div>; }
/** One table's QR; "QR kodunu indir" saves it with the table's name large and bold under it (src/tableQrCard.ts). */
function QrModal({ table, business, onClose }: { table: TableView; business: string; onClose: () => void }) {
  const [base, setBase] = useState(location.origin); const [image, setImage] = useState(''); const [card, setCard] = useState(''); const localDev = useDevelopment();
  const [network, setNetwork] = useState<Network | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; void api<Network>('/api/staff/network').then(n => { if (!active) return; setNetwork(n); if (n.lan && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && n.addresses.length) setBase(n.addresses[0].origin); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  // İnternetten menü: Mola Merkez's public address once it is ready (any network); this computer's address until then.
  const url = tableQrUrl(network, base, table.token);
  useEffect(() => { let active = true; setImage(''); setCard(''); void QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: '#234c3e', light: '#ffffff' } }).then(value => { if (active) setImage(value); }); void tableQrPng(url, table.name, business).then(value => { if (active) setCard(value); }).catch(() => {}); return () => { active = false; }; }, [url, table.name, business]);
  return <Modal title={`${table.name} · QR menü`} onClose={onClose}><div className="qr-content"><Brand /><h3>Güzel bir mola, bir tarama uzağınızda.</h3>{localDev && network && !network.lan && <Notice tone="error">Telefon erişimi kapalı. Sunucuyu npm run dev:lan ile başlatın ve bu pencereyi yeniden açın.</Notice>}{error && <Notice tone="error">{error}</Notice>}{network && !network.public && network.addresses.length > 1 && <label>Telefon için ağ adresi<select value={base} onChange={e => setBase(e.target.value)}>{network.addresses.map(a => <option value={a.origin} key={a.origin}>{a.name} · {a.origin}</option>)}</select></label>}{image && <img src={image} width="240" height="240" alt={`${table.name} QR kodu`} />}<strong>{table.name}</strong><p className="muted">Menüyü açın, siparişinizi verin.<br />Ödemenizi kasada yapabilirsiniz.</p><a className="btn primary full" href={url} target="_blank" rel="noreferrer">Müşteri menüsünü aç<ArrowUpRight size={17} /></a>{card && <a className="btn secondary full" href={card} download={`${table.name}-qr.png`} onClick={() => recordQrOrigin(qrOrigin(network, base))}>QR kodunu indir</a>}<p className="qr-address">{url}</p>{network?.public && <p className="small muted">Misafir kendi mobil verisiyle ya da herhangi bir Wi-Fi'den açar.</p>}{localDev && <p className="small muted">Telefon ve bilgisayar aynı yerel ağda olmalı. Telefon bağlantısı açılmıyorsa özel ağ güvenlik duvarı ve misafir ağı izolasyonunu kontrol edin.</p>}</div></Modal>;
}


import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, CalendarClock, CalendarPlus, Check, ChevronRight, Cloud, Copy, DatabaseBackup, ExternalLink, FilePenLine, Globe, HardDrive, Hash, KeyRound, Layers, ListTodo, Mail, MapPin, MessageSquarePlus, MessagesSquare, Monitor, Package, Phone, QrCode, Repeat, Share2, ShieldCheck, Snowflake, StickyNote, Trash2, UserRound, Wifi } from 'lucide-react';
import { NewMessage } from './PlatformNewMessage';
import { ApplicationActions, ApplicationFlags, InvoiceSection } from './PlatformApplications';
import type { Ticket } from '../server/license';
import { sameBusinessName, showPhone } from '../packages/domain/invoice';
import { AGREEMENT_VERSION } from '../packages/domain/agreement';
import { api, money, moneyError, moneyInput, parseMoney, requestId } from './api';
import { periodPrice } from '../packages/domain/service-pricing';
import type { CatalogView } from './platformCatalog';
import { Notice } from './components';
import { LicenseFreeze } from './LicenseFreeze';
import { BusinessProgress, PlatformAudit, type AuditEntry } from './PlatformBusiness';
import { BusinessDiagnostics } from './PlatformDiagnostics';
import { ServiceTab } from './PlatformService';
import { ActivationSteps } from './PlatformActivationHelp';
import { PlatformRemoteSupport } from './PlatformRemoteSupport';
// Sunucu yedeği: Özet → "Sunucu yedeği", Lisans → "Yeni bilgisayara taşıma" (src/PlatformCloudBackup.tsx).
import { bytesText, CloudBackupSection, TransferCode, useCloudBackups, type CloudRow, type CloudState } from './PlatformCloudBackup';
import './remote-support.css';
import { TicketChat } from './TicketChat';
import { AgreementSection, IntegritySection } from './PlatformIntegrity';
import { ADMIN, backupWarning, businessStatus, dateTime, expiresSoon, filesChanged, machineSwapOpen, offline, pendingFreeze, planText, qrOrderingFact, rowStatus, seenAgo, shortDate, strongDuplicates, type Business } from './platformStatus';
import { sectorNames } from '../packages/domain/sector';
import { socialEntries, socialHandle, socialInfo, type SocialLinks } from '../packages/domain/social-links';
import { SocialIcon } from './socialIcons';
// Cards, KPI tiles, ⓘ and copy buttons of these tabs (src/PlatformDetailKit.tsx, src/platform-detail.css).
import { CopyButton, DCard, DefList, FactTiles, type Fact, type Row } from './PlatformDetailKit';

export const detailTabs = [['summary', 'Özet'], ['license', 'Lisans'], ['service', 'Hizmet'], ['info', 'Bilgiler'], ['support', 'Destek']] as const;
export type DetailTab = typeof detailTabs[number][0];
type Mutate = (path: string, body: object) => Promise<boolean>;
const planNames: Record<number, string> = { 1: '1 aylık', 6: '6 aylık', 12: '1 yıllık' };
const tabName = (tab: DetailTab) => detailTabs.find(([id]) => id === tab)![1];

/** The café's own backup as its heartbeat said it: result and time of the last try, the last good one. */
function backupFact(b: Business['backup']): Fact {
  const label = 'Son yedek';
  if (!b) return { label, value: '—' };
  if (!b.enabled) return { label, value: 'Kapalı', sub: 'Otomatik yedek kapalı', tone: 'warn' };
  if (b.failing) return { label, value: 'Başarısız', sub: [b.lastAttemptAt && `Son deneme ${dateTime(b.lastAttemptAt)}`, b.lastSuccessAt && `son başarılı ${dateTime(b.lastSuccessAt)}`].filter(Boolean).join(' · ') || undefined, tone: 'bad' };
  return b.lastSuccessAt ? { label, value: dateTime(b.lastSuccessAt), sub: 'Başarılı' } : { label, value: 'Henüz yok' };
}
/** The second backup place (flash disk, OneDrive): set or not, and its last copy. Older cafés do not report it. */
function secondFact(b: Business['backup']): Fact {
  const label = 'İkinci yedek', s = b?.enabled ? b.second : undefined;
  if (!s) return { label, value: '—', sub: b?.enabled ? 'İşletmenin sürümü bildirmiyor' : undefined };
  if (!s.set) return { label, value: 'Ayarlı değil', sub: 'Flash bellek ya da OneDrive seçilebilir', tone: 'warn' };
  if (s.failing) return { label, value: 'Kopya alınamadı', sub: s.lastCopyAt ? `Son başarılı ${dateTime(s.lastCopyAt)}` : undefined, tone: 'bad' };
  return s.lastCopyAt ? { label, value: dateTime(s.lastCopyAt), sub: 'Ayarlı · son kopya' } : { label, value: 'Ayarlı', sub: 'Henüz kopya yok' };
}
/** İnternetten menü: is the café's tunnel up now (guests on mobile data reach the menu only then), and Merkez's own decision. */
function menuFact(l: Business): Pick<Fact, 'value' | 'sub' | 'tone'> {
  if (!l.menu) return { value: '—', sub: 'İşletmenin Mola sürümü eski' };
  if (!l.menu.open) return { value: 'Kapalı', sub: 'Lisans ya da paket' };
  if (l.menu.online) return { value: 'Bağlı', sub: `${l.menu.requests} istek${l.menu.timeouts ? ` · ${l.menu.timeouts} zaman aşımı` : ''}`, tone: 'ok' };
  return { value: 'Bağlı değil', sub: 'Kafe bilgisayarı bağlı değil', tone: 'warn' };
}
/** Sunucu yedeği at Mola Merkez (the same reading as the "Sunucu yedeği" card below). */
function cloudFact(l: Business, state: CloudState | null, row?: CloudRow): Pick<Fact, 'value' | 'sub' | 'tone'> {
  if (l.activation !== 'active') return { value: '—' };
  if (!row) return { value: state ? 'Bilgi yok' : 'Okunuyor…' };
  return { value: row.lastUploadAt ? dateTime(row.lastUploadAt) : 'Henüz yok', sub: `${row.count} kopya · ${bytesText(row.bytes)}`, tone: row.stale ? 'bad' : row.warning ? row.warning.tone : undefined };
}
/** Mola Lisans Sözleşmesi: accepted version (src/PlatformIntegrity.tsx shows the whole line on Lisans). */
function agreementFact(l: Business): Pick<Fact, 'value' | 'sub' | 'tone'> {
  const a = l.agreement;
  if (!a) return { value: 'Kabul edilmedi', sub: l.activation === 'active' ? 'Sonraki girişte sorulur' : 'Etkinleştirmede sorulur', tone: l.activation === 'active' ? 'warn' : undefined };
  return a.version < AGREEMENT_VERSION ? { value: `Sürüm ${a.version}`, sub: `Güncel sürüm ${AGREEMENT_VERSION} sorulacak`, tone: 'warn' } : { value: `Sürüm ${a.version}`, sub: `Kabul ${shortDate(a.acceptedAt)}` };
}

/** tel:, mailto: and a copy button: the vendor calls or writes straight from Mola Yönetim. */
export function ContactLinks({ phone, email, name }: { phone?: string; email?: string; name?: string }) {
  const [copied, setCopied] = useState('');
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(''), 1500); }).catch(() => {}); };
  if (!phone && !email) return null;
  return <div className="contact-links" aria-label="İletişim">{name && <span className="muted">{name}</span>}
    {phone && <span><a className="text-btn" href={`tel:${phone}`}><Phone size={14} />{showPhone(phone)}</a><button type="button" className="icon-btn" aria-label="Telefonu kopyala" onClick={() => copy(phone)}>{copied === phone ? <Check size={14} /> : <Copy size={14} />}</button></span>}
    {email && <span><a className="text-btn" href={`mailto:${email}`}><Mail size={14} />{email}</a><button type="button" className="icon-btn" aria-label="E-postayı kopyala" onClick={() => copy(email)}>{copied === email ? <Check size={14} /> : <Copy size={14} />}</button></span>}
  </div>;
}

/**
 * Business detail as its own page: a back link, the name with one status chip, five tabs centred under it (Özet, Lisans,
 * Hizmet, Bilgiler, Destek). Özet, Lisans, Bilgiler and Destek are cards on the page (src/PlatformDetailKit.tsx); Hizmet keeps
 * its own sheet. The business's own data (menu, tables, owner account, appearance) is not here: it stays on the café computer.
 */
export function BusinessDetail({ business: l, catalog, tickets, audit, tab, onTab, disabled, busy, mutate, onReload, onNewCode, onOpen, onOpenTicket, onAllTickets, onBack }: {
  business: Business; catalog?: CatalogView; tickets: Ticket[]; audit: AuditEntry[]; tab: DetailTab; onTab: (tab: DetailTab) => void; disabled: boolean; busy: boolean;
  mutate: Mutate; onReload: () => void; onNewCode: () => void; onOpen: (tenantId: string) => void; onOpenTicket: (ticketId: string) => void; onAllTickets: () => void; onBack: () => void;
}) {
  const status = rowStatus(l), freeze = pendingFreeze(l), applying = !!l.application && l.application.status !== 'approved';
  const line = [l.sector && sectorNames[l.sector], l.invoice?.city, applying ? 'Hesap açma başvurusu' : planText(l), l.services ? l.services.chosen && l.services.packageName : l.service === 'menu' && 'Sadece QR menü'].filter(Boolean).join(' · ');
  return <section className="platform-detail-page" aria-label={l.name}>
    <button type="button" className="text-btn back-link" aria-label="İşletmeler listesine dön" disabled={busy} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />İşletmeler</button>
    <header className="detail-header">
      <div className="detail-title"><h1>{l.name}</h1><span className={`status-chip ${status.tone}`}>{status.label}</span>{l.activation === 'active' && <span className="version-chip" title="İşletmenin bilgisayarındaki Mola sürümü (son bağlantıda bildirdiği)">{l.appVersion ? `Mola ${l.appVersion}` : 'Sürüm bilinmiyor'}</span>}</div>
      <p className="detail-line">{line}</p>
    </header>
    <nav className="detail-tabs" aria-label="İşletme yönetimi">{detailTabs.map(([id, title]) => { const badge = id === 'support' ? l.openTickets : id === 'license' && (freeze || filesChanged(l)) ? 1 : 0; return <button type="button" key={id} aria-label={title} aria-pressed={tab === id} className={tab === id ? 'active' : ''} disabled={disabled} onClick={() => { if (id !== tab) onTab(id); }}>{title}{badge > 0 && <span className="tab-badge" aria-hidden="true">{id === 'license' ? '!' : badge}</span>}</button>; })}</nav>
    {tab === 'summary' ? <Summary l={l} onTab={onTab} disabled={disabled} mutate={mutate} onOpen={onOpen} />
      : tab === 'license' ? <License l={l} vatRate={catalog?.vatRate ?? 20} disabled={disabled} mutate={mutate} onReload={onReload} onNewCode={onNewCode} onTab={onTab} />
      : tab === 'service' ? <ServiceTab l={l} catalog={catalog} disabled={disabled} mutate={mutate} />
      : tab === 'info' ? <Info l={l} disabled={disabled} mutate={mutate} onOpen={onOpen} audit={audit} tickets={tickets} />
      : <SupportTab l={l} tickets={tickets} audit={audit} disabled={disabled} onReload={onReload} onAllTickets={onAllTickets} />}
  </section>;
}

/**
 * Özet: one look at the business. KPI tiles (state, licence, package, contact, QR orders, internet menu, computers, version,
 * backups, agreement), what needs doing, the vendor's note and the computers side by side, the server backup, and the rest
 * folded under "Diğer bilgiler". An application shows its decision first.
 */
function Summary({ l, onTab, disabled, mutate, onOpen }: { l: Business; onTab: (tab: DetailTab) => void; disabled: boolean; mutate: Mutate; onOpen: (tenantId: string) => void }) {
  const status = businessStatus(l), applying = !!l.application && l.application.status !== 'approved', machines = l.machines ?? [];
  const cloud = useCloudBackups(), row = cloud?.businesses.find(b => b.tenantId === l.tenantId);
  const go = (target: DetailTab) => ({ label: `${tabName(target)} bölümüne git`, onClick: () => onTab(target), disabled });
  const changed = filesChanged(l);
  const facts: Fact[] = applying ? [
    { label: 'Durum', value: status.label, tone: status.tone, icon: <Activity size={18} /> }, { label: 'İşletme türü', value: l.sector ? sectorNames[l.sector] : 'Seçilmedi', icon: <Layers size={18} /> }, { label: 'Yetkili', value: l.contactName || '—', icon: <UserRound size={18} /> },
    { label: 'İlk gönderim', value: dateTime(l.application!.firstSubmittedAt ?? l.application!.submittedAt), icon: <CalendarClock size={18} /> }, { label: 'Son gönderim', value: dateTime(l.application!.submittedAt), icon: <CalendarClock size={18} /> }, { label: 'Gönderim sayısı', value: String(l.application!.submissions ?? 1), icon: <Repeat size={18} /> },
  ] : [
    { label: 'Durum', value: status.label, tone: status.tone, icon: <Activity size={18} /> },
    { label: 'Lisans bitişi', value: l.endsAt ? shortDate(l.endsAt) : 'Başlamadı', sub: l.endsAt ? (l.active ? `${l.daysRemaining} gün kaldı` : 'Süresi doldu') : planText(l), tone: l.endsAt && !l.active ? 'bad' : expiresSoon(l) ? 'warn' : undefined, icon: <CalendarClock size={18} />, accent: 'info', go: go('license') },
    { label: 'Paket', value: l.services ? l.services.packageName : l.service === 'menu' ? 'Sadece QR menü' : 'Tam sistem', sub: l.services ? `${l.services.features.length} hizmet${l.services.chosen ? ` · ${money(l.services.price.monthly)}/ay` : ''}` : undefined, icon: <Package size={18} />, accent: 'ok', go: go('service') },
    { label: 'Son bağlantı', value: l.activation === 'pending' ? 'Etkinleştirilmedi' : seenAgo(l.lastSeenAt), sub: l.lastSeenAt ? dateTime(l.lastSeenAt) : undefined, tone: offline(l) && !l.suspended ? 'bad' : undefined, icon: <Wifi size={18} />, accent: 'info' },
    // QR siparişleri açık mı (8 Ekim): the café's word over its tunnel (server/qr-ordering.ts), closed while the café is away.
    { label: 'QR siparişleri', ...qrOrderingFact(l), icon: <QrCode size={18} />, accent: 'ok' },
    { label: 'İnternetten menü', ...menuFact(l), icon: <Globe size={18} />, accent: 'info' },
    { label: 'Bilgisayarlar', value: machines.length ? `${machines.length} bilgisayar` : '—', sub: machines.length > 1 ? 'İki farklı bilgisayar · aşağıda' : machines.length ? 'Etkin' : undefined, tone: machines.length > 1 ? 'warn' : undefined, icon: <Monitor size={18} /> },
    { label: 'Sürüm', value: l.appVersion || '—', sub: changed ? 'Dosyalar değiştirilmiş' : l.integrity?.state === 'ok' ? 'Dosyalar imzalı listeyle aynı' : undefined, tone: changed ? 'bad' : undefined, icon: <ShieldCheck size={18} />, ...(changed ? { go: go('license') } : {}) },
    { ...backupFact(l.backup), icon: <DatabaseBackup size={18} />, accent: 'ok' },
    { ...secondFact(l.backup), icon: <HardDrive size={18} />, accent: 'ok' },
    { label: 'Sunucu yedeği', ...cloudFact(l, cloud, row), icon: <Cloud size={18} />, accent: 'info' },
    { label: 'Sözleşme', ...agreementFact(l), icon: <FilePenLine size={18} />, go: go('license') },
  ];
  const more: [string, string][] = applying ? [] : [
    ['Kurulum', l.setupCompleted ? `Tamamlandı${l.setupCompletedAt ? ' · ' + shortDate(l.setupCompletedAt) : ''}` : 'Bekleniyor'], ['Masa · çalışan · ürün', l.counts ? `${l.counts.tables} · ${l.counts.staff} · ${l.counts.products}` : '—'],
    ['Hizmet paketi', l.services ? `${l.services.packageName}${l.services.chosen ? ` · ${money(l.services.price.monthly)}/ay` : ''}` : l.service === 'menu' ? 'Sadece QR menü' : 'Tam sistem'], ['Yetkili', l.contactName || '—'], ['İlk giriş', l.firstLoginAt ? dateTime(l.firstLoginAt) : 'Henüz yok'], ['Hesap açıldı', l.createdAt ? shortDate(l.createdAt) : '—'],
    ['İnternetten menü', !l.menu ? 'Henüz yok (işletmenin Mola sürümü eski)' : !l.menu.open ? 'Kapalı (lisans ya da paket)' : l.menu.online ? `Bağlı · ${l.menu.requests} istek${l.menu.timeouts ? ` · ${l.menu.timeouts} zaman aşımı` : ''}` : 'Kafe bilgisayarı bağlı değil'],
    // Menünün Mola Merkez'deki kopyası: guests browse it while the café is away (server/merkez/menu-mirror.ts).
    ['Menünün kopyası', l.menu?.mirror ? `${dateTime(l.menu.mirror.updatedAt)} · ${l.menu.mirror.products} ürün · ${l.menu.mirror.photos} fotoğraf · ${(l.menu.mirror.bytes / 1048576).toFixed(1).replace('.', ',')} MB` : l.menu ? 'Henüz gelmedi' : '—'],
  ];
  const next: [string, DetailTab | null][] = [];
  if (l.activation === 'pending' && !applying) next.push(['İşletme etkinleştirme kodunu henüz kullanmadı.', 'license']);
  if (l.suspended) next.push(['Hizmet askıda: müşteri menüsü ve yeni sipariş kapalı.', 'license']);
  else if (l.endsAt && !l.active && !l.frozen) next.push(['Lisans süresi doldu: müşteri menüsü ve yeni sipariş kapalı.', 'license']);
  if (pendingFreeze(l)) next.push(['Dondurma isteği onay bekliyor.', 'license']);
  if (l.openTickets > 0) next.push([`${l.openTickets} açık destek talebi var.`, 'support']);
  if (l.activation === 'active' && !l.setupCompleted) next.push(['İşletme sahibi ilk girişte kurulumu tamamlamalı.', null]);
  else if (l.activation === 'active' && l.kind === 'trial' && !l.endsAt) next.push(['Kurulum tamamlandı; denemeyi başlatabilirsiniz.', 'license']);
  if (expiresSoon(l)) next.push([`Lisans ${l.daysRemaining} gün içinde bitiyor.`, 'license']);
  if (offline(l)) next.push([`İşletmenin bilgisayarı bir gündür bağlanmadı (${seenAgo(l.lastSeenAt)}).`, null]);
  if (backupWarning(l)) next.push(['İşletmenin otomatik yedeği eski veya başarısız.', null]);
  if (l.backup?.enabled && l.backup.second && !l.backup.second.set) next.push([`İkinci yedek yeri ayarlı değil${l.secondMissingSince ? ` (${shortDate(l.secondMissingSince)} tarihinden beri)` : ''}: işletme şerit → Yedekle → İkinci yedek yeri’nden flash bellek ya da OneDrive seçebilir.`, null]);
  if (machineSwapOpen(l)) next.push(['Bu lisans birden fazla bilgisayardan kullanıldı (İki farklı bilgisayar).', null]);
  if (changed) next.push(['Dosyalar değiştirilmiş: işletmenin bilgisayarındaki Mola program dosyaları imzalı listeyle uyuşmuyor.', 'license']);
  if (l.neverConnected && strongDuplicates(l).length) next.push(['Bu kayıt hiç bağlanmadı ve başka bir kaydın tekrarı olabilir; gerekmiyorsa Lisans bölümünün altından silebilirsiniz.', 'license']);
  const progressing = !applying && (l.activation === 'pending' || !l.setupCompleted || !l.endsAt);
  return <div className="detail-sheet dsheet">
    {applying && <DCard title="Hesap açma başvurusu" icon={<ListTodo size={20} />} tone="warn" className="detail-application">
      <p className="section-lead">{l.application!.status === 'pending' ? 'İşletme onay bekliyor. Onaylarsanız 30 günlük deneme başlar; işletmenin bilgisayarı birkaç saniye içinde sahip hesabı ve kuruluma geçer.' : `Reddedildi: ${l.application!.reason ?? ''}`}</p>
      <ApplicationFlags l={l} onOpen={onOpen} disabled={disabled} repeats={false} />
      <ApplicationActions l={l} disabled={disabled} mutate={mutate} /></DCard>}
    <section className="detail-section dsheet-bare" aria-label="Genel durum">
      <FactTiles facts={facts} label="Genel durum" />
      {l.kind === 'trial' && l.endsAt && !l.suspended && <p className="detail-trial-note">{l.source === 'application' ? 'Deneme, başvuru onaylanınca başladı; başka onay gerekmez.' : 'Deneme kendiliğinden başladı; onay gerekmez.'} Ücretli aboneliğe Lisans bölümünden geçirilir (kalan deneme süresi korunur).</p>}
      {l.suspended && l.suspendReason && <p className="detail-trial-note muted-note">Askıya alma nedeni: {l.suspendReason}</p>}
    </section>
    {next.length > 0 && <DCard title="Sıradaki işler" icon={<ListTodo size={20} />} tone="warn" className="detail-next" actions={<span className="status-chip warn">{next.length}</span>}>
      <ul>{next.map(([text, target]) => <li key={text}>{target
        ? <button type="button" disabled={disabled} onClick={() => onTab(target)}><span className="next-dot" aria-hidden="true" /><span className="next-text">{text}</span><span className="next-go">{tabName(target)}<ChevronRight size={15} aria-hidden="true" /></span></button>
        : <p><span className="next-dot" aria-hidden="true" /><span className="next-text">{text}</span></p>}</li>)}</ul></DCard>}
    <div className="dpair">
      <Notes l={l} disabled={disabled} mutate={mutate} />
      <Machines l={l} disabled={disabled} mutate={mutate} />
    </div>
    <CloudBackupSection l={l} disabled={disabled} />
    {progressing && <BusinessProgress license={l} />}
    {more.length > 0 && <section className="detail-section dcard dmore" aria-label="Diğer bilgiler"><details><summary><span className="dcard-icon idle" aria-hidden="true"><Layers size={20} /></span><span className="dmore-title">Diğer bilgiler</span><ChevronRight className="dmore-chevron" size={18} aria-hidden="true" /></summary>
      <dl className="detail-more">{more.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details></section>}
  </div>;
}

/**
 * Lisans in cards: the term (days left, plan, delivered or not), "Süreyi uzat" with "Ödeme alındı", the plan, freezes and the
 * agreement, the program-file check, the codes, and the dangerous actions apart at the bottom ("Dikkat").
 */
function License({ l, vatRate, disabled, mutate, onReload, onNewCode, onTab }: { l: Business; vatRate: number; disabled: boolean; mutate: Mutate; onReload: () => void; onNewCode: () => void; onTab: (tab: DetailTab) => void }) {
  // Starting to pay or adding a term asks once more on the same button; the question clears after 8 s.
  const [confirming, setConfirming] = useState('');
  useEffect(() => { if (!confirming) return; const t = setTimeout(() => setConfirming(''), 8000); return () => clearTimeout(t); }, [confirming]);
  // "Ödeme alındı": the payment for the term being added goes to Satışlarım in the same step.
  const [pay, setPay] = useState<PaymentDraft>(() => ({ on: true, amount: '', edited: false, method: 'transfer', invoiceNo: '', status: 'paid' }));
  const months = confirming ? Number(confirming.slice(5)) : l.kind === 'trial' ? 1 : l.planMonths ?? 12;
  const suggested = l.services ? periodPrice(l.services.price, months) : 0;
  useEffect(() => { setPay(p => p.edited ? p : { ...p, amount: suggested ? moneyInput(suggested) : '' }); }, [suggested]);
  const payProblem = pay.on ? moneyError(pay.amount, { min: 0 }) : '';
  const status = businessStatus(l), pending = l.activation === 'pending', applying = !!l.application && l.application.status !== 'approved';
  const license = (months: number, suspended = l.suspended, why?: string) => mutate(`${ADMIN}/licenses`, { tenantId: l.tenantId, expectedEnd: l.endsAt, expectedSuspended: l.suspended, months, suspended, ...(why ? { reason: why } : {}),
    ...(months > 0 && pay.on ? { payment: { net: parseMoney(pay.amount), vatRate, method: pay.method, status: pay.status, ...(pay.invoiceNo.trim() ? { invoiceNo: pay.invoiceNo.trim() } : {}) } } : {}) });
  const waitingTrial = !pending && l.kind === 'trial' && !l.endsAt;
  /** Paid plans ask "Emin misiniz?" once: a trial becomes a paid subscription, or a term is added. */
  const paid = (months: number) => { const key = `paid-${months}`; if (confirming !== key) { setConfirming(key); return; } if (payProblem) return; setConfirming(''); void license(months).then(ok => { if (ok) setPay(p => ({ ...p, edited: false, invoiceNo: '' })); }); };
  const term = (months: number) => months === 12 ? '1 yıl' : `${months} ay`;
  // An extension only adds time: a yearly subscription stays yearly (and keeps its freeze rights).
  const paidLabel = (months: number) => confirming === `paid-${months}` ? (l.kind === 'trial' ? `Emin misiniz? ${planNames[months]} abonelik başlar` : `Emin misiniz? ${term(months)} eklenir`) : l.kind === 'trial' ? `${planNames[months]} aboneliğe geçir` : `${term(months)} uzat`;
  const running = !!l.endsAt && l.active, open = !applying && !pending;
  const freezes = l.freezes ?? [];
  return <div className="detail-sheet dsheet">
    <DCard title="Lisans süresi" icon={<KeyRound size={20} />} className="license-status-card" tip="Lisanstaki her değişiklik (uzatma, plan, askı, dondurma) işletmenin bilgisayarına en geç 10 dakikada ulaşır; bilgisayar açık ve internete bağlı olmalı.">
      {applying ? <Notice>Başvuru onaylanınca 30 günlük ücretsiz deneme başlar. Kararı Özet bölümünden ya da Başvurular sayfasından verin.</Notice> : pending ? <Notice>İşletme Mola’yı etkinleştirdiğinde lisans başlar. Seçilen plan: {planText(l)}.</Notice> : <>
        <div className="license-hero">
          <div className={`license-days${running && l.daysRemaining <= 7 ? ' warn' : ''}${l.endsAt && !l.active ? ' bad' : ''}`}>{running ? <><strong>{l.daysRemaining}</strong><span>gün kaldı</span></> : <span>{l.endsAt ? 'Süresi doldu' : 'Başlamadı'}</span>}</div>
          <div className="license-hero-text">
            <p className="license-summary"><strong>{l.kind === 'trial' ? 'Ücretsiz deneme' : planText(l)}</strong> · {status.label}{l.endsAt && <> · Bitiş: {shortDate(l.endsAt)}</>}</p>
            <p className={`license-delivery ${l.licenseDelivered ? 'ok' : 'warn'}`} role="status">{l.licenseDelivered ? '✓ Son lisans işletmenin bilgisayarına ulaştı.' : `Son değişiklik işletmenin bilgisayarına henüz ulaşmadı${l.lastSeenAt ? ` (son bağlantı ${seenAgo(l.lastSeenAt)})` : ''}.`}</p>
          </div>
        </div>
        {waitingTrial && <p className="section-lead">{l.setupCompleted ? 'Kurulum tamamlandı. Denemeyi başlattığınızda sipariş alınabilir.' : 'İşletme sahibi ilk kurulumu tamamlamalı. Hazırlık sırasında deneme süresi işlemez.'}</p>}
        {(waitingTrial || l.suspended) && <div className="license-primary">
          {waitingTrial && <button className="btn primary" disabled={disabled || !l.setupCompleted || l.suspended} onClick={() => void mutate(`${ADMIN}/trials/start`, { tenantId: l.tenantId })}>30 günlük denemeyi başlat</button>}
          {l.suspended && <button className="btn primary" disabled={disabled} onClick={() => void license(0, false)}>Hizmeti aç</button>}
        </div>}
      </>}
    </DCard>
    {/* Files changed is urgent: right under the term. Otherwise the check is a small card beside the agreement. */}
    {filesChanged(l) && <IntegritySection l={l} />}
    {open && <DCard title={l.kind === 'trial' ? 'Ücretli aboneliğe geçir' : 'Süreyi uzat'} icon={<CalendarPlus size={20} />} className="platform-license-section" tip={`Uzatma bitiş tarihine (bitmişse bugüne) eklenir. Her değişiklik işletmenin bilgisayarına en geç 10 dakikada ulaşır.${l.kind === 'trial' ? ' Kalan deneme süresi korunur.' : ''} Ödeme açıksa tutar uzatmayla birlikte Satışlarım’a kaydedilir.`}>
      {l.kind === 'trial' && l.services && <p className="section-note">Aboneliğe geçince “{l.services.packageName}” geçerli olur ({l.services.features.length} hizmet).{!l.services.chosen && ' Paket seçilmedi: bütün hizmetler açık kalır.'} <button type="button" className="text-btn inline-link" onClick={() => onTab('service')}>Hizmet bölümünde değiştir</button></p>}
      <PaymentCard pay={pay} onPay={setPay} months={months} suggested={suggested} packageName={l.services?.packageName} vatRate={vatRate} problem={payProblem} disabled={disabled} />
      <div className="license-actions">{[1, 6, 12].map(n => <button className={`btn ${confirming === `paid-${n}` ? 'primary' : 'secondary'}`} disabled={disabled} key={n} onClick={() => paid(n)}>{paidLabel(n)}</button>)}</div>
      <p className="section-note">{l.kind === 'trial' ? 'Kalan deneme süresi korunur.' : `Uzatma yalnız süre ekler; plan (${planText(l).toLocaleLowerCase('tr-TR')}) ve dondurma hakkı değişmez.`}</p>
    </DCard>}
    {open && l.kind !== 'trial' && <PlanChange l={l} disabled={disabled} onChange={plan => mutate(`${ADMIN}/licenses`, { tenantId: l.tenantId, expectedEnd: l.endsAt, expectedSuspended: l.suspended, months: 0, suspended: l.suspended, plan })} />}
    <div className="dpair">
      {open && <DCard title="Hizmeti dondurma" icon={<Snowflake size={20} />} tone="info" className="dcard-freeze" tip="Yıllık abonelikte 12 ayda bir, en fazla 60 gün. Onaylanan tarihlerde menü ve yeni sipariş kapanır; kalan lisans süresi korunur. Süre sonunda otomatik açılır. Tarihler Türkiye saatidir. İsteği işletme sahibi kasa bilgisayarından gönderir.">
        {!freezes.length && <p className="dcard-quiet">{l.kind !== 'trial' && l.planMonths === 12 ? 'Dondurma isteği yok.' : 'Dondurma yalnız yıllık abonelikte var.'}</p>}
        <LicenseFreeze license={l} platform onSaved={onReload} />
      </DCard>}
      {(l.agreement || l.activation === 'active') && <AgreementSection l={l} />}
      {!filesChanged(l) && <IntegritySection l={l} />}
    </div>
    {pending && !applying && <DCard title="Etkinleştirme kodu" icon={<KeyRound size={20} />} tip="Kod yalnız oluşturulduğunda gösterilir. Yeni kod eskisini geçersiz kılar.">
      <p className="dcard-quiet">{l.codeExpiresAt ? `Kod ${dateTime(l.codeExpiresAt)} tarihine kadar geçerli.` : 'Geçerli bir etkinleştirme kodu yok.'}</p>
      {/* Where the code goes (the café's computer) and the one-business rule (src/PlatformActivationHelp.tsx). */}
      <ActivationSteps compact />
      <div className="application-actions"><button className="btn secondary small-btn" disabled={disabled} onClick={onNewCode}><KeyRound size={15} />Yeni kod oluştur</button></div></DCard>}
    <div className="dpair">
      <OwnerResetCode l={l} disabled={disabled} onIssued={onReload} />
      <TransferCode l={l} disabled={disabled} />
    </div>
    <section className="detail-section dcard detail-danger" aria-label="Dikkat"><header className="dcard-head"><span className="dcard-icon bad" aria-hidden="true"><AlertTriangle size={20} /></span><h2>Dikkat</h2></header>
      {open && !l.suspended && <Suspend l={l} disabled={disabled} license={license} />}
      <DeleteRecord l={l} disabled={disabled} mutate={mutate} />
    </section>
  </div>;
}

type PaymentDraft = { on: boolean; amount: string; edited: boolean; method: 'cash' | 'transfer' | 'card'; invoiceNo: string; status: 'paid' | 'unpaid' };
/**
 * "Ödeme alındı" beside the extension buttons: the amount comes from the business's package price × the term being added
 * (editable, KDV hariç), how it was paid, the invoice number, paid or not yet. Saved to Satışlarım with the extension.
 */
function PaymentCard({ pay, onPay, months, suggested, packageName, vatRate, problem, disabled }: { pay: PaymentDraft; onPay: (p: PaymentDraft) => void; months: number; suggested: number; packageName?: string; vatRate: number; problem: string; disabled: boolean }) {
  const net = parseMoney(pay.amount), ok = !problem && Number.isFinite(net);
  return <div className={`payment-card${pay.on ? ' on' : ''}`} role="group" aria-label="Ödeme alındı">
    <label className="switch-line"><input type="checkbox" checked={pay.on} disabled={disabled} onChange={e => onPay({ ...pay, on: e.target.checked })} /><span className="switch" aria-hidden="true" /><span><strong>Ödeme alındı</strong><small>Uzatmayla birlikte Satışlarım’a kaydedilir.</small></span></label>
    {pay.on && <div className="payment-fields">
      <label className="payment-amount">Tutar (KDV hariç)<span className="money-input"><span className="affix">₺</span><input inputMode="decimal" disabled={disabled} value={pay.amount} aria-invalid={!!problem} onChange={e => onPay({ ...pay, amount: e.target.value, edited: true })} /></span>
        <small className="muted">{suggested ? `Önerilen: ${money(suggested)} · ${packageName ?? 'paket'} · ${months === 12 ? '1 yıl' : `${months} ay`}` : 'Bu işletmenin paket fiyatı yok; tutarı yazın.'}{pay.edited && suggested ? <> · <button type="button" className="text-btn inline-link" onClick={() => onPay({ ...pay, amount: moneyInput(suggested), edited: false })}>önerileni kullan</button></> : null}</small>
        {problem && <small className="field-problem">{problem}</small>}</label>
      <div className="payment-total" aria-live="polite"><span>KDV %{vatRate}</span><b>{ok ? money(Math.round(net * vatRate / 100)) : '—'}</b><span>Toplam</span><b className="big">{ok ? money(net + Math.round(net * vatRate / 100)) : '—'}</b></div>
      <div className="payment-pills"><span className="pill-label">Yöntem</span><div className="platform-pills" role="radiogroup" aria-label="Ödeme yöntemi">{([['cash', 'Nakit'], ['transfer', 'Havale / EFT'], ['card', 'Kart']] as const).map(([k, t]) => <button type="button" role="radio" key={k} aria-checked={pay.method === k} className={pay.method === k ? 'active' : ''} disabled={disabled} onClick={() => onPay({ ...pay, method: k })}>{t}</button>)}</div></div>
      <label>Fatura no <span className="muted small">(isteğe bağlı)</span><input maxLength={60} disabled={disabled} value={pay.invoiceNo} placeholder="ör. MOL2026000123" onChange={e => onPay({ ...pay, invoiceNo: e.target.value })} /></label>
      <div className="payment-pills"><span className="pill-label">Durum</span><div className="platform-pills" role="radiogroup" aria-label="Ödeme durumu">{([['paid', 'Ödendi'], ['unpaid', 'Henüz ödenmedi']] as const).map(([k, t]) => <button type="button" role="radio" key={k} aria-checked={pay.status === k} className={pay.status === k ? 'active' : ''} disabled={disabled} onClick={() => onPay({ ...pay, status: k })}>{t}</button>)}</div></div>
    </div>}
  </div>;
}

/**
 * "Abonelik planı": the plan itself (aylık, 6 aylık, yıllık), apart from adding time. The end date does not move; freezing
 * is only for yearly plans. Asks once more on the same button.
 */
function PlanChange({ l, disabled, onChange }: { l: Business; disabled: boolean; onChange: (plan: 1 | 6 | 12) => Promise<boolean> }) {
  const [asking, setAsking] = useState(0), current = l.planMonths ?? 12;
  useEffect(() => { if (!asking) return; const t = setTimeout(() => setAsking(0), 5000); return () => clearTimeout(t); }, [asking]);
  return <DCard title="Abonelik planı" icon={<Repeat size={20} />} tone="info" className="plan-change-card" tip="Plan değişince bitiş tarihi değişmez. Dondurma hakkı yalnız yıllık planda vardır.">
    <div className="plan-change" role="group" aria-label="Abonelik planı">
      <div className="license-actions">{([1, 6, 12] as const).map(n => <button type="button" key={n} aria-pressed={current === n} className={`btn ${asking === n ? 'primary' : 'secondary'}${current === n ? ' current-plan' : ''}`} disabled={disabled || current === n}
        onClick={() => { if (asking !== n) { setAsking(n); return; } setAsking(0); void onChange(n); }}>{asking === n ? `Emin misiniz? ${planNames[n]} plana geçer` : current === n ? `${planNames[n]} (şu anki)` : `${planNames[n]} plana geç`}</button>)}</div>
    </div>
  </DCard>;
}

/** "Askıya al" with a reason only the vendor sees. */
function Suspend({ l, disabled, license }: { l: Business; disabled: boolean; license: (months: number, suspended?: boolean, why?: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState('');
  if (!open) return <div className="danger-row"><span>Müşteri menüsü ve yeni siparişler kapanır; açık hesaplar kapatılabilir, destek açık kalır.</span><button className="btn delete-catalog small-btn" disabled={disabled} onClick={() => { setOpen(true); setReason(''); }}>Askıya al</button></div>;
  return <form className="suspend-form" onSubmit={e => { e.preventDefault(); void license(0, true, reason.trim()).then(ok => { if (ok) setOpen(false); }); }}>
    <label>Askıya alma nedeni (yalnız Mola Yönetim’de görünür)<input required minLength={3} maxLength={300} disabled={disabled} value={reason} placeholder="ör. Ödeme gecikti" onChange={e => setReason(e.target.value)} /></label>
    <p className="muted small">Müşteri menüsü ve yeni siparişler kapanır; açık hesaplar kapatılabilir, destek açık kalır. “{l.name}” için Lisans bölümünden yeniden açabilirsiniz.</p>
    <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => setOpen(false)}>Vazgeç</button><button className="btn delete-catalog small-btn" disabled={disabled || reason.trim().length < 3}>Askıya al</button></div>
  </form>;
}

/**
 * Sosyal medya (read-only): the links the café's heartbeat last carried; its permanent social QR codes forward to them through
 * Mola Merkez while the licence is active. Only the business changes them (Ayarlar → İşletme → Sosyal medya).
 */
function SocialSection({ l }: { l: Business }) {
  const entries = socialEntries(l.social?.links as SocialLinks | undefined);
  return <DCard title="Sosyal medya" icon={<Share2 size={20} />} tone="info" className="detail-social" tip={`İşletmenin kalıcı QR kodları Mola Merkez üzerinden bu bağlantılara yönlenir; askıdayken çalışmaz. Bağlantıları yalnız işletme değiştirir (Ayarlar → İşletme → Sosyal medya).${l.social?.updatedAt ? ` Son değişiklik: ${shortDate(l.social.updatedAt)}.` : ''}`}>
    {entries.length ? <ul className="detail-social-list">{entries.map(e => <li key={e.platform}><span className="social-icon-tile" aria-hidden="true"><SocialIcon platform={e.platform} size={16} /></span><span className="social-name">{socialInfo[e.platform].name}</span><a href={e.url} target="_blank" rel="noopener noreferrer">{socialHandle(e.platform, e.url)}</a><ExternalLink className="social-out" size={14} aria-hidden="true" /></li>)}</ul>
      : <p className="dcard-quiet">{l.social ? 'İşletme sosyal medya bağlantısı eklememiş.' : 'İşletmenin bilgisayarı henüz sosyal medya bağlantısı göndermedi.'}</p>}
  </DCard>;
}

/**
 * Bilgiler: how to reach them and where they are, the invoice details (copy and edit), the social links (read-only), the
 * computer and install, possible repeats, and this business's history.
 */
function Info({ l, disabled, mutate, onOpen, audit, tickets }: { l: Business; disabled: boolean; mutate: Mutate; onOpen: (tenantId: string) => void; audit: AuditEntry[]; tickets: Ticket[] }) {
  const applying = !!l.application && l.application.status !== 'approved', i = l.invoice, machines = l.machines ?? [];
  const contact: Row[] = [
    ...(l.contactName ? [{ label: 'Yetkili', value: l.contactName, copy: l.contactName, copyLabel: 'Yetkili adını kopyala' }] : []),
    ...(i?.phone ? [{ label: 'Telefon', value: <a href={`tel:${i.phone}`}>{showPhone(i.phone)}</a>, copy: i.phone, copyLabel: 'Telefonu kopyala', action: <a className="dicon-btn" href={`tel:${i.phone}`} aria-label="Ara" title="Ara"><Phone size={16} aria-hidden="true" /></a> }] : []),
    ...(i?.email ? [{ label: 'E-posta', value: <a href={`mailto:${i.email}`}>{i.email}</a>, copy: i.email, copyLabel: 'E-postayı kopyala', action: <a className="dicon-btn" href={`mailto:${i.email}`} aria-label="E-posta yaz" title="E-posta yaz"><Mail size={16} aria-hidden="true" /></a> }] : []),
  ];
  const place = i ? `${i.address}, ${i.district} / ${i.city}` : '';
  const active = machines.find(m => m.active);
  const device: Row[] = [
    { label: 'Mola sürümü', value: l.appVersion || '—' },
    { label: 'Bilgisayar', value: machines.length ? `${machines.length === 1 ? 'Tek bilgisayar' : `${machines.length} bilgisayar`}${active ? ` · etkin #${active.hash.slice(0, 8)}` : ''}` : '—', tone: machines.length > 1 ? 'warn' : undefined },
    ...(l.installId ? [{ label: 'Kurulum no', value: <code>#{l.installId.slice(0, 8)}</code>, copy: l.installId, copyLabel: 'Kurulum numarasını kopyala' }] : []),
    { label: 'Etkinleştirme', value: l.activation === 'active' ? (l.activatedAt ? dateTime(l.activatedAt) : 'Etkin') : 'Bekleniyor' },
    { label: 'Kurulum', value: l.setupCompleted ? `Tamamlandı${l.setupCompletedAt ? ` · ${shortDate(l.setupCompletedAt)}` : ''}` : 'Bekleniyor' },
    { label: 'İlk giriş', value: l.firstLoginAt ? dateTime(l.firstLoginAt) : 'Henüz yok' },
    { label: 'Son bağlantı', value: l.activation === 'pending' ? 'Henüz yok' : `${seenAgo(l.lastSeenAt)}${l.lastSeenAt ? ` · ${dateTime(l.lastSeenAt)}` : ''}` },
    { label: 'Masa · çalışan · ürün', value: l.counts ? `${l.counts.tables} · ${l.counts.staff} · ${l.counts.products}` : '—' },
    { label: 'Hesap açıldı', value: l.createdAt ? shortDate(l.createdAt) : '—' },
  ];
  return <div className="detail-sheet dsheet">
    <div className="dpair">
      <DCard title="İletişim" icon={<UserRound size={20} />} tip="Telefon ve e-posta fatura bilgileriyle birlikte girilir (aşağıda “Düzenle”).">
        {contact.length ? <DefList rows={contact} label="İletişim bilgileri" /> : <p className="dcard-quiet">Telefon ya da e-posta yok.</p>}
        {!applying && <ApplicationFlags l={l} onOpen={onOpen} disabled={disabled} repeats={false} />}
      </DCard>
      <DCard title="Adres" icon={<MapPin size={20} />} tone="info" tip="Fatura adresi; fatura bilgileriyle birlikte değiştirilir.">
        {i ? <DefList rows={[{ label: 'Açık adres', value: i.address, copy: place, copyLabel: 'Adresi kopyala' }, { label: 'İlçe / il', value: `${i.district} / ${i.city}` }]} label="Adres" /> : <p className="dcard-quiet">Adres yok.</p>}
      </DCard>
    </div>
    <InvoiceSection l={l} disabled={disabled} mutate={mutate} />
    <div className="dpair">
      <SocialSection l={l} />
      <DCard title="Cihaz ve kurulum" icon={<Monitor size={20} />} tone="idle" tip="İşletmenin bilgisayarının son bağlantıda bildirdikleri. Lisans aynı anda yalnız bir bilgisayarda çalışır (ayrıntı Özet → Bilgisayarlar).">
        <DefList rows={device} label="Cihaz ve kurulum" />
      </DCard>
    </div>
    {!!l.duplicates?.length && <DCard title={strongDuplicates(l).length ? 'Olası tekrar' : 'Benzer kayıtlar'} label="Olası tekrar kayıtlar" icon={<Hash size={20} />} tone="warn" className="detail-duplicates" tip="Aynı vergi no, aynı telefon ya da e-posta, ya da aynı bilgisayardan farklı vergi no ile açılmış kayıtlar. Yalnız adın benzemesi tekrar sayılmaz.">
      <ul>{l.duplicates.map(o => <li key={o.tenantId} className={o.strong === false ? 'soft' : ''}><button type="button" className="text-btn" disabled={disabled} onClick={() => onOpen(o.tenantId)}>{o.name}<ChevronRight size={14} aria-hidden="true" /></button><small className="muted">{o.reasons?.join(' · ') ?? (o.sameComputer ? 'Aynı bilgisayar' : 'Aynı ad')}{o.createdAt ? ` · ${shortDate(o.createdAt)}` : ''} · {o.neverConnected ? 'Hiç bağlanmadı' : 'Bağlandı'}</small></li>)}</ul></DCard>}
    <PlatformAudit audit={audit} licenses={[l]} tickets={tickets} tenantId={l.tenantId} title="Bu işletmenin geçmişi" />
  </div>;
}

/** Destek: this business's tickets as a chat (src/TicketChat.tsx, answered in place), remote support and its error reports. */
function SupportTab({ l, tickets, audit, disabled, onReload, onAllTickets }: { l: Business; tickets: Ticket[]; audit: AuditEntry[]; disabled: boolean; onReload: () => void; onAllTickets: () => void }) {
  const own = tickets.filter(t => t.tenantId === l.tenantId);
  const [selected, setSelected] = useState(''), [writing, setWriting] = useState(false), [sent, setSent] = useState('');
  const events = audit.filter(a => a.action === 'ticket.closed').map(a => ({ ticketId: a.target, kind: 'closed' as const, at: a.at }));
  // "Yeni mesaj": only to a business that has a computer (activated); the new conversation opens here once the list has it.
  const canWrite = l.activation === 'active';
  useEffect(() => { if (sent && own.some(t => t.id === sent)) { setSelected(sent); setSent(''); } }, [sent, own]);
  const phone = l.invoice?.phone, email = l.invoice?.email;
  return <div className="detail-sheet dsheet">
    <DCard title="Destek talepleri" icon={<MessagesSquare size={20} />} className="detail-support" tip="İşletmenin talepleri burada sohbet olarak açılır ve yerinde yanıtlanır. “Yeni mesaj” yalnız Mola’yı etkinleştirmiş işletmeye gider; işletmenin Destek ekranında okunmamış olarak görünür."
      actions={<>
        <span className={`status-chip ${l.openTickets > 0 ? 'warn' : 'idle'}`}>{l.openTickets > 0 ? `${l.openTickets} açık destek talebi` : 'Açık destek talebi yok'}</span>
        {own.length > 0 && <button type="button" className="dicon-btn" aria-label="Destek sayfasında aç" title="Destek sayfasında aç" disabled={disabled} onClick={onAllTickets}><ExternalLink size={16} aria-hidden="true" /></button>}
        {canWrite && <button type="button" className="btn primary small-btn" disabled={disabled} onClick={() => setWriting(true)}><MessageSquarePlus size={16} aria-hidden="true" />Yeni mesaj</button>}
      </>}>
      {own.length ? <TicketChat side="support" tickets={own} selected={selected} onSelect={setSelected} onSaved={onReload} events={events} names={new Map([[l.tenantId, l.name]])} />
        : <div className="dsupport-empty"><span className="dsupport-empty-icon" aria-hidden="true"><MessagesSquare size={26} /></span><strong>Henüz yazışma yok</strong><p>{canWrite ? 'Bu işletmeyle henüz yazışma yok. “Yeni mesaj” ile siz başlatabilirsiniz.' : 'Bu işletme henüz destek talebi açmadı.'}</p></div>}
      {writing && <NewMessage tenantId={l.tenantId} name={l.name} onClose={() => setWriting(false)} onSent={id => { setWriting(false); setSent(id); onReload(); }} />}
      {(phone || email) && <div className="dsupport-contact" aria-label="İletişim">
        {l.contactName && <span className="dsupport-contact-name"><UserRound size={15} aria-hidden="true" />{l.contactName}</span>}
        {phone && <span className="dchip"><a href={`tel:${phone}`}><Phone size={14} aria-hidden="true" />{showPhone(phone)}</a><CopyButton text={phone} label="Telefonu kopyala" /></span>}
        {email && <span className="dchip"><a href={`mailto:${email}`}><Mail size={14} aria-hidden="true" />{email}</a><CopyButton text={email} label="E-postayı kopyala" /></span>}
      </div>}
    </DCard>
    <PlatformRemoteSupport tenantId={l.tenantId} name={l.name} disabled={disabled} />
    <details className="detail-section dcard detail-errors"><summary><span className="dcard-icon idle" aria-hidden="true"><ShieldCheck size={20} /></span><span className="dmore-title">Hata kayıtları</span><ChevronRight className="dmore-chevron" size={18} aria-hidden="true" /></summary><BusinessDiagnostics tenantId={l.tenantId} /></details>
  </div>;
}

/** The vendor's own notes about this business (never sent to the café). */
function Notes({ l, disabled, mutate }: { l: Business; disabled: boolean; mutate: Mutate }) {
  const [text, setText] = useState(l.notes ?? ''), [saved, setSaved] = useState(false);
  useEffect(() => { setText(l.notes ?? ''); }, [l.notes]);
  return <DCard title="Satıcı notu" icon={<StickyNote size={20} />} tone="warn" className="detail-notes" tip="Yalnız Mola Yönetim’de görünür; işletmeye gönderilmez.">
    <textarea rows={3} maxLength={4000} disabled={disabled} value={text} aria-label="Satıcı notu" placeholder="ör. 15 Ekim’de yıllık ödeme yapacak." onChange={e => { setText(e.target.value); setSaved(false); }} />
    <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled || text === (l.notes ?? '')} onClick={() => void mutate(`${ADMIN}/notes`, { tenantId: l.tenantId, notes: text }).then(ok => setSaved(ok))}>Notu kaydet</button><small className="ok saved-mark">{saved ? 'Kaydedildi' : ''}</small></div>
  </DCard>;
}

/** Computers that used this install. More than one: a move (fine) or a copy ("İki farklı bilgisayar"). */
function Machines({ l, disabled, mutate }: { l: Business; disabled: boolean; mutate: Mutate }) {
  const [asking, setAsking] = useState('');
  if (!l.machines?.length) return null;
  return <DCard title="Bilgisayarlar" icon={<Monitor size={20} />} tone="idle" className="detail-machines" tip="Lisans aynı anda yalnız bir bilgisayarda çalışır. Yeni bir bilgisayar bağlanınca o etkin olur, eskisinde sipariş kapanır.">
    <ul>{l.machines.slice().reverse().map((m, i) => <li key={m.hash}><span className="machine-name"><strong>Bilgisayar {l.machines!.length - i}</strong> <code>#{m.hash.slice(0, 8)}</code></span>
      {m.active ? <span className="status-chip ok">Etkin</span> : <span className="status-chip idle">Sipariş kapalı{m.replacedAt ? ` · ${shortDate(m.replacedAt)}` : ''}</span>}
      <small className="muted machine-dates">İlk: {dateTime(m.firstSeenAt)} · Son: {dateTime(m.lastSeenAt)}</small>
      {!m.active && <button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => { if (asking !== m.hash) { setAsking(m.hash); return; } setAsking(''); void mutate(`${ADMIN}/installs/machine`, { tenantId: l.tenantId, machine: m.hash }); }}>{asking === m.hash ? 'Emin misiniz? Diğerinde sipariş kapanır' : 'Eski bilgisayarı yeniden etkinleştir'}</button>}
    </li>)}</ul></DCard>;
}

/**
 * "Sahip şifresi sıfırlama kodu ver": for an owner who lost both the password and the recovery code. Shown once; read it out
 * on the phone after checking who is calling. One use, 30 minutes, only at this business's own computer (desktop window).
 * Merkez never sees the owner's username or the new password.
 */
function OwnerResetCode({ l, disabled, onIssued }: { l: Business; disabled: boolean; onIssued: () => void }) {
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  if (l.activation !== 'active') return null;
  async function make() {
    setBusy(true); setError(''); setCopied(false);
    try { setIssued(await api<{ code: string; expiresAt: string }>(`${ADMIN}/owner-reset-codes`, { requestId: requestId(), tenantId: l.tenantId })); onIssued(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <DCard title="Sahip şifresi sıfırlama" icon={<KeyRound size={20} />} tone="warn" className="detail-owner-reset" tip="İşletme sahibi hem şifresini hem kurtarma kodunu kaybettiyse, arayanın sahip olduğundan emin olduktan sonra kullanın. Sahip kodu kasa bilgisayarındaki Mola penceresinde girer: sol şerit → Güvenlik → “İşletme sahibi şifresini unuttum” → “Mola ekibinden kod”. Kod tek kullanımlık, 30 dakika geçerli.">
    {l.suspended ? <p className="dcard-quiet">Hizmet askıdayken şifre sıfırlama kodu verilemez.</p>
      : issued ? <div className="owner-reset-issued"><p className="activation-code" data-testid="owner-reset-code">{issued.code}</p>
        <p className="muted small">Tek kullanımlık; {dateTime(issued.expiresAt)} saatine kadar geçerli. Kodu işletme sahibine telefonda okuyun. Bu kod bir daha gösterilmez; yenisi eskisini geçersiz kılar.</p>
        <div className="application-actions"><button type="button" className="btn secondary small-btn" onClick={() => { void navigator.clipboard?.writeText(issued.code).then(() => setCopied(true)).catch(() => {}); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Kopyalandı' : 'Kodu kopyala'}</button><button type="button" className="btn secondary small-btn" onClick={() => setIssued(null)}>Kapat</button></div></div>
      : <><p className="dcard-quiet">Şifresini ve kurtarma kodunu kaybeden sahip için tek kullanımlık kod.</p><div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled || busy} onClick={() => void make()}><KeyRound size={15} />Sahip şifresi sıfırlama kodu ver</button></div></>}
    {error && <Notice tone="error">{error}</Notice>}
  </DCard>;
}

/**
 * "Kaydı sil". A record that never connected (a half-made or repeated application or trial, an unused code): two steps. A
 * connected business: first "Askıya al", then the name typed again; its café stays locked for good, its sales data stays
 * there. Merkez checks every rule again and writes it to the history.
 */
function DeleteRecord({ l, disabled, mutate }: { l: Business; disabled: boolean; mutate: Mutate }) {
  const [asking, setAsking] = useState(false), [typed, setTyped] = useState('');
  if (!l.neverConnected && !l.suspended) return <div className="detail-delete danger-row"><span className="muted">Bu işletme Mola Merkez’e bağlandı. Önce askıya alın, sonra silebilirsiniz.</span></div>;
  if (!l.neverConnected) return <div className="detail-delete">
    {asking ? <form className="detail-delete-confirm" role="alertdialog" aria-label="Kaydı silme onayı" onSubmit={e => { e.preventDefault(); if (sameBusinessName(typed, l.name)) void mutate(`${ADMIN}/businesses/delete`, { tenantId: l.tenantId, confirmName: typed }); }}>
      <p><strong>“{l.name}” kaydı kalıcı olarak silinsin mi?</strong></p>
      <p>İşletmenin bilgisayarındaki Mola kilitli kalır ve bir daha lisans alamaz. Satış verileri işletmenin bilgisayarında kalır; Mola Merkez’de satış verisi zaten yoktur. Bu işlem geri alınamaz.</p>
      <label>Onaylamak için işletmenin adını yazın: <strong>{l.name}</strong><input autoComplete="off" maxLength={200} disabled={disabled} value={typed} onChange={e => setTyped(e.target.value)} /></label>
      <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => { setAsking(false); setTyped(''); }}>Vazgeç</button><button className="btn delete-catalog small-btn" disabled={disabled || !sameBusinessName(typed, l.name)}><Trash2 size={14} />Evet, kalıcı olarak sil</button></div></form>
      : <div className="danger-row"><span>Hizmet askıda. Bu işletmeyle artık çalışılmayacaksa kaydı kalıcı olarak silebilirsiniz.</span><button type="button" className="btn delete-catalog small-btn" disabled={disabled} onClick={() => setAsking(true)}><Trash2 size={14} />Kaydı sil</button></div>}
  </div>;
  return <div className="detail-delete">
    {asking ? <div className="detail-delete-confirm" role="alertdialog" aria-label="Kaydı silme onayı"><p><strong>“{l.name}” kaydı silinsin mi?</strong> Bu işletme hiç bağlanmadı; silinince lisansı ve etkinleştirme bilgisi de silinir.</p>
      <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => setAsking(false)}>Vazgeç</button><button type="button" className="btn delete-catalog small-btn" disabled={disabled} onClick={() => void mutate(`${ADMIN}/businesses/delete`, { tenantId: l.tenantId })}><Trash2 size={14} />Evet, kaydı sil</button></div></div>
      : <div className="danger-row"><span>Bu işletme hiç bağlanmadı. Yarım kalmış ya da tekrar eden bir kayıtsa silebilirsiniz.</span><button type="button" className="btn delete-catalog small-btn" disabled={disabled} onClick={() => setAsking(true)}><Trash2 size={14} />Kaydı sil</button></div>}
  </div>;
}

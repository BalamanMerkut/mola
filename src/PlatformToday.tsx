import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Phone } from 'lucide-react';
import type { Ticket } from '../server/license';
import { showPhone } from '../packages/domain/invoice';
import { api } from './api';
import { awaitsSupport } from './ticketOrder';
import { PlatformSummary } from './PlatformDirectory';
import { diskLow, useCloudBackups } from './PlatformCloudBackup';
import type { DetailTab } from './PlatformDetail';
import { ADMIN, backupWarning, expiresSoon, filesChanged, longOffline, machineSwapOpen, offlineDays, openApplication, pendingApplication, pendingFreeze, runningPaid, runningTrial, seenAgo, shortDate, type Business, type Tone } from './platformStatus';

export type SettingsSection = 'security' | 'backup' | 'updates' | 'email' | 'contact' | 'audit' | 'workfolder' | 'developer';
type MerkezBackup = { backup: { auto: boolean; lastSuccessAt?: string; lastError?: string } | null; recovery: { available: boolean; confirmed: boolean } | null; local: boolean };
type MailQueue = { settings: { enabled: boolean } | null; queue: { id: string; createdAt: string; failed: boolean; error?: string }[] };
type Todo = { key: string; rank: number; tone: Tone; text: ReactNode; action: string; onAction: () => void; phone?: string };
const DAY = 86400_000;

/** Merkez's own backup and e-mail state: not in /state, read here every minute (the same calls as Ayarlar). */
function useMerkezHealth() {
  const [backup, setBackup] = useState<MerkezBackup | null>(null), [mail, setMail] = useState<MailQueue | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      void api<MerkezBackup>(`${ADMIN}/backup`).then(r => { if (live) setBackup(r); }, () => {});
      void api<MailQueue>(`${ADMIN}/email`).then(r => { if (live) setMail(r); }, () => {});
    };
    read(); const t = setInterval(read, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return { backup, mail };
}

/**
 * "Bugün": what needs the vendor today, one sentence and one button each, most urgent first. Built only from what Merkez
 * already knows (applications, tickets, licences, heartbeats, its own backup and e-mail queue). Nothing to do: a calm line.
 */
export function PlatformToday({ businesses, tickets, onApplications, onTicket, onBusiness, onSettings, onFilter, siteLeads = 0, onSiteLeads }: {
  businesses: Business[]; tickets: Ticket[]; onApplications: () => void; onTicket: (ticketId: string, tenantId: string) => void;
  onBusiness: (tenantId: string, tab?: DetailTab) => void; onSettings: (section: SettingsSection) => void; onFilter: (filter: 'running' | 'trial' | 'expiring') => void;
  /** Web sitesi talepleri not called yet (src/PlatformSiteLeads.tsx). */
  siteLeads?: number; onSiteLeads?: () => void;
}) {
  const { backup, mail } = useMerkezHealth(), cloud = useCloudBackups(), now = Date.now(), todos: Todo[] = [];
  const name = (l: Business) => <strong>{l.name}</strong>;
  const open = (l: Business, tab?: DetailTab) => () => onBusiness(l.tenantId, tab);
  const b = backup?.backup;
  if (b && (b.lastError || (b.auto && (!b.lastSuccessAt || now - Date.parse(b.lastSuccessAt) > 36 * 3600_000))))
    todos.push({ key: 'merkez-backup', rank: 0, tone: 'bad', text: b.lastError ? <>Mola Merkez’in son yedeği alınamadı: {b.lastError}</> : <>Mola Merkez’in son yedeği {b.lastSuccessAt ? `${shortDate(b.lastSuccessAt)} tarihinde alındı` : 'henüz alınmadı'}.</>, action: 'Yedeğe bak', onAction: () => onSettings('backup') });
  // Sunucu yedeği (src/PlatformCloudBackup.tsx): Merkez's disk for the cafés' copies, and cafés with no upload for 2 days.
  if (diskLow(cloud)) todos.push({ key: 'cloud-disk', rank: 0, tone: 'bad', text: <>Mola Merkez diskinde kafelerin sunucu yedekleri için yer azaldı.</>, action: 'Yedeğe bak', onAction: () => onSettings('backup') });
  for (const row of cloud?.businesses.filter(x => x.stale) ?? []) {
    const l = businesses.find(x => x.tenantId === row.tenantId);
    if (l && !l.suspended) todos.push({ key: `cloud-${l.tenantId}`, rank: 7, tone: 'warn', text: <>{name(l)} {cloud!.staleDays} günden uzun süredir sunucu yedeği göndermedi{row.lastUploadAt ? ` (son: ${shortDate(row.lastUploadAt)})` : ''}.</>, action: 'İşletmeyi aç', onAction: open(l), phone: l.invoice?.phone });
  }
  // A café's copy refused for its size, near the per-copy cap, or a large total: the vendor raises the cap or plans the disk.
  for (const row of cloud?.businesses.filter(x => x.warning) ?? []) {
    const l = businesses.find(x => x.tenantId === row.tenantId);
    if (l && !l.suspended) todos.push({ key: `cloud-size-${l.tenantId}`, rank: row.warning!.tone === 'bad' ? 5 : 8, tone: row.warning!.tone, text: <>{name(l)}: {row.warning!.text}</>, action: 'İşletmeyi aç', onAction: open(l) });
  }
  for (const l of businesses) {
    if (openApplication(l)) continue;
    if (l.endsAt && !l.active && !l.suspended && !l.frozen && now - Date.parse(l.endsAt) < 30 * DAY)
      todos.push({ key: `expired-${l.tenantId}`, rank: 1, tone: 'bad', text: <>{name(l)} lisansının süresi {shortDate(l.endsAt)} tarihinde doldu; menü ve yeni sipariş kapalı.</>, action: 'Lisansı aç', onAction: open(l, 'license'), phone: l.invoice?.phone });
    else if (expiresSoon(l) && l.daysRemaining <= 7)
      todos.push({ key: `ending-${l.tenantId}`, rank: 1, tone: 'bad', text: <>{name(l)} {l.kind === 'trial' ? 'denemesi' : 'lisansı'} {l.daysRemaining === 0 ? 'bugün' : `${l.daysRemaining} gün sonra`} bitiyor ({shortDate(l.endsAt)}).</>, action: 'İşletmeyi aç', onAction: open(l, 'license'), phone: l.invoice?.phone });
    else if (expiresSoon(l))
      todos.push({ key: `ending-${l.tenantId}`, rank: 8, tone: 'warn', text: <>{name(l)} {l.kind === 'trial' ? 'denemesi' : 'lisansı'} {l.daysRemaining} gün sonra bitiyor ({shortDate(l.endsAt)}).</>, action: 'İşletmeyi aç', onAction: open(l, 'license'), phone: l.invoice?.phone });
    if (pendingFreeze(l)) todos.push({ key: `freeze-${l.tenantId}`, rank: 4, tone: 'warn', text: <>{name(l)} hizmeti dondurmak istiyor.</>, action: 'İsteği incele', onAction: open(l, 'license') });
    // Settled by the vendor ("Eski bilgisayarı yeniden etkinleştir"): off the list until another computer turns up.
    // Program dosyaları denetimi: the café's program differs from its signed list; the vendor decides (call, "Askıya al").
    if (filesChanged(l) && !l.suspended) todos.push({ key: `files-${l.tenantId}`, rank: 5, tone: 'bad', text: <>{name(l)} işletmesinin bilgisayarında Mola program dosyaları değiştirilmiş.</>, action: 'İncele', onAction: open(l, 'license'), phone: l.invoice?.phone });
    if (machineSwapOpen(l, now)) todos.push({ key: `machine-${l.tenantId}`, rank: 5, tone: 'warn', text: <>{name(l)} lisansı yeni bir bilgisayarda kullanılmaya başladı (iki farklı bilgisayar).</>, action: 'İşletmeyi aç', onAction: open(l), phone: l.invoice?.phone });
    if (longOffline(l, now)) todos.push({ key: `offline-${l.tenantId}`, rank: 6, tone: 'warn', text: <>{name(l)} {offlineDays(l, now)} gündür Mola Merkez’e bağlanmadı (son bağlantı {seenAgo(l.lastSeenAt, now)}).</>, action: 'İşletmeyi aç', onAction: open(l), phone: l.invoice?.phone });
    if (backupWarning(l, now) && !l.suspended) todos.push({ key: `backup-${l.tenantId}`, rank: 7, tone: 'warn', text: <>{name(l)} işletmesinin otomatik yedeği {l.backup?.failing ? 'başarısız' : 'eski'}.</>, action: 'İşletmeyi aç', onAction: open(l), phone: l.invoice?.phone });
    if (l.activation === 'active' && l.kind === 'trial' && !l.endsAt && l.setupCompleted && !l.suspended)
      todos.push({ key: `trial-${l.tenantId}`, rank: 3, tone: 'info', text: <>{name(l)} kurulumu tamamladı; deneme başlatılmayı bekliyor.</>, action: 'Denemeyi başlat', onAction: open(l, 'license') });
  }
  for (const t of tickets.filter(awaitsSupport)) {
    const l = businesses.find(x => x.tenantId === t.tenantId), since = t.messages.at(-1)?.at ?? t.createdAt;
    todos.push({ key: `ticket-${t.id}`, rank: 2, tone: 'warn', text: <>{l ? name(l) : 'Bir işletme'} yanıt bekliyor: “{t.subject}” <span className="muted">({seenAgo(since, now).toLocaleLowerCase('tr-TR')})</span></>, action: 'Talebi aç', onAction: () => onTicket(t.id, t.tenantId) });
  }
  const applications = businesses.filter(pendingApplication);
  if (applications.length > 3) todos.push({ key: 'applications', rank: 3, tone: 'warn', text: <>{applications.length} hesap açma başvurusu onay bekliyor.</>, action: 'Başvurulara git', onAction: onApplications });
  else for (const l of applications) todos.push({ key: `application-${l.tenantId}`, rank: 3, tone: 'warn', text: <>{name(l)} hesap açma başvurusu gönderdi; onay bekliyor.</>, action: 'Başvuruyu incele', onAction: onApplications });
  if (siteLeads > 0) todos.push({ key: 'site-leads', rank: 3, tone: 'warn', text: <>{siteLeads === 1 ? 'Web sitesinden 1 talep' : `Web sitesinden ${siteLeads} talep`} aranmayı bekliyor.</>, action: 'Talepleri aç', onAction: onSiteLeads ?? onApplications });
  const failed = mail?.queue.filter(m => m.failed && now - Date.parse(m.createdAt) < 7 * DAY) ?? [];
  if (failed.length) todos.push({ key: 'mail', rank: 9, tone: 'warn', text: <>{failed.length} e-posta bildirimi gönderilemedi{failed.at(-1)?.error ? `: ${failed.at(-1)!.error}` : '.'}</>, action: 'E-posta ayarları', onAction: () => onSettings('email') });
  if (backup?.local && backup.recovery && !backup.recovery.confirmed)
    todos.push({ key: 'recovery', rank: 10, tone: 'info', text: <>Mola Merkez’in kurtarma kodu henüz kaydedilmedi. Bilgisayar değişirse yedeği açmak için gerekir.</>, action: 'Kodu göster', onAction: () => onSettings('backup') });
  todos.sort((a, b) => a.rank - b.rank);
  const running = businesses.filter(runningPaid).length, trial = businesses.filter(runningTrial).length;
  const today = new Date(now).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', weekday: 'long' });
  return <div className="platform-today">
    <header className="page-head"><div><h1>Bugün yapılacaklar</h1><p className="page-lead">{today} · {todos.length ? `${todos.length} iş, en acil olan en üstte.` : 'Bekleyen iş yok.'}</p></div></header>
    <PlatformSummary businesses={businesses} onFilter={onFilter} />
    {todos.length ? <ul className="today-list" aria-label="Bugün yapılacaklar">{todos.map(t => <li key={t.key} className={`today-item tone-${t.tone}`}>
      <span className="today-dot" aria-hidden="true" />
      <p id={`todo-${t.key}`}>{t.text}</p>
      <span className="today-actions">{t.phone && <a className="text-btn today-call" href={`tel:${t.phone}`} title={showPhone(t.phone)} aria-label={`Ara: ${showPhone(t.phone)}`}><Phone size={15} aria-hidden="true" />Ara</a>}<button type="button" className="btn secondary small-btn" aria-describedby={`todo-${t.key}`} onClick={t.onAction}>{t.action}</button></span>
    </li>)}</ul>
      : <section className="today-calm" role="status"><CheckCircle2 size={30} strokeWidth={1.6} aria-hidden="true" /><div><h2>Her şey yolunda</h2><p>{running} işletme çalışıyor, {trial} işletme denemede.</p></div></section>}
  </div>;
}

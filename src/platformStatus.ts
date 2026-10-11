import type { License } from '../server/license';
import { ApiError } from './api';
import type { Invoice } from '../packages/domain/invoice';
import type { Sector } from '../packages/domain/sector';
import type { ServicesView } from './platformCatalog';

/** API of the vendor's Mola Yönetim, served only by Mola Merkez (server/merkez/app.ts). */
export const ADMIN = '/api/merkez/admin';
/**
 * One business as Mola Merkez lists it: the licence summary plus what the café's heartbeat reports (setup, counts,
 * backup health, version, last seen). Never sales, payments, menus or staff accounts: those stay on the café computer.
 */
export type Business = License & {
  daysRemaining: number; active: boolean; frozen: boolean; setupCompleted: boolean; setupCompletedAt?: string; sector?: Sector;
  appVersion: string; openTickets: number; contactName?: string; formerNames?: string[]; installId?: string; source?: 'trial' | 'code' | 'import' | 'admin' | 'application'; serial?: number;
  activation: 'pending' | 'active'; activatedAt?: string; codeExpiresAt?: string; lastActivityAt?: string;
  counts?: { tables: number; staff: number; products: number };
  /** The café's backup as its heartbeat reported it; `lastAttemptAt` and `second` only from cafés of this version on. */
  backup?: { enabled: boolean; lastSuccessAt: string | null; failing: boolean; lastAttemptAt?: string | null; second?: { set: boolean; lastCopyAt: string | null; failing: boolean } };
  /** Since when the café has reported no second backup place. */
  secondMissingSince?: string;
  /** Other records that may be the same café, each with why (strong signals; a soft note when only the name and two weak fields match). */
  duplicates?: Duplicate[];
  /** No heartbeat ever (no owner account, no ticket, not imported): only such a record can be deleted. */
  neverConnected?: boolean;
  invoice?: Invoice; application?: ApplicationView;
  /** Only for the vendor: other businesses with the same tax number, and whether the phone or e-mail is used elsewhere. */
  sameTax?: { tenantId: string; name: string }[]; sameContact?: { phone: boolean; email: boolean };
  /** Computers that sent heartbeats for this install (HMAC ids); more than one: a move or a copy ("İki farklı bilgisayar"). */
  machines?: MachineView[];
  /** The install's own last heartbeat; lastSeenAt is already the later of it and the business report. */
  installSeenAt?: string;
  /** The café's last heartbeat carried the newest signed licence. */
  licenseDelivered?: boolean;
  notes?: string; suspendReason?: string;
  /** Hizmet: the package (or Özel) and its services, the price for this business (server/merkez/catalog.ts servicesView). */
  services?: ServicesView;
  /** "Tanıtım işletmesi" (Hizmet; server/merkez/demo.ts) and the last "Tanıtımı sıfırla" order and how it went. */
  demo?: boolean; demoSince?: string;
  demoReset?: { id: string; sector: Sector; demoPassword: boolean; requestedAt: string; status: 'pending' | 'done' | 'failed' | 'expired'; doneAt?: string; error?: string };
  /** Mola Lisans Sözleşmesi as the café sent it (activation or heartbeat); missing: not accepted yet (or an older café). */
  agreement?: { version: number; acceptedAt: string; name?: string; receivedAt: string };
  /** Program dosyaları denetimi: the café computer's latest result (server/merkez/integrity.ts); missing from older cafés. */
  integrity?: IntegrityView;
  /** Sosyal medya: the public links the café last sent (its social QR codes' short addresses forward to them); read-only. */
  social?: { code: string; links: Partial<Record<string, string>>; updatedAt: string };
  /** İnternetten menü: the menu code and the café's tunnel right now (server/merkez/guest-tunnel.ts; counters only). */
  menu?: { code: string; since: string; open: boolean; online: boolean; connectedAt?: string; requests: number; errors: number; timeouts: number;
    /** QR siparişleri as the café said it over the tunnel (8 Ekim): null = not in its service; missing = not told (café away, older café). */
    ordering?: { open: boolean; reason?: string; since?: string; call: boolean } | null;
    /** Menünün kopyası at Merkez: when it came, products, photos, bytes (missing: none yet, older café). */
    mirror?: { updatedAt: string; products: number; photos: number; bytes: number } };
};
export type IntegrityView = { state: 'ok' | 'changed' | 'unknown'; version: string; platform: string; changed: string[]; missing: string[]; signatureFailed?: boolean; manifestChanged?: boolean; firstSeenAt?: string; checkedAt: string; receivedAt: string };
/** "Dosyalar değiştirilmiş": the café's program files differ from the signed list of its version (the vendor decides what to do). */
export const filesChanged = (l: Pick<Business, 'integrity'>) => l.integrity?.state === 'changed';
export type MachineView = { hash: string; firstSeenAt: string; lastSeenAt: string; active: boolean; replacedAt?: string; restoredAt?: string };
/**
 * "İki farklı bilgisayar" still needs the vendor: a computer was replaced in the last 7 days and the vendor has not settled
 * it since ("Eski bilgisayarı yeniden etkinleştir" marks the chosen one `restoredAt`).
 */
export function machineSwapOpen(l: Pick<Business, 'machines'>, now = Date.now()) {
  const machines = l.machines ?? [];
  const swapped = machines.map(m => m.replacedAt ?? '').filter(at => at && now - Date.parse(at) < 7 * 86400_000).sort().at(-1);
  const settled = machines.map(m => m.restoredAt ?? '').sort().at(-1) ?? '';
  return !!swapped && swapped > settled;
}
export type Duplicate = { tenantId: string; name: string; createdAt?: string; sameComputer: boolean; neverConnected: boolean; strong?: boolean; reasons?: string[] };
/** Only strong hints count as "Olası tekrar" in lists and next steps (older Merkez answers had no `strong`: all count). */
export const strongDuplicates = (l: Business) => (l.duplicates ?? []).filter(d => d.strong !== false);
export type AlertPriority = 'low';
export type ApplicationView = { status: 'pending' | 'rejected' | 'approved'; submittedAt: string; firstSubmittedAt?: string; submissions?: number; decidedAt?: string; reason?: string; duplicateTax?: boolean; branch?: boolean;
  /** The tax number belonged to a business the vendor deleted after it had connected (flag only; approval still works). */
  deletedTax?: boolean };
/** "Başvurular": waiting for the vendor, or refused and waiting for the café's correction. */
export const openApplication = (l: Business) => !!l.application && l.application.status !== 'approved';
export const pendingApplication = (l: Business) => l.application?.status === 'pending';
/**
 * "Bitiyor": the chip, the Bugün summary and the Bugün rows use the same window: 30 days for a paid licence, 7 for a trial
 * (a new 30-day trial is "Denemede", not "Bitiyor", until its last week).
 */
export const EXPIRING_DAYS = 30, TRIAL_EXPIRING_DAYS = 7;
export const pendingFreeze = (l: Pick<License, 'freezes'>) => !!l.freezes?.some(f => f.status === 'pending');
/** Waiting for the admin: an open support ticket or a freeze request to approve. */
export const waitsForAdmin = (l: Business) => l.openTickets > 0 || pendingFreeze(l);
export const expiresSoon = (l: Pick<Business, 'active' | 'endsAt' | 'daysRemaining' | 'kind'>) => l.active && !!l.endsAt && l.daysRemaining <= (l.kind === 'trial' ? TRIAL_EXPIRING_DAYS : EXPIRING_DAYS);
/** The café computer has not been heard from for a day (closed, no internet): worth a call before the owner notices. */
export const OFFLINE_MS = 24 * 3600_000;
export const offline = (l: Business, now = Date.now()) => l.activation === 'active' && (!l.lastSeenAt || now - Date.parse(l.lastSeenAt) > OFFLINE_MS);
/** The café's own nightly backup is failing or older than 36 hours (as its heartbeat reported it). */
export const backupWarning = (l: Business, now = Date.now()) => !!l.backup?.enabled && (l.backup.failing || !l.backup.lastSuccessAt || now - Date.parse(l.backup.lastSuccessAt) > 36 * 3600_000);
// Short chip names; the setup wizard and Ayarlar keep the long "Tatlıcı / Pastane".
export const sectorChip: Record<Sector, string> = { cafe: 'Kafe', restaurant: 'Restoran', dessert: 'Tatlıcı' };
export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';
/** Offline long enough to call the café (the same 3 days as the "İşletme 3 gündür bağlanmadı" alert). */
export const LONG_OFFLINE_MS = 3 * 24 * 3600_000;
export const longOffline = (l: Business, now = Date.now()) => l.activation === 'active' && !l.suspended && !!l.lastSeenAt && now - Date.parse(l.lastSeenAt) > LONG_OFFLINE_MS;
/** Days since the café was last heard from (whole days, at least 1). */
export const offlineDays = (l: Business, now = Date.now()) => l.lastSeenAt ? Math.max(1, Math.floor((now - Date.parse(l.lastSeenAt)) / 86400_000)) : 0;
/** A running trial or a paid licence that is on: what "Çalışıyor" / "Denemede" count. */
export const runningPaid = (l: Business) => l.active && l.kind !== 'trial' && !l.suspended;
export const runningTrial = (l: Business) => l.active && l.kind === 'trial' && !l.suspended;
/**
 * The one chip a business row shows: the most important thing about it, in plain words. Applications are not here
 * (they have their own page).
 */
export function rowStatus(l: Business, now = Date.now()): { label: string; tone: Tone } {
  if (l.application?.status === 'pending') return { label: 'Başvuru bekliyor', tone: 'warn' };
  if (l.application?.status === 'rejected') return { label: 'Başvuru reddedildi', tone: 'idle' };
  if (l.activation === 'pending') return { label: 'Kod bekleniyor', tone: 'idle' };
  if (l.suspended) return { label: 'Askıda', tone: 'idle' };
  if (l.frozen) return { label: 'Donduruldu', tone: 'idle' };
  if (l.endsAt && !l.active) return { label: 'Süresi doldu', tone: 'bad' };
  if (offline(l, now)) return { label: 'Bağlantı yok', tone: 'bad' };
  if (!l.endsAt) return { label: l.setupCompleted ? 'Başlatılmadı' : 'Kurulum bekliyor', tone: 'idle' };
  if (l.kind === 'trial') return { label: `Deneme · ${l.daysRemaining} gün`, tone: l.daysRemaining <= 7 ? 'warn' : 'info' };
  if (expiresSoon(l)) return { label: `${l.daysRemaining} gün kaldı`, tone: 'warn' };
  return { label: 'Çalışıyor', tone: 'ok' };
}
export function businessStatus(l: Business): { label: string; tone: Tone } {
  if (l.application?.status === 'pending') return { label: 'Onay bekliyor', tone: 'warn' };
  if (l.application?.status === 'rejected') return { label: 'Reddedildi', tone: 'bad' };
  if (l.activation === 'pending') return { label: 'Etkinleştirme bekliyor', tone: 'idle' };
  if (l.suspended) return { label: 'Askıda', tone: 'idle' };
  if (l.frozen) return { label: 'Donduruldu', tone: 'idle' };
  if (!l.endsAt) return { label: 'Başlatılmadı', tone: 'idle' };
  if (!l.active) return { label: 'Süresi doldu', tone: 'bad' };
  return { label: 'Çalışıyor', tone: 'ok' };
}
export function planText(l: Pick<Business, 'kind' | 'planMonths'>) {
  return l.kind === 'trial' ? 'Ücretsiz deneme' : l.planMonths === 12 ? 'Yıllık abonelik' : l.planMonths === 6 ? '6 aylık abonelik' : l.planMonths === 1 ? 'Aylık abonelik' : 'Abonelik';
}
export const shortDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '';
export const dateTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
/** "5 dk önce", "3 saat önce", "2 gün önce": how long since the café computer last reported in. */
export function seenAgo(iso?: string | null, now = Date.now()) {
  if (!iso) return 'Hiç bağlanmadı';
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return minutes < 2 ? 'Az önce' : minutes < 60 ? `${minutes} dk önce` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} saat önce` : `${Math.round(minutes / 1440)} gün önce`;
}
/** "Bildirim merkezi" entries (server/merkez/alerts.ts). */
export type AlertView = { id: string; kind: string; title: string; text: string; at: string; tenantId?: string; ticketId?: string; readAt?: string; priority?: AlertPriority };
const fold = (s: string) => s.toLocaleLowerCase('tr-TR');
/**
 * One search box for everything the vendor remembers about a café: name, VKN/TCKN, phone (with or without 0/+90), e-mail,
 * the contact person, legal name, a ticket subject or number.
 */
export function matchesSearch(l: Business, query: string, tickets: { id: string; tenantId: string; subject: string }[] = []) {
  const q = fold(query.trim()); if (!q) return true;
  const digits = q.replace(/\D/g, ''), i = l.invoice;
  const text = fold([l.name, ...(l.formerNames ?? []), l.contactName, i?.legalName, i?.email, i?.taxOffice, i?.city, i?.district, ...tickets.filter(t => t.tenantId === l.tenantId).flatMap(t => [t.subject, t.id])].filter(Boolean).join(' '));
  if (text.includes(q)) return true;
  if (digits.length >= 4 && i && (i.taxNumber.includes(digits) || i.phone.replace(/\D/g, '').includes(digits.replace(/^0/, '')))) return true;
  return false;
}
/**
 * One CSV cell. Anything a spreadsheet would read as a formula (=, +, -, @, tab, CR at the start: the application form is
 * public, so a "business name" can be "=HYPERLINK(…)") gets a leading apostrophe and stays text; quotes, ";" and line breaks
 * are quoted. A phone "+90…" therefore stays text too (Excel would make it a number).
 */
export const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Today's date in Türkiye (YYYY-AA-GG) for file names: not UTC (at 01:49 it is already the new day here). */
export const localDay = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
/** Businesses with their invoice fields, for the e-arşiv program and spreadsheets (";" separated, UTF-8 with BOM for Excel). */
export function businessesCsv(items: Business[]) {
  const head = ['İşletme', 'Durum', 'Plan', 'Hizmet', 'Bitiş', 'Yetkili', 'Ticari unvan', 'Mükellef', 'Vergi dairesi', 'VKN/TCKN', 'İl', 'İlçe', 'Adres', 'Telefon', 'E-posta', 'Son bağlantı', 'Sürüm', 'Hesap açıldı'];
  const rows = items.map(l => [l.name, businessStatus(l).label, planText(l), l.services?.packageName ?? (l.service === 'menu' ? 'Sadece QR menü' : 'Tam sistem'), shortDate(l.endsAt), l.contactName, l.invoice?.legalName, l.invoice ? (l.invoice.taxType === 'company' ? 'Şirket' : 'Şahıs') : '', l.invoice?.taxOffice, l.invoice?.taxNumber, l.invoice?.city, l.invoice?.district, l.invoice?.address, l.invoice?.phone, l.invoice?.email, l.lastSeenAt ? dateTime(l.lastSeenAt) : '', l.appVersion, shortDate(l.createdAt)]);
  return '\uFEFF' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
/** "0.1.10" > "0.1.9" (numbers, not letters); a pre-release part ("-beta") counts as older. */
export function compareVersion(a: string, b: string) {
  const parts = (v: string) => { const [main, pre] = v.trim().replace(/^v/, '').split('-', 2); return { nums: main.split('.').map(n => Number(n) || 0), pre: pre ?? '' }; };
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) { const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0); if (d) return Math.sign(d); }
  return x.pre === y.pre ? 0 : !x.pre ? 1 : !y.pre ? -1 : x.pre < y.pre ? -1 : 1;
}
/**
 * Güncellemeler: a bundle no café needs. Every activated café on that platform (any, while its platform is not reported)
 * already runs this version or a newer one, so Mola Merkez offers it to nobody. The sentence to show, or '' when some café
 * would get it.
 */
export function olderThanCafes(r: { version: string; platform: string }, cafes: { appVersion: string; installId?: string; update?: { platform: string } | null }[]) {
  const mine = cafes.filter(c => c.installId && c.appVersion && (!c.update || c.update.platform === r.platform));
  if (!mine.length) return '';
  const newest = mine.map(c => c.appVersion).sort(compareVersion).at(-1)!;
  if (mine.some(c => compareVersion(c.appVersion, r.version) < 0)) return compareVersion(newest, r.version) > 0 ? `Bazı işletmelerde daha yeni bir sürüm (${newest}) var; bu paket yalnız ${r.version} sürümünden eski olanlara sunulur.` : '';
  return compareVersion(newest, r.version) > 0 ? `Bu sürüm işletmelerdekinden eski; kimseye sunulmaz (işletmelerdeki en yeni sürüm ${newest}).` : `Bu sürüm işletmelerde zaten kurulu; kimseye sunulmaz.`;
}
/**
 * A failed login or security step in words. A definite answer (wrong password, wrong code, too many tries) is said as it is;
 * only when the answer may have been lost (no connection, a server error) is the "check again" hint added.
 */
export function signInError(e: unknown) {
  if (e instanceof ApiError && e.status < 500) return e.message;
  return `${e instanceof ApiError ? e.message : 'Mola Merkez\u2019e ula\u015F\u0131lamad\u0131.'} \u0130\u015Flem sonucu belirsizse sayfay\u0131 yenileyip giri\u015F durumunu kontrol edin.`;
}
export function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Mola Yönetim → işletme → Özet "QR siparişleri" (8 Ekim): the café's word over the tunnel; closed whenever the café is away. */
export function qrOrderingFact(l: Pick<Business, 'menu'>): { value: string; sub?: string; tone?: Tone } {
  const m = l.menu;
  if (!m) return { value: '—', sub: 'İşletmenin Mola sürümü eski' };
  if (!m.open) return { value: 'Kapalı', sub: 'Menü kapalı (lisans ya da paket)', tone: 'bad' };
  if (!m.online) return { value: 'Kapalı', sub: 'Kafe bilgisayarı bağlı değil · menü kopyadan görünür', tone: 'warn' };
  if (m.ordering === null) return { value: 'Pakette yok', sub: 'Sadece QR menü' };
  if (!m.ordering) return { value: 'Bilinmiyor', sub: 'İşletmenin Mola sürümü eski' };
  const why = m.ordering.reason === 'staff' ? 'personel ekranı bağlı değil' : m.ordering.reason === 'closing' ? 'gün sonu yapıldı' : m.ordering.reason === 'stopped' ? 'elle durduruldu' : '';
  return m.ordering.open ? { value: 'Açık', sub: 'Müşteriler QR ile sipariş verebilir', tone: 'ok' } : { value: 'Kapalı', sub: why, tone: 'warn' };
}
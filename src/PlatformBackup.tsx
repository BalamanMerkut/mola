import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Check, CheckCircle2, ChevronRight, Circle, Cloud, Copy, DatabaseBackup, HardDrive, KeyRound, Printer, RefreshCw, Server, ShieldCheck, Usb, X } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { ADMIN, dateTime, seenAgo } from './platformStatus';
import { keyProtectionText, type KeyProtection } from './PlatformKeyCard';
import { bytesText, diskLow, useCloudBackups } from './PlatformCloudBackup';
import { Chip, IconBtn, SCard, Stat } from './platformSettingsKit';
import { FolderField } from './PlatformFolderPicker';
import './security.css';
import './platform-backup.css';

type BackupCard = {
  backup: { running: boolean; auto: boolean; folder: string; keep: number; lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string; nextRunAt?: string; kept?: number; second: { folder: string | null; lastCopyAt?: string; lastError?: string } } | null;
  recovery: { available: boolean; shown: boolean; confirmed: boolean; createdAt: string | null } | null; local: boolean;
  keyProtection?: KeyProtection | null;
};
/** GET /api/merkez/admin/cloud-backups/overview (server/merkez/backup-vault.ts cloudOverview): read only, nothing to download. */
export type CloudOverview = {
  staleDays: number;
  total: { businesses: number; copies: number; bytes: number; lastUploadAt: string | null; attention: number };
  businesses: { tenantId: string; name: string; packageName: string; scope: 'full' | 'cloud' | 'none'; suspended: boolean; lastUploadAt: string | null; count: number; bytes: number; days: number | null; status: 'ok' | 'stale' | 'none' | 'error' | 'suspended' | 'ending'; statusText: string; eraseAt?: string | null }[];
};
/** Printed through a hidden frame: the code on paper, with what it is for. Nothing is saved by the page. */
function printCode(code: string) {
  const frame = document.createElement('iframe'); frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(frame); const doc = frame.contentDocument!;
  doc.open(); doc.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Mola Merkez kurtarma kodu</title><style>body{font-family:Arial,sans-serif;margin:40px}.code{font:700 26px/1.5 Consolas,monospace;letter-spacing:3px;border:2px solid #111;padding:18px;margin:24px 0;text-align:center}</style></head><body><h1>Mola Merkez · Kurtarma kodu</h1><div class="code"></div><ul><li>Satıcı bilgisayarı bozulur ya da değişirse Mola Merkez, yedek + bu kodla yeni bilgisayarda açılır.</li><li>Kâğıdı bilgisayardan uzakta saklayın; kimseyle paylaşmayın.</li></ul></body></html>');
  doc.close(); doc.querySelector('.code')!.textContent = code; frame.contentWindow!.print(); setTimeout(() => frame.remove(), 60000);
}
const TIPS = {
  where: 'Mola Merkez’in kendi yedeği (işletme listesi, lisanslar, imza anahtarı) bu sunucudaki yedek klasöründedir; isterseniz bir de ikinci yere (Google Drive, OneDrive, flash bellek) kopyalanır. Kafelerin bulut yedekleri ayrı durur: her kafe kendi şifreli kopyasını gönderir, Mola Merkez onları açamaz.',
  status: 'Mola Merkez her gece işletme listesini, lisansları ve imza anahtarını şifreli olarak yedekler ve yedeği açarak doğrular. “Şimdi yedekle” aynı yedeği hemen alır.',
  kept: 'Her yeni yedekten sonra en eskisi silinir; klasörde hep en yeni yedekler kalır. Klasör kurulumla belirlenir.',
  second: 'Her yedek bir de buraya kopyalanır: Google Drive (ör. G:\\Drive’ım), OneDrive klasörü ya da bir flash bellek. Bilgisayar bozulursa yedek orada da durur; yedekler şifrelidir, kurtarma kodu olmadan açılmaz. Seçtiğiniz yerde “Mola-Merkez-Yedek” klasörü oluşur. “Göz at” Windows’un klasör seçme penceresini açar; altındaki hazır yerlere dokunmak da yeter. Seçip “Kaydet”e basın. Boş bırakıp kaydederseniz kapanır.',
  code: 'Yedekler bu kodla açılır. Bilgisayar değişirse yedek klasörü + bu kod Mola Merkez’i yeni bilgisayarda geri getirir. Kod yalnız Mola Merkez’in çalıştığı bilgisayarda gösterilir; kâğıda yazın ya da yazdırın, bilgisayardan uzakta saklayın.',
  restore: 'Yeni bilgisayarda Mola Yönetim kurulur, yedek klasörü (ya da ikinci yerdeki kopya) ve kurtarma koduyla geri yüklenir. Bunun için üç şey gerekir: bir yedek, kaydedilmiş kurtarma kodu ve tercihen ikinci bir yerde kopya.',
  cloud: 'Kafelerin şifreli yedek kopyaları bu bilgisayarda, Mola Merkez yedeğinden ayrı durur (zaten yedektir, Merkez yedeğine girmez). Merkez bu kopyaları açamaz. Her işletme için günlük ve haftalık kopyalar ile yıl paketleri saklanır; disk %15’in altına inince yeni kopya alınmaz.',
  list: 'Bulutta şifreli yedeği olan işletmeler. Kopyaları yalnız işletmenin kendisi kendi kurtarma koduyla açar; Mola Yönetim’den indirilemez ve açılamaz (KVKK). Bilgisayarı bozulan işletmeye işletme sayfasındaki Lisans → “Taşıma kodu ver” ile yardım edilir. Saklama ve kopya sınırı işletme sayfasının Özet bölümünden değişir.',
};
const SCOPE: Record<CloudOverview['businesses'][number]['scope'], [string, 'ok' | 'info' | 'idle']> = { full: ['Tam paket', 'ok'], cloud: ['Bulut yedek', 'info'], none: ['Pakette yok', 'idle'] };
const STATE_TONE = { ok: 'ok', stale: 'bad', error: 'bad', none: 'warn', suspended: 'idle', ending: 'warn' } as const;

/** Read once and every minute (Ayarlar → Yedek). */
function useCloudOverview() {
  const [state, setState] = useState<CloudOverview | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void api<CloudOverview>(`${ADMIN}/cloud-backups/overview`).then(s => { if (live) setState(s); }, () => {});
    read(); const t = setInterval(read, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return state;
}

/**
 * Ayarlar → "Yedek" (13 Ekim: "klasörler nerede, yedekler nerede?"). First one plain card, "Yedekler nerede?": this server
 * (folder, last backup, state, "Şimdi yedekle"), the second place, and the cafés' cloud backups (how many, the last one; a tap
 * opens the list of businesses: package, last backup, copies, size, state; no download). The rest (kept backups, the second
 * place's folder, the recovery code, readiness for a restore, the disk) is under "Ayrıntılar", closed while all is well.
 */
export function PlatformBackup({ onOpenBusiness }: { onOpenBusiness?: (tenantId: string) => void } = {}) {
  const [card, setCard] = useState<BackupCard | null>(null), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [second, setSecond] = useState(''), [renewing, setRenewing] = useState(false), [password, setPassword] = useState(''), [copied, setCopied] = useState(false);
  const [listOpen, setListOpen] = useState(false), [details, setDetails] = useState<boolean | null>(null);
  const cloud = useCloudOverview(), disk = useCloudBackups();
  const detailsRef = useRef<HTMLDetailsElement>(null), secondRef = useRef<HTMLDivElement>(null);
  // "Ayrıntılar" opens by itself when, on arrival, something there needs the vendor (an unsaved recovery code, a failing second
  // place); it then stays as the vendor leaves it (saving the code does not fold it away under their hands).
  const load = () => api<BackupCard>(`${ADMIN}/backup`).then(c => { setCard(c); setSecond(c.backup?.second.folder ?? ''); setDetails(d => d ?? (!!(c.recovery && !c.recovery.confirmed) || !!c.backup?.second.lastError || !!c.keyProtection?.warning)); }, e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run<T>(path: string, body: object, done?: string, then?: (r: T) => void) {
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<T>(path, body); then?.(r); if (done) setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!card) return <section className="ps-backup" aria-label="Yedek">{error ? <Notice tone="error">{error}</Notice> : <p className="muted">Yükleniyor…</p>}</section>;
  const b = card.backup, r = card.recovery;
  const health = !b ? null : b.lastError ? { tone: 'bad' as const, text: 'Son yedek alınamadı' } : b.lastSuccessAt ? { tone: 'ok' as const, text: 'Sağlıklı' } : { tone: 'warn' as const, text: 'İlk yedek bekleniyor' };
  const secondState = !b?.second.folder ? { tone: 'idle' as const, text: 'Ayarlı değil' } : b.second.lastError ? { tone: 'bad' as const, text: 'Kopya alınamadı' } : { tone: 'ok' as const, text: b.second.lastCopyAt ? 'Sağlıklı' : 'Henüz kopya yok' };
  const open = !!details;
  const showDetails = (target?: HTMLElement | null) => { setDetails(true); requestAnimationFrame(() => (target ?? detailsRef.current)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })); };
  const messages = (error || notice) && <div className="ps-messages">{error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}</div>;
  const cloudTone = !cloud ? 'idle' : cloud.total.attention ? 'bad' : cloud.total.businesses ? 'ok' : 'idle';
  const cloudText = !cloud ? 'Okunuyor…' : cloud.total.attention ? `${cloud.total.attention} işletmede sorun` : cloud.total.businesses ? 'Sağlıklı' : 'Kopya yok';
  return <section className="ps-backup merkez-backup" aria-label="Yedek">
    <div className="ps-grid">
      <SCard icon={DatabaseBackup} title="Yedekler nerede?" sub="Üç yer, tek bakışta" tip={TIPS.where} tipLabel="Yedekler nerede" wide className="ps-status-card bk-where">
        <ul className="bk-places" aria-label="Yedek yerleri">
          <li className="bk-place">
            <span className="ps-tile green" aria-hidden="true"><Server size={19} /></span>
            <div className="bk-place-body">
              <strong>Bu sunucu</strong>
              {b ? <><code className="bk-path" title={b.folder}>{b.folder}</code>
                <span className="bk-place-line">Son yedek: {b.lastSuccessAt ? dateTime(b.lastSuccessAt) : 'Henüz yok'} · {b.auto ? (b.nextRunAt ? `sonraki ${dateTime(b.nextRunAt)}` : 'her gece 03:45') : 'Otomatik yedek kapalı'}</span></>
                : <span className="bk-place-line">Merkez yedeği bu çalıştırmada kapalı.</span>}
            </div>
            <div className="bk-place-side">{health && <Chip tone={health.tone}>{health.text}</Chip>}
              {b && <IconBtn icon={RefreshCw} label="Şimdi yedekle" text={busy ? 'Yedekleniyor…' : 'Şimdi yedekle'} tone="primary" disabled={busy || b.running} onClick={() => void run(`${ADMIN}/backup/run`, {}, undefined, (s: { lastError?: string }) => { if (!s.lastError) setNotice('Yedek alındı ve doğrulandı.'); })} />}</div>
          </li>
          {b && <li className="bk-place">
            <span className="ps-tile lilac" aria-hidden="true"><Usb size={19} /></span>
            <div className="bk-place-body">
              <strong>İkinci yer</strong>
              {b.second.folder ? <><code className="bk-path" title={b.second.folder}>{b.second.folder}</code>
                <span className="bk-place-line">{b.second.lastError ? `Son kopya alınamadı: ${b.second.lastError}` : b.second.lastCopyAt ? `Son kopya: ${dateTime(b.second.lastCopyAt)}` : 'Henüz kopya yok'}</span></>
                : <span className="bk-place-line">Google Drive, OneDrive ya da flash bellek seçilebilir (isteğe bağlı).</span>}
            </div>
            <div className="bk-place-side"><Chip tone={secondState.tone}>{secondState.text}</Chip>
              <button type="button" className="btn secondary small-btn" onClick={() => showDetails(secondRef.current)}>{b.second.folder ? 'İkinci yeri değiştir' : 'İkinci yeri ayarla'}</button></div>
          </li>}
          <li className="bk-place">
            <button type="button" className={`bk-place-open${listOpen ? ' open' : ''}`} aria-expanded={listOpen} aria-controls="bk-cloud-list" onClick={() => setListOpen(!listOpen)}>
              <span className="ps-tile blue" aria-hidden="true"><Cloud size={19} /></span>
              <span className="bk-place-body">
                <strong>Kafelerin bulut yedekleri</strong>
                <span className="bk-place-line">{!cloud ? 'Okunuyor…' : cloud.total.businesses ? `${cloud.total.businesses} işletme · ${cloud.total.copies} kopya · ${bytesText(cloud.total.bytes)}${cloud.total.lastUploadAt ? ` · son yedek ${dateTime(cloud.total.lastUploadAt)}` : ''}` : 'Henüz bulut yedeği gönderen işletme yok.'}</span>
              </span>
              <span className="bk-place-side"><Chip tone={cloudTone}>{cloudText}</Chip><span className="bk-open-label">{listOpen ? 'Listeyi kapat' : 'Listeyi aç'}</span><ChevronRight className="bk-chevron" size={18} aria-hidden="true" /></span>
            </button>
          </li>
        </ul>
        {b?.lastError && <Notice tone="error">Son yedek alınamadı: {b.lastError}</Notice>}
        {r && !r.confirmed && <div className="bk-attention"><KeyRound size={16} aria-hidden="true" /><span>Kurtarma kodu henüz kaydedilmedi. Bilgisayar değişirse yedeği açmak için gerekir.</span><button type="button" className="text-btn" onClick={() => showDetails()}>Ayrıntılara git</button></div>}
        {messages}
      </SCard>

      {listOpen && <CloudList state={cloud} onOpenBusiness={onOpenBusiness} />}
    </div>

    <details className="bk-details" ref={detailsRef} open={open} onToggle={e => { const now = (e.currentTarget as HTMLDetailsElement).open; if (now !== open) setDetails(now); }}>
      <summary><span className="ps-tile grey" aria-hidden="true"><Archive size={19} /></span><span className="bk-details-title">Ayrıntılar<small>Saklanan yedekler, ikinci yer, kurtarma kodu, geri yükleme, sunucu diski</small></span><ChevronRight className="bk-chevron" size={18} aria-hidden="true" /></summary>
      <div className="ps-grid">
        {b && <SCard icon={Archive} title="Saklanan yedekler" sub={`En yeni ${b.keep} yedek${b.kept ? ` · şu an ${b.kept}` : ''}`} tip={TIPS.kept} tone="blue">
          <dl className="ps-stats">
            <Stat label="Saklanan" value={`${b.kept ?? 0} / ${b.keep} yedek`} sub="En yenileri kalır" />
            <Stat label="Sonraki otomatik yedek" value={b.auto ? (b.nextRunAt ? dateTime(b.nextRunAt) : 'Her gece 03:45') : 'Otomatik yedek kapalı'} tone={b.auto ? 'ok' : 'idle'} />
          </dl>
          <div className="ps-keep-bar" aria-hidden="true">{Array.from({ length: Math.min(b.keep, 14) }, (_, i) => <i key={i} className={i < Math.min(b.kept ?? 0, 14) ? 'on' : ''} />)}</div>
          <div className="ps-path"><span className="muted small">Yedek klasörü</span><code className="path">{b.folder}</code></div>
        </SCard>}

        {b && <div className="bk-anchor" ref={secondRef}><SCard icon={Usb} title="İkinci yedek yeri" sub="Google Drive, OneDrive ya da flash bellek · isteğe bağlı" tip={TIPS.second} tipLabel="İkinci yer" tone="lilac"
          aside={<Chip tone={b.second.folder ? (b.second.lastError ? 'bad' : 'ok') : 'idle'}>{b.second.folder ? (b.second.lastError ? 'Hata' : 'Açık') : 'Kapalı'}</Chip>}>
          <form className="ps-form second-place" onSubmit={e => { e.preventDefault(); void run(`${ADMIN}/backup/second`, { folder: second.trim() || null }, second.trim() ? 'İkinci yedek yeri kaydedildi. Sonraki yedek oraya da kopyalanır.' : 'İkinci yedek yeri kapatıldı.'); }}>
            {/* "Göz at": Windows' folder window on this computer; Google Drive, OneDrive and flash drives as quick choices (src/PlatformFolderPicker.tsx). */}
            <FolderField label="İkinci yedek yeri" purpose="second" suggest disabled={busy} value={second} placeholder="ör. G:\Drive'ım, E:\ veya C:\Users\...\OneDrive" onChange={setSecond} />
            <div className="ps-actions"><button className="btn secondary small-btn" disabled={busy}>Kaydet</button>
              {b.second.folder && <small className={b.second.lastError ? 'bad' : 'muted'}>{b.second.lastError ? `Son kopya alınamadı: ${b.second.lastError}` : b.second.lastCopyAt ? `Son kopya: ${dateTime(b.second.lastCopyAt)}` : 'Henüz kopya yok'}</small>}</div>
          </form>
        </SCard></div>}

        <SCard icon={KeyRound} title="Kurtarma kodu" sub="Yedeği açan anahtar" tip={TIPS.code} tone="amber" wide={!!code}
          aside={r && !code && <Chip tone={r.confirmed ? 'ok' : 'warn'}>{r.confirmed ? 'Kaydedildi' : 'Kaydedilmedi'}</Chip>}>
          {!r ? <p className="muted small">Bu çalıştırmada kurtarma kodu yok.</p> : code ? <div className="recovery-reveal">
            <p className="ps-line">Bu kodu kâğıda yazın ya da yazdırın, bilgisayardan uzakta saklayın. Kod bir daha gösterilmez.</p>
            <div className="recovery-code" data-testid="merkez-recovery-code">{code.split('-').map((g, i) => <span key={i}>{g}</span>)}</div>
            <div className="ps-actions"><IconBtn icon={Printer} label="Yazdır" onClick={() => printCode(code)} /><IconBtn icon={copied ? Check : Copy} label={copied ? 'Kopyalandı' : 'Kopyala'} onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {}); }} />
              <button type="button" className="btn primary small-btn grow" disabled={busy} onClick={() => void run(`${ADMIN}/recovery/confirm`, {}, 'Kurtarma kodu kaydedildi olarak işaretlendi.', () => setCode(''))}><Check size={16} aria-hidden="true" />Kodu kaydettim</button></div>
          </div> : <>
            <p className="muted small">{r.confirmed ? `Kod kaydedildi${r.createdAt ? ` (${dateTime(r.createdAt)})` : ''}. Kaybettiyseniz yeni kod oluşturun; bu bilgisayardaki yedekler yeni kodla açılır.` : 'Kurtarma kodu henüz kaydedilmedi. Yedekten geri yükleme için gereklidir.'}</p>
            {/* 13 Ekim: on a server (VDS) there is no browser on Merkez's own computer: the code is renewed there with SSH. */}
            {!card.local && <Notice>Kurtarma kodu yalnız Mola Merkez’in kendi bilgisayarında gösterilir. Merkez bir sunucudaysa (VDS) yeni kodu sunucuda, SSH ile şu komutla oluşturun (Merkez birkaç saniye durur; kod ekrana yazılır, iki parçası geri sorulur):<code className="bk-command">sudo systemctl stop mola-merkez && sudo -u mola /opt/mola-merkez/kurtarma-kodu.sh; sudo systemctl start mola-merkez</code></Notice>}
            {card.local && r.available && <button type="button" className="btn primary small-btn ps-wide-btn" disabled={busy} onClick={() => void run<{ code: string }>(`${ADMIN}/recovery/show`, {}, undefined, x => setCode(x.code))}><KeyRound size={16} aria-hidden="true" />Kurtarma kodunu göster</button>}
            {card.local && !r.available && (renewing ? <form className="ps-form" onSubmit={e => { e.preventDefault(); void run<{ code: string }>(`${ADMIN}/recovery/new`, { password }, undefined, x => { setCode(x.code); setPassword(''); setRenewing(false); }); }}>
              <label>Yönetici şifresi<input type="password" required autoComplete="current-password" disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
              <div className="ps-actions"><IconBtn icon={X} label="Vazgeç" disabled={busy} onClick={() => setRenewing(false)} /><button className="btn primary small-btn grow" disabled={busy || !password}>Yeni kod oluştur</button></div>
            </form> : <button type="button" className="btn secondary small-btn ps-wide-btn" disabled={busy} onClick={() => setRenewing(true)}>Yeni kurtarma kodu oluştur</button>)}
          </>}
          {card.keyProtection && (card.keyProtection.wanted || card.keyProtection.mode === 'protected') && <div className={`ps-key${card.keyProtection.waitingForCode ? ' warn' : ''}`}>
            <ShieldCheck size={16} aria-hidden="true" />
            <p className={card.keyProtection.waitingForCode ? 'key-protection-line warn' : 'key-protection-line'} data-testid="merkez-key-protection">{keyProtectionText(card.keyProtection)}</p>
          </div>}
          {card.keyProtection?.warning && <Notice tone="error">{card.keyProtection.warning}</Notice>}
        </SCard>

        {b && <SCard icon={ArchiveRestore} title="Geri yüklemeye hazırlık" sub="Bilgisayar değişirse" tip={TIPS.restore} tone="green">
          <ul className="ps-checklist">
            <Ready ok={!!b.lastSuccessAt}>Doğrulanmış bir yedek var</Ready>
            <Ready ok={!!r?.confirmed}>Kurtarma kodu kaydedildi</Ready>
            <Ready ok={!!b.second.folder && !b.second.lastError} soft>İkinci yerde kopya</Ready>
          </ul>
        </SCard>}

        {disk && <SCard icon={HardDrive} title="Sunucu diski" sub="Kafelerin bulut yedekleri için" tip={TIPS.cloud} tone="blue" testId="cloud-disk" aside={diskLow(disk) ? <Chip tone="bad">Disk dolu</Chip> : undefined}>
          <dl className="ps-stats">
            <Stat label="Kullanılan" value={bytesText(disk.disk.used)} />
            <Stat label="Diskte boş" value={disk.disk.free === null ? '-' : bytesText(disk.disk.free)} sub={disk.disk.total ? `Toplam ${bytesText(disk.disk.total)}` : undefined} tone={diskLow(disk) ? 'bad' : undefined} />
          </dl>
          <p className="muted small ps-disk-note"><HardDrive size={14} aria-hidden="true" /> En az {bytesText(disk.disk.minFree)} boş kalır; altına inince yeni kopya alınmaz.</p>
          {diskLow(disk) && <Notice tone="error">Diskte yer azaldı (%15’in altında). Diski büyütün ya da işletmelerin saklanan kopya sayısını azaltın.</Notice>}
        </SCard>}
      </div>
    </details>
  </section>;
}

function Ready({ ok, soft, children }: { ok: boolean; soft?: boolean; children: string }) {
  return <li className={ok ? 'ok' : soft ? 'soft' : 'todo'}>{ok ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}<span>{children}</span><span className="visually-hidden">{ok ? ' (tamam)' : ' (eksik)'}</span></li>;
}

/**
 * "Kafelerin bulut yedekleri": one line per business (name and package, last backup, copies, size, state). Read only: no
 * download (Mola Yönetim cannot open a café's backup; KVKK). A line's arrow opens the business.
 */
function CloudList({ state, onOpenBusiness }: { state: CloudOverview | null; onOpenBusiness?: (tenantId: string) => void }) {
  return <div id="bk-cloud-list" className="ps-card wide bk-cloud" role="group" aria-label="Kafelerin bulut yedekleri listesi">
    <header className="ps-card-head"><span className="ps-tile blue" aria-hidden="true"><Cloud size={19} /></span>
      <div className="ps-card-title"><h3>Kafelerin bulut yedekleri</h3><p>{state ? `${state.businesses.length} işletme · ${state.staleDays} günden uzun süre yedek gelmezse uyarılır` : 'Okunuyor…'}</p></div>
      <span className="ps-card-tip"><HelpTip title="Kafelerin bulut yedekleri">{TIPS.list}</HelpTip></span></header>
    {!state ? <p className="muted small">Yükleniyor…</p> : !state.businesses.length ? <p className="muted small">Bulutta şifreli yedeği olan işletme yok. İşletmenin paketinde “Bulutta şifreli yedek” olunca her yedekten sonra bir kopya buraya gelir.</p>
      : <div className="bk-table" role="table" aria-label="Kafelerin bulut yedekleri">
        <div className="bk-row head" role="row"><span role="columnheader">İşletme</span><span role="columnheader">Son yedek</span><span role="columnheader">Kopya</span><span role="columnheader">Boyut</span><span role="columnheader">Durum</span><span role="columnheader"><span className="visually-hidden">Aç</span></span></div>
        {state.businesses.map(x => <div key={x.tenantId} role="row" className={`bk-row ${x.status}`}>
          <span role="cell" className="bk-name"><strong>{x.name}</strong><span className="bk-pkg">{x.packageName}<Chip tone={SCOPE[x.scope][1]}>{SCOPE[x.scope][0]}</Chip></span></span>
          <span role="cell" className="bk-when">{x.lastUploadAt ? <>{dateTime(x.lastUploadAt)}<small>{seenAgo(x.lastUploadAt)}</small></> : <span className="muted">Henüz yok</span>}</span>
          <span role="cell" className="bk-num" data-label="Kopya">{x.count}</span>
          <span role="cell" className="bk-num" data-label="Boyut">{bytesText(x.bytes)}</span>
          <span role="cell" className="bk-state"><Chip tone={STATE_TONE[x.status]}>{x.statusText}</Chip></span>
          <span role="cell" className="bk-go">{onOpenBusiness && <IconBtn icon={ChevronRight} label={`${x.name} işletme sayfası`} onClick={() => onOpenBusiness(x.tenantId)} />}</span>
        </div>)}
      </div>}
  </div>;
}

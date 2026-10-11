import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Check, CheckCircle2, Circle, Cloud, Copy, DatabaseBackup, HardDrive, KeyRound, Printer, RefreshCw, ShieldCheck, Usb, X } from 'lucide-react';
// (Kafelerin sunucu yedekleri: drawn here from useCloudBackups; CloudDiskCard in src/PlatformCloudBackup.tsx is the older block.)
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';
import { keyProtectionText, type KeyProtection } from './PlatformKeyCard';
import { bytesText, diskLow, useCloudBackups } from './PlatformCloudBackup';
import { Chip, IconBtn, SCard, Stat } from './platformSettingsKit';
import { FolderField } from './PlatformFolderPicker';
import './security.css';

type BackupCard = {
  backup: { running: boolean; auto: boolean; folder: string; keep: number; lastAttemptAt?: string; lastSuccessAt?: string; lastError?: string; nextRunAt?: string; kept?: number; second: { folder: string | null; lastCopyAt?: string; lastError?: string } } | null;
  recovery: { available: boolean; shown: boolean; confirmed: boolean; createdAt: string | null } | null; local: boolean;
  keyProtection?: KeyProtection | null;
};
/** Printed through a hidden frame: the code on paper, with what it is for. Nothing is saved by the page. */
function printCode(code: string) {
  const frame = document.createElement('iframe'); frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(frame); const doc = frame.contentDocument!;
  doc.open(); doc.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Mola Merkez kurtarma kodu</title><style>body{font-family:Arial,sans-serif;margin:40px}.code{font:700 26px/1.5 Consolas,monospace;letter-spacing:3px;border:2px solid #111;padding:18px;margin:24px 0;text-align:center}</style></head><body><h1>Mola Merkez · Kurtarma kodu</h1><div class="code"></div><ul><li>Satıcı bilgisayarı bozulur ya da değişirse Mola Merkez, yedek + bu kodla yeni bilgisayarda açılır.</li><li>Kâğıdı bilgisayardan uzakta saklayın; kimseyle paylaşmayın.</li></ul></body></html>');
  doc.close(); doc.querySelector('.code')!.textContent = code; frame.contentWindow!.print(); setTimeout(() => frame.remove(), 60000);
}
const TIPS = {
  status: 'Mola Merkez her gece işletme listesini, lisansları ve imza anahtarını şifreli olarak yedekler ve yedeği açarak doğrular. “Şimdi yedekle” aynı yedeği hemen alır.',
  kept: 'Her yeni yedekten sonra en eskisi silinir; klasörde hep en yeni yedekler kalır. Klasör kurulumla belirlenir.',
  second: 'Her yedek bir de buraya kopyalanır: Google Drive (ör. G:\\Drive’ım), OneDrive klasörü ya da bir flash bellek. Bilgisayar bozulursa yedek orada da durur; yedekler şifrelidir, kurtarma kodu olmadan açılmaz. Seçtiğiniz yerde “Mola-Merkez-Yedek” klasörü oluşur. “Göz at” Windows’un klasör seçme penceresini açar; altındaki hazır yerlere dokunmak da yeter. Seçip “Kaydet”e basın. Boş bırakıp kaydederseniz kapanır.',
  code: 'Yedekler bu kodla açılır. Bilgisayar değişirse yedek klasörü + bu kod Mola Merkez’i yeni bilgisayarda geri getirir. Kod yalnız Mola Merkez’in çalıştığı bilgisayarda gösterilir; kâğıda yazın ya da yazdırın, bilgisayardan uzakta saklayın.',
  restore: 'Yeni bilgisayarda Mola Yönetim kurulur, yedek klasörü (ya da ikinci yerdeki kopya) ve kurtarma koduyla geri yüklenir. Bunun için üç şey gerekir: bir yedek, kaydedilmiş kurtarma kodu ve tercihen ikinci bir yerde kopya.',
  cloud: 'Kafelerin şifreli yedek kopyaları bu bilgisayarda, Mola Merkez yedeğinden ayrı durur (zaten yedektir, Merkez yedeğine girmez). Merkez bu kopyaları açamaz. Her işletme için günlük ve haftalık kopyalar ile yıl paketleri saklanır; disk %15’in altına inince yeni kopya alınmaz.',
};
/**
 * Ayarlar → "Yedek": one status card (son yedek, sonraki, sağlık, "Şimdi yedekle"), then one card each for the kept backups,
 * the second place, the recovery code (shown only on the Merkez computer, until "Kodu kaydettim"), the readiness for a
 * restore and the cafés' copies on this disk. Explanations sit behind the ⓘ. Backup + code bring Merkez back on a new PC.
 */
export function PlatformBackup() {
  const [card, setCard] = useState<BackupCard | null>(null), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [second, setSecond] = useState(''), [renewing, setRenewing] = useState(false), [password, setPassword] = useState(''), [copied, setCopied] = useState(false);
  const load = () => api<BackupCard>(`${ADMIN}/backup`).then(c => { setCard(c); setSecond(c.backup?.second.folder ?? ''); }, e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run<T>(path: string, body: object, done?: string, then?: (r: T) => void) {
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<T>(path, body); then?.(r); if (done) setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!card) return <section className="ps-backup" aria-label="Yedek">{error ? <Notice tone="error">{error}</Notice> : <p className="muted">Yükleniyor…</p>}</section>;
  const b = card.backup, r = card.recovery;
  const health = !b ? null : b.lastError ? { tone: 'bad' as const, text: 'Son yedek alınamadı' } : b.lastSuccessAt ? { tone: 'ok' as const, text: 'Sağlıklı' } : { tone: 'warn' as const, text: 'İlk yedek bekleniyor' };
  const messages = (error || notice) && <div className="ps-messages">{error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}</div>;
  return <section className="ps-backup merkez-backup" aria-label="Yedek">
    <div className="ps-grid">
      <SCard icon={DatabaseBackup} title="Mola Merkez yedeği" sub="Her gece şifreli yedek, açılarak doğrulanır" tip={TIPS.status} wide className="ps-status-card"
        aside={b && <>{health && <Chip tone={health.tone}>{health.text}</Chip>}<IconBtn icon={RefreshCw} label="Şimdi yedekle" text={busy ? 'Yedekleniyor…' : 'Şimdi yedekle'} tone="primary" disabled={busy || b.running} onClick={() => void run(`${ADMIN}/backup/run`, {}, undefined, (s: { lastError?: string }) => { if (!s.lastError) setNotice('Yedek alındı ve doğrulandı.'); })} /></>}>
        {!b ? <Notice>Merkez yedeği bu çalıştırmada kapalı.</Notice> : <dl className="ps-stats">
          <Stat label="Son başarılı yedek" value={b.lastSuccessAt ? dateTime(b.lastSuccessAt) : 'Henüz yok'} tone={b.lastSuccessAt ? 'ok' : 'warn'} />
          <Stat label="Sonraki otomatik yedek" value={b.auto ? (b.nextRunAt ? dateTime(b.nextRunAt) : 'Her gece 03:45') : 'Otomatik yedek kapalı'} tone={b.auto ? 'ok' : 'idle'} />
          <Stat label="Saklanan" value={`${b.kept ?? 0} / ${b.keep} yedek`} sub="En yenileri kalır" />
          <Stat label="İkinci yer" value={b.second.folder ? (b.second.lastError ? 'Kopya alınamadı' : 'Açık') : 'Ayarlı değil'} tone={b.second.folder ? (b.second.lastError ? 'bad' : 'ok') : 'idle'} />
        </dl>}
        {b?.lastError && <Notice tone="error">Son yedek alınamadı: {b.lastError}</Notice>}
        {messages}
      </SCard>

      {b && <SCard icon={Archive} title="Saklanan yedekler" sub={`En yeni ${b.keep} yedek${b.kept ? ` · şu an ${b.kept}` : ''}`} tip={TIPS.kept} tone="blue">
        <div className="ps-keep-bar" aria-hidden="true">{Array.from({ length: Math.min(b.keep, 14) }, (_, i) => <i key={i} className={i < Math.min(b.kept ?? 0, 14) ? 'on' : ''} />)}</div>
        <div className="ps-path"><span className="muted small">Yedek klasörü</span><code className="path">{b.folder}</code></div>
      </SCard>}

      {b && <SCard icon={Usb} title="İkinci yedek yeri" sub="Google Drive, OneDrive ya da flash bellek · isteğe bağlı" tip={TIPS.second} tipLabel="İkinci yer" tone="lilac"
        aside={<Chip tone={b.second.folder ? (b.second.lastError ? 'bad' : 'ok') : 'idle'}>{b.second.folder ? (b.second.lastError ? 'Hata' : 'Açık') : 'Kapalı'}</Chip>}>
        <form className="ps-form second-place" onSubmit={e => { e.preventDefault(); void run(`${ADMIN}/backup/second`, { folder: second.trim() || null }, second.trim() ? 'İkinci yedek yeri kaydedildi. Sonraki yedek oraya da kopyalanır.' : 'İkinci yedek yeri kapatıldı.'); }}>
          {/* "Göz at": Windows' folder window on this computer; Google Drive, OneDrive and flash drives as quick choices (src/PlatformFolderPicker.tsx). */}
          <FolderField label="İkinci yedek yeri" purpose="second" suggest disabled={busy} value={second} placeholder="ör. G:\Drive'ım, E:\ veya C:\Users\...\OneDrive" onChange={setSecond} />
          <div className="ps-actions"><button className="btn secondary small-btn" disabled={busy}>Kaydet</button>
            {b.second.folder && <small className={b.second.lastError ? 'bad' : 'muted'}>{b.second.lastError ? `Son kopya alınamadı: ${b.second.lastError}` : b.second.lastCopyAt ? `Son kopya: ${dateTime(b.second.lastCopyAt)}` : 'Henüz kopya yok'}</small>}</div>
        </form>
      </SCard>}

      <SCard icon={KeyRound} title="Kurtarma kodu" sub="Yedeği açan anahtar" tip={TIPS.code} tone="amber" wide={!!code}
        aside={r && !code && <Chip tone={r.confirmed ? 'ok' : 'warn'}>{r.confirmed ? 'Kaydedildi' : 'Kaydedilmedi'}</Chip>}>
        {!r ? <p className="muted small">Bu çalıştırmada kurtarma kodu yok.</p> : code ? <div className="recovery-reveal">
          <p className="ps-line">Bu kodu kâğıda yazın ya da yazdırın, bilgisayardan uzakta saklayın. Kod bir daha gösterilmez.</p>
          <div className="recovery-code" data-testid="merkez-recovery-code">{code.split('-').map((g, i) => <span key={i}>{g}</span>)}</div>
          <div className="ps-actions"><IconBtn icon={Printer} label="Yazdır" onClick={() => printCode(code)} /><IconBtn icon={copied ? Check : Copy} label={copied ? 'Kopyalandı' : 'Kopyala'} onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {}); }} />
            <button type="button" className="btn primary small-btn grow" disabled={busy} onClick={() => void run(`${ADMIN}/recovery/confirm`, {}, 'Kurtarma kodu kaydedildi olarak işaretlendi.', () => setCode(''))}><Check size={16} aria-hidden="true" />Kodu kaydettim</button></div>
        </div> : <>
          <p className="muted small">{r.confirmed ? `Kod kaydedildi${r.createdAt ? ` (${dateTime(r.createdAt)})` : ''}. Kaybettiyseniz yeni kod oluşturun; bu bilgisayardaki yedekler yeni kodla açılır.` : 'Kurtarma kodu henüz kaydedilmedi. Yedekten geri yükleme için gereklidir.'}</p>
          {!card.local && <Notice>Kurtarma kodu yalnız Mola Merkez’in çalıştığı bilgisayarda gösterilir.</Notice>}
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

      <CafeCopies />
    </div>
  </section>;
}

function Ready({ ok, soft, children }: { ok: boolean; soft?: boolean; children: string }) {
  return <li className={ok ? 'ok' : soft ? 'soft' : 'todo'}>{ok ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}<span>{children}</span><span className="visually-hidden">{ok ? ' (tamam)' : ' (eksik)'}</span></li>;
}

/** The cafés' encrypted copies on this computer (server/merkez/backup-vault.ts): disk use, what is left, the guard. */
function CafeCopies() {
  const state = useCloudBackups();
  if (!state) return null;
  const { used, free, total, minFree } = state.disk, low = diskLow(state);
  const withCopies = state.businesses.filter(b => b.count), copies = state.businesses.reduce((n, b) => n + b.count, 0), years = state.businesses.reduce((n, b) => n + (b.years?.count ?? 0), 0);
  return <SCard icon={Cloud} title="Kafelerin sunucu yedekleri" sub={`${withCopies.length} işletme · ${copies} kopya${years ? ` · ${years} yıl paketi` : ''}`} tip={TIPS.cloud} tone="blue" testId="cloud-disk"
    aside={low ? <Chip tone="bad">Disk dolu</Chip> : undefined}>
    <dl className="ps-stats">
      <Stat label="Kullanılan" value={bytesText(used)} />
      <Stat label="Diskte boş" value={free === null ? '—' : bytesText(free)} sub={total ? `Toplam ${bytesText(total)}` : undefined} tone={low ? 'bad' : undefined} />
    </dl>
    <p className="muted small ps-disk-note"><HardDrive size={14} aria-hidden="true" /> En az {bytesText(minFree)} boş kalır; altına inince yeni kopya alınmaz.</p>
    {low && <Notice tone="error">Diskte yer azaldı (%15’in altında). Diski büyütün ya da işletmelerin saklanan kopya sayısını azaltın.</Notice>}
  </SCard>;
}

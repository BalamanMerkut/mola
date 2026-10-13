import { useEffect, useState } from 'react';
import { Check, Cloud, Copy, HardDrive, KeyRound } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime, type Business } from './platformStatus';
import { DCard } from './PlatformDetailKit';
import './platform-cloud.css';

/*
 * Sunucu yedeği in Mola Yönetim (server/merkez/backup-vault.ts): each café's encrypted copies on this Merkez. Merkez holds
 * ciphertext only; nothing here opens a copy. Özet: last upload, total size, copies, keep rules and quota. Lisans: the one-time
 * "taşıma kodu" for a new computer. Ayarlar → Yedek: Merkez's disk. Bugün: a café with no upload for 2 days, a full disk.
 */
export type CloudCopy = { id: string; createdAt: string; uploadedAt: string; bytes: number; files: number; appVersion: string };
/**
 * `limit`: the room this business may use now (its kept copies + 1, each as large as its largest copy); `cap`: one copy larger
 * than this is refused. `warning`: refused for its size, near the cap, or a large total (Özet and Bugün).
 */
export type CloudRow = { tenantId: string; settings: { daily: number; weekly: number; capMb: number }; lastUploadAt: string | null; lastAttemptAt: string | null; lastError: string | null; copies: CloudCopy[]; count: number; bytes: number; limit: number; cap: number; stale: boolean;
  /** Year packages (server/year-packages.ts): sent once, kept for good, counted once in the room. Older Merkez: missing. */
  years?: { count: number; bytes: number; names: string[] }; warning: { tone: 'bad' | 'warn'; text: string } | null; transfer: { createdAt: string; expiresAt: string; usedAt: string | null; bound: boolean; active: boolean } | null };
export type CloudState = { disk: { used: number; free: number | null; total: number | null; minFree: number; low?: boolean }; staleDays: number; businesses: CloudRow[] };
export const bytesText = (n = 0) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB` : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(n ? 1 : 0, Math.round(n / 1024))} KB`;

/** Read once and every minute (the same call for Özet, Bugün and Ayarlar). */
export function useCloudBackups(refresh = 0) {
  const [state, setState] = useState<CloudState | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => void api<CloudState>(`${ADMIN}/cloud-backups`).then(s => { if (live) setState(s); }, () => {});
    read(); const t = setInterval(read, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [refresh]);
  return state;
}
/** Merkez's disk is getting full for the cafés' copies (Bugün): under 15 % free, or near the guard. */
export const diskLow = (s: CloudState | null) => !!s && (s.disk.low ?? (s.disk.free !== null && s.disk.free < s.disk.minFree * 1.5));

/** Özet → "Sunucu yedeği": last upload, size, copies; the keep rule and the per-copy cap can be changed here. */
export function CloudBackupSection({ l, disabled }: { l: Business; disabled: boolean }) {
  const [refresh, setRefresh] = useState(0), state = useCloudBackups(refresh), row = state?.businesses.find(b => b.tenantId === l.tenantId);
  const [form, setForm] = useState<{ daily: string; weekly: string; capMb: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  if (l.activation !== 'active') return null;
  async function save() {
    if (!form) return;
    setBusy(true); setError(''); setSaved(false);
    try { await api(`${ADMIN}/cloud-backups/settings`, { tenantId: l.tenantId, daily: Number(form.daily), weekly: Number(form.weekly), capMb: Number(form.capMb) }); setForm(null); setSaved(true); setRefresh(n => n + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <DCard id={`cloud-${l.tenantId}`} title="Sunucu yedeği" icon={<Cloud size={20} />} tone="info" className="detail-cloud" tip="İşletmenin bilgisayarı her yedekten sonra şifreli bir kopyayı Mola Merkez’e gönderir. Mola Merkez kopyaları açamaz; açmak için işletme sahibinin kurtarma kodu gerekir. Saklama: günlük ve haftalık kopyalar; kopya başına üst sınır buradan değişir."
    actions={row ? <span className={`status-chip ${row.stale || row.warning?.tone === 'bad' ? 'bad' : row.warning ? 'warn' : row.count ? 'ok' : 'idle'}`}>{row.stale ? 'Yedek gelmiyor' : row.warning ? 'Bakılmalı' : row.count ? 'Sağlıklı' : 'Henüz kopya yok'}</span> : undefined}>
    {!row ? <p className="muted small">{state ? 'Bilgi yok.' : 'Yükleniyor…'}</p> : <>
      {row.warning && <Notice tone={row.warning.tone === 'bad' ? 'error' : undefined}>Sunucu yedeği: {row.warning.text}</Notice>}
      <dl className="detail-facts compact" aria-label="Sunucu yedeği durumu">
        <div><dt>Son sunucu yedeği</dt><dd className={row.stale ? 'fact-bad' : undefined}>{row.stale && <span className="fact-dot" aria-hidden="true" />}{row.lastUploadAt ? dateTime(row.lastUploadAt) : 'Henüz yok'}</dd>{row.lastError && <dd className="fact-sub">Son deneme: {row.lastError}</dd>}</div>
        {/* The room grows with the café (its copies + 1); only one copy above the per-copy cap is refused. */}
        <div><dt>Toplam boyut</dt><dd>{bytesText(row.bytes)}</dd><dd className="fact-sub">Kopya başına en çok {bytesText(row.cap)}</dd></div>
        <div><dt>Kopya sayısı</dt><dd>{row.count}</dd><dd className="fact-sub">{row.settings.daily} günlük + {row.settings.weekly} haftalık saklanır</dd></div>
        {!!row.years?.count && <div><dt>Yıl paketleri</dt><dd>{row.years.names.join(', ')}</dd><dd className="fact-sub">{bytesText(row.years.bytes)} · bir kez gelir, hep saklanır</dd></div>}
      </dl>
      {row.copies.length > 0 && <ul className="cloud-copies" aria-label="Sunucudaki kopyalar">{row.copies.map(c => <li key={c.id}><span>{dateTime(c.createdAt)}</span><span className="muted">{bytesText(c.bytes)} · sürüm {c.appVersion}</span></li>)}</ul>}
      {form ? <form className="cloud-settings" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>Günlük kopya<input type="number" min={1} max={31} required value={form.daily} onChange={e => setForm({ ...form, daily: e.target.value })} /></label>
        <label>Haftalık kopya<input type="number" min={0} max={26} required value={form.weekly} onChange={e => setForm({ ...form, weekly: e.target.value })} /></label>
        <label>Kopya başına en çok (MB)<input type="number" min={100} max={512000} required value={form.capMb} onChange={e => setForm({ ...form, capMb: e.target.value })} /></label>
        <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setForm(null)}>Vazgeç</button><button className="btn primary small-btn" disabled={busy || disabled}>Kaydet</button></div>
      </form> : <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled} onClick={() => { setSaved(false); setForm({ daily: String(row.settings.daily), weekly: String(row.settings.weekly), capMb: String(row.settings.capMb) }); }}>Saklama ve sınırı değiştir</button></div>}
      {saved && <Notice tone="success">Kaydedildi. Bir sonraki yüklemede uygulanır.</Notice>}
    </>}
    {error && <Notice tone="error">{error}</Notice>}
  </DCard>;
}

/**
 * Lisans → "Yeni bilgisayara taşıma kodu": for an owner whose computer broke or was lost. Check who is calling first. One use,
 * 24 hours, bound to the first computer that enters it; the copy still needs the owner's recovery code.
 */
export function TransferCode({ l, disabled }: { l: Business; disabled: boolean }) {
  const [refresh, setRefresh] = useState(0), state = useCloudBackups(refresh), row = state?.businesses.find(b => b.tenantId === l.tenantId);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false);
  if (l.activation !== 'active') return null;
  async function make() {
    setBusy(true); setError(''); setCopied(false);
    try { setIssued(await api<{ code: string; expiresAt: string }>(`${ADMIN}/cloud-backups/transfer-code`, { tenantId: l.tenantId })); setRefresh(n => n + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const t = row?.transfer;
  return <DCard title="Yeni bilgisayara taşıma" icon={<KeyRound size={20} />} tone="info" className="detail-transfer" tip="İşletmenin bilgisayarı bozulduysa ya da kaybolduysa: arayanın işletme sahibi olduğundan emin olun, taşıma kodunu telefonda okuyun. Sahip yeni bilgisayarda Mola’yı kurar, ilk ekranda “Mola Merkez’den geri yükle”yi seçer, bu kodu ve kendi kurtarma kodunu girer. Eski bilgisayar sonra bağlanınca orada sipariş kapanır. Kod tek kullanımlık, 24 saat geçerli.">
    {!issued && <p className="dcard-quiet">Bilgisayarı bozulan işletme, sunucu yedeğini yeni bilgisayara bu kodla getirir.</p>}
    {issued ? <div className="owner-reset-issued"><p className="activation-code" data-testid="transfer-code">{issued.code}</p>
      <p className="muted small">Tek kullanımlık; {dateTime(issued.expiresAt)} saatine kadar geçerli. Bu kod bir daha gösterilmez; yenisi eskisini geçersiz kılar.</p>
      <div className="application-actions"><button type="button" className="btn secondary small-btn" onClick={() => { void navigator.clipboard?.writeText(issued.code).then(() => setCopied(true)).catch(() => {}); }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Kopyalandı' : 'Kodu kopyala'}</button><button type="button" className="btn secondary small-btn" onClick={() => setIssued(null)}>Kapat</button></div></div>
      : <>
        {t && <p className="muted small">{t.usedAt ? `Son taşıma kodu ${dateTime(t.usedAt)} tarihinde kullanıldı.` : t.active ? `Geçerli bir taşıma kodu var (${dateTime(t.expiresAt)} saatine kadar${t.bound ? ', bir bilgisayarda girildi' : ''}).` : 'Son taşıma kodunun süresi doldu.'}</p>}
        {row && !row.count && <p className="muted small">Mola Merkez’de bu işletmenin henüz sunucu yedeği yok.</p>}
        <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={disabled || busy} onClick={() => void make()}><KeyRound size={15} />Taşıma kodu ver</button></div>
      </>}
    {error && <Notice tone="error">{error}</Notice>}
  </DCard>;
}

/** Ayarlar → Yedek: how much of Merkez's disk the cafés' copies use, and what is left. */
export function CloudDiskCard() {
  const state = useCloudBackups();
  if (!state) return null;
  const { used, free, total, minFree } = state.disk, low = diskLow(state);
  // A plain block inside Ayarlar → Yedek (not a region of its own: "Yedek" stays the one region there).
  return <div className="cloud-disk" data-testid="cloud-disk"><h3 className="detail-subhead"><HardDrive size={15} /> Kafelerin sunucu yedekleri</h3>
    <p className="muted small">Kafelerin şifreli yedek kopyaları bu bilgisayarda, Mola Merkez yedeğinden ayrı durur (zaten yedektir, Merkez yedeğine girmez). Merkez bu kopyaları açamaz.</p>
    <dl className="detail-facts compact">
      <div><dt>Kullanılan</dt><dd>{bytesText(used)}</dd><dd className="fact-sub">{state.businesses.filter(b => b.count).length} işletme · {state.businesses.reduce((n, b) => n + b.count, 0)} kopya</dd></div>
      <div><dt>Diskte boş</dt><dd className={low ? 'fact-bad' : undefined}>{low && <span className="fact-dot" aria-hidden="true" />}{free === null ? '—' : bytesText(free)}</dd>{total ? <dd className="fact-sub">Toplam {bytesText(total)}</dd> : null}</div>
      <div><dt>En az boş kalacak</dt><dd>{bytesText(minFree)}</dd><dd className="fact-sub">Altına inince yeni kopya alınmaz</dd></div>
    </dl>
    {low && <Notice tone="error">Diskte yer azaldı (%15’in altında). Diski büyütün ya da işletmelerin saklanan kopya sayısını azaltın.</Notice>}
  </div>;
}

import { useEffect, useState } from 'react';
import { FolderOpen, FolderPen, PowerOff, RefreshCw, X } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';
import { Chip, IconBtn, SCard } from './platformSettingsKit';
import { FolderField } from './PlatformFolderPicker';

type Status = { path: string | null; isDefault: boolean; cloud: boolean; lastWriteAt?: string; lastError?: string; written?: number; running: boolean };
const parts: [string, string][] = [
  ['durum-ozeti.md', 'İşletmeler, sürümleri, son bağlantı, açık talepler, yedekler ve bildirimler tek sayfada'],
  ['islem-kayitlari\\', 'İşlem kayıtları: gün gün dosyalar, günlük doğrulama notu, mühürler'],
  ['hata-kayitlari\\', 'İşletmelerden gelen hata kayıtları, aynı hata bir dosyada (yalnız kodun yeri)'],
  ['destek-talepleri\\', 'Destek talepleri ve ekleri (ekler 14 gün). Kişisel veri: bulut klasörüne yazılmaz'],
  ['surumler\\', 'Güncelleme paketleri ve her işletmenin sürüm geçmişi'],
  ['guncellemeler\\', 'Buraya bıraktığınız .mola-guncelleme dosyası Güncellemeler’de “Klasörde hazır” olur'],
  ['README.md', 'Her dosyanın ne olduğu (sizin ve Claude için)'],
];
const TIP = 'Mola Yönetim bu bilgisayarda okunabilir kopyalar tutar (durum özeti, işlem kayıtları, hata kayıtları, destek talepleri, sürümler): bir değişiklikten birkaç saniye sonra ve 5 dakikada bir güncellenir. Dosyaları elle değiştirmeyin. Klasör OneDrive’ın dışında olmalı: destek talepleri kişisel veri içerir ve bulut klasörüne hiç yazılmaz.';
/**
 * Ayarlar → "Çalışma klasörü" (server/merkez/workfolder.ts): where Mola Yönetim keeps readable copies on this computer.
 * Default C:\MolaCalisma for the installed Mola Yönetim (outside OneDrive); off until chosen in development.
 * One card: what it is (ⓘ), the folder and its state, one action ("Şimdi güncelle", or choosing a folder when it is off);
 * changing or turning it off and the list of files are folded away.
 */
export function PlatformWorkFolder() {
  const [s, setS] = useState<Status | null>(null), [path, setPath] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const load = () => api<Status>(`${ADMIN}/workfolder`).then(r => { setS(r); setPath(p => p || r.path || 'C:\\MolaCalisma'); }, e => setError((e as Error).message));
  useEffect(() => { void load(); const t = setInterval(() => void api<Status>(`${ADMIN}/workfolder`).then(setS, () => {}), 15000); return () => clearInterval(t); }, []);
  async function save(next: string | null, done: string) {
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<Status>(`${ADMIN}/workfolder`, { path: next }, undefined, 120000); setS(r); if (r.lastError) setError(`Klasör ayarlandı ama yazılamadı: ${r.lastError}`); else { setNotice(done); setEditing(false); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function syncNow() {
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<Status>(`${ADMIN}/workfolder/sync`, {}, undefined, 120000); setS(r); if (r.lastError) setError(r.lastError); else setNotice('Çalışma klasörü güncellendi.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!s) return <section className="ps-workfolder" aria-label="Çalışma klasörü">{error ? <Notice tone="error">{error}</Notice> : <p className="muted">Yükleniyor…</p>}</section>;
  const state = s.lastError ? { tone: 'bad' as const, text: 'Yazılamadı' } : s.path ? { tone: 'ok' as const, text: 'Açık' } : { tone: 'idle' as const, text: 'Kapalı' };
  const form = <form className="workfolder-form ps-form" onSubmit={e => { e.preventDefault(); void save(path.trim(), 'Çalışma klasörü kaydedildi ve dolduruldu.'); }}>
    {/* "Göz at": Windows' folder window on this computer (no cloud suggestions: this folder stays outside OneDrive). */}
    <FolderField label="Klasör yolu" purpose="workfolder" disabled={busy} value={path} placeholder="C:\MolaCalisma" onChange={setPath} />
    <div className="ps-actions">{s.path && <IconBtn icon={X} label="Vazgeç" disabled={busy} onClick={() => setEditing(false)} />}<button className="btn primary small-btn grow" disabled={busy || !path.trim()}>Kaydet</button></div>
  </form>;
  return <section className="ps-workfolder workfolder-panel" aria-label="Çalışma klasörü">
    <SCard icon={FolderOpen} title="Çalışma klasörü" sub="Okunabilir kopyalar bu bilgisayarda" tip={TIP} tipLabel="Bu klasör" aside={<Chip tone={state.tone}>{state.text}</Chip>} className="ps-folder-card">
      <dl className="ps-folder-facts" aria-label="Çalışma klasörü durumu">
        <div className="ps-folder-path"><dt>Klasör</dt><dd className={s.path ? 'mono' : undefined}>{s.path ?? 'Kapalı'}</dd>{s.isDefault && s.path && <dd className="ps-stat-sub">Varsayılan</dd>}</div>
        <div><dt>Son güncelleme</dt><dd className={s.lastError ? 'bad' : undefined}>{s.lastError ? 'Yazılamadı' : s.lastWriteAt ? dateTime(s.lastWriteAt) : s.path ? 'Henüz yazılmadı' : '—'}</dd>{s.lastError && <dd className="ps-stat-sub">{s.lastError}</dd>}</div>
      </dl>
      {s.cloud && <Notice>Bu klasör bir bulut klasörünün (OneDrive, Google Drive, Dropbox…) içinde: destek talepleri buraya yazılmaz. Bütün dosyalar için OneDrive dışında bir klasör seçin (ör. C:\MolaCalisma).</Notice>}
      {!s.path || editing ? form : <div className="ps-actions">
        <button type="button" className="btn primary small-btn grow" disabled={busy} onClick={() => void syncNow()}><RefreshCw size={16} aria-hidden="true" />Şimdi güncelle</button>
        <IconBtn icon={FolderPen} label="Klasörü değiştir" disabled={busy} onClick={() => { setPath(s.path ?? ''); setEditing(true); }} />
        <IconBtn icon={PowerOff} label="Kapat" tone="danger" disabled={busy} onClick={() => { if (confirm('Çalışma klasörü kapatılsın mı? Var olan dosyalar silinmez, yalnız güncellenmez.')) void save(null, 'Çalışma klasörü kapatıldı. Var olan dosyalar yerinde duruyor.'); }} />
      </div>}
      {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
      <details className="ps-more">
        <summary>İçinde ne var</summary>
        <ul className="workfolder-parts">{parts.map(([name, text]) => <li key={name}><code>{name}</code><span>{text}</span></li>)}</ul>
      </details>
    </SCard>
  </section>;
}

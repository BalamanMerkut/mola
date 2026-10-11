import { useEffect, useState } from 'react';
import { HardDriveUpload, Usb, Cloud, Folder } from 'lucide-react';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import type { SecurityCaller } from './desktop-call';
import './security.css';

type Place = { path: string; label: string; kind: 'usb' | 'onedrive' | 'gdrive' | 'folder' };
export type SecondStatus = { available: boolean; reason: string | null; folder: string | null; kind?: Place['kind']; label?: string; lastCopyAt?: string; lastError?: string; kept?: number; keep?: number; places?: Place[] };
const when = (iso?: string) => iso ? new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
const icons = { usb: Usb, onedrive: Cloud, gdrive: Cloud, folder: Folder };

/** "İkinci yedek yeri": a flash drive or a synced folder that gets a checked copy of every backup. */
export function SecondBackupCard({ caller, bare = false, onChange }: { caller: SecurityCaller; bare?: boolean; onChange?: (s: SecondStatus) => void }) {
  const [status, setStatus] = useState<SecondStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false), [places, setPlaces] = useState<Place[] | null>(null), [picked, setPicked] = useState(''), [typed, setTyped] = useState('');
  const update = (s: SecondStatus) => { setStatus(s); onChange?.(s); window.dispatchEvent(new Event('mola:security')); };
  useEffect(() => { let live = true; void caller<SecondStatus>('/second-backup').then(s => { if (live) update(s); }).catch(e => { if (live) setError((e as Error).message); }); return () => { live = false; }; }, []);
  async function open() {
    setChoosing(true); setError(''); setPlaces(null); setPicked(''); setTyped('');
    try { setPlaces((await caller<SecondStatus>('/second-backup?places=1')).places ?? []); } catch (e) { setError((e as Error).message); setPlaces([]); }
  }
  async function save(folder: string | null) {
    setBusy(true); setError('');
    const place = places?.find(p => p.path === folder);
    try { update(await caller<SecondStatus>('/second-backup', { folder, ...(place ? { kind: place.kind, label: place.label } : { kind: 'folder' }) })); setChoosing(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const target = picked === 'typed' ? typed.trim() : picked;
  const body = !status ? (!error && <p className="muted small">Yükleniyor…</p>) : !status.available ? <Notice>{status.reason}</Notice> : <>
    <dl className="device-check-list">
      <div><dt>Yer</dt><dd>{status.folder ? (status.label ?? status.folder) : 'Seçilmedi'}</dd></div>
      {status.folder && <div><dt>Son kopya</dt><dd className={status.lastError ? 'backup-warn' : 'backup-ok'}>{status.lastCopyAt ? when(status.lastCopyAt) : 'Henüz yok'}</dd></div>}
    </dl>
    {status.folder && status.label && <p className="muted small second-path">{status.folder}</p>}
    {status.lastError && <Notice tone="error">{status.lastError}</Notice>}
    {!status.folder && <p className="muted small">Bilgisayar bozulur ya da çalınırsa yedekler de gider. Bir flash bellek ya da OneDrive klasörü seçin.</p>}
    {choosing ? <div className="second-choose">
      {places === null ? <p className="muted small">Takılı diskler aranıyor…</p> : <div role="radiogroup" aria-label="İkinci yedek yeri" className="second-places">
        {places.map(p => { const Icon = icons[p.kind]; return <label key={p.path} className={picked === p.path ? 'active' : ''}><input type="radio" name="second-place" checked={picked === p.path} onChange={() => setPicked(p.path)} /><Icon size={16} /><span>{p.label}<small>{p.path}</small></span></label>; })}
        {!places.length && <p className="muted small">Takılı flash bellek ya da OneDrive bulunamadı. Flash belleği takıp yeniden açın ya da klasör yolunu yazın.</p>}
        <label className={picked === 'typed' ? 'active' : ''}><input type="radio" name="second-place" checked={picked === 'typed'} onChange={() => setPicked('typed')} /><Folder size={16} /><span>Başka klasör</span></label>
        {picked === 'typed' && <input aria-label="Klasör yolu" placeholder="Ör. E:\ ya da D:\Yedekler" value={typed} onChange={e => setTyped(e.target.value)} />}
      </div>}
      <div className="recovery-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => setChoosing(false)}>Vazgeç</button>
        <button type="button" className="btn primary" disabled={busy || !target} onClick={() => void save(target)}>{busy ? 'Kaydediliyor…' : 'Bu yeri kullan'}</button>
      </div>
    </div> : <div className="recovery-actions">
      <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void open()}><HardDriveUpload size={15} />{status.folder ? 'Yeri değiştir' : 'Yer seç'}</button>
      {status.folder && <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void save(null)}>İkinci yedeği kapat</button>}
    </div>}
  </>;
  const content = <>{body}{error && <Notice tone="error">{error}</Notice>}</>;
  if (bare) return <div className="second-card">{content}</div>;
  return <section className="panel second-card">
    <h2><HardDriveUpload size={18} />İkinci yedek yeri <HelpTip title="İkinci yedek yeri">Her yedekten sonra şifreli bir kopyası buraya da yazılır ve kontrol edilir: flash bellek ya da OneDrive klasörü. En yeni 3 kopya saklanır (daha eskileri bu bilgisayarda). Kurtarma kodu oraya yazılmaz; kopya yalnız kodla açılır. Flash bellek takılı değilse uyarı çıkar, bir sonraki yedekte yeniden denenir.</HelpTip></h2>
    {content}
  </section>;
}

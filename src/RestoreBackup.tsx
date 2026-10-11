import { useEffect, useState } from 'react';
import { ArchiveRestore, CloudDownload, HardDrive, Search } from 'lucide-react';
import { Modal, Notice } from './components';
import { desktopCall } from './desktop-call';
import './security.css';

type Found = { path: string; createdAt: string; installId: string; verified: boolean; place: string; source?: 'local' | 'second' | 'other'; bytes?: number };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const size = (bytes = 0) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const sourceText = { local: 'Bu bilgisayar', second: 'İkinci yer', other: 'Seçilen klasör' } as const;

/**
 * New computer, clean install: pick a backup (flash drive, OneDrive "Mola-Yedek", a typed folder), enter the recovery code.
 * The server restores it into a separate folder, verifies it, locks its key for this computer and switches to it.
 */
export function RestoreDialog({ token, onClose, initial = 'folder' }: { token: string; onClose: () => void; initial?: 'folder' | 'merkez' }) {
  const [mode, setMode] = useState(initial), [busy, setBusy] = useState(false);
  return <Modal title="Yedekten geri yükle" wide onClose={() => { if (!busy) onClose(); }} dismissible={!busy}><div className="modal-body desktop-dialog restore-dialog">
    <div className="restore-modes" role="group" aria-label="Yedek nereden gelecek">
      <button type="button" aria-pressed={mode === 'folder'} className={mode === 'folder' ? 'active' : ''} disabled={busy} onClick={() => setMode('folder')}><HardDrive size={16} />Flash bellek / klasör</button>
      <button type="button" aria-pressed={mode === 'merkez'} className={mode === 'merkez' ? 'active' : ''} disabled={busy} onClick={() => setMode('merkez')}><CloudDownload size={16} />Mola Merkez’den</button>
    </div>
    {mode === 'folder' ? <FolderRestore token={token} busy={busy} setBusy={setBusy} onClose={onClose} /> : <MerkezRestore token={token} busy={busy} setBusy={setBusy} onClose={onClose} />}
  </div></Modal>;
}

type CloudCopy = { id: string; createdAt: string; bytes: number; files: number; verified: boolean };
type Progress = { busy: boolean; progress: { stage: 'download' | 'restore'; received: number; total: number } | null };
/**
 * "Mola Merkez'den geri yükle": the old computer is broken or gone. The Mola team gives a one-time taşıma kodu (after checking
 * who calls); it lists this business's encrypted copies on Mola Merkez. The chosen copy is downloaded, checked file by file,
 * opened with the owner's recovery code and restored like a flash-drive copy. Merkez itself can never open it.
 */
function MerkezRestore({ token, busy, setBusy, onClose }: { token: string; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void }) {
  const [transfer, setTransfer] = useState(''), [found, setFound] = useState<{ name: string; copies: CloudCopy[] } | null>(null), [picked, setPicked] = useState(''), [code, setCode] = useState('');
  const [error, setError] = useState(''), [done, setDone] = useState(false), [progress, setProgress] = useState<Progress['progress']>(null), [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void desktopCall<Progress>(token, '/api/desktop/restore/merkez/progress').then(p => setProgress(p.progress)).catch(() => {}); }, 1000);
    return () => clearInterval(t);
  }, [busy, token]);
  async function open() {
    setOpening(true); setError('');
    try { const r = await desktopCall<{ name: string; copies: CloudCopy[] }>(token, '/api/desktop/restore/merkez/open', { code: transfer }, 60000); setFound(r); setPicked(r.copies[0]?.id ?? ''); }
    catch (e) { setError((e as Error).message); } finally { setOpening(false); }
  }
  async function restore() {
    setBusy(true); setError('');
    try { await desktopCall(token, '/api/desktop/restore/merkez', { copy: picked, code }, 60 * 60000); setDone(true); setCode(''); setTimeout(() => location.assign('/'), 1500); }
    catch (e) { setError((e as Error).message); setBusy(false); setProgress(null); }
  }
  if (done) return <Notice tone="success">Veriler geri yüklendi ve doğrulandı. Mola yeniden açılıyor…</Notice>;
  const percent = progress && progress.total ? Math.min(100, Math.round(progress.received / progress.total * 100)) : 0;
  return <>
    {!found ? <>
      <p>Eski bilgisayarın şifreli yedekleri Mola Merkez’de de durur. Mola ekibini arayın, <strong>taşıma kodu</strong> isteyin (tek kullanımlık, 24 saat geçerli). Yedeği açmak için ayrıca kâğıttaki <strong>kurtarma kodunuz</strong> gerekir; Mola ekibi yedeğinizi açamaz.</p>
      <form className="restore-search" onSubmit={e => { e.preventDefault(); void open(); }}>
        <input aria-label="Taşıma kodu" placeholder="XXXX-XXXX-XXXX-XXXX" value={transfer} onChange={e => setTransfer(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        <button className="btn secondary small-btn" disabled={opening || transfer.replace(/[\s-]/g, '').length < 16}><CloudDownload size={15} />{opening ? 'Bakılıyor…' : 'Yedekleri göster'}</button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="recovery-actions"><button type="button" className="btn secondary" onClick={onClose}>Vazgeç</button></div>
    </> : <>
      <p>İşletme: <strong>{found.name}</strong></p>
      {!found.copies.length ? <Notice>Mola Merkez’de bu işletmenin yedeği yok. Eski bilgisayarın flash bellek ya da OneDrive yedeğini deneyin.</Notice> :
        <div role="radiogroup" aria-label="Mola Merkez’deki yedekler" className="second-places restore-list">
          {found.copies.map((b, i) => <label key={b.id} className={picked === b.id ? 'active' : ''}><input type="radio" name="merkez-backup" checked={picked === b.id} disabled={busy} onChange={() => setPicked(b.id)} /><CloudDownload size={16} /><span><strong>{when(b.createdAt)}</strong>
            <span className="restore-meta"><span className="restore-source second">Mola Merkez</span><span>{size(b.bytes)}</span><span>{b.verified ? 'doğrulanmış' : 'doğrulanmamış'}</span>{i === 0 && <span>· önerilen</span>}</span></span></label>)}
        </div>}
      <form className="restore-code" onSubmit={e => { e.preventDefault(); void restore(); }}>
        <label>Kurtarma kodu<input value={code} disabled={busy} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} /></label>
        {busy && <p className="muted" role="status">{progress?.stage === 'restore' ? 'Yedek açılıyor ve doğrulanıyor…' : `Mola Merkez’den indiriliyor… %${percent}`}</p>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !picked || code.replace(/[\s-]/g, '').length < 24}><ArchiveRestore size={16} />{busy ? 'Geri yükleniyor…' : 'İndir ve geri yükle'}</button></div>
      </form>
    </>}
    <p className="muted small">Geri yükleme yalnız boş kurulumda yapılır. Sonra bu bilgisayar işletmenin bilgisayarı olur; eski bilgisayar bağlanınca orada sipariş kapanır.</p>
  </>;
}

function FolderRestore({ token, busy, setBusy, onClose }: { token: string; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void }) {
  const [backups, setBackups] = useState<Found[] | null>(null), [folder, setFolder] = useState(''), [picked, setPicked] = useState(''), [code, setCode] = useState('');
  const [error, setError] = useState(''), [done, setDone] = useState(false);
  async function search(typed = '') {
    setError(''); setBackups(null);
    try {
      const result = await desktopCall<{ backups: Found[] }>(token, `/api/desktop/restore/backups${typed ? `?folder=${encodeURIComponent(typed)}` : ''}`);
      // The server lists the newest checked backup first: that one is picked, unless the owner already chose another.
      setBackups(result.backups); setPicked(p => result.backups.some(b => b.path === p) ? p : result.backups[0]?.path ?? '');
    } catch (e) { setError((e as Error).message); setBackups([]); }
  }
  useEffect(() => { void search(); }, []);
  async function restore() {
    setBusy(true); setError('');
    try {
      await desktopCall(token, '/api/desktop/restore', { backup: picked, code }, 15 * 60000);
      setDone(true); setCode('');
      setTimeout(() => location.assign('/'), 1500);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <>
    {done ? <Notice tone="success">Veriler geri yüklendi ve doğrulandı. Mola yeniden açılıyor…</Notice> : <>
      <p>Eski bilgisayarın yedekleri flash bellekte ya da OneDrive’da <strong>Mola-Yedek</strong> klasöründe durur. Flash belleği takın, yedeği seçin ve kurtarma kodunu girin.</p>
      <form className="restore-search" onSubmit={e => { e.preventDefault(); void search(folder.trim()); }}>
        <input aria-label="Yedek klasörü" placeholder="Başka klasör (ör. E:\Mola-Yedek)" value={folder} onChange={e => setFolder(e.target.value)} />
        <button className="btn secondary small-btn" disabled={busy}><Search size={15} />Ara</button>
      </form>
      {backups === null ? <p className="muted small">Yedekler aranıyor…</p> : !backups.length ? <Notice>Kurtarma koduyla açılan yedek bulunamadı. Flash belleği takıp “Ara”ya basın ya da klasör yolunu yazın.</Notice> :
        <div role="radiogroup" aria-label="Bulunan yedekler" className="second-places restore-list">
          {backups.map((b, i) => <label key={b.path} className={picked === b.path ? 'active' : ''}><input type="radio" name="restore-backup" checked={picked === b.path} onChange={() => setPicked(b.path)} /><ArchiveRestore size={16} /><span><strong>{when(b.createdAt)}</strong>
            <span className="restore-meta"><span className={`restore-source ${b.source ?? 'other'}`}>{b.source === 'other' || !b.source ? b.place : sourceText[b.source]}</span>{b.bytes !== undefined && <span>{size(b.bytes)}</span>}<span className={b.verified ? '' : 'restore-unchecked'}>{b.verified ? 'doğrulanmış' : 'doğrulanmamış'}</span>{i === 0 && <span>· önerilen</span>}</span>
            <small>{b.path}</small></span></label>)}
        </div>}
      <form className="restore-code" onSubmit={e => { e.preventDefault(); void restore(); }}>
        <label>Kurtarma kodu<input value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} /></label>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !picked || code.replace(/[\s-]/g, '').length < 24}><ArchiveRestore size={16} />{busy ? 'Geri yükleniyor…' : 'Geri yükle'}</button></div>
      </form>
      <p className="muted small">Geri yükleme yalnız boş kurulumda yapılır. Yedek önce ayrı bir klasöre açılıp doğrulanır; sorun çıkarsa bu bilgisayardaki boş kurulum olduğu gibi kalır.</p>
    </>}
  </>;
}

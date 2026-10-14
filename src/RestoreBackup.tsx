import { useEffect, useState } from 'react';
import { ArchiveRestore, Check, CloudDownload, HardDrive, Mail, Search, ShieldCheck } from 'lucide-react';
import { Modal, Notice } from './components';
import { desktopCall } from './desktop-call';
import { homePath } from './remoteTransport';
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
    try { await desktopCall(token, '/api/desktop/restore/merkez', { copy: picked, code }, 60 * 60000); setDone(true); setCode(''); setTimeout(() => location.assign(homePath()), 1500); }
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

type OwnerStart = { ticket: string; email: string; name: string };
type OwnerVerified = { name: string; cloud: { name: string; copies: CloudCopy[] } | null };
/**
 * "İşletmem var" (13 Ekim): the owner signs in on a new computer with the business e-mail, their username and password; a
 * 6-digit code goes to that e-mail. Then the data comes back: from Mola Merkez when the business has Sunucu yedeği, else
 * from a flash drive or a synced folder. The backup opens with the same password (no recovery code, no call to Mola ekibi).
 */
export function OwnerRestoreDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [step, setStep] = useState<'login' | 'code' | 'pick'>('login'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [email, setEmail] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [started, setStarted] = useState<OwnerStart | null>(null), [verified, setVerified] = useState<OwnerVerified | null>(null), [source, setSource] = useState<'merkez' | 'folder'>('merkez');
  async function start() {
    setBusy(true); setError('');
    try { setStarted(await desktopCall<OwnerStart>(token, '/api/desktop/owner-login/start', { email: email.trim(), username: username.trim(), password }, 60000)); setCode(''); setStep('code'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError('');
    try {
      const r = await desktopCall<OwnerVerified>(token, '/api/desktop/owner-login/verify', { ticket: started!.ticket, code: code.trim() }, 60000);
      setVerified(r); setSource(r.cloud?.copies.length ? 'merkez' : 'folder'); setStep('pick');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const secret = { username: username.trim(), password };
  const restart = () => { setStep('login'); setStarted(null); setVerified(null); setCode(''); setError(''); };
  const steps = ['Giriş', 'E-posta kodu', 'Verileri getir'], at = step === 'login' ? 0 : step === 'code' ? 1 : 2;
  return <Modal title="İşletmem var" wide onClose={() => { if (!busy) onClose(); }} dismissible={!busy}><div className="modal-body desktop-dialog restore-dialog owner-restore">
    <ol className="owner-steps" aria-label="Adımlar">{steps.map((s, i) => <li key={s} className={i < at ? 'done' : i === at ? 'active' : ''} aria-current={i === at ? 'step' : undefined}><span>{i < at ? <Check size={13} /> : i + 1}</span>{s}</li>)}</ol>
    {step === 'login' ? <form className="owner-form" onSubmit={e => { e.preventDefault(); void start(); }}>
      <p>Mola’yı başka bir bilgisayarda kullanan işletmenizi buraya taşıyın. İşletme sahibi hesabınızla giriş yapın; işletmenin kayıtlı e-posta adresine bir doğrulama kodu gelir.</p>
      <label>İşletmenin e-posta adresi<input type="email" required autoComplete="email" disabled={busy} value={email} onChange={e => setEmail(e.target.value)} placeholder="ör. ayse@ornekkafe.com" /></label>
      <label>Kullanıcı adı<input required autoComplete="username" disabled={busy} value={username} onChange={e => setUsername(e.target.value.toLowerCase())} placeholder="ör. ayse.kafe" /></label>
      <label>Şifre<input type="password" required autoComplete="current-password" disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !email.includes('@') || !username.trim() || !password}><Mail size={16} />{busy ? 'Kontrol ediliyor…' : 'Kod gönder'}</button></div>
      <p className="muted small">E-posta, işletmenizin Mola’da kayıtlı adresidir: başvuruda yazdığınız fatura e-postası ya da Ayarlar’da doğruladığınız adres. Şifreniz yalnız doğrulamak için şifreli bağlantıyla Mola Merkez’e gider ve orada saklanmaz.</p>
    </form>
    : step === 'code' ? <form className="owner-form" onSubmit={e => { e.preventDefault(); void verify(); }}>
      <p><strong>{started?.name}</strong> için doğrulama kodu <strong>{started?.email}</strong> adresine gönderildi. Kod 10 dakika geçerlidir.</p>
      <label>Doğrulama kodu<input className="owner-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required disabled={busy} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus /></label>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={restart}>Geri</button><button className="btn primary" disabled={busy || code.length !== 6}><ShieldCheck size={16} />{busy ? 'Doğrulanıyor…' : 'Doğrula'}</button></div>
      <p className="muted small">Kod gelmediyse gereksiz (spam) klasörüne bakın ya da “Geri”ye basıp yeniden isteyin.</p>
    </form>
    : <>
      <Notice tone="success"><span>Doğrulandı: <strong>{verified?.name}</strong>. Şimdi verilerinizi getirin.</span></Notice>
      {!!verified?.cloud?.copies.length && <div className="restore-modes" role="group" aria-label="Yedek nereden gelecek">
        <button type="button" aria-pressed={source === 'merkez'} className={source === 'merkez' ? 'active' : ''} disabled={busy} onClick={() => setSource('merkez')}><CloudDownload size={16} />Mola Merkez’den</button>
        <button type="button" aria-pressed={source === 'folder'} className={source === 'folder' ? 'active' : ''} disabled={busy} onClick={() => setSource('folder')}><HardDrive size={16} />Flash bellek / klasör</button>
      </div>}
      {!verified?.cloud?.copies.length && <p className="muted small">Bu işletmenin Mola Merkez’de yedeği yok (Sunucu yedeği hizmeti alınmamış). Eski bilgisayarın flash bellek ya da OneDrive yedeğinden getirin.</p>}
      {source === 'merkez' && verified?.cloud ? <CloudPick token={token} copies={verified.cloud.copies} busy={busy} setBusy={setBusy} onClose={onClose} secret={secret} />
        : <FolderRestore token={token} busy={busy} setBusy={setBusy} onClose={onClose} secret={secret} />}
    </>}
  </div></Modal>;
}

/** The owner's Sunucu yedeği copies (the session Merkez opened with the e-mail code): pick one, download, open with the password. */
function CloudPick({ token, copies, busy, setBusy, onClose, secret }: { token: string; copies: CloudCopy[]; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; secret: { username: string; password: string } }) {
  const [picked, setPicked] = useState(copies[0]?.id ?? ''), [error, setError] = useState(''), [done, setDone] = useState(false), [progress, setProgress] = useState<Progress['progress']>(null);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void desktopCall<Progress>(token, '/api/desktop/restore/merkez/progress').then(p => setProgress(p.progress)).catch(() => {}); }, 1000);
    return () => clearInterval(t);
  }, [busy, token]);
  async function restore() {
    setBusy(true); setError('');
    try { await desktopCall(token, '/api/desktop/restore/merkez', { copy: picked, ...secret }, 60 * 60000); setDone(true); setTimeout(() => location.assign(homePath()), 1500); }
    catch (e) { setError((e as Error).message); setBusy(false); setProgress(null); }
  }
  if (done) return <Notice tone="success">Veriler geri yüklendi ve doğrulandı. Mola yeniden açılıyor…</Notice>;
  const percent = progress && progress.total ? Math.min(100, Math.round(progress.received / progress.total * 100)) : 0;
  return <>
    <div role="radiogroup" aria-label="Mola Merkez’deki yedekler" className="second-places restore-list">
      {copies.map((b, i) => <label key={b.id} className={picked === b.id ? 'active' : ''}><input type="radio" name="owner-cloud" checked={picked === b.id} disabled={busy} onChange={() => setPicked(b.id)} /><CloudDownload size={16} /><span><strong>{when(b.createdAt)}</strong>
        <span className="restore-meta"><span className="restore-source second">Mola Merkez</span><span>{size(b.bytes)}</span><span>{b.verified ? 'doğrulanmış' : 'doğrulanmamış'}</span>{i === 0 && <span>· önerilen</span>}</span></span></label>)}
    </div>
    {busy && <div className="owner-progress" role="status"><span style={{ width: `${progress?.stage === 'restore' ? 100 : percent}%` }} /><p className="muted">{progress?.stage === 'restore' ? 'Yedek açılıyor ve doğrulanıyor…' : `Mola Merkez’den indiriliyor… %${percent}`}</p></div>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button type="button" className="btn primary" disabled={busy || !picked} onClick={() => void restore()}><ArchiveRestore size={16} />{busy ? 'Geri yükleniyor…' : 'İndir ve geri yükle'}</button></div>
    <p className="muted small">Sonra bu bilgisayar işletmenin bilgisayarı olur; eski bilgisayar bağlanınca orada sipariş kapanır.</p>
  </>;
}

/** Flash drive or folder; `secret` (İşletmem var) opens the backup with the owner's password instead of a typed recovery code. */
function FolderRestore({ token, busy, setBusy, onClose, secret }: { token: string; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; secret?: { username: string; password: string } }) {
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
      await desktopCall(token, '/api/desktop/restore', { backup: picked, ...(secret ?? { code }) }, 15 * 60000);
      setDone(true); setCode('');
      setTimeout(() => location.assign(homePath()), 1500);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <>
    {done ? <Notice tone="success">Veriler geri yüklendi ve doğrulandı. Mola yeniden açılıyor…</Notice> : <>
      <p>Eski bilgisayarın yedekleri flash bellekte ya da OneDrive’da <strong>Mola-Yedek</strong> klasöründe durur. Flash belleği takın, yedeği seçin{secret ? '' : ' ve kurtarma kodunu girin'}.</p>
      <form className="restore-search" onSubmit={e => { e.preventDefault(); void search(folder.trim()); }}>
        <input aria-label="Yedek klasörü" placeholder="Başka klasör (ör. E:\Mola-Yedek)" value={folder} onChange={e => setFolder(e.target.value)} />
        <button className="btn secondary small-btn" disabled={busy}><Search size={15} />Ara</button>
      </form>
      {backups === null ? <p className="muted small">Yedekler aranıyor…</p> : !backups.length ? <Notice>{secret ? 'Yedek bulunamadı.' : 'Kurtarma koduyla açılan yedek bulunamadı.'} Flash belleği takıp “Ara”ya basın ya da klasör yolunu yazın.</Notice> :
        <div role="radiogroup" aria-label="Bulunan yedekler" className="second-places restore-list">
          {backups.map((b, i) => <label key={b.path} className={picked === b.path ? 'active' : ''}><input type="radio" name="restore-backup" checked={picked === b.path} onChange={() => setPicked(b.path)} /><ArchiveRestore size={16} /><span><strong>{when(b.createdAt)}</strong>
            <span className="restore-meta"><span className={`restore-source ${b.source ?? 'other'}`}>{b.source === 'other' || !b.source ? b.place : sourceText[b.source]}</span>{b.bytes !== undefined && <span>{size(b.bytes)}</span>}<span className={b.verified ? '' : 'restore-unchecked'}>{b.verified ? 'doğrulanmış' : 'doğrulanmamış'}</span>{i === 0 && <span>· önerilen</span>}</span>
            <small>{b.path}</small></span></label>)}
        </div>}
      <form className="restore-code" onSubmit={e => { e.preventDefault(); void restore(); }}>
        {!secret && <label>Kurtarma kodu<input value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} /></label>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy || !picked || (!secret && code.replace(/[\s-]/g, '').length < 24)}><ArchiveRestore size={16} />{busy ? 'Geri yükleniyor…' : 'Geri yükle'}</button></div>
      </form>
      <p className="muted small">Geri yükleme yalnız boş kurulumda yapılır. Yedek önce ayrı bir klasöre açılıp doğrulanır; sorun çıkarsa bu bilgisayardaki boş kurulum olduğu gibi kalır.</p>
    </>}
  </>;
}

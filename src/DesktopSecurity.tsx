import { useEffect, useState } from 'react';
import { ArchiveRestore, Check, CloudDownload, KeyRound, Sparkles, Store, UserRound } from 'lucide-react';
import { Notice } from './components';
import { Modal } from './components';
import { HelpTip } from './HelpTip';
import { desktopCall, type SecurityCaller } from './desktop-call';
import { RecoveryCard, protectionText, type RecoveryView } from './RecoveryCode';
import { SecondBackupCard } from './SecondBackup';
import { OwnerRestoreDialog, RestoreDialog } from './RestoreBackup';
import './security.css';

/** Loaded only when the desktop window opens one of these, so tablets and phones never download them. */
export type DesktopSecurity = { protection: RecoveryView['protection']; recoveryConfirmed: boolean; recoveryAvailable: boolean; warning: string | null; secondFolder: string | null; secondError: string | null; clean: boolean; owner?: boolean; /** Hizmet paketi: "İki ekran" in the package (src/DesktopRail.tsx). */ split?: boolean };
export type SecurityDialogKind = 'security' | 'recovery' | 'welcome' | 'restore' | 'restore-merkez' | 'owner';
const callerFor = (token: string): SecurityCaller => (path, body) => desktopCall(token, `/api/desktop${path}`, body);

export default function DesktopSecurityDialog({ kind, token, security, onOpen, onClose }: { kind: SecurityDialogKind; token: string; security?: DesktopSecurity; onOpen: (kind: SecurityDialogKind) => void; onClose: () => void }) {
  const caller = callerFor(token);
  if (kind === 'restore' || kind === 'restore-merkez') return <RestoreDialog token={token} onClose={onClose} initial={kind === 'restore-merkez' ? 'merkez' : 'folder'} />;
  if (kind === 'owner') return <OwnerRestoreDialog token={token} onClose={onClose} />;
  if (kind === 'recovery') return <RecoveryDialog caller={caller} onClose={onClose} />;
  if (kind === 'welcome') return <Modal title="Mola’ya hoş geldiniz" onClose={onClose}><div className="modal-body desktop-dialog welcome-dialog">
    <p>Bu bilgisayarda henüz işletme yok. Nasıl başlamak istersiniz?</p>
    <button type="button" className="welcome-choice" onClick={onClose}><Sparkles size={22} /><span><strong>Yeni kurulum</strong><small>İlk kez Mola kullanıyorum.</small></span></button>
    <button type="button" className="welcome-choice" onClick={() => onOpen('owner')}><Store size={22} /><span><strong>İşletmem var</strong><small>Mola’yı başka bilgisayarda kullanıyorum: kullanıcı adım, şifrem ve e-postama gelen kodla bu bilgisayara taşı.</small></span></button>
    <button type="button" className="welcome-choice" onClick={() => onOpen('restore')}><ArchiveRestore size={22} /><span><strong>Yedekten geri yükle</strong><small>Eski bilgisayardaki verileri flash bellekten ya da OneDrive’dan getir.</small></span></button>
    <button type="button" className="welcome-choice" onClick={() => onOpen('restore-merkez')}><CloudDownload size={22} /><span><strong>Mola Merkez’den geri yükle</strong><small>Eski bilgisayar bozulduysa ya da kayıpsa: Mola ekibinin verdiği taşıma kodu ve kurtarma kodunuzla.</small></span></button>
  </div></Modal>;
  return <Modal title="Güvenlik" wide onClose={onClose}><div className="modal-body desktop-dialog security-dialog">
    <SecurityChecklist security={security} />
    <h3><KeyRound size={16} />Kurtarma kodu</h3>
    <RecoveryCard caller={caller} bare />
    <h3>İkinci yedek yeri</h3>
    <SecondBackupCard caller={caller} bare />
    <h3><UserRound size={16} />İşletme sahibi şifresini unuttum</h3>
    <OwnerPasswordReset token={token} recovery={!!security && security.protection !== 'off'} />
  </div></Modal>;
}
/**
 * Right after the owner account: the new code, once. While it is on screen the window does not close by Esc, a click outside
 * or ×: only "Kaydettim" (two groups typed back) or an explicit "Sonra kaydedeceğim".
 */
function RecoveryDialog({ caller, onClose }: { caller: SecurityCaller; onClose: () => void }) {
  const [showing, setShowing] = useState(false);
  return <Modal title="Kurtarma kodunuz" onClose={onClose} dismissible={!showing}><div className="modal-body desktop-dialog">
    <p>Bu bilgisayar bozulursa, çalınırsa ya da Windows şifresi sıfırlanırsa verileriniz <strong>yalnız bu kodla</strong> açılır.</p>
    <RecoveryCard caller={caller} autoShow bare onShowing={setShowing} onLater={onClose} onChange={v => { if (v.confirmed) onClose(); }} />
  </div></Modal>;
}
/** Inside the rail's "Yedekle" dialog: the second place, and on a clean install the way back from a backup. */
export function SecondPlace({ token, clean, onRestore, onChange }: { token: string; clean: boolean; onRestore: () => void; onChange: () => void }) {
  return <div className="backup-second">
    <h3>İkinci yedek yeri <HelpTip title="İkinci yedek yeri">Her yedekten sonra şifreli bir kopyası buraya da yazılır ve kontrol edilir: flash bellek ya da OneDrive klasörü. En yeni 3 kopya saklanır (daha eskileri bu bilgisayarda). Kopya yalnız kurtarma koduyla açılır.</HelpTip></h3>
    <SecondBackupCard caller={callerFor(token)} bare onChange={onChange} />
    {clean && <button type="button" className="btn secondary small-btn" onClick={onRestore}><ArchiveRestore size={15} />Yedekten geri yükle</button>}
  </div>;
}

/** First-run checklist of the café computer. Disk encryption is advice only: Mola does not check it (no admin rights). */
export function SecurityChecklist({ security }: { security?: DesktopSecurity }) {
  const items: [boolean | null, string, string?][] = [
    [!!security?.recoveryConfirmed, 'Kurtarma kodu yazdırıldı ve saklandı'],
    [!!security?.secondFolder, 'İkinci yedek yeri seçildi (flash bellek ya da OneDrive)'],
    [null, 'Bilgisayarın diski şifreli olsun (çalınırsa dosyalar okunamaz)', 'Windows Ayarlar → Gizlilik ve güvenlik → Cihaz şifreleme bölümünden açılır (Windows Pro’da adı BitLocker); Mac’te FileVault. Açıkken bilgisayar çalınsa bile diskteki dosyalar okunamaz. Windows hesabının mutlaka bir şifresi olsun: şifresiz hesapta Mola’nın anahtar kilidi zayıf kalır. Şifrelemenin kurtarma anahtarını da kâğıda yazıp saklayın.'],
  ];
  return <>
    {security && <p className="muted small">{protectionText[security.protection]}</p>}
    <ul className="security-checklist" aria-label="Kurulum adımları">
      {items.map(([done, text, tip]) => <li key={text} className={done ? 'done' : ''}><span className="check-mark" aria-hidden="true">{done ? <Check size={14} /> : null}</span><span>{text}{done ? <span className="sr-only"> (tamam)</span> : null}</span>{tip && <HelpTip title="Disk şifreleme">{tip}</HelpTip>}</li>)}
    </ul>
  </>;
}

type Owner = { username: string; name: string; business: string };
/**
 * The owner forgot the password (and maybe the username): a new one, here on the café computer, in two steps. Step 1 the
 * code alone: the recovery code on paper, or a one-time code the Mola team reads out on the phone ("Mola ekibinden kod",
 * also when there is no recovery code). The screen then lists this computer's owner accounts. Step 2: pick one, type the new
 * password twice; the code is checked again. Every open session of that owner ends; staff accounts are not touched.
 */
function OwnerPasswordReset({ token, recovery }: { token: string; recovery: boolean }) {
  const [way, setWay] = useState<'recovery' | 'vendor'>(recovery ? 'recovery' : 'vendor');
  const [code, setCode] = useState(''), [owners, setOwners] = useState<Owner[] | null>(null), [business, setBusiness] = useState('');
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  // The protection state may arrive after the dialog opened: start on the recovery code then, unless something was typed.
  useEffect(() => { if (recovery && !code && !owners) setWay('recovery'); }, [recovery]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = way === 'recovery' ? '/api/desktop/owner-password' : '/api/desktop/owner-password/vendor';
  const codeReady = way === 'recovery' ? code.replace(/[\s-]/g, '').length >= 24 : code.replace(/[\s-]/g, '').length >= 12;
  const restart = (next = way) => { setWay(next); setCode(''); setOwners(null); setBusiness(''); setUsername(''); setPassword(''); setRepeat(''); setError(''); };
  async function check() {
    setBusy(true); setError(''); setDone(false);
    try {
      const r = await desktopCall<{ owners: Owner[]; business?: string }>(token, `${base}/owners`, { code });
      setOwners(r.owners); setBusiness(r.business ?? ''); setUsername(r.owners.length === 1 ? r.owners[0].username : '');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try { await desktopCall(token, base, { code, username, newPassword: password }); restart(); setDone(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="owner-reset-box">
    <div className="owner-reset-ways" role="group" aria-label="Şifre sıfırlama yolu">
      {([['recovery', 'Kurtarma kodu'], ['vendor', 'Mola ekibinden kod']] as const).map(([id, title]) => <button type="button" key={id} className={way === id ? 'active' : ''} aria-pressed={way === id} disabled={busy || (id === 'recovery' && !recovery)} onClick={() => { if (way !== id) { restart(id); setDone(false); } }}>{title}</button>)}
    </div>
    {done && <Notice tone="success">Yeni şifre kaydedildi. İşletme sahibi yeni şifreyle giriş yapabilir.</Notice>}
    {!owners ? <form className="owner-reset" onSubmit={e => { e.preventDefault(); if (codeReady) void check(); }}>
      <p className="muted small">{way === 'recovery' ? 'Kâğıttaki kurtarma kodunu yazın. Doğruysa bu bilgisayardaki işletme sahibi hesapları listelenir.' : !recovery ? 'Bu kurulumda kurtarma kodu yok. Mola ekibini arayın; işletmenizi doğruladıktan sonra telefonda tek kullanımlık bir kod okurlar (30 dakika geçerli). Kod yalnız bu bilgisayarda ve internete bağlıyken çalışır.' : 'Kurtarma kodunuz yoksa Mola ekibini arayın; işletmenizi doğruladıktan sonra telefonda tek kullanımlık bir kod okurlar (30 dakika geçerli). Kod yalnız bu bilgisayarda ve internete bağlıyken çalışır.'}</p>
      <label>{way === 'recovery' ? 'Kurtarma kodu' : 'Mola ekibinin kodu'}<input required maxLength={64} autoComplete="off" spellCheck={false} placeholder={way === 'recovery' ? 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' : 'XXXX-XXXX-XXXX'} disabled={busy} value={code} onChange={e => setCode(e.target.value)} /></label>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn secondary" disabled={busy || !codeReady}><KeyRound size={15} />{busy ? 'Kontrol ediliyor…' : 'Kodu kontrol et'}</button>
    </form>
    : <form className="owner-reset" onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="muted small">Kod doğru.{business && <> İşletme: <strong>{business}</strong>.</>} Yeni şifre verilecek işletme sahibi hesabını seçin. Sahibin açık oturumları kapanır; çalışan hesapları etkilenmez.</p>
      {owners.length ? <div className="owner-reset-accounts" role="radiogroup" aria-label="İşletme sahibi hesabı">{owners.map(o => <label key={o.username} className="checkbox-line"><input type="radio" name="owner-reset-account" checked={username === o.username} disabled={busy} onChange={() => setUsername(o.username)} /><span><strong>{o.username}</strong> · {o.name}{owners.some(x => x.business !== o.business) ? ` · ${o.business}` : ''}</span></label>)}</div>
        : <Notice tone="error">Bu bilgisayarda etkin işletme sahibi hesabı bulunamadı. Mola ekibiyle görüşün.</Notice>}
      <label>Yeni şifre<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label>Yeni şifre tekrar<input type="password" required maxLength={128} autoComplete="new-password" disabled={busy} value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
      {repeat && repeat !== password && <Notice>Şifreler eşleşmiyor.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="application-actions"><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => restart()}>Geri</button>
        <button className="btn primary small-btn" disabled={busy || !username || password.length < 12 || password !== repeat}><KeyRound size={15} />{busy ? 'Kaydediliyor…' : 'Yeni şifreyi kaydet'}</button></div>
    </form>}
  </div>;
}

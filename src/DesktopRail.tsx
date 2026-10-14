import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Columns2, DatabaseBackup, FolderOpen, KeyRound, LayoutDashboard, Power, Square, TabletSmartphone } from 'lucide-react';
import { Modal, Notice } from './components';
import { MolaCup } from './MolaLogo';
import { desktopCall as call, desktopToken, forgetDesktopToken } from './desktop-call';
import { CashCloseReminder } from './CashDay';
import { NetworkProfileNotice, useNetworkProfile, type NetworkProfileView } from './NetworkProfileNotice';
import { PermanentLink, type LanLink } from './PermanentLink';
import { cloudLine, type CloudView } from './cloudBackupText';
import type { DesktopSecurity, SecurityDialogKind } from './DesktopSecurity';
import { readSplit, SplitView, writeSplit, type SplitState } from './SplitView';
// Hizmet paketi: "İki ekran" not in the package: "İkiye böl" stays faded and opens the package card (src/FeatureLock.tsx).
import { FeatureLockModal, PackageProvider } from './FeatureLock';
// What a closed year's package keeps (the owner's sentence, shared with the "yılı kapandı ve paketlendi" notice).
import { PACKAGE_PRIVACY_TEXT } from '../packages/domain/package-privacy';

/** `cloud`: Sunucu yedeği (encrypted copy on Mola Merkez), only once this install is linked to a Merkez that keeps them. */
/**
 * `note`: the last automatic run was not needed ("Gece yedeği gerekmedi: 23:41 gün sonu yedeği güncel."). `set`: the kept
 * automatic backups and why each stays (server/backup-retention.ts); `packages`: the sealed year packages, kept for good
 * (server/year-packages.ts: "Yıl paketi 2025"); `safetyCopy`: the readable copy taken before the first package, until it goes
 * by itself 90 days later (server/year-packer.ts removeSafetyCopy).
 */
type Backup = { enabled: boolean; running?: boolean; lastSuccessAt?: string | null; lastError?: string | null; nextRunAt?: string | null; note?: string | null; set?: { at: string; tier: 'daily' | 'weekly' | 'monthly' }[]; packages?: { year: string; bytes: number; ok: boolean }[]; safetyCopy?: { removeAt: string }; cloud?: CloudView };
const longDay = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const TIER = { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık' } as const;
/** `link`: Kalıcı bağlantı (the business's permanent Merkez link to this computer), from a server that knows it. */
type DesktopStatus = { lan: boolean; addresses: { name: string; origin: string }[]; backup: Backup; security?: DesktopSecurity; locked?: boolean; link?: LanLink };
// Key protection screens: loaded only when the desktop window needs them, never on tablets and phones.
const SecurityDialog = lazy(() => import('./DesktopSecurity'));
const SecondPlace = lazy(() => import('./DesktopSecurity').then(m => ({ default: m.SecondPlace })));
const later = (name: string) => { try { return sessionStorage.getItem(name) === '1'; } catch { return false; } };
const remember = (name: string) => { try { sessionStorage.setItem(name, '1'); } catch { /* private mode */ } };
const megabytes = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(n / 1024 ** 2)).toLocaleString('tr-TR')} MB`;
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
/** Something on the security side wants a look: unsaved recovery code, unprotected key, failed second copy. */
export const needsAttention = (s?: DesktopSecurity) => !!s && s.protection !== 'off' && (!s.recoveryConfirmed || s.protection === 'file' || !!s.secondError || !!s.warning);

/**
 * Side rail shown only in the café computer's own Mola window: panel, backup, tablets, security, shut down. There is no
 * "Yönetim" here any more: the vendor's panel (Mola Yönetim) runs on Mola Merkez, never on a café computer.
 * "İkiye böl" / "Tek ekran": the window shows two Mola screens side by side, each with its own sign-in (src/SplitView.tsx);
 * otherwise `children`, the one ordinary screen. The rail and its dialogs stay here, outside both panes.
 */
export function DesktopRail({ children }: { children?: ReactNode }) {
  // '' = development on this computer (npm run dev --masaustu): the server allows the rail without a key.
  const [token, setToken] = useState<string | null>(desktopToken);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [open, setOpen] = useState<'backup' | 'tablets' | 'off' | null>(null);
  const [dialog, setDialog] = useState<SecurityDialogKind | null>(null);
  const [stopped, setStopped] = useState(false), [failed, setFailed] = useState(false);
  const [split, setSplitState] = useState<SplitState>(readSplit), [splitLock, setSplitLock] = useState(false);
  const setSplit = (s: SplitState) => { setSplitState(s); writeSplit(s); };
  useEffect(() => {
    if (token !== null) return;
    let live = true;
    void fetch('/api/health').then(r => r.json()).then((h: { desktop?: boolean }) => { if (live && h.desktop) setToken(''); }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  // Listeners and timers read the dialogs on screen through this, not through a stale render.
  const shown = useRef({ open, dialog, status }); shown.current = { open, dialog, status };
  async function refresh(first = false) {
    if (token === null) return;
    try {
      const s = await call<DesktopStatus>(token, '/api/desktop/status');
      if (s.locked) { window.dispatchEvent(new Event('mola:locked')); return; }
      setStatus(s);
      // The recovery code comes only once the owner account exists (never on the activation screens), and again on any
      // refresh until saved or put off with "Sonra kaydedeceğim". A new install has no welcome window: the activation screen
      // itself offers every way in (new business, İşletmem var, a backup folder, Mola Merkez; src/Activation.tsx).
      const idle = !shown.current.open && !shown.current.dialog;
      if (idle && s.security?.recoveryAvailable && s.security.owner !== false && !later('mola-recovery-later')) setDialog('recovery');
    } catch (e) {
      // A key from an earlier start is no longer valid; the next launch brings a new one.
      if ((e as { status?: number }).status === 404) forgetDesktopToken();
      if (first) setFailed(true);
    }
  }
  useEffect(() => {
    void refresh(true);
    // Security cards announce changes: the reminder dots follow without polling.
    const on = () => void refresh();
    // "İlk adımlar" (src/FirstSteps.tsx) opens the recovery code or the backup dialog from the owner's Masalar.
    // 13 Ekim: "Yedekleriniz nerede?" (Ayarlar → Güvenlik ve yedek) opens the backup folders on this computer.
    const reply = (error: string) => window.dispatchEvent(new CustomEvent('mola:open-result', { detail: error }));
    const ask = (e: Event) => { const what = (e as CustomEvent<string>).detail; if (what === 'backup') { setDialog(null); setOpen('backup'); } else if (what === 'recovery') { setOpen(null); setDialog(shown.current.status?.security?.recoveryAvailable ? 'recovery' : 'security'); }
      // The activation screen's ways back (İşletmem var, Yedekten geri yükle, Mola Merkez'den geri yükle): only a clean
      // install with key protection can take a business's backup.
      else if (what === 'owner' || what === 'restore' || what === 'restore-merkez') { const s = shown.current.status?.security; if (s?.clean && s.protection !== 'off') { setOpen(null); setDialog(what); reply(''); } else reply('Bu bilgisayarda zaten işletme verisi var ya da anahtar koruması kapalı; işletmeyi taşıma ve yedekten geri yükleme yalnız yeni kurulumda yapılır.'); }
      else if (what === 'open-backups' || what === 'open-second') void call(token ?? '', what === 'open-backups' ? '/api/desktop/open-backups' : '/api/desktop/open-second', {}).then(() => reply(''), err => reply((err as Error).message)); };
    window.addEventListener('mola:security', on); window.addEventListener('mola:open', ask);
    return () => { window.removeEventListener('mola:security', on); window.removeEventListener('mola:open', ask); };
  }, [token]);
  // Before the owner account the status is looked at every few seconds, so the code appears as soon as the account is made
  // (the account screen signs the owner in without reloading this window).
  const waitingOwner = !!status?.security?.recoveryAvailable && status.security.owner === false;
  useEffect(() => { if (!waitingOwner) return; const t = setInterval(() => void refresh(), 3000); return () => clearInterval(t); }, [waitingOwner, token]);
  // The open "Yedekle" dialog stays current: last and next backup move on by themselves (faster while one runs).
  const running = !!status?.backup.running || !!status?.backup.cloud?.running;
  useEffect(() => { if (open !== 'backup') return; const t = setInterval(() => { if (!document.hidden) void refresh(); }, running ? 2000 : 10000); return () => clearInterval(t); }, [open, running, token]);
  const active = token !== null && !!status && !stopped;
  // The server answers whether this computer's package has İki ekran; a remembered split waits for it, then falls back.
  const splitOff = status?.security?.split === false, splitOn = split.on && !splitOff;
  useEffect(() => { document.body.classList.toggle('desktop-shell', active); return () => document.body.classList.remove('desktop-shell'); }, [active]);
  if (stopped) return <div className="desktop-stopped" role="status"><Power size={34} strokeWidth={1.5} /><h1>Mola kapatıldı.</h1><p>Bu pencereyi kapatabilirsiniz. Yeniden açmak için masaüstündeki Mola simgesine tıklayın.</p></div>;
  // A remembered split waits for the rail instead of showing (and polling) the single screen for a moment. The same slots
  // as below (rail, split lock, screen), so the single screen is not mounted again when the rail appears (8 Ekim: it was one
  // slot off, so the screen started over once, the owner's agreement window included).
  if (!active) return <>{null}{null}{split.on && token !== null && !failed ? null : children}</>;
  const closeDialog = () => {
    if (dialog === 'recovery') remember('mola-recovery-later');
    setDialog(null); void refresh();
  };
  return <>
    <nav className="desktop-rail" aria-label="Mola bilgisayar araçları">
      <span className="desktop-rail-logo" aria-hidden="true"><MolaCup /></span>
      <a href="/" className="active" aria-current="page"><LayoutDashboard size={20} strokeWidth={1.7} /><span>Panel</span></a>
      {splitOff ? <button type="button" className="rail-locked" onClick={() => setSplitLock(true)} title="İki ekran paketinizde yok"><Columns2 size={20} strokeWidth={1.7} /><span>İkiye böl</span><small className="rail-locked-hint">Pakette yok</small></button>
        : split.on ? <button type="button" onClick={() => setSplit({ ...split, on: false })} title="Tek Mola ekranına dön (sol ekranın girişiyle)"><Square size={20} strokeWidth={1.7} /><span>Tek ekran</span></button>
        : <button type="button" onClick={() => setSplit({ ...split, on: true })} title="İki Mola ekranını yan yana açın (ör. kasa ve mutfak); her biri ayrı giriş yapar"><Columns2 size={20} strokeWidth={1.7} /><span>İkiye böl</span></button>}
      <button type="button" onClick={() => setOpen('backup')}><DatabaseBackup size={20} strokeWidth={1.7} /><span>Yedekle</span>{status.security?.secondError && <span className="rail-dot" aria-label="İkinci yedek alınamadı" />}</button>
      <button type="button" onClick={() => setOpen('tablets')}><TabletSmartphone size={20} strokeWidth={1.7} /><span>Cihaz bağla</span></button>
      {status.security && status.security.protection !== 'off' && <button type="button" onClick={() => setDialog('security')}><KeyRound size={20} strokeWidth={1.7} /><span>Güvenlik</span>{needsAttention(status.security) && <span className="rail-dot" aria-label="Bakılması gereken güvenlik adımı var" />}</button>}
      <button type="button" className="desktop-rail-off" onClick={() => setOpen('off')}><Power size={20} strokeWidth={1.7} /><span>Kapat</span></button>
    </nav>
    {splitLock && <PackageProvider value={{ role: 'owner' }}><FeatureLockModal feature="split-screen" onClose={() => setSplitLock(false)} /></PackageProvider>}
    {splitOn ? <SplitView token={token} state={split} onChange={setSplit} onSingle={() => setSplit({ ...split, on: false })} /> : children}
    {open === 'backup' && <BackupDialog token={token} backup={status.backup} security={status.security} onChange={backup => setStatus(s => s && { ...s, backup })} onRefresh={() => void refresh()} onRestore={() => { setOpen(null); setDialog('restore'); }} onClose={() => { setOpen(null); void refresh(); }} />}
    {open === 'tablets' && <TabletsDialog token={token} status={status} onClose={() => setOpen(null)} />}
    {open === 'off' && <ShutdownDialog token={token} onDone={() => { setOpen(null); setStopped(true); }} onClose={() => setOpen(null)} />}
    {dialog && <Suspense fallback={null}><SecurityDialog kind={dialog} token={token} security={status.security} onOpen={setDialog} onClose={closeDialog} /></Suspense>}
  </>;
}

/** backup: the rail's live status (refreshed while this is open), so last and next backup never go stale. */
function BackupDialog({ token, backup, security, onChange, onRefresh, onRestore, onClose }: { token: string; backup: Backup; security?: DesktopSecurity; onChange: (b: Backup) => void; onRefresh: () => void; onRestore: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  async function run() {
    setBusy(true); setError(''); setDone(false);
    try { const b = await call<Backup>(token, '/api/desktop/backup', {}, 15 * 60000); onChange(b); setDone(!b.lastError); onRefresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function folder() { setError(''); try { await call(token, '/api/desktop/open-backups', {}); } catch (e) { setError((e as Error).message); } }
  // Development (no key protection) keeps the old hint; the second place and restore need the recovery code.
  const second = !!security && security.protection !== 'off';
  return <Modal title="Yedekle" onClose={() => { if (!busy) onClose(); }} dismissible={!busy}><div className="modal-body desktop-dialog">
    {!backup.enabled ? <Notice>Otomatik yedekleme bu kurulumda kapalı.</Notice> : <>
      <p className="desktop-big">{backup.lastSuccessAt ? <>Son yedek: <strong>{when(backup.lastSuccessAt)}</strong></> : 'Henüz yedek alınmadı.'}</p>
      {backup.running && !busy ? <p className="muted" role="status">Otomatik yedek alınıyor…</p> : backup.nextRunAt && <p className="muted">Sonraki otomatik yedek: {when(backup.nextRunAt)}</p>}
      {backup.note && !backup.running && !busy && <p className="muted" role="status" data-testid="backup-note">{backup.note}</p>}
      {backup.lastError && !done && <Notice tone="error">Son deneme başarısız oldu: {backup.lastError}</Notice>}
      {(!!backup.set?.length || !!backup.packages?.length) && <details className="backup-kept"><summary>Saklanan yedekler ({(backup.set?.length ?? 0) + (backup.packages?.length ?? 0)})</summary>
        <ul aria-label="Saklanan yedekler">{backup.set?.map(b => <li key={b.at}><span>{when(b.at)}</span><span className="tier">{TIER[b.tier]}</span></li>)}
          {/* Closed years: sealed once, stored once beside the backups, kept for good (server/year-packages.ts). */}
          {backup.packages?.map(p => <li key={`yil-${p.year}`} className="year-package"><span>Yıl paketi {p.year} <small>{megabytes(p.bytes)}</small></span><span className={p.ok ? 'tier' : 'tier bad'}>{p.ok ? 'Kalıcı' : 'Sorunlu'}</span></li>)}</ul>
        {!!backup.packages?.length && <p className="muted small" data-testid="package-privacy">{PACKAGE_PRIVACY_TEXT}</p>}</details>}
      {/* Until it goes: the readable copy from before the first year package still holds customers' personal data. */}
      {backup.safetyCopy && <p className="muted small" data-testid="safety-copy">İlk yıl paketinden önce alınan okunabilir kopya {Date.parse(backup.safetyCopy.removeAt) > Date.now() ? `${longDay(backup.safetyCopy.removeAt)} tarihinde` : 'bir sonraki doğrulanmış yedekten sonra'} kendiliğinden silinecek.</p>}
      {backup.cloud && (backup.cloud.lastError && !backup.cloud.running ? <Notice tone="error">{cloudLine(backup.cloud)}</Notice> : <p className="muted cloud-status" role="status">{cloudLine(backup.cloud)}</p>)}
      {done && <Notice tone="success">Yedek alındı ve doğrulandı.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => void folder()}><FolderOpen size={16} />Yedek klasörünü aç</button><button type="button" className="btn primary" disabled={busy || backup.running} onClick={() => void run()}><DatabaseBackup size={16} />{busy ? 'Yedekleniyor…' : 'Şimdi yedekle'}</button></div>
      {!second && <p className="muted small">Haftada bir yedek klasörünü flash belleğe kopyalayın. Bilgisayar bozulursa veriler oradan geri gelir.</p>}
    </>}
    {second && <Suspense fallback={null}><SecondPlace key={backup.lastSuccessAt ?? ''} token={token} clean={!!security?.clean} onRestore={onRestore} onChange={onRefresh} /></Suspense>}
  </div></Modal>;
}

type Firewall = { supported: boolean; state?: 'ok' | 'missing' | 'fix' | 'unknown' };
/**
 * Cihaz bağla › "İzni düzelt": Windows' firewall rule for the tablets (packaged Windows app only, server/desktop.ts). Windows asks
 * once for administrator approval; that prompt may only blink in the taskbar, so the wait is long and the hint says where to look.
 */
function FirewallFix({ token }: { token: string }) {
  const [fw, setFw] = useState<Firewall | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [declined, setDeclined] = useState(false);
  useEffect(() => { let live = true; void call<Firewall>(token, '/api/desktop/firewall').then(v => { if (live) setFw(v); }).catch(() => {}); return () => { live = false; }; }, [token]);
  async function fix() {
    setBusy(true); setError(''); setDeclined(false);
    try { const r = await call<{ ok: boolean; declined: boolean; state: Firewall['state'] }>(token, '/api/desktop/firewall', {}, 150000); setFw({ supported: true, state: r.state }); setDeclined(r.declined); if (!r.ok && !r.declined) setError('İzin verilemedi. Bir kez daha deneyin.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!fw?.supported || fw.state === 'ok') return null;
  return <div className="firewall-fix">
    <Notice>Tablet ve telefonlar bu bilgisayara bağlanamayabilir: Windows güvenlik duvarı izni eksik.</Notice>
    {declined && <Notice tone="error">Windows izni verilmedi.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    <button type="button" className="btn primary" disabled={busy} onClick={() => void fix()}>{busy ? 'Windows onayı bekleniyor…' : 'İzni düzelt'}</button>
    {(busy || declined) && <p className="muted small">Windows “Evet” diye soracak. Pencere görünmüyorsa görev çubuğunda yanıp sönen simgeye tıklayın.</p>}
  </div>;
}

function TabletsDialog({ token, status, onClose }: { token: string; status: DesktopStatus; onClose: () => void }) {
  // One QR for every phone and tablet: /uygulama installs the Android app or adds Mola to an iPhone/iPad home screen.
  const address = status.addresses[0]?.origin, page = address && `${address}/uygulama`;
  const [image, setImage] = useState('');
  useEffect(() => { let live = true; // Loaded only when this dialog opens, so the QR library stays out of the first page load.
    if (page) void import('qrcode').then(m => m.default.toDataURL(page, { width: 260, margin: 2, color: { dark: '#234c3e', light: '#ffffff' } })).then(v => { if (live) setImage(v); }); return () => { live = false; }; }, [page]);
  // Windows' "Genel" network profile while Mola's firewall rule is the old private-only one; read only ("İzni düzelt" fixes it).
  const profile = useNetworkProfile(() => call<NetworkProfileView>(token, '/api/desktop/network-profile'), status.lan);
  return <Modal title="Cihaz bağla" onClose={onClose}><div className="modal-body desktop-dialog">
    <NetworkProfileNotice view={profile} here />
    <FirewallFix token={token} />
    {!status.lan ? <Notice>Mola şu anda yalnız bu bilgisayara açık. Tabletler bağlanamaz.</Notice>
      : !address ? <Notice tone="error">Bu bilgisayar bir ağa bağlı görünmüyor. Wi-Fi veya kablo bağlantısını kontrol edin.</Notice>
      : <>
        <p className="desktop-big">Telefon ya da tabletin kamerasıyla okutun</p>
        {image && <img className="desktop-qr" src={image} alt={`${page} adresinin QR kodu`} width={260} height={260} />}
        <p className="muted small">Açılan sayfa Mola'yı Android'e uygulama olarak, iPhone ve iPad'e ana ekrana kurmayı anlatır.</p>
        <p className="desktop-address">{status.addresses.map(a => <code key={a.origin}>{a.origin}/uygulama</code>)}</p>
        <p className="muted small">Cihaz bu bilgisayarla aynı Wi-Fi ağında olmalı. Bağlanmıyorsa bilgisayarın güvenlik duvarında Mola'ya izin verin.</p>
      </>}
    <PermanentLink link={status.link} />
  </div></Modal>;
}

function ShutdownDialog({ token, onDone, onClose }: { token: string; onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function stop() {
    setBusy(true); setError('');
    try { await call(token, '/api/desktop/shutdown', {}); onDone(); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Modal title="Mola kapatılsın mı?" onClose={() => { if (!busy) onClose(); }} dismissible={!busy}><div className="modal-body desktop-dialog">
    <p>Kapatınca tabletler ve QR menü sipariş alamaz. Pencereyi kapatmak yeterliyse bunu kullanmayın; Mola arka planda çalışmaya devam eder.</p>
    {/* Gün sonu kasası still open: a reminder with a way to the closing (src/CashDay.tsx). */}
    <CashCloseReminder onGo={onClose} />
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void stop()}><Power size={16} />{busy ? 'Kapatılıyor…' : 'Mola’yı kapat'}</button></div>
  </div></Modal>;
}

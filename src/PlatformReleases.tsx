import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudDownload, FileUp, History, Lock, LockOpen, Pause, Pencil, Rocket, ShieldCheck, Store, Trash2, Upload, Users, X } from 'lucide-react';
import { api, ApiError } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { IconBtn, SCard, Stat } from './platformSettingsKit';
import { ADMIN, dateTime, olderThanCafes } from './platformStatus';
import './platform-releases.css';

type Rollout = { mode: 'off' | 'pilot' | 'all'; pilot: string[]; changedAt?: string };
export type ReleaseView = { id: string; version: string; platform: string; notes: string; size: number; node: string; runtime: boolean; minFrom: string; files: number; importedAt: string; rollout: Rollout };
type CafeUpdate = { platform: string; state: 'idle' | 'downloading' | 'ready' | 'installing' | 'installed' | 'failed' | 'rolled_back'; version?: string; progress?: number; error?: string; at: string; receivedAt: string; idleInstall?: boolean };
export type Cafe = { tenantId: string; name: string; installId: string; appVersion: string; lastSeenAt: string | null; update: CafeUpdate | null };
/** Güncelleme yetkisi (server/merkez/step-up.ts): two-step login on? until when a right code holds (null: closed). */
type Right = { mfa: boolean; until: string | null; minutes: number };
const platformNames: Record<string, string> = { windows: 'Windows', 'macos-arm64': 'macOS (Apple Silicon)', 'macos-x64': 'macOS (Intel)', 'linux-x64': 'Linux' };
/** Bundles waiting in <çalışma klasörü>\guncellemeler (server/merkez/workfolder.ts readyBundles). */
type FolderList = { folder: string | null; files: { name: string; size: number; modifiedAt: string; version?: string; platform?: string; platformName?: string | null; imported: boolean }[] };
const size = (n: number) => `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
const rolloutText = (r: Rollout) => r.mode === 'all' ? 'Herkese yayında' : r.mode === 'pilot' ? `Pilot: ${r.pilot.length} işletme` : 'Yayında değil';
const clockText = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const SAFETY = 'Güvenli: işletmeler yeni sürümü çalışırken indirir, kapanışta, ertesi açılışta ya da boşken (açık masa yokken) kurar. Kurmadan önce verilerini yedekler; yeni sürüm açılmazsa kendiliğinden eski sürüme döner, veriler korunur. Mola Yönetim’in kendisi bu yolla güncellenmez: yeni “Mola Yönetim Kurulum.exe”yi çalıştırın.';
const STEPS_TIP = 'Güncelleme dosyası (.mola-guncelleme) npm run installer ile .local\\installer\\Mola-<sürüm>\\Guncelleme\\ içinde oluşur. Buraya sürükleyin ya da çalışma klasörünün guncellemeler\\ bölümüne koyun (“Klasörde hazır”da görünür). Mola Merkez paketteki her dosyayı denetler ve imzalar; bu hâliyle hiçbir işletmeye gitmez. Sonra önce pilot işletmelere, sorun yoksa herkese yayınlayın. Not isteğe bağlıdır, sonra da yazılabilir.';
const releaseName = (r: ReleaseView) => `${r.version} (${platformNames[r.platform] ?? r.platform})`;
/** What one café's computer says about its update, in a few words. */
export function cafeState(c: Cafe) {
  const u = c.update;
  if (!u) return { text: 'Bilgi yok (eski sürüm ya da hiç bağlanmadı)', tone: 'muted' };
  switch (u.state) {
    case 'downloading': return { text: `${u.version} indiriliyor${u.progress !== undefined ? ` · %${u.progress}` : ''}`, tone: '' };
    case 'ready': return { text: `${u.version} indirildi · yeniden başlatma bekliyor`, tone: 'warn' };
    case 'installing': return { text: `${u.version} kuruluyor`, tone: 'warn' };
    case 'installed': return { text: `${u.version} kuruldu`, tone: 'ok' };
    case 'failed': return { text: `Kurulamadı${u.version ? ` (${u.version})` : ''}: ${u.error ?? 'neden bilinmiyor'}`, tone: 'bad' };
    case 'rolled_back': return { text: `Geri alındı (${u.version}): ${u.error ?? ''}`, tone: 'bad' };
    default: return { text: 'Bekleyen güncelleme yok', tone: 'muted' };
  }
}
/**
 * Ayarlar → "Güncellemeler" (otomatik güncelleme). The flow, as the owner says it: drag the new bundle here (or drop it into
 * the work folder's guncellemeler\ → "Klasörde hazır") → Mola Merkez checks and signs it → right there "Önce pilot
 * işletmelere" or "Herkese yayınla". Upload, publish, Durdur, Sil and a note edit (the release is signed again) need the Güncelleme yetkisi: the current code of the
 * Authenticator app, good for 10 minutes; without two-step login they are blocked with a link to Hesap güvenliği.
 * Below, every café's version and update state (from its heartbeat). Mola Yönetim itself is updated with its own installer.
 */
export function PlatformReleases({ onSecurity }: { onSecurity?: () => void }) {
  const [releases, setReleases] = useState<ReleaseView[] | null>(null), [cafes, setCafes] = useState<Cafe[]>([]), [right, setRight] = useState<Right | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [, setWarning] = useState('');
  const [file, setFile] = useState<File | null>(null), [notes, setNotes] = useState(''), [pilotFor, setPilotFor] = useState(''), [pilot, setPilot] = useState<string[]>([]), [editing, setEditing] = useState(''), [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null), codeInput = useRef<HTMLInputElement>(null), notesRef = useRef(notes);
  notesRef.current = notes;
  const [progress, setProgress] = useState<number | null>(null), [dragging, setDragging] = useState(false), [folder, setFolder] = useState<FolderList | null>(null);
  /** The code box; `pending`: the action that waits for it (it runs right after a right code). */
  const [code, setCode] = useState(''), [pending, setPending] = useState<{ label: string; go: () => Promise<void> } | null>(null);
  /** The release just uploaded: its "Önce pilot işletmelere / Herkese yayınla" choices stand right under the drop area. */
  const [fresh, setFresh] = useState(''), [clock, setClock] = useState(() => Date.now());
  const load = () => api<{ releases: ReleaseView[]; cafes: Cafe[]; right?: Right }>(`${ADMIN}/releases`).then(r => { setReleases(r.releases); setCafes(r.cafes); if (r.right) setRight(r.right); setClock(Date.now()); }, e => setError((e as Error).message));
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(t); }, []);
  const open = !!right?.until && Date.parse(right.until) > clock, blocked = right?.mfa === false;
  /** A critical action: now while the Güncelleme yetkisi is open, otherwise after the Authenticator code. */
  function guarded(label: string, go: () => Promise<void>) {
    if (blocked) return;
    if (open) { void go(); return; }
    setPending({ label, go }); setError(''); setNotice('');
    setTimeout(() => codeInput.current?.focus(), 0);
  }
  /** The server says the window closed (10 minutes passed, Merkez restarted): ask for the code again, then do it. */
  function stepUpAgain(e: unknown, label: string, go: () => Promise<void>) {
    if (!(e instanceof ApiError) || !['STEP_UP_REQUIRED', 'MFA_REQUIRED'].includes(e.code)) return false;
    if (e.code === 'MFA_REQUIRED') { setRight(r => ({ minutes: 10, ...r, mfa: false, until: null })); setPending(null); setError(e.message); return true; }
    setRight(r => r && { ...r, until: null }); setPending({ label, go }); setNotice('');
    setError('Güncelleme yetkisinin süresi doldu. Doğrulayıcı uygulamadaki güncel kodu yeniden girin; işlem sonra kendiliğinden sürer.');
    setTimeout(() => codeInput.current?.focus(), 0);
    return true;
  }
  async function confirmCode() {
    setBusy(true); setError('');
    let next: (() => Promise<void>) | undefined;
    try {
      const r = await api<{ until: string; right: Right }>(`${ADMIN}/releases/yetki`, { code });
      setRight(r.right); setClock(Date.now()); setCode(''); next = pending?.go; setPending(null);
      if (!next) setNotice(`Güncelleme yetkisi açıldı (bitiş saati ${clockText(r.until)}).`);
    } catch (e) {
      setCode('');
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') { setRight(r => ({ minutes: 10, ...r, mfa: false, until: null })); setPending(null); }
      setError((e as Error).message);
    } finally { setBusy(false); }
    if (next) await next();
  }
  async function endRight() {
    try { const r = await api<{ right: Right }>(`${ADMIN}/releases/yetki/kapat`, {}); setRight(r.right); setNotice('Güncelleme yetkisi kapatıldı.'); } catch (e) { setError((e as Error).message); }
  }
  async function run(path: string, body: object, done: string, retry?: { label: string; go: () => Promise<void> }): Promise<boolean> {
    setBusy(true); setError(''); setNotice(''); setWarning('');
    try { await api(path, body); setNotice(done); await load(); return true; }
    catch (e) { if (!(retry && stepUpAgain(e, retry.label, retry.go))) setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }
  /** Publish (pilot / all), Durdur, Sil, Notu kaydet: each behind the Güncelleme yetkisi. */
  const act = (label: string, path: string, body: object, done: string, after?: () => void) => {
    const go = async () => { if (await run(path, body, done, { label, go })) after?.(); };
    guarded(label, go);
  };
  /** Raw bytes with a progress bar (XMLHttpRequest reports upload progress; fetch does not). */
  const send = (body: File) => new Promise<{ status: number; json: { release?: ReleaseView; message?: string; code?: string } }>((done, fail) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${ADMIN}/releases/upload`); x.withCredentials = true; x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
    x.upload.onload = () => { setProgress(100); setNotice('Yüklendi; Mola Merkez paketteki her dosyayı denetliyor…'); };
    x.onload = () => { let json = {}; try { json = JSON.parse(x.responseText); } catch { /* not JSON */ } done({ status: x.status, json }); };
    x.onerror = () => fail(new ApiError('Bağlantı koptu; paket yüklenemedi. Yeniden deneyin.', 0, 'NETWORK'));
    x.send(body);
  });
  async function loadFolder() { try { setFolder(await api<FolderList>(`${ADMIN}/releases/folder`)); } catch { setFolder(null); } }
  useEffect(() => { void loadFolder(); const t = setInterval(() => void loadFolder(), 15000); return () => clearInterval(t); }, []);
  /** After an upload (drop or "Klasörde hazır"): the list, the "kimseye sunulmaz" warning, and the publish choices. */
  async function uploaded(release: ReleaseView) {
    setFresh(release.id); setPilotFor(''); setPilot([]);
    const list = await api<{ releases: ReleaseView[]; cafes: Cafe[]; right?: Right }>(`${ADMIN}/releases`).catch(() => null);
    if (list) { setReleases(list.releases); setCafes(list.cafes); if (list.right) setRight(list.right); setWarning(olderThanCafes(release, list.cafes)); }
  }
  async function fromFolder(name: string) {
    setBusy(true); setError(''); setWarning(''); setFresh(''); setNotice(`${name} yükleniyor ve denetleniyor…`);
    try {
      const r = await api<{ release: ReleaseView }>(`${ADMIN}/releases/folder/import`, { name }, undefined, 600000);
      setNotice(''); await uploaded(r.release); await loadFolder();
    } catch (e) { setNotice(''); if (!stepUpAgain(e, 'Yükle ve doğrula', () => fromFolder(name))) setError((e as Error).message); } finally { setBusy(false); }
  }
  async function upload(chosen: File) {
    setBusy(true); setError(''); setWarning(''); setFresh(''); setNotice('Yükleniyor…'); setProgress(0);
    try {
      const response = await send(chosen), result = response.json;
      if (response.status < 200 || response.status >= 300) throw new ApiError(result.message ?? 'Paket yüklenemedi.', response.status, result.code ?? '');
      const release = result.release as ReleaseView;
      setFile(null); if (input.current) input.current.value = '';
      // The package is in; the note is saved apart, and a problem with it is said as such (the upload itself worked).
      let noteProblem = '';
      // The note as it is now (the upload may have waited for the code while the note was typed).
      const note = notesRef.current.trim();
      if (note && note !== release.notes) { try { await api(`${ADMIN}/releases/notes`, { id: release.id, notes: note }); } catch (e) { noteProblem = (e as Error).message; } }
      if (!noteProblem) setNotes('');
      setNotice('');
      if (noteProblem) setError(`Paket yüklendi, ama not kaydedilemedi: ${noteProblem} Notu sürümün altındaki “Notu düzenle” ile yeniden kaydedin.`);
      await uploaded(release);
    } catch (e) { setNotice(''); if (!stepUpAgain(e, 'Yükle ve doğrula', () => upload(chosen))) setError((e as Error).message); } finally { setBusy(false); setProgress(null); }
  }
  /** A dropped or chosen file starts at once (after the code when the Güncelleme yetkisi is closed). */
  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.mola-guncelleme')) { setError('Bu bir güncelleme dosyası değil: adı “.mola-guncelleme” ile biten dosyayı seçin (…\\Guncelleme\\ klasöründe).'); return; }
    setError(''); setFile(f); guarded('Yükle ve doğrula', () => upload(f));
  };
  if (!releases) return <section className="ps-releases release-settings" aria-label="Güncellemeler">{error ? <Notice tone="error">{error}</Notice> : <p className="muted">Yükleniyor…</p>}</section>;
  const activated = cafes.filter(c => c.installId), stopped = busy || blocked, justIn = releases.find(r => r.id === fresh && r.rollout.mode === 'off');
  const live = releases.find(r => r.rollout.mode !== 'off'), newest = releases[0];
  const troubled = activated.filter(c => c.update && ['failed', 'rolled_back'].includes(c.update.state)).length, waiting = activated.filter(c => c.update?.state === 'ready').length;
  const pilotForm = (r: ReleaseView) => <form className="release-pilot" aria-label="Pilot işletmeler" onSubmit={e => { e.preventDefault(); act('Pilotu başlat', `${ADMIN}/releases/rollout`, { id: r.id, mode: 'pilot', pilot }, `${r.version} seçili ${pilot.length} işletmeye sunuldu. Sorun yoksa “Herkese yayınla”.`, () => { setPilotFor(''); setFresh(''); }); }}>
    <p className="muted small">Önce birkaç işletmede deneyin; sorun yoksa “Herkese yayınla”.</p>
    {!activated.length ? <p className="muted small">Etkinleşmiş işletme yok.</p> : <div className="ps-pilot-list">{activated.map(c => <label key={c.tenantId} className="checkbox-line"><input type="checkbox" checked={pilot.includes(c.tenantId)} disabled={stopped} onChange={e => setPilot(p => e.target.checked ? [...p, c.tenantId] : p.filter(x => x !== c.tenantId))} />{c.name} <span className="muted small">({c.appVersion || 'sürüm bilinmiyor'})</span></label>)}</div>}
    <div className="ps-actions"><IconBtn icon={X} label="Vazgeç" disabled={busy} onClick={() => setPilotFor('')} /><button className="btn primary small-btn" disabled={stopped || !pilot.length}><Users size={16} aria-hidden="true" />Pilotu başlat</button></div>
  </form>;
  const publishAll = (r: ReleaseView) => act('Herkese yayınla', `${ADMIN}/releases/rollout`, { id: r.id, mode: 'all' }, `${r.version} herkese yayınlandı. İşletmeler bir sonraki bağlantıda (en geç 10 dakika) indirmeye başlar.`, () => setFresh(''));
  const choosePilot = (r: ReleaseView) => { setPilotFor(pilotFor === r.id ? '' : r.id); setPilot(r.rollout.pilot); };
  return <section className="ps-releases release-settings" aria-label="Güncellemeler">
    <div className="ps-grid">
      <SCard icon={CloudDownload} title="Otomatik güncelleme" sub="İşletmelere giden yeni sürümler" tip={SAFETY} wide className="ps-status-card">
        <dl className="ps-stats">
          <Stat label="Son yüklenen" value={newest ? newest.version : '—'} sub={newest ? platformNames[newest.platform] ?? newest.platform : 'Henüz paket yok'} />
          <Stat label="Yayında" value={live ? live.version : 'Yok'} sub={live ? rolloutText(live.rollout) : 'Hiçbir sürüm sunulmuyor'} tone={live ? (live.rollout.mode === 'all' ? 'ok' : 'warn') : 'idle'} />
          <Stat label="İşletmeler" value={`${activated.length} bağlı`} sub={troubled ? `${troubled} işletmede sorun` : waiting ? `${waiting} işletme yeniden başlatma bekliyor` : 'Sorun yok'} tone={troubled ? 'bad' : waiting ? 'warn' : activated.length ? 'ok' : 'idle'} />
        </dl>
        <div className={`release-right ps-right${open ? ' open' : ''}${blocked ? ' blocked' : ''}${pending ? ' pending' : ''}`} role="region" aria-label="Güncelleme yetkisi">
          <span className="ps-right-icon" aria-hidden="true">{open ? <LockOpen size={18} /> : <ShieldCheck size={18} />}</span>
          {blocked ? <>
            <p><b>Güncelleme yayınlamak için önce iki adımlı doğrulamayı açın.</b> <span className="muted">Yükleme ve yayın doğrulayıcı koduyla onaylanır.</span></p>
            {onSecurity && <button type="button" className="btn primary small-btn" onClick={onSecurity}>İki adımlı doğrulamayı aç</button>}
          </> : open && right?.until ? <>
            <p><b>Güncelleme yetkisi açık</b> · bitiş saati {clockText(right.until)}. Bu sürede kod sorulmaz.</p>
            <IconBtn icon={Lock} label="Yetkiyi kapat" disabled={busy} onClick={() => void endRight()} />
          </> : <form aria-label="Güncelleme yetkisi için kod" onSubmit={e => { e.preventDefault(); void confirmCode(); }}>
            <p>{pending ? <><b>“{pending.label}” için onay:</b> doğrulayıcı uygulamadaki (Authenticator) güncel 6 haneli kodu girin.</> : <><b>Güncelleme yetkisi kapalı.</b> Yükleme ve yayın için doğrulayıcı kodunu girin; bir kod {right?.minutes ?? 10} dakika geçerli. <HelpTip title="Güncelleme yetkisi">{`Yükleme, yayın, durdurma, silme ve not düzeltme (sürüm yeniden imzalanır) doğrulayıcı uygulamadaki (Authenticator) güncel kodla onaylanır. Bir kod ${right?.minutes ?? 10} dakika geçerli olur; süre içinde kod yeniden sorulmaz.`}</HelpTip></>}</p>
            <div className="release-code">
              <input ref={codeInput} aria-label="Doğrulayıcı kodu" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
              <button className="btn primary small-btn" disabled={busy || code.replace(/\s/g, '').length !== 6}>{pending ? 'Onayla ve devam et' : 'Yetkiyi aç'}</button>
              {pending && <IconBtn icon={X} label="Vazgeç" disabled={busy} onClick={() => { setPending(null); setCode(''); }} />}
            </div>
          </form>}
        </div>
      </SCard>

      {/* The one place for messages; "kimseye sunulmaz" is said once, on the release itself (.release-warning). */}
      {(error || notice) && <div className="ps-messages wide">
        {error && <Notice tone="error">{error}</Notice>}
        {notice && <div className="ps-dismiss"><Notice tone="success">{notice}</Notice>{!busy && <IconBtn icon={X} label="Mesajı kapat" onClick={() => setNotice('')} />}</div>}
      </div>}

      <SCard icon={Upload} title="Yeni sürüm yükle" sub="Sürükleyin · denetlenir · yayınlayın" tip={STEPS_TIP} tone="blue" wide className="ps-upload-card">
        <ol className="release-steps ps-stepper" aria-label="Nasıl yayınlanır">
          <li><b>Yeni sürümü buraya sürükleyin</b><small><code>npm run installer</code> → <code>Guncelleme\</code> klasörü</small></li>
          <li><b>Merkez denetler ve imzalar</b><small>Henüz hiçbir işletmeye gitmez</small></li>
          <li><b>Yayınlayın</b><small>Önce pilot, sonra herkese</small></li>
        </ol>
        <form className="release-upload" aria-label="Güncelleme paketi yükle" onSubmit={e => { e.preventDefault(); if (file) guarded('Yükle ve doğrula', () => upload(file)); }}>
          <div className={`release-drop${dragging ? ' dragging' : ''}${file ? ' chosen' : ''}${blocked ? ' blocked' : ''}`} onDragOver={e => { e.preventDefault(); if (!stopped) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!stopped) pick(e.dataTransfer.files?.[0]); }}>
            <span className="ps-drop-icon" aria-hidden="true"><Upload size={24} /></span>
            <strong>{file ? file.name : 'Güncelleme dosyasını buraya sürükleyin'}</strong>
            <span className="muted small">{file ? `${size(file.size)}${busy ? ' · yükleniyor ve denetleniyor…' : pending ? ' · yukarıdaki kodu girince yüklenir' : ''}` : 'Bırakınca hemen yüklenir ve denetlenir · ya da'}</span>
            <button type="button" className="btn secondary small-btn" disabled={stopped} onClick={() => input.current?.click()}><FileUp size={16} aria-hidden="true" />{file ? 'Başka dosya seç' : 'Dosya seç'}</button>
            <input ref={input} className="release-file" type="file" aria-label="Güncelleme paketi (.mola-guncelleme)" accept=".mola-guncelleme,application/gzip" disabled={stopped} onChange={e => pick(e.target.files?.[0])} />
          </div>
          {progress !== null && <div className="release-progress" role="progressbar" aria-label="Yükleme" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /><b>%{progress}</b></div>}
          <label className="ps-note-field"><span className="ps-label-row">İşletme sahibine not <span className="muted small">(isteğe bağlı)</span></span><textarea rows={2} maxLength={600} disabled={busy} value={notes} placeholder="ör. Mutfak ekranı hızlandı." onChange={e => setNotes(e.target.value)} /></label>
          {file && !busy && !pending && <button className="btn primary small-btn" disabled={stopped}><Upload size={16} aria-hidden="true" />Yükle ve doğrula</button>}
        </form>
        {justIn && <div className="release-fresh" role="region" aria-label="Yeni yüklenen sürüm">
          <p><CheckCircle2 size={16} aria-hidden="true" /> <b>{releaseName(justIn)} yüklendi, denetlendi ve imzalandı.</b> Henüz hiçbir işletmeye gitmedi. Şimdi yayınlayın:</p>
          <div className="ps-actions">
            <button type="button" className="btn primary small-btn" disabled={stopped || !activated.length} onClick={() => choosePilot(justIn)}><Users size={16} aria-hidden="true" />Önce pilot işletmelere</button>
            <button type="button" className="btn secondary small-btn" disabled={stopped} onClick={() => publishAll(justIn)}><Rocket size={16} aria-hidden="true" />Herkese yayınla</button>
            <button type="button" className="text-btn" disabled={busy} onClick={() => { setFresh(''); setPilotFor(''); }}>Sonra</button>
          </div>
          {pilotFor === justIn.id && pilotForm(justIn)}
        </div>}
        {folder?.folder && <details className="ps-more release-folder" open={folder.files.some(f => !f.imported)}>
          <summary>Klasörde hazır{folder.files.filter(f => !f.imported).length ? ` (${folder.files.filter(f => !f.imported).length})` : ''}</summary>
          <div role="region" aria-label="Klasörde hazır" className="ps-folder-body">
            <p className="muted small"><code>{folder.folder}</code> içine bıraktığınız paketler. Yayınlamak yine sizin seçiminizdir.</p>
            {!folder.files.length ? <p className="muted small">Bekleyen dosya yok.</p> : <ul className="release-list ps-folder-list">{folder.files.map(f => <li key={f.name} aria-label={`Klasörde ${f.name}`}>
              <div className="release-head"><strong>{f.version ?? f.name}</strong>{f.platformName && <span className="muted small">{f.platformName}</span>}<span className={`release-chip ${f.imported ? 'all' : 'off'}`}>{f.imported ? 'Zaten yüklü' : 'Klasörde hazır'}</span>
                {!f.imported && <IconBtn icon={Upload} label={`${f.name} yükle ve doğrula`} tone="primary" disabled={stopped} onClick={() => guarded('Yükle ve doğrula', () => fromFolder(f.name))} />}</div>
              <p className="muted small">{f.name} · {size(f.size)} · {dateTime(f.modifiedAt)}</p>
            </li>)}</ul>}
          </div>
        </details>}
      </SCard>

      <SCard icon={History} title="Sürümler" sub={releases.length ? `${releases.length} paket` : undefined} tip="Her yüklenen paket burada durur. “Önce pilot işletmelere” seçtiğiniz birkaç işletmeye sunar; “Herkese yayınla” bütün işletmelere. “Durdur” yayını keser: henüz kurmamış işletmeler indirdiklerini kurmaz. Yayında olmayan paket silinebilir." tone="lilac" wide className="ps-releases-card">
        {!releases.length ? <p className="muted small">Henüz güncelleme paketi yüklenmedi.</p> : <ul className="release-list ps-timeline">{releases.map(r => {
          const reached = activated.filter(c => c.update?.platform === r.platform && c.appVersion === r.version).length, stale = olderThanCafes(r, activated);
          return <li key={r.id} className={`mode-${r.rollout.mode}`} aria-label={`Sürüm ${r.version} ${platformNames[r.platform] ?? r.platform}`}>
            <div className="release-head"><strong>{r.version}</strong><span className="muted small">{platformNames[r.platform] ?? r.platform}</span><span className={`release-chip ${r.rollout.mode}`}>{rolloutText(r.rollout)}</span>
              <span className="ps-release-actions">
                {r.rollout.mode === 'off' && <IconBtn icon={Users} label="Önce pilot işletmelere" disabled={stopped || !activated.length} expanded={pilotFor === r.id} onClick={() => choosePilot(r)} />}
                {r.rollout.mode !== 'all' && <IconBtn icon={Rocket} label="Herkese yayınla" tone="primary" disabled={stopped} onClick={() => publishAll(r)} />}
                {r.rollout.mode !== 'off' && <IconBtn icon={Pause} label="Durdur" disabled={stopped} onClick={() => act('Durdur', `${ADMIN}/releases/rollout`, { id: r.id, mode: 'off' }, `${r.version} durduruldu. Henüz kurmamış işletmeler indirdiklerini kurmaz.`)} />}
                {r.rollout.mode === 'off' && <IconBtn icon={Trash2} label="Sil" tone="danger" disabled={stopped} onClick={() => { if (confirm(`${releaseName(r)} paketi silinsin mi?`)) act('Sil', `${ADMIN}/releases/delete`, { id: r.id }, 'Paket silindi.', () => { if (fresh === r.id) setFresh(''); }); }} />}
              </span></div>
            <p className="muted small">{size(r.size)} · {r.files} dosya{r.runtime ? ` · Node.js ${r.node} dahil` : ''} · {r.minFrom !== '0.0.0' ? `${r.minFrom} ve sonrasından · ` : ''}yüklendi {dateTime(r.importedAt)}{r.rollout.changedAt ? ` · son değişiklik ${dateTime(r.rollout.changedAt)}` : ''} · kuran işletme: {reached}</p>
            {stale && <p className="release-warning"><AlertTriangle size={14} aria-hidden="true" />{stale}</p>}
            {editing === r.id ? <form className="release-notes" onSubmit={e => { e.preventDefault(); act('Notu kaydet', `${ADMIN}/releases/notes`, { id: r.id, notes: draft }, 'Not kaydedildi; sürüm yeniden imzalandı.', () => setEditing('')); }}>
              <textarea rows={2} maxLength={600} aria-label="İşletme sahibine not" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} />
              <div className="ps-actions"><IconBtn icon={X} label="Vazgeç" disabled={busy} onClick={() => setEditing('')} /><button className="btn primary small-btn" disabled={stopped}>Notu kaydet</button></div>
            </form> : <div className="ps-note-row"><p className="release-note">{r.notes || <span className="muted">Not yok.</span>}</p><IconBtn icon={Pencil} label="Notu düzenle" disabled={stopped} onClick={() => { setEditing(r.id); setDraft(r.notes); }} /></div>}
            {pilotFor === r.id && justIn?.id !== r.id && pilotForm(r)}
          </li>;
        })}</ul>}
      </SCard>

      <SCard icon={Store} title="İşletmelerin sürümleri" sub={`${activated.length} işletme`} tip="Her işletmenin bilgisayarı her bağlantıda (en geç 10 dakikada) sürümünü ve güncellemenin durumunu bildirir. İşletmeler yeni sürümü çalışırken indirir; kapanışta, ertesi açılışta ya da boşken kurar." tone="green" wide>
        {!activated.length ? <p className="muted small">Etkinleşmiş işletme yok.</p> : <table className="failure-table release-cafes" aria-label="İşletmelerin sürümleri"><thead><tr><th>İşletme</th><th>Sürüm</th><th>Güncelleme</th><th>Son bilgi</th></tr></thead><tbody>
          {activated.map(c => { const s = cafeState(c); return <tr key={c.tenantId}><td>{c.name}</td><td>{c.appVersion || '—'}</td><td className={s.tone}>{s.text}{c.update && c.update.idleInstall === false ? <span className="muted"> · boşta kurma kapalı</span> : null}</td><td>{c.update?.receivedAt ? dateTime(c.update.receivedAt) : c.lastSeenAt ? dateTime(c.lastSeenAt) : '—'}</td></tr>; })}
        </tbody></table>}
      </SCard>
    </div>
  </section>;
}

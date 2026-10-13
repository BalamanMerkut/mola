import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, KeyRound, Pencil, RefreshCw, Store, UserRound } from 'lucide-react';
import type { Sector } from '../packages/domain/sector';
import { api, ApiError } from './api';
import { ApplicationForm, type ApplicationFields } from './ApplicationForm';
import { Brand, Notice } from './components';
import { MolaContact, useMolaContact } from './MolaContact';
import { AGREEMENT_PROBLEM, AgreementCheck, agreementBody } from './LicenseAgreement';
import './activation.css';

type Applied = { status: 'pending' | 'rejected'; name: string; submittedAt: string; reason: string | null; checkedAt: string | null; error: string | null; form?: ApplicationFields };
type Status = { state: 'activate' | 'applied' | 'owner' | 'ready'; local: boolean; pending?: { name: string; sector: Sector | null }; application?: Applied; existingData: boolean };
const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
/** While an application waits, the screen asks this often (the café server asks Merkez at most every 2 s). */
const POLL_MS = 3000;
/**
 * Merkez could not be reached, and the server says why (server/kafe-link.ts merkezProblem): no internet, Merkez not answering,
 * a wrong or refusing address, this computer's clock. Each says what to do; all keep "Yeniden dene" and the Mola team's contact.
 */
const NETWORK = ['MERKEZ_OFFLINE', 'MERKEZ_UNREACHABLE', 'MERKEZ_ADDRESS', 'MERKEZ_CLOCK'];
const help = 'Sorun sürerse Mola ekibine ulaşın.';
/** The username rule as an HTML pattern: the dash escaped, so it stays valid under the browser's `v` flag. */
export const USERNAME_PATTERN = '[a-z][a-z0-9._\\-]{2,31}';
/** What is wrong with a typed username, in words ('' when fine or still empty). */
export function usernameProblem(v: string) {
  if (!v) return '';
  if (/\s/.test(v)) return 'Kullanıcı adında boşluk olamaz.';
  if (!/^[a-z]/.test(v)) return 'Kullanıcı adı küçük bir harfle başlamalı.';
  if (/[^a-z0-9._-]/.test(v)) return 'Yalnız küçük harf (Türkçe harf yok), rakam ve . _ - kullanın.';
  if (v.length < 3) return 'En az 3 karakter yazın.';
  return '';
}
/**
 * "Mola'yı etkinleştir": before anything else on a café computer that is not linked to Mola Merkez yet.
 *   1. "Hesap açma başvurusu" (the vendor approves it and starts the 30-day trial), or the one-time code from the Mola team;
 *   2. the owner account, made and kept only on this computer.
 * Then the usual login and the first setup wizard follow. Every try reuses the ids the café server keeps, so retries,
 * corrections and restarts never open a second application or business at Merkez.
 */
export function Activation({ onReady }: { onReady: (username: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null), [mode, setMode] = useState<'choose' | 'apply' | 'code'>('choose'), [editing, setEditing] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(false), [code, setCode] = useState('');
  const [username, setUsername] = useState(''), [displayName, setDisplayName] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  // Mola Lisans Sözleşmesi: ticked before "Etkinleştir" (the application form has its own box).
  const [agreed, setAgreed] = useState(false), [agreeTried, setAgreeTried] = useState(false);
  async function refresh() { try { setStatus(await api<Status>('/api/activation', undefined, undefined, 20000)); setError(''); } catch (e) { setError((e as Error).message); } }
  // Asked once on the first screen, so this computer keeps the Mola team's contact before it may lose the connection.
  useMolaContact();
  useEffect(() => { void refresh(); }, []);
  const waiting = status?.state === 'applied' && !editing && mode !== 'code';
  // The status line refreshes by itself; approval moves straight on to the owner account.
  useEffect(() => { if (!waiting) return; const t = setInterval(() => void refresh(), POLL_MS); return () => clearInterval(t); }, [waiting]);
  async function send(path: string, body: object) {
    setBusy(true); setError(''); setRetry(false);
    try { await api(path, body, undefined, 30000); setEditing(false); setMode('choose'); await refresh(); }
    catch (e) {
      setRetry(!(e instanceof ApiError) || e.status >= 500 || NETWORK.includes(e.code)); setError((e as Error).message);
      if (e instanceof ApiError && e.code === 'ALREADY_ACTIVE') await refresh();
    } finally { setBusy(false); }
  }
  async function owner() {
    setBusy(true); setError('');
    try { const r = await api<{ username: string }>('/api/activation/owner', { username, password, ...(displayName.trim() ? { name: displayName.trim() } : {}) }); setPassword(''); setRepeat(''); onReady(r.username); }
    catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.code === 'NOT_PENDING') await refresh(); } finally { setBusy(false); }
  }
  // "İşletmem var" (13 Ekim): the dialog lives in the desktop window's rail (src/RestoreBackup.tsx OwnerRestoreDialog).
  // No answer means no rail: a tablet or a browser on the network, where a business cannot be moved in.
  function openOwner() {
    setError('');
    let answered = false;
    const on = (e: Event) => { answered = true; setError((e as CustomEvent<string>).detail ?? ''); };
    window.addEventListener('mola:open-result', on, { once: true });
    window.dispatchEvent(new CustomEvent('mola:open', { detail: 'owner' }));
    setTimeout(() => { window.removeEventListener('mola:open-result', on); if (!answered) setError('“İşletmem var” kasa bilgisayarındaki Mola penceresinden yapılır.'); }, 400);
  }
  const back = () => { setMode('choose'); setEditing(false); setError(''); setRetry(false); };
  // The owner account's rules, shown live under each field (the same rules as server/kafe-routes.ts).
  const userProblem = usernameProblem(username), ownerReady = !!username && !userProblem && password.length >= 10 && password === repeat;
  const form = (initial: ApplicationFields | undefined, title: string, submitLabel: string, backLabel?: string) => <>
    <h1>{title}</h1>
    <p className="muted small">Hesabınızı Mola ekibi onaylar; onaylanınca 30 günlük ücretsiz deneme başlar. Kart bilgisi istenmez, süre sonunda kendiliğinden ücretli olmaz. Her başvuru aynı şekilde incelenir; vergi numarası yanlışsa düzeltip yeniden gönderebilirsiniz.</p>
    <ApplicationForm initial={initial} busy={busy} error={error} retry={retry} submitLabel={submitLabel} backLabel={backLabel} onBack={back} onSubmit={fields => void send('/api/activation/application', { ...fields, ...agreementBody() })} />
    {retry && <MolaContact note={help} />}
  </>;
  const a = status?.application;
  const body = !status ? (error ? <><Notice tone="error">{error}</Notice><button className="btn secondary" onClick={() => void refresh()}><RefreshCw size={15} />Yeniden dene</button><MolaContact note={help} /></> : <p className="muted">Yükleniyor…</p>)
    : status.state === 'ready' ? <button className="btn primary" onClick={() => onReady('')}>Girişe devam et</button>
    : !status.local ? <><h1>Mola henüz etkinleştirilmedi</h1><p>{status.state === 'applied' ? 'Hesap açma başvurusu Mola ekibinin onayını bekliyor.' : 'Etkinleştirme kasa bilgisayarındaki Mola penceresinden yapılır.'} Bitince bu ekran giriş ekranına döner.</p><button className="btn secondary" onClick={() => void refresh()}><RefreshCw size={15} />Yeniden kontrol et</button></>
    : status.state === 'owner' ? <>
      <h1>İşletme sahibi hesabı</h1>
      <p><strong>{status.pending?.name}</strong> için giriş bilgilerinizi belirleyin.</p>
      <form noValidate onSubmit={e => { e.preventDefault(); if (ownerReady) void owner(); }}>
        <label>Kullanıcı adı *<input required autoComplete="username" pattern={USERNAME_PATTERN} maxLength={32} disabled={busy} value={username} aria-invalid={!!userProblem} aria-describedby="owner-username-rule" onChange={e => setUsername(e.target.value.toLowerCase())} placeholder="ör. ayse.kafe" /></label>
          <small id="owner-username-rule" className={userProblem ? 'field-error' : 'field-rule'} role={userProblem ? 'alert' : undefined}>{userProblem || 'Küçük harfle başlar; küçük harf, rakam ve . _ - olabilir; boşluk yok (3–32 karakter).'}</small>
        <label>Adınız <span className="muted small">(isteğe bağlı)</span><input maxLength={60} disabled={busy} value={displayName} onChange={e => setDisplayName(e.target.value)} /></label>
        <label>Şifre *<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" disabled={busy} value={password} aria-invalid={!!password && password.length < 10} aria-describedby="owner-password-rule" onChange={e => setPassword(e.target.value)} /></label>
          <small id="owner-password-rule" className={password && password.length < 10 ? 'field-error' : 'field-rule'}>{password && password.length < 10 ? `En az 10 karakter: ${10 - password.length} karakter daha yazın.` : 'En az 10 karakter.'}</small>
        <label>Şifre tekrar *<input type="password" required maxLength={128} autoComplete="new-password" disabled={busy} value={repeat} aria-invalid={!!repeat && repeat !== password} onChange={e => setRepeat(e.target.value)} /></label>
          {repeat && repeat !== password && <small className="field-error" role="alert">Şifreler eşleşmiyor.</small>}
        <p className="muted small">Şifreniz Mola Merkez’e gönderilmez. Yeni bilgisayarda “İşletmem var” ile girebilmeniz için yalnız şifreden geri çevrilemeyen bir doğrulama özeti saklanır.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn primary" disabled={busy || !ownerReady}><UserRound size={16} />{busy ? 'Hesap oluşturuluyor…' : 'Hesabı oluştur'}</button>
      </form></>
    : status.state === 'applied' && a && editing ? form(a.form, 'Bilgileri düzelt', a.status === 'rejected' ? 'Yeniden gönder' : 'Düzeltmeyi gönder', 'Vazgeç')
    : status.state === 'applied' && a && mode !== 'code' ? <>
      <h1>{a.status === 'rejected' ? 'Başvurunuz onaylanmadı' : 'Başvurunuz alındı · Onay bekleniyor'}</h1>
      <p><strong>{a.name}</strong> için hesap açma başvurunuz Mola ekibine ulaştı.{a.status === 'pending' && ' Mola ekibi bilgilerinizi kontrol eder; gerekirse yazdığınız telefondan sizi arar. Onaylanınca bu ekran kendiliğinden işletme sahibi hesabına geçer. Bu sırada Mola sipariş için kullanılamaz.'}</p>
      {a.status === 'rejected' && <><Notice tone="error">{a.reason}</Notice><p className="muted small">Bilgileri düzeltip aynı başvuruyu yeniden gönderebilirsiniz.</p></>}
      <p className={`application-status${a.error ? ' warn' : ''}`} role="status">{a.error ? `${a.error} Birkaç saniye içinde yeniden denenecek.` : `Durum: ${a.status === 'rejected' ? 'onaylanmadı' : 'Mola ekibinin onayı bekleniyor'}${a.checkedAt ? ` · Son kontrol ${clock(a.checkedAt)}` : ''}`}</p>
      {a.error && <p className="activation-retry"><button type="button" className="btn secondary small-btn" onClick={() => void refresh()}><RefreshCw size={14} />Yeniden dene</button></p>}
      <div className="activation-actions">
        <button type="button" className="btn secondary" onClick={() => { setMode('code'); setError(''); setRetry(false); }}><KeyRound size={15} />Etkinleştirme kodum var</button>
        <button type="button" className="btn primary" onClick={() => { setEditing(true); setError(''); setRetry(false); }}><Pencil size={15} />{a.status === 'rejected' ? 'Bilgileri düzelt ve yeniden gönder' : 'Bilgileri düzelt'}</button>
      </div>
      <MolaContact title={a.status === 'rejected' ? 'Mola ekibine ulaşın' : 'Sorunuz mu var?'} note={a.status === 'rejected' ? 'Neden onaylanmadığını sormak ya da bilgileri birlikte düzeltmek için:' : 'Başvurunuzla ilgili Mola ekibine ulaşabilirsiniz.'} /></>
    : mode === 'choose' ? <>
      <h1>Mola’yı etkinleştir</h1>
      {/* 10 Ekim: the two ways said as the owner thinks them (site /indir/ step 2): no code → apply; a code → type it. */}
      <p>Mola ekibinden bir etkinleştirme kodu aldınız mı? Almadıysanız başvuru yapın; kod gerekmez. İnternet bağlantısı gerekir.</p>
      <button type="button" className="activation-choice" onClick={() => setMode('apply')}><ClipboardList size={22} /><span><strong>Kodum yok, başvuru yapacağım</strong><small>Hesap açma başvurusu: işletme ve fatura bilgilerinizi gönderin. Mola ekibi onaylayınca 30 günlük ücretsiz deneme başlar.</small></span></button>
      <button type="button" className="activation-choice" onClick={() => setMode('code')}><KeyRound size={22} /><span><strong>Etkinleştirme kodum var</strong><small>Mola ekibinin size verdiği tek kullanımlık kodu girin.</small></span></button>
      <button type="button" className="activation-choice" onClick={openOwner}><Store size={22} /><span><strong>İşletmem var</strong><small>Mola’yı başka bir bilgisayarda kullanıyorum: kullanıcı adım, şifrem ve e-postama gelen kodla verilerimi bu bilgisayara getir.</small></span></button>
      {error && <Notice tone="error">{error}</Notice>}
      {status.existingData && <><p className="muted small">Bu bilgisayarda önceki sürümden kalan işletme verisi var. Veriler silinmez; mevcut işletmenizi bağlamak için Mola destek ekibine başvurun.</p><MolaContact /></>}
    </>
    : mode === 'apply' ? form(undefined, 'Hesap açma başvurusu', 'Başvuruyu gönder')
    : <>
      <h1>Etkinleştirme kodu</h1>
      <form onSubmit={e => { e.preventDefault(); if (!agreed) { setAgreeTried(true); return; } void send('/api/activation/code', { code, ...agreementBody() }); }}>
        <label>Etkinleştirme kodu *<input className="activation-code-input" required minLength={4} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy} value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" /></label>
        <AgreementCheck checked={agreed} onChange={setAgreed} disabled={busy} problem={agreeTried && !agreed ? AGREEMENT_PROBLEM : undefined} />
        {error && <Notice tone="error">{error}</Notice>}
        {retry && <p className="muted small">Yeniden denemek yeni bir kayıt açmaz.</p>}
        <div className="activation-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={back}><ArrowLeft size={15} />Geri</button>
          <button className="btn primary" disabled={busy}>{retry && <RefreshCw size={15} />}{busy ? 'Mola Merkez’e bağlanılıyor…' : retry ? 'Yeniden dene' : 'Etkinleştir'}</button>
        </div>
      </form>
      {(retry || /kod/i.test(error)) && <MolaContact note={retry ? help : 'Kod çalışmıyorsa Mola ekibinden yenisini isteyin.'} />}
    </>;
  return <main className="activation-page"><section className={`activation-card${(mode === 'apply' || editing) && status?.local && (status.state === 'activate' || status.state === 'applied') ? ' wide' : ''}`} aria-label="Mola’yı etkinleştir"><Brand />{body}</section></main>;
}

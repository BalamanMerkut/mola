import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { deviceKindOf, deviceLabel, newPhoneKeys, openReport, signLive, type DeviceKind, type ReportBox } from '../packages/domain/remote-crypto';
import { deviceLogin, type LoginResult } from '../packages/domain/remote-login';
import type { PhoneReport } from '../packages/domain/remote-report';
import { businessTheme } from './BusinessTheme';
import { deviceId, forgetPaired, readPaired, savePaired, type Paired } from './phoneVault';
import { openRemote, REMOTE_ENDED_EVENT, REMOTE_OFFLINE_EVENT, RemoteError, resumeRemote, type RemoteSession } from './remoteTransport';
import './reports-phone.css';

/*
 * "Kafemi yönet" (/yonet on Mola Merkez, 0.1.23: Raporlarım and "Kafeyi yönet" on one page, one address; /raporlarim and
 * typed variants come here with a 301). The owner's decision: one website sign-in, nothing else to find.
 *   Giriş        not signed in on this device: "E-posta" + "Şifre" → "Devam" (the café computer checks the password at once,
 *                sealed to it; Mola Merkez never sees it) → "Telefon kodu" → "Giriş yap"; at most 3 devices ("Hangisinin
 *                yerine?"). The device makes its own key pair here (the private key never leaves this browser), names itself
 *                ("iPhone · 15 Ekim") and keeps what it needs in IndexedDB (src/phoneVault.ts; packages/domain/remote-login.ts,
 *                server/remote-reports.ts).
 *   Kafe açık    with Uzaktan yönetim on: straight into the café's own screens (src/RemoteAdmin.tsx, sealed tunnel
 *                src/remoteTransport.ts). Right after the sign-in its one-time grant opens them; later the password and the
 *                phone code once per session (until 05:00). Without it (package or switched off): the live report.
 *   Kafe kapalı  the last report the café left at Mola Merkez (encrypted for this device) with "Kasa bilgisayarı kapalı · Son
 *                durum 23:40", also when the café goes off during a session; once it answers again "Kasa açıldı · Kafeyi
 *                yönet" brings the screens back without typing anything (the same session, unless the café restarted).
 * "Çıkış" forgets this device here and asks the café to drop it (a shared laptop). Mola Merkez only carries ciphertext.
 */
const ManageFrame = lazy(() => import('./RemoteAdmin').then(module => ({ default: module.ManageFrame })));
const API = '/api/merkez/v1/phone';
type Answer = { status: number; data: Record<string, any> };
async function call(path: string, body: unknown): Promise<Answer> {
  const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit' });
  let data: Record<string, any> = {}; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data };
}
const tl = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const dayName = (day: string, withWeekday = true) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', ...(withWeekday ? { weekday: 'long' } : {}) });
const when = (iso: string) => { const d = new Date(iso), today = new Date(); const same = d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) === today.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }); return same ? clock(iso) : `${d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' })} ${clock(iso)}`; };
/** WebCrypto X25519 here? (a secure page and a current browser) */
async function cryptoReady() {
  if (!window.isSecureContext || !globalThis.crypto?.subtle || !('indexedDB' in window)) return 'https';
  try { await newPhoneKeys(); return 'ok'; } catch { return 'old'; }
}

/** The permanent link's code this page came through (/k/<kod> → /yonet#k=<kod>), kept for this tab: "Kafedeyim, kasayı aç". */
const LINK_KEY = 'mola-kalici-kod', LINK_CODE = /^[A-Za-z0-9]{10}$/;
function readStart() {
  const k = /^#k=([A-Za-z0-9]{10})$/.exec(location.hash)?.[1];
  try { if (k) sessionStorage.setItem(LINK_KEY, k); } catch { /* the link only */ }
  // Nothing stays in the address bar (not in history, not in a bookmark); an old pairing link (#e=…, before 0.1.22) just
  // lands on the sign-in.
  if (location.hash) history.replaceState(null, '', location.pathname);
  let code = k ?? null; try { code ??= sessionStorage.getItem(LINK_KEY); } catch { /* none */ }
  return code && LINK_CODE.test(code) ? code : null;
}

export function OwnerPage() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'https' | 'old'>('checking');
  const [paired, setPaired] = useState<Paired | null | undefined>(undefined);
  const [k] = useState(readStart), [notice, setNotice] = useState(''), [fresh, setFresh] = useState<{ business: string; grant?: string } | null>(null);
  useEffect(() => {
    document.title = 'Kafemi yönet · Mola';
    void cryptoReady().then(r => setReady(r as 'ok' | 'https' | 'old')); void readPaired().then(p => setPaired(p ?? null)).catch(() => setPaired(null));
  }, []);
  if (ready === 'checking' || paired === undefined) return <Shell><p className="rp-muted rp-center" aria-busy="true">Açılıyor…</p></Shell>;
  if (ready !== 'ok') return <Shell><div className="rp-card rp-warn" role="alert"><h2>Bu sayfa burada açılamıyor</h2><p>{ready === 'https' ? 'Kafemi yönet yalnız güvenli bağlantıyla (https://) açılır. Adresi https:// ile yazın ya da Mola ekibine danışın.' : 'Bu tarayıcı gereken şifrelemeyi desteklemiyor. Cihazınızı ve tarayıcınızı güncelleyip yeniden deneyin.'}</p></div></Shell>;
  if (!paired) return <Shell k={k}><Login notice={notice} onPaired={(p, grant) => { setNotice(''); setFresh({ business: p.business, grant }); setPaired(p); }} /></Shell>;
  return <Home paired={paired} fresh={fresh} k={k} onGone={why => { setNotice(why); setFresh(null); setPaired(null); void forgetPaired().catch(() => {}); }} />;
}

/** The slim header (Mola mark, "Kafemi yönet", the business) over the owner's own screens; `theme`: the business's palette. */
function Shell({ children, business, k, action, theme }: { children: ReactNode; business?: string; k?: string | null; action?: ReactNode; theme?: PhoneReport['theme'] }) {
  return <div className="rp-shell" style={businessTheme(theme)}>
    <header className="rp-header"><div className="rp-header-in"><span className="rp-logo" aria-hidden="true">M</span><div className="rp-title"><strong>Kafemi yönet</strong>{business && <span>{business}</span>}</div>{action}</div></header>
    <main className="rp-page">{children}</main>
    {k && <a className="rp-cafe" href={`/k/${k}?kafe=1`}>Kafedeyim, kasayı aç</a>}
    <footer className="rp-foot">Bu cihazla kasa bilgisayarı arasındaki her şey şifrelidir. Mola Merkez yalnız iletir, okuyamaz.</footer>
  </div>;
}

const KIND_NAME: Record<DeviceKind | 'unknown', string> = { unknown: 'Cihaz', phone: 'Telefon', tablet: 'Tablet', computer: 'Bilgisayar' };
type Full = Extract<LoginResult, { kind: 'full' }>;
type Step = { at: 'password' } | { at: 'code'; ticket: string; cafePublic: string } | { at: 'full'; full: Full };
/** "Giriş yap" in two steps; checked by the café computer, never by Mola Merkez (it only carries the sealed requests). */
function Login({ notice, onPaired }: { notice: string; onPaired: (p: Paired, grant?: string) => void }) {
  const id = useId(), kind = deviceKindOf(navigator.userAgent, navigator.maxTouchPoints);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ at: 'password' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The same keys through every step: the café's tickets are for this device's key.
  const keys = useRef<{ privateKey: CryptoKey; publicKey: string } | null>(null), device = useRef<string>(''), codeInput = useRef<HTMLInputElement>(null);
  // The code field keeps the focus (also after a wrong code: the keyboard stays up for the next one).
  useEffect(() => { if (step.at === 'code' && !busy) codeInput.current?.focus(); }, [step, busy]);
  const who = () => ({ name: deviceLabel(navigator.userAgent, navigator.maxTouchPoints), kind, ...(device.current ? { device: device.current } : {}) });
  async function finish(r: LoginResult) {
    if (r.kind === 'code') { setStep({ at: 'code', ticket: r.ticket, cafePublic: r.cafePublic }); if (r.message) setError(r.message); return; }
    if (r.kind === 'full') { setStep({ at: 'full', full: r }); return; }
    if (r.kind === 'error') {
      // The ticket ran out (or a page from before): back to the first screen with the reason.
      if (r.code === 'LOGIN_EXPIRED') setStep({ at: 'password' });
      setError(r.message); return;
    }
    const p: Paired = { v: 1, phoneId: r.phoneId, token: r.token, cafePublic: r.cafePublic, business: r.business, pairedAt: new Date().toISOString(), privateKey: keys.current!.privateKey, publicKey: keys.current!.publicKey };
    await savePaired(p); onPaired(p, r.grant);
  }
  async function run(fn: () => Promise<LoginResult>) {
    setBusy(true); setError('');
    try { await finish(await fn()); } catch { setError('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.'); } finally { setBusy(false); }
  }
  function first(e: FormEvent) {
    e.preventDefault();
    const typed = password; setPassword(''); setCode('');
    void run(async () => {
      keys.current = await newPhoneKeys(); device.current = await deviceId().catch(() => '');
      return deviceLogin(call, keys.current, email.trim(), { password: typed, ...who() });
    });
  }
  function second(e: FormEvent) {
    e.preventDefault(); if (step.at !== 'code') return;
    const typed = code.replace(/\D/g, ''); setCode('');
    void run(() => deviceLogin(call, keys.current!, email.trim(), { ticket: step.ticket, code: typed, ...who() }, { cafePublic: step.cafePublic }));
  }
  const back = () => { setStep({ at: 'password' }); setError(''); setCode(''); };
  if (step.at === 'full') return <div className="rp-card rp-login" role="group" aria-label="Hangi cihazın yerine?">
    <h2>{step.full.message}</h2>
    <p className="rp-muted">Seçtiğiniz cihazın bağlantısı kalkar; bu cihaz onun yerine geçer.</p>
    <ul className="rp-replace">{step.full.devices.map(d => <li key={d.id}><button type="button" className="rp-choice" disabled={busy} onClick={() => void run(() => deviceLogin(call, keys.current!, email.trim(), { ticket: step.full.ticket, replace: d.id, ...who() }, { cafePublic: step.full.cafePublic }))}>
      <strong>{d.name}</strong><small>{KIND_NAME[d.kind ?? 'unknown']} · {d.lastSeenAt ? `Son rapor: ${when(d.lastSeenAt)}` : 'Henüz rapor almadı'}</small></button></li>)}</ul>
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="button" className="rp-ghost" disabled={busy} onClick={back}>Vazgeç</button>
  </div>;
  if (step.at === 'code') return <form className="rp-card rp-login" onSubmit={second} aria-label="Telefon kodu">
    <p className="rp-steps" aria-hidden="true"><span className="done" /><span className="on" /></p>
    <h2>Telefon kodu</h2>
    <p className="rp-muted">Doğrulama uygulamanızdaki (Google Authenticator gibi) 6 haneli güncel kodu yazın.</p>
    <label htmlFor={`${id}-code`} className="rp-sr">Telefon kodu</label>
    <input ref={codeInput} id={`${id}-code`} className="rp-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus placeholder="••••••" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy || code.length !== 6}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
    <button type="button" className="rp-ghost" disabled={busy} onClick={back}>Geri</button>
  </form>;
  return <form className="rp-card rp-login" onSubmit={first} aria-label="Giriş yap">
    <p className="rp-steps" aria-hidden="true"><span className="on" /><span /></p>
    <h2>Giriş yap</h2>
    <p className="rp-muted">İşletme sahibi e-postanız ve şifrenizle bir kez girin; bu cihaz hatırlanır.</p>
    {notice && <p className="rp-note" role="status">{notice}</p>}
    <label htmlFor={`${id}-email`}>E-posta</label>
    <input id={`${id}-email`} type="email" inputMode="email" autoComplete="username" maxLength={120} required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
    <label htmlFor={`${id}-password`}>Şifre</label>
    <input id={`${id}-password`} type="password" autoComplete="current-password" maxLength={200} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy || !email.trim() || !password}>{busy ? 'Kontrol ediliyor…' : 'Devam'}</button>
    <p className="rp-muted rp-small">Kasa bilgisayarı açık olmalı. E-posta ve telefon kodu kasada Ayarlar → Uzaktan erişim’de kurulur.</p>
  </form>;
}

type Shown = { report: PhoneReport; kind: 'live' | 'snapshot' };
/** Never back to an older report than the one on screen (a stale postbox box after a live answer). */
const newer = (a: Shown | undefined, b: Shown) => !a || Date.parse(b.report.at) >= Date.parse(a.report.at);
type Status = { kind: 'live' | 'offline' | 'error' | 'loading'; text?: string };
type View = 'reports' | 'manage' | 'unlock';
const REVOKED = 'Bu cihazın bağlantısı kaldırıldı. Yeniden giriş yapabilirsiniz.';

/** A signed-in device: the café's full screens when it is on and Uzaktan yönetim is on, else the report (live or the last). */
function Home({ paired, fresh, k, onGone }: { paired: Paired; fresh: { business: string; grant?: string } | null; k: string | null; onGone: (why: string) => void }) {
  const [shown, setShown] = useState<Shown | undefined>(paired.last), [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [session, setSession] = useState<RemoteSession | null>(null), [resumed, setResumed] = useState(false);
  const [view, setView] = useState<View>('reports'), [notice, setNotice] = useState(''), [back, setBack] = useState(false);
  const gone = useRef(onGone); gone.current = onGone;
  // The owner chose the reports (or the café went off during a session): no jumping back into the screens by itself.
  const stay = useRef(false), grant = useRef(fresh?.grant);
  const busy = useRef(false), current = useRef(paired);
  const keep = useCallback(async (next: Shown) => {
    setShown(prev => newer(prev, next) ? next : prev);
    if (newer(current.current.last, next)) { current.current = { ...current.current, last: next }; try { await savePaired(current.current); } catch { /* shown anyway */ } }
  }, []);
  /** The café computer's last report left at Mola Merkez (handed over once; this device keeps it). */
  const postbox = useCallback(async () => {
    const p = current.current, box = await call('postbox', { phoneId: p.phoneId, token: p.token });
    if (box.status === 403) { gone.current(REVOKED); return false; }
    if (box.status === 200 && box.data.box) try { await keep({ report: await openReport<PhoneReport>(p.privateKey, p.cafePublic, box.data.box as ReportBox, { phone: p.phoneId, kind: 'snapshot' }), kind: 'snapshot' }); } catch { /* not for this device: the one shown stays */ }
    return true;
  }, [keep]);
  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    const p = current.current;
    try {
      const q = await signLive(p.privateKey, p.cafePublic, p.phoneId);
      const live = await call('live', { phoneId: p.phoneId, token: p.token, request: q });
      if (live.status === 403 && ['PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(live.data.code)) { gone.current(REVOKED); return; }
      if (live.status === 200 && live.data.box) {
        const report = await openReport<PhoneReport>(p.privateKey, p.cafePublic, live.data.box as ReportBox, { phone: p.phoneId, ref: q.nonce, kind: 'live' });
        await keep({ report, kind: 'live' }); setStatus({ kind: 'live' }); return;
      }
      // Off, or any other answer (0.1.23: never an empty card): the last report from the postbox, with a short reason.
      if (live.status === 200 && live.data.offline) { if (live.data.waiting || !current.current.last) await postbox(); setStatus({ kind: 'offline' }); return; }
      await postbox().catch(() => true);
      setStatus({ kind: 'error', text: live.data.message ?? 'Kasa bilgisayarı şu an yanıt vermedi.' });
    } catch {
      try { await postbox(); } catch { /* no internet at all: what this device keeps */ }
      setStatus({ kind: 'error', text: 'İnternet bağlantısı yok ya da Mola Merkez’e ulaşılamadı.' });
    } finally { busy.current = false; }
  }, [keep, postbox]);
  // The session this device still has (a reload keeps it until 05:00).
  useEffect(() => { void resumeRemote(paired).then(s => { if (s) setSession(s); }).finally(() => setResumed(true)); }, [paired]);
  const r = shown?.report, admin = r?.admin, live = status.kind === 'live';
  // The report asks at once and every minute; every 15 s while the café is off (to say "Kasa açıldı" soon). Not while the
  // screens run (they have their own connection).
  useEffect(() => {
    if (view === 'manage') return;
    void refresh();
    const again = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [refresh, view]);
  useEffect(() => {
    if (view === 'manage') return;
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, live ? 60_000 : 15_000);
    return () => clearInterval(t);
  }, [refresh, view, live]);
  // Café on and Uzaktan yönetim on: into the screens (the session, else the sign-in's grant, else password + code).
  useEffect(() => {
    if (!resumed || !live || admin !== 'on' || stay.current || view === 'manage') return;
    if (session) { setView('manage'); return; }
    const g = grant.current;
    if (g) { grant.current = undefined; void openRemote(current.current, '', '', g).then(s => { setSession(s); setView('manage'); }, () => setView('unlock')); return; }
    setView('unlock');
  }, [resumed, live, admin, session, view]);
  // The café went off during a session: the last report, "Kasa bilgisayarı kapalı"; the session stays for its return.
  useEffect(() => {
    const off = () => { stay.current = true; setBack(true); setView('reports'); setStatus({ kind: 'offline' }); };
    const ended = (e: Event) => { setSession(null); stay.current = false; setNotice(String((e as CustomEvent).detail ?? 'Uzak oturum kapandı.')); setView(v => v === 'manage' ? 'unlock' : v); };
    window.addEventListener(REMOTE_OFFLINE_EVENT, off); window.addEventListener(REMOTE_ENDED_EVENT, ended);
    return () => { window.removeEventListener(REMOTE_OFFLINE_EVENT, off); window.removeEventListener(REMOTE_ENDED_EVENT, ended); };
  }, []);
  const manage = () => { stay.current = false; setBack(false); setNotice(''); setView(session ? 'manage' : 'unlock'); };
  if (view === 'manage' && session) return <Suspense fallback={<Shell business={session.business} theme={r?.theme}><p className="rp-muted rp-center" aria-busy="true">Kafenin ekranları açılıyor…</p></Shell>}>
    <ManageFrame session={session} onReports={() => { stay.current = true; setView('reports'); }} />
  </Suspense>;
  const off = status.kind === 'offline', business = r?.business ?? paired.business;
  const line = live && r ? <p className="rp-status live" role="status"><span className="rp-dot" aria-hidden="true" />Canlı · {clock(r.at)}</p>
    : off ? <p className="rp-status off" role="status">Kasa bilgisayarı kapalı{r ? ` · Son durum ${when(r.at)}` : ''}</p>
    : status.kind === 'error' ? <p className="rp-status off" role="status">{r ? `${status.text?.replace(/\.$/, '')} · Son durum ${when(r.at)}` : status.text}</p>
    : <p className="rp-status" role="status" aria-busy="true">Güncelleniyor…</p>;
  return <Shell business={business} k={k} theme={r?.theme} action={<button type="button" className="rp-logout" onClick={() => setLeaving(true)}>Çıkış</button>}>
    {leaving && <Logout paired={paired} onCancel={() => setLeaving(false)} onDone={() => gone.current('Çıkış yapıldı. Bu cihaz unutuldu.')} />}
    {fresh && !back && view !== 'unlock' && <p className="rp-paired" role="status">Giriş yapıldı ✓ · {fresh.business}</p>}
    {/* The café is back after an outage during a session: one tap, nothing to type. */}
    {live && back && admin === 'on' && <div className="rp-banner back" role="status"><span><strong>Kasa açıldı</strong> · ekranlar hazır</span><button type="button" className="rp-btn small" onClick={manage}>Kafeyi yönet</button></div>}
    {view === 'unlock' && live && admin === 'on' ? <Unlock paired={current.current} notice={notice} onIn={s => { setNotice(''); setSession(s); stay.current = false; setBack(false); setView('manage'); }} onRevoked={() => gone.current(REVOKED)} onReports={() => { stay.current = true; setView('reports'); }} /> : <>
      <div className="rp-bar">{line}<button type="button" className="rp-ghost small" onClick={() => void refresh()}>Yenile</button></div>
      {admin && !(live && back) && (live && admin === 'on' ? <button type="button" className="rp-btn rp-manage" onClick={manage}>Kafeyi yönet · Satış ve Raporlar, menü, ayarlar</button>
        : live ? <p className="rp-quiet">Kafeyi yönet kapalı · kasada Ayarlar → Uzaktan erişim → Uzaktan yönetim’den açılır.</p>
        : <p className="rp-quiet">Kafeyi yönet: kasa açıkken</p>)}
      {!r ? <div className="rp-card"><p>{status.kind === 'loading' ? 'Rapor isteniyor…' : 'Henüz rapor gelmedi. Kasa bilgisayarı açılınca burada görünür.'}</p></div> : <ReportView r={r} live={live} />}
    </>}
  </Shell>;
}

/** "Kafeyi yönet" when no session is open: the password and the phone code once (until 05:00); never the e-mail again. */
function Unlock({ paired, notice, onIn, onRevoked, onReports }: { paired: Paired; notice: string; onIn: (s: RemoteSession) => void; onRevoked: () => void; onReports: () => void }) {
  const id = useId();
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const typed = password; setPassword('');
    try { const s = await openRemote(paired, typed, code); setCode(''); onIn(s); }
    catch (err) {
      setCode('');
      if (err instanceof RemoteError && ['PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(err.code)) { onRevoked(); return; }
      setError(err instanceof RemoteError ? err.message : 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.');
    } finally { setBusy(false); }
  }
  return <form className="rp-card rp-login" aria-label="Kafeyi yönet" onSubmit={e => void submit(e)}>
    <h2>Kafeyi yönet</h2>
    <p className="rp-muted">Kafenin bütün ekranları bu cihazda açılır. Güvenlik için şifrenizi ve telefon kodunu yazın; gün sonuna (05:00) kadar yeniden sorulmaz.</p>
    {notice && <p className="rp-note" role="status">{notice}</p>}
    <label htmlFor={`${id}-password`}>Şifre</label>
    <input id={`${id}-password`} type="password" value={password} maxLength={200} required autoComplete="current-password" disabled={busy} onChange={e => setPassword(e.target.value)} />
    <label htmlFor={`${id}-code`}>Telefon kodu</label>
    <input id={`${id}-code`} value={code} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="6 haneli kod" disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy || !password || code.length !== 6}>{busy ? 'Bağlanılıyor…' : 'Kafeyi yönet'}</button>
    <button type="button" className="rp-ghost" disabled={busy} onClick={onReports}>Yalnız raporlara bak</button>
  </form>;
}

/** "Çıkış": this device is forgotten here and the café drops it (Mola Merkez forgets its token even when the café is off). */
function Logout({ paired, onCancel, onDone }: { paired: Paired; onCancel: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function out() {
    setBusy(true);
    try { await call('forget', { phoneId: paired.phoneId, token: paired.token, request: await signLive(paired.privateKey, paired.cafePublic, paired.phoneId, Date.now(), 'forget') }); } catch { /* forgotten here anyway */ }
    onDone();
  }
  return <div className="rp-card rp-confirm" role="group" aria-label="Çıkış">
    <h2>Bu cihaz unutulsun mu?</h2>
    <p className="rp-muted">Raporlar ve kafenin ekranları burada bir daha açılmaz; istediğinizde yeniden giriş yaparsınız.</p>
    <div className="rp-actions"><button type="button" className="rp-btn danger" disabled={busy} onClick={() => void out()}>{busy ? 'Çıkılıyor…' : 'Evet, çıkış yap'}</button><button type="button" className="rp-ghost" disabled={busy} onClick={onCancel}>Vazgeç</button></div>
  </div>;
}

/** `live` false: the last state the café left (it is off or out of reach), labelled so, never as "Bugün". */
function ReportView({ r, live }: { r: PhoneReport; live: boolean }) {
  const t = r.today, maxDay = Math.max(1, ...r.days.map(d => d.sales)), month = r.days.reduce((a, d) => a + d.sales, 0);
  const best = r.days.reduce<{ day: string; sales: number } | null>((a, d) => !a || d.sales > a.sales ? d : a, null);
  const change = t.previous && t.previous.sales > 0 ? Math.round((t.sales - t.previous.sales) / t.previous.sales * 100) : null;
  return <div className="rp-report" aria-label="Özet">
    <section className="rp-card rp-hero" aria-label="Bugünün satışı">
      <span className="rp-label">{live ? 'Bugün' : 'Son durum'} · {dayName(r.day)}</span>
      <strong className="rp-big">{tl(t.sales)}</strong>
      {change !== null && <span className={`rp-change ${change >= 0 ? 'up' : 'down'}`}>{change >= 0 ? '▲' : '▼'} %{Math.abs(change)} · dün {t.previous!.partial ? 'aynı saate kadar ' : ''}{tl(t.previous!.sales)}</span>}
      <div className="rp-split"><div><span>Nakit</span><strong>{tl(t.cash)}</strong></div><div><span>Kart</span><strong>{tl(t.card)}</strong></div><div><span>Platform</span><strong>{tl(t.platform)}</strong></div></div>
    </section>
    <section className="rp-grid" aria-label="Günün sayıları">
      <Fact label="Sipariş" value={String(t.orders)} />
      <Fact label="Kapanan hesap" value={String(t.closedAccounts)} sub={t.closedAccounts ? `ortalama ${tl(t.averageAccount)}` : undefined} />
      <Fact label={r.reason === 'closing' ? 'Kapanışta açık kalan' : 'Açık hesap'} value={String(r.open.accounts)} sub={r.open.accounts ? tl(r.open.amount) : undefined} />
      <Fact label="Giderler" value={tl(t.expenses)} />
      <Fact label="İadeler" value={tl(t.refunds)} />
      <Fact label="İptaller" value={String(t.cancelled.count)} sub={t.cancelled.count ? tl(t.cancelled.amount) : undefined} />
    </section>
    <section className="rp-card" aria-label="En çok kazandıranlar"><h2>En çok kazandıranlar</h2>
      {r.topProducts.length ? <ol className="rp-top">{r.topProducts.slice(0, 8).map(p => <li key={p.name}><span>{p.name}</span><small>{p.unit === 'kg' && p.grams ? `${(p.grams / 1000).toLocaleString('tr-TR')} kg` : `${p.qty} adet`}</small><strong>{tl(p.amount)}</strong></li>)}</ol> : <p className="rp-muted">Bugün henüz satış yok.</p>}
    </section>
    <section className="rp-card" aria-label="Son kasa kapanışı"><h2>Son kasa kapanışı</h2>
      {r.lastClosing ? <><p className="rp-muted">{dayName(r.lastClosing.day, false)} · {clock(r.lastClosing.at)} · {r.lastClosing.byName}{r.lastClosing.extra ? ' · ek kapanış' : ''}</p>
        <ul className="rp-rows"><li><span>Sayılan</span><strong>{tl(r.lastClosing.counted)}</strong></li><li><span>Olması gereken</span><strong>{tl(r.lastClosing.expected)}</strong></li><li className={r.lastClosing.difference ? 'rp-diff' : ''}><span>Fark</span><strong>{r.lastClosing.difference > 0 ? '+' : ''}{tl(r.lastClosing.difference)}</strong></li></ul></>
        : <p className="rp-muted">Henüz kasa kapanışı yapılmadı.</p>}
    </section>
    {t.channels.length > 1 && <section className="rp-card" aria-label="Satış kanalları"><h2>Satış kanalları</h2><ul className="rp-rows">{t.channels.map(c => <li key={c.name}><span>{c.name}</span><small>{c.orders.toLocaleString('tr-TR')} sipariş</small><strong>{tl(c.amount)}</strong></li>)}</ul></section>}
    <section className="rp-card rp-wide" aria-label="Son 30 gün"><h2>Son 30 gün</h2>
      <p className="rp-month"><strong>{tl(month)}</strong>{best && best.sales > 0 && <span>En iyi gün: {dayName(best.day, false)} · {tl(best.sales)}</span>}</p>
      <div className="rp-chart" role="img" aria-label={`Son 30 günün satışı, toplam ${tl(month)}`}>{r.days.map(d => <span key={d.day} title={`${dayName(d.day, false)}: ${tl(d.sales)}`} style={{ height: `${Math.max(2, Math.round(d.sales / maxDay * 100))}%` }} />)}</div>
    </section>
  </div>;
}
function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rp-fact"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

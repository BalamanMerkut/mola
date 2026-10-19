import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { checkVerifier, localFailed, localWait, makeVerifier, plainEmail, waitText, type LocalVerifier } from '../packages/domain/local-verifier';
import { deviceKindOf, deviceLabel, newPhoneKeys, openReport, signLive, type DeviceKind, type ReportBox } from '../packages/domain/remote-crypto';
import { deviceLogin, type LoginResult } from '../packages/domain/remote-login';
import type { PhoneReport } from '../packages/domain/remote-report';
import { businessTheme } from './BusinessTheme';
import { deviceId, forgetPaired, readPaired, savePaired, type Paired } from './phoneVault';
import { dropSession, openRemote, REMOTE_ENDED_EVENT, REMOTE_OFFLINE_EVENT, RemoteError, resumeRemote, type RemoteSession } from './remoteTransport';
import './reports-phone.css';

/*
 * "İşletmemi yönet" (/yonet on Mola Merkez, 0.1.23: Raporlarım and "İşletmeyi yönet" on one page, one address; /raporlarim and
 * typed variants come here with a 301). The owner's decision: one website sign-in, nothing else to find.
 *   Giriş        not signed in on this device: "E-posta" + "Şifre" → "Devam" (the café computer checks the password at once,
 *                sealed to it; Mola Merkez never sees it) → "Telefon kodu" → "Giriş yap"; at most 3 devices ("Hangisinin
 *                yerine?"). The device makes its own key pair here (the private key never leaves this browser), names itself
 *                ("iPhone · 15 Ekim") and keeps what it needs in IndexedDB (src/phoneVault.ts; packages/domain/remote-login.ts,
 *                server/remote-reports.ts). 0.1.24: "İşletmeyi yönet" asks the same two screens (`SignIn`, one component).
 *   Kafe açık    with Uzaktan yönetim on: straight into the café's own screens (src/RemoteAdmin.tsx, sealed tunnel
 *                src/remoteTransport.ts). Right after the sign-in its one-time grant opens them; later the password and the
 *                phone code once per session (until 05:00). Without it (package or switched off): the live report.
 *   Kafe kapalı  the last report the café left at Mola Merkez (encrypted for this device) with "Kasa bilgisayarı kapalı ya da
 *                internete bağlı değil · Son durum 23:40" (19 Ekim: Merkez cannot tell the two apart); when the connection drops during a session "Bağlantı koptu" first, then that report; once it
 *                answers again "Kasa açıldı · İşletmeyi yönet" brings the screens back without typing anything.
 * Until the page knows which of these it is, only "Açılıyor…" (0.1.24: F5 on "İşletmeyi yönet" showed the report for a moment;
 * the device may see the report, so no leak, but never a flash of another view).
 * "Çıkış" (0.1.24) locks this device and keeps its keys: the e-mail and the password open it again, checked by the café
 * when it is on, else on the device (packages/domain/local-verifier.ts). "Bu cihazı tamamen kaldır" forgets it and asks the
 * café to drop it (a shared laptop). Mola Merkez only carries ciphertext.
 */
const ManageFrame = lazy(() => import('./RemoteAdmin').then(module => ({ default: module.ManageFrame })));
const API = '/api/merkez/v1/phone';
type Answer = { status: number; data: Record<string, any> };
async function call(path: string, body: unknown): Promise<Answer> {
  const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30_000) });
  let data: Record<string, any> = {}; try { data = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, data };
}
const tl = (kurus: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: kurus % 100 === 0 ? 0 : 2 }).format(kurus / 100);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const dayName = (day: string, withWeekday = true) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', ...(withWeekday ? { weekday: 'long' } : {}) });
const shortDay = (day: string, withWeekday = false) => new Date(`${day}T12:00:00Z`).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', ...(withWeekday ? { weekday: 'short' } : {}) });
const when = (iso: string) => { const d = new Date(iso), today = new Date(); const same = d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }) === today.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }); return same ? clock(iso) : `${d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' })} ${clock(iso)}`; };
const NO_NET = 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.';
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
    document.title = 'İşletmemi yönet · Mola';
    void cryptoReady().then(r => setReady(r as 'ok' | 'https' | 'old')); void readPaired().then(p => setPaired(p ?? null)).catch(() => setPaired(null));
  }, []);
  if (ready === 'checking' || paired === undefined) return <Opening />;
  if (ready !== 'ok') return <Shell><div className="rp-card rp-warn" role="alert"><h2>Bu sayfa burada açılamıyor</h2><p>{ready === 'https' ? 'İşletmemi yönet yalnız güvenli bağlantıyla (https://) açılır. Adresi https:// ile yazın ya da Mola ekibine danışın.' : 'Bu tarayıcı gereken şifrelemeyi desteklemiyor. Cihazınızı ve tarayıcınızı güncelleyip yeniden deneyin.'}</p></div></Shell>;
  if (!paired || paired.locked) return <Shell k={k} theme={paired?.last?.report.theme}><Login key={paired ? 'kilitli' : 'yeni'} notice={notice} locked={paired ?? undefined} onPaired={(p, grant) => { setNotice(''); setFresh({ business: p.business, grant }); setPaired(p); }} /></Shell>;
  return <Home paired={paired} fresh={fresh} k={k}
    onLocked={p => { setNotice('Çıkış yapıldı.'); setFresh(null); setPaired(p); }}
    onGone={why => { setNotice(why); setFresh(null); setPaired(null); void forgetPaired().catch(() => {}); }} />;
}

/** The slim header (Mola mark, "İşletmemi yönet", the business) over the owner's own screens; `theme`: the business's palette. */
function Shell({ children, business, k, action, theme }: { children: ReactNode; business?: string; k?: string | null; action?: ReactNode; theme?: PhoneReport['theme'] }) {
  return <div className="rp-shell" style={businessTheme(theme)}>
    <header className="rp-header"><div className="rp-header-in"><span className="rp-logo" aria-hidden="true">M</span><div className="rp-title"><strong>İşletmemi yönet</strong>{business && <span>{business}</span>}</div>{action}</div></header>
    <main className="rp-page">{children}</main>
    {k && <a className="rp-cafe" href={`/k/${k}?kafe=1`}>Kafedeyim, kasayı aç</a>}
    <footer className="rp-foot">Bu cihazla kasa bilgisayarı arasındaki her şey şifrelidir. Mola Merkez yalnız iletir, okuyamaz.</footer>
  </div>;
}
/** Neutral until the page knows what to show: the mark and "Açılıyor…", nothing of any view (src/App.tsx OwnerBoot alike). */
function Opening({ theme, text = 'Açılıyor…' }: { theme?: PhoneReport['theme']; text?: string }) {
  return <div className="rp-shell rp-opening" style={businessTheme(theme)} role="status" aria-busy="true"><span className="rp-logo big" aria-hidden="true">M</span><p>{text}</p></div>;
}

/**
 * The one sign-in form (0.1.24: the first sign-in, a locked device and "İşletmeyi yönet" look and work the same): "E-posta" +
 * "Şifre" → "Devam", then "Telefon kodu" → "Giriş yap". `email` without `onEmail`: shown, read-only.
 */
function SignIn({ label, intro, notice, email, onEmail, step, busy, error, onPassword, onCode, onBack, more }: {
  label: string; intro: string; notice?: string; email: string; onEmail?: (v: string) => void; step: 'password' | 'code'; busy: boolean; error: string;
  onPassword: (password: string) => void; onCode: (code: string) => void; onBack: () => void; more?: ReactNode;
}) {
  const id = useId(), [password, setPassword] = useState(''), [code, setCode] = useState(''), codeInput = useRef<HTMLInputElement>(null);
  // The code field keeps the focus (also after a wrong code: the keyboard stays up for the next one).
  useEffect(() => { if (step === 'code' && !busy) codeInput.current?.focus(); }, [step, busy]);
  if (step === 'code') return <form className="rp-card rp-login" aria-label="Telefon kodu" onSubmit={(e: FormEvent) => { e.preventDefault(); const c = code; setCode(''); onCode(c); }}>
    <p className="rp-steps" aria-hidden="true"><span className="done" /><span className="on" /></p>
    <h2>Telefon kodu</h2>
    <p className="rp-muted">Doğrulama uygulamanızdaki (Google Authenticator gibi) 6 haneli güncel kodu yazın.</p>
    {notice && <p className="rp-note" role="status">{notice}</p>}
    <label htmlFor={`${id}-code`} className="rp-sr">Telefon kodu</label>
    <input ref={codeInput} id={`${id}-code`} className="rp-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus placeholder="••••••" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy || code.length !== 6}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
    <button type="button" className="rp-ghost" disabled={busy} onClick={() => { setCode(''); onBack(); }}>Geri</button>
  </form>;
  return <form className="rp-card rp-login" aria-label={label} onSubmit={(e: FormEvent) => { e.preventDefault(); const p = password; setPassword(''); onPassword(p); }}>
    <p className="rp-steps" aria-hidden="true"><span className="on" /><span /></p>
    <h2>{label}</h2>
    <p className="rp-muted">{intro}</p>
    {notice && <p className="rp-note" role="status">{notice}</p>}
    <label htmlFor={`${id}-email`}>E-posta</label>
    <input id={`${id}-email`} type="email" inputMode="email" autoComplete="username" maxLength={120} required value={email} readOnly={!onEmail} className={onEmail ? undefined : 'rp-readonly'} disabled={busy && !!onEmail} onChange={e => onEmail?.(e.target.value)} />
    <label htmlFor={`${id}-password`}>Şifre</label>
    <input id={`${id}-password`} type="password" autoComplete="current-password" maxLength={200} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy || !email.trim() || !password}>{busy ? 'Kontrol ediliyor…' : 'Devam'}</button>
    {more}
  </form>;
}

const KIND_NAME: Record<DeviceKind | 'unknown', string> = { unknown: 'Cihaz', phone: 'Telefon', tablet: 'Tablet', computer: 'Bilgisayar' };
type Full = Extract<LoginResult, { kind: 'full' }>;
type Step = { at: 'password' } | { at: 'code'; ticket: string; cafePublic: string } | { at: 'full'; full: Full };
/** Answers that mean "the café (or Mola Merkez) is not there", not "wrong": a locked device then checks on its own. */
const OFFLINE = new Set(['CAFE_OFFLINE', 'CAFE_TIMEOUT', 'CAFE_NOT_READY', 'UNREACHABLE', 'NETWORK']);
/**
 * "Giriş yap" in two steps; checked by the café computer, never by Mola Merkez (it only carries the sealed requests).
 * `locked` (0.1.24 Çıkış): this device's record; with the café off the e-mail and the password are checked here and the
 * last report opens (no code step: the device already proved itself with its keys at its sign-in).
 */
function Login({ notice, locked, onPaired }: { notice: string; locked?: Paired; onPaired: (p: Paired, grant?: string) => void }) {
  const kind = deviceKindOf(navigator.userAgent, navigator.maxTouchPoints);
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>({ at: 'password' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The same keys through every step: the café's tickets are for this device's key.
  const keys = useRef<{ privateKey: CryptoKey; publicKey: string } | null>(null), device = useRef<string>('');
  const verifier = useRef<Promise<LocalVerifier | undefined> | null>(null), held = useRef(locked);
  const who = () => ({ name: deviceLabel(navigator.userAgent, navigator.maxTouchPoints), kind, ...(device.current ? { device: device.current } : {}) });
  async function finish(r: LoginResult) {
    if (r.kind === 'code') { setStep({ at: 'code', ticket: r.ticket, cafePublic: r.cafePublic }); if (r.message) setError(r.message); return; }
    if (r.kind === 'full') { setStep({ at: 'full', full: r }); return; }
    if (r.kind === 'error') {
      // The ticket ran out (or a page from before): back to the first screen with the reason.
      // (A wrong code without a ticket: the fifth one, the e-mail and the password again.)
      if (r.code === 'LOGIN_EXPIRED' || r.code === 'CODE_WRONG') setStep({ at: 'password' });
      setError(r.message); return;
    }
    const v = await (verifier.current ?? Promise.resolve(undefined));
    // A locked device signing in again online: the new record keeps the last report it had.
    const p: Paired = { v: 1, phoneId: r.phoneId, token: r.token, cafePublic: r.cafePublic, business: r.business, pairedAt: new Date().toISOString(), privateKey: keys.current!.privateKey, publicKey: keys.current!.publicKey,
      email: plainEmail(email), ...(v ? { verifier: v } : {}), ...(held.current?.last ? { last: held.current.last } : {}) };
    await savePaired(p); onPaired(p, r.grant);
  }
  /** `fn` gives null when it has said everything itself (the local check). */
  async function run(fn: () => Promise<LoginResult | null>) {
    setBusy(true); setError('');
    try { const r = await fn(); if (r) await finish(r); } catch { setError(NO_NET); } finally { setBusy(false); }
  }
  /** The café is off and this device is locked: the e-mail and the password against the verifier of its last sign-in. */
  async function offline(typed: string) {
    const p = held.current!, t = Date.now(), wait = localWait(p.tries, t);
    if (wait) { setError(`Çok fazla hatalı deneme. ${waitText(wait)} sonra yeniden deneyin.`); return; }
    if (!p.verifier || !p.email) { setError('Kasa bilgisayarı şu an kapalı. Bu cihaz kasa açıkken yeniden girer.'); return; }
    if (plainEmail(email) === p.email && await checkVerifier(p.verifier, typed)) {
      const open: Paired = { ...p, locked: false, tries: undefined };
      await savePaired(open); onPaired(open); return;
    }
    const tries = localFailed(p.tries, t); held.current = { ...p, tries };
    await savePaired(held.current).catch(() => {});
    const next = localWait(tries, t);
    setError(next ? `E-posta ya da şifre hatalı. ${waitText(next)} sonra yeniden deneyin.` : 'E-posta ya da şifre hatalı.');
  }
  function first(typed: string) {
    verifier.current = null;
    void run(async () => {
      keys.current = await newPhoneKeys(); device.current = await deviceId().catch(() => '');
      let r: LoginResult;
      try { r = await deviceLogin(call, keys.current, email.trim(), { password: typed, ...who() }); } catch { r = { kind: 'error', code: 'NETWORK', message: NO_NET }; }
      if (held.current && r.kind === 'error' && OFFLINE.has(r.code)) { await offline(typed); return null; }
      // The café said the password is right: the verifier for a later sign-in while it is off (never the password itself).
      if (r.kind === 'code') verifier.current = makeVerifier(typed).catch(() => undefined);
      return r;
    });
  }
  const second = (typed: string) => { if (step.at === 'code') void run(() => deviceLogin(call, keys.current!, email.trim(), { ticket: step.ticket, code: typed, ...who() }, { cafePublic: step.cafePublic })); };
  const back = () => { setStep({ at: 'password' }); setError(''); };
  if (step.at === 'full') return <div className="rp-card rp-login" role="group" aria-label="Hangi cihazın yerine?">
    <h2>{step.full.message}</h2>
    <p className="rp-muted">Seçtiğiniz cihazın bağlantısı kalkar; bu cihaz onun yerine geçer.</p>
    <ul className="rp-replace">{step.full.devices.map(d => <li key={d.id}><button type="button" className="rp-choice" disabled={busy} onClick={() => void run(() => deviceLogin(call, keys.current!, email.trim(), { ticket: step.full.ticket, replace: d.id, ...who() }, { cafePublic: step.full.cafePublic }))}>
      <strong>{d.name}</strong><small>{KIND_NAME[d.kind ?? 'unknown']} · {d.lastSeenAt ? `Son rapor: ${when(d.lastSeenAt)}` : 'Henüz rapor almadı'}</small></button></li>)}</ul>
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="button" className="rp-ghost" disabled={busy} onClick={back}>Vazgeç</button>
  </div>;
  return <SignIn label="Giriş yap" step={step.at} busy={busy} error={error} notice={step.at === 'password' ? notice : undefined} email={email} onEmail={setEmail}
    intro={locked ? 'Bu cihaz hatırlanıyor. E-posta ve şifrenizle girin.' : 'İşletme sahibi e-postanız ve şifrenizle bir kez girin; bu cihaz hatırlanır.'}
    onPassword={first} onCode={second} onBack={back}
    more={<p className="rp-muted rp-small">{locked ? 'Kasa bilgisayarı kapalıyken de girebilirsiniz; son durum açılır.' : 'Kasa bilgisayarı açık olmalı. E-posta ve telefon kodu kasada Ayarlar → Uzaktan erişim’de kurulur.'}</p>} />;
}

type Shown = { report: PhoneReport; kind: 'live' | 'snapshot' };
/** Never back to an older report than the one on screen (a stale postbox box after a live answer). */
const newer = (a: Shown | undefined, b: Shown) => !a || Date.parse(b.report.at) >= Date.parse(a.report.at);
type Status = { kind: 'live' | 'offline' | 'error' | 'loading'; text?: string };
type View = 'reports' | 'manage' | 'unlock';
const REVOKED = 'Bu cihazın bağlantısı kaldırıldı. Yeniden giriş yapabilirsiniz.';

/** A signed-in device: the café's full screens when it is on and Uzaktan yönetim is on, else the report (live or the last). */
function Home({ paired, fresh, k, onGone, onLocked }: { paired: Paired; fresh: { business: string; grant?: string } | null; k: string | null; onGone: (why: string) => void; onLocked: (p: Paired) => void }) {
  const [shown, setShown] = useState<Shown | undefined>(paired.last), [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [session, setSession] = useState<RemoteSession | null>(null), [resumed, setResumed] = useState(false);
  const [view, setView] = useState<View>('reports'), [notice, setNotice] = useState(''), [back, setBack] = useState(false), [dropped, setDropped] = useState(false);
  const gone = useRef(onGone); gone.current = onGone;
  // The owner chose the reports (or the café went off during a session): no jumping back into the screens by itself.
  const stay = useRef(false), grant = useRef(fresh?.grant), shownView = useRef(view); shownView.current = view;
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
    if (g) { grant.current = undefined; void openRemote(current.current, { grant: g }).then(s => { setSession(s); setView('manage'); }, () => setView('unlock')); return; }
    setView('unlock');
  }, [resumed, live, admin, session, view]);
  /** The last report, "Kasa bilgisayarı kapalı ya da internete bağlı değil"; the session stays for the café's return ("Kasa açıldı · İşletmeyi yönet"). */
  const toReports = useCallback(() => { stay.current = true; setDropped(false); setBack(true); setView('reports'); setStatus({ kind: 'offline' }); }, []);
  useEffect(() => {
    // In the screens: "Bağlantı koptu" over them first (whatever was being saved did not reach the café), then the report.
    const off = () => { if (shownView.current === 'manage') setDropped(true); else toReports(); };
    const ended = (e: Event) => { setSession(null); setDropped(false); stay.current = false; setNotice(String((e as CustomEvent).detail ?? 'Uzak oturum kapandı.')); setView(v => v === 'manage' ? 'unlock' : v); };
    window.addEventListener(REMOTE_OFFLINE_EVENT, off); window.addEventListener(REMOTE_ENDED_EVENT, ended);
    return () => { window.removeEventListener(REMOTE_OFFLINE_EVENT, off); window.removeEventListener(REMOTE_ENDED_EVENT, ended); };
  }, [toReports]);
  useEffect(() => { if (!dropped) return; const t = setTimeout(toReports, 2000); return () => clearTimeout(t); }, [dropped, toReports]);
  /** "İşletmeyi yönet" confirmed the password: the verifier for a sign-in while the café is off (and the e-mail, if new here). */
  const verified = useCallback((email: string, v: Promise<LocalVerifier | undefined>) => {
    void v.then(async verifier => { if (!verifier) return; current.current = { ...current.current, verifier, email: current.current.email ?? plainEmail(email) }; try { await savePaired(current.current); } catch { /* next time */ } });
  }, []);
  const manage = () => { stay.current = false; setBack(false); setNotice(''); setView(session ? 'manage' : 'unlock'); };
  // Until the page knows what this device is to see (a reload on "İşletmeyi yönet", a session, the café's state): only the
  // neutral opening, never a flash of the report before the sign-in or the screens.
  if (!resumed || status.kind === 'loading' || (view === 'reports' && live && admin === 'on' && !stay.current)) return <Opening theme={r?.theme} />;
  if (view === 'manage' && session) return <>
    <Suspense fallback={<Opening theme={r?.theme} text="Kafenin ekranları açılıyor…" />}><ManageFrame session={session} onReports={() => { stay.current = true; setView('reports'); }} /></Suspense>
    {dropped && <div className="rp-shell rp-drop" style={businessTheme(r?.theme)} role="alertdialog" aria-modal="true" aria-label="Bağlantı koptu">
      <div className="rp-card rp-drop-card"><span className="rp-drop-mark" aria-hidden="true">!</span><h2>Bağlantı koptu</h2>
        <p>Kasa bilgisayarı kapalı ya da internete bağlı değil. Değişiklik kaydedilemedi.</p>
        <button type="button" className="rp-btn" autoFocus onClick={toReports}>Raporlara git</button>
        <p className="rp-muted rp-small">Son durum birkaç saniye içinde açılır.</p></div>
    </div>}
  </>;
  const off = status.kind === 'offline', business = r?.business ?? paired.business;
  const line = live && r ? <p className="rp-status live" role="status"><span className="rp-dot" aria-hidden="true" />Canlı · {clock(r.at)}</p>
    : off ? <p className="rp-status off" role="status">Kasa bilgisayarı kapalı ya da internete bağlı değil{r ? ` · Son durum ${when(r.at)}` : ''}</p>
    : status.kind === 'error' ? <p className="rp-status off" role="status">{r ? `${status.text?.replace(/\.$/, '')} · Son durum ${when(r.at)}` : status.text}</p>
    : <p className="rp-status" role="status" aria-busy="true">Güncelleniyor…</p>;
  return <Shell business={business} k={k} theme={r?.theme} action={<button type="button" className="rp-logout" onClick={() => setLeaving(true)}>Çıkış</button>}>
    {leaving && <Logout current={() => current.current} onCancel={() => setLeaving(false)} onLocked={onLocked} onForgotten={() => gone.current('Bu cihaz kaldırıldı. Yeniden giriş yapabilirsiniz.')} />}
    {fresh && !back && view !== 'unlock' && <p className="rp-paired" role="status">Giriş yapıldı ✓ · {fresh.business}</p>}
    {/* The café is back after an outage during a session: one tap, nothing to type. */}
    {live && back && admin === 'on' && <div className="rp-banner back" role="status"><span><strong>Kasa açıldı</strong> · ekranlar hazır</span><button type="button" className="rp-btn small" onClick={manage}>İşletmeyi yönet</button></div>}
    {view === 'unlock' && live && admin === 'on' ? <Unlock paired={current.current} steps={r?.adminSteps === 2 ? 2 : 1} notice={notice} onVerified={verified} onIn={s => { setNotice(''); setSession(s); stay.current = false; setBack(false); setView('manage'); }} onRevoked={() => gone.current(REVOKED)} onReports={() => { stay.current = true; setView('reports'); }} /> : <>
      <div className="rp-bar">{line}<button type="button" className="rp-ghost small" onClick={() => void refresh()}>Yenile</button></div>
      {admin && !(live && back) && (live && admin === 'on' ? <button type="button" className="rp-btn rp-manage" onClick={manage}>İşletmeyi yönet · Satış ve Raporlar, menü, ayarlar</button>
        : live ? <p className="rp-quiet">İşletmeyi yönet kapalı · kasada Ayarlar → Uzaktan erişim → Uzaktan yönetim’den açılır.</p>
        : <p className="rp-quiet">İşletmeyi yönet: kasa açıkken</p>)}
      {!r ? <div className="rp-card rp-empty"><p>Henüz rapor gelmedi. Kasa bilgisayarı açılınca burada görünür.</p></div> : <ReportView r={r} live={live} />}
    </>}
  </Shell>;
}

/**
 * "İşletmeyi yönet" when no session is open: the same two screens as the sign-in, the e-mail shown (never typed again), until
 * 05:00. `steps` 2: the café checks the password at once (0.1.24); 1: an older café, the password waits for the code and
 * both go together.
 */
function Unlock({ paired, steps, notice, onIn, onRevoked, onReports, onVerified }: { paired: Paired; steps: 1 | 2; notice: string; onIn: (s: RemoteSession) => void; onRevoked: () => void; onReports: () => void; onVerified: (email: string, v: Promise<LocalVerifier | undefined>) => void }) {
  const [email, setEmail] = useState(paired.email ?? ''), [step, setStep] = useState<'password' | 'code'>('password'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ticket = useRef(''), typed = useRef('');
  async function attempt(proof: Parameters<typeof openRemote>[1], password?: string) {
    setBusy(true); setError('');
    try {
      const s = await openRemote(paired, proof);
      if (password) onVerified(email, makeVerifier(password).catch(() => undefined));
      typed.current = ''; onIn(s);
    } catch (err) {
      if (err instanceof RemoteError && ['PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(err.code)) { onRevoked(); return; }
      if (err instanceof RemoteError && err.code === 'NEED_CODE' && err.ticket) {
        // The café said the password is right (step 1): the verifier for a sign-in while it is off; the code next.
        ticket.current = err.ticket; if (password) onVerified(email, makeVerifier(password).catch(() => undefined));
        setStep('code'); return;
      }
      if (err instanceof RemoteError && err.code === 'CODE_WRONG' && err.ticket) { ticket.current = err.ticket; setError(err.message); return; }
      // Anything else: the first screen again with the reason (a wrong password, the ticket ran out, too many tries).
      typed.current = ''; ticket.current = ''; setStep('password');
      setError(err instanceof RemoteError ? err.message : NO_NET);
    } finally { setBusy(false); }
  }
  const password = (p: string) => { if (steps === 2) void attempt({ password: p }, p); else { typed.current = p; setError(''); setStep('code'); } };
  const code = (c: string) => void (steps === 2 ? attempt({ ticket: ticket.current, code: c }) : attempt({ password: typed.current, code: c }, typed.current));
  return <SignIn label="İşletmeyi yönet" step={step} busy={busy} error={error} notice={step === 'password' ? notice : undefined} email={email} onEmail={paired.email ? undefined : setEmail}
    intro="Kafenin bütün ekranları bu cihazda açılır. Gün sonuna (05:00) kadar yeniden sorulmaz."
    onPassword={password} onCode={code} onBack={() => { typed.current = ''; ticket.current = ''; setError(''); setStep('password'); }}
    more={<button type="button" className="rp-ghost" disabled={busy} onClick={onReports}>Yalnız raporlara bak</button>} />;
}

/**
 * "Çıkış" (0.1.24): this device is locked and remembered (the e-mail and the password open it again, also with the café
 * off). "Bu cihazı tamamen kaldır": forgotten here and the café drops it (Mola Merkez forgets its token even when it is off).
 */
function Logout({ current, onCancel, onLocked, onForgotten }: { current: () => Paired; onCancel: () => void; onLocked: (p: Paired) => void; onForgotten: () => void }) {
  const [busy, setBusy] = useState(false), [forget, setForget] = useState(false);
  async function lock() {
    setBusy(true); await dropSession().catch(() => {});
    const p: Paired = { ...current(), locked: true };
    try { await savePaired(p); } catch { /* locked on screen; the reload asks again */ }
    onLocked(p);
  }
  async function out() {
    setBusy(true); await dropSession().catch(() => {});
    const p = current();
    try { await call('forget', { phoneId: p.phoneId, token: p.token, request: await signLive(p.privateKey, p.cafePublic, p.phoneId, Date.now(), 'forget') }); } catch { /* forgotten here anyway */ }
    onForgotten();
  }
  if (forget) return <div className="rp-card rp-confirm" role="group" aria-label="Bu cihazı kaldır">
    <h2>Bu cihaz tamamen kaldırılsın mı?</h2>
    <p className="rp-muted">Bu cihaz unutulur ve kasadaki listeden çıkar. Yeniden girmek için e-posta, şifre ve telefon kodu gerekir.</p>
    <div className="rp-actions"><button type="button" className="rp-btn danger" disabled={busy} onClick={() => void out()}>{busy ? 'Kaldırılıyor…' : 'Evet, kaldır'}</button><button type="button" className="rp-ghost" disabled={busy} onClick={() => setForget(false)}>Vazgeç</button></div>
  </div>;
  return <div className="rp-card" role="group" aria-label="Çıkış">
    <h2>Çıkış yapılsın mı?</h2>
    <p className="rp-muted">Çıkış yapınca bu cihaz hatırlanır; yeniden girmek için e-posta ve şifreniz yeter.</p>
    <div className="rp-actions"><button type="button" className="rp-btn" disabled={busy} onClick={() => void lock()}>{busy ? 'Çıkılıyor…' : 'Evet, çıkış yap'}</button><button type="button" className="rp-ghost" disabled={busy} onClick={onCancel}>Vazgeç</button></div>
    <button type="button" className="rp-link" disabled={busy} onClick={() => setForget(true)}>Bu cihazı tamamen kaldır</button>
  </div>;
}

// ---------- The report ----------
const PAYMENTS = [['cash', 'Nakit'], ['card', 'Kart'], ['platform', 'Platform']] as const;
const pct = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
/** `live` false: the last state the café left (it is off or out of reach), labelled so, never as "Bugün". */
function ReportView({ r, live }: { r: PhoneReport; live: boolean }) {
  const t = r.today, prev = t.previous, empty = t.sales === 0 && t.orders === 0;
  const change = prev && prev.sales > 0 ? Math.round((t.sales - prev.sales) / prev.sales * 100) : null;
  const paid = t.cash + t.card + t.platform, top = r.topProducts.slice(0, 8), topMax = Math.max(1, ...top.map(p => p.amount));
  const channelMax = Math.max(1, ...t.channels.map(c => c.amount));
  return <div className="rp-report" aria-label="Özet">
    <section className="rp-card rp-hero" aria-label="Bugünün satışı">
      <span className="rp-label">{live ? 'Bugün' : 'Son durum'} · {dayName(r.day)}</span>
      <strong className="rp-big">{tl(t.sales)}</strong>
      {empty ? <span className="rp-change">Bugün henüz satış yok</span>
        : prev && <span className={`rp-change${change === null ? '' : change >= 0 ? ' up' : ' down'}`}>{change !== null && <b>{change >= 0 ? '▲' : '▼'} %{Math.abs(change)}</b>}{`dün ${prev.partial ? 'aynı saate kadar ' : ''}${prev.sales ? tl(prev.sales) : 'satış yoktu'}`}</span>}
      <dl className="rp-hero-stats">
        <div><dt>Sipariş</dt><dd>{t.orders.toLocaleString('tr-TR')}</dd></div>
        <div><dt>Kapanan hesap</dt><dd>{t.closedAccounts.toLocaleString('tr-TR')}</dd></div>
        <div><dt>Ortalama hesap</dt><dd>{t.closedAccounts ? tl(t.averageAccount) : '—'}</dd></div>
      </dl>
    </section>
    {/* Two columns on a laptop (each its own stack, no gaps under the shorter card); one column on a phone in `order`. */}
    <div className="rp-side">
    <section className="rp-card rp-o1" aria-label="Ödemeler"><h2>Ödemeler</h2>
      {paid ? <>
        <div className="rp-stack" role="img" aria-label={PAYMENTS.map(([key, name]) => `${name} ${tl(t[key])}`).join(', ')}>{PAYMENTS.filter(([key]) => t[key] > 0).map(([key]) => <span key={key} className={`rp-pay-${key}`} style={{ flexGrow: t[key] }} />)}</div>
        <ul className="rp-legend">{PAYMENTS.map(([key, name]) => <li key={key}><i className={`rp-pay-${key}`} aria-hidden="true" /><span>{name}</span><small>%{pct(t[key], paid)}</small><strong>{tl(t[key])}</strong></li>)}</ul>
      </> : <p className="rp-empty-line">Bugün henüz ödeme alınmadı.</p>}
    </section>
    </div><div className="rp-side">
    <section className="rp-grid rp-o2" aria-label="Günün sayıları">
      <Fact label={r.reason === 'closing' ? 'Kapanışta açık kalan' : 'Açık hesap'} value={String(r.open.accounts)} sub={r.open.accounts ? tl(r.open.amount) : undefined} />
      <Fact label="Giderler" value={tl(t.expenses)} />
      <Fact label="İadeler" value={tl(t.refunds)} />
      <Fact label="İptaller" value={String(t.cancelled.count)} sub={t.cancelled.count ? tl(t.cancelled.amount) : undefined} />
    </section>
    </div><div className="rp-side">
    <section className="rp-card rp-o3" aria-label="En çok kazandıranlar"><h2>En çok kazandıranlar</h2>
      {top.length ? <ol className="rp-rank">{top.map((p, i) => <li key={p.name}><span className="rp-rank-n">{i + 1}</span>
        <div className="rp-rank-main"><div className="rp-rank-line"><span>{p.name}</span><strong>{tl(p.amount)}</strong></div>
          <div className="rp-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, p.amount / topMax * 100)}%` }} /></div>
          <small>{p.unit === 'kg' && p.grams ? `${(p.grams / 1000).toLocaleString('tr-TR')} kg` : `${p.qty.toLocaleString('tr-TR')} adet`}</small></div></li>)}</ol>
        : <p className="rp-empty-line">Bugün henüz satış yok.</p>}
    </section>
    </div><div className="rp-side">
    {t.channels.length > 1 && <section className="rp-card rp-o4" aria-label="Satış kanalları"><h2>Satış kanalları</h2>
      <ul className="rp-rank plain">{t.channels.map(c => <li key={c.name}><div className="rp-rank-main"><div className="rp-rank-line"><span>{c.name}</span><strong>{tl(c.amount)}</strong></div>
        <div className="rp-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, c.amount / channelMax * 100)}%` }} /></div><small>{c.orders.toLocaleString('tr-TR')} sipariş</small></div></li>)}</ul></section>}
    <section className="rp-card rp-o5" aria-label="Son kasa kapanışı"><h2>Son kasa kapanışı</h2>
      {r.lastClosing ? <><p className="rp-muted">{dayName(r.lastClosing.day, false)} · {clock(r.lastClosing.at)} · {r.lastClosing.byName}{r.lastClosing.extra ? ' · ek kapanış' : ''}</p>
        <ul className="rp-rows"><li><span>Sayılan</span><strong>{tl(r.lastClosing.counted)}</strong></li><li><span>Olması gereken</span><strong>{tl(r.lastClosing.expected)}</strong></li><li className={r.lastClosing.difference ? 'rp-diff' : 'rp-even'}><span>Fark</span><strong>{r.lastClosing.difference > 0 ? '+' : r.lastClosing.difference < 0 ? '−' : ''}{tl(Math.abs(r.lastClosing.difference))}</strong></li></ul></>
        : <p className="rp-empty-line">Henüz kasa kapanışı yapılmadı.</p>}
    </section>
    </div>
    <MonthChart days={r.days} live={live} />
  </div>;
}
function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rp-fact"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

/**
 * "Son 30 gün": one bar a day (plain SVG at the card's real width, so the text is never stretched), the daily average as a
 * dashed line, a date every week under the bars. Hover, tap or the arrow keys show a day's value above its bar.
 */
function MonthChart({ days, live }: { days: PhoneReport['days']; live: boolean }) {
  const box = useRef<HTMLDivElement>(null), [width, setWidth] = useState(320), [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.clientWidth)));
    measure();
    const o = new ResizeObserver(measure); o.observe(el);
    return () => o.disconnect();
  }, []);
  const n = days.length, total = days.reduce((a, d) => a + d.sales, 0);
  // The average from the first day with a sale (a café that started 10 days ago is not "₺300 a day" over 30).
  const from = days.findIndex(d => d.sales > 0), average = from >= 0 ? Math.round(total / (n - from) / 100) * 100 : 0;
  const best = days.reduce<{ day: string; sales: number } | null>((a, d) => !a || d.sales > a.sales ? d : a, null);
  const max = Math.max(1, best?.sales ?? 0), H = 150, top = 14, bottom = 22, plot = H - top - bottom;
  const gap = width < 480 ? 2 : 3, bar = Math.max(2, (width - gap * (n - 1)) / Math.max(1, n));
  const x = (i: number) => i * (bar + gap), y = (v: number) => top + plot - v / max * plot;
  const labels = [n - 1, n - 8, n - 15, n - 22, n - 29].filter(i => i >= 0);
  const p = pick !== null ? days[pick] : undefined;
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPick(i => Math.min(n - 1, Math.max(0, (i ?? n) + (e.key === 'ArrowLeft' ? -1 : 1)))); }
    else if (e.key === 'Escape') setPick(null);
  };
  return <section className="rp-card rp-wide" aria-label="Son 30 gün"><h2>Son 30 gün</h2>
    <div className="rp-month"><div><span>Toplam</span><strong>{tl(total)}</strong></div><div><span><i className="rp-avg-key" aria-hidden="true" />Günlük ortalama</span><strong>{tl(average)}</strong></div>
      {best && best.sales > 0 && <div><span>En iyi gün</span><strong>{tl(best.sales)}</strong><small>{shortDay(best.day, true)}</small></div>}</div>
    {total === 0 ? <p className="rp-empty-line">Son 30 günde satış yok.</p> :
      <div ref={box} className="rp-chart" tabIndex={0} role="group" aria-label={`Son 30 günün satışı, toplam ${tl(total)}. Günleri ok tuşlarıyla gezin.`} onKeyDown={key} onBlur={() => setPick(null)}>
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`Günlük satış, en yüksek ${tl(max)}`} onPointerLeave={e => { if (e.pointerType === 'mouse') setPick(null); }}>
          {days.map((d, i) => {
            const h = d.sales > 0 ? Math.max(2, y(0) - y(d.sales)) : 0, r = Math.min(3, bar / 2), x0 = x(i), y0 = y(0) - h;
            const cls = `rp-col${pick === i ? ' on' : pick === null && i === n - 1 ? ' last' : ''}`;
            return <g key={d.day} className={cls}>
              {h ? <path d={`M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bar - r}Q${x0 + bar},${y0} ${x0 + bar},${y0 + r}V${y(0)}Z`} /> : <rect className="zero" x={x0} y={y(0) - 2} width={bar} height={2} />}
            </g>;
          })}
          {/* The average: a dashed line, named by its key above ("Günlük ortalama"), so no label sits on the bars. */}
          {average > 0 && <line className="rp-avg" x1={0} x2={width} y1={y(average)} y2={y(average)} />}
          <line className="rp-axis" x1={0} x2={width} y1={y(0) + 0.5} y2={y(0) + 0.5} />
          {labels.map(i => <text key={i} className="rp-tick" x={i === n - 1 ? width : Math.max(0, x(i) + bar / 2)} y={H - 6} textAnchor={i === n - 1 ? 'end' : x(i) < 24 ? 'start' : 'middle'}>{i === n - 1 && live ? 'Bugün' : shortDay(days[i].day)}</text>)}
          {/* Hit areas: the whole column, wider than the bar. */}
          {days.map((d, i) => <rect key={`hit-${d.day}`} className="rp-hit" x={x(i) - gap / 2} y={0} width={bar + gap} height={H} onPointerEnter={e => { if (e.pointerType === 'mouse') setPick(i); }} onClick={() => setPick(i)}><title>{`${shortDay(d.day, true)}: ${tl(d.sales)}`}</title></rect>)}
        </svg>
        {p && <div className="rp-tip" role="status" style={{ left: Math.min(width - 70, Math.max(70, x(pick!) + bar / 2)), top: Math.max(0, y(p.sales) - 8) }}><small>{shortDay(p.day, true)}</small><strong>{tl(p.sales)}</strong></div>}
      </div>}
  </section>;
}

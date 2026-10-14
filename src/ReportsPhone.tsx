import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { deviceKindOf, deviceNameOf, newPhoneKeys, openReport, signLive, type DeviceKind, type ReportBox } from '../packages/domain/remote-crypto';
import { deviceLogin, type LoginResult } from '../packages/domain/remote-login';
import type { PhoneReport } from '../packages/domain/remote-report';
import { forgetPaired, readPaired, savePaired, type Paired } from './phoneVault';

/*
 * "Raporlarım" (served by Mola Merkez; read only). 0.1.22, the owner's decision: one website sign-in. A device that is not
 * paired shows "Giriş yap": the business's verified owner e-mail, the owner's password, the 6-digit phone code and a name for
 * this device. The device makes its own key pair here (the private key never leaves this browser), seals the password and
 * the code to the café computer, which checks them (packages/domain/remote-login.ts, server/remote-reports.ts), and keeps
 * what it needs in IndexedDB (src/phoneVault.ts), in whatever browser or Home Screen icon the owner uses. "Çıkış" forgets
 * this device here and asks the café to drop it (a shared laptop).
 * Reports: asked live from the café computer through Mola Merkez and opened here (packages/domain/remote-crypto.ts); while the
 * café computer is off, the last encrypted snapshot it left at Mola Merkez. Mola Merkez only carries ciphertext.
 */
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

/** The permanent link's code this page came through (/k/<kod> → /raporlarim#k=<kod>), kept for this tab: "Kafedeyim, kasayı aç". */
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

export function ReportsPhone() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'https' | 'old'>('checking');
  const [paired, setPaired] = useState<Paired | null | undefined>(undefined);
  const [k] = useState(readStart), [notice, setNotice] = useState(''), [justPaired, setJustPaired] = useState('');
  useEffect(() => { void cryptoReady().then(r => setReady(r as 'ok' | 'https' | 'old')); void readPaired().then(p => setPaired(p ?? null)).catch(() => setPaired(null)); }, []);
  if (ready === 'checking' || paired === undefined) return <Shell><p className="rp-muted" aria-busy="true">Açılıyor…</p></Shell>;
  if (ready !== 'ok') return <Shell><div className="rp-card rp-warn" role="alert"><h2>Bu sayfa burada açılamıyor</h2><p>{ready === 'https' ? 'Raporlarım yalnız güvenli bağlantıyla (https://) açılır. Adresi https:// ile yazın ya da Mola ekibine danışın.' : 'Bu tarayıcı gereken şifrelemeyi desteklemiyor. Cihazınızı ve tarayıcınızı güncelleyip yeniden deneyin.'}</p></div></Shell>;
  if (!paired) return <Shell k={k}><Login notice={notice} onPaired={p => { setNotice(''); setJustPaired(p.business); setPaired(p); }} /></Shell>;
  return <Reports paired={paired} justPaired={justPaired} k={k} onGone={why => { setNotice(why); setJustPaired(''); setPaired(null); void forgetPaired().catch(() => {}); }} />;
}

/** `k`: the permanent link's code, for "Kafedeyim, kasayı aç" (the same link, told to open the café computer). */
function Shell({ children, business, k, action }: { children: ReactNode; business?: string; k?: string | null; action?: ReactNode }) {
  return <div className="rp-page"><header className="rp-head"><span className="rp-logo" aria-hidden="true">M</span><div><strong>Raporlarım</strong>{business && <span>{business}</span>}</div>{action}</header><main>{children}</main>
    {k && <a className="rp-cafe" href={`/k/${k}?kafe=1`}>Kafedeyim, kasayı aç</a>}
    <footer className="rp-foot">Raporlar kafe bilgisayarında yalnız bu cihaz için şifrelenir. Mola Merkez yalnız iletir, okuyamaz.</footer></div>;
}

const KIND_NAME: Record<DeviceKind | 'unknown', string> = { unknown: 'Cihaz', phone: 'Telefon', tablet: 'Tablet', computer: 'Bilgisayar' };
type Full = Extract<LoginResult, { kind: 'full' }>;
/** "Giriş yap": checked by the café computer, never by Mola Merkez (it only carries the sealed request). */
function Login({ notice, onPaired }: { notice: string; onPaired: (p: Paired) => void }) {
  const id = useId(), kind = deviceKindOf(navigator.userAgent, navigator.maxTouchPoints);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [name, setName] = useState(() => deviceNameOf(navigator.userAgent, navigator.maxTouchPoints));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [full, setFull] = useState<Full | null>(null);
  // The same keys for "Hangisinin yerine?": the café's ticket is for this device's key.
  const keys = useRef<{ privateKey: CryptoKey; publicKey: string } | null>(null);
  async function finish(r: LoginResult) {
    if (r.kind === 'full') { setFull(r); return; }
    if (r.kind === 'error') { setError(r.message); return; }
    const p: Paired = { v: 1, phoneId: r.phoneId, token: r.token, cafePublic: r.cafePublic, business: r.business, pairedAt: new Date().toISOString(), privateKey: keys.current!.privateKey, publicKey: keys.current!.publicKey };
    await savePaired(p); onPaired(p);
  }
  async function run(fn: () => Promise<LoginResult>) {
    setBusy(true); setError('');
    try { await finish(await fn()); } catch { setError('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.'); } finally { setBusy(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault(); setFull(null);
    const typed = { password, code: code.replace(/\D/g, '') }; setPassword(''); setCode('');
    void run(async () => { keys.current = await newPhoneKeys(); return deviceLogin(call, keys.current, email.trim(), { ...typed, name: name.trim(), kind }); });
  }
  if (full) return <div className="rp-card rp-login" role="group" aria-label="Hangi cihazın yerine?">
    <h2>{full.message}</h2>
    <p className="rp-muted">Seçtiğiniz cihazın bağlantısı kalkar; bu cihaz onun yerine geçer.</p>
    <ul className="rp-replace">{full.devices.map(d => <li key={d.id}><button type="button" className="rp-choice" disabled={busy} onClick={() => void run(() => deviceLogin(call, keys.current!, email.trim(), { ticket: full.ticket, replace: d.id, name: name.trim(), kind }, { cafePublic: full.cafePublic }))}>
      <strong>{d.name}</strong><small>{KIND_NAME[d.kind ?? 'unknown']} · {d.lastSeenAt ? `Son rapor: ${when(d.lastSeenAt)}` : 'Henüz rapor almadı'}</small></button></li>)}</ul>
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="button" className="rp-refresh" disabled={busy} onClick={() => { setFull(null); setError(''); }}>Vazgeç</button>
  </div>;
  return <form className="rp-card rp-login" onSubmit={submit} aria-label="Giriş yap">
    <h2>Giriş yap</h2>
    <p className="rp-muted">İşletme sahibi bilgilerinizle bir kez girin; bu cihaz hatırlanır.</p>
    {notice && <p className="rp-note" role="status">{notice}</p>}
    <label htmlFor={`${id}-email`}>E-posta</label>
    <input id={`${id}-email`} type="email" inputMode="email" autoComplete="username" maxLength={120} required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
    <label htmlFor={`${id}-password`}>Şifre</label>
    <input id={`${id}-password`} type="password" autoComplete="current-password" maxLength={200} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
    <label htmlFor={`${id}-code`}>Telefon kodu</label>
    <input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="6 haneli kod" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    <small>Doğrulama uygulamanızdaki güncel kod.</small>
    <label htmlFor={`${id}-name`}>Bu cihazın adı</label>
    <input id={`${id}-name`} maxLength={40} required autoComplete="off" value={name} disabled={busy} onChange={e => setName(e.target.value)} />
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy || !email.trim() || !password || code.length !== 6 || !name.trim()}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}</button>
    <p className="rp-muted rp-small">Kasa bilgisayarı açık olmalı. E-posta ve telefon kodu kasada Ayarlar → Uzaktan erişim’de kurulur.</p>
  </form>;
}

type Shown = { report: PhoneReport; kind: 'live' | 'snapshot' };
/** Never back to an older report than the one on screen (a stale postbox box after a live answer). */
const newer = (a: Shown | undefined, b: Shown) => !a || Date.parse(b.report.at) >= Date.parse(a.report.at);

const REVOKED = 'Bu cihazın bağlantısı kaldırıldı. Yeniden giriş yapabilirsiniz.';
function Reports({ paired, justPaired, k, onGone }: { paired: Paired; justPaired: string; k: string | null; onGone: (why: string) => void }) {
  const [shown, setShown] = useState<Shown | undefined>(paired.last), [leaving, setLeaving] = useState(false);
  const gone = useRef(onGone); gone.current = onGone;
  const onRevoked = useCallback(() => gone.current(REVOKED), []);
  const [status, setStatus] = useState<{ kind: 'live' | 'offline' | 'error' | 'loading'; text?: string }>({ kind: 'loading' });
  const busy = useRef(false), current = useRef(paired);
  const keep = useCallback(async (next: Shown) => {
    setShown(prev => newer(prev, next) ? next : prev);
    if (newer(current.current.last, next)) { current.current = { ...current.current, last: next }; try { await savePaired(current.current); } catch { /* shown anyway */ } }
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    const p = current.current;
    try {
      const q = await signLive(p.privateKey, p.cafePublic, p.phoneId);
      const live = await call('live', { phoneId: p.phoneId, token: p.token, request: q });
      if (live.status === 403 && ['PHONE_UNKNOWN', 'PHONE_REVOKED'].includes(live.data.code)) { onRevoked(); return; }
      if (live.status === 200 && live.data.box) {
        const report = await openReport<PhoneReport>(p.privateKey, p.cafePublic, live.data.box as ReportBox, { phone: p.phoneId, ref: q.nonce, kind: 'live' });
        await keep({ report, kind: 'live' }); setStatus({ kind: 'live' }); return;
      }
      if (live.status === 200 && live.data.offline) {
        // The café computer is off: the last snapshot it left at Mola Merkez (handed over once; this phone keeps it).
        const box = await call('postbox', { phoneId: p.phoneId, token: p.token });
        if (box.status === 403) { onRevoked(); return; }
        if (box.status === 200 && box.data.box) await keep({ report: await openReport<PhoneReport>(p.privateKey, p.cafePublic, box.data.box as ReportBox, { phone: p.phoneId, kind: 'snapshot' }), kind: 'snapshot' });
        setStatus({ kind: 'offline' }); return;
      }
      setStatus({ kind: 'error', text: live.data.message ?? 'Kafe bilgisayarı şu an yanıt vermedi.' });
    } catch { setStatus({ kind: 'error', text: 'İnternet bağlantısı yok ya da Mola Merkez’e ulaşılamadı.' }); }
    finally { busy.current = false; }
  }, [keep, onRevoked]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    const back = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [refresh]);
  const r = shown?.report;
  const line = status.kind === 'live' && r ? <p className="rp-status live" role="status"><span className="rp-dot" aria-hidden="true" />Canlı · {clock(r.at)}</p>
    : status.kind === 'offline' ? <p className="rp-status off" role="status">Kafe bilgisayarı kapalı{r ? ` · Son durum ${when(r.at)}` : ''}</p>
    : status.kind === 'error' ? <p className="rp-status off" role="status">{status.text}{r ? ` · Son durum ${when(r.at)}` : ''}</p>
    : <p className="rp-status" role="status" aria-busy="true">Güncelleniyor…</p>;
  return <Shell business={r?.business ?? paired.business} k={k} action={<button type="button" className="rp-logout" onClick={() => setLeaving(true)}>Çıkış</button>}>
    {leaving && <Logout paired={paired} onCancel={() => setLeaving(false)} onDone={() => gone.current('Çıkış yapıldı. Bu cihaz unutuldu.')} />}
    {justPaired && <p className="rp-paired" role="status">Giriş yapıldı ✓ · {justPaired}</p>}
    <div className="rp-bar">{line}<button type="button" className="rp-refresh" onClick={() => void refresh()}>Yenile</button></div>
    {/* Sahibin uzaktan yönetimi: the café's full screens on this paired device (src/RemoteAdmin.tsx, password + code each time),
        only with it in the package (the report says so; while it is off, /yonet says where to turn it on). */}
    {r?.admin && <a className="rp-refresh rp-manage" href="/yonet">Kafeyi yönet · Satış ve Raporlar, menü, ayarlar</a>}
    {!r ? <div className="rp-card"><p>{status.kind === 'loading' ? 'Rapor isteniyor…' : 'Henüz rapor gelmedi. Kafe bilgisayarı açılınca burada görünür.'}</p></div> : <ReportView r={r} live={status.kind === 'live'} />}
  </Shell>;
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
    <p>Bu cihaz unutulsun mu? Raporlar burada bir daha açılmaz; istediğinizde yeniden giriş yaparsınız.</p>
    <div className="rp-actions"><button type="button" className="rp-btn" disabled={busy} onClick={() => void out()}>{busy ? 'Çıkılıyor…' : 'Evet, çıkış yap'}</button><button type="button" className="rp-refresh" disabled={busy} onClick={onCancel}>Vazgeç</button></div>
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
    {t.channels.length > 1 && <section className="rp-card" aria-label="Satış kanalları"><h2>Satış kanalları</h2><ul className="rp-rows">{t.channels.map(c => <li key={c.name}><span>{c.name}</span><small>{c.orders.toLocaleString('tr-TR')} sipariş</small><strong>{tl(c.amount)}</strong></li>)}</ul></section>}
    <section className="rp-card" aria-label="Son kasa kapanışı"><h2>Son kasa kapanışı</h2>
      {r.lastClosing ? <><p className="rp-muted">{dayName(r.lastClosing.day, false)} · {clock(r.lastClosing.at)} · {r.lastClosing.byName}{r.lastClosing.extra ? ' · ek kapanış' : ''}</p>
        <ul className="rp-rows"><li><span>Sayılan</span><strong>{tl(r.lastClosing.counted)}</strong></li><li><span>Olması gereken</span><strong>{tl(r.lastClosing.expected)}</strong></li><li className={r.lastClosing.difference ? 'rp-diff' : ''}><span>Fark</span><strong>{r.lastClosing.difference > 0 ? '+' : ''}{tl(r.lastClosing.difference)}</strong></li></ul></>
        : <p className="rp-muted">Henüz kasa kapanışı yapılmadı.</p>}
    </section>
    <section className="rp-card" aria-label="Son 30 gün"><h2>Son 30 gün</h2>
      <p className="rp-month"><strong>{tl(month)}</strong>{best && best.sales > 0 && <span>En iyi gün: {dayName(best.day, false)} · {tl(best.sales)}</span>}</p>
      <div className="rp-chart" role="img" aria-label={`Son 30 günün satışı, toplam ${tl(month)}`}>{r.days.map(d => <span key={d.day} title={`${dayName(d.day, false)}: ${tl(d.sales)}`} style={{ height: `${Math.max(2, Math.round(d.sales / maxDay * 100))}%` }} />)}</div>
    </section>
  </div>;
}
function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rp-fact"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

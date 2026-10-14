import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { deviceKindOf, newPhoneKeys, openReport, pairConfirmed, pairRequest, readPairingFragment, signLive, type PairingLink, type ReportBox } from '../packages/domain/remote-crypto';
import type { PhoneReport } from '../packages/domain/remote-report';
import { forgetPaired, readPaired, savePaired, type Paired } from './phoneVault';

/*
 * "Raporlarım" on the owner's phone (served by Mola Merkez; read only). Pairing: the QR from Ayarlar → Uzaktan erişim (or
 * "Bu telefonu eşleştir" / "Bu cihazı eşleştir" there, on the device itself) opens this page with the pairing secret in the URL fragment (#e=…; never sent to a
 * server). The phone makes its own key pair here (the private key never leaves this browser), sends its public key through
 * Mola Merkez sealed with that secret, and keeps what it needs in IndexedDB (src/phoneVault.ts).
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
  const link = readPairingFragment(location.hash), k = /^#k=([A-Za-z0-9]{10})$/.exec(location.hash)?.[1];
  try { if (k) sessionStorage.setItem(LINK_KEY, k); } catch { /* the link only */ }
  // The secret (and the code) leave the address bar at once: not in history, not in a bookmark.
  if (location.hash) history.replaceState(null, '', location.pathname);
  let code = k ?? null; try { code ??= sessionStorage.getItem(LINK_KEY); } catch { /* none */ }
  return { link, code: code && LINK_CODE.test(code) ? code : null };
}
/** An iPhone's Home Screen web app: its storage is not Safari's, so a device paired in Safari is not paired there. */
const iosWebApp = () => (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function ReportsPhone() {
  const [ready, setReady] = useState<'checking' | 'ok' | 'https' | 'old'>('checking');
  const [paired, setPaired] = useState<Paired | null | undefined>(undefined);
  // The QR's pairing link: read once and taken out of the address bar (the secret stays out of history and bookmarks).
  const [start] = useState(readStart), [link, setLink] = useState<PairingLink | null>(start.link);
  const [revoked, setRevoked] = useState(false), [justPaired, setJustPaired] = useState('');
  const k = start.code;
  useEffect(() => { void cryptoReady().then(r => setReady(r as 'ok' | 'https' | 'old')); void readPaired().then(p => setPaired(p ?? null)).catch(() => setPaired(null)); }, []);
  if (ready === 'checking' || paired === undefined) return <Shell><p className="rp-muted" aria-busy="true">Açılıyor…</p></Shell>;
  if (ready !== 'ok') return <Shell><div className="rp-card rp-warn" role="alert"><h2>Bu sayfa burada açılamıyor</h2><p>{ready === 'https' ? 'Raporlarım yalnız güvenli bağlantıyla (https://) açılır. Kafe bilgisayarındaki QR kodunu yeniden okutun ya da Mola ekibine danışın.' : 'Bu tarayıcı gereken şifrelemeyi desteklemiyor. Cihazınızı ve tarayıcınızı güncelleyip yeniden deneyin.'}</p></div></Shell>;
  // After "Eşleştir" the pairing link is spent: a later "eşleşme kaldırıldı" shows as such, never as the same form again
  // (0.1.21: the owner saw the form stay as it was while the café computer listed the device).
  if (link && (!paired || revoked)) return <Shell k={k}><PairForm link={link} replacing={!!paired} onPaired={p => { setLink(null); setRevoked(false); setJustPaired(p.business); setPaired(p); }} /></Shell>;
  if (!paired) return <Shell k={k}><div className="rp-card"><h2>{revoked ? 'Bu cihazın eşleşmesi kaldırıldı' : 'Bu cihaz henüz eşleşmedi'}</h2>
    {iosWebApp() ? <p>Bu simge Safari’den ayrı açılıyor; eşleşmeniz Safari’de. Simgeyi silin, Safari’de <strong>Paylaş → Ana Ekrana Ekle</strong> ile yeniden ekleyin ve “Web Uygulaması olarak aç”ı kapatın.</p>
      : <p>Kafede, işletme sahibi hesabıyla <strong>Ayarlar → Uzaktan erişim</strong>’i açın ve adımları izleyin: önce telefonunuz, sonra laptop ya da tablet.</p>}</div></Shell>;
  return <Reports paired={paired} justPaired={justPaired} k={k} onRevoked={() => { setRevoked(true); setPaired(null); void forgetPaired(); }} />;
}

/** `k`: the permanent link's code, for "Kafedeyim, kasayı aç" (the same link, told to open the café computer). */
function Shell({ children, business, k }: { children: ReactNode; business?: string; k?: string | null }) {
  return <div className="rp-page"><header className="rp-head"><span className="rp-logo" aria-hidden="true">M</span><div><strong>Raporlarım</strong>{business && <span>{business}</span>}</div></header><main>{children}</main>
    {k && <a className="rp-cafe" href={`/k/${k}?kafe=1`}>Kafedeyim, kasayı aç</a>}
    <footer className="rp-foot">Raporlar kafe bilgisayarında yalnız bu cihaz için şifrelenir. Mola Merkez yalnız iletir, okuyamaz.</footer></div>;
}

/** The device's name is the one the owner typed on the café computer before the QR showed (server/remote-reports.ts). */
function PairForm({ link, replacing, onPaired }: { link: PairingLink; replacing: boolean; onPaired: (p: Paired) => void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      // What this device is (from its own browser), sealed with the rest: the café pairs the phone first.
      const keys = await newPhoneKeys(), request = await pairRequest(keys.privateKey, keys.publicKey, link, { name: '', kind: deviceKindOf(navigator.userAgent, navigator.maxTouchPoints), ...(link.code ? { code: code.replace(/\D/g, '') } : {}) });
      const r = await call('pair', request);
      if (r.status !== 200 || !r.data.ok) { setError(r.data.message ?? 'Eşleştirme tamamlanamadı. Biraz sonra yeniden deneyin.'); return; }
      // "Eşleşti" must come from the café computer itself (only it holds the QR's secret), not from Mola Merkez.
      if (!await pairConfirmed(link.secret, link.pairId, keys.publicKey, r.data.phoneId, r.data.confirm ?? '')) { setError('Eşleştirme doğrulanamadı. QR kodunu yeniden okutun.'); return; }
      const p: Paired = { v: 1, phoneId: r.data.phoneId, token: r.data.token, cafePublic: link.cafePublic, business: r.data.business ?? 'İşletme', pairedAt: new Date().toISOString(), privateKey: keys.privateKey, publicKey: keys.publicKey };
      await savePaired(p); onPaired(p);
    } catch { setError('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.'); }
    finally { setBusy(false); }
  }
  return <form className="rp-card rp-pair" onSubmit={e => void submit(e)} aria-label="Bu cihazı eşleştir">
    <h2>Bu cihazı eşleştir</h2>
    <p>Bu cihaz (telefon, tablet ya da bilgisayar) işletmenizin raporlarını görebilecek; kafe bilgisayarında verdiğiniz adla listelenir. {replacing ? 'Önceki eşleşmenin yerine geçer.' : ''}</p>
    {link.code && <label>Raporlar için telefon kodu<input value={code} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="6 haneli kod" onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /><small>Doğrulama uygulamanızdaki kodu yazın. Yalnız bu eşleştirmede bir kez sorulur.</small></label>}
    {error && <p className="rp-error" role="alert">{error}</p>}
    <button type="submit" className="rp-btn" disabled={busy}>{busy ? 'Eşleştiriliyor…' : 'Eşleştir'}</button>
  </form>;
}

type Shown = { report: PhoneReport; kind: 'live' | 'snapshot' };
/** Never back to an older report than the one on screen (a stale postbox box after a live answer). */
const newer = (a: Shown | undefined, b: Shown) => !a || Date.parse(b.report.at) >= Date.parse(a.report.at);

function Reports({ paired, justPaired, k, onRevoked }: { paired: Paired; justPaired: string; k: string | null; onRevoked: () => void }) {
  const [shown, setShown] = useState<Shown | undefined>(paired.last);
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
  return <Shell business={r?.business ?? paired.business} k={k}>
    {justPaired && <p className="rp-paired" role="status">Eşleşti ✓ · {justPaired}</p>}
    <div className="rp-bar">{line}<button type="button" className="rp-refresh" onClick={() => void refresh()}>Yenile</button></div>
    {/* Sahibin uzaktan yönetimi: the café's full screens on this paired device (src/RemoteAdmin.tsx, password + code each time),
        only with it in the package (the report says so; while it is off, /yonet says where to turn it on). */}
    {r?.admin && <a className="rp-refresh rp-manage" href="/yonet">Kafeyi yönet · Satış ve Raporlar, menü, ayarlar</a>}
    {!r ? <div className="rp-card"><p>{status.kind === 'loading' ? 'Rapor isteniyor…' : 'Henüz rapor gelmedi. Kafe bilgisayarı açılınca burada görünür.'}</p></div> : <ReportView r={r} />}
  </Shell>;
}

function ReportView({ r }: { r: PhoneReport }) {
  const t = r.today, maxDay = Math.max(1, ...r.days.map(d => d.sales)), month = r.days.reduce((a, d) => a + d.sales, 0);
  const best = r.days.reduce<{ day: string; sales: number } | null>((a, d) => !a || d.sales > a.sales ? d : a, null);
  const change = t.previous && t.previous.sales > 0 ? Math.round((t.sales - t.previous.sales) / t.previous.sales * 100) : null;
  return <div className="rp-report" aria-label="Özet">
    <section className="rp-card rp-hero" aria-label="Bugünün satışı">
      <span className="rp-label">Bugün · {dayName(r.day)}</span>
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

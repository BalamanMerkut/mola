import { useEffect, useState } from 'react';
import { Check, KeyRound, Printer, RefreshCw } from 'lucide-react';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import type { SecurityCaller } from './desktop-call';
import { pickGroups } from './recovery-groups';
import './security.css';

export type RecoveryView = { protection: 'off' | 'dpapi' | 'keychain' | 'file'; protectedAtRest: boolean; available: boolean; confirmed: boolean; shown: boolean; createdAt: string | null; warning: string | null };
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
export const protectionText: Record<RecoveryView['protection'], string> = {
  dpapi: 'Anahtar bu bilgisayarın Windows kullanıcısına kilitli.',
  keychain: 'Anahtar bu Mac’in anahtarlığında (Keychain) kilitli.',
  file: 'Bu bilgisayarda anahtar dosyada korumasız duruyor. Disk şifrelemesini mutlaka açın.',
  off: 'Anahtar koruması bu kurulumda kapalı (geliştirme ortamı).',
};

/** A plain page with the code, printed through a hidden frame: no new window, nothing saved by the app. */
export function printRecoveryCode(code: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Mola kurtarma kodu</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111}h1{font-size:22px}.code{font:700 26px/1.5 Consolas,monospace;letter-spacing:3px;border:2px solid #111;padding:18px;margin:24px 0;text-align:center}li{margin:6px 0}</style></head><body>
<h1>Mola · Kurtarma kodu</h1><p>Basım tarihi: ${new Date().toLocaleDateString('tr-TR')}</p><div class="code"></div>
<ul><li>Bilgisayar bozulursa, çalınırsa ya da Windows şifresi sıfırlanırsa verileriniz bu kodla açılır.</li><li>Bu kâğıdı kasada ya da evde saklayın. Bilgisayarın yanında durmasın.</li><li>Kodu kimseyle paylaşmayın, fotoğrafını çekmeyin, bilgisayara kaydetmeyin.</li><li>Kod da bilgisayar da kaybolursa veriler kurtarılamaz.</li></ul></body></html>`);
  doc.close();
  doc.querySelector('.code')!.textContent = code;
  frame.contentWindow!.focus(); frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60000);
}
export function CodeBox({ code }: { code: string }) {
  return <div className="recovery-code" aria-label="Kurtarma kodu" data-testid="recovery-code">{code.split('-').map((group, i) => <span key={i}>{group}</span>)}</div>;
}

const groupInput = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

/**
 * "Kurtarma kodunuz": shown once, printable. "Kaydettim" hides the code and asks for two of its groups from the paper, so a
 * code nobody wrote down is never marked as saved. onLater: the first-run window's explicit "Sonra kaydedeceğim" (the rail and
 * the İlk adımlar card keep reminding). A new code needs an owner's password.
 */
export function RecoveryCard({ caller, autoShow = false, onChange, onLater, onShowing, bare = false }: { caller: SecurityCaller; autoShow?: boolean; onChange?: (view: RecoveryView) => void; onLater?: () => void; onShowing?: (showing: boolean) => void; bare?: boolean }) {
  const [view, setView] = useState<RecoveryView | null>(null), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [renewing, setRenewing] = useState(false), [password, setPassword] = useState('');
  // checking: the two group numbers asked for; typed: what the owner wrote. whole: after a restart the full code is asked.
  const [checking, setChecking] = useState<[number, number] | null>(null), [typed, setTyped] = useState(['', '']), [whole, setWhole] = useState<string | null>(null);
  // The desktop rail listens, so its reminder dot follows changes made here.
  const update = (v: RecoveryView) => { setView(v); onChange?.(v); window.dispatchEvent(new Event('mola:security')); };
  async function show() {
    setBusy(true); setError('');
    try { setCode((await caller<{ code: string }>('/recovery/show', {})).code); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    let live = true;
    void caller<RecoveryView>('/recovery').then(v => { if (!live) return; update(v); if (v.available && autoShow) void show(); }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);
  async function confirm(body: { groups: { group: number; value: string }[] } | { code: string }) {
    setBusy(true); setError('');
    try { update(await caller<RecoveryView>('/recovery/confirm', body)); setCode(''); setChecking(null); setTyped(['', '']); setWhole(null); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { onShowing?.(!!code); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const startCheck = () => { setError(''); setTyped(['', '']); setChecking(pickGroups()); };
  async function renew() {
    setBusy(true); setError('');
    try {
      const result = await caller<{ code: string }>('/recovery/new', { password });
      setPassword(''); setRenewing(false); setCode(result.code);
      update(await caller<RecoveryView>('/recovery'));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const body = !view ? (!error && <p className="muted small">Yükleniyor…</p>) : view.protection === 'off' ? <Notice>{protectionText.off}</Notice> : <>
    {code && checking ? <form className="recovery-check" onSubmit={e => { e.preventDefault(); void confirm({ groups: checking.map((group, i) => ({ group, value: typed[i] })) }); }}>
      <p>Kâğıda baktığınızdan emin olalım. Kodun <strong>{checking[0]}.</strong> ve <strong>{checking[1]}.</strong> parçasını yazın (her parça 4 harf ya da rakam).</p>
      <div className="recovery-groups">{checking.map((group, i) => <label key={group}>{group}. parça<input value={typed[i]} autoComplete="off" spellCheck={false} autoCapitalize="characters" inputMode="text" maxLength={4} onChange={e => { const next = [...typed]; next[i] = groupInput(e.target.value); setTyped(next); }} /></label>)}</div>
      <div className="recovery-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { setChecking(null); setError(''); }}>Kodu yeniden göster</button>
        <button className="btn primary" disabled={busy || typed.some(t => t.length !== 4)}><Check size={16} />{busy ? 'Kontrol ediliyor…' : 'Onayla'}</button>
      </div>
    </form> : code ? <>
      <p>Bu kodu kâğıda yazın ya da yazdırın ve güvenli bir yerde saklayın. <strong>Kod bir daha gösterilmez.</strong></p>
      <CodeBox code={code} />
      <div className="recovery-actions">
        <button type="button" className="btn secondary" onClick={() => printRecoveryCode(code)}><Printer size={16} />Yazdır</button>
        <button type="button" className="btn primary" disabled={busy} onClick={startCheck}><Check size={16} />Kaydettim</button>
      </div>
      {onLater && <button type="button" className="text-btn recovery-later" disabled={busy} onClick={onLater}>Sonra kaydedeceğim</button>}
      <p className="muted small">Fotoğrafını çekmeyin, PDF olarak kaydetmeyin. Kâğıt bilgisayarın yanında durmasın.</p>
    </> : whole !== null ? <form className="recovery-check" onSubmit={e => { e.preventDefault(); void confirm({ code: whole }); }}>
      <p>Kâğıttaki kurtarma kodunun tamamını yazın. Doğruysa kod kaydedildi sayılır.</p>
      <label>Kurtarma kodu<input value={whole} autoComplete="off" spellCheck={false} autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" maxLength={64} onChange={e => setWhole(e.target.value)} /></label>
      <div className="recovery-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { setWhole(null); setError(''); }}>Vazgeç</button>
        <button className="btn primary" disabled={busy || whole.replace(/[\s-]/g, '').length < 24}><Check size={16} />{busy ? 'Kontrol ediliyor…' : 'Onayla'}</button>
      </div>
    </form> : view.available ? <>
      <Notice>Yeni bir kurtarma kodu hazır. Kâğıt ve kalem alıp kodu görüntüleyin.</Notice>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void show()}><KeyRound size={16} />Kodu göster</button>
    </> : view.confirmed ? <p className="recovery-saved"><Check size={16} />Kurtarma kodunuz kaydedildi{view.createdAt ? ` (${day(view.createdAt)})` : ''}.</p> : <>
      <Notice tone="error">Kurtarma kodunu kaydettiğinizi henüz onaylamadınız. Kâğıda yazdıysanız kodu yazarak onaylayın; yazmadıysanız yeni kod oluşturun.</Notice>
      <button type="button" className="btn secondary" disabled={busy} onClick={() => { setError(''); setWhole(''); }}><Check size={16} />Kodu kaydettim</button>
    </>}
    {!view.protectedAtRest && <Notice tone="error">{protectionText.file}</Notice>}
    {view.warning && <Notice tone="error">{view.warning}</Notice>}
    {!code && whole === null && !view.available && (renewing ? <form className="recovery-renew" onSubmit={e => { e.preventDefault(); void renew(); }}>
      <p className="muted small">Yeni kod oluşunca eski kod hemen geçersiz olur. Bu bilgisayardaki yedekler de yeni kodla açılır; başka yerde duran eski kopyalar eski kodla açılır.</p>
      <label>İşletme sahibi şifresi<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      <div className="recovery-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => { setRenewing(false); setPassword(''); }}>Vazgeç</button><button className="btn primary" disabled={busy || !password}>{busy ? 'Oluşturuluyor…' : 'Yeni kodu oluştur'}</button></div>
    </form> : <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => { setError(''); setRenewing(true); }}><RefreshCw size={15} />Yeni kurtarma kodu oluştur</button>)}
  </>;
  const content = <>{body}{error && <Notice tone="error">{error}</Notice>}</>;
  if (bare) return <div className="recovery-card">{content}</div>;
  return <section className="panel recovery-card">
    <h2><KeyRound size={18} />Kurtarma kodunuz <HelpTip title="Kurtarma kodu">Bilgisayar bozulursa, çalınırsa ya da Windows şifresi sıfırlanırsa verileriniz bu kodla açılır. Kod hiçbir yerde saklanmaz; yalnız sizin kâğıdınızda durur. Kod da bilgisayar da kaybolursa veriler kurtarılamaz.</HelpTip></h2>
    {view && view.protection !== 'off' && <p className="muted small">{protectionText[view.protection]}</p>}
    {content}
  </section>;
}

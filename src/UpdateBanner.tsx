import { useEffect, useId, useState } from 'react';
import { Clock3, CloudDownload, X } from 'lucide-react';
import { busyText } from '../packages/domain/update-busy';
import { api } from './api';
import { Modal, Notice } from './components';
import './update-banner.css';

/** GET /api/staff/update (server/update-routes.ts): the café's own update state. */
export type UpdateView = {
  current: string; state: 'idle' | 'downloading' | 'ready' | 'installing' | 'installed' | 'failed' | 'rolled_back'; version: string | null; notes: string; error: string | null; from: string | null; seen: boolean;
  progress: number | null; idleInstall: boolean; idleMinutes: number; canInstallNow: boolean; openAccounts: number; pendingOrders: number; qrApprovals?: number; platformWaiting?: number; restartable: boolean;
};
function useUpdate() {
  const [view, setView] = useState<UpdateView | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const read = () => api<UpdateView>('/api/staff/update').then(v => { if (alive) setView(v); return v; }, () => null)
      .then(v => { if (alive) timer = setTimeout(read, v && ['downloading', 'installing'].includes(v.state) ? 15000 : 60000); });
    void read();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return [view, setView] as const;
}

/** "1 saat sonra hatırlat": per browser, per version (a newer version asks again at once). */
const SNOOZE = 'mola-guncelleme-ertele';
function snoozed(version: string | null) {
  try { const s = JSON.parse(localStorage.getItem(SNOOZE) ?? 'null') as { version: string; until: number } | null; return !!s && s.version === version && Date.now() < s.until; } catch { return false; }
}
function snooze(version: string | null, ms: number) { try { localStorage.setItem(SNOOZE, JSON.stringify({ version, until: Date.now() + ms })); } catch { /* private mode: asks again next time */ } }

/**
 * Otomatik güncelleme for the owner (Masalar and every owner page). 14 Ekim (the owner: a window says it better than a line
 * at the top): when a new version is ready, a window opens: what is new, "Şimdi güncelle", "1 saat sonra hatırlat" or
 * "Kapanışta kur". "Şimdi güncelle" shows a percentage: the backup (the request itself), then the restart (the server is
 * away; the bar moves on its own towards 95 %), then 100 % when /api/health answers with the new version, and the page
 * reloads itself, fresh. Put off: the quiet line at the top stays, its "Şimdi kur" opens the window again. Then once
 * "güncellendi" or "geri alındı". The window takes the business's palette like every Mola window.
 */
export function UpdateBanner() {
  const [view, setView] = useUpdate();
  const [open, setOpen] = useState<boolean | null>(null), [, tick] = useState(0);
  if (!view) return null;
  const close = () => void api<UpdateView>('/api/staff/update/seen', {}).then(setView, () => undefined);
  if (view.state === 'installing') return <Notice><span className="update-banner"><CloudDownload size={17} aria-hidden="true" /><span><strong>Mola güncelleniyor.</strong> Birkaç dakika içinde yeni sürümle yeniden açılır; verileriniz önce yedeklendi.</span></span></Notice>;
  if (view.state === 'installed' && !view.seen) return <Notice tone="success"><span className="update-banner"><span>Mola <strong>{view.version}</strong> sürümüne güncellendi.{view.notes ? ` ${view.notes}` : ''}</span><button type="button" className="icon-btn" aria-label="Güncelleme bilgisini kapat" onClick={close}><X size={16} /></button></span></Notice>;
  if ((view.state === 'rolled_back' || (view.state === 'failed' && view.from)) && !view.seen) return <Notice tone="error"><span className="update-banner"><span>Yeni sürüm ({view.version}) kurulamadı; Mola önceki sürüme döndü, verileriniz yerinde. Mola ekibine bilgi gitti.</span><button type="button" className="icon-btn" aria-label="Güncelleme bilgisini kapat" onClick={close}><X size={16} /></button></span></Notice>;
  if (view.state !== 'ready') return null;
  // Opens by itself once per page unless put off; the line above it opens it again.
  const shown = open ?? (view.restartable && !snoozed(view.version));
  return <>
    <div className="update-banner-box" role="region" aria-label="Yeni sürüm">
      <p><CloudDownload size={17} aria-hidden="true" /><span><strong>Yeni sürüm hazır</strong> · kapanışta ya da yarın açılışta kurulacak <span className="muted">({view.current} → {view.version})</span></span></p>
      {view.restartable && <button type="button" className="btn secondary small-btn" onClick={() => setOpen(true)}>Şimdi kur</button>}
    </div>
    {shown && <UpdateDialog view={view} onLater={ms => { if (ms) snooze(view.version, ms); setOpen(false); tick(t => t + 1); }} />}
  </>;
}

type Phase = 'ask' | 'backup' | 'restart' | 'done' | 'slow';
function UpdateDialog({ view, onLater }: { view: UpdateView; onLater: (ms: number) => void }) {
  const [phase, setPhase] = useState<Phase>('ask'), [percent, setPercent] = useState(0), [error, setError] = useState('');
  const busy = view.openAccounts || view.pendingOrders ? `${busyText(view)} var. Bunlar bitince güncelleyebilirsiniz; yoksa kapanışta ya da yarın açılışta kendiliğinden kurulur.` : '';
  const working = phase !== 'ask';
  // The bar: the backup (5 → 35 %) while the request runs, then the restart (35 → 95 %) until the new version answers.
  useEffect(() => {
    if (phase !== 'backup' && phase !== 'restart' && phase !== 'slow') return;
    const [from, to, ms] = phase === 'backup' ? [5, 35, 40_000] : [35, 95, 90_000], started = Date.now();
    const t = setInterval(() => setPercent(p => Math.max(p, Math.round(from + (to - from) * (1 - Math.exp(-3 * (Date.now() - started) / ms))))), 400);
    return () => clearInterval(t);
  }, [phase]);
  // Waiting for the new version: /api/health every 1.5 s; after 6 minutes it says so and keeps waiting.
  useEffect(() => {
    if (phase !== 'restart') return;
    let live = true; const started = Date.now();
    const poll = async () => {
      if (!live) return;
      try {
        const h = await (await fetch('/api/health', { cache: 'no-store' })).json() as { version?: string };
        if (h.version && h.version === view.version) {
          setPercent(100); setPhase('done');
          setTimeout(() => void fetch(location.pathname, { cache: 'reload' }).catch(() => undefined).finally(() => location.reload()), 900);
          return;
        }
        // The old version answers again after a while: it was put back (rolled back); the page shows why after a reload.
        if (h.version && h.version === view.current && Date.now() - started > 45_000) { setError('Yeni sürüm açılamadı; Mola önceki sürüme döndü, verileriniz yerinde. Sayfa yenileniyor.'); setTimeout(() => location.reload(), 4000); return; }
      } catch { /* restarting: no answer yet */ }
      if (Date.now() - started > 6 * 60_000) setError('Kurulum beklenenden uzun sürüyor; bu pencere açık kalsın, bitince kendiliğinden yenilenir.');
      setTimeout(() => void poll(), 1500);
    };
    const first = setTimeout(() => void poll(), 2500);
    return () => { live = false; clearTimeout(first); };
  }, [phase, view.version, view.current]);
  async function install() {
    setError(''); setPercent(5); setPhase('backup');
    try { await api('/api/staff/update/install', {}, undefined, 120000); setPercent(p => Math.max(p, 35)); setPhase('restart'); }
    catch (e) { setError((e as Error).message); setPhase('ask'); setPercent(0); }
  }
  const step = phase === 'backup' ? 'Verileriniz yedekleniyor…' : phase === 'restart' ? 'Yeni sürüm kuruluyor; Mola kısa bir süre kapanıp yeniden açılacak…' : phase === 'done' ? 'Güncellendi. Sayfa yenileniyor…' : '';
  return <Modal title={`Mola ${view.version ?? ''} hazır`} onClose={() => { if (!working) onLater(0); }} dismissible={!working} className="update-dialog">
    <div className="modal-body update-dialog-body">
      {!working && <>
        <p className="update-dialog-lead"><CloudDownload size={20} aria-hidden="true" /><span>Yeni sürüm indirildi ve kuruluma hazır <span className="muted">({view.current} → {view.version})</span>.</span></p>
        {view.notes && <div className="update-dialog-notes"><strong>Neler yeni</strong><p>{view.notes}</p></div>}
        <p className="muted small">Kurulum birkaç dakika sürer. Önce verileriniz yedeklenir; Mola kısa bir süre kapanıp yeni sürümle açılır. Yeni sürüm açılmazsa kendiliğinden önceki sürüme döner.</p>
        {busy && <Notice>{busy}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="update-dialog-actions">
          <button type="button" className="btn primary" disabled={!!busy} onClick={() => void install()}><CloudDownload size={16} aria-hidden="true" />Şimdi güncelle</button>
          <button type="button" className="btn secondary" onClick={() => onLater(60 * 60_000)}><Clock3 size={16} aria-hidden="true" />1 saat sonra hatırlat</button>
          <button type="button" className="text-btn" onClick={() => onLater(24 * 60 * 60_000)}>Kapanışta kur</button>
        </div>
      </>}
      {working && <div className="update-progress" aria-live="polite">
        <div className="update-progress-head"><strong>{phase === 'done' ? 'Tamamlandı' : 'Güncelleniyor'}</strong><span className="update-percent" data-testid="update-percent">%{percent}</span></div>
        <div className="update-bar" role="progressbar" aria-label="Güncelleme ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>
        <p className="update-step">{step}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {phase !== 'done' && <p className="muted small">Bu pencereyi kapatmayın. Bilgisayarı kapatmayın.</p>}
      </div>}
    </div>
  </Modal>;
}

const stateLine = (v: UpdateView) => ({
  idle: 'Güncel. Yeni sürüm çıkınca kendiliğinden indirilir.', downloading: `Yeni sürüm (${v.version}) indiriliyor${v.progress !== null ? ` · %${v.progress}` : ''}.`,
  ready: `Yeni sürüm (${v.version}) hazır: kapanışta ya da yarın açılışta kurulacak.`, installing: 'Güncelleme kuruluyor.', installed: `${v.version} sürümüne güncellendi.`,
  failed: v.from ? `${v.version} kurulamadı; önceki sürümde devam ediliyor.` : `Yeni sürüm indirilemedi; daha sonra yeniden denenecek.${v.error ? ` (${v.error})` : ''}`,
  rolled_back: `${v.version} açılamadı; önceki sürüme dönüldü, veriler yerinde.`,
} as Record<UpdateView['state'], string>)[v.state];
/** Ayarlar → Güvenlik ve yedek → Kilit ve güncelleme: the version, where its update stands, and "Boşta kendiliğinden kur" (default on). */
export function UpdateSettings() {
  const [view, setView] = useUpdate(), [error, setError] = useState(''), id = useId();
  if (!view) return null;
  async function toggle(on: boolean) {
    setError('');
    // Shown at once; put back if it could not be saved.
    setView(v => v && { ...v, idleInstall: on });
    try { setView(await api<UpdateView>('/api/staff/update/settings', { idleInstall: on })); } catch (e) { setView(v => v && { ...v, idleInstall: !on }); setError((e as Error).message); }
  }
  return <section className="settings-card" aria-labelledby={`${id}-title`}>
    <div className="settings-card-head"><CloudDownload size={18} aria-hidden="true" /><h3 id={`${id}-title`}>Güncellemeler</h3></div>
    <p className="settings-card-note">Mola {view.current || ''} · {stateLine(view)}</p>
    <div className="settings-row">
      <div className="settings-row-copy"><div className="settings-row-title"><label htmlFor={`${id}-idle`}>Boşta kendiliğinden kur</label></div>
        <p id={`${id}-idle-help`}>Açık masa ve bitmemiş sipariş yokken {view.idleMinutes} dakika işlem olmazsa yeni sürüm gün içinde de kurulur. Kapalıysa kapanışta ya da açılışta kurulur. Her kurulumdan önce veriler yedeklenir; yeni sürüm açılmazsa önceki sürüme dönülür.</p></div>
      <div className="settings-row-control"><div className="settings-toggle"><span aria-hidden="true">{view.idleInstall ? 'Açık' : 'Kapalı'}</span><input id={`${id}-idle`} type="checkbox" aria-describedby={`${id}-idle-help`} checked={view.idleInstall} onChange={e => void toggle(e.target.checked)} /></div></div>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
}

import { useEffect, useId, useState } from 'react';
import { CloudDownload, X } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import './update-banner.css';

/** GET /api/staff/update (server/update-routes.ts): the café's own update state. */
export type UpdateView = {
  current: string; state: 'idle' | 'downloading' | 'ready' | 'installing' | 'installed' | 'failed' | 'rolled_back'; version: string | null; notes: string; error: string | null; from: string | null; seen: boolean;
  progress: number | null; idleInstall: boolean; idleMinutes: number; canInstallNow: boolean; openAccounts: number; pendingOrders: number; restartable: boolean;
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
const busyText = (v: UpdateView) => [v.openAccounts && `${v.openAccounts} açık masa`, v.pendingOrders && `${v.pendingOrders} bitmemiş sipariş`].filter(Boolean).join(' ve ');

/**
 * Otomatik güncelleme, the owner's quiet banner (Masalar and every owner page): "Yeni sürüm hazır · kapanışta ya da yarın
 * açılışta kurulacak" and "Şimdi kur" (only when nothing is open; otherwise it says why), then once "güncellendi" or
 * "geri alındı" after the restart. Nothing while a download runs or when there is nothing new.
 */
export function UpdateBanner() {
  const [view, setView] = useUpdate();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [warning, setWarning] = useState(''), [restarting, setRestarting] = useState(false);
  if (!view) return null;
  const close = () => void api<UpdateView>('/api/staff/update/seen', {}).then(setView, () => undefined);
  if (restarting || view.state === 'installing') return <Notice><span className="update-banner"><CloudDownload size={17} aria-hidden="true" /><span><strong>Mola güncelleniyor.</strong> Birkaç dakika içinde yeni sürümle yeniden açılır; verileriniz önce yedeklendi.</span></span></Notice>;
  if (view.state === 'installed' && !view.seen) return <Notice tone="success"><span className="update-banner"><span>Mola <strong>{view.version}</strong> sürümüne güncellendi.{view.notes ? ` ${view.notes}` : ''}</span><button type="button" className="icon-btn" aria-label="Güncelleme bilgisini kapat" onClick={close}><X size={16} /></button></span></Notice>;
  if ((view.state === 'rolled_back' || (view.state === 'failed' && view.from)) && !view.seen) return <Notice tone="error"><span className="update-banner"><span>Yeni sürüm ({view.version}) kurulamadı; Mola önceki sürüme döndü, verileriniz yerinde. Mola ekibine bilgi gitti.</span><button type="button" className="icon-btn" aria-label="Güncelleme bilgisini kapat" onClick={close}><X size={16} /></button></span></Notice>;
  if (view.state !== 'ready') return null;
  async function install() {
    setError(''); setWarning('');
    if (view!.openAccounts || view!.pendingOrders) { setWarning(`${busyText(view!)} var. Hesaplar kapanınca kurabilirsiniz; yoksa kapanışta ya da yarın açılışta kendiliğinden kurulur.`); return; }
    setBusy(true);
    try { await api('/api/staff/update/install', {}, undefined, 120000); setRestarting(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="update-banner-box" role="region" aria-label="Yeni sürüm">
    <p><CloudDownload size={17} aria-hidden="true" /><span><strong>Yeni sürüm hazır</strong> · kapanışta ya da yarın açılışta kurulacak <span className="muted">({view.current} → {view.version})</span>{view.notes && <span className="update-notes">{view.notes}</span>}</span></p>
    {view.restartable && <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void install()}>{busy ? 'Yedekleniyor…' : 'Şimdi kur'}</button>}
    {warning && <Notice>{warning}</Notice>}{error && <Notice tone="error">{error}</Notice>}
  </div>;
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

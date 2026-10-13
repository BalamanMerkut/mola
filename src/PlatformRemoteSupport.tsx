import { useCallback, useEffect, useState } from 'react';
import { History, MonitorSmartphone, Unplug } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN } from './platformStatus';
import { DCard } from './PlatformDetailKit';

/*
 * Mola Yönetim → işletme → Destek → "Uzaktan destek" (server/merkez/relay.ts). Whether the owner allows it right now (set only
 * on the café computer), whether that computer is reachable, "Kafeye bağlan" (the café's own screens open in a new tab as
 * "Mola destek": no sales, money or staff data), and who connected when. Sessions end after 30 idle minutes.
 * 13 Ekim: "Uzaktan bağlan" also sits on the business's identity card (RemoteConnectButton) and in the remote-support events
 * of Bildirim merkezi, so it is found without looking for it.
 */
type Status = { access: { on: boolean; since: string | null; seenAt: string } | null; online: boolean; active: { id: string; startedAt: string; lastAt: string; requests: number } | null;
  history: { id: string; startedAt: string; endedAt: string | null; endedBy: string | null; requests: number }[]; phones: number };
const at = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const endedBy: Record<string, string> = { vendor: 'Mola ekibi kapattı', owner: 'işletme sahibi kesti', off: 'izin kapatıldı', timeout: '30 dakika işlem yok', restart: 'yeniden başlatma' };
const TIP = 'Bağlanınca kafenin ekranları yeni sekmede “Mola destek” olarak açılır: menü, kampanya, masa ve QR, yazıcı ve ayarlar. Satış, kasa, çalışan ve güvenlik bilgileri görünmez. Her değişiklik işletme sahibinin ekranına yazılır. İzni yalnız işletme sahibi açar (kafedeki Mola → Destek → Uzaktan erişim). 30 dakika işlem yapılmazsa oturum kapanır.';

/** The remote-support state of one business, read every `every` ms while the page is visible, and the two actions. */
function useRemoteSupport(tenantId: string, every: number) {
  const [s, setS] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(() => api<Status>(`${ADMIN}/support-sessions?tenantId=${encodeURIComponent(tenantId)}`).then(v => { setS(v); }).catch(e => setError((e as Error).message)), [tenantId]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, every); return () => clearInterval(t); }, [load, every]);
  async function connect() {
    setBusy(true); setError('');
    // The tab opens at once (a popup blocker allows it only now), then goes to the session's page.
    const tab = window.open('', '_blank');
    try { const r = await api<{ url: string }>(`${ADMIN}/support-sessions`, { tenantId }); if (tab) tab.location.href = r.url; else location.href = r.url; await load(); }
    catch (e) { tab?.close(); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function end() { setBusy(true); setError(''); try { await api(`${ADMIN}/support-sessions/end`, { tenantId }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const on = !!s?.access?.on, ready = on && !!s?.online;
  const why = !s ? 'Okunuyor…' : !s.access ? 'İşletme uzaktan erişimi henüz hiç açmadı.' : !on ? 'İşletme sahibi izni açmadı.' : !s.online ? 'İşletmenin bilgisayarı şu an bağlı değil.' : '';
  return { s, busy, error, connect, end, on, ready, why };
}

/**
 * The identity card's "Uzaktan bağlan": connects at once when the owner allows it and the café computer is on; otherwise it
 * opens the Destek tab's "Uzaktan destek" card, which says why (`onShow`).
 */
export function RemoteConnectButton({ tenantId, disabled, onShow }: { tenantId: string; disabled: boolean; onShow: () => void }) {
  const r = useRemoteSupport(tenantId, 15000);
  return <span className="remote-connect">
    <button type="button" className={`btn ${r.ready ? 'primary' : 'secondary'} small-btn`} disabled={disabled || r.busy} title={r.ready ? 'Kafenin ekranları yeni sekmede açılır' : r.why} aria-describedby={`remote-why-${tenantId}`}
      onClick={() => { if (r.ready) void r.connect(); else onShow(); }}><MonitorSmartphone size={16} aria-hidden="true" />{r.s?.active ? 'Yeniden bağlan' : 'Uzaktan bağlan'}</button>
    <small id={`remote-why-${tenantId}`} className={`remote-connect-why${r.ready ? ' ok' : ''}`}>{r.ready ? (r.s?.active ? 'Şu an bağlısınız' : 'İzin açık · bilgisayar bağlı') : r.why}</small>
    {r.error && <span className="visually-hidden" role="status">{r.error}</span>}
  </span>;
}

export function PlatformRemoteSupport({ tenantId, name, disabled, focus = 0 }: { tenantId: string; name: string; disabled: boolean; focus?: number }) {
  const { s, busy, error, connect, end, on } = useRemoteSupport(tenantId, 5000), anchor = `remote-${tenantId}`;
  // Sent here by the identity card's "Uzaktan bağlan": brought into view.
  useEffect(() => { if (focus) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })); }, [focus, anchor]);
  const state = !s ? 'Okunuyor…' : !s.access ? 'İzin hiç açılmadı' : on ? `İzin açık${s.access.since ? ` · ${at(s.access.since)}’den beri` : ''}` : 'İzin kapalı';
  return <DCard id={anchor} title="Uzaktan destek" icon={<MonitorSmartphone size={20} />} tone={on ? 'ok' : 'idle'} tip={TIP} className={`remote-support-admin${focus ? ' focused' : ''}`}
    actions={<span className={`status-chip ${on ? (s?.online ? 'ok' : 'warn') : 'idle'}`}>{!s ? 'Okunuyor…' : on ? (s.online ? 'Bağlanılabilir' : 'Bilgisayar kapalı') : 'İzin yok'}</span>}>
    <ul className="dlines">
      <li><span className={`status-dot ${on ? 'ok' : ''}`} aria-hidden="true" /><span>{state}</span></li>
      {s && on && <li><span className={`status-dot ${s.online ? 'ok' : 'warn'}`} aria-hidden="true" /><span>{s.online ? 'İşletmenin bilgisayarı Mola Merkez’e bağlı.' : 'İşletmenin bilgisayarı şu anda bağlı değil (kapalı ya da internet yok).'}</span></li>}
      {s && s.phones > 0 && <li><span className="status-dot" aria-hidden="true" /><span>Raporlarım: {s.phones} telefon eşleşmiş (Mola Merkez okuyamaz).</span></li>}
    </ul>
    {s?.active ? <div className="remote-live" role="status"><span className="remote-live-dot" aria-hidden="true" /><p><strong>Bağlısınız</strong> · {clock(s.active.startedAt)}’den beri · {s.active.requests} istek</p><button type="button" className="btn secondary" disabled={busy || disabled} onClick={() => void end()}><Unplug size={16} aria-hidden="true" />Bağlantıyı kes</button></div> : null}
    <div className="application-actions"><button type="button" className="btn primary" disabled={busy || disabled || !on || !s?.online} onClick={() => void connect()}><MonitorSmartphone size={16} aria-hidden="true" />{s?.active ? 'Yeniden bağlan' : 'Kafeye bağlan'}</button>
      {s && (!on || !s.online) && <small className="section-note">{!on ? `${name} sahibi kafedeki Mola’da Destek → Uzaktan erişim’den izni açmalı.` : 'Bilgisayar açılınca bağlanabilirsiniz.'}</small>}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {s && s.history.length > 0 && <><h3 className="remote-history-title"><History size={15} aria-hidden="true" />Oturum geçmişi</h3><ul className="remote-sessions" aria-label="Destek oturumları">{s.history.map(h => <li key={h.id}><strong>{at(h.startedAt)}{h.endedAt ? `–${clock(h.endedAt)}` : ' · şu an açık'}</strong><span>{h.endedBy ? `${endedBy[h.endedBy] ?? h.endedBy} · ` : ''}{h.requests} istek</span></li>)}</ul></>}
  </DCard>;
}

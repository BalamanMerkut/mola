import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone, Unplug } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN } from './platformStatus';

/*
 * Mola Yönetim → işletme → Destek → "Uzaktan destek" (server/merkez/relay.ts). Whether the owner allows it right now (set only
 * on the café computer), whether that computer is reachable, "Kafeye bağlan" (the café's own screens open in a new tab as
 * "Mola destek": no sales, money or staff data), and who connected when. Sessions end after 30 idle minutes.
 */
type Status = { access: { on: boolean; since: string | null; seenAt: string } | null; online: boolean; active: { id: string; startedAt: string; lastAt: string; requests: number } | null;
  history: { id: string; startedAt: string; endedAt: string | null; endedBy: string | null; requests: number }[]; phones: number };
const at = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const endedBy: Record<string, string> = { vendor: 'Mola ekibi kapattı', owner: 'işletme sahibi kesti', off: 'izin kapatıldı', timeout: '30 dakika işlem yok', restart: 'yeniden başlatma' };

export function PlatformRemoteSupport({ tenantId, name, disabled }: { tenantId: string; name: string; disabled: boolean }) {
  const [s, setS] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(() => api<Status>(`${ADMIN}/support-sessions?tenantId=${encodeURIComponent(tenantId)}`).then(v => { setS(v); }).catch(e => setError((e as Error).message)), [tenantId]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(t); }, [load]);
  async function connect() {
    setBusy(true); setError('');
    // The tab opens at once (a popup blocker allows it only now), then goes to the session's page.
    const tab = window.open('', '_blank');
    try { const r = await api<{ url: string }>(`${ADMIN}/support-sessions`, { tenantId }); if (tab) tab.location.href = r.url; else location.href = r.url; await load(); }
    catch (e) { tab?.close(); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function end() { setBusy(true); setError(''); try { await api(`${ADMIN}/support-sessions/end`, { tenantId }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const on = !!s?.access?.on;
  const state = !s ? 'Okunuyor…' : !s.access ? 'İşletmenin bilgisayarı uzaktan erişimi henüz hiç açmadı.' : on ? `İzin açık${s.access.since ? ` · ${at(s.access.since)}’den beri` : ''}` : 'İzin kapalı · İşletme sahibi açmadıkça bağlanılamaz.';
  return <section className="detail-section remote-support-admin" aria-label="Uzaktan destek">
    <div className="detail-section-head"><h2>Uzaktan destek</h2></div>
    <p className="section-lead"><span className={`status-dot ${on ? 'ok' : ''}`} aria-hidden="true" />{state}</p>
    {s && on && <p className="section-note">{s.online ? 'İşletmenin bilgisayarı Mola Merkez’e bağlı.' : 'İşletmenin bilgisayarı şu anda bağlı değil (kapalı ya da internet yok).'}</p>}
    <p className="section-note">Bağlanınca kafenin ekranları yeni sekmede “Mola destek” olarak açılır: menü, kampanya, masa ve QR, yazıcı ve ayarlar. Satış, kasa, çalışan ve güvenlik bilgileri görünmez. Her değişiklik işletme sahibinin ekranına yazılır.</p>
    {s?.active ? <div className="remote-live" role="status"><span className="remote-live-dot" aria-hidden="true" /><p><strong>Bağlısınız</strong> · {clock(s.active.startedAt)}’den beri · {s.active.requests} istek</p><button type="button" className="btn secondary" disabled={busy || disabled} onClick={() => void end()}><Unplug size={16} aria-hidden="true" />Bağlantıyı kes</button></div> : null}
    <div className="application-actions"><button type="button" className="btn primary" disabled={busy || disabled || !on || !s?.online} onClick={() => void connect()}><MonitorSmartphone size={16} aria-hidden="true" />{s?.active ? 'Yeniden bağlan' : 'Kafeye bağlan'}</button>
      {s && (!on || !s.online) && <small className="section-note">{!on ? `${name} sahibi Destek → Uzaktan erişim’den izni açmalı.` : 'Bilgisayar açılınca bağlanabilirsiniz.'}</small>}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {s && s.history.length > 0 && <><h3 className="remote-history-title">Oturum geçmişi</h3><ul className="remote-sessions" aria-label="Destek oturumları">{s.history.map(h => <li key={h.id}><strong>{at(h.startedAt)}{h.endedAt ? `–${clock(h.endedAt)}` : ' · şu an açık'}</strong><span>{h.endedBy ? `${endedBy[h.endedBy] ?? h.endedBy} · ` : ''}{h.requests} istek</span></li>)}</ul></>}
    {s && s.phones > 0 && <p className="section-note">Raporlarım: {s.phones} telefon eşleşmiş. Raporlar telefonda açılır; Mola Merkez okuyamaz.</p>}
  </section>;
}

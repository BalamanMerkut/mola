import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Lock, MonitorCheck, MonitorSmartphone, RefreshCw, Wifi } from 'lucide-react';

type Result = { connected: boolean; latency: number | null; checkedAt: string };
/** `page`: Ayarlar → Cihazlar → Cihaz bağla shows the check as an open card (no fold). */
export function DeviceChecks({ page = false }: { page?: boolean } = {}) {
  const [open, setOpen] = useState(page), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null), [showReport, setShowReport] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { const pending = request.current; request.current = null; pending?.abort(); }, []);
  async function check() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setShowReport(false);
    const started = performance.now(), timer = window.setTimeout(() => controller.abort('timeout'), 5000);
    try {
      const response = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (body.ok !== true) throw new Error();
      if (request.current === controller) setResult({ connected: true, latency: Math.round(performance.now() - started), checkedAt: new Date().toISOString() });
    } catch {
      if (request.current === controller && (!controller.signal.aborted || controller.signal.reason === 'timeout')) setResult({ connected: false, latency: null, checkedAt: new Date().toISOString() });
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  const secure = window.isSecureContext, https = location.protocol === 'https:';
  const screen = secure && !!navigator.wakeLock;
  const report = `Mola cihaz kontrolü\nZaman: ${result?.checkedAt ?? 'Henüz kontrol edilmedi'}\nBağlantı türü: ${https ? 'HTTPS' : 'HTTP'}\nGüvenli tarayıcı bağlamı: ${secure ? 'Evet' : 'Hayır'}\nEkranı açık tutma desteği: ${screen ? 'Var' : 'Yok'}\nSunucu erişimi: ${result ? result.connected ? 'Başarılı' : 'Başarısız' : 'Kontrol edilmedi'}\nİstek süresi: ${result?.latency === null || !result ? 'Ölçülemedi' : `${result.latency} ms`}`;
  const connection = busy ? { tone: 'wait', text: 'Kontrol ediliyor…' } : !result ? { tone: 'idle', text: 'Henüz kontrol edilmedi' } : result.connected
    ? (result.latency !== null && result.latency > 800 ? { tone: 'warn', text: 'Bağlı · yavaş, Wi-Fi sinyalini kontrol edin' } : { tone: 'ok', text: `Bağlı · sorun yok${result.latency !== null ? ` (${result.latency} ms)` : ''}` })
    : { tone: 'bad', text: 'Ulaşılamadı · Wi-Fi bağlantısını kontrol edip yeniden deneyin' };
  const body = <>
    {open && <div className="settings-blocks-content">
      <p className={page ? 'settings-card-note' : 'muted small'}>Yalnız şu an kullandığınız cihazı kontrol eder. Bir tableti veya telefonu kontrol etmek için Mola'yı o cihazda açıp buraya gelin.</p>
      <dl className="device-check-list">
        <div><dt><Wifi size={16} aria-hidden="true" />Kasa bilgisayarına bağlantı</dt><dd role="status"><span className={`device-state ${connection.tone}`}>{connection.text}</span></dd></div>
        <div><dt><MonitorSmartphone size={16} aria-hidden="true" />Ekranın açık kalması</dt><dd><span className={`device-state ${screen ? 'ok' : 'warn'}`}>{screen ? 'Bu cihazda çalışır' : 'Bu cihazda çalışmaz; ekran kendiliğinden kapanabilir'}</span></dd></div>
        <div><dt><Lock size={16} aria-hidden="true" />Bağlantı türü</dt><dd><span className="device-state idle">{https ? 'Şifreli (internet adresi)' : 'İşletme içi ağ'}</span></dd></div>
      </dl>
      <p className="settings-field-hint">{screen ? 'Mutfak tabletinde ekranın açık kalması için mutfak ekranındaki ekran simgesi açık olmalı.' : 'Mutfak tabletinde ekranın kapanmaması için cihazın ayarlarından ekran zaman aşımını uzatın.'} Sipariş sesi için mutfak ekranındaki hoparlör simgesine bir kez dokunun.</p>
      <div className="device-check-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => void check()}><RefreshCw size={16} aria-hidden="true" />{result ? 'Yeniden kontrol et' : 'Bağlantıyı kontrol et'}</button>
        {result && <button type="button" className="text-btn" onClick={() => setShowReport(value => !value)}>{showReport ? 'Özeti gizle' : 'Destek için özeti göster'}</button>}</div>
      {showReport && <div className="device-check-report"><label>Kontrol özeti<textarea readOnly rows={8} value={report} onFocus={e => e.currentTarget.select()} /></label><span className="settings-field-hint">Seçip kopyalayarak destek talebinize ekleyebilirsiniz. Şifre, hesap veya satış bilgisi içermez; otomatik gönderilmez.</span></div>}
    </div>}
  </>;
  if (page) return <section className="settings-card device-checks" aria-labelledby="settings-device-title">
    <div className="settings-card-head"><MonitorCheck size={18} aria-hidden="true" /><h3 id="settings-device-title">Bağlantı ve cihaz kontrolü</h3></div>
    {body}
  </section>;
  return <details className="settings-blocks device-checks" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><MonitorCheck size={18} /><span>Bağlantı ve cihaz kontrolü</span><ChevronDown size={17} className="settings-disclosure-icon" /><span className="settings-tool-description">Bu cihazın bağlantısını ve destek bilgilerini kontrol edin.</span></summary>
    {body}
  </details>;
}

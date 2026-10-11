import { useEffect, useId, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { api } from './api';
import type { FailureRecord } from '../server/failure-index';
import { trackingCode } from './trackingCode';
import { HelpTip } from './HelpTip';
import { ADMIN } from './platformStatus';

const RETENTION = 'İşletmenin bilgisayarı her bağlantıda (en geç 10 dakikada) yeni sunucu hatalarını Mola Merkez’e gönderir. İşletme başına en fazla 500 kayıt, 30 gün saklanır; daha eskileri kendiliğinden silinir. Kayıtta hatanın koddaki yeri bulunur; şifre, sipariş içeriği ve satış tutarı bulunmaz. İndirdiğiniz raporu geliştiriciye gönderebilirsiniz.';

/** Downloads one business's recent server errors as a JSON file for the developer. */
function useReportDownload() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function download(tenantId: string) {
    setBusy(true); setError('');
    try {
      const report = await api(`${ADMIN}/diagnostics/export`, { tenantId });
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'isletme-hata-raporu.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return { busy, error, download };
}

/** Looks up one tracking code (server-wide); a pasted error message works too. */
function TrackingLookup() {
  const [id, setId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<{ record: FailureRecord | null } | null>(null);
  const hintId = useId(), code = trackingCode(id), invalid = !!id.trim() && !code;
  return <><form className="diagnostics-lookup" onSubmit={e => { e.preventDefault(); if (!code || busy) return; setBusy(true); setError(''); setResult(null); void api<{ record: FailureRecord | null }>(`${ADMIN}/diagnostics/find`, { trackingId: code }).then(setResult).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>
      <label>Takip kodu *<input aria-label="Takip kodu" aria-describedby={hintId} aria-invalid={invalid} value={id} maxLength={1000} required disabled={busy} onChange={e => { setId(e.target.value); setResult(null); setError(''); }} placeholder="Kodu veya hata mesajını yapıştırın" /><span id={hintId} className="small muted">{invalid ? 'Tek bir geçerli takip kodu içeren mesaj yapıştırın. Eksik veya birden fazla farklı kodla arama yapılamaz.' : 'Hata mesajının tamamını yapıştırabilirsiniz; yalnız takip kodu sorgulanır.'}</span></label>
      <button className="btn secondary small-btn" disabled={busy || !code} title={!code ? 'Önce geçerli bir takip kodu girin.' : undefined}><Search size={16} />{busy ? 'Aranıyor…' : 'Kaydı bul'}</button>
    </form>{error && <p role="alert">{error}</p>}
    {result && (result.record ? <dl className="device-check-list"><div><dt>Zaman</dt><dd>{new Date(result.record.at).toLocaleString('tr-TR')}</dd></div><div><dt>Hata</dt><dd>{result.record.code} · {result.record.status}</dd></div><div><dt>İşlem</dt><dd>{result.record.method} {result.record.route}</dd></div><div><dt>Süre</dt><dd>{result.record.elapsedMs} ms</dd></div></dl> : <p role="status">Kayıt bulunamadı. Kod başka sunucuya ait olabilir, işletmenin bilgisayarı henüz bağlanmamış olabilir ya da süre veya kayıt sınırı aşılmış olabilir. Bu sonuç işlemin gerçekleşmediği anlamına gelmez.</p>)}</>;
}

/** Destek tab: pick any business for its report, or look up a code. Collapsed until needed. */
export function PlatformDiagnostics({ businesses }: { businesses: { tenantId: string; name: string }[] }) {
  const [tenant, setTenant] = useState(''), report = useReportDownload();
  return <details className="panel platform-diagnostics"><summary>Hata takip kodunu sorgula</summary>
    <div className="diagnostics-export"><label>İşletme hata raporu<select value={tenant} onChange={e => setTenant(e.target.value)}><option value="">İşletme seçiniz</option>{businesses.map(b => <option key={b.tenantId} value={b.tenantId}>{b.name}</option>)}</select></label><button type="button" className="btn secondary small-btn" disabled={!tenant || report.busy} onClick={() => void report.download(tenant)}><Download size={15} />Hata raporunu indir</button><HelpTip title="Hata kayıtları">{RETENTION}</HelpTip></div>
    {report.error && <p role="alert">{report.error}</p>}
    <TrackingLookup />
  </details>;
}

/** Business detail "Hatalar": the same report and lookup for the business on screen. */
export function BusinessDiagnostics({ tenantId }: { tenantId: string }) {
  const report = useReportDownload();
  const [records, setRecords] = useState<FailureRecord[] | null>(null), [listError, setListError] = useState('');
  useEffect(() => { void api<{ records: FailureRecord[] }>(`${ADMIN}/diagnostics/list`, { tenantId }).then(r => setRecords(r.records), e => setListError((e as Error).message)); }, [tenantId]);
  return <section className="platform-detail-section">
    <div className="detail-section-head"><h3>Hata raporu <HelpTip title="Hata kayıtları">{RETENTION}</HelpTip></h3><button type="button" className="btn secondary small-btn" disabled={report.busy} onClick={() => void report.download(tenantId)}><Download size={15} />{report.busy ? 'Hazırlanıyor…' : 'Hata raporunu indir'}</button></div>
    <p className="muted small">İşletmenin bilgisayarından gelen son sunucu hataları. Kullanıcı hataları (yanlış şifre, eksik alan) kaydedilmez.</p>
    {report.error && <p role="alert">{report.error}</p>}
    {listError ? <p role="alert">{listError}</p> : !records ? <p className="muted small">Yükleniyor…</p> : records.length ? <table className="failure-table" aria-label="Son hatalar"><thead><tr><th>Zaman</th><th>Hata</th><th>İşlem</th><th>Kodun yeri</th><th>Takip kodu</th></tr></thead>
      <tbody>{records.slice(0, 50).map(r => <tr key={r.requestId}><td>{new Date(r.at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</td><td>{r.code} · {r.status}</td><td>{r.method} {r.route}</td><td>{r.frames?.[0] ?? '—'}</td><td><code>{r.requestId.slice(0, 8)}</code></td></tr>)}</tbody></table>
      : <p className="muted small">Bu işletmeden hata kaydı gelmedi.</p>}
    <h3 className="detail-subhead">Takip kodu sorgula</h3>
    <TrackingLookup />
  </section>;
}

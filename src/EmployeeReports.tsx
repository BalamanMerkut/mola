import { RefreshStatus } from './RefreshStatus';
import { useEffect, useState } from 'react';
import type { EmployeeReport } from '../packages/domain/reports';
import { api, money } from './api';
import { Notice } from './components';
import { EmployeeDonut, SelfServiceChart, roleName } from './ReportCharts';
import type { Range } from './SalesReports';
import { HelpTip } from './HelpTip';

/** Uses the period chosen at the top of Satış ve raporlar. */
export function EmployeeReports({ range }: { range: Range }) {
  const [data, setData] = useState<EmployeeReport | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    api<EmployeeReport>(`/api/staff/reports/employees?from=${range.from}&to=${range.to}`).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range]);
  return <>
    {loading && data && <RefreshStatus />}{error && <Notice tone="error">{error}{data && " Önceki sonuçlar gösteriliyor; yeni tarih aralığı henüz doğrulanmadı."}</Notice>}{!data && !error && <p role="status" className="report-loading">Rapor yükleniyor…</p>}
    {data && <>{!data.rows.some(r => r.orders || r.cancelled) && <Notice>Bu tarih aralığında sipariş bulunmuyor.</Notice>}
      <div className="employee-chart-grid"><SelfServiceChart data={data.selfService} /><EmployeeDonut rows={data.rows} /></div>
      <section className="panel employee-accounts"><div className="report-section-heading"><h3>Hesaplara göre ayrıntılar<HelpTip title="Çalışan karşılaştırması">Siparişler, siparişi alan hesaba ve oluşturulma tarihine göre gösterilir. QR siparişleri çalışanlara yazılmaz. Vardiya süresi ve masa yoğunluğu karşılaştırmaya dahil değildir. İptaller ayrı sayılır. Sipariş tutarı tahsilat veya net gelir değildir; açık hesapları da içerir.</HelpTip></h3><span className="muted small">İptaller hariç</span></div><div className="employee-detail-grid">{data.rows.map(r => <article className="report-row" key={r.id}><div className="report-row-title"><div><strong>{r.name}</strong><small>{r.source === 'qr' ? 'QR' : r.active ? roleName(r) : `Kapalı hesap · ${roleName(r)}`}</small></div><span className="employee-order-count">{r.orders}<small>sipariş</small></span></div><div className="report-metrics"><span>{r.items} ürün</span><span>Sipariş tutarı: {money(r.amount)}</span><span>{r.cancelled} iptal</span></div></article>)}</div></section>
    </>}
  </>;
}

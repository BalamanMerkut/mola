import type { EmployeeSummary, EmployeeReport } from '../packages/domain/reports';
import { HelpTip } from './HelpTip';
import { roleNames } from '../packages/domain/roles';

export const roleName = (r: EmployeeSummary): string => r.role ? roleNames[r.role] : r.source === 'qr' ? 'QR menü' : 'Eski çalışan';
const colors = ['#285447', '#b88446', '#668cb0', '#9876a3', '#579b89', '#cd826d', '#899148', '#687381'];
export function SelfServiceChart({ data }: { data: EmployeeReport['selfService'] }) {
  const total = data.qrOrders + data.staffOrders;
  const share = total ? data.qrOrders / total * 100 : 0;
  const percentage = share.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  return <section className="employee-distribution self-service-report"><h3>Müşterilerin kendi verdiği siparişler</h3><div className="donut-layout"><div className="employee-donut" role="img" aria-label={`QR sipariş payı: ${total ? `%${percentage}` : 'veri yok'}`} style={{ background: total ? `conic-gradient(#285447 0% ${share}%, #b88446 ${share}% 100%)` : '#e5ebe6' }}><div><strong>{total ? `%${percentage}` : '—'}</strong><span>QR sipariş payı</span></div></div><div className="donut-legend"><div className="donut-legend-row"><span className="donut-key" style={{ background: '#285447' }} /><strong>Müşteri · QR menü</strong><span>{data.qrOrders} sipariş</span></div><div className="donut-legend-row"><span className="donut-key" style={{ background: '#b88446' }} /><strong>Çalışan üzerinden</strong><span>{data.staffOrders} sipariş</span></div></div></div><p className="report-chart-caption">{data.approximate ? 'yaklaşık ' : ''}{data.browserCount.toLocaleString('tr-TR')} farklı tarayıcı · {data.accountCount.toLocaleString('tr-TR')} masa hesabı<HelpTip title="QR sipariş ölçümü">{`İptal edilmeyen QR siparişlerinin tüm siparişlere oranıdır. Müşterinin hiç yardım almadığını doğrulamaz. Farklı tarayıcı sayısı kesin kişi sayısı değildir: ortak telefon, gizli sekme veya silinen çerezler sonucu etkileyebilir. Sipariş değişikliği ve masa taşıma yeni sipariş sayılmaz.${data.approximate ? ' Uzun dönemlerde aylar toplanır: birden çok ayda gelen aynı tarayıcı her ayda bir kez sayılır, bu yüzden sayı yaklaşıktır.' : ''}`}</HelpTip></p>{!total && <p className="muted small">Bu tarih aralığında karşılaştırılacak sipariş bulunmuyor.</p>}</section>;
}
export function EmployeeDonut({ rows }: { rows: EmployeeSummary[] }) {
  const staff = rows.filter(r => r.source === 'staff' && r.orders > 0);
  const total = staff.reduce((n, r) => n + r.orders, 0);
  // Keep the chart readable for large teams; the detailed rows below retain every person.
  const slices: (Pick<EmployeeSummary, 'id' | 'name' | 'orders'> & { role?: string })[] = staff.length > 8 ? [...staff.slice(0, 7).map(r => ({ ...r, role: roleName(r) })), { id: 'other', name: 'Diğer çalışanlar', orders: staff.slice(7).reduce((n, r) => n + r.orders, 0) }] : staff.map(r => ({ ...r, role: roleName(r) }));
  let offset = 0;
  const stops = slices.map((r, i) => { const start = offset; offset += r.orders / total * 100; return `${colors[i]} ${start}% ${offset}%`; });
  return <section className="employee-distribution"><h3>Çalışanların sipariş dağılımı</h3><div className="donut-layout"><div className="employee-donut" role="img" aria-label={`Çalışan sipariş dağılımı: toplam ${total} sipariş`} style={{ background: total ? `conic-gradient(${stops.join(',')})` : '#e5ebe6' }}><div><strong>{total}</strong><span>sipariş</span></div></div><div className="donut-legend">{!total && <p className="muted small">Bu dönemde çalışan siparişi bulunmuyor.</p>}{slices.map((r, i) => <div className="donut-legend-row" key={r.id}><span className="donut-key" style={{ background: colors[i] }} /><strong>{r.name}{r.role && <small className="role-tag">{r.role}</small>}</strong><span>{r.orders} sipariş · %{(r.orders / total * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</span></div>)}</div></div><p className="report-chart-caption">İptaller ve müşteri QR siparişleri hariç.</p></section>;
}

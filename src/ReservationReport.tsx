import { useEffect, useState } from 'react';
import type { EventReport, ReservationPeriod } from '../packages/domain/reservations';
import { longDay } from '../packages/domain/agenda';
import { api, money } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { RefreshStatus } from './RefreshStatus';
import './reservations.css';

/*
 * Satış ve Raporlar → Rezervasyon: reservations of the period (by their day): how many came, did not come or were cancelled,
 * the kapora money (taken, paid bills, kept, given back, waiting), the sales on reserved and event tables, and each event
 * (tables used, guests, sales, walk-in sales, kapora). Kapora that paid a bill is already in the sales; a kept kapora is a
 * separate income line, never a sale. Loaded from GET /api/staff/reports/reservations.
 */
type Report = { from: string; to: string; period: ReservationPeriod; sales: { orders: number; amount: number; collected: number }; events: EventReport[] };

/** 9 Ekim kullanıcı testi: 5 yılda "3652", "14697 kişi" binlik ayırıcısız okunuyordu. */
const n = (value: number) => value.toLocaleString('tr-TR');
export function ReservationReport({ range }: { range: { from: string; to: string } }) {
  const [data, setData] = useState<Report | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    api<Report>(`/api/staff/reports/reservations?from=${range.from}&to=${range.to}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError((e as Error).message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [range.from, range.to]);
  if (!data) return error ? <Notice tone="error">{error}</Notice> : <p role="status" className="report-loading">Rapor yükleniyor…</p>;
  const p = data.period, d = p.deposits;
  return <div className="resv-report">
    {loading && <RefreshStatus />}{error && <Notice tone="error">{error} Önceki sonuçlar gösteriliyor.</Notice>}
    <div className="kpi-row">
      <article className="kpi"><span>Rezervasyon satışı<HelpTip title="Rezervasyon satışı">Ayrılmış masalarda ve etkinlik masalarında verilen siparişler (iptaller hariç). Hesaba düşülen kapora bu satışın içindedir.</HelpTip></span><strong>{money(data.sales.amount)}</strong><small>{n(data.sales.orders)} sipariş · tahsil edilen {money(data.sales.collected)}</small></article>
      <article className="kpi"><span>Rezervasyon</span><strong>{n(p.count)}</strong><small>Geldi {n(p.seated)} · Gelmedi {n(p.noShow)} · İptal {n(p.cancelled)}{p.booked ? ` · Bekleniyor ${p.booked}` : ''}</small></article>
      <article className="kpi kpi-main"><span>Gelme oranı<HelpTip title="Gelme oranı">Gelen ÷ (gelen + gelmeyen). İptal edilenler ve henüz beklenenler sayılmaz.</HelpTip></span><strong>{p.showRate === null ? '—' : `%${Math.round(p.showRate * 100)}`}</strong><small>{n(p.seatedPeople)} kişi geldi</small></article>
    </div>
    <section className="panel resv-money" aria-label="Kapora"><div className="report-section-heading"><h3>Kapora<HelpTip title="Kapora">Kapora alındığı an kasaya girer. Misafir gelince hesabından düşülür ve satışın parçası olur; ikinci kez sayılmaz. Gelmeyen ya da iptal edilen rezervasyonun işletmede kalan kaporası satış değildir, burada ayrı gelir olarak görünür.</HelpTip></h3><span className="muted small">{d.takenCount} rezervasyonda</span></div>
      <dl>
        <div><dt>Alınan kapora</dt><dd>{money(d.taken)}</dd></div>
        <div><dt>Hesaplara düşülen <small>satışın içinde</small></dt><dd>{money(d.applied)}</dd></div>
        <div><dt>İşletmede kalan <small>ayrı gelir{d.noShowKept ? ` · gelmeyen kaporası ${money(d.noShowKept)}` : ''}</small></dt><dd>{money(d.kept)}</dd></div>
        <div><dt>İade edilen</dt><dd>{money(d.refunded)}</dd></div>
        {d.pending > 0 && <div className="warn"><dt>Karar bekleyen <small>Ajanda ve rezervasyon → Rezervasyonlar</small></dt><dd>{money(d.pending)}</dd></div>}
      </dl></section>
    <section className="panel product-table resv-events"><div className="report-section-heading"><h3>Etkinlikler</h3><span className="muted small">{data.events.length ? `${data.events.length} etkinlik` : ''}</span></div>
      {!data.events.length ? <p className="report-empty-note">Bu dönemde etkinlik yok.</p> : <ul className="resv-event-rows">{data.events.map(e => <li key={e.id}>
        <div className="resv-event-title"><strong>{e.name}</strong><span className="muted small">{longDay(e.day)} · {e.start}{e.end ? `–${e.end}` : ''}{e.closed ? '' : ' · açık'}</span></div>
        <dl>
          <div><dt>Masa</dt><dd>{e.tablesUsed} / {e.tables}</dd></div>
          <div><dt>Kişi</dt><dd>{e.people}</dd></div>
          <div><dt>Satış</dt><dd>{money(e.revenue)}</dd></div>
          <div><dt>Rezervasyonsuz satış</dt><dd>{money(e.walkInRevenue)}</dd></div>
          <div><dt>Rezervasyon</dt><dd>{e.reservations} · geldi {e.seated} · gelmedi {e.noShow}</dd></div>
          <div><dt>Alınan kapora</dt><dd>{money(e.deposits.taken)}</dd></div>
          <div><dt>Gelmeyen kaporası</dt><dd>{money(e.deposits.noShow)}{e.deposits.noShow ? <small>{e.deposits.noShowKept ? ` kalan ${money(e.deposits.noShowKept)}` : ''}{e.deposits.noShowRefunded ? ` · iade ${money(e.deposits.noShowRefunded)}` : ''}{e.deposits.pending ? ` · karar bekliyor` : ''}</small> : null}</dd></div>
        </dl>
      </li>)}</ul>}
    </section>
  </div>;
}

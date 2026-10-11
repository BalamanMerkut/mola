import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, Globe, Info, Printer, QrCode, RefreshCw, TriangleAlert, Wifi } from 'lucide-react';
import QRCode from 'qrcode';
import type { StaffSnapshot, TableView } from '../packages/domain/types';
import { qrAddressChanged } from '../packages/domain/qr-address';
// The table's name under each code: large and bold, smaller only for long custom names (packages/domain/table-label.ts).
import { tableLabelSize } from '../packages/domain/table-label';
import { api, requestId } from './api';
import { Notice } from './components';
import { usePackage } from './FeatureLock';
import { HelpTip } from './HelpTip';
import { areaName } from './TableAreaPicker';
import { A4_CUTS, standCard, standPdf, type StandBusiness, type StandLabel, type StandPaper } from './tableStand';
import './settings-qr.css';

/**
 * public (İnternetten menü, server/guest-tunnel.ts): Mola Merkez's public menu address of this business (https://<site>/q/<kod>)
 * once it is ready; the table QR codes then hold it and open on any network. publicProblem: why not yet ('local': this café
 * serves no built guest page, the development server; 'inactive': not activated; 'old': Mola Merkez does not take it yet;
 * 'private': Mola Merkez is not on the internet yet (Mola Yönetim on a computer, before the VDS); 'waiting': the code comes
 * with the next heartbeat). Until then the QR codes hold this computer's LAN address.
 */
export type Network = { lan: boolean; addresses: { name: string; origin: string }[]; printed?: { origin: string; at: string }; public?: { base: string; connected: boolean }; publicProblem?: 'local' | 'inactive' | 'old' | 'waiting' | 'private' };
const loopback = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
/** The address phones should open: on the café computer itself (localhost) the first LAN address, otherwise this page's own. */
export const qrBase = (n: Network | null) => n?.lan && loopback() && n.addresses.length ? n.addresses[0].origin : location.origin;
/** The address a table's QR holds: Mola Merkez's public menu address when it is ready (any network), else `lanBase` (Wi-Fi only). */
export const tableQrUrl = (n: Network | null, lanBase: string, token: string) => n?.public ? `${n.public.base}/${token}` : `${lanBase}/m/${token}`;
/** What the printed set is recorded as (`qr-printed`): the public base, or the LAN origin. */
export const qrOrigin = (n: Network | null, lanBase: string) => n?.public?.base ?? lanBase;
/** The printed QR codes still hold the LAN address although the public one is ready: they open only on the café's Wi-Fi. */
export const reprintForInternet = (n: Network | null) => !!n?.public && !!n.printed && n.printed.origin !== n.public.base && !/\/q\/[A-Za-z0-9]{10}$/.test(n.printed.origin);
/** Remembers which address the printed or downloaded QR codes hold, so a later address change can be noticed. */
export function recordQrOrigin(origin: string) { void api('/api/staff/qr-printed', { origin }).catch(() => { /* only a reminder */ }); }

export function useNetwork(every = 0) {
  const [network, setNetwork] = useState<Network | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => api<Network>('/api/staff/network').then(n => { if (live) setNetwork(n); }).catch(() => {});
    void read(); const t = every ? setInterval(() => { if (!document.hidden) void read(); }, every) : undefined;
    return () => { live = false; if (t) clearInterval(t); };
  }, [every]);
  return [network, setNetwork] as const;
}
export const changed = (n: Network | null) => !!n && !n.public && qrAddressChanged(n.printed?.origin, n.addresses.map(a => a.origin));

/**
 * Owner's warning on Masalar: the computer's network address changed since the table QR codes were printed, or (İnternetten
 * menü) the public address is ready while the printed codes still hold the Wi-Fi-only one.
 */
export function QrAddressNotice({ onReprint }: { onReprint?: () => void }) {
  const [network] = useNetwork(120_000);
  if (reprintForInternet(network)) return <div className="qr-address-warning qr-internet-ready" role="status"><Globe size={18} aria-hidden="true" /><div><strong>Masa QR kodları internet adresiyle yeniden basılmalı.</strong><p>Masalardaki QR kodları yalnız işletmenin Wi-Fi'sinde açılıyor. Yeni QR kodları misafirin kendi mobil verisiyle ve her Wi-Fi'den açılır.</p></div>{onReprint && <button type="button" className="btn primary small-btn" onClick={onReprint}><Printer size={15} />QR'ları yeniden yazdır</button>}</div>;
  if (!changed(network)) return null;
  return <div className="qr-address-warning" role="alert"><TriangleAlert size={18} aria-hidden="true" /><div><strong>Bilgisayarın ağ adresi değişti; basılı QR'lar çalışmayabilir.</strong><p>Masalardaki QR kodları eski adresi ({network!.printed!.origin.replace(/^https?:\/\//, '')}) açıyor. Yeni QR'ları yazdırıp masalara yapıştırın.</p><small>Modemden bu bilgisayara sabit IP (DHCP rezervasyonu) verdirirseniz bu olmaz.</small></div>{onReprint && <button type="button" className="btn primary small-btn" onClick={onReprint}><Printer size={15} />QR'ları yeniden yazdır</button>}</div>;
}

/**
 * İnternetten menü is ready: the QR codes hold Mola Merkez's public address and open on any network (the guest's own mobile
 * data too); the menu itself still comes from this computer, so it opens only while Mola is running here.
 */
function InternetMenuNote({ network }: { network: Network }) {
  const pub = network.public!, shown = pub.base.replace(/^https?:\/\//, '');
  return <div className="qr-internet-note" data-connected={pub.connected ? 'yes' : 'no'}>
    <Globe size={18} aria-hidden="true" />
    <div><p className="settings-card-note"><strong>QR kodları internet adresini taşır</strong> (<code className="settings-code">{shown}/…</code>): misafirler menüyü kendi mobil verisiyle ya da herhangi bir Wi-Fi'den açar. <HelpTip title="İnternetten menü">Menü Mola Merkez üzerinden açılır ama siparişler, hesaplar ve menünüz bu bilgisayarda kalır. Bu bilgisayar kapalıyken ya da internete bağlı değilken misafir "Menü şu anda açılamıyor. Lütfen garsonunuza sorun." görür.</HelpTip></p>
      <span className={`settings-chip qr-internet-state ${pub.connected ? 'ok' : 'warn'}`}>{pub.connected ? <><Wifi size={14} aria-hidden="true" />Bağlı: menü internetten açılıyor</> : 'Şu anda bağlı değil: bu bilgisayarın internetini kontrol edin'}</span></div>
  </div>;
}
/** Not ready yet: the codes keep the Wi-Fi address, and must be printed again once the public address is there. */
function InternetMenuPending({ problem }: { problem: 'inactive' | 'old' | 'waiting' | 'private' }) {
  // Mola Merkez still on a computer (no VDS yet): nothing to wait for here, the address comes with the server.
  if (problem === 'private') return <p className="settings-card-note qr-internet-pending" data-problem="private"><Info size={15} aria-hidden="true" /><span><strong>Şimdilik yalnız işletmenin Wi-Fi'sinde açılır.</strong> QR kodları şu an kafenin Wi-Fi adresini taşır; internet adresi Mola sunucusu (VDS) kurulunca gelir. QR kodları internet adresi hazır olunca yeniden basılmalı.</span></p>;
  const why =problem === 'old' ? 'Mola Merkez henüz internetten menüyü desteklemiyor; Mola ekibi güncelleyince hazır olur.' : problem === 'inactive' ? 'Mola bu bilgisayarda etkinleştirilince hazır olur.' : 'Mola Merkez’den internet adresi bekleniyor (birkaç dakika).';
  return <p className="settings-card-note qr-internet-pending"><Info size={15} aria-hidden="true" /><span><strong>Şimdilik yalnız işletmenin Wi-Fi'sinde açılır.</strong> {why} QR kodları internet adresi hazır olunca yeniden basılmalı.</span></p>;
}

/** A print job: the A4 sheet of 6 or 12 codes, or the A6 table stand cards (four on A4 with cut lines, or one per A6 sheet). */
type Sheet = { base: string } & ({ per: 6 | 12; cells: { name: string; image: string }[] } | { per: 'a6'; paper: StandPaper; cards: { name: string; image: string; label: StandLabel }[] });
type Layout = 6 | 12 | 'a6';
/** "Seçtiğim masalar" in "Hangi masalar?" (area ids are words, never this). */
const PICK = '#pick';
/** Saves a file made in the browser (the stand cards' PDF) under its name. */
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/** Ayarlar → Masa QR kodları: print every table's QR on A4 or as A6 table stand cards, warn about a changed address, renew one leaked code. */
/**
 * `page`: shown as an open card (no fold). `show` splits it for Ayarlar's sub-tabs: 'status' (Masalar ve QR: the address the
 * codes carry, Wi-Fi or internet, and renewing one table's code), 'print' (QR kodlarını yazdır); 'all' (Uzaktan destek) both.
 */
export function QrCodesCard({ data, open: openAtStart = false, onSaved, page = false, show = 'all' }: { data: StaffSnapshot; open?: boolean; onSaved: () => void; page?: boolean; show?: 'all' | 'status' | 'print' }) {
  const status = show !== 'print', printing = show !== 'status';
  // A link that opens the codes ("QR'ları yeniden yazdır") unfolds the folded card and brings it into view; Ayarlar lands on its own sub-tab.
  const [openFold, setOpen] = useState(openAtStart), card = useRef<HTMLDetailsElement>(null), open = page || openFold;
  useEffect(() => { if (openAtStart) { setOpen(true); requestAnimationFrame(() => card.current?.scrollIntoView({ block: 'start' })); } }, [openAtStart]);
  const [network, setNetwork] = useNetwork();
  const areas = [...new Set(data.tables.map(t => t.area ?? ''))];
  const [scope, setScope] = useState('all'), [per, setPer] = useState<Layout>(6), [chosenBase, setBase] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [paper, setPaper] = useState<StandPaper>('a4'), [picked, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const pk = usePackage();
  const base = chosenBase || qrBase(network);
  const tables = data.tables.filter(t => scope === 'all' || (scope === PICK ? picked.includes(t.id) : (t.area ?? '') === scope));
  const business: StandBusiness = { name: data.name, logo: data.logo, theme: data.theme, orders: pk.has('qr-order') };
  const noted = (origin: string) => { recordQrOrigin(origin); setNetwork(n => n && { ...n, printed: { origin, at: new Date().toISOString() } }); };
  async function print() {
    setBusy(true); setError('');
    try {
      if (per === 'a6') {
        // One card at a time, kept as a PNG: the 300 dpi canvases are let go at once.
        const cards: Extract<Sheet, { per: 'a6' }>['cards'] = [];
        for (const t of tables) { const { canvas, label } = await standCard(t.name, tableQrUrl(network, base, t.token), business); cards.push({ name: t.name, image: canvas.toDataURL('image/png'), label }); canvas.width = 0; }
        setSheet({ per, paper, base: qrOrigin(network, base), cards });
        return;
      }
      // The same QR drawing as the single table window, larger for paper.
      const cells = await Promise.all(tables.map(async t => ({ name: t.name, image: await QRCode.toDataURL(tableQrUrl(network, base, t.token), { width: 480, margin: 1, color: { dark: '#000000', light: '#ffffff' } }) })));
      setSheet({ per, base: qrOrigin(network, base), cells });
    } catch { setError('QR kodları hazırlanamadı. Tekrar deneyin.'); setBusy(false); }
  }
  async function pdf() {
    setBusy(true); setError('');
    try {
      const blob = await standPdf(tables.length, async i => (await standCard(tables[i].name, tableQrUrl(network, base, tables[i].token), business)).canvas, paper, `${data.name} · masa QR kartları`);
      saveFile(blob, paper === 'a4' ? 'masa-qr-a6-4lu.pdf' : 'masa-qr-a6.pdf');
      noted(qrOrigin(network, base));
    } catch { setError('PDF hazırlanamadı. Tekrar deneyin.'); } finally { setBusy(false); }
  }
  // Prints once the sheet is on the page (images are data URLs, ready at once); the sheet leaves after the print dialog.
  useEffect(() => {
    if (!sheet) return;
    const done = () => { setSheet(null); setBusy(false); };
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => { noted(sheet.base); window.print(); }, 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [sheet]);
  const stand = per === 'a6', pages = Math.ceil(tables.length / (stand ? (paper === 'a4' ? 4 : 1) : per));
  const address = network?.addresses.length ? base.replace(/^https?:\/\//, '') : '';
  const segment = <T,>(value: T, current: T, set: (v: T) => void, label: ReactNode, className = '') => <button type="button" aria-pressed={value === current} className={`${value === current ? 'selected' : ''} ${className}`.trim()} disabled={busy} onClick={() => set(value)}>{label}</button>;
  const options = <>
        <div className="qr-print-options">
          <label className="settings-field"><span className="settings-field-label">Hangi masalar?</span><select value={scope} disabled={busy} onChange={e => setScope(e.target.value)}><option value="all">Bütün masalar ({data.tables.length})</option>{areas.length > 1 && areas.map(a => <option key={a} value={a}>{areaName(a)} masaları ({data.tables.filter(t => (t.area ?? '') === a).length})</option>)}<option value={PICK}>Seçtiğim masalar ({picked.filter(id => data.tables.some(t => t.id === id)).length})</option></select></label>
          <div className="settings-field qr-per-page"><span className="settings-field-label" id="settings-qr-per">Baskı</span>
            <div className="settings-segmented" role="group" aria-labelledby="settings-qr-per">{([6, 12] as const).map(n => <Fragment key={n}>{segment<Layout>(n, per, setPer, `${n} QR`)}</Fragment>)}{segment<Layout>('a6', per, setPer, <>A6 masa standı <small>(10,5 × 14,8 cm)</small></>, 'qr-layout-stand')}</div></div>
          {stand && <div className="settings-field qr-stand-paper"><span className="settings-field-label" id="settings-qr-paper">Kâğıt</span>
            <div className="settings-segmented" role="group" aria-labelledby="settings-qr-paper">{segment<StandPaper>('a4', paper, setPaper, "A4'e 4'lü (kesim çizgili)")}{segment<StandPaper>('a6', paper, setPaper, 'A6 kâğıda tek')}</div></div>}
          {network && !network.public && network.addresses.length > 1 && <label className="settings-field"><span className="settings-field-label">Ağ adresi</span><select value={base} disabled={busy} onChange={e => setBase(e.target.value)}>{network.addresses.map(a => <option key={a.origin} value={a.origin}>{a.name} · {a.origin.replace(/^https?:\/\//, '')}</option>)}</select></label>}
        </div>
        {scope === PICK && <fieldset className="qr-pick" disabled={busy}><legend className="settings-field-label">Yazdırılacak masalar</legend>
          <div className="qr-pick-list">{data.tables.map(t => <label key={t.id} className={picked.includes(t.id) ? 'selected' : ''}><input type="checkbox" checked={picked.includes(t.id)} onChange={e => setPicked(p => e.target.checked ? [...p, t.id] : p.filter(id => id !== t.id))} />{t.name}</label>)}</div>
          <div className="qr-pick-actions"><button type="button" className="text-btn" onClick={() => setPicked(data.tables.map(t => t.id))}>Hepsini seç</button><button type="button" className="text-btn" onClick={() => setPicked([])}>Temizle</button></div>
        </fieldset>}
        <div className="qr-print-summary"><span className="settings-chip">{tables.length} masa · {pages} sayfa {stand && paper === 'a6' ? 'A6' : 'A4'}</span><span className="settings-field-hint">{stand ? 'Her masaya bir kart: üstte işletmenin adı, ortada büyük QR, altında masa adı çok büyük harflerle.' : <>Her kodun altında masa adı büyük ve kalın harflerle, altında kısa bir açıklama yazar. {per === 12 ? 'Küçük kodlar masaya yakın okutulmalı.' : 'Büyük kodlar uzaktan da okunur.'}</>}</span></div>
        {stand && <p className="settings-card-note qr-stand-help"><Info size={15} aria-hidden="true" />Akrilik A6 masa standına tam oturur. Mat kâğıda basın; parlak kâğıt ışığı yansıtır ve QR okunmayabilir. Her masa için bir yedek basıp kasada saklayın.</p>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="settings-actions"><button type="button" className="btn primary" disabled={busy || !tables.length} onClick={() => void print()}><Printer size={16} aria-hidden="true" />{busy ? 'Hazırlanıyor…' : 'Yazdır'}</button>
          {stand && <button type="button" className="btn secondary" disabled={busy || !tables.length} onClick={() => void pdf()}><Download size={16} aria-hidden="true" />PDF indir</button>}</div>
  </>;
  const body = <>
    {open && <div className="settings-blocks-content">
      {status && (network?.public ? <InternetMenuNote network={network} /> : changed(network) ? <QrAddressNotice /> : <><p className="settings-card-note">QR kodları bu bilgisayarın ağ adresini taşır{address ? <> (<code className="settings-code">{address}</code>)</> : ''}. Modem bu adresi değiştirirse basılı QR'lar açılmaz; Mola bunu fark edip size söyler. <HelpTip title="Sabit adres">Modemin ayarlarından bu bilgisayara sabit IP (DHCP rezervasyonu) verdirirseniz adres değişmez ve QR'ları yeniden basmanız gerekmez.</HelpTip></p>{network?.publicProblem && network.publicProblem !== 'local' && <InternetMenuPending problem={network.publicProblem} />}</>)}
      {/* Printing alone: one line on the address the new codes carry; a changed address still warns here. */}
      {!status && (changed(network) ? <QrAddressNotice /> : network && <p className="qr-print-address"><span className={`settings-chip ${network.public ? 'ok' : ''}`}>{network.public ? <><Globe size={14} aria-hidden="true" />İnternet adresi: her ağdan açılır</> : <><Wifi size={14} aria-hidden="true" />Wi-Fi adresi{address ? `: ${address}` : ''}</>}</span><HelpTip title="QR adresi">{network.public ? 'Yeni QR kodları Mola Merkez üzerindeki internet adresini taşır; misafir kendi mobil verisiyle de açar. Ayrıntı: Masalar ve QR → Masalar ve QR.' : 'Yeni QR kodları bu bilgisayarın ağ adresini taşır ve yalnız işletmenin Wi-Fi’sinde açılır. Ayrıntı: Masalar ve QR → Masalar ve QR.'}</HelpTip></p>)}
      {reprintForInternet(network) && <QrAddressNotice />}
      {show === 'all' ? <section className="settings-subsection qr-print" aria-labelledby="settings-qr-print">
        <h4 id="settings-qr-print"><Printer size={16} aria-hidden="true" />QR kodlarını yazdır</h4>
        {options}
      </section> : printing && <div className="qr-print">{options}</div>}
      {status && <RenewTableQr tables={data.tables} onSaved={onSaved} />}
    </div>}
    {sheet && sheet.per !== 'a6' && createPortal(<div className="qr-print-root" data-testid="qr-print-sheet">{Array.from({ length: Math.ceil(sheet.cells.length / sheet.per) }, (_, sheetPage) => <section className={`qr-sheet per-${sheet.per}`} key={sheetPage}>{sheet.cells.slice(sheetPage * sheet.per, (sheetPage + 1) * sheet.per).map((c, i) => <article className="qr-cell" key={`${sheetPage}-${i}`}><small>{data.name}</small><img src={c.image} alt={`${c.name} QR kodu`} /><strong className="qr-cell-name" style={{ fontSize: `${tableLabelSize(c.name, sheet.per as 6 | 12)}pt` }}>{c.name}</strong><span>Menü ve sipariş için telefonunuzun kamerasıyla okutun.</span></article>)}</section>)}</div>, document.body)}
    {sheet && sheet.per === 'a6' && createPortal(<StandSheet paper={sheet.paper} cards={sheet.cards} />, document.body)}
  </>;
  if (page && show === 'print') return <section className="settings-card qr-codes-card qr-print-card" aria-labelledby="settings-qr-title">
    <div className="settings-card-head"><Printer size={18} aria-hidden="true" /><h3 id="settings-qr-title">QR kodlarını yazdır<HelpTip title="QR kodlarını yazdır">Her masanın QR kodu A4 kâğıda 6 ya da 12 tane, ya da akrilik standa giren A6 kart olarak basılır. Kodun altında masanın adı büyük harflerle yazar. Basılan adres kaydedilir; adres değişirse Mola sizi uyarır.</HelpTip></h3><span className="settings-block-count">{data.tables.length}</span></div>
    {body}
  </section>;
  if (page) return <section className="settings-card qr-codes-card" aria-labelledby="settings-qr-title">
    <div className="settings-card-head"><QrCode size={18} aria-hidden="true" /><h3 id="settings-qr-title">Masa QR kodları</h3><span className="settings-block-count">{data.tables.length}</span></div>
    {body}
  </section>;
  return <details ref={card} className="settings-blocks qr-codes-card" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><QrCode size={18} /><span>Masa QR kodları</span><ChevronDown size={17} className="settings-disclosure-icon" /><span className="settings-tool-description">Bütün masaların QR kodunu A4 kâğıda yazdırın veya tek bir masanın kodunu yenileyin.</span></summary>
    {body}
  </details>;
}

/**
 * The A6 table stand cards while printing (src/tableStand.ts draws them): four on an A4 sheet, 2 × 2 with a dashed cut
 * cross and short crop marks at its ends, or one per A6 sheet. The page size comes with the sheet (`@page`, margin 0: the
 * cards are exactly 105 × 148 mm and keep their own white edge).
 */
function StandSheet({ paper, cards }: { paper: StandPaper; cards: Extract<Sheet, { per: 'a6' }>['cards'] }) {
  const per = paper === 'a4' ? 4 : 1, { x, y, bottom } = A4_CUTS;
  // Crop marks [left, top, width, height] in mm, 5–11 mm in from the paper's edge.
  const marks = [[x, 5, 0, 6], [x, bottom - 11, 0, 6], [5, y, 6, 0], [210 - 11, y, 6, 0]];
  return <div className={`qr-print-root qr-stand-root ${paper}`} data-testid="qr-print-sheet" data-sheet="a6">
    <style>{`@page{size:${paper === 'a4' ? 'A4 portrait' : '105mm 148mm'};margin:0}`}</style>
    {Array.from({ length: Math.ceil(cards.length / per) }, (_, n) => <section className={`qr-stand-page ${paper}`} key={n}>
      {cards.slice(n * per, (n + 1) * per).map((c, i) => <img key={i} className="qr-stand-card" src={c.image} alt={`${c.name} masa kartı`} data-label-size={c.label.size} data-label-lines={c.label.lines.length} data-label-fits={c.label.widest <= c.label.room ? 'yes' : 'no'} />)}
      {paper === 'a4' && <><i className="qr-cut v" style={{ left: `${x}mm`, height: `${bottom}mm` }} /><i className="qr-cut h" style={{ top: `${y}mm` }} />
        {marks.map(([l, t, w, h], k) => <i key={k} className="qr-crop" style={{ left: `${l}mm`, top: `${t}mm`, width: `${w}mm`, height: `${h}mm` }} />)}</>}
    </section>)}
  </div>;
}

/** Emergency tool for a leaked table link: the old QR sticker stops working and must be reprinted. */
export function RenewTableQr({ tables, onSaved }: { tables: TableView[]; onSaved: () => void }) {
  const [table, setTable] = useState(''), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const chosen = tables.find(t => t.id === table);
  async function renew() {
    setBusy(true); setError(''); setMessage('');
    try { const r = await api<{ tableName: string }>('/api/staff/tables/renew-qr', { requestId: requestId(), tableId: table }); setMessage(`${r.tableName} için yeni QR kodu oluşturuldu. “QR kodlarını yazdır” sekmesinde “Seçtiğim masalar” ile yalnız bu masayı yazdırın ya da Masalar → masa → QR menüyü aç ile indirin.`); setConfirming(false); setTable(''); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="settings-subsection renew-qr" aria-labelledby="settings-qr-renew">
    <h4 id="settings-qr-renew"><RefreshCw size={16} aria-hidden="true" />Tek masanın QR kodunu yenile <HelpTip title="QR kodunu yenile">Yalnız bir masanın bağlantısı dışarı sızdıysa kullanın (örneğin masadan uzakta sipariş geliyorsa). Eski QR hemen çalışmaz olur; masaya yeni QR basılmalı. Diğer masalar etkilenmez.</HelpTip></h4>
    <div className="renew-qr-row">
      <select value={table} disabled={busy} onChange={e => { setTable(e.target.value); setConfirming(false); setMessage(''); }} aria-label="Yenilenecek masa"><option value="">Masa seçiniz</option>{tables.map(t => <option key={t.id} value={t.id} disabled={!!t.account}>{t.name}{t.account ? ' · açık hesap var' : ''}</option>)}</select>
      {!confirming ? <button type="button" className="btn secondary" disabled={!table || busy} onClick={() => setConfirming(true)}><RefreshCw size={15} aria-hidden="true" />Yenile</button>
        : <button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void renew()}>{busy ? 'Yenileniyor…' : `Evet, ${chosen?.name ?? ''} QR kodunu değiştir`}</button>}
    </div>
    {confirming && <Notice tone="error">Eski QR kodu hemen geçersiz olur. Masaya yenisi basılana kadar o masadan QR ile sipariş verilemez.</Notice>}
    {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
  </section>;
}

import { startVisiblePolling } from './visiblePolling';
import { CustomerCancellation } from './CustomerCancellation';
import { ReviewLink } from './ReviewLink';
// Sosyal medya: "Bizi takip edin" icons at the foot, in the "sent" window and with the review question (src/SocialFollow.tsx).
import { SocialFollow } from './SocialFollow';
import { socialEntries } from '../packages/domain/social-links';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode, ReceiptText, WifiOff, ChefHat, Clock3, CheckCircle2, XCircle, UserRound, Smartphone } from 'lucide-react';
import type { GuestSnapshot, PublicOrder } from '../packages/domain/types';
import { api, ApiError, money, poll, requestId } from './api';
import { demoRenewed, guestMessage, guestTableName, qrLinkProblem, qrLinkText, startsInEnglish } from './guestText';
import './daily-screens.css';
import './guest.css';
import { BusinessBrand, Brand, Composer, Empty, Notice, OrderLines, SectorIcon, Status } from './components';
import { sectorSlogan } from '../packages/domain/sector';
import { businessTheme } from './BusinessTheme';
import { MenuHero } from './MenuHero';
import { OrderEditor, EditOrderButton } from './OrderEditor';
import { OrderEditRecovery } from './OrderEditRecovery';
import { CancelRecovery } from './CancelRecovery';
import { pendingCancelKey, readPendingCancel, writePendingCancel, type PendingCancel } from './pendingCancel';
import { pendingEditKey, readPendingEdit } from './pendingEdit';
import { browserOrderStorage } from './pendingOrder';
import { ServiceCallButtons } from './ServiceCallButtons';
// "Tanıtım" label of a demo business (server/demo-reset.ts).
import { DemoBadge } from './DemoBadge';
// QR siparişleri kapalı / kafeye ulaşılamıyor (8 Ekim): the guest's lines (packages/domain/qr-ordering.ts).
import { QR_CLOSED_TEXT, QR_OFFLINE_TEXT } from '../packages/domain/qr-ordering';
// "Gizlilik" at the menu's foot: what this menu processes (TASLAK, for the lawyer).
import { GuestPrivacy } from './GuestPrivacy';
/**
 * A basket typed while the page showed Mola Merkez's menu copy (café away) is kept under that session's context; when a real
 * session starts (the café is back, or after a reload) it moves to the new one, so nothing typed is lost.
 */
const MIRROR_CONTEXT = 'mola-mirror-context';
function carryBasket(next: { guestContext: string; mirror?: boolean }) {
  try {
    if (next.mirror) { sessionStorage.setItem(MIRROR_CONTEXT, next.guestContext); return; }
    const old = sessionStorage.getItem(MIRROR_CONTEXT); if (!old || old === next.guestContext) return;
    const kept = sessionStorage.getItem(`mola-basket:${old}`);
    if (kept && !sessionStorage.getItem(`mola-basket:${next.guestContext}`)) sessionStorage.setItem(`mola-basket:${next.guestContext}`, kept);
    sessionStorage.removeItem(MIRROR_CONTEXT);
  } catch { /* storage refused: the basket just is not carried */ }
}
/** A guest may ask to cancel until the order is ready (packages/domain/engine.ts cancelOrder). */
const CANCELLABLE = ['awaiting_approval', 'new', 'preparing'];
/** How long "Siparişiniz güncellendi." stays on screen. */
const EDIT_NOTICE_MS = 4500;
/** Why this visit ended, in the guest's words: paid, moved by staff (the new table is never named) or anything else. */
function endedText(ended: GuestSnapshot['ended'], en: boolean) {
  if (ended === 'paid') return en ? 'Your bill has been closed. Thank you!' : 'Hesabınız kapandı. Teşekkür ederiz.';
  if (ended === 'moved') return en ? 'Your orders were moved to another table. Scan the QR code at your new table or ask our staff.' : 'Siparişleriniz başka bir masaya taşındı. Yeni masanızın QR kodunu okutun ya da personelden yardım isteyin.';
  return en ? 'This table session has ended. Start again to order.' : 'Bu masa oturumu sona erdi. Sipariş vermek için yeniden başlatın.';
}
/** The paid bill's calm end: a soft card in the menu's colours, one short thank-you line and a real button for a new bill. */
function BillClosed({ en }: { en: boolean }) {
  return <section className="bill-closed" role="status" aria-label={en ? 'Your bill is closed' : 'Hesabınız kapandı'}>
    <span className="bill-closed-icon" aria-hidden="true"><CheckCircle2 size={26} /></span>
    <h2>{en ? 'Your bill is closed' : 'Hesabınız kapandı'}</h2>
    <p>{en ? 'Thank you, hope to see you again.' : 'Teşekkür ederiz, yine bekleriz.'}</p>
    <button type="button" className="btn secondary" onClick={() => location.reload()}>{en ? 'Start a new order' : 'Yeni hesapla sipariş ver'}</button>
  </section>;
}
/**
 * "Masanın hesabı" (8 Ekim): the table's whole open bill, also what the waiter added; what was paid (split or partial
 * payments, the reservation's kapora) is shown and taken off, the big number is what is left to pay.
 */
function TableBill({ due, bill, staffItems, en }: { due: number; bill?: GuestSnapshot['bill']; staffItems: boolean; en: boolean }) {
  const paid = bill?.paid ?? 0, deposit = bill?.depositCredit ?? 0;
  return <div className="customer-due" role="status"><div>
    <span>{en ? 'Table bill' : 'Masanın hesabı'}</span>
    <small>{staffItems ? (en ? 'Every item at this table, also those added by staff.' : 'Masadaki tüm ürünler, garsonun ekledikleri de.') : (en ? 'Every item at this table.' : 'Masadaki tüm ürünler.')}</small>
    {bill && (paid > 0 || deposit > 0) && <small className="customer-due-lines">{en ? 'Total' : 'Toplam'} {money(bill.total)}{paid > 0 ? ` · ${en ? 'Paid' : 'Ödenen'} ${money(paid)}` : ''}{deposit > 0 ? ` · ${en ? 'Deposit' : 'Kapora'} ${money(deposit)}` : ''}</small>}
    {/* Prices include KDV; the bill says how much of it is KDV, like the printed bill (11 Ekim). */}
    {!!bill?.vat && <small className="customer-due-vat">{en ? `Prices include VAT · VAT in this bill ${money(bill.vat)}` : `Fiyatlara KDV dahildir · bu hesaptaki KDV ${money(bill.vat)}`}</small>}
  </div><div className="customer-due-left"><small>{en ? 'To pay' : 'Ödenecek'}</small><strong>{money(due)}</strong></div></div>;
}
export function Customer({ token }: { token: string }) {
  const readSequence = useRef(0);
  // Tag of the snapshot on screen, per guest session: an unchanged menu is not downloaded again on every poll.
  const shown = useRef({ session: '', tag: '' });
  const ordersTab = useRef<HTMLButtonElement>(null);
  const cancelStorageKey = pendingCancelKey(location.pathname);
  const [pendingCancel, setPendingCancel] = useState<{ record: PendingCancel; autoStart: boolean; storageUnavailable: boolean } | null>(() => { const record = readPendingCancel(browserOrderStorage(), cancelStorageKey); return record ? { record, autoStart: false, storageUnavailable: false } : null; });
  const editStorageKey = pendingEditKey(location.pathname);
  const [recoveredEdit, setRecoveredEdit] = useState(() => readPendingEdit(browserOrderStorage(), editStorageKey));
  const [editingOrder, setEditingOrder] = useState<PublicOrder | null>(null); const [editNotice, setEditNotice] = useState('');
  // K-J: "Siparişiniz güncellendi." / "iptal edildi" is a short confirmation, not a lasting banner: gone after a few seconds.
  useEffect(() => { if (!editNotice) return; const t = setTimeout(() => setEditNotice(''), EDIT_NOTICE_MS); return () => clearTimeout(t); }, [editNotice]);
  const [session, setSession] = useState<{ session: string; tableId: string; guestContext: string; mirror?: boolean } | null>(null);
  // "Gizlilik" page instead of the menu; renew: the menu copy's session gives way to a real one (SESSION_RENEW).
  const [privacy, setPrivacy] = useState(false), [renew, setRenew] = useState(0); const [data, setData] = useState<GuestSnapshot | null>(null); const [error, setError] = useState(''); const [connected, setConnected] = useState(true); const [tab, setTab] = useState<'menu' | 'orders'>('menu');
  // An old, renewed or wrong QR link: retrying the same link never helps, so the screen says what does.
  const [badLink, setBadLink] = useState(false);
  // A demo QR renewed by a reset before 5 Oct 2026 (resets keep the QRs now) ends on "Bu tanıtım yenilendi" (no retry button).
  const [renewed, setRenewed] = useState(false);
  // The phone's language first (K-H: Turkish phone → TR, any other → EN); once a guest taps EN/TR the phone remembers it (also after "new order" reloads).
  const [en, setEnState] = useState(() => { let saved: string | null = null; try { saved = localStorage.getItem('mola-language'); } catch { /* no saved choice */ } return startsInEnglish(saved, navigator.languages?.length ? navigator.languages : [navigator.language]); });
  const setEn = (value: boolean) => { setEnState(value); try { localStorage.setItem('mola-language', value ? 'en' : 'tr'); } catch { /* preference only */ } };
  const enRef = useRef(en); enRef.current = en;
  useEffect(() => { let live = true; api<{ session: string; tableId: string; guestContext: string; mirror?: boolean }>('/api/guest/session', { token }).then(r => { if (!live) return; carryBasket(r); setSession(r); }).catch(e => { if (!live) return; setBadLink(qrLinkProblem(e)); setRenewed(demoRenewed(e)); setError(guestMessage(e, en)); }); return () => { live = false; }; }, [token, renew]);
  // The browser tab names the café's menu, never the staff panel ("İşletme yönetimi" in index.html).
  useEffect(() => { document.title = `${data?.name ? `${data.name} · ` : ''}${en ? 'Menu' : 'Menü'}`; }, [data?.name, en]);
  const load = useCallback(async () => { if (!session) return; const sequence = ++readSequence.current; try { const fresh = await poll<GuestSnapshot>('/api/guest/state', shown.current.session === session.session ? shown.current.tag : '', session.session); if (sequence !== readSequence.current) return; if (fresh) { setData(fresh.data); shown.current = { session: session.session, tag: fresh.tag }; } setConnected(true); setError(''); } catch (e) { if (sequence !== readSequence.current) return; if (demoRenewed(e)) { setRenewed(true); setData(null); setError(guestMessage(e, enRef.current)); return; } if (e instanceof ApiError && e.code === 'SESSION_RENEW') { setRenew(n => n + 1); return; } if (e instanceof ApiError && e.code === 'MENU_UNAVAILABLE') { setData(null); setEditingOrder(null); shown.current = { session: '', tag: '' }; } setConnected(false);
    // Browser network texts ("Failed to fetch", "Load failed") are English noise; the connection notice already explains it.
    if (e instanceof ApiError) setError(guestMessage(e, enRef.current)); } }, [session]);
  useEffect(() => { const stop = startVisiblePolling(load, 2000); return () => { stop(); readSequence.current++; }; }, [load]);
  // First tap only asks; a stray tap next to the total must not cancel a real order.
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  useEffect(() => { if (!confirmCancel) return; const t = setTimeout(() => setConfirmCancel(null), 5000); return () => clearTimeout(t); }, [confirmCancel]);
  function cancel(o: PublicOrder) {
    if (confirmCancel !== o.id) { setConfirmCancel(o.id); return; }
    setConfirmCancel(null);
    if (!session || pendingCancel || editingOrder || recoveredEdit) return;
    const record: PendingCancel = { format: 1, number: o.number, body: { requestId: requestId(), guestContext: session.guestContext, orderId: o.id, version: o.version } };
    const saved = writePendingCancel(browserOrderStorage(), cancelStorageKey, record);
    setPendingCancel({ record, autoStart: true, storageUnavailable: !saved });
  }
  // Google review: asked once, only after this guest's bill was really paid and closed (never after staff moved or merged
  // the table, never while they are still ordering), and not again for the same bill after a reload. The café's social links
  // join it ("Bizi değerlendirin ve takip edin"); with only one of the two, only that part shows. The review link is the
  // Sosyal medya list's `review` row (packages/domain/social-links.ts socialLinksOf); the icon row here leaves it out. Without
  // "Sosyal medya ve QR kartları" in the package (`socialOff`, 6 Ekim) only the review row comes: the Google button stays (core),
  // no follow icons anywhere and no row at the menu's foot.
  const settled = !!data && !data.menuOnly && data.closed && data.ended === 'paid';
  const reviewUrl = socialEntries(data?.socialLinks).find(e => e.platform === 'review')?.url;
  const hasReview = !!reviewUrl, hasSocial = socialEntries(data?.socialLinks, ['review']).length > 0;
  const [review, setReview] = useState<'waiting' | 'shown' | 'done'>('waiting');
  useEffect(() => {
    if (!settled || review !== 'waiting' || !session || !(hasReview || hasSocial)) return;
    const key = `mola-review:${session.guestContext}`; let asked = false;
    try { asked = localStorage.getItem(key) === '1'; localStorage.setItem(key, '1'); } catch { /* ask this once anyway */ }
    setReview(asked ? 'done' : 'shown');
  }, [settled, review, session, hasReview, hasSocial]);
  if (!data || !session || renewed) return <div className="loading"><Brand /><p role="status">{badLink ? qrLinkText(en) : error || (en ? 'Loading the menu…' : 'Menünüz hazırlanıyor…')}</p>{error && !badLink && !renewed && <button className="btn secondary" onClick={() => location.reload()}>{en ? 'Try again' : 'Yeniden dene'}</button>}</div>;
  // The café cannot be reached (this phone's connection, the café computer, or Mola Merkez's menu copy is on screen).
  const offline = !data.online || !connected || !!data.mirror;
  // QR siparişleri kapalı (8 Ekim): no staff screen connected, paused after gün sonu or stopped by hand; the menu stays.
  const orderingClosed = !offline && !!data.ordering && !data.ordering.open;
  const offlineText = en ? QR_OFFLINE_TEXT.en : QR_OFFLINE_TEXT.tr, closedText = en ? QR_CLOSED_TEXT.en : QR_CLOSED_TEXT.tr;
  // Why "Siparişi gönder" is off, said next to it; the same reasons also show at the top of the page.
  const sendBlocked = data.closed ? endedText(data.ended, en) : data.blocked ? (en ? 'Please give your order to our staff.' : 'Lütfen siparişinizi personele iletin.') : offline ? offlineText : orderingClosed ? closedText : data.needsCleaning ? (en ? 'This table is being cleaned. You can order when staff marks it ready.' : 'Masa temizlik bekliyor. Garson masayı hazırladığında sipariş verebilirsiniz.') : '';
  // "Gizlilik": the privacy page instead of the menu (the polling goes on underneath).
  if (privacy) return <GuestPrivacy name={data.name} en={en} onEn={setEn} onClose={() => setPrivacy(false)} />;
  // Newest order first.
  const orders = [...data.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
  return <div className="customer business-themed" style={businessTheme(data.theme)}><header className="customer-header"><BusinessBrand name={data.name} logo={data.logo} en={en} /><DemoBadge on={data.demo} en={en} /><div className="customer-header-right"><button className="language-btn" onClick={() => setEn(!en)}>{en ? 'TR' : 'EN'}</button><span className="table-pill"><QrCode size={15} />{guestTableName(data.table.name, en)}</span></div></header><MenuHero name={data.name} value={data.menuHero} en={en} /><main className="customer-main">{!data.menuOnly && data.paymentMode === 'before_preparation' && <Notice>{en ? 'Please pay at the counter after ordering. Preparation starts after payment.' : 'Siparişten sonra ödemenizi kasada yapın. Ödemeniz alındığında hazırlık başlayacak.'}</Notice>}{pendingCancel && <CancelRecovery key={pendingCancel.record.body.requestId} pending={pendingCancel.record} storageKey={cancelStorageKey} guest={session.session} en={en} autoStart={pendingCancel.autoStart} storageUnavailable={pendingCancel.storageUnavailable} onClose={() => { setPendingCancel(null); setTab('orders'); void load(); }} onDone={requested => { setPendingCancel(null); setTab('orders'); setEditNotice(requested ? '' : (en ? 'Your order was cancelled.' : 'Siparişiniz iptal edildi.')); void load(); }} />}{!pendingCancel && recoveredEdit && <OrderEditRecovery pending={recoveredEdit} storageKey={editStorageKey} guest={session.session} en={en} onClose={() => { setRecoveredEdit(null); setTab('orders'); void load(); }} onSaved={() => { setRecoveredEdit(null); setTab('orders'); setEditNotice(en ? 'Order updated.' : 'Siparişiniz güncellendi.'); void load(); }} />}{!pendingCancel && !recoveredEdit && editingOrder && <OrderEditor order={editingOrder} products={data.products} seconds={data.changeSeconds} guest={session.session} guestContext={session.guestContext} available={connected && data.online && !data.closed && !!data.orders.find(o => o.id === editingOrder.id)?.canEdit} en={en} onClose={() => setEditingOrder(null)} onSaved={() => { setEditingOrder(null); setEditNotice(en ? 'Order updated.' : 'Siparişiniz güncellendi.'); void load(); }} />}{editNotice && <Notice tone="success">{editNotice}</Notice>}{!data.menuOnly && <><div className="customer-tabs"><button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}><SectorIcon sector={data.sector} size={17} />{en ? 'Our menu' : 'Menümüz'}</button><button ref={ordersTab} className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}><ReceiptText size={17} />{en ? 'My orders' : 'Siparişlerim'}{data.orders.length > 0 && <span>{data.orders.length}</span>}</button></div>{!data.closed && <ServiceCallButtons guest={session.session} en={en} calls={data.calls} canAskBill={!!data.tableHasAccount} disabled={offline || !!data.blocked || (!!data.ordering && !data.ordering.call)} onSent={() => void load()} />}</>}{!data.menuOnly && offline && <div className="ordering-closed-note" data-testid="ordering-offline"><Notice tone="error"><WifiOff size={17} />{offlineText}</Notice></div>}{!data.menuOnly && orderingClosed && !data.closed && <div className="ordering-closed-note" data-testid="ordering-closed"><Notice>{closedText}</Notice></div>}{!data.menuOnly && data.blocked && !data.closed && <Notice tone="error">{en ? 'Ordering from this phone has been stopped. Please give your order to our staff.' : 'Bu telefondan sipariş verilemiyor. Lütfen siparişinizi personele iletin.'}</Notice>}{!data.menuOnly && data.needsCleaning && !data.closed && <Notice>{en ? 'This table is being cleaned. Ordering will be available when staff marks it ready.' : 'Masa temizlik bekliyor. Garson masayı hazır hale getirdiğinde sipariş verebilirsiniz.'}</Notice>}{data.closed && data.ended === 'paid' ? <BillClosed en={en} /> : data.closed && <Notice>{endedText(data.ended, en)}{data.ended !== 'moved' && <button className="text-btn" onClick={() => location.reload()}>{en ? 'Start again' : 'Yeniden başlat'}</button>}</Notice>}{review === 'shown' && <div className="review-prompt"><h3 className="review-prompt-title">{hasReview && hasSocial ? (en ? 'Review and follow us' : 'Bizi değerlendirin ve takip edin') : hasReview ? (en ? 'Review us' : 'Bizi değerlendirin') : (en ? 'Follow us' : 'Bizi takip edin')}</h3><ReviewLink url={reviewUrl} en={en} /><SocialFollow links={data.socialLinks} en={en} variant="prompt" heading={false} /></div>}{error && <Notice tone="error">{error}<button className="text-btn" onClick={() => setError('')}>×</button></Notice>}{tab === 'menu' || data.menuOnly ? <Composer sentExtra={<SocialFollow links={data.socialLinks} en={en} variant="sent" />} namesEn={data.categoryNamesEn} browseOnly={!!data.menuOnly} onTrackOrder={() => { setTab('orders'); requestAnimationFrame(() => ordersTab.current?.focus()); }} newProductIds={data.newProductIds} popularProductIds={data.popularProductIds} subcategoryOrder={data.subcategories} categoryOrder={data.categories} products={data.products} tableId={session.tableId} guest={session.session} guestContext={session.guestContext} enabled={!sendBlocked} canAdd={!data.closed && !data.blocked && (offline || orderingClosed)} disabledReason={sendBlocked} changeSeconds={data.changeSeconds} sentOrders={data.orders} onSent={() => void load()} en={en} /> : <div className="customer-orders">{data.orders.length === 0 && <Empty title={en ? 'Your first order awaits' : 'İlk siparişiniz sizi bekliyor'} detail={en ? 'Choose something from the menu.' : 'Menüden güzel bir şeyler seçerek başlayın.'} />}{data.due !== undefined && !data.closed && <TableBill due={data.due} bill={data.bill} staffItems={orders.some(o => o.addedBy === 'staff')} en={en} />}{orders.map(o => <article className="customer-order" data-status={o.status} key={o.id}><div className="order-head"><h3>{en ? 'Order' : 'Sipariş'} #{o.number}</h3>{o.addedBy && <span className="customer-order-by">{o.addedBy === 'staff' ? <UserRound size={13} aria-hidden="true" /> : <Smartphone size={13} aria-hidden="true" />}{o.addedBy === 'staff' ? (en ? 'Added by staff' : 'Garson ekledi') : (en ? 'From another phone' : 'Başka telefondan')}</span>}{o.paid && o.status !== 'cancelled' && !data.closed && <span className="customer-order-paid">{en ? 'Paid' : 'Ödendi'}</span>}<span className="customer-order-status" role="status">{o.status === 'preparing' ? <ChefHat size={15} aria-hidden="true" /> : ['ready', 'served'].includes(o.status) ? <CheckCircle2 size={15} aria-hidden="true" /> : o.status === 'cancelled' ? <XCircle size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}<Status value={o.status} en={en} customer /></span></div><OrderLines order={o} en={en} products={data.products} codes={false} /><CustomerCancellation order={o} en={en} />{o.reviewReason && <Notice tone="error">{o.reviewReason}</Notice>}{!data.closed && !o.addedBy && <EditOrderButton order={o} seconds={data.changeSeconds} en={en} onClick={() => setEditingOrder(o)} />}<div className="order-foot"><strong>{o.status === 'cancelled' ? <del>{money(o.total)}</del> : money(o.total)}</strong>{/* K-I: after a declined request the café has answered; no new request from here (the server refuses it too). */}{!data.closed && !o.addedBy && CANCELLABLE.includes(o.status) && !o.cancelDeclineReason && <button className={`text-btn ${confirmCancel === o.id ? 'cancel-confirm' : ''}`} disabled={o.cancelRequested} onClick={() => void cancel(o)}>{o.cancelRequested ? (en ? 'Cancellation requested' : 'İptal talebi gönderildi') : confirmCancel === o.id ? (en ? 'Sure? Yes, cancel' : 'Emin misiniz? Evet, iptal et') : (en ? 'Cancel order' : 'Siparişi iptal et')}</button>}</div></article>)}</div>}</main><footer className="customer-footer">{!data.socialOff && <SocialFollow links={data.socialLinks} en={en} />}<Brand name={data.name} en={en} /><p>{sectorSlogan(data.sector, en)}</p>{data.menuOnly && <small>{en ? 'Please order from our staff' : 'Siparişinizi personelimize iletebilirsiniz'}</small>}<small className="made-by">Mola · Merkut Studios</small><button type="button" className="text-btn privacy-link" onClick={() => { setPrivacy(true); scrollTo(0, 0); }}>{en ? 'Privacy' : 'Gizlilik'}</button></footer></div>;
}

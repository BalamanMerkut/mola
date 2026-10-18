import { PlatformBadge } from './PlatformBadge';
import { addToCart } from './cartLines';
import { discountedPrice, productQuantity, campaignDiscountLabel } from '../packages/domain/campaigns';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Tags, Star, TrendingUp, LayoutGrid, Utensils, Coffee, CakeSlice, CupSoda, Leaf, X, Minus, Plus, ShoppingBag, Search, ArrowRight, Check, Beef, Candy, Cookie, Croissant, Dessert, Drumstick, EggFried, Fish, Hamburger, IceCreamCone, Pizza, Salad, Sandwich, Soup, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import type { CartLine, OrderLine, Product, PublicOrder } from '../packages/domain/types';
import type { Sector } from '../packages/domain/sector';
import { api, ApiError, money, requestId } from './api';
// Photos and logos under the guest menu's internet prefix (/q/<kod>/media/…); '/' everywhere else (src/basePath.ts).
import { withBase } from './basePath';
import { groupNameEn, lineNameEn, lineOptionNamesEn, menuLabelKey, menuNameEn, optionNameEn, productTextEn, type MenuNameEn } from '../packages/domain/menu-translation';
import { browserOrderStorage, clearPendingOrder, pendingOrderKey, readPendingOrder, writePendingOrder, type PendingOrder } from './pendingOrder';
import { amountLabel, cartLineTotal, defaultOption, formatWeight, matchesSearch, menuPrice, missingChoices, readNote, restoreBasket, showsNoChoice, soldByWeight, unitPriceOf, validGrams, weightBase, weightOffers, type BasketLine } from '../packages/domain/lines';
import { CartLineExtras, LineNote, NoteField, WeightPicker } from './LineFields';
import { guestMessage } from './guestText';
import { CategoryOfferBadge, CategoryOfferStrip, DealOfferBadge } from './CampaignOffers';
import { basketDealSavings, dealOfferText, giftHints, lineDealLabel } from '../packages/domain/deals';
import { optionExtra } from '../packages/domain/lines';
import './staff-cancel.css';
import { MolaCup } from './MolaLogo';

// Category tab icons by the words owners use (folded: "Çorbalar" → "corbalar"), for cafés, restaurants and dessert shops alike.
const categoryIcons: [RegExp, LucideIcon][] = [
  [/kahvalti/, EggFried], [/kahve|espresso/, Coffee], [/(^|\s)cay|bitki/, Leaf], [/corba/, Soup], [/burger/, Hamburger], [/pizza/, Pizza], [/salata/, Salad],
  [/tavuk/, Drumstick], [/balik|deniz/, Fish], [/izgara|kebap|kofte|(^|\s)et(\s|$)|etler/, Beef], [/tost|sandvic|durum|wrap/, Sandwich],
  [/baklava|serbetli/, Dessert], [/kurabiye/, Cookie], [/lokum|sekerleme|cikolatalar/, Candy], [/dondurma/, IceCreamCone], [/unlu|borek|pogaca|kruvasan|simit/, Croissant],
  [/tatli|pasta|cheesecake|sutlu|puding|kek/, CakeSlice], [/icecek|limonata|soguk|mesrubat|meyve suyu|smoothie|ayran|soda|kokteyl/, CupSoda],
  [/yemek|ana |baslangic|ara sicak|meze|atistirma/, UtensilsCrossed],
];
function MenuCategoryIcon({ category }: { category: string }) {
 const key = menuLabelKey(category), Icon = category === 'Tümü' ? LayoutGrid : categoryIcons.find(([rule]) => rule.test(key))?.[1] ?? Utensils;
 return <Icon size={14} strokeWidth={1.7} aria-hidden="true" />;
}
/** The menu's own symbol: a cup for cafés, cutlery for restaurants, a slice of cake for dessert shops. */
export function SectorIcon({ sector, size }: { sector?: Sector; size: number }) {
  const Icon = sector === 'restaurant' ? UtensilsCrossed : sector === 'dessert' ? CakeSlice : Coffee;
  return <Icon size={size} aria-hidden="true" />;
}
const artIcons: Record<Product['art'], LucideIcon> = { coffee: Coffee, tea: Leaf, cold: CupSoda, cake: CakeSlice, food: UtensilsCrossed, soup: Soup, burger: Hamburger, sweet: Cookie };
export function Brand({ light = false, name, en = false }: { light?: boolean; name?: string; en?: boolean }) {
  // The cup on a pixel grid (src/MolaLogo.tsx): sharp at every screen density, unlike the thinner scaled icon it replaces.
  return <div className={`brand ${light ? 'light' : ''}`}><span className="brand-symbol"><MolaCup /></span><div><strong>{name ?? <>mola<span>.</span></>}</strong><small>{name ? (en ? 'MENU' : 'MENÜ') : 'ADİSYON · QR MENÜ'}</small></div></div>;
}
export function BusinessBrand({ name, logo, en = false }: { name: string; logo?: string; en?: boolean }) {
 return <div className="business-brand">{logo && <span className="business-logo-frame"><img src={withBase(logo)} alt="" width={64} height={64} /></span>}<div><strong>{name}</strong><small>{en ? 'MENU' : 'MENÜ'}</small></div></div>;
}
export function ProductArt({ kind, large = false, photo, alt = '', en = false }: { kind: Product['art']; large?: boolean; photo?: string | null; alt?: string; en?: boolean }) {
  if (photo) return <div className={`product-art product-photo ${large ? 'art-large' : ''}`}><img src={withBase(photo)} srcSet={`${withBase(photo.replace('.webp', '-small.webp'))} 320w, ${withBase(photo)} 800w`} sizes={large ? '(max-width: 600px) 90vw, 520px' : '(max-width: 600px) 45vw, 260px'} alt={alt} width={800} height={800} loading={large ? 'eager' : 'lazy'} decoding="async" /></div>;
  const Icon = artIcons[kind] ?? Utensils;
  return <div className={`product-art art-${kind} ${large ? 'art-large' : ''}`}><span className="art-circle" /><Icon size={large ? 90 : 52} strokeWidth={1.05} /><span className="art-caption">{en ? 'MENU' : 'MENÜ'}</span></div>;
}
export function Modal({ title, children, onClose, wide = false, className = '', dismissible = true }: { dismissible?: boolean; className?: string; title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  const backdropPress = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} onCancel={e => { e.preventDefault(); if (dismissible) onClose(); }} onPointerDown={e => { backdropPress.current = e.button === 0 && e.target === ref.current ? { x: e.clientX, y: e.clientY } : null; }} onPointerCancel={() => { backdropPress.current = null; }} onClick={e => { const start = backdropPress.current; backdropPress.current = null; if (dismissible && e.target === ref.current && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) onClose(); }}><div className="modal-header"><h2 id={titleId}>{title}</h2>{dismissible && <button className="icon-btn" onClick={onClose} aria-label="Kapat"><X size={22} /></button>}</div>{children}</dialog>;
}
export const statusNames: Record<string, string> = { awaiting_approval: 'Garson onayı bekleniyor', new: 'Yeni sipariş', preparing: 'Hazırlanıyor', ready: 'Hazır', served: 'Teslim edildi', cancelled: 'İptal edildi' };
const statusEnglish: Record<string, string> = { awaiting_approval: 'Awaiting waiter approval', new: 'Order received', preparing: 'Preparing', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };
// Customers read "new" from their own side: the café has received it.
const customerStatus: Record<string, [string, string]> = { new: ['Sipariş alındı', 'Order received'] };
export function Status({ value, en = false, customer = false }: { value: string; en?: boolean; customer?: boolean }) { const own = customer ? customerStatus[value] : undefined; return <span className={`status status-${value}`}>{own ? own[en ? 1 : 0] : en ? statusEnglish[value] : statusNames[value]}</span>; }
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) { return <div role={tone === 'error' ? 'alert' : 'status'} className={`notice notice-${tone}`}>{children}</div>; }
export function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><ShoppingBag size={36} strokeWidth={1.2} /><h3>{title}</h3><p>{detail}</p></div>; }

function QuantityOffers({ product, en }: { product: Product; en: boolean }) {
  const offers = product.discounts?.filter(c => (c.minQuantity ?? 1) > 1 || c.remainingQuantity !== undefined) ?? [];
  // Account campaigns (packages/domain/deals.ts): "2 al 1 öde", "2 Demleme Çay alana Americano bedava".
  const deals = product.deals ?? [];
  if (!offers.length && !deals.length) return null;
  return <div className="quantity-offers">{deals.map(o => <p key={`deal-${o.id}`}><strong>{o.name}</strong> · {dealOfferText(o, en)}{o.remainingQuantity !== undefined && <span> · {en ? `Limited offer: ${o.remainingQuantity} left` : `Kampanyada kalan: ${o.remainingQuantity} adet`}</span>}</p>)}{deals.length > 0 && <small className="muted">{en ? 'Everything on your table’s bill counts together; the cheapest items are the free ones.' : 'Masanın hesabındaki bütün siparişler birlikte sayılır; bedava olan, en ucuz olandır.'}</small>}{offers.map(c => <p key={c.id}><strong>{c.name}</strong> · {en ? `${c.minQuantity ?? 1}+ of this product: ${c.kind === 'fixed' ? `${money(c.amount)} off` : `${c.percent}% off`} each` : campaignDiscountLabel(c)}{c.remainingQuantity !== undefined && <span> · {en ? `Limited offer: ${c.remainingQuantity} left` : `Kampanyada kalan: ${c.remainingQuantity} adet`}</span>}</p>)}{/* Guests get one plain sentence, not the campaign's bookkeeping. */}{offers.some(c => (c.minQuantity ?? 1) > 1) && <small className="muted">{en ? 'Applies when you order this many in one order (any size).' : 'Bir siparişte bu kadar alındığında geçerlidir (boy fark etmez).'}</small>}</div>;
}

export function ProductDialog({ product, onClose, onAdd, en, preview = false, browseOnly = false, previewMessage, quantityAlready = 0, namesEn, staff = false }: { staff?: boolean; namesEn?: MenuNameEn[]; quantityAlready?: number; previewMessage?: string; preview?: boolean; browseOnly?: boolean; product: Product; onClose: () => void; onAdd: (line: CartLine) => void; en: boolean }) {
  const [quantity, setQuantity] = useState(1);
  // Required groups start on their free option ("Standart"); with none free nothing is chosen and adding waits (defaultOption).
  const [selected, setSelected] = useState<Record<string, string>>(() => Object.fromEntries(product.groups.flatMap(g => { const id = defaultOption(g); return id ? [[g.id, id]] : []; })));
  const missing = missingChoices(product, selected);
  const [note, setNote] = useState(''), [weight, setWeight] = useState('500');
  const weighed = soldByWeight(product), grams = Number(weight), extra = product.groups.reduce((a, g) => a + (g.options.find(o => o.id === selected[g.id])?.extra ?? 0), 0);
  // Weighed: price for the chosen grams plus option extras once; quantity offers never apply to weight.
  const original = weighed ? weightBase(product.price, validGrams(grams) ? grams : 0, extra) : product.price + extra;
  const discount = weighed ? discountedPrice({ discounts: weightOffers(product.discounts) }, original, 1) : discountedPrice(product, original, quantity + quantityAlready); const price = discount.price;
  const offerProduct = weighed ? { ...product, discounts: weightOffers(product.discounts) } : product;
  const ordering = !browseOnly;
  // EN menu: owner's English, else the option dictionary, else Turkish (packages/domain/menu-translation.ts).
  const text = en ? productTextEn(product) : product;
  return <Modal title={preview && !browseOnly ? 'Müşteri önizlemesi' : en ? product.nameEn || product.name : product.name} onClose={onClose}>{/* Staff choose options; the photo area is the guest's. */}{!staff && <ProductArt kind={product.art} photo={product.photo} alt={product.name} large en={en} />}<div className="modal-body">{preview && !browseOnly && <><h3>{product.name}</h3><p className="muted small">{previewMessage ?? 'Bu bir önizlemedir; ürün henüz kaydedilmedi.'}</p>{product.soldOut && <p className="product-subtype">Tükendi</p>}</>}<span className="eyebrow">#{product.code} · {en ? menuNameEn(namesEn, product.category) : product.category}</span><p className="product-subtype">{en && product.subtype ? menuNameEn(namesEn, product.category, product.subtype) : product.subtype}</p>{weighed && <p className="unit-price">{en ? 'Sold by weight' : 'Kiloyla satılır'} · {money(menuPrice(product))} / kg</p>}{text.ingredients && <p className="muted"><strong>{en ? 'Ingredients: ' : 'İçindekiler: '}</strong>{text.ingredients}</p>}<p className="muted">{text.description}</p>{product.groups.map(g => <fieldset key={g.id} className="options"><legend>{en ? groupNameEn(g) : g.name} {g.required && <small>({en ? 'required' : 'zorunlu'})</small>}</legend>{showsNoChoice(g) && <label><input type="radio" name={g.id} checked={!selected[g.id]} onChange={() => setSelected(s => ({ ...s, [g.id]: '' }))} />{en ? 'None' : 'Seçim yok'}</label>}{g.options.map(o => <label key={o.id}><input type="radio" name={g.id} checked={selected[g.id] === o.id} onChange={() => setSelected(s => ({ ...s, [g.id]: o.id }))} /><span>{en ? optionNameEn(g, o) : o.name}</span><span className="option-price">{o.extra > 0 ? `+${money(o.extra)}` : o.extra < 0 ? money(o.extra) : ''}</span></label>)}</fieldset>)}{weighed && product.groups.some(g => g.options.some(o => o.extra !== 0)) && <p className="muted small">{en ? 'Option prices are added once per item, not per kg.' : 'Seçenek ücretleri kiloya göre değil, ürüne bir kez eklenir.'}</p>}{weighed && ordering && <WeightPicker value={weight} onChange={setWeight} en={en} />}{ordering && <NoteField value={note} onChange={setNote} en={en} product={product} />}<QuantityOffers product={offerProduct} en={en} />{!weighed && quantityAlready > 0 && product.discounts?.some(c => (c.minQuantity ?? 1) > 1) && <p className="muted small">{en ? `${quantityAlready} already in basket; counted together.` : `Sepette bu üründen ${quantityAlready} adet var; birlikte sayılır.`}</p>}<div>{discount.campaigns.length > 0 && <p className="campaign-price-note">{discount.campaigns.map(c => c.name).join(' + ')} · <del>{money(original)}</del> → {money(price)}</p>}</div>{!browseOnly && missing.length > 0 && <p className="option-hint" role="status">{en ? `Please choose: ${missing.map(g => groupNameEn(g)).join(', ')}` : `Sepete eklemek için seçin: ${missing.map(g => g.name).join(', ')}`}</p>}{browseOnly ? <div className="browse-only-price"><strong>{weighed ? `${money(menuPrice(product))} / kg` : money(price)}</strong><span className="muted small">{previewMessage}</span></div> : <div className="product-actions">{!weighed && <div className="stepper"><button aria-label="Adedi azalt" disabled={quantity === 1} onClick={() => setQuantity(q => q - 1)}><Minus size={16} /></button><strong>{quantity}</strong><button aria-label="Adedi artır" disabled={quantity === 20} onClick={() => setQuantity(q => q + 1)}><Plus size={16} /></button></div>}<button disabled={preview || missing.length > 0 || (weighed && !validGrams(grams))} className="btn primary grow" onClick={() => { const text = readNote(note); onAdd({ productId: product.id, quantity: weighed ? 1 : quantity, selections: Object.entries(selected).filter(([, id]) => id).map(([groupId, optionId]) => ({ groupId, optionId })), ...(text ? { note: text } : {}), ...(weighed ? { grams } : {}) }); onClose(); }}>{en ? 'Add' : 'Sepete ekle'} <span>{weighed ? `${formatWeight(validGrams(grams) ? grams : 0, en)} · ` : ''}{money(weighed ? price : price * quantity)}</span></button></div>}</div></Modal>;
}

/** `takeaway`: the basket opens a new masasız ticket (Sipariş al → Masasız sipariş) instead of ordering for `tableId`.
 * `toGo`: `tableId` is already a masasız ticket, never seated at a table, so the basket has no "Paketlensin" choice. */
export type SentOrder = { number: number; takeawayNumber?: number; tableId?: string; status?: string };
/** `tableName`: staff baskets say whose order this is ("Masa 04 · Sepet") instead of the guest's "Sepetiniz".
 * `disabledReason`: why the guest cannot send right now (said next to the disabled button). `changeSeconds`: the guest's
 * change window, told in the "sent" window. */
/** `staffBasket`: sessionStorage key for a staff basket (src/staffBasket.ts, per person and table): it survives the 05:00 sign-out. */
/** `leading`: staff only, put before the search box in one row (the waiter's table chip). */
/** `sentExtra`: guest only, shown in the "sent" window above its buttons (the café's social links, src/SocialFollow.tsx). */
/** `canAdd`: guest only: products can still go into the basket while sending is off (QR siparişleri kapalı, café away): the basket waits. */
/** `sentOrders`: guest only, the guest's live orders: the "sent" window follows its order (approved, preparing) instead of keeping the first text. */
/** `billLines`: what the table's open bill already has, so account campaigns (packages/domain/deals.ts) are estimated in the basket
 * and staff see "Kampanya: Americano bedava · Ekle". */
type ComposerProps = { billLines?: readonly OrderLine[]; sentOrders?: Pick<PublicOrder, 'number' | 'status' | 'canEdit'>[]; canAdd?: boolean; sentExtra?: ReactNode; leading?: ReactNode; staffBasket?: string; disabledReason?: string; changeSeconds?: number; tableName?: string; toGo?: boolean; takeaway?: { label: string }; namesEn?: MenuNameEn[]; browseOnly?: boolean; onTrackOrder?: () => void; newProductIds?: string[]; guestContext?: string; quickCode?: boolean; subcategoryOrder?: { category: string; names: string[] }[]; popularProductIds?: string[]; preview?: boolean; categoryOrder?: string[]; products: Product[]; tableId: string; guest?: string; enabled: boolean; onSent: (result?: SentOrder) => void; en?: boolean };
export function Composer({ billLines = [], sentOrders, canAdd = false, sentExtra, leading, staffBasket, disabledReason, changeSeconds = 0, tableName, toGo = false, takeaway, namesEn, browseOnly = false, onTrackOrder, newProductIds = [], guestContext, quickCode = false, subcategoryOrder = [], popularProductIds = [], preview = false, categoryOrder, products, tableId, guest, enabled, onSent, en = false }: ComposerProps) {
  const storageKey = guest && guestContext && !preview ? pendingOrderKey(location.pathname) : null;
  const [recovered] = useState(() => storageKey ? readPendingOrder(browserOrderStorage(), storageKey) : null);
  const savedSubmission = useRef<PendingOrder | null>(recovered);
  const [storageUnavailable, setStorageUnavailable] = useState(false), [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [code, setCode] = useState(''); const [codeError, setCodeError] = useState('');
  function addByCode() {
    const p = products.find(p => p.code === code.trim());
    if (!p) { setCodeError('Bu numarada ürün bulunamadı.'); return; }
    if (p.soldOut) { setCodeError('Bu ürün tükendi.'); return; }
    if (!enabled || busy || uncertain) return;
    setCodeError(''); setCode('');
    // Weighed products need a weight, so they open the product window like products with options.
    // 9 Ekim kullanıcı testi: "21" twice made two "1 Demleme Çay" lines (K8: the same product grows one line, like "+").
    if (p.groups.length || soldByWeight(p)) setSelected(p);
    else setCart(c => { const i = c.findIndex(l => l.productId === p.id && !l.selections.length && !l.note && !l.grams && l.quantity < 20); return i >= 0 ? c.map((l, k) => k === i ? { ...l, quantity: l.quantity + 1 } : l) : [...c, { productId: p.id, quantity: 1, selections: [], seen: unitPriceOf(p, { productId: p.id, quantity: 1, selections: [] }) }]; });
  }
  const [campaignOnly, setCampaignOnly] = useState(false);
  /** Staff "+": one more of a product without options or weight, without the product window (same line grows). */
  function addOne(p: Product) {
    if (!enabled || busy || uncertain || p.soldOut) return;
    const fresh: CartLine = { productId: p.id, quantity: 1, selections: [] };
    setCart(c => { const i = c.findIndex(l => l.productId === p.id && !l.selections.length && !l.note && !l.grams && l.quantity < 20); return i >= 0 ? c.map((l, k) => k === i ? { ...l, quantity: l.quantity + 1 } : l) : [...c, { ...fresh, seen: unitPriceOf(p, fresh) }]; });
    setSuccess('');
  }
  // Staff take orders fast: plain cards (number, name, price) so 3–4 times more products fit; customers keep the photo menu.
  const staff = !guest && !preview && !browseOnly;
  useEffect(() => { if (!products.some(p => p.discounts?.length || p.deals?.length)) setCampaignOnly(false); }, [products]);
  // Staff get a short line instead of the customer's "order received" window: no extra tap per order.
  const [staffSent, setStaffSent] = useState('');
  useEffect(() => { if (!staffSent) return; const t = setTimeout(() => setStaffSent(''), 4000); return () => clearTimeout(t); }, [staffSent]);
  const [newOnly, setNewOnly] = useState(false);
  const [popularOnly, setPopularOnly] = useState(false);
  const [category, setCategory] = useState('Tümü'); const [subtype, setSubtype] = useState(''); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<Product | null>(null);
  // The guest's basket survives a reload or a switch to another app: kept in this tab per table session (sessionStorage)
  // and checked against today's menu when read back (packages/domain/lines.ts restoreBasket). A sent order clears it.
  // Staff baskets the same way, under their own key (person + table), so signing in again after 05:00 finds them.
  const basketKey = storageKey && guestContext ? `mola-basket:${guestContext}` : staff && staffBasket ? staffBasket : null;
  const [restored] = useState(() => {
    if (!basketKey) return null;
    try {
      // Baskets of earlier table sessions in this tab are of no use any more.
      for (const key of Object.keys(sessionStorage)) if (key.startsWith('mola-basket:') && key !== basketKey) sessionStorage.removeItem(key);
      const raw = recovered ? null : sessionStorage.getItem(basketKey);
      return raw ? restoreBasket(JSON.parse(raw), products) : null;
    } catch { return null; }
  });
  const [cart, setCart] = useState<BasketLine[]>(recovered?.body.lines ?? restored?.lines ?? []); const [showCart, setShowCart] = useState(!!recovered);
  const [basketNotice] = useState(restored?.dropped ? (en ? 'Some items in your basket are no longer on the menu or their options changed, so they were removed.' : 'Sepetinizdeki bazı ürünler menüden kalktı ya da seçenekleri değişti; sepetten çıkarıldı.') : '');
  const [error, setError] = useState(recovered ? (en ? 'An earlier submission needs checking. Check the same submission before placing another order.' : 'Önceki gönderimin sonucu kontrol edilmeli. Yeni sipariş vermeden önce aynı gönderimi kontrol edin.') : ''); const [success, setSuccess] = useState(''); const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState(''), [sentForApproval, setSentForApproval] = useState(false), [sentNumber, setSentNumber] = useState(0);
  // K-J (9 Ekim kullanıcı testi): the open "sent" window follows its order. Once the waiter approves it or the kitchen starts
  // it, "garson onayına gönderildi" and "… sn içinde değiştirebilirsiniz" are old news: the window says where the order is now.
  const sentNow = sentOrders?.find(o => o.number === sentNumber);
  const sentMoved = !!sentNow && sentNow.status !== (sentForApproval ? 'awaiting_approval' : 'new');
  const sentProgress = !sentNow || !sentMoved ? '' : sentNow.status === 'cancelled' ? (en ? 'Order cancelled' : 'Sipariş iptal edildi') : ['ready', 'served'].includes(sentNow.status) ? (en ? 'Your order is ready' : 'Siparişiniz hazır') : sentForApproval ? (en ? 'Approved, being prepared' : 'Onaylandı, hazırlanıyor') : (en ? 'Your order is being prepared' : 'Siparişiniz hazırlanıyor');
  const pending = useRef<{ guestContext?: string; requestId: string; tableId?: string; label?: string; lines: CartLine[]; expectedTotal: number; packed?: true } | null>(recovered?.body ?? null);
  // "Paket yapılsın" per item (13 Ekim) and "Hepsini paketle" for all of them. Masasız tickets have no table to stay at, so
  // they never offer it. An older submission waiting for its answer kept the choice for the whole order.
  const packable = !takeaway && !toGo && !preview && !browseOnly;
  const packed = packable && cart.length > 0 && cart.every(l => l.packed);
  const setPacked = (on: boolean) => setCart(c => c.map(({ packed: _, ...l }) => on ? { ...l, packed: true } : l));
  useEffect(() => {
    if (!basketKey) return;
    try { if (cart.length) sessionStorage.setItem(basketKey, JSON.stringify({ v: 1, lines: cart })); else sessionStorage.removeItem(basketKey); } catch { /* storage refused: the basket just is not kept */ }
  }, [basketKey, cart]);
  const [uncertain, setUncertain] = useState(!!recovered);
  const categories = ['Tümü', ...new Set([...(categoryOrder ?? []), ...products.map(p => p.category)].filter(c => products.some(p => p.category === c)))];
  useEffect(() => { if (category !== 'Tümü' && !categories.includes(category)) { setCategory('Tümü'); setSubtype(''); } }, [category, categories.join('|')]);
  // Guests on the EN menu see owner-written names, else the shared dictionary, else the Turkish name (same rule in the product window).
  const label = (c: string, sub?: string) => en ? menuNameEn(namesEn, c, sub) : sub ?? c;
  const popular = popularProductIds.map(id => products.find(p => p.id === id)).filter((p): p is Product => !!p && !p.soldOut);
  useEffect(() => { if (!popular.length) setPopularOnly(false); }, [popular.length]);
  const recent = newProductIds.map(id => products.find(p => p.id === id)).filter((p): p is Product => !!p);
  useEffect(() => { if (!recent.length) setNewOnly(false); }, [recent.length]);
  const filtered = (newOnly ? recent : popularOnly ? popular : products).filter(p => (!campaignOnly || !!p.discounts?.length || !!p.deals?.length) && (category === 'Tümü' || p.category === category) && (!subtype || p.subtype === subtype) && matchesSearch(p, search));
  // "Tümü" follows the owner's category order (Kategoriler ve sıra, the same as the tabs); within a category products keep
  // their own order. 13 Ekim: the tabs followed it but "Tümü" still listed the first-added category first. "Yeni" and
  // "Popüler" keep their own order (newest, most ordered).
  const tabRank = new Map(categories.map((c, i) => [c, i]));
  const visible = category === 'Tümü' && !newOnly && !popularOnly ? [...filtered].sort((a, b) => (tabRank.get(a.category) ?? 1e6) - (tabRank.get(b.category) ?? 1e6)) : filtered;
  const currentSubtypes = [...new Set(products.filter(p => p.category === category && p.subtype).map(p => p.subtype!))];
  const subtypes = [...new Set([...(subcategoryOrder.find(c => c.category === category)?.names ?? []).filter(n => currentSubtypes.includes(n)), ...currentSubtypes])];
  useEffect(() => { if (subtype && !subtypes.includes(subtype)) setSubtype(''); }, [subtype, subtypes.join('|')]);
  // Basket options in the menu's language; the order itself stores the Turkish names for the kitchen.
  const optionText = (p: Product | undefined, l: CartLine) => l.selections.map(sel => { const g = p?.groups.find(g => g.id === sel.groupId), o = g?.options.find(o => o.id === sel.optionId); return g && o ? (en ? optionNameEn(g, o) : o.name) : ''; }).join(' · ');
  const linePrice = (l: CartLine) => { const p = products.find(p => p.id === l.productId); return p ? cartLineTotal(p, l, productQuantity(cart, l.productId)) : 0; };
  const total = cart.reduce((a, l) => a + linePrice(l), 0);
  // Account campaigns: what the basket would get off once it joins the bill (an estimate; the café server decides), and for
  // staff the gifts the bill has earned but not ordered ("Kampanya: Americano bedava · Ekle").
  const dealsOn = products.some(p => p.deals?.length);
  const pieces = dealsOn ? cart.flatMap(l => { const p = products.find(p => p.id === l.productId); return p ? [{ productId: l.productId, quantity: l.quantity, grams: l.grams, unitPrice: unitPriceOf(p, l), originalUnitPrice: p.price + optionExtra(p, l.selections) }] : []; }) : [];
  const savings = dealsOn && !uncertain ? basketDealSavings(products, billLines, pieces, l => l.unitPrice ?? 0) : 0;
  const hints = dealsOn && staff && enabled ? giftHints(products, [...billLines, ...pieces]) : [];
  function addGift(p: Product) {
    // Required choices start on their free option; one without a free option opens the product window.
    if (soldByWeight(p) || p.groups.some(g => g.required && !defaultOption(g))) { setSelected(p); return; }
    const line: CartLine = { productId: p.id, quantity: 1, selections: p.groups.filter(g => g.required).map(g => ({ groupId: g.id, optionId: defaultOption(g)! })) };
    setCart(c => addToCart(c, { ...line, seen: unitPriceOf(p, line) })); setSuccess('');
  }
  // The basket says which line sold out or changed price since it was added, before anything is sent.
  const unavailable = (l: BasketLine) => { const p = products.find(p => p.id === l.productId); return !p || p.soldOut || p.published === false; };
  const newPrice = (l: BasketLine) => { const p = products.find(p => p.id === l.productId); if (!p || l.seen === undefined) return null; const now = unitPriceOf(p, l); return now !== l.seen ? now : null; };
  const soldOutNames = uncertain ? [] : [...new Set(cart.filter(unavailable).map(l => { const p = products.find(p => p.id === l.productId); return (en ? p?.nameEn || p?.name : p?.name) ?? (en ? 'A product' : 'Bir ürün'); }))];
  function clearSubmission() { if (storageKey) clearPendingOrder(browserOrderStorage(), storageKey, pending.current?.requestId); pending.current = null; savedSubmission.current = null; setUncertain(false); setRecoveryBlocked(false); }
  async function send() {
    if (busy || preview || recoveryBlocked) return; setBusy(true); setError(''); setErrorCode('');
    // A retry after a lost connection resends the same request (same ticket label too), so it never opens a second ticket.
    const lines = cart.map(({ seen: _, packed: pack, ...line }) => packable && pack ? { ...line, packed: true } : line);
    pending.current ??= takeaway ? { requestId: requestId(), lines, expectedTotal: total, ...(takeaway.label.trim() ? { label: takeaway.label.trim() } : {}) } : { requestId: requestId(), tableId, lines, expectedTotal: total, ...(guestContext ? { guestContext } : {}) };
    if (storageKey && guestContext && !savedSubmission.current) {
      savedSubmission.current = { version: 1, body: { ...pending.current, tableId, guestContext }, labels: cart.map(l => { const p = products.find(p => p.id === l.productId); return { name: (en ? p?.nameEn || p?.name : p?.name) ?? l.productId, options: optionText(p, l), total: linePrice(l) }; }) };
      // The note and weight live in the saved body itself, so a recovered basket shows and resends exactly what was sent.
      setStorageUnavailable(!writePendingOrder(browserOrderStorage(), storageKey, savedSubmission.current));
    }
    try {
      const result = await api<SentOrder>(guest ? '/api/guest/orders' : takeaway ? '/api/staff/takeaway/orders' : '/api/staff/orders', pending.current, guest);
      clearSubmission(); setCart([]); setShowCart(false); setPacked(false);
      // 18 Ekim: the saved basket goes now, not in the effect above: `onSent` may close this screen first (the staff order
      // window), the effect never ran, and the sent lines came back the next time the table's "Sipariş al" opened.
      if (basketKey) try { sessionStorage.removeItem(basketKey); } catch { /* storage refused: nothing was kept */ }
      // Waiting for the waiter is not "received" yet; the guest is told so, and how long the order can still be changed.
      if (guest) { const approval = result.status === 'awaiting_approval'; setSentForApproval(approval); setSentNumber(result.number); setSuccess(approval ? (en ? `Order #${result.number} was sent for waiter approval. It will be prepared once approved.` : `Sipariş #${result.number} garson onayına gönderildi. Onaylandığında hazırlanmaya başlanacak.`) : (en ? `Order #${result.number} received.` : `Sipariş #${result.number} alındı.`)); } else setStaffSent(result.takeawayNumber ? `Masasız #${result.takeawayNumber} mutfağa gönderildi.` : `Sipariş #${result.number} mutfağa gönderildi.`);
      onSent(result);
    } catch (e) {
      const offline = e instanceof ApiError && e.code === 'BUSINESS_OFFLINE';
      const contextChanged = e instanceof ApiError && e.code === 'ORDER_CONTEXT_CHANGED';
      const rejected = e instanceof ApiError && ['PRICE_CHANGED', 'ITEM_UNAVAILABLE', 'CAMPAIGN_LIMIT', 'OPTION_REQUIRED', 'INVALID_OPTIONS', 'INVALID_CART', 'INVALID_VALUE', 'INVALID_NOTE', 'INVALID_WEIGHT', 'ACCOUNT_CLOSED', 'TABLE_CLEANING', 'BROWSER_BLOCKED', 'INVALID_LABEL', 'TAKEAWAY_CLOSED'].includes(e.code);
      const uncertainResult = contextChanged || !rejected && (uncertain || (!(e instanceof ApiError) || (e.status >= 500 && !offline)));
      setUncertain(uncertainResult);
      if (contextChanged) setRecoveryBlocked(true);
      if (!uncertainResult) clearSubmission();
      setErrorCode(e instanceof ApiError ? e.code : '');
      if (staff) setShowCart(true);
      setError(contextChanged || offline ? guestMessage(e, en) : uncertainResult ? (guest ? (en ? 'Connection lost. Your order may have gone through — tap to check.' : 'İnternet koptu. Siparişiniz gitmiş olabilir — kontrol etmek için dokunun.') : 'Bağlantı kesildi. Aynı gönderimi tekrar kontrol edin; ikinci sipariş oluşturulmaz.') : guestMessage(e, en));
    } finally { setBusy(false); }
  }
  const searchBox = <label className="search"><Search size={17} /><input aria-label={en ? 'Search product' : 'Ürün ara'} placeholder={leading ? 'Ara (ad ya da no)' : en ? 'Name or product code' : 'Ürün adı veya kodu'} value={search} onChange={e => setSearch(e.target.value)} /></label>;
  return <>
    {success && <Modal title={sentProgress || (sentForApproval ? (en ? 'Sent for waiter approval' : 'Siparişiniz garson onayına gönderildi') : en ? 'Order received' : 'Siparişiniz alındı')} onClose={() => setSuccess('')}><div className="order-success"><div className="success-symbol"><Check size={36} /></div><h3>{sentForApproval || en || sentNow?.status === 'cancelled' ? (en ? 'Thank you!' : 'Teşekkür ederiz!') : 'Afiyet olsun!'}</h3><p>{sentProgress ? `${en ? 'Order' : 'Sipariş'} #${sentNumber} · ${sentProgress}` : success}</p>{guest && changeSeconds > 0 && !sentMoved && sentNow?.canEdit !== false && <p className="muted">{en ? `You can change it within ${changeSeconds} s.` : `${changeSeconds} sn içinde değiştirebilirsiniz.`}</p>}<p className="muted">{en ? 'You can follow your order in My orders.' : 'Siparişinizin durumunu Siparişlerim bölümünden takip edebilirsiniz.'}</p>{guest && sentExtra}{guest && onTrackOrder && <button className="btn primary full" onClick={() => { setSuccess(''); onTrackOrder(); }}>{en ? 'Track my order' : 'Siparişimi takip et'}<ArrowRight size={16} /></button>}<button className={`btn full ${guest && onTrackOrder ? 'secondary' : 'primary'}`} onClick={() => setSuccess('')}>{en ? 'OK' : 'Tamam'}</button></div></Modal>}
    {staffSent && <Notice tone="success">{staffSent}</Notice>}
    {leading && <div className="staff-search-row">{leading}{searchBox}</div>}
    <DealHints hints={hints} disabled={busy || uncertain} onAdd={addGift} />
    {quickCode && <form className="quick-code" onSubmit={e => { e.preventDefault(); addByCode(); }}><label>Ürün numarası<input aria-label="Sepete eklenecek ürün numarası" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={code} onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, '')); setCodeError(''); }} placeholder="Örn. 21" /></label><button className="btn primary" disabled={!code || !enabled || busy || uncertain}>Numarayla sepete ekle</button>{codeError && <Notice tone="error">{codeError}</Notice>}<p className="muted small">Seçenekli üründe önce boy/süt gibi tercihleri seçin. Her ekleme bir adettir.</p></form>}
    <div className="menu-tools"><div className="category-tabs">{categories.map(c => <button key={c} className={!newOnly && !campaignOnly && !popularOnly && c === category ? 'selected' : ''} onClick={() => { setNewOnly(false); setCampaignOnly(false); setPopularOnly(false); setCategory(c); setSubtype(''); }}><MenuCategoryIcon category={c} /><span>{label(c)}</span></button>)}{recent.length > 0 && <button className={newOnly ? 'selected' : ''} onClick={() => { setNewOnly(true); setCampaignOnly(false); setPopularOnly(false); setCategory('Tümü'); setSubtype(''); }}><Star size={14} strokeWidth={1.7} aria-hidden="true" /><span>{en ? 'New' : 'Yeni'}</span></button>}{popular.length > 0 && <button className={popularOnly ? 'selected' : ''} onClick={() => { setNewOnly(false); setCampaignOnly(false); setPopularOnly(true); setCategory('Tümü'); setSubtype(''); }}><TrendingUp size={14} strokeWidth={1.7} aria-hidden="true" /><span>{en ? 'Popular products' : 'Popüler ürünler'}</span></button>}{!staff && products.some(p => p.discounts?.length || p.deals?.length) && <button className={campaignOnly ? 'selected' : ''} onClick={() => { setNewOnly(false); setCampaignOnly(true); setPopularOnly(false); setCategory('Tümü'); setSubtype(''); }}><Tags size={14} strokeWidth={1.7} aria-hidden="true" /><span>{en ? 'Special offers' : 'Kampanyalı ürünler'}</span></button>}</div>{!leading && searchBox}</div>
    {category !== 'Tümü' && products.some(p => p.category === category && p.subtype) && <div className="subcategory-tabs" aria-label={en ? 'Subcategories' : 'Alt kategoriler'}><button className={!subtype ? 'selected' : ''} onClick={() => setSubtype('')}>{en ? 'All types' : 'Tüm türler'}</button>{subtypes.map(t => <button key={t} className={subtype === t ? 'selected' : ''} onClick={() => setSubtype(t)}>{label(category, t)}</button>)}</div>}
    {!staff && <CategoryOfferStrip products={visible} en={en} label={label} />}
    {staff ? <div className="product-grid staff-grid">{visible.map(p => { const inCart = productQuantity(cart, p.id), quick = !p.groups.length && !soldByWeight(p), off = p.soldOut || !enabled || busy || uncertain; return <div key={p.id} className={`staff-row${p.soldOut ? ' sold-out' : ''}${inCart ? ' in-cart' : ''}`}><button className={`product-card staff-card ${p.soldOut ? 'sold-out' : ''}`} disabled={off} onClick={() => setSelected(p)}><span className="product-code">#{p.code}</span><strong className="staff-card-name">{p.name}</strong><span className="staff-card-price">{p.soldOut ? 'Tükendi' : soldByWeight(p) ? `${money(menuPrice(p))} / kg` : money(discountedPrice(p, p.price).price)}</span></button>{inCart > 0 && <span className="staff-qty" aria-hidden="true">{inCart}</span>}<button type="button" className="staff-add" disabled={off} aria-label={quick ? `${p.name} · bir adet ekle${inCart ? ` (sepette ${inCart})` : ''}` : `${p.name} · seçenekleri aç`} onClick={() => quick ? addOne(p) : setSelected(p)}><Plus size={20} aria-hidden="true" /></button></div>; })}</div>
    : <div className="product-grid">{visible.map(p => <button key={p.id} className={`product-card ${p.soldOut ? 'sold-out' : ''}`} disabled={p.soldOut || (!browseOnly && (!(enabled || canAdd) || busy || uncertain))} onClick={() => setSelected(p)}><ProductArt kind={p.art} photo={p.photo} alt={p.name} en={en} /><div className="product-card-body"><div className="product-code">#{p.code}<span>{p.soldOut ? (en ? 'Sold out' : 'Tükendi') : ''}</span></div><h3>{en ? p.nameEn || p.name : p.name}</h3>{p.subtype && <span className="product-subtype">{label(p.category, p.subtype)}</span>}<p>{en ? productTextEn(p).description : p.description}</p>{/* The condition on the card itself (11 Ekim): "Kampanyalı ürünler" lists it, but one piece is at the normal price. */}{!soldByWeight(p) && p.discounts?.some(c => (c.minQuantity ?? 1) > 1) && <span className="quantity-offer-badge">{(() => { const m = Math.min(...p.discounts!.filter(c => (c.minQuantity ?? 1) > 1).map(c => c.minQuantity!)); return en ? `Discount from ${m} pieces` : `${m} adet ve üzeri indirimli`; })()}</span>}<CategoryOfferBadge product={p} en={en} label={label} /><DealOfferBadge product={p} en={en} label={label} /><div className="product-bottom"><strong>{menuPrice(p) < p.price && <del className="original-price">{money(p.price)}</del>}{money(menuPrice(p))}{soldByWeight(p) && ' / kg'}</strong>{!browseOnly && <span className="add-circle"><Plus size={19} /></span>}</div></div></button>)}</div>}
    {visible.length === 0 && <Empty title={en ? 'No products found' : 'Ürün bulunamadı'} detail={en ? 'Try another search.' : 'Başka bir ad veya ürün kodu deneyin.'} />}
    {selected && <ProductDialog staff={staff} quantityAlready={productQuantity(cart, selected.id)} preview={preview || browseOnly} browseOnly={browseOnly} previewMessage={browseOnly ? (en ? 'Please tell our staff what you would like.' : 'Siparişinizi personelimize iletebilirsiniz.') : en ? 'Preview only. No order will be placed.' : 'Menü önizlemesi. Bu ekrandan sipariş gönderilmez.'} product={products.find(p => p.id === selected.id) ?? selected} namesEn={namesEn} onClose={() => setSelected(null)} en={en} onAdd={l => { if (!preview) { const p = products.find(p => p.id === l.productId); setCart(c => addToCart(c, p ? { ...l, seen: unitPriceOf(p, l) } : l)); setSuccess(''); } }} />}
    {cart.length > 0 && !showCart && staff && <div className="staff-basket-bar"><button type="button" className="staff-basket-open" onClick={() => setShowCart(true)}><span className="sr-only">Sepeti görüntüle: </span><ShoppingBag size={19} aria-hidden="true" /><span><strong>{cart.reduce((a, l) => a + l.quantity, 0)} ürün</strong> · {money((pending.current?.expectedTotal ?? total) - savings)}</span></button><button type="button" className="btn primary staff-basket-send" disabled={busy || recoveryBlocked || (!enabled && !uncertain) || soldOutNames.length > 0} onClick={() => void send()}>{busy ? 'Gönderiliyor…' : uncertain ? 'Kontrol et' : 'Gönder'}<ArrowRight size={17} aria-hidden="true" /></button></div>}
    {cart.length > 0 && !showCart && !staff && <button className="cart-floating" onClick={() => setShowCart(true)}><span className="cart-count">{cart.reduce((a, l) => a + l.quantity, 0)}</span><ShoppingBag size={20} /><span>{en ? 'View basket' : staff ? 'Sepeti görüntüle' : 'Sepetimi görüntüle'}</span><strong>{money((pending.current?.expectedTotal ?? total) - savings)}</strong><ArrowRight size={18} /></button>}
    {showCart && <Modal title={staff ? `${tableName ?? 'Sipariş'} · Sepet` : en ? 'Your basket' : 'Sepetiniz'} onClose={() => { if (!busy) setShowCart(false); }}><div className="modal-body">{cart.map((l, i) => { const p = products.find(p => p.id === l.productId); const sent = savedSubmission.current?.labels[i]; const name = (en ? p?.nameEn || p?.name : p?.name) ?? ''; const out = !uncertain && unavailable(l), now = uncertain ? null : newPrice(l); return <div className={`cart-line ${out ? 'cart-line-out' : ''}`} key={i}>{l.grams || busy || uncertain ? <span className={`qty-badge ${l.grams ? 'qty-weight' : ''}`}>{l.grams ? formatWeight(l.grams, en) : `${l.quantity}×`}</span>
      // Pieces change right in the basket (staff and guests); the line's own window is not needed for "one more".
      : <div className="stepper cart-stepper"><button type="button" aria-label={en ? `${name}: one less` : `${name} adedini azalt`} disabled={l.quantity <= 1} onClick={() => setCart(c => c.map((x, k) => k === i ? { ...x, quantity: x.quantity - 1 } : x))}><Minus size={14} /></button><strong>{l.quantity}</strong><button type="button" aria-label={en ? `${name}: one more` : `${name} adedini artır`} disabled={l.quantity >= 20} onClick={() => setCart(c => c.map((x, k) => k === i ? { ...x, quantity: x.quantity + 1 } : x))}><Plus size={14} /></button></div>}<div className="grow"><strong>{sent?.name ?? (en ? p?.nameEn || p?.name : p?.name) ?? (en ? 'Product' : 'Ürün')}</strong><small>{sent?.options ?? optionText(p, l)}</small>{out && <small className="cart-line-flag">{en ? 'Sold out' : 'Tükendi'}</small>}{now !== null && l.seen !== undefined && <small className="cart-line-flag">{en ? 'Price updated' : 'Fiyat güncellendi'}: {money(l.seen)} → {money(now)}</small>}<LineNote note={l.note} en={en} />{!sent && !uncertain && !preview && !browseOnly && <CartLineExtras packed={packable && l.packed} note={l.note} packable={packable} en={en} disabled={busy} name={name || (en ? 'Product' : 'Ürün')} product={p} onChange={u => setCart(c => c.map((x, k) => k === i ? { ...x, ...u } : x))} />}</div><strong>{money(sent?.total ?? linePrice(l))}</strong><button disabled={busy || uncertain} className="icon-btn" aria-label={en ? 'Remove product' : 'Ürünü kaldır'} onClick={() => setCart(c => c.filter((_, x) => x !== i))}><X size={16} /></button></div>; })}{storageUnavailable && uncertain && <Notice>{en ? "Browser storage is unavailable. Keep this page open until the submission is checked." : "Tarayıcı geçici kayda izin vermedi. Gönderimi kontrol edene kadar bu sayfayı açık tutun."}</Notice>}{basketNotice && !uncertain && <Notice>{basketNotice}</Notice>}{soldOutNames.length > 0 && <Notice tone="error">{en ? `Sold out: ${soldOutNames.join(', ')}. Remove it from your basket to send.` : `Tükendi: ${soldOutNames.join(', ')}. Göndermek için sepetten çıkarın.`}</Notice>}{error && !(errorCode === 'ITEM_UNAVAILABLE' && soldOutNames.length) && <Notice tone="error">{errorCode === 'PRICE_CHANGED' && cart.some(l => newPrice(l) !== null) ? (en ? 'Some prices were updated. Check the new total and send again.' : 'Bazı fiyatlar güncellendi. Yeni toplamı kontrol edip tekrar gönderin.') : error}</Notice>}{packable && <label className="checkbox-label packed-choice"><input type="checkbox" checked={pending.current ? !!pending.current.packed || pending.current.lines.every(l => l.packed) : packed} disabled={busy || uncertain} onChange={e => setPacked(e.target.checked)} />{guest ? (en ? 'Pack everything to go' : 'Hepsini paketle (yanımda götüreceğim)') : 'Hepsini paketle (müşteri götürecek)'}</label>}{recoveryBlocked && <button className="btn secondary full" onClick={() => { clearSubmission(); setCart([]); setShowCart(false); setPacked(false); setError(''); }}>{en ? "I checked with staff; close this submission" : "İşletmeyle kontrol ettim, gönderimi kapat"}</button>}{savings > 0 && <div className="total-line deal-saving"><span>{en ? 'Campaign discount (estimate)' : 'Kampanya indirimi (tahmini)'}</span><strong>−{money(savings)}</strong></div>}<div className="total-line"><span>{en ? 'Total' : 'Toplam'}</span><strong>{money((pending.current?.expectedTotal ?? total) - savings)}</strong></div>{!staff && <p className="muted small">{en ? 'Payment at the counter. No online payment.' : 'Ödemenizi kasada yapabilirsiniz.'}</p>}{!enabled && !uncertain && disabledReason && <p className="send-blocked-reason" role="status">{disabledReason}</p>}<button className="btn primary full" disabled={!cart.length || busy || recoveryBlocked || (!enabled && !uncertain) || soldOutNames.length > 0} onClick={() => void send()}>{busy ? (en ? 'Sending…' : 'Gönderiliyor…') : uncertain ? (en ? 'Check submission' : 'Gönderimi yeniden kontrol et') : (en ? 'Place order' : 'Siparişi gönder')}<ArrowRight size={18} /></button></div></Modal>}
  </>;
}

/**
 * "Kampanya: Americano bedava · Ekle" (Sipariş al and the table window): a gift campaign whose condition the bill meets, with
 * fewer gifts on it than earned (packages/domain/deals.ts giftHints). Nothing goes to the kitchen until staff tap it.
 */
export function DealHints({ hints, disabled, onAdd }: { hints: ReturnType<typeof giftHints>; disabled?: boolean; onAdd: (p: Product) => void }) {
  return hints.length ? <div className="deal-hints" role="status">{hints.map(h => <button type="button" key={h.campaignId} className="deal-hint-chip" disabled={disabled} onClick={() => onAdd(h.product)}><Tags size={15} aria-hidden="true" />Kampanya: {h.text}{h.missing > 1 ? ` (${h.missing} adet)` : ''}<strong>Ekle</strong></button>)}</div> : null;
}
/** A table order to be packed to go ("Paketlensin"). `loud`: the kitchen card's capital badge, so the order is bagged, not plated. */
/** `line`: one item of the order is packed (13 Ekim), shown under that item: "PAKET". */
export function PackedBadge({ en = false, loud = false, line = false }: { en?: boolean; loud?: boolean; line?: boolean }) {
  if (line) return <span className={`packed-badge packed-line ${loud ? 'packed-loud' : ''}`}><ShoppingBag size={loud ? 15 : 12} aria-hidden="true" />{en ? 'PACK' : 'PAKET'}</span>;
  return <span className={`packed-badge ${loud ? 'packed-loud' : ''}`}><ShoppingBag size={loud ? 16 : 13} aria-hidden="true" />{loud ? 'PAKETLENECEK' : en ? 'Pack to go' : 'Paketlenecek'}</span>;
}
/** Lines as every screen reads them (kitchen, waiter, cashier, approvals, guest status): amount ("2" or "500 g"), name, options, note.
 * `packedBadge`: the "Paketlenecek" badge above the lines; the kitchen card shows its own larger one instead.
 * `en` (guest status only) translates names at render time from `products`; the stored lines stay Turkish for staff. */
/** `codes`: the "#21" product number under a line without options; the kitchen reads names, so its cards leave it out. */
export function OrderLines({ order, showPrice = true, en = false, products = [], packedBadge = true, codes = true }: { order: PublicOrder; showPrice?: boolean; en?: boolean; products?: readonly Product[]; packedBadge?: boolean; codes?: boolean }) { return <div className="order-lines">{packedBadge && order.packed && <PackedBadge en={en} />}{packedBadge && order.external && <PlatformBadge source={order.external} code />}{order.lines.map(l => <div key={l.id} className={`order-line ${showPrice && (order.paidQuantities?.[l.id] ?? 0) >= l.quantity ? 'line-paid' : ''}`}><span className={`qty-badge ${l.grams ? 'qty-weight' : ''}`}>{amountLabel(l, en)}</span><div className="grow"><strong>{en ? lineNameEn(l, products) : l.name}</strong>{((en ? lineOptionNamesEn(l, products) : l.optionNames).join(' · ') || codes) && <small>{(en ? lineOptionNamesEn(l, products) : l.optionNames).join(' · ') || `#${l.code}`}</small>}<LineNote note={l.note} en={en} />{l.packed && !order.packed && <PackedBadge en={en} line loud={!packedBadge} />}{l.unmatched && <small className="unmatched-warning">Menüde eşleşmeyen ürün</small>}{showPrice && !!l.campaigns?.length && <small>{l.campaigns.map(c => c.name).join(' + ')}</small>}{/* Account campaigns, already off the line's amount: "2 al 1 öde · −₺35", "Hediye: Americano · −₺110". */}{showPrice && l.deals?.map(d => <small key={d.id} className="deal-label">{lineDealLabel(d, en ? lineNameEn(l, products) : l.name, en)} · −{money(d.units * d.off)}</small>)}{/* Paid is good news, a part payment is only in progress: green and amber, never the error red. */}{showPrice && !!order.paidQuantities?.[l.id] && <small className={`paid-label ${order.paidQuantities[l.id] >= l.quantity ? 'paid-full' : 'paid-part'}`}>{order.paidQuantities[l.id] >= l.quantity ? (en ? 'Paid' : 'Ödendi') : en ? `${order.paidQuantities[l.id]} of ${l.quantity} paid` : `${order.paidQuantities[l.id]} / ${l.quantity} adet ödendi`}</small>}</div>{showPrice && <span>{money(l.total)}</span>}</div>)}{order.cancellations?.flatMap(c => c.lines.map(l => <div key={`${c.id}:${l.id}`} className="order-line line-cancelled"><span className={`qty-badge ${l.grams ? 'qty-weight' : ''}`}>{amountLabel(l, en)}</span><div className="grow"><strong>{en ? lineNameEn(l, products) : l.name}</strong><small className="cancel-label">{en ? 'Cancelled' : 'İptal edildi'} · {c.reason}</small></div>{showPrice && <span><del>{money(l.total)}</del></span>}</div>))}{order.status === 'cancelled' && order.cancelReason && <small className="cancel-label">{en ? 'Reason' : 'İptal nedeni'}: {order.cancelReason}</small>}</div>; }

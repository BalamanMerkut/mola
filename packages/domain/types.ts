/** `manager` = "Müdür": runs the day like the owner, without settings, staff accounts, owner's cash or security (roles.ts).
 * `support` = "Mola destek": never a staff account; only a remote support session the owner allowed (server/support-session.ts). */
export type Role = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen' | 'support';
export type OrderStatus = 'awaiting_approval' | 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type Selection = { groupId: string; optionId: string };
/** `nameEn`: the owner's English for the EN guest menu; missing falls back to packages/domain/menu-translation.ts. */
export type OptionGroup = { preset?: 'size' | 'milk' | 'service' | 'custom'; id: string; name: string; nameEn?: string; required: boolean; options: { id: string; name: string; nameEn?: string; extra: number }[] };
/** Illustration shown when a product has no photo (packages/domain/sector.ts lists them for each kind of business). */
export type ProductArtKind = 'coffee' | 'tea' | 'cold' | 'cake' | 'food' | 'soup' | 'burger' | 'sweet';
/** `unit`: 'kg' sells by weight and `price` is per kilogram; missing (older products) or 'piece' sells by the piece. */
/** `vatRate`: KDV in whole percent, one of the business's rates (packages/domain/vat.ts); missing = the default rate. */
/** `readyMade`: "Hazır ürün" (kutu/şişe içecek; the kitchen does not prepare it): the waiter may swap it for another ready-made product until the bill is paid (order-change.ts). */
export type Product = { readyMade?: boolean; vatRate?: number; unit?: 'piece' | 'kg'; firstPublishedAt?: string | null; discounts?: import('./campaigns.js').DiscountOffer[]; published?: boolean; id: string; code: string; name: string; nameEn: string; category: string; description: string; price: number; soldOut: boolean; art: ProductArtKind; groups: OptionGroup[]; subtype?: string; ingredients?: string; descriptionEn?: string; ingredientsEn?: string; photo?: string | null };
/** `note`: the guest's free text for this line (packages/domain/lines.ts cleans it). `grams`: only on lines of products sold
 * by weight; such a line always has quantity 1, so payments, quotas and counts treat one weighed sale as one item. */
export type CartLine = { productId: string; quantity: number; selections: Selection[]; note?: string; grams?: number };
/** Weighed lines: unitPrice and total are the price of the whole line; `weightPricing` keeps what was quoted so an edit of the weight reprices like the menu did. */
export type OrderLine = CartLine & { /** KDV rate the line was sold with (vat.ts), stamped when it was made; lines from before stamping have none. */ vatRate?: number;/** Platform order item that matches no Mola product ("Menüde eşleşmeyen ürün"); productId is then `ext:…`. */ unmatched?: boolean; weightPricing?: { perKg: number; extra: number; offers?: import('./campaigns.js').DiscountOffer[] }; quantityPricing?: { original: number; offers: import('./campaigns.js').DiscountOffer[] }; originalUnitPrice?: number; campaigns?: { id: string; name: string; reportId?: string }[]; id: string; name: string; code: string; optionNames: string[]; unitPrice: number; total: number };
/** `takeaway`: a hidden counter ticket ("Masasız #12"), never on the floor plan and without a QR link (packages/domain/takeaway.ts).
 * `label` is a short first name only, kept on the live ticket and never copied into long-term history. */
/** `event`: a temporary table of an "Etkinlik" (packages/domain/reservations.ts): no QR, not on the floor plan count, removed when the event closes. */
export type CafeTable = { event?: { id: string; capacity?: number }; takeaway?: { number: number; day: string; label?: string }; area?: string; needsCleaning?: boolean; id: string; name: string; token: string; epoch: number; accountId: string | null };
/** `guest`: the seated reservation's name (or an event walk-in's), shown on the table and bill. `deposit`: the reservation's
 * kapora, taken earlier and deducted from this bill (packages/domain/reservations.ts); `paymentId` once it became a payment. */
export type Account = { guest?: import('./reservations.js').SeatedGuest; deposit?: import('./reservations.js').AccountDeposit; id: string; tableId: string; status: 'open' | 'closed'; version: number; openedAt: string; closedAt?: string };
/**
 * "Bu üründen stok kullanıldı mı?": asked when lines are cancelled after the kitchen started them (preparing, ready or served).
 * The kitchen answers (at once when it cancels, later from its screen otherwise); unanswered by the end of the cash day it
 * counts as "Hayır". "Evet" records a waste (fire) of the recipe amounts (server/stock.ts); cancelled lines never consume stock.
 */
export type StockQuestion = { id: string; at: string; by: string; lines: { productId: string; name: string; key: string; quantity: number; grams?: number }[]; answer?: 'yes' | 'no'; answeredAt?: string; answeredBy?: string };
/** A waiting question as the kitchen screen shows it. */
export type PublicStockQuestion = { id: string; orderId: string; orderNumber: number; tableName: string; at: string; byName: string; lines: StockQuestion['lines'] };
/** Items staff took off a live order (engine.ts cancelByStaff): the removed part of each line at the price it had, the reason,
 * and `printTo`, the kitchen/bar printers that already printed the order and still owe an İPTAL slip for this part. */
export type LineCancellation = { id: string; at: string; by: string; reason: string; lines: OrderLine[]; printTo?: string[] };
/** One side of a waiter's line change (engine.ts changeByStaff): what the kitchen reads, no prices. */
export type ChangeSide = { name: string; quantity: number; grams?: number; optionNames: string[]; note?: string };
/** A line a waiter changed before the kitchen started it (Kola → Ayran, adet, seçenek, not), and printTo: the printers that
 * already printed the order and still owe a DEĞİŞİKLİK slip. */
export type LineChange = { id: string; at: string; by: string; from: ChangeSide; to: ChangeSide; printTo?: string[]; /** A ready-made product swapped without the kitchen (order-change.ts). */ ready?: boolean; /** What the order's total moved by (kuruş; + more to pay). */ delta?: number };
/** `packed`: a seated guest (or staff for them) asked for this table order to be packed to go ("Paketlensin"). Kept only
 * when true; never on takeaway tickets, which are always to go. Changes nothing about prices, bills or receipts. */
/** `cancelReason`/`cancelledBy`: a whole order cancelled by staff with its reason. `cancellations`: items cancelled while the rest goes on. */
/** `external`: the order came from a delivery platform (packages/domain/external-orders.ts); `source` stays 'staff'. */
/** `reservation`: sold on a reserved table (`id`) or an event table (`eventId`); reports' "Rezervasyon" channel. */
/** `statusUndo`: the kitchen's last step (preparing/ready) and when, for its few-second "Geri al" (engine.ts undoStatus). */
export type Order = { /** Lines a waiter changed (engine.ts changeByStaff); the kitchen shows "Değişti: Kola → Ayran". */ changes?: LineChange[]; statusUndo?: { from: OrderStatus; at: string }; stockQuestions?: StockQuestion[]; reservation?: { id?: string; eventId?: string }; external?: import('./external-orders.js').ExternalSource; cancelReason?: string; cancelledBy?: string; cancellations?: LineCancellation[]; packed?: boolean; printedTo?: string[]; printFailedTo?: string[]; /** Mutfak fişi modu: kitchen tickets that could not be printed, until staff handle them (print-problems.ts). */ printProblems?: import('./print-problems.js').PrintProblem[]; cancelPrinted?: boolean; paymentBeforePreparation?: boolean; paidAt?: string; approvalRequired?: boolean; reviewedBy?: string; reviewReason?: string; id: string; number: number; accountId: string; guestId: string; guestLabel: string; source: 'qr' | 'staff'; createdAt: string; editableUntil?: string; updatedAt?: string; tableMovedFrom?: string; status: OrderStatus; version: number; menuRevision: number; lines: OrderLine[]; total: number; cancelDeclineReason?: string; cancelRequested: boolean };
export type PaymentSelection = { orderId: string; lineId: string; quantity: number };
/** `deposit`: the part of a reservation's kapora that paid this bill; the money came in at `takenAt` (cash closing counts it then). */
export type Payment = { deposit?: { reservationId: string; takenAt: string }; campaignAmount?: number | null; selections?: PaymentSelection[]; id: string; accountId: string; amount: number; tendered: number; change: number; /** 'platform': paid online on a delivery platform ("Platform ödemesi"); never cash or card. */ method: 'cash' | 'card' | 'platform'; createdAt: string; commission: number | null };
export type Archive = { id: string; accountId: string; tableName: string; closedAt: string; total: number; cash: number; card: number; orders: Order[]; payments: Payment[] };
/** One settled account as kept in long-term history: final order/payment copies, the account record, and
 * `synthetic` for accounts closed without a sale (all orders cancelled, or merged into another table). */
export type ArchivedAccount = Archive & { account?: Account; synthetic?: boolean };
export type ExpenseMethod = 'cash' | 'card' | 'transfer' | 'other';
/** What an expense looked like before an owner's edit or deletion (packages/domain/expenses.ts). */
export type ExpenseChange = { at: string; by: string; kind: 'edited' | 'deleted'; before: { amount: number; description: string; spentAt: string; method?: ExpenseMethod; source?: 'outside' } };
/** `spentAt`: the day the money went out (owners may date it up to a year back); missing on older records = `createdAt`.
 * `method` is missing on older records. `deletedAt`: removed by the owner; out of every total, kept with `changes` as the record. */
export type Expense = { id: string; amount: number; description: string; actorId: string; actorName: string; createdAt: string; spentAt?: string; method?: ExpenseMethod; deletedAt?: string; deletedBy?: string; changes?: ExpenseChange[];
  /** Recorded by an "Otomatik gider" rule (packages/domain/recurring-expenses.ts) for this business day; missing on manual ones. */
  auto?: { ruleId: string; day: string };
  /** A cash expense paid "Kasa dışından" (the owner's pocket, the bank): a gider like any other, but never out of the drawer,
   * so the gün sonu's expected cash does not drop. Missing = from the drawer (every older cash record). Cash only. */
  source?: 'outside' };
/** `sector`: kind of business (missing = 'cafe'). `takeawayEnabled`: an old on/off switch for counter sales, no longer read (always on). `takeawayCounter`: last ticket number of the business day. */
/** `externalOrders`/`externalSeen`/`integrationSettings`: delivery platform orders and settings (external-orders.ts); credentials are never here. */
export type State = { externalOrders?: import('./external-orders.js').ExternalOrder[]; externalSeen?: string[]; integrationSettings?: Partial<Record<import('./external-orders.js').PlatformId, import('./external-orders.js').PlatformSettings>>; sector?: import('./sector.js').Sector; takeawayEnabled?: boolean; takeawayCounter?: { day: string; last: number }; serviceCalls?: import('./service-calls.js').ServiceCall[]; /** K1 (10 Ekim): how the guest said they will pay when asking for the bill; stays until the account closes or moves (epoch), even after the call is answered. */ billMethods?: import('./service-calls.js').BillMethod[]; printers?: import('./printing.js').PrinterConfig[]; /** One-time "tek mutfak" notice after old bar/kitchen routing was folded (printing.ts singleKitchen). */ printerNotice?: import('./printing.js').KitchenNotice; theme?: import('./theme.js').ThemeId; menuHero?: import('./theme.js').MenuHero; googleReviewUrl?: string; /** Sosyal medya (social-links.ts): normalised https links; missing on older data. */ socialLinks?: import('./social-links.js').SocialLinks; logo?: string; integrationDemo?: import('./integration-demo.js').DemoOrder[]; paymentAdjustments?: import('./payment-adjustments.js').PaymentAdjustment[]; /** Cashiers' "iade isteği"s for the owner (payment-adjustments.ts requestRefund). */ refundRequests?: import('./payment-adjustments.js').RefundRequest[]; /** "Sahip iadeyi yaptı" strips for the till (till-notices.ts, 9 Ekim K-A). */ tillNotices?: import('./till-notices.js').TillNotice[];campaignHistory?: (import('./campaigns.js').Campaign & { recordedAt: string; supersededAt?: string })[]; campaigns?: import('./campaigns.js').Campaign[]; paymentMode?: 'before_preparation' | 'after_service'; cleaningEnabled?: boolean; /** "Mutfak nasıl çalışıyor?": missing = 'screen' (kitchen board); 'ticket' = kitchen works from printed tickets. */ kitchenMode?: import('./print-problems.js').KitchenMode; expenses?: Expense[]; waiterApproval?: boolean; autoApproveQr?: boolean; approvalVersion?: number;
  subcategoryCatalog?: { category: string; names: string[] }[]; subcategoryOrders?: { category: string; names: string[] }[]; categories?: string[]; categoryNamesEn?: import('./menu-translation.js').MenuNameEn[]; staffUsers?: import('../../server/accounts.js').StaffUser[]; setupCompleted?: boolean; businessRevision?: number;
  /** Kârlılık "Düşük kâr" uyarısı: switch, per-group thresholds and category groups (margins.ts). Missing = on, defaults. */
  marginAlerts?: import('./margins.js').MarginSettings;
  /** Ayarlar → Giderler ve kâr → "KDV oranları" (packages/domain/vat.ts). Missing = %10 and %20, %10 the default. */
  vat?: import('./vat.js').VatSettings;
  /** The rates order lines had before each line carried its own (vat.ts VatLegacy): written once, never changed. */
  vatLegacy?: import('./vat.js').VatLegacy;
  /**
   * The last business day of the newest closed (packaged) year, '2025-12-31' (packages/domain/closed-year.ts). Put on every
   * State by the server when it reads it (Store.read, from the year packages); a stored value is never trusted.
   */
  closedThrough?: string;
  schemaVersion: 1; tenantId: string; name: string; menuRevision: number; changeSeconds: number; commissionBps: number | null;
  productDrafts?: Product[]; retiredTables?: CafeTable[]; tables: CafeTable[]; products: Product[]; accounts: Account[]; orders: Order[]; payments: Payment[]; archives: Archive[];
  // Settled accounts leave the live snapshot (server/history.ts). These keep the live rules exact without them:
  // order numbers keep counting, campaign quotas keep their used units, blocked browsers keep a readable label.
  /** Address inside the last printed or downloaded table QR codes; a different LAN address now means printed QRs may not open. */
  qrPrint?: { origin: string; at: string };
  /** Ayarlar → Sesler: the business-wide sound per event, only where it differs from the defaults (packages/domain/sound-settings.ts). */
  sounds?: import('./sound-settings.js').SoundSettings;
  /** Ayarlar → Giderler: "Otomatik giderler", recorded by the café server on their days (packages/domain/recurring-expenses.ts). */
  recurringExpenses?: import('./recurring-rules.js').RecurringExpense[];
  /** Ayarlar → Kasa ve vardiya: expense alert, closing time, difference note limit, vardiya takibi, tip rule, planned shifts (packages/domain/cash.ts). */
  cashShift?: import('./cash.js').CashShiftSettings;
  /** Ayarlar → Güvenlik ve diğer → "Sahip hesabı otomatik kilit": minutes without activity (5, 10, 30; 0 = Kapalı). Missing = 10 (server/owner-lock.ts). */
  ownerLockMinutes?: number;
  /** Ayarlar → Sipariş ve kasa → "Garson masa/bölüm ataması" (packages/domain/assignments.ts). Missing = off. */
  waiterAssignments?: import('./assignments.js').WaiterAssignments;
  /** Ayarlar → Masalar ve QR: the order of the table sections (CafeTable.area, '' = bölümsüz) on Masalar; missing = İç, Dış, then as they come (table-sections.ts). */
  areaOrder?: string[];
  /** "Uzun süredir sipariş verilmeyen masa için garsona hatırlat" (table-reminders.ts): minutes; missing = 45, 0 = off. */
  tableReminderMinutes?: number;
  /** A waiter went to the table ("Gittim", or answered its call): the reminder waits N minutes from here. One per table session (epoch). */
  tableChecks?: import('./table-reminders.js').TableCheck[];
  /** Ajanda ve rezervasyon (packages/domain/reservations.ts): live reservations and events; finished ones move to `reservation_records` (server/reservations.ts). */
  reservations?: import('./reservations.js').Reservation[]; events?: import('./reservations.js').CafeEvent[]; reservationSettings?: import('./reservations.js').ReservationSettings;
  /** QR siparişleri durduruldu / gün sonundan sonra duraklatıldı (packages/domain/qr-ordering.ts); missing = open. */
  qrOrdering?: import('./qr-ordering.js').QrOrderingState;
  /** `at`: when the owner blocked this browser; blocks are lifted 90 days later (server/qr-ordering.ts pruneBlocked). */
  orderNumberBase?: number; archivedCampaignUsage?: Record<string, number>; blockedInfo?: Record<string, { orderId: string; number: number; label: string; at?: string }>; setupCompletedAt?: string;
  blocked: string[]; requests: Record<string, { fingerprint: string; result: unknown }>;
  audit: { action: string; actor: string; target: string; at: string }[];
};
export type Actor = { tenantId: string; id: string; role: Role | 'guest'; tableId?: string; epoch?: number };
export type Context = { now: Date; id: () => string };
/** Staff snapshot extras: `cancelledByName` and each cancellation's `byName` (who cancelled, for the kitchen's İPTAL strip);
 * `cancelLimits`: lines the cancel window must cap because of paid items (engine.ts cancelLimits). */
export type PublicOrder = Omit<Order, 'guestId' | 'cancellations' | 'changes'> & { cancellations?: (LineCancellation & { byName?: string })[]; changes?: (LineChange & { byName?: string })[]; cancelledByName?: string; cancelLimits?: Record<string, { max: number; reason: string }>; takeaway?: { tableId: string; number: number; label?: string }; tableName: string; paidQuantities?: Record<string, number>; paid?: boolean; canEdit?: boolean; /** Guest's "Siparişlerim" only: an order on the table's bill not sent from this phone ('staff' = "Garson ekledi"). */ addedBy?: 'staff' | 'table' };
/** `lastPaidAt` (owner only): latest payment of an account that closed on this table and is still on the floor (~6 h). */
/** `depositCredit`: the part of a seated reservation's kapora that already covers this bill (balance has it deducted). */
/** `doneOrders` (staff snapshot): served and paid orders older than 30 min, left out of `orders` to keep the snapshot small. */
export type TableView = CafeTable & { account: (Account & { total: number; paid: number; balance: number; depositCredit?: number; doneOrders?: number }) | null; lastPaidAt?: string };
/** `tables` is the floor plan only; masasız (takeaway) tickets still being prepared or paid come apart in `takeaways`.
 * `starterMenu`: the untouched starter menu, which the first setup replaces with the chosen sector's menu. */
/** `externalOrders` (owner, cashier, kitchen): platform orders waiting for Kabul/Reddet or with a platform call still owed. */
/** `eventTables`/`events`/`reservationMarks`/`reservations` (not kitchen): open events' temporary tables, upcoming reservations on the floor and the floor rules (packages/domain/reservations.ts). */
/** `sessionEndsAt`: when this sign-in ends (next 05:00); `userId`: the signed-in staff member (the kitchen skips its own cancellations). */
/** `serviceNotice` (waiter, cashier, kitchen): Mola suspended the service; the same text as the owner's licence banner. */
/** `assignment` (waiters, only while garson ataması is on): own and covered tables, so only the right phones ring. */
/** `supportConnected`: a Mola destek session is open right now (every staff screen shows "Mola ekibi bağlı"). */
/** `demo`: a "Tanıtım işletmesi" (Mola Yönetim marked it; server/demo-reset.ts): screens show a small "Tanıtım" label. */
export type StaffSnapshot = { /** Section order on Masalar (State.areaOrder). */ areaOrder?: string[]; /** Waiters: open tables with no new order or call for a while (table-reminders.ts). Owner: the setting. */ tableReminders?: import('./table-reminders.js').TableReminder[]; tableReminderMinutes?: number; /** K-A: refunds done away from the till that the cashier still has to hand over (till-notices.ts). */ tillNotices?: import('./till-notices.js').PublicTillNotice[]; /** QR siparişleri açık mı (packages/domain/qr-ordering.ts); missing when QR ordering is not in the package. */ qrOrdering?: import('./qr-ordering.js').QrOrderingView; /** Hizmet paketi (packages/domain/feature-gate.ts): the services on; owner: name, trial, notice. */ pkg?: import('./feature-gate.js').PackageView; demo?: boolean; supportConnected?: { since: string }; assignment?:import('./assignments.js').AssignmentView; serviceNotice?: string; sessionEndsAt?: string; userId?: string; stockQuestions?: PublicStockQuestion[]; stockProducts?: string[]; eventTables?: TableView[]; events?: import('./reservations.js').PublicEvent[]; reservationMarks?: import('./reservations.js').ReservationMark[]; reservations?: import('./reservations.js').FloorRules; externalOrders?: import('./external-orders.js').PublicExternalOrder[]; sector?: import('./sector.js').Sector; takeaways?: TableView[]; starterMenu?: boolean; categoryNamesEn?: import('./menu-translation.js').MenuNameEn[]; serviceCalls?: import('./service-calls.js').PublicServiceCall[]; billMethods?: { tableId: string; method: 'cash' | 'card' }[]; printing?: { orders: boolean; bill: boolean; /** Mutfak fişi modu is on. */ ticketMode?: true; /** In Fiş mode: the kitchen printer (tek mutfak: at most one; a list so the shape stays generic), for "Tekrar bas". */ kitchenPrinters?: { id: string; name: string }[] }; theme?: import('./theme.js').ThemeId; menuHero?: import('./theme.js').MenuHero; googleReviewUrl?: string; /** Sosyal medya (social-links.ts): normalised https links; missing on older data. */ socialLinks?: import('./social-links.js').SocialLinks; licenseNotice?: string; logo?: string; paymentContext?: string; productDrafts?: Product[]; paymentMode?: 'before_preparation' | 'after_service'; cleaningEnabled?: boolean; waiterApproval?: boolean; autoApproveQr?: boolean; approvalVersion?: number; subcategories: { category: string; names: string[] }[]; newProductIds?: string[]; popularProductIds: string[]; categories: string[]; name: string; role: Role; revision: number; products: Product[]; tables: TableView[]; orders: PublicOrder[]; changeSeconds: number; commissionBps: number | null; setupCompleted?: boolean; businessRevision?: number; username?: string; displayName?: string };
/**
 * `ended` (only when `closed`): why this QR visit ended. `paid` = the bill was paid and closed (thank-you and review
 * prompt), `moved` = staff moved or merged the bill to another table (never named), `other` = anything else (emptied
 * bill, renewed QR, a bill joined into this table). `due`: what is left to pay on the table's open bill (all its items, also
 * those the waiter added; 8 Ekim). `blocked`:
 * the owner stopped orders from this browser.
 */
export type GuestSnapshot = { /** QR siparişleri (8 Ekim): open false = ordering refused now (why: `reason`), call = Garson çağır works. Missing (older café) = open. mirror: served by Mola Merkez from its copy of the menu (café unreachable). */ ordering?: { open: boolean; reason?: import('./qr-ordering.js').QrOrderingReason; call: boolean }; mirror?: true; demo?: boolean; ended?: 'paid' | 'moved' | 'other'; due?: number; /** The table's open bill (8 Ekim): every item on it, paid so far, the kapora covering it; `due` = what is left. */ bill?: { total: number; paid: number; depositCredit?: number; /** KDV inside `total` (prices include it; 11 Ekim). */ vat?: number }; blocked?: boolean; sector?: import('./sector.js').Sector; categoryNamesEn?: import('./menu-translation.js').MenuNameEn[]; menuOnly?: boolean; calls?: { waiter: boolean; bill: boolean }; tableHasAccount?: boolean; theme?: import('./theme.js').ThemeId; menuHero?: import('./theme.js').MenuHero; googleReviewUrl?: string; /** Sosyal medya (social-links.ts): normalised https links; missing on older data. */ socialLinks?: import('./social-links.js').SocialLinks; /** "Sosyal medya ve QR kartları" not in the package (6 Ekim): no follow icons; socialLinks holds only the Google review row. */ socialOff?: true; logo?: string; paymentMode?: 'before_preparation' | 'after_service'; needsCleaning?: boolean; subcategories: { category: string; names: string[] }[]; newProductIds?: string[]; popularProductIds: string[]; categories: string[]; table: { name: string }; products: Product[]; name: string; menuRevision: number; online: boolean; closed: boolean; orders: PublicOrder[]; changeSeconds: number };

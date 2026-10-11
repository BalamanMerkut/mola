import { deflateRawSync, inflateRawSync } from 'node:zlib';

// Data version 3: long-term history rows are compressed before they are sealed (server/sealing.ts). Measured on 15
// months of a generated café (demo:template --gun=90 plus soak-volume --gun=365): settled accounts 3.6× smaller (2.5×
// without the dictionary below), per-day payment lists 4.4×, day summaries 1.9×, ledger and audit rows 1.7× (1.2×
// without it). deflate-raw level 6 packs as small as brotli quality 4 at about twice its speed (~50 µs an account) and
// unpacks in ~15 µs; brotli's better levels cost 15–60× more time for 5% less space. The live snapshot stays plain:
// one ~20 kB row per business, rewritten on every action, so packing it would cost time on every write for no disk.
//
// A packed plaintext starts with a NUL byte, which JSON text never does, then a codec byte; anything else is a row
// written before version 3 and is read as plain JSON. Both bytes are inside the encryption, so they are authenticated.
const MARK = 0x00;
/** deflate-raw with DICTIONARY_V1. A new codec gets a new number; old rows must stay readable forever. */
const DEFLATE_V1 = 0x01;
/**
 * Field names and fixed words of history rows, so even a short row (an audit entry, a refund) compresses well. It holds
 * no business data. NEVER EDIT: every row packed with codec 1 needs these exact bytes (tests pin its hash).
 */
const DICTIONARY_V1 = Buffer.from([
  '{"fingerprint":"","result":{"ok":true,"orderId":"","number":0,"accountId":"","paymentId":"","version":0}}',
  '{"action":"order.created","actor":"","target":"","at":"T00:00:00.000Z"}{"action":"order.approved"}{"action":"payment.recorded"}{"action":"table.cleaned"}{"action":"expense.recorded"}{"action":"payment.refund"}{"action":"payment.method"}',
  '{"id":"","amount":0,"description":"","actorId":"","actorName":"","createdAt":""}',
  '{"id":"","paymentId":"","kind":"refund","amount":0,"method":"cash","commission":0,"reason":"","actor":"isletme","createdAt":""}{"kind":"method","method":"card"}',
  '{"v":2,"s":{"cash":0,"card":0,"commission":0,"unknownCommissionAmount":0,"unknownCommissionCount":0,"campaignCollected":0,"regularCollected":0,"unallocatedCollected":0,"payments":0,"orders":0,"orderAmount":0,"cancelled":0,"cancelledAmount":0,"campaignOrderAmount":0,"campaignDiscount":0,"campaignQuantity":0,"refunds":0,"refundTotal":0,"cashRefunds":0,"expenses":0,"expenseTotal":0,"closedAccounts":0,"qrOrders":0,"staffOrders":0,"hourSales":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"hourOrders":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"products":[["","","",1,0,0]],"staff":[["qr",0,0,0,0]],"browsers":[""],"qrAccounts":[""],"campaigns":[["r:","",0,0,0]]}}',
  '{"v":1,"accounts":[{"id":"","accountId":"","tableName":"Masa 0","closedAt":"","total":0,"cash":0,"card":0,"payments":[],"tableId":"table-"}]}',
  '{"id":"","accountId":"","tableName":"Masa 0","closedAt":"","total":0,"cash":0,"card":0,"synthetic":true,"account":{"id":"","tableId":"table-","status":"closed","version":0,"openedAt":"","closedAt":""},',
  '"orders":[{"paymentBeforePreparation":false,"id":"","number":0,"accountId":"","guestId":"","guestLabel":"Personel","source":"staff","createdAt":"","status":"served","approvalRequired":false,"reviewedBy":"","version":4,"menuRevision":0,"lines":[',
  '{"weightPricing":{"perKg":0,"extra":0},"quantityPricing":{"original":0,"offers":[{"id":"","name":"","combine":false,"reportId":"","minQuantity":0,"remainingQuantity":0,"kind":"percent","percent":0}]},"originalUnitPrice":0,"campaigns":[{"id":"","name":"","reportId":""}],',
  '"productId":"","quantity":1,"selections":[{"groupId":"","optionId":""}],"note":"","grams":0,"id":"","name":"","code":"","optionNames":[],"unitPrice":0,"total":0}],"total":0,"cancelRequested":false,"editableUntil":"","updatedAt":"","paidAt":"","printedTo":[]},{"source":"qr","guestLabel":"Misafir ","status":"cancelled"}],',
  '"payments":[{"id":"","accountId":"","amount":0,"tendered":0,"change":0,"method":"card","createdAt":"","commission":0,"campaignAmount":0,"selections":[{"orderId":"","lineId":"","quantity":1}]},{"method":"cash","commission":null}]',
].join(''), 'utf8');
export const PACKING_DICTIONARY_V1 = DICTIONARY_V1;

/** Compressed plaintext for a sealed row, or the JSON itself when compressing would not make it smaller. */
export function pack(json: Buffer): Buffer {
  const packed = deflateRawSync(json, { level: 6, dictionary: DICTIONARY_V1 });
  return packed.length + 2 < json.length ? Buffer.concat([Buffer.from([MARK, DEFLATE_V1]), packed]) : json;
}
export const isPacked = (plain: Buffer) => plain.length > 0 && plain[0] === MARK;
/** The JSON bytes of an opened row, packed or not. */
export function unpack(plain: Buffer): Buffer {
  if (!isPacked(plain)) return plain;
  if (plain[1] !== DEFLATE_V1) throw new Error('Kayıt bu uygulamanın tanımadığı bir biçimde sıkıştırılmış. Uygulamayı güncelleyin.');
  return inflateRawSync(plain.subarray(2), { dictionary: DICTIONARY_V1 });
}

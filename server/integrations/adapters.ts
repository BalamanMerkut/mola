import { randomInt } from 'node:crypto';
import type { IncomingItem, IncomingOrder, PlatformId } from '../../packages/domain/external-orders.js';
import { PLATFORMS } from '../../packages/domain/external-orders.js';
import type { Product } from '../../packages/domain/types.js';
import { AdapterError, notAvailable, type AdapterContext, type CredentialField, type PlatformAdapter } from './types.js';

// Real platforms: the shape is ready, the calls are not. Each platform gives API access only to approved partners
// (entegratör / restoran entegrasyonu); until Mola has that approval, its test account and current documentation, these
// adapters cannot be switched on and every call says "bağlantı izni bekleniyor". No endpoint is guessed here.
// When access arrives: fill fetchOrders/accept/reject/ready/delivered/cancel with the documented calls, set available: true,
// add a contract test with recorded sample answers (docs/GELISTIRICI_REHBERI.md, "Dış sipariş entegrasyonları").

function waiting(id: PlatformId, fields: CredentialField[], status: string): PlatformAdapter {
  const name = PLATFORMS[id].name, fail = async () => { throw notAvailable(name); };
  return { id, name, available: false, modes: ['poll', 'webhook'], fields, status, fetchOrders: fail, accept: fail, reject: fail, ready: fail, delivered: fail, cancel: fail };
}

/** Yemeksepeti (Delivery Hero): restaurant integrations go through its partner programme; orders usually arrive pushed (webhook). */
export const yemeksepeti = () => waiting('yemeksepeti', [
  { key: 'restaurantId', label: 'Restoran (şube) kimliği', secret: false, hint: 'Yemeksepeti restoran panelinde ya da entegrasyon onay e-postasında yazar.' },
  { key: 'username', label: 'Entegrasyon kullanıcı adı', secret: false },
  { key: 'secret', label: 'Entegrasyon şifresi / gizli anahtar', secret: true },
], 'Yemeksepeti entegratör onayı ve test hesabı bekleniyor.');
/** Getir Yemek: a restaurant API for approved partners, with an application key and a key per restaurant. */
export const getir = () => waiting('getir', [
  { key: 'appSecretKey', label: 'Uygulama gizli anahtarı (app secret key)', secret: true },
  { key: 'restaurantSecretKey', label: 'Restoran gizli anahtarı', secret: true },
], 'Getir Yemek entegrasyon izni bekleniyor.');
/** Trendyol Yemek: seller (satıcı) API credentials from the partner panel. */
export const trendyol = () => waiting('trendyol', [
  { key: 'supplierId', label: 'Satıcı ID', secret: false },
  { key: 'restaurantId', label: 'Restoran ID', secret: false },
  { key: 'apiKey', label: 'API anahtarı', secret: true },
  { key: 'apiSecret', label: 'API gizli anahtarı', secret: true },
], 'Trendyol Yemek entegrasyon izni bekleniyor.');
/** Migros Yemek: restaurant integration key from Migros Yemek's partner team. */
export const migros = () => waiting('migros', [
  { key: 'restaurantId', label: 'Restoran kimliği', secret: false },
  { key: 'apiKey', label: 'API anahtarı', secret: true },
], 'Migros Yemek entegrasyon izni bekleniyor.');

export type TestCall = { tenantId: string; action: 'accept' | 'reject' | 'ready' | 'delivered' | 'cancel'; externalId: string; reason?: string; at: string };
const NAMES = ['Ayşe K.', 'Mehmet T.', 'Zeynep A.', 'Can D.', 'Elif S.', 'Burak Y.'];
const NOTES = ['Kapıya bırakabilirsiniz.', 'Zili çalmayın, bebek uyuyor.', 'Peçete ve çatal eklemeyin, teşekkürler.', 'Acısız olsun lütfen.'];

/**
 * "Deneme platformu": a platform that lives inside this server, so the owner can try the whole flow (Onay bekliyor → Kabul →
 * mutfak → Hazır → Kuryeye teslim edildi → rapor) without any account. It records the calls it gets; tests can make the
 * next calls fail to see retries and errors.
 */
export class TestPlatform {
  private queues = new Map<string, IncomingOrder[]>();
  private failing = new Map<string, number>();
  calls: TestCall[] = [];
  /** A realistic order: two menu products, one item the menu does not have, a customer name and a note. */
  createOrder(tenantId: string, products: Product[], now: Date, options: { paidOnline?: boolean; deliveryType?: 'kurye' | 'gel-al'; unknownItem?: boolean } = {}) {
    const menu = products.filter(p => p.published !== false && !p.soldOut && p.unit !== 'kg');
    const picked = [...menu].sort(() => randomInt(3) - 1).slice(0, 2);
    const items: IncomingItem[] = picked.map((p, i) => ({ externalId: `t-${p.code || p.id}`, name: p.name, quantity: i === 0 ? 2 : 1, unitPrice: p.price + (p.groups.find(g => g.required)?.options[0]?.extra ?? 0) }));
    if (options.unknownItem !== false || !items.length) items.push({ externalId: 't-ekstra-sos', name: 'Ekstra sos (platform ürünü)', quantity: 1, unitPrice: 1500, note: 'Ayrı kapta' });
    const code = String(randomInt(1000, 10000));
    const order: IncomingOrder = {
      externalId: `deneme-${now.getTime().toString(36)}-${randomInt(1e6).toString(36)}`, code, customerName: NAMES[randomInt(NAMES.length)], note: NOTES[randomInt(NOTES.length)],
      deliveryType: options.deliveryType ?? 'kurye', paidOnline: options.paidOnline ?? true, total: items.reduce((n, i) => n + i.unitPrice * i.quantity, 0),
      receivedAt: now.toISOString(), acceptBy: new Date(now.getTime() + 5 * 60_000).toISOString(), items,
    };
    this.push(tenantId, order);
    return order;
  }
  push(tenantId: string, order: IncomingOrder) { const q = this.queues.get(tenantId) ?? []; q.push(order); this.queues.set(tenantId, q); }
  /** The platform's side cancels (customer gave up, courier problem): arrives with the next poll. */
  cancelFromPlatform(tenantId: string, externalId: string, reason = 'Müşteri iptal etti') { this.push(tenantId, { externalId, total: 0, items: [], status: 'cancelled', cancelReason: reason }); }
  /** Tests: the next `count` calls of this action fail. */
  failNext(tenantId: string, action: TestCall['action'] | 'fetch', count = 1) { this.failing.set(`${tenantId}:${action}`, count); }
  private check(tenantId: string, action: TestCall['action'] | 'fetch') {
    const key = `${tenantId}:${action}`, left = this.failing.get(key) ?? 0;
    if (left > 0) { this.failing.set(key, left - 1); throw new AdapterError('TEST_FAILURE', 'Deneme platformu şu anda yanıt vermiyor'); }
  }
  adapter(): PlatformAdapter {
    const call = (action: TestCall['action']) => async (ctx: AdapterContext, externalId: string, input?: { reason: string }) => {
      this.check(ctx.tenantId, action);
      this.calls.push({ tenantId: ctx.tenantId, action, externalId, ...(input?.reason ? { reason: input.reason } : {}), at: ctx.now.toISOString() });
    };
    return {
      id: 'test', name: PLATFORMS.test.name, available: true, modes: ['poll'], fields: [], status: 'Mola içindeki deneme platformu. Gerçek sipariş ya da ödeme yoktur.',
      fetchOrders: async ctx => { this.check(ctx.tenantId, 'fetch'); const q = this.queues.get(ctx.tenantId) ?? []; this.queues.set(ctx.tenantId, []); return { orders: q }; },
      accept: call('accept'), reject: call('reject'), ready: call('ready'), delivered: call('delivered'), cancel: call('cancel'),
    };
  }
}

export function createAdapters(test: TestPlatform): Record<PlatformId, PlatformAdapter> {
  return { yemeksepeti: yemeksepeti(), getir: getir(), trendyol: trendyol(), migros: migros(), test: test.adapter() };
}

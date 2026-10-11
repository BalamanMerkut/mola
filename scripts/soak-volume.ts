// Soak test helper: appends a year (or more) of settled visits to an EXISTING test data folder, fast, without HTTP.
// Visits run through the real domain engine (submitOrder, setStatus, recordPayment, expenses, refunds) on a scratch
// copy of the business, and each simulated day is moved into the history tables by the server's own History.persist,
// exactly as a long-running server would do. The live snapshot (open tables, menu) is not changed.
// Only for throwaway folders made by `npm run demo:template`; never point it at a café's data. Usage:
//   npx tsx scripts/soak-volume.ts <test-veri-klasörü> [--gun=365] [--ziyaret=108] [--isletme=mola-demo]
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, snapshotKey } from '../server/store.js';
import { dataLock } from '../server/data-lock.js';
import { quote, recordPayment, setStatus, submitOrder, cancelOrder } from '../packages/domain/engine.js';
import { recordExpense } from '../packages/domain/expenses.js';
import { adjustPayment } from '../packages/domain/payment-adjustments.js';
import { saleProducts } from '../packages/domain/campaigns.js';
import type { Actor, CartLine, Product, State } from '../packages/domain/types.js';

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const option = (name: string, fallback: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const days = Number(option('gun', '365')), perDay = Number(option('ziyaret', '108')), tenant = option('isletme', 'mola-demo');
if (!target || !/[\\/]\.local[\\/]tests[\\/]/.test(resolve(target))) { console.error('Yalnız .local/tests altındaki deneme klasörleri için.'); process.exit(1); }
const directory = resolve(target);

let seedValue = 7_041_2026;
function random() { seedValue = (seedValue + 0x6d2b79f5) | 0; let t = seedValue; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const int = (a: number, b: number) => Math.floor(a + random() * (b - a + 1));
const chance = (p: number) => random() < p;
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const release = dataLock(directory, 'soak-volume');
const store = new Store(directory);
try {
  const real = store.read(tenant), key = snapshotKey(store.db, store.key, tenant)!;
  // The oldest day already in history: the new year ends the day before it.
  const oldest = Number((store.db.prepare('SELECT MIN(first_at) AS t FROM history_archives WHERE tenant=?').get(tenant) as { t: number | null }).t ?? Date.now());
  const firstDay = Date.parse(`${new Date(oldest + 3 * HOUR).toISOString().slice(0, 10)}T00:00:00+03:00`) - days * DAY;
  // Scratch business: same menu, tables and staff, an empty floor and no campaigns (none ran a year ago).
  const w: State = { ...structuredClone(real), accounts: [], orders: [], payments: [], archives: [], requests: {}, audit: [], expenses: [], paymentAdjustments: [], serviceCalls: [], campaigns: [], waiterApproval: false, autoApproveQr: false, orderNumberBase: 0 };
  for (const t of w.tables) { t.accountId = null; t.needsCleaning = false; }
  const products = w.products.filter(p => p.published !== false && !p.soldOut);
  const users = w.staffUsers!.filter(u => u.active || u.role === 'waiter');
  const actor = (role: string): Actor => { const u = pick(users.filter(u => u.role === role)); return { tenantId: tenant, id: u.id, role: u.role }; };
  const selections = (p: Product) => p.groups.flatMap(g => g.required || chance(0.2) ? [{ groupId: g.id, optionId: pick(g.options).id }] : []);
  const cart = (people: number): CartLine[] => Array.from({ length: Math.max(1, people + int(-1, 1)) }, () => { const p = pick(products); return { productId: p.id, quantity: chance(0.15) ? 2 : 1, selections: selections(p) }; });
  let accounts = 0, orders = 0, payments = 0;
  const started = performance.now();
  for (let d = 0; d < days; d++) {
    const day = firstDay + d * DAY, weekday = new Date(day + 3 * HOUR).getUTCDay();
    const visits = Math.round(perDay * (weekday === 6 ? 1.3 : weekday === 0 ? 1.2 : weekday === 5 ? 1.05 : 0.88) * (0.85 + random() * 0.3));
    for (let v = 0; v < visits; v++) {
      let at = day + 8 * HOUR + Math.floor(random() * 14.5 * HOUR);
      const ctx = () => ({ now: new Date(at), id: randomUUID });
      const table = pick(w.tables);
      if (table.accountId) continue;
      const people = int(1, 5), qr = chance(0.3), rounds = 1 + Number(chance(0.4));
      const guest: Actor = { tenantId: tenant, id: randomUUID().replace(/-/g, '').padEnd(48, '0').slice(0, 48), role: 'guest', tableId: table.id, epoch: table.epoch };
      let accountId = '';
      for (let r = 0; r < rounds; r++) {
        const lines = cart(r ? Math.ceil(people / 2) : people), by = qr && !r ? guest : actor('waiter');
        const expectedTotal = quote(saleProducts(w, new Date(at)), lines, ctx()).reduce((n, l) => n + l.total, 0);
        const o = submitOrder(w, by, { requestId: randomUUID(), tableId: table.id, lines, expectedTotal }, ctx()); accountId = o.accountId; orders++;
        if (chance(0.02)) { cancelOrder(w, actor('owner'), { requestId: randomUUID(), orderId: o.orderId, version: 1 }, ctx()); continue; }
        let version = 1;
        for (const [status, wait] of [['preparing', int(2, 5)], ['ready', int(3, 12)], ['served', int(1, 3)]] as const) {
          at += wait * MIN; version = setStatus(w, status === 'served' ? actor('waiter') : actor('kitchen'), o.orderId, version, status, new Date(at)).version;
        }
        at += int(10, 30) * MIN;
      }
      const account = w.accounts.find(a => a.id === accountId)!;
      const due = w.orders.filter(o => o.accountId === accountId && o.status !== 'cancelled').reduce((n, o) => n + o.total, 0);
      const cashier = actor(chance(0.85) ? 'cashier' : 'owner');
      if (!due) { account.status = 'closed'; account.closedAt = new Date(at).toISOString(); table.accountId = null; table.epoch++; accounts++; continue; }
      const split = due >= 20000 && chance(0.15) ? Math.round(due * (0.35 + random() * 0.3) / 100) * 100 : 0;
      for (const amount of split ? [split, due - split] : [due]) {
        const method = chance(0.6) ? 'card' : 'cash';
        const p = recordPayment(w, cashier, { requestId: randomUUID(), accountId, version: account.version, method, amount, tendered: method === 'cash' ? Math.ceil(amount / 5000) * 5000 : amount }, ctx()); payments++;
        // About one refund every few days, like the owner's corrections in the demo.
        if (chance(0.004)) adjustPayment(w, actor('owner'), { requestId: randomUUID(), paymentId: p.paymentId, revision: 0, kind: 'refund', amount: Math.min(amount, 5000), method, commission: 0, reason: 'Soğuk servis edildi; iade.' }, ctx(), store.history.paymentForAdjustment(tenant, w, p.paymentId));
        at += int(1, 3) * MIN;
      }
      table.needsCleaning = false; accounts++;
    }
    for (let e = int(1, 3); e > 0; e--) recordExpense(w, actor('cashier'), { requestId: randomUUID(), amount: int(20000, 500000), description: pick(['Süt', 'Kahve çekirdeği', 'Tatlı tedariki', 'Temizlik malzemesi', 'Buz']) }, { now: new Date(day + int(9, 18) * HOUR), id: randomUUID });
    // Next morning: everything closed yesterday is older than 6 hours and moves into history, as on a running server.
    store.db.exec('BEGIN IMMEDIATE');
    try { store.history.persist(w, key, day + DAY + 7 * HOUR); store.db.exec('COMMIT'); } catch (e) { store.db.exec('ROLLBACK'); throw e; }
    if (w.accounts.length) throw new Error(`Taşınmayan hesap kaldı: ${w.accounts.length}`);
    if (d % 30 === 29) console.log(`  ${new Date(day + 3 * HOUR).toISOString().slice(0, 10)} · ${accounts} hesap, ${orders} sipariş, ${payments} tahsilat · ${Math.round((performance.now() - started) / 1000)} sn`);
  }
  console.log(JSON.stringify({ days, accounts, orders, payments, seconds: Math.round((performance.now() - started) / 1000), counts: store.history.counts() }));
} finally { store.close(); release(); }

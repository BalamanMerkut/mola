// Development / migration: register a café data folder from before the Kafe/Merkez split with a running Mola Merkez.
//   npm run merkez:import -- <data-folder> [--merkez http://127.0.0.1:4000] [--merkez-data .local/merkez] [--password …] [--demo]
// Its businesses keep their ids and get licences matching their current ones (from the old in-process platform record, which
// is read but never changed or deleted); the folder then holds the install credentials and signed licences (table merkez_link).
// The café server for that folder must be stopped (data lock). --demo: a new, empty folder gets the demo businesses first.
// --sozlesme-kabul: demo and test folders only; Mola Lisans Sözleşmesi is recorded as accepted (a real café's owner is asked).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AGREEMENT_VERSION } from '../packages/domain/agreement.js';
import { dataLock } from '../server/data-lock.js';
import { MerkezLink, machineId } from '../server/kafe-link.js';
import { KeyVault } from '../server/key-vault.js';
import { publicKeyFrom, type License, type SignedLicense, type Ticket } from '../server/license.js';
import { open } from '../server/sealing.js';
import { Store } from '../server/store.js';

const args = process.argv.slice(2), option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const folder = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!folder) { console.error('Kullanım: npm run merkez:import -- <veri-klasörü> [--merkez http://127.0.0.1:4000] [--merkez-data .local/merkez] [--password …] [--demo]'); process.exit(2); }
const merkez = (option('--merkez') ?? process.env.MOLA_MERKEZ_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const merkezData = resolve(option('--merkez-data') ?? process.env.MERKEZ_DATA_DIR ?? '.local/merkez');
const directory = resolve(folder);
function adminPassword() {
  const given = option('--password') ?? process.env.MERKEZ_ADMIN_PASSWORD;
  if (given) return given;
  const file = join(merkezData, 'merkez-first-login.txt');
  if (!existsSync(file)) throw new Error(`Mola Yönetim şifresi bulunamadı: --password verin ya da ${file} dosyası olmalı.`);
  return readFileSync(file, 'utf8').match(/Şifre: (.+)/)![1].trim();
}
async function call<T>(path: string, body: unknown, cookie = '') {
  const r = await fetch(merkez + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({})) as T & { message?: string };
  if (!r.ok) throw new Error(`${path}: ${data.message ?? r.status}`);
  return { data, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}

const release = dataLock(directory, 'merkez-import');
let store: Store | undefined;
try {
  const vault = await KeyVault.open(directory, { protect: false });
  if (vault.state !== 'open' || !vault.key) throw new Error('Veri anahtarı açılamadı (kilitli). Önce kafe sunucusunu açıp kilidi kurtarma koduyla çözün.');
  store = new Store(directory, args.includes('--demo') ? undefined : [], { key: vault.key });
  const publicKeyFile = process.env.MOLA_MERKEZ_PUBLIC_KEY ? undefined : join(merkezData, 'merkez-public-key.txt');
  const publicKey = publicKeyFrom(publicKeyFile ? readFileSync(publicKeyFile, 'utf8') : /^[A-Za-z0-9+/=]{40,}$/.test(process.env.MOLA_MERKEZ_PUBLIC_KEY!.trim()) ? process.env.MOLA_MERKEZ_PUBLIC_KEY! : readFileSync(resolve(process.env.MOLA_MERKEZ_PUBLIC_KEY!), 'utf8'));
  const link = new MerkezLink(store, { url: merkez, publicKey });
  if (link.read()) throw new Error(`Bu klasör zaten Mola Merkez’e bağlı (kurulum ${link.read()!.installId.slice(0, 8)}). Değişiklik yapılmadı.`);
  const tenants = (store.db.prepare('SELECT tenant FROM snapshots').all() as { tenant: string }[]).map(r => r.tenant);
  if (!tenants.length) throw new Error('Bu klasörde işletme yok. Yeni kurulum Mola’yı etkinleştir ekranından yapılır.');
  // The old in-process record (read only): current licences and support history.
  let legacy: { licenses: License[]; tickets: Ticket[] } = { licenses: [], tickets: [] };
  if (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform'").get()) {
    const row = store.db.prepare('SELECT payload FROM platform WHERE id=1').get() as { payload: Uint8Array } | undefined;
    if (row) legacy = open(Buffer.from(row.payload), store.key, 'platform');
  }
  const now = new Date();
  const businesses = tenants.map(tenant => {
    const entry = store!.directoryEntry(tenant), old = legacy.licenses.find(l => l.tenantId === tenant);
    // A business the old record never knew (fresh demo folders) gets what the old panel gave it: one year.
    const license = old ? { endsAt: old.endsAt, suspended: old.suspended, ...(old.kind ? { kind: old.kind } : {}), ...(old.planMonths ? { planMonths: old.planMonths } : old.kind === 'trial' ? {} : { planMonths: 12 as const }), ...(old.service ? { service: old.service } : {}), ...(old.freezes ? { freezes: old.freezes } : {}), ...(old.trialStartedAt ? { trialStartedAt: old.trialStartedAt } : {}), ...(old.createdAt ? { createdAt: old.createdAt } : {}) }
      : { endsAt: new Date(now.getTime() + 365 * 86400000).toISOString(), suspended: false, kind: 'subscription' as const, planMonths: 12 as const };
    return { tenantId: tenant, name: entry.name, sector: entry.sector, license };
  });
  const tickets = legacy.tickets.filter(t => tenants.includes(t.tenantId));
  const login = await call('/api/merkez/admin/login', { username: 'admin', password: adminPassword() });
  const { data } = await call<{ installId: string; secret: string; licenses: SignedLicense[]; serverTime: string; reused?: boolean }>('/api/merkez/admin/import', { requestId: randomUUID().replace(/-/g, ''), machineId: machineId(), businesses, tickets }, login.cookie);
  // --sozlesme-kabul (demo and test folders only): Mola Lisans Sözleşmesi recorded as accepted, so their owner is not asked.
  link.adopt(data, tickets, args.includes('--sozlesme-kabul') ? { version: AGREEMENT_VERSION, acceptedAt: new Date().toISOString(), name: 'Deneme verisi' } : undefined);
  // Already registered once (the same business ids): Merkez kept the install and business ids and gave a new secret only.
  console.log(`${businesses.length} işletme Mola Merkez’e kaydedildi (kurulum ${data.installId.slice(0, 8)}${data.reused ? ', önceki kayıt yeniden kullanıldı' : ''}): ${businesses.map(b => b.name).join(', ')}.`);
  console.log(`Kafe sunucusunu MOLA_MERKEZ_URL=${merkez} ile açın.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
} finally { store?.close(); release(); }

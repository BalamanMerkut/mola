import { useEffect, useRef, useState } from 'react';
import { BellRing, Check, ReceiptText, VolumeX } from 'lucide-react';
import type { PublicServiceCall } from '../packages/domain/service-calls';
import type { PublicOrder, Role, StaffSnapshot } from '../packages/domain/types';
import { ringsHere } from '../packages/domain/assignments';
import { api } from './api';
import { alertMemory, fromPlatform, newPlatformOrders, playEvents, useSoundChoices, type PlatformRef, type SoundEvent } from './sounds';
import { useScreenAwake } from './wakeLock';
// Mutfak fişi modu: "Mutfak fişi basılamadı" rings here too (src/KitchenTickets.tsx).
import { printAlertEvents } from './printAlerts';

/** What staff read on a call: "Garson çağırıyor", "Hesap istiyor", or "Hesap · Kart" when the guest said how they pay (bring the POS). */
export const callLabel = (c: Pick<PublicServiceCall, 'kind' | 'method'>) => c.kind === 'bill' ? (c.method ? `Hesap · ${c.method === 'card' ? 'Kart' : 'Nakit'}` : 'Hesap istiyor') : 'Garson çağırıyor';
// Calls never expire by themselves (owner's decision): they wait until someone answers, and stand out after 5 minutes.
const LATE_MINUTES = 5;
const waited = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
const minutes = (m: number) => m < 1 ? 'şimdi' : m < 60 ? `${m} dk bekliyor` : `${Math.floor(m / 60)} sa ${m % 60} dk bekliyor`;

/** Ready orders a waiter takes to a table: platform orders go with the courier or are picked up at the counter, never by a waiter. */
export const servable = (o: PublicOrder) => o.status === 'ready' && !o.external && !fromPlatform(o);

/** Garson ataması: whether this device rings for a table (by its id, or by an order's bill). Undefined (= always) while off. */
export type Rings = (tableId?: string, accountId?: string) => boolean;
export function assignmentRings(data: Pick<StaffSnapshot, 'assignment' | 'tables' | 'eventTables' | 'takeaways'>): Rings | undefined {
  const view = data.assignment;
  if (!view) return undefined;
  const byAccount = new Map([...data.tables, ...(data.eventTables ?? []), ...(data.takeaways ?? [])].flatMap(t => t.account ? [[t.account.id, t.id] as const] : []));
  return (tableId, accountId) => ringsHere(view, tableId ?? (accountId ? byAccount.get(accountId) : undefined));
}

/**
 * Order sounds for the floor: a QR order waiting for approval (waiter, and the owner as supervisor), an order ready to
 * serve (waiter; `ready` collects them for the short note on screen), and a delivery platform order for the cashier and the
 * owner, once per platform order, whether it shows up waiting for Kabul (`external`) or already accepted (`order.external`).
 * Waiters never hear platform orders, not even when they are ready. `silent`: only note what is already there.
 * `rings` (garson ataması on): a ready order of another waiter's table is noted quietly (no sound, note or vibration).
 * The Müdür hears what the owner hears.
 */
export function orderAlerts(orders: PublicOrder[], role: Role | undefined, seen: Set<string>, external: (PlatformRef & { stage?: string })[] = [], silent = false, ready?: PublicOrder[], rings?: Rings): SoundEvent[] {
  const key = (o: PublicOrder) => `${o.id}:${o.status}`, events: SoundEvent[] = [], desk = role === 'owner' || role === 'manager' || role === 'cashier';
  const waiting = external.filter(e => !e.stage || e.stage === 'pending');
  if (silent) { for (const o of orders) seen.add(key(o)); newPlatformOrders([...waiting, ...orders.flatMap(o => o.external ? [o.external] : [])], true); return events; }
  for (const o of orders) {
    if (seen.has(key(o))) continue;
    seen.add(key(o));
    if (o.external || fromPlatform(o)) { if (desk && (o.external ? newPlatformOrders([o.external]) : true)) events.push('externalOrder'); continue; }
    if (o.status === 'awaiting_approval' && (role === 'waiter' || role === 'owner' || role === 'manager')) events.push('approval');
    if (o.status === 'ready' && role === 'waiter' && (!rings || rings(o.takeaway?.tableId, o.accountId))) { events.push('ready'); ready?.push(o); }
  }
  if (desk && newPlatformOrders(waiting)) events.push('externalOrder');
  return events;
}

const none: PlatformRef[] = [];
/**
 * The floor's sounds (waiter, cashier, owner), mounted once for the whole workspace: they ring whichever view is open.
 * Browsers start sound only after a tap; until then a small "Ses kapalı · açmak için dokunun" asks for one (any tap does).
 * The waiter's phone stays awake while Mola is on screen and vibrates when an order is ready (`onReady` shows the note).
 */
export function FloorAlerts({ calls, orders, external = none, role, memory, onReady, rings }: { calls: PublicServiceCall[]; orders: PublicOrder[]; external?: (PlatformRef & { stage?: string })[]; role: Role; memory: string; onReady?: (orders: PublicOrder[]) => void; rings?: Rings }) {
  useSoundChoices();
  useScreenAwake(role === 'waiter');
  const audio = useRef<AudioContext | null>(null), [ready, setReady] = useState(true);
  const announce = useRef(onReady); announce.current = onReady;
  // Garson ataması: calls and ready orders of another waiter's table are seen in the lists but do not ring here.
  const ringFor = useRef(rings); ringFor.current = role === 'waiter' ? rings : undefined;
  useEffect(() => {
    let live = true, ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { setReady(true); return; /* sound is optional */ }
    audio.current = ctx;
    const sync = () => { if (live) setReady(ctx.state === 'running'); };
    const unlock = () => { if (!live || ctx.state === 'closed') return; if (ctx.state === 'running') { sync(); return; } void ctx.resume().then(sync).catch(sync); };
    const visible = () => { if (document.visibilityState === 'visible') unlock(); };
    ctx.onstatechange = sync; sync(); unlock();
    document.addEventListener('pointerdown', unlock); document.addEventListener('keydown', unlock); document.addEventListener('visibilitychange', visible);
    return () => { live = false; ctx.onstatechange = null; document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); document.removeEventListener('visibilitychange', visible); void ctx.close().catch(() => {}); audio.current = null; };
  }, []);
  useEffect(() => {
    const calls$ = alertMemory(`${memory}:calls`), orders$ = alertMemory(`${memory}:orders`);
    // Each kind has its own sound; a waiter call and a bill request arriving together play one after the other.
    const rings = ringFor.current;
    const fresh: SoundEvent[] = calls.filter(c => !calls$.seen.has(c.id) && (!rings || rings(c.tableId))).map(c => c.kind === 'bill' ? 'billRequest' : 'waiterCall');
    for (const c of calls) calls$.seen.add(c.id);
    const done: PublicOrder[] = [], events = [...(calls$.first ? [] : fresh), ...orderAlerts(orders, role, orders$.seen, external, orders$.first, done, rings), ...printAlertEvents(orders, orders$.seen, orders$.first)];
    if (done.length) { announce.current?.(done); try { navigator.vibrate?.([180, 90, 180]); } catch { /* not every device vibrates */ } }
    if (audio.current && events.length) playEvents(audio.current, events);
  }, [calls, orders, external, role, memory]);
  if (ready) return null;
  return <button type="button" className="sound-unlock" onClick={() => { void audio.current?.resume().catch(() => {}); }}><VolumeX size={14} aria-hidden="true" />Ses kapalı · açmak için dokunun</button>;
}

/**
 * The waiting calls (Garson çağırıyor, Hesap istiyor) with "Tamam"; sounds are FloorAlerts'. `compact` (the waiter's phone,
 * Masalar, 8 Ekim): one row of small chips that scrolls sideways, so the table grid stays on the first screen.
 */
export function ServiceCallBar({ calls, onOpenTable, onAnswered, onError, compact = false }: { calls: PublicServiceCall[]; onOpenTable: (tableId: string) => void; onAnswered: () => void; onError: (message: string) => void; compact?: boolean }) {
  const [now, setNow] = useState(Date.now()), [busy, setBusy] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  if (!calls.length) return null;
  async function answer(id: string) {
    setBusy(id);
    try { await api('/api/staff/calls/resolve', { callId: id }); onAnswered(); } catch (e) { onError((e as Error).message); } finally { setBusy(''); }
  }
  return <section className={`service-call-bar${compact ? ' compact' : ''}`} aria-label="Masa çağrıları" role="status">
    {[...calls].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(c => { const m = waited(c.createdAt, now); return <div className={`service-call-chip ${c.kind} ${m >= LATE_MINUTES ? 'late' : ''}`} key={c.id}>
      <button type="button" className="service-call-open" onClick={() => onOpenTable(c.tableId)} title="Masayı aç">{c.kind === 'bill' ? <ReceiptText size={16} aria-hidden="true" /> : <BellRing size={16} aria-hidden="true" />}<strong>{c.tableName}</strong><span>{callLabel(c)}</span><small>{minutes(m)}</small></button>
      <button type="button" className="service-call-done" disabled={busy === c.id} onClick={() => void answer(c.id)} aria-label={`${c.tableName} çağrısını kapat`}><Check size={15} /><span className="service-call-done-label">Tamam</span></button>
    </div>; })}
  </section>;
}

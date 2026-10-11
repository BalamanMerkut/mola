import { HelpTip } from './HelpTip';
import { KitchenWakeLock } from './KitchenWakeLock';
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { alertMemory, fromPlatform, newPlatformOrders, playEvents, playSound, soundChoice, useSoundChoices, type PlatformRef, type SoundEvent } from './sounds';
import type { PublicOrder } from '../packages/domain/types';
import { amountLabel } from '../packages/domain/lines';

/** A cancellation the kitchen should see at once: the red "İPTAL · kim · neden" strip above the board (~30 s). */
export type KitchenNotice = { id: string; orderId: string; heading: string; who: string; reason: string; items: string };
const itemsText = (lines: PublicOrder['lines']) => lines.map(l => `${amountLabel(l)} ${l.name}`).join(', ');
const whoCancelled = (o: PublicOrder) => o.cancelledByName ?? (o.external ? 'Platform' : o.source === 'qr' ? 'Müşteri' : 'Personel');

/**
 * Kitchen sounds for what just arrived: a QR order waiting for approval, a new order to prepare, and a delivery platform
 * order (waiting for Kabul in `external`, or already accepted with `order.external`), each platform order once.
 * Cancellations ring too ("Sipariş iptali"): a whole order or some items taken off by someone else (`notices` gets the
 * strip's text), and a guest asking to cancel (the card itself shows the request). `me`: the kitchen's own cancellations
 * stay quiet. The first call (`first`) only notes what is already on screen.
 */
export function kitchenAlerts(orders: PublicOrder[], external: (PlatformRef & { stage?: string })[], seen: Set<string>, first = false, me?: string, notices?: KitchenNotice[]): SoundEvent[] {
  const key = (o: PublicOrder) => `${o.id}:${o.status === 'awaiting_approval' ? 'approval' : 'order'}`, events: SoundEvent[] = [];
  const marks = (o: PublicOrder) => [...(o.status === 'cancelled' ? [`${o.id}:cancelled`] : []), ...(o.cancellations ?? []).map(c => `${o.id}:cx:${c.id}`), ...(o.cancelRequested ? [`${o.id}:request:${o.version}`, `${o.id}:asked`] : [])];
  const waiting = external.filter(e => !e.stage || e.stage === 'pending');
  if (first) { for (const o of orders) { seen.add(key(o)); for (const m of marks(o)) seen.add(m); } newPlatformOrders([...waiting, ...orders.flatMap(o => o.external ? [o.external] : [])], true); return events; }
  const heading = (o: PublicOrder) => `${o.tableName} · #${o.number}`;
  for (const o of orders) {
    // A whole order the kitchen had on its board (seen as an order, not only waiting for approval) was cancelled.
    if (o.status === 'cancelled' && !seen.has(`${o.id}:cancelled`)) {
      seen.add(`${o.id}:cancelled`);
      if (seen.has(`${o.id}:order`) && (!o.cancelledBy || o.cancelledBy !== me)) {
        // The kitchen already heard (and decided) a guest's request: the strip says it, without a second sound.
        if (!seen.has(`${o.id}:asked`)) events.push('kitchenCancel');
        notices?.push({ id: `${o.id}:whole`, orderId: o.id, heading: heading(o), who: whoCancelled(o), reason: o.cancelReason ?? '', items: itemsText(o.lines) });
      }
    }
    for (const c of o.cancellations ?? []) {
      const mark = `${o.id}:cx:${c.id}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      if (c.by === me) continue;
      events.push('kitchenCancel');
      notices?.push({ id: mark, orderId: o.id, heading: heading(o), who: c.byName ?? 'Personel', reason: c.reason, items: itemsText(c.lines) });
    }
    if (o.cancelRequested && !seen.has(`${o.id}:request:${o.version}`)) { seen.add(`${o.id}:request:${o.version}`); seen.add(`${o.id}:asked`); events.push('kitchenCancel'); }
    if (seen.has(key(o))) continue;
    seen.add(key(o));
    if (!['new', 'awaiting_approval'].includes(o.status)) continue;
    if (o.external) { if (newPlatformOrders([o.external])) events.push('externalOrder'); }
    else events.push(fromPlatform(o) ? 'externalOrder' : o.status === 'awaiting_approval' ? 'approval' : 'kitchen');
  }
  if (newPlatformOrders(waiting)) events.push('externalOrder');
  return events;
}

const none: PlatformRef[] = [];
/**
 * Kitchen sound, "Ekranı açık tut" and the sound switch. Mounted for the kitchen account on every view (Mutfak, Stok,
 * Hesabım), so a new order rings and the tablet stays awake while the cook counts stock. `memory`: who is signed in.
 */
export function KitchenSound({ orders, external = none, me, memory = 'kitchen', onCancel }: { orders: PublicOrder[]; external?: (PlatformRef & { stage?: string })[]; me?: string; memory?: string; onCancel?: (notices: KitchenNotice[]) => void }) {
  useSoundChoices();
  const audio = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(() => { try { return sessionStorage.getItem('mola-kitchen-muted') !== '1'; } catch { return true; } });
  const desired = useRef(enabled); desired.current = enabled;
  const [ready, setReady] = useState(false); const [last, setLast] = useState('');
  const cancelled = useRef(onCancel); cancelled.current = onCancel;
  useEffect(() => {
    let live = true, resuming = false;
    try {
      const ctx = new AudioContext(); audio.current = ctx;
      ctx.onstatechange = () => { if (live) setReady(ctx.state === 'running'); };
      const resume = () => {
        if (!live || resuming || !desired.current || ctx.state === 'closed') return;
        // Already playing (the browser allowed sound without a tap): say so instead of asking for a tap.
        if (ctx.state === 'running') { setReady(true); return; }
        resuming = true;
        void ctx.resume().then(() => { if (live) setReady(ctx.state === 'running'); }).catch(() => { if (live) setReady(false); }).finally(() => { resuming = false; });
      };
      const visible = () => { if (document.visibilityState === 'visible') resume(); };
      const activate = (event: Event) => { if (!(event.target instanceof Element && event.target.closest('[data-kitchen-sound]'))) resume(); };
      resume(); document.addEventListener('pointerdown', activate); document.addEventListener('keydown', activate); document.addEventListener('visibilitychange', visible);
      return () => { live = false; document.removeEventListener('pointerdown', activate); document.removeEventListener('keydown', activate); document.removeEventListener('visibilitychange', visible); ctx.onstatechange = null; void ctx.close().catch(() => {}); audio.current = null; };
    } catch { setReady(false); }
  }, []);
  useEffect(() => {
    // The kitchen also sees QR orders waiting for approval: one sound when one arrives, another when it is approved and
    // becomes a new order to prepare. Several orders of the same kind at once ring once; the same kind again within 5 s too.
    const { seen, first } = alertMemory(memory), notices: KitchenNotice[] = [];
    const events = kitchenAlerts(orders, external, seen, first, me, notices);
    if (notices.length) cancelled.current?.(notices);
    if (!events.length) return;
    if (desired.current && audio.current) playEvents(audio.current, events);
    const time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }), arrived = events.filter(e => e !== 'kitchenCancel').length;
    setLast(`${arrived ? `${arrived} yeni sipariş` : 'Sipariş iptali'} · ${time}`);
  }, [orders, external, me, memory]);
  function toggle() {
    if (enabled && ready) { desired.current = false; setEnabled(false); try { sessionStorage.setItem('mola-kitchen-muted', '1'); } catch {} return; }
    desired.current = true; setEnabled(true); try { sessionStorage.removeItem('mola-kitchen-muted'); } catch {}
    // Turning the sound on plays the kitchen's sound once, so the cook hears it works.
    try { audio.current ??= new AudioContext(); const ctx = audio.current; void ctx.resume().then(() => { setReady(ctx.state === 'running'); if (desired.current) playSound(ctx, soundChoice('kitchen').sound); }).catch(() => setReady(false)); } catch { setReady(false); }
  }
  const label = enabled ? ready ? 'Sipariş sesini kapat' : 'Sipariş sesini etkinleştir' : 'Sipariş sesini aç';
  return <div className="kitchen-tools"><KitchenWakeLock /><div className="kitchen-sound-compact" data-kitchen-sound><button className={`sound-icon ${enabled && ready ? 'sound-on' : ''} ${enabled && !ready ? 'sound-pending' : ''}`} aria-label={label} aria-pressed={enabled && ready} title={`${label}${last ? ` · ${last}` : ''}`} onClick={toggle}>{enabled ? <Volume2 size={23} /> : <VolumeX size={23} />}{enabled && !ready && <span className="sound-dot" />}</button><HelpTip title="Sipariş sesi">{`${enabled ? ready ? 'Ses açık.' : 'Ses için hoparlöre dokunun.' : 'Ses kapalı.'} Yeni sipariş ve iptal geldiğinde kısa bir uyarı çalar; Stok ya da Hesabım ekranındayken de. Hoparlöre dokunarak açıp kapatabilirsiniz. Cihazın sesi açık olmalı. Hangi sesin çalacağını işletme sahibi Ayarlar → Cihazlar → Sesler'den seçer.${last ? ` Son bildirim: ${last}.` : ''}`}</HelpTip><span className="kitchen-status-sr" role="status">{enabled && !ready ? 'Ses için dokunun' : enabled ? 'Ses açık' : 'Sessiz'}</span></div></div>;
}

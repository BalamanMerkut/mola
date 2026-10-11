import type { PublicOrder, StaffSnapshot } from '../packages/domain/types';
import type { SoundEvent } from './sounds';

/*
 * Mutfak fişi modu rules the screens share, without styles (src/ServiceCallBar.tsx imports these; unit tests load that file).
 * The warning, "Teslim edildi" and the settings card are in src/KitchenTickets.tsx and src/KitchenModeCard.tsx.
 */
export const ticketMode = (data: Pick<StaffSnapshot, 'printing'>) => !!data.printing?.ticketMode;
/** Places nobody needs in Fiş modu: the waiter's "Servise hazır" list. (The kitchen board is the kitchen account's alone, src/roleNav.ts.) */
export const hiddenInTicketMode = (id: string, data: Pick<StaffSnapshot, 'printing'>) => ticketMode(data) && id === 'ready';
/** "Teslim edildi" is possible: printed (Hazırlanıyor) in Fiş modu, ready otherwise; no open cancel request; paid first where required. */
export const canHandOver = (o: PublicOrder, ticket: boolean) => (o.status === 'ready' || (ticket && o.status === 'preparing')) && !o.cancelRequested && (!o.paymentBeforePreparation || !!o.paid);
/** Who works the counter: hands paid masasız orders over early and, in Fiş modu, marks platform orders "Hazır". */
export const counterRole = (role: string) => role === 'owner' || role === 'manager' || role === 'cashier';
/** A paid masasız order (not a platform one) the counter may hand over before "Hazır" (engine.ts setStatus `early`). */
export const deliverEarly = (o: PublicOrder) => !o.external && !!o.paid && (o.status === 'new' || o.status === 'preparing') && !o.cancelRequested;
/** Fiş modu: a printed platform order the counter may mark "Hazır" (the platform is told). */
export const platformReady = (o: PublicOrder, ticket: boolean) => ticket && !!o.external && o.status === 'preparing' && !o.cancelRequested;
/** Open print warnings: orders still in the kitchen's hands with a ticket that did not print. */
export const openProblems = (orders: PublicOrder[]) => orders.flatMap(o => !['cancelled', 'served'].includes(o.status) ? (o.printProblems ?? []).map(problem => ({ order: o, problem })) : []);

/** The warning sound (Ayarlar → Sesler → "Mutfak fişi basılamadı"), once per problem; `silent` only notes what is already there. */
export function printAlertEvents(orders: PublicOrder[], seen: Set<string>, silent = false): SoundEvent[] {
  let fresh = false;
  for (const { order, problem } of openProblems(orders)) {
    const key = `${order.id}:print:${problem.printerId}:${problem.at}`;
    if (seen.has(key)) continue;
    seen.add(key); fresh = true;
  }
  return fresh && !silent ? ['printError'] : [];
}

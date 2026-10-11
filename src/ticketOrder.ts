import type { Ticket, TicketMessage } from '../server/license';
export type TicketOrder = 'recent' | 'waiting';
export const awaitsSupport = (ticket: Ticket) => ticket.status === 'open' && ticket.messages.at(-1)?.source === 'business';
/** The Mola team started this conversation ("Yeni mesaj" in Mola Yönetim): its first message is theirs. */
export const startedByMola = (ticket: Ticket) => ticket.messages[0]?.source === 'support';
function waitingSince(ticket: Ticket) {
  let at = ticket.messages.at(-1)?.at ?? ticket.createdAt;
  for (let i = ticket.messages.length - 1; i >= 0 && ticket.messages[i].source === 'business'; i--) at = ticket.messages[i].at;
  return at;
}
export function compareTickets(a: Ticket, b: Ticket, order: TicketOrder) {
  const aTime = a.messages.at(-1)?.at ?? a.createdAt, bTime = b.messages.at(-1)?.at ?? b.createdAt;
  if (order === 'waiting') {
    const aWaits = awaitsSupport(a), bWaits = awaitsSupport(b);
    if (aWaits !== bWaits) return aWaits ? -1 : 1;
    if (aWaits) return waitingSince(a).localeCompare(waitingSince(b)) || a.id.localeCompare(b.id);
  }
  return bTime.localeCompare(aTime) || b.id.localeCompare(a.id);
}

// ---------- Destek as a chat (src/TicketChat.tsx): times, the status chip and the conversation's lines ----------
/** Who is looking: the café owner ('business') or the Mola team in Mola Yönetim ('support'). */
export type TicketSide = 'business' | 'support';
/** A moment that is not a message: today only "the Mola team closed it" (from Mola Yönetim's İşlem geçmişi). */
export type TicketEvent = { ticketId: string; kind: 'closed'; at: string };
type ChatMessage = TicketMessage & { queued?: boolean };
export type TimelineEntry =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'system'; key: string; at: string; text: string }
  | { kind: 'message'; key: string; at: string; message: ChatMessage; mine: boolean; first: boolean; last: boolean };

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const SHORT_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** 0 today, 1 yesterday… on this computer's calendar. */
export const daysAgo = (iso: string, now = new Date()) => Math.round((midnight(now) - midnight(new Date(iso))) / 86_400_000);
export const clockTime = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** The list's time: "14:05" today, "Dün", "3 Eki" (and the year when it is not this year). */
export function listTime(iso: string, now = new Date()) {
  const ago = daysAgo(iso, now), d = new Date(iso);
  if (ago <= 0) return clockTime(iso);
  if (ago === 1) return 'Dün';
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}
/** The conversation's day line: "Bugün", "Dün", "3 Ekim" (and the year when it is not this year). */
export function dayTitle(iso: string, now = new Date()) {
  const ago = daysAgo(iso, now), d = new Date(iso);
  if (ago <= 0) return 'Bugün';
  if (ago === 1) return 'Dün';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}
export const lastActivity = (t: Ticket) => t.messages.at(-1)?.at ?? t.createdAt;
/**
 * One chip per ticket, the same three words on both sides: "Kapandı"; "Yanıt bekleniyor" (the café is waiting for the Mola
 * team: Mola Yönetim reads it as "answer this", the owner as "we wrote, an answer is coming"); otherwise "Açık".
 */
export function ticketChip(t: Ticket): { label: 'Açık' | 'Yanıt bekleniyor' | 'Kapandı'; tone: 'open' | 'waiting' | 'closed' } {
  if (t.status === 'closed') return { label: 'Kapandı', tone: 'closed' };
  return awaitsSupport(t) ? { label: 'Yanıt bekleniyor', tone: 'waiting' } : { label: 'Açık', tone: 'open' };
}

/**
 * The conversation as lines: day separators, the messages (grouped when the same side writes within 5 minutes) and the
 * small system lines: opened, closed (Mola Yönetim's İşlem geçmişi; without it the closing answer's time) and reopened
 * (the café wrote again after a close; Mola Merkez then opens the ticket again).
 */
export function ticketTimeline(t: Ticket & { messages: ChatMessage[] }, side: TicketSide, opts: { events?: TicketEvent[]; businessName?: string; now?: Date } = {}): TimelineEntry[] {
  type Raw = { at: string; rank: number; key: string } & ({ kind: 'system'; text: string } | { kind: 'message'; message: ChatMessage });
  const raw: Raw[] = [{ kind: 'system', at: t.createdAt, rank: 0, key: 'opened', text: startedByMola(t) ? 'Mola ekibi görüşmeyi başlattı' : side === 'support' ? `${opts.businessName ?? 'İşletme'} talebi açtı` : 'Talep açıldı' }];
  for (const m of t.messages) raw.push({ kind: 'message', at: m.at, rank: 2, key: m.id, message: m });
  const closes = (opts.events ?? []).filter(e => e.ticketId === t.id && e.kind === 'closed').map(e => e.at).sort();
  const lastBusiness = [...t.messages].reverse().find(m => m.source === 'business')?.at ?? t.createdAt;
  if (t.status === 'closed' && !closes.some(at => at >= lastBusiness)) closes.push([...t.messages].reverse().find(m => m.source === 'support')?.at ?? lastActivity(t));
  const reopened = new Set<string>();
  for (const at of closes) {
    raw.push({ kind: 'system', at, rank: 3, key: `closed-${at}`, text: side === 'support' ? 'Talep kapatıldı' : 'Mola ekibi talebi kapattı' });
    const next = t.messages.find(m => m.source === 'business' && m.at > at);
    if (next && !reopened.has(next.id)) { reopened.add(next.id); raw.push({ kind: 'system', at: next.at, rank: 1, key: `reopened-${next.id}`, text: 'Talep yeniden açıldı' }); }
  }
  raw.sort((a, b) => a.at.localeCompare(b.at) || a.rank - b.rank);
  const out: TimelineEntry[] = [];
  let day = '';
  raw.forEach((r, i) => {
    const d = new Date(r.at), key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== day) { day = key; out.push({ kind: 'day', key: `day-${key}`, label: dayTitle(r.at, opts.now) }); }
    if (r.kind === 'system') { out.push({ kind: 'system', key: r.key, at: r.at, text: `${r.text} · ${clockTime(r.at)}` }); return; }
    const near = (o: Raw | undefined) => !!o && o.kind === 'message' && o.message.source === r.message.source && Math.abs(Date.parse(o.at) - Date.parse(r.at)) < 5 * 60_000 && daysAgo(o.at, d) === 0 && daysAgo(r.at, new Date(o.at)) === 0;
    out.push({ kind: 'message', key: r.key, at: r.at, message: r.message, mine: r.message.source === side, first: !near(raw[i - 1]), last: !near(raw[i + 1]) });
  });
  return out;
}

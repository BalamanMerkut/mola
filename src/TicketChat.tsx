import { AlertCircle, ArrowDown, ArrowLeft, Check, Clock, Lock, MessageSquare, Send } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { AttachmentRef, Ticket } from '../server/license';
import { AttachButton, filesFrom, Lightbox, MessageFiles, restoreUploads, UploadList, useUploads } from './TicketFiles';
import { api, ApiError, requestId } from './api';
import { TicketInbox } from './TicketInbox';
import { awaitsSupport, clockTime, lastActivity, startedByMola, ticketChip, ticketTimeline, type TicketEvent, type TicketSide, type TimelineEntry } from './ticketOrder';
import './ticket-chat.css';

/**
 * Destek as a chat window, the same on the café (Destek → Talepler) and in Mola Yönetim (Destek, and a business's Destek
 * tab): the ticket list on the left, the conversation on the right; on phones and tablets two screens with a back arrow
 * (the conversation covers the screen). The viewer's own messages are on the right in the brand colour.
 *
 * Sending: the message leaves the box at once and shows as a bubble ("Gönderiliyor"); if the answer does not come back it
 * says "Gönderilemedi · Tekrar dene", and "Tekrar dene" sends the same request again (same requestId, so it is saved once
 * even when the first try did arrive). Drafts and unsent messages are kept per ticket while the panel is open (switching
 * tickets or pages does not lose them); closing the browser with one asks first.
 */
export const NEW_TICKET = 'new';
const LIMIT = 4000, WARN_AT = 3600, PAGE = 60, OUTGOING = '__outgoing';
export const CLOSE_TEXT = 'Sorun çözüldü. Destek talebi kapatıldı.';
type Message = Ticket['messages'][number] & { queued?: boolean };

// ---------- Drafts and the outbox: kept outside the screens, so they survive switching tickets or pages ----------
type Outgoing = { ticketId: string; requestId: string; text: string; close: boolean; attachments: AttachmentRef[]; at: string; known: string[]; state: 'sending' | 'failed' | 'sent'; error?: string; definite?: boolean };
const outbox = new Map<string, Outgoing>(), drafts = new Map<string, string>(), listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useChatStore = () => useSyncExternalStore(subscribe, () => version);
const slot = (side: TicketSide, ticketId: string) => `${side}:${ticketId}`;
async function deliver(side: TicketSide, out: Outgoing, refresh: () => unknown) {
  out.state = 'sending'; out.error = undefined; emit();
  try {
    await api(side === 'support' ? '/api/merkez/admin/tickets/reply' : '/api/staff/support/reply', { requestId: out.requestId, ticketId: out.ticketId, text: out.text, ...(side === 'support' ? { close: out.close } : {}), ...(out.attachments.length ? { attachments: out.attachments.map(a => a.id) } : {}) });
    out.state = 'sent'; emit();
    // The bubble goes when the saved message shows up in the next snapshot (at the latest after 20 s).
    setTimeout(() => { if (outbox.get(slot(side, out.ticketId)) === out) { outbox.delete(slot(side, out.ticketId)); emit(); } }, 20_000);
    await refresh();
  } catch (e) { out.state = 'failed'; out.definite = e instanceof ApiError && e.status < 500; out.error = (e as Error).message; emit(); }
}

// ---------- Read marks: per browser (localStorage), what was already here on the first visit counts as read ----------
const lastOther = (t: Ticket, side: TicketSide) => [...t.messages].reverse().find(m => m.source !== side)?.at ?? '';
function useSeen(side: TicketSide, tickets: Ticket[]) {
  const key = `mola.destek.okundu.${side}`;
  const save = (v: Record<string, string>) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window: dots only for this visit */ } };
  const [seen, setSeen] = useState<Record<string, string>>(() => {
    try { const raw = localStorage.getItem(key); if (raw) return JSON.parse(raw) as Record<string, string>; } catch { /* below */ }
    // First visit in this browser: Mola Yönetim keeps the dot on what still waits for an answer, the café on a conversation the
    // Mola team started and nobody here answered yet; the rest counts as read.
    const waiting = (t: Ticket) => side === 'support' ? awaitsSupport(t) : startedByMola(t) && !t.messages.some(m => m.source === 'business');
    const base = Object.fromEntries(tickets.map(t => [t.id, waiting(t) ? '' : lastOther(t, side)])); save(base); return base;
  });
  const unread = (t: Ticket) => { const at = lastOther(t, side); return !!at && (seen[t.id] ?? '') < at; };
  const markSeen = (t: Ticket) => {
    const at = lastOther(t, side);
    if (!at || (seen[t.id] ?? '') >= at) return;
    // Another Destek screen (or tab) may have marked others meanwhile: the newer mark wins for each ticket.
    setSeen(current => {
      let stored: Record<string, string> = {}; try { stored = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* none */ }
      const next = { ...current };
      for (const [id, value] of Object.entries(stored)) if (typeof value === 'string' && value > (next[id] ?? '')) next[id] = value;
      next[t.id] = at; save(next); return next;
    });
  };
  return { unread, markSeen };
}
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 899.98px)').matches;
const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function TicketChat({ side, tickets, selected, onSelect, onSaved, events, names, businesses, businessId, onBusinessChange, headerExtra, businessLabel, newTicket, readOnly, initialFilter }: {
  side: TicketSide; tickets: Ticket[]; selected: string; onSelect: (id: string) => void; onSaved: () => unknown;
  events?: TicketEvent[]; names?: Map<string, string>; businesses?: { tenantId: string; name: string }[]; businessId?: string; onBusinessChange?: (id: string) => void;
  /** Mola Yönetim: a thin line under the conversation's title (the business, its plan, phone and e-mail). */
  headerExtra?: (t: Ticket) => ReactNode;
  /** Mola Yönetim: the business name as a button opening its preview (src/PlatformBusinessPeek.tsx), in the header and the list. */
  businessLabel?: (tenantId: string) => ReactNode;
  /** The café: the new ticket form (shown in the conversation pane; `back` returns to the list on phones). */
  newTicket?: (back: () => void) => ReactNode;
  /** Nothing can be sent (the business's record was closed): said instead of the message box. */
  readOnly?: string; initialFilter?: 'open' | 'all';
}) {
  useChatStore();
  const { unread, markSeen } = useSeen(side, tickets);
  const ticket = tickets.find(t => t.id === selected);
  const creating = selected === NEW_TICKET && !!newTicket;
  const active = !!ticket || creating;
  // Phones and tablets: the conversation covers the screen; the page behind it does not scroll.
  useEffect(() => {
    if (!active || !narrow()) return;
    document.documentElement.classList.add('tc-overlay-open');
    return () => document.documentElement.classList.remove('tc-overlay-open');
  }, [active]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if ([...drafts.values()].some(v => v.trim()) || [...outbox.values()].some(o => o.state !== 'sent')) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const back = () => onSelect('');
  // Another business chosen: an open conversation of a different business closes (the list and the pane agree).
  const chooseBusiness = onBusinessChange && ((id: string) => { if (id && ticket && ticket.tenantId !== id) onSelect(''); onBusinessChange(id); });
  return <div className={`tc${active ? ' has-selection' : ''}`} data-side={side}>
    <TicketInbox side={side} tickets={tickets} selected={selected} onSelect={onSelect} unread={unread} names={names} businesses={businesses} businessId={businessId} onBusinessChange={chooseBusiness} onNew={newTicket && !readOnly ? () => onSelect(NEW_TICKET) : undefined} newActive={creating} initialFilter={initialFilter} businessLabel={businessLabel} />
    <div className="tc-main">
      {/* The café opens on the list and this panel; the form only with "Yeni talep" (8 Ekim: an always-open form made "Yeni talep" seem to do nothing). */}
      {ticket ? <TicketThread key={ticket.id} side={side} ticket={ticket} events={events} businessName={names?.get(ticket.tenantId)} businessLabel={businessLabel?.(ticket.tenantId)} onBack={back} onSaved={onSaved} onSeen={markSeen} extra={headerExtra?.(ticket)} readOnly={readOnly} onNew={newTicket && !readOnly ? () => onSelect(NEW_TICKET) : undefined} />
        : creating ? newTicket!(back)
        : <div className="tc-placeholder"><MessageSquare size={30} strokeWidth={1.5} aria-hidden="true" />
          {!tickets.length && newTicket && !readOnly ? <><h3>Henüz destek talebiniz yok</h3><p>Bir sorununuz ya da sorunuz olduğunda Mola ekibine yazın; yanıtlar burada görünür.</p></>
            : <p>{tickets.length ? 'Bir talep seçin; konuşma burada açılır.' : readOnly ?? 'Henüz destek talebi yok.'}</p>}
          {newTicket && !readOnly && <button type="button" className="btn primary small-btn" onClick={() => onSelect(NEW_TICKET)}>Yeni talep aç</button>}
        </div>}
    </div>
  </div>;
}

function TicketThread({ side, ticket, events, businessName, businessLabel, onBack, onSaved, onSeen, extra, readOnly, onNew }: {
  side: TicketSide; ticket: Ticket; events?: TicketEvent[]; businessName?: string; businessLabel?: ReactNode; onBack: () => void; onSaved: () => unknown; onSeen: (t: Ticket) => void;
  extra?: ReactNode; readOnly?: string; onNew?: () => void;
}) {
  useChatStore();
  const key = slot(side, ticket.id), out = outbox.get(key), draft = drafts.get(key) ?? '';
  const setDraft = (v: string) => { if (v) drafts.set(key, v); else drafts.delete(key); emit(); };
  const [confirming, setConfirming] = useState(false), [shown, setShown] = useState(PAGE), [pill, setPill] = useState(false);
  const uploads = useUploads(side, key, ticket.id), [note, setNote] = useState(''), [viewing, setViewing] = useState<AttachmentRef | null>(null), [dragging, setDragging] = useState(false);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 7000); return () => clearTimeout(t); }, [note]);
  const addFiles = (files: File[]) => { if (files.length) setNote(uploads.add(files)); };
  const scroller = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), atBottom = useRef(true), anchor = useRef<number | null>(null), lastKey = useRef('');
  const messages = ticket.messages as Message[];
  const sameFiles = (a?: AttachmentRef[], b?: AttachmentRef[]) => (a ?? []).map(x => x.id).join() === (b ?? []).map(x => x.id).join();
  const arrived = !!out && out.state === 'sent' && messages.some(m => m.source === side && !out.known.includes(m.id) && m.text.trim() === out.text.trim() && sameFiles(m.attachments, out.attachments));
  useEffect(() => { if (arrived && outbox.get(key) === out) { outbox.delete(key); emit(); } }, [arrived, key, out]);
  const list: Message[] = out && !arrived ? [...messages, { id: OUTGOING, source: side, text: out.text.trim(), at: out.at, ...(out.attachments.length ? { attachments: out.attachments } : {}) }] : messages;
  const entries = ticketTimeline({ ...ticket, messages: list }, side, { events, businessName });
  const older = Math.max(0, entries.length - shown);
  let visible = older ? entries.slice(older) : entries;
  if (older && visible[0]?.kind !== 'day') { const day = entries.slice(0, older).reverse().find(e => e.kind === 'day'); if (day) visible = [day, ...visible]; }
  const end = visible.at(-1)?.key ?? '';
  const other = side === 'support' ? businessName ?? 'İşletme' : 'Mola ekibi';
  const sending = out?.state === 'sending' || (out?.state === 'sent' && !arrived), failed = out?.state === 'failed';
  const canWrite = ticket.status === 'open' && !readOnly;

  // Newest at the bottom: opening a ticket starts there; a new line keeps you there (or shows "Yeni mesaj" when you scrolled up).
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return;
    if (!lastKey.current) { el.scrollTop = el.scrollHeight; lastKey.current = end; return; }
    if (end === lastKey.current) return;
    lastKey.current = end;
    const last = visible.at(-1);
    if (atBottom.current || (last?.kind === 'message' && last.mine)) { el.scrollTop = el.scrollHeight; atBottom.current = true; setPill(false); } else setPill(true);
  });
  // Older messages shown above: the message you were reading stays where it was.
  useLayoutEffect(() => { const el = scroller.current; if (el && anchor.current !== null) { el.scrollTop = el.scrollHeight - anchor.current; anchor.current = null; } }, [shown]);
  // The box grows while typing (or the window changes): still at the bottom if you were.
  useEffect(() => {
    const el = scroller.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => { if (atBottom.current) el.scrollTop = el.scrollHeight; });
    watch.observe(el); return () => watch.disconnect();
  }, []);
  const seenAt = lastOther(ticket, side);
  useEffect(() => { onSeen(ticket); }, [ticket.id, seenAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (canWrite && !touch() && !narrow()) input.current?.focus({ preventScroll: true }); }, [canWrite]);
  useLayoutEffect(() => { const el = input.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight + 2, 170)}px`; }, [draft]);

  const olderNow = () => { const el = scroller.current; if (!el || anchor.current !== null) return; anchor.current = el.scrollHeight - el.scrollTop; setShown(s => s + PAGE); };
  const onScroll = () => {
    const el = scroller.current; if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (atBottom.current && pill) setPill(false);
    if (el.scrollTop < 48 && older > 0) olderNow();
  };
  function submit(close = false) {
    const files = uploads.ready;
    if (sending || failed || uploads.busy || uploads.failed || (!close && !draft.trim() && !files.length)) return;
    const latest = lastActivity(ticket), now = new Date().toISOString();
    const o: Outgoing = { ticketId: ticket.id, requestId: requestId(), text: close ? draft.trim() || (files.length ? '' : CLOSE_TEXT) : draft, close, attachments: files, at: now > latest ? now : latest, known: messages.map(m => m.id), state: 'sending' };
    outbox.set(key, o); drafts.delete(key); uploads.clear(); setConfirming(false); atBottom.current = true;
    void deliver(side, o, onSaved);
  }
  const retry = () => { if (out && out.state === 'failed') { atBottom.current = true; void deliver(side, out, onSaved); } };
  // A clear refusal (not "maybe it arrived"): the text goes back into the box to change it.
  const edit = () => { if (!out || out.state !== 'failed' || !out.definite) return; outbox.delete(key); drafts.set(key, out.close && out.text === CLOSE_TEXT ? '' : out.text); restoreUploads(key, out.attachments); emit(); requestAnimationFrame(() => input.current?.focus()); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || touch()) return;
    e.preventDefault(); submit();
  };
  const chip = ticketChip(ticket);
  const canDrop = canWrite && !failed;
  return <section className={`tc-thread${dragging ? ' dragging' : ''}`} aria-label={`Talep: ${ticket.subject}`} onKeyDown={e => { if (e.key === 'Escape' && narrow() && !confirming && !viewing) onBack(); }}
    onDragOver={e => { if (!canDrop || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragging) setDragging(true); }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={e => { if (!canDrop) return; e.preventDefault(); setDragging(false); addFiles(filesFrom(e.dataTransfer)); }}>
    {dragging && <div className="tc-drop" aria-hidden="true">Fotoğraf veya PDF’i buraya bırakın</div>}
    {viewing && <Lightbox side={side} file={viewing} onClose={() => setViewing(null)} />}
    <header className="tc-head">
      <button type="button" className="tc-back" aria-label="Taleplere dön" onClick={onBack}><ArrowLeft size={20} aria-hidden="true" /></button>
      <div className="tc-head-text"><h3>{ticket.subject}</h3><p><span className={`tc-chip ${chip.tone}`}>{chip.label}</span><span className="tc-head-who">{side === 'support' ? businessLabel ?? other : 'Mola ekibi ile görüşme'} · #{ticket.id.slice(0, 8)}</span></p></div>
      {side === 'support' && canWrite && <button type="button" className="btn secondary small-btn tc-close-btn" disabled={sending || failed} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}>Talebi kapat</button>}
    </header>
    {extra && <div className="tc-head-extra">{extra}</div>}
    {confirming && <div className="tc-confirm" role="group" aria-label="Talebi kapatma onayı"><p><strong>Talep kapatılsın mı?</strong> {draft.trim() ? 'Kutudaki mesajınız kapanış notu olarak gider.' : `İşletmeye “${CLOSE_TEXT}” yazılır.`} İşletme gerekirse yeni talep açar.</p><div className="tc-confirm-actions"><button type="button" className="btn secondary small-btn" onClick={() => setConfirming(false)}>Vazgeç</button><button type="button" className="btn primary small-btn" onClick={() => submit(true)}>Evet, kapat</button></div></div>}
    <div className="tc-scroll-wrap">
      <div className="tc-scroll" ref={scroller} onScroll={onScroll} role="log" aria-label="Mesajlar" tabIndex={0}>
        {older > 0 && <button type="button" className="tc-older" onClick={olderNow}>Önceki mesajları göster</button>}
        {visible.map(e => e.kind === 'day' ? <div className="tc-day" key={e.key}><span>{e.label}</span></div>
          : e.kind === 'system' ? <p className="tc-system" key={e.key}><span>{e.text}</span></p>
          : <Bubble key={e.key} entry={e} other={other} side={side} out={e.message.id === OUTGOING ? out : undefined} sending={sending} onRetry={retry} onEdit={edit} onOpen={setViewing} />)}
      </div>
      {pill && <button type="button" className="tc-pill" onClick={() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); atBottom.current = true; setPill(false); }}><ArrowDown size={15} aria-hidden="true" />Yeni mesaj</button>}
    </div>
    {readOnly ? <div className="tc-closed-note"><Lock size={16} aria-hidden="true" /><span>{readOnly}</span></div>
      : ticket.status === 'closed' ? <div className="tc-closed-note"><Lock size={16} aria-hidden="true" /><span>{side === 'business' ? 'Bu talep kapandı. Yeni bir sorun için yeni talep açabilirsiniz.' : 'Bu talep kapandı. İşletme gerekirse yeni talep açar.'}</span>{onNew && <button type="button" className="btn secondary small-btn" onClick={onNew}>Yeni talep aç</button>}</div>
      : <form className="tc-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
        {failed ? <p className="tc-composer-note">Yeni mesajdan önce gönderilemeyen mesajı tekrar deneyin.</p>
          : note ? <p className="tc-composer-note" role="status">{note}</p> : null}
        <UploadList uploads={uploads} />
        <AttachButton uploads={uploads} disabled={sending || failed} onNote={setNote} />
        <div className="tc-input">
          <textarea ref={input} rows={1} aria-label="Mesajınız" placeholder={side === 'support' ? 'Yanıtınızı yazın…' : 'Mesajınızı yazın…'} maxLength={LIMIT} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} onPaste={e => { const files = filesFrom(e.clipboardData); if (files.length) { e.preventDefault(); addFiles(files); } }} />
          {draft.length >= WARN_AT && <span className={`tc-count${draft.length >= LIMIT ? ' full' : ''}`} aria-live="polite">{draft.length >= LIMIT ? 'Karakter sınırına ulaşıldı' : `${(LIMIT - draft.length).toLocaleString('tr-TR')} karakter kaldı`}</span>}
        </div>
        <button className="tc-send" aria-label="Gönder" title="Gönder (Enter) · Yeni satır: Shift+Enter" aria-describedby={uploads.blocker && !failed ? `tc-why-${ticket.id}` : undefined} disabled={sending || failed || uploads.busy || uploads.failed || (!draft.trim() && !uploads.ready.length)}>{sending || uploads.busy ? <span className="tc-spinner" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}</button>
        {/* Why "Gönder" waits, beside it: the file Mola refused (and why), or the one that did not upload. */}
        {uploads.blocker && !failed && <p className="tc-send-why" id={`tc-why-${ticket.id}`} role="alert">{uploads.blocker}</p>}
      </form>}
  </section>;
}

function Bubble({ entry, other, side, out, sending, onRetry, onEdit, onOpen }: { entry: Extract<TimelineEntry, { kind: 'message' }>; other: string; side: TicketSide; out?: Outgoing; sending: boolean; onRetry: () => void; onEdit: () => void; onOpen: (a: AttachmentRef) => void }) {
  const m = entry.message as Message, mine = entry.mine;
  const state = out ? out.state === 'failed' ? 'failed' : 'sending' : m.queued ? 'queued' : 'done';
  return <div className={`tc-row ${mine ? 'mine' : 'theirs'}${entry.first ? ' first' : ''}${entry.last ? ' last' : ''}`}>
    <article className={`tc-bubble ${m.source}${out ? ` outgoing ${state}` : ''}`}>
      {!mine && entry.first && <strong className="tc-sender">{other}</strong>}
      {m.attachments?.length ? <MessageFiles side={side} files={m.attachments} onOpen={onOpen} /> : null}
      {m.text && <p>{m.text}</p>}
      <span className="tc-meta"><time dateTime={m.at}>{clockTime(m.at)}</time>
        {mine && (state === 'sending' ? <span className="tc-state"><span className="tc-spinner small" aria-hidden="true" />Gönderiliyor</span>
          : state === 'failed' ? <AlertCircle size={13} aria-label="Gönderilemedi" />
          : state === 'queued' ? <span className="tc-state" title="İnternet gelince kendiliğinden gönderilir"><Clock size={12} aria-hidden="true" />Gönderilmeyi bekliyor</span>
          : <Check size={13} aria-label={side === 'business' ? 'Mola ekibine iletildi' : 'İletildi'} />)}
      </span>
    </article>
    {out?.state === 'failed' && <p className="tc-failed" role="alert"><span>Gönderilemedi · <button type="button" disabled={sending} onClick={onRetry}>Tekrar dene</button>{out.definite && <> · <button type="button" onClick={onEdit}>Düzenle</button></>}</span>{out.error && <small>{out.error}</small>}</p>}
  </div>;
}

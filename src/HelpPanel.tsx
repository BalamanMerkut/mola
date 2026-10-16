import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, SendHorizontal, X } from 'lucide-react';
import raw from '../site/src/assets/yardim.json';
import avatar from '../brand/merkut-studios/yardimci/yardimci-96.png';
import { appAudience, checkYardim, createYardimSearch, forAudience, meaningfulWords, type YardimSoru, type YardimVerisi } from '../packages/domain/yardim';
import './help-panel.css';

/*
 * Mola Yardım in the café app (15 Ekim): the website's hazır sorular ve cevaplar (site/src/assets/yardim.json, built into
 * this file's own chunk: no request while asking, works without internet) for the signed-in role only
 * (packages/domain/yardim.ts appAudience: the owner and the Müdür read every app question, the others their own).
 * - HelpSheet: the Mola Yardım button beside the bell on the top bar (src/HelpButton.tsx; the kitchen's bar too), a side
 *   sheet over the screen; the screen's topic first (Kasa → Kasa ve ödeme).
 * - HelpBody: also the owner's Destek → Yardım tab (src/Support.tsx).
 * A short conversation (16 Ekim, as on the website): "Merhaba! Ne konuda yardım edeyim?", the topics as quick replies, then
 * the screen's and the common questions; what is asked on the right, the answer on the left with the small picture and its
 * related questions as chips; the box to type in at the bottom with a send button. Nothing found: "Bunu bilmiyorum." and,
 * for the owner, "Destek talebi aç" (Destek → Talepler with the question written in); the others are told to ask the owner.
 * The conversation is a polite live log. Plain text only (React text nodes); nothing typed leaves the device.
 */
export type HelpRole = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
const all = checkYardim(raw as Partial<YardimVerisi>);
/** The topic of the screen the "?" was pressed on (Workspace views; the kitchen's board and Stok). */
const VIEW_TOPIC: Record<string, string> = { tables: 'siparis', staff: 'siparis', ready: 'siparis', agenda: 'siparis', cash: 'kasa', reports: 'kasa', kitchen: 'mutfak', menu: 'menu', stock: 'personel', users: 'personel', password: 'personel', settings: 'kurulum', support: 'sorun' };

/**
 * The topic chips: one row that swipes sideways without a scrollbar. For a mouse too (as on the website, site/src/assets/site.js
 * MolaKaydir): ‹ › at an end only while there is more that way (about a row's width a click; at once with "reduce motion"),
 * a soft fade at a clipped edge, the wheel scrolls the row sideways (at its end the list scrolls on). The chips stay in the Tab
 * order and a focused chip is scrolled clear of the arrows; the arrows are for the mouse and never take the focus.
 */
function useSwipeRow() {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ back: false, next: false });
  useEffect(() => {
    const row = ref.current; if (!row) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = row.scrollWidth - row.clientWidth, x = row.scrollLeft, back = max > 1 && x > 1, next = max > 1 && x < max - 1;
      setMore(m => m.back === back && m.next === next ? m : { back, next });
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(update); };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // a sideways swipe or a zoom: the browser's own
      const max = row.scrollWidth - row.clientWidth, step = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? row.clientWidth : 1);
      if (max <= 1 || (step < 0 && row.scrollLeft <= 0) || (step > 0 && row.scrollLeft >= max - 1)) return;
      e.preventDefault(); row.scrollLeft += step;
    };
    const focus = (e: FocusEvent) => {
      const chip = e.target as HTMLElement; if (chip === row) return;
      const room = 44, x = chip.offsetLeft, w = chip.offsetWidth, s = row.scrollLeft, view = row.clientWidth;
      if (x - room < s) row.scrollLeft = Math.max(0, x - room); else if (x + w + room > s + view) row.scrollLeft = x + w + room - view;
    };
    row.addEventListener('scroll', later, { passive: true });
    row.addEventListener('wheel', wheel, { passive: false });
    row.addEventListener('focusin', focus);
    window.addEventListener('resize', later);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(row);
    update();
    return () => {
      cancelAnimationFrame(frame); resize?.disconnect(); window.removeEventListener('resize', later);
      row.removeEventListener('scroll', later); row.removeEventListener('wheel', wheel); row.removeEventListener('focusin', focus);
    };
  }, []);
  const move = (dir: 1 | -1) => {
    const row = ref.current; if (!row) return;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    row.scrollBy({ left: dir * Math.max(120, row.clientWidth - 96), behavior: reduce ? 'auto' : 'smooth' });
  };
  return { ref, ...more, move };
}

/** One exchange of the conversation: what was asked (right) and Mola Yardım's reply (left). */
type Exchange = { key: number; ask: string } & ({ kind: 'answer'; q: YardimSoru; others: YardimSoru[] } | { kind: 'topic'; topic: string } | { kind: 'none'; text: string });
/** The conversation keeps this many exchanges (the oldest goes first). */
const KEEP = 6;

export function HelpBody({ role, view, onTicket, autoFocus = false, scroll = false }: {
  role: HelpRole; view?: string;
  /** "Destek talebi aç" when nothing fits (the owner only: only the owner writes to the Mola team). */
  onTicket?: (question: string) => void;
  autoFocus?: boolean;
  /** Inside the sheet: the conversation scrolls on its own above the box to type in. */
  scroll?: boolean;
}) {
  const data = useMemo(() => forAudience(all, appAudience(role)), [role]);
  const finder = useMemo(() => createYardimSearch(data), [data]);
  const topicName = useMemo(() => new Map(data.konular.map(k => [k.id, k.ad])), [data]);
  const here = view && data.konular.some(k => k.id === VIEW_TOPIC[view]) ? VIEW_TOPIC[view] : null;
  const [text, setText] = useState(''), [topic, setTopic] = useState<string | null>(null), [log, setLog] = useState<Exchange[]>([]);
  const input = useRef<HTMLInputElement>(null), body = useRef<HTMLDivElement>(null), counter = useRef(0);
  const id = useId(), row = useSwipeRow();
  // Typing focus only with a mouse: on a tablet the keyboard would cover the answers before anything is asked.
  useEffect(() => {
    if (!autoFocus || !window.matchMedia?.('(pointer: fine)').matches) return;
    const t = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [autoFocus]);
  // The newest exchange in sight from its start (the question on the right, then the answer under it).
  useEffect(() => {
    const mine = body.current?.querySelectorAll<HTMLElement>('.help-msg.mine'), last = mine?.[mine.length - 1];
    if (!last || !body.current) return;
    if (scroll) body.current.scrollTop = Math.max(0, last.offsetTop - 12); else last.scrollIntoView({ block: 'nearest' });
  }, [log, scroll]);
  const add = (e: Exchange) => setLog(l => [...l, e].slice(-KEEP));
  const askQuestion = (q: YardimSoru) => add({ key: ++counter.current, kind: 'answer', ask: q.soru, q, others: [] });
  const askTopic = (k: string) => { setTopic(k); add({ key: ++counter.current, kind: 'topic', ask: topicName.get(k) ?? '', topic: k }); };
  const send = () => {
    const t = text.trim().slice(0, 120);
    if (!t) return;
    setText('');
    const hits = meaningfulWords(t).length ? finder.search(t, 4) : [], first = hits[0] && finder.get(hits[0].id);
    if (!first) { add({ key: ++counter.current, kind: 'none', ask: t, text: t }); return; }
    add({ key: ++counter.current, kind: 'answer', ask: t, q: first, others: hits.slice(1).map(h => finder.get(h.id)).filter((q): q is YardimSoru => !!q) });
  };
  const near = here ? data.sorular.filter(q => q.konu === here).slice(0, 6) : [];
  const common = data.sikSorulanlar.map(finder.get).filter((q): q is YardimSoru => !!q && !near.includes(q));
  const bot = (key: string | number, children: ReactNode) => <div key={key} className="help-msg bot"><img className="help-msg-avatar" src={avatar} width={30} height={30} alt="" />{children}</div>;
  const list = (items: YardimSoru[], hint: boolean) => <ul>{items.map(q => <li key={q.id}><button type="button" className="help-question" onClick={() => askQuestion(q)}><span>{q.soru}</span>{hint && <small>{topicName.get(q.konu)}</small>}</button></li>)}</ul>;
  const chipsUnder = (label: string, items: YardimSoru[]) => !!items.length && <div className="help-related"><span>{label}</span>{items.map(q => <button key={q.id} type="button" onClick={() => askQuestion(q)}>{q.soru}</button>)}</div>;
  return <div className={`help-body${scroll ? ' help-body-scroll' : ''}`}>
    <div className="help-scroll" ref={body} role="log" aria-live="polite" aria-label="Mola Yardım ile konuşma">
      {bot('hello', <p className="help-balloon help-hello">Merhaba! Ne konuda yardım edeyim?</p>)}
      <div className={`help-topics-box${row.back ? ' more-back' : ''}${row.next ? ' more-next' : ''}`}>
        <div className="help-topics" ref={row.ref} role="group" aria-label="Konular">
          {data.konular.map(k => <button key={k.id} type="button" className="help-topic" aria-pressed={topic === k.id} onClick={() => askTopic(k.id)}>{k.ad}</button>)}
        </div>
        {row.back && <button type="button" className="help-row-arrow back" tabIndex={-1} aria-label="Önceki konular" onMouseDown={e => e.preventDefault()} onClick={() => row.move(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>}
        {row.next && <button type="button" className="help-row-arrow next" tabIndex={-1} aria-label="Sonraki konular" onMouseDown={e => e.preventDefault()} onClick={() => row.move(1)}><ChevronRight size={18} aria-hidden="true" /></button>}
      </div>
      {!!near.length && bot('near', <section className="help-balloon help-list" aria-label={`Bu ekran: ${topicName.get(here!)}`}><h3>Bu ekran: {topicName.get(here!)}</h3>{list(near, false)}</section>)}
      {!!common.length && bot('common', <section className="help-balloon help-list" aria-label="Sık sorulanlar"><h3>Sık sorulanlar</h3>{list(common, true)}</section>)}
      {log.map(e => <div key={e.key} className="help-exchange">
        <div className="help-msg mine"><p className="help-balloon help-said">{e.ask}</p></div>
        {e.kind === 'answer' && bot('a', <article className="help-balloon help-answer" aria-labelledby={`${id}-a${e.key}`}>
          <span className="help-answer-topic">{topicName.get(e.q.konu)}</span>
          <h3 id={`${id}-a${e.key}`}>{e.q.soru}</h3>
          {e.q.cevap.map((b, i) => typeof b === 'string' ? <p key={i}>{b}</p> : <ol key={i}>{b.map((s, j) => <li key={j}>{s}</li>)}</ol>)}
          {chipsUnder('İlgili:', (e.q.ilgili ?? []).map(r => finder.get(r)).filter((q): q is YardimSoru => !!q))}
          {chipsUnder('Başka sorular:', e.others)}
        </article>)}
        {e.kind === 'topic' && bot('t', <section className="help-balloon help-list" aria-label={topicName.get(e.topic)}><p>{topicName.get(e.topic)} hakkında sorulanlar:</p>{list(data.sorular.filter(q => q.konu === e.topic), false)}</section>)}
        {e.kind === 'none' && bot('n', <div className="help-balloon help-none">
          <p className="help-none-title">Bunu bilmiyorum.</p>
          <p>Başka kelimelerle deneyin.</p>
          {onTicket ? <><p>Mola ekibine de yazabilirsiniz:</p><button type="button" className="btn primary" onClick={() => onTicket(e.text)}>Destek talebi aç</button></> : <p>İşletme sahibinize sorun.</p>}
        </div>)}
      </div>)}
    </div>
    <div className="help-compose">
      <input ref={input} id={`${id}-q`} type="search" aria-label="Sorunuzu yazın" placeholder="Sorunuzu yazın…" autoComplete="off" spellCheck={false} maxLength={120} enterKeyHint="send" value={text}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }} />
      <button type="button" className="help-send" aria-label="Gönder" onClick={() => { send(); input.current?.focus(); }}><SendHorizontal size={20} aria-hidden="true" /></button>
    </div>
  </div>;
}

/** The "?" panel: a side sheet on the right (the whole screen on a phone); Esc, × or a click beside it closes it. */
export function HelpSheet({ role, view, onClose, onTicket }: { role: HelpRole; view?: string; onClose: () => void; onTicket?: (question: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  // The focus goes back to the "?" that opened it (the dialog is gone from the page before it closes, so it is done here).
  useEffect(() => {
    const d = ref.current!, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    d.showModal();
    return () => { d.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className="help-sheet" aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <header className="help-sheet-head">
      <img src={avatar} width={40} height={40} alt="" />
      <h2 id={titleId}>Mola Yardım</h2>
      <button type="button" className="help-sheet-close" aria-label="Yardımı kapat" onClick={onClose}><X size={20} aria-hidden="true" /></button>
    </header>
    <HelpBody role={role} view={view} onTicket={onTicket} autoFocus scroll />
  </dialog>;
}

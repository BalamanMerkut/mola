import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import raw from '../site/src/assets/yardim.json';
import avatar from '../brand/merkut-studios/yardimci/yardimci-96.png';
import { appAudience, checkYardim, createYardimSearch, forAudience, meaningfulWords, type YardimSoru, type YardimVerisi } from '../packages/domain/yardim';
import './help-panel.css';

/*
 * Mola Yardım in the café app (15 Ekim): the website's hazır sorular ve cevaplar (site/src/assets/yardim.json, built into
 * this file's own chunk: no request while asking, works without internet) for the signed-in role only
 * (packages/domain/yardim.ts appAudience: the owner and the Müdür read every app question, the others their own).
 * - HelpSheet: the "?" beside the bell on the top bar (and on the kitchen's bar), a side sheet over the screen; the screen's
 *   topic first (Kasa → Kasa ve ödeme). Nothing pops up by itself.
 * - HelpBody: also the owner's Destek → Yardım tab (src/Support.tsx).
 * Nothing found: "Bulamadım." and, for the owner, "Destek talebi aç" (Destek → Talepler with the question written in);
 * the others are told to ask the owner. Plain text only (React text nodes); nothing typed leaves the device.
 */
export type HelpRole = 'owner' | 'manager' | 'cashier' | 'waiter' | 'kitchen';
const all = checkYardim(raw as Partial<YardimVerisi>);
/** The topic of the screen the "?" was pressed on (Workspace views; the kitchen's board and Stok). */
const VIEW_TOPIC: Record<string, string> = { tables: 'siparis', staff: 'siparis', ready: 'siparis', agenda: 'siparis', cash: 'kasa', reports: 'kasa', kitchen: 'mutfak', menu: 'menu', stock: 'personel', users: 'personel', password: 'personel', settings: 'kurulum', support: 'sorun' };

export function HelpBody({ role, view, onTicket, autoFocus = false, scroll = false }: {
  role: HelpRole; view?: string;
  /** "Destek talebi aç" when nothing fits (the owner only: only the owner writes to the Mola team). */
  onTicket?: (question: string) => void;
  autoFocus?: boolean;
  /** Inside the sheet: the list scrolls on its own under the search box. */
  scroll?: boolean;
}) {
  const data = useMemo(() => forAudience(all, appAudience(role)), [role]);
  const finder = useMemo(() => createYardimSearch(data), [data]);
  const topicName = useMemo(() => new Map(data.konular.map(k => [k.id, k.ad])), [data]);
  const here = view && data.konular.some(k => k.id === VIEW_TOPIC[view]) ? VIEW_TOPIC[view] : null;
  const [text, setText] = useState(''), [topic, setTopic] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), answerRef = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  const id = useId();
  // Typing focus only with a mouse: on a tablet the keyboard would cover the answers before anything is asked.
  useEffect(() => {
    if (!autoFocus || !window.matchMedia?.('(pointer: fine)').matches) return;
    const t = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [autoFocus]);
  const open = (q: YardimSoru) => { setSelected(q.id); if (body.current) body.current.scrollTop = 0; requestAnimationFrame(() => answerRef.current?.focus()); };
  const asked = meaningfulWords(text).length > 0, hits = asked ? finder.search(text, 7) : [];
  let shown = selected ? finder.get(selected) : null;
  let sections: { title: string; items: YardimSoru[]; hint?: boolean }[] = [];
  if (asked) {
    if (hits.length) { shown ??= finder.get(hits[0].id); sections = [{ title: 'Başka sorular', items: hits.map(h => finder.get(h.id)!).filter(Boolean) }]; }
  } else if (topic) sections = [{ title: topicName.get(topic) ?? '', items: data.sorular.filter(q => q.konu === topic) }];
  else {
    const near = here ? data.sorular.filter(q => q.konu === here).slice(0, 6) : [];
    const common = data.sikSorulanlar.map(finder.get).filter((q): q is YardimSoru => !!q && !near.includes(q));
    sections = [...(near.length ? [{ title: `Bu ekran: ${topicName.get(here!)}`, items: near }] : []), { title: 'Sık sorulanlar', items: common, hint: true }];
  }
  sections = sections.map(s => ({ ...s, items: s.items.filter(q => q.id !== shown?.id) })).filter(s => s.items.length);
  const none = asked && !hits.length;
  const live = none ? 'Hazır cevap bulunamadı.' : asked ? (hits.length === 1 ? 'Bir cevap bulundu.' : `${hits.length} cevap bulundu.`) : '';
  return <div className={`help-body${scroll ? ' help-body-scroll' : ''}`}>
    <div className="help-search">
      <Search size={18} aria-hidden="true" />
      <input ref={input} id={`${id}-q`} type="search" aria-label="Sorunuzu yazın" placeholder="Sorunuzu yazın…" autoComplete="off" spellCheck={false} maxLength={120} enterKeyHint="search" value={text}
        onChange={e => { setText(e.target.value); setTopic(null); setSelected(null); }} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
    </div>
    <div className="help-topics" role="group" aria-label="Konular">
      {data.konular.map(k => <button key={k.id} type="button" className="help-topic" aria-pressed={topic === k.id} onClick={() => { setTopic(t => t === k.id ? null : k.id); setSelected(null); setText(''); if (body.current) body.current.scrollTop = 0; }}>{k.ad}</button>)}
    </div>
    <div className="help-scroll" ref={body}>
      <p className="sr-only" aria-live="polite">{live}</p>
      {shown && <article className="help-answer" ref={answerRef} tabIndex={-1} aria-labelledby={`${id}-a`}>
        <span className="help-answer-topic">{topicName.get(shown.konu)}</span>
        <h3 id={`${id}-a`}>{shown.soru}</h3>
        {shown.cevap.map((b, i) => typeof b === 'string' ? <p key={i}>{b}</p> : <ol key={i}>{b.map((s, j) => <li key={j}>{s}</li>)}</ol>)}
        {!!shown.ilgili?.length && <div className="help-related"><span>İlgili:</span>{shown.ilgili.map(r => finder.get(r)).filter((q): q is YardimSoru => !!q).map(q => <button key={q.id} type="button" onClick={() => open(q)}>{q.soru}</button>)}</div>}
      </article>}
      {none && <div className="help-none">
        <p className="help-none-title">Bulamadım.</p>
        {onTicket ? <button type="button" className="btn primary" onClick={() => onTicket(text.trim())}>Destek talebi aç</button> : <p>İşletme sahibinize sorun.</p>}
        <p className="help-asked">Aradığınız: “{text.trim().slice(0, 120)}”</p>
      </div>}
      {sections.map(s => <section key={s.title} className="help-list" aria-label={s.title}>
        <h3>{s.title}</h3>
        <ul>{s.items.map(q => <li key={q.id}><button type="button" className="help-question" onClick={() => open(q)}><span>{q.soru}</span>{s.hint && <small>{topicName.get(q.konu)}</small>}</button></li>)}</ul>
      </section>)}
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

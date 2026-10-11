import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Columns2 } from 'lucide-react';
import { Notice } from './components';
import { desktopCall } from './desktop-call';
import { PANE_KEY_STORE, paneFrameName, type PaneId, type PaneMessage } from './pane';
import './split-view.css';

/*
 * İki ekran: the café computer's Mola window, split in two (rail → "İkiye böl"). Each side is a full Mola screen of its own
 * (an iframe of this page named `mola-pane-1` / `mola-pane-2`) with its own sign-in, sounds, kitchen board, owner lock and
 * toasts; signing in or out on one side never touches the other (src/pane.ts, server/sessions.ts). Each frame is its own
 * viewport, so every screen lays itself out for the pane's width: a 960 px half looks like a tablet.
 *
 * Between them a divider: ◀ gives the right side the whole width (the left folds to a thin strip that brings it back), ▶ the
 * opposite, the middle button splits 50/50; dragging (or the arrow keys on it) moves it. Ctrl+Alt+← / → focuses the left /
 * right side, pressed again it takes the whole width. Remembered on this computer (localStorage `mola-split`): on/off, the
 * ratio and which side is folded; who is signed in on each side is kept by the sessions themselves (until 05:00).
 */
export type SplitState = { on: boolean; ratio: number; full: PaneId | null };
const STORE = 'mola-split', MIN = 0.2, MAX = 0.8;
const clamp = (r: number) => Math.min(MAX, Math.max(MIN, Number.isFinite(r) ? r : 0.5));
export function readSplit(): SplitState {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<SplitState> | null;
    return { on: v?.on === true, ratio: clamp(Number(v?.ratio ?? 0.5)), full: v?.full === 1 || v?.full === 2 ? v.full : null };
  } catch { return { on: false, ratio: 0.5, full: null }; }
}
export function writeSplit(s: SplitState) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* remembered for this visit only */ } }

const SIDES: Record<PaneId, string> = { 1: 'Sol ekran', 2: 'Sağ ekran' };
const ROLES: Record<string, string> = { owner: 'İşletme sahibi', manager: 'Müdür', cashier: 'Kasiyer', waiter: 'Garson', kitchen: 'Mutfak' };

/** Who is signed in on each side, for the folded strip's label; read with that pane's own headers. */
function usePaneWho(key: string | null) {
  const [who, setWho] = useState<Record<PaneId, string>>({ 1: '', 2: '' });
  const read = useCallback(() => {
    if (key === null) return;
    for (const p of [1, 2] as PaneId[]) void fetch('/api/staff/me', { credentials: 'same-origin', headers: { 'X-Mola-Pane': String(p), ...(key ? { 'X-Mola-Pane-Key': key } : {}) }, signal: AbortSignal.timeout(8000) })
      .then(async r => r.ok ? (r.json() as Promise<{ role: string; username: string }>) : null)
      .then(me => setWho(w => ({ ...w, [p]: me ? ROLES[me.role] ?? me.username : 'Giriş yapılmadı' })))
      .catch(() => {});
  }, [key]);
  useEffect(() => { read(); const t = setInterval(() => { if (!document.hidden) read(); }, 15000); return () => clearInterval(t); }, [read]);
  return { who, read };
}

export function SplitView({ token, state, onChange, onSingle }: { token: string; state: SplitState; onChange: (s: SplitState) => void; onSingle: () => void }) {
  const [key, setKey] = useState<string | null>(null), [error, setError] = useState('');
  const [focused, setFocused] = useState<PaneId | null>(null), [drag, setDrag] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null), left = useRef<HTMLIFrameElement>(null), right = useRef<HTMLIFrameElement>(null);
  const frame = (p: PaneId) => (p === 1 ? left : right).current;
  const { who, read } = usePaneWho(key);
  // The panes' key comes from the rail's desktop key; they never see that key itself (server/desktop.ts paneKey).
  useEffect(() => {
    let live = true;
    void desktopCall<{ key: string }>(token, '/api/desktop/pane').then(r => {
      try { sessionStorage.setItem(PANE_KEY_STORE, r.key); } catch { /* the panes are refused without it */ }
      if (live) setKey(r.key);
    }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [token]);
  const current = useRef(state); current.current = state;
  const focusedRef = useRef(focused); focusedRef.current = focused;
  const focusPane = (p: PaneId) => { setFocused(p); const f = frame(p); f?.focus(); f?.contentWindow?.focus(); };
  /** Ctrl+Alt+← / →: that side gets the focus (unfolded if it was folded); pressed again while it has the focus, the whole width. */
  const toward = useCallback((p: PaneId) => {
    const s = current.current, other: PaneId = p === 1 ? 2 : 1;
    if (s.full === other) onChange({ ...s, full: null });
    else if (focusedRef.current === p && s.full !== p) onChange({ ...s, full: p });
    focusPane(p);
  }, [onChange]);
  useEffect(() => {
    const message = (e: MessageEvent<PaneMessage>) => {
      if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
      const from: PaneId | null = e.source === left.current?.contentWindow ? 1 : e.source === right.current?.contentWindow ? 2 : null;
      if (!from || e.data.pane !== from) return;
      if (e.data.mola === 'split-focus') { if (focusedRef.current !== from) read(); setFocused(from); }
      if (e.data.mola === 'split-key') toward(e.data.key === 'ArrowLeft' ? 1 : 2);
    };
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); toward(e.key === 'ArrowLeft' ? 1 : 2); } };
    // The rail's security dialogs tell İlk adımlar inside the panes; the rail's "Kapat" → "Gün sonuna git" opens the left side's
    // closing (the window's own calls use the left side's sign-in, mola_staff).
    const into = (p: PaneId, type: string) => { try { const w = frame(p)?.contentWindow as (Window & typeof globalThis) | null | undefined; w?.dispatchEvent(new w.CustomEvent(type)); } catch { /* reloading */ } };
    const security = () => { into(1, 'mola:security'); into(2, 'mola:security'); }, cash = () => into(1, 'mola:cash-close');
    window.addEventListener('message', message); window.addEventListener('keydown', key);
    window.addEventListener('mola:security', security); window.addEventListener('mola:cash-close', cash);
    return () => { window.removeEventListener('message', message); window.removeEventListener('keydown', key); window.removeEventListener('mola:security', security); window.removeEventListener('mola:cash-close', cash); };
  }, [toward, read]);

  const ratio = drag ?? state.ratio, full = drag !== null ? null : state.full;
  const set = (next: Partial<SplitState>) => onChange({ ...state, ...next });
  function ratioAt(x: number) { const r = box.current!.getBoundingClientRect(); return clamp((x - r.left) / Math.max(1, r.width)); }
  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDrag(full === 1 ? MAX : full === 2 ? MIN : ratio);
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) { if (drag !== null) setDrag(ratioAt(e.clientX)); }
  function up() { if (drag === null) return; const r = drag; setDrag(null); set({ ratio: r, full: null }); }
  // The left side has its share of the width (less the divider); the right takes the rest; a folded side is a thin strip (CSS).
  const basis = (p: PaneId) => full === null && p === 1 ? `0 0 calc((100% - var(--split-divider)) * ${ratio})` : undefined;
  if (error) return <div className="split-view split-error"><Notice tone="error">İki ekran açılamadı: {error}</Notice><button type="button" className="btn secondary" onClick={onSingle}>Tek ekrana dön</button></div>;
  if (key === null) return <div className="split-view" aria-busy="true" />;
  const pane = (p: PaneId) => {
    const folded = full !== null && full !== p, name = SIDES[p];
    return <div key={p} className={`split-pane${folded ? ' folded' : ''}${focused === p && !folded ? ' focused' : ''}${full === p ? ' wide' : ''}`} data-pane={p} style={{ flex: basis(p) }}>
      <iframe ref={p === 1 ? left : right} name={paneFrameName(p)} src={`/?pane=${p}`} title={`${name}${who[p] ? ` · ${who[p]}` : ''}`} allow="screen-wake-lock; autoplay; fullscreen; clipboard-write" tabIndex={folded ? -1 : undefined} aria-hidden={folded || undefined} />
      {folded && <button type="button" className="split-strip" onClick={() => set({ full: null })} aria-label={`${name} geri aç`} title={`${name} geri aç`}>
        {p === 1 ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}<span>{name}{who[p] ? ` · ${who[p]}` : ''}</span>
      </button>}
    </div>;
  };
  return <div ref={box} className={`split-view${drag !== null ? ' dragging' : ''}`} data-full={full ?? ''}>
    {pane(1)}
    <div className="split-divider" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="split-grip" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="İki ekranın sınırı" aria-valuemin={MIN * 100} aria-valuemax={MAX * 100} aria-valuenow={Math.round((full === 1 ? 1 : full === 2 ? 0 : ratio) * 100)}
        onKeyDown={e => { if (e.ctrlKey || e.altKey) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); set({ full: null, ratio: clamp((full === 1 ? MAX : full === 2 ? MIN : ratio) + (e.key === 'ArrowLeft' ? -0.05 : 0.05)) }); } }} />
      <div className="split-tools" role="group" aria-label="İki ekran düzeni">
        <button type="button" aria-label="Sağ ekranı büyüt" title="Sağ ekranı büyüt (Ctrl+Alt+→)" disabled={full === 2} onClick={() => set({ full: full === 1 ? null : 2 })}><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" aria-label="Ekranı ikiye eşit böl" title="Ekranı ikiye eşit böl" disabled={full === null && Math.abs(ratio - 0.5) < 0.005} onClick={() => set({ full: null, ratio: 0.5 })}><Columns2 size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Sol ekranı büyüt" title="Sol ekranı büyüt (Ctrl+Alt+←)" disabled={full === 1} onClick={() => set({ full: full === 2 ? null : 1 })}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
    </div>
    {pane(2)}
  </div>;
}

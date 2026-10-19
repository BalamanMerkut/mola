import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BellRing, CalendarClock, Clock3, LogOut, QrCode, ScanLine, ShieldCheck, Users } from 'lucide-react';
import QRCode from 'qrcode';
import type { Role, StaffSnapshot } from '../packages/domain/types';
import type { ShiftPlan } from '../packages/domain/cash';
import { preShiftBacklog, weekdayNames, type Shift } from '../packages/domain/shifts';
import { roleNames } from '../packages/domain/roles';
import { assignmentRings } from './ServiceCallBar';
import { forgetAlerts, playEvent } from './sounds';
import './staff-roles.css';
import { api, ApiError } from './api';
import { Brand, Modal, Notice } from './components';
import { inMolaApp } from './molaApp';
import { saatEki } from '../packages/domain/saat-eki';
import { HelpTip } from './HelpTip';
import { TimeField, isTime } from './TimeField';
import './cash-shifts.css';

/*
 * Vardiya takibi on the screens (server/shifts.ts): the gate an account of a ticked role (Ayarlar: Garson · Kasiyer · Mutfak ·
 * Müdür) sees until its shift starts, the one-time "Vardiya başlamadan N sipariş geldi" note right after it starts,
 * the counter's one-time code (QR + 6 digits), the "Vardiyada" chip with "Vardiyayı bitir", and the owner's planned shift
 * times in Çalışanlar. The code is typed in 6 boxes everywhere; inside the Android app "QR okut" also reads it with the camera.
 */
/** `required`: this role must start a shift (vardiya takibi on and the role ticked in Ayarlar). */
export type ShiftMe = { tracking: boolean; required?: boolean; /** K-B: on, but this sign-in is from before it ("Bir sonraki girişte"). */ later?: boolean; role: Role; open: Shift | null; lockedUntil: string | null; plan: ShiftPlan | null };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

/** The signed-in employee's shift; the owner is exempt and never asked. Reloads on `mola:shift` (a SHIFT_REQUIRED answer). */
export function useShift(role?: Role) {
  const [me, setMe] = useState<ShiftMe | null>(null);
  const load = useCallback(async () => { try { setMe(await api<ShiftMe>('/api/staff/shifts/me')); } catch { /* the workspace shows connection problems */ } }, []);
  useEffect(() => {
    if (!role || role === 'owner') { setMe(null); return; }
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    const again = () => void load();
    window.addEventListener('mola:shift', again);
    return () => { clearInterval(t); window.removeEventListener('mola:shift', again); };
  }, [role, load]);
  return { me, reload: load, blocked: !!me && (me.required ?? me.tracking) && me.role !== 'owner' && !me.open };
}

/** The Android app's camera reader (mobile/android QrOkuyucu); older app versions do not have it. */
type Bridge = { qrOku?: () => void };
const scanner = () => { const b = (window as unknown as { MolaAndroid?: Bridge }).MolaAndroid; return inMolaApp() && typeof b?.qrOku === 'function' ? b : null; };

/** Six boxes for the code; one real numeric field underneath (paste and the phone's code suggestion work). */
export function CodeBoxes({ value, onChange, disabled, label = 'Vardiya kodu (6 hane)', autoFocus = true }: { value: string; onChange: (v: string) => void; disabled?: boolean; label?: string; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <div className={`code-boxes${focused ? ' focused' : ''}${disabled ? ' disabled' : ''}`}>
    <input aria-label={label} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={6} autoFocus={autoFocus} disabled={disabled} value={value}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    {Array.from({ length: 6 }, (_, i) => <span key={i} aria-hidden="true" className={`code-box${value[i] ? ' filled' : ''}${focused && i === Math.min(value.length, 5) ? ' current' : ''}`}>{value[i] ?? ''}</span>)}
  </div>;
}

/** Typing (or scanning) the counter's code: starts or ends the shift. */
function CodeForm({ action, me, onDone }: { action: 'start' | 'end'; me: ShiftMe; onDone: (s: Shift) => void }) {
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [locked, setLocked] = useState(me.lockedUntil), reader = scanner();
  const sending = useRef(false);
  async function send(value = code) {
    if (sending.current || value.length !== 6) return;
    sending.current = true; setBusy(true); setError('');
    try { onDone(await api<Shift>(`/api/staff/shifts/${action}`, { code: value })); }
    catch (e) { setError((e as Error).message); setCode(''); if (e instanceof ApiError && e.code === 'SHIFT_LOCKED') setLocked(new Date(Date.now() + 5 * 60_000).toISOString()); }
    finally { sending.current = false; setBusy(false); }
  }
  useEffect(() => { if (code.length === 6) void send(code); }, [code]);
  useEffect(() => () => { delete (window as unknown as { __molaQr?: unknown }).__molaQr; }, []);
  function scan() {
    setError('');
    (window as unknown as { __molaQr?: (text: string | null) => void }).__molaQr = text => {
      if (text === null) return;
      if (/^\d{6}$/.test(text)) setCode(text); else setError('Bu QR kodu vardiya kodu değil. Kasadaki “Vardiya kodu” ekranını okutun.');
    };
    reader?.qrOku?.();
  }
  const isLocked = !!locked && Date.parse(locked) > Date.now();
  return <form className="shift-code-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(); }}>
    <CodeBoxes value={code} onChange={setCode} disabled={busy || isLocked} />
    {isLocked && <Notice tone="error">Çok fazla yanlış kod denendi. {saatEki(clock(locked!), 'den')} sonra tekrar deneyin.</Notice>}
    {error && !isLocked && <Notice tone="error">{error}</Notice>}
    <button className="btn primary full" disabled={busy || isLocked || code.length !== 6}>{busy ? 'Kontrol ediliyor…' : action === 'start' ? 'Vardiyayı başlat' : 'Vardiyayı bitir'}</button>
    {reader && <button type="button" className="btn secondary full" disabled={busy || isLocked} onClick={scan}><ScanLine size={18} />QR okut</button>}
  </form>;
}

/** Before anything else, with vardiya takibi on: the code from the counter starts the shift. */
export function ShiftGate({ me, name, onStarted, onLogout, busy }: { me: ShiftMe; name?: string; onStarted: (shift: Shift) => void; onLogout: () => void; busy?: boolean }) {
  const [showCode, setShowCode] = useState(false);
  return <main className="shift-gate">
    <section className="shift-gate-card" aria-labelledby="shift-gate-title">
      <Brand />
      <span className="shift-gate-icon" aria-hidden="true"><Clock3 size={26} /></span>
      <h1 id="shift-gate-title">Vardiyayı başlat</h1>
      <p className="shift-gate-lead">{name ? `Merhaba ${name}. ` : ''}Kasadaki ekranda görünen 6 haneli vardiya kodunu yazın{scanner() ? ' ya da QR kodunu okutun' : ''}.</p>
      <CodeForm action="start" me={me} onDone={onStarted} />
      {(me.role === 'cashier' || me.role === 'manager') && (showCode ? <CounterCode compact /> : <button type="button" className="text-btn" onClick={() => setShowCode(true)}><QrCode size={15} />Kodu bu ekranda göster</button>)}
      <p className="muted small">Kod bir kez kullanılınca yenilenir. Vardiyayı bitirirken de yeni kodu yazarsınız.</p>
      <button type="button" className="text-btn shift-gate-logout" disabled={busy} onClick={onLogout}><LogOut size={15} />Çıkış yap</button>
    </section>
  </main>;
}

/**
 * "Vardiya başlamadan N sipariş geldi": what reached this role while its gate was closed (packages/domain/shifts.ts
 * preShiftBacklog), said once right after this device started the shift, with one sound of the most relevant kind. The
 * floor and kitchen sounds forget what they noted before, so they note the waiting orders silently instead of ringing again.
 * `start(shift)` goes in ShiftGate's onStarted; `notice` is rendered above the page.
 */
const heardShift = new Set<string>();
export function usePreShiftNotice(data: StaffSnapshot | null) {
  const [shown, setShown] = useState<{ startAt: string; count: number } | null>(null);
  // The count waits for the snapshot read right after the start (Workspace's load): a newer one sets `data`; when the server
  // answers "same as before" nothing changes, so `tick` asks again a moment later with what is on screen (already current).
  const pending = useRef<Shift | null>(null), [tick, setTick] = useState(0);
  useEffect(() => {
    const shift = pending.current;
    if (!shift || !data) return;
    pending.current = null;
    const rings = assignmentRings(data), backlog = preShiftBacklog(data.role, shift.startAt, data.orders, data.externalOrders, o => !rings || rings(o.takeaway?.tableId, o.accountId));
    if (!backlog.count || heardShift.has(shift.id)) return;
    heardShift.add(shift.id); setShown({ startAt: shift.startAt, count: backlog.count });
    if (backlog.event) try { const ctx = new AudioContext(); void ctx.resume().then(() => { playEvent(ctx, backlog.event!); setTimeout(() => void ctx.close().catch(() => {}), 4000); }).catch(() => {}); } catch { /* sound is optional */ }
  }, [data, tick]);
  const start = useCallback((shift: Shift) => { if (data?.username) { forgetAlerts(`floor:${data.username}`); forgetAlerts(`kitchen:${data.username}`); } pending.current = shift; setTimeout(() => setTick(n => n + 1), 2500); }, [data?.username]);
  const notice: ReactNode = shown && <div className="preshift-notice" role="status"><BellRing size={20} aria-hidden="true" /><p>Vardiya başlamadan <strong>{shown.count} sipariş</strong> geldi. Aşağıda sizi bekliyor.</p><button type="button" className="btn secondary small-btn" onClick={() => setShown(null)}>Tamam</button></div>;
  return { start, notice };
}

/** "Vardiyada · 09:02" in the top bar; opens "Vardiyayı bitir". */
export function ShiftChip({ me, onChanged }: { me: ShiftMe; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  if (!me.open) return null;
  return <>
    <button type="button" className="shift-chip" onClick={() => setOpen(true)} aria-label={`Vardiyada, ${saatEki(clock(me.open.startAt), 'den')} beri. Vardiyayı bitir`}><span className="shift-dot" aria-hidden="true" />Vardiyada<span className="shift-time"> · {clock(me.open.startAt)}</span></button>
    {open && <Modal title="Vardiyayı bitir" onClose={() => setOpen(false)}><div className="modal-body shift-end">
      <p>Vardiyanız {saatEki(clock(me.open.startAt), 'de')} başladı. Bitirmek için kasadaki ekranda görünen güncel kodu yazın.</p>
      <CodeForm action="end" me={me} onDone={() => { setOpen(false); onChanged(); }} />
      <p className="muted small">Bitirmezseniz vardiyanız gün sonu kasa kapanışında (ya da 05:00'te) kendiliğinden biter.</p>
    </div></Modal>}
  </>;
}

type CodeView = { code: string; tracking: boolean; open: { id: string; name: string; role: string; startAt: string }[] };
/** The counter's code: big digits and the same code as QR, refreshed every few seconds (it changes after each use). */
export function CounterCode({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<CodeView | null>(null), [image, setImage] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => api<CodeView>('/api/staff/shifts/code').then(v => { if (live) { setView(v); setError(''); } }).catch(e => { if (live) setError((e as Error).message); });
    void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => { live = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    let live = true;
    // Version 1, numeric: the smallest code there is, which the Android app's own reader decodes (mobile/android QrCozucu).
    if (view?.code) void QRCode.toDataURL(view.code, { version: 1, errorCorrectionLevel: 'M', margin: 2, width: compact ? 180 : 240, color: { dark: '#1d3d31', light: '#ffffff' } }).then(v => { if (live) setImage(v); });
    return () => { live = false; };
  }, [view?.code, compact]);
  return <div className={`counter-code${compact ? ' compact' : ''}`} aria-live="polite">
    {error && <Notice tone="error">{error}</Notice>}
    {view && <>
      <div className="counter-code-main">
        {image && <img src={image} width={compact ? 180 : 240} height={compact ? 180 : 240} alt="Vardiya kodu QR" />}
        <div className="counter-code-digits" aria-label={`Vardiya kodu ${view.code.split('').join(' ')}`}>{view.code.slice(0, 3)}<span aria-hidden="true"> </span>{view.code.slice(3)}</div>
      </div>
      {!compact && <p className="muted small counter-code-note">Kod bir kez kullanılınca yenilenir; eski kodun fotoğrafı işe yaramaz. Kodu yalnız kasadaki ekran gösterir.</p>}
      {!compact && <div className="counter-code-open"><h3><Users size={16} aria-hidden="true" />Şu an vardiyada{view.open.length ? ` · ${view.open.length}` : ''}</h3>
        {!view.open.length ? <p className="muted small">Vardiyası açık çalışan yok.</p> : <ul>{view.open.map(o => <li key={o.id}><strong>{o.name}</strong><span>{roleNames[o.role as Role] ?? o.role}</span><small>{saatEki(clock(o.startAt), 'den')} beri</small></li>)}</ul>}</div>}
    </>}
  </div>;
}
export function CounterCodeDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="Vardiya kodu" onClose={onClose} className="counter-code-dialog"><div className="modal-body"><p className="muted">Çalışan kendi telefonunda ya da tabletinde “Vardiyayı başlat” ekranına bu kodu yazar{inMolaApp() ? '' : ' (Mola uygulamasında QR kodunu da okutabilir)'}.</p><CounterCode /></div></Modal>;
}

/** Çalışanlar: an employee's planned shift ("09:00–17:00 · Pzt–Cum"), for "N dk geç" in the reports. */
export function useShiftPlans() {
  const [plans, setPlans] = useState<Record<string, ShiftPlan> | null>(null);
  const load = useCallback(() => api<{ plans: Record<string, ShiftPlan> }>('/api/staff/shifts/plans').then(r => setPlans(r.plans)).catch(() => setPlans({})), []);
  useEffect(() => { void load(); }, [load]);
  return { plans, reload: load };
}
export const planText = (p: ShiftPlan) => `${p.start}–${p.end} · ${p.days.length === 7 ? 'her gün' : p.days.length === 5 && p.days.every((d, i) => d === i + 1) ? 'hafta içi' : p.days.map(d => weekdayNames[d - 1]).join(', ')}`;
export function ShiftPlanButton({ user, plans, onSaved }: { user: { id: string; name: string }; plans: Record<string, ShiftPlan> | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false), plan = plans?.[user.id];
  return <>
    <button type="button" className="btn secondary small-btn shift-plan-button" disabled={!plans} aria-label={`${user.name} vardiya planı`} onClick={() => setOpen(true)}><CalendarClock size={15} aria-hidden="true" />{plan ? planText(plan) : 'Vardiya planı'}</button>
    {open && <ShiftPlanDialog user={user} plan={plan} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onSaved(); }} />}
  </>;
}
function ShiftPlanDialog({ user, plan, onClose, onSaved }: { user: { id: string; name: string }; plan?: ShiftPlan; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [start, setStart] = useState(plan?.start ?? '09:00'), [end, setEnd] = useState(plan?.end ?? '17:00'), [days, setDays] = useState<number[]>(plan?.days ?? [1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(next: ShiftPlan | null) {
    setBusy(true); setError('');
    try { await api('/api/staff/shifts/plan', { userId: user.id, plan: next }); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const valid = isTime(start) && isTime(end) && start !== end && days.length > 0;
  const setAll = (list: number[]) => setDays(list);
  // Start and end side by side (24 hours, never AM/PM), the seven days as even chips, the explanation behind ⓘ.
  return <Modal title={`${user.name} · Vardiya planı`} className="shift-plan-dialog" onClose={() => { if (!busy) onClose(); }}><form className="modal-body shift-plan-form" onSubmit={e => { e.preventDefault(); if (valid) void save({ start, end, days: [...days].sort() }); }}>
    <p className="shift-plan-lead">İsteğe bağlı<HelpTip title="Vardiya planı">Plan varsa Personel → Vardiya ve bahşiş'te vardiyaya geç başlayan “N dk geç” olarak görünür. Saatler 24 saat biçimindedir (ör. 09:00, 17:30).</HelpTip></p>
    <div className="shift-plan-times">
      <label htmlFor={`${id}-start`}>Başlangıç<TimeField id={`${id}-start`} value={start} onChange={setStart} required /></label>
      <span className="shift-plan-dash" aria-hidden="true">–</span>
      <label htmlFor={`${id}-end`}>Bitiş<TimeField id={`${id}-end`} value={end} onChange={setEnd} required /></label>
    </div>
    {isTime(start) && isTime(end) && end < start && <p className="muted small shift-plan-night">Gece vardiyası: ertesi gün {saatEki(end, 'de')} biter.</p>}
    <fieldset className="shift-plan-dayset"><legend>Çalıştığı günler</legend>
      <div className="shift-plan-days">{weekdayNames.map((n, i) => { const d = i + 1, on = days.includes(d); return <button type="button" key={n} aria-pressed={on} className={on ? 'selected' : ''} onClick={() => setDays(v => on ? v.filter(x => x !== d) : [...v, d])}>{n}</button>; })}</div>
      <div className="shift-plan-quick"><button type="button" className="text-btn" onClick={() => setAll([1, 2, 3, 4, 5])}>Hafta içi</button><button type="button" className="text-btn" onClick={() => setAll([1, 2, 3, 4, 5, 6, 7])}>Her gün</button></div>
    </fieldset>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions">{plan && <button type="button" className="btn secondary" disabled={busy} onClick={() => void save(null)}>Planı kaldır</button>}<button className="btn primary" disabled={busy || !valid}><ShieldCheck size={16} aria-hidden="true" />{busy ? 'Kaydediliyor…' : 'Planı kaydet'}</button></div>
  </form></Modal>;
}

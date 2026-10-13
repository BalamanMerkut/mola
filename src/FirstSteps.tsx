import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, KeyRound, X } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api } from './api';
import { Notice } from './components';
import './first-steps.css';

type Steps = { dismissed: boolean; steps: { menu: boolean; staff: boolean; printer: boolean; qr: boolean; recovery: boolean | null; second: boolean | null } };
type Key = keyof Steps['steps'];
/** The café computer's own window: its rail can open the recovery code and the backup dialogs (src/DesktopRail.tsx). */
const inDesktopWindow = () => document.body.classList.contains('desktop-shell');
export const openRail = (what: 'recovery' | 'backup' | 'open-backups' | 'open-second' | 'owner') => window.dispatchEvent(new CustomEvent('mola:open', { detail: what }));

/**
 * "İlk adımlar": a short list on the owner's Masalar after the first setup. Each step ticks itself from the real data
 * (server/first-steps.ts); "Kapat" puts the list away for good. While the recovery code is not saved, one line stays.
 * The QR step opens Ayarlar → Masa QR kodları (src/SettingsQr.tsx) and ticks once a print or download was recorded there.
 * Mounted by Workspace in the owner's Masalar view: <FirstSteps data={data} onOpen={setView} onQr={…} />.
 */
/** `folded`: the counter's compact Masalar shows one line ("İlk adımlar 2/6 ▸") until opened; opening is remembered here. */
export function FirstSteps({ data, onOpen, onQr, folded = false }: { data: StaffSnapshot; onOpen: (view: string) => void; onQr: () => void; folded?: boolean }) {
  const [state, setState] = useState<Steps | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('mola-first-steps-open') === '1'; } catch { return false; } });
  const toggle = (next: boolean) => { setOpen(next); try { localStorage.setItem('mola-first-steps-open', next ? '1' : '0'); } catch { /* preference only */ } };
  const load = () => api<Steps>('/api/staff/first-steps').then(setState).catch(() => {});
  // Staff, printers and the security steps change on other screens: look again when they announce it or the window returns.
  useEffect(() => {
    void load();
    const again = () => { if (!document.hidden) void load(); };
    window.addEventListener('mola:security', again); document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('mola:security', again); document.removeEventListener('visibilitychange', again); };
  }, [data.printing?.bill, data.revision]);
  async function mark(step: 'menu' | 'dismiss') { try { setState(await api<Steps>('/api/staff/first-steps', { step })); } catch (e) { setError((e as Error).message); } }
  if (data.role !== 'owner' || !state) return null;
  const desktop = inDesktopWindow(), s = state.steps;
  const here = (what: 'recovery' | 'backup', label: string) => desktop ? <button type="button" className="text-btn" onClick={() => openRail(what)}>{label}<ChevronRight size={15} /></button> : <small className="muted">Kasa bilgisayarındaki Mola penceresinden: sol şerit → {what === 'recovery' ? 'Güvenlik' : 'Yedekle'}</small>;
  const items: { key: Key; title: string; action: ReactNode }[] = [
    { key: 'menu', title: 'Menüyü kontrol et', action: <button type="button" className="text-btn" onClick={() => { void mark('menu'); onOpen('menu'); }}>Menüye git<ChevronRight size={15} /></button> },
    { key: 'staff', title: 'Çalışan ekle', action: <button type="button" className="text-btn" onClick={() => onOpen('users')}>Hesap aç<ChevronRight size={15} /></button> },
    { key: 'printer', title: 'Yazıcı ekle', action: <button type="button" className="text-btn" onClick={() => onOpen('settings')}>Yazıcı bağla<ChevronRight size={15} /></button> },
    { key: 'qr', title: 'Masa QR’larını yazdır', action: <button type="button" className="text-btn" onClick={onQr}>QR kodlarına git<ChevronRight size={15} /></button> },
    { key: 'recovery', title: 'Kurtarma kodunu sakla', action: here('recovery', 'Kodu göster') },
    { key: 'second', title: 'İkinci yedek yerini seç', action: here('backup', 'Yer seç') },
  ];
  const shown = items.filter(i => s[i.key] !== null);
  // Put away: only the unsaved recovery code keeps a single line (losing it can cost all the data).
  if (state.dismissed) return s.recovery === false ? <div className="first-steps-reminder" role="status"><KeyRound size={16} /><span>Kurtarma kodunuzu henüz kaydetmediniz.</span>{here('recovery', 'Şimdi kaydet')}</div> : null;
  const done = shown.filter(i => s[i.key]).length;
  const list = <ul>{shown.map(i => <li key={i.key} className={s[i.key] ? 'done' : ''}><span className="check-mark" aria-hidden="true">{s[i.key] ? <Check size={14} /> : null}</span><span className="grow">{i.title}{s[i.key] ? <span className="sr-only"> (tamam)</span> : null}</span>{!s[i.key] && i.action}</li>)}</ul>;
  if (folded) return <section className={`panel first-steps folded${open ? ' open' : ''}`} aria-label="İlk adımlar">
    <div className="first-steps-head"><button type="button" className="first-steps-toggle" aria-expanded={open} onClick={() => toggle(!open)}><strong>İlk adımlar</strong><span className="first-steps-count">{done}/{shown.length}</span><ChevronDown size={17} aria-hidden="true" /></button>
      {open && <button type="button" className="icon-btn" aria-label="İlk adımları kapat" onClick={() => void mark('dismiss')}><X size={18} /></button>}</div>
    {open && list}
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
  return <section className="panel first-steps" aria-label="İlk adımlar">
    <div className="first-steps-head"><div><h2>İlk adımlar</h2><p className="muted small">{done === shown.length ? 'Hepsi tamam. Bu listeyi kapatabilirsiniz.' : `${shown.length} adımdan ${done} tanesi tamam.`}</p></div>
      <button type="button" className="icon-btn" aria-label="İlk adımları kapat" onClick={() => void mark('dismiss')}><X size={18} /></button></div>
    {list}
    {error && <Notice tone="error">{error}</Notice>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import avatar from '../brand/merkut-studios/yardimci/yardimci-96.png';

/*
 * Mola Yardım's button on the top bar, beside the bell (16 Ekim; the panel: src/HelpPanel.tsx). The round eagle picture so a
 * newcomer notices it; for the owner, the Müdür and the cashier with "Yardım" beside it on wider screens (a pill), only the
 * picture on a phone (src/moved.css) and for the waiter and the kitchen. It sits in the bar, never over the screen.
 * A one-time hint for the owner, the Müdür and the cashier: "Takıldığınız yerde bana sorabilirsiniz." under the button the
 * first time they are signed in on this device, a moment after the screen opens and never while a window (payment and the
 * like: an open <dialog>) is up; it goes by itself after 6 s, × closes it, opening Mola Yardım too. Remembered per user on
 * this device (localStorage; nothing when it cannot be used). `mola-yardim-ipucu` = "off" turns it off on a device (the
 * browser tests, playwright.config.ts). Never for the waiter or the kitchen.
 */
const HINT_ROLES = new Set(['owner', 'manager', 'cashier']);
const HINT_OFF = 'mola-yardim-ipucu';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return '1'; } };
const remember = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* shown once on this screen then */ } };

export function HelpButton({ role, user, expanded, onOpen }: { role: string; user: string; expanded: boolean; onOpen: () => void }) {
  const [hint, setHint] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hintKey = `${HINT_OFF}:${user}`;
  const named = HINT_ROLES.has(role);
  useEffect(() => {
    if (!named || !user || read(HINT_OFF) === 'off' || read(hintKey) === '1') return;
    let hide = 0, tries = 0;
    const wait = window.setInterval(() => {
      const busy = !!document.querySelector('dialog[open], [aria-modal="true"]') || !button.current?.getClientRects().length;
      if (busy) { if (++tries > 80) window.clearInterval(wait); return; }
      window.clearInterval(wait);
      remember(hintKey); setHint(true);
      hide = window.setTimeout(() => setHint(false), 6000);
    }, 1500);
    return () => { window.clearInterval(wait); window.clearTimeout(hide); };
  }, [named, user, hintKey]);
  // A window opening over the screen takes the hint away.
  useEffect(() => {
    if (!hint) return;
    const t = window.setInterval(() => { if (document.querySelector('dialog[open], [aria-modal="true"]')) setHint(false); }, 400);
    return () => window.clearInterval(t);
  }, [hint]);
  const open = () => { setHint(false); remember(hintKey); onOpen(); };
  return <span className="topbar-help-wrap">
    <button ref={button} type="button" className={`topbar-help${named ? ' named' : ''}`} aria-label="Mola Yardım" title="Mola Yardım" aria-haspopup="dialog" aria-expanded={expanded} onClick={open}>
      <img src={avatar} width={32} height={32} alt="" />{named && <span className="topbar-help-text" aria-hidden="true">Yardım</span>}
    </button>
    {hint && <span className="help-hint" role="status">
      <button type="button" className="help-hint-text" onClick={open}>Takıldığınız yerde bana sorabilirsiniz.</button>
      <button type="button" className="help-hint-close" aria-label="İpucunu kapat" onClick={() => setHint(false)}><X size={16} aria-hidden="true" /></button>
    </span>}
  </span>;
}

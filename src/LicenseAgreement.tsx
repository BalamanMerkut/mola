import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FileText } from 'lucide-react';
// The one text (docs/hukuk/MOLA_LISANS_SOZLESMESI.md), bundled as it is; its version is AGREEMENT_VERSION (tests check both).
import agreementText from '../docs/hukuk/MOLA_LISANS_SOZLESMESI.md?raw';
import { AGREEMENT_NAME, AGREEMENT_VERSION } from '../packages/domain/agreement';
import { api, ApiError } from './api';
import { postponeAgreement, rememberAccepted, shouldAsk } from './agreementPrompt';
import { Modal } from './components';
import './license-agreement.css';

/** **bold** inside a line; everything else is plain text (React escapes it). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}
/** The agreement as readable blocks: # / ## headings, paragraphs, "- " and "1. " lists. */
export function AgreementText() {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null, paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) { blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>); paragraph = []; }
    if (list) { const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>); blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>); list = null; }
  };
  for (const raw of agreementText.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line), bullet = /^-\s+(.*)$/.exec(line), numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push(heading[1].length === 1 ? <h2 key={blocks.length}>{inline(heading[2])}</h2> : <h3 key={blocks.length}>{inline(heading[2])}</h3>); continue; }
    if (bullet || numbered) {
      if (paragraph.length) { blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>); paragraph = []; }
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flush();
      (list ??= { ordered, items: [] }).items.push((bullet ?? numbered)![1]); continue;
    }
    if (list) flush();
    paragraph.push(line);
  }
  flush();
  return <div className="agreement-text">{blocks}</div>;
}
/** The full text in a window, to read before ticking the box. */
export function AgreementSheet({ onClose }: { onClose: () => void }) {
  return <Modal title={AGREEMENT_NAME} wide className="agreement-dialog" onClose={onClose}>
    <div className="modal-body agreement-body"><AgreementText /></div>
    <div className="modal-actions agreement-actions"><button type="button" className="btn primary" onClick={onClose}>Kapat</button></div>
  </Modal>;
}
/**
 * "Mola Lisans Sözleşmesi’ni okudum ve kabul ediyorum" on the activation screen (both ways: the application and the code).
 * The link beside it opens the full text. `problem`: shown once the owner tried to go on without ticking it.
 */
export function AgreementCheck({ checked, onChange, disabled, problem }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; problem?: string }) {
  const [reading, setReading] = useState(false), id = useId();
  return <div className="agreement-check">
    <div className="agreement-check-row">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} aria-invalid={!!problem} onChange={e => onChange(e.target.checked)} />
      <label htmlFor={id}>{AGREEMENT_NAME}’ni okudum ve kabul ediyorum *</label>
    </div>
    <button type="button" className="text-btn agreement-link" onClick={() => setReading(true)}><FileText size={14} aria-hidden="true" />{AGREEMENT_NAME}’ni oku</button>
    {problem && <small className="field-error" role="alert">{problem}</small>}
    {reading && <AgreementSheet onClose={() => setReading(false)} />}
  </div>;
}
export const AGREEMENT_PROBLEM = 'Devam etmek için Mola Lisans Sözleşmesi’ni kabul edin.';
/** What the activation requests carry when the box is ticked. */
export const agreementBody = () => ({ agreement: { version: AGREEMENT_VERSION } });

type AgreementState = { version: number; accepted: { version: number; acceptedAt: string } | null; needed: boolean };
/**
 * The owner only, once after signing in, when this business has not accepted the agreement (installed before it existed) or
 * accepted an older text. Never blocks anyone: "Daha sonra" (or ×) closes it for this sign-in, refreshes and polls included,
 * and it comes back at the next sign-in (src/agreementPrompt.ts); staff never see it, and orders, payments and the kitchen go
 * on meanwhile. Acceptance goes to Mola Merkez with the next heartbeat.
 * Looked at again when this window comes back to the front while the window is open (accepted on the other side of İki ekran,
 * or the owner lock was opened) and while the first look failed (a locked session answers 423 until unlocked).
 * The owner lock (src/OwnerLock.tsx) opens above this window; 8 Ekim: it used to open under it, leaving both unreachable.
 */
export function OwnerAgreementPrompt({ username }: { username: string }) {
  const [state, setState] = useState<AgreementState | null>(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const seen = useRef({ open: false, loaded: false }); seen.current.open = open;
  useEffect(() => {
    let live = true;
    const look = () => void api<AgreementState>('/api/staff/license/agreement').then(s => { if (!live) return; seen.current.loaded = true; setState(s); setOpen(shouldAsk(s, username)); }, () => {});
    const back = () => { if (!document.hidden && (seen.current.open || !seen.current.loaded)) look(); };
    look();
    window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
    return () => { live = false; window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [username]);
  if (!open || !state) return null;
  const later = () => { postponeAgreement(username, state.version); setOpen(false); };
  async function accept() {
    setBusy(true); setError('');
    try { await api('/api/staff/license/agreement', { version: state!.version }); rememberAccepted(username, state!.version); setOpen(false); }
    catch (e) {
      setError((e as Error).message);
      // A newer text arrived meanwhile (an update): the window shows it, to be read and accepted again.
      if (e instanceof ApiError && e.code === 'AGREEMENT_VERSION') void api<AgreementState>('/api/staff/license/agreement').then(s => { setState(s); setOpen(shouldAsk(s, username)); }, () => {});
    } finally { setBusy(false); }
  }
  return <Modal title={AGREEMENT_NAME} wide className="agreement-dialog" onClose={later}>
    <div className="modal-body agreement-body">
      <p className="agreement-lead">{state.accepted ? 'Sözleşmenin yeni bir sürümü var.' : 'Mola’yı kullanmaya devam etmek için lisans sözleşmesini okuyup kabul etmenizi rica ediyoruz.'} Bu pencere çalışmanızı durdurmaz: sipariş, ödeme ve mutfak her zamanki gibi devam eder. Şimdi okuyamıyorsanız “Daha sonra” deyin; bir sonraki girişinizde yeniden sorulur.</p>
      <AgreementText />
    </div>
    <div className="modal-actions agreement-actions">
      {/* Beside the buttons, not under the long text: a refused acceptance is seen where it was tapped. */}
      {error && <p className="agreement-error" role="alert">{error}</p>}
      <button type="button" className="btn secondary" disabled={busy} onClick={later}>Daha sonra</button>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void accept()}>{busy ? 'Kaydediliyor…' : 'Okudum, kabul ediyorum'}</button>
    </div>
  </Modal>;
}

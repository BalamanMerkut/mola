import { useState } from 'react';
import { PackageMinus } from 'lucide-react';
import type { PublicStockQuestion } from '../packages/domain/types';
import { amountLabel } from '../packages/domain/lines';
import { api } from './api';
import { Notice } from './components';
import './stock-questions.css';

/** The two answers, worded the same everywhere the kitchen is asked. */
export const STOCK_YES = 'Evet, hazırlanmıştı (fire)', STOCK_NO = 'Hayır, stok kullanılmadı';
export const STOCK_QUESTION = 'Bu üründen stok kullanıldı mı?';
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const lineText = (l: PublicStockQuestion['lines'][number]) => `${amountLabel({ quantity: l.quantity, grams: l.grams })} ${l.name}`;

/** Two buttons: "Evet, hazırlanmıştı (fire)" and "Hayır, stok kullanılmadı". */
export function StockAnswer({ busy, chosen, onAnswer }: { busy?: boolean; chosen?: boolean | null; onAnswer: (used: boolean) => void }) {
  return <div className="stock-answer" role="group" aria-label={STOCK_QUESTION}>
    <button type="button" className={`btn ${chosen === true ? 'primary' : 'secondary'}`} aria-pressed={chosen === undefined ? undefined : chosen === true} disabled={busy} onClick={() => onAnswer(true)}>{STOCK_YES}</button>
    <button type="button" className={`btn ${chosen === false ? 'primary' : 'secondary'}`} aria-pressed={chosen === undefined ? undefined : chosen === false} disabled={busy} onClick={() => onAnswer(false)}>{STOCK_NO}</button>
  </div>;
}

/**
 * Kitchen screen: cancellations made by a waiter or the owner after the kitchen had started them. Each asks whether the
 * product's stock was used; "Evet" records fire for the recipe, "Hayır" changes nothing. Unanswered by the end of the
 * cash day, a question counts as "Hayır" and leaves the screen.
 */
export function StockQuestions({ questions, onSaved }: { questions: PublicStockQuestion[]; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  async function answer(q: PublicStockQuestion, used: boolean) {
    setBusy(q.id); setError('');
    try { await api('/api/staff/stock/answer', { orderId: q.orderId, questionId: q.id, used }); onSaved(used ? 'Fire kaydedildi.' : 'Stok değişmedi.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(''); }
  }
  return <section className="stock-questions" aria-label="Stok soruları">
    <h2><PackageMinus size={18} aria-hidden="true" />{STOCK_QUESTION}</h2>
    {error && <Notice tone="error">{error}</Notice>}
    <ul>{questions.map(q => <li key={q.id} className="stock-question">
      <p><strong>{q.tableName} · #{q.orderNumber}</strong> <span className="muted small">İptal: {q.byName} · {clock(q.at)}</span></p>
      <p className="stock-question-lines">{q.lines.map(lineText).join(', ')}</p>
      <StockAnswer busy={busy === q.id} onAnswer={used => void answer(q, used)} />
    </li>)}</ul>
    <p className="muted small">Yanıtlanmayan soru gün sonunda “stok kullanılmadı” sayılır.</p>
  </section>;
}

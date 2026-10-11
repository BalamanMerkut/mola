import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api, ApiError, requestId } from './api';
import { Modal, Notice } from './components';
import { AttachButton, filesFrom, NEW_FOR, UploadList, useUploads } from './TicketFiles';
import { ADMIN } from './platformStatus';
import './platform-announcements.css';

/*
 * "Yeni mesaj" (Mola Yönetim → işletme sayfası → Destek): the Mola team starts a conversation with this business. It is an
 * ordinary support ticket whose first message is ours (POST /admin/tickets, server/merkez/app.ts): the café gets it with its
 * next heartbeat in Destek → Talepler, unread and marked "Mola ekibi başlattı", and the owner answers in the same thread.
 * Files go up first (tied to this business, then to the message); the ticket id is chosen here, so a repeat finds it.
 */
export function NewMessage({ tenantId, name, onClose, onSent }: { tenantId: string; name: string; onClose: () => void; onSent: (ticketId: string) => void }) {
  const [subject, setSubject] = useState(''), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const files = useUploads('support', `support:yeni-mesaj:${tenantId}`, `${NEW_FOR}${tenantId}`);
  const pending = useRef<{ requestId: string; id: string } | null>(null);
  const why = files.failed ? files.blocker : files.busy ? 'Ekler yükleniyor; bitince gönderebilirsiniz.' : subject.trim().length < 3 ? 'Konuyu yazın (en az 3 harf).' : text.trim().length < 3 && !files.ready.length ? 'Mesajı yazın.' : '';
  async function send() {
    setBusy(true); setError('');
    pending.current ??= { requestId: requestId(), id: crypto.randomUUID() };
    try {
      const r = await api<{ id: string }>(`${ADMIN}/tickets`, { ...pending.current, tenantId, subject: subject.trim(), text: text.trim(), ...(files.ready.length ? { attachments: files.ready.map(a => a.id) } : {}) });
      pending.current = null; files.clear(); onSent(r.id);
    } catch (e) {
      // A clear refusal can be corrected and sent as a new request; a lost answer is sent again as the same one.
      if (e instanceof ApiError && e.status < 500) pending.current = null;
      setError((e as Error).message);
    } finally { setBusy(false); }
  }
  return <Modal title="Yeni mesaj" wide className="new-message-dialog" dismissible={!busy} onClose={onClose}>
    <form className="new-message-form" onSubmit={e => { e.preventDefault(); if (!why) void send(); }}
      onDragOver={e => { if ([...e.dataTransfer.types].includes('Files') && !busy) e.preventDefault(); }} onDrop={e => { if (busy) return; e.preventDefault(); setNote(files.add(filesFrom(e.dataTransfer))); }}>
      <div className="modal-body">
        <p className="new-message-lead"><strong>{name}</strong> ile yeni bir görüşme başlatırsınız. İşletme sahibi bunu Mola’da Destek → Talepler’de “Mola ekibi başlattı” olarak görür (en geç 10 dakikada) ve aynı konuşmadan yanıt verir.</p>
        <label>Konu<input required minLength={3} maxLength={120} disabled={busy} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Örn. Yıllık aboneliğiniz hakkında" /></label>
        <label>Mesaj<textarea rows={6} maxLength={4000} disabled={busy} value={text} onChange={e => setText(e.target.value)} onPaste={e => { const pasted = filesFrom(e.clipboardData); if (pasted.length) { e.preventDefault(); setNote(files.add(pasted)); } }} placeholder="Merhaba, …" /></label>
        <div className="tc-new-files"><AttachButton uploads={files} disabled={busy} onNote={setNote} label="Fotoğraf veya PDF ekle" /><span className="muted small">En fazla 5 dosya, her biri 10 MB. Ekler 14 gün sonra silinir.</span></div>
        <UploadList uploads={files} />
        {note && <p className="muted small" role="status">{note}</p>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="modal-actions">
          {why && <p className="new-message-why muted small" role="status">{why}</p>}
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={busy || !!why}><Send size={16} aria-hidden="true" />{busy ? 'Gönderiliyor…' : 'Gönder'}</button>
        </div>
      </div>
    </form>
  </Modal>;
}

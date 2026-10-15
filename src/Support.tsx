import { ArrowLeft } from 'lucide-react';
import { NEW_TICKET, TicketChat } from './TicketChat';
import { AttachButton, filesFrom, UploadList, useUploads } from './TicketFiles';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { License, Ticket } from '../server/license';
import { api, ApiError, requestId } from './api';
import { Notice } from './components';
import { MolaContact } from './MolaContact';
import { PillTabs } from './PillTabs';
import { CircleHelp, Megaphone, MessagesSquare, MonitorSmartphone } from 'lucide-react';
import { PlaceLink } from './Moved';
import { AnnouncementList } from './Announcements';
import { RemoteAccess } from './RemoteSupport';
import './support.css';
// Destek → Yardım: Mola Yardım's hazır cevaplar (src/HelpPanel.tsx; its own chunk, loaded when the tab opens).
const HelpBody = lazy(() => import('./HelpPanel').then(module => ({ default: module.HelpBody })));

/** A message the café wrote but Mola Merkez has not confirmed yet (no internet, Merkez down): it is sent automatically later. */
type Message = Ticket['messages'][number] & { queued?: boolean };
type Connection = { lastSyncAt: string | null; ok: boolean; error: string | null; lastSuccessAt: string | null };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
/**
 * The owner's Destek: tickets are written on this computer, sent to the Mola support team over the internet and answered
 * there; answers come back here. While this screen is open it looks for answers every few seconds.
 */
export type SupportTab = 'tickets' | 'notifications' | 'announcements' | 'remote' | 'help';
/**
 * Destek is only about talking to Mola (10 Ekim düzeni): "Talepler" (support tickets and contact), "Duyurular" (the Mola
 * team's announcements, src/Announcements.tsx; red dot while unread) and "Mola desteği" (the Mola team's remote support
 * permission and who connected when, src/RemoteSupport.tsx), then "Yardım" (15 Ekim: Mola Yardım's hazır cevaplar, the same
 * as the top bar's "?"; nothing found → "Destek talebi aç" opens Talepler with the question written in). Bildirimler are on the bell of the top bar, the licence in
 * Ayarlar → İşletme → Paket ve lisans, the owner's devices in Ayarlar → Uzaktan erişim. An old
 * 'notifications' tab opens Talepler.
 */
/** draft: a new ticket already written ("Mola ekibine yaz" on a service not in the package, src/FeatureLock.tsx). */
export type TicketDraft = { subject: string; text: string };
/** Mola Yardım found nothing → "Destek talebi aç": a new ticket with the question as its subject and text (src/HelpPanel.tsx). */
export function helpTicketDraft(question: string): TicketDraft {
  const q = question.replace(/\s+/g, ' ').trim();
  return q.length >= 3 ? { subject: q.slice(0, 120), text: q } : { subject: 'Mola Yardım’da bulamadım', text: '' };
}
export function Support({ tab = 'tickets', onTab, announcements = 0, onWrite, draft }: { tab?: SupportTab; onTab?: (tab: SupportTab) => void; announcements?: number;
  /** "Bu konuda Mola ekibine yaz" under an announcement: a new ticket with it filled in. */
  onWrite?: (draft: TicketDraft) => void; draft?: TicketDraft }) {
  const [own, setOwn] = useState<SupportTab>(tab), [ownDraft, setOwnDraft] = useState<TicketDraft | undefined>(draft);
  const asked = onTab ? tab : own, current = asked === 'notifications' ? 'tickets' : asked, choose = (t: SupportTab) => { if (onTab) onTab(t); else setOwn(t); };
  const tabs = <PillTabs kind="tabs" label="Destek bölümleri" wrapClassName="support-pill-tabs" idPrefix="support-tab" panelId={id => `support-panel-${id}`} value={current} onChange={choose}
    items={[{ id: 'tickets' as const, label: 'Talepler', icon: MessagesSquare },
      { id: 'announcements' as const, label: 'Duyurular', icon: Megaphone, extra: announcements > 0 ? <span className="red-dot" title={`${announcements} okunmamış duyuru`} aria-hidden="true" /> : undefined }, { id: 'remote' as const, label: 'Mola desteği', icon: MonitorSmartphone }, { id: 'help' as const, label: 'Yardım', icon: CircleHelp }]} />;
  if (current === 'announcements') return <>{tabs}<div role="tabpanel" id="support-panel-announcements" aria-labelledby="support-tab-announcements"><AnnouncementList owner onWrite={d => { if (onWrite) onWrite(d); else { setOwnDraft(d); choose('tickets'); } }} /></div></>;
  if (current === 'help') return <>{tabs}<div role="tabpanel" id="support-panel-help" aria-labelledby="support-tab-help" className="support-help"><Suspense fallback={null}><HelpBody role="owner" view="support" onTicket={question => { const d = helpTicketDraft(question); if (onWrite) onWrite(d); else { setOwnDraft(d); choose('tickets'); } }} /></Suspense></div></>;
  if (current === 'remote') return <>{tabs}<div role="tabpanel" id="support-panel-remote" aria-labelledby="support-tab-remote"><RemoteAccess /></div></>;
  return <>{tabs}<div role="tabpanel" id="support-panel-tickets" aria-labelledby="support-tab-tickets"><SupportTickets key={ownDraft?.subject} draft={ownDraft} /></div></>;
}
function SupportTickets({ draft }: { draft?: TicketDraft }) {
  const [data, setData] = useState<{ tickets: Ticket[]; license?: License & { daysRemaining: number; active: boolean; frozen: boolean }; connection?: Connection; merkez?: { notice: string | null; blocked: 'offline' | 'moved' | 'removed' | null } } | null>(null), [error, setError] = useState('');
  const [subject, setSubject] = useState(draft?.subject ?? ''), [text, setText] = useState(draft?.text ?? ''), [selected, setSelected] = useState(draft ? NEW_TICKET : '');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false); const pending = useRef<object | null>(null);
  const [loadError, setLoadError] = useState('');
  // Photos and PDFs for the new ticket: uploaded as soon as they are chosen (src/TicketFiles.tsx).
  const files = useUploads('business', 'business:yeni-talep', ''), [fileNote, setFileNote] = useState('');
  async function load() { try { setData(await api('/api/staff/support')); setLoadError(''); } catch (e) { setLoadError((e as Error).message); } }
  const [retrying, setRetrying] = useState(false);
  async function retrySync() { setRetrying(true); try { await api('/api/staff/support/sync', {}, undefined, 30000); } catch { /* the line below says it */ } finally { setRetrying(false); await load(); } }
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(t); }, []);
  async function create() { setBusy(true); setError(''); pending.current ??= { requestId: requestId(), subject, text, ...(files.ready.length ? { attachments: files.ready.map(a => a.id) } : {}) }; try { const r = await api<{ id: string }>('/api/staff/support', pending.current); pending.current = null; setUncertain(false); await load(); setSelected(r.id); setSubject(''); setText(''); files.clear(); } catch (e) { const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setError((e as Error).message); } finally { setBusy(false); } }
  const c = data?.connection;
  const waiting = data?.tickets.some(t => (t.messages as Message[]).some(m => m.queued));
  // The vendor closed this business's record: nothing new can be sent; the notice says to call the Mola team.
  const closed = data?.merkez?.blocked === 'removed';
  // Why "Destek talebi aç" cannot be pressed yet, said next to it (not a silent grey button).
  const newWhy = busy || uncertain ? '' : files.failed ? files.blocker : files.busy ? 'Ekler yükleniyor; bitince gönderebilirsiniz.'
    : subject.trim().length < 3 ? 'Konuyu yazın (en az 3 harf).' : text.trim().length < 3 ? 'Sorunu birkaç kelimeyle anlatın.' : '';
  // The new ticket form: in the conversation pane (on phones its own screen with a back arrow).
  const newTicket =(back: () => void) => <form className="tc-new" aria-label="Yeni destek talebi" onSubmit={e => { e.preventDefault(); void create(); }}
    onDragOver={e => { if ([...e.dataTransfer.types].includes('Files') && !busy && !uncertain) e.preventDefault(); }} onDrop={e => { if (busy || uncertain) return; e.preventDefault(); setFileNote(files.add(filesFrom(e.dataTransfer))); }}>
    <header className="tc-head"><button type="button" className="tc-back" aria-label="Taleplere dön" onClick={back}><ArrowLeft size={20} aria-hidden="true" /></button><div className="tc-head-text"><h3>Yeni destek talebi</h3><p>Mola ekibi yanıtlayınca burada görürsünüz.</p></div></header>
    <div className="tc-new-body">
      <p className="tc-new-lead">Talebiniz internet üzerinden Mola destek ekibine iletilir. İnternet yoksa bu bilgisayarda bekler, bağlantı gelince kendiliğinden gönderilir.</p>
      <label>Konu *<input autoFocus required minLength={3} maxLength={120} disabled={busy || uncertain} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Örn. Fiş yazıcısı yazdırmıyor" /></label>
      <label>Sorunu anlatın *<textarea required minLength={3} maxLength={4000} disabled={busy || uncertain} value={text} onChange={e => setText(e.target.value)} onPaste={e => { const pasted = filesFrom(e.clipboardData); if (pasted.length) { e.preventDefault(); setFileNote(files.add(pasted)); } }} placeholder="Hangi ekranda, hangi işlemde sorun oluştu? Şifre paylaşmayın." /></label>
      <div className="tc-new-files"><AttachButton uploads={files} disabled={busy || uncertain} onNote={setFileNote} label="Fotoğraf veya PDF ekle" /><span className="muted small">En fazla 5 dosya, her biri 10 MB. Ekler 14 gün sonra silinir.</span></div>
      <UploadList uploads={files} />
      {fileNote && <p className="tc-new-lead" role="status">{fileNote}</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
    <div className="tc-new-actions">{newWhy && <p className={`tc-new-why${files.failed ? ' bad' : ''}`} id="tc-new-why" role={files.failed ? 'alert' : 'status'}>{newWhy}</p>}<button type="button" className="btn secondary" disabled={busy} onClick={back}>Vazgeç</button><button className="btn primary" aria-describedby={newWhy ? 'tc-new-why' : undefined} disabled={busy || files.busy || files.failed || (!uncertain && (subject.trim().length < 3 || text.trim().length < 3))}>{uncertain ? 'Talebi yeniden kontrol et' : 'Destek talebi aç'}</button></div>
  </form>;
  return <div className="support-tickets">
    {/* Offline for days, another computer holds the licence, or a wrong clock: said here in one sentence. */}
    {data?.merkez?.notice && <Notice tone={data.merkez.blocked ? 'error' : 'info'}>{data.merkez.notice}</Notice>}
    {loadError && <Notice tone="error">{loadError}</Notice>}
    {/* Not reached: the reason in plain words (no internet, Merkez not answering, a wrong address, the clock) and "Yeniden dene". */}
    {c && <p className={`muted small support-connection ${c.lastSyncAt && !c.ok ? 'warn' : ''}`} role="status">{!c.lastSyncAt ? 'Mola Merkez’e henüz bağlanılmadı.' : c.ok ? `Mola Merkez’e son bağlantı: ${when(c.lastSyncAt)}` : `${c.error ?? 'Mola Merkez’e ulaşılamadı.'}${c.lastSuccessAt ? ` Son başarılı bağlantı: ${when(c.lastSuccessAt)}.` : ''}${waiting ? ' Bekleyen mesajlar bağlantı gelince gönderilecek.' : ''}`}
      {c.lastSyncAt && !c.ok && <button type="button" className="text-btn" disabled={retrying} onClick={() => void retrySync()}>{retrying ? 'Deneniyor…' : 'Yeniden dene'}</button>}</p>}
    {data && <TicketChat side="business" tickets={data.tickets} selected={selected} onSelect={id => { setSelected(id); if (!uncertain) setError(''); }} onSaved={load} newTicket={closed ? undefined : newTicket} readOnly={closed ? 'Bu işletmenin kaydı kapatıldı; buradan mesaj gönderilemez. Mola ekibine aşağıdaki bilgilerden ulaşabilirsiniz.' : undefined} />}
    <section className="panel support-info"><h2>İletişim</h2>{data?.license && <p className="support-license-line"><span><strong>{data.license.kind === 'trial' ? 'Ücretsiz deneme' : 'Abonelik'}</strong>{data.license.endsAt ? <> · {data.license.daysRemaining} gün kaldı</> : ''}</span><PlaceLink to={{ view: 'settings', topic: 'business', part: 'package' }}>Paket ve lisans</PlaceLink></p>}
      <Notice>Talepler internet üzerinden Mola destek ekibine iletilir, yanıtlar Talepler’e gelir. İnternet yoksa mesajlar bu bilgisayarda bekler, bağlantı gelince kendiliğinden gönderilir. SMS/e-posta bildirimi henüz yapılandırılmadı.</Notice>
      <MolaContact title={closed || data?.merkez?.blocked ? 'Mola ekibine ulaşın' : 'Mola ekibine doğrudan ulaşın'} note={closed ? 'Bu işletmenin kaydı kapatıldı; yeni talep buradan gönderilemez.' : data?.merkez?.blocked ? 'Lisans bu bilgisayarda kullanılamıyor; Mola ekibi yardımcı olur.' : undefined} /></section>
  </div>;
}

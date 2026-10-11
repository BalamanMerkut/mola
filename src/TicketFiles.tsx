import { AlertCircle, Download, FileText, ImageOff, Paperclip, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AttachmentRef } from '../server/license';
import { withoutHiddenMarks } from '../packages/domain/plain-text';
import type { TicketSide } from './ticketOrder';

/*
 * Destek ekleri on screen (server/merkez/attachments.ts keeps them): photos and PDFs, at most 5 a message, 10 MB a file,
 * deleted after 14 days. A chosen file is uploaded at once (progress bar); the message only names the uploaded ones.
 * The café's browser sends to its own server (which passes it to Mola Merkez); Mola Yönetim sends to Merkez directly.
 */
export const MAX_FILES = 5, MAX_BYTES = 10 * 1024 * 1024;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf';
/** `refused`: the server said no to this file (type, size, room): trying the same file again cannot help, only removing it. */
export type Upload = { key: string; name: string; size: number; image: boolean; preview?: string; progress: number; state: 'uploading' | 'done' | 'failed'; ref?: AttachmentRef; error?: string; file?: File; refused?: boolean };
/** A file name as written: no hidden direction marks or control characters (an old stored name may still have them). */
export const shownName = (name: string) => withoutHiddenMarks(name) || 'dosya';
class Refused extends Error {}

const base = (side: TicketSide) => side === 'support' ? '/api/merkez/admin/attachments' : '/api/staff/support/attachments';
export const fileUrl = (side: TicketSide, id: string, small = false) => `${base(side)}/${id}${small ? '/kucuk' : ''}`;
export const showSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;
export const expired = (a: AttachmentRef, now = Date.now()) => Date.parse(a.expiresAt) <= now;
const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name);
const allowed = (f: File) => isImage(f) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** useUploads('support', slot, `${NEW_FOR}${tenantId}`): Mola Yönetim's files for a conversation it is starting. */
export const NEW_FOR = 'isletme:';
/** One upload with progress (XMLHttpRequest: fetch has no upload progress). */
function send(side: TicketSide, ticketId: string, file: File, onProgress: (p: number) => void): Promise<AttachmentRef> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(99, Math.round(e.loaded / e.total * 100))); };
    xhr.onerror = () => reject(new Error('Bağlantı kesildi.'));
    xhr.ontimeout = () => reject(new Error('Yükleme çok uzun sürdü.'));
    xhr.onload = () => {
      let data: { attachment?: AttachmentRef; message?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 200 && data.attachment) resolve(data.attachment);
      // 4xx with a reason: a clear no (wrong type, too large, no room left); 5xx or no answer: may work on a retry.
      else if (xhr.status >= 400 && xhr.status < 500 && xhr.status !== 408 && xhr.status !== 429) reject(new Refused(data.message ?? 'Bu dosya kabul edilmedi.'));
      else reject(new Error(data.message ?? 'Mola Merkez şu an yanıt vermedi.'));
    };
    xhr.timeout = 180_000;
    if (side === 'support') {
      // NEW_FOR + tenant: a file for the Mola team's new conversation with that business ("Yeni mesaj"; no ticket yet).
      const target = ticketId.startsWith(NEW_FOR) ? `tenantId=${encodeURIComponent(ticketId.slice(NEW_FOR.length))}` : `ticketId=${encodeURIComponent(ticketId)}`;
      xhr.open('POST', `${base(side)}?${target}&name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream'); xhr.send(file);
    } else {
      // The café server takes JSON only (its CSRF rule): the file goes as base64.
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Dosya okunamadı.'));
      reader.onload = () => {
        xhr.open('POST', base(side)); xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ name: file.name, data: String(reader.result).split(',')[1] ?? '' }));
      };
      reader.readAsDataURL(file);
    }
  });
}

// ---------- Chosen files per conversation (kept while the panel is open, like drafts) ----------
const lists = new Map<string, Upload[]>(), listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** The files chosen for one box (`slot`: side + ticket, or the new ticket form), and what can be done with them. */
export function useUploads(side: TicketSide, slot: string, ticketId: string) {
  useSyncExternalStore(subscribe, () => version);
  const list = lists.get(slot) ?? [];
  const set = (next: Upload[]) => { if (next.length) lists.set(slot, next); else lists.delete(slot); emit(); };
  const update = (key: string, change: Partial<Upload>) => { const now = lists.get(slot) ?? []; const i = now.findIndex(u => u.key === key); if (i < 0) return; now[i] = { ...now[i], ...change }; lists.set(slot, [...now]); emit(); };
  const start = (u: Upload) => {
    if (!u.file) return;
    update(u.key, { state: 'uploading', progress: 0, error: undefined, refused: undefined });
    send(side, ticketId, u.file!, p => update(u.key, { progress: p })).then(ref => update(u.key, { state: 'done', progress: 100, ref }), (e: Error) => update(u.key, { state: 'failed', error: e.message, refused: e instanceof Refused }));
  };
  /** Adds files (picker, drop, paste); returns a sentence when some could not be added. */
  const add = (files: File[]): string => {
    const now = lists.get(slot) ?? [], room = MAX_FILES - now.length, notes: string[] = [];
    const fresh: Upload[] = [];
    for (const f of files) {
      if (fresh.length >= room) { notes.push(`Bir mesaja en fazla ${MAX_FILES} ek eklenebilir.`); break; }
      if (!allowed(f)) { notes.push(`${shownName(f.name)}: yalnız fotoğraf ve PDF eklenebilir.`); continue; }
      if (f.size > MAX_BYTES) { notes.push(`${shownName(f.name)}: 10 MB’tan büyük.`); continue; }
      const image = isImage(f);
      fresh.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: f.name || (image ? 'Ekran görüntüsü.png' : 'belge.pdf'), size: f.size, image, preview: image && !/hei[cf]/i.test(f.type + f.name) ? URL.createObjectURL(f) : undefined, progress: 0, state: 'uploading', file: f });
    }
    if (fresh.length) { set([...now, ...fresh]); fresh.forEach(start); }
    return [...new Set(notes)].join(' ');
  };
  const remove = (key: string) => { const u = list.find(x => x.key === key); if (u?.preview) URL.revokeObjectURL(u.preview); set(list.filter(x => x.key !== key)); };
  const clear = () => { for (const u of list) if (u.preview) URL.revokeObjectURL(u.preview); set([]); };
  const ready = list.filter(u => u.state === 'done' && u.ref).map(u => u.ref!);
  const failedOnes = list.filter(u => u.state === 'failed');
  return { list, add, remove, retry: (key: string) => { const u = list.find(x => x.key === key); if (u && !u.refused) start(u); }, clear, ready, busy: list.some(u => u.state === 'uploading'), failed: failedOnes.length > 0,
    /** Why the message cannot go yet, in one sentence for next to the send button (empty when nothing blocks it). */
    blocker: failedOnes.length ? uploadBlocker(failedOnes) : '' };
}
/** "x.exe: Bu dosya türü eklenemez. Eki kaldırın." / "foto.jpg yüklenemedi: Bağlantı kesildi. Tekrar deneyin ya da kaldırın." */
export function uploadBlocker(failed: Pick<Upload, 'name' | 'error' | 'refused'>[]) {
  const u = failed[0], more = failed.length > 1 ? ` ve ${failed.length - 1} ek daha` : '', reason = (u.error ?? '').trim(), end = (s: string) => s && !/[.!?]$/.test(s) ? `${s}.` : s;
  return u.refused ? `${shownName(u.name)}${more} gönderilemez: ${end(reason) || 'Dosya kabul edilmedi.'} Mesajı göndermek için eki kaldırın.` : `${shownName(u.name)}${more} yüklenemedi${reason ? `: ${end(reason)}` : '.'} Tekrar deneyin ya da eki kaldırın.`;
}
export type Uploads = ReturnType<typeof useUploads>;
/** A refused message's files go back above the box (already uploaded: nothing to send again). */
export function restoreUploads(slot: string, refs: AttachmentRef[]) {
  if (!refs.length) return;
  lists.set(slot, [...(lists.get(slot) ?? []), ...refs.map(ref => ({ key: ref.id, name: ref.name, size: ref.size, image: ref.type === 'image/webp', progress: 100, state: 'done' as const, ref }))].slice(0, MAX_FILES)); emit();
}

/** The paperclip: camera, gallery or files on a phone, the file dialog on a computer. */
export function AttachButton({ uploads, disabled, onNote, label }: { uploads: Uploads; disabled?: boolean; onNote: (note: string) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="tc-attach" aria-label={label ? undefined : 'Fotoğraf veya PDF ekle'} title="Fotoğraf veya PDF ekle (en fazla 5, 10 MB)" disabled={disabled || uploads.list.length >= MAX_FILES} onClick={() => input.current?.click()}><Paperclip size={label ? 17 : 20} aria-hidden="true" />{label}</button>
    <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; onNote(uploads.add(files)); }} />
  </>;
}
/** The chosen files above the box: a thumbnail or PDF icon, progress, "Tekrar dene", remove. */
export function UploadList({ uploads }: { uploads: Uploads }) {
  if (!uploads.list.length) return null;
  return <ul className="tc-uploads" aria-label="Eklenecek dosyalar">{uploads.list.map(u => <li key={u.key} className={`tc-upload ${u.state}`}>
    <span className="tc-upload-icon">{u.preview ? <img src={u.preview} alt="" /> : <FileText size={20} aria-hidden="true" />}</span>
    <span className="tc-upload-text"><span className="tc-upload-name">{shownName(u.name)}</span>
      <span className="tc-upload-state">{u.state === 'uploading' ? `Yükleniyor… %${u.progress}` : u.state === 'failed' ? u.error ?? 'Yüklenemedi.' : showSize(u.ref?.size ?? u.size)}</span>
      {u.state === 'uploading' && <span className="tc-progress" role="progressbar" aria-label={`${shownName(u.name)} yükleniyor`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={u.progress}><span style={{ width: `${u.progress}%` }} /></span>}</span>
    {/* A refused file (type, size, room) would be refused again: only "kaldır" then. */}
    {u.state === 'failed' && !u.refused && <button type="button" className="tc-upload-btn" aria-label={`${shownName(u.name)}: tekrar dene`} onClick={() => uploads.retry(u.key)}><RotateCw size={16} aria-hidden="true" /></button>}
    <button type="button" className="tc-upload-btn" aria-label={`${shownName(u.name)}: kaldır`} onClick={() => uploads.remove(u.key)}><X size={16} aria-hidden="true" /></button>
  </li>)}</ul>;
}

/** Files on a message: photos as thumbnails (tap → full view), PDFs as a card; after 14 days a grey line. */
export function MessageFiles({ side, files, onOpen }: { side: TicketSide; files: AttachmentRef[]; onOpen: (a: AttachmentRef) => void }) {
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const gone = (a: AttachmentRef) => expired(a) || broken.has(a.id);
  const images = files.filter(a => a.type === 'image/webp'), docs = files.filter(a => a.type !== 'image/webp');
  return <div className="tc-files">
    {images.length > 0 && <div className={`tc-thumbs n${Math.min(images.length, 4)}`}>{images.map(a => gone(a)
      ? <span key={a.id} className="tc-file-gone"><ImageOff size={16} aria-hidden="true" />Ek silindi (14 gün)</span>
      : <button type="button" key={a.id} className="tc-thumb" aria-label={`${shownName(a.name)}: büyüt`} onClick={() => onOpen(a)} style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}>
          <img src={fileUrl(side, a.id, true)} alt={shownName(a.name)} loading="lazy" onError={() => setBroken(b => new Set(b).add(a.id))} />
        </button>)}</div>}
    {docs.map(a => gone(a)
      ? <span key={a.id} className="tc-file-gone"><FileText size={16} aria-hidden="true" />Ek silindi (14 gün)</span>
      : <a key={a.id} className="tc-doc" href={fileUrl(side, a.id)} download={shownName(a.name)} aria-label={`${shownName(a.name)} (${showSize(a.size)}) indir`}>
          <span className="tc-doc-icon"><FileText size={22} aria-hidden="true" /></span>
          <span className="tc-doc-text"><span className="tc-doc-name">{shownName(a.name)}</span><span className="tc-doc-size">PDF · {showSize(a.size)}</span></span>
          <Download size={18} aria-hidden="true" />
        </a>)}
  </div>;
}

/** A photo in full size over the conversation; Escape or "Kapat" closes it. */
export function Lightbox({ side, file, onClose }: { side: TicketSide; file: AttachmentRef; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const name = shownName(file.name);
  return <div className="tc-lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="tc-lightbox-bar"><span>{name}</span><a className="tc-lightbox-btn" href={fileUrl(side, file.id)} download={name} aria-label="Fotoğrafı indir"><Download size={18} aria-hidden="true" /></a><button ref={close} type="button" className="tc-lightbox-btn" aria-label="Kapat" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    {failed ? <p className="tc-lightbox-gone"><AlertCircle size={18} aria-hidden="true" />Ek silindi (14 gün) ya da şu an alınamıyor.</p>
      : <img src={fileUrl(side, file.id)} alt={name} onError={() => setFailed(true)} />}
  </div>;
}
/** Drag-and-drop and paste: files dropped on the conversation or pasted into the box (a screenshot) are added. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files];
  if (files.length) return files;
  return [...data.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => !!f);
}

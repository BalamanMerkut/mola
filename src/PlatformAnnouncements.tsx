import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BellRing, Check, ChevronDown, Mail, Megaphone, Pencil, Search, Send, Undo2, Users } from 'lucide-react';
import { ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_TITLE_MAX, type AnnouncementAudience } from '../packages/domain/announcement';
import { api, ApiError, requestId } from './api';
import { Notice } from './components';
import { AnnouncementCard, AnnouncementText, announcementDay } from './Announcements';
import { withStepUp } from './platformStepUp';
import type { CatalogView } from './platformCatalog';
import { ADMIN, type Business } from './platformStatus';
import './platform-announcements.css';

/*
 * Mola Yönetim → Duyurular (server/merkez/announcements.ts): the sent announcements (title, date, who it went to, Önemli,
 * "Okuyan: 32/40" and who has not read it) and the composer (title, plain text, target, Önemli, an e-mail copy when the
 * vendor's e-mail is set up) with a preview of the café's card. Sending, editing and withdrawing ask for the Authenticator
 * code like prices and releases (src/platformStepUp.tsx, the same 10-minute window). Cafés get it with their next
 * heartbeat (at most 10 minutes); businesses added later do not get older announcements.
 */
type Reader = { tenantId: string; name: string; readAt?: string; by?: 'owner' | 'manager'; ackAt?: string };
export type AnnouncementRow = { id: string; title: string; text: string; important: boolean; audience: AnnouncementAudience; audienceText: string; createdAt: string; editedAt?: string; withdrawnAt?: string;
  total: number; read: number; acknowledged: number; email?: { queued: number; sent: number; failed: number; missing: number }; businesses: Reader[] };
type Mode = null | { kind: 'new' } | { kind: 'edit'; row: AnnouncementRow };
type Target = 'all' | 'packages' | 'selected';
const who = (by?: 'owner' | 'manager') => by === 'manager' ? 'Müdür' : 'İşletme sahibi';
/** "12 gönderildi · 2 bekliyor · 1 gönderilemedi · 3 işletmenin e-postası yok" */
function emailLine(e: NonNullable<AnnouncementRow['email']>) {
  const waiting = Math.max(0, e.queued - e.sent - e.failed);
  return [`E-posta: ${e.sent} gönderildi`, waiting && `${waiting} bekliyor`, e.failed && `${e.failed} gönderilemedi`, e.missing && `${e.missing} işletmenin e-postası yok`].filter(Boolean).join(' · ');
}

export function PlatformAnnouncements({ businesses, catalog, disabled }: { businesses: Business[]; catalog?: CatalogView; disabled: boolean }) {
  const [data, setData] = useState<{ announcements: AnnouncementRow[]; emailReady: boolean } | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [mode, setMode] = useState<Mode>(null), [open, setOpen] = useState('');
  const load = useCallback(async () => { try { setData(await api(`${ADMIN}/announcements`)); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  // Read marks come with the cafés' heartbeats: the list asks again every 15 s while it is open.
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 15000); return () => clearInterval(t); }, [load]);
  const done = (message: string) => { setMode(null); setNotice(message); void load(); window.scrollTo?.(0, 0); };
  if (mode) return <Composer key={mode.kind === 'edit' ? mode.row.id : 'new'} businesses={businesses} catalog={catalog} emailReady={!!data?.emailReady} editing={mode.kind === 'edit' ? mode.row : undefined} disabled={disabled} onCancel={() => setMode(null)} onDone={done} />;
  const list = data?.announcements ?? [];
  return <>
    <header className="page-head"><div><h1>Duyurular</h1><p className="page-lead">İşletmelere yeni özellik, bakım saati ya da önemli bir bilgi duyurun. İşletmeler Mola’da Destek → Duyurular’da görür (en geç 10 dakikada); işletme sahibi ve müdür okuyabilir.</p></div>
      <button type="button" className="btn primary" disabled={disabled} onClick={() => { setNotice(''); setMode({ kind: 'new' }); }}><Megaphone size={17} aria-hidden="true" />Yeni duyuru</button></header>
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    {!data && !error ? <p className="muted" role="status">Duyurular yükleniyor…</p>
      : !list.length ? <section className="ann-empty"><Megaphone size={34} strokeWidth={1.4} aria-hidden="true" /><h2>Henüz duyuru göndermediniz</h2><p className="muted">“Yeni duyuru” ile bütün işletmelere, bir paketteki işletmelere ya da seçtiğiniz işletmelere yazabilirsiniz.</p></section>
      : <ul className="ann-list" aria-label="Gönderilen duyurular">{list.map(a => <AnnouncementRowView key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? '' : a.id)} disabled={disabled}
        onEdit={() => { setNotice(''); setMode({ kind: 'edit', row: a }); }} onWithdrawn={() => { setNotice(`“${a.title}” geri çekildi. İşletmelerden en geç 10 dakikada kalkar.`); void load(); }} />)}</ul>}
  </>;
}

/** One sent announcement: a line to open, then its text, who has not read it yet, who did, and Düzenle / Geri çek. */
function AnnouncementRowView({ a, open, onToggle, disabled, onEdit, onWithdrawn }: { a: AnnouncementRow; open: boolean; onToggle: () => void; disabled: boolean; onEdit: () => void; onWithdrawn: () => void }) {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<string | null>(null);
  const unread = a.businesses.filter(b => !b.readAt), read = a.businesses.filter(b => b.readAt), waitingAck = a.important ? read.filter(b => !b.ackAt) : [];
  const share = a.total ? Math.round(a.read / a.total * 100) : 0;
  async function withdraw() {
    setBusy(true); setError(''); pending.current ??= requestId();
    try { await withStepUp('Geri çek', () => api(`${ADMIN}/announcements/withdraw`, { requestId: pending.current, id: a.id })); pending.current = null; setConfirming(false); onWithdrawn(); }
    catch (e) { if (e instanceof ApiError && e.status < 500) pending.current = null; setError((e as Error).message); } finally { setBusy(false); }
  }
  return <li className={`ann-row${a.withdrawnAt ? ' withdrawn' : ''}${open ? ' open' : ''}`}>
    <button type="button" className="ann-row-head" aria-expanded={open} onClick={onToggle}>
      <span className={`ann-row-icon${a.important ? ' important' : ''}`} aria-hidden="true">{a.important ? <BellRing size={18} /> : <Megaphone size={18} />}</span>
      <span className="ann-row-main">
        <strong className="ann-row-title">{a.title}</strong>
        <span className="ann-row-meta">{announcementDay(a.createdAt)} · {a.audienceText}{a.editedAt ? ' · düzenlendi' : ''}</span>
        <span className="ann-row-chips">{a.important && <span className="ann-chip important">Önemli</span>}{a.withdrawnAt && <span className="ann-chip withdrawn">Geri çekildi</span>}{a.email && <span className="ann-chip mail"><Mail size={12} aria-hidden="true" />E-posta</span>}</span>
      </span>
      <span className="ann-row-reads"><strong>Okuyan: {a.read}/{a.total}</strong>{a.important && <small>Okudum diyen: {a.acknowledged}/{a.total}</small>}<span className="ann-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></span></span>
      <ChevronDown size={18} className="ann-row-chevron" aria-hidden="true" />
    </button>
    {open && <div className="ann-row-body">
      <AnnouncementText text={a.text} />
      {a.email && <p className="ann-email muted small"><Mail size={14} aria-hidden="true" />{emailLine(a.email)}</p>}
      <div className="ann-readers">
        <section aria-label="Henüz okumayanlar"><h3>Henüz okumayanlar <span>{unread.length}</span></h3>{unread.length ? <ul>{unread.map(b => <li key={b.tenantId}>{b.name}</li>)}</ul> : <p className="muted small">Herkes okudu.</p>}</section>
        {a.important && <section aria-label="Okudum demeyenler"><h3>Okudu, “Okudum” demedi <span>{waitingAck.length}</span></h3>{waitingAck.length ? <ul>{waitingAck.map(b => <li key={b.tenantId}>{b.name}<small>{who(b.by)} açtı</small></li>)}</ul> : <p className="muted small">Okuyan her işletme sahibi onayladı.</p>}</section>}
        <section aria-label="Okuyanlar"><h3>Okuyanlar <span>{read.length}</span></h3>{read.length ? <ul>{read.map(b => <li key={b.tenantId}>{b.name}<small>{who(b.by)} · {announcementDay(b.readAt!)}{b.ackAt ? ' · Okudum dedi' : ''}</small></li>)}</ul> : <p className="muted small">Henüz okuyan yok.</p>}</section>
      </div>
      {a.withdrawnAt ? <p className="muted small">Geri çekildi: {announcementDay(a.withdrawnAt)}. İşletmelerde görünmüyor.</p>
        : <div className="ann-row-actions">
          <button type="button" className="btn secondary" disabled={disabled || busy} onClick={onEdit}><Pencil size={16} aria-hidden="true" />Düzenle</button>
          {!confirming ? <button type="button" className="btn secondary danger-text" disabled={disabled || busy} onClick={() => setConfirming(true)}><Undo2 size={16} aria-hidden="true" />Geri çek</button>
            : <div className="ann-confirm" role="group" aria-label="Geri çekme onayı"><p><strong>Duyuru geri çekilsin mi?</strong> İşletmelerin ekranından en geç 10 dakikada kalkar. Gönderilmiş e-postalar geri alınamaz.</p>
              <div><button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>Vazgeç</button><button type="button" className="btn primary" disabled={busy} onClick={() => void withdraw()}>{busy ? 'Geri çekiliyor…' : 'Evet, geri çek'}</button></div></div>}
        </div>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>}
  </li>;
}

/** Yeni duyuru / Düzenle: the form on the left, the café's card on the right (stacked on narrow screens). */
function Composer({ businesses, catalog, emailReady, editing, disabled, onCancel, onDone }: { businesses: Business[]; catalog?: CatalogView; emailReady: boolean; editing?: AnnouncementRow; disabled: boolean; onCancel: () => void; onDone: (message: string) => void }) {
  const [title, setTitle] = useState(editing?.title ?? ''), [text, setText] = useState(editing?.text ?? ''), [important, setImportant] = useState(editing?.important ?? false);
  const [target, setTarget] = useState<Target>('all'), [packageIds, setPackageIds] = useState<string[]>([]), [tenantIds, setTenantIds] = useState<string[]>([]), [query, setQuery] = useState(''), [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [tried, setTried] = useState(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  // Who can get one: businesses with a computer (activated); "all" and packages leave suspended ones out, a chosen one may be.
  const reachable = useMemo(() => businesses.filter(b => b.activation === 'active').sort((x, y) => x.name.localeCompare(y.name, 'tr')), [businesses]);
  const packages = (catalog?.packages ?? []).filter(p => !p.archived || reachable.some(b => b.services?.packageId === p.id));
  const inPackage = (id: string) => reachable.filter(b => !b.suspended && b.services?.packageId === id);
  const targets = target === 'all' ? reachable.filter(b => !b.suspended) : target === 'packages' ? reachable.filter(b => !b.suspended && !!b.services?.packageId && packageIds.includes(b.services.packageId)) : reachable.filter(b => tenantIds.includes(b.tenantId));
  const withEmail = targets.filter(b => !!b.invoice?.email).length;
  const q = query.trim().toLocaleLowerCase('tr-TR'), shown = reachable.filter(b => !q || `${b.name} ${b.invoice?.city ?? ''} ${b.services?.packageName ?? ''}`.toLocaleLowerCase('tr-TR').includes(q));
  const problems = [title.trim().length < 3 && 'Başlığı yazın (en az 3 harf).', text.trim().length < 3 && 'Duyuru metnini yazın.', !editing && !targets.length && (target === 'packages' && !packageIds.length ? 'En az bir paket seçin.' : target === 'selected' && !tenantIds.length ? 'En az bir işletme seçin.' : 'Bu hedefte duyuru gidecek işletme yok.')].filter(Boolean) as string[];
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  async function submit() {
    setTried(true); if (problems.length) return;
    setBusy(true); setError('');
    const body = editing ? { id: editing.id, title, text, important } : { title, text, important, audience: target === 'all' ? { kind: 'all' } : target === 'packages' ? { kind: 'packages', packageIds } : { kind: 'selected', tenantIds: targets.map(b => b.tenantId) }, ...(email && emailReady ? { email: true } : {}) };
    // The same request again only for the same content (a lost answer); anything changed is a new request.
    const key = JSON.stringify(body); if (pending.current?.key !== key) pending.current = { key, requestId: requestId() };
    try {
      const r = await withStepUp(editing ? 'Değişikliği kaydet' : 'Duyuruyu gönder', () => api<{ tenants?: number; email?: { queued: number; missing: number }; changed?: boolean }>(`${ADMIN}/announcements${editing ? '/edit' : ''}`, { requestId: pending.current!.requestId, ...body }));
      pending.current = null;
      onDone(editing ? (r.changed === false ? 'Değişiklik yok.' : 'Duyuru düzeltildi. İşletmelerde “düzenlendi” yazar; en geç 10 dakikada güncellenir.')
        : `Duyuru ${r.tenants ?? targets.length} işletmeye gönderildi; işletmeler en geç 10 dakikada görür.${r.email ? ` E-posta ${r.email.queued} işletmeye gidiyor${r.email.missing ? ` (${r.email.missing} işletmenin e-postası yok)` : ''}.` : ''}`);
    } catch (e) { if (e instanceof ApiError && e.status < 500) pending.current = null; setError((e as Error).message); } finally { setBusy(false); }
  }
  const off = disabled || busy;
  return <section className="ann-composer" aria-label={editing ? 'Duyuruyu düzenle' : 'Yeni duyuru'}>
    <button type="button" className="text-btn back-link" disabled={busy} onClick={onCancel}><ArrowLeft size={16} aria-hidden="true" />Duyurular</button>
    <header className="page-head"><div><h1>{editing ? 'Duyuruyu düzenle' : 'Yeni duyuru'}</h1><p className="page-lead">{editing ? 'Başlığı, metni ya da “Önemli”yi değiştirebilirsiniz; kime gittiği değişmez. İşletmelerde “düzenlendi” yazar.' : 'Düz metin yazın; satır araları korunur, web adresleri bağlantı olur. Gönderdiğiniz anda hangi işletmelere gideceği belli olur; sonradan eklenen işletmeler bu duyuruyu görmez.'}</p></div></header>
    <div className="ann-compose-grid">
      <form className="ann-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label>Başlık<input maxLength={ANNOUNCEMENT_TITLE_MAX} disabled={off} value={title} onChange={e => setTitle(e.target.value)} placeholder="Örn. Pazar gecesi 02:00–03:00 bakım" /></label>
        <label>Metin<textarea rows={9} maxLength={ANNOUNCEMENT_TEXT_MAX} disabled={off} value={text} onChange={e => setText(e.target.value)} placeholder="Merhaba, …" />{text.length > ANNOUNCEMENT_TEXT_MAX - 400 && <span className="ann-count">{(ANNOUNCEMENT_TEXT_MAX - text.length).toLocaleString('tr-TR')} karakter kaldı</span>}</label>
        <fieldset className="ann-target" disabled={off || !!editing}>
          <legend>Kime</legend>
          {editing ? <p className="ann-fixed"><Users size={16} aria-hidden="true" />{editing.audienceText} · {editing.total} işletme</p> : <>
            <div className="ann-target-choices" role="radiogroup" aria-label="Duyurunun hedefi">
              {([['all', 'Tüm işletmeler', `${reachable.filter(b => !b.suspended).length} işletme`], ['packages', 'Şu paketteki işletmeler', 'Bir ya da daha çok paket'], ['selected', 'Seçili işletmeler', 'Listeden seçin']] as const).map(([id, name, sub]) =>
                <button type="button" role="radio" aria-checked={target === id} key={id} className={target === id ? 'selected' : ''} onClick={() => setTarget(id)}><strong>{name}</strong><small>{sub}</small></button>)}
            </div>
            {target === 'packages' && <div className="ann-packages" role="group" aria-label="Paketler">{packages.length ? packages.map(p => <label key={p.id} className={`ann-check${packageIds.includes(p.id) ? ' on' : ''}`}><input type="checkbox" checked={packageIds.includes(p.id)} onChange={() => setPackageIds(toggle(packageIds, p.id))} /><span>{p.name}</span><small>{inPackage(p.id).length} işletme</small></label>) : <p className="muted small">Paket yok.</p>}</div>}
            {target === 'selected' && <div className="ann-pick">
              <div className="ann-pick-head"><label className="ann-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Duyuru için işletme ara" value={query} onChange={e => setQuery(e.target.value)} placeholder="İşletme ara" /></label>
                <span className="ann-pick-tools"><button type="button" className="text-btn" onClick={() => setTenantIds([...new Set([...tenantIds, ...shown.map(b => b.tenantId)])])}>Görünenleri seç</button><button type="button" className="text-btn" disabled={!tenantIds.length} onClick={() => setTenantIds([])}>Temizle</button></span></div>
              <ul className="ann-pick-list" aria-label="İşletmeler">{shown.map(b => <li key={b.tenantId} data-tenant={b.tenantId}><label className={`ann-check${tenantIds.includes(b.tenantId) ? ' on' : ''}`}><input type="checkbox" checked={tenantIds.includes(b.tenantId)} onChange={() => setTenantIds(toggle(tenantIds, b.tenantId))} /><span>{b.name}</span><small>{[b.invoice?.city, b.services?.packageName, b.suspended && 'Askıda'].filter(Boolean).join(' · ')}</small></label></li>)}
                {!shown.length && <li className="muted small ann-pick-none">Bu aramaya uygun işletme yok.</li>}</ul>
            </div>}
          </>}
        </fieldset>
        <label className={`ann-toggle${important ? ' on' : ''}`}><input type="checkbox" role="switch" checked={important} disabled={off} onChange={e => setImportant(e.target.checked)} /><span><strong>Önemli</strong><small>İşletme sahibi bir sonraki girişinde ortada bir pencerede görür ve “Okudum” der. Çalışanların ekranını ve siparişleri hiç durdurmaz.</small></span></label>
        {!editing && emailReady && <label className={`ann-toggle${email ? ' on' : ''}`}><input type="checkbox" checked={email} disabled={off} onChange={e => setEmail(e.target.checked)} /><span><strong>E-postayla da gönder</strong><small>{withEmail ? `E-postası kayıtlı ${withEmail} işletmeye${targets.length - withEmail ? ` gider; ${targets.length - withEmail} işletmenin e-postası yok` : ' gider'}.` : 'Seçilen işletmelerin hiçbirinin e-postası kayıtlı değil.'}</small></span></label>}
        {(tried && problems.length > 0) && <Notice tone="error">{problems.join(' ')}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="ann-form-actions">
          {!editing && <p className="ann-summary"><Users size={16} aria-hidden="true" />Gidecek: <strong>{targets.length} işletme</strong></p>}
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Vazgeç</button>
          <button className="btn primary" disabled={off}>{editing ? <><Check size={17} aria-hidden="true" />{busy ? 'Kaydediliyor…' : 'Değişikliği kaydet'}</> : <><Send size={17} aria-hidden="true" />{busy ? 'Gönderiliyor…' : 'Duyuruyu gönder'}</>}</button>
        </div>
        <p className="muted small">Göndermek, düzeltmek ve geri çekmek doğrulayıcı uygulamadaki kodla onaylanır (10 dakika geçerli).</p>
      </form>
      <aside className="ann-preview" aria-label="Önizleme">
        <h2>İşletmede böyle görünür</h2>
        <div className="ann-preview-frame"><span className="ann-preview-crumb">Destek → Duyurular</span>
          <AnnouncementCard as="div" unread item={{ title: title.trim() || 'Duyurunun başlığı', text: text.trim() || 'Metin burada görünür. Satır araları korunur; https://… ile başlayan adresler bağlantı olur.', important, sentAt: editing?.createdAt ?? new Date().toISOString(), ...(editing ? { editedAt: new Date().toISOString() } : {}) }} />
        </div>
        {important && <p className="muted small"><BellRing size={14} aria-hidden="true" /> İşletme sahibi bunu girişte ortada bir pencerede görür; “Okudum” deyince size “Okudum diyen” olarak yansır. Müdür yalnız Duyurular’da kırmızı noktayla görür.</p>}
      </aside>
    </div>
  </section>;
}

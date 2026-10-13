import { useEffect, useRef, useState } from 'react';
import { AtSign, Bell, BellOff, Building2, CheckCheck, ChevronRight, ClipboardList, CloudDownload, DatabaseBackup, Globe, Headset, Inbox, KeyRound, LifeBuoy, Mail, MailOpen, Monitor, MonitorSmartphone, RotateCcw, Save, Send, Server, Settings2, ShieldAlert, UserRound, WifiOff, type LucideIcon } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { ADMIN, dateTime, seenAgo, type AlertView } from './platformStatus';
import { Chip, IconBtn, SCard, type Tone } from './platformSettingsKit';
import './platform-alerts.css';

/** The bell in the top bar: unread count; opens "Bildirim merkezi". */
export function AlertBell({ unread, onOpen }: { unread: number; onOpen: () => void }) {
  return <button type="button" className="alert-bell" aria-label={unread ? `Bildirim merkezi, ${unread} okunmamış` : 'Bildirim merkezi'} onClick={onOpen}>
    <Bell size={18} />{unread > 0 && <span className="alert-bell-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
  </button>;
}
/**
 * A short two-note chime when a new event arrives while the panel is open (not for what was already there at login).
 * Browsers allow sound only after a click on the page; until then it stays silent.
 */
export function useAlertSound(alerts: AlertView[] | undefined) {
  const seen = useRef<Set<string> | null>(null), audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = () => { try { audio.current ??= new AudioContext(); void audio.current.resume(); } catch { /* no sound */ } };
    document.addEventListener('pointerdown', unlock); return () => document.removeEventListener('pointerdown', unlock);
  }, []);
  useEffect(() => {
    if (!alerts) return;
    // Low-priority reminders ("ikinci yedek yeri ayarlı değil") come quietly.
    const fresh = alerts.filter(a => !a.readAt && a.kind !== 'mail.test' && a.priority !== 'low' && seen.current && !seen.current.has(a.id));
    seen.current = new Set(alerts.map(a => a.id));
    const ctx = audio.current;
    if (!fresh.length || !ctx || ctx.state !== 'running') return;
    for (const [i, freq] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.16;
      o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.15);
    }
  }, [alerts]);
}
/** "Bugün", "Dün", "Daha eski" (Türkiye's calendar day). */
function dayGroup(iso: string, now = Date.now()) {
  const day = (t: number) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  const d = day(Date.parse(iso));
  return d === day(now) ? 'Bugün' : d === day(now - 86400000) ? 'Dün' : 'Daha eski';
}
/**
 * "Bildirim merkezi" (13 Ekim: a plain list, not big cards): newest first, grouped under Bugün / Dün / Daha eski. Each line: the
 * kind's coloured icon, the title and one line of text, small tags (kind, Önemli, the business, when), and on the right one
 * quiet action (open the business, application or ticket; "Uzaktan bağlan" for a remote-support event) with the read mark
 * beside it. Unread lines are tinted with a dot. One about a deleted record (or a ticket gone with it) has no action.
 */
export function AlertCenter({ alerts, names, ticketIds, onOpenBusiness, onOpenTicket, onChanged, onEmail, onOpenSiteLeads }: { alerts: AlertView[]; names: Map<string, string>; ticketIds?: Set<string>; onOpenBusiness: (tenantId: string, tab?: 'support') => void; onOpenTicket: (ticketId: string, tenantId?: string) => void; onChanged: () => void; onEmail?: () => void; onOpenSiteLeads?: () => void }) {
  const [only, setOnly] = useState<'all' | 'unread' | 'important'>('all'), [page, setPage] = useState(1), [error, setError] = useState('');
  const unread = alerts.filter(a => !a.readAt).length, important = alerts.filter(a => alertLevel(a) === 'high').length;
  const rows = alerts.filter(a => only === 'all' || (only === 'unread' ? !a.readAt : alertLevel(a) === 'high')).slice().reverse();
  const pages = Math.max(1, Math.ceil(rows.length / 20)), current = Math.min(page, pages);
  const mark = (body: object) => { setError(''); void api(`${ADMIN}/alerts/read`, body).then(onChanged, e => setError((e as Error).message)); };
  const opened = (a: AlertView, then: () => void) => () => { if (!a.readAt) mark({ ids: [a.id] }); then(); };
  /** The one thing to do with an entry, as a button; none for a record that is gone. */
  const primary = (a: AlertView) => a.ticketId && (!ticketIds || ticketIds.has(a.ticketId)) ? { label: 'Talebi aç', run: opened(a, () => onOpenTicket(a.ticketId!, a.tenantId)) }
    : a.kind === 'site.lead' && onOpenSiteLeads ? { label: 'Talepleri aç', run: opened(a, onOpenSiteLeads) }
    // Uzaktan destek (izin açıldı, oturum): straight to the business's Destek tab, where "Kafeye bağlan" is.
    : a.kind.startsWith('support.') && a.tenantId && names.has(a.tenantId) ? { label: 'Uzaktan bağlan', remote: true, run: opened(a, () => onOpenBusiness(a.tenantId!, 'support')) }
    : a.tenantId && names.has(a.tenantId) ? { label: a.kind.startsWith('application') ? 'Başvuruyu aç' : 'İşletmeyi aç', run: opened(a, () => onOpenBusiness(a.tenantId!)) } : null;
  const shown = rows.slice((current - 1) * 20, current * 20);
  const groups = shown.reduce<[string, AlertView[]][]>((out, a) => { const g = dayGroup(a.at); if (out.at(-1)?.[0] === g) out.at(-1)![1].push(a); else out.push([g, [a]]); return out; }, []);
  const empty = only === 'unread' ? ['Okunmamış bildirim yok.', 'Hepsini okudunuz; yeni bir olay gelince burada görünür ve kısa bir ses çalar.'] : only === 'important' ? ['Önemli bildirim yok.', 'Yedek, bağlantı, güvenlik ve lisans sorunları burada toplanır.'] : ['Henüz bildirim yok.', 'Başvurular, destek talepleri, lisans, bağlantı ve yedek olayları burada görünür.'];
  return <section className="alert-center alert-center-v2" aria-label="Bildirim merkezi">
    <header className="page-head alert-head"><div><div className="alert-title"><h1>Bildirim merkezi</h1><HelpTip title="Bildirim merkezi">{ALERT_TIP}</HelpTip></div>
      <p className="page-lead">{unread ? `${unread} okunmamış bildirim${important ? ` · ${important} önemli` : ''}` : 'Okunmamış bildirim yok.'}</p></div>
      <div className="alert-head-actions">
        <button type="button" className="btn secondary small-btn" disabled={unread === 0} onClick={() => mark({ all: true })}><CheckCheck size={16} aria-hidden="true" />Tümünü okundu işaretle</button>
        {onEmail && <IconBtn icon={Settings2} label="E-posta bildirim ayarları" onClick={onEmail} />}
      </div></header>
    <div className="platform-pills" role="group" aria-label="Bildirim süzgeci">{([['all', 'Tümü', alerts.length], ['unread', 'Okunmamış', unread], ['important', 'Önemli', important]] as const).map(([id, title, n]) => <button type="button" key={id} className={only === id ? 'active' : ''} aria-pressed={only === id} onClick={() => { setOnly(id); setPage(1); }}>{title}<span className="pill-count">{n}</span></button>)}</div>
    {error && <Notice tone="error">{error}</Notice>}
    {groups.map(([group, items]) => <section key={group} className="alert-day" aria-label={group}>
      <h2 className="alert-day-title">{group}<span>{items.length}</span></h2>
      <ul className="alert-list alert-rows">{items.map(a => {
        const kind = alertKind(a.kind), level = alertLevel(a), action = primary(a), business = a.tenantId ? names.get(a.tenantId) : undefined, Icon = kind.icon;
        const remote = action?.label === 'Uzaktan bağlan';
        return <li key={a.id} className={`alert-row ${a.readAt ? 'read' : 'unread'}${a.priority === 'low' ? ' low' : ''}${level === 'high' ? ' high' : ''}`}>
          <span className={`alert-icon ps-tile ${kind.tone}`} aria-hidden="true"><Icon size={18} /></span>
          <div className="alert-body">
            <div className="alert-title-line">{!a.readAt && <i className="alert-dot" aria-hidden="true" />}<strong>{a.title}</strong><span className="visually-hidden">{a.readAt ? '' : ' (okunmamış)'}</span></div>
            <p title={a.text}>{a.text}</p>
            <div className="alert-meta">
              <span className="alert-kind">{kind.label}</span>
              {level === 'high' && <span className="alert-level high">Önemli</span>}
              {a.priority === 'low' && <span className="alert-level low alert-priority">Düşük öncelik</span>}
              {business && <span className="alert-business"><Building2 size={12} aria-hidden="true" />{business}</span>}
              <time dateTime={a.at} title={dateTime(a.at)}>{whenText(a.at)}</time>
            </div>
          </div>
          <div className="alert-actions">
            {action && <button type="button" className={`alert-open${remote ? ' remote' : ''}`} onClick={action.run}>{remote && <MonitorSmartphone size={15} aria-hidden="true" />}{action.label}<ChevronRight size={15} aria-hidden="true" /></button>}
            <IconBtn icon={a.readAt ? Mail : MailOpen} className="alert-read" label={a.readAt ? 'Okunmadı olarak işaretle' : 'Okundu olarak işaretle'} onClick={() => mark(a.readAt ? { ids: [a.id], unread: true } : { ids: [a.id] })} />
          </div>
        </li>;
      })}</ul>
    </section>)}
    {!rows.length && <div className="alert-empty" role="status"><span className="ps-tile green" aria-hidden="true"><BellOff size={22} /></span><strong>{empty[0]}</strong><span>{empty[1]}</span></div>}
    {pages > 1 && <nav className="platform-pager" aria-label="Bildirim sayfaları"><button className="btn secondary small-btn" disabled={current === 1} onClick={() => setPage(current - 1)}>Önceki bildirimler</button><span>Sayfa {current} / {pages}</span><button className="btn secondary small-btn" disabled={current === pages} onClick={() => setPage(current + 1)}>Sonraki bildirimler</button></nav>}
  </section>;
}
const ALERT_TIP = 'Başvurular, web sitesi talepleri, destek talepleri, biten lisanslar, bağlantı, yedek ve güvenlik olayları. Yeni bir olay gelince kısa bir ses çalar. “Önemli” olanlar hemen bakılması gerekenlerdir (yedek, bağlantı, güvenlik, lisans). “Düşük öncelik” olanlar sessiz gelir ve e-postayla gönderilmez. Sağ üstteki dişli e-posta bildirim ayarlarını açar.';
/** What an entry is about: its icon, pastel tile and a short word (server/merkez/alerts.ts AlertKind). */
const KINDS: [RegExp, { icon: LucideIcon; tone: Tone; label: string }][] = [
  [/^application\./, { icon: ClipboardList, tone: 'green', label: 'Başvuru' }],
  [/^site\.lead$/, { icon: Globe, tone: 'blue', label: 'Web talebi' }],
  [/^ticket\./, { icon: LifeBuoy, tone: 'lilac', label: 'Destek' }],
  [/^license\./, { icon: KeyRound, tone: 'amber', label: 'Lisans' }],
  [/^(cafe\.backup|backup\.failing|cafe\.cloud_backup)$/, { icon: DatabaseBackup, tone: 'rose', label: 'Yedek' }],
  [/^cafe\.offline$/, { icon: WifiOff, tone: 'amber', label: 'Bağlantı' }],
  [/^machine\.conflict$/, { icon: Monitor, tone: 'rose', label: 'Bilgisayar' }],
  [/^(owner\.reset|admin\.password_reset|journal\.broken|cafe\.integrity)$/, { icon: ShieldAlert, tone: 'rose', label: 'Güvenlik' }],
  [/^update\./, { icon: CloudDownload, tone: 'blue', label: 'Güncelleme' }],
  [/^support\./, { icon: Headset, tone: 'lilac', label: 'Uzaktan destek' }],
  [/^demo\./, { icon: RotateCcw, tone: 'grey', label: 'Tanıtım' }],
  [/^mail\./, { icon: Mail, tone: 'grey', label: 'E-posta' }],
];
export const alertKind = (kind: string) => KINDS.find(([re]) => re.test(kind))?.[1] ?? { icon: Bell, tone: 'grey' as Tone, label: 'Bildirim' };
/** "Önemli": what needs a look now (a failing backup, a café gone quiet, two computers, changed files, a licence ending, a reset password). */
const HIGH = /^(backup\.failing|cafe\.backup|cafe\.cloud_backup|cafe\.offline|machine\.conflict|journal\.broken|cafe\.integrity|license\.expiring|admin\.password_reset|owner\.reset|update\.failed)$/;
export const alertLevel = (a: AlertView): 'high' | 'normal' | 'low' => a.priority === 'low' ? 'low' : HIGH.test(a.kind) ? 'high' : 'normal';
/** "Az önce", "5 dk önce", "3 saat önce", "Dün", "4 gün önce"; older ones as a date (the exact time is in the tooltip). */
function whenText(iso: string, now = Date.now()) {
  const days = (now - Date.parse(iso)) / 86400000;
  if (days >= 7) return new Date(iso).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
  if (days >= 1 && days < 2) return 'Dün';
  return seenAgo(iso, now);
}

type MailState = { resetReady?: boolean; settings: { enabled: boolean; host: string; port: number; security: 'tls' | 'starttls' | 'none'; user: string; to: string; from: string; adminEmail?: string; hasPassword: boolean; updatedAt: string } | null; queue: { id: string; subject: string; createdAt: string; sentAt?: string; failed: boolean; error?: string; attempts: number }[] };
const PORTS = { tls: 465, starttls: 587, none: 25 } as const;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const MAIL_TIPS = {
  main: 'Başvurular, destek talepleri, biten lisanslar, bağlantı ve yedek sorunları gibi önemli olaylar Bildirim merkezinin yanında e-postayla da gelir. “Düşük öncelik” olanlar e-postayla gönderilmez.',
  server: 'Gmail için: sunucu smtp.gmail.com, bağlantı Güvenli (TLS, 465). STARTTLS seçilirse port 587 olur. “Şifresiz” yalnız bu bilgisayarda çalışan bir aktarıcı içindir.',
  account: 'Kullanıcı Gmail adresinizdir. Şifre, Google hesabınızın güvenlik sayfasında oluşturduğunuz 16 harflik “uygulama şifresi”dir; normal şifre çalışmaz. Şifre Mola Merkez’de şifreli saklanır, ekrana bir daha gelmez.',
  addresses: 'Bildirimler “gideceği adres”e gelir. E-postalar “gönderen adresi”nden, boşsa kullanıcı adresinden gider. Ayarlar kayıtlıyken giriş ekranındaki “Şifremi unuttum → E-postama kod gönder” yönetici e-postasına (boşsa bildirim adresine) 6 haneli kod gönderir; Merkez bir sunucudaysa da çalışır. İki adımlı giriş açıksa telefonunuzdaki kod da istenir.',
};
/**
 * "E-posta bildirimleri": the vendor's own mailbox sends the same important events. Gmail: smtp.gmail.com, 465, the
 * Google account and an "uygulama şifresi" (16 letters, made in the Google account's security page; the normal password
 * does not work). The password is kept sealed in Mola Merkez and never shown again. Three aligned cards (sunucu, hesap,
 * adresler) with the explanations behind ⓘ, then one save bar and the last mails.
 */
export function EmailSettings() {
  const [state, setState] = useState<MailState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [form, setForm] = useState({ enabled: true, host: 'smtp.gmail.com', port: 465, security: 'tls' as 'tls' | 'starttls' | 'none', user: '', password: '', to: '', from: '', adminEmail: '' });
  const load = () => api<MailState>(`${ADMIN}/email`).then(s => { setState(s); if (s.settings) { const { enabled, host, port, security, user, to, from, adminEmail } = s.settings; setForm({ enabled, host, port, security, user, to, from: from ?? '', adminEmail: adminEmail ?? '', password: '' }); } }, e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run(path: string, body: object, done: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(path, body); setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const field = (k: keyof typeof form) => (e: { target: { value: string } }) => { setNotice(''); setForm(f => ({ ...f, [k]: k === 'port' ? Number(e.target.value) || 0 : e.target.value })); };
  // Mails go out "From" the sender address, else the user when it is an e-mail address: one of them is needed.
  const userIsAddress = EMAIL.test(form.user.trim()), needsSender = !userIsAddress;
  const saved = state?.settings, dirty = !!saved && (saved.enabled !== form.enabled || saved.host !== form.host || saved.port !== form.port || saved.security !== form.security || saved.user !== form.user || saved.to !== form.to || (saved.from ?? '') !== form.from || (saved.adminEmail ?? '') !== form.adminEmail || !!form.password);
  // Why "Deneme e-postası gönder" cannot be pressed now, said next to it (not only in a tooltip).
  const testWhy = !saved ? 'Önce ayarları kaydedin; deneme e-postası kayıtlı ayarlarla gönderilir.' : dirty ? 'Değişiklikleri kaydedince deneyebilirsiniz.' : '';
  return <section className="email-settings ps-email" aria-label="E-posta bildirimleri">
    <form onSubmit={e => { e.preventDefault(); void run(`${ADMIN}/email`, { ...form, password: form.password }, 'E-posta ayarları kaydedildi.'); }}>
      <div className="ps-grid">
        <SCard icon={Mail} title="E-posta bildirimleri" sub={saved ? (saved.enabled ? `Açık · ${saved.to}` : 'Kapalı') : 'Henüz ayarlanmadı'} tip={MAIL_TIPS.main} wide
          aside={<>{state?.settings && <Chip tone={state.resetReady ? 'ok' : 'warn'}>{state.resetReady ? 'Şifre sıfırlama açık' : 'Şifre sıfırlama kapalı'}</Chip>}<Chip tone={saved?.enabled ? 'ok' : 'idle'}>{saved?.enabled ? 'Açık' : saved ? 'Kapalı' : 'Ayarlanmadı'}</Chip></>}>
          <label className="checkbox-line ps-switch-line"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />Önemli olayları e-postayla da gönder</label>
        </SCard>
        <SCard icon={Server} title="Sunucu" sub="Gmail: smtp.gmail.com · 465" tip={MAIL_TIPS.server} tipLabel="E-posta sunucusu ayarları" tone="blue">
          <div className="ps-fields ps-mail-server">
            <label className="span-2">E-posta sunucusu (SMTP)<input required maxLength={200} disabled={busy} value={form.host} onChange={field('host')} /></label>
            <label>Bağlantı<select disabled={busy} value={form.security} onChange={e => { const security = e.target.value as typeof form.security; setForm(f => ({ ...f, security, port: PORTS[security] })); }}><option value="tls">Güvenli (TLS)</option><option value="starttls">STARTTLS</option><option value="none">Şifresiz (yerel aktarıcı)</option></select></label>
            <label>Port<input type="number" min={1} max={65535} required disabled={busy} value={form.port} onChange={field('port')} /></label>
          </div>
        </SCard>
        <SCard icon={UserRound} title="Gönderen hesap" sub="Gmail ve uygulama şifresi" tip={MAIL_TIPS.account} tone="lilac">
          <div className="ps-fields">
            <label>Kullanıcı (e-posta adresiniz)<input type="email" maxLength={200} autoComplete="username" disabled={busy} value={form.user} placeholder="ör. ad@gmail.com" onChange={field('user')} /></label>
            <label>Uygulama şifresi<input type="password" maxLength={200} autoComplete="new-password" disabled={busy} value={form.password} placeholder={state?.settings?.hasPassword ? 'Kayıtlı · değiştirmek için yazın' : '16 harf'} onChange={field('password')} /></label>
          </div>
        </SCard>
        <SCard icon={AtSign} title="Adresler" sub="Kime gider, kimden gider" tip={MAIL_TIPS.addresses} tone="amber">
          <div className="ps-fields">
            <label>Bildirimlerin gideceği adres<input type="email" required maxLength={200} disabled={busy} value={form.to} placeholder="ör. ad@ornek.com" onChange={field('to')} /></label>
            <label>Gönderen adresi{needsSender ? ' *' : ''}<input type="email" maxLength={200} required={needsSender && form.enabled} disabled={busy} value={form.from} placeholder={userIsAddress ? `Boşsa ${form.user.trim()}` : 'ör. bildirim@ornek.com'} onChange={field('from')} /></label>
            <label>Yönetici e-postası<input type="email" maxLength={200} disabled={busy} value={form.adminEmail} placeholder={form.to.trim() ? `Boşsa ${form.to.trim()}` : 'Şifre sıfırlama kodu için'} onChange={field('adminEmail')} /></label>
          </div>
          {needsSender && form.enabled && !form.from.trim() && <p className="field-hint">Kullanıcı bir e-posta adresi değil: e-postaların hangi adresten gideceğini “Gönderen adresi”ne yazın.</p>}
        </SCard>
        <div className="ps-save-bar wide">
          <div className="ps-messages">{error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
            {!error && !notice && <span className="muted small">{dirty ? 'Kaydedilmemiş değişiklik var.' : saved ? `Son kayıt: ${dateTime(saved.updatedAt)}` : 'Henüz kaydedilmedi.'}</span>}</div>
          <div className="ps-actions">
            {testWhy && <small id="email-test-why" className="button-why">{testWhy}</small>}
            <button type="button" className="btn secondary small-btn" disabled={busy || !!testWhy} aria-describedby={testWhy ? 'email-test-why' : undefined} onClick={() => void run(`${ADMIN}/email/test`, {}, `Deneme e-postası gönderildi: ${state?.settings?.to ?? ''}`)}><Send size={16} aria-hidden="true" />Deneme e-postası gönder</button>
            <button className="btn primary small-btn" disabled={busy}><Save size={16} aria-hidden="true" />E-posta ayarlarını kaydet</button>
          </div>
        </div>
        {!!state?.queue.length && <SCard icon={Inbox} title="Son e-postalar" sub={`Son ${Math.min(8, state.queue.length)}`} tone="grey" wide>
          <ul className="mail-queue ps-mail-list">{state.queue.slice(0, 8).map(m => <li key={m.id} className={m.failed ? 'bad' : m.sentAt ? 'ok' : 'wait'}>
            <i className="ps-dot" aria-hidden="true" /><span>{m.subject}</span>
            <small className={m.failed ? 'bad' : m.sentAt ? 'ok' : 'muted'}>{m.sentAt ? `Gönderildi · ${dateTime(m.sentAt)}` : m.failed ? `Gönderilemedi: ${m.error ?? ''}` : m.attempts ? `Yeniden denenecek (${m.attempts}. deneme): ${m.error ?? ''}` : 'Sırada'}</small></li>)}</ul>
        </SCard>}
      </div>
    </form>
  </section>;
}

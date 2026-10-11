import { useEffect, useId, useState } from 'react';
import { CalendarClock, Info, Mail, RotateCcw, Send, Trash2 } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { AutoSave, Card, Field, Row, Segmented, Toggle } from './SettingsKit';
import './email-reports.css';

/*
 * Satış ve Raporlar → "Raporları gönder" (owner only; once Ayarlar → İşletme → Raporlar ve e-posta). The café's OWN e-mail account (a Gmail address with its app password,
 * or any SMTP server), where the reports go, and which period reports are made (server/email-reports.ts). The reports are made
 * on this computer and sent from it directly: nothing passes through Mola. The password is never shown again ("Kayıtlı").
 */
type Kind = 'day' | 'week' | 'month' | 'year';
type Security = 'tls' | 'starttls' | 'none';
type Account = { provider: 'gmail' | 'other'; host: string; port: number; security: Security; user: string; from: string; hasPassword: boolean };
type Recent = { key: string; title: string; createdAt: string; mail: 'pending' | 'sent' | 'failed' | 'off'; attempts: number; sentAt?: string; error?: string; nextAt?: string };
type View = {
  account: Account | null; to: string[]; reports: Record<Kind, boolean>;
  status: { lastSentAt: string | null; lastSentTitle: string | null; lastError: string | null; lastErrorTitle: string | null; waiting: number; failed: number; lastTest: { at: string; ok: boolean; error?: string } | null };
  recent: Recent[];
};
const PORTS: Record<Security, number> = { tls: 465, starttls: 587, none: 25 };
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const KINDS: { id: Kind; label: string; line: string }[] = [
  { id: 'day', label: 'Gün sonu raporu', line: 'Her iş günü: gün sonu kapanışından hemen sonra, kapanış yapılmazsa 05:00’te.' },
  { id: 'week', label: 'Haftalık rapor', line: 'Pazartesi–Pazar: Pazar kapanışından sonra ya da Pazartesi 05:00’te.' },
  { id: 'month', label: 'Aylık rapor', line: 'Ayın son günü kapanıştan sonra ya da ertesi sabah 05:00’te.' },
  { id: 'year', label: 'Yıllık rapor', line: '31 Aralık kapanışından sonra ya da 1 Ocak 05:00’te.' },
];
type Form = { provider: 'gmail' | 'other'; host: string; port: number; security: Security; user: string; password: string; from: string; to: string };
const emptyForm: Form = { provider: 'gmail', host: 'smtp.gmail.com', port: 465, security: 'tls', user: '', password: '', from: '', to: '' };
const formOf = (v: View): Form => v.account ? { provider: v.account.provider, host: v.account.host, port: v.account.port, security: v.account.security, user: v.account.user, password: '', from: v.account.from, to: v.to.join(', ') } : { ...emptyForm, to: v.to.join(', ') };
const addresses = (text: string) => text.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
const mailState = (r: Recent) => r.mail === 'sent' ? `Gönderildi · ${when(r.sentAt!)}` : r.mail === 'failed' ? `Gönderilemedi: ${r.error ?? ''}` : r.mail === 'off' ? 'Yalnız Bildirimler’de (e-posta ayarlı değildi)' : r.attempts ? `Yeniden denenecek${r.nextAt ? ` (${time(r.nextAt)})` : ''}: ${r.error ?? ''}` : 'Sırada';

export function EmailReports() {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [switchBusy, setSwitchBusy] = useState(false), [switchError, setSwitchError] = useState('');
  const take = (v: View, refill = true) => { setView(v); if (refill) setForm(formOf(v)); };
  useEffect(() => { void api<View>('/api/staff/email-reports').then(v => take(v)).catch(e => setError((e as Error).message)); }, []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setNotice(''); setForm(f => ({ ...f, [k]: v })); };

  const saved = view?.account, gmail = form.provider === 'gmail';
  const to = addresses(form.to), badTo = to.find(a => !EMAIL.test(a));
  const userIsAddress = EMAIL.test(form.user.trim());
  const problem = !form.user.trim() && gmail ? 'Gmail adresinizi yazın.' : gmail && !userIsAddress ? 'Gmail adresi geçersiz.' : !form.password && !saved?.hasPassword && form.user.trim() ? 'Uygulama şifresini yazın.' : !gmail && !userIsAddress && !EMAIL.test(form.from.trim()) ? 'Kullanıcı adı bir e-posta adresi değil: “Gönderen adresi”ni yazın.' : !to.length ? 'Raporların gideceği en az bir adres yazın.' : badTo ? `Adres geçersiz: ${badTo}` : to.length > 5 ? 'En fazla 5 adres yazılabilir.' : '';
  const dirty = !!view && (JSON.stringify({ ...formOf(view), password: '' }) !== JSON.stringify({ ...form, password: '' }) || !!form.password);
  const testWhy = !saved ? 'Önce hesabı kaydedin; deneme e-postası kayıtlı hesapla gönderilir.' : !view?.to.length ? 'Önce raporların gideceği adresi kaydedin.' : dirty ? 'Değişiklikleri kaydedince deneyebilirsiniz.' : '';

  async function run(path: string, body: object, done: string, refill = true) {
    setBusy(true); setError(''); setNotice('');
    // A test mail or a retry makes the printable PDF and talks to the mail server: up to a minute and a half.
    try { take(await api<View>(path, body, undefined, 90_000), refill); setNotice(done); } catch (e) { setError((e as Error).message); try { take(await api<View>('/api/staff/email-reports'), false); } catch { /* keep */ } } finally { setBusy(false); }
  }
  function save() {
    if (problem) { setError(problem); return; }
    const account = { provider: form.provider, host: gmail ? 'smtp.gmail.com' : form.host.trim(), port: gmail ? 465 : form.port, security: gmail ? 'tls' as const : form.security, user: form.user.trim(), ...(form.password ? { password: form.password } : {}), ...(!gmail && form.from.trim() ? { from: form.from.trim() } : {}) };
    void run('/api/staff/email-reports', { account, to }, 'E-posta hesabı kaydedildi. Şifre bu bilgisayarda şifreli saklanır, ekrana bir daha gelmez.');
  }
  async function toggle(kind: Kind, on: boolean) {
    if (!view) return;
    const reports = { ...view.reports, [kind]: on };
    setView({ ...view, reports }); setSwitchBusy(true); setSwitchError('');
    try { take(await api<View>('/api/staff/email-reports', { reports }), false); } catch (e) { setSwitchError((e as Error).message); setView(view); } finally { setSwitchBusy(false); }
  }

  const s = view?.status;
  return <>
    <Card icon={<Mail size={18} aria-hidden="true" />} title="E-posta hesabı" lead="Raporlar işletmenizin kendi e-posta hesabından, bu bilgisayardan doğrudan gönderilir; Mola’ya ya da başka bir sunucuya uğramaz.">
      {!view && !error ? <p className="settings-card-note" aria-busy="true">E-posta ayarları okunuyor…</p> : <form className="email-reports-form" aria-label="E-posta hesabı" onSubmit={e => { e.preventDefault(); save(); }}>
        <Segmented label="E-posta türü" value={form.provider} disabled={busy} onChange={v => setForm(f => ({ ...f, provider: v, ...(v === 'gmail' ? { host: 'smtp.gmail.com', port: 465, security: 'tls' as const } : {}) }))}
          options={[{ value: 'gmail', label: 'Gmail' }, { value: 'other', label: 'Başka e-posta sunucusu' }]} />
        <div className="email-reports-fields">
          {!gmail && <>
            <Field label="E-posta sunucusu (SMTP)"><input required maxLength={200} disabled={busy} value={form.host} placeholder="ör. mail.alanadi.com" onChange={e => set('host', e.target.value)} /></Field>
            <Field label="Bağlantı"><select className="settings-select" disabled={busy} value={form.security} onChange={e => { const security = e.target.value as Security; setForm(f => ({ ...f, security, port: PORTS[security] })); }}>
              <option value="tls">Güvenli (TLS, 465)</option><option value="starttls">STARTTLS (587)</option><option value="none">Şifresiz (yalnız bu bilgisayardaki aktarıcı)</option></select></Field>
            <Field label="Port"><input type="number" min={1} max={65535} required disabled={busy} value={form.port} onChange={e => set('port', Number(e.target.value) || 0)} /></Field>
          </>}
          <Field label={gmail ? 'Gmail adresi' : 'Kullanıcı adı'} hint={gmail ? 'Raporlar bu adresten gönderilir.' : undefined}><input type={gmail ? 'email' : 'text'} maxLength={200} autoComplete="username" disabled={busy} value={form.user} placeholder={gmail ? 'ör. kafemiz@gmail.com' : ''} onChange={e => set('user', e.target.value)} /></Field>
          <Field label={gmail ? 'Uygulama şifresi' : 'Şifre'} hint={gmail ? 'Normal Gmail şifreniz çalışmaz: Google hesabı → Güvenlik → 2 Adımlı Doğrulama → Uygulama şifreleri’nde oluşturulan 16 harflik şifre.' : undefined}>
            <input type="password" maxLength={200} autoComplete="new-password" disabled={busy} value={form.password} placeholder={saved?.hasPassword ? 'Kayıtlı · değiştirmek için yazın' : ''} onChange={e => set('password', e.target.value)} /></Field>
          {!gmail && <Field label="Gönderen adresi" hint={userIsAddress ? 'Boşsa kullanıcı adresi.' : 'Kullanıcı adı bir e-posta adresi değilse gerekli.'}><input type="email" maxLength={200} disabled={busy} value={form.from} placeholder={userIsAddress ? form.user.trim() : 'ör. rapor@alanadi.com'} onChange={e => set('from', e.target.value)} /></Field>}
          <Field className="wide" label="Raporların gideceği adresler" hint="En fazla 5 adres; aralarına virgül koyun." error={badTo ? `Adres geçersiz: ${badTo}` : undefined}>
            <input type="text" inputMode="email" maxLength={600} disabled={busy} value={form.to} placeholder="ör. sahip@ornek.com, muhasebe@ornek.com" onChange={e => set('to', e.target.value)} /></Field>
        </div>
        {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
        <div className="settings-actions">
          <button className="btn primary" disabled={busy}>{saved ? 'Değişiklikleri kaydet' : 'Hesabı kaydet'}</button>
          <button type="button" className="btn secondary" disabled={busy || !!testWhy} aria-describedby={testWhy ? `${id}-test-why` : undefined} onClick={() => void run('/api/staff/email-reports/test', {}, `Deneme e-postası gönderildi: ${view?.to.join(', ')}`, false)}><Send size={16} aria-hidden="true" />Deneme e-postası gönder</button>
          {saved && <button type="button" className="btn ghost" disabled={busy} onClick={() => void run('/api/staff/email-reports', { account: null }, 'E-posta hesabı kaldırıldı. Raporlar yalnız Bildirimler’e düşer.')}><Trash2 size={15} aria-hidden="true" />Hesabı kaldır</button>}
        </div>
        {testWhy && <small id={`${id}-test-why`} className="settings-field-hint">{testWhy}</small>}
        {s?.lastTest && !busy && <p className="settings-field-hint">Son deneme: {when(s.lastTest.at)} · {s.lastTest.ok ? 'gönderildi' : `gönderilemedi: ${s.lastTest.error ?? ''}`}</p>}
      </form>}
    </Card>
    <Card icon={<CalendarClock size={18} aria-hidden="true" />} title="Hangi raporlar gelsin?" lead="Her rapor ayrıca Bildirimler’e (üst çubuktaki zil) düşer. Bilgisayar o saatte kapalıysa rapor bir sonraki açılışta gönderilir; aynı rapor iki kez gelmez.">
      {view && KINDS.map(k => <Row key={k.id} id={`${id}-${k.id}`} label={k.label} line={k.line}><Toggle id={`${id}-${k.id}`} checked={view.reports[k.id]} disabled={switchBusy} onChange={on => void toggle(k.id, on)} /></Row>)}
      {switchError && <Notice tone="error">{switchError}</Notice>}
      <AutoSave busy={switchBusy} />
      {s && <div className="email-reports-status" role="status">
        <p><strong>Son gönderim:</strong> {s.lastSentAt ? `${when(s.lastSentAt)} · ${s.lastSentTitle}` : 'Henüz yok'}</p>
        {s.lastError && <p className="email-reports-error"><strong>Son hata:</strong> {s.lastError}{s.lastErrorTitle ? ` (${s.lastErrorTitle})` : ''}</p>}
        {s.waiting > 0 && <p>{s.waiting} rapor gönderilmeyi bekliyor.</p>}
        {s.failed > 0 && <button type="button" className="btn secondary" disabled={busy} onClick={() => void run('/api/staff/email-reports/retry', {}, 'Gönderilemeyen raporlar yeniden deneniyor.', false)}><RotateCcw size={15} aria-hidden="true" />Gönderilemeyenleri yeniden dene</button>}
      </div>}
      {!!view?.recent.length && <ul className="email-reports-recent" aria-label="Son raporlar">{view.recent.map(r => <li key={r.key}><span>{r.title}</span><small className={r.mail === 'failed' ? 'bad' : r.mail === 'sent' ? 'ok' : 'muted'}>{mailState(r)}</small></li>)}</ul>}
    </Card>
    <Card icon={<Info size={18} aria-hidden="true" />} title="Raporda neler var?" className="settings-card-quiet">
      <ul className="settings-facts">
        <li>Toplam tahsilat, nakit, kart ve platform; sipariş sayısı; bahşiş, iade, iptal, gider ve elde kalan.</li>
        <li>En çok kazandıran ürünler, kasa kapanışının sonucu (tam, eksik, fazla) ve önceki döneme göre değişim.</li>
        <li>Haftalık, aylık ve yıllık raporlarda personelin çalışma saatleri.</li>
        <li>En başta kısa bir özet: kaç sipariş, ne kadar satış, önceki döneme göre fazla mı az mı.</li>
        <li>Yazdırılabilir rapor e-postanın ekinde gelir (PDF; bu bilgisayarda Edge ya da Chrome yoksa tarayıcıda açılan dosya).</li>
        <li>Müşterilerin adı, telefonu ya da rezervasyonları rapora hiç girmez. Gün 05:00’te başlar, 05:00’te biter.</li>
      </ul>
    </Card>
  </>;
}

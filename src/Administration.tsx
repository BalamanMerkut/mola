import { Banknote, BriefcaseBusiness, Check, ChefHat, HandPlatter, LifeBuoy, Store, X } from 'lucide-react';
import { HelpTip } from './HelpTip';
import { useEffect, useState, type FormEvent } from 'react';
import type { Role } from '../packages/domain/types';
import { api } from './api';
import { remoteMode } from './remoteTransport';
import { Modal, Notice } from './components';
import { ShiftPlanButton, useShiftPlans } from './Shifts';
import { employeeRoles, MANAGER_CAN, MANAGER_CANNOT, roleNames } from '../packages/domain/roles';
import { AssignmentLine, useAssignments } from './AssignmentSettings';

const roleHelp: Record<string, string> = {
  manager: 'İşletme sahibinin yokluğunda günü yönetir: sipariş, ödeme, kasa ve gün sonu, iade, rezervasyon, raporlar, stok, kampanya ve menü. Ayarları, çalışan hesaplarını ve sahibin kasa hareketlerini değiştiremez.',
  waiter: 'Sipariş al, Masalar ve Servise hazır ekranlarını görür. Hazır siparişleri teslim edildi olarak işaretler. Sipariş girer, QR siparişlerini onaylar, otomatik onayı yönetir, nedenini seçerek sipariş ya da ürün iptal eder, masa taşır ve temizlenen masayı hazırlar. Rezervasyonda yalnız misafirin adını görür. Ödeme alamaz, mali raporları göremez.',
  cashier: 'Masalar ekranından ödeme alır, ürün seçerek tahsilat yapar, hesap birleştirir, masa taşır, masayı “Temizlendi” yapar ve gider kaydeder. Sipariş al ekranından masaya ya da masasız sipariş girer, masa içinden sipariş ekler. Sipariş iptal edemez ve QR siparişi onaylamaz (garson ya da mutfak yapar). Mali raporları göremez.',
  kitchen: 'Yalnızca Mutfak ekranından siparişleri görür; hazırlanıyor, hazır ve teslim edildi durumlarını günceller, QR siparişlerini onaylar ve nedenini seçerek sipariş ya da ürün iptal eder. Tahsilat ve mali raporları göremez.'
};
const roleIcons = { owner: Store, manager: BriefcaseBusiness, cashier: Banknote, waiter: HandPlatter, kitchen: ChefHat, support: LifeBuoy };
/** What a Müdür can and cannot do: shown when the owner picks "Müdür" for a new account (packages/domain/roles.ts). */
function ManagerPermissions() {
  return <div className="manager-permissions" aria-label="Müdür yetkileri"><p className="muted small">Müdür, işletme sahibinin yokluğunda günü yönetir.</p><div><h4>Yapabilir</h4><ul>{MANAGER_CAN.map(t => <li key={t}><Check size={14} aria-hidden="true" />{t}</li>)}</ul></div><div><h4>Yapamaz (yalnız işletme sahibi)</h4><ul>{MANAGER_CANNOT.map(t => <li key={t}><X size={14} aria-hidden="true" />{t}</li>)}</ul></div></div>;
}
const roleLine: Record<Role, string> = { owner: 'İşletmenin menüsünü, ekibini ve raporlarını yönetir.', manager: 'Günü yönetir: kasa, iade, raporlar, stok, menü.', cashier: 'Tahsilatları ve masa hesaplarını yönetir.', waiter: 'Sipariş alır, masaları ve teslimatı takip eder.', kitchen: 'Siparişleri hazırlar ve teslim durumunu günceller.', support: 'Mola ekibi; yalnız sahibin izniyle, uzaktan destek için.' };
function EmployeeRoleArt({ role }: { role: Role }) {
  const Icon = roleIcons[role];
  return <div className="employee-role-art"><span>{roleNames[role]}</span><Icon aria-hidden="true" focusable="false" strokeWidth={1.3} /></div>;
}
type Employee = { id: string; username: string; name: string; role: Role; active: boolean; version: number };

export function Employees() {
  const [users, setUsers] = useState<Employee[]>([]); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false); const [reset, setReset] = useState<Employee | null>(null);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'waiter' });
  // Optional planned shift times ("N dk geç" in Personel → Vardiya ve bahşiş), src/Shifts.tsx.
  const shiftPlans = useShiftPlans();
  // Garson ataması (Personel → Personel ayarları): each waiter's sections and tables, read-only here.
  const assignments = useAssignments();
  async function load() { try { setUsers(await api<Employee[]>('/api/staff/users')); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void load(); }, []);
  async function run(path: string, body: unknown, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { await api(path, body); setNotice(message); setAdding(false); setReset(null); setForm({ name: '', username: '', password: '', role: 'waiter' }); await load(); }
    catch (e) { setError((e as Error).message); await load(); } finally { setBusy(false); }
  }
  const valid = form.password.length >= 10 && form.password.length <= 128 && (reset || (form.name.trim() && /^[a-z][a-z0-9._-]{2,31}$/.test(form.username)));
  return <><div className="section-heading"><div><h2>Çalışan hesapları</h2><p className="muted small">Hesap kapatma, yetki ve şifre değişikliği ilgili kişinin açık oturumlarını sonlandırır.</p></div><button className="btn primary" onClick={() => { setError(''); setAdding(true); }}>Çalışan ekle</button></div>{notice && <Notice tone="success">{notice}</Notice>}{error && !adding && !reset && <Notice tone="error">{error}</Notice>}<div className="employee-list">{users.map(u => <article className="panel employee-row" key={u.id}><EmployeeRoleArt role={u.role} /><div className="grow"><div className="employee-card-title"><h3>{u.name}</h3><HelpTip title={`${u.name} yetkileri`}>{u.role === 'owner' ? 'Menü, ayarlar, çalışanlar, masalar ve mali raporları yönetir. Gerektiğinde QR siparişlerini onaylar ve sipariş iptal eder.' : u.role === 'manager' ? `${roleHelp.manager} Yalnız işletme sahibinde kalanlar: ${MANAGER_CANNOT.join('; ')}.` : roleHelp[u.role]}</HelpTip></div><p className="muted small">{u.username} · {u.active ? 'Aktif' : 'Kapalı'}</p><p className="employee-role-description">{roleLine[u.role]}</p>{u.role === 'waiter' && <AssignmentLine data={assignments} userId={u.id} />}</div>{u.role === 'owner' ? <span className="table-pill">İşletme sahibi</span> : <><label>Yetki<select aria-label={`${u.username} yetkisi`} value={u.role} disabled={busy} onChange={e => void run('/api/staff/users/update', { id: u.id, version: u.version, role: e.target.value, active: u.active }, 'Yetki güncellendi. Çalışan yeniden giriş yapmalı.')}>{employeeRoles.map(r => <option value={r} key={r}>{roleNames[r]}</option>)}</select></label><button className="btn secondary small-btn" disabled={busy} onClick={() => { setError(''); setReset(u); setForm(f => ({ ...f, password: '' })); }}>Şifreyi yenile</button><button className="btn secondary small-btn" disabled={busy} onClick={() => void run('/api/staff/users/update', { id: u.id, version: u.version, role: u.role, active: !u.active }, u.active ? 'Hesap kapatıldı.' : 'Hesap yeniden açıldı.')}>{u.active ? 'Hesabı kapat' : 'Hesabı aç'}</button><ShiftPlanButton user={u} plans={shiftPlans.plans} onSaved={() => { void shiftPlans.reload(); setNotice('Vardiya planı kaydedildi.'); }} /></>}</article>)}</div><OpenSessions />
    {(adding || reset) && <Modal title={reset ? `${reset.name} · Şifre yenile` : 'Çalışan ekle'} onClose={() => { if (!busy) { setAdding(false); setReset(null); } }}><form className="modal-body" onSubmit={e => { e.preventDefault(); if (valid) void run(reset ? '/api/staff/users/password' : '/api/staff/users', reset ? { id: reset.id, version: reset.version, password: form.password } : form, reset ? 'Şifre yenilendi. Eski oturumlar kapatıldı.' : 'Çalışan hesabı oluşturuldu.'); }}>{!reset && <><label>Ad soyad *<input aria-label="Ad soyad" value={form.name} maxLength={80} onChange={e => { const name = e.target.value; setForm(f => ({ ...f, name, username: f.username === usernameFrom(f.name) ? usernameFrom(name) : f.username })); }} /></label><label>Kullanıcı adı *<input aria-label="Yeni kullanıcı adı" value={form.username} maxLength={32} autoComplete="off" onChange={e => setForm(f => ({ ...f, username: usernameFrom(e.target.value, true) }))} /></label><p className="muted small">Ad soyaddan kendiliğinden oluşur; isterseniz değiştirebilirsiniz. Türkçe harfler sadeleşir (ş → s).</p><label>Görevi<HelpTip title="Çalışan yetkileri">{roleHelp[form.role]}</HelpTip><select aria-label="Görevi" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>{employeeRoles.map(r => <option value={r} key={r}>{roleNames[r]}</option>)}</select></label>{form.role === 'manager' && <ManagerPermissions />}</>}<label>Yeni şifre *<input aria-label="Yeni şifre" type="password" autoComplete="new-password" value={form.password} minLength={10} maxLength={128} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></label><p className="muted small">En az 10 karakter. Şifre kaydedildikten sonra görüntülenmez.</p>{error && <Notice tone="error">{error}</Notice>}<button className="btn primary full" disabled={busy || !valid}>{busy ? 'Kaydediliyor…' : reset ? 'Şifreyi yenile' : 'Hesabı oluştur'}</button></form></Modal>}</>;
}

type OpenSession = { id: string; name: string; username: string; role: Role; device: string; createdAt: string | null; seenAt: string | null; expiresAt: string; current: boolean };
const clock = (iso: string | null) => iso ? new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
/** "Açık oturumlar": devices signed in to this business. Sessions survive restarts and end each morning at 05:00; the owner can end one now (a lost tablet). */
function OpenSessions() {
  const [list, setList] = useState<OpenSession[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
  async function load() { try { setList(await api<OpenSession[]>('/api/staff/sessions')); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void load(); }, []);
  async function end(s: OpenSession) {
    setBusy(s.id); setError('');
    try { const r = await api<{ current: boolean }>('/api/staff/sessions/end', { id: s.id }); if (r.current) { location.reload(); return; } await load(); }
    catch (e) { setError((e as Error).message); await load(); } finally { setBusy(''); }
  }
  return <section className="panel open-sessions" aria-labelledby="open-sessions-title"><div className="section-heading"><div><h2 id="open-sessions-title">Açık oturumlar</h2><p className="muted small">Cihazlar kapanıp açılsa da girişli kalır; her sabah 05:00'te oturumlar kapanır ve çalışan günde bir kez giriş yapar. Kaybolan bir tableti buradan çıkarabilirsiniz.</p></div><button className="btn secondary small-btn" onClick={() => void load()}>Yenile</button></div>
    {error && <Notice tone="error">{error}</Notice>}
    {list && !list.length && <p className="muted small">Açık oturum yok.</p>}
    {list && list.length > 0 && <ul className="session-list">{list.map(s => <li key={s.id} className="session-row"><div className="grow"><strong>{s.name}</strong> <span className="muted small">{roleNames[s.role]} · {s.device}{s.current ? ' · Bu cihaz' : ''}</span><small className="muted">Giriş: {clock(s.createdAt)} · Son kullanım: {clock(s.seenAt)}</small></div><button className="btn secondary small-btn" disabled={!!busy} aria-label={`${s.name} · ${s.device} oturumunu kapat`} onClick={() => void end(s)}>{busy === s.id ? 'Kapatılıyor…' : 'Oturumu kapat'}</button></li>)}</ul>}
  </section>;
}

export function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [repeat, setRepeat] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  // Uzaktan yönetim (src/remoteTransport.ts): the owner's password changes remotely only with the 6-digit phone code too.
  const remote = remoteMode(), [code, setCode] = useState('');
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/api/staff/password', { currentPassword: current, password: next, ...(remote ? { code } : {}) }); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); setCode(''); } }
  return <form className="panel setup-panel" onSubmit={e => void save(e)}><h2>Şifremi değiştir</h2><p className="muted">Kaydettikten sonra tüm oturumlarınız kapanır. Yeni şifrenizle tekrar giriş yapın.</p><label>Mevcut şifre<input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></label>{remote && <label>Telefon kodu<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}<label>Yeni şifre<input type="password" autoComplete="new-password" value={next} maxLength={128} onChange={e => setNext(e.target.value)} /></label><label>Yeni şifre tekrar<input type="password" autoComplete="new-password" value={repeat} maxLength={128} onChange={e => setRepeat(e.target.value)} /></label><p className="muted small">En az 10 karakter kullanın.</p>{error && <Notice tone="error">{error}</Notice>}<button className="btn primary" disabled={busy || !current || next.length < 10 || next !== repeat}>{busy ? 'Kaydediliyor…' : 'Şifremi değiştir'}</button></form>;
}

/** "Ayşe Yılmaz" → "ayse.yilmaz": usernames accept only plain letters, so Turkish letters are simplified for the owner. */
function usernameFrom(text: string, typing = false) {
  const plain: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u' };
  const value = text.toLocaleLowerCase('tr').replace(/[çğıöşü]/g, c => plain[c]).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, typing ? '' : '.').replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z]+/, '');
  return typing ? value.slice(0, 32) : value.replace(/\.{2,}/g, '.').replace(/\.$/, '').slice(0, 32);
}

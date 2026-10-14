import { useEffect, useId, useState } from 'react';
import { Activity, Check, ChevronRight, ClipboardCheck, Coffee, LayoutGrid, LifeBuoy, LogOut, Plus, Printer, Settings, TabletSmartphone, Volume2, X } from 'lucide-react';
import type { Product, StaffSnapshot } from '../packages/domain/types';
import { sectorNames, sectors, type Sector } from '../packages/domain/sector';
import { api } from './api';
import { Brand, Notice } from './components';
import { businessTheme } from './BusinessTheme';
import { MenuHome } from './Homes';
import { CategoryManagement } from './CategoryManagement';
import { ProductEditor } from './ProductEditor';
import { MenuPreview } from './MenuPreview';
import { TableManagement } from './TableManagement';
import { QrCodesCard } from './SettingsQr';
import { PrinterSettings } from './PrinterSettings';
import { SoundSettings } from './SoundPreview';
import { BusinessProfile } from './BusinessProfile';
import { Card, Row, Toggle } from './SettingsKit';
import { usePreferences } from './SettingsPages';
import { areaName } from './TableAreaPicker';
import './remote-support.css';

/*
 * "Mola destek": the Mola team inside this café's screens, through Mola Merkez (server/support-session.ts). Only the places
 * the café server lets the `support` role reach: menu (with its Kampanyalar tab, as on the café since 10 Ekim), tables and
 * QR, Cihazlar (printers and sounds), non-money settings, diagnostics. No Masalar with bills, no Satış ve Raporlar, no Kasa, no Çalışanlar: those are not here, and the café answers
 * 403 to them anyway. The owner sees every change in Destek → Mola desteği.
 */
type View = 'menu' | 'tables' | 'printers' | 'settings' | 'diagnostics';
const places: { id: View; label: string; icon: typeof Coffee }[] = [
  { id: 'menu', label: 'Menü yönetimi', icon: Coffee }, { id: 'tables', label: 'Masalar ve QR', icon: LayoutGrid },
  { id: 'printers', label: 'Cihazlar', icon: TabletSmartphone }, { id: 'settings', label: 'Ayarlar', icon: Settings }, { id: 'diagnostics', label: 'Tanılama', icon: Activity },
];
type Session = { business: string; since: string; idleMinutes: number; can: string[]; cannot: string[] };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

export function RemoteSupportWorkspace({ data, load, onLogout, loggingOut, connected }: { data: StaffSnapshot; load: () => Promise<void>; onLogout: () => void; loggingOut: boolean; connected: boolean }) {
  const [view, setView] = useState<View>('menu'), [error, setError] = useState(''), [toast, setToast] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null), [categories, setCategories] = useState(false), [preview, setPreview] = useState(false);
  const [tables, setTables] = useState<'add' | 'remove' | null>(null), [session, setSession] = useState<Session | null>(null);
  useEffect(() => { void api<Session>('/api/staff/support-session').then(setSession).catch(() => {}); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);
  const title = places.find(p => p.id === view)!.label;
  return <div className="workspace business-themed support-frame" style={businessTheme(data.theme)}>
    <aside className="sidebar"><Brand />
      <div className="business-pill"><span className="business-avatar">{data.logo ? <img src={data.logo} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} /> : data.name[0]}</span><div><strong>{data.name}</strong><small>Uzaktan destek</small></div></div>
      <div className="support-role"><LifeBuoy size={16} aria-hidden="true" />Mola destek · satış ve para bilgileri kapalı</div>
      <span className="nav-label">DESTEK ALANI</span>
      <nav aria-label="Mola destek bölümleri">{places.map(p => <button key={p.id} className={view === p.id ? 'active' : ''} aria-current={view === p.id ? 'page' : undefined} onClick={() => { setView(p.id); setError(''); }}><p.icon size={19} />{p.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="user-row"><span className="user-avatar">M</span><div><strong>Mola destek</strong><small>{session ? `${clock(session.since)}’den beri bağlı` : 'Bağlı'}</small></div><button className="icon-btn" aria-label="Oturumu kapat" disabled={loggingOut} onClick={onLogout}><LogOut size={17} /></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb">Uzaktan destek <ChevronRight size={13} /><strong>{title}</strong></div><div className="topbar-right"><span className={`connection ${connected ? '' : 'lost'}`}>{connected ? 'Kafeye bağlı' : 'Bağlantı kesildi'}</span><button className="btn secondary small-btn" disabled={loggingOut} onClick={onLogout}><LogOut size={15} />{loggingOut ? 'Kapatılıyor…' : 'Oturumu kapat'}</button></div></header>
      <div className="main-content owner-compact">
        <div className="support-banner" role="status"><span className="remote-live-dot" aria-hidden="true" /><p><strong>Mola ekibi olarak {data.name} kafesine bağlısınız.</strong> Yaptığınız her değişiklik işletme sahibinin Destek → Mola desteği ekranında görünür.{session ? ` ${session.idleMinutes} dakika işlem yapılmazsa oturum kapanır.` : ''}</p></div>
        <div className="page-heading"><div><span className="eyebrow">{data.name}</span><h1>{title}</h1></div>
          {view === 'tables' && <div className="table-management-actions"><button className="btn secondary" onClick={() => setTables('add')}><Plus size={18} />Masa ekle</button><button className="btn secondary" onClick={() => setTables('remove')}>Masa çıkar</button></div>}</div>
        {error && <Notice tone="error">{error}<button className="text-btn" onClick={() => setError('')}>Kapat</button></Notice>}
        {view === 'menu' && <MenuHome data={data} owner={false} reports={false} onAdd={() => setEditing('new')} onEdit={setEditing} onCategories={() => setCategories(true)} onPreview={() => setPreview(true)} onSaved={load} onError={setError} />}
        {view === 'tables' && <><ul className="support-tables" aria-label="Masalar">{data.tables.map(t => <li key={t.id}><span>{t.name}{t.area ? ` · ${areaName(t.area)}` : ''}</span></li>)}</ul><div style={{ marginTop: 16 }}><QrCodesCard data={data} onSaved={() => void load()} page /></div></>}
        {view === 'printers' && <div className="settings-page-stack"><PrinterSettings categories={data.categories} page /><SoundSettings /></div>}
        {view === 'settings' && <SupportSettings data={data} onSaved={() => { void load(); setToast('Ayar kaydedildi.'); }} />}
        {view === 'diagnostics' && <Diagnostics session={session} />}
      </div>
      <footer className="workspace-footer">Mola · uzaktan destek oturumu</footer>
    </main>
    {toast && <div className="toast" role="status"><Check size={18} />{toast}</div>}
    {editing && <ProductEditor revision={data.revision} subcategoriesKey={JSON.stringify(data.subcategories)} categoriesKey={JSON.stringify(data.categories)} liveProduct={editing === 'new' ? undefined : data.products.find(p => p.id === editing.id && p.published !== false)} initial={editing === 'new' ? null : editing} nextCode={String(Math.max(0, ...[...data.products, ...(data.productDrafts ?? [])].map(p => Number(p.code))) + 1)} onClose={() => setEditing(null)} onSave={published => { setEditing(null); setToast(published ? 'Ürün yayınlandı.' : 'Taslak kaydedildi.'); void load(); }} onDelete={() => { setEditing(null); void load(); }} />}
    {categories && <CategoryManagement data={data} onClose={() => setCategories(false)} onSaved={() => void load()} />}
    {preview && <MenuPreview onClose={() => setPreview(false)} />}
    {tables && <TableManagement mode={tables} data={data} onClose={() => setTables(null)} onSaved={message => { setTables(null); setToast(message); void load(); }} />}
  </div>;
}

/** The settings Mola destek may change: business type and look, order and approval, table cleaning. Never money or security. */
function SupportSettings({ data, onSaved }: { data: StaffSnapshot; onSaved: () => void }) {
  const id = useId(), prefs = usePreferences(data, onSaved);
  return <div className="settings-page-stack">
    <Card icon={<ClipboardCheck size={18} aria-hidden="true" />} title="Sipariş ve masa">
      <Row id={`${id}-sector`} label="İşletme türü" line="Menüdeki alt satırı ve simgeyi belirler.">
        <select id={`${id}-sector`} className="settings-select" value={prefs.sector} disabled={prefs.busy} onChange={e => void prefs.persist({ sector: e.target.value as Sector })}>{sectors.map(s => <option key={s} value={s}>{sectorNames[s]}</option>)}</select>
      </Row>
      <Row id={`${id}-payment`} label="Ödeme sırası" line="Yalnız yeni siparişlerde geçerlidir.">
        <select id={`${id}-payment`} className="settings-select" value={prefs.paymentMode} disabled={prefs.busy} onChange={e => void prefs.persist({ paymentMode: e.target.value as 'after_service' | 'before_preparation' })}><option value="after_service">Sonra ödeme · Önce servis</option><option value="before_preparation">Önce ödeme · Sonra hazırlık</option></select>
      </Row>
      <Row id={`${id}-approval`} label="QR siparişlerinde garson onayı" line="Müşteri siparişini hazırlamadan önce garson ya da mutfak kontrol eder.">
        <Toggle id={`${id}-approval`} checked={prefs.waiterApproval} disabled={prefs.busy} onChange={on => void prefs.persist({ waiterApproval: on })} />
      </Row>
      <Row id={`${id}-cleaning`} label="Masa temizliği takibi" line="Boşalan masa, temizlendi denince yeniden sipariş alır.">
        <Toggle id={`${id}-cleaning`} checked={prefs.cleaningEnabled} disabled={prefs.busy} onChange={on => void prefs.persist({ cleaningEnabled: on })} />
      </Row>
      {prefs.error && <Notice tone="error">{prefs.error}</Notice>}
      <p className="settings-field-hint">POS komisyonu, kasa, giderler, güvenlik ve yedek ayarları yalnız işletmede değiştirilir.</p>
    </Card>
    <BusinessProfile data={data} onSaved={onSaved} />
  </div>;
}

type Diag = { version: string; node: string; platform: string; business: string; sector: string; setupCompleted: boolean; counts: { tables: number; products: number; categories: number; printers: number };
  license: { active: boolean; plan: string; service: string; endsAt: string | null; daysRemaining: number } | null; link: { lastContactAt: string | null; offlineDays: number; clockSkewMs: number | null; notice: string | null };
  printers: { name: string; enabled: boolean; kind: string; orders: boolean; bill: boolean }[]; failures: { at: string; method: string; route: string; status: number; code?: string; requestId?: string; frames: string[] }[] };
function Diagnostics({ session }: { session: Session | null }) {
  const [d, setD] = useState<Diag | null>(null), [error, setError] = useState('');
  useEffect(() => { void api<Diag>('/api/staff/support-session/diagnostics').then(setD).catch(e => setError((e as Error).message)); }, []);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!d) return <p className="muted" aria-busy="true">Okunuyor…</p>;
  const facts: [string, string][] = [['Mola sürümü', d.version], ['Node', d.node], ['Sistem', d.platform], ['İşletme türü', sectorNames[d.sector as Sector] ?? d.sector],['Kurulum', d.setupCompleted ? 'Tamamlandı' : 'Bekliyor'],
    ['Masa / ürün / kategori', `${d.counts.tables} / ${d.counts.products} / ${d.counts.categories}`], ['Yazıcı', String(d.counts.printers)],
    ['Lisans', d.license ? `${d.license.active ? 'Etkin' : 'Etkin değil'} · ${d.license.daysRemaining} gün` : '—'],
    ['Mola Merkez’e son bağlantı', d.link.lastContactAt ? new Date(d.link.lastContactAt).toLocaleString('tr-TR') : '—'], ['Saat farkı', d.link.clockSkewMs === null ? '—' : `${Math.round(d.link.clockSkewMs / 1000)} sn`]];
  return <div className="support-diagnostics settings-page-stack">
    <Card icon={<Activity size={18} aria-hidden="true" />} title="Bağlantı ve sürüm"><dl>{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{d.link.notice && <Notice>{d.link.notice}</Notice>}</Card>
    <Card icon={<Printer size={18} aria-hidden="true" />} title="Yazıcılar">{d.printers.length ? <ul className="support-failures">{d.printers.map(p => <li key={p.name}><strong>{p.name}</strong><span>{p.enabled ? 'Açık' : 'Kapalı'} · {p.kind}{p.orders ? ' · sipariş fişi' : ''}{p.bill ? ' · hesap fişi' : ''}</span></li>)}</ul> : <p className="settings-card-note">Yazıcı tanımlı değil.</p>}</Card>
    <Card icon={<X size={18} aria-hidden="true" />} title="Son hatalar">{d.failures.length ? <ul className="support-failures">{d.failures.map((f, i) => <li key={`${f.at}-${i}`}><strong>{new Date(f.at).toLocaleString('tr-TR')} · {f.method} {f.route} · {f.status}{f.code ? ` · ${f.code}` : ''}</strong>{f.frames.slice(0, 3).map(fr => <code key={fr}>{fr}</code>)}</li>)}</ul> : <p className="settings-card-note">Kayıtlı hata yok.</p>}</Card>
    {session && <Card icon={<Volume2 size={18} aria-hidden="true" />} title="Bu oturumda"><div className="remote-rules"><div><h4>Yapabilirsiniz</h4><ul>{session.can.map(t => <li key={t}><Check size={14} aria-hidden="true" />{t}</li>)}</ul></div><div><h4>Göremezsiniz</h4><ul>{session.cannot.map(t => <li key={t}><X size={14} aria-hidden="true" />{t}</li>)}</ul></div></div></Card>}
  </div>;
}

/** The page after the session ended (the owner switched support off, it timed out, or the vendor closed it). */
export function SupportEnded() {
  return <div className="support-ended"><div><Brand /><h1>Destek oturumu kapandı</h1><p>İşletme sahibi izni kapattı, oturum süresi doldu ya da oturumu siz kapattınız. Yeniden bağlanmak için Mola Yönetim’de işletmenin <strong>Destek</strong> bölümünden “Kafeye bağlan”a basın.</p></div></div>;
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plug, Send } from 'lucide-react';
import type { PlatformId } from '../packages/domain/platforms';
import type { PublicExternalOrder } from '../packages/domain/external-orders';
import { api, money, requestId } from './api';
import { Notice } from './components';
import { ExternalInbox } from './ExternalOrders';
import { PlatformBadge, platformColour } from './PlatformBadge';
import { startVisiblePolling } from './visiblePolling';
import './external-orders.css';

// Entegrasyonlar (işletme sahibi): one card per delivery platform, the menu mapping and the latest platform orders.
// Mounted in Ayarlar → Sipariş ve mutfak → Paket platformları and also usable as a page of its own. Credentials go to the café server once and
// never come back; the card only says "kayıtlı".

type Field = { key: string; label: string; secret: boolean; hint?: string };
type Health = { state: 'connected' | 'error' | 'off' | 'starting'; message?: string; lastPollAt?: string };
type PlatformView = { id: PlatformId; name: string; color: string; available: boolean; status?: string; fields: Field[]; saved: string[]; enabled: boolean; autoAccept: boolean; lastOrderAt?: string; health: Health; mapping: { key: string; name: string; productId: string }[]; unmatched: { key: string; name: string }[] };
type Data = { platforms: PlatformView[]; orders: PublicExternalOrder[]; products: { id: string; name: string; category: string }[]; rejectReasons: string[] };

const time = (at?: string) => at ? new Date(at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
function stateOf(p: PlatformView): { label: string; tone: string } {
  if (!p.available) return { label: 'Bağlantı izni bekleniyor', tone: 'waiting' };
  if (!p.enabled) return { label: 'Kapalı', tone: 'off' };
  if (p.health.state === 'connected') return { label: 'Bağlı', tone: 'connected' };
  if (p.health.state === 'error') return { label: `Hata: ${p.health.message ?? 'bilinmiyor'}`, tone: 'error' };
  return { label: 'Bağlanıyor…', tone: 'off' };
}
const stageText: Record<PublicExternalOrder['stage'], string> = { pending: 'Onay bekliyor', accepted: 'Kabul edildi', rejected: 'Reddedildi', cancelled: 'İptal edildi', missed: 'Süresi doldu' };
const orderText = (o: PublicExternalOrder) => o.stage !== 'accepted' ? stageText[o.stage] : o.orderStatus === 'served' ? (o.deliveryType === 'gel-al' ? 'Teslim edildi' : 'Kuryeye teslim edildi') : o.orderStatus === 'ready' ? 'Hazır' : o.orderStatus === 'preparing' ? 'Hazırlanıyor' : 'Mutfakta';

function PlatformCard({ p, busy, onRun }: { p: PlatformView; busy: boolean; onRun: (path: string, body: object, message: string) => Promise<boolean> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const state = stateOf(p), complete = p.fields.every(f => p.saved.includes(f.key));
  async function save(e: FormEvent) { e.preventDefault(); if (await onRun('/api/staff/integrations/credentials', { platform: p.id, values }, `${p.name} bağlantı bilgileri kaydedildi.`)) setValues({}); }
  return <article className="integration-card" style={platformColour({ platform: p.id })} aria-label={p.name}>
    <div className="integration-card-head"><h2>{p.name}</h2><span className={`integration-state ${state.tone}`} role="status">{state.label}</span></div>
    {p.status && <p className="muted">{p.status}</p>}
    <p className="muted">Son sipariş: {p.lastOrderAt ? time(p.lastOrderAt) : 'henüz yok'}</p>
    {p.available && <><div className="row">
      <button className={`btn ${p.enabled ? 'secondary' : 'primary'}`} disabled={busy || (!p.enabled && !complete)} onClick={() => void onRun('/api/staff/integrations/settings', { platform: p.id, enabled: !p.enabled }, p.enabled ? `${p.name} kapatıldı.` : `${p.name} açıldı.`)}>{p.enabled ? 'Kapat' : 'Aç'}</button>
    </div>
    <label className="checkbox-label"><input type="checkbox" checked={p.autoAccept} disabled={busy} onChange={e => void onRun('/api/staff/integrations/settings', { platform: p.id, autoAccept: e.target.checked }, e.target.checked ? 'Otomatik kabul açıldı.' : 'Otomatik kabul kapatıldı.')} />Gelen siparişleri otomatik kabul et</label></>}
    {p.fields.length > 0 && <details open={!complete && p.available}><summary>{complete ? 'Bağlantı bilgileri kayıtlı' : 'Bağla'}</summary>
      <form onSubmit={e => void save(e)}>
        {p.fields.map(f => <label key={f.key}>{f.label}<input type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={values[f.key] ?? ''} placeholder={p.saved.includes(f.key) ? 'kayıtlı' : ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />{f.hint && <small className="muted">{f.hint}</small>}</label>)}
        {!p.available && <p className="muted small">Bilgileri şimdiden kaydedebilirsiniz; bağlantı izni gelince açılır.</p>}
        <div className="row"><button className="btn primary" disabled={busy || !Object.values(values).some(v => v.trim())}>Kaydet</button>{p.saved.length > 0 && <button type="button" className="btn secondary" disabled={busy} onClick={() => void onRun('/api/staff/integrations/credentials/remove', { platform: p.id }, `${p.name} bağlantı bilgileri silindi.`)}>Bilgileri sil</button>}</div>
      </form></details>}
  </article>;
}

/** Deneme platformu: the owner tries the whole flow with a realistic order (no account, no real payment). */
function TestCard({ p, busy, onRun }: { p: PlatformView; busy: boolean; onRun: (path: string, body: object, message: string) => Promise<boolean> }) {
  const [paid, setPaid] = useState('online'), [delivery, setDelivery] = useState<'kurye' | 'gel-al'>('kurye');
  const state = stateOf(p);
  return <article className="integration-card" style={platformColour({ platform: p.id })} aria-label={p.name}>
    <div className="integration-card-head"><h2>{p.name}</h2><span className={`integration-state ${state.tone}`} role="status">{state.label}</span></div>
    <p className="muted">Gerçek bir platform değildir. Örnek sipariş gönderir; onay, mutfak, teslim ve rapor adımlarını gerçek siparişler gibi gösterir.</p>
    <p className="muted">Son sipariş: {p.lastOrderAt ? time(p.lastOrderAt) : 'henüz yok'}</p>
    <div className="row"><button className={`btn ${p.enabled ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => void onRun('/api/staff/integrations/settings', { platform: p.id, enabled: !p.enabled }, p.enabled ? 'Deneme platformu kapatıldı.' : 'Deneme platformu açıldı.')}>{p.enabled ? 'Kapat' : 'Aç'}</button></div>
    <label className="checkbox-label"><input type="checkbox" checked={p.autoAccept} disabled={busy} onChange={e => void onRun('/api/staff/integrations/settings', { platform: p.id, autoAccept: e.target.checked }, e.target.checked ? 'Otomatik kabul açıldı.' : 'Otomatik kabul kapatıldı.')} />Gelen siparişleri otomatik kabul et</label>
    <label>Ödeme<select value={paid} onChange={e => setPaid(e.target.value)}><option value="online">Çevrimiçi ödendi</option><option value="door">Kapıda ödeme</option></select></label>
    <label>Teslim<select value={delivery} onChange={e => setDelivery(e.target.value as 'kurye' | 'gel-al')}><option value="kurye">Kurye</option><option value="gel-al">Gel-al</option></select></label>
    <button className="btn primary" disabled={busy || !p.enabled} onClick={() => void onRun('/api/staff/integrations/test-order', { requestId: requestId(), paidOnline: paid === 'online', deliveryType: delivery }, 'Deneme siparişi geldi. Onay bekliyor.')}><Send size={16} />Deneme siparişi gönder</button>
    {!p.enabled && <p className="muted small">Göndermek için önce “Aç”a basın.</p>}
  </article>;
}

export function Integrations() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await api<Data>('/api/staff/integrations')); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => startVisiblePolling(load, 4000), [load]);
  async function run(path: string, body: object, done: string) {
    setBusy(true); setError(''); setMessage('');
    try { await api(path, body, undefined, 20000); setMessage(done); await load(); return true; }
    catch (e) { setError((e as Error).message); await load(); return false; } finally { setBusy(false); }
  }
  if (!data) return <div className="integration-page">{error ? <Notice tone="error">{error}</Notice> : <p role="status">Entegrasyonlar yükleniyor…</p>}</div>;
  const test = data.platforms.find(p => p.id === 'test'), real = data.platforms.filter(p => p.id !== 'test');
  const mappable = data.platforms.filter(p => p.mapping.length || p.unmatched.length);
  const productName = (id: string) => data.products.find(p => p.id === id)?.name ?? 'Menüden kaldırılmış ürün';
  return <div className="integration-page">
    <Notice><Plug size={16} aria-hidden="true" />Gerçek bağlantı için platformun entegrasyon izni ve API anahtarı gerekir; Mola ekibi yardımcı olur. Siparişler ve bağlantı bilgileri yalnız bu bilgisayarda tutulur.</Notice>
    {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
    <ExternalInbox orders={data.orders.filter(o => o.stage === 'pending' || o.outbox.length > 0)} role="owner" onSaved={() => void load()} />
    <div className="integration-grid">{test && <TestCard p={test} busy={busy} onRun={run} />}{real.map(p => <PlatformCard key={p.id} p={p} busy={busy} onRun={run} />)}</div>
    {mappable.length > 0 && <section className="panel integration-section" aria-labelledby="mapping-title"><h2 id="mapping-title">Menü eşleştirme</h2>
      <p className="muted small">Platformdaki ürünü menünüzdeki ürünle eşleştirin; mutfak ürünü menüdeki adıyla görür. Eşleşmeyen ürünler yine adıyla gelir ve “Menüde eşleşmeyen ürün” uyarısı taşır. Eşleştirme bir sonraki kabulden itibaren geçerlidir.</p>
      {mappable.map(p => <div key={p.id}><PlatformBadge source={{ platform: p.id, externalId: '' }} />
        {[...p.unmatched.map(u => ({ ...u, productId: '' })), ...p.mapping].map(m => <div className="mapping-row" key={m.key}><strong>{m.name}</strong>
          <select aria-label={`${m.name} için menü ürünü`} value={m.productId} disabled={busy} onChange={e => void run('/api/staff/integrations/mapping', { platform: p.id, key: m.key, name: m.name, productId: e.target.value || null }, e.target.value ? `${m.name} eşleştirildi.` : 'Eşleştirme kaldırıldı.')}>
            <option value="">{m.productId ? 'Eşleştirmeyi kaldır' : 'Eşleşmedi · ürün seçin'}</option>{m.productId && !data.products.some(x => x.id === m.productId) && <option value={m.productId}>{productName(m.productId)}</option>}{data.products.map(x => <option key={x.id} value={x.id}>{x.name} · {x.category}</option>)}
          </select></div>)}</div>)}
    </section>}
    <section className="panel integration-section" aria-labelledby="external-history-title"><h2 id="external-history-title">Son platform siparişleri</h2>
      {!data.orders.length && <p className="muted">Henüz platform siparişi yok.</p>}
      <div className="external-history">{data.orders.map(o => <article key={o.id}><div><PlatformBadge source={o} code /><small>{time(o.receivedAt)}</small>{o.customerName && <small>{o.customerName}</small>}<small>{money(o.total)} · {o.paidOnline ? 'çevrimiçi ödendi' : 'kapıda ödeme'}</small></div><span className="stage">{orderText(o)}</span>
        {o.reason && <span className="error-text">Neden: {o.reason}</span>}{o.error && <span className="error-text">Platforma iletilemedi: {o.error}</span>}</article>)}</div>
    </section>
  </div>;
}

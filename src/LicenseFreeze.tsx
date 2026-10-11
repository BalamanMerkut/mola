import { useRef, useState } from 'react';
import type { License } from '../server/license';
import { DateField } from './DateField';
import { api, ApiError, requestId } from './api';
import { Notice } from './components';

const dateText = (value: string) => new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
export function LicenseFreeze({ license, platform = false, onSaved }: { license: License; platform?: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [days, setDays] = useState('30');
  const [start, setStart] = useState(new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10));
  const [note, setNote] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ path: string; body: object } | null>(null);
  async function send(path?: string, body?: object) {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    pending.current ??= { path: path!, body: { requestId: requestId(), ...body } };
    try { await api(pending.current.path, pending.current.body); pending.current = null; setUncertain(false); setOpen(false); setReason(''); setNote(''); setMessage('İşlem kaydedildi.'); onSaved(); }
    catch (e) { const unknown = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(unknown); if (!unknown) pending.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const locked = busy || uncertain;
  const ongoing = license.freezes?.some(f => f.status === 'pending' || (f.status === 'approved' && !f.endedAt && Date.parse(f.until!) > Date.now()));
  return <section className="license-freeze">
    <h3>Hizmeti dondurma</h3>
    <p className="muted small">Yıllık abonelikte 12 ayda bir, en fazla 60 gün. Onaylanan tarihlerde menü ve yeni sipariş kapanır; kalan lisans süresi korunur. Süre sonunda otomatik açılır. Tarihler Türkiye saatidir.</p>
    {!platform && !ongoing && <button className="btn secondary" disabled={locked || license.planMonths !== 12 || license.kind === 'trial' || license.suspended || !license.endsAt || Date.parse(license.endsAt) <= Date.now()} onClick={() => setOpen(!open)}>Dondurma talebi oluştur</button>}
    {!platform && license.planMonths !== 12 && <p className="muted small">Bu işlem için yıllık abonelik kaydı gerekir.</p>}
    {open && <form onSubmit={e => { e.preventDefault(); void send('/api/staff/license/freeze', { reason, startDate: start, days: Number(days) }); }}>
      <div className="form-columns"><label>Başlangıç tarihi *<DateField required disabled={locked} value={start} onChange={v => setStart(v)} /></label><label>Dondurma süresi (gün) *<input type="number" min="1" max="60" required disabled={locked} value={days} onChange={e => setDays(e.target.value)} /></label></div>
      <label>Gerekçe *<textarea required minLength={5} maxLength={1000} disabled={locked} value={reason} onChange={e => setReason(e.target.value)} placeholder="Örneğin: Yeni dükkâna taşınıyoruz." /></label>
      <button className="btn primary" disabled={locked}>Talebi gönder</button>
    </form>}
    {license.freezes?.slice().reverse().map(f => {
      const running = f.status === 'approved' && !f.endedAt && Date.parse(f.until!) > Date.now();
      return <article className="freeze-request" key={f.id}>
        <strong>{f.status === 'pending' ? 'Onay bekliyor' : f.status === 'rejected' ? 'Reddedildi' : f.endedAt || !running ? 'Tamamlandı' : Date.parse(f.startsAt!) > Date.now() ? 'Planlandı' : 'Donduruldu'}</strong>
        <p>{f.startDate.split('-').reverse().join('.')} · {f.days} gün · {f.reason}</p>
        {f.until && <p className="muted small">{f.endedAt ? `Erken bitiş: ${dateText(f.endedAt)}` : `Yeniden açılma: ${dateText(f.until)}`}</p>}
        {f.decision && <p>Destek yanıtı: {f.decision}</p>}
        {platform && f.status === 'pending' && <><label>Yanıt / ret gerekçesi<textarea maxLength={1000} disabled={locked} value={note} onChange={e => setNote(e.target.value)} /></label><div className="table-management-actions"><button className="btn primary" disabled={locked} onClick={() => void send('/api/merkez/admin/freezes/review', { tenantId: license.tenantId, freezeId: f.id, approve: true, note })}>Dondurmayı onayla</button><button className="btn secondary" disabled={locked || !note.trim()} onClick={() => void send('/api/merkez/admin/freezes/review', { tenantId: license.tenantId, freezeId: f.id, approve: false, note })}>Talebi reddet</button></div></>}
        {platform && running && <button className="btn secondary" disabled={locked} onClick={() => void send('/api/merkez/admin/freezes/end', { tenantId: license.tenantId, freezeId: f.id })}>{Date.parse(f.startsAt!) > Date.now() ? 'Planlanan dondurmayı iptal et' : 'Dondurmayı bitir'}</button>}
      </article>;
    })}
    {error && <Notice tone="error">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    {uncertain && <button className="btn primary" disabled={busy} onClick={() => void send()}>Dondurma işlemini yeniden kontrol et</button>}
  </section>;
}

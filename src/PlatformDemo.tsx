import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ADMIN, type Business } from './platformStatus';
import './platform-demo.css';

type Mutate = (path: string, body: object) => Promise<boolean>;
type Sector = 'cafe' | 'restaurant' | 'dessert';
const templates: { id: Sector; name: string }[] = [{ id: 'cafe', name: 'Kafe' }, { id: 'restaurant', name: 'Restoran' }, { id: 'dessert', name: 'Tatlıcı' }];
const time = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
/** Known on purpose (server/signed-notes.ts DEMO_STAFF_PASSWORD): the staff accounts' password after a reset that asks for it. */
const DEMO_PASSWORD = 'Tanitim-2026!';

/**
 * Hizmet → "Tanıtım işletmesi" (vendor only): marks the business as the demo for sales visits ("Tanıtım" label on its staff
 * screens and guest menu) and "Tanıtımı sıfırla": a manual order (typed SIFIRLA) the café carries out at its next heartbeat
 * (backup first, chosen template, table QR codes kept, staff and licence kept) and reports back. Server: server/merkez/demo.ts.
 */
export function DemoSection({ l, disabled, mutate }: { l: Business; disabled: boolean; mutate: Mutate }) {
  const [sector, setSector] = useState<Sector>((l.sector as Sector | undefined) ?? 'cafe'), [password, setPassword] = useState(false), [confirm, setConfirm] = useState('');
  const r = l.demoReset, pending = r?.status === 'pending', typed = confirm.trim().toLocaleUpperCase('tr-TR') === 'SIFIRLA';
  const status = !r ? '' : r.status === 'pending' ? `Sıfırlama işletmenin bilgisayarını bekliyor (istendi: ${time(r.requestedAt)}). Bilgisayar açıksa en geç 10 dakikada yapılır.`
    : r.status === 'done' ? `Son sıfırlama: ${time(r.doneAt ?? r.requestedAt)} · ${templates.find(t => t.id === r.sector)?.name ?? ''} şablonu.`
    : r.status === 'failed' ? `Sıfırlanamadı (${time(r.doneAt ?? r.requestedAt)}): ${r.error ?? 'bilinmeyen sorun'}` : 'Son sıfırlama isteğinin süresi doldu (bilgisayar 3 gün açılmadı); gerekirse yeniden isteyin.';
  return <section className="detail-section demo-section" aria-label="Tanıtım işletmesi">
    <h2>Tanıtım işletmesi</h2>
    <p className="section-lead">Satış ziyaretlerinde gösterilen örnek işletme. Personel ekranlarında ve müşteri menüsünde küçük bir “Tanıtım” etiketi görünür. Hiçbir şey kendiliğinden silinmez; sıfırlama yalnız aşağıdaki düğmeyle ya da işletmenin kendi Ayarlar ekranından yapılır.</p>
    <label className="checkbox-line"><input type="checkbox" checked={!!l.demo} disabled={disabled} onChange={e => void mutate(`${ADMIN}/demo`, { tenantId: l.tenantId, demo: e.target.checked })} />Bu işletme tanıtım işletmesidir</label>
    {l.demo && <form className="demo-reset" aria-label="Tanıtımı sıfırla" onSubmit={e => { e.preventDefault(); if (!typed || pending) return; void mutate(`${ADMIN}/demo/reset`, { tenantId: l.tenantId, sector, demoPassword: password, confirm }).then(ok => { if (ok) setConfirm(''); }); }}>
      <h3 className="detail-subhead">Tanıtımı sıfırla</h3>
      <p className="muted small">Önce işletmenin bilgisayarında yedek alınır. Siparişler, ödemeler, kasa, gider, stok, rezervasyon ve bildirimler silinir; seçilen şablonun menüsü ve 16 masa yüklenir. Masaların QR kodları değişmez: bir kez basılan QR’lar her tanıtımda aynen çalışır. Çalışan hesapları ve lisans kalır.</p>
      <div className="service-packages demo-templates" role="radiogroup" aria-label="Şablon">
        {templates.map(t => <label key={t.id} className={`demo-template${sector === t.id ? ' selected' : ''}`}><input type="radio" name={`demo-sector-${l.tenantId}`} value={t.id} checked={sector === t.id} disabled={disabled || pending} onChange={() => setSector(t.id)} />{t.name}</label>)}
      </div>
      <label className="checkbox-line"><input type="checkbox" checked={password} disabled={disabled || pending} onChange={e => setPassword(e.target.checked)} />Çalışanların şifresi tanıtım şifresi olsun ({DEMO_PASSWORD}; işletme sahibininki değişmez)</label>
      <label>Onaylamak için SIFIRLA yazın<input autoComplete="off" spellCheck={false} maxLength={20} disabled={disabled || pending} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
      <div className="application-actions"><button className="btn delete-catalog small-btn" disabled={disabled || pending || !typed}><RotateCcw size={14} aria-hidden="true" />Tanıtımı sıfırla</button></div>
    </form>}
    {status && <p className={`demo-status ${r?.status ?? ''}`} role="status">{status}</p>}
  </section>;
}

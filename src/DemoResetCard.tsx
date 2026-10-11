import { useEffect, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { Card, Field, Segmented } from './SettingsKit';
import './email-reports.css';

/*
 * Ayarlar → Güvenlik ve yedek → Yedek: "Tanıtım işletmesi", shown only when Mola marked this business as a demo
 * (GET /api/staff/demo). The owner resets it by hand: a template, the demo password option, and typing SIFIRLA. Nothing
 * resets on its own. Server: server/demo-reset.ts (backup first, table QR codes kept, staff and licence kept).
 */
type Sector = 'cafe' | 'restaurant' | 'dessert';
type Demo = { demo: boolean; sector?: Sector; templates?: { id: Sector; name: string }[]; demoPassword?: string };

export function DemoResetCard() {
  const id = useId();
  const [demo, setDemo] = useState<Demo | null>(null), [sector, setSector] = useState<Sector>('cafe'), [password, setPassword] = useState(false), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  useEffect(() => { void api<Demo>('/api/staff/demo').then(d => { setDemo(d); if (d.sector) setSector(d.sector); }).catch(() => setDemo({ demo: false })); }, []);
  if (!demo?.demo) return null;
  const typed = confirm.trim().toLocaleUpperCase('tr-TR') === 'SIFIRLA';
  async function reset() {
    setBusy(true); setError(''); setDone('');
    try {
      const r = await api<{ tables: number; products: number; newQr?: number }>('/api/staff/demo/reset', { sector, demoPassword: password, confirm }, undefined, 120_000);
      setConfirm(''); setDone(`Tanıtım sıfırlandı: ${r.products} ürünlük ${demo?.templates?.find(t => t.id === sector)?.name.toLocaleLowerCase('tr-TR')} menüsü ve ${r.tables} masa hazır. Masaların QR kodları değişmedi; basılı QR’lar aynen çalışır.${r.newQr ? ` ${r.newQr} yeni masanın QR’ını Masalar ve QR’dan yazdırın.` : ''}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Card icon={<RotateCcw size={18} aria-hidden="true" />} title="Tanıtım işletmesi" lead="Bu işletme Mola tarafından tanıtım için ayrıldı. Tanıtımdan sonra her şeyi seçtiğiniz şablona döndürebilirsiniz; bu yalnız siz istediğinizde olur.">
    <form className="demo-reset-form" aria-label="Tanıtımı sıfırla" onSubmit={e => { e.preventDefault(); if (typed) void reset(); }}>
      <ul className="demo-reset-list">
        <li>Önce yedek alınır.</li>
        <li>Siparişler, ödemeler, kasa kapanışları, giderler, stok, rezervasyonlar ve bildirimler silinir.</li>
        <li>Seçilen şablonun menüsü ve masaları yüklenir; masaların QR kodları değişmez, basılı QR’lar aynen çalışır.</li>
        <li>Çalışan hesapları ve lisans kalır.</li>
      </ul>
      <div className="settings-field"><span className="settings-field-label">Şablon</span><Segmented label="Şablon" value={sector} disabled={busy} onChange={setSector} options={(demo.templates ?? []).map(t => ({ value: t.id, label: t.name }))} /></div>
      <label className="demo-reset-check"><input type="checkbox" checked={password} disabled={busy} onChange={e => setPassword(e.target.checked)} />Çalışanların şifresi tanıtım şifresi olsun ({demo.demoPassword}; sizinki değişmez)</label>
      <Field label="Onaylamak için SIFIRLA yazın"><input id={`${id}-confirm`} type="text" autoComplete="off" spellCheck={false} disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
      {error && <Notice tone="error">{error}</Notice>}{done && <Notice tone="success">{done}</Notice>}
      <div className="settings-actions"><button className="btn demo-reset-button" disabled={busy || !typed}><RotateCcw size={16} aria-hidden="true" />{busy ? 'Sıfırlanıyor…' : 'Tanıtımı sıfırla'}</button></div>
    </form>
  </Card>;
}

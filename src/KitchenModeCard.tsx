import { useState, type ReactNode } from 'react';
import { ChefHat, Monitor, ReceiptText } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api } from './api';
import { Notice } from './components';
import { Card } from './SettingsKit';
import { ticketMode } from './KitchenTickets';

/** Ayarlar → Sipariş ve mutfak → Mutfak: "Mutfak nasıl çalışıyor?" (owner; Mola destek too). */
export function KitchenModeCard({ data, onSaved }: { data: StaffSnapshot; onSaved: () => void }) {
  const current = ticketMode(data) ? 'ticket' : 'screen';
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function choose(mode: 'screen' | 'ticket') {
    if (mode === current || busy) return;
    setBusy(true); setError('');
    try { await api('/api/staff/kitchen-mode', { mode }); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const option = (mode: 'screen' | 'ticket', icon: ReactNode, title: string, text: string, example: string) => <button type="button" className={`kitchen-mode-option${current === mode ? ' selected' : ''}`} aria-pressed={current === mode} disabled={busy} onClick={() => void choose(mode)}>
    <span className="kitchen-mode-head">{icon}<strong>{title}</strong>{current === mode && <span className="kitchen-mode-chip">Seçili</span>}</span>
    <span className="kitchen-mode-text">{text}</span>
    <span className="kitchen-mode-example"><em>Örnek:</em> {example}</span>
  </button>;
  return <Card icon={<ChefHat size={18} aria-hidden="true" />} title="Mutfak nasıl çalışıyor?" lead="Siparişler mutfağa ekrandan mı, yazıcıdan çıkan fişle mi ulaşsın?">
    <div className="kitchen-mode-options" role="group" aria-label="Mutfak nasıl çalışıyor?">
      {option('screen', <Monitor size={18} aria-hidden="true" />, 'Ekran', 'Siparişler mutfaktaki tablet ya da ekranda kart olarak görünür. Aşçı “Hazırla” ve “Hazır” der, garsonun telefonuna “Servise hazır” düşer.', 'Masa 5 latte ister → mutfak ekranında kart çıkar → aşçı “Hazır”a basar → garson alıp götürür.')}
      {option('ticket', <ReceiptText size={18} aria-hidden="true" />, 'Fiş', 'Mutfak ekran kullanmaz; her sipariş tek mutfak yazıcısından fiş olarak çıkar ve fiş basılınca “Hazırlanıyor” olur. Garson götürünce masadan “Teslim edildi” der; demezse hesap kapanınca kendiliğinden teslim edilmiş sayılır.', `Masa 5 QR’dan latte ister → ${data.changeSeconds > 0 ? `${data.changeSeconds} sn değiştirme süresi biter →` : ''} mutfakta fiş çıkar → garson götürür.`)}
    </div>
    {current === 'ticket' && <p className="settings-card-note">Fiş basılamazsa kasada ve garson telefonlarında kırmızı uyarı çıkar: “Tekrar bas” ya da “Elle iletildi”. Platform siparişlerinde “Hazır” ve “Kuryeye teslim edildi”yi kasa (kasiyer, müdür, işletme sahibi) masasız şeritten verir. Müşteri süre içinde siparişini değiştirir ya da iptal ederse fiş son hâliyle çıkar ya da hiç çıkmaz; personel siparişleri hemen basılır.</p>}
    {!data.printing?.orders && <Notice>Fiş için önce <strong>Yazıcılar</strong>’dan bir yazıcıyı “Mutfak fişleri” için seçin.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

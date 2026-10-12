import { useEffect, useId, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { ASK_CHOICES, HOLD_CHOICES } from '../packages/domain/reservations';
import { api } from './api';
import { Notice } from './components';
import { AutoSave, Card, Row, Segmented, Toggle } from './SettingsKit';

/*
 * Ajanda ve rezervasyon → Ayarlar (owner; once Ayarlar → Masalar ve QR → Rezervasyon): how many minutes before its time a
 * reservation holds its table (12 Ekim: one setting for "Rezerve" on Masalar and the table QR closing for new guest orders;
 * default 30, "Kapalı" = the QR stays open and the table shows "Rezerve" from the time itself), how long after the time the
 * table asks "Geldi mi?", and whether the cashier and the waiters may write reservations. Saves by itself.
 */
type Settings = { holdMinutes: number; askMinutes: number; roles: ('cashier' | 'waiter')[] };
const minutes = (n: number) => n === 0 ? 'Hemen' : n % 60 === 0 ? `${n / 60} saat` : n > 60 ? `${String(n / 60).replace('.', ',')} saat` : `${n} dk`;

export function ReservationSettingsCard() {
  const id = useId();
  const [saved, setSaved] = useState<Settings | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void api<Settings>('/api/staff/reservations/settings').then(setSaved).catch(e => setError((e as Error).message)); }, []);
  async function save(patch: Partial<Settings>) {
    const before = saved; setBusy(true); setError(''); setSaved(s => s && { ...s, ...patch });
    try { setSaved(await api<Settings>('/api/staff/reservations/settings', patch)); } catch (e) { setError((e as Error).message); setSaved(before); } finally { setBusy(false); }
  }
  const role = (r: 'cashier' | 'waiter', on: boolean) => saved && void save({ roles: on ? [...new Set([...saved.roles, r])] : saved.roles.filter(x => x !== r) });
  const hold = saved?.holdMinutes ?? 30;
  return <Card icon={<CalendarClock size={18} aria-hidden="true" />} title="Rezervasyon" lead="Rezervasyonlar Ajanda ve rezervasyon menüsünde yazılır." tip="Masa ayırma ve etkinlik rezervasyonları Ajanda ve rezervasyon menüsündedir. Hiçbir şey kendiliğinden olmaz: masa yalnız sorar, karar personelindir.">
    {!saved ? (error ? <Notice tone="error">{error}</Notice> : <p className="muted" role="status">Yükleniyor…</p>) : <>
      <Row id={`${id}-hold`} label="Rezervasyondan kaç dakika önce masa ayrılsın" tip="Masa ayırma süresi"
        line={hold ? `Rezervasyon saatinden ${minutes(hold)} önce masada “Rezerve · ad · saat” görünür ve masanın QR'ından yeni sipariş verilemez (Garson çağır ve Hesabı iste açık kalır). Öncesinde masa normal masa gibidir.` : 'Kapalı: masanın QR’ı açık kalır; masada “Rezerve” yalnız rezervasyon saatinde görünür.'} stack>
        <Segmented wide label="Masa ayırma süresi" value={hold} disabled={busy} onChange={v => void save({ holdMinutes: v })} options={HOLD_CHOICES.map(n => ({ value: n, label: n === 0 ? 'Kapalı' : `${minutes(n)} önce` }))} />
      </Row>
      <Row id={`${id}-ask`} label="“Geldi mi?” sorusu" tip="Geldi mi?" line={`Misafir saatinden ${minutes(saved.askMinutes)} sonra gelmediyse masada “Geldi mi?” sorulur: Geldi / 15 dk daha bekle / Gelmedi.`} stack>
        <Segmented wide label="Geldi mi sorusu" value={saved.askMinutes} disabled={busy} onChange={v => void save({ askMinutes: v })} options={ASK_CHOICES.map(n => ({ value: n, label: `${minutes(n)} sonra` }))} />
      </Row>
      <Row id={`${id}-cashier`} label="Kasiyer rezervasyon yazabilir" line="Kapalıyken kasiyer rezervasyonları göremez ve yazamaz; “Geldi mi?” sorusunu yine cevaplar.">
        <Toggle id={`${id}-cashier`} checked={saved.roles.includes('cashier')} disabled={busy} onChange={on => role('cashier', on)} />
      </Row>
      <Row id={`${id}-waiter`} label="Garson rezervasyon yazabilir" line="Kapalıyken garson rezervasyonları göremez ve yazamaz; “Geldi mi?” sorusunu yine cevaplar.">
        <Toggle id={`${id}-waiter`} checked={saved.roles.includes('waiter')} disabled={busy} onChange={on => role('waiter', on)} />
      </Row>
      {error && <Notice tone="error">{error}</Notice>}
      <AutoSave busy={busy} />
    </>}
  </Card>;
}

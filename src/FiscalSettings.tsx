import { useEffect, useId, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { FISCAL_NOTE } from '../packages/domain/fiscal';
import { api } from './api';
import { Notice } from './components';
import { Card, Row, Toggle } from './SettingsKit';

/*
 * Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa: "Yazar kasa yardımcısı" (owner). Off by default since 11 Ekim (the owner turns it on); when on, after every payment the
 * payment window says what to enter on the yazar kasa per KDV department, and the gün sonu compares it with the Z raporu.
 * "Ödemeden sonra 'Girildi' onayı iste" (off by default) keeps the card until the cashier presses "Girildi". Its own small
 * card (POST /api/staff/cash/settings), so it can sit in any Ayarlar layout.
 */
type Fiscal = { fiscalHelper: boolean; fiscalConfirm: boolean };

export function FiscalSettings() {
  const id = useId();
  const [saved, setSaved] = useState<Fiscal | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void api<Fiscal>('/api/staff/cash/settings').then(s => setSaved({ fiscalHelper: s.fiscalHelper === true, fiscalConfirm: !!s.fiscalConfirm })).catch(e => setError((e as Error).message)); }, []);
  if (!saved) return error ? <Notice tone="error">{error}</Notice> : <p className="muted" role="status">Yükleniyor…</p>;
  async function save(patch: Partial<Fiscal>) {
    const before = saved;
    setBusy(true); setError(''); setSaved(s => s && { ...s, ...patch });
    try { const next = await api<Fiscal>('/api/staff/cash/settings', patch); setSaved({ fiscalHelper: next.fiscalHelper === true, fiscalConfirm: !!next.fiscalConfirm }); }
    catch (e) { setError((e as Error).message); setSaved(before); } finally { setBusy(false); }
  }
  return <Card icon={<ReceiptText size={18} aria-hidden="true" />} title="Yazar kasa yardımcısı" lead={FISCAL_NOTE}>
    <Row id={`${id}-on`} label="Yazar kasa yardımcısı" line={saved.fiscalHelper ? 'Açık: her ödemeden sonra yazar kasaya girilecek tutar KDV departmanına göre gösterilir; gün sonunda Z raporuyla karşılaştırılır.' : 'Kapalı: ödeme penceresinde ve gün sonunda yazar kasa bilgisi çıkmaz.'}
      help="Örnek: Masa 4 hesabı ₺467 nakit ödedi; hesapta ₺347'lik kahve ve tatlı (%10) ile ₺120'lik bira (%20) var. Ödemeden sonra “Yazar kasaya girin: %10 departman → ₺347,00 · %20 departman → ₺120,00 · Ödeme: Nakit” yazar. Kasiyer bu tutarları yazar kasada ilgili departman tuşuyla girip fişi keser. Gün sonunda kasa kapanışında “Yazar kasa karşılaştırması” çıkar; Z raporunun toplamını yazarsanız fark gösterilir. Online ödenen platform siparişlerinde tutar gösterilmez: fiş/fatura kuralını mali müşavirinize sorun.">
      <Toggle id={`${id}-on`} checked={saved.fiscalHelper} disabled={busy} onChange={on => void save({ fiscalHelper: on })} />
    </Row>
    <Row id={`${id}-ask`} label="Ödemeden sonra “Girildi” onayı iste" tip="“Girildi” onayı" line={!saved.fiscalHelper ? 'Yalnız yazar kasa yardımcısı açıkken kullanılır.' : saved.fiscalConfirm ? 'Açık: kart, kasiyer “Girildi”ye basana kadar ekranda (küçülerek) kalır.' : 'Kapalı: “Girildi” isteğe bağlıdır; kart ✕ ile kapanır.'}
      help="Açıkken ödeme kartındaki ✕ yerine “Sonra” çıkar ve kartı yalnız küçültür; “Girildi”ye basılınca kart kapanır. Gün sonunda “Girildi” işaretlenmemiş ödemeler listelenir: Z raporu tutmazsa hangi hesabın fişinin kesilmediğini bulmak kolaylaşır. Kapalıyken de kasiyer isterse “Girildi”ye basabilir.">
      <Toggle id={`${id}-ask`} checked={saved.fiscalHelper && saved.fiscalConfirm} disabled={busy || !saved.fiscalHelper} onChange={on => void save({ fiscalConfirm: on })} />
    </Row>
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

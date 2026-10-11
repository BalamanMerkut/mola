import { useEffect, useId, useState } from 'react';
import { ReceiptText, Undo2 } from 'lucide-react';
import { DEFAULT_CASHIER_REFUND_DAY, DEFAULT_CASHIER_REFUND_MAX } from '../packages/domain/refund-rules';
import { api, money, moneyError, moneyInput, parseMoney } from './api';
import { Notice } from './components';
import { AutoSave, Card, Row } from './SettingsKit';

/*
 * Kasa ve giderler → Kasa ayarları → Kasiyer yetkileri: what the cashier may do alone with money (owner only, its own small part so it
 * can sit in any Ayarlar layout). "Kasiyer iadesi": the largest refund and the daily refund total (default ₺150 / ₺500; 0 = the
 * cashier refunds nothing alone and sends requests). "Kasiyerin nakit gider uyarısı": one expense above "Tek seferde", and the
 * cashier's cash expenses of one cash day above "Gün içinde toplam" (once, again when it doubles). Saves itself on leaving a
 * box (POST /api/staff/cash/settings); a value that cannot be saved says why under it.
 */
type Limits = { cashierRefundMax: number; cashierRefundDay: number; expenseAlert: number | null; expenseDayAlert: number | null };
type Field = keyof Limits;
const text = (kurus: number | null | undefined) => kurus === null || kurus === undefined ? '' : moneyInput(kurus);
/** Refund limits may be 0 ("kasiyer iade yapamaz"); expense alerts are off when empty. */
const nullable: Field[] = ['expenseAlert', 'expenseDayAlert'];

export function CashierLimitsSettings() {
  const id = useId();
  const [saved, setSaved] = useState<Limits | null>(null), [values, setValues] = useState<Record<Field, string>>({ cashierRefundMax: '', cashierRefundDay: '', expenseAlert: '', expenseDayAlert: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const fill = (s: Limits) => setValues({ cashierRefundMax: text(s.cashierRefundMax), cashierRefundDay: text(s.cashierRefundDay), expenseAlert: text(s.expenseAlert), expenseDayAlert: text(s.expenseDayAlert) });
  useEffect(() => { void api<Limits>('/api/staff/cash/settings').then(s => { const v = { cashierRefundMax: s.cashierRefundMax ?? DEFAULT_CASHIER_REFUND_MAX, cashierRefundDay: s.cashierRefundDay ?? DEFAULT_CASHIER_REFUND_DAY, expenseAlert: s.expenseAlert ?? null, expenseDayAlert: s.expenseDayAlert ?? null }; setSaved(v); fill(v); }).catch(e => setError((e as Error).message)); }, []);
  if (!saved) return error ? <Notice tone="error">{error}</Notice> : <p className="muted" role="status">Yükleniyor…</p>;
  const problem = (f: Field) => { const v = values[f].trim(); return !v ? (nullable.includes(f) ? '' : 'Bir tutar yazın; kapatmak için 0.') : moneyError(v, { min: nullable.includes(f) ? 1 : 0 }); };
  const value = (f: Field) => values[f].trim() === '' ? null : parseMoney(values[f]);
  async function leave(f: Field) {
    if (problem(f) || !saved) return;
    const v = value(f);
    if (v === saved[f]) return;
    const before = saved;
    setBusy(true); setError(''); setSaved({ ...saved, [f]: v });
    try { const next = await api<Limits>('/api/staff/cash/settings', { [f]: v }); setSaved({ cashierRefundMax: next.cashierRefundMax, cashierRefundDay: next.cashierRefundDay, expenseAlert: next.expenseAlert ?? null, expenseDayAlert: next.expenseDayAlert ?? null }); }
    catch (e) { setError((e as Error).message); setSaved(before); fill(before); } finally { setBusy(false); }
  }
  const box = (f: Field, placeholder?: string) => { const p = problem(f); return <>
    <div className="settings-number-control"><input id={`${id}-${f}`} inputMode="decimal" placeholder={placeholder} aria-describedby={`${id}-${f}-help${p ? ` ${id}-${f}-error` : ''}`} value={values[f]} disabled={busy} aria-invalid={!!p} onChange={e => setValues(v => ({ ...v, [f]: e.target.value }))} onBlur={() => void leave(f)} /><span aria-hidden="true">TL</span></div>
    {p && <small className="field-error" id={`${id}-${f}-error`} role="alert">Kaydedilmedi: {p}</small>}</>; };
  const max = saved.cashierRefundMax, day = saved.cashierRefundDay;
  return <>
    <Card icon={<Undo2 size={18} aria-hidden="true" />} title="Kasiyer iadesi" lead="Kasiyer küçük iadeleri kendisi yapar; büyüğü için size istek gelir." tip="Kasiyer küçük iadeleri kasa şeridindeki “İade” ile (Masalar ya da Kasa → Bugün) kendisi yapar. Sınırı aşan iade için “Sahibe iade isteği gönder” der; istek size Bildirimler'de gelir, siz Kasa ve giderler → İadeler'den yaparsınız. Kasiyerin her iadesi Bildirimler'e düşer ve gün sonu kasasında “Kasiyer iadesi” diye ayrı satırda görünür. Siz ve Müdür sınırsız iade yaparsınız. Platform (Yemeksepeti, Getir…) ödemelerinin iadesini platform yapar.">
      <Row id={`${id}-cashierRefundMax`} label="Kasiyerin yapabileceği en yüksek iade (TL)" tip="En yüksek iade" line={max > 0 ? `Kasiyer ${money(max)} ve altındaki bir iadeyi kendisi yapar.` : 'Kasiyer iade yapamaz; her iade için size istek gönderir.'} help={`Örnek: ${money(15000)} yazarsanız kasiyer bir çay (${money(3500)}) ya da bir tatlı iadesini kendisi yapar; ${money(20000)} tutan iade için size istek gönderir. 0 yazarsanız kasiyer hiç iade yapmaz.`}>
        {box('cashierRefundMax')}
      </Row>
      <Row id={`${id}-cashierRefundDay`} label="Kasiyerin bir günde yapabileceği toplam iade (TL)" tip="Günlük iade toplamı" line={`Bir kasa gününde (05:00–05:00) kasiyerin iadeleri toplam ${money(day)} tutarını geçemez; fazlası için size istek gelir.`} help={`Örnek: ${money(50000)} yazarsanız kasiyer gün içinde ${money(15000)} tutan üç iade yapabilir (${money(45000)}); dördüncüsü için size istek gönderir.`}>
        {box('cashierRefundDay')}
      </Row>
    </Card>
    <Card icon={<ReceiptText size={18} aria-hidden="true" />} title="Kasiyerin nakit gider uyarısı" lead="Kasiyer nakit gider yazınca size ne zaman haber verilsin?" tip="İki ayrı kontrol var; ikisi de boşsa uyarı yok, giderler yine raporda görünür. Kasiyer gideri düzeltemez ya da silemez; bunu yalnız siz Kasa ve giderler → Giderler'den yaparsınız.">

      <Row id={`${id}-expenseAlert`} label="Tek seferde (TL)" tip="Tek seferde" line={saved.expenseAlert ? `Kasiyer bir seferde ${money(saved.expenseAlert)} tutarından fazla nakit gider yazınca hemen haber alırsınız.` : 'Boş: tek gidere bakılmaz.'} help={`Örnek: ${money(20000)} yazarsanız kasiyer ${money(25000)} tutan “Acil süt alımı” giderini yazınca Bildirimler'e düşer. Bildirimde tutar, açıklama, kaydeden ve saat yazar.`}>
        {box('expenseAlert', 'Kapalı')}
      </Row>
      <Row id={`${id}-expenseDayAlert`} label="Gün içinde toplam (TL)" tip="Gün içinde toplam" line={saved.expenseDayAlert ? `Kasiyerin aynı kasa günündeki nakit giderleri toplam ${money(saved.expenseDayAlert)} tutarını geçince bir kez, toplam bunun iki katını geçince bir kez daha haber alırsınız.` : 'Boş: günlük toplama bakılmaz.'} help={`Örnek: ${money(50000)} yazarsanız kasiyer gün içinde 3 × ${money(19000)} (${money(57000)}) yazınca bir kez haber alırsınız; toplam ${money(100000)} tutarını geçerse bir kez daha. Tek seferde sınırına takılmayan küçük giderleri de böylece görürsünüz.`}>
        {box('expenseDayAlert', 'Kapalı')}
      </Row>
    </Card>
    {error && <Notice tone="error">{error}</Notice>}
    {/* The page's own "Değişiklikler kendiliğinden kaydedilir." stays the one at the bottom; here only while saving. */}
    {busy && <AutoSave busy />}
  </>;
}

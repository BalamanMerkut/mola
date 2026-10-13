import { useEffect, useId, useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { CASH_GUARD_KEYS, cashGuardText, type CashGuard, type CashGuardKey } from '../packages/domain/cash';
import { api, money } from './api';
import { Notice } from './components';
import { PlaceLink } from './Moved';
import { AutoSave, Card, Row, Toggle } from './SettingsKit';
import './cash-shifts.css';

/*
 * Kasa ve giderler → Kasa ayarları → Kasa güvenliği (14 Ekim, sahibin kararı: "hepsini yap ama esnek olsun, isteyen açsın";
 * packages/domain/cash.ts CashGuard). Six switches, each on its own, all off until turned on; "Önerilenleri aç" turns them all
 * on. Each row says what it is tied to: the yazar kasa helper (Sayımı sıkılaştır), card payments (POS), the vardiya devri,
 * Bugün (money to receive). The cashier's expense alerts already exist in Kasiyer yetkileri: shown here with a link.
 */
type View = { guard?: CashGuard; fiscalHelper: boolean; expenseAlert: number | null; expenseDayAlert: number | null };
/** What each switch is tied to, in a line under it. */
function tie(key: CashGuardKey, v: View): ReactNode {
  if (key === 'strictCount') return v.fiscalHelper ? 'Yazar kasa yardımcısı açık: sayan kişi Nakit / Kart ayrımını görmez.'
    : <>Yazar kasa yardımcısı kapalı: yalnız geri alma kuralı çalışır. <PlaceLink to={{ view: 'cash', tab: 'settings', part: 'card' }}>Kart ve yazar kasa</PlaceLink></>;
  if (key === 'posRequired') return 'Yalnız kartla ödeme alınan vardiyalarda istenir; nakit günde sorulmaz.';
  if (key === 'handoverCount') return 'Gün içinde “Vardiya devri” yapılınca devreye girer; devir yapmıyorsanız bir şey değişmez.';
  if (key === 'receipt') return 'Teslim bekleyen para Kasa ve giderler → Bugün’de görünür. Gün sonunu siz yaptıysanız sorulmaz.';
  if (key === 'methodAlert') return 'Ödeme türünü yalnız siz ve Müdür değiştirebilir; sizin değişikliğiniz bildirilmez.';
  return 'Kasada bırakılan tutar ertesi sabah bu sayımla karşılaştırılır.';
}
export function CashGuardSettings() {
  const id = useId();
  const [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void api<View>('/api/staff/cash/settings').then(setView, e => setError((e as Error).message)); }, []);
  async function save(guard: CashGuard) {
    const before = view;
    setBusy(true); setError(''); setView(v => v && { ...v, guard: { ...v.guard, ...guard } });
    try { setView(await api<View>('/api/staff/cash/settings', { guard })); }
    catch (e) { setError((e as Error).message); setView(before); } finally { setBusy(false); }
  }
  if (!view) return error ? <Notice tone="error">{error}</Notice> : <p className="muted" role="status">Yükleniyor…</p>;
  const on = CASH_GUARD_KEYS.filter(k => view.guard?.[k]).length;
  const alerts = view.expenseAlert || view.expenseDayAlert ? [view.expenseAlert && `tek seferde ${money(view.expenseAlert)}`, view.expenseDayAlert && `gün içinde ${money(view.expenseDayAlert)}`].filter(Boolean).join(' · ') : 'Kapalı';
  return <div className="settings-form cash-guard">
    <Card icon={<ShieldCheck size={18} aria-hidden="true" />} title="Kasa güvenliği" aside={<span className={`settings-page-state${on ? '' : ' muted'}`}>{on}/{CASH_GUARD_KEYS.length} açık</span>}
      lead="Kasiyerin parayı alıp sayımı fazla yazmasına karşı önlemler. Her biri ayrı açılır; kapalıyken hiçbir şey değişmez."
      tip="Kör sayım tek başına yetmez: parayı alan kişi ne kadar aldığını bildiği için sayımı o kadar fazla yazabilir. Açık, ancak parayı başka biri gerçekten sayınca ortaya çıkar. Bu önlemler o sayımı zorunlu ve izlenebilir yapar: kasadan çıkan parayı sizin saymanız, sabah ve vardiya devrinde kör sayım, kartlı günlerde POS toplamı. Bildirimler zile, açıksa telefonunuza ve e-posta raporuna gelir.">
      {on < CASH_GUARD_KEYS.length && <div className="cash-guard-all"><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void save(Object.fromEntries(CASH_GUARD_KEYS.map(k => [k, true])) as CashGuard)}>Önerilenleri aç</button><small className="muted">Altısını birden açar; sonra istediğinizi kapatabilirsiniz.</small></div>}
      {CASH_GUARD_KEYS.map(k => <Row key={k} id={`${id}-${k}`} label={cashGuardText[k].title} line={<>{view.guard?.[k] ? cashGuardText[k].on : cashGuardText[k].off}<small className="cash-guard-tie">{tie(k, view)}</small></>}>
        <Toggle id={`${id}-${k}`} checked={!!view.guard?.[k]} disabled={busy} onChange={value => void save({ [k]: value })} />
      </Row>)}
      <div className="settings-row cash-guard-linked"><div className="settings-row-copy"><div className="settings-row-title"><span>Kasiyer gider uyarıları</span></div><p>{alerts}. Kasiyerin kasadan yazdığı gider sınırı aşınca size bildirilir.</p></div>
        <PlaceLink to={{ view: 'cash', tab: 'settings', part: 'limits' }}>Kasiyer yetkileri’nde ayarla</PlaceLink></div>
    </Card>
    {error && <Notice tone="error">{error}</Notice>}<AutoSave busy={busy} />
  </div>;
}

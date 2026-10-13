import { useEffect, useId, useState, type ReactNode } from 'react';
import { Banknote, Clock3, Gift, Info } from 'lucide-react';
import { tipRuleNames, type TipRule } from '../packages/domain/cash';
import { api, moneyError, moneyInput, parseMoney } from './api';
import { Modal, Notice } from './components';
import { AutoSave, Card, Row, Segmented, Toggle } from './SettingsKit';
// Vardiya per role (Garson · Kasiyer · Mutfak · Müdür), its own small card part: src/ShiftRoleSettings.tsx.
import { ShiftRoleSettings } from './ShiftRoleSettings';
import { CashierLimitsSettings } from './CashierLimitsSettings';
// "Yazar kasa yardımcısı" (on/off, "Girildi" onayı): its own card, src/FiscalSettings.tsx.
import { FiscalSettings } from './FiscalSettings';
import { CashGuardSettings } from './CashGuardSettings';
import { TimeField } from './TimeField';
// Hizmet paketi: vardiya takibi and bahşiş paylaşımı are "Vardiya, bahşiş ve personel raporu" (tips at payment stay core).
import { LockedRow, usePackage } from './FeatureLock';

/*
 * The owner's cash and staff settings, each a sub-tab of its home (10 Ekim düzeni, docs/BILGI_MIMARISI_ONERISI.md):
 * - Kasa ve giderler → Kasa ayarları: view 'closing' (Gün sonu: the closing time that reminds the counter, the difference
 *   that needs a note, "Kart bahşişini kasadan nakit öde"), 'card' (Kart ve yazar kasa: the POS rate, `commission`, one of
 *   the business preferences, and the yazar kasa helper), 'limits' (Kasiyer yetkileri: the cashier's refund and expense
 *   limits and "Kim ne yapabilir").
 * - Personel → Personel ayarları: view 'shifts' (Vardiya: vardiya takibi, per role) and 'tips' (Bahşiş: how tips are shared).
 * Saves by itself (POST /api/staff/cash/settings).
 */
type Settings = { expenseAlert: number | null; closingTime: string | null; differenceNote: number; shiftTracking: boolean; tipRule: TipRule; tipCashOut?: boolean };
const tl = (kurus: number | null) => kurus === null ? '' : moneyInput(kurus);
/** "Kim ne yapabilir": the money rights of the cashier, the manager and the owner, in one ⓘ bubble. */
const WHO = "Kasiyer kasadan yalnız gider ve para bozdurma kaydeder; “Sahip aldı”, “Bankaya yatırıldı” gibi çıkışları yalnız siz kaydedersiniz. Müdür kasada kasiyer gibidir (gider, para bozdurma, gün sonu). Kasiyer küçük iadeleri sınırlar içinde kendisi yapar; daha büyüğü için size istek gönderir. Gider tutarını yalnız siz düzeltip silebilirsiniz; önceki hâli kaydında kalır. Kapanış kayıtları değişmez; sonradan bulunan fark için Kasa ve giderler → Kapanışlar'dan düzeltme eklersiniz.";

export type CashSettingsView = 'closing' | 'card' | 'limits' | 'guard' | 'shifts' | 'tips';
export function CashSettingsPage({ view, commission }: { view: CashSettingsView; commission?: ReactNode }) {
  const id = useId(), shiftsOn = usePackage().has('shifts');
  const [saved, setSaved] = useState<Settings | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [alert, setAlert] = useState(''), [note, setNote] = useState(''), [time, setTime] = useState('');
  useEffect(() => { void api<Settings>('/api/staff/cash/settings').then(s => { setSaved(s); setAlert(tl(s.expenseAlert)); setNote(tl(s.differenceNote)); setTime(s.closingTime ?? ''); }).catch(e => setError((e as Error).message)); }, []);
  async function save(patch: Partial<Settings> & { shiftStart?: 'next' | 'now' }) {
    // Switches and choices show the new value at once; a refused change puts the saved one back.
    const before = saved;
    setBusy(true); setError(''); setSaved(s => s && { ...s, ...patch });
    try { const next = await api<Settings>('/api/staff/cash/settings', patch); setSaved(next); }
    catch (e) { setError((e as Error).message); setSaved(before); if (before) { setAlert(tl(before.expenseAlert)); setNote(tl(before.differenceNote)); setTime(before.closingTime ?? ''); } }
    finally { setBusy(false); }
  }
  // K-B (9 Ekim, sahibin kararı): turned on while people are working, it asks first; "Bir sonraki girişte" is chosen.
  const [asking, setAsking] = useState<{ count: number; when: 'next' | 'now' } | null>(null);
  async function turnOn() {
    setError('');
    let count = 0;
    try { count = (await api<{ count: number }>('/api/staff/shifts/working')).count; } catch { /* asked as if nobody were signed in */ }
    if (count > 0) setAsking({ count, when: 'next' }); else await save({ shiftTracking: true });
  }
  // Kasa güvenliği (14 Ekim): its own page, src/CashGuardSettings.tsx.
  if (view === 'guard') return <CashGuardSettings />;
  if (!saved) return error ? <Notice tone="error">{error}</Notice> : <p className="muted" role="status">Yükleniyor…</p>;
  const noteValue = note.trim() === '' ? 0 : parseMoney(note);
  // These save by themselves on leaving the field; a value that cannot be saved says so right under it ("Kaydedilmedi").
  const noteProblem = note.trim() ? moneyError(note, { min: 0 }) : '';
  const unsaved = (problem: string, id: string) => problem ? <small className="field-error" id={id} role="alert">Kaydedilmedi: {problem}</small> : null;
  const footer = <>{error && <Notice tone="error">{error}</Notice>}<AutoSave busy={busy} /></>;
  // Vardiya and Bahşiş: the service "Vardiya, bahşiş ve personel raporu" (tips at payment stay core).
  if ((view === 'shifts' || view === 'tips') && !shiftsOn) return <form className="settings-form" aria-label={view === 'shifts' ? 'Vardiya' : 'Bahşiş'} onSubmit={e => e.preventDefault()}><LockedRow feature="shifts" title={view === 'shifts' ? 'Vardiya takibi' : 'Bahşiş paylaşımı'} line="Ödemede bahşiş yazmak açık kalır; vardiya kodu ve bahşiş dağıtımı bu hizmetle." /></form>;
  if (view === 'shifts') return <form className="settings-form" aria-label="Vardiya" onSubmit={e => e.preventDefault()}>
    <Card icon={<Clock3 size={18} aria-hidden="true" />} title="Vardiya takibi" lead="Çalışan vardiyayı kasadaki tek kullanımlık kodla başlatır." tip="Açıkken seçtiğiniz görevlerdeki çalışan girişten sonra kasadaki ekranda görünen tek kullanımlık kodla vardiyayı başlatır; kod girilmeden işlem yapılamaz.">
      <Row id={`${id}-shifts`} label="Vardiya takibi" line={saved.shiftTracking ? 'Açık. Kod, kasiyer ya da sizin Masalar ekranınızda “Vardiya kodu”nda görünür.' : 'Kapalı: hiçbir şey değişmez; raporda saatler tahmini görünür.'} help="Kod 6 hanelidir ve bir kez kullanılınca yenilenir, eski kodun fotoğrafı işe yaramaz. Aynı kişi 5 kez yanlış yazarsa 5 dakika bekler. Gün içinde açarken çalışan varsa kodun bir sonraki girişlerinde mi, hemen mi isteneceği sorulur. Gün sonu yalnız kapanışı yapanın vardiyasını bitirir; diğerleri kendi “Vardiyayı bitir”iyle ya da 05:00'te kendiliğinden biter. İşletme sahibi vardiya başlatmaz. Planlanan saatleri Personel → Çalışanlar'dan girebilirsiniz.">
        <Toggle id={`${id}-shifts`} checked={saved.shiftTracking} disabled={busy} onChange={on => void (on ? turnOn() : save({ shiftTracking: false }))} />
      </Row>
      <ShiftRoleSettings tracking={saved.shiftTracking} />
    </Card>
    {footer}
    {asking && <Modal title="Vardiya takibi açılsın mı?" onClose={() => setAsking(null)}><div className="modal-body shift-start-ask">
      <p>Şu an {asking.count} kişi çalışıyor. Kod bir sonraki girişlerinde mi istensin, hemen mi?</p>
      <div className="cash-segment" role="radiogroup" aria-label="Kod ne zaman istensin">
        {([['next', 'Bir sonraki girişte'], ['now', 'Hemen']] as const).map(([value, label]) => <button type="button" role="radio" key={value} aria-checked={asking.when === value} className={asking.when === value ? 'selected' : ''} onClick={() => setAsking({ ...asking, when: value })}>{label}</button>)}
      </div>
      <p className="muted small">{asking.when === 'next' ? 'Şu an çalışanlar işine devam eder; çıkış yapıp yeniden girdiklerinde (en geç yarın sabah) kasadaki kodu yazarlar.' : 'Şu an çalışanların ekranı hemen “Vardiyayı başlat”a geçer; kasadaki kodu yazmadan işlem yapamazlar.'}</p>
      <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setAsking(null)}>Vazgeç</button><button type="button" className="btn primary" disabled={busy} onClick={() => { const when = asking.when; setAsking(null); void save({ shiftTracking: true, shiftStart: when }); }}>Vardiya takibini aç</button></div>
    </div></Modal>}
  </form>;
  if (view === 'tips') return <form className="settings-form" aria-label="Bahşiş" onSubmit={e => e.preventDefault()}>
    <Card icon={<Gift size={18} aria-hidden="true" />} title="Bahşiş" lead="Ödeme alırken isteğe bağlı bahşiş yazılabilir." tip="Bahşiş satış değildir; raporlarda ve gün sonu kasasında ayrı satırda görünür. Her çalışanın payı Personel → Vardiya ve bahşiş → Bahşiş'te görünür.">
      <Row id={`${id}-tips`} label="Dağıtım" line="Her çalışanın payı Personel → Vardiya ve bahşiş → Bahşiş'te buna göre hesaplanır." stack>
        <Segmented wide label="Bahşiş dağıtımı" value={saved.tipRule} disabled={busy} onChange={v => void save({ tipRule: v })} options={(Object.keys(tipRuleNames) as TipRule[]).map(k => ({ value: k, label: tipRuleNames[k], title: k === 'orders' ? 'Masanın siparişlerini alan çalışana; QR siparişli masalarda o gün çalışanlara eşit' : k === 'hours' ? 'O gün çalışılan süreye göre' : 'O gün çalışanlara eşit' }))} />
      </Row>
    </Card>
    {footer}
  </form>;
  if (view === 'card') return <div className="settings-form">{commission}<FiscalSettings />{footer}</div>;
  // Kasiyer iadesi and the cashier's cash expense alerts (tek seferde / gün içinde toplam): src/CashierLimitsSettings.tsx.
  if (view === 'limits') return <div className="settings-form"><CashierLimitsSettings /><Card icon={<Info size={18} aria-hidden="true" />} title="Kim ne yapabilir" className="settings-card-quiet settings-card-compact" tip={WHO} lead="Kasiyer, müdür ve sizin kasadaki yetkileriniz: gider, para bozdurma, iade, kapanış." /></div>;
  return <form className="settings-form" aria-label="Gün sonu" onSubmit={e => e.preventDefault()}>
    <Card icon={<Banknote size={18} aria-hidden="true" />} title="Gün sonu kasası" lead="Kasa Masalar ekranındaki “Gün sonu” ile sayılır." tip="Kasiyer ya da siz Masalar ekranındaki “Gün sonu” ile kasayı sayarsınız. Sayan kişi beklenen tutarı sayımdan sonra görür. Her kapanış farkı size Bildirimler'de gelir.">
      <Row id={`${id}-time`} label="Kapanış saati" line="Bu saatten sonra son hesap da kapanınca kasada “Gün sonunu yap” hatırlatması çıkar. Boş bırakılırsa hatırlatılmaz." help="Hatırlatma ertesi sabah 05:00'e kadar geçerlidir. Kasa kapanmadan sabah olursa “Dünün kasası kapanmadı” uyarısı çıkar.">
        <TimeField id={`${id}-time`} aria-describedby={`${id}-time-help`} value={time} disabled={busy} onChange={setTime} onCommit={t => { const v = t || null; if (v !== saved.closingTime) void save({ closingTime: v }); }} />
      </Row>
      <Row id={`${id}-note`} label="Not isteyen fark (TL)" tip="Not isteyen fark" line="Sayılan ile beklenen arasındaki fark bunu aşarsa kapanış için açıklama yazılır." help="Her kapanış farkı size Bildirimler'de gelir; bu sınır yalnız açıklama zorunluluğunu belirler. 0 yazarsanız her farkta not istenir.">
        <div className="settings-number-control"><input id={`${id}-note`} inputMode="decimal" aria-describedby={`${id}-note-help${noteProblem ? ` ${id}-note-error` : ''}`} value={note} disabled={busy} aria-invalid={!!noteProblem} onChange={e => setNote(e.target.value)} onBlur={() => { if (!noteProblem && Number.isFinite(noteValue) && noteValue !== saved.differenceNote) void save({ differenceNote: noteValue }); }} /><span aria-hidden="true">TL</span></div>
        {unsaved(noteProblem, `${id}-note-error`)}
      </Row>
      {/* 8 Ekim, sahibin kararı (K2): off by default; nothing changes until the owner turns it on. */}
      <Row id={`${id}-tipcash`} label="Kart bahşişini kasadan nakit öde" line={saved.tipCashOut ? 'Açık: kartla bahşişte “Bahşiş garsona kasadan nakit verildi mi?” diye sorulur.' : 'Kapalı: kartla alınan bahşiş garsona ayrıca ödenir; kasa değişmez.'} help="Açıksa ödeme penceresinde kartla bahşiş yazıldığında tek soru çıkar. Evet derseniz kasadan “Kart bahşişi nakit ödendi” çıkışı kendiliğinden yazılır ve gün sonunda beklenen nakitten düşer. Hayır derseniz bahşiş Personel → Vardiya ve bahşiş → Bahşiş'te garsona ödenecek olarak kalır.">
        <Toggle id={`${id}-tipcash`} checked={!!saved.tipCashOut} disabled={busy} onChange={on => void save({ tipCashOut: on })} />
      </Row>
    </Card>
    {footer}
  </form>;
}

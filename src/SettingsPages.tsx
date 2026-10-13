import { lazy, useEffect, useId, useState, type ReactNode } from 'react';
import { Building2, Check, ClipboardCheck, Mail, Cloud, CreditCard, DatabaseBackup, Download, FolderOpen, Footprints, HardDrive, KeyRound, LayoutGrid, Info, MapPin, Minus, Plus, ShieldAlert, ShieldCheck, ShieldOff, TabletSmartphone, Usb } from 'lucide-react';
import { PlaceLink } from './Moved';
import { PhonePairing } from './PhonePairing';
import QRCode from 'qrcode';
import { cloudLine, type CloudView } from './cloudBackupText';
import type { StaffSnapshot } from '../packages/domain/types';
import { sectorNames, sectors, type Sector } from '../packages/domain/sector';
import { api, requestId } from './api';
import { commissionRateProblem, parseCommissionRate, rateText } from '../packages/domain/commission';
import { CommissionHint } from './CommissionHint';
import { Notice } from './components';
import { AutoSave, Card, Columns, Count, EmptyState, Row, Toggle } from './SettingsKit';
import { BusinessProfile } from './BusinessProfile';
import { QrCodesCard, qrBase, useNetwork } from './SettingsQr';
import { PrinterSettings } from './PrinterSettings';
import { SoundSettings } from './SoundPreview';
import { DeviceChecks } from './DeviceChecks';
import { NetworkProfileNotice, useNetworkProfile, type NetworkProfileView } from './NetworkProfileNotice';
import { PhotoStorage } from './PhotoStorage';
import { ReportSecurity } from './ReportSecurity';
import { OwnerLockSettings } from './OwnerLock';
import { RemoteAdminSettings } from './RemoteAdminSettings';
import { DeferredPanel } from './DeferredPanel';
import { openRail } from './FirstSteps';
import { TableLayout } from './TableLayout';
import { UpdateSettings } from './UpdateBanner';
// "Mutfak nasıl çalışıyor?" (Ekran / Fiş; Sipariş ve mutfak → Mutfak): its own card, src/KitchenModeCard.tsx.
import { KitchenModeCard } from './KitchenModeCard';
// The "Tanıtım işletmesi" card (Güvenlik ve yedek → Yedek): its own file.
import { DemoResetCard } from './DemoResetCard';
// Hizmet paketi: a closed service's card is a faded row that opens the package card (src/FeatureLock.tsx).
import { LockedRow, openFeatureLock, usePackage } from './FeatureLock';

// The integrations agent owns this screen; Ayarlar only gives it a place.
const Integrations = lazy(() => import('./Integrations').then(module => ({ default: module.Integrations })));

type PaymentMode = 'after_service' | 'before_preparation';
type Values = { sector: Sector; paymentMode: PaymentMode; cleaningEnabled: boolean; waiterApproval: boolean; seconds: string; commission: string };
export type Preferences = Values & {
  set: (patch: Partial<Values>) => void;
  /** Saves now with these changes on top (switches and choices at once, numbers when leaving the box). */
  persist: (patch?: Partial<Values>) => Promise<void>;
  /** Numbers save when the box is left, and only when they changed. */
  saveNumbers: () => void;
  busy: boolean; error: string;
};
const fromData = (data: StaffSnapshot): Values => ({ sector: data.sector ?? 'cafe', paymentMode: data.paymentMode ?? 'after_service', cleaningEnabled: data.cleaningEnabled ?? false, waiterApproval: data.waiterApproval ?? false, seconds: String(data.changeSeconds), commission: data.commissionBps === null ? '' : rateText(data.commissionBps) });
/** A POS rate typed the Turkish way ("1,79", also "1.79"); '' when fine or empty. */
export const commissionProblem = (text: string) => commissionRateProblem(text);

/**
 * The business preferences that save themselves (/api/staff/settings). Kept by the Ayarlar shell, not by one page, so a
 * number typed on one page is not lost when the owner opens another topic.
 */
export function usePreferences(data: StaffSnapshot, onSaved: () => void): Preferences {
  const [values, setValues] = useState<Values>(() => fromData(data));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saved = fromData(data);
  async function persist(patch: Partial<Values> = {}) {
    const next = { ...values, ...patch };
    setValues(next); setBusy(true); setError('');
    try {
      await api('/api/staff/settings', { sector: next.sector, paymentMode: next.paymentMode, cleaningEnabled: next.cleaningEnabled, waiterApproval: next.waiterApproval, changeSeconds: Number(next.seconds), commissionBps: parseCommissionRate(next.commission) });
      onSaved();
    } catch (e) {
      // Show the saved values again so the screen never pretends an unsaved change is in effect.
      setError((e as Error).message); setValues(saved);
    } finally { setBusy(false); }
  }
  return { ...values, busy, error, persist, set: patch => setValues(v => ({ ...v, ...patch })), saveNumbers: () => { if (values.commission !== saved.commission && commissionProblem(values.commission)) return; if (values.seconds !== saved.seconds || values.commission !== saved.commission) void persist(); } };
}

export { Card } from './SettingsKit';
function Saving({ prefs }: { prefs: Preferences }) {
  return <>{prefs.error && <Notice tone="error">{prefs.error}</Notice>}<AutoSave busy={prefs.busy} /></>;
}

export function BusinessPage({ data, prefs, onSaved }: { data: StaffSnapshot; prefs: Preferences; onSaved: () => void }) {
  const id = useId();
  return <>
    <Card icon={<Building2 size={18} aria-hidden="true" />} title="Genel">
      <Row id={`${id}-sector`} label="İşletme türü" line="Kafe, restoran ya da tatlıcı / pastane. Menüdeki alt satırı ve simgeyi belirler." help="Tür yalnız bir etikettir: müşteri menüsündeki alt satırı ve menü simgesini belirler. Değiştirmek menünüzü yeniden yüklemez, ürünlerinize ve diğer ayarlarınıza dokunmaz. Başlangıç menüsü yalnız ilk kurulumda yüklenir.">
        <select id={`${id}-sector`} className="settings-select" aria-describedby={`${id}-sector-help`} value={prefs.sector} disabled={prefs.busy} onChange={e => void prefs.persist({ sector: e.target.value as Sector })}>
          {sectors.map(s => <option key={s} value={s}>{sectorNames[s]}</option>)}
        </select>
      </Row>
      <Saving prefs={prefs} />
    </Card>
    <BusinessProfile data={data} onSaved={onSaved} />
  </>;
}

/** Turning "değiştirip iptal edebilsin" on starts with a minute. */
const DEFAULT_CHANGE_SECONDS = 60;
export function OrdersPage({ data, prefs, onSaved }: { data: StaffSnapshot; prefs: Preferences; onSaved: () => void }) {
  const id = useId(), changeOn = Number(data.changeSeconds) > 0;
  const [auto, setAuto] = useState(!!data.autoApproveQr), [autoBusy, setAutoBusy] = useState(false), [autoError, setAutoError] = useState('');
  useEffect(() => { if (!autoBusy) setAuto(!!data.autoApproveQr); }, [data.autoApproveQr, data.approvalVersion]);
  async function automatic(enabled: boolean) {
    setAuto(enabled); setAutoBusy(true); setAutoError('');
    try { await api('/api/staff/approval-mode', { requestId: requestId(), version: data.approvalVersion ?? 0, enabled }); onSaved(); }
    catch (e) { setAuto(!!data.autoApproveQr); setAutoError((e as Error).message); onSaved(); } finally { setAutoBusy(false); }
  }
  return <form className="settings-form" aria-label="Sipariş tercihleri" onSubmit={e => { e.preventDefault(); prefs.saveNumbers(); }}>
    <Columns left={<>
    <Card icon={<ClipboardCheck size={18} aria-hidden="true" />} title="Sipariş ve ödeme" lead="Yeni siparişler mutfağa ne zaman geçsin?" tip="Ödeme sırası ve değiştirme süresi yeni siparişlerin mutfağa ne zaman geçeceğini belirler. Değişiklikler yalnız yeni siparişlerde geçerlidir.">
      <Row id={`${id}-payment`} label="Ödeme sırası" line="Yeni siparişlerde ödemenin ne zaman alınacağını belirler." help="Önce ödeme seçilirse sipariş mutfakta hemen görünür; bu siparişin tamamı ödenmeden hazırlanamaz. Tutar bazlı kısmi ödeme ürünlere dağıtılmaz; ürün seçerek ödeme ile tamamı ödenen sipariş hazırlanabilir. Teslimi mutfak veya garson işaretler. Tercih yalnızca yeni siparişlerde geçerlidir.">
        <select id={`${id}-payment`} className="settings-select" aria-describedby={`${id}-payment-help`} value={prefs.paymentMode} disabled={prefs.busy} onChange={e => void prefs.persist({ paymentMode: e.target.value as PaymentMode })}>
          <option value="after_service">Sonra ödeme · Önce servis</option>
          <option value="before_preparation">Önce ödeme · Sonra hazırlık</option>
        </select>
      </Row>
      {/* On / off with the seconds only while on; a saved 0 (older setups) reads as off. */}
      <Row id={`${id}-change`} label="Müşteri siparişini değiştirip iptal edebilsin" tip="Değişiklik ve iptal süresi" line={changeOn ? 'Sipariş verildikten sonra bu süre içinde müşteri değiştirebilir ya da iptal edebilir.' : 'Kapalı: sipariş hemen mutfağa geçer; iptal için müşteri personelden ister.'} help="Açıkken bu süre boyunca mutfak hazırlığı başlatamaz; müşteri siparişini kendi telefonundan değiştirebilir veya iptal edebilir. Kapalıyken yeni siparişler ödeme ve onay koşulları sağlandığında hemen hazırlanabilir; müşterinin iptal isteğini mutfak onaylar. Değişiklik yalnız yeni siparişlerde geçerlidir.">
        <Toggle id={`${id}-change`} checked={changeOn} disabled={prefs.busy} onChange={on => void prefs.persist({ seconds: on ? String(DEFAULT_CHANGE_SECONDS) : '0' })} />
      </Row>
      {changeOn && <Row id={`${id}-seconds`} label="Sipariş değişiklik süresi (saniye)" tip="Değişiklik süresi" line="1 ile 600 saniye arası. Önerilen 60 saniye; 0 yazarsanız kapanır." help="Müşterinin siparişi değiştirebileceği ya da iptal edebileceği süre. Süre dolunca sipariş mutfakta hazırlanabilir.">
        <div className="settings-number-control"><input id={`${id}-seconds`} type="number" min="1" max="600" inputMode="numeric" aria-describedby={`${id}-seconds-help`} value={prefs.seconds} onChange={e => prefs.set({ seconds: e.target.value })} onBlur={prefs.saveNumbers} /><span aria-hidden="true">saniye</span></div>
      </Row>}
    </Card>
    <Card icon={<Check size={18} aria-hidden="true" />} title="QR siparişlerinin onayı" lead="QR menüden gelen sipariş mutfaktan önce kontrol edilsin mi?">
      <Row id={`${id}-approval`} label="QR siparişlerinde garson onayı" tip="Garson onayı" line="Müşteri siparişini hazırlamadan önce garson ya da mutfak kontrol eder." help="Yeni QR siparişleri onaydan geçer: garson ya da mutfak onaylar (işletme sahibi ve müdür de onaylayabilir), kasiyer yalnız durumu görür. Otomatik onayı siz, müdür ya da garson açabilir; mutfak açamaz. Tercihi değiştirmek daha önce onay bekleyen siparişleri otomatik kabul etmez.">
        <Toggle id={`${id}-approval`} checked={prefs.waiterApproval} disabled={prefs.busy} onChange={on => void prefs.persist({ waiterApproval: on })} />
      </Row>
      <Row id={`${id}-auto`} label="Otomatik onay" line={data.waiterApproval ? 'Açıksa yeni QR siparişleri kontrol edilmeden mutfağa gider.' : 'Yalnız garson onayı açıkken kullanılır.'} help="Açıksa bu işletmeye yeni gelen QR siparişleri kontrol edilmeden mutfağa gider. Önceden bekleyen siparişler için ayrıca onay gerekir. İşletmedeki bütün garson ve mutfak ekranlarına uygulanır. Garson ve müdür de kendi ekranından açıp kapatabilir; mutfak açıp kapatamaz, yalnız tek tek onaylar ya da reddeder.">
        <Toggle id={`${id}-auto`} checked={!!data.waiterApproval && auto} disabled={autoBusy || prefs.busy || !data.waiterApproval} onChange={on => void automatic(on)} />
      </Row>
      {autoError && <Notice tone="error">{autoError}</Notice>}
    </Card>
    <ReminderCard data={data} onSaved={onSaved} />
    </>} right={<>
    {/* Kept as a list: tests/browser/takeaway.spec.ts reads "Masasız sipariş" here. */}
    <Card icon={<Info size={18} aria-hidden="true" />} title="Ayarı olmayanlar" className="settings-card-quiet settings-card-compact" tip="Bunlar her işletmede aynı çalışır; açıp kapatılacak bir ayarları yoktur.">
      <ul className="settings-facts settings-facts-row">
        <li>Masasız sipariş ve sepetteki “Paketlensin” kutusu her zaman açık.</li>
        <li>İndirim ve kampanyalar: <strong>Menü yönetimi → Kampanyalar</strong>.</li>
        <li>Mutfak ekranı ya da fişi: <strong>Sipariş ve mutfak → Mutfak</strong>.</li>
        <li>Yemeksepeti, Getir…: <strong>Sipariş ve mutfak → Paket platformları</strong>.</li>
      </ul>
    </Card>
    </>} />
    <Saving prefs={prefs} />
  </form>;
}

/**
 * "Uzun süredir sipariş verilmeyen masa için garsona hatırlat" (11 Ekim, hafta sonu bulgusu 4; packages/domain/table-reminders.ts):
 * on (45 dakika) by default; the minutes save when the box is left.
 */
function ReminderCard({ data, onSaved }: { data: StaffSnapshot; onSaved: () => void }) {
  const id = useId(), saved = data.tableReminderMinutes ?? 45, on = saved > 0;
  const [minutes, setMinutes] = useState(String(saved || 45)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!busy) setMinutes(String(saved || 45)); }, [saved]);
  async function save(value: number) {
    setBusy(true); setError('');
    try { await api('/api/staff/table-reminder', { minutes: value }); onSaved(); }
    catch (e) { setError((e as Error).message); setMinutes(String(saved || 45)); } finally { setBusy(false); }
  }
  const typed = Number(minutes), valid = Number.isInteger(typed) && typed >= 10 && typed <= 240;
  return <Card icon={<Footprints size={18} aria-hidden="true" />} title="Garson hatırlatması" lead="Uzun süredir sipariş vermeyen masa unutulmasın." tip="Hesabı açık bir masada bu süre boyunca yeni sipariş, garson çağrısı ya da hesap isteği olmazsa garsonun ekranında “Masa 5: 45 dakikadır yeni sipariş yok. Bir isteği var mı?” notu çıkar ve bir kez yumuşak bir ses çalar. Garson “Gittim” deyince not kapanır; aynı masa için en erken yine bu süre sonra gelir. Garson ataması açıksa yalnız o masanın garsonuna gider. Mutfakta bekleyen siparişi olan ya da hesabı isteyen masa için çıkmaz.">
    <Row id={`${id}-on`} label="Uzun süredir sipariş verilmeyen masa için garsona hatırlat" tip="Garson hatırlatması" line={on ? `Açık: ${saved} dakika boyunca yeni sipariş ya da çağrı yoksa garsona hatırlatılır.` : 'Kapalı: garsona hatırlatma gitmez.'} help="Hatırlatma garson ekranında çıkar; kasiyer, müdür ve sizin ekranınızda çıkmaz. Sesi Ayarlar → Cihazlar → Sesler'den değiştirebilirsiniz.">
      <Toggle id={`${id}-on`} checked={on} disabled={busy} onChange={v => void save(v ? (valid ? typed : 45) : 0)} />
    </Row>
    {on && <Row id={`${id}-minutes`} label="Kaç dakika sonra?" tip="Hatırlatma süresi" line="10 ile 240 dakika arası. Önerilen 45 dakika." help="Masada son sipariş, çağrı ya da garsonun “Gittim” demesinden bu kadar dakika sonra hatırlatma çıkar.">
      <div className="settings-number-control"><input id={`${id}-minutes`} type="number" min="10" max="240" inputMode="numeric" aria-describedby={`${id}-minutes-help`} value={minutes} disabled={busy} onChange={e => setMinutes(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} onBlur={() => { if (valid && typed !== saved) void save(typed); }} /><span aria-hidden="true">dakika</span></div>
      {!valid && <small className="field-error" role="alert">10 ile 240 arasında bir sayı yazın.</small>}
    </Row>}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

/** Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa: the POS rate (one of the business preferences), its own small form so Enter saves it. */
export function CommissionCard({ prefs }: { prefs: Preferences }) {
  const id = useId();
  return <form className="settings-form" aria-label="Kart tahsilatı" onSubmit={e => { e.preventDefault(); prefs.saveNumbers(); }}>
    <Card icon={<CreditCard size={18} aria-hidden="true" />} title="Kart tahsilatı" lead="Raporlarda “Elde kalan” hesaplanırken kart ödemelerinden düşülür.">
      <Row id={`${id}-commission`} label="POS komisyon oranı (%)" tip="POS komisyon oranı" line="Yalnızca yeni kart tahsilatlarına uygulanır. Bilmiyorsanız boş bırakın." help="Bankanızın uyguladığı oranı yazın. Yeni kart tahsilatlarının komisyonu bu oranla hesaplanır ve raporlarda gösterilir. Eski tahsilatlar değişmez. Oranı bilmiyorsanız boş bırakabilirsiniz; bu durumda komisyon bilinmiyor olarak kaydedilir.">
        <div className="settings-number-control"><input id={`${id}-commission`} inputMode="decimal" placeholder="Oran" aria-describedby={`${id}-commission-help`} value={prefs.commission} aria-invalid={!!commissionProblem(prefs.commission)} onChange={e => prefs.set({ commission: e.target.value })} onBlur={prefs.saveNumbers} /><span aria-hidden="true">%</span></div>
        {commissionProblem(prefs.commission) ? <small className="field-error" role="alert">Kaydedilmedi: {commissionProblem(prefs.commission)}</small> : <CommissionHint text={prefs.commission} />}
      </Row>
      {prefs.error && <Notice tone="error">{prefs.error}</Notice>}
    </Card>
  </form>;
}

/** Sipariş ve mutfak → Mutfak: "Mutfak nasıl çalışıyor?" (Ekran / Fiş; its "Mutfak yazıcısını seç" opens Cihazlar → Yazıcılar). */
export function KitchenPage({ data, onSaved }: { data: StaffSnapshot; onSaved: () => void }) { return <KitchenModeCard data={data} onSaved={onSaved} />; }

/**
 * Masalar ve QR → Masalar ve QR: tables and sections with cleaning, "Masa ekle" / "Masa çıkar" (the same windows as the
 * Masalar shortcut, `onTables`); the QR codes' address (Wi-Fi / internet) and renewing one code.
 */
export function TablesPage({ data, prefs, onSaved, onTables }: { data: StaffSnapshot; prefs: Preferences; onSaved: () => void; onTables?: (mode: 'add' | 'remove') => void }) {
  const id = useId(), pk = usePackage();
  // 11 Ekim (hafta sonu bulgusu 6): sections and order are arranged right here (src/TableLayout.tsx), not only in a table's window.
  return <Columns left={
    <Card icon={<LayoutGrid size={18} aria-hidden="true" />} title="Masalar ve bölümler" aside={<Count>{data.tables.length}</Count>} tip="Her masanın yanındaki seçimle bölümünü (İç, Dış, Üst kat…) değiştirin; listede olmayan bölüm için “Yeni bölüm…” seçin. Oklarla masaların ve bölümlerin sırasını değiştirin; Masalar ekranı bu sırayla gösterir. Kalemle bir bölümün adını değiştirirsiniz; garson atamaları yeni adla sürer." lead="Masanın bölümünü seçin, sırayı oklarla değiştirin.">
      {onTables && <div className="settings-actions"><button type="button" className="btn secondary" onClick={() => onTables('add')}><Plus size={16} aria-hidden="true" />Masa ekle</button><button type="button" className="btn secondary" onClick={() => onTables('remove')}><Minus size={16} aria-hidden="true" />Masa çıkar</button></div>}
      <TableLayout data={data} onSaved={onSaved} />
      <Row id={`${id}-cleaning`} label="Masa temizliği takibi" tip="Masa temizliği" line="Boşalan masa, temizlendi olarak işaretlenince yeniden sipariş alır." help="Hesap kapandığında veya masa taşındığında boşalan masa temizlik bekler. Garson ya da işletme sahibi “Temizlendi” diyene kadar yeni sipariş alınmaz. Bu ayarı kapatmak bekleyen masaları da siparişe açar.">
        <Toggle id={`${id}-cleaning`} checked={prefs.cleaningEnabled} disabled={prefs.busy} onChange={on => void prefs.persist({ cleaningEnabled: on })} />
      </Row>
      <Saving prefs={prefs} />
      <div className="home-links"><PlaceLink to={{ view: 'users', tab: 'settings', part: 'assignments' }}>Hangi garson hangi bölümde?</PlaceLink></div>
    </Card>} right={pk.has('qr-menu') ? <QrCodesCard data={data} onSaved={onSaved} page show="status" /> : <LockedRow feature="qr-menu" title="Masa QR kodları" />} />;
}

/** Masalar ve QR → QR kodlarını yazdır: A4 sheets of 6 or 12 codes, A6 table stand cards and their PDF. `openQr`: a link from Masalar ("QR'ları yeniden yazdır"). */
export function QrPrintPage({ data, openQr, onSaved }: { data: StaffSnapshot; openQr: boolean; onSaved: () => void }) {
  return <QrCodesCard data={data} open={openQr} onSaved={onSaved} page show="print" />;
}

export function PrintersPage({ data, onCount }: { data: StaffSnapshot; onCount: (n: number) => void }) {
  return <PrinterSettings categories={data.categories} page onCount={onCount} />;
}

export function SoundsPage() { return <SoundSettings />; }

/** Opening Mola on a tablet: one QR to /uygulama (install the Android app, or add to the iPhone/iPad home screen). */
function ConnectTablet() {
  const [network] = useNetwork(), [image, setImage] = useState('');
  const base = network ? qrBase(network) : '', reachable = !!network && (network.lan || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  useEffect(() => { let live = true; if (base && reachable) void QRCode.toDataURL(`${base}/uygulama`, { width: 240, margin: 1 }).then(v => { if (live) setImage(v); }).catch(() => {}); return () => { live = false; }; }, [base, reachable]);
  // On the café computer itself: Windows' "Genel" network profile keeps the phones out while Mola's firewall rule is the old
  // private-only one. A phone or tablet showing this page is already connected, so it is not told.
  const here = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const profile = useNetworkProfile(() => api<NetworkProfileView>('/api/staff/network-profile'), here && !!network?.lan);
  return <Card icon={<TabletSmartphone size={18} aria-hidden="true" />} title="Tablet ve telefon bağlama" className="connect-tablet">
    <NetworkProfileNotice view={profile} />
    {!network ?<p className="settings-card-note" aria-busy="true">Ağ adresi okunuyor…</p> : reachable ? <div className="connect-tablet-body">
      <div className="connect-tablet-qr">{image ? <img src={image} width={160} height={160} alt="Mola uygulaması kurulum sayfasının QR kodu" /> : <span />}</div>
      <div><p className="settings-card-note"><strong>Telefon ya da tabletin kamerasıyla okutun.</strong> Açılan sayfa Mola'yı Android'e uygulama olarak, iPhone ve iPad'e ana ekrana kurmayı anlatır. Cihaz bu bilgisayarla aynı Wi-Fi ağında olmalı.</p><p className="connect-tablet-address"><code>{base.replace(/^https?:\/\//, '')}/uygulama</code></p><p className="muted small">Garsona ve mutfağa kendi hesaplarını Personel → Çalışanlar'dan açın.</p></div>
    </div> : <p className="settings-card-note">Mola şu anda yalnız bu bilgisayara açık; tabletler bağlanamaz. Kasa bilgisayarındaki Mola penceresinde sol şerit → <strong>Tabletler</strong>'e bakın.</p>}
  </Card>;
}
export function DevicesPage() {
  return <><DeviceChecks page /><ConnectTablet /><div className="settings-card-fold"><PhotoStorage /></div></>;
}

type SecondPlace = { folder: string; kind: 'usb' | 'onedrive' | 'gdrive' | 'folder'; label: string | null; lastCopyAt: string | null; lastError: string | null };
type Backup = { enabled: boolean; lastSuccessAt: string | null; healthy: boolean; note?: string; cloud?: CloudView; folder?: string; kept?: number; canDownload?: boolean; second?: SecondPlace | null };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const placeName: Record<SecondPlace['kind'], string> = { usb: 'Flash bellek', onedrive: 'OneDrive', gdrive: 'Google Drive', folder: 'Klasör' };
/**
 * 13 Ekim tanıtım ("klasörler nerde yedekler nerde, benim bile kafam karışıyor"): every place a copy is kept, one row each,
 * with its last copy and one action: Klasörü aç (this computer, the second place) or İndir (the newest backup, the same files
 * the Sunucu yedeği holds). The details stay in the rail's "Yedekle" window.
 */
function BackupPlaces({ backup }: { backup: Backup }) {
  const desktop = typeof document !== 'undefined' && document.body.classList.contains('desktop-shell'), pk = usePackage();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const on = (e: Event) => setError((e as CustomEvent<string>).detail ?? ''); window.addEventListener('mola:open-result', on); return () => window.removeEventListener('mola:open-result', on); }, []);
  async function download() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/staff/backup-download', { credentials: 'same-origin', signal: AbortSignal.timeout(180_000) });
      if (!r.ok) { let m = 'Yedek indirilemedi.'; try { m = ((await r.json()) as { message?: string }).message ?? m; } catch { /* not JSON */ } throw new Error(m); }
      const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Mola-yedek.zip';
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const second = backup.second, cloudOn = pk.has('cloud-backup') && !!backup.cloud;
  const row = (icon: ReactNode, title: string, where: string, state: { ok: boolean | null; text: string }, action: ReactNode) => <li className="backup-place">
    <span className="backup-place-icon" aria-hidden="true">{icon}</span>
    <div className="backup-place-text"><strong>{title}</strong><small title={where}>{where}</small></div>
    <span className={`backup-place-state ${state.ok === null ? 'off' : state.ok ? 'ok' : 'bad'}`}>{state.text}</span>
    <span className="backup-place-action">{action}</span>
  </li>;
  return <div className="backup-places">
    <h3>Yedekleriniz nerede?</h3>
    <ul>
      {row(<HardDrive size={20} />, 'Bu bilgisayar', backup.folder ?? 'Mola klasörü', { ok: backup.lastSuccessAt ? backup.healthy : null, text: backup.lastSuccessAt ? `${backup.healthy ? '✓' : '!'} ${when(backup.lastSuccessAt)}` : 'Henüz yok' },
        desktop ? <button type="button" className="btn secondary small-btn" onClick={() => openRail('open-backups')}><FolderOpen size={15} aria-hidden="true" />Klasörü aç</button> : null)}
      {row(<Usb size={20} />, second ? `İkinci yer · ${second.label || placeName[second.kind]}` : 'İkinci yer', second ? second.folder : 'Flash bellek, OneDrive ya da Google Drive', second ? { ok: !second.lastError, text: second.lastError ? '! Alınamadı' : second.lastCopyAt ? `✓ ${when(second.lastCopyAt)}` : 'Bekleniyor' } : { ok: null, text: 'Kapalı' },
        desktop ? second ? <button type="button" className="btn secondary small-btn" onClick={() => openRail('open-second')}><FolderOpen size={15} aria-hidden="true" />Klasörü aç</button> : <button type="button" className="btn secondary small-btn" onClick={() => openRail('backup')}>Aç</button> : null)}
      {row(<Cloud size={20} />, 'Sunucu (bulut yedek)', cloudOn ? 'Mola Merkez · şifreli, Mola ekibi açamaz' : 'Paketinizde yok', cloudOn ? { ok: !backup.cloud!.failing, text: backup.cloud!.failing ? '! Gönderilemedi' : backup.cloud!.lastSuccessAt ? `✓ ${when(backup.cloud!.lastSuccessAt)}` : 'Bekleniyor' } : { ok: null, text: 'Kapalı' },
        cloudOn ? <button type="button" className="btn secondary small-btn" disabled={busy || !backup.canDownload} onClick={() => void download()}><Download size={15} aria-hidden="true" />{busy ? 'Hazırlanıyor…' : 'İndir'}</button> : <button type="button" className="btn secondary small-btn" onClick={() => openFeatureLock('cloud-backup')}>Nedir?</button>)}
    </ul>
    {second?.lastError && <p className="backup-places-error">{second.lastError}</p>}
    {error && <Notice tone="error">{error}</Notice>}
    <p className="muted small">İndirilen yedek şifrelidir; yalnız işletmenizin kurtarma koduyla ya da yeni bilgisayarda “İşletmem var” girişiyle açılır.{backup.kept ? ` Bu bilgisayarda ${backup.kept} yedek saklanıyor.` : ''}</p>
  </div>;
}
/**
 * "Yeni bilgisayar için e-posta" (13 Ekim, sahibin kararı): the address İşletmem var sends its code to, kept and verified by
 * Mola Merkez (server/owner-email.ts). No address yet (activated with the Mola team's code): type it, the code sent there
 * proves it. A change: the owner's password, the code sent to the OLD address, then the NEW address's code. The
 * application's address shows as "başvurudaki adres". The owner's own account only (others get 403: card hidden).
 * `lock` false: the owner never typed the password since İşletmem var came (stayed signed in across the update), so a new
 * computer would say "Bilgiler eşleşmedi": the card asks for the password once. Shows the sign-in name İşletmem var asks.
 */
type OwnerEmail = { available: boolean; email: string | null; source: 'owner' | 'invoice' | null; lock?: boolean | null; username?: string | null; atMerkez?: boolean; copiedAt?: string | null; reason?: string };
type EmailStep = { at: 'view' } | { at: 'password' } | { at: 'old'; ticket: string; email: string } | { at: 'confirm'; ticket: string; email: string };
function OwnerEmailCard() {
  const [view, setView] = useState<OwnerEmail | null | undefined>(undefined), [step, setStep] = useState<EmailStep>({ at: 'view' });
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [oldCode, setOldCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(''), [resend, setResend] = useState(false);
  const pk = usePackage();
  const load = () => api<OwnerEmail>('/api/staff/owner-email').then(setView, () => setView(v => v === undefined ? null : v));
  useEffect(() => { void load(); }, []);
  // "Hazır" only once Mola Merkez has the lock and a Sunucu yedeği copy after it (13 Ekim): looked at again every 20 s
  // meanwhile (Merkez answers this at most once in 15 s per computer).
  const waiting = !!view?.available && !!view.email && view.lock === true && !(view.atMerkez && (view.copiedAt || !pk.has('cloud-backup')));
  useEffect(() => { if (!waiting || step.at !== 'view') return; const t = setInterval(() => void load(), 20_000); return () => clearInterval(t); }, [waiting, step.at]);
  if (view === null || view === undefined) return null;
  const reset = (next?: OwnerEmail) => { if (next) setView(next); setStep({ at: 'view' }); setEmail(''); setPassword(''); setCode(''); setOldCode(''); setError(''); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setDone(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  // First address: the password and a code to it. A change: the old address's code goes with the new address (and the password again).
  const sendNew = (old?: { ticket: string; code: string }) => run(async () => {
    const r = await api<{ ticket: string; email: string }>('/api/staff/owner-email/new-code', { email: email.trim(), password, ...(old ? { old } : {}) });
    setCode(''); setStep({ at: 'confirm', ticket: r.ticket, email: r.email });
  });
  // The lock now (or again): Mola Merkez hears it at once and a fresh backup takes it to Sunucu yedeği.
  const makeLock = () => run(async () => { await api('/api/staff/owner-email/lock', { password }); setPassword(''); setResend(false); await load(); setDone('Şifre kilidiniz Mola Merkez’e gönderiliyor. Birkaç saniye içinde aşağıda “hazır” yazar.'); });
  const passwordInput = <label className="owner-email-field">İşletme sahibi şifresi<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>;
  // Where İşletmem var stands: on this computer, at Mola Merkez, in Sunucu yedeği. Shows the sign-in name it will ask
  // (the owner may not remember it).
  const cloud = pk.has('cloud-backup');
  const ready = !view.email || view.lock !== true ? null
    : view.atMerkez && (view.copiedAt || !cloud) ? <p className="owner-email-ready muted small">“İşletmem var” hazır: yeni bilgisayarda bu e-posta, <strong>{view.username}</strong> kullanıcı adı ve şifrenizle girersiniz.{view.copiedAt ? ` Verileriniz ${when(view.copiedAt)} sunucu yedeğinden gelir.` : ' Sunucu yedeği hizmetiniz olmadığı için yeni bilgisayarda yedek klasörünüz (flash bellek ya da ikinci yer) gerekir.'}</p>
    : <p className="owner-email-wait muted small">{view.atMerkez ? 'Şifre kilidiniz Mola Merkez’de. Sunucu yedeği alınıyor; bitince “İşletmem var” hazır olur.' : 'Henüz hazır değil: şifre kilidiniz Mola Merkez’e gönderiliyor (internet yoksa bağlantı gelince gider).'}{' '}
        {!resend && <button type="button" className="link-btn" onClick={() => { setResend(true); setDone(''); }}>Şimdi gönder</button>}</p>;
  const sendOld = () => run(async () => { const r = await api<{ ticket: string; email: string }>('/api/staff/owner-email/old-code', { password }); setOldCode(''); setStep({ at: 'old', ticket: r.ticket, email: r.email }); });
  const confirm = (ticket: string) => run(async () => { const r = await api<OwnerEmail>('/api/staff/owner-email/confirm', { ticket, code: code.trim() }); reset(r); void load(); setDone('E-posta doğrulandı. Bilgisayarınız değişirse kod bu adrese gelir.'); });
  const codeInput = (value: string, set: (v: string) => void, label: string) => <label className="owner-email-field">{label}<input className="owner-email-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} disabled={busy} onChange={e => set(e.target.value.replace(/\D/g, ''))} placeholder="000000" /></label>;
  const emailInput = (label: string) => <label className="owner-email-field">{label}<input type="email" autoComplete="email" maxLength={120} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} placeholder="ör. ayse@ornekkafe.com" /></label>;
  const cancel = <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => reset()}>Vazgeç</button>;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return <Card icon={<Mail size={18} aria-hidden="true" />} title="Yeni bilgisayar için e-posta" className="owner-email-card"
    lead="Bilgisayarınız değişirse “İşletmem var” ile girersiniz; 6 haneli kod bu adrese gelir. İşletmeniz başka bir bilgisayarda açılırsa da buraya haber verilir."
    tip="Hesap açma başvurusunda yazdığınız e-posta zaten kayıtlıdır. Mola ekibinin koduyla etkinleştirdiyseniz adres yoktur: buraya yazıp doğrulayın. Değiştirmek için işletme sahibi şifreniz, eski adrese ve yeni adrese gelen kodlar gerekir. Eski adresinize erişemiyorsanız Mola ekibini arayın.">
    <div className="owner-email">
      {!view.available ? <p className="muted small">{view.reason}</p>
      : step.at === 'view' ? (view.email
        ? <>
            <div className="owner-email-current"><span><strong>{view.email}</strong><small>{view.source === 'invoice' ? 'Başvurudaki adres' : 'Doğrulandı'}</small></span><button type="button" className="btn secondary small-btn" onClick={() => { reset(); setDone(''); setStep({ at: 'password' }); }}>Değiştir</button></div>
            {ready}
            {(view.lock === false || resend) && <form className="owner-email-form" onSubmit={e => { e.preventDefault(); if (password) void makeLock(); }}>
              {view.lock === false ? <Notice>“İşletmem var” henüz hazır değil: güncellemeden beri şifrenizi yazmadınız. Bir kez yazın; yeni bilgisayarda girişiniz bu şifreyle açılır.</Notice>
                : <p className="muted small">Şifrenizi yazın; kilit Mola Merkez’e hemen gider ve yeni bir yedek alınır.</p>}
              {passwordInput}
              <div className="owner-email-actions">{resend && <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => { setResend(false); setPassword(''); }}>Vazgeç</button>}<button className="btn primary small-btn" disabled={busy || !password}>{busy ? 'Hazırlanıyor…' : view.lock === false ? 'Hazırla' : 'Gönder'}</button></div>
            </form>}
          </>
        : <form className="owner-email-form" onSubmit={e => { e.preventDefault(); if (validEmail && password) void sendNew(); }}>
            <Notice>Kayıtlı e-posta yok. Bilgisayarınız bozulursa verilerinizi “İşletmem var” ile geri alabilmek için bir adres yazıp doğrulayın.</Notice>
            {emailInput('E-posta adresi')}
            {passwordInput}
            <div className="owner-email-actions"><button className="btn primary small-btn" disabled={busy || !validEmail || !password}>{busy ? 'Gönderiliyor…' : 'Kod gönder'}</button></div>
          </form>)
      : step.at === 'password' ? <form className="owner-email-form" onSubmit={e => { e.preventDefault(); if (password) void sendOld(); }}>
          <p className="muted small">1/3 · Güvenlik için işletme sahibi şifrenizi yazın; kayıtlı adrese ({view.email}) bir kod gönderilir.</p>
          {passwordInput}
          <div className="owner-email-actions">{cancel}<button className="btn primary small-btn" disabled={busy || !password}>{busy ? 'Gönderiliyor…' : 'Eski adrese kod gönder'}</button></div>
        </form>
      : step.at === 'old' ? <form className="owner-email-form" onSubmit={e => { e.preventDefault(); if (oldCode.length === 6 && validEmail) void sendNew({ ticket: step.ticket, code: oldCode }); }}>
          <p className="muted small">2/3 · {step.email} adresine gelen kodu ve yeni adresi yazın.</p>
          {codeInput(oldCode, setOldCode, 'Eski adrese gelen kod')}
          {emailInput('Yeni e-posta adresi')}
          <div className="owner-email-actions">{cancel}<button className="btn primary small-btn" disabled={busy || oldCode.length !== 6 || !validEmail}>{busy ? 'Gönderiliyor…' : 'Yeni adrese kod gönder'}</button></div>
          <p className="muted small">Eski adresinize erişemiyorsanız Mola ekibini arayın; kim olduğunuzu doğrulayıp kaldırırlar.</p>
        </form>
      : step.at === 'confirm' ? <form className="owner-email-form" onSubmit={e => { e.preventDefault(); if (code.length === 6) void confirm(step.ticket); }}>
          <p className="muted small">{view.email ? '3/3 · ' : ''}{step.email} adresine 6 haneli kod gönderildi. Kod 10 dakika geçerlidir.</p>
          {codeInput(code, setCode, 'Yeni adrese gelen kod')}
          <div className="owner-email-actions">{cancel}<button className="btn primary small-btn" disabled={busy || code.length !== 6}>{busy ? 'Doğrulanıyor…' : 'Doğrula'}</button></div>
        </form> : null}
      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
    </div>
  </Card>;
}
/** Güvenlik ve yedek → Yedek: the backup state and the rail's tools; the "Tanıtım işletmesi" reset; "Açık oturumlar" link. */
export function BackupPage({ backup }: { backup: Backup | null }) {
  const desktop = typeof document !== 'undefined' && document.body.classList.contains('desktop-shell'), pk = usePackage();
  return <>
    {backup?.enabled && <Card icon={<MapPin size={18} aria-hidden="true" />} title="Yedekleriniz nerede?" className="backup-places-card"><BackupPlaces backup={backup} /></Card>}
    <OwnerEmailCard />
    <Card icon={<DatabaseBackup size={18} aria-hidden="true" />} title="Yedek" lead="Satışlarınız, menünüz ve ayarlarınız gün sonundan 1 dakika sonra ve gece 03:30'da şifreli olarak yedeklenir (bilgisayar gece kapalıysa açılınca).">
      {!backup ? <p className="settings-card-note" aria-busy="true">Yedek durumu okunuyor…</p> : !backup.enabled ? <div className="settings-status warn"><ShieldAlert size={20} aria-hidden="true" /><div><strong>Bu kurulumda otomatik yedek kapalı.</strong><span>Mola ekibine danışın.</span></div></div>
        : <div className={`settings-status settings-backup ${backup.healthy || !backup.lastSuccessAt ? 'ok' : 'warn backup-warn'}`}>{backup.healthy || !backup.lastSuccessAt ? <ShieldCheck size={20} aria-hidden="true" /> : <ShieldAlert size={20} aria-hidden="true" />}<div>
          <strong>{!backup.lastSuccessAt ? 'İlk otomatik yedek birkaç dakika içinde alınacak.' : backup.healthy ? 'Verileriniz her gece yedekleniyor' : 'Son yedek eski, destekle iletişime geçin.'}</strong>
          {backup.lastSuccessAt && <span>Son yedek: {when(backup.lastSuccessAt)}</span>}
          {/* Nothing new since the last backup: "Gece yedeği gerekmedi: 23:41 gün sonu yedeği güncel." */}
          {backup.note && <span className="settings-backup-note">{backup.note}</span>}
          {/* Sunucu yedeği: the encrypted copy on Mola Merkez ("dün 23:40 · başarılı"); Mola ekibi cannot open it. */}
          {backup.cloud && pk.has('cloud-backup') && <span className="settings-cloud-line">{cloudLine(backup.cloud)}</span>}</div></div>}
      {!pk.has('cloud-backup') && <LockedRow feature="cloud-backup" title="Sunucu yedeği (bulutta şifreli kopya)" line="Bu bilgisayardaki yedekler her gece alınmaya devam ediyor." />}
      {desktop ? <div className="settings-actions"><button type="button" className="btn secondary" onClick={() => openRail('backup')}><DatabaseBackup size={16} aria-hidden="true" />Yedekle ve ikinci yer</button><button type="button" className="btn secondary" onClick={() => openRail('recovery')}><KeyRound size={16} aria-hidden="true" />Kurtarma kodu</button></div>
        : <p className="settings-field-hint">“Şimdi yedekle”, ikinci yedek yeri ve kurtarma kodu kasa bilgisayarındaki Mola penceresindedir: sol şerit → Yedekle / Güvenlik.</p>}
    </Card>
    <DemoResetCard />
    <div className="home-links"><PlaceLink to={{ view: 'users', tab: 'staff' }}>Açık oturumlar (kaybolan tableti çıkarma): Personel → Çalışanlar</PlaceLink></div>
  </>;
}

/** Güvenlik ve yedek → Kilit ve güncelleme: "Sahip hesabı otomatik kilit" and the update settings (the version lines link here). */
export function LockPage() { return <><OwnerLockSettings /><UpdateSettings /></>; }

/**
 * Güvenlik ve yedek → Telefonum: the owner's phone, three steps in order: Raporlar için telefon kodu, Telefonu eşleştir
 * (Raporlarım telefonda; once Destek → Uzaktan erişim), Uzaktan yönetim.
 */
export function PhonePage() {
  const pk = usePackage();
  return <>
    <div className="settings-card-fold"><ReportSecurity /></div>
    {pk.has('remote-reports') ? <PhonePairing /> : <LockedRow feature="remote-reports" title="Raporlarım telefonda" />}
    {pk.has('remote-admin') ? <RemoteAdminSettings /> : <LockedRow feature="remote-admin" />}
  </>;
}

/** Masalar ve QR → Engellenen telefonlar (once in Güvenlik ve yedek): blocked from QR ordering in a table's window. */
export function BlockedPage({ blocks, onUnblock, error }: { blocks: { orderId: string; number: number; label: string }[]; onUnblock: (orderId: string) => void; error: string }) {
  return <>
    <Card icon={<ShieldOff size={18} aria-hidden="true" />} title="Engellenen müşteri telefonları" aside={<Count>{blocks.length}</Count>} tip="Engel, müşterinin QR menüyü açtığı telefondaki tarayıcıya konur. Aynı Wi-Fi ağındaki diğer misafirler etkilenmez. Müşteri başka bir tarayıcıdan ya da başka bir telefondan girerse engel geçmez; gerekirse o masanın QR kodunu Masalar ve QR'dan yenileyin." lead="QR menüden sipariş vermesini engellediğiniz telefonlar. Engel yalnız o telefona ve yalnız bu işletmeye uygulanır.">
      {blocks.length === 0 ? <EmptyState icon={<ShieldCheck size={22} aria-hidden="true" />} title="Engellenen telefon yok." text="Masalar ekranında bir siparişin penceresinden “Bu tarayıcıyı engelle” ile eklenir." />
        : <ul className="blocked-list">{blocks.map(b => <li className="blocked-row" key={b.orderId}><ShieldOff size={16} aria-hidden="true" /><span>#{b.number} · {b.label}</span><button type="button" className="btn secondary" onClick={() => onUnblock(b.orderId)}>Engeli kaldır</button></li>)}</ul>}
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  </>;
}

export function IntegrationsPage() {
  return <div className="settings-integrations"><DeferredPanel><Integrations /></DeferredPanel></div>;
}

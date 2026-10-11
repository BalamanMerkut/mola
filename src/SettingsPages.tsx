import { lazy, useEffect, useId, useState } from 'react';
import { Building2, Check, ClipboardCheck, CreditCard, DatabaseBackup, KeyRound, LayoutGrid, Info, Minus, Plus, ShieldAlert, ShieldCheck, ShieldOff, TabletSmartphone } from 'lucide-react';
import { Moved, PlaceLink } from './Moved';
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
import { areaName } from './TableAreaPicker';
import { UpdateSettings } from './UpdateBanner';
// "Mutfak nasıl çalışıyor?" (Ekran / Fiş; Sipariş ve mutfak → Mutfak): its own card, src/KitchenModeCard.tsx.
import { KitchenModeCard } from './KitchenModeCard';
// The "Tanıtım işletmesi" card (Güvenlik ve yedek → Yedek): its own file.
import { DemoResetCard } from './DemoResetCard';
// Hizmet paketi: a closed service's card is a faded row that opens the package card (src/FeatureLock.tsx).
import { LockedRow, usePackage } from './FeatureLock';

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
    {/* Taşındı (10 Ekim düzeni): the cash and staff parts of the old "Sipariş ve kasa", for two releases. */}
    <div className="moved-list">
      <Moved what="Kasa ve ödeme" where="Kasa ve giderler → Kasa ayarları" to={{ view: 'cash', tab: 'settings' }} />
      <Moved what="Vardiya ve bahşiş, garson ataması" where="Personel → Personel ayarları" to={{ view: 'users', tab: 'settings' }} />
    </div>
  </form>;
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
  const areas = [...new Set(data.tables.map(t => t.area ?? ''))];
  return <Columns left={
    <Card icon={<LayoutGrid size={18} aria-hidden="true" />} title="Masalar ve bölümler" aside={<Count>{data.tables.length}</Count>} tip="Masa eklemek ya da çıkarmak için buradaki ya da Masalar ekranındaki “Masa ekle” ve “Masa çıkar” düğmelerini kullanın. Bir masanın bölümünü (iç, dış, bahçe…) o masanın penceresinden seçin." lead="Bir masanın bölümü (iç, dış, bahçe…) o masanın penceresinden seçilir.">
      {onTables && <div className="settings-actions"><button type="button" className="btn secondary" onClick={() => onTables('add')}><Plus size={16} aria-hidden="true" />Masa ekle</button><button type="button" className="btn secondary" onClick={() => onTables('remove')}><Minus size={16} aria-hidden="true" />Masa çıkar</button></div>}
      <ul className="settings-area-list">{areas.map(a => <li key={a}><LayoutGrid size={15} aria-hidden="true" /><span>{a ? `${areaName(a)} masaları` : areas.length > 1 ? 'Bölümsüz masalar' : 'Bütün masalar'}</span><strong>{data.tables.filter(t => (t.area ?? '') === a).length} masa</strong></li>)}</ul>
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
  // On the café computer itself: Windows' "Genel" network profile keeps the phones out (Mola's firewall rule is for private
  // networks only). A phone or tablet showing this page is already connected, so it is not told.
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

type Backup = { enabled: boolean; lastSuccessAt: string | null; healthy: boolean; note?: string; cloud?: CloudView };
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
/** Güvenlik ve yedek → Yedek: the backup state and the rail's tools; the "Tanıtım işletmesi" reset; "Açık oturumlar" link. */
export function BackupPage({ backup }: { backup: Backup | null }) {
  const desktop = typeof document !== 'undefined' && document.body.classList.contains('desktop-shell'), pk = usePackage();
  return <>
    <Card icon={<DatabaseBackup size={18} aria-hidden="true" />} title="Yedek" lead="Satışlarınız, menünüz ve ayarlarınız her gece 03:30'da şifreli olarak yedeklenir.">
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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChefHat, ClipboardCheck, DatabaseBackup, Globe2, LayoutGrid, Lock, Package2, Plug, Printer, QrCode, Share2, ShieldCheck, ShieldOff, Store, TabletSmartphone, Volume2, type LucideIcon } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { api } from './api';
import { changed, reprintForInternet, useNetwork } from './SettingsQr';
import { useSoundChoices } from './sounds';
import { defaultSounds, soundEvents } from '../packages/domain/sound-catalog';
import { BackupPage, BlockedPage, BusinessPage, DevicesPage, IntegrationsPage, KitchenPage, LockPage, OrdersPage, PrintersPage, QrPrintPage, SoundsPage, TablesPage, usePreferences } from './SettingsPages';
// Uzaktan erişim (the owner's phone, laptop and tablet; the shortcut; uzaktan yönetim): src/RemoteAccess.tsx.
import { RemoteAccess } from './RemoteAccess';
// Sosyal medya (İşletme → Sosyal medya): the business's links and their permanent QR codes, src/SocialSettings.tsx.
import { SocialSettings } from './SocialSettings';
import { PillTabs } from './PillTabs';
import './settings-workspace.css';
// Hizmet paketi: "Paket ve lisans" (İşletme → Paket ve lisans) and the faded parts of closed services (src/FeatureLock.tsx).
import { PackageCard } from './PackageCard';
import { LicenseCard } from './LicenseCard';
import { FeatureLockView, usePackage } from './FeatureLock';
import type { FeatureId } from '../packages/domain/feature-gate';
/** Parts that are one service each: faded with "Pakette yok" when closed, the blurred card as their page. */
const PART_FEATURE: Partial<Record<SettingsPart, FeatureId>> = { integrations: 'integrations', qrPrint: 'qr-menu', remote: 'remote-reports' };
/** Parts whose cards sit in two columns on a wide screen (one on a phone and an upright tablet): the page gets wider. */
const WIDE_PARTS = new Set<SettingsPart>(['package', 'tableSetup', 'printers', 'sounds', 'orders']);

/*
 * Ayarlar: only what is set up once for the whole business or its devices (10 Ekim düzeni, docs/BILGI_MIMARISI_ONERISI.md
 * kural 5). Five topics in a centred icon tab bar (level 1, the shared PillTabs) and each topic's parts in a quieter second
 * row (level 2, variant "sub"): never more than two levels. Pages with several cards lay them in two columns on a wide
 * screen (`settings-grid`, one column on phones); long explanations sit in grey ⓘ bubbles. The topic, and per topic its
 * part, stay chosen on this device (localStorage), so a cashier tablet and the café computer each come back where they were;
 * a remembered place of the earlier Ayarlar lands on its new topic (tests/browser/settings-topics.spec.ts walks them all).
 *
 * İşletme → Görünüm (the business profile), Sosyal medya (src/SocialSettings.tsx), Paket ve lisans (src/PackageCard.tsx,
 * src/LicenseCard.tsx). Masalar ve QR → Masalar ve QR (tables with Masa ekle / çıkar, cleaning, the QR address and
 * Wi-Fi/internet state, renewing one code), QR kodlarını yazdır (A4 and A6), Engellenen telefonlar. Sipariş ve mutfak →
 * Sipariş ve onay, Mutfak (Ekran / Fiş), Paket platformları. Cihazlar → Yazıcılar, Sesler, Cihaz bağla. Güvenlik ve yedek →
 * Yedek, Kilit ve güncelleme (also the report code's reset). Uzaktan erişim (0.1.21, the owner only, one page: the phone first,
 * then laptop and tablet, the shortcut, uzaktan yönetim, the paired devices; src/RemoteAccess.tsx) took Güvenlik ve yedek →
 * Telefonum's place. A topic with one part shows no second row.
 * What left Ayarlar lives in its topic's home, with a setting tab only the owner sees: Kasa ve giderler → Kasa ayarları and
 * Giderler → Otomatik giderler; Personel → Personel ayarları (vardiya, bahşiş, garson ataması); Ajanda ve rezervasyon →
 * Ayarlar; Menü yönetimi → KDV oranları; Satış ve Raporlar → "Raporları gönder" and Kârlılık → "Uyarı sınırları". The
 * "Taşınan ayarlar" list at the bottom points to each for two releases.
 */
export type SettingsTopic = 'business' | 'tables' | 'orders' | 'devices' | 'security' | 'remote';
export type SettingsPart = 'profile' | 'social' | 'package' | 'tableSetup' | 'qrPrint' | 'blocked' | 'orders' | 'kitchen' | 'integrations' | 'printers' | 'sounds' | 'devices' | 'backup' | 'lock' | 'remote';
type PartInfo = { id: SettingsPart; title: string; line: string; icon: LucideIcon };
type TopicInfo = { id: SettingsTopic; title: string; line: string; icon: LucideIcon; parts: PartInfo[] };
export const settingsTopics: TopicInfo[] = [
  { id: 'business', title: 'İşletme', line: 'Ad, logo, renkler, işletme türü; sosyal medya; paket ve lisans', icon: Store, parts: [
    { id: 'profile', title: 'Görünüm', line: 'Ad, logo, renkler, işletme türü, İngilizce metinler ve Google yorum bağlantısı', icon: Store },
    { id: 'social', title: 'Sosyal medya', line: 'Instagram, Facebook, WhatsApp ve diğer hesaplar; menüde simgeler ve kalıcı QR kodları', icon: Share2 },
    { id: 'package', title: 'Paket ve lisans', line: 'Paketinizdeki hizmetler, lisansın kalan günü, hizmeti dondurma ve Mola ekibine ulaşma', icon: Package2 },
  ] },
  { id: 'tables', title: 'Masalar ve QR', line: 'Masalar, bölümler, temizlik, QR adresi ve yazdırma, engellenen telefonlar', icon: QrCode, parts: [
    { id: 'tableSetup', title: 'Masalar ve QR', line: 'Masa ekle / çıkar, bölümler, temizlik; QR kodlarının adresi (Wi-Fi / internet) ve tek masanın kodunu yenileme', icon: LayoutGrid },
    { id: 'qrPrint', title: 'QR kodlarını yazdır', line: "A4'e 6 ya da 12 QR, A6 masa standı kartları ve PDF", icon: Printer },
    { id: 'blocked', title: 'Engellenen telefonlar', line: 'QR menüden sipariş vermesini engellediğiniz müşteri telefonları', icon: ShieldOff },
  ] },
  { id: 'orders', title: 'Sipariş ve mutfak', line: 'Sipariş ve onay, değiştirme süresi, mutfak ekranı ya da fişi, paket platformları', icon: ClipboardCheck, parts: [
    { id: 'orders', title: 'Sipariş ve onay', line: 'Ödeme sırası, değiştirme süresi, QR onayı', icon: ClipboardCheck },
    { id: 'kitchen', title: 'Mutfak', line: 'Mutfak nasıl çalışıyor: ekran ya da fiş', icon: ChefHat },
    { id: 'integrations', title: 'Paket platformları', line: 'Yemeksepeti, Getir gibi dış sipariş platformları', icon: Plug },
  ] },
  { id: 'devices', title: 'Cihazlar', line: 'Fiş yazıcıları, bildirim sesleri, cihaz bağlama', icon: TabletSmartphone, parts: [
    { id: 'printers', title: 'Yazıcılar', line: 'Mutfak ve kasa fiş yazıcıları', icon: Printer },
    { id: 'sounds', title: 'Sesler', line: 'Her bildirimin sesi ve bu cihazın ses düzeyi', icon: Volume2 },
    { id: 'devices', title: 'Cihaz bağla', line: 'Personel tabletleri, laptop ve telefonlar, bağlantı kontrolü, fotoğraf alanı', icon: TabletSmartphone },
  ] },
  { id: 'security', title: 'Güvenlik ve yedek', line: 'Yedek, kilit, telefon kodu ve güncelleme', icon: ShieldCheck, parts: [
    { id: 'backup', title: 'Yedek', line: 'Yedek durumu, şimdi yedekle, ikinci yer ve kurtarma kodu', icon: DatabaseBackup },
    { id: 'lock', title: 'Kilit ve güncelleme', line: 'Sahip hesabı otomatik kilit, raporlar için telefon kodu ve Mola güncellemeleri', icon: Lock },
  ] },
  { id: 'remote', title: 'Uzaktan erişim', line: 'Telefonunuz, laptop ve tablet, kısayol, uzaktan yönetim', icon: Globe2, parts: [
    { id: 'remote', title: 'Uzaktan erişim', line: 'Raporlarınıza ve kafenize her yerden: önce telefonunuz, sonra laptop ve tablet', icon: Globe2 },
  ] },
];
/** Uzaktan erişim is the owner's own (pairing and its switches answer only the owner's account). */
const OWNER_TOPICS = new Set<SettingsTopic>(['remote']);
/** Where an Ayarlar link lands: a topic, a part of it, and for "QR'ları yeniden yazdır" the QR card opened. */
export type SettingsOpening = { key: number; topic: SettingsTopic; part?: SettingsPart; qr?: boolean };

const TOPIC_KEY = 'mola-settings-topic', PART_KEY = 'mola-settings-part';
/**
 * Topics of the earlier Ayarlar remembered on devices (the ten of September, the six of October): each lands on its new
 * place. Those that left Ayarlar (Giderler ve kâr, Kasa ve ödeme) land on a page whose "Taşınan ayarlar" names their home.
 */
const OLD_TOPICS: Record<string, [SettingsTopic, SettingsPart?]> = {
  print: ['devices', 'printers'], printers: ['devices', 'printers'], sounds: ['devices', 'sounds'], other: ['security', 'backup'],
  integrations: ['orders', 'integrations'], cash: ['orders', 'orders'], expenses: ['business', 'profile'],
};
/**
 * The part an earlier topic remembered (the six topics of 8 Ekim kept a part per topic): "Yazıcı ve ses → Sesler" lands on
 * Cihazlar → Sesler, "Güvenlik ve diğer → Cihazlar" on Cihazlar → Cihaz bağla (10 Ekim son kullanıcı testi: both
 * opened the topic's first part).
 */
const OLD_PARTS: Record<string, Record<string, [SettingsTopic, SettingsPart]>> = {
  print: { printers: ['devices', 'printers'], sounds: ['devices', 'sounds'] },
  other: { security: ['security', 'backup'], devices: ['devices', 'devices'], integrations: ['orders', 'integrations'] },
};
const isTopic = (v: unknown): v is SettingsTopic => settingsTopics.some(t => t.id === v);
const partsOf = (topic: SettingsTopic) => settingsTopics.find(t => t.id === topic)?.parts ?? [];
type Place = { topic: SettingsTopic; parts: Partial<Record<SettingsTopic, SettingsPart>> };
export function rememberedPlace(): Place {
  const place: Place = { topic: 'business', parts: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(PART_KEY) ?? 'null') as Record<string, unknown> | null;
    for (const t of settingsTopics) { const p = saved?.[t.id]; if (t.parts.some(x => x.id === p)) place.parts[t.id] = p as SettingsPart; }
    const topic = localStorage.getItem(TOPIC_KEY) ?? '';
    // Güvenlik ve yedek → Telefonum (until 0.1.20) is Uzaktan erişim now.
    if (topic === 'security' && saved?.security === 'phone') place.topic = 'remote';
    else if (isTopic(topic)) place.topic = topic;
    else if (OLD_TOPICS[topic]) { const [t, p] = OLD_PARTS[topic]?.[String(saved?.[topic])] ?? OLD_TOPICS[topic]; place.topic = t; if (p) place.parts[t] = p; }
  } catch { /* preference only */ }
  return place;
}
// "QR'ları yeniden yazdır" / "QR kodlarına git" (qr) land on Masalar ve QR → QR kodlarını yazdır.
const placeFor = (open: SettingsOpening, base: Place): Place => {
  const topic = isTopic(open.topic) ? open.topic : 'business', part = open.part && partsOf(topic).some(p => p.id === open.part) ? open.part : open.qr && topic === 'tables' ? 'qrPrint' : undefined;
  return { topic, parts: part ? { ...base.parts, [topic]: part } : base.parts };
};

/** `open`: a link from elsewhere (İlk adımlar, the QR address warning) that lands on one topic and part. `onTables`: Masa ekle / çıkar. */
export function SettingsPanel({ data, onSaved, open, onTables }: { data: StaffSnapshot; onSaved: () => void; open?: SettingsOpening; onTables?: (mode: 'add' | 'remove') => void }) {
  const pk = usePackage(), shown = settingsTopics.filter(t => pk.owner || !OWNER_TOPICS.has(t.id));
  const [place, setPlace] = useState<Place>(() => open ? placeFor(open, rememberedPlace()) : rememberedPlace());
  useEffect(() => { if (open) setPlace(p => placeFor(open, p)); }, [open?.key]);
  useEffect(() => { try { localStorage.setItem(TOPIC_KEY, place.topic); localStorage.setItem(PART_KEY, JSON.stringify(place.parts)); } catch { /* preference only */ } }, [place]);
  const topic = shown.some(t => t.id === place.topic) ? place.topic : 'business', parts = partsOf(topic), part = place.parts[topic] ?? parts[0].id;
  const setTopic = (next: SettingsTopic) => setPlace(p => ({ ...p, topic: next }));
  const setPart = (next: SettingsPart) => setPlace(p => ({ ...p, parts: { ...p.parts, [p.topic]: next } }));
  const prefs = usePreferences(data, onSaved);
  const partLocked = (p: SettingsPart) => { const f = PART_FEATURE[p]; return f && !pk.has(f) ? f : undefined; };

  // Small states in the topic list: what is missing or needs a look, read once here.
  const [printers, setPrinters] = useState<number | null>(null);
  useEffect(() => { void api<{ printers: unknown[] }>('/api/staff/printers').then(r => setPrinters(r.printers.length)).catch(() => {}); }, []);
  const [backup, setBackup] = useState<{ enabled: boolean; lastSuccessAt: string | null; healthy: boolean } | null>(null);
  useEffect(() => { void api<NonNullable<typeof backup>>('/api/staff/backup-status').then(setBackup).catch(() => {}); }, []);
  const [blocks, setBlocks] = useState<{ orderId: string; number: number; label: string }[]>([]), [blockError, setBlockError] = useState('');
  const loadBlocks = useCallback(() => api<typeof blocks>('/api/staff/blocks').then(setBlocks).catch(e => setBlockError(e.message)), []);
  useEffect(() => { void loadBlocks(); }, [loadBlocks]);
  const [network] = useNetwork();
  const sounds = useSoundChoices(), silent = soundEvents.filter(e => !sounds[e].on && defaultSounds[e].on).length; // "Bildirim sesi" starts off: not counted as switched off

  // A state per part. `warn` also marks the tab (and the topic holding the part); quiet ones sit in the page head.
  type State = { text: string; warn?: boolean };
  const partState: Partial<Record<SettingsPart, State>> = {
    printers: printers === null ? undefined : printers ? { text: `${printers} yazıcı` } : { text: 'Eksik', warn: true },
    sounds: silent ? { text: `${silent} ses kapalı` } : { text: 'Sesler açık' },
    orders: data.waiterApproval ? { text: 'Onay açık' } : undefined,
    backup: backup?.enabled && !backup.healthy && backup.lastSuccessAt ? { text: 'Kontrol et', warn: true } : undefined,
    blocked: blocks.length ? { text: `${blocks.length} engel` } : { text: 'Engel yok' },
    tableSetup: changed(network) ? { text: 'Adres değişti', warn: true } : reprintForInternet(network) ? { text: 'QR yeniden basılmalı', warn: true } : { text: `${data.tables.length} masa` },
  };
  const warnOf = (t: TopicInfo) => t.parts.map(p => partState[p.id]).find(s => s?.warn);

  const info = settingsTopics.find(t => t.id === topic)!, partInfo = parts.find(p => p.id === part)!;
  const pages: Record<SettingsPart, () => ReactNode> = {
    profile: () => <BusinessPage data={data} prefs={prefs} onSaved={onSaved} />,
    social: () => <SocialSettings data={data} onSaved={onSaved} />,
    package: () => <><PackageCard pkg={data.pkg} /><LicenseCard /></>,
    tableSetup: () => <TablesPage data={data} prefs={prefs} onSaved={onSaved} onTables={onTables} />,
    qrPrint: () => <QrPrintPage data={data} openQr={!!open?.qr && open.topic === 'tables'} onSaved={onSaved} />,
    blocked: () => <BlockedPage blocks={blocks} error={blockError} onUnblock={id => { setBlockError(''); void api('/api/staff/block', { orderId: id, blocked: false }).then(loadBlocks).catch(e => setBlockError(e.message)); }} />,
    orders: () => <OrdersPage data={data} prefs={prefs} onSaved={onSaved} />,
    kitchen: () => <KitchenPage data={data} onSaved={onSaved} />,
    integrations: () => <IntegrationsPage />,
    printers: () => <PrintersPage data={data} onCount={setPrinters} />,
    sounds: () => <SoundsPage />,
    devices: () => <DevicesPage />,
    backup: () => <BackupPage backup={backup} />,
    lock: () => <LockPage />,
    remote: () => <RemoteAccess />,
  };
  const current = partState[part];
  return <div className="settings-shell"><div className="settings-layout">
    {/* Tabs: icon and title; a chip only for what needs a look ("Eksik"). Quiet states ("8 masa") sit in the page's own head. */}
    <PillTabs label="Ayarlar konuları" className="settings-topics" wrapClassName="settings-topics-wrap" dataAttr="topic" value={topic} onChange={setTopic}
      items={shown.map(t => { const s = warnOf(t); return { id: t.id, label: t.title, icon: t.icon, title: t.line, ...(s ? { badge: s.text, badgeTone: 'warn' as const } : {}) }; })} />
    <section className={`settings-page${WIDE_PARTS.has(part) ? ' wide' : ''}`} aria-labelledby="settings-page-title" key={topic}>
      <header className="settings-page-head"><span className="settings-page-icon" aria-hidden="true"><info.icon size={22} /></span><div><h2 id="settings-page-title">{info.title}</h2><p>{partInfo.line}</p></div>
        {current && !current.warn && <span className="settings-page-state">{current.text}</span>}</header>
      {parts.length > 1 && <PillTabs label={`${info.title} bölümleri`} className="settings-parts" wrapClassName="settings-parts-wrap" variant="sub" dataAttr="part" value={part} onChange={setPart}
        items={parts.map(p => { const s = partState[p.id]; return { id: p.id, label: p.title, icon: p.icon, title: p.line, locked: !!partLocked(p.id), ...(s?.warn ? { badge: s.text, badgeTone: 'warn' as const } : {}) }; })} />}
      <div className="settings-page-body" key={part}>{partLocked(part) ? <FeatureLockView feature={partLocked(part)!} compact onClose={() => setPart(parts[0].id)} /> : pages[part]()}</div>
    </section>
  </div></div>;
}

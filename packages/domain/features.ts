/*
 * Mola's sellable services ("hizmetler"). One list shared by Mola Merkez (package builder, prices, Satışlarım), the signed
 * licence (which services a café may use) and the café (menus, server-side checks, the blurred "paketinizde yok" view).
 * Browser-safe: no node: imports. Prices are the vendor's starting suggestions (15 Ekim: the owner's own list,
 * docs/FIYAT_VE_RAKIPLER_2026-10.md E), monthly TRY without KDV; the vendor changes them in Mola Yönetim → Ayarlar → Hizmet fiyatları.
 * Retired ids (6 Ekim: 'manager-role', the Müdür account is part of the core now) may still sit in stored licences,
 * packages and prices: every reader drops ids it does not know (`isFeatureId`), nothing refuses them.
 * 15 Ekim (owner): "Uzaktan raporlar" and "Uzaktan yönetim" are sold as ONE service, "Uzaktan erişim". Both ids stay (licences,
 * old data and older cafés keep working): 'remote-reports' is the sellable one, 'remote-admin' is `partOf` it, never listed or
 * priced on its own, and every list holding 'remote-reports' holds it too (withRequirements here, enabledFeatures on the café).
 * The owner still switches Uzaktan yönetim on at the café (Ayarlar → Uzaktan erişim → 5), as before.
 */
export const featureIds = [
  'core', 'qr-menu', 'qr-order', 'reports-advanced', 'stock', 'reservations', 'shifts', 'social',
  'remote-reports', 'remote-admin', 'email-reports', 'split-screen', 'cloud-backup', 'integrations',
] as const;
export type FeatureId = typeof featureIds[number];

export type FeatureGroup = 'Sipariş ve servis' | 'Raporlar' | 'Ekler' | 'Uzaktan' | 'Cihaz ve güvenlik' | 'Yakında';
export type Feature = {
  id: FeatureId;
  name: string;
  /** One short line for the package builder and the café's "paketinizde yok" screen. */
  description: string;
  group: FeatureGroup;
  /** Starting monthly price in kuruş (vendor-editable). */
  monthly: number;
  /** Every package has it; can't be unticked. */
  required?: boolean;
  /** Other services this one needs. */
  requires?: FeatureId[];
  /** Not sellable yet (shown as "Yakında"). */
  soon?: boolean;
  /**
   * Sold inside another service (15 Ekim: 'remote-admin' in "Uzaktan erişim"): every list with that service has this one too;
   * it is not shown, chosen or priced on its own (a stored price for it is ignored).
   */
  partOf?: FeatureId;
};

const TL = 100;
export const features: Feature[] = [
  { id: 'core', name: 'Adisyon çekirdeği', group: 'Sipariş ve servis', monthly: 750 * TL, required: true,
    description: 'Masalar, sipariş, masasız satış, mutfak ekranı ve fişi, kasa ve gün sonu, menü, kampanyalar, temel raporlar, müdür hesabı, Android uygulaması.' },
  { id: 'qr-menu', name: 'QR menü', group: 'Sipariş ve servis', monthly: 200 * TL,
    description: 'Masadaki QR koduyla çok dilli dijital menü.' },
  { id: 'qr-order', name: 'QR sipariş ve garson çağırma', group: 'Sipariş ve servis', monthly: 300 * TL, requires: ['qr-menu'],
    description: 'Müşteri telefonundan sipariş verir, garson çağırır, hesap ister.' },
  { id: 'reports-advanced', name: 'Gelişmiş raporlar', group: 'Raporlar', monthly: 100 * TL,
    description: 'Yazdır/PDF, muhasebeci için Excel, KDV dökümü, kanal ve dönem karşılaştırmaları.' },
  { id: 'stock', name: 'Stok, reçete ve kârlılık', group: 'Ekler', monthly: 650 * TL,
    description: 'Malzeme stoğu, reçeteler, "kaç adet yapılabilir", ürün bazında kâr.' },
  { id: 'reservations', name: 'Rezervasyon ve etkinlik', group: 'Ekler', monthly: 50 * TL,
    description: 'Masa ayırma, kapora, maç günü etkinlikleri ve geçici masalar.' },
  { id: 'shifts', name: 'Vardiya, bahşiş ve personel raporu', group: 'Ekler', monthly: 20 * TL,
    description: 'Vardiya takibi, bahşiş paylaşımı, çalışan verimliliği.' },
  // 6 Ekim (owner): paid from now on. The Google review link and the after-payment "Google'da değerlendirin" button stay core.
  { id: 'social', name: 'Sosyal medya ve QR kartları', group: 'Ekler', monthly: 20 * TL,
    description: 'Sosyal medya bağlantıları, menüde takip logoları, kalıcı QR kartları (Instagram, Google ve diğerleri).' },
  // 15 Ekim (owner): one service (before: Uzaktan raporlar ₺200 + Uzaktan yönetim ₺100). The id stays 'remote-reports'.
  { id: 'remote-reports', name: 'Uzaktan erişim', group: 'Uzaktan', monthly: 130 * TL,
    description: 'İşletme sahibi telefonundan ya da laptopundan kafem.molayazilim.com.tr adresinden satışları ve raporları görür; kasa açıkken menü, ayarlar ve bütün ekranları yönetir. Uçtan uca şifreli; kasa kapalıyken son durum.' },
  { id: 'remote-admin', name: 'Uzaktan yönetim', group: 'Uzaktan', monthly: 0, requires: ['remote-reports'], partOf: 'remote-reports',
    description: 'Uzaktan erişimin parçası: kasa açıkken şifre ve telefon koduyla kafenin bütün ekranları; kafede Ayarlar → Uzaktan erişim’den açılır.' },
  { id: 'email-reports', name: 'E-posta raporları', group: 'Uzaktan', monthly: 30 * TL,
    description: 'Gün, hafta, ay ve yıl sonu raporları PDF ekiyle e-postaya gelir.' },
  { id: 'split-screen', name: 'İki ekran', group: 'Cihaz ve güvenlik', monthly: 50 * TL,
    description: 'Kasa bilgisayarında ekranı ikiye bölüp iki hesap yan yana.' },
  { id: 'cloud-backup', name: 'Bulutta şifreli yedek', group: 'Cihaz ve güvenlik', monthly: 300 * TL,
    description: 'Yedeklerin şifreli kopyası Mola sunucusunda; yeni bilgisayara kolay taşıma.' },
  { id: 'integrations', name: 'Paket servis platformları', group: 'Yakında', monthly: 125 * TL, soon: true,
    description: 'Yemeksepeti, Getir, Trendyol siparişleri mutfağa düşer (platform başına).' },
];
export const featureById = new Map(features.map(f => [f.id, f]));
/** A known service id (old data may hold retired ones, such as 'manager-role'). */
export const isFeatureId = (id: unknown): id is FeatureId => typeof id === 'string' && featureById.has(id as FeatureId);
/** Sold inside another service ('remote-admin'): left out of every list, count and price shown. */
export const isPartFeature = (id: FeatureId) => !!featureById.get(id)?.partOf;
/** The services as people see them: without the ones sold inside another. */
export const shownFeatures = (ids: readonly FeatureId[]): FeatureId[] => ids.filter(id => !isPartFeature(id));
/** The parts that come with a service (Uzaktan erişim → Uzaktan yönetim). */
export const partsOf = (id: FeatureId): FeatureId[] => features.filter(f => f.partOf === id).map(f => f.id);

export type PackageTemplate = { id: string; name: string; features: FeatureId[]; discount?: { kind: 'amount' | 'percent'; value: number } };
/**
 * Starting packages (vendor-editable). 15 Ekim (owner's prices, KDV hariç): Çay bahçesi ₺980, Kafe Standart ₺2.060 − ₺110
 * paket indirimi = ₺1.950, Restoran Pro ₺2.600 a month.
 */
export const defaultPackages: PackageTemplate[] = [
  { id: 'cay-bahcesi', name: 'Çay bahçesi', features: ['core', 'qr-menu', 'email-reports'] },
  { id: 'kafe-standart', name: 'Kafe Standart', features: ['core', 'qr-menu', 'qr-order', 'stock', 'remote-reports', 'remote-admin', 'email-reports'], discount: { kind: 'amount', value: 110 * TL } },
  { id: 'restoran-pro', name: 'Restoran Pro', features: ['core', 'qr-menu', 'qr-order', 'stock', 'remote-reports', 'remote-admin', 'email-reports', 'reservations', 'shifts', 'split-screen', 'reports-advanced', 'social', 'cloud-backup'] },
];

/** Adds what a choice needs (core, each requirement, the parts sold inside a chosen service) so a package is always valid. */
export function withRequirements(chosen: Iterable<FeatureId>): FeatureId[] {
  const out = new Set<FeatureId>(['core', ...chosen]);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...out]) for (const need of [...featureById.get(id)?.requires ?? [], ...partsOf(id)]) if (!out.has(need)) { out.add(need); changed = true; }
  }
  return featureIds.filter(id => out.has(id));
}
/** Monthly total in kuruş for a set of services with the given prices (defaults when a price is missing); parts cost nothing. */
export function monthlyTotal(ids: Iterable<FeatureId>, prices: Partial<Record<FeatureId, number>> = {}) {
  let sum = 0;
  for (const id of new Set(ids)) { const f = featureById.get(id); if (f && !f.soon && !f.partOf) sum += prices[id] ?? f.monthly; }
  return sum;
}
/** Yearly price = 10 months (the vendor's chosen discount). */
export const yearlyFromMonthly = (monthly: number) => monthly * 10;

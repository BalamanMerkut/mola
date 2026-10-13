/*
 * Mola's sellable services ("hizmetler"). One list shared by Mola Merkez (package builder, prices, Satışlarım), the signed
 * licence (which services a café may use) and the café (menus, server-side checks, the blurred "paketinizde yok" view).
 * Browser-safe: no node: imports. Prices are the vendor's starting suggestions (docs/FIYAT_ARASTIRMASI.md), monthly TRY
 * without KDV; the vendor changes them in Mola Yönetim → Ayarlar → Hizmet fiyatları.
 * Retired ids (6 Ekim: 'manager-role', the Müdür account is part of the core now) may still sit in stored licences,
 * packages and prices: every reader drops ids it does not know (`isFeatureId`), nothing refuses them.
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
};

const TL = 100;
export const features: Feature[] = [
  { id: 'core', name: 'Adisyon çekirdeği', group: 'Sipariş ve servis', monthly: 750 * TL, required: true,
    description: 'Masalar, sipariş, masasız satış, mutfak ekranı ve fişi, kasa ve gün sonu, menü, kampanyalar, temel raporlar, müdür hesabı, Android uygulaması.' },
  { id: 'qr-menu', name: 'QR menü', group: 'Sipariş ve servis', monthly: 200 * TL,
    description: 'Masadaki QR koduyla çok dilli dijital menü.' },
  { id: 'qr-order', name: 'QR sipariş ve garson çağırma', group: 'Sipariş ve servis', monthly: 150 * TL, requires: ['qr-menu'],
    description: 'Müşteri telefonundan sipariş verir, garson çağırır, hesap ister.' },
  { id: 'reports-advanced', name: 'Gelişmiş raporlar', group: 'Raporlar', monthly: 150 * TL,
    description: 'Yazdır/PDF, muhasebeci için Excel, KDV dökümü, kanal ve dönem karşılaştırmaları.' },
  { id: 'stock', name: 'Stok, reçete ve kârlılık', group: 'Ekler', monthly: 250 * TL,
    description: 'Malzeme stoğu, reçeteler, "kaç adet yapılabilir", ürün bazında kâr.' },
  { id: 'reservations', name: 'Rezervasyon ve etkinlik', group: 'Ekler', monthly: 150 * TL,
    description: 'Masa ayırma, kapora, maç günü etkinlikleri ve geçici masalar.' },
  { id: 'shifts', name: 'Vardiya, bahşiş ve personel raporu', group: 'Ekler', monthly: 150 * TL,
    description: 'Vardiya takibi, bahşiş paylaşımı, çalışan verimliliği.' },
  // 6 Ekim (owner): paid from now on. The Google review link and the after-payment "Google'da değerlendirin" button stay core.
  { id: 'social', name: 'Sosyal medya ve QR kartları', group: 'Ekler', monthly: 75 * TL,
    description: 'Sosyal medya bağlantıları, menüde takip logoları, kalıcı QR kartları (Instagram, Google ve diğerleri).' },
  { id: 'remote-reports', name: 'Uzaktan raporlar', group: 'Uzaktan', monthly: 200 * TL,
    description: 'İşletme sahibi telefonundan, uçtan uca şifreli raporlara bakar.' },
  { id: 'remote-admin', name: 'Uzaktan yönetim', group: 'Uzaktan', monthly: 100 * TL, requires: ['remote-reports'],
    description: 'Eşleştirilmiş cihazdan, şifre ve telefon koduyla kafeyi yönetir.' },
  { id: 'email-reports', name: 'E-posta raporları', group: 'Uzaktan', monthly: 75 * TL,
    description: 'Gün, hafta, ay ve yıl sonu raporları PDF ekiyle e-postaya gelir.' },
  { id: 'split-screen', name: 'İki ekran', group: 'Cihaz ve güvenlik', monthly: 100 * TL,
    description: 'Kasa bilgisayarında ekranı ikiye bölüp iki hesap yan yana.' },
  { id: 'cloud-backup', name: 'Bulutta şifreli yedek', group: 'Cihaz ve güvenlik', monthly: 100 * TL,
    description: 'Yedeklerin şifreli kopyası Mola sunucusunda; yeni bilgisayara kolay taşıma.' },
  { id: 'integrations', name: 'Paket servis platformları', group: 'Yakında', monthly: 125 * TL, soon: true,
    description: 'Yemeksepeti, Getir, Trendyol siparişleri mutfağa düşer (platform başına).' },
];
export const featureById = new Map(features.map(f => [f.id, f]));
/** A known service id (old data may hold retired ones, such as 'manager-role'). */
export const isFeatureId = (id: unknown): id is FeatureId => typeof id === 'string' && featureById.has(id as FeatureId);

export type PackageTemplate = { id: string; name: string; features: FeatureId[] };
/** Starting packages (vendor-editable). */
export const defaultPackages: PackageTemplate[] = [
  { id: 'cay-bahcesi', name: 'Çay bahçesi', features: ['core', 'qr-menu', 'email-reports'] },
  { id: 'kafe-standart', name: 'Kafe Standart', features: ['core', 'qr-menu', 'qr-order', 'stock', 'remote-reports', 'email-reports'] },
  { id: 'restoran-pro', name: 'Restoran Pro', features: ['core', 'qr-menu', 'qr-order', 'stock', 'remote-reports', 'remote-admin', 'email-reports', 'reservations', 'shifts', 'split-screen', 'reports-advanced', 'social', 'cloud-backup'] },
];

/** Adds what a choice needs (core, and each requirement) so a package is always valid. */
export function withRequirements(chosen: Iterable<FeatureId>): FeatureId[] {
  const out = new Set<FeatureId>(['core', ...chosen]);
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...out]) for (const need of featureById.get(id)?.requires ?? []) if (!out.has(need)) { out.add(need); changed = true; }
  }
  return featureIds.filter(id => out.has(id));
}
/** Monthly total in kuruş for a set of services with the given prices (defaults when a price is missing). */
export function monthlyTotal(ids: Iterable<FeatureId>, prices: Partial<Record<FeatureId, number>> = {}) {
  let sum = 0;
  for (const id of new Set(ids)) { const f = featureById.get(id); if (f && !f.soon) sum += prices[id] ?? f.monthly; }
  return sum;
}
/** Yearly price = 10 months (the vendor's chosen discount). */
export const yearlyFromMonthly = (monthly: number) => monthly * 10;

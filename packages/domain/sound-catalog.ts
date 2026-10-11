/*
 * Ayarlar → Sesler: which notification sound each event plays, for the whole business (every tablet the same). The sounds
 * themselves are synthesized in the browser (src/sounds.ts); only the choice is stored (State.sounds). Volume is not
 * stored: it belongs to each device.
 * Browser-safe on purpose (no engine.ts, which pulls in node:crypto): the screens import this file directly.
 */
export const soundIds = ['zil', 'can', 'dingdong', 'uclu', 'kus', 'damla', 'marimba', 'gong', 'bip', 'ciftbip', 'yukselen', 'alcalan', 'kristal', 'arp', 'davul', 'klik', 'nazik', 'acil', 'retro', 'mutfak'] as const;
export type SoundId = typeof soundIds[number];
export const soundNames: Record<SoundId, string> = {
  zil: 'Zil', can: 'Çan', dingdong: 'Ding-dong', uclu: 'Üçlü melodi', kus: 'Kuş', damla: 'Damla', marimba: 'Marimba', gong: 'Gong',
  bip: 'Kısa bip', ciftbip: 'Çift bip', yukselen: 'Yükselen', alcalan: 'Alçalan', kristal: 'Kristal', arp: 'Arp', davul: 'Davul',
  klik: 'Klik', nazik: 'Nazik', acil: 'Acil', retro: 'Retro', mutfak: 'Mutfak zili',
};

/**
 * `externalOrder`: a delivery platform order (StaffSnapshot.externalOrders waiting for Kabul, or an accepted Order.external)
 * plays this instead of the kitchen/approval sound, once per platform order.
 */
export const soundEvents = ['waiterCall', 'billRequest', 'approval', 'kitchen', 'ready', 'externalOrder', 'kitchenCancel', 'printError', 'notification'] as const;
export type SoundEvent = typeof soundEvents[number];
export const soundEventNames: Record<SoundEvent, string> = {
  waiterCall: 'Garson çağrısı', billRequest: 'Hesap isteme', approval: 'Yeni QR siparişi (onay bekliyor)',
  kitchen: 'Mutfağa yeni sipariş', ready: 'Sipariş hazır (garsona)', externalOrder: 'Dış platform siparişi',
  kitchenCancel: 'Sipariş iptali (mutfağa)', printError: 'Mutfak fişi basılamadı (yazıcı hatası)',
  notification: 'Bildirim sesi',
};
// The sounds play wherever the person is in Mola (Stok, Hesabım…), not only on the screen named here.
export const soundEventWhere: Record<SoundEvent, string> = {
  waiterCall: 'Garson, kasiyer, müdür ve işletme sahibi ekranlarında çalar. Garson ataması açıksa garsonlardan yalnız o masanın garsonunda.',
  billRequest: 'Garson, kasiyer, müdür ve işletme sahibi ekranlarında çalar. Garson ataması açıksa garsonlardan yalnız o masanın garsonunda.',
  approval: 'Mutfak, garson, müdür ve işletme sahibi ekranlarında çalar.',
  kitchen: 'Mutfak ekranında çalar.',
  ready: 'Garson ekranında çalar; garson ataması açıksa yalnız o masanın garsonunda. Kuryeyle giden platform siparişlerinde çalmaz.',
  externalOrder: 'Yemeksepeti, Getir gibi platformlardan sipariş gelince mutfakta, kasiyerde, müdürde ve işletme sahibinde çalar; normal sipariş sesi yerine.',
  kitchenCancel: 'Garson, işletme sahibi ya da müşteri bir siparişi veya ürünü iptal edince (ya da iptal isteyince) mutfakta çalar.',
  printError: 'Mutfak fiş modundayken bir sipariş mutfak yazıcısından çıkamayınca kasiyer, müdür, işletme sahibi ve garson ekranlarında çalar.',
  notification: 'Zile yeni bir bildirim gelince (iade isteği, kasa farkı, biten kampanya…) işletme sahibi ve müdür ekranlarında çalar. Başlangıçta kapalıdır.',
};

export type SoundChoice = { sound: SoundId; on: boolean };
export type SoundSettings = Partial<Record<SoundEvent, SoundChoice>>;
/**
 * The three sounds staff already knew stay the defaults: Üçlü melodi (order), Ding-dong (waiter call), Çift bip (bill).
 * A QR order waiting for approval rings differently from a new order to prepare (Damla), a cancellation falls (Alçalan).
 * Only differences from these are stored, so an owner's explicit choice for an event stays as it is.
 */
export const defaultSounds: Record<SoundEvent, SoundChoice> = {
  waiterCall: { sound: 'dingdong', on: true }, billRequest: { sound: 'ciftbip', on: true },
  approval: { sound: 'damla', on: true }, kitchen: { sound: 'uclu', on: true },
  ready: { sound: 'mutfak', on: true }, externalOrder: { sound: 'acil', on: true },
  kitchenCancel: { sound: 'alcalan', on: true }, printError: { sound: 'gong', on: true },
  // 10 Ekim: the bell's own sound is off until the owner switches it on (the toast and the count are already there).
  notification: { sound: 'nazik', on: false },
};
export const isSound = (v: unknown): v is SoundId => typeof v === 'string' && (soundIds as readonly string[]).includes(v);
/** Every event with a valid choice: stored values where they are valid, defaults elsewhere (old data, unknown ids). */
export function resolveSounds(stored?: SoundSettings | null): Record<SoundEvent, SoundChoice> {
  const out = {} as Record<SoundEvent, SoundChoice>;
  for (const event of soundEvents) {
    const s = stored?.[event], d = defaultSounds[event];
    out[event] = { sound: isSound(s?.sound) ? s.sound : d.sound, on: typeof s?.on === 'boolean' ? s.on : d.on };
  }
  return out;
}

import { DomainError, requireRole } from './engine.js';
import { defaultSounds, isSound, resolveSounds, soundEvents, type SoundChoice, type SoundEvent, type SoundId, type SoundSettings } from './sound-catalog.js';
import type { Actor, State } from './types.js';

// The catalogue lives in sound-catalog.ts (browser-safe); this file adds the owner's change, which needs engine.ts.
export * from './sound-catalog.js';

/** Owner only (and Mola destek while allowed). Changes one event; only differences from the defaults are kept, so the stored field stays small. */
export function setSoundChoice(s: State, actor: Actor, change: { event: SoundEvent; sound?: SoundId; on?: boolean }, now: Date) {
  requireRole(s, actor, ['owner', 'support']);
  if (!(soundEvents as readonly string[]).includes(change.event)) throw new DomainError('INVALID_SOUND', 'Bilinmeyen bildirim.');
  if (change.sound !== undefined && !isSound(change.sound)) throw new DomainError('INVALID_SOUND', 'Bu ses bulunamadı.');
  const current = resolveSounds(s.sounds)[change.event];
  const next: SoundChoice = { sound: change.sound ?? current.sound, on: change.on ?? current.on };
  const d = defaultSounds[change.event], kept: SoundSettings = { ...s.sounds };
  if (next.sound === d.sound && next.on === d.on) delete kept[change.event]; else kept[change.event] = next;
  s.sounds = Object.keys(kept).length ? kept : undefined;
  if (!s.sounds) delete s.sounds;
  s.audit.push({ action: 'settings.sound_changed', actor: actor.id, target: change.event, at: now.toISOString() });
  return resolveSounds(s.sounds);
}

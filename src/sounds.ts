import { useEffect, useSyncExternalStore } from 'react';
import { resolveSounds, soundIds, type SoundChoice, type SoundEvent, type SoundId } from '../packages/domain/sound-catalog';
import { api } from './api';

export { soundIds, soundNames, soundEvents, soundEventNames, soundEventWhere, type SoundEvent, type SoundId } from '../packages/domain/sound-catalog';

/*
 * Twenty short notification sounds, made on the spot with the Web Audio API: no audio files, nothing to license.
 * They differ in rhythm, direction and timbre (not only pitch), so staff can tell them apart from across the room.
 * Which event plays which sound is chosen per business in Ayarlar → Sesler; the volume belongs to each device.
 */
type Tone = { at: number; f: number; len: number; vol: number; wave?: OscillatorType; to?: number; attack?: number; partials?: [ratio: number, gain: number][] };
type Noise = { at: number; len: number; vol: number; band: number; q?: number };
type Sound = { tones: Tone[]; noise?: Noise[] };

const seq = (notes: number[], step: number, tone: Omit<Tone, 'at' | 'f'>): Tone[] => notes.map((f, i) => ({ ...tone, at: i * step, f }));
const sounds: Record<SoundId, Sound> = {
  // A quick telephone-like trill, twice.
  zil: { tones: [0, .45].flatMap(b => Array.from({ length: 6 }, (_, i) => ({ at: b + i * .05, f: i % 2 ? 1661 : 1318, len: .07, wave: 'triangle' as const, vol: .14 }))) },
  // One deep bell stroke with inharmonic overtones and a long ring.
  can: { tones: [{ at: 0, f: 523, len: 1.6, vol: .2, attack: .005, partials: [[2, .5], [2.76, .35], [5.4, .15]] }] },
  // Waiter call until now: a soft falling door bell.
  dingdong: { tones: [{ at: 0, f: 784, len: .6, wave: 'sine', vol: .26 }, { at: .34, f: 587, len: .75, wave: 'sine', vol: .26 }] },
  // Kitchen order until now: a short rising three-note bell.
  uclu: { tones: seq([740, 988, 1318], .16, { len: .38, wave: 'triangle', vol: .22 }) },
  // Three little chirps and a falling call.
  kus: { tones: [...[0, .12, .24].map(at => ({ at, f: 2200, to: 3400, len: .09, vol: .13 })), { at: .42, f: 2700, to: 1900, len: .16, vol: .13 }] },
  // Two water drops: very fast upward glides.
  damla: { tones: [{ at: 0, f: 600, to: 1500, len: .15, vol: .3, attack: .002 }, { at: .24, f: 720, to: 1750, len: .15, vol: .28, attack: .002 }] },
  // Wooden bars: a bright attack that dies quickly.
  marimba: { tones: seq([523, 659, 784, 1047], .12, { len: .34, vol: .3, attack: .003, partials: [[3.93, .22], [9.2, .05]] }) },
  // A low gong: slow attack, long wobbling ring.
  gong: { tones: [{ at: 0, f: 196, to: 190, len: 2.2, vol: .24, attack: .03, partials: [[1.47, .6], [2.09, .5], [2.56, .35], [3.37, .2]] }] },
  bip: { tones: [{ at: 0, f: 1000, len: .14, wave: 'square', vol: .07, attack: .005 }] },
  // Bill request until now: two quick bright taps, like a counter bell.
  ciftbip: { tones: [{ at: 0, f: 1568, len: .16, wave: 'triangle', vol: .2 }, { at: .19, f: 1568, len: .22, wave: 'triangle', vol: .2 }] },
  yukselen: { tones: [{ at: 0, f: 440, to: 1320, len: .55, vol: .22, attack: .03 }] },
  alcalan: { tones: [{ at: 0, f: 1320, to: 440, len: .55, vol: .22, attack: .03 }] },
  // High glass tones with a long shimmer.
  kristal: { tones: seq([1760, 2349, 2794], .09, { len: .95, vol: .11, attack: .004, partials: [[2, .25], [3.01, .08]] }) },
  // A quick rising arpeggio over two octaves.
  arp: { tones: seq([523, 659, 784, 1047, 1319], .065, { len: .3, wave: 'triangle', vol: .17 }) },
  // Two tom-tom hits: falling pitch plus a short skin noise.
  davul: { tones: [0, .2].map(at => ({ at, f: 180, to: 60, len: .32, vol: .5, attack: .002 })), noise: [0, .2].map(at => ({ at, len: .05, vol: .15, band: 1200 })) },
  klik: { tones: [0, .12].map(at => ({ at, f: 2400, len: .03, vol: .1, attack: .001 })), noise: [0, .12].map(at => ({ at, len: .025, vol: .4, band: 3500, q: 2 })) },
  // Gentle: two slow-rising soft tones.
  nazik: { tones: [{ at: 0, f: 660, len: .9, vol: .16, attack: .08 }, { at: .25, f: 880, len: 1, vol: .14, attack: .08 }] },
  // Urgent: a fast two-tone alarm.
  acil: { tones: seq([988, 740, 988, 740, 988, 740], .13, { len: .12, wave: 'square', vol: .08, attack: .004 }) },
  // An 8-bit coin.
  retro: { tones: [{ at: 0, f: 988, len: .08, wave: 'square', vol: .07, attack: .002 }, { at: .08, f: 1319, len: .4, wave: 'square', vol: .07, attack: .002 }] },
  // Kitchen pass bell ("order up"): two strikes of a bright bell.
  mutfak: { tones: [0, .28].map(at => ({ at, f: 2093, len: 1, vol: .13, attack: .002, partials: [[2.32, .4], [4.1, .15]] as [number, number][] })) },
};

/** Seconds from the first note to the end of the last one. */
export const soundLength = (id: SoundId) => Math.max(...sounds[id].tones.map(t => t.at + t.len), ...(sounds[id].noise ?? []).map(n => n.at + n.len));
/** Number of oscillators a sound starts (tests count them). */
export const soundVoices = (id: SoundId) => sounds[id].tones.reduce((n, t) => n + 1 + (t.partials?.length ?? 0), 0);

const VOLUME_KEY = 'mola-sound-volume';
/** This device's volume, 0–1 (default full): each tablet sits in a different place, so it is not shared. */
export function deviceVolume() { try { const v = Number(localStorage.getItem(VOLUME_KEY)); return localStorage.getItem(VOLUME_KEY) === null || !Number.isFinite(v) ? 1 : Math.min(1, Math.max(0, v)); } catch { return 1; } }
export function setDeviceVolume(v: number) { try { localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, v)))); } catch { /* preference only */ } }

/** Plays one sound; returns its length in seconds (0 when nothing played: context not unlocked yet, or volume 0). */
export function playSound(ctx: AudioContext, id: SoundId, delay = 0, volume = deviceVolume()) {
  const sound = sounds[id];
  if (!sound || ctx.state !== 'running' || volume <= 0) return 0;
  const master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  const begin = ctx.currentTime + delay;
  for (const t of sound.tones) for (const [ratio, level] of [[1, 1], ...(t.partials ?? [])] as [number, number][]) {
    const oscillator = ctx.createOscillator(), gain = ctx.createGain(), start = begin + t.at, end = start + t.len;
    oscillator.type = t.wave ?? 'sine';
    if (t.to) { oscillator.frequency.setValueAtTime(t.f * ratio, start); oscillator.frequency.exponentialRampToValueAtTime(t.to * ratio, start + t.len * .8); }
    else oscillator.frequency.value = t.f * ratio;
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(t.vol * level, start + (t.attack ?? .012)); gain.gain.exponentialRampToValueAtTime(.001, end);
    oscillator.connect(gain); gain.connect(master); oscillator.start(start); oscillator.stop(end + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  for (const n of sound.noise ?? []) {
    const frames = Math.max(1, Math.round(ctx.sampleRate * n.len)), buffer = ctx.createBuffer(1, frames, ctx.sampleRate), samples = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), start = begin + n.at;
    source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = n.band; filter.Q.value = n.q ?? 1;
    gain.gain.value = n.vol; source.connect(filter); filter.connect(gain); gain.connect(master); source.start(start);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  const length = soundLength(id);
  setTimeout(() => { try { master.disconnect(); } catch { /* already gone */ } }, (delay + length + .3) * 1000);
  return length;
}

// The business-wide choices, shared by every sound on this screen; read again now and then, so the owner's change reaches each tablet.
let choices = resolveSounds();
const listeners = new Set<() => void>();
let lastRead = 0, reading: Promise<void> | null = null;
export function setSoundChoices(next: Record<SoundEvent, SoundChoice>) { choices = resolveSounds(next); for (const l of listeners) l(); }
export function refreshSoundChoices(force = false) {
  if (reading || (!force && Date.now() - lastRead < 30_000)) return reading ?? Promise.resolve();
  reading = api<Record<SoundEvent, SoundChoice>>('/api/staff/sounds').then(setSoundChoices).catch(() => { /* keep the last known choice */ }).finally(() => { lastRead = Date.now(); reading = null; });
  return reading;
}
export const soundChoice = (event: SoundEvent) => choices[event];
/** Live choices for a screen that shows them (Ayarlar → Sesler) or plays them; keeps them fresh every minute while visible. */
export function useSoundChoices() {
  useEffect(() => {
    void refreshSoundChoices(true);
    const again = () => { if (!document.hidden) void refreshSoundChoices(); };
    const t = setInterval(again, 60_000); document.addEventListener('visibilitychange', again);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', again); };
  }, []);
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => choices);
}
/** Plays the event's chosen sound when that event is switched on; returns the length (0 = silent). */
export function playEvent(ctx: AudioContext, event: SoundEvent, delay = 0) {
  const c = choices[event];
  return c.on ? playSound(ctx, c.sound, delay) : 0;
}

const platformOf = (v: unknown) => typeof v === 'object' && v !== null && typeof (v as { platform?: unknown }).platform === 'string';
/** An order from a delivery platform (Order.external.platform; also a `source: { platform }` object), so it gets the "Dış platform siparişi" sound. */
export const fromPlatform = (order: { external?: unknown; source?: unknown }) => platformOf(order.external) || platformOf(order.source);
/** A delivery platform order, as the waiting list (StaffSnapshot.externalOrders) or an accepted order (Order.external) shows it. */
export type PlatformRef = { platform: string; externalId: string };
const heardPlatform = new Set<string>();
/**
 * One sound per platform order on this screen, whether it first appears waiting for Kabul or already accepted (automatic
 * acceptance). Returns how many were new; `silent` only notes them (what was already there when the screen opened).
 */
export function newPlatformOrders(list: PlatformRef[], silent = false) {
  let fresh = 0;
  for (const x of list) { const key = `${x.platform}:${x.externalId}`; if (!heardPlatform.has(key)) { heardPlatform.add(key); if (!silent) fresh++; } }
  return fresh;
}

/** At most one chime per kind of event every COALESCE_MS on a screen: a rush of ready orders rings once, not ten times. */
export const COALESCE_MS = 5000;
const lastRung = new WeakMap<AudioContext, Map<SoundEvent, number>>();
/**
 * Plays several events one after another, each once (two waiter calls arriving together ring once), and skips a kind that
 * already rang on this screen in the last COALESCE_MS. Returns the events that actually played.
 */
export function playEvents(ctx: AudioContext, events: SoundEvent[], now = Date.now()) {
  const rung = lastRung.get(ctx) ?? new Map<SoundEvent, number>(), played: SoundEvent[] = [];
  lastRung.set(ctx, rung);
  [...new Set(events)].filter(event => !(now - (rung.get(event) ?? -Infinity) < COALESCE_MS)).reduce((delay, event) => {
    const length = playEvent(ctx, event, delay);
    if (!length) return delay;
    rung.set(event, now); played.push(event);
    return delay + length + .25;
  }, 0);
  return played;
}

/**
 * What a screen's sound has already announced, kept for the whole page visit per person: moving between views (Mutfak →
 * Stok → Mutfak) or a screen that mounts again never marks orders that arrived meanwhile as heard. `first` is true only for
 * the very first look of this page visit, when what is already on screen is noted silently.
 */
const heard = new Map<string, Set<string>>();
export function alertMemory(key: string) {
  const known = heard.get(key);
  if (known) return { seen: known, first: false };
  const seen = new Set<string>(); heard.set(key, seen);
  return { seen, first: true };
}
/** Forgets a person's memory (sign-out), so the next sign-in starts quiet again. */
export function forgetAlerts(prefix: string) { for (const key of [...heard.keys()]) if (key.startsWith(prefix)) heard.delete(key); }

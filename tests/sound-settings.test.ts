import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed.js';
import { defaultSounds, resolveSounds, setSoundChoice, soundEvents, soundIds, soundNames } from '../packages/domain/sound-settings.js';
import type { Actor } from '../packages/domain/types.js';
import { fromPlatform, playEvent, playEvents, playSound, setSoundChoices, soundLength, soundVoices } from '../src/sounds.js';
import { orderAlerts } from '../src/ServiceCallBar.js';
import { kitchenAlerts } from '../src/KitchenSound.js';

const owner: Actor = { tenantId: 'mola-demo', id: 'owner', role: 'owner' };
const now = new Date('2026-10-04T10:00:00Z');

/** A small stand-in for the browser's AudioContext: counts started oscillators and their frequencies. */
function fakeAudio(state: AudioContextState = 'running') {
  const started: { frequency: number; at: number; type?: string; to?: number }[] = [];
  const param = () => { const p = { value: 0, to: undefined as number | undefined, setValueAtTime(v: number) { p.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(v: number) { p.to = v; } }; return p; };
  const node = () => ({ connect() {}, disconnect() {} });
  const ctx = {
    state, currentTime: 0, sampleRate: 8000, destination: {},
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => { const o = { ...node(), type: 'sine', frequency: param(), onended: null, start(at: number) { started.push({ frequency: o.frequency.value, at, type: o.type, ...(o.frequency.to ? { to: o.frequency.to } : {}) }); }, stop() {} }; return o; },
    createBuffer: (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) }),
    createBufferSource: () => ({ ...node(), buffer: null, onended: null, start() {} }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
  };
  return { ctx: ctx as unknown as AudioContext, started };
}

test('twenty sounds with Turkish names, each short and each different', () => {
  assert.equal(soundIds.length, 20);
  assert.equal(new Set(Object.values(soundNames)).size, 20);
  for (const id of soundIds) {
    const length = soundLength(id);
    assert.ok(length > .05 && length <= 2.3, `${id}: ${length}s`);
    const { ctx, started } = fakeAudio();
    assert.equal(playSound(ctx, id, 0, 1), length);
    assert.equal(started.length, soundVoices(id), id);
  }
  // Distinguishable: no two sounds share the same pattern of start times and pitches.
  const signature = (id: typeof soundIds[number]) => { const { ctx, started } = fakeAudio(); playSound(ctx, id, 0, 1); return JSON.stringify(started); };
  assert.equal(new Set(soundIds.map(signature)).size, 20);
});

test('nothing plays before the browser unlocks sound or at volume 0', () => {
  const locked = fakeAudio('suspended');
  assert.equal(playSound(locked.ctx, 'zil'), 0); assert.equal(locked.started.length, 0);
  const quiet = fakeAudio();
  assert.equal(playSound(quiet.ctx, 'zil', 0, 0), 0); assert.equal(quiet.started.length, 0);
});

test('the three sounds staff know stay the defaults and keep their notes', () => {
  assert.deepEqual(resolveSounds(), defaultSounds);
  assert.equal(defaultSounds.kitchen.sound, 'uclu'); assert.equal(defaultSounds.waiterCall.sound, 'dingdong'); assert.equal(defaultSounds.billRequest.sound, 'ciftbip');
  const order = fakeAudio(); playSound(order.ctx, 'uclu', 0, 1);
  assert.deepEqual(order.started.map(n => [n.frequency, n.type]), [[740, 'triangle'], [988, 'triangle'], [1318, 'triangle']]);
  const waiter = fakeAudio(); playSound(waiter.ctx, 'dingdong', 0, 1);
  assert.deepEqual(waiter.started.map(n => n.frequency), [784, 587]);
});

test('the owner chooses a sound per event; only differences are stored; staff cannot change it', () => {
  const s = seed();
  assert.equal(s.sounds, undefined);
  const result = setSoundChoice(s, owner, { event: 'waiterCall', sound: 'kus' }, now);
  assert.deepEqual(result.waiterCall, { sound: 'kus', on: true });
  assert.deepEqual(s.sounds, { waiterCall: { sound: 'kus', on: true } });
  setSoundChoice(s, owner, { event: 'ready', on: false }, now);
  assert.deepEqual(resolveSounds(s.sounds).ready, { sound: 'mutfak', on: false });
  // Back to the default: the stored field disappears again.
  setSoundChoice(s, owner, { event: 'waiterCall', sound: 'dingdong' }, now); setSoundChoice(s, owner, { event: 'ready', on: true }, now);
  assert.equal(s.sounds, undefined);
  assert.equal(s.audit.filter(a => a.action === 'settings.sound_changed').length, 4);
  for (const role of ['waiter', 'kitchen', 'cashier'] as const) assert.throws(() => setSoundChoice(s, { ...owner, role }, { event: 'kitchen', sound: 'gong' }, now), /yetkiniz yok/);
  assert.throws(() => setSoundChoice(s, owner, { event: 'kitchen', sound: 'yok' as never }, now), /bulunamadı/);
  // Old or broken stored values fall back to the defaults.
  assert.deepEqual(resolveSounds({ kitchen: { sound: 'eski' as never, on: 'evet' as never } }).kitchen, defaultSounds.kitchen);
  assert.deepEqual(Object.keys(resolveSounds()), [...soundEvents]);
});

test('an event plays its chosen sound, a switched-off event stays silent, platform orders get their own sound', () => {
  setSoundChoices({ ...defaultSounds, kitchen: { sound: 'gong', on: true }, approval: { sound: 'uclu', on: false } });
  const kitchen = fakeAudio(); assert.equal(playEvent(kitchen.ctx, 'kitchen'), soundLength('gong'));
  assert.equal(kitchen.started.length, soundVoices('gong'));
  const approval = fakeAudio(); assert.equal(playEvent(approval.ctx, 'approval'), 0); assert.equal(approval.started.length, 0);
  // Two events at once play one after the other; the same event twice plays once.
  const both = fakeAudio(); playEvents(both.ctx, ['waiterCall', 'waiterCall', 'billRequest']);
  assert.equal(both.started.length, soundVoices('dingdong') + soundVoices('ciftbip'));
  assert.ok(both.started.at(-1)!.at > soundLength('dingdong'));
  assert.equal(fromPlatform({ external: { platform: 'getir' } }), true);
  assert.equal(fromPlatform({ source: { platform: 'yemeksepeti' } }), true);
  assert.equal(fromPlatform({ source: 'qr' }), false);
  setSoundChoices(defaultSounds);
});

const order = (id: string, status: string, extra = {}) => ({ id, status, ...extra }) as never;
test('floor sounds: waiters hear approvals and ready orders once; owners approvals; desk hears each platform order once', () => {
  const seen = new Set<string>();
  assert.deepEqual(orderAlerts([order('a', 'new')], 'waiter', seen, [], true), []);
  assert.deepEqual(orderAlerts([order('a', 'ready'), order('b', 'awaiting_approval')], 'waiter', seen), ['ready', 'approval']);
  assert.deepEqual(orderAlerts([order('a', 'ready'), order('b', 'awaiting_approval')], 'waiter', seen), [], 'each order sounds once per state');
  assert.deepEqual(orderAlerts([order('d', 'ready'), order('e', 'awaiting_approval')], 'owner', new Set()), ['approval']);
  assert.deepEqual(orderAlerts([order('f', 'awaiting_approval')], 'cashier', new Set()), []);
  // A platform order waiting for Kabul rings at the desk; once accepted it becomes an order with `external`: no second sound.
  const desk = new Set<string>(), ys = { platform: 'yemeksepeti', externalId: 'ys-floor-1' };
  orderAlerts([], 'cashier', desk, [], true);
  assert.deepEqual(orderAlerts([], 'cashier', desk, [{ ...ys, stage: 'pending' }]), ['externalOrder']);
  assert.deepEqual(orderAlerts([order('g', 'new', { external: ys })], 'cashier', desk, []), []);
  // Automatic acceptance: the order arrives already accepted, and rings once.
  assert.deepEqual(orderAlerts([order('h', 'new', { external: { platform: 'getir', externalId: 'g-floor-2' } })], 'owner', desk, []), ['externalOrder']);
  assert.deepEqual(orderAlerts([order('h', 'preparing', { external: { platform: 'getir', externalId: 'g-floor-2' } })], 'owner', desk, []), []);
  // Waiters do not handle platform orders.
  assert.deepEqual(orderAlerts([], 'waiter', new Set(), [{ platform: 'migros', externalId: 'm-floor-3', stage: 'pending' }]), []);
});

test('kitchen sounds: approval, new order, and one platform sound per platform order', () => {
  const seen = new Set<string>(), tr = { platform: 'trendyol', externalId: 'tr-kitchen-1' };
  assert.deepEqual(kitchenAlerts([order('k1', 'new')], [], seen, true), []);
  assert.deepEqual(kitchenAlerts([order('k1', 'new'), order('k2', 'awaiting_approval'), order('k3', 'new')], [], seen), ['approval', 'kitchen']);
  assert.deepEqual(kitchenAlerts([order('k2', 'new')], [], seen), ['kitchen'], 'approved: a new order to prepare');
  assert.deepEqual(kitchenAlerts([], [{ ...tr, stage: 'pending' }], seen), ['externalOrder']);
  assert.deepEqual(kitchenAlerts([order('k4', 'new', { external: tr })], [{ ...tr, stage: 'accepted' }], seen), []);
  assert.deepEqual(kitchenAlerts([order('k5', 'new', { external: { platform: 'test', externalId: 'auto-1' } })], [], seen), ['externalOrder']);
});

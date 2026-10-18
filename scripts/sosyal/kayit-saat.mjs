/*
 * Recording clock (scripts/sosyal/kayit-ortak.ts, kit({ saat })): loaded with `node --import` into the recording's own Mola
 * Merkez, demo generator and café server only, never into the app. `Date` reads the time shifted by the number of
 * milliseconds in the file MOLA_KAYIT_SAAT (read again every 250 ms), so a clip can play in the morning (the kasa opening)
 * and a later one at night (the gün sonu) in one run. Every process of the run reads the same file: their clocks agree.
 */
import { readFileSync } from 'node:fs';

const file = process.env.MOLA_KAYIT_SAAT;
if (file) {
  const Real = Date, realNow = Real.now.bind(Real);
  let offset = 0, readAt = -1e9;
  const shift = () => {
    const t = realNow();
    if (t - readAt > 250) { readAt = t; try { offset = Number(readFileSync(file, 'utf8')) || 0; } catch { /* kept */ } }
    return offset;
  };
  const now = () => realNow() + shift();
  globalThis.Date = new Proxy(Real, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: () => new Real(now()).toString(),
    get: (target, prop, receiver) => prop === 'now' ? now : Reflect.get(target, prop, receiver),
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';

/*
 * The Android app reads the counter's vardiya code with its own small QR decoder (mobile/android/.../QrCozucu.java; no
 * library). It is plain Java, so it runs here too: codes made by the same library as the counter screen (src/Shifts.tsx:
 * version 1, level M, digits), drawn like a phone camera sees a screen: scaled, turned, tilted, blurred, noisy, unevenly
 * lit, with a few wrong modules. Skipped when no JDK is installed.
 */
const exe = process.platform === 'win32' ? '.exe' : '';
function jdk() {
  const roots = [process.env.JAVA_HOME, ...(process.platform === 'win32' && existsSync('C:\\Program Files\\Eclipse Adoptium') ? readdirSync('C:\\Program Files\\Eclipse Adoptium').filter(n => n.startsWith('jdk')).sort().reverse().map(n => join('C:\\Program Files\\Eclipse Adoptium', n)) : [])];
  return roots.find(r => r && existsSync(join(r, 'bin', `javac${exe}`)));
}
type Look = { scale: number; angle: number; tilt?: number; noise?: number; blur?: boolean; light?: number; flips?: number; width?: number; height?: number; dx?: number; dy?: number };
let seed = 7;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
/** A camera frame of the code: luminance bytes behind an 8-byte size header. */
function frame(text: string, look: Look, options: { version?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' } = { version: 1, errorCorrectionLevel: 'M' }) {
  const qr = QRCode.create(text, options), size = qr.modules.size, dark = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && !!qr.modules.get(y, x);
  const flipped = new Set<string>();
  // Wrong modules in the data area (never the finder corners), like glare or a dirty screen.
  while (flipped.size < (look.flips ?? 0)) { const x = 9 + Math.floor(random() * (size - 9)), y = 9 + Math.floor(random() * (size - 9)); flipped.add(`${x},${y}`); }
  const w = look.width ?? 480, h = look.height ?? 480, cx = w / 2 + (look.dx ?? 0), cy = h / 2 + (look.dy ?? 0), a = look.angle * Math.PI / 180;
  let pixels = new Float64Array(w * h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const s = look.scale * (1 + (look.tilt ?? 0) * (py - cy) / h);
    const rx = px - cx, ry = py - cy, ux = (rx * Math.cos(a) + ry * Math.sin(a)) / s + size / 2, uy = (-rx * Math.sin(a) + ry * Math.cos(a)) / s + size / 2;
    const mx = Math.floor(ux), my = Math.floor(uy);
    const on = dark(mx, my) !== flipped.has(`${mx},${my}`);
    pixels[py * w + px] = (on ? 45 : 205) + (look.light ?? 0) * (px / w - 0.5) + (look.noise ?? 0) * (random() - 0.5) * 2;
  }
  if (look.blur) { const out = new Float64Array(w * h); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let t = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += pixels[(y + j) * w + x + i]; out[y * w + x] = t / 9; } pixels = out; }
  const data = Buffer.alloc(8 + w * h); data.writeUInt32BE(w, 0); data.writeUInt32BE(h, 4);
  for (let i = 0; i < w * h; i++) data[8 + i] = Math.max(0, Math.min(255, Math.round(pixels[i])));
  return data;
}

test('Android QR reader: decodes the counter\'s vardiya code as a camera sees it, and nothing else', t => {
  const home = jdk();
  if (!home) return t.skip('JDK yok');
  const dir = mkdtempSync(join(tmpdir(), 'mola-qr-'));
  try {
    execFileSync(join(home, 'bin', `javac${exe}`), ['--release', '11', '-encoding', 'UTF-8', '-d', dir, resolve('mobile/android/src/com/merkutstudios/mola/QrCozucu.java'), resolve('tests/android/QrDeneme.java')], { stdio: 'pipe' });
    const cases: { name: string; text: string; look: Look; options?: Parameters<typeof frame>[2]; expect: string | null }[] = [
      { name: 'straight', text: '407266', look: { scale: 8, angle: 0 }, expect: '407266' },
      { name: 'small', text: '000123', look: { scale: 4, angle: 0 }, expect: '000123' },
      { name: 'turned 7°', text: '913570', look: { scale: 7, angle: 7, noise: 10 }, expect: '913570' },
      { name: 'turned −15°', text: '550044', look: { scale: 6, angle: -15 }, expect: '550044' },
      { name: 'turned 30°, blurred', text: '128634', look: { scale: 8, angle: 30, blur: true }, expect: '128634' },
      { name: 'upside down', text: '999999', look: { scale: 6, angle: 180 }, expect: '999999' },
      { name: 'quarter turn', text: '314159', look: { scale: 6, angle: 90, noise: 16 }, expect: '314159' },
      { name: 'tilted phone', text: '271828', look: { scale: 8, angle: 4, tilt: 0.12 }, expect: '271828' },
      { name: 'uneven light (screen glare)', text: '161803', look: { scale: 7, angle: -5, light: 90, noise: 12 }, expect: '161803' },
      { name: 'off centre, wide frame', text: '424242', look: { scale: 6, angle: 3, width: 640, height: 480, dx: 120, dy: -60 }, expect: '424242' },
      { name: '3 wrong modules (Reed-Solomon)', text: '808080', look: { scale: 8, angle: 0, flips: 3 }, expect: '808080' },
      { name: 'level H, version 2, letters', text: 'MOLA-VARDIYA-1', look: { scale: 6, angle: 10 }, options: { version: 2, errorCorrectionLevel: 'H' }, expect: 'MOLA-VARDIYA-1' },
      { name: 'byte mode', text: 'kasa', look: { scale: 7, angle: 0 }, options: { version: 1, errorCorrectionLevel: 'L' }, expect: 'kasa' },
    ];
    const files = cases.map((c, i) => { const p = join(dir, `${i}.bin`); writeFileSync(p, frame(c.text, c.look, c.options)); return p; });
    // No code at all: noise, and a plain grey screen.
    const noise = Buffer.alloc(8 + 320 * 240); noise.writeUInt32BE(320, 0); noise.writeUInt32BE(240, 4); for (let i = 8; i < noise.length; i++) noise[i] = Math.floor(random() * 256);
    const grey = Buffer.alloc(8 + 200 * 200, 128); grey.writeUInt32BE(200, 0); grey.writeUInt32BE(200, 4);
    files.push(join(dir, 'noise.bin'), join(dir, 'grey.bin')); writeFileSync(files.at(-2)!, noise); writeFileSync(files.at(-1)!, grey);
    const started = Date.now();
    const out = execFileSync(join(home, 'bin', `java${exe}`), ['-cp', dir, 'com.merkutstudios.mola.QrDeneme', ...files], { encoding: 'utf8' }).trim().split(/\r?\n/);
    const results = Object.fromEntries(cases.map((c, i) => [c.name, out[i] === '-' ? null : out[i]]));
    assert.deepEqual(results, Object.fromEntries(cases.map(c => [c.name, c.expect])));
    assert.deepEqual(out.slice(-2), ['-', '-'], 'no false reading without a code');
    assert.ok(Date.now() - started < 15000, 'fast enough for a camera preview');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

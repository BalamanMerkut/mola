import { Worker } from 'node:worker_threads';

/*
 * Starting another program (reg.exe for the machine id, PowerShell for the Windows key lock and USB printers, Edge for a PDF)
 * costs Windows' process start on the thread that asks: on a weak café PC with an antivirus scan that is half a second and
 * more, and every tablet waits meanwhile (the heartbeat's reg.exe 3 s after start held them 0.5–0.9 s; docs/HIZ_TESTI_5_YIL.md
 * "Zayıf bilgisayar son kontrol"). These programs start from one small worker thread instead; the server's own thread only
 * waits for the answer. The code is inline so the bundled server needs no separate worker file.
 */
/** `err`: its error output (only when asked with `errors`); `timedOut`: it was stopped after `timeoutMs`. */
type Answer = { code: number | null; out: string; err?: string; timedOut?: boolean };
type Pending = { resolve: (a: Answer) => void; reject: (e: Error) => void };
let worker: Worker | undefined, next = 0;
const waiting = new Map<number, Pending>();
function thread() {
  if (worker) return worker;
  const w = new Worker(`const { parentPort } = require('node:worker_threads'); const { spawn } = require('node:child_process');
    parentPort.on('message', job => {
      let out = '', err = '', done = false, timedOut = false, timer;
      const finish = answer => { if (done) return; done = true; clearTimeout(timer); parentPort.postMessage({ id: job.id, ...answer }); };
      let child;
      try { child = spawn(job.command, job.args, { windowsHide: true, stdio: [job.input === undefined ? 'ignore' : 'pipe', job.output ? 'pipe' : 'ignore', job.errors ? 'pipe' : 'ignore'], ...(job.env ? { env: { ...process.env, ...job.env } } : {}) }); }
      catch (e) { finish({ error: String((e && e.message) || e) }); return; }
      timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, job.timeoutMs);
      if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { out += chunk; }); }
      if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { if (err.length < 8192) err += chunk; }); }
      child.once('error', e => finish({ error: String((e && e.message) || e) }));
      child.once('close', code => finish({ code, out, ...(job.errors ? { err } : {}), ...(timedOut ? { timedOut: true } : {}) }));
      // A browser's helper processes (crash reporter) may keep the error pipe open after it exits: answer shortly after the exit.
      if (job.errors) child.once('exit', code => setTimeout(() => finish({ code, out, err, ...(timedOut ? { timedOut: true } : {}) }), 500));
      if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(job.input); }
    });`, { eval: true });
  const fail = (error: Error) => { for (const p of waiting.values()) p.reject(error); waiting.clear(); if (worker === w) worker = undefined; };
  w.on('message', (m: Answer & { id: number; error?: string }) => {
    const p = waiting.get(m.id); if (!p) return;
    waiting.delete(m.id); if (!waiting.size) w.unref();
    if (m.error !== undefined) p.reject(new Error(m.error)); else p.resolve({ code: m.code, out: m.out ?? '', ...(m.err !== undefined ? { err: m.err } : {}), ...(m.timedOut ? { timedOut: true } : {}) });
  });
  w.on('error', fail);
  w.on('exit', () => fail(new Error('Program başlatılamadı.')));
  w.unref();
  return worker = w;
}
/**
 * Runs `command` from the worker thread: `input` on its stdin (secrets never on a command line), its stdout back when
 * `output`, killed after `timeoutMs`. Rejects when it cannot start (ENOENT); otherwise answers its exit code and output.
 */
export function runProgram(command: string, args: string[], o: { input?: string; env?: Record<string, string>; timeoutMs?: number; output?: boolean; errors?: boolean } = {}): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const w = thread(), id = ++next;
    waiting.set(id, { resolve, reject });
    // Referenced while it works for someone: a script awaiting a PDF or a key does not end meanwhile.
    w.ref();
    w.postMessage({ id, command, args, ...(o.input !== undefined ? { input: o.input } : {}), ...(o.env ? { env: o.env } : {}), timeoutMs: o.timeoutMs ?? 30_000, output: !!o.output, errors: !!o.errors });
  });
}

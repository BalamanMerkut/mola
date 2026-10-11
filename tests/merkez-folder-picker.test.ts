import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { HttpSecurity } from '../server/http-security.js';
import { createMerkezApp } from '../server/merkez/app.js';
import { folderPicker } from '../server/merkez/folder-picker.js';
import { MerkezStore } from '../server/merkez/store.js';
import { client, MERKEZ_PASSWORD, temp } from './merkez-fixture.js';

type Call = { command: string; args: string[]; input?: string };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const fromB64 = (s: string) => Buffer.from(s, 'base64').toString('utf8');

async function merkez(picker: ReturnType<typeof folderPicker>, httpSecurity?: HttpSecurity) {
  const store = new MerkezStore(join(temp('folder-picker'), 'merkez'), randomBytes(32), { initialPassword: MERKEZ_PASSWORD });
  const server = createServer(createMerkezApp(store, { folderPicker: picker, ...(httpSecurity ? { httpSecurity } : {}) }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/merkez/admin`;
  return { base, admin: client(base), async close() { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); } };
}

test('Göz at: Windows folder window through the program runner; the chosen path (Turkish letters) comes back, a closed window is no change', async t => {
  const calls: Call[] = [];
  let answer = { code: 0 as number | null, out: `OK:${b64("G:\\Drive'ım\\Mola Yedek")}` };
  const picker = folderPicker({ platform: 'win32', places: async () => [{ path: "G:\\Drive'ım", label: 'Google Drive (G:)', kind: 'gdrive' }],
    run: async (command, args, o = {}) => { calls.push({ command, args, input: o.input }); return answer; } });
  const m = await merkez(picker); t.after(() => m.close());
  // No session: nothing opens.
  assert.equal((await m.admin('/folders/pick', { purpose: 'second' })).status, 401);
  assert.equal((await m.admin('/folders')).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await m.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD })).status, 200);
  const state = await m.admin('/folders');
  assert.deepEqual(state.data, { picker: true, places: [{ path: "G:\\Drive'ım", label: 'Google Drive (G:)', kind: 'gdrive' }] });
  const picked = await m.admin('/folders/pick', { purpose: 'second', start: 'C:\\Yedek' });
  assert.equal(picked.status, 200); assert.equal(picked.data.path, "G:\\Drive'ım\\Mola Yedek");
  // PowerShell in STA from the worker runner; the start folder and the title travel on stdin, never on the command line.
  assert.equal(calls[0].command, 'powershell.exe'); assert.ok(calls[0].args.includes('-STA')); assert.ok(calls[0].args.includes('-EncodedCommand'));
  assert.equal(calls[0].args.join(' ').includes('Yedek'), false);
  const [start, title] = calls[0].input!.trim().split('\n').map(fromB64);
  assert.equal(start, 'C:\\Yedek'); assert.match(title, /ikinci kopyası/);
  answer = { code: 0, out: 'CANCEL' };
  assert.deepEqual((await m.admin('/folders/pick', { purpose: 'workfolder' })).data, { path: null });
  // A window that could not open: said plainly, the field stays a typed path.
  answer = { code: 1, out: '' };
  const failed = await m.admin('/folders/pick', { purpose: 'second' });
  assert.equal(failed.status, 409); assert.equal(failed.data.code, 'PICKER_FAILED');
  assert.equal((await m.admin('/folders/pick', { purpose: 'other' })).status, 400);
});

test('Göz at is refused through a proxy (not a direct loopback request), on a non-Windows Merkez, and while a window is open', async t => {
  const calls: Call[] = [];
  let release: (() => void) | undefined;
  const picker = folderPicker({ platform: 'win32', places: async () => [{ path: 'E:\\', label: 'Flash bellek (E:)', kind: 'usb' }],
    run: async (command, args) => { calls.push({ command, args }); await new Promise<void>(r => { release = r; }); return { code: 0, out: 'CANCEL' }; } });
  const m = await merkez(picker); t.after(() => m.close());
  await m.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  // A forwarded request (a proxy in between) is not this computer's own browser: refused, and no paths of this computer go out.
  const proxied = await m.admin('/folders/pick', { purpose: 'second' }, { 'X-Forwarded-For': '203.0.113.9' });
  assert.equal(proxied.status, 403); assert.equal(proxied.data.code, 'LOCAL_ONLY');
  const proxiedState = await m.admin('/folders', undefined, { 'X-Forwarded-For': '203.0.113.9' });
  assert.equal(proxiedState.status, 403);
  assert.equal(calls.length, 0);
  // One window at a time.
  const first = m.admin('/folders/pick', { purpose: 'second' });
  await new Promise(r => setTimeout(r, 100));
  const second = await m.admin('/folders/pick', { purpose: 'second' });
  assert.equal(second.status, 409); assert.equal(second.data.code, 'PICKER_BUSY');
  release!();
  assert.deepEqual((await first).data, { path: null });
  assert.equal(calls.length, 1);

  // Mola Yönetim served over HTTPS (PUBLIC_ORIGIN behind a local TLS proxy): signed in fine, but the server's desktop is not
  // the vendor's, so the window never opens and no folder of that computer is offered.
  const remoteCalls: Call[] = [];
  const remote = await merkez(folderPicker({ platform: 'win32', places: async () => [{ path: 'E:\\', label: 'Flash bellek (E:)', kind: 'usb' }], run: async (command, args) => { remoteCalls.push({ command, args }); return { code: 0, out: 'CANCEL' }; } }),
    { publicOrigin: 'https://merkez.example', trustLocalProxy: true });
  t.after(() => remote.close());
  const https = { Host: 'merkez.example', 'X-Forwarded-Proto': 'https', Origin: 'https://merkez.example' };
  assert.equal((await remote.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD }, https)).status, 200);
  assert.deepEqual((await remote.admin('/folders', undefined, https)).data, { picker: false, places: [] });
  const far = await remote.admin('/folders/pick', { purpose: 'second' }, https);
  assert.equal(far.status, 403); assert.equal(far.data.code, 'LOCAL_ONLY'); assert.equal(remoteCalls.length, 0);

  const linux = await merkez(folderPicker({ platform: 'linux', run: async () => { throw new Error('must not run'); } }));
  t.after(() => linux.close());
  await linux.admin('/login', { username: 'admin', password: MERKEZ_PASSWORD });
  assert.deepEqual((await linux.admin('/folders')).data, { picker: false, places: [] });
  const refused = await linux.admin('/folders/pick', { purpose: 'second' });
  assert.equal(refused.status, 409); assert.equal(refused.data.code, 'PICKER_UNAVAILABLE');
});

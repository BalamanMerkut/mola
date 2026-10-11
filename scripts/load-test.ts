import { licensed } from '../tests/merkez-fixture.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';

// Always starts its own loopback server with isolated data. Never targets a live café.
mkdirSync('.local/load', { recursive: true });
const store = new Store(mkdtempSync(resolve('.local/load/run-')));
// Licences come from Mola Merkez now: the throwaway folder gets test licences like the unit tests do.
licensed(store);
const server = createServer(createApp(store));
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
const times: number[] = []; let failures = 0;
async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const start = performance.now();
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); times.push(performance.now() - start); if (!response.ok) failures++;
  return { response, data };
}
try {
  const login = await call('/login', { username: 'isletme', password: DEMO_PASSWORD });
  const staffCookie = login.response.headers.getSetCookie()[0].split(';')[0];
  await call('/staff/heartbeat', {}, { Cookie: staffCookie });
  times.length = 0;
  const start = performance.now(); const table = store.read('mola-demo').tables[0];
  await Promise.all(Array.from({ length: 20 }, async () => {
    const session = await call('/guest/session', { token: table.token });
    const headers = { Cookie: session.response.headers.getSetCookie()[0].split(';')[0], 'X-Guest-Session': session.data.session };
    for (let i = 0; i < 4; i++) {
      await call('/guest/state', undefined, headers);
      await call('/guest/orders', { requestId: randomUUID(), tableId: table.id, lines: [{ productId: 'tea', quantity: 1, selections: [] }], expectedTotal: 3500 }, headers);
    }
  }));
  times.sort((a, b) => a - b);
  const elapsed = performance.now() - start;
  const s = store.read('mola-demo'); assert.equal(failures, 0); assert.equal(s.orders.length, 80); assert.equal(s.accounts.length, 1);
  console.log(JSON.stringify({ scope: 'local-smoke-test-not-production-capacity', concurrentGuests: 20, requests: times.length, acceptedOrders: s.orders.length, failures, elapsedMs: Math.round(elapsed), p50Ms: Math.round(times[Math.floor(times.length * .5)]), p95Ms: Math.round(times[Math.floor(times.length * .95)]) }, null, 2));
} finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); }

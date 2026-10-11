import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.js';

test('server failures expose only a valid tracking UUID and preserve API retry classification', async () => {
  const fetchBefore = globalThis.fetch;
  const id = 'f155c0ef-a134-47ba-9385-60af1ee039e2';
  try {
    for (const [status, requestId, expected] of [[503, id, true], [400, id, false], [500, 'secret/path/token', false], [500, null, false]] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({ message: 'İşlem tamamlanamadı.', code: 'TEST', requestId }), { status });
      await assert.rejects(api('/api/test'), (error: unknown) => {
        assert.ok(error instanceof ApiError); assert.equal(error.status, status); assert.equal(error.code, 'TEST');
        assert.equal(error.trackingId, expected ? id : undefined);
        assert.equal(error.message.includes('Takip kodu:'), expected);
        assert.ok(!error.message.includes('secret/path')); return true;
      });
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
    assert.deepEqual(await api('/api/test'), { ok: true });
  } finally { globalThis.fetch = fetchBefore; }
});

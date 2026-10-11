import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackingCode } from '../src/trackingCode.js';
test('tracking lookup extracts one distinct UUID without transmitting pasted message contents', () => {
  const id = 'f155c0ef-a134-47ba-9385-60af1ee039e2';
  assert.equal(trackingCode(`Özel mesaj. Takip kodu: ${id.toUpperCase()}`), id);
  assert.equal(trackingCode(`${id} ${id}`), id);
  assert.equal(trackingCode(`${id} 11111111-1111-4111-8111-111111111111`), null);
  assert.equal(trackingCode('eksik kod'), null); assert.equal(trackingCode(''), null);
  assert.equal(trackingCode('x'.repeat(1001) + id), null);
});

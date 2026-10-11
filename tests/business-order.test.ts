import test from 'node:test';
import assert from 'node:assert/strict';
import { orderBusinesses } from '../src/businessOrder';
const business = (tenantId: string, name: string, endsAt: string | null, extra = {}) => ({ tenantId, name, endsAt, active: true, frozen: false, suspended: false, ...extra });
test('business expiry prioritizes real active deadlines and leaves frozen, suspended and undated accounts below', () => {
  const items = [
    business('frozen', 'A', '2026-01-01', { frozen: true }),
    business('late', 'Z', '2026-10-20'),
    business('expired', 'B', '2026-01-02', { active: false }),
    business('early', 'Y', '2026-10-01'),
    business('pending', 'C', null),
    business('suspended', 'D', '2026-01-03', { suspended: true }),
    business('invalid', 'E', 'bad-date'),
  ];
  const original = items.map(i => i.tenantId);
  assert.deepEqual(orderBusinesses(items, 'expiry').map(i => i.tenantId), ['early', 'late', 'frozen', 'expired', 'pending', 'suspended', 'invalid']);
  assert.deepEqual(items.map(i => i.tenantId), original);
  assert.deepEqual(orderBusinesses(items, 'created'), items);
  assert.notEqual(orderBusinesses(items, 'created'), items);
});
test('business name ordering uses Turkish alphabet, natural numbers and deterministic ties', () => {
  const items = [business('i', 'İpek', null), business('10', 'Kafe 10', null), business('z', 'Işık', null), business('2b', 'Kafe 2', null), business('2a', 'Kafe 2', null)];
  assert.deepEqual(orderBusinesses(items, 'name').map(i => i.tenantId), ['z', 'i', '2a', '2b', '10']);
});

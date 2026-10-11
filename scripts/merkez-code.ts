import { randomUUID } from 'node:crypto';

/**
 * Package checks: the self-serve trial is gone, so a check café activates the way a vendor-added one does: sign in to the
 * check's own Mola Merkez, "İşletme ekle" with a 30-day trial, and hand back the one-time code. Works for older café
 * packages too (code activation did not change).
 */
export async function trialCode(merkezUrl: string, password: string, name: string) {
  const admin = `${merkezUrl}/api/merkez/admin`;
  const login = await fetch(`${admin}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) });
  if (!login.ok) throw new Error(`Merkez girişi olmadı: ${login.status}`);
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const created = await fetch(`${admin}/businesses`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ requestId: randomUUID().replace(/-/g, ''), name, sector: 'cafe', kind: 'trial' }) });
  if (!created.ok) throw new Error(`İşletme eklenemedi: ${await created.text()}`);
  return (await created.json() as { code: string }).code;
}

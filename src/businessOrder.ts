export type BusinessOrder = 'created' | 'name' | 'expiry';
type Business = { tenantId: string; name: string; active: boolean; suspended: boolean; frozen: boolean; endsAt: string | null };
const names = new Intl.Collator('tr-TR', { sensitivity: 'base', numeric: true });
function expiry(item: Business) {
  if (!item.active || item.suspended || item.frozen || !item.endsAt) return Infinity;
  const time = Date.parse(item.endsAt);
  return Number.isFinite(time) ? time : Infinity;
}
export function orderBusinesses<T extends Business>(items: T[], order: BusinessOrder): T[] {
  const copy = [...items];
  if (order === 'created') return copy;
  return copy.sort((a, b) => {
    if (order === 'expiry') {
      const first = expiry(a), second = expiry(b);
      if (first !== second) return first < second ? -1 : 1;
    }
    return names.compare(a.name, b.name) || a.tenantId.localeCompare(b.tenantId);
  });
}

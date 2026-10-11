export function backupAge(createdAt: string | null, now = Date.now()) {
  if (!createdAt) return { status: 'missing', ageHours: null };
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp) || timestamp > now) return { status: 'invalid', ageHours: null };
  const elapsed = now - timestamp;
  return { status: elapsed > 24 * 60 * 60 * 1000 ? 'stale' : 'recent', ageHours: Math.floor(elapsed / 3600000) };
}

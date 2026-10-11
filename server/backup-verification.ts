import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function backupVerification(directory: string | null, now = Date.now()) {
  if (!directory) return { status: 'missing', checkedAt: null };
  if (existsSync(join(directory, 'verification-failed.json'))) return { status: 'failed', checkedAt: null };
  const file = join(directory, 'verification.json');
  if (!existsSync(file)) return { status: 'unverified', checkedAt: null };
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    const completed = JSON.parse(readFileSync(join(directory, 'complete.json'), 'utf8'));
    const time = Date.parse(record.checkedAt), created = Date.parse(completed.createdAt);
    if (record.verified !== true || typeof record.checkedAt !== 'string' || !Number.isFinite(time) || time > now || !Number.isFinite(created) || time < created ||
        typeof record.backupDirectory !== 'string' || resolve(record.backupDirectory) !== resolve(directory) ||
        !Number.isSafeInteger(record.files) || record.files < 2 || record.files !== completed.files) return { status: 'invalid', checkedAt: null };
    return { status: 'recorded', checkedAt: record.checkedAt as string };
  } catch { return { status: 'invalid', checkedAt: null }; }
}

import { createHash } from 'node:crypto';
import { verifyTotp } from './totp.js';
import { DomainError } from '../packages/domain/engine.js';

export type AdminFactor = { secret: string; lastStep: number; recoveryHashes: string[] };
export const recoveryHash = (code: string) => createHash('sha256').update(code).digest('hex');
/** Mutates only inside the platform transaction, consuming a proof once. */
export function consumeAdminFactor(factor: AdminFactor, code: string | undefined, time: number) {
  if (!code) throw new DomainError('MFA_REQUIRED', 'Authenticator kodunu veya bir kurtarma kodunu girin.', 403);
  const value = code.trim().toLowerCase();
  if (/^[a-f0-9]{32}$/.test(value)) {
    const hash = recoveryHash(value), index = factor.recoveryHashes.indexOf(hash);
    if (index < 0) throw new DomainError('INVALID_CODE', 'Kurtarma kodu geçersiz veya kullanılmış.', 403);
    factor.recoveryHashes.splice(index, 1); return 'recovery';
  }
  const step = verifyTotp(factor.secret, value, time, factor.lastStep);
  if (step === null) throw new DomainError('INVALID_CODE', 'Kod yanlış, kullanılmış veya süresi dolmuş. Yeni kodu bekleyin.', 403);
  factor.lastStep = step; return 'totp';
}

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function assertRestoreReady(directory: string) {
  if (['RESTORE_IN_PROGRESS.txt', 'RESTORE_FAILED.txt'].some(name => existsSync(join(directory, name)))) {
    throw new Error('Geri yükleme tamamlanmamış veya doğrulanamamış. Bu veri klasörü açılamaz; yedeği yeni bir klasöre tekrar geri yükleyin.');
  }
}

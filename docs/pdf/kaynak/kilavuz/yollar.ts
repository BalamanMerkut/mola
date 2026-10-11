import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Bu klasör ve ekran görüntülerinin klasörü (ekran/*.png + ekran/isaretler.json). */
export const HERE = dirname(fileURLToPath(import.meta.url));
export const EKRAN = join(HERE, 'ekran');
mkdirSync(EKRAN, { recursive: true });

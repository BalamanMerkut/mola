import { statfs } from 'node:fs/promises';

const MIB = 1024n * 1024n;
export const DISK_CRITICAL_BYTES = 256n * MIB;
export const DISK_WARNING_BYTES = 2048n * MIB;
type DiskReader = (path: string) => Promise<{ bavail: bigint; blocks: bigint; bsize: bigint }>;

// bavail is the space available to this process, not privileged/reserved free space.
export async function diskCapacity(path: string, read: DiskReader = path => statfs(path, { bigint: true })) {
  try {
    const stats = await read(path);
    if (stats.bsize <= 0n || stats.blocks <= 0n || stats.bavail < 0n || stats.bavail > stats.blocks) throw new Error('Invalid capacity');
    const available = stats.bavail * stats.bsize, total = stats.blocks * stats.bsize;
    const status = available < DISK_CRITICAL_BYTES ? 'critical' : available < DISK_WARNING_BYTES || available * 100n < total * 5n ? 'low' : 'ok';
    return {
      status,
      availableMiB: Number(available / MIB), totalMiB: Number(total / MIB),
      message: status === 'critical' ? 'Veri diskinde 256 MiB’den az boş alan var. Yer açmadan yeni başlatma yapılmamalı.'
        : status === 'low' ? 'Veri diskinde boş alan azalıyor (2 GiB veya %5 altında). Fotoğraf ve yedekler için alan ayırın.'
        : 'Veri diskinin boş alanı yeterli.',
    };
  } catch {
    return { status: 'unknown', availableMiB: null, totalMiB: null, message: 'Veri diskinin boş alanı ölçülemedi. Kurulumdan önce elle kontrol edin.' };
  }
}

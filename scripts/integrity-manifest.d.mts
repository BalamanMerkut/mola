// Types for scripts/integrity-manifest.mjs (program dosyaları denetimi: app/butunluk.json), used by the tests.
export const INTEGRITY_FILE: string;
export const CODE_TOP: Record<'windows' | 'macos-arm64' | 'macos-x64' | 'linux-x64', string[]>;
export function writeIntegrityManifest(appDir: string, options: { version: string; platform: string; build: string; top: Record<string, Buffer> }): { path: string; sha256: string; size: number }[];

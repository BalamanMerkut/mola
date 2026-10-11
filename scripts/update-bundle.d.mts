// Types for scripts/update-bundle.mjs (otomatik güncelleme bundles), used by the tests.
export type BundleItem = { path: string; file?: string; data?: Buffer; mode?: number; target?: string };
export function updateBundlesWanted(): boolean;
export function includeRuntime(platform: string, node: string): boolean;
export function folderItems(dir: string, prefix: string, executable?: (path: string) => boolean): BundleItem[];
export function writeUpdateBundle(options: {
  out: string; platform: string; version: string; node: string; items: BundleItem[]; top: { file: string; target: string }[]; runtime: boolean;
  minFrom?: string; notes?: string; data?: { minReadable: number; maxReadable: number; writeVersion: number }; record?: boolean;
}): Promise<{ file: string; size: number; runtime: boolean }>;

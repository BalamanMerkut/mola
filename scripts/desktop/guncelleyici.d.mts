// Types for scripts/desktop/guncelleyici.mjs (the otomatik güncelleme applier), used by tests/update-apply.test.ts.
export type Move = { from: string; to: string; state: 'todo' | 'moving' | 'done' | 'staged' | 'skipped' | 'undone'; stage?: string };
export type Journal = { v: 1; version: string; from: string; release?: string; folder: string; step: string; attempts: number; startedAt: string; dataBackup: string; moves: Move[]; dataFiles?: { file: string; sha256: string; size: number }[]; reason?: string; appOld: string | null; appNew: string | null; dataRestored?: string };
export type Job = { root: string; data: string; update: string; port?: string; platform?: string; desktopKey?: string; after?: 'start' | 'stop'; healthMs?: number; watchdogPid?: number; start?: { cmd?: string; node?: string; args?: string[]; cwd?: string; log?: string } };
export type Hooks = { startServer(): Promise<void>; stopServer(): Promise<void>; health(version: string, ms: number): Promise<{ ok: boolean; reason?: string }>; crash?(point: string): void };
export const STEPS: string[];
export const TOP_TARGETS: Record<string, string[]>;
export function compareVersions(a: string, b: string): number;
export function readJson<T = any>(path: string): T | undefined;
export function writeJson(path: string, value: unknown): void;
export function hashFile(path: string): string;
export function copyVerified(from: string, to: string, skip?: (name: string) => boolean): { file: string; sha256: string; size: number }[];
export function sameData(dir: string, list: { file: string; sha256: string; size: number }[]): boolean;
export function lockPath(root: string): string;
export function takeLock(root: string): Promise<boolean>;
export function prepare(job: Job, pending: unknown): { journal?: Journal; error?: string; retry?: boolean; dropFolder?: string };
export function runJob(job: Job, mode: 'uygula' | 'devam', hooks?: Hooks): Promise<string>;

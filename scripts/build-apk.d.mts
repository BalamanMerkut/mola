export const PACKAGE: string;
export type AndroidTools = { missing?: undefined; sdk: string; jdk: string; platform: string; buildTools: string; androidJar: string; aapt2: string; aapt: string; zipalign: string; d8: string; apksigner: string; java: string; javac: string; jar: string; keytool: string };
export function androidTools(): AndroidTools | { missing: string[] };
export function versionCode(version: string): number;
export function badging(tools: AndroidTools, apk: string): { text: string; package?: string; versionCode: number; versionName?: string; minSdk: number; targetSdk: number; label?: string; permissions: string[] };
export function verifySignature(tools: AndroidTools, apk: string): string;

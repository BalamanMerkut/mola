import type { Plugin } from 'vite';

export const MOLA_GREEN: string;
export const YONETIM_BLACK: string;
export const iconSvg: {
  rounded: (fill?: string) => string; square: (k?: number, fill?: string) => string; cup: (k?: number) => string; small: (fill?: string) => string;
  forSize: (size: number, fill?: string) => string;
};
export function renderPng(svg: string, size: number): Promise<Buffer>;
export const WEB_ICONS: Record<string, [() => string, number]>;
export function webIcon(name: string): Promise<Buffer> | undefined;
export function molaIcons(): Plugin;
export const ICO_SIZES: number[];
export function icoFile(fill?: string): Promise<Buffer>;
export function icoImages(ico: Buffer): { size: number; data: Buffer }[];
export function exeIconImages(exe: Buffer): { size: number; data: Buffer }[];
export function iconImagePng(data: Buffer): Promise<Buffer>;

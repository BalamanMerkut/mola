import type { Plugin } from 'vite';

export const STUDIO_LOGO_WIDTH: number;
export const STUDIO_BLACK: string;
export function studioLogo(format: 'avif' | 'webp' | 'jpg'): Promise<{ data: Buffer; width: number; height: number }>;
export function androidStudioLogo(): Promise<{ data: Buffer; width: number; height: number }>;
export function studioLogoPlugin(): Plugin;

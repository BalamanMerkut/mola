import { version } from '../package.json';

/**
 * The program's version, read from package.json at build time (the only place it is written; the server's APP_VERSION,
 * the Android app's versionName and the installers read the same field). Only this one field reaches the browser bundle.
 */
export const APP_VERSION: string = version;
export const STUDIO = 'Merkut Studios';
/** "Mola 0.1.0 · Merkut Studios", "Mola Yönetim 0.1.0 · Merkut Studios". */
export const versionLine = (product: 'Mola' | 'Mola Yönetim' = 'Mola') => `${product} ${APP_VERSION} · ${STUDIO}`;

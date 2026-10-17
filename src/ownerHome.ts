/*
 * Where "İşletmemi yönet" is on this page: "/yonet" on Mola Merkez's own name, "/" on its own name (MERKEZ_OWNER_ORIGIN,
 * isletme.molayazilim.com.tr: server/merkez/owner-host.ts). Mola Merkez says it in the page it serves (server/merkez/
 * remote-admin.ts ownerHtml: <meta name="mola-owner-home">); the café's own pages never carry it.
 */
export function ownerHome(): '/' | '/yonet' | undefined {
  const home = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="mola-owner-home"]')?.content;
  return home === '/' || home === '/yonet' ? home : undefined;
}
/** This page is İşletmemi yönet: /yonet (and its old /raporlarim) on Mola Merkez, or "/" of its own name. */
export const ownerPageHere = () => /^\/(yonet|raporlarim)\/?$/.test(location.pathname) || (location.pathname === '/' && ownerHome() === '/');

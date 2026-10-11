/*
 * Masa bölümleri ve sırası (11 Ekim, hafta sonu bulgusu 6): a table's section is its `area` ('inside' İç, 'outside' Dış, or
 * the owner's own word such as "Üst kat"; none = bölümsüz). The owner moves a table to another section, renames a section
 * and puts sections and tables in order in Ayarlar → Masalar ve QR → Masalar ve QR (src/TableLayout.tsx). Tables keep
 * their order in `State.tables`; sections in `State.areaOrder`. Masalar, the QR print list and the table choices follow it.
 * Browser-safe: plain rules only.
 */
type Placed = { area?: string };
export const sectionName = (area: string) => area === 'inside' ? 'İç' : area === 'outside' ? 'Dış' : area || 'Bölümsüz';
/** The heading on Masalar: "İç masalar", "Üst kat masaları", "Bölümsüz masalar" (only when other sections exist). */
export const sectionHeading = (area: string, others: boolean) => area === 'inside' ? 'İç masalar' : area === 'outside' ? 'Dış masalar' : area ? `${area} masaları` : others ? 'Bölümsüz masalar' : '';
/**
 * The sections in use, in the owner's order: those named in `order` first, then (as before) İç, Dış and the others as they
 * first appear; bölümsüz ('') last unless the owner placed it.
 */
export function orderedAreas(tables: Placed[], order: readonly string[] = []) {
  const used = [...new Set(tables.map(t => t.area ?? ''))];
  const rest = [...new Set(['inside', 'outside', ...used.filter(Boolean), ''])];
  return [...new Set([...order, ...rest])].filter(a => used.includes(a));
}
/** A section name the owner typed: trimmed, single spaces, 1–40 characters; null when not usable. */
export function cleanArea(text: string) {
  const v = text.trim().replace(/\s+/g, ' ');
  return v && v.length <= 40 ? v : null;
}
/** The same section under another spelling ("üst kat" for "Üst kat", "İç" for 'inside'), so typing it again does not make a second one. */
export function sameArea(areas: string[], typed: string) {
  const key = typed.toLocaleLowerCase('tr-TR');
  return areas.find(a => a && (a.toLocaleLowerCase('tr-TR') === key || sectionName(a).toLocaleLowerCase('tr-TR') === key));
}

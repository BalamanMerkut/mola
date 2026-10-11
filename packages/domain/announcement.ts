/*
 * Duyurular (Mola Yönetim → every café's Destek → Duyurular): the parts both servers and both screens share. Pure code (no
 * Node imports): server/merkez/announcements.ts keeps and sends them, server/kafe-link.ts keeps the café's copy and its read
 * marks, src/PlatformAnnouncements.tsx writes them, src/Announcements.tsx shows them.
 */
export const ANNOUNCEMENT_TITLE_MAX = 120, ANNOUNCEMENT_TEXT_MAX = 4000;
/** What one café gets for one announcement (only its own businesses in `tenants`); `v` grows with every edit. */
export type AnnouncementDelivery = { id: string; v: number; title: string; text: string; important: boolean; sentAt: string; editedAt?: string; tenants: string[] };
/** Who opened it on the café: the owner or the Müdür; `ackAt`: the owner's "Okudum" on an Önemli one. */
export type AnnouncementReader = 'owner' | 'manager';
export type AnnouncementRead = { readAt: string; by: AnnouncementReader; ackAt?: string };
/** Who it went to, as the vendor chose it; the businesses themselves are fixed when it is sent. */
export type AnnouncementAudience = { kind: 'all' } | { kind: 'packages'; packageIds: string[]; names?: string[] } | { kind: 'selected' };

// Controls and direction marks hide or reorder text; line breaks and tabs are kept (the text is plain, with its own lines).
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿]/g;
/** Plain text as the vendor wrote it: no hidden marks, Windows line ends made plain, at most two empty lines in a row. */
export function announcementText(text: string, max = ANNOUNCEMENT_TEXT_MAX) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(HIDDEN, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
}
/** One line title (no line breaks). */
export const announcementTitle = (title: string) => announcementText(title, ANNOUNCEMENT_TITLE_MAX).replace(/\s*\n\s*/g, ' ');

/** The text cut into plain parts and web links (https:// or http://, and "www."), so a screen can link them without HTML. */
export function linkParts(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [], re = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    // A sentence's own full stop, comma or closing bracket is not part of the address.
    const raw = m[0].replace(/[.,;:!?)\]]+$/, ''), at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: raw, href: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` });
    last = at + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

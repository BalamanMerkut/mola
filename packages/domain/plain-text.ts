/**
 * Invisible characters that change how a name looks: C0/C1 controls, the direction marks and overrides (U+200E/F,
 * U+202A–U+202E, U+2066–U+2069, U+061C) and zero-width / BOM characters. "fatura‮fdp.exe" would show as "fatura​exe.pdf";
 * without them it shows as written. Pure code: server/merkez/attachments.ts (stored names) and src/TicketFiles.tsx (shown names).
 */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f؜​-‏‪-‮⁠-⁩﻿]/g;
export const withoutHiddenMarks = (text: string) => String(text ?? '').replace(HIDDEN, '');

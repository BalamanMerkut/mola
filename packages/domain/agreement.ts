/*
 * Mola Lisans Sözleşmesi (son kullanıcı lisans sözleşmesi). The text itself is docs/hukuk/MOLA_LISANS_SOZLESMESI.md: the café
 * screens import that file as it is (src/LicenseAgreement.tsx), so there is one text. Its "Sürüm: N" line and AGREEMENT_VERSION
 * must say the same number (tests/license-agreement.test.ts); raise both when the text changes, and every owner is asked again.
 * Acceptance is kept on the café computer and told to Mola Merkez with the activation and the heartbeat; it is never part of
 * the signed licence.
 */
export const AGREEMENT_VERSION = 4;
export const AGREEMENT_NAME = 'Mola Lisans Sözleşmesi';
/** Who accepted which version, when (the owner's own name, when one was typed). */
export type AgreementAcceptance = { version: number; acceptedAt: string; name?: string };
/** The version a text declares on its "Sürüm: N" line (0: none). */
export const agreementVersionOf = (text: string) => Number(/^Sürüm:\s*(\d+)\s*$/m.exec(text)?.[1] ?? 0);
/** No acceptance yet, or one of an older text: the owner is asked (once per sign-in, never blocking anyone). */
export const agreementNeeded = (a?: { version: number } | null) => !a || a.version < AGREEMENT_VERSION;

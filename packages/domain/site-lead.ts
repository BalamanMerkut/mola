/*
 * Web sitesi talebi (molayazilim.com.tr → Destek ve İletişim formu → Mola Yönetim → Başvurular).
 * One set of rules for the public site (field limits, the business types, the KVKK text version it shows) and for Mola
 * Merkez (server/merkez/site-leads.ts checks everything again). Browser-safe: no node: imports.
 */
export const SITE_LEAD_TYPES = ['kafe', 'restoran', 'pastane', 'cay-bahcesi', 'diger'] as const;
export type SiteLeadType = typeof SITE_LEAD_TYPES[number];
export const SITE_LEAD_TYPE_NAMES: Record<SiteLeadType, string> = { kafe: 'Kafe', restoran: 'Restoran', pastane: 'Pastane', 'cay-bahcesi': 'Çay bahçesi', diger: 'Diğer' };
/** "İşletme ekle" in Mola Yönetim starts with this business type (sector); none for "Diğer". */
export const SITE_LEAD_SECTOR: Record<SiteLeadType, 'cafe' | 'restaurant' | 'dessert' | undefined> = { kafe: 'cafe', restoran: 'restaurant', pastane: 'dessert', 'cay-bahcesi': 'cafe', diger: undefined };
/**
 * The version of the KVKK Aydınlatma Metni the form links to. Kept with each lead (with the time of the tick) so it is
 * known later which text the person saw. Change it whenever site/src/pages/kvkk.html changes in substance.
 */
export const SITE_CONSENT_VERSION = 'kvkk-aydinlatma-2026-10-08';
export const SITE_LEAD_LIMITS = {
  business: { min: 2, max: 80 }, person: { min: 2, max: 80 }, phone: { max: 20 }, email: { max: 120 },
  city: { min: 2, max: 40 }, tables: { min: 1, max: 500 }, message: { max: 1500 },
} as const;
/** A person fills the form in seconds at the very least; a bot right away. Seconds between opening the form and sending. */
export const SITE_LEAD_MIN_SECONDS = 4;

export type SiteLeadInput = {
  business: string; person: string; phone: string; email?: string; city: string; tables?: number; type: SiteLeadType; message?: string;
  consent: true; consentVersion: string;
};
export type SiteLeadProblem = { field: keyof SiteLeadInput | 'form'; message: string };

const clean = (v: unknown) => typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim() : '';
const oneLine = (v: unknown) => clean(v).replace(/\s+/g, ' ');
/**
 * Turkish numbers (cep or sabit) to +90XXXXXXXXXX: "0532 123 45 67", "532 123 4567", "+90 (424) 123 45 67", "0090…".
 * Another country's number only with its "+" and 8–15 digits. Anything else: undefined.
 */
export function siteLeadPhone(value: unknown): string | undefined {
  const raw = oneLine(value); if (!raw || raw.length > SITE_LEAD_LIMITS.phone.max + 6) return undefined;
  if (!/^[+\d\s().\-/]+$/.test(raw)) return undefined;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(2);
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10 && /^[2-5]/.test(digits)) return `+90${digits}`;
  if (raw.startsWith('+') && !raw.startsWith('+90') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return undefined;
}
/** "+90 532 123 45 67" for the screen. */
export const showSiteLeadPhone = (p: string) => p.startsWith('+90') && p.length === 13 ? `+90 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9, 11)} ${p.slice(11)}` : p;
const EMAIL = /^[^\s@<>"(),;:]{1,64}@[^\s@<>"(),;:]{1,190}\.[a-z]{2,}$/i;

/** Checks and tidies what the form sent. The first problem, in the words the form shows next to the field. */
export function checkSiteLead(body: unknown): { ok: true; value: SiteLeadInput } | { ok: false; problem: SiteLeadProblem } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fail = (field: SiteLeadProblem['field'], message: string) => ({ ok: false as const, problem: { field, message } });
  const L = SITE_LEAD_LIMITS;
  const business = oneLine(b.business), person = oneLine(b.person), city = oneLine(b.city) || 'Elazığ', email = oneLine(b.email), message = clean(b.message).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (business.length < L.business.min || business.length > L.business.max) return fail('business', 'İşletmenizin adını yazın.');
  if (person.length < L.person.min || person.length > L.person.max) return fail('person', 'Adınızı ve soyadınızı yazın.');
  const phone = siteLeadPhone(b.phone);
  if (!phone) return fail('phone', 'Telefon numarası geçersiz. Örnek: 0532 123 45 67');
  if (email && (email.length > L.email.max || !EMAIL.test(email))) return fail('email', 'E-posta adresi geçersiz. Boş da bırakabilirsiniz.');
  if (city.length < L.city.min || city.length > L.city.max || /[<>{}]/.test(city)) return fail('city', 'Şehri yazın.');
  let tables: number | undefined;
  if (b.tables !== undefined && b.tables !== null && b.tables !== '') {
    const n = typeof b.tables === 'number' ? b.tables : Number(String(b.tables).trim());
    if (!Number.isInteger(n) || n < L.tables.min || n > L.tables.max) return fail('tables', `Masa sayısı ${L.tables.min} ile ${L.tables.max} arasında olmalı. Boş da bırakabilirsiniz.`);
    tables = n;
  }
  if (typeof b.type !== 'string' || !(SITE_LEAD_TYPES as readonly string[]).includes(b.type)) return fail('type', 'İşletme türünü seçin.');
  if (message.length > L.message.max) return fail('message', `Mesaj en çok ${L.message.max} harf olabilir.`);
  if (b.consent !== true) return fail('consent', 'Devam etmek için KVKK Aydınlatma Metni’ni okuduğunuzu onaylayın.');
  if (b.consentVersion !== SITE_CONSENT_VERSION) return fail('consentVersion', 'Sayfa eski kalmış. Lütfen sayfayı yenileyip yeniden gönderin.');
  return { ok: true, value: { business, person, phone, ...(email ? { email } : {}), city, ...(tables ? { tables } : {}), type: b.type as SiteLeadType, ...(message ? { message } : {}), consent: true, consentVersion: SITE_CONSENT_VERSION } };
}

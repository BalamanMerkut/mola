// Invoice details of a business ("Hesap açma başvurusu", Mola Yönetim → Fatura bilgileri). Browser-safe: the café form,
// both servers and the vendor's panel check the same rules. Official checksums (GİB VKN, NVİ TCKN), Turkish mobile numbers.

export type TaxType = 'company' | 'person';
/** What the vendor needs for e-fatura / e-arşiv. `phone` is normalised (+905xxxxxxxxx), `taxNumber` digits only. */
export type Invoice = { legalName: string; taxOffice: string; taxType: TaxType; taxNumber: string; city: string; district: string; address: string; phone: string; email: string };
export const taxTypeNames: Record<TaxType, string> = { company: 'Şirket', person: 'Şahıs işletmesi' };

/** Vergi kimlik numarası (10 digits): the Gelir İdaresi check digit. */
export function validVkn(value: string) {
  if (!/^\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(value[i]) + 9 - i) % 10;
    // A digit that lands on 9 after the shift counts as 9; otherwise t·2^(9−i) mod 9 (never 0 for t ≠ 0).
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}
/** T.C. kimlik numarası (11 digits, not starting with 0): the two check digits. */
export function validTckn(value: string) {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number), odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
  return ((odd * 7 - even) % 10 + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}
export const validTaxNumber = (type: TaxType, value: string) => type === 'company' ? validVkn(value) : validTckn(value);
/** A Turkish mobile number in any usual spelling (0532…, +90 532…, 532 …) as +905xxxxxxxxx; '' when it is not one. */
export function normalPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `+90${digits}` : '';
}
export const normalEmail = (value: string) => value.trim().toLowerCase();
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) && value.trim().length <= 120;
/**
 * "Kaydı sil" confirmation in Mola Yönetim (the screen and Merkez check the same way): the business name typed again, ignoring
 * case (Turkish I/ı/İ/i alike) and every space.
 */
export const sameBusinessName = (typed: string, name: string) => {
  const fold = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/\s+/g, '');
  return !!fold(typed) && fold(typed) === fold(name);
};
/** "+90 532 123 45 67" for screens. */
export const showPhone = (p: string) => /^\+905\d{9}$/.test(p) ? `+90 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9, 11)} ${p.slice(11)}` : p;

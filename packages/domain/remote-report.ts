/*
 * Uzaktan raporlar: what the café computer puts inside an encrypted box for the owner's phone (server/remote-reports.ts builds
 * it, src/ReportsPhone.tsx shows it). Browser-safe (types only). Money in kuruş; days are business days (05:00–05:00).
 * Mola Merkez never sees this object: it is encrypted on the café computer for each phone (packages/domain/remote-crypto.ts).
 */
export type PhoneReportReason = 'live' | 'periodic' | 'closing' | 'shutdown' | 'paired';
export type PhoneReport = {
  v: 1;
  business: string;
  /** When the café computer made it. */
  at: string;
  /** The business day it describes ("kasa günü"). */
  day: string;
  reason: PhoneReportReason;
  today: {
    sales: number; cash: number; card: number; platform: number;
    orders: number; closedAccounts: number; averageAccount: number;
    expenses: number; refunds: number; kept: number;
    cancelled: { count: number; amount: number };
    channels: { name: string; orders: number; amount: number }[];
    /** The same stretch of the day before (up to the same clock time while today runs). */
    previous: { sales: number; partial?: boolean } | null;
  };
  topProducts: { name: string; qty: number; amount: number; unit?: 'kg'; grams?: number }[];
  hourly: { hour: number; sales: number }[];
  /** Bills open right now (live) or when the snapshot was made (at closing: what stayed open). */
  open: { accounts: number; amount: number };
  lastClosing: { at: string; day: string; byName: string; extra?: boolean; counted: number; expected: number; difference: number } | null;
  /** The last 30 business days, oldest first. */
  days: { day: string; sales: number }[];
  /** "Kafeyi yönet": absent when the package has no Uzaktan yönetim; otherwise whether the owner turned it on (0.1.21). */
  admin?: 'on' | 'off';
};

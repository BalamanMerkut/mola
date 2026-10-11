/*
 * Turkish case endings after a clock time, as it is read aloud: "01:24" is "bir yirmi dört", so "01:24'ten"; "14:30" is
 * "on dört otuz", so "14:30'da"; "05:00" is "beş", so "05:00'e kadar". The ending follows the last word read: its last vowel
 * (e or a), a hard last consonant (t instead of d) and, for "-e", a vowel at the end (y before it).
 */
export type Ek = 'den' | 'de' | 'e';
const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli'];
/** The last word of a number from 0 to 59 read aloud. */
function lastWord(n: number) { return n === 0 ? 'sıfır' : n % 10 ? ONES[n % 10] : TENS[Math.floor(n / 10)]; }
const FRONT = 'eiöü', VOWELS = 'aeıioöuü', HARD = 'fstkçşhp';

/** "01:24" + "den" → "01:24'ten"; anything that is not HH:MM gets the plain ending. */
export function saatEki(time: string, ek: Ek) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const word = m ? lastWord(Number(m[2]) || Number(m[1])) : 'bir';
  const vowel = [...word].reverse().find(c => VOWELS.includes(c)) ?? 'e', front = FRONT.includes(vowel), end = word.at(-1)!;
  const d = HARD.includes(end) ? 't' : 'd';
  const suffix = ek === 'den' ? `${d}${front ? 'en' : 'an'}` : ek === 'de' ? `${d}${front ? 'e' : 'a'}` : `${VOWELS.includes(end) ? 'y' : ''}${front ? 'e' : 'a'}`;
  return `${time}'${suffix}`;
}

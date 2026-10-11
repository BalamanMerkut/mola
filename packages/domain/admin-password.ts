/*
 * Mola Yönetim yönetici şifresi: kolay tahmin edilen şifreleri reddeder ve ne değişmesi gerektiğini düz cümleyle söyler.
 * Hem sunucu (server/admin-auth.ts: ilk şifre değişimi, şifre değişimi, her sıfırlama) hem ekran (src/PlatformPassword.tsx,
 * yazarken ipucu) kullanır; sunucu ayrıca Merkez'deki işletme adlarını da verir. Yalnız saf kod (tarayıcıya da gider).
 */
export const ADMIN_PASSWORD_MIN = 12;
/** Words anyone would try first against Mola Yönetim (product, role, common Turkish and English passwords, teams, cities). */
const COMMON = ['mola', 'molayonetim', 'yonetim', 'yonetici', 'merkez', 'merkut', 'studios', 'admin', 'administrator', 'root', 'sifre', 'parola', 'password', 'passwd', 'qwerty', 'asdf', 'zxcv',
  'kafe', 'cafe', 'kahve', 'restoran', 'iloveyou', 'seviyorum', 'welcome', 'hosgeldin', 'letmein', 'giris', 'login', 'test', 'deneme', 'turkiye', 'istanbul', 'ankara', 'izmir',
  'galatasaray', 'fenerbahce', 'besiktas', 'trabzonspor', 'sifrem', 'parolam'];
const KEYBOARD = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
/** Lower case, Turkish letters to plain ones (ş → s), so "Şifre" and "sifre" are the same word. */
const fold = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').normalize('NFKD').replace(/[̀-ͯ]/g, '');
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
const leet = (s: string) => s.replace(/[013457@$!]/g, c => LEET[c]);
/** How b follows a: +1/-1 in order (abc, 321, 890 wraps), +2/-2 along a keyboard row (qwer). Several at once (fg). */
function steps(a: string, b: string): number[] {
  const out: number[] = [], d = b.charCodeAt(0) - a.charCodeAt(0), digits = /\d/.test(a) && /\d/.test(b), letters = /[a-z]/.test(a) && /[a-z]/.test(b);
  if (digits) { if (d === 1 || d === -9) out.push(1); if (d === -1 || d === 9) out.push(-1); }
  if (letters) {
    if (d === 1) out.push(1); if (d === -1) out.push(-1);
    for (const row of KEYBOARD) { const i = row.indexOf(a); if (i >= 0 && row[i + 1] === b) out.push(2); if (i > 0 && row[i - 1] === b) out.push(-2); }
  }
  return out;
}
/** Runs that step by one (abcd, 4321, 7890) or follow a keyboard row (qwer) are dropped: letters from 4, digits from 3. */
function withoutSequences(text: string) {
  const s = [...text], keep = s.map(() => true);
  let i = 0;
  while (i < s.length - 1) {
    let dirs = steps(s[i], s[i + 1]);
    if (!dirs.length) { i++; continue; }
    let j = i + 1;
    while (j + 1 < s.length) { const next = steps(s[j], s[j + 1]).filter(x => dirs.includes(x)); if (!next.length) break; dirs = next; j++; }
    if (j - i + 1 >= (/\d/.test(s[i]) ? 3 : 4)) for (let k = i; k <= j; k++) keep[k] = false;
    i = j;
  }
  return s.filter((_, k) => keep[k]).join('');
}
const withoutRepeats = (s: string) => s.replace(/(.)\1{2,}/g, '').replace(/(.{2,4})\1{2,}/g, '');
const withoutYears = (s: string) => s.replace(/(19|20)\d\d/g, '');
/** Words of a business name (3 letters or more), for "the business name is not a password". */
export function nameWords(names: string[]) { return [...new Set(names.flatMap(n => fold(n).split(/[^a-z0-9]+/)).filter(w => w.length >= 3))]; }
/**
 * Why this password is too easy to guess, in one sentence the vendor can act on; undefined when it is fine.
 * `extra`: more words to treat as known (the businesses' names on this Merkez).
 */
export function weakAdminPassword(password: string, extra: string[] = []): string | undefined {
  if ([...password].length < ADMIN_PASSWORD_MIN) return `Şifre en az ${ADMIN_PASSWORD_MIN} karakter olmalı.`;
  const plain = fold(password).replace(/\s+/g, '');
  if (new Set(plain).size <= 3) return 'Şifre aynı birkaç karakterin tekrarından oluşuyor (ör. “aaaaaaaaaaaa”, “121212121212”). Farklı harf, rakam ve işaretler karıştırın.';
  const shaped = withoutRepeats(withoutSequences(withoutYears(plain)));
  if (shaped.length < 6) return 'Şifre ardışık ya da tekrar eden karakterlerden oluşuyor (ör. “123456…”, “abcdef…”, “qwerty…”). Araya yalnız sizin bileceğiniz kelimeler ekleyin.';
  let rest = leet(shaped);
  const words = [...COMMON, ...nameWords(extra)].sort((a, b) => b.length - a.length);
  for (const w of words) rest = rest.split(w).join('');
  rest = withoutRepeats(rest);
  if (rest.replace(/[^a-z0-9]/g, '').length < 5 || rest.length < 6) return 'Şifre kolay tahmin edilen parçalardan oluşuyor (“mola”, “admin”, “şifre”, işletme adı, yıl gibi). Bunların yerine yalnız sizin bileceğiniz kelimeler ya da rastgele harfler kullanın.';
  return undefined;
}

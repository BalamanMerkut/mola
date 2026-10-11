/**
 * Backup and restore failures in the owner's words. Mola's own messages are already Turkish; what Node, Windows or SQLite
 * says ("ENOENT: no such file…", "file is not a database") never reaches the screen as is.
 */
const systemWords: Record<string, string> = {
  ENOENT: 'Klasör ya da dosya bulunamadı. Flash bellek takılıysa çıkarıp yeniden takın.',
  ENAMETOOLONG: 'Klasör yolu çok uzun. Yedeği kısa bir klasöre (ör. D:\\Mola-Yedek) kopyalayıp yeniden deneyin.',
  ENOSPC: 'Diskte yer kalmadı. Yer açıp yeniden deneyin.',
  EACCES: 'Klasöre erişim izni yok. Başka bir klasör seçin.',
  EPERM: 'Klasöre erişim izni yok ya da dosya başka bir programda açık. Biraz sonra yeniden deneyin.',
  EBUSY: 'Dosya başka bir programda açık (ör. OneDrive eşitlemesi). Biraz sonra yeniden deneyin.',
  EROFS: 'Bu disk yalnız okunabiliyor. Başka bir yer seçin.',
  EIO: 'Disk okunamadı. Flash belleği ya da diski kontrol edin.',
};
/** Turkish letters: a message Mola wrote itself (every own message has at least one). */
const own = (text: string) => /[çğıöşüÇĞİÖŞÜ’]/.test(text);
export function plainError(error: unknown, fallback = 'İşlem tamamlanamadı. Yeniden deneyin.') {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && systemWords[code]) return systemWords[code];
  if (typeof code === 'string' && /SQLITE|ERR_SQLITE/.test(code)) return 'Yedekteki veritabanı açılamadı; yedek bozuk olabilir. Başka bir yedek seçin.';
  const text = error instanceof Error ? error.message : '';
  return text && own(text) ? text.slice(0, 200) : fallback;
}

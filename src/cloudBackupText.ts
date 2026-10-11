/** Sunucu yedeği (the encrypted copy on Mola Merkez) as the café sees it: rail → Yedekle and Ayarlar → Güvenlik. */
export type CloudView = { running?: boolean; lastSuccessAt: string | null; lastError?: string | null; failing?: boolean; progress?: { sent: number; total: number } | null };

/** "bugün 03:30", "dün 23:40", else "3 Ekim 23:40". */
export function dayTime(iso: string, now = new Date()) {
  const at = new Date(iso), time = at.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const day = (d: Date) => d.toLocaleDateString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (day(at) === day(now)) return `bugün ${time}`;
  if (day(at) === day(yesterday)) return `dün ${time}`;
  return `${at.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} ${time}`;
}
/** One line: "Sunucu yedeği: dün 23:40 · başarılı", while sending "… gönderiliyor %40", or what went wrong. */
export function cloudLine(c: CloudView, now = new Date()) {
  if (c.running) return `Sunucu yedeği gönderiliyor…${c.progress?.total ? ` %${Math.min(100, Math.round(c.progress.sent / c.progress.total * 100))}` : ''}`;
  if (c.lastError || c.failing) return `Sunucu yedeği alınamadı${c.lastError ? `: ${c.lastError}` : '.'}${c.lastSuccessAt ? ` Son başarılı: ${dayTime(c.lastSuccessAt, now)}.` : ''}`;
  return c.lastSuccessAt ? `Sunucu yedeği: ${dayTime(c.lastSuccessAt, now)} · başarılı` : 'Sunucu yedeği: henüz gönderilmedi (ilk yedekten sonra gider).';
}

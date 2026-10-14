import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';

/** Kalıcı bağlantı (server/merkez/lan-link.ts): the permanent `<Merkez>/k/<kod>`, or why there is none yet. */
export type LanLink = { url: string } | { problem: 'inactive' | 'old' | 'waiting' | 'off' };

export function copyText(text: string) {
  try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(() => {}); return true; } } catch { /* below */ }
  // The café computer's LAN address is not a secure context: the old way still copies.
  try { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}

/** The page is open on the café computer itself: its own Mola window, or a browser on a loopback address. */
export const loopbackPage = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const onCafeComputer = () => loopbackPage() || document.body.classList.contains('desktop-shell');
/**
 * Kafe içi cihazlar (desktop window) and Ayarlar → Cihazlar → Kafe içi cihazlar: the link laptops and phones keep for the café (0.1.22:
 * away from it the owner signs in to Raporlarım instead), which finds this computer even after the modem gave it another address. 'off' and 'old' say nothing (the network
 * screen already says Mola is closed to it). Off the café computer: "Bu cihaza kısayol ekle" (0.1.21; no file downloads any
 * more: a .url ended up as ".download" in the owner's test) opens Mola Merkez's /k/<kod>/kur, which installs a web app or
 * says the one way this browser adds a shortcut (server/merkez/lan-link.ts). The address is the permanent link, never the LAN one.
 */
export function PermanentLink({ link }: { link?: LanLink }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); }, [copied]);
  if (!link) return null;
  if (!('url' in link)) {
    const line = link.problem === 'waiting' ? 'Kalıcı bağlantı birkaç dakika içinde hazır olur.' : link.problem === 'inactive' ? 'Mola etkinleştirilince kalıcı bağlantı burada görünür.' : '';
    return line ? <p className="muted small permanent-link-wait" data-testid="permanent-link">{line}</p> : null;
  }
  return <div className="permanent-link" data-testid="permanent-link">
    <strong><Link2 size={15} aria-hidden="true" />Kalıcı bağlantı</strong>
    <div className="permanent-link-row"><code>{link.url}</code>
      <button type="button" className="btn secondary small-btn" onClick={() => setCopied(copyText(link.url))}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Kopyalandı' : 'Kopyala'}</button></div>
    <p className="muted small">Laptop ve telefonlar için: modem adresi değiştirse de çalışır. İşletmenin Wi-Fi'sinde kasa bilgisayarını açar.</p>
    {!onCafeComputer() && <div className="permanent-link-shortcut"><a className="btn secondary small-btn" href={`${link.url}/kur`} target="_blank" rel="noopener noreferrer"><Link2 size={14} aria-hidden="true" />Bu cihaza kısayol ekle</a>
      <p className="muted small">Bir kez ekleyin, sonra Mola’yı simgeden açın.</p></div>}
  </div>;
}

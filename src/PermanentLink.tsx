import { useEffect, useState } from 'react';
import { Check, Copy, Download, Link2 } from 'lucide-react';

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
/** iPadOS asks for the desktop site with a Mac user agent: the touch points tell it apart. */
const handheld = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** "Masaüstüne kısayol": a .url (Windows and others) or .webloc (macOS) file holding the permanent link, never the LAN address. */
export function shortcutFile(url: string, business = '', mac = /Macintosh|Mac OS X/.test(navigator.userAgent)) {
  // Characters Windows forbids in file names (and control characters), no trailing dot or space.
  const name = `Mola - ${business}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[ .-]+$/, '').slice(0, 80) || 'Mola';
  return mac ? { name: `${name}.webloc`, type: 'application/x-apple-plist', body: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${xml(url)}</string></dict></plist>\n` }
    : { name: `${name}.url`, type: 'application/octet-stream', body: `[InternetShortcut]\r\nURL=${url}\r\n` };
}
function saveShortcut(url: string, business?: string) {
  const f = shortcutFile(url, business), a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([f.body], { type: f.type })); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Tabletler (desktop window) and Ayarlar → Cihazlar: the link laptops and phones keep, which finds this computer even after the
 * modem gave it another address. 'off' and 'old' say nothing (the network screen already says Mola is closed to it).
 * On a laptop (not the café computer): "Masaüstüne kısayol". Chrome's own app install needs HTTPS, and a shortcut made after the
 * redirect would keep the LAN address. `business`: the shortcut's name.
 */
export function PermanentLink({ link, business }: { link?: LanLink; business?: string }) {
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
    {!onCafeComputer() && (handheld() ? <p className="muted small">Telefonda: bağlantıyı açıp tarayıcının menüsünden Ana Ekrana Ekle.</p>
      : <div className="permanent-link-shortcut"><button type="button" className="btn secondary small-btn" onClick={() => saveShortcut(link.url, business)}><Download size={14} aria-hidden="true" />Masaüstüne kısayol</button>
        <p className="muted small">Bu bilgisayarın masaüstüne Mola kısayolu koyar; modem adresi değişse de açılır.</p></div>)}
  </div>;
}

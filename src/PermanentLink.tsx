import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';

/** Kalıcı bağlantı (server/merkez/lan-link.ts): the permanent `<Merkez>/k/<kod>`, or why there is none yet. */
export type LanLink = { url: string } | { problem: 'inactive' | 'old' | 'waiting' | 'off' };

function copyText(text: string) {
  try { if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).catch(() => {}); return true; } } catch { /* below */ }
  // The café computer's LAN address is not a secure context: the old way still copies.
  try { const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
}

/**
 * Tabletler (desktop window) and Ayarlar → Cihazlar: the link laptops and phones keep, which finds this computer even after the
 * modem gave it another address. 'off' and 'old' say nothing (the network screen already says Mola is closed to it).
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
  </div>;
}

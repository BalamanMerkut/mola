/*
 * The small Mola page Mola Merkez shows to a guest who scanned a QR code it answers for (the social short addresses /s/…,
 * the guest menu over the internet /q/…): one Turkish line, the same in English, nothing about the business. Light and dark,
 * fits a 360 px phone, no script. `refresh`: seconds until the browser tries again by itself (a café computer offline).
 */
const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function noticePage(o: { status: string; tr: string; en: string; detail?: string; detailEn?: string; refresh?: number }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${o.refresh ? `<meta http-equiv="refresh" content="${o.refresh}">` : ''}<title>Mola</title><style>
:root{color-scheme:light dark;--bg:#f4f1ea;--card:#fff;--ink:#22352c;--muted:#66746b;--brand:#2f6b55}
@media (prefers-color-scheme:dark){:root{--bg:#141a17;--card:#1d2621;--ink:#e8eee9;--muted:#9fb0a5;--brand:#7cc3a4}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;padding:16px}
main{max-width:420px;width:100%;background:var(--card);border-radius:20px;padding:32px 24px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)}
.mark{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:16px;background:var(--brand);color:var(--card);font-weight:800;font-size:22px;margin-bottom:14px}
h1{font-size:19px;margin:0 0 8px;line-height:1.35}p{margin:0;color:var(--muted);font-size:15px}p+p{margin-top:6px}.detail{margin-top:14px;font-size:13px}small{display:block;margin-top:22px;color:var(--muted);font-size:12px}
</style></head><body><main data-status="${escape(o.status)}"><div class="mark" aria-hidden="true">M</div><h1>${escape(o.tr)}</h1><p lang="en">${escape(o.en)}</p>${o.detail ? `<p class="detail">${escape(o.detail)}</p>` : ''}${o.detailEn ? `<p class="detail" lang="en">${escape(o.detailEn)}</p>` : ''}<small>Mola</small></main></body></html>`;
}

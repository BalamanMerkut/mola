import { useState } from 'react';
import { Check, Copy, Info, MessageCircle, Printer } from 'lucide-react';
import { whatsappLink } from './MolaContact';
import { dateTime } from './platformStatus';
import './platform-activation-help.css';

/*
 * Where the activation code goes, said plainly (the owner looked for a place to type it in Mola Yönetim): the code is typed
 * on the café's computer, in Mola's first screen "Mola'yı etkinleştir" → "Etkinleştirme kodum var" (src/Activation.tsx).
 * One Mola installation is linked to one business (server/kafe-link.ts keeps a single link; a second code on an activated
 * computer is refused with ALREADY_ACTIVE). Uninstalling keeps the data (scripts/build-installer.mjs, KALDIRMA), so a plain
 * reinstall opens the same business again; only "Verileri ve yedekleri de sil" starts that computer from the first screen.
 */
export const ACTIVATION_STEPS = [
  ['Kafenin bilgisayarına Mola’yı kurun', '“Mola Kurulum.exe” → Kur; bitince “Mola’yı aç”.'],
  ['“Mola’yı etkinleştir” ekranında “Etkinleştirme kodum var”ı seçin', 'Bu ekran ilk açılışta, işletme sahibi hesabından önce çıkar. İnternet gerekir.'],
  ['Kodu yazıp “Etkinleştir”e basın', 'Büyük/küçük harf fark etmez. Sonra işletme sahibi hesabı ve kurulum sihirbazı gelir.'],
] as const;
export const ONE_BUSINESS_NOTE = 'Bir bilgisayardaki Mola tek bir işletmeye bağlanır; etkinleştirilmiş bir bilgisayarda bu ekran bir daha çıkmaz. İkinci bir işletmeyi denemek için başka bir bilgisayar kullanın ya da o bilgisayarda Mola’yı “Verileri ve yedekleri de sil” işaretli kaldırıp yeniden kurun (o bilgisayardaki önceki işletmenin verileri silinir). Yalnız kaldırıp kurmak yetmez: veriler kalır, Mola aynı işletmeyle açılır.';

/** The text that goes with the code (WhatsApp, the printed page). */
export function activationText(name: string, code: string, expiresAt?: string) {
  return [`Mola etkinleştirme kodu${name ? ` (${name})` : ''}: ${code}`, '',
    ...ACTIVATION_STEPS.map(([step], i) => `${i + 1}) ${step}.`), '',
    `Kod tek kullanımlıktır${expiresAt ? `, ${dateTime(expiresAt)} tarihine kadar geçerlidir` : ''}.`].join('\n');
}

/** A small picture of the café's first screen with the right choice marked. */
function ActivationPicture({ code }: { code?: string }) {
  return <svg className="act-picture" viewBox="0 0 240 150" role="img" aria-label="Kafenin bilgisayarında Mola’nın ilk ekranı: “Etkinleştirme kodum var” seçilir, kod kutusuna yazılır">
    <rect x="1" y="1" width="238" height="148" rx="14" fill="#fff" stroke="#d9e2d4" />
    <rect x="1" y="1" width="238" height="22" rx="14" fill="#eef3ea" /><rect x="1" y="14" width="238" height="9" fill="#eef3ea" />
    <circle cx="14" cy="12" r="3.5" fill="#e3b4a2" /><circle cx="25" cy="12" r="3.5" fill="#ecd59c" /><circle cx="36" cy="12" r="3.5" fill="#b9d4b2" />
    <text x="20" y="44" fontSize="11" fontWeight="700" fill="#22362b">Mola’yı etkinleştir</text>
    <rect x="20" y="54" width="200" height="26" rx="8" fill="#f6f8f4" stroke="#e1e7dc" />
    <text x="30" y="71" fontSize="9" fill="#5c665f">Hesap açma başvurusu</text>
    <rect x="20" y="86" width="200" height="26" rx="8" fill="#e6f1e3" stroke="#5f9a5c" strokeWidth="1.6" />
    <text x="30" y="103" fontSize="9" fontWeight="700" fill="#2c6436">Etkinleştirme kodum var</text>
    <circle cx="206" cy="99" r="7" fill="#5f9a5c" /><path d="M202.5 99l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <rect x="20" y="118" width="200" height="22" rx="6" fill="#fff" stroke="#c9d6c4" strokeDasharray="3 2" />
    <text x="120" y="133" fontSize="10" fontWeight="700" textAnchor="middle" fill="#22362b" fontFamily="Consolas, monospace" letterSpacing="1">{code ?? 'XXXX-XXXX-XXXX'}</text>
  </svg>;
}

/** "Bu kod nereye girilir": the three steps beside the picture, and the one-business note. */
export function ActivationSteps({ code, compact = false }: { code?: string; compact?: boolean }) {
  return <div className={`act-help${compact ? ' compact' : ''}`} data-testid="activation-steps">
    <div className="act-help-main">
      <p className="act-help-lead"><strong>Bu kod Mola Yönetim’e değil, kafenin bilgisayarındaki Mola’ya girilir.</strong></p>
      <ol className="act-steps">{ACTIVATION_STEPS.map(([step, more], i) => <li key={i}><span className="act-step-no" aria-hidden="true">{i + 1}</span><div><strong>{step}</strong><small>{more}</small></div></li>)}</ol>
    </div>
    <ActivationPicture code={code} />
    <p className="act-note"><Info size={15} aria-hidden="true" /><span>{ONE_BUSINESS_NOTE}</span></p>
  </div>;
}

function printCode(name: string, code: string, expiresAt?: string) {
  const frame = document.createElement('iframe'); frame.setAttribute('aria-hidden', 'true'); frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(frame); const doc = frame.contentDocument!;
  doc.open(); doc.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Mola etkinleştirme kodu</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#111}h1{font-size:22px}.code{font:700 30px/1.5 Consolas,monospace;letter-spacing:4px;border:2px solid #111;padding:16px;margin:20px 0;text-align:center}li{margin:8px 0;font-size:15px}p{font-size:13px;color:#444}</style></head><body><h1></h1><div class="code"></div><ol></ol><p class="exp"></p><p class="note"></p></body></html>');
  doc.close();
  doc.querySelector('h1')!.textContent = `Mola etkinleştirme kodu${name ? ` · ${name}` : ''}`;
  doc.querySelector('.code')!.textContent = code;
  const list = doc.querySelector('ol')!;
  for (const [step, more] of ACTIVATION_STEPS) { const li = doc.createElement('li'); li.textContent = `${step}. ${more}`; list.appendChild(li); }
  doc.querySelector('.exp')!.textContent = `Kod tek kullanımlıktır${expiresAt ? `; ${dateTime(expiresAt)} tarihine kadar geçerlidir` : ''}.`;
  doc.querySelector('.note')!.textContent = ONE_BUSINESS_NOTE;
  frame.contentWindow!.print(); setTimeout(() => frame.remove(), 60000);
}

/** Kopyala, Yazdır, WhatsApp ile gönder (to the business's phone when known, else WhatsApp asks whom). */
export function CodeShare({ name, code, expiresAt, phone }: { name: string; code: string; expiresAt?: string; phone?: string }) {
  const [copied, setCopied] = useState(false);
  const text = activationText(name, code, expiresAt);
  const wa = `${phone ? whatsappLink(phone) : 'https://wa.me/'}?text=${encodeURIComponent(text)}`;
  return <div className="act-share" role="group" aria-label="Kodu paylaş">
    <button type="button" className="btn secondary small-btn" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {}); }}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'Kopyalandı' : 'Kodu kopyala'}</button>
    <button type="button" className="btn secondary small-btn" onClick={() => printCode(name, code, expiresAt)}><Printer size={15} aria-hidden="true" />Yazdır</button>
    <a className="btn secondary small-btn act-whatsapp" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} aria-hidden="true" />WhatsApp ile gönder</a>
  </div>;
}

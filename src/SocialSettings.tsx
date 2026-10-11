import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, FileDown, Printer, QrCode, Share2 } from 'lucide-react';
import { normalizeSocial, socialEntries, socialHandle, socialInfo, socialPlatforms, type SocialLinks, type SocialPlatform, type SocialResult } from '../packages/domain/social-links';
import type { StaffSnapshot } from '../packages/domain/types';
import { api, ApiError, requestId } from './api';
import { Modal, Notice } from './components';
import { Card, EmptyState } from './SettingsKit';
import { LockedHint, LockedRow, openFeatureLock, usePackage } from './FeatureLock';
import { SocialIcon } from './socialIcons';
import { combinedTitle, socialCard, socialCardPng, socialQr, type CardBusiness, type SocialItem } from './socialCard';
import { canvasPdf, PAPER, type PaperSize } from './imagePdf';
import './settings-qr.css';
import './social.css';

/*
 * Ayarlar → İşletme → Sosyal medya (owner only, like the rest of İşletme): the business's links in a fixed order, each
 * typed as a handle or a full link, checked and normalised as typed (packages/domain/social-links.ts, the server checks
 * again), with a preview chip, "Bağlantıyı aç" and "QR oluştur". The Google review link is one of the rows (6 Ekim; stored as
 * before in `googleReviewUrl`). Below, the combined "Bizi takip edin" card for the counter. Saved with one bar, like Görünüm.
 * The QR codes hold the short address at Mola Merkez (POST /api/staff/social-qr), which forwards to the saved link while the
 * licence is active: so a QR is offered only for a saved link, and never with the link itself.
 * Without "Sosyal medya ve QR kartları" in the package (paid since 6 Ekim): the Google review row stays editable (core, the
 * after-payment button); the other rows are faded with "Pakette yok" (a touch opens the lock card; what was saved is kept and
 * named), the QR cards too. Saving then sends only the Google row (the server keeps the others as they are).
 */
type Values = Record<SocialPlatform, string>;
const fromLinks = (links?: SocialLinks): Values => Object.fromEntries(socialPlatforms.map(p => [p, links?.[p] ?? ''])) as Values;
type Profile = Pick<StaffSnapshot, 'name' | 'logo' | 'theme' | 'socialLinks' | 'businessRevision'>;
type Entry = { platform: SocialPlatform; url: string };

export function SocialSettings({ data, onSaved }: { data: Profile; onSaved: () => void }) {
  const [values, setValues] = useState(() => fromLinks(data.socialLinks));
  const [savedLinks, setSavedLinks] = useState<SocialLinks>(data.socialLinks ?? {});
  const [left, setLeft] = useState<Partial<Record<SocialPlatform, boolean>>>({});
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const pending = useRef<object | null>(null), revision = useRef(data.businessRevision ?? 0);
  const paid = usePackage().has('social');
  useEffect(() => { if (!pending.current) revision.current = data.businessRevision ?? 0; }, [data.businessRevision]);
  const results = Object.fromEntries(socialPlatforms.map(p => [p, normalizeSocial(p, values[p])])) as Record<SocialPlatform, SocialResult>;
  const current: SocialLinks = Object.fromEntries(socialPlatforms.flatMap(p => { const r = results[p]; return r.ok && r.url ? [[p, r.url]] : []; }));
  const invalid = socialPlatforms.filter(p => !results[p].ok);
  const dirty = invalid.length > 0 || socialPlatforms.some(p => (current[p] ?? '') !== (savedLinks[p] ?? ''));
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, uncertain]);
  async function save() {
    setBusy(true); setError(''); setSaved(false);
    // The Google review row is always named, so clearing it removes it (an absent key would leave the stored link alone).
    pending.current ??= { requestId: requestId(), version: revision.current, links: paid ? { ...current, review: current.review ?? '' } : { review: current.review ?? '' } };
    try {
      const r = await api<{ revision: number; links: SocialLinks }>('/api/staff/social-links', pending.current); pending.current = null; setUncertain(false);
      revision.current = r.revision; setSavedLinks(r.links); setValues(fromLinks(r.links)); setLeft({}); setSaved(true); onSaved();
    } catch (e) { const u = uncertain || !(e instanceof ApiError) || e.status >= 500; setUncertain(u); if (!u) pending.current = null; setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const disabled = busy || uncertain;
  const business: CardBusiness = { name: data.name, logo: data.logo, theme: data.theme };
  const [qr, setQr] = useState<Entry[] | null>(null), [combined, setCombined] = useState(false);
  // QR codes only for saved links: the short address forwards to what Mola Merkez has, i.e. what was saved.
  const filled = socialEntries(savedLinks);
  const [off, setOff] = useState<Partial<Record<SocialPlatform, boolean>>>({});
  const chosen = filled.filter(e => !off[e.platform]);

  return <section className="settings-profile social-settings" aria-label="Sosyal medya">
    <form className="settings-profile-form" onSubmit={e => { e.preventDefault(); if (!invalid.length || uncertain) void save(); }}>
      <Card icon={<Share2 size={18} aria-hidden="true" />} title="Sosyal medya hesapları" tip="Kullanıcı adını (@molacoffee) ya da bağlantının tamamını yazabilirsiniz; Mola doğru bağlantıya çevirir ve yalnız o platformun adresini kabul eder. Boş bıraktığınız hesap hiçbir yerde görünmez." lead={paid ? 'Müşteri menüsünün altında simge olarak görünür; Google değerlendirme bağlantısı hesabı kapanan müşteriye düğme olarak da gösterilir. Boş bıraktıklarınız gösterilmez.' : 'Google değerlendirme bağlantısı hesabı kapanan müşteriye düğme olarak gösterilir. Diğer hesaplar “Sosyal medya ve QR kartları” hizmetiyle menüde görünür.'}>
        {!paid && <LockedRow feature="social" title="Sosyal medya ve QR kartları" line="Google değerlendirme bağlantınız açık kalır. Diğer hesaplar, menüdeki takip logoları ve kalıcı QR kartları bu hizmetle; kayıtlı bağlantılarınız silinmez." />}
        <div className="social-rows">
          {socialPlatforms.map(p => {
            const r = results[p], info = socialInfo[p], fieldId = `social-${p}`, showError = !r.ok && !!left[p];
            if (!paid && p !== 'review') return <button type="button" className="social-row social-row-locked" data-platform={p} key={p} aria-label={`${info.name}: pakette yok`} onClick={() => openFeatureLock('social')}>
              <span className="social-row-icon" aria-hidden="true"><SocialIcon platform={p} size={20} /></span>
              <span className="social-row-main"><strong>{info.name}</strong><span className="settings-field-hint">{savedLinks[p] ? `Kayıtlı: ${socialHandle(p, savedLinks[p]!)} · menüde gösterilmiyor` : info.hint}</span></span>
              <LockedHint />
            </button>;
            const kept = r.ok && !!r.url && r.url === savedLinks[p];
            return <div className={`social-row${p === 'review' ? ' social-google' : ''}`} data-platform={p} key={p}>
              <span className="social-row-icon" aria-hidden="true"><SocialIcon platform={p} size={20} /></span>
              <div className="social-row-main">
                <label className="settings-field-label" htmlFor={fieldId}>{info.name}</label>
                <input id={fieldId} type="text" inputMode={p === 'whatsapp' ? 'tel' : 'url'} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={2048} disabled={disabled}
                  placeholder={info.placeholder} value={values[p]} aria-invalid={showError || undefined} aria-describedby={`${fieldId}-note`}
                  onChange={e => { setValues(v => ({ ...v, [p]: e.target.value })); setSaved(false); }} onBlur={() => setLeft(l => ({ ...l, [p]: true }))} />
                {showError ? <small className="field-error" id={`${fieldId}-note`} role="alert">{(r as { error: string }).error}</small>
                  : <span className="settings-field-hint" id={`${fieldId}-note`}>{info.hint}</span>}
                {r.ok && r.url && <div className="social-preview">
                  <span className="social-chip" title={r.url}><SocialIcon platform={p} size={15} />{socialHandle(p, r.url)}</span>
                  <a className="social-open" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`${info.name} bağlantısını aç`}>Bağlantıyı aç<ExternalLink size={13} aria-hidden="true" /></a>
                  {kept && !paid ? <button type="button" className="btn secondary small-btn social-qr-btn social-qr-locked" aria-label={`${info.name} için QR oluştur (pakette yok)`} onClick={() => openFeatureLock('social')}><QrCode size={15} aria-hidden="true" />QR oluştur<LockedHint /></button>
                    : kept ? <button type="button" className="btn secondary small-btn social-qr-btn" aria-label={`${info.name} için QR oluştur`} onClick={() => { setCombined(false); setQr([{ platform: p, url: r.url }]); }}><QrCode size={15} aria-hidden="true" />QR oluştur</button>
                    : <span className="settings-field-hint">Kaydedince QR oluşturabilirsiniz.</span>}
                </div>}
              </div>
            </div>;
          })}
        </div>
      </Card>

      <Card icon={<QrCode size={18} aria-hidden="true" />} title="Kalıcı QR kodları" tip="QR kodu Mola Merkez’deki kısa bir adresi taşır; Mola sizi kaydettiğiniz bağlantıya yönlendirir. Bağlantıyı sonradan değiştirirseniz basılı QR yeni bağlantıyı açar, yeniden basmanız gerekmez. Lisans askıdayken QR çalışmaz." lead="Her bağlantının yanındaki “QR oluştur” ile tek kart; buradan da bütün hesaplarınız tek kartta (kasanın önü, tezgâh). PNG ya da PDF olarak indirin veya yazdırın.">
        {!paid ? <LockedRow feature="social" title="Kalıcı QR kartları" line="Instagram, Google ve diğer hesaplarınız için basılı QR kartları (PNG, PDF, yazdır): Sosyal medya ve QR kartları hizmetiyle." />
          : filled.length === 0 ? <EmptyState icon={<QrCode size={22} aria-hidden="true" />} title="Henüz kayıtlı bağlantı yok." text="Yukarıya en az bir hesap yazıp kaydedin; QR kodu hemen hazırlanır." />
          : <div className="settings-subsection social-combined">
            <h4><QrCode size={16} aria-hidden="true" />“Bizi takip edin” kartı</h4>
            <fieldset className="social-pick" disabled={busy}><legend className="settings-field-label">Kartta olacak hesaplar</legend>
              {filled.map(e => <label key={e.platform} className={`social-pick-item${off[e.platform] ? '' : ' on'}`}><input type="checkbox" aria-label={`${socialInfo[e.platform].name} kartta olsun`} checked={!off[e.platform]} onChange={x => setOff(o => ({ ...o, [e.platform]: !x.target.checked }))} /><SocialIcon platform={e.platform} size={16} />{socialInfo[e.platform].name}</label>)}
            </fieldset>
            <div className="settings-actions"><button type="button" className="btn primary" disabled={!chosen.length} onClick={() => { setCombined(true); setQr(chosen); }}><QrCode size={16} aria-hidden="true" />Kartı hazırla</button></div>
            {dirty && <span className="settings-field-hint">Kaydedilmemiş değişiklikler karta girmez.</span>}
          </div>}
        <p className="settings-field-hint social-qr-note">QR, Mola üzerinden yönlenir; lisans askıdayken çalışmaz.</p>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}
      {saved && !dirty && <Notice tone="success">{paid ? 'Sosyal medya bağlantıları kaydedildi. Müşteri menüsünde görünüyor.' : 'Google değerlendirme bağlantısı kaydedildi. Hesabı kapanan müşteriye gösterilir.'}</Notice>}
      <div className={`profile-save-bar${dirty || uncertain ? ' dirty' : ''}`}><span role="status">{uncertain ? 'Kayıt sonucu belirsiz.' : invalid.length ? `${invalid.length === 1 ? socialInfo[invalid[0]].name : `${invalid.length} bağlantı`} düzeltilmeli.` : dirty ? 'Kaydedilmemiş değişiklikler var.' : 'Bağlantılar güncel.'}</span>
        <button className="btn primary" disabled={busy || (!uncertain && (!dirty || invalid.length > 0))}>{uncertain ? 'Kaydı yeniden kontrol et' : 'Bağlantıları kaydet'}</button></div>
    </form>
    {qr && <SocialQrDialog entries={qr} combined={combined} business={business} onClose={() => setQr(null)} />}
  </section>;
}

const fileName = (items: Entry[], combined: boolean) => combined ? 'bizi-takip-edin' : `${items[0].platform}-qr`;
/** Saves a file made in the browser (the PDF) under its name. */
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/**
 * One card (or the combined card): first the short address from Mola Merkez (or the reason there is none: not activated,
 * Merkez unreachable), then the PNG preview, "PNG indir", "PDF indir" (A4 or A6), the bare QR, and "Yazdır".
 */
function SocialQrDialog({ entries, combined, business, onClose }: { entries: Entry[]; combined: boolean; business: CardBusiness; onClose: () => void }) {
  const [items, setItems] = useState<SocialItem[] | null>(null);
  const [card, setCard] = useState(''), [codes, setCodes] = useState<string[]>([]), [error, setError] = useState(''), [printing, setPrinting] = useState(false);
  const [paper, setPaper] = useState<PaperSize>('a4'), [making, setMaking] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ base: string }>('/api/staff/social-qr', {})
      .then(async ({ base }) => {
        const list = entries.map(e => ({ ...e, qr: `${base}/${e.platform}` }));
        const [png, qrs] = await Promise.all([socialCardPng(list, business, combined), Promise.all(list.map(i => socialQr(i.qr, 960)))]);
        if (live) { setItems(list); setCard(png); setCodes(qrs); }
      })
      .catch(e => { if (live) setError(e instanceof ApiError ? e.message : 'QR kodu hazırlanamadı. Tekrar deneyin.'); });
    return () => { live = false; };
  }, [entries, combined]);
  // Prints once the sheet is on the page (images are data URLs, ready at once); the sheet leaves after the print dialog.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);
  async function pdf() {
    if (!items) return;
    setMaking(true); setError('');
    try { const canvas = await socialCard(items, business, combined, paper === 'a4' ? 2 : 1); saveFile(await canvasPdf(canvas, paper, title), `${fileName(entries, combined)}-${paper}.pdf`); }
    catch { setError('PDF hazırlanamadı. “Yazdır” ile yazıcı olarak “PDF olarak kaydet”i seçebilirsiniz.'); }
    finally { setMaking(false); }
  }
  const one = !combined ? entries[0] : null, title = one ? `${socialInfo[one.platform].name} QR kodu` : '“Bizi takip edin” kartı';
  return <Modal title={title} onClose={onClose} className="social-qr-dialog">
    <div className="social-qr-body">
      {error && <Notice tone="error">{error}</Notice>}
      {!error && <div className="social-card-stage">{card ? <img className="social-card-preview" src={card} alt={`${title} önizlemesi`} /> : <span className="social-card-wait" role="status">Hazırlanıyor…</span>}</div>}
      {items && <p className="settings-field-hint social-qr-address">{one ? <>QR kodu <code className="settings-code">{items[0].qr}</code> adresini taşır ve <code className="settings-code">{one.url}</code> adresine yönlenir.</> : 'Her QR kodu Mola üzerinden hesabınızın bağlantısına yönlenir.'} QR, Mola üzerinden yönlenir; lisans askıdayken çalışmaz. Bağlantıyı değiştirirseniz basılı QR yeni bağlantıyı açar.</p>}
      {items && <div className="settings-actions social-qr-actions">
        {card && <a className="btn primary" href={card} download={`${fileName(entries, combined)}.png`}><Download size={16} aria-hidden="true" />PNG indir</a>}
        <span className="social-pdf"><select aria-label="PDF kâğıt boyutu" value={paper} disabled={making} onChange={e => setPaper(e.target.value as PaperSize)}>{(Object.keys(PAPER) as PaperSize[]).map(k => <option key={k} value={k}>{k === 'a4' ? 'A4 sayfa' : 'A6 kart'}</option>)}</select>
          <button type="button" className="btn secondary" disabled={making} onClick={() => void pdf()}><FileDown size={16} aria-hidden="true" />{making ? 'Hazırlanıyor…' : 'PDF indir'}</button></span>
        {one && codes[0] && <a className="btn secondary" href={codes[0]} download={`${one.platform}-yalniz-qr.png`} data-encoded={items[0].qr}><QrCode size={16} aria-hidden="true" />Yalnız QR kodu</a>}
        <button type="button" className="btn secondary" disabled={!codes.length || printing} onClick={() => setPrinting(true)}><Printer size={16} aria-hidden="true" />Yazdır</button>
      </div>}
    </div>
    {printing && items && codes.length > 0 && createPortal(<SocialPrintSheet items={items} codes={codes} combined={combined} business={business} />, document.body)}
  </Modal>;
}

/** The A4 page printed by "Yazdır" (shown only while printing, with the table QR sheet's print rules in settings-qr.css). */
function SocialPrintSheet({ items, codes, combined, business }: { items: SocialItem[]; codes: string[]; combined: boolean; business: CardBusiness }) {
  const head = <header className="social-print-head">{business.logo && <img src={business.logo} alt="" />}<strong>{business.name}</strong></header>;
  return <div className="qr-print-root social-print-root" data-testid="social-print-sheet">
    {!combined ? <section className="social-print-page single">
      <article className="social-print-card">{head}
        <span className="social-print-mark"><SocialIcon platform={items[0].platform} size={34} /></span>
        <h1>{socialInfo[items[0].platform].card}</h1>
        <img className="social-print-qr" src={codes[0]} alt={`${socialInfo[items[0].platform].name} QR kodu`} />
        <strong className="social-print-handle">{socialHandle(items[0].platform, items[0].url)}</strong>
        <small>Telefonunuzun kamerasıyla okutun</small>
      </article>
    </section> : <section className={`social-print-page combined count-${Math.min(items.length, 9)}`}>
      <article className="social-print-card">{head}
        <h1>{combinedTitle(items)}</h1><small>Telefonunuzun kamerasıyla okutun</small>
        <div className="social-print-grid">{items.map((i, n) => <div className="social-print-cell" key={i.platform}>
          <span className="social-print-name"><SocialIcon platform={i.platform} size={18} />{socialInfo[i.platform].name}</span>
          <img className="social-print-qr" src={codes[n]} alt={`${socialInfo[i.platform].name} QR kodu`} />
          <strong className="social-print-handle">{socialHandle(i.platform, i.url)}</strong>
        </div>)}</div>
      </article>
    </section>}
  </div>;
}

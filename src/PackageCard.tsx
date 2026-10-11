import { useId, useState } from 'react';
import { Check, Info, Lock, MessageCircle, Package2, Plus, Sparkles } from 'lucide-react';
import { featureById, optionalFeatures, type FeatureId, type PackageView } from '../packages/domain/feature-gate';
import { api } from './api';
import { Card } from './SettingsKit';
import { Modal, Notice } from './components';
import { featureIcons } from './featureIcons';
import { openFeatureLock, usePackage, writeToMola } from './FeatureLock';
import { ContactButtons } from './MolaContact';

/*
 * Ayarlar → İşletme → "Paket ve lisans" (owner; read-only for anyone else who reaches it): the package's name, its state (Deneme ·
 * N gün kaldı / Aktif), how many services are on and, when the licence says, the plan and its end; the services in it as small
 * cards (icon, name, one line, a green check); the ones not in it faded with a lock and "Pakete ekle" (a touch opens the same
 * "paketinizde yok" card as the menus, src/FeatureLock.tsx), "Yakında" ones with their chip; and the contact panel ("Mola
 * ekibine yaz" opens Destek with a prefilled ticket; the team's phone, WhatsApp and e-mail when known).
 * Also the one-time "Deneme süreniz bitti" window listing the services that closed. Both read StaffSnapshot.pkg.
 */
const sellable = (pkg: PackageView) => pkg.enabled.filter(id => id !== 'core' && !featureById.get(id)?.soon && !(pkg.menuOnly && !pkg.listed && id === 'qr-order'));
const longDate = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
const planName = (months?: number) => months === 12 ? 'Yıllık plan' : months === 6 ? '6 aylık plan' : months === 1 ? 'Aylık plan' : '';

/** One service as a small card: its icon, name and line; `on` with a green check. */
function ServiceTile({ id, on = false, note }: { id: FeatureId; on?: boolean; note?: string }) {
  const f = featureById.get(id), Icon = featureIcons[id];
  return <>
    <span className="pk-service-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.8} /></span>
    <span className="pk-service-text"><strong>{f?.name}</strong><span>{f?.description}</span>{note && <em>{note}</em>}</span>
    {on && <span className="pk-service-check" role="img" aria-label="Açık"><Check size={13} strokeWidth={3} aria-hidden="true" /></span>}
  </>;
}

export function PackageCard({ pkg }: { pkg?: PackageView }) {
  const { owner } = usePackage(), offId = useId();
  if (!pkg) return null;
  const on = sellable(pkg), off = optionalFeatures.filter(id => !on.includes(id));
  // "Yakında": closed until it is sold (an older licence without the list keeps it on, then it is simply not shown).
  const missing = off.filter(id => !featureById.get(id)?.soon), soon = off.filter(id => featureById.get(id)?.soon && !pkg.enabled.includes(id));
  const count = on.length + 1, plan = planName(pkg.planMonths);
  const status = pkg.trial ? { text: pkg.trial.started ? `Deneme · ${pkg.trial.daysLeft} gün kaldı` : 'Deneme başlamadı', tone: 'trial' }
    : pkg.active === false ? { text: 'Lisans kapalı', tone: 'off' } : pkg.active ? { text: 'Aktif', tone: 'on' } : undefined;
  const summary = [`${count} hizmet açık`, plan, pkg.until ? `Bitiş: ${longDate(pkg.until)}` : ''].filter(Boolean).join(' · ');
  return <Card icon={<Package2 size={18} aria-hidden="true" />} title="Paketiniz" className="package-card">
    <header className="pk-hero">
      <div className="pk-hero-text">
        <span className="pk-eyebrow">Mola paketiniz</span>
        <strong className="pk-name" data-testid="package-name">{pkg.name ?? 'Paket'}</strong>
        <span className="pk-summary">{summary}</span>
      </div>
      {status && <span className={`pk-status ${status.tone}`} data-testid="package-status"><span className="pk-dot" aria-hidden="true" />{status.text}</span>}
    </header>
    {pkg.trial && <p className="pk-trial-note"><Sparkles size={15} aria-hidden="true" />Deneme süresince satıştaki bütün hizmetler açık. Paketiniz deneme bitince geçerli olur; bir hizmet kapansa da verileriniz silinmez.</p>}

    <section className="pk-section" aria-labelledby={`${offId}-on`}>
      <h4 className="pk-section-title" id={`${offId}-on`}>Paketinizde<span className="pk-count">{count}</span></h4>
      <ul className="pk-grid" aria-label="Paketteki hizmetler">
        <li className="pk-service on" data-feature="core"><ServiceTile id="core" on note="Her pakette" /></li>
        {on.map(id => <li key={id} className="pk-service on" data-feature={id}><ServiceTile id={id} on /></li>)}
      </ul>
    </section>

    {(missing.length > 0 || soon.length > 0) && <section className="pk-section" aria-labelledby={`${offId}-off`}>
      <h4 className="pk-section-title" id={`${offId}-off`}>Paketinize eklenebilecekler<span className="pk-count muted">{missing.length + soon.length}</span></h4>
      <ul className="pk-grid" aria-label="Pakette olmayan hizmetler">
        {missing.map(id => <li key={id}><button type="button" className="pk-service off" data-feature={id} aria-label={`${featureById.get(id)?.name}: pakette yok, ayrıntı`} onClick={() => openFeatureLock(id)}>
          <ServiceTile id={id} /><span className="pk-add"><Lock size={12} aria-hidden="true" className="pk-lock" /><Plus size={12} aria-hidden="true" className="pk-plus" />Pakete ekle</span>
        </button></li>)}
        {soon.map(id => <li key={id}><button type="button" className="pk-service soon" data-feature={id} aria-label={`${featureById.get(id)?.name}: yakında`} onClick={() => openFeatureLock(id)}>
          <ServiceTile id={id} /><span className="pk-soon">Yakında</span>
        </button></li>)}
      </ul>
    </section>}

    {owner ? <section className="pk-contact" aria-label="Mola ekibine ulaşın">
      <span className="pk-contact-icon" aria-hidden="true"><MessageCircle size={20} /></span>
      <div className="pk-contact-body">
        <h4>Mola ekibine ulaşın</h4>
        <p>Hizmet eklemek ya da paketinizi değiştirmek için bize yazın; değişiklik birkaç dakikada açılır, verileriniz silinmez.</p>
        <div className="pk-contact-actions">
          <button type="button" className="btn primary" onClick={() => writeToMola('core')}><MessageCircle size={16} aria-hidden="true" />Mola ekibine yaz</button>
          <ContactButtons />
        </div>
      </div>
    </section> : <p className="pk-readonly"><Info size={16} aria-hidden="true" />Paket değişikliği için işletme sahibine danışın.</p>}
  </Card>;
}

/** Once, for the owner, when the trial (every service) became the package: which services closed; the data stays. */
export function TrialEndNotice({ pkg, onDone }: { pkg?: PackageView; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [hidden, setHidden] = useState('');
  const notice = pkg?.notice;
  if (!notice || hidden === notice.id) return null;
  async function close(then?: () => void) {
    setBusy(true); setError('');
    try { await api('/api/staff/package/notice-seen', { id: notice!.id }); setHidden(notice!.id); onDone(); then?.(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="Deneme süreniz bitti" onClose={() => void close()}>
    <div className="modal-body trial-end">
      <p className="trial-end-head"><span className="pk-contact-icon" aria-hidden="true"><Sparkles size={18} /></span><strong>Paketiniz başladı: {pkg?.name}</strong></p>
      <p>Deneme süresince bütün hizmetler açıktı. Paketinizde olmayan şu hizmetler artık kapalı:</p>
      <ul className="pk-grid package-closed">{notice.closed.map(id => <li key={id} className="pk-service off static" data-feature={id}><ServiceTile id={id} /></li>)}</ul>
      <p><strong>Verileriniz saklanıyor.</strong> Bir hizmeti paketinize eklerseniz her şey kaldığı yerden geri gelir.</p>
      <ContactButtons />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => void close(() => writeToMola(notice.closed[0]))}><MessageCircle size={16} aria-hidden="true" />Mola ekibine yaz</button><button type="button" className="btn primary" disabled={busy} onClick={() => void close()}>Tamam</button></div>
    </div>
  </Modal>;
}

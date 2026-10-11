import { useCallback, useEffect, useState } from 'react';
import { FileText, ShieldCheck } from 'lucide-react';
import type { License } from '../server/license';
import { api } from './api';
import { Notice } from './components';
import { Card } from './SettingsKit';
import { LicenseFreeze } from './LicenseFreeze';
import { AgreementSheet } from './LicenseAgreement';

type View = License & { daysRemaining: number; active: boolean; frozen: boolean };
/**
 * Ayarlar → İşletme → Paket ve lisans, under the package card: the licence's state (kalan gün, bitiş), "Hizmeti dondur" (a
 * request to the Mola team, as before) and "Sözleşmeyi oku". Once at the bottom of Destek → Talepler (10 Ekim düzeni).
 */
export function LicenseCard() {
  const [license, setLicense] = useState<View | null>(null), [error, setError] = useState(''), [reading, setReading] = useState(false);
  const load = useCallback(() => api<{ license?: View }>('/api/staff/support').then(r => { setLicense(r.license ?? null); setError(''); }).catch(e => setError((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  const l = license;
  return <Card icon={<ShieldCheck size={18} aria-hidden="true" />} title="Lisans" className="license-card" aside={<button type="button" className="btn secondary small-btn" onClick={() => setReading(true)}><FileText size={15} aria-hidden="true" />Sözleşmeyi oku</button>}>
    {error && <Notice tone="error">{error}</Notice>}
    {l && <p className="settings-card-note" data-testid="license-line"><strong>{l.kind === 'trial' ? 'Ücretsiz deneme' : 'Abonelik'}</strong>{l.endsAt ? <> · {l.daysRemaining} gün kaldı · Bitiş: {new Date(l.endsAt).toLocaleDateString('tr-TR')}</> : ' · Henüz başlatılmadı; hazırlık sırasında süre işlemez.'}{l.suspended ? ' · Askıya alındı' : l.frozen ? ' · Donduruldu' : l.endsAt && !l.active ? ' · Süresi doldu' : ''}</p>}
    {!l && !error && <p className="settings-card-note" aria-busy="true">Lisans okunuyor…</p>}
    {l && <LicenseFreeze license={l} onSaved={() => void load()} />}
    {reading && <AgreementSheet onClose={() => setReading(false)} />}
  </Card>;
}

import { AlertTriangle, FileCheck2, Phone } from 'lucide-react';
import { AGREEMENT_VERSION } from '../packages/domain/agreement';
import { showPhone } from '../packages/domain/invoice';
import { dateTime, type Business } from './platformStatus';
import './platform-integrity.css';

/** "06.10.2026 14:32" in Türkiye. */
const stamp = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Lisans → "Lisans sözleşmesi": which version of Mola Lisans Sözleşmesi the business accepted and when (with the activation, or
 * the owner's window after signing in; server/merkez/integrity.ts keepAgreement).
 */
export function AgreementSection({ l }: { l: Business }) {
  const a = l.agreement, old = !!a && a.version < AGREEMENT_VERSION;
  return <section className="detail-section license-agreement-section" aria-label="Lisans sözleşmesi"><h2>Lisans sözleşmesi</h2>
    <p className={`license-agreement-line${a && !old ? '' : ' warn'}`} data-testid="license-agreement">{a ? `Lisans sözleşmesi: Sürüm ${a.version} · kabul ${stamp(a.acceptedAt)}` : 'Lisans sözleşmesi: Henüz kabul edilmedi'}{a?.name && <span className="muted"> · {a.name}</span>}</p>
    <p className="section-note">{!a ? (l.activation === 'active' ? 'İşletme sahibine bir sonraki girişinde sorulur (bu özellikten önce kurulan Mola’larda olur). Kabul edilince en geç 10 dakikada burada görünür.' : 'Etkinleştirme ekranında kabul edilir.')
      : old ? `Güncel sürüm ${AGREEMENT_VERSION}. İşletme sahibine bir sonraki girişinde yeniden sorulur; çalışma durmaz.` : 'Güncel sürüm kabul edildi.'}</p>
  </section>;
}

/**
 * Lisans → "Program dosyaları": the café computer's own check of its program files against the signed list of its version
 * (server/integrity.ts). Changed: what was found and what the vendor can do. Nothing happens by itself.
 */
export function IntegritySection({ l }: { l: Business }) {
  const s = l.integrity;
  if (!s || l.activation !== 'active') return null;
  if (s.state !== 'changed') return <section className="detail-section integrity-section" aria-label="Program dosyaları"><h2><FileCheck2 size={18} aria-hidden="true" /> Program dosyaları</h2>
    <p className="section-note">{s.state === 'ok' ? `Mola ${s.version} program dosyaları imzalı listeyle aynı (son denetim ${dateTime(s.checkedAt)}).` : `Mola ${s.version} program dosyaları henüz denetlenemedi. Bu sürümün güncelleme paketini Ayarlar → Güncellemeler’e yüklerseniz (yayınlamanız gerekmez) işletmenin bilgisayarı kendini onunla karşılaştırır.`}</p></section>;
  const phone = l.invoice?.phone;
  return <section className="detail-section integrity-section changed" aria-label="Dosyalar değiştirilmiş"><h2><AlertTriangle size={18} aria-hidden="true" /> Dosyalar değiştirilmiş</h2>
    <p className="section-lead">İşletmenin bilgisayarındaki Mola {s.version} program dosyaları, bu sürüm için imzalanmış dosya listesiyle uyuşmuyor. İlk görülme: {dateTime(s.firstSeenAt ?? s.receivedAt)} · son denetim: {dateTime(s.checkedAt)}.</p>
    {s.changed.length > 0 && <div className="integrity-files"><h3 className="detail-subhead">Değişen dosyalar</h3><ul>{s.changed.map(f => <li key={f}><code>{f}</code></li>)}</ul></div>}
    {s.missing.length > 0 && <div className="integrity-files"><h3 className="detail-subhead">Eksik dosyalar</h3><ul>{s.missing.map(f => <li key={f}><code>{f}</code></li>)}</ul></div>}
    {s.signatureFailed && <p className="section-note">İmzalı liste doğrulanamadı: işletmenin bilgisayarında saklanan liste de değiştirilmiş olabilir.</p>}
    {s.manifestChanged && <p className="section-note">Dosya listesinin kendisi (app/butunluk.json) pakette gelen liste değil.</p>}
    <h3 className="detail-subhead">Ne anlama gelebilir?</h3>
    <p className="section-note">Biri programı elle değiştirmiş olabilir (ör. lisans denetimini kaldırmaya çalışmak). Daha masum nedenler de olabilir: virüs programı bir dosyayı karantinaya almış ya da kopyalama yarım kalmış olabilir. İşletmenin çalışması durdurulmadı; Mola kendiliğinden hiçbir şey yapmaz, karar sizindir.</p>
    <h3 className="detail-subhead">Ne yapabilirsiniz?</h3>
    <ul className="integrity-steps">
      <li>İşletmeyi arayıp sorun{phone && <> (<a className="text-btn" href={`tel:${phone}`}><Phone size={13} aria-hidden="true" />{showPhone(phone)}</a>)</>}.</li>
      <li>Programı yeni kurulum paketiyle yeniden kurmalarını isteyin; veriler ve yedekler korunur. Dosyalar düzelince bu uyarı kendiliğinden kalkar.</li>
      <li>Bilerek değiştirildiğine karar verirseniz aşağıdaki Dikkat bölümünden “Askıya al” ile hizmeti durdurabilirsiniz.</li>
    </ul>
  </section>;
}

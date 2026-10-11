import { CakeSlice, Coffee, Store, UtensilsCrossed } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { sectorNames, type Sector } from '../packages/domain/sector';
import type { StaffSnapshot } from '../packages/domain/types';
import { api, ApiError, money, moneyError, parseMoney, requestId } from './api';
import { commissionRateProblem, parseCommissionRate, rateText } from '../packages/domain/commission';
import { CommissionHint } from './CommissionHint';
import { businessTheme } from './BusinessTheme';
import { Brand, Notice } from './components';
import { HelpTip } from './HelpTip';

const sectorCards: { id: Sector; icon: typeof Store; detail: string }[] = [
  { id: 'cafe', icon: Coffee, detail: 'Kahve, çay, soğuk içecek ve tatlı menüsüyle başlar.' },
  { id: 'restaurant', icon: UtensilsCrossed, detail: 'Çorba, ana yemek, burger, salata ve içecek menüsüyle başlar.' },
  { id: 'dessert', icon: CakeSlice, detail: 'Baklava, pasta, kiloyla kurabiye ve lokum menüsüyle başlar.' },
];
const MAX_TABLES = 100;

/** The owner's first screen after the account: the wizard, nothing else (Workspace mounts this while setup is not done). */
export function FirstSetup({ data, onSaved, onLogout, busy = false }: { data: StaffSnapshot; onSaved: () => void; onLogout: () => void; busy?: boolean }) {
  return <main className="first-setup business-themed" style={businessTheme(data.theme)}><Brand /><h1>İşletmenizi hazırlayalım</h1>
    <p className="muted">Birkaç kısa soru. Hepsini sonra Ayarlar’dan değiştirebilirsiniz.</p>
    <SetupWizard data={data} onSaved={onSaved} />
    <button className="text-btn" disabled={busy} onClick={onLogout}>Çıkış yap</button></main>;
}

/**
 * Kind, name and tables, working rules, check and save. Any table count from 1 to 100: a small kiosk with 3 tables
 * no longer starts with 12 (server/management.ts takes the unused ones away).
 */
export function SetupWizard({ data, onSaved }: { data: StaffSnapshot; onSaved: () => void }) {
  const [sector, setSector] = useState<Sector>(data.sector ?? 'cafe');
  const [paymentMode, setPaymentMode] = useState(data.paymentMode ?? 'after_service');
  const [cleaningEnabled, setCleaningEnabled] = useState(data.cleaningEnabled ?? false);
  const [waiterApproval, setWaiterApproval] = useState(data.waiterApproval ?? false);
  const [splitTables, setSplitTables] = useState(false), [insideCount, setInsideCount] = useState(String(data.tables.length));
  const [step, setStep] = useState(0), [name, setName] = useState(data.name), [count, setCount] = useState(String(data.tables.length));
  const [seconds, setSeconds] = useState(String(data.changeSeconds)), [commission, setCommission] = useState(data.commissionBps === null ? '' : rateText(data.commissionBps));
  const [version, setVersion] = useState(data.businessRevision ?? 0), [error, setError] = useState(''), [stale, setStale] = useState(false), [busy, setBusy] = useState(false);
  // Optional: "Kasiyerin nakit gider uyarı sınırı" (Kasa ve giderler → Kasa ayarları → Kasiyer yetkileri), saved right after the setup.
  const [expenseAlert, setExpenseAlert] = useState(''), alertValue = parseMoney(expenseAlert), alertOk = expenseAlert.trim() === '' || (Number.isFinite(alertValue) && alertValue > 0);
  const tables = Number(count), countOk = /^\d+$/.test(count) && tables >= 1 && tables <= MAX_TABLES;
  const validBasics = name.trim().length >= 2 && name.trim().length <= 80 && countOk && (!splitTables || (/^\d+$/.test(insideCount) && Number(insideCount) <= tables));
  const validRules = /^\d+$/.test(seconds) && Number(seconds) <= 600 && !commissionRateProblem(commission) && alertOk;
  async function finish(e: FormEvent) {
    e.preventDefault(); if (step < 3) { setStep(step + 1); return; } setBusy(true); setError(''); setStale(false);
    try { await api('/api/staff/setup', { requestId: requestId(), version, name, sector, paymentMode, cleaningEnabled, waiterApproval, tableCount: tables, insideCount: splitTables ? Number(insideCount) : undefined, changeSeconds: Number(seconds), commissionBps: parseCommissionRate(commission) });
      if (expenseAlert.trim() !== '') await api('/api/staff/cash/settings', { expenseAlert: alertValue }).catch(() => {});
      onSaved(); }
    catch (e) { setError((e as Error).message); setStale(e instanceof ApiError && e.code === 'VERSION_CONFLICT'); } finally { setBusy(false); }
  }
  // The chosen sector's starter menu replaces only the untouched starter menu (server/sector-templates.ts).
  const menuLoads = !!data.starterMenu && sector !== 'cafe';
  return <form className="panel setup-panel" onSubmit={e => void finish(e)}><div className="setup-steps">{['İşletme türü', 'İşletme ve masalar', 'Çalışma kuralları', 'Kontrol ve kaydet'].map((s, i) => <span className={i === step ? 'current' : ''} key={s}>{i + 1}. {s}</span>)}</div>
    {step === 0 && <><h2>İşletme türü</h2><p className="muted">Seçiminize göre başlangıç menüsü hazırlanır. Ürünleri sonra değiştirebilirsiniz.</p><div className="sector-choices" role="radiogroup" aria-label="İşletme türü">{sectorCards.map(c => <label key={c.id} className={`sector-card ${sector === c.id ? 'selected' : ''}`}><input type="radio" name="sector" value={c.id} checked={sector === c.id} onChange={() => setSector(c.id)} /><c.icon size={30} strokeWidth={1.4} aria-hidden="true" /><strong>{sectorNames[c.id]}</strong><small>{c.detail}</small></label>)}</div><p className="muted small">{data.starterMenu ? (sector === 'cafe' ? 'Kafe başlangıç menüsü hazır; ürünleri Menü ekranından değiştirebilirsiniz.' : `${sectorNames[sector]} başlangıç menüsü yüklenecek; ürünleri sonra Menü ekranından değiştirebilirsiniz.`) : 'Menünüzü daha önce düzenlediğiniz için menü değişmez.'}</p></>}
    {step === 1 && <><h2>İşletmenizi tanıyalım</h2>
      <label>İşletme adı *<HelpTip title="İşletme adı">Müşteri menüsünde görünecek ad. Adı ve logoyu sonra Ayarlar → İşletme → Görünüm’den değiştirebilirsiniz.</HelpTip><input aria-label="İşletme adı" value={name} maxLength={80} onChange={e => setName(e.target.value)} required /></label>{name.trim().length < 2 && <p className="muted small field-hint" role="alert">İşletme adı en az 2 harf olmalı.</p>}
      <label>Kaç masanız var? *<HelpTip title="Masa sayısı">Her masaya sabit bir QR kodu hazırlanır. Masaları sonra Masalar ekranından ekleyip çıkarabilirsiniz.</HelpTip><input aria-label="Toplam masa sayısı" type="number" inputMode="numeric" min={1} max={MAX_TABLES} value={count} onChange={e => setCount(e.target.value)} required /></label>
      {!countOk && count !== '' && <p className="muted small field-hint" role="alert">1 ile {MAX_TABLES} arasında bir sayı yazın.</p>}
      <label className="checkbox-label"><input type="checkbox" checked={splitTables} onChange={e => setSplitTables(e.target.checked)} />İç ve dış masaları ayır</label>
      {splitTables && <div className="form-columns"><label>İç masa sayısı<input type="number" min="0" max={tables} value={insideCount} onChange={e => setInsideCount(e.target.value)} /></label><label>Dış masa sayısı<input type="number" min="0" max={MAX_TABLES} value={Math.max(0, tables - Number(insideCount))} onChange={e => setCount(String(Number(insideCount) + Number(e.target.value)))} /></label></div>}
      {splitTables && countOk && !(/^\d+$/.test(insideCount) && Number(insideCount) <= tables) && <p className="muted small field-hint" role="alert">İç masa sayısı toplam masa sayısından ({tables}) büyük olamaz.</p>}
      <p className="muted small">Masalar “Masa 01”den başlayarak numaralanır.</p></>}
    {step === 2 && <><h2>Sipariş ve ödeme tercihleri</h2><label>Ödeme sırası<HelpTip title="Ödeme sırası">Önce ödeme seçilirse sipariş ödenmeden hazırlanmaz. Sonra ödemede müşteri yer, kalkarken öder. Tercih yalnız yeni siparişlerde geçerlidir.</HelpTip><select aria-label="Ödeme sırası" value={paymentMode} onChange={e => setPaymentMode(e.target.value as 'after_service' | 'before_preparation')}><option value="after_service">Sonra ödeme · Önce servis</option><option value="before_preparation">Önce ödeme · Sonra hazırlık</option></select></label><label className="checkbox-label"><input type="checkbox" checked={cleaningEnabled} onChange={e => setCleaningEnabled(e.target.checked)} />Masa temizliği takibi<HelpTip title="Masa temizliği">Hesap kapanınca masa temizlik bekler. Garson “Temizlendi” diyene kadar o masaya yeni sipariş alınmaz.</HelpTip></label><label className="checkbox-label"><input type="checkbox" checked={waiterApproval} onChange={e => setWaiterApproval(e.target.checked)} />QR siparişleri garson onayına sunulsun<HelpTip title="Garson onayı">Açıkken müşterinin siparişi önce garsona ya da mutfağa düşer; onaylanmadan hazırlanmaz.</HelpTip></label><label>Değişiklik süresi (saniye) *<HelpTip title="Değişiklik süresi">Müşteri bu süre boyunca siparişini değiştirebilir; süre dolmadan mutfak hazırlığa başlamaz. Sıfır yazarsanız bekleme olmaz.</HelpTip><input aria-label="Değişiklik süresi" type="number" min="0" max="600" value={seconds} onChange={e => setSeconds(e.target.value)} />{!(/^\d+$/.test(seconds) && Number(seconds) <= 600) && <small className="field-error" role="alert">0 ile 600 arasında bir sayı yazın (0: bekleme yok).</small>}</label><label>POS komisyonu (%)<HelpTip title="POS komisyonu">Bankanızın kart ödemesinden aldığı yüzde. Yalnız raporlarda kullanılır; müşteriden ek ücret alınmaz.</HelpTip><input aria-label="POS komisyonu" inputMode="decimal" value={commission} placeholder="Bilmiyorsanız boş bırakın" aria-invalid={!!commissionRateProblem(commission)} onChange={e => setCommission(e.target.value)} />{commissionRateProblem(commission) ? <small className="field-error" role="alert">{commissionRateProblem(commission)}</small> : <CommissionHint text={commission} />}</label><label>Kasiyerin nakit gider uyarı sınırı (TL)<HelpTip title="Gider uyarı sınırı">İsteğe bağlı. Kasiyer bu tutarın üstünde nakit gider yazarsa size hemen bildirim gelir (tutar, açıklama, kim, saat). Sonra Kasa ve giderler → Kasa ayarları → Kasiyer yetkileri'nden değiştirebilirsiniz.</HelpTip><input aria-label="Kasiyerin nakit gider uyarı sınırı" inputMode="decimal" value={expenseAlert} placeholder="Boş bırakabilirsiniz" aria-invalid={!alertOk} onChange={e => setExpenseAlert(e.target.value)} />{!alertOk && <small className="field-error" role="alert">{moneyError(expenseAlert)}</small>}</label></>}
    {step === 3 && <><h2>Kurulumu kontrol edin</h2><dl className="setup-summary"><dt>İşletme türü</dt><dd>{sectorNames[sector]}</dd><dt>İşletme</dt><dd>{name}</dd><dt>Masa</dt><dd>{tables}</dd>{splitTables && <><dt>Masa bölümleri</dt><dd>{insideCount} iç · {tables - Number(insideCount)} dış</dd></>}<dt>Ödeme sırası</dt><dd>{paymentMode === 'before_preparation' ? 'Önce ödeme, sonra hazırlık' : 'Önce servis, sonra ödeme'}</dd><dt>Masa temizliği</dt><dd>{cleaningEnabled ? 'Açık' : 'Kapalı'}</dd><dt>Garson onayı</dt><dd>{waiterApproval ? 'Açık' : 'Kapalı'}</dd><dt>Değişiklik süresi</dt><dd>{seconds} saniye</dd><dt>POS komisyonu</dt><dd>{commission === '' ? 'Belirtilmedi' : `%${rateText(parseCommissionRate(commission) ?? 0)}`}</dd><dt>Kasiyer gider uyarısı</dt><dd>{expenseAlert.trim() === '' ? 'Kapalı' : `${money(alertValue)} üstü`}</dd></dl><p className="muted">{menuLoads ? `${sectorNames[sector]} başlangıç menüsü yüklenecek.` : 'Menünüz olduğu gibi kalır.'}</p></>}
    {error && <Notice tone="error">{error}{stale && <button type="button" className="text-btn" onClick={() => { setVersion(data.businessRevision ?? 0); setStale(false); setError('Güncel ayarlar alındı. Kontrol edip yeniden kaydedin.'); }}>Güncel ayarları al</button>}</Notice>}
    <div className="modal-actions">{step > 0 && <button type="button" className="btn secondary" disabled={busy} onClick={() => setStep(step - 1)}>Geri</button>}<button className="btn primary" disabled={busy || (step === 1 ? !validBasics : step > 1 && (!validBasics || !validRules))}>{busy ? 'Kaydediliyor…' : step === 3 ? 'Kurulumu kaydet' : 'Devam'}</button></div></form>;
}

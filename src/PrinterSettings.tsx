import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, Info, Network, Pencil, Plus, Printer, ReceiptText, RefreshCw, Trash2, Usb } from 'lucide-react';
import type { KitchenNotice, PrinterConfig } from '../packages/domain/printing';
import { api } from './api';
import { Modal, Notice } from './components';
import { HelpTip } from './HelpTip';

/*
 * Tek mutfak (owner's decision 5 Oct): Elazığ cafés have one kitchen and no separate bar. A printer's job is "Mutfak fişleri"
 * (one printer at most: choosing it on another printer moves it there) and/or "Hesap ve kasa fişleri". There is no
 * per-category routing any more; old routing is folded on the server (packages/domain/printing.ts singleKitchen) and
 * the owner sees a one-time notice here.
 */
type Draft = Omit<PrinterConfig, 'id' | 'createdAt'>;
// The first printer is the kitchen's; once one prints kitchen tickets, the next is most likely the counter's.
const blank = (kitchen: boolean): Draft => ({ name: '', enabled: true, connection: { type: 'network', host: '', port: 9100 }, width: 80, charset: 'pc857', orders: !kitchen, categories: [], bill: kitchen });
const summary = (p: PrinterConfig) => [p.orders ? 'Mutfak fişleri' : '', p.bill ? 'Hesap ve kasa fişleri' : ''].filter(Boolean).join(' · ') || 'Görevi yok: “Mutfak fişleri” ya da “Hesap ve kasa fişleri”ni seçin ya da kaldırın.';
const quoted = (names: string[]) => names.map(n => `“${n}”`).join(', ');
const noticeText = (n: KitchenNotice) => `Mola artık tek mutfakla çalışıyor: bütün siparişler “${n.kitchen}” yazıcısından mutfağa çıkar.${n.others.length ? ` ${quoted(n.others)} artık mutfak fişi basmıyor (hesap fişi görevi varsa sürüyor).` : ''}${n.categories ? ' Bölüm (kategori) seçimi kaldırıldı; her ürün mutfak fişine yazılır.' : ''}`;

/** `page`: Ayarlar → Yazıcılar shows the list straight away as a card (no fold); `onCount` tells the topic list how many there are. `categories` is no longer used (tek mutfak). */
export function PrinterSettings({ page = false, onCount }: { categories?: string[]; page?: boolean; onCount?: (n: number) => void }) {
  const [open, setOpen] = useState(page), [printers, setPrinters] = useState<PrinterConfig[]>([]), [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<PrinterConfig | 'new' | null>(null), [message, setMessage] = useState(''), [error, setError] = useState(''), [testing, setTesting] = useState('');
  const [notice, setNotice] = useState<KitchenNotice | null>(null);
  // A failed test (timeout, wrong IP) is shown on that printer's own card in error colours, where the owner is looking.
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const load = useCallback(() => api<{ printers: PrinterConfig[]; notice?: KitchenNotice }>('/api/staff/printers').then(r => { setPrinters(r.printers); setNotice(r.notice ?? null); setLoaded(true); onCount?.(r.printers.length); }).catch(e => setError(e.message)), []);
  const seen = () => { setNotice(null); void api('/api/staff/printers/notice-seen', {}).catch(() => {}); };
  useEffect(() => { if (open) void load(); }, [open, load]);
  async function test(p: PrinterConfig) {
    setTesting(p.id); setError(''); setMessage(''); setFailed(null);
    try { await api('/api/staff/printers/test', { id: p.id }); setMessage(`${p.name} yazıcısına deneme fişi gönderildi. Fiş çıktıysa yazıcı hazır.`); }
    catch (e) { setFailed({ id: p.id, message: (e as Error).message }); } finally { setTesting(''); }
  }
  const body = <>
    {open && <div className="settings-blocks-content">
      {/* Ayarlar (page): one short line; the rest in the heading's ⓘ. */}
      <p className={page ? 'settings-card-note' : 'muted small'}>{page ? 'Sipariş mutfak yazıcısından, mutfak hazırlamaya başlayabildiği anda çıkar.' : 'Siparişin tamamı tek mutfak yazıcısından çıkar, mutfağın hazırlamaya başlayabileceği anda: değişiklik süresi dolunca, gerekiyorsa garson onayı ve ödemeden sonra. İptal edilen siparişler için “İPTAL” fişi çıkar.'}</p>
      {notice && <div className="notice printer-notice" role="status"><Info size={16} aria-hidden="true" /><span>{noticeText(notice)}</span><button type="button" className="btn secondary small-btn" onClick={seen}>Tamam</button></div>}
      {message && <Notice tone="success">{message}</Notice>}{error && <Notice tone="error">{error}</Notice>}
      {loaded && !printers.length && <p className="printer-empty"><Info size={16} aria-hidden="true" />Henüz yazıcı eklenmedi. Siparişler mutfak ekranından takip edilir, fiş çıkmaz. Ağ ya da USB fiş yazıcınızı aşağıdan ekleyin.</p>}
      <div className="printer-list">
        {printers.map(p => <article className={`printer-card ${p.enabled ? '' : 'off'}`} key={p.id}>
          <div className="printer-card-head"><span className="printer-icon"><Printer size={18} aria-hidden="true" /></span><strong>{p.name}</strong><span className={`printer-state ${p.enabled ? 'on' : 'off'}`}>{p.enabled ? 'Açık' : 'Kapalı'}</span></div>
          <p className="printer-connection">{p.connection.type === 'network' ? <><Network size={14} aria-hidden="true" />Ağ · {p.connection.host} · {p.width} mm</> : <><Usb size={14} aria-hidden="true" />{p.connection.document ? `USB · ${p.connection.printerName} · Normal yazıcı (A4)` : `USB · ${p.connection.printerName} · ${p.width} mm`}</>}</p>
          <p className="printer-summary">{summary(p)}</p>
          {failed?.id === p.id && <Notice tone="error">{failed.message}</Notice>}
          <div className="printer-card-actions"><button type="button" className="btn secondary" disabled={!!testing || !p.enabled} onClick={() => void test(p)}><ReceiptText size={15} aria-hidden="true" />{testing === p.id ? 'Gönderiliyor…' : 'Deneme fişi'}</button><button type="button" className="btn secondary printer-edit" aria-label={`${p.name} yazıcısını düzenle`} onClick={() => setEditing(p)}><Pencil size={15} aria-hidden="true" /><span aria-hidden="true">Düzenle</span></button></div>
        </article>)}
        {printers.length < 6 && <button type="button" className="printer-card add" onClick={() => setEditing('new')}><span className="printer-add-icon"><Plus size={20} aria-hidden="true" /></span><strong>Yazıcı ekle</strong><span>Mutfak veya kasa</span></button>}
      </div>
    </div>}
    {editing && <PrinterEditor initial={editing === 'new' ? null : editing} printers={printers} onClose={() => setEditing(null)} onSaved={text => { setEditing(null); setMessage(text); setError(''); void load(); }} />}
  </>;
  if (page) return <section className="settings-card printer-settings" aria-labelledby="settings-printers-title">
    <div className="settings-card-head"><Printer size={18} aria-hidden="true" /><h3 id="settings-printers-title">Fiş yazıcıları<HelpTip title="Fiş yazıcıları">Fiş yazıcılarının çoğu aynı komut dilini (ESC/POS) kullanır: Epson, Xprinter, Rongta, Sewoo… En fazla 6 yazıcı eklenebilir. Bir yazıcı “Mutfak fişleri”ni basar: her siparişin tamamı mutfağa ondan çıkar. Kasadaki yazıcı “Hesap ve kasa fişleri”ni basar. Tek yazıcınız varsa ikisini de seçin. Mutfak fişi, mutfağın hazırlamaya başlayabileceği anda çıkar: değişiklik süresi dolunca, gerekiyorsa garson onayı ve ödemeden sonra. İptal edilen siparişler için “İPTAL” fişi çıkar.</HelpTip></h3>{printers.length > 0 && <span className="settings-block-count">{printers.length}</span>}</div>
    {body}
  </section>;
  return <details className="settings-blocks printer-settings" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary><Printer size={18} /><span>Fiş yazıcıları</span>{printers.length > 0 && <span className="settings-block-count">{printers.length}</span>}<ChevronDown size={17} className="settings-disclosure-icon" /><span className="settings-tool-description">Siparişler mutfak yazıcısından otomatik çıksın.</span></summary>
    {body}
  </details>;
}

/** Same rule as the server (privateIPv4 in server/printing.ts): receipt printers sit on the café's own network. */
const privateIp = (host: string) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}(\.\d{1,3}){0,2}$/.test(host) && host.split('.').length === 4 && host.split('.').every(p => Number(p) <= 255);
// A first guess from the Windows printer name; the owner can always change it.
const receiptName = (name: string) => /pos|receipt|thermal|termal|fi[sş]|xprinter|xp-|tm-|rongta|sewoo|bixolon|star |generic \/ text|58 ?mm|80 ?mm/i.test(name);

function PrinterEditor({ initial, printers, onClose, onSaved }: { initial: PrinterConfig | null; printers: PrinterConfig[]; onClose: () => void; onSaved: (message: string) => void }) {
  // The printer that holds "Mutfak fişleri" now, if it is another one: saving with the box ticked moves the role here.
  const holder = printers.find(p => p.orders && p.id !== initial?.id);
  const [draft, setDraft] = useState<Draft>(() => initial ? { name: initial.name, enabled: initial.enabled, connection: initial.connection, width: initial.width, charset: initial.charset, orders: initial.orders, categories: [], bill: initial.bill } : blank(!!holder));
  const [windows, setWindows] = useState<{ supported: boolean; printers: string[] } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const loadWindows = useCallback(() => { setWindows(null); void api<{ supported: boolean; printers: string[] }>('/api/staff/printers/windows').then(setWindows).catch(() => setWindows({ supported: false, printers: [] })); }, []);
  useEffect(() => { if (draft.connection.type === 'windows' && !windows) loadWindows(); }, [draft.connection.type, windows, loadWindows]);
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const conn = draft.connection;
  // Field problems, shown under each field once the owner tries to save (not while still typing), in the server's words.
  const problems: Partial<Record<'name' | 'host' | 'port' | 'printer' | 'purpose', string>> = {
    ...(!draft.name.trim() ? { name: 'Yazıcıya bir ad verin (ör. Mutfak).' } : {}),
    ...(conn.type === 'network' ? { ...(!conn.host.trim() ? { host: 'IP adresini yazın. Yazıcının ayar fişinde yazar.' } : !privateIp(conn.host) ? { host: 'Yerel ağ IP adresi girin (ör. 192.168.1.50).' } : {}), ...(conn.port < 9100 || conn.port > 9109 ? { port: 'Yazıcı portu 9100–9109 arasında olmalı.' } : {}) }
      : !conn.printerName.trim() ? { printer: 'Windows yazıcısını seçin.' } : {}),
    ...(!draft.orders && !draft.bill ? { purpose: 'En az birini seçin: mutfak fişleri veya hesap ve kasa fişleri.' } : {}),
  };
  const [tried, setTried] = useState(false), show = (key: keyof typeof problems) => tried && problems[key] ? <small className="field-error" role="alert">{problems[key]}</small> : null;
  async function save(e: FormEvent) {
    e.preventDefault(); setTried(true); if (Object.keys(problems).length || busy) return; setBusy(true); setError('');
    // Mutfak fişi modu with no order printer left: the server's warning replaces the usual hint.
    try {
      const r = await api<{ warning?: string; moved?: { name: string; idle: boolean }[] }>('/api/staff/printers', { ...(initial ? { id: initial.id } : {}), printer: { ...draft, categories: [] } });
      const moved = r.moved?.length ? ` Mutfak fişleri artık bu yazıcıdan çıkacak; ${quoted(r.moved.map(m => m.name))} artık mutfak fişi basmıyor${r.moved.some(m => m.idle) ? ' ve başka görevi kalmadı' : ''}.` : '';
      onSaved(`${draft.name} kaydedildi.${moved} ${r.warning ?? 'Doğru çalıştığını görmek için “Deneme fişi” düğmesine basın.'}`);
    }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!initial || busy || !confirm(`${initial.name} yazıcısı kaldırılsın mı? Siparişler bu yazıcıdan artık çıkmaz.`)) return;
    setBusy(true);
    try { const r = await api<{ warning?: string }>('/api/staff/printers/delete', { id: initial.id }); onSaved(`${initial.name} kaldırıldı.${r.warning ? ` ${r.warning}` : ''}`); } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return <Modal title={initial ? 'Yazıcıyı düzenle' : 'Yazıcı ekle'} onClose={onClose} className="modal-steady"><form className="modal-body printer-editor" noValidate onSubmit={e => void save(e)}>
    <label>Yazıcı adı *<input value={draft.name} maxLength={30} placeholder="Mutfak veya Kasa" aria-invalid={tried && !!problems.name} onChange={e => set({ name: e.target.value })} />{show('name')}</label>
    <fieldset className="printer-choice"><legend>Bağlantı <HelpTip title="Bağlantı">Yazıcının arkasında ağ kablosu (Ethernet) varsa veya Wi-Fi’ye bağlıysa “Ağ” seçin; IP adresi yazıcıdan çıkan ayar fişinde yazar. Bilgisayara USB kabloyla bağlıysa ve Windows’ta kuruluysa “USB” seçin.</HelpTip></legend>
      <div className="settings-segmented wide" role="group" aria-label="Bağlantı türü"><button type="button" aria-pressed={conn.type === 'network'} className={conn.type === 'network' ? 'selected' : ''} onClick={() => set({ connection: { type: 'network', host: '', port: 9100 } })}>Ağ (kablo / Wi-Fi)</button><button type="button" aria-pressed={conn.type === 'windows'} className={conn.type === 'windows' ? 'selected' : ''} onClick={() => set({ connection: { type: 'windows', printerName: '' } })}>USB (Windows)</button></div>
      {conn.type === 'network' ? <div className="printer-network"><label>IP adresi *<input inputMode="decimal" value={conn.host} placeholder="192.168.1.50" aria-invalid={tried && !!problems.host} onChange={e => set({ connection: { ...conn, host: e.target.value.trim() } })} />{show('host')}</label><label>Port<input inputMode="numeric" value={conn.port} aria-invalid={tried && !!problems.port} onChange={e => set({ connection: { ...conn, port: Number(e.target.value.replace(/\D/g, '')) || 9100 } })} />{show('port')}</label></div>
        : <div className="printer-windows">{!windows ? <p className="muted small">Bilgisayardaki yazıcılar aranıyor…</p> : windows.printers.length ? <label>Windows yazıcısı *<select value={conn.printerName} onChange={e => { const document = !receiptName(e.target.value); set({ connection: { type: 'windows', printerName: e.target.value, document }, ...(document ? { width: 80 } : {}) }); }}><option value="">Yazıcı seçiniz</option>{windows.printers.map(p => <option key={p} value={p}>{p}</option>)}</select>{show('printer')}</label> : <><label>Windows yazıcı adı *<input value={conn.printerName} onChange={e => set({ connection: { ...conn, printerName: e.target.value } })} />{show('printer')}</label><p className="muted small">{windows.supported ? 'Kurulu yazıcı bulunamadı. Yazıcının sürücüsünü kurup yeniden arayın.' : 'Bu bilgisayar Windows değil; USB yazıcı yalnız Windows’ta kullanılabilir.'}</p></>}<button type="button" className="text-btn" onClick={loadWindows}><RefreshCw size={14} />Yeniden ara</button>
          <div className="printer-kind"><span>Yazıcı türü <HelpTip title="Yazıcı türü">Fiş yazıcısı: 58 veya 80 mm rulo kâğıtlı termal yazıcı (Xprinter, Epson TM, Rongta…). Normal yazıcı: A4 kâğıtlı ofis yazıcısı (HP, Canon, Brother…); fiş sayfanın üstüne düz yazı olarak basılır. Yanlış tür seçilirse yazıcı boş sayfa çıkarabilir veya hiç yazdırmaz.</HelpTip></span><div className="settings-segmented wide" role="group" aria-label="Yazıcı türü"><button type="button" aria-pressed={!conn.document} className={!conn.document ? 'selected' : ''} onClick={() => set({ connection: { ...conn, document: false } })}>Fiş yazıcısı (rulo)</button><button type="button" aria-pressed={!!conn.document} className={conn.document ? 'selected' : ''} onClick={() => set({ connection: { ...conn, document: true }, width: 80 })}>Normal yazıcı (A4)</button></div></div></div>}
    </fieldset>
    {!(conn.type === 'windows' && conn.document) && <fieldset className="printer-choice"><legend>Kâğıt genişliği</legend><div className="settings-segmented" role="group" aria-label="Kâğıt genişliği">{([58, 80] as const).map(w => <button type="button" key={w} aria-pressed={draft.width === w} className={draft.width === w ? 'selected' : ''} onClick={() => set({ width: w })}>{w} mm</button>)}</div></fieldset>}
    <fieldset className="printer-choice"><legend>Ne yazdırsın? *</legend>
      <label className="check-row"><input type="checkbox" checked={draft.orders} onChange={e => set({ orders: e.target.checked })} />Mutfak fişleri <HelpTip title="Mutfak fişleri">Her siparişin tamamı mutfağa bu yazıcıdan çıkar; iptal edilen siparişin “İPTAL” fişi de. Mutfak fişlerini yalnız bir yazıcı basar.</HelpTip></label>
      {draft.orders && holder && <p className="printer-move-note" role="status">Şu an mutfak fişleri “{holder.name}” yazıcısından çıkıyor. Kaydedince bu yazıcıya geçer; “{holder.name}” artık mutfak fişi basmaz{holder.bill ? ' (hesap ve kasa fişlerini basmaya devam eder)' : ' ve başka görevi kalmaz'}.</p>}
      <label className="check-row"><input type="checkbox" checked={draft.bill} onChange={e => set({ bill: e.target.checked })} />Hesap ve kasa fişleri <HelpTip title="Hesap ve kasa fişleri">Kasiyer ödeme ekranındaki “Hesap fişi” düğmesiyle hesabı yazdırır. “Ödemeden sonra fiş yazdır” işaretliyse her ödemeden sonra ödeme fişi kendiliğinden çıkar. Bunlar bilgi fişidir; yasal fiş yerine geçmez. Yasal fişi yazar kasanızdan kesmeye devam edin. Gün sonu kasa kapanış fişi de bu yazıcıdan çıkar.</HelpTip></label>
      {show('purpose')}
    </fieldset>
    {!(conn.type === 'windows' && conn.document) && <label>Türkçe karakter<select value={draft.charset} onChange={e => set({ charset: e.target.value as Draft['charset'] })}><option value="pc857">Türkçe karakterli (çoğu yazıcı)</option><option value="ascii">Türkçe karakter kullanma (ç yerine c)</option></select></label>}
    <label className="check-row"><input type="checkbox" checked={draft.enabled} onChange={e => set({ enabled: e.target.checked })} />Yazıcı açık</label>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="modal-actions printer-editor-actions">{initial && <button type="button" className="btn delete-catalog" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />Kaldır</button>}<span className="grow" /><button type="button" className="btn secondary" onClick={onClose}>Vazgeç</button><button className="btn primary" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
    {tried && Object.keys(problems).length > 0 && <p className="field-error" role="status">Kaydetmek için işaretli alanları düzeltin.</p>}
  </form></Modal>;
}

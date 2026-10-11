import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, ChevronDown, CloudDownload, DatabaseBackup, FileDown, FileSpreadsheet, FileText, LifeBuoy, LogIn, Monitor, Printer, RefreshCw, ScrollText, Search, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Store, Tags, type LucideIcon } from 'lucide-react';
import { DateField } from './DateField';
import { api, ApiError } from './api';
import { Notice } from './components';
import { HelpTip } from './HelpTip';
import { ADMIN, dateTime } from './platformStatus';
import { IconBtn } from './platformSettingsKit';
import { ACTOR_NAMES, RESULT_NAMES, SOURCE_NAMES, type JournalActorKind, type JournalResult, type JournalSource } from '../server/merkez/journal-text';

type Row = { seq: number; sub?: number; at: string; actor: { kind: JournalActorKind; id?: string; name?: string }; action: string; text: string; group: string; target?: { kind: string; id: string; name?: string }; business?: { id: string; name?: string }; detail?: string; changes?: { field: string; from?: string; to?: string }[]; source: JournalSource; result: JournalResult; legacy?: boolean; address?: string };
type Verify = { ok: boolean; text: string; count: number; firstSeq: number | null; lastSeq: number | null; checkedAt: string; lastSeal: { seq: number; at: string; fingerprint: string } | null; unsealed: number };
type Answer = { rows: Row[]; total: number; all: number; page: number; pages: number; verify: Verify; retentionYears: number;
  facets: { businesses: { id: string; name: string }[]; tokens: { id: string; name: string }[]; groups: { id: string; name: string }[] } };
type Filter = { from: string; to: string; business: string; actor: string; group: string; result: string; q: string };
const empty: Filter = { from: '', to: '', business: '', actor: '', group: '', result: '', q: '' };
const queryOf = (f: Filter, page?: number) => new URLSearchParams(Object.entries({ ...f, ...(page ? { page: String(page) } : {}) }).filter(([, v]) => v)).toString();
const istanbul = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const shortTime = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Türkiye's calendar day, `days` back from today (the filters are Türkiye days). */
const dayBack = (days: number) => new Date(Date.now() + 3 * 3600_000 - days * 86400_000).toISOString().slice(0, 10);
const groupIcons: Record<string, LucideIcon> = { giris: LogIn, lisans: BadgeCheck, satis: Tags, isletme: Store, destek: LifeBuoy, guncelleme: CloudDownload, yedek: DatabaseBackup, ayar: Settings, kafe: Monitor, kayit: ScrollText };
const ABOUT = 'Mola Yönetim’de ve Mola Merkez’de yapılan her işlem ve her güvenlik olayı: kim, ne zaman, nereden, hangi işletmede, değişiklikte eski → yeni. Kayıtlar yalnız eklenir; değiştirilemez ve silinemez. Her kayıt bir öncekinin özetini taşır ve zincir saatte bir Mola Merkez anahtarıyla mühürlenir. Saatler Türkiye saatidir.';
const REPORT = 'Rapor ekrandaki süzgeçlerle alınır. Kapak sayfasında dönem, süzgeçler, kayıt sayısı, zincir denetiminin sonucu ve mühürün parmak izi yazar. JSONL yalnız tarih aralığını kullanır: bağımsız denetim için dönemin bütün kayıtları, özetleri ve mühürleriyle gelir.';
const periods: [string, string, number | null][] = [['all', 'Tümü', null], ['today', 'Bugün', 0], ['week', 'Son 7 gün', 6], ['month', 'Son 30 gün', 29]];

/**
 * Ayarlar → "İşlem kayıtları": Mola Merkez's tamper-evident record (server/merkez/journal.ts). A compact chain check
 * ("Kayıtlar bütün" or where it breaks), a search box with quick period chips, the other filters (business, who, kind,
 * result, dates) behind "Süzgeçler", the report buttons (PDF, Excel, JSONL) as icons, and one line per record with its
 * group's icon; the details (what changed, where from, the sequence number) open under the line. Nothing can be edited.
 */
export function PlatformJournal() {
  const [filter, setFilter] = useState<Filter>(empty), [page, setPage] = useState(1), [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [more, setMore] = useState(false);
  const [years, setYears] = useState(''), seq = useRef(0);
  const invalid = !!filter.from && !!filter.to && filter.from > filter.to;
  async function load(f = filter, p = page) {
    if (!!f.from && !!f.to && f.from > f.to) return;
    const mine = ++seq.current;
    try { const a = await api<Answer>(`${ADMIN}/journal?${queryOf(f, p)}`); if (mine === seq.current) { setData(a); setError(''); setYears(y => y || String(a.retentionYears)); } }
    catch (e) { if (mine === seq.current) setError((e as Error).message); }
  }
  useEffect(() => { const t = setTimeout(() => void load(), filter.q ? 250 : 0); return () => clearTimeout(t); }, [filter, page]);
  useEffect(() => { const t = setInterval(() => void load(), 15000); return () => clearInterval(t); });
  const set = (k: keyof Filter, v: string) => { setFilter(f => ({ ...f, [k]: v })); setPage(1); };
  async function verifyNow() {
    setBusy('verify'); setNotice(''); setError('');
    try { const r = await api<{ verify: Verify }>(`${ADMIN}/journal/verify`); setNotice(r.verify.ok ? `Kayıtlar bütün: ${r.verify.count} kayıt baştan sona denetlendi ve mühürlendi.` : ''); if (!r.verify.ok) setError(r.verify.text); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function take(kind: 'report.pdf' | 'report.xlsx' | 'export.jsonl') {
    setBusy(kind); setError(''); setNotice('');
    try {
      const r = await fetch(`${ADMIN}/journal/${kind}?${queryOf(filter)}`, { credentials: 'same-origin' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new ApiError(j.message ?? 'Rapor alınamadı.', r.status, j.code); }
      const blob = await r.blob(), name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `islem-kayitlari.${kind.split('.')[1]}`;
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      setNotice(`${name} indirildi.${kind === 'export.jsonl' ? ' Bu dosya dönemin bütün kayıtlarını özetleri ve mühürleriyle içerir; Mola olmadan denetlenebilir.' : ''}`);
      void load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  /** "Yazdır": the same A4 report through the browser's own print (also "PDF olarak kaydet" where no PDF can be made). */
  async function printReport() {
    setBusy('print'); setError(''); setNotice('');
    try {
      const r = await fetch(`${ADMIN}/journal/report.html?${queryOf(filter)}`, { credentials: 'same-origin' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new ApiError(j.message ?? 'Rapor alınamadı.', r.status, j.code); }
      const html = await r.text(), frame = document.createElement('iframe');
      // No script ever runs in the printed page (it holds what others typed); print() from here still works.
      frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
      frame.setAttribute('aria-hidden', 'true'); frame.dataset.testid = 'journal-print-frame'; frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 60000); };
      frame.srcdoc = html; document.body.append(frame);
      void load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function saveYears() {
    setBusy('years'); setError(''); setNotice('');
    try { const r = await api<{ retentionYears: number }>(`${ADMIN}/journal/settings`, { retentionYears: Number(years) }); setYears(String(r.retentionYears)); setNotice(`Saklama süresi ${r.retentionYears} yıl.`); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const v = data?.verify, filtered = Object.values(filter).some(Boolean);
  const period = periods.find(([, , d]) => d === null ? !filter.from && !filter.to : filter.from === dayBack(d) && filter.to === dayBack(0))?.[0];
  // What only the "Süzgeçler" panel shows (a period chip and "Başarısız olanlar" are counted by their own chips).
  const advanced = (['business', 'actor', 'group'] as const).filter(k => filter[k]).length + (filter.result && filter.result !== 'basarisiz' ? 1 : 0) + ((filter.from || filter.to) && !period ? 1 : 0);
  const setPeriod = (d: number | null) => { setFilter(f => ({ ...f, from: d === null ? '' : dayBack(d), to: d === null ? '' : dayBack(0) })); setPage(1); };
  return <section className="journal-panel ps-journal" aria-label="İşlem kayıtları">
    <div className="ps-journal-top">
      {v ? <div className={`journal-verify ps-verify ${v.ok ? 'ok' : 'bad'}`} role="status" aria-label="Bütünlük denetimi">
        <span className="ps-verify-icon" aria-hidden="true">{v.ok ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}</span>
        <div><strong>{v.ok ? 'Kayıtlar bütün' : 'Kayıtlarda bozulma var'}</strong><span>{v.ok ? `${v.count} kayıt denetlendi${v.lastSeal ? ` · son mühür #${v.lastSeal.seq}, ${dateTime(v.lastSeal.at)}` : ''}` : v.text}</span>
          {v.ok && v.lastSeal && <span className="ps-fingerprint" title="Mühürün parmak izi">Parmak izi {v.lastSeal.fingerprint}</span>}</div>
        <span className="ps-verify-tip"><HelpTip title="İşlem kayıtları">{ABOUT}</HelpTip></span>
        <IconBtn icon={RefreshCw} label={busy === 'verify' ? 'Denetleniyor…' : 'Şimdi denetle'} disabled={!!busy} onClick={() => void verifyNow()} />
      </div> : <div className="journal-verify ps-verify idle"><span className="ps-verify-icon" aria-hidden="true"><ShieldCheck size={22} /></span><div><strong>İşlem kayıtları</strong><span>Yükleniyor…</span></div></div>}
      <div className="ps-report" role="region" aria-label="Rapor al">
        <span className="ps-report-label">Rapor al <HelpTip title="Rapor al">{REPORT}</HelpTip></span>
        <IconBtn icon={FileText} label="PDF indir" text="PDF" disabled={!!busy || invalid} onClick={() => void take('report.pdf')} />
        <IconBtn icon={FileSpreadsheet} label="Excel indir" text="Excel" disabled={!!busy || invalid} onClick={() => void take('report.xlsx')} />
        <IconBtn icon={FileDown} label="Denetlenebilir kopya (JSONL)" text="JSONL" disabled={!!busy || invalid} onClick={() => void take('export.jsonl')} />
        <IconBtn icon={Printer} label="Yazdır" text="Yazdır" disabled={!!busy || invalid} onClick={() => void printReport()} />
      </div>
    </div>

    <div className="ps-toolbar">
      <label className="platform-search ps-search"><Search size={18} aria-hidden="true" /><input aria-label="Ara" type="search" placeholder="Kayıtlarda ara" maxLength={120} value={filter.q} onChange={e => set('q', e.target.value)} /></label>
      <button type="button" className={`ps-filter-btn${more || advanced ? ' active' : ''}`} aria-label="Süzgeçler" aria-expanded={more} onClick={() => setMore(m => !m)}><SlidersHorizontal size={17} aria-hidden="true" /><span aria-hidden="true">Süzgeçler</span>{advanced > 0 && <span className="ps-count" aria-hidden="true">{advanced}</span>}</button>
    </div>
    <div className="platform-pills ps-chips" role="group" aria-label="Dönem">{periods.map(([id, label, d]) => <button type="button" key={id} className={period === id ? 'active' : ''} aria-pressed={period === id} onClick={() => setPeriod(d)}>{label}</button>)}
      <button type="button" className={filter.result === 'basarisiz' ? 'active' : ''} aria-pressed={filter.result === 'basarisiz'} onClick={() => set('result', filter.result === 'basarisiz' ? '' : 'basarisiz')}><ShieldAlert size={15} aria-hidden="true" />Başarısız olanlar</button></div>
    {more && <div className="journal-filters ps-filters" role="group" aria-label="İşlem kayıtları süzgeci">
      <label>Başlangıç tarihi<DateField aria-label="Başlangıç tarihi" value={filter.from} onChange={v => set('from', v)} /></label>
      <label>Bitiş tarihi<DateField aria-label="Bitiş tarihi" value={filter.to} onChange={v => set('to', v)} /></label>
      <label>İşletme<select aria-label="İşletme" value={filter.business} onChange={e => set('business', e.target.value)}><option value="">Bütün işletmeler</option>{data?.facets.businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Kim<select aria-label="Kim" value={filter.actor} onChange={e => set('actor', e.target.value)}><option value="">Herkes</option>{(Object.keys(ACTOR_NAMES) as JournalActorKind[]).map(k => <option key={k} value={k}>{ACTOR_NAMES[k]}</option>)}{data?.facets.tokens.map(t => <option key={t.id} value={`token:${t.id}`}>{t.name}</option>)}</select></label>
      <label>İşlem türü<select aria-label="İşlem türü" value={filter.group} onChange={e => set('group', e.target.value)}><option value="">Bütün işlemler</option>{data?.facets.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>Sonuç<select aria-label="Sonuç" value={filter.result} onChange={e => set('result', e.target.value)}><option value="">Hepsi</option>{(Object.keys(RESULT_NAMES) as JournalResult[]).map(k => <option key={k} value={k}>{RESULT_NAMES[k]}</option>)}</select></label>
    </div>}
    {invalid && <Notice tone="error">Başlangıç tarihi bitiş tarihinden sonra olamaz.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
    <div className="journal-bar">
      <p className="platform-count muted small">{data ? `${data.total} kayıt${filtered ? ` (toplam ${data.all})` : ''}` : 'Yükleniyor…'}{filtered && <button type="button" className="text-btn" onClick={() => { setFilter(empty); setPage(1); }}>Süzgeçleri temizle</button>}</p>
    </div>
    <div className="platform-audit-list journal-list ps-jlist">{data?.rows.map(r => {
      const Icon = groupIcons[r.group] ?? ScrollText, bad = r.result !== 'basarili';
      return <article key={`${r.seq}.${r.sub ?? 0}`} className={bad ? 'journal-bad' : undefined}>
        <details>
          <summary>
            <span className={`ps-tile ${bad ? 'rose' : 'grey'}`} aria-hidden="true"><Icon size={17} /></span>
            <span className="ps-jmain"><strong>{r.text}</strong>
              <span className="ps-jsub">{r.business?.name ?? r.target?.name ?? 'Mola Merkez'}{r.detail && <span className="audit-detail"> · {r.detail}</span>}{bad && <b className="journal-result"> · {RESULT_NAMES[r.result]}</b>}</span></span>
            <time className="ps-jtime" dateTime={r.at}>{shortTime(r.at)}</time>
            <span className="ps-jmore" aria-hidden="true"><ChevronDown size={18} /></span>
          </summary>
          <div className="ps-jdetail">
            {!!r.changes?.length && <ul className="ps-jchanges">{r.changes.map((c, i) => <li key={i} className="audit-detail journal-change"><span>{c.field}</span><span>{c.from ?? '—'} → {c.to ?? '—'}</span></li>)}</ul>}
            <p className="ps-jwho">{r.actor.name ?? ACTOR_NAMES[r.actor.kind]} · {SOURCE_NAMES[r.source]}{r.address ? ` (${r.address})` : ''}</p>
            <small>{istanbul(r.at)} · #{r.seq}{r.sub ? `.${r.sub}` : ''}{r.legacy && ' · aktarılan eski kayıt'}</small>
          </div>
        </details>
      </article>;
    })}</div>
    {data && !data.rows.length && !invalid && <p className="platform-empty">Bu süzgeçlere uygun kayıt bulunamadı.</p>}
    {data && data.pages > 1 && <nav className="platform-pager" aria-label="İşlem kayıtları sayfaları"><button className="btn secondary small-btn" disabled={data.page === 1} onClick={() => setPage(data.page - 1)}>Daha yeni kayıtlar</button><span>Sayfa {data.page} / {data.pages}</span><button className="btn secondary small-btn" disabled={data.page === data.pages} onClick={() => setPage(data.page + 1)}>Daha eski kayıtlar</button></nav>}
    <details className="ps-more ps-journal-more">
      <summary>Saklama süresi</summary>
      <form className="journal-retention" onSubmit={e => { e.preventDefault(); void saveYears(); }}>
        <label>Saklama süresi (yıl)<input type="number" min={2} max={100} inputMode="numeric" value={years} onChange={e => setYears(e.target.value)} /></label>
        <button className="btn secondary small-btn" disabled={!!busy || !years || Number(years) === data?.retentionYears}>Kaydet</button>
        <p className="muted small">Önerilen 10 yıl. Süresi dolan en eski kayıtlar günde bir silinir; 2 yıldan yenisi hiçbir zaman silinmez. Silinen kısmın son özeti zincirin yeni başlangıcı olarak saklanır.</p>
      </form>
    </details>
  </section>;
}

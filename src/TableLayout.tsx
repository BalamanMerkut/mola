import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, LayoutGrid, Pencil, X } from 'lucide-react';
import type { StaffSnapshot } from '../packages/domain/types';
import { cleanArea, orderedAreas, sameArea, sectionHeading, sectionName } from '../packages/domain/table-sections';
import { api, requestId } from './api';
import { Notice } from './components';

/*
 * Ayarlar → Masalar ve QR → Masalar ve QR → "Masalar ve bölümler" (11 Ekim, hafta sonu bulgusu 6). Every section with its
 * tables, in the order Masalar shows them:
 * - a table's section is a choice next to it (İç, Dış, the owner's own sections, Bölümsüz, "Yeni bölüm…");
 * - ↑ ↓ move a table within its section, and a section among the others;
 * - the pencil renames a section (all its tables move with it; a name another section has joins them).
 * Each change saves at once (server/management.ts: /tables/area, /tables/layout, /tables/area-rename), checked against the
 * business revision so two screens never overwrite each other. A table's own window on Masalar still has its section too.
 */
const NEW = '#new';
export function TableLayout({ data, onSaved }: { data: StaffSnapshot; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  const [renaming, setRenaming] = useState<{ area: string; text: string } | null>(null);
  const [adding, setAdding] = useState<{ tableId: string; text: string } | null>(null);
  const tables = data.tables, areas = orderedAreas(tables, data.areaOrder), named = areas.filter(Boolean);
  const choices = [...new Set(['inside', 'outside', ...named])];
  const others = tables.some(t => t.area);
  async function send(path: string, body: object, message: string) {
    setBusy(true); setError(''); setDone('');
    try { await api(path, { requestId: requestId(), version: data.businessRevision ?? 0, ...body }); setDone(message); onSaved(); }
    catch (e) { setError((e as Error).message); onSaved(); } finally { setBusy(false); }
  }
  const layout = (order: string[], sections: string[], message: string) => send('/api/staff/tables/layout', { tables: order, areas: sections }, message);
  function moveTable(id: string, step: -1 | 1) {
    const t = tables.find(x => x.id === id)!, same = tables.filter(x => (x.area ?? '') === (t.area ?? ''));
    const neighbour = same[same.indexOf(t) + step]; if (!neighbour) return;
    const order = tables.map(x => x.id), a = order.indexOf(id), b = order.indexOf(neighbour.id);
    [order[a], order[b]] = [order[b], order[a]];
    void layout(order, areas, `${t.name} ${step < 0 ? 'yukarı' : 'aşağı'} taşındı.`);
  }
  function moveArea(area: string, step: -1 | 1) {
    const list = [...areas], i = list.indexOf(area), j = i + step; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void layout(tables.map(t => t.id), list, `${sectionName(area)} bölümü ${step < 0 ? 'yukarı' : 'aşağı'} taşındı.`);
  }
  function setArea(tableId: string, value: string) {
    if (value === NEW) { setAdding({ tableId, text: '' }); return; }
    const t = tables.find(x => x.id === tableId)!;
    void send('/api/staff/tables/area', { tableId, area: value || null }, `${t.name} → ${sectionName(value)} bölümüne alındı.`);
  }
  function addArea() {
    if (!adding) return;
    const typed = cleanArea(adding.text);
    if (!typed) { setError('1–40 karakter arasında bir bölüm adı yazın.'); return; }
    const value = sameArea(choices, typed) ?? typed, t = tables.find(x => x.id === adding.tableId)!;
    setAdding(null);
    void send('/api/staff/tables/area', { tableId: t.id, area: value }, `${t.name} → ${sectionName(value)} bölümüne alındı.`);
  }
  function rename() {
    if (!renaming) return;
    const typed = cleanArea(renaming.text);
    if (!typed) { setError('1–40 karakter arasında bir bölüm adı yazın.'); return; }
    const from = renaming.area; setRenaming(null);
    void send('/api/staff/tables/area-rename', { from, to: typed }, `${sectionName(from)} bölümünün adı “${sectionName(sameArea(named, typed) ?? typed)}” oldu.`);
  }
  return <div className="table-layout" aria-busy={busy}>
    {areas.map((area, i) => { const list = tables.filter(t => (t.area ?? '') === area), title = sectionHeading(area, others) || 'Bütün masalar'; return <section className="layout-section" key={area || '-'} aria-label={title}>
      <header className="layout-section-head">
        <LayoutGrid size={15} aria-hidden="true" /><strong>{title}</strong><small>{list.length} masa</small>
        <span className="layout-tools">
          {area && <button type="button" className="icon-btn" disabled={busy} aria-label={`${sectionName(area)} bölümünün adını değiştir`} title="Adını değiştir" onClick={() => { setRenaming({ area, text: sectionName(area) }); setAdding(null); }}><Pencil size={15} /></button>}
          {areas.length > 1 && <><button type="button" className="icon-btn" disabled={busy || i === 0} aria-label={`${sectionName(area)} bölümünü yukarı taşı`} title="Yukarı" onClick={() => moveArea(area, -1)}><ArrowUp size={15} /></button>
          <button type="button" className="icon-btn" disabled={busy || i === areas.length - 1} aria-label={`${sectionName(area)} bölümünü aşağı taşı`} title="Aşağı" onClick={() => moveArea(area, 1)}><ArrowDown size={15} /></button></>}
        </span>
      </header>
      {renaming?.area === area && <form className="layout-inline-form" onSubmit={e => { e.preventDefault(); rename(); }}>
        <label>Bölümün yeni adı<input autoFocus maxLength={40} value={renaming.text} onChange={e => setRenaming({ area, text: e.target.value })} /></label>
        <button type="submit" className="btn primary small-btn" disabled={busy || !renaming.text.trim()}><Check size={15} aria-hidden="true" />Kaydet</button>
        <button type="button" className="btn ghost small-btn" onClick={() => setRenaming(null)}><X size={15} aria-hidden="true" />Vazgeç</button>
      </form>}
      <ul className="layout-tables">{list.map((t, j) => <li key={t.id}>
        <span className="layout-table-name">{t.name}</span>
        <select aria-label={`${t.name} bölümü`} value={t.area ?? ''} disabled={busy} onChange={e => setArea(t.id, e.target.value)}>
          {choices.map(a => <option key={a} value={a}>{sectionName(a)}</option>)}<option value="">Bölümsüz</option><option value={NEW}>Yeni bölüm…</option>
        </select>
        <span className="layout-tools">
          <button type="button" className="icon-btn" disabled={busy || j === 0} aria-label={`${t.name} yukarı`} title="Yukarı" onClick={() => moveTable(t.id, -1)}><ArrowUp size={15} /></button>
          <button type="button" className="icon-btn" disabled={busy || j === list.length - 1} aria-label={`${t.name} aşağı`} title="Aşağı" onClick={() => moveTable(t.id, 1)}><ArrowDown size={15} /></button>
        </span>
        {adding?.tableId === t.id && <form className="layout-inline-form" onSubmit={e => { e.preventDefault(); addArea(); }}>
          <label>Yeni bölüm adı<input autoFocus maxLength={40} placeholder="Örn. Üst kat, Bahçe, Teras" value={adding.text} onChange={e => setAdding({ tableId: t.id, text: e.target.value })} /></label>
          <button type="submit" className="btn primary small-btn" disabled={busy || !adding.text.trim()}><Check size={15} aria-hidden="true" />Bölüme al</button>
          <button type="button" className="btn ghost small-btn" onClick={() => setAdding(null)}><X size={15} aria-hidden="true" />Vazgeç</button>
        </form>}
      </li>)}</ul>
    </section>; })}
    {error && <Notice tone="error">{error}</Notice>}
    {done && !error && <p className="layout-saved" role="status"><Check size={14} aria-hidden="true" />{done}</p>}
  </div>;
}

import { useCallback, useEffect, useId, useState } from 'react';
import { MapPinned, Pencil, Users } from 'lucide-react';
import { assignmentText } from '../packages/domain/assignments';
import { api } from './api';
import { Notice } from './components';
import { Card, EmptyState, Row, Toggle } from './SettingsKit';
import './staff-roles.css';

/*
 * Garson masa/bölüm ataması (owner; Personel → Personel ayarları → Garson ataması, once Ayarlar → Sipariş ve kasa). Off by default: nothing changes.
 * On: each waiter gets sections and/or single tables; "Sipariş hazır", waiter calls and bill requests then ring only on
 * that waiter's phone (src/ServiceCallBar.tsx FloorAlerts), others still see them quietly. Rules: packages/domain/assignments.ts,
 * server: server/assignments.ts. Personel → Çalışanlar shows each waiter's part read-only (AssignmentLine).
 */
type Waiter = { id: string; name: string; active: boolean; areas: string[]; tables: string[] };
export type Assignments = { enabled: boolean; waiters: Waiter[]; areas: string[]; tables: { id: string; name: string; area?: string }[] };
const sectionName = (area: string) => area === 'inside' ? 'İç masalar' : area === 'outside' ? 'Dış masalar' : area;

/** The owner's assignment view (null while loading or for anyone else: the route is owner only). */
export function useAssignments() {
  const [data, setData] = useState<Assignments | null>(null);
  const reload = useCallback(() => api<Assignments>('/api/staff/assignments').then(setData).catch(() => setData(null)), []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, setData, reload };
}
const describe = (data: Assignments, w: Waiter | undefined) => assignmentText(w, id => data.tables.find(t => t.id === id)?.name, sectionName);

/** Çalışanlar: one waiter's sections and tables, only while garson ataması is on. */
export function AssignmentLine({ data, userId }: { data: ReturnType<typeof useAssignments>; userId: string }) {
  const a = data.data;
  if (!a?.enabled) return null;
  return <p className="assignment-line"><MapPinned size={14} aria-hidden="true" /><span>Sorumlu: {describe(a, a.waiters.find(w => w.id === userId))}</span><small>Personel ayarları → Garson ataması'ndan değişir.</small></p>;
}

export function AssignmentSettings() {
  const id = useId(), { data, setData, reload } = useAssignments();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [editing, setEditing] = useState<{ id: string; areas: string[]; tables: string[] } | null>(null);
  async function save(body: object) {
    setBusy(true); setError('');
    try { setData(await api<Assignments>('/api/staff/assignments', body)); setEditing(null); }
    catch (e) { setError((e as Error).message); void reload(); } finally { setBusy(false); }
  }
  if (!data) return null;
  const waiters = data.waiters.filter(w => w.active || w.areas.length || w.tables.length);
  const pick = (list: string[], value: string) => list.includes(value) ? list.filter(x => x !== value) : [...list, value];
  return <Card icon={<Users size={18} aria-hidden="true" />} title="Garson masa/bölüm ataması" className="assignment-card"
    lead="Her garson yalnız kendi masalarında ses duysun." tip="Açıkken hazır sipariş, garson çağrısı ve hesap isteme yalnız o masanın garsonunun telefonunda ses verir. Diğer garsonlar listede sessizce görür. Kimseye verilmemiş masalar bütün garsonlarda çalar.">
    <Row id={`${id}-on`} label="Garson ataması" line={data.enabled ? 'Açık. Kasiyer, müdür ve sizin ekranlarınızda değişen bir şey yok.' : 'Kapalı: her garsonun telefonu her masa için çalar.'} help="Masasız siparişler ve etkinlik masaları kimseye verilmez, herkeste çalar. Kapatınca atamalar silinmez; yeniden açınca aynen döner.">
      {/* The switch moves at once; a refused change puts the saved state back (save reloads). */}
      <Toggle id={`${id}-on`} checked={data.enabled} disabled={busy} onChange={on => { setData({ ...data, enabled: on }); void save({ enabled: on }); }} />
    </Row>
    {data.enabled && (!waiters.length
      ? <EmptyState icon={<Users size={22} aria-hidden="true" />} title="Henüz garson hesabı yok" text="Personel → Çalışanlar'dan garson ekleyince burada masa ve bölüm verebilirsiniz." />
      : <ul className="assignment-list" aria-label="Garsonların masaları">{waiters.map(w => {
        const open = editing?.id === w.id;
        return <li key={w.id} className={open ? 'open' : ''}>
          <div className="assignment-head"><div><strong>{w.name}</strong>{!w.active && <span className="muted small"> · hesap kapalı</span>}<span className="assignment-summary">{describe(data, w)}</span></div>
            {!open && <button type="button" className="btn secondary small-btn" disabled={busy} aria-label={`${w.name} · masa ve bölüm seç`} onClick={() => setEditing({ id: w.id, areas: w.areas, tables: w.tables })}><Pencil size={14} aria-hidden="true" />Düzenle</button>}</div>
          {open && editing && <div className="assignment-editor">
            {data.areas.length > 0 && <fieldset><legend>Bölümler</legend><div className="assignment-chips">{data.areas.map(a => <button type="button" key={a} aria-pressed={editing.areas.includes(a)} className={editing.areas.includes(a) ? 'selected' : ''} onClick={() => setEditing({ ...editing, areas: pick(editing.areas, a) })}>{sectionName(a)}</button>)}</div></fieldset>}
            <fieldset><legend>{data.areas.length ? 'Ayrıca tek tek masalar' : 'Masalar'}</legend><div className="assignment-chips tables">{data.tables.map(t => { const viaArea = !!t.area && editing.areas.includes(t.area), on = viaArea || editing.tables.includes(t.id); return <button type="button" key={t.id} aria-pressed={on} disabled={viaArea} title={viaArea ? 'Bölümüyle birlikte verildi' : undefined} className={on ? 'selected' : ''} onClick={() => setEditing({ ...editing, tables: pick(editing.tables, t.id) })}>{t.name}</button>; })}</div></fieldset>
            <div className="assignment-actions"><button type="button" className="btn primary small-btn" disabled={busy} onClick={() => void save({ waiter: { id: w.id, areas: editing.areas, tables: editing.tables.filter(t => !editing.areas.includes(data.tables.find(x => x.id === t)?.area ?? '')) } })}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button><button type="button" className="btn ghost small-btn" disabled={busy} onClick={() => setEditing(null)}>Vazgeç</button></div>
          </div>}
        </li>;
      })}</ul>)}
    {error && <Notice tone="error">{error}</Notice>}
  </Card>;
}

import { useEffect, useId, useState } from 'react';
import { SHIFT_ROLES, shiftRoleNames, type ShiftRole } from '../packages/domain/shifts';
import { api } from './api';
import { Notice } from './components';
import { Row } from './SettingsKit';
import './staff-roles.css';

/*
 * Personel → Personel ayarları → Vardiya → Vardiya takibi: which roles start a shift with the counter's code
 * (Garson · Kasiyer · Mutfak · Müdür; all ticked until the owner unticks one). Unticked roles work without the gate; their
 * hours in Personel ve bahşiş are "tahmini" (first to last action). Owner only (GET/POST /api/staff/shifts/roles).
 */
export function ShiftRoleSettings({ tracking }: { tracking: boolean }) {
  const id = useId();
  const [roles, setRoles] = useState<ShiftRole[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { void api<{ roles: ShiftRole[] }>('/api/staff/shifts/roles').then(r => setRoles(r.roles)).catch(e => setError((e as Error).message)); }, []);
  async function toggle(role: ShiftRole, on: boolean) {
    if (!roles) return;
    const before = roles, next = SHIFT_ROLES.filter(r => r === role ? on : roles.includes(r));
    setRoles(next); setBusy(true); setError('');
    try { setRoles((await api<{ roles: ShiftRole[] }>('/api/staff/shifts/roles', { roles: next })).roles); }
    catch (e) { setRoles(before); setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!tracking) return null;
  const off = roles ? SHIFT_ROLES.filter(r => !roles.includes(r)) : [];
  return <>
    <Row id={`${id}-roles`} label="Vardiya başlatacak görevler" tip="Vardiya başlatacak görevler" stack
      line={!roles ? 'Yükleniyor…' : off.length ? `${off.map(r => shiftRoleNames[r]).join(', ')} vardiya başlatmadan çalışır; raporda saatleri tahmini görünür.` : 'Hepsi işaretli: her çalışan önce vardiyayı başlatır.'}
      help="İşaretli görevdeki çalışan girişten sonra kasadaki kodla vardiyayı başlatmadan işlem yapamaz. İşaretsiz görev kod istemeden çalışır; Personel → Vardiya ve bahşiş'te çalışma süresi günün ilk ve son işleminden tahmin edilir. İşletme sahibi hiç vardiya başlatmaz.">
      <div id={`${id}-roles`} className="shift-roles" role="group" aria-label="Vardiya başlatacak görevler">{SHIFT_ROLES.map(r => <label key={r}><input type="checkbox" checked={!!roles?.includes(r)} disabled={busy || !roles} onChange={e => void toggle(r, e.target.checked)} />{shiftRoleNames[r]}</label>)}</div>
    </Row>
    {error && <Notice tone="error">{error}</Notice>}
  </>;
}

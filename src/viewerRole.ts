import { useEffect, useState } from 'react';
import type { Role } from '../packages/domain/types';
import { api } from './api';

/**
 * The signed-in person's role, for screens shared by the owner and the Müdür (Satış ve Raporlar): owner-only buttons such
 * as "Düzelt" on an expense or "Düzeltme ekle" on a cash closing stay hidden for the Müdür (the server refuses them too).
 * Null while unknown: such buttons wait rather than flash.
 */
export function useViewerRole() {
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => { let live = true; void api<{ role: Role }>('/api/staff/me').then(r => { if (live) setRole(r.role); }).catch(() => {}); return () => { live = false; }; }, []);
  return role;
}

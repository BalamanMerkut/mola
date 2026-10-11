import { useEffect, useState } from 'react';
import { api } from './api';

// Developer wording ("Yerel test sürümü", npm commands, demo hints) shows only when the server says it runs as a development
// server (`npm run dev*` without SERVE_BUILD). Never decided by the address: a café's tablets use 192.168.x.x too.
// Hidden until the answer comes, so an installed café never sees it flash.
let asked: Promise<boolean> | undefined;
export function developmentServer() {
  return asked ??= api<{ mode?: string }>('/api/health').then(r => r.mode === 'development', () => { asked = undefined; return false; });
}
export function useDevelopment() {
  const [development, setDevelopment] = useState(false);
  useEffect(() => { let live = true; void developmentServer().then(v => { if (live) setDevelopment(v); }); return () => { live = false; }; }, []);
  return development;
}

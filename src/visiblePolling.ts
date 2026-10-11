/** Background reads pause while hidden; a slow response never overlaps the next scheduled read. */
export function startVisiblePolling(load: () => Promise<void>, interval: number) {
 let stopped = false, running = false, refreshAfterRun = false;
 let timer: ReturnType<typeof setTimeout> | undefined;
 const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
 async function refresh() {
  clear();
  if (stopped || document.hidden) return;
  if (running) { refreshAfterRun = true; return; }
  running = true;
  try { await load(); } finally {
   running = false;
   if (!stopped && !document.hidden) {
    const delay = refreshAfterRun ? 0 : interval;
    refreshAfterRun = false; timer = setTimeout(() => void refresh(), delay);
   }
  }
 }
 function resume() { clear(); if (!document.hidden) void refresh(); }
 document.addEventListener('visibilitychange', resume);
 window.addEventListener('online', resume);
 void refresh();
 return () => { stopped = true; clear(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
}

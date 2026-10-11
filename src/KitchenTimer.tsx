import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

/** Minutes since `since` ("şimdi", "4 dk", "1 sa 5 dk"); one shared tick a minute is plenty for a waiting time. */
export function waitedMinutes(since: string, now: number) { return Math.max(0, Math.floor((now - Date.parse(since)) / 60000)); }
export function waitedText(minutes: number) { return minutes < 1 ? 'şimdi' : minutes < 60 ? `${minutes} dk` : `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`; }
export function useMinuteClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  return now;
}
/** How long an order has been waiting on the kitchen board; highlighted from `lateAfter` minutes on. */
export function WaitingTime({ since, lateAfter = 10 }: { since: string; lateAfter?: number }) {
  const now = useMinuteClock(), minutes = waitedMinutes(since, now), late = minutes >= lateAfter;
  return <span className={`waiting-time ${late ? 'late' : ''}`} title={`Sipariş ${new Date(since).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} geldi`}><Clock3 size={12} aria-hidden="true" />{waitedText(minutes)}{late && <span className="sr-only"> · uzun süredir bekliyor</span>}</span>;
}

import { useEffect, useId, useRef, useState } from 'react';
import { Bell, BellRing, ChefHat, CheckCheck, Footprints, HandPlatter, Play, Printer, ReceiptText, Store, Volume1, Volume2, XCircle, type LucideIcon } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { deviceVolume, playSound, setDeviceVolume, setSoundChoices, soundEventNames, soundEventWhere, soundEvents, soundIds, soundLength, soundNames, useSoundChoices, type SoundEvent, type SoundId } from './sounds';
import type { SoundChoice } from '../packages/domain/sound-settings';
import { Card } from './SettingsKit';

const icons: Record<SoundEvent, LucideIcon> = { waiterCall: BellRing, billRequest: ReceiptText, approval: CheckCheck, kitchen: ChefHat, ready: HandPlatter, externalOrder: Store, kitchenCancel: XCircle, printError: Printer, notification: Bell, tableReminder: Footprints };
const seconds = (id: SoundId) => `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(soundLength(id))} sn`;

/** One AudioContext for the previews on this page, opened by the first tap (browsers allow sound only after a tap). */
function usePreview() {
  const audio = useRef<AudioContext | null>(null), [failed, setFailed] = useState(false), [playing, setPlaying] = useState<string>('');
  const timer = useRef(0);
  useEffect(() => () => { clearTimeout(timer.current); void audio.current?.close().catch(() => {}); }, []);
  async function listen(id: SoundId, key: string = id, volume?: number) {
    try {
      audio.current ??= new AudioContext(); await audio.current.resume();
      const length = playSound(audio.current, id, 0, volume);
      setFailed(false); setPlaying(key); clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPlaying(''), Math.max(400, length * 1000));
    } catch { setFailed(true); }
  }
  return { listen, failed, playing };
}

/**
 * Ayarlar → Sesler: the sound for each event (business-wide, stored on the café computer so every tablet plays the same),
 * this device's volume, and all twenty sounds to listen to. Owner only, like the rest of Ayarlar.
 */
export function SoundSettings() {
  const id = useId();
  const choices = useSoundChoices();
  const { listen, failed, playing } = usePreview();
  const [busy, setBusy] = useState<SoundEvent | ''>(''), [error, setError] = useState('');
  const [volume, setVolume] = useState(() => Math.round(deviceVolume() * 100));
  async function change(event: SoundEvent, patch: Partial<SoundChoice>) {
    setBusy(event); setError('');
    // Shown at once; the server's answer (or the saved state after an error) settles it.
    const before = choices; setSoundChoices({ ...choices, [event]: { ...choices[event], ...patch } });
    try { setSoundChoices(await api<Record<SoundEvent, SoundChoice>>('/api/staff/sounds', { event, ...patch })); }
    catch (e) { setSoundChoices(before); setError((e as Error).message); }
    finally { setBusy(''); }
  }
  // A wide screen shows the events as a two-column grid of compact tiles (settings-workspace.css), then this device's volume and every sound.
  return <>
    <Card icon={<BellRing size={18} aria-hidden="true" />} title="Hangi bildirimde hangi ses?" className="sound-events-card" lead="Bütün tabletler aynı sesi çalar." tip="Seçim bütün işletmede geçerlidir: garson, mutfak ve kasa tabletleri aynı sesi çalar. Değişiklik kendiliğinden kaydedilir ve tabletlere bir dakika içinde ulaşır.">
      <div className="sound-events">
        {soundEvents.map(event => { const Icon = icons[event], c = choices[event], label = soundEventNames[event], named = label.endsWith(' sesi') ? label : `${label} sesi`; return <div className={`sound-event ${c.on ? '' : 'off'}`} key={event} data-event={event}>
          <Icon size={20} aria-hidden="true" className="sound-event-icon" />
          <div className="sound-event-copy"><strong id={`${id}-${event}`}>{label}</strong><span>{soundEventWhere[event]}</span></div>
          <div className="sound-event-controls">
            <select aria-label={named} value={c.sound} disabled={busy === event || !c.on} onChange={e => { const sound = e.target.value as SoundId; void change(event, { sound }); void listen(sound, event); }}>
              {soundIds.map(s => <option key={s} value={s}>{soundNames[s]}</option>)}
            </select>
            <button type="button" className="btn secondary sound-listen" aria-label={`${named}ni dinle`} onClick={() => void listen(c.sound, event)}><Play size={15} aria-hidden="true" />{playing === event ? 'Çalıyor' : 'Dinle'}</button>
            <label className="settings-toggle sound-switch"><span aria-hidden="true">{c.on ? 'Açık' : 'Kapalı'}</span><input type="checkbox" aria-label={`${named} açık`} checked={c.on} disabled={busy === event} onChange={e => void change(event, { on: e.target.checked })} /></label>
          </div>
        </div>; })}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {failed && <p className="muted small" role="alert">Ses çalınamadı. Cihazın sesini açıp tekrar deneyin.</p>}
    </Card>
    <Card icon={<Volume2 size={18} aria-hidden="true" />} title="Ses düzeyi" lead="Yalnız bu cihazda geçerlidir." tip="Her tableti kendi yerinde ayarlayın. Cihazın kendi sesi de açık olmalı. Mutfak ekranındaki hoparlör simgesi sesi o tablette açıp kapatır.">
      <div className="sound-volume">
        <Volume1 size={18} aria-hidden="true" />
        <input type="range" min="0" max="100" step="5" aria-label="Bu cihazın ses düzeyi" value={volume} onChange={e => { const v = Number(e.target.value); setVolume(v); setDeviceVolume(v / 100); }} />
        <output aria-live="polite">%{volume}</output>
        <button type="button" className="btn secondary sound-listen" onClick={() => void listen(choices.kitchen.sound, 'volume', volume / 100)}><Play size={15} aria-hidden="true" />{playing === 'volume' ? 'Çalıyor' : 'Dene'}</button>
      </div>
    </Card>
    <Card icon={<Play size={18} aria-hidden="true" />} title="Bütün sesler" aside={<span className="settings-block-count">{soundIds.length}</span>} lead="Dokunarak dinleyin." tip="Hepsi kısa ve birbirinden kolay ayırt edilir; sesler cihazda üretilir, dosya indirilmez.">
      <div className="sound-library">{soundIds.map(s => <button type="button" key={s} className={`sound-chip ${playing === `lib-${s}` ? 'playing' : ''}`} aria-label={`${soundNames[s]} sesini dinle`} onClick={() => void listen(s, `lib-${s}`)}><Play size={15} aria-hidden="true" /><strong>{soundNames[s]}</strong><small>{seconds(s)}</small></button>)}</div>
    </Card>
  </>;
}

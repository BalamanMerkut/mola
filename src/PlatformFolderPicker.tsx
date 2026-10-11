import { useEffect, useId, useState } from 'react';
import { Cloud, FolderSearch, HardDrive, Usb } from 'lucide-react';
import { api, ApiError } from './api';
import { ADMIN } from './platformStatus';
import './platform-folder.css';

type Place = { path: string; label: string; kind: 'usb' | 'onedrive' | 'gdrive' | 'folder' };
type Folders = { picker: boolean; places: Place[] };
const PLACE_ICON = { usb: Usb, onedrive: Cloud, gdrive: Cloud, folder: HardDrive } as const;
const PICKER_OPEN = 'Klasör seçme penceresi açıldı (görev çubuğuna bakın).';

/**
 * A folder path field with "Göz at" (server/merkez/folder-picker.ts): Windows' folder window opens on the computer Mola Merkez
 * runs on, and the chosen path fills the field (saving stays the card's own "Kaydet"). Without the window (another computer,
 * not Windows) the button is not there and the path is typed as before. `suggest`: the places that exist now (Google Drive,
 * OneDrive, a flash drive) as quick chips; not for Çalışma klasörü, which must stay outside cloud folders.
 */
export function FolderField({ label, value, onChange, disabled, purpose, placeholder, suggest = false }: {
  label: string; value: string; onChange: (path: string) => void; disabled?: boolean; purpose: 'second' | 'workfolder'; placeholder?: string; suggest?: boolean;
}) {
  const [folders, setFolders] = useState<Folders | null>(null), [picking, setPicking] = useState(false), [problem, setProblem] = useState(''), [picked, setPicked] = useState(false);
  // The window is already open (from an earlier press, another field, or before a page reload): it may sit behind Mola, so
  // the vendor is pointed to it, not shown an error (docs/KULLANICI_TESTI_RAPORU.md K-R).
  const [openElsewhere, setOpenElsewhere] = useState(false);
  const hint = useId();
  useEffect(() => {
    let on = true;
    void api<Folders>(`${ADMIN}/folders`).then(f => { if (on) setFolders(f); }, () => { if (on) setFolders({ picker: false, places: [] }); });
    return () => { on = false; };
  }, []);
  const choose = (path: string) => { onChange(path); setPicked(true); setProblem(''); setOpenElsewhere(false); };
  async function browse() {
    setPicking(true); setProblem(''); setPicked(false); setOpenElsewhere(false);
    // The window waits for the vendor (up to 5 minutes on the server).
    try { const r = await api<{ path: string | null }>(`${ADMIN}/folders/pick`, { purpose, start: value.trim() || null }, undefined, 6 * 60_000); if (r.path) choose(r.path); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'PICKER_BUSY') setOpenElsewhere(true);
      else setProblem((e as Error).message);
      if (e instanceof ApiError && ['PICKER_UNAVAILABLE', 'LOCAL_ONLY'].includes(e.code)) setFolders(f => f && { ...f, picker: false });
    } finally { setPicking(false); }
  }
  const places = suggest ? folders?.places ?? [] : [];
  const note = picking || openElsewhere ? PICKER_OPEN : picked ? 'Seçildi. Kaydetmek için “Kaydet”e basın.' : '';
  return <div className="folder-field">
    <div className={`folder-row${folders?.picker ? ' with-browse' : ''}`}>
      <label>{label}<input maxLength={400} spellCheck={false} disabled={disabled || picking} value={value} placeholder={placeholder} aria-describedby={note || problem ? hint : undefined} onChange={e => { setPicked(false); setOpenElsewhere(false); onChange(e.target.value); }} /></label>
      {folders?.picker && <button type="button" className="btn secondary small-btn folder-browse" disabled={disabled || picking} title="Windows’un klasör seçme penceresini açar" onClick={() => void browse()}><FolderSearch size={16} aria-hidden="true" />{picking ? 'Pencere açık…' : 'Göz at'}</button>}
    </div>
    {(note || problem) && <small id={hint} className={problem ? 'field-problem' : 'muted folder-note'} role={problem ? 'alert' : 'status'}>{problem || note}</small>}
    {places.length > 0 && <div className="folder-places" role="group" aria-label="Önerilen yerler">
      {places.map(p => { const Icon = PLACE_ICON[p.kind] ?? HardDrive; const on = value.trim().toLowerCase() === p.path.toLowerCase(); return <button type="button" key={p.path} className={`folder-place ${p.kind}${on ? ' active' : ''}`} aria-pressed={on} disabled={disabled || picking} title={p.path} onClick={() => choose(p.path)}>
        <Icon size={16} aria-hidden="true" /><span><strong>{p.label}</strong><small>{p.path}</small></span>
      </button>; })}
    </div>}
  </div>;
}

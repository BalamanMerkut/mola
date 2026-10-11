import { useEffect, useRef, useState } from 'react';
import { Crop } from 'lucide-react';
import { CropControl } from './CropControl';
import { Notice } from './components';
import { FilePicker } from './SettingsKit';

/**
 * Ayarlar → İşletme → logo: a Turkish file picker ("Logo seç", the current logo as a preview, "Düzenle", "Kaldır"), then a
 * square crop with zoom and position before "Logoyu kullan". PNG/WebP transparency is kept.
 */
export function LogoEditor({ value, disabled, onChange, onEditing }: { value: string | null; disabled: boolean; onChange: (value: string | null) => void; onEditing: (editing: boolean) => void }) {
 const [source, setSource] = useState<ImageBitmap | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
 const [zoom, setZoom] = useState(1), [x, setX] = useState(0), [y, setY] = useState(0);
 const [editingSaved, setEditingSaved] = useState(false);
 const canvas = useRef<HTMLCanvasElement>(null);
 useEffect(() => { onEditing(busy || !!source); }, [busy, source, onEditing]);
 useEffect(() => () => { source?.close(); }, [source]);
 useEffect(() => () => onEditing(false), [onEditing]);
 useEffect(() => {
   const c = canvas.current; if (!source || !c) return;
   const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, 256, 256);
   const scale = Math.min((editingSaved ? 256 : 224) / source.width, (editingSaved ? 256 : 224) / source.height) * zoom;
   const w = source.width * scale, h = source.height * scale;
   ctx.drawImage(source, (256 - w) / 2 + x * 1.28, (256 - h) / 2 + y * 1.28, w, h);
 }, [source, zoom, x, y, editingSaved]);
 async function open(file?: Blob, saved = false) {
   if (!file || disabled || busy) return;
   setBusy(true); setError('');
   try {
     if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('En fazla 5 MB PNG, JPEG veya WebP seçin.');
     const bitmap = await createImageBitmap(file);
     if (bitmap.width * bitmap.height > 16000000) { bitmap.close(); throw new Error('En fazla 16 megapiksel logo seçin.'); }
     setEditingSaved(saved); setSource(bitmap); setZoom(1); setX(0); setY(0);
   } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 function apply() {
   if (!canvas.current) return;
   const result = canvas.current.toDataURL('image/webp', .85);
   if (result.length > 40000) { setError('Logo çok ayrıntılı. Daha sade bir görsel seçin.'); return; }
   onChange(result); setSource(null); setError('');
 }
 const edit = () => { if (value) void fetch(value).then(r => r.blob()).then(blob => open(blob, true)).catch(() => setError('Logo açılamadı.')); };
 return <div className="logo-editor">
   {source ? <div className="logo-crop">
     <div className="logo-canvas"><canvas ref={canvas} width={256} height={256} aria-label="Logo hizalama önizlemesi" /></div>
     <div className="logo-crop-side">
       <p className="settings-field-hint">Logoyu kare alanın içine yerleştirin. Boş kalan yerler şeffaf kalır.</p>
       <div className="crop-controls"><CropControl label="Logo yakınlaştır" value={zoom} initial={1} min={.5} max={3} step={.05} onChange={setZoom} disabled={disabled} /><CropControl label="Logo yatay konum" value={x} initial={0} min={-100} max={100} onChange={setX} disabled={disabled} /><CropControl label="Logo dikey konum" value={y} initial={0} min={-100} max={100} onChange={setY} disabled={disabled} /></div>
       <div className="settings-actions"><button type="button" className="btn primary" disabled={disabled} onClick={apply}>Logoyu kullan</button><button type="button" className="btn secondary" disabled={disabled} onClick={() => setSource(null)}>Vazgeç</button></div>
     </div>
   </div>
     : <FilePicker label="Logo" accept="image/png,image/jpeg,image/webp" preview={value} previewAlt="Logo önizlemesi" empty="Henüz logo yok" choose="Logo seç" change="Başka logo seç"
       note="PNG, JPEG veya WebP, en fazla 5 MB. Şeffaf arka plan korunur; logo kare alanda, oranı bozulmadan gösterilir."
       disabled={disabled || busy} onFile={file => void open(file)} onRemove={() => onChange(null)}
       extra={value ? <button type="button" className="btn secondary" disabled={disabled || busy} onClick={edit}><Crop size={15} aria-hidden="true" />Logoyu düzenle</button> : undefined} />}
   {busy && <p className="settings-field-hint" role="status">Logo açılıyor…</p>}
   {error && <Notice tone="error">{error}</Notice>}
 </div>;
}

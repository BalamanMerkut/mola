import { useRef, useState } from 'react';
import { ImageIcon, RefreshCw } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
type Summary = { usedBytes: number; limitBytes: number; inUse: { count: number; bytes: number }; recent: { count: number; bytes: number }; unused: { count: number; bytes: number }; otherBytes: number; integrity?: { missingPhotos: number; missingThumbnails: number; incompleteSources: number; incompleteOldUploads: number; invalidReferences: number }; graceDays: number; checkedAt: string };
function size(bytes: number) { const small = bytes > 0 && bytes < 1024 * 1024; return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(bytes / (small ? 1024 : 1024 * 1024)) + (small ? ' KB' : ' MB'); }
export function PhotoStorage() {
  const [data, setData] = useState<Summary | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const loading = useRef(false);
  const [batches, setBatches] = useState<{ id: string; createdAt: string; count: number }[]>([]);
  async function load() {
    if (loading.current) return; loading.current = true; setBusy(true); setError('');
    try { setData(await api<Summary>('/api/staff/photo-storage')); setBatches(await api('/api/staff/photo-trash')); }
    catch (e) { setError((e as Error).message); }
    finally { loading.current = false; setBusy(false); }
  }
  async function change(id?: string) {
    if (loading.current) return; loading.current = true; setBusy(true); setError('');
    try { await api(id ? '/api/staff/photo-trash/restore' : '/api/staff/photo-trash', id ? { id } : {}); loading.current = false; await load(); }
    catch (e) { setError((e as Error).message); }
    finally { loading.current = false; setBusy(false); }
  }
  return <details className="settings-sheet photo-storage" onToggle={e => { if (e.currentTarget.open && !data && !error) void load(); }}>
    <summary><ImageIcon size={18} aria-hidden="true" /><strong>Fotoğraf alanı</strong><span className="settings-tool-description">Ürün fotoğraflarının kapladığı alanı kontrol edin ve kullanılmayanları yönetin.</span></summary>
    <div className="photo-storage-body">
      <p className="muted small">Ürün fotoğrafları, küçük önizlemeler ve yeniden düzenleme kaynakları birlikte sayılır.</p>
      {!data && busy && <p className="settings-field-hint" role="status">Fotoğraf alanı kontrol ediliyor…</p>}
      {data && <><div className="photo-storage-total"><span>Kullanılan alan</span><strong>{size(data.usedBytes)} / {size(data.limitBytes)}</strong></div>
        <progress className="photo-storage-progress" aria-label="Fotoğraf alanı kullanımı" max={data.limitBytes} value={Math.min(data.usedBytes, data.limitBytes)} />
        <div className="photo-storage-counts">{[{ label: 'Ürünlerde kullanılan', value: data.inUse, detail: 'Yayındaki, gizli ve taslak ürünler korunur.' }, { label: 'Yeni yüklenen', value: data.recent, detail: `Henüz kaydedilmemiş olabilecek son ${data.graceDays} günün yüklemeleri.` }, { label: 'Kullanılmayan eski fotoğraflar', value: data.unused, detail: 'Hiçbir ürün veya taslakta kullanılmıyor.' }].map(row => <div key={row.label}><span>{row.label}</span><strong>{row.value.count} fotoğraf · {size(row.value.bytes)}</strong><small className="muted">{row.detail}</small></div>)}</div>
        {data.otherBytes > 0 && <p className="muted small">Sınıflandırılmamış dosyalar: {size(data.otherBytes)}. İnceleme dışında tutulur.</p>}
        {data.integrity && <div><h3>Fotoğraf dosyası kontrolü</h3>{Object.values(data.integrity).some(n => n > 0) ? <><Notice tone="error">Bazı fotoğraf dosyaları için kontrol gerekiyor. Ürünleriniz ve fotoğraflarınız değiştirilmedi.</Notice><ul>
          {data.integrity.missingPhotos > 0 && <li>{data.integrity.missingPhotos} kullanılan fotoğrafın ana dosyası eksik veya boş.</li>}
          {data.integrity.missingThumbnails > 0 && <li>{data.integrity.missingThumbnails} kullanılan fotoğrafın küçük önizlemesi eksik veya boş.</li>}
          {data.integrity.incompleteSources > 0 && <li>{data.integrity.incompleteSources} fotoğrafın yeniden düzenleme dosyaları eksik.</li>}
          {data.integrity.incompleteOldUploads > 0 && <li>{data.integrity.incompleteOldUploads} kullanılmayan eski yüklemenin dosyaları eksik.</li>}
          {data.integrity.invalidReferences > 0 && <li>{data.integrity.invalidReferences} fotoğraf bağlantısı bu işletmenin fotoğraf alanıyla eşleşmiyor.</li>}
        </ul><p className="muted small">Yeni yükleme yaptıysanız kontrolü yenileyin. Uyarı sürerse destek talebi açın. Aynı fotoğrafta birden fazla eksik olabilir.</p></> : <p className="muted small">Eksik dosya bulunmadı.</p>}<p className="muted small">Bu kontrol dosyaların varlığını denetler; görsel içeriğini incelemez.</p></div>}
        <p className="muted small">Alanı kontrol etmek dosya silmez. Temizlik, kullanılmayan eski fotoğrafları geri alınabilir arşive taşır. Arşiv diskte yer tutmaya devam eder; kalıcı silme yapılmaz. Son kontrol: {new Date(data.checkedAt).toLocaleString('tr-TR')}.</p>
        </>}
      {batches.length > 0 && <div className="photo-storage-archive"><strong>Arşive taşınanlar</strong>{batches.map(b => <div className="total-line" key={b.id}><span>{new Date(b.createdAt).toLocaleString('tr-TR')} · {b.count} dosya</span><button type="button" className="btn secondary" disabled={busy} onClick={() => void change(b.id)}>Geri al</button></div>)}</div>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="photo-storage-actions">{data && <button className="btn secondary" type="button" disabled={busy || !data.unused.count} onClick={() => void change()}>Kullanılmayanları arşivle</button>}<button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />{busy ? 'Kontrol ediliyor…' : 'Alanı yeniden kontrol et'}</button></div>
    </div>
  </details>;
}

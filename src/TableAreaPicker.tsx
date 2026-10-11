import { useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
export const areaName = (area: string) => area === 'inside' ? 'İç' : area === 'outside' ? 'Dış' : area || 'Bölümsüz';
export function TableAreaPicker({ value, areas, onChange, disabled = false }: { value: string; areas: string[]; onChange: (value: string) => void; disabled?: boolean }) {
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [error, setError] = useState('');
  const options = [...new Set(['', 'inside', 'outside', ...areas.filter(Boolean), ...(value ? [value] : [])])];
  function add() {
    const cleaned = name.trim().replace(/\s+/g, ' ');
    if (!cleaned || cleaned.length > 40) { setError('1–40 karakter arasında bir bölüm adı yazın.'); return; }
    const existing = options.find(a => areaName(a).toLocaleLowerCase('tr-TR') === cleaned.toLocaleLowerCase('tr-TR') || a.toLocaleLowerCase('tr-TR') === cleaned.toLocaleLowerCase('tr-TR'));
    onChange(existing ?? cleaned); setAdding(false); setName(''); setError('');
  }
  return <section className="area-picker" aria-label="Masa bölümü"><h3>Masa bölümü</h3><div className="area-choice-grid">{options.map(a => <button type="button" className={`area-choice ${value === a ? 'selected' : ''}`} key={a} disabled={disabled} aria-pressed={value === a} onClick={() => onChange(a)}><LayoutGrid size={22} /><strong>{areaName(a)}</strong></button>)}<button type="button" className="area-choice new-area" disabled={disabled} onClick={() => setAdding(true)}><Plus size={22} /><strong>Yeni +</strong></button></div>{adding && <div className="area-new-form"><label>Yeni bölüm adı<input autoFocus maxLength={40} placeholder="Örn. Üst kat, Bahçe, Teras" value={name} disabled={disabled} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></label><div className="table-management-actions"><button type="button" className="btn primary" disabled={disabled || !name.trim()} onClick={add}>Bölümü seç</button><button type="button" className="btn secondary" onClick={() => { setAdding(false); setError(''); }}>Vazgeç</button></div>{error && <p role="alert">{error}</p>}</div>}</section>;
}

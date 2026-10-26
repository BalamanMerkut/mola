import { useEffect, useState } from 'react';
import { CloudOff, Trash2 } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { Card } from './SettingsKit';

/*
 * Ayarlar → Güvenlik ve yedek → Yedek → "Sunucudaki yedekleriniz" (27 Ekim, KVKK: Merkut Studios keeps these copies only for
 * the café). What Mola Merkez keeps for this computer (server/cloud-backup.ts remote): the encrypted copies and year packages,
 * also after the "Bulutta şifreli yedek" service left the package, then with the day they are erased by themselves (30 days
 * later). "Sunucudaki yedekleri sil" asks the owner's password and erases them at once; the backups on this computer and
 * the second place stay. Nothing kept there, or an older Merkez: the card is not shown.
 */
type Remote = { copies: number; bytes: number; years: number; newest: string | null; eraseAt: string | null };
const day = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const size = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB` : `${Math.max(1, Math.round(n / 1024 ** 2)).toLocaleString('tr-TR')} MB`;

export function CloudCopies({ serviceOn }: { serviceOn: boolean }) {
  const [remote, setRemote] = useState<Remote | null>(null), [asking, setAsking] = useState(false), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  useEffect(() => { let live = true; api<{ remote: Remote | null }>('/api/staff/backup/cloud-remote').then(r => { if (live) setRemote(r.remote); }).catch(() => {}); return () => { live = false; }; }, [done]);
  if (!done && (!remote || (!remote.copies && !remote.years))) return null;
  async function erase() {
    setBusy(true); setError('');
    try { await api('/api/staff/backup/cloud-erase', { password }); setPassword(''); setAsking(false); setDone('Sunucudaki yedekleriniz silindi. Bu bilgisayardaki yedekler yerinde duruyor.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const what = remote ? [remote.copies ? `${remote.copies} şifreli yedek kopyası` : '', remote.years ? `${remote.years} yıl paketi` : ''].filter(Boolean).join(' ve ') : '';
  return <Card icon={<CloudOff size={18} aria-hidden="true" />} title="Sunucudaki yedekleriniz" className="cloud-copies-card"
    lead="Mola Merkez yedeklerinizi yalnız sizin için, şifreli olarak saklar; içlerini Mola ekibi açamaz."
    tip="Bulut yedek hizmeti paketinizden çıkarsa sunucudaki yedekleriniz 30 gün sonra kendiliğinden silinir. Daha önce silmek isterseniz buradan silebilirsiniz. Bu bilgisayardaki yedekler ve ikinci yedek yeriniz etkilenmez.">
    <div className="cloud-copies">
      {remote && (remote.copies > 0 || remote.years > 0) && <p className="muted small">Mola Merkez’de {what} var ({size(remote.bytes)}){remote.newest ? `; en yenisi ${day(remote.newest)}` : ''}.</p>}
      {remote?.eraseAt && <Notice>Bulut yedek hizmeti paketinizde olmadığı için bu yedekler <strong>{day(remote.eraseAt)}</strong> tarihinde kendiliğinden silinecek.</Notice>}
      {done && <Notice tone="success">{done}</Notice>}
      {!done && (asking
        ? <form className="cloud-copies-form" onSubmit={e => { e.preventDefault(); if (password) void erase(); }}>
            <p className="muted small">Bu işlem geri alınamaz. Bu bilgisayardaki yedekler etkilenmez.{serviceOn ? ' Bulut yedek hizmetiniz açık kaldıkça bir sonraki yedekte sunucuya yeni bir kopya gönderilir.' : ''}</p>
            <label className="owner-email-field">İşletme sahibi şifresi<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
            <div className="owner-email-actions"><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => { setAsking(false); setPassword(''); setError(''); }}>Vazgeç</button><button className="btn danger small-btn" disabled={busy || !password}><Trash2 size={15} aria-hidden="true" />{busy ? 'Siliniyor…' : 'Sil'}</button></div>
          </form>
        : <div className="settings-actions"><button type="button" className="btn secondary small-btn" onClick={() => { setAsking(true); setDone(''); }}><Trash2 size={15} aria-hidden="true" />Sunucudaki yedekleri sil</button></div>)}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Card>;
}

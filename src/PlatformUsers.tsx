import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';
import { Chip, IconBtn, SCard } from './platformSettingsKit';

type UserView = { id: string; username: string; name: string; createdAt: string; mfa: boolean; mustChange: boolean };
/** Who is signed in (GET /me): the owner ("admin") or a yetkili. */
export type Me = { owner: boolean; username: string; name: string };
const TIP = 'Yetkili, Mola Yönetim’de sizin yapabildiğiniz her şeyi kendi kullanıcı adı ve şifresiyle yapar: işletmeler, başvurular, lisanslar, destek, duyurular, güncellemeler. Yalnız bu sayfa, e-posta ayarları, Merkez kurtarma kodu ve geliştirici erişim anahtarları sizindir. Fiyat, ödeme, güncelleme ve duyuru değişiklikleri için yetkilinin kendi iki adımlı girişini açması gerekir. Her işlemi İşlem kayıtları’nda adıyla görünür.';
/** A first password the owner can read out: 4 groups, no look-alike letters. */
function suggestion() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789', pick = new Uint32Array(16);
  crypto.getRandomValues(pick);
  return [...pick].map(n => letters[n % letters.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}
/**
 * Ayarlar → Kullanıcılar (server/merkez/admin-users.ts): the owner only. Add a yetkili (name, sign-in name, a first password
 * they change at their first sign-in), give a new first password, remove one. Each step asks the owner's own password.
 */
export function PlatformUsers() {
  const [users, setUsers] = useState<UserView[] | null>(null), [max, setMax] = useState(10);
  const [name, setName] = useState(''), [username, setUsername] = useState(''), [first, setFirst] = useState(suggestion), [ownerPassword, setOwnerPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [given, setGiven] = useState<{ name: string; username: string; password: string } | null>(null);
  const [acting, setActing] = useState<{ user: UserView; kind: 'password' | 'delete' } | null>(null), [actPassword, setActPassword] = useState(''), [newFirst, setNewFirst] = useState('');
  const load = () => api<{ users: UserView[]; max: number }>(`${ADMIN}/users`).then(r => { setUsers(r.users); setMax(r.max); }, e => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const add = () => run(async () => {
    await api(`${ADMIN}/users`, { name: name.trim(), username: username.trim().toLowerCase(), password: first, ownerPassword });
    setGiven({ name: name.trim(), username: username.trim().toLowerCase(), password: first });
    setName(''); setUsername(''); setFirst(suggestion()); setOwnerPassword(''); await load();
  });
  const act = () => run(async () => {
    if (!acting) return;
    if (acting.kind === 'delete') { await api(`${ADMIN}/users/delete`, { id: acting.user.id, ownerPassword: actPassword }); setNotice(`${acting.user.name} silindi; açık oturumları kapatıldı.`); }
    else { await api(`${ADMIN}/users/password`, { id: acting.user.id, password: newFirst, ownerPassword: actPassword }); setGiven({ name: acting.user.name, username: acting.user.username, password: newFirst }); }
    setActing(null); setActPassword(''); await load();
  });
  const full = !!users && users.length >= max;
  return <section className="ps-users" aria-label="Kullanıcılar">
    <div className="ps-grid two">
      {given && <SCard icon={KeyRound} title="Giriş bilgilerini iletin" sub="Şifre yalnız şimdi gösteriliyor" tone="amber" wide>
        <div role="status" aria-label="Yeni giriş bilgileri" className="ps-user-given">
          <p className="ps-line"><b>{given.name}</b> için: adres <b>{location.origin}</b> · kullanıcı adı <b>{given.username}</b> · ilk şifre <code>{given.password}</code></p>
          <p className="muted small">İlk girişte kendi şifresini belirler. Şifreyi e-postayla değil, telefonla ya da yüz yüze iletmeniz daha güvenlidir.</p>
          <button type="button" className="btn primary small-btn" onClick={() => setGiven(null)}>İlettim, gizle</button>
        </div>
      </SCard>}
      <SCard icon={UserPlus} title="Yetkili ekle" sub="Sizden sonra gelen yetki" tip={TIP} tipLabel="Kullanıcılar" tone="blue">
        <form className="ps-form" onSubmit={e => { e.preventDefault(); void add(); }}>
          <label>Adı ve soyadı<input value={name} maxLength={60} disabled={busy || full} onChange={e => setName(e.target.value)} placeholder="ör. Prof. Dr. Ayşe Yılmaz" /></label>
          <label>Kullanıcı adı<input value={username} maxLength={32} disabled={busy || full} autoCapitalize="none" spellCheck={false} onChange={e => setUsername(e.target.value.toLowerCase())} placeholder="ör. ayse.yilmaz" /></label>
          <label>İlk şifre<span className="ps-inline"><input value={first} maxLength={128} disabled={busy || full} spellCheck={false} onChange={e => setFirst(e.target.value)} /><IconBtn icon={RefreshCw} label="Yeni şifre öner" onClick={() => setFirst(suggestion())} disabled={busy || full} /></span></label>
          <label>Kendi (admin) şifreniz<input type="password" autoComplete="current-password" value={ownerPassword} disabled={busy || full} onChange={e => setOwnerPassword(e.target.value)} /></label>
          <button className="btn primary small-btn ps-wide-btn" disabled={busy || full || name.trim().length < 2 || username.trim().length < 3 || first.length < 8 || !ownerPassword}><UserPlus size={16} aria-hidden="true" />Yetkiliyi ekle</button>
          {full && <p className="muted small">En çok {max} yetkili eklenebilir.</p>}
        </form>
      </SCard>
      <SCard icon={Users} title="Yetkililer" sub={users ? `${users.length} kişi` : undefined} tone="lilac">
        {!users ? <p className="muted small">Yükleniyor…</p> : !users.length ? <p className="muted small">Henüz yetkili yok. Mola Yönetim’e yalnız siz (admin) giriyorsunuz.</p>
          : <ul className="token-list ps-token-list">{users.map(u => <li key={u.id} aria-label={`Yetkili ${u.name}`}>
            <div className="ps-token-head"><strong>{u.name}</strong>
              <Chip tone={u.mustChange ? 'warn' : 'ok'}>{u.mustChange ? 'İlk girişi bekliyor' : 'Etkin'}</Chip>{u.mfa && <Chip tone="ok">İki adımlı giriş</Chip>}
              <IconBtn icon={KeyRound} label={`${u.name}: yeni ilk şifre`} disabled={busy} onClick={() => { setActing({ user: u, kind: 'password' }); setNewFirst(suggestion()); setActPassword(''); setError(''); }} />
              <IconBtn icon={Trash2} label={`${u.name}: sil`} tone="danger" disabled={busy} onClick={() => { setActing({ user: u, kind: 'delete' }); setActPassword(''); setError(''); }} /></div>
            <p className="muted small">Kullanıcı adı <b>{u.username}</b> · eklendi {dateTime(u.createdAt)}</p>
            {acting?.user.id === u.id && <form className="ps-form ps-user-act" onSubmit={e => { e.preventDefault(); void act(); }}>
              <p className="ps-line">{acting.kind === 'delete' ? `${u.name} silinsin mi? Açık oturumu hemen kapanır, bu kullanıcı adıyla bir daha girilemez.` : `${u.name} için yeni ilk şifre: açık oturumları kapanır, ilk girişte kendi şifresini belirler. İki adımlı girişi açıksa o kalır.`}</p>
              {acting.kind === 'password' && <label>Yeni ilk şifre<input value={newFirst} maxLength={128} spellCheck={false} disabled={busy} onChange={e => setNewFirst(e.target.value)} /></label>}
              <label>Kendi (admin) şifreniz<input type="password" autoComplete="current-password" value={actPassword} disabled={busy} onChange={e => setActPassword(e.target.value)} /></label>
              <div className="ps-actions"><button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => setActing(null)}>Vazgeç</button>
                <button className={`btn small-btn ${acting.kind === 'delete' ? 'danger' : 'primary'}`} disabled={busy || !actPassword || (acting.kind === 'password' && newFirst.length < 8)}>{acting.kind === 'delete' ? 'Sil' : 'Yeni ilk şifreyi ver'}</button></div>
            </form>}
          </li>)}</ul>}
      </SCard>
    </div>
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
  </section>;
}

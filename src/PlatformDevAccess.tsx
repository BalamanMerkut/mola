import { useEffect, useState } from 'react';
import { Ban, Copy, EyeOff, KeyRound, KeySquare, Plus, Terminal } from 'lucide-react';
import { api } from './api';
import { Notice } from './components';
import { ADMIN, dateTime } from './platformStatus';
import { Chip, IconBtn, SCard } from './platformSettingsKit';

type TokenView = { id: string; name: string; scope: 'releases' | 'calisma'; scopeText: string; hint: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
const TIP = 'Proje klasöründeki npm run yayinla komutu güncelleme paketini bu anahtarla yükler ve yayınlar. Anahtar yalnız Güncellemeler’e erişir (işletmeler, lisanslar, destek, ayarlar kapalıdır), yalnız bir kez gösterilir ve istediğiniz an iptal edilir. Gerçek yayın (--evet) ayrıca doğrulayıcı uygulamadaki güncel kodu ister: --kod 123456. Her kullanımı İşlem kayıtları’nda görünür.';
/**
 * Ayarlar → "Geliştirici erişimi" (server/merkez/access-tokens.ts): a key for `npm run yayinla` (only Güncellemeler), made with
 * the admin password, shown once, revocable. Every create, revoke and use is in İşlem kayıtları. Two cards: a new key, and
 * the keys (each its own row with its state and "İptal et").
 */
export function PlatformDevAccess() {
  const [tokens, setTokens] = useState<TokenView[] | null>(null), [name, setName] = useState('Yayınlama komutu'), [password, setPassword] = useState('');
  const [made, setMade] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false);
  useEffect(() => { void api<{ tokens: TokenView[] }>(`${ADMIN}/access-tokens`).then(r => setTokens(r.tokens), e => setError((e as Error).message)); }, []);
  async function create() {
    setBusy(true); setError(''); setNotice(''); setCopied(false);
    try { const r = await api<{ token: string; tokens: TokenView[] }>(`${ADMIN}/access-tokens`, { name: name.trim(), scope: 'releases', password }); setMade(r.token); setTokens(r.tokens); setPassword(''); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function revoke(t: TokenView) {
    if (!confirm(`“${t.name}” anahtarı iptal edilsin mi? Bu anahtarla çalışan komut bir daha yayın yapamaz.`)) return;
    setBusy(true); setError(''); setNotice('');
    try { const r = await api<{ tokens: TokenView[] }>(`${ADMIN}/access-tokens/revoke`, { id: t.id }); setTokens(r.tokens); setNotice(`${t.name} iptal edildi.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const active = tokens?.filter(t => !t.revokedAt).length ?? 0;
  return <section className="ps-devaccess devaccess-panel" aria-label="Geliştirici erişimi">
    <div className="ps-grid two">
      {made && <SCard icon={KeySquare} title="Anahtar yalnız şimdi gösteriliyor" sub="Kopyalayıp komuta yapıştırın" tone="amber" wide className="ps-token-card">
        <div role="status" aria-label="Yeni anahtar" className="ps-token-once">
          <p className="ps-line">Proje klasöründe şunu çalıştırın ve sorulunca yapıştırın:</p>
          <pre className="ps-cmd"><Terminal size={15} aria-hidden="true" />npm run yayinla -- --erisim-kaydet</pre>
          <code className="token-text">{made}</code>
          <div className="ps-actions"><IconBtn icon={Copy} label={copied ? 'Kopyalandı' : 'Anahtarı kopyala'} text={copied ? 'Kopyalandı' : 'Kopyala'} onClick={() => { void navigator.clipboard?.writeText(made).then(() => setCopied(true), () => {}); }} />
            <button type="button" className="btn primary small-btn" onClick={() => setMade('')}><EyeOff size={16} aria-hidden="true" />Kaydettim, gizle</button></div>
        </div>
      </SCard>}
      <SCard icon={Plus} title="Yeni yayınlama anahtarı" sub="Yalnız Güncellemeler’e erişir" tip={TIP} tipLabel="Geliştirici erişimi" tone="blue">
        <form className="devaccess-form ps-form" onSubmit={e => { e.preventDefault(); void create(); }}>
          <label>Anahtarın adı<input value={name} maxLength={60} disabled={busy} onChange={e => setName(e.target.value)} /></label>
          <label>Yönetici şifresi<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
          <button className="btn primary small-btn ps-wide-btn" disabled={busy || name.trim().length < 2 || !password}><KeyRound size={16} aria-hidden="true" />Yayınlama anahtarı oluştur</button>
        </form>
        {error && <Notice tone="error">{error}</Notice>}{notice && <Notice tone="success">{notice}</Notice>}
      </SCard>
      <SCard icon={KeyRound} title="Anahtarlar" sub={tokens ? `${active} etkin${tokens.length - active ? ` · ${tokens.length - active} iptal` : ''}` : undefined} tone="lilac">
        {!tokens ? <p className="muted small">Yükleniyor…</p> : !tokens.length ? <p className="muted small">Henüz anahtar yok.</p> : <ul className="token-list ps-token-list">{tokens.map(t => <li key={t.id} className={t.revokedAt ? 'revoked' : undefined} aria-label={`Anahtar ${t.name}`}>
          <div className="ps-token-head"><strong>{t.name}</strong><span className="muted small">{t.hint}</span><Chip tone={t.revokedAt ? 'idle' : 'ok'}>{t.revokedAt ? 'İptal' : 'Etkin'}</Chip>
            {!t.revokedAt && <IconBtn icon={Ban} label="İptal et" tone="danger" disabled={busy} onClick={() => void revoke(t)} />}</div>
          <p className="muted small">{t.scopeText} · oluşturuldu {dateTime(t.createdAt)} · {t.lastUsedAt ? `son kullanım ${dateTime(t.lastUsedAt)}` : 'hiç kullanılmadı'}{t.revokedAt ? ` · iptal edildi ${dateTime(t.revokedAt)}` : ''}</p>
        </li>)}</ul>}
      </SCard>
    </div>
  </section>;
}

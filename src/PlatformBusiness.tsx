import { useState } from 'react';
import type { License, Ticket } from '../server/license';
import { DateField } from './DateField';
import { Notice } from './components';
import { seenAgo, type Business } from './platformStatus';
import { actionText } from '../server/merkez/journal-text';

const date = (value?: string | null) => value ? new Date(value).toLocaleString('tr-TR') : 'Henüz kaydedilmedi';
/** From "İşletme ekle" to a café that works: code used, owner signed in, setup done, licence running. */
export function BusinessProgress({ license: l }: { license: Business }) {
  return <section className="detail-section business-progress" aria-label="Kurulum ilerlemesi"><h2>Kurulum ilerlemesi</h2><ol aria-label="Kurulum ilerlemesi">
    {[[true, 'Hesap açıldı', l.createdAt], [l.activation === 'active', 'Mola etkinleştirildi', l.activatedAt], [!!l.firstLoginAt, 'İlk giriş', l.firstLoginAt], [l.setupCompleted, 'Kurulum tamamlandı', l.setupCompletedAt], [!!l.endsAt, l.kind === 'trial' ? 'Deneme başladı' : 'Abonelik tanımlandı', l.trialStartedAt ?? l.activatedAt]].map(([done, label, at]) => <li key={String(label)} className={done ? 'done' : ''}><strong>{done ? '✓ ' : '○ '}{label}</strong><small>{at ? date(at as string) : done ? 'Tamamlandı' : 'Bekleniyor'}</small></li>)}
  </ol><p className="muted small">Son bağlantı: {l.activation === 'pending' ? 'henüz yok' : `${seenAgo(l.lastSeenAt)}${l.lastSeenAt ? ` (${date(l.lastSeenAt)})` : ''}`} · Son panel kullanımı: {date(l.lastActivityAt)} · Sunucu sürümü: {l.appVersion || '—'}{l.installId && <> · Kurulum: #{l.installId.slice(0, 8)}</>}</p></section>;
}
/** The words for each action code (the same as İşlem kayıtları: server/merkez/journal-text.ts). */
const actors: Record<string, string> = { admin: 'Yönetici', cafe: 'İşletmenin bilgisayarı', system: 'Mola Merkez' };
export type AuditEntry = { action: string; target: string; at: string; name?: string; by?: string; detail?: string };
/** "İşlem geçmişi" (Ayarlar), or with `tenantId` one business's own history (its Bilgiler tab). */
export function PlatformAudit({ audit, licenses, tickets, tenantId, title = 'İşlem geçmişi' }: { audit: AuditEntry[]; licenses: License[]; tickets: Ticket[]; tenantId?: string; title?: string }) {
  const [query, setQuery] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1);
  const invalid = !!from && !!to && from > to;
  const own = tenantId ? audit.filter(a => a.target === tenantId || tickets.some(t => t.id === a.target && t.tenantId === tenantId)) : audit;
  const rows = own.slice().reverse().map(a => {
    const ticket = tickets.find(t => t.id === a.target);
    const business = licenses.find(l => l.tenantId === (ticket?.tenantId ?? a.target));
    return { ...a, label: actionText(a.action), targetName: ['admin', 'platform-admin'].includes(a.target) ? 'Yönetici hesabı' : [business?.name ?? a.name, ticket?.subject].filter(Boolean).join(' · ') || `Kayıt #${a.target.slice(0, 8)}`, day: new Date(Date.parse(a.at) + 3 * 3600000).toISOString().slice(0, 10) };
  }).filter(a => !invalid && (!from || a.day >= from) && (!to || a.day <= to) && `${a.label} ${a.targetName} ${a.detail ?? ''}`.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR')));
  const pages = Math.max(1, Math.ceil(rows.length / 20)), current = Math.min(page, pages);
  if (tenantId && !own.length) return <section className="detail-section" aria-label={title}><h2>{title}</h2><p className="section-note">Bu işletme için kayıtlı işlem yok.</p></section>;
  return <section className={tenantId ? 'detail-section platform-list-panel' : 'panel platform-list-panel'} aria-label={title}><div className="detail-section-head"><h2>{title}</h2></div>{!tenantId && <p className="muted small">Son 300 yönetim işlemi: kim, ne yaptı, değişiklikte eski → yeni. Tarihler Türkiye saatine göredir.</p>}{!tenantId && <div className="platform-audit-filters"><label className="platform-search"><input type="search" aria-label="İşlem veya işletme ara" placeholder="İşlem veya işletme ara" maxLength={120} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><label>Başlangıç tarihi<DateField value={from} onChange={v => { setFrom(v); setPage(1); }} /></label><label>Bitiş tarihi<DateField value={to} onChange={v => { setTo(v); setPage(1); }} /></label></div>}{invalid && <Notice tone="error">Başlangıç tarihi bitiş tarihinden sonra olamaz.</Notice>}{!tenantId && <p className="platform-count muted small">{rows.length} işlem{(query || from || to) && <button className="text-btn" onClick={() => { setQuery(''); setFrom(''); setTo(''); setPage(1); }}>İşlem filtrelerini temizle</button>}</p>}<div className="platform-audit-list">{rows.slice((current - 1) * 20, current * 20).map((a, i) => <article key={`${a.at}-${a.action}-${i}`}><strong>{a.label}</strong><p>{a.targetName}{a.detail && <span className="audit-detail"> · {a.detail}</span>}</p><small>{new Date(a.at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}{a.by && ` · ${actors[a.by] ?? a.by}`}</small></article>)}</div>{!rows.length && !invalid && <p className="muted">Bu filtrelere uygun işlem bulunamadı.</p>}{pages > 1 && <nav className="platform-pager" aria-label="İşlem geçmişi sayfaları"><button className="btn secondary small-btn" disabled={current === 1} onClick={() => setPage(current - 1)}>Önceki işlemler</button><span>Sayfa {current} / {pages}</span><button className="btn secondary small-btn" disabled={current === pages} onClick={() => setPage(current + 1)}>Sonraki işlemler</button></nav>}</section>;
}

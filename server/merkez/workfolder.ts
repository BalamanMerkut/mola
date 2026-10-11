import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { AttachmentRef } from '../license.js';
import type { FailureReport } from '../sync-protocol.js';
import { platformNames } from '../update-manifest.js';
import type { Attachments } from './attachments.js';
import type { MerkezBackupStatus } from './backup.js';
import { sealFingerprint, type Seal, type StoredEntry, type VerifyReport } from './journal.js';
import { canonicalJson, istanbulDay, istanbulTime } from './journal-text.js';
import type { Release, Releases } from './releases.js';
import type { MerkezData, MerkezStore } from './store.js';

/*
 * "Mola çalışma klasörü" (Mola Yönetim → Ayarlar → Çalışma klasörü): readable copies on the vendor's own computer, kept up to
 * date by Mola Merkez (a few seconds after a change, and every 5 minutes), every file written atomically (temporary file,
 * then rename; unchanged files are not touched). Default: C:\MolaCalisma for the installed Mola Yönetim (outside OneDrive);
 * off in development and tests unless a folder is chosen (MERKEZ_CALISMA_KLASORU sets another default, 0 turns it off).
 *   README.md              what every file is (for the vendor and for Claude)
 *   durum-ozeti.md         businesses, versions, last heartbeat, open tickets, backups, alerts, the chain's state
 *   islem-kayitlari\       the İşlem kayıtları chain: one JSONL file per Türkiye day + a verification note per day, the seals,
 *                          Merkez's public key; `node scripts/islem-dogrula.mjs <klasör>` checks it without Mola
 *   hata-kayitlari\        the cafés' failure records grouped (code locations only) as .md, plus hatalar.json
 *   destek-talepleri\      support tickets as conversations (.md) and their attachments while they exist (14 days). Personal
 *                          data: never written into a cloud-synced folder (OneDrive, Google Drive, Dropbox, iCloud)
 *   surumler\              releases and each café's version history
 *   guncellemeler\         drop a .mola-guncelleme here: Güncellemeler shows it as "Klasörde hazır" (publishing needs a click)
 * Once Merkez runs on a VDS, the same folder is filled on the vendor's PC from GET /api/merkez/admin/workfolder/snapshot
 * (admin session or a "calisma" token); see docs/GELISTIRICI_REHBERI.md "Mola çalışma klasörü".
 */
export const DEFAULT_WORK_FOLDER = 'C:\\MolaCalisma';
export const SNAPSHOT_FORMAT = 'mola-calisma-1';
const SYNC_MS = 5 * 60_000, SOON_MS = 3000;
/** The folder when the vendor has not chosen one: the installed Mola Yönetim on Windows writes C:\MolaCalisma. */
export function defaultWorkFolder(env = process.env, platform = process.platform): string | null {
  const chosen = env.MERKEZ_CALISMA_KLASORU?.trim();
  if (chosen) return chosen === '0' ? null : resolve(chosen);
  return env.MOLA_MODE === 'installed' && platform === 'win32' ? DEFAULT_WORK_FOLDER : null;
}
const CLOUD = /^(onedrive( - .*)?|google ?drive|my drive|drive'?ım|dropbox( \(.*\))?|icloud ?drive|icloud|box|mega|yandex\.?disk)$/i;
/** A folder a cloud client copies away (OneDrive, Google Drive, Dropbox, iCloud…): no personal data goes there. */
export function cloudFolder(path: string, env = process.env) {
  const full = resolve(path).toLowerCase();
  for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) { const v = env[k]?.trim(); if (v && (full === resolve(v).toLowerCase() || full.startsWith(resolve(v).toLowerCase() + sep))) return true; }
  return full.split(/[\\/]+/).some(part => CLOUD.test(part));
}
/** Checks a folder the vendor typed; the plain reason when it cannot be used. */
export function folderProblem(path: string, dataDirectory: string) {
  if (!path.trim()) return 'Klasör yolunu yazın (ör. C:\\MolaCalisma).';
  if (!isAbsolute(path)) return 'Tam yol yazın (ör. C:\\MolaCalisma).';
  const full = resolve(path), root = parse(full).root;
  if (full === root) return 'Diskin kökü seçilemez; bir klasör yazın (ör. C:\\MolaCalisma).';
  const data = resolve(dataDirectory), parent = resolve(data, '..');
  const inside = (a: string, b: string) => a === b || a.startsWith(b + sep);
  if (inside(full, data) || inside(data, full) || inside(full, join(parent, 'merkez-yedek')) || inside(full, join(parent, 'merkez-ekler'))) return 'Mola Merkez’in kendi veri ve yedek klasörleri seçilemez; ayrı bir klasör yazın.';
  return null;
}
const slug = (s: string, max = 40) => (s.toLocaleLowerCase('tr-TR').replace(/[çğıöşüâîû]/g, c => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[c] ?? c).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '')) || 'kayit';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const md = (s: string) => s.replace(/\r\n?/g, '\n');
const quote = (s: string) => md(s).split('\n').map(l => `> ${l}`).join('\n');
const when = (iso?: string | null) => iso ? istanbulTime(iso) : '—';

// ---------- Snapshot: everything the folder shows, also served to the VDS sync ----------
export type FailureGroup = { key: string; file: string; method: string; route: string; code: string; status: number; frames: string[]; count: number; firstAt: string; lastAt: string; roles: string[]; trackingIds: string[]; businesses: { tenantId: string; name: string; count: number }[] };
export type TicketDoc = { id: string; tenantId: string; business: string; subject: string; status: 'open' | 'closed'; createdAt: string; messages: { at: string; from: 'business' | 'support'; text: string; attachments: AttachmentRef[] }[] };
export type BusinessStatus = { tenantId: string; name: string; status: string; plan: string; endsAt: string | null; version: string; lastSeenAt: string | null; openTickets: number; backup: string; update: string };
export type FolderSnapshot = {
  format: typeof SNAPSHOT_FORMAT; at: string; merkezVersion: string;
  journal: { since: number; entries: StoredEntry[]; seals: Seal[]; verify: VerifyReport; publicKey: string; keyId: string };
  failures: FailureGroup[]; tickets: TicketDoc[];
  status: { businesses: BusinessStatus[]; alerts: { at: string; title: string; text: string }[]; backup: MerkezBackupStatus | null };
  releases: { list: Omit<Release, 'signed'>[]; history: { tenantId: string; name: string; version: string; events: { at: string; text: string }[] }[] };
};
export type SnapshotDeps = { store: MerkezStore; releases?: Releases; backups?: () => MerkezBackupStatus | null; now: () => Date; version: string };
function businessStatus(d: MerkezData, deps: SnapshotDeps): BusinessStatus[] {
  const t = deps.now().getTime();
  return d.businesses.map(b => {
    const r = deps.store.report(b.tenantId), install = b.installId ? d.installs.find(i => i.id === b.installId) : undefined;
    const seen = [r?.lastSeenAt, install?.lastSeenAt].filter(Boolean).sort().at(-1) ?? null;
    const status = !b.installId ? (b.application?.status === 'pending' ? 'Başvuru bekliyor' : b.application?.status === 'rejected' ? 'Başvuru reddedildi' : 'Kod bekleniyor') : b.suspended ? 'Askıda' : b.endsAt && Date.parse(b.endsAt) <= t ? 'Süresi doldu' : b.kind === 'trial' ? 'Denemede' : 'Çalışıyor';
    const u = install ? deps.releases?.status(install.id) : undefined;
    const update = !u ? '—' : u.state === 'downloading' ? `${u.version} indiriliyor` : u.state === 'ready' ? `${u.version} indirildi, kurulmayı bekliyor` : u.state === 'installed' ? `${u.version} kuruldu` : u.state === 'failed' ? `Kurulamadı: ${u.error ?? ''}` : u.state === 'rolled_back' ? `Geri alındı: ${u.error ?? ''}` : u.state === 'installing' ? 'kuruluyor' : 'bekleyen yok';
    const backup = !r ? '—' : !r.backup.enabled ? 'Kapalı' : r.backup.failing ? 'BAŞARISIZ' : r.backup.lastSuccessAt ? `Son: ${when(r.backup.lastSuccessAt)}` : 'Henüz yok';
    return { tenantId: b.tenantId, name: b.name, status, plan: b.kind === 'trial' ? 'Deneme' : `${b.planMonths ?? 12} ay`, endsAt: b.endsAt, version: r?.appVersion || install?.appVersion || '—', lastSeenAt: seen, openTickets: d.tickets.filter(x => x.tenantId === b.tenantId && x.status === 'open').length, backup, update };
  });
}
function failureGroups(d: MerkezData, store: MerkezStore): FailureGroup[] {
  const groups = new Map<string, FailureGroup>();
  for (const b of d.businesses) for (const f of store.failures(b.tenantId) as FailureReport[]) {
    const key = f.fingerprint ?? sha(`${f.method} ${f.route} ${f.code} ${(f.frames ?? []).join('|')}`).slice(0, 16);
    let g = groups.get(key);
    if (!g) { g = { key, file: `hata-${slug(f.code.toLowerCase(), 30)}-${key.slice(0, 8)}`, method: f.method, route: f.route, code: f.code, status: f.status, frames: f.frames ?? [], count: 0, firstAt: f.at, lastAt: f.at, roles: [], trackingIds: [], businesses: [] }; groups.set(key, g); }
    g.count++; if (f.at < g.firstAt) g.firstAt = f.at; if (f.at > g.lastAt) { g.lastAt = f.at; }
    if (f.role && !g.roles.includes(f.role)) g.roles.push(f.role);
    if (g.trackingIds.length < 10) g.trackingIds.push(f.requestId);
    const biz = g.businesses.find(x => x.tenantId === b.tenantId); if (biz) biz.count++; else g.businesses.push({ tenantId: b.tenantId, name: b.name, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
export function buildSnapshot(deps: SnapshotDeps, since = 0, verify?: VerifyReport): FolderSnapshot {
  const { store } = deps, d = store.read(), journal = store.journal;
  const entries = journal.entries().filter(s => s.entry.seq > since);
  const names = new Map(d.businesses.map(b => [b.tenantId, b.name]));
  const tickets: TicketDoc[] = d.tickets.map(t => ({ id: t.id, tenantId: t.tenantId, business: names.get(t.tenantId) ?? 'İşletme', subject: t.subject, status: t.status, createdAt: t.createdAt, messages: t.messages.map(m => ({ at: m.at, from: m.source, text: m.text, attachments: m.attachments ?? [] })) }));
  const list = (deps.releases?.list() ?? []).map(({ signed: _s, ...r }) => r);
  const all = journal.entries();
  const history = d.businesses.filter(b => b.installId).map(b => ({ tenantId: b.tenantId, name: b.name, version: store.report(b.tenantId)?.appVersion ?? '',
    events: all.filter(s => (s.entry.action === 'cafe.version_changed' && s.entry.business?.id === b.tenantId) || ['release.pilot', 'release.published', 'release.stopped'].includes(s.entry.action)).map(s => ({ at: s.entry.at, text: `${s.entry.text}${s.entry.detail ? ` · ${s.entry.detail}` : ''}` })) }));
  const alerts = (d.alerts ?? []).filter(a => !a.readAt).slice(-30).reverse().map(a => ({ at: a.at, title: a.title, text: a.text }));
  return { format: SNAPSHOT_FORMAT, at: deps.now().toISOString(), merkezVersion: deps.version,
    journal: { since, entries, seals: journal.seals(), verify: verify ?? journal.verify(), publicKey: journal.publicKey, keyId: journal.keyId },
    failures: failureGroups(d, store), tickets, status: { businesses: businessStatus(d, deps), alerts, backup: deps.backups?.() ?? null }, releases: { list, history } };
}

// ---------- Writing ----------
/** Writes only when the content changed: a temporary file in the same folder, then a rename (never a half-written file). */
export async function writeAtomic(file: string, data: string | Buffer) {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  try { const old = await readFile(file); if (old.equals(bytes)) return false; } catch { /* new file */ }
  await mkdir(resolve(file, '..'), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.yaziliyor`;
  await writeFile(tmp, bytes);
  for (let i = 0; ; i++) {
    try { await rename(tmp, file); return true; }
    catch (e) { if (i >= 5) { await rm(tmp, { force: true }); throw e; } await new Promise(r => setTimeout(r, 100 * (i + 1))); }
  }
}
export const README = (o: { cloud: boolean; at: string }) => `# Mola çalışma klasörü

Bu klasörü **Mola Yönetim** kendisi doldurur ve güncel tutar (bir değişiklikten birkaç saniye sonra ve 5 dakikada bir).
Dosyaları elle değiştirmeyin: bir sonraki güncellemede yeniden yazılır. Her dosya önce geçici bir adla yazılıp sonra yerine
konur; yarım dosya oluşmaz. Son güncelleme: ${istanbulTime(o.at)} (Türkiye saati).

Mola Yönetim → Ayarlar → **Çalışma klasörü** bölümünden yeri değiştirilebilir ya da kapatılabilir.

| Dosya / klasör | İçinde ne var |
|---|---|
| \`durum-ozeti.md\` | Bütün işletmeler: durum, plan ve bitiş, Mola sürümü, son bağlantı, açık destek talebi, yedek durumu; okunmamış bildirimler; Merkez yedeği; işlem kayıtlarının bütünlük durumu |
| \`islem-kayitlari/GGGG-AA-GG.jsonl\` | O günün (Türkiye saati) işlem kayıtları, her satır bir kayıt: \`{"type":"kayit","hash":…,"entry":{…}}\` |
| \`islem-kayitlari/GGGG-AA-GG-dogrulama.md\` | O günün doğrulama notu: kaç kayıt, ilk/son kayıt no, son özet, zincirin o anki denetim sonucu, son mühür |
| \`islem-kayitlari/muhurler.jsonl\` | Mühürler: zincirin başının Mola Merkez anahtarıyla (Ed25519) imzalanmış hâli |
| \`islem-kayitlari/merkez-acik-anahtar.txt\` | Mühürleri denetlemek için Mola Merkez'in açık anahtarı (gizli değildir) |
| \`hata-kayitlari/hata-….md\` | İşletmelerin bilgisayarlarından gelen hata kayıtları, aynı hata bir dosyada (yalnız kodun yeri; satış ya da kişisel veri yok) |
| \`hata-kayitlari/hatalar.json\` | Aynı bilgiler makinenin okuyacağı biçimde |
| \`destek-talepleri/\` | ${o.cloud ? '**Bu klasör bir bulut klasörünün (OneDrive, Google Drive, Dropbox…) içinde olduğu için destek talepleri buraya YAZILMAZ** (kişisel veri içerir).' : 'Destek talepleri okunur konuşmalar olarak (.md) ve ekleri (yalnız Mola Merkez’de durdukları 14 gün boyunca). **Kişisel veri içerir**: bu klasörü OneDrive ya da başka bir bulut klasörüne kopyalamayın, başkasıyla paylaşmayın.'} |
| \`surumler/yayinlar.md\` | Yüklenen güncelleme paketleri ve yayın durumları |
| \`surumler/<işletme>.md\` | Her işletmenin şu anki sürümü, güncelleme durumu ve sürüm geçmişi |
| \`guncellemeler/\` | Buraya bırakılan \`.mola-guncelleme\` dosyası Mola Yönetim → Ayarlar → Güncellemeler’de “Klasörde hazır” olarak görünür. Yüklemek ve yayınlamak her zaman sizin tıklamanızla olur |

## İşlem kayıtları nasıl denetlenir

Her kayıt bir önceki kaydın özetini (\`prev\`) taşır; kaydın özeti \`hash = SHA-256(kanonik JSON(entry))\`.
Bir kayıt değiştirilir, silinir ya da sırası değişirse zincir o noktada kopar. Mühürler zincirin başını Mola Merkez'in
anahtarıyla imzalar; son kayıtların silinmesi de böylece görünür. Mola olmadan denetlemek için (Node.js yeterli):

    node scripts/islem-dogrula.mjs "<bu klasör>\\islem-kayitlari"

Ayrıntı ve yöntem: proje içindeki \`docs/ISLEM_KAYITLARI.md\`. Resmî bir istek için Mola Yönetim → Ayarlar → İşlem kayıtları →
**Rapor al** (PDF, Excel ve denetlenebilir JSONL) kullanın.

## Claude için not

Bir sorunu incelerken önce \`durum-ozeti.md\`, sonra \`hata-kayitlari/\` ve ilgili işletmenin \`surumler/\` dosyasına bakın.
Hata kayıtlarında takip kodu (requestId) ve kodun yeri vardır; satış verisi hiçbir dosyada yoktur. \`destek-talepleri/\`
kişisel veri içerir: yalnız ilgili talep için okuyun, içeriğini başka yere aktarmayın.
`;
function dayNote(day: string, lines: StoredEntry[], v: VerifyReport, seal: Seal | undefined, replaced: boolean) {
  const first = lines[0]?.entry.seq, last = lines.at(-1);
  return `# İşlem kayıtları · ${day} · doğrulama notu

- Bu gün: **${lines.length} kayıt** (#${first} – #${last?.entry.seq}); son kaydın özeti \`${last?.hash}\`
- Zincirin tamamı (${when(v.checkedAt)} denetimi): **${v.ok ? 'Kayıtlar bütün' : v.text}** — ${v.count} kayıt, #${v.firstSeq ?? '—'} – #${v.lastSeq ?? '—'}
- Son mühür: ${seal ? `#${seal.seq}, ${when(seal.at)}, parmak izi \`${sealFingerprint(seal)}\`` : 'henüz yok'}${v.unsealed ? ` (son ${v.unsealed} kayıt henüz mühürlenmedi; saatte bir mühürlenir)` : ''}
${replaced ? '- **DİKKAT:** bu günün dosyası daha önce farklı içerikle yazılmıştı; eski hâli yanında `.onceki-…` adıyla duruyor (ör. Merkez yedekten geri yüklendi).\n' : ''}
Yeniden denetlemek için: \`node scripts/islem-dogrula.mjs "<çalışma klasörü>\\islem-kayitlari"\`
`;
}
function statusMd(s: FolderSnapshot) {
  const v = s.journal.verify, b = s.status.backup;
  const rows = s.status.businesses.map(x => `| ${x.name.replace(/\|/g, '/')} | ${x.status} | ${x.plan}${x.endsAt ? ` · ${istanbulDay(x.endsAt)}` : ''} | ${x.version} | ${when(x.lastSeenAt)} | ${x.openTickets} | ${x.backup} | ${x.update.replace(/\|/g, '/')} |`);
  return `# Mola durum özeti

Oluşturulma: ${when(s.at)} (Türkiye saati) · Mola Merkez ${s.merkezVersion}

## İşlem kayıtları
**${v.ok ? 'Kayıtlar bütün' : v.text}** — ${v.count} kayıt; son mühür ${v.lastSeal ? `#${v.lastSeal.seq} (${when(v.lastSeal.at)}, parmak izi \`${v.lastSeal.fingerprint}\`)` : 'yok'}

## Mola Merkez yedeği
${b ? `Son başarılı: ${when(b.lastSuccessAt)}${b.lastError ? ` · **Son hata:** ${b.lastError}` : ''} · Sonraki: ${when(b.nextRunAt)} · İkinci yer: ${b.second.folder ? `ayarlı${b.second.lastError ? ` (hata: ${b.second.lastError})` : ''}` : 'ayarlı değil'}` : 'Bu çalıştırmada kapalı.'}

## İşletmeler (${rows.length})
| İşletme | Durum | Plan · bitiş | Sürüm | Son bağlantı | Açık talep | Yedek | Güncelleme |
|---|---|---|---|---|---|---|---|
${rows.join('\n') || '| — | | | | | | | |'}

## Okunmamış bildirimler (${s.status.alerts.length})
${s.status.alerts.map(a => `- ${when(a.at)} · **${a.title}** — ${a.text}`).join('\n') || 'Yok.'}
`;
}
function failureMd(g: FailureGroup) {
  return `# ${g.code} · ${g.method} ${g.route}

- Kaç kez: **${g.count}** (ilk ${when(g.firstAt)}, son ${when(g.lastAt)})
- HTTP durumu: ${g.status}${g.roles.length ? ` · rol: ${g.roles.join(', ')}` : ''}
- İşletmeler: ${g.businesses.map(b => `${b.name} (${b.count})`).join(', ')}
- Son takip kodları: ${g.trackingIds.map(t => `\`${t}\``).join(', ')}

## Kodun yeri
${g.frames.length ? g.frames.map(f => `- \`${f}\``).join('\n') : 'Kayıtta kod konumu yok.'}

_Yalnız kodun yeri tutulur: mesaj, değer, satış ya da kişisel veri yoktur. Mola Yönetim → Destek → “Hata takip kodunu sorgula”._
`;
}
function ticketMd(t: TicketDoc, files: Map<string, string>) {
  const lines = t.messages.map(m => `### ${when(m.at)} · ${m.from === 'support' ? 'Mola ekibi' : t.business}\n\n${m.text ? quote(m.text) : '_(yalnız ek)_'}${m.attachments.length ? `\n\nEkler: ${m.attachments.map(a => files.has(a.id) ? `[${a.name}](${files.get(a.id)})` : `${a.name} _(silindi ya da süresi doldu)_`).join(', ')}` : ''}`);
  return `# ${t.subject}

- İşletme: ${t.business}
- Durum: ${t.status === 'open' ? 'Açık' : 'Kapandı'} · açıldı ${when(t.createdAt)} · talep no \`${t.id}\`

> Bu dosya kişisel veri içerebilir. Paylaşmayın; bulut klasörüne kopyalamayın.

${lines.join('\n\n')}
`;
}
function releasesMd(s: FolderSnapshot) {
  const rollout = (r: Omit<Release, 'signed'>) => r.rollout.mode === 'all' ? 'Herkese yayında' : r.rollout.mode === 'pilot' ? `Pilot (${r.rollout.pilot.length} işletme)` : 'Yayında değil';
  return `# Güncelleme paketleri

${s.releases.list.map(r => `## ${r.version} · ${platformNames[r.platform] ?? r.platform}\n- Durum: ${rollout(r)}${r.rollout.changedAt ? ` (son değişiklik ${when(r.rollout.changedAt)})` : ''}\n- Yüklendi: ${when(r.importedAt)} · ${(r.size / 1048576).toFixed(1)} MB · ${r.files} dosya${r.runtime ? ` · Node.js ${r.node} dahil` : ''}\n- Not: ${r.notes || '—'}`).join('\n\n') || 'Henüz paket yüklenmedi.'}
`;
}
function cafeVersionMd(h: FolderSnapshot['releases']['history'][number], b?: BusinessStatus) {
  return `# ${h.name} · sürüm geçmişi

- Şu anki sürüm: **${h.version || '—'}**
- Güncelleme durumu: ${b?.update ?? '—'}
- Son bağlantı: ${when(b?.lastSeenAt)}

## Geçmiş (yeniden eskiye)
${[...h.events].reverse().map(e => `- ${when(e.at)} · ${e.text}`).join('\n') || 'Kayıtlı değişiklik yok.'}
`;
}

export type WorkFolderStatus = { path: string | null; isDefault: boolean; cloud: boolean; lastWriteAt?: string; lastError?: string; written?: number; running: boolean };
/** Keeps the folder up to date while Mola Merkez runs (runtime.ts starts it; tests call run()). */
export class WorkFolder {
  private timer?: NodeJS.Timeout; private soon?: NodeJS.Timeout; private running?: Promise<void>; private again = false;
  private state: { lastWriteAt?: string; lastError?: string; written?: number } = {};
  private verified?: { head: string | null; at: number; report: VerifyReport };
  private known = new Map<string, string>();
  constructor(private deps: SnapshotDeps & { attachments?: Attachments; fallback?: string | null }) {}
  /** The folder in use: the vendor's choice (null = off), else the default of this run. */
  path(): string | null { const w = this.deps.store.read().workFolder; return w ? w.path : (this.deps.fallback === undefined ? defaultWorkFolder() : this.deps.fallback); }
  status(): WorkFolderStatus { const p = this.path(); return { path: p, isDefault: !this.deps.store.read().workFolder, cloud: !!p && cloudFolder(p), running: !!this.running, ...this.state }; }
  /** Every 5 minutes, and a few seconds after each change (runtime.ts; tests call run() themselves). */
  start() {
    this.stop(); this.timer = setInterval(() => void this.run(), SYNC_MS); this.timer.unref(); this.schedule(SOON_MS);
    this.deps.store.onChange = () => this.schedule(); this.deps.store.journal.onAppend = () => this.schedule();
  }
  stop() { clearInterval(this.timer); clearTimeout(this.soon); this.timer = this.soon = undefined; this.deps.store.onChange = undefined; this.deps.store.journal.onAppend = undefined; }
  /** A change: write a few seconds later (many changes together are one write). */
  schedule(ms = SOON_MS) { if (this.soon) return; this.soon = setTimeout(() => { this.soon = undefined; void this.run(); }, ms); this.soon.unref(); }
  /** Writes everything now; never throws (the error is in status()). */
  run(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = this.write().catch(e => { this.state.lastError = e instanceof Error ? e.message.slice(0, 300) : 'Yazılamadı.'; })
      .finally(() => { this.running = undefined; if (this.again) { this.again = false; void this.run(); } });
    return this.running;
  }
  /** Whole-chain check, again when the chain grew or hourly. */
  private verify() {
    const j = this.deps.store.journal, head = j.head()?.hash ?? null, t = Date.now();
    if (!this.verified || this.verified.head !== head || t - this.verified.at > 3600_000) this.verified = { head, at: t, report: j.verify() };
    return this.verified.report;
  }
  private async write() {
    const root = this.path();
    if (!root) return;
    const journal = this.deps.store.journal;
    journal.sealIfDue();
    const snap = buildSnapshot(this.deps, 0, this.verify()), cloud = cloudFolder(root);
    let written = 0;
    const put = async (rel: string, data: string | Buffer) => { if (await writeAtomic(join(root, rel), data)) written++; };
    await mkdir(root, { recursive: true });
    await put('README.md', README({ cloud, at: snap.at }));
    await put('durum-ozeti.md', statusMd(snap));
    // İşlem kayıtları: one file per day. A past day's file that changed (a restored Merkez) keeps its old copy beside it.
    const days = new Map<string, StoredEntry[]>();
    for (const s of snap.journal.entries) { const day = istanbulDay(s.entry.at); (days.get(day) ?? days.set(day, []).get(day)!).push(s); }
    const dir = join(root, 'islem-kayitlari'), today = istanbulDay(snap.at), seals = snap.journal.seals;
    await mkdir(dir, { recursive: true });
    for (const [day, lines] of days) {
      // No IP address in these files (it stays apart at Merkez and goes after a year); a masked older line with its content hash.
      const text = lines.map(s => canonicalJson({ type: 'kayit', hash: s.hash, entry: s.entry, ...(s.maskedHash ? { maskedHash: s.maskedHash } : {}) })).join('\n') + '\n', file = join(dir, `${day}.jsonl`), hash = sha(text);
      if (this.known.get(day) === hash) continue;
      let replaced = false;
      if (existsSync(file)) {
        const old = await readFile(file, 'utf8').catch(() => '');
        // Lines are only ever added at the end: a file that is not the start of the new one was something else.
        // A day whose older lines lost their IP address after a year (journal.addresses_masked): the old copy is not kept
        // (it would keep the address), earlier copies of that day go too; the masking record says what changed.
        const masked = lines.some(s => s.entry.masked);
        if (old && old !== text && !text.startsWith(old)) {
          if (masked) { for (const f of await readdir(dir).catch(() => [] as string[])) if (f.startsWith(`${day}.onceki-`)) await rm(join(dir, f), { force: true }); }
          else { replaced = true; await rename(file, join(dir, `${day}.onceki-${snap.at.replace(/[:.]/g, '-')}.jsonl`)); }
        }
      }
      await put(`islem-kayitlari/${day}.jsonl`, text);
      const seal = [...seals].reverse().find(s => s.seq >= lines[0].entry.seq) ?? seals.at(-1);
      const note = join(dir, `${day}-dogrulama.md`);
      if (day === today || replaced || !existsSync(note)) await put(`islem-kayitlari/${day}-dogrulama.md`, dayNote(day, lines, snap.journal.verify, seal, replaced));
      this.known.set(day, hash);
    }
    await put('islem-kayitlari/muhurler.jsonl', seals.map(s => canonicalJson({ type: 'muhur', ...s, fingerprint: sealFingerprint(s) })).join('\n') + (seals.length ? '\n' : ''));
    await put('islem-kayitlari/merkez-acik-anahtar.txt', `${snap.journal.publicKey}\n`);
    const anchor = journal.anchor();
    await put('islem-kayitlari/baslangic.json', canonicalJson({ seq: anchor.seq, hash: anchor.hash, keyId: snap.journal.keyId }) + '\n');
    // Hata kayıtları: one file per group; groups gone from Merkez (30 days) go here too.
    const keep = new Set<string>();
    for (const g of snap.failures) { keep.add(`${g.file}.md`); await put(`hata-kayitlari/${g.file}.md`, failureMd(g)); }
    await put('hata-kayitlari/hatalar.json', JSON.stringify({ format: 1, at: snap.at, note: 'Yalnız kodun yeri; mesaj, değer, satış ya da kişisel veri yok.', groups: snap.failures }, null, 2) + '\n');
    await this.prune(join(root, 'hata-kayitlari'), f => /^hata-.*\.md$/.test(f) && !keep.has(f));
    // Destek talepleri (personal data): never into a cloud folder.
    if (!cloud) written += await this.tickets(join(root, 'destek-talepleri'), snap.tickets);
    // Sürümler.
    await put('surumler/yayinlar.md', releasesMd(snap));
    const versions = new Set<string>();
    for (const h of snap.releases.history) { const f = `${slug(h.name)}-${h.tenantId.slice(0, 8)}.md`; versions.add(f); await put(`surumler/${f}`, cafeVersionMd(h, snap.status.businesses.find(b => b.tenantId === h.tenantId))); }
    await put('surumler/surumler.json', JSON.stringify({ format: 1, at: snap.at, releases: snap.releases.list, cafes: snap.releases.history }, null, 2) + '\n');
    await this.prune(join(root, 'surumler'), f => f.endsWith('.md') && f !== 'yayinlar.md' && !versions.has(f));
    await mkdir(join(root, 'guncellemeler'), { recursive: true });
    await put('guncellemeler/BENIOKU.txt', 'Bu klasöre "npm run installer" ile üretilen .mola-guncelleme dosyasını bırakın\r\n(.local\\installer\\Mola-<sürüm>\\Guncelleme\\Mola-<sürüm>-windows.mola-guncelleme).\r\nMola Yönetim → Ayarlar → Güncellemeler bölümünde "Klasörde hazır" olarak görünür; "Yükle ve doğrula" ile yüklenir.\r\nHiçbir paket kendiliğinden yayınlanmaz: yayınlamak her zaman sizin tıklamanızla olur.\r\n');
    this.state = { lastWriteAt: new Date().toISOString(), written };
  }
  /** Removes files the folder no longer needs (only names this writer makes). */
  private async prune(dir: string, gone: (name: string) => boolean) {
    for (const f of await readdir(dir).catch(() => [] as string[])) if (gone(f)) await rm(join(dir, f), { force: true }).catch(() => {});
  }
  private async tickets(dir: string, tickets: TicketDoc[]) {
    let written = 0;
    const put = async (rel: string, data: string | Buffer) => { if (await writeAtomic(join(dir, rel), data)) written++; };
    await put('KISISEL-VERI.txt', 'Bu klasör destek taleplerini ve eklerini içerir: KİŞİSEL VERİ.\r\nPaylaşmayın; OneDrive, Google Drive ya da başka bir bulut klasörüne kopyalamayın.\r\nEkler Mola Merkez’de 14 gün durur; silinince buradan da silinir.\r\n');
    const expected = new Map<string, Set<string>>(), now = this.deps.now();
    for (const t of tickets) {
      const folder = `${slug(t.business)}-${t.tenantId.slice(0, 8)}`, files = new Map<string, string>(), mine = expected.get(folder) ?? expected.set(folder, new Set()).get(folder)!;
      for (const a of t.messages.flatMap(m => m.attachments)) {
        const name = `${a.id.slice(0, 8)}-${a.name.replace(/[<>:"|?*\\/]/g, '')}`, path = join(dir, folder, 'ekler', name);
        if (Date.parse(a.expiresAt) <= now.getTime()) continue;
        if (!existsSync(path)) { try { const { data } = this.deps.attachments!.read(a.id, null, false, now); await writeAtomic(path, data); written++; } catch { continue; } }
        mine.add(`ekler/${name}`); files.set(a.id, `ekler/${encodeURI(name)}`);
      }
      const file = `${istanbulDay(t.createdAt)}-${slug(t.subject, 30)}-${t.id.slice(0, 8)}.md`;
      mine.add(file);
      await put(join(folder, file), ticketMd(t, files));
    }
    // Deleted tickets, expired attachments and deleted businesses leave this folder too.
    for (const folder of await readdir(dir).catch(() => [] as string[])) {
      const full = join(dir, folder); if (!statSync(full).isDirectory()) continue;
      const mine = expected.get(folder);
      if (!mine) { if (/-[0-9a-f-]{8}$/.test(folder)) await rm(full, { recursive: true, force: true }); continue; }
      for (const f of await readdir(full).catch(() => [] as string[])) if (f.endsWith('.md') && !mine.has(f)) await rm(join(full, f), { force: true });
      for (const f of await readdir(join(full, 'ekler')).catch(() => [] as string[])) if (!mine.has(`ekler/${f}`)) await rm(join(full, 'ekler', f), { force: true });
    }
    return written;
  }
  /** .mola-guncelleme files waiting in <folder>\guncellemeler (Güncellemeler → "Klasörde hazır"). */
  readyBundles() {
    const root = this.path(); if (!root) return { folder: null, files: [] as { name: string; size: number; modifiedAt: string; version?: string; platform?: string }[] };
    const folder = join(root, 'guncellemeler');
    let names: string[] = []; try { names = readdirSync(folder).filter(n => n.toLowerCase().endsWith('.mola-guncelleme')); } catch { /* none yet */ }
    return { folder, files: names.map(name => { const s = statSync(join(folder, name)), m = /^Mola-(.+)-(windows|macos-arm64|macos-x64|linux-x64)\.mola-guncelleme$/i.exec(name); return { name, size: s.size, modifiedAt: s.mtime.toISOString(), ...(m ? { version: m[1], platform: m[2] } : {}) }; }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)) };
  }
  /** One waiting file by its plain name (no folders). */
  bundlePath(name: string) {
    const root = this.path();
    if (!root || basename(name) !== name || !/^[\w.\- ()]{1,200}\.mola-guncelleme$/i.test(name)) return null;
    const p = join(root, 'guncellemeler', name);
    return existsSync(p) && relative(join(root, 'guncellemeler'), p) === name ? p : null;
  }
}

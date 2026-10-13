import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { totp } from '../../server/totp';
import { scenario } from './protected-server';

export async function ensureSetup(request: APIRequestContext) {
  const s = await (await request.get('/api/staff/state')).json();
  if (s.role === 'owner' && !s.setupCompleted) {
    const response = await request.post('/api/staff/setup', { data: { requestId: 'test-initial-setup', version: s.businessRevision ?? 0, name: s.name, tableCount: s.tables.length, changeSeconds: s.changeSeconds, commissionBps: s.commissionBps } });
    if (!response.ok()) throw new Error('Test setup failed');
  }
}

/** The browser tests' Mola Merkez (scripts/test-server.mjs); the café is the default baseURL (port 3100). */
export const MERKEZ = `http://127.0.0.1:${process.env.E2E_MERKEZ_PORT ?? '3190'}`;
export const ADMIN_API = `${MERKEZ}/api/merkez/admin`;
/** The newest test run folder: run-*\/merkez and run-*\/kafe. */
export function e2eRun() {
  const root = '.local/e2e', noted = join(root, `current-${process.env.E2E_PORT ?? '3100'}.txt`);
  // The run this suite's test server noted (another run may have started a newer folder meanwhile).
  try { const dir = readFileSync(noted, 'utf8').trim(); if (dir) return dir; } catch { /* older runs: the newest folder */ }
  return readdirSync(root).filter(n => n.startsWith('run-')).map(n => join(root, n)).filter(p => statSync(p).isDirectory()).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
/** The test Merkez's admin password: scripts/test-server.mjs replaced the generated first one (Mola Yönetim forces that). */
export const merkezPassword = () => readFileSync(join(e2eRun(), 'merkez', 'e2e-admin-password.txt'), 'utf8').trim();
/*
 * Two-step login for suites that change prices, packages or payments (server/merkez/step-up.ts 'sales'): `enableAdminFactor`
 * switches it on over the API for this suite's own Merkez (all sessions end), sign-ins then use a backup code (openYonetim,
 * adminLogin) and `adminCode` hands out the next unused Authenticator code (each is good once).
 */
let factor: { secret: string; recovery: string[]; used: number } | undefined;
export async function adminCode() {
  for (;;) {
    const current = Math.floor(Date.now() / 30000), step = Math.max(current, factor!.used + 1);
    if (step <= current + 1) { factor!.used = step; return totp(factor!.secret, step * 30000); }
    await new Promise(r => setTimeout(r, 1000));
  }
}
/** `api` must be signed in to Mola Yönetim. Does nothing (false) when this suite already switched it on. */
export async function enableAdminFactor(api: APIRequestContext) {
  if (factor) return false;
  const setup = await (await api.post(`${ADMIN_API}/mfa/setup`, { data: { password: merkezPassword() } })).json();
  factor = { secret: setup.secret, recovery: [...setup.recoveryCodes], used: Math.floor(Date.now() / 30000) - 1 };
  const r = await api.post(`${ADMIN_API}/mfa/enable`, { data: { code: totp(setup.secret, factor.used * 30000), saved: true } });
  expect(r.ok(), await r.text()).toBe(true);
  return true;
}
/** Mola Yönetim over the API (a backup code once two-step login is on). */
export async function adminLogin(api: APIRequestContext) {
  const r = await api.post(`${ADMIN_API}/login`, { data: { username: 'admin', password: merkezPassword(), ...(factor ? { code: factor.recovery.shift() } : {}) } });
  expect(r.ok(), await r.text()).toBe(true);
}
/** Opens the 10-minute Authenticator window for that API session (prices, packages, payments, updates). */
export async function openAdminRight(api: APIRequestContext) {
  const r = await api.post(`${ADMIN_API}/releases/yetki`, { data: { code: await adminCode() } });
  expect(r.ok(), await r.text()).toBe(true);
}
/** The step-up box over Mola Yönetim (src/platformStepUp.tsx): types the next code and continues. */
export async function confirmStepUp(page: Page, label?: string) {
  const box = page.getByRole('form', { name: 'Doğrulayıcı onayı' });
  if (label) await expect(box).toContainText(`“${label}” için onay`);
  await box.getByLabel('Doğrulayıcı kodu', { exact: true }).fill(await adminCode());
  await box.getByRole('button', { name: 'Onayla ve devam et' }).click();
  await expect(box).toBeHidden();
}
/** Mola Yönetim in this page, signed in. */
export async function openYonetim(page: Page, password = merkezPassword()) {
  await page.goto(`${MERKEZ}/`);
  await page.getByLabel('Şifre', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).click();
  if (factor) {
    await page.getByLabel('Authenticator veya kurtarma kodu', { exact: true }).fill(factor.recovery.shift()!);
    await page.getByRole('button', { name: 'Doğrula ve giriş yap' }).click();
  }
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).waitFor();
}
export const yonetimState = async (request: APIRequestContext) => (await request.get(`${ADMIN_API}/state`)).json();
/** Mola Yönetim's sidebar (a compact top bar on a phone). */
export const yonetimNav = (page: Page) => page.getByRole('navigation', { name: 'Mola Yönetim bölümleri' });
export async function yonetimGo(page: Page, name: 'Bugün' | 'İşletmeler' | 'Başvurular' | 'Destek' | 'Duyurular' | 'Satışlarım' | 'Paketler' | 'Ayarlar') {
  const item = yonetimNav(page).getByRole('button', { name, exact: true });
  // Phones (under 600 px): Duyurular (megaphone) and Paketler are icons beside the bell, not in the top strip.
  if ((name === 'Duyurular' || name === 'Paketler') && !await item.isVisible()) return page.locator('.yonetim-topbar').getByRole('button', { name, exact: true }).click();
  await item.click();
}
/**
 * Ayarlar → one section (Hesap güvenliği, Yedek, Güncellemeler, E-posta bildirimleri, İletişim bilgileri, İşlem kayıtları,
 * Çalışma klasörü, Geliştirici erişimi). The old name "İşlem geçmişi" opens İşlem kayıtları (same lines, now tamper-evident).
 * Paketler and Hizmet fiyatları have their own page since 13 Ekim: `yonetimPackages`.
 */
export async function yonetimSettings(page: Page, section: 'Hesap güvenliği' | 'Kullanıcılar' | 'Yedek' | 'Güncellemeler' | 'E-posta bildirimleri' | 'İletişim bilgileri' | 'İşlem geçmişi' | 'İşlem kayıtları' | 'Çalışma klasörü' | 'Geliştirici erişimi') {
  await yonetimGo(page, 'Ayarlar');
  await page.getByRole('navigation', { name: 'Ayarlar bölümleri' }).getByRole('button', { name: section === 'İşlem geçmişi' ? 'İşlem kayıtları' : section, exact: true }).click();
}
/** Paketler (left menu) → its tab: the packages or Hizmet fiyatları. */
export async function yonetimPackages(page: Page, tab: 'Paketler' | 'Hizmet fiyatları') {
  await yonetimGo(page, 'Paketler');
  await page.getByRole('navigation', { name: 'Paketler bölümleri' }).getByRole('button', { name: tab, exact: true }).click();
}
/** The bell: opens "Bildirim merkezi". */
export const yonetimBell = (page: Page) => page.getByRole('button', { name: /^Bildirim merkezi/ });
/** İşletmeler → search → the business page (a region named after the business). */
export async function openBusiness(page: Page, name: string) {
  await yonetimGo(page, 'İşletmeler');
  await page.getByRole('searchbox', { name: 'İşletme ara' }).fill(name);
  await page.locator('.platform-business-row').filter({ hasText: name }).first().click();
  return page.getByRole('region', { name, exact: true });
}
/** A tab of the business page: Özet, Lisans, Hizmet, Bilgiler, Destek. */
export const detailTab = (detail: Locator, name: 'Özet' | 'Lisans' | 'Hizmet' | 'Bilgiler' | 'Destek') => detail.getByRole('navigation', { name: 'İşletme yönetimi' }).getByRole('button', { name, exact: true });
/** Screens for the owner: also saved to YONETIM_EKRAN (docs/ekran/yonetim) when that is set. */
export async function yonetimShot(page: Page, file: string, path: string, fullPage = true) {
  await page.screenshot({ path, fullPage });
  const folder = process.env.YONETIM_EKRAN;
  // Documentation screens show Mola Yönetim as installed: the test Merkez's "Yerel test ortamı" label is hidden for that shot only.
  if (folder) { mkdirSync(folder, { recursive: true }); const hidden = page.locator('.platform-local-note'); await hidden.evaluateAll(els => els.forEach(e => { (e as HTMLElement).style.visibility = 'hidden'; })).catch(() => {}); await page.screenshot({ path: join(folder, file), fullPage }); await hidden.evaluateAll(els => els.forEach(e => { (e as HTMLElement).style.visibility = ''; })).catch(() => {}); }
}


/**
 * Café Ayarlar (src/SettingsPanel.tsx, 10 Ekim düzeni): five topics in the top bar ("Ayarlar konuları"), each with its parts
 * in a second row ("<topic> bölümleri"). A test opens a page by its name: "İşletme" is İşletme → Görünüm, "Masalar ve QR"
 * is Masalar ve QR → Masalar ve QR (tables, the QR address, renewing one code); printing is "QR kodlarını yazdır".
 * Names of the earlier Ayarlar still work: "Paketiniz" is Paket ve lisans, "Entegrasyonlar" Paket platformları, "Cihazlar"
 * Tablet ve telefonlar, "Güvenlik ve yedek" Yedek. Places that left Ayarlar open their new home (`movedSettings`).
 */
export type SettingsTopic = 'İşletme' | 'Masalar ve QR' | 'Sipariş ve mutfak' | 'Cihazlar' | 'Güvenlik ve yedek';
export const settingsTopicNames: SettingsTopic[] = ['İşletme', 'Masalar ve QR', 'Sipariş ve mutfak', 'Cihazlar', 'Güvenlik ve yedek'];
/** Every page of Ayarlar: a part of a topic. */
export type SettingsPage = 'İşletme' | 'Sosyal medya' | 'Paket ve lisans' | 'Masalar ve QR' | 'QR kodlarını yazdır' | 'Engellenen telefonlar' | 'Sipariş ve onay' | 'Mutfak' | 'Paket platformları' | 'Yazıcılar' | 'Sesler' | 'Tablet ve telefonlar' | 'Yedek' | 'Kilit ve güncelleme' | 'Telefonum';
export const settingsPlaces: Record<SettingsPage, [SettingsTopic, string]> = {
  'İşletme': ['İşletme', 'Görünüm'], 'Sosyal medya': ['İşletme', 'Sosyal medya'], 'Paket ve lisans': ['İşletme', 'Paket ve lisans'],
  'Masalar ve QR': ['Masalar ve QR', 'Masalar ve QR'], 'QR kodlarını yazdır': ['Masalar ve QR', 'QR kodlarını yazdır'], 'Engellenen telefonlar': ['Masalar ve QR', 'Engellenen telefonlar'],
  'Sipariş ve onay': ['Sipariş ve mutfak', 'Sipariş ve onay'], 'Mutfak': ['Sipariş ve mutfak', 'Mutfak'], 'Paket platformları': ['Sipariş ve mutfak', 'Paket platformları'],
  'Yazıcılar': ['Cihazlar', 'Yazıcılar'], 'Sesler': ['Cihazlar', 'Sesler'], 'Tablet ve telefonlar': ['Cihazlar', 'Tablet ve telefonlar'],
  'Yedek': ['Güvenlik ve yedek', 'Yedek'], 'Kilit ve güncelleme': ['Güvenlik ve yedek', 'Kilit ve güncelleme'], 'Telefonum': ['Güvenlik ve yedek', 'Telefonum'],
};
/** Earlier names of Ayarlar pages that are still Ayarlar pages. */
const settingsAliases: Record<string, SettingsPage> = { 'Paketiniz': 'Paket ve lisans', 'Entegrasyonlar': 'Paket platformları', 'Cihazlar': 'Tablet ve telefonlar', 'Güvenlik ve yedek': 'Yedek' };
/** Earlier Ayarlar pages that moved to a home (10 Ekim): the home's tab and sub-tab. */
const movedSettings: Record<string, () => [(page: Page, tab: string, part?: string) => Promise<void>, string, string?]> = {
  'Kasa ve ödeme': () => [openCash, 'Kasa ayarları'], 'Kasa ayarları': () => [openCash, 'Kasa ayarları'],
  'Giderler': () => [openCash, 'Giderler', 'Otomatik giderler'], 'Otomatik giderler': () => [openCash, 'Giderler', 'Otomatik giderler'],
  'Vardiya ve bahşiş': () => [openStaff, 'Personel ayarları'], 'Personel ayarları': () => [openStaff, 'Personel ayarları'],
  'KDV oranları': () => [openMenu, 'KDV oranları'], 'Rezervasyon': () => [openAgenda, 'Ayarlar'],
};
export const settingsPageNames = Object.keys(settingsPlaces) as SettingsPage[];
export const settingsTopics = (page: Page) => page.getByRole('navigation', { name: 'Ayarlar konuları' });
/** The second row of a topic ("Cihazlar bölümleri"). */
export const settingsParts = (page: Page, topic: SettingsTopic) => page.getByRole('navigation', { name: `${topic} bölümleri`, exact: true });
/** Café owner: Ayarlar (from the workspace menu, unless already there) → a topic, or a page by its name (its topic, then its part). */
export async function openSettings(page: Page, place: SettingsTopic | SettingsPage | string) {
  const moved = movedSettings[place];
  if (moved) { const [open, tab, part] = moved(); return open(page, tab, part); }
  const name = settingsAliases[place] ?? place;
  if (!await settingsTopics(page).isVisible()) await openView(page, 'Ayarlar');
  const [topic, part] = settingsPlaces[name as SettingsPage] ?? [name as SettingsTopic];
  await settingsTopics(page).getByRole('button', { name: new RegExp(`^${topic}`) }).click();
  await page.getByRole('heading', { level: 2, name: topic, exact: true }).waitFor();
  if (part) { await settingsParts(page, topic).getByRole('button', { name: new RegExp(`^${part}`) }).click(); await expect(settingsParts(page, topic).getByRole('button', { name: new RegExp(`^${part}`) })).toHaveAttribute('aria-current', 'page'); }
}

/**
 * The homes of the 10 Ekim düzeni: level 1 tabs ("<home> bölümleri"), level 2 sub-tabs ("<tab> bölümleri"). A role with a
 * single tab sees no tab row (the cashier's Kasa, the Müdür's Personel): `openHome` then only opens the place.
 */
async function openHome(page: Page, view: string, home: string, tab?: string, part?: string) {
  const tabs = page.getByRole('navigation', { name: `${home} bölümleri`, exact: true });
  if (!await tabs.isVisible()) {
    await openView(page, view);
    await page.locator(`nav[aria-label="${home} bölümleri"], .page-heading h1`).first().waitFor();
  }
  if (tab && await tabs.isVisible()) { await tabs.getByRole('button', { name: new RegExp(`^${tab}`) }).click(); await expect(tabs.getByRole('button', { name: new RegExp(`^${tab}`) })).toHaveAttribute('aria-current', 'page'); }
  if (part) {
    const parts = page.getByRole('navigation', { name: `${tab} bölümleri`, exact: true });
    // A role without that tab's sub-tabs (the Müdür's Giderler) sees its one page: nothing to choose.
    if (!await parts.waitFor({ timeout: 4000 }).then(() => true, () => false)) return;
    await parts.getByRole('button', { name: new RegExp(`^${part}`) }).click();
    await expect(parts.getByRole('button', { name: new RegExp(`^${part}`) })).toHaveAttribute('aria-current', 'page');
  }
}
/** Kasa ve giderler (the cashier's "Kasa"): Bugün · Giderler (Kayıtlar · Otomatik giderler) · Kapanışlar · İadeler · Kasa ayarları (Gün sonu · Kart ve yazar kasa · Kasiyer yetkileri). */
export const openCash = (page: Page, tab?: string, part?: string) => openHome(page, 'Kasa', 'Kasa ve giderler', tab, part);
/** Personel: Çalışanlar · Vardiya ve bahşiş (Vardiyalar · Bahşiş) · Personel ayarları (Vardiya · Bahşiş · Garson ataması). */
export const openStaff = (page: Page, tab?: string, part?: string) => openHome(page, 'Personel', 'Personel', tab, part);
/** Menü yönetimi: Ürünler · Kampanyalar · KDV oranları. */
export const openMenu = (page: Page, tab?: string) => openHome(page, 'Menü yönetimi', 'Menü yönetimi', tab);
/** Ajanda ve rezervasyon: Rezervasyonlar · Etkinlikler · Takvim · Ayarlar. */
export async function openAgenda(page: Page, tab?: string) {
  const tabs = page.getByRole('navigation', { name: 'Ajanda bölümleri', exact: true });
  if (!await tabs.isVisible()) await openView(page, 'Ajanda ve rezervasyon');
  if (tab) await tabs.getByRole('button', { name: new RegExp(`^${tab}`) }).click();
}
/** The owner's bell on the top bar: Bildirimler (once Destek → Bildirimler). */
export const bell = (page: Page) => page.locator('header.topbar').getByRole('button', { name: /^Bildirimler/ });
export async function openNotifications(page: Page) { await bell(page).click(); await page.getByRole('region', { name: 'Bildirimler' }).waitFor(); }

/**
 * A cash action of Masalar (Para bozdurma, Kasa hareketi, İade, Vardiya kodu, Gün sonu, Gider kaydet): from the cash strip on
 * phones and tablets, from the cash chip's menu on the counter's compact Masalar (≥ 900 px, src/CashDay.tsx `compact`).
 */
export async function cashAction(page: Page, name: string) {
  const chip = page.locator('.cash-chip');
  await page.locator('.cash-strip:visible, .cash-chip:visible').first().waitFor();
  // Right after a resize (a tablet → the café computer) the strip turns into the chip a moment later: decide once it has
  // settled (10 Ekim: the full suite picked the strip, then waited for its "Gün sonu" until the test's time ran out).
  await expect.poll(async () => { const before = await chip.isVisible(); await page.waitForTimeout(250); return before === await chip.isVisible(); }).toBe(true);
  if (await chip.isVisible()) {
    const menu = page.getByRole('group', { name: 'Kasa işlemleri' });
    if (!await menu.isVisible()) await chip.click();
    return menu.getByRole('button', { name, exact: true }).click();
  }
  if (name === 'Gider kaydet') return page.getByRole('button', { name: 'Gider kaydet', exact: true }).click();
  return page.locator('.cash-strip').getByRole('button', { name, exact: true }).click();
}
/** The counter's compact Masalar folds "İlk adımlar" into one line: opens it (no-op where it is a full card). */
export async function openFirstSteps(page: Page) {
  const toggle = page.getByRole('region', { name: 'İlk adımlar' }).locator('.first-steps-toggle');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

/**
 * A place of the café workspace by its menu name ("Masalar", "Kasa ve giderler", "Satış ve Raporlar"), on any screen: the
 * sidebar on tablets and computers; on phones (≤ 700 px) the bottom bar, or its "Daha fazla" sheet for the rest. "Kasa" is
 * the cashier's name of Kasa ve giderler (either opens it). Places that became tabs (10 Ekim) open their home's tab:
 * "Kampanyalar" → Menü yönetimi → Kampanyalar, "Çalışanlar" → Personel → Çalışanlar.
 */
export const bottomNav = (page: Page) => page.getByRole('navigation', { name: 'Alt menü' });
export const moreSheet = (page: Page) => page.getByRole('dialog', { name: 'Daha fazla' });
const startsWith = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${name === 'Kasa' ? '(?: ve giderler)?' : ''}(?:$|\\s*,|\\s*\\d)`);
/** Satış ve Raporlar → "Yazdır ve paylaş" (13 Ekim: one menu instead of four buttons) → one of its lines, by its label. */
export async function reportAction(page: Page, label: 'Yazdır / PDF' | 'Muhasebeci için indir' | 'Raporları gönder' | 'Raporları telefonda gör') {
  await page.getByRole('button', { name: 'Yazdır ve paylaş' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label.replace(/[/]/g, '\\/')}`) }).click();
}
export async function openView(page: Page, name: string) {
  if (name === 'Kampanyalar') return openMenu(page, 'Kampanyalar');
  if (name === 'Çalışanlar') return openStaff(page, 'Çalışanlar');
  const side = page.locator('.sidebar nav');
  await page.locator('.sidebar nav:visible, nav.bottom-nav:visible').first().waitFor();
  // The owner's Destek sits at the bottom of the sidebar (the menu's own Destek item is for narrow screens).
  if (await side.isVisible() && name === 'Destek' && await page.locator('.sidebar .support-nav').isVisible()) return page.locator('.sidebar .support-nav').click();
  if (await side.isVisible()) return side.getByRole('button', { name: startsWith(name) }).click();
  const bar = bottomNav(page), direct = bar.getByRole('button', { name: startsWith(name) });
  await bar.waitFor();
  if (await direct.count()) return direct.click();
  if (!await moreSheet(page).isVisible()) await bar.getByRole('button', { name: /^Daha fazla/ }).click();
  await moreSheet(page).getByRole('button', { name: startsWith(name) }).click();
}

/**
 * Satış ve Raporlar (src/SalesReports.tsx): the groups on top ("Rapor bölümleri"), the group's reports in the row under
 * them ("Rapor sekmeleri", absent when the group has a single report). Since 10 Ekim the record books live in their homes:
 * opening "Kasa kapanışları", "Giderler", "İade ve düzeltme" or "Personel ve bahşiş" goes there (`movedReports`). The old
 * "Para" group and its signposts went on 13 Ekim.
 */
export type ReportTab = 'Özet' | 'Ürünler' | 'Kârlılık' | 'Kampanyalar' | 'Kasa kapanışları' | 'Giderler' | 'İade ve düzeltme' | 'Çalışanlar' | 'Personel ve bahşiş' | 'Bahşiş' | 'Rezervasyon';
export type ReportGroup = 'Satış' | 'Personel' | 'Rezervasyon';
export const reportGroupOf: Partial<Record<ReportTab, ReportGroup>> = {
  'Özet': 'Satış', 'Ürünler': 'Satış', 'Kârlılık': 'Satış', 'Kampanyalar': 'Satış',
  'Çalışanlar': 'Personel', 'Rezervasyon': 'Rezervasyon',
};
/** Record books that moved from Satış ve Raporlar to their homes (10 Ekim). */
export const movedReports: Partial<Record<ReportTab, (page: Page) => Promise<void>>> = {
  'Kasa kapanışları': page => openCash(page, 'Kapanışlar'), 'Giderler': page => openCash(page, 'Giderler', 'Kayıtlar'), 'İade ve düzeltme': page => openCash(page, 'İadeler'),
  'Personel ve bahşiş': page => openStaff(page, 'Vardiya ve bahşiş', 'Vardiyalar'), 'Bahşiş': page => openStaff(page, 'Vardiya ve bahşiş', 'Bahşiş'),
};
export const reportGroups = (page: Page) => page.getByRole('navigation', { name: 'Rapor bölümleri' });
export const reportTabs = (page: Page) => page.getByRole('navigation', { name: 'Rapor sekmeleri' });
/** Inside Satış ve Raporlar: the report's group, then the report itself. */
export async function openReport(page: Page, tab: ReportTab) {
  const moved = movedReports[tab];
  if (moved) return moved(page);
  const group = reportGroupOf[tab]!;
  // Coming back from a home (a moved book was opened before): Satış ve Raporlar again.
  if (!await page.locator('nav[aria-label="Rapor bölümleri"], .simple-detail-btn, .reports-workspace .period-bar').first().isVisible() || await page.locator('.home').isVisible()) await openView(page, 'Satış ve Raporlar');
  // Satış ve Raporlar may open on the plain summary ("Sade özet"): "Detaylı göster" brings the groups and tabs.
  await page.locator('nav[aria-label="Rapor bölümleri"], .simple-detail-btn').first().waitFor();
  const more = page.getByRole('button', { name: 'Detaylı göster' });
  if (await more.isVisible()) await more.click();
  await reportGroups(page).getByRole('button', { name: group, exact: true }).click();
  if (group !== tab && tab !== 'Çalışanlar') await reportTabs(page).getByRole('button', { name: tab, exact: true }).click();
}

/** The "Hesap açma başvurusu" form on a clean café, filled with valid details (a dessert shop, VKN 1234567890). */
export async function fillApplication(page: Page, name: string, override: { taxNumber?: string; phone?: string; email?: string } = {}) {
  await page.getByLabel(/^İşletme adı/).fill(name);
  await page.getByRole('group', { name: 'İşletme türü' }).getByRole('button', { name: 'Tatlıcı / Pastane', exact: true }).click();
  await page.getByLabel('Ticari unvan *').fill(`${name} Gıda Ltd. Şti.`);
  await page.getByLabel('Vergi dairesi *').fill('Kadıköy');
  await page.getByLabel('Vergi kimlik no *').fill(override.taxNumber ?? '1234567890');
  await page.getByLabel('İl *', { exact: true }).fill('İstanbul');
  await page.getByLabel('İlçe *', { exact: true }).fill('Kadıköy');
  await page.getByLabel('Açık adres *').fill('Moda Cd. No: 1');
  await page.getByLabel(/Yetkili adı soyadı/).fill('Zeynep Kaya');
  await page.getByLabel('Cep telefonu *').fill(override.phone ?? '0532 123 45 67');
  await page.getByLabel('E-posta *').fill(override.email ?? 'zeynep@example.com');
  await page.getByLabel(/hesap açma ve faturalama/).check();
  await page.getByRole('checkbox', { name: /Mola Lisans Sözleşmesi’ni okudum ve kabul ediyorum/ }).check();
}
/** A "Hesap açma başvurusu" straight to the test Merkez, as a café computer would send it (own install and ids). */
export async function applyAt(request: APIRequestContext, name: string, options: { taxNumber?: string; machine?: string } = {}) {
  const r = await request.post(`${MERKEZ}/api/merkez/v1/applications`, { data: { requestId: randomUUID().replace(/-/g, ''), installId: randomUUID(), machineId: options.machine ?? 'e'.repeat(64), appVersion: '0.1.0',
    businessName: name, sector: 'cafe', contactName: 'Deneme Yetkili', consent: true,
    invoice: { legalName: `${name} Ltd. Şti.`, taxOffice: 'Kadıköy', taxType: 'company', taxNumber: options.taxNumber ?? '1111111114', city: 'İstanbul', district: 'Kadıköy', address: 'Moda Cd. No: 2', phone: '+905551112233', email: 'yetkili@example.com' } } });
  if (!r.ok()) throw new Error(`Başvuru gönderilemedi: ${await r.text()}`);
  return r.json();
}

/** Port n (0–9) of the clean-café range: 3120–3129 by default, E2E_PORT+20… when another run uses other ports. */
export const cleanPort = (n: number) => Number(process.env.E2E_PORT ?? 3100) + 20 + n;
/** Port n of the spare Merkez range: 3190+n by default, E2E_MERKEZ_PORT+n for another run. */
export const merkezPort = (n: number) => Number(process.env.E2E_MERKEZ_PORT ?? 3190) + n;

/**
 * A clean, not yet activated café server (built screens) talking to the test Merkez: for activation and onboarding.
 * Ports 3120–3129 only (E2E_PORT + 20…29 for a second run on this computer). `root`: start again over the same data folder
 * (a restart, another Merkez address).
 */
export async function cleanKafe(port: number, options: { merkezUrl?: string; root?: string; env?: Record<string, string> } = {}) {
  const root = options.root ?? scenario('kafe'), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PORT: String(port), DATA_DIR: join(root, 'veri'), SERVE_BUILD: '1', MOLA_CLEAN_INSTALL: '1', MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0',
      MOLA_MERKEZ_URL: options.merkezUrl ?? MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(e2eRun(), 'merkez', 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000', ...options.env },
  });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
    if (i > 120 || child.exitCode !== null) throw new Error('Temiz kafe sunucusu açılmadı.');
    await new Promise(r => setTimeout(r, 250));
  }
  // exitCode: e.g. 75 after "Şimdi kur" (the server asks its watchdog to apply an update).
  return { base, root, exited, exitCode: () => child.exitCode, async stop() { if (child.exitCode === null) child.kill(); await exited; } };
}

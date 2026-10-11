import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { createApp, DEMO_PASSWORD } from '../server/app.js';
import { cleanSocialLinks, normalizeSocial, normalizeSocialLinks, SOCIAL_CODE, socialEntries, socialHandle, socialLinksOf, socialPlatforms, validSocial, whatsappDigits, type SocialPlatform } from '../packages/domain/social-links.js';
import { tableLabelSize } from '../packages/domain/table-label.js';
import { MerkezLink } from '../server/kafe-link.js';
import { newSocialCode } from '../server/merkez/social.js';
import { PAPER, pdfWithImage } from '../src/imagePdf.js';
import { licensed, merkezPair, temp } from './merkez-fixture.js';

/*
 * Sosyal medya (Ayarlar → İşletme → Sosyal medya): per platform, a handle or a full link becomes one https link on that
 * platform's own domain; anything else is refused with a reason. The owner (and Mola destek) saves them with an audit entry;
 * other roles get 403; older data without the field keeps working; the guest only sees checked links.
 */
const ok = (p: SocialPlatform, input: string, url: string) => { const r = normalizeSocial(p, input); assert.deepEqual(r, { ok: true, url }, `${p}: ${input}`); };
const no = (p: SocialPlatform, input: string, reason?: RegExp) => { const r = normalizeSocial(p, input); assert.equal(r.ok, false, `${p}: ${input} → ${JSON.stringify(r)}`); if (reason && !r.ok) assert.match(r.error, reason, `${p}: ${input}`); };

test('Instagram: "@molacoffee", a bare name or a profile link → https://instagram.com/<name>; posts, other sites and bad names refused', () => {
  for (const input of ['@molacoffee', 'molacoffee', ' @molacoffee ', 'instagram.com/molacoffee', 'https://www.instagram.com/molacoffee/', 'http://instagram.com/molacoffee', 'https://instagram.com/molacoffee?igsh=abc123', 'https://m.instagram.com/molacoffee#top', 'instagr.am/molacoffee'])
    ok('instagram', input, 'https://instagram.com/molacoffee');
  ok('instagram', '@mola.coffee_ist', 'https://instagram.com/mola.coffee_ist');
  no('instagram', 'https://instagram.com/p/C0abc123/', /Profil bağlantısı/);
  no('instagram', 'https://instagram.com/reel/xyz', /Profil/);
  no('instagram', 'https://evil.example/molacoffee', /instagram\.com adresine ait değil/);
  no('instagram', 'https://instagram.com.evil.example/molacoffee', /ait değil/);
  no('instagram', '@.mola'); no('instagram', '@mola..coffee'); no('instagram', '@mola coffee'); no('instagram', '@' + 'a'.repeat(31));
  no('instagram', 'javascript:alert(1)', /https:\/\//);
  no('instagram', 'data:text/html,hi', /https:\/\//);
  no('instagram', 'ftp://instagram.com/molacoffee', /https:\/\//);
  no('instagram', 'https://user:pass@instagram.com/molacoffee', /şifre/);
  no('instagram', 'https://instagram.com:8443/molacoffee', /port/);
});

test('Facebook, TikTok, X and YouTube: handles and profile links on their own domains only', () => {
  ok('facebook', 'molacoffee', 'https://facebook.com/molacoffee');
  ok('facebook', 'https://www.facebook.com/molacoffee/?ref=bookmarks', 'https://facebook.com/molacoffee');
  ok('facebook', 'fb.com/molacoffee', 'https://facebook.com/molacoffee');
  ok('facebook', 'https://m.facebook.com/profile.php?id=100012345678&sk=about', 'https://facebook.com/profile.php?id=100012345678');
  ok('facebook', 'https://facebook.com/Mola-Kafe-123456789', 'https://facebook.com/Mola-Kafe-123456789');
  no('facebook', 'https://facebook.com/sharer/sharer.php?u=x'); no('facebook', 'https://facebook.com/profile.php'); no('facebook', 'https://facebook.evil.com/mola', /ait değil/);

  ok('tiktok', '@molacoffee', 'https://www.tiktok.com/@molacoffee');
  ok('tiktok', 'https://www.tiktok.com/@molacoffee?lang=tr', 'https://www.tiktok.com/@molacoffee');
  ok('tiktok', 'https://vm.tiktok.com/ZMabc123/', 'https://vm.tiktok.com/ZMabc123');
  no('tiktok', 'https://www.tiktok.com/@molacoffee/video/123', /video/); no('tiktok', 'https://tiktok.example/@mola', /ait değil/);

  ok('x', '@molacoffee', 'https://x.com/molacoffee');
  for (const input of ['https://twitter.com/molacoffee', 'https://mobile.twitter.com/molacoffee', 'x.com/molacoffee', 'http://www.x.com/molacoffee?s=20']) ok('x', input, 'https://x.com/molacoffee');
  no('x', '@this_name_is_far_too_long'); no('x', 'https://x.com/molacoffee/status/1', /gönderi/); no('x', 'https://x.com/home'); no('x', 'https://xcom.example/mola', /ait değil/);

  ok('youtube', '@molacoffee', 'https://www.youtube.com/@molacoffee');
  ok('youtube', 'https://youtube.com/@molacoffee/videos', 'https://www.youtube.com/@molacoffee');
  ok('youtube', 'https://www.youtube.com/channel/UC1234567890abcdefghijkl', 'https://www.youtube.com/channel/UC1234567890abcdefghijkl');
  ok('youtube', 'https://m.youtube.com/c/MolaKafe', 'https://www.youtube.com/c/MolaKafe');
  no('youtube', 'https://youtu.be/dQw4w9WgXcQ', /video/); no('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', /Kanal/); no('youtube', 'https://youtube.evil.com/@mola', /ait değil/);
});

test('WhatsApp: a Turkish or international number → https://wa.me/<digits>; wa.me and api.whatsapp.com links kept as wa.me', () => {
  for (const input of ['0532 123 45 67', '05321234567', '532 123 45 67', '+90 532 123 45 67', '+90 (532) 123-45-67', '0090 532 123 45 67', 'wa.me/905321234567', 'https://api.whatsapp.com/send?phone=905321234567&text=Merhaba'])
    ok('whatsapp', input, 'https://wa.me/905321234567');
  ok('whatsapp', '+44 20 7123 4567', 'https://wa.me/442071234567');
  ok('whatsapp', 'https://wa.me/message/ABCDEF123456', 'https://wa.me/message/ABCDEF123456');
  assert.equal(whatsappDigits('123'), null); assert.equal(whatsappDigits('0532 abc'), null);
  no('whatsapp', '123 45', /ülke|Numarayı/); no('whatsapp', 'https://chat.whatsapp.com/Invite123'); no('whatsapp', 'https://wa.me.evil.example/905321234567', /ait değil/);
  assert.equal(socialHandle('whatsapp', 'https://wa.me/905321234567'), '+90 532 123 45 67');
});

test('Web sitesi and Google Haritalar: https only, a real domain, Google Maps links only', () => {
  ok('website', 'molacoffee.com', 'https://molacoffee.com/');
  ok('website', 'http://www.molacoffee.com.tr/menu?x=1#top', 'https://www.molacoffee.com.tr/menu?x=1');
  no('website', 'localhost:3000'); no('website', 'https://192.168.1.20/'); no('website', 'javascript:alert(document.cookie)', /https/); no('website', 'mola coffee.com', /boşluk/); no('website', 'https://kafe.local/');
  assert.equal(socialHandle('website', 'https://www.molacoffee.com/'), 'molacoffee.com');
  for (const url of ['https://maps.app.goo.gl/AbCdEf123', 'https://goo.gl/maps/AbCdEf123', 'https://www.google.com/maps/place/Mola+Kafe/@41.0,29.0,17z', 'https://maps.google.com/?cid=1234567890', 'https://g.page/mola-kafe', 'https://share.google/gkp5TlYouPKRb6ja9'])
    ok('maps', url, new URL(url).href);
  ok('maps', 'http://maps.app.goo.gl/AbCdEf123', 'https://maps.app.goo.gl/AbCdEf123');
  no('maps', 'Kadıköy, İstanbul', /Paylaş/); no('maps', 'https://maps.app.goo.gl/'); no('maps', 'https://www.google.com/search?q=mola'); no('maps', 'https://maps.example.com/mola', /ait değil/);
  no('maps', `https://www.google.com/maps/place/${'a'.repeat(2100)}`, /uzun/);
});

test('normalised links are stable; the set keeps order, drops empties, refuses unknown names; stored junk never reaches a guest', () => {
  const inputs: Record<SocialPlatform, string> = { instagram: '@mola', facebook: 'molakafe', tiktok: '@mola', x: '@mola', youtube: '@molakafe', whatsapp: '0532 123 45 67', website: 'mola.com.tr', maps: 'https://maps.app.goo.gl/xyz', review: 'https://g.page/r/mola/review' };
  for (const p of socialPlatforms) { const r = normalizeSocial(p, inputs[p]); assert.ok(r.ok && r.url, p); assert.equal(validSocial(p, r.ok && r.url), true, `${p} is idempotent`); }
  const { links, errors } = normalizeSocialLinks({ maps: inputs.maps, instagram: inputs.instagram, x: '', facebook: '   ' });
  assert.deepEqual(errors, {}); assert.deepEqual(links, { maps: 'https://maps.app.goo.gl/xyz', instagram: 'https://instagram.com/mola' });
  assert.deepEqual(socialEntries(links).map(e => e.platform), ['instagram', 'maps'], 'Instagram first, Google Haritalar last');
  assert.deepEqual(Object.keys(normalizeSocialLinks({ linkedin: 'x', instagram: 'https://evil.example/x' }).errors).sort(), ['instagram', 'linkedin']);
  // Older data has no field at all; hand-edited data with a bad link shows only the good ones.
  assert.deepEqual(socialEntries(undefined), []); assert.equal(cleanSocialLinks(undefined), undefined);
  assert.deepEqual(cleanSocialLinks({ instagram: 'javascript:alert(1)', x: 'https://x.com/mola', facebook: 'http://facebook.com/mola' }), { x: 'https://x.com/mola' });
});

type Answer = { status: number; data: any };
async function cafe(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = temp('social-links'), store = new Store(dir); licensed(store);
  const server = createServer(createApp(store, () => new Date('2026-10-06T12:00:00Z')));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = (username: string) => {
    let cookie = '';
    const call = async (path: string, body?: unknown): Promise<Answer> => {
      const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (r.headers.getSetCookie().length) cookie = r.headers.getSetCookie()[0].split(';')[0];
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };
    return Object.assign(call, { login: () => call('/login', { username, password: DEMO_PASSWORD }) });
  };
  const owner = client('isletme'), cashier = client('kasiyer'), waiter = client('garson'), kitchen = client('mutfak');
  for (const c of [owner, cashier, waiter, kitchen]) assert.equal((await c.login()).status, 200);
  return { store, owner, cashier, waiter, kitchen, base };
}
const rid = () => randomUUID().replace(/-/g, '');

test('saving: owner only, normalised on the server, one audit entry, version checked, in both snapshots; older state without the field works', async t => {
  const c = await cafe(t);
  const before = (await c.owner('/staff/state')).data;
  assert.equal(before.socialLinks, undefined, 'a business that never set them');
  assert.equal(c.store.read('mola-demo').socialLinks, undefined);
  const table = before.tables[0];
  const guest = await fetch(`${c.base}/guest/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: table.token }) });
  const session = (await guest.json()).session as string, browser = guest.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  const guestState = async () => (await (await fetch(`${c.base}/guest/state`, { headers: { 'X-Guest-Session': session, Cookie: browser } })).json()) as any;
  const opened = await guestState();
  assert.ok(Array.isArray(opened.products), JSON.stringify(opened).slice(0, 200));
  assert.equal(opened.socialLinks, undefined, 'the guest menu of older data has no links and still opens');

  for (const role of [c.cashier, c.waiter, c.kitchen]) assert.equal((await role('/staff/social-links', { requestId: rid(), version: before.businessRevision ?? 0, links: { instagram: '@mola' } })).status, 403);
  const bad = await c.owner('/staff/social-links', { requestId: rid(), version: before.businessRevision ?? 0, links: { instagram: '@mola', x: 'https://evil.example/mola' } });
  assert.equal(bad.status, 400); assert.equal(bad.data.code, 'INVALID_SOCIAL_LINK'); assert.match(bad.data.message, /^X \(Twitter\): /);
  assert.equal((await c.owner('/staff/social-links', { requestId: rid(), version: before.businessRevision ?? 0, links: { website: 'javascript:alert(1)' } })).status, 400);

  const body = { requestId: rid(), version: before.businessRevision ?? 0, links: { instagram: '@molacoffee', whatsapp: '0532 123 45 67', x: '' } };
  const saved = await c.owner('/staff/social-links', body);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.links, { instagram: 'https://instagram.com/molacoffee', whatsapp: 'https://wa.me/905321234567' });
  assert.deepEqual((await c.owner('/staff/social-links', body)).data, saved.data, 'a repeated request is answered once');
  assert.equal((await c.owner('/staff/social-links', { ...body, requestId: rid() })).status, 409, 'an old version');
  assert.deepEqual(c.store.read('mola-demo').socialLinks, saved.data.links);
  assert.equal(c.store.auditLog('mola-demo').filter(a => a.action === 'business.social_links_updated').length, 1);
  const after = (await c.owner('/staff/state')).data;
  assert.deepEqual(after.socialLinks, saved.data.links); assert.equal(after.businessRevision, (before.businessRevision ?? 0) + 1);
  assert.deepEqual((await guestState()).socialLinks, saved.data.links, 'the guest menu shows them');

  // The Google review link stays where it was: saving the profile leaves the social links alone, and the other way round.
  const profile = await c.owner('/staff/business-profile', { requestId: rid(), version: after.businessRevision, name: after.name, logo: null, googleReviewUrl: 'https://g.page/r/mola/review' });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.deepEqual(c.store.read('mola-demo').socialLinks, saved.data.links);
  // An empty set removes the field again.
  assert.equal((await c.owner('/staff/social-links', { requestId: rid(), version: after.businessRevision + 1, links: {} })).status, 200);
  assert.equal('socialLinks' in c.store.read('mola-demo'), false);
  assert.equal(c.store.read('mola-demo').googleReviewUrl, 'https://g.page/r/mola/review');
});

// ---------- Google değerlendirme as a row, Merkez short addresses, table labels, the PDF file (6 Ekim) ----------

test('Google değerlendirme row: the review-link rules, kept as typed; older data with only googleReviewUrl shows it as the review row', () => {
  for (const url of ['https://share.google/gkp5TlYouPKRb6ja9', 'https://g.page/r/cafe/review', 'https://maps.app.goo.gl/cafe', 'https://www.google.com/maps/place/Cafe', 'https://search.google.com/local/writereview?placeid=123']) ok('review', url, url);
  ok('review', 'http://g.page/r/cafe/review', 'https://g.page/r/cafe/review');
  ok('review', 'g.page/r/cafe/review', 'https://g.page/r/cafe/review');
  no('review', 'https://share.google.evil.test/abc', /Google değerlendirme/); no('review', 'javascript:alert(1)', /https/); no('review', 'https://g.page:444/cafe'); no('review', 'https://search.google.com/local/writereview'); no('review', 'g.page/r/ca fe', /boşluk/);
  assert.equal(validSocial('review', 'https://g.page/r/cafe/review'), true);
  assert.equal(socialPlatforms.indexOf('review'), socialPlatforms.indexOf('maps') + 1, 'right after Google Haritalar');
  // Stored as before: googleReviewUrl; every snapshot shows it as `review` (a stray `review` inside socialLinks is ignored).
  assert.deepEqual(socialLinksOf({ googleReviewUrl: 'https://g.page/r/cafe/review' }), { review: 'https://g.page/r/cafe/review' });
  assert.deepEqual(socialLinksOf({ socialLinks: { instagram: 'https://instagram.com/mola', review: 'https://evil.example/x' }, googleReviewUrl: 'javascript:alert(1)' }), { instagram: 'https://instagram.com/mola' });
  assert.equal(socialLinksOf({}), undefined);
  // The sent window and the after-the-bill icon row leave the review out.
  assert.deepEqual(socialEntries({ instagram: 'https://instagram.com/mola', review: 'https://g.page/r/cafe/review' }, ['review']).map(e => e.platform), ['instagram']);
});

test('Google row migration: old state keeps its review link; Sosyal medya edits it; a request without the row leaves it alone; Görünüm no longer needs it', async t => {
  const c = await cafe(t);
  // Older data: the link was saved from Görünüm (googleReviewUrl) and no social links at all.
  c.store.mutate('mola-demo', s => { s.googleReviewUrl = 'https://g.page/r/eski/review'; delete s.socialLinks; });
  let state = (await c.owner('/staff/state')).data;
  assert.deepEqual(state.socialLinks, { review: 'https://g.page/r/eski/review' }, 'shown as the Google row');
  assert.equal(state.googleReviewUrl, 'https://g.page/r/eski/review');
  // A screen from before the row sends no `review`: the stored link stays.
  let r = await c.owner('/staff/social-links', { requestId: rid(), version: state.businessRevision ?? 0, links: { instagram: '@mola' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.links, { instagram: 'https://instagram.com/mola', review: 'https://g.page/r/eski/review' });
  assert.equal(c.store.read('mola-demo').googleReviewUrl, 'https://g.page/r/eski/review');
  assert.equal(c.store.read('mola-demo').socialLinks?.review, undefined, 'stored where it always was, not twice');
  // A wrong review link is refused by the review rules, naming the row.
  r = await c.owner('/staff/social-links', { requestId: rid(), version: r.data.revision, links: { review: 'https://evil.example/review' } });
  assert.equal(r.status, 400); assert.match(r.data.message, /^Google değerlendirme: /);
  state = (await c.owner('/staff/state')).data;
  r = await c.owner('/staff/social-links', { requestId: rid(), version: state.businessRevision, links: { instagram: '@mola', review: 'https://share.google/yeni123' } });
  assert.equal(c.store.read('mola-demo').googleReviewUrl, 'https://share.google/yeni123');
  // Görünüm saves without the field: the review link is untouched.
  state = (await c.owner('/staff/state')).data;
  assert.equal((await c.owner('/staff/business-profile', { requestId: rid(), version: state.businessRevision, name: state.name, logo: null })).status, 200);
  assert.equal(c.store.read('mola-demo').googleReviewUrl, 'https://share.google/yeni123');
  // `review: ''` removes it; the guest menu then has only Instagram.
  state = (await c.owner('/staff/state')).data;
  r = await c.owner('/staff/social-links', { requestId: rid(), version: state.businessRevision, links: { instagram: '@mola', review: '' } });
  assert.deepEqual(r.data.links, { instagram: 'https://instagram.com/mola' });
  assert.equal('googleReviewUrl' in c.store.read('mola-demo'), false);
});

const page = async (url: string) => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), text: await r.text(), cache: r.headers.get('cache-control') }; };
test('Merkez short addresses: links go up with the heartbeat, the code never changes; active → 302, suspended/expired/frozen/offline → unavailable page, unknown → 404', async t => {
  const pair = await merkezPair('social-short', { demo: true }); t.after(() => pair.close());
  await pair.importDemo(); await pair.adminLogin();
  const owner = pair.kafe(); assert.equal((await owner('/login', { username: 'isletme', password: DEMO_PASSWORD })).status, 200);
  let s = (await owner('/staff/state')).data;
  assert.equal((await owner('/staff/social-links', { requestId: rid(), version: s.businessRevision ?? 0, links: { instagram: '@molacoffee', review: 'https://g.page/r/mola/review' } })).status, 200);
  // "QR oluştur": the café asks Merkez (first heartbeat learns 'social', the next carries the links) and gets the short address.
  const qr = await owner('/staff/social-qr', {});
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  const base: string = qr.data.base;
  assert.match(base, new RegExp(`^${pair.merkezBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/[A-Za-z0-9]{10}$`));
  const code = base.split('/').at(-1)!;
  const biz = () => pair.merkezStore.read().businesses.find(b => b.tenantId === 'mola-demo')!;
  assert.deepEqual(biz().social?.links, { instagram: 'https://instagram.com/molacoffee', review: 'https://g.page/r/mola/review' });
  // Active: straight on to the link; never cached (a suspension takes effect at once).
  let p = await page(`${base}/instagram`);
  assert.equal(p.status, 302); assert.equal(p.location, 'https://instagram.com/molacoffee'); assert.match(p.cache ?? '', /no-store/);
  assert.equal((await page(`${base}/review`)).location, 'https://g.page/r/mola/review');
  assert.equal((await page(`${base}/facebook`)).status, 404, 'no Facebook link: not found');
  assert.equal((await page(`${pair.merkezBase}/s/AAAAAAAAAA/instagram`)).status, 404);
  assert.match((await page(`${pair.merkezBase}/s/AAAAAAAAAA/instagram`)).text, /Bu bağlantı bulunamadı/);
  assert.equal((await page(`${pair.merkezBase}/s/${code.slice(0, 9)}/instagram`)).status, 404, 'a malformed code');
  // An edited link: same code, the QR follows it.
  s = (await owner('/staff/state')).data;
  assert.equal((await owner('/staff/social-links', { requestId: rid(), version: s.businessRevision, links: { instagram: '@molakahve', review: 'https://g.page/r/mola/review' } })).status, 200);
  assert.equal((await owner('/staff/social-qr', {})).data.base, base, 'the code never changes');
  assert.equal((await page(`${base}/instagram`)).location, 'https://instagram.com/molakahve');
  // Suspended in Mola Yönetim: the small Mola page, no business data; resumed: forwards again.
  let b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: false, months: 0, suspended: true, reason: 'Ödeme' })).status, 200);
  p = await page(`${base}/instagram`);
  assert.equal(p.status, 200); assert.match(p.text, /Bu işletmenin bu hizmeti şu anda kullanılamıyor\./); assert.match(p.text, /currently unavailable/);
  assert.equal(p.text.includes(biz().name), false, 'no business name'); assert.equal(p.text.includes('instagram.com'), false, 'no link');
  b = (await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo');
  assert.equal((await pair.admin('/licenses', { requestId: rid(), tenantId: 'mola-demo', expectedEnd: b.endsAt, expectedSuspended: true, months: 0, suspended: false })).status, 200);
  assert.equal((await page(`${base}/instagram`)).status, 302);
  // Expired, frozen, or the café not heard from for 14 days (its guest menu is closed then too): unavailable.
  const end = biz().endsAt;
  pair.merkezStore.mutate(d => { d.businesses.find(x => x.tenantId === 'mola-demo')!.endsAt = new Date(Date.now() - 86400000).toISOString(); });
  assert.match((await page(`${base}/instagram`)).text, /kullanılamıyor/);
  pair.merkezStore.mutate(d => { const x = d.businesses.find(y => y.tenantId === 'mola-demo')!; x.endsAt = end; x.freezes = [{ id: 'f1', reason: 'Tadilat', startDate: '2026-01-01', days: 30, requestedAt: new Date().toISOString(), status: 'approved', startsAt: new Date(Date.now() - 86400000).toISOString(), until: new Date(Date.now() + 86400000).toISOString() }]; });
  assert.match((await page(`${base}/instagram`)).text, /kullanılamıyor/);
  pair.merkezStore.mutate(d => { d.businesses.find(y => y.tenantId === 'mola-demo')!.freezes = []; });
  assert.equal((await page(`${base}/instagram`)).status, 302);
  const install = biz().installId!;
  pair.merkezStore.mutate(d => { d.installs.find(i => i.id === install)!.lastSeenAt = new Date(Date.now() - 15 * 86400000).toISOString(); });
  assert.match((await page(`${base}/instagram`)).text, /kullanılamıyor/);
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal((await page(`${base}/instagram`)).status, 302, 'back once the café connects');
  // A café from before this sends no `social`: Merkez keeps what it has; nothing about the visitor is kept.
  pair.link.reporter = { ...pair.link.reporter, social: undefined };
  assert.equal('social' in pair.link.payload(pair.link.read()!), false);
  assert.equal((await pair.link.sync()).ok, true);
  assert.equal(biz().social?.code, code); assert.equal(biz().social?.links.instagram, 'https://instagram.com/molakahve');
  // An older Merkez (it never listed 'social') gets no field from this café.
  assert.equal('social' in pair.link.payload({ ...pair.link.read()!, accepts: ['backup.second'] }), false);
  // Mola Yönetim → Bilgiler: read-only.
  assert.deepEqual((await pair.admin('/state')).data.businesses.find((x: any) => x.tenantId === 'mola-demo').social.links, { instagram: 'https://instagram.com/molakahve', review: 'https://g.page/r/mola/review' });
  // Limited per address like the other public calls.
  let limited = 0; for (let i = 0; i < 70; i++) if ((await page(`${pair.merkezBase}/s/BBBBBBBBBB/x`)).status === 429) limited++;
  assert.ok(limited > 0);
});

test('short codes: 10 characters, random, never repeated; no Mola activation → no short address', () => {
  const taken = new Set<string>();
  for (let i = 0; i < 3000; i++) { const c = newSocialCode(taken); assert.match(c, SOCIAL_CODE); assert.equal(taken.has(c), false); taken.add(c); }
  const link = new MerkezLink(new Store(temp('social-inactive'), []));
  assert.deepEqual(link.socialAddress('mola-demo'), { problem: 'inactive' });
});

test('table labels: short names full size, long custom names smaller on two lines, never below the minimum', () => {
  assert.equal(tableLabelSize('Masa 1', 6), 34); assert.equal(tableLabelSize('Masa 12', 12), 22); assert.equal(tableLabelSize('Bahçe 4', 'png'), 150);
  const long = tableLabelSize('Teras Pencere Kenarı 3', 6);
  assert.ok(long < 34 && long >= 13, String(long));
  assert.ok(tableLabelSize('Çokuzunbirmasaadıdenemesiiçin', 6) >= 13);
  assert.ok(tableLabelSize('Teras Pencere Kenarı 3', 12) <= 12);
});

test('"PDF indir": one A4 or A6 page with the card as one image; a well-formed PDF (header, objects, xref, trailer)', () => {
  const image = { data: new Uint8Array([1, 2, 3, 4, 5]), width: 1080, height: 1440, filter: 'FlateDecode' as const };
  for (const paper of ['a4', 'a6'] as const) {
    const bytes = pdfWithImage(image, paper, 'Instagram QR kodu'), text = Buffer.from(bytes).toString('latin1');
    assert.equal(text.slice(0, 8), '%PDF-1.4'); assert.match(text, /%%EOF\n$/);
    assert.match(text, new RegExp(`/MediaBox \\[0 0 ${PAPER[paper].width} ${PAPER[paper].height}\\]`));
    assert.match(text, /\/Width 1080 \/Height 1440 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length 5/);
    // Every object starts exactly where the xref says.
    const at = text.indexOf('\nxref\n') + 1, xref = text.slice(at), offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
    assert.equal(offsets.length, 6);
    offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
    assert.equal(Number(/startxref\n(\d+)/.exec(text)![1]), at);
  }
});

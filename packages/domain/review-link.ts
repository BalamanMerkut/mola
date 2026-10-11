export function isGoogleReviewUrl(value: string): boolean {
 if (!value) return true;
 try {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  if (u.hostname === 'share.google') return /^\/[A-Za-z0-9_-]+$/.test(u.pathname);
  if (u.hostname === 'g.page' || u.hostname === 'maps.app.goo.gl') return u.pathname.length > 1;
  if (u.hostname === 'search.google.com') return u.pathname === '/local/writereview' && !!u.searchParams.get('placeid');
  if (['google.com', 'www.google.com', 'google.com.tr', 'www.google.com.tr', 'maps.google.com'].includes(u.hostname)) return u.pathname.startsWith('/maps') || (u.pathname === '/local/writereview' && !!u.searchParams.get('placeid'));
  return false;
 } catch { return false; }
}

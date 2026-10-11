import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGoogleReviewUrl } from '../packages/domain/review-link.js';
test('review links allow supported Google destinations and reject unrelated or unsafe links', () => {
 for (const url of ['', 'https://share.google/gkp5TlYouPKRb6ja9', 'https://g.page/r/cafe/review', 'https://maps.app.goo.gl/cafe', 'https://www.google.com/maps/place/Cafe', 'https://search.google.com/local/writereview?placeid=123']) assert.equal(isGoogleReviewUrl(url), true, url);
 for (const url of ['https://share.google/', 'https://share.google.evil.test/abc', 'http://share.google/abc', 'https://user:pass@share.google/abc', 'https://share.google/abc/def', 'javascript:alert(1)', 'http://g.page/r/cafe', 'https://google.com.evil.test/maps/place/Cafe', 'https://evil.test/maps', 'https://user:pass@g.page/cafe', 'https://g.page:444/cafe', 'https://search.google.com/local/writereview', 'broken']) assert.equal(isGoogleReviewUrl(url), false, url);
});

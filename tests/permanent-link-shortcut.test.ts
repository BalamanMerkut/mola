import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFile } from '../src/PermanentLink.js';

// "Masaüstüne kısayol" (src/PermanentLink.tsx): the file holds the permanent link, and its name is safe on Windows.
const URL = 'https://merkez.example.com/k/Ab3dEf7hJk';

test('Windows shortcut: .url with the permanent link, CRLF', () => {
  assert.deepEqual(shortcutFile(URL, 'Kahve Durağı', false), { name: 'Mola - Kahve Durağı.url', type: 'application/octet-stream', body: `[InternetShortcut]\r\nURL=${URL}\r\n` });
});

test('the name loses what Windows forbids, and never ends in a dot or space', () => {
  assert.equal(shortcutFile(URL, 'A/B: "Kafe" <1>?*|\\ Ltd.', false).name, 'Mola - A B Kafe 1 Ltd.url');
  assert.equal(shortcutFile(URL, '', false).name, 'Mola.url');
  assert.equal(shortcutFile(URL, '...', false).name, 'Mola.url');
});

test('macOS shortcut: .webloc plist with the link escaped', () => {
  const f = shortcutFile('https://merkez.example.com/k/Ab3dEf7hJk?a=1&b=2', 'Kafe', true);
  assert.equal(f.name, 'Mola - Kafe.webloc');
  assert.match(f.body, /<plist version="1.0"><dict><key>URL<\/key><string>https:\/\/merkez\.example\.com\/k\/Ab3dEf7hJk\?a=1&amp;b=2<\/string><\/dict><\/plist>/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { findPrintBrowser, pdfOf, pdfProblemText, pdfTimeout, printBrowserCandidates, registryDefault } from '../server/pdf-print.js';

// 8 Ekim: the installed Mola Yönetim said "Edge bulunamadı" on Windows 11. The browser is now looked for in the registry's
// App Paths, both Program Files folders (also without the environment variables), LOCALAPPDATA and `where`.
test('print browser: every Windows place, Edge first, fixed folders even without the environment', () => {
  const none = printBrowserCandidates({}, 'win32');
  assert.equal(none[0], 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.ok(none.includes('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(none.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(none.findIndex(p => /chrome/i.test(p)) > none.findIndex(p => /msedge/i.test(p)));
  const env = { 'ProgramFiles(x86)': 'D:\\PF86', ProgramFiles: 'D:\\PF', LOCALAPPDATA: 'C:\\Users\\Şule\\AppData\\Local' };
  const all = printBrowserCandidates(env, 'win32', { edge: ['E:\\Edge\\msedge.exe'], chrome: ['E:\\Chrome\\chrome.exe'], where: ['F:\\x\\chrome.exe'] });
  assert.equal(all[0], 'E:\\Edge\\msedge.exe', 'the registry first');
  assert.ok(all.includes('D:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe') && all.includes('C:\\Users\\Şule\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(all.includes('C:\\Users\\Şule\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  assert.equal(all.at(-1), 'F:\\x\\chrome.exe', '`where` last');
  assert.equal(new Set(all.map(p => p.toLowerCase())).size, all.length, 'no path twice');
  // A thin environment (no ProgramFiles(x86)) still finds Edge in its usual folder.
  assert.equal(findPrintBrowser({}, p => p === 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'win32'), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(findPrintBrowser({ LOCALAPPDATA: 'C:\\L' }, p => p === 'C:\\L\\Google\\Chrome\\Application\\chrome.exe', 'win32'), 'C:\\L\\Google\\Chrome\\Application\\chrome.exe');
});

test('print browser: App Paths answer of reg.exe (any Windows language), %VARS% expanded', () => {
  const tr = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe\r\n    (Varsayılan)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\r\n\r\n';
  assert.equal(registryDefault(tr), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(registryDefault('    (Default)    REG_EXPAND_SZ    "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"\r\n', { LOCALAPPDATA: 'C:\\U\\L' }), 'C:\\U\\L\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(registryDefault('ERROR: The system was unable to find the specified registry key or value.'), undefined);
});

test('PDF problems are told apart and logged with the paths tried', async () => {
  const lines: string[] = [];
  const r = await pdfOf('<p>x</p>', { browser: 'C:\\yok\\msedge.exe', log: l => lines.push(l) });
  assert.equal(r.pdf, undefined); assert.equal(r.problem, 'not-found'); assert.deepEqual(r.tried, ['C:\\yok\\msedge.exe']);
  assert.match(lines[0], /Denenen yollar: C:\\yok\\msedge\.exe/);
  assert.match(pdfProblemText(r, 'Excel alın.'), /Edge ya da Chrome bulunamadı\)\. Excel alın\.$/);
  assert.match(pdfProblemText({ problem: 'failed', tried: [] }, ''), /açıldı ama PDF hazırlayamadı/);
  assert.equal(pdfTimeout(1000), 60_000); assert.equal(pdfTimeout(5 * 1_048_576), 135_000); assert.equal(pdfTimeout(100 * 1_048_576), 300_000);
});

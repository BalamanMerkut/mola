import { runProgram } from './programs.js';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * A PDF of an HTML page, made on this computer by the browser that is already installed (Microsoft Edge comes with Windows;
 * else Google Chrome or Chromium): `--headless --print-to-pdf`. No package, no network: the page is a file in a temporary
 * folder with its own browser profile, both removed afterwards. Used for the printable reports (server/report-document.ts,
 * Mola Yönetim's journal and Satışlarım). No browser, a failure or a timeout: no PDF, and the caller offers the printable page.
 * MOLA_PDF_BROWSER: the browser's full path, or 0 to never make PDFs.
 *
 * Finding the browser (8 Ekim, the owner's installed Mola Yönetim said "Edge bulunamadı" on Windows 11): the Windows "App
 * Paths" registry entries of msedge.exe and chrome.exe (where their installers say they are; this user, then the computer,
 * also the 32-bit view), both Program Files folders (from the environment and the fixed C:\ names, since a program started
 * with a thin environment may lack ProgramFiles(x86)), the user's own LOCALAPPDATA installs, and last `where`. Edge first,
 * then Chrome. Each found browser is tried in turn; one that starts but makes no PDF is tried once more without its own
 * sandbox (some locked-down Windows sessions refuse it; the page is our own file with no script and no address to visit).
 * When nothing works, one line goes to the server log (logs\sunucu.log / logs\merkez.log) with every path tried and why.
 */
export type PdfProblem = 'off' | 'not-found' | 'failed';
export type PdfResult = { pdf?: Buffer; problem?: PdfProblem; browser?: string; tried: string[]; detail?: string };

const EDGE = 'Microsoft\\Edge\\Application\\msedge.exe', CHROME = 'Google\\Chrome\\Application\\chrome.exe';
const unique = (list: (string | undefined)[]) => { const seen = new Set<string>(), out: string[] = []; for (const p of list) { const k = p?.trim().toLowerCase(); if (p && k && !seen.has(k)) { seen.add(k); out.push(p.trim()); } } return out; };
/** Every place this platform's print browsers may be, best first (registry finds go before the folders). */
export function printBrowserCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, found: { edge?: string[]; chrome?: string[]; where?: string[] } = {}): string[] {
  if (platform === 'win32') {
    const folders = unique([env['ProgramFiles(x86)'], env.ProgramFiles, env.ProgramW6432, 'C:\\Program Files (x86)', 'C:\\Program Files']);
    const local = env.LOCALAPPDATA?.trim();
    const at = (relative: string) => [...folders.map(f => `${f}\\${relative}`), ...(local ? [`${local}\\${relative}`] : [])];
    return unique([...(found.edge ?? []), ...at(EDGE), ...(found.chrome ?? []), ...at(CHROME), ...(found.where ?? [])]);
  }
  if (platform === 'darwin') return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
}
/** Quick look without the registry (tests, and whether a PDF is likely): the chosen browser or the first one in a known folder. */
export function findPrintBrowser(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync, platform: NodeJS.Platform = process.platform): string | undefined {
  const chosen = env.MOLA_PDF_BROWSER?.trim();
  if (chosen) return chosen === '0' ? undefined : exists(chosen) ? chosen : undefined;
  return printBrowserCandidates(env, platform).find(p => exists(p));
}

/** `reg.exe query <key> /ve` → the default value (App Paths: the program's full path), %VARS% expanded. */
export function registryDefault(text: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = /REG_(?:EXPAND_)?SZ[ \t]+(.+?)\s*$/m.exec(text)?.[1]?.trim().replace(/^"(.*)"$/, '$1');
  return value ? value.replace(/%([^%]+)%/g, (all, name: string) => env[name] ?? env[Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase()) ?? ''] ?? all) : undefined;
}
async function appPaths(exe: string): Promise<string[]> {
  const keys = [`HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`];
  const answers = await Promise.all(keys.map(k => runProgram('reg.exe', ['query', k, '/ve'], { output: true, timeoutMs: 10_000 }).then(a => a.code === 0 ? registryDefault(a.out) : undefined, () => undefined)));
  return unique(answers);
}
let looked: Promise<string[]> | undefined;
/** The print browsers on this computer that exist, best first (cached; looked up again after a failure). */
export function printBrowsers(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): Promise<{ found: string[]; tried: string[] }> {
  const chosen = env.MOLA_PDF_BROWSER?.trim();
  if (chosen) return Promise.resolve(chosen === '0' ? { found: [], tried: [] } : { found: exists(chosen) ? [chosen] : [], tried: [chosen] });
  if (process.platform !== 'win32') { const tried = printBrowserCandidates(env); return Promise.resolve({ found: tried.filter(p => exists(p)), tried }); }
  const lookup = looked ??= (async () => {
    const [edge, chrome] = await Promise.all([appPaths('msedge.exe'), appPaths('chrome.exe')]);
    let tried = printBrowserCandidates(env, 'win32', { edge, chrome });
    if (!tried.some(p => exists(p))) {
      // Last: whatever `where` finds on the PATH.
      const where = await runProgram('where.exe', ['msedge.exe', 'chrome.exe'], { output: true, timeoutMs: 10_000 }).then(a => a.out.split(/\r?\n/).map(l => l.trim()).filter(Boolean), () => [] as string[]);
      tried = printBrowserCandidates(env, 'win32', { edge, chrome, where });
    }
    return tried;
  })();
  return lookup.then(tried => ({ found: tried.filter(p => exists(p)), tried }));
}

/** One PDF at a time on this computer (a browser per report is enough). */
let queue: Promise<unknown> = Promise.resolve();
/** The PDF, or why there is none (with every path tried). */
export function pdfOf(html: string, o: { browser?: string; timeoutMs?: number; log?: (line: string) => void } = {}): Promise<PdfResult> {
  const run = queue.then(() => make(html, o));
  queue = run.catch(() => undefined);
  return run;
}
/** The PDF, or undefined (no browser, or it failed; the reason is in the server log). */
export async function htmlToPdf(html: string, o: { browser?: string; timeoutMs?: number } = {}): Promise<Buffer | undefined> {
  return (await pdfOf(html, o)).pdf;
}
/** What the screen says when there is no PDF (the reason; the paths tried are in the server log). */
export function pdfProblemText(r: PdfResult, instead: string) {
  const why = r.problem === 'not-found' ? 'Edge ya da Chrome bulunamadı' : r.problem === 'off' ? 'PDF hazırlama kapalı' : 'Edge/Chrome açıldı ama PDF hazırlayamadı; ayrıntı sunucu kaydında';
  return `Bu bilgisayarda PDF oluşturulamadı (${why}). ${instead}`;
}
/** A big report needs longer: one minute, and 15 s more for every MB of page, at most five minutes. */
export const pdfTimeout = (bytes: number) => Math.min(300_000, 60_000 + Math.floor(bytes / 1_048_576) * 15_000);
const flat = (text: string) => text.replace(/\s+/g, ' ').trim().slice(-400);

async function make(html: string, o: { browser?: string; timeoutMs?: number; log?: (line: string) => void }): Promise<PdfResult> {
  const log = o.log ?? (line => console.warn(line));
  if (!o.browser && process.env.MOLA_PDF_BROWSER?.trim() === '0') return { problem: 'off', tried: [] };
  const { found, tried } = o.browser ? { found: existsSync(o.browser) ? [o.browser] : [], tried: [o.browser] } : await printBrowsers();
  if (!found.length) {
    looked = undefined;
    log(`[PDF ${new Date().toISOString()}] PDF oluşturulamadı: Edge ya da Chrome bulunamadı. Denenen yollar: ${tried.join(' | ') || '(yok)'}`);
    return { problem: 'not-found', tried };
  }
  const timeoutMs = o.timeoutMs ?? pdfTimeout(Buffer.byteLength(html));
  const reasons: string[] = [];
  // At most one Edge and one Chrome: the same browser from another path seldom helps.
  const picks = unique([found.find(p => /msedge/i.test(p)), found.find(p => !/msedge/i.test(p))]);
  for (const browser of picks) {
    for (const sandbox of [true, false]) {
      const r = await attempt(html, browser, timeoutMs, sandbox);
      if (r.pdf) {
        if (reasons.length) log(`[PDF ${new Date().toISOString()}] PDF ${browser}${sandbox ? '' : ' (korumasız kipte)'} ile hazırlandı; önceki denemeler: ${reasons.join(' | ')}`);
        return { pdf: r.pdf, browser, tried };
      }
      reasons.push(`${browser}${sandbox ? '' : ' --no-sandbox'}: ${r.why}`);
      if (r.timedOut) break;  // a page too big for the time: the same again without the sandbox would take as long
    }
  }
  looked = undefined;
  const detail = reasons.join(' | ');
  log(`[PDF ${new Date().toISOString()}] PDF oluşturulamadı. ${detail}. Denenen yollar: ${tried.join(' | ')}`);
  return { problem: 'failed', browser: picks[0], tried, detail };
}

async function attempt(html: string, browser: string, timeoutMs: number, sandbox: boolean): Promise<{ pdf?: Buffer; why: string; timedOut?: boolean }> {
  let dir = '';
  const started = Date.now();
  try {
    dir = mkdtempSync(join(tmpdir(), 'mola-pdf-'));
    const page = join(dir, 'rapor.html'), out = join(dir, 'rapor.pdf');
    writeFileSync(page, html, 'utf8');
    // Started from the worker thread of server/programs.ts (a browser's start on a weak PC never holds the tablets).
    const args = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking',
      '--no-pdf-header-footer', ...(sandbox ? [] : ['--no-sandbox']), `--user-data-dir=${join(dir, 'profil')}`, `--print-to-pdf=${out}`, pathToFileURL(page).href];
    let answer: Awaited<ReturnType<typeof runProgram>>;
    try { answer = await runProgram(browser, args, { timeoutMs, errors: true }); }
    catch (e) { return { why: `başlatılamadı (${(e as Error).message})` }; }
    const took = `${((Date.now() - started) / 1000).toFixed(1)} sn`;
    if (answer.timedOut) return { why: `${Math.round(timeoutMs / 1000)} sn içinde bitmedi, durduruldu`, timedOut: true };
    if (!existsSync(out)) return { why: `PDF dosyası çıkmadı (çıkış kodu ${answer.code}, ${took}${answer.err?.trim() ? `, hata: ${flat(answer.err)}` : ''})` };
    const pdf = readFileSync(out);
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { why: `çıkan dosya PDF değil (${pdf.length} bayt, ${took})` };
    return { pdf, why: '' };
  } catch (e) { return { why: `hazırlanamadı (${(e as Error).message})` }; }
  // The browser's profile folder may still be held for a moment after it exits (Windows): removed in the background, so its
  // retries (up to 3 s) never hold the tablets.
  finally { if (dir) void rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => { /* a temp folder; Windows cleans it */ }); }
}
